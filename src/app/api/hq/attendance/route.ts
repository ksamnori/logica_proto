// src/app/api/hq/attendance/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ATTENDANCE_MODES } from "@/lib/hq/constants";
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

function calcWorkedMinutes(
  checkInIso: string | null,
  checkOutIso: string | null,
  customBreakMinutes?: number
): { breakMinutes: number; workedMinutes: number; overtimeMinutes: number } {
  if (!checkInIso || !checkOutIso) {
    return { breakMinutes: 60, workedMinutes: 0, overtimeMinutes: 0 };
  }
  const inMs = new Date(checkInIso).getTime();
  const outMs = new Date(checkOutIso).getTime();
  if (Number.isNaN(inMs) || Number.isNaN(outMs) || outMs <= inMs) {
    return { breakMinutes: 0, workedMinutes: 0, overtimeMinutes: 0 };
  }
  const grossMin = Math.round((outMs - inMs) / 60000);
  const autoBreak =
    typeof customBreakMinutes === "number"
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
    const monthParam = req.nextUrl.searchParams.get("month") || currentMonth;
    const [yearStr, monStr] = monthParam.split("-");
    const year = Number(yearStr) || new Date().getFullYear();
    const mon = Number(monStr) || new Date().getMonth() + 1;
    const monthStart = `${year}-${String(mon).padStart(2, "0")}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const monthEnd = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const minDate = monthStart < weekStartStr ? monthStart : weekStartStr;
    const maxDate = monthEnd > weekEndStr ? monthEnd : weekEndStr;

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("hq_attendance")
      .select("*")
      .gte("work_date", minDate <= todayStr ? minDate : todayStr)
      .lte("work_date", maxDate >= todayStr ? maxDate : todayStr)
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
            myToday: null,
            myWeeklyMinutes: 0,
            todayRecords: [],
            weeklySummary: {},
            records: [],
          },
        });
      }
      return apiFail(`근태 내역 조회 실패: ${error.message}`, 500);
    }

    const allRows = data || [];
    const nowMs = Date.now();

    // 오늘 전사 근무 현황 (15인 출판사 협업용 — 전원 공유)
    const todayRecords = allRows.filter((r: any) => r.work_date === todayStr);
    const myToday =
      todayRecords.find((r: any) => r.instructor_id === caller.userId) || null;

    // 이번 주 구성원별 누적 근무시간(분) 계산 (현재 WORKING 상태면 실시간 경과분 반영)
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

    const canViewAllLogs = caller.isHrManager || caller.rankLevel >= 3;
    const monthRecords = allRows.filter((r: any) => {
      if (r.work_date < monthStart || r.work_date > monthEnd) return false;
      if (canViewAllLogs) return true;
      return r.instructor_id === caller.userId;
    });

    return NextResponse.json({
      success: true,
      schemaMissing: false,
      data: {
        todayStr,
        weekStartStr,
        weekEndStr,
        myToday,
        myWeeklyMinutes: weeklySummary[caller.userId] || 0,
        todayRecords,
        weeklySummary,
        records: monthRecords,
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
        nowIso
      );

      const nextMemo = body?.memo
        ? String(body.memo).trim()
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
          memo: body?.memo !== undefined ? String(body.memo).trim() || null : undefined,
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
      if (targetId !== caller.userId && !caller.isHrManager && caller.rankLevel < 3) {
        return apiFail("타 구성원의 근태 보정은 팀장급 이상 또는 인사담당자만 가능합니다.", 403);
      }

      const workDate = String(body?.work_date || todayStr);
      const workMode = (body?.work_mode || "OFFICE") as HqWorkMode;
      const inTime = String(body?.check_in_time || "").trim(); // "09:00"
      const outTime = String(body?.check_out_time || "").trim(); // "18:00"

      const checkInIso = inTime ? `${workDate}T${inTime}:00+09:00` : null;
      const checkOutIso = outTime ? `${workDate}T${outTime}:00+09:00` : null;

      const isLeave = workMode === "LEAVE";
      const calc = isLeave
        ? { breakMinutes: 0, workedMinutes: 0, overtimeMinutes: 0 }
        : calcWorkedMinutes(
            checkInIso,
            checkOutIso,
            body?.break_minutes !== undefined ? Number(body.break_minutes) : undefined
          );

      const status: HqAttendanceStatus = isLeave
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

      if (saveErr) return apiFail(`근태 정정 저장 실패: ${saveErr.message}`, 500);
      return NextResponse.json({ success: true, data: saved });
    }

    return apiFail("지원하지 않는 근태 요청입니다.");
  } catch (e: any) {
    console.error("HQ attendance POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
