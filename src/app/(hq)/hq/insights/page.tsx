// src/app/(hq)/hq/insights/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useHqShell } from "@/components/hq/HqShellContext";
import { hqFetch } from "@/lib/hq/clientApi";
import { ATTENDANCE_MODES, PUB_STAGES } from "@/lib/hq/constants";
import { useHqHref } from "@/lib/hq/hqRoutes";
import type { HqPublication, HqWorkMode } from "@/lib/hq/types";

type InsightTab = "ALL" | "PEOPLE" | "COST" | "PUBLISHING";

interface PayrollSummaryRow {
  pay_month: string;
  pay_type: "EMPLOYEE" | "FREELANCER_33" | "OTHER_88" | "ROYALTY";
  payee_name: string;
  department_or_role: string;
  book_or_project: string | null;
  gross_amount: number;
  net_amount: number;
  deduction_total: number;
  status: string;
}

interface ExpenseSummaryRow {
  expense_date: string;
  department: string;
  category: string;
  amount: number;
  settlement_status: string;
}

interface AttendanceSummaryRow {
  instructor_id: string;
  department: string;
  work_date: string;
  work_mode: HqWorkMode;
  status: string;
  worked_minutes: number;
  overtime_minutes: number;
}

function calcAgeFromRrnOrBirth(
  rrnFront?: string,
  rrnDigit?: string,
  birthDate?: string | null
): number | null {
  const nowYear = new Date().getFullYear();
  if (birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    const by = Number(birthDate.slice(0, 4));
    if (by > 1930 && by <= nowYear) return nowYear - by;
  }
  if (rrnFront && /^\d{6}$/.test(rrnFront)) {
    const yy = Number(rrnFront.slice(0, 2));
    const d = rrnDigit || "";
    const century = d === "3" || d === "4" || d === "7" || d === "8" ? 2000 : 1900;
    const fullYear = century + yy;
    if (fullYear > 1930 && fullYear <= nowYear) return nowYear - fullYear;
  }
  return null;
}

function formatManwon(won: number): string {
  if (won === 0) return "0원";
  if (Math.abs(won) >= 100_000_000) {
    return `${(won / 100_000_000).toFixed(1)}억원`;
  }
  if (Math.abs(won) >= 10_000) {
    return `${Math.round(won / 10_000).toLocaleString("ko-KR")}만원`;
  }
  return `${won.toLocaleString("ko-KR")}원`;
}

export default function HqInsightsPage() {
  const { members, canAccessMenu } = useHqShell();
  const hqHref = useHqHref();

  const [tab, setTab] = useState<InsightTab>("ALL");
  const [monthsRange, setMonthsRange] = useState<6 | 12>(6);
  const [deptFilter, setDeptFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);

  const [monthKeys, setMonthKeys] = useState<string[]>([]);
  const [payrollRows, setPayrollRows] = useState<PayrollSummaryRow[]>([]);
  const [expenseRows, setExpenseRows] = useState<ExpenseSummaryRow[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceSummaryRow[]>(
    []
  );
  const [publications, setPublications] = useState<HqPublication[]>([]);

  const loadInsights = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          monthKeys: string[];
          payrollRows: PayrollSummaryRow[];
          expenseRows: ExpenseSummaryRow[];
          attendanceRows: AttendanceSummaryRow[];
          publications: HqPublication[];
        };
      }>(`/api/hq/insights?months=${monthsRange}`);
      setMonthKeys(res.data?.monthKeys || []);
      setPayrollRows(res.data?.payrollRows || []);
      setExpenseRows(res.data?.expenseRows || []);
      setAttendanceRows(res.data?.attendanceRows || []);
      setPublications(res.data?.publications || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [monthsRange]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const departments = useMemo(
    () =>
      Array.from(
        new Set(
          members
            .filter((m) => m.work_status === "재직")
            .map((m) => m.department)
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, "ko")),
    [members]
  );

  // =========================================================================
  // 1. 인력 · 근태 · 연차 지표 집계
  // =========================================================================
  const peopleStats = useMemo(() => {
    const activeAll = members.filter((m) => m.work_status === "재직");
    const active =
      deptFilter === "ALL"
        ? activeAll
        : activeAll.filter((m) => m.department === deptFilter);

    const nowMs = Date.now();
    let tenureDaysSum = 0;
    let tenureCnt = 0;
    let ageSum = 0;
    let ageCnt = 0;
    let maleCnt = 0;
    let femaleCnt = 0;
    let regularCnt = 0;
    let leaveTotalSum = 0;
    let leaveUsedSum = 0;

    active.forEach((m) => {
      if (m.employment_type === "정규직" || m.employment_type === "임원") {
        regularCnt++;
      }
      if (m.hire_date && /^\d{4}-\d{2}-\d{2}$/.test(m.hire_date)) {
        const diff = Math.max(
          0,
          Math.floor((nowMs - new Date(m.hire_date).getTime()) / 86400000)
        );
        tenureDaysSum += diff;
        tenureCnt++;
      }
      const g = m.profile_extra?.gender;
      const d = m.profile_extra?.rrn_gender_digit;
      if (g === "남" || d === "1" || d === "3" || d === "5" || d === "7")
        maleCnt++;
      else if (g === "여" || d === "2" || d === "4" || d === "6" || d === "8")
        femaleCnt++;

      const age = calcAgeFromRrnOrBirth(
        m.profile_extra?.rrn_front,
        m.profile_extra?.rrn_gender_digit,
        m.birth_date
      );
      if (age !== null) {
        ageSum += age;
        ageCnt++;
      }

      leaveTotalSum += Math.max(0, Number(m.annual_leave_total || 0));
      leaveUsedSum += Math.max(0, Number(m.annual_leave_used || 0));
    });

    const avgTenureDays = tenureCnt > 0 ? Math.round(tenureDaysSum / tenureCnt) : 0;
    const avgTenureYears = Math.floor(avgTenureDays / 365);
    const avgTenureMonths = Math.floor((avgTenureDays % 365) / 30);
    const avgAge = ageCnt > 0 ? (ageSum / ageCnt).toFixed(1) : null;
    const leaveUsagePct =
      leaveTotalSum > 0 ? Math.round((leaveUsedSum / leaveTotalSum) * 1000) / 10 : 0;

    // 부서별 인원 및 연차 소진율
    const deptMap = new Map<
      string,
      { dept: string; headcount: number; leaveTotal: number; leaveUsed: number }
    >();
    activeAll.forEach((m) => {
      const k = m.department || "미지정";
      const cur = deptMap.get(k) || {
        dept: k,
        headcount: 0,
        leaveTotal: 0,
        leaveUsed: 0,
      };
      cur.headcount += 1;
      cur.leaveTotal += Math.max(0, Number(m.annual_leave_total || 0));
      cur.leaveUsed += Math.max(0, Number(m.annual_leave_used || 0));
      deptMap.set(k, cur);
    });
    const byDept = Array.from(deptMap.values()).sort(
      (a, b) => b.headcount - a.headcount
    );

    // 잔여연차 과다 / 미소진 구성원 Top 6
    const lowLeaveMembers = [...active]
      .filter((m) => Number(m.annual_leave_remain || 0) > 0)
      .sort((a, b) => Number(b.annual_leave_remain) - Number(a.annual_leave_remain))
      .slice(0, 6);

    // 근무 유형 비율 & 초과근무 집계
    const filteredAtt =
      deptFilter === "ALL"
        ? attendanceRows
        : attendanceRows.filter((a) => a.department === deptFilter);

    const modeCounts: Record<string, number> = {};
    let totalWorkedHours = 0;
    let totalOvertimeHours = 0;
    filteredAtt.forEach((a) => {
      const m = a.work_mode || "OFFICE";
      modeCounts[m] = (modeCounts[m] || 0) + 1;
      totalWorkedHours += Number(a.worked_minutes || 0) / 60;
      totalOvertimeHours += Number(a.overtime_minutes || 0) / 60;
    });

    const totalAttLogs = filteredAtt.length || 1;
    const workModeBreakdown = Object.entries(modeCounts)
      .map(([mode, count]) => ({
        mode: mode as HqWorkMode,
        label: ATTENDANCE_MODES[mode as HqWorkMode]?.shortLabel || mode,
        icon: ATTENDANCE_MODES[mode as HqWorkMode]?.icon || "🏢",
        count,
        pct: Math.round((count / totalAttLogs) * 100),
      }))
      .sort((a, b) => b.count - a.count);

    return {
      headcount: active.length,
      regularPct:
        active.length > 0 ? Math.round((regularCnt / active.length) * 100) : 0,
      deptCount: departments.length,
      avgTenureText:
        tenureCnt > 0
          ? avgTenureYears > 0
            ? `${avgTenureYears}년 ${avgTenureMonths}개월`
            : `${avgTenureDays}일`
          : "-",
      avgAge,
      maleCnt,
      femaleCnt,
      leaveUsagePct,
      leaveTotalSum: Math.round(leaveTotalSum * 10) / 10,
      leaveUsedSum: Math.round(leaveUsedSum * 10) / 10,
      leaveRemainSum: Math.round(Math.max(0, leaveTotalSum - leaveUsedSum) * 10) / 10,
      totalWorkedHours: Math.round(totalWorkedHours),
      totalOvertimeHours: Math.round(totalOvertimeHours * 10) / 10,
      byDept,
      lowLeaveMembers,
      workModeBreakdown,
    };
  }, [members, deptFilter, departments.length, attendanceRows]);

  // =========================================================================
  // 2. 인건비 · 외주/인세 · 경비 흐름 집계
  // =========================================================================
  const costStats = useMemo(() => {
    const filteredPayroll =
      deptFilter === "ALL"
        ? payrollRows
        : payrollRows.filter((r) =>
            (r.department_or_role || "").includes(deptFilter)
          );
    const filteredExpenses =
      deptFilter === "ALL"
        ? expenseRows
        : expenseRows.filter((e) => e.department === deptFilter);

    const monthlySeries = monthKeys.map((ym) => {
      let empGross = 0;
      let outsGross = 0;
      let royaltyGross = 0;
      filteredPayroll
        .filter((r) => r.pay_month === ym)
        .forEach((r) => {
          if (r.pay_type === "EMPLOYEE") empGross += Number(r.gross_amount || 0);
          else if (r.pay_type === "ROYALTY")
            royaltyGross += Number(r.gross_amount || 0);
          else outsGross += Number(r.gross_amount || 0);
        });

      const expSum = filteredExpenses
        .filter((e) => (e.expense_date || "").startsWith(ym))
        .reduce((s, e) => s + Number(e.amount || 0), 0);

      return {
        ym,
        shortLabel: `${Number(ym.split("-")[1])}월`,
        empGross,
        outsGross,
        royaltyGross,
        expSum,
        totalOutflow: empGross + outsGross + royaltyGross + expSum,
      };
    });

    const maxMonthTotal = Math.max(
      1,
      ...monthlySeries.map((m) => m.empGross + m.outsGross + m.royaltyGross)
    );

    const sumEmp = monthlySeries.reduce((s, m) => s + m.empGross, 0);
    const sumOuts = monthlySeries.reduce((s, m) => s + m.outsGross, 0);
    const sumRoyalty = monthlySeries.reduce((s, m) => s + m.royaltyGross, 0);
    const sumExpense = monthlySeries.reduce((s, m) => s + m.expSum, 0);

    // 경비 카테고리별 비중
    const catMap = new Map<string, { category: string; amount: number; count: number }>();
    filteredExpenses.forEach((e) => {
      const cat = e.category || "기타";
      const cur = catMap.get(cat) || { category: cat, amount: 0, count: 0 };
      cur.amount += Number(e.amount || 0);
      cur.count += 1;
      catMap.set(cat, cur);
    });
    const expenseByCategory = Array.from(catMap.values()).sort(
      (a, b) => b.amount - a.amount
    );

    // 도서·프로젝트별 외주 + 인세 투입 상위
    const bookCostMap = new Map<
      string,
      { book: string; outs: number; royalty: number; total: number }
    >();
    filteredPayroll
      .filter((r) => r.pay_type !== "EMPLOYEE" && r.book_or_project)
      .forEach((r) => {
        const b = r.book_or_project!.trim();
        const cur = bookCostMap.get(b) || {
          book: b,
          outs: 0,
          royalty: 0,
          total: 0,
        };
        const amt = Number(r.gross_amount || 0);
        if (r.pay_type === "ROYALTY") cur.royalty += amt;
        else cur.outs += amt;
        cur.total += amt;
        bookCostMap.set(b, cur);
      });
    const topBookCosts = Array.from(bookCostMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);

    return {
      monthlySeries,
      maxMonthTotal,
      sumEmp,
      sumOuts,
      sumRoyalty,
      sumExpense,
      expenseByCategory,
      topBookCosts,
    };
  }, [payrollRows, expenseRows, deptFilter, monthKeys]);

  // =========================================================================
  // 3. 출판 공정 파이프라인 집계
  // =========================================================================
  const pubStats = useMemo(() => {
    const stageCounts = PUB_STAGES.map((st) => {
      const list = publications.filter((b) => b.stage === st.code);
      return {
        ...st,
        count: list.length,
      };
    });

    const inProgressBooks = publications.filter((b) => b.stage !== "PUBLISHED");
    const publishedBooks = publications.filter((b) => b.stage === "PUBLISHED");
    const avgProgress =
      inProgressBooks.length > 0
        ? Math.round(
            inProgressBooks.reduce((s, b) => s + Number(b.progress_pct || 0), 0) /
              inProgressBooks.length
          )
        : 0;

    const todayYmd = new Date(Date.now() + 9 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const upcomingDeadlines = inProgressBooks
      .filter((b) => Boolean(b.press_deadline))
      .sort((a, b) =>
        (a.press_deadline || "").localeCompare(b.press_deadline || "")
      )
      .slice(0, 5)
      .map((b) => {
        const dday = Math.ceil(
          (new Date(`${b.press_deadline}T00:00:00`).getTime() -
            new Date(`${todayYmd}T00:00:00`).getTime()) /
            86400000
        );
        return { ...b, dday };
      });

    return {
      totalBooks: publications.length,
      inProgressCount: inProgressBooks.length,
      publishedCount: publishedBooks.length,
      avgProgress,
      stageCounts,
      upcomingDeadlines,
    };
  }, [publications]);

  return (
    <div className="w-full px-6 py-6 space-y-6">
      {/* 상단 탭 & 조직·기간 필터 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["ALL", "📊 종합 브리핑"],
              ["PEOPLE", "👥 인력 · 근태 · 연차"],
              ["COST", "💰 인건비 · 인세 · 경비"],
              ["PUBLISHING", "📚 출판 공정 · 도서 원가"],
            ] as [InsightTab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all ${
                tab === k
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
          >
            <option value="ALL">전체 조직 ({members.filter((m) => m.work_status === "재직").length}명)</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-xl bg-white border border-slate-200 p-0.5">
            {([6, 12] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonthsRange(m)}
                className={`px-3 py-1.5 rounded-lg font-bold ${
                  monthsRange === m
                    ? "bg-brand text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                최근 {m}개월
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div className="py-12 text-center text-xs text-slate-400">
          실시간 본부 인사이트 지표를 집계하는 중입니다...
        </div>
      )}

      {!loading && (
        <>
          {/* =============================================================== */}
          {/* 1. 인력 · 근태 · 연차 인사이트                                  */}
          {/* =============================================================== */}
          {(tab === "ALL" || tab === "PEOPLE") && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    👥 인력 구성 · 유연근무 · 연차 소진율
                  </h3>
                  <p className="text-xs text-slate-500">
                    재직 인원 구조와 부서별 연차 소진 현황을 실시간으로 진단합니다.
                  </p>
                </div>
                {canAccessMenu("/hq/leave-management") && (
                  <Link
                    href={hqHref("/hq/leave-management")}
                    className="text-xs font-bold text-brand hover:underline"
                  >
                    휴가 관리 바로가기 →
                  </Link>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                  <div className="text-xs font-bold text-slate-500">
                    재직 구성원 수
                  </div>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {peopleStats.headcount}명
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    정규직·임원 비중 {peopleStats.regularPct}% · 총{" "}
                    {peopleStats.deptCount}개 조직
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                  <div className="text-xs font-bold text-slate-500">
                    평균 근속 기간 · 연령
                  </div>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {peopleStats.avgTenureText}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {peopleStats.avgAge
                      ? `평균 만 ${peopleStats.avgAge}세`
                      : "생년 미기재"}{" "}
                    · 남 {peopleStats.maleCnt}명 / 여 {peopleStats.femaleCnt}명
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                  <div className="text-xs font-bold text-slate-500">
                    평균 연차 소진율
                  </div>
                  <div className="text-2xl font-black text-brand mt-1">
                    {peopleStats.leaveUsagePct}%
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    부여 {peopleStats.leaveTotalSum}일 중{" "}
                    {peopleStats.leaveUsedSum}일 사용 (잔여{" "}
                    {peopleStats.leaveRemainSum}일)
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                  <div className="text-xs font-bold text-slate-500">
                    누적 기록 근무 · 초과근무 ({monthsRange}개월)
                  </div>
                  <div className="text-2xl font-black text-emerald-700 mt-1">
                    {peopleStats.totalWorkedHours.toLocaleString()}h
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    연장·초과근무 총 {peopleStats.totalOvertimeHours}시간 기록
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
                {/* 부서별 인원 & 연차 소진율 */}
                <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-3">
                  <div className="font-extrabold text-slate-900 text-sm">
                    조직별 인원 및 연차 소진율 비교
                  </div>
                  <div className="space-y-3">
                    {peopleStats.byDept.map((d) => {
                      const pct =
                        d.leaveTotal > 0
                          ? Math.min(
                              100,
                              Math.round((d.leaveUsed / d.leaveTotal) * 100)
                            )
                          : 0;
                      return (
                        <div key={d.dept} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-800">
                              {d.dept}{" "}
                              <span className="text-slate-400 font-semibold">
                                ({d.headcount}명)
                              </span>
                            </span>
                            <span className="font-extrabold text-brand tabular-nums">
                              소진율 {pct}%
                            </span>
                          </div>
                          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              style={{ width: `${pct}%` }}
                              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 근무 형태 활용 비중 */}
                <div className="lg:col-span-3 rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-3">
                  <div className="font-extrabold text-slate-900 text-sm">
                    유연근무 · 출근 형태 비중
                  </div>
                  {peopleStats.workModeBreakdown.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">
                      출퇴근 기록 데이터가 아직 없습니다.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {peopleStats.workModeBreakdown.map((w) => (
                        <div
                          key={w.mode}
                          className="p-2.5 rounded-xl bg-slate-50 flex items-center justify-between"
                        >
                          <span className="font-bold text-slate-700">
                            {w.icon} {w.label}
                          </span>
                          <span className="font-extrabold text-slate-900">
                            {w.pct}% ({w.count}건)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 잔여연차 상위 구성원 */}
                <div className="lg:col-span-4 rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-3">
                  <div className="font-extrabold text-slate-900 text-sm">
                    잔여연차 상위 구성원 (촉진 참고)
                  </div>
                  {peopleStats.lowLeaveMembers.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">
                      미사용 잔여연차 대상이 없습니다.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {peopleStats.lowLeaveMembers.map((m) => (
                        <div
                          key={m.instructor_id}
                          className="py-2 flex items-center justify-between"
                        >
                          <div>
                            <span className="font-extrabold text-slate-800">
                              {m.name}
                            </span>{" "}
                            <span className="text-slate-400">
                              ({m.department})
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 font-extrabold">
                              잔여 {m.annual_leave_remain}일
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* =============================================================== */}
          {/* 2. 인건비 · 인세 · 경비 흐름                                    */}
          {/* =============================================================== */}
          {(tab === "ALL" || tab === "COST") && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    💰 월별 인건비 · 외주(3.3%/8.8%) · 저자 인세 · 경비 추이
                  </h3>
                  <p className="text-xs text-slate-500">
                    급여대장·원천징수·지출결의 실데이터를 결합해 연구소 자금 집행 흐름을 보여줍니다.
                  </p>
                </div>
                {canAccessMenu("/hq/payroll") && (
                  <Link
                    href={hqHref("/hq/payroll")}
                    className="text-xs font-bold text-brand hover:underline"
                  >
                    급여 · 인세 대장 →
                  </Link>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                  <div className="text-xs font-bold text-slate-500">
                    임직원 급여 누계 ({monthsRange}개월 세전)
                  </div>
                  <div className="text-2xl font-black text-blue-700 mt-1 tabular-nums">
                    {formatManwon(costStats.sumEmp)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {costStats.sumEmp.toLocaleString("ko-KR")}원
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                  <div className="text-xs font-bold text-slate-500">
                    외주 용역 · 원고검토비 (3.3% / 8.8%)
                  </div>
                  <div className="text-2xl font-black text-amber-600 mt-1 tabular-nums">
                    {formatManwon(costStats.sumOuts)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {costStats.sumOuts.toLocaleString("ko-KR")}원
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                  <div className="text-xs font-bold text-slate-500">
                    저자 인세 정산 누계
                  </div>
                  <div className="text-2xl font-black text-emerald-700 mt-1 tabular-nums">
                    {formatManwon(costStats.sumRoyalty)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {costStats.sumRoyalty.toLocaleString("ko-KR")}원
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
                  <div className="text-xs font-bold text-slate-500">
                    운영 · 제작 경비 지출 ({monthsRange}개월)
                  </div>
                  <div className="text-2xl font-black text-slate-900 mt-1 tabular-nums">
                    {formatManwon(costStats.sumExpense)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {costStats.sumExpense.toLocaleString("ko-KR")}원
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
                {/* 월별 누적 막대 차트 */}
                <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-extrabold text-slate-900 text-sm">
                      월별 급여 · 외주 · 인세 지급 추이
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-bold">
                      <span className="flex items-center gap-1 text-blue-700">
                        <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" />
                        임직원 급여
                      </span>
                      <span className="flex items-center gap-1 text-amber-700">
                        <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
                        외주(3.3·8.8%)
                      </span>
                      <span className="flex items-center gap-1 text-emerald-700">
                        <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
                        저자 인세
                      </span>
                    </div>
                  </div>

                  <div className="h-52 flex items-end gap-3 pt-6 px-2 border-b border-slate-200">
                    {costStats.monthlySeries.map((m) => {
                      const sumPay = m.empGross + m.outsGross + m.royaltyGross;
                      const empH = Math.round(
                        (m.empGross / costStats.maxMonthTotal) * 150
                      );
                      const outsH = Math.round(
                        (m.outsGross / costStats.maxMonthTotal) * 150
                      );
                      const royH = Math.round(
                        (m.royaltyGross / costStats.maxMonthTotal) * 150
                      );
                      return (
                        <div
                          key={m.ym}
                          className="flex-1 flex flex-col items-center justify-end gap-1.5 group"
                        >
                          <div className="text-[10px] font-bold text-slate-500 tabular-nums">
                            {sumPay > 0 ? formatManwon(sumPay) : "-"}
                          </div>
                          <div className="w-full max-w-[44px] flex flex-col-reverse rounded-t-lg overflow-hidden bg-slate-100">
                            {empH > 0 && (
                              <div
                                style={{ height: `${Math.max(4, empH)}px` }}
                                title={`임직원 급여: ${m.empGross.toLocaleString()}원`}
                                className="bg-blue-600 w-full transition-all"
                              />
                            )}
                            {outsH > 0 && (
                              <div
                                style={{ height: `${Math.max(4, outsH)}px` }}
                                title={`외주 용역: ${m.outsGross.toLocaleString()}원`}
                                className="bg-amber-500 w-full transition-all"
                              />
                            )}
                            {royH > 0 && (
                              <div
                                style={{ height: `${Math.max(4, royH)}px` }}
                                title={`저자 인세: ${m.royaltyGross.toLocaleString()}원`}
                                className="bg-emerald-500 w-full transition-all"
                              />
                            )}
                            {sumPay === 0 && <div className="h-1 bg-slate-200" />}
                          </div>
                          <div className="text-[11px] font-extrabold text-slate-700 pb-2">
                            {m.shortLabel}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 카테고리별 경비 비중 */}
                <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-3">
                  <div className="font-extrabold text-slate-900 text-sm">
                    항목별 운영·제작 경비 비중
                  </div>
                  {costStats.expenseByCategory.length === 0 ? (
                    <div className="py-12 text-center text-slate-400">
                      조회 기간 내 정산된 경비 내역이 없습니다.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {costStats.expenseByCategory.slice(0, 6).map((c) => {
                        const pct =
                          costStats.sumExpense > 0
                            ? Math.round((c.amount / costStats.sumExpense) * 100)
                            : 0;
                        return (
                          <div key={c.category} className="space-y-1">
                            <div className="flex justify-between">
                              <span className="font-bold text-slate-800">
                                {c.category}{" "}
                                <span className="text-slate-400">
                                  ({c.count}건)
                                </span>
                              </span>
                              <span className="font-extrabold text-slate-900 tabular-nums">
                                {c.amount.toLocaleString()}원 ({pct}%)
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                style={{ width: `${Math.max(3, pct)}%` }}
                                className="h-full rounded-full bg-slate-800"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* =============================================================== */}
          {/* 3. 출판 공정 · 도서별 외주/인세 원가 요약                       */}
          {/* =============================================================== */}
          {(tab === "ALL" || tab === "PUBLISHING") && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    📚 출판 파이프라인 현황 · 도서별 외주/인세 집행
                  </h3>
                  <p className="text-xs text-slate-500">
                    총 {pubStats.totalBooks}종 등록 (제작 진행중{" "}
                    {pubStats.inProgressCount}종 · 평균 공정률{" "}
                    {pubStats.avgProgress}% · 출간 완료 {pubStats.publishedCount}종)
                  </p>
                </div>
                {canAccessMenu("/hq/publishing") && (
                  <Link
                    href={hqHref("/hq/publishing")}
                    className="text-xs font-bold text-brand hover:underline"
                  >
                    출판 공정 보드 →
                  </Link>
                )}
              </div>

              {/* 7단계 파이프라인 카드 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
                {pubStats.stageCounts.map((st) => (
                  <div
                    key={st.code}
                    className={`rounded-2xl bg-white border border-slate-200 border-t-4 ${st.headerClass} p-4 shadow-2xs`}
                  >
                    <div className="text-[11px] font-bold text-slate-500 truncate">
                      {st.shortLabel}
                    </div>
                    <div className="text-2xl font-black text-slate-900 mt-1">
                      {st.count}
                      <span className="text-xs font-bold text-slate-400 ml-0.5">
                        종
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                {/* 하판 마감 임박 도서 */}
                <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-3">
                  <div className="font-extrabold text-slate-900 text-sm">
                    🖨️ 인쇄 하판 마감 일정 브리핑
                  </div>
                  {pubStats.upcomingDeadlines.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">
                      하판 마감일이 지정된 진행 도서가 없습니다.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {pubStats.upcomingDeadlines.map((b) => (
                        <div
                          key={b.pub_id}
                          className="py-2.5 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-extrabold text-slate-900 truncate">
                              {b.title}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              담당 {b.editor_name || "미지정"} · 공정률{" "}
                              {b.progress_pct}% · 하판 {b.press_deadline}
                            </div>
                          </div>
                          <span
                            className={`px-2.5 py-1 rounded-lg font-extrabold shrink-0 ${
                              b.dday <= 7
                                ? "bg-rose-50 text-rose-700"
                                : "bg-blue-50 text-blue-700"
                            }`}
                          >
                            {b.dday === 0
                              ? "D-Day"
                              : b.dday > 0
                              ? `D-${b.dday}`
                              : `D+${Math.abs(b.dday)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 도서별 누적 외주·인세 정산액 */}
                <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs space-y-3">
                  <div className="font-extrabold text-slate-900 text-sm">
                    📖 도서 · 프로젝트별 외주비 · 인세 투입 상위
                  </div>
                  {costStats.topBookCosts.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">
                      급여·인세 정산 시 [대상 도서명]을 기재하면 도서별 외주·인세 원가가 자동 집계됩니다.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {costStats.topBookCosts.map((bc) => (
                        <div
                          key={bc.book}
                          className="py-2.5 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-extrabold text-slate-900 truncate">
                              {bc.book}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              외주 {bc.outs.toLocaleString()}원 · 인세{" "}
                              {bc.royalty.toLocaleString()}원
                            </div>
                          </div>
                          <span className="font-black text-emerald-700 tabular-nums shrink-0">
                            {bc.total.toLocaleString("ko-KR")}원
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
