// src/components/hq/settings/HqWorkPolicySettingsSection.tsx
"use client";

import React, { useMemo, useState } from "react";
import {
  DEFAULT_APPROVAL_POLICIES,
  DEFAULT_WORK_CONDITION_RULES,
  DEFAULT_WORK_FORM_POLICIES,
  PRESET_ASSIGNEES,
} from "@/lib/hq/defaultApprovalPolicies";
import type {
  HqApprovalPolicyItem,
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqMember,
  HqPolicyAssignee,
  HqPolicyStep,
  HqWorkConditionRule,
  HqWorkFormPolicy,
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
  "#fb923c",
  "#f87171",
  "#60a5fa",
  "#a78bfa",
  "#fbbf24",
];

const WORK_FORM_ICONS = ["🏢", "💼", "🚗", "🏠", "✈️", "📚", "🖨️", "🎓"];

/**
 * 모달 내 '승인 · 참조자 선택' 우측 미니 아바타 스택 ([👤][종현] › 또는 사용 안 함 ›)
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
      <span className="flex items-center -space-x-1.5">
        {combined.slice(0, 4).map((item, idx) =>
          item.kind === "ROLE" ? (
            <span
              key={`${item.id}-${idx}`}
              title={item.name}
              className="w-6 h-6 rounded-full bg-slate-200 border-2 border-white text-slate-500 flex items-center justify-center text-[11px] font-bold"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </span>
          ) : (
            <span
              key={`${item.id}-${idx}`}
              title={item.name}
              style={{ backgroundColor: item.avatar_bg || "#9ba8cf" }}
              className="w-6 h-6 rounded-full border-2 border-white text-white text-[9px] font-extrabold flex items-center justify-center"
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

export default function HqWorkPolicySettingsSection({
  settings,
  members,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: Props) {
  const ex = settings.extra_settings || {};

  const approvalPolicies: HqApprovalPolicyItem[] =
    ex.approval_policies && ex.approval_policies.length > 0
      ? ex.approval_policies
      : DEFAULT_APPROVAL_POLICIES;

  const conditionRules: HqWorkConditionRule[] =
    ex.work_condition_rules && ex.work_condition_rules.length > 0
      ? ex.work_condition_rules
      : DEFAULT_WORK_CONDITION_RULES;

  const workForms: HqWorkFormPolicy[] =
    ex.work_form_policies && ex.work_form_policies.length > 0
      ? ex.work_form_policies
      : DEFAULT_WORK_FORM_POLICIES;

  const policyMap = useMemo(
    () => new Map(approvalPolicies.map((p) => [p.id, p])),
    [approvalPolicies]
  );

  // 1) 승인·참조 상황별 모달 상태 (Images 3, 4, 5, 11, 12)
  const [condDraft, setCondDraft] = useState<HqWorkConditionRule | null>(null);

  // 2) 근무 정책 생성/수정 모달 상태 (Images 6, 7, 8, 9, 10)
  const [formDraft, setFormDraft] = useState<HqWorkFormPolicy | null>(null);
  const [isNewForm, setIsNewForm] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);
  const [formModalMenuOpen, setFormModalMenuOpen] = useState(false);

  // 현재 열려 있는 모달과 1:1 연결된 결재선(참조/승인단계) 드래프트
  const [lineCcDraft, setLineCcDraft] = useState<HqPolicyAssignee[]>([]);
  const [lineStepsDraft, setLineStepsDraft] = useState<HqPolicyStep[]>([]);
  const [lineAllowEditDraft, setLineAllowEditDraft] = useState(false);

  // 중첩 '승인 · 참조자 선택' 서브 모달 & 대상 피커 상태
  const [lineModalOpen, setLineModalOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<
    null | { type: "CC" } | { type: "STEP"; stepIndex: number }
  >(null);
  const [pickerKeyword, setPickerKeyword] = useState("");

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

  // 상황별 승인·참조 모달 열기
  const openConditionModal = (rule: HqWorkConditionRule) => {
    const linked = policyMap.get(rule.policy_id);
    setCondDraft({ ...rule });
    setFormDraft(null);
    setLineCcDraft(
      linked ? JSON.parse(JSON.stringify(linked.cc_list)) : []
    );
    setLineStepsDraft(
      linked ? JSON.parse(JSON.stringify(linked.steps)) : []
    );
    setLineAllowEditDraft(Boolean(linked?.allow_edit));
  };

  // 근무 정책 수정 모달 열기
  const openEditWorkFormModal = (form: HqWorkFormPolicy) => {
    setOpenCardMenuId(null);
    const linked = policyMap.get(form.policy_id);
    setFormDraft({ ...form });
    setCondDraft(null);
    setIsNewForm(false);
    setIconPickerOpen(false);
    setFormModalMenuOpen(false);
    setLineCcDraft(
      linked ? JSON.parse(JSON.stringify(linked.cc_list)) : []
    );
    setLineStepsDraft(
      linked ? JSON.parse(JSON.stringify(linked.steps)) : []
    );
    setLineAllowEditDraft(Boolean(linked?.allow_edit));
  };

  // + 추가하기 (새 근무 정책 생성 — Image 10 동일)
  const openCreateWorkFormModal = () => {
    const newId = `wf-form-${uid()}`;
    const newPolId = `wk-custom-${uid()}`;
    setFormDraft({
      id: newId,
      policy_id: newPolId,
      name: "",
      icon: "🏢",
      description: "",
      is_mandatory: false,
      available_time_range: "제한 없음",
      schedule_share_scope: "공유 안함",
      offsite_restriction: "사용 안 함",
      allow_night_work: false,
      allow_holiday_work: false,
      reason_required: false,
    });
    setCondDraft(null);
    setIsNewForm(true);
    setIconPickerOpen(false);
    setFormModalMenuOpen(false);
    setLineCcDraft([]);
    setLineStepsDraft([]);
    setLineAllowEditDraft(false);
  };

  // 상황별 모달 저장 (work_condition_rules + approval_policies 동시 동기화)
  const handleSaveConditionModal = async () => {
    if (!condDraft) return;
    const cleanedSteps = lineStepsDraft
      .filter((s) => s.assignees.length > 0)
      .map((s, idx) => ({ ...s, step_order: idx + 1 }));
    const hasAnyAssignee =
      cleanedSteps.length > 0 || lineCcDraft.length > 0;

    const updatedCond: HqWorkConditionRule = {
      ...condDraft,
      reason_required: hasAnyAssignee ? condDraft.reason_required : false,
    };

    const nextConds = conditionRules.map((c) =>
      c.policy_id === updatedCond.policy_id ? updatedCond : c
    );

    const nextPolicies = approvalPolicies.map((p) =>
      p.id === updatedCond.policy_id
        ? {
            ...p,
            allow_edit: lineAllowEditDraft,
            cc_list: lineCcDraft,
            steps: cleanedSteps,
          }
        : p
    );

    await onSaveExtra(
      {
        work_condition_rules: nextConds,
        approval_policies: nextPolicies,
      },
      `'${updatedCond.title}' 정책이 저장되었습니다.`
    );
    setCondDraft(null);
  };

  // 근무 정책 모달 저장 (work_form_policies + approval_policies 동시 동기화)
  const handleSaveWorkFormModal = async () => {
    if (!formDraft) return;
    if (!formDraft.name.trim()) {
      alert("근무 정책 이름을 입력해주세요.");
      return;
    }

    const cleanedSteps = lineStepsDraft
      .filter((s) => s.assignees.length > 0)
      .map((s, idx) => ({ ...s, step_order: idx + 1 }));
    const hasAnyAssignee =
      cleanedSteps.length > 0 || lineCcDraft.length > 0;

    const finalizedForm: HqWorkFormPolicy = {
      ...formDraft,
      name: formDraft.name.trim(),
      description: formDraft.description.trim(),
      reason_required: hasAnyAssignee ? formDraft.reason_required : false,
    };

    const nextForms = isNewForm
      ? [...workForms, finalizedForm]
      : workForms.map((f) => (f.id === finalizedForm.id ? finalizedForm : f));

    let nextPolicies: HqApprovalPolicyItem[];
    if (policyMap.has(finalizedForm.policy_id)) {
      nextPolicies = approvalPolicies.map((p) =>
        p.id === finalizedForm.policy_id
          ? {
              ...p,
              title: finalizedForm.name,
              icon: finalizedForm.icon,
              description: finalizedForm.description || undefined,
              allow_edit: lineAllowEditDraft,
              cc_list: lineCcDraft,
              steps: cleanedSteps,
            }
          : p
      );
    } else {
      const createdPol: HqApprovalPolicyItem = {
        id: finalizedForm.policy_id,
        category: "work",
        title: finalizedForm.name,
        description: finalizedForm.description || undefined,
        icon: finalizedForm.icon,
        allow_edit: lineAllowEditDraft,
        per_requester: false,
        cc_list: lineCcDraft,
        steps: cleanedSteps,
      };
      nextPolicies = [createdPol, ...approvalPolicies];
    }

    await onSaveExtra(
      {
        work_form_policies: nextForms,
        approval_policies: nextPolicies,
      },
      isNewForm
        ? `'${finalizedForm.name}' 근무 정책이 추가되었습니다.`
        : `'${finalizedForm.name}' 근무 정책이 저장되었습니다.`
    );
    setFormDraft(null);
  };

  // 근무 정책 복제
  const handleDuplicateWorkForm = async (source: HqWorkFormPolicy) => {
    setOpenCardMenuId(null);
    setFormModalMenuOpen(false);
    const linked = policyMap.get(source.policy_id);
    const newPolId = `wk-custom-${uid()}`;
    const clonedForm: HqWorkFormPolicy = {
      ...source,
      id: `wf-form-${uid()}`,
      policy_id: newPolId,
      name: `${source.name} (복사본)`,
      is_mandatory: false,
    };
    const clonedPol: HqApprovalPolicyItem = {
      id: newPolId,
      category: "work",
      title: clonedForm.name,
      description: clonedForm.description || undefined,
      icon: clonedForm.icon,
      allow_edit: Boolean(linked?.allow_edit),
      per_requester: false,
      cc_list: linked ? JSON.parse(JSON.stringify(linked.cc_list)) : [],
      steps: linked ? JSON.parse(JSON.stringify(linked.steps)) : [],
    };
    await onSaveExtra(
      {
        work_form_policies: [...workForms, clonedForm],
        approval_policies: [...approvalPolicies, clonedPol],
      },
      `'${clonedForm.name}' 정책이 복제되었습니다.`
    );
  };

  // 근무 정책 삭제
  const handleDeleteWorkForm = async (target: HqWorkFormPolicy) => {
    setOpenCardMenuId(null);
    setFormModalMenuOpen(false);
    if (target.is_mandatory) {
      alert("기본 필수 근무 정책은 삭제할 수 없습니다.");
      return;
    }
    if (!confirm(`'${target.name}' 근무 정책을 삭제하시겠습니까?`)) return;
    await onSaveExtra(
      {
        work_form_policies: workForms.filter((f) => f.id !== target.id),
        approval_policies: approvalPolicies.filter(
          (p) => p.id !== target.policy_id
        ),
      },
      `'${target.name}' 근무 정책이 삭제되었습니다.`
    );
    if (formDraft?.id === target.id) setFormDraft(null);
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

  const hasActiveDraftAssignees =
    lineStepsDraft.some((s) => s.assignees.length > 0) ||
    lineCcDraft.length > 0;

  return (
    <>
      <div className="space-y-9">
        <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
          근무 정책 · 승인
        </h2>

        {/* =============================================================== */}
        {/* 섹션 1: 승인 · 참조 (상황별 7개 카드 — Image 1)                   */}
        {/* =============================================================== */}
        <section className="space-y-3.5">
          <div>
            <h3 className="text-[15px] font-extrabold text-slate-900">
              승인 · 참조
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              근무 조건 · 상황별로 승인 및 참조 절차를 설정하고 승인자를 지정해 주세요.
            </p>
          </div>

          <div className="space-y-2.5">
            {conditionRules.map((cond) => {
              const linked = policyMap.get(cond.policy_id);
              const stepCnt = (linked?.steps || []).filter(
                (s) => s.assignees.length > 0
              ).length;
              const ccCnt = linked?.cc_list.length || 0;

              return (
                <div
                  key={cond.policy_id}
                  onClick={() => openConditionModal(cond)}
                  className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center justify-between gap-3 shadow-2xs cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-base shrink-0">
                      {cond.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-slate-900">
                        {cond.title}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {cond.subtitle}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 text-[11px]">
                    {stepCnt > 0 ? (
                      <span className="px-2.5 py-1 rounded-md bg-sky-50 text-sky-600 font-bold flex items-center gap-1">
                        <span className="text-[10px]">🛫</span>
                        <span>{stepCnt}단계 승인</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-md bg-slate-50 text-slate-400 font-medium">
                        승인 없음
                      </span>
                    )}

                    {ccCnt > 0 ? (
                      <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-bold">
                        참조 {ccCnt}
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-md bg-slate-50 text-slate-400 font-medium">
                        참조 없음
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* =============================================================== */}
        {/* 섹션 2: 근무 정책 (근무/외근/원격근무/출장 + 추가하기 — Image 2)  */}
        {/* =============================================================== */}
        <section className="space-y-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-extrabold text-slate-900">
                근무 정책
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                회사의 근무 환경과 문화를 고려하여 근무 정책을 설정해 보세요.
              </p>
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={openCreateWorkFormModal}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
              >
                <span className="text-[#00c458] font-extrabold text-sm leading-none">
                  +
                </span>
                <span>추가하기</span>
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {workForms.map((wf) => {
              const linked = policyMap.get(wf.policy_id);
              const stepCnt = (linked?.steps || []).filter(
                (s) => s.assignees.length > 0
              ).length;
              const ccCnt = linked?.cc_list.length || 0;

              return (
                <div
                  key={wf.id}
                  onClick={() => openEditWorkFormModal(wf)}
                  className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center justify-between gap-3 shadow-2xs cursor-pointer relative"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-base shrink-0">
                      {wf.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-bold text-slate-900">
                          {wf.name}
                        </span>
                        {wf.is_mandatory && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                            필수
                          </span>
                        )}
                      </div>
                      {wf.description && (
                        <p className="text-xs text-slate-400 mt-0.5 truncate">
                          {wf.description}
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
                        onClick={() => openEditWorkFormModal(wf)}
                        className="px-2.5 py-1 rounded-md bg-sky-50 text-sky-600 font-bold flex items-center gap-1"
                      >
                        <span className="text-[10px]">🛫</span>
                        <span>{stepCnt}단계 승인</span>
                      </span>
                    ) : (
                      <span
                        onClick={() => openEditWorkFormModal(wf)}
                        className="px-2.5 py-1 rounded-md bg-slate-50 text-slate-400 font-medium"
                      >
                        승인 없음
                      </span>
                    )}

                    {ccCnt > 0 ? (
                      <span
                        onClick={() => openEditWorkFormModal(wf)}
                        className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-bold"
                      >
                        참조 {ccCnt}
                      </span>
                    ) : (
                      <span
                        onClick={() => openEditWorkFormModal(wf)}
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
                              p === wf.id ? null : wf.id
                            )
                          }
                          className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold text-xs"
                        >
                          ⋯
                        </button>

                        {openCardMenuId === wf.id && (
                          <div className="absolute right-0 mt-1 w-36 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                            <button
                              type="button"
                              onClick={() => openEditWorkFormModal(wf)}
                              className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              정책 설정
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateWorkForm(wf)}
                              className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              정책 복제
                            </button>
                            {!wf.is_mandatory && (
                              <>
                                <div className="my-1 border-t border-slate-100" />
                                <button
                                  type="button"
                                  onClick={() => handleDeleteWorkForm(wf)}
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

        {/* 하단 이전/다음 이동 카드 (Image 2 동일: 근무 유형 ← / → 초과 근무 보상) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("work-type")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                근무 유형
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("overtime-comp")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                초과 근무 보상
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 모달 A: 승인 · 참조 상황별 상세 모달 (Images 3, 4, 5, 11, 12)       */}
      {/* ================================================================= */}
      {condDraft && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[480px] max-h-[88vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            <div className="flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setCondDraft(null)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-5">
              {/* 타이틀 + 서브타이틀 */}
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">{condDraft.icon}</span>
                  <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                    {condDraft.title}
                  </h3>
                </div>
                <p className="text-slate-500 mt-2 leading-relaxed">
                  {condDraft.policy_id === "wk-offsite-reg"
                    ? "승인 · 참조 대상을 지정하면 근무지 밖에서도 근무를 종료하거나 변경할 수 있어요."
                    : condDraft.subtitle}
                </p>
              </div>

              {/* 과거 근무 수정 전용 안내 박스 (Image 11 동일) */}
              {condDraft.policy_id === "wk-edit-past" && (
                <div className="rounded-xl bg-[#f8f9fa] p-4 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-extrabold text-slate-800">
                    <span className="px-1.5 py-0.5 rounded bg-blue-500 text-white text-[10px]">
                      안내
                    </span>
                    <span>언제 승인과 참조 알림을 보내나요?</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    입력일을 기준으로{" "}
                    <span className="underline font-bold text-slate-700">
                      {condDraft.past_edit_limit_days || "3일"}
                    </span>
                    이 지난 일정을 구성원이 변경하는 경우, 승인 · 참조 알림이 발송돼요. 구성원이 지난 근무를 변경하지 못하게 하려면 설정해두세요.
                  </p>
                </div>
              )}

              {/* 근무지 밖 근무 등록 전용 시각 안내 박스 (Image 5 동일) */}
              {condDraft.policy_id === "wk-offsite-reg" && (
                <div className="rounded-xl bg-[#f8f9fa] p-4 space-y-3">
                  <div>
                    <div className="flex items-center gap-1.5 font-extrabold text-slate-800 mb-1">
                      <span className="px-1.5 py-0.5 rounded bg-blue-500 text-white text-[10px]">
                        안내
                      </span>
                      <span>왜 필요한가요?</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      깜빡하고 &apos;근무 끝내기&apos;를 누르지 않고 퇴근한 날에도 기록이 누락되지 않도록 도와줘요. 근무지에서 얼마나 떨어진 곳에서 근무 종료 또는 변경했는지 알 수 있어요.
                    </p>
                  </div>

                  <div className="pt-1 flex items-center justify-center gap-2.5">
                    <span className="px-3 py-1.5 rounded-lg bg-[#00c458] text-white text-[10px] font-extrabold shadow-xs">
                      근무지 밖에서 끝내기
                    </span>
                    <span className="text-emerald-400 text-xs">⇢</span>
                    <div className="px-3 py-2 rounded-xl bg-white border border-slate-200/80 shadow-xs text-[10px] flex items-center gap-2">
                      <span className="text-amber-500 text-sm">🛡️</span>
                      <div>
                        <div className="text-slate-400 font-semibold">
                          근무지 밖 근무 등록
                        </div>
                        <div className="font-bold text-slate-800">
                          근무지로부터 12km 떨어진 곳에서
                          <br />
                          근무를 종료했어요.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 설정 행들 */}
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {/* 1) 승인 · 참조자 선택 */}
                <button
                  type="button"
                  onClick={() => setLineModalOpen(true)}
                  className="w-full py-4 flex items-center justify-between gap-4 text-left hover:bg-slate-50/60 transition-colors"
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

                {/* 2) 휴일 근무 전용: 구성원의 휴일 대체 신청 허용 (Image 4) */}
                {condDraft.policy_id === "wk-holiday" && (
                  <div className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800 text-[13px]">
                        구성원의 휴일 대체 신청 허용
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                        휴일 근무 등록 시 구성원이 휴일 대체를 신청할 수 있어요.
                        <br />
                        휴일 대체 신청 시 승인 · 참조가 발생해요.
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        setCondDraft({
                          ...condDraft,
                          allow_holiday_substitute:
                            !condDraft.allow_holiday_substitute,
                        })
                      }
                      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                        condDraft.allow_holiday_substitute
                          ? "bg-[#00c458]"
                          : "bg-slate-200"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                          condDraft.allow_holiday_substitute
                            ? "translate-x-5"
                            : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                )}

                {/* 3) 사유 입력 필수 */}
                <div
                  className={`py-4 flex items-center justify-between gap-4 ${
                    !hasActiveDraftAssignees ? "opacity-45" : ""
                  }`}
                >
                  <div>
                    <div className="font-bold text-slate-800 text-[13px]">
                      사유 입력 필수
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {condDraft.title} 발생 시, 사유를 입력해야 승인을 요청할 수 있어요.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!canEdit || !hasActiveDraftAssignees}
                    onClick={() =>
                      setCondDraft({
                        ...condDraft,
                        reason_required: !condDraft.reason_required,
                      })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                      condDraft.reason_required && hasActiveDraftAssignees
                        ? "bg-[#00c458]"
                        : "bg-slate-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                        condDraft.reason_required && hasActiveDraftAssignees
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* 4) 과거 근무 수정 전용: 수정 가능 기한 (Image 11) */}
                {condDraft.policy_id === "wk-edit-past" && (
                  <div className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800 text-[13px]">
                        수정 가능 기한
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        등록일부터 언제까지 가능한지 선택해주세요.
                      </div>
                    </div>
                    <select
                      disabled={!canEdit}
                      value={condDraft.past_edit_limit_days || "3일"}
                      onChange={(e) =>
                        setCondDraft({
                          ...condDraft,
                          past_edit_limit_days: e.target.value,
                        })
                      }
                      className="w-36 px-3 py-2 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                    >
                      <option value="당일">당일</option>
                      <option value="1일">1일</option>
                      <option value="3일">3일</option>
                      <option value="7일">7일</option>
                      <option value="14일">14일</option>
                      <option value="30일">30일</option>
                      <option value="제한 없음">제한 없음</option>
                      <option value="수정 불가">수정 불가</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            {canEdit && (
              <div className="pt-6 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveConditionModal}
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
      {/* 모달 B: 근무 정책 생성/수정 모달 (근무/외근/원격/출장/+추가하기)     */}
      {/* ================================================================= */}
      {formDraft && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[520px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            {/* 상단 우측 ⋯ 메뉴 & ✕ */}
            <div className="flex items-center justify-end gap-2 shrink-0 relative">
              {!isNewForm && canEdit && (
                <button
                  type="button"
                  onClick={() => setFormModalMenuOpen((p) => !p)}
                  className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold text-sm"
                >
                  ⋯
                </button>
              )}
              <button
                type="button"
                onClick={() => setFormDraft(null)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>

              {formModalMenuOpen && (
                <div className="absolute right-7 top-8 w-36 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                  <button
                    type="button"
                    onClick={() => handleDuplicateWorkForm(formDraft)}
                    className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    정책 복제
                  </button>
                  {!formDraft.is_mandatory && (
                    <button
                      type="button"
                      onClick={() => handleDeleteWorkForm(formDraft)}
                      className="w-full px-3.5 py-1.5 text-left font-semibold text-rose-500 hover:bg-rose-50"
                    >
                      삭제하기
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-5">
              {/* 아이콘 선택 + 근무 정책 이름 & 설명 입력 (Images 6~10 동일) */}
              <div className="relative">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setIconPickerOpen((p) => !p)}
                    className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-100 flex items-center justify-center text-lg shrink-0"
                    title="아이콘 변경"
                  >
                    {formDraft.icon}
                  </button>
                  <input
                    autoFocus={isNewForm}
                    disabled={!canEdit}
                    value={formDraft.name}
                    onChange={(e) =>
                      setFormDraft({ ...formDraft, name: e.target.value })
                    }
                    placeholder="근무 정책 이름"
                    className="flex-1 text-xl font-extrabold text-slate-900 placeholder:text-slate-300 focus:outline-none"
                  />
                  {!isNewForm && (
                    <span className="text-slate-300 text-xs">✏️</span>
                  )}
                </div>

                {iconPickerOpen && (
                  <div className="absolute left-0 top-10 z-30 p-2 rounded-xl bg-white border border-slate-200 shadow-xl flex items-center gap-1.5">
                    {WORK_FORM_ICONS.map((ic) => (
                      <button
                        key={ic}
                        type="button"
                        onClick={() => {
                          setFormDraft({ ...formDraft, icon: ic });
                          setIconPickerOpen(false);
                        }}
                        className={`w-8 h-8 rounded-lg hover:bg-slate-100 text-base flex items-center justify-center ${
                          formDraft.icon === ic ? "bg-emerald-50 ring-1 ring-emerald-400" : ""
                        }`}
                      >
                        {ic}
                      </button>
                    ))}
                  </div>
                )}

                <input
                  disabled={!canEdit}
                  value={formDraft.description}
                  onChange={(e) =>
                    setFormDraft({ ...formDraft, description: e.target.value })
                  }
                  placeholder="이 근무 정책에 대한 설명을 입력해주세요"
                  className="mt-2.5 w-full pb-1 border-b border-slate-200 text-xs text-slate-600 placeholder:text-slate-400 placeholder:underline focus:outline-none focus:border-slate-400"
                />
              </div>

              {/* 근무 정책 세부 항목들 */}
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {/* 1) 사용 가능 시간 */}
                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-slate-800 text-[13px]">
                      사용 가능 시간
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      근무 정책을 사용할 때, 등록 가능한 시간 범위예요.
                    </div>
                  </div>
                  <select
                    disabled={!canEdit}
                    value={formDraft.available_time_range}
                    onChange={(e) =>
                      setFormDraft({
                        ...formDraft,
                        available_time_range:
                          e.target.value as HqWorkFormPolicy["available_time_range"],
                      })
                    }
                    className="w-40 px-3 py-2 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                  >
                    <option value="제한 없음">제한 없음</option>
                    <option value="정규 근무 시간 내">정규 근무 시간 내</option>
                    <option value="평일 08:00 ~ 20:00">
                      평일 08:00 ~ 20:00
                    </option>
                  </select>
                </div>

                {/* 2) 등록시 일정 공유 */}
                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-slate-800 text-[13px]">
                      등록시 일정 공유
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      구성원들이 서로의 일정을 확인할 수 있어요.
                    </div>
                  </div>
                  <select
                    disabled={!canEdit}
                    value={formDraft.schedule_share_scope}
                    onChange={(e) =>
                      setFormDraft({
                        ...formDraft,
                        schedule_share_scope:
                          e.target.value as HqWorkFormPolicy["schedule_share_scope"],
                      })
                    }
                    className="w-40 px-3 py-2 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                  >
                    <option value="공유 안함">공유 안함</option>
                    <option value="소속 조직 공유">소속 조직 공유</option>
                    <option value="전사 공유">전사 공유</option>
                  </select>
                </div>

                {/* 3) 근무지 밖 근무 등록 제한 */}
                <div className="py-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="font-bold text-slate-800 text-[13px]">
                      근무지 밖 근무 등록 제한
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      정해진 근무지에서만 출퇴근하도록 설정할 수 있어요.
                      <br />
                      <button
                        type="button"
                        onClick={() => {
                          setFormDraft(null);
                          onNavigateTab("work-place");
                        }}
                        className="underline hover:text-slate-700 font-semibold"
                      >
                        근무지 설정
                      </button>{" "}
                      ·{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setFormDraft(null);
                          onNavigateTab("work-place");
                        }}
                        className="underline hover:text-slate-700 font-semibold"
                      >
                        IP 설정
                      </button>
                    </div>
                  </div>

                  <div className="text-right">
                    <select
                      disabled={!canEdit}
                      value={formDraft.offsite_restriction}
                      onChange={(e) =>
                        setFormDraft({
                          ...formDraft,
                          offsite_restriction:
                            e.target.value as HqWorkFormPolicy["offsite_restriction"],
                        })
                      }
                      className="w-40 px-3 py-2 rounded-xl bg-[#f5f6f8] font-bold text-slate-700 focus:outline-none"
                    >
                      <option value="사용 안 함">사용 안 함</option>
                      <option value="GPS 위치 제한">GPS 위치 제한</option>
                      <option value="IP 네트워크 제한">IP 네트워크 제한</option>
                      <option value="GPS · IP 모두 제한">
                        GPS · IP 모두 제한
                      </option>
                    </select>
                    <div className="text-[10px] text-slate-400 mt-1">
                      GPS · IP 제한을 사용하기 위해 설정이 필요해요.
                    </div>
                  </div>
                </div>

                {/* 4) 야간 근무 등록 허용 */}
                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-slate-800 text-[13px]">
                      야간 근무 등록 허용
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      오후 10:00 ~ 익일 새벽 6:00에 근무 기록이 가능해요.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() =>
                      setFormDraft({
                        ...formDraft,
                        allow_night_work: !formDraft.allow_night_work,
                      })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                      formDraft.allow_night_work
                        ? "bg-[#00c458]"
                        : "bg-slate-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                        formDraft.allow_night_work
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* 5) 휴일 근무 등록 허용 */}
                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-slate-800 text-[13px]">
                      휴일 근무 등록 허용
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      주휴일을 비롯한 휴일에 근무를 등록할 수 있어요.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() =>
                      setFormDraft({
                        ...formDraft,
                        allow_holiday_work: !formDraft.allow_holiday_work,
                      })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                      formDraft.allow_holiday_work
                        ? "bg-[#00c458]"
                        : "bg-slate-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                        formDraft.allow_holiday_work
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* 6) 승인 · 참조자 선택 */}
                <button
                  type="button"
                  onClick={() => setLineModalOpen(true)}
                  className="w-full py-4 flex items-center justify-between gap-4 text-left hover:bg-slate-50/60 transition-colors"
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

                {/* 7) 사유 입력 필수 */}
                <div
                  className={`py-4 flex items-center justify-between gap-4 ${
                    !hasActiveDraftAssignees ? "opacity-45" : ""
                  }`}
                >
                  <div>
                    <div className="font-bold text-slate-800 text-[13px]">
                      사유 입력 필수
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {formDraft.name || "근무"} 발생 시, 사유를 입력해야 승인을 요청할 수 있어요.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!canEdit || !hasActiveDraftAssignees}
                    onClick={() =>
                      setFormDraft({
                        ...formDraft,
                        reason_required: !formDraft.reason_required,
                      })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                      formDraft.reason_required && hasActiveDraftAssignees
                        ? "bg-[#00c458]"
                        : "bg-slate-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                        formDraft.reason_required && hasActiveDraftAssignees
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {canEdit && (
              <div className="pt-5 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveWorkFormModal}
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
      {/* 중첩 모달 C: 승인 · 참조자 선택 편집기                              */}
      {/* ================================================================= */}
      {lineModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[85] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] max-h-[85vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-6">
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
                {condDraft?.title || formDraft?.name || "근무 정책"}
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

      {/* ================================================================= */}
      {/* 중첩 모달 D: 승인자 / 참조자 피커                                  */}
      {/* ================================================================= */}
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
