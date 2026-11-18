// src/components/hq/attendance/HqFlexInlineWorkEditor.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ATTENDANCE_MODES } from "@/lib/hq/constants";
import { formatMinutesToKoreanAmPm } from "@/lib/hq/defaultWorkRules";
import type {
  HqApprovalPolicyItem,
  HqWorkConditionRule,
  HqWorkFormPolicy,
  HqWorkMode,
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
  outMinutes: number; // 15 ~ 1440 (또는 익일 연장 > 1440)
  breakMinutes: number;
  locationNote: string;
  memo: string;
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
  draft: Omit<DraftWorkEdit, "key" | "memberId" | "memberName" | "department" | "workDate" | "attendanceId">,
  target: InlineWorkPopoverTarget
): boolean {
  if (draft.actionMode === "DELETE") return false;
  if (!target.hadExistingRecord && !target.wasScheduledWorkday) {
    // 비근무일(주말/공휴일)에 새로 추가 중인 일정은 항상 변경사항으로 간주
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

  if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 24 || mm < 0 || mm > 59) {
    return null;
  }

  if (isPm && hh >= 1 && hh < 12) hh += 12;
  if (isAm && hh === 12) hh = 0;
  if (hh === 24) return 1440;
  return hh * 60 + mm;
}

export function FlexInlineWorkPopover({
  target,
  currentDraft,
  workFormPolicies,
  onChangeDraft,
  onClearDraft,
  onStageDelete,
  onConfirmClose,
  onSwitchToLeaveModal,
}: {
  target: InlineWorkPopoverTarget;
  currentDraft?: DraftWorkEdit;
  workFormPolicies: HqWorkFormPolicy[];
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

  // 바깥 클릭 시 플렉스처럼 자연스럽게 팝오버 닫기 (변경된 draft는 유지)
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

  // 시간 드롭다운 열릴 때 현재 선택된 시각이 중앙에 오도록 자동 스크롤
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

    // 근무 시간이 바뀌면 기본 휴게시간(4시간 이상 30분, 8시간 이상 60분) 자동 보정 (사용자가 직접 조정하지 않은 경우)
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
      ...merged,
    });
  };

  // 화면 가장자리 잘림 방지 위치 산출
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
    pushChoice("원격근무", "🏠", "REMOTE", ATTENDANCE_MODES.REMOTE.defaultLocation);
    pushChoice("외근", "🚗", "OUTSIDE", "외근지");
    pushChoice("출장", "🚄", "OUTSIDE", "출장지");

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
      className="z-[150] rounded-2xl bg-white shadow-[0_14px_42px_rgba(15,23,42,0.16)] border border-slate-200/85 select-none animate-in fade-in zoom-in-95 duration-100"
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
            <svg
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
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

        {/* 선택형 보조 행: 휴게시간 조정 / 메모 입력 */}
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
              placeholder="업무 메모 입력 (선택)"
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
                <span>메모 입력</span>
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
                      {target.hadExistingRecord ? "근무 기록 삭제" : "변경 취소"}
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
              // 주말/휴일에 [+] 눌러 기본 9~6 그대로 [확인]을 누른 경우 바로 드래프트에 추가
              onChangeDraft({
                key: target.key,
                memberId: target.memberId,
                memberName: target.memberName,
                department: target.department,
                workDate: target.workDate,
                attendanceId: target.attendanceId,
                actionMode: "UPSERT",
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
              ? "bg-blue-600 text-white"
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
                ? "bg-amber-500 text-white"
                : "bg-slate-100 text-slate-400"
            }`}
          >
            {warningItems.length}
          </span>
        </button>

        {warnOpen && warningItems.length > 0 && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 w-72 rounded-2xl bg-white shadow-2xl border border-slate-200 p-3.5 space-y-1.5 text-[11px] text-slate-700">
            <div className="font-extrabold text-amber-700">
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
        <span>{submitting ? "등록 중..." : "등록하기"}</span>
      </button>
    </div>
  );
}

export function FlexApprovalSidePanel({
  rangeStart,
  rangeEnd,
  drafts,
  approvalPolicies,
  workConditionRules,
  workFormPolicies,
  onClose,
}: {
  rangeStart: string;
  rangeEnd: string;
  drafts: DraftWorkEdit[];
  approvalPolicies?: HqApprovalPolicyItem[];
  workConditionRules?: HqWorkConditionRule[];
  workFormPolicies?: HqWorkFormPolicy[];
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

  const requiredApprovalItems = useMemo(() => {
    const out: { workDate: string; label: string; policyTitle: string }[] = [];
    const policies = approvalPolicies || [];
    const forms = workFormPolicies || [];
    void workConditionRules;

    drafts.forEach((d) => {
      if (d.actionMode === "DELETE") return;
      const matchedForm = forms.find((f) => f.name === d.policyName);
      if (matchedForm) {
        const pol = policies.find((p) => p.id === matchedForm.policy_id);
        if (pol && ((pol.steps && pol.steps.length > 0) || (pol.cc_list && pol.cc_list.length > 0))) {
          out.push({
            workDate: d.workDate,
            label: `${d.policyName} (${formatMinutesToKoreanAmPm(
              d.inMinutes
            )} ~ ${formatMinutesToKoreanAmPm(d.outMinutes)})`,
            policyTitle: pol.title,
          });
        }
      }
    });
    return out;
  }, [approvalPolicies, drafts, workConditionRules, workFormPolicies]);

  return (
    <aside
      data-flex-draft-bar="true"
      className="w-[292px] shrink-0 border-l border-slate-200 bg-white flex flex-col select-none"
    >
      <div className="px-6 pt-5 pb-4 flex items-start justify-between">
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

      <div className="flex-1 px-6 py-8 flex flex-col items-center justify-center text-center">
        {requiredApprovalItems.length === 0 ? (
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
        ) : (
          <div className="w-full space-y-2.5 text-left">
            {requiredApprovalItems.map((item, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1"
              >
                <div className="text-[11px] font-bold text-blue-600">
                  {item.workDate}
                </div>
                <div className="text-xs font-extrabold text-slate-800">
                  {item.label}
                </div>
                <div className="text-[11px] text-slate-500">
                  적용 정책: {item.policyTitle}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
