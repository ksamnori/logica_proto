// src/components/hq/mobile/HqMobileHomeTab.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { HqCalendarEventItem } from "@/app/api/hq/calendar/route";
import { useHqShell } from "@/components/hq/HqShellContext";
import { hqFetch } from "@/lib/hq/clientApi";
import {
  ATTENDANCE_MODES,
  getRankMeta,
} from "@/lib/hq/constants";
import type { HqAttendanceRecord, HqWorkMode } from "@/lib/hq/types";

export type MobileQuickAction =
  | "OPEN_APPROVALS"
  | "NEW_APPROVAL"
  | "REQUEST_LEAVE"
  | "SNAP_EXPENSE"
  | "OPEN_CALENDAR"
  | "OPEN_MEETINGS"
  | "START_AI_RECORD"
  | "OPEN_MESSENGER";

interface Props {
  onAction: (action: MobileQuickAction) => void;
}

const CHECKIN_MODE_OPTIONS: {
  mode: HqWorkMode;
  short: string;
  sub: string;
  icon: string;
}[] = [
  { mode: "OFFICE", short: "정규 출근", sub: "09:00~18:00", icon: "🏢" },
  { mode: "FLEX_08", short: "시차 08시", sub: "08:00~17:00", icon: "🌅" },
  { mode: "FLEX_10", short: "시차 10시", sub: "10:00~19:00", icon: "🕙" },
  { mode: "FLEX_11", short: "시차 11시", sub: "11:00~20:00", icon: "🕚" },
  { mode: "REMOTE", short: "재택근무", sub: "원고·교정", icon: "🏠" },
  { mode: "OUTSIDE", short: "외근·감리", sub: "인쇄소·미팅", icon: "🖨️" },
];

function getErrMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function formatKstTime(iso?: string | null): string {
  if (!iso) return "--:--";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "--:--";
  return dt.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDurationKo(mins: number): string {
  const safe = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  return `${m}분`;
}

export default function HqMobileHomeTab({ onAction }: Props) {
  const {
    me,
    pendingApprovalCount,
    unreadChatCount,
    myTodayAttendance,
    quickCheckIn,
    quickCheckOut,
    refreshAttendanceState,
  } = useHqShell();

  const [selectedMode, setSelectedMode] = useState<HqWorkMode>("OFFICE");
  const [locationNote, setLocationNote] = useState("");
  const [checkoutMemo, setCheckoutMemo] = useState("");
  const [clockBusy, setClockBusy] = useState(false);
  const [modePickerOpen, setModePickerOpen] = useState(false);

  const [weekRecords, setWeekRecords] = useState<HqAttendanceRecord[]>([]);
  const [todayTeamRecords, setTodayTeamRecords] = useState<
    HqAttendanceRecord[]
  >([]);
  const [todayEvents, setTodayEvents] = useState<HqCalendarEventItem[]>([]);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const loadBriefing = useCallback(async () => {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const todayYmd = kst.toISOString().slice(0, 10);
    const year = kst.getUTCFullYear();
    const month = kst.getUTCMonth() + 1;

    const [attRes, calRes] = await Promise.all([
      hqFetch<{
        success: boolean;
        data: {
          weekStartStr: string;
          weekEndStr: string;
          todayRecords: HqAttendanceRecord[];
          records: HqAttendanceRecord[];
        };
      }>("/api/hq/attendance").catch(() => null),
      hqFetch<{
        success: boolean;
        data: { events: HqCalendarEventItem[] };
      }>(`/api/hq/calendar?year=${year}&month=${month}`).catch(() => null),
    ]);

    if (attRes?.data) {
      const ws = attRes.data.weekStartStr || "";
      const we = attRes.data.weekEndStr || "";
      const mine = (attRes.data.records || [])
        .filter(
          (r) =>
            r.instructor_id === me?.instructor_id &&
            (!ws || r.work_date >= ws) &&
            (!we || r.work_date <= we)
        )
        .sort((a, b) => b.work_date.localeCompare(a.work_date));
      setWeekRecords(mine);
      setTodayTeamRecords(attRes.data.todayRecords || []);
    }

    if (calRes?.data?.events) {
      const todays = calRes.data.events.filter(
        (ev) => ev.startDate <= todayYmd && ev.endDate >= todayYmd
      );
      setTodayEvents(todays.slice(0, 5));
    }
  }, [me?.instructor_id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadBriefing();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadBriefing, myTodayAttendance]);

  const rankMeta = getRankMeta(me?.rank_code);
  const currentModeMeta = myTodayAttendance
    ? ATTENDANCE_MODES[myTodayAttendance.work_mode] || ATTENDANCE_MODES.OFFICE
    : ATTENDANCE_MODES[selectedMode] || ATTENDANCE_MODES.OFFICE;

  const liveTodayMinutes = useMemo(() => {
    if (!myTodayAttendance) return 0;
    if (
      myTodayAttendance.status === "WORKING" &&
      myTodayAttendance.check_in_at &&
      !myTodayAttendance.check_out_at
    ) {
      const elapsed = Math.max(
        0,
        Math.round(
          (nowTick - new Date(myTodayAttendance.check_in_at).getTime()) / 60000
        )
      );
      const brk = Number(myTodayAttendance.break_minutes ?? 60);
      const deduct =
        brk > 0 && elapsed > 240 ? Math.min(brk, elapsed - 240) : 0;
      return Math.max(0, elapsed - deduct);
    }
    return Number(myTodayAttendance.worked_minutes || 0);
  }, [myTodayAttendance, nowTick]);

  const handleCheckIn = async (modeOverride?: HqWorkMode) => {
    const targetMode = modeOverride || selectedMode;
    setClockBusy(true);
    try {
      const defaultLoc = ATTENDANCE_MODES[targetMode]?.defaultLocation || "";
      await quickCheckIn(targetMode, locationNote.trim() || defaultLoc);
      setLocationNote("");
      setModePickerOpen(false);
      await loadBriefing();
    } catch (err: unknown) {
      alert(getErrMsg(err, "출근 체크인 중 오류가 발생했습니다."));
    } finally {
      setClockBusy(false);
    }
  };

  const handleSwitchMode = async (nextMode: HqWorkMode) => {
    setClockBusy(true);
    try {
      const defaultLoc = ATTENDANCE_MODES[nextMode]?.defaultLocation || "";
      await hqFetch("/api/hq/attendance", {
        method: "POST",
        body: {
          action: "CHANGE_MODE",
          work_mode: nextMode,
          location_note: locationNote.trim() || defaultLoc,
        },
      });
      await refreshAttendanceState();
      setModePickerOpen(false);
      await loadBriefing();
    } catch (err: unknown) {
      alert(getErrMsg(err, "근무 형태 전환 실패"));
    } finally {
      setClockBusy(false);
    }
  };

  const handleCheckOut = async () => {
    if (!confirm("오늘 업무를 마무리하고 퇴근 처리하시겠습니까?")) return;
    setClockBusy(true);
    try {
      if (checkoutMemo.trim()) {
        await hqFetch("/api/hq/attendance", {
          method: "POST",
          body: { action: "CHECK_OUT", memo: checkoutMemo.trim() },
        });
        await refreshAttendanceState();
      } else {
        await quickCheckOut();
      }
      setCheckoutMemo("");
      await loadBriefing();
    } catch (err: unknown) {
      alert(getErrMsg(err, "퇴근 처리 중 오류가 발생했습니다."));
    } finally {
      setClockBusy(false);
    }
  };

  const remoteOrOutsidePeers = useMemo(
    () =>
      todayTeamRecords.filter(
        (r) =>
          r.instructor_id !== me?.instructor_id &&
          (r.work_mode === "REMOTE" ||
            r.work_mode === "OUTSIDE" ||
            r.work_mode === "LEAVE")
      ),
    [todayTeamRecords, me?.instructor_id]
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-4 pb-8 space-y-4">
      {/* 1. 상단 인사 & 원터치 출퇴근 · 주 52시간 히어로 카드 */}
      <section className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-brand text-white p-5 shadow-lg border border-slate-800 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-full bg-white/15 text-[11px] font-bold text-blue-100">
                {me?.department || "본부"} · Lv.{rankMeta.level}
              </span>
              {me && !me.is_ghost && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-400/20 border border-emerald-300/30 text-[11px] font-bold text-emerald-200">
                  잔여연차 {me.annual_leave_remain}일
                </span>
              )}
            </div>
            <h2 className="text-lg font-extrabold mt-2 tracking-tight">
              {me?.name || "구성원"} {me?.job_title || rankMeta.defaultTitle}님 👋
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              오늘도 좋은 하루 보내세요!
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] text-slate-300 font-semibold">
              {new Date().toLocaleDateString("ko-KR", {
                month: "long",
                day: "numeric",
                weekday: "short",
              })}
            </div>
          </div>
        </div>

        {/* 출퇴근 컨트롤 박스 */}
        {me?.is_ghost ? (
          <div className="rounded-2xl bg-white/10 border border-white/15 px-4 py-3 text-xs font-bold text-slate-200 flex items-center gap-2">
            <span>👻</span>
            <span>유령 모드 계정 (근태 기록 및 사내 목록 비노출)</span>
          </div>
        ) : !myTodayAttendance ? (
          <div className="rounded-2xl bg-white/10 border border-white/15 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-emerald-200">
                ⏱️ 오늘의 근무 형태 선택 후 출근
              </span>
              <span className="text-[11px] text-slate-300">
                {ATTENDANCE_MODES[selectedMode]?.scheduleText}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {CHECKIN_MODE_OPTIONS.map((opt) => {
                const active = selectedMode === opt.mode;
                return (
                  <button
                    key={opt.mode}
                    type="button"
                    onClick={() => setSelectedMode(opt.mode)}
                    className={`rounded-xl px-2 py-2 text-left border transition-all ${
                      active
                        ? "bg-white text-slate-900 border-white shadow-sm"
                        : "bg-white/5 text-slate-200 border-white/10 active:bg-white/15"
                    }`}
                  >
                    <div className="text-xs font-extrabold flex items-center gap-1">
                      <span>{opt.icon}</span>
                      <span className="truncate">{opt.short}</span>
                    </div>
                    <div
                      className={`text-[10px] mt-0.5 truncate ${
                        active ? "text-slate-500 font-semibold" : "text-slate-400"
                      }`}
                    >
                      {opt.sub}
                    </div>
                  </button>
                );
              })}
            </div>

            {(selectedMode === "OUTSIDE" || selectedMode === "REMOTE") && (
              <input
                type="text"
                value={locationNote}
                onChange={(e) => setLocationNote(e.target.value)}
                placeholder={
                  selectedMode === "OUTSIDE"
                    ? "외근 장소 입력 (예: 파주 인쇄소 감리)"
                    : "재택 작업 메모 (예: 3학년 사고력 초교 검토)"
                }
                className="w-full rounded-xl bg-slate-950/40 border border-white/15 px-3 py-2 text-xs text-white placeholder:text-slate-400 outline-none focus:border-emerald-300"
              />
            )}

            <button
              type="button"
              disabled={clockBusy}
              onClick={() => handleCheckIn()}
              className="w-full py-3 rounded-xl bg-emerald-500 active:bg-emerald-600 text-white font-extrabold text-sm shadow-md transition-colors disabled:opacity-50"
            >
              {clockBusy
                ? "출근 기록 중..."
                : `🟢 ${currentModeMeta.shortLabel} 시작하기`}
            </button>
          </div>
        ) : myTodayAttendance.status === "WORKING" ? (
          <div className="rounded-2xl bg-white/10 border border-white/15 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg">{currentModeMeta.icon}</span>
                <div className="min-w-0">
                  <div className="text-xs font-extrabold text-white truncate">
                    {myTodayAttendance.location_note === "자동 근무 기록"
                      ? "자동 근무 기록 중"
                      : currentModeMeta.shortLabel}{" "}
                    · {formatKstTime(myTodayAttendance.check_in_at)} 출근
                  </div>
                  <div className="text-[11px] text-emerald-200 font-semibold truncate">
                    실근무 경과 {formatDurationKo(liveTodayMinutes)}
                    {myTodayAttendance.location_note
                      ? ` · ${myTodayAttendance.location_note}`
                      : ""}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModePickerOpen((v) => !v)}
                className="px-2.5 py-1.5 rounded-lg bg-white/15 text-[11px] font-bold text-white shrink-0"
              >
                형태변경▾
              </button>
            </div>

            {modePickerOpen && (
              <div className="rounded-xl bg-slate-950/50 border border-white/10 p-2.5 space-y-2">
                <div className="text-[11px] font-bold text-slate-300">
                  근무 중 외근·재택 등으로 즉시 전환
                </div>
                <input
                  type="text"
                  value={locationNote}
                  onChange={(e) => setLocationNote(e.target.value)}
                  placeholder="변경 장소/메모 (선택)"
                  className="w-full rounded-lg bg-white/10 border border-white/15 px-2.5 py-1.5 text-xs text-white placeholder:text-slate-400 outline-none"
                />
                <div className="grid grid-cols-3 gap-1.5">
                  {CHECKIN_MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.mode}
                      type="button"
                      disabled={clockBusy}
                      onClick={() => handleSwitchMode(opt.mode)}
                      className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border ${
                        myTodayAttendance.work_mode === opt.mode
                          ? "bg-emerald-500 text-white border-emerald-400"
                          : "bg-white/10 text-slate-200 border-white/10"
                      }`}
                    >
                      {opt.icon} {opt.short}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={checkoutMemo}
                onChange={(e) => setCheckoutMemo(e.target.value)}
                placeholder="퇴근 메모 (선택)"
                className="flex-1 min-w-0 rounded-xl bg-slate-950/35 border border-white/15 px-3 py-2.5 text-xs text-white placeholder:text-slate-400 outline-none"
              />
              <button
                type="button"
                disabled={clockBusy}
                onClick={handleCheckOut}
                className="px-4 py-2.5 rounded-xl bg-white text-slate-900 font-extrabold text-xs shadow-sm shrink-0 disabled:opacity-50"
              >
                {clockBusy ? "처리중..." : "🔵 퇴근하기"}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-white/10 border border-white/15 px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-extrabold text-emerald-200">
                {myTodayAttendance.status === "DONE"
                  ? "✅ 오늘 퇴근 완료"
                  : "🌴 휴가 · 반차 일정"}
              </div>
              <div className="text-[11px] text-slate-200 mt-0.5">
                {myTodayAttendance.check_in_at
                  ? `${formatKstTime(myTodayAttendance.check_in_at)} ~ ${formatKstTime(
                      myTodayAttendance.check_out_at
                    )} (${formatDurationKo(myTodayAttendance.worked_minutes)})`
                  : myTodayAttendance.location_note || "종일 일정"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setModePickerOpen((v) => !v)}
              className="px-2.5 py-1.5 rounded-lg bg-white/10 text-[11px] font-bold text-slate-200"
            >
              재출근▾
            </button>
          </div>
        )}

        {myTodayAttendance &&
          myTodayAttendance.status !== "WORKING" &&
          modePickerOpen && (
            <div className="rounded-xl bg-slate-950/50 border border-white/10 p-2.5 grid grid-cols-3 gap-1.5">
              {CHECKIN_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  disabled={clockBusy}
                  onClick={() => handleCheckIn(opt.mode)}
                  className="px-2 py-1.5 rounded-lg text-[11px] font-bold bg-white/10 text-slate-100 border border-white/10"
                >
                  {opt.icon} {opt.short}
                </button>
              ))}
            </div>
          )}
      </section>

      {/* 2. 즉시 처리 배너 (내 결재 대기 · 안 읽은 메신저) */}
      {(pendingApprovalCount > 0 || unreadChatCount > 0) && (
        <section className="space-y-2">
          {pendingApprovalCount > 0 && (
            <button
              type="button"
              onClick={() => onAction("OPEN_APPROVALS")}
              className="w-full rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 flex items-center justify-between gap-3 text-left shadow-xs active:scale-[0.99] transition-transform"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-lg">🔔</span>
                <div className="min-w-0">
                  <div className="text-xs font-extrabold text-rose-800">
                    내 결재 차례 문서 {pendingApprovalCount}건 대기 중
                  </div>
                  <div className="text-[11px] text-rose-600 truncate">
                    터치하여 바로 검토 후 승인·반려할 수 있습니다
                  </div>
                </div>
              </div>
              <span className="text-xs font-extrabold text-rose-700 shrink-0">
                열기 →
              </span>
            </button>
          )}

          {unreadChatCount > 0 && (
            <button
              type="button"
              onClick={() => onAction("OPEN_MESSENGER")}
              className="w-full rounded-2xl bg-[#fffbeb] border border-amber-200 px-4 py-3 flex items-center justify-between gap-3 text-left shadow-xs active:scale-[0.99] transition-transform"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-lg">💬</span>
                <div className="min-w-0">
                  <div className="text-xs font-extrabold text-amber-900">
                    안 읽은 사내 메신저 {unreadChatCount}건
                  </div>
                  <div className="text-[11px] text-amber-700 truncate">
                    본부 및 전국 지점 실시간 대화 확인하기
                  </div>
                </div>
              </div>
              <span className="text-xs font-extrabold text-amber-800 shrink-0">
                대화방 →
              </span>
            </button>
          )}
        </section>
      )}

      {/* 3. 모바일 핵심 4대 빠른 실행 그리드 */}
      <section className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => onAction("REQUEST_LEAVE")}
          className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs text-left flex items-center gap-3 active:bg-slate-50"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl shrink-0">
            🌴
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-slate-900">
              휴가 간편 신청
            </div>
            <div className="text-[11px] text-slate-500 truncate mt-0.5">
              연차·반차·시간차
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onAction("SNAP_EXPENSE")}
          className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs text-left flex items-center gap-3 active:bg-slate-50"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-xl shrink-0">
            📸
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-slate-900">
              영수증 촬영 정산
            </div>
            <div className="text-[11px] text-slate-500 truncate mt-0.5">
              카메라 즉시 등록
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onAction("NEW_APPROVAL")}
          className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs text-left flex items-center gap-3 active:bg-slate-50"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl shrink-0">
            ✍️
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-slate-900">
              간편 결재 기안
            </div>
            <div className="text-[11px] text-slate-500 truncate mt-0.5">
              품의·지출 상신
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onAction("START_AI_RECORD")}
          className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs text-left flex items-center gap-3 active:bg-slate-50"
        >
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center text-xl shrink-0">
            🎙️
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-slate-900">
              AI 회의 녹음
            </div>
            <div className="text-[11px] text-slate-500 truncate mt-0.5">
              화자분리 자동요약
            </div>
          </div>
        </button>
      </section>

      {/* 4. 오늘의 본부 일정 브리핑 */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
            <span>📅</span>
            <span>오늘의 본부 일정 · 미팅</span>
          </h3>
          <button
            type="button"
            onClick={() => onAction("OPEN_CALENDAR")}
            className="text-[11px] font-bold text-brand"
          >
            전체 캘린더 →
          </button>
        </div>

        {todayEvents.length === 0 ? (
          <p className="text-xs text-slate-400 py-2">
            오늘 등록된 공용 일정이나 마감 항목이 없습니다.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {todayEvents.map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={() =>
                  onAction(
                    ev.category === "MEETING" ? "OPEN_MEETINGS" : "OPEN_CALENDAR"
                  )
                }
                className="w-full py-2.5 flex items-center justify-between gap-2 text-left"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800 truncate">
                    {ev.title}
                  </div>
                  {ev.subtitle && (
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {ev.subtitle}
                    </div>
                  )}
                </div>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold shrink-0">
                  {ev.timeLabel || "종일"}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 5. 오늘 동료 유연근무/휴가 현황 & 이번 주 내 근무 기록 */}
      {remoteOrOutsidePeers.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2.5">
          <h3 className="text-xs font-extrabold text-slate-800">
            👥 오늘 재택 · 외근 · 휴가 동료 ({remoteOrOutsidePeers.length}명)
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {remoteOrOutsidePeers.map((r) => {
              const m =
                ATTENDANCE_MODES[r.work_mode] || ATTENDANCE_MODES.OFFICE;
              return (
                <span
                  key={r.attendance_id || `${r.instructor_id}-${r.work_date}`}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-bold ${m.badgeClass}`}
                >
                  <span>{m.icon}</span>
                  <span>{r.member_name}</span>
                  <span className="opacity-75">· {m.shortLabel}</span>
                </span>
              );
            })}
          </div>
        </section>
      )}

      {!me?.is_ghost && weekRecords.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2.5">
          <h3 className="text-xs font-extrabold text-slate-800">
            🕒 이번 주 내 출퇴근 기록
          </h3>
          <div className="divide-y divide-slate-100">
            {weekRecords.slice(0, 5).map((rec) => {
              const modeMeta =
                ATTENDANCE_MODES[rec.work_mode] || ATTENDANCE_MODES.OFFICE;
              return (
                <div
                  key={rec.attendance_id || rec.work_date}
                  className="py-2 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-slate-700 w-12 shrink-0">
                      {rec.work_date.slice(5).replace("-", ".")}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md border text-[10px] font-bold shrink-0 ${modeMeta.badgeClass}`}
                    >
                      {modeMeta.icon} {modeMeta.shortLabel}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-semibold shrink-0">
                    {rec.work_mode === "LEAVE"
                      ? rec.location_note || "휴가"
                      : `${formatKstTime(rec.check_in_at)} ~ ${
                          rec.check_out_at
                            ? formatKstTime(rec.check_out_at)
                            : "근무중"
                        }`}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
