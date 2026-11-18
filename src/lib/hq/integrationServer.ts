// src/lib/hq/integrationServer.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { readCompanySettingsServer } from "./companySettingsServer";
import { FALLBACK_HQ_TENANT_ID } from "./constants";
import {
  DEFAULT_INTEGRATION_SETTINGS,
  HQ_DEFAULT_GOOGLE_CALENDAR_ID,
} from "./defaultIntegrationSettings";
import type {
  HqAccessTerminalProvider,
  HqAttendanceStatus,
  HqIntegrationSettings,
} from "./types";

/**
 * 본부(HQ)에서 사용할 Google 캘린더 ID 결정
 * 1) [설정 > 연결 설정]에 입력한 캘린더 ID (단, 학원 공용 캘린더 ID와 같으면 무시)
 * 2) HQ_TARGET_CALENDAR_ID 환경변수
 * 3) 본부 기본 캘린더 (01000math@gmail.com)
 * ※ 학원 공용 TARGET_CALENDAR_ID로는 더 이상 폴백하지 않음 (학원 캘린더만 보이던 문제 해결)
 */
export function resolveHqCalendarId(customCalendarId?: string | null): string {
  const custom = String(customCalendarId || "").trim();
  const academyCalId = (process.env.TARGET_CALENDAR_ID || "").trim();
  if (custom && custom !== academyCalId) return custom;
  return (
    (process.env.HQ_TARGET_CALENDAR_ID || "").trim() ||
    HQ_DEFAULT_GOOGLE_CALENDAR_ID
  );
}

export const TERMINAL_PROVIDER_LABELS: Record<
  HqAccessTerminalProvider,
  string
> = {
  secom: "에스원 세콤",
  adt_caps: "ADT 캡스",
  kt_telecop: "KT텔레캅",
};

function getGoogleCalendarClient() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || "";
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(
    /\\n/g,
    "\n"
  );
  if (!clientEmail || !privateKey) {
    throw new Error(
      "서버 환경변수(GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY)가 설정되어 있지 않습니다."
    );
  }
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

function addDaysIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, (d || 1) + days));
  return dt.toISOString().slice(0, 10);
}

export async function getMergedIntegrationSettings(
  supabaseAdmin: SupabaseClient
): Promise<{
  integrations: HqIntegrationSettings;
  holidaysByYear: Record<string, any[]>;
}> {
  const { settings } = await readCompanySettingsServer(supabaseAdmin);
  const raw = settings.extra_settings?.integration_settings;
  return {
    integrations: {
      slack: { ...DEFAULT_INTEGRATION_SETTINGS.slack, ...(raw?.slack || {}) },
      google_calendar: {
        ...DEFAULT_INTEGRATION_SETTINGS.google_calendar,
        ...(raw?.google_calendar || {}),
      },
      secom: { ...DEFAULT_INTEGRATION_SETTINGS.secom, ...(raw?.secom || {}) },
      adt_caps: {
        ...DEFAULT_INTEGRATION_SETTINGS.adt_caps,
        ...(raw?.adt_caps || {}),
      },
      kt_telecop: {
        ...DEFAULT_INTEGRATION_SETTINGS.kt_telecop,
        ...(raw?.kt_telecop || {}),
      },
    },
    holidaysByYear: settings.holidays_by_year || {},
  };
}

/**
 * 1) Google Calendar 연결 테스트
 */
export async function testGoogleCalendarConnection(
  customCalendarId?: string
): Promise<{ calendarId: string; summary: string }> {
  const calId = resolveHqCalendarId(customCalendarId);
  if (!calId) {
    throw new Error("연동할 Google Calendar ID를 입력해 주세요.");
  }
  const calendar = getGoogleCalendarClient();
  const meta = await calendar.calendars.get({ calendarId: calId });
  return {
    calendarId: calId,
    summary: meta.data.summary || calId,
  };
}

/**
 * 2) 결재 승인 문서(휴가 / 출장·외근·원격근무) -> Google Calendar 자동 등록 (중복 방지)
 */
export async function syncApprovalDocToGoogleCalendar(
  supabaseAdmin: SupabaseClient,
  doc: any,
  forceRun = false
): Promise<boolean> {
  const { integrations } = await getMergedIntegrationSettings(supabaseAdmin);
  const cfg = integrations.google_calendar;
  if (!forceRun && !cfg.enabled) return false;

  const calId = resolveHqCalendarId(cfg.calendar_id);
  if (!calId) return false;

  const isLeave = doc.doc_type === "LEAVE";
  const titleStr = String(doc.title || "");
  const isWorkTripOrRemote =
    !isLeave &&
    (titleStr.includes("출장") ||
      titleStr.includes("외근") ||
      titleStr.includes("원격") ||
      titleStr.includes("재택"));

  if (isLeave && !cfg.sync_leaves) return false;
  if (isWorkTripOrRemote && !cfg.sync_work_forms) return false;
  if (!isLeave && !isWorkTripOrRemote) return false;

  const calendar = getGoogleCalendarClient();
  const docNo = String(doc.doc_no || doc.approval_id || "");

  // 동일 결재문서 번호 중복 등록 방지
  if (docNo) {
    const existing = await calendar.events.list({
      calendarId: calId,
      q: docNo,
      singleEvents: true,
      maxResults: 3,
    });
    if ((existing.data.items || []).length > 0) {
      return false;
    }
  }

  const startStr = String(
    doc.effective_date || new Date().toISOString().slice(0, 10)
  ).slice(0, 10);
  const endInclusive = String(doc.end_date || startStr).slice(0, 10);
  const exclusiveEnd = addDaysIsoDate(endInclusive, 1);

  const prefix = (cfg.event_prefix || "[HQ]").trim();
  const summary = isLeave
    ? `${prefix} ${doc.drafter_name} — ${doc.leave_type || "휴가"}`
    : `${prefix} ${doc.drafter_name} — ${doc.title}`;

  await calendar.events.insert({
    calendarId: calId,
    requestBody: {
      summary,
      description: [
        `결재 문서번호: ${docNo}`,
        `소속 부서: ${doc.drafter_dept || "본부"}`,
        `기안 제목: ${doc.title || "-"}`,
        doc.content ? `상세 내용: ${doc.content}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      start: { date: startStr },
      end: { date: exclusiveEnd },
    },
  });

  return true;
}

/**
 * 3) 기존 승인 완료된 휴가·출장 결재 문서 + 회사 지정 휴일 Google Calendar 일괄 동기화
 */
export async function batchSyncHqToGoogleCalendar(
  supabaseAdmin: SupabaseClient,
  overrideCalendarId?: string
): Promise<{ syncedCount: number; calendarSummary: string }> {
  const { integrations, holidaysByYear } =
    await getMergedIntegrationSettings(supabaseAdmin);
  const cfg = integrations.google_calendar;
  const calId = resolveHqCalendarId(overrideCalendarId || cfg.calendar_id);

  const { summary: calendarSummary } = await testGoogleCalendarConnection(calId);
  const calendar = getGoogleCalendarClient();

  let syncedCount = 0;

  // 승인 완료 문서 동기화
  const { data: approvedDocs } = await supabaseAdmin
    .from("hq_approval_doc")
    .select("*")
    .eq("status", "APPROVED")
    .order("created_at", { ascending: false })
    .limit(80);

  for (const doc of approvedDocs || []) {
    try {
      const inserted = await syncApprovalDocToGoogleCalendar(
        supabaseAdmin,
        doc,
        true
      );
      if (inserted) syncedCount += 1;
    } catch {
      // 개별 이벤트 오류는 건너뛰고 계속 진행
    }
  }

  // 회사 지정 쉬는 날(커스텀 휴일) 동기화
  if (cfg.sync_company_holidays) {
    const curYear = String(new Date().getFullYear());
    const yearList = holidaysByYear[curYear] || [];
    const customHolidays = yearList.filter((h: any) => h.is_custom);
    for (const h of customHolidays) {
      const tag = `HQ-HOLIDAY-${h.id}`;
      const existing = await calendar.events.list({
        calendarId: calId,
        q: tag,
        singleEvents: true,
        maxResults: 2,
      });
      if ((existing.data.items || []).length > 0) continue;
      const s = String(h.start_date).slice(0, 10);
      const e = addDaysIsoDate(String(h.end_date || h.start_date).slice(0, 10), 1);
      await calendar.events.insert({
        calendarId: calId,
        requestBody: {
          summary: `${cfg.event_prefix || "[HQ]"} 🏢 ${h.name} (사내 휴무)`,
          description: `${h.date_text || ""} [${tag}]`,
          start: { date: s },
          end: { date: e },
        },
      });
      syncedCount += 1;
    }
  }

  return { syncedCount, calendarSummary };
}

/**
 * 4) Slack Incoming Webhook 발송
 */
export async function sendSlackWebhookMessage(
  webhookUrl: string,
  text: string
): Promise<void> {
  const cleanUrl = webhookUrl.trim();
  if (!cleanUrl.startsWith("https://hooks.slack.com/")) {
    throw new Error(
      "유효한 Slack Incoming Webhook URL(https://hooks.slack.com/...)을 입력해주세요."
    );
  }
  const res = await fetch(cleanUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack 웹훅 응답 오류 (HTTP ${res.status})`);
  }
}

export async function notifySlackIfEnabled(
  supabaseAdmin: SupabaseClient,
  kind: "ATTENDANCE" | "LEAVE" | "APPROVAL",
  message: string
): Promise<void> {
  try {
    const { integrations } = await getMergedIntegrationSettings(supabaseAdmin);
    const sl = integrations.slack;
    if (!sl.enabled || !sl.webhook_url) return;
    if (kind === "ATTENDANCE" && !sl.notify_attendance) return;
    if (kind === "LEAVE" && !sl.notify_leave) return;
    if (kind === "APPROVAL" && !sl.notify_approval) return;
    await sendSlackWebhookMessage(sl.webhook_url, message);
  } catch {
    // Slack 오류가 본 비즈니스 로직을 막지 않도록 방어
  }
}

/**
 * 5) ADT 캡스 / 에스원 세콤 / KT텔레캅 출입단말기 로그 -> hq_attendance 자동 반영
 */
export interface RawTerminalPunchEvent {
  work_date: string; // "2026-11-16"
  time_str: string; // "08:52" 또는 "08:52:14"
  user_no?: string; // 카드번호 / 지문ID / 단말기 사번
  user_name?: string; // 이름
  mode?: string; // "출근" | "퇴근" | "해제" | "세트" | "일반출입"
}

function calcWorkedMinutesFromIso(
  inIso: string | null,
  outIso: string | null
): { breakMinutes: number; workedMinutes: number; overtimeMinutes: number } {
  if (!inIso || !outIso) {
    return { breakMinutes: 0, workedMinutes: 0, overtimeMinutes: 0 };
  }
  const inMs = new Date(inIso).getTime();
  const outMs = new Date(outIso).getTime();
  if (Number.isNaN(inMs) || Number.isNaN(outMs) || outMs <= inMs) {
    return { breakMinutes: 0, workedMinutes: 0, overtimeMinutes: 0 };
  }
  const gross = Math.round((outMs - inMs) / 60000);
  const autoBreak = gross >= 540 ? 60 : gross >= 270 ? 30 : 0;
  const worked = Math.max(0, gross - autoBreak);
  const overtime = Math.max(0, worked - 480);
  return {
    breakMinutes: autoBreak,
    workedMinutes: worked,
    overtimeMinutes: overtime,
  };
}

export async function ingestTerminalAttendanceEvents(
  supabaseAdmin: SupabaseClient,
  provider: HqAccessTerminalProvider,
  events: RawTerminalPunchEvent[]
): Promise<{
  matchedPunches: number;
  upsertedDays: number;
  unmatchedIdentifiers: string[];
}> {
  const { integrations } = await getMergedIntegrationSettings(supabaseAdmin);
  const termCfg = integrations[provider];
  const providerLabel = TERMINAL_PROVIDER_LABELS[provider];

  // 본사 재직 구성원 조회
  const [instRes, profRes, tenantRes] = await Promise.all([
    supabaseAdmin
      .from("instructor")
      .select("instructor_id, name, department, tenant_id, status"),
    supabaseAdmin
      .from("hq_member_profile")
      .select("instructor_id, department, employee_no"),
    supabaseAdmin.from("academy_tenant").select("tenant_id, name, tenant_type"),
  ]);

  const hqTenantIds = new Set<string>([FALLBACK_HQ_TENANT_ID]);
  (tenantRes.data || []).forEach((t: any) => {
    if (
      String(t.tenant_type || "").toUpperCase() === "HQ" ||
      String(t.name || "").includes("본사")
    ) {
      hqTenantIds.add(String(t.tenant_id));
    }
  });

  const profMap = new Map<string, any>();
  (profRes.data || []).forEach((p: any) => {
    profMap.set(String(p.instructor_id), p);
  });

  interface ResolvedMember {
    instructor_id: string;
    name: string;
    department: string;
    employee_no: string;
  }

  const hqMembers: ResolvedMember[] = (instRes.data || [])
    .filter(
      (r: any) =>
        r.status !== "퇴사" &&
        r.status !== "퇴직" &&
        (!r.tenant_id || hqTenantIds.has(String(r.tenant_id)))
    )
    .map((r: any) => {
      const pf = profMap.get(String(r.instructor_id));
      return {
        instructor_id: String(r.instructor_id),
        name: String(r.name || "").trim(),
        department: String(pf?.department || r.department || "미지정").trim(),
        employee_no: String(pf?.employee_no || "").trim(),
      };
    });

  // 카드번호/사번 매핑 인덱스 구성
  const byCardNo = new Map<string, ResolvedMember>();
  const byName = new Map<string, ResolvedMember>();

  hqMembers.forEach((m) => {
    if (m.name) byName.set(m.name, m);
    if (m.employee_no) byCardNo.set(m.employee_no.toLowerCase(), m);
  });

  (termCfg.member_mappings || []).forEach((mp) => {
    const code = String(mp.terminal_user_no || "").trim().toLowerCase();
    if (!code) return;
    const found =
      (mp.member_id
        ? hqMembers.find((m) => m.instructor_id === mp.member_id)
        : undefined) || byName.get(String(mp.member_name || "").trim());
    if (found) byCardNo.set(code, found);
  });

  // (instructor_id, work_date) 단위 그룹핑
  const grouped = new Map<
    string,
    {
      member: ResolvedMember;
      workDate: string;
      times: { hhmmss: string; mode: string }[];
    }
  >();
  const unmatchedSet = new Set<string>();
  let matchedPunches = 0;

  for (const ev of events) {
    const cleanDate = String(ev.work_date || "")
      .trim()
      .replace(/[./]/g, "-")
      .slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) continue;

    const rawTime = String(ev.time_str || "").trim();
    const tmMatch = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(rawTime);
    if (!tmMatch) continue;
    const hh = tmMatch[1].padStart(2, "0");
    const mm = tmMatch[2];
    const ss = tmMatch[3] || "00";
    const hhmmss = `${hh}:${mm}:${ss}`;

    const codeKey = String(ev.user_no || "").trim().toLowerCase();
    const nameKey = String(ev.user_name || "").trim();

    const matchedMember =
      (codeKey ? byCardNo.get(codeKey) : undefined) ||
      (nameKey ? byName.get(nameKey) : undefined);

    if (!matchedMember) {
      const label = nameKey || ev.user_no || "";
      if (label) unmatchedSet.add(String(label));
      continue;
    }

    matchedPunches += 1;
    const gKey = `${matchedMember.instructor_id}__${cleanDate}`;
    const bucket = grouped.get(gKey) || {
      member: matchedMember,
      workDate: cleanDate,
      times: [],
    };
    bucket.times.push({ hhmmss, mode: String(ev.mode || "") });
    grouped.set(gKey, bucket);
  }

  let upsertedDays = 0;
  const nowIso = new Date().toISOString();

  for (const bucket of grouped.values()) {
    bucket.times.sort((a, b) => a.hhmmss.localeCompare(b.hhmmss));
    let inTime: string | null = null;
    let outTime: string | null = null;

    if (termCfg.punch_rule === "EXPLICIT_MODE") {
      const explicitIn = bucket.times.find((t) =>
        /출근|해제|입실|IN/i.test(t.mode)
      );
      const explicitOut = [...bucket.times]
        .reverse()
        .find((t) => /퇴근|세트|경비|퇴실|OUT/i.test(t.mode));
      inTime = explicitIn?.hhmmss || bucket.times[0]?.hhmmss || null;
      outTime =
        explicitOut && explicitOut.hhmmss !== inTime
          ? explicitOut.hhmmss
          : bucket.times.length >= 2
            ? bucket.times[bucket.times.length - 1].hhmmss
            : null;
    } else {
      // FIRST_IN_LAST_OUT: 당일 첫 출입=출근, 마지막 출입(첫 출입 이후)=퇴근
      inTime = bucket.times[0]?.hhmmss || null;
      const last = bucket.times[bucket.times.length - 1]?.hhmmss || null;
      if (last && inTime && last > inTime) {
        outTime = last;
      }
    }

    // 기존 당일 DB 출근기록과 병합 (단말기 퇴근만 단일 웹훅으로 들어온 경우 기존 check_in_at 보존)
    const { data: prevRow } = await supabaseAdmin
      .from("hq_attendance")
      .select("*")
      .eq("instructor_id", bucket.member.instructor_id)
      .eq("work_date", bucket.workDate)
      .maybeSingle();

    const candidateInIso = inTime
      ? `${bucket.workDate}T${inTime}+09:00`
      : null;
    const candidateOutIso = outTime
      ? `${bucket.workDate}T${outTime}+09:00`
      : null;

    let finalInIso = prevRow?.check_in_at || candidateInIso;
    let finalOutIso = prevRow?.check_out_at || candidateOutIso;

    if (
      candidateInIso &&
      finalInIso &&
      new Date(candidateInIso).getTime() < new Date(finalInIso).getTime()
    ) {
      finalInIso = candidateInIso;
    }

    // 단일 실시간 타각이 기존 출근보다 최소 10분 이후이면 퇴근 시각으로 갱신
    if (
      !candidateOutIso &&
      candidateInIso &&
      prevRow?.check_in_at &&
      new Date(candidateInIso).getTime() -
        new Date(prevRow.check_in_at).getTime() >=
        10 * 60 * 1000
    ) {
      finalOutIso = candidateInIso;
    } else if (
      candidateOutIso &&
      (!finalOutIso ||
        new Date(candidateOutIso).getTime() > new Date(finalOutIso).getTime())
    ) {
      finalOutIso = candidateOutIso;
    }

    const calc = calcWorkedMinutesFromIso(finalInIso, finalOutIso);
    const status: HqAttendanceStatus = finalOutIso ? "DONE" : "WORKING";

    const { error: upErr } = await supabaseAdmin.from("hq_attendance").upsert(
      {
        instructor_id: bucket.member.instructor_id,
        member_name: bucket.member.name,
        department: bucket.member.department,
        work_date: bucket.workDate,
        work_mode: prevRow?.work_mode || "OFFICE",
        status,
        check_in_at: finalInIso,
        check_out_at: finalOutIso,
        break_minutes: calc.breakMinutes,
        worked_minutes: calc.workedMinutes,
        overtime_minutes: calc.overtimeMinutes,
        location_note: termCfg.terminal_name || `${providerLabel} 단말기`,
        memo: prevRow?.memo || `[${providerLabel} 출입연동] 자동 기록`,
        updated_at: nowIso,
      },
      { onConflict: "instructor_id,work_date" }
    );

    if (!upErr) {
      upsertedDays += 1;
    }
  }

  return {
    matchedPunches,
    upsertedDays,
    unmatchedIdentifiers: Array.from(unmatchedSet).slice(0, 20),
  };
}
