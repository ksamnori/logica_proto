// src/components/hq/payroll/TaxAccountantPrepPanel.tsx
"use client";

import React, { useMemo, useState } from "react";
import { PAYROLL_TYPE_META } from "@/lib/hq/constants";
import {
  buildExternalWithholdingStatementCsv,
  buildTaxAccountantMonthlyPackageCsv,
  summarizeMonthlyPrepByMember,
  triggerCsvDownload,
} from "@/lib/hq/payrollUtils";
import { describeExternalWithholdingRecord } from "@/lib/hq/publishingRights";
import type {
  HqApprovalDoc,
  HqAttendanceRecord,
  HqMember,
  HqPayrollRecord,
  HqPayrollType,
} from "@/lib/hq/types";

interface TaxAccountantPrepPanelProps {
  companyName: string;
  payMonth: string;
  members: HqMember[];
  payrollRecords: HqPayrollRecord[];
  attendanceRows: HqAttendanceRecord[];
  leaveDocs: HqApprovalDoc[];
  onSelectCurrentMonth: () => void;
  onQuickCreate: (type: HqPayrollType) => void;
}

export default function TaxAccountantPrepPanel({
  companyName,
  payMonth,
  members,
  payrollRecords,
  attendanceRows,
  leaveDocs,
  onSelectCurrentMonth,
  onQuickCreate,
}: TaxAccountantPrepPanelProps) {
  const [copied, setCopied] = useState(false);

  const prepMap = useMemo(() => {
    if (payMonth === "ALL") return new Map();
    return summarizeMonthlyPrepByMember({
      payMonth,
      members,
      attendanceRows,
      leaveDocs,
    });
  }, [payMonth, members, attendanceRows, leaveDocs]);

  const hrChanges = useMemo(() => {
    if (payMonth === "ALL") return [];
    return members.filter(
      (m) =>
        (m.hire_date && m.hire_date.startsWith(payMonth)) ||
        (m.resign_date && m.resign_date.startsWith(payMonth)) ||
        m.work_status === "휴직"
    );
  }, [members, payMonth]);

  const activeTargetMembers = useMemo(
    () =>
      members.filter(
        (m) =>
          m.work_status === "재직" ||
          (payMonth !== "ALL" && m.resign_date?.startsWith(payMonth))
      ),
    [members, payMonth]
  );

  const empPayrollByMember = useMemo(() => {
    const m = new Map<string, HqPayrollRecord>();
    payrollRecords
      .filter((r) => r.pay_type === "EMPLOYEE" && r.member_id)
      .forEach((r) => m.set(String(r.member_id), r));
    return m;
  }, [payrollRecords]);

  const externalWithholding = useMemo(
    () => payrollRecords.filter((r) => r.pay_type !== "EMPLOYEE"),
    [payrollRecords]
  );

  // 원천징수이행상황신고서 세목별(근로 A01 / 사업 A25 / 기타 A40) 요약 및 다음달 법정 신고기한 계산
  const withholdingBreakdown = useMemo(() => {
    const empRows = payrollRecords.filter((r) => r.pay_type === "EMPLOYEE");
    const empGross = empRows.reduce((s, r) => s + Number(r.gross_amount || 0), 0);
    const empTax = empRows.reduce(
      (s, r) => s + Number(r.income_tax || 0) + Number(r.local_income_tax || 0),
      0
    );

    let bizCount = 0,
      bizGross = 0,
      bizTax = 0;
    let othCount = 0,
      othGross = 0,
      othExpense = 0,
      othTaxable = 0,
      othTax = 0;
    let missingIdCount = 0;

    externalWithholding.forEach((r) => {
      const wh = describeExternalWithholdingRecord(r);
      if (!r.calc_meta?.resident_or_biz_no?.trim()) missingIdCount += 1;
      if (wh.mode === "OTHER_88") {
        othCount += 1;
        othGross += wh.grossAmount;
        othExpense += wh.necessaryExpense;
        othTaxable += wh.taxableIncome;
        othTax += wh.withholdingTotal;
      } else {
        bizCount += 1;
        bizGross += wh.grossAmount;
        bizTax += wh.withholdingTotal;
      }
    });

    let taxDueYmd = "";
    let simpleStmtDueYmd = "";
    if (/^\d{4}-\d{2}$/.test(payMonth)) {
      const [y, m] = payMonth.split("-").map(Number);
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      const nextYm = `${nextY}-${String(nextM).padStart(2, "0")}`;
      const lastDay = new Date(nextY, nextM, 0).getDate();
      taxDueYmd = `${nextYm}-10`;
      simpleStmtDueYmd = `${nextYm}-${String(lastDay).padStart(2, "0")}`;
    }

    return {
      empCount: empRows.length,
      empGross,
      empTax,
      bizCount,
      bizGross,
      bizTax,
      othCount,
      othGross,
      othExpense,
      othTaxable,
      othTax,
      missingIdCount,
      taxDueYmd,
      simpleStmtDueYmd,
    };
  }, [payrollRecords, externalWithholding, payMonth]);

  if (payMonth === "ALL") {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center space-y-3">
        <div className="text-3xl">📅</div>
        <h3 className="text-base font-extrabold text-slate-900">
          세무사 전달 기초자료는 특정 귀속월(YYYY-MM)을 선택해야 집계됩니다
        </h3>
        <p className="text-xs text-slate-500">
          상단 월 선택기에서 정산할 귀속월을 지정하거나 아래 버튼을 눌러 당월 자료를 불러오세요.
        </p>
        <button
          type="button"
          onClick={onSelectCurrentMonth}
          className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold"
        >
          이번 달 귀속자료 바로 열기
        </button>
      </div>
    );
  }

  const handleDownloadCsv = () => {
    const csv = buildTaxAccountantMonthlyPackageCsv({
      companyName,
      payMonth,
      members,
      payrollRecords,
      prepMap,
    });
    triggerCsvDownload(
      `${companyName.replace(/[\\/:*?"<>|]/g, "")}_세무사전달_기초자료_${payMonth}.csv`,
      csv
    );
  };

  const handleDownloadWithholdingCsv = () => {
    if (externalWithholding.length === 0) {
      alert("당월 등록된 사업소득(3.3%) · 기타소득(8.8%) · 저자 인세 내역이 없습니다.");
      return;
    }
    const csv = buildExternalWithholdingStatementCsv({
      companyName,
      payMonth,
      payrollRecords,
    });
    triggerCsvDownload(
      `${companyName.replace(/[\\/:*?"<>|]/g, "")}_원천세_간이지급명세서_${payMonth}.csv`,
      csv
    );
  };

  const handleCopyEmailDraft = async () => {
    const specialLeaveLines: string[] = [];
    const bonusAdjustLines: string[] = [];

    activeTargetMembers.forEach((m) => {
      const p = prepMap.get(m.instructor_id);
      const pr = empPayrollByMember.get(m.instructor_id);
      if (p?.specialOrUnpaidLeaves?.length) {
        specialLeaveLines.push(
          `- ${m.name}(${m.department}): ${p.specialOrUnpaidLeaves.join(", ")}`
        );
      }
      if (pr && (pr.overtime_pay > 0 || pr.bonus_pay !== 0)) {
        const items: string[] = [];
        if (pr.overtime_pay > 0)
          items.push(`연장·마감수당 ${pr.overtime_pay.toLocaleString()}원`);
        if (pr.bonus_pay !== 0)
          items.push(`상여·기타수당 ${pr.bonus_pay.toLocaleString()}원`);
        bonusAdjustLines.push(
          `- ${m.name}(${m.department}): ${items.join(", ")}${
            pr.memo ? ` (${pr.memo})` : ""
          }`
        );
      }
    });

    const extSumGross = externalWithholding.reduce(
      (s, r) => s + r.gross_amount,
      0
    );
    const extSumTax = externalWithholding.reduce(
      (s, r) => s + r.income_tax + r.local_income_tax,
      0
    );

    const [y, m] = payMonth.split("-");
    const draft = [
      `안녕하세요 세무사님, ${companyName}입니다.`,
      `${y}년 ${Number(m)}월 귀속 급여대장 작성 및 원천세 신고용 기초자료 전달드립니다.`,
      ``,
      `1. 입·퇴사 및 휴직 변동 (${hrChanges.length}명)`,
      hrChanges.length === 0
        ? `- 당월 입·퇴사 및 휴직 변동사항 없습니다.`
        : hrChanges
            .map((x) => {
              const kind = x.resign_date?.startsWith(payMonth)
                ? `퇴사(${x.resign_date})`
                : x.hire_date?.startsWith(payMonth)
                ? `신규입사(${x.hire_date})`
                : x.work_status;
              return `- ${x.name} (${x.department} · ${x.job_title}): ${kind}`;
            })
            .join("\n"),
      ``,
      `2. 특별/무급휴가 및 변동수당 반영 요청`,
      specialLeaveLines.length === 0 && bonusAdjustLines.length === 0
        ? `- 전월 대비 별도 무급휴가 및 변동수당 특이사항 없습니다.`
        : [...specialLeaveLines, ...bonusAdjustLines].join("\n"),
      ``,
      `3. 외주 프리랜서(3.3%) · 기타소득(8.8%) · 저자 인세 지급내역`,
      externalWithholding.length === 0
        ? `- 당월 사업·기타소득 지급 내역 없습니다.`
        : [
            `- 총 ${externalWithholding.length}건 / 세전 합계 ${extSumGross.toLocaleString()}원 (원천세 예수금 합계 ${extSumTax.toLocaleString()}원)`,
            withholdingBreakdown.bizCount > 0
              ? `  · 거주자 사업소득(3.3%, 외주·사업자 인세): ${withholdingBreakdown.bizCount}건 / 지급액 ${withholdingBreakdown.bizGross.toLocaleString()}원 / 원천세 ${withholdingBreakdown.bizTax.toLocaleString()}원`
              : "",
            withholdingBreakdown.othCount > 0
              ? `  · 기타소득(8.8%, 원고검토·비사업자 인세): ${withholdingBreakdown.othCount}건 / 총지급액 ${withholdingBreakdown.othGross.toLocaleString()}원 (필요경비 60% 공제 후 소득금액 ${withholdingBreakdown.othTaxable.toLocaleString()}원) / 원천세 ${withholdingBreakdown.othTax.toLocaleString()}원`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
      ``,
      `첨부해 드린 기초자료 엑셀 확인 부탁드리며, 급여대장 확정본 회신 주시면 시스템에 업로드하여 급여명세서 배부 진행하겠습니다. 감사합니다.`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      alert("클립보드 복사에 실패했습니다.");
    }
  };

  return (
    <div className="space-y-5">
      {/* 상단 액션 배너 */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 text-white p-5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-blue-500/30 border border-blue-400/40 text-blue-200 text-[11px] font-extrabold">
              {payMonth} 귀속 세무기장 연동
            </span>
            <span className="text-xs text-slate-300 font-semibold">
              매월 급여일 전 세무사 사무소 전달용
            </span>
          </div>
          <h3 className="text-base font-extrabold">
            📤 월간 입·퇴사 · 근태/휴가 · 변동수당 · 외주/인세 원천세 자동 취합표
          </h3>
          <p className="text-xs text-slate-300">
            본부 인사·근태·휴가·인세 데이터를 한 장의 엑셀로 묶어 세무사에게 전달하고, 회신받은 급여대장을 업로드하면 이중 작업이 사라집니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyEmailDraft}
            className="px-3.5 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition-colors"
          >
            {copied ? "✓ 메일·카톡 문구 복사됨!" : "📋 세무사 전달 메일문구 복사"}
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-extrabold shadow-md"
          >
            📥 세무사 전달용 기초자료 엑셀(CSV) 다운로드
          </button>
        </div>
      </div>

      {/* 섹션 1: 당월 입·퇴사 및 휴직 변동자 */}
      <section className="rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div>
            <h4 className="text-sm font-extrabold text-slate-900">
              1️⃣ 당월 입사 · 퇴사 · 휴직 변동자 ({hrChanges.length}명)
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              4대보험 자격 취득·상실 신고 및 일할계산·중도정산 대상 구성원입니다.
            </p>
          </div>
        </div>

        {hrChanges.length === 0 ? (
          <div className="p-6 text-xs text-slate-400 text-center">
            {payMonth} 귀속월에는 신규 입사·퇴사 및 휴직 변동 인원이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">변동구분</th>
                  <th className="py-2.5 px-4">성명 (부서·직책)</th>
                  <th className="py-2.5 px-4">주민번호 등록상태</th>
                  <th className="py-2.5 px-4">입사일 / 퇴사일</th>
                  <th className="py-2.5 px-4 text-right">임금계약 기준</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hrChanges.map((m) => {
                  const isResign = m.resign_date?.startsWith(payMonth);
                  const isNewHire = m.hire_date?.startsWith(payMonth);
                  const hasRrn = Boolean(m.profile_extra?.rrn_front);
                  const wc = m.profile_extra?.wage_contract;
                  return (
                    <tr key={m.instructor_id} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
                            isResign
                              ? "bg-rose-50 text-rose-700"
                              : isNewHire
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {isResign
                            ? "당월 퇴사"
                            : isNewHire
                            ? "신규 입사"
                            : m.work_status}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-extrabold text-slate-900">
                        {m.name}{" "}
                        <span className="text-slate-400 font-semibold">
                          ({m.department} · {m.job_title})
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {hasRrn ? (
                          <span className="text-emerald-700 font-bold">
                            ✓ {m.profile_extra?.rrn_front}-
                            {m.profile_extra?.rrn_gender_digit || "*"}******
                          </span>
                        ) : (
                          <span className="text-amber-700 font-bold">
                            ⚠️ 주민번호 미입력 (4대보험 신고 전 확인)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-mono">
                        입사 {m.hire_date || "-"}
                        {m.resign_date ? ` / 퇴사 ${m.resign_date}` : ""}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-800">
                        {wc?.monthly_base
                          ? `월 기본급 ${Number(wc.monthly_base).toLocaleString()}원`
                          : wc?.annual_salary
                          ? `연봉 ${Number(wc.annual_salary).toLocaleString()}원`
                          : "미입력"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 섹션 2: 재직자 월간 근태·휴가·변동수당 */}
      <section className="rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div>
            <h4 className="text-sm font-extrabold text-slate-900">
              2️⃣ 재직 임직원 근태 · 연장근무 · 특별휴가 · 변동급 집계 ({activeTargetMembers.length}명)
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              출퇴근 기록, 승인된 휴가 문서, 당월 급여대장 변동수당(연장·상여)이 자동 결합됩니다.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500">
              <tr>
                <th className="py-2.5 px-4">성명 · 부서</th>
                <th className="py-2.5 px-4 text-right">출근일수</th>
                <th className="py-2.5 px-4 text-right">연장근무</th>
                <th className="py-2.5 px-4 text-right">연차사용</th>
                <th className="py-2.5 px-4">기타·특별휴가(병가/출산 등)</th>
                <th className="py-2.5 px-4 text-right">연장·마감수당</th>
                <th className="py-2.5 px-4 text-right">상여·기타수당</th>
                <th className="py-2.5 px-4">정산 메모</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeTargetMembers.map((m) => {
                const prep = prepMap.get(m.instructor_id);
                const pr = empPayrollByMember.get(m.instructor_id);
                return (
                  <tr key={m.instructor_id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4">
                      <span className="font-extrabold text-slate-900">
                        {m.name}
                      </span>{" "}
                      <span className="text-slate-400 font-semibold">
                        ({m.department} · {m.job_title})
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold">
                      {prep?.workDays ?? 0}일 ({prep?.workedHours ?? 0}h)
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums">
                      {(prep?.overtimeHours ?? 0) > 0 ? (
                        <span className="font-bold text-indigo-700">
                          +{prep?.overtimeHours}h
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums">
                      {(prep?.annualLeaveDays ?? 0) > 0
                        ? `${prep?.annualLeaveDays}일`
                        : "-"}
                    </td>
                    <td className="py-2.5 px-4">
                      {prep?.specialOrUnpaidLeaves?.length ? (
                        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 font-bold text-[11px]">
                          {prep.specialOrUnpaidLeaves.join(", ")}
                        </span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold text-slate-800">
                      {pr?.overtime_pay
                        ? `${pr.overtime_pay.toLocaleString()}원`
                        : "-"}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold text-slate-800">
                      {pr?.bonus_pay
                        ? `${pr.bonus_pay.toLocaleString()}원`
                        : "-"}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 max-w-[240px] truncate">
                      {pr?.memo || "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 섹션 3: 외주 3.3% · 원고검토 8.8% · 저자 인세 원천징수 신고 대상 */}
      <section className="rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70">
          <div>
            <h4 className="text-sm font-extrabold text-slate-900">
              3️⃣ 당월 외주(3.3%) · 원고검토(8.8%) · 저자 인세 원천징수 신고 대상 ({externalWithholding.length}건)
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              원천세 신고·납부 기한: <b>{withholdingBreakdown.taxDueYmd || "익월 10일"}</b> · 거주자 사업소득 간이지급명세서 제출 기한:{" "}
              <b>{withholdingBreakdown.simpleStmtDueYmd || "익월 말일"}</b>
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {externalWithholding.length > 0 && (
              <button
                type="button"
                onClick={handleDownloadWithholdingCsv}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-extrabold"
              >
                ⤓ 원천세·간이지급명세서 CSV
              </button>
            )}
            <button
              type="button"
              onClick={() => onQuickCreate("FREELANCER_33")}
              className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold"
            >
              + 외주 3.3% 추가
            </button>
            <button
              type="button"
              onClick={() => onQuickCreate("OTHER_88")}
              className="px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold"
            >
              + 기타 8.8% 추가
            </button>
            <button
              type="button"
              onClick={() => onQuickCreate("ROYALTY")}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              + 저자 인세 추가
            </button>
          </div>
        </div>

        {/* 원천징수이행상황신고서 세목별(A01 / A25 / A40) 미니 요약 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 p-4 bg-slate-50/40 border-b border-slate-100 text-xs">
          <div className="rounded-xl bg-white border border-slate-200 p-3">
            <div className="text-[11px] font-bold text-slate-500">A01 근로소득 (임직원 급여)</div>
            <div className="text-sm font-black text-slate-900 mt-0.5 tabular-nums">
              {withholdingBreakdown.empCount}명 · 세전 {withholdingBreakdown.empGross.toLocaleString()}원
            </div>
            <div className="text-[11px] text-rose-600 font-semibold mt-0.5 tabular-nums">
              원천세 예수금 {withholdingBreakdown.empTax.toLocaleString()}원
            </div>
          </div>
          <div className="rounded-xl bg-white border border-amber-200 p-3">
            <div className="text-[11px] font-bold text-amber-800">
              A25 거주자 사업소득 3.3% (외주 · 전업작가 인세)
            </div>
            <div className="text-sm font-black text-slate-900 mt-0.5 tabular-nums">
              {withholdingBreakdown.bizCount}건 · 지급액 {withholdingBreakdown.bizGross.toLocaleString()}원
            </div>
            <div className="text-[11px] text-rose-600 font-semibold mt-0.5 tabular-nums">
              원천세 예수금 {withholdingBreakdown.bizTax.toLocaleString()}원 · 매월 간이지급명세서 제출
            </div>
          </div>
          <div className="rounded-xl bg-white border border-purple-200 p-3">
            <div className="text-[11px] font-bold text-purple-800">
              A40 기타소득 8.8% (원고·검토 · 비사업자 인세)
            </div>
            <div className="text-sm font-black text-slate-900 mt-0.5 tabular-nums">
              {withholdingBreakdown.othCount}건 · 총지급 {withholdingBreakdown.othGross.toLocaleString()}원
            </div>
            <div className="text-[11px] text-slate-600 mt-0.5 tabular-nums">
              필요경비(60%) {withholdingBreakdown.othExpense.toLocaleString()}원 → 과세소득{" "}
              <b>{withholdingBreakdown.othTaxable.toLocaleString()}원</b> · 원천세{" "}
              <span className="text-rose-600 font-bold">{withholdingBreakdown.othTax.toLocaleString()}원</span>
            </div>
          </div>
        </div>

        {withholdingBreakdown.missingIdCount > 0 && (
          <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-[11px] font-bold text-amber-900">
            ⚠️ 주민등록번호 또는 사업자등록번호가 미입력된 지급 건이 {withholdingBreakdown.missingIdCount}건 있습니다. 홈택스 원천세 및 간이지급명세서 제출 전 식별번호를 확인해 주세요.
          </div>
        )}

        {externalWithholding.length === 0 ? (
          <div className="p-6 text-xs text-slate-400 text-center">
            {payMonth} 귀속월에 등록된 사업소득(3.3%) · 기타소득(8.8%) · 저자 인세 지급 건이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">신고 세목 · 구분</th>
                  <th className="py-2.5 px-4">수령인 · 주민/사업자번호</th>
                  <th className="py-2.5 px-4">도서명 · 프로젝트</th>
                  <th className="py-2.5 px-4">지급일</th>
                  <th className="py-2.5 px-4 text-right">총지급액(세전)</th>
                  <th className="py-2.5 px-4 text-right">필요경비 / 소득금액</th>
                  <th className="py-2.5 px-4 text-right">원천세(소득+지방세)</th>
                  <th className="py-2.5 px-4 text-right">차인 실지급액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {externalWithholding.map((r) => {
                  const meta = PAYROLL_TYPE_META[r.pay_type];
                  const wh = describeExternalWithholdingRecord(r);
                  const badgeCls =
                    r.pay_type === "ROYALTY" && wh.mode === "OTHER_88"
                      ? "bg-purple-50 text-purple-700 border-purple-200"
                      : meta.badgeClass;
                  return (
                    <tr key={r.payroll_id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded border text-[10px] font-bold ${badgeCls}`}
                        >
                          {wh.shortBadge}
                        </span>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {wh.mode === "OTHER_88" ? "A40 기타소득" : "A25 사업소득"}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-extrabold text-slate-900">
                          {r.payee_name}{" "}
                          <span className="text-slate-400 font-semibold">
                            ({r.department_or_role})
                          </span>
                        </div>
                        {r.calc_meta?.resident_or_biz_no ? (
                          <div className="text-[11px] text-slate-500 font-mono">
                            식별번호: {r.calc_meta.resident_or_biz_no}
                          </div>
                        ) : (
                          <div className="text-[10.5px] text-amber-700 font-bold">
                            ⚠ 주민/사업자번호 미기재
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-slate-700">
                        {r.book_or_project || "-"}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-500">
                        {r.pay_date || "-"}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold tabular-nums">
                        {wh.grossAmount.toLocaleString()}원
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-[11px] text-slate-600">
                        {wh.mode === "OTHER_88" ? (
                          <>
                            <div>경비 -{wh.necessaryExpense.toLocaleString()}원</div>
                            <div className="font-bold text-slate-800">
                              소득 {wh.taxableIncome.toLocaleString()}원
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400">전액 소득금액</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right text-rose-600 font-bold tabular-nums">
                        -{wh.withholdingTotal.toLocaleString()}원
                        {wh.taxExemptionNote && (
                          <div className="text-[10px] text-emerald-700 font-semibold">
                            {wh.taxExemptionNote}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-black text-brand tabular-nums">
                        {wh.netAmount.toLocaleString()}원
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
