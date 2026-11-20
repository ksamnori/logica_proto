// src/app/hq/meetings/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHqShell } from "@/components/hq/HqShellContext";
import { hqFetch } from "@/lib/hq/clientApi";
import type {
  HqMeetingAttendee,
  HqMeetingItem,
  HqMeetingRsvpStatus,
} from "@/lib/hq/types";

type DateRangeMode = "14DAYS" | "THIS_MONTH" | "ALL";
type ViewMode = "LIST" | "CALENDAR";

const RSVP_META: Record<
  HqMeetingRsvpStatus,
  { label: string; badgeClass: string }
> = {
  ATTENDING: {
    label: "참석",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  MAYBE: {
    label: "미정",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
  },
  DECLINED: {
    label: "불참",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
  },
};

function formatMeetingDateTime(iso?: string | null, endIso?: string | null): string {
  if (!iso) return "일정 미정";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const datePart = `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}. ${String(d.getDate()).padStart(2, "0")} (${weekdays[d.getDay()]})`;
  const startHm = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;

  if (!endIso) return `${datePart} ${startHm}`;
  const ed = new Date(endIso);
  if (Number.isNaN(ed.getTime())) return `${datePart} ${startHm}`;
  const endHm = `${String(ed.getHours()).padStart(2, "0")}:${String(
    ed.getMinutes()
  ).padStart(2, "0")}`;
  return `${datePart} ${startHm} ~ ${endHm}`;
}

function getLocalTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function HqMeetingsPage() {
  const { me, members, isHrManager, isHqAdmin } = useHqShell();

  const [meetings, setMeetings] = useState<HqMeetingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 상단 툴바 & 필터 상태 (스크린샷 1:1 재현)
  const [scheduleTab, setScheduleTab] = useState<"SCHEDULED" | "UNSCHEDULED">(
    "SCHEDULED"
  );
  const [dateRangeMode, setDateRangeMode] = useState<DateRangeMode>("14DAYS");
  const [onlyHostedByMe, setOnlyHostedByMe] = useState(false);
  const [onlyToday, setOnlyToday] = useState(false);
  const [onlyMyAttendee, setOnlyMyAttendee] = useState(false);
  const [deptFilter, setDeptFilter] = useState<string>("ALL");
  const [extraFilterOpen, setExtraFilterOpen] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("LIST");

  // 미팅 추가/수정 모달
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>("");
  const [formTitle, setFormTitle] = useState("");
  const [formHasSchedule, setFormHasSchedule] = useState(true);
  const [formStartDate, setFormStartDate] = useState(getLocalTodayYmd);
  const [formStartTime, setFormStartTime] = useState("10:00");
  const [formEndTime, setFormEndTime] = useState("11:00");
  const [formLocation, setFormLocation] = useState("본사 회의실");
  const [formAttendees, setFormAttendees] = useState<HqMeetingAttendee[]>([]);
  const [formAgenda, setFormAgenda] = useState("");
  const [formSummary, setFormSummary] = useState("");

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status === "재직"),
    [members]
  );

  const departments = useMemo(() => {
    const set = new Set<string>();
    activeMembers.forEach((m) => {
      if (m.department) set.add(m.department);
    });
    return Array.from(set);
  }, [activeMembers]);

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { meetings: HqMeetingItem[] };
      }>("/api/hq/meetings");
      setMeetings(res.data?.meetings || []);
    } catch {
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  const resetFilters = () => {
    setScheduleTab("SCHEDULED");
    setDateRangeMode("14DAYS");
    setOnlyHostedByMe(false);
    setOnlyToday(false);
    setOnlyMyAttendee(false);
    setDeptFilter("ALL");
    setKeyword("");
  };

  const filteredMeetings = useMemo(() => {
    const todayYmd = getLocalTodayYmd();
    const now = new Date();
    const min14 = new Date(now);
    min14.setDate(now.getDate() - 14);
    min14.setHours(0, 0, 0, 0);
    const max14 = new Date(now);
    max14.setDate(now.getDate() + 14);
    max14.setHours(23, 59, 59, 999);

    const ymPrefix = todayYmd.slice(0, 7);

    const list = meetings.filter((m) => {
      if (scheduleTab === "SCHEDULED" && !m.has_schedule) return false;
      if (scheduleTab === "UNSCHEDULED" && m.has_schedule) return false;

      if (onlyHostedByMe && me) {
        if (m.organizer_id !== me.instructor_id && m.organizer_name !== me.name) {
          return false;
        }
      }

      if (onlyMyAttendee && me) {
        const hit = m.attendees.some(
          (a) => a.member_id === me.instructor_id || a.name === me.name
        );
        if (!hit) return false;
      }

      if (deptFilter !== "ALL") {
        const deptHit =
          m.organizer_dept === deptFilter ||
          m.attendees.some((a) => a.department === deptFilter);
        if (!deptHit) return false;
      }

      if (m.has_schedule && m.start_at) {
        const startDateStr = m.start_at.slice(0, 10);
        if (onlyToday && startDateStr !== todayYmd) return false;

        if (dateRangeMode === "14DAYS") {
          const dt = new Date(m.start_at);
          if (!Number.isNaN(dt.getTime()) && (dt < min14 || dt > max14)) {
            return false;
          }
        } else if (dateRangeMode === "THIS_MONTH") {
          if (!startDateStr.startsWith(ymPrefix)) return false;
        }
      } else if (onlyToday) {
        return false;
      }

      if (keyword.trim()) {
        const q = keyword.trim().toLowerCase();
        const hay = [
          m.title,
          m.organizer_name,
          m.location_or_url,
          m.agenda,
          m.summary_notes,
          ...m.attendees.map((a) => a.name),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    list.sort((a, b) => {
      const ta = a.start_at ? new Date(a.start_at).getTime() : new Date(a.created_at).getTime();
      const tb = b.start_at ? new Date(b.start_at).getTime() : new Date(b.created_at).getTime();
      return sortAsc ? ta - tb : tb - ta;
    });

    return list;
  }, [
    meetings,
    scheduleTab,
    onlyHostedByMe,
    onlyMyAttendee,
    deptFilter,
    onlyToday,
    dateRangeMode,
    keyword,
    sortAsc,
    me,
  ]);

  const openCreateModal = () => {
    setEditingId("");
    setFormTitle("");
    setFormHasSchedule(scheduleTab === "SCHEDULED");
    setFormStartDate(getLocalTodayYmd());
    setFormStartTime("10:00");
    setFormEndTime("11:00");
    setFormLocation("본사 회의실");
    setFormAttendees(
      me
        ? [
            {
              member_id: me.instructor_id,
              name: me.name,
              department: me.department,
              rsvp: "ATTENDING",
            },
          ]
        : []
    );
    setFormAgenda("");
    setFormSummary("");
    setModalOpen(true);
  };

  const openEditModal = (item: HqMeetingItem) => {
    setEditingId(item.id);
    setFormTitle(item.title);
    setFormHasSchedule(item.has_schedule);
    if (item.start_at) {
      const d = new Date(item.start_at);
      if (!Number.isNaN(d.getTime())) {
        setFormStartDate(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
            2,
            "0"
          )}-${String(d.getDate()).padStart(2, "0")}`
        );
        setFormStartTime(
          `${String(d.getHours()).padStart(2, "0")}:${String(
            d.getMinutes()
          ).padStart(2, "0")}`
        );
      }
    }
    if (item.end_at) {
      const ed = new Date(item.end_at);
      if (!Number.isNaN(ed.getTime())) {
        setFormEndTime(
          `${String(ed.getHours()).padStart(2, "0")}:${String(
            ed.getMinutes()
          ).padStart(2, "0")}`
        );
      }
    }
    setFormLocation(item.location_or_url || "");
    setFormAttendees(item.attendees || []);
    setFormAgenda(item.agenda || "");
    setFormSummary(item.summary_notes || "");
    setModalOpen(true);
  };

  const toggleAttendeeMember = (memberId: string, name: string, dept: string) => {
    setFormAttendees((prev) => {
      const exists = prev.some((a) => a.member_id === memberId || a.name === name);
      if (exists) {
        return prev.filter((a) => a.member_id !== memberId && a.name !== name);
      }
      return [
        ...prev,
        { member_id: memberId, name, department: dept, rsvp: "ATTENDING" },
      ];
    });
  };

  const handleSaveMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      alert("미팅 제목을 입력해 주세요.");
      return;
    }
    if (formHasSchedule && !/^\d{4}-\d{2}-\d{2}$/.test(formStartDate)) {
      alert("미팅 일자를 선택해 주세요.");
      return;
    }
    setSubmitting(true);
    try {
      const normStartHm = (formStartTime || "10:00").slice(0, 5);
      const normEndHm = (formEndTime || "11:00").slice(0, 5);
      const startIso = formHasSchedule
        ? `${formStartDate}T${normStartHm}:00+09:00`
        : null;
      const endIso = formHasSchedule
        ? `${formStartDate}T${normEndHm}:00+09:00`
        : null;

      const res = await hqFetch<{
        success: boolean;
        data: { meetings: HqMeetingItem[] };
      }>("/api/hq/meetings", {
        method: "POST",
        body: {
          action: "SAVE",
          id: editingId || undefined,
          title: formTitle.trim(),
          has_schedule: formHasSchedule,
          start_at: startIso,
          end_at: endIso,
          location_or_url: formLocation.trim(),
          attendees: formAttendees,
          agenda: formAgenda.trim(),
          summary_notes: formSummary.trim(),
        },
      });
      setMeetings(res.data?.meetings || []);
      setScheduleTab(formHasSchedule ? "SCHEDULED" : "UNSCHEDULED");
      if (formHasSchedule && startIso && dateRangeMode === "14DAYS") {
        const dt = new Date(startIso);
        const now = new Date();
        const min14 = new Date(now);
        min14.setDate(now.getDate() - 14);
        min14.setHours(0, 0, 0, 0);
        const max14 = new Date(now);
        max14.setDate(now.getDate() + 14);
        max14.setHours(23, 59, 59, 999);
        if (!Number.isNaN(dt.getTime()) && (dt < min14 || dt > max14)) {
          setDateRangeMode("ALL");
        }
      }
      setModalOpen(false);
    } catch (err: any) {
      alert(err?.message || "미팅 저장 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRsvpChange = async (
    meetingId: string,
    rsvp: HqMeetingRsvpStatus
  ) => {
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { meetings: HqMeetingItem[] };
      }>("/api/hq/meetings", {
        method: "POST",
        body: { action: "RSVP", id: meetingId, rsvp },
      });
      setMeetings(res.data?.meetings || []);
    } catch (err: any) {
      alert(err?.message || "참석 상태 변경 실패");
    }
  };

  const handleDeleteMeeting = async () => {
    if (!editingId) return;
    if (!confirm("이 미팅 일정을 삭제하시겠습니까?")) return;
    setSubmitting(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { meetings: HqMeetingItem[] };
      }>("/api/hq/meetings", {
        method: "POST",
        body: { action: "DELETE", id: editingId },
      });
      setMeetings(res.data?.meetings || []);
      setModalOpen(false);
    } catch (err: any) {
      alert(err?.message || "삭제 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const cycleDateRangeMode = () => {
    if (dateRangeMode === "14DAYS") setDateRangeMode("THIS_MONTH");
    else if (dateRangeMode === "THIS_MONTH") setDateRangeMode("ALL");
    else setDateRangeMode("14DAYS");
  };

  return (
    <div className="min-h-full bg-white flex flex-col">
      {/* 상단 타이틀 & 액션 바 */}
      <div className="px-7 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">💬</span>
          <h1 className="text-[17px] font-extrabold text-slate-900">미팅</h1>
        </div>

        <div className="flex items-center gap-2">
          {searchOpen ? (
            <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg px-2.5 py-1.5">
              <span className="text-xs text-slate-400">🔍</span>
              <input
                autoFocus
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="제목, 참석자, 회의록 검색..."
                className="bg-transparent text-xs font-semibold text-slate-800 outline-none w-48"
              />
              <button
                type="button"
                onClick={() => {
                  setKeyword("");
                  setSearchOpen(false);
                }}
                className="text-xs text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              title="검색"
              className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm transition-colors"
            >
              🔍
            </button>
          )}

          <button
            type="button"
            onClick={() => setSortAsc((prev) => !prev)}
            title={sortAsc ? "일시 오름차순 정렬 중" : "일시 내림차순 정렬 중"}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm font-bold transition-colors"
          >
            {sortAsc ? "↑↓" : "↓↑"}
          </button>

          <button
            type="button"
            onClick={() =>
              setViewMode((prev) => (prev === "LIST" ? "CALENDAR" : "LIST"))
            }
            title={viewMode === "LIST" ? "보드/일정 카드로 보기" : "목록으로 보기"}
            className={`w-8 h-8 rounded-lg border flex items-center justify-center text-sm transition-colors ${
              viewMode === "CALENDAR"
                ? "border-slate-800 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            {viewMode === "LIST" ? "📅" : "☰"}
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="px-3.5 py-2 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-extrabold shadow-xs transition-colors flex items-center gap-1"
          >
            <span>+</span>
            <span>미팅 추가</span>
          </button>
        </div>
      </div>

      {/* 필터 바 */}
      <div className="px-7 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* 일정 있음 / 일정 없음 세그먼트 */}
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
            <button
              type="button"
              onClick={() => setScheduleTab("SCHEDULED")}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                scheduleTab === "SCHEDULED"
                  ? "bg-white text-blue-600 shadow-xs ring-1 ring-blue-500/40"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              일정 있음
            </button>
            <button
              type="button"
              onClick={() => setScheduleTab("UNSCHEDULED")}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                scheduleTab === "UNSCHEDULED"
                  ? "bg-white text-blue-600 shadow-xs ring-1 ring-blue-500/40"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              일정 없음
            </button>
          </div>

          {/* 미팅 일시 필터 칩 */}
          {scheduleTab === "SCHEDULED" && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs">
              <button
                type="button"
                onClick={cycleDateRangeMode}
                className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900"
              >
                <span>📅</span>
                <span className="text-slate-500 font-semibold">미팅 일시</span>
                <span className="font-extrabold text-slate-800">
                  {dateRangeMode === "14DAYS"
                    ? "오늘 ± 14일"
                    : dateRangeMode === "THIS_MONTH"
                    ? "이번 달"
                    : "전체 기간"}
                </span>
              </button>
              {dateRangeMode !== "ALL" && (
                <button
                  type="button"
                  onClick={() => setDateRangeMode("ALL")}
                  className="text-slate-400 hover:text-slate-700 ml-0.5"
                  title="기간 제한 해제"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* 내가 주최한 미팅 */}
          <button
            type="button"
            onClick={() => setOnlyHostedByMe((v) => !v)}
            className={`px-2.5 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              onlyHostedByMe
                ? "bg-blue-50 border-blue-300 text-blue-700 font-bold"
                : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
            }`}
          >
            <span>👤</span>
            <span>내가 주최한 미팅</span>
          </button>

          {/* 오늘 미팅 */}
          <button
            type="button"
            onClick={() => setOnlyToday((v) => !v)}
            className={`px-2.5 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              onlyToday
                ? "bg-blue-50 border-blue-300 text-blue-700 font-bold"
                : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
            }`}
          >
            <span>🕒</span>
            <span>오늘 미팅</span>
          </button>

          {onlyMyAttendee && (
            <button
              type="button"
              onClick={() => setOnlyMyAttendee(false)}
              className="px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold flex items-center gap-1"
            >
              <span>🙋 내가 참석하는 미팅</span>
              <span>✕</span>
            </button>
          )}

          {deptFilter !== "ALL" && (
            <button
              type="button"
              onClick={() => setDeptFilter("ALL")}
              className="px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold flex items-center gap-1"
            >
              <span>🏢 {deptFilter}</span>
              <span>✕</span>
            </button>
          )}

          {/* + 필터 추가 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setExtraFilterOpen((v) => !v)}
              className="px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700"
            >
              + 필터 추가
            </button>
            {extraFilterOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-52 rounded-xl bg-white border border-slate-200 shadow-lg p-2 z-30 space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setOnlyMyAttendee((v) => !v);
                    setExtraFilterOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-between"
                >
                  <span>🙋 내가 참석자인 미팅</span>
                  {onlyMyAttendee && <span className="text-emerald-600">✓</span>}
                </button>
                <div className="pt-1 border-t border-slate-100 px-3 py-1 text-[11px] font-bold text-slate-400">
                  조직별 필터
                </div>
                {departments.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setDeptFilter(d);
                      setExtraFilterOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-between"
                  >
                    <span>{d}</span>
                    {deptFilter === d && (
                      <span className="text-emerald-600">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={resetFilters}
          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200/80 text-xs font-bold text-slate-600 transition-colors"
        >
          초기화
        </button>
      </div>

      {/* 본문 영역 */}
      <div className="flex-1">
        {viewMode === "LIST" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 pl-8 pr-4 w-[38%]">제목</th>
                  <th className="py-3 px-4 w-[20%]">시작 일시</th>
                  <th className="py-3 px-4 w-[16%]">참석자</th>
                  <th className="py-3 px-4 w-[14%]">대화 기록 · 요약</th>
                  <th className="py-3 pl-4 pr-8 w-[12%]">참석 상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-28 text-center text-slate-400 font-semibold"
                    >
                      미팅 목록을 불러오는 중입니다...
                    </td>
                  </tr>
                ) : filteredMeetings.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-28 text-center text-[13px] font-bold text-slate-700"
                    >
                      {scheduleTab === "SCHEDULED"
                        ? "예정된 미팅이 없어요."
                        : "등록된 일정 없는 미팅이 없어요."}
                    </td>
                  </tr>
                ) : (
                  filteredMeetings.map((m) => {
                    const myAtt = me
                      ? m.attendees.find(
                          (a) =>
                            a.member_id === me.instructor_id ||
                            a.name === me.name
                        )
                      : undefined;
                    const myRsvp = myAtt?.rsvp || "ATTENDING";

                    return (
                      <tr
                        key={m.id}
                        onClick={() => openEditModal(m)}
                        className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 pl-8 pr-4">
                          <div className="font-bold text-slate-900 text-[13px]">
                            {m.title}
                          </div>
                          {m.location_or_url && (
                            <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-md">
                              📍 {m.location_or_url} · 주최 {m.organizer_name}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-slate-700 font-semibold whitespace-nowrap">
                          {m.has_schedule
                            ? formatMeetingDateTime(m.start_at, m.end_at)
                            : "일정 없음"}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center -space-x-1.5">
                            {m.attendees.slice(0, 4).map((att, idx) => (
                              <span
                                key={`${att.name}-${idx}`}
                                title={`${att.name} (${RSVP_META[att.rsvp].label})`}
                                className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 border-2 border-white text-[10px] font-extrabold text-slate-700"
                              >
                                {att.name.slice(-2)}
                              </span>
                            ))}
                            {m.attendees.length > 4 && (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 border-2 border-white text-[10px] font-bold text-white">
                                +{m.attendees.length - 4}
                              </span>
                            )}
                            <span className="ml-2.5 text-[11px] text-slate-500 font-semibold">
                              {m.attendees.length}명
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          {m.summary_notes ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-bold text-[11px]">
                              📝 요약 기록됨
                            </span>
                          ) : (
                            <span className="text-slate-400">기록 없음</span>
                          )}
                        </td>
                        <td
                          className="py-3.5 pl-4 pr-8"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <select
                            value={myRsvp}
                            onChange={(e) =>
                              handleRsvpChange(
                                m.id,
                                e.target.value as HqMeetingRsvpStatus
                              )
                            }
                            className={`px-2.5 py-1 rounded-lg border text-[11px] font-extrabold outline-none cursor-pointer ${RSVP_META[myRsvp].badgeClass}`}
                          >
                            <option value="ATTENDING">참석</option>
                            <option value="MAYBE">미정</option>
                            <option value="DECLINED">불참</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* 카드/보드형 뷰 */
          <div className="p-7">
            {filteredMeetings.length === 0 ? (
              <div className="py-24 text-center text-[13px] font-bold text-slate-700">
                예정된 미팅이 없어요.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredMeetings.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => openEditModal(m)}
                    className="p-4 rounded-2xl border border-slate-200 hover:border-brand/50 hover:shadow-sm transition-all cursor-pointer bg-white space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-extrabold text-slate-900">
                        {m.title}
                      </h3>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-bold shrink-0">
                        {m.attendees.length}명
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-blue-600">
                      {m.has_schedule
                        ? formatMeetingDateTime(m.start_at, m.end_at)
                        : "일정 없음 (상시 회의록)"}
                    </div>
                    {m.location_or_url && (
                      <div className="text-xs text-slate-500 truncate">
                        📍 {m.location_or_url}
                      </div>
                    )}
                    {m.summary_notes && (
                      <p className="text-xs text-slate-600 line-clamp-2 bg-slate-50 rounded-xl p-2.5 border border-slate-100">
                        {m.summary_notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 미팅 추가 / 상세 회의록 모달 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-extrabold text-slate-900">
                {editingId ? "미팅 상세 · 회의록 요약" : "새 미팅 추가"}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handleSaveMeeting}
              className="flex-1 overflow-y-auto p-6 space-y-4"
            >
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  미팅 제목 *
                </label>
                <input
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="예: 2027 상반기 신간 기획 회의 / 주간 편집회의"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-900 focus:border-brand outline-none"
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formHasSchedule}
                    onChange={(e) => setFormHasSchedule(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>미팅 일시 지정하기 (해제 시 &apos;일정 없음&apos; 회의록으로 보관)</span>
                </label>
              </div>

              {formHasSchedule && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      미팅 일자
                    </label>
                    <input
                      type="date"
                      value={formStartDate}
                      onChange={(e) => setFormStartDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      시작 시각
                    </label>
                    <input
                      type="time"
                      value={formStartTime}
                      onChange={(e) => setFormStartTime(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      종료 시각
                    </label>
                    <input
                      type="time"
                      value={formEndTime}
                      onChange={(e) => setFormEndTime(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  회의 장소 또는 화상 링크
                </label>
                <input
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="예: 본사 대회의실 / Google Meet 링크"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    참석 구성원 ({formAttendees.length}명 선택됨)
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setFormAttendees(
                        activeMembers.map((m) => ({
                          member_id: m.instructor_id,
                          name: m.name,
                          department: m.department,
                          rsvp: "ATTENDING",
                        }))
                      )
                    }
                    className="text-[11px] font-bold text-brand hover:underline"
                  >
                    전체 재직자 선택
                  </button>
                </div>
                <div className="max-h-36 overflow-y-auto p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-wrap gap-1.5">
                  {activeMembers.map((m) => {
                    const selected = formAttendees.some(
                      (a) => a.member_id === m.instructor_id || a.name === m.name
                    );
                    return (
                      <button
                        key={m.instructor_id}
                        type="button"
                        onClick={() =>
                          toggleAttendeeMember(
                            m.instructor_id,
                            m.name,
                            m.department
                          )
                        }
                        className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition-all ${
                          selected
                            ? "bg-brand text-white border-brand shadow-2xs"
                            : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        {m.name}{" "}
                        <span className="opacity-75 text-[10px]">
                          {m.department}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  사전 안건 (Agenda)
                </label>
                <textarea
                  rows={2}
                  value={formAgenda}
                  onChange={(e) => setFormAgenda(e.target.value)}
                  placeholder="논의할 주요 안건을 입력해 주세요."
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-medium text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  대화 기록 · 요약 (회의록 / 결정 사항)
                </label>
                <textarea
                  rows={4}
                  value={formSummary}
                  onChange={(e) => setFormSummary(e.target.value)}
                  placeholder="미팅 후 주요 논의 결과와 Action Item을 기록하면 목록에 요약 배지가 표시됩니다."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-medium text-slate-800"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <div>
                  {editingId && (isHrManager || isHqAdmin || true) && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleDeleteMeeting}
                      className="px-3.5 py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-bold"
                    >
                      미팅 삭제
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold"
                  >
                    닫기
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-extrabold shadow-xs disabled:opacity-50"
                  >
                    {submitting ? "저장 중..." : editingId ? "변경사항 저장" : "미팅 등록"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
