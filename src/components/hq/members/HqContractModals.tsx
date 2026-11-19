// src/components/hq/members/HqContractModals.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { hqFetch } from "@/lib/hq/clientApi";
import type {
  HqFixedOvertimeConfig,
  HqIncomeType,
  HqLaborContractInfo,
  HqLaborContractItem,
  HqMember,
  HqPersonnelAppointmentItem,
  HqProfileExtra,
  HqWageAmountUnit,
  HqWageContractInfo,
  HqWageContractItem,
} from "@/lib/hq/types";

// ============================================================================
// 1. 공통 포괄임금 · 계약 유틸리티
// ============================================================================

export const INCOME_TYPES: HqIncomeType[] = [
  "근로소득",
  "사업소득",
  "기타소득",
  "무보수",
];

export const WAGE_AMOUNT_UNITS: HqWageAmountUnit[] = [
  "연봉",
  "월급",
  "일급",
  "시급",
  "일시지급",
];

export const LABOR_EMPLOYMENT_TYPES: string[] = [
  "정규직",
  "계약직",
  "수습",
  "인턴",
  "프리랜서",
  "파트타임",
  "파견직",
  "일용직",
  "임원",
];

export const AVG_WEEKS_PER_MONTH = 365 / 7 / 12; // 약 4.345238주

export const DEFAULT_FIXED_OVERTIME: HqFixedOvertimeConfig = {
  enabled: false,
  include_night_in_regular: false,
  is_weekly_input: false,
  overtime_hours: 0,
  holiday_hours: 0,
  overtime_night_hours: 0,
  holiday_overtime_hours: 0,
  holiday_night_hours: 0,
  holiday_overtime_night_hours: 0,
  regular_night_hours: 0,
  total_contract_hours: 0,
  total_weighted_hours: 0,
};

export function makeContractId(prefix = "ctr"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function formatDotDateShort(iso?: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso;
  return `${Number(m[1])}. ${Number(m[2])}. ${Number(m[3])}`;
}

function roundHours2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function formatHourNumber(n: number): string {
  const r = roundHours2(n);
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(2).replace(/\.?0+$/, "");
}

export function calcFixedOvertimeTotals(raw?: Partial<HqFixedOvertimeConfig> | null): {
  normalized: HqFixedOvertimeConfig;
  overtimeCapHoursInUnit: number; // 52h 한도 비교 대상 (초과근로 합계, 소정야간 제외)
  monthlyOvertimeHours: number; // 월 환산 초과근로시간
  monthlyWeightedHours: number; // 월 환산 총 가산시간
  isOverStatutoryLimit: boolean;
} {
  const isWeekly = Boolean(raw?.is_weekly_input);
  const includeRegNight = Boolean(raw?.include_night_in_regular);

  const ot = Math.max(0, Number(raw?.overtime_hours || 0));
  const hol = Math.max(0, Number(raw?.holiday_hours || 0));
  const otNight = Math.max(0, Number(raw?.overtime_night_hours || 0));
  const holOt = Math.max(0, Number(raw?.holiday_overtime_hours || 0));
  const holNight = Math.max(0, Number(raw?.holiday_night_hours || 0));
  const holOtNight = Math.max(0, Number(raw?.holiday_overtime_night_hours || 0));
  const regNight = includeRegNight
    ? Math.max(0, Number(raw?.regular_night_hours || 0))
    : 0;

  const overtimeContractSum = roundHours2(
    ot + hol + otNight + holOt + holNight + holOtNight
  );
  const totalContract = roundHours2(overtimeContractSum + regNight);
  const totalWeighted = roundHours2(
    ot * 1.5 +
      hol * 1.5 +
      otNight * 2.0 +
      holOt * 2.0 +
      holNight * 2.0 +
      holOtNight * 2.5 +
      regNight * 0.5
  );

  const monthlyFactor = isWeekly ? AVG_WEEKS_PER_MONTH : 1;
  const monthlyOvertimeHours = roundHours2(overtimeContractSum * monthlyFactor);
  const monthlyWeightedHours = roundHours2(totalWeighted * monthlyFactor);

  // 주 단위 입력 시 월 평균 주(약 4.345주) 적용 월 52시간(주 약 12시간) 초과 여부 판단
  const isOverStatutoryLimit = isWeekly
    ? overtimeContractSum > 12 || monthlyOvertimeHours > 52.2
    : overtimeContractSum > 52;

  const enabled = totalContract > 0;

  return {
    normalized: {
      enabled,
      include_night_in_regular: includeRegNight,
      is_weekly_input: isWeekly,
      overtime_hours: ot,
      holiday_hours: hol,
      overtime_night_hours: otNight,
      holiday_overtime_hours: holOt,
      holiday_night_hours: holNight,
      holiday_overtime_night_hours: holOtNight,
      regular_night_hours: regNight,
      total_contract_hours: totalContract,
      total_weighted_hours: totalWeighted,
    },
    overtimeCapHoursInUnit: overtimeContractSum,
    monthlyOvertimeHours,
    monthlyWeightedHours,
    isOverStatutoryLimit,
  };
}

export function formatFixedOvertimeSummary(
  cfg?: HqFixedOvertimeConfig | null
): string {
  if (!cfg) return "";
  const { normalized } = calcFixedOvertimeTotals(cfg);
  if (!normalized.enabled || normalized.total_contract_hours <= 0) return "";
  const unit = normalized.is_weekly_input ? "주" : "월";
  const parts: string[] = [];
  if (normalized.overtime_hours > 0)
    parts.push(`연장 ${formatHourNumber(normalized.overtime_hours)}h`);
  if (normalized.holiday_hours > 0)
    parts.push(`휴일 ${formatHourNumber(normalized.holiday_hours)}h`);
  if (normalized.overtime_night_hours > 0)
    parts.push(`연장·야간 ${formatHourNumber(normalized.overtime_night_hours)}h`);
  if (normalized.holiday_overtime_hours > 0)
    parts.push(`휴일·연장 ${formatHourNumber(normalized.holiday_overtime_hours)}h`);
  if (normalized.holiday_night_hours > 0)
    parts.push(`휴일·야간 ${formatHourNumber(normalized.holiday_night_hours)}h`);
  if (normalized.holiday_overtime_night_hours > 0)
    parts.push(
      `휴일·연장·야간 ${formatHourNumber(normalized.holiday_overtime_night_hours)}h`
    );
  if (
    normalized.include_night_in_regular &&
    (normalized.regular_night_hours || 0) > 0
  ) {
    parts.push(`소정야간 ${formatHourNumber(normalized.regular_night_hours || 0)}h`);
  }

  const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `${unit} ${formatHourNumber(
    normalized.total_contract_hours
  )}시간 · 가산 ${formatHourNumber(normalized.total_weighted_hours)}시간${detail}`;
}

export function computeInclusiveWageBreakdown(params: {
  incomeType: HqIncomeType;
  amountUnit: HqWageAmountUnit;
  contractAmount: number;
  fixedOvertime?: HqFixedOvertimeConfig | null;
  weeklyWorkHours?: number;
  mealAllowance?: number;
}): {
  wageTypeLabel: string;
  annualSalary: number;
  monthlyGross: number;
  monthlyBase: number;
  fixedOvertimeAllowance: number;
  regularMonthlyHours: number;
  monthlyWeightedOvertimeHours: number;
  hourlyOrdinaryWage: number;
} {
  const {
    incomeType,
    amountUnit,
    contractAmount,
    fixedOvertime,
    weeklyWorkHours = 40,
    mealAllowance = 200000,
  } = params;

  const { normalized, monthlyWeightedHours } =
    calcFixedOvertimeTotals(fixedOvertime);
  const hasFixedOt = normalized.enabled && monthlyWeightedHours > 0;

  // 주 40시간 기준 주휴 포함 월 소정근로시간 = 209시간 (기타 주당 시간 비례)
  const regularMonthlyHours =
    weeklyWorkHours === 40
      ? 209
      : Math.max(1, Math.round(((weeklyWorkHours * 6) / 5) * AVG_WEEKS_PER_MONTH));

  if (incomeType === "무보수" || contractAmount <= 0) {
    return {
      wageTypeLabel: incomeType === "무보수" ? "무보수" : `${amountUnit}`,
      annualSalary: 0,
      monthlyGross: 0,
      monthlyBase: 0,
      fixedOvertimeAllowance: 0,
      regularMonthlyHours,
      monthlyWeightedOvertimeHours: monthlyWeightedHours,
      hourlyOrdinaryWage: 0,
    };
  }

  let annualSalary = 0;
  let monthlyGross = 0;

  if (amountUnit === "연봉") {
    annualSalary = Math.round(contractAmount);
    monthlyGross = Math.round(contractAmount / 12);
  } else if (amountUnit === "월급") {
    monthlyGross = Math.round(contractAmount);
    annualSalary = monthlyGross * 12;
  } else if (amountUnit === "일급") {
    monthlyGross = Math.round(contractAmount * 21.7);
    annualSalary = monthlyGross * 12;
  } else if (amountUnit === "시급") {
    monthlyGross = Math.round(
      contractAmount * (regularMonthlyHours + monthlyWeightedHours)
    );
    annualSalary = monthlyGross * 12;
  } else {
    // 일시지급
    monthlyGross = Math.round(contractAmount);
    annualSalary = Math.round(contractAmount);
  }

  const effectiveMeal =
    incomeType === "근로소득" &&
    (amountUnit === "연봉" || amountUnit === "월급") &&
    monthlyGross > mealAllowance
      ? Math.max(0, Math.round(mealAllowance))
      : 0;

  const taxableMonthly = Math.max(0, monthlyGross - effectiveMeal);
  const totalPaidHours = regularMonthlyHours + monthlyWeightedHours;

  let monthlyBase = taxableMonthly;
  let fixedOvertimeAllowance = 0;
  let hourlyOrdinaryWage =
    regularMonthlyHours > 0 ? Math.round(taxableMonthly / regularMonthlyHours) : 0;

  if (
    hasFixedOt &&
    (amountUnit === "연봉" || amountUnit === "월급") &&
    totalPaidHours > 0
  ) {
    hourlyOrdinaryWage = Math.round(taxableMonthly / totalPaidHours);
    monthlyBase = Math.round(
      (taxableMonthly * regularMonthlyHours) / totalPaidHours
    );
    fixedOvertimeAllowance = Math.max(0, taxableMonthly - monthlyBase);
  }

  const baseUnitLabel =
    amountUnit === "연봉"
      ? "연봉제"
      : amountUnit === "월급"
        ? "월급제"
        : amountUnit === "일급"
          ? "일급제"
          : amountUnit === "시급"
            ? "시급제"
            : "일시지급";

  const wageTypeLabel = hasFixedOt
    ? `${baseUnitLabel} (포괄임금)`
    : baseUnitLabel;

  return {
    wageTypeLabel,
    annualSalary,
    monthlyGross,
    monthlyBase,
    fixedOvertimeAllowance,
    regularMonthlyHours,
    monthlyWeightedOvertimeHours: monthlyWeightedHours,
    hourlyOrdinaryWage,
  };
}

export function resolveWageContractsList(
  ex?: HqProfileExtra
): HqWageContractItem[] {
  if (Array.isArray(ex?.wage_contracts) && ex!.wage_contracts!.length > 0) {
    return ex!.wage_contracts!;
  }
  const legacy = ex?.wage_contract;
  if (
    legacy &&
    (legacy.contract_amount ||
      legacy.annual_salary ||
      legacy.monthly_base ||
      legacy.income_type === "무보수")
  ) {
    const unit: HqWageAmountUnit =
      legacy.amount_unit ||
      (legacy.wage_type?.includes("월급")
        ? "월급"
        : legacy.wage_type?.includes("시급")
          ? "시급"
          : legacy.wage_type?.includes("일급")
            ? "일급"
            : "연봉");
    const amt =
      legacy.contract_amount ??
      (unit === "연봉"
        ? legacy.annual_salary || (legacy.monthly_base || 0) * 12
        : legacy.monthly_base || legacy.annual_salary || 0);
    return [
      {
        ...legacy,
        id: legacy.id || "legacy-wage-1",
        income_type: legacy.income_type || "근로소득",
        amount_unit: unit,
        contract_amount: amt,
        start_date: legacy.start_date || legacy.effective_date || "",
      },
    ];
  }
  return [];
}

export function resolveLaborContractsList(
  member: HqMember
): HqLaborContractItem[] {
  const ex = member.profile_extra;
  if (Array.isArray(ex?.labor_contracts) && ex!.labor_contracts!.length > 0) {
    return ex!.labor_contracts!;
  }
  const legacy = ex?.labor_contract;
  if (
    legacy &&
    (legacy.contract_type ||
      legacy.employment_type ||
      legacy.start_date ||
      legacy.end_date ||
      legacy.probation_end_date ||
      legacy.salary_pay_rate !== undefined)
  ) {
    return [
      {
        ...legacy,
        id: legacy.id || "legacy-labor-1",
        employment_type:
          legacy.employment_type || member.employment_type || "정규직",
        start_date: legacy.start_date || member.hire_date || "",
      },
    ];
  }
  return [];
}

// ============================================================================
// 2. 플렉스 스타일 달력 팝오버 & 메모 팝오버 & 수습 기간 범위 팝오버
// ============================================================================

function getTodayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseFlexibleDateInput(raw: string): string | null {
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

function buildCalendarGrid(year: number, month0: number) {
  const firstDow = new Date(year, month0, 1).getDay();
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const prevMonthDays = new Date(year, month0, 0).getDate();

  const cells: { ymd: string; day: number; inMonth: boolean }[] = [];

  for (let i = firstDow - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const dt = new Date(year, month0 - 1, d);
    cells.push({
      ymd: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
      day: d,
      inMonth: false,
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      ymd: `${year}-${String(month0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      day: d,
      inMonth: true,
    });
  }

  while (cells.length < 42) {
    const nextD = cells.length - (firstDow + daysInMonth) + 1;
    const dt = new Date(year, month0 + 1, nextD);
    cells.push({
      ymd: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
      day: nextD,
      inMonth: false,
    });
  }

  return cells;
}

function FlexSingleDatePopover({
  value,
  isOptional,
  onSelect,
  onReset,
  onClose,
}: {
  value: string;
  isOptional?: boolean;
  onSelect: (ymd: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const todayYmd = useMemo(() => getTodayYmd(), []);
  const initDate = value ? new Date(`${value}T00:00:00`) : new Date();
  const [viewYear, setViewYear] = useState(
    Number.isNaN(initDate.getTime()) ? new Date().getFullYear() : initDate.getFullYear()
  );
  const [viewMonth0, setViewMonth0] = useState(
    Number.isNaN(initDate.getTime()) ? new Date().getMonth() : initDate.getMonth()
  );
  const [inputText, setInputText] = useState(value || "");

  const cells = useMemo(
    () => buildCalendarGrid(viewYear, viewMonth0),
    [viewYear, viewMonth0]
  );

  const shiftMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth0 + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth0(next.getMonth());
  };

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute left-0 top-full mt-1.5 w-[252px] rounded-2xl bg-white border border-slate-200 shadow-2xl p-3 z-40 text-xs"
    >
      <input
        autoFocus
        value={inputText}
        onChange={(e) => {
          const v = e.target.value;
          setInputText(v);
          const parsed = parseFlexibleDateInput(v);
          if (parsed) {
            const dt = new Date(`${parsed}T00:00:00`);
            setViewYear(dt.getFullYear());
            setViewMonth0(dt.getMonth());
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const parsed = parseFlexibleDateInput(inputText);
            if (parsed) {
              onSelect(parsed);
              onClose();
            }
          }
        }}
        placeholder="날짜 입력"
        className="w-full px-3 py-2 rounded-lg border-2 border-[#00c458] text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none"
      />

      {(isOptional || value) && (
        <div className="flex items-center justify-between px-0.5 pt-2 pb-1 text-[11px]">
          <span className="text-slate-400">
            {isOptional ? "선택 입력이에요." : "계약 시작일"}
          </span>
          <button
            type="button"
            onClick={() => {
              setInputText("");
              onReset();
              onClose();
            }}
            className="text-slate-400 hover:text-slate-700 font-semibold"
          >
            초기화
          </button>
        </div>
      )}

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

function FlexMemoPopover({
  memo,
  onSave,
  onClose,
}: {
  memo: string;
  onSave: (val: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(memo);
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute left-0 top-full mt-1.5 w-[280px] rounded-2xl bg-white border border-slate-200 shadow-2xl p-3 z-40 text-xs space-y-2.5"
    >
      <textarea
        autoFocus
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="메모할 내용을 입력하세요."
        className="w-full p-2.5 rounded-xl border-2 border-[#00c458] text-xs text-slate-800 placeholder:text-slate-400 resize-none focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400 flex items-center gap-1">
          <svg
            className="w-3.5 h-3.5 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <span>권한자만 볼 수 있어요.</span>
        </span>
        <button
          type="button"
          onClick={() => {
            onSave(draft.trim());
            onClose();
          }}
          className="px-3 py-1.5 rounded-lg bg-[#00c458] hover:bg-[#00b04f] text-white text-[11px] font-extrabold"
        >
          입력하기
        </button>
      </div>
    </div>
  );
}

function FlexContractTopChips({
  startDate,
  endDate,
  memo,
  onChangeStart,
  onChangeEnd,
  onChangeMemo,
}: {
  startDate: string;
  endDate: string;
  memo: string;
  onChangeStart: (v: string) => void;
  onChangeEnd: (v: string) => void;
  onChangeMemo: (v: string) => void;
}) {
  const [openPop, setOpenPop] = useState<null | "START" | "END" | "MEMO">(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPop) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpenPop(null);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [openPop]);

  return (
    <div ref={wrapRef} className="flex flex-wrap items-center gap-1.5 pt-1">
      {/* 1. 계약시작일 칩 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenPop((p) => (p === "START" ? null : "START"))}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors border ${
            startDate
              ? "bg-emerald-50 text-[#00a84b] border-emerald-200 hover:bg-emerald-100/70"
              : "bg-[#fff5eb] text-[#e67e22] border-[#fde3c8] hover:bg-[#ffecd6]"
          }`}
        >
          {startDate
            ? `계약시작일 ${formatDotDateShort(startDate)}`
            : "계약시작일 없음"}
        </button>
        {openPop === "START" && (
          <FlexSingleDatePopover
            value={startDate}
            isOptional={false}
            onSelect={(ymd) => onChangeStart(ymd)}
            onReset={() => onChangeStart("")}
            onClose={() => setOpenPop(null)}
          />
        )}
      </div>

      {/* 2. 계약종료일 칩 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenPop((p) => (p === "END" ? null : "END"))}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors border inline-flex items-center gap-1 group ${
            endDate
              ? "bg-slate-800 text-white border-slate-800"
              : "bg-slate-100 text-slate-600 border-slate-200/70 hover:bg-slate-200/70"
          }`}
          title="기간의 정함이 있는 계약인 경우 계약종료일을 지정하세요."
        >
          <span>
            {endDate ? `계약종료일 ${formatDotDateShort(endDate)}` : "계약종료일"}
          </span>
          <span
            className={`w-3.5 h-3.5 rounded-full text-[9px] inline-flex items-center justify-center border ${
              endDate
                ? "border-white/50 text-white/80"
                : "border-slate-400 text-slate-400"
            }`}
          >
            ?
          </span>
        </button>
        {openPop === "END" && (
          <FlexSingleDatePopover
            value={endDate}
            isOptional
            onSelect={(ymd) => onChangeEnd(ymd)}
            onReset={() => onChangeEnd("")}
            onClose={() => setOpenPop(null)}
          />
        )}
      </div>

      {/* 3. 메모 칩 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenPop((p) => (p === "MEMO" ? null : "MEMO"))}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors border inline-flex items-center gap-1.5 ${
            memo
              ? "bg-slate-800 text-white border-slate-800"
              : "bg-slate-100 text-slate-600 border-slate-200/70 hover:bg-slate-200/70"
          }`}
        >
          <span>메모</span>
          {memo && <span className="w-1.5 h-1.5 rounded-full bg-[#00e676]" />}
        </button>
        {openPop === "MEMO" && (
          <FlexMemoPopover
            memo={memo}
            onSave={onChangeMemo}
            onClose={() => setOpenPop(null)}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 3. 포괄계약 근로시간 설정 서브 모달 (Screenshots 9 ~ 12)
// ============================================================================

const OVERTIME_TABLE_ROWS: {
  key: keyof Pick<
    HqFixedOvertimeConfig,
    | "overtime_hours"
    | "holiday_hours"
    | "overtime_night_hours"
    | "holiday_overtime_hours"
    | "holiday_night_hours"
    | "holiday_overtime_night_hours"
  >;
  label: string;
  rateBadge: string;
  multiplier: number;
}[] = [
  { key: "overtime_hours", label: "연장", rateBadge: "150%", multiplier: 1.5 },
  { key: "holiday_hours", label: "휴일", rateBadge: "150%", multiplier: 1.5 },
  {
    key: "overtime_night_hours",
    label: "연장 · 야간",
    rateBadge: "200%",
    multiplier: 2.0,
  },
  {
    key: "holiday_overtime_hours",
    label: "휴일 · 연장",
    rateBadge: "200%",
    multiplier: 2.0,
  },
  {
    key: "holiday_night_hours",
    label: "휴일 · 야간",
    rateBadge: "200%",
    multiplier: 2.0,
  },
  {
    key: "holiday_overtime_night_hours",
    label: "휴일 · 연장 · 야간",
    rateBadge: "250%",
    multiplier: 2.5,
  },
];

function FixedOvertimeConfigSubModal({
  initialConfig,
  onApply,
  onClose,
}: {
  initialConfig: HqFixedOvertimeConfig;
  onApply: (next: HqFixedOvertimeConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<HqFixedOvertimeConfig>(() => ({
    ...DEFAULT_FIXED_OVERTIME,
    ...initialConfig,
  }));

  const calc = useMemo(() => calcFixedOvertimeTotals(draft), [draft]);
  const unitPrefix = draft.is_weekly_input ? "주" : "월";

  const updateHourField = (
    field: keyof HqFixedOvertimeConfig,
    rawVal: string
  ) => {
    const cleaned = rawVal.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const safeStr =
      parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : cleaned;
    const num = safeStr === "" ? 0 : Math.min(999, Number(safeStr));
    setDraft((prev) => ({
      ...prev,
      [field]: Number.isFinite(num) ? num : 0,
    }));
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/45 z-[70] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-[460px] rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 text-xs max-h-[92vh] overflow-y-auto custom-scroll"
      >
        {/* 상단 타이틀 */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-[18px] font-extrabold text-slate-900 tracking-tight">
              포괄계약 근로시간 설정
            </h4>
            <p className="text-[12px] text-slate-500 leading-relaxed mt-1.5">
              법정기준 근로시간을 초과한 추가 근로시간(연장·야간·휴일 근무 등)을 미리
              약정하여 매월 일정액을 기본임금에 포함하여 지급할 수 있어요.
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

        {/* 한도 안내 배너 */}
        <div
          className={`px-3.5 py-2.5 rounded-xl flex items-center gap-2 text-[12px] font-bold ${
            calc.isOverStatutoryLimit
              ? "bg-rose-50 text-rose-600 border border-rose-200"
              : "bg-slate-50 text-slate-700"
          }`}
        >
          <span
            className={`w-4 h-4 rounded-full text-white text-[10px] flex items-center justify-center font-extrabold shrink-0 ${
              calc.isOverStatutoryLimit ? "bg-rose-500" : "bg-[#00c458]"
            }`}
          >
            !
          </span>
          <span>
            {draft.is_weekly_input
              ? "총 계약 근로시간은 주 12시간(월 환산 52시간) 이하로 입력하세요."
              : "총 계약 근로시간은 월 52시간 이하로 입력하세요."}
          </span>
        </div>

        {/* 포괄계약 시간 입력 테이블 */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-400 font-semibold">
                <th className="py-2.5 px-3 text-left">구분</th>
                <th className="py-2.5 px-3 text-left w-[128px]">계약 근로시간</th>
                <th className="py-2.5 px-3 text-left w-[112px]">가산시간</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {OVERTIME_TABLE_ROWS.map((row) => {
                const rawVal = Number(draft[row.key] || 0);
                const weightedVal = roundHours2(rawVal * row.multiplier);
                return (
                  <tr key={row.key} className="hover:bg-slate-50/40">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-semibold text-slate-800">
                          {row.label}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold font-mono">
                          {row.rateBadge}
                        </span>
                      </div>
                    </td>
                    <td className="p-0 border-x border-slate-100">
                      <label className="flex items-center justify-between px-3 py-2.5 cursor-text focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500 bg-white">
                        <span className="text-slate-400 select-none">
                          {unitPrefix}
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={rawVal === 0 ? "0" : String(rawVal)}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) =>
                            updateHourField(row.key, e.target.value)
                          }
                          className="w-12 text-right font-bold text-slate-900 focus:outline-none bg-transparent"
                        />
                        <span className="text-slate-400 select-none ml-1">
                          시간
                        </span>
                      </label>
                    </td>
                    <td className="py-2.5 px-3 bg-slate-50/30">
                      <div className="flex items-center justify-between text-slate-600">
                        <span className="text-slate-400">{unitPrefix}</span>
                        <span className="font-bold text-slate-800">
                          {formatHourNumber(weightedVal)}
                        </span>
                        <span className="text-slate-400">시간</span>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* 소정근로시간에 야간시간 포함 체크 시 추가 행 (50% 가산) */}
              {draft.include_night_in_regular && (
                <tr className="bg-amber-50/20">
                  <td className="py-2.5 px-3">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-semibold text-slate-800">
                        소정 야간
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold font-mono">
                        50%
                      </span>
                    </div>
                  </td>
                  <td className="p-0 border-x border-slate-100">
                    <label className="flex items-center justify-between px-3 py-2.5 cursor-text focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500 bg-white">
                      <span className="text-slate-400 select-none">
                        {unitPrefix}
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={
                          (draft.regular_night_hours || 0) === 0
                            ? "0"
                            : String(draft.regular_night_hours)
                        }
                        onFocus={(e) => e.target.select()}
                        onChange={(e) =>
                          updateHourField("regular_night_hours", e.target.value)
                        }
                        className="w-12 text-right font-bold text-slate-900 focus:outline-none bg-transparent"
                      />
                      <span className="text-slate-400 select-none ml-1">
                        시간
                      </span>
                    </label>
                  </td>
                  <td className="py-2.5 px-3 bg-slate-50/30">
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="text-slate-400">{unitPrefix}</span>
                      <span className="font-bold text-slate-800">
                        {formatHourNumber(
                          roundHours2((draft.regular_night_hours || 0) * 0.5)
                        )}
                      </span>
                      <span className="text-slate-400">시간</span>
                    </div>
                  </td>
                </tr>
              )}

              {/* 합계 행 */}
              <tr className="bg-slate-50/80 font-bold border-t border-slate-200">
                <td className="py-3 px-3 text-slate-700">합계</td>
                <td className="py-3 px-3 border-x border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-normal">
                      {unitPrefix}
                    </span>
                    <span
                      className={
                        calc.isOverStatutoryLimit
                          ? "text-rose-600 font-extrabold"
                          : "text-slate-900 font-extrabold"
                      }
                    >
                      {formatHourNumber(calc.normalized.total_contract_hours)}
                    </span>
                    <span className="text-slate-400 font-normal">시간</span>
                  </div>
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-normal">
                      {unitPrefix}
                    </span>
                    <span className="text-slate-900 font-extrabold">
                      {formatHourNumber(calc.normalized.total_weighted_hours)}
                    </span>
                    <span className="text-slate-400 font-normal">시간</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 하단 옵션 체크박스 2개 + 툴팁 (Screenshots 10 & 11) */}
        <div className="space-y-2 pt-0.5">
          <div className="flex items-center gap-1.5">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none text-[12px] text-slate-700 font-medium">
              <input
                type="checkbox"
                checked={draft.include_night_in_regular}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    include_night_in_regular: e.target.checked,
                  }))
                }
                className="w-4 h-4 rounded border-slate-300 accent-[#00c458]"
              />
              <span>소정근로시간에 야간시간 포함</span>
            </label>
            <div className="relative group inline-flex items-center">
              <span className="w-3.5 h-3.5 rounded-full border border-slate-300 text-slate-400 text-[9px] inline-flex items-center justify-center cursor-help">
                ?
              </span>
              <div className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute left-5 bottom-full mb-1.5 w-[235px] p-2.5 rounded-lg bg-slate-800 text-white text-[11px] leading-relaxed shadow-xl z-50">
                초과근로시간이 아닌 소정근로시간 내 야간시간이 포함된 경우 사용합니다. (야간 교대 근무 등)
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none text-[12px] text-slate-700 font-medium">
              <input
                type="checkbox"
                checked={draft.is_weekly_input}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    is_weekly_input: e.target.checked,
                  }))
                }
                className="w-4 h-4 rounded border-slate-300 accent-[#00c458]"
              />
              <span>포괄계약 근로시간을 주단위로 입력</span>
            </label>
            <div className="relative group inline-flex items-center">
              <span className="w-3.5 h-3.5 rounded-full border border-slate-300 text-slate-400 text-[9px] inline-flex items-center justify-center cursor-help">
                ?
              </span>
              <div className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute left-5 bottom-full mb-1.5 w-[240px] p-2.5 rounded-lg bg-slate-800 text-white text-[11px] leading-relaxed shadow-xl z-50">
                근로시간 초과 여부는, 월 평균 주를 적용하여 매월 1일~말일 기준의 월 단위 계약으로 변환하여 판단합니다.
              </div>
            </div>
          </div>
        </div>

        {/* 설정하기 버튼 */}
        <button
          type="button"
          onClick={() => {
            if (calc.isOverStatutoryLimit) {
              alert(
                "총 계약 초과근로시간은 월 52시간(주 12시간) 이하로 입력해 주세요."
              );
              return;
            }
            onApply(calc.normalized);
          }}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00d42a] via-[#00c774] to-[#00b8b9] hover:brightness-95 text-white text-[13px] font-extrabold shadow-sm flex items-center justify-center gap-1.5 transition-all"
        >
          <span className="w-4 h-4 rounded-full bg-white text-[#00b874] text-[10px] inline-flex items-center justify-center font-black">
            ✓
          </span>
          <span>설정하기</span>
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// 4. 임금 계약 추가하기 / 수정하기 모달 (Screenshots 3 ~ 12)
// ============================================================================

export function HqWageContractModal({
  mode,
  initialItem,
  weeklyWorkHours = 40,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  mode: "create" | "edit";
  initialItem?: HqWageContractInfo | null;
  weeklyWorkHours?: number;
  saving: boolean;
  onClose: () => void;
  onSave: (saved: HqWageContractItem) => void;
  onDelete?: () => void;
}) {
  const [startDate, setStartDate] = useState(
    initialItem?.start_date || initialItem?.effective_date || ""
  );
  const [endDate, setEndDate] = useState(initialItem?.end_date || "");
  const [memo, setMemo] = useState(initialItem?.memo || "");

  const [incomeType, setIncomeType] = useState<HqIncomeType>(
    initialItem?.income_type || "근로소득"
  );
  const [amountUnit, setAmountUnit] = useState<HqWageAmountUnit>(
    initialItem?.amount_unit ||
      (initialItem?.wage_type?.includes("월급")
        ? "월급"
        : initialItem?.wage_type?.includes("시급")
          ? "시급"
          : initialItem?.wage_type?.includes("일급")
            ? "일급"
            : "연봉")
  );
  const [contractAmountStr, setContractAmountStr] = useState(() => {
    const rawAmt =
      initialItem?.contract_amount ??
      initialItem?.annual_salary ??
      initialItem?.monthly_base ??
      0;
    return rawAmt > 0 ? String(rawAmt) : "";
  });

  const [fixedOvertime, setFixedOvertime] = useState<HqFixedOvertimeConfig>(
    () => ({
      ...DEFAULT_FIXED_OVERTIME,
      ...(initialItem?.fixed_overtime || {}),
    })
  );
  const [otherTerms, setOtherTerms] = useState(
    initialItem?.other_terms ?? initialItem?.note ?? ""
  );
  const [payDay, setPayDay] = useState(initialItem?.pay_day || "매월 25일");
  const [mealAllowanceStr, setMealAllowanceStr] = useState(
    initialItem?.meal_allowance !== undefined
      ? String(initialItem.meal_allowance)
      : "200000"
  );
  const [showDetailPayOpts, setShowDetailPayOpts] = useState(false);

  const [openDropdown, setOpenDropdown] = useState<
    null | "INCOME" | "UNIT"
  >(null);
  const [overtimeModalOpen, setOvertimeModalOpen] = useState(false);

  const contractAmountNum = Number(
    contractAmountStr.replace(/[^0-9]/g, "") || 0
  );
  const mealAllowanceNum = Number(
    mealAllowanceStr.replace(/[^0-9]/g, "") || 0
  );

  const breakdown = useMemo(
    () =>
      computeInclusiveWageBreakdown({
        incomeType,
        amountUnit,
        contractAmount: contractAmountNum,
        fixedOvertime,
        weeklyWorkHours,
        mealAllowance: mealAllowanceNum,
      }),
    [
      incomeType,
      amountUnit,
      contractAmountNum,
      fixedOvertime,
      weeklyWorkHours,
      mealAllowanceNum,
    ]
  );

  const fixedOtSummary = useMemo(
    () => formatFixedOvertimeSummary(fixedOvertime),
    [fixedOvertime]
  );

  const handleSubmit = () => {
    if (incomeType !== "무보수" && contractAmountNum <= 0) {
      alert("계약금액을 입력해 주세요.");
      return;
    }

    const { normalized } = calcFixedOvertimeTotals(fixedOvertime);
    const item: HqWageContractItem = {
      id: initialItem?.id || makeContractId("wage"),
      income_type: incomeType,
      amount_unit: amountUnit,
      contract_amount: incomeType === "무보수" ? 0 : contractAmountNum,
      wage_type: breakdown.wageTypeLabel,
      annual_salary: breakdown.annualSalary,
      monthly_base: breakdown.monthlyBase,
      fixed_overtime_allowance: breakdown.fixedOvertimeAllowance,
      fixed_overtime: normalized,
      pay_day: payDay.trim() || "매월 25일",
      effective_date: startDate,
      start_date: startDate,
      end_date: endDate,
      meal_allowance: mealAllowanceNum,
      other_terms: otherTerms.trim(),
      memo: memo.trim(),
      note: otherTerms.trim(),
    };

    onSave(item);
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4"
        onMouseDown={onClose}
      >
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            if (openDropdown) setOpenDropdown(null);
          }}
          className="bg-white w-full max-w-[520px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-5 text-xs max-h-[92vh] overflow-y-auto custom-scroll"
        >
          {/* 헤더 + 닫기 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[19px] font-extrabold text-slate-900 tracking-tight">
                {mode === "edit" ? "임금 계약 수정하기" : "임금 계약 추가하기"}
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

            <FlexContractTopChips
              startDate={startDate}
              endDate={endDate}
              memo={memo}
              onChangeStart={setStartDate}
              onChangeEnd={setEndDate}
              onChangeMemo={setMemo}
            />
          </div>

          {/* 1행: 소득 유형 * | 계약금액 * */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
            {/* 소득 유형 */}
            <div
              className="sm:col-span-5 relative"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                소득 유형 <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown((p) => (p === "INCOME" ? null : "INCOME"))
                }
                className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white flex items-center justify-between text-[13px] font-semibold text-slate-800"
              >
                <span>{incomeType}</span>
                <span className="text-slate-400 text-[11px]">▾</span>
              </button>

              {openDropdown === "INCOME" && (
                <div className="absolute left-0 top-full mt-1.5 w-full rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30">
                  {INCOME_TYPES.map((it) => (
                    <button
                      key={it}
                      type="button"
                      onClick={() => {
                        setIncomeType(it);
                        if (it === "무보수") setContractAmountStr("0");
                        setOpenDropdown(null);
                      }}
                      className="w-full px-3.5 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center justify-between font-medium text-slate-800"
                    >
                      <span>{it}</span>
                      {incomeType === it && (
                        <span className="text-[#00c458] font-extrabold">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 계약금액 */}
            <div
              className="sm:col-span-7 relative"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                계약금액 <span className="text-rose-500">*</span>
              </label>
              <div className="h-[42px] rounded-xl border border-slate-200 focus-within:border-[#00c458] bg-white flex items-center">
                <div className="relative h-full shrink-0">
                  <button
                    type="button"
                    disabled={incomeType === "무보수"}
                    onClick={() =>
                      setOpenDropdown((p) => (p === "UNIT" ? null : "UNIT"))
                    }
                    className="h-full px-3 border-r border-slate-200 flex items-center gap-1.5 text-[13px] font-semibold text-slate-800 disabled:text-slate-400"
                  >
                    <span>{amountUnit}</span>
                    <span className="text-slate-400 text-[10px]">▾</span>
                  </button>

                  {openDropdown === "UNIT" && (
                    <div className="absolute left-0 top-full mt-1.5 w-[132px] rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30">
                      {WAGE_AMOUNT_UNITS.map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => {
                            setAmountUnit(u);
                            setOpenDropdown(null);
                          }}
                          className="w-full px-3.5 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center justify-between font-medium text-slate-800"
                        >
                          <span>{u}</span>
                          {amountUnit === u && (
                            <span className="text-[#00c458] font-extrabold">
                              ✓
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <input
                  type="text"
                  inputMode="numeric"
                  disabled={incomeType === "무보수"}
                  value={
                    incomeType === "무보수"
                      ? "0"
                      : contractAmountNum > 0
                        ? contractAmountNum.toLocaleString("ko-KR")
                        : ""
                  }
                  onChange={(e) =>
                    setContractAmountStr(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder="금액 입력"
                  className="flex-1 min-w-0 px-3 text-[13px] font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                />
                <span className="pr-3 text-[12px] font-semibold text-slate-500 shrink-0">
                  원
                </span>
              </div>
            </div>
          </div>

          {/* 2행: 포괄계약 근로시간 */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              포괄계약 근로시간
            </label>
            <button
              type="button"
              disabled={incomeType === "무보수"}
              onClick={() => setOvertimeModalOpen(true)}
              className="w-full min-h-[42px] px-3.5 py-2.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white flex items-center justify-between gap-2 text-left disabled:bg-slate-50 transition-colors"
            >
              {fixedOtSummary ? (
                <span className="text-[13px] font-bold text-slate-900 truncate">
                  {fixedOtSummary}
                </span>
              ) : (
                <span className="text-[13px] text-slate-400">시간 입력</span>
              )}
              <span className="text-slate-400 text-base leading-none shrink-0">
                ›
              </span>
            </button>
            <p className="text-[11px] text-slate-400 mt-1.5">
              고정초과근무수당이 있는 경우 입력하세요.
            </p>

            {/* 포괄임금 역산 요약 미리보기 */}
            {incomeType !== "무보수" &&
              contractAmountNum > 0 &&
              (amountUnit === "연봉" || amountUnit === "월급") && (
                <div className="mt-2.5 p-3 rounded-xl bg-emerald-50/60 border border-emerald-200/80 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="font-bold text-emerald-900">
                      {fixedOtSummary
                        ? `포괄임금 월 급여 구성 (소정 ${breakdown.regularMonthlyHours}h + 가산 ${formatHourNumber(breakdown.monthlyWeightedOvertimeHours)}h)`
                        : "월 급여 구성 미리보기"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowDetailPayOpts((p) => !p)}
                      className="text-[11px] font-bold text-[#00a84b] hover:underline"
                    >
                      {showDetailPayOpts
                        ? "식대·지급일 접기 ▲"
                        : "식대·지급일 조정 ▾"}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-700">
                    <span>
                      월 환산{" "}
                      <strong className="text-slate-900">
                        {breakdown.monthlyGross.toLocaleString()}원
                      </strong>
                    </span>
                    <span className="text-slate-300">|</span>
                    <span>
                      기본급{" "}
                      <strong className="text-slate-900">
                        {breakdown.monthlyBase.toLocaleString()}원
                      </strong>
                    </span>
                    {breakdown.fixedOvertimeAllowance > 0 && (
                      <>
                        <span className="text-slate-300">+</span>
                        <span>
                          고정초과수당{" "}
                          <strong className="text-[#00a84b]">
                            {breakdown.fixedOvertimeAllowance.toLocaleString()}원
                          </strong>
                        </span>
                      </>
                    )}
                    {mealAllowanceNum > 0 && (
                      <>
                        <span className="text-slate-300">+</span>
                        <span className="text-slate-500 text-[11px]">
                          비과세 식대 {mealAllowanceNum.toLocaleString()}원
                        </span>
                      </>
                    )}
                  </div>

                  {showDetailPayOpts && (
                    <div className="pt-2 mt-1 border-t border-emerald-200/70 grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          급여 지급일
                        </label>
                        <input
                          value={payDay}
                          onChange={(e) => setPayDay(e.target.value)}
                          placeholder="매월 25일"
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          식대 비과세 한도 (원)
                        </label>
                        <input
                          value={
                            mealAllowanceNum > 0
                              ? mealAllowanceNum.toLocaleString()
                              : "0"
                          }
                          onChange={(e) =>
                            setMealAllowanceStr(
                              e.target.value.replace(/[^0-9]/g, "")
                            )
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-right"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
          </div>

          {/* 3행: 기타 계약 내용 */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              기타 계약 내용
            </label>
            <textarea
              rows={3}
              value={otherTerms}
              onChange={(e) => setOtherTerms(e.target.value)}
              placeholder="사이닝 보너스, 스톡옵션 등 기타 계약에 대한 내용을 입력하세요."
              className="w-full p-3.5 rounded-xl border border-slate-200 focus:border-[#00c458] focus:outline-none text-[13px] text-slate-800 placeholder:text-slate-400 resize-none"
            />
          </div>

          {/* 하단 버튼 */}
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
              {saving
                ? "저장 중..."
                : mode === "edit"
                  ? "저장하기"
                  : "추가하기"}
            </button>
          </div>
        </div>
      </div>

      {overtimeModalOpen && (
        <FixedOvertimeConfigSubModal
          initialConfig={fixedOvertime}
          onApply={(next) => {
            setFixedOvertime(next);
            setOvertimeModalOpen(false);
          }}
          onClose={() => setOvertimeModalOpen(false)}
        />
      )}
    </>
  );
}

// ============================================================================
// 5. 근로 계약 추가하기 / 수정하기 모달 (Screenshot 13 — 수습 기간 + 급여지급률 %)
// ============================================================================

function FlexProbationRangePopover({
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
    () => buildCalendarGrid(viewYear, viewMonth0),
    [viewYear, viewMonth0]
  );

  const shiftMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth0 + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth0(next.getMonth());
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
      className="absolute left-0 top-full mt-1.5 w-[268px] rounded-2xl bg-white border border-slate-200 shadow-2xl p-3 z-40 text-xs"
    >
      <div className="grid grid-cols-2 gap-1.5">
        <input
          value={startInput}
          onFocus={() => setPickingField("START")}
          onChange={(e) => {
            setStartInput(e.target.value);
            const p = parseFlexibleDateInput(e.target.value);
            if (p) onChange(p, endDate);
          }}
          placeholder="시작일 입력"
          className={`w-full px-2.5 py-1.5 rounded-lg border text-[11px] font-medium focus:outline-none ${
            pickingField === "START"
              ? "border-[#00c458] ring-1 ring-[#00c458]"
              : "border-slate-200"
          }`}
        />
        <input
          value={endInput}
          onFocus={() => setPickingField("END")}
          onChange={(e) => {
            setEndInput(e.target.value);
            const p = parseFlexibleDateInput(e.target.value);
            if (p) onChange(startDate, p);
          }}
          placeholder="종료일 입력"
          className={`w-full px-2.5 py-1.5 rounded-lg border text-[11px] font-medium focus:outline-none ${
            pickingField === "END"
              ? "border-[#00c458] ring-1 ring-[#00c458]"
              : "border-slate-200"
          }`}
        />
      </div>

      {(startDate || endDate) && (
        <div className="flex items-center justify-between pt-2 px-0.5 text-[11px]">
          <span className="text-slate-400">수습 적용 기간</span>
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
      )}

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

export function HqLaborContractModal({
  mode,
  initialItem,
  defaultEmploymentType = "정규직",
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  mode: "create" | "edit";
  initialItem?: HqLaborContractInfo | null;
  defaultEmploymentType?: string;
  saving: boolean;
  onClose: () => void;
  onSave: (saved: HqLaborContractItem) => void;
  onDelete?: () => void;
}) {
  const [startDate, setStartDate] = useState(initialItem?.start_date || "");
  const [endDate, setEndDate] = useState(initialItem?.end_date || "");
  const [memo, setMemo] = useState(initialItem?.memo || "");

  const [employmentType, setEmploymentType] = useState(
    initialItem?.employment_type || defaultEmploymentType || "정규직"
  );
  const [probationStart, setProbationStart] = useState(
    initialItem?.probation_start_date || ""
  );
  const [probationEnd, setProbationEnd] = useState(
    initialItem?.probation_end_date || ""
  );
  const [salaryPayRateStr, setSalaryPayRateStr] = useState(
    initialItem?.salary_pay_rate !== undefined &&
      initialItem?.salary_pay_rate !== null
      ? String(initialItem.salary_pay_rate)
      : ""
  );
  const [workPlace, setWorkPlace] = useState(
    initialItem?.work_place || "천종현수학연구소 본부"
  );
  const [note, setNote] = useState(initialItem?.note || "");

  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [probationPopOpen, setProbationPopOpen] = useState(false);

  const probationLabel = useMemo(() => {
    if (probationStart && probationEnd) {
      return `${formatDotDateShort(probationStart)} ~ ${formatDotDateShort(probationEnd)}`;
    }
    if (probationEnd) {
      return `~ ${formatDotDateShort(probationEnd)}`;
    }
    if (probationStart) {
      return `${formatDotDateShort(probationStart)} ~`;
    }
    return "";
  }, [probationStart, probationEnd]);

  const handleSubmit = () => {
    const rawRate = salaryPayRateStr.trim();
    const rateNum =
      rawRate === ""
        ? null
        : Math.min(100, Math.max(0, Number(rawRate.replace(/[^0-9.]/g, ""))));

    const contractTypeLabel =
      employmentType === "정규직" && !endDate
        ? "무기계약 (정규직)"
        : endDate
          ? `기간제 (${employmentType})`
          : employmentType;

    const item: HqLaborContractItem = {
      id: initialItem?.id || makeContractId("labor"),
      employment_type: employmentType,
      contract_type: contractTypeLabel,
      start_date: startDate,
      end_date: endDate,
      probation_start_date: probationStart,
      probation_end_date: probationEnd,
      salary_pay_rate: rateNum,
      work_place: workPlace.trim() || "천종현수학연구소 본부",
      memo: memo.trim(),
      note: note.trim(),
    };
    onSave(item);
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          if (typeDropdownOpen) setTypeDropdownOpen(false);
          if (probationPopOpen) setProbationPopOpen(false);
        }}
        className="bg-white w-full max-w-[520px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-5 text-xs overflow-visible"
      >
        {/* 헤더 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[19px] font-extrabold text-slate-900 tracking-tight">
              {mode === "edit" ? "근로 계약 수정하기" : "근로 계약 추가하기"}
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

          <FlexContractTopChips
            startDate={startDate}
            endDate={endDate}
            memo={memo}
            onChangeStart={setStartDate}
            onChangeEnd={setEndDate}
            onChangeMemo={setMemo}
          />
        </div>

        {/* 근로 유형 * */}
        <div
          className="relative"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
            근로 유형 <span className="text-rose-500">*</span>
          </label>
          <button
            type="button"
            onClick={() => setTypeDropdownOpen((p) => !p)}
            className="w-full h-[42px] px-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white flex items-center justify-between text-[13px] font-semibold text-slate-800"
          >
            <span>{employmentType}</span>
            <span className="text-slate-400 text-[11px]">▾</span>
          </button>

          {typeDropdownOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-full max-h-56 overflow-y-auto rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30">
              {LABOR_EMPLOYMENT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setEmploymentType(t);
                    setTypeDropdownOpen(false);
                  }}
                  className="w-full px-3.5 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center justify-between font-medium text-slate-800"
                >
                  <span>{t}</span>
                  {employmentType === t && (
                    <span className="text-[#00c458] font-extrabold">✓</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 수습 정보 (기간 선택 + 급여지급률 %) — Screenshot 13 */}
        <div
          className="relative"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
            수습 정보
          </label>
          <div className="h-[42px] rounded-xl border border-slate-200 focus-within:border-[#00c458] bg-white flex items-center">
            <button
              type="button"
              onClick={() => setProbationPopOpen((p) => !p)}
              className="flex-1 h-full px-3.5 border-r border-slate-200 flex items-center justify-between text-[13px] text-left min-w-0"
            >
              <span
                className={
                  probationLabel
                    ? "font-semibold text-slate-900 truncate"
                    : "text-slate-400"
                }
              >
                {probationLabel || "기간 선택"}
              </span>
              <span className="text-slate-400 text-[10px] ml-2 shrink-0">▾</span>
            </button>

            <div className="w-[185px] sm:w-[205px] h-full px-3 flex items-center gap-2 shrink-0">
              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold shrink-0">
                급여지급률
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={salaryPayRateStr}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^0-9.]/g, "");
                  setSalaryPayRateStr(cleaned.slice(0, 5));
                }}
                placeholder="지급률 입력"
                className="flex-1 min-w-0 text-right text-[13px] font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none"
              />
              <span className="text-slate-500 font-semibold text-[12px] shrink-0">
                %
              </span>
            </div>
          </div>

          {probationPopOpen && (
            <FlexProbationRangePopover
              startDate={probationStart}
              endDate={probationEnd}
              onChange={(s, e) => {
                setProbationStart(s);
                setProbationEnd(e);
              }}
              onClose={() => setProbationPopOpen(false)}
            />
          )}
        </div>

        {/* 근무 장소 / 기타 조건 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              근무 장소
            </label>
            <input
              value={workPlace}
              onChange={(e) => setWorkPlace(e.target.value)}
              placeholder="천종현수학연구소 본부"
              className="w-full h-[38px] px-3 rounded-xl border border-slate-200 focus:border-[#00c458] focus:outline-none text-[12px] text-slate-800"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              기타 근로 조건 (선택)
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="특약 · 단축근무 등"
              className="w-full h-[38px] px-3 rounded-xl border border-slate-200 focus:border-[#00c458] focus:outline-none text-[12px] text-slate-800"
            />
          </div>
        </div>

        {/* 하단 버튼 */}
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
// 6. 구성원 프로필 PDF 다운로드 모달 (Screenshot 14)
// ============================================================================

export type ProfilePdfSectionKey =
  | "인사 정보"
  | "발령 이력"
  | "근로 계약 정보"
  | "임금 계약 정보"
  | "경력 정보"
  | "학력 정보"
  | "역량 정보"
  | "교육 정보"
  | "기본 정보"
  | "가족 정보";

const DEFAULT_PDF_SECTIONS: ProfilePdfSectionKey[] = [
  "인사 정보",
  "발령 이력",
  "근로 계약 정보",
  "임금 계약 정보",
  "경력 정보",
  "학력 정보",
  "역량 정보",
  "교육 정보",
];

const ALL_PDF_SECTIONS: ProfilePdfSectionKey[] = [
  ...DEFAULT_PDF_SECTIONS,
  "기본 정보",
  "가족 정보",
];

function escapeHtml(raw: unknown): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isStrongPdfPassword(pw: string): boolean {
  if (pw.length < 8) return false;
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  return hasLower && hasUpper && hasDigit && hasSymbol;
}

export function HqMemberProfilePdfDownloadModal({
  isOpen,
  members,
  companyName = "(주)천종현수학연구소",
  appointments = [],
  onClose,
}: {
  isOpen: boolean;
  members: HqMember[];
  companyName?: string;
  appointments?: HqPersonnelAppointmentItem[];
  onClose: () => void;
}) {
  const [selectedSections, setSelectedSections] = useState<
    ProfilePdfSectionKey[]
  >(DEFAULT_PDF_SECTIONS);
  const [sectionDropdownOpen, setSectionDropdownOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [reason, setReason] = useState("");
  const [downloading, setDownloading] = useState(false);

  if (!isOpen) return null;

  const accessibleMembers = members.filter(
    (m) => m.can_view_private !== false
  );
  const pwValid = isStrongPdfPassword(password);
  const canDownload =
    selectedSections.length > 0 &&
    pwValid &&
    reason.trim().length > 0 &&
    accessibleMembers.length > 0 &&
    !downloading;

  const toggleSection = (sec: ProfilePdfSectionKey) => {
    setSelectedSections((prev) =>
      prev.includes(sec) ? prev.filter((x) => x !== sec) : [...prev, sec]
    );
  };

  const handleDownload = async () => {
    if (!canDownload) return;
    setDownloading(true);
    try {
      // 보안 감사 로그 기록
      await hqFetch("/api/hq/audit-logs", {
        method: "POST",
        body: {
          activity_type: "개인정보 접근",
          event_type: "다운로드",
          info_type: "개인정보",
          description: `구성원 프로필 PDF 다운로드 (${accessibleMembers
            .map((m) => m.name)
            .slice(0, 3)
            .join(", ")}${
            accessibleMembers.length > 3
              ? ` 외 ${accessibleMembers.length - 3}명`
              : ""
          }) · 사유: ${reason.trim()}`,
        },
      }).catch(() => {});

      const issuedAt = new Date().toLocaleString("ko-KR");
      const memberPagesHtml = accessibleMembers
        .map((m, idx) => {
          const ex = m.profile_extra || {};
          const laborList = resolveLaborContractsList(m);
          const wageList = resolveWageContractsList(ex);
          const memberAppoints = appointments.filter(
            (a) => a.target_member_id === m.instructor_id || a.target_member_name === m.name
          );

          const blocks: string[] = [];

          if (selectedSections.includes("인사 정보")) {
            blocks.push(`
              <section class="sec">
                <h3>인사 정보</h3>
                <table>
                  <tr><th>소속 조직</th><td>${escapeHtml(m.department || "미지정")}</td><th>직책 / 직위</th><td>${escapeHtml(m.job_title || "-")}</td></tr>
                  <tr><th>사번</th><td>${escapeHtml(m.employee_no || "-")}</td><th>재직 상태</th><td>${escapeHtml(m.work_status)}</td></tr>
                  <tr><th>입사일</th><td>${escapeHtml(m.hire_date || "-")}</td><th>담당 직무</th><td>${escapeHtml((ex.hr_jobs_selected || []).join(", ") || m.job_description || "-")}</td></tr>
                </table>
              </section>
            `);
          }

          if (selectedSections.includes("기본 정보")) {
            blocks.push(`
              <section class="sec">
                <h3>기본 정보</h3>
                <table>
                  <tr><th>이메일</th><td>${escapeHtml(m.email || "-")}</td><th>휴대전화</th><td>${escapeHtml(m.phone || "-")}</td></tr>
                  <tr><th>생년월일</th><td>${escapeHtml(m.birth_date || "-")}</td><th>국적</th><td>${escapeHtml(ex.nationality || "대한민국(KOR)")}</td></tr>
                  <tr><th>주소</th><td colspan="3">${escapeHtml(m.address || "-")}</td></tr>
                </table>
              </section>
            `);
          }

          if (selectedSections.includes("발령 이력")) {
            const rowsHtml =
              memberAppoints.length > 0
                ? memberAppoints
                    .map(
                      (ap) =>
                        `<tr><td>${escapeHtml(ap.effective_date)}</td><td>${escapeHtml(ap.appointment_label || ap.event_type)}</td><td>${escapeHtml(ap.summary)}</td></tr>`
                    )
                    .join("")
                : `<tr><td>${escapeHtml(m.hire_date || "-")}</td><td>신규 입사</td><td>${escapeHtml(`${m.department} · ${m.job_title}`)}</td></tr>`;
            blocks.push(`
              <section class="sec">
                <h3>발령 이력</h3>
                <table>
                  <thead><tr><th style="width:120px">발령일</th><th style="width:130px">발령 구분</th><th>상세 내용</th></tr></thead>
                  <tbody>${rowsHtml}</tbody>
                </table>
              </section>
            `);
          }

          if (selectedSections.includes("근로 계약 정보")) {
            const rowsHtml =
              laborList.length > 0
                ? laborList
                    .map((lc) => {
                      const period = `${lc.start_date || "계약시작일 없음"} ~ ${lc.end_date || "기간의 정함 없음"}`;
                      const prob =
                        lc.probation_start_date || lc.probation_end_date
                          ? `${lc.probation_start_date || ""} ~ ${lc.probation_end_date || ""}`
                          : "-";
                      const rate =
                        lc.salary_pay_rate !== undefined &&
                        lc.salary_pay_rate !== null
                          ? `${lc.salary_pay_rate}%`
                          : "100%";
                      return `<tr><td>${escapeHtml(lc.employment_type || m.employment_type)}</td><td>${escapeHtml(period)}</td><td>${escapeHtml(prob)}</td><td>${escapeHtml(rate)}</td></tr>`;
                    })
                    .join("")
                : `<tr><td>${escapeHtml(m.employment_type || "정규직")}</td><td>${escapeHtml(m.hire_date || "-")} ~ 기간의 정함 없음</td><td>-</td><td>100%</td></tr>`;
            blocks.push(`
              <section class="sec">
                <h3>근로 계약 정보</h3>
                <table>
                  <thead><tr><th>근로 유형</th><th>계약 기간</th><th>수습 기간</th><th>급여지급률</th></tr></thead>
                  <tbody>${rowsHtml}</tbody>
                </table>
              </section>
            `);
          }

          if (selectedSections.includes("임금 계약 정보")) {
            const rowsHtml =
              wageList.length > 0
                ? wageList
                    .map((wc) => {
                      const amt =
                        wc.income_type === "무보수"
                          ? "무보수"
                          : `${wc.amount_unit || "연봉"} ${Number(wc.contract_amount ?? wc.annual_salary ?? 0).toLocaleString()}원`;
                      const otText =
                        formatFixedOvertimeSummary(wc.fixed_overtime) ||
                        "해당 없음";
                      const period = `${wc.start_date || wc.effective_date || "계약시작일 없음"}${wc.end_date ? ` ~ ${wc.end_date}` : ""}`;
                      return `<tr><td>${escapeHtml(wc.income_type || "근로소득")}</td><td>${escapeHtml(amt)}</td><td>${escapeHtml(otText)}</td><td>${escapeHtml(period)}</td></tr>`;
                    })
                    .join("")
                : `<tr><td colspan="4" style="text-align:center;color:#94a3b8">등록된 임금 계약 정보가 없습니다.</td></tr>`;
            blocks.push(`
              <section class="sec">
                <h3>임금 계약 정보</h3>
                <table>
                  <thead><tr><th>소득 유형</th><th>계약 금액</th><th>포괄계약 근로시간</th><th>계약 기간</th></tr></thead>
                  <tbody>${rowsHtml}</tbody>
                </table>
              </section>
            `);
          }

          if (selectedSections.includes("경력 정보")) {
            const careers = ex.careers || [];
            const rowsHtml =
              careers.length > 0
                ? careers
                    .map(
                      (c) =>
                        `<tr><td>${escapeHtml(c.company_name)}</td><td>${escapeHtml(c.start_ym)} ~ ${escapeHtml(c.end_ym || "현재")}</td><td>${escapeHtml(c.contract_type)}</td><td>${escapeHtml([c.department, c.job_title].filter(Boolean).join(" · ") || "-")}</td></tr>`
                    )
                    .join("")
                : `<tr><td colspan="4" style="text-align:center;color:#94a3b8">등록된 경력 정보가 없습니다.</td></tr>`;
            blocks.push(`
              <section class="sec">
                <h3>경력 정보</h3>
                <table>
                  <thead><tr><th>회사명</th><th>재직 기간</th><th>계약 유형</th><th>부서 · 직책</th></tr></thead>
                  <tbody>${rowsHtml}</tbody>
                </table>
              </section>
            `);
          }

          if (selectedSections.includes("학력 정보")) {
            const edus = ex.educations || [];
            const rowsHtml =
              edus.length > 0
                ? edus
                    .map(
                      (ed) =>
                        `<tr><td>${escapeHtml(ed.school_name)}</td><td>${escapeHtml(ed.degree_type)} (${escapeHtml(ed.graduation_status)})</td><td>${escapeHtml(ed.major || "-")}</td><td>${escapeHtml(ed.start_ym)} ~ ${escapeHtml(ed.end_ym || "")}</td></tr>`
                    )
                    .join("")
                : `<tr><td colspan="4" style="text-align:center;color:#94a3b8">등록된 학력 정보가 없습니다.</td></tr>`;
            blocks.push(`
              <section class="sec">
                <h3>학력 정보</h3>
                <table>
                  <thead><tr><th>학교명</th><th>학위 · 상태</th><th>전공</th><th>기간</th></tr></thead>
                  <tbody>${rowsHtml}</tbody>
                </table>
              </section>
            `);
          }

          if (selectedSections.includes("역량 정보")) {
            const goals = ex.growth_goals || [];
            const rowsHtml =
              goals.length > 0
                ? goals
                    .map(
                      (g) =>
                        `<tr><td>${escapeHtml(g.period)}</td><td>${escapeHtml(g.title)}</td><td>${escapeHtml(g.status)} (${g.progress}%)</td></tr>`
                    )
                    .join("")
                : `<tr><td colspan="3" style="text-align:center;color:#94a3b8">등록된 역량·목표 정보가 없습니다.</td></tr>`;
            blocks.push(`
              <section class="sec">
                <h3>역량 정보</h3>
                <table>
                  <thead><tr><th style="width:130px">기간</th><th>역량 · 핵심 목표</th><th style="width:120px">달성 현황</th></tr></thead>
                  <tbody>${rowsHtml}</tbody>
                </table>
              </section>
            `);
          }

          if (selectedSections.includes("교육 정보")) {
            const trs = ex.trainings || [];
            const rowsHtml =
              trs.length > 0
                ? trs
                    .map(
                      (tr) =>
                        `<tr><td>${escapeHtml(tr.title)}</td><td>${escapeHtml(tr.institution || "사내교육")}</td><td>${escapeHtml(tr.completed_date)}</td><td>${escapeHtml(tr.hours)}시간 (${escapeHtml(tr.status)})</td></tr>`
                    )
                    .join("")
                : `<tr><td colspan="4" style="text-align:center;color:#94a3b8">등록된 교육 정보가 없습니다.</td></tr>`;
            blocks.push(`
              <section class="sec">
                <h3>교육 정보</h3>
                <table>
                  <thead><tr><th>과정명</th><th>교육 기관</th><th>이수일</th><th>이수 시간</th></tr></thead>
                  <tbody>${rowsHtml}</tbody>
                </table>
              </section>
            `);
          }

          if (selectedSections.includes("가족 정보")) {
            const fams = ex.families || [];
            const rowsHtml =
              fams.length > 0
                ? fams
                    .map(
                      (fm) =>
                        `<tr><td>${escapeHtml(fm.relation)}</td><td>${escapeHtml(fm.name)}</td><td>${escapeHtml(fm.birth_date || "-")}</td><td>${fm.basic_deduction ? "기본공제" : "-"} / ${fm.health_dependent ? "피부양자" : "-"}</td></tr>`
                    )
                    .join("")
                : `<tr><td colspan="4" style="text-align:center;color:#94a3b8">등록된 가족 정보가 없습니다.</td></tr>`;
            blocks.push(`
              <section class="sec">
                <h3>가족 정보</h3>
                <table>
                  <thead><tr><th>관계</th><th>성명</th><th>생년월일</th><th>공제 · 피부양</th></tr></thead>
                  <tbody>${rowsHtml}</tbody>
                </table>
              </section>
            `);
          }

          return `
            <div class="page" style="${idx > 0 ? "page-break-before: always;" : ""}">
              <div class="doc-header">
                <div>
                  <div class="corp">${escapeHtml(companyName)} · 인사 프로필 리포트</div>
                  <h1>${escapeHtml(m.name)} <span>${escapeHtml(m.job_title || "")} · ${escapeHtml(m.department || "")}</span></h1>
                </div>
                <div class="meta">
                  <div>출력일시: ${escapeHtml(issuedAt)}</div>
                  <div>보안사유: ${escapeHtml(reason.trim())}</div>
                </div>
              </div>
              ${blocks.join("")}
            </div>
          `;
        })
        .join("");

      const popup = window.open("", "_blank", "width=920,height=860");
      if (!popup) {
        alert("브라우저 팝업 차단을 해제한 뒤 다시 시도해 주세요.");
        return;
      }

      popup.document.write(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>구성원 프로필 PDF - ${escapeHtml(
    accessibleMembers.length === 1
      ? accessibleMembers[0].name
      : `외 ${accessibleMembers.length}명`
  )}</title>
  <style>
    * { box-sizing: border-box; font-family: "Pretendard", -apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif; }
    body { margin: 0; padding: 28px; color: #0f172a; background: #f8fafc; }
    .toolbar { max-width: 820px; margin: 0 auto 16px; padding: 12px 16px; background: #0f172a; color: #fff; border-radius: 12px; display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
    .toolbar button { background: #00c458; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-weight: 800; cursor: pointer; font-size: 12px; }
    .page { max-width: 820px; margin: 0 auto 24px; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 36px; }
    .doc-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 22px; }
    .corp { font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; }
    h1 { margin: 0; font-size: 24px; font-weight: 800; }
    h1 span { font-size: 13px; font-weight: 600; color: #64748b; margin-left: 6px; }
    .meta { text-align: right; font-size: 11px; color: #64748b; line-height: 1.6; }
    .sec { margin-bottom: 20px; }
    .sec h3 { margin: 0 0 8px; font-size: 13px; font-weight: 800; color: #1e293b; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }
    th { background: #f8fafc; color: #475569; font-weight: 700; width: 120px; }
    @media print {
      body { background: #fff; padding: 0; }
      .toolbar { display: none !important; }
      .page { border: none; border-radius: 0; padding: 12mm; margin: 0; max-width: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span>🔒 보안 설정됨 (열람 비밀번호 지정 완료 · 대상 ${accessibleMembers.length}명) — 인쇄 대화상자에서 <b>PDF로 저장</b>을 선택하세요.</span>
    <button onclick="window.print()">PDF로 저장 / 인쇄</button>
  </div>
  ${memberPagesHtml}
  <script>setTimeout(() => { window.print(); }, 250);</script>
</body>
</html>`);
      popup.document.close();
      onClose();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-[70] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          if (sectionDropdownOpen) setSectionDropdownOpen(false);
        }}
        className="bg-white w-full max-w-[500px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-5 text-xs"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <h4 className="text-[19px] font-extrabold text-slate-900 tracking-tight">
            구성원 프로필 PDF 다운로드
          </h4>
          <div className="relative group">
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-sm font-bold"
            >
              ✕
            </button>
            <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2 py-1 rounded bg-slate-800 text-white text-[10px] font-bold whitespace-nowrap">
              닫기
            </span>
          </div>
        </div>

        {/* 다운로드 정보 * (멀티 태그 칩 선택) */}
        <div
          className="relative"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
            다운로드 정보 <span className="text-rose-500">*</span>
          </label>
          <div
            onClick={() => setSectionDropdownOpen((p) => !p)}
            className="min-h-[46px] p-2 pr-8 rounded-xl border border-slate-200 hover:border-slate-300 bg-white flex flex-wrap items-center gap-1.5 cursor-pointer relative"
          >
            {selectedSections.length === 0 ? (
              <span className="px-1.5 text-slate-400 text-[13px]">
                다운로드할 항목을 선택해주세요
              </span>
            ) : (
              selectedSections.map((sec) => (
                <span
                  key={sec}
                  onClick={(e) => e.stopPropagation()}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-[12px] font-semibold inline-flex items-center gap-1.5"
                >
                  <span>{sec}</span>
                  <button
                    type="button"
                    onClick={() => toggleSection(sec)}
                    className="text-slate-400 hover:text-slate-700 leading-none font-bold"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]">
              ▾
            </span>
          </div>

          {sectionDropdownOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-full rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 max-h-56 overflow-y-auto">
              <div className="px-3.5 py-1.5 border-b border-slate-100 flex items-center justify-between text-[11px]">
                <span className="text-slate-400 font-semibold">
                  포함할 프로필 섹션 선택
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedSections(
                      selectedSections.length === ALL_PDF_SECTIONS.length
                        ? []
                        : [...ALL_PDF_SECTIONS]
                    )
                  }
                  className="text-[#00a84b] font-bold hover:underline"
                >
                  {selectedSections.length === ALL_PDF_SECTIONS.length
                    ? "전체 해제"
                    : "전체 선택"}
                </button>
              </div>
              {ALL_PDF_SECTIONS.map((sec) => {
                const checked = selectedSections.includes(sec);
                return (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => toggleSection(sec)}
                    className="w-full px-3.5 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center justify-between font-medium text-slate-800"
                  >
                    <span>{sec}</span>
                    {checked && (
                      <span className="text-[#00c458] font-extrabold">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 파일 비밀번호 * */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-bold text-slate-600">
              파일 비밀번호 <span className="text-rose-500">*</span>
            </label>
            <span className="text-[11px] text-slate-400 font-mono">
              {password.length}/30
            </span>
          </div>
          <div className="h-[42px] rounded-xl border border-slate-200 focus-within:border-[#00c458] bg-white flex items-center px-3.5">
            <input
              type={showPassword ? "text" : "password"}
              maxLength={30}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="파일을 열 때, 사용할 비밀번호를 입력해주세요"
              className="flex-1 min-w-0 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((p) => !p)}
              className="ml-2 text-slate-400 hover:text-slate-600 shrink-0"
              title={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
            >
              {showPassword ? (
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
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              ) : (
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
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              )}
            </button>
          </div>
          <p
            className={`text-[11px] mt-1.5 ${
              password.length > 0 && !pwValid
                ? "text-rose-500 font-semibold"
                : "text-slate-400"
            }`}
          >
            영문 대소문자, 숫자, 기호 8자 이상
          </p>
        </div>

        {/* 사유 * */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-bold text-slate-600">
              사유 <span className="text-rose-500">*</span>
            </label>
            <span className="text-[11px] text-slate-400 font-mono">
              {reason.length}/50
            </span>
          </div>
          <textarea
            rows={3}
            maxLength={50}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="정보 보안을 위해 어떤 사유로 다운로드 받는지 기록해주세요."
            className="w-full p-3.5 rounded-xl border border-slate-200 focus:border-[#00c458] focus:outline-none text-[13px] text-slate-900 placeholder:text-slate-400 resize-none"
          />
        </div>

        {/* 다운로드 CTA */}
        <div className="space-y-2 pt-1">
          <button
            type="button"
            disabled={!canDownload}
            onClick={handleDownload}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00d42a] via-[#00c774] to-[#00b8b9] hover:brightness-95 text-white text-[13px] font-extrabold shadow-sm disabled:opacity-45 disabled:cursor-not-allowed transition-all"
          >
            {downloading ? "생성 중..." : "다운로드"}
          </button>
          <p className="text-center text-[11px] text-slate-400">
            조회 권한이 없는 구성원은 제외될 수 있어요.
          </p>
        </div>
      </div>
    </div>
  );
}
