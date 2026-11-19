// src/app/api/hq/calendar/route.ts
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { ATTENDANCE_MODES, FALLBACK_HQ_TENANT_ID } from "@/lib/hq/constants";
import { readHqKvPayload } from "@/lib/hq/hqKvStoreServer";
import {
  getMergedIntegrationSettings,
  resolveHqCalendarId,
} from "@/lib/hq/integrationServer";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqMeetingItem, HqWorkMode } from "@/lib/hq/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type HqCalendarCategory =
  | "GOOGLE"
  | "LEAVE"
  | "REMOTE"
  | "MEETING"
  | "PUBLISHING"
  | "HOLIDAY"
  | "BIRTHDAY";

export interface HqCalendarEventItem {
  id: string;
  category: HqCalendarCategory;
  title: string;
  subtitle?: string;
  description?: string;
  startDate: string; // YYYY-MM-DD (inclusive)
  endDate: string; // YYYY-MM-DD (inclusive)
  timeLabel?: string;
  isMultiDay: boolean;
  statusLabel?: string;
  linkPath?: string;
  externalUrl?: string | null;
}

const MEETINGS_SETTING_KEY = "HQ_MEETINGS";
const MEETINGS_STORAGE_PATH = "hq_system_config/meetings.json";

function getGoogleCalendarClientOrNull() {
  const clientEmail = (process.env.GOOGLE_CLIENT_EMAIL || "").trim();
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(
    /\\n/g,
    "\n"
  );
  if (!clientEmail || !privateKey) return null;
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

function toKstYmd(isoOrDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) return isoOrDate;
  const dt = new Date(isoOrDate);
  if (Number.isNaN(dt.getTime())) return isoOrDate.slice(0, 10);
  const kst = new Date(dt.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function formatKstHm(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const kst = new Date(dt.getTime() + 9 * 60 * 60 * 1000);
  const h24 = kst.getUTCHours();
  const m = String(kst.getUTCMinutes()).padStart(2, "0");
  const ampm = h24 >= 12 ? "오후" : "오전";
  const h12 = h24 % 12 || 12;
  return `${ampm} ${h12}:${m}`;
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, (d || 1) + delta));
  return dt.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const defaultYear = kstNow.getUTCFullYear();
    const defaultMonth = kstNow.getUTCMonth() + 1;

    const year =
      Number(req.nextUrl.searchParams.get("year")) || defaultYear;
    const month =
      Number(req.nextUrl.searchParams.get("month")) || defaultMonth;

    // 조회 월 기준 -1개월 1일 ~ +2개월 말일 범위 조회 (월 경계 걸침 및 다가오는 일정 지원)
    const winStartDt = new Date(Date.UTC(year, month - 2, 1));
    const winEndDt = new Date(Date.UTC(year, month + 2, 0));
    const windowStart = winStartDt.toISOString().slice(0, 10);
    const windowEnd = winEndDt.toISOString().slice(0, 10);

    const supabaseAdmin = getSupabaseAdmin();
    const { integrations, holidaysByYear } =
      await getMergedIntegrationSettings(supabaseAdmin);

    const gcalCfg = integrations.google_calendar;
    const customCalId = (gcalCfg.calendar_id || "").trim();
    const envCalId = (process.env.TARGET_CALENDAR_ID || "").trim();
    // 본부 캘린더(01000math@gmail.com 등) 우선 — 학원 공용 캘린더로 폴백하지 않음
    const targetCalId = resolveHqCalendarId(customCalId);
    const isAcademySharedCalendar = Boolean(envCalId) && targetCalId === envCalId;
    const usingSavedHqCalendar =
      Boolean(customCalId) && customCalId === targetCalId;
    const hqPrefix = (gcalCfg.event_prefix || "[HQ]").trim();

    let googleConnected = false;
    let googleError: string | null = null;
    const googleEvents: HqCalendarEventItem[] = [];

    const gcalClient = targetCalId ? getGoogleCalendarClientOrNull() : null;
    if (gcalClient && targetCalId) {
      try {
        const res = await gcalClient.events.list({
          calendarId: targetCalId,
          timeMin: `${windowStart}T00:00:00+09:00`,
          timeMax: `${windowEnd}T23:59:59+09:00`,
          maxResults: 350,
          singleEvents: true,
          orderBy: "startTime",
        });
        googleConnected = true;
        for (const ev of res.data.items || []) {
          const summary = String(ev.summary || "").trim();
          // HQ 자동 동기화 항목([HQ])은 본부 내부 데이터에서 더 상세히 보여주므로 중복 제외
          if (hqPrefix && summary.startsWith(hqPrefix)) continue;
          // 학원 공용 캘린더를 보는 경우에만 학원 자동 로그([Logica]) 제외
          if (isAcademySharedCalendar && summary.startsWith("[Logica]")) continue;

          const rawStart = ev.start?.dateTime || ev.start?.date || "";
          const rawEnd = ev.end?.dateTime || ev.end?.date || rawStart;
          if (!rawStart) continue;

          const startDate = toKstYmd(rawStart);
          let endDate = toKstYmd(rawEnd);
          let timeLabel = "종일";

          if (ev.start?.dateTime && ev.end?.dateTime) {
            timeLabel = `${formatKstHm(ev.start.dateTime)} ~ ${formatKstHm(
              ev.end.dateTime
            )}`;
          } else if (ev.end?.date) {
            // Google 종일 일정의 end.date는 익일(exclusive)이므로 -1일 보정
            const adjusted = addDaysYmd(ev.end.date.slice(0, 10), -1);
            endDate = adjusted >= startDate ? adjusted : startDate;
          }

          googleEvents.push({
            id: `gcal-${ev.id || Math.random().toString(36).slice(2)}`,
            category: "GOOGLE",
            title: summary || "(제목 없음)",
            subtitle: ev.location ? `📍 ${ev.location}` : "Google 캘린더",
            description: ev.description || undefined,
            startDate,
            endDate,
            timeLabel,
            isMultiDay: endDate > startDate,
            externalUrl: ev.htmlLink || null,
          });
        }
      } catch (err: any) {
        googleError = String(err?.message || "Google 캘린더 조회 실패");
      }
    }

    // 본부 구성원 목록 (이름·부서·생일 매핑용)
    const hqTenantIds = Array.from(caller.hqTenantIds);
    if (hqTenantIds.length === 0) hqTenantIds.push(FALLBACK_HQ_TENANT_ID);

    const [
      instRes,
      profRes,
      aprRes,
      attRes,
      pubRes,
      meetingsPayload,
    ] = await Promise.all([
      supabaseAdmin
        .from("instructor")
        .select("instructor_id, name, department, position, chat_position, tenant_id, role, status")
        .neq("status", "퇴사")
        .neq("status", "퇴직"),
      supabaseAdmin
        .from("hq_member_profile")
        .select("instructor_id, department, job_title, work_status, birth_date, profile_extra"),
      supabaseAdmin
        .from("hq_approval_doc")
        .select(
          "approval_id, drafter_id, drafter_name, drafter_dept, doc_type, title, status, effective_date, end_date, leave_type, leave_days"
        )
        .in("status", ["APPROVED", "PENDING", "IN_PROGRESS"])
        .lte("effective_date", windowEnd)
        .order("effective_date", { ascending: true })
        .limit(400),
      supabaseAdmin
        .from("hq_attendance")
        .select("attendance_id, instructor_id, work_date, work_mode, status, location_note")
        .gte("work_date", windowStart)
        .lte("work_date", windowEnd)
        .in("work_mode", ["REMOTE", "FIELD", "STAGGERED"]),
      supabaseAdmin
        .from("hq_publication")
        .select("pub_id, title, subject_line, author_name, editor_name, stage, press_deadline")
        .neq("stage", "PUBLISHED")
        .gte("press_deadline", windowStart)
        .lte("press_deadline", windowEnd),
      readHqKvPayload<{ meetings?: HqMeetingItem[] }>(
        supabaseAdmin,
        MEETINGS_SETTING_KEY,
        MEETINGS_STORAGE_PATH
      ).catch(() => null),
    ]);

    const profMap = new Map<string, any>();
    if (!profRes.error && profRes.data) {
      profRes.data.forEach((p: any) => profMap.set(String(p.instructor_id), p));
    }

    const hqMemberMap = new Map<
      string,
      {
        name: string;
        department: string;
        jobTitle: string;
        birthDate: string | null;
        birthIsLunar: boolean;
      }
    >();

    (instRes.data || []).forEach((inst: any) => {
      const id = String(inst.instructor_id);
      const tId = inst.tenant_id ? String(inst.tenant_id) : "";
      const roleUpper = String(inst.role || "").toUpperCase();
      const prof = profMap.get(id);
      const isHq =
        hqTenantIds.includes(tId) || roleUpper === "HQ" || Boolean(prof);
      if (!isHq) return;
      if (prof?.work_status === "퇴직") return;

      const extra =
        prof?.profile_extra && typeof prof.profile_extra === "object"
          ? prof.profile_extra
          : {};
      const isNativeHq = hqTenantIds.includes(tId);
      const isGhost =
        typeof extra.is_ghost === "boolean" ? extra.is_ghost : !isNativeHq;
      if (isGhost) return;

      hqMemberMap.set(id, {
        name: inst.name || "구성원",
        department: (prof?.department || inst.department || "본부").trim(),
        jobTitle: prof?.job_title || inst.chat_position || inst.position || "",
        birthDate: prof?.birth_date ? String(prof.birth_date).slice(0, 10) : null,
        birthIsLunar: Boolean(extra.birth_is_lunar),
      });
    });

    const internalEvents: HqCalendarEventItem[] = [];

    // 1) 휴가 및 외근·출장·재택 결재 문서
    if (!aprRes.error && aprRes.data) {
      for (const doc of aprRes.data as any[]) {
        const sDate = String(doc.effective_date || "").slice(0, 10);
        if (!sDate) continue;
        const eDate = String(doc.end_date || sDate).slice(0, 10);
        if (eDate < windowStart || sDate > windowEnd) continue;

        const isPending = doc.status !== "APPROVED";
        if (doc.doc_type === "LEAVE") {
          internalEvents.push({
            id: `leave-${doc.approval_id}`,
            category: "LEAVE",
            title: `${doc.drafter_name} · ${doc.leave_type || "휴가"}`,
            subtitle: `${doc.drafter_dept || "본부"}${
              doc.leave_days ? ` (${doc.leave_days}일)` : ""
            }`,
            startDate: sDate,
            endDate: eDate >= sDate ? eDate : sDate,
            timeLabel:
              doc.leave_type?.includes("오전")
                ? "오전 반차"
                : doc.leave_type?.includes("오후")
                  ? "오후 반차"
                  : "종일",
            isMultiDay: eDate > sDate,
            statusLabel: isPending ? "결재중" : undefined,
            linkPath: "/hq/leaves",
          });
        } else {
          const t = String(doc.title || "");
          if (
            t.includes("출장") ||
            t.includes("외근") ||
            t.includes("재택") ||
            t.includes("원격")
          ) {
            internalEvents.push({
              id: `workdoc-${doc.approval_id}`,
              category: "REMOTE",
              title: `${doc.drafter_name} · ${t}`,
              subtitle: doc.drafter_dept || "본부",
              startDate: sDate,
              endDate: eDate >= sDate ? eDate : sDate,
              timeLabel: "유연·외근",
              isMultiDay: eDate > sDate,
              statusLabel: isPending ? "결재중" : undefined,
              linkPath: "/hq/attendance",
            });
          }
        }
      }
    }

    // 2) 유연근무(재택원고 · 인쇄감리 외근 · 시차출퇴근) 체크인 기록
    if (!attRes.error && attRes.data) {
      for (const att of attRes.data as any[]) {
        const m = hqMemberMap.get(String(att.instructor_id));
        if (!m) continue;
        const modeMeta =
          ATTENDANCE_MODES[att.work_mode as HqWorkMode] ||
          ATTENDANCE_MODES.REMOTE;
        const wDate = String(att.work_date).slice(0, 10);
        internalEvents.push({
          id: `att-${att.attendance_id}`,
          category: "REMOTE",
          title: `${m.name} · ${modeMeta.shortLabel}`,
          subtitle: att.location_note
            ? `${m.department} · ${att.location_note}`
            : m.department,
          startDate: wDate,
          endDate: wDate,
          timeLabel: modeMeta.shortLabel,
          isMultiDay: false,
          linkPath: "/hq/attendance",
        });
      }
    }

    // 3) 사내 미팅 (HQ_MEETINGS / meetings.json)
    const meetings: HqMeetingItem[] = Array.isArray(meetingsPayload?.meetings)
      ? meetingsPayload.meetings
      : [];
    for (const mtg of meetings) {
      if (!mtg.has_schedule || !mtg.start_at) continue;
      const sDate = toKstYmd(mtg.start_at);
      const eDate = mtg.end_at ? toKstYmd(mtg.end_at) : sDate;
      if (eDate < windowStart || sDate > windowEnd) continue;

      const startHm = formatKstHm(mtg.start_at);
      const endHm = mtg.end_at ? formatKstHm(mtg.end_at) : "";
      internalEvents.push({
        id: `mtg-${mtg.id}`,
        category: "MEETING",
        title: mtg.title,
        subtitle:
          mtg.location_or_url ||
          `${mtg.organizer_name} 주최 (${mtg.attendees?.length || 1}명)`,
        description: mtg.agenda || undefined,
        startDate: sDate,
        endDate: eDate >= sDate ? eDate : sDate,
        timeLabel: endHm ? `${startHm} ~ ${endHm}` : startHm || "시간 미정",
        isMultiDay: eDate > sDate,
        linkPath: "/hq/meetings",
      });
    }

    // 4) 출판 공정 인쇄 하판 마감일
    if (!pubRes.error && pubRes.data) {
      for (const book of pubRes.data as any[]) {
        const pDate = String(book.press_deadline || "").slice(0, 10);
        if (!pDate) continue;
        internalEvents.push({
          id: `pub-${book.pub_id}`,
          category: "PUBLISHING",
          title: `하판 마감 · ${book.title}`,
          subtitle: [
            book.subject_line,
            book.editor_name ? `편집 ${book.editor_name}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          startDate: pDate,
          endDate: pDate,
          timeLabel: "인쇄 하판",
          isMultiDay: false,
          linkPath: "/hq/publishing",
        });
      }
    } else if (pubRes.error && !isMissingHqTableError(pubRes.error)) {
      // non-fatal
    }

    // 5) 법정 공휴일 + 사내 지정 휴무일 & 6) 구성원 생일
    const targetYears = Array.from(
      new Set([
        Number(windowStart.slice(0, 4)),
        year,
        Number(windowEnd.slice(0, 4)),
      ])
    );

    for (const yr of targetYears) {
      const yrHolidays = holidaysByYear[String(yr)] || [];
      for (const h of yrHolidays) {
        const sDate = String(h.start_date || "").slice(0, 10);
        if (!sDate) continue;
        const eDate = String(h.end_date || sDate).slice(0, 10);
        if (eDate < windowStart || sDate > windowEnd) continue;
        internalEvents.push({
          id: `hol-${yr}-${h.id}`,
          category: "HOLIDAY",
          title: `${h.icon || "🎌"} ${h.name}`,
          subtitle: h.is_custom ? "사내 지정 휴무일" : "법정 공휴일",
          startDate: sDate,
          endDate: eDate >= sDate ? eDate : sDate,
          timeLabel: "휴무일",
          isMultiDay: eDate > sDate,
        });
      }

      hqMemberMap.forEach((m, memberId) => {
        if (!m.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(m.birthDate)) return;
        const mmdd = m.birthDate.slice(5, 10);
        // 윤년 2월 29일 생일자는 평년에 2월 28일로 표기
        const isLeapYear = (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
        const projected =
          mmdd === "02-29" && !isLeapYear ? `${yr}-02-28` : `${yr}-${mmdd}`;
        if (projected < windowStart || projected > windowEnd) return;

        internalEvents.push({
          id: `bday-${yr}-${memberId}`,
          category: "BIRTHDAY",
          title: `${m.name} ${m.jobTitle || "님"} 생일${
            m.birthIsLunar ? " (음력)" : ""
          }`,
          subtitle: m.birthIsLunar
            ? `${m.department} · 음력 ${mmdd.replace("-", ".")} 등록`
            : m.department,
          startDate: projected,
          endDate: projected,
          timeLabel: m.birthIsLunar ? "음력 생일" : "생일",
          isMultiDay: false,
        });
      });
    }

    const events = [...googleEvents, ...internalEvents].sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
      return a.category.localeCompare(b.category);
    });

    return NextResponse.json({
      success: true,
      data: {
        googleStatus: {
          configured: Boolean(gcalClient && targetCalId),
          connected: googleConnected,
          usingCustomHqCalendar: !isAcademySharedCalendar,
          calendarId: targetCalId,
          calendarTitle:
            (usingSavedHqCalendar && gcalCfg.verified_calendar_title) ||
            `본부 Google 캘린더 (${targetCalId})`,
          error: googleError,
        },
        events,
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

    const body = await req.json();
    const title = String(body?.title || "").trim();
    const startDate = String(body?.startDate || "").trim();
    const endDate = String(body?.endDate || startDate).trim();
    const startTime = String(body?.startTime || "").trim();
    const endTime = String(body?.endTime || "").trim();
    const location = String(body?.location || "").trim();
    const description = String(body?.description || "").trim();

    if (!title) return apiFail("일정 제목을 입력해 주세요.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return apiFail("시작 날짜 형식이 올바르지 않습니다.");
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { integrations } = await getMergedIntegrationSettings(supabaseAdmin);
    const targetCalId = resolveHqCalendarId(
      integrations.google_calendar.calendar_id
    );

    const gcalClient = targetCalId ? getGoogleCalendarClientOrNull() : null;
    if (!gcalClient || !targetCalId) {
      return apiFail(
        "연결된 Google 캘린더가 없습니다. [설정 > 연결 설정]에서 Google 캘린더 ID를 확인해 주세요.",
        400
      );
    }

    const safeEndDate =
      /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate >= startDate
        ? endDate
        : startDate;

    const isTimed =
      /^\d{2}:\d{2}$/.test(startTime) && /^\d{2}:\d{2}$/.test(endTime);

    const requestBody: any = {
      summary: title,
      location: location || undefined,
      description: [
        description,
        `등록자: ${caller.name} (${caller.department || "본부"})`,
      ]
        .filter(Boolean)
        .join("\n"),
    };

    if (isTimed) {
      requestBody.start = {
        dateTime: `${startDate}T${startTime}:00+09:00`,
        timeZone: "Asia/Seoul",
      };
      requestBody.end = {
        dateTime: `${safeEndDate}T${endTime}:00+09:00`,
        timeZone: "Asia/Seoul",
      };
    } else {
      requestBody.start = { date: startDate };
      requestBody.end = { date: addDaysYmd(safeEndDate, 1) };
    }

    const created = await gcalClient.events.insert({
      calendarId: targetCalId,
      requestBody,
    });

    return NextResponse.json({
      success: true,
      data: { eventId: created.data.id },
    });
  } catch (e: any) {
    return apiFail(
      `Google 캘린더 일정 등록 실패: ${String(e?.message || e)}`,
      500
    );
  }
}
