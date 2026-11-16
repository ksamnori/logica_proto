// src/components/hq/settings/HqPayrollPayDeductionSection.tsx
"use client";

import React, { useMemo, useState } from "react";
import { DEFAULT_ORG_CHART_NODES } from "@/lib/hq/defaultCompanySettings";
import {
  DEDUCTION_TYPES,
  DEFAULT_PAYROLL_SETTINGS,
  NON_TAXABLE_CODES,
  PAY_PRECISION_UNITS,
  TAXABLE_BONUS_TYPES,
  TAXABLE_SALARY_TYPES,
} from "@/lib/hq/defaultPayrollSettings";
import type {
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqMember,
  HqPayrollDeductionItem,
  HqPayrollPayItem,
  HqPayrollRoundingMode,
  HqPayrollSettings,
} from "@/lib/hq/types";
import type { HqSettingsTab } from "./HqSettingsModal";

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const PAY_ICONS = ["💵", "💰", "🔥", "🔬", "🚗", "👶", "🍚", "🎁", "📈", "⏱️"];

const RECOMMENDED_FIXED_NON_TAXABLE: {
  name: string;
  desc: string;
  icon: string;
  code: string;
  defaultAmount: number;
}[] = [
  {
    name: "연구보조비(벤처 기업부설연구소)",
    desc: "벤처기업의 연구활동종사 구성원에게 지급",
    icon: "🔬",
    code: "H10",
    defaultAmount: 200000,
  },
  {
    name: "자가운전보조금",
    desc: "소유차량을 업무에 활용하는 구성원에게 지급",
    icon: "🚗",
    code: "H03",
    defaultAmount: 200000,
  },
  {
    name: "자녀보육수당",
    desc: "6세 이하 자녀를 둔 근로자에게 지급",
    icon: "👶",
    code: "Q02",
    defaultAmount: 200000,
  },
  {
    name: "식비",
    desc: "모든 구성원에게 고정으로 식대를 지급",
    icon: "🍚",
    code: "P01",
    defaultAmount: 200000,
  },
];

function nextFixedCode(items: HqPayrollPayItem[]): string {
  const nums = items
    .filter((i) => i.section === "FIXED" && i.code?.startsWith("A"))
    .map((i) => Number(i.code?.slice(1) || 0))
    .filter((n) => !Number.isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 3;
  return `A${String(max + 1).padStart(3, "0")}`;
}

interface PaymentSectionProps {
  settings: HqCompanySettings;
  canEdit: boolean;
  saving: boolean;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onNavigateTab: (tab: HqSettingsTab) => void;
}

/* ========================================================================= */
/* 1. 설정 > 급여·정산 > 지급 항목 (스크린샷 154131 ~ 154502)                 */
/* ========================================================================= */
export function HqPayrollPaymentSection({
  settings,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: PaymentSectionProps) {
  const ex = settings.extra_settings || {};
  const payroll: HqPayrollSettings = ex.payroll_settings
    ? { ...DEFAULT_PAYROLL_SETTINGS, ...ex.payroll_settings }
    : DEFAULT_PAYROLL_SETTINGS;

  const payItems = payroll.pay_items || DEFAULT_PAYROLL_SETTINGS.pay_items;

  const fixedItems = useMemo(
    () => payItems.filter((i) => i.section === "FIXED"),
    [payItems]
  );
  const hourlyItems = useMemo(
    () => payItems.filter((i) => i.section === "HOURLY"),
    [payItems]
  );
  const variableItems = useMemo(
    () => payItems.filter((i) => i.section === "VARIABLE"),
    [payItems]
  );

  // 모달 상태
  const [fixedStarterOpen, setFixedStarterOpen] = useState(false);
  const [itemDraft, setItemDraft] = useState<HqPayrollPayItem | null>(null);
  const [isNewItem, setIsNewItem] = useState(false);
  const [moreSettingsOpen, setMoreSettingsOpen] = useState(false);
  const [nonTaxPickerOpen, setNonTaxPickerOpen] = useState(false);
  const [nonTaxKeyword, setNonTaxKeyword] = useState("");
  const [taxCatOpen, setTaxCatOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);
  const [autoFillModalOpen, setAutoFillModalOpen] = useState(false);
  const [autoMealEnabled, setAutoMealEnabled] = useState(
    payroll.auto_fill_meal_allowance
  );
  const [autoMealAmount, setAutoMealAmount] = useState(
    String(payroll.auto_fill_meal_amount || 200000)
  );
  const [deductLabelOpen, setDeductLabelOpen] = useState(false);

  const openEditItem = (item: HqPayrollPayItem) => {
    setOpenCardMenuId(null);
    setNonTaxPickerOpen(false);
    setTaxCatOpen(false);
    setIconPickerOpen(false);
    setDeductLabelOpen(false);
    setMoreSettingsOpen(false);
    setIsNewItem(false);
    setItemDraft({ ...item });
  };

  const startCreateFixedItem = (preset?: {
    name: string;
    icon: string;
    code: string;
    defaultAmount: number;
  }) => {
    setFixedStarterOpen(false);
    setNonTaxPickerOpen(false);
    setTaxCatOpen(false);
    setIconPickerOpen(false);
    setMoreSettingsOpen(false);
    setIsNewItem(true);
    setItemDraft({
      id: `pay-fixed-${uid()}`,
      section: "FIXED",
      code: nextFixedCode(payItems),
      name: preset?.name || "",
      icon: preset?.icon || "💵",
      description: "",
      is_system_default: false,
      is_monthly_every: true,
      selected_months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      amount_mode: "UNIFORM",
      uniform_amount: preset?.defaultAmount,
      include_in_annual_salary: true,
      is_tax_free: Boolean(preset),
      taxable_category: "기타수당",
      non_taxable_code: preset?.code || "P01",
      include_in_ordinary_wage: true,
      include_in_average_wage: true,
      prorate_policy: "입사·휴직·퇴직원 모두 일할 지급",
      unit_precision: "1의 단위",
      rounding_mode: "반올림",
      payslip_note: "",
    });
  };

  const startCreateVariableItem = () => {
    setNonTaxPickerOpen(false);
    setTaxCatOpen(false);
    setIconPickerOpen(false);
    setIsNewItem(true);
    setItemDraft({
      id: `pay-var-${uid()}`,
      section: "VARIABLE",
      name: "",
      icon: "💵",
      description: "",
      is_system_default: false,
      is_monthly_every: false,
      amount_mode: "SETTLEMENT_INPUT",
      include_in_annual_salary: false,
      is_tax_free: false,
      taxable_category: "기타수당",
      non_taxable_code: "P01",
      include_in_ordinary_wage: false,
      include_in_average_wage: true,
      prorate_policy: "정산 시 입력",
      unit_precision: "1의 단위",
      rounding_mode: "반올림",
      payslip_note: "",
    });
  };

  const handleSaveItem = async () => {
    if (!itemDraft) return;
    if (!itemDraft.name.trim()) {
      alert("지급 항목 이름을 입력해주세요.");
      return;
    }

    const clean: HqPayrollPayItem = {
      ...itemDraft,
      name: itemDraft.name.trim(),
      description: itemDraft.description.trim(),
    };

    const nextItems = isNewItem
      ? [...payItems, clean]
      : payItems.map((i) => (i.id === clean.id ? clean : i));

    await onSaveExtra(
      {
        payroll_settings: {
          ...payroll,
          pay_items: nextItems,
        },
      },
      isNewItem
        ? `'${clean.name}' 지급 항목이 추가되었습니다.`
        : `'${clean.name}' 지급 항목이 저장되었습니다.`
    );
    setItemDraft(null);
  };

  const handleDeleteItem = async (target: HqPayrollPayItem) => {
    setOpenCardMenuId(null);
    if (target.is_system_default) {
      alert("기본 지급 항목은 삭제할 수 없습니다.");
      return;
    }
    if (!confirm(`'${target.name}' 지급 항목을 삭제하시겠습니까?`)) return;

    await onSaveExtra(
      {
        payroll_settings: {
          ...payroll,
          pay_items: payItems.filter((i) => i.id !== target.id),
        },
      },
      `'${target.name}' 지급 항목이 삭제되었습니다.`
    );
  };

  const handleSaveAutoFill = async () => {
    await onSaveExtra(
      {
        payroll_settings: {
          ...payroll,
          auto_fill_meal_allowance: autoMealEnabled,
          auto_fill_meal_amount: Math.max(
            0,
            Number(autoMealAmount.replace(/[^0-9]/g, "") || 0)
          ),
        },
      },
      "급여 금액 자동 입력 계산 방식이 저장되었습니다."
    );
    setAutoFillModalOpen(false);
  };

  const selectedNonTaxMeta = useMemo(() => {
    const code = itemDraft?.non_taxable_code || "P01";
    return (
      NON_TAXABLE_CODES.find((c) => c.code === code) || NON_TAXABLE_CODES[2]
    );
  }, [itemDraft?.non_taxable_code]);

  const filteredNonTaxCodes = useMemo(() => {
    const kw = nonTaxKeyword.trim().toLowerCase();
    if (!kw) return NON_TAXABLE_CODES;
    return NON_TAXABLE_CODES.filter(
      (c) =>
        c.code.toLowerCase().includes(kw) ||
        c.label.toLowerCase().includes(kw) ||
        c.limitText.toLowerCase().includes(kw)
    );
  }, [nonTaxKeyword]);

  const renderItemCard = (item: HqPayrollPayItem) => (
    <div
      key={item.id}
      onClick={() => openEditItem(item)}
      className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-center justify-between gap-3 shadow-2xs cursor-pointer relative"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-base shrink-0">{item.icon}</span>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-slate-900 truncate">
            {item.name}
          </div>
          {item.description && (
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
              {item.description}
            </p>
          )}
        </div>
      </div>

      <div
        className="flex items-center gap-1.5 shrink-0 text-[10px]"
        onClick={(e) => e.stopPropagation()}
      >
        {item.include_in_annual_salary && (
          <span
            onClick={() => openEditItem(item)}
            className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-bold"
          >
            연봉포함
          </span>
        )}
        {!item.is_system_default && item.include_in_ordinary_wage && (
          <span
            onClick={() => openEditItem(item)}
            className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-bold"
          >
            통상임금
          </span>
        )}
        {!item.is_system_default && item.include_in_average_wage && (
          <span
            onClick={() => openEditItem(item)}
            className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-bold"
          >
            평균임금
          </span>
        )}
        {item.is_tax_free && (
          <span
            onClick={() => openEditItem(item)}
            className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-bold"
          >
            비과세
          </span>
        )}
        {item.is_system_default && (
          <span
            onClick={() => openEditItem(item)}
            className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 font-bold"
          >
            기본
          </span>
        )}

        {!item.is_system_default && canEdit && (
          <div className="relative ml-0.5">
            <button
              type="button"
              onClick={() =>
                setOpenCardMenuId((p) => (p === item.id ? null : item.id))
              }
              className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold text-xs"
            >
              ⋯
            </button>

            {openCardMenuId === item.id && (
              <div className="absolute right-0 mt-1 w-32 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                <button
                  type="button"
                  onClick={() => openEditItem(item)}
                  className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                >
                  항목 설정
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteItem(item)}
                  className="w-full px-3.5 py-1.5 text-left font-semibold text-rose-500 hover:bg-rose-50"
                >
                  삭제하기
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="space-y-9">
        {/* 헤더 */}
        <div>
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            지급 항목
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            구성원에게 지급되는 항목이에요. 계약과 급여 정산에 사용돼요.
          </p>
        </div>

        {/* 섹션 1: 고정 지급 항목 */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-extrabold text-slate-900">
                고정 지급 항목
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                고정적으로 지급하는 항목으로, 주로 연봉이나 월급을 구성해요.
              </p>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => setFixedStarterOpen(true)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
              >
                <span className="text-[#00c458] font-extrabold text-sm leading-none">
                  +
                </span>
                <span>항목 추가</span>
              </button>
            )}
          </div>

          <div className="space-y-2">{fixedItems.map(renderItemCard)}</div>

          <p className="text-[11px] text-slate-400 pt-1">
            금액 자동 입력 기능의 계산 방식을 설정하려면,{" "}
            <button
              type="button"
              onClick={() => {
                setAutoMealEnabled(payroll.auto_fill_meal_allowance);
                setAutoMealAmount(String(payroll.auto_fill_meal_amount || 200000));
                setAutoFillModalOpen(true);
              }}
              className="text-blue-600 hover:underline font-bold"
            >
              이곳을 클릭하세요.
            </button>
          </p>
        </section>

        {/* 섹션 2: 시급제 지급 항목 */}
        <section className="space-y-3">
          <div>
            <h3 className="text-[15px] font-extrabold text-slate-900">
              시급제 지급 항목
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              시급제 급여에서 고정적으로 지급하는 항목이에요.
            </p>
          </div>
          <div className="space-y-2">{hourlyItems.map(renderItemCard)}</div>
        </section>

        {/* 섹션 3: 변동 지급 항목 */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-extrabold text-slate-900">
                변동 지급 항목
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                일시적으로 지급하는 항목으로, 급여 정산 때에만 활용해요.
              </p>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={startCreateVariableItem}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
              >
                <span className="text-[#00c458] font-extrabold text-sm leading-none">
                  +
                </span>
                <span>항목 추가</span>
              </button>
            )}
          </div>
          <div className="space-y-2">{variableItems.map(renderItemCard)}</div>
        </section>

        {/* 하단 이전/다음 이동 카드 (맞춤 휴가 ← / → 공제 항목) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("custom-leave")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                맞춤 휴가
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("payroll-deduction")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                공제 항목
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 모달 1: 어떤 고정 지급 항목을 추가하시겠어요? (154135.png)          */}
      {/* ================================================================= */}
      {fixedStarterOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[460px] rounded-2xl shadow-2xl border border-slate-200 p-7 text-xs space-y-5">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setFixedStarterOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="-mt-2">
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                어떤 고정 지급 항목을 추가하시겠어요?
              </h3>
              <p className="text-slate-500 mt-1.5 leading-relaxed">
                구성원에게 미리 할당해서 정기적으로 지급하는 항목을 추가할 수 있어요.
                <br />
                추천하는 비과세 항목을 바로 추가하시거나, 새로 만들어주세요.
              </p>

              <button
                type="button"
                onClick={() => startCreateFixedItem()}
                className="mt-4 px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-800 inline-flex items-center gap-1.5 shadow-2xs"
              >
                <span className="w-4 h-4 rounded bg-teal-500 text-white flex items-center justify-center text-xs">
                  +
                </span>
                <span>새로 만들기</span>
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-bold text-slate-600">
                추천하는 비과세 항목
              </div>
              <div className="space-y-2">
                {RECOMMENDED_FIXED_NON_TAXABLE.map((rec) => (
                  <button
                    key={rec.code}
                    type="button"
                    onClick={() => startCreateFixedItem(rec)}
                    className="w-full p-3.5 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 flex items-center gap-2.5 text-left transition-colors"
                  >
                    <span className="text-base">{rec.icon}</span>
                    <span className="font-bold text-slate-900">{rec.name}</span>
                    <span className="text-[11px] text-slate-400 truncate">
                      {rec.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 2: 지급 항목 상세 / 추가 모달 (월고정 / 시급제 / 변동 전체)    */}
      {/* ================================================================= */}
      {itemDraft && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[490px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            {/* 상단 배지 + 닫기 */}
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="px-2.5 py-0.5 rounded-full bg-slate-700 text-white text-[10px] font-extrabold">
                  {itemDraft.section === "FIXED"
                    ? "월고정"
                    : itemDraft.section === "HOURLY"
                    ? "시급제"
                    : "변동"}
                </span>
                {itemDraft.code && (
                  <span className="px-2 py-0.5 rounded-full border border-slate-200 text-slate-500 text-[10px] font-bold">
                    {itemDraft.code}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setItemDraft(null)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-5 mt-3">
              {/* 이름 + 설명 */}
              <div className="relative">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canEdit || Boolean(itemDraft.is_system_default)}
                    onClick={() => setIconPickerOpen((p) => !p)}
                    className="text-lg shrink-0"
                  >
                    {itemDraft.icon}
                  </button>
                  <input
                    autoFocus={isNewItem}
                    disabled={!canEdit || Boolean(itemDraft.is_system_default)}
                    value={itemDraft.name}
                    onChange={(e) =>
                      setItemDraft({ ...itemDraft, name: e.target.value })
                    }
                    placeholder={
                      itemDraft.section === "VARIABLE"
                        ? "변동 지급 항목의 이름을 적어주세요"
                        : "지급 항목 이름 입력"
                    }
                    className="flex-1 text-xl font-extrabold text-slate-900 placeholder:text-slate-300 disabled:bg-transparent focus:outline-none"
                  />
                </div>

                {iconPickerOpen && (
                  <div className="absolute left-0 top-9 z-30 p-2 rounded-xl bg-white border border-slate-200 shadow-xl flex gap-1">
                    {PAY_ICONS.map((ic) => (
                      <button
                        key={ic}
                        type="button"
                        onClick={() => {
                          setItemDraft({ ...itemDraft, icon: ic });
                          setIconPickerOpen(false);
                        }}
                        className="w-7 h-7 rounded hover:bg-slate-100 text-sm"
                      >
                        {ic}
                      </button>
                    ))}
                  </div>
                )}

                <input
                  disabled={!canEdit}
                  value={itemDraft.description}
                  onChange={(e) =>
                    setItemDraft({ ...itemDraft, description: e.target.value })
                  }
                  placeholder="지급 항목에 대한 설명을 추가해 보세요."
                  className="mt-2 w-full text-xs text-slate-500 placeholder:text-slate-400 focus:outline-none"
                />
              </div>

              {/* 시스템 기본 항목 TIP 박스 (154138, 154149, 154205, 154216, 154502) */}
              {itemDraft.tip_text && (
                <div className="rounded-xl bg-[#f8f9fa] p-3.5 flex items-start gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-[#00c458] text-white text-[9px] font-extrabold shrink-0 mt-0.5">
                    TIP
                  </span>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    {itemDraft.tip_text}
                  </p>
                </div>
              )}

              {/* ========================================================= */}
              {/* CASE A: 시스템 기본 항목 (기본급 A001 / 고정OT A002 / 시급제 / 변동 기본) */}
              {/* ========================================================= */}
              {itemDraft.is_system_default ? (
                <div className="space-y-5">
                  <div className="space-y-2.5 pt-2 border-t border-slate-100">
                    {itemDraft.section !== "VARIABLE" &&
                      itemDraft.code !== "H002" && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 font-semibold">
                            지급 주기
                          </span>
                          <span className="font-bold text-slate-800">
                            매월 지급
                          </span>
                        </div>
                      )}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">
                        지급 금액
                      </span>
                      <span className="font-bold text-slate-800">
                        {itemDraft.amount_mode === "PER_PERSON"
                          ? "사람마다 다름"
                          : "정산 시 입력"}
                      </span>
                    </div>
                    {itemDraft.section === "FIXED" && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-semibold">
                          연봉(월급) 포함 여부
                        </span>
                        <span className="font-bold text-slate-800">
                          {itemDraft.include_in_annual_salary
                            ? "포함"
                            : "포함하지 않음"}
                        </span>
                      </div>
                    )}
                    {itemDraft.id !== "pay-var-deduct" && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-semibold">
                          과세 유형
                        </span>
                        <span className="font-bold text-slate-800">
                          {itemDraft.taxable_category}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 급여 정책 */}
                  <div className="pt-4 border-t border-slate-100 space-y-2.5">
                    <div className="font-extrabold text-slate-900">
                      급여 정책
                    </div>
                    {itemDraft.section !== "VARIABLE" &&
                      itemDraft.code !== "H002" && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 font-semibold">
                            통상임금 여부
                          </span>
                          <span className="font-bold text-slate-800">
                            {itemDraft.include_in_ordinary_wage
                              ? "포함"
                              : "포함하지 않음"}
                          </span>
                        </div>
                      )}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">
                        평균임금 여부
                      </span>
                      <span className="font-bold text-slate-800">
                        {itemDraft.include_in_average_wage
                          ? "포함"
                          : "포함하지 않음"}
                      </span>
                    </div>
                  </div>

                  {/* 지급 정책 */}
                  <div className="pt-4 border-t border-slate-100 space-y-3">
                    <div>
                      <div className="font-extrabold text-slate-900">
                        지급 정책
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                        {itemDraft.code === "H002"
                          ? "근로자가 주중 일부만 근무했을 때, 주휴수당의 자동 계산 정책을 설정할 수 있어요."
                          : "근로자가 일부 기간 근무 시, 수습기간 등에 따라 자동으로 계산할 때 지급 기준을 설정할 수 있어요."}
                      </p>
                    </div>

                    {itemDraft.section === "FIXED" && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-600 font-semibold">
                          지급금액 일할 정책
                        </span>
                        <select
                          disabled={!canEdit}
                          value={itemDraft.prorate_policy}
                          onChange={(e) =>
                            setItemDraft({
                              ...itemDraft,
                              prorate_policy: e.target.value,
                            })
                          }
                          className="px-3 py-1.5 rounded-lg bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                        >
                          <option value="입사·휴직·퇴직원 모두 일할 지급">
                            입사·휴직·퇴직원 모두 일할 지급
                          </option>
                          <option value="입사·퇴직원 일할 지급">
                            입사·퇴직원 일할 지급
                          </option>
                          <option value="일할 계산 안 함">일할 계산 안 함</option>
                        </select>
                      </div>
                    )}

                    {/* 주휴수당 전용 정책 (154216.png, 154218.png) */}
                    {itemDraft.code === "H002" && (
                      <div className="space-y-2.5">
                        {(
                          [
                            {
                              key: "hire_week_policy",
                              label: "입사주 정책",
                            },
                            {
                              key: "leave_week_policy",
                              label: "휴직주 정책",
                            },
                            {
                              key: "resign_week_policy",
                              label: "퇴직주 정책",
                            },
                          ] as const
                        ).map((row) => (
                          <div
                            key={row.key}
                            className="flex items-center justify-between gap-4"
                          >
                            <span className="text-slate-600 font-semibold">
                              {row.label}
                            </span>
                            <select
                              disabled={!canEdit}
                              value={itemDraft[row.key] || "전액 지급"}
                              onChange={(e) =>
                                setItemDraft({
                                  ...itemDraft,
                                  [row.key]: e.target.value as any,
                                })
                              }
                              className="w-44 px-3 py-2 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                            >
                              <option value="전액 지급">전액 지급</option>
                              <option value="근무일에 비례하여 지급">
                                근무일에 비례하여 지급
                              </option>
                              <option value="지급하지 않음">지급하지 않음</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 지급 금액 단위 & 끝수 처리 */}
                    <div className="flex items-start justify-between gap-4 pt-1">
                      <span className="text-slate-600 font-semibold pt-2">
                        지급 금액 단위
                      </span>
                      <div className="w-44 space-y-2">
                        <select
                          disabled={!canEdit}
                          value={itemDraft.unit_precision}
                          onChange={(e) =>
                            setItemDraft({
                              ...itemDraft,
                              unit_precision: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                        >
                          {PAY_PRECISION_UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>

                        <div className="grid grid-cols-3 p-0.5 rounded-xl bg-[#f5f6f8] border border-slate-200/70">
                          {(["올림", "반올림", "버림"] as HqPayrollRoundingMode[]).map(
                            (rm) => (
                              <button
                                key={rm}
                                type="button"
                                disabled={!canEdit}
                                onClick={() =>
                                  setItemDraft({
                                    ...itemDraft,
                                    rounding_mode: rm,
                                  })
                                }
                                className={`py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                                  itemDraft.rounding_mode === rm
                                    ? "bg-white text-slate-900 shadow-2xs"
                                    : "text-slate-400"
                                }`}
                              >
                                {rm}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 기본급차감금 전용: 차감금 유형 별 항목명 설정 (154502.png) */}
                  {itemDraft.id === "pay-var-deduct" && (
                    <div className="pt-3 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setDeductLabelOpen((p) => !p)}
                        className="w-full py-2 flex items-center justify-between font-bold text-slate-800"
                      >
                        <span>차감금 유형 별 항목명 설정</span>
                        <span className="text-slate-400">
                          {deductLabelOpen ? "⌄" : "›"}
                        </span>
                      </button>
                      {deductLabelOpen && (
                        <div className="mt-2 p-3 rounded-xl bg-slate-50 space-y-2 text-[11px] text-slate-600">
                          <div className="flex justify-between">
                            <span>무급휴가 차감 표기명</span>
                            <span className="font-bold text-slate-800">
                              무급휴가 공제
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>소정근로 미달 차감 표기명</span>
                            <span className="font-bold text-slate-800">
                              근로미달 차감금
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 급여명세서 표기란 */}
                  <div className="pt-4 border-t border-slate-100 space-y-2">
                    <div>
                      <div className="font-extrabold text-slate-900">
                        급여명세서 표기란
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        입력한 내용은 급여정산의 급여명세서 표기란에 반영돼요.
                      </p>
                    </div>
                    <textarea
                      rows={3}
                      disabled={!canEdit}
                      value={itemDraft.payslip_note}
                      onChange={(e) =>
                        setItemDraft({
                          ...itemDraft,
                          payslip_note: e.target.value,
                        })
                      }
                      placeholder="내용 입력"
                      className="w-full p-3 rounded-xl bg-[#f5f6f8] text-slate-800 placeholder:text-slate-400 focus:outline-none resize-none"
                    />
                  </div>
                </div>
              ) : itemDraft.section === "FIXED" ? (
                /* ========================================================= */
                /* CASE B: 커스텀 고정 지급 항목 (식비 A003 및 신규 항목 — 154155.png) */
                /* ========================================================= */
                <div className="space-y-4 pt-2 border-t border-slate-100">
                  {/* 지급 주기 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800">지급 주기</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-slate-500">
                          매월 지급
                        </span>
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() =>
                            setItemDraft({
                              ...itemDraft,
                              is_monthly_every: !itemDraft.is_monthly_every,
                            })
                          }
                          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                            itemDraft.is_monthly_every
                              ? "bg-[#00c458]"
                              : "bg-slate-200"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${
                              itemDraft.is_monthly_every
                                ? "translate-x-4"
                                : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {!itemDraft.is_monthly_every && (
                      <div className="grid grid-cols-6 gap-1.5 p-2.5 rounded-xl bg-[#f5f6f8]">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
                          const selected = (
                            itemDraft.selected_months || []
                          ).includes(m);
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => {
                                const cur = itemDraft.selected_months || [];
                                const next = selected
                                  ? cur.filter((x) => x !== m)
                                  : [...cur, m].sort((a, b) => a - b);
                                setItemDraft({
                                  ...itemDraft,
                                  selected_months: next,
                                });
                              }}
                              className={`py-1.5 rounded-lg text-[11px] font-bold ${
                                selected
                                  ? "bg-white text-emerald-700 border border-emerald-400"
                                  : "text-slate-500 hover:bg-white/60"
                              }`}
                            >
                              {m}월
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 지급 금액 */}
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-800">
                      지급 금액
                    </label>
                    <div className="px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] flex items-center justify-between">
                      <input
                        type="number"
                        disabled={!canEdit}
                        value={itemDraft.uniform_amount ?? ""}
                        onChange={(e) =>
                          setItemDraft({
                            ...itemDraft,
                            uniform_amount: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          })
                        }
                        placeholder="모두에게 지급할 금액 입력"
                        className="flex-1 bg-transparent font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none"
                      />
                      <span className="text-slate-500 font-semibold">원</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      여러 대상자에게 동일한 금액을 주고 싶을 때 입력해요.
                    </p>
                  </div>

                  {/* 연봉(월급) 포함 여부 */}
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <label className="block font-bold text-slate-800">
                      연봉(월급) 포함 여부
                    </label>
                    <div className="grid grid-cols-2 p-0.5 rounded-xl bg-[#f5f6f8] border border-slate-200/70">
                      {[
                        { label: "포함", val: true },
                        { label: "포함하지 않음", val: false },
                      ].map((opt) => (
                        <button
                          key={opt.label}
                          type="button"
                          disabled={!canEdit}
                          onClick={() =>
                            setItemDraft({
                              ...itemDraft,
                              include_in_annual_salary: opt.val,
                            })
                          }
                          className={`py-2 rounded-lg font-bold transition-all ${
                            itemDraft.include_in_annual_salary === opt.val
                              ? "bg-white text-slate-900 shadow-2xs"
                              : "text-slate-400"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      계약 금액이 연봉이나 월급일 때만 사용돼요.
                    </p>
                  </div>

                  {/* 과세 여부 + 비과세/과세 유형 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-800 mb-1.5">
                        과세 여부
                      </label>
                      <div className="grid grid-cols-2 p-0.5 rounded-xl bg-[#f5f6f8] border border-slate-200/70">
                        {[
                          { label: "과세", val: false },
                          { label: "비과세", val: true },
                        ].map((opt) => (
                          <button
                            key={opt.label}
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              setItemDraft({
                                ...itemDraft,
                                is_tax_free: opt.val,
                              })
                            }
                            className={`py-2 rounded-lg font-bold transition-all ${
                              itemDraft.is_tax_free === opt.val
                                ? "bg-white text-slate-900 shadow-2xs"
                                : "text-slate-400"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="relative">
                      <label className="block font-bold text-slate-800 mb-1.5">
                        {itemDraft.is_tax_free ? "비과세 유형" : "과세 유형"}
                      </label>
                      {itemDraft.is_tax_free ? (
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => setNonTaxPickerOpen((p) => !p)}
                          className="w-full px-3 py-2 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 flex items-center justify-between gap-1"
                        >
                          <span className="truncate flex items-center gap-1">
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px]">
                              {selectedNonTaxMeta.code}
                            </span>
                            <span>{selectedNonTaxMeta.label}</span>
                          </span>
                          <span className="text-slate-400 text-[10px]">▾</span>
                        </button>
                      ) : (
                        <select
                          disabled={!canEdit}
                          value={itemDraft.taxable_category}
                          onChange={(e) =>
                            setItemDraft({
                              ...itemDraft,
                              taxable_category: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                        >
                          <option value="급여">급여</option>
                          {TAXABLE_SALARY_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {itemDraft.is_tax_free && selectedNonTaxMeta.tipText && (
                    <div className="rounded-xl bg-[#f8f9fa] p-3.5 flex items-start gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-[#00c458] text-white text-[9px] font-extrabold shrink-0 mt-0.5">
                        TIP
                      </span>
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        {selectedNonTaxMeta.tipText}
                      </p>
                    </div>
                  )}

                  {/* 더 많은 설정 확인하기 */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setMoreSettingsOpen((p) => !p)}
                      className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1"
                    >
                      <span>더 많은 설정 확인하기</span>
                      <span>{moreSettingsOpen ? "▴" : "▾"}</span>
                    </button>

                    {moreSettingsOpen && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-700">
                            통상임금 포함
                          </span>
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={itemDraft.include_in_ordinary_wage}
                            onChange={(e) =>
                              setItemDraft({
                                ...itemDraft,
                                include_in_ordinary_wage: e.target.checked,
                              })
                            }
                            className="w-4 h-4 accent-[#00c458]"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-700">
                            평균임금 포함
                          </span>
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={itemDraft.include_in_average_wage}
                            onChange={(e) =>
                              setItemDraft({
                                ...itemDraft,
                                include_in_average_wage: e.target.checked,
                              })
                            }
                            className="w-4 h-4 accent-[#00c458]"
                          />
                        </div>
                        <textarea
                          rows={2}
                          disabled={!canEdit}
                          value={itemDraft.payslip_note}
                          onChange={(e) =>
                            setItemDraft({
                              ...itemDraft,
                              payslip_note: e.target.value,
                            })
                          }
                          placeholder="급여명세서 표기란 내용 입력"
                          className="w-full p-2.5 rounded-xl bg-[#f5f6f8] text-slate-800 placeholder:text-slate-400 focus:outline-none resize-none"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* ========================================================= */
                /* CASE C: 커스텀 변동 지급 항목 (154233 ~ 154437)            */
                /* ========================================================= */
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {/* 과세 여부 */}
                  <div className="py-3.5 flex items-center justify-between gap-4">
                    <span className="font-bold text-slate-800">과세 여부</span>
                    <div className="w-48 grid grid-cols-2 p-0.5 rounded-xl bg-[#f5f6f8] border border-slate-200/70">
                      {[
                        { label: "과세", val: false },
                        { label: "비과세", val: true },
                      ].map((opt) => (
                        <button
                          key={opt.label}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => {
                            setItemDraft({
                              ...itemDraft,
                              is_tax_free: opt.val,
                            });
                            setTaxCatOpen(false);
                            setNonTaxPickerOpen(false);
                          }}
                          className={`py-2 rounded-lg font-bold transition-all ${
                            itemDraft.is_tax_free === opt.val
                              ? "bg-white text-slate-900 shadow-2xs"
                              : "text-slate-400"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 과세 유형 vs 비과세 유형 */}
                  {!itemDraft.is_tax_free ? (
                    <div className="py-3.5 flex items-center justify-between gap-4 relative">
                      <span className="font-bold text-slate-800">과세 유형</span>
                      <div className="w-48 relative">
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => setTaxCatOpen((p) => !p)}
                          className="w-full px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 flex items-center justify-between"
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] text-slate-500">
                              {TAXABLE_BONUS_TYPES.includes(
                                itemDraft.taxable_category
                              )
                                ? "상여"
                                : "급여"}
                            </span>
                            <span className="truncate">
                              {itemDraft.taxable_category}
                            </span>
                          </span>
                          <span className="text-slate-400 text-[10px]">▾</span>
                        </button>

                        {taxCatOpen && (
                          <div className="absolute right-0 mt-1 w-56 max-h-64 overflow-y-auto custom-scroll rounded-xl bg-white border border-slate-200 shadow-2xl py-2 z-30">
                            <div className="px-3.5 py-1 text-[10px] font-bold text-slate-400">
                              급여
                            </div>
                            {TAXABLE_SALARY_TYPES.map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => {
                                  setItemDraft({
                                    ...itemDraft,
                                    taxable_category: t,
                                  });
                                  setTaxCatOpen(false);
                                }}
                                className="w-full px-3.5 py-1.5 text-left hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-800"
                              >
                                <span>{t}</span>
                                {itemDraft.taxable_category === t && (
                                  <span className="text-[#00c458]">✓</span>
                                )}
                              </button>
                            ))}

                            <div className="my-1.5 border-t border-slate-100" />
                            <div className="px-3.5 py-1 text-[10px] font-bold text-slate-400">
                              상여
                            </div>
                            {TAXABLE_BONUS_TYPES.map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => {
                                  setItemDraft({
                                    ...itemDraft,
                                    taxable_category: t,
                                  });
                                  setTaxCatOpen(false);
                                }}
                                className="w-full px-3.5 py-1.5 text-left hover:bg-slate-50 flex items-center justify-between font-semibold text-slate-800"
                              >
                                <span>{t}</span>
                                {itemDraft.taxable_category === t && (
                                  <span className="text-[#00c458]">✓</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="py-3.5 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-bold text-slate-800">
                          비과세 유형
                        </span>
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => setNonTaxPickerOpen((p) => !p)}
                          className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 flex items-center justify-between"
                        >
                          <span className="truncate flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px]">
                              {selectedNonTaxMeta.code}
                            </span>
                            <span className="truncate">
                              {selectedNonTaxMeta.label}
                            </span>
                          </span>
                          <span className="text-slate-400 text-[10px]">▾</span>
                        </button>
                      </div>

                      <div className="rounded-xl bg-[#f8f9fa] p-3 flex items-start gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-[#00c458] text-white text-[9px] font-extrabold shrink-0">
                          TIP
                        </span>
                        <p className="text-[11px] text-slate-600">
                          비과세 한도 기준: {selectedNonTaxMeta.limitText}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 평균임금 여부 */}
                  <div className="py-3.5 flex items-center justify-between gap-4">
                    <span className="font-bold text-slate-800">평균임금 여부</span>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        setItemDraft({
                          ...itemDraft,
                          include_in_average_wage:
                            !itemDraft.include_in_average_wage,
                        })
                      }
                      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                        itemDraft.include_in_average_wage
                          ? "bg-[#00c458]"
                          : "bg-slate-200"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                          itemDraft.include_in_average_wage
                            ? "translate-x-5"
                            : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {/* 급여명세서 표기란 */}
                  <div className="py-4 space-y-2">
                    <div>
                      <div className="font-bold text-slate-800">
                        급여명세서 표기란
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        입력한 내용은 급여정산의 급여명세서 표기란에 반영돼요.
                      </p>
                    </div>
                    <textarea
                      rows={3}
                      disabled={!canEdit}
                      value={itemDraft.payslip_note}
                      onChange={(e) =>
                        setItemDraft({
                          ...itemDraft,
                          payslip_note: e.target.value,
                        })
                      }
                      placeholder="내용 입력"
                      className="w-full p-3 rounded-xl bg-[#f5f6f8] text-slate-800 placeholder:text-slate-400 focus:outline-none resize-none"
                    />
                  </div>
                </div>
              )}
            </div>

            {canEdit && (
              <div className="pt-5 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveItem}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:opacity-95 text-white text-xs font-extrabold shadow-md transition-opacity"
                >
                  {saving
                    ? "저장 중..."
                    : isNewItem
                    ? "추가하기"
                    : "저장하기"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 중첩 모달: 국세청 비과세 소득 코드 검색 피커 (154244 ~ 154437)      */}
      {/* ================================================================= */}
      {itemDraft && nonTaxPickerOpen && (
        <div className="fixed inset-0 bg-slate-900/40 z-[85] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[400px] max-h-[75vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <span className="font-extrabold text-slate-900">
                비과세 유형 선택 (국세청 기준)
              </span>
              <button
                type="button"
                onClick={() => setNonTaxPickerOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
            <div className="p-3 border-b border-slate-100">
              <input
                autoFocus
                value={nonTaxKeyword}
                onChange={(e) => setNonTaxKeyword(e.target.value)}
                placeholder="🔍 코드(P01, H03...) 또는 비과세 항목명 검색"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none"
              />
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll p-2 space-y-3">
              {!nonTaxKeyword.trim() && (
                <div>
                  <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400">
                    자주 사용하는 항목
                  </div>
                  {NON_TAXABLE_CODES.filter((c) => c.popular).map((c) => (
                    <button
                      key={`pop-${c.code}`}
                      type="button"
                      onClick={() => {
                        setItemDraft({
                          ...itemDraft,
                          non_taxable_code: c.code,
                        });
                        setNonTaxPickerOpen(false);
                      }}
                      className="w-full px-2.5 py-2 rounded-xl hover:bg-slate-50 flex items-center justify-between gap-2 text-left"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-extrabold shrink-0">
                          {c.code}
                        </span>
                        <span className="font-bold text-slate-800 truncate">
                          {c.label}
                        </span>
                        <span className="text-[11px] text-slate-400 shrink-0">
                          {c.limitText}
                        </span>
                      </span>
                      {itemDraft.non_taxable_code === c.code && (
                        <span className="text-[#00c458] font-bold">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <div>
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400">
                  전체 항목 ({filteredNonTaxCodes.length})
                </div>
                {filteredNonTaxCodes.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => {
                      setItemDraft({ ...itemDraft, non_taxable_code: c.code });
                      setNonTaxPickerOpen(false);
                    }}
                    className="w-full px-2.5 py-2 rounded-xl hover:bg-slate-50 flex items-center justify-between gap-2 text-left"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-extrabold shrink-0">
                        {c.code}
                      </span>
                      <span className="font-bold text-slate-800 truncate">
                        {c.label}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {c.limitText}
                      </span>
                    </span>
                    {itemDraft.non_taxable_code === c.code && (
                      <span className="text-[#00c458] font-bold">✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 금액 자동 입력 계산 방식 모달 */}
      {autoFillModalOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[440px] rounded-2xl shadow-2xl border border-slate-200 p-7 text-xs space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-900">
                금액 자동 입력 계산 방식 설정
              </h3>
              <button
                type="button"
                onClick={() => setAutoFillModalOpen(false)}
                className="w-6 h-6 rounded-full bg-slate-200/80 text-slate-500 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>
            <p className="text-slate-500 leading-relaxed">
              연봉 또는 월 계약 급여 입력 시 비과세 식비와 포괄 고정초과근무수당, 기본급을 자동으로 안분 계산하는 기준입니다.
            </p>
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800">
                  비과세 식비 우선 분리 적용
                </span>
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={autoMealEnabled}
                  onChange={(e) => setAutoMealEnabled(e.target.checked)}
                  className="w-4 h-4 accent-[#00c458]"
                />
              </div>
              {autoMealEnabled && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-600 font-semibold">
                    월 기본 비과세 식대
                  </span>
                  <div className="w-40 px-3 py-2 rounded-xl bg-[#f5f6f8] flex items-center justify-between">
                    <input
                      type="number"
                      disabled={!canEdit}
                      value={autoMealAmount}
                      onChange={(e) => setAutoMealAmount(e.target.value)}
                      className="w-24 bg-transparent font-bold text-slate-900 focus:outline-none"
                    />
                    <span className="text-slate-500">원</span>
                  </div>
                </div>
              )}
            </div>
            {canEdit && (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveAutoFill}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] text-white font-extrabold"
              >
                저장하기
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ========================================================================= */
/* 2. 설정 > 급여·정산 > 공제 항목 (스크린샷 154520 ~ 154546)                 */
/* ========================================================================= */
interface DeductionSectionProps {
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

export function HqPayrollDeductionSection({
  settings,
  members,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: DeductionSectionProps) {
  const ex = settings.extra_settings || {};
  const payroll: HqPayrollSettings = ex.payroll_settings
    ? { ...DEFAULT_PAYROLL_SETTINGS, ...ex.payroll_settings }
    : DEFAULT_PAYROLL_SETTINGS;

  const items = payroll.deduction_items || [];

  const orgDepts = useMemo(() => {
    const nodes =
      ex.org_chart_nodes && ex.org_chart_nodes.length > 0
        ? ex.org_chart_nodes
        : DEFAULT_ORG_CHART_NODES;
    return nodes.filter((n) => !n.is_hidden).map((n) => n.name);
  }, [ex.org_chart_nodes]);

  const [draft, setDraft] = useState<HqPayrollDeductionItem | null>(null);
  const [isNew, setIsNew] = useState(false);

  const openCreateModal = () => {
    setIsNew(true);
    setDraft({
      id: `ded-${uid()}`,
      name: "",
      description: "",
      deduction_type: "기타",
      cycle_mode: "매 월",
      selected_months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      target_scope: "대상자 전체",
      selected_member_names: [],
      target_departments: [],
      amount_mode: "정산 시 입력",
      uniform_amount: undefined,
      payslip_note: "",
    });
  };

  const openEditModal = (item: HqPayrollDeductionItem) => {
    setIsNew(false);
    setDraft({ ...item });
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      alert("공제 항목 이름을 입력해주세요.");
      return;
    }

    const clean: HqPayrollDeductionItem = {
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
    };

    const nextList = isNew
      ? [...items, clean]
      : items.map((x) => (x.id === clean.id ? clean : x));

    await onSaveExtra(
      {
        payroll_settings: {
          ...payroll,
          deduction_items: nextList,
        },
      },
      isNew
        ? `'${clean.name}' 공제 항목이 추가되었습니다.`
        : `'${clean.name}' 공제 항목이 저장되었습니다.`
    );
    setDraft(null);
  };

  const handleDelete = async (target: HqPayrollDeductionItem) => {
    if (!confirm(`'${target.name}' 공제 항목을 삭제하시겠습니까?`)) return;
    await onSaveExtra(
      {
        payroll_settings: {
          ...payroll,
          deduction_items: items.filter((x) => x.id !== target.id),
        },
      },
      `'${target.name}' 공제 항목이 삭제되었습니다.`
    );
  };

  return (
    <>
      <div className="space-y-9">
        <div>
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            공제 항목
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            급여에서 구성원에게 공제할 항목을 관리해요.
          </p>
        </div>

        <section className="space-y-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-extrabold text-slate-900">
                기타 공제 항목
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                회사에 필요한 공제항목을 추가해 정산에 활용하세요.
              </p>
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={openCreateModal}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
              >
                <span className="text-[#00c458] font-extrabold text-sm leading-none">
                  +
                </span>
                <span>항목 추가</span>
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="py-12 px-6 rounded-2xl bg-[#fafafa] border border-slate-100 text-center space-y-1.5">
              <div className="w-8 h-8 mx-auto rounded-lg border border-dashed border-slate-300 text-slate-300 flex items-center justify-center text-sm">
                🧾
              </div>
              <div className="text-xs font-bold text-slate-700 pt-1">
                아직 추가한 기타 공제 항목이 없어요.
              </div>
              <p className="text-[11px] text-slate-400">
                회사에 필요한 공제 항목을 만들어 보세요.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.map((it) => (
                <div
                  key={it.id}
                  onClick={() => openEditModal(it)}
                  className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 cursor-pointer shadow-2xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-slate-900">
                        {it.name}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-600">
                        {it.deduction_type}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {it.cycle_mode} · {it.target_scope} ·{" "}
                      {it.amount_mode === "금액 일괄 설정" && it.uniform_amount
                        ? `${it.uniform_amount.toLocaleString()}원`
                        : it.amount_mode}
                    </p>
                  </div>

                  {canEdit && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(it);
                      }}
                      className="px-2.5 py-1 rounded-lg hover:bg-rose-50 text-[11px] font-bold text-slate-400 hover:text-rose-500"
                    >
                      삭제
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 하단 이전/다음 이동 카드 (지급 항목 ← / → 정산 설정) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("payroll-payment")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                지급 항목
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("payroll-settlement")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                정산 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* 공제 항목 추가/수정 모달 (154530 ~ 154546 동일) */}
      {draft && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[500px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            <div className="flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-5">
              <div>
                <input
                  autoFocus={isNew}
                  disabled={!canEdit}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="공제 항목 이름 입력"
                  className="w-full text-xl font-extrabold text-slate-900 placeholder:text-slate-300 focus:outline-none"
                />
                <input
                  disabled={!canEdit}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  placeholder="공제 항목에 대한 설명 입력"
                  className="mt-2 w-full pb-1 border-b border-slate-200 text-slate-600 placeholder:text-slate-400 placeholder:underline focus:outline-none"
                />
              </div>

              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {/* 1) 공제 유형 (15종) */}
                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-slate-800 text-[13px]">
                      공제 유형
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      공제 금액은 선택한 유형으로 합산됩니다.
                    </div>
                  </div>
                  <select
                    disabled={!canEdit}
                    value={draft.deduction_type}
                    onChange={(e) =>
                      setDraft({ ...draft, deduction_type: e.target.value })
                    }
                    className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                  >
                    {DEDUCTION_TYPES.map((dt) => (
                      <option key={dt} value={dt}>
                        {dt}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2) 공제 주기 */}
                <div className="py-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="font-bold text-slate-800 text-[13px]">
                      공제 주기
                    </div>
                    <select
                      disabled={!canEdit}
                      value={draft.cycle_mode}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          cycle_mode: e.target.value as "매 월" | "직접 선택",
                        })
                      }
                      className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                    >
                      <option value="매 월">매 월</option>
                      <option value="직접 선택">직접 선택</option>
                    </select>
                  </div>

                  {draft.cycle_mode === "직접 선택" && (
                    <div className="grid grid-cols-6 gap-1.5 p-2.5 rounded-xl bg-[#f5f6f8]">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
                        const checked = (draft.selected_months || []).includes(
                          m
                        );
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              const cur = draft.selected_months || [];
                              const next = checked
                                ? cur.filter((x) => x !== m)
                                : [...cur, m].sort((a, b) => a - b);
                              setDraft({ ...draft, selected_months: next });
                            }}
                            className={`py-1.5 rounded-lg text-[11px] font-bold ${
                              checked
                                ? "bg-white text-emerald-700 border border-emerald-400"
                                : "text-slate-500"
                            }`}
                          >
                            {m}월
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 3) 공제 대상자 */}
                <div className="py-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800 text-[13px]">
                        공제 대상자
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        이 공제 항목에 한해 지정한 대상자를 불러옵니다.
                      </div>
                    </div>
                    <select
                      disabled={!canEdit}
                      value={draft.target_scope}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          target_scope:
                            e.target.value as HqPayrollDeductionItem["target_scope"],
                        })
                      }
                      className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                    >
                      <option value="대상자 전체">대상자 전체</option>
                      <option value="대상자 선택">대상자 선택</option>
                      <option value="대상자 조건 설정">대상자 조건 설정</option>
                      <option value="정산할 때 대상자 선택">
                        정산할 때 대상자 선택
                      </option>
                    </select>
                  </div>

                  {draft.target_scope === "대상자 선택" && (
                    <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl bg-[#f5f6f8]">
                      {members
                        .filter((m) => m.work_status === "재직")
                        .map((m) => {
                          const checked = (
                            draft.selected_member_names || []
                          ).includes(m.name);
                          return (
                            <button
                              key={m.instructor_id}
                              type="button"
                              onClick={() => {
                                const cur = draft.selected_member_names || [];
                                const next = checked
                                  ? cur.filter((x) => x !== m.name)
                                  : [...cur, m.name];
                                setDraft({
                                  ...draft,
                                  selected_member_names: next,
                                });
                              }}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                                checked
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-400"
                                  : "bg-white text-slate-500 border border-slate-200"
                              }`}
                            >
                              {m.name}
                            </button>
                          );
                        })}
                    </div>
                  )}

                  {draft.target_scope === "대상자 조건 설정" && (
                    <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl bg-[#f5f6f8]">
                      {orgDepts.map((dept) => {
                        const checked = (
                          draft.target_departments || []
                        ).includes(dept);
                        return (
                          <button
                            key={dept}
                            type="button"
                            onClick={() => {
                              const cur = draft.target_departments || [];
                              const next = checked
                                ? cur.filter((x) => x !== dept)
                                : [...cur, dept];
                              setDraft({
                                ...draft,
                                target_departments: next,
                              });
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                              checked
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-400"
                                : "bg-white text-slate-500 border border-slate-200"
                            }`}
                          >
                            {dept}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 4) 공제 금액 */}
                <div className="py-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="font-bold text-slate-800 text-[13px]">
                      공제 금액
                    </div>
                    <select
                      disabled={!canEdit}
                      value={draft.amount_mode}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          amount_mode:
                            e.target.value as HqPayrollDeductionItem["amount_mode"],
                        })
                      }
                      className="w-48 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                    >
                      <option value="금액 일괄 설정">금액 일괄 설정</option>
                      <option value="대상자별로 다른 금액 설정">
                        대상자별로 다른 금액 설정
                      </option>
                      <option value="정산 시 입력">정산 시 입력</option>
                    </select>
                  </div>

                  {draft.amount_mode === "금액 일괄 설정" && (
                    <div className="px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] flex items-center justify-between">
                      <input
                        type="number"
                        value={draft.uniform_amount ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            uniform_amount: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          })
                        }
                        placeholder="일괄 공제할 금액 입력"
                        className="flex-1 bg-transparent font-bold text-slate-900 focus:outline-none"
                      />
                      <span className="text-slate-500 font-semibold">원</span>
                    </div>
                  )}
                </div>

                {/* 5) 급여명세서 표기란 */}
                <div className="py-4 flex items-start justify-between gap-4">
                  <div className="font-bold text-slate-800 text-[13px] pt-2">
                    급여명세서 표기란
                  </div>
                  <textarea
                    rows={3}
                    disabled={!canEdit}
                    value={draft.payslip_note}
                    onChange={(e) =>
                      setDraft({ ...draft, payslip_note: e.target.value })
                    }
                    placeholder="내용 입력"
                    className="w-48 p-3 rounded-xl bg-[#f5f6f8] text-slate-800 placeholder:text-slate-400 focus:outline-none resize-none"
                  />
                </div>
              </div>
            </div>

            {canEdit && (
              <div className="pt-5 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:opacity-95 text-white text-xs font-extrabold shadow-md"
                >
                  {saving ? "저장 중..." : "저장하기"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
