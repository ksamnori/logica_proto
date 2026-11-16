// src/app/api/hq/integrations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { appendHqAuditLog } from "@/lib/hq/auditLogServer";
import {
  batchSyncHqToGoogleCalendar,
  ingestTerminalAttendanceEvents,
  sendSlackWebhookMessage,
  TERMINAL_PROVIDER_LABELS,
  testGoogleCalendarConnection,
  type RawTerminalPunchEvent,
} from "@/lib/hq/integrationServer";
import {
  apiFail,
  getSupabaseAdmin,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqAccessTerminalProvider } from "@/lib/hq/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const hasGoogleServiceAccount = Boolean(
      process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY
    );

    return NextResponse.json({
      success: true,
      data: {
        hasGoogleServiceAccount,
        serviceAccountEmail: process.env.GOOGLE_CLIENT_EMAIL || "",
        defaultTargetCalendarId: process.env.TARGET_CALENDAR_ID || "",
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

    if (!caller.isHrManager && !caller.isHqAdmin) {
      return apiFail(
        "외부 서비스 연동 테스트 및 동기화는 인사관리자·최고관리자만 실행할 수 있습니다.",
        403
      );
    }

    const body = await req.json();
    const action = String(body?.action || "");
    const supabaseAdmin = getSupabaseAdmin();

    if (action === "TEST_GCAL") {
      const calendarId = String(body?.calendar_id || "");
      const res = await testGoogleCalendarConnection(calendarId);
      return NextResponse.json({
        success: true,
        data: res,
      });
    }

    if (action === "SYNC_GCAL_NOW") {
      const calendarId = String(body?.calendar_id || "");
      const res = await batchSyncHqToGoogleCalendar(supabaseAdmin, calendarId);
      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "개인정보 접근",
        user_id: caller.userId,
        user_name: caller.name,
        user_email: caller.email,
        department: caller.department,
        event_type: "생성",
        info_type: "휴가정보",
        description: `Google Calendar(${res.calendarSummary}) 일정 수동 동기화 (${res.syncedCount}건 추가)`,
        delegated: caller.isDelegatedHrAdmin,
      });
      return NextResponse.json({
        success: true,
        data: res,
      });
    }

    if (action === "TEST_SLACK") {
      const webhookUrl = String(body?.webhook_url || "");
      const channelName = String(body?.channel_name || "#본사-근태알림");
      await sendSlackWebhookMessage(
        webhookUrl,
        `✅ *[천종현수학연구소 HQ]* Slack 연동 테스트 메시지입니다.\n• 채널 표기: ${channelName}\n• 테스트 실행자: ${caller.name} (${caller.jobTitle})`
      );
      return NextResponse.json({ success: true });
    }

    if (action === "IMPORT_TERMINAL") {
      const provider = (body?.provider ||
        "adt_caps") as HqAccessTerminalProvider;
      if (!["secom", "adt_caps", "kt_telecop"].includes(provider)) {
        return apiFail("지원하지 않는 출입단말기 제조사입니다.");
      }

      const rawEvents: RawTerminalPunchEvent[] = Array.isArray(body?.events)
        ? body.events
        : [];
      if (rawEvents.length === 0) {
        return apiFail("반영할 출입 기록 데이터가 없습니다.");
      }

      const result = await ingestTerminalAttendanceEvents(
        supabaseAdmin,
        provider,
        rawEvents
      );

      await appendHqAuditLog(supabaseAdmin, req, {
        activity_type: "개인정보 접근",
        user_id: caller.userId,
        user_name: caller.name,
        user_email: caller.email,
        department: caller.department,
        event_type: "생성",
        info_type: "근무정보",
        description: `${TERMINAL_PROVIDER_LABELS[provider]} 출입단말기 기록 근태 반영 (${result.upsertedDays}건 처리)`,
        delegated: caller.isDelegatedHrAdmin,
      });

      return NextResponse.json({
        success: true,
        data: result,
      });
    }

    return apiFail("알 수 없는 연동 요청입니다.");
  } catch (e: any) {
    console.error("HQ integrations POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
