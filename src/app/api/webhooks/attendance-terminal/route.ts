// src/app/api/webhooks/attendance-terminal/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getMergedIntegrationSettings,
  ingestTerminalAttendanceEvents,
  TERMINAL_PROVIDER_LABELS,
  type RawTerminalPunchEvent,
} from "@/lib/hq/integrationServer";
import { apiFail, getSupabaseAdmin } from "@/lib/hq/serverAuth";
import type { HqAccessTerminalProvider } from "@/lib/hq/types";

export const runtime = "nodejs";

/**
 * ADT 캡스 / 에스원 세콤 / KT텔레캅 로컬 브릿지 · 출입리더기 실시간 웹훅 수신 엔드포인트
 * POST /api/webhooks/attendance-terminal?provider=adt_caps
 * Header: x-terminal-key: <webhook_secret> (또는 query ?key=<webhook_secret>)
 */
export async function POST(req: NextRequest) {
  try {
    const provider = (req.nextUrl.searchParams.get("provider") ||
      "adt_caps") as HqAccessTerminalProvider;
    if (!["secom", "adt_caps", "kt_telecop"].includes(provider)) {
      return apiFail("Invalid terminal provider", 400);
    }

    const incomingKey = (
      req.headers.get("x-terminal-key") ||
      req.nextUrl.searchParams.get("key") ||
      ""
    ).trim();

    const supabaseAdmin = getSupabaseAdmin();
    const { integrations } = await getMergedIntegrationSettings(supabaseAdmin);
    const cfg = integrations[provider];

    if (!cfg.enabled) {
      return apiFail(
        `${TERMINAL_PROVIDER_LABELS[provider]} 연동이 비활성화 상태입니다.`,
        403
      );
    }

    if (!incomingKey || incomingKey !== cfg.webhook_secret) {
      return apiFail("유효하지 않은 단말기 인증 키(webhook_secret)입니다.", 401);
    }

    const body = await req.json();
    const list: any[] = Array.isArray(body?.events)
      ? body.events
      : body && typeof body === "object"
        ? [body]
        : [];

    const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
    const fallbackDate = nowKst.toISOString().slice(0, 10);
    const fallbackTime = nowKst.toISOString().slice(11, 19);

    const normalized: RawTerminalPunchEvent[] = list.map((item) => ({
      work_date: String(
        item.work_date || item.date || item.event_date || fallbackDate
      ),
      time_str: String(
        item.time_str || item.time || item.event_time || fallbackTime
      ),
      user_no: String(
        item.user_no || item.card_no || item.emp_no || item.id || ""
      ),
      user_name: String(item.user_name || item.name || ""),
      mode: String(item.mode || item.event_type || ""),
    }));

    const result = await ingestTerminalAttendanceEvents(
      supabaseAdmin,
      provider,
      normalized
    );

    return NextResponse.json({
      success: true,
      provider,
      data: result,
    });
  } catch (e: any) {
    console.error("Terminal webhook POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
