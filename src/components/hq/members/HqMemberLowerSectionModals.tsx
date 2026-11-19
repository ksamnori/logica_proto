// src/components/hq/members/HqMemberLowerSectionModals.tsx
"use client";

import React, { useMemo, useState } from "react";
import { DEFAULT_ANNUAL_LEAVE_POLICY } from "@/lib/hq/defaultLeaveSettings";
import {
  ALL_WEEKDAYS,
  calcWeeklyWorkHours,
  DEFAULT_OVERTIME_COMP_SETTINGS,
  DEFAULT_WORK_RULES,
  formatHmToKoreanAmPm,
  patternShortBadge,
} from "@/lib/hq/defaultWorkRules";
import type {
  HqAnnualLeavePolicyItem,
  HqCareerItem,
  HqEducationItem,
  HqFamilyItem,
  HqOvertimeCompPolicyItem,
  HqSpecialNotesDetail,
  HqWorkRuleItem,
} from "@/lib/hq/types";
import { formatDotDateShort, makeContractId } from "./HqContractModals";

// ============================================================================
// 1. 공통 날짜 / 연월 선택 팝오버 & 에러 표시 헬퍼
// ============================================================================

function getTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function parseDateStr(raw: string): string | null {
  const cleaned = raw.trim().replace(/[./\s]+/g, "-").replace(/-+/g, "-");
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(cleaned);
  if (!m) return null;
  const yr = Number(m[1]);
  const mo = Number(m[2]);
  const dy = Number(m[3]);
  if (yr < 1950 || yr > 2100 || mo < 1 || mo > 12 || dy < 1 || dy > 31) {
    return null;
  }
  const dt = new Date(yr, mo - 1, dy);
  if (
    dt.getFullYear() !== yr ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== dy
  ) {
    return null;
  }
  return `${yr}-${String(mo).padStart(2, "0")}-${String(dy).padStart(2, "0")}`;
}

function buildMonthGrid(year: number, month0: number) {
  const firstDow = new Date(year, month0, 1).getDay();
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const prevMonthDays = new Date(year, month0, 0).getDate();

  const cells: { ymd: string; day: number; inMonth: boolean }[] = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const dt = new Date(year, month0 - 1, d);
    cells.push({
      ymd: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
        dt.getDate()
      ).padStart(2, "0")}`,
      day: d,
      inMonth: false,
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      ymd: `${year}-${String(month0 + 1).padStart(2, "0")}-${String(d).padStart(
        2,
        "0"
      )}`,
      day: d,
      inMonth: true,
    });
  }
  while (cells.length < 42) {
    const nextD = cells.length - (firstDow + daysInMonth) + 1;
    const dt = new Date(year, month0 + 1, nextD);
    cells.push({
      ymd: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
        dt.getDate()
      ).padStart(2, "0")}`,
      day: nextD,
      inMonth: false,
    });
  }
  return cells;
}

function FieldErrorLine({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-[#e05246]">
      <span className="w-3.5 h-3.5 rounded-full bg-[#e05246] text-white text-[9px] inline-flex items-center justify-center font-black shrink-0">
        !
      </span>
      <span>{message}</span>
    </div>
  );
}

function SingleDayPopover({
  value,
  onSelect,
  onClose,
}: {
  value: string;
  onSelect: (ymd: string) => void;
  onClose: () => void;
}) {
  const todayYmd = useMemo(() => getTodayYmd(), []);
  const seed = value ? new Date(`${value}T00:00:00`) : new Date();
  const [viewYear, setViewYear] = useState(
    Number.isNaN(seed.getTime()) ? new Date().getFullYear() : seed.getFullYear()
  );
  const [viewMonth0, setViewMonth0] = useState(
    Number.isNaN(seed.getTime()) ? new Date().getMonth() : seed.getMonth()
  );
  const [inputText, setInputText] = useState(value || "");

  const cells = useMemo(
    () => buildMonthGrid(viewYear, viewMonth0),
    [viewYear, viewMonth0]
  );

  const shiftMonth = (delta: number) => {
    const dt = new Date(viewYear, viewMonth0 + delta, 1);
    setViewYear(dt.getFullYear());
    setViewMonth0(dt.getMonth());
  };

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute left-0 top-full mt-1.5 w-[252px] rounded-2xl bg-white border border-slate-200 shadow-2xl p-3 z-50 text-xs"
    >
      <input
        autoFocus
        value={inputText}
        onChange={(e) => {
          setInputText(e.target.value);
          const p = parseDateStr(e.target.value);
          if (p) {
            const dt = new Date(`${p}T00:00:00`);
            setViewYear(dt.getFullYear());
            setViewMonth0(dt.getMonth());
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const p = parseDateStr(inputText);
            if (p) {
              onSelect(p);
              onClose();
            }
          }
        }}
        placeholder="날짜 입력 (예: 2026-11-19)"
        className="w-full px-3 py-2 rounded-lg border-2 border-[#00c458] text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none"
      />

      <div className="flex items-center justify-between pt-2.5 pb-2 px-1">
        <span className="font-extrabold text-slate-800 text-[12px]">
          {viewYear}년 {viewMonth0 + 1}월
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-[11px] text-slate-400 font-semibold pb-1">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[12px]">
        {cells.map((c) => {
          const isSelected = value === c.ymd;
          const isToday = todayYmd === c.ymd;
          return (
            <button
              key={c.ymd}
              type="button"
              onClick={() => {
                onSelect(c.ymd);
                onClose();
              }}
              className={`h-7 w-7 mx-auto rounded-lg flex items-center justify-center transition-colors ${
                isSelected
                  ? "bg-[#00c458] text-white font-extrabold"
                  : isToday
                    ? "bg-emerald-100 text-[#00a84b] font-extrabold"
                    : c.inMonth
                      ? "text-slate-800 hover:bg-slate-100 font-medium"
                      : "text-slate-300 hover:bg-slate-50"
              }`}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RangeDatePopover({
  startDate,
  endDate,
  onChange,
  onClose,
}: {
  startDate: string;
  endDate: string;
  onChange: (nextStart: string, nextEnd: string) => void;
  onClose: () => void;
}) {
  const todayYmd = useMemo(() => getTodayYmd(), []);
  const seed = startDate ? new Date(`${startDate}T00:00:00`) : new Date();
  const [viewYear, setViewYear] = useState(
    Number.isNaN(seed.getTime()) ? new Date().getFullYear() : seed.getFullYear()
  );
  const [viewMonth0, setViewMonth0] = useState(
    Number.isNaN(seed.getTime()) ? new Date().getMonth() : seed.getMonth()
  );
  const [pickingField, setPickingField] = useState<"START" | "END">(
    startDate && !endDate ? "END" : "START"
  );
  const [startInput, setStartInput] = useState(startDate);
  const [endInput, setEndInput] = useState(endDate);

  const cells = useMemo(
    () => buildMonthGrid(viewYear, viewMonth0),
    [viewYear, viewMonth0]
  );

  const shiftMonth = (delta: number) => {
    const dt = new Date(viewYear, viewMonth0 + delta, 1);
    setViewYear(dt.getFullYear());
    setViewMonth0(dt.getMonth());
  };

  const handleDayClick = (ymd: string) => {
    if (pickingField === "START" || !startDate) {
      setStartInput(ymd);
      if (endDate && ymd > endDate) {
        setEndInput("");
        onChange(ymd, "");
      } else {
        onChange(ymd, endDate);
      }
      setPickingField("END");
    } else {
      if (ymd < startDate) {
        setStartInput(ymd);
        setEndInput(startDate);
        onChange(ymd, startDate);
      } else {
        setEndInput(ymd);
        onChange(startDate, ymd);
      }
      onClose();
    }
  };

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute left-0 top-full mt-1.5 w-[268px] rounded-2xl bg-white border border-slate-200 shadow-2xl p-3 z-50 text-xs"
    >
      <div className="grid grid-cols-2 gap-1.5">
        <input
          value={startInput}
          onFocus={() => setPickingField("START")}
          onChange={(e) => {
            setStartInput(e.target.value);
            const p = parseDateStr(e.target.value);
            if (p) onChange(p, endDate);
          }}
          placeholder="시작일 입력"
          className={`w-full px-2.5 py-1.5 rounded-lg border text-[11px] font-medium focus:outline-none ${
            pickingField === "START"
              ? "border-[#00c458] ring-1 ring-[#00c458] bg-white"
              : "border-slate-200 bg-slate-50/70"
          }`}
        />
        <input
          value={endInput}
          onFocus={() => setPickingField("END")}
          onChange={(e) => {
            setEndInput(e.target.value);
            const p = parseDateStr(e.target.value);
            if (p) onChange(startDate, p);
          }}
          placeholder="종료일 입력"
          className={`w-full px-2.5 py-1.5 rounded-lg border text-[11px] font-medium focus:outline-none ${
            pickingField === "END"
              ? "border-[#00c458] ring-1 ring-[#00c458] bg-white"
              : "border-slate-200 bg-slate-50/70"
          }`}
        />
      </div>

      <div className="flex items-center justify-between pt-2 px-0.5 text-[11px]">
        <span className="text-slate-400">선택 입력이에요.</span>
        <button
          type="button"
          onClick={() => {
            setStartInput("");
            setEndInput("");
            onChange("", "");
            onClose();
          }}
          className="text-slate-400 hover:text-slate-700 font-semibold"
        >
          초기화
        </button>
      </div>

      <div className="flex items-center justify-between pt-2 pb-2 px-1">
        <span className="font-extrabold text-slate-800 text-[12px]">
          {viewYear}년 {viewMonth0 + 1}월
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-[11px] text-slate-400 font-semibold pb-1">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[12px]">
        {cells.map((c) => {
          const isEdge = c.ymd === startDate || c.ymd === endDate;
          const inRange =
            Boolean(startDate && endDate) &&
            c.ymd > startDate &&
            c.ymd < endDate;
          const isToday = c.ymd === todayYmd;
          return (
            <button
              key={c.ymd}
              type="button"
              onClick={() => handleDayClick(c.ymd)}
              className={`h-7 w-7 mx-auto rounded-lg flex items-center justify-center transition-colors ${
                isEdge
                  ? "bg-[#00c458] text-white font-extrabold"
                  : inRange
                    ? "bg-emerald-50 text-[#00a84b] font-bold"
                    : isToday
                      ? "bg-emerald-100 text-[#00a84b] font-extrabold"
                      : c.inMonth
                        ? "text-slate-800 hover:bg-slate-100 font-medium"
                        : "text-slate-300 hover:bg-slate-50"
              }`}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatYmKorean(ym?: string): string {
  if (!ym) return "";
  const m = /^(\d{4})-(\d{2})/.exec(ym.trim());
  if (!m) return ym;
  return `${Number(m[1])}년 ${Number(m[2])}월`;
}

function YearMonthPopover({
  value,
  allowClear,
  onSelect,
  onClose,
}: {
  value: string;
  allowClear?: boolean;
  onSelect: (ym: string) => void;
  onClose: () => void;
}) {
  const initYr = /^(\d{4})-(\d{2})/.exec(value || "");
  const [viewYear, setViewYear] = useState(
    initYr ? Number(initYr[1]) : new Date().getFullYear()
  );

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute left-0 top-full mt-1.5 w-[224px] rounded-2xl bg-white border border-slate-200 shadow-2xl p-3 z-50 text-xs"
    >
      <div className="flex items-center justify-between pb-2.5 px-1">
        <button
          type="button"
          onClick={() => setViewYear((y) => y - 1)}
          className="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center font-bold"
        >
          ‹
        </button>
        <span className="font-extrabold text-slate-900 text-[13px]">
          {viewYear}년
        </span>
        <button
          type="button"
          onClick={() => setViewYear((y) => y + 1)}
          className="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center font-bold"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => {
          const ym = `${viewYear}-${String(m).padStart(2, "0")}`;
          const selected = value === ym;
          return (
            <button
              key={m}
              type="button"
              onClick={() => {
                onSelect(ym);
                onClose();
              }}
              className={`py-2 rounded-lg text-[12px] font-bold transition-colors ${
                selected
                  ? "bg-[#00c458] text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {m}월
            </button>
          );
        })}
      </div>

      {allowClear && value && (
        <div className="pt-2 mt-2 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={() => {
              onSelect("");
              onClose();
            }}
            className="text-[11px] font-semibold text-slate-400 hover:text-slate-700"
          >
            초기화
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 2. 근무 정보 변경하기 모달 (Screenshot 1)
// ============================================================================

export function HqWorkInfoChangeModal({
  currentScheduleName,
  currentEffectiveDate,
  workRules,
  saving,
  onOpenSettings,
  onClose,
  onSave,
}: {
  currentScheduleName: string;
  currentEffectiveDate?: string;
  workRules?: HqWorkRuleItem[];
  saving: boolean;
  onOpenSettings?: () => void;
  onClose: () => void;
  onSave: (payload: {
    work_schedule_type: string;
    work_schedule_mode: string;
    weekly_work_hours: number;
    work_effective_date: string;
  }) => void;
}) {
  const todayYmd = useMemo(() => getTodayYmd(), []);
  const activeRules = useMemo(() => {
    const src =
      workRules && workRules.length > 0 ? workRules : DEFAULT_WORK_RULES;
    return src.filter((r) => !r.is_hidden);
  }, [workRules]);

  const [selectedName, setSelectedName] = useState<string>(
    currentScheduleName || "기본 9시"
  );
  const [effectiveDate, setEffectiveDate] = useState<string>(
    currentEffectiveDate || todayYmd
  );
  const [datePopOpen, setDatePopOpen] = useState(false);

  const handleSubmit = () => {
    const matched =
      activeRules.find((r) => r.name === selectedName) || activeRules[0];
    onSave({
      work_schedule_type: matched ? matched.name : selectedName,
      work_schedule_mode: matched
        ? patternShortBadge(matched.pattern_type)
        : "고정",
      weekly_work_hours: matched ? calcWeeklyWorkHours(matched) : 40,
      work_effective_date: effectiveDate,
    });
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          if (datePopOpen) setDatePopOpen(false);
        }}
        className="bg-white w-full max-w-[490px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-5 text-xs max-h-[90vh] flex flex-col relative"
      >
        {/* 우상단 설정 & 닫기 아이콘 */}
        <div className="absolute top-5 right-5 flex items-center gap-2">
          {onOpenSettings && (
            <div className="relative group">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="w-7 h-7 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
              <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2.5 py-1 rounded-lg bg-slate-800 text-white text-[11px] font-bold whitespace-nowrap">
                근무 유형 설정하기
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-sm font-bold"
            title="닫기"
          >
            ✕
          </button>
        </div>

        {/* 타이틀 & 적용일 칩 */}
        <div className="space-y-2.5 pr-16 shrink-0">
          <h4 className="text-[20px] font-extrabold text-slate-900 tracking-tight">
            근무 정보 변경하기
          </h4>
          <div
            className="relative inline-block"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setDatePopOpen((p) => !p)}
              className="px-2.5 py-1 rounded-lg bg-[#fff5eb] hover:bg-[#ffecd6] text-[#d97706] border border-[#fde3c8] text-[11px] font-bold transition-colors"
            >
              적용일{" "}
              {effectiveDate === todayYmd
                ? "오늘"
                : formatDotDateShort(effectiveDate)}
            </button>
            {datePopOpen && (
              <SingleDayPopover
                value={effectiveDate}
                onSelect={setEffectiveDate}
                onClose={() => setDatePopOpen(false)}
              />
            )}
          </div>
        </div>

        {/* 근무 유형 라디오 카드 리스트 */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 custom-scroll">
          {activeRules.map((rule) => {
            const selected = rule.name === selectedName;
            const weeklyHrs = calcWeeklyWorkHours(rule);
            const restDays = ALL_WEEKDAYS.filter(
              (d) => !rule.work_days.includes(d)
            ).join(", ");
            const shortBadge = patternShortBadge(rule.pattern_type);
            const badgeText = shortBadge.includes("근무")
              ? shortBadge
              : `${shortBadge} 근무유형`;

            return (
              <button
                key={rule.id}
                type="button"
                onClick={() => setSelectedName(rule.name)}
                className={`w-full p-4 rounded-xl border text-left flex items-center gap-3.5 transition-all ${
                  selected
                    ? "border-slate-300 bg-white shadow-2xs"
                    : "border-slate-200/80 hover:border-slate-300 bg-white"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                    selected
                      ? "bg-[#00c458]"
                      : "border border-slate-300 bg-white"
                  }`}
                >
                  {selected && (
                    <span className="w-2 h-2 rounded-full bg-white" />
                  )}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-bold text-slate-900 truncate">
                      {rule.name}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#fff7ed] text-[#9a5b13] border border-[#fde6cc] text-[10px] font-bold shrink-0">
                      {badgeText}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 truncate">
                    출근 시간: {formatHmToKoreanAmPm(rule.start_time)} · 주{" "}
                    {weeklyHrs}시간 근무
                    {weeklyHrs < 40 ? " 단시간" : ""} · 쉬는 날:{" "}
                    {restDays || "없음"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* 변경하기 버튼 */}
        <button
          type="button"
          disabled={saving}
          onClick={handleSubmit}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00d42a] via-[#00c774] to-[#00b8b9] hover:brightness-95 text-white text-[13px] font-extrabold shadow-sm disabled:opacity-50 shrink-0 transition-all"
        >
          {saving ? "변경 중..." : "변경하기"}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// 3. 초과 근무 보상 정보 변경하기 모달 (Screenshot 9 연동)
// ============================================================================

export function HqOvertimeCompChangeModal({
  currentPolicyName,
  currentEffectiveDate,
  policies,
  saving,
  onOpenSettings,
  onClose,
  onSave,
}: {
  currentPolicyName?: string;
  currentEffectiveDate?: string;
  policies?: HqOvertimeCompPolicyItem[];
  saving: boolean;
  onOpenSettings?: () => void;
  onClose: () => void;
  onSave: (payload: {
    overtime_comp_policy_name: string;
    overtime_comp_cycle_label: string;
    overtime_comp_effective_date: string;
  }) => void;
}) {
  const todayYmd = useMemo(() => getTodayYmd(), []);
  const activePolicies = useMemo(
    () =>
      policies && policies.length > 0
        ? policies
        : DEFAULT_OVERTIME_COMP_SETTINGS.policies,
    [policies]
  );

  const [selectedName, setSelectedName] = useState<string>(
    currentPolicyName || activePolicies[0]?.name || "기본 초과 근무 보상 정책"
  );
  const [effectiveDate, setEffectiveDate] = useState<string>(
    currentEffectiveDate || todayYmd
  );
  const [datePopOpen, setDatePopOpen] = useState(false);

  const handleSubmit = () => {
    const matched =
      activePolicies.find((p) => p.name === selectedName) || activePolicies[0];
    onSave({
      overtime_comp_policy_name: matched
        ? matched.name
        : "기본 초과 근무 보상 정책",
      overtime_comp_cycle_label: matched
        ? matched.deduction_cycle_period.replace(/~/g, "-")
        : "매달 1일 - 매달 31일 (말일)",
      overtime_comp_effective_date: effectiveDate,
    });
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          if (datePopOpen) setDatePopOpen(false);
        }}
        className="bg-white w-full max-w-[480px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-5 text-xs relative"
      >
        <div className="absolute top-5 right-5 flex items-center gap-2">
          {onOpenSettings && (
            <div className="relative group">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="w-7 h-7 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
              <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2.5 py-1 rounded-lg bg-slate-800 text-white text-[11px] font-bold whitespace-nowrap">
                초과 근무 보상 설정하기
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-sm font-bold"
            title="닫기"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2.5 pr-16">
          <h4 className="text-[20px] font-extrabold text-slate-900 tracking-tight">
            초과 근무 보상 정보 변경하기
          </h4>
          <div
            className="relative inline-block"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setDatePopOpen((p) => !p)}
              className="px-2.5 py-1 rounded-lg bg-[#fff5eb] hover:bg-[#ffecd6] text-[#d97706] border border-[#fde3c8] text-[11px] font-bold transition-colors"
            >
              적용일{" "}
              {effectiveDate === todayYmd
                ? "오늘"
                : formatDotDateShort(effectiveDate)}
            </button>
            {datePopOpen && (
              <SingleDayPopover
                value={effectiveDate}
                onSelect={setEffectiveDate}
                onClose={() => setDatePopOpen(false)}
              />
            )}
          </div>
        </div>

        <div className="space-y-2.5 max-h-64 overflow-y-auto custom-scroll">
          {activePolicies.map((pol) => {
            const selected = pol.name === selectedName;
            return (
              <button
                key={pol.id}
                type="button"
                onClick={() => setSelectedName(pol.name)}
                className={`w-full p-4 rounded-xl border text-left flex items-center gap-3.5 transition-all ${
                  selected
                    ? "border-slate-300 bg-white shadow-2xs"
                    : "border-slate-200/80 hover:border-slate-300 bg-white"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                    selected
                      ? "bg-[#00c458]"
                      : "border border-slate-300 bg-white"
                  }`}
                >
                  {selected && (
                    <span className="w-2 h-2 rounded-full bg-white" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold text-slate-900 truncate">
                    {pol.name}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    포괄 계약 공제 주기:{" "}
                    {pol.deduction_cycle_period.replace(/~/g, "-")}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={handleSubmit}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00d42a] via-[#00c774] to-[#00b8b9] hover:brightness-95 text-white text-[13px] font-extrabold shadow-sm disabled:opacity-50 transition-all"
        >
          {saving ? "변경 중..." : "변경하기"}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// 4. 연차 정책 변경하기 모달 (Screenshot 8)
// ============================================================================

export function HqLeavePolicyChangeModal({
  currentPolicyName,
  policies,
  saving,
  onOpenSettings,
  onClose,
  onSave,
}: {
  currentPolicyName: string;
  policies?: HqAnnualLeavePolicyItem[];
  saving: boolean;
  onOpenSettings?: () => void;
  onClose: () => void;
  onSave: (payload: {
    leave_policy_name: string;
    leave_policy_tags: string[];
  }) => void;
}) {
  const activePolicies = useMemo(
    () =>
      policies && policies.length > 0 ? policies : [DEFAULT_ANNUAL_LEAVE_POLICY],
    [policies]
  );

  const [selectedName, setSelectedName] = useState<string>(
    currentPolicyName || activePolicies[0]?.name || "기본 연차 정책"
  );

  const deriveTags = (pol: HqAnnualLeavePolicyItem): string[] => {
    const tags: string[] = [];
    tags.push(
      pol.accrual_basis === "회계일" ? "회계일 기준 부여" : "입사일 기준 부여"
    );
    tags.push(`${pol.usage_unit_category || "시간"} 단위 사용`);
    if (pol.smart_promotion_enabled) tags.push("연차 촉진 사용");
    return tags;
  };

  const handleSubmit = () => {
    const matched =
      activePolicies.find((p) => p.name === selectedName) || activePolicies[0];
    onSave({
      leave_policy_name: matched ? matched.name : selectedName,
      leave_policy_tags: matched
        ? deriveTags(matched)
        : ["회계일 기준 부여", "시간 단위 사용", "연차 촉진 사용"],
    });
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-[480px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-5 text-xs relative"
      >
        {/* 우상단 ⚙ (연차 정책 설정하기 툴팁) + ✕ */}
        <div className="absolute top-5 right-5 flex items-center gap-2">
          {onOpenSettings && (
            <div className="relative group">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="w-7 h-7 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
              <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-[11px] font-bold whitespace-nowrap shadow-lg">
                연차 정책 설정하기
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-sm font-bold"
            title="닫기"
          >
            ✕
          </button>
        </div>

        <div className="space-y-1.5 pr-16">
          <h4 className="text-[20px] font-extrabold text-slate-900 tracking-tight">
            연차 정책 변경하기
          </h4>
          <p className="text-[12px] font-semibold text-[#e67e22]">
            연차 정책을 변경할 경우, 입사일 이후부터 다시 집계되니 신중하게 변경해주세요.
          </p>
        </div>

        <div className="space-y-2.5 max-h-64 overflow-y-auto custom-scroll py-1">
          {activePolicies.map((pol) => {
            const selected = pol.name === selectedName;
            const tags = deriveTags(pol);
            return (
              <button
                key={pol.id}
                type="button"
                onClick={() => setSelectedName(pol.name)}
                className={`w-full p-4 rounded-xl border text-left flex items-center gap-3.5 transition-all ${
                  selected
                    ? "border-slate-300 bg-white shadow-2xs"
                    : "border-slate-200/80 hover:border-slate-300 bg-white"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                    selected
                      ? "bg-[#00c458]"
                      : "border border-slate-300 bg-white"
                  }`}
                >
                  {selected && (
                    <span className="w-2 h-2 rounded-full bg-white" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold text-slate-900 truncate">
                    {pol.name}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {tags.join(" · ")}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={handleSubmit}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00d42a] via-[#00c774] to-[#00b8b9] hover:brightness-95 text-white text-[13px] font-extrabold shadow-sm disabled:opacity-50 transition-all"
        >
          {saving ? "변경 중..." : "변경하기"}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// 5. 경력 추가하기 / 수정하기 모달 (Screenshots 2 & 3)
// ============================================================================

export const CAREER_CONTRACT_TYPES = [
  "기타",
  "정규직",
  "계약직",
  "파견직",
  "인턴",
  "단시간 근로",
  "임원(사용자, 보수지급)",
  "프리랜서",
];

export function HqCareerModal({
  mode,
  initialItem,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  mode: "create" | "edit";
  initialItem?: HqCareerItem | null;
  saving: boolean;
  onClose: () => void;
  onSave: (saved: HqCareerItem) => void;
  onDelete?: () => void;
}) {
  const [companyName, setCompanyName] = useState(
    initialItem?.company_name || ""
  );
  const [contractType, setContractType] = useState(
    initialItem?.contract_type || ""
  );
  const [startYm, setStartYm] = useState(initialItem?.start_ym || "");
  const [endYm, setEndYm] = useState(initialItem?.end_ym || "");
  const [jobRole, setJobRole] = useState(initialItem?.job_role || "");
  const [department, setDepartment] = useState(initialItem?.department || "");
  const [jobTitle, setJobTitle] = useState(initialItem?.job_title || "");

  const [openPop, setOpenPop] = useState<
    null | "CONTRACT" | "START_YM" | "END_YM"
  >(null);
  const [errors, setErrors] = useState<{
    company?: string;
    contract?: string;
    startYm?: string;
    endYm?: string;
  }>({});

  const handleSubmit = () => {
    const nextErr: typeof errors = {};
    if (!companyName.trim()) nextErr.company = "회사명을 입력해 주세요.";
    if (!contractType.trim()) nextErr.contract = "계약유형을 선택해 주세요.";
    if (!startYm) nextErr.startYm = "입사 연월을 선택해 주세요.";
    if (!endYm) nextErr.endYm = "퇴사 연월을 선택해 주세요.";
    if (Object.keys(nextErr).length > 0) {
      setErrors(nextErr);
      return;
    }

    onSave({
      id: initialItem?.id || makeContractId("car"),
      company_name: companyName.trim(),
      contract_type: contractType,
      start_ym: startYm,
      end_ym: endYm,
      job_role: jobRole.trim(),
      department: department.trim(),
      job_title: jobTitle.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          if (openPop) setOpenPop(null);
        }}
        className="bg-white w-full max-w-[480px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-4 text-xs overflow-visible"
      >
        <div className="flex items-center justify-between pb-1">
          <h4 className="text-[19px] font-extrabold text-slate-900 tracking-tight">
            {mode === "edit" ? "경력 수정하기" : "경력 추가하기"}
          </h4>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-sm font-bold"
            title="닫기"
          >
            ✕
          </button>
        </div>

        {/* 1행: 회사명 * | 계약유형 * */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              className={`block text-[11px] font-bold mb-1.5 ${
                errors.company ? "text-[#e05246]" : "text-slate-600"
              }`}
            >
              회사명 <span className="text-rose-500">*</span>
            </label>
            <input
              value={companyName}
              onChange={(e) => {
                setCompanyName(e.target.value);
                if (e.target.value.trim()) {
                  setErrors((prev) => ({ ...prev, company: undefined }));
                }
              }}
              placeholder="회사명 입력"
              className={`w-full h-[42px] px-3.5 rounded-xl border text-[13px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none ${
                errors.company
                  ? "border-[#e05246] bg-[#fff8f7]"
                  : "border-slate-200 bg-slate-50/40 focus:bg-white focus:border-[#00c458]"
              }`}
            />
            <FieldErrorLine message={errors.company} />
          </div>

          <div
            className="relative"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <label
              className={`block text-[11px] font-bold mb-1.5 ${
                errors.contract ? "text-[#e05246]" : "text-slate-600"
              }`}
            >
              계약유형 <span className="text-rose-500">*</span>
            </label>
            <button
              type="button"
              onClick={() =>
                setOpenPop((p) => (p === "CONTRACT" ? null : "CONTRACT"))
              }
              className={`w-full h-[42px] px-3.5 rounded-xl border flex items-center justify-between text-[13px] transition-colors ${
                errors.contract
                  ? "border-[#e05246] bg-[#fff8f7]"
                  : "border-slate-200 hover:border-slate-300 bg-slate-50/40"
              }`}
            >
              <span
                className={
                  contractType
                    ? "font-semibold text-slate-900 truncate"
                    : "text-slate-400"
                }
              >
                {contractType || "계약유형 선택"}
              </span>
              <span className="text-slate-400 text-[11px] ml-1 shrink-0">▾</span>
            </button>
            <FieldErrorLine message={errors.contract} />

            {openPop === "CONTRACT" && (
              <div className="absolute left-0 top-full mt-1.5 w-full rounded-xl bg-white border border-slate-200 shadow-2xl py-1.5 z-40">
                {CAREER_CONTRACT_TYPES.map((ct) => (
                  <button
                    key={ct}
                    type="button"
                    onClick={() => {
                      setContractType(ct);
                      setErrors((prev) => ({ ...prev, contract: undefined }));
                      setOpenPop(null);
                    }}
                    className="w-full px-3.5 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-800"
                  >
                    <span>{ct}</span>
                    {contractType === ct && (
                      <span className="text-[#00c458] font-extrabold">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 2행: 입사 연월 * | 퇴사 연월 * */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            className="relative"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <label
              className={`block text-[11px] font-bold mb-1.5 ${
                errors.startYm ? "text-[#e05246]" : "text-slate-600"
              }`}
            >
              입사 연월 <span className="text-rose-500">*</span>
            </label>
            <button
              type="button"
              onClick={() =>
                setOpenPop((p) => (p === "START_YM" ? null : "START_YM"))
              }
              className={`w-full h-[42px] px-3.5 rounded-xl border flex items-center justify-between text-[13px] ${
                errors.startYm
                  ? "border-[#e05246] bg-[#fff8f7]"
                  : "border-slate-200 hover:border-slate-300 bg-slate-50/40"
              }`}
            >
              <span
                className={
                  startYm ? "font-semibold text-slate-900" : "text-slate-400"
                }
              >
                {startYm ? formatYmKorean(startYm) : "입사 연월 선택"}
              </span>
              <span className="text-slate-400 text-[11px]">▾</span>
            </button>
            <FieldErrorLine message={errors.startYm} />

            {openPop === "START_YM" && (
              <YearMonthPopover
                value={startYm}
                onSelect={(ym) => {
                  setStartYm(ym);
                  setErrors((prev) => ({ ...prev, startYm: undefined }));
                }}
                onClose={() => setOpenPop(null)}
              />
            )}
          </div>

          <div
            className="relative"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <label
              className={`block text-[11px] font-bold mb-1.5 ${
                errors.endYm ? "text-[#e05246]" : "text-slate-600"
              }`}
            >
              퇴사 연월 <span className="text-rose-500">*</span>
            </label>
            <button
              type="button"
              onClick={() =>
                setOpenPop((p) => (p === "END_YM" ? null : "END_YM"))
              }
              className={`w-full h-[42px] px-3.5 rounded-xl border flex items-center justify-between text-[13px] ${
                errors.endYm
                  ? "border-[#e05246] bg-[#fff8f7]"
                  : "border-slate-200 hover:border-slate-300 bg-slate-50/40"
              }`}
            >
              <span
                className={
                  endYm ? "font-semibold text-slate-900" : "text-slate-400"
                }
              >
                {endYm ? formatYmKorean(endYm) : "퇴사 연월 선택"}
              </span>
              <span className="text-slate-400 text-[11px]">▾</span>
            </button>
            <FieldErrorLine message={errors.endYm} />

            {openPop === "END_YM" && (
              <YearMonthPopover
                value={endYm}
                onSelect={(ym) => {
                  setEndYm(ym);
                  setErrors((prev) => ({ ...prev, endYm: undefined }));
                }}
                onClose={() => setOpenPop(null)}
              />
            )}
          </div>
        </div>

        {/* 3행: 직무 */}
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
            직무
          </label>
          <input
            value={jobRole}
            onChange={(e) => setJobRole(e.target.value)}
            placeholder="직무 입력"
            className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 bg-slate-50/40 focus:bg-white focus:border-[#00c458] text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
        </div>

        {/* 4행: 조직 | 직위 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              조직
            </label>
            <input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="조직 입력"
              className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 bg-slate-50/40 focus:bg-white focus:border-[#00c458] text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              직위
            </label>
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="직위 입력"
              className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 bg-slate-50/40 focus:bg-white focus:border-[#00c458] text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
        </div>

        {/* 하단 CTA */}
        <div className="flex items-center gap-2 pt-1">
          {mode === "edit" && onDelete && (
            <button
              type="button"
              disabled={saving}
              onClick={onDelete}
              className="px-4 py-3 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-[13px] shrink-0"
            >
              삭제
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#00d42a] via-[#00c774] to-[#00b8b9] hover:brightness-95 text-white text-[13px] font-extrabold shadow-sm disabled:opacity-50 transition-all"
          >
            {saving ? "저장 중..." : mode === "edit" ? "저장하기" : "추가하기"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 6. 학력 추가하기 / 수정하기 모달 (Screenshots 4 & 5)
// ============================================================================

export const EDU_DEGREE_TYPES = [
  "고등학교",
  "대학교 (전문대학)",
  "대학교 (일반대학)",
  "대학원 (석사)",
  "대학원 (박사)",
  "기타",
];

export const EDU_GRADUATION_STATUSES = [
  "졸업",
  "졸업예정",
  "재학중",
  "휴학중",
  "중퇴",
  "수료",
  "기타",
];

export function HqEducationModal({
  mode,
  initialItem,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  mode: "create" | "edit";
  initialItem?: HqEducationItem | null;
  saving: boolean;
  onClose: () => void;
  onSave: (saved: HqEducationItem) => void;
  onDelete?: () => void;
}) {
  const [degreeType, setDegreeType] = useState(initialItem?.degree_type || "");
  const [schoolName, setSchoolName] = useState(initialItem?.school_name || "");
  const [gradStatus, setGradStatus] = useState(
    initialItem?.graduation_status || ""
  );
  const [major, setMajor] = useState(initialItem?.major || "");
  const [startYm, setStartYm] = useState(initialItem?.start_ym || "");
  const [endYm, setEndYm] = useState(initialItem?.end_ym || "");

  const [openPop, setOpenPop] = useState<
    null | "DEGREE" | "GRAD" | "START_YM" | "END_YM"
  >(null);
  const [errors, setErrors] = useState<{
    school?: string;
    grad?: string;
  }>({});

  const handleSubmit = () => {
    const nextErr: typeof errors = {};
    if (!degreeType) {
      nextErr.school = "학교 구분을 선택해 주세요.";
    } else if (!schoolName.trim()) {
      nextErr.school = "학교명을 입력해 주세요.";
    }
    if (!gradStatus) {
      nextErr.grad = "졸업 구분을 선택해 주세요.";
    }
    if (Object.keys(nextErr).length > 0) {
      setErrors(nextErr);
      return;
    }

    onSave({
      id: initialItem?.id || makeContractId("edu"),
      degree_type: degreeType,
      school_name: schoolName.trim(),
      graduation_status: gradStatus,
      major: major.trim(),
      start_ym: startYm,
      end_ym: endYm,
    });
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          if (openPop) setOpenPop(null);
        }}
        className="bg-white w-full max-w-[480px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-4 text-xs overflow-visible"
      >
        <div className="flex items-center justify-between pb-1">
          <h4 className="text-[19px] font-extrabold text-slate-900 tracking-tight">
            {mode === "edit" ? "학력 수정하기" : "학력 추가하기"}
          </h4>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-sm font-bold"
            title="닫기"
          >
            ✕
          </button>
        </div>

        {/* 1행: 학교 * (학교 구분 선택 ▾ | 학교명 입력) */}
        <div
          className="relative"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label
            className={`block text-[11px] font-bold mb-1.5 ${
              errors.school ? "text-[#e05246]" : "text-slate-600"
            }`}
          >
            학교 <span className="text-rose-500">*</span>
          </label>
          <div className="h-[42px] rounded-xl border border-slate-200 bg-slate-50/40 focus-within:bg-white focus-within:border-[#00c458] flex items-center overflow-visible">
            <button
              type="button"
              onClick={() =>
                setOpenPop((p) => (p === "DEGREE" ? null : "DEGREE"))
              }
              className={`w-[168px] h-full px-3.5 border-r rounded-l-xl flex items-center justify-between text-[13px] shrink-0 ${
                errors.school && !degreeType
                  ? "border-[#e05246] ring-1 ring-[#e05246] bg-[#fff8f7]"
                  : "border-slate-200"
              }`}
            >
              <span
                className={
                  degreeType
                    ? "font-semibold text-slate-900 truncate"
                    : "text-slate-400"
                }
              >
                {degreeType || "학교 구분 선택"}
              </span>
              <span className="text-slate-400 text-[10px] ml-1">▾</span>
            </button>

            <input
              value={schoolName}
              onChange={(e) => {
                setSchoolName(e.target.value);
                if (e.target.value.trim() && degreeType) {
                  setErrors((prev) => ({ ...prev, school: undefined }));
                }
              }}
              placeholder="학교명 입력"
              className="flex-1 min-w-0 px-3.5 text-[13px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none bg-transparent"
            />
          </div>
          <FieldErrorLine message={errors.school} />

          {openPop === "DEGREE" && (
            <div className="absolute left-0 top-[68px] w-[200px] rounded-xl bg-white border border-slate-200 shadow-2xl py-1.5 z-40">
              {EDU_DEGREE_TYPES.map((dt) => (
                <button
                  key={dt}
                  type="button"
                  onClick={() => {
                    setDegreeType(dt);
                    setErrors((prev) => ({ ...prev, school: undefined }));
                    setOpenPop(null);
                  }}
                  className="w-full px-3.5 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-800"
                >
                  <span>{dt}</span>
                  {degreeType === dt && (
                    <span className="text-[#00c458] font-extrabold">✓</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 2행: 졸업 구분 * | 전공 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            className="relative"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <label
              className={`block text-[11px] font-bold mb-1.5 ${
                errors.grad ? "text-[#e05246]" : "text-slate-600"
              }`}
            >
              졸업 구분 <span className="text-rose-500">*</span>
            </label>
            <button
              type="button"
              onClick={() => setOpenPop((p) => (p === "GRAD" ? null : "GRAD"))}
              className={`w-full h-[42px] px-3.5 rounded-xl border flex items-center justify-between text-[13px] ${
                errors.grad
                  ? "border-[#e05246] bg-[#fff8f7]"
                  : "border-slate-200 hover:border-slate-300 bg-slate-50/40"
              }`}
            >
              <span
                className={
                  gradStatus ? "font-semibold text-slate-900" : "text-slate-400"
                }
              >
                {gradStatus || "졸업 구분 선택"}
              </span>
              <span className="text-slate-400 text-[11px]">▾</span>
            </button>
            <FieldErrorLine message={errors.grad} />

            {openPop === "GRAD" && (
              <div className="absolute left-0 top-full mt-1.5 w-full rounded-xl bg-white border border-slate-200 shadow-2xl py-1.5 z-40">
                {EDU_GRADUATION_STATUSES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => {
                      setGradStatus(st);
                      setErrors((prev) => ({ ...prev, grad: undefined }));
                      setOpenPop(null);
                    }}
                    className="w-full px-3.5 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-800"
                  >
                    <span>{st}</span>
                    {gradStatus === st && (
                      <span className="text-[#00c458] font-extrabold">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              전공
            </label>
            <input
              value={major}
              onChange={(e) => setMajor(e.target.value)}
              placeholder="전공 입력"
              className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 bg-slate-50/40 focus:bg-white focus:border-[#00c458] text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
        </div>

        {/* 3행: 입학 연월 | 졸업 연월 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            className="relative"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              입학 연월
            </label>
            <button
              type="button"
              onClick={() =>
                setOpenPop((p) => (p === "START_YM" ? null : "START_YM"))
              }
              className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/40 flex items-center justify-between text-[13px]"
            >
              <span
                className={
                  startYm ? "font-semibold text-slate-900" : "text-slate-400"
                }
              >
                {startYm ? formatYmKorean(startYm) : "입학 연월 선택"}
              </span>
              <span className="text-slate-400 text-[11px]">▾</span>
            </button>
            {openPop === "START_YM" && (
              <YearMonthPopover
                value={startYm}
                allowClear
                onSelect={setStartYm}
                onClose={() => setOpenPop(null)}
              />
            )}
          </div>

          <div
            className="relative"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              졸업 연월
            </label>
            <button
              type="button"
              onClick={() =>
                setOpenPop((p) => (p === "END_YM" ? null : "END_YM"))
              }
              className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/40 flex items-center justify-between text-[13px]"
            >
              <span
                className={
                  endYm ? "font-semibold text-slate-900" : "text-slate-400"
                }
              >
                {endYm ? formatYmKorean(endYm) : "졸업 연월 선택"}
              </span>
              <span className="text-slate-400 text-[11px]">▾</span>
            </button>
            {openPop === "END_YM" && (
              <YearMonthPopover
                value={endYm}
                allowClear
                onSelect={setEndYm}
                onClose={() => setOpenPop(null)}
              />
            )}
          </div>
        </div>

        {/* 하단 CTA */}
        <div className="flex items-center gap-2 pt-1">
          {mode === "edit" && onDelete && (
            <button
              type="button"
              disabled={saving}
              onClick={onDelete}
              className="px-4 py-3 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-[13px] shrink-0"
            >
              삭제
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#00d42a] via-[#00c774] to-[#00b8b9] hover:brightness-95 text-white text-[13px] font-extrabold shadow-sm disabled:opacity-50 transition-all"
          >
            {saving ? "저장 중..." : mode === "edit" ? "저장하기" : "추가하기"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 7. 특이사항 수정하기 모달 (Screenshot 6)
// ============================================================================

export const INCOME_TAX_REDUCTION_OPTIONS: {
  code: "T11" | "T12" | "T13";
  label: string;
}[] = [
  { code: "T11", label: "중소기업 취업자 소득세 감면 (50%)" },
  { code: "T12", label: "중소기업 취업자 소득세 감면 (70%)" },
  { code: "T13", label: "중소기업 취업자 소득세 감면 (90%)" },
];

export function formatTaxReductionLabel(code?: string): string {
  const found = INCOME_TAX_REDUCTION_OPTIONS.find((o) => o.code === code);
  return found ? `${found.code} · ${found.label}` : "";
}

export function HqSpecialNotesModal({
  initialDetail,
  initialSpecialNotes,
  initialHrMemo,
  isHrManager,
  saving,
  onClose,
  onSave,
}: {
  initialDetail?: HqSpecialNotesDetail;
  initialSpecialNotes?: string;
  initialHrMemo?: string;
  isHrManager: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: {
    special_notes_detail: HqSpecialNotesDetail;
    special_notes: string;
    hr_memo?: string;
  }) => void;
}) {
  const [ccStart, setCcStart] = useState(
    initialDetail?.childcare_short_work_start || ""
  );
  const [ccEnd, setCcEnd] = useState(
    initialDetail?.childcare_short_work_end || ""
  );
  const [fgStart, setFgStart] = useState(
    initialDetail?.foreigner_flat_tax_start || ""
  );
  const [fgEnd, setFgEnd] = useState(
    initialDetail?.foreigner_flat_tax_end || ""
  );
  const [taxCode, setTaxCode] = useState<"" | "T11" | "T12" | "T13">(
    initialDetail?.income_tax_reduction_code || ""
  );
  const [taxStart, setTaxStart] = useState(
    initialDetail?.income_tax_reduction_start || ""
  );
  const [taxEnd, setTaxEnd] = useState(
    initialDetail?.income_tax_reduction_end || ""
  );
  const [specialNotes, setSpecialNotes] = useState(initialSpecialNotes || "");
  const [hrMemo, setHrMemo] = useState(initialHrMemo || "");
  const [showExtraMemo, setShowExtraMemo] = useState(
    Boolean(initialSpecialNotes || initialHrMemo)
  );

  const [openPop, setOpenPop] = useState<
    null | "CHILDCARE" | "FOREIGNER" | "TAX_CODE" | "TAX_PERIOD"
  >(null);

  const formatPeriod = (s: string, e: string) => {
    if (s && e) return `${formatDotDateShort(s)} ~ ${formatDotDateShort(e)}`;
    if (s) return `${formatDotDateShort(s)} ~`;
    return "";
  };

  const selectedTaxMeta = INCOME_TAX_REDUCTION_OPTIONS.find(
    (x) => x.code === taxCode
  );

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          if (openPop) setOpenPop(null);
        }}
        className="bg-white w-full max-w-[460px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-4 text-xs overflow-visible"
      >
        <div className="flex items-center justify-between pb-1">
          <h4 className="text-[19px] font-extrabold text-slate-900 tracking-tight">
            특이사항 수정하기
          </h4>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-sm font-bold"
            title="닫기"
          >
            ✕
          </button>
        </div>

        {/* 1. 육아기 단축 근무 */}
        <div
          className="relative"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
            육아기 단축 근무
          </label>
          <button
            type="button"
            onClick={() =>
              setOpenPop((p) => (p === "CHILDCARE" ? null : "CHILDCARE"))
            }
            className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/40 flex items-center justify-between text-[13px]"
          >
            <span
              className={
                ccStart ? "font-semibold text-slate-900" : "text-slate-400"
              }
            >
              {formatPeriod(ccStart, ccEnd) || "기간 선택"}
            </span>
            <span className="text-slate-400 text-[11px]">▾</span>
          </button>
          {openPop === "CHILDCARE" && (
            <RangeDatePopover
              startDate={ccStart}
              endDate={ccEnd}
              onChange={(s, e) => {
                setCcStart(s);
                setCcEnd(e);
              }}
              onClose={() => setOpenPop(null)}
            />
          )}
        </div>

        {/* 2. 외국인 단일 세율 */}
        <div
          className="relative"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
            외국인 단일 세율
          </label>
          <button
            type="button"
            onClick={() =>
              setOpenPop((p) => (p === "FOREIGNER" ? null : "FOREIGNER"))
            }
            className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/40 flex items-center justify-between text-[13px]"
          >
            <span
              className={
                fgStart ? "font-semibold text-slate-900" : "text-slate-400"
              }
            >
              {formatPeriod(fgStart, fgEnd) || "기간 선택"}
            </span>
            <span className="text-slate-400 text-[11px]">▾</span>
          </button>
          {openPop === "FOREIGNER" && (
            <RangeDatePopover
              startDate={fgStart}
              endDate={fgEnd}
              onChange={(s, e) => {
                setFgStart(s);
                setFgEnd(e);
              }}
              onClose={() => setOpenPop(null)}
            />
          )}
        </div>

        {/* 3. 소득세 감면 (감면 종류 선택 + 기간 선택) */}
        <div className="space-y-2">
          <label className="block text-[11px] font-bold text-slate-600">
            소득세 감면
          </label>

          <div
            className="relative"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() =>
                setOpenPop((p) => (p === "TAX_CODE" ? null : "TAX_CODE"))
              }
              className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/40 flex items-center justify-between text-[13px]"
            >
              {selectedTaxMeta ? (
                <span className="inline-flex items-center gap-2 font-semibold text-slate-900 truncate">
                  <span className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-600 text-[10px] font-mono font-bold">
                    {selectedTaxMeta.code}
                  </span>
                  <span className="truncate">{selectedTaxMeta.label}</span>
                </span>
              ) : (
                <span className="text-slate-400">감면 종류 선택</span>
              )}
              <span className="text-slate-400 text-[11px] ml-2 shrink-0">▾</span>
            </button>

            {openPop === "TAX_CODE" && (
              <div className="absolute left-0 top-full mt-1.5 w-[300px] rounded-xl bg-white border border-slate-200 shadow-2xl py-1.5 z-40">
                {INCOME_TAX_REDUCTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.code}
                    type="button"
                    onClick={() => {
                      setTaxCode(opt.code);
                      setOpenPop(null);
                    }}
                    className="w-full px-3.5 py-2.5 text-left text-[12px] hover:bg-slate-50 flex items-center gap-2 font-semibold text-slate-800"
                  >
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-mono font-bold shrink-0">
                      {opt.code}
                    </span>
                    <span className="flex-1 truncate">{opt.label}</span>
                    {taxCode === opt.code && (
                      <span className="text-[#00c458] font-extrabold">✓</span>
                    )}
                  </button>
                ))}
                {taxCode && (
                  <button
                    type="button"
                    onClick={() => {
                      setTaxCode("");
                      setTaxStart("");
                      setTaxEnd("");
                      setOpenPop(null);
                    }}
                    className="w-full px-3.5 py-2 border-t border-slate-100 text-left text-[11px] font-semibold text-slate-400 hover:text-slate-700"
                  >
                    감면 선택 해제
                  </button>
                )}
              </div>
            )}
          </div>

          <div
            className="relative"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() =>
                setOpenPop((p) => (p === "TAX_PERIOD" ? null : "TAX_PERIOD"))
              }
              className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/40 flex items-center justify-between text-[13px]"
            >
              <span
                className={
                  taxStart ? "font-semibold text-slate-900" : "text-slate-400"
                }
              >
                {formatPeriod(taxStart, taxEnd) || "감면 기간 선택"}
              </span>
              <span className="text-slate-400 text-[11px]">▾</span>
            </button>

            {openPop === "TAX_PERIOD" && (
              <RangeDatePopover
                startDate={taxStart}
                endDate={taxEnd}
                onChange={(s, e) => {
                  setTaxStart(s);
                  setTaxEnd(e);
                }}
                onClose={() => setOpenPop(null)}
              />
            )}
          </div>
        </div>

        {/* 추가 메모 토글 (기존 메모 데이터 호환) */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowExtraMemo((p) => !p)}
            className="text-[11px] font-bold text-slate-400 hover:text-slate-700"
          >
            {showExtraMemo ? "기타 메모 접기 ▲" : "+ 기타 메모 / 인사 비공개 메모 입력"}
          </button>

          {showExtraMemo && (
            <div className="mt-2.5 space-y-2.5">
              <textarea
                rows={2}
                value={specialNotes}
                onChange={(e) => setSpecialNotes(e.target.value)}
                placeholder="기타 특이사항 메모 입력"
                className="w-full p-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 resize-none focus:border-[#00c458] focus:outline-none"
              />
              {isHrManager && (
                <textarea
                  rows={2}
                  value={hrMemo}
                  onChange={(e) => setHrMemo(e.target.value)}
                  placeholder="🔒 인사 권한자 전용 비공개 메모"
                  className="w-full p-2.5 rounded-xl border border-amber-200 bg-amber-50/40 text-xs text-slate-800 resize-none focus:border-amber-400 focus:outline-none"
                />
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() =>
            onSave({
              special_notes_detail: {
                childcare_short_work_start: ccStart,
                childcare_short_work_end: ccEnd,
                foreigner_flat_tax_start: fgStart,
                foreigner_flat_tax_end: fgEnd,
                income_tax_reduction_code: taxCode,
                income_tax_reduction_start: taxStart,
                income_tax_reduction_end: taxEnd,
              },
              special_notes: specialNotes.trim(),
              ...(isHrManager ? { hr_memo: hrMemo.trim() } : {}),
            })
          }
          className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00d42a] via-[#00c774] to-[#00b8b9] hover:brightness-95 text-white text-[13px] font-extrabold shadow-sm disabled:opacity-50 transition-all"
        >
          {saving ? "저장 중..." : "수정하기"}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// 8. 가족 정보 추가하기 / 수정하기 모달 (Screenshot 7)
// ============================================================================

export const FLEX_FAMILY_RELATIONS = [
  "배우자",
  "아버지",
  "어머니",
  "자녀",
  "며느리",
  "사위",
  "시아버지",
  "시어머니",
  "장인",
  "장모",
  "큰아버지 (백부)",
  "큰어머니 (백모)",
  "작은아버지 (숙부)",
  "작은어머니 (숙모)",
  "양아버지",
  "양어머니",
  "형제자매",
  "조부모",
  "손자녀",
  "기타",
];

export const DEDUCTION_RELATION_OPTIONS = [
  "해당 없음 (기본공제 미대상)",
  "배우자",
  "직계존속 (부모·조부모 등)",
  "직계비속 (자녀·입양자)",
  "형제자매",
  "국민기초생활보장 수급자",
  "위탁아동",
];

export const FAMILY_DISABILITY_OPTIONS = [
  "해당 없음",
  "장애인복지법에 따른 장애인",
  "국가유공자 등 예우 및 지원에 관한 법률에 따른 자",
  "항시 치료를 요하는 중증환자",
];

function formatPhoneDash(raw: string): string {
  const d = raw.replace(/[^0-9]/g, "").slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

function formatRrnDash(raw: string): string {
  const cleaned = raw.replace(/[^0-9*]/g, "").slice(0, 13);
  if (cleaned.length <= 6) return cleaned;
  return `${cleaned.slice(0, 6)}-${cleaned.slice(6)}`;
}

function inferBirthDateFromRrn(rrn: string): string {
  const digits = rrn.replace(/[^0-9]/g, "");
  if (digits.length < 7) return "";
  const yy = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const dd = digits.slice(4, 6);
  const g = digits.slice(6, 7);
  if (!["1", "2", "3", "4", "5", "6", "7", "8"].includes(g)) return "";
  const century = ["1", "2", "5", "6"].includes(g) ? "19" : "20";
  return `${century}${yy}-${mm}-${dd}`;
}

export function HqFamilyModal({
  mode,
  initialItem,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  mode: "create" | "edit";
  initialItem?: HqFamilyItem | null;
  saving: boolean;
  onClose: () => void;
  onSave: (saved: HqFamilyItem) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initialItem?.name || "");
  const [relation, setRelation] = useState(initialItem?.relation || "");
  const [phone, setPhone] = useState(initialItem?.phone || "");
  const [rrn, setRrn] = useState(initialItem?.rrn_masked || "");
  const [deductionRelation, setDeductionRelation] = useState(
    initialItem?.deduction_relation ||
      (initialItem?.basic_deduction ? initialItem.relation || "직계비속 (자녀·입양자)" : "")
  );
  const [disabilityType, setDisabilityType] = useState(
    initialItem?.disability_veteran_type || ""
  );
  const [healthDependent, setHealthDependent] = useState<boolean>(
    Boolean(initialItem?.health_dependent)
  );
  const [isCohabiting, setIsCohabiting] = useState<boolean>(
    initialItem?.is_cohabiting !== false
  );

  const [openPop, setOpenPop] = useState<
    null | "RELATION" | "DEDUCTION" | "DISABILITY"
  >(null);
  const [relSearch, setRelSearch] = useState("");
  const [nameErr, setNameErr] = useState("");

  const filteredRelations = useMemo(() => {
    const q = relSearch.trim().toLowerCase();
    if (!q) return FLEX_FAMILY_RELATIONS;
    return FLEX_FAMILY_RELATIONS.filter((r) => r.toLowerCase().includes(q));
  }, [relSearch]);

  const handleSubmit = () => {
    if (!name.trim()) {
      setNameErr("이름을 입력해 주세요.");
      return;
    }

    const derivedBirth =
      inferBirthDateFromRrn(rrn) || initialItem?.birth_date || "";
    const basicDeduction =
      Boolean(deductionRelation) &&
      !deductionRelation.startsWith("해당 없음");

    onSave({
      id: initialItem?.id || makeContractId("fam"),
      name: name.trim(),
      relation: relation || "가족",
      phone: phone.trim(),
      rrn_masked: rrn.trim(),
      birth_date: derivedBirth,
      deduction_relation: deductionRelation,
      disability_veteran_type: disabilityType,
      is_cohabiting: isCohabiting,
      basic_deduction: basicDeduction,
      health_dependent: healthDependent,
    });
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          if (openPop) setOpenPop(null);
        }}
        className="bg-white w-full max-w-[490px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-5 text-xs max-h-[92vh] overflow-y-auto custom-scroll"
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-[19px] font-extrabold text-slate-900 tracking-tight">
              {mode === "edit" ? "가족 정보 수정하기" : "가족 정보 추가하기"}
            </h4>
            <p className="text-[12px] text-slate-400 mt-1">
              건강보험 피부양자 신고와 부양가족 소득 공제를 받을 수 있어요.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-sm font-bold shrink-0"
            title="닫기"
          >
            ✕
          </button>
        </div>

        {/* 기본 정보 섹션 */}
        <div className="space-y-3.5">
          <h5 className="text-[14px] font-extrabold text-slate-900">기본 정보</h5>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                className={`block text-[11px] font-bold mb-1.5 ${
                  nameErr ? "text-[#e05246]" : "text-slate-600"
                }`}
              >
                이름 <span className="text-rose-500">*</span>
              </label>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (e.target.value.trim()) setNameErr("");
                }}
                placeholder="이름 입력"
                className={`w-full h-[42px] px-3.5 rounded-xl border text-[13px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none ${
                  nameErr
                    ? "border-[#e05246] bg-[#fff8f7]"
                    : "border-slate-200 bg-slate-50/40 focus:bg-white focus:border-[#00c458]"
                }`}
              />
              <FieldErrorLine message={nameErr} />
            </div>

            <div
              className="relative"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                관계
              </label>
              <button
                type="button"
                onClick={() =>
                  setOpenPop((p) => (p === "RELATION" ? null : "RELATION"))
                }
                className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/40 flex items-center justify-between text-[13px]"
              >
                <span
                  className={
                    relation
                      ? "font-semibold text-slate-900 truncate"
                      : "text-slate-400"
                  }
                >
                  {relation || "관계 선택"}
                </span>
                <span className="text-slate-400 text-[11px] ml-1">▾</span>
              </button>

              {openPop === "RELATION" && (
                <div className="absolute left-0 top-full mt-1.5 w-full rounded-xl bg-white border border-slate-200 shadow-2xl p-2 z-40">
                  <div className="px-2.5 py-1.5 rounded-lg border-2 border-[#00c458] flex items-center gap-1.5 mb-1.5">
                    <span className="text-slate-400 text-xs">🔍</span>
                    <input
                      autoFocus
                      value={relSearch}
                      onChange={(e) => setRelSearch(e.target.value)}
                      placeholder="검색"
                      className="flex-1 min-w-0 text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {filteredRelations.map((rel) => (
                      <button
                        key={rel}
                        type="button"
                        onClick={() => {
                          setRelation(rel);
                          setRelSearch("");
                          if (!deductionRelation) {
                            if (rel === "배우자") setDeductionRelation("배우자");
                            else if (rel === "자녀")
                              setDeductionRelation("직계비속 (자녀·입양자)");
                            else if (
                              rel.includes("아버지") ||
                              rel.includes("어머니") ||
                              rel === "장인" ||
                              rel === "장모" ||
                              rel === "조부모"
                            ) {
                              setDeductionRelation("직계존속 (부모·조부모 등)");
                            }
                          }
                          setOpenPop(null);
                        }}
                        className="w-full px-2.5 py-2 rounded-lg text-left text-[13px] hover:bg-slate-50 flex items-center justify-between font-bold text-slate-800"
                      >
                        <span>{rel}</span>
                        {relation === rel && (
                          <span className="text-[#00c458] font-extrabold">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              휴대전화번호
            </label>
            <input
              value={phone}
              maxLength={13}
              onChange={(e) => setPhone(formatPhoneDash(e.target.value))}
              placeholder="휴대전화번호 입력"
              className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 bg-slate-50/40 focus:bg-white focus:border-[#00c458] text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="border-t border-slate-100" />

        {/* 공제 정보 섹션 */}
        <div className="space-y-3.5">
          <div className="flex items-center gap-1.5">
            <h5 className="text-[14px] font-extrabold text-slate-900">
              공제 정보
            </h5>
            <span
              className="w-4 h-4 rounded-full border border-slate-300 text-slate-400 text-[10px] inline-flex items-center justify-center cursor-help font-bold"
              title="연말정산 인적공제 및 건강보험 피부양자 등록 판단에 활용됩니다."
            >
              ?
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              주민등록번호 (외국인등록번호)
            </label>
            <input
              value={rrn}
              maxLength={14}
              onChange={(e) => setRrn(formatRrnDash(e.target.value))}
              placeholder="주민등록번호 입력"
              className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 bg-slate-50/40 focus:bg-white focus:border-[#00c458] text-[13px] font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none"
            />
          </div>

          <div
            className="relative"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 mb-1.5">
              <span>소득 공제 관계</span>
              <span
                className="w-3.5 h-3.5 rounded-full border border-slate-300 text-slate-400 text-[9px] inline-flex items-center justify-center cursor-help"
                title="연말정산 기본공제 대상에 해당하는 경우 공제 관계를 선택하세요."
              >
                ?
              </span>
            </label>
            <button
              type="button"
              onClick={() =>
                setOpenPop((p) => (p === "DEDUCTION" ? null : "DEDUCTION"))
              }
              className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/40 flex items-center justify-between text-[13px]"
            >
              <span
                className={
                  deductionRelation
                    ? "font-semibold text-slate-900 truncate"
                    : "text-slate-400"
                }
              >
                {deductionRelation || "관계 선택"}
              </span>
              <span className="text-slate-400 text-[11px]">▾</span>
            </button>

            {openPop === "DEDUCTION" && (
              <div className="absolute left-0 top-full mt-1.5 w-full rounded-xl bg-white border border-slate-200 shadow-2xl py-1.5 z-40">
                {DEDUCTION_RELATION_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      setDeductionRelation(opt);
                      setOpenPop(null);
                    }}
                    className="w-full px-3.5 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-800"
                  >
                    <span>{opt}</span>
                    {deductionRelation === opt && (
                      <span className="text-[#00c458] font-extrabold">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            className="relative"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              장애인 · 국가유공자
            </label>
            <button
              type="button"
              onClick={() =>
                setOpenPop((p) => (p === "DISABILITY" ? null : "DISABILITY"))
              }
              className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/40 flex items-center justify-between text-[13px]"
            >
              <span
                className={
                  disabilityType
                    ? "font-semibold text-slate-900 truncate"
                    : "text-slate-400"
                }
              >
                {disabilityType || "해당 여부 선택"}
              </span>
              <span className="text-slate-400 text-[11px]">▾</span>
            </button>

            {openPop === "DISABILITY" && (
              <div className="absolute left-0 bottom-full mb-1.5 w-full rounded-xl bg-white border border-slate-200 shadow-2xl py-1.5 z-40">
                {FAMILY_DISABILITY_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      setDisabilityType(opt);
                      setOpenPop(null);
                    }}
                    className="w-full px-3.5 py-2 text-left text-[12px] hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-800"
                  >
                    <span className="truncate">{opt}</span>
                    {disabilityType === opt && (
                      <span className="text-[#00c458] font-extrabold ml-2 shrink-0">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-5 pt-1">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none text-[12px] font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={healthDependent}
                onChange={(e) => setHealthDependent(e.target.checked)}
                className="w-4 h-4 rounded accent-[#00c458]"
              />
              <span>건강보험 피부양자 등록</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none text-[12px] font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={isCohabiting}
                onChange={(e) => setIsCohabiting(e.target.checked)}
                className="w-4 h-4 rounded accent-[#00c458]"
              />
              <span>동거 가족</span>
            </label>
          </div>
        </div>

        {/* 하단 CTA */}
        <div className="flex items-center gap-2 pt-1">
          {mode === "edit" && onDelete && (
            <button
              type="button"
              disabled={saving}
              onClick={onDelete}
              className="px-4 py-3 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-[13px] shrink-0"
            >
              삭제
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#00d42a] via-[#00c774] to-[#00b8b9] hover:brightness-95 text-white text-[13px] font-extrabold shadow-sm disabled:opacity-50 transition-all"
          >
            {saving ? "저장 중..." : mode === "edit" ? "저장하기" : "추가하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
