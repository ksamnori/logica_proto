// src/app/hq/leaves/page.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import HqLeaveRegisterModal from "@/components/hq/leaves/HqLeaveRegisterModal";
import { buildRecommendedApprovalLine } from "@/lib/hq/approvalLine";
import { hqFetch } from "@/lib/hq/clientApi";
import { DEFAULT_APPROVAL_POLICIES } from "@/lib/hq/defaultApprovalPolicies";
import { resolvePolicyApprovalLine } from "@/lib/hq/defaultWorkflowForms";
import { resolveOrgSupervisorChain } from "@/lib/hq/orgTreeHelper";
import {
  DEFAULT_ANNUAL_LEAVE_SETTINGS,
  DEFAULT_CUSTOM_LEAVES,
  isCustomGrantValidOnDate,
  isCustomLeaveEligibleForGender,
  isManuallyGrantableCustomLeave,
} from "@/lib/hq/defaultLeaveSettings";
import { computeMemberAnnualLeaveLedgerForYear } from "@/lib/hq/leaveBalanceEngine";
import type {
  HqAnnualLeavePlanItem,
  HqApprovalDoc,
  HqApprovalPolicyItem,
  HqCustomLeaveGrantItem,
  HqCustomLeaveItem,
  HqHolidayItem,
  HqLeaveAdjustmentItem,
  HqLeavePromotionCampaign,
  HqLeavePromotionTargetItem,
  HqUploadedMonthlyUsageItem,
} from "@/lib/hq/types";

type SubTab = "OVERVIEW" | "DETAIL" | "PLAN";

type LeaveFilterStatus =
  | "REGISTERED"
  | "APPROVED"
  | "PENDING"
  | "CANCEL_PENDING"
  | "REJECTED"
  | "CANCELLED"
  | "CANCEL_APPROVED";

const VALID_STATUS_OPTIONS: { key: LeaveFilterStatus; label: string }[] = [
  { key: "REGISTERED", label: "등록" },
  { key: "APPROVED", label: "승인 완료" },
  { key: "PENDING", label: "승인 대기" },
  { key: "CANCEL_PENDING", label: "취소 승인 대기" },
];

const INVALID_STATUS_OPTIONS: { key: LeaveFilterStatus; label: string }[] = [
  { key: "REJECTED", label: "반려" },
  { key: "CANCELLED", label: "취소" },
  { key: "CANCEL_APPROVED", label: "취소 승인 완료" },
];

// 스크린샷 1 (휴가 등록) 기본 노출 순서 7종
const PRIMARY_CUSTOM_LEAVE_IDS = [
  "cl-spouse-miscarriage",
  "cl-military",
  "cl-paternity",
  "cl-condolence-1",
  "cl-condolence-2",
  "cl-marriage",
  "cl-emergency",
];

const WEEKDAY_HEADER = ["일", "월", "화", "수", "목", "금", "토"] as const;

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

function addDaysYmd(ymd: string, delta: number): string {
  const dt = parseYmd(ymd);
  dt.setDate(dt.getDate() + delta);
  return toYmd(dt);
}

function countWorkdaysBetween(
  startYmd: string,
  endYmd: string,
  holidaySet: Set<string>,
  deductOnHolidays: boolean
): number {
  let count = 0;
  let cur = startYmd;
  let guard = 0;
  while (cur <= endYmd && guard < 180) {
    const dow = parseYmd(cur).getDay();
    if (deductOnHolidays) {
      count += 1;
    } else if (dow !== 0 && dow !== 6 && !holidaySet.has(cur)) {
      count += 1;
    }
    cur = addDaysYmd(cur, 1);
    guard += 1;
  }
  return Math.max(1, count);
}

function buildMonthGrid(year: number, month1Based: number) {
  const first = new Date(year, month1Based - 1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month1Based, 0).getDate();
  const prevMonthDays = new Date(year, month1Based - 1, 0).getDate();

  const cells: { ymd: string; day: number; inMonth: boolean; dow: number }[] =
    [];

  // 이전 달 채움
  for (let i = startDow - 1; i >= 0; i -= 1) {
    const d = prevMonthDays - i;
    const dt = new Date(year, month1Based - 2, d);
    cells.push({ ymd: toYmd(dt), day: d, inMonth: false, dow: dt.getDay() });
  }
  // 이번 달
  for (let d = 1; d <= daysInMonth; d += 1) {
    const dt = new Date(year, month1Based - 1, d);
    cells.push({ ymd: toYmd(dt), day: d, inMonth: true, dow: dt.getDay() });
  }
  // 다음 달 채움 (최대 6주 정렬)
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

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function formatDayVal(n: number): string {
  const r = round4(n);
  return `${r}일`;
}

export default function HqLeavesPage() {
  const {
    me,
    members,
    companySettings,
    isHrManager,
    isHqAdmin,
    refreshMembers,
    refreshApprovalBadge,
    refreshAttendanceState,
    openProfileModal,
  } = useHqShell();

  const now = useMemo(() => new Date(), []);
  const todayYmd = useMemo(() => toYmd(new Date()), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [subTab, setSubTab] = useState<SubTab>("OVERVIEW");
  const [historyYear, setHistoryYear] = useState<number>(currentYear);
  const [detailYear, setDetailYear] = useState<number>(currentYear);
  const [planYear, setPlanYear] = useState<number>(currentYear);
  const [detailTargetId, setDetailTargetId] = useState<string>("");

  // 사용한 기록 상태 필터 드롭다운
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<LeaveFilterStatus[]>(
    []
  );
  const [showAllCustomLeaves, setShowAllCustomLeaves] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>(
    {}
  );

  // 서버 데이터
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [leaveDocs, setLeaveDocs] = useState<HqApprovalDoc[]>([]);
  const [adjustments, setAdjustments] = useState<HqLeaveAdjustmentItem[]>([]);
  const [promotions, setPromotions] = useState<HqLeavePromotionCampaign[]>([]);
  const [promotionTargets, setPromotionTargets] = useState<
    HqLeavePromotionTargetItem[]
  >([]);
  const [plans, setPlans] = useState<HqAnnualLeavePlanItem[]>([]);
  const [customGrants, setCustomGrants] = useState<HqCustomLeaveGrantItem[]>([]);
  const [uploadedMonthly, setUploadedMonthly] = useState<
    HqUploadedMonthlyUsageItem[]
  >([]);

  // 2개월 달력 휴가 등록 모달 상태 (스크린샷 2)
  const [regModalOpen, setRegModalOpen] = useState(false);
  const [selectedLeaveKind, setSelectedLeaveKind] = useState<
    | { type: "ANNUAL" }
    | { type: "CUSTOM"; item: HqCustomLeaveItem }
  >({ type: "ANNUAL" });
  const [calBaseYm, setCalBaseYm] = useState<{ year: number; month: number }>({
    year: currentYear,
    month: currentMonth,
  });
  const [pickStartDate, setPickStartDate] = useState<string>("");
  const [pickEndDate, setPickEndDate] = useState<string>("");
  const [annualUnitMode, setAnnualUnitMode] = useState<
    "FULL" | "AM_HALF" | "PM_HALF" | "TWO_HOURS"
  >("FULL");
  const [leaveReason, setLeaveReason] = useState("");
  const [handoverName, setHandoverName] = useState("");

  // 연차 수동 조정 모달 (인사관리자용 ✏️)
  const [adjModalOpen, setAdjModalOpen] = useState(false);
  const [adjMonth, setAdjMonth] = useState(
    `${currentYear}-${String(currentMonth).padStart(2, "0")}`
  );
  const [adjDelta, setAdjDelta] = useState<string>("1");
  const [adjReason, setAdjReason] = useState("");

  // 연차 사용 계획 입력 상태
  const [planDateInput, setPlanDateInput] = useState("");
  const [planDatesDraft, setPlanDatesDraft] = useState<string[]>([]);
  const [planMemoDraft, setPlanMemoDraft] = useState("");

  const statusDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (me?.instructor_id && !detailTargetId) {
      setDetailTargetId(me.instructor_id);
    }
  }, [me?.instructor_id, detailTargetId]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        statusDropdownRef.current &&
        !statusDropdownRef.current.contains(e.target as Node)
      ) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const canManage = Boolean(isHrManager || isHqAdmin);

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status === "재직"),
    [members]
  );

  const customLeaves = useMemo(() => {
    const list = companySettings?.extra_settings?.custom_leaves;
    return Array.isArray(list) && list.length > 0 ? list : DEFAULT_CUSTOM_LEAVES;
  }, [companySettings]);

  const approvalPolicies: HqApprovalPolicyItem[] = useMemo(() => {
    const list = companySettings?.extra_settings?.approval_policies;
    return Array.isArray(list) && list.length > 0
      ? list
      : DEFAULT_APPROVAL_POLICIES;
  }, [companySettings]);

  const annualPolicy = useMemo(() => {
    const settings =
      companySettings?.extra_settings?.annual_leave_settings ||
      DEFAULT_ANNUAL_LEAVE_SETTINGS;
    return settings.policies?.[0] || DEFAULT_ANNUAL_LEAVE_SETTINGS.policies[0];
  }, [companySettings]);

  const holidaySet = useMemo(() => {
    const set = new Set<string>();
    const byYear = companySettings?.holidays_by_year || {};
    Object.values(byYear).forEach((arr) => {
      (arr || []).forEach((h: HqHolidayItem) => {
        if (!h.start_date) return;
        const end = h.end_date || h.start_date;
        let cur = h.start_date;
        let guard = 0;
        while (cur <= end && guard < 30) {
          set.add(cur);
          cur = addDaysYmd(cur, 1);
          guard += 1;
        }
      });
    });
    return set;
  }, [companySettings]);

  const loadLeavesData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          adjustments: HqLeaveAdjustmentItem[];
          promotions: HqLeavePromotionCampaign[];
          promotionTargets?: HqLeavePromotionTargetItem[];
          plans: HqAnnualLeavePlanItem[];
          customGrants?: HqCustomLeaveGrantItem[];
          uploadedMonthly?: HqUploadedMonthlyUsageItem[];
          leaveDocs: HqApprovalDoc[];
        };
      }>("/api/hq/leaves");
      setAdjustments(res.data?.adjustments || []);
      setPromotions(res.data?.promotions || []);
      setPromotionTargets(res.data?.promotionTargets || []);
      setPlans(res.data?.plans || []);
      setCustomGrants(res.data?.customGrants || []);
      setUploadedMonthly(res.data?.uploadedMonthly || []);
      setLeaveDocs(res.data?.leaveDocs || []);
    } catch {
      setLeaveDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeavesData();
  }, [loadLeavesData]);

  // 현재 선택된 구성원 (연차 상세 조회용 — 기본은 로그인 본인)
  const detailMember = useMemo(() => {
    if (canManage && detailTargetId) {
      return (
        members.find((m) => m.instructor_id === detailTargetId) || me
      );
    }
    return me;
  }, [canManage, detailTargetId, members, me]);

  // 내 휴가 신청 내역
  const myLeaveDocs = useMemo(() => {
    if (!me) return [];
    return leaveDocs.filter((d) => d.drafter_id === me.instructor_id);
  }, [leaveDocs, me]);

  // 휴가 등록 카드 노출 목록 구성 (성별 남/여/미입력 및 직접부여·연차소진시부여 잔여분 기준 완벽 필터링)
  const displayedCustomLeaves = useMemo(() => {
    const myGender = me?.profile_extra?.gender || "";
    const myId = me?.instructor_id || "";
    const myRemainAnnual = me
      ? computeMemberAnnualLeaveLedgerForYear({
          memberId: me.instructor_id,
          hireDate: me.hire_date,
          groupHireDate: me.profile_extra?.group_hire_date || null,
          year: currentYear,
          currentYear,
          currentMonth,
          policy: annualPolicy,
          leaveDocs,
          adjustments,
          uploadedMonthly,
        }).availableRemainDays
      : 0;
    const todayIso = `${currentYear}-${String(currentMonth).padStart(
      2,
      "0"
    )}-${String(now.getDate()).padStart(2, "0")}`;

    const isEligible = (c: HqCustomLeaveItem) => {
      if (!isCustomLeaveEligibleForGender(c, myGender)) return false;
      if (isManuallyGrantableCustomLeave(c)) {
        const granted = customGrants
          .filter(
            (g) =>
              g.member_id === myId &&
              g.leave_id === c.id &&
              isCustomGrantValidOnDate(g, todayIso, false)
          )
          .reduce((acc, g) => acc + Number(g.granted_amount || 0), 0);
        const autoExhaust =
          c.grant_method === "연차 소진 시 부여" && myRemainAnnual <= 0
            ? Number(c.grant_amount || 0)
            : 0;
        const used = myLeaveDocs
          .filter((d) => d.status === "APPROVED" && d.leave_type === c.name)
          .reduce((acc, d) => acc + Number(d.leave_days || 0), 0);
        return autoExhaust + granted - used > 0;
      }
      return true;
    };

    const eligibleList = customLeaves.filter(isEligible);

    if (!showAllCustomLeaves) {
      const prioritized: HqCustomLeaveItem[] = [];
      // 여성 구성원은 산전후/보건 우선 + 공통 경조사 노출 (스크린샷 4 동일)
      const preferredOrder =
        myGender === "여"
          ? [
              "cl-premature",
              "cl-menstrual",
              "cl-maternity",
              "cl-maternity-multi",
              "cl-condolence-1",
              "cl-condolence-2",
              "cl-marriage",
              "cl-emergency",
            ]
          : PRIMARY_CUSTOM_LEAVE_IDS;

      preferredOrder.forEach((id) => {
        const found = eligibleList.find((c) => c.id === id);
        if (found) prioritized.push(found);
      });
      // 관리자가 직접 부여해 잔여분이 있는 항목(보상/난임 등)도 누락 없이 카드에 노출
      eligibleList.forEach((c) => {
        if (
          (c.grant_method === "관리자가 직접 부여" ||
            c.grant_method === "연차 소진 시 부여") &&
          !prioritized.some((p) => p.id === c.id)
        ) {
          prioritized.unshift(c);
        }
      });
      return prioritized;
    }

    return eligibleList;
  }, [
    customLeaves,
    me,
    currentYear,
    currentMonth,
    now,
    annualPolicy,
    leaveDocs,
    adjustments,
    uploadedMonthly,
    showAllCustomLeaves,
    customGrants,
    myLeaveDocs,
  ]);

  // ============================================================================
  // 연차 상세 월별 원장 계산 (공통 엔진: 당해 연말 12월 31일 사용 기준 완벽 반영)
  // ============================================================================
  const detailLedger = useMemo(() => {
    const summary = computeMemberAnnualLeaveLedgerForYear({
      memberId: detailMember?.instructor_id || "",
      hireDate: detailMember?.hire_date || null,
      groupHireDate: detailMember?.profile_extra?.group_hire_date || null,
      useMemberGroupHireDate:
        detailMember?.profile_extra?.use_group_hire_date !== false,
      weeklyWorkHours: Number(
        detailMember?.profile_extra?.weekly_work_hours ?? 40
      ),
      resignDate: detailMember?.resign_date || null,
      year: detailYear,
      currentYear,
      currentMonth,
      policy: annualPolicy,
      leaveDocs,
      adjustments,
      uploadedMonthly,
    });
    return {
      rows: summary.rows,
      isYearEndBasis: summary.isYearEndBasis,
      totalAuto: summary.totalAutoGrantToDate,
      totalAutoYearEnd: summary.totalAutoGrantYearEnd,
      totalExpired: summary.totalExpired,
      totalUsed: summary.totalUsedYear,
      totalAdjusted: summary.totalAdjustedYear,
      currentAvailableBalance: summary.availableRemainDays,
    };
  }, [
    detailMember,
    detailYear,
    currentYear,
    currentMonth,
    annualPolicy,
    leaveDocs,
    adjustments,
    uploadedMonthly,
  ]);

  // 내 올해 사용 가능 잔여 연차 일수 (오늘까지 실제 발생한 법정 연차 기준 실시간 반영)
  const myAvailableAnnualDays = useMemo(() => {
    if (!me) return 0;
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
  }, [
    me,
    currentYear,
    currentMonth,
    annualPolicy,
    leaveDocs,
    adjustments,
    uploadedMonthly,
  ]);

  const getMyCustomRemainDays = useCallback(
    (c: HqCustomLeaveItem): number => {
      const myId = me?.instructor_id || "";
      const todayIso = `${currentYear}-${String(currentMonth).padStart(
        2,
        "0"
      )}-${String(now.getDate()).padStart(2, "0")}`;
      const granted = customGrants
        .filter(
          (g) =>
            g.member_id === myId &&
            g.leave_id === c.id &&
            isCustomGrantValidOnDate(g, todayIso, false)
        )
        .reduce((acc, g) => acc + Number(g.granted_amount || 0), 0);
      const autoExhaust =
        c.grant_method === "연차 소진 시 부여" && myAvailableAnnualDays <= 0
          ? Number(c.grant_amount || 0)
          : 0;
      const used = myLeaveDocs
        .filter((d) => d.status === "APPROVED" && d.leave_type === c.name)
        .reduce((acc, d) => acc + Number(d.leave_days || 0), 0);
      return Math.max(0, Math.round((autoExhaust + granted - used) * 100) / 100);
    },
    [
      me?.instructor_id,
      currentYear,
      currentMonth,
      now,
      customGrants,
      myAvailableAnnualDays,
      myLeaveDocs,
    ]
  );

  // 사용한 기록 필터링
  const mapDocToFilterStatus = (doc: HqApprovalDoc): LeaveFilterStatus => {
    if (doc.status === "APPROVED") return "APPROVED";
    if (doc.status === "PENDING" || doc.status === "IN_PROGRESS")
      return "PENDING";
    if (doc.status === "REJECTED") return "REJECTED";
    return "CANCELLED";
  };

  const filteredHistoryDocs = useMemo(() => {
    const yearPrefix = `${historyYear}-`;
    return myLeaveDocs.filter((d) => {
      const dateStr = d.effective_date || d.submitted_at || "";
      if (!dateStr.startsWith(yearPrefix)) return false;
      if (selectedStatuses.length > 0) {
        const mapped = mapDocToFilterStatus(d);
        if (!selectedStatuses.includes(mapped)) return false;
      }
      return true;
    });
  }, [myLeaveDocs, historyYear, selectedStatuses]);

  const toggleStatusFilter = (st: LeaveFilterStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(st) ? prev.filter((x) => x !== st) : [...prev, st]
    );
  };

  // ============================================================================
  // 휴가 등록 카드 클릭 -> 2개월 달력 모달 오픈
  // ============================================================================
  const openLeaveRegistration = (
    kind: { type: "ANNUAL" } | { type: "CUSTOM"; item: HqCustomLeaveItem }
  ) => {
    setSelectedLeaveKind(kind);
    setCalBaseYm({ year: currentYear, month: currentMonth });
    setPickStartDate("");
    setPickEndDate("");
    setAnnualUnitMode("FULL");
    setLeaveReason("");
    setHandoverName("");
    setRegModalOpen(true);
  };

  const handleCalendarDayClick = (ymd: string) => {
    if (selectedLeaveKind.type === "CUSTOM") {
      const item = selectedLeaveKind.item;
      if (item.usage_unit === "한번에 모두 사용") {
        // 부여일수만큼 자동 종료일 계산
        const targetDays = Math.max(1, Number(item.grant_amount || 1));
        let cur = ymd;
        let counted = 0;
        let guard = 0;
        while (counted < targetDays && guard < 180) {
          const dow = parseYmd(cur).getDay();
          if (item.deduct_on_holidays) {
            counted += 1;
          } else if (dow !== 0 && dow !== 6 && !holidaySet.has(cur)) {
            counted += 1;
          }
          if (counted >= targetDays) break;
          cur = addDaysYmd(cur, 1);
          guard += 1;
        }
        setPickStartDate(ymd);
        setPickEndDate(cur);
        return;
      }
    }

    if (!pickStartDate || (pickStartDate && pickEndDate && pickStartDate !== pickEndDate)) {
      setPickStartDate(ymd);
      setPickEndDate(ymd);
    } else if (ymd < pickStartDate) {
      setPickStartDate(ymd);
      setPickEndDate(pickStartDate);
    } else {
      setPickEndDate(ymd);
    }
  };

  const computedModalLeaveDays = useMemo(() => {
    if (!pickStartDate) return 0;
    const end = pickEndDate || pickStartDate;
    if (selectedLeaveKind.type === "ANNUAL") {
      if (annualUnitMode === "AM_HALF" || annualUnitMode === "PM_HALF") {
        return 0.5;
      }
      if (annualUnitMode === "TWO_HOURS") {
        return 0.25;
      }
      return countWorkdaysBetween(pickStartDate, end, holidaySet, false);
    }
    const item = selectedLeaveKind.item;
    if (item.usage_unit === "한번에 모두 사용") {
      return Number(item.grant_amount || 1);
    }
    return countWorkdaysBetween(
      pickStartDate,
      end,
      holidaySet,
      item.deduct_on_holidays
    );
  }, [
    pickStartDate,
    pickEndDate,
    selectedLeaveKind,
    annualUnitMode,
    holidaySet,
  ]);

  // 휴가 신청 상신 실행
  const handleSubmitLeaveRequest = async () => {
    if (!me || !pickStartDate) return;
    setSubmitting(true);
    try {
      const end =
        selectedLeaveKind.type === "ANNUAL" && annualUnitMode !== "FULL"
          ? pickStartDate
          : pickEndDate || pickStartDate;

      const leaveTypeLabel =
        selectedLeaveKind.type === "ANNUAL"
          ? annualUnitMode === "AM_HALF"
            ? "오전 반차"
            : annualUnitMode === "PM_HALF"
            ? "오후 반차"
            : annualUnitMode === "TWO_HOURS"
            ? "시간차 (2시간)"
            : "연차"
          : selectedLeaveKind.item.name;

      const policyId =
        selectedLeaveKind.type === "ANNUAL"
          ? "lv-annual"
          : selectedLeaveKind.item.policy_id;

      // 설정된 휴가 승인 정책에서 조직도(org_chart_nodes) 기준 결재선 산출
      const matchedPolicy = approvalPolicies.find((p) => p.id === policyId);
      const orgNodes = companySettings?.extra_settings?.org_chart_nodes;
      const policyResolved = matchedPolicy
        ? resolvePolicyApprovalLine({
            policy: matchedPolicy,
            me,
            members,
            orgNodes,
            substituteRules:
              companySettings?.extra_settings?.substitute_approvals || [],
          })
        : null;

      let finalSteps: any[] = [];
      if (policyResolved) {
        finalSteps = policyResolved.steps.map((s) => ({
          step_order: s.step_order,
          step_role: s.step_role,
          approver_id: s.approver_id,
          approver_name: s.approver_name,
          approver_dept: s.approver_dept,
          approver_rank: s.approver_rank,
          approver_title: s.approver_title,
        }));
      } else {
        const fallbackLine = buildRecommendedApprovalLine({
          drafter: me,
          allMembers: members,
          docType: "LEAVE",
          leaveDays: computedModalLeaveDays,
          orgNodes,
        });
        finalSteps = fallbackLine.steps.map((s) => ({
          step_order: s.step_order,
          step_role: s.step_role,
          approver_id: s.approver_id,
          approver_name: s.approver_name,
          approver_dept: s.approver_dept,
          approver_rank: s.approver_rank,
          approver_title: s.approver_title,
        }));
        if (finalSteps.length === 0) {
          const supChain = resolveOrgSupervisorChain({
            member: me,
            members: activeMembers,
            orgNodes,
          });
          const topApprover = supChain[0];
          if (topApprover) {
            finalSteps.push({
              step_order: 1,
              step_role: "FINAL_APPROVER",
              approver_id: topApprover.instructor_id,
              approver_name: topApprover.name,
              approver_dept: topApprover.department,
              approver_rank: topApprover.rank_code,
              approver_title: topApprover.job_title,
            });
          }
        }
      }

      await hqFetch("/api/hq/approvals", {
        method: "POST",
        body: {
          doc_type: "LEAVE",
          title: `[${leaveTypeLabel}] ${me.name} 휴가 신청 (${pickStartDate}${
            end !== pickStartDate ? ` ~ ${end}` : ""
          })`,
          content: leaveReason.trim() || `${leaveTypeLabel} 사용 신청합니다.`,
          effective_date: pickStartDate,
          end_date: end,
          leave_type: leaveTypeLabel,
          leave_days: computedModalLeaveDays,
          handover_name: handoverName.trim() || null,
          steps: finalSteps,
        },
      });

      setRegModalOpen(false);
      await Promise.all([
        loadLeavesData(),
        refreshMembers(),
        refreshApprovalBadge(),
        refreshAttendanceState(),
      ]);
      alert("휴가 신청이 등록되었습니다.");
    } catch (err: any) {
      alert(err?.message || "휴가 등록 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelLeaveDoc = async (approvalId: string) => {
    if (!confirm("대기 중인 휴가 신청을 취소(회수)하시겠습니까?")) return;
    try {
      await hqFetch("/api/hq/approvals", {
        method: "PATCH",
        body: { approval_id: approvalId, action: "CANCEL" },
      });
      await Promise.all([loadLeavesData(), refreshApprovalBadge()]);
    } catch (err: any) {
      alert(err?.message || "휴가 취소 처리에 실패했습니다.");
    }
  };

  // 연차 수동 조정 저장
  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailMember) return;
    const delta = Number(adjDelta);
    if (!delta || Number.isNaN(delta)) {
      alert("0이 아닌 조정 일수(예: 1, -0.5)를 입력해 주세요.");
      return;
    }
    setSubmitting(true);
    try {
      await hqFetch("/api/hq/leaves", {
        method: "POST",
        body: {
          action: "ADD_ADJUSTMENT",
          member_id: detailMember.instructor_id,
          member_name: detailMember.name,
          year_month: adjMonth,
          delta_days: delta,
          reason: adjReason.trim() || "인사담당자 연차 조정",
        },
      });
      setAdjModalOpen(false);
      setAdjReason("");
      await Promise.all([loadLeavesData(), refreshMembers()]);
    } catch (err: any) {
      alert(err?.message || "연차 조정 실패");
    } finally {
      setSubmitting(false);
    }
  };

  // 연차 촉진 상태 및 내 계획 동기화 (전사 촉진 캠페인 또는 개별 요청 대상 모두 지원)
  const activePromotion = useMemo(() => {
    const myTarget = promotionTargets.find(
      (t) => t.year === planYear && t.member_id === me?.instructor_id
    );
    if (myTarget) {
      return {
        year: planYear,
        is_active: true,
        due_date: myTarget.due_date,
        started_by: myTarget.requested_by,
        started_at: myTarget.requested_at,
      };
    }
    return promotions.find((p) => p.year === planYear && p.is_active);
  }, [promotionTargets, promotions, planYear, me?.instructor_id]);

  const myPlanForYear = useMemo(
    () =>
      plans.find(
        (p) => p.year === planYear && p.member_id === me?.instructor_id
      ),
    [plans, planYear, me?.instructor_id]
  );

  useEffect(() => {
    setPlanDatesDraft(myPlanForYear?.planned_dates || []);
    setPlanMemoDraft(myPlanForYear?.memo || "");
  }, [myPlanForYear]);

  const handleTogglePromotion = async (nextActive: boolean) => {
    try {
      await hqFetch("/api/hq/leaves", {
        method: "POST",
        body: {
          action: "TOGGLE_PROMOTION",
          year: planYear,
          is_active: nextActive,
          due_date: `${planYear}-12-15`,
        },
      });
      await loadLeavesData();
    } catch (err: any) {
      alert(err?.message || "연차 촉진 상태 변경 실패");
    }
  };

  const handleSaveMyPlan = async () => {
    setSubmitting(true);
    try {
      await hqFetch("/api/hq/leaves", {
        method: "POST",
        body: {
          action: "SAVE_PLAN",
          year: planYear,
          planned_dates: planDatesDraft,
          memo: planMemoDraft,
        },
      });
      await loadLeavesData();
      alert("연차 사용 계획이 저장되었습니다.");
    } catch (err: any) {
      alert(err?.message || "연차 사용 계획 저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  // 2개월 달력 좌/우 연월 계산
  const secondMonthYm = useMemo(() => {
    if (calBaseYm.month === 12) {
      return { year: calBaseYm.year + 1, month: 1 };
    }
    return { year: calBaseYm.year, month: calBaseYm.month + 1 };
  }, [calBaseYm]);

  const shiftCalMonth = (delta: -1 | 1) => {
    setCalBaseYm((prev) => {
      const dt = new Date(prev.year, prev.month - 1 + delta, 1);
      return { year: dt.getFullYear(), month: dt.getMonth() + 1 };
    });
  };

  return (
    <div className="w-full min-h-full shrink-0 bg-white flex flex-col">
      {/* 상단 헤더 & 3개 서브탭 */}
      <div className="px-5 sm:px-8 xl:px-10 pt-8 border-b border-slate-200">
        <h1 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
          내 휴가
        </h1>

        <div className="mt-5 flex items-center gap-6">
          {(
            [
              { key: "OVERVIEW", label: "휴가 개요" },
              { key: "DETAIL", label: "연차 상세" },
              { key: "PLAN", label: "연차 사용 계획" },
            ] as const
          ).map((t) => {
            const active = subTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSubTab(t.key)}
                className={`pb-3 text-[13px] font-bold border-b-2 transition-colors ${
                  active
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-400 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* =====================================================================
          탭 1: [휴가 개요] (좌우 폭 100% 확장)
         ===================================================================== */}
      {subTab === "OVERVIEW" && (
        <div className="px-5 sm:px-8 xl:px-10 py-8 w-full space-y-10">
          {me && !me.profile_extra?.gender && (
            <div className="px-4 py-3 rounded-2xl bg-amber-50/70 border border-amber-200/80 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-amber-900 font-semibold">
                <span>🪪</span>
                <span>
                  내 프로필에 <b>주민등록번호(앞 6자리 · 뒷 첫자리)</b>를 등록하면 산전후·보건·배우자출산 등 본인에게 해당하는 맞춤 휴가가 자동으로 표시됩니다.
                </span>
              </div>
              <button
                type="button"
                onClick={() => openProfileModal("basic")}
                className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold whitespace-nowrap transition-colors"
              >
                주민등록번호 등록하기 →
              </button>
            </div>
          )}

          {/* 섹션 1: 휴가 등록 */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-extrabold text-slate-900">
                휴가 등록
              </h2>
              <button
                type="button"
                onClick={() => setShowAllCustomLeaves((v) => !v)}
                className="text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors"
              >
                {showAllCustomLeaves
                  ? "기본 휴가만 보기 ▴"
                  : "전체 맞춤 휴가 보기 ▾"}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3.5">
              {/* 카드 1: 연차 */}
              <button
                type="button"
                onClick={() => openLeaveRegistration({ type: "ANNUAL" })}
                className="h-[132px] p-4 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-100/80 text-left flex flex-col justify-between transition-all group"
              >
                <span className="text-xl opacity-75 group-hover:opacity-100 transition-opacity">
                  🏖️
                </span>
                <div>
                  <div className="text-xs font-bold text-slate-800">연차</div>
                  <div className="text-[14px] font-extrabold text-slate-900 mt-0.5">
                    {myAvailableAnnualDays}일
                  </div>
                </div>
              </button>

              {/* 맞춤 휴가 카드 목록 */}
              {displayedCustomLeaves.map((item) => {
                const remainCustom = getMyCustomRemainDays(item);
                const subText =
                  remainCustom > 0
                    ? `${remainCustom}일 보유`
                    : item.id === "cl-military" ||
                        item.grant_unit === "신청하는 만큼 부여"
                      ? "신청 시 부여"
                      : item.grant_method === "신청 시 부여"
                        ? `신청 시 ${item.grant_amount}${
                            item.grant_unit.startsWith("시간") ? "시간" : "일"
                          } 부여`
                        : item.grant_method === "반복 부여"
                          ? `${item.grant_amount}일 (${item.repeat_cycle || "반복 부여"})`
                          : `${item.grant_method}`;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      openLeaveRegistration({ type: "CUSTOM", item })
                    }
                    className="h-[132px] p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50/90 text-left flex flex-col justify-between transition-all group"
                  >
                    <span className="text-xl opacity-65 group-hover:opacity-100 transition-opacity">
                      {item.icon || "🌿"}
                    </span>
                    <div>
                      <div className="text-xs font-bold text-slate-800 truncate">
                        {item.name}
                      </div>
                      <div
                        className={`text-[13px] mt-0.5 font-semibold ${
                          remainCustom > 0
                            ? "text-emerald-700 font-extrabold"
                            : "text-slate-400"
                        }`}
                      >
                        {subText}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 섹션 2: 사용한 기록 */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-[16px] font-extrabold text-slate-900">
                사용한 기록
              </h2>

              <div className="flex items-center gap-2">
                {/* [휴가 상태 ▾] 멀티 체크박스 드롭다운 (스크린샷 3) */}
                <div ref={statusDropdownRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setStatusMenuOpen((v) => !v)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600 flex items-center gap-1.5"
                  >
                    <span className="text-slate-400">◐</span>
                    <span>
                      휴가 상태
                      {selectedStatuses.length > 0
                        ? ` (${selectedStatuses.length})`
                        : ""}
                    </span>
                    <span className="text-[10px] text-slate-400">▾</span>
                  </button>

                  {statusMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 w-48 rounded-xl bg-white border border-slate-200 shadow-xl py-2.5 px-2 z-30 text-xs">
                      <div className="px-2 pb-1 text-[11px] font-bold text-slate-400">
                        유효한 휴가
                      </div>
                      {VALID_STATUS_OPTIONS.map((opt) => (
                        <label
                          key={opt.key}
                          className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer font-semibold text-slate-700"
                        >
                          <input
                            type="checkbox"
                            checked={selectedStatuses.includes(opt.key)}
                            onChange={() => toggleStatusFilter(opt.key)}
                            className="rounded border-slate-300"
                          />
                          <span>{opt.label}</span>
                        </label>
                      ))}

                      <div className="my-1.5 border-t border-slate-100" />
                      <div className="px-2 pb-1 text-[11px] font-bold text-slate-400">
                        유효하지 않은 휴가
                      </div>
                      {INVALID_STATUS_OPTIONS.map((opt) => (
                        <label
                          key={opt.key}
                          className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer font-semibold text-slate-700"
                        >
                          <input
                            type="checkbox"
                            checked={selectedStatuses.includes(opt.key)}
                            onChange={() => toggleStatusFilter(opt.key)}
                            className="rounded border-slate-300"
                          />
                          <span>{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* 연도 이동 */}
                <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => setHistoryYear((y) => y - 1)}
                    className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-800 font-bold"
                  >
                    ‹
                  </button>
                  <span className="px-2.5 py-1.5 text-xs font-bold text-slate-800 tabular-nums">
                    {historyYear}년
                  </span>
                  <button
                    type="button"
                    onClick={() => setHistoryYear((y) => y + 1)}
                    className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-800 font-bold"
                  >
                    ›
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="rounded-2xl bg-slate-50/60 border border-slate-100 py-16 text-center text-xs font-semibold text-slate-400">
                휴가 사용 기록을 불러오는 중입니다...
              </div>
            ) : filteredHistoryDocs.length === 0 ? (
              <div className="rounded-2xl bg-slate-50/50 border border-slate-100 py-16 flex flex-col items-center justify-center gap-2 text-slate-400">
                <span className="w-6 h-6 rounded-full border border-slate-300 inline-flex items-center justify-center text-xs font-bold">
                  i
                </span>
                <span className="text-xs font-semibold">
                  조건에 해당하는 휴가가 없습니다.
                </span>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                {filteredHistoryDocs.map((doc) => {
                  const statusBadge =
                    doc.status === "APPROVED"
                      ? {
                          label: "승인 완료",
                          cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
                        }
                      : doc.status === "PENDING" || doc.status === "IN_PROGRESS"
                      ? {
                          label: "승인 대기",
                          cls: "bg-amber-50 text-amber-800 border-amber-200",
                        }
                      : doc.status === "REJECTED"
                      ? {
                          label: "반려",
                          cls: "bg-rose-50 text-rose-700 border-rose-200",
                        }
                      : {
                          label: "취소",
                          cls: "bg-slate-100 text-slate-500 border-slate-200",
                        };

                  return (
                    <div
                      key={doc.approval_id}
                      className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50/60"
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-base">
                          🏖️
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-extrabold text-slate-900">
                              {doc.leave_type || "연차"}
                            </span>
                            <span className="text-xs font-bold text-slate-500">
                              {doc.leave_days}일
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                            {doc.effective_date}
                            {doc.end_date && doc.end_date !== doc.effective_date
                              ? ` ~ ${doc.end_date}`
                              : ""}
                            {doc.content ? ` · ${doc.content}` : ""}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${statusBadge.cls}`}
                        >
                          {statusBadge.label}
                        </span>
                        {doc.status === "PENDING" && (
                          <button
                            type="button"
                            onClick={() => handleCancelLeaveDoc(doc.approval_id)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-[11px] font-bold text-slate-600"
                          >
                            신청 취소
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* =====================================================================
          탭 2: [연차 상세] (좌우 폭 100% 확장)
         ===================================================================== */}
      {subTab === "DETAIL" && (
        <div className="px-10 py-8 w-full space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-[15px] font-extrabold text-slate-900">
                연차 상세 현황
              </h2>
              {detailLedger.isYearEndBasis && (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-extrabold">
                  {detailYear}.12.31 연말 사용 기준 · 남은 연차{" "}
                  {detailLedger.currentAvailableBalance}일
                </span>
              )}
              {canManage && (
                <select
                  value={detailTargetId}
                  onChange={(e) => setDetailTargetId(e.target.value)}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-slate-50"
                >
                  {activeMembers.map((m) => (
                    <option key={m.instructor_id} value={m.instructor_id}>
                      {m.name} ({m.department})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <select
                value={detailYear}
                onChange={(e) => setDetailYear(Number(e.target.value))}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-800 bg-white"
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
                className="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-500"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setDetailYear((y) => y + 1)}
                className="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-500"
              >
                ›
              </button>
            </div>
          </div>

          {/* 상단 4분할 요약 카드 (자동 부여 / 소멸 / 사용 / 조정) */}
          <div className="rounded-xl border border-slate-200 bg-white grid grid-cols-2 lg:grid-cols-4 divide-x divide-slate-100">
            <div className="p-5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                <span className="w-0.5 h-3 bg-emerald-500 rounded-full" />
                <span>자동 부여</span>
                <span
                  title="근로기준법 및 회사 연차 정책에 따라 자동 산정된 일수입니다."
                  className="text-slate-300 text-[11px] cursor-help"
                >
                  ⓘ
                </span>
              </div>
              <div className="mt-2 text-base font-extrabold text-emerald-600">
                {detailLedger.totalAuto > 0
                  ? `+ ${formatDayVal(detailLedger.totalAuto)}`
                  : "없음"}
              </div>
              {detailLedger.totalAutoYearEnd > detailLedger.totalAuto && (
                <div className="mt-0.5 text-[11px] font-semibold text-slate-400">
                  연말까지 총 +{detailLedger.totalAutoYearEnd}일 예정
                </div>
              )}
            </div>

            <div className="p-5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                <span className="w-0.5 h-3 bg-rose-500 rounded-full" />
                <span>소멸</span>
                <span
                  title="사용 기한 경과로 소멸된 연차 일수입니다."
                  className="text-slate-300 text-[11px] cursor-help"
                >
                  ⓘ
                </span>
              </div>
              <div className="mt-2 text-base font-extrabold text-slate-300">
                {detailLedger.totalExpired > 0
                  ? `- ${formatDayVal(detailLedger.totalExpired)}`
                  : "없음"}
              </div>
            </div>

            <div className="p-5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                <span className="w-0.5 h-3 bg-amber-400 rounded-full" />
                <span>사용</span>
                <span
                  title="승인 완료 및 승인 대기 중인 연차·반차 차감 합계입니다."
                  className="text-slate-300 text-[11px] cursor-help"
                >
                  ⓘ
                </span>
              </div>
              <div
                className={`mt-2 text-base font-extrabold ${
                  detailLedger.totalUsed > 0
                    ? "text-amber-600"
                    : "text-slate-300"
                }`}
              >
                {detailLedger.totalUsed > 0
                  ? `- ${formatDayVal(detailLedger.totalUsed)}`
                  : "없음"}
              </div>
            </div>

            <div className="p-5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                <span className="w-0.5 h-3 bg-purple-500 rounded-full" />
                <span>조정</span>
                <span
                  title="인사담당자가 수동으로 가감 조정한 연차 일수입니다."
                  className="text-slate-300 text-[11px] cursor-help"
                >
                  ⓘ
                </span>
              </div>
              <div
                className={`mt-2 text-base font-extrabold ${
                  detailLedger.totalAdjusted !== 0
                    ? "text-purple-600"
                    : "text-slate-300"
                }`}
              >
                {detailLedger.totalAdjusted !== 0
                  ? `${detailLedger.totalAdjusted > 0 ? "+ " : ""}${formatDayVal(
                      detailLedger.totalAdjusted
                    )}`
                  : "없음"}
              </div>
            </div>
          </div>

          {/* 월별 연차 원장 테이블 */}
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-5 w-[18%]">날짜</th>
                  <th className="py-3 px-4 w-[18%]">자동 부여</th>
                  <th className="py-3 px-4 w-[16%]">소멸</th>
                  <th className="py-3 px-4 w-[18%]">사용</th>
                  <th className="py-3 px-4 w-[18%]">
                    <div className="flex items-center justify-between">
                      <span>조정</span>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => {
                            setAdjMonth(
                              `${detailYear}-${String(currentMonth).padStart(
                                2,
                                "0"
                              )}`
                            );
                            setAdjModalOpen(true);
                          }}
                          title="연차 일수 수동 조정"
                          className="text-slate-400 hover:text-slate-800"
                        >
                          ✎
                        </button>
                      )}
                    </div>
                  </th>
                  <th className="py-3 px-5 w-[12%]">잔여</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {detailLedger.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-16 text-center text-slate-400 font-semibold"
                    >
                      해당 연도에 산정된 연차 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  detailLedger.rows.map((r) => {
                    const expanded = Boolean(expandedMonths[r.ym]);
                    const hasDetails =
                      r.usedItems.length > 0 || r.adjItems.length > 0;

                    return (
                      <React.Fragment key={r.ym}>
                        <tr
                          onClick={() =>
                            hasDetails &&
                            setExpandedMonths((prev) => ({
                              ...prev,
                              [r.ym]: !prev[r.ym],
                            }))
                          }
                          className={`hover:bg-slate-50/60 ${
                            hasDetails ? "cursor-pointer" : ""
                          }`}
                        >
                          <td className="py-3.5 px-5 border-r border-slate-100">
                            <div className="flex items-center justify-between">
                              <span
                                className={`font-bold ${
                                  r.isCurrentMonth
                                    ? "text-emerald-600"
                                    : "text-slate-800"
                                }`}
                              >
                                {detailYear}년 {r.monthNum}월
                              </span>
                              {r.isHireMonth && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 text-[10px] font-extrabold">
                                  입사월
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 border-r border-slate-100 font-bold text-slate-800">
                            {r.autoGrant > 0 ? (
                              <span>+{r.autoGrant}일</span>
                            ) : r.scheduledFutureGrant > 0 ? (
                              <span className="text-slate-400 font-semibold">
                                +{r.scheduledFutureGrant}일 예정
                                {r.grantDateLabels[0]
                                  ? ` (${r.grantDateLabels[0].split(" ")[0]})`
                                  : ""}
                              </span>
                            ) : (
                              ""
                            )}
                          </td>
                          <td className="py-3.5 px-4 border-r border-slate-100 font-semibold text-rose-600">
                            {r.expired > 0 ? `-${r.expired}일` : ""}
                          </td>
                          <td className="py-3.5 px-4 border-r border-slate-100 font-bold text-amber-700">
                            {r.used > 0 ? `-${r.used}일` : ""}
                          </td>
                          <td className="py-3.5 px-4 border-r border-slate-100">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-purple-700">
                                {r.adjusted !== 0
                                  ? `${r.adjusted > 0 ? "+" : ""}${r.adjusted}일`
                                  : ""}
                              </span>
                              <span className="text-[10px] text-blue-500">
                                ▾
                              </span>
                            </div>
                          </td>
                          <td className="py-3.5 px-5 font-bold text-slate-800">
                            {r.isHireMonth && r.autoGrant === 0 && r.runningBalance === 0
                              ? ""
                              : formatDayVal(r.runningBalance)}
                          </td>
                        </tr>

                        {expanded && hasDetails && (
                          <tr className="bg-slate-50/70">
                            <td colSpan={6} className="px-6 py-3 space-y-1.5">
                              {r.usedItems.map((u) => (
                                <div
                                  key={u.approval_id}
                                  className="text-[11px] text-slate-600 flex items-center justify-between"
                                >
                                  <span>
                                    🏖️ [사용] {u.leave_type || "연차"} (
                                    {u.effective_date})
                                  </span>
                                  <span className="font-bold text-amber-700">
                                    -{u.leave_days}일
                                  </span>
                                </div>
                              ))}
                              {r.adjItems.map((a) => (
                                <div
                                  key={a.id}
                                  className="text-[11px] text-slate-600 flex items-center justify-between"
                                >
                                  <span>
                                    ✎ [조정] {a.reason} (처리: {a.actor_name})
                                  </span>
                                  <span className="font-bold text-purple-700">
                                    {a.delta_days > 0
                                      ? `+${a.delta_days}일`
                                      : `${a.delta_days}일`}
                                  </span>
                                </div>
                              ))}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>

            <div className="px-5 py-3 border-t border-slate-100 text-[11px] text-slate-400">
              소수점 넷째 자리에서 반올림하여 표기된 결과입니다.
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          탭 3: [연차 사용 계획] (스크린샷 5 100% 재현 + 연차 촉진 실행 지원)
         ===================================================================== */}
      {subTab === "PLAN" && (
        <div className="px-10 py-6 flex-1 flex flex-col">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs">
              <span className="text-slate-400">📅</span>
              <span className="text-slate-500 font-semibold">조회 기간</span>
              <select
                value={planYear}
                onChange={(e) => setPlanYear(Number(e.target.value))}
                className="font-extrabold text-slate-800 outline-none bg-transparent cursor-pointer"
              >
                {[currentYear - 1, currentYear, currentYear + 1].map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}년
                  </option>
                ))}
              </select>
            </div>

            {canManage && (
              <button
                type="button"
                onClick={() => handleTogglePromotion(!activePromotion)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
                  activePromotion
                    ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {activePromotion
                  ? `${planYear}년 연차 촉진 종료`
                  : `${planYear}년 연차 촉진 시작`}
              </button>
            )}
          </div>

          {!activePromotion ? (
            /* 기본 빈 상태 (스크린샷 5 1:1 동일) */
            <div className="flex-1 min-h-[420px] flex flex-col items-center justify-center text-center">
              <div className="w-10 h-12 rounded-lg border-2 border-dashed border-slate-300 flex items-end justify-end p-1 mb-4">
                <span className="w-2.5 h-2.5 border-t-2 border-l-2 border-slate-300" />
              </div>
              <h3 className="text-sm font-extrabold text-slate-800">
                연차 촉진 내역이 없어요.
              </h3>
              <p className="text-xs text-slate-400 mt-1.5">
                담당자가 연차 촉진을 시작하면 이 곳에서 연차 사용 계획을 작성할 수 있어요.
              </p>
            </div>
          ) : (
            /* 연차 촉진 활성화 시 계획 작성 보드 */
            <div className="mt-6 max-w-2xl rounded-2xl border border-slate-200 p-6 space-y-4 bg-white shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-extrabold">
                    연차 촉진 진행 중
                  </span>
                  <h3 className="text-base font-extrabold text-slate-900 mt-1">
                    {planYear}년 미사용 연차 사용 계획서 제출
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    제출 기한: {activePromotion.due_date} · 현재 잔여 연차{" "}
                    <strong>{myAvailableAnnualDays}일</strong>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={planDateInput}
                  onChange={(e) => setPlanDateInput(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!planDateInput) return;
                    if (!planDatesDraft.includes(planDateInput)) {
                      setPlanDatesDraft((prev) =>
                        [...prev, planDateInput].sort()
                      );
                    }
                    setPlanDateInput("");
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
                >
                  + 예정일 추가
                </button>
              </div>

              <div className="min-h-[64px] p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap gap-1.5">
                {planDatesDraft.length === 0 ? (
                  <span className="text-xs text-slate-400">
                    사용 예정인 날짜를 추가해 주세요.
                  </span>
                ) : (
                  planDatesDraft.map((d) => (
                    <span
                      key={d}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-800"
                    >
                      <span>{d}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setPlanDatesDraft((prev) =>
                            prev.filter((x) => x !== d)
                          )
                        }
                        className="text-slate-400 hover:text-rose-600"
                      >
                        ✕
                      </button>
                    </span>
                  ))
                )}
              </div>

              <input
                value={planMemoDraft}
                onChange={(e) => setPlanMemoDraft(e.target.value)}
                placeholder="비고 메모 (선택)"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
              />

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSaveMyPlan}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold disabled:opacity-50"
                >
                  {submitting
                    ? "제출 중..."
                    : `계획 저장 (${planDatesDraft.length}일)`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          모달 1: Flex 스타일 2개월 달력 + 상세 일정(반반차/시간차/반차) + 승인·참조 휴가 등록 모달
         ===================================================================== */}
      <HqLeaveRegisterModal
        isOpen={regModalOpen}
        onClose={() => setRegModalOpen(false)}
        initialKind={selectedLeaveKind}
        availableAnnualDays={myAvailableAnnualDays}
        leaveDocs={leaveDocs}
        adjustments={adjustments}
        uploadedMonthly={uploadedMonthly}
        onSubmitted={loadLeavesData}
      />

      {/* =====================================================================
          모달 2: 연차 일수 수동 조정 모달 (인사관리자 전용 ✎)
         ===================================================================== */}
      {adjModalOpen && detailMember && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                ✎ 연차 일수 수동 조정 ({detailMember.name})
              </h3>
              <button
                type="button"
                onClick={() => setAdjModalOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveAdjustment} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    반영 연월
                  </label>
                  <input
                    type="month"
                    required
                    value={adjMonth}
                    onChange={(e) => setAdjMonth(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    조정 일수 (+부여 / -차감)
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    required
                    value={adjDelta}
                    onChange={(e) => setAdjDelta(e.target.value)}
                    placeholder="예: 1 또는 -0.5"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  조정 사유
                </label>
                <input
                  required
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="예: 포상 휴가 추가 부여 / 이월 연차 보정"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-extrabold disabled:opacity-50"
                >
                  {submitting ? "반영 중..." : "조정 반영"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
