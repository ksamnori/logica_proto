// src/app/api/hq/meetings/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readHqKvPayload, writeHqKvPayload } from "@/lib/hq/hqKvStoreServer";
import {
  apiFail,
  getSupabaseAdmin,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type {
  HqMeetingAttendee,
  HqMeetingItem,
  HqMeetingRsvpStatus,
} from "@/lib/hq/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEETINGS_SETTING_KEY = "HQ_MEETINGS";
const MEETINGS_STORAGE_PATH = "hq_system_config/meetings.json";

interface StoredMeetingsPayload {
  meetings: HqMeetingItem[];
}

async function readMeetingsPayload(
  supabaseAdmin: SupabaseClient
): Promise<StoredMeetingsPayload> {
  const raw = await readHqKvPayload<{ meetings?: HqMeetingItem[] }>(
    supabaseAdmin,
    MEETINGS_SETTING_KEY,
    MEETINGS_STORAGE_PATH
  ).catch(() => null);

  return {
    meetings: Array.isArray(raw?.meetings) ? raw.meetings : [],
  };
}

async function writeMeetingsPayload(
  supabaseAdmin: SupabaseClient,
  payload: StoredMeetingsPayload
): Promise<void> {
  await writeHqKvPayload(
    supabaseAdmin,
    MEETINGS_SETTING_KEY,
    payload,
    MEETINGS_STORAGE_PATH
  );
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const payload = await readMeetingsPayload(supabaseAdmin);

    return NextResponse.json({
      success: true,
      data: {
        meetings: payload.meetings,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return apiFail(msg, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const body = await req.json();
    const action = String(body?.action || "SAVE").toUpperCase();
    const supabaseAdmin = getSupabaseAdmin();
    const payload = await readMeetingsPayload(supabaseAdmin);
    const nowIso = new Date().toISOString();

    if (action === "SAVE") {
      const id = String(body?.id || "").trim();
      const title = String(body?.title || "").trim();
      if (!title) return apiFail("미팅 제목을 입력해 주세요.");

      const hasSchedule = body?.has_schedule !== false;
      const rawStartAt = hasSchedule ? String(body?.start_at || "").trim() : "";
      const rawEndAt = hasSchedule ? String(body?.end_at || "").trim() : "";

      if (hasSchedule) {
        if (!rawStartAt || Number.isNaN(new Date(rawStartAt).getTime())) {
          return apiFail("미팅 시작 일시를 올바르게 선택해 주세요.");
        }
        if (rawEndAt && Number.isNaN(new Date(rawEndAt).getTime())) {
          return apiFail("미팅 종료 일시를 올바르게 선택해 주세요.");
        }
      }

      const startAt = hasSchedule ? rawStartAt || null : null;
      const endAt = hasSchedule ? rawEndAt || null : null;
      const locationOrUrl = String(body?.location_or_url || "").trim();
      const agenda = String(body?.agenda || "").trim();
      const summaryNotes = String(body?.summary_notes || "").trim();

      const rawAttendees: HqMeetingAttendee[] = Array.isArray(body?.attendees)
        ? body.attendees
            .map((a: Record<string, unknown>) => ({
              member_id: a?.member_id ? String(a.member_id) : undefined,
              name: String(a?.name || "").trim(),
              department: a?.department ? String(a.department) : undefined,
              rsvp: (["ATTENDING", "MAYBE", "DECLINED"].includes(
                String(a?.rsvp || "")
              )
                ? String(a.rsvp)
                : "ATTENDING") as HqMeetingRsvpStatus,
            }))
            .filter((a: HqMeetingAttendee) => a.name.length > 0)
        : [];

      // 참석자가 한 명도 선택되지 않았으면 주최자를 기본 참석자로 포함
      if (rawAttendees.length === 0) {
        rawAttendees.push({
          member_id: caller.userId,
          name: caller.name,
          department: caller.department,
          rsvp: "ATTENDING",
        });
      }

      if (id) {
        const idx = payload.meetings.findIndex((m) => m.id === id);
        if (idx === -1) return apiFail("수정할 미팅을 찾을 수 없습니다.", 404);
        const prev = payload.meetings[idx];
        const canEditFull =
          prev.organizer_id === caller.userId ||
          prev.organizer_name === caller.name ||
          caller.isHrManager ||
          caller.isHqAdmin;

        if (!canEditFull) {
          // 일반 참석자는 회의록 요약만 업데이트 가능
          payload.meetings[idx] = {
            ...prev,
            summary_notes: summaryNotes,
            updated_at: nowIso,
          };
        } else {
          payload.meetings[idx] = {
            ...prev,
            title,
            has_schedule: hasSchedule,
            start_at: startAt,
            end_at: endAt,
            location_or_url: locationOrUrl,
            attendees: rawAttendees,
            agenda,
            summary_notes: summaryNotes,
            updated_at: nowIso,
          };
        }
      } else {
        const created: HqMeetingItem = {
          id: `mtg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title,
          has_schedule: hasSchedule,
          start_at: startAt,
          end_at: endAt,
          location_or_url: locationOrUrl,
          organizer_id: caller.userId,
          organizer_name: caller.name,
          organizer_dept: caller.department,
          attendees: rawAttendees,
          agenda,
          summary_notes: summaryNotes,
          created_at: nowIso,
          updated_at: nowIso,
        };
        payload.meetings.unshift(created);
      }

      await writeMeetingsPayload(supabaseAdmin, payload);
      return NextResponse.json({
        success: true,
        data: { meetings: payload.meetings },
      });
    }

    if (action === "RSVP") {
      const id = String(body?.id || "").trim();
      const rsvp = String(body?.rsvp || "ATTENDING") as HqMeetingRsvpStatus;
      if (!["ATTENDING", "MAYBE", "DECLINED"].includes(rsvp)) {
        return apiFail("올바르지 않은 참석 상태입니다.");
      }

      const idx = payload.meetings.findIndex((m) => m.id === id);
      if (idx === -1) return apiFail("미팅을 찾을 수 없습니다.", 404);

      const target = payload.meetings[idx];
      const nextAttendees = [...target.attendees];
      const attIdx = nextAttendees.findIndex(
        (a) => a.member_id === caller.userId || a.name === caller.name
      );
      if (attIdx >= 0) {
        nextAttendees[attIdx] = { ...nextAttendees[attIdx], rsvp };
      } else {
        nextAttendees.push({
          member_id: caller.userId,
          name: caller.name,
          department: caller.department,
          rsvp,
        });
      }

      payload.meetings[idx] = {
        ...target,
        attendees: nextAttendees,
        updated_at: nowIso,
      };
      await writeMeetingsPayload(supabaseAdmin, payload);
      return NextResponse.json({
        success: true,
        data: { meetings: payload.meetings },
      });
    }

    if (action === "DELETE") {
      const id = String(body?.id || "").trim();
      const target = payload.meetings.find((m) => m.id === id);
      if (!target) return apiFail("삭제할 미팅을 찾을 수 없습니다.", 404);

      const canDelete =
        target.organizer_id === caller.userId ||
        target.organizer_name === caller.name ||
        caller.isHrManager ||
        caller.isHqAdmin;
      if (!canDelete) {
        return apiFail("미팅 주최자 또는 관리자만 삭제할 수 있습니다.", 403);
      }

      payload.meetings = payload.meetings.filter((m) => m.id !== id);
      await writeMeetingsPayload(supabaseAdmin, payload);
      return NextResponse.json({
        success: true,
        data: { meetings: payload.meetings },
      });
    }

    return apiFail("지원하지 않는 미팅 요청입니다.");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return apiFail(msg, 500);
  }
}
