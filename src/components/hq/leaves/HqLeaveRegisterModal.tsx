// src/components/hq/leaves/HqLeaveRegisterModal.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import { getRankLevel } from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import { DEFAULT_APPROVAL_POLICIES } from "@/lib/hq/defaultApprovalPolicies";
import {
  DEFAULT_ANNUAL_LEAVE_SETTINGS,
  DEFAULT_CUSTOM_LEAVES,
  isCustomLeaveEligibleForGender,
} from "@/lib/hq/defaultLeaveSettings";
import { resolvePolicyApprovalLine } from "@/lib/hq/defaultWorkflowForms";
import {
  addDaysUtcYmd,
  addMonthsClampedYmd,
  calcStatutoryAnnualDaysForCompletedYears,
  computeMemberAnnualLeaveLedgerForYear,
  roundLeave4,
} from "@/lib/hq/leaveBalanceEngine";
import { getRegisteredOrgNames } from "@/lib/hq/orgTreeHelper";
import type {
  HqApprovalDoc,
  HqCcNotifyMode,
  HqCustomLeaveItem,
  HqLeaveAdjustmentItem,
  HqMember,
  HqUploadedMonthlyUsageItem,
} from "@/lib/hq/types";

export type LeaveRegisterKind =
  | { type: "ANNUAL" }
  | { type: "CUSTOM"; item: HqCustomLeaveItem };

type DayScheduleMode = "FULL" | "AM_HALF" | "PM_HALF" | "HOURLY";

interface DayScheduleItem {
  ymd: string;
  mode: DayScheduleMode;
  startMin: number; // 분 단위 (09:00 = 540)
  endMin: number; // 분 단위 (11:00 = 660)
  includeBreak: boolean; // 커피컵 휴게시간(1시간) 포함 여부
}

interface CcDraftItem {
  id: string;
  name: string;
  dept: string;
  notifyMode: HqCcNotifyMode;
}

interface ApprovalStepDraft {
  id: string;
  assignees: {
    id: string;
    name: string;
    dept: string;
    rank_code: string;
    job_title: string;
  }[];
  autoProceedEnabled?: boolean;
  autoProceedDays?: number;
}

interface FloatingDropdownState {
  key: string;
  ymd: string;
  kind: "MODE" | "START" | "END";
  rect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialKind?: LeaveRegisterKind;
  availableAnnualDays?: number;
  allowSwitchLeaveKind?: boolean;
  leaveDocs?: HqApprovalDoc[];
  adjustments?: HqLeaveAdjustmentItem[];
  uploadedMonthly?: HqUploadedMonthlyUsageItem[];
  onSubmitted?: () => Promise<void> | void;
}

const WEEKDAY_HEADER = ["일", "월", "화", "수", "목", "금", "토"] as const;
const DEFAULT_INITIAL_KIND: LeaveRegisterKind = { type: "ANNUAL" };
const EMPTY_LEAVE_DOCS: HqApprovalDoc[] = [];
const EMPTY_ADJUSTMENTS: HqLeaveAdjustmentItem[] = [];
const EMPTY_UPLOADED_MONTHLY: HqUploadedMonthlyUsageItem[] = [];
const EMPTY_WORKING_DATES: string[] = [];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmd(y: number, m1: number, d: number): string {
  return `${y}-${pad2(m1)}-${pad2(d)}`;
}

function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

function formatKoreanFullDateWithDow(ymd: string): string {
  const dt = parseYmdLocal(ymd);
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${
    WEEKDAY_HEADER[dt.getDay()]
  })`;
}

function formatDateRangeHeading(startYmd: string, endYmd: string): string {
  if (!startYmd) return "휴가 시작 날짜를 선택해주세요";
  if (!endYmd || startYmd === endYmd) {
    return formatKoreanFullDateWithDow(startYmd);
  }
  const s = parseYmdLocal(startYmd);
  const e = parseYmdLocal(endYmd);
  if (s.getFullYear() === e.getFullYear()) {
    return `${s.getFullYear()}년 ${s.getMonth() + 1}월 ${s.getDate()}일 (${
      WEEKDAY_HEADER[s.getDay()]
    }) – ${e.getMonth() + 1}월 ${e.getDate()}일 (${WEEKDAY_HEADER[e.getDay()]})`;
  }
  return `${formatKoreanFullDateWithDow(startYmd)} – ${formatKoreanFullDateWithDow(
    endYmd
  )}`;
}

function formatDotDate(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${y}. ${m}. ${d}`;
}

function minutesToKoreanAmPm(totalMin: number): string {
  const clamped = ((totalMin % 1440) + 1440) % 1440;
  const h24 = Math.floor(clamped / 60);
  const m = clamped % 60;
  const period = h24 < 12 ? "오전" : "오후";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${period} ${h12}:${pad2(m)}`;
}

function minutesToHm24(totalMin: number): string {
  const clamped = Math.max(0, Math.min(1439, totalMin));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function parseHmInputToMinutes(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function calcDayNetHours(item: DayScheduleItem): number {
  if (item.mode === "FULL") return 8;
  if (item.mode === "AM_HALF" || item.mode === "PM_HALF") return 4;
  const spanMin = Math.max(0, item.endMin - item.startMin);
  const netMin = Math.max(30, spanMin - (item.includeBreak ? 60 : 0));
  return Math.round((netMin / 60) * 100) / 100;
}

function formatHoursAsFlexLabel(totalHours: number): string {
  if (totalHours <= 0) return "0시간";
  const fullDays = Math.floor((totalHours + 0.001) / 8);
  const remHours = Math.round((totalHours - fullDays * 8) * 10) / 10;
  if (fullDays > 0 && remHours > 0) {
    return `${fullDays}일 ${remHours}시간`;
  }
  if (fullDays > 0) {
    return `${fullDays}일`;
  }
  return `${remHours}시간`;
}

function avatarColor(name: string): string {
  if (name === "김근식" || name === "백시연" || name === "심혜영") return "#2dd4bf";
  if (name === "김동현" || name === "나승희") return "#4ade80";
  if (name === "김문수" || name === "원종준" || name === "조원형") return "#eb7d66";
  if (name === "민세리") return "#e57373";
  if (name === "천종현") return "#8da2fb";
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i);
  const palette = ["#38bdf8", "#fb923c", "#a78bfa", "#34d399", "#f472b6"];
  return palette[sum % palette.length];
}

function buildCalendarMonthCells(year: number, month1: number) {
  const firstDow = new Date(year, month1 - 1, 1).getDay();
  const daysInMonth = new Date(year, month1, 0).getDate();
  const prevMonthDays = new Date(year, month1 - 1, 0).getDate();

  const cells: {
    ymd: string;
    day: number;
    inMonth: boolean;
    dow: number;
  }[] = [];

  for (let i = 0; i < firstDow; i += 1) {
    const d = prevMonthDays - firstDow + 1 + i;
    const pm = month1 === 1 ? 12 : month1 - 1;
    const py = month1 === 1 ? year - 1 : year;
    cells.push({
      ymd: toYmd(py, pm, d),
      day: d,
      inMonth: false,
      dow: i,
    });
  }

  for (let d = 1; d <= daysInMonth; d += 1) {
    const dow = (firstDow + d - 1) % 7;
    cells.push({
      ymd: toYmd(year, month1, d),
      day: d,
      inMonth: true,
      dow,
    });
  }

  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    const dow = cells.length % 7;
    const nm = month1 === 12 ? 1 : month1 + 1;
    const ny = month1 === 12 ? year + 1 : year;
    cells.push({
      ymd: toYmd(ny, nm, nextDay),
      day: nextDay,
      inMonth: false,
      dow,
    });
    nextDay += 1;
  }

  return cells;
}

/** 커피컵(휴게시간) 아이콘 */
function CoffeeCupIcon({
  withPlus = false,
  filled = false,
}: {
  withPlus?: boolean;
  filled?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
      aria-hidden="true"
    >
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v7a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z" />
      {withPlus && !filled && (
        <>
          <line x1="9.5" y1="11" x2="9.5" y2="15" />
          <line x1="7.5" y1="13" x2="11.5" y2="13" />
        </>
      )}
    </svg>
  );
}

export default function HqLeaveRegisterModal({
  isOpen,
  onClose,
  initialKind = DEFAULT_INITIAL_KIND,
  availableAnnualDays,
  allowSwitchLeaveKind = false,
  leaveDocs = EMPTY_LEAVE_DOCS,
  adjustments = EMPTY_ADJUSTMENTS,
  uploadedMonthly = EMPTY_UPLOADED_MONTHLY,
  onSubmitted,
}: Props) {
  const {
    me,
    members,
    companySettings,
    refreshMembers,
    refreshApprovalBadge,
    refreshAttendanceState,
  } = useHqShell();

  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const todayYmd = useMemo(
    () =>
      `${currentYear}-${pad2(currentMonth)}-${pad2(now.getDate())}`,
    [currentYear, currentMonth, now]
  );

  // 모달 단계 및 오버레이 상태
  const [stepView, setStepView] = useState<"CALENDAR" | "CONFIRM">("CALENDAR");
  const [leaveKind, setLeaveKind] = useState<LeaveRegisterKind>(initialKind);
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  const [infoPopoverOpen, setInfoPopoverOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [quitConfirmOpen, setQuitConfirmOpen] = useState(false);

  // 달력 선택 상태
  const [calBaseYm, setCalBaseYm] = useState({
    year: currentYear,
    month: currentMonth,
  });
  const [pickStart, setPickStart] = useState("");
  const [pickEnd, setPickEnd] = useState("");

  // 일자별 상세 일정 설정 (반반차/시간차/반차/휴게시간)
  const [daySchedules, setDaySchedules] = useState<
    Record<string, DayScheduleItem>
  >({});
  const [floatingDropdown, setFloatingDropdown] =
    useState<FloatingDropdownState | null>(null);
  const [customTimeText, setCustomTimeText] = useState("");
  const [breakToastForYmd, setBreakToastForYmd] = useState<{
    ymd: string;
    text: string;
  } | null>(null);

  // Step 2: 사유 + 우측 승인·참조 패널 상태
  const [reason, setReason] = useState("");
  const [linePanelOpen, setLinePanelOpen] = useState(false);
  const [allowLineEdit, setAllowLineEdit] = useState(true);
  const [autoDelegated, setAutoDelegated] = useState(false);
  const [delegationReason, setDelegationReason] = useState<string | null>(null);
  const [lineManuallyEdited, setLineManuallyEdited] = useState(false);
  const [ccList, setCcList] = useState<CcDraftItem[]>([]);
  const [approvalSteps, setApprovalSteps] = useState<ApprovalStepDraft[]>([]);
  const [notifyMenuTargetId, setNotifyMenuTargetId] = useState<string | null>(
    null
  );
  const [autoProceedMenuStepId, setAutoProceedMenuStepId] = useState<
    string | null
  >(null);
  const [pickerContext, setPickerContext] = useState<
    null | { kind: "CC" } | { kind: "STEP"; stepId: string }
  >(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [includeSubOrgs, setIncludeSubOrgs] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const annualPolicy = useMemo(() => {
    const list =
      companySettings?.extra_settings?.annual_leave_settings?.policies;
    const arr =
      list && list.length > 0 ? list : DEFAULT_ANNUAL_LEAVE_SETTINGS.policies;
    return arr.find((p) => p.is_default) || arr[0];
  }, [companySettings?.extra_settings?.annual_leave_settings]);

  const approvalPolicies = useMemo(() => {
    const saved = companySettings?.extra_settings?.approval_policies;
    return saved && saved.length > 0 ? saved : DEFAULT_APPROVAL_POLICIES;
  }, [companySettings?.extra_settings?.approval_policies]);

  const eligibleCustomLeaves = useMemo(() => {
    const raw = companySettings?.extra_settings?.custom_leaves;
    const list =
      Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_CUSTOM_LEAVES;
    const gender = me?.profile_extra?.gender || "";
    return list.filter((c) => isCustomLeaveEligibleForGender(c, gender));
  }, [companySettings?.extra_settings?.custom_leaves, me?.profile_extra?.gender]);

  // 공휴일 Set
  const holidaySet = useMemo(() => {
    const set = new Set<string>();
    Object.values(companySettings?.holidays_by_year || {}).forEach((arr) => {
      (arr || []).forEach((h) => {
        if (!h.start_date) return;
        const end = h.end_date || h.start_date;
        let cur = h.start_date.slice(0, 10);
        let guard = 0;
        while (cur <= end.slice(0, 10) && guard < 30) {
          set.add(cur);
          cur = addDaysUtcYmd(cur, 1);
          guard += 1;
        }
      });
    });
    return set;
  }, [companySettings?.holidays_by_year]);

  // 보유 연차 일수
  const resolvedAvailableAnnualDays = useMemo(() => {
    if (typeof availableAnnualDays === "number") return availableAnnualDays;
    if (!me) return 0;
    if (leaveDocs.length > 0 || adjustments.length > 0) {
      return computeMemberAnnualLeaveLedgerForYear({
        memberId: me.instructor_id,
        hireDate: me.hire_date,
        groupHireDate: me.profile_extra?.group_hire_date || null,
        useMemberGroupHireDate: me.profile_extra?.use_group_hire_date !== false,
        weeklyWorkHours: Number(me.profile_extra?.weekly_work_hours ?? 40),
        resignDate: me.resign_date || null,
        year: currentYear,
        currentYear,
        currentMonth,
        policy: annualPolicy,
        leaveDocs,
        adjustments,
        uploadedMonthly,
      }).availableRemainDays;
    }
    return Number(me.annual_leave_remain ?? 0);
  }, [
    availableAnnualDays,
    me,
    leaveDocs,
    adjustments,
    uploadedMonthly,
    currentYear,
    currentMonth,
    annualPolicy,
  ]);

  // 시간차 기본 단위 (기본 반반차 = 2시간 = 120분)
  const hourlyUnitMinutes = useMemo(() => {
    const sub = annualPolicy?.hourly_sub_unit || "2시간";
    if (sub === "30분") return 30;
    if (sub === "1시간") return 60;
    return 120; // 기본 2시간(반반차) 단위
  }, [annualPolicy?.hourly_sub_unit]);

  // 정책 기반 기본 참조·승인선 초기화 함수
  const syncApprovalLineFromKind = (
    kind: LeaveRegisterKind,
    daysOverride?: number
  ) => {
    if (!me) return;
    const polId =
      kind.type === "ANNUAL"
        ? annualPolicy?.policy_id || "lv-annual"
        : kind.item.policy_id;
    const matchedPol =
      approvalPolicies.find((p) => p.id === polId) ||
      approvalPolicies.find((p) => p.id === "lv-annual");

    if (!matchedPol) {
      setCcList([]);
      setApprovalSteps([]);
      setAllowLineEdit(true);
      setAutoDelegated(false);
      setDelegationReason(null);
      return;
    }

    const resolved = resolvePolicyApprovalLine({
      policy: matchedPol,
      me,
      members,
      orgNodes: companySettings?.extra_settings?.org_chart_nodes,
      substituteRules:
        companySettings?.extra_settings?.substitute_approvals || [],
      leaveDays: daysOverride,
    });
    setAutoDelegated(resolved.autoDelegated);
    setDelegationReason(resolved.delegationReason);

    setAllowLineEdit(true); // 사용자 요청: 참조는 기본 설정된 사람에게 가고, 참조와 승인을 자유롭게 추가 가능하도록 허용
    setCcList(
      resolved.ccMembers.map((c) => ({
        id: c.id || `name:${c.name}`,
        name: c.name,
        dept: c.dept,
        notifyMode: "BOTH",
      }))
    );
    setApprovalSteps(
      resolved.steps.map((s, idx) => {
        const polStep = matchedPol.steps?.[idx];
        return {
          id: `step-${idx + 1}-${Date.now()}`,
          assignees: [
            {
              id: s.approver_id,
              name: s.approver_name,
              dept: s.approver_dept,
              rank_code: s.approver_rank,
              job_title: s.approver_title,
            },
          ],
          autoProceedEnabled: Boolean(polStep?.auto_proceed_enabled),
          autoProceedDays: Math.max(1, Number(polStep?.auto_proceed_days || 1)),
        };
      })
    );
  };

  const initialKindKey =
    initialKind.type === "ANNUAL" ? "ANNUAL" : `CUSTOM:${initialKind.item.id}`;

  useEffect(() => {
    if (!isOpen) return;
    setStepView("CALENDAR");
    setLeaveKind(initialKind);
    setKindMenuOpen(false);
    setInfoPopoverOpen(false);
    setDetailSheetOpen(false);
    setQuitConfirmOpen(false);
    setCalBaseYm({ year: currentYear, month: currentMonth });
    setPickStart("");
    setPickEnd("");
    setDaySchedules({});
    setFloatingDropdown(null);
    setReason("");
    setLinePanelOpen(false);
    setPickerContext(null);
    setPickerSearch("");
    setNotifyMenuTargetId(null);
    setAutoProceedMenuStepId(null);
    setLineManuallyEdited(false);
    syncApprovalLineFromKind(initialKind, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialKindKey, me?.instructor_id]);

  const secondMonthYm = useMemo(() => {
    if (calBaseYm.month === 12) {
      return { year: calBaseYm.year + 1, month: 1 };
    }
    return { year: calBaseYm.year, month: calBaseYm.month + 1 };
  }, [calBaseYm]);

  // 선택한 구간 내 실제 휴가 적용 근무일 목록 (주말·공휴일 자동 제외)
  const workingDates = useMemo(() => {
    if (!pickStart) return EMPTY_WORKING_DATES;
    const end = pickEnd || pickStart;
    const deductHol =
      leaveKind.type === "CUSTOM" && Boolean(leaveKind.item.deduct_on_holidays);
    const list: string[] = [];
    let cur = pickStart;
    let guard = 0;
    while (cur <= end && guard < 180) {
      const dow = parseYmdLocal(cur).getDay();
      if (deductHol || (dow !== 0 && dow !== 6 && !holidaySet.has(cur))) {
        list.push(cur);
      }
      cur = addDaysUtcYmd(cur, 1);
      guard += 1;
    }
    return list;
  }, [pickStart, pickEnd, leaveKind, holidaySet]);

  // workingDates 변경 시 기본 DayScheduleItem('하루 종일') 동기화
  useEffect(() => {
    setDaySchedules((prev) => {
      if (workingDates.length === 0 && Object.keys(prev).length === 0) {
        return prev;
      }
      const next: Record<string, DayScheduleItem> = {};
      workingDates.forEach((ymd) => {
        next[ymd] = prev[ymd] || {
          ymd,
          mode: "FULL",
          startMin: 9 * 60,
          endMin: 18 * 60,
          includeBreak: true,
        };
      });
      return next;
    });
  }, [workingDates]);

  // 총 사용 시간 및 일수 합산
  const usageSummary = useMemo(() => {
    if (workingDates.length === 0) {
      return { totalHours: 0, totalDays: 0, label: "0일" };
    }
    if (
      leaveKind.type === "CUSTOM" &&
      leaveKind.item.usage_unit === "한번에 모두 사용"
    ) {
      const d = Number(leaveKind.item.grant_amount || 1);
      return { totalHours: d * 8, totalDays: d, label: `${d}일` };
    }
    const totalHours = workingDates.reduce((acc, ymd) => {
      const item = daySchedules[ymd] || {
        ymd,
        mode: "FULL" as const,
        startMin: 540,
        endMin: 1080,
        includeBreak: true,
      };
      return acc + calcDayNetHours(item);
    }, 0);
    const totalDays = roundLeave4(totalHours / 8);
    return {
      totalHours,
      totalDays,
      label: formatHoursAsFlexLabel(totalHours),
    };
  }, [workingDates, daySchedules, leaveKind]);

  // 선택한 휴가 일수(반차 0.5일 / 1~2일 연차 vs 3일 이상 장기휴가)에 따라 자동 전결(대표 결재 생략) 실시간 재산출
  useEffect(() => {
    if (!isOpen || !me || lineManuallyEdited) return;
    syncApprovalLineFromKind(leaveKind, usageSummary.totalDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOpen,
    me?.instructor_id,
    leaveKind,
    usageSummary.totalDays,
    lineManuallyEdited,
  ]);

  // 연차 부여 내역 안내 팝오버 데이터 (Screenshots 100459 & 100505)
  const grantBreakdownItems = useMemo(() => {
    if (!me?.hire_date) return { accrued: [], upcoming: null as string | null };
    const cleanHire = me.hire_date.slice(0, 10);
    const [hy, hm, hd] = cleanHire.split("-").map(Number);
    const firstYearAnniv = addMonthsClampedYmd(hy, hm, hd, 12);
    const firstYearExpire = addDaysUtcYmd(firstYearAnniv, -1);

    const accrued: { grantLabel: string; days: number; expireLabel: string }[] =
      [];
    let upcoming: string | null = null;

    if (todayYmd < firstYearAnniv) {
      for (let k = 1; k <= 11; k += 1) {
        const gDate = addMonthsClampedYmd(hy, hm, hd, k);
        if (gDate <= todayYmd) {
          accrued.push({
            grantLabel: formatDotDate(gDate),
            days: 1,
            expireLabel: `${formatDotDate(gDate)} - ${formatDotDate(
              firstYearExpire
            )}`,
          });
        } else if (!upcoming) {
          upcoming = formatDotDate(gDate);
        }
      }
    } else {
      const compYrs = Math.max(1, currentYear - hy);
      const anniv = addMonthsClampedYmd(hy, hm, hd, compYrs * 12);
      const nextExpire = addDaysUtcYmd(
        addMonthsClampedYmd(hy, hm, hd, (compYrs + 1) * 12),
        -1
      );
      const days = calcStatutoryAnnualDaysForCompletedYears(compYrs);
      accrued.push({
        grantLabel: formatDotDate(anniv),
        days,
        expireLabel: `${formatDotDate(anniv)} - ${formatDotDate(nextExpire)}`,
      });
    }

    return { accrued, upcoming };
  }, [me?.hire_date, todayYmd, currentYear]);

  const activeMembers = useMemo(
    () =>
      members
        .filter((m) => m.work_status === "재직")
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [members]
  );

  const registeredDepartments = useMemo(
    () => getRegisteredOrgNames(companySettings?.extra_settings?.org_chart_nodes),
    [companySettings?.extra_settings?.org_chart_nodes]
  );

  if (!isOpen || !me) return null;

  const shiftCalMonth = (delta: number) => {
    setCalBaseYm((prev) => {
      const total = prev.year * 12 + (prev.month - 1) + delta;
      return { year: Math.floor(total / 12), month: (total % 12) + 1 };
    });
  };

  const handleCloseAttempt = () => {
    if (pickStart) {
      setQuitConfirmOpen(true);
    } else {
      onClose();
    }
  };

  const handleCalendarDayClick = (ymd: string) => {
    if (
      leaveKind.type === "CUSTOM" &&
      leaveKind.item.usage_unit === "한번에 모두 사용"
    ) {
      const targetDays = Math.max(1, Number(leaveKind.item.grant_amount || 1));
      let cur = ymd;
      let counted = 0;
      let guard = 0;
      while (counted < targetDays && guard < 180) {
        const dow = parseYmdLocal(cur).getDay();
        if (
          leaveKind.item.deduct_on_holidays ||
          (dow !== 0 && dow !== 6 && !holidaySet.has(cur))
        ) {
          counted += 1;
        }
        if (counted >= targetDays) break;
        cur = addDaysUtcYmd(cur, 1);
        guard += 1;
      }
      setPickStart(ymd);
      setPickEnd(cur);
      return;
    }

    if (!pickStart || (pickStart && pickEnd && pickStart !== pickEnd)) {
      setPickStart(ymd);
      setPickEnd(ymd);
    } else if (ymd < pickStart) {
      setPickStart(ymd);
      setPickEnd(pickStart);
    } else {
      setPickEnd(ymd);
    }
  };

  const updateDayMode = (ymd: string, mode: DayScheduleMode) => {
    setDaySchedules((prev) => {
      const cur = prev[ymd] || {
        ymd,
        mode: "FULL",
        startMin: 540,
        endMin: 1080,
        includeBreak: true,
      };
      if (mode === "FULL") {
        return {
          ...prev,
          [ymd]: {
            ...cur,
            mode: "FULL",
            startMin: 9 * 60,
            endMin: 18 * 60,
            includeBreak: true,
          },
        };
      }
      if (mode === "AM_HALF") {
        return {
          ...prev,
          [ymd]: {
            ...cur,
            mode: "AM_HALF",
            startMin: 9 * 60,
            endMin: 13 * 60,
            includeBreak: false,
          },
        };
      }
      if (mode === "PM_HALF") {
        return {
          ...prev,
          [ymd]: {
            ...cur,
            mode: "PM_HALF",
            startMin: 14 * 60,
            endMin: 18 * 60,
            includeBreak: false,
          },
        };
      }
      // 시간차 (기본 반반차 2시간: 오전 9:00 ~ 오전 11:00)
      return {
        ...prev,
        [ymd]: {
          ...cur,
          mode: "HOURLY",
          startMin: 9 * 60,
          endMin: 9 * 60 + hourlyUnitMinutes,
          includeBreak: false,
        },
      };
    });
    setFloatingDropdown(null);
  };

  const updateDayStartMin = (ymd: string, nextStart: number) => {
    setDaySchedules((prev) => {
      const cur = prev[ymd];
      if (!cur) return prev;
      const curNetMin = Math.max(
        hourlyUnitMinutes,
        cur.endMin - cur.startMin - (cur.includeBreak ? 60 : 0)
      );
      const nextEnd = Math.min(
        22 * 60,
        nextStart + curNetMin + (cur.includeBreak ? 60 : 0)
      );
      return {
        ...prev,
        [ymd]: { ...cur, startMin: nextStart, endMin: nextEnd },
      };
    });
    setFloatingDropdown(null);
  };

  const updateDayEndMin = (ymd: string, nextEnd: number) => {
    setDaySchedules((prev) => {
      const cur = prev[ymd];
      if (!cur || nextEnd <= cur.startMin) return prev;
      return {
        ...prev,
        [ymd]: { ...cur, endMin: nextEnd },
      };
    });
    setFloatingDropdown(null);
  };

  const toggleDayBreak = (ymd: string) => {
    setDaySchedules((prev) => {
      const cur = prev[ymd];
      if (!cur || cur.mode === "FULL") return prev;
      const nextInclude = !cur.includeBreak;
      const nextEnd = nextInclude
        ? Math.min(23 * 60, cur.endMin + 60)
        : Math.max(cur.startMin + 60, cur.endMin - 60);
      setBreakToastForYmd({
        ymd,
        text: nextInclude
          ? "휴게 시간을 포함했어요. (1시간)"
          : "휴게 시간을 포함하지 않았어요.",
      });
      setTimeout(() => {
        setBreakToastForYmd((prevToast) =>
          prevToast?.ymd === ymd ? null : prevToast
        );
      }, 2200);
      return {
        ...prev,
        [ymd]: { ...cur, includeBreak: nextInclude, endMin: nextEnd },
      };
    });
  };

  // 조직장/구성원/부서 피커에서 대상 추가·토글
  const resolveOrgHeadByLevel = (levelOrder: number): HqMember | undefined => {
    if (levelOrder === 1) {
      return (
        activeMembers.find(
          (m) =>
            m.department === me.department &&
            m.is_dept_head &&
            m.instructor_id !== me.instructor_id
        ) ||
        activeMembers.find(
          (m) =>
            getRankLevel(m.rank_code) >= 5 &&
            m.instructor_id !== me.instructor_id
        )
      );
    }
    return (
      activeMembers.find(
        (m) =>
          getRankLevel(m.rank_code) >= Math.min(5, levelOrder + 2) &&
          m.instructor_id !== me.instructor_id
      ) ||
      activeMembers.find(
        (m) =>
          getRankLevel(m.rank_code) >= 5 && m.instructor_id !== me.instructor_id
      )
    );
  };

  const addMembersToPickerTarget = (pickedMembers: HqMember[]) => {
    if (!pickerContext || pickedMembers.length === 0) return;

    if (pickerContext.kind === "CC") {
      setCcList((prev) => {
        const next = [...prev];
        pickedMembers.forEach((m) => {
          if (!next.some((x) => x.id === m.instructor_id || x.name === m.name)) {
            next.push({
              id: m.instructor_id,
              name: m.name,
              dept: m.department,
              notifyMode: "BOTH",
            });
          }
        });
        return next;
      });
    } else {
      setLineManuallyEdited(true);
      const targetStepId = pickerContext.stepId;
      setApprovalSteps((prev) =>
        prev.map((st) => {
          if (st.id !== targetStepId) return st;
          const nextAssignees = [...st.assignees];
          pickedMembers.forEach((m) => {
            if (
              m.instructor_id !== me.instructor_id &&
              !nextAssignees.some((a) => a.id === m.instructor_id)
            ) {
              nextAssignees.push({
                id: m.instructor_id,
                name: m.name,
                dept: m.department,
                rank_code: m.rank_code,
                job_title: m.job_title,
              });
            }
          });
          return { ...st, assignees: nextAssignees };
        })
      );
    }
  };

  const toggleSingleMemberInPicker = (target: HqMember) => {
    if (!pickerContext) return;
    if (pickerContext.kind === "CC") {
      setCcList((prev) => {
        const exists = prev.some(
          (x) => x.id === target.instructor_id || x.name === target.name
        );
        if (exists) {
          return prev.filter(
            (x) => x.id !== target.instructor_id && x.name !== target.name
          );
        }
        return [
          ...prev,
          {
            id: target.instructor_id,
            name: target.name,
            dept: target.department,
            notifyMode: "BOTH",
          },
        ];
      });
    } else {
      setLineManuallyEdited(true);
      const stepId = pickerContext.stepId;
      setApprovalSteps((prev) =>
        prev.map((st) => {
          if (st.id !== stepId) return st;
          const exists = st.assignees.some((a) => a.id === target.instructor_id);
          if (exists) {
            return {
              ...st,
              assignees: st.assignees.filter(
                (a) => a.id !== target.instructor_id
              ),
            };
          }
          if (target.instructor_id === me.instructor_id) return st;
          return {
            ...st,
            assignees: [
              ...st.assignees,
              {
                id: target.instructor_id,
                name: target.name,
                dept: target.department,
                rank_code: target.rank_code,
                job_title: target.job_title,
              },
            ],
          };
        })
      );
    }
  };

  // 하단 요약 문구 생성 (예: "김근식님에게 참조를 요청해요. ›")
  const flattenedApprovers = approvalSteps.flatMap((st) => st.assignees);
  const lineSummaryText = (() => {
    if (flattenedApprovers.length === 0 && ccList.length === 0) {
      return "승인 · 참조 대상을 추가할 수 있어요.";
    }
    if (flattenedApprovers.length === 0 && ccList.length > 0) {
      return ccList.length === 1
        ? `${ccList[0].name}님에게 참조를 요청해요.`
        : `${ccList[0].name}님 외 ${ccList.length - 1}명에게 참조를 요청해요.`;
    }
    if (flattenedApprovers.length > 0 && ccList.length === 0) {
      return flattenedApprovers.length === 1
        ? `${flattenedApprovers[0].name}님에게 승인을 요청해요.`
        : `${flattenedApprovers[0].name}님 외 ${
            flattenedApprovers.length - 1
          }명에게 승인을 요청해요.`;
    }
    return `${flattenedApprovers[0].name}님에게 승인을, ${ccList[0].name}님${
      ccList.length > 1 ? ` 외 ${ccList.length - 1}명` : ""
    }에게 참조를 요청해요.`;
  })();

  // 최종 휴가 등록 / 승인 요청 제출
  const handleSubmit = async () => {
    if (!pickStart || workingDates.length === 0 || usageSummary.totalDays <= 0) {
      alert("휴가를 사용할 근무일을 선택해 주세요.");
      return;
    }

    // 빈 승인 단계(승인자를 아직 고르지 않은 단계) 확인
    const hasEmptyStep = approvalSteps.some((st) => st.assignees.length === 0);
    if (hasEmptyStep) {
      alert("추가한 승인 단계에 승인자를 선택하거나 빈 단계를 삭제해 주세요.");
      setLinePanelOpen(true);
      return;
    }

    const effStart = workingDates[0];
    const effEnd = workingDates[workingDates.length - 1];

    // 단일 일자 반차/반반차/시간차 라벨 결정
    let resolvedLeaveTypeLabel =
      leaveKind.type === "ANNUAL" ? "연차" : leaveKind.item.name;
    if (leaveKind.type === "ANNUAL" && workingDates.length === 1) {
      const single = daySchedules[effStart];
      if (single?.mode === "AM_HALF") resolvedLeaveTypeLabel = "오전 반차";
      else if (single?.mode === "PM_HALF") resolvedLeaveTypeLabel = "오후 반차";
      else if (single?.mode === "HOURLY") {
        const hrs = calcDayNetHours(single);
        resolvedLeaveTypeLabel =
          hrs === 2 ? "반반차 (2시간)" : `시간차 연차 (${hrs}시간)`;
      }
    }

    // 상세 일정 텍스트 기록 생성
    const scheduleDetailLines = workingDates.map((ymd, i) => {
      const sc = daySchedules[ymd];
      if (!sc || sc.mode === "FULL") {
        return `${i + 1}. ${formatKoreanFullDateWithDow(ymd)}: 하루 종일 (8시간)`;
      }
      const modeName =
        sc.mode === "AM_HALF"
          ? "오전 반차"
          : sc.mode === "PM_HALF"
            ? "오후 반차"
            : "시간차";
      return `${i + 1}. ${formatKoreanFullDateWithDow(
        ymd
      )}: ${modeName} (${minutesToKoreanAmPm(sc.startMin)} ~ ${minutesToKoreanAmPm(
        sc.endMin
      )}, ${calcDayNetHours(sc)}시간${
        sc.includeBreak ? ", 휴게 1시간 포함" : ""
      })`;
    });

    // 승인 단계별 자동 진행 설정 매핑 (apiSteps 순번 기준)
    const stepAutoProceed: Record<string, { enabled: boolean; days: number }> =
      {};
    let flatOrder = 0;
    approvalSteps.forEach((st) => {
      st.assignees.forEach(() => {
        flatOrder += 1;
        if (st.autoProceedEnabled) {
          stepAutoProceed[String(flatOrder)] = {
            enabled: true,
            days: Math.max(1, Math.min(365, Number(st.autoProceedDays || 1))),
          };
        }
      });
    });

    const apiSteps = flattenedApprovers.map((ap, idx) => ({
      step_order: idx + 1,
      step_role:
        idx === flattenedApprovers.length - 1 ? "FINAL_APPROVER" : "REVIEWER",
      approver_id: ap.id,
      approver_name: ap.name,
      approver_dept: ap.dept,
      approver_rank: ap.rank_code,
      approver_title: ap.job_title,
    }));

    const fullContent = [
      reason.trim() ? `[휴가 사유]\n${reason.trim()}` : "",
      `[상세 일정 (${usageSummary.label} / ${usageSummary.totalDays}일)]\n${scheduleDetailLines.join(
        "\n"
      )}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    setSubmitting(true);
    try {
      await hqFetch("/api/hq/approvals", {
        method: "POST",
        body: {
          doc_type: "LEAVE",
          title: `[${resolvedLeaveTypeLabel}] ${me.name} 휴가 신청 (${effStart}${
            effEnd !== effStart ? ` ~ ${effEnd}` : ""
          } · ${usageSummary.label})`,
          content: fullContent,
          effective_date: effStart,
          end_date: effEnd,
          leave_type: resolvedLeaveTypeLabel,
          leave_days: usageSummary.totalDays,
          allow_zero_steps: apiSteps.length === 0,
          is_auto_delegated: autoDelegated,
          steps: apiSteps,
          workflow_meta: {
            form_id:
              leaveKind.type === "ANNUAL"
                ? annualPolicy?.policy_id || "lv-annual"
                : leaveKind.item.policy_id,
            form_title: resolvedLeaveTypeLabel,
            form_icon:
              leaveKind.type === "ANNUAL" ? "🏖️" : leaveKind.item.icon || "🌿",
            cc_member_ids: ccList
              .map((c) => c.id)
              .filter((id) => !id.startsWith("name:")),
            cc_member_names: ccList.map((c) => c.name),
            field_values: {
              schedule_summary: `${formatDateRangeHeading(
                effStart,
                effEnd
              )} (${usageSummary.label})`,
            },
            field_labels: {
              schedule_summary: "휴가 일정",
            },
            step_auto_proceed: stepAutoProceed,
            attachments: [],
          },
        },
      });

      window.dispatchEvent(new Event("hq:approval-updated"));
      await Promise.all([
        refreshMembers(),
        refreshApprovalBadge(),
        refreshAttendanceState(),
      ]);
      if (onSubmitted) await onSubmitted();
      onClose();
    } catch (err: any) {
      alert(err?.message || "휴가 등록 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  // 현재 피커에서 선택된 목록
  const pickerSelectedPreview =
    pickerContext?.kind === "CC"
      ? ccList.map((c) => ({ id: c.id, name: c.name }))
      : pickerContext?.kind === "STEP"
        ? (
            approvalSteps.find((s) => s.id === pickerContext.stepId)
              ?.assignees || []
          ).map((a) => ({ id: a.id, name: a.name }))
        : [];

  const filteredPickerMembers = activeMembers.filter((m) => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      (m.department || "").toLowerCase().includes(q)
    );
  });

  const startOptionsMin: number[] = [];
  for (let m = 7 * 60 + 30; m <= 20 * 60; m += 30) {
    startOptionsMin.push(m);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-4"
      onMouseDown={handleCloseAttempt}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          setInfoPopoverOpen(false);
          setKindMenuOpen(false);
          setFloatingDropdown(null);
          setNotifyMenuTargetId(null);
          setAutoProceedMenuStepId(null);
        }}
        className={`bg-white rounded-3xl border border-slate-200/90 shadow-2xl w-full transition-all duration-200 relative overflow-visible flex flex-col lg:flex-row ${
          stepView === "CONFIRM" && linePanelOpen
            ? "max-w-[920px] min-h-[600px]"
            : "max-w-[580px] min-h-[580px]"
        }`}
      >
        {/* =================================================================
            좌측 메인 영역 (Step 1: 달력 선택 / Step 2: 휴가를 등록할까요?)
           ================================================================= */}
        <div className="flex-1 flex flex-col justify-between p-6 sm:p-8 relative min-w-0">
          <div>
            {/* 상단 휴가 종류 배지 + 닫기 ✕ */}
            <div className="flex items-center justify-between gap-2 relative">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setKindMenuOpen(false);
                    setInfoPopoverOpen((v) => !v);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-xs transition-colors"
                >
                  <span>
                    {leaveKind.type === "ANNUAL"
                      ? "🏖️"
                      : leaveKind.item.icon || "🌿"}
                  </span>
                  <span className="font-extrabold text-slate-700">
                    {leaveKind.type === "ANNUAL" ? "연차" : leaveKind.item.name}
                  </span>
                  <span className="text-slate-400 font-semibold">
                    {leaveKind.type === "ANNUAL"
                      ? `${resolvedAvailableAnnualDays}일 사용 가능 · 유급`
                      : `${
                          leaveKind.item.grant_amount
                            ? `${leaveKind.item.grant_amount}일 기준 · `
                            : ""
                        }${leaveKind.item.pay_type}`}
                  </span>
                </button>

                {allowSwitchLeaveKind && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInfoPopoverOpen(false);
                        setKindMenuOpen((v) => !v);
                      }}
                      className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-bold text-slate-500"
                    >
                      변경 ▾
                    </button>

                    {kindMenuOpen && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute left-0 top-8 z-40 w-56 max-h-64 overflow-y-auto custom-scroll rounded-2xl bg-white border border-slate-200 shadow-2xl py-1.5 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const next: LeaveRegisterKind = { type: "ANNUAL" };
                            setLeaveKind(next);
                            syncApprovalLineFromKind(next);
                            setKindMenuOpen(false);
                          }}
                          className={`w-full px-3.5 py-2 text-left font-bold flex items-center justify-between hover:bg-slate-50 ${
                            leaveKind.type === "ANNUAL"
                              ? "text-[#00a84b]"
                              : "text-slate-800"
                          }`}
                        >
                          <span>🏖️ 연차 ({resolvedAvailableAnnualDays}일)</span>
                          {leaveKind.type === "ANNUAL" && <span>✓</span>}
                        </button>
                        <div className="my-1 border-t border-slate-100" />
                        {eligibleCustomLeaves.map((cl) => (
                          <button
                            key={cl.id}
                            type="button"
                            onClick={() => {
                              const next: LeaveRegisterKind = {
                                type: "CUSTOM",
                                item: cl,
                              };
                              setLeaveKind(next);
                              syncApprovalLineFromKind(next);
                              setKindMenuOpen(false);
                            }}
                            className={`w-full px-3.5 py-2 text-left font-semibold flex items-center justify-between hover:bg-slate-50 ${
                              leaveKind.type === "CUSTOM" &&
                              leaveKind.item.id === cl.id
                                ? "text-[#00a84b] font-bold"
                                : "text-slate-700"
                            }`}
                          >
                            <span>
                              {cl.icon} {cl.name}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {cl.pay_type}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {!(stepView === "CONFIRM" && linePanelOpen) && (
                <button
                  type="button"
                  onClick={handleCloseAttempt}
                  className="w-7 h-7 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-xs font-bold"
                >
                  ✕
                </button>
              )}

              {/* 연차 잔여/유효기간 안내 팝오버 (Screenshots 100459 & 100505) */}
              {infoPopoverOpen && leaveKind.type === "ANNUAL" && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute left-0 top-9 z-40 w-[330px] sm:w-[360px] max-h-[400px] overflow-y-auto custom-scroll rounded-2xl bg-white border border-slate-200 shadow-2xl p-5 text-xs space-y-3"
                >
                  <div className="text-[15px] font-extrabold text-slate-900">
                    연차가 {resolvedAvailableAnnualDays}일 남았어요.
                  </div>
                  <div className="space-y-1 text-slate-500 font-medium">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#00c73c] font-bold">✓</span>
                      <span>유급휴가. 일한 날과 같은 임금을 받을 수 있어요.</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#00c73c] font-bold">✓</span>
                      <span>
                        {annualPolicy?.hourly_sub_unit || "2시간"} 단위부터 쓸 수
                        있어요.
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#00c73c] font-bold">✓</span>
                      <span>캘린더에 &quot;휴가&quot;로 표시돼요.</span>
                    </div>
                  </div>

                  {grantBreakdownItems.accrued.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      {grantBreakdownItems.accrued.map((g, idx) => (
                        <div
                          key={idx}
                          className="text-[11.5px] flex flex-wrap items-center gap-1.5"
                        >
                          <span className="font-bold text-slate-800">
                            · {g.grantLabel}에 받은{" "}
                            <span className="text-[#00b84f]">{g.days}일</span>
                          </span>
                          <span className="text-slate-400">
                            유효기간 {g.expireLabel}
                          </span>
                        </div>
                      ))}
                      {grantBreakdownItems.upcoming &&
                        annualPolicy?.advance_use_enabled && (
                          <div className="text-[11.5px] font-bold text-slate-800">
                            · {grantBreakdownItems.upcoming}에 받을 휴가{" "}
                            <span className="text-[#00b84f]">1일</span> 당겨쓰기
                            가능
                          </div>
                        )}
                    </div>
                  )}

                  {annualPolicy?.advance_use_enabled && (
                    <div className="p-3 rounded-xl bg-slate-50 text-[11px] text-slate-500 leading-relaxed space-y-1">
                      <div className="font-bold text-slate-600">
                        연차 당겨쓰기가 무엇인가요?
                      </div>
                      <p>
                        휴가를 사용해야 하는데 가진 연차를 모두 소진한 경우, 다음에
                        부여받을 연차를 미리 당겨쓸 수 있어요. 당겨쓴 연차는{" "}
                        <b className="text-slate-700">
                          구성원이 다음 부여일에 받을 연차 개수에서 차감돼요.
                        </b>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {stepView === "CALENDAR" ? (
              /* ==================== STEP 1: 2개월 달력 선택 ==================== */
              <>
                <div className="mt-4">
                  <h3 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
                    {formatDateRangeHeading(pickStart, pickEnd)}
                  </h3>
                  {pickStart && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                      {workingDates.length > 0 ? (
                        <>
                          <span>
                            총 {workingDates.length}일 선택 ({usageSummary.label}{" "}
                            사용)
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setInfoPopoverOpen((v) => !v);
                            }}
                            className="text-slate-300 hover:text-slate-500 text-xs"
                            title="연차 잔여 및 차감 기준 보기"
                          >
                            ⓘ
                          </button>
                        </>
                      ) : (
                        <span className="text-amber-600 font-bold">
                          선택한 날짜는 주말 또는 공휴일입니다. 평일 근무일을 선택해 주세요.
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 좌·우 2개월 달력 */}
                <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-7">
                  {[calBaseYm, secondMonthYm].map((ymObj, calIdx) => {
                    const cells = buildCalendarMonthCells(
                      ymObj.year,
                      ymObj.month
                    );
                    return (
                      <div key={`${ymObj.year}-${ymObj.month}`}>
                        <div className="flex items-center justify-between mb-3 px-1">
                          {calIdx === 0 ? (
                            <button
                              type="button"
                              onClick={() => shiftCalMonth(-1)}
                              className="w-6 h-6 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-800 text-sm font-bold"
                            >
                              ‹
                            </button>
                          ) : (
                            <span className="w-6" />
                          )}

                          <span className="text-[13px] font-extrabold text-slate-800">
                            {ymObj.year}년 {ymObj.month}월
                          </span>

                          {calIdx === 1 ? (
                            <button
                              type="button"
                              onClick={() => shiftCalMonth(1)}
                              className="w-6 h-6 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-800 text-sm font-bold"
                            >
                              ›
                            </button>
                          ) : (
                            <span className="w-6" />
                          )}
                        </div>

                        <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-slate-300 mb-1.5">
                          {WEEKDAY_HEADER.map((w) => (
                            <div key={w} className="py-1">
                              {w}
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-y-1 text-center">
                          {cells.map((c) => {
                            if (!c.inMonth) {
                              return (
                                <div
                                  key={c.ymd}
                                  className="h-9 flex items-center justify-center text-xs text-slate-300"
                                >
                                  {calIdx === 1 ? c.day : ""}
                                </div>
                              );
                            }

                            const effEnd = pickEnd || pickStart;
                            const isEndpoint =
                              Boolean(pickStart) &&
                              (c.ymd === pickStart || c.ymd === effEnd);
                            const isInBetween =
                              Boolean(pickStart) &&
                              c.ymd > pickStart &&
                              c.ymd < effEnd;
                            const isToday = c.ymd === todayYmd;
                            const isOff =
                              c.dow === 0 ||
                              c.dow === 6 ||
                              holidaySet.has(c.ymd);

                            return (
                              <button
                                key={c.ymd}
                                type="button"
                                onClick={() => handleCalendarDayClick(c.ymd)}
                                className={`h-9 w-full rounded-lg text-[13px] transition-colors flex items-center justify-center tabular-nums ${
                                  isEndpoint
                                    ? "bg-[#00c73c] text-white font-extrabold shadow-xs"
                                    : isInBetween
                                      ? isOff
                                        ? "bg-[#ecf9f0] text-slate-300 font-semibold rounded-none"
                                        : "bg-[#ecf9f0] text-emerald-900 font-bold rounded-none"
                                      : isToday
                                        ? "text-[#00c73c] font-extrabold hover:bg-emerald-50"
                                        : isOff
                                          ? "text-slate-300 hover:bg-slate-50 font-medium"
                                          : "text-slate-800 hover:bg-slate-100 font-semibold"
                                }`}
                              >
                                {c.day}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              /* ==================== STEP 2: 휴가를 등록할까요? ==================== */
              <div className="mt-4 space-y-6">
                <h3 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
                  휴가를 등록할까요?
                </h3>

                {/* 선택한 날짜 요약 카드 + 다시 선택하기 › */}
                <div className="rounded-2xl border border-slate-200 px-5 py-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[14px] font-extrabold text-slate-800">
                      {formatDateRangeHeading(
                        workingDates[0] || pickStart,
                        workingDates[workingDates.length - 1] || pickEnd
                      )}
                    </div>
                    <div className="text-xs text-slate-400 font-semibold mt-0.5">
                      {usageSummary.label}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStepView("CALENDAR")}
                    className="text-xs font-bold text-slate-500 hover:text-slate-900 shrink-0 flex items-center gap-1"
                  >
                    <span>다시 선택하기</span>
                    <span>›</span>
                  </button>
                </div>

                {/* 사유 입력 (부재중 인수인계자 문구 완전 제거) */}
                <div>
                  <label className="block text-[13px] font-extrabold text-slate-800 mb-2">
                    사유
                  </label>
                  <textarea
                    rows={4}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="휴가 사용 기록에 남길 수 있어요."
                    className="w-full px-1 py-1 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 하단 버튼 영역 */}
          <div className="pt-6 space-y-3.5">
            {stepView === "CALENDAR" ? (
              <>
                {workingDates.length > 0 && leaveKind.type === "ANNUAL" && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => setDetailSheetOpen(true)}
                      className="px-4 py-2 rounded-xl hover:bg-slate-100 text-xs font-bold text-slate-600 flex items-center gap-1.5 transition-colors"
                    >
                      <span>상세 일정 편집이 필요한가요?</span>
                      <span className="text-slate-400">›</span>
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  disabled={workingDates.length === 0}
                  onClick={() => setStepView("CONFIRM")}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00bfa5] hover:brightness-95 text-white text-[13px] font-extrabold shadow-md disabled:opacity-35 transition-all"
                >
                  다음
                </button>
              </>
            ) : (
              <>
                {autoDelegated && delegationReason && (
                  <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-800 text-center">
                    ⚡ {delegationReason}
                  </div>
                )}
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setLinePanelOpen((v) => !v)}
                    className="px-3 py-1.5 rounded-lg hover:bg-slate-50 text-xs font-bold text-slate-600 flex items-center gap-1"
                  >
                    <span>{lineSummaryText}</span>
                    <span className="text-slate-400">›</span>
                  </button>
                </div>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmit}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00bfa5] hover:brightness-95 text-white text-[13px] font-extrabold shadow-md disabled:opacity-50 transition-all"
                >
                  {submitting ? "요청 처리 중..." : "승인 요청하기"}
                </button>
              </>
            )}
          </div>

          {/* =================================================================
              슬라이드업 시트: 상세 일정 편집 (반반차 2시간 / 시간차 / 반차 / 휴게시간)
             ================================================================= */}
          {detailSheetOpen && (
            <div
              onClick={() => setFloatingDropdown(null)}
              className="absolute inset-0 z-30 bg-slate-900/20 rounded-3xl flex flex-col justify-end"
            >
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setFloatingDropdown(null);
                }}
                className="bg-white rounded-3xl border-t border-slate-200 shadow-2xl max-h-[78%] flex flex-col relative"
              >
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h4 className="text-[14px] font-extrabold text-slate-900">
                    상세 일정 편집
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailSheetOpen(false);
                      setFloatingDropdown(null);
                    }}
                    className="w-7 h-7 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-xs font-bold"
                  >
                    ✕
                  </button>
                </div>

                <div
                  onScroll={() => setFloatingDropdown(null)}
                  className="flex-1 overflow-y-auto custom-scroll px-6 py-5 space-y-6 text-xs"
                >
                  {workingDates.map((ymd, idx) => {
                    const sc = daySchedules[ymd] || {
                      ymd,
                      mode: "FULL" as const,
                      startMin: 540,
                      endMin: 1080,
                      includeBreak: true,
                    };
                    const isFull = sc.mode === "FULL";
                    const modeKey = `mode-${ymd}`;
                    const startKey = `start-${ymd}`;
                    const endKey = `end-${ymd}`;

                    return (
                      <div key={ymd} className="space-y-2 relative">
                        <div className="font-bold text-slate-700">
                          {idx + 1}. {formatKoreanFullDateWithDow(ymd)}
                        </div>

                        <div className="flex items-center gap-2">
                          {/* 1) 종일 / 오전반차 / 오후반차 / 시간차 드롭다운 */}
                          <div className="relative w-36 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const r =
                                  e.currentTarget.getBoundingClientRect();
                                setFloatingDropdown((prev) =>
                                  prev?.key === modeKey
                                    ? null
                                    : {
                                        key: modeKey,
                                        ymd,
                                        kind: "MODE",
                                        rect: {
                                          top: r.top,
                                          bottom: r.bottom,
                                          left: r.left,
                                          right: r.right,
                                          width: r.width,
                                        },
                                      }
                                );
                              }}
                              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-800 flex items-center justify-between hover:border-slate-300"
                            >
                              <span>
                                {sc.mode === "FULL"
                                  ? "하루 종일"
                                  : sc.mode === "AM_HALF"
                                    ? "오전 반차"
                                    : sc.mode === "PM_HALF"
                                      ? "오후 반차"
                                      : "시간차"}
                              </span>
                              <span className="text-slate-400 text-[10px]">
                                ▾
                              </span>
                            </button>
                          </div>

                          {/* 2) 시작 시간 / 종료 시간 결합 박스 */}
                          <div className="flex-1 grid grid-cols-2 rounded-xl border border-slate-200 bg-white relative">
                            {/* 시작 시간 */}
                            <div className="relative border-r border-slate-200">
                              <button
                                type="button"
                                disabled={isFull}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const r =
                                    e.currentTarget.getBoundingClientRect();
                                  setCustomTimeText(minutesToHm24(sc.startMin));
                                  setFloatingDropdown((prev) =>
                                    prev?.key === startKey
                                      ? null
                                      : {
                                          key: startKey,
                                          ymd,
                                          kind: "START",
                                          rect: {
                                            top: r.top,
                                            bottom: r.bottom,
                                            left: r.left,
                                            right: r.right,
                                            width: r.width,
                                          },
                                        }
                                  );
                                }}
                                className="w-full px-3 py-2.5 text-left font-semibold flex items-center justify-between disabled:bg-slate-50/70 disabled:text-slate-300 text-slate-800"
                              >
                                <span>
                                  {isFull
                                    ? "시작 시간"
                                    : minutesToKoreanAmPm(sc.startMin)}
                                </span>
                                <span className="text-[10px] text-slate-300">
                                  ▾
                                </span>
                              </button>
                            </div>

                            {/* 종료 시간 */}
                            <div className="relative">
                              <button
                                type="button"
                                disabled={isFull}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const r =
                                    e.currentTarget.getBoundingClientRect();
                                  setCustomTimeText(minutesToHm24(sc.endMin));
                                  setFloatingDropdown((prev) =>
                                    prev?.key === endKey
                                      ? null
                                      : {
                                          key: endKey,
                                          ymd,
                                          kind: "END",
                                          rect: {
                                            top: r.top,
                                            bottom: r.bottom,
                                            left: r.left,
                                            right: r.right,
                                            width: r.width,
                                          },
                                        }
                                  );
                                }}
                                className="w-full px-3 py-2.5 text-left font-semibold flex items-center justify-between disabled:bg-slate-50/70 disabled:text-slate-300 text-slate-800"
                              >
                                <span>
                                  {isFull
                                    ? "종료 시간"
                                    : minutesToKoreanAmPm(sc.endMin)}
                                </span>
                                <span className="text-[10px] text-slate-300">
                                  ▾
                                </span>
                              </button>
                            </div>
                          </div>

                          {/* 3) 커피컵 휴게시간 토글 버튼 (Screenshots 100631 ~ 100653) */}
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              disabled={isFull}
                              onClick={() => toggleDayBreak(ymd)}
                              title={
                                sc.includeBreak
                                  ? "휴게 시간을 포함했어요. (1시간)"
                                  : "휴게 시간을 포함하지 않았어요."
                              }
                              className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-colors ${
                                sc.includeBreak
                                  ? "border-[#00c73c] bg-emerald-50/40 text-[#00c73c]"
                                  : "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                              } disabled:cursor-default`}
                            >
                              <CoffeeCupIcon
                                filled={sc.includeBreak}
                                withPlus={!sc.includeBreak}
                              />
                            </button>

                            {breakToastForYmd?.ymd === ymd && (
                              <div className="absolute right-0 -top-10 z-50 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-[11px] font-bold whitespace-nowrap shadow-lg">
                                {breakToastForYmd.text}
                              </div>
                            )}
                          </div>
                        </div>

                        {sc.mode === "HOURLY" && (
                          <div className="pl-38 text-[11px] text-slate-400 font-semibold">
                            {annualPolicy?.hourly_sub_unit || "2시간"} 단위로
                            입력할 수 있어요. ({calcDayNetHours(sc)}시간 ={" "}
                            {roundLeave4(calcDayNetHours(sc) / 8)}일 차감)
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="px-6 py-4 border-t border-slate-100 flex justify-end shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setDetailSheetOpen(false);
                      setFloatingDropdown(null);
                    }}
                    className="px-5 py-2.5 rounded-xl bg-[#00c73c] hover:brightness-95 text-white text-xs font-extrabold"
                  >
                    적용 완료 ({usageSummary.label})
                  </button>
                </div>

                {/* =============================================================
                    플로팅 드롭다운 오버레이 (스크롤 내부에 가려지지 않고 모달 위로 부상!)
                   ============================================================= */}
                {floatingDropdown &&
                  (() => {
                    const activeYmd = floatingDropdown.ymd;
                    const activeSc = daySchedules[activeYmd] || {
                      ymd: activeYmd,
                      mode: "FULL" as const,
                      startMin: 540,
                      endMin: 1080,
                      includeBreak: true,
                    };
                    const viewportH =
                      typeof window !== "undefined" ? window.innerHeight : 900;
                    const viewportW =
                      typeof window !== "undefined" ? window.innerWidth : 1280;
                    const estHeight =
                      floatingDropdown.kind === "MODE" ? 184 : 268;
                    const openUpward =
                      floatingDropdown.rect.bottom + estHeight > viewportH - 16;
                    const posStyle: React.CSSProperties = openUpward
                      ? {
                          position: "fixed",
                          bottom: Math.max(
                            12,
                            viewportH - floatingDropdown.rect.top + 6
                          ),
                          left:
                            floatingDropdown.kind === "END"
                              ? Math.max(
                                  12,
                                  Math.min(
                                    viewportW - 252,
                                    floatingDropdown.rect.right - 240
                                  )
                                )
                              : Math.max(
                                  12,
                                  Math.min(
                                    viewportW - 240,
                                    floatingDropdown.rect.left
                                  )
                                ),
                        }
                      : {
                          position: "fixed",
                          top: floatingDropdown.rect.bottom + 6,
                          left:
                            floatingDropdown.kind === "END"
                              ? Math.max(
                                  12,
                                  Math.min(
                                    viewportW - 252,
                                    floatingDropdown.rect.right - 240
                                  )
                                )
                              : Math.max(
                                  12,
                                  Math.min(
                                    viewportW - 240,
                                    floatingDropdown.rect.left
                                  )
                                ),
                        };

                    if (floatingDropdown.kind === "MODE") {
                      return (
                        <div
                          style={posStyle}
                          onClick={(e) => e.stopPropagation()}
                          className="z-[150] w-44 rounded-2xl bg-white border border-slate-200/90 shadow-[0_14px_38px_rgba(15,23,42,0.16)] py-1.5 text-xs"
                        >
                          {(
                            [
                              { key: "FULL", label: "하루 종일" },
                              { key: "AM_HALF", label: "오전 반차" },
                              { key: "PM_HALF", label: "오후 반차" },
                              { key: "HOURLY", label: "시간차" },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.key}
                              type="button"
                              onClick={() => updateDayMode(activeYmd, opt.key)}
                              className="w-full px-4 py-2.5 text-left font-bold text-slate-800 hover:bg-slate-50 flex items-center justify-between"
                            >
                              <span>{opt.label}</span>
                              {activeSc.mode === opt.key && (
                                <span className="text-[#00c73c] font-extrabold">
                                  ✓
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      );
                    }

                    if (floatingDropdown.kind === "START") {
                      return (
                        <div
                          style={posStyle}
                          onClick={(e) => e.stopPropagation()}
                          className="z-[150] w-56 rounded-2xl bg-white border border-slate-200/90 shadow-[0_14px_38px_rgba(15,23,42,0.16)] p-2 space-y-1 text-xs"
                        >
                          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[#00c73c]">
                            <span className="text-slate-400">🕒</span>
                            <input
                              value={customTimeText}
                              onChange={(e) =>
                                setCustomTimeText(e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const parsed =
                                    parseHmInputToMinutes(customTimeText);
                                  if (parsed !== null) {
                                    updateDayStartMin(activeYmd, parsed);
                                  }
                                }
                              }}
                              placeholder="시간 입력 (예: 09:00)"
                              className="w-full text-xs font-bold text-slate-800 focus:outline-none"
                            />
                          </div>
                          <div className="max-h-48 overflow-y-auto custom-scroll py-1">
                            {startOptionsMin.map((mVal) => (
                              <button
                                key={mVal}
                                type="button"
                                onClick={() =>
                                  updateDayStartMin(activeYmd, mVal)
                                }
                                className="w-full px-3 py-2 rounded-lg hover:bg-slate-50 text-left font-bold text-slate-800 flex items-center justify-between"
                              >
                                <span>{minutesToKoreanAmPm(mVal)}</span>
                                {activeSc.startMin === mVal && (
                                  <span className="text-[#00c73c]">✓</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    }

                    const endCandidates: { endMin: number; netHours: number }[] =
                      [];
                    const stepMin =
                      activeSc.mode === "HOURLY" ? hourlyUnitMinutes : 240;
                    for (
                      let netM = stepMin;
                      netM <= 8 * 60;
                      netM += stepMin
                    ) {
                      const candidateEnd =
                        activeSc.startMin +
                        netM +
                        (activeSc.includeBreak ? 60 : 0);
                      if (candidateEnd <= 23 * 60 + 30) {
                        endCandidates.push({
                          endMin: candidateEnd,
                          netHours: Math.round((netM / 60) * 100) / 100,
                        });
                      }
                    }
                    const dt = parseYmdLocal(activeYmd);
                    const mdLabel = `${dt.getMonth() + 1}월 ${dt.getDate()}일`;

                    return (
                      <div
                        style={posStyle}
                        onClick={(e) => e.stopPropagation()}
                        className="z-[150] w-60 rounded-2xl bg-white border border-slate-200/90 shadow-[0_14px_38px_rgba(15,23,42,0.16)] p-2 space-y-1 text-xs"
                      >
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[#00c73c]">
                          <span className="text-slate-400">🕒</span>
                          <input
                            value={customTimeText}
                            onChange={(e) => setCustomTimeText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const parsed =
                                  parseHmInputToMinutes(customTimeText);
                                if (
                                  parsed !== null &&
                                  parsed > activeSc.startMin
                                ) {
                                  updateDayEndMin(activeYmd, parsed);
                                }
                              }
                            }}
                            placeholder="시간 입력 (예: 11:00)"
                            className="w-full text-xs font-bold text-slate-800 focus:outline-none"
                          />
                        </div>
                        <div className="px-3 pt-1.5 pb-0.5 text-[11px] font-bold text-slate-400">
                          {mdLabel}
                        </div>
                        <div className="max-h-48 overflow-y-auto custom-scroll py-1">
                          {endCandidates.map((cand) => (
                            <button
                              key={cand.endMin}
                              type="button"
                              onClick={() =>
                                updateDayEndMin(activeYmd, cand.endMin)
                              }
                              className="w-full px-3 py-2 rounded-lg hover:bg-slate-50 text-left font-bold text-slate-800 flex items-center justify-between"
                            >
                              <span className="flex items-center gap-1.5">
                                <span>{minutesToKoreanAmPm(cand.endMin)}</span>
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                                  {cand.netHours}시간
                                </span>
                              </span>
                              {activeSc.endMin === cand.endMin && (
                                <span className="text-[#00c73c]">✓</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
              </div>
            </div>
          )}
        </div>

        {/* =================================================================
            우측 사이드 패널: 승인 · 참조 편집 (Screenshots 100757 ~ 100923)
           ================================================================= */}
        {stepView === "CONFIRM" && linePanelOpen && (
          <div className="w-full lg:w-[340px] border-t lg:border-t-0 lg:border-l border-slate-100 p-6 flex flex-col justify-between relative bg-white rounded-b-3xl lg:rounded-b-none lg:rounded-r-3xl">
            <div className="space-y-6">
              {/* 상단 헤더 */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setLinePanelOpen(false)}
                  className="inline-flex items-center gap-2 text-[13px] font-extrabold text-slate-800 hover:text-slate-600"
                >
                  <span className="text-slate-400 text-xs">«</span>
                  <span>승인 · 참조</span>
                </button>
                <button
                  type="button"
                  onClick={handleCloseAttempt}
                  className="w-7 h-7 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-xs font-bold"
                >
                  ✕
                </button>
              </div>

              {/* 1) 참조 섹션 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 shrink-0">
                    참조
                  </span>
                  <div className="flex-1 h-px bg-slate-100" />
                  {allowLineEdit && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPickerSearch("");
                        setPickerContext(
                          pickerContext?.kind === "CC" ? null : { kind: "CC" }
                        );
                      }}
                      title="참조자 추가하기"
                      className="w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 font-bold flex items-center justify-center text-sm"
                    >
                      +
                    </button>
                  )}
                </div>

                {ccList.length === 0 ? (
                  <div className="text-xs text-slate-400 py-1">
                    지정된 참조 대상이 없습니다.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {ccList.map((cc) => (
                      <div
                        key={cc.id}
                        className="flex items-center justify-between gap-2 group relative"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            style={{ backgroundColor: avatarColor(cc.name) }}
                            className="w-8 h-8 rounded-xl text-white text-[11px] font-extrabold flex items-center justify-center shrink-0"
                          >
                            {cc.name.slice(-2)}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-extrabold text-slate-900 truncate">
                              {cc.name}
                            </div>
                            {cc.dept && (
                              <div className="text-[11px] text-slate-400 truncate">
                                {cc.dept}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0 relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setNotifyMenuTargetId(
                                notifyMenuTargetId === cc.id ? null : cc.id
                              );
                            }}
                            className="px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50/40 text-blue-600 text-[11px] font-bold flex items-center gap-1"
                          >
                            <span>🔔</span>
                            <span>
                              {cc.notifyMode === "NONE" ? "알림 없음" : "알림"}
                            </span>
                            <span className="text-[9px]">▾</span>
                          </button>

                          {allowLineEdit && (
                            <button
                              type="button"
                              onClick={() =>
                                setCcList((prev) =>
                                  prev.filter((x) => x.id !== cc.id)
                                )
                              }
                              title="참조 제외"
                              className="w-5 h-5 rounded hover:bg-rose-50 text-slate-300 hover:text-rose-500 text-[11px] font-bold"
                            >
                              ✕
                            </button>
                          )}

                          {/* 알림 설정 드롭다운 (Screenshot 100837) */}
                          {notifyMenuTargetId === cc.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-8 z-50 w-52 rounded-2xl bg-white border border-slate-200 shadow-2xl py-2 text-xs"
                            >
                              <div className="px-3.5 py-1 text-[10px] font-bold text-slate-400">
                                알림 설정
                              </div>
                              {(
                                [
                                  {
                                    mode: "BOTH",
                                    label: "승인 요청, 완료 시 알림",
                                  },
                                  {
                                    mode: "COMPLETE_ONLY",
                                    label: "승인 완료 시 알림",
                                  },
                                  { mode: "NONE", label: "알림 없음" },
                                ] as const
                              ).map((opt) => (
                                <button
                                  key={opt.mode}
                                  type="button"
                                  onClick={() => {
                                    setCcList((prev) =>
                                      prev.map((x) =>
                                        x.id === cc.id
                                          ? { ...x, notifyMode: opt.mode }
                                          : x
                                      )
                                    );
                                    setNotifyMenuTargetId(null);
                                  }}
                                  className="w-full px-3.5 py-2 text-left font-bold text-slate-800 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  <span className="w-3.5 text-[#00c73c]">
                                    {cc.notifyMode === opt.mode ? "✓" : ""}
                                  </span>
                                  <span>{opt.label}</span>
                                </button>
                              ))}
                              <div className="mt-1 pt-2 px-3.5 border-t border-slate-100 text-[10.5px] text-slate-400">
                                ⓘ 댓글 알림은 설정과 관계없이 수신돼요.
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2) 승인 단계 섹션 */}
              <div className="space-y-3">
                {approvalSteps.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const newId = `step-1-${Date.now()}`;
                      setApprovalSteps([
                        {
                          id: newId,
                          assignees: [],
                          autoProceedEnabled: false,
                          autoProceedDays: 1,
                        },
                      ]);
                    }}
                    className="w-full py-3 rounded-xl bg-[#f1f5f9] hover:bg-slate-200/70 text-[#1d4ed8] text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span>✍️</span>
                    <span>승인 추가하기</span>
                  </button>
                ) : (
                  <div className="space-y-3">
                    {approvalSteps.map((st, sIdx) => (
                      <div
                        key={st.id}
                        className="p-2.5 rounded-2xl hover:bg-slate-50/80 transition-colors space-y-2.5 group relative"
                      >
                        <div className="flex items-center gap-2 relative">
                          <span className="text-xs font-bold text-slate-500 shrink-0">
                            {sIdx + 1} 단계 승인
                          </span>

                          {/* 플렉스 자동 진행 설정 버튼 + 팝오버 (Screenshots 104045 & 104126) */}
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setNotifyMenuTargetId(null);
                                setAutoProceedMenuStepId((prev) =>
                                  prev === st.id ? null : st.id
                                );
                              }}
                              className={`px-2 py-1 rounded-lg text-[11px] transition-colors ${
                                st.autoProceedEnabled
                                  ? "bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold"
                                  : "border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-bold"
                              }`}
                            >
                              {st.autoProceedEnabled
                                ? `자동 진행 D+${st.autoProceedDays || 1}`
                                : "자동 진행"}
                            </button>

                            {autoProceedMenuStepId === st.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute left-0 top-8 z-[140] w-[236px] rounded-2xl bg-white border border-slate-200/90 shadow-[0_14px_38px_rgba(15,23,42,0.16)] overflow-hidden text-xs"
                              >
                                <div className="px-4 py-3.5 flex items-center justify-between gap-2">
                                  <span className="text-[13px] font-extrabold text-slate-900">
                                    자동 진행 설정
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setApprovalSteps((prev) =>
                                        prev.map((x) =>
                                          x.id === st.id
                                            ? {
                                                ...x,
                                                autoProceedEnabled:
                                                  !x.autoProceedEnabled,
                                                autoProceedDays:
                                                  x.autoProceedDays || 1,
                                              }
                                            : x
                                        )
                                      )
                                    }
                                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                                      st.autoProceedEnabled
                                        ? "bg-[#16cc3b]"
                                        : "bg-slate-300"
                                    }`}
                                  >
                                    <span
                                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                                        st.autoProceedEnabled
                                          ? "translate-x-5"
                                          : "translate-x-0"
                                      }`}
                                    />
                                  </button>
                                </div>

                                {!st.autoProceedEnabled ? (
                                  <div className="px-4 pb-4 text-[11.5px] text-slate-400 leading-relaxed font-medium">
                                    일정 기간이 지난 후에 자동으로 승인되도록
                                    설정할 수 있어요.
                                  </div>
                                ) : (
                                  <>
                                    <div className="border-t border-slate-100 py-1.5">
                                      {[1, 3, 5, 7].map((dVal) => {
                                        const active =
                                          (st.autoProceedDays || 1) === dVal;
                                        return (
                                          <button
                                            key={dVal}
                                            type="button"
                                            onClick={() =>
                                              setApprovalSteps((prev) =>
                                                prev.map((x) =>
                                                  x.id === st.id
                                                    ? {
                                                        ...x,
                                                        autoProceedDays: dVal,
                                                      }
                                                    : x
                                                )
                                              )
                                            }
                                            className="w-full px-4 py-2 text-left text-[13px] font-bold text-slate-800 hover:bg-slate-50 flex items-center justify-between"
                                          >
                                            <span>{dVal}일 후</span>
                                            {active && (
                                              <span className="text-[#16cc3b] font-extrabold">
                                                ✓
                                              </span>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>

                                    <div className="border-t border-slate-100 px-4 py-3 space-y-2">
                                      <div className="text-[11px] font-bold text-slate-400">
                                        직접 입력
                                      </div>
                                      <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-slate-200 bg-white focus-within:border-[#16cc3b]">
                                        <input
                                          type="number"
                                          min={1}
                                          max={365}
                                          value={st.autoProceedDays || 1}
                                          onChange={(e) => {
                                            const n = Math.max(
                                              1,
                                              Math.min(
                                                365,
                                                Math.round(
                                                  Number(e.target.value) || 1
                                                )
                                              )
                                            );
                                            setApprovalSteps((prev) =>
                                              prev.map((x) =>
                                                x.id === st.id
                                                  ? {
                                                      ...x,
                                                      autoProceedDays: n,
                                                    }
                                                  : x
                                              )
                                            );
                                          }}
                                          className="w-full text-[13px] font-bold text-slate-900 focus:outline-none tabular-nums"
                                        />
                                        <span className="text-xs font-semibold text-slate-400 shrink-0 ml-2">
                                          일 후
                                        </span>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex-1 h-px bg-slate-100" />
                          <button
                            type="button"
                            onClick={() => {
                              setApprovalSteps((prev) =>
                                prev.filter((x) => x.id !== st.id)
                              );
                              if (autoProceedMenuStepId === st.id) {
                                setAutoProceedMenuStepId(null);
                              }
                              if (
                                pickerContext?.kind === "STEP" &&
                                pickerContext.stepId === st.id
                              ) {
                                setPickerContext(null);
                              }
                            }}
                            title="단계 삭제하기"
                            className="w-6 h-6 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 text-rose-500 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            🗑️
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPickerSearch("");
                              setPickerContext(
                                pickerContext?.kind === "STEP" &&
                                  pickerContext.stepId === st.id
                                  ? null
                                  : { kind: "STEP", stepId: st.id }
                              );
                            }}
                            title="승인자 추가하기"
                            className="w-6 h-6 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 font-bold flex items-center justify-center text-sm"
                          >
                            +
                          </button>
                        </div>

                        {st.assignees.length === 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPickerSearch("");
                              setPickerContext({ kind: "STEP", stepId: st.id });
                            }}
                            className="w-full flex items-center gap-2.5 text-left py-1"
                          >
                            <span className="w-8 h-8 rounded-xl bg-slate-200/80 text-white font-bold flex items-center justify-center text-base">
                              +
                            </span>
                            <div>
                              <div className="text-xs font-extrabold text-slate-800">
                                추가하기
                              </div>
                              <div className="text-[11px] text-slate-400">
                                승인자를 추가해 주세요.
                              </div>
                            </div>
                          </button>
                        ) : (
                          <div className="space-y-2">
                            {st.assignees.map((ap) => (
                              <div
                                key={ap.id}
                                className="flex items-center justify-between gap-2"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span
                                    style={{
                                      backgroundColor: avatarColor(ap.name),
                                    }}
                                    className="w-8 h-8 rounded-xl text-white text-[11px] font-extrabold flex items-center justify-center shrink-0"
                                  >
                                    {ap.name.slice(-2)}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-xs font-extrabold text-slate-900 truncate">
                                      {ap.name}
                                    </div>
                                    <div className="text-[11px] text-slate-400 truncate">
                                      {ap.dept}
                                    </div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setApprovalSteps((prev) =>
                                      prev.map((x) =>
                                        x.id === st.id
                                          ? {
                                              ...x,
                                              assignees: x.assignees.filter(
                                                (a) => a.id !== ap.id
                                              ),
                                            }
                                          : x
                                      )
                                    )
                                  }
                                  className="w-5 h-5 rounded hover:bg-rose-50 text-slate-300 hover:text-rose-500 text-[11px] font-bold"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() =>
                        setApprovalSteps((prev) => [
                          ...prev,
                          {
                            id: `step-${prev.length + 1}-${Date.now()}`,
                            assignees: [],
                          },
                        ])
                      }
                      className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200/70 text-slate-800 text-xs font-extrabold flex items-center justify-center gap-1.5"
                    >
                      <span>+</span>
                      <span>승인 단계 추가하기</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ===============================================================
                참조 / 승인자 선택 플렉스 피커 팝오버 (Screenshot 100807)
               =============================================================== */}
            {pickerContext && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-4 lg:right-[330px] top-12 z-50 w-[340px] sm:w-[500px] h-[440px] rounded-2xl bg-white border border-slate-200 shadow-2xl flex overflow-hidden text-xs"
              >
                {/* 좌측: 검색 + 조직장 + 부서 + 구성원 목록 */}
                <div className="flex-1 flex flex-col border-r border-slate-100 min-w-0">
                  <div className="p-2.5 border-b border-slate-100 flex items-center gap-1.5">
                    <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[#00c73c]">
                      <span className="text-slate-400">🔍</span>
                      <input
                        autoFocus
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        placeholder="검색"
                        className="w-full text-xs font-semibold text-slate-800 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scroll p-2 space-y-3">
                    {!pickerSearch.trim() && (
                      <>
                        {/* 조직장 바로 선택 */}
                        <div className="space-y-1">
                          {[1, 2].map((lvl) => {
                            const badgeColors = [
                              "bg-[#00c73c]",
                              "bg-blue-500",
                            ];
                            return (
                              <button
                                key={lvl}
                                type="button"
                                onClick={() => {
                                  const head = resolveOrgHeadByLevel(lvl);
                                  if (head) {
                                    addMembersToPickerTarget([head]);
                                  } else {
                                    alert(
                                      `배정 가능한 ${lvl}차 조직장을 찾지 못했습니다.`
                                    );
                                  }
                                }}
                                className="w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 font-bold text-slate-800"
                              >
                                <span
                                  className={`w-5 h-5 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center ${
                                    badgeColors[lvl - 1]
                                  }`}
                                >
                                  {lvl}
                                </span>
                                <span>{lvl}차 조직장</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* 조직 단위 일괄 추가 */}
                        <div className="space-y-1">
                          <div className="px-2 text-[10px] font-bold text-slate-400">
                            조직
                          </div>
                          {registeredDepartments.map((deptName) => (
                            <button
                              key={deptName}
                              type="button"
                              onClick={() => {
                                const deptMembers = activeMembers.filter(
                                  (m) => m.department === deptName
                                );
                                addMembersToPickerTarget(deptMembers);
                              }}
                              className="w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 font-bold text-slate-800"
                            >
                              <span className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600 text-[10px] font-extrabold flex items-center justify-center">
                                品
                              </span>
                              <span>{deptName}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {/* 구성원 목록 */}
                    <div className="space-y-1">
                      <div className="px-2 text-[10px] font-bold text-slate-400">
                        구성원 목록
                      </div>
                      {filteredPickerMembers.map((m) => {
                        const checked = pickerSelectedPreview.some(
                          (s) => s.id === m.instructor_id || s.name === m.name
                        );
                        return (
                          <button
                            key={m.instructor_id}
                            type="button"
                            onClick={() => toggleSingleMemberInPicker(m)}
                            className="w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-2"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span
                                style={{ backgroundColor: avatarColor(m.name) }}
                                className="w-6 h-6 rounded-lg text-white text-[10px] font-extrabold flex items-center justify-center shrink-0"
                              >
                                {m.name.slice(-2)}
                              </span>
                              <span className="font-bold text-slate-800 truncate">
                                {m.name}
                              </span>
                              <span className="text-[11px] text-slate-400 truncate">
                                {m.department}
                              </span>
                            </span>
                            {checked && (
                              <span className="text-[#00c73c] font-extrabold">
                                ✓
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 우측: 선택된 대상 미리보기 */}
                <div className="w-[175px] hidden sm:flex flex-col justify-between p-3 bg-slate-50/40">
                  <div className="space-y-2 overflow-y-auto custom-scroll">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-400">
                        선택 ({pickerSelectedPreview.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (pickerContext.kind === "CC") setCcList([]);
                          else {
                            setApprovalSteps((prev) =>
                              prev.map((st) =>
                                st.id === pickerContext.stepId
                                  ? { ...st, assignees: [] }
                                  : st
                              )
                            );
                          }
                        }}
                        className="text-[11px] font-semibold text-slate-400 underline hover:text-slate-700"
                      >
                        초기화
                      </button>
                    </div>

                    {pickerSelectedPreview.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-1.5 py-1"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            style={{ backgroundColor: avatarColor(item.name) }}
                            className="w-6 h-6 rounded-lg text-white text-[10px] font-extrabold flex items-center justify-center shrink-0"
                          >
                            {item.name.slice(-2)}
                          </span>
                          <span className="font-bold text-slate-800 truncate">
                            {item.name}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 border-t border-slate-200/70 space-y-2">
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-600 font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeSubOrgs}
                        onChange={(e) => setIncludeSubOrgs(e.target.checked)}
                        className="rounded accent-[#00c73c]"
                      />
                      <span>하위 조직 함께 선택</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setPickerContext(null)}
                      className="w-full py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-extrabold"
                    >
                      선택 완료
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =================================================================
            중단 확인 다이얼로그: 휴가 등록을 그만둘까요? (Screenshot 100950)
           ================================================================= */}
        {quitConfirmOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 z-50 bg-white/70 backdrop-blur-[2px] rounded-3xl flex items-center justify-center p-4"
          >
            <div className="bg-white w-full max-w-[320px] rounded-2xl border border-slate-200 shadow-2xl p-6 text-center space-y-4">
              <h4 className="text-[16px] font-extrabold text-slate-900">
                휴가 등록을 그만둘까요?
              </h4>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setQuitConfirmOpen(false);
                    onClose();
                  }}
                  className="w-full py-2.5 rounded-xl bg-[#ec4a18] hover:brightness-95 text-white text-xs font-extrabold"
                >
                  그만두기
                </button>
                <button
                  type="button"
                  onClick={() => setQuitConfirmOpen(false)}
                  className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
