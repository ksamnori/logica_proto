// src/components/hq/mobile/HqMobileLeaveExpenseTab.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import { buildRecommendedApprovalLine } from "@/lib/hq/approvalLine";
import {
  hqFetch,
  resolveStoragePublicUrl,
  uploadHqReceiptFile,
} from "@/lib/hq/clientApi";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_POLICY,
  PAYMENT_METHODS,
} from "@/lib/hq/constants";
import type { HqApprovalDoc, HqExpense } from "@/lib/hq/types";

export type LeaveExpenseSubMode = "LEAVE" | "EXPENSE";

interface Props {
  defaultSubMode?: LeaveExpenseSubMode;
  defaultOpenSheet?: "LEAVE_CREATE" | "EXPENSE_CAMERA" | null;
}

type MobileLeaveOptionKey =
  | "ANNUAL"
  | "AM_HALF"
  | "PM_HALF"
  | "HOURLY"
  | "COMP"
  | "CONDOLENCE"
  | "SICK"
  | "OFFICIAL";

const MOBILE_LEAVE_OPTIONS: {
  key: MobileLeaveOptionKey;
  label: string;
  badge: string;
  deductAnnual: boolean;
  isSingleDayOnly: boolean;
}[] = [
  {
    key: "ANNUAL",
    label: "연차",
    badge: "1일 차감",
    deductAnnual: true,
    isSingleDayOnly: false,
  },
  {
    key: "AM_HALF",
    label: "오전반차",
    badge: "0.5일",
    deductAnnual: true,
    isSingleDayOnly: true,
  },
  {
    key: "PM_HALF",
    label: "오후반차",
    badge: "0.5일",
    deductAnnual: true,
    isSingleDayOnly: true,
  },
  {
    key: "HOURLY",
    label: "시간차",
    badge: "시간단위",
    deductAnnual: true,
    isSingleDayOnly: true,
  },
  {
    key: "COMP",
    label: "마감대체휴무",
    badge: "미차감",
    deductAnnual: false,
    isSingleDayOnly: false,
  },
  {
    key: "CONDOLENCE",
    label: "경조사",
    badge: "미차감",
    deductAnnual: false,
    isSingleDayOnly: false,
  },
  {
    key: "SICK",
    label: "병가",
    badge: "미차감",
    deductAnnual: false,
    isSingleDayOnly: false,
  },
  {
    key: "OFFICIAL",
    label: "공가/예비군",
    badge: "미차감",
    deductAnnual: false,
    isSingleDayOnly: false,
  },
];

function getErrMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function countWeekdaysInclusive(startYmd: string, endYmd: string): number {
  const [sy, sm, sd] = startYmd.split("-").map(Number);
  const [ey, em, ed] = endYmd.split("-").map(Number);
  if (!sy || !ey) return 1;
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  if (end < cur) return 1;
  let cnt = 0;
  let guard = 0;
  while (cur <= end && guard < 120) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) cnt += 1;
    cur.setDate(cur.getDate() + 1);
    guard += 1;
  }
  return Math.max(1, cnt);
}

export default function HqMobileLeaveExpenseTab({
  defaultSubMode = "LEAVE",
  defaultOpenSheet = null,
}: Props) {
  const {
    me,
    members,
    companySettings,
    refreshMembers,
    refreshApprovalBadge,
    refreshAttendanceState,
  } = useHqShell();

  const [subMode, setSubMode] = useState<LeaveExpenseSubMode>(defaultSubMode);

  // =========================================================================
  // 1) 내 휴가 상태
  // =========================================================================
  const [myLeaveDocs, setMyLeaveDocs] = useState<HqApprovalDoc[]>([]);
  const [loadingLeaves, setLoadingLeaves] = useState(true);
  const [leaveSheetOpen, setLeaveSheetOpen] = useState(
    defaultOpenSheet === "LEAVE_CREATE"
  );
  const [leaveKind, setLeaveKind] = useState<MobileLeaveOptionKey>("ANNUAL");
  const [leaveStart, setLeaveStart] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [leaveEnd, setLeaveEnd] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [hourlyHours, setHourlyHours] = useState<number>(2);
  const [hourlyTimeNote, setHourlyTimeNote] = useState("14:00~16:00");
  const [handoverName, setHandoverName] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [submittingLeave, setSubmittingLeave] = useState(false);

  // =========================================================================
  // 2) 경비 · 영수증 촬영 상태
  // =========================================================================
  const [expenseMonth, setExpenseMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
  });
  const [expenses, setExpenses] = useState<HqExpense[]>([]);
  const [canSettleExpense, setCanSettleExpense] = useState(false);
  const [loadingExpenses, setLoadingExpenses] = useState(true);

  const [expenseSheetOpen, setExpenseSheetOpen] = useState(
    defaultOpenSheet === "EXPENSE_CAMERA"
  );
  const [expDate, setExpDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [expCategory, setExpCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [expPayment, setExpPayment] = useState<string>(PAYMENT_METHODS[0]);
  const [expMerchant, setExpMerchant] = useState("");
  const [expAmountStr, setExpAmountStr] = useState("");
  const [expCardLast4, setExpCardLast4] = useState("");
  const [expMemo, setExpMemo] = useState("");
  const [expReceiptPath, setExpReceiptPath] = useState<string | null>(null);
  const [alsoSubmitApproval, setAlsoSubmitApproval] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [zoomImgUrl, setZoomImgUrl] = useState<string | null>(null);

  const fetchLeaves = useCallback(async () => {
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { leaveDocs: HqApprovalDoc[] };
      }>("/api/hq/leaves");
      const all = res.data?.leaveDocs || [];
      const mine = me
        ? all.filter((d) => d.drafter_id === me.instructor_id)
        : all;
      setMyLeaveDocs(mine);
    } catch {
      setMyLeaveDocs([]);
    } finally {
      setLoadingLeaves(false);
    }
  }, [me]);

  const fetchExpenses = useCallback(async (ym: string) => {
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { expenses: HqExpense[]; canSettle: boolean };
      }>(`/api/hq/expenses?month=${ym}`);
      setExpenses(res.data?.expenses || []);
      setCanSettleExpense(Boolean(res.data?.canSettle));
    } catch {
      setExpenses([]);
    } finally {
      setLoadingExpenses(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchLeaves();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchLeaves]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchExpenses(expenseMonth);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [expenseMonth, fetchExpenses]);

  const selectedLeaveMeta = useMemo(
    () =>
      MOBILE_LEAVE_OPTIONS.find((o) => o.key === leaveKind) ||
      MOBILE_LEAVE_OPTIONS[0],
    [leaveKind]
  );

  const computedLeaveDays = useMemo(() => {
    if (leaveKind === "AM_HALF" || leaveKind === "PM_HALF") return 0.5;
    if (leaveKind === "HOURLY") {
      return Number((Math.max(1, Math.min(7, hourlyHours)) / 8).toFixed(4));
    }
    const safeEnd = leaveEnd >= leaveStart ? leaveEnd : leaveStart;
    return countWeekdaysInclusive(leaveStart, safeEnd);
  }, [hourlyHours, leaveEnd, leaveKind, leaveStart]);

  const leaveApprovalLine = useMemo(() => {
    if (!me) return null;
    return buildRecommendedApprovalLine({
      drafter: me,
      allMembers: members,
      docType: "LEAVE",
      leaveDays: computedLeaveDays,
      useAutoDelegation: true,
      orgNodes: companySettings?.extra_settings?.org_chart_nodes,
    });
  }, [
    companySettings?.extra_settings?.org_chart_nodes,
    computedLeaveDays,
    me,
    members,
  ]);

  const activeColleagues = useMemo(
    () =>
      members.filter(
        (m) =>
          m.work_status === "재직" &&
          !m.is_ghost &&
          m.instructor_id !== me?.instructor_id
      ),
    [me?.instructor_id, members]
  );

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!me) return;
    const effectiveEnd = selectedLeaveMeta.isSingleDayOnly
      ? leaveStart
      : leaveEnd >= leaveStart
        ? leaveEnd
        : leaveStart;

    const leaveTypeLabel =
      leaveKind === "HOURLY"
        ? `시간차 (${hourlyHours}시간)`
        : selectedLeaveMeta.label;

    const autoTitle = `[${leaveTypeLabel}] ${me.name} (${leaveStart}${
      effectiveEnd !== leaveStart ? ` ~ ${effectiveEnd}` : ""
    })`;

    const fullContent = [
      leaveKind === "HOURLY" && hourlyTimeNote.trim()
        ? `희망 시간대: ${hourlyTimeNote.trim()}`
        : "",
      leaveReason.trim() || `${leaveTypeLabel} 신청합니다.`,
    ]
      .filter(Boolean)
      .join("\n");

    setSubmittingLeave(true);
    try {
      const stepsPayload = (leaveApprovalLine?.steps || []).map((s) => ({
        step_order: s.step_order,
        step_role: s.step_role,
        approver_id: s.approver_id,
        approver_name: s.approver_name,
        approver_dept: s.approver_dept,
        approver_rank: s.approver_rank,
        approver_title: s.approver_title,
      }));

      await hqFetch("/api/hq/approvals", {
        method: "POST",
        body: {
          doc_type: "LEAVE",
          title: autoTitle,
          content: fullContent,
          effective_date: leaveStart,
          end_date: effectiveEnd,
          leave_type: leaveTypeLabel,
          leave_days: computedLeaveDays,
          handover_name: handoverName.trim() || null,
          is_auto_delegated: Boolean(leaveApprovalLine?.isAutoDelegated),
          instant_complete: Boolean(leaveApprovalLine?.instantSelfApprove),
          steps: stepsPayload,
        },
      });

      setLeaveReason("");
      setHandoverName("");
      setLeaveSheetOpen(false);
      await Promise.all([
        fetchLeaves(),
        refreshMembers(),
        refreshApprovalBadge(),
        refreshAttendanceState(),
      ]);
      window.dispatchEvent(new CustomEvent("hq:approval-updated"));
    } catch (err: unknown) {
      alert(getErrMsg(err, "휴가 신청 상신 실패"));
    } finally {
      setSubmittingLeave(false);
    }
  };

  const handleCancelLeaveDoc = async (approvalId: string) => {
    if (!confirm("대기 중인 휴가 신청을 취소하시겠습니까?")) return;
    try {
      await hqFetch("/api/hq/approvals", {
        method: "PATCH",
        body: { approval_id: approvalId, action: "CANCEL" },
      });
      await Promise.all([fetchLeaves(), refreshApprovalBadge()]);
    } catch (err: unknown) {
      alert(getErrMsg(err, "취소 실패"));
    }
  };

  const handleReceiptSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExpenseSheetOpen(true);
    setUploadingReceipt(true);
    try {
      const path = await uploadHqReceiptFile(file, "hq_expense_receipts");
      setExpReceiptPath(path);
    } catch (err: unknown) {
      alert(getErrMsg(err, "영수증 업로드에 실패했습니다."));
    } finally {
      setUploadingReceipt(false);
      e.target.value = "";
    }
  };

  const numericExpAmount = useMemo(
    () =>
      Math.max(0, Math.round(Number(expAmountStr.replace(/[^0-9]/g, "") || 0))),
    [expAmountStr]
  );

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expMerchant.trim()) {
      alert("가맹점 · 사용처 이름을 입력해 주세요.");
      return;
    }
    if (numericExpAmount <= 0) {
      alert("지출 금액을 올바르게 입력해 주세요.");
      return;
    }

    setSavingExpense(true);
    try {
      if (alsoSubmitApproval && me) {
        const line = buildRecommendedApprovalLine({
          drafter: me,
          allMembers: members,
          docType: "EXPENSE",
          amount: numericExpAmount,
          useAutoDelegation: true,
          orgNodes: companySettings?.extra_settings?.org_chart_nodes,
        });
        await hqFetch("/api/hq/approvals", {
          method: "POST",
          body: {
            doc_type: "EXPENSE",
            title: `[지출결의] ${expMerchant.trim()} (${numericExpAmount.toLocaleString()}원)`,
            content: expMemo.trim(),
            amount: numericExpAmount,
            effective_date: expDate,
            expense_category: expCategory,
            payment_method: expPayment,
            merchant_name: expMerchant.trim(),
            card_last4: expCardLast4.trim() || null,
            receipt_url: expReceiptPath,
            is_auto_delegated: line.isAutoDelegated,
            instant_complete: line.instantSelfApprove,
            steps: line.steps.map((s) => ({
              step_order: s.step_order,
              step_role: s.step_role,
              approver_id: s.approver_id,
              approver_name: s.approver_name,
              approver_dept: s.approver_dept,
              approver_rank: s.approver_rank,
              approver_title: s.approver_title,
            })),
          },
        });
        await refreshApprovalBadge();
      } else {
        await hqFetch("/api/hq/expenses", {
          method: "POST",
          body: {
            expense_date: expDate,
            category: expCategory,
            payment_method: expPayment,
            merchant_name: expMerchant.trim(),
            amount: numericExpAmount,
            tax_amount: Math.round(numericExpAmount / 11),
            card_last4: expCardLast4.trim() || null,
            description: expMemo.trim() || null,
            receipt_url: expReceiptPath,
          },
        });
      }

      setExpMerchant("");
      setExpAmountStr("");
      setExpCardLast4("");
      setExpMemo("");
      setExpReceiptPath(null);
      setExpenseSheetOpen(false);
      await fetchExpenses(expenseMonth);
    } catch (err: unknown) {
      alert(getErrMsg(err, "경비 등록 실패"));
    } finally {
      setSavingExpense(false);
    }
  };

  const handleQuickSettle = async (expenseId: string) => {
    try {
      await hqFetch("/api/hq/expenses", {
        method: "PATCH",
        body: {
          expense_ids: [expenseId],
          settlement_status: "정산완료",
        },
      });
      await fetchExpenses(expenseMonth);
    } catch (err: unknown) {
      alert(getErrMsg(err, "정산 처리 실패"));
    }
  };

  const shiftExpenseMonth = (delta: number) => {
    const [y, m] = expenseMonth.split("-").map(Number);
    const dt = new Date(y, m - 1 + delta, 1);
    setLoadingExpenses(true);
    setExpenseMonth(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`
    );
  };

  const expenseStats = useMemo(() => {
    let total = 0;
    let pending = 0;
    let settled = 0;
    expenses.forEach((ex) => {
      if (ex.settlement_status !== "반려") total += ex.amount;
      if (ex.settlement_status === "정산대기") pending += ex.amount;
      if (ex.settlement_status === "정산완료") settled += ex.amount;
    });
    return { total, pending, settled };
  }, [expenses]);

  const leaveUsagePct = useMemo(() => {
    if (!me || me.annual_leave_total <= 0) return 0;
    return Math.min(
      100,
      Math.round((me.annual_leave_used / me.annual_leave_total) * 100)
    );
  }, [me]);

  const receiptPreviewUrl = resolveStoragePublicUrl(expReceiptPath);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-4 py-2.5 shrink-0">
        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setSubMode("LEAVE")}
            className={`py-2 rounded-lg text-xs font-extrabold transition-all ${
              subMode === "LEAVE"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500"
            }`}
          >
            🏖️ 내 휴가 · 연차
          </button>
          <button
            type="button"
            onClick={() => setSubMode("EXPENSE")}
            className={`py-2 rounded-lg text-xs font-extrabold transition-all ${
              subMode === "EXPENSE"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500"
            }`}
          >
            📸 경비 · 영수증 촬영
          </button>
        </div>
      </div>

      {subMode === "LEAVE" ? (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <section className="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white p-5 shadow-md space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-bold text-emerald-100">
                  올해 사용 가능 잔여 연차
                </span>
                <div className="text-3xl font-extrabold mt-1">
                  {me?.annual_leave_remain ?? 0}
                  <span className="text-base font-bold ml-1">일</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLeaveSheetOpen(true)}
                className="px-4 py-2.5 rounded-xl bg-white text-emerald-800 font-extrabold text-xs shadow-sm active:scale-95 transition-transform"
              >
                + 휴가 신청
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] text-emerald-100 font-semibold">
                <span>
                  총 부여 {me?.annual_leave_total ?? 0}일 · 사용{" "}
                  {me?.annual_leave_used ?? 0}일
                </span>
                <span>소진율 {leaveUsagePct}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full rounded-full bg-white"
                  style={{ width: `${leaveUsagePct}%` }}
                />
              </div>
            </div>
          </section>

          <section className="grid grid-cols-4 gap-2">
            {(
              [
                { key: "ANNUAL", icon: "🌴", label: "연차" },
                { key: "AM_HALF", icon: "🌅", label: "오전반차" },
                { key: "PM_HALF", icon: "🌇", label: "오후반차" },
                { key: "HOURLY", icon: "⏱️", label: "시간차" },
              ] as const
            ).map((q) => (
              <button
                key={q.key}
                type="button"
                onClick={() => {
                  setLeaveKind(q.key);
                  setLeaveSheetOpen(true);
                }}
                className="bg-white rounded-2xl border border-slate-200 py-3 px-2 flex flex-col items-center gap-1 shadow-xs active:bg-slate-50"
              >
                <span className="text-lg">{q.icon}</span>
                <span className="text-[11px] font-extrabold text-slate-800">
                  {q.label}
                </span>
              </button>
            ))}
          </section>

          <section className="space-y-2.5">
            <h3 className="text-xs font-extrabold text-slate-800 px-0.5">
              내 휴가 신청 내역 ({myLeaveDocs.length}건)
            </h3>

            {loadingLeaves ? (
              <div className="py-10 text-center text-xs font-bold text-slate-400">
                휴가 내역을 불러오는 중입니다...
              </div>
            ) : myLeaveDocs.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-400 font-semibold">
                신청한 휴가 내역이 없습니다.
              </div>
            ) : (
              myLeaveDocs.map((doc) => {
                const badge =
                  doc.status === "APPROVED"
                    ? {
                        label: "승인완료",
                        cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
                      }
                    : doc.status === "REJECTED"
                      ? {
                          label: "반려",
                          cls: "bg-rose-50 text-rose-700 border-rose-200",
                        }
                      : doc.status === "CANCELLED"
                        ? {
                            label: "취소됨",
                            cls: "bg-slate-100 text-slate-500 border-slate-200",
                          }
                        : {
                            label: "승인대기",
                            cls: "bg-blue-50 text-blue-700 border-blue-200",
                          };

                return (
                  <div
                    key={doc.approval_id}
                    className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-slate-900">
                        {doc.leave_type || "휴가"} · {doc.leave_days}일
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[10px] font-extrabold ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-600">
                      📅 {doc.effective_date || "-"}
                      {doc.end_date && doc.end_date !== doc.effective_date
                        ? ` ~ ${doc.end_date}`
                        : ""}
                    </div>
                    {doc.content && (
                      <p className="text-[11px] text-slate-500 line-clamp-2">
                        {doc.content}
                      </p>
                    )}
                    {doc.status === "PENDING" && (
                      <div className="pt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleCancelLeaveDoc(doc.approval_id)}
                          className="px-3 py-1 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-bold"
                        >
                          신청 취소
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </section>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <section className="rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 shadow-md space-y-3.5">
            <div>
              <span className="text-[11px] font-bold text-amber-300">
                법인카드 · 개인경비 · 인쇄감리 출장비
              </span>
              <h3 className="text-base font-extrabold mt-0.5">
                결제 직후 영수증을 찍어 바로 정산하세요
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="py-3.5 px-3 rounded-2xl bg-amber-400 active:bg-amber-500 text-slate-950 font-extrabold text-xs text-center shadow-sm cursor-pointer flex items-center justify-center gap-1.5">
                <span className="text-base">📷</span>
                <span>카메라로 촬영</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleReceiptSelect}
                  className="hidden"
                />
              </label>

              <label className="py-3.5 px-3 rounded-2xl bg-white/12 active:bg-white/20 border border-white/15 text-white font-extrabold text-xs text-center cursor-pointer flex items-center justify-center gap-1.5">
                <span className="text-base">🖼️</span>
                <span>앨범·파일 선택</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleReceiptSelect}
                  className="hidden"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => setExpenseSheetOpen(true)}
              className="w-full py-2 rounded-xl bg-white/8 text-[11px] font-bold text-slate-200 hover:bg-white/15"
            >
              영수증 없이 금액 먼저 수기 입력하기 →
            </button>
          </section>

          <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => shiftExpenseMonth(-1)}
                className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 font-bold text-xs"
              >
                ◀
              </button>
              <span className="text-sm font-extrabold text-slate-900">
                {expenseMonth.replace("-", "년 ")}월 경비 내역
              </span>
              <button
                type="button"
                onClick={() => shiftExpenseMonth(1)}
                className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 font-bold text-xs"
              >
                ▶
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 p-2.5">
                <div className="text-[10px] font-bold text-slate-400">
                  총 청구액
                </div>
                <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                  {expenseStats.total.toLocaleString()}원
                </div>
              </div>
              <div className="rounded-xl bg-amber-50 p-2.5">
                <div className="text-[10px] font-bold text-amber-700">
                  정산대기
                </div>
                <div className="text-xs font-extrabold text-amber-900 mt-0.5">
                  {expenseStats.pending.toLocaleString()}원
                </div>
              </div>
              <div className="rounded-xl bg-emerald-50 p-2.5">
                <div className="text-[10px] font-bold text-emerald-700">
                  정산완료
                </div>
                <div className="text-xs font-extrabold text-emerald-900 mt-0.5">
                  {expenseStats.settled.toLocaleString()}원
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-2.5">
            {loadingExpenses ? (
              <div className="py-10 text-center text-xs font-bold text-slate-400">
                경비 내역을 불러오는 중입니다...
              </div>
            ) : expenses.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-400 font-semibold">
                이번 달 등록된 경비 내역이 없습니다.
              </div>
            ) : (
              expenses.map((ex) => {
                const pubReceipt = resolveStoragePublicUrl(ex.receipt_url);
                const stBadge =
                  ex.settlement_status === "정산완료"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : ex.settlement_status === "반려"
                      ? "bg-rose-50 text-rose-700 border-rose-200"
                      : "bg-amber-50 text-amber-800 border-amber-200";
                return (
                  <div
                    key={ex.expense_id}
                    className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-slate-400">
                          {ex.expense_date} · {ex.category}
                        </div>
                        <div className="text-sm font-extrabold text-slate-900 truncate mt-0.5">
                          {ex.merchant_name}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[10px] font-extrabold shrink-0 ${stBadge}`}
                      >
                        {ex.settlement_status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-semibold">
                        {ex.requester_name} · {ex.payment_method}
                      </span>
                      <span className="text-sm font-extrabold text-slate-900">
                        {ex.amount.toLocaleString()}원
                      </span>
                    </div>

                    {ex.description && (
                      <p className="text-[11px] text-slate-500 line-clamp-2">
                        {ex.description}
                      </p>
                    )}

                    {(pubReceipt ||
                      (canSettleExpense &&
                        ex.settlement_status === "정산대기")) && (
                      <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between gap-2">
                        {pubReceipt ? (
                          <button
                            type="button"
                            onClick={() => setZoomImgUrl(pubReceipt)}
                            className="text-[11px] font-bold text-brand"
                          >
                            🧾 영수증 보기
                          </button>
                        ) : (
                          <span />
                        )}

                        {canSettleExpense &&
                          ex.settlement_status === "정산대기" && (
                            <button
                              type="button"
                              onClick={() => handleQuickSettle(ex.expense_id)}
                              className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-extrabold"
                            >
                              ✓ 정산완료 처리
                            </button>
                          )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </section>
        </div>
      )}

      {/* 휴가 간편 신청 바텀 시트 */}
      {leaveSheetOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex flex-col justify-end">
          <form
            onSubmit={handleSubmitLeave}
            className="bg-white rounded-t-3xl max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl"
          >
            <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  🌴 모바일 휴가 간편 신청
                </h3>
                <p className="text-[11px] text-slate-500">
                  잔여 연차 {me?.annual_leave_remain ?? 0}일 보유
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLeaveSheetOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-extrabold text-sm flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-600">
                  휴가 종류 선택
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {MOBILE_LEAVE_OPTIONS.map((opt) => {
                    const active = leaveKind === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setLeaveKind(opt.key)}
                        className={`p-2.5 rounded-xl border text-left flex items-center justify-between ${
                          active
                            ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                            : "bg-slate-50 text-slate-700 border-slate-200"
                        }`}
                      >
                        <span className="text-xs font-extrabold">
                          {opt.label}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            active
                              ? "bg-white/20 text-white"
                              : "bg-white text-slate-500"
                          }`}
                        >
                          {opt.badge}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    {selectedLeaveMeta.isSingleDayOnly
                      ? "사용 날짜"
                      : "시작 날짜"}
                  </label>
                  <input
                    type="date"
                    value={leaveStart}
                    onChange={(e) => {
                      setLeaveStart(e.target.value);
                      if (e.target.value > leaveEnd) {
                        setLeaveEnd(e.target.value);
                      }
                    }}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none"
                  />
                </div>

                {!selectedLeaveMeta.isSingleDayOnly ? (
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-600">
                      종료 날짜
                    </label>
                    <input
                      type="date"
                      min={leaveStart}
                      value={leaveEnd}
                      onChange={(e) => setLeaveEnd(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none"
                    />
                  </div>
                ) : (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 flex flex-col justify-center">
                    <span className="text-[10px] font-bold text-emerald-700">
                      신청 일수
                    </span>
                    <span className="text-sm font-extrabold text-emerald-900">
                      {computedLeaveDays}일
                    </span>
                  </div>
                )}
              </div>

              {leaveKind === "HOURLY" && (
                <div className="grid grid-cols-2 gap-2.5 rounded-2xl bg-slate-50 border border-slate-200 p-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-600">
                      사용 시간 (1~7시간)
                    </label>
                    <select
                      value={hourlyHours}
                      onChange={(e) => setHourlyHours(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold"
                    >
                      {[1, 2, 3, 4, 5, 6, 7].map((h) => (
                        <option key={h} value={h}>
                          {h}시간 (
                          {(h / 8)
                            .toFixed(3)
                            .replace(/0+$/, "")
                            .replace(/\.$/, "")}
                          일)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-600">
                      시간대 메모
                    </label>
                    <input
                      type="text"
                      value={hourlyTimeNote}
                      onChange={(e) => setHourlyTimeNote(e.target.value)}
                      placeholder="예: 15:00~17:00"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600">
                  업무 대행자 (선택)
                </label>
                <select
                  value={handoverName}
                  onChange={(e) => setHandoverName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold bg-white outline-none"
                >
                  <option value="">지정 안 함</option>
                  {activeColleagues.map((c) => (
                    <option key={c.instructor_id} value={c.name}>
                      {c.name} {c.job_title} ({c.department})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600">
                  사유 · 인수인계 메모 (선택)
                </label>
                <textarea
                  rows={2}
                  value={leaveReason}
                  onChange={(e) => setLeaveReason(e.target.value)}
                  placeholder="개인 사정, 병원 진료, 마감 후 휴식 등"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium outline-none resize-none"
                />
              </div>

              {leaveApprovalLine && (
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-1 text-[11px]">
                  <div className="font-extrabold text-slate-800">
                    결재선 안내 · 총 {computedLeaveDays}일{" "}
                    {selectedLeaveMeta.deductAnnual
                      ? "(연차 차감)"
                      : "(연차 미차감)"}
                  </div>
                  <div className="text-slate-500">
                    {leaveApprovalLine.delegationReason}
                  </div>
                  {leaveApprovalLine.steps.length > 0 && (
                    <div className="font-bold text-brand pt-0.5">
                      승인자:{" "}
                      {leaveApprovalLine.steps
                        .map((s) => `${s.approver_name} ${s.approver_title}`)
                        .join(" → ")}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] shrink-0">
              <button
                type="submit"
                disabled={submittingLeave}
                className="w-full py-3.5 rounded-xl bg-emerald-600 text-white font-extrabold text-sm shadow-md disabled:opacity-50"
              >
                {submittingLeave
                  ? "상신 중..."
                  : `🌴 ${computedLeaveDays}일 휴가 신청하기`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 영수증 경비 정산 등록 바텀 시트 */}
      {expenseSheetOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex flex-col justify-end">
          <form
            onSubmit={handleSaveExpense}
            className="bg-white rounded-t-3xl max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl"
          >
            <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-extrabold text-slate-900">
                📸 영수증 경비 전표 등록
              </h3>
              <button
                type="button"
                onClick={() => setExpenseSheetOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-extrabold text-sm flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-2">
                {uploadingReceipt ? (
                  <div className="py-6 text-center text-xs font-extrabold text-brand">
                    촬영한 영수증을 업로드하는 중입니다...
                  </div>
                ) : receiptPreviewUrl ? (
                  <div className="space-y-2">
                    <img
                      src={receiptPreviewUrl}
                      alt="영수증 미리보기"
                      className="w-full max-h-44 object-contain rounded-xl bg-white border border-slate-200"
                    />
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span className="text-emerald-700">
                        ✓ 영수증 이미지 첨부 완료
                      </span>
                      <button
                        type="button"
                        onClick={() => setExpReceiptPath(null)}
                        className="text-rose-600 underline"
                      >
                        다시 찍기 / 삭제
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="py-2.5 px-3 rounded-xl bg-slate-900 text-white text-xs font-extrabold text-center cursor-pointer">
                      📷 영수증 촬영
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleReceiptSelect}
                        className="hidden"
                      />
                    </label>
                    <label className="py-2.5 px-3 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold text-center cursor-pointer">
                      🖼️ 앨범에서 선택
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={handleReceiptSelect}
                        className="hidden"
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    가맹점 · 사용처 *
                  </label>
                  <input
                    type="text"
                    value={expMerchant}
                    onChange={(e) => setExpMerchant(e.target.value)}
                    placeholder="예: 교보문고, 스타벅스"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    결제 금액(원) *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={expAmountStr}
                    onChange={(e) =>
                      setExpAmountStr(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="0"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-extrabold outline-none focus:border-brand"
                  />
                </div>
              </div>

              {numericExpAmount > 0 && (
                <div className="text-[11px] text-slate-500 font-semibold -mt-1.5 px-1">
                  합계 {numericExpAmount.toLocaleString()}원 (추정 부가세{" "}
                  {Math.round(numericExpAmount / 11).toLocaleString()}원 자동산출)
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    지출 일자
                  </label>
                  <input
                    type="date"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    결제 수단
                  </label>
                  <select
                    value={expPayment}
                    onChange={(e) => setExpPayment(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold outline-none"
                  >
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    비용 분류
                  </label>
                  <select
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold outline-none"
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    카드 끝 4자리 (선택)
                  </label>
                  <input
                    type="text"
                    maxLength={4}
                    inputMode="numeric"
                    value={expCardLast4}
                    onChange={(e) =>
                      setExpCardLast4(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="1234"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none"
                  />
                </div>
              </div>

              {EXPENSE_CATEGORY_POLICY[expCategory] && (
                <div className="rounded-xl bg-amber-50/70 border border-amber-200 px-3 py-2 text-[11px] text-amber-900">
                  💡 <strong>{EXPENSE_CATEGORY_POLICY[expCategory].limitText}</strong>{" "}
                  — {EXPENSE_CATEGORY_POLICY[expCategory].guide}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600">
                  사용 목적 · 참석자 메모
                </label>
                <input
                  type="text"
                  value={expMemo}
                  onChange={(e) => setExpMemo(e.target.value)}
                  placeholder="예: 저자 기획 미팅 다과 (3인)"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-medium outline-none"
                />
              </div>

              <label className="rounded-xl bg-blue-50/70 border border-blue-200 px-3 py-2.5 flex items-center justify-between gap-2 cursor-pointer">
                <div className="min-w-0">
                  <div className="text-xs font-extrabold text-blue-950">
                    지출결의서 전자결재도 함께 상신
                  </div>
                  <div className="text-[10px] text-blue-700">
                    체크 시 승인 완료와 동시에 비용 장부에 자동 반영됩니다
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={alsoSubmitApproval}
                  onChange={(e) => setAlsoSubmitApproval(e.target.checked)}
                  className="w-4 h-4 accent-brand shrink-0"
                />
              </label>
            </div>

            <div className="border-t border-slate-200 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] shrink-0">
              <button
                type="submit"
                disabled={savingExpense || uploadingReceipt}
                className="w-full py-3.5 rounded-xl bg-brand text-white font-extrabold text-sm shadow-md disabled:opacity-50"
              >
                {savingExpense
                  ? "저장 중..."
                  : alsoSubmitApproval
                    ? "지출결의서 상신하기"
                    : "경비 전표 등록하기"}
              </button>
            </div>
          </form>
        </div>
      )}

      {zoomImgUrl && (
        <div
          onClick={() => setZoomImgUrl(null)}
          className="fixed inset-0 z-[60] bg-black/85 flex flex-col items-center justify-center p-4"
        >
          <img
            src={zoomImgUrl}
            alt="영수증"
            className="max-w-full max-h-[82dvh] object-contain rounded-xl"
          />
          <button
            type="button"
            className="mt-4 px-5 py-2 rounded-full bg-white text-slate-900 text-xs font-extrabold"
          >
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
