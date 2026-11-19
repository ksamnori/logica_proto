// src/components/hq/attendance/HqFlexInlineWorkEditor.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ATTENDANCE_MODES } from "@/lib/hq/constants";
import {
  DEFAULT_APPROVAL_POLICIES,
  DEFAULT_WORK_CONDITION_RULES,
  DEFAULT_WORK_FORM_POLICIES,
} from "@/lib/hq/defaultApprovalPolicies";
import { resolvePolicyApprovalLine } from "@/lib/hq/defaultWorkflowForms";
import {
  formatMinutesToKoreanAmPm,
  resolveBreakWindowsForSpan,
  resolveWorkRuleForMember,
} from "@/lib/hq/defaultWorkRules";
import type {
  HqApprovalPolicyItem,
  HqMember,
  HqOrgChartNode,
  HqRankCode,
  HqRealtimeBreakSpan,
  HqRealtimeModeSegment,
  HqRealtimeWorkLog,
  HqSubstituteApprovalRule,
  HqWorkConditionRule,
  HqWorkEditApprovalPayload,
  HqWorkFormPolicy,
  HqWorkMode,
  HqWorkRuleItem,
} from "@/lib/hq/types";

export interface DraftWorkEdit {
  key: string; // `${memberId}__${workDate}`
  memberId: string;
  memberName: string;
  department: string;
  workDate: string;
  attendanceId?: string;
  actionMode: "UPSERT" | "DELETE";
  workMode: HqWorkMode;
  policyName: string;
  inMinutes: number; // 0 ~ 1425
  outMinutes: number; // 15 ~ 1440
  breakMinutes: number;
  locationNote: string;
  memo: string;
  wasScheduledWorkday: boolean;
  ruleDailyMinutes: number;
  baselineSnapshot: {
    exists: boolean;
    policyName: string;
    workMode: HqWorkMode;
    inMinutes: number;
    outMinutes: number;
    breakMinutes: number;
    workedMinutes: number;
    overtimeMinutes: number;
  };
}

export interface InlineWorkPopoverTarget {
  key: string;
  memberId: string;
  memberName: string;
  department: string;
  workDate: string;
  attendanceId?: string;
  hadExistingRecord: boolean;
  wasScheduledWorkday: boolean;
  ruleDailyMinutes: number;
  anchorRect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
  };
  baseline: {
    workMode: HqWorkMode;
    policyName: string;
    inMinutes: number;
    outMinutes: number;
    breakMinutes: number;
    locationNote: string;
    memo: string;
  };
}

export interface EvaluatedDraftApprovalItem {
  draftKey: string;
  workDate: string;
  memberName: string;
  triggeredReasons: string[];
  reasonRequired: boolean;
  requiresApproval: boolean;
  steps: {
    approver_id: string;
    approver_name: string;
    approver_dept: string;
    approver_rank: HqRankCode;
    approver_title: string;
  }[];
  ccMembers: { id: string; name: string; dept: string }[];
  payload: HqWorkEditApprovalPayload;
}

export function minutesToHm24(mins: number): string {
  const clamped = ((Math.round(mins) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatGrossSpanKorean(
  inMinutes: number,
  outMinutes: number
): string {
  const diff =
    outMinutes >= inMinutes
      ? outMinutes - inMinutes
      : 1440 - inMinutes + outMinutes;
  const safe = Math.max(0, Math.round(diff));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h > 0 && m > 0) return `총 ${h}시간 ${m}분`;
  if (h > 0) return `총 ${h}시간`;
  return `총 ${m}분`;
}

export function calcDraftNetWorkedMinutes(draft: DraftWorkEdit): number {
  if (draft.actionMode === "DELETE") return 0;
  const gross =
    draft.outMinutes >= draft.inMinutes
      ? draft.outMinutes - draft.inMinutes
      : 1440 - draft.inMinutes + draft.outMinutes;
  return Math.max(0, gross - Math.max(0, draft.breakMinutes));
}

export function isDraftIdenticalToBaseline(
  draft: Pick<
    DraftWorkEdit,
    | "actionMode"
    | "workMode"
    | "policyName"
    | "inMinutes"
    | "outMinutes"
    | "breakMinutes"
    | "memo"
  >,
  target: InlineWorkPopoverTarget
): boolean {
  if (draft.actionMode === "DELETE") return false;
  if (!target.hadExistingRecord && !target.wasScheduledWorkday) {
    return false;
  }
  const b = target.baseline;
  return (
    draft.workMode === b.workMode &&
    draft.policyName === b.policyName &&
    draft.inMinutes === b.inMinutes &&
    draft.outMinutes === b.outMinutes &&
    draft.breakMinutes === b.breakMinutes &&
    (draft.memo || "").trim() === (b.memo || "").trim()
  );
}

function calendarDayDiffYmd(earlierYmd: string, laterYmd: string): number {
  const [y1, m1, d1] = earlierYmd.split("-").map(Number);
  const [y2, m2, d2] = laterYmd.split("-").map(Number);
  const t1 = Date.UTC(y1 || 2026, (m1 || 1) - 1, d1 || 1);
  const t2 = Date.UTC(y2 || 2026, (m2 || 1) - 1, d2 || 1);
  return Math.round((t2 - t1) / 86_400_000);
}

/**
 * 플렉스 근무 설정(승인·참조 조건 7종 + 근무 정책 4종)에 따른 승인·참조 대상 자동 산출
 */
export function evaluateDraftsApprovalSummary(params: {
  drafts: DraftWorkEdit[];
  todayStr: string;
  weeklyTotalMinutes: number;
  me: HqMember | null;
  members: HqMember[];
  orgNodes?: HqOrgChartNode[] | null;
  workRules?: HqWorkRuleItem[];
  approvalPolicies?: HqApprovalPolicyItem[];
  workConditionRules?: HqWorkConditionRule[];
  workFormPolicies?: HqWorkFormPolicy[];
  substituteRules?: HqSubstituteApprovalRule[];
  reasonByKey?: Record<string, string>;
}): EvaluatedDraftApprovalItem[] {
  const {
    drafts,
    todayStr,
    weeklyTotalMinutes,
    me,
    members,
    orgNodes,
    workRules,
    approvalPolicies,
    workConditionRules,
    workFormPolicies,
    substituteRules,
    reasonByKey = {},
  } = params;

  const policies =
    approvalPolicies && approvalPolicies.length > 0
      ? approvalPolicies
      : DEFAULT_APPROVAL_POLICIES;
  const condRules =
    workConditionRules && workConditionRules.length > 0
      ? workConditionRules
      : DEFAULT_WORK_CONDITION_RULES;
  const formPolicies =
    workFormPolicies && workFormPolicies.length > 0
      ? workFormPolicies
      : DEFAULT_WORK_FORM_POLICIES;

  const policyMap = new Map(policies.map((p) => [p.id, p]));
  const condMap = new Map(condRules.map((c) => [c.policy_id, c]));

  const results: EvaluatedDraftApprovalItem[] = [];

  for (const d of drafts) {
    const triggeredPolicyIds: { id: string; label: string; reasonReq: boolean }[] =
      [];

    const pushTrigger = (policyId: string, label: string, reasonReq = false) => {
      const pol = policyMap.get(policyId);
      if (!pol) return;
      const hasAny =
        (pol.steps && pol.steps.some((s) => (s.assignees || []).length > 0)) ||
        (pol.cc_list && pol.cc_list.length > 0);
      if (!hasAny) return;
      if (!triggeredPolicyIds.some((x) => x.id === policyId)) {
        triggeredPolicyIds.push({ id: policyId, label, reasonReq });
      }
    };

    if (d.actionMode === "UPSERT") {
      // 1) 근무 정책(근무 / 외근 / 원격근무 / 출장) 승인·참조 확인
      const matchedForm = formPolicies.find((f) => f.name === d.policyName);
      if (matchedForm) {
        pushTrigger(
          matchedForm.policy_id,
          matchedForm.name,
          Boolean(matchedForm.reason_required)
        );
      }

      const netMin = calcDraftNetWorkedMinutes(d);
      const overtimeMin = Math.max(0, netMin - d.ruleDailyMinutes);

      // 2) 연장 근무 (wk-overtime)
      if (overtimeMin > 0) {
        const cr = condMap.get("wk-overtime");
        pushTrigger("wk-overtime", "연장 근무", Boolean(cr?.reason_required));
      }

      // 3) 휴일 근무 (wk-holiday)
      if (!d.wasScheduledWorkday) {
        const cr = condMap.get("wk-holiday");
        pushTrigger("wk-holiday", "휴일 근무", Boolean(cr?.reason_required));
      }

      // 4) 야간 근무 (wk-night: 오후 10시 ~ 오전 6시 포함)
      if (d.inMinutes < 360 || d.outMinutes > 1320) {
        const cr = condMap.get("wk-night");
        pushTrigger("wk-night", "야간 근무", Boolean(cr?.reason_required));
      }

      // 5) 법정근로시간 초과 (wk-legal-over: 주 40h 초과)
      if (weeklyTotalMinutes > 2400) {
        const cr = condMap.get("wk-legal-over");
        pushTrigger(
          "wk-legal-over",
          "법정근로시간 초과",
          Boolean(cr?.reason_required)
        );
      }
    }

    // 6) 과거 근무 수정 (wk-edit-past: 달력일 기준 지정일[1~7일] 초과 과거 일정 수정 시 발동 — Screenshot c8b49118 동일!)
    if (d.workDate < todayStr) {
      const cr = condMap.get("wk-edit-past");
      const limitDays = Math.max(
        1,
        Math.min(7, parseInt(String(cr?.past_edit_limit_days || "3"), 10) || 3)
      );
      const elapsedDays = calendarDayDiffYmd(d.workDate, todayStr);
      if (elapsedDays > limitDays) {
        pushTrigger("wk-edit-past", "과거 근무 수정", Boolean(cr?.reason_required));
      }
    }

    if (triggeredPolicyIds.length === 0) continue;

    const targetMember =
      members.find((m) => m.instructor_id === d.memberId) || me;

    const mergedSteps: EvaluatedDraftApprovalItem["steps"] = [];
    const seenStepIds = new Set<string>();
    const mergedCc: { id: string; name: string; dept: string }[] = [];
    const seenCcKeys = new Set<string>();

    triggeredPolicyIds.forEach((tr) => {
      const pol = policyMap.get(tr.id);
      if (!pol) return;
      const line = resolvePolicyApprovalLine({
        policy: pol,
        me: targetMember,
        members,
        orgNodes,
        substituteRules,
      });
      line.steps.forEach((s) => {
        if (!seenStepIds.has(s.approver_id)) {
          seenStepIds.add(s.approver_id);
          mergedSteps.push({
            approver_id: s.approver_id,
            approver_name: s.approver_name,
            approver_dept: s.approver_dept || "",
            approver_rank: (s.approver_rank || "TEAM_LEAD") as HqRankCode,
            approver_title: s.approver_title,
          });
        }
      });
      line.ccMembers.forEach((c) => {
        const ck = c.id || c.name;
        if (!seenCcKeys.has(ck)) {
          seenCcKeys.add(ck);
          mergedCc.push(c);
        }
      });
    });

    if (mergedSteps.length === 0 && mergedCc.length === 0) continue;

    const afterNet = calcDraftNetWorkedMinutes(d);
    const afterOt = Math.max(0, afterNet - d.ruleDailyMinutes);
    const reasonText = (reasonByKey[d.key] || d.memo || "").trim();
    const memberRule = resolveWorkRuleForMember(
      workRules,
      targetMember?.name || d.memberName,
      targetMember?.profile_extra?.work_schedule_type
    );
    const beforeBreaks = d.baselineSnapshot.exists
      ? resolveBreakWindowsForSpan({
          inMinutes: d.baselineSnapshot.inMinutes,
          outMinutes: d.baselineSnapshot.outMinutes,
          breakMinutes: d.baselineSnapshot.breakMinutes,
          rule: memberRule,
        })
      : [];
    const afterBreaks =
      d.actionMode === "UPSERT"
        ? resolveBreakWindowsForSpan({
            inMinutes: d.inMinutes,
            outMinutes: d.outMinutes,
            breakMinutes: d.breakMinutes,
            rule: memberRule,
          })
        : [];

    results.push({
      draftKey: d.key,
      workDate: d.workDate,
      memberName: d.memberName,
      triggeredReasons: triggeredPolicyIds.map((x) => x.label),
      reasonRequired: triggeredPolicyIds.some((x) => x.reasonReq),
      requiresApproval: mergedSteps.length > 0,
      steps: mergedSteps,
      ccMembers: mergedCc,
      payload: {
        target_member_id: d.memberId,
        target_member_name: d.memberName,
        department: d.department,
        work_date: d.workDate,
        action_mode: d.actionMode,
        attendance_id: d.attendanceId,
        triggered_reasons: triggeredPolicyIds.map((x) => x.label),
        reason_note: reasonText,
        before: {
          exists: d.baselineSnapshot.exists,
          policy_name: d.baselineSnapshot.policyName,
          work_mode: d.baselineSnapshot.workMode,
          in_minutes: d.baselineSnapshot.inMinutes,
          out_minutes: d.baselineSnapshot.outMinutes,
          break_minutes: d.baselineSnapshot.breakMinutes,
          break_start_minutes: beforeBreaks[0]?.start_minutes ?? null,
          break_end_minutes: beforeBreaks[0]?.end_minutes ?? null,
          breaks: beforeBreaks,
          worked_minutes: d.baselineSnapshot.workedMinutes,
          overtime_minutes: d.baselineSnapshot.overtimeMinutes,
        },
        after: {
          exists: d.actionMode === "UPSERT",
          policy_name: d.policyName,
          work_mode: d.workMode,
          in_minutes: d.inMinutes,
          out_minutes: d.outMinutes,
          break_minutes: d.breakMinutes,
          break_start_minutes: afterBreaks[0]?.start_minutes ?? null,
          break_end_minutes: afterBreaks[0]?.end_minutes ?? null,
          breaks: afterBreaks,
          worked_minutes: afterNet,
          overtime_minutes: afterOt,
          location_note: d.locationNote,
          memo: d.memo,
        },
      },
    });
  }

  return results;
}

// 15분 단위 시각 옵션 (오전 12:00 ~ 오후 11:45, 총 96개)
const TIME_SLOTS_15M: { minutes: number; label: string }[] = Array.from(
  { length: 96 },
  (_, idx) => {
    const minutes = idx * 15;
    return {
      minutes,
      label: formatMinutesToKoreanAmPm(minutes),
    };
  }
);

function parseUserTypedTime(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  const isPm = s.includes("오후") || /pm/i.test(s);
  const isAm = s.includes("오전") || /am/i.test(s);
  const cleaned = s.replace(/[^\d:]/g, "");

  let hh = -1;
  let mm = 0;

  if (cleaned.includes(":")) {
    const [hPart, mPart] = cleaned.split(":");
    hh = Number(hPart);
    mm = Number(mPart || 0);
  } else if (cleaned.length === 3) {
    hh = Number(cleaned.slice(0, 1));
    mm = Number(cleaned.slice(1, 3));
  } else if (cleaned.length === 4) {
    hh = Number(cleaned.slice(0, 2));
    mm = Number(cleaned.slice(2, 4));
  } else if (cleaned.length >= 1 && cleaned.length <= 2) {
    hh = Number(cleaned);
    mm = 0;
  }

  if (
    Number.isNaN(hh) ||
    Number.isNaN(mm) ||
    hh < 0 ||
    hh > 24 ||
    mm < 0 ||
    mm > 59
  ) {
    return null;
  }

  if (isPm && hh >= 1 && hh < 12) hh += 12;
  if (isAm && hh === 12) hh = 0;
  if (hh === 24) return 1440;
  return hh * 60 + mm;
}

/**
 * 1. 인정 근무(굵은 막대) 클릭 시 열리는 플렉스 인라인 팝오버 ([근무 편집] 권한 전용)
 */
export function FlexInlineWorkPopover({
  target,
  currentDraft,
  workFormPolicies,
  baselineSnapshot,
  onChangeDraft,
  onClearDraft,
  onStageDelete,
  onConfirmClose,
  onSwitchToLeaveModal,
}: {
  target: InlineWorkPopoverTarget;
  currentDraft?: DraftWorkEdit;
  workFormPolicies: HqWorkFormPolicy[];
  baselineSnapshot: DraftWorkEdit["baselineSnapshot"];
  onChangeDraft: (next: DraftWorkEdit) => void;
  onClearDraft: (key: string) => void;
  onStageDelete: (target: InlineWorkPopoverTarget) => void;
  onConfirmClose: () => void;
  onSwitchToLeaveModal: (workDate: string) => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const timeListRef = useRef<HTMLDivElement | null>(null);

  const [policyDropdownOpen, setPolicyDropdownOpen] = useState(false);
  const [activeTimeField, setActiveTimeField] = useState<"START" | "END" | null>(
    null
  );
  const [typedTimeText, setTypedTimeText] = useState("");
  const [isTypingTime, setIsTypingTime] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [showBreakPicker, setShowBreakPicker] = useState(false);
  const [showMemoInput, setShowMemoInput] = useState(false);

  const effectiveState = useMemo(() => {
    if (currentDraft && currentDraft.actionMode === "UPSERT") {
      return {
        workMode: currentDraft.workMode,
        policyName: currentDraft.policyName,
        inMinutes: currentDraft.inMinutes,
        outMinutes: currentDraft.outMinutes,
        breakMinutes: currentDraft.breakMinutes,
        locationNote: currentDraft.locationNote,
        memo: currentDraft.memo,
      };
    }
    return target.baseline;
  }, [currentDraft, target.baseline]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (cardRef.current?.contains(el)) return;
      if (el.closest("[data-flex-draft-bar='true']")) return;
      onConfirmClose();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", handleOutside);
    }, 10);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [onConfirmClose]);

  useEffect(() => {
    if (!activeTimeField || !timeListRef.current) return;
    const curMin =
      activeTimeField === "START"
        ? effectiveState.inMinutes
        : effectiveState.outMinutes;
    const nearestIdx = Math.max(
      0,
      Math.min(95, Math.round((curMin % 1440) / 15))
    );
    const rowHeight = 34;
    timeListRef.current.scrollTop = Math.max(0, nearestIdx * rowHeight - 96);
  }, [activeTimeField, effectiveState.inMinutes, effectiveState.outMinutes]);

  const applyFieldPatch = (
    patch: Partial<{
      workMode: HqWorkMode;
      policyName: string;
      inMinutes: number;
      outMinutes: number;
      breakMinutes: number;
      locationNote: string;
      memo: string;
    }>
  ) => {
    const merged = {
      ...effectiveState,
      ...patch,
    };

    if (
      (patch.inMinutes !== undefined || patch.outMinutes !== undefined) &&
      patch.breakMinutes === undefined
    ) {
      const span =
        merged.outMinutes >= merged.inMinutes
          ? merged.outMinutes - merged.inMinutes
          : 1440 - merged.inMinutes + merged.outMinutes;
      if (span >= 540) merged.breakMinutes = 60;
      else if (span >= 270) merged.breakMinutes = Math.min(merged.breakMinutes, 30);
      else merged.breakMinutes = 0;
    }

    if (
      isDraftIdenticalToBaseline(
        {
          actionMode: "UPSERT",
          ...merged,
        },
        target
      )
    ) {
      onClearDraft(target.key);
      return;
    }

    onChangeDraft({
      key: target.key,
      memberId: target.memberId,
      memberName: target.memberName,
      department: target.department,
      workDate: target.workDate,
      attendanceId: target.attendanceId,
      actionMode: "UPSERT",
      wasScheduledWorkday: target.wasScheduledWorkday,
      ruleDailyMinutes: target.ruleDailyMinutes,
      baselineSnapshot,
      ...merged,
    });
  };

  const positionStyle = useMemo<React.CSSProperties>(() => {
    const winW = typeof window !== "undefined" ? window.innerWidth : 1280;
    const winH = typeof window !== "undefined" ? window.innerHeight : 800;
    const cardW = 276;
    const estH = 210;

    const left = Math.max(
      16,
      Math.min(winW - cardW - 20, target.anchorRect.left)
    );
    const openAbove =
      target.anchorRect.bottom + estH + 88 > winH &&
      target.anchorRect.top > estH + 24;

    if (openAbove) {
      return {
        position: "fixed",
        left: `${left}px`,
        bottom: `${Math.max(16, winH - target.anchorRect.top + 8)}px`,
        width: `${cardW}px`,
      };
    }

    return {
      position: "fixed",
      left: `${left}px`,
      top: `${Math.max(16, target.anchorRect.bottom + 6)}px`,
      width: `${cardW}px`,
    };
  }, [target.anchorRect]);

  const policyChoices = useMemo(() => {
    const base: { name: string; icon: string; mode: HqWorkMode; loc: string }[] =
      [];
    const seen = new Set<string>();

    const pushChoice = (
      name: string,
      icon: string,
      mode: HqWorkMode,
      loc: string
    ) => {
      if (seen.has(name)) return;
      seen.add(name);
      base.push({ name, icon, mode, loc });
    };

    pushChoice("근무", "💼", "OFFICE", ATTENDANCE_MODES.OFFICE.defaultLocation);
    workFormPolicies.forEach((p) => {
      const m: HqWorkMode = p.name.includes("원격")
        ? "REMOTE"
        : p.name.includes("외근") || p.name.includes("출장")
          ? "OUTSIDE"
          : "OFFICE";
      const loc = p.name.includes("출장")
        ? "출장지"
        : p.name.includes("외근")
          ? "외근지"
          : ATTENDANCE_MODES[m].defaultLocation;
      pushChoice(p.name, p.icon || "💼", m, loc);
    });
    pushChoice(
      "원격근무",
      "🏠",
      "REMOTE",
      ATTENDANCE_MODES.REMOTE.defaultLocation
    );
    pushChoice("외근", "🚗", "OUTSIDE", "외근지");
    pushChoice("출장", "✈️", "OUTSIDE", "출장지");

    return base;
  }, [workFormPolicies]);

  const commitTypedTime = (field: "START" | "END") => {
    if (!isTypingTime) return;
    const parsed = parseUserTypedTime(typedTimeText);
    setIsTypingTime(false);
    if (parsed === null) return;
    if (field === "START") {
      const nextOut =
        parsed >= effectiveState.outMinutes
          ? Math.min(1440, parsed + 60)
          : effectiveState.outMinutes;
      applyFieldPatch({ inMinutes: parsed, outMinutes: nextOut });
    } else {
      applyFieldPatch({ outMinutes: parsed });
    }
  };

  return (
    <div
      ref={cardRef}
      style={positionStyle}
      onClick={(e) => e.stopPropagation()}
      className="z-[150] rounded-2xl bg-white shadow-[0_14px_42px_rgba(15,23,42,0.16)] border border-slate-200/85 select-none"
    >
      <div className="px-4 pt-4 pb-3.5 space-y-3">
        {/* 상단: 근무 정책 선택 드롭다운 (💼 근무 ▾) */}
        <div className="relative flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setPolicyDropdownOpen((v) => !v);
              setActiveTimeField(null);
              setMoreMenuOpen(false);
            }}
            className="inline-flex items-center gap-2.5 px-1.5 py-1 -ml-1.5 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <span className="w-5 h-5 rounded-md bg-[#ccfbf1] text-[#0d9488] flex items-center justify-center text-xs shadow-2xs">
              {effectiveState.workMode === "REMOTE"
                ? "🏠"
                : effectiveState.workMode === "OUTSIDE"
                  ? "🚗"
                  : "💼"}
            </span>
            <span className="text-[13px] font-extrabold text-slate-800">
              {effectiveState.policyName || "근무"}
            </span>
            <span className="text-[10px] text-slate-400">▾</span>
          </button>

          {policyDropdownOpen && (
            <div className="absolute left-0 top-full mt-1 w-48 rounded-xl bg-white shadow-xl border border-slate-200/90 py-1.5 z-[165] text-xs">
              {policyChoices.map((ch) => {
                const selected = effectiveState.policyName === ch.name;
                return (
                  <button
                    key={ch.name}
                    type="button"
                    onClick={() => {
                      applyFieldPatch({
                        policyName: ch.name,
                        workMode: ch.mode,
                        locationNote: ch.loc,
                      });
                      setPolicyDropdownOpen(false);
                    }}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-700"
                  >
                    <span className="flex items-center gap-2">
                      <span>{ch.icon}</span>
                      <span>{ch.name}</span>
                    </span>
                    {selected && (
                      <span className="text-[#0d9488] font-extrabold">✓</span>
                    )}
                  </button>
                );
              })}

              <div className="my-1 border-t border-slate-100" />
              <button
                type="button"
                onClick={() => {
                  setPolicyDropdownOpen(false);
                  onConfirmClose();
                  onSwitchToLeaveModal(target.workDate);
                }}
                className="w-full px-3.5 py-2 text-left hover:bg-purple-50/60 flex items-center gap-2 font-semibold text-purple-700"
              >
                <span>🏖️</span>
                <span>연차 · 휴가 등록...</span>
              </button>
            </div>
          )}
        </div>

        {/* 중단: 출퇴근 시간 범위 (🕒 오전 9:00 -> 오후 6:00) + 총 시간 */}
        <div className="relative flex items-start gap-2.5">
          <span className="mt-1.5 text-slate-400 shrink-0" aria-hidden="true">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-12.25a.75.75 0 00-1.5 0v4.5c0 .199.079.39.22.53l2.5 2.5a.75.75 0 101.06-1.06l-2.28-2.28V5.75z"
                clipRule="evenodd"
              />
            </svg>
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {/* 시작 시각 */}
              <div className="relative">
                {activeTimeField === "START" ? (
                  <div className="px-2 py-1 rounded-md bg-slate-100 inline-flex items-center">
                    <input
                      autoFocus
                      value={
                        isTypingTime
                          ? typedTimeText
                          : formatMinutesToKoreanAmPm(effectiveState.inMinutes)
                      }
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        setIsTypingTime(true);
                        setTypedTimeText(e.target.value);
                      }}
                      onBlur={() => commitTypedTime("START")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          commitTypedTime("START");
                          setActiveTimeField(null);
                        } else if (e.key === "Escape") {
                          setIsTypingTime(false);
                          setActiveTimeField(null);
                        }
                      }}
                      className="w-[74px] bg-[#0066ff] text-white selection:bg-[#0066ff] selection:text-white px-1.5 py-0.5 rounded-[3px] text-xs font-bold outline-none tabular-nums"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setPolicyDropdownOpen(false);
                      setMoreMenuOpen(false);
                      setIsTypingTime(false);
                      setActiveTimeField("START");
                    }}
                    className="px-2 py-1 -ml-1.5 rounded-md hover:bg-slate-100 text-[12.5px] font-bold text-slate-800 tabular-nums transition-colors"
                  >
                    {formatMinutesToKoreanAmPm(effectiveState.inMinutes)}
                  </button>
                )}

                {activeTimeField === "START" && (
                  <div
                    ref={timeListRef}
                    className="absolute left-0 top-full mt-1.5 w-[166px] max-h-[238px] overflow-y-auto rounded-xl bg-white shadow-[0_12px_34px_rgba(15,23,42,0.16)] border border-slate-200/85 py-1.5 z-[170]"
                  >
                    {TIME_SLOTS_15M.map((slot) => {
                      const isCur = slot.minutes === effectiveState.inMinutes;
                      return (
                        <button
                          key={slot.minutes}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const nextOut =
                              slot.minutes >= effectiveState.outMinutes
                                ? Math.min(1440, slot.minutes + 60)
                                : effectiveState.outMinutes;
                            setIsTypingTime(false);
                            applyFieldPatch({
                              inMinutes: slot.minutes,
                              outMinutes: nextOut,
                            });
                            setActiveTimeField(null);
                          }}
                          className={`w-full px-3.5 py-2 text-left text-xs tabular-nums transition-colors ${
                            isCur
                              ? "bg-slate-100 font-extrabold text-slate-900"
                              : "font-medium text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {slot.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <span className="text-slate-300 text-xs font-bold px-0.5">→</span>

              {/* 종료 시각 */}
              <div className="relative">
                {activeTimeField === "END" ? (
                  <div className="px-2 py-1 rounded-md bg-slate-100 inline-flex items-center">
                    <input
                      autoFocus
                      value={
                        isTypingTime
                          ? typedTimeText
                          : formatMinutesToKoreanAmPm(effectiveState.outMinutes)
                      }
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        setIsTypingTime(true);
                        setTypedTimeText(e.target.value);
                      }}
                      onBlur={() => commitTypedTime("END")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          commitTypedTime("END");
                          setActiveTimeField(null);
                        } else if (e.key === "Escape") {
                          setIsTypingTime(false);
                          setActiveTimeField(null);
                        }
                      }}
                      className="w-[74px] bg-[#0066ff] text-white selection:bg-[#0066ff] selection:text-white px-1.5 py-0.5 rounded-[3px] text-xs font-bold outline-none tabular-nums"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setPolicyDropdownOpen(false);
                      setMoreMenuOpen(false);
                      setIsTypingTime(false);
                      setActiveTimeField("END");
                    }}
                    className="px-2 py-1 rounded-md hover:bg-slate-100 text-[12.5px] font-bold text-slate-800 tabular-nums transition-colors"
                  >
                    {formatMinutesToKoreanAmPm(effectiveState.outMinutes)}
                  </button>
                )}

                {activeTimeField === "END" && (
                  <div
                    ref={timeListRef}
                    className="absolute right-0 top-full mt-1.5 w-[166px] max-h-[238px] overflow-y-auto rounded-xl bg-white shadow-[0_12px_34px_rgba(15,23,42,0.16)] border border-slate-200/85 py-1.5 z-[170]"
                  >
                    {TIME_SLOTS_15M.map((slot) => {
                      const isCur = slot.minutes === effectiveState.outMinutes;
                      return (
                        <button
                          key={slot.minutes}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setIsTypingTime(false);
                            applyFieldPatch({ outMinutes: slot.minutes });
                            setActiveTimeField(null);
                          }}
                          className={`w-full px-3.5 py-2 text-left text-xs tabular-nums transition-colors ${
                            isCur
                              ? "bg-slate-100 font-extrabold text-slate-900"
                              : "font-medium text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {slot.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-1 text-[11px] font-semibold text-slate-400 flex items-center gap-2">
              <span>
                {formatGrossSpanKorean(
                  effectiveState.inMinutes,
                  effectiveState.outMinutes
                )}
              </span>
              {effectiveState.breakMinutes > 0 && (
                <span className="text-slate-300">
                  · 휴게 {effectiveState.breakMinutes}분
                </span>
              )}
            </div>
          </div>
        </div>

        {showBreakPicker && (
          <div className="pt-1 flex items-center justify-between gap-1.5 text-[11px]">
            <span className="font-bold text-slate-500">☕ 휴게</span>
            <div className="flex items-center gap-1">
              {[0, 30, 60, 90].map((bm) => (
                <button
                  key={bm}
                  type="button"
                  onClick={() => applyFieldPatch({ breakMinutes: bm })}
                  className={`px-2 py-1 rounded-md font-bold transition-colors ${
                    effectiveState.breakMinutes === bm
                      ? "bg-slate-800 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {bm === 0 ? "없음" : `${bm}분`}
                </button>
              ))}
            </div>
          </div>
        )}

        {(showMemoInput || Boolean(effectiveState.memo)) && (
          <div className="pt-0.5">
            <input
              value={effectiveState.memo}
              onChange={(e) => applyFieldPatch({ memo: e.target.value })}
              placeholder="인정 근무 사유·메모 입력 (선택)"
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50/70 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-slate-400"
            />
          </div>
        )}
      </div>

      {/* 하단 푸터: ⋯ 더보기 + 확인 */}
      <div className="border-t border-slate-100 px-3.5 py-2 flex items-center justify-end gap-1.5 relative">
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setMoreMenuOpen((v) => !v);
              setPolicyDropdownOpen(false);
              setActiveTimeField(null);
            }}
            className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center text-sm font-bold transition-colors"
            title="추가 옵션"
          >
            ⋯
          </button>

          {moreMenuOpen && (
            <div className="absolute right-0 bottom-full mb-1.5 w-40 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 z-[175] text-xs">
              <button
                type="button"
                onClick={() => {
                  setShowBreakPicker((v) => !v);
                  setMoreMenuOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700 flex items-center gap-2"
              >
                <span>☕</span>
                <span>휴게 시간 조정</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMemoInput((v) => !v);
                  setMoreMenuOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700 flex items-center gap-2"
              >
                <span>📝</span>
                <span>사유 · 메모 입력</span>
              </button>
              {(target.hadExistingRecord || Boolean(currentDraft)) && (
                <>
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      if (target.hadExistingRecord) {
                        onStageDelete(target);
                      } else {
                        onClearDraft(target.key);
                      }
                      onConfirmClose();
                    }}
                    className="w-full px-3.5 py-2 text-left hover:bg-rose-50 font-semibold text-rose-600 flex items-center gap-2"
                  >
                    <span>🗑️</span>
                    <span>
                      {target.hadExistingRecord ? "인정 근무 삭제" : "변경 취소"}
                    </span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (activeTimeField) commitTypedTime(activeTimeField);
            if (
              !currentDraft &&
              !target.hadExistingRecord &&
              !target.wasScheduledWorkday
            ) {
              onChangeDraft({
                key: target.key,
                memberId: target.memberId,
                memberName: target.memberName,
                department: target.department,
                workDate: target.workDate,
                attendanceId: target.attendanceId,
                actionMode: "UPSERT",
                wasScheduledWorkday: target.wasScheduledWorkday,
                ruleDailyMinutes: target.ruleDailyMinutes,
                baselineSnapshot,
                ...effectiveState,
              });
            }
            onConfirmClose();
          }}
          className="px-2.5 py-1 rounded-lg hover:bg-slate-100 text-xs font-extrabold text-slate-700 transition-colors"
        >
          확인
        </button>
      </div>
    </div>
  );
}

/**
 * 2. 하단 플로팅 드래프트 바 (취소 | 변경됨 N | 승인·참조 N | 확인 필요 N | 등록하기)
 */
export function FlexDraftFloatingBar({
  drafts,
  approvalCount,
  warningItems,
  approvalPanelOpen,
  submitting,
  onToggleApprovalPanel,
  onCancelAll,
  onSubmitAll,
}: {
  drafts: DraftWorkEdit[];
  approvalCount: number;
  warningItems: string[];
  approvalPanelOpen: boolean;
  submitting: boolean;
  onToggleApprovalPanel: () => void;
  onCancelAll: () => void;
  onSubmitAll: () => void;
}) {
  const [warnOpen, setWarnOpen] = useState(false);
  if (drafts.length === 0) return null;

  return (
    <div
      data-flex-draft-bar="true"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[140] bg-white rounded-2xl shadow-[0_14px_44px_rgba(15,23,42,0.18)] border border-slate-200/90 px-3 py-2 flex items-center gap-1.5 text-xs select-none"
    >
      <button
        type="button"
        disabled={submitting}
        onClick={onCancelAll}
        className="px-3 py-1.5 rounded-xl hover:bg-slate-100 font-bold text-slate-600 transition-colors"
      >
        취소
      </button>

      <span className="w-px h-4 bg-slate-200 mx-0.5" />

      <div className="px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 font-bold text-slate-700">
        <span>변경됨</span>
        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#16cc3b] text-white text-[11px] font-extrabold inline-flex items-center justify-center tabular-nums">
          {drafts.length}
        </span>
      </div>

      <button
        type="button"
        onClick={onToggleApprovalPanel}
        className={`px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 font-bold transition-colors ${
          approvalPanelOpen
            ? "bg-slate-100 text-slate-900"
            : "text-slate-600 hover:bg-slate-50"
        }`}
      >
        <span>승인 · 참조</span>
        <span
          className={`min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-extrabold inline-flex items-center justify-center tabular-nums ${
            approvalCount > 0
              ? "bg-amber-500 text-white"
              : "bg-slate-100 text-slate-400"
          }`}
        >
          {approvalCount}
        </span>
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            if (warningItems.length > 0) setWarnOpen((v) => !v);
          }}
          className="px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 font-bold text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <span>확인 필요</span>
          <span
            className={`min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-extrabold inline-flex items-center justify-center tabular-nums ${
              warningItems.length > 0
                ? "bg-rose-500 text-white"
                : "bg-slate-100 text-slate-400"
            }`}
          >
            {warningItems.length}
          </span>
        </button>

        {warnOpen && warningItems.length > 0 && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 w-72 rounded-2xl bg-white shadow-2xl border border-slate-200 p-3.5 space-y-1.5 text-[11px] text-slate-700">
            <div className="font-extrabold text-rose-600">
              ⚠️ 확인이 필요한 항목 ({warningItems.length})
            </div>
            <ul className="list-disc pl-4 space-y-1 text-slate-600">
              {warningItems.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <span className="w-px h-4 bg-slate-200 mx-0.5" />

      <button
        type="button"
        disabled={submitting}
        onClick={onSubmitAll}
        className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#00d448] to-[#00bfa5] hover:brightness-95 text-white font-extrabold flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
      >
        <svg
          className="w-3.5 h-3.5 -rotate-12"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
        </svg>
        <span>
          {submitting
            ? "처리 중..."
            : approvalCount > 0
              ? "승인 요청 · 등록"
              : "등록하기"}
        </span>
      </button>
    </div>
  );
}

/**
 * 3. 우측 [승인 · 참조] 패널 (Screenshot 369d6a95 + 승인조건 발동 시 승인선·사유 입력 표시)
 */
export function FlexApprovalSidePanel({
  rangeStart,
  rangeEnd,
  evaluatedItems,
  reasonByKey,
  onChangeReason,
  onClose,
}: {
  rangeStart: string;
  rangeEnd: string;
  evaluatedItems: EvaluatedDraftApprovalItem[];
  reasonByKey: Record<string, string>;
  onChangeReason: (draftKey: string, val: string) => void;
  onClose: () => void;
}) {
  const formattedRange = useMemo(() => {
    const fmt = (ymd: string, includeYear: boolean) => {
      const [y, m, d] = ymd.split("-").map(Number);
      return includeYear ? `${y}년 ${m}월 ${d}일` : `${m}월 ${d}일`;
    };
    const sameYear = rangeStart.slice(0, 4) === rangeEnd.slice(0, 4);
    return `${fmt(rangeStart, true)} – ${fmt(rangeEnd, !sameYear)}`;
  }, [rangeStart, rangeEnd]);

  return (
    <aside
      data-flex-draft-bar="true"
      className="w-[300px] shrink-0 border-l border-slate-200 bg-white flex flex-col select-none"
    >
      <div className="px-6 pt-5 pb-4 flex items-start justify-between border-b border-slate-100">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900">승인 · 참조</h3>
          <p className="text-[11px] font-medium text-slate-400 mt-1">
            {formattedRange}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-[11px] font-bold transition-colors"
        >
          ✕
        </button>
      </div>

      {evaluatedItems.length === 0 ? (
        <div className="flex-1 px-6 py-8 flex flex-col items-center justify-center text-center">
          <div className="space-y-2">
            <div className="w-9 h-9 mx-auto rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-300">
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.7}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z"
                />
              </svg>
            </div>
            <div className="text-xs font-extrabold text-slate-500">
              승인 · 참조가 필요한 일정이 없어요.
            </div>
            <p className="text-[11px] font-medium text-slate-400">
              별도의 절차 없이 등록할 수 있어요.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5 space-y-3.5 text-xs">
          {evaluatedItems.map((ev) => (
            <div
              key={ev.draftKey}
              className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold text-slate-900">
                  {ev.workDate}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                    ev.requiresApproval
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {ev.requiresApproval ? "승인 필요" : "참조 알림"}
                </span>
              </div>

              <div className="flex flex-wrap gap-1">
                {ev.triggeredReasons.map((r) => (
                  <span
                    key={r}
                    className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[10.5px] font-bold text-slate-700"
                  >
                    {r}
                  </span>
                ))}
              </div>

              {ev.steps.length > 0 && (
                <div className="text-[11px] text-slate-600">
                  <span className="font-bold text-slate-400 mr-1.5">승인자</span>
                  <span className="font-semibold text-slate-800">
                    {ev.steps.map((s) => s.approver_name).join(" → ")}
                  </span>
                </div>
              )}

              {ev.ccMembers.length > 0 && (
                <div className="text-[11px] text-slate-600">
                  <span className="font-bold text-slate-400 mr-1.5">참조자</span>
                  <span className="font-semibold text-slate-700">
                    {ev.ccMembers.map((c) => c.name).join(", ")}
                  </span>
                </div>
              )}

              <div>
                <input
                  value={reasonByKey[ev.draftKey] || ""}
                  onChange={(e) => onChangeReason(ev.draftKey, e.target.value)}
                  placeholder={
                    ev.reasonRequired
                      ? "사유를 입력해 주세요 (필수)"
                      : "승인 요청 사유 입력 (선택)"
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] text-slate-800 placeholder:text-slate-400 outline-none focus:border-slate-400"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

/**
 * 4. 실시간 근무 기록(얇은 줄) 호버 다크 툴팁 (Screenshot c34f6653 100% 재현)
 */
export function FlexRealtimeHoverTooltip({
  startMin,
  endMin,
  isActiveNow,
  nowMin,
  breaks,
  canEdit,
  anchorPos,
}: {
  startMin: number;
  endMin: number | null;
  isActiveNow: boolean;
  nowMin: number;
  breaks: HqRealtimeBreakSpan[];
  canEdit: boolean;
  anchorPos: { x: number; y: number };
}) {
  const effectiveEnd = endMin ?? nowMin;
  const visibleBreaks = breaks.filter(
    (b) => b.start_min >= startMin && b.start_min < effectiveEnd
  );

  return (
    <div
      style={{
        position: "fixed",
        left: `${Math.max(16, Math.min((typeof window !== "undefined" ? window.innerWidth : 1200) - 240, anchorPos.x - 105))}px`,
        top: `${Math.max(12, anchorPos.y - (visibleBreaks.length > 0 ? 112 : 82))}px`,
      }}
      className="pointer-events-none z-[180] w-[224px] rounded-xl bg-[#2b303a] text-white px-3.5 py-2.5 shadow-2xl text-[11px] space-y-1.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-slate-300 font-medium">기록 시작</span>
        <span className="font-bold tabular-nums">
          {formatMinutesToKoreanAmPm(startMin)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-slate-300 font-medium">기록 종료</span>
        <span className="font-bold tabular-nums">
          {isActiveNow && endMin === null
            ? `${formatMinutesToKoreanAmPm(nowMin)} (진행중)`
            : endMin !== null
              ? formatMinutesToKoreanAmPm(endMin)
              : "-"}
        </span>
      </div>
      {visibleBreaks.length > 0 && (
        <div className="pt-1 border-t border-white/10 flex items-start justify-between gap-2">
          <span className="text-slate-300 font-medium shrink-0">휴게 기록</span>
          <div className="text-right font-semibold tabular-nums space-y-0.5">
            {visibleBreaks.map((b) => (
              <div key={b.id}>
                {formatMinutesToKoreanAmPm(b.start_min)} –{" "}
                {formatMinutesToKoreanAmPm(Math.min(b.end_min, effectiveEnd))}
              </div>
            ))}
          </div>
        </div>
      )}
      {canEdit && !isActiveNow && (
        <div className="pt-1 border-t border-white/10 text-[10px] text-teal-300 font-semibold text-right">
          클릭하여 실시간 기록 수정
        </div>
      )}
    </div>
  );
}

/**
 * 5. 플렉스 [실시간 기록 수정] 모달 (Screenshot 8e9c06fa 100% 재현 — 얇은 줄만 독립 수정!)
 */
export function FlexRealtimeRecordEditModal({
  isOpen,
  memberId,
  memberName,
  department,
  workDate,
  existingLog,
  defaultStartMin,
  defaultEndMin,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  memberId: string;
  memberName: string;
  department: string;
  workDate: string;
  existingLog?: HqRealtimeWorkLog | null;
  defaultStartMin: number;
  defaultEndMin: number;
  onClose: () => void;
  onSaved: (
    action: "UPSERT_REALTIME_LOG" | "DELETE_REALTIME_LOG",
    payload: Record<string, any>
  ) => Promise<void>;
}) {
  const [startMin, setStartMin] = useState(
    existingLog?.start_min ?? defaultStartMin
  );
  const [endMin, setEndMin] = useState<number | null>(
    existingLog ? existingLog.end_min : defaultEndMin
  );
  const [policyName, setPolicyName] = useState(
    existingLog?.policy_name || "근무"
  );
  const [workMode, setWorkMode] = useState<HqWorkMode>(
    existingLog?.work_mode || "OFFICE"
  );
  const [transitions, setTransitions] = useState<HqRealtimeModeSegment[]>(
    existingLog?.transitions || []
  );
  const [breaks, setBreaks] = useState<HqRealtimeBreakSpan[]>(
    existingLog?.breaks || [{ id: "brk-1", start_min: 720, end_min: 780 }]
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStartMin(existingLog?.start_min ?? defaultStartMin);
    setEndMin(existingLog ? existingLog.end_min : defaultEndMin);
    setPolicyName(existingLog?.policy_name || "근무");
    setWorkMode(existingLog?.work_mode || "OFFICE");
    setTransitions(existingLog?.transitions || []);
    setBreaks(
      existingLog?.breaks || [{ id: "brk-1", start_min: 720, end_min: 780 }]
    );
    setMoreOpen(false);
  }, [defaultEndMin, defaultStartMin, existingLog, isOpen]);

  if (!isOpen) return null;

  const [wy, wm, wd] = workDate.split("-").map(Number);
  const dowKo = ["일", "월", "화", "수", "목", "금", "토"][
    new Date(wy || 2026, (wm || 1) - 1, wd || 1).getDay()
  ];
  const dateHeader = `${wy}년 ${wm}월 ${wd}일 (${dowKo})`;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaved("UPSERT_REALTIME_LOG", {
        instructor_id: memberId,
        member_name: memberName,
        department,
        work_date: workDate,
        start_min: startMin,
        end_min: endMin,
        policy_name: policyName,
        work_mode: workMode,
        transitions,
        breaks,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("해당 날짜의 실시간 근무 기록(얇은 줄)을 삭제하시겠습니까?")) {
      return;
    }
    setSaving(true);
    try {
      await onSaved("DELETE_REALTIME_LOG", {
        instructor_id: memberId,
        work_date: workDate,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[190] bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden text-xs"
      >
        {/* 모달 헤더 */}
        <div className="px-6 pt-5 pb-4 flex items-center justify-between">
          <div className="flex items-baseline gap-2.5">
            <h3 className="text-[15px] font-extrabold text-slate-900">
              실시간 기록 수정
            </h3>
            <span className="text-xs font-semibold text-slate-400">
              {dateHeader}
            </span>
          </div>

          <div className="flex items-center gap-1.5 relative">
            {existingLog && (
              <>
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold"
                >
                  ⋯
                </button>
                {moreOpen && (
                  <div className="absolute right-8 top-full mt-1 w-36 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 z-20">
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="w-full px-3.5 py-2 text-left hover:bg-rose-50 text-rose-600 font-bold"
                    >
                      실시간 기록 삭제
                    </button>
                  </div>
                )}
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-[11px] font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 본문 폼 (Screenshot 8e9c06fa 동일 레이아웃) */}
        <div className="px-6 py-3 space-y-5 max-h-[68vh] overflow-y-auto">
          {/* 1) 기록 시작 + 전환 기록 추가 */}
          <div className="grid grid-cols-12 items-start gap-3">
            <label className="col-span-3 pt-2 font-bold text-slate-500">
              기록 시작 <span className="text-rose-500">*</span>
            </label>
            <div className="col-span-9 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={startMin}
                  onChange={(e) => setStartMin(Number(e.target.value))}
                  className="px-3 py-2 rounded-lg border border-slate-200 focus:border-[#16cc3b] bg-white font-bold text-slate-800 outline-none tabular-nums"
                >
                  {TIME_SLOTS_15M.map((s) => (
                    <option key={s.minutes} value={s.minutes}>
                      {s.label}
                    </option>
                  ))}
                </select>

                <select
                  value={policyName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPolicyName(val);
                    setWorkMode(
                      val === "원격근무"
                        ? "REMOTE"
                        : val === "외근" || val === "출장"
                          ? "OUTSIDE"
                          : "OFFICE"
                    );
                  }}
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white font-bold text-slate-800 outline-none"
                >
                  <option value="근무">💼 근무</option>
                  <option value="원격근무">🏠 원격근무</option>
                  <option value="외근">🚗 외근</option>
                  <option value="출장">✈️ 출장</option>
                </select>
              </div>

              {transitions.map((tr, idx) => (
                <div
                  key={tr.id}
                  className="grid grid-cols-12 items-center gap-2"
                >
                  <select
                    value={tr.at_min}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setTransitions((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, at_min: v } : x))
                      );
                    }}
                    className="col-span-5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 outline-none tabular-nums"
                  >
                    {TIME_SLOTS_15M.map((s) => (
                      <option key={s.minutes} value={s.minutes}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={tr.policy_name}
                    onChange={(e) => {
                      const val = e.target.value;
                      const wmMode: HqWorkMode =
                        val === "원격근무"
                          ? "REMOTE"
                          : val === "외근" || val === "출장"
                            ? "OUTSIDE"
                            : "OFFICE";
                      setTransitions((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? { ...x, policy_name: val, work_mode: wmMode }
                            : x
                        )
                      );
                    }}
                    className="col-span-6 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 outline-none"
                  >
                    <option value="근무">💼 근무</option>
                    <option value="원격근무">🏠 원격근무</option>
                    <option value="외근">🚗 외근</option>
                    <option value="출장">✈️ 출장</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setTransitions((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="col-span-1 text-slate-400 hover:text-rose-500 font-bold text-center"
                  >
                    ✕
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() =>
                  setTransitions((prev) => [
                    ...prev,
                    {
                      id: `tr-${Date.now()}`,
                      at_min: Math.min(1380, startMin + 240),
                      policy_name: "원격근무",
                      work_mode: "REMOTE",
                    },
                  ])
                }
                className="text-[11px] font-bold text-slate-400 hover:text-slate-700 flex items-center gap-1"
              >
                <span>+</span>
                <span>전환 기록 추가</span>
              </button>
            </div>
          </div>

          {/* 2) 기록 종료 */}
          <div className="grid grid-cols-12 items-center gap-3">
            <label className="col-span-3 font-bold text-slate-500">
              기록 종료
            </label>
            <div className="col-span-9">
              <div className="inline-flex items-center gap-1.5">
                <select
                  value={endMin ?? ""}
                  onChange={(e) =>
                    setEndMin(
                      e.target.value === "" ? null : Number(e.target.value)
                    )
                  }
                  className="w-44 px-3 py-2 rounded-lg border border-slate-200 focus:border-[#16cc3b] bg-white font-bold text-slate-800 outline-none tabular-nums"
                >
                  <option value="">종료 시각 없음</option>
                  {TIME_SLOTS_15M.map((s) => (
                    <option key={s.minutes} value={s.minutes}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {endMin !== null && (
                  <button
                    type="button"
                    onClick={() => setEndMin(null)}
                    className="w-5 h-5 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-[10px] font-bold"
                    title="종료 시각 지우기"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 3) 휴게 기록 */}
          <div className="grid grid-cols-12 items-start gap-3">
            <label className="col-span-3 pt-2 font-bold text-slate-500">
              휴게 기록
            </label>
            <div className="col-span-9 space-y-2">
              {breaks.map((b, idx) => (
                <div key={b.id} className="flex items-center gap-1.5">
                  <select
                    value={b.start_min}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setBreaks((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, start_min: v } : x
                        )
                      );
                    }}
                    className="flex-1 px-2.5 py-2 rounded-lg border border-slate-200 bg-white font-bold text-slate-800 outline-none tabular-nums"
                  >
                    {TIME_SLOTS_15M.map((s) => (
                      <option key={s.minutes} value={s.minutes}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-300 font-bold">→</span>
                  <select
                    value={b.end_min}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setBreaks((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, end_min: v } : x
                        )
                      );
                    }}
                    className="flex-1 px-2.5 py-2 rounded-lg border border-slate-200 bg-white font-bold text-slate-800 outline-none tabular-nums"
                  >
                    {TIME_SLOTS_15M.map((s) => (
                      <option key={s.minutes} value={s.minutes}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setBreaks((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="w-6 h-6 rounded hover:bg-slate-100 text-slate-400 hover:text-rose-500 font-bold"
                  >
                    ✕
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() =>
                  setBreaks((prev) => [
                    ...prev,
                    {
                      id: `brk-${Date.now()}`,
                      start_min: 720,
                      end_min: 780,
                    },
                  ])
                }
                className="text-[11px] font-bold text-slate-400 hover:text-slate-700 flex items-center gap-1"
              >
                <span>+</span>
                <span>휴게 기록 추가</span>
              </button>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 text-[11px] text-slate-500 leading-relaxed">
            • 실시간 기록(얇은 줄)을 수정하더라도 <strong>인정 근무(굵은 막대)</strong>에는 영향을 주지 않아요.
            <br />• 실시간 기록 편집 내용은 별도 승인 절차 없이 즉시 반영됩니다.
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-white">
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="px-5 py-2 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold shadow-xs transition-colors disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
