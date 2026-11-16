// src/app/api/hq/audit-logs/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  appendHqAuditLog,
  extractClientIp,
  readHqAuditLogs,
  readLoginAttemptRecords,
} from "@/lib/hq/auditLogServer";
import {
  apiFail,
  getSupabaseAdmin,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqAuditActivityType, HqAuditEventType } from "@/lib/hq/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const mode = req.nextUrl.searchParams.get("mode");
    const clientIp = extractClientIp(req);

    if (mode === "my-ip") {
      return NextResponse.json({
        success: true,
        data: { ip: clientIp },
      });
    }

    if (!caller.isHrManager && !caller.isHqAdmin) {
      return apiFail(
        "감사 로그는 인사관리자 또는 최고관리자만 조회할 수 있습니다.",
        403
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    let logs = await readHqAuditLogs(supabaseAdmin);

    if (logs.length === 0) {
      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "인증",
        user_id: caller.userId,
        user_name: caller.name,
        user_email: caller.email,
        department: caller.department,
        event_type: "생성",
        info_type: "-",
        description: "로그인 성공 · 세션 활성",
        delegated: caller.isDelegatedHrAdmin,
      });
      logs = await readHqAuditLogs(supabaseAdmin);
    }

    const attemptMap = await readLoginAttemptRecords(supabaseAdmin);
    const nowMs = Date.now();
    const lockedAccounts = Object.values(attemptMap).filter(
      (rec) => rec.locked_until && new Date(rec.locked_until).getTime() > nowMs
    );

    return NextResponse.json({
      success: true,
      data: {
        ip: clientIp,
        logs,
        lockedAccounts,
      },
    });
  } catch (e: any) {
    console.error("HQ audit-logs GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const body = await req.json();
    const activityType = (body?.activity_type ||
      "개인정보 접근") as HqAuditActivityType;
    const eventType = (body?.event_type || "조회") as HqAuditEventType;
    const infoType = String(body?.info_type || "-");
    const description = String(body?.description || "HQ 활동 기록").slice(
      0,
      200
    );

    const supabaseAdmin = getSupabaseAdmin();
    await appendHqAuditLog(supabaseAdmin, req, {
      activity_type: activityType,
      user_id: caller.userId,
      user_name: caller.name,
      user_email: caller.email,
      department: caller.department,
      event_type: eventType,
      info_type: infoType,
      description,
      delegated: caller.isDelegatedHrAdmin,
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("HQ audit-logs POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
