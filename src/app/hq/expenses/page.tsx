// src/app/hq/expenses/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useHqShell } from "@/components/hq/HqShellContext";
import ExpenseCreateModal from "@/components/hq/expenses/ExpenseCreateModal";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_POLICY,
  PAYMENT_METHODS,
} from "@/lib/hq/constants";
import { hqFetch, resolveStoragePublicUrl } from "@/lib/hq/clientApi";
import type { HqExpense, HqSettlementStatus } from "@/lib/hq/types";

export default function HqExpensesPage() {
  const router = useRouter();
  const { me, isHrManager } = useHqShell();

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [allPeriod, setAllPeriod] = useState(false);

  const [expenses, setExpenses] = useState<HqExpense[]>([]);
  const [canSettle, setCanSettle] = useState(false);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const [statusFilter, setStatusFilter] = useState<"ALL" | HqSettlementStatus>(
    "ALL"
  );
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [paymentFilter, setPaymentFilter] = useState("ALL");
  const [keyword, setKeyword] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingRow, setEditingRow] = useState<HqExpense | null>(null);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const qs = !allPeriod && month ? `?month=${month}` : "";
      const res = await hqFetch<{
        success: boolean;
        data: {
          expenses: HqExpense[];
          canSettle: boolean;
        };
      }>(`/api/hq/expenses${qs}`);

      setExpenses(res.data?.expenses || []);
      setCanSettle(Boolean(res.data?.canSettle));
      setSelectedIds([]);
    } catch {
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  }, [month, allPeriod]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setAllPeriod(false);
    setMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  };

  const summary = useMemo(() => {
    let validTotal = 0;
    let vatTotal = 0;
    let pendingAmt = 0;
    let pendingCnt = 0;
    let settledAmt = 0;
    let settledCnt = 0;
    let approvalLinkedCnt = 0;

    const byCategory = new Map<string, number>();

    expenses.forEach((ex) => {
      if (ex.settlement_status !== "반려") {
        validTotal += ex.amount;
        vatTotal += ex.tax_amount;
        byCategory.set(
          ex.category,
          (byCategory.get(ex.category) || 0) + ex.amount
        );
      }
      if (ex.settlement_status === "정산대기") {
        pendingAmt += ex.amount;
        pendingCnt += 1;
      } else if (ex.settlement_status === "정산완료") {
        settledAmt += ex.amount;
        settledCnt += 1;
      }
      if (ex.source_type === "APPROVAL") {
        approvalLinkedCnt += 1;
      }
    });

    const topCategories = Array.from(byCategory.entries())
      .map(([cat, amt]) => ({
        cat,
        amt,
        pct: validTotal > 0 ? Math.round((amt / validTotal) * 100) : 0,
      }))
      .sort((a, b) => b.amt - a.amt);

    return {
      validTotal,
      vatTotal,
      pendingAmt,
      pendingCnt,
      settledAmt,
      settledCnt,
      approvalLinkedCnt,
      topCategories,
    };
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return expenses.filter((ex) => {
      if (statusFilter !== "ALL" && ex.settlement_status !== statusFilter) {
        return false;
      }
      if (categoryFilter !== "ALL" && ex.category !== categoryFilter) {
        return false;
      }
      if (paymentFilter !== "ALL" && ex.payment_method !== paymentFilter) {
        return false;
      }
      if (q) {
        const hay = [
          ex.expense_no,
          ex.merchant_name,
          ex.requester_name,
          ex.department,
          ex.description || "",
          ex.approval_doc_no || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [expenses, statusFilter, categoryFilter, paymentFilter, keyword]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredExpenses.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredExpenses.map((e) => e.expense_id));
    }
  };

  const updateSettlement = async (
    ids: string[],
    nextStatus: HqSettlementStatus
  ) => {
    if (ids.length === 0) return;
    let memo: string | undefined;
    if (nextStatus === "반려") {
      const reason = prompt("정산 반려 사유(관리자 메모)를 입력해주세요:");
      if (reason === null) return;
      memo = reason.trim() || "증빙 보완 요청";
    }

    setActing(true);
    try {
      await hqFetch("/api/hq/expenses", {
        method: "PATCH",
        body: {
          expense_ids: ids,
          settlement_status: nextStatus,
          ...(memo !== undefined ? { admin_memo: memo } : {}),
        },
      });
      await loadExpenses();
    } catch (err: any) {
      alert(err?.message || "정산 상태 변경 실패");
    } finally {
      setActing(false);
    }
  };

  const handleDelete = async (row: HqExpense) => {
    if (!confirm(`[${row.merchant_name}] 비용 전표를 삭제하시겠습니까?`)) {
      return;
    }
    setActing(true);
    try {
      await hqFetch(`/api/hq/expenses?id=${encodeURIComponent(row.expense_id)}`, {
        method: "DELETE",
      });
      await loadExpenses();
    } catch (err: any) {
      alert(err?.message || "삭제 실패");
    } finally {
      setActing(false);
    }
  };

  return (
    <>
      <div className="p-6 space-y-5 max-w-[1440px] w-full mx-auto">
        {/* 1. 상단 기간 선택 & 신규 경비 등록/지출결의 액션 바 */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold"
            >
              ◀
            </button>
            <input
              type="month"
              value={month}
              disabled={allPeriod}
              onChange={(e) => {
                setAllPeriod(false);
                setMonth(e.target.value);
              }}
              className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-sm font-extrabold text-slate-900 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold"
            >
              ▶
            </button>
            <button
              type="button"
              onClick={() => setAllPeriod((v) => !v)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                allPeriod
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {allPeriod ? "✓ 전체 기간 보기중" : "전체 기간 조회"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => router.push("/hq/approvals?new=1&type=EXPENSE")}
              className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 text-xs font-extrabold transition-colors"
            >
              ✍️ 지출결의서 전자결재 상신
            </button>
            <button
              type="button"
              onClick={() => {
                setModalMode("create");
                setEditingRow(null);
                setModalOpen(true);
              }}
              className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold shadow-xs transition-colors"
            >
              ➕ 카드 · 영수증 직접 등록
            </button>
          </div>
        </section>

        {/* 2. 요약 KPI 카드 4개 */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
            <div className="text-xs font-bold text-slate-500">
              유효 지출 합계 (반려 제외)
            </div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1.5">
              {summary.validTotal.toLocaleString()}원
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-medium">
              추정 부가세 포함액 {summary.vatTotal.toLocaleString()}원
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
            <div className="text-xs font-bold text-amber-700">
              정산 대기 내역
            </div>
            <div className="text-2xl font-extrabold text-amber-600 mt-1.5">
              {summary.pendingAmt.toLocaleString()}원
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-medium">
              미정산 전표 {summary.pendingCnt}건
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
            <div className="text-xs font-bold text-emerald-700">
              정산 완료 내역
            </div>
            <div className="text-2xl font-extrabold text-emerald-600 mt-1.5">
              {summary.settledAmt.toLocaleString()}원
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-medium">
              처리 완료 {summary.settledCnt}건
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
            <div className="text-xs font-bold text-slate-500">
              전자결재 자동 연동 비중
            </div>
            <div className="text-2xl font-extrabold text-brand mt-1.5">
              {summary.approvalLinkedCnt}건{" "}
              <span className="text-xs font-semibold text-slate-400">
                / 총 {expenses.length}건
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-medium">
              지출결의 최종 승인 시 장부 자동 반영
            </div>
          </div>
        </section>

        {/* 카테고리별 지출 비중 요약 */}
        {summary.topCategories.length > 0 && (
          <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                📊 계정과목(카테고리)별 지출 분포
              </h3>
              <span className="text-[11px] text-slate-400">
                항목 클릭 시 해당 카테고리로 필터링됩니다
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {summary.topCategories.map((c) => {
                const active = categoryFilter === c.cat;
                const policy = EXPENSE_CATEGORY_POLICY[c.cat];
                return (
                  <button
                    key={c.cat}
                    type="button"
                    onClick={() =>
                      setCategoryFilter(active ? "ALL" : c.cat)
                    }
                    className={`p-3 rounded-xl border text-left transition-all ${
                      active
                        ? "border-brand bg-blue-50/60 ring-2 ring-brand/20"
                        : "border-slate-200 hover:border-slate-300 bg-slate-50/50"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-extrabold text-slate-800">
                      <span className="truncate">{c.cat}</span>
                      <span className="text-brand">{c.pct}%</span>
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 mt-1">
                      {c.amt.toLocaleString()}원
                    </div>
                    {policy && (
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                        규정: {policy.limitText}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* 3. 필터 바 + 일괄 정산 컨트롤 + 전표 테이블 */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(["ALL", "정산대기", "정산완료", "반려"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-colors ${
                    statusFilter === st
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {st === "ALL" ? "전체 전표" : st}
                </button>
              ))}

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700"
              >
                <option value="ALL">전체 카테고리</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700"
              >
                <option value="ALL">전체 결제수단</option>
                {PAYMENT_METHODS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="가맹점, 요청자, 부서, 전표번호"
                className="w-52 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800"
              />
            </div>

            {canSettle && selectedIds.length > 0 && (
              <div className="flex items-center gap-2 shrink-0 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-xl">
                <span className="text-xs font-extrabold text-brand">
                  {selectedIds.length}건 선택됨
                </span>
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => updateSettlement(selectedIds, "정산완료")}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                >
                  일괄 정산완료
                </button>
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => updateSettlement(selectedIds, "반려")}
                  className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
                >
                  일괄 반려
                </button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold">
                  {canSettle && (
                    <th className="pl-4 pr-2 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={
                          filteredExpenses.length > 0 &&
                          selectedIds.length === filteredExpenses.length
                        }
                        onChange={toggleSelectAll}
                        className="w-4 h-4 accent-brand rounded"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3">지출일 · 전표번호</th>
                  <th className="px-4 py-3">부서 · 요청자</th>
                  <th className="px-4 py-3">카테고리 · 가맹점</th>
                  <th className="px-4 py-3">결제수단</th>
                  <th className="px-4 py-3 text-right">지출 금액</th>
                  <th className="px-4 py-3 text-center">증빙</th>
                  <th className="px-4 py-3">정산 상태</th>
                  <th className="px-4 py-3 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td
                      colSpan={canSettle ? 9 : 8}
                      className="py-16 text-center text-slate-400 font-bold"
                    >
                      비용 전표를 불러오는 중입니다...
                    </td>
                  </tr>
                ) : filteredExpenses.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canSettle ? 9 : 8}
                      className="py-16 text-center text-slate-400 font-bold"
                    >
                      조회된 경비 · 정산 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredExpenses.map((ex) => {
                    const receiptUrl = resolveStoragePublicUrl(ex.receipt_url);
                    const isMine = me?.instructor_id === ex.requester_id;
                    const canModify =
                      (isMine || isHrManager) &&
                      (ex.settlement_status !== "정산완료" || isHrManager);
                    const canDelete =
                      canModify &&
                      (ex.source_type !== "APPROVAL" || isHrManager);

                    return (
                      <tr
                        key={ex.expense_id}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        {canSettle && (
                          <td className="pl-4 pr-2 py-3.5">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(ex.expense_id)}
                              onChange={() => toggleSelect(ex.expense_id)}
                              className="w-4 h-4 accent-brand rounded"
                            />
                          </td>
                        )}

                        <td className="px-4 py-3.5">
                          <div className="font-extrabold text-slate-800">
                            {ex.expense_date}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] font-mono text-slate-400">
                              {ex.expense_no}
                            </span>
                            {ex.source_type === "APPROVAL" && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                                결재연동
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3.5">
                          <div className="font-bold text-slate-800">
                            {ex.requester_name}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {ex.department || "본부"}
                          </div>
                        </td>

                        <td className="px-4 py-3.5 max-w-[260px]">
                          <div className="flex items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold shrink-0">
                              {ex.category}
                            </span>
                            <span className="font-extrabold text-slate-900 truncate">
                              {ex.merchant_name}
                            </span>
                          </div>
                          {ex.description && (
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">
                              {ex.description}
                            </div>
                          )}
                          {ex.admin_memo && (
                            <div className="text-[11px] text-rose-600 font-semibold mt-0.5">
                              메모: {ex.admin_memo}
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-slate-700">
                            {ex.payment_method}
                          </div>
                          {ex.card_last4 && (
                            <div className="text-[11px] text-slate-400 font-mono">
                              카드 ****-{ex.card_last4}
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3.5 text-right">
                          <div className="font-extrabold text-slate-900 text-[13px]">
                            {ex.amount.toLocaleString()}원
                          </div>
                          <div className="text-[10px] text-slate-400">
                            VAT {ex.tax_amount.toLocaleString()}원
                          </div>
                        </td>

                        <td className="px-4 py-3.5 text-center">
                          {receiptUrl ? (
                            <a
                              href={receiptUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex px-2.5 py-1 rounded-lg bg-blue-50 text-brand font-bold text-[11px] hover:underline"
                            >
                              📎 영수증
                            </a>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>

                        <td className="px-4 py-3.5">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold ${
                              ex.settlement_status === "정산완료"
                                ? "bg-emerald-50 text-emerald-700"
                                : ex.settlement_status === "반려"
                                  ? "bg-rose-50 text-rose-700"
                                  : "bg-amber-50 text-amber-800"
                            }`}
                          >
                            {ex.settlement_status}
                          </span>
                          {ex.settled_by && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {ex.settled_by}
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            {canSettle &&
                              ex.settlement_status !== "정산완료" && (
                                <button
                                  type="button"
                                  disabled={acting}
                                  onClick={() =>
                                    updateSettlement(
                                      [ex.expense_id],
                                      "정산완료"
                                    )
                                  }
                                  className="px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-extrabold text-[11px]"
                                >
                                  정산승인
                                </button>
                              )}
                            {canSettle && ex.settlement_status !== "반려" && (
                              <button
                                type="button"
                                disabled={acting}
                                onClick={() =>
                                  updateSettlement([ex.expense_id], "반려")
                                }
                                className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[11px]"
                              >
                                반려
                              </button>
                            )}
                            {canModify && ex.source_type !== "APPROVAL" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setModalMode("edit");
                                  setEditingRow(ex);
                                  setModalOpen(true);
                                }}
                                className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px]"
                              >
                                수정
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                disabled={acting}
                                onClick={() => handleDelete(ex)}
                                className="px-2 py-1 rounded-lg text-slate-400 hover:text-rose-600 font-bold text-[11px]"
                              >
                                삭제
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <ExpenseCreateModal
        isOpen={modalOpen}
        mode={modalMode}
        expense={editingRow}
        onClose={() => setModalOpen(false)}
        onSaved={loadExpenses}
      />
    </>
  );
}
