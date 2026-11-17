// src/components/hq/payroll/SeveranceCalculatorPanel.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { hqFetch } from "@/lib/hq/clientApi";
import {
  buildDefaultThreeMonthSlices,
  calculateSeveranceEstimate,
  type SeveranceMonthSlice,
} from "@/lib/hq/payrollUtils";
import type { HqMember, HqPayrollRecord } from "@/lib/hq/types";

interface SeveranceCalculatorPanelProps {
  companyName: string;
  members: HqMember[];
}

export default function SeveranceCalculatorPanel({
  companyName,
  members,
}: SeveranceCalculatorPanelProps) {
  const todayStr = useMemo(
    () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10),
    []
  );

  const [selectedMemberId, setSelectedMemberId] = useState<string>(
    members[0]?.instructor_id || ""
  );
  const [targetName, setTargetName] = useState<string>(members[0]?.name || "");
  const [targetDept, setTargetDept] = useState<string>(
    members[0] ? `${members[0].department} · ${members[0].job_title}` : ""
  );
  const [hireDate, setHireDate] = useState<string>(
    members[0]?.hire_date || "2023-03-01"
  );
  const [resignDate, setResignDate] = useState<string>(
    members[0]?.resign_date || todayStr
  );
  const [monthlyOrdinaryWage, setMonthlyOrdinaryWage] = useState<string>("3000000");
  const [annualBonusTotal, setAnnualBonusTotal] = useState<string>("0");
  const [unusedAnnualLeavePay, setUnusedAnnualLeavePay] = useState<string>("0");
  const [slices, setSlices] = useState<SeveranceMonthSlice[]>(() =>
    buildDefaultThreeMonthSlices(todayStr, 2_800_000, 200_000)
  );
  const [loadingDb, setLoadingDb] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const applyMemberPreset = (memberId: string) => {
    setSelectedMemberId(memberId);
    const m = members.find((x) => x.instructor_id === memberId);
    if (!m) return;
    setTargetName(m.name);
    setTargetDept(`${m.department} · ${m.job_title}`);
    const nextHire = m.hire_date || "2023-03-01";
    const nextResign = m.resign_date || todayStr;
    setHireDate(nextHire);
    setResignDate(nextResign);

    const wc = m.profile_extra?.wage_contract;
    const meal = wc?.meal_allowance !== undefined ? Number(wc.meal_allowance) : 200_000;
    const base = wc?.monthly_base
      ? Number(wc.monthly_base)
      : wc?.annual_salary
      ? Math.max(0, Math.round(Number(wc.annual_salary) / 12) - meal)
      : 2_800_000;
    setMonthlyOrdinaryWage(String(base + meal));
    setSlices(buildDefaultThreeMonthSlices(nextResign, base, meal));
  };

  useEffect(() => {
    if (!selectedMemberId && members.length > 0) {
      applyMemberPreset(members[0].instructor_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  const handleRecalcDates = (nextResign: string) => {
    setResignDate(nextResign);
    const ord = Number(monthlyOrdinaryWage || 3_000_000);
    const recalculated = buildDefaultThreeMonthSlices(nextResign, ord, 0);
    if (recalculated.length === 3) {
      setSlices((prev) =>
        recalculated.map((s, idx) => ({
          ...s,
          baseAndFixedPay: prev[idx]?.baseAndFixedPay ?? s.baseAndFixedPay,
          variableOvertimePay: prev[idx]?.variableOvertimePay ?? 0,
        }))
      );
    }
  };

  const handleLoadFromPayrollDb = async () => {
    if (!selectedMemberId) {
      alert("먼저 대상 구성원을 선택해 주세요.");
      return;
    }
    setLoadingDb(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { records: HqPayrollRecord[] };
      }>(`/api/hq/payroll?month=ALL&member_id=${selectedMemberId}`);
      const empRows = (res.data?.records || [])
        .filter((r) => r.pay_type === "EMPLOYEE")
        .sort((a, b) => b.pay_month.localeCompare(a.pay_month));

      if (empRows.length === 0) {
        alert("저장된 해당 구성원의 급여대장 이력이 없습니다. 수동으로 금액을 입력해 주세요.");
        return;
      }

      const resignYm = resignDate.slice(0, 7);
      const recent3 = empRows
        .filter((r) => r.pay_month <= resignYm)
        .slice(0, 3)
        .reverse();

      const baseSlices = buildDefaultThreeMonthSlices(
        resignDate,
        Number(monthlyOrdinaryWage || 3_000_000),
        0
      );

      const mergedSlices = baseSlices.map((sl, idx) => {
        const matchedRow =
          empRows.find((r) => r.pay_month === sl.endDate.slice(0, 7)) ||
          recent3[idx];
        if (!matchedRow) return sl;
        return {
          ...sl,
          baseAndFixedPay:
            Number(matchedRow.base_pay || 0) +
            Number(matchedRow.meal_allowance || 0),
          variableOvertimePay: Number(matchedRow.overtime_pay || 0),
        };
      });
      setSlices(mergedSlices);

      const latest = empRows[0];
      if (latest) {
        setMonthlyOrdinaryWage(
          String(Number(latest.base_pay || 0) + Number(latest.meal_allowance || 0))
        );
      }

      // 최근 12개월 내 상여금 합계 자동 집계
      const bonus12m = empRows
        .slice(0, 12)
        .reduce((acc, r) => acc + Math.max(0, Number(r.bonus_pay || 0)), 0);
      setAnnualBonusTotal(String(bonus12m));
    } catch (err: any) {
      alert(err?.message || "급여 이력 조회 실패");
    } finally {
      setLoadingDb(false);
    }
  };

  const updateSlice = (
    idx: number,
    field: keyof SeveranceMonthSlice,
    val: string
  ) => {
    setSlices((prev) =>
      prev.map((s, i) =>
        i === idx
          ? {
              ...s,
              [field]:
                field === "calendarDays" ||
                field === "baseAndFixedPay" ||
                field === "variableOvertimePay"
                  ? Number(val || 0)
                  : val,
            }
          : s
      )
    );
  };

  const result = useMemo(
    () =>
      calculateSeveranceEstimate({
        hireDate,
        resignDate,
        slices,
        annualBonusTotal: Number(annualBonusTotal || 0),
        unusedAnnualLeavePay: Number(unusedAnnualLeavePay || 0),
        monthlyOrdinaryWage: Number(monthlyOrdinaryWage || 0),
      }),
    [
      hireDate,
      resignDate,
      slices,
      annualBonusTotal,
      unusedAnnualLeavePay,
      monthlyOrdinaryWage,
    ]
  );

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 print:hidden">
        {/* 좌측 입력 폼 (7칼럼) */}
        <div className="xl:col-span-7 rounded-2xl bg-white border border-slate-200 p-6 shadow-xs space-y-5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                🧮 법정 퇴직금 간편 계산기 (평균임금 · 통상임금 비교)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                구성원 입사일과 급여대장 데이터를 불러와 세무사 확정 전 예상 퇴직급여와 세액을 즉시 시뮬레이션합니다.
              </p>
            </div>
            <button
              type="button"
              disabled={loadingDb}
              onClick={handleLoadFromPayrollDb}
              className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold disabled:opacity-50"
            >
              {loadingDb ? "불러오는 중..." : "🔄 DB 급여대장 최근 3개월 불러오기"}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                대상 구성원 불러오기
              </label>
              <select
                value={selectedMemberId}
                onChange={(e) => applyMemberPreset(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold bg-white"
              >
                <option value="">직접 입력 시뮬레이션</option>
                {members.map((m) => (
                  <option key={m.instructor_id} value={m.instructor_id}>
                    {m.name} ({m.department} · {m.work_status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                입사일
              </label>
              <input
                type="date"
                value={hireDate}
                onChange={(e) => setHireDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                퇴직일 (마지막 근무일 다음날)
              </label>
              <input
                type="date"
                value={resignDate}
                onChange={(e) => handleRecalcDates(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              />
            </div>
          </div>

          {/* 퇴직 전 3개월 임금 테이블 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-slate-800">
                퇴직 전 3개월 임금 내역 (세전 과세 + 비과세 식대 포함 총액)
              </span>
              <span className="text-[11px] text-slate-500">
                총 {result.threeMonthDays}일 합계:{" "}
                <strong className="text-slate-800">
                  {result.threeMonthWageSum.toLocaleString()}원
                </strong>
              </span>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500">
                  <tr>
                    <th className="py-2 px-3">구간</th>
                    <th className="py-2 px-3">산정 기간</th>
                    <th className="py-2 px-3 w-20">일수</th>
                    <th className="py-2 px-3">기본급 · 고정수당(원)</th>
                    <th className="py-2 px-3">연장 · 변동수당(원)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {slices.map((s, idx) => (
                    <tr key={idx}>
                      <td className="py-2 px-3 font-bold text-slate-700">
                        {s.label}
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-500">
                        {s.startDate} ~ {s.endDate}
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          value={s.calendarDays}
                          onChange={(e) =>
                            updateSlice(idx, "calendarDays", e.target.value)
                          }
                          className="w-16 px-2 py-1 rounded-lg border border-slate-300 font-bold text-right"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          value={s.baseAndFixedPay}
                          onChange={(e) =>
                            updateSlice(idx, "baseAndFixedPay", e.target.value)
                          }
                          className="w-36 px-2.5 py-1 rounded-lg border border-slate-300 font-bold text-right"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          value={s.variableOvertimePay}
                          onChange={(e) =>
                            updateSlice(
                              idx,
                              "variableOvertimePay",
                              e.target.value
                            )
                          }
                          className="w-32 px-2.5 py-1 rounded-lg border border-slate-300 font-bold text-right"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                월 통상임금 (209시간 기준)
              </label>
              <input
                type="number"
                value={monthlyOrdinaryWage}
                onChange={(e) => setMonthlyOrdinaryWage(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              />
              <span className="text-[10px] text-slate-400">
                평균임금이 통상임금보다 낮을 때 보호 기준
              </span>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                퇴직 전 1년간 정기상여 총액
              </label>
              <input
                type="number"
                value={annualBonusTotal}
                onChange={(e) => setAnnualBonusTotal(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              />
              <span className="text-[10px] text-slate-400">
                3/12 가산액: {result.bonusThreeMonthPortion.toLocaleString()}원
              </span>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                전년도 미사용 연차수당
              </label>
              <input
                type="number"
                value={unusedAnnualLeavePay}
                onChange={(e) => setUnusedAnnualLeavePay(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold"
              />
              <span className="text-[10px] text-slate-400">
                3/12 가산액: {result.annualLeaveThreeMonthPortion.toLocaleString()}원
              </span>
            </div>
          </div>
        </div>

        {/* 우측 산출 결과 카드 (5칼럼) */}
        <div className="xl:col-span-5 rounded-2xl bg-slate-900 text-white p-6 shadow-md flex flex-col justify-between space-y-5 text-xs">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <div>
                <div className="text-slate-400 font-semibold">퇴직금 시뮬레이션 결과</div>
                <div className="text-base font-extrabold mt-0.5">
                  {targetName || "대상자"} ({targetDept || "소속 미지정"})
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold ${
                  result.eligible
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30"
                    : "bg-amber-500/20 text-amber-300 border border-amber-400/30"
                }`}
              >
                {result.eligible ? "✓ 1년 이상 근속 충족" : "⚠️ 1년 미만 근속"}
              </span>
            </div>

            <div className="space-y-2.5 bg-slate-800/80 rounded-xl p-4 border border-slate-700/80">
              <div className="flex justify-between">
                <span className="text-slate-400">총 재직기간</span>
                <span className="font-extrabold">{result.tenureText}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">3개월 임금 산정 총액</span>
                <span className="font-bold">
                  {result.totalThreeMonthBase.toLocaleString("ko-KR")}원 (
                  {result.threeMonthDays}일)
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">산출 1일 평균임금</span>
                <span
                  className={`font-bold ${
                    !result.ordinaryWageApplied ? "text-emerald-300" : "text-slate-300"
                  }`}
                >
                  {result.dailyAverageWage.toLocaleString("ko-KR")}원{" "}
                  {!result.ordinaryWageApplied && "✓ 적용"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">비교 1일 통상임금</span>
                <span
                  className={`font-bold ${
                    result.ordinaryWageApplied ? "text-emerald-300" : "text-slate-300"
                  }`}
                >
                  {result.dailyOrdinaryWage.toLocaleString("ko-KR")}원{" "}
                  {result.ordinaryWageApplied && "✓ 통상임금 보호 적용"}
                </span>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex justify-between text-sm">
                <span className="text-slate-300 font-bold">세전 퇴직급여 추계액</span>
                <span className="font-extrabold text-white">
                  {result.grossSeverance.toLocaleString("ko-KR")}원
                </span>
              </div>
              <div className="flex justify-between text-rose-300">
                <span>
                  예상 퇴직소득세 + 지방소득세 (근속 {result.tenureYearsCeiling}년 공제)
                </span>
                <span className="font-bold">
                  -
                  {(
                    result.estimatedIncomeTax + result.estimatedLocalTax
                  ).toLocaleString("ko-KR")}
                  원
                </span>
              </div>
              <div className="pt-3 border-t border-slate-700 flex justify-between items-end">
                <div>
                  <div className="text-emerald-300 font-extrabold text-xs">
                    예상 차인 실수령 퇴직금 (IRP 이전 시 세액 이연)
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    * 최종 퇴직소득 원천징수영수증은 세무사 확정본을 기준으로 합니다.
                  </div>
                </div>
                <div className="text-2xl font-black text-white tabular-nums">
                  {result.netSeverance.toLocaleString("ko-KR")}원
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPrintOpen(true)}
            className="w-full py-3 rounded-xl bg-brand hover:bg-brand-hover text-white font-extrabold shadow-md"
          >
            🖨️ 퇴직금 산정명세서 A4 미리보기 · 인쇄
          </button>
        </div>
      </div>

      {/* A4 퇴직금 산정명세서 인쇄 모달 */}
      {printOpen && (
        <div
          onClick={() => setPrintOpen(false)}
          className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs z-50 flex items-center justify-center p-4 print:static print:bg-white print:p-0"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden print:shadow-none print:border-none print:max-w-none"
          >
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between print:hidden">
              <span className="text-sm font-extrabold">
                퇴직금 산정명세서 ({targetName})
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
                  onClick={() => setPrintOpen(false)}
                  className="px-2.5 py-1 rounded-lg hover:bg-white/10 text-sm font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-8 space-y-5 text-slate-900 text-xs">
              <div className="text-center border-b-2 border-slate-900 pb-4">
                <div className="text-xs font-bold text-slate-500">{companyName}</div>
                <h2 className="text-xl font-black mt-1">퇴 직 금 산 정 명 세 서</h2>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500">성명 / 소속:</span>{" "}
                  <strong className="ml-1">
                    {targetName} ({targetDept})
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">입사일 ~ 퇴직일:</span>{" "}
                  <strong className="ml-1">
                    {hireDate} ~ {resignDate}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">재직일수:</span>{" "}
                  <strong className="ml-1">{result.tenureText}</strong>
                </div>
                <div>
                  <span className="text-slate-500">법정 적용 1일 임금:</span>{" "}
                  <strong className="ml-1">
                    {result.appliedDailyWage.toLocaleString()}원 (
                    {result.ordinaryWageApplied ? "통상임금 적용" : "평균임금 적용"})
                  </strong>
                </div>
              </div>

              <table className="w-full border-collapse border border-slate-300 text-xs">
                <thead className="bg-slate-100 font-extrabold">
                  <tr>
                    <th className="border border-slate-300 py-2 px-3 text-left">
                      산정 구간
                    </th>
                    <th className="border border-slate-300 py-2 px-3 text-right">
                      일수
                    </th>
                    <th className="border border-slate-300 py-2 px-3 text-right">
                      기본급·고정수당
                    </th>
                    <th className="border border-slate-300 py-2 px-3 text-right">
                      연장·변동수당
                    </th>
                    <th className="border border-slate-300 py-2 px-3 text-right">
                      소계
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {slices.map((s, i) => (
                    <tr key={i}>
                      <td className="border border-slate-300 py-2 px-3">
                        {s.startDate} ~ {s.endDate}
                      </td>
                      <td className="border border-slate-300 py-2 px-3 text-right">
                        {s.calendarDays}일
                      </td>
                      <td className="border border-slate-300 py-2 px-3 text-right">
                        {s.baseAndFixedPay.toLocaleString()}원
                      </td>
                      <td className="border border-slate-300 py-2 px-3 text-right">
                        {s.variableOvertimePay.toLocaleString()}원
                      </td>
                      <td className="border border-slate-300 py-2 px-3 text-right font-bold">
                        {(s.baseAndFixedPay + s.variableOvertimePay).toLocaleString()}원
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold">
                    <td className="border border-slate-300 py-2 px-3" colSpan={4}>
                      상여금 3/12 가산액 ({result.bonusThreeMonthPortion.toLocaleString()}원) + 연차수당 3/12 가산액 ({result.annualLeaveThreeMonthPortion.toLocaleString()}원) 포함 총액
                    </td>
                    <td className="border border-slate-300 py-2 px-3 text-right">
                      {result.totalThreeMonthBase.toLocaleString()}원
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="p-4 rounded-xl bg-slate-900 text-white space-y-2">
                <div className="flex justify-between">
                  <span>세전 퇴직급여 ({result.appliedDailyWage.toLocaleString()}원 × 30일 × {result.tenureDays}/365)</span>
                  <span className="font-extrabold">
                    {result.grossSeverance.toLocaleString()}원
                  </span>
                </div>
                <div className="flex justify-between text-rose-300">
                  <span>예상 퇴직소득세 ({result.estimatedIncomeTax.toLocaleString()}원) + 지방소득세 ({result.estimatedLocalTax.toLocaleString()}원)</span>
                  <span>
                    -{(result.estimatedIncomeTax + result.estimatedLocalTax).toLocaleString()}원
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-700 flex justify-between items-center text-base font-black">
                  <span>예상 차인 지급액 (IRP 계좌 입금 시 세전 전액 이전)</span>
                  <span>{result.netSeverance.toLocaleString()}원</span>
                </div>
              </div>

              <div className="text-center text-slate-500 pt-2">
                발행일: {todayStr} · {companyName}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
