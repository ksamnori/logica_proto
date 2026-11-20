// src/components/hq/mobile/HqMobileCalendarTab.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  HqCalendarCategory,
  HqCalendarEventItem,
} from "@/app/api/hq/calendar/route";
import { useHqShell } from "@/components/hq/HqShellContext";
import { hqFetch } from "@/lib/hq/clientApi";
import type {
  HqMeetingAttendee,
  HqMeetingItem,
  HqMeetingRsvpStatus,
} from "@/lib/hq/types";
import HqMobileAiRecorderSheet from "./HqMobileAiRecorderSheet";

export type CalendarSubView = "CALENDAR" | "MEETINGS";

interface Props {
  defaultSubView?: CalendarSubView;
  defaultOpenAiRecorder?: boolean;
  onJumpToLeaveRequest?: () => void;
}

type FilterTab =
  | "ALL"
  | "GOOGLE"
  | "LEAVE_WORK"
  | "PUB_MEETING"
  | "HOLIDAY_BDAY";
type GoogleSubType =
  | "MEETING"
  | "LECTURE"
  | "LEAVE"
  | "GROUP_BUY"
  | "GENERAL";

interface EventVisualMeta {
  label: string;
  icon: string;
  dotClass: string;
  badgeClass: string;
  multiBarClass: string;
  barClass: string;
}

interface GoogleStatusInfo {
  configured: boolean;
  connected: boolean;
  usingCustomHqCalendar: boolean;
  calendarTitle: string;
  error: string | null;
}

// PC 본부 홈(HqCalendarSidebar)과 동일한 달력 크기 프리셋 (기본 6줄 막대 / 압축 1줄)
const CALENDAR_SIZE = {
  normal: {
    maxLanes: 6,
    lanePx: 18,
    dayNumPx: 26,
    overflowPx: 14,
    minRowPx: 62,
  },
  compact: {
    maxLanes: 1,
    lanePx: 16,
    dayNumPx: 22,
    overflowPx: 13,
    minRowPx: 40,
  },
} as const;

const AGENDA_STEP_COUNT = 8;

const GOOGLE_SUBTYPE_META: Record<
  GoogleSubType,
  EventVisualMeta & { shortLabel: string }
> = {
  MEETING: {
    label: "구글 · 미팅/회의",
    shortLabel: "미팅·회의",
    icon: "💬",
    dotClass: "bg-blue-600",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    multiBarClass: "bg-blue-100/80",
    barClass: "bg-blue-600 text-white",
  },
  LECTURE: {
    label: "구글 · 특강",
    shortLabel: "특강",
    icon: "🎤",
    dotClass: "bg-orange-500",
    badgeClass: "bg-orange-50 text-orange-700 border-orange-200",
    multiBarClass: "bg-orange-100/80",
    barClass: "bg-orange-500 text-white",
  },
  LEAVE: {
    label: "구글 · 연차/반차",
    shortLabel: "연차·반차",
    icon: "🌴",
    dotClass: "bg-emerald-200 ring-1 ring-inset ring-emerald-400",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    multiBarClass: "bg-emerald-100/80",
    barClass:
      "bg-emerald-100/95 text-emerald-800 ring-1 ring-inset ring-emerald-200/90",
  },
  GROUP_BUY: {
    label: "구글 · 공구",
    shortLabel: "공구",
    icon: "🛍️",
    dotClass: "bg-violet-200 ring-1 ring-inset ring-violet-400",
    badgeClass: "bg-violet-50 text-violet-700 border-violet-200",
    multiBarClass: "bg-violet-100/80",
    barClass:
      "bg-violet-100/95 text-violet-800 ring-1 ring-inset ring-violet-200/90",
  },
  GENERAL: {
    label: "구글 일정",
    shortLabel: "기타 구글",
    icon: "📆",
    dotClass: "bg-slate-600",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    multiBarClass: "bg-slate-200/80",
    barClass: "bg-slate-600 text-white",
  },
};

const CATEGORY_META: Record<HqCalendarCategory, EventVisualMeta> = {
  GOOGLE: GOOGLE_SUBTYPE_META.GENERAL,
  LEAVE: {
    label: "연차·휴가",
    icon: "🌴",
    dotClass: "bg-emerald-200 ring-1 ring-inset ring-emerald-400",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    multiBarClass: "bg-emerald-100/80",
    barClass:
      "bg-emerald-100/95 text-emerald-800 ring-1 ring-inset ring-emerald-200/90",
  },
  REMOTE: {
    label: "유연·외근",
    icon: "🏠",
    dotClass: "bg-sky-500",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
    multiBarClass: "bg-sky-100/80",
    barClass: "bg-sky-500 text-white",
  },
  MEETING: {
    label: "사내 미팅",
    icon: "💬",
    dotClass: "bg-blue-600",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    multiBarClass: "bg-blue-100/80",
    barClass: "bg-blue-600 text-white",
  },
  PUBLISHING: {
    label: "하판 마감",
    icon: "📚",
    dotClass: "bg-rose-500",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
    multiBarClass: "bg-rose-100/80",
    barClass: "bg-rose-500 text-white",
  },
  HOLIDAY: {
    label: "휴무·공휴일",
    icon: "🎌",
    dotClass: "bg-red-500",
    badgeClass: "bg-red-50 text-red-700 border-red-200",
    multiBarClass: "bg-red-100/70",
    barClass: "bg-red-100 text-red-700",
  },
  BIRTHDAY: {
    label: "생일",
    icon: "🎂",
    dotClass: "bg-pink-500",
    badgeClass: "bg-pink-50 text-pink-700 border-pink-200",
    multiBarClass: "bg-pink-100/70",
    barClass: "bg-pink-400 text-white",
  },
};

function classifyGoogleEvent(ev: HqCalendarEventItem): GoogleSubType {
  const t = ev.title || "";
  if (/(연차|반반차|반차)/.test(t)) return "LEAVE";
  if (/특강/.test(t)) return "LECTURE";
  if (ev.isMultiDay && /(공구|공동구매)/.test(t)) return "GROUP_BUY";
  if (/(미팅|회의)/.test(t)) return "MEETING";
  if (/(공구|공동구매)/.test(t)) return "GROUP_BUY";
  return "GENERAL";
}

function getEventVisualMeta(ev: HqCalendarEventItem): EventVisualMeta {
  if (ev.category === "GOOGLE") {
    return GOOGLE_SUBTYPE_META[classifyGoogleEvent(ev)];
  }
  return CATEGORY_META[ev.category];
}

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysStr(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days);
  return toLocalYmd(dt);
}

function formatKoreanDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
  return `${m}월 ${d}일 (${dow})`;
}

const RSVP_BUTTONS: {
  key: HqMeetingRsvpStatus;
  label: string;
  activeClass: string;
}[] = [
  {
    key: "ATTENDING",
    label: "✓ 참석",
    activeClass: "bg-emerald-600 text-white border-emerald-600",
  },
  {
    key: "MAYBE",
    label: "미정",
    activeClass: "bg-amber-500 text-white border-amber-500",
  },
  {
    key: "DECLINED",
    label: "불참",
    activeClass: "bg-rose-600 text-white border-rose-600",
  },
];

function getErrMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function formatMeetingWhen(startIso?: string | null, endIso?: string | null) {
  if (!startIso) return "일정 미정";
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return startIso;
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const datePart = `${d.getMonth() + 1}.${d.getDate()}(${dow})`;
  const sh = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
  if (!endIso) return `${datePart} ${sh}`;
  const ed = new Date(endIso);
  if (Number.isNaN(ed.getTime())) return `${datePart} ${sh}`;
  const eh = `${String(ed.getHours()).padStart(2, "0")}:${String(
    ed.getMinutes()
  ).padStart(2, "0")}`;
  return `${datePart} ${sh}~${eh}`;
}

export default function HqMobileCalendarTab({
  defaultSubView = "CALENDAR",
  defaultOpenAiRecorder = false,
  onJumpToLeaveRequest,
}: Props) {
  const { me, members } = useHqShell();

  const [subView, setSubView] = useState<CalendarSubView>(
    defaultOpenAiRecorder ? "MEETINGS" : defaultSubView
  );

  // PC 본부 홈과 동일한 캘린더 상태
  const todayYmd = useMemo(() => toLocalYmd(new Date()), []);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("ALL");
  const [googleSubFilter, setGoogleSubFilter] = useState<GoogleSubType | null>(
    null
  );
  const [visibleCount, setVisibleCount] = useState<number>(AGENDA_STEP_COUNT);
  const [calendarCollapsed, setCalendarCollapsed] = useState(false);

  const size = calendarCollapsed ? CALENDAR_SIZE.compact : CALENDAR_SIZE.normal;
  const viewedYear = calendarMonth.getFullYear();
  const viewedMonth = calendarMonth.getMonth() + 1;

  const [events, setEvents] = useState<HqCalendarEventItem[]>([]);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatusInfo>({
    configured: false,
    connected: false,
    usingCustomHqCalendar: false,
    calendarTitle: "Google 캘린더",
    error: null,
  });
  const [loadingCal, setLoadingCal] = useState(true);

  // 빠른 Google 캘린더 일정 추가 모달
  const [addOpen, setAddOpen] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    startDate: todayYmd,
    endDate: todayYmd,
    allDay: true,
    startTime: "10:00",
    endTime: "11:00",
    location: "",
    description: "",
  });

  // 미팅 · RSVP · AI 녹음 상태
  const [meetings, setMeetings] = useState<HqMeetingItem[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [viewingMeeting, setViewingMeeting] = useState<HqMeetingItem | null>(
    null
  );
  const [mtgCreateOpen, setMtgCreateOpen] = useState(false);
  const [mTitle, setMTitle] = useState("");
  const [mDate, setMDate] = useState(todayYmd);
  const [mStart, setMStart] = useState("10:00");
  const [mEnd, setMEnd] = useState("11:00");
  const [mLoc, setMLoc] = useState("본사 회의실");
  const [mAgenda, setMAgenda] = useState("");
  const [mAttendeeIds, setMAttendeeIds] = useState<string[]>([]);
  const [savingMtg, setSavingMtg] = useState(false);

  const [aiRecorderOpen, setAiRecorderOpen] = useState<boolean>(
    defaultOpenAiRecorder
  );
  const [aiTargetMeeting, setAiTargetMeeting] =
    useState<HqMeetingItem | null>(null);

  const fetchCalendar = useCallback(async (yr: number, mo: number) => {
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          googleStatus: GoogleStatusInfo;
          events: HqCalendarEventItem[];
        };
      }>(`/api/hq/calendar?year=${yr}&month=${mo}`);
      if (res.success && res.data) {
        setEvents(res.data.events || []);
        if (res.data.googleStatus) {
          setGoogleStatus(res.data.googleStatus);
        }
      }
    } catch {
      // ignore transient error
    } finally {
      setLoadingCal(false);
    }
  }, []);

  const fetchMeetings = useCallback(async () => {
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { meetings: HqMeetingItem[] };
      }>("/api/hq/meetings");
      const list = res.data?.meetings || [];
      setMeetings(list);
      setViewingMeeting((prev) =>
        prev ? list.find((x) => x.id === prev.id) || prev : null
      );
    } catch {
      setMeetings([]);
    } finally {
      setLoadingMeetings(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchCalendar(viewedYear, viewedMonth);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchCalendar, viewedMonth, viewedYear]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchMeetings();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchMeetings]);

  useEffect(() => {
    const onRefresh = () => {
      void fetchCalendar(viewedYear, viewedMonth);
    };
    window.addEventListener("hq:approval-updated", onRefresh);
    window.addEventListener("hq:attendance-updated", onRefresh);
    return () => {
      window.removeEventListener("hq:approval-updated", onRefresh);
      window.removeEventListener("hq:attendance-updated", onRefresh);
    };
  }, [fetchCalendar, viewedMonth, viewedYear]);

  const holidayDateSet = useMemo(() => {
    const set = new Set<string>();
    for (const ev of events) {
      if (ev.category !== "HOLIDAY") continue;
      let cur = ev.startDate;
      let guard = 0;
      while (cur <= ev.endDate && guard < 30) {
        set.add(cur);
        cur = addDaysStr(cur, 1);
        guard++;
      }
    }
    return set;
  }, [events]);

  const filteredEvents = useMemo(() => {
    let base = events;
    if (filterTab === "GOOGLE") {
      base = events.filter((e) => e.category === "GOOGLE");
    } else if (filterTab === "LEAVE_WORK") {
      base = events.filter(
        (e) =>
          e.category === "LEAVE" ||
          e.category === "REMOTE" ||
          (e.category === "GOOGLE" && classifyGoogleEvent(e) === "LEAVE")
      );
    } else if (filterTab === "PUB_MEETING") {
      base = events.filter(
        (e) =>
          e.category === "PUBLISHING" ||
          e.category === "MEETING" ||
          (e.category === "GOOGLE" && classifyGoogleEvent(e) === "MEETING")
      );
    } else if (filterTab === "HOLIDAY_BDAY") {
      base = events.filter(
        (e) => e.category === "HOLIDAY" || e.category === "BIRTHDAY"
      );
    }

    if (googleSubFilter && (filterTab === "ALL" || filterTab === "GOOGLE")) {
      return base.filter(
        (e) =>
          e.category === "GOOGLE" && classifyGoogleEvent(e) === googleSubFilter
      );
    }
    return base;
  }, [events, filterTab, googleSubFilter]);

  const agendaList = useMemo(() => {
    if (selectedYmd) {
      return filteredEvents.filter(
        (ev) => ev.startDate <= selectedYmd && ev.endDate >= selectedYmd
      );
    }
    const maxFutureYmd = addDaysStr(todayYmd, 35);
    return filteredEvents.filter(
      (ev) => ev.endDate >= todayYmd && ev.startDate <= maxFutureYmd
    );
  }, [filteredEvents, selectedYmd, todayYmd]);

  const visibleAgendaList = useMemo(
    () => agendaList.slice(0, visibleCount),
    [agendaList, visibleCount]
  );
  const remainingAgendaCount = Math.max(0, agendaList.length - visibleCount);

  const openQuickAdd = () => {
    const baseDate = selectedYmd || todayYmd;
    setDraft({
      title: "",
      startDate: baseDate,
      endDate: baseDate,
      allDay: true,
      startTime: "10:00",
      endTime: "11:00",
      location: "",
      description: "",
    });
    setAddOpen(true);
  };

  const handleCreateGoogleEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) {
      alert("일정 제목을 입력해 주세요.");
      return;
    }
    setSavingEvent(true);
    try {
      await hqFetch("/api/hq/calendar", {
        method: "POST",
        body: {
          title: draft.title.trim(),
          startDate: draft.startDate,
          endDate: draft.endDate || draft.startDate,
          startTime: draft.allDay ? "" : draft.startTime,
          endTime: draft.allDay ? "" : draft.endTime,
          location: draft.location.trim(),
          description: draft.description.trim(),
        },
      });
      setAddOpen(false);
      setLoadingCal(true);
      await fetchCalendar(viewedYear, viewedMonth);
    } catch (err: unknown) {
      alert(getErrMsg(err, "일정 등록 중 오류가 발생했습니다."));
    } finally {
      setSavingEvent(false);
    }
  };

  const handleAgendaItemClick = (ev: HqCalendarEventItem) => {
    if (ev.externalUrl) {
      window.open(ev.externalUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (ev.category === "MEETING") {
      const rawId = ev.id.replace(/^mtg-/, "");
      const mtg = meetings.find((m) => m.id === rawId);
      if (mtg) {
        setViewingMeeting(mtg);
      } else {
        setSubView("MEETINGS");
      }
      return;
    }
    if (ev.category === "LEAVE" && onJumpToLeaveRequest) {
      onJumpToLeaveRequest();
    }
  };

  const handleRsvp = async (meetingId: string, rsvp: HqMeetingRsvpStatus) => {
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { meetings: HqMeetingItem[] };
      }>("/api/hq/meetings", {
        method: "POST",
        body: { action: "RSVP", id: meetingId, rsvp },
      });
      const updated = res.data?.meetings || [];
      setMeetings(updated);
      setViewingMeeting((prev) =>
        prev ? updated.find((x) => x.id === prev.id) || prev : null
      );
    } catch (err: unknown) {
      alert(getErrMsg(err, "참석 상태 변경 실패"));
    }
  };

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status === "재직" && !m.is_ghost),
    [members]
  );

  const openCreateMeeting = () => {
    setMTitle("");
    setMDate(selectedYmd || todayYmd);
    setMStart("10:00");
    setMEnd("11:00");
    setMLoc("본사 회의실");
    setMAgenda("");
    setMAttendeeIds(me ? [me.instructor_id] : []);
    setMtgCreateOpen(true);
  };

  const handleSaveMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mTitle.trim()) {
      alert("미팅 제목을 입력해 주세요.");
      return;
    }
    setSavingMtg(true);
    try {
      const attendees: HqMeetingAttendee[] = mAttendeeIds.flatMap((id) => {
        const found = activeMembers.find((m) => m.instructor_id === id);
        return found
          ? [
              {
                member_id: found.instructor_id,
                name: found.name,
                department: found.department,
                rsvp: "ATTENDING" as HqMeetingRsvpStatus,
              },
            ]
          : [];
      });

      const res = await hqFetch<{
        success: boolean;
        data: { meetings: HqMeetingItem[] };
      }>("/api/hq/meetings", {
        method: "POST",
        body: {
          action: "SAVE",
          title: mTitle.trim(),
          has_schedule: true,
          start_at: `${mDate}T${mStart}:00+09:00`,
          end_at: `${mDate}T${mEnd}:00+09:00`,
          location_or_url: mLoc.trim(),
          attendees,
          agenda: mAgenda.trim(),
          summary_notes: "",
        },
      });
      setMeetings(res.data?.meetings || []);
      setMtgCreateOpen(false);
      void fetchCalendar(viewedYear, viewedMonth);
    } catch (err: unknown) {
      alert(getErrMsg(err, "미팅 생성 실패"));
    } finally {
      setSavingMtg(false);
    }
  };

  const sortedMeetings = useMemo(() => {
    return [...meetings].sort((a, b) => {
      const ta = a.start_at
        ? new Date(a.start_at).getTime()
        : new Date(a.created_at).getTime();
      const tb = b.start_at
        ? new Date(b.start_at).getTime()
        : new Date(b.created_at).getTime();
      return tb - ta;
    });
  }, [meetings]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 상단 뷰 스위치 */}
      <div className="bg-white border-b border-slate-200 px-4 py-2.5 shrink-0">
        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setSubView("CALENDAR")}
            className={`py-2 rounded-lg text-xs font-extrabold transition-all ${
              subView === "CALENDAR"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500"
            }`}
          >
            📆 통합 캘린더
          </button>
          <button
            type="button"
            onClick={() => setSubView("MEETINGS")}
            className={`py-2 rounded-lg text-xs font-extrabold transition-all ${
              subView === "MEETINGS"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500"
            }`}
          >
            🤝 미팅 · AI 회의록 ({meetings.length})
          </button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* 뷰 A: PC 본부 홈(HqCalendarSidebar)과 동일한 형태의 막대형 통합 캘린더 */}
      {/* =================================================================== */}
      {subView === "CALENDAR" ? (
        <div className="flex-1 overflow-y-auto px-3 py-3 pb-8">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
            {/* 1) 상단 타이틀 & Google 연동 배지 */}
            {!calendarCollapsed && (
              <div className="px-3.5 py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-extrabold text-slate-900 whitespace-nowrap">
                    📅 본부 통합 캘린더
                  </span>
                  {googleStatus.connected && (
                    <span
                      title={googleStatus.calendarTitle}
                      className="px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] leading-3 font-extrabold whitespace-nowrap"
                    >
                      Google 연동
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={openQuickAdd}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 active:bg-slate-800 text-white text-[11px] font-extrabold shrink-0 transition-colors"
                >
                  + 일정
                </button>
              </div>
            )}

            {/* 2) 월 이동 네비게이션 + 달력 접기/펼치기 */}
            <div className="px-3.5 py-2 border-b border-slate-100 flex items-center justify-between gap-2 bg-white">
              <h3 className="text-sm font-extrabold text-slate-800 tracking-tight whitespace-nowrap">
                {viewedYear}년 {viewedMonth}월
              </h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setLoadingCal(true);
                    void fetchCalendar(viewedYear, viewedMonth);
                  }}
                  title="일정 동기화 새로고침"
                  className="w-6 h-6 flex items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-600 text-[11px] font-bold"
                >
                  <span className={loadingCal ? "animate-spin inline-block" : ""}>
                    🔄
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoadingCal(true);
                    setVisibleCount(AGENDA_STEP_COUNT);
                    setCalendarMonth(new Date(viewedYear, viewedMonth - 2, 1));
                  }}
                  className="w-6 h-6 flex items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 text-[10px] font-bold"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    if (
                      now.getFullYear() !== viewedYear ||
                      now.getMonth() + 1 !== viewedMonth
                    ) {
                      setLoadingCal(true);
                    }
                    setCalendarMonth(now);
                    setSelectedYmd(null);
                    setVisibleCount(AGENDA_STEP_COUNT);
                  }}
                  className="px-2 h-6 rounded-md border border-slate-300 bg-white text-[11px] font-bold text-slate-700"
                >
                  오늘
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoadingCal(true);
                    setVisibleCount(AGENDA_STEP_COUNT);
                    setCalendarMonth(new Date(viewedYear, viewedMonth, 1));
                  }}
                  className="w-6 h-6 flex items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 text-[10px] font-bold"
                >
                  ▶
                </button>
                {calendarCollapsed && (
                  <button
                    type="button"
                    onClick={openQuickAdd}
                    className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-900 text-white text-xs font-extrabold"
                  >
                    +
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCalendarCollapsed((prev) => !prev)}
                  className="px-1.5 h-6 rounded-md border border-slate-200 bg-white text-[10px] font-bold text-slate-500 whitespace-nowrap"
                >
                  {calendarCollapsed ? "펼치기 ▼" : "접기 ▲"}
                </button>
              </div>
            </div>

            {/* 3) 카테고리 빠른 필터 + 구글 세부 범례 (PC 본부 홈과 동일) */}
            {!calendarCollapsed && (
              <div className="px-3 py-1.5 border-b border-slate-100 flex flex-wrap items-center gap-1 bg-white">
                {(
                  [
                    { id: "ALL", label: "전체" },
                    { id: "GOOGLE", label: "📆 구글" },
                    { id: "LEAVE_WORK", label: "🌴 휴가·외근" },
                    { id: "PUB_MEETING", label: "📚 하판·미팅" },
                    { id: "HOLIDAY_BDAY", label: "🎌 공휴·생일" },
                  ] as { id: FilterTab; label: string }[]
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setFilterTab(t.id);
                      setVisibleCount(AGENDA_STEP_COUNT);
                      if (t.id !== "ALL" && t.id !== "GOOGLE") {
                        setGoogleSubFilter(null);
                      }
                    }}
                    className={`px-2 py-0.5 rounded-md text-[11px] leading-4 font-bold whitespace-nowrap transition-colors ${
                      filterTab === t.id
                        ? "bg-slate-900 text-white shadow-2xs"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}

                {(filterTab === "ALL" || filterTab === "GOOGLE") &&
                  (
                    [
                      "MEETING",
                      "LECTURE",
                      "LEAVE",
                      "GROUP_BUY",
                      "GENERAL",
                    ] as GoogleSubType[]
                  ).map((sub) => {
                    const sm = GOOGLE_SUBTYPE_META[sub];
                    const active = googleSubFilter === sub;
                    return (
                      <button
                        key={sub}
                        type="button"
                        onClick={() => {
                          setGoogleSubFilter((prev) =>
                            prev === sub ? null : sub
                          );
                          setVisibleCount(AGENDA_STEP_COUNT);
                        }}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] leading-4 font-bold transition-all ${
                          active
                            ? `${sm.badgeClass} ring-1 ring-slate-900/20 shadow-2xs`
                            : "bg-slate-50/80 border-slate-200/80 text-slate-600"
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-[2px] shrink-0 ${sm.dotClass}`}
                        />
                        <span>{sm.shortLabel}</span>
                      </button>
                    );
                  })}
              </div>
            )}

            {/* 4) 월간 멀티 레인 막대 달력 그리드 (PC 본부 홈과 1:1 동일 구조) */}
            <div className="border-b border-slate-200 bg-white select-none">
              <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50">
                {["일", "월", "화", "수", "목", "금", "토"].map((dow, idx) => (
                  <div
                    key={dow}
                    className={`py-1 text-center text-[11px] font-extrabold border-r border-slate-100 last:border-r-0 ${
                      idx === 0
                        ? "text-rose-500"
                        : idx === 6
                          ? "text-blue-600"
                          : "text-slate-500"
                    }`}
                  >
                    {dow}
                  </div>
                ))}
              </div>

              {(() => {
                const firstYmd = `${viewedYear}-${String(viewedMonth).padStart(
                  2,
                  "0"
                )}-01`;
                const firstDow = new Date(
                  viewedYear,
                  viewedMonth - 1,
                  1
                ).getDay();
                const daysInMonth = new Date(
                  viewedYear,
                  viewedMonth,
                  0
                ).getDate();
                const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
                const gridStart = addDaysStr(firstYmd, -firstDow);
                const monthPrefix = firstYmd.slice(0, 7);

                const weeks: string[][] = [];
                for (let i = 0; i < totalCells; i += 7) {
                  weeks.push(
                    Array.from({ length: 7 }, (_, j) =>
                      addDaysStr(gridStart, i + j)
                    )
                  );
                }

                return (
                  <div className="divide-y divide-slate-300">
                    {weeks.map((wd) => {
                      const weekStart = wd[0];
                      const weekEnd = wd[6];

                      const weekItems = filteredEvents
                        .filter(
                          (ev) =>
                            ev.endDate >= weekStart && ev.startDate <= weekEnd
                        )
                        .filter(
                          (ev) =>
                            !calendarCollapsed ||
                            ev.category !== "GOOGLE" ||
                            classifyGoogleEvent(ev) !== "GROUP_BUY"
                        )
                        .map((ev) => {
                          const colStart =
                            ev.startDate < weekStart
                              ? 0
                              : wd.indexOf(ev.startDate);
                          const colEnd =
                            ev.endDate > weekEnd ? 6 : wd.indexOf(ev.endDate);
                          return {
                            ev,
                            colStart: Math.max(0, colStart),
                            colEnd: Math.max(0, colEnd),
                          };
                        })
                        .sort((a, b) => {
                          const aMulti = a.ev.isMultiDay ? 1 : 0;
                          const bMulti = b.ev.isMultiDay ? 1 : 0;
                          if (aMulti !== bMulti) return bMulti - aMulti;
                          const aSpan = a.colEnd - a.colStart;
                          const bSpan = b.colEnd - b.colStart;
                          if (aSpan !== bSpan) return bSpan - aSpan;
                          if (a.colStart !== b.colStart)
                            return a.colStart - b.colStart;
                          const aHol = a.ev.category === "HOLIDAY" ? 0 : 1;
                          const bHol = b.ev.category === "HOLIDAY" ? 0 : 1;
                          return aHol - bHol;
                        });

                      const lanes: boolean[][] = [];
                      const placed: {
                        ev: HqCalendarEventItem;
                        colStart: number;
                        colEnd: number;
                        lane: number;
                      }[] = [];
                      const overflowByCol = [0, 0, 0, 0, 0, 0, 0];

                      for (const item of weekItems) {
                        let laneIdx = -1;
                        for (let l = 0; l < lanes.length; l++) {
                          let free = true;
                          for (let c = item.colStart; c <= item.colEnd; c++) {
                            if (lanes[l][c]) {
                              free = false;
                              break;
                            }
                          }
                          if (free) {
                            laneIdx = l;
                            break;
                          }
                        }
                        if (laneIdx === -1) {
                          lanes.push([
                            false,
                            false,
                            false,
                            false,
                            false,
                            false,
                            false,
                          ]);
                          laneIdx = lanes.length - 1;
                        }
                        for (let c = item.colStart; c <= item.colEnd; c++) {
                          lanes[laneIdx][c] = true;
                        }
                        if (laneIdx < size.maxLanes) {
                          placed.push({ ...item, lane: laneIdx });
                        } else {
                          for (let c = item.colStart; c <= item.colEnd; c++) {
                            overflowByCol[c] += 1;
                          }
                        }
                      }

                      const usedLanes = Math.min(size.maxLanes, lanes.length);
                      const hasOverflow = overflowByCol.some((n) => n > 0);
                      const laneAreaPx = usedLanes * size.lanePx;
                      const rowHeightPx = Math.max(
                        size.minRowPx,
                        size.dayNumPx +
                          laneAreaPx +
                          (hasOverflow ? size.overflowPx : 4)
                      );

                      return (
                        <div
                          key={weekStart}
                          className="relative transition-[height] duration-200 ease-out"
                          style={{ height: `${rowHeightPx}px` }}
                        >
                          <div className="absolute inset-0 grid grid-cols-7">
                            {wd.map((ymd, idx) => {
                              const inMonth = ymd.slice(0, 7) === monthPrefix;
                              const isToday = ymd === todayYmd;
                              const isSelected = ymd === selectedYmd;
                              const isHoliday = holidayDateSet.has(ymd);
                              const numColor = isSelected
                                ? "bg-slate-900 text-white font-extrabold shadow-sm"
                                : isToday
                                  ? "bg-brand text-white font-extrabold shadow-xs"
                                  : isHoliday || idx === 0
                                    ? "text-rose-500 font-bold"
                                    : idx === 6
                                      ? "text-blue-600 font-semibold"
                                      : "text-slate-700 font-semibold";
                              return (
                                <button
                                  key={ymd}
                                  type="button"
                                  onClick={() => {
                                    setSelectedYmd((prev) =>
                                      prev === ymd ? null : ymd
                                    );
                                    setVisibleCount(AGENDA_STEP_COUNT);
                                  }}
                                  className={`relative flex flex-col items-center pt-1 border-r border-slate-100 last:border-r-0 active:bg-slate-50/90 transition-colors ${
                                    isSelected
                                      ? "bg-blue-50/50 ring-1 ring-inset ring-brand/25"
                                      : ""
                                  } ${inMonth ? "" : "bg-slate-50/40 opacity-45"}`}
                                >
                                  <span
                                    className={`text-[12px] w-5 h-5 flex items-center justify-center rounded-full ${numColor}`}
                                  >
                                    {Number(ymd.slice(8, 10))}
                                  </span>
                                  {overflowByCol[idx] > 0 && (
                                    <span className="absolute bottom-0 inset-x-0 text-center text-[10px] font-extrabold text-slate-500 leading-[13px]">
                                      +{overflowByCol[idx]}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          {usedLanes > 0 && (
                            <div
                              className="absolute inset-x-0 grid grid-cols-7 pointer-events-none"
                              style={{
                                top: `${size.dayNumPx}px`,
                                gridTemplateRows: `repeat(${usedLanes}, ${size.lanePx}px)`,
                              }}
                            >
                              {placed.map(({ ev, colStart, colEnd, lane }) => {
                                const roundL = ev.startDate >= weekStart;
                                const roundR = ev.endDate <= weekEnd;
                                const vMeta = getEventVisualMeta(ev);
                                return (
                                  <div
                                    key={`${ev.id}-${weekStart}`}
                                    style={{
                                      gridColumn: `${colStart + 1} / ${
                                        colEnd + 2
                                      }`,
                                      gridRow: `${lane + 1}`,
                                    }}
                                    className={`h-[15px] self-center px-1 text-[10px] leading-[15px] font-bold truncate shadow-[0_1px_1px_rgba(15,23,42,0.06)] ${
                                      vMeta.barClass
                                    } ${ev.statusLabel ? "opacity-60" : ""} ${
                                      roundL ? "rounded-l-[4px] ml-[2px]" : ""
                                    } ${
                                      roundR ? "rounded-r-[4px] mr-[2px]" : ""
                                    }`}
                                  >
                                    {ev.title}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* 5) 하단 일정 타임라인 목록 (PC 본부 홈과 동일) */}
            <div className="flex flex-col bg-slate-50/60 p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[13px] font-extrabold text-slate-800">
                  {selectedYmd
                    ? `${formatKoreanDateLabel(selectedYmd)} 일정 (${
                        agendaList.length
                      })`
                    : `오늘 · 다가오는 일정 (${agendaList.length})`}
                </h4>
                {selectedYmd && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedYmd(null);
                      setVisibleCount(AGENDA_STEP_COUNT);
                    }}
                    className="text-xs font-bold text-brand"
                  >
                    전체 다가오는 일정
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {loadingCal && events.length === 0 ? (
                  <div className="py-10 text-center text-xs font-bold text-slate-400">
                    캘린더 일정을 불러오는 중입니다...
                  </div>
                ) : agendaList.length === 0 ? (
                  <div className="py-10 text-center space-y-1">
                    <div className="text-xl">🗓️</div>
                    <p className="text-xs font-bold text-slate-400">
                      {selectedYmd
                        ? "선택한 날짜에 등록된 일정이 없습니다."
                        : "예정된 주요 일정이 없습니다."}
                    </p>
                  </div>
                ) : (
                  <>
                    {visibleAgendaList.map((ev) => {
                      const meta = getEventVisualMeta(ev);
                      const clickable = Boolean(
                        ev.externalUrl ||
                          ev.category === "MEETING" ||
                          (ev.category === "LEAVE" && onJumpToLeaveRequest)
                      );
                      const isTodayItem =
                        ev.startDate <= todayYmd && ev.endDate >= todayYmd;

                      return (
                        <div
                          key={ev.id}
                          onClick={() => clickable && handleAgendaItemClick(ev)}
                          className={`rounded-xl bg-white border px-3 py-2 transition-all ${
                            isTodayItem
                              ? "border-brand/35 shadow-xs"
                              : "border-slate-200/90"
                          } ${clickable ? "cursor-pointer active:bg-slate-50" : ""}`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`px-2 py-0.5 rounded-md border text-[11px] leading-[14px] font-extrabold shrink-0 ${meta.badgeClass}`}
                              >
                                {meta.icon} {meta.label}
                              </span>
                              {ev.statusLabel && (
                                <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] leading-[14px] font-extrabold shrink-0">
                                  {ev.statusLabel}
                                </span>
                              )}
                            </div>
                            <span className="text-xs font-bold text-slate-500 shrink-0">
                              {ev.isMultiDay
                                ? `${ev.startDate
                                    .slice(5)
                                    .replace("-", ".")}~${ev.endDate
                                    .slice(5)
                                    .replace("-", ".")}`
                                : formatKoreanDateLabel(ev.startDate)}
                            </span>
                          </div>

                          <div className="text-[13px] leading-5 font-extrabold text-slate-800 truncate">
                            {ev.title}
                          </div>

                          <div className="mt-0.5 flex items-center justify-between gap-2 text-xs leading-4 text-slate-500">
                            <span className="truncate">
                              {ev.subtitle || "-"}
                            </span>
                            {ev.timeLabel && (
                              <span className="font-semibold text-slate-400 shrink-0">
                                {ev.timeLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {agendaList.length > AGENDA_STEP_COUNT && (
                      <div className="pt-1 flex items-center gap-2">
                        {remainingAgendaCount > 0 ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setVisibleCount(
                                  (prev) => prev + AGENDA_STEP_COUNT
                                )
                              }
                              className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-extrabold text-slate-700"
                            >
                              ▼ 일정 더보기 (+
                              {Math.min(AGENDA_STEP_COUNT, remainingAgendaCount)}
                              건 · 남은 {remainingAgendaCount}건)
                            </button>
                            {remainingAgendaCount > AGENDA_STEP_COUNT && (
                              <button
                                type="button"
                                onClick={() =>
                                  setVisibleCount(agendaList.length)
                                }
                                className="px-3 py-2.5 rounded-xl bg-slate-100 text-xs font-bold text-slate-600 shrink-0"
                              >
                                전체 펼치기
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setVisibleCount(AGENDA_STEP_COUNT)}
                            className="w-full py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600"
                          >
                            ▲ 8개만 간단히 보기
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ================================================================= */
        /* 뷰 B: 사내 미팅 · RSVP · AI 음성 회의록 */
        /* ================================================================= */
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                setAiTargetMeeting(null);
                setAiRecorderOpen(true);
              }}
              className="py-3 px-3 rounded-2xl bg-rose-600 text-white font-extrabold text-xs shadow-sm flex items-center justify-center gap-1.5 active:scale-[0.99]"
            >
              <span>🎙️</span>
              <span>새 회의 AI 녹음</span>
            </button>

            <button
              type="button"
              onClick={openCreateMeeting}
              className="py-3 px-3 rounded-2xl bg-slate-900 text-white font-extrabold text-xs shadow-sm flex items-center justify-center gap-1.5 active:scale-[0.99]"
            >
              <span>+</span>
              <span>새 미팅 일정 등록</span>
            </button>
          </div>

          {loadingMeetings ? (
            <div className="py-12 text-center text-xs font-bold text-slate-400">
              미팅 목록을 불러오는 중입니다...
            </div>
          ) : sortedMeetings.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-400 font-semibold">
              등록된 사내 미팅이 없습니다.
            </div>
          ) : (
            sortedMeetings.map((mtg) => {
              const myAtt = me
                ? mtg.attendees.find(
                    (a) =>
                      a.member_id === me.instructor_id || a.name === me.name
                  )
                : null;
              const attendingCount = mtg.attendees.filter(
                (a) => a.rsvp === "ATTENDING"
              ).length;

              return (
                <div
                  key={mtg.id}
                  className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3"
                >
                  <div
                    onClick={() => setViewingMeeting(mtg)}
                    className="space-y-1 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
                      <span>
                        📅 {formatMeetingWhen(mtg.start_at, mtg.end_at)}
                      </span>
                      <span>참석 {attendingCount}명</span>
                    </div>
                    <h4 className="text-sm font-extrabold text-slate-900">
                      {mtg.title}
                    </h4>
                    <div className="text-[11px] text-slate-500">
                      📍 {mtg.location_or_url || "장소 미정"} · 주최{" "}
                      {mtg.organizer_name}
                    </div>
                    {mtg.summary_notes && (
                      <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-brand text-[10px] font-extrabold">
                        📝 회의록·요약 등록됨 (터치하여 열람)
                      </div>
                    )}
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      {RSVP_BUTTONS.map((btn) => {
                        const isMine = myAtt?.rsvp === btn.key;
                        return (
                          <button
                            key={btn.key}
                            type="button"
                            onClick={() => handleRsvp(mtg.id, btn.key)}
                            className={`px-2.5 py-1 rounded-lg border text-[11px] font-extrabold transition-colors ${
                              isMine
                                ? btn.activeClass
                                : "bg-slate-50 text-slate-600 border-slate-200"
                            }`}
                          >
                            {btn.label}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setAiTargetMeeting(mtg);
                        setAiRecorderOpen(true);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-extrabold shrink-0"
                    >
                      🎙️ 녹음요약
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* 빠른 일정 등록 시트 (PC 본부 홈 모달과 동일 구성) */}
      {/* =================================================================== */}
      {addOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex flex-col justify-end"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAddOpen(false);
          }}
        >
          <div className="bg-white rounded-t-3xl max-h-[90dvh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm font-extrabold">
                  📅 본부 일정 빠른 등록
                </h3>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  구글 공유 캘린더 일정 또는 사내 미팅·휴가를 바로 등록합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="w-7 h-7 rounded-lg bg-white/10 text-white font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setSubView("MEETINGS");
                  openCreateMeeting();
                }}
                className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700"
              >
                💬 사내 미팅 · 회의록 잡기 →
              </button>
              {onJumpToLeaveRequest && (
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    onJumpToLeaveRequest();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700"
                >
                  🌴 내 휴가 신청 →
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {googleStatus.connected ? (
                <form
                  onSubmit={handleCreateGoogleEvent}
                  className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-3.5 text-xs"
                >
                  <div className="text-[11px] font-extrabold text-purple-700 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
                    📆 Google 캘린더({googleStatus.calendarTitle})에 일정을 바로 등록합니다.
                  </div>

                  <div>
                    <label className="block font-extrabold text-slate-700 mb-1">
                      일정 제목
                    </label>
                    <input
                      value={draft.title}
                      onChange={(e) =>
                        setDraft({ ...draft, title: e.target.value })
                      }
                      placeholder="예: 인쇄소 감리 미팅 / 외부 저자 미팅"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-300 font-bold outline-none focus:border-brand"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-extrabold text-slate-700 mb-1">
                        시작일
                      </label>
                      <input
                        type="date"
                        value={draft.startDate}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            startDate: e.target.value,
                            endDate:
                              draft.endDate < e.target.value
                                ? e.target.value
                                : draft.endDate,
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block font-extrabold text-slate-700 mb-1">
                        종료일
                      </label>
                      <input
                        type="date"
                        value={draft.endDate}
                        onChange={(e) =>
                          setDraft({ ...draft, endDate: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300"
                      />
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-1.5 font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.allDay}
                      onChange={(e) =>
                        setDraft({ ...draft, allDay: e.target.checked })
                      }
                      className="w-4 h-4 rounded accent-brand"
                    />
                    <span>종일 일정</span>
                  </label>

                  {!draft.allDay && (
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block font-extrabold text-slate-700 mb-1">
                          시작 시간
                        </label>
                        <input
                          type="time"
                          value={draft.startTime}
                          onChange={(e) =>
                            setDraft({ ...draft, startTime: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-300"
                        />
                      </div>
                      <div>
                        <label className="block font-extrabold text-slate-700 mb-1">
                          종료 시간
                        </label>
                        <input
                          type="time"
                          value={draft.endTime}
                          onChange={(e) =>
                            setDraft({ ...draft, endTime: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-300"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block font-extrabold text-slate-700 mb-1">
                      장소 (선택)
                    </label>
                    <input
                      value={draft.location}
                      onChange={(e) =>
                        setDraft({ ...draft, location: e.target.value })
                      }
                      placeholder="예: 본사 회의실 / 파주 인쇄소"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300"
                    />
                  </div>

                  <div>
                    <label className="block font-extrabold text-slate-700 mb-1">
                      메모 (선택)
                    </label>
                    <textarea
                      rows={2}
                      value={draft.description}
                      onChange={(e) =>
                        setDraft({ ...draft, description: e.target.value })
                      }
                      placeholder="상세 내용을 입력하세요"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingEvent}
                    className="w-full py-3 rounded-xl bg-brand text-white font-extrabold text-sm disabled:opacity-50"
                  >
                    {savingEvent ? "등록 중..." : "Google 캘린더에 등록"}
                  </button>
                </form>
              ) : (
                <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-3 text-xs text-slate-600">
                  <p className="leading-relaxed">
                    현재 Google 캘린더 외부 연동이 설정되어 있지 않습니다. 사내 휴가·재택·하판 마감·미팅 일정은 자동으로 표시되며, 외부 Google 캘린더 연결은 PC 버전 [설정 &gt; 연결 설정]에서 등록할 수 있습니다.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 미팅 상세 · 회의록 열람 시트 */}
      {viewingMeeting && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex flex-col justify-end">
          <div className="bg-white rounded-t-3xl max-h-[88dvh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-extrabold text-slate-900 truncate">
                {viewingMeeting.title}
              </h3>
              <button
                type="button"
                onClick={() => setViewingMeeting(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-extrabold text-sm flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-1.5">
                <div className="font-bold text-slate-800">
                  📅 {formatMeetingWhen(viewingMeeting.start_at, viewingMeeting.end_at)}
                </div>
                <div className="text-slate-600">
                  📍 {viewingMeeting.location_or_url || "장소 미정"} · 주최{" "}
                  {viewingMeeting.organizer_name}
                </div>
              </div>

              {viewingMeeting.attendees.length > 0 && (
                <div className="space-y-1.5">
                  <div className="font-extrabold text-slate-800">
                    참석자 현황 ({viewingMeeting.attendees.length}명)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {viewingMeeting.attendees.map((a, idx) => (
                      <span
                        key={`${a.member_id}-${idx}`}
                        className={`px-2.5 py-1 rounded-full border text-[11px] font-bold ${
                          a.rsvp === "ATTENDING"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : a.rsvp === "DECLINED"
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        {a.name} ·{" "}
                        {a.rsvp === "ATTENDING"
                          ? "참석"
                          : a.rsvp === "DECLINED"
                            ? "불참"
                            : "미정"}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {viewingMeeting.agenda && (
                <div className="space-y-1">
                  <div className="font-extrabold text-slate-800">사전 안건</div>
                  <p className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {viewingMeeting.agenda}
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-800">
                    회의록 · AI 요약 아카이브
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const target = viewingMeeting;
                      setViewingMeeting(null);
                      setAiTargetMeeting(target);
                      setAiRecorderOpen(true);
                    }}
                    className="text-[11px] font-extrabold text-rose-600"
                  >
                    🎙️ 음성 녹음 추가 →
                  </button>
                </div>
                {viewingMeeting.summary_notes ? (
                  <div className="rounded-2xl bg-blue-50/40 border border-blue-200 p-3.5 text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {viewingMeeting.summary_notes}
                  </div>
                ) : (
                  <p className="text-slate-400 py-3">
                    아직 작성된 회의록이 없습니다. 우측 상단 [음성 녹음 추가]로 자동 요약할 수 있습니다.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 새 미팅 등록 시트 */}
      {mtgCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex flex-col justify-end">
          <form
            onSubmit={handleSaveMeeting}
            className="bg-white rounded-t-3xl max-h-[90dvh] flex flex-col overflow-hidden shadow-2xl"
          >
            <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-extrabold text-slate-900">
                🤝 새 본부 미팅 등록
              </h3>
              <button
                type="button"
                onClick={() => setMtgCreateOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-extrabold text-sm flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600">
                  미팅 제목 *
                </label>
                <input
                  type="text"
                  value={mTitle}
                  onChange={(e) => setMTitle(e.target.value)}
                  placeholder="예: 상반기 신간 편집 공정 주간회의"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    날짜
                  </label>
                  <input
                    type="date"
                    value={mDate}
                    onChange={(e) => setMDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-2 py-2 text-xs font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    시작
                  </label>
                  <input
                    type="time"
                    value={mStart}
                    onChange={(e) => setMStart(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-2 py-2 text-xs font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    종료
                  </label>
                  <input
                    type="time"
                    value={mEnd}
                    onChange={(e) => setMEnd(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-2 py-2 text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600">
                  장소 · 화상링크
                </label>
                <input
                  type="text"
                  value={mLoc}
                  onChange={(e) => setMLoc(e.target.value)}
                  placeholder="본사 회의실 / Google Meet"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-600">
                  참석 구성원 선택 ({mAttendeeIds.length}명)
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto rounded-xl bg-slate-50 border border-slate-200 p-2.5">
                  {activeMembers.map((mem) => {
                    const checked = mAttendeeIds.includes(mem.instructor_id);
                    return (
                      <button
                        key={mem.instructor_id}
                        type="button"
                        onClick={() =>
                          setMAttendeeIds((prev) =>
                            prev.includes(mem.instructor_id)
                              ? prev.filter((x) => x !== mem.instructor_id)
                              : [...prev, mem.instructor_id]
                          )
                        }
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                          checked
                            ? "bg-brand text-white border-brand"
                            : "bg-white text-slate-600 border-slate-200"
                        }`}
                      >
                        {mem.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600">
                  안건 메모
                </label>
                <textarea
                  rows={2}
                  value={mAgenda}
                  onChange={(e) => setMAgenda(e.target.value)}
                  placeholder="논의할 주요 안건을 입력해 주세요."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none resize-none"
                />
              </div>
            </div>

            <div className="border-t border-slate-200 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] shrink-0">
              <button
                type="submit"
                disabled={savingMtg}
                className="w-full py-3.5 rounded-xl bg-brand text-white font-extrabold text-sm shadow-md disabled:opacity-50"
              >
                {savingMtg ? "등록 중..." : "미팅 일정 저장하기"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* AI 음성 회의록 시트 */}
      {aiRecorderOpen && (
        <HqMobileAiRecorderSheet
          targetMeeting={aiTargetMeeting}
          onClose={() => setAiRecorderOpen(false)}
          onSaved={(updated) => {
            if (updated) setMeetings(updated);
            else void fetchMeetings();
            void fetchCalendar(viewedYear, viewedMonth);
          }}
        />
      )}
    </div>
  );
}
