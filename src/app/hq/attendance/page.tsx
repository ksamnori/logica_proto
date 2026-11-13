// src/app/hq/attendance/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useHqShell } from "@/components/hq/HqShellContext";
import {
  ATTENDANCE_MODES,
  getRankMeta,
  WEEKLY_BASE_MINUTES,
  WEEKLY_MAX_MINUTES,
  WEEKLY_WARN_MINUTES,
} from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import type { HqAttendanceRecord, HqWorkMode } from "@/lib/hq/types";

const SELECTABLE_MODES: HqWorkMode[] = [
  "OFFICE",
  "FLEX_08",
  "FLEX_10",
  "FLEX_11",
  "REMOTE",
  "OUTSIDE",
];

function formatMinutesKo(mins: number): string {
  const safe = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

function formatClock(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function HqAttendancePage() {
  const router = useRouter();
  const { me, members, isHrManager, refreshAttendanceState } = useHqShell();

  const [nowClock, setNowClock] = useState(() => new Date());
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [memberFilter, setMemberFilter] = useState("ALL");

  const [todayStr, setTodayStr] = useState("");
  const [weekStartStr, setWeekStartStr] = useState("");
  const [weekEndStr, setWeekEndStr] = useState("");
  const [myToday, setMyToday] = useState<HqAttendanceRecord | null>(null);
  const [myWeeklyMinutes, setMyWeeklyMinutes] = useState(0);
  const [todayRecords, setTodayRecords] = useState<HqAttendanceRecord[]>([]);
  const [weeklySummary, setWeeklySummary] = useState<Record<string, number>>({});
  const [records, setRecords] = useState<HqAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 출근/근무형태 입력 폼
  const [selectedMode, setSelectedMode] = useState<HqWorkMode>("OFFICE");
  const [locationNote, setLocationNote] = useState(
    ATTENDANCE_MODES.OFFICE.defaultLocation
  );
  const [memo, setMemo] = useState("");

  // 근태 정정/수기 입력 모달
  const [editOpen, setEditOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editMode, setEditMode] = useState<HqWorkMode>("OFFICE");
  const [editInTime, setEditInTime] = useState("09:00");
  const [editOutTime, setEditOutTime] = useState("18:00");
  const [editLocation, setEditLocation] = useState("");
  const [editMemo, setEditMemo] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNowClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadAttendance = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: {
          todayStr: string;
          weekStartStr: string;
          weekEndStr: string;
          myToday: HqAttendanceRecord | null;
          myWeeklyMinutes: number;
          todayRecords: HqAttendanceRecord[];
          weeklySummary: Record<string, number>;
          records: HqAttendanceRecord[];
        };
      }>(`/api/hq/attendance?month=${month}`);

      setTodayStr(res.data.todayStr || "");
      setWeekStartStr(res.data.weekStartStr || "");
      setWeekEndStr(res.data.weekEndStr || "");
      setMyToday(res.data.myToday || null);
      setMyWeeklyMinutes(res.data.myWeeklyMinutes || 0);
      setTodayRecords(res.data.todayRecords || []);
      setWeeklySummary(res.data.weeklySummary || {});
      setRecords(res.data.records || []);

      if (res.data.myToday) {
        const m = res.data.myToday.work_mode;
        if (m !== "LEAVE") setSelectedMode(m);
        setLocationNote(
          res.data.myToday.location_note ||
            ATTENDANCE_MODES[m]?.defaultLocation ||
            ""
        );
        setMemo(res.data.myToday.memo || "");
      }
    } catch {
      // ignore initial error when schema missing
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    loadAttendance();
    const onSync = () => loadAttendance();
    window.addEventListener("hq:attendance-updated", onSync);
    return () => window.removeEventListener("hq:attendance-updated", onSync);
  }, [loadAttendance]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status === "재직"),
    [members]
  );

  const canManageTeam = Boolean(isHrManager || (me && me.rank_level >= 3));

  const todayMap = useMemo(() => {
    const map = new Map<string, HqAttendanceRecord>();
    todayRecords.forEach((r) => map.set(r.instructor_id, r));
    return map;
  }, [todayRecords]);

  // 오늘 15인 근무 현황 통계
  const todayStats = useMemo(() => {
    let office = 0;
    let remote = 0;
    let outside = 0;
    let leave = 0;
    let done = 0;
    todayRecords.forEach((r) => {
      if (r.status === "LEAVE" || r.status === "HALF_LEAVE" || r.work_mode === "LEAVE") {
        leave += 1;
      } else if (r.status === "DONE") {
        done += 1;
      } else if (r.work_mode === "REMOTE") {
        remote += 1;
      } else if (r.work_mode === "OUTSIDE") {
        outside += 1;
      } else {
        office += 1;
      }
    });
    const notCheckedIn = Math.max(
      0,
      activeMembers.length - todayRecords.length
    );
    return { office, remote, outside, leave, done, notCheckedIn };
  }, [todayRecords, activeMembers.length]);

  const filteredRecords = useMemo(() => {
    if (memberFilter === "ALL") return records;
    return records.filter((r) => r.instructor_id === memberFilter);
  }, [records, memberFilter]);

  const handleSelectMode = (mode: HqWorkMode) => {
    setSelectedMode(mode);
    setLocationNote(ATTENDANCE_MODES[mode].defaultLocation);
  };

  const handleCheckIn = async () => {
    setSubmitting(true);
    try {
      await hqFetch("/api/hq/attendance", {
        method: "POST",
        body: {
          action: "CHECK_IN",
          work_mode: selectedMode,
          location_note: locationNote,
          memo,
        },
      });
      await Promise.all([loadAttendance(), refreshAttendanceState()]);
    } catch (err: any) {
      alert(err?.message || "출근 체크인 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateMode = async () => {
    setSubmitting(true);
    try {
      await hqFetch("/api/hq/attendance", {
        method: "POST",
        body: {
          action: "CHANGE_MODE",
          work_mode: selectedMode,
          location_note: locationNote,
          memo,
        },
      });
      await Promise.all([loadAttendance(), refreshAttendanceState()]);
      alert("근무 형태 및 근무지 메모가 변경되었습니다.");
    } catch (err: any) {
      alert(err?.message || "변경 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckOut = async () => {
    if (!confirm("오늘 업무를 종료하고 퇴근 기록을 남기시겠습니까?")) return;
    setSubmitting(true);
    try {
      await hqFetch("/api/hq/attendance", {
        method: "POST",
        body: { action: "CHECK_OUT", memo },
      });
      await Promise.all([loadAttendance(), refreshAttendanceState()]);
    } catch (err: any) {
      alert(err?.message || "퇴근 처리 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const openCorrectionModal = (rec?: HqAttendanceRecord) => {
    if (rec) {
      setEditTargetId(rec.instructor_id);
      setEditDate(rec.work_date);
      setEditMode(rec.work_mode);
      setEditInTime(rec.check_in_at ? formatClock(rec.check_in_at) : "09:00");
      setEditOutTime(rec.check_out_at ? formatClock(rec.check_out_at) : "18:00");
      setEditLocation(rec.location_note || "");
      setEditMemo(rec.memo || "");
    } else {
      setEditTargetId(me?.instructor_id || "");
      setEditDate(todayStr || new Date().toISOString().slice(0, 10));
      setEditMode("OFFICE");
      setEditInTime("09:00");
      setEditOutTime("18:00");
      setEditLocation(ATTENDANCE_MODES.OFFICE.defaultLocation);
      setEditMemo("");
    }
    setEditOpen(true);
  };

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetMember =
      members.find((m) => m.instructor_id === editTargetId) || me;
    if (!targetMember) return;

    setSubmitting(true);
    try {
      await hqFetch("/api/hq/attendance", {
        method: "POST",
        body: {
          action: "MANUAL_UPSERT",
          instructor_id: targetMember.instructor_id,
          member_name: targetMember.name,
          department: targetMember.department,
          work_date: editDate,
          work_mode: editMode,
          check_in_time: editMode === "LEAVE" ? "" : editInTime,
          check_out_time: editMode === "LEAVE" ? "" : editOutTime,
          location_note: editLocation,
          memo: editMemo,
        },
      });
      setEditOpen(false);
      await Promise.all([loadAttendance(), refreshAttendanceState()]);
    } catch (err: any) {
      alert(err?.message || "근태 저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const weeklyPct = Math.min(
    100,
    Math.round((myWeeklyMinutes / WEEKLY_MAX_MINUTES) * 100)
  );
  const isOver50h = myWeeklyMinutes >= 50 * 60;
  const isOver45h = myWeeklyMinutes >= WEEKLY_WARN_MINUTES;

  return (
    <div className="p-6 max-w-[1440px] mx-auto w-full space-y-6">
      {/* 상단: 출퇴근 체크인 스튜디오 & 주 52시간 게이지 */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* 좌측 7칸: 오늘의 출퇴근 · 유연근무 선택 */}
        <section className="xl:col-span-7 rounded-2xl bg-white border border-slate-200 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-brand/10 text-brand text-xs font-extrabold">
                  출판 본부 유연근무제
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {todayStr || nowClock.toISOString().slice(0, 10)}
                </span>
              </div>
              <h3 className="text-lg font-extrabold text-slate-900 mt-1">
                오늘 근무 형태 선택 및 출퇴근 체크인
              </h3>
            </div>

            <div className="text-right">
              <div className="text-2xl font-black tracking-tight text-slate-900 tabular-nums">
                {nowClock.toLocaleTimeString("ko-KR", { hour12: false })}
              </div>
              <div className="text-[11px] font-semibold text-slate-400">
                대한민국 표준시 (KST)
              </div>
            </div>
          </div>

          {/* 근무 형태 6종 버튼 */}
          <div className="mt-4">
            <label className="block text-xs font-bold text-slate-600 mb-2">
              근무 유형 선택 (시차출퇴근 · 재택 원고집필/교정 · 인쇄소 감리 외근)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SELECTABLE_MODES.map((modeKey) => {
                const m = ATTENDANCE_MODES[modeKey];
                const active = selectedMode === modeKey;
                return (
                  <button
                    key={modeKey}
                    type="button"
                    onClick={() => handleSelectMode(modeKey)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      active
                        ? "border-brand bg-blue-50/70 ring-2 ring-brand/20"
                        : "border-slate-200 hover:border-slate-300 bg-slate-50/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-base">{m.icon}</span>
                      <span className="text-[10px] font-bold text-slate-500">
                        {m.scheduleText}
                      </span>
                    </div>
                    <div className="text-xs font-extrabold text-slate-800 mt-1">
                      {m.shortLabel}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 근무 장소 & 오늘 주요 과업 메모 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">
                근무 위치 / 현장명
              </label>
              <input
                value={locationNote}
                onChange={(e) => setLocationNote(e.target.value)}
                placeholder="예: 본사 편집실 / 파주 인쇄소 감리 / 재택"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">
                오늘 집중 업무 메모 (팀 공유)
              </label>
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="예: 플라토 S3 2교 마감 / 저자 미팅"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800"
              />
            </div>
          </div>

          {/* 출근 / 퇴근 액션 바 */}
          <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              {!myToday ? (
                <span>오늘 아직 출근 전입니다. 근무 유형을 선택하고 출근을 눌러주세요.</span>
              ) : myToday.status === "WORKING" ? (
                <span className="font-bold text-blue-700">
                  🟢 출근 시각 {formatClock(myToday.check_in_at)} · 현재{" "}
                  {ATTENDANCE_MODES[myToday.work_mode]?.shortLabel} 중
                </span>
              ) : myToday.status === "DONE" ? (
                <span className="font-bold text-emerald-700">
                  ✅ 출근 {formatClock(myToday.check_in_at)} ~ 퇴근{" "}
                  {formatClock(myToday.check_out_at)} (실근무{" "}
                  {formatMinutesKo(myToday.worked_minutes)})
                </span>
              ) : (
                <span className="font-bold text-emerald-700">
                  🌴 오늘 승인된 휴가·반차 일정이 등록되어 있습니다 ({myToday.location_note})
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {!myToday ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleCheckIn}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-sm transition-colors disabled:opacity-50"
                >
                  🟢 출근 체크인
                </button>
              ) : myToday.status === "WORKING" ? (
                <>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleUpdateMode}
                    className="px-3.5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors"
                  >
                    근무형태·위치 변경
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleCheckOut}
                    className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold shadow-sm transition-colors disabled:opacity-50"
                  >
                    🔴 퇴근 기록하기
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => openCorrectionModal(myToday)}
                  className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold"
                >
                  ✏️ 오늘 기록 정정
                </button>
              )}
            </div>
          </div>
        </section>

        {/* 우측 5칸: 주 52시간 실시간 게이지 & 휴가 바로가기 */}
        <section className="xl:col-span-5 rounded-2xl bg-white border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-slate-500">
                주 52시간 근로시간 모니터 ({weekStartStr} ~ {weekEndStr})
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                  isOver50h
                    ? "bg-rose-100 text-rose-700"
                    : isOver45h
                    ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {isOver50h
                  ? "🚨 52시간 한도 임박"
                  : isOver45h
                  ? "⚠️ 마감 연장근무 주의"
                  : "정상 범위"}
              </span>
            </div>

            <div className="mt-3 flex items-baseline justify-between">
              <div>
                <span className="text-2xl font-black text-slate-900">
                  {formatMinutesKo(myWeeklyMinutes)}
                </span>
                <span className="text-xs font-semibold text-slate-500 ml-2">
                  / 최대 52시간 (소정 40시간 + 연장 12시간)
                </span>
              </div>
              <span className="text-sm font-extrabold text-brand">
                {weeklyPct}%
              </span>
            </div>

            {/* 프로그레스 바 (40h 기준선 76.9% 표시) */}
            <div className="relative h-3.5 rounded-full bg-slate-100 overflow-hidden mt-3 border border-slate-200">
              <div
                className={`h-full transition-all duration-500 ${
                  isOver50h
                    ? "bg-rose-500"
                    : isOver45h
                    ? "bg-amber-500"
                    : "bg-brand"
                }`}
                style={{ width: `${weeklyPct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-slate-500/70"
                style={{
                  left: `${Math.round(
                    (WEEKLY_BASE_MINUTES / WEEKLY_MAX_MINUTES) * 100
                  )}%`,
                }}
                title="소정근로 40시간 기준선"
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-400 font-semibold mt-1">
              <span>0h</span>
              <span>소정 40h</span>
              <span>법정 상한 52h</span>
            </div>

            {/* 내 연차 요약 */}
            <div className="mt-5 grid grid-cols-3 gap-2.5">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] text-slate-500 font-semibold">
                  부여 연차
                </div>
                <div className="text-base font-extrabold text-slate-800 mt-0.5">
                  {me?.annual_leave_total ?? 15}일
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] text-slate-500 font-semibold">
                  사용 연차
                </div>
                <div className="text-base font-extrabold text-amber-700 mt-0.5">
                  {me?.annual_leave_used ?? 0}일
                </div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                <div className="text-[11px] text-emerald-700 font-semibold">
                  잔여 연차
                </div>
                <div className="text-base font-extrabold text-emerald-800 mt-0.5">
                  {me?.annual_leave_remain ?? 15}일
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => openCorrectionModal()}
              className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold"
            >
              ✏️ 출퇴근 누락 · 수기 보정
            </button>
            <button
              type="button"
              onClick={() => router.push("/hq/approvals?new=1&type=LEAVE")}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm"
            >
              🌴 연차 · 반차 · 마감대체휴무 신청
            </button>
          </div>
        </section>
      </div>

      {/* 중단: 오늘 우리 본부 15인 실시간 근무 보드 (Who's Where Today) */}
      <section className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              오늘 본부 구성원 근무 현황 보드 (실시간 공유)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              누가 본사 편집실에 있는지, 재택 교정 중인지, 인쇄소 감리 외근 중인지 한눈에 확인하세요.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
              🏢 본사·시차 {todayStats.office}명
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 border border-teal-200">
              🏠 재택 {todayStats.remote}명
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
              🖨️ 외근·감리 {todayStats.outside}명
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
              🌴 휴가·반차 {todayStats.leave}명
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200">
              ⚪ 미체크인 {todayStats.notCheckedIn}명
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {activeMembers.map((m) => {
            const rec = todayMap.get(m.instructor_id);
            const rankMeta = getRankMeta(m.rank_code);
            const modeMeta = rec ? ATTENDANCE_MODES[rec.work_mode] : null;
            const weekMins = weeklySummary[m.instructor_id] || 0;

            return (
              <div
                key={m.instructor_id}
                className={`p-3.5 rounded-xl border transition-all ${
                  rec?.status === "WORKING"
                    ? "bg-white border-blue-200 shadow-xs"
                    : rec?.work_mode === "LEAVE"
                    ? "bg-emerald-50/40 border-emerald-200"
                    : "bg-slate-50/60 border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                      <span>{m.name}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${rankMeta.badgeClass}`}
                      >
                        {m.job_title}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {m.department}
                    </div>
                  </div>

                  {rec ? (
                    <span
                      className={`px-2 py-0.5 rounded-md border text-[10px] font-extrabold shrink-0 ${
                        rec.status === "DONE"
                          ? "bg-slate-100 text-slate-600 border-slate-200"
                          : modeMeta?.badgeClass || ""
                      }`}
                    >
                      {rec.status === "DONE"
                        ? "✅ 퇴근완료"
                        : `${modeMeta?.icon || ""} ${modeMeta?.shortLabel || "근무"}`}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-400 text-[10px] font-bold">
                      출근 전
                    </span>
                  )}
                </div>

                <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
                  <span className="truncate">
                    {rec
                      ? rec.work_mode === "LEAVE"
                        ? `🌴 ${rec.location_note || "연차"}`
                        : `${formatClock(rec.check_in_at)} 출근 · ${
                            rec.location_note || ""
                          }`
                      : "체크인 대기"}
                  </span>
                  {canManageTeam && weekMins > 0 && (
                    <span
                      className={`font-bold shrink-0 ml-2 ${
                        weekMins >= WEEKLY_WARN_MINUTES
                          ? "text-rose-600"
                          : "text-slate-500"
                      }`}
                    >
                      주 {Math.round((weekMins / 60) * 10) / 10}h
                    </span>
                  )}
                </div>
                {rec?.memo && (
                  <div className="mt-1 text-[11px] text-brand font-semibold truncate">
                    📌 {rec.memo}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 하단: 월간 출퇴근 상세 기록부 */}
      <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              월간 출퇴근 · 유연근무 기록부
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              근로기준법 출퇴근 시각 기록 보존 및 연장근무 산정 기초 자료입니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-800"
            />
            {canManageTeam && (
              <select
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-800 bg-white"
              >
                <option value="ALL">전체 구성원</option>
                {activeMembers.map((m) => (
                  <option key={m.instructor_id} value={m.instructor_id}>
                    {m.name} ({m.department})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500 uppercase">
                <th className="py-3 px-4">일자</th>
                <th className="py-3 px-4">구성원 / 부서</th>
                <th className="py-3 px-4">근무 형태</th>
                <th className="py-3 px-4">출근 시각</th>
                <th className="py-3 px-4">퇴근 시각</th>
                <th className="py-3 px-4">실근무 / 연장</th>
                <th className="py-3 px-4">근무지 · 업무 메모</th>
                <th className="py-3 px-4 text-right">보정</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    근태 데이터를 불러오는 중입니다...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    해당 월에 등록된 근태 기록이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r) => {
                  const mMeta =
                    ATTENDANCE_MODES[r.work_mode] || ATTENDANCE_MODES.OFFICE;
                  const canEditRow =
                    r.instructor_id === me?.instructor_id || canManageTeam;
                  return (
                    <tr key={r.attendance_id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-bold text-slate-800 whitespace-nowrap">
                        {r.work_date}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-bold text-slate-900">
                          {r.member_name}
                        </span>
                        <span className="text-slate-400 ml-1.5">
                          {r.department}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${mMeta.badgeClass}`}
                        >
                          {mMeta.icon} {mMeta.shortLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-700 tabular-nums">
                        {formatClock(r.check_in_at)}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-700 tabular-nums">
                        {r.status === "WORKING" ? (
                          <span className="text-blue-600 font-bold">근무중</span>
                        ) : (
                          formatClock(r.check_out_at)
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {r.work_mode === "LEAVE" ? (
                          <span className="text-emerald-700 font-bold">
                            유급휴가
                          </span>
                        ) : (
                          <>
                            <span className="font-bold text-slate-800">
                              {formatMinutesKo(r.worked_minutes)}
                            </span>
                            {r.overtime_minutes > 0 && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold">
                                연장 +{formatMinutesKo(r.overtime_minutes)}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-[280px] truncate">
                        {r.location_note}
                        {r.memo ? ` · ${r.memo}` : ""}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {canEditRow && (
                          <button
                            type="button"
                            onClick={() => openCorrectionModal(r)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 text-[11px] font-bold"
                          >
                            수정
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 근태 보정 모달 */}
      {editOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-extrabold text-slate-900">
              출퇴근 기록 보정 / 수기 등록
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              외근 직출·직퇴 또는 체크인 누락 시 실제 근무 시각을 입력해 주세요.
            </p>

            <form onSubmit={handleSaveCorrection} className="mt-4 space-y-3.5">
              {canManageTeam && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    대상 구성원
                  </label>
                  <select
                    value={editTargetId}
                    onChange={(e) => setEditTargetId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                  >
                    {activeMembers.map((m) => (
                      <option key={m.instructor_id} value={m.instructor_id}>
                        {m.name} ({m.department} · {m.job_title})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    근무 일자
                  </label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    근무 유형
                  </label>
                  <select
                    value={editMode}
                    onChange={(e) => setEditMode(e.target.value as HqWorkMode)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                  >
                    {Object.entries(ATTENDANCE_MODES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.shortLabel}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {editMode !== "LEAVE" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      출근 시각
                    </label>
                    <input
                      type="time"
                      value={editInTime}
                      onChange={(e) => setEditInTime(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      퇴근 시각
                    </label>
                    <input
                      type="time"
                      value={editOutTime}
                      onChange={(e) => setEditOutTime(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  근무 장소
                </label>
                <input
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  보정 사유 / 업무 메모
                </label>
                <input
                  value={editMemo}
                  onChange={(e) => setEditMemo(e.target.value)}
                  placeholder="예: 파주 인쇄소 오전 직출로 인한 수기 등록"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-bold disabled:opacity-50"
                >
                  저장하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
