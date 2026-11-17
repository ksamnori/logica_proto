// src/app/hq/work-management/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import {
  AttendanceUploadModal,
  exportAttendanceCsv,
} from "@/components/hq/attendance/HqAttendanceModals";
import { hqFetch } from "@/lib/hq/clientApi";
import {
  DEFAULT_WORK_RULES,
  formatMinutesToKoreanAmPm,
  parseHmToMinutes,
} from "@/lib/hq/defaultWorkRules";
import type {
  HqAttendanceLockItem,
  HqAttendanceRecord,
  HqCompLeaveGrantItem,
  HqHolidayItem,
  HqHolidaySubstituteItem,
  HqWorkRuleItem,
} from "@/lib/hq/types";

type WorkMgmtTab = "DASHBOARD" | "COMP_LEAVE" | "HOLIDAY_SUB" | "LOCK";
type DashPeriodMode = "DAY" | "WEEK" | "MONTH" | "CYCLE";

const WEEKDAY_KO = ["일", "화", "수", "목", "금", "토"] as const;
const FULL_WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

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

function getLastCompletedWeekMonday(): string {
  const now = new Date();
  const dow = now.getDay();
  const diffToThisMon = dow === 0 ? -6 : 1 - dow;
  const thisMon = new Date(now);
  thisMon.setDate(now.getDate() + diffToThisMon);
  // 기본으로 직전 주간 또는 이번 주간 중 직전 완료 주간(스크린샷처럼 월~일)
  const prevMon = new Date(thisMon);
  prevMon.setDate(thisMon.getDate() - 7);
  return toYmd(prevMon);
}

function getThisWeekMonday(): string {
  const now = new Date();
  const dow = now.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  return toYmd(mon);
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

function formatKoreanDuration(mins: number): string {
  const safe = Math.max(0, Math.round(mins || 0));
  if (safe === 0) return "없음";
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  return `${m}분`;
}

function avatarBg(name: string): string {
  if (name === "김근식" || name === "백시연" || name === "심혜영") return "#2dd4bf";
  if (name === "김동현") return "#4ade80";
  if (
    name === "김문수" ||
    name === "원종준" ||
    name === "조원형" ||
    name === "최수연"
  )
    return "#eb7d66";
  if (name === "민세리") return "#e57373";
  if (name === "천종현") return "#9ba8cf";
  if (name === "한민서") return "#b57edc";
  return "#64748b";
}

function isoToKstMinutes(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

export default function HqWorkManagementPage() {
  const { members, companySettings, isHrManager, isHqAdmin } = useHqShell();

  const [tab, setTab] = useState<WorkMgmtTab>("DASHBOARD");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => new Date());

  // 공통 필터
  const [workRuleFilter, setWorkRuleFilter] = useState("ALL");
  const [deptFilter, setDeptFilter] = useState("ALL");

  // 탭 1: 근태 대시보드 기간
  const [dashPeriodMode, setDashPeriodMode] = useState<DashPeriodMode>("WEEK");
  const [dashStartDate, setDashStartDate] = useState(getLastCompletedWeekMonday);

  // 탭 2: 보상 휴가 부여 기간 (최근 1개월 기본)
  const [compStartDate, setCompStartDate] = useState(() =>
    addDaysYmd(toYmd(new Date()), -31)
  );
  const [compEndDate, setCompEndDate] = useState(() => toYmd(new Date()));
  const [otCategoryFilter, setOtCategoryFilter] = useState("ALL");
  const [grantHistoryOpen, setGrantHistoryOpen] = useState(false);

  // 탭 3: 휴일 대체 기간 (이번 주 7일 기본)
  const [holOnlyWorked, setHolOnlyWorked] = useState(false);
  const [holStartDate, setHolStartDate] = useState(() => toYmd(new Date()));
  const [holEndDate, setHolEndDate] = useState(() =>
    addDaysYmd(toYmd(new Date()), 6)
  );
  const [subModalTarget, setSubModalTarget] = useState<{
    memberId: string;
    memberName: string;
    department: string;
    holidayDate: string;
    holidayKind: string;
    workedMinutes: number;
    currentSubDate: string;
  } | null>(null);
  const [subDateInput, setSubDateInput] = useState("");
  const [subMemoInput, setSubMemoInput] = useState("");

  // 탭 4: 근태 마감 추가 모달
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [lockTitle, setLockTitle] = useState("");
  const [lockStart, setLockStart] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [lockEnd, setLockEnd] = useState(() => toYmd(new Date()));

  // 우측 상단 [근무 기록 관리 ▾] 드롭다운 & 업로드 모달
  const [recordMenuOpen, setRecordMenuOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // 대시보드 카드 드릴다운 모달
  const [drillModal, setDrillModal] = useState<{
    title: string;
    names: string[];
  } | null>(null);

  // 서버 데이터
  const [compGrants, setCompGrants] = useState<HqCompLeaveGrantItem[]>([]);
  const [holidaySubstitutes, setHolidaySubstitutes] = useState<
    HqHolidaySubstituteItem[]
  >([]);
  const [attendanceLocks, setAttendanceLocks] = useState<
    HqAttendanceLockItem[]
  >([]);
  const [attendanceRows, setAttendanceRows] = useState<HqAttendanceRecord[]>(
    []
  );
  const [approvalDocs, setApprovalDocs] = useState<any[]>([]);

  // 사용되지 않는 상수 경고 방지
  void WEEKDAY_KO;

  const canManage = Boolean(isHrManager || isHqAdmin);

  const activeMembers = useMemo(
    () =>
      members
        .filter((m) => m.work_status === "재직")
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [members]
  );

  const workRules: HqWorkRuleItem[] = useMemo(() => {
    const list = companySettings?.extra_settings?.work_rules;
    return Array.isArray(list) && list.length > 0 ? list : DEFAULT_WORK_RULES;
  }, [companySettings]);

  const departments = useMemo(() => {
    const s = new Set<string>();
    activeMembers.forEach((m) => {
      if (m.department) s.add(m.department);
    });
    return Array.from(s);
  }, [activeMembers]);

  const holidayMap = useMemo(() => {
    const map = new Map<string, HqHolidayItem>();
    const byYear = companySettings?.holidays_by_year || {};
    Object.values(byYear).forEach((arr) => {
      (arr || []).forEach((h) => {
        if (!h.start_date) return;
        const end = h.end_date || h.start_date;
        buildDateList(h.start_date, end).forEach((d) => map.set(d, h));
      });
    });
    return map;
  }, [companySettings]);

  const resolveMemberRule = useCallback(
    (memberName: string): HqWorkRuleItem => {
      return (
        workRules.find((r) =>
          (r.assigned_members || []).some(
            (am) => am.name === memberName && am.status === "ACTIVE"
          )
        ) ||
        workRules.find((r) => r.id === "wr-basic-9") ||
        DEFAULT_WORK_RULES[3] ||
        DEFAULT_WORK_RULES[0]
      );
    },
    [workRules]
  );

  // 대시보드 기간 종료일 계산
  const dashRange = useMemo(() => {
    if (dashPeriodMode === "DAY") {
      return { start: dashStartDate, end: dashStartDate };
    }
    if (dashPeriodMode === "MONTH") {
      const dt = parseYmd(dashStartDate);
      const y = dt.getFullYear();
      const m = dt.getMonth() + 1;
      const last = new Date(y, m, 0).getDate();
      return {
        start: `${y}-${String(m).padStart(2, "0")}-01`,
        end: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(
          2,
          "0"
        )}`,
      };
    }
    return { start: dashStartDate, end: addDaysYmd(dashStartDate, 6) };
  }, [dashPeriodMode, dashStartDate]);

  // 현재 탭에 필요한 전체 조회 범위 산출
  const queryWindow = useMemo(() => {
    if (tab === "COMP_LEAVE") {
      return { start: compStartDate, end: compEndDate };
    }
    if (tab === "HOLIDAY_SUB") {
      return { start: holStartDate, end: holEndDate };
    }
    return dashRange;
  }, [tab, compStartDate, compEndDate, holStartDate, holEndDate, dashRange]);

  const loadWorkMgmt = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          compGrants: HqCompLeaveGrantItem[];
          holidaySubstitutes: HqHolidaySubstituteItem[];
          attendanceLocks: HqAttendanceLockItem[];
          attendanceRows: HqAttendanceRecord[];
          approvalDocs: any[];
        };
      }>(
        `/api/hq/work-management?start_date=${queryWindow.start}&end_date=${queryWindow.end}`
      );
      setCompGrants(res.data?.compGrants || []);
      setHolidaySubstitutes(res.data?.holidaySubstitutes || []);
      setAttendanceLocks(res.data?.attendanceLocks || []);
      setAttendanceRows(res.data?.attendanceRows || []);
      setApprovalDocs(res.data?.approvalDocs || []);
      setLastRefreshedAt(new Date());
    } catch {
      setAttendanceRows([]);
    } finally {
      setLoading(false);
    }
  }, [queryWindow.start, queryWindow.end]);

  useEffect(() => {
    loadWorkMgmt();
  }, [loadWorkMgmt]);

  const filteredMembers = useMemo(() => {
    return activeMembers.filter((m) => {
      if (deptFilter !== "ALL" && m.department !== deptFilter) return false;
      if (workRuleFilter !== "ALL") {
        const r = resolveMemberRule(m.name);
        if (r.id !== workRuleFilter) return false;
      }
      return true;
    });
  }, [activeMembers, deptFilter, workRuleFilter, resolveMemberRule]);

  // ============================================================================
  // 탭 1: 근태 대시보드 집계 (스크린샷 010846 / 010920 1:1 대응)
  // ============================================================================
  const dashMetrics = useMemo(() => {
    const memberIdSet = new Set(filteredMembers.map((m) => m.instructor_id));
    const inPeriodRows = attendanceRows.filter(
      (r) =>
        memberIdSet.has(r.instructor_id) &&
        r.work_date >= dashRange.start &&
        r.work_date <= dashRange.end
    );

    const checkInMins: number[] = [];
    const checkOutMins: number[] = [];
    const workedMinsList: number[] = [];

    const overtimeNames = new Set<string>();
    const shortageNames = new Set<string>();
    const breakLackNames = new Set<string>();
    const lateNames = new Set<string>();
    const holidayWorkNames = new Set<string>();
    const leaveUsedNames = new Set<string>();
    const loggedMemberIds = new Set<string>();

    inPeriodRows.forEach((r) => {
      loggedMemberIds.add(r.instructor_id);
      const rule = resolveMemberRule(r.member_name);
      const ruleDailyMin =
        Number(rule.daily_work_hours || 8) * 60 +
        Number(rule.daily_work_minutes || 0);
      const ruleStartMin = parseHmToMinutes(rule.start_time) ?? 540;
      const grace = Number(rule.grace_minutes || 0);

      if (r.work_mode === "LEAVE" || r.status === "LEAVE" || r.status === "HALF_LEAVE") {
        leaveUsedNames.add(r.member_name);
        return;
      }

      const inM = isoToKstMinutes(r.check_in_at);
      const outM = isoToKstMinutes(r.check_out_at);
      if (inM !== null) {
        checkInMins.push(inM);
        if (inM > ruleStartMin + grace) {
          lateNames.add(r.member_name);
        }
      }
      if (outM !== null) checkOutMins.push(outM);
      if (r.worked_minutes > 0) {
        workedMinsList.push(r.worked_minutes);
        if (r.worked_minutes > ruleDailyMin) {
          overtimeNames.add(r.member_name);
        } else if (r.status === "DONE" && r.worked_minutes < ruleDailyMin) {
          shortageNames.add(r.member_name);
        }
      }

      // 8시간 이상 근무 시 법정 휴게 60분, 4시간 이상 시 30분 기준 점검
      if (
        (r.worked_minutes >= 480 && (r.break_minutes || 0) < 60) ||
        (r.worked_minutes >= 240 &&
          r.worked_minutes < 480 &&
          (r.break_minutes || 0) < 30)
      ) {
        breakLackNames.add(r.member_name);
      }

      const dow = parseYmd(r.work_date).getDay();
      if (dow === 0 || dow === 6 || holidayMap.has(r.work_date)) {
        holidayWorkNames.add(r.member_name);
      }
    });

    // 결재 문서 기준 휴가 사용자 & 승인 대기 / 증빙 미제출 집계
    const pendingApprovalNames = new Set<string>();
    const missingProofNames = new Set<string>();

    approvalDocs.forEach((doc) => {
      if (!memberIdSet.has(String(doc.drafter_id))) return;
      const eff = doc.effective_date || "";
      const end = doc.end_date || eff;
      const overlaps = eff <= dashRange.end && end >= dashRange.start;
      if (!overlaps) return;

      if (doc.doc_type === "LEAVE" && doc.status === "APPROVED") {
        leaveUsedNames.add(doc.drafter_name);
      }
      if (doc.status === "PENDING" || doc.status === "IN_PROGRESS") {
        pendingApprovalNames.add(doc.drafter_name);
      }
      if (
        doc.doc_type === "LEAVE" &&
        doc.status === "APPROVED" &&
        doc.leave_type &&
        !String(doc.leave_type).includes("연차") &&
        !String(doc.leave_type).includes("반차") &&
        !String(doc.leave_type).includes("보건") &&
        !String(doc.leave_type).includes("비상") &&
        !doc.receipt_url
      ) {
        missingProofNames.add(doc.drafter_name);
      }
    });

    // 과거 날짜인데 출근/휴가 기록이 모두 비어 있는 경우 누락 집계 (실제 기록이 1건 이상 시작된 주간에만 산출)
    const missingRecordNames: string[] = [];
    if (inPeriodRows.length > 0) {
      filteredMembers.forEach((m) => {
        if (
          !loggedMemberIds.has(m.instructor_id) &&
          !leaveUsedNames.has(m.name)
        ) {
          missingRecordNames.push(m.name);
        }
      });
    }

    const avgIn =
      checkInMins.length > 0
        ? Math.round(
            checkInMins.reduce((a, b) => a + b, 0) / checkInMins.length
          )
        : 540; // 기본 오전 9:00
    const avgOut =
      checkOutMins.length > 0
        ? Math.round(
            checkOutMins.reduce((a, b) => a + b, 0) / checkOutMins.length
          )
        : 1080; // 기본 오후 6:00
    const avgWork =
      workedMinsList.length > 0
        ? Math.round(
            workedMinsList.reduce((a, b) => a + b, 0) / workedMinsList.length
          )
        : 480;

    return {
      hasRecords: inPeriodRows.length > 0,
      avgInLabel: formatMinutesToKoreanAmPm(avgIn),
      avgOutLabel: formatMinutesToKoreanAmPm(avgOut),
      avgWorkLabel: formatKoreanDuration(avgWork),
      missingRecordNames,
      overtimeNames: Array.from(overtimeNames),
      shortageNames: Array.from(shortageNames),
      breakLackNames: Array.from(breakLackNames),
      lateNames: Array.from(lateNames),
      holidayWorkNames: Array.from(holidayWorkNames),
      leaveUsedNames: Array.from(leaveUsedNames),
      pendingApprovalNames: Array.from(pendingApprovalNames),
      missingProofNames: Array.from(missingProofNames),
    };
  }, [
    filteredMembers,
    attendanceRows,
    dashRange.start,
    dashRange.end,
    resolveMemberRule,
    holidayMap,
    approvalDocs,
  ]);

  // ============================================================================
  // 탭 2: 보상 휴가 부여 대상자 산출 (스크린샷 010902)
  // ============================================================================
  const compCandidates = useMemo(() => {
    const byMember = new Map<
      string,
      {
        memberId: string;
        memberName: string;
        department: string;
        jobSub: string;
        overtimeMin: number;
        category: string;
      }
    >();

    attendanceRows.forEach((r) => {
      if (r.work_date < compStartDate || r.work_date > compEndDate) return;
      const ot = Number(r.overtime_minutes || 0);
      if (ot <= 0) return;

      const memberObj = filteredMembers.find(
        (m) => m.instructor_id === r.instructor_id
      );
      if (!memberObj) return;

      const cur = byMember.get(r.instructor_id) || {
        memberId: r.instructor_id,
        memberName: memberObj.name,
        department: memberObj.department,
        jobSub: memberObj.job_description || memberObj.department,
        overtimeMin: 0,
        category: "법정근로내 연장",
      };
      cur.overtimeMin += ot;
      byMember.set(r.instructor_id, cur);
    });

    return Array.from(byMember.values())
      .map((item) => {
        const alreadyGrantedMin = compGrants
          .filter(
            (g) =>
              g.member_id === item.memberId &&
              g.period_start === compStartDate &&
              g.period_end === compEndDate
          )
          .reduce((acc, g) => acc + Number(g.granted_minutes || 0), 0);

        const availableMin = Math.max(0, item.overtimeMin - alreadyGrantedMin);
        return {
          ...item,
          deductedMin: 0,
          requiredMin: item.overtimeMin,
          alreadyGrantedMin,
          availableMin,
        };
      })
      .filter(
        (it) => otCategoryFilter === "ALL" || it.category === otCategoryFilter
      );
  }, [
    attendanceRows,
    compStartDate,
    compEndDate,
    filteredMembers,
    compGrants,
    otCategoryFilter,
  ]);

  // ============================================================================
  // 탭 3: 휴일 대체 행 산출 (스크린샷 010911 — 기간 내 주휴일·공휴일별 구성원 매핑)
  // ============================================================================
  const holidaySubRows = useMemo(() => {
    const dates = buildDateList(holStartDate, holEndDate);
    const targetHolidayDates = dates
      .map((ymd) => {
        const dow = parseYmd(ymd).getDay();
        const pub = holidayMap.get(ymd);
        if (pub) return { ymd, kind: pub.name || "공휴일" };
        if (dow === 0) return { ymd, kind: "주휴일" };
        return null;
      })
      .filter(Boolean) as { ymd: string; kind: string }[];

    const rows: {
      key: string;
      memberId: string;
      memberName: string;
      department: string;
      jobSub: string;
      holidayDate: string;
      holidayKind: string;
      workedMinutes: number;
      substituteDate: string;
    }[] = [];

    targetHolidayDates.forEach((hd) => {
      filteredMembers.forEach((m) => {
        const att = attendanceRows.find(
          (r) =>
            r.instructor_id === m.instructor_id &&
            r.work_date === hd.ymd &&
            r.work_mode !== "LEAVE"
        );
        const workedMin = Number(att?.worked_minutes || 0);
        if (holOnlyWorked && workedMin <= 0) return;

        const sub = holidaySubstitutes.find(
          (s) => s.member_id === m.instructor_id && s.holiday_date === hd.ymd
        );

        rows.push({
          key: `${m.instructor_id}__${hd.ymd}`,
          memberId: m.instructor_id,
          memberName: m.name,
          department: m.department,
          jobSub: m.job_description || (m.department !== "미지정" ? m.department : ""),
          holidayDate: hd.ymd,
          holidayKind: hd.kind,
          workedMinutes: workedMin,
          substituteDate: sub?.substitute_date || "",
        });
      });
    });

    return rows;
  }, [
    holStartDate,
    holEndDate,
    holidayMap,
    filteredMembers,
    attendanceRows,
    holOnlyWorked,
    holidaySubstitutes,
  ]);

  // 보상 휴가 부여 실행
  const handleGrantComp = async (item: (typeof compCandidates)[number]) => {
    if (item.availableMin <= 0) return;
    setSubmitting(true);
    try {
      await hqFetch("/api/hq/work-management", {
        method: "POST",
        body: {
          action: "GRANT_COMP_LEAVE",
          member_id: item.memberId,
          member_name: item.memberName,
          department: item.department,
          period_start: compStartDate,
          period_end: compEndDate,
          overtime_minutes: item.overtimeMin,
          granted_minutes: item.availableMin,
          overtime_category: item.category,
        },
      });
      await loadWorkMgmt();
      alert(
        `${item.memberName} 님에게 ${formatKoreanDuration(
          item.availableMin
        )} 보상 휴가가 부여되었습니다.`
      );
    } catch (err: any) {
      alert(err?.message || "보상 휴가 부여 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatchGrantComp = async () => {
    const targets = compCandidates.filter((c) => c.availableMin > 0);
    if (targets.length === 0) {
      alert("일괄 부여할 초과 근무 대상자가 없습니다.");
      return;
    }
    if (
      !confirm(
        `총 ${targets.length}명에게 미부여 보상 휴가를 일괄 부여하시겠습니까?`
      )
    )
      return;

    setSubmitting(true);
    try {
      await hqFetch("/api/hq/work-management", {
        method: "POST",
        body: {
          action: "BATCH_GRANT_COMP_LEAVE",
          items: targets.map((t) => ({
            member_id: t.memberId,
            member_name: t.memberName,
            department: t.department,
            period_start: compStartDate,
            period_end: compEndDate,
            overtime_minutes: t.overtimeMin,
            granted_minutes: t.availableMin,
            overtime_category: t.category,
          })),
        },
      });
      await loadWorkMgmt();
      alert(`${targets.length}명의 보상 휴가 일괄 부여가 완료되었습니다.`);
    } catch (err: any) {
      alert(err?.message || "일괄 부여 실패");
    } finally {
      setSubmitting(false);
    }
  };

  // 휴일 대체 저장
  const handleSaveHolidaySub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subModalTarget || !subDateInput) return;
    setSubmitting(true);
    try {
      await hqFetch("/api/hq/work-management", {
        method: "POST",
        body: {
          action: "SET_HOLIDAY_SUBSTITUTE",
          member_id: subModalTarget.memberId,
          member_name: subModalTarget.memberName,
          department: subModalTarget.department,
          holiday_date: subModalTarget.holidayDate,
          holiday_kind: subModalTarget.holidayKind,
          substitute_date: subDateInput,
          worked_minutes: subModalTarget.workedMinutes,
          memo: subMemoInput,
        },
      });
      setSubModalTarget(null);
      await loadWorkMgmt();
    } catch (err: any) {
      alert(err?.message || "휴일 대체 지정 실패");
    } finally {
      setSubmitting(false);
    }
  };

  // 근태 마감 저장/해제
  const handleAddLock = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await hqFetch("/api/hq/work-management", {
        method: "POST",
        body: {
          action: "ADD_LOCK",
          title: lockTitle.trim() || `${lockStart} ~ ${lockEnd} 근태 마감`,
          start_date: lockStart,
          end_date: lockEnd,
          target_scope: "ALL",
        },
      });
      setLockModalOpen(false);
      setLockTitle("");
      await loadWorkMgmt();
    } catch (err: any) {
      alert(err?.message || "근태 마감 추가 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteLock = async (id: string) => {
    if (!confirm("해당 근태 마감 설정을 해제하시겠습니까?")) return;
    try {
      await hqFetch("/api/hq/work-management", {
        method: "POST",
        body: { action: "DELETE_LOCK", id },
      });
      await loadWorkMgmt();
    } catch (err: any) {
      alert(err?.message || "마감 해제 실패");
    }
  };

  const moveDashRange = (dir: -1 | 1) => {
    if (dashPeriodMode === "DAY") {
      setDashStartDate((d) => addDaysYmd(d, dir));
    } else if (dashPeriodMode === "MONTH") {
      const dt = parseYmd(dashStartDate);
      dt.setMonth(dt.getMonth() + dir);
      setDashStartDate(toYmd(dt));
    } else {
      setDashStartDate((d) => addDaysYmd(d, dir * 7));
    }
  };

  const formatYmdWithDow = (ymd: string) => {
    const dt = parseYmd(ymd);
    return `${dt.getFullYear()}. ${dt.getMonth() + 1}. ${dt.getDate()} (${
      FULL_WEEKDAY_KO[dt.getDay()]
    })`;
  };

  return (
    <div className="w-full min-h-full shrink-0 bg-white flex flex-col">
      {/* 상단 헤더 & 우측 컨텍스트 버튼 */}
      <div className="px-9 pt-7 border-b border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            근무 관리
          </h1>

          {tab === "DASHBOARD" && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setRecordMenuOpen((v) => !v)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-800 flex items-center gap-1.5 shadow-2xs"
              >
                <span>📄</span>
                <span>근무 기록 관리</span>
                <span className="text-[10px] text-slate-400">▾</span>
              </button>

              {recordMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-64 rounded-xl bg-white border border-slate-200 shadow-xl py-2 z-40 text-xs">
                  <div className="px-4 py-1 text-[11px] font-bold text-slate-400">
                    다운로드
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRecordMenuOpen(false);
                      exportAttendanceCsv(
                        "ALL",
                        attendanceRows,
                        `${dashRange.start}_${dashRange.end}`
                      );
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-slate-50"
                  >
                    <div className="font-bold text-slate-800">
                      구성원 근무 기록
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      출 · 퇴근 시각, 근무 시간을 확인할 수 있어요.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRecordMenuOpen(false);
                      exportAttendanceCsv(
                        "OVERTIME",
                        attendanceRows,
                        `${dashRange.start}_${dashRange.end}`
                      );
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-slate-50"
                  >
                    <div className="font-bold text-slate-800">
                      구성원 초과 근무 기록
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      보상이 필요한 초과 근무를 항목 별로 확인할 수 있어요.
                    </div>
                  </button>

                  <div className="my-1.5 border-t border-slate-100" />
                  <div className="px-4 py-1 text-[11px] font-bold text-slate-400">
                    업로드
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRecordMenuOpen(false);
                      setUploadModalOpen(true);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-slate-50 font-bold text-slate-800"
                  >
                    근무 기록 업로드
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === "COMP_LEAVE" && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGrantHistoryOpen(true)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5"
              >
                <span>🕒</span>
                <span>부여 내역</span>
              </button>
              <button
                type="button"
                disabled={!canManage || submitting}
                onClick={handleBatchGrantComp}
                className="px-4 py-2 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-extrabold shadow-xs disabled:opacity-40 flex items-center gap-1"
              >
                <span>✓</span>
                <span>일괄 부여하기</span>
              </button>
            </div>
          )}

          {tab === "LOCK" && (
            <button
              type="button"
              onClick={() => setLockModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-extrabold shadow-xs"
            >
              + 마감일 추가
            </button>
          )}
        </div>

        {/* 4개 서브탭 */}
        <div className="mt-5 flex items-center gap-6">
          {(
            [
              { key: "DASHBOARD", label: "근태 대시보드" },
              { key: "COMP_LEAVE", label: "보상 휴가 부여" },
              { key: "HOLIDAY_SUB", label: "휴일 대체" },
              { key: "LOCK", label: "근태 마감" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`pb-3 text-[13px] font-bold border-b-2 transition-colors ${
                tab === t.key
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-400 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* =====================================================================
          탭 1: [근태 대시보드]
         ===================================================================== */}
      {tab === "DASHBOARD" && (
        <div className="flex-1 flex flex-col">
          {/* 필터 바 */}
          <div className="px-9 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
                {(
                  [
                    { key: "DAY", label: "일" },
                    { key: "WEEK", label: "주" },
                    { key: "MONTH", label: "월" },
                    { key: "CYCLE", label: "주기" },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      setDashPeriodMode(p.key);
                      if (p.key === "WEEK")
                        setDashStartDate(getThisWeekMonday());
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-bold ${
                      dashPeriodMode === p.key
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => moveDashRange(-1)}
                  className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-800 font-bold"
                >
                  ‹
                </button>
                <span className="px-3 py-1.5 text-xs font-bold text-slate-800 tabular-nums">
                  {dashPeriodMode === "DAY"
                    ? dashRange.start.replace(/-/g, ". ")
                    : `${dashRange.start.replace(/-/g, ". ")} - ${dashRange.end
                        .slice(5)
                        .replace("-", ". ")}`}
                </span>
                <button
                  type="button"
                  onClick={() => moveDashRange(1)}
                  className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-800 font-bold"
                >
                  ›
                </button>
              </div>

              <select
                value={workRuleFilter}
                onChange={(e) => setWorkRuleFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 bg-white"
              >
                <option value="ALL">🧳 근무 유형</option>
                {workRules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>

              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 bg-white"
              >
                <option value="ALL">品 조직</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={loadWorkMgmt}
              className="text-xs font-semibold text-slate-400 hover:text-slate-700 flex items-center gap-1.5"
            >
              <span>↻</span>
              <span>
                {lastRefreshedAt.toLocaleDateString("ko-KR", {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                  weekday: "short",
                })}{" "}
                {lastRefreshedAt.toLocaleTimeString("ko-KR", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </button>
          </div>

          <div className="px-9 py-7 max-w-[1440px] w-full space-y-8">
            {/* 상단 3대 평균 지표 박스 */}
            <div className="rounded-2xl border border-slate-200 bg-white grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100">
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <span className="text-amber-400">☀️</span>
                    <span>평균 출근</span>
                  </div>
                  <span className="text-slate-300 text-xs">ⓘ</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  구성원 근무 기록의 평균 시작 시각
                </p>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-xl font-extrabold text-slate-900">
                    {dashMetrics.avgInLabel}
                  </span>
                  {!dashMetrics.hasRecords && (
                    <span className="text-[11px] font-semibold text-slate-400">
                      (기준 시각)
                    </span>
                  )}
                </div>
              </div>

              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <span className="text-orange-400">🌇</span>
                    <span>평균 퇴근</span>
                  </div>
                  <span className="text-slate-300 text-xs">ⓘ</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  구성원 근무 기록의 평균 종료 시각
                </p>
                <div className="mt-4 text-xl font-extrabold text-slate-900">
                  {dashMetrics.avgOutLabel}
                </div>
              </div>

              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <span className="text-emerald-500">⏱️</span>
                    <span>일 평균 근무</span>
                  </div>
                  <span className="text-slate-300 text-xs">ⓘ</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  구성원 근무 기록의 평균 시간
                </p>
                <div className="mt-4 text-xl font-extrabold text-slate-900">
                  {dashMetrics.avgWorkLabel}
                </div>
              </div>
            </div>

            {/* 섹션 1: 근태 현황 7개 카드 */}
            <section>
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 mb-3">
                <span>🧳</span>
                <span>근태 현황</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
                {[
                  {
                    title: "근무 기록 누락",
                    desc: "근무 혹은 휴가 기록이 없는 구성원 수",
                    names: dashMetrics.missingRecordNames,
                  },
                  {
                    title: "근무 시간 초과",
                    desc: "소정 근무 시간을 초과한 구성원 수",
                    names: dashMetrics.overtimeNames,
                  },
                  {
                    title: "근무 시간 미달",
                    desc: "소정 근무 시간을 미달한 구성원 수",
                    names: dashMetrics.shortageNames,
                  },
                  {
                    title: "휴게 시간 부족",
                    desc: "법정 휴게 기준을 미달한 구성원 수",
                    names: dashMetrics.breakLackNames,
                  },
                  {
                    title: "지각",
                    desc: "출근 시간을 넘겨 근무를 시작한 구성원 수",
                    names: dashMetrics.lateNames,
                  },
                  {
                    title: "휴일 근무",
                    desc: "휴일에 근무한 구성원 수",
                    names: dashMetrics.holidayWorkNames,
                  },
                  {
                    title: "휴가 사용",
                    desc: "휴가 사용 기록이 있는 구성원 수",
                    names: dashMetrics.leaveUsedNames,
                  },
                ].map((c) => {
                  const cnt = c.names.length;
                  return (
                    <button
                      key={c.title}
                      type="button"
                      onClick={() =>
                        cnt > 0 &&
                        setDrillModal({ title: c.title, names: c.names })
                      }
                      className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 text-left transition-all flex flex-col justify-between min-h-[118px]"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold text-slate-800">
                            {c.title}
                          </span>
                          <span className="text-[11px] text-slate-300">ⓘ</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {c.desc}
                        </p>
                      </div>

                      <div className="mt-4 flex items-baseline gap-1.5">
                        <span
                          className={`text-lg font-extrabold ${
                            cnt > 0 ? "text-slate-900" : "text-slate-300"
                          }`}
                        >
                          {cnt} 명
                        </span>
                        <span
                          className={`text-[11px] font-semibold ${
                            cnt > 0 ? "text-emerald-600" : "text-slate-300"
                          }`}
                        >
                          {cnt > 0 ? "명단 확인 ›" : "변동없음"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 섹션 2: 승인 · 증빙 */}
            <section>
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 mb-3">
                <span>📄</span>
                <span>승인 · 증빙</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3.5">
                {[
                  {
                    title: "승인 대기 중",
                    desc: "미승인 근태 기록이 있는 구성원 수",
                    names: dashMetrics.pendingApprovalNames,
                  },
                  {
                    title: "증명 자료 미제출",
                    desc: "휴가 증명 자료를 미제출한 구성원 수",
                    names: dashMetrics.missingProofNames,
                  },
                ].map((c) => {
                  const cnt = c.names.length;
                  return (
                    <button
                      key={c.title}
                      type="button"
                      onClick={() =>
                        cnt > 0 &&
                        setDrillModal({ title: c.title, names: c.names })
                      }
                      className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 text-left transition-all flex flex-col justify-between min-h-[112px]"
                    >
                      <div>
                        <div className="text-xs font-extrabold text-slate-800">
                          {c.title}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {c.desc}
                        </p>
                      </div>
                      <div
                        className={`mt-4 text-lg font-extrabold ${
                          cnt > 0 ? "text-amber-700" : "text-slate-300"
                        }`}
                      >
                        {cnt} 명
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* =====================================================================
          탭 2: [보상 휴가 부여] (스크린샷 010902)
         ===================================================================== */}
      {tab === "COMP_LEAVE" && (
        <div className="flex-1 flex flex-col">
          <div className="px-9 py-3.5 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white">
              <span className="text-slate-400">📅 근무 기간</span>
              <input
                type="date"
                value={compStartDate}
                onChange={(e) => setCompStartDate(e.target.value)}
                className="font-bold text-slate-800 outline-none"
              />
              <span>~</span>
              <input
                type="date"
                value={compEndDate}
                onChange={(e) => setCompEndDate(e.target.value)}
                className="font-bold text-slate-800 outline-none"
              />
            </div>

            <select
              value={workRuleFilter}
              onChange={(e) => setWorkRuleFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-600 bg-white"
            >
              <option value="ALL">🧳 근무 유형</option>
              {workRules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-600 bg-white"
            >
              <option value="ALL">品 조직</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              value={otCategoryFilter}
              onChange={(e) => setOtCategoryFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-600 bg-white"
            >
              <option value="ALL">🔥 초과 근무 항목</option>
              <option value="법정근로내 연장">법정근로내 연장</option>
              <option value="연장근로">연장근로</option>
              <option value="휴일근로">휴일근로</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 pl-9 pr-4">부여 대상자</th>
                  <th className="py-3 px-4">초과 근무 시간</th>
                  <th className="py-3 px-4">공제 시간 ⓘ</th>
                  <th className="py-3 px-4">초과 근무 항목</th>
                  <th className="py-3 px-4">부여 필요 시간 ⓘ</th>
                  <th className="py-3 px-4">기부여 시간</th>
                  <th className="py-3 px-4">부여 가능 시간 ⓘ</th>
                  <th className="py-3 pl-4 pr-9">부여</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-20 text-center text-slate-400 font-semibold"
                    >
                      초과 근무 내역을 불러오는 중입니다...
                    </td>
                  </tr>
                ) : compCandidates.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-20 text-center text-slate-500 font-bold"
                    >
                      조회 기간에 발생한 초과 근무 대상자가 없습니다.
                    </td>
                  </tr>
                ) : (
                  compCandidates.map((item) => (
                    <tr key={item.memberId} className="hover:bg-slate-50/70">
                      <td className="py-3.5 pl-9 pr-4">
                        <div className="flex items-center gap-3">
                          <span
                            style={{ backgroundColor: avatarBg(item.memberName) }}
                            className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold inline-flex items-center justify-center"
                          >
                            {item.memberName.slice(-2)}
                          </span>
                          <div>
                            <div className="font-bold text-slate-900">
                              {item.memberName}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {item.jobSub}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-800">
                        {formatKoreanDuration(item.overtimeMin)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">없음</td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-bold">
                          {item.category}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-800">
                        {formatKoreanDuration(item.requiredMin)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {item.alreadyGrantedMin > 0
                          ? formatKoreanDuration(item.alreadyGrantedMin)
                          : "없음"}
                      </td>
                      <td className="py-3.5 px-4 font-extrabold text-slate-900">
                        {formatKoreanDuration(item.availableMin)}
                      </td>
                      <td className="py-3.5 pl-4 pr-9">
                        <button
                          type="button"
                          disabled={!canManage || item.availableMin <= 0}
                          onClick={() => handleGrantComp(item)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-700 disabled:opacity-40"
                        >
                          {item.availableMin <= 0 ? "부여완료" : "부여하기"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          탭 3: [휴일 대체] (스크린샷 010911)
         ===================================================================== */}
      {tab === "HOLIDAY_SUB" && (
        <div className="flex-1 flex flex-col">
          <div className="px-9 py-3.5 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
              <button
                type="button"
                onClick={() => setHolOnlyWorked(false)}
                className={`px-3 py-1 rounded-md font-bold ${
                  !holOnlyWorked
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-500"
                }`}
              >
                전체
              </button>
              <button
                type="button"
                onClick={() => setHolOnlyWorked(true)}
                className={`px-3 py-1 rounded-md font-bold ${
                  holOnlyWorked
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-500"
                }`}
              >
                휴일 근무 있음
              </button>
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white">
              <span className="text-slate-400">📅 조회 기간</span>
              <input
                type="date"
                value={holStartDate}
                onChange={(e) => setHolStartDate(e.target.value)}
                className="font-bold text-slate-800 outline-none"
              />
              <span>~</span>
              <input
                type="date"
                value={holEndDate}
                onChange={(e) => setHolEndDate(e.target.value)}
                className="font-bold text-slate-800 outline-none"
              />
            </div>

            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-600 bg-white"
            >
              <option value="ALL">品 조직</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 pl-9 pr-4">이름</th>
                  <th className="py-3 px-4">휴일</th>
                  <th className="py-3 px-4">휴일 근무 시간</th>
                  <th className="py-3 px-4">대체일</th>
                  <th className="py-3 pl-4 pr-9 text-right">휴일 대체</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {holidaySubRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-20 text-center text-slate-500 font-bold"
                    >
                      조회 기간에 해당하는 휴일 대체 대상이 없습니다.
                    </td>
                  </tr>
                ) : (
                  holidaySubRows.map((row) => (
                    <tr key={row.key} className="hover:bg-slate-50/70">
                      <td className="py-3.5 pl-9 pr-4">
                        <div className="flex items-center gap-3">
                          <span
                            style={{ backgroundColor: avatarBg(row.memberName) }}
                            className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold inline-flex items-center justify-center"
                          >
                            {row.memberName.slice(-2)}
                          </span>
                          <div>
                            <div className="font-bold text-slate-900">
                              {row.memberName}
                            </div>
                            {row.jobSub && (
                              <div className="text-[11px] text-slate-400">
                                {row.jobSub}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-bold text-rose-600">
                          {formatYmdWithDow(row.holidayDate)}
                        </span>
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                          {row.holidayKind}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 font-semibold">
                        {row.workedMinutes > 0
                          ? formatKoreanDuration(row.workedMinutes)
                          : "없음"}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-600">
                        {row.substituteDate ? (
                          <span className="text-blue-700 font-bold">
                            {formatYmdWithDow(row.substituteDate)}
                          </span>
                        ) : (
                          <span className="text-slate-400">미정</span>
                        )}
                      </td>
                      <td className="py-3.5 pl-4 pr-9 text-right">
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => {
                            setSubModalTarget({
                              memberId: row.memberId,
                              memberName: row.memberName,
                              department: row.department,
                              holidayDate: row.holidayDate,
                              holidayKind: row.holidayKind,
                              workedMinutes: row.workedMinutes,
                              currentSubDate: row.substituteDate,
                            });
                            setSubDateInput(
                              row.substituteDate ||
                                addDaysYmd(row.holidayDate, 1)
                            );
                            setSubMemoInput("");
                          }}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 font-bold text-slate-700 disabled:opacity-40"
                        >
                          {row.substituteDate ? "대체 변경" : "대체하기"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          탭 4: [근태 마감] (스크린샷 010920)
         ===================================================================== */}
      {tab === "LOCK" && (
        <div className="flex-1 flex flex-col">
          {attendanceLocks.length === 0 ? (
            <div className="flex-1 min-h-[440px] flex flex-col items-center justify-center text-center">
              <div className="w-7 h-7 rounded-full border-2 border-slate-300 text-slate-400 flex items-center justify-center text-xs font-extrabold mb-3">
                i
              </div>
              <h3 className="text-sm font-extrabold text-slate-700">
                근태 기록을 보호하세요.
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                기간 단위로 근태 기록이 변경되지
                <br />
                않도록 관리할 수 있어요.
              </p>
              <button
                type="button"
                onClick={() => setLockModalOpen(true)}
                className="mt-4 px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700"
              >
                + 마감일 추가
              </button>
            </div>
          ) : (
            <div className="p-9">
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-500">
                      <th className="py-3 px-5">마감 명칭</th>
                      <th className="py-3 px-4">보호 기간</th>
                      <th className="py-3 px-4">적용 범위</th>
                      <th className="py-3 px-4">마감 처리자</th>
                      <th className="py-3 px-5 text-right">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {attendanceLocks.map((lk) => (
                      <tr key={lk.id} className="hover:bg-slate-50/70">
                        <td className="py-3.5 px-5 font-bold text-slate-900">
                          🔒 {lk.title}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-700 tabular-nums">
                          {lk.start_date} ~ {lk.end_date}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          {lk.target_scope === "ALL"
                            ? "전사 구성원"
                            : (lk.target_departments || []).join(", ")}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500">
                          {lk.locked_by} ({lk.locked_at.slice(0, 10)})
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => handleDeleteLock(lk.id)}
                              className="px-3 py-1 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold"
                            >
                              마감 해제
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          공통 모달들 (업로드 / 드릴다운 / 부여내역 / 휴일대체 / 근태마감)
         ===================================================================== */}
      <AttendanceUploadModal
        isOpen={uploadModalOpen}
        activeMembers={activeMembers}
        onClose={() => setUploadModalOpen(false)}
        onUploaded={loadWorkMgmt}
      />

      {drillModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                {drillModal.title} 대상 구성원 ({drillModal.names.length}명)
              </h3>
              <button
                type="button"
                onClick={() => setDrillModal(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {drillModal.names.map((nm) => (
                <span
                  key={nm}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-800 text-xs font-bold"
                >
                  {nm}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {grantHistoryOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                🕒 보상 휴가 부여 내역
              </h3>
              <button
                type="button"
                onClick={() => setGrantHistoryOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto divide-y divide-slate-100 text-xs">
              {compGrants.length === 0 ? (
                <div className="py-12 text-center text-slate-400 font-semibold">
                  부여된 보상 휴가 내역이 없습니다.
                </div>
              ) : (
                compGrants.map((g) => (
                  <div
                    key={g.id}
                    className="py-3 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-bold text-slate-900">
                        {g.member_name} ({g.department})
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        귀속 기간: {g.period_start} ~ {g.period_end} · 처리자{" "}
                        {g.actor_name}
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-extrabold">
                      +{formatKoreanDuration(g.granted_minutes)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {subModalTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                휴일 대체일 지정 ({subModalTarget.memberName})
              </h3>
              <button
                type="button"
                onClick={() => setSubModalTarget(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveHolidaySub} className="p-6 space-y-4">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                원래 휴일:{" "}
                <strong className="text-rose-600">
                  {subModalTarget.holidayDate} ({subModalTarget.holidayKind})
                </strong>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  대체하여 쉴 평일 선택 *
                </label>
                <input
                  type="date"
                  required
                  value={subDateInput}
                  onChange={(e) => setSubDateInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  사유 메모 (선택)
                </label>
                <input
                  value={subMemoInput}
                  onChange={(e) => setSubMemoInput(e.target.value)}
                  placeholder="예: 주말 인쇄 감리에 따른 평일 대체 휴무"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSubModalTarget(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-extrabold"
                >
                  대체일 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {lockModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                🔒 근태 마감 기간 추가
              </h3>
              <button
                type="button"
                onClick={() => setLockModalOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleAddLock} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  마감 명칭
                </label>
                <input
                  value={lockTitle}
                  onChange={(e) => setLockTitle(e.target.value)}
                  placeholder="예: 2026년 10월 급여정산용 근태 마감"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    보호 시작일
                  </label>
                  <input
                    type="date"
                    required
                    value={lockStart}
                    onChange={(e) => setLockStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    보호 종료일
                  </label>
                  <input
                    type="date"
                    required
                    value={lockEnd}
                    onChange={(e) => setLockEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setLockModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-[#16a34a] text-white text-xs font-extrabold"
                >
                  마감 적용하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
