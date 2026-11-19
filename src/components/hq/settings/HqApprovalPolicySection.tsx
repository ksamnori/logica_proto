// src/components/hq/settings/HqApprovalPolicySection.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { hqFetch } from "@/lib/hq/clientApi";
import {
  DEFAULT_APPROVAL_POLICIES,
  DEFAULT_APPROVAL_TEMPLATES,
  PRESET_ASSIGNEES,
} from "@/lib/hq/defaultApprovalPolicies";
import { resolveEffectiveAutoDelegation } from "@/lib/hq/defaultWorkflowForms";
import type {
  HqApprovalDoc,
  HqApprovalPolicyCategory,
  HqApprovalPolicyItem,
  HqApprovalTemplate,
  HqAttendanceRecord,
  HqCcNotifyMode,
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqCustomApprovalLabel,
  HqMember,
  HqPolicyAssignee,
  HqPolicyRequesterRule,
  HqPolicyStep,
  HqSubstituteApprovalRule,
} from "@/lib/hq/types";
import type { HqSettingsTab } from "./HqSettingsModal";

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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

function shortAvatarText(name: string): string {
  const clean = name.trim();
  if (clean.length >= 2) return clean.slice(-2);
  return clean || "HQ";
}

function summarizeRuleLine(
  steps: HqPolicyStep[],
  ccList: HqPolicyAssignee[]
): string {
  const parts: string[] = [];
  const activeAssignees = steps.flatMap((s) => s.assignees);
  if (activeAssignees.length > 0) {
    parts.push(`${activeAssignees.map((a) => a.name).join("·")}(승인)`);
  } else {
    parts.push("승인 없음");
  }
  if (ccList.length > 0) {
    parts.push(`${ccList.map((c) => c.name).join("·")}(참조)`);
  }
  return parts.join(", ");
}

function notifyModeLabel(mode?: HqCcNotifyMode): string {
  if (mode === "COMPLETE_ONLY") return "완료 알림";
  if (mode === "NONE") return "알림 없음";
  return "알림";
}

// ============================================================================
// 공통 아바타 배지 렌더러 (역할 1차 조직장 [1] vs 구성원 이니셜 배지)
// ============================================================================
export function AssigneeAvatar({ item }: { item: HqPolicyAssignee }) {
  if (item.kind === "ROLE") {
    const symbol =
      item.role_key === "ORG_HEAD_1"
        ? "1"
        : item.role_key === "ORG_HEAD_2"
          ? "2"
          : "HR";
    return (
      <span
        style={{ backgroundColor: item.avatar_bg || "#00c458" }}
        className="w-8 h-8 rounded-xl text-white text-xs font-extrabold flex items-center justify-center shrink-0 shadow-2xs"
      >
        {symbol}
      </span>
    );
  }
  return (
    <span
      style={{ backgroundColor: item.avatar_bg || "#9ba8cf" }}
      className="w-8 h-8 rounded-xl text-white text-[11px] font-extrabold flex items-center justify-center shrink-0 shadow-2xs"
    >
      {shortAvatarText(item.name)}
    </span>
  );
}

// ============================================================================
// 결재선(참조 + 단계별 승인) 공통 편집기
// ============================================================================
interface LineEditorProps {
  ccList: HqPolicyAssignee[];
  steps: HqPolicyStep[];
  canEdit: boolean;
  customLabels?: HqCustomApprovalLabel[];
  onChangeCc: (next: HqPolicyAssignee[]) => void;
  onChangeSteps: (next: HqPolicyStep[]) => void;
  onOpenPicker: (target: { type: "CC" } | { type: "STEP"; stepIndex: number }) => void;
}

export function ApprovalLineEditor({
  ccList,
  steps,
  canEdit,
  customLabels = [],
  onChangeCc,
  onChangeSteps,
  onOpenPicker,
}: LineEditorProps) {
  const [openNotifyKey, setOpenNotifyKey] = useState<string | null>(null);
  const [openStepActionKey, setOpenStepActionKey] = useState<string | null>(
    null
  );

  // 모달 내부에서는 최소 1단계 승인 슬롯을 표시 (Image 9 동일)
  const displaySteps: HqPolicyStep[] =
    steps.length > 0 ? steps : [{ step_order: 1, assignees: [] }];

  const ensureSteps = (base: HqPolicyStep[]): HqPolicyStep[] =>
    base.map((s, idx) => ({ ...s, step_order: idx + 1 }));

  return (
    <div className="space-y-5">
      {/* 참조 섹션 */}
      <div>
        <div className="pb-2 border-b border-slate-100 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-500">참조</span>
          {canEdit && (
            <button
              type="button"
              onClick={() => onOpenPicker({ type: "CC" })}
              className="w-6 h-6 rounded-full border border-slate-200 hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm leading-none font-bold"
              title="참조자 추가"
            >
              +
            </button>
          )}
        </div>

        {ccList.length === 0 ? (
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => onOpenPicker({ type: "CC" })}
            className="w-full py-3 flex items-center gap-3 text-left hover:bg-slate-50/80 rounded-xl px-1 transition-colors disabled:cursor-default"
          >
            <span className="w-8 h-8 rounded-xl bg-slate-200/70 text-slate-400 flex items-center justify-center text-sm font-bold shrink-0">
              +
            </span>
            <div>
              <div className="text-xs font-bold text-slate-700">추가하기</div>
              <div className="text-[11px] text-slate-400">
                참조자를 추가해 주세요.
              </div>
            </div>
          </button>
        ) : (
          <div className="divide-y divide-slate-50">
            {ccList.map((cc, idx) => {
              const key = `${cc.id}-${idx}`;
              const mode = cc.notify_mode || "BOTH";
              return (
                <div
                  key={key}
                  className="group py-2.5 flex items-center justify-between gap-2 relative"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AssigneeAvatar item={cc} />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {cc.name}
                      </div>
                      {cc.sub_label && (
                        <div className="text-[11px] text-slate-400 truncate">
                          {cc.sub_label}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 relative">
                    {/* Image 15 알림 설정 팝오버 버튼 */}
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        setOpenNotifyKey((prev) => (prev === key ? null : key))
                      }
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 border transition-colors ${
                        mode === "NONE"
                          ? "bg-slate-100 text-slate-500 border-slate-200"
                          : "bg-blue-50 text-blue-600 border-blue-200/80"
                      }`}
                    >
                      <span>🔔</span>
                      <span>{notifyModeLabel(mode)}</span>
                      <span className="text-[9px]">▾</span>
                    </button>

                    {canEdit && (
                      <button
                        type="button"
                        onClick={() =>
                          onChangeCc(ccList.filter((_, i) => i !== idx))
                        }
                        className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded-full hover:bg-rose-50 text-slate-300 hover:text-rose-500 text-xs flex items-center justify-center"
                        title="참조 제외"
                      >
                        ✕
                      </button>
                    )}

                    {/* Image 15 동일 알림 설정 드롭다운 */}
                    {openNotifyKey === key && (
                      <div className="absolute right-0 top-8 w-56 rounded-2xl bg-white border border-slate-200 shadow-2xl p-3 z-40 text-xs">
                        <div className="px-2 py-1 text-[11px] font-bold text-slate-400">
                          알림 설정
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {(
                            [
                              {
                                value: "BOTH",
                                label: "승인 요청, 완료 시 알림",
                              },
                              {
                                value: "COMPLETE_ONLY",
                                label: "승인 완료 시 알림",
                              },
                              {
                                value: "NONE",
                                label: "알림 없음",
                              },
                            ] as { value: HqCcNotifyMode; label: string }[]
                          ).map((opt) => {
                            const active = mode === opt.value;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => {
                                  const next = ccList.map((item, i) =>
                                    i === idx
                                      ? { ...item, notify_mode: opt.value }
                                      : item
                                  );
                                  onChangeCc(next);
                                  setOpenNotifyKey(null);
                                }}
                                className="w-full px-2.5 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2 text-left font-bold text-slate-800"
                              >
                                <span
                                  className={`w-3.5 text-xs ${
                                    active
                                      ? "text-emerald-500 font-extrabold"
                                      : "text-transparent"
                                  }`}
                                >
                                  ✓
                                </span>
                                <span>{opt.label}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-2 pt-2 border-t border-slate-100 px-1 text-[10px] text-slate-400 flex items-center gap-1">
                          <span>ⓘ</span>
                          <span>댓글 알림은 설정과 관계없이 수신돼요.</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 단계별 승인 섹션 */}
      {displaySteps.map((step, sIdx) => (
        <div key={`step-${sIdx}`}>
          <div className="pb-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">
              {sIdx + 1}단계 승인
            </span>

            {canEdit && (
              <div className="flex items-center gap-1.5">
                {displaySteps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const filtered = displaySteps.filter(
                        (_, idx) => idx !== sIdx
                      );
                      onChangeSteps(ensureSteps(filtered));
                    }}
                    className="text-[11px] font-semibold text-slate-400 hover:text-rose-500 px-1"
                  >
                    단계 삭제
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onOpenPicker({ type: "STEP", stepIndex: sIdx })
                  }
                  className="w-6 h-6 rounded-full border border-slate-200 hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm leading-none font-bold"
                  title="승인자 추가"
                >
                  +
                </button>
              </div>
            )}
          </div>

          {step.assignees.length === 0 ? (
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => onOpenPicker({ type: "STEP", stepIndex: sIdx })}
              className="w-full py-3 flex items-center gap-3 text-left hover:bg-slate-50/80 rounded-xl px-1 transition-colors disabled:cursor-default"
            >
              <span className="w-8 h-8 rounded-xl bg-slate-200/70 text-slate-400 flex items-center justify-center text-sm font-bold shrink-0">
                +
              </span>
              <div>
                <div className="text-xs font-bold text-slate-700">추가하기</div>
                <div className="text-[11px] text-slate-400">
                  승인자를 추가해 주세요.
                </div>
              </div>
            </button>
          ) : (
            <div className="divide-y divide-slate-50">
              {step.assignees.map((asg, aIdx) => {
                const aKey = `${sIdx}-${asg.id}-${aIdx}`;
                const actionLabel = asg.step_action || "승인";
                return (
                  <div
                    key={aKey}
                    className="group py-2.5 flex items-center justify-between gap-2 relative"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AssigneeAvatar item={asg} />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {asg.name}
                        </div>
                        {asg.sub_label && asg.kind !== "ROLE" && (
                          <div className="text-[11px] text-slate-400 truncate">
                            {asg.sub_label}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 relative">
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() =>
                          setOpenStepActionKey((prev) =>
                            prev === aKey ? null : aKey
                          )
                        }
                        className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold flex items-center gap-1"
                      >
                        <span>{actionLabel}</span>
                        <span className="text-[9px]">▾</span>
                      </button>

                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextSteps = displaySteps.map((st, idx) =>
                              idx === sIdx
                                ? {
                                    ...st,
                                    assignees: st.assignees.filter(
                                      (_, i) => i !== aIdx
                                    ),
                                  }
                                : st
                            );
                            onChangeSteps(ensureSteps(nextSteps));
                          }}
                          className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded-full hover:bg-rose-50 text-slate-300 hover:text-rose-500 text-xs flex items-center justify-center"
                          title="승인자 제외"
                        >
                          ✕
                        </button>
                      )}

                      {openStepActionKey === aKey && (
                        <div className="absolute right-0 top-8 w-40 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-40 text-xs">
                          {Array.from(
                            new Set([
                              "승인",
                              "합의",
                              "검토",
                              ...customLabels.map((l) => l.name),
                            ])
                          ).map((act) => (
                            <button
                              key={act}
                              type="button"
                              onClick={() => {
                                const nextSteps = displaySteps.map((st, idx) =>
                                  idx === sIdx
                                    ? {
                                        ...st,
                                        assignees: st.assignees.map((item, i) =>
                                          i === aIdx
                                            ? { ...item, step_action: act }
                                            : item
                                        ),
                                      }
                                    : st
                                );
                                onChangeSteps(ensureSteps(nextSteps));
                                setOpenStepActionKey(null);
                              }}
                              className="w-full px-3 py-1.5 text-left font-bold text-slate-700 hover:bg-slate-50 flex items-center justify-between"
                            >
                              <span>{act}</span>
                              {actionLabel === act && (
                                <span className="text-emerald-500">✓</span>
                              )}
                            </button>
                          ))}
                          <div className="my-1 border-t border-slate-100" />
                          <button
                            type="button"
                            onClick={() => {
                              const nextSteps = displaySteps.map((st, idx) =>
                                idx === sIdx
                                  ? {
                                      ...st,
                                      assignees: st.assignees.filter(
                                        (_, i) => i !== aIdx
                                      ),
                                    }
                                  : st
                              );
                              onChangeSteps(ensureSteps(nextSteps));
                              setOpenStepActionKey(null);
                            }}
                            className="w-full px-3 py-1.5 text-left font-semibold text-rose-500 hover:bg-rose-50"
                          >
                            승인자 삭제
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* + 승인 단계 추가하기 버튼 */}
      {canEdit && (
        <button
          type="button"
          onClick={() => {
            const nextSteps = [
              ...displaySteps,
              { step_order: displaySteps.length + 1, assignees: [] },
            ];
            onChangeSteps(ensureSteps(nextSteps));
          }}
          className="w-full py-3 rounded-xl bg-[#f5f6f8] hover:bg-slate-200/70 text-xs font-bold text-slate-700 transition-colors"
        >
          + 승인 단계 추가하기
        </button>
      )}
    </div>
  );
}

// ============================================================================
// 메인 컴포넌트: 승인 정책 관리 (Images 3 ~ 15)
// ============================================================================
interface ApprovalPolicyProps {
  settings: HqCompanySettings;
  members: HqMember[];
  canEdit: boolean;
  saving: boolean;
  initialSubCategory?: HqApprovalPolicyCategory;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onNavigateTab: (tab: HqSettingsTab) => void;
}

export default function HqApprovalPolicySection({
  settings,
  members,
  canEdit,
  saving,
  initialSubCategory = "workflow",
  onSaveExtra,
  onNavigateTab,
}: ApprovalPolicyProps) {
  const ex = settings.extra_settings || {};
  const policies: HqApprovalPolicyItem[] =
    ex.approval_policies && ex.approval_policies.length > 0
      ? ex.approval_policies
      : DEFAULT_APPROVAL_POLICIES;
  const templates: HqApprovalTemplate[] =
    ex.approval_templates && ex.approval_templates.length > 0
      ? ex.approval_templates
      : DEFAULT_APPROVAL_TEMPLATES;

  const [subTab, setSubTab] =
    useState<HqApprovalPolicyCategory>(initialSubCategory);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterMode, setFilterMode] = useState<
    "ALL" | "HAS_APPROVAL" | "NO_APPROVAL" | "ALLOW_EDIT"
  >("ALL");
  const [checkedPolicyIds, setCheckedPolicyIds] = useState<string[]>([]);

  // 승인 · 참조 편집 모달 상태
  const [editingPolicy, setEditingPolicy] =
    useState<HqApprovalPolicyItem | null>(null);
  const [modalTemplateMenuOpen, setModalTemplateMenuOpen] = useState(false);
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [openRuleMenuId, setOpenRuleMenuId] = useState<string | null>(null);

  // 대상(승인자/참조자) 피커 모달 상태
  const [pickerContext, setPickerContext] = useState<
    | null
    | {
        scope: "DEFAULT" | string; // "DEFAULT" 또는 requester_rule.id
        target: { type: "CC" } | { type: "STEP"; stepIndex: number };
      }
  >(null);
  const [pickerKeyword, setPickerKeyword] = useState("");

  // 승인 템플릿 관리 모달
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [newTplName, setNewTplName] = useState("");

  // 새 워크플로우 정책 추가 모달
  const [createPolicyOpen, setCreatePolicyOpen] = useState(false);
  const [newPolicyTitle, setNewPolicyTitle] = useState("");
  const [newPolicyDesc, setNewPolicyDesc] = useState("");
  const [newPolicyIcon, setNewPolicyIcon] = useState("📋");

  useEffect(() => {
    setSubTab(initialSubCategory);
  }, [initialSubCategory]);

  useEffect(() => {
    setCheckedPolicyIds([]);
  }, [subTab]);

  // 후보 구성원 목록 (실제 DB 재직 구성원 + 스크린샷 기본 인물 병합)
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
      if (!map.has(p.name)) {
        map.set(p.name, { ...p });
      }
    });

    return Array.from(map.values());
  }, [members]);

  const filteredPolicies = useMemo(() => {
    return policies.filter((p) => {
      if (p.category !== subTab) return false;
      const activeStepCount = p.steps.filter(
        (s) => s.assignees.length > 0
      ).length;
      if (filterMode === "HAS_APPROVAL" && activeStepCount === 0) return false;
      if (filterMode === "NO_APPROVAL" && activeStepCount > 0) return false;
      if (filterMode === "ALLOW_EDIT" && !p.allow_edit) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${p.title} ${p.description || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [policies, subTab, filterMode, searchQuery]);

  const openPolicyModal = (item: HqApprovalPolicyItem) => {
    // 깊은 복사본으로 편집 시작
    const cloned: HqApprovalPolicyItem = JSON.parse(JSON.stringify(item));
    setEditingPolicy(cloned);
    setExpandedRuleId(null);
    setOpenRuleMenuId(null);
    setModalTemplateMenuOpen(false);
  };

  const handleSavePolicyModal = async () => {
    if (!editingPolicy) return;
    const cleanedSteps = editingPolicy.steps
      .filter((s) => s.assignees.length > 0)
      .map((s, idx) => ({ ...s, step_order: idx + 1 }));

    const cleanedRules = (editingPolicy.requester_rules || []).map((r) => ({
      ...r,
      steps: r.steps
        .filter((s) => s.assignees.length > 0)
        .map((s, idx) => ({ ...s, step_order: idx + 1 })),
    }));

    const finalized: HqApprovalPolicyItem = {
      ...editingPolicy,
      steps: cleanedSteps,
      requester_rules: cleanedRules,
    };

    const nextList = policies.map((p) =>
      p.id === finalized.id ? finalized : p
    );

    // 구성원 정보 탭인 경우 기존 info_approval_policy 불리언 필드도 동기화
    let syncedInfoPol = ex.info_approval_policy;
    if (finalized.category === "member_info") {
      const byId = new Map(nextList.map((x) => [x.id, x]));
      syncedInfoPol = {
        ...ex.info_approval_policy,
        require_approval_basic:
          (byId.get("mi-basic")?.steps.length || 0) > 0,
        require_approval_family:
          (byId.get("mi-family")?.steps.length || 0) > 0,
        require_approval_career:
          (byId.get("mi-career-edu")?.steps.length || 0) > 0,
        require_approval_doc:
          (byId.get("mi-document")?.steps.length || 0) > 0,
        require_approval_license:
          (byId.get("mi-license")?.steps.length || 0) > 0,
      };
    }

    await onSaveExtra(
      {
        approval_policies: nextList,
        ...(syncedInfoPol ? { info_approval_policy: syncedInfoPol } : {}),
      },
      `'${finalized.title}' 승인 정책이 저장되었습니다.`
    );
    setEditingPolicy(null);
  };

  const handleSelectAssigneeFromPicker = (picked: HqPolicyAssignee) => {
    if (!editingPolicy || !pickerContext) return;
    const freshItem: HqPolicyAssignee = {
      ...picked,
      id: `${picked.id}-${uid()}`,
      notify_mode: "BOTH",
      step_action: "승인",
    };

    if (pickerContext.scope === "DEFAULT") {
      if (pickerContext.target.type === "CC") {
        if (editingPolicy.cc_list.some((c) => c.name === freshItem.name)) {
          setPickerContext(null);
          return;
        }
        setEditingPolicy({
          ...editingPolicy,
          cc_list: [...editingPolicy.cc_list, freshItem],
        });
      } else {
        const sIdx = pickerContext.target.stepIndex;
        const baseSteps =
          editingPolicy.steps.length > 0
            ? [...editingPolicy.steps]
            : [{ step_order: 1, assignees: [] }];
        while (baseSteps.length <= sIdx) {
          baseSteps.push({ step_order: baseSteps.length + 1, assignees: [] });
        }
        if (
          !baseSteps[sIdx].assignees.some((a) => a.name === freshItem.name)
        ) {
          baseSteps[sIdx] = {
            ...baseSteps[sIdx],
            assignees: [...baseSteps[sIdx].assignees, freshItem],
          };
        }
        setEditingPolicy({ ...editingPolicy, steps: baseSteps });
      }
    } else {
      const ruleId = pickerContext.scope;
      const nextRules = (editingPolicy.requester_rules || []).map((r) => {
        if (r.id !== ruleId) return r;
        if (pickerContext.target.type === "CC") {
          if (r.cc_list.some((c) => c.name === freshItem.name)) return r;
          return { ...r, cc_list: [...r.cc_list, freshItem] };
        }
        const sIdx = pickerContext.target.stepIndex;
        const baseSteps =
          r.steps.length > 0
            ? [...r.steps]
            : [{ step_order: 1, assignees: [] }];
        while (baseSteps.length <= sIdx) {
          baseSteps.push({ step_order: baseSteps.length + 1, assignees: [] });
        }
        if (
          !baseSteps[sIdx].assignees.some((a) => a.name === freshItem.name)
        ) {
          baseSteps[sIdx] = {
            ...baseSteps[sIdx],
            assignees: [...baseSteps[sIdx].assignees, freshItem],
          };
        }
        return { ...r, steps: baseSteps };
      });
      setEditingPolicy({ ...editingPolicy, requester_rules: nextRules });
    }

    setPickerContext(null);
    setPickerKeyword("");
  };

  const handleBulkApplyTemplate = async (tpl: HqApprovalTemplate) => {
    if (checkedPolicyIds.length === 0) return;
    const nextList = policies.map((p) =>
      checkedPolicyIds.includes(p.id)
        ? {
            ...p,
            cc_list: JSON.parse(JSON.stringify(tpl.cc_list)),
            steps: JSON.parse(JSON.stringify(tpl.steps)),
          }
        : p
    );
    await onSaveExtra(
      { approval_policies: nextList },
      `선택한 ${checkedPolicyIds.length}개 정책에 '${tpl.name}' 템플릿을 적용했습니다.`
    );
    setCheckedPolicyIds([]);
  };

  const handleCreateCustomWorkflowPolicy = async () => {
    if (!newPolicyTitle.trim()) {
      alert("양식 정책 이름을 입력해주세요.");
      return;
    }
    const created: HqApprovalPolicyItem = {
      id: `wf-custom-${uid()}`,
      category: "workflow",
      title: newPolicyTitle.trim(),
      description: newPolicyDesc.trim() || undefined,
      icon: newPolicyIcon,
      allow_edit: true,
      per_requester: false,
      cc_list: [{ ...PRESET_ASSIGNEES.KIM_GS }],
      steps: [{ step_order: 1, assignees: [{ ...PRESET_ASSIGNEES.CHUN }] }],
      mapped_doc_type: "GENERAL",
    };
    await onSaveExtra(
      { approval_policies: [...policies, created] },
      `'${created.title}' 워크플로우 정책이 추가되었습니다.`
    );
    setNewPolicyTitle("");
    setNewPolicyDesc("");
    setCreatePolicyOpen(false);
  };

  const SUB_TABS: { key: HqApprovalPolicyCategory; label: string }[] = [
    { key: "workflow", label: "워크플로우" },
    { key: "work", label: "근무" },
    { key: "leave", label: "휴가" },
    { key: "member_info", label: "구성원 정보" },
    { key: "retiree_doc", label: "퇴직자 문서" },
  ];

  return (
    <>
      <div className="space-y-6">
        {/* 상단 헤더 + 승인 템플릿 버튼 */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
              승인 정책 관리
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              회사의 모든 승인 정책을 관리하고 템플릿을 생성할 수 있어요.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canEdit && subTab === "workflow" && (
              <button
                type="button"
                onClick={() => setCreatePolicyOpen(true)}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 shadow-2xs"
              >
                + 양식 추가
              </button>
            )}
            <button
              type="button"
              onClick={() => setTemplateManagerOpen(true)}
              className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs"
            >
              승인 템플릿
            </button>
          </div>
        </div>

        {/* 5개 서브 탭 바 + 검색/필터 아이콘 */}
        <div className="border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-5 text-[13px] font-bold overflow-x-auto">
            {SUB_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setSubTab(t.key)}
                className={`pb-3 border-b-2 transition-colors whitespace-nowrap ${
                  subTab === t.key
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pb-2 relative shrink-0">
            <button
              type="button"
              onClick={() => setSearchOpen((p) => !p)}
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs ${
                searchOpen
                  ? "bg-slate-900 text-white"
                  : "hover:bg-slate-100 text-slate-500"
              }`}
              title="정책 검색"
            >
              🔍
            </button>
            <button
              type="button"
              onClick={() => setFilterMenuOpen((p) => !p)}
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs ${
                filterMode !== "ALL"
                  ? "bg-blue-50 text-blue-600 font-bold"
                  : "hover:bg-slate-100 text-slate-500"
              }`}
              title="필터"
            >
              ⏷
            </button>

            {filterMenuOpen && (
              <div className="absolute right-0 top-8 w-40 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                {(
                  [
                    { key: "ALL", label: "전체 정책 보기" },
                    { key: "HAS_APPROVAL", label: "승인 단계 있음" },
                    { key: "NO_APPROVAL", label: "승인 없음" },
                    { key: "ALLOW_EDIT", label: "변경 허용 정책만" },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => {
                      setFilterMode(f.key);
                      setFilterMenuOpen(false);
                    }}
                    className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-between"
                  >
                    <span>{f.label}</span>
                    {filterMode === f.key && (
                      <span className="text-emerald-500 font-bold">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {searchOpen && (
          <div>
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="정책 이름 또는 설명 검색..."
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:bg-white"
            />
          </div>
        )}

        {/* 모든 정책 N + 일괄 템플릿 적용 바 */}
        <div className="space-y-2.5">
          <div className="px-1 flex flex-wrap items-center justify-between gap-2 text-xs">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={
                  filteredPolicies.length > 0 &&
                  checkedPolicyIds.length === filteredPolicies.length
                }
                onChange={(e) =>
                  setCheckedPolicyIds(
                    e.target.checked ? filteredPolicies.map((p) => p.id) : []
                  )
                }
                className="w-4 h-4 rounded border-slate-300 accent-emerald-500"
              />
              <span className="font-bold text-slate-700">
                모든 정책{" "}
                <span className="text-slate-400 font-semibold">
                  {filteredPolicies.length}
                </span>
              </span>
            </label>

            {canEdit && checkedPolicyIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-emerald-700">
                  {checkedPolicyIds.length}개 선택됨
                </span>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const tpl = templates.find((t) => t.id === e.target.value);
                    if (tpl) handleBulkApplyTemplate(tpl);
                    e.target.value = "";
                  }}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-700"
                >
                  <option value="" disabled>
                    템플릿 일괄 적용...
                  </option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* 정책 리스트 카드들 */}
          <div className="space-y-2.5">
            {filteredPolicies.map((pol) => {
              const checked = checkedPolicyIds.includes(pol.id);
              const activeStepsCount = pol.steps.filter(
                (s) => s.assignees.length > 0
              ).length;
              const ccCount = pol.cc_list.length;

              return (
                <div
                  key={pol.id}
                  onClick={() => openPolicyModal(pol)}
                  className="px-4 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center justify-between gap-3 shadow-2xs cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={checked}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        setCheckedPolicyIds((prev) =>
                          e.target.checked
                            ? [...prev, pol.id]
                            : prev.filter((id) => id !== pol.id)
                        )
                      }
                      className="w-4 h-4 rounded border-slate-300 accent-emerald-500 shrink-0 cursor-pointer"
                    />

                    {pol.category === "retiree_doc" ? (
                      <span className="w-8 h-8 rounded-lg bg-violet-50 border border-violet-100/80 text-[#8b5cf6] flex items-center justify-center shrink-0">
                        <svg
                          className="w-4 h-4"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M11 6a3 3 0 11-6 0 3 3 0 016 0zM14 17a6 6 0 00-12 0h12zM13 8a1 1 0 100 2h4a1 1 0 100-2h-4z" />
                        </svg>
                      </span>
                    ) : (
                      <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-base shrink-0">
                        {pol.icon}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-bold text-slate-900">
                          {pol.title}
                        </span>
                        {pol.allow_edit && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                            변경 허용
                          </span>
                        )}
                        {pol.per_requester && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                            요청자별 승인
                          </span>
                        )}
                        {(() => {
                          const ad = resolveEffectiveAutoDelegation({
                            policyId: pol.id,
                            category: pol.category,
                            mappedDocType: pol.mapped_doc_type,
                            configured: pol.auto_delegation,
                          });
                          if (!ad?.enabled) return null;
                          const tags: string[] = [];
                          if (ad.amount_enabled && Number(ad.max_amount) > 0) {
                            tags.push(
                              `${Math.round(Number(ad.max_amount) / 10000)}만원 이하 전결`
                            );
                          }
                          if (
                            ad.leave_days_enabled &&
                            Number(ad.max_leave_days) > 0
                          ) {
                            tags.push(`${ad.max_leave_days}일 이하 전결`);
                          }
                          if (tags.length === 0) return null;
                          return (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                              ⚡ {tags.join(" · ")}
                            </span>
                          );
                        })()}
                      </div>
                      {pol.description && (
                        <p className="text-xs text-slate-400 mt-0.5 truncate">
                          {pol.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 우측 승인 단계 & 참조 배지 (Images 3, 10, 13 동일) */}
                  <div className="flex items-center gap-1.5 shrink-0 text-[11px]">
                    {activeStepsCount > 0 ? (
                      <span className="px-2.5 py-1 rounded-md bg-sky-50 text-sky-600 font-bold flex items-center gap-1">
                        <span className="text-[10px]">🛫</span>
                        <span>{activeStepsCount}단계 승인</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-md bg-slate-50 text-slate-400 font-medium">
                        승인 없음
                      </span>
                    )}

                    {ccCount > 0 ? (
                      <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-bold">
                        참조 {ccCount}
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
        </div>

        {/* 하단 이전/다음 이동 카드 (Images 3, 11, 14 동일: 문서함 설정 ← / → 커스텀 승인 라벨) */}
        <div className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("doc-box")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                문서함 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("approval-labels")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                커스텀 승인 라벨
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 모달 1: 승인 · 참조 상세 설정 모달 (Images 4~9, 12, 15)            */}
      {/* ================================================================= */}
      {editingPolicy && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[440px] max-h-[88vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-6">
            {/* 상단 바: 승인·참조 배지 + 템플릿 아이콘 + 닫기 */}
            <div className="flex items-center justify-between shrink-0 relative">
              <span className="px-2.5 py-1 rounded-md border border-slate-200 text-[11px] font-bold text-slate-700">
                승인 · 참조
              </span>

              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setModalTemplateMenuOpen((p) => !p)}
                    className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center text-xs"
                    title="승인 템플릿 불러오기 / 저장"
                  >
                    📑
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditingPolicy(null)}
                  className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
                >
                  ✕
                </button>
              </div>

              {modalTemplateMenuOpen && (
                <div className="absolute right-7 top-8 w-56 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-40 text-xs">
                  <div className="px-3.5 py-1 text-[10px] font-bold text-slate-400">
                    저장된 승인 템플릿 불러오기
                  </div>
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => {
                        setEditingPolicy({
                          ...editingPolicy,
                          cc_list: JSON.parse(JSON.stringify(tpl.cc_list)),
                          steps: JSON.parse(JSON.stringify(tpl.steps)),
                        });
                        setModalTemplateMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {tpl.name}
                    </button>
                  ))}
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    onClick={() => {
                      setModalTemplateMenuOpen(false);
                      setEditingPolicy({
                        ...editingPolicy,
                        cc_list: [],
                        steps: [],
                      });
                    }}
                    className="w-full px-3.5 py-1.5 text-left font-semibold text-rose-500 hover:bg-rose-50"
                  >
                    승인 · 참조 모두 비우기
                  </button>
                </div>
              )}
            </div>

            {/* 정책 제목 + 요청자별 승인 / 변경 허용 토글 칩 */}
            <div className="mt-3.5 shrink-0">
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                {editingPolicy.title}
              </h3>

              <div className="mt-2.5 flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() =>
                    setEditingPolicy({
                      ...editingPolicy,
                      per_requester: !editingPolicy.per_requester,
                    })
                  }
                  className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors ${
                    editingPolicy.per_requester
                      ? "bg-blue-50 text-blue-600 border-blue-200 font-bold"
                      : "bg-slate-100 text-slate-500 border-transparent font-semibold"
                  }`}
                >
                  요청자별 승인
                </button>

                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() =>
                    setEditingPolicy({
                      ...editingPolicy,
                      allow_edit: !editingPolicy.allow_edit,
                    })
                  }
                  className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors ${
                    editingPolicy.allow_edit
                      ? "bg-blue-50 text-blue-600 border-blue-200 font-bold"
                      : "bg-slate-100 text-slate-500 border-transparent font-semibold"
                  }`}
                >
                  변경 허용
                </button>
              </div>

              {(editingPolicy.category === "workflow" ||
                editingPolicy.category === "leave") &&
                (() => {
                  const effAd = resolveEffectiveAutoDelegation({
                    policyId: editingPolicy.id,
                    category: editingPolicy.category,
                    mappedDocType: editingPolicy.mapped_doc_type,
                    configured: editingPolicy.auto_delegation,
                  }) || {
                    enabled: false,
                    amount_enabled: editingPolicy.category === "workflow",
                    max_amount: 300000,
                    leave_days_enabled: editingPolicy.category === "leave",
                    max_leave_days: 2,
                    convert_skipped_to_cc: true,
                  };
                  const isLeavePol =
                    editingPolicy.category === "leave" ||
                    editingPolicy.mapped_doc_type === "LEAVE";
                  const updateAd = (
                    patch: Partial<typeof effAd>
                  ) => {
                    if (!canEdit) return;
                    setEditingPolicy({
                      ...editingPolicy,
                      auto_delegation: {
                        ...effAd,
                        ...patch,
                      },
                    });
                  };
                  return (
                    <div className="mt-3 p-3 rounded-xl border border-emerald-200/80 bg-emerald-50/40 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-extrabold text-slate-800 flex items-center gap-1.5">
                            <span>⚡ 자동 전결 기준 (마지막 대표 결재 생략)</span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            기준 이하 건은 앞선 검토자(팀장·본부장·실장) 선에서 전결 완료됩니다.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() =>
                            updateAd({
                              enabled: !effAd.enabled,
                              amount_enabled: !isLeavePol
                                ? true
                                : effAd.amount_enabled,
                              max_amount: effAd.max_amount || 300000,
                              leave_days_enabled: isLeavePol
                                ? true
                                : effAd.leave_days_enabled,
                              max_leave_days: effAd.max_leave_days || 2,
                              convert_skipped_to_cc:
                                effAd.convert_skipped_to_cc !== false,
                            })
                          }
                          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                            effAd.enabled ? "bg-[#00c458]" : "bg-slate-300"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                              effAd.enabled ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>

                      {effAd.enabled && (
                        <div className="pt-2 border-t border-emerald-200/60 space-y-2">
                          {!isLeavePol ? (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold text-slate-700">
                                  전결 기준 금액 (이하)
                                </span>
                                <div className="flex items-center gap-1">
                                  {[100000, 300000, 500000, 1000000].map(
                                    (preset) => (
                                      <button
                                        key={preset}
                                        type="button"
                                        disabled={!canEdit}
                                        onClick={() =>
                                          updateAd({
                                            amount_enabled: true,
                                            max_amount: preset,
                                          })
                                        }
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                          Number(effAd.max_amount) === preset
                                            ? "bg-emerald-600 text-white border-emerald-600"
                                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                        }`}
                                      >
                                        {preset / 10000}만원
                                      </button>
                                    )
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min={0}
                                  step={10000}
                                  disabled={!canEdit}
                                  value={effAd.max_amount ?? 300000}
                                  onChange={(e) =>
                                    updateAd({
                                      amount_enabled: true,
                                      max_amount: Math.max(
                                        0,
                                        Number(e.target.value || 0)
                                      ),
                                    })
                                  }
                                  className="w-36 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800 tabular-nums"
                                />
                                <span className="text-[11px] font-semibold text-slate-600">
                                  원 이하일 때 마지막 대표 결재 단계 생략
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold text-slate-700">
                                  전결 기준 휴가 일수 (이하)
                                </span>
                                <div className="flex items-center gap-1">
                                  {[0.5, 1, 2, 3].map((preset) => (
                                    <button
                                      key={preset}
                                      type="button"
                                      disabled={!canEdit}
                                      onClick={() =>
                                        updateAd({
                                          leave_days_enabled: true,
                                          max_leave_days: preset,
                                        })
                                      }
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                        Number(effAd.max_leave_days) === preset
                                          ? "bg-emerald-600 text-white border-emerald-600"
                                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                      }`}
                                    >
                                      {preset === 0.5 ? "반차(0.5일)" : `${preset}일`}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min={0.125}
                                  step={0.5}
                                  disabled={!canEdit}
                                  value={effAd.max_leave_days ?? 2}
                                  onChange={(e) =>
                                    updateAd({
                                      leave_days_enabled: true,
                                      max_leave_days: Math.max(
                                        0,
                                        Number(e.target.value || 0)
                                      ),
                                    })
                                  }
                                  className="w-24 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800 tabular-nums"
                                />
                                <span className="text-[11px] font-semibold text-slate-600">
                                  일 이하(반차·시간차 포함)일 때 마지막 대표 결재 생략
                                </span>
                              </div>
                            </div>
                          )}

                          <label className="flex items-center gap-2 pt-0.5 cursor-pointer">
                            <input
                              type="checkbox"
                              disabled={!canEdit}
                              checked={effAd.convert_skipped_to_cc !== false}
                              onChange={(e) =>
                                updateAd({
                                  convert_skipped_to_cc: e.target.checked,
                                })
                              }
                              className="accent-emerald-600 rounded"
                            />
                            <span className="text-[11px] font-semibold text-slate-700">
                              결재 생략된 대표를 참조(CC)에 자동 추가하여 사후 열람 유지
                            </span>
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>

            {/* 스크롤 본문: 일반 결재선 vs 요청자별 승인 (Image 6) */}
            <div className="mt-5 flex-1 overflow-y-auto custom-scroll pr-0.5">
              {!editingPolicy.per_requester ? (
                <ApprovalLineEditor
                  ccList={editingPolicy.cc_list}
                  steps={editingPolicy.steps}
                  canEdit={canEdit}
                  customLabels={ex.approval_labels || []}
                  onChangeCc={(next) =>
                    setEditingPolicy({ ...editingPolicy, cc_list: next })
                  }
                  onChangeSteps={(next) =>
                    setEditingPolicy({ ...editingPolicy, steps: next })
                  }
                  onOpenPicker={(target) =>
                    setPickerContext({ scope: "DEFAULT", target })
                  }
                />
              ) : (
                <div className="space-y-3">
                  {/* 1) 기본 설정 카드 (Image 6 동일) */}
                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRuleId((prev) =>
                          prev === "DEFAULT" ? null : "DEFAULT"
                        )
                      }
                      className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-slate-50/70"
                    >
                      <div>
                        <div className="text-xs font-extrabold text-slate-900">
                          기본 설정
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {summarizeRuleLine(
                            editingPolicy.steps,
                            editingPolicy.cc_list
                          )}
                        </div>
                      </div>
                      <span className="text-slate-400 text-xs">
                        {expandedRuleId === "DEFAULT" ? "▴" : "▾"}
                      </span>
                    </button>

                    {expandedRuleId === "DEFAULT" && (
                      <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-slate-50/40">
                        <ApprovalLineEditor
                          ccList={editingPolicy.cc_list}
                          steps={editingPolicy.steps}
                          canEdit={canEdit}
                          customLabels={ex.approval_labels || []}
                          onChangeCc={(next) =>
                            setEditingPolicy({
                              ...editingPolicy,
                              cc_list: next,
                            })
                          }
                          onChangeSteps={(next) =>
                            setEditingPolicy({ ...editingPolicy, steps: next })
                          }
                          onOpenPicker={(target) =>
                            setPickerContext({ scope: "DEFAULT", target })
                          }
                        />
                      </div>
                    )}
                  </div>

                  {/* 안내 문구 (Image 6 동일) */}
                  <div className="px-1 py-0.5 text-[11px] text-slate-400 flex items-center gap-1.5">
                    <span>⇅</span>
                    <span>
                      중복된 요청자가 있을 경우, 먼저 나열된 정책이 적용돼요.
                    </span>
                  </div>

                  {/* 2) 요청자 그룹별 예외 규칙 카드들 */}
                  {(editingPolicy.requester_rules || []).map((rule, rIdx) => {
                    const isExp = expandedRuleId === rule.id;
                    const rulesArr = editingPolicy.requester_rules || [];
                    return (
                      <div
                        key={rule.id}
                        className="rounded-xl border border-slate-200 bg-white overflow-hidden relative"
                      >
                        <div className="px-4 py-3.5 flex items-center justify-between gap-2 hover:bg-slate-50/70">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRuleId((prev) =>
                                prev === rule.id ? null : rule.id
                              )
                            }
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="text-xs font-extrabold text-slate-900 truncate">
                              {rule.requester_summary}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                              {summarizeRuleLine(rule.steps, rule.cc_list)}
                            </div>
                          </button>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenRuleMenuId((p) =>
                                    p === rule.id ? null : rule.id
                                  )
                                }
                                className="w-6 h-6 rounded hover:bg-slate-100 text-slate-400 text-xs font-bold"
                              >
                                ⋮
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedRuleId((prev) =>
                                  prev === rule.id ? null : rule.id
                                )
                              }
                              className="text-slate-400 text-xs px-1"
                            >
                              {isExp ? "▴" : "▾"}
                            </button>
                          </div>
                        </div>

                        {openRuleMenuId === rule.id && (
                          <div className="absolute right-8 top-9 w-32 rounded-xl bg-white border border-slate-200 shadow-xl py-1 z-30 text-xs">
                            <button
                              type="button"
                              disabled={rIdx === 0}
                              onClick={() => {
                                setOpenRuleMenuId(null);
                                const copy = [...rulesArr];
                                const [picked] = copy.splice(rIdx, 1);
                                copy.splice(rIdx - 1, 0, picked);
                                setEditingPolicy({
                                  ...editingPolicy,
                                  requester_rules: copy,
                                });
                              }}
                              className="w-full px-3 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-35"
                            >
                              위로 이동
                            </button>
                            <button
                              type="button"
                              disabled={rIdx === rulesArr.length - 1}
                              onClick={() => {
                                setOpenRuleMenuId(null);
                                const copy = [...rulesArr];
                                const [picked] = copy.splice(rIdx, 1);
                                copy.splice(rIdx + 1, 0, picked);
                                setEditingPolicy({
                                  ...editingPolicy,
                                  requester_rules: copy,
                                });
                              }}
                              className="w-full px-3 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-35"
                            >
                              아래로 이동
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenRuleMenuId(null);
                                setEditingPolicy({
                                  ...editingPolicy,
                                  requester_rules: rulesArr.filter(
                                    (x) => x.id !== rule.id
                                  ),
                                });
                              }}
                              className="w-full px-3 py-1.5 text-left font-semibold text-rose-500 hover:bg-rose-50"
                            >
                              규칙 삭제
                            </button>
                          </div>
                        )}

                        {isExp && (
                          <div className="px-4 pb-4 pt-3 border-t border-slate-100 bg-slate-50/40 space-y-4">
                            <div>
                              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                                대상 요청자 표시명 (쉼표로 구성원 구분)
                              </label>
                              <input
                                disabled={!canEdit}
                                value={rule.requester_summary}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const names = val
                                    .split(",")
                                    .map((s) => s.replace(/외\s*\d+명/g, "").trim())
                                    .filter(Boolean);
                                  setEditingPolicy({
                                    ...editingPolicy,
                                    requester_rules: rulesArr.map((x) =>
                                      x.id === rule.id
                                        ? {
                                            ...x,
                                            requester_summary: val,
                                            requester_names: names,
                                          }
                                        : x
                                    ),
                                  });
                                }}
                                placeholder="예: 김종필, 김근식 외 2명"
                                className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold"
                              />
                            </div>

                            <ApprovalLineEditor
                              ccList={rule.cc_list}
                              steps={rule.steps}
                              canEdit={canEdit}
                              customLabels={ex.approval_labels || []}
                              onChangeCc={(nextCc) =>
                                setEditingPolicy({
                                  ...editingPolicy,
                                  requester_rules: rulesArr.map((x) =>
                                    x.id === rule.id
                                      ? { ...x, cc_list: nextCc }
                                      : x
                                  ),
                                })
                              }
                              onChangeSteps={(nextSt) =>
                                setEditingPolicy({
                                  ...editingPolicy,
                                  requester_rules: rulesArr.map((x) =>
                                    x.id === rule.id
                                      ? { ...x, steps: nextSt }
                                      : x
                                  ),
                                })
                              }
                              onOpenPicker={(target) =>
                                setPickerContext({ scope: rule.id, target })
                              }
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* + 설정 추가하기 카드 (Image 6 동일) */}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        const newRule: HqPolicyRequesterRule = {
                          id: `rule-${uid()}`,
                          requester_summary: "신규 대상자 그룹",
                          requester_names: [],
                          cc_list: [{ ...PRESET_ASSIGNEES.KIM_GS }],
                          steps: [
                            {
                              step_order: 1,
                              assignees: [{ ...PRESET_ASSIGNEES.ORG_HEAD_1 }],
                            },
                          ],
                        };
                        setEditingPolicy({
                          ...editingPolicy,
                          requester_rules: [
                            ...(editingPolicy.requester_rules || []),
                            newRule,
                          ],
                        });
                        setExpandedRuleId(newRule.id);
                      }}
                      className="w-full px-4 py-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-700"
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="w-5 h-5 rounded-md bg-[#00c458] text-white flex items-center justify-center text-xs font-extrabold">
                          +
                        </span>
                        <span>설정 추가하기</span>
                      </span>
                      <span className="text-slate-300 text-xs">↗</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 하단 풀사이즈 그라데이션 저장하기 버튼 */}
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
      {/* 모달 2: 승인자 / 참조자 선택 피커                                  */}
      {/* ================================================================= */}
      {pickerContext && (
        <div className="fixed inset-0 bg-slate-900/40 z-[85] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[75vh] text-xs">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900">
                {pickerContext.target.type === "CC"
                  ? "참조 대상 추가"
                  : `${pickerContext.target.stepIndex + 1}단계 승인자 추가`}
              </h4>
              <button
                type="button"
                onClick={() => setPickerContext(null)}
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
                        onClick={() => handleSelectAssigneeFromPicker(roleItem)}
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
                        onClick={() => handleSelectAssigneeFromPicker(memItem)}
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

      {/* ================================================================= */}
      {/* 모달 3: 승인 템플릿 관리                                           */}
      {/* ================================================================= */}
      {templateManagerOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900">
                승인 템플릿 관리
              </h4>
              <button
                type="button"
                onClick={() => setTemplateManagerOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-base"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-3 max-h-[65vh] overflow-y-auto custom-scroll">
              <p className="text-slate-400 leading-relaxed">
                자주 사용하는 결재선·참조 구성을 템플릿으로 저장해 여러 승인 정책에 한 번에 적용할 수 있어요.
              </p>

              <div className="space-y-2">
                {templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="p-3.5 rounded-xl border border-slate-200 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-bold text-slate-900">{tpl.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {summarizeRuleLine(tpl.steps, tpl.cc_list)}
                      </div>
                    </div>
                    {canEdit && templates.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          onSaveExtra(
                            {
                              approval_templates: templates.filter(
                                (t) => t.id !== tpl.id
                              ),
                            },
                            "승인 템플릿이 삭제되었습니다."
                          )
                        }
                        className="text-slate-400 hover:text-rose-500 font-semibold shrink-0"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {canEdit && (
                <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                  <input
                    value={newTplName}
                    onChange={(e) => setNewTplName(e.target.value)}
                    placeholder="새 템플릿 이름 (예: 실장 검토 후 대표 승인)"
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200 font-semibold"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newTplName.trim()) return;
                      const added: HqApprovalTemplate = {
                        id: `tpl-${uid()}`,
                        name: newTplName.trim(),
                        cc_list: [{ ...PRESET_ASSIGNEES.KIM_GS }],
                        steps: [
                          {
                            step_order: 1,
                            assignees: [{ ...PRESET_ASSIGNEES.CHUN }],
                          },
                        ],
                      };
                      await onSaveExtra(
                        { approval_templates: [...templates, added] },
                        "새 승인 템플릿이 생성되었습니다."
                      );
                      setNewTplName("");
                    }}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 text-white font-bold shrink-0"
                  >
                    추가
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 4: 커스텀 워크플로우 양식 정책 추가                            */}
      {/* ================================================================= */}
      {createPolicyOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900">
                워크플로우 승인 정책 추가
              </h4>
              <button
                type="button"
                onClick={() => setCreatePolicyOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-base"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-4 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    아이콘
                  </label>
                  <select
                    value={newPolicyIcon}
                    onChange={(e) => setNewPolicyIcon(e.target.value)}
                    className="w-full px-2 py-2 rounded-xl border border-slate-300 text-center text-base"
                  >
                    {["📋", "💳", "📄", "🔑", "🍔", "🎁", "📦"].map((ic) => (
                      <option key={ic} value={ic}>
                        {ic}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="block font-bold text-slate-700 mb-1">
                    문서 양식 이름
                  </label>
                  <input
                    autoFocus
                    value={newPolicyTitle}
                    onChange={(e) => setNewPolicyTitle(e.target.value)}
                    placeholder="예: 도서·인쇄 발주 품의서"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  작성 안내 설명 (선택)
                </label>
                <input
                  value={newPolicyDesc}
                  onChange={(e) => setNewPolicyDesc(e.target.value)}
                  placeholder="기안 시 상단에 표시할 작성 가이드"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
            </div>
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreatePolicyOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleCreateCustomWorkflowPolicy}
                className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00ad4d] text-white font-extrabold"
              >
                추가하기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================================
// 보조 컴포넌트 A: 승인관리 > 커스텀 승인 라벨 섹션 (Image 3 동일)
// ============================================================================
export function HqApprovalLabelsSection({
  settings,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: {
  settings: HqCompanySettings;
  canEdit: boolean;
  saving: boolean;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onNavigateTab: (tab: HqSettingsTab) => void;
}) {
  const labels = settings.extra_settings?.approval_labels || [];
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#00c458");
  const [desc, setDesc] = useState("");

  const totalCount = 1 + labels.length; // 기본 '승인' 라벨 1개 포함 최대 51개

  const handleAdd = async () => {
    if (!name.trim()) return;
    if (totalCount >= 51) {
      alert("커스텀 승인 라벨은 기본 라벨 포함 최대 51개까지 등록할 수 있습니다.");
      return;
    }
    const item: HqCustomApprovalLabel = {
      id: `lbl-${uid()}`,
      name: name.trim(),
      color,
      description: desc.trim(),
    };
    await onSaveExtra(
      { approval_labels: [...labels, item] },
      "커스텀 승인 라벨이 추가되었습니다."
    );
    setName("");
    setDesc("");
    setModalOpen(false);
  };

  return (
    <div className="space-y-8">
      <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
        커스텀 승인 라벨
      </h2>

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-extrabold text-slate-900">
              라벨 설정
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
              <span>승인 정책에 필요한 라벨을 생성해 관리할 수 있어요.</span>
              <span
                className="text-slate-300 cursor-help"
                title="생성한 라벨은 승인 정책의 결재 단계 역할(승인·합의·검토 등) 선택 목록에 자동으로 추가됩니다."
              >
                ⓘ
              </span>
            </p>
          </div>

          {canEdit && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
            >
              <span className="text-[#00c458] font-extrabold text-sm leading-none">
                +
              </span>
              <span>라벨 추가</span>
            </button>
          )}
        </div>

        {/* 추가된 커스텀 라벨 카운터 (Image 3 동일: 1/51) */}
        <div className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
          <span className="text-slate-400">🏷️</span>
          <span>추가된 커스텀 라벨</span>
          <span className="text-[#00c458] font-extrabold">{totalCount}/51</span>
        </div>

        {/* 기본 제공 '승인' 라벨 카드 + 추가된 커스텀 라벨 카드들 */}
        <div className="space-y-2.5">
          <div className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white shadow-2xs">
            <div className="flex items-center gap-2 text-[13px] font-bold text-slate-800">
              <span className="w-2 h-2 rounded-full bg-[#00c458] shrink-0" />
              <span>승인</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              플렉스에서 제공하는 기본 라벨이에요.
            </div>
          </div>

          {labels.map((lb) => (
            <div
              key={lb.id}
              className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-3 shadow-2xs text-xs"
            >
              <div>
                <div className="flex items-center gap-2 text-[13px] font-bold text-slate-800">
                  <span
                    style={{ backgroundColor: lb.color }}
                    className="w-2 h-2 rounded-full shrink-0"
                  />
                  <span>{lb.name}</span>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {lb.description || "사용자 지정 커스텀 승인 라벨이에요."}
                </div>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    onSaveExtra(
                      {
                        approval_labels: labels.filter((x) => x.id !== lb.id),
                      },
                      "커스텀 승인 라벨이 삭제되었습니다."
                    )
                  }
                  className="text-slate-400 hover:text-rose-500 font-semibold shrink-0"
                >
                  삭제
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 하단 이전/다음 카드 (Image 3 동일: 승인 정책 관리 ← / → 근무 유형) */}
      <div className="pt-12 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onNavigateTab("approval-policy")}
          className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
        >
          <span className="text-slate-400 text-base">←</span>
          <div className="text-right">
            <div className="text-xs font-extrabold text-slate-800">
              승인 정책 관리
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab("work-type")}
          className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
        >
          <div>
            <div className="text-xs font-extrabold text-slate-800">
              근무 유형
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
          </div>
          <span className="text-slate-400 text-base">→</span>
        </button>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900">
                커스텀 승인 라벨 추가
              </h4>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  라벨 명칭
                </label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: 회계검토, 합의, 협조"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  배지 색상
                </label>
                <div className="flex items-center gap-2">
                  {[
                    "#00c458",
                    "#3b82f6",
                    "#8b5cf6",
                    "#f59e0b",
                    "#ec4899",
                  ].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-6 h-6 rounded-full ${
                        color === c ? "ring-2 ring-offset-2 ring-slate-900" : ""
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  설명 (선택)
                </label>
                <input
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="승인 단계에서 사용할 라벨 설명"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleAdd}
                className="px-5 py-2 rounded-xl bg-[#00c458] text-white font-extrabold"
              >
                추가하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 보조 컴포넌트 B: 승인관리 > 대결 관리 ↗ 모달 & 대결 설정 서브모달 (Images 4 & 5)
// ============================================================================
interface AbsenceTableEntry {
  id: string;
  member_name: string;
  avatar_bg: string;
  badge_type: string; // "휴가" | "출장" | "휴직" | "부재"
  absence_label: string; // "연차", "반차", "출장" 등
  start_date: string;
  end_date: string;
  linked_rule?: HqSubstituteApprovalRule;
}

function shiftMonthsIso(baseIso: string, deltaMonths: number): string {
  const d = new Date(`${baseIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return baseIso;
  d.setMonth(d.getMonth() + deltaMonths);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDotRange(startIso: string, endIso: string): string {
  const parse = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return { y: "", md: iso };
    return {
      y: m[1],
      md: `${Number(m[2])}. ${Number(m[3])}`,
      full: `${m[1]}. ${Number(m[2])}. ${Number(m[3])}`,
    };
  };
  const s = parse(startIso);
  const e = parse(endIso || startIso);
  if (!s.y) return `${startIso} - ${endIso}`;
  if (s.y === e.y) {
    return `${s.full} - ${e.md}`;
  }
  return `${s.full} - ${e.full}`;
}

function formatDotSingle(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[1]}. ${Number(m[2])}. ${Number(m[3])}`;
}

function pickAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "#fb923c",
    "#34d399",
    "#f87171",
    "#38bdf8",
    "#a78bfa",
    "#4ade80",
    "#fbbf24",
  ];
  return colors[Math.abs(hash) % colors.length];
}

export function HqSubstituteApprovalModal({
  isOpen,
  settings,
  members,
  canEdit,
  saving,
  onSaveExtra,
  onClose,
}: {
  isOpen: boolean;
  settings: HqCompanySettings;
  members: HqMember[];
  canEdit: boolean;
  saving: boolean;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onClose: () => void;
  onCloseSettings?: () => void;
}) {
  const rules = settings.extra_settings?.substitute_approvals || [];
  const allPolicies =
    settings.extra_settings?.approval_policies &&
    settings.extra_settings.approval_policies.length > 0
      ? settings.extra_settings.approval_policies
      : DEFAULT_APPROVAL_POLICIES;

  const todayIso = new Date().toISOString().slice(0, 10);

  // 메인 탭: "absences" (부재 사항) | "rules" (대결 설정)
  const [mainTab, setMainTab] = useState<"absences" | "rules">("absences");

  // 상단 필터 칩 (Image 4: 오늘 기준 -3개월 ~ +3개월 기본)
  const [rangeStart, setRangeStart] = useState(() =>
    shiftMonthsIso(todayIso, -3)
  );
  const [rangeEnd, setRangeEnd] = useState(() => shiftMonthsIso(todayIso, 3));
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [memberFilter, setMemberFilter] = useState<string>("ALL");
  const [pageSize, setPageSize] = useState<number>(100);

  // 실제 DB 휴가·출장 결재 문서 & 근태 휴가 내역 로드
  const [liveDocs, setLiveDocs] = useState<HqApprovalDoc[]>([]);
  const [liveAtt, setLiveAtt] = useState<HqAttendanceRecord[]>([]);

  // 대결 설정 등록/수정 서브 모달 상태 (Image 5)
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [formAbsentee, setFormAbsentee] = useState<string>("");
  const [formAbsenceItem, setFormAbsenceItem] = useState<string>("");
  const [formStart, setFormStart] = useState<string>("");
  const [formEnd, setFormEnd] = useState<string>("");
  const [formReason, setFormReason] = useState<string>("");
  const [formSubstitute, setFormSubstitute] = useState<string>("");
  const [formPerPolicy, setFormPerPolicy] = useState<boolean>(false);
  const [formPolicyOverrides, setFormPolicyOverrides] = useState<
    { policy_id: string; policy_title: string; substitute_name: string }[]
  >([]);

  useEffect(() => {
    if (!isOpen) return;
    hqFetch<{ success: boolean; data?: { docs?: HqApprovalDoc[] } }>(
      "/api/hq/approvals"
    )
      .then((res) => setLiveDocs(res.data?.docs || []))
      .catch(() => setLiveDocs([]));

    hqFetch<{ success: boolean; data?: { records?: HqAttendanceRecord[] } }>(
      "/api/hq/attendance"
    )
      .then((res) => setLiveAtt(res.data?.records || []))
      .catch(() => setLiveAtt([]));
  }, [isOpen]);

  // 선택 가능한 구성원 풀 (DB 재직 구성원 + Flex 본부 기본 구성원 명단 병합)
  const memberPool = useMemo(() => {
    const names = new Set<string>();
    members
      .filter((m) => m.work_status !== "퇴직")
      .forEach((m) => {
        if (m.name) names.add(m.name);
      });
    [
      "천종현",
      "김근식",
      "김동현",
      "김문수",
      "민세리",
      "박주원",
      "백시연",
      "심혜영",
      "원호준",
      "이웅행",
      "조원형",
      "최수연",
      "한민서",
    ].forEach((n) => names.add(n));
    return Array.from(names).sort((a, b) => a.localeCompare(b, "ko"));
  }, [members]);

  // 부재 사항 통합 테이블 행 생성 (실제 결재·근태 부재 + 등록된 대결 규칙 매칭)
  const absenceEntries = useMemo(() => {
    const rows: AbsenceTableEntry[] = [];
    const seenKeys = new Set<string>();

    // 1) 전자결재 휴가 / 출장 문서 반영
    liveDocs.forEach((doc) => {
      if (doc.status === "REJECTED" || doc.status === "CANCELLED") return;
      const isLeave = doc.doc_type === "LEAVE";
      const isTrip =
        doc.title.includes("출장") || doc.title.includes("외근");
      if (!isLeave && !isTrip) return;

      const sDate = doc.effective_date || doc.submitted_at.slice(0, 10);
      const eDate = doc.end_date || sDate;
      const key = `${doc.drafter_name}_${sDate}_${eDate}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      const matchedRule = rules.find(
        (r) =>
          r.original_approver_name === doc.drafter_name &&
          r.start_date <= eDate &&
          r.end_date >= sDate
      );

      rows.push({
        id: `doc-${doc.approval_id}`,
        member_name: doc.drafter_name,
        avatar_bg: pickAvatarColor(doc.drafter_name),
        badge_type: isLeave ? "휴가" : "출장",
        absence_label: isLeave ? doc.leave_type || "연차" : "출장",
        start_date: sDate,
        end_date: eDate,
        linked_rule: matchedRule,
      });
    });

    // 2) 근태 기록상 휴가/반차 반영
    liveAtt.forEach((att) => {
      if (att.status !== "LEAVE" && att.status !== "HALF_LEAVE") return;
      const sDate = att.work_date;
      const key = `${att.member_name}_${sDate}_${sDate}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      const matchedRule = rules.find(
        (r) =>
          r.original_approver_name === att.member_name &&
          r.start_date <= sDate &&
          r.end_date >= sDate
      );

      rows.push({
        id: `att-${att.attendance_id}`,
        member_name: att.member_name,
        avatar_bg: pickAvatarColor(att.member_name),
        badge_type: "휴가",
        absence_label: att.status === "HALF_LEAVE" ? "반차" : "연차",
        start_date: sDate,
        end_date: sDate,
        linked_rule: matchedRule,
      });
    });

    // 3) 직접 등록한 대결 설정 중 위 일정과 아직 묶이지 않은 항목도 부재 사항에 함께 표시
    rules.forEach((r) => {
      const key = `${r.original_approver_name}_${r.start_date}_${r.end_date}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      rows.push({
        id: `rule-row-${r.id}`,
        member_name: r.original_approver_name,
        avatar_bg: pickAvatarColor(r.original_approver_name),
        badge_type: r.absence_type || "휴가",
        absence_label: r.absence_label || "연차",
        start_date: r.start_date,
        end_date: r.end_date,
        linked_rule: r,
      });
    });

    return rows
      .filter((r) => {
        if (rangeStart && r.end_date < rangeStart) return false;
        if (rangeEnd && r.start_date > rangeEnd) return false;
        if (typeFilter !== "ALL" && r.badge_type !== typeFilter) return false;
        if (memberFilter !== "ALL" && r.member_name !== memberFilter)
          return false;
        return true;
      })
      .sort((a, b) => b.start_date.localeCompare(a.start_date));
  }, [
    liveDocs,
    liveAtt,
    rules,
    rangeStart,
    rangeEnd,
    typeFilter,
    memberFilter,
  ]);

  if (!isOpen) return null;

  const openCreateSubModal = (prefill?: {
    memberName?: string;
    badgeType?: string;
    absenceLabel?: string;
    startDate?: string;
    endDate?: string;
    existingRule?: HqSubstituteApprovalRule;
  }) => {
    if (prefill?.existingRule) {
      const r = prefill.existingRule;
      setEditingRuleId(r.id);
      setFormAbsentee(r.original_approver_name);
      setFormAbsenceItem(
        `${r.absence_type || "휴가"}:${r.absence_label || "연차"}`
      );
      setFormStart(r.start_date);
      setFormEnd(r.end_date);
      setFormReason(r.reason || "");
      setFormSubstitute(r.substitute_approver_name);
      setFormPerPolicy(Boolean(r.per_policy_enabled));
      setFormPolicyOverrides(r.policy_substitutes || []);
    } else {
      setEditingRuleId(null);
      setFormAbsentee(prefill?.memberName || "");
      setFormAbsenceItem(
        prefill?.absenceLabel
          ? `${prefill.badgeType || "휴가"}:${prefill.absenceLabel}`
          : ""
      );
      setFormStart(prefill?.startDate || "");
      setFormEnd(prefill?.endDate || "");
      setFormReason("");
      setFormSubstitute("");
      setFormPerPolicy(false);
      setFormPolicyOverrides([]);
    }
    setSubModalOpen(true);
  };

  const isSubFormReady =
    Boolean(formAbsentee) &&
    Boolean(formAbsenceItem) &&
    Boolean(formStart) &&
    Boolean(formEnd) &&
    Boolean(formSubstitute) &&
    formAbsentee !== formSubstitute;

  const handleSaveSubstitute = async () => {
    if (!isSubFormReady) return;
    if (formEnd < formStart) {
      alert("대결 종료일은 시작일 이후여야 합니다.");
      return;
    }
    const [absType, absLabel] = formAbsenceItem.includes(":")
      ? formAbsenceItem.split(":")
      : ["휴가", formAbsenceItem];

    const nextRule: HqSubstituteApprovalRule = {
      id: editingRuleId || `sub-${uid()}`,
      original_approver_name: formAbsentee,
      substitute_approver_name: formSubstitute,
      absence_type: absType || "휴가",
      absence_label: absLabel || "연차",
      start_date: formStart,
      end_date: formEnd,
      reason: formReason.trim(),
      per_policy_enabled: formPerPolicy,
      policy_substitutes: formPerPolicy ? formPolicyOverrides : [],
      is_active: true,
    };

    const nextList = editingRuleId
      ? rules.map((r) => (r.id === editingRuleId ? nextRule : r))
      : [nextRule, ...rules];

    await onSaveExtra(
      { substitute_approvals: nextList },
      editingRuleId
        ? "대결 설정이 수정되었습니다."
        : "새 대결 설정이 저장되었습니다."
    );
    setSubModalOpen(false);
  };

  const visibleEntries = absenceEntries.slice(0, pageSize);

  return (
    <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-[1080px] h-[84vh] max-h-[820px] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs">
        {/* 상단 헤더 바: 대결 관리 | 부재 사항 | 대결 설정  +  [+ 대결 설정 추가] ✕ */}
        <div className="px-6 py-3.5 border-b border-slate-200/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-6">
            <h3 className="text-[14px] font-extrabold text-slate-900">
              대결 관리
            </h3>

            <div className="flex items-center gap-4 text-[13px] font-bold">
              <button
                type="button"
                onClick={() => setMainTab("absences")}
                className={`py-1 transition-colors ${
                  mainTab === "absences"
                    ? "text-slate-900 font-extrabold"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                부재 사항
              </button>
              <button
                type="button"
                onClick={() => setMainTab("rules")}
                className={`py-1 transition-colors flex items-center gap-1.5 ${
                  mainTab === "rules"
                    ? "text-slate-900 font-extrabold"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                <span>대결 설정</span>
                {rules.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-extrabold">
                    {rules.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {canEdit && (
              <button
                type="button"
                onClick={() => openCreateSubModal()}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
              >
                <span className="text-slate-600 font-extrabold">+</span>
                <span>대결 설정 추가</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center text-base"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 필터 칩 바 (Image 4 동일: 부재 기간 / 부재 유형 / 부재자) */}
        <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 shrink-0 relative">
          <button
            type="button"
            onClick={() => setDateFilterOpen((p) => !p)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold flex items-center gap-1.5"
          >
            <span className="text-slate-400">📅</span>
            <span className="text-slate-500">부재 기간</span>
            <span className="font-bold text-slate-800">
              {formatDotSingle(rangeStart)} - {formatDotSingle(rangeEnd)}
            </span>
            <span className="text-slate-400 text-[10px]">▾</span>
          </button>

          {dateFilterOpen && (
            <div className="absolute left-6 top-12 z-30 p-3.5 rounded-xl bg-white border border-slate-200 shadow-xl flex items-center gap-2">
              <input
                type="date"
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 font-semibold"
              />
              <span className="text-slate-400">~</span>
              <input
                type="date"
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 font-semibold"
              />
              <button
                type="button"
                onClick={() => setDateFilterOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold"
              >
                적용
              </button>
            </div>
          )}

          <div className="flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1">
            <span className="text-slate-400 mr-1.5">🔖</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-transparent font-semibold text-slate-600 focus:outline-none"
            >
              <option value="ALL">부재 유형</option>
              <option value="휴가">휴가</option>
              <option value="출장">출장 · 외근</option>
              <option value="휴직">휴직</option>
            </select>
          </div>

          <div className="flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1">
            <span className="text-slate-400 mr-1.5">👤</span>
            <select
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              className="bg-transparent font-semibold text-slate-600 focus:outline-none"
            >
              <option value="ALL">부재자</option>
              {memberPool.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 테이블 본문 */}
        <div className="flex-1 overflow-y-auto custom-scroll">
          {mainTab === "absences" ? (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-white border-b border-slate-100 text-[11px] font-bold text-slate-400 z-10">
                <tr>
                  <th className="py-3 pl-6 pr-4 w-[24%]">부재자</th>
                  <th className="py-3 px-4 w-[24%]">부재 사항</th>
                  <th className="py-3 px-4 w-[26%]">부재 기간</th>
                  <th className="py-3 pl-4 pr-6 w-[26%]">대결 설정</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleEntries.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-24 text-center text-slate-400"
                    >
                      <div className="text-[13px] font-bold text-slate-700 mb-1">
                        조회된 기간에 등록된 부재 일정이 없어요.
                      </div>
                      <p className="text-xs text-slate-400">
                        구성원이 휴가·출장을 신청하거나 우측 상단{" "}
                        <strong className="text-slate-600">
                          [+ 대결 설정 추가]
                        </strong>
                        로 대결자를 지정하면 여기에 표시됩니다.
                      </p>
                    </td>
                  </tr>
                ) : (
                  visibleEntries.map((row) => {
                    const isUpcomingOrCurrent = row.end_date >= todayIso;
                    return (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50/70 transition-colors"
                      >
                        <td className="py-3 pl-6 pr-4">
                          <div className="flex items-center gap-2.5">
                            <span
                              style={{ backgroundColor: row.avatar_bg }}
                              className="w-7 h-7 rounded-lg text-white text-[10px] font-extrabold flex items-center justify-center shrink-0"
                            >
                              {shortAvatarText(row.member_name)}
                            </span>
                            <span className="font-bold text-slate-800">
                              {row.member_name}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">
                              {row.badge_type}
                            </span>
                            <span className="font-semibold text-slate-700">
                              {row.absence_label}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-600 font-medium">
                          {formatDotRange(row.start_date, row.end_date)}
                        </td>
                        <td className="py-3 pl-4 pr-6">
                          {row.linked_rule ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() =>
                                  openCreateSubModal({
                                    existingRule: row.linked_rule,
                                  })
                                }
                                className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold hover:bg-emerald-100/70"
                              >
                                대결: {row.linked_rule.substitute_approver_name}
                              </button>
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onSaveExtra(
                                      {
                                        substitute_approvals: rules.filter(
                                          (x) => x.id !== row.linked_rule?.id
                                        ),
                                      },
                                      "대결 설정이 해제되었습니다."
                                    )
                                  }
                                  className="text-slate-400 hover:text-rose-500 font-semibold"
                                >
                                  해제
                                </button>
                              )}
                            </div>
                          ) : (
                            isUpcomingOrCurrent &&
                            canEdit && (
                              <button
                                type="button"
                                onClick={() =>
                                  openCreateSubModal({
                                    memberName: row.member_name,
                                    badgeType: row.badge_type,
                                    absenceLabel: row.absence_label,
                                    startDate: row.start_date,
                                    endDate: row.end_date,
                                  })
                                }
                                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-700 shadow-2xs"
                              >
                                + 추가
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            /* 탭 2: 등록된 대결 설정 전용 목록 */
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-white border-b border-slate-100 text-[11px] font-bold text-slate-400 z-10">
                <tr>
                  <th className="py-3 pl-6 pr-4">부재자</th>
                  <th className="py-3 px-4">부재 사항</th>
                  <th className="py-3 px-4">대결 기간</th>
                  <th className="py-3 px-4">기본 대결자</th>
                  <th className="py-3 px-4">사유</th>
                  <th className="py-3 pl-4 pr-6 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-24 text-center text-slate-400"
                    >
                      등록된 대결 설정이 없어요. 우측 상단{" "}
                      <strong className="text-slate-600">
                        [+ 대결 설정 추가]
                      </strong>{" "}
                      버튼으로 추가해 보세요.
                    </td>
                  </tr>
                ) : (
                  rules.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 pl-6 pr-4 font-bold text-slate-900">
                        {r.original_approver_name}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold mr-1.5">
                          {r.absence_type || "휴가"}
                        </span>
                        <span className="font-semibold text-slate-700">
                          {r.absence_label || "연차"}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {formatDotRange(r.start_date, r.end_date)}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-bold text-emerald-700">
                          {r.substitute_approver_name}
                        </span>
                        {r.per_policy_enabled &&
                          (r.policy_substitutes?.length || 0) > 0 && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                              정책별 {r.policy_substitutes?.length}건
                            </span>
                          )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 truncate max-w-[180px]">
                        {r.reason || "-"}
                      </td>
                      <td className="py-3.5 pl-4 pr-6 text-right">
                        {canEdit && (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                openCreateSubModal({ existingRule: r })
                              }
                              className="text-slate-600 hover:text-slate-900 font-bold"
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onSaveExtra(
                                  {
                                    substitute_approvals: rules.filter(
                                      (x) => x.id !== r.id
                                    ),
                                  },
                                  "대결 설정이 삭제되었습니다."
                                )
                              }
                              className="text-rose-500 hover:underline font-bold"
                            >
                              삭제
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* 하단 페이지네이션 푸터 (Image 4 동일) */}
        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 shrink-0 bg-white">
          <span>
            {mainTab === "absences"
              ? absenceEntries.length === 0
                ? "0개 / 총 0개"
                : `1-${visibleEntries.length}개 / 총 ${absenceEntries.length}개`
              : rules.length === 0
                ? "0개 / 총 0개"
                : `1-${rules.length}개 / 총 ${rules.length}개`}
          </span>

          <div className="flex items-center gap-4">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="text-slate-600 font-semibold bg-transparent focus:outline-none"
            >
              <option value={20}>20개씩 보기</option>
              <option value={50}>50개씩 보기</option>
              <option value={100}>100개씩 보기</option>
            </select>
            <span className="text-[#00c458] font-extrabold">1</span>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 서브 모달: 대결 설정 등록/수정 (Image 5 동일)                       */}
      {/* ================================================================= */}
      {subModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[85] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[520px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs">
            {/* 헤더 */}
            <div className="px-6 py-4 flex items-center justify-between shrink-0">
              <h4 className="text-[15px] font-extrabold text-slate-900">
                대결 설정
              </h4>
              <button
                type="button"
                onClick={() => setSubModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-base leading-none"
              >
                ✕
              </button>
            </div>

            <div className="px-6 pb-4 overflow-y-auto custom-scroll space-y-1 flex-1">
              {/* 대결 설정 안내 박스 (Image 5 동일 문구) */}
              <div className="rounded-xl bg-[#f8f9fa] p-4 text-[11px] text-slate-600 space-y-1.5 mb-2">
                <div className="font-extrabold text-slate-800 text-xs">
                  대결 설정 안내
                </div>
                <ul className="list-disc pl-4 space-y-1 leading-relaxed text-slate-500">
                  <li>
                    진행 중 승인 문서에도 소급 적용돼요. 진행 중이던 문서와 설정 이후 새로 만들어진 문서 모두에 대결자가 승인·참조자로 추가돼요.
                  </li>
                  <li>
                    부재자를 명시적으로 지정했거나, 부재자가 유일한 조직장인 승인 요청에 한해 동작해요. 조직 또는 두 명 이상의 조직장인 승인 대상은 대결자로 대체되지 않아요.
                  </li>
                </ul>
              </div>

              {/* 1. 부재자 * */}
              <div className="py-3.5 border-b border-slate-100 flex items-center justify-between gap-4">
                <label className="font-bold text-slate-800">
                  부재자 <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formAbsentee}
                  onChange={(e) => setFormAbsentee(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 min-w-[140px]"
                >
                  <option value="">선택</option>
                  {memberPool.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. 부재 사항 * */}
              <div className="py-3.5 border-b border-slate-100 flex items-center justify-between gap-4">
                <label className="font-bold text-slate-800">
                  부재 사항 <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formAbsenceItem}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormAbsenceItem(val);
                    if (val && !formStart) {
                      setFormStart(todayIso);
                      setFormEnd(todayIso);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 min-w-[140px]"
                >
                  <option value="">선택</option>
                  <option value="휴가:연차">휴가 · 연차</option>
                  <option value="휴가:반차">휴가 · 반차</option>
                  <option value="출장:출장">출장 · 외근</option>
                  <option value="휴가:병가">휴가 · 병가</option>
                  <option value="휴직:휴직">장기 휴직</option>
                  <option value="부재:기타 부재">기타 부재 (직접 입력)</option>
                </select>
              </div>

              {/* 3. 대결 기간 * */}
              <div className="py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <label className="font-bold text-slate-800">
                  대결 기간 <span className="text-rose-500">*</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={formStart}
                    onChange={(e) => {
                      setFormStart(e.target.value);
                      if (!formEnd || formEnd < e.target.value) {
                        setFormEnd(e.target.value);
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold"
                  />
                  <span className="text-slate-400">-</span>
                  <input
                    type="date"
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold"
                  />
                </div>
              </div>

              {/* 4. 사유 */}
              <div className="py-3.5 border-b border-slate-100 space-y-2">
                <label className="block font-bold text-slate-800">사유</label>
                <textarea
                  rows={3}
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  placeholder="입력"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-slate-400 resize-none"
                />
              </div>

              {/* 5. 기본 대결자 * */}
              <div className="py-3.5 border-b border-slate-100 flex items-center justify-between gap-4">
                <label className="font-bold text-slate-800">
                  기본 대결자 <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formSubstitute}
                  onChange={(e) => setFormSubstitute(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 min-w-[140px]"
                >
                  <option value="">선택</option>
                  {memberPool
                    .filter((n) => n !== formAbsentee)
                    .map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                </select>
              </div>

              {/* 6. 정책별 대결자 설정 토글 */}
              <div className="py-3.5 flex items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-slate-800">
                    정책별 대결자 설정
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    승인 정책별로 대결자를 지정할 수 있어요.
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={formPerPolicy}
                  onClick={() => setFormPerPolicy((p) => !p)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                    formPerPolicy ? "bg-[#00c458]" : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ${
                      formPerPolicy ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* 정책별 대결자 개별 지정 영역 (토글 ON 시 노출) */}
              {formPerPolicy && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-600">
                      정책별 개별 대결자 예외 지정
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const firstPol = allPolicies[0];
                        if (!firstPol) return;
                        setFormPolicyOverrides((prev) => [
                          ...prev,
                          {
                            policy_id: firstPol.id,
                            policy_title: firstPol.title,
                            substitute_name:
                              formSubstitute ||
                              memberPool.find((n) => n !== formAbsentee) ||
                              "",
                          },
                        ]);
                      }}
                      className="text-[11px] font-bold text-emerald-600 hover:underline"
                    >
                      + 정책 예외 추가
                    </button>
                  </div>

                  {formPolicyOverrides.length === 0 ? (
                    <div className="text-[11px] text-slate-400">
                      예외를 추가하지 않은 승인 정책은 모두 기본 대결자가 적용됩니다.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {formPolicyOverrides.map((ov, idx) => (
                        <div
                          key={`${ov.policy_id}-${idx}`}
                          className="flex items-center gap-2"
                        >
                          <select
                            value={ov.policy_id}
                            onChange={(e) => {
                              const found = allPolicies.find(
                                (p) => p.id === e.target.value
                              );
                              if (!found) return;
                              setFormPolicyOverrides((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        policy_id: found.id,
                                        policy_title: found.title,
                                      }
                                    : item
                                )
                              );
                            }}
                            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold"
                          >
                            {allPolicies.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.title}
                              </option>
                            ))}
                          </select>

                          <select
                            value={ov.substitute_name}
                            onChange={(e) =>
                              setFormPolicyOverrides((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        substitute_name: e.target.value,
                                      }
                                    : item
                                )
                              )
                            }
                            className="w-28 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-bold"
                          >
                            {memberPool
                              .filter((n) => n !== formAbsentee)
                              .map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                          </select>

                          <button
                            type="button"
                            onClick={() =>
                              setFormPolicyOverrides((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="text-slate-400 hover:text-rose-500 px-1"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 하단 저장 푸터 (Image 5 동일) */}
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end shrink-0 bg-white">
              <button
                type="button"
                disabled={!isSubFormReady || saving}
                onClick={handleSaveSubstitute}
                className={`px-4 py-2 rounded-lg text-white font-extrabold transition-colors ${
                  isSubFormReady
                    ? "bg-[#00c458] hover:bg-[#00ad4d]"
                    : "bg-[#8ee2b3] cursor-not-allowed"
                }`}
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
