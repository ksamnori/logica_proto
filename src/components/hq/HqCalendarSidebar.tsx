// src/components/hq/HqCalendarSidebar.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  HqCalendarCategory,
  HqCalendarEventItem,
} from "@/app/api/hq/calendar/route";
import { useHqShell } from "@/components/hq/HqShellContext";
import { hqFetch } from "@/lib/hq/clientApi";
import { useHqHref } from "@/lib/hq/hqRoutes";

type FilterTab = "ALL" | "GOOGLE" | "LEAVE_WORK" | "PUB_MEETING" | "HOLIDAY_BDAY";

interface GoogleStatusInfo {
  configured: boolean;
  connected: boolean;
  usingCustomHqCalendar: boolean;
  calendarTitle: string;
  error: string | null;
}

const CATEGORY_META: Record<
  HqCalendarCategory,
  {
    label: string;
    icon: string;
    dotClass: string;
    badgeClass: string;
    multiBarClass: string;
  }
> = {
  GOOGLE: {
    label: "구글 일정",
    icon: "📆",
    dotClass: "bg-purple-500",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200",
    multiBarClass: "bg-purple-100/80",
  },
  LEAVE: {
    label: "연차·휴가",
    icon: "🌴",
    dotClass: "bg-emerald-500",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    multiBarClass: "bg-emerald-100/80",
  },
  REMOTE: {
    label: "유연·외근",
    icon: "🏠",
    dotClass: "bg-sky-500",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
    multiBarClass: "bg-sky-100/80",
  },
  MEETING: {
    label: "사내 미팅",
    icon: "💬",
    dotClass: "bg-amber-500",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    multiBarClass: "bg-amber-100/80",
  },
  PUBLISHING: {
    label: "하판 마감",
    icon: "📚",
    dotClass: "bg-rose-500",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
    multiBarClass: "bg-rose-100/80",
  },
  HOLIDAY: {
    label: "휴무·공휴일",
    icon: "🎌",
    dotClass: "bg-red-500",
    badgeClass: "bg-red-50 text-red-700 border-red-200",
    multiBarClass: "bg-red-100/70",
  },
  BIRTHDAY: {
    label: "생일",
    icon: "🎂",
    dotClass: "bg-pink-500",
    badgeClass: "bg-pink-50 text-pink-700 border-pink-200",
    multiBarClass: "bg-pink-100/70",
  },
};

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

export default function HqCalendarSidebar() {
  const router = useRouter();
  const hqHref = useHqHref();
  const { canAccessMenu, openSettingsModal } = useHqShell();

  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("ALL");

  const [events, setEvents] = useState<HqCalendarEventItem[]>([]);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatusInfo>({
    configured: false,
    connected: false,
    usingCustomHqCalendar: false,
    calendarTitle: "Google 캘린더",
    error: null,
  });
  const [loading, setLoading] = useState(true);

  // 빠른 Google 캘린더 일정 추가 모달
  const [addOpen, setAddOpen] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    startDate: toLocalYmd(new Date()),
    endDate: toLocalYmd(new Date()),
    allDay: true,
    startTime: "10:00",
    endTime: "11:00",
    location: "",
    description: "",
  });

  const viewedYear = calendarMonth.getFullYear();
  const viewedMonth = calendarMonth.getMonth() + 1;
  const todayYmd = useMemo(() => toLocalYmd(new Date()), []);

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          googleStatus: GoogleStatusInfo;
          events: HqCalendarEventItem[];
        };
      }>(`/api/hq/calendar?year=${viewedYear}&month=${viewedMonth}`);

      if (res.success && res.data) {
        setEvents(res.data.events || []);
        setGoogleStatus(res.data.googleStatus);
      }
    } catch {
      // ignore transient error
    } finally {
      setLoading(false);
    }
  }, [viewedYear, viewedMonth]);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    const onRefresh = () => {
      loadCalendar();
    };
    window.addEventListener("hq:approval-updated", onRefresh);
    window.addEventListener("hq:attendance-updated", onRefresh);
    return () => {
      window.removeEventListener("hq:approval-updated", onRefresh);
      window.removeEventListener("hq:attendance-updated", onRefresh);
    };
  }, [loadCalendar]);

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
    if (filterTab === "ALL") return events;
    if (filterTab === "GOOGLE") {
      return events.filter((e) => e.category === "GOOGLE");
    }
    if (filterTab === "LEAVE_WORK") {
      return events.filter(
        (e) => e.category === "LEAVE" || e.category === "REMOTE"
      );
    }
    if (filterTab === "PUB_MEETING") {
      return events.filter(
        (e) => e.category === "PUBLISHING" || e.category === "MEETING"
      );
    }
    return events.filter(
      (e) => e.category === "HOLIDAY" || e.category === "BIRTHDAY"
    );
  }, [events, filterTab]);

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
      await loadCalendar();
    } catch (err: any) {
      alert(err?.message || "일정 등록 중 오류가 발생했습니다.");
    } finally {
      setSavingEvent(false);
    }
  };

  const handleItemClick = (ev: HqCalendarEventItem) => {
    if (ev.externalUrl) {
      window.open(ev.externalUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (ev.linkPath && canAccessMenu(ev.linkPath)) {
      router.push(hqHref(ev.linkPath));
    }
  };

  return (
    <>
      <aside className="mx-4 sm:mx-6 mb-6 xl:mx-0 xl:mb-0 xl:w-[344px] shrink-0 bg-white rounded-2xl xl:rounded-none border border-slate-200 xl:border-y-0 xl:border-r-0 xl:border-l shadow-xs xl:shadow-none flex flex-col xl:sticky xl:top-0 xl:self-start xl:h-[calc(100dvh-4rem)] overflow-hidden print:hidden">
        {/* 상단 타이틀 & 구글 연동 배지 */}
        <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-extrabold text-slate-900">
                📅 본부 통합 캘린더
              </span>
              {googleStatus.connected ? (
                <span
                  title={googleStatus.calendarTitle}
                  className="px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-extrabold"
                >
                  Google 연동
                </span>
              ) : canAccessMenu("/hq/settings") ? (
                <button
                  type="button"
                  onClick={() => openSettingsModal("integration")}
                  className="px-1.5 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold"
                  title="Google 캘린더 연결 설정 열기"
                >
                  ⚙️ 연결 설정
                </button>
              ) : null}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
              구글 일정 · 휴가/재택 · 하판 마감 · 미팅
            </p>
          </div>

          <button
            type="button"
            onClick={openQuickAdd}
            className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-extrabold shrink-0 transition-colors"
          >
            + 일정
          </button>
        </div>

        {/* 월 이동 네비게이션 */}
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
          <h3 className="text-sm font-extrabold text-slate-800 tracking-tight">
            {viewedYear}년 {viewedMonth}월
          </h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={loadCalendar}
              title="일정 동기화 새로고침"
              className="w-6 h-6 flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-bold transition-colors"
            >
              <span className={loading ? "animate-spin inline-block" : ""}>
                🔄
              </span>
            </button>
            <button
              type="button"
              onClick={() =>
                setCalendarMonth(new Date(viewedYear, viewedMonth - 2, 1))
              }
              className="w-6 h-6 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 text-[11px] font-bold"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={() => {
                setCalendarMonth(new Date());
                setSelectedYmd(null);
              }}
              className="px-2 py-0.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-700"
            >
              오늘
            </button>
            <button
              type="button"
              onClick={() =>
                setCalendarMonth(new Date(viewedYear, viewedMonth, 1))
              }
              className="w-6 h-6 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 text-[11px] font-bold"
            >
              ▶
            </button>
          </div>
        </div>

        {/* 카테고리 빠른 필터 */}
        <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-1 overflow-x-auto bg-white shrink-0 no-scrollbar">
          {(
            [
              { id: "ALL", label: "전체" },
              { id: "GOOGLE", label: "📆 구글" },
              { id: "LEAVE_WORK", label: "🌴 휴가·유연" },
              { id: "PUB_MEETING", label: "📚 하판·미팅" },
              { id: "HOLIDAY_BDAY", label: "🎌 휴일·생일" },
            ] as { id: FilterTab; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilterTab(t.id)}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${
                filterTab === t.id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 월간 달력 그리드 */}
        <div className="grid grid-cols-7 gap-y-1 p-3 border-b border-slate-100 bg-white shrink-0 select-none">
          {["일", "월", "화", "수", "목", "금", "토"].map((dow, idx) => (
            <div
              key={dow}
              className={`text-center text-[11px] font-extrabold mb-1 ${
                idx === 0
                  ? "text-rose-500"
                  : idx === 6
                    ? "text-blue-600"
                    : "text-slate-400"
              }`}
            >
              {dow}
            </div>
          ))}

          {(() => {
            const firstDow = new Date(viewedYear, viewedMonth - 1, 1).getDay();
            const daysInMonth = new Date(viewedYear, viewedMonth, 0).getDate();
            const cells: React.ReactNode[] = [];

            for (let i = 0; i < firstDow; i++) {
              cells.push(<div key={`empty-${i}`} className="py-1" />);
            }

            for (let d = 1; d <= daysInMonth; d++) {
              const ymd = `${viewedYear}-${String(viewedMonth).padStart(
                2,
                "0"
              )}-${String(d).padStart(2, "0")}`;
              const dow = (firstDow + d - 1) % 7;
              const isToday = ymd === todayYmd;
              const isSelected = ymd === selectedYmd;
              const isHoliday = holidayDateSet.has(ymd);

              const dayItems = filteredEvents.filter(
                (ev) => ev.startDate <= ymd && ev.endDate >= ymd
              );
              const distinctCats = Array.from(
                new Set(dayItems.map((ev) => ev.category))
              ).slice(0, 4);

              const multiItem = dayItems.find((ev) => ev.isMultiDay);
              let multiBg: React.ReactNode = null;
              if (multiItem) {
                const isStart = multiItem.startDate === ymd;
                const isEnd = multiItem.endDate === ymd;
                const posCls =
                  isStart && isEnd
                    ? "left-1 right-1 rounded-lg"
                    : isStart
                      ? "left-1 right-0 rounded-l-full"
                      : isEnd
                        ? "left-0 right-1 rounded-r-full"
                        : "left-0 right-0";
                multiBg = (
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 h-6 -z-10 ${
                      CATEGORY_META[multiItem.category].multiBarClass
                    } ${posCls}`}
                  />
                );
              }

              const numColor = isSelected
                ? "bg-slate-900 text-white font-extrabold shadow-sm"
                : isToday
                  ? "bg-brand text-white font-extrabold shadow-xs"
                  : isHoliday || dow === 0
                    ? "text-rose-500 font-bold"
                    : dow === 6
                      ? "text-blue-600 font-semibold"
                      : "text-slate-700 font-semibold";

              cells.push(
                <button
                  key={ymd}
                  type="button"
                  onClick={() =>
                    setSelectedYmd((prev) => (prev === ymd ? null : ymd))
                  }
                  className="py-1 flex flex-col items-center justify-center relative hover:bg-slate-100/80 rounded-lg transition-colors z-0"
                >
                  {multiBg}
                  <span
                    className={`text-xs w-6 h-6 flex items-center justify-center rounded-full relative z-10 ${numColor}`}
                  >
                    {d}
                  </span>
                  {distinctCats.length > 0 && (
                    <div className="flex items-center gap-[2px] mt-0.5 h-1.5 relative z-10">
                      {distinctCats.map((cat) => (
                        <span
                          key={cat}
                          className={`w-1.5 h-1.5 rounded-full ${
                            CATEGORY_META[cat].dotClass
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            }

            return cells;
          })()}
        </div>

        {/* 하단 일정 타임라인 목록 */}
        <div className="flex-1 flex flex-col min-h-[240px] xl:min-h-0 bg-slate-50/50 p-3.5 overflow-hidden">
          <div className="flex items-center justify-between mb-2.5 shrink-0">
            <h4 className="text-xs font-extrabold text-slate-800">
              {selectedYmd
                ? `${formatKoreanDateLabel(selectedYmd)} 일정 (${agendaList.length})`
                : `오늘 · 다가오는 일정 (${agendaList.length})`}
            </h4>
            {selectedYmd && (
              <button
                type="button"
                onClick={() => setSelectedYmd(null)}
                className="text-[11px] font-bold text-brand hover:underline"
              >
                전체 다가오는 일정
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll space-y-2 pr-0.5 max-h-[340px] xl:max-h-none">
            {loading && events.length === 0 ? (
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
              agendaList.map((ev) => {
                const meta = CATEGORY_META[ev.category];
                const clickable = Boolean(
                  ev.externalUrl || (ev.linkPath && canAccessMenu(ev.linkPath))
                );
                const isTodayItem =
                  ev.startDate <= todayYmd && ev.endDate >= todayYmd;

                return (
                  <div
                    key={ev.id}
                    onClick={() => clickable && handleItemClick(ev)}
                    className={`rounded-xl bg-white border p-3 transition-all ${
                      isTodayItem
                        ? "border-brand/35 shadow-xs"
                        : "border-slate-200/90"
                    } ${
                      clickable
                        ? "cursor-pointer hover:border-brand/50 hover:bg-slate-50/70"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <div className="flex items-center gap-1 min-w-0">
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-extrabold shrink-0 ${meta.badgeClass}`}
                        >
                          {meta.icon} {meta.label}
                        </span>
                        {ev.statusLabel && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-extrabold shrink-0">
                            {ev.statusLabel}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-bold text-slate-500 shrink-0">
                        {ev.isMultiDay
                          ? `${ev.startDate.slice(5).replace("-", ".")}~${ev.endDate
                              .slice(5)
                              .replace("-", ".")}`
                          : formatKoreanDateLabel(ev.startDate)}
                      </span>
                    </div>

                    <div className="text-xs font-extrabold text-slate-800 leading-snug break-keep">
                      {ev.title}
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
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
              })
            )}
          </div>
        </div>
      </aside>

      {/* 빠른 일정 등록 모달 */}
      {addOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAddOpen(false);
          }}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold">📅 본부 일정 빠른 등록</h3>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  구글 공유 캘린더 일정 또는 사내 미팅·휴가를 바로 등록합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="w-7 h-7 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            {/* 사내 일정 바로가기 버튼 바 */}
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
              {canAccessMenu("/hq/meetings") && (
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    router.push(hqHref("/hq/meetings"));
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-50 border border-slate-200 text-xs font-bold text-slate-700"
                >
                  💬 사내 미팅 · 회의록 잡기 →
                </button>
              )}
              {canAccessMenu("/hq/leaves") && (
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    router.push(hqHref("/hq/leaves"));
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-emerald-50 border border-slate-200 text-xs font-bold text-slate-700"
                >
                  🌴 내 휴가 신청 →
                </button>
              )}
            </div>

            {googleStatus.connected ? (
              <form onSubmit={handleCreateGoogleEvent} className="p-5 space-y-3.5 text-xs">
                <div className="text-[11px] font-extrabold text-purple-700 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
                  📆 Google 캘린더({googleStatus.calendarTitle})에 외부·공유 일정을 바로 등록합니다.
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
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 font-bold"
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

                <div className="flex items-center justify-between">
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
                </div>

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

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setAddOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-600 hover:bg-slate-50"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={savingEvent}
                    className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white font-extrabold disabled:opacity-50"
                  >
                    {savingEvent ? "등록 중..." : "Google 캘린더에 등록"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-5 space-y-3 text-xs text-slate-600">
                <p className="leading-relaxed">
                  현재 Google 캘린더 외부 연동이 설정되어 있지 않습니다. 사내 휴가·재택·하판 마감·미팅 일정은 자동으로 표시되며, 외부 Google 캘린더까지 연결하려면 <b>[설정 &gt; 연결 설정]</b>에서 Calendar ID를 등록해 주세요.
                </p>
                {canAccessMenu("/hq/settings") && (
                  <button
                    type="button"
                    onClick={() => {
                      setAddOpen(false);
                      openSettingsModal("integration");
                    }}
                    className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold"
                  >
                    ⚙️ Google 캘린더 연결 설정 열기
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
