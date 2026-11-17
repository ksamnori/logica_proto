// src/components/hq/payroll/TaxLedgerUploadModal.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";
import { hqFetch } from "@/lib/hq/clientApi";
import {
  buildTaxLedgerUploadTemplateCsv,
  decodeCsvArrayBuffer,
  mapTaxLedgerRowsToDrafts,
  parseSpreadsheetRowsFromText,
  parseXlsxArrayBuffer,
  type TaxLedgerParsedRow,
  triggerCsvDownload,
} from "@/lib/hq/payrollUtils";
import type { HqMember } from "@/lib/hq/types";

interface TaxLedgerUploadModalProps {
  open: boolean;
  payMonth: string;
  members: HqMember[];
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function TaxLedgerUploadModal({
  open,
  payMonth,
  members,
  onClose,
  onSuccess,
}: TaxLedgerUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [inputMode, setInputMode] = useState<"FILE" | "PASTE">("FILE");
  const [pasteText, setPasteText] = useState("");
  const [fileName, setFileName] = useState("");
  const [payDate, setPayDate] = useState(`${payMonth}-25`);
  const [overwriteExisting, setOverwriteExisting] = useState(true);
  const [rows, setRows] = useState<TaxLedgerParsedRow[]>([]);
  const [detectedCols, setDetectedCols] = useState<string[]>([]);
  const [parseError, setParseError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status === "재직"),
    [members]
  );

  if (!open) return null;

  const applyMatrix = (matrix: string[][], sourceLabel: string) => {
    setParseError("");
    const result = mapTaxLedgerRowsToDrafts({
      matrix,
      members,
      payMonth,
      defaultPayDate: payDate,
    });
    if (result.rows.length === 0) {
      setRows([]);
      setDetectedCols([]);
      setParseError(
        "유효한 급여 행을 찾지 못했습니다. 첫 줄(또는 상단 표 헤더)에 '성명(이름)'과 '기본급/지급총액' 열이 포함되어 있는지 확인해 주세요."
      );
      return;
    }
    setFileName(sourceLabel);
    setDetectedCols(result.detectedColumns);
    setRows(result.rows);
  };

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    setParseError("");
    try {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const buf = await file.arrayBuffer();
      if (ext === "xlsx") {
        const matrix = await parseXlsxArrayBuffer(buf);
        applyMatrix(matrix, file.name);
      } else if (ext === "xls") {
        setParseError(
          "구형 .xls 포맷은 엑셀에서 [다른 이름으로 저장 → Excel 통합 문서(.xlsx) 또는 CSV UTF-8(.csv)]로 저장 후 업로드하거나, 아래 [엑셀 복사·붙여넣기] 탭에 바로 붙여넣어 주세요."
        );
      } else {
        const text = decodeCsvArrayBuffer(buf);
        const matrix = parseSpreadsheetRowsFromText(text);
        applyMatrix(matrix, file.name);
      }
    } catch (err: any) {
      setParseError(err?.message || "파일 분석 중 오류가 발생했습니다.");
    }
  };

  const handleParsePaste = () => {
    if (!pasteText.trim()) {
      setParseError("엑셀에서 헤더(성명, 기본급 등)를 포함해 복사한 뒤 붙여넣어 주세요.");
      return;
    }
    const matrix = parseSpreadsheetRowsFromText(pasteText);
    applyMatrix(matrix, "엑셀 클립보드 붙여넣기");
  };

  const handleDownloadTemplate = () => {
    const csv = buildTaxLedgerUploadTemplateCsv(members, payMonth);
    triggerCsvDownload(`천종현수학연구소_급여대장_업로드양식_${payMonth}.csv`, csv);
  };

  const handleManualMemberMatch = (idx: number, memberId: string) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const found = members.find((m) => m.instructor_id === memberId);
        if (!found) {
          return {
            ...r,
            matchedMemberId: null,
            matchedBy: "UNMATCHED",
          };
        }
        const bank =
          r.bankInfo ||
          [found.bank_name, found.bank_account, found.account_holder]
            .filter(Boolean)
            .join(" ");
        return {
          ...r,
          matchedMemberId: found.instructor_id,
          matchedBy: "NAME",
          employeeNo: r.employeeNo || found.employee_no || "",
          departmentOrRole:
            r.departmentOrRole || `${found.department} · ${found.job_title}`,
          bankInfo: bank,
        };
      })
    );
  };

  const handleRemoveRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const totals = rows.reduce(
    (acc, r) => {
      acc.gross += r.grossAmount;
      acc.deduct += r.deductionTotal;
      acc.net += r.netAmount;
      if (r.matchedMemberId) acc.matched += 1;
      return acc;
    },
    { gross: 0, deduct: 0, net: 0, matched: 0 }
  );

  const handleSubmit = async (publishImmediately: boolean) => {
    if (rows.length === 0) return;
    setSubmitting(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { createdCount: number; updatedCount: number; skippedCount: number };
      }>("/api/hq/payroll", {
        method: "POST",
        body: {
          action: "BULK_UPSERT_LEDGER",
          pay_month: payMonth,
          pay_date: payDate,
          publish_immediately: publishImmediately,
          overwrite_existing: overwriteExisting,
          rows,
        },
      });
      const { createdCount, updatedCount } = res.data;
      alert(
        publishImmediately
          ? `✅ 총 ${createdCount + updatedCount}명(신규 ${createdCount}·갱신 ${updatedCount})의 급여명세서가 세무사 확정 금액 그대로 전 직원에게 배부되었습니다.`
          : `✅ 총 ${createdCount + updatedCount}명(신규 ${createdCount}·갱신 ${updatedCount})의 급여대장 초안이 반영되었습니다. 검토 후 일괄 배부하실 수 있습니다.`
      );
      await onSuccess();
      onClose();
    } catch (err: any) {
      alert(err?.message || "급여대장 업로드 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 print:hidden"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden"
      >
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0 bg-slate-50/70">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-blue-600 text-white text-[11px] font-extrabold">
                {payMonth} 귀속
              </span>
              <h3 className="text-base font-extrabold text-slate-900">
                📥 세무사 급여대장 엑셀 업로드 · 급여명세서 1클릭 배부
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              세무사 사무소(더존·위하고·세무사랑)에서 받은 급여대장(.xlsx / .csv)을 올리면{" "}
              <strong className="text-slate-700">1원 단수 오차 없이 공제액 그대로</strong> 각 구성원 계정에 급여명세서가 배부됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-200 text-slate-500 font-bold text-sm shrink-0"
          >
            ✕
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6 overflow-y-auto custom-scroll space-y-5 flex-1 text-xs">
          {/* 상단 모드 탭 + 양식 다운로드 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setInputMode("FILE")}
                className={`px-3.5 py-1.5 rounded-lg font-bold transition-colors ${
                  inputMode === "FILE"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                📂 엑셀(.xlsx) · CSV 파일 선택
              </button>
              <button
                type="button"
                onClick={() => setInputMode("PASTE")}
                className={`px-3.5 py-1.5 rounded-lg font-bold transition-colors ${
                  inputMode === "PASTE"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                📋 엑셀 표 복사 · 붙여넣기 (Ctrl+V)
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold"
            >
              ⬇️ 재직 임직원({activeMembers.length}명) 표준 업로드 양식 다운로드
            </button>
          </div>

          {/* 입력 영역 */}
          {inputMode === "FILE" ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0] || null;
                handleFileChange(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-brand rounded-2xl p-7 text-center cursor-pointer bg-slate-50/60 hover:bg-blue-50/30 transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  handleFileChange(f);
                  e.target.value = "";
                }}
              />
              <div className="text-2xl mb-1.5">📊</div>
              <div className="text-sm font-extrabold text-slate-800">
                {fileName
                  ? `선택됨: ${fileName} (다시 선택하려면 클릭)`
                  : "여기를 클릭하거나 세무사 급여대장 파일(.xlsx, .csv)을 끌어다 놓으세요"}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                성명 · 기본급 · 식대 · 국민연금 · 건강보험 · 장기요양 · 고용보험 · 소득세 · 지방소득세 열을 자동으로 인식합니다 (한글 엑셀 CP949/UTF-8 모두 호환)
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                rows={5}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={
                  "엑셀에서 헤더 줄(사번, 성명, 기본급, 식대, 국민연금, 건강보험, 장기요양, 고용보험, 소득세, 지방소득세 ...)부터 직원 행까지 드래그하여 복사(Ctrl+C)한 뒤 그대로 붙여넣기(Ctrl+V) 하세요."
                }
                className="w-full p-3.5 rounded-xl border border-slate-300 font-mono text-xs focus:outline-none focus:border-brand"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleParsePaste}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold"
                >
                  붙여넣은 데이터 분석하기
                </button>
              </div>
            </div>
          )}

          {parseError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold">
              ⚠️ {parseError}
            </div>
          )}

          {/* 분석 완료 미리보기 */}
          {rows.length > 0 && (
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="font-extrabold text-slate-900">
                    ✅ 총 {rows.length}명 분석 완료 · 본부 계정 매칭 {totals.matched}
                    /{rows.length}명
                  </div>
                  <div className="text-[11px] text-slate-600">
                    인식된 항목: {detectedCols.slice(0, 10).join(", ")}
                    {detectedCols.length > 10
                      ? ` 외 ${detectedCols.length - 10}개`
                      : ""}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-right">
                  <div>
                    <div className="text-[10px] font-bold text-slate-500">
                      세전 지급합계
                    </div>
                    <div className="font-extrabold text-slate-900">
                      {totals.gross.toLocaleString("ko-KR")}원
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-500">
                      공제 합계
                    </div>
                    <div className="font-extrabold text-rose-600">
                      -{totals.deduct.toLocaleString("ko-KR")}원
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-500">
                      차인 실지급액
                    </div>
                    <div className="font-black text-brand text-sm">
                      {totals.net.toLocaleString("ko-KR")}원
                    </div>
                  </div>
                </div>
              </div>

              {totals.matched < rows.length && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-semibold">
                  💡 성명이나 사번이 본부 계정과 자동 연결되지 않은 행이{" "}
                  <strong>{rows.length - totals.matched}건</strong> 있습니다. 표의 [구성원 계정 연결] 드롭다운에서 직원을 지정하면 해당 직원이 로그인했을 때 본인 급여명세서를 바로 열람할 수 있습니다.
                </div>
              )}

              <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-[340px]">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead className="bg-slate-100 sticky top-0 z-10 text-[11px] font-extrabold text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">엑셀 성명</th>
                      <th className="py-2.5 px-3">구성원 계정 연결</th>
                      <th className="py-2.5 px-3 text-right">기본급</th>
                      <th className="py-2.5 px-3 text-right">식대·수당</th>
                      <th className="py-2.5 px-3 text-right">세전합계</th>
                      <th className="py-2.5 px-3 text-right">4대보험</th>
                      <th className="py-2.5 px-3 text-right">소득·지방세</th>
                      <th className="py-2.5 px-3 text-right">기타공제</th>
                      <th className="py-2.5 px-3 text-right">차인 실지급액</th>
                      <th className="py-2.5 px-2 text-center">제외</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {rows.map((r, idx) => {
                      const fourIns =
                        r.nationalPension +
                        r.healthInsurance +
                        r.longTermCare +
                        r.employmentInsurance;
                      const taxSum = r.incomeTax + r.localIncomeTax;
                      const extraPay =
                        r.mealAllowance + r.overtimePay + r.bonusPay;
                      return (
                        <tr key={`${r.rowIndex}-${idx}`} className="hover:bg-slate-50">
                          <td className="py-2 px-3">
                            <div className="font-extrabold text-slate-900">
                              {r.payeeName}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {r.departmentOrRole}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <select
                              value={r.matchedMemberId || ""}
                              onChange={(e) =>
                                handleManualMemberMatch(idx, e.target.value)
                              }
                              className={`px-2 py-1 rounded-lg border text-[11px] font-bold ${
                                r.matchedMemberId
                                  ? "border-emerald-300 bg-emerald-50/70 text-emerald-800"
                                  : "border-amber-300 bg-amber-50 text-amber-800"
                              }`}
                            >
                              <option value="">⚠️ 미연결 (외부/퇴사)</option>
                              {members.map((m) => (
                                <option
                                  key={m.instructor_id}
                                  value={m.instructor_id}
                                >
                                  ✓ {m.name} ({m.department})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {r.basePay.toLocaleString()}원
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-slate-600">
                            {extraPay.toLocaleString()}원
                          </td>
                          <td className="py-2 px-3 text-right font-bold tabular-nums">
                            {r.grossAmount.toLocaleString()}원
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-rose-600">
                            -{fourIns.toLocaleString()}원
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-rose-600">
                            -{taxSum.toLocaleString()}원
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-slate-500">
                            {r.otherDeduction !== 0
                              ? `${r.otherDeduction > 0 ? "-" : "+"}${Math.abs(
                                  r.otherDeduction
                                ).toLocaleString()}원`
                              : "-"}
                          </td>
                          <td className="py-2 px-3 text-right font-black text-brand tabular-nums">
                            {r.netAmount.toLocaleString()}원
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(idx)}
                              className="px-1.5 py-0.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 font-bold"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* 하단 실행 바 */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 font-bold text-slate-700">
              <span>급여 지급일</span>
              <input
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
              />
            </label>
            <label className="flex items-center gap-1.5 font-semibold text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={overwriteExisting}
                onChange={(e) => setOverwriteExisting(e.target.checked)}
                className="w-4 h-4 accent-brand rounded"
              />
              <span>당월 기존 등록된 동일 직원 급여가 있으면 덮어쓰기</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold"
            >
              닫기
            </button>
            <button
              type="button"
              disabled={submitting || rows.length === 0}
              onClick={() => handleSubmit(false)}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold disabled:opacity-40"
            >
              초안으로 저장 (검토 후 배부)
            </button>
            <button
              type="button"
              disabled={submitting || rows.length === 0}
              onClick={() => handleSubmit(true)}
              className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white font-extrabold shadow-sm disabled:opacity-40"
            >
              ⚡ 업로드 및 전 직원 명세서 즉시 배부 ({rows.length}명)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
