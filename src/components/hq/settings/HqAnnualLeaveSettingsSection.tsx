// src/components/hq/settings/HqAnnualLeaveSettingsSection.tsx
"use client";

import React, { useMemo, useState } from "react";
import {
  DEFAULT_APPROVAL_POLICIES,
  PRESET_ASSIGNEES,
} from "@/lib/hq/defaultApprovalPolicies";
import {
  buildAccrualPreviewRows,
  DEFAULT_ANNUAL_LEAVE_POLICY,
  DEFAULT_ANNUAL_LEAVE_SETTINGS,
  FISCAL_DATE_OPTIONS,
  GRACE_PERIOD_OPTIONS,
} from "@/lib/hq/defaultLeaveSettings";
import type {
  HqAnnualLeaveGlobalSettings,
  HqAnnualLeavePolicyItem,
  HqApprovalPolicyItem,
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqMember,
  HqOvertimeAssignedMember,
  HqPolicyAssignee,
  HqPolicyStep,
} from "@/lib/hq/types";
import { ApprovalLineEditor, AssigneeAvatar } from "./HqApprovalPolicySection";
import type { HqSettingsTab } from "./HqSettingsModal";

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function shortAvatarText(name: string): string {
  const clean = name.trim();
  if (clean.length >= 2) return clean.slice(-2);
  return clean || "HQ";
}

const AVATAR_PALETTE = [
  "#34d399",
  "#4ade80",
  "#eb7d66",
  "#9ba8cf",
  "#b57edc",
  "#38bdf8",
  "#fb923c",
];

const HOURLY_UNITS: {
  value: HqAnnualLeavePolicyItem["hourly_sub_unit"];
  recommended?: boolean;
}[] = [
  { value: "1분" },
  { value: "5분" },
  { value: "10분" },
  { value: "15분" },
  { value: "20분" },
  { value: "30분", recommended: true },
  { value: "1시간" },
  { value: "2시간" },
];

function formatKoreanStartDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return iso;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${
    weekdays[d.getDay()]
  })`;
}

function formatUsageUnitSummary(pol: HqAnnualLeavePolicyItem): string {
  if (pol.usage_unit_category === "시간") {
    return `${pol.hourly_sub_unit} 단위`;
  }
  if (pol.usage_unit_category === "반차") {
    return "반차 단위";
  }
  return "일 단위";
}

function formatAccrualRowSummary(pol: HqAnnualLeavePolicyItem): string {
  const p1 = pol.first_year_monthly_rule;
  const p2 =
    pol.accrual_basis === "회계일"
      ? `${pol.fiscal_month_day} 회계일 기준`
      : "입사일 기준";
  return `${p1} · ${p2}`;
}

function formatActualExpireSummary(
  point: string,
  grace: string,
  accrualBasis: "회계일" | "입사일",
  fiscalMonthDay: string
): string {
  if (point === "소멸 안 함") return "소멸 안 함 (이월 허용)";
  let base = point;
  if (
    point === "부여일로부터 1년 후" &&
    accrualBasis === "회계일" &&
    fiscalMonthDay === "1월 1일"
  ) {
    base = "부여일로부터 1년 후 (연말 12월 31일)";
  }
  if (grace && grace !== "유예기간 없음") {
    return `${base} + ${grace} 유예`;
  }
  return base;
}

/**
 * 모달 내 '승인 · 참조자 선택' 우측 미니 아바타 스택
 */
function AssigneePreviewStack({
  steps,
  ccList,
}: {
  steps: HqPolicyStep[];
  ccList: HqPolicyAssignee[];
}) {
  const stepAssignees = steps.flatMap((s) => s.assignees);
  const combined = [...stepAssignees, ...ccList];

  if (combined.length === 0) {
    return (
      <span className="text-xs font-semibold text-slate-400 flex items-center gap-1">
        <span>사용 안 함</span>
        <span className="text-slate-300">›</span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="flex items-center -space-x-1">
        {combined.slice(0, 5).map((item, idx) =>
          item.kind === "ROLE" ? (
            <span
              key={`${item.id}-${idx}`}
              title={item.name}
              className="w-6 h-6 rounded-lg bg-slate-200 border border-white text-slate-500 flex items-center justify-center text-[10px] font-bold"
            >
              👤
            </span>
          ) : (
            <span
              key={`${item.id}-${idx}`}
              title={item.name}
              style={{
                backgroundColor:
                  item.avatar_bg || AVATAR_PALETTE[idx % AVATAR_PALETTE.length],
              }}
              className="w-6 h-6 rounded-lg border border-white text-white text-[9px] font-extrabold flex items-center justify-center"
            >
              {shortAvatarText(item.name)}
            </span>
          )
        )}
      </span>
      <span className="text-slate-300 text-sm">›</span>
    </span>
  );
}

interface Props {
  settings: HqCompanySettings;
  members: HqMember[];
  canEdit: boolean;
  saving: boolean;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onNavigateTab: (tab: HqSettingsTab) => void;
}

export default function HqAnnualLeaveSettingsSection({
  settings,
  members,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: Props) {
  const ex = settings.extra_settings || {};

  const leaveSettings: HqAnnualLeaveGlobalSettings = ex.annual_leave_settings
    ? {
        ...DEFAULT_ANNUAL_LEAVE_SETTINGS,
        ...ex.annual_leave_settings,
        policies:
          ex.annual_leave_settings.policies &&
          ex.annual_leave_settings.policies.length > 0
            ? ex.annual_leave_settings.policies
            : DEFAULT_ANNUAL_LEAVE_SETTINGS.policies,
      }
    : DEFAULT_ANNUAL_LEAVE_SETTINGS;

  const approvalPolicies: HqApprovalPolicyItem[] =
    ex.approval_policies && ex.approval_policies.length > 0
      ? ex.approval_policies
      : DEFAULT_APPROVAL_POLICIES;

  const policyMap = useMemo(
    () => new Map(approvalPolicies.map((p) => [p.id, p])),
    [approvalPolicies]
  );

  // 기본 연차 정책은 실제 DB 재직 구성원도 자동 병합
  const resolvedPolicies = useMemo(() => {
    const activeDb = members.filter((m) => m.work_status === "재직");
    return leaveSettings.policies.map((pol) => {
      if (!pol.apply_all_default) return pol;
      const names = new Set(pol.assigned_members.map((m) => m.name));
      const added: HqOvertimeAssignedMember[] = [];
      activeDb.forEach((dbm, idx) => {
        if (!names.has(dbm.name)) {
          added.push({
            id: `lvm-db-${dbm.instructor_id}`,
            name: dbm.name,
            job_label:
              dbm.department && dbm.department !== "미지정"
                ? dbm.department
                : dbm.job_title,
            avatar_bg: AVATAR_PALETTE[idx % AVATAR_PALETTE.length],
            period_label: "입사일 - 퇴직일까지",
            status: "ACTIVE",
          });
        }
      });
      return added.length > 0
        ? { ...pol, assigned_members: [...pol.assigned_members, ...added] }
        : pol;
    });
  }, [leaveSettings.policies, members]);

  // 1) 연차 정책 편집/추가 모달 상태
  const [polDraft, setPolDraft] = useState<HqAnnualLeavePolicyItem | null>(
    null
  );
  const [isNewPol, setIsNewPol] = useState(false);
  const [hourlyMenuOpen, setHourlyMenuOpen] = useState(false);
  const [advanceMenuOpen, setAdvanceMenuOpen] = useState(false);

  // 중첩 모달 A: 연차 부여 방식 (145346~145419)
  const [accrualModalOpen, setAccrualModalOpen] = useState(false);
  const [previewHireDate, setPreviewHireDate] = useState("2026-11-16");
  const [editingStartDate, setEditingStartDate] = useState(false);
  const [editingBonusDays, setEditingBonusDays] = useState(false);

  // 중첩 모달 B: 자동 소멸 설정 (145455~145610)
  const [expireModalOpen, setExpireModalOpen] = useState(false);

  // 중첩 모달 C: 적용 구성원 보기
  const [memberViewerOpen, setMemberViewerOpen] = useState(false);

  // 2) 퇴직자 연차 조정 기준 설정 모달 (145213, 145223)
  const [retireeModalOpen, setRetireeModalOpen] = useState(false);
  const [retireeRuleDraft, setRetireeRuleDraft] = useState<
    HqAnnualLeaveGlobalSettings["retiree_adjustment_rule"]
  >(leaveSettings.retiree_adjustment_rule);

  // 3) 연차 촉진 설정 모달 (145234)
  const [promoModalOpen, setPromoModalOpen] = useState(false);
  const [promoDraft, setPromoDraft] = useState({
    promotion_remind_member: leaveSettings.promotion_remind_member,
    promotion_remind_admin: leaveSettings.promotion_remind_admin,
    promotion_plan_notify_timing: leaveSettings.promotion_plan_notify_timing,
    smart_annual_timing: leaveSettings.smart_annual_timing,
    smart_monthly_timing_1st: leaveSettings.smart_monthly_timing_1st,
    smart_monthly_timing_2nd: leaveSettings.smart_monthly_timing_2nd,
  });

  // 중첩 결재선 편집기 (연차 정책 또는 연차 사용 계획 결재선)
  const [lineTargetMode, setLineTargetMode] = useState<
    null | "POLICY" | "PROMOTION"
  >(null);
  const [lineCcDraft, setLineCcDraft] = useState<HqPolicyAssignee[]>([]);
  const [lineStepsDraft, setLineStepsDraft] = useState<HqPolicyStep[]>([]);
  const [lineAllowEditDraft, setLineAllowEditDraft] = useState(true);
  const [pickerTarget, setPickerTarget] = useState<
    null | { type: "CC" } | { type: "STEP"; stepIndex: number }
  >(null);
  const [pickerKeyword, setPickerKeyword] = useState("");

  // 연차 촉진용 결재선 드래프트 ('wf-leave-plan' 연동)
  const [promoCcDraft, setPromoCcDraft] = useState<HqPolicyAssignee[]>([]);
  const [promoStepsDraft, setPromoStepsDraft] = useState<HqPolicyStep[]>([]);

  // 후보 구성원 풀
  const candidateAssignees = useMemo(() => {
    const map = new Map<string, HqPolicyAssignee>();
    members
      .filter((m) => m.work_status === "재직")
      .forEach((m, idx) => {
        map.set(m.name, {
          id: `mem-${m.instructor_id}`,
          kind: "MEMBER",
          member_id: m.instructor_id,
          name: m.name,
          sub_label:
            m.department && m.department !== "미지정"
              ? m.department
              : m.job_title,
          avatar_bg: AVATAR_PALETTE[idx % AVATAR_PALETTE.length],
          notify_mode: "BOTH",
          step_action: "승인",
        });
      });
    [
      PRESET_ASSIGNEES.CHUN,
      PRESET_ASSIGNEES.KIM_GS,
      PRESET_ASSIGNEES.JO_WH,
      PRESET_ASSIGNEES.KIM_MS,
    ].forEach((p) => {
      if (!map.has(p.name)) map.set(p.name, { ...p });
    });
    return Array.from(map.values());
  }, [members]);

  // 연차 정책 모달 열기
  const openEditPolicyModal = (pol: HqAnnualLeavePolicyItem) => {
    const linked = policyMap.get(pol.policy_id);
    setPolDraft(JSON.parse(JSON.stringify(pol)));
    setIsNewPol(false);
    setHourlyMenuOpen(false);
    setAdvanceMenuOpen(false);
    setLineCcDraft(linked ? JSON.parse(JSON.stringify(linked.cc_list)) : []);
    setLineStepsDraft(linked ? JSON.parse(JSON.stringify(linked.steps)) : []);
    setLineAllowEditDraft(linked ? Boolean(linked.allow_edit) : true);
  };

  // + 연차 정책 추가 (145158.png 동일 기본값)
  const openCreatePolicyModal = () => {
    const newPolId = `lv-annual-${uid()}`;
    setPolDraft({
      ...JSON.parse(JSON.stringify(DEFAULT_ANNUAL_LEAVE_POLICY)),
      id: `alp-${uid()}`,
      policy_id: newPolId,
      name: "",
      description: "",
      is_default: false,
      usage_unit_category: "반차",
      smart_promotion_enabled: false,
      apply_all_default: false,
      assigned_members: [],
    });
    setIsNewPol(true);
    setHourlyMenuOpen(false);
    setAdvanceMenuOpen(false);
    setLineCcDraft([]);
    setLineStepsDraft([]);
    setLineAllowEditDraft(true);
  };

  // 연차 정책 저장
  const handleSavePolicy = async () => {
    if (!polDraft) return;
    if (!polDraft.name.trim()) {
      alert("연차 정책 이름을 입력해주세요.");
      return;
    }

    const cleanedSteps = lineStepsDraft
      .filter((s) => s.assignees.length > 0)
      .map((s, idx) => ({ ...s, step_order: idx + 1 }));

    const finalized: HqAnnualLeavePolicyItem = {
      ...polDraft,
      name: polDraft.name.trim(),
      description: polDraft.description.trim(),
      request_on_cancel:
        cleanedSteps.length > 0 ? polDraft.request_on_cancel : false,
    };

    const nextLeavePolicies = isNewPol
      ? [...resolvedPolicies, finalized]
      : resolvedPolicies.map((p) => (p.id === finalized.id ? finalized : p));

    let nextApprovalPolicies: HqApprovalPolicyItem[];
    if (policyMap.has(finalized.policy_id)) {
      nextApprovalPolicies = approvalPolicies.map((ap) =>
        ap.id === finalized.policy_id
          ? {
              ...ap,
              title: `연차 - ${finalized.name}`,
              allow_edit: lineAllowEditDraft,
              cc_list: lineCcDraft,
              steps: cleanedSteps,
            }
          : ap
      );
    } else {
      const createdAp: HqApprovalPolicyItem = {
        id: finalized.policy_id,
        category: "leave",
        title: `연차 - ${finalized.name}`,
        icon: "🏖️",
        allow_edit: lineAllowEditDraft,
        per_requester: false,
        cc_list: lineCcDraft,
        steps: cleanedSteps,
        mapped_doc_type: "LEAVE",
      };
      nextApprovalPolicies = [createdAp, ...approvalPolicies];
    }

    const primary =
      nextLeavePolicies.find((p) => p.is_default) || nextLeavePolicies[0];

    await onSaveExtra(
      {
        annual_leave_settings: {
          ...leaveSettings,
          policies: nextLeavePolicies,
        },
        approval_policies: nextApprovalPolicies,
        leave_basis:
          primary.accrual_basis === "회계일" ? "회계일 기준" : "입사일 기준",
        allow_hourly_leave: primary.usage_unit_category === "시간",
      },
      isNewPol
        ? `'${finalized.name}' 연차 정책이 추가되었습니다.`
        : `'${finalized.name}' 설정이 저장되었습니다.`
    );
    setPolDraft(null);
  };

  // 퇴직자 연차 조정 기준 저장
  const handleSaveRetireeRule = async () => {
    await onSaveExtra(
      {
        annual_leave_settings: {
          ...leaveSettings,
          retiree_adjustment_rule: retireeRuleDraft,
        },
      },
      "퇴직자 연차 조정 기준이 적용되었습니다."
    );
    setRetireeModalOpen(false);
  };

  // 연차 촉진 설정 모달 열기 & 저장
  const openPromotionModal = () => {
    const planPol = policyMap.get("wf-leave-plan");
    setPromoDraft({
      promotion_remind_member: leaveSettings.promotion_remind_member,
      promotion_remind_admin: leaveSettings.promotion_remind_admin,
      promotion_plan_notify_timing: leaveSettings.promotion_plan_notify_timing,
      smart_annual_timing: leaveSettings.smart_annual_timing,
      smart_monthly_timing_1st: leaveSettings.smart_monthly_timing_1st,
      smart_monthly_timing_2nd: leaveSettings.smart_monthly_timing_2nd,
    });
    setPromoCcDraft(planPol ? JSON.parse(JSON.stringify(planPol.cc_list)) : []);
    setPromoStepsDraft(
      planPol ? JSON.parse(JSON.stringify(planPol.steps)) : []
    );
    setPromoModalOpen(true);
  };

  const handleSavePromotionModal = async () => {
    const cleanedSteps = promoStepsDraft
      .filter((s) => s.assignees.length > 0)
      .map((s, idx) => ({ ...s, step_order: idx + 1 }));

    const nextAp = approvalPolicies.map((p) =>
      p.id === "wf-leave-plan"
        ? { ...p, cc_list: promoCcDraft, steps: cleanedSteps }
        : p
    );

    await onSaveExtra(
      {
        annual_leave_settings: {
          ...leaveSettings,
          ...promoDraft,
        },
        approval_policies: nextAp,
      },
      "연차 촉진 설정이 저장되었습니다."
    );
    setPromoModalOpen(false);
  };

  // 결재선 피커 선택 처리
  const handlePickAssignee = (picked: HqPolicyAssignee) => {
    if (!pickerTarget) return;
    const fresh: HqPolicyAssignee = {
      ...picked,
      id: `${picked.id}-${uid()}`,
      notify_mode: "BOTH",
      step_action: "승인",
    };

    const isPromo = lineTargetMode === "PROMOTION";
    const curCc = isPromo ? promoCcDraft : lineCcDraft;
    const setCc = isPromo ? setPromoCcDraft : setLineCcDraft;
    const curSteps = isPromo ? promoStepsDraft : lineStepsDraft;
    const setSteps = isPromo ? setPromoStepsDraft : setLineStepsDraft;

    if (pickerTarget.type === "CC") {
      if (!curCc.some((c) => c.name === fresh.name)) {
        setCc([...curCc, fresh]);
      }
    } else {
      const sIdx = pickerTarget.stepIndex;
      const base =
        curSteps.length > 0
          ? [...curSteps]
          : [{ step_order: 1, assignees: [] }];
      while (base.length <= sIdx) {
        base.push({ step_order: base.length + 1, assignees: [] });
      }
      if (!base[sIdx].assignees.some((a) => a.name === fresh.name)) {
        base[sIdx] = {
          ...base[sIdx],
          assignees: [...base[sIdx].assignees, fresh],
        };
      }
      setSteps(base);
    }
    setPickerTarget(null);
    setPickerKeyword("");
  };

  const accrualPreviewRows = useMemo(
    () => (polDraft ? buildAccrualPreviewRows(polDraft, previewHireDate) : []),
    [polDraft, previewHireDate]
  );

  const activeStepCountInDraft = lineStepsDraft.filter(
    (s) => s.assignees.length > 0
  ).length;
  const hasAnyAssigneeInDraft =
    activeStepCountInDraft > 0 || lineCcDraft.length > 0;

  return (
    <>
      <div className="space-y-8">
        <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
          연차 설정
        </h2>

        {/* 상단 구성원 휴가 조회 권한 안내 배너 (145125.png 동일) */}
        {!leaveSettings.hide_visibility_banner && (
          <div className="px-5 py-4 rounded-2xl bg-[#fffaf0] border border-amber-200/70 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="text-amber-500 text-base mt-0.5">⚠️</span>
              <div>
                <div className="text-xs font-extrabold text-amber-800">
                  &apos;구성원 휴가 조회 권한&apos; 을 확인해주세요.
                </div>
                <p className="text-[11px] text-amber-700/80 mt-0.5">
                  모든 구성원이 서로 무슨 휴가를 사용했는지 조회할 수 있도록 설정되어 있어요.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onSaveExtra(
                  {
                    annual_leave_settings: {
                      ...leaveSettings,
                      hide_visibility_banner: true,
                    },
                  },
                  "안내 배너가 숨김 처리되었습니다."
                )
              }
              className="px-3 py-1.5 rounded-lg bg-amber-100/80 hover:bg-amber-200/70 text-[11px] font-bold text-amber-900"
            >
              다시 보지 않기
            </button>
          </div>
        )}

        {/* =============================================================== */}
        {/* 섹션 1: 연차 정책 (4열 카드 + 연차 정책 추가 — 145125.png)         */}
        {/* =============================================================== */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[15px] font-extrabold text-slate-900">
              연차 정책
            </h3>

            {canEdit && (
              <button
                type="button"
                onClick={openCreatePolicyModal}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
              >
                <span className="text-[#00c458] font-extrabold text-sm leading-none">
                  +
                </span>
                <span>연차 정책 추가</span>
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {resolvedPolicies.map((pol) => {
              const linked = policyMap.get(pol.policy_id);
              const stepCnt = (linked?.steps || []).filter(
                (s) => s.assignees.length > 0
              ).length;
              const ccCnt = linked?.cc_list.length || 0;

              return (
                <div
                  key={pol.id}
                  onClick={() => openEditPolicyModal(pol)}
                  className="px-6 py-5 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all shadow-2xs cursor-pointer"
                >
                  {resolvedPolicies.length > 1 && (
                    <div className="mb-3 pb-2.5 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-extrabold text-slate-900">
                          🏖️ {pol.name}
                        </span>
                        {pol.is_default && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                            기본
                          </span>
                        )}
                      </div>
                      {!pol.is_default && canEdit && (
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (
                              !confirm(`'${pol.name}' 정책을 삭제하시겠습니까?`)
                            )
                              return;
                            await onSaveExtra(
                              {
                                annual_leave_settings: {
                                  ...leaveSettings,
                                  policies: resolvedPolicies.filter(
                                    (x) => x.id !== pol.id
                                  ),
                                },
                              },
                              `'${pol.name}' 정책이 삭제되었습니다.`
                            );
                          }}
                          className="text-[11px] font-bold text-slate-400 hover:text-rose-500"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {/* 1열: 부여 기준일 */}
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold">
                        부여 기준일
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-2">
                        <span className="text-sm font-extrabold text-slate-900">
                          {pol.accrual_basis}
                        </span>
                        {pol.accrual_basis === "회계일" && (
                          <span className="text-xs text-slate-400 font-medium">
                            {pol.fiscal_month_day}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 2열: 사용 단위 */}
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold">
                        사용 단위
                      </div>
                      <div className="mt-1.5 text-sm font-extrabold text-slate-900">
                        {formatUsageUnitSummary(pol)}
                      </div>
                    </div>

                    {/* 3열: 승인 · 참조 */}
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold">
                        승인 · 참조
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span
                          className={`text-sm font-bold ${
                            stepCnt > 0 ? "text-slate-900" : "text-slate-400"
                          }`}
                        >
                          {stepCnt > 0 ? `${stepCnt}단계` : "없음"}
                        </span>
                        {ccCnt > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-600 text-[11px] font-extrabold">
                            참조 {ccCnt}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 4열: 스마트 연차 촉진 */}
                    <div>
                      <div className="text-[11px] text-slate-400 font-semibold">
                        스마트 연차 촉진
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span
                          className={`text-sm font-extrabold ${
                            pol.smart_promotion_enabled
                              ? "text-slate-900"
                              : "text-slate-400"
                          }`}
                        >
                          {pol.smart_promotion_enabled ? "사용 중" : "사용 안 함"}
                        </span>
                        {pol.smart_promotion_enabled && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00c458]" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* =============================================================== */}
        {/* 섹션 2: 연차 설정 (퇴직자 연차 조정 기준 / 연차 촉진 설정)        */}
        {/* =============================================================== */}
        <section className="space-y-3">
          <h3 className="text-[15px] font-extrabold text-slate-900">
            연차 설정
          </h3>

          <div className="space-y-2.5">
            {/* 카드 1: 퇴직자 연차 조정 기준 설정 */}
            <button
              type="button"
              onClick={() => {
                setRetireeRuleDraft(leaveSettings.retiree_adjustment_rule);
                setRetireeModalOpen(true);
              }}
              className="w-full px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center justify-between gap-3 shadow-2xs text-left"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 text-slate-400 flex items-center justify-center text-sm shrink-0">
                  ⚖️
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-slate-900">
                    퇴직자 연차 조정 기준 설정
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    퇴직자 잔여 연차 조정 시, 부여량 기준을 선택하는 설정이에요.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 text-xs font-bold text-slate-700">
                <span>{leaveSettings.retiree_adjustment_rule}</span>
                <span className="text-slate-300 text-sm">›</span>
              </div>
            </button>

            {/* 카드 2: 연차 촉진 설정 */}
            <button
              type="button"
              onClick={openPromotionModal}
              className="w-full px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center justify-between gap-3 shadow-2xs text-left"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 text-slate-400 flex items-center justify-center text-sm shrink-0">
                  📅
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-slate-900">
                    연차 촉진 설정
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    구성원에게 연차 사용 촉진 시, 기본적으로 적용되는 설정이에요.
                  </p>
                </div>
              </div>

              <span className="text-slate-300 text-sm shrink-0">›</span>
            </button>
          </div>
        </section>

        {/* 하단 이전/다음 이동 카드 (145125.png 동일: 근무지 ← / → 맞춤 휴가) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("work-place")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">근무지</div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("custom-leave")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                맞춤 휴가
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 모달 1: 기본 연차 정책 / + 연차 정책 추가 (145137, 145142, 145158) */}
      {/* ================================================================= */}
      {polDraft && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[540px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            {/* 상단 우측: 사용중 [근식][동현][문수] +N명 + ✕ */}
            <div className="flex items-center justify-end gap-2.5 shrink-0">
              {!isNewPol && polDraft.assigned_members.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMemberViewerOpen(true)}
                  className="px-2 py-1 rounded-lg hover:bg-slate-100 flex items-center gap-1.5"
                >
                  <span className="text-[11px] text-slate-500 font-semibold">
                    사용중
                  </span>
                  <span className="flex items-center -space-x-1">
                    {polDraft.assigned_members.slice(0, 3).map((m, idx) => (
                      <span
                        key={`${m.id}-${idx}`}
                        style={{
                          backgroundColor:
                            m.avatar_bg ||
                            AVATAR_PALETTE[idx % AVATAR_PALETTE.length],
                        }}
                        className="w-5 h-5 rounded-md border border-white text-white text-[8px] font-extrabold flex items-center justify-center"
                      >
                        {shortAvatarText(m.name)}
                      </span>
                    ))}
                  </span>
                  {polDraft.assigned_members.length > 3 && (
                    <span className="text-[11px] text-slate-500 font-semibold">
                      +{polDraft.assigned_members.length - 3}명
                    </span>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => setPolDraft(null)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-6 mt-1">
              {/* 타이틀 + 설명 */}
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl text-slate-400">🏖️</span>
                  <input
                    autoFocus={isNewPol}
                    disabled={!canEdit}
                    value={polDraft.name}
                    onChange={(e) =>
                      setPolDraft({ ...polDraft, name: e.target.value })
                    }
                    placeholder="연차 정책 이름"
                    className="flex-1 text-xl font-extrabold text-slate-900 placeholder:text-slate-300 focus:outline-none"
                  />
                  {!isNewPol && (
                    <span className="text-slate-300 text-xs">✏️</span>
                  )}
                </div>
                <input
                  disabled={!canEdit}
                  value={polDraft.description}
                  onChange={(e) =>
                    setPolDraft({ ...polDraft, description: e.target.value })
                  }
                  placeholder="이 연차 정책에 대한 설명을 입력해주세요"
                  className="mt-2 w-full pb-1 border-b border-slate-200 text-xs text-slate-600 placeholder:text-slate-400 placeholder:underline focus:outline-none"
                />
              </div>

              {/* --------------------------------------------------------- */}
              {/* 그룹 1: 기본 설정                                         */}
              {/* --------------------------------------------------------- */}
              <div className="space-y-3">
                <div className="text-sm font-extrabold text-slate-900">
                  기본 설정
                </div>

                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {/* 1) 승인 · 참조자 선택 + 승인 요청 시점 */}
                  <div className="py-4 space-y-3">
                    <button
                      type="button"
                      onClick={() => setLineTargetMode("POLICY")}
                      className="w-full flex items-center justify-between gap-4 text-left hover:bg-slate-50/60 rounded-lg py-0.5 transition-colors"
                    >
                      <div>
                        <div className="font-bold text-slate-800 text-[13px]">
                          승인 · 참조자 선택
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          승인·참조 대상을 선택해 주세요.
                        </div>
                      </div>
                      <AssigneePreviewStack
                        steps={lineStepsDraft}
                        ccList={lineCcDraft}
                      />
                    </button>

                    {hasAnyAssigneeInDraft && (
                      <div className="rounded-xl border border-slate-200/80 p-4 space-y-3 bg-white">
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-bold">
                          <span className="text-[#00c458]">➤</span>
                          <span>승인 요청 시점</span>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="font-bold text-slate-800">
                              휴가를 등록할 때
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              구성원이 휴가를 등록할 때, 승인이 요청되고 취소 시에 알림을 받을 수 있어요.
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              setPolDraft({
                                ...polDraft,
                                request_on_register:
                                  !polDraft.request_on_register,
                              })
                            }
                            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                              polDraft.request_on_register
                                ? "bg-[#00c458]"
                                : "bg-slate-200"
                            }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                polDraft.request_on_register
                                  ? "translate-x-5"
                                  : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>

                        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-4">
                          <div>
                            <div className="font-bold text-slate-800">
                              등록한 휴가를 취소할 때
                            </div>
                            {activeStepCountInDraft === 0 ? (
                              <div className="text-[11px] text-amber-600 font-semibold mt-0.5">
                                참조 대상만 있는 경우에는 취소 승인을 설정할 수 없어요.
                              </div>
                            ) : (
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                등록한 휴가를 취소할 때, 승인자로부터 취소 승인을 받아야해요.
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={!canEdit || activeStepCountInDraft === 0}
                            onClick={() =>
                              setPolDraft({
                                ...polDraft,
                                request_on_cancel: !polDraft.request_on_cancel,
                              })
                            }
                            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                              polDraft.request_on_cancel &&
                              activeStepCountInDraft > 0
                                ? "bg-[#00c458]"
                                : "bg-slate-200"
                            }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                polDraft.request_on_cancel &&
                                activeStepCountInDraft > 0
                                  ? "translate-x-5"
                                  : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2) 연차 사용 단위 (시간 / 반차 / 일 + 시간 세부 단위 145316.png) */}
                  <div className="py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800 text-[13px]">
                        연차 사용 단위
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        연차의 사용 단위를 설정해 주세요.
                      </div>
                    </div>

                    <div className="w-full sm:w-52 space-y-2 relative">
                      <div className="grid grid-cols-3 p-0.5 rounded-xl bg-[#f5f6f8] border border-slate-200/70">
                        {(["시간", "반차", "일"] as const).map((cat) => {
                          const active = polDraft.usage_unit_category === cat;
                          return (
                            <button
                              key={cat}
                              type="button"
                              disabled={!canEdit}
                              onClick={() => {
                                setPolDraft({
                                  ...polDraft,
                                  usage_unit_category: cat,
                                });
                                setHourlyMenuOpen(false);
                              }}
                              className={`py-2 rounded-lg text-xs font-bold transition-all ${
                                active
                                  ? "bg-white text-slate-900 shadow-2xs"
                                  : "text-slate-400 hover:text-slate-700"
                              }`}
                            >
                              {cat}
                            </button>
                          );
                        })}
                      </div>

                      {polDraft.usage_unit_category === "시간" && (
                        <div className="relative">
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setHourlyMenuOpen((p) => !p)}
                            className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] hover:bg-slate-200/60 font-bold text-slate-800 flex items-center justify-between"
                          >
                            <span>{polDraft.hourly_sub_unit} 단위로 사용 가능</span>
                            <span className="text-slate-400 text-[10px]">▾</span>
                          </button>

                          {hourlyMenuOpen && (
                            <div className="absolute left-0 right-0 mt-1 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30">
                              {HOURLY_UNITS.map((u) => {
                                const selected =
                                  polDraft.hourly_sub_unit === u.value;
                                return (
                                  <button
                                    key={u.value}
                                    type="button"
                                    onClick={() => {
                                      setPolDraft({
                                        ...polDraft,
                                        hourly_sub_unit: u.value,
                                      });
                                      setHourlyMenuOpen(false);
                                    }}
                                    className={`w-full px-3.5 py-2 text-left flex items-center justify-between hover:bg-slate-50 ${
                                      selected ? "bg-slate-50 font-extrabold" : ""
                                    }`}
                                  >
                                    <span className="flex items-center gap-1.5">
                                      {selected && (
                                        <span className="text-[#00c458]">✓</span>
                                      )}
                                      <span className="text-slate-800">
                                        {u.value}
                                      </span>
                                      {u.recommended && (
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[#00c458] text-[10px] font-extrabold">
                                          추천
                                        </span>
                                      )}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 3) 당겨쓰기 설정 (145329.png 커스텀 팝오버) */}
                  <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
                    <div>
                      <div className="font-bold text-slate-800 text-[13px]">
                        당겨쓰기 설정
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        연차 초과 사용에 대한 설정을 할 수 있어요.
                      </div>
                    </div>

                    <div className="w-full sm:w-52 relative">
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => setAdvanceMenuOpen((p) => !p)}
                        className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] hover:bg-slate-200/60 font-bold text-slate-800 flex items-center justify-between"
                      >
                        <span>
                          {!polDraft.advance_use_enabled
                            ? "당겨쓰기 허용 안 함"
                            : polDraft.advance_use_mode === "자유롭게 사용 가능"
                            ? "자유롭게 사용 가능"
                            : `최대 ${polDraft.advance_use_limit_days || 3}일 제한`}
                        </span>
                        <span className="text-slate-400 text-[10px]">▾</span>
                      </button>

                      {advanceMenuOpen && (
                        <div className="absolute right-0 mt-1 w-60 rounded-xl bg-white border border-slate-200 shadow-2xl p-3.5 z-30 space-y-2.5">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                            <span className="font-bold text-slate-800">
                              당겨쓰기 허용
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setPolDraft({
                                  ...polDraft,
                                  advance_use_enabled:
                                    !polDraft.advance_use_enabled,
                                })
                              }
                              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                                polDraft.advance_use_enabled
                                  ? "bg-[#00c458]"
                                  : "bg-slate-200"
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${
                                  polDraft.advance_use_enabled
                                    ? "translate-x-4"
                                    : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>

                          {polDraft.advance_use_enabled && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setPolDraft({
                                    ...polDraft,
                                    advance_use_mode: "자유롭게 사용 가능",
                                  });
                                  setAdvanceMenuOpen(false);
                                }}
                                className="w-full py-1.5 text-left flex items-center justify-between font-bold text-slate-800 hover:text-[#00a84b]"
                              >
                                <span>자유롭게 사용 가능</span>
                                {polDraft.advance_use_mode ===
                                  "자유롭게 사용 가능" && (
                                  <span className="text-[#00c458]">✓</span>
                                )}
                              </button>

                              <div className="space-y-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPolDraft({
                                      ...polDraft,
                                      advance_use_mode: "사용량 제한",
                                    })
                                  }
                                  className="w-full py-1 text-left flex items-center justify-between font-bold text-slate-800 hover:text-[#00a84b]"
                                >
                                  <span>사용량 제한</span>
                                  {polDraft.advance_use_mode ===
                                    "사용량 제한" && (
                                    <span className="text-[#00c458]">✓</span>
                                  )}
                                </button>

                                {polDraft.advance_use_mode ===
                                  "사용량 제한" && (
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="number"
                                      min={1}
                                      max={30}
                                      value={
                                        polDraft.advance_use_limit_days || 3
                                      }
                                      onChange={(e) =>
                                        setPolDraft({
                                          ...polDraft,
                                          advance_use_limit_days: Number(
                                            e.target.value
                                          ),
                                        })
                                      }
                                      className="w-20 px-2.5 py-1 rounded-lg bg-slate-100 font-bold text-slate-900 focus:outline-none"
                                    />
                                    <span className="text-slate-500">
                                      일까지 허용
                                    </span>
                                  </div>
                                )}
                              </div>

                              <p className="pt-2 border-t border-slate-100 text-[10px] text-slate-400 leading-relaxed">
                                ⓘ 보유한 연차를 소진하였을 시, 다음 부여분에서 당겨쓸 수 있어요.
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* --------------------------------------------------------- */}
              {/* 그룹 2: 연차 부여 · 소멸 설정 (145142.png)                */}
              {/* --------------------------------------------------------- */}
              <div className="space-y-3">
                <div className="text-sm font-extrabold text-slate-900">
                  연차 부여 · 소멸 설정
                </div>

                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {/* 1) 연차 부여 방식 */}
                  <button
                    type="button"
                    onClick={() => setAccrualModalOpen(true)}
                    className="w-full py-4 flex items-center justify-between gap-4 text-left hover:bg-slate-50/60 transition-colors"
                  >
                    <div>
                      <div className="font-bold text-slate-800 text-[13px]">
                        연차 부여 방식
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        연차 부여 기준을 설정할 수 있어요.
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold max-w-[230px]">
                      <span className="truncate">
                        {formatAccrualRowSummary(polDraft)}
                      </span>
                      <span className="text-slate-300 text-sm shrink-0">›</span>
                    </div>
                  </button>

                  {/* 2) 자동 소멸 설정 */}
                  <button
                    type="button"
                    onClick={() => setExpireModalOpen(true)}
                    className="w-full py-4 flex items-center justify-between gap-4 text-left hover:bg-slate-50/60 transition-colors"
                  >
                    <div>
                      <div className="font-bold text-slate-800 text-[13px]">
                        자동 소멸 설정
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        자동 소멸 시점과 유예 기간을 설정할 수 있어요.
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                      <span>
                        {polDraft.annual_expire_point === "소멸 안 함" &&
                        polDraft.monthly_expire_point === "소멸 안 함"
                          ? "소멸 안 함"
                          : "연차 · 월차 설정됨"}
                      </span>
                      <span className="text-slate-300 text-sm">›</span>
                    </div>
                  </button>

                  {/* 3) 스마트 연차 촉진 */}
                  <div className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800 text-[13px]">
                        스마트 연차 촉진
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        구성원의 연차 사용 계획 작성을 자동으로 요청합니다.
                      </div>
                    </div>
                    <select
                      disabled={!canEdit}
                      value={
                        polDraft.smart_promotion_enabled ? "ON" : "OFF"
                      }
                      onChange={(e) =>
                        setPolDraft({
                          ...polDraft,
                          smart_promotion_enabled: e.target.value === "ON",
                        })
                      }
                      className="w-44 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                    >
                      <option value="ON">🟢 사용 중</option>
                      <option value="OFF">사용 안 함</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {canEdit && (
              <div className="pt-5 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSavePolicy}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:opacity-95 text-white text-xs font-extrabold shadow-md transition-opacity"
                >
                  {saving ? "저장 중..." : "저장하기"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 중첩 모달 A: 연차 부여 방식 (145346, 145353, 145412, 145419)       */}
      {/* ================================================================= */}
      {polDraft && accrualModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-[85] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[560px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            <div className="flex items-center justify-between shrink-0">
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                연차 부여 방식
              </h3>
              <div className="flex items-center gap-2">
                {editingStartDate ? (
                  <input
                    type="date"
                    value={polDraft.effective_start_date}
                    onChange={(e) => {
                      setPolDraft({
                        ...polDraft,
                        effective_start_date: e.target.value,
                      });
                      setEditingStartDate(false);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-emerald-300 text-[11px] font-bold text-emerald-700"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => canEdit && setEditingStartDate(true)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[#00a84b] text-[11px] font-extrabold"
                  >
                    📅 부여 시작일:{" "}
                    {formatKoreanStartDate(polDraft.effective_start_date)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAccrualModalOpen(false)}
                  className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-5 mt-4">
              {/* 회계일 / 입사일 세그먼트 탭 */}
              <div className="grid grid-cols-2 p-1 rounded-xl bg-[#f5f6f8] border border-slate-200/70">
                {(["회계일", "입사일"] as const).map((basis) => {
                  const active = polDraft.accrual_basis === basis;
                  return (
                    <button
                      key={basis}
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        setPolDraft({
                          ...polDraft,
                          accrual_basis: basis,
                          first_year_annual_rule:
                            basis === "회계일"
                              ? "첫 회계일에 근무한 기간의 연차 부여"
                              : "1년 만근시 15일 부여",
                        })
                      }
                      className={`py-2 rounded-lg text-xs font-extrabold transition-all ${
                        active
                          ? "bg-white text-slate-900 shadow-2xs"
                          : "text-slate-400 hover:text-slate-700"
                      }`}
                    >
                      {basis}
                    </button>
                  );
                })}
              </div>

              {/* 안내 박스 */}
              {polDraft.accrual_basis === "회계일" ? (
                <div className="rounded-xl bg-[#f8f9fa] p-4 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-extrabold text-slate-800">
                    <span className="px-1.5 py-0.5 rounded bg-blue-500 text-white text-[10px]">
                      안내
                    </span>
                    <span>
                      연차가 일괄 부여되니 부여, 촉진 등의 관리가 쉬울 수 있어요.
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    단, 취업규칙에 회계 연도 기준으로 연차를 부여한다는 규정이 명시되어 있어야 하고, 구성원의 퇴직시에는 입사일 부여 기준으로 다시 계산하여 정산이 필요한 점을 참고해 주세요.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl bg-[#f8f9fa] p-4 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-extrabold text-slate-800">
                    <span className="px-1.5 py-0.5 rounded bg-blue-500 text-white text-[10px]">
                      안내
                    </span>
                    <span>입사하는 날을 기준으로 연차가 자동 부여돼요.</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    구성원마다 부여일, 촉진 시점이 모두 달라서 복잡할 수 있지만, 구성원의 입사일에 맞춰 연차 자동 부여, 자동 촉진이 가능해요.
                  </p>
                </div>
              )}

              {/* 회계일 선택 (회계일 탭일 때만) */}
              {polDraft.accrual_basis === "회계일" && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    회계일
                  </label>
                  <select
                    disabled={!canEdit}
                    value={polDraft.fiscal_month_day}
                    onChange={(e) =>
                      setPolDraft({
                        ...polDraft,
                        fiscal_month_day: e.target.value,
                      })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                  >
                    {FISCAL_DATE_OPTIONS.map((fd) => (
                      <option key={fd} value={fd}>
                        {fd}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 입사자 월차 & 1년 만근 연차 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    입사자 월차
                  </label>
                  <select
                    disabled={!canEdit}
                    value={polDraft.first_year_monthly_rule}
                    onChange={(e) =>
                      setPolDraft({
                        ...polDraft,
                        first_year_monthly_rule:
                          e.target.value as HqAnnualLeavePolicyItem["first_year_monthly_rule"],
                      })
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                  >
                    <option value="매월 개근시 1일 부여">
                      매월 개근시 1일 부여
                    </option>
                    <option value="입사 시 11일 선부여">
                      입사 시 11일 선부여
                    </option>
                    <option value="부여 안 함">부여 안 함</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    입사자 1년 만근 연차
                  </label>
                  <select
                    disabled={!canEdit}
                    value={polDraft.first_year_annual_rule}
                    onChange={(e) =>
                      setPolDraft({
                        ...polDraft,
                        first_year_annual_rule:
                          e.target.value as HqAnnualLeavePolicyItem["first_year_annual_rule"],
                      })
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                  >
                    {polDraft.accrual_basis === "회계일" ? (
                      <>
                        <option value="첫 회계일에 근무한 기간의 연차 부여">
                          첫 회계일에 근무한 기간의 연차 부여
                        </option>
                        <option value="1년 만근시 15일 부여">
                          1년 만근시 15일 부여
                        </option>
                      </>
                    ) : (
                      <option value="1년 만근시 15일 부여">
                        1년 만근시 15일 부여
                      </option>
                    )}
                  </select>
                </div>
              </div>

              {/* 소수점 이하 연차 (회계일 비례 부여 시) */}
              {polDraft.accrual_basis === "회계일" && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    소수점 이하 연차
                  </label>
                  <select
                    disabled={!canEdit}
                    value={polDraft.decimal_rounding}
                    onChange={(e) =>
                      setPolDraft({
                        ...polDraft,
                        decimal_rounding:
                          e.target.value as HqAnnualLeavePolicyItem["decimal_rounding"],
                      })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                  >
                    <option value="일 단위 올림 처리">일 단위 올림 처리</option>
                    <option value="0.5일 단위 올림 처리">
                      0.5일 단위 올림 처리
                    </option>
                    <option value="시간 단위로 비례 부여">
                      시간 단위로 비례 부여
                    </option>
                    <option value="소수점 둘째 자리 반올림">
                      소수점 둘째 자리 반올림
                    </option>
                  </select>
                  <div className="mt-1.5 text-[11px] text-slate-400">
                    부여 시작일을 기준으로 반영돼요.{" "}
                    <button
                      type="button"
                      onClick={() => canEdit && setEditingStartDate(true)}
                      className="underline font-semibold text-slate-600"
                    >
                      변경하기
                    </button>
                  </div>
                </div>
              )}

              {/* 추가 부여 / 그룹 입사일 옵션 */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                <div className="flex flex-wrap items-center gap-2">
                  <span>ⓘ 법적으로 정해진 연차 외에 추가 부여가 필요한가요?</span>
                  {editingBonusDays ? (
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={polDraft.extra_bonus_days}
                        onChange={(e) =>
                          setPolDraft({
                            ...polDraft,
                            extra_bonus_days: Number(e.target.value),
                          })
                        }
                        className="w-14 px-2 py-0.5 rounded border border-slate-300 font-bold text-slate-800"
                      />
                      <span>일 추가</span>
                      <button
                        type="button"
                        onClick={() => setEditingBonusDays(false)}
                        className="text-blue-600 font-bold ml-1"
                      >
                        확인
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => canEdit && setEditingBonusDays(true)}
                      className="underline font-bold text-slate-700"
                    >
                      {polDraft.extra_bonus_days > 0
                        ? `+${polDraft.extra_bonus_days}일 추가 부여 중`
                        : "연차 추가 부여하기"}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span>ⓘ 그룹 입사일이 설정된 구성원이 있나요?</span>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() =>
                      setPolDraft({
                        ...polDraft,
                        use_group_hire_date: !polDraft.use_group_hire_date,
                      })
                    }
                    className="underline font-bold text-blue-600"
                  >
                    {polDraft.use_group_hire_date
                      ? "그룹 입사일로 설정됨"
                      : "회사 입사일로 설정됨"}
                  </button>
                </div>
              </div>

              {/* 연차 자동 부여 미리보기 테이블 (145353.png & 145419.png 동일) */}
              <div className="pt-2 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="font-extrabold text-slate-900 text-xs">
                    연차 자동 부여 미리보기
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span>시뮬레이션 입사일:</span>
                    <input
                      type="date"
                      value={previewHireDate}
                      onChange={(e) => setPreviewHireDate(e.target.value)}
                      className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 font-bold text-slate-800"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-[#fafafa] border-b border-slate-200 text-[11px] text-slate-500">
                      <tr>
                        <th className="py-2.5 px-3.5 text-left font-bold">
                          미리보기 날짜
                        </th>
                        <th className="py-2.5 px-3 text-center font-bold">
                          월차 (입사 1년 미만)
                        </th>
                        <th className="py-2.5 px-3 text-center font-bold">
                          연차
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {accrualPreviewRows.map((row, idx) => (
                        <tr key={`${row.dateLabel}-${idx}`}>
                          <td className="py-2.5 px-3.5 font-semibold text-slate-800">
                            <span className="inline-flex items-center gap-1.5">
                              <span>{row.dateLabel}</span>
                              {row.badgeText && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                                    row.badgeVariant === "blue"
                                      ? "bg-blue-500 text-white"
                                      : "bg-blue-50 text-blue-600"
                                  }`}
                                >
                                  {row.badgeText}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center text-slate-700 font-semibold">
                            {row.monthlyText}
                          </td>
                          <td className="py-2.5 px-3 text-center font-bold text-slate-800">
                            {row.annualRawText && (
                              <div className="text-[10px] text-slate-400 line-through font-normal">
                                {row.annualRawText}
                              </div>
                            )}
                            <div>{row.annualText}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="pt-4 shrink-0">
              <button
                type="button"
                onClick={() => setAccrualModalOpen(false)}
                className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold"
              >
                설정 확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 중첩 모달 B: 자동 소멸 설정 — 연말 소멸·유예·이월 모두 선택 가능  */}
      {/* ================================================================= */}
      {polDraft && expireModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-[85] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[520px] max-h-[88vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            <div className="flex items-center justify-between shrink-0">
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                자동 소멸 설정
              </h3>
              <button
                type="button"
                onClick={() => setExpireModalOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-6 mt-4">
              {/* 상단 미리보기 요약 표 (145455.png 동일) */}
              <div className="rounded-xl border border-slate-200 p-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[11px] text-slate-400">
                      <th className="pb-2.5 text-left font-bold">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                          미리보기
                        </span>
                      </th>
                      <th className="pb-2.5 text-center font-bold">월차</th>
                      <th className="pb-2.5 text-center font-bold">연차</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="py-3 text-slate-500 font-semibold">
                        법정 소멸일
                      </td>
                      <td className="py-3 text-center font-bold text-slate-800">
                        입사일로부터 1년 후
                      </td>
                      <td className="py-3 text-center font-bold text-slate-800">
                        부여일로부터 1년 후
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 text-slate-500 font-semibold">
                        실제 소멸일
                      </td>
                      <td className="py-3 text-center font-extrabold text-slate-900">
                        {formatActualExpireSummary(
                          polDraft.monthly_expire_point,
                          polDraft.monthly_grace_period,
                          polDraft.accrual_basis,
                          polDraft.fiscal_month_day
                        )}
                      </td>
                      <td className="py-3 text-center font-extrabold text-emerald-700">
                        {formatActualExpireSummary(
                          polDraft.annual_expire_point,
                          polDraft.annual_grace_period,
                          polDraft.accrual_basis,
                          polDraft.fiscal_month_day
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 월차 소멸 설정 */}
              <div className="space-y-3.5">
                <div className="text-sm font-extrabold text-slate-900">
                  월차
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-slate-800">
                      자동 소멸 시점
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      선택한 시점에 월차가 자동 소멸되도록 설정합니다.
                    </div>
                  </div>
                  <select
                    disabled={!canEdit}
                    value={polDraft.monthly_expire_point}
                    onChange={(e) =>
                      setPolDraft({
                        ...polDraft,
                        monthly_expire_point:
                          e.target.value as HqAnnualLeavePolicyItem["monthly_expire_point"],
                      })
                    }
                    className="w-52 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                  >
                    <option value="입사일로부터 1년 후">
                      🟢 입사일로부터 1년 후
                    </option>
                    <option value="당해 연말 (매년 12월 31일)">
                      당해 연말 (매년 12월 31일)
                    </option>
                    <option value="첫 회계일 후 1년">첫 회계일 후 1년</option>
                    <option value="소멸 안 함">소멸 안 함 (이월)</option>
                  </select>
                </div>

                {polDraft.monthly_expire_point !== "소멸 안 함" && (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800">
                        소멸 유예 기간
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        자동 소멸을 유예할 기간을 설정합니다.
                      </div>
                    </div>
                    <select
                      disabled={!canEdit}
                      value={polDraft.monthly_grace_period}
                      onChange={(e) =>
                        setPolDraft({
                          ...polDraft,
                          monthly_grace_period: e.target.value,
                        })
                      }
                      className="w-52 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                    >
                      {GRACE_PERIOD_OPTIONS.map((gp) => (
                        <option key={gp} value={gp}>
                          {gp}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* 연차 소멸 설정 (연말까지 모두 사용 유도 / 유예 / 이월 모두 선택 가능) */}
              <div className="pt-4 border-t border-slate-100 space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-extrabold text-slate-900">
                    연차
                  </span>
                  {polDraft.accrual_basis === "회계일" &&
                    polDraft.fiscal_month_day === "1월 1일" &&
                    polDraft.annual_expire_point !== "소멸 안 함" &&
                    polDraft.annual_grace_period === "유예기간 없음" && (
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-[#00a84b] text-[10px] font-extrabold">
                        연말(12월 31일) 전량 소진 기준 적용 중
                      </span>
                    )}
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-slate-800">
                      자동 소멸 시점
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      선택한 시점에 연차가 자동 소멸되도록 설정합니다.
                    </div>
                  </div>
                  <select
                    disabled={!canEdit}
                    value={polDraft.annual_expire_point}
                    onChange={(e) =>
                      setPolDraft({
                        ...polDraft,
                        annual_expire_point:
                          e.target.value as HqAnnualLeavePolicyItem["annual_expire_point"],
                      })
                    }
                    className="w-52 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                  >
                    <option value="부여일로부터 1년 후">
                      🟢 부여일로부터 1년 후
                    </option>
                    <option value="당해 연말 (매년 12월 31일)">
                      당해 연말 (매년 12월 31일)
                    </option>
                    <option value="소멸 안 함">소멸 안 함 (이월 허용)</option>
                  </select>
                </div>

                {polDraft.annual_expire_point !== "소멸 안 함" && (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800">
                        소멸 유예 기간
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        자동 소멸을 유예할 기간을 설정합니다.
                      </div>
                    </div>
                    <select
                      disabled={!canEdit}
                      value={polDraft.annual_grace_period}
                      onChange={(e) =>
                        setPolDraft({
                          ...polDraft,
                          annual_grace_period: e.target.value,
                        })
                      }
                      className="w-52 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                    >
                      {GRACE_PERIOD_OPTIONS.map((gp) => (
                        <option key={gp} value={gp}>
                          {gp}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 shrink-0">
              <button
                type="button"
                onClick={() => setExpireModalOpen(false)}
                className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold"
              >
                설정 확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 중첩 모달 C: 적용 구성원 보기                                     */}
      {/* ================================================================= */}
      {polDraft && memberViewerOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-[85] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[420px] max-h-[82vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-6 text-xs">
            <div className="flex items-center justify-between shrink-0">
              <h4 className="text-lg font-extrabold text-slate-900">
                연차 정책 적용 구성원 ({polDraft.assigned_members.length}명)
              </h4>
              <button
                type="button"
                onClick={() => setMemberViewerOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll divide-y divide-slate-100 mt-3 pr-0.5">
              {polDraft.assigned_members.map((m, idx) => (
                <div
                  key={`${m.id}-${idx}`}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <span
                      style={{
                        backgroundColor:
                          m.avatar_bg ||
                          AVATAR_PALETTE[idx % AVATAR_PALETTE.length],
                      }}
                      className="w-8 h-8 rounded-xl text-white text-[11px] font-extrabold flex items-center justify-center"
                    >
                      {shortAvatarText(m.name)}
                    </span>
                    <div>
                      <div className="font-bold text-slate-900">{m.name}</div>
                      {m.job_label && (
                        <div className="text-[11px] text-slate-400">
                          {m.job_label}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {m.period_label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 2: 퇴직자 연차 조정 기준 설정 (145213.png & 145223.png)      */}
      {/* ================================================================= */}
      {retireeModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[490px] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs space-y-5">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setRetireeModalOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <h3 className="text-xl font-extrabold text-slate-900 tracking-tight -mt-2">
              퇴직자 연차 조정 기준 설정
            </h3>

            <div className="space-y-2.5">
              <div>
                <div className="text-[13px] font-bold text-slate-900">
                  조정 기준
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  퇴직자 잔여 연차 조정 시, 필요한 기준을 설정합니다.
                </p>
              </div>

              {/* 옵션 1 */}
              <button
                type="button"
                disabled={!canEdit}
                onClick={() =>
                  setRetireeRuleDraft("구성원에게 유리한 기준으로 적용")
                }
                className={`w-full p-4 rounded-xl border text-left flex items-center justify-between gap-3 transition-all ${
                  retireeRuleDraft === "구성원에게 유리한 기준으로 적용"
                    ? "border-[#00c458] bg-emerald-50/20"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-slate-900">
                      구성원에게 유리한 기준으로 적용
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[#00c458] text-[10px] font-extrabold">
                      기본
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    근로기준법 기준과 실제 회사 부여량 중, 더 큰 값을 기준으로 조정합니다.
                  </div>
                </div>
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center border shrink-0 ${
                    retireeRuleDraft === "구성원에게 유리한 기준으로 적용"
                      ? "bg-[#00c458] border-[#00c458]"
                      : "border-slate-300 bg-white"
                  }`}
                >
                  {retireeRuleDraft === "구성원에게 유리한 기준으로 적용" && (
                    <span className="w-2 h-2 rounded-full bg-white" />
                  )}
                </span>
              </button>

              {/* 옵션 2 */}
              <button
                type="button"
                disabled={!canEdit}
                onClick={() =>
                  setRetireeRuleDraft("항상 근로기준법 기준으로 적용")
                }
                className={`w-full p-4 rounded-xl border text-left flex items-center justify-between gap-3 transition-all ${
                  retireeRuleDraft === "항상 근로기준법 기준으로 적용"
                    ? "border-[#00c458] bg-emerald-50/20"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div>
                  <div className="text-[13px] font-bold text-slate-900">
                    항상 근로기준법 기준으로 적용
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    실제 회사 부여량이 더 많을 때도, 근로기준법 기준으로 조정합니다.
                  </div>
                </div>
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center border shrink-0 ${
                    retireeRuleDraft === "항상 근로기준법 기준으로 적용"
                      ? "bg-[#00c458] border-[#00c458]"
                      : "border-slate-300 bg-white"
                  }`}
                >
                  {retireeRuleDraft === "항상 근로기준법 기준으로 적용" && (
                    <span className="w-2 h-2 rounded-full bg-white" />
                  )}
                </span>
              </button>
            </div>

            {/* 예시 비교 테이블 (145213 vs 145223 실시간 반영) */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2 bg-[#fafafa] border-b border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-bold">
                <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px]">
                  예시
                </span>
                <span>조정 기준</span>
                <span />
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] text-slate-400">
                    <th className="py-2.5 px-4 text-left font-semibold">
                      구성원
                    </th>
                    <th className="py-2.5 px-3 text-right font-semibold">
                      근로기준법 기준 부여량
                    </th>
                    <th className="py-2.5 px-4 text-right font-semibold">
                      실제 회사 부여량
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-2.5 px-4 font-bold text-slate-800">
                      🟡 김연차
                    </td>
                    <td className="py-2.5 px-3 text-right bg-emerald-50/70 font-extrabold text-[#00a84b]">
                      ✓ 15일
                    </td>
                    <td className="py-2.5 px-4 text-right font-semibold text-slate-700">
                      10일
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-bold text-slate-800">
                      ⚪ 김조정
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right ${
                        retireeRuleDraft === "항상 근로기준법 기준으로 적용"
                          ? "bg-emerald-50/70 font-extrabold text-[#00a84b]"
                          : "font-semibold text-slate-700"
                      }`}
                    >
                      {retireeRuleDraft === "항상 근로기준법 기준으로 적용"
                        ? "✓ 15일"
                        : "15일"}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right ${
                        retireeRuleDraft === "구성원에게 유리한 기준으로 적용"
                          ? "bg-emerald-50/70 font-extrabold text-[#00a84b]"
                          : "font-semibold text-slate-700"
                      }`}
                    >
                      {retireeRuleDraft === "구성원에게 유리한 기준으로 적용"
                        ? "✓ 20일"
                        : "20일"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {canEdit && (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveRetireeRule}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:opacity-95 text-white text-xs font-extrabold shadow-md"
              >
                {saving ? "저장 중..." : "변경 사항 적용하기"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 3: 연차 촉진 설정 (145234.png 동일)                          */}
      {/* ================================================================= */}
      {promoModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[510px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            <div className="flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setPromoModalOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-6">
              <div>
                <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  연차 촉진 설정
                </h3>
                <p className="text-slate-400 mt-1">
                  구성원에게 연차 사용 촉진 시, 기본적으로 적용되는 설정이에요.
                </p>
              </div>

              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {/* 승인 · 참조 대상 */}
                <button
                  type="button"
                  onClick={() => setLineTargetMode("PROMOTION")}
                  className="w-full py-4 flex items-center justify-between gap-4 text-left hover:bg-slate-50/60"
                >
                  <div>
                    <div className="font-bold text-slate-800 text-[13px]">
                      승인 · 참조 대상
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      구성원이 작성한 연차 사용 계획의 승인 · 참조 대상을 설정할 수 있어요.
                    </div>
                  </div>
                  <AssigneePreviewStack
                    steps={promoStepsDraft}
                    ccList={promoCcDraft}
                  />
                </button>

                {/* 구성원 작성 리마인드 */}
                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-slate-800 text-[13px]">
                      구성원 작성 리마인드
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      구성원에게 사용 계획 작성 알림을 제출 기한 동안 매일 보내요.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() =>
                      setPromoDraft({
                        ...promoDraft,
                        promotion_remind_member:
                          !promoDraft.promotion_remind_member,
                      })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                      promoDraft.promotion_remind_member
                        ? "bg-[#00c458]"
                        : "bg-slate-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                        promoDraft.promotion_remind_member
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* 관리자 작성 리마인드 */}
                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-slate-800 text-[13px]">
                      관리자 작성 리마인드
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      관리자에게 사용 계획 작성 알림을 제출 기한 동안 매일 보내요.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() =>
                      setPromoDraft({
                        ...promoDraft,
                        promotion_remind_admin:
                          !promoDraft.promotion_remind_admin,
                      })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                      promoDraft.promotion_remind_admin
                        ? "bg-[#00c458]"
                        : "bg-slate-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                        promoDraft.promotion_remind_admin
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* 사용 계획일 알림 시점 */}
                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-slate-800 text-[13px]">
                      사용 계획일 알림 시점
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      구성원에게 사용 계획일 이전에 알림을 보내요.
                    </div>
                  </div>
                  <select
                    disabled={!canEdit}
                    value={promoDraft.promotion_plan_notify_timing}
                    onChange={(e) =>
                      setPromoDraft({
                        ...promoDraft,
                        promotion_plan_notify_timing: e.target.value,
                      })
                    }
                    className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                  >
                    <option value="사용 계획일 10일 전">사용 계획일 10일 전</option>
                    <option value="사용 계획일 7일 전">사용 계획일 7일 전</option>
                    <option value="사용 계획일 5일 전">사용 계획일 5일 전</option>
                    <option value="사용 계획일 3일 전">사용 계획일 3일 전</option>
                    <option value="사용 계획일 1일 전">사용 계획일 1일 전</option>
                    <option value="알림 안 함">알림 안 함</option>
                  </select>
                </div>
              </div>

              {/* 스마트 연차 촉진 섹션 */}
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-extrabold text-slate-900">
                    스마트 연차 촉진
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    스마트 연차 촉진 사용 시, 근로기준법을 준수한 연차 촉진을 자동화할 수 있어요.
                  </p>
                </div>

                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  <div className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800">
                        연차 촉진 시점
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        1년 이상 재직 구성원의 자동 촉진 시점
                      </div>
                    </div>
                    <select
                      disabled={!canEdit}
                      value={promoDraft.smart_annual_timing}
                      onChange={(e) =>
                        setPromoDraft({
                          ...promoDraft,
                          smart_annual_timing: e.target.value,
                        })
                      }
                      className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                    >
                      <option value="소멸 6개월 전 + 10일 후">
                        소멸 6개월 전 + 10일 후
                      </option>
                      <option value="소멸 6개월 전 + 2개월 전">
                        소멸 6개월 전 + 2개월 전
                      </option>
                      <option value="매년 7월 1일 (연말 소멸 기준)">
                        매년 7월 1일 (연말 소멸 기준)
                      </option>
                    </select>
                  </div>

                  <div className="py-4 flex items-start justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800">
                        월차 촉진 시점
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        1년 미만 재직 구성원의 자동 촉진 시점
                      </div>
                    </div>

                    <div className="w-48 space-y-2">
                      <div className="px-3 py-2 rounded-xl bg-[#f5f6f8] flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-bold text-slate-500">
                          1차
                        </span>
                        <select
                          disabled={!canEdit}
                          value={promoDraft.smart_monthly_timing_1st}
                          onChange={(e) =>
                            setPromoDraft({
                              ...promoDraft,
                              smart_monthly_timing_1st: e.target.value,
                            })
                          }
                          className="flex-1 bg-transparent font-bold text-slate-800 focus:outline-none"
                        >
                          <option value="소멸 3개월 전">소멸 3개월 전</option>
                          <option value="소멸 4개월 전">소멸 4개월 전</option>
                        </select>
                      </div>

                      <div className="px-3 py-2 rounded-xl bg-[#f5f6f8] flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-bold text-slate-500">
                          2차
                        </span>
                        <select
                          disabled={!canEdit}
                          value={promoDraft.smart_monthly_timing_2nd}
                          onChange={(e) =>
                            setPromoDraft({
                              ...promoDraft,
                              smart_monthly_timing_2nd: e.target.value,
                            })
                          }
                          className="flex-1 bg-transparent font-bold text-slate-800 focus:outline-none"
                        >
                          <option value="소멸 1개월 전">소멸 1개월 전</option>
                          <option value="소멸 2개월 전">소멸 2개월 전</option>
                          <option value="소멸 10일 전">소멸 10일 전</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400">
                  ⓘ 스마트 연차 촉진은 소멸 유예 설정과 관계없이 법정 연차 소멸일을 기준으로 실행됩니다.
                </p>
              </div>
            </div>

            {canEdit && (
              <div className="pt-5 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSavePromotionModal}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:opacity-95 text-white text-xs font-extrabold shadow-md"
                >
                  {saving ? "저장 중..." : "변경 사항 저장"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 공통 중첩 모달: 승인 · 참조자 선택                                */}
      {/* ================================================================= */}
      {lineTargetMode && (
        <div className="fixed inset-0 bg-slate-900/50 z-[90] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] max-h-[85vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-6 text-xs">
            <div className="flex items-center justify-between shrink-0">
              <span className="px-2.5 py-1 rounded-md border border-slate-200 text-[11px] font-bold text-slate-700">
                승인 · 참조
              </span>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      if (lineTargetMode === "PROMOTION") {
                        setPromoCcDraft([]);
                        setPromoStepsDraft([]);
                      } else {
                        setLineCcDraft([]);
                        setLineStepsDraft([]);
                      }
                    }}
                    className="text-[11px] font-bold text-rose-500 hover:underline"
                  >
                    사용 안 함(초기화)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setLineTargetMode(null)}
                  className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="mt-3 shrink-0">
              <h4 className="text-lg font-extrabold text-slate-900">
                {lineTargetMode === "PROMOTION"
                  ? "연차 사용 계획"
                  : polDraft?.name || "연차 정책"}
              </h4>
            </div>

            <div className="mt-5 flex-1 overflow-y-auto custom-scroll pr-0.5">
              <ApprovalLineEditor
                ccList={
                  lineTargetMode === "PROMOTION" ? promoCcDraft : lineCcDraft
                }
                steps={
                  lineTargetMode === "PROMOTION"
                    ? promoStepsDraft
                    : lineStepsDraft
                }
                canEdit={canEdit}
                customLabels={ex.approval_labels || []}
                onChangeCc={
                  lineTargetMode === "PROMOTION"
                    ? setPromoCcDraft
                    : setLineCcDraft
                }
                onChangeSteps={
                  lineTargetMode === "PROMOTION"
                    ? setPromoStepsDraft
                    : setLineStepsDraft
                }
                onOpenPicker={(target) => setPickerTarget(target)}
              />
            </div>

            <div className="pt-5 shrink-0">
              <button
                type="button"
                onClick={() => setLineTargetMode(null)}
                className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold"
              >
                선택 완료
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 승인자/참조자 피커 */}
      {pickerTarget && (
        <div className="fixed inset-0 bg-slate-900/40 z-[95] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[72vh] text-xs">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900">
                {pickerTarget.type === "CC"
                  ? "참조 대상 추가"
                  : `${pickerTarget.stepIndex + 1}단계 승인자 추가`}
              </h4>
              <button
                type="button"
                onClick={() => setPickerTarget(null)}
                className="text-slate-400 hover:text-slate-700 text-base"
              >
                ✕
              </button>
            </div>

            <div className="p-3 border-b border-slate-100">
              <input
                autoFocus
                value={pickerKeyword}
                onChange={(e) => setPickerKeyword(e.target.value)}
                placeholder="구성원 이름·부서 또는 조직장 검색..."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs focus:outline-none"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scroll">
              <div>
                <div className="px-2 mb-1.5 text-[10px] font-bold text-slate-400">
                  조직 · 역할 기준 자동 지정
                </div>
                <div className="space-y-1">
                  {[
                    PRESET_ASSIGNEES.ORG_HEAD_1,
                    PRESET_ASSIGNEES.ORG_HEAD_2,
                    PRESET_ASSIGNEES.HR_MANAGER,
                  ]
                    .filter((r) =>
                      pickerKeyword.trim()
                        ? r.name.includes(pickerKeyword.trim())
                        : true
                    )
                    .map((roleItem) => (
                      <button
                        key={roleItem.id}
                        type="button"
                        onClick={() => handlePickAssignee(roleItem)}
                        className="w-full px-2.5 py-2 rounded-xl hover:bg-slate-50 flex items-center gap-2.5 text-left"
                      >
                        <AssigneeAvatar item={roleItem} />
                        <div>
                          <div className="font-bold text-slate-900">
                            {roleItem.name}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {roleItem.sub_label}
                          </div>
                        </div>
                      </button>
                    ))}
                </div>
              </div>

              <div>
                <div className="px-2 mb-1.5 text-[10px] font-bold text-slate-400">
                  특정 구성원 지정
                </div>
                <div className="space-y-1">
                  {candidateAssignees
                    .filter((m) =>
                      pickerKeyword.trim()
                        ? `${m.name} ${m.sub_label || ""}`
                            .toLowerCase()
                            .includes(pickerKeyword.trim().toLowerCase())
                        : true
                    )
                    .map((memItem) => (
                      <button
                        key={memItem.id}
                        type="button"
                        onClick={() => handlePickAssignee(memItem)}
                        className="w-full px-2.5 py-2 rounded-xl hover:bg-slate-50 flex items-center gap-2.5 text-left"
                      >
                        <AssigneeAvatar item={memItem} />
                        <div>
                          <div className="font-bold text-slate-900">
                            {memItem.name}
                          </div>
                          {memItem.sub_label && (
                            <div className="text-[11px] text-slate-400">
                              {memItem.sub_label}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
