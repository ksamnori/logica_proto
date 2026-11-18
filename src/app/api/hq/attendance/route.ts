// src/app/api/hq/attendance/route.ts
import { NextRequest, NextResponse } from "next/server";
import { appendHqAuditLog } from "@/lib/hq/auditLogServer";
import { readCompanySettingsServer } from "@/lib/hq/companySettingsServer";
import { ATTENDANCE_MODES, inferRankFromPosition } from "@/lib/hq/constants";
import { DEFAULT_WORK_RULES } from "@/lib/hq/defaultWorkRules";
import {
  type MemberPermissionSubject,
  resolveMemberPermissions,
} from "@/lib/hq/hqPermissionEngine";
import { notifySlackIfEnabled } from "@/lib/hq/integrationServer";
import { readWorkMgmtStateServer } from "@/lib/hq/leavesLedgerServer";
import {
  apiFail,
  getSupabaseAdmin,
  type HqCallerInfo,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type {
  HqAttendanceStatus,
  HqCompanySettings,
  HqRankCode,
  HqWorkMode,
  HqWorkRuleItem,
} from "@/lib/hq/types";

export const runtime = "nodejs";

const WEEKDAY_KO_UTC = ["일", "월", "화", "수", "목", "금", "토"] as const;

function parseHmMinutes(hm?: string | null, fallback = 540): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || "").trim());
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToHmStr(totalMin: number): string {
  const clamped = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function resolveMemberWorkRuleServer(
  memberName: string,
  scheduleType: string | undefined,
  rules: HqWorkRuleItem[]
): HqWorkRuleItem {
  const byAssigned = rules.find((r) =>
    (r.assigned_members || []).some(
      (m) => m.status === "ACTIVE" && m.name === memberName
    )
  );
  if (byAssigned) return byAssigned;
  if (scheduleType) {
    const byName = rules.find((r) => r.name === scheduleType);
    if (byName) return byName;
  }
  return rules.find((r) => r.is_default) || rules[0] || DEFAULT_WORK_RULES[0];
}

function calcRuleBreakMinutes(
  rule: HqWorkRuleItem,
  dailyWorkMinutes: number
): number {
  let sum = 0;
  if (rule.break_start_1 && rule.break_end_1) {
    const s1 = parseHmMinutes(rule.break_start_1, -1);
    const e1 = parseHmMinutes(rule.break_end_1, -1);
    if (s1 >= 0 && e1 > s1) sum += e1 - s1;
  }
  if (rule.break_start_2 && rule.break_end_2) {
    const s2 = parseHmMinutes(rule.break_start_2, -1);
    const e2 = parseHmMinutes(rule.break_end_2, -1);
    if (s2 >= 0 && e2 > s2) sum += e2 - s2;
  }
  if (sum > 0) return sum;
  if (dailyWorkMinutes >= 480) return 60;
  if (dailyWorkMinutes >= 240) return 30;
  return 0;
}

function getKstNowParts() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayStr = kst.toISOString().slice(0, 10);
  const currentMonth = todayStr.slice(0, 7);
  const nowKstMinutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  // 이번 주 월요일 ~ 일요일 (KST 기준)
  const day = kst.getUTCDay(); // 0(일) ~ 6(토)
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(kst);
  mon.setUTCDate(kst.getUTCDate() + diffToMon);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);

  return {
    nowIso: now.toISOString(),
    todayStr,
    currentMonth,
    nowKstMinutes,
    weekStartStr: mon.toISOString().slice(0, 10),
    weekEndStr: sun.toISOString().slice(0, 10),
  };
}

function addOneDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1));
  return dt.toISOString().slice(0, 10);
}

function buildCheckInOutIso(
  workDate: string,
  inTime: string,
  outTime: string
): { checkInIso: string | null; checkOutIso: string | null } {
  const cleanIn = inTime.trim();
  const cleanOut = outTime.trim();
  const checkInIso = cleanIn ? `${workDate}T${cleanIn}:00+09:00` : null;
  if (!cleanOut) {
    return { checkInIso, checkOutIso: null };
  }
  // 자정 넘김 야근(예: 09:00 ~ 익일 01:30) 지원
  const outDate = cleanIn && cleanOut < cleanIn ? addOneDayYmd(workDate) : workDate;
  const checkOutIso = `${outDate}T${cleanOut}:00+09:00`;
  return { checkInIso, checkOutIso };
}

function calcWorkedMinutes(
  checkInIso: string | null,
  checkOutIso: string | null,
  customBreakMinutes?: number
): { breakMinutes: number; workedMinutes: number; overtimeMinutes: number } {
  if (!checkInIso || !checkOutIso) {
    return {
      breakMinutes: typeof customBreakMinutes === "number" ? customBreakMinutes : 60,
      workedMinutes: 0,
      overtimeMinutes: 0,
    };
  }
  const inMs = new Date(checkInIso).getTime();
  const outMs = new Date(checkOutIso).getTime();
  if (Number.isNaN(inMs) || Number.isNaN(outMs) || outMs <= inMs) {
    return { breakMinutes: 0, workedMinutes: 0, overtimeMinutes: 0 };
  }
  const grossMin = Math.round((outMs - inMs) / 60000);
  const autoBreak =
    typeof customBreakMinutes === "number" && !Number.isNaN(customBreakMinutes)
      ? Math.max(0, customBreakMinutes)
      : grossMin >= 540
      ? 60
      : grossMin >= 270
      ? 30
      : 0;
  const workedMinutes = Math.max(0, grossMin - autoBreak);
  const overtimeMinutes = Math.max(0, workedMinutes - 480);
  return { breakMinutes: autoBreak, workedMinutes, overtimeMinutes };
}

async function buildWorkPermissionGuard(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  caller: HqCallerInfo,
  preloaded?: {
    settings?: HqCompanySettings | null;
    instRows?: any[];
    profRows?: any[];
  }
) {
  let settings = preloaded?.settings ?? null;
  let instRows = preloaded?.instRows;
  let profRows = preloaded?.profRows;

  if (!settings || !instRows || !profRows) {
    const [sRes, iRes, pRes] = await Promise.all([
      settings
        ? Promise.resolve({ settings })
        : readCompanySettingsServer(supabaseAdmin).catch(() => null),
      instRows
        ? Promise.resolve({ data: instRows })
        : supabaseAdmin
            .from("instructor")
            .select(
              "instructor_id, name, position, chat_position, department, tenant_id, status"
            ),
      profRows
        ? Promise.resolve({ data: profRows })
        : supabaseAdmin
            .from("hq_member_profile")
            .select(
              "instructor_id, department, rank_code, is_dept_head, profile_extra"
            ),
    ]);
    settings = sRes?.settings ?? null;
    instRows = iRes.data || [];
    profRows = pRes.data || [];
  }

  const profById = new Map<string, any>();
  (profRows || []).forEach((p: any) => {
    profById.set(String(p.instructor_id), p);
  });

  const subjectById = new Map<string, MemberPermissionSubject>();
  (instRows || []).forEach((inst: any) => {
    const idStr = String(inst.instructor_id);
    const prof = profById.get(idStr);
    const inf = inferRankFromPosition(inst.chat_position, inst.position);
    const rankCode = ((prof?.rank_code as HqRankCode) ||
      inf.rankCode) as HqRankCode;
    subjectById.set(idStr, {
      instructor_id: idStr,
      name: String(inst.name || "").trim(),
      department:
        String(prof?.department || inst.department || "미지정").trim() ||
        "미지정",
      rank_code: rankCode,
      is_dept_head: Boolean(prof?.is_dept_head ?? inf.isDeptHead),
      profile_extra:
        prof?.profile_extra && typeof prof.profile_extra === "object"
          ? prof.profile_extra
          : null,
    });
  });

  const callerSubject: MemberPermissionSubject = subjectById.get(
    caller.userId
  ) || {
    instructor_id: caller.userId,
    name: caller.name,
    department: caller.department,
    rank_code: caller.rankCode,
  };

  const resolved = resolveMemberPermissions({
    member: callerSubject,
    rawSettings: settings?.extra_settings?.permission_settings,
    isDbHqAdmin: caller.isSystemOwner,
  });

  const orgNodes = settings?.extra_settings?.org_chart_nodes;

  const canViewMemberWork = (targetId: string): boolean => {
    if (!targetId) return false;
    if (targetId === caller.userId) return true;
    if (resolved.isSuperAdmin) return true;
    const target = subjectById.get(targetId);
    if (!target) return false;
    return (
      resolved.canAccessTargetMember("work.record_view", target, orgNodes) ||
      resolved.canAccessTargetMember("work.realtime_view", target, orgNodes)
    );
  };

  const canEditMemberWork = (targetId: string): boolean => {
    if (!targetId) return false;
    if (resolved.isSuperAdmin) return true;
    const target =
      subjectById.get(targetId) ||
      (targetId === caller.userId ? callerSubject : null);
    if (!target) return false;
    return (
      resolved.canAccessTargetMember("work.record_edit", target, orgNodes) ||
      resolved.canAccessTargetMember("work.realtime_edit", target, orgNodes)
    );
  };

  return {
    resolved,
    subjectById,
    canViewMemberWork,
    canEditMemberWork,
  };
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const {
      nowIso,
      todayStr,
      currentMonth,
      nowKstMinutes,
      weekStartStr,
      weekEndStr,
    } = getKstNowParts();
    const startParam = req.nextUrl.searchParams.get("start_date");
    const endParam = req.nextUrl.searchParams.get("end_date");
    const monthParam = req.nextUrl.searchParams.get("month") || currentMonth;

    let rangeStart = "";
    let rangeEnd = "";

    if (
      startParam &&
      endParam &&
      /^\d{4}-\d{2}-\d{2}$/.test(startParam) &&
      /^\d{4}-\d{2}-\d{2}$/.test(endParam)
    ) {
      rangeStart = startParam <= endParam ? startParam : endParam;
      rangeEnd = endParam >= startParam ? endParam : startParam;
    } else {
      const [yearStr, monStr] = monthParam.split("-");
      const year = Number(yearStr) || new Date().getFullYear();
      const mon = Number(monStr) || new Date().getMonth() + 1;
      rangeStart = `${year}-${String(mon).padStart(2, "0")}-01`;
      const lastDay = new Date(year, mon, 0).getDate();
      rangeEnd = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(
        2,
        "0"
      )}`;
    }

    const minDate = [rangeStart, weekStartStr, todayStr].sort()[0];
    const maxDate = [rangeEnd, weekEndStr, todayStr].sort()[2];

    const supabaseAdmin = getSupabaseAdmin();
    const [attRes, settingsRes, wmState, instRes, profRes] = await Promise.all([
      supabaseAdmin
        .from("hq_attendance")
        .select("*")
        .gte("work_date", minDate)
        .lte("work_date", maxDate)
        .order("work_date", { ascending: false })
        .order("check_in_at", { ascending: true }),
      readCompanySettingsServer(supabaseAdmin).catch(() => null),
      readWorkMgmtStateServer(supabaseAdmin).catch(() => ({
        attendanceLocks: [],
        compensatoryGrants: [],
        holidaySubstitutions: [],
      })),
      supabaseAdmin.from("instructor").select("*"),
      supabaseAdmin.from("hq_member_profile").select("*"),
    ]);

    const { data, error } = attRes;
    if (error) {
      if (isMissingHqTableError(error)) {
        return NextResponse.json({
          success: true,
          schemaMissing: true,
          data: {
            todayStr,
            weekStartStr,
            weekEndStr,
            rangeStart,
            rangeEnd,
            myToday: null,
            myWeeklyMinutes: 0,
            todayRecords: [],
            weeklySummary: {},
            records: [],
            leaveApprovals: [],
          },
        });
      }
      return apiFail(`근태 내역 조회 실패: ${error.message}`, 500);
    }

    // 승인 또는 결재진행 중인 휴가 문서를 함께 조회하여 타임라인 및 자동 근무 기록 판정에 반영
    let allLeaveInWindow: any[] = [];
    try {
      const { data: leaveRows } = await supabaseAdmin
        .from("hq_approval_doc")
        .select(
          "approval_id, drafter_id, drafter_name, drafter_dept, doc_type, title, status, effective_date, end_date, leave_type, leave_days"
        )
        .eq("doc_type", "LEAVE")
        .in("status", ["APPROVED", "PENDING", "IN_PROGRESS"])
        .lte("effective_date", maxDate)
        .order("effective_date", { ascending: true });

      allLeaveInWindow = (leaveRows || []).filter((doc: any) => {
        const eff = doc.effective_date || "";
        const end = doc.end_date || eff;
        return eff <= maxDate && end >= minDate;
      });
    } catch {
      allLeaveInWindow = [];
    }

    const leaveApprovals = allLeaveInWindow.filter((doc: any) => {
      const eff = doc.effective_date || "";
      const end = doc.end_date || eff;
      return eff <= rangeEnd && end >= rangeStart;
    });

    // =======================================================================
    // 자동 근무 기록 (auto_record_enabled) 실시간 출근·업무시작·퇴근 자동 반영 엔진
    // =======================================================================
    const allRowsMap = new Map<string, any>();
    (data || []).forEach((r: any) => {
      allRowsMap.set(`${r.instructor_id}__${r.work_date}`, r);
    });

    try {
      const settings = settingsRes?.settings;
      const savedRules = settings?.extra_settings?.work_rules;
      const workRules: HqWorkRuleItem[] =
        Array.isArray(savedRules) && savedRules.length > 0
          ? savedRules
          : DEFAULT_WORK_RULES;

      const holidaySet = new Set<string>();
      Object.values(settings?.holidays_by_year || {}).forEach((arr: any) => {
        (arr || []).forEach((h: any) => {
          if (!h?.start_date) return;
          const s = String(h.start_date).slice(0, 10);
          const e = String(h.end_date || h.start_date).slice(0, 10);
          let c = s;
          let g = 0;
          while (c <= e && g < 35) {
            holidaySet.add(c);
            c = addOneDayYmd(c);
            g += 1;
          }
        });
      });

      const profById = new Map<string, any>();
      (profRes.data || []).forEach((p: any) => {
        profById.set(String(p.instructor_id), p);
      });

      const activeHqMembers = (instRes.data || []).filter((inst: any) => {
        const idStr = String(inst.instructor_id);
        const tId = inst.tenant_id ? String(inst.tenant_id) : "";
        if (!caller.hqTenantIds.has(tId) && idStr !== caller.userId) {
          return false;
        }
        const prof = profById.get(idStr);
        const workStatus = prof?.work_status || inst.status || "재직";
        if (workStatus === "퇴직" || workStatus === "퇴사") return false;
        return true;
      });

      const autoEndCap = maxDate < todayStr ? maxDate : todayStr;
      // 최근 120일 이내 범위만 자동 머티리얼라이즈하여 대량 과거 쿼리 부하 방지
      const [ty, tm, td] = todayStr.split("-").map(Number);
      const minFloorDt = new Date(Date.UTC(ty, (tm || 1) - 1, (td || 1) - 120));
      const floorYmd = minFloorDt.toISOString().slice(0, 10);
      const autoStart = minDate > floorYmd ? minDate : floorYmd;

      const autoUpserts: Record<string, any>[] = [];

      if (autoStart <= autoEndCap && activeHqMembers.length > 0) {
        for (const inst of activeHqMembers) {
          const memberId = String(inst.instructor_id);
          const memberName = String(inst.name || "구성원");
          const prof = profById.get(memberId);
          const dept = String(
            prof?.department || inst.department || "미지정"
          ).trim() || "미지정";
          const profExtra =
            prof?.profile_extra && typeof prof.profile_extra === "object"
              ? prof.profile_extra
              : {};

          const rule = resolveMemberWorkRuleServer(
            memberName,
            profExtra.work_schedule_type,
            workRules
          );
          const autoEnabled = rule.auto_record_enabled !== false;
          const autoMissingCheckout =
            rule.missing_checkout_policy === "정시 퇴근 시각으로 자동 기록";

          if (!autoEnabled && !autoMissingCheckout) continue;

          const rawHire = prof?.hire_date
            ? String(prof.hire_date).slice(0, 10)
            : inst.created_at
              ? String(inst.created_at).slice(0, 10)
              : "2020-01-01";
          const groupHire =
            profExtra.use_group_hire_date !== false && profExtra.group_hire_date
              ? String(profExtra.group_hire_date).slice(0, 10)
              : rawHire;
          const joinYmd = groupHire < rawHire ? groupHire : rawHire;
          const resignYmd = prof?.resign_date
            ? String(prof.resign_date).slice(0, 10)
            : "";

          let cursor = autoStart > joinYmd ? autoStart : joinYmd;
          let guard = 0;
          while (cursor <= autoEndCap && guard < 130) {
            guard += 1;
            const ymd = cursor;
            cursor = addOneDayYmd(cursor);

            if (resignYmd && ymd > resignYmd) continue;
            if (holidaySet.has(ymd)) continue;

            const [cy, cm, cd] = ymd.split("-").map(Number);
            const dow = new Date(Date.UTC(cy, (cm || 1) - 1, cd || 1)).getUTCDay();
            const dowKo = WEEKDAY_KO_UTC[dow];
            const workDays =
              Array.isArray(rule.work_days) && rule.work_days.length > 0
                ? rule.work_days
                : ["월", "화", "수", "목", "금"];
            if (!workDays.includes(dowKo)) continue;

            const isLocked = (wmState.attendanceLocks || []).some(
              (l: any) =>
                ymd >= l.start_date &&
                ymd <= l.end_date &&
                (l.target_scope === "ALL" ||
                  (l.target_departments || []).includes(dept))
            );
            if (isLocked) continue;

            // 해당 날짜 휴가 확인
            const memberLeave = allLeaveInWindow.find((lv: any) => {
              if (String(lv.drafter_id) !== memberId) return false;
              const eff = String(lv.effective_date || "");
              const end = String(lv.end_date || eff);
              return ymd >= eff && ymd <= end;
            });

            const leaveLabel = String(memberLeave?.leave_type || "");
            const isHalfAm = leaveLabel.includes("오전 반차");
            const isHalfPm =
              leaveLabel.includes("오후 반차") ||
              (leaveLabel.includes("반차") && !isHalfAm);
            const isHourlyLeave =
              leaveLabel.includes("반반차") || leaveLabel.includes("시간차");
            const isFullDayLeave =
              Boolean(memberLeave) && !isHalfAm && !isHalfPm && !isHourlyLeave;

            if (isFullDayLeave) continue;

            const dayCustom =
              rule.per_day_custom_enabled && rule.per_day_schedule?.[dowKo]
                ? rule.per_day_schedule[dowKo]
                : null;
            const baseStartMin = parseHmMinutes(
              dayCustom?.start_time || rule.start_time || "09:00",
              540
            );
            const baseWorkMin =
              Number(
                dayCustom ? dayCustom.work_hours : rule.daily_work_hours ?? 8
              ) *
                60 +
              Number(
                dayCustom
                  ? dayCustom.work_minutes
                  : rule.daily_work_minutes ?? 0
              );
            const baseBreakMin = calcRuleBreakMinutes(rule, baseWorkMin);

            let schedStartMin = baseStartMin;
            let schedWorkMin = baseWorkMin;
            let schedBreakMin = baseBreakMin;

            if (isHalfAm) {
              schedStartMin = baseStartMin + 240 + baseBreakMin;
              schedWorkMin = Math.max(0, baseWorkMin - 240);
              schedBreakMin = 0;
            } else if (isHalfPm) {
              schedStartMin = baseStartMin;
              schedWorkMin = Math.max(0, baseWorkMin - 240);
              schedBreakMin = 0;
            }

            if (schedWorkMin <= 0) continue;

            const schedEndMin = schedStartMin + schedWorkMin + schedBreakMin;
            const startHm = minutesToHmStr(schedStartMin);
            const endHm = minutesToHmStr(schedEndMin);
            const { checkInIso, checkOutIso } = buildCheckInOutIso(
              ymd,
              startHm,
              endHm
            );

            const mapKey = `${memberId}__${ymd}`;
            const existing = allRowsMap.get(mapKey);

            if (!existing) {
              if (!autoEnabled) continue;

              if (ymd < todayStr) {
                const rowPayload = {
                  instructor_id: memberId,
                  member_name: memberName,
                  department: dept,
                  work_date: ymd,
                  work_mode: "OFFICE" as HqWorkMode,
                  status: (isHalfAm || isHalfPm
                    ? "HALF_LEAVE"
                    : "DONE") as HqAttendanceStatus,
                  check_in_at: checkInIso,
                  check_out_at: checkOutIso,
                  break_minutes: schedBreakMin,
                  worked_minutes: schedWorkMin,
                  overtime_minutes: Math.max(0, schedWorkMin - 480),
                  location_note: "자동 근무 기록",
                  memo: "근무 유형 자동 출퇴근 기록",
                  updated_at: nowIso,
                };
                autoUpserts.push(rowPayload);
                allRowsMap.set(mapKey, rowPayload);
              } else if (ymd === todayStr) {
                if (nowKstMinutes >= schedEndMin) {
                  const rowPayload = {
                    instructor_id: memberId,
                    member_name: memberName,
                    department: dept,
                    work_date: ymd,
                    work_mode: "OFFICE" as HqWorkMode,
                    status: (isHalfAm || isHalfPm
                      ? "HALF_LEAVE"
                      : "DONE") as HqAttendanceStatus,
                    check_in_at: checkInIso,
                    check_out_at: checkOutIso,
                    break_minutes: schedBreakMin,
                    worked_minutes: schedWorkMin,
                    overtime_minutes: Math.max(0, schedWorkMin - 480),
                    location_note: "자동 근무 기록",
                    memo: "지정 퇴근 시각 자동 기록",
                    updated_at: nowIso,
                  };
                  autoUpserts.push(rowPayload);
                  allRowsMap.set(mapKey, rowPayload);
                } else if (nowKstMinutes >= schedStartMin) {
                  const rowPayload = {
                    instructor_id: memberId,
                    member_name: memberName,
                    department: dept,
                    work_date: ymd,
                    work_mode: "OFFICE" as HqWorkMode,
                    status: "WORKING" as HqAttendanceStatus,
                    check_in_at: checkInIso,
                    check_out_at: null,
                    break_minutes: schedBreakMin,
                    worked_minutes: 0,
                    overtime_minutes: 0,
                    location_note: "자동 근무 기록",
                    memo: "지정 출근 시각 자동 업무 시작",
                    updated_at: nowIso,
                  };
                  autoUpserts.push(rowPayload);
                  allRowsMap.set(mapKey, rowPayload);
                }
              }
            } else if (
              existing.status === "WORKING" &&
              !existing.check_out_at &&
              (ymd < todayStr ||
                (ymd === todayStr &&
                  autoEnabled &&
                  nowKstMinutes >= schedEndMin))
            ) {
              const effInIso = existing.check_in_at || checkInIso;
              const calc = calcWorkedMinutes(
                effInIso,
                checkOutIso,
                existing.break_minutes ?? schedBreakMin
              );
              const updatedRow = {
                instructor_id: existing.instructor_id,
                member_name: existing.member_name || memberName,
                department: existing.department || dept,
                work_date: ymd,
                work_mode: existing.work_mode || "OFFICE",
                status: "DONE" as HqAttendanceStatus,
                check_in_at: effInIso,
                check_out_at: checkOutIso,
                break_minutes: calc.breakMinutes,
                worked_minutes: calc.workedMinutes,
                overtime_minutes: calc.overtimeMinutes,
                location_note: existing.location_note || "자동 근무 기록",
                memo: existing.memo || "지정 퇴근 시각 자동 퇴근 처리",
                updated_at: nowIso,
              };
              autoUpserts.push(updatedRow);
              allRowsMap.set(mapKey, { ...existing, ...updatedRow });
            }
          }
        }

        if (autoUpserts.length > 0) {
          const { data: savedAuto } = await supabaseAdmin
            .from("hq_attendance")
            .upsert(autoUpserts, { onConflict: "instructor_id,work_date" })
            .select("*");
          (savedAuto || []).forEach((sr: any) => {
            allRowsMap.set(`${sr.instructor_id}__${sr.work_date}`, sr);
          });
        }
      }
    } catch (autoErr) {
      console.warn("Auto attendance materialization warning:", autoErr);
    }

    const permGuard = await buildWorkPermissionGuard(supabaseAdmin, caller, {
      settings: settingsRes?.settings ?? null,
      instRows: instRes.data || [],
      profRows: profRes.data || [],
    });

    const allRows = Array.from(allRowsMap.values()).sort((a, b) =>
      String(b.work_date || "").localeCompare(String(a.work_date || ""))
    );
    const nowMs = Date.now();

    const myToday =
      allRows.find(
        (r: any) =>
          r.work_date === todayStr && r.instructor_id === caller.userId
      ) || null;

    // 이번 주 구성원별 누적 실근무시간(분) 계산 (열람 허용 범위 내 구성원 + 본인만 노출)
    const fullWeeklySummary: Record<string, number> = {};
    allRows.forEach((r: any) => {
      if (r.work_date < weekStartStr || r.work_date > weekEndStr) return;
      let mins = Number(r.worked_minutes || 0);
      if (r.status === "WORKING" && r.check_in_at && !r.check_out_at) {
        const elapsed = Math.max(
          0,
          Math.round((nowMs - new Date(r.check_in_at).getTime()) / 60000)
        );
        const brk = Number(r.break_minutes ?? 60);
        const deductBreak =
          brk > 0 && elapsed > 240 ? Math.min(brk, elapsed - 240) : 0;
        mins = Math.max(0, elapsed - deductBreak);
      }
      fullWeeklySummary[r.instructor_id] =
        (fullWeeklySummary[r.instructor_id] || 0) + mins;
    });

    const weeklySummary: Record<string, number> = {};
    Object.entries(fullWeeklySummary).forEach(([memberId, mins]) => {
      if (permGuard.canViewMemberWork(memberId)) {
        weeklySummary[memberId] = mins;
      }
    });

    const todayRecords = allRows.filter(
      (r: any) =>
        r.work_date === todayStr &&
        permGuard.canViewMemberWork(String(r.instructor_id))
    );

    const rangeRecords = allRows.filter(
      (r: any) =>
        r.work_date >= rangeStart &&
        r.work_date <= rangeEnd &&
        permGuard.canViewMemberWork(String(r.instructor_id))
    );

    const visibleLeaveApprovals = leaveApprovals.filter((doc: any) =>
      permGuard.canViewMemberWork(String(doc.drafter_id))
    );

    return NextResponse.json({
      success: true,
      schemaMissing: false,
      data: {
        todayStr,
        weekStartStr,
        weekEndStr,
        rangeStart,
        rangeEnd,
        myToday,
        myWeeklyMinutes: fullWeeklySummary[caller.userId] || 0,
        todayRecords,
        weeklySummary,
        records: rangeRecords,
        leaveApprovals: visibleLeaveApprovals,
      },
    });
  } catch (e: any) {
    console.error("HQ attendance GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const body = await req.json();
    const action = String(body?.action || "CHECK_IN").toUpperCase();
    const { nowIso, todayStr } = getKstNowParts();
    const supabaseAdmin = getSupabaseAdmin();

    if (action === "CHECK_IN") {
      const workMode = (body?.work_mode || "OFFICE") as HqWorkMode;
      const modeMeta = ATTENDANCE_MODES[workMode] || ATTENDANCE_MODES.OFFICE;
      const locationNote =
        String(body?.location_note || "").trim() || modeMeta.defaultLocation;
      const memo = String(body?.memo || "").trim() || null;

      const { data: existing, error: findErr } = await supabaseAdmin
        .from("hq_attendance")
        .select("*")
        .eq("instructor_id", caller.userId)
        .eq("work_date", todayStr)
        .maybeSingle();

      if (findErr && isMissingHqTableError(findErr)) {
        return apiFail(
          "먼저 상단 노란 배너에서 확장 DB 테이블 생성 SQL을 1회 실행해 주세요.",
          400
        );
      }

      if (existing?.check_in_at && existing.status === "WORKING") {
        return apiFail("이미 오늘 출근 처리되어 근무 중입니다.");
      }

      const payload = {
        instructor_id: caller.userId,
        member_name: caller.name,
        department: caller.department,
        work_date: todayStr,
        work_mode: workMode,
        status: "WORKING" as HqAttendanceStatus,
        check_in_at: existing?.check_in_at || nowIso,
        check_out_at: null,
        location_note: locationNote,
        memo: memo || existing?.memo || null,
        updated_at: nowIso,
      };

      const { data: saved, error: saveErr } = await supabaseAdmin
        .from("hq_attendance")
        .upsert(payload, { onConflict: "instructor_id,work_date" })
        .select("*")
        .single();

      if (saveErr) return apiFail(`출근 기록 실패: ${saveErr.message}`, 500);
      notifySlackIfEnabled(
        supabaseAdmin,
        "ATTENDANCE",
        `🟢 *[출근]* ${caller.name} (${caller.department}) — ${modeMeta.label} (${locationNote})`
      ).catch(() => {});
      return NextResponse.json({ success: true, data: saved });
    }

    if (action === "CHECK_OUT") {
      const { data: existing, error: findErr } = await supabaseAdmin
        .from("hq_attendance")
        .select("*")
        .eq("instructor_id", caller.userId)
        .eq("work_date", todayStr)
        .maybeSingle();

      if (findErr && isMissingHqTableError(findErr)) {
        return apiFail("근태 DB 테이블을 먼저 생성해 주세요.", 400);
      }
      if (!existing || !existing.check_in_at) {
        return apiFail("오늘 출근 기록이 없습니다. 먼저 출근 체크인을 해주세요.");
      }

      const { breakMinutes, workedMinutes, overtimeMinutes } = calcWorkedMinutes(
        existing.check_in_at,
        nowIso,
        body?.break_minutes !== undefined ? Number(body.break_minutes) : undefined
      );

      const nextMemo =
        body?.memo !== undefined
          ? String(body.memo).trim() || existing.memo || null
          : existing.memo || null;

      const { data: saved, error: saveErr } = await supabaseAdmin
        .from("hq_attendance")
        .update({
          status: "DONE",
          check_out_at: nowIso,
          break_minutes: breakMinutes,
          worked_minutes: workedMinutes,
          overtime_minutes: overtimeMinutes,
          memo: nextMemo,
          updated_at: nowIso,
        })
        .eq("attendance_id", existing.attendance_id)
        .select("*")
        .single();

      if (saveErr) return apiFail(`퇴근 기록 실패: ${saveErr.message}`, 500);
      notifySlackIfEnabled(
        supabaseAdmin,
        "ATTENDANCE",
        `🔵 *[퇴근]* ${caller.name} (${caller.department}) — 총 근무 ${Math.floor(
          workedMinutes / 60
        )}시간 ${workedMinutes % 60}분`
      ).catch(() => {});
      return NextResponse.json({ success: true, data: saved });
    }

    if (action === "CHANGE_MODE") {
      const workMode = (body?.work_mode || "OFFICE") as HqWorkMode;
      const modeMeta = ATTENDANCE_MODES[workMode] || ATTENDANCE_MODES.OFFICE;
      const locationNote =
        String(body?.location_note || "").trim() || modeMeta.defaultLocation;

      const { data: saved, error: saveErr } = await supabaseAdmin
        .from("hq_attendance")
        .update({
          work_mode: workMode,
          location_note: locationNote,
          memo:
            body?.memo !== undefined
              ? String(body.memo).trim() || null
              : undefined,
          updated_at: nowIso,
        })
        .eq("instructor_id", caller.userId)
        .eq("work_date", todayStr)
        .select("*")
        .single();

      if (saveErr) return apiFail(`근무형태 변경 실패: ${saveErr.message}`, 500);
      return NextResponse.json({ success: true, data: saved });
    }

    if (action === "MANUAL_UPSERT") {
      const permGuard = await buildWorkPermissionGuard(supabaseAdmin, caller);
      const targetId = String(body?.instructor_id || caller.userId);
      if (!permGuard.canEditMemberWork(targetId)) {
        return apiFail(
          targetId === caller.userId
            ? "근무 시간 편집 권한이 없습니다. 권한 설정에서 [근무 편집] 권한을 확인해 주세요."
            : "선택한 구성원의 근무 기록을 편집할 권한(또는 허용 범위)이 없습니다.",
          403
        );
      }

      const targetSubject = permGuard.subjectById.get(targetId);
      const targetDept = String(
        body?.department || targetSubject?.department || caller.department
      );
      const workDate = String(body?.work_date || todayStr);
      if (
        !permGuard.resolved.isSuperAdmin &&
        !permGuard.resolved.effectivePermissions["work.close_manage"]
      ) {
        const wmState = await readWorkMgmtStateServer(supabaseAdmin);
        const lockedHit = wmState.attendanceLocks.find(
          (l) =>
            workDate >= l.start_date &&
            workDate <= l.end_date &&
            (l.target_scope === "ALL" ||
              (l.target_departments || []).includes(targetDept))
        );
        if (lockedHit) {
          return apiFail(
            `근태 마감(${lockedHit.title}: ${lockedHit.start_date}~${lockedHit.end_date})된 기간의 기록은 수정할 수 없습니다.`,
            403
          );
        }
      }

      const workMode = (body?.work_mode || "OFFICE") as HqWorkMode;
      const statusOverride = String(body?.status_override || "");
      const inTime = String(body?.check_in_time || "").trim();
      const outTime = String(body?.check_out_time || "").trim();

      const isFullLeave = workMode === "LEAVE" && statusOverride !== "HALF_LEAVE";
      const { checkInIso, checkOutIso } = isFullLeave
        ? { checkInIso: null, checkOutIso: null }
        : buildCheckInOutIso(workDate, inTime, outTime);

      const calc = isFullLeave
        ? { breakMinutes: 0, workedMinutes: 0, overtimeMinutes: 0 }
        : calcWorkedMinutes(
            checkInIso,
            checkOutIso,
            body?.break_minutes !== undefined
              ? Number(body.break_minutes)
              : undefined
          );

      const status: HqAttendanceStatus =
        statusOverride === "HALF_LEAVE"
          ? "HALF_LEAVE"
          : isFullLeave
          ? "LEAVE"
          : checkOutIso
          ? "DONE"
          : "WORKING";

      const memberName = String(
        body?.member_name || targetSubject?.name || caller.name
      );
      const department = targetDept;

      const { data: saved, error: saveErr } = await supabaseAdmin
        .from("hq_attendance")
        .upsert(
          {
            instructor_id: targetId,
            member_name: memberName,
            department,
            work_date: workDate,
            work_mode: workMode,
            status,
            check_in_at: checkInIso,
            check_out_at: checkOutIso,
            break_minutes: calc.breakMinutes,
            worked_minutes: calc.workedMinutes,
            overtime_minutes: calc.overtimeMinutes,
            location_note:
              String(body?.location_note || "").trim() ||
              ATTENDANCE_MODES[workMode]?.defaultLocation ||
              null,
            memo: String(body?.memo || "").trim() || null,
            updated_at: nowIso,
          },
          { onConflict: "instructor_id,work_date" }
        )
        .select("*")
        .single();

      if (saveErr) return apiFail(`근태 저장 실패: ${saveErr.message}`, 500);
      return NextResponse.json({ success: true, data: saved });
    }

    if (action === "BATCH_MANUAL_UPSERT") {
      const permGuard = await buildWorkPermissionGuard(supabaseAdmin, caller);
      const items: any[] = Array.isArray(body?.items) ? body.items : [];
      if (items.length === 0) {
        return apiFail("등록할 변경 일정이 없습니다.");
      }

      const wmState =
        !permGuard.resolved.isSuperAdmin &&
        !permGuard.resolved.effectivePermissions["work.close_manage"]
          ? await readWorkMgmtStateServer(supabaseAdmin)
          : null;

      const upserts: any[] = [];
      const deleteKeys: { instructor_id: string; work_date: string; attendance_id?: string }[] = [];

      for (const item of items.slice(0, 200)) {
        const targetId = String(item?.instructor_id || caller.userId);
        if (!permGuard.canEditMemberWork(targetId)) {
          return apiFail(
            targetId === caller.userId
              ? "근무 시간 편집 권한이 없습니다. 권한 설정에서 [근무 편집] 권한을 확인해 주세요."
              : "선택한 구성원의 근무 기록을 편집할 권한(또는 허용 범위)이 없습니다.",
            403
          );
        }

        const targetSubject = permGuard.subjectById.get(targetId);
        const targetDept = String(
          item?.department || targetSubject?.department || caller.department
        );
        const workDate = String(item?.work_date || todayStr);

        if (wmState) {
          const lockedHit = wmState.attendanceLocks.find(
            (l) =>
              workDate >= l.start_date &&
              workDate <= l.end_date &&
              (l.target_scope === "ALL" ||
                (l.target_departments || []).includes(targetDept))
          );
          if (lockedHit) {
            return apiFail(
              `근태 마감(${lockedHit.title}: ${lockedHit.start_date}~${lockedHit.end_date})된 기간의 기록은 수정할 수 없습니다.`,
              403
            );
          }
        }

        if (item?.mode === "DELETE") {
          deleteKeys.push({
            instructor_id: targetId,
            work_date: workDate,
            attendance_id: item?.attendance_id
              ? String(item.attendance_id)
              : undefined,
          });
          continue;
        }

        const workMode = (item?.work_mode || "OFFICE") as HqWorkMode;
        const statusOverride = String(item?.status_override || "");
        const inTime = String(item?.check_in_time || "").trim();
        const outTime = String(item?.check_out_time || "").trim();
        const isFullLeave =
          workMode === "LEAVE" && statusOverride !== "HALF_LEAVE";
        const { checkInIso, checkOutIso } = isFullLeave
          ? { checkInIso: null, checkOutIso: null }
          : buildCheckInOutIso(workDate, inTime, outTime);

        const calc = isFullLeave
          ? { breakMinutes: 0, workedMinutes: 0, overtimeMinutes: 0 }
          : calcWorkedMinutes(
              checkInIso,
              checkOutIso,
              item?.break_minutes !== undefined
                ? Number(item.break_minutes)
                : undefined
            );

        const status: HqAttendanceStatus =
          statusOverride === "HALF_LEAVE"
            ? "HALF_LEAVE"
            : isFullLeave
              ? "LEAVE"
              : checkOutIso
                ? "DONE"
                : "WORKING";

        upserts.push({
          instructor_id: targetId,
          member_name: String(
            item?.member_name || targetSubject?.name || caller.name
          ),
          department: targetDept,
          work_date: workDate,
          work_mode: workMode,
          status,
          check_in_at: checkInIso,
          check_out_at: checkOutIso,
          break_minutes: calc.breakMinutes,
          worked_minutes: calc.workedMinutes,
          overtime_minutes: calc.overtimeMinutes,
          location_note:
            String(item?.location_note || "").trim() ||
            ATTENDANCE_MODES[workMode]?.defaultLocation ||
            null,
          memo: String(item?.memo || "").trim() || null,
          updated_at: nowIso,
        });
      }

      if (deleteKeys.length > 0) {
        for (const dk of deleteKeys) {
          if (dk.attendance_id) {
            await supabaseAdmin
              .from("hq_attendance")
              .delete()
              .eq("attendance_id", dk.attendance_id);
          } else {
            await supabaseAdmin
              .from("hq_attendance")
              .delete()
              .eq("instructor_id", dk.instructor_id)
              .eq("work_date", dk.work_date);
          }
        }
      }

      if (upserts.length > 0) {
        const { error: upErr } = await supabaseAdmin
          .from("hq_attendance")
          .upsert(upserts, { onConflict: "instructor_id,work_date" });
        if (upErr) {
          return apiFail(`근무 일정 등록 실패: ${upErr.message}`, 500);
        }
      }

      return NextResponse.json({
        success: true,
        data: { upserted: upserts.length, deleted: deleteKeys.length },
      });
    }

    if (action === "BATCH_RECURRING_UPSERT") {
      const permGuard = await buildWorkPermissionGuard(supabaseAdmin, caller);
      const targetId = String(body?.instructor_id || caller.userId);
      if (!permGuard.canEditMemberWork(targetId)) {
        return apiFail(
          targetId === caller.userId
            ? "근무 편집 권한이 없어 반복 근무 일정을 등록할 수 없습니다."
            : "선택한 구성원의 반복 근무 일정을 등록할 권한이 없습니다.",
          403
        );
      }

      const startDate = String(body?.start_date || "");
      const endDate = String(body?.end_date || "");
      const weekdays: number[] = Array.isArray(body?.weekdays)
        ? body.weekdays.map(Number)
        : [1, 2, 3, 4, 5];

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
        startDate > endDate
      ) {
        return apiFail("반복 일정 시작일과 종료일을 확인해 주세요.");
      }

      const workMode = (body?.work_mode || "OFFICE") as HqWorkMode;
      const inTime = String(body?.check_in_time || "09:00").trim();
      const outTime = String(body?.check_out_time || "18:00").trim();
      const breakMin =
        body?.break_minutes !== undefined ? Number(body.break_minutes) : 60;
      const locationNote =
        String(body?.location_note || "").trim() ||
        ATTENDANCE_MODES[workMode]?.defaultLocation ||
        null;
      const memo = String(body?.memo || "").trim() || null;
      const memberName = String(body?.member_name || caller.name);
      const department = String(body?.department || caller.department);

      const upserts: any[] = [];
      let cursor = startDate;
      let safety = 0;
      while (cursor <= endDate && safety < 92) {
        safety += 1;
        const [y, m, d] = cursor.split("-").map(Number);
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        if (weekdays.includes(dow)) {
          const { checkInIso, checkOutIso } = buildCheckInOutIso(
            cursor,
            inTime,
            outTime
          );
          const calc = calcWorkedMinutes(checkInIso, checkOutIso, breakMin);
          upserts.push({
            instructor_id: targetId,
            member_name: memberName,
            department,
            work_date: cursor,
            work_mode: workMode,
            status: checkOutIso ? ("DONE" as HqAttendanceStatus) : ("WORKING" as HqAttendanceStatus),
            check_in_at: checkInIso,
            check_out_at: checkOutIso,
            break_minutes: calc.breakMinutes,
            worked_minutes: calc.workedMinutes,
            overtime_minutes: calc.overtimeMinutes,
            location_note: locationNote,
            memo,
            updated_at: nowIso,
          });
        }
        cursor = addOneDayYmd(cursor);
      }

      if (upserts.length === 0) {
        return apiFail("선택한 기간 내 해당 요일이 없습니다.");
      }

      const { error: batchErr } = await supabaseAdmin
        .from("hq_attendance")
        .upsert(upserts, { onConflict: "instructor_id,work_date" });

      if (batchErr) {
        return apiFail(`반복 일정 등록 실패: ${batchErr.message}`, 500);
      }

      return NextResponse.json({
        success: true,
        data: { count: upserts.length },
      });
    }

    if (action === "BULK_CSV_UPSERT") {
      const permGuard = await buildWorkPermissionGuard(supabaseAdmin, caller);
      const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
      if (rows.length === 0) {
        return apiFail("업로드할 유효한 근무 기록 행이 없습니다.");
      }

      const unauthorizedRow = rows
        .slice(0, 500)
        .find((r) => !permGuard.canEditMemberWork(String(r.instructor_id || "")));
      if (unauthorizedRow) {
        return apiFail(
          `업로드 데이터 중 '${unauthorizedRow.member_name || "구성원"}' 님의 근무 기록을 편집할 권한이 없습니다.`,
          403
        );
      }

      const upserts = rows.slice(0, 500).map((r) => {
        const workDate = String(r.work_date || todayStr);
        const workMode = (r.work_mode || "OFFICE") as HqWorkMode;
        const isLeave = workMode === "LEAVE";
        const { checkInIso, checkOutIso } = isLeave
          ? { checkInIso: null, checkOutIso: null }
          : buildCheckInOutIso(
              workDate,
              String(r.check_in_time || ""),
              String(r.check_out_time || "")
            );
        const calc = isLeave
          ? { breakMinutes: 0, workedMinutes: 0, overtimeMinutes: 0 }
          : calcWorkedMinutes(
              checkInIso,
              checkOutIso,
              r.break_minutes !== undefined ? Number(r.break_minutes) : undefined
            );

        return {
          instructor_id: String(r.instructor_id),
          member_name: String(r.member_name || ""),
          department: String(r.department || ""),
          work_date: workDate,
          work_mode: workMode,
          status: (isLeave
            ? "LEAVE"
            : checkOutIso
            ? "DONE"
            : "WORKING") as HqAttendanceStatus,
          check_in_at: checkInIso,
          check_out_at: checkOutIso,
          break_minutes: calc.breakMinutes,
          worked_minutes: calc.workedMinutes,
          overtime_minutes: calc.overtimeMinutes,
          location_note:
            String(r.location_note || "").trim() ||
            ATTENDANCE_MODES[workMode]?.defaultLocation ||
            null,
          memo: String(r.memo || "").trim() || null,
          updated_at: nowIso,
        };
      });

      const { error: upErr } = await supabaseAdmin
        .from("hq_attendance")
        .upsert(upserts, { onConflict: "instructor_id,work_date" });

      if (upErr) {
        return apiFail(`근무 기록 업로드 실패: ${upErr.message}`, 500);
      }

      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "개인정보 접근",
        user_id: caller.userId,
        user_name: caller.name,
        user_email: caller.email,
        department: caller.department,
        event_type: "생성",
        info_type: "근무정보",
        description: `근무 기록 CSV 일괄 업로드 (${upserts.length}건 반영)`,
        delegated: caller.isDelegatedHrAdmin,
      }).catch(() => {});

      return NextResponse.json({
        success: true,
        data: { count: upserts.length },
      });
    }

    if (action === "DELETE_RECORD") {
      const attendanceId = String(body?.attendance_id || "").trim();
      if (!attendanceId) {
        return apiFail("삭제할 기록 ID가 없습니다.");
      }

      const { data: existing } = await supabaseAdmin
        .from("hq_attendance")
        .select("*")
        .eq("attendance_id", attendanceId)
        .maybeSingle();

      if (!existing) {
        return apiFail("이미 삭제되었거나 존재하지 않는 기록입니다.", 404);
      }
      const permGuard = await buildWorkPermissionGuard(supabaseAdmin, caller);
      if (!permGuard.canEditMemberWork(String(existing.instructor_id))) {
        return apiFail(
          existing.instructor_id === caller.userId
            ? "근무 편집 권한이 없어 근무 기록을 삭제할 수 없습니다."
            : "해당 구성원의 근무 기록을 삭제할 권한이 없습니다.",
          403
        );
      }

      const { error: delErr } = await supabaseAdmin
        .from("hq_attendance")
        .delete()
        .eq("attendance_id", attendanceId);

      if (delErr) return apiFail(`삭제 실패: ${delErr.message}`, 500);
      return NextResponse.json({ success: true });
    }

    return apiFail("지원하지 않는 근태 요청입니다.");
  } catch (e: any) {
    console.error("HQ attendance POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
