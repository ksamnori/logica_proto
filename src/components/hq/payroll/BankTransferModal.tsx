// src/components/hq/payroll/BankTransferModal.tsx
"use client";

import React, { useMemo, useState } from "react";
import { PAYROLL_TYPE_META } from "@/lib/hq/constants";
import {
  buildBankBulkTransferCsv,
  parseBankTransferItems,
  triggerCsvDownload,
} from "@/lib/hq/payrollUtils";
import type { HqMember, HqPayrollRecord } from "@/lib/hq/types";

interface BankTransferModalProps {
  open: boolean;
  payMonth: string;
  companyName: string;
  records: HqPayrollRecord[];
  selectedIds: Set<string>;
  members: HqMember[];
  onClose: () => void;
  onMarkPaid: (ids: string[]) => Promise<void>;
}

export default function BankTransferModal({
  open,
  payMonth,
  companyName,
  records,
  selectedIds,
  members,
  onClose,
  onMarkPaid,
}: BankTransferModalProps) {
  const [scope, setScope] = useState<"SELECTED" | "UNPAID" | "ALL">(
    selectedIds.size > 0 ? "SELECTED" : "UNPAID"
  );
  const [categoryFilter, setCategoryFilter] = useState<
    "ALL" | "EMPLOYEE" | "EXTERNAL"
  >("ALL");
  const [stripHyphens, setStripHyphens] = useState(true);
  const [excludeMissingAccount, setExcludeMissingAccount] = useState(true);
  const [receiverMemo, setReceiverMemo] = useState(
    (companyName || "천종현수학연구소").replace(/^\(주\)/, "").trim()
  );
  const [marking, setMarking] = useState(false);

  const targetRecords = useMemo(() => {
    let base = records;
    if (scope === "SELECTED" && selectedIds.size > 0) {
      base = base.filter((r) => selectedIds.has(r.payroll_id));
    } else if (scope === "UNPAID") {
      base = base.filter((r) => r.status !== "PAID");
    }
    if (categoryFilter === "EMPLOYEE") {
      base = base.filter((r) => r.pay_type === "EMPLOYEE");
    } else if (categoryFilter === "EXTERNAL") {
      base = base.filter((r) => r.pay_type !== "EMPLOYEE");
    }
    return base;
  }, [records, scope, selectedIds, categoryFilter]);

  const parsedItems = useMemo(
    () =>
      parseBankTransferItems({
        records: targetRecords,
        members,
        companyName,
        stripHyphens,
        receiverMemoCustom: receiverMemo,
      }),
    [targetRecords, members, companyName, stripHyphens, receiverMemo]
  );

  const missingCount = parsedItems.filter((i) => i.missingAccount).length;
  const exportableItems = useMemo(
    () =>
      excludeMissingAccount
        ? parsedItems.filter((i) => !i.missingAccount)
        : parsedItems,
    [parsedItems, excludeMissingAccount]
  );

  const totalNet = exportableItems.reduce((acc, i) => acc + i.netAmount, 0);

  if (!open) return null;

  const handleDownload = () => {
    if (exportableItems.length === 0) {
      alert("다운로드할 이체 대상이 없습니다.");
      return;
    }
    const csv = buildBankBulkTransferCsv(exportableItems);
    const label =
      categoryFilter === "EMPLOYEE"
        ? "임직원급여"
        : categoryFilter === "EXTERNAL"
        ? "외주인세"
        : "통합정산";
    triggerCsvDownload(
      `은행대량이체_${payMonth === "ALL" ? "전체" : payMonth}_${label}_${exportableItems.length}건.csv`,
      csv
    );
  };

  const handleMarkAllPaid = async () => {
    if (exportableItems.length === 0) return;
    if (
      !confirm(
        `이체 대상 ${exportableItems.length}건(총 ${totalNet.toLocaleString(
          "ko-KR"
        )}원)을 모두 [이체완료] 상태로 처리하시겠습니까?`
      )
    ) {
      return;
    }
    setMarking(true);
    try {
      await onMarkPaid(exportableItems.map((i) => i.payrollId));
      onClose();
    } finally {
      setMarking(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 print:hidden"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70 shrink-0">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              🏦 은행 대량이체용 파일 생성 (급여 · 외주 3.3% · 인세)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              주거래 기업뱅킹(국민·신한·하나·우리·기업 등) 대량이체 엑셀/CSV 표준 컬럼으로 추출합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-200 text-slate-500 font-bold text-sm"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scroll space-y-4 flex-1 text-xs">
          {/* 필터 옵션 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                추출 범위
              </label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
              >
                {selectedIds.size > 0 && (
                  <option value="SELECTED">
                    체크박스로 선택한 건만 ({selectedIds.size}건)
                  </option>
                )}
                <option value="UNPAID">미이체(초안 · 배부확정) 건만</option>
                <option value="ALL">조회된 당월 전체 건 ({records.length}건)</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                소득 구분 필터
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
              >
                <option value="ALL">전체 (임직원 급여 + 외주·인세)</option>
                <option value="EMPLOYEE">임직원 급여만</option>
                <option value="EXTERNAL">외주(3.3% / 8.8%) · 저자 인세만</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                수령인 통장 표시 문구 (최대 14자)
              </label>
              <input
                value={receiverMemo}
                maxLength={14}
                onChange={(e) => setReceiverMemo(e.target.value)}
                placeholder="예: 천종현수학연구소"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={stripHyphens}
                  onChange={(e) => setStripHyphens(e.target.checked)}
                  className="w-4 h-4 accent-brand rounded"
                />
                <span>계좌번호 하이픈(-) 자동 제거 (기업뱅킹 권장)</span>
              </label>
              {missingCount > 0 && (
                <label className="flex items-center gap-1.5 font-bold text-amber-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={excludeMissingAccount}
                    onChange={(e) => setExcludeMissingAccount(e.target.checked)}
                    className="w-4 h-4 accent-amber-600 rounded"
                  />
                  <span>계좌 미기재 건({missingCount}건) 파일에서 제외</span>
                </label>
              )}
            </div>

            <div className="text-right">
              <span className="text-slate-500 font-semibold mr-2">
                총 {exportableItems.length}건 이체 합계
              </span>
              <span className="text-base font-black text-brand">
                {totalNet.toLocaleString("ko-KR")}원
              </span>
            </div>
          </div>

          {missingCount > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-semibold text-[11px]">
              ⚠️ 입금은행 또는 계좌번호가 등록되지 않은 대상이{" "}
              <strong>{missingCount}건</strong> 있습니다. 임직원은 [구성원 &gt; 기본 정보]에서 급여계좌를 입력하면 이후 매달 자동으로 불러옵니다.
            </div>
          )}

          {/* 미리보기 테이블 */}
          <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-[320px]">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="bg-slate-100 sticky top-0 text-[11px] font-extrabold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">구분</th>
                  <th className="py-2.5 px-3">예금주(수령인)</th>
                  <th className="py-2.5 px-3">입금은행</th>
                  <th className="py-2.5 px-3">계좌번호</th>
                  <th className="py-2.5 px-3 text-right">실지급 이체액</th>
                  <th className="py-2.5 px-3">출금통장 표시</th>
                  <th className="py-2.5 px-3">입금통장 표시</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parsedItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400">
                      선택한 조건에 해당하는 정산 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  parsedItems.map((it) => (
                    <tr
                      key={it.payrollId}
                      className={
                        it.missingAccount
                          ? "bg-amber-50/50 text-amber-900"
                          : "hover:bg-slate-50"
                      }
                    >
                      <td className="py-2 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded border text-[10px] font-bold ${
                            PAYROLL_TYPE_META[it.payType].badgeClass
                          }`}
                        >
                          {PAYROLL_TYPE_META[it.payType].shortLabel}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-extrabold text-slate-900">
                        {it.accountHolder}
                      </td>
                      <td className="py-2 px-3 font-semibold">
                        {it.bankName || (
                          <span className="text-rose-600 font-bold">미기재</span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {it.accountNo || (
                          <span className="text-rose-600 font-sans font-bold">
                            계좌번호 없음
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-black text-brand tabular-nums">
                        {it.netAmount.toLocaleString("ko-KR")}원
                      </td>
                      <td className="py-2 px-3 text-slate-500">{it.senderMemo}</td>
                      <td className="py-2 px-3 text-slate-500">
                        {it.receiverMemo}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs">
          <button
            type="button"
            disabled={marking || exportableItems.length === 0}
            onClick={handleMarkAllPaid}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-40"
          >
            ✅ 대상 건 이체완료(PAID) 일괄 처리
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold"
            >
              닫기
            </button>
            <button
              type="button"
              disabled={exportableItems.length === 0}
              onClick={handleDownload}
              className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white font-extrabold shadow-sm disabled:opacity-40"
            >
              📥 은행 대량이체 CSV 다운로드 ({exportableItems.length}건)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
