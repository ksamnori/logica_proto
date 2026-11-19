// src/app/hq/attendance/page.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import HqLeaveRegisterModal, {
  type LeaveRegisterKind,
} from "@/components/hq/leaves/HqLeaveRegisterModal";
import {
  AttendanceUploadModal,
  exportAttendanceCsv,
  RecurringScheduleModal,
} from "@/components/hq/attendance/HqAttendanceModals";
import {
  buildDraftWorkEditFromSchedule,
  calcDayScheduleSummary,
  calcDraftNetWorkedMinutes,
  computeSegmentsOvertimeMeta,
  type DraftWorkEdit,
  evaluateDraftsApprovalSummary,
  findNextFreeBreakSlot,
  findNextFreeSegmentSlot,
  FlexApprovalSidePanel,
  FlexBreakListPopover,
  FlexDraftFloatingBar,
  FlexInlineWorkPopover,
  FlexRealtimeHoverTooltip,
  FlexRealtimeRecordEditModal,
  FlexRowAddPopover,
  formatDurationKoreanCompact,
  getBreaksOverlappingSegment,
  getWorkPolicyVisual,
  type InlineWorkPopoverTarget,
  isScheduleIdenticalToBaseline,
  minutesToHm24,
  PolicySvgIcon,
  resolveNearestNonOverlappingSlot,
} from "@/components/hq/attendance/HqFlexInlineWorkEditor";
import { ATTENDANCE_MODES } from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import { DEFAULT_WORK_FORM_POLICIES } from "@/lib/hq/defaultApprovalPolicies";
import { DEFAULT_CUSTOM_LEAVES } from "@/lib/hq/defaultLeaveSettings";
import {
  calcBreakMinutes,
  DEFAULT_WORK_RULES,
  formatMinutesToKoreanAmPm,
  parseHmToMinutes,
  resolveBreakWindowsForSpan,
} from "@/lib/hq/defaultWorkRules";
import type {
  HqAttendanceRecord,
  HqCustomLeaveItem,
  HqHolidayItem,
  HqMember,
  HqRealtimeBreakSpan,
  HqRealtimeWorkLog,
  HqRecognizedBreakBlock,
  HqRecognizedDaySchedule,
  HqRecognizedWorkSegment,
  HqWorkFormPolicy,
  HqWorkMode,
  HqWorkRuleItem,
} from "@/lib/hq/types";

type MainTab = "MY" | "TEAM";
type MyPeriodMode = "CYCLE" | "WEEK" | "MONTH";
type TeamPeriodMode = "DAY" | "WEEK" | "MONTH" | "CYCLE";
type TeamStatusFilter = "ALL" | "LEAVE" | "OVERTIME" | "CUSTOM" | "WORKING";

interface LeaveApprovalLite {
  approval_id: string;
  drafter_id: string;
  drafter_name: string;
  drafter_dept: string;
  doc_type: string;
  title: string;
  status: string;
  effective_date: string | null;
  end_date: string | null;
  leave_type: string | null;
  leave_days: number;
}

interface PendingWorkApprovalLite {
  approval_id: string;
  doc_no: string;
  title: string;
  status: string;
  target_member_id: string;
  work_date: string;
  after_in_minutes: number;
  after_out_minutes: number;
  after_policy_name: string;
}

function buildRealtimeSubSegments(
  startMin: number,
  endMin: number,
  breaks: HqRealtimeBreakSpan[]
): { from: number; to: number; isBreak: boolean }[] {
  const safeEnd = Math.max(startMin + 1, endMin);
  const validBreaks = [...(breaks || [])]
    .map((b) => ({
      start: Math.max(startMin, b.start_min),
      end: Math.min(safeEnd, b.end_min),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  const segments: { from: number; to: number; isBreak: boolean }[] = [];
  let cursor = startMin;
  for (const brk of validBreaks) {
    if (brk.start > cursor) {
      segments.push({ from: cursor, to: brk.start, isBreak: false });
    }
    if (brk.end > Math.max(cursor, brk.start)) {
      segments.push({
        from: Math.max(cursor, brk.start),
        to: brk.end,
        isBreak: true,
      });
      cursor = brk.end;
    }
  }
  if (cursor < safeEnd) {
    segments.push({ from: cursor, to: safeEnd, isBreak: false });
  }
  return segments;
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;
const MONDAY_FIRST_KO = ["월", "화", "수", "목", "금", "토", "일"] as const;

const CYCLE_START_DOW_MAP: Record<string, number> = {
  일요일: 0,
  월요일: 1,
  화요일: 2,
  수요일: 3,
  목요일: 4,
  금요일: 5,
  토요일: 6,
};

const AVATAR_PALETTE = [
  "#2dd4bf", // 민트 (근식, 시연)
  "#4ade80", // 그린 (동현)
  "#eb7d66", // 코랄 오렌지 (문수, 원형, 종준)
  "#f87171", // 로즈 (세리)
  "#38bdf8", // 스카이 (혜영)
  "#9ba8cf", // 라벤더 슬레이트 (종현)
  "#a78bfa", // 바이올렛 (민서)
  "#fb923c", // 앰버
];

function avatarColorForName(name: string): string {
  if (name === "김근식" || name === "백시연") return "#2dd4bf";
  if (name === "김동현") return "#4ade80";
  if (name === "김문수" || name === "원종준" || name === "조원형") return "#eb7d66";
  if (name === "민세리") return "#e57373";
  if (name === "심혜영") return "#2dd4bf";
  if (name === "천종현") return "#9ba8cf";
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

function addDaysYmd(ymd: string, delta: number): string {
  const dt = parseYmdLocal(ymd);
  dt.setDate(dt.getDate() + delta);
  return toYmd(dt);
}

function getMondayOfYmd(ymd: string): string {
  const dt = parseYmdLocal(ymd);
  const dow = dt.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + diff);
  return toYmd(dt);
}

function getCycleStartOfYmd(ymd: string, cycleStartDay?: string): string {
  const targetDow = CYCLE_START_DOW_MAP[cycleStartDay || "월요일"] ?? 1;
  const dt = parseYmdLocal(ymd);
  const curDow = dt.getDay();
  const diff = (curDow - targetDow + 7) % 7;
  dt.setDate(dt.getDate() - diff);
  return toYmd(dt);
}

function getMonthRangeOfYmd(ymd: string): { start: string; end: string } {
  const dt = parseYmdLocal(ymd);
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  return {
    start: `${y}-${String(m).padStart(2, "0")}-01`,
    end: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}

function buildDateList(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  let cur = startYmd;
  let guard = 0;
  while (cur <= endYmd && guard < 62) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
    guard += 1;
  }
  return out;
}

function formatRangeHeader(startYmd: string, endYmd: string): string {
  const s = parseYmdLocal(startYmd);
  const e = parseYmdLocal(endYmd);
  const sy = s.getFullYear();
  const sm = s.getMonth() + 1;
  const sd = s.getDate();
  const ey = e.getFullYear();
  const em = e.getMonth() + 1;
  const ed = e.getDate();
  if (sy === ey) {
    return `${sy}. ${sm}. ${sd} - ${em}. ${ed}`;
  }
  return `${sy}. ${sm}. ${sd} - ${ey}. ${em}. ${ed}`;
}

function formatSingleDayHeader(ymd: string): string {
  const d = parseYmdLocal(ymd);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()} (${
    WEEKDAY_KO[d.getDay()]
  })`;
}

function formatHmColon(mins: number): string {
  const safe = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatClock24(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function isoToMinutesOfDay(iso?: string | null, baseYmd?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // KST 시각 추출
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const isoYmd = kst.toISOString().slice(0, 10);
  const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (baseYmd && isoYmd > baseYmd) {
    return Math.min(1440, mins + 1440);
  }
  return mins;
}

export default function HqAttendancePage() {
  const {
    me,
    members,
    companySettings,
    isHqAdmin,
    hasHqPerm,
    canAccessTargetPerm,
    refreshAttendanceState,
  } = useHqShell();

  const [mainTab, setMainTab] = useState<MainTab>("MY");
  const [nowClock, setNowClock] = useState(() => new Date());

  // 내 근무 뷰 상태
  const [myPeriodMode, setMyPeriodMode] = useState<MyPeriodMode>("CYCLE");
  const [myAnchorDate, setMyAnchorDate] = useState(() => toYmd(new Date()));
  const [zoomPct, setZoomPct] = useState(100);
  const [showWeekends, setShowWeekends] = useState(true);
  const [showPlannedGuide, setShowPlannedGuide] = useState(true);
  const [showNowLine, setShowNowLine] = useState(true);
  const [studioExpanded, setStudioExpanded] = useState(false);

  // 구성원 근무 뷰 상태
  const [teamPeriodMode, setTeamPeriodMode] = useState<TeamPeriodMode>("DAY");
  const [teamAnchorDate, setTeamAnchorDate] = useState(() => toYmd(new Date()));
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [deptMenuOpen, setDeptMenuOpen] = useState(false);
  const [teamRuleFilter, setTeamRuleFilter] = useState("ALL");
  const [teamRuleMenuOpen, setTeamRuleMenuOpen] = useState(false);
  const [includeLeaveInCycle, setIncludeLeaveInCycle] = useState(true);
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [teamKeyword, setTeamKeyword] = useState("");
  const [teamStatusFilter, setTeamStatusFilter] =
    useState<TeamStatusFilter>("ALL");

  // 드롭다운 상태
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addSubMenu, setAddSubMenu] = useState<"WORK" | "LEAVE" | null>("WORK");
  const [recordMgmtOpen, setRecordMgmtOpen] = useState(false);
  const [helpModalOpen, setHelpModalOpen] = useState(false);

  // API 데이터 상태
  const [todayStr, setTodayStr] = useState(() => toYmd(new Date()));
  const [myToday, setMyToday] = useState<HqAttendanceRecord | null>(null);
  const [myWeeklyMinutes, setMyWeeklyMinutes] = useState(0);
  const [records, setRecords] = useState<HqAttendanceRecord[]>([]);
  const [leaveApprovals, setLeaveApprovals] = useState<LeaveApprovalLite[]>([]);
  const [realtimeLogs, setRealtimeLogs] = useState<HqRealtimeWorkLog[]>([]);
  const [recognizedSchedules, setRecognizedSchedules] = useState<
    HqRecognizedDaySchedule[]
  >([]);
  const [pendingWorkApprovals, setPendingWorkApprovals] = useState<
    PendingWorkApprovalLite[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 상단 실시간 스튜디오 입력 상태
  const [selectedMode, setSelectedMode] = useState<HqWorkMode>("OFFICE");
  const [locationNote, setLocationNote] = useState(
    ATTENDANCE_MODES.OFFICE.defaultLocation
  );
  const [memo, setMemo] = useState("");

  // 플렉스 인라인 인정 근무(굵은 막대) 편집 팝오버 + 변경 드래프트 + 승인·참조 우측 패널 상태
  const [inlineTarget, setInlineTarget] =
    useState<InlineWorkPopoverTarget | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, DraftWorkEdit>>(
    {}
  );
  const [approvalPanelOpen, setApprovalPanelOpen] = useState(false);
  const [approvalReasonByKey, setApprovalReasonByKey] = useState<
    Record<string, string>
  >({});

  // 플렉스 날짜 행 [+] 메뉴 & 블록 하단 '휴게 N건 / 휴게 없음' 팝오버 & 타임라인 드래그/리사이즈 상태
  const [rowAddMenu, setRowAddMenu] = useState<{
    member: HqMember;
    ymd: string;
    anchorRect: {
      top: number;
      bottom: number;
      left: number;
      right: number;
      width: number;
    };
  } | null>(null);
  const [breakListPopover, setBreakListPopover] = useState<{
    member: HqMember;
    ymd: string;
    segmentId: string;
    anchorRect: {
      top: number;
      bottom: number;
      left: number;
      right: number;
      width: number;
    };
  } | null>(null);
  const [activeDrag, setActiveDrag] = useState<{
    dayKey: string;
    kind: "SEGMENT" | "BREAK";
    itemId: string;
    startMin: number;
    endMin: number;
  } | null>(null);

  // 플렉스 실시간 근무 기록(굵은 막대 위의 가느다란 막대) 툴팁 & [실시간 기록 수정] 모달 상태
  const [hoveredRealtimeTip, setHoveredRealtimeTip] = useState<{
    key: string;
    startMin: number;
    endMin: number | null;
    isActiveNow: boolean;
    breaks: HqRealtimeBreakSpan[];
    canEdit: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [realtimeEditModal, setRealtimeEditModal] = useState<{
    member: HqMember;
    workDate: string;
    existingLog: HqRealtimeWorkLog | null;
    defaultStartMin: number;
    defaultEndMin: number;
  } | null>(null);

  // 플렉스 휴게 블록(☕ 박스 및 '휴게 N건') 호버 다크 툴팁 상태
  const [hoveredBreakTip, setHoveredBreakTip] = useState<{
    key: string;
    windows: { startMin: number; endMin: number }[];
    rect: { top: number; bottom: number; left: number; width: number };
  } | null>(null);

  const showBreakTip = useCallback(
    (
      key: string,
      windows: { startMin: number; endMin: number }[],
      el: HTMLElement
    ) => {
      if (!windows || windows.length === 0) return;
      const r = el.getBoundingClientRect();
      setHoveredBreakTip({
        key,
        windows,
        rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
      });
    },
    []
  );

  const hideBreakTip = useCallback((key: string) => {
    setHoveredBreakTip((prev) => (prev?.key === key ? null : prev));
  }, []);

  // 스크롤/클릭 시 휴게 툴팁 자동 닫기
  useEffect(() => {
    if (!hoveredBreakTip) return;
    const clearTip = () => setHoveredBreakTip(null);
    window.addEventListener("wheel", clearTip, { passive: true });
    window.addEventListener("scroll", clearTip, true);
    window.addEventListener("mousedown", clearTip);
    return () => {
      window.removeEventListener("wheel", clearTip);
      window.removeEventListener("scroll", clearTip, true);
      window.removeEventListener("mousedown", clearTip);
    };
  }, [hoveredBreakTip]);

  // 모달 상태
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [leaveModalInitialDate, setLeaveModalInitialDate] = useState<
    string | undefined
  >(undefined);
  const [leaveRegisterKind, setLeaveRegisterKind] = useState<LeaveRegisterKind>(
    { type: "ANNUAL" }
  );

  const headerAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowClock(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        headerAreaRef.current &&
        !headerAreaRef.current.contains(e.target as Node)
      ) {
        setPeriodMenuOpen(false);
        setAddMenuOpen(false);
        setRecordMgmtOpen(false);
        setDeptMenuOpen(false);
        setTeamRuleMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // =========================================================================
  // 권한 설정(permission_settings) 4종 독립 판정 (Flex 90c09d61 / 8e9c06fa / 6c7699e3 동일!)
  // 1) [근무 편집 (work.record_edit)] -> 굵은 막대(인정 근무)만 수정 가능 (+ 반복 일정 활성화)
  // 2) [구성원 실시간 근무 기록 편집 (work.realtime_edit)] -> 가느다란 막대(실시간 기록)만 수정 가능
  // 3) [구성원 실시간 근무 기록 조회 (work.realtime_view)] -> 지나간 날짜의 가느다란 막대 조회 가능
  // 4) [근무 조회 (work.record_view)] -> 타 구성원의 굵은 막대(인정 근무) 조회 가능
  // =========================================================================
  const canEditTargetWork = useCallback(
    (target: HqMember | null | undefined): boolean => {
      if (!target) return false;
      return Boolean(canAccessTargetPerm("work.record_edit", target));
    },
    [canAccessTargetPerm]
  );

  const canEditSelfWork = useMemo(
    () => Boolean(me && canEditTargetWork(me)),
    [canEditTargetWork, me]
  );

  const canEditRealtimeWork = useCallback(
    (target: HqMember | null | undefined): boolean => {
      if (!target) return false;
      return Boolean(canAccessTargetPerm("work.realtime_edit", target));
    },
    [canAccessTargetPerm]
  );

  const canViewPastRealtime = useCallback(
    (target: HqMember | null | undefined): boolean => {
      if (!target) return false;
      return Boolean(
        canAccessTargetPerm("work.realtime_view", target) ||
          canAccessTargetPerm("work.realtime_edit", target)
      );
    },
    [canAccessTargetPerm]
  );

  const canViewRecognizedWork = useCallback(
    (target: HqMember | null | undefined): boolean => {
      if (!target) return false;
      if (target.instructor_id === me?.instructor_id) return true;
      return Boolean(
        canAccessTargetPerm("work.record_view", target) ||
          canAccessTargetPerm("work.record_edit", target)
      );
    },
    [canAccessTargetPerm, me?.instructor_id]
  );

  const canViewTargetWork = useCallback(
    (target: HqMember | null | undefined): boolean => {
      if (!target) return false;
      return Boolean(canViewRecognizedWork(target) || canViewPastRealtime(target));
    },
    [canViewPastRealtime, canViewRecognizedWork]
  );

  const canViewAnyOtherMember = useMemo(
    () =>
      Boolean(
        isHqAdmin ||
          hasHqPerm("work.record_view") ||
          hasHqPerm("work.record_edit") ||
          hasHqPerm("work.realtime_view") ||
          hasHqPerm("work.realtime_edit")
      ),
    [hasHqPerm, isHqAdmin]
  );

  const canDownloadStats = useMemo(
    () => Boolean(isHqAdmin || hasHqPerm("work.stats_view")),
    [hasHqPerm, isHqAdmin]
  );

  const activeMembers = useMemo(() => {
    const filtered = members.filter((m) => m.work_status === "재직");
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [members]);

  // 구성원 근무 탭에 노출할 허용 범위 구성원 목록
  const viewableTeamMembers = useMemo(() => {
    if (!canViewAnyOtherMember) return [];
    return activeMembers.filter((m) => canViewTargetWork(m));
  }, [activeMembers, canViewAnyOtherMember, canViewTargetWork]);

  const editableMembers = useMemo(
    () => activeMembers.filter((m) => canEditTargetWork(m)),
    [activeMembers, canEditTargetWork]
  );

  const departments = useMemo(() => {
    const s = new Set<string>();
    viewableTeamMembers.forEach((m) => {
      if (m.department) s.add(m.department);
    });
    return Array.from(s);
  }, [viewableTeamMembers]);

  // 회사 설정 연동: 근무 유형 / 근무 정책 / 맞춤 휴가 / 회사 공휴일
  const workRules: HqWorkRuleItem[] = useMemo(() => {
    const list = companySettings?.extra_settings?.work_rules;
    return Array.isArray(list) && list.length > 0 ? list : DEFAULT_WORK_RULES;
  }, [companySettings]);

  const workFormPolicies: HqWorkFormPolicy[] = useMemo(() => {
    const list = companySettings?.extra_settings?.work_form_policies;
    return Array.isArray(list) && list.length > 0
      ? list
      : DEFAULT_WORK_FORM_POLICIES;
  }, [companySettings]);

  const customLeaves: HqCustomLeaveItem[] = useMemo(() => {
    const list = companySettings?.extra_settings?.custom_leaves;
    return Array.isArray(list) && list.length > 0 ? list : DEFAULT_CUSTOM_LEAVES;
  }, [companySettings]);

  const holidayMap = useMemo(() => {
    const map = new Map<string, HqHolidayItem>();
    const byYear = companySettings?.holidays_by_year || {};
    Object.values(byYear).forEach((items) => {
      (items || []).forEach((h) => {
        if (!h.start_date) return;
        const end = h.end_date || h.start_date;
        buildDateList(h.start_date, end).forEach((d) => map.set(d, h));
      });
    });
    return map;
  }, [companySettings]);

  // 구성원별 적용 근무 유형 탐색
  const resolveMemberWorkRule = useCallback(
    (memberName?: string, scheduleHint?: string): HqWorkRuleItem => {
      if (memberName) {
        const matched = workRules.find((r) =>
          (r.assigned_members || []).some(
            (am) => am.name === memberName && am.status === "ACTIVE"
          )
        );
        if (matched) return matched;
      }
      if (scheduleHint) {
        const byName = workRules.find((r) => r.name === scheduleHint);
        if (byName) return byName;
      }
      return (
        workRules.find((r) => r.id === "wr-basic-9") ||
        workRules.find((r) => r.name.includes("기본")) ||
        DEFAULT_WORK_RULES[3] ||
        DEFAULT_WORK_RULES[0]
      );
    },
    [workRules]
  );

  const myRule = useMemo(
    () =>
      resolveMemberWorkRule(
        me?.name,
        me?.profile_extra?.work_schedule_type
      ),
    [me, resolveMemberWorkRule]
  );

  // 현재 탭 및 주기에 따른 조회 시작일~종료일 산출
  const activeQueryRange = useMemo(() => {
    if (mainTab === "MY") {
      if (myPeriodMode === "MONTH") {
        return getMonthRangeOfYmd(myAnchorDate);
      }
      if (myPeriodMode === "CYCLE") {
        const cycStart = getCycleStartOfYmd(
          myAnchorDate,
          myRule.cycle_start_day
        );
        return { start: cycStart, end: addDaysYmd(cycStart, 6) };
      }
      const mon = getMondayOfYmd(myAnchorDate);
      return { start: mon, end: addDaysYmd(mon, 6) };
    }
    if (teamPeriodMode === "DAY") {
      return { start: teamAnchorDate, end: teamAnchorDate };
    }
    if (teamPeriodMode === "MONTH") {
      return getMonthRangeOfYmd(teamAnchorDate);
    }
    if (teamPeriodMode === "CYCLE") {
      const targetRule =
        teamRuleFilter !== "ALL"
          ? workRules.find((r) => r.id === teamRuleFilter)
          : undefined;
      const cycStart = getCycleStartOfYmd(
        teamAnchorDate,
        targetRule?.cycle_start_day || "월요일"
      );
      return { start: cycStart, end: addDaysYmd(cycStart, 6) };
    }
    const mon = getMondayOfYmd(teamAnchorDate);
    return { start: mon, end: addDaysYmd(mon, 6) };
  }, [
    mainTab,
    myPeriodMode,
    myAnchorDate,
    myRule.cycle_start_day,
    teamPeriodMode,
    teamAnchorDate,
    teamRuleFilter,
    workRules,
  ]);

  const loadAttendance = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          todayStr: string;
          myToday: HqAttendanceRecord | null;
          myWeeklyMinutes: number;
          records: HqAttendanceRecord[];
          leaveApprovals?: LeaveApprovalLite[];
          realtimeLogs?: HqRealtimeWorkLog[];
          recognizedSchedules?: HqRecognizedDaySchedule[];
          pendingWorkApprovals?: PendingWorkApprovalLite[];
        };
      }>(
        `/api/hq/attendance?start_date=${activeQueryRange.start}&end_date=${activeQueryRange.end}`
      );
      if (res.data?.todayStr) setTodayStr(res.data.todayStr);
      setMyToday(res.data?.myToday || null);
      setMyWeeklyMinutes(res.data?.myWeeklyMinutes || 0);
      setRecords(res.data?.records || []);
      setLeaveApprovals(res.data?.leaveApprovals || []);
      setRealtimeLogs(res.data?.realtimeLogs || []);
      setRecognizedSchedules(res.data?.recognizedSchedules || []);
      setPendingWorkApprovals(res.data?.pendingWorkApprovals || []);

      if (res.data?.myToday) {
        const m = res.data.myToday.work_mode;
        if (m !== "LEAVE") setSelectedMode(m);
        setLocationNote(
          res.data.myToday.location_note ||
            ATTENDANCE_MODES[m]?.defaultLocation ||
            ""
        );
        setMemo(res.data.myToday.memo || "");
      }
    } catch {
      // ignore initial schema missing error
    } finally {
      setLoading(false);
    }
  }, [activeQueryRange.start, activeQueryRange.end]);

  useEffect(() => {
    loadAttendance();
    const onSync = () => loadAttendance();
    window.addEventListener("hq:attendance-updated", onSync);
    window.addEventListener("hq:approval-updated", onSync);
    return () => {
      window.removeEventListener("hq:attendance-updated", onSync);
      window.removeEventListener("hq:approval-updated", onSync);
    };
  }, [loadAttendance]);

  // (instructor_id + work_date) 빠른 조회 맵
  const recordByMemberDate = useMemo(() => {
    const m = new Map<string, HqAttendanceRecord>();
    records.forEach((r) => m.set(`${r.instructor_id}__${r.work_date}`, r));
    return m;
  }, [records]);

  const realtimeLogByMemberDate = useMemo(() => {
    const m = new Map<string, HqRealtimeWorkLog>();
    realtimeLogs.forEach((rt) => m.set(`${rt.instructor_id}__${rt.work_date}`, rt));
    return m;
  }, [realtimeLogs]);

  const recognizedScheduleByMemberDate = useMemo(() => {
    const m = new Map<string, HqRecognizedDaySchedule>();
    recognizedSchedules.forEach((sc) =>
      m.set(`${sc.instructor_id}__${sc.work_date}`, sc)
    );
    return m;
  }, [recognizedSchedules]);

  const pendingWorkApprovalByMemberDate = useMemo(() => {
    const m = new Map<string, PendingWorkApprovalLite>();
    pendingWorkApprovals.forEach((pa) =>
      m.set(`${pa.target_member_id}__${pa.work_date}`, pa)
    );
    return m;
  }, [pendingWorkApprovals]);

  const leaveApprovalByMemberDate = useMemo(() => {
    const m = new Map<string, LeaveApprovalLite>();
    leaveApprovals.forEach((doc) => {
      if (!doc.effective_date) return;
      const end = doc.end_date || doc.effective_date;
      buildDateList(doc.effective_date, end).forEach((d) => {
        m.set(`${doc.drafter_id}__${d}`, doc);
      });
    });
    return m;
  }, [leaveApprovals]);

  // 현재 KST 시각(분) — 타임라인 실시간 세로선 표시용
  const nowMinutesOfDay = useMemo(() => {
    const kst = new Date(nowClock.getTime() + 9 * 60 * 60 * 1000);
    return kst.getUTCHours() * 60 + kst.getUTCMinutes();
  }, [nowClock]);

  const nowKoreanLabel = useMemo(
    () => formatMinutesToKoreanAmPm(nowMinutesOfDay),
    [nowMinutesOfDay]
  );

  // 오늘 내 실시간 경과 근무분 계산 (상단 체크인 스튜디오 배지용)
  const liveTodayElapsedMinutes = useMemo(() => {
    if (!myToday) return 0;
    if (myToday.status === "WORKING" && myToday.check_in_at) {
      const elapsed = Math.max(
        0,
        Math.round(
          (nowClock.getTime() - new Date(myToday.check_in_at).getTime()) / 60000
        )
      );
      return Math.max(0, elapsed - (elapsed >= 300 ? 60 : 0));
    }
    return Number(myToday.worked_minutes || 0);
  }, [myToday, nowClock]);

  // 내 근무 주간/월간 날짜 리스트
  const myWeekDates = useMemo(() => {
    const all = buildDateList(activeQueryRange.start, activeQueryRange.end);
    if (showWeekends) return all;
    return all.filter((ymd) => {
      const dow = parseYmdLocal(ymd).getDay();
      return dow !== 0 && dow !== 6;
    });
  }, [activeQueryRange.start, activeQueryRange.end, showWeekends]);

  const draftList = useMemo(() => Object.values(draftEdits), [draftEdits]);

  // 내 근무 주기(주간) 총 시간 계산 — 플렉스 규칙대로 굵은 막대(인정 근무) 기준으로만 산정!
  const myPeriodStats = useMemo(() => {
    const fullDates = buildDateList(
      activeQueryRange.start,
      activeQueryRange.end
    );
    let totalEffectiveMin = 0;
    let totalLoggedMin = 0;
    let totalOvertimeMin = 0;

    fullDates.forEach((ymd) => {
      const key = me ? `${me.instructor_id}__${ymd}` : "";
      const draft = key ? draftEdits[key] : undefined;
      const storedSched = key ? recognizedScheduleByMemberDate.get(key) : undefined;
      const rec = me ? recordByMemberDate.get(key) : undefined;
      const dowKo = WEEKDAY_KO[parseYmdLocal(ymd).getDay()];
      const isHoliday = holidayMap.has(ymd);
      const isWorkDay = myRule.work_days.includes(dowKo) && !isHoliday;
      const ruleDailyMin =
        Number(myRule.daily_work_hours || 8) * 60 +
        Number(myRule.daily_work_minutes || 0);

      if (draft) {
        if (draft.actionMode === "DELETE") {
          return;
        }
        const m = calcDraftNetWorkedMinutes(draft);
        totalLoggedMin += m;
        totalEffectiveMin += m;
        totalOvertimeMin += Math.max(0, m - ruleDailyMin);
        return;
      }

      if (storedSched) {
        const sum = calcDayScheduleSummary(
          storedSched.segments,
          storedSched.breaks,
          ruleDailyMin
        );
        totalLoggedMin += sum.workedMinutes;
        totalEffectiveMin += sum.workedMinutes;
        totalOvertimeMin += sum.overtimeMinutes;
        return;
      }

      if (rec) {
        let m = Number(rec.worked_minutes || 0);
        if (rec.status === "WORKING") {
          m = ruleDailyMin; // 당일 근무 진행 중에도 인정 근무(굵은 막대) 소정근로 시간 유지
        } else if (rec.status === "LEAVE" && rec.work_mode === "LEAVE") {
          m = ruleDailyMin;
        }
        totalLoggedMin += m;
        totalEffectiveMin += m;
        totalOvertimeMin += Number(
          rec.overtime_minutes || Math.max(0, m - ruleDailyMin)
        );
      } else if (isWorkDay) {
        totalEffectiveMin += ruleDailyMin;
      }
    });

    return {
      totalEffectiveMin,
      totalLoggedMin,
      totalOvertimeMin,
    };
  }, [
    activeQueryRange.start,
    activeQueryRange.end,
    me,
    draftEdits,
    recognizedScheduleByMemberDate,
    recordByMemberDate,
    holidayMap,
    myRule,
  ]);

  // 플렉스 근무 설정(승인·참조 조건 + 근무 정책) 기반 변경 일정 승인·참조 평가
  const evaluatedApprovals = useMemo(
    () =>
      evaluateDraftsApprovalSummary({
        drafts: draftList,
        todayStr,
        weeklyTotalMinutes: myPeriodStats.totalEffectiveMin,
        me,
        members: activeMembers,
        orgNodes: companySettings?.extra_settings?.org_chart_nodes,
        workRules,
        approvalPolicies: companySettings?.extra_settings?.approval_policies,
        workConditionRules: companySettings?.extra_settings?.work_condition_rules,
        workFormPolicies,
        substituteRules: companySettings?.extra_settings?.substitute_approvals,
        reasonByKey: approvalReasonByKey,
      }),
    [
      activeMembers,
      approvalReasonByKey,
      companySettings?.extra_settings?.approval_policies,
      companySettings?.extra_settings?.org_chart_nodes,
      companySettings?.extra_settings?.substitute_approvals,
      companySettings?.extra_settings?.work_condition_rules,
      draftList,
      me,
      myPeriodStats.totalEffectiveMin,
      todayStr,
      workFormPolicies,
      workRules,
    ]
  );

  const draftWarnings = useMemo(() => {
    const warns: string[] = [];
    if (
      mainTab === "MY" &&
      myPeriodMode !== "MONTH" &&
      myPeriodStats.totalEffectiveMin > 3120
    ) {
      warns.push(
        `주 최대 52시간 한도를 ${formatHmColon(
          myPeriodStats.totalEffectiveMin - 3120
        )} 초과했습니다.`
      );
    }
    draftList.forEach((d) => {
      if (
        d.actionMode === "UPSERT" &&
        d.segments.length > 0 &&
        calcDraftNetWorkedMinutes(d) <= 0
      ) {
        warns.push(
          `${d.workDate}: 실근무 시간이 0분입니다. 출·퇴근 시각 또는 휴게 시간을 확인해 주세요.`
        );
      }
    });
    return warns;
  }, [draftList, mainTab, myPeriodMode, myPeriodStats.totalEffectiveMin]);

  // 출근/퇴근/형태변경 핸들러
  const handleQuickCheckIn = async () => {
    setSubmitting(true);
    try {
      await hqFetch("/api/hq/attendance", {
        method: "POST",
        body: {
          action: "CHECK_IN",
          work_mode: selectedMode,
          location_note: locationNote,
          memo,
        },
      });
      await Promise.all([loadAttendance(), refreshAttendanceState()]);
    } catch (err: any) {
      alert(err?.message || "출근 처리에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickUpdateMode = async () => {
    setSubmitting(true);
    try {
      await hqFetch("/api/hq/attendance", {
        method: "POST",
        body: {
          action: "CHANGE_MODE",
          work_mode: selectedMode,
          location_note: locationNote,
          memo,
        },
      });
      await Promise.all([loadAttendance(), refreshAttendanceState()]);
    } catch (err: any) {
      alert(err?.message || "근무형태 변경 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickCheckOut = async () => {
    if (!confirm("오늘 업무를 마무리하고 퇴근 기록을 저장하시겠습니까?")) return;
    setSubmitting(true);
    try {
      await hqFetch("/api/hq/attendance", {
        method: "POST",
        body: { action: "CHECK_OUT", memo },
      });
      await Promise.all([loadAttendance(), refreshAttendanceState()]);
    } catch (err: any) {
      alert(err?.message || "퇴근 처리 실패");
    } finally {
      setSubmitting(false);
    }
  };

  // =========================================================================
  // 일자별 기준 인정 근무 스케줄(다중 근무 블록 + 다중 휴게 블록) 산출 엔진
  // =========================================================================
  const getBaselineDaySchedule = useCallback(
    (member: HqMember, ymd: string) => {
      const key = `${member.instructor_id}__${ymd}`;
      const storedSched = recognizedScheduleByMemberDate.get(key);
      const existing = recordByMemberDate.get(key);
      const lvDoc = leaveApprovalByMemberDate.get(key);
      const rule = resolveMemberWorkRule(
        member.name,
        member.profile_extra?.work_schedule_type
      );
      const dow = parseYmdLocal(ymd).getDay();
      const dowKo = WEEKDAY_KO[dow];
      const holiday = holidayMap.get(ymd);
      const wasScheduledWorkday = rule.work_days.includes(dowKo) && !holiday;
      const isHolidayOrOff = !wasScheduledWorkday;

      const dayCustom =
        rule.per_day_custom_enabled && rule.per_day_schedule?.[dowKo]
          ? rule.per_day_schedule[dowKo]
          : null;
      const ruleStartMin =
        parseHmToMinutes(dayCustom?.start_time || rule.start_time) ?? 540;
      const ruleWorkMin =
        Number(dayCustom ? dayCustom.work_hours : rule.daily_work_hours ?? 8) *
          60 +
        Number(
          dayCustom ? dayCustom.work_minutes : rule.daily_work_minutes ?? 0
        );
      const b1Start = parseHmToMinutes(rule.break_start_1);
      const b1End = parseHmToMinutes(rule.break_end_1);
      const b2Start = parseHmToMinutes(rule.break_start_2);
      const b2End = parseHmToMinutes(rule.break_end_2);
      const ruleBreakMin = calcBreakMinutes(rule);
      const ruleEndMin = ruleStartMin + ruleWorkMin + ruleBreakMin;

      const leaveLabel = String(
        lvDoc?.leave_type ||
          (existing?.work_mode === "LEAVE" ? existing.location_note : "") ||
          ""
      );
      const isHalfAm = leaveLabel.includes("오전 반차");
      const isHalfPm =
        leaveLabel.includes("오후 반차") ||
        ((existing?.status === "HALF_LEAVE" || leaveLabel.includes("반차")) &&
          !isHalfAm);
      const isHourlyLeave =
        leaveLabel.includes("반반차") || leaveLabel.includes("시간차");
      const hasFullLeave =
        (existing?.work_mode === "LEAVE" &&
          existing?.status !== "HALF_LEAVE") ||
        existing?.status === "LEAVE" ||
        (Boolean(lvDoc) && !isHalfAm && !isHalfPm && !isHourlyLeave);

      let segments: HqRecognizedWorkSegment[] = [];
      let breaks: HqRecognizedBreakBlock[] = [];
      let hadExistingRecord = Boolean(existing || storedSched);

      if (hasFullLeave) {
        segments = [];
        breaks = [];
      } else if (storedSched) {
        segments = (storedSched.segments || []).map((s, idx) => ({
          ...s,
          id: s.id || `seg-stored-${idx}`,
        }));
        breaks = (storedSched.breaks || []).map((b, idx) => ({
          ...b,
          id: b.id || `brk-stored-${idx}`,
        }));
      } else if (existing && existing.check_in_at) {
        const actualInMin =
          isoToMinutesOfDay(existing.check_in_at, ymd) ?? ruleStartMin;
        const isCurrentlyWorkingToday =
          existing.status === "WORKING" &&
          !existing.check_out_at &&
          ymd === todayStr;
        const recognizedOutMin = isCurrentlyWorkingToday
          ? Math.max(ruleEndMin, actualInMin + 60)
          : Math.max(
              actualInMin + 15,
              isoToMinutesOfDay(existing.check_out_at, ymd) ?? ruleEndMin
            );
        const baseMode: HqWorkMode =
          existing.work_mode && existing.work_mode !== "LEAVE"
            ? existing.work_mode
            : "OFFICE";
        const basePolicyName =
          baseMode === "REMOTE"
            ? "원격근무"
            : baseMode === "OUTSIDE"
              ? existing.location_note === "출장지"
                ? "출장"
                : "외근"
              : baseMode.startsWith("FLEX_")
                ? ATTENDANCE_MODES[baseMode]?.shortLabel || "근무"
                : "근무";

        segments = [
          {
            id: "seg-rec-0",
            work_mode: baseMode,
            policy_name: basePolicyName,
            in_minutes: actualInMin,
            out_minutes: recognizedOutMin,
            location_note:
              existing.location_note ||
              ATTENDANCE_MODES[baseMode]?.defaultLocation,
            memo: existing.memo || undefined,
          },
        ];

        const recBreakWins = resolveBreakWindowsForSpan({
          inMinutes: actualInMin,
          outMinutes: recognizedOutMin,
          breakMinutes: existing.break_minutes ?? ruleBreakMin,
          rule,
        });
        breaks = recBreakWins.map((w, idx) => ({
          id: `brk-rec-${idx}`,
          start_minutes: w.start_minutes,
          end_minutes: w.end_minutes,
        }));
      } else if (wasScheduledWorkday) {
        const workBarStart = isHalfAm
          ? ruleStartMin + 240 + ruleBreakMin
          : ruleStartMin;
        const workBarEnd = isHalfPm ? ruleStartMin + 240 : ruleEndMin;
        segments = [
          {
            id: "seg-plan-0",
            work_mode: "OFFICE",
            policy_name: "근무",
            in_minutes: workBarStart,
            out_minutes: workBarEnd,
            location_note: ATTENDANCE_MODES.OFFICE.defaultLocation,
          },
        ];
        if (!isHalfAm && !isHalfPm) {
          if (
            b1Start !== null &&
            b1End !== null &&
            b1End > b1Start &&
            b1Start >= workBarStart &&
            b1End <= workBarEnd
          ) {
            breaks.push({
              id: "brk-plan-0",
              start_minutes: b1Start,
              end_minutes: b1End,
            });
          }
          if (
            b2Start !== null &&
            b2End !== null &&
            b2End > b2Start &&
            b2Start >= workBarStart &&
            b2End <= workBarEnd
          ) {
            breaks.push({
              id: "brk-plan-1",
              start_minutes: b2Start,
              end_minutes: b2End,
            });
          }
        }
        hadExistingRecord = false;
      }

      const summary = calcDayScheduleSummary(segments, breaks, ruleWorkMin);
      const exists = segments.length > 0 || breaks.length > 0;

      const baselineSnapshot: DraftWorkEdit["baselineSnapshot"] = {
        exists,
        policyName: summary.policyName,
        workMode: summary.workMode,
        inMinutes: summary.inMinutes,
        outMinutes: summary.outMinutes,
        breakMinutes: summary.breakMinutes,
        workedMinutes: exists ? summary.workedMinutes : 0,
        overtimeMinutes: exists ? summary.overtimeMinutes : 0,
        segments,
        breaks,
      };

      return {
        key,
        attendanceId: existing?.attendance_id,
        hadExistingRecord,
        wasScheduledWorkday,
        isHolidayOrOff,
        hasFullLeave,
        isHalfAm,
        isHalfPm,
        leaveLabel,
        ruleStartMin,
        ruleWorkMin,
        ruleBreakMin,
        ruleEndMin,
        b1Start,
        b1End,
        segments,
        breaks,
        baselineSnapshot,
      };
    },
    [
      holidayMap,
      leaveApprovalByMemberDate,
      recognizedScheduleByMemberDate,
      recordByMemberDate,
      resolveMemberWorkRule,
      todayStr,
    ]
  );

  const getEffectiveDaySchedule = useCallback(
    (member: HqMember, ymd: string) => {
      const base = getBaselineDaySchedule(member, ymd);
      const draft = draftEdits[base.key];
      if (draft) {
        if (draft.actionMode === "DELETE") {
          return {
            base,
            segments: [] as HqRecognizedWorkSegment[],
            breaks: [] as HqRecognizedBreakBlock[],
            isDeletedDraft: true,
          };
        }
        return {
          base,
          segments: draft.segments,
          breaks: draft.breaks,
          isDeletedDraft: false,
        };
      }
      return {
        base,
        segments: base.segments,
        breaks: base.breaks,
        isDeletedDraft: false,
      };
    },
    [draftEdits, getBaselineDaySchedule]
  );

  const commitScheduleForMemberDate = useCallback(
    (
      member: HqMember,
      ymd: string,
      nextSegments: HqRecognizedWorkSegment[],
      nextBreaks: HqRecognizedBreakBlock[]
    ) => {
      const base = getBaselineDaySchedule(member, ymd);
      const identical = isScheduleIdenticalToBaseline({
        segments: nextSegments,
        breaks: nextBreaks,
        baselineSegments: base.segments,
        baselineBreaks: base.breaks,
      });

      if (
        identical &&
        (base.hadExistingRecord ||
          base.wasScheduledWorkday ||
          (nextSegments.length === 0 && nextBreaks.length === 0))
      ) {
        setDraftEdits((prev) => {
          if (!prev[base.key]) return prev;
          const copy = { ...prev };
          delete copy[base.key];
          return copy;
        });
        return;
      }

      const nextDraft = buildDraftWorkEditFromSchedule({
        key: base.key,
        memberId: member.instructor_id,
        memberName: member.name,
        department: member.department || "미지정",
        workDate: ymd,
        attendanceId: base.attendanceId,
        wasScheduledWorkday: base.wasScheduledWorkday,
        ruleDailyMinutes: base.ruleWorkMin,
        segments: nextSegments,
        breaks: nextBreaks,
        baselineSnapshot: base.baselineSnapshot,
      });

      setDraftEdits((prev) => ({
        ...prev,
        [base.key]: nextDraft,
      }));
    },
    [getBaselineDaySchedule]
  );

  const openItemPopover = useCallback(
    (
      member: HqMember,
      ymd: string,
      targetKind: "SEGMENT" | "BREAK",
      itemId: string,
      anchorEl?: HTMLElement | null,
      initialTimeFocus: "START" | "END" | null = null
    ) => {
      if (!canEditTargetWork(member)) return;
      const base = getBaselineDaySchedule(member, ymd);

      let anchorRect = {
        top: 240,
        bottom: 276,
        left: 420,
        right: 680,
        width: 260,
      };

      const resolveDomAnchor = () => {
        if (typeof document === "undefined") return anchorEl || null;
        if (anchorEl) return anchorEl;
        const selector =
          targetKind === "BREAK"
            ? `[data-break-box="${base.key}__${itemId}"]`
            : `[data-work-seg="${base.key}__${itemId}"]`;
        return (
          (document.querySelector(selector) as HTMLElement | null) ||
          (document.querySelector(
            `[data-work-bar="${base.key}"]`
          ) as HTMLElement | null)
        );
      };

      const el = resolveDomAnchor();
      if (el) {
        const r = el.getBoundingClientRect();
        anchorRect = {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          width: r.width,
        };
      }

      setRowAddMenu(null);
      setBreakListPopover(null);
      setHoveredBreakTip(null);

      setInlineTarget({
        key: base.key,
        targetKind,
        itemId,
        initialTimeFocus,
        memberId: member.instructor_id,
        memberName: member.name,
        department: member.department || "미지정",
        workDate: ymd,
        attendanceId: base.attendanceId,
        hadExistingRecord: base.hadExistingRecord,
        wasScheduledWorkday: base.wasScheduledWorkday,
        isHolidayOrOff: base.isHolidayOrOff,
        ruleDailyMinutes: base.ruleWorkMin,
        anchorRect,
        baselineSegments: base.segments,
        baselineBreaks: base.breaks,
      });
    },
    [canEditTargetWork, getBaselineDaySchedule]
  );

  // 기존 근무 블록을 없애지 않고 새 근무 블록(근무/외근/원격근무/출장)을 추가!
  const addWorkSegmentForDate = useCallback(
    (
      targetMember: HqMember | null,
      ymd: string,
      policyName = "근무",
      workMode: HqWorkMode = "OFFICE",
      defaultLoc?: string
    ) => {
      const member = targetMember || me;
      if (!member || !canEditTargetWork(member)) return;

      const { base, segments, breaks } = getEffectiveDaySchedule(member, ymd);
      const slot = findNextFreeSegmentSlot({
        existingSegments: segments,
        preferredDuration: 60,
        ruleStartMin: base.ruleStartMin,
        ruleEndMin: base.ruleEndMin,
      });

      const newSegId = `seg-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      const loc =
        defaultLoc ||
        (policyName === "출장"
          ? "출장지"
          : policyName === "외근"
            ? "외근지"
            : ATTENDANCE_MODES[workMode]?.defaultLocation || "본사 편집·연구실");

      const nextSegments: HqRecognizedWorkSegment[] = [
        ...segments,
        {
          id: newSegId,
          work_mode: workMode,
          policy_name: policyName,
          in_minutes: slot.in_minutes,
          out_minutes: slot.out_minutes,
          location_note: loc,
        },
      ];

      // 휴일 등 근무 블록이 하나도 없던 날 첫 전체 구간을 생성할 때만 기본 휴게 1건 포함 (기존 블록 뒤에 추가할 때는 휴게 없음 유지)
      const nextBreaks: HqRecognizedBreakBlock[] = [...breaks];
      if (
        slot.isInitialFullSpan &&
        nextBreaks.length === 0 &&
        base.b1Start !== null &&
        base.b1End !== null &&
        base.b1Start >= slot.in_minutes &&
        base.b1End <= slot.out_minutes
      ) {
        nextBreaks.push({
          id: `brk-${Date.now()}`,
          start_minutes: base.b1Start,
          end_minutes: base.b1End,
        });
      }

      commitScheduleForMemberDate(member, ymd, nextSegments, nextBreaks);

      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            openItemPopover(member, ymd, "SEGMENT", newSegId, null, null);
          });
        });
      }
    },
    [
      canEditTargetWork,
      commitScheduleForMemberDate,
      getEffectiveDaySchedule,
      me,
      openItemPopover,
    ]
  );

  // 기존 휴게 블록을 없애지 않고 새 휴게 시간 블록을 추가!
  const addBreakBlockForDate = useCallback(
    (
      targetMember: HqMember | null,
      ymd: string,
      targetSegmentId?: string | null
    ) => {
      const member = targetMember || me;
      if (!member || !canEditTargetWork(member)) return;

      const { base, segments, breaks } = getEffectiveDaySchedule(member, ymd);
      const targetSeg = targetSegmentId
        ? segments.find((s) => s.id === targetSegmentId) || null
        : null;

      const slot = findNextFreeBreakSlot({
        existingBreaks: breaks,
        targetSegment: targetSeg,
        allSegments: segments,
        ruleBreakStart: base.b1Start,
        ruleBreakEnd: base.b1End,
      });

      const newBreakId = `brk-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      const nextBreaks: HqRecognizedBreakBlock[] = [
        ...breaks,
        {
          id: newBreakId,
          start_minutes: slot.start_minutes,
          end_minutes: slot.end_minutes,
        },
      ];

      commitScheduleForMemberDate(member, ymd, segments, nextBreaks);
      setBreakListPopover(null);

      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            openItemPopover(member, ymd, "BREAK", newBreakId, null, null);
          });
        });
      }
    },
    [
      canEditTargetWork,
      commitScheduleForMemberDate,
      getEffectiveDaySchedule,
      me,
      openItemPopover,
    ]
  );

  const deleteBreakBlockForDate = useCallback(
    (member: HqMember, ymd: string, breakId: string) => {
      if (!canEditTargetWork(member)) return;
      const { segments, breaks } = getEffectiveDaySchedule(member, ymd);
      const nextBreaks = breaks.filter((b) => b.id !== breakId);
      commitScheduleForMemberDate(member, ymd, segments, nextBreaks);
    },
    [canEditTargetWork, commitScheduleForMemberDate, getEffectiveDaySchedule]
  );

  const openRowAddMenuForDate = useCallback(
    (targetMember: HqMember | null, ymd: string, btnEl: HTMLElement) => {
      const member = targetMember || me;
      if (!member) return;
      const r = btnEl.getBoundingClientRect();
      setInlineTarget(null);
      setBreakListPopover(null);
      setHoveredBreakTip(null);
      setRowAddMenu((prev) =>
        prev &&
        prev.member.instructor_id === member.instructor_id &&
        prev.ymd === ymd
          ? null
          : {
              member,
              ymd,
              anchorRect: {
                top: r.top,
                bottom: r.bottom,
                left: r.left,
                right: r.right,
                width: r.width,
              },
            }
      );
    },
    [me]
  );

  // 호환용 엔트리 오픈 헬퍼 (상단 오늘 기록 수정 / 월간·주간 셀 클릭 등)
  const openEntryForDate = (
    targetMember: HqMember | null,
    ymd: string,
    opts?: {
      presetMode?: HqWorkMode;
      policyLabel?: string;
      focusBreak?: boolean;
      anchorEl?: HTMLElement | null;
    }
  ) => {
    const member = targetMember || me;
    if (!member || !canEditTargetWork(member)) return;

    if (opts?.focusBreak || opts?.policyLabel === "휴게") {
      addBreakBlockForDate(member, ymd, null);
      return;
    }
    if (opts?.policyLabel) {
      addWorkSegmentForDate(
        member,
        ymd,
        opts.policyLabel,
        opts.presetMode || "OFFICE"
      );
      return;
    }

    const { segments } = getEffectiveDaySchedule(member, ymd);
    if (segments.length > 0) {
      openItemPopover(
        member,
        ymd,
        "SEGMENT",
        segments[0].id,
        opts?.anchorEl || null,
        null
      );
    } else {
      addWorkSegmentForDate(member, ymd, "근무", "OFFICE");
    }
  };

  // =========================================================================
  // 24시간 타임라인 블록 드래그 이동(앞·뒤 배치) 및 좌·우 끝 시간 늘리기/줄이기 핸들러
  // =========================================================================
  const startTimelineItemPointerDown = (
    e: React.PointerEvent<HTMLElement>,
    params: {
      member: HqMember;
      ymd: string;
      kind: "SEGMENT" | "BREAK";
      itemId: string;
      interaction: "MOVE" | "RESIZE_LEFT" | "RESIZE_RIGHT";
      anchorEl: HTMLElement;
    }
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    const { member, ymd, kind, itemId, interaction, anchorEl } = params;
    if (!canEditTargetWork(member)) return;

    const trackEl = anchorEl.closest(
      "[data-timeline-track]"
    ) as HTMLElement | null;
    if (!trackEl) {
      openItemPopover(member, ymd, kind, itemId, anchorEl, null);
      return;
    }

    const trackRect = trackEl.getBoundingClientRect();
    if (trackRect.width <= 0) return;

    const { base, segments: origSegments, breaks: origBreaks } =
      getEffectiveDaySchedule(member, ymd);
    const origSeg =
      kind === "SEGMENT"
        ? origSegments.find((s) => s.id === itemId) || null
        : null;
    const origBrk =
      kind === "BREAK" ? origBreaks.find((b) => b.id === itemId) || null : null;

    if (kind === "SEGMENT" && !origSeg) return;
    if (kind === "BREAK" && !origBrk) return;

    // 근무 블록 통째 이동 시 그 안에 포함되어 있던 휴게 블록도 함께 평행 이동
    const attachedBreakIds = new Set<string>();
    if (kind === "SEGMENT" && origSeg && interaction === "MOVE") {
      origBreaks.forEach((b) => {
        if (
          b.start_minutes >= origSeg.in_minutes &&
          b.end_minutes <= origSeg.out_minutes
        ) {
          attachedBreakIds.add(b.id);
        }
      });
    }

    const parentSegForBreak =
      kind === "BREAK" && origBrk
        ? origSegments.find(
            (s) =>
              origBrk.start_minutes >= s.in_minutes &&
              origBrk.end_minutes <= s.out_minutes
          ) || null
        : null;

    const startX = e.clientX;
    let hasMoved = false;

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!hasMoved && Math.abs(dx) < 4) {
        return;
      }
      if (!hasMoved) {
        hasMoved = true;
        setInlineTarget(null);
        setBreakListPopover(null);
        setRowAddMenu(null);
        setHoveredBreakTip(null);
      }

      const rawDeltaMin = Math.round((dx / trackRect.width) * 96) * 15;

      if (kind === "SEGMENT" && origSeg) {
        const otherSegs = origSegments.filter((s) => s.id !== origSeg.id);
        let nextIn = origSeg.in_minutes;
        let nextOut = origSeg.out_minutes;

        if (interaction === "MOVE") {
          const dur = origSeg.out_minutes - origSeg.in_minutes;
          const desiredStart = origSeg.in_minutes + rawDeltaMin;
          nextIn = resolveNearestNonOverlappingSlot(
            desiredStart,
            dur,
            otherSegs.map((s) => ({
              start: s.in_minutes,
              end: s.out_minutes,
            })),
            0,
            1440
          );
          nextOut = nextIn + dur;
        } else if (interaction === "RESIZE_LEFT") {
          const prevEnds = otherSegs
            .filter((s) => s.out_minutes <= origSeg.in_minutes)
            .map((s) => s.out_minutes);
          const minIn = prevEnds.length > 0 ? Math.max(...prevEnds) : 0;
          nextIn = Math.max(
            minIn,
            Math.min(origSeg.out_minutes - 15, origSeg.in_minutes + rawDeltaMin)
          );
          nextOut = origSeg.out_minutes;
        } else {
          const nextStarts = otherSegs
            .filter((s) => s.in_minutes >= origSeg.out_minutes)
            .map((s) => s.in_minutes);
          const maxOut = nextStarts.length > 0 ? Math.min(...nextStarts) : 1440;
          nextIn = origSeg.in_minutes;
          nextOut = Math.max(
            origSeg.in_minutes + 15,
            Math.min(maxOut, origSeg.out_minutes + rawDeltaMin)
          );
        }

        const shift = nextIn - origSeg.in_minutes;
        const nextSegments = origSegments.map((s) =>
          s.id === origSeg.id
            ? { ...s, in_minutes: nextIn, out_minutes: nextOut }
            : s
        );
        const nextBreaks =
          interaction === "MOVE" && shift !== 0 && attachedBreakIds.size > 0
            ? origBreaks.map((b) => {
                if (!attachedBreakIds.has(b.id)) return b;
                const bDur = b.end_minutes - b.start_minutes;
                const ns = Math.max(
                  0,
                  Math.min(1440 - bDur, b.start_minutes + shift)
                );
                return { ...b, start_minutes: ns, end_minutes: ns + bDur };
              })
            : origBreaks;

        setActiveDrag({
          dayKey: base.key,
          kind: "SEGMENT",
          itemId: origSeg.id,
          startMin: nextIn,
          endMin: nextOut,
        });
        commitScheduleForMemberDate(member, ymd, nextSegments, nextBreaks);
      } else if (kind === "BREAK" && origBrk) {
        const otherBreaks = origBreaks.filter((b) => b.id !== origBrk.id);
        let nextStart = origBrk.start_minutes;
        let nextEnd = origBrk.end_minutes;

        if (interaction === "MOVE") {
          const dur = origBrk.end_minutes - origBrk.start_minutes;
          const desired = origBrk.start_minutes + rawDeltaMin;
          const minB = parentSegForBreak ? parentSegForBreak.in_minutes : 0;
          const maxB = parentSegForBreak ? parentSegForBreak.out_minutes : 1440;
          nextStart = resolveNearestNonOverlappingSlot(
            desired,
            dur,
            otherBreaks.map((b) => ({
              start: b.start_minutes,
              end: b.end_minutes,
            })),
            minB,
            maxB
          );
          nextEnd = nextStart + dur;
        } else if (interaction === "RESIZE_LEFT") {
          const prevEnds = otherBreaks
            .filter((b) => b.end_minutes <= origBrk.start_minutes)
            .map((b) => b.end_minutes);
          const minStart = Math.max(
            parentSegForBreak ? parentSegForBreak.in_minutes : 0,
            prevEnds.length > 0 ? Math.max(...prevEnds) : 0
          );
          nextStart = Math.max(
            minStart,
            Math.min(
              origBrk.end_minutes - 15,
              origBrk.start_minutes + rawDeltaMin
            )
          );
          nextEnd = origBrk.end_minutes;
        } else {
          const nextStarts = otherBreaks
            .filter((b) => b.start_minutes >= origBrk.end_minutes)
            .map((b) => b.start_minutes);
          const maxEnd = Math.min(
            parentSegForBreak ? parentSegForBreak.out_minutes : 1440,
            nextStarts.length > 0 ? Math.min(...nextStarts) : 1440
          );
          nextStart = origBrk.start_minutes;
          nextEnd = Math.max(
            origBrk.start_minutes + 15,
            Math.min(maxEnd, origBrk.end_minutes + rawDeltaMin)
          );
        }

        const nextBreaks = origBreaks.map((b) =>
          b.id === origBrk.id
            ? { ...b, start_minutes: nextStart, end_minutes: nextEnd }
            : b
        );
        setActiveDrag({
          dayKey: base.key,
          kind: "BREAK",
          itemId: origBrk.id,
          startMin: nextStart,
          endMin: nextEnd,
        });
        commitScheduleForMemberDate(member, ymd, origSegments, nextBreaks);
      }
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setActiveDrag(null);
      if (!hasMoved) {
        openItemPopover(member, ymd, kind, itemId, anchorEl, null);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // 플렉스 [실시간 기록 수정] 모달 열기 ([구성원 실시간 근무 기록 편집 work.realtime_edit] 권한 전용 — 가느다란 막대 독립 수정!)
  const openRealtimeEditForDate = (targetMember: HqMember | null, ymd: string) => {
    const member = targetMember || me;
    if (!member) return;
    if (!canEditRealtimeWork(member)) return;

    const key = `${member.instructor_id}__${ymd}`;
    const storedRt = realtimeLogByMemberDate.get(key) || null;
    const rec = recordByMemberDate.get(key);
    const rule = resolveMemberWorkRule(
      member.name,
      member.profile_extra?.work_schedule_type
    );
    const dowKo = WEEKDAY_KO[parseYmdLocal(ymd).getDay()];
    const holiday = holidayMap.get(ymd);
    const isScheduledWorkday = rule.work_days.includes(dowKo) && !holiday;

    const dayCustom =
      rule.per_day_custom_enabled && rule.per_day_schedule?.[dowKo]
        ? rule.per_day_schedule[dowKo]
        : null;
    const ruleStartMin =
      parseHmToMinutes(dayCustom?.start_time || rule.start_time) ?? 540;
    const ruleWorkMin =
      Number(dayCustom ? dayCustom.work_hours : rule.daily_work_hours ?? 8) *
        60 +
      Number(dayCustom ? dayCustom.work_minutes : rule.daily_work_minutes ?? 0);
    const ruleBreakMin = calcBreakMinutes(rule);
    const ruleEndMin = ruleStartMin + ruleWorkMin + ruleBreakMin;

    // Flex e97c4fe6 정책: 당일 실시간 근무가 진행 중일 때는 편집 불가 (종료 이후에만 가능)
    if (ymd === todayStr) {
      const isLiveRecording =
        Boolean(storedRt?.is_active) ||
        Boolean(rec?.status === "WORKING" && !rec?.check_out_at) ||
        Boolean(
          !storedRt &&
            isScheduledWorkday &&
            rule.auto_record_enabled !== false &&
            nowMinutesOfDay >= ruleStartMin &&
            nowMinutesOfDay < ruleEndMin
        );
      if (isLiveRecording) {
        alert(
          "실시간 근무가 진행 중인 상태에서는 실시간 기록(얇은 줄)을 편집할 수 없어요.\n실시간 근무 종료(퇴근) 이후에 수정해 주세요."
        );
        return;
      }
    }

    const defaultStartMin = rec?.check_in_at
      ? isoToMinutesOfDay(rec.check_in_at, ymd) ?? ruleStartMin
      : ruleStartMin;
    const defaultEndMin =
      rec?.check_out_at && rec.status === "DONE"
        ? isoToMinutesOfDay(rec.check_out_at, ymd) ?? ruleEndMin
        : ruleEndMin;

    setHoveredRealtimeTip(null);
    setRealtimeEditModal({
      member,
      workDate: ymd,
      existingLog: storedRt,
      defaultStartMin,
      defaultEndMin,
    });
  };

  const handleSaveRealtimeModal = async (
    action: "UPSERT_REALTIME_LOG" | "DELETE_REALTIME_LOG",
    payload: Record<string, any>
  ) => {
    try {
      await hqFetch("/api/hq/attendance", {
        method: "POST",
        body: {
          action,
          ...payload,
        },
      });
      await loadAttendance();
    } catch (err: any) {
      alert(err?.message || "실시간 근무 기록 저장에 실패했습니다.");
      throw err;
    }
  };

  const handleUpsertDraft = useCallback((next: DraftWorkEdit) => {
    setDraftEdits((prev) => ({ ...prev, [next.key]: next }));
  }, []);

  const handleClearDraft = useCallback((key: string) => {
    setDraftEdits((prev) => {
      if (!prev[key]) return prev;
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  }, []);

  const handleCancelAllDrafts = useCallback(() => {
    setDraftEdits({});
    setApprovalReasonByKey({});
    setInlineTarget(null);
    setBreakListPopover(null);
    setRowAddMenu(null);
    setApprovalPanelOpen(false);
  }, []);

  const handleSubmitAllDrafts = async () => {
    if (draftList.length === 0) return;

    const missingReason = evaluatedApprovals.find(
      (ev) => ev.reasonRequired && !(approvalReasonByKey[ev.draftKey] || "").trim()
    );
    if (missingReason) {
      setApprovalPanelOpen(true);
      alert(
        `${missingReason.workDate} 일정(${missingReason.triggeredReasons.join(
          ", "
        )})은 사유 입력이 필수입니다. 우측 [승인 · 참조] 패널에서 사유를 입력해 주세요.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const evMap = new Map(evaluatedApprovals.map((e) => [e.draftKey, e]));

      const items = draftList.map((d) => {
        const ev = evMap.get(d.key);
        return {
          mode: d.actionMode,
          instructor_id: d.memberId,
          member_name: d.memberName,
          department: d.department,
          work_date: d.workDate,
          attendance_id: d.attendanceId,
          work_mode: d.workMode,
          check_in_time: minutesToHm24(d.inMinutes),
          check_out_time: minutesToHm24(d.outMinutes),
          break_minutes: d.breakMinutes,
          rule_daily_minutes: d.ruleDailyMinutes,
          segments: d.segments,
          breaks: d.breaks,
          location_note: d.locationNote,
          memo: d.memo,
          requires_approval: Boolean(ev?.requiresApproval),
          approval_steps: ev?.steps || [],
          cc_member_ids: (ev?.ccMembers || [])
            .map((c) => c.id)
            .filter(Boolean),
          cc_member_names: (ev?.ccMembers || [])
            .map((c) => c.name)
            .filter(Boolean),
          work_edit_payload: ev?.payload || null,
        };
      });

      const res = await hqFetch<{
        success: boolean;
        data?: { submittedApprovals?: number };
        submittedApprovals?: number;
      }>("/api/hq/attendance", {
        method: "POST",
        body: {
          action: "BATCH_MANUAL_UPSERT",
          items,
        },
      });

      setDraftEdits({});
      setApprovalReasonByKey({});
      setInlineTarget(null);
      setBreakListPopover(null);
      setRowAddMenu(null);
      setApprovalPanelOpen(false);
      await Promise.all([loadAttendance(), refreshAttendanceState()]);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("hq:approval-updated"));
      }
      const submittedCount =
        res?.data?.submittedApprovals ?? res?.submittedApprovals ?? 0;
      if (submittedCount > 0) {
        alert(
          `승인 대상 일정 ${submittedCount}건이 워크플로우 결재 요청으로 상신되었습니다.`
        );
      }
    } catch (err: any) {
      alert(err?.message || "근무 일정 등록에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  // 날짜 이동 핸들러
  const moveMyPeriod = (dir: -1 | 1) => {
    if (myPeriodMode === "MONTH") {
      const d = parseYmdLocal(myAnchorDate);
      d.setMonth(d.getMonth() + dir);
      setMyAnchorDate(toYmd(d));
    } else {
      setMyAnchorDate((prev) => addDaysYmd(prev, dir * 7));
    }
  };

  const moveTeamPeriod = (dir: -1 | 1) => {
    if (teamPeriodMode === "DAY") {
      setTeamAnchorDate((prev) => addDaysYmd(prev, dir));
    } else if (teamPeriodMode === "MONTH") {
      const d = parseYmdLocal(teamAnchorDate);
      d.setMonth(d.getMonth() + dir);
      setTeamAnchorDate(toYmd(d));
    } else {
      setTeamAnchorDate((prev) => addDaysYmd(prev, dir * 7));
    }
  };

  // 구성원 근무 요약 카운트 (열람 허용 범위 내 구성원 기준)
  const teamSummaryCounts = useMemo(() => {
    let leaveCount = 0;
    let overtimeCount = 0;
    let customWorkCount = 0;
    let workingNowCount = 0;

    const checkDate =
      teamPeriodMode === "DAY" ? teamAnchorDate : todayStr;

    viewableTeamMembers.forEach((m) => {
      if (deptFilter !== "ALL" && m.department !== deptFilter) return;

      const rec = recordByMemberDate.get(`${m.instructor_id}__${checkDate}`);
      const lvDoc = leaveApprovalByMemberDate.get(
        `${m.instructor_id}__${checkDate}`
      );
      const rule = resolveMemberWorkRule(
        m.name,
        m.profile_extra?.work_schedule_type
      );

      if (
        rec?.work_mode === "LEAVE" ||
        rec?.status === "LEAVE" ||
        rec?.status === "HALF_LEAVE" ||
        lvDoc
      ) {
        leaveCount += 1;
      }
      if (rec && Number(rec.overtime_minutes || 0) > 0) {
        overtimeCount += 1;
      }
      if (
        (rec &&
          (rec.work_mode === "REMOTE" ||
            rec.work_mode === "OUTSIDE" ||
            rec.work_mode === "FLEX_08" ||
            rec.work_mode === "FLEX_10" ||
            rec.work_mode === "FLEX_11")) ||
        rule.start_time !== "09:00"
      ) {
        if (
          rec &&
          (rec.work_mode === "REMOTE" ||
            rec.work_mode === "OUTSIDE" ||
            rec.work_mode.startsWith("FLEX_"))
        ) {
          customWorkCount += 1;
        }
      }
      if (rec?.status === "WORKING") {
        workingNowCount += 1;
      }
    });

    return { leaveCount, overtimeCount, customWorkCount, workingNowCount };
  }, [
    viewableTeamMembers,
    deptFilter,
    teamPeriodMode,
    teamAnchorDate,
    todayStr,
    recordByMemberDate,
    leaveApprovalByMemberDate,
    resolveMemberWorkRule,
  ]);

  const filteredTeamMembers = useMemo(() => {
    const checkDate =
      teamPeriodMode === "DAY" ? teamAnchorDate : todayStr;

    return viewableTeamMembers.filter((m) => {
      if (deptFilter !== "ALL" && m.department !== deptFilter) return false;
      if (teamPeriodMode === "CYCLE" && teamRuleFilter !== "ALL") {
        const mRule = resolveMemberWorkRule(
          m.name,
          m.profile_extra?.work_schedule_type
        );
        if (mRule.id !== teamRuleFilter) return false;
      }
      if (teamKeyword.trim()) {
        const q = teamKeyword.trim().toLowerCase();
        if (
          !m.name.toLowerCase().includes(q) &&
          !(m.department || "").toLowerCase().includes(q) &&
          !(m.job_title || "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }

      if (teamStatusFilter !== "ALL") {
        const rec = recordByMemberDate.get(`${m.instructor_id}__${checkDate}`);
        const lvDoc = leaveApprovalByMemberDate.get(
          `${m.instructor_id}__${checkDate}`
        );
        if (teamStatusFilter === "LEAVE") {
          return Boolean(
            rec?.work_mode === "LEAVE" ||
              rec?.status === "LEAVE" ||
              rec?.status === "HALF_LEAVE" ||
              lvDoc
          );
        }
        if (teamStatusFilter === "OVERTIME") {
          return Boolean(rec && Number(rec.overtime_minutes || 0) > 0);
        }
        if (teamStatusFilter === "CUSTOM") {
          return Boolean(
            rec &&
              (rec.work_mode === "REMOTE" ||
                rec.work_mode === "OUTSIDE" ||
                rec.work_mode.startsWith("FLEX_"))
          );
        }
        if (teamStatusFilter === "WORKING") {
          return rec?.status === "WORKING";
        }
      }

      return true;
    });
  }, [
    viewableTeamMembers,
    deptFilter,
    teamRuleFilter,
    resolveMemberWorkRule,
    teamKeyword,
    teamStatusFilter,
    teamPeriodMode,
    teamAnchorDate,
    todayStr,
    recordByMemberDate,
    leaveApprovalByMemberDate,
  ]);

  // 24시간 타임라인 듀얼 레이어 렌더링 (상단 가느다란 막대 = 실시간 근무 기록 / 하단 굵은 막대 = 인정 근무 — Flex 10d26683 & 8e9c06fa 100% 재현)
  const render24hBarForMemberDate = (member: HqMember, ymd: string) => {
    const barKey = `${member.instructor_id}__${ymd}`;
    const draft = draftEdits[barKey];
    const isActivePopover = inlineTarget?.key === barKey;
    const rec = recordByMemberDate.get(barKey);
    const storedRt = realtimeLogByMemberDate.get(barKey);
    const pendingWorkAppr = pendingWorkApprovalByMemberDate.get(barKey);
    const lvDoc = leaveApprovalByMemberDate.get(barKey);
    const canSeeRecognized = canViewRecognizedWork(member);
    const canSeePastRt = canViewPastRealtime(member);
    const canEditRt = canEditRealtimeWork(member);

    const rule = resolveMemberWorkRule(
      member.name,
      member.profile_extra?.work_schedule_type
    );
    const dowKo = WEEKDAY_KO[parseYmdLocal(ymd).getDay()];
    const holiday = holidayMap.get(ymd);
    const isScheduledWorkday = rule.work_days.includes(dowKo) && !holiday;

    const dayCustom =
      rule.per_day_custom_enabled && rule.per_day_schedule?.[dowKo]
        ? rule.per_day_schedule[dowKo]
        : null;
    const ruleStartMin =
      parseHmToMinutes(dayCustom?.start_time || rule.start_time) ?? 540;
    const ruleWorkMin =
      Number(dayCustom ? dayCustom.work_hours : rule.daily_work_hours ?? 8) *
        60 +
      Number(dayCustom ? dayCustom.work_minutes : rule.daily_work_minutes ?? 0);
    const b1Start = parseHmToMinutes(rule.break_start_1);
    const b1End = parseHmToMinutes(rule.break_end_1);
    const ruleBreakMin = calcBreakMinutes(rule);
    const ruleEndMin = ruleStartMin + ruleWorkMin + ruleBreakMin;

    const leaveLabel = String(
      lvDoc?.leave_type ||
        (rec?.work_mode === "LEAVE" ? rec.location_note : "") ||
        ""
    );
    const isHalfAm = leaveLabel.includes("오전 반차");
    const isHalfPm =
      leaveLabel.includes("오후 반차") ||
      ((rec?.status === "HALF_LEAVE" || leaveLabel.includes("반차")) &&
        !isHalfAm);
    const isHourlyLeave =
      leaveLabel.includes("반반차") || leaveLabel.includes("시간차");
    const hasFullLeave =
      !draft &&
      ((rec?.work_mode === "LEAVE" && rec?.status !== "HALF_LEAVE") ||
        rec?.status === "LEAVE" ||
        (Boolean(lvDoc) && !isHalfAm && !isHalfPm && !isHourlyLeave));

    // =========================================================================
    // [Layer 1] 상단 가느다란 막대: 실시간 근무 기록 (굵은 막대 위 top-[3px], h-[4px])
    // - 당일(todayStr): 빨간 현재시각 세로선이 지나간 만큼 실시간으로 가느다란 막대가 채워짐!
    // - 과거(ymd < todayStr): 저장된 실시간 타각/편집 기록(storedRt)이 있고 [구성원 실시간 근무 기록 조회/편집] 권한이 있을 때만 표시 (자동 근무 기록만 있는 지난 날은 미표시!)
    // =========================================================================
    let thinRealtimeOverlay: React.ReactNode = null;
    {
      let rtStart: number | null = null;
      let rtEnd: number | null = null;
      let rtTooltipEnd: number | null = null;
      let rtIsActiveNow = false;
      let rtBreaks: HqRealtimeBreakSpan[] = [];

      if (storedRt && (ymd === todayStr || (ymd < todayStr && canSeePastRt))) {
        rtStart = storedRt.start_min;
        rtIsActiveNow = Boolean(storedRt.is_active && ymd === todayStr);
        if (rtIsActiveNow) {
          rtEnd = Math.max(rtStart + 4, nowMinutesOfDay);
          rtTooltipEnd = null;
        } else {
          const resolvedEnd =
            storedRt.end_min !== null
              ? storedRt.end_min
              : ymd === todayStr
                ? Math.max(rtStart + 4, nowMinutesOfDay)
                : Math.max(rtStart + 30, ruleEndMin);
          rtEnd = Math.max(rtStart + 4, resolvedEnd);
          rtTooltipEnd = storedRt.end_min;
        }
        rtBreaks = storedRt.breaks || [];
      } else if (ymd === todayStr && !hasFullLeave) {
        const autoTodayStart = rec?.check_in_at
          ? isoToMinutesOfDay(rec.check_in_at, ymd) ?? ruleStartMin
          : isHalfAm
            ? ruleStartMin + 240 + ruleBreakMin
            : ruleStartMin;
        const autoTodaySchedEnd = isHalfPm
          ? ruleStartMin + 240
          : rec?.check_out_at && rec.status === "DONE"
            ? isoToMinutesOfDay(rec.check_out_at, ymd) ?? ruleEndMin
            : ruleEndMin;

        const hasLiveProgressToday =
          Boolean(rec?.status === "WORKING") ||
          Boolean(
            (isScheduledWorkday || rec?.check_in_at) &&
              rule.auto_record_enabled !== false &&
              nowMinutesOfDay >= autoTodayStart
          );

        if (hasLiveProgressToday && nowMinutesOfDay >= autoTodayStart) {
          rtStart = autoTodayStart;
          const stillRunning =
            Boolean(rec?.status === "WORKING" && !rec?.check_out_at) ||
            nowMinutesOfDay < autoTodaySchedEnd;
          rtIsActiveNow = stillRunning;
          rtEnd = stillRunning
            ? Math.max(rtStart + 4, nowMinutesOfDay)
            : Math.max(rtStart + 4, Math.min(nowMinutesOfDay, autoTodaySchedEnd));
          rtTooltipEnd = stillRunning ? null : rtEnd;
          rtBreaks =
            !isHalfAm &&
            !isHalfPm &&
            b1Start !== null &&
            b1End !== null &&
            ruleBreakMin > 0
              ? [{ id: "auto-brk", start_min: b1Start, end_min: b1End }]
              : [];
        }
      }

      if (rtStart !== null && rtEnd !== null && rtEnd > rtStart) {
        const rtLeftPct = Math.max(0, Math.min(99, (rtStart / 1440) * 100));
        const rtWidthPct = Math.max(
          0.4,
          Math.min(100 - rtLeftPct, ((rtEnd - rtStart) / 1440) * 100)
        );
        const rtSpan = Math.max(1, rtEnd - rtStart);
        const subSegs = buildRealtimeSubSegments(rtStart, rtEnd, rtBreaks);

        thinRealtimeOverlay = (
          <div
            data-realtime-bar={barKey}
            style={{ left: `${rtLeftPct}%`, width: `${rtWidthPct}%` }}
            onMouseEnter={(e) =>
              setHoveredRealtimeTip({
                key: barKey,
                startMin: rtStart!,
                endMin: rtTooltipEnd,
                isActiveNow: rtIsActiveNow,
                breaks: rtBreaks,
                canEdit: canEditRt,
                x: e.clientX,
                y: e.clientY,
              })
            }
            onMouseMove={(e) =>
              setHoveredRealtimeTip((prev) =>
                prev && prev.key === barKey
                  ? { ...prev, x: e.clientX, y: e.clientY }
                  : {
                      key: barKey,
                      startMin: rtStart!,
                      endMin: rtTooltipEnd,
                      isActiveNow: rtIsActiveNow,
                      breaks: rtBreaks,
                      canEdit: canEditRt,
                      x: e.clientX,
                      y: e.clientY,
                    }
              )
            }
            onMouseLeave={() =>
              setHoveredRealtimeTip((prev) =>
                prev?.key === barKey ? null : prev
              )
            }
            onClick={(e) => {
              e.stopPropagation();
              if (!canEditRt) return;
              openRealtimeEditForDate(member, ymd);
            }}
            className={`absolute top-[3px] h-[11px] flex items-center z-25 ${
              canEditRt
                ? rtIsActiveNow
                  ? "cursor-not-allowed"
                  : "cursor-pointer"
                : "cursor-default"
            }`}
          >
            <div className="w-full h-[4px] rounded-full overflow-hidden flex shadow-[0_0_0_0.5px_rgba(15,118,110,0.12)] transition-all hover:h-[5px]">
              {subSegs.map((seg, sIdx) => (
                <div
                  key={sIdx}
                  style={{
                    width: `${((seg.to - seg.from) / rtSpan) * 100}%`,
                  }}
                  className={
                    seg.isBreak ? "h-full bg-[#bcefeb]" : "h-full bg-[#38c6bd]"
                  }
                />
              ))}
            </div>
          </div>
        );
      }
    }

    // 인정 근무 조회 권한이 없고 실시간 기록 조회 권한만 있는 타 구성원의 경우 얇은 줄만 렌더링
    if (!canSeeRecognized) {
      return thinRealtimeOverlay;
    }

    // =========================================================================
    // [Layer 2] 하단 굵은 막대: 인정 근무 다중 블록 + 다중 휴게 블록 (드래그 이동 & 좌우 리사이즈 & 인라인 시간·휴게 패널 지원)
    // =========================================================================
    const { base, segments, breaks, isDeletedDraft } = getEffectiveDaySchedule(
      member,
      ymd
    );
    const canEditThisMember = canEditTargetWork(member);
    const hasDraft = Boolean(draft);
    const hasStoredMultiSched = Boolean(
      recognizedScheduleByMemberDate.get(barKey)
    );

    // 0) 드래프트로 전체 일정 삭제 예정인 경우
    if (isDeletedDraft) {
      return (
        <>
          {thinRealtimeOverlay}
          <div
            data-work-bar={barKey}
            className="absolute left-[37.5%] top-[20px] text-[11px] font-bold text-slate-400 line-through"
          >
            근무 일정 삭제 예정
          </div>
        </>
      );
    }

    // 1) 종일 휴가 상태인 경우 (드래프트로 근무가 추가되지 않은 상태)
    if (hasFullLeave) {
      const barStart = ruleStartMin;
      const barEnd = ruleEndMin;
      const leftPct = Math.max(0, (barStart / 1440) * 100);
      const widthPct = Math.min(
        100 - leftPct,
        ((barEnd - barStart) / 1440) * 100
      );
      const label = leaveLabel || "연차";
      const isPending = lvDoc && lvDoc.status !== "APPROVED" && !rec;

      return (
        <div
          data-work-bar={barKey}
          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 6)}%` }}
          className="absolute top-[16px] bottom-2 z-10 group"
        >
          <div
            className={`h-6.5 rounded-[5px] border px-2.5 flex items-center justify-between text-[11px] font-extrabold shadow-2xs transition-all ${
              isPending
                ? "bg-purple-50/90 border-purple-400 border-dashed text-purple-800"
                : "bg-[#8b5cf6] border-[#7c3aed] text-white"
            }`}
          >
            <span className="truncate flex items-center gap-1">
              <span>☂</span>
              <span>{label}</span>
              {isPending && (
                <span className="text-[10px] opacity-85">(승인대기)</span>
              )}
            </span>
            <span className="text-[10px] font-bold opacity-90">8h</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-purple-700 font-semibold mt-0.5 px-0.5">
            <span>{formatMinutesToKoreanAmPm(barStart)}</span>
            <span>{formatMinutesToKoreanAmPm(barEnd)}</span>
          </div>
        </div>
      );
    }

    // 반차/시간차 병행 블록 준비
    const halfLeaveOverlay =
      isHalfAm || isHalfPm ? (
        <div
          style={{
            left: `${
              ((isHalfAm ? ruleStartMin : ruleEndMin - 240) / 1440) * 100
            }%`,
            width: `${(240 / 1440) * 100}%`,
          }}
          className="absolute top-[16px] bottom-2 z-15 pointer-events-none"
        >
          <div className="h-6.5 rounded-[5px] bg-[#8b5cf6] border border-[#7c3aed] text-white px-2 flex items-center justify-between text-[10.5px] font-extrabold shadow-2xs">
            <span className="truncate">
              ☂ {isHalfAm ? "오전 반차" : "오후 반차"}
            </span>
            <span className="text-[9.5px] opacity-90">4h</span>
          </div>
        </div>
      ) : null;

    const shouldHidePlannedOnly =
      !hasDraft &&
      !base.hadExistingRecord &&
      base.wasScheduledWorkday &&
      !showPlannedGuide;

    // 2) 인정 근무 블록(다중) 및 휴게 블록(다중) 렌더링
    if (!shouldHidePlannedOnly && (segments.length > 0 || breaks.length > 0)) {
      const otMeta = computeSegmentsOvertimeMeta(
        segments,
        breaks,
        base.ruleWorkMin
      );
      const isCurrentlyWorkingToday =
        Boolean(rec?.status === "WORKING" && !rec?.check_out_at) &&
        ymd === todayStr &&
        !hasDraft;

      return (
        <>
          {thinRealtimeOverlay}
          {halfLeaveOverlay}

          {/* 근무 블록 레이어 (드래그 이동 & 좌우 리사이즈) */}
          {segments.map((seg, segIdx) => {
            const spanMin = Math.max(15, seg.out_minutes - seg.in_minutes);
            const leftPct = Math.max(
              0,
              Math.min(99, (seg.in_minutes / 1440) * 100)
            );
            const widthPct = Math.max(
              0.8,
              Math.min(100 - leftPct, (spanMin / 1440) * 100)
            );
            const vis = getWorkPolicyVisual(seg.policy_name, seg.work_mode);
            const segOt = otMeta[seg.id];
            const segBreaks = getBreaksOverlappingSegment(seg, breaks);

            const isSelectedSeg =
              isActivePopover &&
              inlineTarget?.targetKind === "SEGMENT" &&
              inlineTarget?.itemId === seg.id;
            const isDraggingSeg =
              activeDrag?.dayKey === barKey &&
              activeDrag?.kind === "SEGMENT" &&
              activeDrag?.itemId === seg.id;

            const isFilled =
              hasDraft ||
              hasStoredMultiSched ||
              ymd < todayStr ||
              rec?.status === "DONE" ||
              seg.policy_name !== "근무";

            const boxBorderClass =
              isSelectedSeg || isDraggingSeg
                ? vis.activeBorderClass
                : pendingWorkAppr && segIdx === 0
                  ? "border-amber-400 border-dashed text-amber-900"
                  : isFilled
                    ? vis.solidBorderClass
                    : `${vis.plannedBorderClass} text-[#0f766e]`;

            const showOvertimeStrip =
              !isCurrentlyWorkingToday && (segOt?.overtimeWidthPct || 0) > 0;

            return (
              <div
                key={seg.id}
                data-work-bar={segIdx === 0 ? barKey : undefined}
                data-work-seg={`${barKey}__${seg.id}`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                className={`absolute top-[16px] bottom-2 group/seg ${
                  isSelectedSeg || isDraggingSeg ? "z-20" : "z-12"
                }`}
              >
                {isDraggingSeg && (
                  <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-slate-900 text-white text-[10.5px] font-bold whitespace-nowrap shadow-lg z-40 tabular-nums">
                    {formatMinutesToKoreanAmPm(seg.in_minutes)} –{" "}
                    {seg.out_minutes === 1440
                      ? "오전 12:00"
                      : formatMinutesToKoreanAmPm(seg.out_minutes)}{" "}
                    · {formatDurationKoreanCompact(spanMin)}
                  </div>
                )}

                <div
                  onPointerDown={(e) =>
                    startTimelineItemPointerDown(e, {
                      member,
                      ymd,
                      kind: "SEGMENT",
                      itemId: seg.id,
                      interaction: "MOVE",
                      anchorEl: e.currentTarget,
                    })
                  }
                  onClick={(e) => e.stopPropagation()}
                  className={`relative h-6.5 rounded-[5px] border px-2 flex items-center justify-between overflow-hidden bg-white transition-colors ${boxBorderClass} ${
                    canEditThisMember
                      ? "cursor-grab active:cursor-grabbing hover:brightness-98"
                      : "cursor-default"
                  }`}
                >
                  {isFilled && (
                    <div
                      className={`absolute inset-0 pointer-events-none ${vis.fillClass}`}
                    />
                  )}

                  {showOvertimeStrip && segOt && (
                    <div
                      style={{
                        left: `${segOt.overtimeLeftPct}%`,
                        width: `${segOt.overtimeWidthPct}%`,
                      }}
                      className="pointer-events-none absolute top-0 h-[3px] bg-[#f05638] z-20"
                    />
                  )}

                  {/* 좌측 끝 시간 조절 리사이즈 핸들 */}
                  {canEditThisMember && (
                    <div
                      onPointerDown={(e) => {
                        const parentBox = e.currentTarget
                          .parentElement as HTMLElement | null;
                        if (!parentBox) return;
                        startTimelineItemPointerDown(e, {
                          member,
                          ymd,
                          kind: "SEGMENT",
                          itemId: seg.id,
                          interaction: "RESIZE_LEFT",
                          anchorEl: parentBox,
                        });
                      }}
                      title="좌측 끝을 끌어 시작 시각 조정"
                      className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-30 flex items-center justify-start pl-[1.5px] group/lhandle"
                    >
                      <span className="w-[2px] h-3 rounded-full bg-transparent group-hover/seg:bg-slate-600/35 group-hover/lhandle:!bg-slate-900 transition-colors" />
                    </div>
                  )}

                  {/* 우측 끝 시간 조절 리사이즈 핸들 */}
                  {canEditThisMember && (
                    <div
                      onPointerDown={(e) => {
                        const parentBox = e.currentTarget
                          .parentElement as HTMLElement | null;
                        if (!parentBox) return;
                        startTimelineItemPointerDown(e, {
                          member,
                          ymd,
                          kind: "SEGMENT",
                          itemId: seg.id,
                          interaction: "RESIZE_RIGHT",
                          anchorEl: parentBox,
                        });
                      }}
                      title="우측 끝을 끌어 종료 시각 조정"
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-30 flex items-center justify-end pr-[1.5px] group/rhandle"
                    >
                      <span className="w-[2px] h-3 rounded-full bg-transparent group-hover/seg:bg-slate-600/35 group-hover/rhandle:!bg-slate-900 transition-colors" />
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 min-w-0 z-10 pointer-events-none">
                    <span className={vis.badgeTextClass}>
                      <PolicySvgIcon kind={vis.kind} className="w-3.5 h-3.5" />
                    </span>
                    {seg.policy_name !== "근무" && spanMin >= 75 && (
                      <span className="text-[11px] font-extrabold truncate">
                        {seg.policy_name}
                      </span>
                    )}
                    {pendingWorkAppr && segIdx === 0 && (
                      <span className="px-1.5 py-0.2 rounded bg-amber-100/95 text-amber-800 text-[9.5px] font-extrabold truncate">
                        승인대기 (
                        {formatMinutesToKoreanAmPm(
                          pendingWorkAppr.after_in_minutes
                        )}
                        ~
                        {formatMinutesToKoreanAmPm(
                          pendingWorkAppr.after_out_minutes
                        )}
                        )
                      </span>
                    )}
                  </div>
                </div>

                {/* 블록 아래 클릭 가능한 시각 & '휴게 N건 / 휴게 없음' 라벨 */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-between text-[10px] text-slate-500 font-medium mt-0.5 px-0.5 whitespace-nowrap"
                >
                  <span className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canEditThisMember) return;
                        const segWrap = e.currentTarget.closest(
                          "[data-work-seg]"
                        ) as HTMLElement | null;
                        openItemPopover(
                          member,
                          ymd,
                          "SEGMENT",
                          seg.id,
                          segWrap || e.currentTarget,
                          "START"
                        );
                      }}
                      className={`${
                        canEditThisMember
                          ? "hover:text-slate-900 cursor-pointer"
                          : "cursor-default"
                      } ${isSelectedSeg ? "text-slate-900 font-bold" : ""}`}
                    >
                      {formatMinutesToKoreanAmPm(seg.in_minutes)}
                    </button>

                    <button
                      type="button"
                      onMouseEnter={(e) => {
                        if (segBreaks.length > 0 && !activeDrag) {
                          showBreakTip(
                            `${barKey}__${seg.id}__brk_lbl`,
                            segBreaks.map((w) => ({
                              startMin: w.start_minutes,
                              endMin: w.end_minutes,
                            })),
                            e.currentTarget
                          );
                        }
                      }}
                      onMouseLeave={() =>
                        hideBreakTip(`${barKey}__${seg.id}__brk_lbl`)
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canEditThisMember && segBreaks.length === 0) {
                          return;
                        }
                        const r = e.currentTarget.getBoundingClientRect();
                        setInlineTarget(null);
                        setRowAddMenu(null);
                        setHoveredBreakTip(null);
                        setBreakListPopover((prev) =>
                          prev &&
                          prev.member.instructor_id === member.instructor_id &&
                          prev.ymd === ymd &&
                          prev.segmentId === seg.id
                            ? null
                            : {
                                member,
                                ymd,
                                segmentId: seg.id,
                                anchorRect: {
                                  top: r.top,
                                  bottom: r.bottom,
                                  left: r.left,
                                  right: r.right,
                                  width: r.width,
                                },
                              }
                        );
                      }}
                      className={`text-slate-400 font-normal transition-colors ${
                        canEditThisMember
                          ? "hover:text-slate-700 cursor-pointer"
                          : "cursor-default"
                      }`}
                    >
                      {segBreaks.length > 0
                        ? `휴게 ${segBreaks.length}건`
                        : "휴게 없음"}
                    </button>
                  </span>

                  {spanMin >= 210 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canEditThisMember) return;
                        const segWrap = e.currentTarget.closest(
                          "[data-work-seg]"
                        ) as HTMLElement | null;
                        openItemPopover(
                          member,
                          ymd,
                          "SEGMENT",
                          seg.id,
                          segWrap || e.currentTarget,
                          "END"
                        );
                      }}
                      className={`${
                        canEditThisMember
                          ? "hover:text-slate-900 cursor-pointer"
                          : "cursor-default"
                      } ${
                        showOvertimeStrip
                          ? "text-[#e85d3f] font-bold hover:!text-[#c94124]"
                          : isSelectedSeg
                            ? "text-slate-900 font-bold"
                            : ""
                      }`}
                    >
                      {seg.out_minutes === 1440
                        ? "오전 12:00"
                        : formatMinutesToKoreanAmPm(seg.out_minutes)}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* 휴게 블록 레이어 (다중 휴게 지원 + 드래그 이동 & 좌우 리사이즈) */}
          {breaks.map((brk) => {
            const bDur = Math.max(15, brk.end_minutes - brk.start_minutes);
            const bLeftPct = Math.max(
              0,
              Math.min(99, (brk.start_minutes / 1440) * 100)
            );
            const bWidthPct = Math.max(
              0.7,
              Math.min(100 - bLeftPct, (bDur / 1440) * 100)
            );
            const isInsideAnySeg = segments.some(
              (s) =>
                brk.start_minutes >= s.in_minutes &&
                brk.end_minutes <= s.out_minutes
            );
            const isSelectedBrk =
              isActivePopover &&
              inlineTarget?.targetKind === "BREAK" &&
              inlineTarget?.itemId === brk.id;
            const isDraggingBrk =
              activeDrag?.dayKey === barKey &&
              activeDrag?.kind === "BREAK" &&
              activeDrag?.itemId === brk.id;
            const tipKey = `${barKey}__brk_${brk.id}`;

            return (
              <div
                key={brk.id}
                data-break-box={`${barKey}__${brk.id}`}
                style={{ left: `${bLeftPct}%`, width: `${bWidthPct}%` }}
                className="absolute top-[20px] z-25 group/brk"
              >
                {isDraggingBrk && (
                  <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-slate-900 text-white text-[10.5px] font-bold whitespace-nowrap shadow-lg z-40 tabular-nums">
                    ☕ {formatMinutesToKoreanAmPm(brk.start_minutes)} –{" "}
                    {formatMinutesToKoreanAmPm(brk.end_minutes)} ·{" "}
                    {formatDurationKoreanCompact(bDur)}
                  </div>
                )}

                <div
                  onPointerDown={(e) =>
                    startTimelineItemPointerDown(e, {
                      member,
                      ymd,
                      kind: "BREAK",
                      itemId: brk.id,
                      interaction: "MOVE",
                      anchorEl: e.currentTarget,
                    })
                  }
                  onClick={(e) => e.stopPropagation()}
                  onMouseEnter={(e) => {
                    if (!activeDrag) {
                      showBreakTip(
                        tipKey,
                        [
                          {
                            startMin: brk.start_minutes,
                            endMin: brk.end_minutes,
                          },
                        ],
                        e.currentTarget
                      );
                    }
                  }}
                  onMouseLeave={() => hideBreakTip(tipKey)}
                  className={`relative h-[18px] min-w-[16px] rounded-[3px] bg-white/96 border flex items-center px-1.5 text-[10px] text-slate-500 overflow-hidden transition-colors ${
                    isSelectedBrk || isDraggingBrk
                      ? "border-slate-700 ring-1 ring-slate-600/25"
                      : "border-slate-200/95 hover:border-slate-400"
                  } ${
                    canEditThisMember
                      ? "cursor-grab active:cursor-grabbing"
                      : "cursor-default"
                  }`}
                >
                  {canEditThisMember && (
                    <div
                      onPointerDown={(e) => {
                        const parentBox = e.currentTarget
                          .parentElement as HTMLElement | null;
                        if (!parentBox) return;
                        startTimelineItemPointerDown(e, {
                          member,
                          ymd,
                          kind: "BREAK",
                          itemId: brk.id,
                          interaction: "RESIZE_LEFT",
                          anchorEl: parentBox,
                        });
                      }}
                      title="휴게 시작 시각 조절"
                      className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-30 flex items-center justify-start pl-[1px] group/bl"
                    >
                      <span className="w-[1.5px] h-2.5 rounded-full bg-transparent group-hover/brk:bg-slate-400/70 group-hover/bl:!bg-slate-800" />
                    </div>
                  )}

                  {canEditThisMember && (
                    <div
                      onPointerDown={(e) => {
                        const parentBox = e.currentTarget
                          .parentElement as HTMLElement | null;
                        if (!parentBox) return;
                        startTimelineItemPointerDown(e, {
                          member,
                          ymd,
                          kind: "BREAK",
                          itemId: brk.id,
                          interaction: "RESIZE_RIGHT",
                          anchorEl: parentBox,
                        });
                      }}
                      title="휴게 종료 시각 조절"
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-30 flex items-center justify-end pr-[1px] group/br"
                    >
                      <span className="w-[1.5px] h-2.5 rounded-full bg-transparent group-hover/brk:bg-slate-400/70 group-hover/br:!bg-slate-800" />
                    </div>
                  )}

                  <span className="pointer-events-none text-slate-400 shrink-0">
                    <PolicySvgIcon kind="BREAK" className="w-3 h-3" />
                  </span>
                </div>

                {!isInsideAnySeg && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canEditThisMember) return;
                      openItemPopover(
                        member,
                        ymd,
                        "BREAK",
                        brk.id,
                        e.currentTarget,
                        "START"
                      );
                    }}
                    className="mt-1.5 text-[10px] text-slate-400 hover:text-slate-700 font-medium whitespace-nowrap cursor-pointer"
                  >
                    {formatMinutesToKoreanAmPm(brk.start_minutes)} 휴게
                  </div>
                )}
              </div>
            );
          })}
        </>
      );
    }

    // 4) 공휴일 배지 또는 비근무일 결재대기 표시
    if (pendingWorkAppr) {
      const pStart = pendingWorkAppr.after_in_minutes;
      const pEnd = Math.max(pStart + 60, pendingWorkAppr.after_out_minutes);
      const leftPct = (pStart / 1440) * 100;
      const widthPct = ((pEnd - pStart) / 1440) * 100;
      return (
        <>
          {thinRealtimeOverlay}
          <div
            data-work-bar={barKey}
            style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 6)}%` }}
            className="absolute top-[16px] bottom-2 z-10"
          >
            <div className="h-6.5 rounded-[5px] border border-dashed border-amber-400 bg-amber-50/80 px-2 flex items-center justify-between text-[10.5px] font-extrabold text-amber-800">
              <span className="truncate">
                ⏳ {pendingWorkAppr.after_policy_name} (승인대기)
              </span>
            </div>
          </div>
        </>
      );
    }

    if (holiday) {
      return (
        <>
          {thinRealtimeOverlay}
          <div className="absolute left-4 top-4 text-[11px] font-bold text-rose-500 flex items-center gap-1">
            <span>{holiday.icon || "🎌"}</span>
            <span>{holiday.name}</span>
          </div>
        </>
      );
    }

    return thinRealtimeOverlay;
  };

  // 월간 달력 셀 생성 (내 근무 - 월 뷰: 월요일 시작 + 인접월 날짜 포함 — Screenshot 104312 동일)
  const myMonthCalendarCells = useMemo(() => {
    const { start, end } = getMonthRangeOfYmd(myAnchorDate);
    const gridStart = getMondayOfYmd(start);
    const endDt = parseYmdLocal(end);
    const endDow = endDt.getDay(); // 0=일
    const trailingDays = endDow === 0 ? 0 : 7 - endDow;
    const gridEnd = addDaysYmd(end, trailingDays);
    return buildDateList(gridStart, gridEnd).map((ymd) => ({
      ymd,
      inCurrentMonth: ymd >= start && ymd <= end,
    }));
  }, [myAnchorDate]);

  // 주간 진행률 계산 (소정 40h = 2400m, 상한 52h = 3120m)
  const regularBarPct = Math.min(
    100,
    Math.round((Math.min(myPeriodStats.totalEffectiveMin, 2400) / 2400) * 100)
  );
  const overtimeBarPct = Math.min(
    100,
    Math.round(
      (Math.max(0, myPeriodStats.totalEffectiveMin - 2400) / 720) * 100
    )
  );

  return (
    <div
      ref={headerAreaRef}
      className="min-h-full bg-white flex flex-col select-none"
    >
      {/* =====================================================================
          상단 메인 탭 헤더 (내 근무 | 구성원 근무 + 우측 주기/추가하기 or 근무 기록 관리)
         ===================================================================== */}
      <div className="px-7 pt-5 pb-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-5">
          <div className="flex items-baseline gap-4">
            <button
              type="button"
              onClick={() => setMainTab("MY")}
              className={`text-[22px] tracking-tight font-extrabold transition-colors ${
                mainTab === "MY"
                  ? "text-slate-900"
                  : "text-slate-300 hover:text-slate-500"
              }`}
            >
              내 근무
            </button>
            <button
              type="button"
              onClick={() => setMainTab("TEAM")}
              className={`text-[22px] tracking-tight font-extrabold transition-colors ${
                mainTab === "TEAM"
                  ? "text-slate-900"
                  : "text-slate-300 hover:text-slate-500"
              }`}
            >
              구성원 근무
            </button>
          </div>

          {mainTab === "MY" && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-600">
              <span>⏱️</span>
              <span>
                {myRule.name} ({myRule.start_time} 출근 · 일{" "}
                {myRule.daily_work_hours}시간)
              </span>
            </span>
          )}
        </div>

        {/* 우측 컨트롤 바 */}
        {mainTab === "MY" ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStudioExpanded((v) => !v)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition-colors"
            >
              {studioExpanded ? "출퇴근 바 접기 ▲" : "출퇴근 체크인 펼치기 ▼"}
            </button>

            {/* [주기 ▾] 드롭다운 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setPeriodMenuOpen((v) => !v);
                  setAddMenuOpen(false);
                }}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-800 flex items-center gap-1.5 shadow-2xs"
              >
                <span>
                  {myPeriodMode === "CYCLE"
                    ? "주기"
                    : myPeriodMode === "WEEK"
                    ? "주"
                    : "월"}
                </span>
                <span className="text-[10px] text-slate-400">▾</span>
              </button>

              {periodMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-48 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-40 text-xs">
                  {(
                    [
                      { key: "CYCLE", label: "주기" },
                      { key: "WEEK", label: "주" },
                      { key: "MONTH", label: "월" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => {
                        setMyPeriodMode(opt.key);
                        setPeriodMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700 flex items-center justify-between"
                    >
                      <span>{opt.label}</span>
                      {myPeriodMode === opt.key && (
                        <span className="text-emerald-600 font-bold">✓</span>
                      )}
                    </button>
                  ))}

                  <div className="my-1 border-t border-slate-100" />
                  <div className="px-3.5 py-1.5 flex items-center justify-between text-slate-600">
                    <span className="font-semibold">
                      비율{" "}
                      <span className="text-slate-400 font-bold">
                        {zoomPct}%
                      </span>
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setZoomPct((z) => Math.min(150, z + 10))
                        }
                        className="w-6 h-6 rounded hover:bg-slate-100 font-bold text-slate-700"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => setZoomPct((z) => Math.max(80, z - 10))}
                        className="w-6 h-6 rounded hover:bg-slate-100 font-bold text-slate-700"
                      >
                        −
                      </button>
                    </div>
                  </div>

                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    onClick={() => {
                      setViewSettingsOpen((v) => !v);
                    }}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700 flex items-center justify-between"
                  >
                    <span>조회 설정</span>
                    <span className="text-[10px] text-slate-400">
                      {viewSettingsOpen ? "▴" : "▾"}
                    </span>
                  </button>

                  {viewSettingsOpen && (
                    <div className="px-3.5 py-2 bg-slate-50 border-t border-slate-100 space-y-2 text-[11px]">
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="font-semibold text-slate-600">
                          주말(토·일) 표시
                        </span>
                        <input
                          type="checkbox"
                          checked={showWeekends}
                          onChange={(e) => setShowWeekends(e.target.checked)}
                        />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="font-semibold text-slate-600">
                          예정 근무 가이드선
                        </span>
                        <input
                          type="checkbox"
                          checked={showPlannedGuide}
                          onChange={(e) =>
                            setShowPlannedGuide(e.target.checked)
                          }
                        />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="font-semibold text-slate-600">
                          현재 시각 세로선
                        </span>
                        <input
                          type="checkbox"
                          checked={showNowLine}
                          onChange={(e) => setShowNowLine(e.target.checked)}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* [+ 추가하기 ▾] 계단식 드롭다운 (근무 편집 권한이 없으면 휴가만 노출!) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  if (!addMenuOpen) {
                    setAddSubMenu(canEditSelfWork ? "WORK" : "LEAVE");
                  }
                  setAddMenuOpen((v) => !v);
                  setPeriodMenuOpen(false);
                }}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-800 flex items-center gap-1.5 shadow-2xs"
              >
                <span>+ 추가하기</span>
                <span className="text-[10px] text-slate-400">▾</span>
              </button>

              {addMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-40 flex items-start">
                  {/* 좌측 플라이아웃 서브메뉴 */}
                  {canEditSelfWork && addSubMenu === "WORK" && (
                    <div className="w-44 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 mr-1.5 text-xs">
                      {workFormPolicies.map((pol) => {
                        const presetMode: HqWorkMode = pol.name.includes("원격")
                          ? "REMOTE"
                          : pol.name.includes("외근") ||
                            pol.name.includes("출장")
                          ? "OUTSIDE"
                          : "OFFICE";
                        return (
                          <button
                            key={pol.id}
                            type="button"
                            onClick={() => {
                              setAddMenuOpen(false);
                              addWorkSegmentForDate(
                                me,
                                todayStr,
                                pol.name,
                                presetMode
                              );
                            }}
                            className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-800 flex items-center gap-2"
                          >
                            <span>{pol.icon}</span>
                            <span>{pol.name}</span>
                            {pol.is_mandatory && (
                              <span className="text-amber-500 text-[11px]">
                                ★
                              </span>
                            )}
                          </button>
                        );
                      })}
                      <div className="my-1 border-t border-slate-100" />
                      <button
                        type="button"
                        onClick={() => {
                          setAddMenuOpen(false);
                          addBreakBlockForDate(me, todayStr, null);
                        }}
                        className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700 flex items-center gap-2"
                      >
                        <span>☕</span>
                        <span>휴게</span>
                      </button>
                    </div>
                  )}

                  {addSubMenu === "LEAVE" && (
                    <div className="w-56 max-h-80 overflow-y-auto rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 mr-1.5 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setAddMenuOpen(false);
                          setLeaveModalInitialDate(undefined);
                          setLeaveRegisterKind({ type: "ANNUAL" });
                          setLeaveModalOpen(true);
                        }}
                        className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-800 flex items-center gap-2"
                      >
                        <span>🏖️</span>
                        <span>연차</span>
                      </button>
                      {customLeaves.map((lv) => (
                        <button
                          key={lv.id}
                          type="button"
                          onClick={() => {
                            setAddMenuOpen(false);
                            setLeaveModalInitialDate(undefined);
                            setLeaveRegisterKind({ type: "CUSTOM", item: lv });
                            setLeaveModalOpen(true);
                          }}
                          className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700 flex items-center gap-2"
                        >
                          <span>{lv.icon || "🌿"}</span>
                          <span className="truncate">{lv.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 우측 메인 메뉴 */}
                  <div className="w-40 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 text-xs">
                    {canEditSelfWork && (
                      <button
                        type="button"
                        onMouseEnter={() => setAddSubMenu("WORK")}
                        onClick={() => setAddSubMenu("WORK")}
                        className={`w-full px-3.5 py-2 text-left font-semibold flex items-center justify-between ${
                          addSubMenu === "WORK"
                            ? "bg-slate-100 text-slate-900"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span>🧳</span>
                          <span>근무</span>
                        </span>
                        <span className="text-slate-400">›</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onMouseEnter={() => setAddSubMenu("LEAVE")}
                      onClick={() => setAddSubMenu("LEAVE")}
                      className={`w-full px-3.5 py-2 text-left font-semibold flex items-center justify-between ${
                        addSubMenu === "LEAVE"
                          ? "bg-slate-100 text-slate-900"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>🏖️</span>
                        <span>휴가</span>
                      </span>
                      <span className="text-slate-400">›</span>
                    </button>

                    <div className="my-1 border-t border-slate-100" />
                    <button
                      type="button"
                      disabled={!canEditSelfWork}
                      onMouseEnter={() => setAddSubMenu(null)}
                      onClick={() => {
                        if (!canEditSelfWork) return;
                        setAddMenuOpen(false);
                        setRecurringOpen(true);
                      }}
                      title={
                        canEditSelfWork
                          ? "반복 일정 등록"
                          : "근무 편집 권한이 있을 때만 사용할 수 있어요."
                      }
                      className={`w-full px-3.5 py-2 text-left font-semibold flex items-center gap-2 ${
                        canEditSelfWork
                          ? "hover:bg-slate-50 text-slate-700"
                          : "opacity-40 cursor-not-allowed text-slate-400"
                      }`}
                    >
                      <span>🔄</span>
                      <span>반복 일정</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* 구성원 근무 우측: 검색 & [근무 기록 관리 ▾] */
          <div className="flex items-center gap-2">
            {canViewAnyOtherMember && (
              <>
                {teamSearchOpen ? (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200">
                    <span className="text-xs text-slate-400">🔍</span>
                    <input
                      autoFocus
                      value={teamKeyword}
                      onChange={(e) => setTeamKeyword(e.target.value)}
                      placeholder="이름, 부서, 직무 검색..."
                      className="bg-transparent text-xs font-semibold text-slate-800 outline-none w-40"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setTeamKeyword("");
                        setTeamSearchOpen(false);
                      }}
                      className="text-xs text-slate-400 hover:text-slate-700"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTeamSearchOpen(true)}
                    className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-600 flex items-center justify-center text-sm"
                    title="구성원 검색"
                  >
                    🔍
                  </button>
                )}
              </>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setRecordMgmtOpen((v) => !v)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-xs font-bold text-slate-800 flex items-center gap-1.5"
              >
                <span>📄</span>
                <span>근무 기록 관리</span>
                <span className="text-[10px] text-slate-400">▾</span>
              </button>

              {recordMgmtOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-64 rounded-xl bg-white border border-slate-200 shadow-xl py-2 z-40 text-xs">
                  {canDownloadStats && (
                    <>
                      <div className="px-4 py-1 text-[11px] font-bold text-slate-400">
                        다운로드
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setRecordMgmtOpen(false);
                          exportAttendanceCsv(
                            "ALL",
                            records,
                            `${activeQueryRange.start}_${activeQueryRange.end}`
                          );
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-slate-50 transition-colors"
                      >
                        <div className="font-bold text-slate-800">
                          구성원 근무 기록
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                          출 · 퇴근 시각, 근무 시간을 확인할 수 있어요.
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setRecordMgmtOpen(false);
                          exportAttendanceCsv(
                            "OVERTIME",
                            records,
                            `${activeQueryRange.start}_${activeQueryRange.end}`
                          );
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-slate-50 transition-colors"
                      >
                        <div className="font-bold text-slate-800">
                          구성원 초과 근무 기록
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                          정산이 필요한 초과 근무를 항목 별로 확인할 수 있어요.
                        </div>
                      </button>
                      <div className="my-1.5 border-t border-slate-100" />
                    </>
                  )}

                  {editableMembers.length > 0 && (
                    <>
                      <div className="px-4 py-1 text-[11px] font-bold text-slate-400">
                        업로드
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setRecordMgmtOpen(false);
                          setUploadModalOpen(true);
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-slate-50 font-bold text-slate-800"
                      >
                        근무 기록 업로드
                      </button>
                      <div className="my-1.5 border-t border-slate-100" />
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setRecordMgmtOpen(false);
                      setHelpModalOpen(true);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-slate-50 font-bold text-slate-700 flex items-center justify-between"
                  >
                    <span>도움말</span>
                    <span className="text-slate-400 text-[11px]">↗</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* =====================================================================
          우리 색깔: 천종현수학연구소 실시간 출퇴근 · 유연근무 스튜디오 바
         ===================================================================== */}
      {mainTab === "MY" && studioExpanded && (
        <div className="px-7 py-3.5 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white border-b border-slate-800">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3.5">
            {/* 좌측: 실시간 출퇴근 상태 & 내 근무규칙 */}
            <div className="flex items-center gap-3.5">
              <div className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-center shrink-0">
                <div className="text-[10px] font-bold text-sky-300 tracking-wider">
                  KST LIVE
                </div>
                <div className="text-base font-black tabular-nums leading-tight">
                  {nowClock.toLocaleTimeString("ko-KR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {!myToday ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-200 border border-amber-400/30 text-[11px] font-extrabold">
                      출근 체크인 전
                    </span>
                  ) : myToday.status === "WORKING" ? (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-400/20 text-emerald-200 border border-emerald-400/40 text-[11px] font-extrabold inline-flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      {formatClock24(myToday.check_in_at)} 출근 · 실시간 근무중 (
                      {formatHmColon(liveTodayElapsedMinutes)})
                    </span>
                  ) : myToday.status === "DONE" ? (
                    <span className="px-2.5 py-0.5 rounded-full bg-sky-400/20 text-sky-200 border border-sky-400/30 text-[11px] font-extrabold">
                      ✅ 오늘 퇴근 완료 ({formatClock24(myToday.check_in_at)} ~{" "}
                      {formatClock24(myToday.check_out_at)} · 실근무{" "}
                      {formatHmColon(myToday.worked_minutes)})
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-400/20 text-emerald-200 text-[11px] font-extrabold">
                      🏖️ 오늘 휴가 일정 ({myToday.location_note || "연차"})
                    </span>
                  )}

                  <span className="text-[11px] text-slate-300 font-semibold">
                    잔여 연차{" "}
                    <strong className="text-emerald-300">
                      {me?.annual_leave_remain ?? 15}일
                    </strong>{" "}
                    · 이번 주 실기록{" "}
                    <strong className="text-sky-300">
                      {formatHmColon(myWeeklyMinutes)}
                    </strong>
                    /52:00
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  본사 편집·집필 유연근무: 오늘 근무 형태와 과업 메모를 남기면 구성원 근무 보드에 즉시 공유됩니다.
                </p>
              </div>
            </div>

            {/* 중앙+우측: 근무형태 원클릭 칩 + 메모 + 출퇴근 CTA */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
                {(
                  [
                    { mode: "OFFICE", label: "🏢 본사" },
                    { mode: "FLEX_08", label: "🌅 08시" },
                    { mode: "FLEX_10", label: "🕙 10시" },
                    { mode: "REMOTE", label: "🏠 원격·집필" },
                    { mode: "OUTSIDE", label: "🚗 외근·감리" },
                  ] as const
                ).map((chip) => {
                  const active = selectedMode === chip.mode;
                  return (
                    <button
                      key={chip.mode}
                      type="button"
                      onClick={() => {
                        setSelectedMode(chip.mode);
                        setLocationNote(
                          ATTENDANCE_MODES[chip.mode].defaultLocation
                        );
                      }}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                        active
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-300 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>

              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="오늘 집중 과업/장소 메모 (예: 플라토 교정, 파주 감리)"
                className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-xs text-white placeholder:text-slate-400 outline-none focus:border-sky-400 w-56"
              />

              {!myToday ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleQuickCheckIn}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black shadow-sm transition-colors disabled:opacity-50"
                >
                  🟢 근무 시작(출근)
                </button>
              ) : myToday.status === "WORKING" ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleQuickUpdateMode}
                    className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition-colors"
                  >
                    형태·메모 반영
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleQuickCheckOut}
                    className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-black shadow-sm transition-colors disabled:opacity-50"
                  >
                    🔴 퇴근 기록하기
                  </button>
                </div>
              ) : canEditSelfWork ? (
                <button
                  type="button"
                  onClick={(e) =>
                    openEntryForDate(me, todayStr, {
                      anchorEl: e.currentTarget,
                    })
                  }
                  className="px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold"
                >
                  ✏️ 오늘 기록 수정
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          탭 1: [내 근무] 본문 영역
         ===================================================================== */}
      {mainTab === "MY" && (
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
          {/* 날짜 네비게이터 + 우측 주기/주/월 총시간 프로그레스 게이지 */}
          <div className="px-7 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => moveMyPeriod(-1)}
                  className="px-2.5 py-1.5 text-slate-500 hover:text-slate-900 text-xs font-bold"
                >
                  ‹
                </button>
                <span className="px-3 py-1.5 text-xs font-bold text-slate-800 tabular-nums">
                  {formatRangeHeader(
                    activeQueryRange.start,
                    activeQueryRange.end
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => moveMyPeriod(1)}
                  className="px-2.5 py-1.5 text-slate-500 hover:text-slate-900 text-xs font-bold"
                >
                  ›
                </button>
              </div>

              {draftList.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const firstYmd = draftList[0]?.workDate;
                    if (firstYmd) setMyAnchorDate(firstYmd);
                  }}
                  className="px-2.5 py-1.5 rounded-lg hover:bg-blue-50 text-xs font-extrabold text-[#0066ff] transition-colors"
                >
                  입력 중인 날짜
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setMyAnchorDate(todayStr)}
                  className="px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-xs font-bold text-slate-600"
                >
                  오늘
                </button>
              )}

              {myPeriodMode === "CYCLE" && (
                <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded bg-teal-50 text-teal-700 text-[11px] font-bold">
                  근무 주기 ({myRule.cycle_start_day} 시작)
                </span>
              )}
              {myPeriodMode === "WEEK" && (
                <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-bold">
                  주간 세로 타임라인
                </span>
              )}
              {!canEditSelfWork && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[11px] font-semibold">
                  <span>🔒</span>
                  <span>근무 편집 제한됨</span>
                </span>
              )}
            </div>

            {/* 우측: 주기/주 (40:00 + ⚑ -12:00 / 드래프트 시 41:15 +1:15 ⚑ -10:45) 또는 월 (168:00) 게이지 바 */}
            <div className="flex items-center gap-4">
              <div className="text-right">
                <span
                  className={`text-[21px] font-bold tabular-nums tracking-tight transition-colors ${
                    draftList.length > 0 ? "text-[#00bfa5]" : "text-slate-700"
                  }`}
                >
                  {formatHmColon(myPeriodStats.totalEffectiveMin)}
                </span>
              </div>

              {myPeriodMode === "MONTH" ? (
                <div className="w-36 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (myPeriodStats.totalLoggedMin /
                            Math.max(60, myPeriodStats.totalEffectiveMin)) *
                            100
                        )
                      )}%`,
                    }}
                    className="h-full bg-[#4ecdc4] transition-all duration-300"
                  />
                </div>
              ) : (
                <div className="w-52">
                  <div className="flex items-center justify-end gap-1.5 text-[10px] font-bold text-slate-400 mb-1 tabular-nums">
                    {myPeriodStats.totalEffectiveMin > 2400 ? (
                      <>
                        <span className="text-[#e85d3f] flex items-center gap-0.5 font-extrabold">
                          <span>
                            +
                            {formatHmColon(
                              myPeriodStats.totalEffectiveMin - 2400
                            )}
                          </span>
                          <span>⚑</span>
                        </span>
                        <span>
                          -
                          {formatHmColon(
                            Math.max(
                              0,
                              3120 - myPeriodStats.totalEffectiveMin
                            )
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="flex items-center gap-0.5">
                        <span>⚑</span>
                        <span>-12:00</span>
                      </span>
                    )}
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
                    <div className="w-[77%] h-full bg-slate-100 border-r border-white relative overflow-hidden">
                      <div
                        style={{ width: `${regularBarPct}%` }}
                        className="h-full bg-[#4ecdc4] transition-all duration-300"
                      />
                    </div>
                    <div className="w-[23%] h-full bg-slate-100 relative overflow-hidden">
                      <div
                        style={{ width: `${overtimeBarPct}%` }}
                        className="h-full bg-[#f05638] transition-all duration-300"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {myPeriodMode === "MONTH" ? (
            /* ===============================================================
               내 근무 > [월] 플렉스 월간 캘린더 뷰 (Screenshot 104312 100% 재현)
               =============================================================== */
            <div className="flex-1 overflow-x-auto">
              <div className="min-w-[920px]">
                <div className="grid grid-cols-7 border-b border-slate-200 bg-white text-xs font-bold text-slate-500">
                  {MONDAY_FIRST_KO.map((w, idx) => (
                    <div
                      key={w}
                      className={`px-3.5 py-2.5 ${
                        idx >= 5 ? "text-[#e85d3f]" : "text-slate-600"
                      }`}
                    >
                      {w}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 border-b border-slate-200">
                  {myMonthCalendarCells.map(({ ymd, inCurrentMonth }) => {
                    const d = parseYmdLocal(ymd);
                    const dow = d.getDay();
                    const dowKo = WEEKDAY_KO[dow];
                    const cellKey = me ? `${me.instructor_id}__${ymd}` : "";
                    const cellDraft = cellKey ? draftEdits[cellKey] : undefined;
                    const rec = cellKey
                      ? recordByMemberDate.get(cellKey)
                      : undefined;
                    const lvDoc = cellKey
                      ? leaveApprovalByMemberDate.get(cellKey)
                      : undefined;
                    const holiday = holidayMap.get(ymd);
                    const isToday = ymd === todayStr;
                    const isOff = dow === 0 || dow === 6 || Boolean(holiday);
                    const isWorkDay =
                      myRule.work_days.includes(dowKo) && !holiday;

                    const ruleWorkMin =
                      Number(myRule.daily_work_hours || 8) * 60 +
                      Number(myRule.daily_work_minutes || 0);

                    const storedCellSched = cellKey
                      ? recognizedScheduleByMemberDate.get(cellKey)
                      : undefined;
                    const cellEff = me
                      ? getEffectiveDaySchedule(me, ymd)
                      : null;

                    const dayMin = cellDraft
                      ? calcDraftNetWorkedMinutes(cellDraft)
                      : storedCellSched
                        ? calcDayScheduleSummary(
                            storedCellSched.segments,
                            storedCellSched.breaks,
                            ruleWorkMin
                          ).workedMinutes
                        : rec
                          ? rec.status === "WORKING" && ymd === todayStr
                            ? ruleWorkMin
                            : rec.work_mode === "LEAVE" &&
                                rec.status === "LEAVE"
                              ? ruleWorkMin
                              : Number(rec.worked_minutes || ruleWorkMin)
                          : isWorkDay
                            ? ruleWorkMin
                            : 0;

                    const isPastOrDone =
                      Boolean(cellDraft) ||
                      Boolean(storedCellSched) ||
                      ymd < todayStr ||
                      rec?.status === "DONE";
                    const hasFullLeave =
                      !cellDraft &&
                      ((rec?.work_mode === "LEAVE" &&
                        rec?.status !== "HALF_LEAVE") ||
                        rec?.status === "LEAVE" ||
                        (Boolean(lvDoc) &&
                          !String(lvDoc?.leave_type || "").includes("반차") &&
                          !String(lvDoc?.leave_type || "").includes("시간차")));
                    const canShowCellPlus = Boolean(
                      me &&
                        (canEditSelfWork ||
                          isWorkDay ||
                          (ymd < todayStr && canEditRealtimeWork(me)))
                    );

                    return (
                      <div
                        key={ymd}
                        className={`min-h-[116px] p-3 transition-colors flex flex-col justify-between group ${
                          cellDraft
                            ? "bg-[#f5f9ff]"
                            : inCurrentMonth
                              ? "bg-white"
                              : "opacity-55 bg-slate-50/25"
                        } hover:bg-slate-50/55`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-xs font-extrabold tabular-nums ${
                                isToday
                                  ? "w-6 h-6 rounded-md bg-[#ea580c] text-white inline-flex items-center justify-center"
                                  : isOff
                                    ? "text-[#e85d3f]"
                                    : "text-slate-700"
                              }`}
                            >
                              {d.getDate()}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold tabular-nums ${
                                cellDraft
                                  ? "bg-[#0066ff] text-white font-extrabold"
                                  : dayMin > 0
                                    ? "bg-slate-100 text-slate-600"
                                    : "bg-slate-100 text-slate-300"
                              }`}
                            >
                              {formatHmColon(dayMin)}
                            </span>
                          </div>

                          {canShowCellPlus && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (me) {
                                  openRowAddMenuForDate(
                                    me,
                                    ymd,
                                    e.currentTarget
                                  );
                                }
                              }}
                              className="w-5 h-5 rounded text-slate-300 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center text-xs font-bold"
                            >
                              +
                            </button>
                          )}
                        </div>

                        <div className="mt-2 space-y-1">
                          {holiday && (
                            <div className="text-[10.5px] font-bold text-[#e85d3f] truncate">
                              {holiday.name}
                            </div>
                          )}

                          {cellDraft?.actionMode === "DELETE" ? (
                            <div className="text-[10.5px] font-bold text-slate-400 line-through">
                              삭제 예정
                            </div>
                          ) : hasFullLeave ? (
                            <div className="px-2 py-1 rounded-md bg-[#8b5cf6] text-white text-[10.5px] font-extrabold flex items-center justify-between">
                              <span>
                                ☂ {lvDoc?.leave_type || rec?.location_note || "연차"}
                              </span>
                              <span>8h</span>
                            </div>
                          ) : cellEff && cellEff.segments.length > 0 ? (
                            <div className="space-y-1">
                              {cellEff.segments.map((mSeg) => (
                                <div
                                  key={mSeg.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (canEditSelfWork && me) {
                                      openItemPopover(
                                        me,
                                        ymd,
                                        "SEGMENT",
                                        mSeg.id,
                                        e.currentTarget,
                                        null
                                      );
                                    }
                                  }}
                                  className={
                                    isPastOrDone
                                      ? `flex items-center justify-between text-[11px] pl-1.5 border-l-2 border-[#14b8a6] rounded hover:bg-slate-100/70 py-0.5 ${
                                          canEditSelfWork ? "cursor-pointer" : ""
                                        }`
                                      : `px-2 py-1 rounded-[5px] border border-dashed border-[#4fd1c5] bg-white hover:bg-teal-50/30 flex items-center justify-between text-[11px] ${
                                          canEditSelfWork ? "cursor-pointer" : ""
                                        }`
                                  }
                                >
                                  <span
                                    className={`font-extrabold text-slate-800 ${
                                      !isPastOrDone
                                        ? "pl-1 border-l-2 border-[#14b8a6]"
                                        : ""
                                    }`}
                                  >
                                    {mSeg.policy_name || "근무"}
                                  </span>
                                  <span className="text-[10px] text-slate-500 tabular-nums">
                                    {formatMinutesToKoreanAmPm(mSeg.in_minutes)}{" "}
                                    -{" "}
                                    {formatMinutesToKoreanAmPm(mSeg.out_minutes)}
                                  </span>
                                </div>
                              ))}
                              <div className="text-right">
                                <button
                                  type="button"
                                  onMouseEnter={(e) => {
                                    if (cellEff.breaks.length > 0) {
                                      showBreakTip(
                                        `${cellKey || ymd}__mo_brk`,
                                        cellEff.breaks.map((b) => ({
                                          startMin: b.start_minutes,
                                          endMin: b.end_minutes,
                                        })),
                                        e.currentTarget
                                      );
                                    }
                                  }}
                                  onMouseLeave={() =>
                                    hideBreakTip(`${cellKey || ymd}__mo_brk`)
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!canEditSelfWork || !me) return;
                                    const r =
                                      e.currentTarget.getBoundingClientRect();
                                    setInlineTarget(null);
                                    setRowAddMenu(null);
                                    setHoveredBreakTip(null);
                                    setBreakListPopover({
                                      member: me,
                                      ymd,
                                      segmentId: cellEff.segments[0].id,
                                      anchorRect: {
                                        top: r.top,
                                        bottom: r.bottom,
                                        left: r.left,
                                        right: r.right,
                                        width: r.width,
                                      },
                                    });
                                  }}
                                  className="text-[10px] text-slate-400 hover:text-slate-700 transition-colors"
                                >
                                  {cellEff.breaks.length > 0
                                    ? `휴게 ${cellEff.breaks.length}건`
                                    : "휴게 없음"}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : myPeriodMode === "WEEK" ? (
            /* ===============================================================
               내 근무 > [주] 주단위 세로 7열 타임라인 뷰 (Screenshot 104346 100% 재현!)
               =============================================================== */
            <div className="flex-1 overflow-x-auto">
              {(() => {
                const startHour = 6; // 오전 6시 ~ 자정(24시)
                const endHour = 24;
                const totalHours = endHour - startHour;
                const hourHeightPx = Math.round(52 * (zoomPct / 100));
                const gridTotalPx = totalHours * hourHeightPx;
                const colCount = myWeekDates.length;
                const showHorizNow =
                  showNowLine &&
                  myWeekDates.includes(todayStr) &&
                  nowMinutesOfDay >= startHour * 60 &&
                  nowMinutesOfDay <= endHour * 60;
                const nowTopPx =
                  ((nowMinutesOfDay - startHour * 60) / 60) * hourHeightPx;

                return (
                  <div className="min-w-[960px]">
                    {/* 상단 고정 요일 7열 헤더 */}
                    <div className="flex border-b border-slate-200 bg-white sticky top-0 z-30">
                      <div className="w-16 shrink-0 border-r border-slate-100" />
                      <div
                        style={{
                          gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
                        }}
                        className="flex-1 grid divide-x divide-slate-100"
                      >
                        {myWeekDates.map((ymd) => {
                          const dt = parseYmdLocal(ymd);
                          const dow = dt.getDay();
                          const dowKo = WEEKDAY_KO[dow];
                          const isToday = ymd === todayStr;
                          const holiday = holidayMap.get(ymd);
                          const isOff =
                            dow === 0 || dow === 6 || Boolean(holiday);
                          const colKey = me
                            ? `${me.instructor_id}__${ymd}`
                            : "";
                          const colDraft = colKey
                            ? draftEdits[colKey]
                            : undefined;
                          const storedColSched = colKey
                            ? recognizedScheduleByMemberDate.get(colKey)
                            : undefined;
                          const rec = colKey
                            ? recordByMemberDate.get(colKey)
                            : undefined;
                          const isWorkDay =
                            myRule.work_days.includes(dowKo) && !holiday;
                          const plannedMin = isWorkDay
                            ? Number(myRule.daily_work_hours || 8) * 60 +
                              Number(myRule.daily_work_minutes || 0)
                            : 0;
                          const displayMin = colDraft
                            ? calcDraftNetWorkedMinutes(colDraft)
                            : storedColSched
                              ? calcDayScheduleSummary(
                                  storedColSched.segments,
                                  storedColSched.breaks,
                                  plannedMin || 480
                                ).workedMinutes
                              : rec
                                ? rec.status === "WORKING" && ymd === todayStr
                                  ? plannedMin
                                  : rec.work_mode === "LEAVE" &&
                                      rec.status === "LEAVE"
                                    ? plannedMin || 480
                                    : Number(rec.worked_minutes || plannedMin)
                                : plannedMin;
                          const canShowColPlus = Boolean(
                            me &&
                              (canEditSelfWork ||
                                isWorkDay ||
                                (ymd < todayStr && canEditRealtimeWork(me)))
                          );

                          return (
                            <div
                              key={ymd}
                              className={`px-3.5 py-2.5 transition-colors ${
                                colDraft ? "bg-[#f5f9ff]" : ""
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`text-xs font-extrabold tabular-nums ${
                                      isToday
                                        ? "w-6 h-6 rounded-md bg-[#ea580c] text-white inline-flex items-center justify-center"
                                        : isOff
                                          ? "text-[#e85d3f]"
                                          : "text-slate-800"
                                    }`}
                                  >
                                    {dt.getDate()}
                                  </span>
                                  <span
                                    className={`text-xs font-bold ${
                                      isOff
                                        ? "text-[#e85d3f]"
                                        : "text-slate-600"
                                    }`}
                                  >
                                    {dowKo}
                                  </span>
                                </div>

                                {canShowColPlus && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (me) {
                                        openRowAddMenuForDate(
                                          me,
                                          ymd,
                                          e.currentTarget
                                        );
                                      }
                                    }}
                                    className="w-5 h-5 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center text-xs font-bold"
                                  >
                                    +
                                  </button>
                                )}
                              </div>

                              <div className="mt-1.5">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold tabular-nums ${
                                    colDraft
                                      ? "bg-[#0066ff] text-white font-extrabold"
                                      : displayMin > 0
                                        ? "bg-slate-100 text-slate-700"
                                        : "bg-slate-100 text-slate-300"
                                  }`}
                                >
                                  {formatHmColon(displayMin)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* 본문 세로 시간축(오전 6 ~ 오후 11) + 요일별 세로 근무 카드 */}
                    <div
                      style={{ height: `${gridTotalPx}px` }}
                      className="flex relative"
                    >
                      {/* 좌측 시간 라벨 거터 */}
                      <div className="w-16 shrink-0 border-r border-slate-100 relative bg-white">
                        {Array.from({ length: totalHours }, (_, idx) => {
                          const h = startHour + idx;
                          const label =
                            h === 12
                              ? "정오"
                              : h < 12
                                ? `오전 ${h}`
                                : `오후 ${h - 12}`;
                          return (
                            <div
                              key={h}
                              style={{
                                top: `${idx * hourHeightPx}px`,
                                height: `${hourHeightPx}px`,
                              }}
                              className="absolute inset-x-0 pr-2.5 flex items-start justify-end"
                            >
                              <span className="-translate-y-2 text-[10.5px] font-medium text-slate-400 tabular-nums">
                                {label}
                              </span>
                            </div>
                          );
                        })}

                        {showHorizNow && (
                          <div
                            style={{ top: `${nowTopPx}px` }}
                            className="absolute right-1.5 -translate-y-1/2 bg-white px-1 py-0.5 text-[10px] font-extrabold text-[#e85d3f] leading-tight text-right z-30 tabular-nums"
                          >
                            {nowKoreanLabel.split(" ").map((part, pIdx) => (
                              <div key={pIdx}>{part}</div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 7열 세로 그리드 영역 */}
                      <div
                        style={{
                          gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
                        }}
                        className="flex-1 grid divide-x divide-slate-100 relative"
                      >
                        {/* 수평 현재 시각 빨간 기준선 (Screenshot 104346 동일) */}
                        {showHorizNow && (
                          <div
                            style={{ top: `${nowTopPx}px` }}
                            className="pointer-events-none absolute inset-x-0 h-[1.5px] bg-[#e85d3f] z-25"
                          />
                        )}

                        {myWeekDates.map((ymd) => {
                          const dowKo = WEEKDAY_KO[parseYmdLocal(ymd).getDay()];
                          const holiday = holidayMap.get(ymd);
                          const colKey = me
                            ? `${me.instructor_id}__${ymd}`
                            : "";
                          const colDraft = colKey
                            ? draftEdits[colKey]
                            : undefined;
                          const rec = colKey
                            ? recordByMemberDate.get(colKey)
                            : undefined;
                          const lvDoc = colKey
                            ? leaveApprovalByMemberDate.get(colKey)
                            : undefined;

                          const dayCustom =
                            myRule.per_day_custom_enabled &&
                            myRule.per_day_schedule?.[dowKo]
                              ? myRule.per_day_schedule[dowKo]
                              : null;
                          const ruleStartMin =
                            parseHmToMinutes(
                              dayCustom?.start_time || myRule.start_time
                            ) ?? 540;
                          const ruleWorkMin =
                            Number(
                              dayCustom
                                ? dayCustom.work_hours
                                : myRule.daily_work_hours ?? 8
                            ) *
                              60 +
                            Number(
                              dayCustom
                                ? dayCustom.work_minutes
                                : myRule.daily_work_minutes ?? 0
                            );
                          const ruleBreakMin = calcBreakMinutes(myRule);
                          const ruleEndMin =
                            ruleStartMin + ruleWorkMin + ruleBreakMin;

                          const leaveLabel = String(
                            lvDoc?.leave_type ||
                              (rec?.work_mode === "LEAVE"
                                ? rec.location_note
                                : "") ||
                              ""
                          );
                          const isHalfAm = leaveLabel.includes("오전 반차");
                          const isHalfPm =
                            leaveLabel.includes("오후 반차") ||
                            ((rec?.status === "HALF_LEAVE" ||
                              leaveLabel.includes("반차")) &&
                              !isHalfAm);
                          const hasFullLeave =
                            !colDraft &&
                            ((rec?.work_mode === "LEAVE" &&
                              rec?.status !== "HALF_LEAVE") ||
                              rec?.status === "LEAVE" ||
                              (Boolean(lvDoc) &&
                                !isHalfAm &&
                                !isHalfPm &&
                                !leaveLabel.includes("시간차")));

                          const blockStartMin =
                            colDraft?.actionMode === "UPSERT"
                              ? colDraft.inMinutes
                              : rec?.check_in_at
                                ? isoToMinutesOfDay(rec.check_in_at, ymd) ??
                                  ruleStartMin
                                : isHalfAm
                                  ? ruleStartMin + 240 + ruleBreakMin
                                  : ruleStartMin;
                          const blockEndMin =
                            colDraft?.actionMode === "UPSERT"
                              ? colDraft.outMinutes
                              : rec?.check_out_at && rec.status === "DONE"
                                ? isoToMinutesOfDay(rec.check_out_at, ymd) ??
                                  ruleEndMin
                                : isHalfPm
                                  ? ruleStartMin + 240
                                  : ruleEndMin;

                          const clampedTopPx = Math.max(
                            0,
                            ((blockStartMin - startHour * 60) / 60) *
                              hourHeightPx
                          );
                          const clampedHeightPx = Math.max(
                            36,
                            ((blockEndMin - blockStartMin) / 60) * hourHeightPx
                          );

                          const colEff = me
                            ? getEffectiveDaySchedule(me, ymd)
                            : null;

                          return (
                            <div
                              key={ymd}
                              className={`relative ${
                                colDraft ? "bg-[#f5f9ff]/60" : ""
                              }`}
                            >
                              {/* 가로 정시 그리드 라인 */}
                              {Array.from({ length: totalHours }, (_, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    top: `${idx * hourHeightPx}px`,
                                    height: `${hourHeightPx}px`,
                                  }}
                                  className="absolute inset-x-0 border-b border-slate-100 pointer-events-none"
                                />
                              ))}

                              {holiday && (
                                <div className="p-2 text-[11px] font-bold text-[#e85d3f]">
                                  {holiday.name}
                                </div>
                              )}

                              {colDraft?.actionMode === "DELETE" ? null : hasFullLeave ? (
                                <div
                                  style={{
                                    top: `${clampedTopPx}px`,
                                    height: `${clampedHeightPx}px`,
                                  }}
                                  className="absolute left-2 right-2 rounded-lg bg-[#8b5cf6] border border-[#7c3aed] text-white p-2.5 shadow-2xs z-10"
                                >
                                  <div className="text-xs font-extrabold">
                                    ☂ {leaveLabel || "연차"}
                                  </div>
                                  <div className="text-[10.5px] opacity-90 mt-0.5 tabular-nums">
                                    {formatMinutesToKoreanAmPm(blockStartMin)} –{" "}
                                    {formatMinutesToKoreanAmPm(blockEndMin)}
                                  </div>
                                </div>
                              ) : colEff && colEff.segments.length > 0 ? (
                                colEff.segments.map((vSeg, vIdx) => {
                                  const vTopPx = Math.max(
                                    0,
                                    ((vSeg.in_minutes - startHour * 60) / 60) *
                                      hourHeightPx
                                  );
                                  const vSpan = Math.max(
                                    15,
                                    vSeg.out_minutes - vSeg.in_minutes
                                  );
                                  const vHeightPx = Math.max(
                                    32,
                                    (vSpan / 60) * hourHeightPx
                                  );
                                  const vVis = getWorkPolicyVisual(
                                    vSeg.policy_name,
                                    vSeg.work_mode
                                  );
                                  const vBreaks = getBreaksOverlappingSegment(
                                    vSeg,
                                    colEff.breaks
                                  );
                                  const vFill =
                                    Boolean(colDraft) ||
                                    Boolean(
                                      colKey &&
                                        recognizedScheduleByMemberDate.get(colKey)
                                    ) ||
                                    ymd < todayStr ||
                                    rec?.status === "DONE" ||
                                    vSeg.policy_name !== "근무"
                                      ? 100
                                      : ymd === todayStr &&
                                          nowMinutesOfDay >= vSeg.in_minutes
                                        ? Math.max(
                                            0,
                                            Math.min(
                                              100,
                                              ((nowMinutesOfDay -
                                                vSeg.in_minutes) /
                                                vSpan) *
                                                100
                                            )
                                          )
                                        : 0;

                                  return (
                                    <div
                                      key={vSeg.id}
                                      data-work-bar={
                                        vIdx === 0 ? colKey : undefined
                                      }
                                      data-work-seg={`${colKey}__${vSeg.id}`}
                                      style={{
                                        top: `${vTopPx}px`,
                                        height: `${vHeightPx}px`,
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (canEditSelfWork && me) {
                                          openItemPopover(
                                            me,
                                            ymd,
                                            "SEGMENT",
                                            vSeg.id,
                                            e.currentTarget,
                                            null
                                          );
                                        }
                                      }}
                                      className={`absolute left-2 right-2 z-10 ${
                                        canEditSelfWork
                                          ? "cursor-pointer"
                                          : "cursor-default"
                                      }`}
                                    >
                                      <div
                                        className={`w-full h-full rounded-lg border bg-white relative overflow-hidden p-2 ${
                                          colDraft ||
                                          (inlineTarget?.key === colKey &&
                                            inlineTarget?.itemId === vSeg.id)
                                            ? vVis.activeBorderClass
                                            : vVis.solidBorderClass
                                        }`}
                                      >
                                        {vFill > 0 && (
                                          <div
                                            style={{ height: `${vFill}%` }}
                                            className={`pointer-events-none absolute inset-x-0 top-0 ${vVis.fillClass} transition-all duration-500`}
                                          />
                                        )}

                                        <div className="relative z-10">
                                          <div className="text-xs font-extrabold">
                                            {vSeg.policy_name || "근무"}
                                          </div>
                                          <div className="text-[10.5px] font-semibold opacity-85 mt-0.5 tabular-nums">
                                            {formatMinutesToKoreanAmPm(
                                              vSeg.in_minutes
                                            )}{" "}
                                            –{" "}
                                            {formatMinutesToKoreanAmPm(
                                              vSeg.out_minutes
                                            )}
                                          </div>
                                        </div>

                                        {vBreaks.map((vb) => {
                                          const bTop = Math.max(
                                            0,
                                            ((vb.start_minutes -
                                              vSeg.in_minutes) /
                                              vSpan) *
                                              100
                                          );
                                          const bH = Math.max(
                                            10,
                                            ((vb.end_minutes -
                                              vb.start_minutes) /
                                              vSpan) *
                                              100
                                          );
                                          return (
                                            <div
                                              key={vb.id}
                                              style={{
                                                top: `${bTop}%`,
                                                height: `${bH}%`,
                                              }}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (canEditSelfWork && me) {
                                                  openItemPopover(
                                                    me,
                                                    ymd,
                                                    "BREAK",
                                                    vb.id,
                                                    e.currentTarget,
                                                    null
                                                  );
                                                }
                                              }}
                                              onMouseEnter={(e) =>
                                                showBreakTip(
                                                  `${colKey || ymd}__wk_brk_${vb.id}`,
                                                  [
                                                    {
                                                      startMin:
                                                        vb.start_minutes,
                                                      endMin: vb.end_minutes,
                                                    },
                                                  ],
                                                  e.currentTarget
                                                )
                                              }
                                              onMouseLeave={() =>
                                                hideBreakTip(
                                                  `${colKey || ymd}__wk_brk_${vb.id}`
                                                )
                                              }
                                              className="absolute left-1.5 right-1.5 rounded-md bg-white/95 border border-slate-200 hover:border-slate-400 px-2 flex items-center text-[11px] text-slate-500 z-10 transition-colors"
                                            >
                                              ☕
                                            </div>
                                          );
                                        })}
                                      </div>

                                      <div className="mt-0.5 pl-1">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!canEditSelfWork || !me) return;
                                            const r =
                                              e.currentTarget.getBoundingClientRect();
                                            setInlineTarget(null);
                                            setRowAddMenu(null);
                                            setHoveredBreakTip(null);
                                            setBreakListPopover({
                                              member: me,
                                              ymd,
                                              segmentId: vSeg.id,
                                              anchorRect: {
                                                top: r.top,
                                                bottom: r.bottom,
                                                left: r.left,
                                                right: r.right,
                                                width: r.width,
                                              },
                                            });
                                          }}
                                          className="text-[10.5px] font-medium text-slate-400 hover:text-slate-700 transition-colors"
                                        >
                                          {vBreaks.length > 0
                                            ? `휴게 ${vBreaks.length}건`
                                            : "휴게 없음"}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            /* ===============================================================
               내 근무 > [주기] 수평 24시간 근무주기 타임라인 (Screenshot 0fed5963 & 8278a9a1 100% 재현)
               =============================================================== */
            <div className="flex-1 overflow-x-auto">
              <div
                style={{
                  minWidth: `${Math.round(980 * (zoomPct / 100))}px`,
                }}
                className="relative"
              >
                {/* 24시간 눈금 헤더 */}
                <div className="flex border-b border-slate-200 bg-white sticky top-0 z-20">
                  <div className="w-52 shrink-0 px-7 py-2.5 border-r border-slate-100" />
                  <div className="flex-1 relative h-9">
                    <div className="grid grid-cols-24 h-full">
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className="relative h-full">
                          {h > 0 && (
                            <span
                              className={`absolute -left-3 bottom-1.5 text-[10px] tabular-nums ${
                                h === 12
                                  ? "font-bold text-slate-500 -left-4"
                                  : "font-medium text-slate-400"
                              }`}
                            >
                              {h === 12 ? (
                                <span className="flex flex-col items-center leading-none">
                                  <span className="text-[9px] text-slate-400">
                                    정오
                                  </span>
                                  <span>12</span>
                                </span>
                              ) : h > 12 ? (
                                h - 12
                              ) : (
                                h
                              )}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 현재 시각 코랄 배지 */}
                    {showNowLine && (
                      <div
                        style={{
                          left: `${(nowMinutesOfDay / 1440) * 100}%`,
                        }}
                        className="absolute bottom-1 -translate-x-1/2 px-1.5 py-0.5 rounded bg-white text-[#e85d3f] text-[10px] font-extrabold whitespace-nowrap z-30"
                      >
                        {nowKoreanLabel}
                      </div>
                    )}
                  </div>
                </div>

                {/* 요일별 타임라인 행 */}
                <div className="relative divide-y divide-slate-100">
                  {/* 현재 시각 세로선 */}
                  {showNowLine && (
                    <div
                      style={{
                        left: `calc(13rem + (100% - 13rem) * ${
                          nowMinutesOfDay / 1440
                        })`,
                      }}
                      className="absolute top-0 bottom-0 w-[1.5px] bg-[#e85d3f]/80 pointer-events-none z-20"
                    />
                  )}

                  {myWeekDates.map((ymd) => {
                    const dt = parseYmdLocal(ymd);
                    const dow = dt.getDay();
                    const dowKo = WEEKDAY_KO[dow];
                    const isToday = ymd === todayStr;
                    const holiday = holidayMap.get(ymd);
                    const rowKey = me ? `${me.instructor_id}__${ymd}` : "";
                    const rowDraft = rowKey ? draftEdits[rowKey] : undefined;
                    const storedRowSched = rowKey
                      ? recognizedScheduleByMemberDate.get(rowKey)
                      : undefined;
                    const rec = rowKey
                      ? recordByMemberDate.get(rowKey)
                      : undefined;
                    const storedRt = rowKey
                      ? realtimeLogByMemberDate.get(rowKey)
                      : undefined;
                    const isWorkDay =
                      myRule.work_days.includes(dowKo) && !holiday;
                    const ruleDailyMin =
                      Number(myRule.daily_work_hours || 8) * 60 +
                      Number(myRule.daily_work_minutes || 0);
                    const plannedMin = isWorkDay ? ruleDailyMin : 0;
                    const displayMin = rowDraft
                      ? calcDraftNetWorkedMinutes(rowDraft)
                      : storedRowSched
                        ? calcDayScheduleSummary(
                            storedRowSched.segments,
                            storedRowSched.breaks,
                            ruleDailyMin
                          ).workedMinutes
                        : rec
                          ? rec.status === "WORKING"
                            ? plannedMin || ruleDailyMin
                            : rec.work_mode === "LEAVE" &&
                                rec.status === "LEAVE"
                              ? plannedMin || 480
                              : Number(rec.worked_minutes || 0)
                          : plannedMin;
                    const isOvertimeRow =
                      !rowDraft &&
                      displayMin > ruleDailyMin &&
                      (Boolean(rec) || Boolean(storedRowSched) || displayMin > 0);
                    const canEditMyRt = Boolean(me && canEditRealtimeWork(me));
                    const canShowRowPlus = Boolean(
                      me &&
                        (canEditSelfWork ||
                          isWorkDay ||
                          (ymd < todayStr && canEditMyRt))
                    );

                    return (
                      <div
                        key={ymd}
                        className="flex h-[74px] transition-colors group hover:bg-slate-50/45"
                      >
                        {/* 좌측 일자 + 인정근무 시간 배지(초과 시 🔥) + [◐ 실시간기록] + [+ 메뉴] 버튼 */}
                        <div
                          className={`w-52 shrink-0 px-7 flex items-center justify-between border-r bg-white ${
                            rowDraft
                              ? "border-r-[3px] border-r-[#0066ff]"
                              : "border-r-slate-100 group-hover:bg-slate-50/70"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 w-11">
                              <span
                                className={`text-xs font-extrabold tabular-nums ${
                                  isToday
                                    ? "w-6 h-6 rounded-md bg-[#ea580c] text-white inline-flex items-center justify-center"
                                    : dow === 0 || dow === 6 || holiday
                                      ? "text-[#e85d3f]"
                                      : "text-slate-700"
                                }`}
                              >
                                {dt.getDate()}
                              </span>
                              <span
                                className={`text-xs font-bold ${
                                  dow === 0 || dow === 6 || holiday
                                    ? "text-[#e85d3f]"
                                    : "text-slate-600"
                                }`}
                              >
                                {dowKo}
                              </span>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold tabular-nums inline-flex items-center gap-0.5 transition-colors ${
                                rowDraft
                                  ? "bg-[#0066ff] text-white font-extrabold shadow-2xs"
                                  : isOvertimeRow
                                    ? "bg-[#fff1eb] text-[#c2410c] font-extrabold"
                                    : displayMin > 0
                                      ? "bg-slate-100 text-slate-700"
                                      : "bg-slate-100 text-slate-300"
                              }`}
                            >
                              <span>{formatHmColon(displayMin)}</span>
                              {isOvertimeRow && (
                                <span className="text-[10px]">🔥</span>
                              )}
                            </span>
                          </div>

                          <div className="flex items-center gap-0.5">
                            {canEditMyRt && ymd <= todayStr && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (me) openRealtimeEditForDate(me, ymd);
                                }}
                                className={`w-6 h-6 rounded-md flex items-center justify-center text-xs transition-colors ${
                                  storedRt
                                    ? "text-[#0d9488] hover:bg-teal-50 font-bold"
                                    : "text-slate-300 hover:text-slate-700 hover:bg-slate-200/60"
                                }`}
                                title="실시간 기록 수정 (가느다란 막대)"
                              >
                                ◐
                              </button>
                            )}

                            {canShowRowPlus && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (me) {
                                    openRowAddMenuForDate(
                                      me,
                                      ymd,
                                      e.currentTarget
                                    );
                                  }
                                }}
                                className="w-6 h-6 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-200/60 flex items-center justify-center text-sm font-semibold"
                                title="근무 · 휴게 · 연차 · 실시간 기록 추가"
                              >
                                +
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 우측 24시간 그리드 셀 + 듀얼 레이어 블록 */}
                        <div
                          data-timeline-track={rowKey}
                          className={`flex-1 relative ${
                            rowDraft ? "bg-[#f5f9ff]/65" : ""
                          }`}
                        >
                          <div className="grid grid-cols-24 h-full pointer-events-none">
                            {Array.from({ length: 24 }, (_, h) => (
                              <div
                                key={h}
                                className={`h-full border-r ${
                                  h === 11
                                    ? "border-r-slate-300 border-dashed"
                                    : "border-r-slate-100"
                                }`}
                              />
                            ))}
                          </div>

                          {me && render24hBarForMemberDate(me, ymd)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          </div>

          {approvalPanelOpen && draftList.length > 0 && (
            <FlexApprovalSidePanel
              rangeStart={activeQueryRange.start}
              rangeEnd={activeQueryRange.end}
              evaluatedItems={evaluatedApprovals}
              reasonByKey={approvalReasonByKey}
              onChangeReason={(k, val) =>
                setApprovalReasonByKey((prev) => ({ ...prev, [k]: val }))
              }
              onClose={() => setApprovalPanelOpen(false)}
            />
          )}
        </div>
      )}

      {/* =====================================================================
          탭 2: [구성원 근무] 본문 영역 (권한 설정의 열람·편집 범위 엄격 적용)
         ===================================================================== */}
      {mainTab === "TEAM" && (
        <div className="flex-1 flex min-h-0">
          {!canViewAnyOtherMember ? (
            <div className="flex-1 flex flex-col items-center justify-center py-24 px-6 text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center text-xl mb-3">
                🔒
              </div>
              <h3 className="text-sm font-extrabold text-slate-800">
                다른 구성원의 근무 기록을 조회할 권한이 없어요.
              </h3>
              <p className="text-xs text-slate-400 mt-1.5 max-w-md leading-relaxed">
                관리자가 [설정 &gt; 권한 설정]에서 <strong>근무 조회</strong> 또는{" "}
                <strong>구성원 실시간 근무 기록 조회</strong> 권한을 부여하면 허용 범위 내 구성원의 근무 현황을 확인할 수 있습니다.
              </p>
            </div>
          ) : (
          <div className="flex-1 flex flex-col min-w-0">
          {/* 일 | 주 | 월 | 주기 + 날짜 이동 + 오늘 + 조직 필터 */}
          <div className="px-7 pt-4 pb-3 flex flex-wrap items-center gap-2.5">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
              {(
                [
                  { key: "DAY", label: "일" },
                  { key: "WEEK", label: "주" },
                  { key: "MONTH", label: "월" },
                  { key: "CYCLE", label: "주기" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTeamPeriodMode(t.key)}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                    teamPeriodMode === t.key
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => moveTeamPeriod(-1)}
                className="px-2.5 py-1.5 text-slate-500 hover:text-slate-900 text-xs font-bold"
              >
                ‹
              </button>
              <span className="px-3 py-1.5 text-xs font-bold text-slate-800 tabular-nums">
                {teamPeriodMode === "DAY"
                  ? formatSingleDayHeader(teamAnchorDate)
                  : teamPeriodMode === "MONTH"
                  ? `${parseYmdLocal(teamAnchorDate).getFullYear()}. ${
                      parseYmdLocal(teamAnchorDate).getMonth() + 1
                    }`
                  : formatRangeHeader(
                      activeQueryRange.start,
                      activeQueryRange.end
                    )}
              </span>
              <button
                type="button"
                onClick={() => moveTeamPeriod(1)}
                className="px-2.5 py-1.5 text-slate-500 hover:text-slate-900 text-xs font-bold"
              >
                ›
              </button>
            </div>

            <button
              type="button"
              onClick={() => setTeamAnchorDate(todayStr)}
              className="px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-xs font-bold text-slate-600"
            >
              오늘
            </button>

            {/* 주기 뷰 전용 [💼 근무 유형 ▾] 필터 (Screenshot 104600 동일) */}
            {teamPeriodMode === "CYCLE" && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setTeamRuleMenuOpen((v) => !v);
                    setDeptMenuOpen(false);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5"
                >
                  <span className="text-slate-400">💼</span>
                  <span className="text-slate-500 font-semibold">근무 유형</span>
                  <span className="text-slate-900">
                    {teamRuleFilter === "ALL"
                      ? "전체"
                      : workRules.find((r) => r.id === teamRuleFilter)?.name ||
                        "기본 9시"}
                  </span>
                  <span className="text-[10px] text-slate-400">▾</span>
                </button>
                {teamRuleMenuOpen && (
                  <div className="absolute left-0 top-full mt-1.5 w-48 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-40 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setTeamRuleFilter("ALL");
                        setTeamRuleMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-800 flex items-center justify-between"
                    >
                      <span>전체 근무 유형</span>
                      {teamRuleFilter === "ALL" && (
                        <span className="text-emerald-600">✓</span>
                      )}
                    </button>
                    {workRules
                      .filter((r) => !r.is_hidden)
                      .map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setTeamRuleFilter(r.id);
                            setTeamRuleMenuOpen(false);
                          }}
                          className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700 flex items-center justify-between"
                        >
                          <span>{r.name}</span>
                          {teamRuleFilter === r.id && (
                            <span className="text-emerald-600">✓</span>
                          )}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* [조직 ▾] 드롭다운 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setDeptMenuOpen((v) => !v)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5"
              >
                <span className="text-slate-400">品</span>
                <span>{deptFilter === "ALL" ? "조직" : deptFilter}</span>
                <span className="text-[10px] text-slate-400">▾</span>
              </button>
              {deptMenuOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-44 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-40 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setDeptFilter("ALL");
                      setDeptMenuOpen(false);
                    }}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-800 flex items-center justify-between"
                  >
                    <span>전체 조직</span>
                    {deptFilter === "ALL" && (
                      <span className="text-emerald-600">✓</span>
                    )}
                  </button>
                  {departments.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setDeptFilter(d);
                        setDeptMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700 flex items-center justify-between"
                    >
                      <span>{d}</span>
                      {deptFilter === d && (
                        <span className="text-emerald-600">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 주기 뷰에서는 휴가 시간 포함 토글 + 범례 바 표시 (Screenshot 104600 동일) */}
          {teamPeriodMode === "CYCLE" ? (
            <div className="px-7 pb-3.5 border-b border-slate-200 flex flex-wrap items-center gap-4 text-xs">
              <div className="flex items-center gap-2 pr-3 border-r border-slate-200">
                <span className="font-semibold text-slate-700">
                  휴가 시간 포함
                </span>
                <button
                  type="button"
                  onClick={() => setIncludeLeaveInCycle((v) => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                    includeLeaveInCycle ? "bg-[#16cc3b]" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${
                      includeLeaveInCycle ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center gap-1.5 font-semibold text-slate-600">
                <span className="w-3 h-3 rounded-[3px] bg-[#a855f7] inline-block" />
                <span>휴가 시간</span>
              </div>
              <div className="flex items-center gap-1.5 font-semibold text-slate-600">
                <span className="w-3 h-3 rounded-[3px] bg-[#00bfa5] inline-block" />
                <span>소정 근무 시간</span>
              </div>
              <div className="flex items-center gap-1.5 font-semibold text-slate-600">
                <span className="w-3 h-3 rounded-[3px] bg-[#ea6a47] inline-block" />
                <span>초과 근무 시간</span>
              </div>
            </div>
          ) : (
          /* 휴가 / 초과 근무 / 맞춤 근무 / 실시간 근무중 요약 필터 바 */
          <div className="px-7 pb-3.5 border-b border-slate-200 flex flex-wrap items-center gap-5 text-xs">
            <button
              type="button"
              onClick={() =>
                setTeamStatusFilter((f) => (f === "LEAVE" ? "ALL" : "LEAVE"))
              }
              className={`flex items-center gap-1.5 py-1 rounded-lg transition-colors ${
                teamStatusFilter === "LEAVE"
                  ? "px-2 bg-purple-50 text-purple-700 ring-1 ring-purple-200 font-bold"
                  : "text-slate-700 hover:text-slate-900"
              }`}
            >
              <span>🏖️</span>
              <span className="font-bold">휴가</span>
              <span className="text-slate-400 font-semibold">
                {teamSummaryCounts.leaveCount > 0
                  ? `${teamSummaryCounts.leaveCount}명`
                  : "없음"}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                setTeamStatusFilter((f) =>
                  f === "OVERTIME" ? "ALL" : "OVERTIME"
                )
              }
              className={`flex items-center gap-1.5 py-1 rounded-lg transition-colors ${
                teamStatusFilter === "OVERTIME"
                  ? "px-2 bg-rose-50 text-rose-700 ring-1 ring-rose-200 font-bold"
                  : "text-slate-700 hover:text-slate-900"
              }`}
            >
              <span>🔥</span>
              <span className="font-bold">초과 근무</span>
              <span className="text-slate-400 font-semibold">
                {teamSummaryCounts.overtimeCount > 0
                  ? `${teamSummaryCounts.overtimeCount}명`
                  : "없음"}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                setTeamStatusFilter((f) => (f === "CUSTOM" ? "ALL" : "CUSTOM"))
              }
              className={`flex items-center gap-1.5 py-1 rounded-lg transition-colors ${
                teamStatusFilter === "CUSTOM"
                  ? "px-2 bg-amber-50 text-amber-800 ring-1 ring-amber-200 font-bold"
                  : "text-slate-700 hover:text-slate-900"
              }`}
            >
              <span className="text-amber-500">✦</span>
              <span className="font-bold">맞춤 근무</span>
              <span className="text-slate-400 font-semibold">
                {teamSummaryCounts.customWorkCount > 0
                  ? `${teamSummaryCounts.customWorkCount}명`
                  : "없음"}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                setTeamStatusFilter((f) =>
                  f === "WORKING" ? "ALL" : "WORKING"
                )
              }
              className={`flex items-center gap-1.5 py-1 rounded-lg transition-colors ${
                teamStatusFilter === "WORKING"
                  ? "px-2 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 font-bold"
                  : "text-slate-700 hover:text-slate-900"
              }`}
            >
              <span>🟢</span>
              <span className="font-bold">실시간 근무중</span>
              <span className="text-slate-400 font-semibold">
                {teamSummaryCounts.workingNowCount > 0
                  ? `${teamSummaryCounts.workingNowCount}명`
                  : "없음"}
              </span>
            </button>

            {teamStatusFilter !== "ALL" && (
              <button
                type="button"
                onClick={() => setTeamStatusFilter("ALL")}
                className="text-[11px] font-bold text-blue-600 hover:underline"
              >
                필터 해제
              </button>
            )}
          </div>
          )}

          {teamPeriodMode === "DAY" ? (
            /* 구성원 근무 > [일] 24시간 수평 타임라인 (스크린샷 100% 재현) */
            <div className="flex-1 overflow-x-auto">
              <div className="min-w-[1020px] relative">
                {/* 24시간 눈금 헤더 */}
                <div className="flex border-b border-slate-200 bg-white sticky top-0 z-20">
                  <div className="w-60 shrink-0 px-7 py-2.5 border-r border-slate-100" />
                  <div className="flex-1 relative h-9">
                    <div className="grid grid-cols-24 h-full">
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className="relative h-full">
                          {h > 0 && (
                            <span
                              className={`absolute -left-3 bottom-1.5 text-[10px] tabular-nums ${
                                h === 12
                                  ? "font-bold text-slate-500 -left-4"
                                  : "font-medium text-slate-400"
                              }`}
                            >
                              {h === 12 ? (
                                <span className="flex flex-col items-center leading-none">
                                  <span className="text-[9px] text-slate-400">
                                    정오
                                  </span>
                                  <span>12</span>
                                </span>
                              ) : h > 12 ? (
                                h - 12
                              ) : (
                                h
                              )}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {showNowLine && teamAnchorDate === todayStr && (
                      <div
                        style={{
                          left: `${(nowMinutesOfDay / 1440) * 100}%`,
                        }}
                        className="absolute bottom-1 -translate-x-1/2 px-1.5 py-0.5 rounded bg-white text-[#e85d3f] text-[10px] font-extrabold whitespace-nowrap z-30"
                      >
                        {nowKoreanLabel}
                      </div>
                    )}
                  </div>
                </div>

                {/* 구성원별 행 */}
                <div className="relative divide-y divide-slate-100">
                  {showNowLine && teamAnchorDate === todayStr && (
                    <div
                      style={{
                        left: `calc(15rem + (100% - 15rem) * ${
                          nowMinutesOfDay / 1440
                        })`,
                      }}
                      className="absolute top-0 bottom-0 w-[1.5px] bg-[#e85d3f]/85 pointer-events-none z-20"
                    />
                  )}

                  {loading && filteredTeamMembers.length === 0 ? (
                    <div className="py-20 text-center text-xs font-semibold text-slate-400">
                      구성원 근무 현황을 불러오는 중입니다...
                    </div>
                  ) : filteredTeamMembers.length === 0 ? (
                    <div className="py-20 text-center text-xs font-bold text-slate-500">
                      조건에 해당하는 구성원이 없습니다.
                    </div>
                  ) : (
                    filteredTeamMembers.map((m) => {
                      const canEditM = canEditTargetWork(m);
                      const canEditMRt = canEditRealtimeWork(m);
                      const rowKey = `${m.instructor_id}__${teamAnchorDate}`;
                      const rowDraft = draftEdits[rowKey];
                      const storedTeamSched =
                        recognizedScheduleByMemberDate.get(rowKey);
                      const storedRt = realtimeLogByMemberDate.get(rowKey);
                      const rule = resolveMemberWorkRule(
                        m.name,
                        m.profile_extra?.work_schedule_type
                      );
                      const rec = recordByMemberDate.get(rowKey);
                      const dowKo =
                        WEEKDAY_KO[parseYmdLocal(teamAnchorDate).getDay()];
                      const holiday = holidayMap.get(teamAnchorDate);
                      const isWorkDay =
                        rule.work_days.includes(dowKo) && !holiday;
                      const ruleDailyMin =
                        Number(rule.daily_work_hours || 8) * 60 +
                        Number(rule.daily_work_minutes || 0);
                      const plannedMin = isWorkDay ? ruleDailyMin : 0;
                      const displayMin = rowDraft
                        ? calcDraftNetWorkedMinutes(rowDraft)
                        : storedTeamSched
                          ? calcDayScheduleSummary(
                              storedTeamSched.segments,
                              storedTeamSched.breaks,
                              ruleDailyMin
                            ).workedMinutes
                          : rec
                            ? rec.status === "WORKING"
                              ? plannedMin || ruleDailyMin
                              : Number(rec.worked_minutes || plannedMin)
                            : plannedMin;
                      const isOvertimeRow =
                        !rowDraft &&
                        displayMin > ruleDailyMin &&
                        (Boolean(rec) ||
                          Boolean(storedTeamSched) ||
                          displayMin > 0);

                      const shortTwo = m.name.slice(-2);
                      const subRole =
                        m.job_description ||
                        (m.department !== "미지정" ? m.department : "");

                      return (
                        <div
                          key={m.instructor_id}
                          className="flex h-[74px] transition-colors hover:bg-slate-50/45"
                        >
                          {/* 좌측: 2글자 컬러 아바타 + 성명/직무 + 8:00(초과 시 🔥) + [◐] + [+] */}
                          <div
                            className={`w-60 shrink-0 px-6 flex items-center justify-between border-r bg-white ${
                              rowDraft
                                ? "border-r-[3px] border-r-[#0066ff]"
                                : "border-r-slate-100"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                style={{
                                  backgroundColor: avatarColorForName(m.name),
                                }}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-extrabold shrink-0 shadow-2xs"
                              >
                                {shortTwo}
                              </div>
                              <div className="min-w-0">
                                <div className="text-[13px] font-bold text-slate-900 truncate">
                                  {m.name}
                                </div>
                                {subRole && (
                                  <div className="text-[11px] text-slate-400 truncate leading-tight">
                                    {subRole}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] font-bold tabular-nums inline-flex items-center gap-0.5 shrink-0 ${
                                  rowDraft
                                    ? "bg-[#0066ff] text-white font-extrabold"
                                    : isOvertimeRow
                                      ? "bg-[#fff1eb] text-[#c2410c] font-extrabold"
                                      : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                <span>{formatHmColon(displayMin)}</span>
                                {isOvertimeRow && (
                                  <span className="text-[10px]">🔥</span>
                                )}
                              </span>

                              {canEditMRt && teamAnchorDate <= todayStr && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openRealtimeEditForDate(m, teamAnchorDate);
                                  }}
                                  className={`w-5.5 h-5.5 rounded-md flex items-center justify-center text-xs transition-colors ${
                                    storedRt
                                      ? "text-[#0d9488] hover:bg-teal-50 font-bold"
                                      : "text-slate-300 hover:text-slate-700 hover:bg-slate-100"
                                  }`}
                                  title="실시간 기록 수정 (가느다란 막대)"
                                >
                                  ◐
                                </button>
                              )}

                              {(canEditM ||
                                (teamAnchorDate < todayStr && canEditMRt)) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openRowAddMenuForDate(
                                      m,
                                      teamAnchorDate,
                                      e.currentTarget
                                    );
                                  }}
                                  className="w-5.5 h-5.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center text-xs font-bold"
                                  title="일정 · 휴게 추가"
                                >
                                  +
                                </button>
                              )}
                            </div>
                          </div>

                          {/* 우측: 24시간 그리드 + 예정/실제 근무 바 */}
                          <div
                            data-timeline-track={rowKey}
                            className={`flex-1 relative ${
                              rowDraft ? "bg-[#f5f9ff]/65" : ""
                            }`}
                          >
                            <div className="grid grid-cols-24 h-full pointer-events-none">
                              {Array.from({ length: 24 }, (_, h) => (
                                <div
                                  key={h}
                                  className={`h-full border-r ${
                                    h === 11
                                      ? "border-r-slate-300 border-dashed"
                                      : "border-r-slate-100"
                                  }`}
                                />
                              ))}
                            </div>

                            {render24hBarForMemberDate(m, teamAnchorDate)}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ) : teamPeriodMode === "CYCLE" ? (
            /* ===============================================================
               구성원 근무 > [주기] 플렉스 근무주기 스택 바 뷰 (Screenshot 104600 100% 재현!)
               =============================================================== */
            <div className="flex-1 overflow-x-auto">
              <div className="min-w-[860px] divide-y divide-slate-100 border-b border-slate-100">
                {filteredTeamMembers.map((m) => {
                  const rule = resolveMemberWorkRule(
                    m.name,
                    m.profile_extra?.work_schedule_type
                  );
                  const cycleDays = buildDateList(
                    activeQueryRange.start,
                    activeQueryRange.end
                  );
                  const ruleDailyMin =
                    Number(rule.daily_work_hours || 8) * 60 +
                    Number(rule.daily_work_minutes || 0);
                  const targetRegularMin =
                    Math.max(1, rule.work_days.length) * ruleDailyMin; // 예: 40h = 2400m
                  const maxScaleMin = targetRegularMin + 720; // 예: 52h = 3120m

                  let leaveMin = 0;
                  let regularWorkMin = 0;
                  let overtimeMin = 0;

                  cycleDays.forEach((ymd) => {
                    const rec = recordByMemberDate.get(
                      `${m.instructor_id}__${ymd}`
                    );
                    const lvDoc = leaveApprovalByMemberDate.get(
                      `${m.instructor_id}__${ymd}`
                    );
                    const dowKo = WEEKDAY_KO[parseYmdLocal(ymd).getDay()];
                    const holiday = holidayMap.get(ymd);
                    const isWorkDay = rule.work_days.includes(dowKo) && !holiday;

                    const lvLabel = String(
                      lvDoc?.leave_type ||
                        (rec?.work_mode === "LEAVE" ? rec.location_note : "") ||
                        ""
                    );
                    const isHalf =
                      rec?.status === "HALF_LEAVE" || lvLabel.includes("반차");
                    const hasFullLv =
                      (rec?.work_mode === "LEAVE" &&
                        rec?.status !== "HALF_LEAVE") ||
                      rec?.status === "LEAVE" ||
                      (Boolean(lvDoc) &&
                        !isHalf &&
                        !lvLabel.includes("시간차"));

                    if (hasFullLv) {
                      leaveMin += ruleDailyMin;
                    } else if (isHalf) {
                      leaveMin += 240;
                      const wMin = rec
                        ? Number(rec.worked_minutes || 240)
                        : isWorkDay
                          ? Math.max(0, ruleDailyMin - 240)
                          : 0;
                      regularWorkMin += wMin;
                    } else if (rec) {
                      const wMin =
                        rec.status === "WORKING"
                          ? ruleDailyMin
                          : Number(rec.worked_minutes || ruleDailyMin);
                      const ot = Number(
                        rec.overtime_minutes || Math.max(0, wMin - ruleDailyMin)
                      );
                      regularWorkMin += Math.max(0, wMin - ot);
                      overtimeMin += ot;
                    } else if (isWorkDay) {
                      regularWorkMin += ruleDailyMin;
                    }
                  });

                  const countedLeave = includeLeaveInCycle ? leaveMin : 0;
                  const totalDisplayMin =
                    countedLeave + regularWorkMin + overtimeMin;

                  const regularMarkerPct = (targetRegularMin / maxScaleMin) * 100;
                  const leaveWidthPct = Math.min(
                    100,
                    (countedLeave / maxScaleMin) * 100
                  );
                  const regCapLeft = Math.max(
                    0,
                    regularMarkerPct - leaveWidthPct
                  );
                  const regWidthPct = Math.min(
                    regCapLeft,
                    (regularWorkMin / maxScaleMin) * 100
                  );
                  const extraOverPct = Math.min(
                    100 - leaveWidthPct - regWidthPct,
                    ((Math.max(
                      0,
                      countedLeave + regularWorkMin - targetRegularMin
                    ) +
                      overtimeMin) /
                      maxScaleMin) *
                      100
                  );

                  const subRole =
                    m.job_description ||
                    (m.department !== "미지정" ? m.department : "");

                  return (
                    <div
                      key={m.instructor_id}
                      onClick={(e) =>
                        canEditTargetWork(m) &&
                        openEntryForDate(m, todayStr, {
                          anchorEl: e.currentTarget,
                        })
                      }
                      className={`flex items-center h-[62px] transition-colors ${
                        canEditTargetWork(m)
                          ? "hover:bg-slate-50/70 cursor-pointer"
                          : "cursor-default"
                      }`}
                    >
                      {/* 좌측 구성원 + [40:00 / 40:00] 배지 */}
                      <div className="w-80 shrink-0 px-7 flex items-center justify-between border-r border-slate-100 h-full">
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            style={{
                              backgroundColor: avatarColorForName(m.name),
                            }}
                            className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold inline-flex items-center justify-center shrink-0"
                          >
                            {m.name.slice(-2)}
                          </span>
                          <div className="min-w-0">
                            <div className="text-[13px] font-bold text-slate-900 truncate">
                              {m.name}
                            </div>
                            {subRole && (
                              <div className="text-[11px] text-slate-400 truncate">
                                {subRole}
                              </div>
                            )}
                          </div>
                        </div>

                        <span className="px-2 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-bold text-slate-800 tabular-nums shrink-0">
                          <span>{formatHmColon(totalDisplayMin)}</span>
                          <span className="text-slate-400 font-semibold">
                            {" "}
                            / {formatHmColon(targetRegularMin)}
                          </span>
                        </span>
                      </div>

                      {/* 우측 수평 주기 프로그레스 바 */}
                      <div className="flex-1 px-6 flex items-center">
                        <div className="w-full h-2.5 rounded-full bg-slate-100 relative flex items-center">
                          <div className="w-full h-full rounded-full overflow-hidden flex">
                            {leaveWidthPct > 0 && (
                              <div
                                style={{ width: `${leaveWidthPct}%` }}
                                className="h-full bg-[#b07cfb] transition-all duration-300"
                              />
                            )}
                            {regWidthPct > 0 && (
                              <div
                                style={{ width: `${regWidthPct}%` }}
                                className="h-full bg-[#00c4a7] transition-all duration-300"
                              />
                            )}
                            {extraOverPct > 0 && (
                              <div
                                style={{ width: `${extraOverPct}%` }}
                                className="h-full bg-[#ea6a47] transition-all duration-300"
                              />
                            )}
                          </div>

                          {/* 40시간 소정근로 기준 세로 마커 틱 */}
                          <span
                            style={{ left: `${regularMarkerPct}%` }}
                            className="pointer-events-none absolute -top-1 -bottom-1 w-[2px] rounded-full bg-[#00a896]"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : teamPeriodMode === "WEEK" ? (
            /* ===============================================================
               구성원 근무 > [주] 주단위 일정·기록 매트릭스 (Screenshot 104427 100% 재현!)
               =============================================================== */
            <div className="flex-1 overflow-x-auto">
              {(() => {
                const weekDays = buildDateList(
                  activeQueryRange.start,
                  activeQueryRange.end
                );
                const anchorMonthLabel = `${
                  parseYmdLocal(activeQueryRange.start).getMonth() + 1
                }월`;

                return (
                  <div className="min-w-[1080px]">
                    <div className="flex border-b border-slate-200 bg-white sticky top-0 z-20 text-xs font-bold text-slate-600">
                      <div className="w-64 shrink-0 px-7 py-2.5 border-r border-slate-100">
                        {anchorMonthLabel}
                      </div>
                      <div className="flex-1 grid grid-cols-7 divide-x divide-slate-100">
                        {weekDays.map((ymd) => {
                          const dt = parseYmdLocal(ymd);
                          const dow = dt.getDay();
                          const isToday = ymd === todayStr;
                          const isOff =
                            dow === 0 || dow === 6 || holidayMap.has(ymd);
                          return (
                            <div
                              key={ymd}
                              className="px-2.5 py-2.5 flex items-center gap-1"
                            >
                              <span
                                className={`tabular-nums font-extrabold ${
                                  isToday
                                    ? "w-5.5 h-5.5 rounded-md bg-[#ea580c] text-white inline-flex items-center justify-center text-[11px]"
                                    : isOff
                                      ? "text-[#e85d3f]"
                                      : "text-slate-700"
                                }`}
                              >
                                {dt.getDate()}
                              </span>
                              <span
                                className={
                                  isOff ? "text-[#e85d3f]" : "text-slate-500"
                                }
                              >
                                {WEEKDAY_KO[dow]}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100 border-b border-slate-100">
                      {filteredTeamMembers.map((m) => {
                        const rule = resolveMemberWorkRule(
                          m.name,
                          m.profile_extra?.work_schedule_type
                        );
                        const ruleStartMin =
                          parseHmToMinutes(rule.start_time) ?? 540;
                        const ruleWorkMin =
                          Number(rule.daily_work_hours || 8) * 60 +
                          Number(rule.daily_work_minutes || 0);
                        const ruleBreakMin = calcBreakMinutes(rule);
                        const ruleEndMin =
                          ruleStartMin + ruleWorkMin + ruleBreakMin;

                        let weekTotalMin = 0;
                        weekDays.forEach((ymd) => {
                          const rec = recordByMemberDate.get(
                            `${m.instructor_id}__${ymd}`
                          );
                          const lvDoc = leaveApprovalByMemberDate.get(
                            `${m.instructor_id}__${ymd}`
                          );
                          const dowKo = WEEKDAY_KO[parseYmdLocal(ymd).getDay()];
                          const isWorkDay =
                            rule.work_days.includes(dowKo) &&
                            !holidayMap.has(ymd);
                          if (lvDoc || rec?.work_mode === "LEAVE") {
                            weekTotalMin += ruleWorkMin;
                          } else if (rec) {
                            weekTotalMin +=
                              rec.status === "WORKING"
                                ? ruleWorkMin
                                : Number(rec.worked_minutes || ruleWorkMin);
                          } else if (isWorkDay) {
                            weekTotalMin += ruleWorkMin;
                          }
                        });

                        const subRole =
                          m.job_description ||
                          (m.department !== "미지정" ? m.department : "");

                        return (
                          <div
                            key={m.instructor_id}
                            className="flex min-h-[60px] hover:bg-slate-50/50 transition-colors"
                          >
                            <div className="w-64 shrink-0 px-7 py-2.5 border-r border-slate-100 flex items-center justify-between bg-white">
                              <div className="flex items-center gap-3 min-w-0">
                                <span
                                  style={{
                                    backgroundColor: avatarColorForName(m.name),
                                  }}
                                  className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold inline-flex items-center justify-center shrink-0"
                                >
                                  {m.name.slice(-2)}
                                </span>
                                <div className="min-w-0">
                                  <div className="text-[13px] font-bold text-slate-900 truncate">
                                    {m.name}
                                  </div>
                                  {subRole && (
                                    <div className="text-[11px] text-slate-400 truncate">
                                      {subRole}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <span className="px-2 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-bold text-slate-700 tabular-nums shrink-0">
                                {formatHmColon(weekTotalMin)}
                              </span>
                            </div>

                            <div className="flex-1 grid grid-cols-7 divide-x divide-slate-100">
                              {weekDays.map((ymd) => {
                                const rec = recordByMemberDate.get(
                                  `${m.instructor_id}__${ymd}`
                                );
                                const lvDoc = leaveApprovalByMemberDate.get(
                                  `${m.instructor_id}__${ymd}`
                                );
                                const dowKo =
                                  WEEKDAY_KO[parseYmdLocal(ymd).getDay()];
                                const holiday = holidayMap.get(ymd);
                                const isWorkDay =
                                  rule.work_days.includes(dowKo) && !holiday;

                                const lvLabel = String(
                                  lvDoc?.leave_type ||
                                    (rec?.work_mode === "LEAVE"
                                      ? rec.location_note
                                      : "") ||
                                    ""
                                );
                                const isHalf =
                                  rec?.status === "HALF_LEAVE" ||
                                  lvLabel.includes("반차");
                                const hasFullLv =
                                  (rec?.work_mode === "LEAVE" &&
                                    rec?.status !== "HALF_LEAVE") ||
                                  rec?.status === "LEAVE" ||
                                  (Boolean(lvDoc) &&
                                    !isHalf &&
                                    !lvLabel.includes("시간차"));

                                const inMin =
                                  isoToMinutesOfDay(rec?.check_in_at, ymd) ??
                                  ruleStartMin;
                                const outMin =
                                  isoToMinutesOfDay(rec?.check_out_at, ymd) ??
                                  ruleEndMin;
                                const isPastOrDone =
                                  ymd < todayStr || rec?.status === "DONE";

                                return (
                                  <div
                                    key={ymd}
                                    onClick={(e) =>
                                      canEditTargetWork(m) &&
                                      openEntryForDate(m, ymd, {
                                        anchorEl: e.currentTarget,
                                      })
                                    }
                                    className={`p-1.5 space-y-1 ${
                                      draftEdits[`${m.instructor_id}__${ymd}`]
                                        ? "bg-[#f5f9ff]"
                                        : ""
                                    } ${
                                      canEditTargetWork(m)
                                        ? "cursor-pointer hover:bg-slate-50"
                                        : "cursor-default"
                                    }`}
                                  >
                                    {hasFullLv ? (
                                      <div className="px-2 py-1 rounded-[4px] bg-[#8b5cf6] text-white text-[10.5px] font-bold truncate">
                                        ☂ {lvLabel || "연차"} 하루종일
                                      </div>
                                    ) : isHalf ? (
                                      <>
                                        <div className="px-2 py-0.5 rounded-[4px] bg-[#8b5cf6] text-white text-[10px] font-bold truncate">
                                          ☂ {lvLabel || "반차"}
                                        </div>
                                        <div
                                          className={`px-2 py-0.5 rounded-[4px] border text-[10px] font-bold truncate ${
                                            isPastOrDone
                                              ? "bg-[#d4f7ef] border-[#5eead4] text-[#0f766e]"
                                              : "bg-white border-[#5eead4] text-[#0f766e]"
                                          }`}
                                        >
                                          근무 4h
                                        </div>
                                      </>
                                    ) : isWorkDay || rec ? (
                                      <div
                                        className={`px-2 py-1 rounded-[4px] border text-[10.5px] font-semibold truncate ${
                                          isPastOrDone
                                            ? "bg-[#d4f7ef] border-[#6ee7d8] text-[#0f766e]"
                                            : "bg-white border-[#6ee7d8] text-[#0f766e]"
                                        }`}
                                      >
                                        <span className="font-extrabold">
                                          근무
                                        </span>{" "}
                                        <span className="text-slate-600 tabular-nums">
                                          {formatMinutesToKoreanAmPm(inMin)} –{" "}
                                          {formatMinutesToKoreanAmPm(outMin)}
                                        </span>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            /* ===============================================================
               구성원 근무 > [월] 월단위 일별 매트릭스 (Screenshot 104534 100% 재현!)
               =============================================================== */
            <div className="flex-1 overflow-x-auto">
              {(() => {
                const monthDays = buildDateList(
                  activeQueryRange.start,
                  activeQueryRange.end
                );
                const monthLabel = `${
                  parseYmdLocal(activeQueryRange.start).getMonth() + 1
                }월`;

                return (
                  <div
                    style={{
                      minWidth: `${256 + monthDays.length * 88}px`,
                    }}
                  >
                    <div className="flex border-b border-slate-200 bg-white sticky top-0 z-20 text-xs font-bold text-slate-600">
                      <div className="w-64 shrink-0 px-7 py-2.5 border-r border-slate-100 bg-white sticky left-0 z-30">
                        {monthLabel}
                      </div>
                      <div
                        style={{
                          gridTemplateColumns: `repeat(${monthDays.length}, minmax(88px, 1fr))`,
                        }}
                        className="flex-1 grid divide-x divide-slate-100"
                      >
                        {monthDays.map((ymd) => {
                          const dt = parseYmdLocal(ymd);
                          const dow = dt.getDay();
                          const isToday = ymd === todayStr;
                          const isOff =
                            dow === 0 || dow === 6 || holidayMap.has(ymd);
                          return (
                            <div
                              key={ymd}
                              className="px-2.5 py-2.5 flex items-center gap-1"
                            >
                              <span
                                className={`tabular-nums font-extrabold ${
                                  isToday
                                    ? "w-5 h-5 rounded bg-[#ea580c] text-white inline-flex items-center justify-center text-[10.5px]"
                                    : isOff
                                      ? "text-[#e85d3f]"
                                      : "text-slate-700"
                                }`}
                              >
                                {dt.getDate()}
                              </span>
                              <span
                                className={
                                  isOff ? "text-[#e85d3f]" : "text-slate-500"
                                }
                              >
                                {WEEKDAY_KO[dow]}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100 border-b border-slate-100">
                      {filteredTeamMembers.map((m) => {
                        const rule = resolveMemberWorkRule(
                          m.name,
                          m.profile_extra?.work_schedule_type
                        );
                        const ruleWorkMin =
                          Number(rule.daily_work_hours || 8) * 60 +
                          Number(rule.daily_work_minutes || 0);

                        let monthTotalMin = 0;
                        monthDays.forEach((ymd) => {
                          const rec = recordByMemberDate.get(
                            `${m.instructor_id}__${ymd}`
                          );
                          const lvDoc = leaveApprovalByMemberDate.get(
                            `${m.instructor_id}__${ymd}`
                          );
                          const dowKo = WEEKDAY_KO[parseYmdLocal(ymd).getDay()];
                          const isWorkDay =
                            rule.work_days.includes(dowKo) &&
                            !holidayMap.has(ymd);
                          if (lvDoc || rec?.work_mode === "LEAVE") {
                            monthTotalMin += ruleWorkMin;
                          } else if (rec) {
                            monthTotalMin +=
                              rec.status === "WORKING"
                                ? ruleWorkMin
                                : Number(rec.worked_minutes || ruleWorkMin);
                          } else if (isWorkDay) {
                            monthTotalMin += ruleWorkMin;
                          }
                        });

                        const subRole =
                          m.job_description ||
                          (m.department !== "미지정" ? m.department : "");

                        return (
                          <div
                            key={m.instructor_id}
                            className="flex min-h-[60px] hover:bg-slate-50/50 transition-colors"
                          >
                            <div className="w-64 shrink-0 px-7 py-2.5 border-r border-slate-100 flex items-center justify-between bg-white sticky left-0 z-10">
                              <div className="flex items-center gap-3 min-w-0">
                                <span
                                  style={{
                                    backgroundColor: avatarColorForName(m.name),
                                  }}
                                  className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold inline-flex items-center justify-center shrink-0"
                                >
                                  {m.name.slice(-2)}
                                </span>
                                <div className="min-w-0">
                                  <div className="text-[13px] font-bold text-slate-900 truncate">
                                    {m.name}
                                  </div>
                                  {subRole && (
                                    <div className="text-[11px] text-slate-400 truncate">
                                      {subRole}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <span className="px-2 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-bold text-slate-700 tabular-nums shrink-0">
                                {formatHmColon(monthTotalMin)}
                              </span>
                            </div>

                            <div
                              style={{
                                gridTemplateColumns: `repeat(${monthDays.length}, minmax(88px, 1fr))`,
                              }}
                              className="flex-1 grid divide-x divide-slate-100"
                            >
                              {monthDays.map((ymd) => {
                                const rec = recordByMemberDate.get(
                                  `${m.instructor_id}__${ymd}`
                                );
                                const lvDoc = leaveApprovalByMemberDate.get(
                                  `${m.instructor_id}__${ymd}`
                                );
                                const dowKo =
                                  WEEKDAY_KO[parseYmdLocal(ymd).getDay()];
                                const holiday = holidayMap.get(ymd);
                                const isWorkDay =
                                  rule.work_days.includes(dowKo) && !holiday;

                                const lvLabel = String(
                                  lvDoc?.leave_type ||
                                    (rec?.work_mode === "LEAVE"
                                      ? rec.location_note
                                      : "") ||
                                    ""
                                );
                                const isHalf =
                                  rec?.status === "HALF_LEAVE" ||
                                  lvLabel.includes("반차");
                                const isHourly =
                                  lvLabel.includes("반반차") ||
                                  lvLabel.includes("시간차");
                                const hasFullLv =
                                  (rec?.work_mode === "LEAVE" &&
                                    rec?.status !== "HALF_LEAVE") ||
                                  rec?.status === "LEAVE" ||
                                  (Boolean(lvDoc) && !isHalf && !isHourly);

                                const isPastOrDone =
                                  ymd < todayStr || rec?.status === "DONE";
                                const wHours = Math.round(
                                  ((rec && rec.status === "DONE"
                                    ? Number(rec.worked_minutes || ruleWorkMin)
                                    : ruleWorkMin) /
                                    60) *
                                    10
                                ) / 10;

                                return (
                                  <div
                                    key={ymd}
                                    onClick={(e) =>
                                      canEditTargetWork(m) &&
                                      openEntryForDate(m, ymd, {
                                        anchorEl: e.currentTarget,
                                      })
                                    }
                                    className={`p-1.5 space-y-1 ${
                                      draftEdits[`${m.instructor_id}__${ymd}`]
                                        ? "bg-[#f5f9ff]"
                                        : ""
                                    } ${
                                      canEditTargetWork(m)
                                        ? "cursor-pointer hover:bg-slate-50"
                                        : "cursor-default"
                                    }`}
                                  >
                                    {hasFullLv ? (
                                      <div className="px-1.5 py-0.5 rounded-[4px] bg-[#8b5cf6] text-white text-[10.5px] font-bold truncate">
                                        ☂ 연차 8h
                                      </div>
                                    ) : isHalf ? (
                                      <>
                                        <div className="px-1.5 py-0.5 rounded-[4px] bg-[#d4f7ef] border border-[#6ee7d8] text-[#0f766e] text-[10px] font-bold truncate">
                                          근무 4h
                                        </div>
                                        <div className="px-1.5 py-0.5 rounded-[4px] bg-[#8b5cf6] text-white text-[10px] font-bold truncate">
                                          ☂ 연차 4h
                                        </div>
                                      </>
                                    ) : isHourly ? (
                                      <>
                                        <div className="px-1.5 py-0.5 rounded-[4px] bg-[#d4f7ef] border border-[#6ee7d8] text-[#0f766e] text-[10px] font-bold truncate">
                                          근무 6h
                                        </div>
                                        <div className="px-1.5 py-0.5 rounded-[4px] bg-[#8b5cf6] text-white text-[10px] font-bold truncate">
                                          ☂ 연차 2h
                                        </div>
                                      </>
                                    ) : isWorkDay || rec ? (
                                      <div
                                        className={`px-1.5 py-0.5 rounded-[4px] border text-[10.5px] font-bold truncate ${
                                          isPastOrDone
                                            ? "bg-[#d4f7ef] border-[#6ee7d8] text-[#0f766e]"
                                            : "bg-white border-[#6ee7d8] text-[#0f766e]"
                                        }`}
                                      >
                                        근무 {wHours}h
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          </div>
          )}

          {canViewAnyOtherMember && approvalPanelOpen && draftList.length > 0 && (
            <FlexApprovalSidePanel
              rangeStart={activeQueryRange.start}
              rangeEnd={activeQueryRange.end}
              evaluatedItems={evaluatedApprovals}
              reasonByKey={approvalReasonByKey}
              onChangeReason={(k, val) =>
                setApprovalReasonByKey((prev) => ({ ...prev, [k]: val }))
              }
              onClose={() => setApprovalPanelOpen(false)}
            />
          )}
        </div>
      )}

      {/* =====================================================================
          플렉스 [+] 메뉴 / 휴게 목록 팝오버 / 인라인 인정 근무·휴게 팝오버 & 하단 드래프트 바
         ===================================================================== */}
      {rowAddMenu && (() => {
        const menuBase = getBaselineDaySchedule(
          rowAddMenu.member,
          rowAddMenu.ymd
        );
        return (
          <FlexRowAddPopover
            isPastDate={rowAddMenu.ymd < todayStr}
            isHolidayOrOff={menuBase.isHolidayOrOff}
            canEditWork={canEditTargetWork(rowAddMenu.member)}
            canEditRealtime={canEditRealtimeWork(rowAddMenu.member)}
            workFormPolicies={workFormPolicies}
            anchorRect={rowAddMenu.anchorRect}
            onSelectWorkPolicy={(policyName, workMode, defaultLoc) =>
              addWorkSegmentForDate(
                rowAddMenu.member,
                rowAddMenu.ymd,
                policyName,
                workMode,
                defaultLoc
              )
            }
            onSelectBreak={() =>
              addBreakBlockForDate(rowAddMenu.member, rowAddMenu.ymd, null)
            }
            onSelectAnnualLeave={() => {
              setLeaveModalInitialDate(rowAddMenu.ymd);
              setLeaveRegisterKind({ type: "ANNUAL" });
              setLeaveModalOpen(true);
            }}
            onSelectRealtimeRecord={() =>
              openRealtimeEditForDate(rowAddMenu.member, rowAddMenu.ymd)
            }
            onClose={() => setRowAddMenu(null)}
          />
        );
      })()}

      {breakListPopover && (() => {
        const eff = getEffectiveDaySchedule(
          breakListPopover.member,
          breakListPopover.ymd
        );
        const seg = eff.segments.find(
          (s) => s.id === breakListPopover.segmentId
        );
        const matchingBreaks = seg
          ? getBreaksOverlappingSegment(seg, eff.breaks)
          : eff.breaks;
        return (
          <FlexBreakListPopover
            breaks={matchingBreaks}
            canEdit={canEditTargetWork(breakListPopover.member)}
            anchorRect={breakListPopover.anchorRect}
            onAddBreak={() =>
              addBreakBlockForDate(
                breakListPopover.member,
                breakListPopover.ymd,
                breakListPopover.segmentId
              )
            }
            onEditBreak={(breakId) => {
              const targetM = breakListPopover.member;
              const targetYmd = breakListPopover.ymd;
              setBreakListPopover(null);
              openItemPopover(targetM, targetYmd, "BREAK", breakId, null, null);
            }}
            onDeleteBreak={(breakId) =>
              deleteBreakBlockForDate(
                breakListPopover.member,
                breakListPopover.ymd,
                breakId
              )
            }
            onClose={() => setBreakListPopover(null)}
          />
        );
      })()}

      {inlineTarget && (() => {
        const tMember =
          members.find((m) => m.instructor_id === inlineTarget.memberId) || me;
        const snap = tMember
          ? getBaselineDaySchedule(tMember, inlineTarget.workDate)
              .baselineSnapshot
          : {
              exists: Boolean(
                inlineTarget.hadExistingRecord ||
                  inlineTarget.wasScheduledWorkday
              ),
              policyName:
                inlineTarget.baselineSegments[0]?.policy_name || "근무",
              workMode:
                inlineTarget.baselineSegments[0]?.work_mode ||
                ("OFFICE" as HqWorkMode),
              inMinutes: inlineTarget.baselineSegments[0]?.in_minutes ?? 540,
              outMinutes: inlineTarget.baselineSegments[0]?.out_minutes ?? 1080,
              breakMinutes: inlineTarget.baselineBreaks.reduce(
                (acc, b) => acc + (b.end_minutes - b.start_minutes),
                0
              ),
              workedMinutes: inlineTarget.ruleDailyMinutes,
              overtimeMinutes: 0,
              segments: inlineTarget.baselineSegments,
              breaks: inlineTarget.baselineBreaks,
            };
        return (
          <FlexInlineWorkPopover
            key={`${inlineTarget.key}__${inlineTarget.targetKind}__${inlineTarget.itemId}__${inlineTarget.initialTimeFocus || ""}`}
            target={inlineTarget}
            currentDraft={draftEdits[inlineTarget.key]}
            workFormPolicies={workFormPolicies}
            baselineSnapshot={snap}
            onChangeDraft={handleUpsertDraft}
            onClearDraft={handleClearDraft}
            onSwitchTarget={(nextTarget) => setInlineTarget(nextTarget)}
            onConfirmClose={() => setInlineTarget(null)}
            onSwitchToLeaveModal={(workDate) => {
              setLeaveModalInitialDate(workDate);
              setLeaveRegisterKind({ type: "ANNUAL" });
              setLeaveModalOpen(true);
            }}
          />
        );
      })()}

      {hoveredBreakTip &&
        !inlineTarget &&
        !breakListPopover &&
        !rowAddMenu &&
        !activeDrag &&
        !realtimeEditModal && (
        <div
          style={{
            position: "fixed",
            left: `${Math.max(
              16,
              Math.min(
                (typeof window !== "undefined" ? window.innerWidth : 1200) -
                  188,
                hoveredBreakTip.rect.left
              )
            )}px`,
            top: `${
              hoveredBreakTip.rect.bottom + 72 >
              (typeof window !== "undefined" ? window.innerHeight : 900)
                ? Math.max(12, hoveredBreakTip.rect.top - 62)
                : hoveredBreakTip.rect.bottom + 7
            }px`,
          }}
          className="pointer-events-none z-[185] rounded-[8px] bg-[#2f343d] text-white px-3.5 py-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.28)] select-none"
        >
          <div className="flex items-center gap-1.5 text-[12px] font-bold leading-tight text-white">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3.5 h-3.5 text-white/95 shrink-0"
              aria-hidden="true"
            >
              <path d="M3 8h13v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z" />
              <path
                d="M16 9h1.5a2.5 2.5 0 0 1 0 5H16"
                fill="none"
                strokeWidth={2.2}
              />
            </svg>
            <span>휴게</span>
          </div>
          <div className="mt-1 space-y-0.5 text-[12px] font-medium leading-tight text-white/95 tabular-nums whitespace-nowrap">
            {hoveredBreakTip.windows.map((w, idx) => (
              <div key={idx}>
                {formatMinutesToKoreanAmPm(w.startMin)} -{" "}
                {formatMinutesToKoreanAmPm(w.endMin)}
              </div>
            ))}
          </div>
        </div>
      )}

      {hoveredRealtimeTip && !realtimeEditModal && (
        <FlexRealtimeHoverTooltip
          startMin={hoveredRealtimeTip.startMin}
          endMin={hoveredRealtimeTip.endMin}
          isActiveNow={hoveredRealtimeTip.isActiveNow}
          nowMin={nowMinutesOfDay}
          breaks={hoveredRealtimeTip.breaks}
          canEdit={hoveredRealtimeTip.canEdit}
          anchorPos={{ x: hoveredRealtimeTip.x, y: hoveredRealtimeTip.y }}
        />
      )}

      {realtimeEditModal && (
        <FlexRealtimeRecordEditModal
          isOpen={Boolean(realtimeEditModal)}
          memberId={realtimeEditModal.member.instructor_id}
          memberName={realtimeEditModal.member.name}
          department={realtimeEditModal.member.department || "미지정"}
          workDate={realtimeEditModal.workDate}
          existingLog={realtimeEditModal.existingLog}
          defaultStartMin={realtimeEditModal.defaultStartMin}
          defaultEndMin={realtimeEditModal.defaultEndMin}
          onClose={() => setRealtimeEditModal(null)}
          onSaved={handleSaveRealtimeModal}
        />
      )}

      <FlexDraftFloatingBar
        drafts={draftList}
        approvalCount={evaluatedApprovals.length}
        warningItems={draftWarnings}
        approvalPanelOpen={approvalPanelOpen}
        submitting={submitting}
        onToggleApprovalPanel={() => setApprovalPanelOpen((v) => !v)}
        onCancelAll={handleCancelAllDrafts}
        onSubmitAll={handleSubmitAllDrafts}
      />

      {recurringOpen && canEditSelfWork && (
        <RecurringScheduleModal
          isOpen={recurringOpen}
          me={me}
          defaultStartDate={activeQueryRange.start}
          defaultEndDate={addDaysYmd(activeQueryRange.start, 27)}
          onClose={() => setRecurringOpen(false)}
          onSaved={async () => {
            await Promise.all([loadAttendance(), refreshAttendanceState()]);
          }}
        />
      )}

      {uploadModalOpen && editableMembers.length > 0 && (
        <AttendanceUploadModal
          isOpen={uploadModalOpen}
          activeMembers={editableMembers}
          onClose={() => setUploadModalOpen(false)}
          onUploaded={async () => {
            await Promise.all([loadAttendance(), refreshAttendanceState()]);
          }}
        />
      )}

      <HqLeaveRegisterModal
        isOpen={leaveModalOpen}
        onClose={() => setLeaveModalOpen(false)}
        initialKind={leaveRegisterKind}
        initialDate={leaveModalInitialDate}
        allowSwitchLeaveKind={true}
        onSubmitted={async () => {
          setLeaveModalOpen(false);
          await loadAttendance();
        }}
      />

      {helpModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                📘 본부 근무 · 유연근무 운영 가이드
              </h3>
              <button
                type="button"
                onClick={() => setHelpModalOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2.5 text-xs text-slate-600 leading-relaxed">
              <p>
                • <strong>구성원별 맞춤 근무유형 연동:</strong>{" "}
                <code className="px-1 py-0.5 rounded bg-slate-100">
                  설정 &gt; 근무 &gt; 근무 유형
                </code>
                에 지정된 출근 시각(08:30 / 09:00 / 09:30 등)과 휴게시간이 타임라인에 자동 반영됩니다.
              </p>
              <p>
                • <strong>실시간 체크인 &amp; 캡스 연동:</strong> 웹 상단 체크인 바 또는{" "}
                <strong>ADT 캡스 출입단말기 CSV 업로드</strong>를 통해 출퇴근 기록을 통합 관리할 수 있습니다.
              </p>
              <p>
                • <strong>주 40h + 12h(52h) 모니터:</strong> 소정근로 40시간과 포괄임금 연장 한도(+12시간)를 실시간 게이지로 점검합니다.
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setHelpModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
