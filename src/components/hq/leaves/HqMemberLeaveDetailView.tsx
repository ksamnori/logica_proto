// src/components/hq/leaves/HqMemberLeaveDetailView.tsx
"use client";

import React, { useMemo, useState } from "react";
import { hqFetch } from "@/lib/hq/clientApi";
import { computeMemberAnnualLeaveLedgerForYear } from "@/lib/hq/leaveBalanceEngine";
import type {
  HqAnnualLeavePolicyItem,
  HqApprovalDoc,
  HqCustomLeaveGrantItem,
  HqCustomLeaveItem,
  HqHolidayItem,
  HqLeaveAdjustmentItem,
  HqMember,
  HqUploadedMonthlyUsageItem,
} from "@/lib/hq/types";

interface Props {
  member: HqMember;
  canManage: boolean;
  annualPolicy: HqAnnualLeavePolicyItem;
  customLeaves: HqCustomLeaveItem[];
  holidaysByYear: Record<string, HqHolidayItem[]>;
  leaveDocs: HqApprovalDoc[];
  adjustments: HqLeaveAdjustmentItem[];
  customGrants: HqCustomLeaveGrantItem[];
  uploadedMonthly: HqUploadedMonthlyUsageItem[];
  onBack: () => void;
  onOpenGrantModalForMember: (memberId: string, leaveId?: string) => void;
  onOpenAdjustModalForMember: (memberId: string, defaultYm?: string) => void;
  onMutated: () => Promise<void>;
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

const MALE_AND_COMMON_ORDER = [
  "cl-spouse-miscarriage",
  "cl-military",
  "cl-paternity",
  "cl-condolence-1",
  "cl-condolence-2",
  "cl-marriage",
  "cl-emergency",
];

const FEMALE_AND_COMMON_ORDER = [
  "cl-premature",
  "cl-menstrual",
  "cl-maternity",
  "cl-maternity-multi",
  "cl-condolence-1",
  "cl-condolence-2",
  "cl-marriage",
  "cl-emergency",
];

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildCalendarCells(year: number, month1Based: number) {
  const first = new Date(year, month1Based - 1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month1Based, 0).getDate();
  const prevMonthDays = new Date(year, month1Based - 1, 0).getDate();

  const cells: { ymd: string; day: number; inMonth: boolean; dow: number }[] =
    [];
  for (let i = startDow - 1; i >= 0; i -= 1) {
    const d = prevMonthDays - i;
    const dt = new Date(year, month1Based - 2, d);
    cells.push({ ymd: toYmd(dt), day: d, inMonth: false, dow: dt.getDay() });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    const dt = new Date(year, month1Based - 1, d);
    cells.push({ ymd: toYmd(dt), day: d, inMonth: true, dow: dt.getDay() });
  }
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    const dt = new Date(year, month1Based, nextDay);
    cells.push({
      ymd: toYmd(dt),
      day: nextDay,
      inMonth: false,
      dow: dt.getDay(),
    });
    nextDay += 1;
  }
  return cells;
}

function formatDateRangeKo(start?: string | null, end?: string | null): string {
  if (!start) return "-";
  const parse = (ymd: string) => {
    const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
    const dt = new Date(y || 2026, (m || 1) - 1, d || 1);
    return { y, m, d, dow: WEEKDAY_KO[dt.getDay()] };
  };
  const s = parse(start);
  if (!end || end === start) {
    return `${s.y}. ${s.m}. ${s.d} (${s.dow})`;
  }
  const e = parse(end);
  if (s.y === e.y) {
    return `${s.y}. ${s.m}. ${s.d} (${s.dow}) – ${e.m}. ${e.d} (${e.dow})`;
  }
  return `${s.y}. ${s.m}. ${s.d} (${s.dow}) – ${e.y}. ${e.m}. ${e.d} (${e.dow})`;
}

// 플렉스 스타일 일·시간 환산 배지 (예: 0.5 -> 4시간, 0.25 -> 2시간, 1.25 -> 1일 2시간, 1 -> 1일)
function formatLeaveDaysAsDurationBadge(days: number): string {
  const whole = Math.floor(days + 1e-6);
  const remHours = Math.round((days - whole) * 8);
  if (whole === 0 && remHours > 0) return `${remHours}시간`;
  if (whole > 0 && remHours > 0) return `${whole}일 ${remHours}시간`;
  return `${days}일`;
}

export default function HqMemberLeaveDetailView({
  member,
  canManage,
  annualPolicy,
  customLeaves,
  holidaysByYear,
  leaveDocs,
  adjustments,
  customGrants,
  uploadedMonthly,
  onBack,
  onOpenGrantModalForMember,
  onOpenAdjustModalForMember,
  onMutated,
}: Props) {
  const now = useMemo(() => new Date(), []);
  const todayYmd = useMemo(() => toYmd(new Date()), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [subTab, setSubTab] = useState<"OVERVIEW" | "DETAIL">("OVERVIEW");
  const [historyYear, setHistoryYear] = useState(currentYear);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [detailYear, setDetailYear] = useState(currentYear);
  const [expandedMonths, setExpandedMonths] = useState<Record<number, boolean>>(
    {}
  );
  const [menuDocId, setMenuDocId] = useState<string | null>(null);

  // 2개월 달력 휴가 등록 모달 (Screenshot 5)
  const [calModalOpen, setCalModalOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<
    { kind: "ANNUAL" } | { kind: "CUSTOM"; item: HqCustomLeaveItem }
  >({ kind: "ANNUAL" });
  const [calBaseYm, setCalBaseYm] = useState({
    year: currentYear,
    month: currentMonth,
  });
  const [pickStart, setPickStart] = useState("");
  const [pickEnd, setPickEnd] = useState("");
  const [unitMode, setUnitMode] = useState<
    "FULL" | "AM_HALF" | "PM_HALF" | "TWO_HOURS"
  >("FULL");
  const [reason, setReason] = useState("");
  const [savingReg, setSavingReg] = useState(false);

  const memberGender = member.profile_extra?.gender || "";

  const memberLeaveDocs = useMemo(
    () => leaveDocs.filter((d) => d.drafter_id === member.instructor_id),
    [leaveDocs, member.instructor_id]
  );

  // 올해 및 선택 연도 연차 원장 계산
  const currentYearSummary = useMemo(
    () =>
      computeMemberAnnualLeaveLedgerForYear({
        memberId: member.instructor_id,
        hireDate: member.hire_date,
        groupHireDate: member.profile_extra?.group_hire_date || null,
        year: currentYear,
        currentYear,
        currentMonth,
        policy: annualPolicy,
        leaveDocs,
        adjustments,
        uploadedMonthly,
      }),
    [
      member,
      currentYear,
      currentMonth,
      annualPolicy,
      leaveDocs,
      adjustments,
      uploadedMonthly,
    ]
  );

  const detailLedger = useMemo(
    () =>
      computeMemberAnnualLeaveLedgerForYear({
        memberId: member.instructor_id,
        hireDate: member.hire_date,
        groupHireDate: member.profile_extra?.group_hire_date || null,
        year: detailYear,
        currentYear,
        currentMonth,
        policy: annualPolicy,
        leaveDocs,
        adjustments,
        uploadedMonthly,
      }),
    [
      member,
      detailYear,
      currentYear,
      currentMonth,
      annualPolicy,
      leaveDocs,
      adjustments,
      uploadedMonthly,
    ]
  );

  // 공휴일 Set
  const holidaySet = useMemo(() => {
    const set = new Set<string>();
    Object.values(holidaysByYear || {}).forEach((arr) => {
      (arr || []).forEach((h) => {
        if (!h.start_date) return;
        const end = h.end_date || h.start_date;
        const sDt = new Date(`${h.start_date}T00:00:00`);
        const eDt = new Date(`${end}T00:00:00`);
        const cur = new Date(sDt);
        let guard = 0;
        while (cur <= eDt && guard < 30) {
          set.add(toYmd(cur));
          cur.setDate(cur.getDate() + 1);
          guard += 1;
        }
      });
    });
    return set;
  }, [holidaysByYear]);

  // 해당 구성원의 성별 및 직접부여 내역에 맞는 맞춤 휴가 카드 목록 (Screenshots 4 & 7)
  const visibleCustomCards = useMemo(() => {
    const getRemainGranted = (c: HqCustomLeaveItem) => {
      const granted = customGrants
        .filter((g) => g.member_id === member.instructor_id && g.leave_id === c.id)
        .reduce((acc, g) => acc + Number(g.granted_amount || 0), 0);
      const used = memberLeaveDocs
        .filter((d) => d.status === "APPROVED" && d.leave_type === c.name)
        .reduce((acc, d) => acc + Number(d.leave_days || 0), 0);
      return Math.max(0, Math.round((granted - used) * 100) / 100);
    };

    const eligible = customLeaves.filter((c) => {
      if (c.target_gender === "여성" && memberGender !== "여") return false;
      if (c.target_gender === "남성" && memberGender !== "남") return false;
      if (
        c.grant_method === "관리자가 직접 부여" ||
        c.grant_method === "연차 소진 시 부여"
      ) {
        return getRemainGranted(c) > 0;
      }
      return true;
    });

    const preferredIds =
      memberGender === "여" ? FEMALE_AND_COMMON_ORDER : MALE_AND_COMMON_ORDER;

    const ordered: { item: HqCustomLeaveItem; remainGranted: number }[] = [];
    // 직접 부여되어 잔여분이 있는 항목 최상단 배치
    eligible.forEach((c) => {
      const rem = getRemainGranted(c);
      if (
        (c.grant_method === "관리자가 직접 부여" ||
          c.grant_method === "연차 소진 시 부여") &&
        rem > 0
      ) {
        ordered.push({ item: c, remainGranted: rem });
      }
    });

    preferredIds.forEach((id) => {
      const found = eligible.find((c) => c.id === id);
      if (found && !ordered.some((o) => o.item.id === found.id)) {
        ordered.push({ item: found, remainGranted: getRemainGranted(found) });
      }
    });

    eligible.forEach((c) => {
      if (!ordered.some((o) => o.item.id === c.id)) {
        ordered.push({ item: c, remainGranted: getRemainGranted(c) });
      }
    });

    return ordered;
  }, [customLeaves, memberGender, customGrants, member.instructor_id, memberLeaveDocs]);

  // 사용한 기록 (해당 연도 + 상태 필터 -> 예정된 휴가 / 지난 휴가 분리)
  const yearRecords = useMemo(() => {
    const filtered = memberLeaveDocs.filter((d) => {
      const yr = Number((d.effective_date || "").slice(0, 4));
      if (yr !== historyYear) return false;
      if (statusFilter === "ALL") {
        return d.status !== "CANCELLED" && d.status !== "REJECTED";
      }
      return d.status === statusFilter;
    });

    const upcoming = filtered
      .filter((d) => (d.effective_date || "") > todayYmd)
      .sort((a, b) =>
        String(b.effective_date || "").localeCompare(
          String(a.effective_date || "")
        )
      );

    const past = filtered
      .filter((d) => (d.effective_date || "") <= todayYmd)
      .sort((a, b) =>
        String(b.effective_date || "").localeCompare(
          String(a.effective_date || "")
        )
      );

    return { upcoming, past };
  }, [memberLeaveDocs, historyYear, statusFilter, todayYmd]);

  const openCalendarForCard = (
    card: { kind: "ANNUAL" } | { kind: "CUSTOM"; item: HqCustomLeaveItem }
  ) => {
    setSelectedCard(card);
    setCalBaseYm({ year: currentYear, month: currentMonth });
    setPickStart("");
    setPickEnd("");
    setUnitMode("FULL");
    setReason("");
    setCalModalOpen(true);
  };

  const nextMonthYm = useMemo(() => {
    if (calBaseYm.month === 12) return { year: calBaseYm.year + 1, month: 1 };
    return { year: calBaseYm.year, month: calBaseYm.month + 1 };
  }, [calBaseYm]);

  const handleDayClick = (ymd: string) => {
    if (!pickStart || (pickStart && pickEnd)) {
      setPickStart(ymd);
      setPickEnd("");
    } else if (ymd < pickStart) {
      setPickStart(ymd);
      setPickEnd("");
    } else {
      setPickEnd(ymd);
      if (ymd !== pickStart) setUnitMode("FULL");
    }
  };

  const calculatedDays = useMemo(() => {
    if (!pickStart) return 0;
    const end = pickEnd || pickStart;
    if (selectedCard.kind === "ANNUAL" && end === pickStart) {
      if (unitMode === "AM_HALF" || unitMode === "PM_HALF") return 0.5;
      if (unitMode === "TWO_HOURS") return 0.25;
    }
    const deductHol =
      selectedCard.kind === "CUSTOM"
        ? Boolean(selectedCard.item.deduct_on_holidays)
        : false;
    let cnt = 0;
    const cur = new Date(`${pickStart}T00:00:00`);
    const endDt = new Date(`${end}T00:00:00`);
    while (cur <= endDt) {
      const ymd = toYmd(cur);
      const dow = cur.getDay();
      if (deductHol || (dow !== 0 && dow !== 6 && !holidaySet.has(ymd))) {
        cnt += 1;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return Math.max(1, cnt);
  }, [pickStart, pickEnd, selectedCard, unitMode, holidaySet]);

  const handleSubmitAdminRegister = async () => {
    if (!pickStart) {
      alert("휴가 날짜를 선택해 주세요.");
      return;
    }
    const leaveLabel =
      selectedCard.kind === "ANNUAL"
        ? unitMode === "AM_HALF"
          ? "오전 반차"
          : unitMode === "PM_HALF"
            ? "오후 반차"
            : unitMode === "TWO_HOURS"
              ? "시간차 연차 (2시간)"
              : "연차"
        : selectedCard.item.name;

    setSavingReg(true);
    try {
      await hqFetch("/api/hq/leaves", {
        method: "POST",
        body: {
          action: "ADMIN_REGISTER_LEAVE",
          member_id: member.instructor_id,
          member_name: member.name,
          department: member.department,
          leave_type: leaveLabel,
          start_date: pickStart,
          end_date: pickEnd || pickStart,
          leave_days: calculatedDays,
          reason: reason.trim(),
        },
      });
      setCalModalOpen(false);
      await onMutated();
    } catch (e: any) {
      alert(e?.message || "휴가 등록 실패");
    } finally {
      setSavingReg(false);
    }
  };

  const handleCancelLeaveRecord = async (approvalId: string) => {
    setMenuDocId(null);
    if (!confirm("이 휴가 사용 기록을 취소 처리하시겠습니까?")) return;
    try {
      await hqFetch("/api/hq/leaves", {
        method: "POST",
        body: { action: "ADMIN_CANCEL_LEAVE_DOC", approval_id: approvalId },
      });
      await onMutated();
    } catch (e: any) {
      alert(e?.message || "취소 실패");
    }
  };

  const renderMonthCalendar = (yr: number, mo: number) => {
    const cells = buildCalendarCells(yr, mo);
    const effEnd = pickEnd || pickStart;
    return (
      <div className="space-y-3">
        <div className="text-center text-xs font-extrabold text-slate-800">
          {yr}년 {mo}월
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] font-bold text-slate-400">
          {WEEKDAY_KO.map((w) => (
            <span key={w} className="py-1">
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
          {cells.map((c, idx) => {
            const isSelected =
              pickStart && c.ymd >= pickStart && c.ymd <= effEnd;
            const isToday = c.ymd === todayYmd;
            const isWeekendOrHol =
              c.dow === 0 || c.dow === 6 || holidaySet.has(c.ymd);

            return (
              <button
                key={`${c.ymd}-${idx}`}
                type="button"
                disabled={!c.inMonth}
                onClick={() => handleDayClick(c.ymd)}
                className={`h-8 rounded-lg font-bold transition-colors ${
                  !c.inMonth
                    ? "text-slate-200 cursor-default"
                    : isSelected
                      ? "bg-[#00c458] text-white"
                      : isToday
                        ? "bg-emerald-50 text-[#00a84b]"
                        : isWeekendOrHol
                          ? "text-slate-300 hover:bg-slate-50"
                          : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {c.day}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      className="min-h-full bg-white flex flex-col"
      onClick={() => setMenuDocId(null)}
    >
      {/* 상단 헤더: < {이름} 님의 휴가 (Screenshots 4, 6, 7) */}
      <div className="px-9 pt-7 border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="w-8 h-8 rounded-xl hover:bg-slate-100 text-slate-600 flex items-center justify-center text-lg font-bold"
            title="휴가 관리 목록으로 돌아가기"
          >
            ‹
          </button>
          <h1 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            {member.name} 님의 휴가
          </h1>
          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-xs font-bold">
            {member.department}
            {memberGender ? ` · ${memberGender}성` : " · 성별 미등록"}
          </span>
        </div>

        <div className="mt-5 flex items-center gap-6">
          <button
            type="button"
            onClick={() => setSubTab("OVERVIEW")}
            className={`pb-3 text-[13px] font-extrabold border-b-2 transition-colors ${
              subTab === "OVERVIEW"
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-400 hover:text-slate-700"
            }`}
          >
            휴가 개요
          </button>
          <button
            type="button"
            onClick={() => setSubTab("DETAIL")}
            className={`pb-3 text-[13px] font-extrabold border-b-2 transition-colors ${
              subTab === "DETAIL"
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-400 hover:text-slate-700"
            }`}
          >
            연차 상세
          </button>
        </div>
      </div>

      {/* ================= 탭 1: 휴가 개요 (Screenshots 4, 5, 7) ================= */}
      {subTab === "OVERVIEW" && (
        <div className="px-9 py-8 max-w-[1280px] space-y-10">
          {/* 1) 휴가 등록 + 맞춤 휴가 부여 버튼 */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-slate-900">
                휴가 등록
              </h2>
              {canManage && (
                <button
                  type="button"
                  onClick={() => onOpenGrantModalForMember(member.instructor_id)}
                  className="px-3.5 py-2 rounded-xl bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-extrabold shadow-xs flex items-center gap-1.5"
                >
                  <span>맞춤 휴가 부여</span>
                  <span className="text-[10px] opacity-80">▾</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
              {/* 연차 카드 */}
              <button
                type="button"
                onClick={() => openCalendarForCard({ kind: "ANNUAL" })}
                className="p-5 rounded-2xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50/70 transition-all text-left flex flex-col justify-between min-h-[124px]"
              >
                <span className="text-xl opacity-75">🏖️</span>
                <div className="mt-4">
                  <div className="text-xs font-bold text-slate-600">연차</div>
                  <div className="text-[15px] font-extrabold text-slate-900 mt-0.5">
                    {currentYearSummary.availableRemainDays}일
                  </div>
                </div>
              </button>

              {/* 성별·부여내역 맞춤 휴가 카드들 */}
              {visibleCustomCards.map(({ item, remainGranted }) => {
                const subLabel =
                  remainGranted > 0
                    ? `${remainGranted}일 보유`
                    : item.grant_method === "반복 부여"
                      ? `매월 ${item.grant_amount}일 부여`
                      : item.id === "cl-military"
                        ? "신청 시 부여"
                        : `신청 시 ${item.grant_amount}일 부여`;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      openCalendarForCard({ kind: "CUSTOM", item })
                    }
                    className="p-5 rounded-2xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50/70 transition-all text-left flex flex-col justify-between min-h-[124px]"
                  >
                    <span className="text-xl opacity-75">{item.icon}</span>
                    <div className="mt-4">
                      <div className="text-xs font-bold text-slate-700 truncate">
                        {item.name}
                      </div>
                      <div
                        className={`text-[13px] mt-0.5 font-semibold ${
                          remainGranted > 0
                            ? "text-emerald-700 font-extrabold"
                            : "text-slate-400"
                        }`}
                      >
                        {subLabel}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2) 사용한 기록 (예정된 휴가 / 지난 휴가) */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-extrabold text-slate-900">
                사용한 기록
              </h2>

              <div className="flex items-center gap-2 text-xs">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-600"
                >
                  <option value="ALL">휴가 상태 전체</option>
                  <option value="APPROVED">승인완료</option>
                  <option value="PENDING">승인대기</option>
                  <option value="CANCELLED">취소</option>
                </select>

                <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setHistoryYear((y) => y - 1)}
                    className="px-1.5 text-slate-400 hover:text-slate-800 font-bold"
                  >
                    ‹
                  </button>
                  <span className="px-2 font-bold text-slate-800">
                    {historyYear}년
                  </span>
                  <button
                    type="button"
                    onClick={() => setHistoryYear((y) => y + 1)}
                    className="px-1.5 text-slate-400 hover:text-slate-800 font-bold"
                  >
                    ›
                  </button>
                </div>
              </div>
            </div>

            {yearRecords.upcoming.length === 0 &&
            yearRecords.past.length === 0 ? (
              <div className="py-16 rounded-2xl bg-slate-50/70 border border-slate-100 text-center text-xs font-semibold text-slate-400">
                조건에 해당하는 휴가가 없습니다.
              </div>
            ) : (
              <div className="space-y-6">
                {yearRecords.upcoming.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-extrabold text-slate-800">
                      예정된 휴가{" "}
                      <span className="text-[#00c458]">
                        {yearRecords.upcoming.length}
                      </span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {yearRecords.upcoming.map((doc) => (
                        <div
                          key={doc.approval_id}
                          className="py-3 flex items-center justify-between gap-3 text-xs relative"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-sm">
                              🏖️
                            </span>
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-[#00a84b] text-[11px] font-extrabold">
                              {doc.status === "APPROVED"
                                ? "승인완료"
                                : doc.status === "CANCELLED"
                                  ? "취소"
                                  : "승인대기"}
                            </span>
                            <span className="font-bold text-slate-800">
                              {doc.leave_type || "연차"}
                            </span>
                            <span className="text-slate-500 tabular-nums">
                              {formatDateRangeKo(
                                doc.effective_date,
                                doc.end_date
                              )}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-violet-50 text-violet-700 text-[11px] font-extrabold">
                              {formatLeaveDaysAsDurationBadge(doc.leave_days)}
                            </span>
                            {canManage && doc.status !== "CANCELLED" && (
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuDocId(
                                      menuDocId === doc.approval_id
                                        ? null
                                        : doc.approval_id
                                    );
                                  }}
                                  className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 font-extrabold"
                                >
                                  ⋯
                                </button>
                                {menuDocId === doc.approval_id && (
                                  <div className="absolute right-0 top-8 z-20 w-28 rounded-xl bg-white shadow-xl border border-slate-200 py-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleCancelLeaveRecord(doc.approval_id)
                                      }
                                      className="w-full px-3 py-1.5 text-left text-xs font-bold text-rose-600 hover:bg-rose-50"
                                    >
                                      휴가 취소
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {yearRecords.past.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-extrabold text-slate-800">
                      지난 휴가{" "}
                      <span className="text-[#00c458]">
                        {yearRecords.past.length}
                      </span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {yearRecords.past.map((doc) => (
                        <div
                          key={doc.approval_id}
                          className="py-3 flex items-center justify-between gap-3 text-xs relative"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-sm">
                              🏖️
                            </span>
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-[#00a84b] text-[11px] font-extrabold">
                              {doc.status === "APPROVED"
                                ? "승인완료"
                                : doc.status === "CANCELLED"
                                  ? "취소"
                                  : "승인대기"}
                            </span>
                            <span className="font-bold text-slate-800">
                              {doc.leave_type || "연차"}
                            </span>
                            <span className="text-slate-500 tabular-nums">
                              {formatDateRangeKo(
                                doc.effective_date,
                                doc.end_date
                              )}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-violet-50 text-violet-700 text-[11px] font-extrabold">
                              {formatLeaveDaysAsDurationBadge(doc.leave_days)}
                            </span>
                            {canManage && doc.status !== "CANCELLED" && (
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuDocId(
                                      menuDocId === doc.approval_id
                                        ? null
                                        : doc.approval_id
                                    );
                                  }}
                                  className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 font-extrabold"
                                >
                                  ⋯
                                </button>
                                {menuDocId === doc.approval_id && (
                                  <div className="absolute right-0 top-8 z-20 w-28 rounded-xl bg-white shadow-xl border border-slate-200 py-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleCancelLeaveRecord(doc.approval_id)
                                      }
                                      className="w-full px-3 py-1.5 text-left text-xs font-bold text-rose-600 hover:bg-rose-50"
                                    >
                                      휴가 취소
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ================= 탭 2: 연차 상세 (Screenshot 6) ================= */}
      {subTab === "DETAIL" && (
        <div className="px-9 py-8 max-w-[1280px] space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-slate-900">
              연차 상세 현황
            </h2>

            <div className="flex items-center gap-1.5 text-xs">
              <select
                value={detailYear}
                onChange={(e) => setDetailYear(Number(e.target.value))}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-bold text-slate-800"
              >
                {[
                  currentYear - 2,
                  currentYear - 1,
                  currentYear,
                  currentYear + 1,
                ].map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}년
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setDetailYear((y) => y - 1)}
                className="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-500"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setDetailYear((y) => y + 1)}
                className="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-500"
              >
                ›
              </button>
            </div>
          </div>

          {/* 4개 요약 카드 (Screenshot 6) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 rounded-2xl border border-slate-200 divide-x divide-slate-100 bg-white">
            <div className="p-5">
              <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                <span className="w-0.5 h-3 bg-[#00c458] rounded-full" />
                <span>자동 부여</span>
              </div>
              <div className="text-lg font-extrabold text-[#00a84b] mt-1">
                + {detailLedger.totalAutoGrantYearEnd}일
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                <span className="w-0.5 h-3 bg-rose-500 rounded-full" />
                <span>소멸</span>
              </div>
              <div className="text-lg font-extrabold text-rose-600 mt-1">
                - {detailLedger.totalExpired}일
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                <span className="w-0.5 h-3 bg-amber-500 rounded-full" />
                <span>사용</span>
              </div>
              <div className="text-lg font-extrabold text-rose-600 mt-1">
                - {detailLedger.totalUsedYear}일
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                <span className="w-0.5 h-3 bg-violet-500 rounded-full" />
                <span>조정</span>
              </div>
              <div className="text-lg font-extrabold text-[#00a84b] mt-1">
                {detailLedger.totalAdjustedYear >= 0
                  ? `+ ${detailLedger.totalAdjustedYear}일`
                  : `${detailLedger.totalAdjustedYear}일`}
              </div>
            </div>
          </div>

          {/* 12개월 월별 원장 테이블 */}
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-3 px-5 text-left font-bold">날짜</th>
                  <th className="py-3 px-4 text-left font-bold">자동 부여</th>
                  <th className="py-3 px-4 text-left font-bold">소멸</th>
                  <th className="py-3 px-4 text-left font-bold">사용</th>
                  <th className="py-3 px-4 text-left font-bold">
                    <div className="flex items-center justify-between">
                      <span>조정</span>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenAdjustModalForMember(
                              member.instructor_id,
                              `${detailYear}-${String(currentMonth).padStart(
                                2,
                                "0"
                              )}`
                            )
                          }
                          title="연차 수동 조정"
                          className="text-slate-400 hover:text-slate-800"
                        >
                          ✎
                        </button>
                      )}
                    </div>
                  </th>
                  <th className="py-3 px-5 text-left font-bold">잔여</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detailLedger.rows.map((r) => {
                  const isCurrentMo = r.isCurrentMonth;
                  const expanded = Boolean(expandedMonths[r.monthNum]);
                  const hasDetails =
                    r.usedItems.length > 0 || r.adjItems.length > 0;
                  const badgeLabel = r.isFiscalMonth
                    ? "회계일"
                    : r.isHireMonth
                      ? "입사월"
                      : "";

                  return (
                    <React.Fragment key={r.monthNum}>
                      <tr className="hover:bg-slate-50/50">
                        <td className="py-3.5 px-5 font-bold">
                          <span
                            className={
                              isCurrentMo ? "text-[#00a84b]" : "text-slate-800"
                            }
                          >
                            {detailYear}년 {r.monthNum}월
                          </span>
                          {badgeLabel && (
                            <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">
                              {badgeLabel}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-800">
                          {r.autoGrant > 0 ? `+${r.autoGrant}일` : ""}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-600">
                          {r.expired > 0 ? `-${r.expired}일` : ""}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-800">
                          {r.used > 0 ? `-${r.used}일` : ""}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-800">
                          <div className="flex items-center justify-between">
                            <span>
                              {r.adjusted > 0
                                ? `+${r.adjusted}일`
                                : r.adjusted < 0
                                  ? `${r.adjusted}일`
                                  : ""}
                            </span>
                            {hasDetails && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedMonths((prev) => ({
                                    ...prev,
                                    [r.monthNum]: !expanded,
                                  }))
                                }
                                className="text-blue-500 text-[10px] font-extrabold"
                              >
                                {expanded ? "▴" : "▾"}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-5 font-extrabold text-slate-900">
                          {r.runningBalance}일
                        </td>
                      </tr>

                      {expanded && hasDetails && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={6} className="px-6 py-2.5 space-y-1">
                            {r.usedItems.map((ud) => (
                              <div
                                key={ud.approval_id}
                                className="text-[11px] text-slate-600 flex items-center justify-between"
                              >
                                <span>
                                  • 사용: {ud.leave_type || "연차"} (
                                  {ud.effective_date})
                                </span>
                                <span className="font-bold text-rose-600">
                                  -{ud.leave_days}일
                                </span>
                              </div>
                            ))}
                            {r.adjItems.map((ad) => (
                              <div
                                key={ad.id}
                                className="text-[11px] text-slate-600 flex items-center justify-between"
                              >
                                <span>
                                  • 조정: {ad.reason} ({ad.actor_name})
                                </span>
                                <span className="font-bold text-emerald-700">
                                  {ad.delta_days > 0
                                    ? `+${ad.delta_days}일`
                                    : `${ad.delta_days}일`}
                                </span>
                              </div>
                            ))}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= 2개월 달력 휴가 시작일 선택 모달 (Screenshot 5) ================= */}
      {calModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => setCalModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-[600px] rounded-3xl shadow-2xl border border-slate-200 p-7 space-y-5"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                  <span>
                    {selectedCard.kind === "ANNUAL"
                      ? "🏖️ 연차"
                      : `${selectedCard.item.icon} ${selectedCard.item.name}`}
                  </span>
                  <span className="text-slate-400">
                    {selectedCard.kind === "ANNUAL"
                      ? `${currentYearSummary.availableRemainDays}일 사용 가능 · 유급`
                      : `${selectedCard.item.pay_type}`}
                  </span>
                </div>
                <h3 className="text-lg font-extrabold text-slate-900 mt-1">
                  {pickStart
                    ? "휴가 종료 날짜 및 단위를 확인해주세요"
                    : "휴가 시작 날짜를 선택해주세요"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCalModalOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            {/* 달력 월 이동 */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setCalBaseYm((prev) =>
                    prev.month === 1
                      ? { year: prev.year - 1, month: 12 }
                      : { year: prev.year, month: prev.month - 1 }
                  )
                }
                className="absolute left-0 top-0 text-slate-400 hover:text-slate-800 font-bold px-2"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() =>
                  setCalBaseYm((prev) =>
                    prev.month === 12
                      ? { year: prev.year + 1, month: 1 }
                      : { year: prev.year, month: prev.month + 1 }
                  )
                }
                className="absolute right-0 top-0 text-slate-400 hover:text-slate-800 font-bold px-2"
              >
                ›
              </button>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-1">
                {renderMonthCalendar(calBaseYm.year, calBaseYm.month)}
                {renderMonthCalendar(nextMonthYm.year, nextMonthYm.month)}
              </div>
            </div>

            {pickStart && (
              <div className="pt-3 border-t border-slate-100 space-y-3 text-xs">
                {selectedCard.kind === "ANNUAL" &&
                  (!pickEnd || pickEnd === pickStart) && (
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          { id: "FULL", label: "종일 (1일)" },
                          { id: "AM_HALF", label: "오전 반차 (0.5일)" },
                          { id: "PM_HALF", label: "오후 반차 (0.5일)" },
                          { id: "TWO_HOURS", label: "시간차 (2시간 · 0.25일)" },
                        ] as const
                      ).map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setUnitMode(u.id)}
                          className={`px-3 py-1.5 rounded-xl border font-bold ${
                            unitMode === u.id
                              ? "bg-emerald-50 border-[#00c458] text-emerald-900"
                              : "bg-white border-slate-200 text-slate-600"
                          }`}
                        >
                          {u.label}
                        </button>
                      ))}
                    </div>
                  )}

                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="사유 입력 (선택사항)"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-[#00c458]"
                />

                <div className="flex items-center justify-between pt-1">
                  <span className="font-bold text-slate-600">
                    선택 기간: {pickStart}
                    {pickEnd && pickEnd !== pickStart ? ` ~ ${pickEnd}` : ""} (
                    <b className="text-[#00a84b]">{calculatedDays}일</b>)
                  </span>

                  <button
                    type="button"
                    disabled={savingReg}
                    onClick={handleSubmitAdminRegister}
                    className="px-5 py-2.5 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold shadow-xs"
                  >
                    {savingReg
                      ? "등록 중..."
                      : `${member.name} 님 휴가 등록하기`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
