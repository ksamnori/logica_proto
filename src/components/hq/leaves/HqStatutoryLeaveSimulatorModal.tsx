// src/components/hq/leaves/HqStatutoryLeaveSimulatorModal.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { simulateStatutoryAnnualLeave } from "@/lib/hq/leaveBalanceEngine";
import type { HqMember } from "@/lib/hq/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  members: HqMember[];
}

export default function HqStatutoryLeaveSimulatorModal({
  isOpen,
  onClose,
  members,
}: Props) {
  const todayYmd = useMemo(
    () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
    []
  );

  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [hireDate, setHireDate] = useState<string>("2026-05-06");
  const [asOfDate, setAsOfDate] = useState<string>(todayYmd);
  const [isRetiring, setIsRetiring] = useState<boolean>(false);
  const [weeklyHours, setWeeklyHours] = useState<string>("40");
  const [monthlyWage, setMonthlyWage] = useState<string>("3500000");
  const [usedDays, setUsedDays] = useState<string>("0");
  const [under80Attendance, setUnder80Attendance] = useState<boolean>(false);
  const [fullAttendedMonths, setFullAttendedMonths] = useState<string>("8");

  useEffect(() => {
    if (!isOpen) return;
    setAsOfDate(todayYmd);
  }, [isOpen, todayYmd]);

  const handleSelectMember = (memberId: string) => {
    setSelectedMemberId(memberId);
    if (!memberId) return;
    const m = members.find((x) => x.instructor_id === memberId);
    if (!m) return;
    if (m.hire_date) setHireDate(m.hire_date.slice(0, 10));
    if (m.resign_date) {
      setAsOfDate(m.resign_date.slice(0, 10));
      setIsRetiring(true);
    } else {
      setAsOfDate(todayYmd);
      setIsRetiring(false);
    }
    const hrs = Number(m.profile_extra?.weekly_work_hours ?? 40);
    setWeeklyHours(String(hrs));
    const wc = m.profile_extra?.wage_contract;
    if (wc?.monthly_base && wc.monthly_base > 0) {
      setMonthlyWage(String(Math.round(wc.monthly_base)));
    } else if (wc?.annual_salary && wc.annual_salary > 0) {
      setMonthlyWage(String(Math.round(wc.annual_salary / 12)));
    }
    setUsedDays(String(m.annual_leave_used ?? 0));
  };

  const sim = useMemo(
    () =>
      simulateStatutoryAnnualLeave({
        hireDate,
        asOfDate,
        isRetiringOnAsOfDate: isRetiring,
        weeklyWorkHours: Number(weeklyHours || 40),
        monthlyOrdinaryWage: Number(
          String(monthlyWage).replace(/[^0-9]/g, "") || 0
        ),
        totalUsedDays: Number(usedDays || 0),
        lastYearAttendanceUnder80: under80Attendance,
        lastYearFullAttendedMonths: Number(fullAttendedMonths || 0),
      }),
    [
      hireDate,
      asOfDate,
      isRetiring,
      weeklyHours,
      monthlyWage,
      usedDays,
      under80Attendance,
      fullAttendedMonths,
    ]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-[760px] max-h-[90vh] rounded-3xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden text-xs"
      >
        {/* 헤더 */}
        <div className="px-7 pt-6 pb-4 border-b border-slate-100 flex items-start justify-between shrink-0">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-extrabold mb-1.5">
              <span>⚖️ 근로기준법 제60조 ~ 제62조 기준</span>
            </div>
            <h3 className="text-[20px] font-extrabold text-slate-900 tracking-tight">
              법정 연차유급휴가 · 미사용 수당 · 퇴직 재정산 계산기
            </h3>
            <p className="text-slate-400 mt-0.5">
              입사일 기준 월차·가산연차, 회계연도 비례연차 비교 차액, 주 40시간(209h)·단시간 근로자 비례 수당 및 제61조 사용촉진 기한을 검증합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold flex items-center justify-center shrink-0"
          >
            ✕
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto custom-scroll px-7 py-5 space-y-5">
          {/* 구성원 불러오기 + 핵심 입력 폼 */}
          <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/80 space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  구성원 불러오기 (선택)
                </label>
                <select
                  value={selectedMemberId}
                  onChange={(e) => handleSelectMember(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold text-slate-800"
                >
                  <option value="">직접 입력 시뮬레이션</option>
                  {members.map((m) => (
                    <option key={m.instructor_id} value={m.instructor_id}>
                      {m.name} ({m.department} · 입사 {m.hire_date || "미등록"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  입사일 (법정 산정 기준일)
                </label>
                <input
                  type="date"
                  value={hireDate}
                  onChange={(e) => setHireDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  {isRetiring ? "마지막 근무일 (퇴직 전일)" : "산정 기준일 (오늘)"}
                </label>
                <input
                  type="date"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold text-slate-800"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  4주 평균 주 소정근로시간 (시간)
                </label>
                <input
                  type="number"
                  min={1}
                  max={52}
                  step={0.5}
                  value={weeklyHours}
                  onChange={(e) => setWeeklyHours(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  월 통상임금 (원 · 주 40h=209h 기준)
                </label>
                <input
                  value={
                    monthlyWage
                      ? Number(
                          monthlyWage.replace(/[^0-9]/g, "") || 0
                        ).toLocaleString()
                      : ""
                  }
                  onChange={(e) =>
                    setMonthlyWage(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder="예: 3,500,000"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold text-right text-slate-800"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  누적 사용 연차 (일)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={usedDays}
                  onChange={(e) => setUsedDays(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold text-right text-slate-800"
                />
              </div>
            </div>

            <div className="pt-1 flex flex-wrap items-center gap-5">
              <label className="inline-flex items-center gap-2 font-bold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isRetiring}
                  onChange={(e) => setIsRetiring(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#00a84b]"
                />
                <span>퇴직 정산 모드 (기준일 다음 날 미재직으로 판정)</span>
              </label>

              {sim.completedYears >= 1 && (
                <div className="inline-flex items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 font-bold text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={under80Attendance}
                      onChange={(e) => setUnder80Attendance(e.target.checked)}
                      className="w-4 h-4 rounded accent-amber-600"
                    />
                    <span>직전 1년 출근율 80% 미만</span>
                  </label>
                  {under80Attendance && (
                    <div className="inline-flex items-center gap-1">
                      <span className="text-slate-500">개근 월수:</span>
                      <input
                        type="number"
                        min={0}
                        max={11}
                        value={fullAttendedMonths}
                        onChange={(e) => setFullAttendedMonths(e.target.value)}
                        className="w-14 px-2 py-1 rounded-lg border border-slate-300 bg-white font-bold text-center"
                      />
                      <span className="text-slate-500">개월</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 적용 제외 안내 */}
          {!sim.isEligible ? (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 font-bold leading-relaxed">
              ⚠️ {sim.ineligibleReason}
            </div>
          ) : (
            <>
              {/* 핵심 결과 요약 4카드 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/50">
                  <div className="text-[11px] font-bold text-emerald-800">
                    입사일 기준 총 발생
                  </div>
                  <div className="mt-1 text-xl font-extrabold text-[#00a84b] tabular-nums">
                    {sim.hireBasisTotalDays}일
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    재직 {sim.tenureDays.toLocaleString()}일 (만{" "}
                    {sim.completedYears}년)
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-slate-200 bg-white">
                  <div className="text-[11px] font-bold text-slate-500">
                    회계연도(1.1) 기준 누적
                  </div>
                  <div className="mt-1 text-xl font-extrabold text-slate-800 tabular-nums">
                    {sim.fiscalBasisTotalDays}일
                  </div>
                  <div className="mt-0.5 text-[11px] font-semibold text-blue-600">
                    {sim.retirementExtraCompDays > 0
                      ? `퇴직 시 +${sim.retirementExtraCompDays}일 추가보상`
                      : "법정(입사일) 이상 유리"}
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-slate-200 bg-white">
                  <div className="text-[11px] font-bold text-slate-500">
                    미사용 잔여 연차
                  </div>
                  <div className="mt-1 text-xl font-extrabold text-slate-900 tabular-nums">
                    {sim.unusedDays}일
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {(sim.unusedDays * sim.dailyOrdinaryHours).toFixed(1)}시간
                    상당 (1일 {sim.dailyOrdinaryHours}h)
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-indigo-200 bg-indigo-50/40">
                  <div className="text-[11px] font-bold text-indigo-800">
                    미사용 연차수당 예상액
                  </div>
                  <div className="mt-1 text-lg font-extrabold text-indigo-700 tabular-nums">
                    {sim.estimatedAllowanceWon.toLocaleString()}원
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    1일 통상 {sim.dailyOrdinaryWage.toLocaleString()}원
                  </div>
                </div>
              </div>

              {/* 만 1년(365일) 퇴사 특례 경고 */}
              {sim.isExact365DayRetiree && (
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 font-bold leading-relaxed">
                  🚨 만 1년(365일) 근무 후 퇴사 판례 반영: 366일째 날에 재직 중이어야 15일 기본 연차가 발생하므로, 1년 미만 월차 최대 11일만 인정됩니다 (대법원 2021다227100).
                </div>
              )}

              {/* 발생 상세 로그 */}
              <div className="rounded-2xl border border-slate-200 p-4 space-y-2">
                <div className="font-extrabold text-slate-800">
                  📋 근속기간별 법정 발생 산출 내역 (근로기준법 제60조)
                </div>
                <ul className="space-y-1 text-slate-600 list-disc pl-4">
                  {sim.breakdownNotes.map((note, idx) => (
                    <li key={idx} className="font-medium">
                      {note}
                    </li>
                  ))}
                  {Number(weeklyHours) < 40 && (
                    <li className="text-blue-700 font-bold">
                      단시간 근로자 비례 산정 적용: 통상근로자(40h) 대비{" "}
                      {weeklyHours}h / 40h 비율 반영
                    </li>
                  )}
                </ul>
              </div>

              {/* 제61조 연차 사용촉진 법정 일정 */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-800">
                    📨 연차유급휴가 사용촉진 법정 기한 (근로기준법 제61조)
                  </span>
                  <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-bold text-slate-600">
                    {sim.promotionSchedule.kind === "UNDER_1Y"
                      ? "1년 미만 근로자 (최대 11일)"
                      : "1년 이상 근로자 (15~25일)"}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200/80">
                    <div className="text-slate-400 font-semibold">
                      휴가 청구권 소멸 기준일
                    </div>
                    <div className="font-bold text-slate-800 mt-0.5">
                      {sim.promotionSchedule.expireDate}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200/80">
                    <div className="text-slate-400 font-semibold">
                      1차 서면 촉구 기간
                    </div>
                    <div className="font-bold text-slate-800 mt-0.5">
                      {sim.promotionSchedule.firstNoticeWindow}
                    </div>
                  </div>
                  {sim.promotionSchedule.extraMonthlyNoticeWindow && (
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 sm:col-span-2">
                      <div className="text-slate-400 font-semibold">
                        이후 발생 2개월분 1차 촉구 기간
                      </div>
                      <div className="font-bold text-slate-800 mt-0.5">
                        {sim.promotionSchedule.extraMonthlyNoticeWindow}
                      </div>
                    </div>
                  )}
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 sm:col-span-2">
                    <div className="text-slate-400 font-semibold">
                      2차 사용 시기 지정 · 서면 통보 기한 (미통보 시)
                    </div>
                    <div className="font-bold text-emerald-700 mt-0.5">
                      {sim.promotionSchedule.secondDesignationDeadline}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  ※ 서면(수신·열람 입증된 전자문서 포함) 촉구 및 지정 휴가일 출근 시 명확한 <b>노무 수령 거부</b>까지 이행해야 미사용 연차수당 지급 의무가 면제됩니다. 퇴직자는 퇴직일로부터 <b>14일 이내</b> 정산해야 하며 소멸시효는 <b>3년</b>입니다.
                </p>
              </div>
            </>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-7 py-4 border-t border-slate-100 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
