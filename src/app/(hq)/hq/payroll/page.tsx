// src/app/(hq)/hq/payroll/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import BankTransferModal from "@/components/hq/payroll/BankTransferModal";
import SeveranceCalculatorPanel from "@/components/hq/payroll/SeveranceCalculatorPanel";
import TaxAccountantPrepPanel from "@/components/hq/payroll/TaxAccountantPrepPanel";
import TaxLedgerUploadModal from "@/components/hq/payroll/TaxLedgerUploadModal";
import {
  hqFetch,
  resolveStoragePublicUrl,
} from "@/lib/hq/clientApi";
import {
  calculatePayrollAmounts,
  PAYROLL_TYPE_META,
} from "@/lib/hq/constants";
import type {
  HqApprovalDoc,
  HqAttendanceRecord,
  HqPayrollRecord,
  HqPayrollStatus,
  HqPayrollType,
} from "@/lib/hq/types";

type MainWorkspaceTab = "LEDGER" | "TAX_PREP" | "SEVERANCE";
type TypeTab = "ALL" | HqPayrollType;

interface PubQuickItem {
  pub_id: string;
  book_code: string;
  title: string;
  author_name: string | null;
  list_price: number;
  print_run: number;
}

function resolveSealUrl(raw?: string | null): string | null {
  if (!raw) return null;
  if (
    raw.startsWith("data:") ||
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("/")
  ) {
    return raw;
  }
  return resolveStoragePublicUrl(raw);
}

export default function HqPayrollPage() {
  const { me, members, companySettings, isHrManager } = useHqShell();

  const currentYm = useMemo(() => {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 7);
  }, []);

  const [mainTab, setMainTab] = useState<MainWorkspaceTab>("LEDGER");
  const [month, setMonth] = useState<string>(currentYm);
  const [typeTab, setTypeTab] = useState<TypeTab>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [records, setRecords] = useState<HqPayrollRecord[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<HqAttendanceRecord[]>([]);
  const [leaveDocs, setLeaveDocs] = useState<HqApprovalDoc[]>([]);
  const [publications, setPublications] = useState<PubQuickItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 전용 모달 상태
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [bankModalOpen, setBankModalOpen] = useState(false);

  // 단건 등록/수정 모달
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [payType, setPayType] = useState<HqPayrollType>("EMPLOYEE");
  const [memberId, setMemberId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [deptOrRole, setDeptOrRole] = useState("");
  const [residentOrBizNo, setResidentOrBizNo] = useState("");
  const [bankInfo, setBankInfo] = useState("");
  const [bookOrProject, setBookOrProject] = useState("");
  const [basePay, setBasePay] = useState("2800000");
  const [mealAllowance, setMealAllowance] = useState("200000");
  const [overtimePay, setOvertimePay] = useState("0");
  const [bonusPay, setBonusPay] = useState("0");
  const [payDate, setPayDate] = useState("");
  const [memo, setMemo] = useState("");

  // 공제 산출 모드 (AUTO: 요율 자동계산 / EXACT: 세무사 확정 공제액 직접입력·유지)
  const [deductionMode, setDeductionMode] = useState<"AUTO" | "EXACT">("AUTO");
  const [exactNp, setExactNp] = useState("0");
  const [exactHi, setExactHi] = useState("0");
  const [exactLtc, setExactLtc] = useState("0");
  const [exactEi, setExactEi] = useState("0");
  const [exactItax, setExactItax] = useState("0");
  const [exactLtax, setExactLtax] = useState("0");
  const [exactOtherDeduct, setExactOtherDeduct] = useState("0");

  // 저자 인세 전용 자동 산출 보조 입력
  const [bookPrice, setBookPrice] = useState("15000");
  const [salesCopies, setSalesCopies] = useState("2000");
  const [royaltyPct, setRoyaltyPct] = useState("10");
  const [advanceDeduct, setAdvanceDeduct] = useState("0");

  // A4 급여명세서 / 지급명세서 모달
  const [statementModal, setStatementModal] =
    useState<HqPayrollRecord | null>(null);

  const companyName =
    companySettings?.company_name || "(주)천종현수학연구소";
  const defaultSeal = useMemo(() => {
    const seals = companySettings?.seals || [];
    const found = seals.find((s) => s.is_default) || seals[0];
    return found ? resolveSealUrl(found.image_url) : null;
  }, [companySettings]);

  const loadPayroll = useCallback(async () => {
    setLoading(true);
    try {
      const ctxFlag = isHrManager ? "&include_context=1" : "";
      const res = await hqFetch<{
        success: boolean;
        data: {
          records: HqPayrollRecord[];
          attendanceRows?: HqAttendanceRecord[];
          leaveDocs?: HqApprovalDoc[];
          publications?: PubQuickItem[];
        };
      }>(`/api/hq/payroll?month=${month}${ctxFlag}`);
      setRecords(res.data?.records || []);
      if (res.data?.attendanceRows) setAttendanceRows(res.data.attendanceRows);
      if (res.data?.leaveDocs) setLeaveDocs(res.data.leaveDocs);
      if (res.data?.publications) setPublications(res.data.publications);
      setSelectedIds(new Set());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [month, isHrManager]);

  useEffect(() => {
    loadPayroll();
  }, [loadPayroll]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status === "재직"),
    [members]
  );

  // 실시간 세액/4대보험 미리보기
  const autoPreview = useMemo(
    () =>
      calculatePayrollAmounts({
        payType,
        basePay: Number(basePay || 0),
        mealAllowance: Number(mealAllowance || 0),
        overtimePay: Number(overtimePay || 0),
        bonusPay: Math.max(0, Number(bonusPay || 0)),
      }),
    [payType, basePay, mealAllowance, overtimePay, bonusPay]
  );

  const previewCalc = useMemo(() => {
    if (deductionMode !== "EXACT") {
      return { ...autoPreview, otherDeduction: 0 };
    }
    const gross =
      payType === "EMPLOYEE"
        ? Number(basePay || 0) +
          Number(mealAllowance || 0) +
          Number(overtimePay || 0) +
          Number(bonusPay || 0)
        : Number(basePay || 0) + Number(bonusPay || 0);
    const np = Number(exactNp || 0);
    const hi = Number(exactHi || 0);
    const ltc = Number(exactLtc || 0);
    const ei = Number(exactEi || 0);
    const itax = Number(exactItax || 0);
    const ltax = Number(exactLtax || 0);
    const other = Number(exactOtherDeduct || 0);
    const deduct = np + hi + ltc + ei + itax + ltax + other;
    return {
      grossAmount: gross,
      nationalPension: np,
      healthInsurance: hi,
      longTermCare: ltc,
      employmentInsurance: ei,
      incomeTax: itax,
      localIncomeTax: ltax,
      otherDeduction: other,
      deductionTotal: deduct,
      netAmount: Math.max(0, gross - deduct),
    };
  }, [
    deductionMode,
    autoPreview,
    payType,
    basePay,
    mealAllowance,
    overtimePay,
    bonusPay,
    exactNp,
    exactHi,
    exactLtc,
    exactEi,
    exactItax,
    exactLtax,
    exactOtherDeduct,
  ]);

  const switchToExactFromAuto = () => {
    setExactNp(String(autoPreview.nationalPension));
    setExactHi(String(autoPreview.healthInsurance));
    setExactLtc(String(autoPreview.longTermCare));
    setExactEi(String(autoPreview.employmentInsurance));
    setExactItax(String(autoPreview.incomeTax));
    setExactLtax(String(autoPreview.localIncomeTax));
    setExactOtherDeduct("0");
    setDeductionMode("EXACT");
  };

  const applyRoyaltyFormula = () => {
    const grossRoyalty = Math.round(
      Number(bookPrice || 0) *
        Number(salesCopies || 0) *
        (Number(royaltyPct || 0) / 100)
    );
    const payable = Math.max(0, grossRoyalty - Number(advanceDeduct || 0));
    setBasePay(String(payable));
    setBonusPay("0");
  };

  const applyMemberDefaults = (m: (typeof members)[number]) => {
    setMemberId(m.instructor_id);
    setPayeeName(m.name);
    setDeptOrRole(`${m.department} · ${m.job_title}`);
    setBankInfo(
      [m.bank_name, m.bank_account, m.account_holder].filter(Boolean).join(" ")
    );
    const wc = m.profile_extra?.wage_contract;
    const meal =
      wc?.meal_allowance !== undefined ? Number(wc.meal_allowance) : 200_000;
    const base = wc?.monthly_base
      ? Number(wc.monthly_base)
      : wc?.annual_salary
      ? Math.max(0, Math.round(Number(wc.annual_salary) / 12) - meal)
      : 2_800_000;
    setBasePay(String(base));
    setMealAllowance(String(meal));
    setOvertimePay("0");
    setBonusPay("0");
  };

  const openCreateModal = (presetType: HqPayrollType) => {
    setEditingId(null);
    setPayType(presetType);
    const effMonth = month === "ALL" ? currentYm : month;
    setPayDate(`${effMonth}-25`);
    setMemo("");
    setBookOrProject("");
    setResidentOrBizNo("");
    setDeductionMode("AUTO");
    setExactOtherDeduct("0");

    if (presetType === "EMPLOYEE" && activeMembers.length > 0) {
      applyMemberDefaults(activeMembers[0]);
    } else {
      setMemberId("");
      setPayeeName("");
      setDeptOrRole(
        presetType === "ROYALTY"
          ? "집필 저자"
          : presetType === "OTHER_88"
          ? "문항 검토·원고 자문"
          : "외주 디자이너·조판"
      );
      setBankInfo("");
      setBasePay(presetType === "ROYALTY" ? "3000000" : "1000000");
      setMealAllowance("0");
      setOvertimePay("0");
      setBonusPay("0");
    }
    setFormOpen(true);
  };

  const openEditModal = (r: HqPayrollRecord) => {
    setEditingId(r.payroll_id);
    setPayType(r.pay_type);
    setMemberId(r.member_id || "");
    setPayeeName(r.payee_name);
    setDeptOrRole(r.department_or_role);
    setResidentOrBizNo(r.calc_meta?.resident_or_biz_no || "");
    setBankInfo(r.bank_info || "");
    setBookOrProject(r.book_or_project || "");
    setBasePay(String(r.base_pay));
    setMealAllowance(String(r.meal_allowance));
    setOvertimePay(String(r.overtime_pay));
    setBonusPay(String(r.bonus_pay));
    setPayDate(r.pay_date || `${r.pay_month}-25`);
    setMemo(r.memo || "");

    if (r.pay_type === "ROYALTY" && r.calc_meta) {
      if (r.calc_meta.bookPrice) setBookPrice(String(r.calc_meta.bookPrice));
      if (r.calc_meta.salesCopies) setSalesCopies(String(r.calc_meta.salesCopies));
      if (r.calc_meta.royaltyPct) setRoyaltyPct(String(r.calc_meta.royaltyPct));
      if (r.calc_meta.advanceDeduct !== undefined)
        setAdvanceDeduct(String(r.calc_meta.advanceDeduct));
    }

    const mode = r.calc_meta?.deduction_mode === "EXACT" ? "EXACT" : "AUTO";
    setDeductionMode(mode);
    setExactNp(String(r.national_pension || 0));
    setExactHi(String(r.health_insurance || 0));
    setExactLtc(String(r.long_term_care || 0));
    setExactEi(String(r.employment_insurance || 0));
    setExactItax(String(r.income_tax || 0));
    setExactLtax(String(r.local_income_tax || 0));
    setExactOtherDeduct(String(r.calc_meta?.other_deduction || 0));

    setFormOpen(true);
  };

  const handleSelectMember = (id: string) => {
    const m = activeMembers.find((x) => x.instructor_id === id);
    if (!m) return;
    applyMemberDefaults(m);
  };

  const handleQuickPickBook = (pubId: string) => {
    const pub = publications.find((p) => p.pub_id === pubId);
    if (!pub) return;
    setBookOrProject(pub.title);
    if (pub.list_price > 0) setBookPrice(String(pub.list_price));
    if (pub.print_run > 0) setSalesCopies(String(pub.print_run));
    if (!payeeName && pub.author_name && payType === "ROYALTY") {
      setPayeeName(pub.author_name);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const commonDeductionFields =
        deductionMode === "EXACT"
          ? {
              deduction_mode: "EXACT",
              national_pension: Number(exactNp || 0),
              health_insurance: Number(exactHi || 0),
              long_term_care: Number(exactLtc || 0),
              employment_insurance: Number(exactEi || 0),
              income_tax: Number(exactItax || 0),
              local_income_tax: Number(exactLtax || 0),
              other_deduction: Number(exactOtherDeduct || 0),
            }
          : {
              deduction_mode: "AUTO",
            };

      const calcMetaPayload =
        payType === "ROYALTY"
          ? {
              bookPrice: Number(bookPrice || 0),
              salesCopies: Number(salesCopies || 0),
              royaltyPct: Number(royaltyPct || 0),
              advanceDeduct: Number(advanceDeduct || 0),
            }
          : {};

      if (editingId) {
        await hqFetch("/api/hq/payroll", {
          method: "PATCH",
          body: {
            payroll_id: editingId,
            pay_type: payType,
            payee_name: payeeName,
            department_or_role: deptOrRole,
            resident_or_biz_no: residentOrBizNo,
            bank_info: bankInfo,
            book_or_project: bookOrProject,
            base_pay: Number(basePay || 0),
            meal_allowance: Number(mealAllowance || 0),
            overtime_pay: Number(overtimePay || 0),
            bonus_pay: Number(bonusPay || 0),
            calc_meta: calcMetaPayload,
            pay_date: payDate,
            memo,
            ...commonDeductionFields,
          },
        });
      } else {
        await hqFetch("/api/hq/payroll", {
          method: "POST",
          body: {
            action: "CREATE_SINGLE",
            pay_month: month === "ALL" ? currentYm : month,
            pay_type: payType,
            member_id: payType === "EMPLOYEE" && memberId ? memberId : null,
            payee_name: payeeName,
            department_or_role: deptOrRole,
            resident_or_biz_no: residentOrBizNo,
            bank_info: bankInfo,
            book_or_project: bookOrProject,
            base_pay: Number(basePay || 0),
            meal_allowance: Number(mealAllowance || 0),
            overtime_pay: Number(overtimePay || 0),
            bonus_pay: Number(bonusPay || 0),
            calc_meta: calcMetaPayload,
            status: "CONFIRMED",
            pay_date: payDate,
            memo,
            ...commonDeductionFields,
          },
        });
      }
      setFormOpen(false);
      await loadPayroll();
    } catch (err: any) {
      alert(err?.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleBatchSeedEmployees = async () => {
    if (month === "ALL") {
      alert("특정 귀속월(YYYY-MM)을 먼저 선택해 주세요.");
      return;
    }
    if (
      !confirm(
        `${month} 귀속월 재직 임직원(${activeMembers.length}명) 급여대장 초안을 일괄 생성하시겠습니까?\n(전월 급여 또는 임금계약 기준 금액을 자동으로 불러옵니다.)`
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { createdCount: number };
      }>("/api/hq/payroll", {
        method: "POST",
        body: {
          action: "COPY_PREV_OR_SEED",
          pay_month: month,
          members: activeMembers,
        },
      });
      alert(
        res.data.createdCount > 0
          ? `${res.data.createdCount}명의 급여대장 초안이 생성되었습니다.`
          : "이미 모든 재직 구성원의 당월 급여 내역이 존재합니다."
      );
      await loadPayroll();
    } catch (err: any) {
      alert(err?.message || "일괄 생성 실패");
    } finally {
      setSaving(false);
    }
  };

  const handlePublishAllDrafts = async () => {
    if (month === "ALL") return;
    const draftCnt = records.filter((r) => r.status === "DRAFT").length;
    if (draftCnt === 0) return;
    if (
      !confirm(
        `${month} 귀속 미배부 초안 ${draftCnt}건을 확정하여 전 직원 계정에 급여명세서를 일괄 배부하시겠습니까?`
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      await hqFetch("/api/hq/payroll", {
        method: "PATCH",
        body: {
          action: "PUBLISH_ALL_DRAFTS",
          pay_month: month,
        },
      });
      await loadPayroll();
    } catch (err: any) {
      alert(err?.message || "일괄 배부 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleBulkStatus = async (
    status: HqPayrollStatus,
    explicitIds?: string[]
  ) => {
    const targetIds = explicitIds || Array.from(selectedIds);
    if (targetIds.length === 0) return;
    setSaving(true);
    try {
      await hqFetch("/api/hq/payroll", {
        method: "PATCH",
        body: {
          payroll_ids: targetIds,
          status,
        },
      });
      await loadPayroll();
    } catch (err: any) {
      alert(err?.message || "상태 변경 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        `선택한 ${selectedIds.size}건의 정산 내역을 삭제하시겠습니까?`
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const idsParam = Array.from(selectedIds).join(",");
      await hqFetch(`/api/hq/payroll?ids=${encodeURIComponent(idsParam)}`, {
        method: "DELETE",
      });
      await loadPayroll();
    } catch (err: any) {
      alert(err?.message || "일괄 삭제 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("해당 정산 내역을 삭제하시겠습니까?")) return;
    try {
      await hqFetch(`/api/hq/payroll?id=${id}`, { method: "DELETE" });
      await loadPayroll();
    } catch (err: any) {
      alert(err?.message || "삭제 실패");
    }
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records.filter((r) => {
      if (typeTab !== "ALL" && r.pay_type !== typeTab) return false;
      if (!q) return true;
      return (
        r.payee_name.toLowerCase().includes(q) ||
        (r.department_or_role || "").toLowerCase().includes(q) ||
        (r.book_or_project || "").toLowerCase().includes(q) ||
        (r.memo || "").toLowerCase().includes(q)
      );
    });
  }, [records, typeTab, searchQuery]);

  const draftCount = useMemo(
    () => records.filter((r) => r.status === "DRAFT").length,
    [records]
  );

  const summary = useMemo(() => {
    let totalGross = 0;
    let totalNet = 0;
    let paidNet = 0;
    let withholdingTax = 0;
    let fourInsTotal = 0;
    records.forEach((r) => {
      totalGross += Number(r.gross_amount || 0);
      totalNet += Number(r.net_amount || 0);
      if (r.status === "PAID") paidNet += Number(r.net_amount || 0);
      withholdingTax +=
        Number(r.income_tax || 0) + Number(r.local_income_tax || 0);
      fourInsTotal +=
        Number(r.national_pension || 0) +
        Number(r.health_insurance || 0) +
        Number(r.long_term_care || 0) +
        Number(r.employment_insurance || 0);
    });
    return { totalGross, totalNet, paidNet, withholdingTax, fourInsTotal };
  }, [records]);

  const allFilteredSelected =
    filtered.length > 0 &&
    filtered.every((r) => selectedIds.has(r.payroll_id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((r) => r.payroll_id)));
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <div
        className={`w-full px-6 py-6 space-y-5 ${
          statementModal ? "print:hidden" : ""
        }`}
      >
        {/* 상단 워크스페이스 탭 + 귀속월 컨트롤 바 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          {isHrManager ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["LEDGER", "💰 급여 · 외주 · 인세 대장"],
                  ["TAX_PREP", "📤 세무사 전달 기초자료"],
                  ["SEVERANCE", "🧮 퇴직금 계산기"],
                ] as [MainWorkspaceTab, string][]
              ).map(([tabKey, label]) => (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setMainTab(tabKey)}
                  className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all ${
                    mainTab === tabKey
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-brand text-xs font-extrabold">
                내 급여명세서 보관함
              </span>
              <span className="text-xs font-semibold text-slate-500">
                🔒 본인에게 배부된 급여명세서만 안전하게 열람·인쇄할 수 있습니다 ({me?.name})
              </span>
            </div>
          )}

          {mainTab !== "SEVERANCE" && (
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={month === "ALL" ? "" : month}
                onChange={(e) => setMonth(e.target.value || "ALL")}
                className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-extrabold text-slate-900"
              />
              <button
                type="button"
                onClick={() => setMonth(month === "ALL" ? currentYm : "ALL")}
                className={`px-3 py-2 rounded-xl text-xs font-bold ${
                  month === "ALL"
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {month === "ALL" ? "당월로 보기" : "전체 기간"}
              </button>
            </div>
          )}
        </div>

        {/* 탭 2: 세무사 전달 기초자료 */}
        {isHrManager && mainTab === "TAX_PREP" && (
          <TaxAccountantPrepPanel
            companyName={companyName}
            payMonth={month}
            members={members}
            payrollRecords={records}
            attendanceRows={attendanceRows}
            leaveDocs={leaveDocs}
            onSelectCurrentMonth={() => setMonth(currentYm)}
            onQuickCreate={(t) => {
              setMainTab("LEDGER");
              openCreateModal(t);
            }}
          />
        )}

        {/* 탭 3: 퇴직금 간편 계산기 */}
        {isHrManager && mainTab === "SEVERANCE" && (
          <SeveranceCalculatorPanel
            companyName={companyName}
            members={members}
          />
        )}

        {/* 탭 1: 급여 · 외주 · 인세 대장 (관리자 & 일반직원 공통 메인) */}
        {(!isHrManager || mainTab === "LEDGER") && (
          <>
            {/* 인사·재무 관리자 전용 실무 액션 툴바 */}
            {isHrManager && (
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (month === "ALL") {
                        setMonth(currentYm);
                      }
                      setUploadModalOpen(true);
                    }}
                    className="px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold shadow-xs"
                  >
                    📥 세무사 급여대장 엑셀 업로드
                  </button>

                  {month !== "ALL" && draftCount > 0 && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handlePublishAllDrafts}
                      className="px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-xs"
                    >
                      📨 미배부 명세서 1클릭 일괄 배부 ({draftCount}건)
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setBankModalOpen(true)}
                    className="px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold"
                  >
                    🏦 은행 대량이체 파일 추출
                  </button>

                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleBatchSeedEmployees}
                    className="px-3 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold"
                  >
                    ⚡ 전월·계약기준 초안 생성
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openCreateModal("EMPLOYEE")}
                    className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold"
                  >
                    + 임직원 급여
                  </button>
                  <button
                    type="button"
                    onClick={() => openCreateModal("FREELANCER_33")}
                    className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold"
                  >
                    + 외주 3.3%
                  </button>
                  <button
                    type="button"
                    onClick={() => openCreateModal("OTHER_88")}
                    className="px-3 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 text-xs font-bold"
                  >
                    + 원고·검토 8.8%
                  </button>
                  <button
                    type="button"
                    onClick={() => openCreateModal("ROYALTY")}
                    className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold"
                  >
                    + 저자 인세 정산
                  </button>
                </div>
              </div>
            )}

            {/* 요약 KPI 4종 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                <div className="text-xs font-bold text-slate-500">
                  {isHrManager ? "지급 총액 (세전)" : "내 세전 급여 합계"}
                </div>
                <div className="text-2xl font-black text-slate-900 mt-1 tabular-nums">
                  {summary.totalGross.toLocaleString("ko-KR")}원
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  총 {records.length}건 집계
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                <div className="text-xs font-bold text-slate-500">
                  실지급 이체 금액 (세후)
                </div>
                <div className="text-2xl font-black text-brand mt-1 tabular-nums">
                  {summary.totalNet.toLocaleString("ko-KR")}원
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {isHrManager
                    ? `이체완료 ${summary.paidNet.toLocaleString("ko-KR")}원 · 미이체 ${Math.max(
                        0,
                        summary.totalNet - summary.paidNet
                      ).toLocaleString("ko-KR")}원`
                    : "4대보험 · 소득세 공제 후 실수령액"}
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                <div className="text-xs font-bold text-slate-500">
                  {isHrManager
                    ? "익월 10일 원천세 예수금 (소득+지방세)"
                    : "공제 소득세 · 지방소득세"}
                </div>
                <div className="text-2xl font-black text-amber-600 mt-1 tabular-nums">
                  {summary.withholdingTax.toLocaleString("ko-KR")}원
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {isHrManager
                    ? "근로소득세 + 사업(3.3%) + 기타(8.8%) 합산"
                    : "원천징수 세액 합계"}
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                <div className="text-xs font-bold text-slate-500">
                  4대보험 근로자 부담분 합계
                </div>
                <div className="text-2xl font-black text-emerald-700 mt-1 tabular-nums">
                  {summary.fourInsTotal.toLocaleString("ko-KR")}원
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  국민연금 · 건강 · 장기요양 · 고용보험
                </div>
              </div>
            </div>

            {/* 정산 목록 테이블 */}
            <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      ["ALL", "전체 내역"],
                      ["EMPLOYEE", "임직원 급여"],
                      ["FREELANCER_33", "외주 프리랜서 (3.3%)"],
                      ["OTHER_88", "원고·검토 (8.8%)"],
                      ["ROYALTY", "저자 인세"],
                    ] as [TypeTab, string][]
                  ).map(([k, label]) => {
                    if (!isHrManager && k !== "ALL" && k !== "EMPLOYEE")
                      return null;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setTypeTab(k)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                          typeTab === k
                            ? "bg-brand text-white"
                            : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isHrManager && selectedIds.size > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pr-2 border-r border-slate-200">
                      <span className="text-xs font-extrabold text-brand mr-1">
                        {selectedIds.size}건 선택
                      </span>
                      <button
                        type="button"
                        onClick={() => handleBulkStatus("CONFIRMED")}
                        className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                      >
                        명세서 배부 확정
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkStatus("PAID")}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                      >
                        이체완료 처리
                      </button>
                      <button
                        type="button"
                        onClick={() => setBankModalOpen(true)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold"
                      >
                        선택 건 이체파일
                      </button>
                      <button
                        type="button"
                        onClick={handleBulkDelete}
                        className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold"
                      >
                        선택 삭제
                      </button>
                    </div>
                  )}

                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="성명 · 부서 · 도서명 검색"
                    className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs w-48 focus:outline-none focus:border-brand"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500 uppercase whitespace-nowrap">
                      {isHrManager && (
                        <th className="py-3 px-4 w-10">
                          <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={toggleSelectAll}
                            title="전체 선택"
                            className="w-4 h-4 accent-brand rounded cursor-pointer"
                          />
                        </th>
                      )}
                      <th className="py-3 px-4">귀속월 / 구분</th>
                      <th className="py-3 px-4">수령인 · 소속/도서명</th>
                      <th className="py-3 px-4 text-right">지급 총액(세전)</th>
                      <th className="py-3 px-4 text-right">공제 · 원천세</th>
                      <th className="py-3 px-4 text-right">실지급액(세후)</th>
                      <th className="py-3 px-4">지급계좌 / 상태</th>
                      <th className="py-3 px-4 text-right">명세서 · 관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {loading ? (
                      <tr>
                        <td
                          colSpan={isHrManager ? 8 : 7}
                          className="py-12 text-center text-slate-400"
                        >
                          정산 데이터를 불러오는 중입니다...
                        </td>
                      </tr>
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td
                          colSpan={isHrManager ? 8 : 7}
                          className="py-14 text-center text-slate-400 space-y-2"
                        >
                          <div>등록된 급여 · 원천세 · 인세 내역이 없습니다.</div>
                          {isHrManager && (
                            <div className="text-[11px] text-slate-400">
                              상단 [📥 세무사 급여대장 엑셀 업로드]를 누르면 세무사 급여대장 한 파일로 전 직원 명세서를 바로 배부할 수 있습니다.
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : (
                      filtered.map((r) => {
                        const meta = PAYROLL_TYPE_META[r.pay_type];
                        const isExact = r.calc_meta?.deduction_mode === "EXACT";
                        return (
                          <tr key={r.payroll_id} className="hover:bg-slate-50">
                            {isHrManager && (
                              <td className="py-3.5 px-4">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(r.payroll_id)}
                                  onChange={() => toggleRow(r.payroll_id)}
                                  className="w-4 h-4 accent-brand rounded cursor-pointer"
                                />
                              </td>
                            )}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="font-extrabold text-slate-800">
                                {r.pay_month}
                              </div>
                              <div className="flex items-center gap-1 mt-1">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded border text-[10px] font-bold ${meta.badgeClass}`}
                                >
                                  {meta.shortLabel}
                                </span>
                                {isExact && (
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-slate-800 text-white text-[9px] font-bold">
                                    확정액
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-extrabold text-slate-900">
                                {r.payee_name}{" "}
                                <span className="text-slate-400 font-semibold">
                                  ({r.department_or_role})
                                </span>
                              </div>
                              {r.book_or_project && (
                                <div className="text-[11px] text-brand font-semibold mt-0.5">
                                  📚 {r.book_or_project}
                                </div>
                              )}
                              {r.memo && (
                                <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[280px]">
                                  {r.memo}
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right font-bold text-slate-800 tabular-nums whitespace-nowrap">
                              {r.gross_amount.toLocaleString("ko-KR")}원
                            </td>
                            <td className="py-3.5 px-4 text-right text-rose-600 font-bold tabular-nums whitespace-nowrap">
                              -{r.deduction_total.toLocaleString("ko-KR")}원
                            </td>
                            <td className="py-3.5 px-4 text-right font-black text-brand tabular-nums whitespace-nowrap">
                              {r.net_amount.toLocaleString("ko-KR")}원
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="text-[11px] text-slate-500">
                                {r.bank_info || "계좌 미기재"}
                              </div>
                              <span
                                className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                  r.status === "PAID"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : r.status === "CONFIRMED"
                                    ? "bg-blue-50 text-blue-700"
                                    : "bg-amber-50 text-amber-800"
                                }`}
                              >
                                {r.status === "PAID"
                                  ? "이체완료"
                                  : r.status === "CONFIRMED"
                                  ? "명세서 배부됨"
                                  : "작성 초안 (미배부)"}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1.5">
                              <button
                                type="button"
                                onClick={() => setStatementModal(r)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold"
                              >
                                📄 명세서
                              </button>
                              {isHrManager && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEditModal(r)}
                                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-bold"
                                  >
                                    수정
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(r.payroll_id)}
                                    className="px-2 py-1.5 rounded-lg hover:bg-rose-50 text-rose-600 font-bold"
                                  >
                                    삭제
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      {/* 세무사 급여대장 엑셀 업로드 모달 */}
      <TaxLedgerUploadModal
        open={uploadModalOpen}
        payMonth={month === "ALL" ? currentYm : month}
        members={members}
        onClose={() => setUploadModalOpen(false)}
        onSuccess={loadPayroll}
      />

      {/* 은행 대량이체 파일 추출 모달 */}
      <BankTransferModal
        open={bankModalOpen}
        payMonth={month}
        companyName={companyName}
        records={records}
        selectedIds={selectedIds}
        members={members}
        onClose={() => setBankModalOpen(false)}
        onMarkPaid={(ids) => handleBulkStatus("PAID", ids)}
      />

      {/* 급여 · 원천세 · 인세 단건 등록/수정 모달 */}
      {formOpen && (
        <div
          onClick={() => setFormOpen(false)}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 print:hidden"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto custom-scroll p-6 shadow-2xl border border-slate-200"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  {editingId
                    ? "정산 내역 수정"
                    : PAYROLL_TYPE_META[payType].label}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {PAYROLL_TYPE_META[payType].taxSummary}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 space-y-4 text-xs">
              {!editingId && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.keys(PAYROLL_TYPE_META) as HqPayrollType[]).map(
                    (k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => openCreateModal(k)}
                        className={`p-2.5 rounded-xl border font-bold text-center ${
                          payType === k
                            ? "border-brand bg-blue-50 text-brand"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {PAYROLL_TYPE_META[k].shortLabel}
                      </button>
                    )
                  )}
                </div>
              )}

              {payType === "EMPLOYEE" && !editingId && (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    본부 구성원 선택 (급여 계좌 · 임금계약 자동 연동)
                  </label>
                  <select
                    value={memberId}
                    onChange={(e) => handleSelectMember(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
                  >
                    {activeMembers.map((m) => (
                      <option key={m.instructor_id} value={m.instructor_id}>
                        {m.name} ({m.department} · {m.job_title})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    수령인 성명 (상호)
                  </label>
                  <input
                    required
                    value={payeeName}
                    onChange={(e) => setPayeeName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    소속 부서 또는 외주 역할
                  </label>
                  <input
                    value={deptOrRole}
                    onChange={(e) => setDeptOrRole(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    입금 은행 · 계좌번호
                  </label>
                  <input
                    value={bankInfo}
                    onChange={(e) => setBankInfo(e.target.value)}
                    placeholder="예: 신한 110-XXX-XXXXXX 홍길동"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>

                {payType !== "EMPLOYEE" ? (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      주민등록번호 / 사업자번호 (세무사 원천세 신고용 메모)
                    </label>
                    <input
                      value={residentOrBizNo}
                      onChange={(e) => setResidentOrBizNo(e.target.value)}
                      placeholder="예: 850101-1****** 또는 123-45-67890"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      지급 예정일
                    </label>
                    <input
                      type="date"
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                )}
              </div>

              {/* 외주 · 인세 도서 연동 */}
              {payType !== "EMPLOYEE" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      대상 도서명 / 프로젝트
                    </label>
                    <input
                      value={bookOrProject}
                      onChange={(e) => setBookOrProject(e.target.value)}
                      placeholder="예: 창의사고력 수학 S단계"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300"
                    />
                  </div>
                  {publications.length > 0 && (
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        출판 공정 보드 도서에서 빠른 불러오기
                      </label>
                      <select
                        defaultValue=""
                        onChange={(e) => handleQuickPickBook(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                      >
                        <option value="">도서 선택 시 제목·정가 자동 입력...</option>
                        {publications.map((p) => (
                          <option key={p.pub_id} value={p.pub_id}>
                            {p.title}{" "}
                            {p.list_price
                              ? `(정가 ${p.list_price.toLocaleString()}원)`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* 저자 인세 계산 보조기 */}
              {payType === "ROYALTY" && (
                <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-emerald-900">
                      📖 저자 인세 자동 계산기 (정가 × 부수 × 인세율 − 기지급 선인세)
                    </span>
                    <button
                      type="button"
                      onClick={applyRoyaltyFormula}
                      className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                    >
                      계산 금액 적용
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-emerald-800">
                        도서 정가(원)
                      </label>
                      <input
                        type="number"
                        value={bookPrice}
                        onChange={(e) => setBookPrice(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-white font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-emerald-800">
                        발행/판매 부수
                      </label>
                      <input
                        type="number"
                        value={salesCopies}
                        onChange={(e) => setSalesCopies(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-white font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-emerald-800">
                        인세율(%)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        value={royaltyPct}
                        onChange={(e) => setRoyaltyPct(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-white font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-emerald-800">
                        기지급 선인세 차감
                      </label>
                      <input
                        type="number"
                        value={advanceDeduct}
                        onChange={(e) => setAdvanceDeduct(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-white font-bold"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 지급 항목 입력 */}
              {payType === "EMPLOYEE" ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      기본급 (원)
                    </label>
                    <input
                      type="number"
                      value={basePay}
                      onChange={(e) => setBasePay(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      비과세 식대 (원)
                    </label>
                    <input
                      type="number"
                      value={mealAllowance}
                      onChange={(e) => setMealAllowance(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      연장·마감수당 (원)
                    </label>
                    <input
                      type="number"
                      value={overtimePay}
                      onChange={(e) => setOvertimePay(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      상여·기타수당 (원)
                    </label>
                    <input
                      type="number"
                      value={bonusPay}
                      onChange={(e) => setBonusPay(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      세전 공급가액 / 정산 인세 (원)
                    </label>
                    <input
                      type="number"
                      value={basePay}
                      onChange={(e) => setBasePay(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-extrabold text-brand"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      지급 예정일
                    </label>
                    <input
                      type="date"
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
                    />
                  </div>
                </div>
              )}

              {/* 임직원 전용: 요율 자동계산 vs 세무사 확정 공제액 직접입력 전환 */}
              {payType === "EMPLOYEE" && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-extrabold text-slate-800">
                      4대보험 · 세액 산출 방식
                    </span>
                    <div className="inline-flex rounded-lg bg-slate-200/80 p-0.5">
                      <button
                        type="button"
                        onClick={() => setDeductionMode("AUTO")}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold ${
                          deductionMode === "AUTO"
                            ? "bg-white text-slate-900 shadow-2xs"
                            : "text-slate-600"
                        }`}
                      >
                        요율 자동 계산
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (deductionMode !== "EXACT") {
                            switchToExactFromAuto();
                          }
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold ${
                          deductionMode === "EXACT"
                            ? "bg-slate-900 text-white shadow-2xs"
                            : "text-slate-600"
                        }`}
                      >
                        세무사 확정액 직접입력
                      </button>
                    </div>
                  </div>

                  {deductionMode === "EXACT" && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600">
                          국민연금
                        </label>
                        <input
                          type="number"
                          value={exactNp}
                          onChange={(e) => setExactNp(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600">
                          건강보험
                        </label>
                        <input
                          type="number"
                          value={exactHi}
                          onChange={(e) => setExactHi(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600">
                          장기요양보험
                        </label>
                        <input
                          type="number"
                          value={exactLtc}
                          onChange={(e) => setExactLtc(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600">
                          고용보험
                        </label>
                        <input
                          type="number"
                          value={exactEi}
                          onChange={(e) => setExactEi(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600">
                          소득세
                        </label>
                        <input
                          type="number"
                          value={exactItax}
                          onChange={(e) => setExactItax(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600">
                          지방소득세
                        </label>
                        <input
                          type="number"
                          value={exactLtax}
                          onChange={(e) => setExactLtax(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[11px] font-bold text-slate-600">
                          기타·정산공제 (환급은 음수 - 입력 가능)
                        </label>
                        <input
                          type="number"
                          value={exactOtherDeduct}
                          onChange={(e) => setExactOtherDeduct(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 실시간 공제·실지급액 미리보기 박스 */}
              <div className="p-4 rounded-xl bg-slate-900 text-white space-y-2">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>세전 지급 총액</span>
                  <span className="font-bold text-white">
                    {previewCalc.grossAmount.toLocaleString("ko-KR")}원
                  </span>
                </div>
                {payType === "EMPLOYEE" && (
                  <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      국민연금 {previewCalc.nationalPension.toLocaleString()}원
                    </span>
                    <span>
                      건강보험 {previewCalc.healthInsurance.toLocaleString()}원
                    </span>
                    <span>
                      장기요양 {previewCalc.longTermCare.toLocaleString()}원
                    </span>
                    <span>
                      고용보험 {previewCalc.employmentInsurance.toLocaleString()}원
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-rose-300">
                  <span>
                    공제 합계 (소득세 {previewCalc.incomeTax.toLocaleString()}원 + 지방세{" "}
                    {previewCalc.localIncomeTax.toLocaleString()}원 포함)
                  </span>
                  <span className="font-bold">
                    -{previewCalc.deductionTotal.toLocaleString("ko-KR")}원
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-700 flex justify-between items-center">
                  <span className="text-xs font-extrabold text-emerald-300">
                    차인 실지급액 (이체 금액)
                  </span>
                  <span className="text-lg font-black text-white">
                    {previewCalc.netAmount.toLocaleString("ko-KR")}원
                  </span>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  비고 / 정산 메모
                </label>
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="예: 신간 초판 2,000부 발행 인세 / 표지 일러스트 외주"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white font-extrabold disabled:opacity-50"
                >
                  저장 및 명세서 반영
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 근로기준법 제48조 준수 A4 급여명세서 / 원천징수·인세 지급명세서 모달 */}
      {statementModal && (
        <div
          onClick={() => setStatementModal(null)}
          className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs z-50 flex items-center justify-center p-4 print:static print:bg-white print:p-0"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden print:shadow-none print:border-none print:max-w-none"
          >
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between print:hidden">
              <span className="text-sm font-extrabold">
                {statementModal.pay_month}{" "}
                {PAYROLL_TYPE_META[statementModal.pay_type].shortLabel} 명세서
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-bold"
                >
                  🖨️ A4 인쇄 / PDF 저장
                </button>
                <button
                  type="button"
                  onClick={() => setStatementModal(null)}
                  className="px-2.5 py-1 rounded-lg hover:bg-white/10 text-sm font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-8 space-y-5 text-slate-900">
              <div className="text-center border-b-2 border-slate-900 pb-4">
                <div className="text-xs font-bold text-slate-500">
                  문서번호 {statementModal.statement_no}
                </div>
                <h2 className="text-xl font-black mt-1">
                  {statementModal.pay_month}{" "}
                  {statementModal.pay_type === "EMPLOYEE"
                    ? "임직원 급여명세서"
                    : statementModal.pay_type === "ROYALTY"
                    ? "저자 인세 정산 지급명세서"
                    : "원천징수 사업·기타소득 지급명세서"}
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500">성명(상호):</span>{" "}
                  <strong className="ml-1">{statementModal.payee_name}</strong>
                </div>
                <div>
                  <span className="text-slate-500">소속/구분:</span>{" "}
                  <strong className="ml-1">
                    {statementModal.department_or_role}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">지급일자:</span>{" "}
                  <strong className="ml-1">
                    {statementModal.pay_date || "-"}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">지급계좌:</span>{" "}
                  <strong className="ml-1">
                    {statementModal.bank_info || "-"}
                  </strong>
                </div>
                {statementModal.book_or_project && (
                  <div className="col-span-2">
                    <span className="text-slate-500">대상 도서·프로젝트:</span>{" "}
                    <strong className="ml-1">
                      {statementModal.book_or_project}
                    </strong>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                {/* 지급 내역 */}
                <div className="border border-slate-300 rounded-xl overflow-hidden flex flex-col justify-between">
                  <div>
                    <div className="bg-slate-100 px-4 py-2 font-extrabold border-b border-slate-300">
                      지급 항목
                    </div>
                    <div className="p-4 space-y-2">
                      <div className="flex justify-between">
                        <span>
                          {statementModal.pay_type === "EMPLOYEE"
                            ? "기본급"
                            : "공급가액 / 정산금액"}
                        </span>
                        <span className="font-bold">
                          {statementModal.base_pay.toLocaleString()}원
                        </span>
                      </div>
                      {statementModal.meal_allowance > 0 && (
                        <div className="flex justify-between">
                          <span>비과세 식대</span>
                          <span className="font-bold">
                            {statementModal.meal_allowance.toLocaleString()}원
                          </span>
                        </div>
                      )}
                      {statementModal.overtime_pay > 0 && (
                        <div className="flex justify-between">
                          <span>연장·마감수당</span>
                          <span className="font-bold">
                            {statementModal.overtime_pay.toLocaleString()}원
                          </span>
                        </div>
                      )}
                      {Array.isArray(statementModal.calc_meta?.extra_allowances) &&
                      statementModal.calc_meta.extra_allowances.length > 0 ? (
                        statementModal.calc_meta.extra_allowances.map(
                          (item: { label: string; amount: number }, i: number) => (
                            <div key={i} className="flex justify-between">
                              <span>{item.label}</span>
                              <span className="font-bold">
                                {Number(item.amount || 0).toLocaleString()}원
                              </span>
                            </div>
                          )
                        )
                      ) : (
                        statementModal.bonus_pay !== 0 && (
                          <div className="flex justify-between">
                            <span>상여·기타수당</span>
                            <span className="font-bold">
                              {statementModal.bonus_pay.toLocaleString()}원
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                  <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex justify-between font-extrabold">
                    <span>지급 합계</span>
                    <span>{statementModal.gross_amount.toLocaleString()}원</span>
                  </div>
                </div>

                {/* 공제 내역 */}
                <div className="border border-slate-300 rounded-xl overflow-hidden flex flex-col justify-between">
                  <div>
                    <div className="bg-slate-100 px-4 py-2 font-extrabold border-b border-slate-300">
                      공제 · 원천징수 항목
                    </div>
                    <div className="p-4 space-y-2">
                      {statementModal.pay_type === "EMPLOYEE" && (
                        <>
                          <div className="flex justify-between">
                            <span>국민연금</span>
                            <span>
                              {statementModal.national_pension.toLocaleString()}원
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>건강보험</span>
                            <span>
                              {statementModal.health_insurance.toLocaleString()}원
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>장기요양보험</span>
                            <span>
                              {statementModal.long_term_care.toLocaleString()}원
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>고용보험</span>
                            <span>
                              {statementModal.employment_insurance.toLocaleString()}원
                            </span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between">
                        <span>소득세</span>
                        <span>
                          {statementModal.income_tax.toLocaleString()}원
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>지방소득세</span>
                        <span>
                          {statementModal.local_income_tax.toLocaleString()}원
                        </span>
                      </div>
                      {Number(statementModal.calc_meta?.other_deduction || 0) !==
                        0 && (
                        <div className="flex justify-between">
                          <span>기타·정산공제</span>
                          <span>
                            {Number(
                              statementModal.calc_meta.other_deduction
                            ).toLocaleString()}
                            원
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="px-4 py-2.5 bg-rose-50/50 border-t border-slate-200 flex justify-between font-extrabold text-rose-600">
                    <span>공제 합계</span>
                    <span>
                      -{statementModal.deduction_total.toLocaleString()}원
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between">
                <span className="text-sm font-extrabold">
                  실지급액 (차인지급액)
                </span>
                <span className="text-xl font-black">
                  {statementModal.net_amount.toLocaleString("ko-KR")}원
                </span>
              </div>

              {statementModal.pay_type === "EMPLOYEE" && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 leading-relaxed">
                  • 산출기준 안내 (근로기준법 제48조 제2항): 기본급·정액수당은 근로계약 기준 월급여액이며, 연장·휴일·야간근로 발생 시 통상시급(월 통상임금÷209h)×가산율(1.5배) 기준으로 산정합니다. 4대보험 및 소득·지방소득세는 관련 법령·고지내역 및 간이세액표에 의거 원천공제됩니다.
                </div>
              )}

              <div className="flex items-center justify-center gap-3 pt-2 text-xs text-slate-600">
                <span>
                  발행처: <strong>{companyName}</strong> · 위와 같이 정산 지급되었음을 확인합니다.
                </span>
                {defaultSeal && (
                  <img
                    src={defaultSeal}
                    alt="직인"
                    className="w-11 h-11 object-contain opacity-90"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
