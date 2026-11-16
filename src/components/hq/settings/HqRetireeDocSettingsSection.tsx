// src/components/hq/settings/HqRetireeDocSettingsSection.tsx
"use client";

import React, { useMemo, useState } from "react";
import {
  DEFAULT_APPROVAL_POLICIES,
  DEFAULT_RETIREE_DOC_SETTINGS,
  PRESET_ASSIGNEES,
  RETIREE_DOC_PERIOD_OPTIONS,
} from "@/lib/hq/defaultApprovalPolicies";
import type {
  HqApprovalPolicyItem,
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqMember,
  HqPolicyAssignee,
  HqPolicyStep,
  HqRetireeDocSettingItem,
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
        <span>결재선 선택</span>
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
              className="w-6 h-6 rounded-full bg-slate-200 border-2 border-white text-slate-600 flex items-center justify-center text-[10px] font-extrabold"
            >
              {item.role_key === "ORG_HEAD_1"
                ? "1"
                : item.role_key === "ORG_HEAD_2"
                  ? "2"
                  : "HR"}
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

export default function HqRetireeDocSettingsSection({
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

  const retireeDocs: HqRetireeDocSettingItem[] = useMemo(() => {
    const saved = ex.retiree_doc_settings;
    if (!Array.isArray(saved) || saved.length === 0) {
      return DEFAULT_RETIREE_DOC_SETTINGS;
    }
    const savedMap = new Map(saved.map((item) => [item.id, item]));
    return DEFAULT_RETIREE_DOC_SETTINGS.map((defItem) => {
      const found = savedMap.get(defItem.id);
      return found
        ? {
            ...defItem,
            ...found,
            supports_approval: defItem.supports_approval,
            policy_id: defItem.policy_id,
          }
        : defItem;
    });
  }, [ex.retiree_doc_settings]);

  const policyMap = useMemo(
    () => new Map(approvalPolicies.map((p) => [p.id, p])),
    [approvalPolicies]
  );

  // 문서 설정 모달 상태 (스크린샷 162702 ~ 162737)
  const [docDraft, setDocDraft] = useState<HqRetireeDocSettingItem | null>(
    null
  );
  const [periodDropdownOpen, setPeriodDropdownOpen] = useState(false);

  // 승인 사용 시 결재선 드래프트 (승인 정책 관리 > [퇴직자 문서]와 1:1 양방향 동기화)
  const [lineStepsDraft, setLineStepsDraft] = useState<HqPolicyStep[]>([]);
  const [lineCcDraft, setLineCcDraft] = useState<HqPolicyAssignee[]>([]);
  const [lineAllowEditDraft, setLineAllowEditDraft] = useState(false);
  const [lineModalOpen, setLineModalOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<
    null | { type: "CC" } | { type: "STEP"; stepIndex: number }
  >(null);
  const [pickerKeyword, setPickerKeyword] = useState("");

  // 결재·참조 지정 후보 구성원 풀
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
              ? `${m.department} · ${m.job_title}`
              : m.job_title,
          avatar_bg: AVATAR_PALETTE[idx % AVATAR_PALETTE.length],
          notify_mode: "BOTH",
          step_action: "승인",
        });
      });
    Object.values(PRESET_ASSIGNEES).forEach((preset) => {
      if (preset.kind === "MEMBER" && !map.has(preset.name)) {
        map.set(preset.name, preset);
      }
    });
    return Array.from(map.values());
  }, [members]);

  const roleAssignees: HqPolicyAssignee[] = [
    PRESET_ASSIGNEES.ORG_HEAD_1,
    PRESET_ASSIGNEES.ORG_HEAD_2,
    PRESET_ASSIGNEES.HR_MANAGER,
  ];

  const openDocModal = (doc: HqRetireeDocSettingItem) => {
    const linkedPol = doc.policy_id ? policyMap.get(doc.policy_id) : undefined;
    const hasLinkedLine = Boolean(
      linkedPol &&
        (linkedPol.steps.some((s) => s.assignees.length > 0) ||
          linkedPol.cc_list.length > 0)
    );
    const effectiveUseApproval = doc.supports_approval && hasLinkedLine;

    setDocDraft({
      ...doc,
      use_approval: effectiveUseApproval,
    });
    setPeriodDropdownOpen(false);
    setLineStepsDraft(
      linkedPol ? JSON.parse(JSON.stringify(linkedPol.steps)) : []
    );
    setLineCcDraft(
      linkedPol ? JSON.parse(JSON.stringify(linkedPol.cc_list)) : []
    );
    setLineAllowEditDraft(Boolean(linkedPol?.allow_edit));
  };

  const closeDocModal = () => {
    setDocDraft(null);
    setPeriodDropdownOpen(false);
    setLineModalOpen(false);
    setPickerTarget(null);
  };

  const handleToggleUseApproval = () => {
    if (!docDraft || !canEdit || !docDraft.allow_issue) return;
    const nextVal = !docDraft.use_approval;
    setDocDraft({ ...docDraft, use_approval: nextVal });
    if (nextVal && lineStepsDraft.length === 0) {
      setLineStepsDraft([
        {
          step_order: 1,
          assignees: [{ ...PRESET_ASSIGNEES.ORG_HEAD_1 }],
        },
      ]);
    }
  };

  const handlePickAssignee = (chosen: HqPolicyAssignee) => {
    if (!pickerTarget) return;
    const copy: HqPolicyAssignee = {
      ...chosen,
      id: `${chosen.id}-${uid()}`,
      notify_mode: "BOTH",
      step_action: "승인",
    };

    if (pickerTarget.type === "CC") {
      if (!lineCcDraft.some((c) => c.name === copy.name)) {
        setLineCcDraft([...lineCcDraft, copy]);
      }
    } else {
      const nextSteps = lineStepsDraft.map((st, idx) => {
        if (idx !== pickerTarget.stepIndex) return st;
        if (st.assignees.some((a) => a.name === copy.name)) return st;
        return { ...st, assignees: [...st.assignees, copy] };
      });
      setLineStepsDraft(nextSteps);
    }
    setPickerTarget(null);
    setPickerKeyword("");
  };

  const handleSaveDoc = async () => {
    if (!docDraft) return;

    const cleanSteps =
      docDraft.supports_approval && docDraft.use_approval && docDraft.allow_issue
        ? lineStepsDraft
            .filter((s) => s.assignees.length > 0)
            .map((s, idx) => ({ ...s, step_order: idx + 1 }))
        : [];
    const cleanCc =
      docDraft.supports_approval && docDraft.use_approval && docDraft.allow_issue
        ? lineCcDraft
        : [];

    const effectiveUseApproval =
      docDraft.supports_approval &&
      docDraft.allow_issue &&
      docDraft.use_approval &&
      (cleanSteps.length > 0 || cleanCc.length > 0);

    const savedDoc: HqRetireeDocSettingItem = {
      ...docDraft,
      use_approval: effectiveUseApproval,
    };

    const nextRetireeDocs = retireeDocs.map((item) =>
      item.id === savedDoc.id ? savedDoc : item
    );

    let nextApprovalPolicies = approvalPolicies;
    if (savedDoc.supports_approval && savedDoc.policy_id) {
      const exists = approvalPolicies.some((p) => p.id === savedDoc.policy_id);
      if (exists) {
        nextApprovalPolicies = approvalPolicies.map((p) =>
          p.id === savedDoc.policy_id
            ? {
                ...p,
                allow_edit: effectiveUseApproval ? lineAllowEditDraft : false,
                steps: cleanSteps,
                cc_list: cleanCc,
              }
            : p
        );
      } else {
        nextApprovalPolicies = [
          ...approvalPolicies,
          {
            id: savedDoc.policy_id,
            category: "retiree_doc",
            title: savedDoc.title,
            icon: "👤",
            allow_edit: effectiveUseApproval ? lineAllowEditDraft : false,
            per_requester: false,
            steps: cleanSteps,
            cc_list: cleanCc,
          },
        ];
      }
    }

    await onSaveExtra(
      {
        retiree_doc_settings: nextRetireeDocs,
        approval_policies: nextApprovalPolicies,
      },
      `'${savedDoc.title}' 발급 설정이 저장되었습니다.`
    );
    closeDocModal();
  };

  const renderSwitch = (
    checked: boolean,
    onToggle: () => void,
    disabled = false
  ) => (
    <button
      type="button"
      disabled={!canEdit || disabled}
      onClick={onToggle}
      className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${
        checked ? "bg-[#00c458]" : "bg-slate-300"
      } ${!canEdit || disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`w-4 h-4 rounded-full bg-white shadow-xs absolute top-1 transition-all ${
          checked ? "left-5" : "left-1"
        }`}
      />
    </button>
  );

  const regularPeriodOptions = RETIREE_DOC_PERIOD_OPTIONS.filter(
    (o) => !o.subtitle
  );
  const unlimitedPeriodOption = RETIREE_DOC_PERIOD_OPTIONS.find((o) =>
    Boolean(o.subtitle)
  );

  return (
    <>
      <div className="space-y-9">
        {/* 상단 타이틀 (162657 동일) */}
        <div>
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            퇴직자 문서 발급 설정
          </h2>
        </div>

        {/* 퇴직자 발급 문서 목록 */}
        <section className="space-y-4">
          <div>
            <h3 className="text-[15px] font-extrabold text-slate-900">
              퇴직자 발급 문서
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              퇴직자에게 발급할 문서의 발급 여부, 승인 정책을 설정해요.
            </p>
          </div>

          <div className="space-y-2.5">
            {retireeDocs.map((doc) => {
              const linkedPol = doc.policy_id
                ? policyMap.get(doc.policy_id)
                : undefined;
              const activeStepCount = linkedPol
                ? linkedPol.steps.filter((s) => s.assignees.length > 0).length
                : 0;
              const ccCount = linkedPol ? linkedPol.cc_list.length : 0;
              const isUsingApproval =
                doc.supports_approval && (activeStepCount > 0 || ccCount > 0);

              return (
                <div
                  key={doc.id}
                  onClick={() => openDocModal(doc)}
                  className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 transition-colors cursor-pointer shadow-2xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-bold text-slate-900">
                      {doc.title}
                    </span>

                    {!doc.allow_issue ? (
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">
                        발급 안 함
                      </span>
                    ) : !isUsingApproval ? (
                      <span className="px-2 py-0.5 rounded bg-[#eef4ff] text-[#2b6de9] text-[10px] font-bold">
                        즉시 발급
                      </span>
                    ) : (
                      <>
                        {activeStepCount > 0 && (
                          <span className="px-2 py-0.5 rounded bg-[#eef4ff] text-[#2b6de9] text-[10px] font-bold">
                            👤 {activeStepCount}단계 승인
                          </span>
                        )}
                        {ccCount > 0 && (
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                            참조 {ccCount}
                          </span>
                        )}
                        {activeStepCount === 0 && ccCount === 0 && (
                          <span className="px-2 py-0.5 rounded bg-[#eef4ff] text-[#2b6de9] text-[10px] font-bold">
                            승인 사용
                          </span>
                        )}
                      </>
                    )}

                    {doc.allow_issue &&
                      doc.issue_period !== "퇴직일로부터 5년" && (
                        <span className="text-[11px] font-medium text-slate-400">
                          · {doc.issue_period}
                        </span>
                      )}
                  </div>

                  <p className="text-xs text-slate-400 mt-1">
                    {doc.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* 하단 이전/다음 이동 카드 (← 사업장 설정 / 회사 정보 →) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("payroll-workplace")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                사업장 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("company")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                회사 정보
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">처음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 문서별 발급·기간·승인 설정 모달 (스크린샷 162702 ~ 162737 동일)     */}
      {/* ================================================================= */}
      {docDraft && (
        <div
          onClick={() => {
            if (periodDropdownOpen) setPeriodDropdownOpen(false);
          }}
          className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              if (periodDropdownOpen) setPeriodDropdownOpen(false);
            }}
            className="bg-white w-full max-w-[480px] rounded-2xl shadow-2xl border border-slate-200 text-xs overflow-visible"
          >
            {/* 모달 헤더 */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-[15px] font-extrabold text-slate-900 tracking-tight">
                {docDraft.title}
              </h3>
              <button
                type="button"
                onClick={closeDocModal}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center text-base leading-none"
              >
                ✕
              </button>
            </div>

            {/* 모달 본문 */}
            <div className="px-6 py-5 space-y-5">
              {/* 셀프 서비스 노출 안내 박스 */}
              <div className="rounded-xl bg-[#f7f8fa] px-4 py-3.5 flex items-start gap-2.5">
                <span className="w-4 h-4 rounded-full border border-slate-400 text-slate-500 text-[10px] font-extrabold flex items-center justify-center shrink-0 mt-0.5">
                  i
                </span>
                <div>
                  <div className="font-extrabold text-slate-800">
                    발급 허용 시 셀프 서비스에 노출돼요.
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">
                    발급을 허용하면 기준일부터 설정한 기간 동안 셀프 서비스에 노출되어, 퇴직자가 문서를 발급받을 수 있어요. 허용하지 않으면 셀프 서비스에 노출되지 않아요.
                  </p>
                </div>
              </div>

              {/* 문서 발급 허용 & 발급 가능 기간 카드 */}
              <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                <div className="px-4 py-3.5 flex items-center justify-between">
                  <span className="font-bold text-slate-800">문서 발급 허용</span>
                  {renderSwitch(docDraft.allow_issue, () =>
                    setDocDraft({
                      ...docDraft,
                      allow_issue: !docDraft.allow_issue,
                    })
                  )}
                </div>

                <div
                  className={`px-4 py-3.5 flex items-center justify-between gap-3 relative ${
                    !docDraft.allow_issue ? "opacity-50" : ""
                  }`}
                >
                  <div>
                    <div className="font-bold text-slate-800">발급 가능 기간</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      퇴직자가 문서를 발급받을 수 있는 기간이에요.
                    </div>
                  </div>

                  {/* 커스텀 드롭다운 (스크린샷 162719 동일) */}
                  <div
                    className="relative shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={!canEdit || !docDraft.allow_issue}
                      onClick={() => setPeriodDropdownOpen((prev) => !prev)}
                      className={`px-3 py-2 rounded-lg border bg-white text-xs font-semibold flex items-center gap-2 transition-all ${
                        periodDropdownOpen
                          ? "border-[#00c458] ring-2 ring-[#00c458]/15 text-slate-900"
                          : "border-slate-200 hover:bg-slate-50 text-slate-800"
                      }`}
                    >
                      <span>{docDraft.issue_period}</span>
                      <span className="text-slate-400 text-[10px]">
                        {periodDropdownOpen ? "⌃" : "⌄"}
                      </span>
                    </button>

                    {periodDropdownOpen && (
                      <div className="absolute right-0 top-full mt-1.5 w-[240px] bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 z-40 max-h-[340px] overflow-y-auto custom-scroll">
                        {regularPeriodOptions.map((opt) => {
                          const selected = docDraft.issue_period === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                setDocDraft({
                                  ...docDraft,
                                  issue_period: opt.value,
                                });
                                setPeriodDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2 text-left flex items-center gap-2 transition-colors ${
                                selected
                                  ? "bg-slate-100/90 font-bold text-slate-900"
                                  : "hover:bg-slate-50 text-slate-700 font-medium"
                              }`}
                            >
                              <span className="w-4 text-center text-slate-700 font-bold">
                                {selected ? "✓" : ""}
                              </span>
                              <span>{opt.value}</span>
                            </button>
                          );
                        })}

                        {unlimitedPeriodOption && (
                          <>
                            <div className="my-1 border-t border-slate-100" />
                            <button
                              type="button"
                              onClick={() => {
                                setDocDraft({
                                  ...docDraft,
                                  issue_period: unlimitedPeriodOption.value,
                                });
                                setPeriodDropdownOpen(false);
                              }}
                              className={`w-full px-3.5 py-2.5 text-left transition-colors ${
                                docDraft.issue_period ===
                                unlimitedPeriodOption.value
                                  ? "bg-slate-100/90"
                                  : "hover:bg-slate-50"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-800">
                                  {unlimitedPeriodOption.value}
                                </span>
                                {docDraft.issue_period ===
                                  unlimitedPeriodOption.value && (
                                  <span className="text-slate-700 font-bold">
                                    ✓
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
                                {unlimitedPeriodOption.subtitle}
                              </p>
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 승인 설정 (급여명세서를 제외한 6개 문서에만 노출 — 162708 ~ 162737 동일) */}
              {docDraft.supports_approval && (
                <div
                  className={`space-y-2 ${
                    !docDraft.allow_issue ? "opacity-50" : ""
                  }`}
                >
                  <div className="font-extrabold text-slate-800">승인 설정</div>

                  <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
                    <div className="px-4 py-3.5 bg-[#f9fafb]/70 flex items-center justify-between">
                      <span className="font-bold text-slate-800">승인 사용</span>
                      {renderSwitch(
                        docDraft.use_approval,
                        handleToggleUseApproval,
                        !docDraft.allow_issue
                      )}
                    </div>

                    {docDraft.use_approval && docDraft.allow_issue && (
                      <button
                        type="button"
                        onClick={() => setLineModalOpen(true)}
                        className="w-full px-4 py-3.5 bg-white hover:bg-slate-50 flex items-center justify-between transition-colors text-left"
                      >
                        <div>
                          <div className="font-bold text-slate-800">
                            승인 · 참조자 선택
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            승인 정책 관리의 퇴직자 문서 탭과 자동 연동돼요.
                          </div>
                        </div>
                        <AssigneePreviewStack
                          steps={lineStepsDraft}
                          ccList={lineCcDraft}
                        />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 모달 하단 버튼 (취소 / 확인) */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeDocModal}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-700"
              >
                취소
              </button>
              {canEdit && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveDoc}
                  className="px-4 py-2 rounded-lg bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold shadow-2xs disabled:opacity-60"
                >
                  확인
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 중첩 서브 모달: 승인 · 참조자 선택 (ApprovalLineEditor 재사용)      */}
      {/* ================================================================= */}
      {lineModalOpen && docDraft && (
        <div className="fixed inset-0 bg-slate-900/50 z-[85] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[520px] max-h-[88vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <h4 className="text-base font-extrabold text-slate-900">
                  {docDraft.title} · 승인 정책 설정
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  퇴직자가 문서 발급을 신청할 때 거칠 승인 단계와 참조자를 지정하세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLineModalOpen(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scroll">
              <div className="px-4 py-3 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-800">
                    결재선 수정 허용
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    신청 시 승인·참조 대상을 추가하거나 편집할 수 있어요.
                  </div>
                </div>
                {renderSwitch(lineAllowEditDraft, () =>
                  setLineAllowEditDraft((p) => !p)
                )}
              </div>

              <ApprovalLineEditor
                ccList={lineCcDraft}
                steps={lineStepsDraft}
                canEdit={canEdit}
                customLabels={ex.approval_labels || []}
                onChangeCc={setLineCcDraft}
                onChangeSteps={setLineStepsDraft}
                onOpenPicker={(target) => {
                  setPickerKeyword("");
                  setPickerTarget(target);
                }}
              />
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setLineModalOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold"
              >
                적용 완료
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 결재·참조 대상 선택 피커 모달 */}
      {pickerTarget && (
        <div className="fixed inset-0 bg-slate-900/55 z-[95] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <span className="font-extrabold text-slate-900">
                {pickerTarget.type === "CC"
                  ? "참조 대상 추가"
                  : `${pickerTarget.stepIndex + 1}단계 승인자 추가`}
              </span>
              <button
                type="button"
                onClick={() => setPickerTarget(null)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3 max-h-[65vh] overflow-y-auto custom-scroll">
              <input
                value={pickerKeyword}
                onChange={(e) => setPickerKeyword(e.target.value)}
                placeholder="조직장 역할 또는 구성원 이름 검색"
                className="w-full px-3 py-2 rounded-xl bg-slate-100 focus:outline-none font-medium"
              />

              <div>
                <div className="text-[10px] font-bold text-slate-400 mb-1.5">
                  조직 · 권한 역할
                </div>
                <div className="space-y-1">
                  {roleAssignees.map((ra) => (
                    <button
                      key={ra.id}
                      type="button"
                      onClick={() => handlePickAssignee(ra)}
                      className="w-full px-2.5 py-2 rounded-xl hover:bg-slate-50 flex items-center gap-2.5 text-left"
                    >
                      <AssigneeAvatar item={ra} />
                      <div>
                        <div className="font-bold text-slate-800">{ra.name}</div>
                        <div className="text-[10px] text-slate-400">
                          {ra.sub_label}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold text-slate-400 mb-1.5">
                  본사 구성원
                </div>
                <div className="space-y-1">
                  {candidateAssignees
                    .filter(
                      (c) =>
                        !pickerKeyword.trim() ||
                        c.name.includes(pickerKeyword.trim()) ||
                        (c.sub_label || "").includes(pickerKeyword.trim())
                    )
                    .map((ca) => (
                      <button
                        key={ca.id}
                        type="button"
                        onClick={() => handlePickAssignee(ca)}
                        className="w-full px-2.5 py-2 rounded-xl hover:bg-slate-50 flex items-center gap-2.5 text-left"
                      >
                        <AssigneeAvatar item={ca} />
                        <div>
                          <div className="font-bold text-slate-800">
                            {ca.name}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {ca.sub_label}
                          </div>
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
