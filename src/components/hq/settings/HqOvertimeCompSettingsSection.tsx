// src/components/hq/settings/HqOvertimeCompSettingsSection.tsx
"use client";

import React, { useMemo, useState } from "react";
import {
  DEFAULT_OVERTIME_COMP_SETTINGS,
  DEFAULT_WORK_RULES,
  formatWorkRuleSummary,
  patternShortBadge,
} from "@/lib/hq/defaultWorkRules";
import type {
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqMember,
  HqOvertimeAssignedMember,
  HqOvertimeCompPolicyItem,
  HqOvertimeCompSettings,
  HqWorkRuleItem,
} from "@/lib/hq/types";
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
  "#eb7d66",
  "#b57edc",
  "#43c57a",
  "#38bdf8",
  "#fb923c",
  "#2dd4bf",
];

const MONTHLY_PERIOD_OPTIONS = [
  "매달 1일 ~ 매달 31일 (말일)",
  "매달 15일 ~ 익월 14일",
  "매달 21일 ~ 익월 20일",
  "매달 25일 ~ 익월 24일",
];

const WEEKLY_PERIOD_OPTIONS = [
  "매주 월요일 ~ 일요일",
  "매주 일요일 ~ 토요일",
];

/**
 * 정책 카드/모달 우측 아바타 스택 ([종현][문수][종열] +N명)
 */
function MemberAvatarStack({
  list,
  onClick,
}: {
  list: HqOvertimeAssignedMember[];
  onClick?: () => void;
}) {
  const activeList = list.filter((m) => m.status === "ACTIVE");
  if (activeList.length === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200/70 text-[11px] font-semibold text-slate-500"
      >
        적용 구성원 없음
      </button>
    );
  }

  const top3 = activeList.slice(0, 3);
  const remain = activeList.length - top3.length;

  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-1 rounded-lg hover:bg-slate-100 flex items-center gap-1.5 transition-colors"
      title="적용 구성원 보기"
    >
      <span className="flex items-center -space-x-1">
        {top3.map((m, idx) => (
          <span
            key={`${m.id}-${idx}`}
            style={{ backgroundColor: m.avatar_bg || AVATAR_PALETTE[idx % AVATAR_PALETTE.length] }}
            className="w-5 h-5 rounded-md border border-white text-white text-[8px] font-extrabold flex items-center justify-center shadow-2xs"
          >
            {shortAvatarText(m.name)}
          </span>
        ))}
      </span>
      {remain > 0 ? (
        <span className="text-[11px] font-semibold text-slate-500">
          +{remain}명
        </span>
      ) : (
        <span className="text-[11px] font-semibold text-slate-500">
          {activeList.length}명
        </span>
      )}
    </button>
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

export default function HqOvertimeCompSettingsSection({
  settings,
  members,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: Props) {
  const ex = settings.extra_settings || {};

  const otSettings: HqOvertimeCompSettings = ex.overtime_comp_settings
    ? {
        ...DEFAULT_OVERTIME_COMP_SETTINGS,
        ...ex.overtime_comp_settings,
        policies:
          ex.overtime_comp_settings.policies &&
          ex.overtime_comp_settings.policies.length > 0
            ? ex.overtime_comp_settings.policies
            : DEFAULT_OVERTIME_COMP_SETTINGS.policies,
      }
    : DEFAULT_OVERTIME_COMP_SETTINGS;

  const workRules: HqWorkRuleItem[] =
    ex.work_rules && ex.work_rules.length > 0
      ? ex.work_rules
      : DEFAULT_WORK_RULES;

  // 전사 포괄 계약 기본 정책은 DB의 실제 재직 구성원도 누락 없이 자동 병합해서 표시
  const resolvedPolicies = useMemo(() => {
    const activeDbMembers = members.filter((m) => m.work_status === "재직");
    return otSettings.policies.map((pol) => {
      if (!pol.apply_all_inclusive_default) return pol;
      const existingNames = new Set(pol.assigned_members.map((m) => m.name));
      const extraFromDb: HqOvertimeAssignedMember[] = [];
      activeDbMembers.forEach((dbm, idx) => {
        if (!existingNames.has(dbm.name)) {
          extraFromDb.push({
            id: `otm-db-${dbm.instructor_id}`,
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
      return extraFromDb.length > 0
        ? { ...pol, assigned_members: [...pol.assigned_members, ...extraFromDb] }
        : pol;
    });
  }, [otSettings.policies, members]);

  // 적용 중 또는 적용 예정 구성원이 있는 근무 유형만 필터링 (Image 4 동일)
  const populatedWorkRules = useMemo(
    () =>
      workRules.filter(
        (r) =>
          !r.is_hidden &&
          r.assigned_members.some(
            (m) => m.status === "ACTIVE" || m.status === "SCHEDULED"
          )
      ),
    [workRules]
  );

  const statutorySplitUsedRules = useMemo(
    () => populatedWorkRules.filter((r) => r.split_within_statutory_overtime),
    [populatedWorkRules]
  );

  const statutorySplitUnusedRules = useMemo(
    () => populatedWorkRules.filter((r) => !r.split_within_statutory_overtime),
    [populatedWorkRules]
  );

  // 모달 1: 초과 근무 항목 사용 설정 (Images 2 & 3)
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemCountDraft, setItemCountDraft] = useState<"3_ITEMS" | "7_ITEMS">(
    otSettings.item_count_mode
  );

  // 모달 2: 법정근로시간 내 연장 사용 (Image 4)
  const [statutoryUsageOpen, setStatutoryUsageOpen] = useState(false);
  const [statutoryTab, setStatutoryTab] = useState<"USED" | "UNUSED">("USED");

  // 모달 3: 법정근로 내 연장 공제 설정 (Image 5)
  const [deductionModalOpen, setDeductionModalOpen] = useState(false);
  const [deductDraft, setDeductDraft] = useState(
    otSettings.deduct_within_statutory_from_inclusive
  );

  // 모달 4: 초과 근무 보상 정책 생성/수정 (Image 6)
  const [policyDraft, setPolicyDraft] =
    useState<HqOvertimeCompPolicyItem | null>(null);
  const [isNewPolicy, setIsNewPolicy] = useState(false);
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);
  const [policyModalMenuOpen, setPolicyModalMenuOpen] = useState(false);

  // 모달 5: 적용 구성원 보기 (Image 7)
  const [memberViewerPolicyId, setMemberViewerPolicyId] = useState<
    string | null
  >(null);
  const [memberViewerTab, setMemberViewerTab] = useState<
    "ACTIVE" | "SCHEDULED" | "PAST"
  >("ACTIVE");
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberJob, setNewMemberJob] = useState("");
  const [newMemberPeriod, setNewMemberPeriod] = useState("입사일 - 퇴직일까지");
  const [newMemberStatus, setNewMemberStatus] = useState<
    "ACTIVE" | "SCHEDULED"
  >("ACTIVE");

  const viewingPolicy = useMemo(() => {
    if (!memberViewerPolicyId) return null;
    if (policyDraft && policyDraft.id === memberViewerPolicyId) {
      return policyDraft;
    }
    return resolvedPolicies.find((p) => p.id === memberViewerPolicyId) || null;
  }, [memberViewerPolicyId, policyDraft, resolvedPolicies]);

  // 1) 초과 근무 항목 사용 설정 저장
  const handleSaveItemCount = async () => {
    await onSaveExtra(
      {
        overtime_comp_settings: {
          ...otSettings,
          item_count_mode: itemCountDraft,
        },
      },
      `초과 근무 항목 설정이 '${
        itemCountDraft === "7_ITEMS" ? "7개 항목" : "3개 항목"
      }'으로 적용되었습니다.`
    );
    setItemModalOpen(false);
  };

  // 2) 근무 유형별 법정근로 내 연장 분리 토글 (work_rules 직접 동기화)
  const handleToggleRuleStatutorySplit = async (ruleId: string) => {
    if (!canEdit) return;
    const nextRules = workRules.map((r) =>
      r.id === ruleId
        ? {
            ...r,
            split_within_statutory_overtime: !r.split_within_statutory_overtime,
          }
        : r
    );
    await onSaveExtra(
      { work_rules: nextRules },
      "근무 유형의 법정근로시간 내 연장 구분 설정이 변경되었습니다."
    );
  };

  // 3) 법정근로 내 연장 공제 설정 저장
  const handleSaveDeductionSetting = async () => {
    await onSaveExtra(
      {
        overtime_comp_settings: {
          ...otSettings,
          deduct_within_statutory_from_inclusive: deductDraft,
        },
      },
      "법정근로 내 연장 공제 설정이 적용되었습니다."
    );
    setDeductionModalOpen(false);
  };

  // 4) 보상 정책 모달 열기 / 추가 / 저장 / 복제 / 삭제
  const openEditPolicyModal = (pol: HqOvertimeCompPolicyItem) => {
    setOpenCardMenuId(null);
    setPolicyModalMenuOpen(false);
    setIsNewPolicy(false);
    setPolicyDraft(JSON.parse(JSON.stringify(pol)));
  };

  const openCreatePolicyModal = () => {
    setOpenCardMenuId(null);
    setPolicyModalMenuOpen(false);
    setIsNewPolicy(true);
    setPolicyDraft({
      id: `ot-pol-${uid()}`,
      name: "",
      description: "",
      is_default: false,
      deduction_cycle_unit: "월 단위",
      deduction_cycle_period: "매달 1일 ~ 매달 31일 (말일)",
      apply_all_inclusive_default: false,
      assigned_members: [],
    });
  };

  const handleSavePolicyModal = async () => {
    if (!policyDraft) return;
    if (!policyDraft.name.trim()) {
      alert("초과 근무 보상 정책 이름을 입력해주세요.");
      return;
    }
    const clean: HqOvertimeCompPolicyItem = {
      ...policyDraft,
      name: policyDraft.name.trim(),
      description: policyDraft.description.trim(),
    };

    const nextPolicies = isNewPolicy
      ? [...resolvedPolicies, clean]
      : resolvedPolicies.map((p) => (p.id === clean.id ? clean : p));

    await onSaveExtra(
      {
        overtime_comp_settings: {
          ...otSettings,
          policies: nextPolicies,
        },
      },
      isNewPolicy
        ? `'${clean.name}' 정책이 추가되었습니다.`
        : `'${clean.name}' 정책이 저장되었습니다.`
    );
    setPolicyDraft(null);
  };

  const handleDuplicatePolicy = async (source: HqOvertimeCompPolicyItem) => {
    setOpenCardMenuId(null);
    setPolicyModalMenuOpen(false);
    const cloned: HqOvertimeCompPolicyItem = {
      ...JSON.parse(JSON.stringify(source)),
      id: `ot-pol-${uid()}`,
      name: `${source.name} (복사본)`,
      is_default: false,
      apply_all_inclusive_default: false,
    };
    await onSaveExtra(
      {
        overtime_comp_settings: {
          ...otSettings,
          policies: [...resolvedPolicies, cloned],
        },
      },
      `'${cloned.name}' 정책이 복제되었습니다.`
    );
  };

  const handleSetDefaultPolicy = async (targetId: string) => {
    setOpenCardMenuId(null);
    const nextPolicies = resolvedPolicies.map((p) => ({
      ...p,
      is_default: p.id === targetId,
    }));
    await onSaveExtra(
      {
        overtime_comp_settings: {
          ...otSettings,
          policies: nextPolicies,
        },
      },
      "기본 초과 근무 보상 정책이 변경되었습니다."
    );
  };

  const handleDeletePolicy = async (target: HqOvertimeCompPolicyItem) => {
    setOpenCardMenuId(null);
    setPolicyModalMenuOpen(false);
    if (target.is_default) {
      alert("기본 초과 근무 보상 정책은 삭제할 수 없습니다.");
      return;
    }
    if (!confirm(`'${target.name}' 정책을 삭제하시겠습니까?`)) return;
    await onSaveExtra(
      {
        overtime_comp_settings: {
          ...otSettings,
          policies: resolvedPolicies.filter((p) => p.id !== target.id),
        },
      },
      `'${target.name}' 정책이 삭제되었습니다.`
    );
    if (policyDraft?.id === target.id) setPolicyDraft(null);
  };

  // 5) 적용 구성원 추가 / 상태 변경 / 제외
  const updatePolicyMembers = async (
    targetPolId: string,
    nextMembers: HqOvertimeAssignedMember[],
    toastMsg: string
  ) => {
    if (policyDraft && policyDraft.id === targetPolId) {
      setPolicyDraft({ ...policyDraft, assigned_members: nextMembers });
    }
    if (resolvedPolicies.some((p) => p.id === targetPolId)) {
      const nextPolicies = resolvedPolicies.map((p) =>
        p.id === targetPolId ? { ...p, assigned_members: nextMembers } : p
      );
      await onSaveExtra(
        {
          overtime_comp_settings: {
            ...otSettings,
            policies: nextPolicies,
          },
        },
        toastMsg
      );
    }
  };

  const handleAddAssignedMember = async () => {
    if (!viewingPolicy) return;
    if (!newMemberName.trim()) {
      alert("추가할 구성원 이름을 선택하거나 입력해주세요.");
      return;
    }
    const nm = newMemberName.trim();
    if (
      viewingPolicy.assigned_members.some(
        (m) => m.name === nm && m.status === newMemberStatus
      )
    ) {
      alert("이미 해당 목록에 등록된 구성원입니다.");
      return;
    }

    const matchedDb = members.find((m) => m.name === nm);
    const created: HqOvertimeAssignedMember = {
      id: `otm-${uid()}`,
      name: nm,
      job_label:
        newMemberJob.trim() ||
        (matchedDb?.department && matchedDb.department !== "미지정"
          ? matchedDb.department
          : matchedDb?.job_title || ""),
      avatar_bg:
        AVATAR_PALETTE[
          viewingPolicy.assigned_members.length % AVATAR_PALETTE.length
        ],
      period_label: newMemberPeriod.trim() || "입사일 - 퇴직일까지",
      status: newMemberStatus,
    };

    await updatePolicyMembers(
      viewingPolicy.id,
      [created, ...viewingPolicy.assigned_members],
      `'${nm}' 구성원이 보상 정책에 추가되었습니다.`
    );
    setNewMemberName("");
    setNewMemberJob("");
    setAddMemberOpen(false);
  };

  return (
    <>
      <div className="space-y-9">
        {/* 상단 타이틀 (Image 1) */}
        <div>
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            초과 근무 보상
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            구성원의 초과 근무를 판단하는 기준 및 초과 근무에 대한 보상 정책을 설정할 수 있어요.
          </p>
        </div>

        {/* =============================================================== */}
        {/* 섹션 1: 초과 근무 항목 (Image 1)                                 */}
        {/* =============================================================== */}
        <section className="space-y-3">
          <h3 className="text-[15px] font-extrabold text-slate-900">
            초과 근무 항목
          </h3>

          <button
            type="button"
            onClick={() => {
              setItemCountDraft(otSettings.item_count_mode);
              setItemModalOpen(true);
            }}
            className="w-full px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center justify-between gap-3 shadow-2xs text-left"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 text-slate-400 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <rect x="3" y="3" width="6" height="6" rx="1.5" />
                  <circle cx="14" cy="6" r="3" />
                  <rect x="3" y="11" width="6" height="6" rx="1.5" />
                  <rect x="11" y="11" width="6" height="6" rx="1.5" />
                </svg>
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-slate-900">
                  초과 근무 항목 사용 설정
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  사용 항목 수에 따라 초과 근무 항목의 표시 및 해석 방식이 달라집니다.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 text-xs font-bold text-slate-700">
              <span>
                {otSettings.item_count_mode === "7_ITEMS"
                  ? "7개 항목 사용"
                  : "3개 항목 사용"}
              </span>
              <span className="text-slate-300 text-sm">›</span>
            </div>
          </button>
        </section>

        {/* =============================================================== */}
        {/* 섹션 2: 법정근로시간 내 연장 (Image 1)                            */}
        {/* =============================================================== */}
        <section className="space-y-3">
          <h3 className="text-[15px] font-extrabold text-slate-900">
            법정근로시간 내 연장
          </h3>

          <div className="space-y-2.5">
            {/* 카드 2-1: 법정근로시간 내 연장과 일반 연장을 구분해서 사용 */}
            <button
              type="button"
              onClick={() => {
                setStatutoryTab("USED");
                setStatutoryUsageOpen(true);
              }}
              className="w-full px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center justify-between gap-3 shadow-2xs text-left"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 text-slate-400 flex items-center justify-center text-sm shrink-0">
                  🔥
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-slate-900">
                    법정근로시간 내 연장과 일반 연장을 구분해서 사용
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    소정근로시간 초과 근무 시, 법정근로시간 초과 여부에 따라 항목을 분리해서 산정해요.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 text-xs font-bold text-slate-700">
                <span>{statutorySplitUsedRules.length}개 근무 유형 사용 중</span>
                <span className="text-slate-300 text-sm">›</span>
              </div>
            </button>

            {/* 카드 2-2: 포괄 계약 시간에서 법정근로시간 내 연장 공제 */}
            <button
              type="button"
              onClick={() => {
                setDeductDraft(
                  otSettings.deduct_within_statutory_from_inclusive
                );
                setDeductionModalOpen(true);
              }}
              className="w-full px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center justify-between gap-3 shadow-2xs text-left"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 text-slate-400 flex items-center justify-center text-sm shrink-0">
                  🧮
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-slate-900">
                    포괄 계약 시간에서 법정근로시간 내 연장 공제
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    포괄 임금 계약에서 법정근로내 연장 근무에 대한 공제 여부를 설정할 수 있어요.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 text-xs font-bold text-slate-700">
                <span>
                  {otSettings.deduct_within_statutory_from_inclusive
                    ? "포괄 공제 포함"
                    : "설정 안 함"}
                </span>
                <span className="text-slate-300 text-sm">›</span>
              </div>
            </button>
          </div>
        </section>

        {/* =============================================================== */}
        {/* 섹션 3: 초과 근무 보상 정책 (Image 1)                             */}
        {/* =============================================================== */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[15px] font-extrabold text-slate-900">
              초과 근무 보상 정책
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
                <span>보상 정책 추가</span>
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {resolvedPolicies.map((pol) => (
              <div
                key={pol.id}
                onClick={() => openEditPolicyModal(pol)}
                className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center justify-between gap-3 shadow-2xs cursor-pointer relative"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-slate-900">
                      {pol.name}
                    </span>
                    {pol.is_default && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                        기본
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {pol.deduction_cycle_period}
                  </p>
                </div>

                <div
                  className="flex items-center gap-1.5 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MemberAvatarStack
                    list={pol.assigned_members}
                    onClick={() => {
                      setMemberViewerTab("ACTIVE");
                      setMemberViewerPolicyId(pol.id);
                    }}
                  />

                  {canEdit && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenCardMenuId((p) =>
                            p === pol.id ? null : pol.id
                          )
                        }
                        className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold text-xs"
                      >
                        ⋯
                      </button>

                      {openCardMenuId === pol.id && (
                        <div className="absolute right-0 mt-1 w-40 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                          <button
                            type="button"
                            onClick={() => openEditPolicyModal(pol)}
                            className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            정책 설정
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenCardMenuId(null);
                              setMemberViewerTab("ACTIVE");
                              setMemberViewerPolicyId(pol.id);
                            }}
                            className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            적용 구성원 보기
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicatePolicy(pol)}
                            className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            정책 복제
                          </button>
                          {!pol.is_default && (
                            <button
                              type="button"
                              onClick={() => handleSetDefaultPolicy(pol.id)}
                              className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              기본 정책으로 지정
                            </button>
                          )}
                          {!pol.is_default && (
                            <>
                              <div className="my-1 border-t border-slate-100" />
                              <button
                                type="button"
                                onClick={() => handleDeletePolicy(pol)}
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
            ))}
          </div>
        </section>

        {/* 하단 이전/다음 이동 카드 (Image 1 동일: 근무 정책 · 승인 ← / → 근무지) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("work-policy")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                근무 정책 · 승인
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("work-place")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">근무지</div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 모달 1: 초과 근무 항목 사용 설정 (Images 2 & 3)                     */}
      {/* ================================================================= */}
      {itemModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[490px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            <div className="flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setItemModalOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-5">
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                초과 근무 항목 사용 설정
              </h3>

              <div className="space-y-2.5">
                <div>
                  <div className="text-[13px] font-bold text-slate-900">
                    사용 항목
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    사용 항목 수에 따라 초과 근무 항목의 표시 및 해석 방식이 달라집니다.
                  </p>
                </div>

                {/* 라디오 1: 3개 항목 (기본) */}
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setItemCountDraft("3_ITEMS")}
                  className={`w-full p-4 rounded-xl border text-left flex items-center justify-between gap-3 transition-all ${
                    itemCountDraft === "3_ITEMS"
                      ? "border-[#00c458] bg-emerald-50/20"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-bold text-slate-900">
                        3개 항목
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[#00c458] text-[10px] font-extrabold">
                        기본
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      연장 / 야간 / 휴일
                    </div>
                  </div>
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                      itemCountDraft === "3_ITEMS"
                        ? "bg-[#00c458] border-[#00c458]"
                        : "border-slate-300 bg-white"
                    }`}
                  >
                    {itemCountDraft === "3_ITEMS" && (
                      <span className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </span>
                </button>

                {/* 라디오 2: 7개 항목 */}
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setItemCountDraft("7_ITEMS")}
                  className={`w-full p-4 rounded-xl border text-left flex items-center justify-between gap-3 transition-all ${
                    itemCountDraft === "7_ITEMS"
                      ? "border-[#00c458] bg-emerald-50/20"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <div>
                    <div className="text-[13px] font-bold text-slate-900">
                      7개 항목
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      연장 / 야간 / 휴일 / 연장·야간 / 연장·휴일 / 휴일·야간 / 연장·야간·휴일
                    </div>
                  </div>
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                      itemCountDraft === "7_ITEMS"
                        ? "bg-[#00c458] border-[#00c458]"
                        : "border-slate-300 bg-white"
                    }`}
                  >
                    {itemCountDraft === "7_ITEMS" && (
                      <span className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </span>
                </button>
              </div>

              {/* 예시 타임라인 다이어그램 (Image 2 vs Image 3 실시간 전환) */}
              <div className="rounded-xl border border-slate-200/90 bg-white p-4 space-y-3">
                <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-500">
                  예시
                </span>

                {itemCountDraft === "7_ITEMS" ? (
                  <div className="space-y-3">
                    {/* 타임라인 바 (7개 항목) */}
                    <div className="px-2 pt-1 pb-2 bg-[#fafafa] rounded-lg border border-slate-100">
                      <div className="h-6 rounded bg-[#ee6b4d] text-white text-[11px] font-extrabold flex items-center justify-center gap-1">
                        <span>🔥</span>
                        <span>9h</span>
                      </div>
                      <div className="grid grid-cols-9 gap-0 mt-1.5 items-center text-[10px] font-bold">
                        <div className="col-span-4 flex items-center justify-center border-t-2 border-dashed border-amber-400 pt-1 text-amber-600 gap-1">
                          <span className="w-3.5 h-3.5 rounded bg-amber-400 text-white flex items-center justify-center text-[9px]">
                            1
                          </span>
                          <span>4h</span>
                        </div>
                        <div className="col-span-5 flex items-center justify-center border-t-2 border-dashed border-teal-500 pt-1 text-teal-600 gap-1">
                          <span className="w-3.5 h-3.5 rounded bg-teal-500 text-white flex items-center justify-center text-[9px]">
                            2
                          </span>
                          <span>5h</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5">
                        <span>PM 6</span>
                        <span>PM 10</span>
                        <span>AM 3</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded bg-amber-400 text-white text-[10px] font-extrabold flex items-center justify-center">
                            1
                          </span>
                          <span className="font-bold text-slate-800">연장</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-500 font-semibold">
                            ×1.5
                          </span>
                        </div>
                        <span className="font-bold text-slate-800">4 시간</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded bg-teal-500 text-white text-[10px] font-extrabold flex items-center justify-center">
                            2
                          </span>
                          <span className="font-bold text-slate-800">
                            연장 · 야간
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-500 font-semibold">
                            ×2
                          </span>
                        </div>
                        <span className="font-bold text-slate-800">5 시간</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-100">
                      연장과 야간 근무가 동시에 발생할 시, 연장 · 야간으로 해석
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* 타임라인 바 (3개 항목) */}
                    <div className="px-2 py-2 bg-[#fafafa] rounded-lg border border-slate-100">
                      <div className="grid grid-cols-9 mb-1 text-[10px] font-bold">
                        <div className="col-span-4" />
                        <div className="col-span-5 flex items-center justify-center border-b-2 border-dashed border-purple-500 pb-1 text-purple-600 gap-1">
                          <span className="w-3.5 h-3.5 rounded bg-purple-500 text-white flex items-center justify-center text-[9px]">
                            2
                          </span>
                          <span>5h</span>
                        </div>
                      </div>
                      <div className="h-6 rounded bg-[#ee6b4d] text-white text-[11px] font-extrabold flex items-center justify-center gap-1">
                        <span>🔥</span>
                        <span>9h</span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-center border-t-2 border-dashed border-amber-400 pt-1 text-[10px] font-bold text-amber-600 gap-1">
                        <span className="w-3.5 h-3.5 rounded bg-amber-400 text-white flex items-center justify-center text-[9px]">
                          1
                        </span>
                        <span>9h</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5">
                        <span>PM 6</span>
                        <span>PM 10</span>
                        <span>AM 3</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded bg-amber-400 text-white text-[10px] font-extrabold flex items-center justify-center">
                            1
                          </span>
                          <span className="font-bold text-slate-800">연장</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-500 font-semibold">
                            ×1.5
                          </span>
                        </div>
                        <span className="font-bold text-slate-800">9 시간</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded bg-purple-500 text-white text-[10px] font-extrabold flex items-center justify-center">
                            2
                          </span>
                          <span className="font-bold text-slate-800">야간</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-500 font-semibold">
                            ×0.5
                          </span>
                        </div>
                        <span className="font-bold text-slate-800">5 시간</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-100">
                      연장과 야간 근무가 동시에 발생할 시, 각각 발생하는 것으로 해석
                    </div>
                  </div>
                )}
              </div>

              {/* 하단 상세 안내 문구 (Images 2 & 3 동일) */}
              <div className="space-y-1.5 text-[11px] text-slate-400 leading-relaxed pt-1 border-t border-slate-100">
                <div className="font-bold text-slate-500">
                  항목 설정을 변경하면 무엇이 달라지나요?
                </div>
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    발생한 초과 근무를 표기하는 방식이 위 예시와 같은 방식으로 달라져요.
                    <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                      <li>
                        근태 리포트, 보상 휴가 부여 및 초과 근무 수당 정산에 영향이 있어요.
                      </li>
                      <li>
                        초과 근무 유형이 연장, 야간, 휴일 3개 항목으로만 표기되는 것을 원한다면 &quot;3개 항목으로 사용&quot;을 선택해주세요.
                      </li>
                    </ul>
                  </li>
                  <li>
                    포괄 임금 계약 대상인 경우에는 발생한 초과 근무에서 포괄 계약분을 공제하는 방식이 달라져요.
                  </li>
                </ul>
              </div>
            </div>

            {canEdit && (
              <div className="pt-5 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveItemCount}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:opacity-95 text-white text-xs font-extrabold shadow-md transition-opacity"
                >
                  {saving ? "저장 중..." : "변경 사항 적용하기"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 2: 법정근로시간 내 연장 사용 (Image 4)                         */}
      {/* ================================================================= */}
      {statutoryUsageOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[490px] max-h-[88vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            <div className="flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setStatutoryUsageOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="shrink-0">
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                법정근로시간 내 연장 사용
              </h3>
              <p className="text-slate-500 mt-2 leading-relaxed">
                법정근로시간 내 연장 근무 발생 시, 일반 연장 근무 시간과 분리하여 별도로 산정하도록 설정할 수 있어요.
              </p>
              <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold">
                  i
                </span>
                <span>
                  적용 중 혹은 적용 예정인 구성원이 없는 근무 유형은 보여지지 않아요.
                </span>
              </div>

              {/* 탭: 사용함 4 / 사용 안 함 */}
              <div className="mt-5 flex items-center gap-5 border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => setStatutoryTab("USED")}
                  className={`pb-2.5 text-xs font-extrabold border-b-2 flex items-center gap-1.5 transition-colors ${
                    statutoryTab === "USED"
                      ? "border-slate-900 text-slate-900"
                      : "border-transparent text-slate-400 hover:text-slate-700"
                  }`}
                >
                  <span>사용함</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-white text-[10px] leading-none">
                    {statutorySplitUsedRules.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setStatutoryTab("UNUSED")}
                  className={`pb-2.5 text-xs font-extrabold border-b-2 flex items-center gap-1.5 transition-colors ${
                    statutoryTab === "UNUSED"
                      ? "border-slate-900 text-slate-900"
                      : "border-transparent text-slate-400 hover:text-slate-700"
                  }`}
                >
                  <span>사용 안 함</span>
                  {statutorySplitUnusedRules.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] leading-none">
                      {statutorySplitUnusedRules.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll divide-y divide-slate-100 mt-1">
              {(statutoryTab === "USED"
                ? statutorySplitUsedRules
                : statutorySplitUnusedRules
              ).length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  해당하는 근무 유형이 없습니다.
                </div>
              ) : (
                (statutoryTab === "USED"
                  ? statutorySplitUsedRules
                  : statutorySplitUnusedRules
                ).map((rule) => {
                  const activeCount = rule.assigned_members.filter(
                    (m) => m.status === "ACTIVE"
                  ).length;
                  return (
                    <div
                      key={rule.id}
                      className="py-4 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-bold text-slate-900">
                            {rule.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold">
                            {patternShortBadge(rule.pattern_type)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {formatWorkRuleSummary(rule)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2.5 py-1 rounded-full border border-slate-200 text-[11px] font-bold text-slate-700">
                          {activeCount}명 적용중
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => handleToggleRuleStatutorySplit(rule.id)}
                            className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-bold text-slate-600"
                            title="사용 여부 전환"
                          >
                            {rule.split_within_statutory_overtime
                              ? "제외"
                              : "사용"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 3: 법정근로 내 연장 공제 설정 (Image 5)                        */}
      {/* ================================================================= */}
      {deductionModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[490px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            <div className="flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setDeductionModalOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-5">
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                법정근로 내 연장 공제 설정
              </h3>

              {/* 상단 파란 배너 (Image 5 동일) */}
              <div className="px-3.5 py-2.5 rounded-xl border border-blue-200 bg-blue-50/40 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-blue-700 font-bold text-[11px]">
                  <span className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px]">
                    i
                  </span>
                  <span>
                    현재 {statutorySplitUsedRules.length}개 근무 유형에서 법정근로 내 연장을 사용하고 있어요.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeductionModalOpen(false);
                    setStatutoryTab("USED");
                    setStatutoryUsageOpen(true);
                  }}
                  className="px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50 shrink-0"
                >
                  조회
                </button>
              </div>

              {/* 토글 행 */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-bold text-slate-900">
                    포괄 계약 대상에 법정근로 내 연장 포함
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    연장 근무를 포괄 계약하였을 시, 법정근로 내 연장도 함께 공제합니다.
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setDeductDraft((p) => !p)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                    deductDraft ? "bg-[#00c458]" : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                      deductDraft ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* 예시 계산 박스 (Image 5 동일 + 토글 연동 실시간 계산) */}
              <div className="rounded-xl border border-slate-200/90 bg-white p-4 space-y-3">
                <div className="px-3 py-2 rounded-lg bg-[#f8f9fa] flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-bold text-slate-600">
                    예시
                  </span>
                  <span>
                    이해를 돕기 위한 법정근로내 연장의 보상 시간 계산 예시입니다.
                  </span>
                </div>

                <div className="space-y-2.5 pt-1 text-xs">
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="font-semibold">연장 포괄 계약 시간</span>
                    <span className="font-bold text-slate-800">8 시간</span>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="font-semibold">
                        법정근로내 연장 발생 시간
                      </span>
                      <span className="font-bold text-slate-800">12 시간</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1">
                      <span className="w-3.5 h-3.5 rounded-full bg-slate-200 text-white flex items-center justify-center text-[9px] font-bold">
                        −
                      </span>
                      <span>
                        {deductDraft
                          ? "포괄 계약 공제 8시간"
                          : "공제 시간 없음"}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between font-extrabold text-slate-900">
                    <span>보상 시간</span>
                    <span>{deductDraft ? "4 시간" : "12 시간"}</span>
                  </div>
                </div>
              </div>

              {/* 하단 설명 문구 */}
              <div className="space-y-1.5 text-[11px] text-slate-400 leading-relaxed pt-1 border-t border-slate-100">
                <div className="font-bold text-slate-500">
                  법정근로내 연장이 무엇인가요?
                </div>
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    일반적인 연장근로는 실제로 근무한 시간이 법정근로시간(고정출퇴근과 시차출퇴근의 경우 주 40시간/일 8 시간)을 넘었을 때 발생합니다.
                  </li>
                  <li>
                    법정근로 내 연장 또는 야간은 유급휴가를 포함해 근무로 인정되는 시간이 법정근로시간 보다 적지만 계약된 시간 보다 많을 경우에 발생합니다.
                  </li>
                </ul>
              </div>
            </div>

            {canEdit && (
              <div className="pt-5 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveDeductionSetting}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:opacity-95 text-white text-xs font-extrabold shadow-md transition-opacity"
                >
                  {saving ? "저장 중..." : "변경 사항 적용하기"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 4: 초과 근무 보상 정책 생성/수정 모달 (Image 6)                */}
      {/* ================================================================= */}
      {policyDraft && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[500px] max-h-[88vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            {/* 상단 우측 아바타 스택 + ⋯ + ✕ (Image 6 동일) */}
            <div className="flex items-center justify-end gap-2 shrink-0 relative">
              {!isNewPolicy && (
                <MemberAvatarStack
                  list={policyDraft.assigned_members}
                  onClick={() => {
                    setMemberViewerTab("ACTIVE");
                    setMemberViewerPolicyId(policyDraft.id);
                  }}
                />
              )}

              {!isNewPolicy && canEdit && (
                <button
                  type="button"
                  onClick={() => setPolicyModalMenuOpen((p) => !p)}
                  className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold text-sm"
                >
                  ⋯
                </button>
              )}

              <button
                type="button"
                onClick={() => setPolicyDraft(null)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>

              {policyModalMenuOpen && (
                <div className="absolute right-7 top-8 w-40 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setPolicyModalMenuOpen(false);
                      setMemberViewerTab("ACTIVE");
                      setMemberViewerPolicyId(policyDraft.id);
                    }}
                    className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    적용 구성원 보기
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicatePolicy(policyDraft)}
                    className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    정책 복제
                  </button>
                  {!policyDraft.is_default && (
                    <button
                      type="button"
                      onClick={() => handleDeletePolicy(policyDraft)}
                      className="w-full px-3.5 py-1.5 text-left font-semibold text-rose-500 hover:bg-rose-50"
                    >
                      삭제하기
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-5 mt-2">
              {/* 정책 이름 + 설명 */}
              <div>
                <div className="flex items-center gap-2">
                  <input
                    autoFocus={isNewPolicy}
                    disabled={!canEdit}
                    value={policyDraft.name}
                    onChange={(e) =>
                      setPolicyDraft({ ...policyDraft, name: e.target.value })
                    }
                    placeholder="초과 근무 보상 정책 이름"
                    className="flex-1 text-xl font-extrabold text-slate-900 placeholder:text-slate-300 focus:outline-none"
                  />
                  {!isNewPolicy && (
                    <span className="text-slate-300 text-xs">✏️</span>
                  )}
                </div>
                <input
                  disabled={!canEdit}
                  value={policyDraft.description}
                  onChange={(e) =>
                    setPolicyDraft({
                      ...policyDraft,
                      description: e.target.value,
                    })
                  }
                  placeholder="이 초과 근무 보상 정책에 대한 설명을 입력해주세요."
                  className="mt-2 w-full text-xs text-slate-500 placeholder:text-slate-400 focus:outline-none"
                />
              </div>

              {/* 포괄 계약 공제 주기 (Image 6 동일: 월 단위 / 주 단위 + 기간 드롭다운) */}
              <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-[13px] font-bold text-slate-800">
                  포괄 계약 공제 주기
                </div>

                <div className="w-full sm:w-60 space-y-2">
                  <div className="grid grid-cols-2 p-0.5 rounded-xl bg-[#f5f6f8] border border-slate-200/70">
                    {(["월 단위", "주 단위"] as const).map((unit) => {
                      const active = policyDraft.deduction_cycle_unit === unit;
                      return (
                        <button
                          key={unit}
                          type="button"
                          disabled={!canEdit}
                          onClick={() =>
                            setPolicyDraft({
                              ...policyDraft,
                              deduction_cycle_unit: unit,
                              deduction_cycle_period:
                                unit === "월 단위"
                                  ? MONTHLY_PERIOD_OPTIONS[0]
                                  : WEEKLY_PERIOD_OPTIONS[0],
                            })
                          }
                          className={`py-2 rounded-lg text-xs font-bold transition-all ${
                            active
                              ? "bg-white text-slate-900 border border-blue-500 shadow-2xs"
                              : "text-slate-500 hover:text-slate-700"
                          }`}
                        >
                          {unit}
                        </button>
                      );
                    })}
                  </div>

                  <select
                    disabled={!canEdit}
                    value={policyDraft.deduction_cycle_period}
                    onChange={(e) =>
                      setPolicyDraft({
                        ...policyDraft,
                        deduction_cycle_period: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                  >
                    {(policyDraft.deduction_cycle_unit === "월 단위"
                      ? MONTHLY_PERIOD_OPTIONS
                      : WEEKLY_PERIOD_OPTIONS
                    ).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 전사 포괄 계약 기본 자동 적용 스위치 */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-bold text-slate-800">
                    전사 재직 구성원 자동 포함 (포괄 계약 기본)
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    신규 입사자 등 재직 중인 모든 구성원을 이 포괄 보상 정책 대상에 자동 반영합니다.
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() =>
                    setPolicyDraft({
                      ...policyDraft,
                      apply_all_inclusive_default:
                        !policyDraft.apply_all_inclusive_default,
                    })
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                    policyDraft.apply_all_inclusive_default
                      ? "bg-[#00c458]"
                      : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                      policyDraft.apply_all_inclusive_default
                        ? "translate-x-5"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* 안내 콜아웃 박스 (Image 6 동일) */}
              <div className="rounded-xl bg-[#f8f9fa] p-4 space-y-2">
                <div className="flex items-center gap-1.5 font-extrabold text-slate-800">
                  <span className="px-1.5 py-0.5 rounded bg-blue-500 text-white text-[10px]">
                    안내
                  </span>
                  <span>공제 주기 설정 시 참고해 주세요.</span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-500 leading-relaxed">
                  <li>
                    급여 정산 시 사용하는 초과 근무 정산 주기와 동일하게 설정 시, 급여 정산 외에도 보상을 일관된 기준으로 지급 및 조회 할 수 있어요.
                  </li>
                  <li>
                    각 구성원의 포괄 계약 근로시간 설정 단위와 다른 단위로 설정 시, 포괄계약 근로시간에 월 평균 주(현재 설정: 4.345주)를 곱하거나 나눠서 계산해요.
                  </li>
                </ul>
              </div>
            </div>

            {canEdit && (
              <div className="pt-5 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSavePolicyModal}
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
      {/* 모달 5: 적용 구성원 보기 모달 (Image 7)                             */}
      {/* ================================================================= */}
      {viewingPolicy && (
        <div className="fixed inset-0 bg-slate-900/45 z-[85] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[440px] max-h-[85vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-6 text-xs">
            <div className="flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => {
                  setMemberViewerPolicyId(null);
                  setAddMemberOpen(false);
                }}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="mt-1 flex items-center justify-between shrink-0">
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                적용 구성원 보기
              </h3>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setAddMemberOpen((p) => !p)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700"
                >
                  + 구성원 추가
                </button>
              )}
            </div>

            {/* + 구성원 추가 인라인 폼 */}
            {addMemberOpen && canEdit && (
              <div className="mt-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 shrink-0">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    list="ot-member-candidates"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    placeholder="구성원 이름"
                    className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold focus:outline-none"
                  />
                  <datalist id="ot-member-candidates">
                    {members.map((m) => (
                      <option key={m.instructor_id} value={m.name}>
                        {m.department}
                      </option>
                    ))}
                  </datalist>
                  <input
                    value={newMemberJob}
                    onChange={(e) => setNewMemberJob(e.target.value)}
                    placeholder="직무/부서 (예: 편집)"
                    className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newMemberPeriod}
                    onChange={(e) => setNewMemberPeriod(e.target.value)}
                    placeholder="입사일 - 퇴직일까지"
                    className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs focus:outline-none"
                  />
                  <select
                    value={newMemberStatus}
                    onChange={(e) =>
                      setNewMemberStatus(
                        e.target.value as "ACTIVE" | "SCHEDULED"
                      )
                    }
                    className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-bold focus:outline-none"
                  >
                    <option value="ACTIVE">적용 중</option>
                    <option value="SCHEDULED">적용 예정</option>
                  </select>
                </div>
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAddMemberOpen(false)}
                    className="px-3 py-1.5 rounded-lg text-slate-500 font-semibold hover:bg-slate-200/60"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={handleAddAssignedMember}
                    className="px-3.5 py-1.5 rounded-lg bg-[#00c458] text-white font-extrabold"
                  >
                    추가하기
                  </button>
                </div>
              </div>
            )}

            {/* 탭: 적용 중 / 적용 예정 / 과거 적용 (Image 7 동일) */}
            <div className="mt-4 flex items-center gap-5 border-b border-slate-200 shrink-0">
              {(
                [
                  { id: "ACTIVE", label: "적용 중" },
                  { id: "SCHEDULED", label: "적용 예정" },
                  { id: "PAST", label: "과거 적용" },
                ] as const
              ).map((t) => {
                const cnt = viewingPolicy.assigned_members.filter(
                  (m) => m.status === t.id
                ).length;
                const active = memberViewerTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setMemberViewerTab(t.id)}
                    className={`pb-2.5 text-xs font-extrabold border-b-2 flex items-center gap-1 transition-colors ${
                      active
                        ? "border-slate-900 text-slate-900"
                        : "border-transparent text-slate-400 hover:text-slate-700"
                    }`}
                  >
                    <span>{t.label}</span>
                    {cnt > 0 && (
                      <span
                        className={
                          t.id === "ACTIVE"
                            ? "text-[#00c458]"
                            : "text-slate-400"
                        }
                      >
                        {cnt}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 구성원 리스트 */}
            <div className="flex-1 overflow-y-auto custom-scroll divide-y divide-slate-100 mt-1 pr-0.5">
              {viewingPolicy.assigned_members.filter(
                (m) => m.status === memberViewerTab
              ).length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  해당하는 구성원이 없습니다.
                </div>
              ) : (
                viewingPolicy.assigned_members
                  .filter((m) => m.status === memberViewerTab)
                  .map((m, idx) => (
                    <div
                      key={`${m.id}-${idx}`}
                      className="py-3.5 flex items-center justify-between gap-3 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          style={{
                            backgroundColor:
                              m.avatar_bg ||
                              AVATAR_PALETTE[idx % AVATAR_PALETTE.length],
                          }}
                          className="w-9 h-9 rounded-xl text-white text-xs font-extrabold flex items-center justify-center shrink-0"
                        >
                          {shortAvatarText(m.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-slate-900 truncate">
                            {m.name}
                          </div>
                          {m.job_label && (
                            <div className="text-[11px] text-slate-400 truncate">
                              {m.job_label}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-slate-500">
                          {m.period_label}
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => {
                              const nextList =
                                m.status === "PAST"
                                  ? viewingPolicy.assigned_members.filter(
                                      (x) => x.id !== m.id
                                    )
                                  : viewingPolicy.assigned_members.map((x) =>
                                      x.id === m.id
                                        ? { ...x, status: "PAST" as const }
                                        : x
                                    );
                              updatePolicyMembers(
                                viewingPolicy.id,
                                nextList,
                                m.status === "PAST"
                                  ? `'${m.name}' 기록이 삭제되었습니다.`
                                  : `'${m.name}' 구성원이 과거 적용으로 이동되었습니다.`
                              );
                            }}
                            className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded bg-slate-100 hover:bg-rose-50 text-[10px] font-bold text-slate-400 hover:text-rose-500 transition-opacity"
                            title={
                              m.status === "PAST" ? "목록에서 삭제" : "적용 해제"
                            }
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
