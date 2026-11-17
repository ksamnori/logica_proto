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
import ApprovalCreateModal from "@/components/hq/approvals/ApprovalCreateModal";
import {
  AttendanceEntryModal,
  AttendanceUploadModal,
  exportAttendanceCsv,
  RecurringScheduleModal,
  type EntryModalInitialState,
} from "@/components/hq/attendance/HqAttendanceModals";
import { ATTENDANCE_MODES, WEEKLY_MAX_MINUTES } from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import { DEFAULT_WORK_FORM_POLICIES } from "@/lib/hq/defaultApprovalPolicies";
import { DEFAULT_CUSTOM_LEAVES } from "@/lib/hq/defaultLeaveSettings";
import {
  calcBreakMinutes,
  DEFAULT_WORK_RULES,
  formatMinutesToKoreanAmPm,
  parseHmToMinutes,
} from "@/lib/hq/defaultWorkRules";
import type {
  HqAttendanceRecord,
  HqCustomLeaveItem,
  HqHolidayItem,
  HqMember,
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

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

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
    isHrManager,
    isHqAdmin,
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
  const [studioExpanded, setStudioExpanded] = useState(true);

  // 구성원 근무 뷰 상태
  const [teamPeriodMode, setTeamPeriodMode] = useState<TeamPeriodMode>("DAY");
  const [teamAnchorDate, setTeamAnchorDate] = useState(() => toYmd(new Date()));
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [deptMenuOpen, setDeptMenuOpen] = useState(false);
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
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 상단 실시간 스튜디오 입력 상태
  const [selectedMode, setSelectedMode] = useState<HqWorkMode>("OFFICE");
  const [locationNote, setLocationNote] = useState(
    ATTENDANCE_MODES.OFFICE.defaultLocation
  );
  const [memo, setMemo] = useState("");

  // 모달 상태
  const [entryModalState, setEntryModalState] =
    useState<EntryModalInitialState | null>(null);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [leaveModalPolicyId, setLeaveModalPolicyId] = useState<string | null>(
    null
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
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const canManageTeam = Boolean(
    isHrManager || isHqAdmin || (me && me.rank_level >= 3)
  );

  const activeMembers = useMemo(() => {
    const filtered = members.filter((m) => m.work_status === "재직");
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [members]);

  const departments = useMemo(() => {
    const s = new Set<string>();
    activeMembers.forEach((m) => {
      if (m.department) s.add(m.department);
    });
    return Array.from(s);
  }, [activeMembers]);

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
      const mon = getMondayOfYmd(myAnchorDate);
      return { start: mon, end: addDaysYmd(mon, 6) };
    }
    if (teamPeriodMode === "DAY") {
      return { start: teamAnchorDate, end: teamAnchorDate };
    }
    if (teamPeriodMode === "MONTH") {
      return getMonthRangeOfYmd(teamAnchorDate);
    }
    const mon = getMondayOfYmd(teamAnchorDate);
    return { start: mon, end: addDaysYmd(mon, 6) };
  }, [mainTab, myPeriodMode, myAnchorDate, teamPeriodMode, teamAnchorDate]);

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
        };
      }>(
        `/api/hq/attendance?start_date=${activeQueryRange.start}&end_date=${activeQueryRange.end}`
      );
      if (res.data?.todayStr) setTodayStr(res.data.todayStr);
      setMyToday(res.data?.myToday || null);
      setMyWeeklyMinutes(res.data?.myWeeklyMinutes || 0);
      setRecords(res.data?.records || []);
      setLeaveApprovals(res.data?.leaveApprovals || []);

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
    return () => window.removeEventListener("hq:attendance-updated", onSync);
  }, [loadAttendance]);

  // (instructor_id + work_date) 빠른 조회 맵
  const recordByMemberDate = useMemo(() => {
    const m = new Map<string, HqAttendanceRecord>();
    records.forEach((r) => m.set(`${r.instructor_id}__${r.work_date}`, r));
    return m;
  }, [records]);

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

  // 오늘 내 실시간 경과 근무분 계산
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

  // 내 근무 주기(주간) 총 시간 계산 (계획 + 실기록 통합)
  const myPeriodStats = useMemo(() => {
    const fullDates = buildDateList(
      activeQueryRange.start,
      activeQueryRange.end
    );
    let totalEffectiveMin = 0;
    let totalLoggedMin = 0;
    let totalOvertimeMin = 0;

    fullDates.forEach((ymd) => {
      const rec = me ? recordByMemberDate.get(`${me.instructor_id}__${ymd}`) : undefined;
      const dowKo = WEEKDAY_KO[parseYmdLocal(ymd).getDay()];
      const isHoliday = holidayMap.has(ymd);
      const isWorkDay = myRule.work_days.includes(dowKo) && !isHoliday;
      const ruleDailyMin =
        Number(myRule.daily_work_hours || 8) * 60 +
        Number(myRule.daily_work_minutes || 0);

      if (rec) {
        let m = Number(rec.worked_minutes || 0);
        if (rec.status === "WORKING" && rec.check_in_at) {
          const el = Math.max(
            0,
            Math.round(
              (nowClock.getTime() - new Date(rec.check_in_at).getTime()) / 60000
            )
          );
          m = Math.max(0, el - (el >= 300 ? 60 : 0));
        } else if (rec.status === "LEAVE" && rec.work_mode === "LEAVE") {
          m = ruleDailyMin; // 유급휴가 소정근로 인정
        }
        totalLoggedMin += m;
        totalEffectiveMin += m;
        totalOvertimeMin += Number(rec.overtime_minutes || Math.max(0, m - 480));
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
    recordByMemberDate,
    holidayMap,
    myRule,
    nowClock,
  ]);

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

  // 단건 모달 열기 헬퍼
  const openEntryForDate = (
    targetMember: HqMember | null,
    ymd: string,
    opts?: {
      presetMode?: HqWorkMode;
      policyLabel?: string;
      focusBreak?: boolean;
    }
  ) => {
    const member = targetMember || me;
    if (!member) return;
    if (member.instructor_id !== me?.instructor_id && !canManageTeam) {
      return;
    }

    const existing = recordByMemberDate.get(`${member.instructor_id}__${ymd}`);
    const rule = resolveMemberWorkRule(
      member.name,
      member.profile_extra?.work_schedule_type
    );
    const ruleStartMin = parseHmToMinutes(rule.start_time) ?? 540;
    const ruleWorkMin =
      Number(rule.daily_work_hours || 8) * 60 +
      Number(rule.daily_work_minutes || 0);
    const ruleBreakMin = calcBreakMinutes(rule);
    const ruleEndMin = ruleStartMin + ruleWorkMin + ruleBreakMin;
    const defaultOutHm = `${String(Math.floor(ruleEndMin / 60) % 24).padStart(
      2,
      "0"
    )}:${String(ruleEndMin % 60).padStart(2, "0")}`;

    const mode =
      opts?.presetMode || existing?.work_mode || ("OFFICE" as HqWorkMode);

    setEntryModalState({
      attendanceId: existing?.attendance_id,
      targetMemberId: member.instructor_id,
      workDate: ymd,
      workMode: mode,
      statusOverride: existing?.status === "HALF_LEAVE" ? "HALF_LEAVE" : "",
      policyLabel: opts?.policyLabel,
      inTime: existing?.check_in_at
        ? formatClock24(existing.check_in_at)
        : rule.start_time || "09:00",
      outTime: existing?.check_out_at
        ? formatClock24(existing.check_out_at)
        : defaultOutHm,
      breakMinutes:
        existing?.break_minutes !== undefined
          ? Number(existing.break_minutes)
          : ruleBreakMin || 60,
      locationNote:
        opts?.policyLabel === "출장"
          ? "출장지"
          : existing?.location_note ||
            ATTENDANCE_MODES[mode]?.defaultLocation ||
            "본사 편집·연구실",
      memo: existing?.memo || "",
      focusBreak: opts?.focusBreak,
    });
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

  // 구성원 근무 요약 카운트 (휴가 / 초과 근무 / 맞춤 근무 / 실시간 근무중)
  const teamSummaryCounts = useMemo(() => {
    let leaveCount = 0;
    let overtimeCount = 0;
    let customWorkCount = 0;
    let workingNowCount = 0;

    const checkDate =
      teamPeriodMode === "DAY" ? teamAnchorDate : todayStr;

    activeMembers.forEach((m) => {
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
        // 원격/외근/시차 또는 기본 9시 외 시차 근무유형 적용자
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
    activeMembers,
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

    return activeMembers.filter((m) => {
      if (deptFilter !== "ALL" && m.department !== deptFilter) return false;
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
    activeMembers,
    deptFilter,
    teamKeyword,
    teamStatusFilter,
    teamPeriodMode,
    teamAnchorDate,
    todayStr,
    recordByMemberDate,
    leaveApprovalByMemberDate,
  ]);

  // 24시간 타임라인 행 블록 렌더링 헬퍼 (내 근무 & 구성원 일간 공통)
  const render24hBarForMemberDate = (member: HqMember, ymd: string) => {
    const rec = recordByMemberDate.get(`${member.instructor_id}__${ymd}`);
    const lvDoc = leaveApprovalByMemberDate.get(`${member.instructor_id}__${ymd}`);
    const rule = resolveMemberWorkRule(
      member.name,
      member.profile_extra?.work_schedule_type
    );
    const dowKo = WEEKDAY_KO[parseYmdLocal(ymd).getDay()];
    const holiday = holidayMap.get(ymd);
    const isScheduledWorkday = rule.work_days.includes(dowKo) && !holiday;

    const ruleStartMin = parseHmToMinutes(rule.start_time) ?? 540;
    const ruleWorkMin =
      Number(rule.daily_work_hours || 8) * 60 +
      Number(rule.daily_work_minutes || 0);
    const b1Start = parseHmToMinutes(rule.break_start_1);
    const b1End = parseHmToMinutes(rule.break_end_1);
    const ruleBreakMin = calcBreakMinutes(rule);
    const ruleEndMin = ruleStartMin + ruleWorkMin + ruleBreakMin;

    // 1) 휴가 상태(실제 기록 또는 결재 문서)인 경우
    if (
      rec?.work_mode === "LEAVE" ||
      rec?.status === "LEAVE" ||
      rec?.status === "HALF_LEAVE" ||
      lvDoc
    ) {
      const isHalf =
        rec?.status === "HALF_LEAVE" ||
        (lvDoc?.leave_type || "").includes("반차");
      const barStart = ruleStartMin;
      const barEnd = isHalf ? ruleStartMin + 240 : ruleEndMin;
      const leftPct = Math.max(0, (barStart / 1440) * 100);
      const widthPct = Math.min(100 - leftPct, ((barEnd - barStart) / 1440) * 100);
      const label =
        rec?.location_note ||
        lvDoc?.leave_type ||
        (isHalf ? "반차" : "연차 휴가");
      const isPending = lvDoc && lvDoc.status !== "APPROVED" && !rec;

      return (
        <div
          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 6)}%` }}
          className="absolute top-2.5 bottom-4 z-10 group"
        >
          <div
            className={`h-7 rounded-md border px-2.5 flex items-center justify-between text-[11px] font-extrabold shadow-2xs transition-all ${
              isPending
                ? "bg-amber-50/90 border-amber-300 border-dashed text-amber-800"
                : "bg-emerald-50/95 border-emerald-400 text-emerald-800"
            }`}
          >
            <span className="truncate flex items-center gap-1">
              <span>🏖️</span>
              <span>{label}</span>
              {isPending && (
                <span className="text-[10px] opacity-80">(승인대기)</span>
              )}
            </span>
            <span className="text-[10px] font-bold opacity-80">
              {isHalf ? "4h" : "8h"}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-emerald-700 font-semibold mt-0.5 px-0.5">
            <span>{formatMinutesToKoreanAmPm(barStart)}</span>
            <span>{formatMinutesToKoreanAmPm(barEnd)}</span>
          </div>
        </div>
      );
    }

    // 2) 실제 출퇴근/근무 기록이 존재하는 경우 (우리 색깔: 선명한 브랜드 블록 + 실시간 WORKING 표시)
    if (rec && rec.check_in_at) {
      const actualInMin = isoToMinutesOfDay(rec.check_in_at, ymd) ?? ruleStartMin;
      const rawOutMin = rec.check_out_at
        ? isoToMinutesOfDay(rec.check_out_at, ymd)
        : ymd === todayStr
        ? Math.max(actualInMin + 30, nowMinutesOfDay)
        : ruleEndMin;
      const actualOutMin = Math.max(actualInMin + 25, rawOutMin ?? ruleEndMin);

      const leftPct = Math.max(0, Math.min(96, (actualInMin / 1440) * 100));
      const widthPct = Math.max(
        3,
        Math.min(100 - leftPct, ((actualOutMin - actualInMin) / 1440) * 100)
      );

      const palette =
        rec.work_mode === "REMOTE"
          ? {
              bar: "bg-teal-500/15 border-teal-500 text-teal-900",
              icon: "🏠",
              tag: "원격",
            }
          : rec.work_mode === "OUTSIDE"
          ? {
              bar: "bg-amber-500/15 border-amber-500 text-amber-950",
              icon: "🚗",
              tag: rec.location_note === "출장지" ? "출장" : "외근",
            }
          : rec.work_mode.startsWith("FLEX_")
          ? {
              bar: "bg-indigo-500/15 border-indigo-500 text-indigo-950",
              icon: "🌅",
              tag: "시차",
            }
          : {
              bar: "bg-blue-600/14 border-blue-600 text-slate-900",
              icon: "💼",
              tag: "근무",
            };

      const hasBreakInside =
        b1Start !== null &&
        b1End !== null &&
        actualInMin < b1Start &&
        actualOutMin > b1End &&
        (rec.break_minutes ?? 60) > 0;

      const breakLeftInBar =
        hasBreakInside && b1Start !== null
          ? ((b1Start - actualInMin) / (actualOutMin - actualInMin)) * 100
          : 0;
      const breakWidthInBar =
        hasBreakInside && b1Start !== null && b1End !== null
          ? ((b1End - b1Start) / (actualOutMin - actualInMin)) * 100
          : 0;

      return (
        <>
          {/* 배경에 계획 스케줄 점선 가이드 */}
          {showPlannedGuide && isScheduledWorkday && (
            <div
              style={{
                left: `${(ruleStartMin / 1440) * 100}%`,
                width: `${((ruleEndMin - ruleStartMin) / 1440) * 100}%`,
              }}
              className="absolute top-3 h-6 rounded-md border border-dashed border-slate-300/80 pointer-events-none"
            />
          )}

          <div
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            className="absolute top-2.5 bottom-4 z-10"
          >
            <div
              className={`relative h-6.5 rounded-[5px] border-[1.5px] px-2 flex items-center justify-between overflow-hidden shadow-2xs transition-all hover:brightness-95 ${palette.bar}`}
            >
              <div className="flex items-center gap-1.5 min-w-0 z-10">
                <span className="text-[11px]">{palette.icon}</span>
                <span className="text-[11px] font-extrabold truncate">
                  {palette.tag}
                  {rec.memo
                    ? ` · ${rec.memo}`
                    : rec.location_note
                    ? ` · ${rec.location_note}`
                    : ""}
                </span>
              </div>

              {rec.status === "WORKING" && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[9px] font-extrabold shrink-0 z-10">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  근무중
                </span>
              )}

              {hasBreakInside && (
                <div
                  style={{
                    left: `${breakLeftInBar}%`,
                    width: `${breakWidthInBar}%`,
                  }}
                  className="absolute top-0.5 bottom-0.5 rounded-[3px] bg-white/95 border border-slate-300 flex items-center px-1 text-[10px] text-slate-500 pointer-events-none"
                >
                  ☕
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-500 font-semibold mt-0.5 px-0.5 whitespace-nowrap">
              <span>
                {formatMinutesToKoreanAmPm(actualInMin)}
                {(rec.break_minutes || 0) > 0 && (
                  <span className="text-slate-400 ml-1">휴게 1건</span>
                )}
              </span>
              <span>
                {rec.status === "WORKING"
                  ? "현재 근무중"
                  : formatMinutesToKoreanAmPm(actualOutMin)}
              </span>
            </div>
          </div>
        </>
      );
    }

    // 3) 아직 출퇴근 기록이 없는 평일(소정근로일) -> Flex 스타일 민트 윤곽선 예정 근무 바 표시
    if (isScheduledWorkday && showPlannedGuide) {
      const leftPct = (ruleStartMin / 1440) * 100;
      const widthPct = ((ruleEndMin - ruleStartMin) / 1440) * 100;
      const hasBreak =
        b1Start !== null &&
        b1End !== null &&
        b1Start >= ruleStartMin &&
        b1End <= ruleEndMin;
      const breakLeftPct =
        hasBreak && b1Start !== null
          ? ((b1Start - ruleStartMin) / (ruleEndMin - ruleStartMin)) * 100
          : 44;
      const breakWidthPct =
        hasBreak && b1Start !== null && b1End !== null
          ? ((b1End - b1Start) / (ruleEndMin - ruleStartMin)) * 100
          : 11;

      return (
        <div
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          className="absolute top-2.5 bottom-4 z-10"
        >
          <div className="relative h-6 rounded-[4px] border border-[#2ec4b6] bg-white/85 hover:bg-teal-50/40 transition-colors flex items-center px-2">
            <span className="text-[11px] text-[#2ec4b6]">🧳</span>
            {hasBreak && (
              <div
                style={{
                  left: `${breakLeftPct}%`,
                  width: `${breakWidthPct}%`,
                }}
                className="absolute top-0.5 bottom-0.5 rounded-[3px] border border-slate-200 bg-slate-50/90 flex items-center px-1.5 text-[10px] text-slate-500"
              >
                ☕
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] font-medium text-slate-500 mt-0.5 px-0.5 whitespace-nowrap">
            <span>
              {formatMinutesToKoreanAmPm(ruleStartMin)}{" "}
              {hasBreak && <span className="text-slate-400 ml-0.5">휴게 1건</span>}
            </span>
            <span>{formatMinutesToKoreanAmPm(ruleEndMin)}</span>
          </div>
        </div>
      );
    }

    // 4) 공휴일 배지 표시
    if (holiday) {
      return (
        <div className="absolute left-4 top-3.5 text-[11px] font-bold text-rose-500 flex items-center gap-1">
          <span>{holiday.icon || "🎌"}</span>
          <span>{holiday.name}</span>
        </div>
      );
    }

    return null;
  };

  // 월간 달력 셀 생성 (내 근무 - 월 뷰)
  const myMonthCalendarCells = useMemo(() => {
    const { start, end } = getMonthRangeOfYmd(myAnchorDate);
    const firstDow = parseYmdLocal(start).getDay(); // 0(일)~6(토)
    const days = buildDateList(start, end);
    const cells: (string | null)[] = [];
    for (let i = 0; i < firstDow; i += 1) cells.push(null);
    days.forEach((d) => cells.push(d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
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

            {/* [+ 추가하기 ▾] 계단식 드롭다운 (근무 › / 휴가 › / 반복 일정) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
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
                  {addSubMenu === "WORK" && (
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
                              openEntryForDate(me, todayStr, {
                                presetMode,
                                policyLabel: pol.name,
                              });
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
                          openEntryForDate(me, todayStr, {
                            policyLabel: "휴게",
                            focusBreak: true,
                          });
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
                          setLeaveModalPolicyId("lv-annual");
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
                            setLeaveModalPolicyId(lv.policy_id || "lv-annual");
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
                      onMouseEnter={() => setAddSubMenu(null)}
                      onClick={() => {
                        setAddMenuOpen(false);
                        setRecurringOpen(true);
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700 flex items-center gap-2"
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
              ) : (
                <button
                  type="button"
                  onClick={() => openEntryForDate(me, todayStr)}
                  className="px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold"
                >
                  ✏️ 오늘 기록 수정
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          탭 1: [내 근무] 본문 영역
         ===================================================================== */}
      {mainTab === "MY" && (
        <div className="flex-1 flex flex-col">
          {/* 날짜 네비게이터 + 우측 40:00 / +12:00 게이지 바 */}
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
                  {myPeriodMode === "MONTH"
                    ? `${parseYmdLocal(myAnchorDate).getFullYear()}. ${
                        parseYmdLocal(myAnchorDate).getMonth() + 1
                      }`
                    : formatRangeHeader(
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

              <button
                type="button"
                onClick={() => setMyAnchorDate(todayStr)}
                className="px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-xs font-bold text-slate-600"
              >
                오늘
              </button>
            </div>

            {/* 우측: 40:00 + +12:00 프로그레스 바 (스크린샷 100% + 실기록 배지) */}
            {myPeriodMode !== "MONTH" && (
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="flex items-baseline gap-2 justify-end">
                    <span className="text-[22px] font-bold text-slate-700 tabular-nums tracking-tight">
                      {formatHmColon(myPeriodStats.totalEffectiveMin)}
                    </span>
                    {myPeriodStats.totalLoggedMin > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-extrabold">
                        실체크 {formatHmColon(myPeriodStats.totalLoggedMin)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="w-52">
                  <div className="flex items-center justify-end text-[10px] font-bold text-slate-400 mb-1">
                    <span className="flex items-center gap-0.5">
                      <span>⚑</span>
                      <span>+12:00</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
                    {/* 소정 40시간 구간 (76.9%) */}
                    <div className="w-[77%] h-full bg-slate-100 border-r border-white relative overflow-hidden">
                      <div
                        style={{ width: `${regularBarPct}%` }}
                        className="h-full bg-[#4ecdc4] transition-all duration-300"
                      />
                    </div>
                    {/* 연장 12시간 구간 (23.1%) */}
                    <div className="w-[23%] h-full bg-slate-100 relative overflow-hidden">
                      <div
                        style={{ width: `${overtimeBarPct}%` }}
                        className="h-full bg-amber-500 transition-all duration-300"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {myPeriodMode === "MONTH" ? (
            /* 내 근무 > [월] 캘린더 뷰 */
            <div className="p-7 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
                  <div className="text-[11px] font-bold text-slate-500">
                    월간 계획·인정 총시간
                  </div>
                  <div className="text-lg font-black text-slate-900 mt-0.5 tabular-nums">
                    {formatHmColon(myPeriodStats.totalEffectiveMin)}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/40">
                  <div className="text-[11px] font-bold text-blue-700">
                    실제 체크인 누적시간
                  </div>
                  <div className="text-lg font-black text-blue-900 mt-0.5 tabular-nums">
                    {formatHmColon(myPeriodStats.totalLoggedMin)}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/40">
                  <div className="text-[11px] font-bold text-amber-800">
                    초과 근무 누적시간
                  </div>
                  <div className="text-lg font-black text-amber-900 mt-0.5 tabular-nums">
                    {formatHmColon(myPeriodStats.totalOvertimeMin)}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40">
                  <div className="text-[11px] font-bold text-emerald-700">
                    내 잔여 연차
                  </div>
                  <div className="text-lg font-black text-emerald-900 mt-0.5">
                    {me?.annual_leave_remain ?? 15}일
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 overflow-hidden">
                <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 text-center text-xs font-bold text-slate-500">
                  {WEEKDAY_KO.map((w, idx) => (
                    <div
                      key={w}
                      className={`py-2.5 ${
                        idx === 0
                          ? "text-rose-500"
                          : idx === 6
                          ? "text-blue-500"
                          : ""
                      }`}
                    >
                      {w}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 divide-x divide-y divide-slate-200">
                  {myMonthCalendarCells.map((ymd, idx) => {
                    if (!ymd) {
                      return (
                        <div
                          key={`empty-${idx}`}
                          className="min-h-[98px] bg-slate-50/40"
                        />
                      );
                    }
                    const d = parseYmdLocal(ymd);
                    const dow = d.getDay();
                    const rec = me
                      ? recordByMemberDate.get(`${me.instructor_id}__${ymd}`)
                      : undefined;
                    const holiday = holidayMap.get(ymd);
                    const isToday = ymd === todayStr;

                    return (
                      <div
                        key={ymd}
                        onClick={() => openEntryForDate(me, ymd)}
                        className="min-h-[98px] p-2.5 bg-white hover:bg-slate-50 cursor-pointer transition-colors flex flex-col justify-between"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-xs font-extrabold ${
                              isToday
                                ? "px-1.5 py-0.5 rounded bg-[#ea580c] text-white"
                                : dow === 0 || holiday
                                ? "text-rose-500"
                                : dow === 6
                                ? "text-blue-500"
                                : "text-slate-700"
                            }`}
                          >
                            {d.getDate()}
                          </span>
                          {holiday && (
                            <span className="text-[10px] font-bold text-rose-500 truncate max-w-[80px]">
                              {holiday.name}
                            </span>
                          )}
                        </div>

                        {rec ? (
                          <div className="mt-1.5 space-y-1">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${
                                ATTENDANCE_MODES[rec.work_mode]?.badgeClass ||
                                "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {ATTENDANCE_MODES[rec.work_mode]?.shortLabel ||
                                "근무"}
                            </span>
                            {rec.check_in_at && (
                              <div className="text-[10px] font-semibold text-slate-600 tabular-nums">
                                {formatClock24(rec.check_in_at)} ~{" "}
                                {rec.status === "WORKING"
                                  ? "근무중"
                                  : formatClock24(rec.check_out_at)}
                              </div>
                            )}
                          </div>
                        ) : (
                          myRule.work_days.includes(WEEKDAY_KO[dow]) &&
                          !holiday && (
                            <div className="text-[10px] text-slate-400 font-medium">
                              예정 {myRule.start_time} (8h)
                            </div>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* 내 근무 > [주기 / 주] 24시간 타임라인 그리드 */
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
                    const rec = me
                      ? recordByMemberDate.get(`${me.instructor_id}__${ymd}`)
                      : undefined;
                    const isWorkDay =
                      myRule.work_days.includes(dowKo) && !holiday;
                    const plannedMin = isWorkDay
                      ? Number(myRule.daily_work_hours || 8) * 60 +
                        Number(myRule.daily_work_minutes || 0)
                      : 0;
                    const displayMin = rec
                      ? rec.status === "WORKING" && ymd === todayStr
                        ? liveTodayElapsedMinutes
                        : rec.work_mode === "LEAVE" && rec.status === "LEAVE"
                        ? plannedMin || 480
                        : Number(rec.worked_minutes || 0)
                      : plannedMin;

                    return (
                      <div
                        key={ymd}
                        onClick={() => me && openEntryForDate(me, ymd)}
                        className="flex h-[68px] hover:bg-slate-50/70 cursor-pointer transition-colors group"
                      >
                        {/* 좌측 일자 + 시간 배지 + [+] 버튼 */}
                        <div className="w-52 shrink-0 px-7 flex items-center justify-between border-r border-slate-100 bg-white group-hover:bg-slate-50/70">
                          <div className="flex items-center gap-2.5">
                            <div className="flex items-center gap-1.5 w-12">
                              <span
                                className={`text-xs font-extrabold tabular-nums ${
                                  isToday
                                    ? "w-6 h-6 rounded-md bg-[#ea580c] text-white inline-flex items-center justify-center"
                                    : dow === 0 || holiday
                                    ? "text-rose-500"
                                    : dow === 6
                                    ? "text-blue-500"
                                    : "text-slate-700"
                                }`}
                              >
                                {dt.getDate()}
                              </span>
                              <span
                                className={`text-xs font-bold ${
                                  dow === 0 || holiday
                                    ? "text-rose-500"
                                    : dow === 6
                                    ? "text-blue-500"
                                    : "text-slate-600"
                                }`}
                              >
                                {dowKo}
                              </span>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded bg-slate-100 text-[11px] font-bold tabular-nums ${
                                displayMin > 0
                                  ? "text-slate-700"
                                  : "text-slate-300"
                              }`}
                            >
                              {formatHmColon(displayMin)}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (me) openEntryForDate(me, ymd);
                            }}
                            className="w-6 h-6 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-200/60 flex items-center justify-center text-sm font-semibold"
                            title="근무/휴게 추가·수정"
                          >
                            +
                          </button>
                        </div>

                        {/* 우측 24시간 그리드 셀 + 블록 */}
                        <div className="flex-1 relative">
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
      )}

      {/* =====================================================================
          탭 2: [구성원 근무] 본문 영역 (스크린샷 100% + 멀티데이 매트릭스)
         ===================================================================== */}
      {mainTab === "TEAM" && (
        <div className="flex-1 flex flex-col">
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

          {/* 휴가 / 초과 근무 / 맞춤 근무 / 실시간 근무중 요약 필터 바 */}
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
                      const rule = resolveMemberWorkRule(
                        m.name,
                        m.profile_extra?.work_schedule_type
                      );
                      const rec = recordByMemberDate.get(
                        `${m.instructor_id}__${teamAnchorDate}`
                      );
                      const dowKo =
                        WEEKDAY_KO[parseYmdLocal(teamAnchorDate).getDay()];
                      const holiday = holidayMap.get(teamAnchorDate);
                      const isWorkDay =
                        rule.work_days.includes(dowKo) && !holiday;
                      const plannedMin = isWorkDay
                        ? Number(rule.daily_work_hours || 8) * 60 +
                          Number(rule.daily_work_minutes || 0)
                        : 0;
                      const displayMin = rec
                        ? rec.status === "WORKING" &&
                          teamAnchorDate === todayStr &&
                          rec.check_in_at
                          ? Math.max(
                              0,
                              Math.round(
                                (nowClock.getTime() -
                                  new Date(rec.check_in_at).getTime()) /
                                  60000
                              ) - 60
                            )
                          : Number(rec.worked_minutes || plannedMin)
                        : plannedMin;

                      const shortTwo = m.name.slice(-2);
                      const subRole =
                        m.job_description ||
                        (m.department !== "미지정" ? m.department : "");

                      return (
                        <div
                          key={m.instructor_id}
                          onClick={() => openEntryForDate(m, teamAnchorDate)}
                          className={`flex h-[68px] transition-colors ${
                            canManageTeam || m.instructor_id === me?.instructor_id
                              ? "hover:bg-slate-50/70 cursor-pointer"
                              : ""
                          }`}
                        >
                          {/* 좌측: 2글자 컬러 아바타 + 성명/직무 + 8:00 배지 */}
                          <div className="w-60 shrink-0 px-7 flex items-center justify-between border-r border-slate-100 bg-white">
                            <div className="flex items-center gap-3 min-w-0">
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

                            <span className="px-2 py-0.5 rounded bg-slate-100 text-[11px] font-bold text-slate-700 tabular-nums shrink-0">
                              {formatHmColon(displayMin)}
                            </span>
                          </div>

                          {/* 우측: 24시간 그리드 + 예정/실제 근무 바 */}
                          <div className="flex-1 relative">
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
          ) : (
            /* 구성원 근무 > [주 / 주기 / 월] 멀티데이 요약 매트릭스 */
            <div className="p-7 overflow-x-auto">
              <table className="w-full text-left border-collapse border border-slate-200 rounded-2xl overflow-hidden">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500">
                    <th className="py-3 px-4 w-52">구성원</th>
                    <th className="py-3 px-4 w-32">적용 근무유형</th>
                    {teamPeriodMode !== "MONTH" &&
                      buildDateList(
                        activeQueryRange.start,
                        activeQueryRange.end
                      ).map((ymd) => {
                        const dt = parseYmdLocal(ymd);
                        return (
                          <th
                            key={ymd}
                            className="py-3 px-2.5 text-center whitespace-nowrap"
                          >
                            {dt.getMonth() + 1}/{dt.getDate()} (
                            {WEEKDAY_KO[dt.getDay()]})
                          </th>
                        );
                      })}
                    <th className="py-3 px-4 text-right">실근무 합계</th>
                    <th className="py-3 px-4 text-right">초과근무</th>
                    <th className="py-3 px-4 w-40">52h 준수율</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredTeamMembers.map((m) => {
                    const rule = resolveMemberWorkRule(
                      m.name,
                      m.profile_extra?.work_schedule_type
                    );
                    const rangeDays = buildDateList(
                      activeQueryRange.start,
                      activeQueryRange.end
                    );
                    let sumWorked = 0;
                    let sumOvertime = 0;

                    rangeDays.forEach((ymd) => {
                      const rec = recordByMemberDate.get(
                        `${m.instructor_id}__${ymd}`
                      );
                      if (rec) {
                        sumWorked += Number(rec.worked_minutes || 0);
                        sumOvertime += Number(rec.overtime_minutes || 0);
                      }
                    });

                    const limitMin =
                      teamPeriodMode === "MONTH"
                        ? WEEKLY_MAX_MINUTES * 4
                        : WEEKLY_MAX_MINUTES;
                    const pct = Math.min(
                      100,
                      Math.round((sumWorked / limitMin) * 100)
                    );

                    return (
                      <tr
                        key={m.instructor_id}
                        className="hover:bg-slate-50/70"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <span
                              style={{
                                backgroundColor: avatarColorForName(m.name),
                              }}
                              className="w-7 h-7 rounded-full text-white text-[10px] font-extrabold inline-flex items-center justify-center shrink-0"
                            >
                              {m.name.slice(-2)}
                            </span>
                            <div>
                              <div className="font-bold text-slate-900">
                                {m.name}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {m.department}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[11px] font-semibold text-slate-600">
                          {rule.name} ({rule.start_time})
                        </td>

                        {teamPeriodMode !== "MONTH" &&
                          rangeDays.map((ymd) => {
                            const rec = recordByMemberDate.get(
                              `${m.instructor_id}__${ymd}`
                            );
                            return (
                              <td
                                key={ymd}
                                onClick={() => openEntryForDate(m, ymd)}
                                className="py-3 px-2 text-center cursor-pointer hover:bg-blue-50/40"
                              >
                                {rec ? (
                                  <div>
                                    <span className="font-extrabold text-slate-800 tabular-nums">
                                      {formatHmColon(rec.worked_minutes)}
                                    </span>
                                    <div className="text-[10px] text-slate-400">
                                      {ATTENDANCE_MODES[rec.work_mode]
                                        ?.shortLabel || ""}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>
                            );
                          })}

                        <td className="py-3 px-4 text-right font-extrabold text-slate-900 tabular-nums">
                          {formatHmColon(sumWorked)}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-amber-700 tabular-nums">
                          {sumOvertime > 0
                            ? `+${formatHmColon(sumOvertime)}`
                            : "0:00"}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                style={{ width: `${pct}%` }}
                                className={`h-full ${
                                  pct >= 95
                                    ? "bg-rose-500"
                                    : pct >= 80
                                    ? "bg-amber-500"
                                    : "bg-brand"
                                }`}
                              />
                            </div>
                            <span className="text-[11px] font-bold text-slate-500 w-9 text-right tabular-nums">
                              {pct}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          모달 연결 영역
         ===================================================================== */}
      {entryModalState && (
        <AttendanceEntryModal
          isOpen={Boolean(entryModalState)}
          initial={entryModalState}
          me={me}
          activeMembers={activeMembers}
          canManageTeam={canManageTeam}
          workFormPolicies={workFormPolicies}
          onClose={() => setEntryModalState(null)}
          onSaved={async () => {
            await Promise.all([loadAttendance(), refreshAttendanceState()]);
          }}
        />
      )}

      {recurringOpen && (
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

      {uploadModalOpen && (
        <AttendanceUploadModal
          isOpen={uploadModalOpen}
          activeMembers={activeMembers}
          onClose={() => setUploadModalOpen(false)}
          onUploaded={async () => {
            await Promise.all([loadAttendance(), refreshAttendanceState()]);
          }}
        />
      )}

      <ApprovalCreateModal
        isOpen={leaveModalOpen}
        me={me}
        members={members}
        defaultDocType="LEAVE"
        defaultPolicyId={leaveModalPolicyId}
        onClose={() => setLeaveModalOpen(false)}
        onCreated={() => {
          setLeaveModalOpen(false);
          loadAttendance();
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
