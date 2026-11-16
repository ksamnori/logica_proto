// src/components/hq/settings/HqCustomLeaveSettingsSection.tsx
"use client";

import React, { useMemo, useState } from "react";
import {
  DEFAULT_APPROVAL_POLICIES,
  PRESET_ASSIGNEES,
} from "@/lib/hq/defaultApprovalPolicies";
import {
  DEFAULT_ANNUAL_LEAVE_SETTINGS,
  DEFAULT_CUSTOM_LEAVES,
} from "@/lib/hq/defaultLeaveSettings";
import type {
  HqApprovalPolicyItem,
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqCustomLeaveGrantMethod,
  HqCustomLeaveItem,
  HqMember,
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
  "#9ba8cf",
  "#34d399",
  "#eb7d66",
  "#b57edc",
  "#38bdf8",
  "#fb923c",
];

const LEAVE_ICONS = [
  "💊",
  "🤰",
  "👶",
  "🏥",
  "💍",
  "✉️",
  "⛺",
  "⚠️",
  "✨",
  "🌴",
  "🎓",
  "🎂",
];

const CONDITION_GRANT_METHODS: HqCustomLeaveGrantMethod[] = [
  "신청 시 부여",
  "연차 소진 시 부여",
  "관리자가 직접 부여",
  "입사 시 부여",
];

const ROUTINE_GRANT_METHODS: HqCustomLeaveGrantMethod[] = [
  "반복 부여",
  "근속 시 부여",
];

function unitShortSuffix(unit: HqCustomLeaveItem["grant_unit"]): string {
  if (unit === "시간 단위 부여") return "시간";
  if (unit === "분 단위 부여") return "분";
  return "일";
}

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
        {combined.slice(0, 4).map((item, idx) =>
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

export default function HqCustomLeaveSettingsSection({
  settings,
  members,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: Props) {
  const ex = settings.extra_settings || {};

  const customLeaves: HqCustomLeaveItem[] =
    ex.custom_leaves && ex.custom_leaves.length > 0
      ? ex.custom_leaves
      : DEFAULT_CUSTOM_LEAVES;

  const approvalPolicies: HqApprovalPolicyItem[] =
    ex.approval_policies && ex.approval_policies.length > 0
      ? ex.approval_policies
      : DEFAULT_APPROVAL_POLICIES;

  const annualLeaveSettings =
    ex.annual_leave_settings || DEFAULT_ANNUAL_LEAVE_SETTINGS;

  const policyMap = useMemo(
    () => new Map(approvalPolicies.map((p) => [p.id, p])),
    [approvalPolicies]
  );

  // 맞춤 휴가 생성/수정 모달 상태
  const [draft, setDraft] = useState<HqCustomLeaveItem | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [grantMethodOpen, setGrantMethodOpen] = useState(false);
  const [repeatCycleOpen, setRepeatCycleOpen] = useState(false);
  const [payMenuOpen, setPayMenuOpen] = useState(false);
  const [extraSettingsOpen, setExtraSettingsOpen] = useState(false);
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);
  const [modalMenuOpen, setModalMenuOpen] = useState(false);

  // 중첩 결재선 모달 상태
  const [lineModalOpen, setLineModalOpen] = useState(false);
  const [lineCcDraft, setLineCcDraft] = useState<HqPolicyAssignee[]>([]);
  const [lineStepsDraft, setLineStepsDraft] = useState<HqPolicyStep[]>([]);
  const [lineAllowEditDraft, setLineAllowEditDraft] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<
    null | { type: "CC" } | { type: "STEP"; stepIndex: number }
  >(null);
  const [pickerKeyword, setPickerKeyword] = useState("");

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

  const closeAllDropdowns = () => {
    setIconPickerOpen(false);
    setGrantMethodOpen(false);
    setRepeatCycleOpen(false);
    setPayMenuOpen(false);
    setModalMenuOpen(false);
  };

  const openEditModal = (item: HqCustomLeaveItem) => {
    setOpenCardMenuId(null);
    closeAllDropdowns();
    const linked = policyMap.get(item.policy_id);
    setDraft({ ...item });
    setIsNew(false);
    // 여성 전용 또는 증빙 서류가 설정된 항목(보건·출산 등)은 확인하기 편하도록 자동 펼침 지원
    setExtraSettingsOpen(
      item.target_gender !== "모두" ||
        item.proof_document_mode !== "없음" ||
        item.deduct_on_holidays
    );
    setLineCcDraft(linked ? JSON.parse(JSON.stringify(linked.cc_list)) : []);
    setLineStepsDraft(linked ? JSON.parse(JSON.stringify(linked.steps)) : []);
    setLineAllowEditDraft(Boolean(linked?.allow_edit));
  };

  const openCreateModal = () => {
    setOpenCardMenuId(null);
    closeAllDropdowns();
    setDraft({
      id: `cl-custom-${uid()}`,
      policy_id: `lv-custom-${uid()}`,
      name: "",
      icon: "🌴",
      description: "",
      is_mandatory: false,
      is_reward_type: false,
      grant_method: "신청 시 부여",
      repeat_cycle: "입사 월부터 매월",
      repeat_use_group_hire: false,
      tenure_years_rule: "만 3년 · 5년 · 10년 근속 시",
      grant_unit: "일 단위 부여",
      grant_amount: 1,
      usage_unit: "한번에 모두 사용",
      pay_type: "유급",
      partial_paid_days: 1,
      request_on_register: true,
      request_on_cancel: false,
      allow_advance_register: false,
      target_gender: "모두",
      proof_document_mode: "없음",
      proof_document_guide: "",
      deduct_on_holidays: false,
      apply_to_existing_granted: false,
    });
    setIsNew(true);
    setExtraSettingsOpen(false);
    setLineCcDraft([]);
    setLineStepsDraft([]);
    setLineAllowEditDraft(false);
  };

  const handleSaveModal = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      alert("맞춤 휴가 이름을 입력해주세요.");
      return;
    }

    const cleanedSteps = lineStepsDraft
      .filter((s) => s.assignees.length > 0)
      .map((s, idx) => ({ ...s, step_order: idx + 1 }));

    const finalized: HqCustomLeaveItem = {
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      grant_amount: Math.max(0.5, Number(draft.grant_amount || 1)),
      request_on_cancel:
        cleanedSteps.length > 0 ? draft.request_on_cancel : false,
    };

    const nextLeaves = isNew
      ? [...customLeaves, finalized]
      : customLeaves.map((c) => (c.id === finalized.id ? finalized : c));

    let nextApprovalPolicies: HqApprovalPolicyItem[];
    if (policyMap.has(finalized.policy_id)) {
      nextApprovalPolicies = approvalPolicies.map((ap) =>
        ap.id === finalized.policy_id
          ? {
              ...ap,
              title: finalized.name,
              icon: finalized.icon,
              description: finalized.description || undefined,
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
        title: finalized.name,
        description: finalized.description || undefined,
        icon: finalized.icon,
        allow_edit: lineAllowEditDraft,
        per_requester: false,
        cc_list: lineCcDraft,
        steps: cleanedSteps,
        mapped_doc_type: "LEAVE",
      };
      nextApprovalPolicies = [...approvalPolicies, createdAp];
    }

    await onSaveExtra(
      {
        custom_leaves: nextLeaves,
        approval_policies: nextApprovalPolicies,
      },
      isNew
        ? `'${finalized.name}' 맞춤 휴가가 추가되었습니다.`
        : `'${finalized.name}' 설정이 변경되었습니다.`
    );
    setDraft(null);
  };

  const handleDuplicate = async (source: HqCustomLeaveItem) => {
    setOpenCardMenuId(null);
    setModalMenuOpen(false);
    const linked = policyMap.get(source.policy_id);
    const newPolId = `lv-custom-${uid()}`;
    const clonedLeave: HqCustomLeaveItem = {
      ...source,
      id: `cl-custom-${uid()}`,
      policy_id: newPolId,
      name: `${source.name} (복사본)`,
      is_mandatory: false,
      is_reward_type: false,
    };
    const clonedAp: HqApprovalPolicyItem = {
      id: newPolId,
      category: "leave",
      title: clonedLeave.name,
      description: clonedLeave.description || undefined,
      icon: clonedLeave.icon,
      allow_edit: Boolean(linked?.allow_edit),
      per_requester: false,
      cc_list: linked ? JSON.parse(JSON.stringify(linked.cc_list)) : [],
      steps: linked ? JSON.parse(JSON.stringify(linked.steps)) : [],
      mapped_doc_type: "LEAVE",
    };

    await onSaveExtra(
      {
        custom_leaves: [...customLeaves, clonedLeave],
        approval_policies: [...approvalPolicies, clonedAp],
      },
      `'${clonedLeave.name}' 맞춤 휴가가 복제되었습니다.`
    );
  };

  const handleDelete = async (target: HqCustomLeaveItem) => {
    setOpenCardMenuId(null);
    setModalMenuOpen(false);
    if (target.is_mandatory) {
      alert("법정 필수 기본 휴가 항목은 삭제할 수 없습니다.");
      return;
    }
    if (!confirm(`'${target.name}' 맞춤 휴가를 삭제하시겠습니까?`)) return;

    await onSaveExtra(
      {
        custom_leaves: customLeaves.filter((c) => c.id !== target.id),
        approval_policies: approvalPolicies.filter(
          (p) => p.id !== target.policy_id
        ),
      },
      `'${target.name}' 맞춤 휴가가 삭제되었습니다.`
    );
    if (draft?.id === target.id) setDraft(null);
  };

  const handlePickAssignee = (picked: HqPolicyAssignee) => {
    if (!pickerTarget) return;
    const fresh: HqPolicyAssignee = {
      ...picked,
      id: `${picked.id}-${uid()}`,
      notify_mode: "BOTH",
      step_action: "승인",
    };

    if (pickerTarget.type === "CC") {
      if (!lineCcDraft.some((c) => c.name === fresh.name)) {
        setLineCcDraft([...lineCcDraft, fresh]);
      }
    } else {
      const sIdx = pickerTarget.stepIndex;
      const base =
        lineStepsDraft.length > 0
          ? [...lineStepsDraft]
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
      setLineStepsDraft(base);
    }
    setPickerTarget(null);
    setPickerKeyword("");
  };

  const activeStepCountInDraft = lineStepsDraft.filter(
    (s) => s.assignees.length > 0
  ).length;
  const hasAnyAssigneeInDraft =
    activeStepCountInDraft > 0 || lineCcDraft.length > 0;

  return (
    <>
      <div className="space-y-8">
        <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
          맞춤 휴가
        </h2>

        {/* 상단 구성원 휴가 조회 권한 안내 배너 (145644.png 동일) */}
        {!annualLeaveSettings.hide_visibility_banner && (
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
                      ...annualLeaveSettings,
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
        {/* 휴가 종류 리스트 (16종 + 맞춤 휴가 추가 — 145644, 145650)        */}
        {/* =============================================================== */}
        <section className="space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[15px] font-extrabold text-slate-900">
              휴가 종류
            </h3>

            {canEdit && (
              <button
                type="button"
                onClick={openCreateModal}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
              >
                <span className="text-[#00c458] font-extrabold text-sm leading-none">
                  +
                </span>
                <span>맞춤 휴가 추가</span>
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {customLeaves.map((item) => {
              const linked = policyMap.get(item.policy_id);
              const stepCnt = (linked?.steps || []).filter(
                (s) => s.assignees.length > 0
              ).length;
              const ccCnt = linked?.cc_list.length || 0;
              const allowEdit = Boolean(linked?.allow_edit);

              return (
                <div
                  key={item.id}
                  onClick={() => openEditModal(item)}
                  className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center justify-between gap-3 shadow-2xs cursor-pointer relative"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-base shrink-0">
                      {item.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-bold text-slate-900">
                          {item.name}
                        </span>
                        {item.is_mandatory && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                            필수
                          </span>
                        )}
                        {allowEdit && (
                          <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-600 text-[10px] font-bold">
                            변경 허용
                          </span>
                        )}
                        {item.target_gender === "여성" && (
                          <span className="px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 text-[10px] font-bold">
                            여성 전용
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-slate-400 mt-0.5 truncate">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-1.5 shrink-0 text-[11px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {stepCnt > 0 ? (
                      <span
                        onClick={() => openEditModal(item)}
                        className="px-2.5 py-1 rounded-md bg-sky-50 text-sky-600 font-bold flex items-center gap-1"
                      >
                        <span className="text-[10px]">🛫</span>
                        <span>{stepCnt}단계 승인</span>
                      </span>
                    ) : (
                      <span
                        onClick={() => openEditModal(item)}
                        className="px-2.5 py-1 rounded-md bg-slate-50 text-slate-400 font-medium"
                      >
                        승인 없음
                      </span>
                    )}

                    {ccCnt > 0 ? (
                      <span
                        onClick={() => openEditModal(item)}
                        className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-bold"
                      >
                        참조 {ccCnt}
                      </span>
                    ) : (
                      <span
                        onClick={() => openEditModal(item)}
                        className="px-2.5 py-1 rounded-md bg-slate-50 text-slate-400 font-medium"
                      >
                        참조 없음
                      </span>
                    )}

                    {canEdit && (
                      <div className="relative ml-1">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenCardMenuId((p) =>
                              p === item.id ? null : item.id
                            )
                          }
                          className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold text-xs"
                        >
                          ⋯
                        </button>

                        {openCardMenuId === item.id && (
                          <div className="absolute right-0 mt-1 w-36 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                            <button
                              type="button"
                              onClick={() => openEditModal(item)}
                              className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              정책 설정
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicate(item)}
                              className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              정책 복제
                            </button>
                            {!item.is_mandatory && (
                              <>
                                <div className="my-1 border-t border-slate-100" />
                                <button
                                  type="button"
                                  onClick={() => handleDelete(item)}
                                  className="w-full px-3.5 py-1.5 text-left font-semibold text-rose-500 hover:bg-rose-50"
                                >
                                  삭제하기
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 하단 이전/다음 이동 카드 (연차 설정 ← / → 회사 정보) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("leave-setting")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                연차 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("payroll-payment")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                지급 항목
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 맞춤 휴가 생성 / 수정 모달 (145704 ~ 145910 100% 대응)            */}
      {/* ================================================================= */}
      {draft && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[540px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            {/* 상단 우측 ⋯ & ✕ */}
            <div className="flex items-center justify-end gap-2 shrink-0 relative">
              {!isNew && canEdit && (
                <button
                  type="button"
                  onClick={() => setModalMenuOpen((p) => !p)}
                  className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold text-sm"
                >
                  ⋯
                </button>
              )}
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>

              {modalMenuOpen && (
                <div className="absolute right-7 top-8 w-36 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                  <button
                    type="button"
                    onClick={() => handleDuplicate(draft)}
                    className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    정책 복제
                  </button>
                  {!draft.is_mandatory && (
                    <button
                      type="button"
                      onClick={() => handleDelete(draft)}
                      className="w-full px-3.5 py-1.5 text-left font-semibold text-rose-500 hover:bg-rose-50"
                    >
                      삭제하기
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-5">
              {/* 아이콘 + 이름 + 설명 */}
              <div className="relative">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setIconPickerOpen((p) => !p)}
                    className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-100 flex items-center justify-center text-lg shrink-0"
                  >
                    {draft.icon}
                  </button>
                  <input
                    autoFocus={isNew}
                    disabled={!canEdit}
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                    placeholder="맞춤 휴가 이름"
                    className="flex-1 text-xl font-extrabold text-slate-900 placeholder:text-slate-300 focus:outline-none"
                  />
                  {!isNew && (
                    <span className="text-slate-300 text-xs">✏️</span>
                  )}
                </div>

                {iconPickerOpen && (
                  <div className="absolute left-0 top-10 z-30 p-2 rounded-xl bg-white border border-slate-200 shadow-xl flex flex-wrap items-center gap-1 max-w-xs">
                    {LEAVE_ICONS.map((ic) => (
                      <button
                        key={ic}
                        type="button"
                        onClick={() => {
                          setDraft({ ...draft, icon: ic });
                          setIconPickerOpen(false);
                        }}
                        className={`w-8 h-8 rounded-lg hover:bg-slate-100 text-base flex items-center justify-center ${
                          draft.icon === ic
                            ? "bg-emerald-50 ring-1 ring-emerald-400"
                            : ""
                        }`}
                      >
                        {ic}
                      </button>
                    ))}
                  </div>
                )}

                <input
                  disabled={!canEdit}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  placeholder="이 맞춤 휴가 정책에 대한 설명을 입력해주세요"
                  className="mt-2 w-full pb-1 border-b border-slate-200 text-xs text-slate-600 placeholder:text-slate-400 placeholder:underline focus:outline-none"
                />
              </div>

              {/* --------------------------------------------------------- */}
              {/* A) 보상 휴가 전용 필드 (145910.png 동일)                  */}
              {/* --------------------------------------------------------- */}
              {draft.is_reward_type ? (
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {/* 사용 단위 */}
                  <div className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800 text-[13px]">
                        사용 단위
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        한 번 사용할 때 가능한 시간 단위를 선택할 수 있어요.
                      </div>
                    </div>
                    <select
                      disabled={!canEdit}
                      value={draft.usage_unit}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          usage_unit:
                            e.target.value as HqCustomLeaveItem["usage_unit"],
                        })
                      }
                      className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                    >
                      <option value="시간차 사용 (제한없음)">
                        시간차 사용 (제한없음)
                      </option>
                      <option value="시간차 사용 (30분 단위)">
                        시간차 사용 (30분 단위)
                      </option>
                      <option value="시간차 사용 (1시간 단위)">
                        시간차 사용 (1시간 단위)
                      </option>
                      <option value="반차 단위 사용">반차 단위 사용</option>
                      <option value="일 단위 사용">일 단위 사용</option>
                      <option value="한번에 모두 사용">한번에 모두 사용</option>
                    </select>
                  </div>

                  {/* 승인 · 참조 사용 */}
                  <div className="py-4 space-y-3">
                    <button
                      type="button"
                      onClick={() => setLineModalOpen(true)}
                      className="w-full flex items-center justify-between gap-4 text-left hover:bg-slate-50/60"
                    >
                      <div>
                        <div className="font-bold text-slate-800 text-[13px]">
                          승인 · 참조 사용
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          휴가에 승인 · 참조 대상을 설정할 수 있어요.
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
                              setDraft({
                                ...draft,
                                request_on_register: !draft.request_on_register,
                              })
                            }
                            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                              draft.request_on_register
                                ? "bg-[#00c458]"
                                : "bg-slate-200"
                            }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                draft.request_on_register
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
                              setDraft({
                                ...draft,
                                request_on_cancel: !draft.request_on_cancel,
                              })
                            }
                            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                              draft.request_on_cancel &&
                              activeStepCountInDraft > 0
                                ? "bg-[#00c458]"
                                : "bg-slate-200"
                            }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                draft.request_on_cancel &&
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

                  {/* 휴가 사전 등록 가능 */}
                  <div className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800 text-[13px]">
                        휴가 사전 등록 가능
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        휴가 사용 가능 기간 전에 미리 등록할 수 있어요.
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          allow_advance_register: !draft.allow_advance_register,
                        })
                      }
                      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                        draft.allow_advance_register
                          ? "bg-[#00c458]"
                          : "bg-slate-200"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                          draft.allow_advance_register
                            ? "translate-x-5"
                            : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              ) : (
                /* --------------------------------------------------------- */
                /* B) 일반 · 보건 · 출산 · 경조 맞춤 휴가 필드 (145704~145906) */
                /* --------------------------------------------------------- */
                <>
                  <div className="divide-y divide-slate-100 border-t border-slate-100">
                    {/* 1) 부여 방법 (145709.png 그룹형 드롭다운) */}
                    <div className="py-3.5 flex items-center justify-between gap-4 relative">
                      <div>
                        <div className="font-bold text-slate-800 text-[13px]">
                          부여 방법
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          휴가의 성격에 따라 부여 방법을 선택할 수 있어요.
                        </div>
                      </div>

                      <div className="w-48 relative">
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => {
                            setGrantMethodOpen((p) => !p);
                            setRepeatCycleOpen(false);
                            setPayMenuOpen(false);
                          }}
                          className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] hover:bg-slate-200/60 font-bold text-slate-800 flex items-center justify-between"
                        >
                          <span>{draft.grant_method}</span>
                          <span className="text-slate-400 text-[10px]">▾</span>
                        </button>

                        {grantMethodOpen && (
                          <div className="absolute right-0 mt-1 w-52 rounded-xl bg-white border border-slate-200 shadow-2xl py-2 z-30">
                            <div className="px-3.5 py-1 text-[10px] font-bold text-slate-400">
                              조건에 따라 부여
                            </div>
                            {CONDITION_GRANT_METHODS.map((gm) => (
                              <button
                                key={gm}
                                type="button"
                                onClick={() => {
                                  setDraft({ ...draft, grant_method: gm });
                                  setGrantMethodOpen(false);
                                }}
                                className="w-full px-3.5 py-1.5 text-left hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-800"
                              >
                                <span>{gm}</span>
                                {draft.grant_method === gm && (
                                  <span className="text-[#00c458]">✓</span>
                                )}
                              </button>
                            ))}

                            <div className="my-1.5 border-t border-slate-100" />
                            <div className="px-3.5 py-1 text-[10px] font-bold text-slate-400">
                              주기 단위로 루틴하게 부여
                            </div>
                            {ROUTINE_GRANT_METHODS.map((gm) => (
                              <button
                                key={gm}
                                type="button"
                                onClick={() => {
                                  setDraft({ ...draft, grant_method: gm });
                                  setGrantMethodOpen(false);
                                }}
                                className="w-full px-3.5 py-1.5 text-left hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-800"
                              >
                                <span>{gm}</span>
                                {draft.grant_method === gm && (
                                  <span className="text-[#00c458]">✓</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 2-A) 반복 주기 (반복 부여 시 — 145713.png 동일) */}
                    {draft.grant_method === "반복 부여" && (
                      <div className="py-3.5 flex items-center justify-between gap-4 relative">
                        <div>
                          <div className="font-bold text-slate-800 text-[13px]">
                            반복 주기
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            어떤 주기로 부여할 지 설정해보세요.
                          </div>
                        </div>

                        <div className="w-48 relative">
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setRepeatCycleOpen((p) => !p)}
                            className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] hover:bg-slate-200/60 font-bold text-slate-800 flex items-center justify-between"
                          >
                            <span className="truncate">
                              {draft.repeat_cycle || "입사 월부터 매월"}
                            </span>
                            <span className="text-slate-400 text-[10px]">▾</span>
                          </button>

                          {repeatCycleOpen && (
                            <div className="absolute right-0 mt-1 w-56 rounded-xl bg-white border border-slate-200 shadow-2xl p-3 z-30 space-y-2">
                              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                                <span className="text-[11px] font-bold text-slate-700">
                                  그룹 입사일 기준
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      repeat_use_group_hire:
                                        !draft.repeat_use_group_hire,
                                    })
                                  }
                                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                                    draft.repeat_use_group_hire
                                      ? "bg-[#00c458]"
                                      : "bg-slate-200"
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${
                                      draft.repeat_use_group_hire
                                        ? "translate-x-4"
                                        : "translate-x-0"
                                    }`}
                                  />
                                </button>
                              </div>

                              <div className="text-[10px] font-bold text-slate-400 pt-0.5">
                                매월 부여
                              </div>
                              {["입사 월부터 매월", "매월 1일 부여"].map(
                                (cyc) => (
                                  <button
                                    key={cyc}
                                    type="button"
                                    onClick={() => {
                                      setDraft({ ...draft, repeat_cycle: cyc });
                                      setRepeatCycleOpen(false);
                                    }}
                                    className="w-full py-1 text-left flex items-center justify-between font-semibold text-slate-800 hover:text-[#00a84b]"
                                  >
                                    <span>{cyc}</span>
                                    {(draft.repeat_cycle ||
                                      "입사 월부터 매월") === cyc && (
                                      <span className="text-[#00c458]">✓</span>
                                    )}
                                  </button>
                                )
                              )}

                              <div className="text-[10px] font-bold text-slate-400 pt-1 border-t border-slate-100">
                                매년 부여
                              </div>
                              {[
                                "회계일(1월 1일) 기준 매년",
                                "입사일 기준 매년",
                              ].map((cyc) => (
                                <button
                                  key={cyc}
                                  type="button"
                                  onClick={() => {
                                    setDraft({ ...draft, repeat_cycle: cyc });
                                    setRepeatCycleOpen(false);
                                  }}
                                  className="w-full py-1 text-left flex items-center justify-between font-semibold text-slate-800 hover:text-[#00a84b]"
                                >
                                  <span>{cyc}</span>
                                  {draft.repeat_cycle === cyc && (
                                    <span className="text-[#00c458]">✓</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 2-B) 근속 주기 (근속 시 부여 시) */}
                    {draft.grant_method === "근속 시 부여" && (
                      <div className="py-3.5 flex items-center justify-between gap-4">
                        <div>
                          <div className="font-bold text-slate-800 text-[13px]">
                            근속 부여 시점
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            장기 근속 휴가가 자동 부여되는 연차를 선택하세요.
                          </div>
                        </div>
                        <select
                          disabled={!canEdit}
                          value={
                            draft.tenure_years_rule ||
                            "만 3년 · 5년 · 10년 근속 시"
                          }
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              tenure_years_rule: e.target.value,
                            })
                          }
                          className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                        >
                          <option value="만 3년 · 5년 · 10년 근속 시">
                            만 3년 · 5년 · 10년 근속 시
                          </option>
                          <option value="매 3년마다 부여">매 3년마다 부여</option>
                          <option value="매 5년마다 부여">매 5년마다 부여</option>
                        </select>
                      </div>
                    )}

                    {/* 3) 부여 단위 (145716.png) */}
                    <div className="py-3.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="font-bold text-slate-800 text-[13px]">
                          부여 단위
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          어떻게 부여할지 방식을 선택해보세요.
                        </div>
                      </div>
                      <select
                        disabled={!canEdit}
                        value={draft.grant_unit}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            grant_unit:
                              e.target.value as HqCustomLeaveItem["grant_unit"],
                          })
                        }
                        className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                      >
                        <option value="분 단위 부여">분 단위 부여</option>
                        <option value="시간 단위 부여">시간 단위 부여</option>
                        <option value="일 단위 부여">일 단위 부여</option>
                      </select>
                    </div>

                    {/* 4) 부여 시간 */}
                    <div className="py-3.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="font-bold text-slate-800 text-[13px]">
                          부여 시간
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          얼마나 부여할 지 입력해주세요.
                        </div>
                      </div>
                      <div className="w-48 px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] flex items-center justify-between">
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          disabled={!canEdit}
                          value={draft.grant_amount}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              grant_amount: Number(e.target.value),
                            })
                          }
                          className="w-28 bg-transparent font-bold text-slate-900 focus:outline-none"
                        />
                        <span className="text-slate-500 font-semibold">
                          {unitShortSuffix(draft.grant_unit)}
                        </span>
                      </div>
                    </div>

                    {/* 5) 사용 단위 */}
                    <div className="py-3.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="font-bold text-slate-800 text-[13px]">
                          사용 단위
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          한 번 사용할 때 가능한 시간 단위를 선택할 수 있어요.
                        </div>
                      </div>
                      <select
                        disabled={!canEdit}
                        value={draft.usage_unit}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            usage_unit:
                              e.target.value as HqCustomLeaveItem["usage_unit"],
                          })
                        }
                        className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                      >
                        <option value="한번에 모두 사용">한번에 모두 사용</option>
                        <option value="일 단위 사용">일 단위 사용</option>
                        <option value="반차 단위 사용">반차 단위 사용</option>
                        <option value="시간차 사용 (30분 단위)">
                          시간차 사용 (30분 단위)
                        </option>
                        <option value="시간차 사용 (1시간 단위)">
                          시간차 사용 (1시간 단위)
                        </option>
                        <option value="시간차 사용 (제한없음)">
                          시간차 사용 (제한없음)
                        </option>
                      </select>
                    </div>

                    {/* 6) 급여 지급 유무 (145724, 145754, 145828 — 유급 / 무급 / 일부 유급(N일)) */}
                    <div className="py-3.5 flex items-center justify-between gap-4 relative">
                      <div>
                        <div className="font-bold text-slate-800 text-[13px]">
                          급여 지급 유무
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          휴가의 급여 지급 기준을 선택할 수 있어요.
                        </div>
                      </div>

                      <div className="w-48 relative">
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => setPayMenuOpen((p) => !p)}
                          className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] hover:bg-slate-200/60 font-bold text-slate-800 flex items-center justify-between"
                        >
                          <span>
                            {draft.pay_type === "일부 유급"
                              ? `일부 유급 (${draft.partial_paid_days || 1}${unitShortSuffix(
                                  draft.grant_unit
                                )})`
                              : draft.pay_type}
                          </span>
                          <span className="text-slate-400 text-[10px]">▾</span>
                        </button>

                        {payMenuOpen && (
                          <div className="absolute right-0 mt-1 w-56 rounded-xl bg-white border border-slate-200 shadow-2xl p-3 z-30 space-y-2">
                            {(["유급", "무급"] as const).map((pt) => (
                              <button
                                key={pt}
                                type="button"
                                onClick={() => {
                                  setDraft({ ...draft, pay_type: pt });
                                  setPayMenuOpen(false);
                                }}
                                className="w-full py-1.5 text-left flex items-center justify-between font-bold text-slate-800 hover:text-[#00a84b]"
                              >
                                <span>{pt}</span>
                                {draft.pay_type === pt && (
                                  <span className="text-[#00c458]">✓</span>
                                )}
                              </button>
                            ))}

                            <div className="pt-1.5 border-t border-slate-100 space-y-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setDraft({
                                    ...draft,
                                    pay_type: "일부 유급",
                                    partial_paid_days:
                                      draft.partial_paid_days || 60,
                                  })
                                }
                                className="w-full text-left flex items-center justify-between font-bold text-slate-800 hover:text-[#00a84b]"
                              >
                                <span>일부 유급...</span>
                                {draft.pay_type === "일부 유급" && (
                                  <span className="text-[#00c458]">✓</span>
                                )}
                              </button>
                              <p className="text-[10px] text-slate-400">
                                얼마나 유급 휴가로 다뤄줄 지 설정할 수 있어요.
                              </p>

                              {draft.pay_type === "일부 유급" && (
                                <div className="flex items-center gap-1.5 pt-1">
                                  <input
                                    type="number"
                                    min={0.5}
                                    step={0.5}
                                    value={draft.partial_paid_days || 1}
                                    onChange={(e) =>
                                      setDraft({
                                        ...draft,
                                        partial_paid_days: Number(
                                          e.target.value
                                        ),
                                      })
                                    }
                                    className="w-20 px-2.5 py-1 rounded-lg bg-slate-100 font-bold text-slate-900 focus:outline-none"
                                  />
                                  <span className="text-slate-600 font-semibold">
                                    {unitShortSuffix(draft.grant_unit)} 유급
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setPayMenuOpen(false)}
                                    className="ml-auto px-2 py-1 rounded bg-[#00c458] text-white text-[10px] font-bold"
                                  >
                                    확인
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 7) 승인 · 참조 사용 */}
                    <div className="py-4 space-y-3">
                      <button
                        type="button"
                        onClick={() => setLineModalOpen(true)}
                        className="w-full flex items-center justify-between gap-4 text-left hover:bg-slate-50/60"
                      >
                        <div>
                          <div className="font-bold text-slate-800 text-[13px]">
                            승인 · 참조 사용
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            휴가에 승인 · 참조 대상을 설정할 수 있어요.
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
                                setDraft({
                                  ...draft,
                                  request_on_register:
                                    !draft.request_on_register,
                                })
                              }
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                                draft.request_on_register
                                  ? "bg-[#00c458]"
                                  : "bg-slate-200"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                  draft.request_on_register
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
                                setDraft({
                                  ...draft,
                                  request_on_cancel: !draft.request_on_cancel,
                                })
                              }
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                                draft.request_on_cancel &&
                                activeStepCountInDraft > 0
                                  ? "bg-[#00c458]"
                                  : "bg-slate-200"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                  draft.request_on_cancel &&
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
                  </div>

                  {/* 8) 접이식 추가 설정 (성별 · 증명자료 제출 · 휴일 차감 — 145734, 145743, 145814) */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setExtraSettingsOpen((p) => !p)}
                      className="flex items-center gap-1.5 text-sm font-extrabold text-slate-900"
                    >
                      <span>추가 설정</span>
                      <span className="text-slate-400 text-xs">
                        {extraSettingsOpen ? "⌄" : "›"}
                      </span>
                    </button>
                    <p className="text-[11px] text-slate-400 mt-1">
                      사용 가능 성별, 증명 자료 제출, 휴일 등록 가능 여부 등을 설정할 수 있어요.
                    </p>

                    {extraSettingsOpen && (
                      <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                        {/* 사용 가능 성별 */}
                        <div className="py-3.5 flex items-center justify-between gap-4">
                          <div>
                            <div className="font-bold text-slate-800">
                              사용 가능 성별
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              선택한 성별의 구성원에게만 휴가가 보여져요.
                            </div>
                          </div>
                          <select
                            disabled={!canEdit}
                            value={draft.target_gender}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                target_gender:
                                  e.target.value as HqCustomLeaveItem["target_gender"],
                              })
                            }
                            className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                          >
                            <option value="모두">모두</option>
                            <option value="여성">여성</option>
                            <option value="남성">남성</option>
                          </select>
                        </div>

                        {/* 증명 자료 제출 */}
                        <div className="py-3.5 flex items-start justify-between gap-4">
                          <div>
                            <div className="font-bold text-slate-800">
                              증명 자료 제출
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              휴가 사용 전이나 후에 증명자료를 받을 수 있어요.
                            </div>
                          </div>

                          <div className="w-48 space-y-2">
                            <select
                              disabled={!canEdit}
                              value={draft.proof_document_mode}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  proof_document_mode:
                                    e.target.value as HqCustomLeaveItem["proof_document_mode"],
                                })
                              }
                              className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                            >
                              <option value="없음">없음</option>
                              <option value="사전 제출">사전 제출</option>
                              <option value="사후 제출">사후 제출</option>
                              <option value="선택 제출">선택 제출</option>
                            </select>

                            {draft.proof_document_mode !== "없음" && (
                              <textarea
                                rows={3}
                                disabled={!canEdit}
                                value={draft.proof_document_guide || ""}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    proof_document_guide: e.target.value,
                                  })
                                }
                                placeholder="제출해야 할 증명 자료를 작성해 주세요. (ex. 병원 소견서, 청첩장 사진 등..)"
                                className="w-full p-2.5 rounded-xl bg-[#f5f6f8] text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none resize-none"
                              />
                            )}
                          </div>
                        </div>

                        {/* 휴일에 등록된 휴가 차감 */}
                        <div className="py-3.5 flex items-center justify-between gap-4">
                          <div>
                            <div className="font-bold text-slate-800">
                              휴일에 등록된 휴가 차감
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                              휴가 기간에 휴일이 포함된 경우,
                              <br />
                              휴일에 등록된 휴가도 휴가 수량에서 차감돼요.
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                deduct_on_holidays: !draft.deduct_on_holidays,
                              })
                            }
                            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                              draft.deduct_on_holidays
                                ? "bg-[#00c458]"
                                : "bg-slate-200"
                            }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                draft.deduct_on_holidays
                                  ? "translate-x-5"
                                  : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 기존 부여된 휴가에도 반영하기 (반복/입사/근속 부여 편집 시 — 145743.png) */}
                  {!isNew &&
                    ["반복 부여", "근속 시 부여", "입사 시 부여"].includes(
                      draft.grant_method
                    ) && (
                      <div className="pt-2 flex items-center justify-center gap-2">
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              apply_to_existing_granted:
                                !draft.apply_to_existing_granted,
                            })
                          }
                          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                            draft.apply_to_existing_granted
                              ? "bg-[#00c458]"
                              : "bg-slate-200"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${
                              draft.apply_to_existing_granted
                                ? "translate-x-4"
                                : "translate-x-0"
                            }`}
                          />
                        </button>
                        <span className="text-[11px] font-bold text-slate-600">
                          기존 부여된 휴가에도 반영하기
                        </span>
                      </div>
                    )}
                </>
              )}
            </div>

            {canEdit && (
              <div className="pt-5 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveModal}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:opacity-95 text-white text-xs font-extrabold shadow-md transition-opacity"
                >
                  {saving
                    ? "저장 중..."
                    : isNew
                    ? "맞춤 휴가 추가하기"
                    : "변경하기"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 중첩 결재선 모달: 승인 · 참조자 선택                               */}
      {/* ================================================================= */}
      {lineModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-[85] flex items-center justify-center p-4">
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
                      setLineCcDraft([]);
                      setLineStepsDraft([]);
                    }}
                    className="text-[11px] font-bold text-rose-500 hover:underline"
                  >
                    사용 안 함(초기화)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setLineModalOpen(false)}
                  className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="mt-3 shrink-0">
              <h4 className="text-lg font-extrabold text-slate-900">
                {draft?.name || "맞춤 휴가"}
              </h4>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setLineAllowEditDraft((p) => !p)}
                  className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors ${
                    lineAllowEditDraft
                      ? "bg-blue-50 text-blue-600 border-blue-200 font-bold"
                      : "bg-slate-100 text-slate-500 border-transparent font-semibold"
                  }`}
                >
                  변경 허용
                </button>
              </div>
            </div>

            <div className="mt-5 flex-1 overflow-y-auto custom-scroll pr-0.5">
              <ApprovalLineEditor
                ccList={lineCcDraft}
                steps={lineStepsDraft}
                canEdit={canEdit}
                customLabels={ex.approval_labels || []}
                onChangeCc={setLineCcDraft}
                onChangeSteps={setLineStepsDraft}
                onOpenPicker={(target) => setPickerTarget(target)}
              />
            </div>

            <div className="pt-5 shrink-0">
              <button
                type="button"
                onClick={() => setLineModalOpen(false)}
                className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold"
              >
                선택 완료
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 승인자 / 참조자 피커 */}
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
