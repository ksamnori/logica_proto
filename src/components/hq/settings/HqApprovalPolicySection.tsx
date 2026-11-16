// src/components/hq/settings/HqApprovalPolicySection.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_APPROVAL_POLICIES,
  DEFAULT_APPROVAL_TEMPLATES,
  PRESET_ASSIGNEES,
} from "@/lib/hq/defaultApprovalPolicies";
import type {
  HqApprovalPolicyCategory,
  HqApprovalPolicyItem,
  HqApprovalTemplate,
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
function AssigneeAvatar({ item }: { item: HqPolicyAssignee }) {
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
  onChangeCc: (next: HqPolicyAssignee[]) => void;
  onChangeSteps: (next: HqPolicyStep[]) => void;
  onOpenPicker: (target: { type: "CC" } | { type: "STEP"; stepIndex: number }) => void;
}

function ApprovalLineEditor({
  ccList,
  steps,
  canEdit,
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
                        <div className="absolute right-0 top-8 w-36 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-40 text-xs">
                          {(["승인", "합의", "검토"] as const).map((act) => (
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
        require_approval_bank:
          (byId.get("mi-bank")?.steps.length || 0) > 0,
        require_approval_career:
          (byId.get("mi-career-edu")?.steps.length || 0) > 0,
        require_approval_family:
          (byId.get("mi-family")?.steps.length || 0) > 0,
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

                    <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-base shrink-0">
                      {pol.icon}
                    </span>

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
            </div>

            {/* 스크롤 본문: 일반 결재선 vs 요청자별 승인 (Image 6) */}
            <div className="mt-5 flex-1 overflow-y-auto custom-scroll pr-0.5">
              {!editingPolicy.per_requester ? (
                <ApprovalLineEditor
                  ccList={editingPolicy.cc_list}
                  steps={editingPolicy.steps}
                  canEdit={canEdit}
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
// 보조 컴포넌트 A: 승인관리 > 커스텀 승인 라벨 섹션
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
  const [color, setColor] = useState("#10b981");
  const [desc, setDesc] = useState("");

  const handleAdd = async () => {
    if (!name.trim()) return;
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            커스텀 승인 라벨
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            기본 &apos;승인 / 참조&apos; 외에 회사 고유의 검토·합의·협조 라벨을 만들어 결재 단계에 활용할 수 있어요.
          </p>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
          >
            <span className="text-emerald-500 font-extrabold">+</span>
            <span>라벨 추가</span>
          </button>
        )}
      </div>

      {labels.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center text-center">
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-300 text-lg mb-3">
            🏷️
          </div>
          <div className="text-xs font-extrabold text-slate-700">
            아직 추가한 커스텀 승인 라벨이 없어요.
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            재무 검토, 법무 합의 등 별도 승인 라벨이 필요할 때 추가해 보세요.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {labels.map((lb) => (
            <div
              key={lb.id}
              className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-3 shadow-2xs text-xs"
            >
              <div className="flex items-center gap-3">
                <span
                  style={{ backgroundColor: lb.color }}
                  className="px-2.5 py-1 rounded-full text-white font-bold text-[11px]"
                >
                  {lb.name}
                </span>
                {lb.description && (
                  <span className="text-slate-500">{lb.description}</span>
                )}
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
                  className="text-slate-400 hover:text-rose-500 font-semibold"
                >
                  삭제
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  placeholder="예: 회계검토, 합의"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  배지 색상
                </label>
                <div className="flex items-center gap-2">
                  {[
                    "#10b981",
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
                  placeholder="용도 안내"
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
// 보조 컴포넌트 B: 승인관리 > 대결 관리 ↗ 오버레이 모달
// ============================================================================
export function HqSubstituteApprovalModal({
  isOpen,
  settings,
  members,
  canEdit,
  saving,
  onSaveExtra,
  onClose,
  onCloseSettings,
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
  onCloseSettings: () => void;
}) {
  const router = useRouter();
  const rules = settings.extra_settings?.substitute_approvals || [];
  const today = new Date().toISOString().slice(0, 10);

  const [adding, setAdding] = useState(false);
  const [origName, setOrigName] = useState("천종현");
  const [subName, setSubName] = useState("김근식");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");

  if (!isOpen) return null;

  const memberNames = Array.from(
    new Set([
      "천종현",
      "김근식",
      "조원형",
      "김문수",
      ...members.filter((m) => m.work_status === "재직").map((m) => m.name),
    ])
  );

  const handleSaveRule = async () => {
    if (!origName || !subName || origName === subName) {
      alert("원 승인자와 대결자를 서로 다르게 선택해주세요.");
      return;
    }
    const item: HqSubstituteApprovalRule = {
      id: `sub-${uid()}`,
      original_approver_name: origName,
      substitute_approver_name: subName,
      start_date: startDate,
      end_date: endDate,
      reason: reason.trim(),
      is_active: true,
    };
    await onSaveExtra(
      { substitute_approvals: [...rules, item] },
      "부재 시 대결 설정이 등록되었습니다."
    );
    setAdding(false);
    setReason("");
  };

  return (
    <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-[760px] h-[72vh] max-h-[680px] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-extrabold text-slate-900">
              대결 관리
            </h3>
            <span className="text-slate-400">
              결재권자 휴가·출장 부재 시 대리 승인자를 지정합니다.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onCloseSettings();
                router.push("/hq/approvals");
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-600"
            >
              전자결재함 이동 ↗
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="px-3.5 py-1.5 rounded-lg bg-[#00c458] hover:bg-[#00ad4d] text-white font-extrabold"
              >
                + 대결 추가
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 text-base"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scroll flex flex-col">
          {adding && canEdit && (
            <div className="mb-4 p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    원 승인자
                  </label>
                  <select
                    value={origName}
                    onChange={(e) => setOrigName(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-300 font-bold"
                  >
                    {memberNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    대결자 (대리 승인)
                  </label>
                  <select
                    value={subName}
                    onChange={(e) => setSubName(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-300 font-bold"
                  >
                    {memberNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    시작일
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    종료일
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-300"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="대결 사유 (예: 하계 휴가, 해외 출장)"
                  className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-300"
                />
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="px-3 py-2 rounded-lg border border-slate-300 bg-white font-bold text-slate-600"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveRule}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white font-bold"
                >
                  저장
                </button>
              </div>
            </div>
          )}

          {rules.length === 0 && !adding ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="w-11 h-11 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-400 text-lg mb-3">
                👥
              </div>
              <div className="text-[13px] font-extrabold text-slate-700">
                진행 중인 대결 설정이 없어요.
              </div>
              <p className="text-xs text-slate-400 mt-1">
                승인권자 부재 기간 동안 대신 승인할 구성원을 지정할 수 있어요.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="px-5 py-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-[13px] font-bold text-slate-900">
                      {r.original_approver_name}{" "}
                      <span className="text-emerald-600 mx-1">→</span>{" "}
                      {r.substitute_approver_name} (대결)
                    </div>
                    <div className="text-slate-400 mt-0.5">
                      기간: {r.start_date} ~ {r.end_date}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() =>
                        onSaveExtra(
                          {
                            substitute_approvals: rules.filter(
                              (x) => x.id !== r.id
                            ),
                          },
                          "대결 설정이 해제되었습니다."
                        )
                      }
                      className="text-rose-500 font-bold hover:underline"
                    >
                      해제
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
