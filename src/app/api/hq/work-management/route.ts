// src/app/api/hq/work-management/route.ts
import { NextRequest, NextResponse } from "next/server";
import { appendHqAuditLog } from "@/lib/hq/auditLogServer";
import {
  readLeavesLedgerServer,
  readWorkMgmtStateServer,
  writeLeavesLedgerServer,
  writeWorkMgmtStateServer,
} from "@/lib/hq/leavesLedgerServer";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type {
  HqAttendanceLockItem,
  HqCompLeaveGrantItem,
  HqHolidaySubstituteItem,
} from "@/lib/hq/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const startParam = req.nextUrl.searchParams.get("start_date") || "";
    const endParam = req.nextUrl.searchParams.get("end_date") || "";

    const supabaseAdmin = getSupabaseAdmin();
    const state = await readWorkMgmtStateServer(supabaseAdmin);

    let attendanceRows: any[] = [];
    let pendingLeaveDocs: any[] = [];

    if (
      /^\d{4}-\d{2}-\d{2}$/.test(startParam) &&
      /^\d{4}-\d{2}-\d{2}$/.test(endParam) &&
      !caller.schemaMissing
    ) {
      // 전주/전월 비교용으로 시작일 14일 전 데이터까지 함께 조회
      const [sy, sm, sd] = startParam.split("-").map(Number);
      const prevDt = new Date(Date.UTC(sy, (sm || 1) - 1, (sd || 1) - 14));
      const fetchStart = prevDt.toISOString().slice(0, 10);

      const [attRes, docRes] = await Promise.all([
        supabaseAdmin
          .from("hq_attendance")
          .select("*")
          .gte("work_date", fetchStart)
          .lte("work_date", endParam)
          .order("work_date", { ascending: true }),
        supabaseAdmin
          .from("hq_approval_doc")
          .select(
            "approval_id, drafter_id, drafter_name, drafter_dept, doc_type, status, effective_date, end_date, leave_type, leave_days, receipt_url"
          )
          .lte("effective_date", endParam)
          .gte("effective_date", fetchStart),
      ]);

      if (!attRes.error) {
        attendanceRows = attRes.data || [];
      } else if (!isMissingHqTableError(attRes.error)) {
        return apiFail(attRes.error.message, 500);
      }

      if (!docRes.error) {
        pendingLeaveDocs = docRes.data || [];
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        canManage:
          caller.isHrManager || caller.isHqAdmin || caller.rankLevel >= 3,
        compGrants: state.compGrants,
        holidaySubstitutes: state.holidaySubstitutes,
        attendanceLocks: state.attendanceLocks,
        attendanceRows,
        approvalDocs: pendingLeaveDocs,
      },
    });
  } catch (e: any) {
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const canManage =
      caller.isHrManager || caller.isHqAdmin || caller.rankLevel >= 3;
    if (!canManage) {
      return apiFail(
        "근무 관리 처리는 팀장급 이상 또는 인사관리자만 가능합니다.",
        403
      );
    }

    const body = await req.json();
    const action = String(body?.action || "").toUpperCase();
    const supabaseAdmin = getSupabaseAdmin();
    const state = await readWorkMgmtStateServer(supabaseAdmin);
    const nowIso = new Date().toISOString();

    if (action === "GRANT_COMP_LEAVE" || action === "BATCH_GRANT_COMP_LEAVE") {
      const items: {
        member_id: string;
        member_name: string;
        department: string;
        period_start: string;
        period_end: string;
        overtime_minutes: number;
        granted_minutes: number;
        overtime_category?: string;
      }[] =
        action === "BATCH_GRANT_COMP_LEAVE" && Array.isArray(body?.items)
          ? body.items
          : [body];

      const validItems = items.filter(
        (it) => it?.member_id && Number(it?.granted_minutes) > 0
      );
      if (validItems.length === 0) {
        return apiFail("보상 휴가를 부여할 대상 또는 시간이 없습니다.");
      }

      const leavesLedger = await readLeavesLedgerServer(supabaseAdmin);

      validItems.forEach((it, idx) => {
        const gMin = Math.round(Number(it.granted_minutes));
        const grantEntry: HqCompLeaveGrantItem = {
          id: `compg-${Date.now()}-${idx}`,
          member_id: String(it.member_id),
          member_name: String(it.member_name || ""),
          department: String(it.department || ""),
          period_start: String(it.period_start || ""),
          period_end: String(it.period_end || ""),
          overtime_minutes: Math.round(Number(it.overtime_minutes || gMin)),
          granted_minutes: gMin,
          overtime_category: String(
            it.overtime_category || "법정근로내 연장"
          ),
          actor_name: caller.name,
          created_at: nowIso,
        };
        state.compGrants.unshift(grantEntry);

        // 휴가 관리 > 보상 휴가(cl-reward) 보유량에도 시간->일(8h=1일) 환산 반영
        leavesLedger.customGrants.unshift({
          id: `clg-comp-${Date.now()}-${idx}`,
          member_id: String(it.member_id),
          member_name: String(it.member_name || ""),
          leave_id: "cl-reward",
          leave_name: "보상",
          granted_amount: Math.round((gMin / 480) * 100) / 100,
          reason: `초과근무 보상휴가 부여 (${it.period_start}~${it.period_end})`,
          actor_name: caller.name,
          created_at: nowIso,
        });
      });

      await Promise.all([
        writeWorkMgmtStateServer(supabaseAdmin, state),
        writeLeavesLedgerServer(supabaseAdmin, leavesLedger),
      ]);

      return NextResponse.json({
        success: true,
        data: { compGrants: state.compGrants, count: validItems.length },
      });
    }

    if (action === "SET_HOLIDAY_SUBSTITUTE") {
      const memberId = String(body?.member_id || "").trim();
      const memberName = String(body?.member_name || "").trim();
      const department = String(body?.department || "").trim();
      const holidayDate = String(body?.holiday_date || "").trim();
      const holidayKind = String(body?.holiday_kind || "주휴일").trim();
      const substituteDate = String(body?.substitute_date || "").trim();
      const workedMinutes = Number(body?.worked_minutes || 0);
      const memo = String(body?.memo || "").trim();

      if (!memberId || !holidayDate || !substituteDate) {
        return apiFail("대상 구성원, 원래 휴일, 대체 휴무일을 모두 입력해 주세요.");
      }

      const existingIdx = state.holidaySubstitutes.findIndex(
        (h) => h.member_id === memberId && h.holiday_date === holidayDate
      );
      const item: HqHolidaySubstituteItem = {
        id:
          existingIdx >= 0
            ? state.holidaySubstitutes[existingIdx].id
            : `hsub-${Date.now()}`,
        member_id: memberId,
        member_name: memberName,
        department,
        holiday_date: holidayDate,
        holiday_kind: holidayKind,
        substitute_date: substituteDate,
        worked_minutes: workedMinutes,
        memo,
        actor_name: caller.name,
        created_at: nowIso,
      };

      if (existingIdx >= 0) {
        state.holidaySubstitutes[existingIdx] = item;
      } else {
        state.holidaySubstitutes.unshift(item);
      }

      await writeWorkMgmtStateServer(supabaseAdmin, state);

      // 대체 휴무일에 hq_attendance 휴무 기록 자동 반영
      try {
        await supabaseAdmin.from("hq_attendance").upsert(
          {
            instructor_id: memberId,
            member_name: memberName,
            department,
            work_date: substituteDate,
            work_mode: "LEAVE",
            status: "LEAVE",
            worked_minutes: 0,
            overtime_minutes: 0,
            location_note: `휴일대체 (${holidayDate})`,
            memo: memo || `${holidayDate} ${holidayKind} 대체 휴무일`,
            updated_at: nowIso,
          },
          { onConflict: "instructor_id,work_date" }
        );
      } catch {
        // ignore if attendance table missing
      }

      return NextResponse.json({
        success: true,
        data: { holidaySubstitutes: state.holidaySubstitutes },
      });
    }

    if (action === "ADD_LOCK") {
      const title = String(body?.title || "").trim() || "정기 근태 마감";
      const startDate = String(body?.start_date || "").trim();
      const endDate = String(body?.end_date || "").trim();
      const targetScope = body?.target_scope === "DEPT" ? "DEPT" : "ALL";
      const targetDepartments: string[] = Array.isArray(body?.target_departments)
        ? body.target_departments.map(String)
        : [];

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
        startDate > endDate
      ) {
        return apiFail("유효한 마감 시작일과 종료일을 입력해 주세요.");
      }

      const lockItem: HqAttendanceLockItem = {
        id: `lock-${Date.now()}`,
        title,
        start_date: startDate,
        end_date: endDate,
        target_scope: targetScope,
        target_departments: targetDepartments,
        locked_by: caller.name,
        locked_at: nowIso,
      };
      state.attendanceLocks.unshift(lockItem);
      await writeWorkMgmtStateServer(supabaseAdmin, state);

      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "개인정보 접근",
        user_id: caller.userId,
        user_name: caller.name,
        user_email: caller.email,
        department: caller.department,
        event_type: "생성",
        info_type: "근무정보",
        description: `근태 마감 설정 (${title}: ${startDate} ~ ${endDate})`,
        delegated: caller.isDelegatedHrAdmin,
      }).catch(() => {});

      return NextResponse.json({
        success: true,
        data: { attendanceLocks: state.attendanceLocks },
      });
    }

    if (action === "DELETE_LOCK") {
      const id = String(body?.id || "").trim();
      state.attendanceLocks = state.attendanceLocks.filter((l) => l.id !== id);
      await writeWorkMgmtStateServer(supabaseAdmin, state);
      return NextResponse.json({
        success: true,
        data: { attendanceLocks: state.attendanceLocks },
      });
    }

    return apiFail("지원하지 않는 근무 관리 요청입니다.");
  } catch (e: any) {
    return apiFail(String(e?.message || e), 500);
  }
}
