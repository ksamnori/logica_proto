// src/components/hq/members/HqMemberHrRecordModals.tsx
"use client";

import React, { useMemo, useState } from "react";
import { DEFAULT_PAY_ITEMS } from "@/lib/hq/defaultPayrollSettings";
import type {
  HqAwardItem,
  HqDisciplineItem,
  HqLeaveHistoryItem,
  HqPayPaymentInfoItem,
  HqPayPaymentLineItem,
  HqPayrollPayItem,
  HqProfileExtra,
  HqWageContractItem,
} from "@/lib/hq/types";
import {
  AVG_WEEKS_PER_MONTH,
  computeInclusiveWageBreakdown,
  formatDotDateShort,
  formatFixedOvertimeSummary,
  makeContractId,
} from "./HqContractModals";

// ============================================================================
// 1. 공통 날짜 파서 · 달력 그리드 (단일 일자 & 기간 범위 선택)
// ============================================================================

function getTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function parseDateText(raw: string): string | null {
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

function buildMonthCells(year: number, month0: number) {
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

function InlineFieldError({ message }: { message?: string }) {
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

function SingleDatePickerPopover({
  value,
  onSelect,
  onReset,
  onClose,
}: {
  value: string;
  onSelect: (ymd: string) => void;
  onReset?: () => void;
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
    () => buildMonthCells(viewYear, viewMonth0),
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
      className="absolute left-0 top-full mt-1.5 w-[256px] rounded-2xl bg-white border border-slate-200 shadow-2xl p-3 z-50 text-xs"
    >
      <input
        autoFocus
        value={inputText}
        onChange={(e) => {
          setInputText(e.target.value);
          const p = parseDateText(e.target.value);
          if (p) {
            const dt = new Date(`${p}T00:00:00`);
            setViewYear(dt.getFullYear());
            setViewMonth0(dt.getMonth());
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const p = parseDateText(inputText);
            if (p) {
              onSelect(p);
              onClose();
            }
          }
        }}
        placeholder="날짜 입력 (예: 2026-11-19)"
        className="w-full px-3 py-2 rounded-lg border-2 border-[#00c458] text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none"
      />

      {value && onReset && (
        <div className="flex items-center justify-between pt-2 px-0.5 text-[11px]">
          <span className="text-slate-400">선택된 날짜</span>
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

function DateRangePickerPopover({
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
    () => buildMonthCells(viewYear, viewMonth0),
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
            const p = parseDateText(e.target.value);
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
            const p = parseDateText(e.target.value);
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

      {(startDate || endDate) && (
        <div className="flex items-center justify-between pt-2 px-0.5 text-[11px]">
          <span className="text-slate-400">단일 일자는 같은 날짜를 두 번 클릭하세요</span>
          <button
            type="button"
            onClick={() => {
              setStartInput("");
              setEndInput("");
              onChange("", "");
              onClose();
            }}
            className="text-slate-400 hover:text-slate-700 font-semibold shrink-0 ml-1"
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

// ============================================================================
// 2. 급여 지급 정보 추가하기 / 수정하기 모달 (Screenshot 12)
// ============================================================================

const SUPPLEMENTAL_PAY_CATALOG: HqPayrollPayItem[] = [
  {
    id: "pay-fixed-position",
    section: "FIXED",
    code: "A004",
    name: "직책수당",
    icon: "🎖️",
    description: "팀장·실장 등 직책 보유자에게 매월 고정 지급하는 수당",
    is_monthly_every: true,
    amount_mode: "PER_PERSON",
    include_in_annual_salary: true,
    is_tax_free: false,
    taxable_category: "급여",
    include_in_ordinary_wage: true,
    include_in_average_wage: true,
    prorate_policy: "입사·휴직·퇴직원 모두 일할 지급",
    unit_precision: "1의 단위",
    rounding_mode: "반올림",
    payslip_note: "",
  },
  {
    id: "pay-fixed-car",
    section: "FIXED",
    code: "A005",
    name: "자가운전보조금",
    icon: "🚗",
    description: "본인 차량 업무 운행 시 월 20만원 한도 비과세 수당",
    is_monthly_every: true,
    amount_mode: "UNIFORM",
    uniform_amount: 200000,
    include_in_annual_salary: false,
    is_tax_free: true,
    non_taxable_code: "H03",
    taxable_category: "기타수당",
    include_in_ordinary_wage: false,
    include_in_average_wage: true,
    prorate_policy: "입사·휴직·퇴직원 모두 일할 지급",
    unit_precision: "1의 단위",
    rounding_mode: "반올림",
    payslip_note: "",
  },
  {
    id: "pay-fixed-research",
    section: "FIXED",
    code: "A006",
    name: "연구보조비",
    icon: "🔬",
    description: "기업부설연구소 연구전담요원 월 20만원 한도 비과세",
    is_monthly_every: true,
    amount_mode: "UNIFORM",
    uniform_amount: 200000,
    include_in_annual_salary: true,
    is_tax_free: true,
    non_taxable_code: "H10",
    taxable_category: "기타수당",
    include_in_ordinary_wage: true,
    include_in_average_wage: true,
    prorate_policy: "입사·휴직·퇴직원 모두 일할 지급",
    unit_precision: "1의 단위",
    rounding_mode: "반올림",
    payslip_note: "",
  },
  {
    id: "pay-fixed-childcare",
    section: "FIXED",
    code: "A007",
    name: "자녀보육수당",
    icon: "👶",
    description: "6세 이하 자녀 보육수당 (월 20만원 비과세)",
    is_monthly_every: true,
    amount_mode: "PER_PERSON",
    include_in_annual_salary: false,
    is_tax_free: true,
    non_taxable_code: "Q02",
    taxable_category: "기타수당",
    include_in_ordinary_wage: false,
    include_in_average_wage: false,
    prorate_policy: "전액 지급",
    unit_precision: "1의 단위",
    rounding_mode: "반올림",
    payslip_note: "",
  },
  {
    id: "pay-selective-bonus",
    section: "FIXED",
    code: "B001",
    name: "정기상여금",
    icon: "🎉",
    description: "지정된 선택월에 지급하는 상여금 항목",
    is_monthly_every: false,
    selected_months: [1, 9],
    amount_mode: "PER_PERSON",
    include_in_annual_salary: false,
    is_tax_free: false,
    taxable_category: "기타상여금",
    include_in_ordinary_wage: false,
    include_in_average_wage: true,
    prorate_policy: "지급일 재직자 기준",
    unit_precision: "1의 단위",
    rounding_mode: "반올림",
    payslip_note: "",
  },
];

function inferMonthlyTaxFreeLimit(item: HqPayrollPayItem): number | undefined {
  if (!item.is_tax_free) return undefined;
  const code = item.non_taxable_code || "";
  if (["P01", "H03", "H10", "Q02", "H05", "H06", "H07", "H08", "H09", "H11", "H12", "H16"].includes(code)) {
    return 200000;
  }
  if (code === "M01") return 1000000;
  if (code === "M04") return 5000000;
  if (item.name.includes("식") || item.name.includes("운전") || item.name.includes("연구") || item.name.includes("보육")) {
    return 200000;
  }
  return undefined;
}

function payCatalogToLineItem(
  cat: HqPayrollPayItem,
  amount = 0
): HqPayPaymentLineItem {
  return {
    pay_item_id: cat.id,
    code: cat.code,
    name: cat.name,
    icon: cat.icon || "💰",
    is_monthly_every: cat.is_monthly_every !== false,
    selected_months:
      cat.is_monthly_every === false
        ? cat.selected_months && cat.selected_months.length > 0
          ? [...cat.selected_months]
          : [1, 9]
        : undefined,
    include_in_annual_salary: Boolean(cat.include_in_annual_salary),
    include_in_ordinary_wage: Boolean(cat.include_in_ordinary_wage),
    is_tax_free: Boolean(cat.is_tax_free),
    tax_free_monthly_limit: inferMonthlyTaxFreeLimit(cat),
    amount: Math.max(0, Math.round(amount)),
  };
}

export function resolvePayPaymentInfosList(
  ex?: HqProfileExtra
): HqPayPaymentInfoItem[] {
  if (Array.isArray(ex?.pay_payment_infos) && ex!.pay_payment_infos!.length > 0) {
    return ex!.pay_payment_infos!;
  }
  if (ex?.pay_payment_info && Array.isArray(ex.pay_payment_info.items)) {
    return [ex.pay_payment_info];
  }
  return [];
}

function findMatchingWageContractForDate(
  wageContracts: HqWageContractItem[],
  effectiveDate: string
): HqWageContractItem | null {
  if (!effectiveDate || wageContracts.length === 0) return null;
  const exact = wageContracts.find((wc) => {
    const s = wc.start_date || wc.effective_date || "";
    const e = wc.end_date || "";
    if (s && s > effectiveDate) return false;
    if (e && e < effectiveDate) return false;
    return true;
  });
  return exact || wageContracts[0] || null;
}

export function computePayPaymentSummary(
  items: HqPayPaymentLineItem[],
  weeklyWorkHours = 40
) {
  let annualInMonthlyEvery = 0;
  let annualInSelective = 0;
  let annualOutMonthlyEvery = 0;
  let annualOutSelective = 0;

  let monthlyInSalary = 0;
  let monthlyOutSalary = 0;

  let monthlyRegularTaxable = 0;
  let annualSelectiveTaxable = 0;
  let monthlyOrdinarySum = 0;

  for (const it of items) {
    const amt = Math.max(0, Math.round(Number(it.amount || 0)));
    const nonTaxPart = it.is_tax_free
      ? Math.min(amt, it.tax_free_monthly_limit ?? amt)
      : 0;
    const taxablePart = Math.max(0, amt - nonTaxPart);

    if (it.is_monthly_every) {
      if (it.include_in_annual_salary) {
        monthlyInSalary += amt;
        annualInMonthlyEvery += amt * 12;
      } else {
        monthlyOutSalary += amt;
        annualOutMonthlyEvery += amt * 12;
      }
      monthlyRegularTaxable += taxablePart;
      if (it.include_in_ordinary_wage) {
        monthlyOrdinarySum += amt;
      }
    } else {
      const monthCnt =
        it.selected_months && it.selected_months.length > 0
          ? it.selected_months.length
          : 1;
      const yrAmt = amt * monthCnt;
      if (it.include_in_annual_salary) {
        annualInSelective += yrAmt;
      } else {
        annualOutSelective += yrAmt;
      }
      annualSelectiveTaxable += taxablePart * monthCnt;
    }
  }

  const annualInTotal = annualInMonthlyEvery + annualInSelective;
  const annualOutTotal = annualOutMonthlyEvery + annualOutSelective;
  const annualTotal = annualInTotal + annualOutTotal;
  const monthlyTotal = monthlyInSalary + monthlyOutSalary;
  const monthlySelectiveTaxableAvg = Math.round(annualSelectiveTaxable / 12);
  const monthlyTaxableTotal = monthlyRegularTaxable + monthlySelectiveTaxableAvg;

  const regularMonthlyHours =
    weeklyWorkHours === 40
      ? 209
      : Math.max(1, Math.round(((weeklyWorkHours * 6) / 5) * AVG_WEEKS_PER_MONTH));

  const autoOrdinaryHourly =
    regularMonthlyHours > 0
      ? Math.round(monthlyOrdinarySum / regularMonthlyHours)
      : 0;

  return {
    annualTotal,
    annualInTotal,
    annualInMonthlyEvery,
    annualInSelective,
    annualOutTotal,
    annualOutMonthlyEvery,
    annualOutSelective,
    monthlyTotal,
    monthlyInSalary,
    monthlyOutSalary,
    monthlyTaxableTotal,
    monthlyRegularTaxable,
    monthlySelectiveTaxableAvg,
    autoOrdinaryHourly,
  };
}

export function HqPayPaymentInfoModal({
  mode,
  initialItem,
  wageContracts,
  companyPayItems,
  weeklyWorkHours = 40,
  saving,
  onOpenPayrollSettings,
  onClose,
  onSave,
  onDelete,
}: {
  mode: "create" | "edit";
  initialItem?: HqPayPaymentInfoItem | null;
  wageContracts: HqWageContractItem[];
  companyPayItems?: HqPayrollPayItem[];
  weeklyWorkHours?: number;
  saving: boolean;
  onOpenPayrollSettings?: () => void;
  onClose: () => void;
  onSave: (saved: HqPayPaymentInfoItem) => void;
  onDelete?: () => void;
}) {
  const catalog = useMemo(() => {
    const base =
      companyPayItems && companyPayItems.length > 0
        ? companyPayItems.filter((x) => x.section === "FIXED" || x.section === "HOURLY")
        : DEFAULT_PAY_ITEMS.filter((x) => x.section === "FIXED");
    const existingIds = new Set(base.map((b) => b.id));
    const existingNames = new Set(base.map((b) => b.name));
    const merged = [...base];
    for (const sup of SUPPLEMENTAL_PAY_CATALOG) {
      if (!existingIds.has(sup.id) && !existingNames.has(sup.name)) {
        merged.push(sup);
      }
    }
    return merged;
  }, [companyPayItems]);

  const defaultBaseCatalog =
    catalog.find((c) => c.id === "pay-fixed-base" || c.name === "기본급") ||
    DEFAULT_PAY_ITEMS[0];

  const [autoInput, setAutoInput] = useState<boolean>(
    initialItem ? Boolean(initialItem.auto_input) : true
  );
  const [effectiveDate, setEffectiveDate] = useState<string>(
    initialItem?.effective_date || ""
  );
  const [datePopOpen, setDatePopOpen] = useState(false);
  const [itemSelectorOpen, setItemSelectorOpen] = useState(false);

  const [lineItems, setLineItems] = useState<HqPayPaymentLineItem[]>(() => {
    if (initialItem?.items && initialItem.items.length > 0) {
      return initialItem.items.map((x) => ({ ...x }));
    }
    return [payCatalogToLineItem(defaultBaseCatalog, 0)];
  });

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingHourly, setEditingHourly] = useState(false);
  const [manualHourly, setManualHourly] = useState<number | null>(
    initialItem?.ordinary_hourly_manual ? initialItem.ordinary_hourly_wage : null
  );

  const matchedContract = useMemo(
    () => findMatchingWageContractForDate(wageContracts, effectiveDate),
    [wageContracts, effectiveDate]
  );

  // 자동 입력 적용 함수 (적용일 선택 시 또는 자동 입력 토글 ON 시 계약 금액 역산 반영)
  const applyAutoFillFromContract = (
    targetDate: string,
    currentItems: HqPayPaymentLineItem[]
  ) => {
    const matched = findMatchingWageContractForDate(wageContracts, targetDate);
    if (!matched) return currentItems;

    const amt =
      matched.contract_amount ??
      matched.annual_salary ??
      matched.monthly_base ??
      0;
    if (matched.income_type === "무보수" || amt <= 0) {
      return currentItems.map((it) => ({ ...it, amount: 0 }));
    }

    const next = currentItems.map((it) => ({ ...it }));
    const hasFixedOt = Boolean(
      matched.fixed_overtime?.enabled &&
        matched.fixed_overtime.total_contract_hours > 0
    );

    // 포괄계약 근로시간이 있는 경우 고정초과근무수당 항목 자동 추가
    const otCat = catalog.find(
      (c) => c.id === "pay-fixed-ot" || c.name.includes("고정초과")
    );
    if (
      hasFixedOt &&
      otCat &&
      !next.some((x) => x.pay_item_id === otCat.id || x.name.includes("고정초과"))
    ) {
      const insertIdx = Math.min(1, next.length);
      next.splice(insertIdx, 0, payCatalogToLineItem(otCat, 0));
    }

    // 식비 항목이 선택되어 있으면 식비 금액 파악하여 연봉 역산에 반영
    const mealLine = next.find(
      (x) => x.pay_item_id === "pay-fixed-meal" || x.name.includes("식")
    );
    if (mealLine && mealLine.amount === 0) {
      mealLine.amount = matched.meal_allowance ?? 200000;
    }
    const mealInSalary =
      mealLine && mealLine.include_in_annual_salary ? mealLine.amount : 0;

    // 기타 연봉포함 고정수당 합계 (기본급, 고정초과수당 제외)
    const otherInSalaryMonthly = next
      .filter(
        (x) =>
          x.is_monthly_every &&
          x.include_in_annual_salary &&
          x.pay_item_id !== "pay-fixed-base" &&
          x.name !== "기본급" &&
          x.pay_item_id !== "pay-fixed-ot" &&
          !x.name.includes("고정초과")
      )
      .reduce((s, x) => s + x.amount, 0);

    const calc = computeInclusiveWageBreakdown({
      incomeType: matched.income_type || "근로소득",
      amountUnit: matched.amount_unit || "연봉",
      contractAmount: amt,
      fixedOvertime: matched.fixed_overtime || null,
      weeklyWorkHours,
      mealAllowance: otherInSalaryMonthly > 0 ? otherInSalaryMonthly : mealInSalary,
    });

    return next.map((it) => {
      if (it.pay_item_id === "pay-fixed-base" || it.name === "기본급") {
        if (matched.amount_unit === "시급") {
          return { ...it, amount: amt };
        }
        return { ...it, amount: calc.monthlyBase };
      }
      if (it.pay_item_id === "pay-fixed-ot" || it.name.includes("고정초과")) {
        return { ...it, amount: calc.fixedOvertimeAllowance };
      }
      return it;
    });
  };

  const summary = useMemo(
    () => computePayPaymentSummary(lineItems, weeklyWorkHours),
    [lineItems, weeklyWorkHours]
  );

  const effectiveOrdinaryHourly =
    !autoInput && manualHourly !== null
      ? manualHourly
      : manualHourly !== null
        ? manualHourly
        : summary.autoOrdinaryHourly;

  const toggleCatalogItem = (cat: HqPayrollPayItem) => {
    if (cat.id === "pay-fixed-base" || cat.name === "기본급") return; // 기본급은 필수 유지
    const exists = lineItems.some((x) => x.pay_item_id === cat.id);
    let updated: HqPayPaymentLineItem[];
    if (exists) {
      updated = lineItems.filter((x) => x.pay_item_id !== cat.id);
    } else {
      const initAmt =
        cat.amount_mode === "UNIFORM" && cat.uniform_amount
          ? cat.uniform_amount
          : 0;
      updated = [...lineItems, payCatalogToLineItem(cat, initAmt)];
    }
    if (autoInput && effectiveDate) {
      updated = applyAutoFillFromContract(effectiveDate, updated);
      setManualHourly(null);
    }
    setLineItems(updated);
  };

  const handleSave = () => {
    const saved: HqPayPaymentInfoItem = {
      id: initialItem?.id || makeContractId("payinfo"),
      effective_date: effectiveDate,
      auto_input: autoInput,
      matched_wage_contract_id: matchedContract?.id,
      items: lineItems,
      ordinary_hourly_wage: effectiveOrdinaryHourly,
      ordinary_hourly_manual: manualHourly !== null,
      annual_total: summary.annualTotal,
      monthly_total: summary.monthlyTotal,
      monthly_taxable: summary.monthlyTaxableTotal,
    };
    onSave(saved);
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
          if (itemSelectorOpen) setItemSelectorOpen(false);
        }}
        className="bg-white w-full max-w-[780px] rounded-2xl shadow-2xl border border-slate-200 overflow-visible flex flex-col max-h-[92vh] text-xs relative"
      >
        {/* 우상단 자동 입력 토글 · 설정 · 닫기 바 */}
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-4 right-5 flex items-center gap-2.5 z-20"
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              role="switch"
              aria-checked={autoInput}
              onClick={() => {
                const nextAuto = !autoInput;
                setAutoInput(nextAuto);
                if (nextAuto && effectiveDate) {
                  setLineItems((prev) =>
                    applyAutoFillFromContract(effectiveDate, prev)
                  );
                  setManualHourly(null);
                }
              }}
              className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                autoInput ? "bg-[#00c458]" : "bg-slate-300"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                  autoInput ? "left-4.5" : "left-0.5"
                }`}
              />
            </button>
            <span className="text-[12px] font-bold text-slate-700 select-none">
              자동 입력
            </span>
          </div>

          {onOpenPayrollSettings && (
            <button
              type="button"
              onClick={onOpenPayrollSettings}
              className="w-7 h-7 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
              title="급여 지급 항목 설정 열기"
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
          )}

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

        {/* 2컬럼 본문 */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-y-auto md:overflow-visible">
          {/* 좌측: 지급 항목 설정 영역 */}
          <div className="flex-1 p-6 sm:p-7 space-y-5 md:overflow-y-auto custom-scroll">
            {/* 타이틀 + 적용일 칩 */}
            <div className="space-y-2.5 pr-28">
              <h4 className="text-[20px] font-extrabold text-slate-900 tracking-tight">
                {mode === "edit"
                  ? "급여 지급 정보 수정하기"
                  : "급여 지급 정보 추가하기"}
              </h4>

              <div
                className="relative inline-block"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setDatePopOpen((p) => !p)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                    effectiveDate
                      ? "bg-emerald-50 text-[#00a84b] border-emerald-200"
                      : "bg-[#fff5eb] text-[#e67e22] border-[#fde3c8] hover:bg-[#ffecd6]"
                  }`}
                >
                  {effectiveDate
                    ? `적용일 ${formatDotDateShort(effectiveDate)}`
                    : "적용일 없음"}
                </button>

                {datePopOpen && (
                  <SingleDatePickerPopover
                    value={effectiveDate}
                    onSelect={(ymd) => {
                      setEffectiveDate(ymd);
                      if (autoInput) {
                        setLineItems((prev) =>
                          applyAutoFillFromContract(ymd, prev)
                        );
                        setManualHourly(null);
                      }
                    }}
                    onReset={() => setEffectiveDate("")}
                    onClose={() => setDatePopOpen(false)}
                  />
                )}
              </div>
            </div>

            {/* 해당 시점 계약 금액 안내 박스 */}
            <div className="rounded-xl bg-slate-50 px-4 py-3.5 text-[12px]">
              {!effectiveDate ? (
                <span className="text-slate-400 font-medium">
                  적용일을 선택하면, 해당 시점의 계약 금액이 표시돼요.
                </span>
              ) : matchedContract ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600 text-[11px] font-bold">
                      {matchedContract.income_type || "근로소득"}
                    </span>
                    <span className="font-extrabold text-slate-900">
                      {matchedContract.income_type === "무보수"
                        ? "무보수"
                        : `${matchedContract.amount_unit || "연봉"} ${Number(
                            matchedContract.contract_amount ??
                              matchedContract.annual_salary ??
                              0
                          ).toLocaleString()}원`}
                    </span>
                    {matchedContract.fixed_overtime?.enabled && (
                      <span className="text-[11px] font-bold text-[#00a84b]">
                        · 포괄{" "}
                        {formatFixedOvertimeSummary(
                          matchedContract.fixed_overtime
                        )}
                      </span>
                    )}
                  </div>
                  {autoInput && (
                    <span className="text-[11px] font-semibold text-[#00a84b]">
                      자동 입력 반영됨
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-slate-500">
                  선택한 적용일 기준 등록된 임금 계약이 없어요. 아래 항목에서 직접 금액을 입력할 수 있어요.
                </span>
              )}
            </div>

            {/* 지급 항목 리스트 헤더 + 항목 선택 버튼 */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <h5 className="text-[15px] font-extrabold text-slate-900">
                  지급 항목
                </h5>
                <div
                  className="relative"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setItemSelectorOpen((p) => !p)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-[12px] font-bold flex items-center gap-1.5"
                  >
                    <span className="text-slate-400">⊶</span>
                    <span>항목 선택</span>
                  </button>

                  {itemSelectorOpen && (
                    <div className="absolute right-0 top-full mt-1.5 w-[260px] rounded-xl bg-white border border-slate-200 shadow-2xl py-2 z-40 max-h-64 overflow-y-auto">
                      <div className="px-3.5 pb-1.5 mb-1 border-b border-slate-100 text-[11px] font-bold text-slate-400">
                        지급 항목 추가 · 제거
                      </div>
                      {catalog.map((cat) => {
                        const isBase =
                          cat.id === "pay-fixed-base" || cat.name === "기본급";
                        const checked = lineItems.some(
                          (x) => x.pay_item_id === cat.id
                        );
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            disabled={isBase}
                            onClick={() => toggleCatalogItem(cat)}
                            className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center justify-between gap-2 disabled:opacity-60"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span>{cat.icon || "💰"}</span>
                              <span className="font-semibold text-slate-800 truncate">
                                {cat.name}
                              </span>
                              {cat.is_tax_free && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[#00a84b] text-[10px] font-bold shrink-0">
                                  비과세
                                </span>
                              )}
                            </div>
                            {checked && (
                              <span className="text-[#00c458] font-extrabold">
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

              {/* 선택된 지급 항목 카드들 */}
              <div className="space-y-2.5">
                {lineItems.map((it) => {
                  const isEditing = editingItemId === it.pay_item_id;
                  return (
                    <div
                      key={it.pay_item_id}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 space-y-2 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          <span className="text-sm select-none">{it.icon}</span>
                          <span className="text-[13px] font-extrabold text-slate-900 mr-1">
                            {it.name}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              it.is_monthly_every
                                ? "bg-blue-50 text-blue-600"
                                : "bg-purple-50 text-purple-600"
                            }`}
                          >
                            {it.is_monthly_every ? "월고정" : "선택월"}
                          </span>
                          {it.include_in_ordinary_wage && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                              통상
                            </span>
                          )}
                          <span
                            onClick={() => {
                              if (
                                it.pay_item_id === "pay-fixed-base" ||
                                it.name === "기본급"
                              ) {
                                return;
                              }
                              setLineItems((prev) =>
                                prev.map((row) =>
                                  row.pay_item_id === it.pay_item_id
                                    ? {
                                        ...row,
                                        include_in_annual_salary:
                                          !row.include_in_annual_salary,
                                      }
                                    : row
                                )
                              );
                            }}
                            title={
                              it.pay_item_id === "pay-fixed-base"
                                ? "기본급은 연봉포함 항목입니다"
                                : "클릭하여 연봉포함 / 연봉외 전환"
                            }
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              it.pay_item_id !== "pay-fixed-base"
                                ? "cursor-pointer"
                                : ""
                            } ${
                              it.include_in_annual_salary
                                ? "bg-slate-100 text-slate-600"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {it.include_in_annual_salary ? "연봉포함" : "연봉외"}
                          </span>
                          {it.is_tax_free && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[#00a84b] text-[10px] font-bold">
                              비과세
                            </span>
                          )}
                        </div>

                        {isEditing ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              autoFocus
                              type="text"
                              inputMode="numeric"
                              value={
                                it.amount > 0
                                  ? it.amount.toLocaleString("ko-KR")
                                  : ""
                              }
                              onChange={(e) => {
                                const val = Number(
                                  e.target.value.replace(/[^0-9]/g, "") || 0
                                );
                                setLineItems((prev) =>
                                  prev.map((row) =>
                                    row.pay_item_id === it.pay_item_id
                                      ? { ...row, amount: val }
                                      : row
                                  )
                                );
                              }}
                              onBlur={() => setEditingItemId(null)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") setEditingItemId(null);
                              }}
                              placeholder="0"
                              className="w-28 px-2.5 py-1 rounded-lg border-2 border-[#00c458] text-right text-[13px] font-extrabold text-slate-900 focus:outline-none"
                            />
                            <span className="text-slate-500 font-bold">원</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingItemId(it.pay_item_id)}
                            className="flex items-center gap-1.5 text-[13px] shrink-0 group"
                          >
                            <span
                              className={
                                it.amount > 0
                                  ? "font-extrabold text-slate-900"
                                  : "font-semibold text-slate-500 group-hover:text-slate-800"
                              }
                            >
                              {it.amount > 0
                                ? `${it.amount.toLocaleString("ko-KR")}원`
                                : "금액 입력"}
                            </span>
                            <span className="text-slate-300 group-hover:text-slate-500 text-xs">
                              ✎
                            </span>
                          </button>
                        )}
                      </div>

                      {/* 선택월 항목일 때 월 선택 칩 */}
                      {!it.is_monthly_every && (
                        <div className="pt-1.5 border-t border-slate-100 flex flex-wrap items-center gap-1">
                          <span className="text-[10px] text-slate-400 font-semibold mr-1">
                            지급월:
                          </span>
                          {Array.from({ length: 12 }, (_, idx) => idx + 1).map(
                            (m) => {
                              const active = (
                                it.selected_months || []
                              ).includes(m);
                              return (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => {
                                    setLineItems((prev) =>
                                      prev.map((row) => {
                                        if (row.pay_item_id !== it.pay_item_id)
                                          return row;
                                        const cur = row.selected_months || [];
                                        const nextMonths = cur.includes(m)
                                          ? cur.filter((x) => x !== m)
                                          : [...cur, m].sort((a, b) => a - b);
                                        return {
                                          ...row,
                                          selected_months:
                                            nextMonths.length > 0
                                              ? nextMonths
                                              : [m],
                                        };
                                      })
                                    );
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                    active
                                      ? "bg-purple-600 text-white"
                                      : "bg-slate-100 text-slate-400 hover:text-slate-700"
                                  }`}
                                >
                                  {m}월
                                </button>
                              );
                            }
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-slate-100 my-3" />

              {/* 통상시급 카드 */}
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-200 text-white text-[10px] font-extrabold flex items-center justify-center select-none">
                    ₩
                  </span>
                  <span className="text-[13px] font-extrabold text-slate-900">
                    통상시급
                  </span>
                  {manualHourly !== null && (
                    <button
                      type="button"
                      onClick={() => setManualHourly(null)}
                      className="text-[10px] text-slate-400 hover:text-[#00a84b] underline"
                    >
                      자동 계산으로 복원
                    </button>
                  )}
                </div>

                {editingHourly ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      autoFocus
                      type="text"
                      inputMode="numeric"
                      value={
                        effectiveOrdinaryHourly > 0
                          ? effectiveOrdinaryHourly.toLocaleString("ko-KR")
                          : ""
                      }
                      onChange={(e) => {
                        const val = Number(
                          e.target.value.replace(/[^0-9]/g, "") || 0
                        );
                        setManualHourly(val);
                      }}
                      onBlur={() => setEditingHourly(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setEditingHourly(false);
                      }}
                      placeholder="0"
                      className="w-28 px-2.5 py-1 rounded-lg border-2 border-[#00c458] text-right text-[13px] font-extrabold text-slate-900 focus:outline-none"
                    />
                    <span className="text-slate-500 font-bold">원</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingHourly(true)}
                    className="flex items-center gap-1.5 text-[13px] shrink-0 group"
                  >
                    <span
                      className={
                        effectiveOrdinaryHourly > 0
                          ? "font-extrabold text-slate-900"
                          : "font-semibold text-slate-500 group-hover:text-slate-800"
                      }
                    >
                      {effectiveOrdinaryHourly > 0
                        ? `${effectiveOrdinaryHourly.toLocaleString("ko-KR")}원`
                        : "금액 입력"}
                    </span>
                    <span className="text-slate-300 group-hover:text-slate-500 text-xs">
                      ✎
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 우측: 연간 지급액 / 월 지급액 / 월 과세액 요약 패널 */}
          <aside className="w-full md:w-[270px] border-t md:border-t-0 md:border-l border-slate-100 px-6 pt-14 pb-6 bg-slate-50/25 flex flex-col justify-between shrink-0 gap-6">
            <div className="space-y-4 text-[12px]">
              {/* 1. 연간 지급액 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between font-extrabold text-slate-900 text-[13px]">
                  <span>연간 지급액</span>
                  <span>{summary.annualTotal.toLocaleString("ko-KR")}원</span>
                </div>
                <div className="space-y-1 text-slate-500 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span>연봉 포함 항목</span>
                    <span>{summary.annualInTotal.toLocaleString("ko-KR")}원</span>
                  </div>
                  <div className="flex items-center justify-between pl-2.5 text-slate-400">
                    <span>↳ 매월</span>
                    <span>
                      {summary.annualInMonthlyEvery.toLocaleString("ko-KR")}원
                    </span>
                  </div>
                  <div className="flex items-center justify-between pl-5 text-slate-400">
                    <span>선택월</span>
                    <span>
                      {summary.annualInSelective.toLocaleString("ko-KR")}원
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span>연봉 외 항목</span>
                    <span>
                      {summary.annualOutTotal.toLocaleString("ko-KR")}원
                    </span>
                  </div>
                  <div className="flex items-center justify-between pl-2.5 text-slate-400">
                    <span>↳ 매월</span>
                    <span>
                      {summary.annualOutMonthlyEvery.toLocaleString("ko-KR")}원
                    </span>
                  </div>
                  <div className="flex items-center justify-between pl-5 text-slate-400">
                    <span>선택월</span>
                    <span>
                      {summary.annualOutSelective.toLocaleString("ko-KR")}원
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100" />

              {/* 2. 월 지급액 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between font-extrabold text-slate-900 text-[13px]">
                  <span className="inline-flex items-center gap-1">
                    <span>월 지급액</span>
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-slate-300 text-slate-400 text-[9px] inline-flex items-center justify-center font-semibold cursor-help"
                      title="매월 고정으로 지급되는 연봉 포함 및 연봉 외 항목의 월 합계입니다."
                    >
                      i
                    </span>
                  </span>
                  <span>{summary.monthlyTotal.toLocaleString("ko-KR")}원</span>
                </div>
                <div className="space-y-1 text-slate-500 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span>연봉 포함 항목</span>
                    <span>
                      {summary.monthlyInSalary.toLocaleString("ko-KR")}원
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>연봉 외 항목</span>
                    <span>
                      {summary.monthlyOutSalary.toLocaleString("ko-KR")}원
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100" />

              {/* 3. 월 과세액 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between font-extrabold text-slate-900 text-[13px]">
                  <span>월 과세액</span>
                  <span>
                    {summary.monthlyTaxableTotal.toLocaleString("ko-KR")}원
                  </span>
                </div>
                <div className="space-y-1 text-slate-500 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span>매월</span>
                    <span>
                      {summary.monthlyRegularTaxable.toLocaleString("ko-KR")}원
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>선택월</span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">
                        평균
                      </span>
                      <span>
                        {summary.monthlySelectiveTaxableAvg.toLocaleString(
                          "ko-KR"
                        )}
                        원
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 우하단 저장/삭제 CTA */}
            <div className="space-y-2">
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00d42a] via-[#00c774] to-[#00b8b9] hover:brightness-95 text-white text-[13px] font-extrabold shadow-sm disabled:opacity-50 transition-all"
              >
                {saving
                  ? "저장 중..."
                  : mode === "edit"
                    ? "저장하기"
                    : "추가하기"}
              </button>
              {mode === "edit" && onDelete && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={onDelete}
                  className="w-full py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-[12px]"
                >
                  지급 정보 삭제
                </button>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 3. 휴직 등록하기 / 수정하기 모달 (Screenshots 3 ~ 6)
// ============================================================================

export const FLEX_LEAVE_OF_ABSENCE_TYPES = [
  "일반휴직",
  "일반 육아휴직",
  "단기 육아휴직",
  "산재휴직",
  "부상·질병휴직",
  "가족돌봄휴직",
  "무급노조전임자 휴직",
];

export function HqLeaveHistoryModal({
  mode,
  initialItem,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  mode: "create" | "edit";
  initialItem?: HqLeaveHistoryItem | null;
  saving: boolean;
  onClose: () => void;
  onSave: (saved: HqLeaveHistoryItem) => void;
  onDelete?: () => void;
}) {
  const [leaveKind, setLeaveKind] = useState(initialItem?.leave_kind || "");
  const [startDate, setStartDate] = useState(initialItem?.start_date || "");
  const [endDate, setEndDate] = useState(initialItem?.end_date || "");
  const [includeInTenure, setIncludeInTenure] = useState<boolean>(
    initialItem?.include_in_tenure !== false
  );
  const [payRateStr, setPayRateStr] = useState<string>(
    initialItem?.salary_pay_rate !== undefined &&
      initialItem?.salary_pay_rate !== null
      ? String(initialItem.salary_pay_rate)
      : mode === "edit"
        ? "0"
        : ""
  );
  const [memo, setMemo] = useState(
    initialItem?.memo ?? initialItem?.reason ?? ""
  );

  const [kindDropdownOpen, setKindDropdownOpen] = useState(false);
  const [rangePopOpen, setRangePopOpen] = useState(false);
  const [errors, setErrors] = useState<{
    kind?: string;
    period?: string;
    payRate?: string;
  }>({});

  const periodLabel = useMemo(() => {
    if (startDate && endDate) {
      return `${formatDotDateShort(startDate)} ~ ${formatDotDateShort(endDate)}`;
    }
    if (startDate) return `${formatDotDateShort(startDate)} ~`;
    return "";
  }, [startDate, endDate]);

  const handleSubmit = () => {
    const nextErr: { kind?: string; period?: string; payRate?: string } = {};
    if (!leaveKind.trim()) {
      nextErr.kind = "휴직 종류를 선택해 주세요.";
    }
    if (!startDate) {
      nextErr.period = "휴직 기간을 선택해 주세요.";
    }
    if (payRateStr.trim() === "") {
      nextErr.payRate = "급여지급률을 입력해 주세요.";
    }
    if (Object.keys(nextErr).length > 0) {
      setErrors(nextErr);
      return;
    }

    const rateNum = Math.min(
      100,
      Math.max(0, Number(payRateStr.replace(/[^0-9.]/g, "") || 0))
    );

    onSave({
      id: initialItem?.id || makeContractId("lvh"),
      leave_kind: leaveKind,
      start_date: startDate,
      end_date: endDate,
      include_in_tenure: includeInTenure,
      salary_pay_rate: rateNum,
      memo: memo.trim(),
      reason: memo.trim(),
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
          if (kindDropdownOpen) setKindDropdownOpen(false);
          if (rangePopOpen) setRangePopOpen(false);
        }}
        className="bg-white w-full max-w-[460px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-4 text-xs overflow-visible"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between pb-1">
          <h4 className="text-[19px] font-extrabold text-slate-900 tracking-tight">
            {mode === "edit" ? "휴직 정보 수정하기" : "휴직 등록하기"}
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

        {/* 1. 휴직 종류 * */}
        <div
          className="relative"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label
            className={`block text-[11px] font-bold mb-1.5 ${
              errors.kind ? "text-[#e05246]" : "text-slate-600"
            }`}
          >
            휴직 종류 <span className="text-rose-500">*</span>
          </label>
          <button
            type="button"
            onClick={() => setKindDropdownOpen((p) => !p)}
            className={`w-full h-[42px] px-3.5 rounded-xl border flex items-center justify-between text-[13px] transition-colors ${
              errors.kind
                ? "border-[#e05246] bg-[#fff8f7]"
                : "border-slate-200 hover:border-slate-300 bg-slate-50/40"
            }`}
          >
            <span
              className={
                leaveKind
                  ? "font-semibold text-slate-900"
                  : "text-slate-400 font-normal"
              }
            >
              {leaveKind || "휴직 선택"}
            </span>
            <span className="text-slate-400 text-[11px]">▾</span>
          </button>
          <InlineFieldError message={errors.kind} />

          {kindDropdownOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-[230px] rounded-xl bg-white border border-slate-200 shadow-2xl py-1.5 z-40">
              {FLEX_LEAVE_OF_ABSENCE_TYPES.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setLeaveKind(k);
                    setErrors((prev) => ({ ...prev, kind: undefined }));
                    // 일반휴직·부상질병 외 법정 육아·산재·가족돌봄휴직은 근속기간 포함 기본값
                    if (k === "일반휴직") {
                      setIncludeInTenure(false);
                    } else {
                      setIncludeInTenure(true);
                    }
                    setKindDropdownOpen(false);
                  }}
                  className="w-full px-3.5 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-800"
                >
                  <span>{k}</span>
                  {leaveKind === k && (
                    <span className="text-[#00c458] font-extrabold">✓</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 2. 휴직 기간 * | 근속기간 포함 * */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div
            className="sm:col-span-7 relative"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <label
              className={`block text-[11px] font-bold mb-1.5 ${
                errors.period ? "text-[#e05246]" : "text-slate-600"
              }`}
            >
              휴직 기간 <span className="text-rose-500">*</span>
            </label>
            <button
              type="button"
              onClick={() => setRangePopOpen((p) => !p)}
              className={`w-full h-[42px] px-3.5 rounded-xl border flex items-center justify-between text-[13px] transition-colors ${
                errors.period
                  ? "border-[#e05246] bg-[#fff8f7]"
                  : "border-slate-200 hover:border-slate-300 bg-slate-50/40"
              }`}
            >
              <span
                className={
                  periodLabel
                    ? "font-semibold text-slate-900 truncate"
                    : "text-slate-400"
                }
              >
                {periodLabel || "기간 선택"}
              </span>
              <span className="text-slate-400 text-[11px] ml-1 shrink-0">▾</span>
            </button>
            <InlineFieldError message={errors.period} />

            {rangePopOpen && (
              <DateRangePickerPopover
                startDate={startDate}
                endDate={endDate}
                onChange={(s, e) => {
                  setStartDate(s);
                  setEndDate(e);
                  if (s) {
                    setErrors((prev) => ({ ...prev, period: undefined }));
                  }
                }}
                onClose={() => setRangePopOpen(false)}
              />
            )}
          </div>

          <div className="sm:col-span-5">
            <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 mb-1.5">
              <span>
                근속기간 포함 <span className="text-rose-500">*</span>
              </span>
              <span
                className="w-3.5 h-3.5 rounded-full border border-slate-300 text-slate-400 text-[9px] inline-flex items-center justify-center cursor-help"
                title="근속연수 및 퇴직금 산정 기간에 휴직 기간을 포함할지 여부입니다."
              >
                ?
              </span>
            </label>
            <div className="h-[42px] p-1 rounded-xl bg-slate-100 grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setIncludeInTenure(true)}
                className={`rounded-lg text-[12px] font-bold transition-all ${
                  includeInTenure
                    ? "bg-white text-slate-900 shadow-2xs border border-slate-200/70"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                포함
              </button>
              <button
                type="button"
                onClick={() => setIncludeInTenure(false)}
                className={`rounded-lg text-[12px] font-bold transition-all ${
                  !includeInTenure
                    ? "bg-white text-slate-900 shadow-2xs border border-slate-200/70"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                미포함
              </button>
            </div>
          </div>
        </div>

        {/* 3. 급여지급률 * */}
        <div>
          <label
            className={`block text-[11px] font-bold mb-1.5 ${
              errors.payRate ? "text-[#e05246]" : "text-slate-600"
            }`}
          >
            급여지급률 <span className="text-rose-500">*</span>
          </label>
          <div
            className={`h-[42px] px-3.5 rounded-xl border flex items-center bg-white transition-colors ${
              errors.payRate
                ? "border-[#e05246] bg-[#fff8f7]"
                : "border-slate-200 focus-within:border-[#00c458]"
            }`}
          >
            <input
              type="text"
              inputMode="decimal"
              value={payRateStr}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/[^0-9.]/g, "").slice(0, 5);
                setPayRateStr(cleaned);
                if (cleaned !== "") {
                  setErrors((prev) => ({ ...prev, payRate: undefined }));
                }
              }}
              placeholder="지급률 입력 (기본급 기준)"
              className="flex-1 min-w-0 text-[13px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none bg-transparent"
            />
            <span className="text-slate-500 font-bold text-[12px] ml-2 shrink-0">
              %
            </span>
          </div>
          <InlineFieldError message={errors.payRate} />
        </div>

        {/* 4. 메모 (🔒 인사 권한자만 볼 수 있어요.) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-bold text-slate-600">메모</label>
            <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
              <svg
                className="w-3 h-3 text-slate-400"
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
              <span>인사 권한자만 볼 수 있어요.</span>
            </span>
          </div>
          <textarea
            rows={3}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모 입력"
            className="w-full p-3.5 rounded-xl border border-slate-200 bg-slate-50/40 focus:bg-white focus:border-[#00c458] focus:outline-none text-[13px] text-slate-800 placeholder:text-slate-400 resize-none"
          />
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
            {saving
              ? "저장 중..."
              : mode === "edit"
                ? "저장하기"
                : "휴직 등록하기"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 4. 수상 추가하기 / 수정하기 모달 (Screenshot 7)
// ============================================================================

export function HqAwardModal({
  mode,
  initialItem,
  companyName = "(주)천종현수학연구소",
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  mode: "create" | "edit";
  initialItem?: HqAwardItem | null;
  companyName?: string;
  saving: boolean;
  onClose: () => void;
  onSave: (saved: HqAwardItem) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(initialItem?.title || "");
  const [awardedDate, setAwardedDate] = useState(
    initialItem?.awarded_date || ""
  );
  const [issuerType, setIssuerType] = useState<"사내 수상" | "사외 수상">(
    initialItem?.issuer_type ||
      (initialItem?.issuer && initialItem.issuer !== companyName
        ? "사외 수상"
        : "사내 수상")
  );
  const [issuer, setIssuer] = useState(
    initialItem?.issuer ?? companyName
  );
  const [note, setNote] = useState(initialItem?.note || "");

  const [datePopOpen, setDatePopOpen] = useState(false);
  const [issuerMenuOpen, setIssuerMenuOpen] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; date?: string }>({});

  const handleSubmit = () => {
    const nextErr: { title?: string; date?: string } = {};
    if (!title.trim()) nextErr.title = "이름을 입력해주세요.";
    if (!awardedDate) nextErr.date = "일자를 선택해주세요.";
    if (Object.keys(nextErr).length > 0) {
      setErrors(nextErr);
      return;
    }

    onSave({
      id: initialItem?.id || makeContractId("awd"),
      title: title.trim(),
      awarded_date: awardedDate,
      issuer_type: issuerType,
      issuer: issuer.trim() || (issuerType === "사내 수상" ? companyName : ""),
      note: note.trim(),
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
          if (issuerMenuOpen) setIssuerMenuOpen(false);
        }}
        className="bg-white w-full max-w-[460px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-4 text-xs overflow-visible"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between pb-1">
          <h4 className="text-[19px] font-extrabold text-slate-900 tracking-tight">
            {mode === "edit" ? "수상 정보 수정하기" : "수상 추가하기"}
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

        {/* 1. 이름 * */}
        <div>
          <label
            className={`block text-[11px] font-bold mb-1.5 ${
              errors.title ? "text-[#e05246]" : "text-slate-600"
            }`}
          >
            이름 <span className="text-rose-500">*</span>
          </label>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (e.target.value.trim()) {
                setErrors((prev) => ({ ...prev, title: undefined }));
              }
            }}
            placeholder="이름 입력"
            className={`w-full h-[42px] px-3.5 rounded-xl border text-[13px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none ${
              errors.title
                ? "border-[#e05246] bg-[#fff8f7]"
                : "border-slate-200 bg-slate-50/40 focus:bg-white focus:border-[#00c458]"
            }`}
          />
          <InlineFieldError message={errors.title} />
        </div>

        {/* 2. 일자 * */}
        <div
          className="relative"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label
            className={`block text-[11px] font-bold mb-1.5 ${
              errors.date ? "text-[#e05246]" : "text-slate-600"
            }`}
          >
            일자 <span className="text-rose-500">*</span>
          </label>
          <button
            type="button"
            onClick={() => setDatePopOpen((p) => !p)}
            className={`w-full h-[42px] px-3.5 rounded-xl border flex items-center justify-between text-[13px] transition-colors ${
              errors.date
                ? "border-[#e05246] bg-[#fff8f7]"
                : "border-slate-200 hover:border-slate-300 bg-slate-50/40"
            }`}
          >
            <span
              className={
                awardedDate
                  ? "font-semibold text-slate-900"
                  : "text-slate-400"
              }
            >
              {awardedDate ? formatDotDateShort(awardedDate) : "날짜 선택"}
            </span>
            <span className="text-slate-400 text-[11px]">▾</span>
          </button>
          <InlineFieldError message={errors.date} />

          {datePopOpen && (
            <SingleDatePickerPopover
              value={awardedDate}
              onSelect={(ymd) => {
                setAwardedDate(ymd);
                setErrors((prev) => ({ ...prev, date: undefined }));
              }}
              onReset={() => setAwardedDate("")}
              onClose={() => setDatePopOpen(false)}
            />
          )}
        </div>

        {/* 3. 수여기관 ([사내 수상 ▾] | 기관명 입력) */}
        <div
          className="relative"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
            수여기관
          </label>
          <div className="h-[42px] px-2 rounded-xl border border-slate-200 focus-within:border-[#00c458] bg-slate-50/40 focus-within:bg-white flex items-center gap-2">
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setIssuerMenuOpen((p) => !p)}
                className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-[11px] font-bold text-slate-700 flex items-center gap-1 shadow-2xs"
              >
                <span>{issuerType}</span>
                <span className="text-slate-400 text-[9px]">▾</span>
              </button>

              {issuerMenuOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-[124px] rounded-xl bg-white border border-slate-200 shadow-xl py-1 z-40">
                  {(["사내 수상", "사외 수상"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        setIssuerType(opt);
                        if (opt === "사내 수상") {
                          setIssuer(companyName);
                        } else if (issuer === companyName) {
                          setIssuer("");
                        }
                        setIssuerMenuOpen(false);
                      }}
                      className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-800"
                    >
                      <span>{opt}</span>
                      {issuerType === opt && (
                        <span className="text-[#00c458] font-extrabold">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <input
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder={
                issuerType === "사내 수상" ? companyName : "수여기관 입력"
              }
              className="flex-1 min-w-0 pr-2 text-[13px] font-semibold text-slate-800 placeholder:text-slate-400 placeholder:font-normal focus:outline-none bg-transparent"
            />
          </div>
        </div>

        {/* 4. 메모 (0/500) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-bold text-slate-600">메모</label>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-mono font-bold">
              {note.length}/500
            </span>
          </div>
          <textarea
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="사유 또는 메모 입력"
            className="w-full p-3.5 rounded-xl border border-slate-200 bg-slate-50/40 focus:bg-white focus:border-[#00c458] focus:outline-none text-[13px] text-slate-800 placeholder:text-slate-400 resize-none"
          />
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
// 5. 징계 추가하기 / 수정하기 모달 (Screenshots 8 ~ 10)
// ============================================================================

export const DEFAULT_DISCIPLINE_KINDS = [
  "감봉",
  "강등",
  "견책",
  "경고",
  "정직",
  "해고",
];

export function HqDisciplineModal({
  mode,
  initialItem,
  customKinds = [],
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  mode: "create" | "edit";
  initialItem?: HqDisciplineItem | null;
  customKinds?: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (saved: HqDisciplineItem) => void;
  onDelete?: () => void;
}) {
  const [kind, setKind] = useState(initialItem?.kind || "");
  const [startDate, setStartDate] = useState(initialItem?.action_date || "");
  const [endDate, setEndDate] = useState(
    initialItem?.end_date || initialItem?.action_date || ""
  );
  const [reason, setReason] = useState(initialItem?.reason || "");

  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  const [kindSearch, setKindSearch] = useState("");
  const [extraAddedKinds, setExtraAddedKinds] = useState<string[]>([]);
  const [rangePopOpen, setRangePopOpen] = useState(false);
  const [errors, setErrors] = useState<{ kind?: string; period?: string }>({});

  const allKinds = useMemo(() => {
    const set = new Set<string>([
      ...DEFAULT_DISCIPLINE_KINDS,
      ...customKinds,
      ...extraAddedKinds,
    ]);
    if (kind) set.add(kind);
    return Array.from(set);
  }, [customKinds, extraAddedKinds, kind]);

  const filteredKinds = useMemo(() => {
    const q = kindSearch.trim().toLowerCase();
    if (!q) return allKinds;
    return allKinds.filter((x) => x.toLowerCase().includes(q));
  }, [allKinds, kindSearch]);

  const canCreateCustomKind =
    kindSearch.trim().length > 0 &&
    !allKinds.some(
      (x) => x.toLowerCase() === kindSearch.trim().toLowerCase()
    );

  const periodText = useMemo(() => {
    if (startDate && endDate && startDate !== endDate) {
      return `${formatDotDateShort(startDate)} ~ ${formatDotDateShort(endDate)}`;
    }
    if (startDate) return formatDotDateShort(startDate);
    return "";
  }, [startDate, endDate]);

  const handleSubmit = () => {
    const nextErr: { kind?: string; period?: string } = {};
    if (!kind.trim()) nextErr.kind = "징계 종류를 선택해주세요.";
    if (!startDate) nextErr.period = "기간을 선택해주세요.";
    if (Object.keys(nextErr).length > 0) {
      setErrors(nextErr);
      return;
    }

    onSave({
      id: initialItem?.id || makeContractId("dsc"),
      kind: kind.trim(),
      action_date: startDate,
      end_date: endDate || startDate,
      reason: reason.trim(),
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
          if (kindMenuOpen) setKindMenuOpen(false);
          if (rangePopOpen) setRangePopOpen(false);
        }}
        className="bg-white w-full max-w-[460px] rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-4 text-xs overflow-visible"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between pb-1">
          <h4 className="text-[19px] font-extrabold text-slate-900 tracking-tight">
            {mode === "edit" ? "징계 정보 수정하기" : "징계 추가하기"}
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

        {/* 1. 종류 * (검색 또는 추가하기 드롭다운 — Screenshot 9) */}
        <div
          className="relative"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label
            className={`block text-[11px] font-bold mb-1.5 ${
              errors.kind ? "text-[#e05246]" : "text-slate-600"
            }`}
          >
            종류 <span className="text-rose-500">*</span>
          </label>
          <button
            type="button"
            onClick={() => setKindMenuOpen((p) => !p)}
            className={`w-full h-[42px] px-3.5 rounded-xl border flex items-center justify-between text-[13px] transition-colors ${
              errors.kind
                ? "border-[#e05246] bg-[#fff8f7]"
                : "border-slate-200 hover:border-slate-300 bg-slate-50/40"
            }`}
          >
            <span
              className={
                kind ? "font-semibold text-slate-900" : "text-slate-400"
              }
            >
              {kind || "징계 종류 선택"}
            </span>
            <span className="text-slate-400 text-[11px]">▾</span>
          </button>
          <InlineFieldError message={errors.kind} />

          {kindMenuOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-[240px] rounded-xl bg-white border border-slate-200 shadow-2xl p-2 z-40">
              <div className="px-2.5 py-1.5 rounded-lg border-2 border-[#00c458] flex items-center gap-1.5 mb-2">
                <span className="text-slate-400 text-xs">🔍</span>
                <input
                  autoFocus
                  value={kindSearch}
                  onChange={(e) => setKindSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && kindSearch.trim()) {
                      e.preventDefault();
                      const chosen = kindSearch.trim();
                      if (canCreateCustomKind) {
                        setExtraAddedKinds((prev) => [...prev, chosen]);
                      }
                      setKind(chosen);
                      setKindSearch("");
                      setErrors((prev) => ({ ...prev, kind: undefined }));
                      setKindMenuOpen(false);
                    }
                  }}
                  placeholder="검색 또는 추가하기"
                  className="flex-1 min-w-0 text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
                />
              </div>

              <div className="px-2 py-1 flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                <span>기본 징계</span>
                <span
                  className="w-3.5 h-3.5 rounded-full border border-slate-300 text-slate-400 text-[9px] inline-flex items-center justify-center"
                  title="회사 기본 징계 구분입니다. 검색창에 입력하여 새 징계 종류를 직접 추가할 수도 있습니다."
                >
                  ?
                </span>
              </div>

              <div className="max-h-48 overflow-y-auto">
                {filteredKinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setKind(k);
                      setKindSearch("");
                      setErrors((prev) => ({ ...prev, kind: undefined }));
                      setKindMenuOpen(false);
                    }}
                    className="w-full px-2.5 py-2 rounded-lg text-left text-[13px] hover:bg-slate-50 flex items-center justify-between font-bold text-slate-800"
                  >
                    <span>{k}</span>
                    {kind === k && (
                      <span className="text-[#00c458] font-extrabold">✓</span>
                    )}
                  </button>
                ))}

                {canCreateCustomKind && (
                  <button
                    type="button"
                    onClick={() => {
                      const created = kindSearch.trim();
                      setExtraAddedKinds((prev) => [...prev, created]);
                      setKind(created);
                      setKindSearch("");
                      setErrors((prev) => ({ ...prev, kind: undefined }));
                      setKindMenuOpen(false);
                    }}
                    className="w-full px-2.5 py-2 rounded-lg text-left text-[12px] font-bold text-[#00a84b] hover:bg-emerald-50"
                  >
                    + &ldquo;{kindSearch.trim()}&rdquo; 추가하기
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 2. 일자 * (기간 선택) */}
        <div
          className="relative"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label
            className={`block text-[11px] font-bold mb-1.5 ${
              errors.period ? "text-[#e05246]" : "text-slate-600"
            }`}
          >
            일자 <span className="text-rose-500">*</span>
          </label>
          <button
            type="button"
            onClick={() => setRangePopOpen((p) => !p)}
            className={`w-full h-[42px] px-3.5 rounded-xl border flex items-center justify-between text-[13px] transition-colors ${
              errors.period
                ? "border-[#e05246] bg-[#fff8f7]"
                : "border-slate-200 hover:border-slate-300 bg-slate-50/40"
            }`}
          >
            <span
              className={
                periodText ? "font-semibold text-slate-900" : "text-slate-400"
              }
            >
              {periodText || "기간 선택"}
            </span>
            <span className="text-slate-400 text-[11px]">▾</span>
          </button>
          <InlineFieldError message={errors.period} />

          {rangePopOpen && (
            <DateRangePickerPopover
              startDate={startDate}
              endDate={endDate}
              onChange={(s, e) => {
                setStartDate(s);
                setEndDate(e);
                if (s) {
                  setErrors((prev) => ({ ...prev, period: undefined }));
                }
              }}
              onClose={() => setRangePopOpen(false)}
            />
          )}
        </div>

        {/* 3. 메모 (0/500) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-bold text-slate-600">메모</label>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-mono font-bold">
              {reason.length}/500
            </span>
          </div>
          <textarea
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="사유 또는 메모 입력"
            className="w-full p-3.5 rounded-xl border border-slate-200 bg-slate-50/40 focus:bg-white focus:border-[#00c458] focus:outline-none text-[13px] text-slate-800 placeholder:text-slate-400 resize-none"
          />
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
