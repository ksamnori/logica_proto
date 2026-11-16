// src/app/api/hq/attendance/route.ts
import { NextRequest, NextResponse } from "next/server";
import { appendHqAuditLog } from "@/lib/hq/auditLogServer";
import { ATTENDANCE_MODES } from "@/lib/hq/constants";
import { notifySlackIfEnabled } from "@/lib/hq/integrationServer";
import { readWorkMgmtStateServer } from "@/lib/hq/leavesLedgerServer";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqAttendanceStatus, HqWorkMode } from "@/lib/hq/types";

export const runtime = "nodejs";

function getKstNowParts() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayStr = kst.toISOString().slice(0, 10);
  const currentMonth = todayStr.slice(0, 7);

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

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const { todayStr, currentMonth, weekStartStr, weekEndStr } = getKstNowParts();
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
    const { data, error } = await supabaseAdmin
      .from("hq_attendance")
      .select("*")
      .gte("work_date", minDate)
      .lte("work_date", maxDate)
      .order("work_date", { ascending: false })
      .order("check_in_at", { ascending: true });

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

    // 승인 또는 결재진행 중인 휴가 문서를 함께 조회하여 타임라인에 연동 표시
    let leaveApprovals: any[] = [];
    try {
      const { data: leaveRows } = await supabaseAdmin
        .from("hq_approval_doc")
        .select(
          "approval_id, drafter_id, drafter_name, drafter_dept, doc_type, title, status, effective_date, end_date, leave_type, leave_days"
        )
        .eq("doc_type", "LEAVE")
        .in("status", ["APPROVED", "PENDING", "IN_PROGRESS"])
        .lte("effective_date", rangeEnd)
        .order("effective_date", { ascending: true });

      leaveApprovals = (leaveRows || []).filter((doc: any) => {
        const eff = doc.effective_date || "";
        const end = doc.end_date || eff;
        return eff <= rangeEnd && end >= rangeStart;
      });
    } catch {
      leaveApprovals = [];
    }

    const allRows = data || [];
    const nowMs = Date.now();

    const todayRecords = allRows.filter((r: any) => r.work_date === todayStr);
    const myToday =
      todayRecords.find((r: any) => r.instructor_id === caller.userId) || null;

    // 이번 주 구성원별 누적 실근무시간(분) 계산
    const weeklySummary: Record<string, number> = {};
    allRows.forEach((r: any) => {
      if (r.work_date < weekStartStr || r.work_date > weekEndStr) return;
      let mins = Number(r.worked_minutes || 0);
      if (r.status === "WORKING" && r.check_in_at && !r.check_out_at) {
        const elapsed = Math.max(
          0,
          Math.round((nowMs - new Date(r.check_in_at).getTime()) / 60000)
        );
        const autoBreak = elapsed >= 300 ? 60 : 0;
        mins = Math.max(0, elapsed - autoBreak);
      }
      weeklySummary[r.instructor_id] =
        (weeklySummary[r.instructor_id] || 0) + mins;
    });

    const rangeRecords = allRows.filter(
      (r: any) => r.work_date >= rangeStart && r.work_date <= rangeEnd
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
        myWeeklyMinutes: weeklySummary[caller.userId] || 0,
        todayRecords,
        weeklySummary,
        records: rangeRecords,
        leaveApprovals,
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
    const canManageTeam =
      caller.isHrManager || caller.isHqAdmin || caller.rankLevel >= 3;

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
      const targetId = String(body?.instructor_id || caller.userId);
      if (targetId !== caller.userId && !canManageTeam) {
        return apiFail(
          "타 구성원의 근태 보정은 팀장급 이상 또는 인사담당자만 가능합니다.",
          403
        );
      }

      const workDate = String(body?.work_date || todayStr);
      if (!caller.isHrManager && !caller.isHqAdmin) {
        const wmState = await readWorkMgmtStateServer(supabaseAdmin);
        const lockedHit = wmState.attendanceLocks.find(
          (l) =>
            workDate >= l.start_date &&
            workDate <= l.end_date &&
            (l.target_scope === "ALL" ||
              (l.target_departments || []).includes(caller.department))
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

      const memberName = String(body?.member_name || caller.name);
      const department = String(body?.department || caller.department);

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

    if (action === "BATCH_RECURRING_UPSERT") {
      const targetId = String(body?.instructor_id || caller.userId);
      if (targetId !== caller.userId && !canManageTeam) {
        return apiFail("본인 또는 권한 있는 구성원만 반복 일정을 등록할 수 있습니다.", 403);
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
      if (!canManageTeam) {
        return apiFail(
          "근무 기록 일괄 업로드는 팀장급 이상 또는 인사관리자만 가능합니다.",
          403
        );
      }

      const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
      if (rows.length === 0) {
        return apiFail("업로드할 유효한 근무 기록 행이 없습니다.");
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
      if (existing.instructor_id !== caller.userId && !canManageTeam) {
        return apiFail("타 구성원의 근무 기록 삭제 권한이 없습니다.", 403);
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
