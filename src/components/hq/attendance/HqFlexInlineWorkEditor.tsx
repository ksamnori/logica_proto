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
  HqRecognizedBreakBlock,
  HqRecognizedWorkSegment,
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
  inMinutes: number; // 0 ~ 1425 (earliest segment start)
  outMinutes: number; // 15 ~ 1440 (latest segment end)
  breakMinutes: number;
  locationNote: string;
  memo: string;
  segments: HqRecognizedWorkSegment[];
  breaks: HqRecognizedBreakBlock[];
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
    segments: HqRecognizedWorkSegment[];
    breaks: HqRecognizedBreakBlock[];
  };
}

export interface InlineWorkPopoverTarget {
  key: string; // `${memberId}__${workDate}`
  targetKind: "SEGMENT" | "BREAK";
  itemId: string; // segment.id or break.id
  initialTimeFocus?: "START" | "END" | null;
  memberId: string;
  memberName: string;
  department: string;
  workDate: string;
  attendanceId?: string;
  hadExistingRecord: boolean;
  wasScheduledWorkday: boolean;
  isHolidayOrOff: boolean;
  ruleDailyMinutes: number;
  anchorRect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
  };
  baselineSegments: HqRecognizedWorkSegment[];
  baselineBreaks: HqRecognizedBreakBlock[];
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

export function formatDurationKoreanCompact(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  return `${m}분`;
}

export function formatGrossSpanKorean(
  inMinutes: number,
  outMinutes: number
): string {
  const diff =
    outMinutes >= inMinutes
      ? outMinutes - inMinutes
      : 1440 - inMinutes + outMinutes;
  return `총 ${formatDurationKoreanCompact(diff)}`;
}

// ============================================================================
// 다중 근무 블록(Segments) + 다중 휴게 블록(Breaks) 정밀 시간·연장 계산 유틸
// ============================================================================

export function getBreaksOverlappingSegment(
  seg: Pick<HqRecognizedWorkSegment, "in_minutes" | "out_minutes">,
  breaks: HqRecognizedBreakBlock[]
): HqRecognizedBreakBlock[] {
  return [...(breaks || [])]
    .filter(
      (b) =>
        Math.min(seg.out_minutes, b.end_minutes) >
        Math.max(seg.in_minutes, b.start_minutes)
    )
    .sort((a, b) => a.start_minutes - b.start_minutes);
}

export function calcSegmentOverlappingBreaks(
  seg: Pick<HqRecognizedWorkSegment, "in_minutes" | "out_minutes">,
  breaks: HqRecognizedBreakBlock[]
): {
  mergedWindows: { start_minutes: number; end_minutes: number }[];
  overlapMinutes: number;
} {
  const clipped = (breaks || [])
    .map((b) => ({
      start_minutes: Math.max(seg.in_minutes, b.start_minutes),
      end_minutes: Math.min(seg.out_minutes, b.end_minutes),
    }))
    .filter((w) => w.end_minutes > w.start_minutes)
    .sort((a, b) => a.start_minutes - b.start_minutes);

  const mergedWindows: { start_minutes: number; end_minutes: number }[] = [];
  for (const c of clipped) {
    const last = mergedWindows[mergedWindows.length - 1];
    if (last && c.start_minutes <= last.end_minutes) {
      last.end_minutes = Math.max(last.end_minutes, c.end_minutes);
    } else {
      mergedWindows.push({ ...c });
    }
  }
  const overlapMinutes = mergedWindows.reduce(
    (acc, w) => acc + (w.end_minutes - w.start_minutes),
    0
  );
  return { mergedWindows, overlapMinutes };
}

export function calcSegmentNetWorkedMinutes(
  seg: Pick<HqRecognizedWorkSegment, "in_minutes" | "out_minutes">,
  breaks: HqRecognizedBreakBlock[]
): number {
  const gross = Math.max(0, seg.out_minutes - seg.in_minutes);
  const { overlapMinutes } = calcSegmentOverlappingBreaks(seg, breaks);
  return Math.max(0, gross - overlapMinutes);
}

export function calcDayScheduleSummary(
  segments: HqRecognizedWorkSegment[],
  breaks: HqRecognizedBreakBlock[],
  ruleDailyMinutes = 480
): {
  sortedSegments: HqRecognizedWorkSegment[];
  sortedBreaks: HqRecognizedBreakBlock[];
  workedMinutes: number;
  breakMinutes: number;
  overtimeMinutes: number;
  inMinutes: number;
  outMinutes: number;
  workMode: HqWorkMode;
  policyName: string;
  locationNote: string;
  memo: string;
} {
  const sortedSegments = [...(segments || [])].sort(
    (a, b) => a.in_minutes - b.in_minutes
  );
  const sortedBreaks = [...(breaks || [])]
    .filter((b) => b.end_minutes > b.start_minutes)
    .sort((a, b) => a.start_minutes - b.start_minutes);

  let workedMinutes = 0;
  let overlapBreakSum = 0;
  for (const seg of sortedSegments) {
    const gross = Math.max(0, seg.out_minutes - seg.in_minutes);
    const { overlapMinutes } = calcSegmentOverlappingBreaks(seg, sortedBreaks);
    overlapBreakSum += overlapMinutes;
    workedMinutes += Math.max(0, gross - overlapMinutes);
  }

  const standaloneBreakSum = sortedBreaks.reduce(
    (acc, b) => acc + (b.end_minutes - b.start_minutes),
    0
  );
  const breakMinutes =
    sortedSegments.length > 0 ? overlapBreakSum : standaloneBreakSum;
  const overtimeMinutes = Math.max(
    0,
    workedMinutes - Math.max(0, ruleDailyMinutes)
  );

  const inMinutes =
    sortedSegments[0]?.in_minutes ?? sortedBreaks[0]?.start_minutes ?? 540;
  const outMinutes =
    sortedSegments[sortedSegments.length - 1]?.out_minutes ??
    sortedBreaks[sortedBreaks.length - 1]?.end_minutes ??
    600;

  // 대표 근무 형태: 외근/원격/출장 등 커스텀 정책이 포함되어 있으면 우선 표기, 아니면 첫 블록 기준
  const customSeg = sortedSegments.find(
    (s) => s.policy_name && s.policy_name !== "근무"
  );
  const repSeg = customSeg || sortedSegments[0];
  const workMode: HqWorkMode = repSeg?.work_mode || "OFFICE";
  const policyName =
    repSeg?.policy_name ||
    (sortedSegments.length === 0 && sortedBreaks.length > 0 ? "휴게" : "근무");
  const locationNote =
    repSeg?.location_note ||
    ATTENDANCE_MODES[workMode]?.defaultLocation ||
    "본사 편집·연구실";
  const memos = sortedSegments
    .map((s) => (s.memo || "").trim())
    .filter(Boolean);
  const memo = Array.from(new Set(memos)).join(" / ");

  return {
    sortedSegments,
    sortedBreaks,
    workedMinutes,
    breakMinutes,
    overtimeMinutes,
    inMinutes,
    outMinutes,
    workMode,
    policyName,
    locationNote,
    memo,
  };
}

/**
 * 하루에 여러 근무 블록이 있을 때 시간순으로 소정근로(예: 8시간)를 차감하여
 * 각 근무 블록에서 초과 근무(빨간 상단 바)가 정확히 어느 시각부터 시작되는지 산출
 */
export function computeSegmentsOvertimeMeta(
  segments: HqRecognizedWorkSegment[],
  breaks: HqRecognizedBreakBlock[],
  ruleDailyMinutes: number
): Record<
  string,
  {
    netWorkedMin: number;
    overtimeMin: number;
    overtimeStartMin: number | null;
    overtimeLeftPct: number;
    overtimeWidthPct: number;
  }
> {
  const sorted = [...(segments || [])].sort(
    (a, b) => a.in_minutes - b.in_minutes
  );
  let remainingReg = Math.max(0, ruleDailyMinutes);
  const out: Record<
    string,
    {
      netWorkedMin: number;
      overtimeMin: number;
      overtimeStartMin: number | null;
      overtimeLeftPct: number;
      overtimeWidthPct: number;
    }
  > = {};

  for (const seg of sorted) {
    const span = Math.max(1, seg.out_minutes - seg.in_minutes);
    const { mergedWindows } = calcSegmentOverlappingBreaks(seg, breaks);

    // 비휴게 실근무 서브 구간 구축
    const workSubs: { s: number; e: number }[] = [];
    let cursor = seg.in_minutes;
    for (const brk of mergedWindows) {
      if (brk.start_minutes > cursor) {
        workSubs.push({ s: cursor, e: brk.start_minutes });
      }
      cursor = Math.max(cursor, brk.end_minutes);
    }
    if (cursor < seg.out_minutes) {
      workSubs.push({ s: cursor, e: seg.out_minutes });
    }

    let netWorkedMin = 0;
    let overtimeMin = 0;
    let overtimeStartMin: number | null = null;

    for (const sub of workSubs) {
      const dur = sub.e - sub.s;
      netWorkedMin += dur;
      if (remainingReg >= dur) {
        remainingReg -= dur;
      } else {
        const regPart = remainingReg;
        remainingReg = 0;
        const otPart = dur - regPart;
        overtimeMin += otPart;
        if (overtimeStartMin === null) {
          overtimeStartMin = sub.s + regPart;
        }
      }
    }

    if (overtimeStartMin !== null && overtimeMin > 0) {
      const leftPct = Math.max(
        0,
        Math.min(100, ((overtimeStartMin - seg.in_minutes) / span) * 100)
      );
      out[seg.id] = {
        netWorkedMin,
        overtimeMin,
        overtimeStartMin,
        overtimeLeftPct: leftPct,
        overtimeWidthPct: Math.max(0, 100 - leftPct),
      };
    } else {
      out[seg.id] = {
        netWorkedMin,
        overtimeMin: 0,
        overtimeStartMin: null,
        overtimeLeftPct: 100,
        overtimeWidthPct: 0,
      };
    }
  }

  return out;
}

/**
 * 기존 근무 블록을 유지한 채 새로운 근무 블록을 배치할 빈 슬롯 탐색
 * - 기존 블록이 없으면 ruleStartMin ~ ruleEndMin (기본 소정근무 구간)
 * - 기존 블록이 있으면 마지막 블록 직후 1시간 (예: 오후 6:00 ~ 오후 7:00), 공간이 없으면 앞/사이 빈 구간 탐색
 */
export function findNextFreeSegmentSlot(params: {
  existingSegments: HqRecognizedWorkSegment[];
  preferredDuration?: number;
  ruleStartMin?: number;
  ruleEndMin?: number;
}): { in_minutes: number; out_minutes: number; isInitialFullSpan: boolean } {
  const {
    existingSegments,
    preferredDuration = 60,
    ruleStartMin = 540,
    ruleEndMin = 1080,
  } = params;

  if (!existingSegments || existingSegments.length === 0) {
    const s = Math.max(0, Math.min(1380, ruleStartMin));
    const e = Math.max(s + 60, Math.min(1440, ruleEndMin));
    return { in_minutes: s, out_minutes: e, isInitialFullSpan: true };
  }

  const sorted = [...existingSegments].sort(
    (a, b) => a.in_minutes - b.in_minutes
  );
  const lastEnd = sorted[sorted.length - 1].out_minutes;

  // 1순위: 마지막 근무 블록 바로 뒤 (예: 18:00 -> 18:00 ~ 19:00)
  if (lastEnd + preferredDuration <= 1440) {
    return {
      in_minutes: lastEnd,
      out_minutes: lastEnd + preferredDuration,
      isInitialFullSpan: false,
    };
  }
  if (1440 - lastEnd >= 15) {
    return {
      in_minutes: lastEnd,
      out_minutes: 1440,
      isInitialFullSpan: false,
    };
  }

  // 2순위: 블록 사이 빈 구간(뒤쪽부터)
  for (let i = sorted.length - 1; i >= 1; i -= 1) {
    const gapStart = sorted[i - 1].out_minutes;
    const gapEnd = sorted[i].in_minutes;
    if (gapEnd - gapStart >= preferredDuration) {
      return {
        in_minutes: gapStart,
        out_minutes: gapStart + preferredDuration,
        isInitialFullSpan: false,
      };
    }
  }

  // 3순위: 첫 번째 근무 블록 앞 (예: 09:00 앞 -> 08:00 ~ 09:00)
  const firstStart = sorted[0].in_minutes;
  if (firstStart >= preferredDuration) {
    return {
      in_minutes: firstStart - preferredDuration,
      out_minutes: firstStart,
      isInitialFullSpan: false,
    };
  }
  if (firstStart >= 15) {
    return {
      in_minutes: 0,
      out_minutes: firstStart,
      isInitialFullSpan: false,
    };
  }

  // 모든 구간이 꽉 찬 예외 상황에서는 15분 최소 슬롯 배치
  return {
    in_minutes: Math.max(0, 1440 - 30),
    out_minutes: 1440,
    isInitialFullSpan: false,
  };
}

/**
 * 기존 휴게 블록을 유지한 채 새 휴게 블록을 배치할 비충돌 슬롯 탐색
 */
export function findNextFreeBreakSlot(params: {
  existingBreaks: HqRecognizedBreakBlock[];
  targetSegment?: HqRecognizedWorkSegment | null;
  allSegments?: HqRecognizedWorkSegment[];
  ruleBreakStart?: number | null;
  ruleBreakEnd?: number | null;
}): { start_minutes: number; end_minutes: number } {
  const {
    existingBreaks,
    targetSegment,
    allSegments = [],
    ruleBreakStart,
    ruleBreakEnd,
  } = params;

  const sortedBreaks = [...(existingBreaks || [])].sort(
    (a, b) => a.start_minutes - b.start_minutes
  );

  const isFree = (s: number, e: number) =>
    s >= 0 &&
    e <= 1440 &&
    e > s &&
    !sortedBreaks.some((b) => Math.min(e, b.end_minutes) > Math.max(s, b.start_minutes));

  const seg =
    targetSegment ||
    [...allSegments].sort(
      (a, b) => b.out_minutes - b.in_minutes - (a.out_minutes - a.in_minutes)
    )[0] ||
    null;

  if (seg) {
    const segStart = seg.in_minutes;
    const segEnd = seg.out_minutes;
    const segSpan = segEnd - segStart;

    // 1) 근무 유형 기본 휴게(예: 13:00~14:00)가 비어있고 블록 내부에 들어오면 우선 사용
    const rStart = ruleBreakStart ?? 780;
    const rEnd = ruleBreakEnd ?? 840;
    if (
      rEnd > rStart &&
      rStart >= segStart &&
      rEnd <= segEnd &&
      isFree(rStart, rEnd)
    ) {
      return { start_minutes: rStart, end_minutes: rEnd };
    }

    // 2) 블록 내 기존 휴게 바로 뒤 빈 슬롯 탐색 (60분 -> 30분 -> 15분 순)
    const inSegBreaks = getBreaksOverlappingSegment(seg, sortedBreaks);
    for (const dur of [60, 30, 15]) {
      if (segSpan < dur) continue;
      if (inSegBreaks.length > 0) {
        const afterLast = inSegBreaks[inSegBreaks.length - 1].end_minutes;
        if (afterLast + dur <= segEnd && isFree(afterLast, afterLast + dur)) {
          return { start_minutes: afterLast, end_minutes: afterLast + dur };
        }
      }
      // 블록 중간부터 15분 단위로 빈 구간 스캔
      const midPref =
        Math.round((segStart + Math.max(0, segSpan - dur) / 2) / 15) * 15;
      if (
        midPref >= segStart &&
        midPref + dur <= segEnd &&
        isFree(midPref, midPref + dur)
      ) {
        return { start_minutes: midPref, end_minutes: midPref + dur };
      }
      for (let cand = segStart; cand + dur <= segEnd; cand += 15) {
        if (isFree(cand, cand + dur)) {
          return { start_minutes: cand, end_minutes: cand + dur };
        }
      }
    }
  }

  // 단독 휴게 또는 근무 블록 내부가 가득 찬 경우 전체 24시간 중 빈 1시간 탐색
  if (isFree(780, 840)) {
    return { start_minutes: 780, end_minutes: 840 };
  }
  if (sortedBreaks.length > 0) {
    const lastB = sortedBreaks[sortedBreaks.length - 1].end_minutes;
    if (lastB + 60 <= 1440 && isFree(lastB, lastB + 60)) {
      return { start_minutes: lastB, end_minutes: lastB + 60 };
    }
  }
  for (let cand = 540; cand + 30 <= 1440; cand += 15) {
    if (isFree(cand, cand + 30)) {
      return { start_minutes: cand, end_minutes: cand + 30 };
    }
  }
  return { start_minutes: 720, end_minutes: 780 };
}

/**
 * 근무/휴게 블록 드래그 이동 시 다른 블록의 앞이나 뒤로 자연스럽게 넘어가도록
 * 가장 가까운 비충돌 슬롯을 계산
 */
export function resolveNearestNonOverlappingSlot(
  desiredStart: number,
  duration: number,
  obstacles: { start: number; end: number }[],
  minBound = 0,
  maxBound = 1440
): number {
  const safeDur = Math.max(15, Math.min(maxBound - minBound, duration));
  const clampedDesired = Math.max(
    minBound,
    Math.min(maxBound - safeDur, desiredStart)
  );

  if (!obstacles || obstacles.length === 0) {
    return clampedDesired;
  }

  const sortedObs = [...obstacles]
    .map((o) => ({
      start: Math.max(minBound, o.start),
      end: Math.min(maxBound, o.end),
    }))
    .filter((o) => o.end > o.start)
    .sort((a, b) => a.start - b.start);

  const freeGaps: { start: number; end: number }[] = [];
  let cursor = minBound;
  for (const ob of sortedObs) {
    if (ob.start > cursor) {
      freeGaps.push({ start: cursor, end: ob.start });
    }
    cursor = Math.max(cursor, ob.end);
  }
  if (cursor < maxBound) {
    freeGaps.push({ start: cursor, end: maxBound });
  }

  let bestStart: number | null = null;
  let bestDist = Infinity;

  for (const gap of freeGaps) {
    if (gap.end - gap.start < safeDur) continue;
    const minS = gap.start;
    const maxS = gap.end - safeDur;
    const candidate = Math.max(minS, Math.min(maxS, clampedDesired));
    const dist = Math.abs(candidate - clampedDesired);
    if (dist < bestDist) {
      bestDist = dist;
      bestStart = candidate;
    }
  }

  return bestStart !== null ? bestStart : clampedDesired;
}

export function calcDraftNetWorkedMinutes(draft: DraftWorkEdit): number {
  if (draft.actionMode === "DELETE") return 0;
  if (Array.isArray(draft.segments)) {
    return calcDayScheduleSummary(
      draft.segments,
      draft.breaks || [],
      draft.ruleDailyMinutes
    ).workedMinutes;
  }
  const gross =
    draft.outMinutes >= draft.inMinutes
      ? draft.outMinutes - draft.inMinutes
      : 1440 - draft.inMinutes + draft.outMinutes;
  return Math.max(0, gross - Math.max(0, draft.breakMinutes));
}

export function isScheduleIdenticalToBaseline(params: {
  segments: HqRecognizedWorkSegment[];
  breaks: HqRecognizedBreakBlock[];
  baselineSegments: HqRecognizedWorkSegment[];
  baselineBreaks: HqRecognizedBreakBlock[];
}): boolean {
  const s1 = [...params.segments].sort((a, b) => a.in_minutes - b.in_minutes);
  const s2 = [...params.baselineSegments].sort(
    (a, b) => a.in_minutes - b.in_minutes
  );
  if (s1.length !== s2.length) return false;
  for (let i = 0; i < s1.length; i += 1) {
    if (
      s1[i].in_minutes !== s2[i].in_minutes ||
      s1[i].out_minutes !== s2[i].out_minutes ||
      s1[i].work_mode !== s2[i].work_mode ||
      s1[i].policy_name !== s2[i].policy_name ||
      (s1[i].memo || "").trim() !== (s2[i].memo || "").trim()
    ) {
      return false;
    }
  }

  const b1 = [...params.breaks].sort(
    (a, b) => a.start_minutes - b.start_minutes
  );
  const b2 = [...params.baselineBreaks].sort(
    (a, b) => a.start_minutes - b.start_minutes
  );
  if (b1.length !== b2.length) return false;
  for (let i = 0; i < b1.length; i += 1) {
    if (
      b1[i].start_minutes !== b2[i].start_minutes ||
      b1[i].end_minutes !== b2[i].end_minutes
    ) {
      return false;
    }
  }
  return true;
}

export function buildDraftWorkEditFromSchedule(params: {
  key: string;
  memberId: string;
  memberName: string;
  department: string;
  workDate: string;
  attendanceId?: string;
  wasScheduledWorkday: boolean;
  ruleDailyMinutes: number;
  segments: HqRecognizedWorkSegment[];
  breaks: HqRecognizedBreakBlock[];
  baselineSnapshot: DraftWorkEdit["baselineSnapshot"];
}): DraftWorkEdit {
  const {
    key,
    memberId,
    memberName,
    department,
    workDate,
    attendanceId,
    wasScheduledWorkday,
    ruleDailyMinutes,
    segments,
    breaks,
    baselineSnapshot,
  } = params;

  if (segments.length === 0 && breaks.length === 0) {
    return {
      key,
      memberId,
      memberName,
      department,
      workDate,
      attendanceId,
      actionMode: "DELETE",
      workMode: baselineSnapshot.workMode || "OFFICE",
      policyName: baselineSnapshot.policyName || "근무",
      inMinutes: baselineSnapshot.inMinutes || 540,
      outMinutes: baselineSnapshot.outMinutes || 1080,
      breakMinutes: 0,
      locationNote: "",
      memo: "",
      segments: [],
      breaks: [],
      wasScheduledWorkday,
      ruleDailyMinutes,
      baselineSnapshot,
    };
  }

  const summary = calcDayScheduleSummary(segments, breaks, ruleDailyMinutes);
  return {
    key,
    memberId,
    memberName,
    department,
    workDate,
    attendanceId,
    actionMode: "UPSERT",
    workMode: summary.workMode,
    policyName: summary.policyName,
    inMinutes: summary.inMinutes,
    outMinutes: summary.outMinutes,
    breakMinutes: summary.breakMinutes,
    locationNote: summary.locationNote,
    memo: summary.memo,
    segments: summary.sortedSegments,
    breaks: summary.sortedBreaks,
    wasScheduledWorkday,
    ruleDailyMinutes,
    baselineSnapshot,
  };
}

// ============================================================================
// 플렉스 스타일 근무 정책 컬러 & 아이콘 비주얼 헬퍼
// ============================================================================

export function getWorkPolicyVisual(
  policyName?: string,
  workMode?: HqWorkMode
): {
  label: string;
  kind: "WORK" | "OUTSIDE" | "REMOTE" | "TRIP" | "BREAK" | "LEAVE";
  fillClass: string;
  plannedBorderClass: string;
  solidBorderClass: string;
  activeBorderClass: string;
  badgeBgClass: string;
  badgeTextClass: string;
  isStarDefault?: boolean;
} {
  const name = (policyName || "").trim();
  if (name === "휴게") {
    return {
      label: "휴게",
      kind: "BREAK",
      fillClass: "bg-slate-100/95",
      plannedBorderClass: "border-slate-300",
      solidBorderClass: "border-slate-300 text-slate-700",
      activeBorderClass:
        "border-slate-600 ring-1 ring-slate-500/25 text-slate-800",
      badgeBgClass: "bg-slate-100",
      badgeTextClass: "text-slate-500",
    };
  }
  if (name.includes("외근")) {
    return {
      label: name || "외근",
      kind: "OUTSIDE",
      fillClass: "bg-[#fbcfe8]/85",
      plannedBorderClass: "border-[#f472b6]",
      solidBorderClass: "border-[#ec4899] text-[#9d174d]",
      activeBorderClass:
        "border-[#be185d] ring-1 ring-[#be185d]/30 text-[#9d174d]",
      badgeBgClass: "bg-[#fce7f3]",
      badgeTextClass: "text-[#ec4899]",
    };
  }
  if (name.includes("출장")) {
    return {
      label: name || "출장",
      kind: "TRIP",
      fillClass: "bg-[#dcfce7]/90",
      plannedBorderClass: "border-[#86efac]",
      solidBorderClass: "border-[#22c55e] text-[#166534]",
      activeBorderClass:
        "border-[#15803d] ring-1 ring-[#15803d]/30 text-[#166534]",
      badgeBgClass: "bg-[#ecfccb]",
      badgeTextClass: "text-[#65a30d]",
    };
  }
  if (name.includes("원격") || name.includes("재택") || workMode === "REMOTE") {
    return {
      label: name || "원격근무",
      kind: "REMOTE",
      fillClass: "bg-[#fef08a]/80",
      plannedBorderClass: "border-[#fde047]",
      solidBorderClass: "border-[#eab308] text-[#854d0e]",
      activeBorderClass:
        "border-[#a16207] ring-1 ring-[#a16207]/30 text-[#854d0e]",
      badgeBgClass: "bg-[#fef9c3]",
      badgeTextClass: "text-[#ca8a04]",
    };
  }
  if (workMode === "OUTSIDE") {
    return {
      label: name || "외근",
      kind: "OUTSIDE",
      fillClass: "bg-[#fbcfe8]/85",
      plannedBorderClass: "border-[#f472b6]",
      solidBorderClass: "border-[#ec4899] text-[#9d174d]",
      activeBorderClass:
        "border-[#be185d] ring-1 ring-[#be185d]/30 text-[#9d174d]",
      badgeBgClass: "bg-[#fce7f3]",
      badgeTextClass: "text-[#ec4899]",
    };
  }
  return {
    label: name || "근무",
    kind: "WORK",
    fillClass: "bg-[#aef4e8]/92",
    plannedBorderClass: "border-[#5eead4]",
    solidBorderClass: "border-[#2dd4bf] text-[#0f766e]",
    activeBorderClass:
      "border-[#0f766e] ring-1 ring-[#0f766e]/30 text-[#0f766e]",
    badgeBgClass: "bg-[#ccfbf1]",
    badgeTextClass: "text-[#14b8a6]",
    isStarDefault: true,
  };
}

export function PolicySvgIcon({
  kind,
  className = "w-3.5 h-3.5",
}: {
  kind: "WORK" | "OUTSIDE" | "REMOTE" | "TRIP" | "BREAK" | "LEAVE";
  className?: string;
}) {
  if (kind === "OUTSIDE") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M5.5 6.5A2.5 2.5 0 0 1 8 4h8a2.5 2.5 0 0 1 2.4 1.8l1.35 4.45A2.5 2.5 0 0 1 21.5 12.6V17a1.5 1.5 0 0 1-1.5 1.5h-.5a1.5 1.5 0 0 1-1.5-1.5v-1H6v1a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 17v-4.4a2.5 2.5 0 0 1 1.75-2.35L5.5 6.5Zm1.7.5-.9 3h11.4l-.9-3H7.2ZM6.5 14a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm11 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" />
      </svg>
    );
  }
  if (kind === "REMOTE") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M11.3 3.3a1 1 0 0 1 1.4 0l8 7.5a1 1 0 0 1-.68 1.73H19v7.47a1 1 0 0 1-1 1h-4.5v-5h-3v5H6a1 1 0 0 1-1-1v-7.47H3.98a1 1 0 0 1-.68-1.73l8-7.5Z" />
      </svg>
    );
  }
  if (kind === "TRIP") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M21 14.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V7.5l-8 5v2l8-2.5v5.5L8 19v1.5l3.5-1 3.5 1V19l-2-1.5V12l8 2.5Z" />
      </svg>
    );
  }
  if (kind === "BREAK") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={1.6}
        className={className}
      >
        <path d="M3.5 8h12.5v5.5a4.5 4.5 0 0 1-4.5 4.5H8a4.5 4.5 0 0 1-4.5-4.5V8Z" />
        <path
          d="M16 9.2h1.6a2.4 2.4 0 0 1 0 4.8H16"
          fill="none"
          strokeWidth={2}
        />
      </svg>
    );
  }
  if (kind === "LEAVE") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M12 3c-4.97 0-9 3.58-9 8 0 .55.45 1 1 1h7v6.5a1.5 1.5 0 0 1-3 0 .75.75 0 0 0-1.5 0 3 3 0 0 0 6 0V12h7.5c.55 0 1-.45 1-1 0-4.42-4.03-8-9-8Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M9 4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6h4a2 2 0 0 1 2 2v3.25a24.8 24.8 0 0 1-8 1.48 24.8 24.8 0 0 1-8-1.48V8a2 2 0 0 1 2-2h4V4.5Zm1.5.5v1h3V5h-3ZM3 13.1V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4.9a26.6 26.6 0 0 1-7.5 1.35v1.05a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75v-1.05A26.6 26.6 0 0 1 3 13.1Z" />
    </svg>
  );
}

function calendarDayDiffYmd(earlierYmd: string, laterYmd: string): number {
  const [y1, m1, d1] = earlierYmd.split("-").map(Number);
  const [y2, m2, d2] = laterYmd.split("-").map(Number);
  const t1 = Date.UTC(y1 || 2026, (m1 || 1) - 1, d1 || 1);
  const t2 = Date.UTC(y2 || 2026, (m2 || 1) - 1, d2 || 1);
  return Math.round((t2 - t1) / 86_400_000);
}

function normalizePolicyChoices(workFormPolicies: HqWorkFormPolicy[]) {
  const base: {
    name: string;
    mode: HqWorkMode;
    loc: string;
    isDefaultStar?: boolean;
  }[] = [];
  const seen = new Set<string>();

  const pushChoice = (
    name: string,
    mode: HqWorkMode,
    loc: string,
    isDefaultStar = false
  ) => {
    if (seen.has(name)) return;
    seen.add(name);
    base.push({ name, mode, loc, isDefaultStar });
  };

  // 플렉스 기본 순서: 근무 ★ -> 외근 -> 원격근무 -> 출장
  pushChoice(
    "근무",
    "OFFICE",
    ATTENDANCE_MODES.OFFICE.defaultLocation,
    true
  );
  pushChoice("외근", "OUTSIDE", "외근지", false);
  pushChoice(
    "원격근무",
    "REMOTE",
    ATTENDANCE_MODES.REMOTE.defaultLocation,
    false
  );
  pushChoice("출장", "OUTSIDE", "출장지", false);

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
    pushChoice(p.name, m, loc, Boolean(p.is_mandatory && p.name === "근무"));
  });

  return base;
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
    const triggeredPolicyIds: {
      id: string;
      label: string;
      reasonReq: boolean;
    }[] = [];

    const pushTrigger = (
      policyId: string,
      label: string,
      reasonReq = false
    ) => {
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

    if (d.actionMode === "UPSERT" && d.segments.length > 0) {
      // 1) 다중 근무 블록 각각의 정책(근무 / 외근 / 원격근무 / 출장) 승인·참조 확인
      for (const seg of d.segments) {
        const matchedForm = formPolicies.find(
          (f) => f.name === seg.policy_name
        );
        if (matchedForm) {
          pushTrigger(
            matchedForm.policy_id,
            matchedForm.name,
            Boolean(matchedForm.reason_required)
          );
        }
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
      const hasNight = d.segments.some(
        (s) => s.in_minutes < 360 || s.out_minutes > 1320
      );
      if (hasNight) {
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

    // 6) 과거 근무 수정 (wk-edit-past)
    if (d.workDate < todayStr) {
      const cr = condMap.get("wk-edit-past");
      const limitDays = Math.max(
        1,
        Math.min(7, parseInt(String(cr?.past_edit_limit_days || "3"), 10) || 3)
      );
      const elapsedDays = calendarDayDiffYmd(d.workDate, todayStr);
      if (elapsedDays > limitDays) {
        pushTrigger(
          "wk-edit-past",
          "과거 근무 수정",
          Boolean(cr?.reason_required)
        );
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
    const _memberRule = resolveWorkRuleForMember(
      workRules,
      targetMember?.name || d.memberName,
      targetMember?.profile_extra?.work_schedule_type
    );
    void _memberRule;

    const beforeBreaks = (d.baselineSnapshot.breaks || []).map((b) => ({
      start_minutes: b.start_minutes,
      end_minutes: b.end_minutes,
    }));
    const afterBreaks =
      d.actionMode === "UPSERT"
        ? (d.breaks || []).map((b) => ({
            start_minutes: b.start_minutes,
            end_minutes: b.end_minutes,
          }))
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
          segments: d.baselineSnapshot.segments,
          worked_minutes: d.baselineSnapshot.workedMinutes,
          overtime_minutes: d.baselineSnapshot.overtimeMinutes,
        },
        after: {
          exists: d.actionMode === "UPSERT" && d.segments.length > 0,
          policy_name: d.policyName,
          work_mode: d.workMode,
          in_minutes: d.inMinutes,
          out_minutes: d.outMinutes,
          break_minutes: d.breakMinutes,
          break_start_minutes: afterBreaks[0]?.start_minutes ?? null,
          break_end_minutes: afterBreaks[0]?.end_minutes ?? null,
          breaks: afterBreaks,
          segments: d.segments,
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

// 15분 단위 시각 옵션 (오전 12:00 ~ 오후 11:45 + 자정 24:00)
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

// ============================================================================
// 0-A. 플렉스 날짜 행 [+] 버튼 드롭다운 메뉴
// - 오늘/미래 근무일: 근무, 외근, 원격근무, 출장 / 휴게, 연차
// - 휴일(주말·공휴일): 연차 미노출! (근무, 외근, 원격근무, 출장 / 휴게)
// - 지나간 날짜: 상단에 [실시간 기록 (누락된 기록을 추가할 수 있어요.)] 추가 노출 (권한 보유 시)
// ============================================================================
export function FlexRowAddPopover({
  isPastDate,
  isHolidayOrOff,
  canEditWork,
  canEditRealtime,
  workFormPolicies,
  anchorRect,
  onSelectWorkPolicy,
  onSelectBreak,
  onSelectAnnualLeave,
  onSelectRealtimeRecord,
  onClose,
}: {
  isPastDate: boolean;
  isHolidayOrOff: boolean;
  canEditWork: boolean;
  canEditRealtime: boolean;
  workFormPolicies: HqWorkFormPolicy[];
  anchorRect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
  };
  onSelectWorkPolicy: (
    policyName: string,
    workMode: HqWorkMode,
    defaultLoc: string
  ) => void;
  onSelectBreak: () => void;
  onSelectAnnualLeave: () => void;
  onSelectRealtimeRecord: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onOutside);
    }, 10);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [onClose]);

  const choices = useMemo(
    () => normalizePolicyChoices(workFormPolicies),
    [workFormPolicies]
  );

  const showRealtimeItem = isPastDate && canEditRealtime;
  const showLeaveItem = !isHolidayOrOff;

  const posStyle = useMemo<React.CSSProperties>(() => {
    const winW = typeof window !== "undefined" ? window.innerWidth : 1280;
    const winH = typeof window !== "undefined" ? window.innerHeight : 860;
    const menuW = 214;
    const estH =
      (showRealtimeItem ? 64 : 0) +
      (canEditWork ? choices.length * 36 + 50 : 0) +
      (showLeaveItem ? 38 : 0) +
      24;

    const left = Math.max(12, Math.min(winW - menuW - 16, anchorRect.left));
    const openUp =
      anchorRect.bottom + estH > winH - 16 && anchorRect.top > estH + 16;

    if (openUp) {
      return {
        position: "fixed",
        left: `${left}px`,
        bottom: `${Math.max(12, winH - anchorRect.top + 6)}px`,
        width: `${menuW}px`,
      };
    }
    return {
      position: "fixed",
      left: `${left}px`,
      top: `${anchorRect.bottom + 6}px`,
      width: `${menuW}px`,
    };
  }, [anchorRect, canEditWork, choices.length, showLeaveItem, showRealtimeItem]);

  return (
    <div
      ref={menuRef}
      style={posStyle}
      onClick={(e) => e.stopPropagation()}
      className="z-[165] rounded-2xl bg-white shadow-[0_12px_38px_rgba(15,23,42,0.16)] border border-slate-200/90 py-2 text-xs select-none"
    >
      {/* 지나간 날짜 + 실시간 기록 편집 권한 보유 시 상단 노출 */}
      {showRealtimeItem && (
        <>
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectRealtimeRecord();
            }}
            className="w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors flex items-start gap-2.5"
          >
            <span className="mt-0.5 text-slate-700 shrink-0">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="w-4 h-4"
              >
                <circle cx="12" cy="13" r="8" />
                <path strokeLinecap="round" d="M12 9v4l2.5 1.5M9.5 3h5" />
              </svg>
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[12.5px] font-bold text-slate-800">
                  실시간 기록
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#16cc3b]" />
              </div>
              <div className="text-[11px] text-slate-400 font-medium mt-0.5 leading-snug">
                누락된 기록을 추가할 수 있어요.
              </div>
            </div>
          </button>
          {(canEditWork || showLeaveItem) && (
            <div className="my-1.5 border-t border-slate-100" />
          )}
        </>
      )}

      {/* 근무 정책 목록 (근무 ★, 외근, 원격근무, 출장) */}
      {canEditWork && (
        <div className="space-y-0.5">
          {choices.map((ch) => {
            const vis = getWorkPolicyVisual(ch.name, ch.mode);
            return (
              <button
                key={ch.name}
                type="button"
                onClick={() => {
                  onClose();
                  onSelectWorkPolicy(ch.name, ch.mode, ch.loc);
                }}
                className="w-full px-4 py-2 text-left hover:bg-slate-50 transition-colors flex items-center gap-2.5 font-semibold text-slate-800"
              >
                <span
                  className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${vis.badgeBgClass} ${vis.badgeTextClass}`}
                >
                  <PolicySvgIcon kind={vis.kind} className="w-3.5 h-3.5" />
                </span>
                <span className="text-[12.5px]">{ch.name}</span>
                {ch.isDefaultStar && (
                  <span className="w-3.5 h-3.5 rounded-full bg-[#facc15] text-white text-[9px] font-black inline-flex items-center justify-center">
                    ★
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {canEditWork && (canEditWork || showLeaveItem) && (
        <div className="my-1.5 border-t border-slate-100" />
      )}

      {/* 하단: 휴게 + (휴일이 아닐 때만) 연차 */}
      <div className="space-y-0.5">
        {canEditWork && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectBreak();
            }}
            className="w-full px-4 py-2 text-left hover:bg-slate-50 transition-colors flex items-center gap-2.5 font-semibold text-slate-700"
          >
            <span className="w-5 h-5 rounded-md bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
              <PolicySvgIcon kind="BREAK" className="w-3.5 h-3.5" />
            </span>
            <span className="text-[12.5px]">휴게</span>
          </button>
        )}

        {showLeaveItem && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectAnnualLeave();
            }}
            className="w-full px-4 py-2 text-left hover:bg-purple-50/50 transition-colors flex items-center gap-2.5 font-semibold text-slate-800"
          >
            <span className="w-5 h-5 rounded-md bg-purple-100 text-[#9333ea] flex items-center justify-center shrink-0">
              <PolicySvgIcon kind="LEAVE" className="w-3.5 h-3.5" />
            </span>
            <span className="text-[12.5px]">연차</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 0-B. 블록 하단 '휴게 N건' / '휴게 없음' 클릭 시 열리는 휴게 목록 & [+ 휴게 추가] 팝오버
// ============================================================================
export function FlexBreakListPopover({
  breaks,
  canEdit,
  anchorRect,
  onAddBreak,
  onEditBreak,
  onDeleteBreak,
  onClose,
}: {
  breaks: HqRecognizedBreakBlock[];
  canEdit: boolean;
  anchorRect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
  };
  onAddBreak: () => void;
  onEditBreak: (breakId: string) => void;
  onDeleteBreak: (breakId: string) => void;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onOutside);
    }, 10);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [onClose]);

  const posStyle = useMemo<React.CSSProperties>(() => {
    const winW = typeof window !== "undefined" ? window.innerWidth : 1280;
    const winH = typeof window !== "undefined" ? window.innerHeight : 860;
    const cardW = 216;
    const estH = Math.max(1, breaks.length) * 52 + 56;
    const left = Math.max(16, Math.min(winW - cardW - 16, anchorRect.left));
    const openUp =
      anchorRect.bottom + estH > winH - 20 && anchorRect.top > estH + 20;

    if (openUp) {
      return {
        position: "fixed",
        left: `${left}px`,
        bottom: `${Math.max(14, winH - anchorRect.top + 6)}px`,
        width: `${cardW}px`,
      };
    }
    return {
      position: "fixed",
      left: `${left}px`,
      top: `${anchorRect.bottom + 6}px`,
      width: `${cardW}px`,
    };
  }, [anchorRect, breaks.length]);

  return (
    <div
      ref={cardRef}
      style={posStyle}
      onClick={(e) => e.stopPropagation()}
      className="z-[165] rounded-2xl bg-white shadow-[0_14px_38px_rgba(15,23,42,0.16)] border border-slate-200/90 overflow-hidden select-none text-xs"
    >
      <div className="py-1.5">
        {breaks.length === 0 ? (
          <div className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-400 flex items-center gap-2">
            <span className="text-slate-300">
              <PolicySvgIcon kind="BREAK" className="w-3.5 h-3.5" />
            </span>
            <span>등록된 휴게가 없어요</span>
          </div>
        ) : (
          breaks.map((brk) => {
            const dur = Math.max(0, brk.end_minutes - brk.start_minutes);
            return (
              <div
                key={brk.id}
                onClick={() => {
                  if (!canEdit) return;
                  onEditBreak(brk.id);
                }}
                className={`px-3.5 py-2 flex items-start justify-between gap-2 group transition-colors ${
                  canEdit ? "hover:bg-slate-50 cursor-pointer" : ""
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <span className="mt-0.5 text-slate-400 shrink-0">
                    <PolicySvgIcon kind="BREAK" className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-extrabold text-slate-800 leading-tight">
                      {formatDurationKoreanCompact(dur)}
                    </div>
                    <div className="text-[11px] font-medium text-slate-400 mt-0.5 tabular-nums whitespace-nowrap">
                      {formatMinutesToKoreanAmPm(brk.start_minutes)} –{" "}
                      {formatMinutesToKoreanAmPm(brk.end_minutes)}
                    </div>
                  </div>
                </div>

                {canEdit && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteBreak(brk.id);
                    }}
                    title="휴게 삭제"
                    className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-500 flex items-center justify-center text-[11px] font-bold transition-all"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {canEdit && (
        <div className="p-1.5 border-t border-slate-100">
          <button
            type="button"
            onClick={() => {
              onAddBreak();
            }}
            className="w-full px-3 py-2 rounded-xl bg-slate-100/85 hover:bg-slate-200/75 transition-colors flex items-center gap-2 text-left"
          >
            <span className="w-4 h-4 rounded-[4px] bg-[#2563eb] text-white inline-flex items-center justify-center text-[11px] font-black leading-none shrink-0">
              +
            </span>
            <span className="text-xs font-extrabold text-slate-700">
              휴게 추가
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 1. 인정 근무 블록 / 휴게 블록 클릭 또는 하단 시간 클릭 시 열리는 플렉스 인라인 팝오버
// - 종료 시각 클릭 시 시작 시각으로부터 경과한 근무 시간(예: 30분, 1시간, 1시간 15분) 배지 표시
// ============================================================================
export function FlexInlineWorkPopover({
  target,
  currentDraft,
  workFormPolicies,
  baselineSnapshot,
  onChangeDraft,
  onClearDraft,
  onSwitchTarget,
  onConfirmClose,
  onSwitchToLeaveModal,
}: {
  target: InlineWorkPopoverTarget;
  currentDraft?: DraftWorkEdit;
  workFormPolicies: HqWorkFormPolicy[];
  baselineSnapshot: DraftWorkEdit["baselineSnapshot"];
  onChangeDraft: (next: DraftWorkEdit) => void;
  onClearDraft: (key: string) => void;
  onSwitchTarget?: (nextTarget: InlineWorkPopoverTarget) => void;
  onConfirmClose: () => void;
  onSwitchToLeaveModal: (workDate: string) => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const timeListRef = useRef<HTMLDivElement | null>(null);
  const idSeqRef = useRef(1);

  const [policyDropdownOpen, setPolicyDropdownOpen] = useState(false);
  const [activeTimeField, setActiveTimeField] = useState<
    "START" | "END" | null
  >(target.initialTimeFocus ?? null);
  const [typedTimeText, setTypedTimeText] = useState("");
  const [isTypingTime, setIsTypingTime] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [showMemoInput, setShowMemoInput] = useState(false);

  const effectiveDay = useMemo(() => {
    if (currentDraft) {
      if (currentDraft.actionMode === "DELETE") {
        return {
          segments: [] as HqRecognizedWorkSegment[],
          breaks: [] as HqRecognizedBreakBlock[],
        };
      }
      return {
        segments: currentDraft.segments,
        breaks: currentDraft.breaks,
      };
    }
    return {
      segments: target.baselineSegments,
      breaks: target.baselineBreaks,
    };
  }, [currentDraft, target.baselineBreaks, target.baselineSegments]);

  const activeSegment = useMemo(
    () =>
      target.targetKind === "SEGMENT"
        ? effectiveDay.segments.find((s) => s.id === target.itemId) ||
          effectiveDay.segments[0] ||
          null
        : null,
    [effectiveDay.segments, target.itemId, target.targetKind]
  );

  const activeBreak = useMemo(
    () =>
      target.targetKind === "BREAK"
        ? effectiveDay.breaks.find((b) => b.id === target.itemId) ||
          effectiveDay.breaks[0] ||
          null
        : null,
    [effectiveDay.breaks, target.itemId, target.targetKind]
  );

  const curInMin =
    target.targetKind === "BREAK"
      ? activeBreak?.start_minutes ?? 780
      : activeSegment?.in_minutes ?? 540;
  const curOutMin =
    target.targetKind === "BREAK"
      ? activeBreak?.end_minutes ?? 840
      : activeSegment?.out_minutes ?? 1080;
  const curPolicyName =
    target.targetKind === "BREAK"
      ? "휴게"
      : activeSegment?.policy_name || "근무";
  const curWorkMode: HqWorkMode =
    target.targetKind === "BREAK"
      ? "OFFICE"
      : activeSegment?.work_mode || "OFFICE";
  const curMemo =
    target.targetKind === "SEGMENT" ? activeSegment?.memo || "" : "";

  const overlappingBreakMinForActiveSeg = useMemo(() => {
    if (target.targetKind !== "SEGMENT" || !activeSegment) return 0;
    return calcSegmentOverlappingBreaks(activeSegment, effectiveDay.breaks)
      .overlapMinutes;
  }, [activeSegment, effectiveDay.breaks, target.targetKind]);

  // 종료 시각 드롭다운 옵션: 시작 시각 이후 15분 간격 + 경과 시간 배지 (플렉스 동일!)
  const endTimeOptions = useMemo(() => {
    const out: {
      minutes: number;
      label: string;
      elapsedLabel: string;
      netWorkLabel: string | null;
    }[] = [];

    for (let m = curInMin + 15; m <= 1440; m += 15) {
      const elapsed = m - curInMin;
      const label =
        m === 1440 ? "오전 12:00 (자정)" : formatMinutesToKoreanAmPm(m);
      let netWorkLabel: string | null = null;
      if (target.targetKind === "SEGMENT") {
        const { overlapMinutes } = calcSegmentOverlappingBreaks(
          { in_minutes: curInMin, out_minutes: m },
          effectiveDay.breaks
        );
        if (overlapMinutes > 0 && elapsed > overlapMinutes) {
          netWorkLabel = `실근무 ${formatDurationKoreanCompact(
            elapsed - overlapMinutes
          )}`;
        }
      }
      out.push({
        minutes: m,
        label,
        elapsedLabel: formatDurationKoreanCompact(elapsed),
        netWorkLabel,
      });
    }
    return out;
  }, [curInMin, effectiveDay.breaks, target.targetKind]);

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
    const rowHeight = 34;
    if (activeTimeField === "START") {
      const nearestIdx = Math.max(
        0,
        Math.min(95, Math.round((curInMin % 1440) / 15))
      );
      timeListRef.current.scrollTop = Math.max(0, nearestIdx * rowHeight - 84);
    } else {
      const idx = endTimeOptions.findIndex((o) => o.minutes >= curOutMin);
      const safeIdx = idx >= 0 ? idx : 0;
      timeListRef.current.scrollTop = Math.max(0, safeIdx * rowHeight - 84);
    }
  }, [activeTimeField, curInMin, curOutMin, endTimeOptions]);

  const commitNextSchedule = (
    nextSegments: HqRecognizedWorkSegment[],
    nextBreaks: HqRecognizedBreakBlock[]
  ) => {
    const identical = isScheduleIdenticalToBaseline({
      segments: nextSegments,
      breaks: nextBreaks,
      baselineSegments: target.baselineSegments,
      baselineBreaks: target.baselineBreaks,
    });

    if (
      identical &&
      (target.hadExistingRecord ||
        target.wasScheduledWorkday ||
        (nextSegments.length === 0 && nextBreaks.length === 0))
    ) {
      onClearDraft(target.key);
      return;
    }

    onChangeDraft(
      buildDraftWorkEditFromSchedule({
        key: target.key,
        memberId: target.memberId,
        memberName: target.memberName,
        department: target.department,
        workDate: target.workDate,
        attendanceId: target.attendanceId,
        wasScheduledWorkday: target.wasScheduledWorkday,
        ruleDailyMinutes: target.ruleDailyMinutes,
        segments: nextSegments,
        breaks: nextBreaks,
        baselineSnapshot,
      })
    );
  };

  const updateCurrentTimeSpan = (nextIn: number, nextOut: number) => {
    const clampedIn = Math.max(0, Math.min(1425, Math.round(nextIn)));
    const clampedOut = Math.max(
      clampedIn + 15,
      Math.min(1440, Math.round(nextOut))
    );

    if (target.targetKind === "BREAK") {
      const targetId = activeBreak?.id || target.itemId;
      const exists = effectiveDay.breaks.some((b) => b.id === targetId);
      const nextBreaks = exists
        ? effectiveDay.breaks.map((b) =>
            b.id === targetId
              ? { ...b, start_minutes: clampedIn, end_minutes: clampedOut }
              : b
          )
        : [
            ...effectiveDay.breaks,
            { id: targetId, start_minutes: clampedIn, end_minutes: clampedOut },
          ];
      commitNextSchedule(effectiveDay.segments, nextBreaks);
    } else {
      const targetId = activeSegment?.id || target.itemId;
      const exists = effectiveDay.segments.some((s) => s.id === targetId);
      const nextSegments = exists
        ? effectiveDay.segments.map((s) =>
            s.id === targetId
              ? { ...s, in_minutes: clampedIn, out_minutes: clampedOut }
              : s
          )
        : [
            ...effectiveDay.segments,
            {
              id: targetId,
              work_mode: curWorkMode,
              policy_name: curPolicyName,
              in_minutes: clampedIn,
              out_minutes: clampedOut,
            },
          ];
      commitNextSchedule(nextSegments, effectiveDay.breaks);
    }
  };

  const handleSelectPolicy = (
    name: string,
    mode: HqWorkMode,
    defaultLoc: string
  ) => {
    setPolicyDropdownOpen(false);
    if (target.targetKind === "BREAK") {
      // 휴게 블록을 근무 정책 블록으로 전환
      const brkId = activeBreak?.id || target.itemId;
      const nextBreaks = effectiveDay.breaks.filter((b) => b.id !== brkId);
      idSeqRef.current += 1;
      const newSegId = `seg-conv-${target.itemId}-${idSeqRef.current}`;
      const nextSegments: HqRecognizedWorkSegment[] = [
        ...effectiveDay.segments,
        {
          id: newSegId,
          work_mode: mode,
          policy_name: name,
          in_minutes: curInMin,
          out_minutes: curOutMin,
          location_note: defaultLoc,
        },
      ];
      commitNextSchedule(nextSegments, nextBreaks);
      onSwitchTarget?.({
        ...target,
        targetKind: "SEGMENT",
        itemId: newSegId,
      });
      return;
    }

    const segId = activeSegment?.id || target.itemId;
    const nextSegments = effectiveDay.segments.map((s) =>
      s.id === segId
        ? {
            ...s,
            policy_name: name,
            work_mode: mode,
            location_note: defaultLoc,
          }
        : s
    );
    commitNextSchedule(nextSegments, effectiveDay.breaks);
  };

  const handleConvertSegmentToBreak = () => {
    setPolicyDropdownOpen(false);
    if (target.targetKind === "BREAK") return;
    const segId = activeSegment?.id || target.itemId;
    const nextSegments = effectiveDay.segments.filter((s) => s.id !== segId);
    idSeqRef.current += 1;
    const newBrkId = `brk-conv-${target.itemId}-${idSeqRef.current}`;
    const nextBreaks: HqRecognizedBreakBlock[] = [
      ...effectiveDay.breaks,
      {
        id: newBrkId,
        start_minutes: curInMin,
        end_minutes: curOutMin,
      },
    ];
    commitNextSchedule(nextSegments, nextBreaks);
    onSwitchTarget?.({
      ...target,
      targetKind: "BREAK",
      itemId: newBrkId,
    });
  };

  const handleDeleteCurrentItem = () => {
    setMoreMenuOpen(false);
    if (target.targetKind === "BREAK") {
      const brkId = activeBreak?.id || target.itemId;
      const nextBreaks = effectiveDay.breaks.filter((b) => b.id !== brkId);
      commitNextSchedule(effectiveDay.segments, nextBreaks);
      onConfirmClose();
      return;
    }
    const segId = activeSegment?.id || target.itemId;
    const remainingSegs = effectiveDay.segments.filter((s) => s.id !== segId);
    // 마지막 근무 블록까지 모두 지우는 경우 해당 블록에 속해 있던 휴게도 함께 정리
    const remainingBreaks =
      remainingSegs.length === 0 ? [] : effectiveDay.breaks;
    commitNextSchedule(remainingSegs, remainingBreaks);
    onConfirmClose();
  };

  const positionStyle = useMemo<React.CSSProperties>(() => {
    const winW = typeof window !== "undefined" ? window.innerWidth : 1280;
    const winH = typeof window !== "undefined" ? window.innerHeight : 800;
    const cardW = 286;
    const estH = 215;

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

  const policyChoices = useMemo(
    () => normalizePolicyChoices(workFormPolicies),
    [workFormPolicies]
  );

  const commitTypedTime = (field: "START" | "END") => {
    if (!isTypingTime) return;
    const parsed = parseUserTypedTime(typedTimeText);
    setIsTypingTime(false);
    if (parsed === null) return;
    if (field === "START") {
      const nextOut =
        parsed >= curOutMin ? Math.min(1440, parsed + 60) : curOutMin;
      updateCurrentTimeSpan(parsed, nextOut);
    } else {
      const safeOut = parsed <= curInMin ? Math.min(1440, curInMin + 15) : parsed;
      updateCurrentTimeSpan(curInMin, safeOut);
    }
  };

  const activeVis = getWorkPolicyVisual(curPolicyName, curWorkMode);

  return (
    <div
      ref={cardRef}
      style={positionStyle}
      onClick={(e) => e.stopPropagation()}
      className="z-[160] rounded-2xl bg-white shadow-[0_14px_42px_rgba(15,23,42,0.16)] border border-slate-200/85 select-none"
    >
      <div className="px-4 pt-4 pb-3.5 space-y-3">
        {/* 상단: 근무 정책 / 휴게 선택 드롭다운 */}
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
            <span
              className={`w-5 h-5 rounded-md flex items-center justify-center shadow-2xs ${activeVis.badgeBgClass} ${activeVis.badgeTextClass}`}
            >
              <PolicySvgIcon kind={activeVis.kind} className="w-3.5 h-3.5" />
            </span>
            <span className="text-[13px] font-extrabold text-slate-800">
              {curPolicyName}
            </span>
            <span className="text-[10px] text-slate-400">▾</span>
          </button>

          {policyDropdownOpen && (
            <div className="absolute left-0 top-full mt-1 w-48 rounded-xl bg-white shadow-xl border border-slate-200/90 py-1.5 z-[175] text-xs">
              {policyChoices.map((ch) => {
                const vis = getWorkPolicyVisual(ch.name, ch.mode);
                const selected =
                  target.targetKind === "SEGMENT" && curPolicyName === ch.name;
                return (
                  <button
                    key={ch.name}
                    type="button"
                    onClick={() => handleSelectPolicy(ch.name, ch.mode, ch.loc)}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-700"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`w-4.5 h-4.5 rounded flex items-center justify-center ${vis.badgeBgClass} ${vis.badgeTextClass}`}
                      >
                        <PolicySvgIcon kind={vis.kind} className="w-3 h-3" />
                      </span>
                      <span>{ch.name}</span>
                      {ch.isDefaultStar && (
                        <span className="w-3.5 h-3.5 rounded-full bg-[#facc15] text-white text-[8.5px] font-black inline-flex items-center justify-center">
                          ★
                        </span>
                      )}
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
                onClick={handleConvertSegmentToBreak}
                className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-700"
              >
                <span className="flex items-center gap-2">
                  <span className="w-4.5 h-4.5 rounded bg-slate-100 text-slate-400 flex items-center justify-center">
                    <PolicySvgIcon kind="BREAK" className="w-3 h-3" />
                  </span>
                  <span>휴게</span>
                </span>
                {target.targetKind === "BREAK" && (
                  <span className="text-[#0d9488] font-extrabold">✓</span>
                )}
              </button>

              {!target.isHolidayOrOff && (
                <button
                  type="button"
                  onClick={() => {
                    setPolicyDropdownOpen(false);
                    onConfirmClose();
                    onSwitchToLeaveModal(target.workDate);
                  }}
                  className="w-full px-3.5 py-2 text-left hover:bg-purple-50/60 flex items-center gap-2 font-semibold text-purple-700"
                >
                  <span className="w-4.5 h-4.5 rounded bg-purple-100 text-[#9333ea] flex items-center justify-center">
                    <PolicySvgIcon kind="LEAVE" className="w-3 h-3" />
                  </span>
                  <span>연차</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* 중단: 시작 시각 -> 종료 시각 + 총 시간 / 실근무 시간 */}
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
                          : formatMinutesToKoreanAmPm(curInMin)
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
                      className="w-[76px] bg-[#0066ff] text-white selection:bg-[#0066ff] selection:text-white px-1.5 py-0.5 rounded-[3px] text-xs font-bold outline-none tabular-nums"
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
                    {formatMinutesToKoreanAmPm(curInMin)}
                  </button>
                )}

                {activeTimeField === "START" && (
                  <div
                    ref={timeListRef}
                    className="absolute left-0 top-full mt-1.5 w-[166px] max-h-[244px] overflow-y-auto rounded-xl bg-white shadow-[0_12px_34px_rgba(15,23,42,0.16)] border border-slate-200/85 py-1.5 z-[180]"
                  >
                    {TIME_SLOTS_15M.map((slot) => {
                      const isCur = slot.minutes === curInMin;
                      return (
                        <button
                          key={slot.minutes}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const curDur = Math.max(15, curOutMin - curInMin);
                            const nextOut =
                              slot.minutes >= curOutMin
                                ? Math.min(1440, slot.minutes + curDur)
                                : curOutMin;
                            setIsTypingTime(false);
                            updateCurrentTimeSpan(slot.minutes, nextOut);
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

              {/* 종료 시각 (클릭 시 경과 근무 시간 배지 함께 표시 — Screenshots 8 & 9 동일!) */}
              <div className="relative">
                {activeTimeField === "END" ? (
                  <div className="px-2 py-1 rounded-md bg-slate-100 inline-flex items-center">
                    <input
                      autoFocus
                      value={
                        isTypingTime
                          ? typedTimeText
                          : curOutMin === 1440
                            ? "오전 12:00"
                            : formatMinutesToKoreanAmPm(curOutMin)
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
                      className="w-[76px] bg-[#0066ff] text-white selection:bg-[#0066ff] selection:text-white px-1.5 py-0.5 rounded-[3px] text-xs font-bold outline-none tabular-nums"
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
                    {curOutMin === 1440
                      ? "오전 12:00"
                      : formatMinutesToKoreanAmPm(curOutMin)}
                  </button>
                )}

                {activeTimeField === "END" && (
                  <div
                    ref={timeListRef}
                    className="absolute left-0 top-full mt-1.5 w-[212px] max-h-[252px] overflow-y-auto rounded-xl bg-white shadow-[0_14px_38px_rgba(15,23,42,0.18)] border border-slate-200/90 py-1.5 z-[180]"
                  >
                    {endTimeOptions.map((opt) => {
                      const isCur = opt.minutes === curOutMin;
                      return (
                        <button
                          key={opt.minutes}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setIsTypingTime(false);
                            updateCurrentTimeSpan(curInMin, opt.minutes);
                            setActiveTimeField(null);
                          }}
                          className={`w-full px-3.5 py-2 text-left text-xs tabular-nums transition-colors flex items-center justify-between gap-1.5 ${
                            isCur
                              ? "bg-slate-100 font-extrabold text-slate-900"
                              : "font-semibold text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <span className="whitespace-nowrap">{opt.label}</span>
                          <span className="inline-flex items-center gap-1 shrink-0">
                            <span className="px-1.5 py-0.5 rounded-[4px] bg-slate-100 border border-slate-200/70 text-[10.5px] font-bold text-slate-600">
                              {opt.elapsedLabel}
                            </span>
                            {opt.netWorkLabel && (
                              <span className="text-[10px] font-bold text-[#0d9488]">
                                ({opt.netWorkLabel})
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-1 text-[11px] font-semibold text-slate-400 flex flex-wrap items-center gap-1.5">
              <span>{formatGrossSpanKorean(curInMin, curOutMin)}</span>
              {target.targetKind === "SEGMENT" &&
                overlappingBreakMinForActiveSeg > 0 && (
                  <span className="text-[#0d9488] font-bold">
                    · 실근무{" "}
                    {formatDurationKoreanCompact(
                      Math.max(
                        0,
                        curOutMin - curInMin - overlappingBreakMinForActiveSeg
                      )
                    )}{" "}
                    <span className="text-slate-400 font-medium">
                      (휴게 {formatDurationKoreanCompact(overlappingBreakMinForActiveSeg)})
                    </span>
                  </span>
                )}
            </div>
          </div>
        </div>

        {target.targetKind === "SEGMENT" &&
          (showMemoInput || Boolean(curMemo)) && (
            <div className="pt-0.5">
              <input
                value={curMemo}
                onChange={(e) => {
                  const val = e.target.value;
                  const segId = activeSegment?.id || target.itemId;
                  const nextSegs = effectiveDay.segments.map((s) =>
                    s.id === segId ? { ...s, memo: val } : s
                  );
                  commitNextSchedule(nextSegs, effectiveDay.breaks);
                }}
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
            <div className="absolute right-0 bottom-full mb-1.5 w-40 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 z-[185] text-xs">
              {target.targetKind === "SEGMENT" && (
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
              )}
              <button
                type="button"
                onClick={handleDeleteCurrentItem}
                className="w-full px-3.5 py-2 text-left hover:bg-rose-50 font-semibold text-rose-600 flex items-center gap-2"
              >
                <span>🗑️</span>
                <span>
                  {target.targetKind === "BREAK" ? "휴게 삭제" : "일정 삭제"}
                </span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (activeTimeField) commitTypedTime(activeTimeField);
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
 * 3. 우측 [승인 · 참조] 패널
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
 * 4. 실시간 근무 기록(얇은 줄) 호버 다크 툴팁
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
        left: `${Math.max(
          16,
          Math.min(
            (typeof window !== "undefined" ? window.innerWidth : 1200) - 240,
            anchorPos.x - 105
          )
        )}px`,
        top: `${Math.max(
          12,
          anchorPos.y - (visibleBreaks.length > 0 ? 112 : 82)
        )}px`,
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
 * 5. 플렉스 [실시간 기록 수정] 모달 (Screenshots 4 & 5 재현 — 얇은 줄만 독립 수정!)
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
  const [startMin, setStartMin] = useState<number | null>(
    existingLog ? existingLog.start_min : null
  );
  const [endMin, setEndMin] = useState<number | null>(
    existingLog ? existingLog.end_min : null
  );
  const [policyName, setPolicyName] = useState(
    existingLog?.policy_name || "근무"
  );
  const [workMode, setWorkMode] = useState<HqWorkMode>(
    existingLog?.work_mode || "OFFICE"
  );
  const [policyMenuOpen, setPolicyMenuOpen] = useState(false);
  const [transitions, setTransitions] = useState<HqRealtimeModeSegment[]>(
    existingLog?.transitions || []
  );
  const [breaks, setBreaks] = useState<HqRealtimeBreakSpan[]>(
    existingLog?.breaks || []
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStartMin(existingLog ? existingLog.start_min : null);
    setEndMin(existingLog ? existingLog.end_min : null);
    setPolicyName(existingLog?.policy_name || "근무");
    setWorkMode(existingLog?.work_mode || "OFFICE");
    setTransitions(existingLog?.transitions || []);
    setBreaks(existingLog?.breaks || []);
    setPolicyMenuOpen(false);
    setMoreOpen(false);
  }, [defaultEndMin, defaultStartMin, existingLog, isOpen]);

  if (!isOpen) return null;

  const [wy, wm, wd] = workDate.split("-").map(Number);
  const dowKo = ["일", "월", "화", "수", "목", "금", "토"][
    new Date(wy || 2026, (wm || 1) - 1, wd || 1).getDay()
  ];
  const dateHeader = `${wy}년 ${wm}월 ${wd}일 (${dowKo})`;

  const rtPolicyChoices: {
    name: string;
    mode: HqWorkMode;
    isDefaultStar?: boolean;
  }[] = [
    { name: "근무", mode: "OFFICE", isDefaultStar: true },
    { name: "외근", mode: "OUTSIDE" },
    { name: "원격근무", mode: "REMOTE" },
    { name: "출장", mode: "OUTSIDE" },
  ];

  const handleSave = async () => {
    if (startMin === null) {
      alert("기록 시작 시각을 선택해 주세요.");
      return;
    }
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
    if (
      !confirm("해당 날짜의 실시간 근무 기록(얇은 줄)을 삭제하시겠습니까?")
    ) {
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

  const curRtVis = getWorkPolicyVisual(policyName, workMode);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[190] bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[468px] rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-visible text-xs"
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
                  <div className="absolute right-8 top-full mt-1 w-36 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 z-30">
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

        {/* 본문 폼 (Screenshots 4 & 5 동일 레이아웃) */}
        <div className="px-6 py-3 space-y-5">
          {/* 1) 기록 시작 + 정책 드롭다운 + 전환 기록 추가 */}
          <div className="grid grid-cols-12 items-start gap-3">
            <label className="col-span-3 pt-2 font-bold text-slate-500">
              기록 시작 <span className="text-rose-500">*</span>
            </label>
            <div className="col-span-9 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={startMin ?? ""}
                  onChange={(e) =>
                    setStartMin(
                      e.target.value === "" ? null : Number(e.target.value)
                    )
                  }
                  className={`px-3 py-2 rounded-lg border border-slate-200 focus:border-[#16cc3b] bg-white font-bold outline-none tabular-nums ${
                    startMin === null ? "text-slate-400" : "text-slate-800"
                  }`}
                >
                  <option value="">시작 시각 입력</option>
                  {TIME_SLOTS_15M.map((s) => (
                    <option
                      key={s.minutes}
                      value={s.minutes}
                      className="text-slate-800"
                    >
                      {s.label}
                    </option>
                  ))}
                </select>

                {/* 플렉스 커스텀 근무 정책 선택기 (Screenshot 5 동일) */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setPolicyMenuOpen((v) => !v)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 hover:border-slate-300 bg-white font-bold text-slate-800 flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`w-4.5 h-4.5 rounded flex items-center justify-center ${curRtVis.badgeBgClass} ${curRtVis.badgeTextClass}`}
                      >
                        <PolicySvgIcon
                          kind={curRtVis.kind}
                          className="w-3 h-3"
                        />
                      </span>
                      <span>{policyName}</span>
                    </span>
                    <span className="text-[10px] text-slate-400">▾</span>
                  </button>

                  {policyMenuOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 rounded-xl bg-white shadow-2xl border border-slate-200 py-1.5 z-40">
                      {rtPolicyChoices.map((ch) => {
                        const vis = getWorkPolicyVisual(ch.name, ch.mode);
                        const selected = policyName === ch.name;
                        return (
                          <button
                            key={ch.name}
                            type="button"
                            onClick={() => {
                              setPolicyName(ch.name);
                              setWorkMode(ch.mode);
                              setPolicyMenuOpen(false);
                            }}
                            className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center justify-between font-bold text-slate-800"
                          >
                            <span className="flex items-center gap-2">
                              <span
                                className={`w-4.5 h-4.5 rounded flex items-center justify-center ${vis.badgeBgClass} ${vis.badgeTextClass}`}
                              >
                                <PolicySvgIcon
                                  kind={vis.kind}
                                  className="w-3 h-3"
                                />
                              </span>
                              <span>{ch.name}</span>
                              {ch.isDefaultStar && (
                                <span className="w-3.5 h-3.5 rounded-full bg-[#facc15] text-white text-[8.5px] font-black inline-flex items-center justify-center">
                                  ★
                                </span>
                              )}
                            </span>
                            {selected && (
                              <span className="text-[#16cc3b] font-black">
                                ✓
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
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
                        prev.map((x, i) =>
                          i === idx ? { ...x, at_min: v } : x
                        )
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
                    <option value="근무">근무</option>
                    <option value="외근">외근</option>
                    <option value="원격근무">원격근무</option>
                    <option value="출장">출장</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setTransitions((prev) =>
                        prev.filter((_, i) => i !== idx)
                      )
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
                      at_min: Math.min(
                        1380,
                        (startMin ?? defaultStartMin) + 240
                      ),
                      policy_name: "원격근무",
                      work_mode: "REMOTE",
                    },
                  ])
                }
                className="text-[11.5px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 pt-0.5"
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
                  className={`w-44 px-3 py-2 rounded-lg border border-slate-200 focus:border-[#16cc3b] bg-white font-bold outline-none tabular-nums ${
                    endMin === null ? "text-slate-400" : "text-slate-800"
                  }`}
                >
                  <option value="">종료 시각 입력</option>
                  {TIME_SLOTS_15M.map((s) => (
                    <option
                      key={s.minutes}
                      value={s.minutes}
                      className="text-slate-800"
                    >
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
            <label className="col-span-3 pt-1 font-bold text-slate-500">
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
                      start_min: 780,
                      end_min: 840,
                    },
                  ])
                }
                className="text-[11.5px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 pt-0.5"
              >
                <span>+</span>
                <span>휴게 기록 추가</span>
              </button>
            </div>
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="px-6 py-4 mt-2 border-t border-slate-100 flex items-center justify-end gap-2 bg-white rounded-b-2xl">
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
