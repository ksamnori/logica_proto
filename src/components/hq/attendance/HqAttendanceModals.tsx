// src/components/hq/attendance/HqAttendanceModals.tsx
"use client";

import React, { useState } from "react";
import { ATTENDANCE_MODES } from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import type {
  HqAccessTerminalProvider,
  HqAttendanceRecord,
  HqMember,
  HqWorkFormPolicy,
  HqWorkMode,
} from "@/lib/hq/types";

// ============================================================================
// 1. 단건 근무 · 휴게 추가/정정 모달
// ============================================================================
export interface EntryModalInitialState {
  attendanceId?: string;
  targetMemberId: string;
  workDate: string;
  workMode: HqWorkMode;
  statusOverride?: "" | "HALF_LEAVE";
  policyLabel?: string;
  inTime: string;
  outTime: string;
  breakMinutes: number;
  locationNote: string;
  memo: string;
  focusBreak?: boolean;
}

export function AttendanceEntryModal({
  isOpen,
  initial,
  me,
  activeMembers,
  canManageTeam,
  workFormPolicies,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  initial: EntryModalInitialState;
  me: HqMember | null;
  activeMembers: HqMember[];
  canManageTeam: boolean;
  workFormPolicies: HqWorkFormPolicy[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [targetId, setTargetId] = useState(initial.targetMemberId);
  const [workDate, setWorkDate] = useState(initial.workDate);
  const [workMode, setWorkMode] = useState<HqWorkMode>(initial.workMode);
  const [halfLeave, setHalfLeave] = useState(
    initial.statusOverride === "HALF_LEAVE"
  );
  const [inTime, setInTime] = useState(initial.inTime);
  const [outTime, setOutTime] = useState(initial.outTime);
  const [breakMinutes, setBreakMinutes] = useState(initial.breakMinutes);
  const [locationNote, setLocationNote] = useState(initial.locationNote);
  const [memo, setMemo] = useState(initial.memo);
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const mapPolicyToMode = (name: string): HqWorkMode => {
    if (name.includes("원격") || name.includes("재택")) return "REMOTE";
    if (name.includes("외근") || name.includes("출장") || name.includes("감리"))
      return "OUTSIDE";
    return "OFFICE";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const target =
      activeMembers.find((m) => m.instructor_id === targetId) || me;
    if (!target) return;

    setBusy(true);
    try {
      await hqFetch("/api/hq/attendance", {
        method: "POST",
        body: {
          action: "MANUAL_UPSERT",
          instructor_id: target.instructor_id,
          member_name: target.name,
          department: target.department,
          work_date: workDate,
          work_mode: workMode,
          status_override: halfLeave ? "HALF_LEAVE" : "",
          check_in_time: workMode === "LEAVE" && !halfLeave ? "" : inTime,
          check_out_time: workMode === "LEAVE" && !halfLeave ? "" : outTime,
          break_minutes: Number(breakMinutes) || 0,
          location_note: locationNote,
          memo,
        },
      });
      await onSaved();
      onClose();
    } catch (err: any) {
      alert(err?.message || "근무 기록 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!initial.attendanceId) return;
    if (!confirm("등록된 해당 일자 근무 기록을 삭제하시겠습니까?")) return;
    setBusy(true);
    try {
      await hqFetch("/api/hq/attendance", {
        method: "POST",
        body: {
          action: "DELETE_RECORD",
          attendance_id: initial.attendanceId,
        },
      });
      await onSaved();
      onClose();
    } catch (err: any) {
      alert(err?.message || "삭제 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              {initial.focusBreak
                ? "☕ 휴게 시간 및 근무 시각 설정"
                : initial.attendanceId
                ? "근무 상세 기록 · 정정"
                : `${initial.policyLabel || "근무"} 일정 추가`}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              출·퇴근 시각과 휴게시간을 반영해 실근무 및 연장근무 시간이 자동 계산됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                대상 구성원
              </label>
              <select
                disabled={!canManageTeam}
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-800 bg-white disabled:bg-slate-100"
              >
                {activeMembers.map((m) => (
                  <option key={m.instructor_id} value={m.instructor_id}>
                    {m.name} ({m.department})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                근무 일자
              </label>
              <input
                type="date"
                required
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-800"
              />
            </div>
          </div>

          {/* 근무 정책 빠른 선택 (설정 > 근무 정책 연동) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              근무 형태 선택
            </label>
            <div className="flex flex-wrap gap-1.5">
              {workFormPolicies.map((pol) => {
                const mapped = mapPolicyToMode(pol.name);
                const isSelected =
                  workMode === mapped &&
                  (pol.name !== "출장"
                    ? locationNote !== "출장지"
                    : locationNote === "출장지");
                return (
                  <button
                    key={pol.id}
                    type="button"
                    onClick={() => {
                      setWorkMode(mapped);
                      setHalfLeave(false);
                      setLocationNote(
                        pol.name === "출장"
                          ? "출장지"
                          : ATTENDANCE_MODES[mapped]?.defaultLocation || pol.name
                      );
                    }}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center gap-1.5 ${
                      isSelected
                        ? "border-brand bg-blue-50 text-brand ring-1 ring-brand/20"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span>{pol.icon}</span>
                    <span>{pol.name}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setWorkMode("FLEX_08");
                  setHalfLeave(false);
                  setInTime("08:00");
                  setOutTime("17:00");
                  setLocationNote("본사 (08시 시차)");
                }}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                  workMode === "FLEX_08"
                    ? "border-brand bg-blue-50 text-brand"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                🌅 시차(08시)
              </button>
              <button
                type="button"
                onClick={() => {
                  setWorkMode("FLEX_10");
                  setHalfLeave(false);
                  setInTime("10:00");
                  setOutTime("19:00");
                  setLocationNote("본사 (10시 시차)");
                }}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                  workMode === "FLEX_10"
                    ? "border-brand bg-blue-50 text-brand"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                🕙 시차(10시)
              </button>
              <button
                type="button"
                onClick={() => {
                  setWorkMode("LEAVE");
                  setHalfLeave(false);
                  setLocationNote("연차");
                }}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                  workMode === "LEAVE" && !halfLeave
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                🏖️ 전일 휴가
              </button>
              <button
                type="button"
                onClick={() => {
                  setWorkMode("LEAVE");
                  setHalfLeave(true);
                  setInTime("14:00");
                  setOutTime("18:00");
                  setBreakMinutes(0);
                  setLocationNote("반차");
                }}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                  halfLeave
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                🌤️ 반차(4h 근무)
              </button>
            </div>
          </div>

          {(workMode !== "LEAVE" || halfLeave) && (
            <div className="grid grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  출근 시각
                </label>
                <input
                  type="time"
                  value={inTime}
                  onChange={(e) => setInTime(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  퇴근 시각 (비우면 근무중)
                </label>
                <input
                  type="time"
                  value={outTime}
                  onChange={(e) => setOutTime(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  ☕ 휴게 시간(분)
                </label>
                <select
                  value={breakMinutes}
                  onChange={(e) => setBreakMinutes(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                >
                  <option value={0}>0분 (없음)</option>
                  <option value={30}>30분</option>
                  <option value={60}>60분 (1시간)</option>
                  <option value={90}>90분 (1시간 30분)</option>
                  <option value={120}>120분 (2시간)</option>
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                근무지 · 현장명
              </label>
              <input
                value={locationNote}
                onChange={(e) => setLocationNote(e.target.value)}
                placeholder="예: 본사 편집실 / 파주 인쇄소 / 재택"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                업무 · 사유 메모
              </label>
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="예: 신간 원고 집중 집필 / 하판 감리"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <div>
              {initial.attendanceId && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleDelete}
                  className="px-3.5 py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-bold"
                >
                  기록 삭제
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold shadow-xs disabled:opacity-50"
              >
                {busy ? "저장 중..." : "저장하기"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 2. 반복 일정 일괄 등록 모달 (+ 추가하기 > 반복 일정)
// ============================================================================
export function RecurringScheduleModal({
  isOpen,
  me,
  defaultStartDate,
  defaultEndDate,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  me: HqMember | null;
  defaultStartDate: string;
  defaultEndDate: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [weekdays, setWeekdays] = useState<number[]>([2, 4]); // 예: 화·목
  const [workMode, setWorkMode] = useState<HqWorkMode>("REMOTE");
  const [inTime, setInTime] = useState("09:00");
  const [outTime, setOutTime] = useState("18:00");
  const [breakMinutes, setBreakMinutes] = useState(60);
  const [locationNote, setLocationNote] = useState("재택 원고집필");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const dayDefs = [
    { dow: 1, label: "월" },
    { dow: 2, label: "화" },
    { dow: 3, label: "수" },
    { dow: 4, label: "목" },
    { dow: 5, label: "금" },
    { dow: 6, label: "토" },
    { dow: 0, label: "일" },
  ];

  const toggleDow = (dow: number) => {
    setWeekdays((prev) =>
      prev.includes(dow) ? prev.filter((x) => x !== dow) : [...prev, dow]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!me) return;
    if (weekdays.length === 0) {
      alert("반복할 요일을 최소 1개 선택해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await hqFetch<{ success: boolean; data: { count: number } }>(
        "/api/hq/attendance",
        {
          method: "POST",
          body: {
            action: "BATCH_RECURRING_UPSERT",
            instructor_id: me.instructor_id,
            member_name: me.name,
            department: me.department,
            start_date: startDate,
            end_date: endDate,
            weekdays,
            work_mode: workMode,
            check_in_time: inTime,
            check_out_time: outTime,
            break_minutes: breakMinutes,
            location_note: locationNote,
            memo,
          },
        }
      );
      alert(`총 ${res.data?.count || 0}일의 반복 근무 일정이 등록되었습니다.`);
      await onSaved();
      onClose();
    } catch (err: any) {
      alert(err?.message || "반복 일정 등록 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              🔄 반복 근무 일정 등록
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              정기 원격근무·시차출퇴근·외근 요일을 선택해 기간 내 일괄 등록합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                시작일
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                종료일 (최대 3개월)
              </label>
              <input
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              반복 요일 선택
            </label>
            <div className="flex items-center gap-1.5">
              {dayDefs.map((d) => {
                const active = weekdays.includes(d.dow);
                return (
                  <button
                    key={d.dow}
                    type="button"
                    onClick={() => toggleDow(d.dow)}
                    className={`w-10 h-10 rounded-xl border text-xs font-extrabold transition-all ${
                      active
                        ? "bg-brand text-white border-brand shadow-xs"
                        : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                근무 유형
              </label>
              <select
                value={workMode}
                onChange={(e) => {
                  const m = e.target.value as HqWorkMode;
                  setWorkMode(m);
                  setLocationNote(ATTENDANCE_MODES[m]?.defaultLocation || "");
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
              >
                <option value="REMOTE">🏠 원격근무 (재택 집필·교정)</option>
                <option value="OFFICE">🏢 본사 정규근무</option>
                <option value="FLEX_08">🌅 시차출퇴근 (08:00~17:00)</option>
                <option value="FLEX_10">🕙 시차출퇴근 (10:00~19:00)</option>
                <option value="OUTSIDE">🚗 외근 · 인쇄소 감리</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                휴게 시간
              </label>
              <select
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
              >
                <option value={60}>60분 (1시간)</option>
                <option value={30}>30분</option>
                <option value={0}>없음</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                시작 시각
              </label>
              <input
                type="time"
                value={inTime}
                onChange={(e) => setInTime(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                종료 시각
              </label>
              <input
                type="time"
                value={outTime}
                onChange={(e) => setOutTime(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              위치 · 업무 메모
            </label>
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="예: 매주 화·목 신간 집중 집필 데이"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2 rounded-xl bg-brand hover:bg-blue-700 text-white text-xs font-extrabold shadow-xs disabled:opacity-50"
            >
              {busy ? "일괄 등록 중..." : "반복 일정 등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 3. 근무 기록 업로드 모달 (표준 CSV + ADT 캡스/세콤 출입기록 통합 업로드)
// ============================================================================
export function AttendanceUploadModal({
  isOpen,
  activeMembers,
  onClose,
  onUploaded,
}: {
  isOpen: boolean;
  activeMembers: HqMember[];
  onClose: () => void;
  onUploaded: () => Promise<void>;
}) {
  const [uploadTab, setUploadTab] = useState<"STANDARD" | "TERMINAL">(
    "STANDARD"
  );
  const [provider, setProvider] =
    useState<HqAccessTerminalProvider>("adt_caps");
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const downloadSampleTemplate = () => {
    const sampleName = activeMembers[0]?.name || "김문수";
    const lines = [
      "근무일자,성명,출근시각,퇴근시각,휴게분,근무형태,메모",
      `2026-11-16,${sampleName},09:00,18:00,60,근무,본사 정규 근무`,
      `2026-11-17,${sampleName},09:00,19:30,60,원격근무,교재 원고 마감`,
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "천종현수학연구소_근무기록_업로드양식.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    let decoded = new TextDecoder("utf-8").decode(buf);
    if (decoded.includes("\uFFFD")) {
      try {
        decoded = new TextDecoder("euc-kr").decode(buf);
      } catch {
        // ignore fallback error
      }
    }
    setRawText(decoded);
  };

  const handleImport = async () => {
    if (!rawText.trim()) {
      alert("먼저 업로드할 CSV 파일을 선택해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const lines = rawText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (uploadTab === "STANDARD") {
        const parsedRows: any[] = [];
        lines.slice(1).forEach((line) => {
          const cols = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
          const [dateRaw, nameRaw, inRaw, outRaw, breakRaw, modeRaw, memoRaw] = cols;
          if (!dateRaw || !nameRaw) return;
          const matched = activeMembers.find((m) => m.name === nameRaw);
          if (!matched) return;

          let workMode: HqWorkMode = "OFFICE";
          if (modeRaw?.includes("원격") || modeRaw?.includes("재택")) {
            workMode = "REMOTE";
          } else if (modeRaw?.includes("외근") || modeRaw?.includes("출장")) {
            workMode = "OUTSIDE";
          } else if (modeRaw?.includes("휴가") || modeRaw?.includes("연차")) {
            workMode = "LEAVE";
          }

          parsedRows.push({
            instructor_id: matched.instructor_id,
            member_name: matched.name,
            department: matched.department,
            work_date: dateRaw.replace(/\./g, "-").replace(/\s+/g, ""),
            work_mode: workMode,
            check_in_time: inRaw || "",
            check_out_time: outRaw || "",
            break_minutes: breakRaw ? Number(breakRaw) : 60,
            memo: memoRaw || "",
          });
        });

        if (parsedRows.length === 0) {
          alert(
            "일치하는 재직 구성원 이름이 포함된 유효 행이 없습니다. 양식을 확인해 주세요."
          );
          setBusy(false);
          return;
        }

        const res = await hqFetch<{ success: boolean; data: { count: number } }>(
          "/api/hq/attendance",
          {
            method: "POST",
            body: { action: "BULK_CSV_UPSERT", rows: parsedRows },
          }
        );
        alert(`총 ${res.data?.count || 0}건의 근무 기록이 반영되었습니다.`);
      } else {
        // ADT 캡스 / 세콤 단말기 CSV 파싱 -> /api/hq/integrations IMPORT_TERMINAL 호출
        const events = lines.slice(1).map((line) => {
          const cols = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
          return {
            date: cols[0] || "",
            time: cols[1] || "",
            userNo: cols[2] || "",
            userName: cols[3] || "",
            eventType: cols[4] || "",
          };
        });
        const res = await hqFetch<{
          success: boolean;
          data: { upsertedDays: number; unmatchedUsers: string[] };
        }>("/api/hq/integrations", {
          method: "POST",
          body: {
            action: "IMPORT_TERMINAL",
            provider,
            events,
          },
        });
        alert(
          `단말기 기록 반영 완료: ${res.data?.upsertedDays || 0}건 처리됨`
        );
      }

      await onUploaded();
      onClose();
    } catch (err: any) {
      alert(err?.message || "파일 업로드 처리 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              📥 근무 기록 일괄 업로드
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              엑셀(CSV) 양식 또는 ADT 캡스 · 세콤 출입단말기 내역 파일을 바로 반영합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 font-bold"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100">
            <button
              type="button"
              onClick={() => setUploadTab("STANDARD")}
              className={`py-2 rounded-lg text-xs font-extrabold transition-all ${
                uploadTab === "STANDARD"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-500"
              }`}
            >
              📄 표준 근무기록 CSV
            </button>
            <button
              type="button"
              onClick={() => setUploadTab("TERMINAL")}
              className={`py-2 rounded-lg text-xs font-extrabold transition-all ${
                uploadTab === "TERMINAL"
                  ? "bg-white text-blue-700 shadow-xs"
                  : "text-slate-500"
              }`}
            >
              🛡️ ADT 캡스 · 세콤 CSV
            </button>
          </div>

          {uploadTab === "STANDARD" ? (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-600">
                <div className="font-bold text-slate-800">
                  표준 업로드 양식 다운로드
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  근무일자, 성명, 출근시각, 퇴근시각, 휴게분, 근무형태, 메모
                </div>
              </div>
              <button
                type="button"
                onClick={downloadSampleTemplate}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-bold text-slate-700 shrink-0"
              >
                양식 받기
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">
                출입단말기 제조사 선택
              </label>
              <select
                value={provider}
                onChange={(e) =>
                  setProvider(e.target.value as HqAccessTerminalProvider)
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
              >
                <option value="adt_caps">ADT 캡스 (권장 · 본사 사용)</option>
                <option value="secom">에스원 세콤 (SECOM)</option>
                <option value="kt_telecop">KT 텔레캅</option>
              </select>
              <p className="text-[11px] text-slate-500">
                한글 EUC-KR / UTF-8 CSV 모두 자동 인식하며, 당일 최초 태그를 출근·최종 태그를 퇴근으로 자동 집계합니다.
              </p>
            </div>
          )}

          <label className="block border-2 border-dashed border-slate-300 hover:border-brand rounded-2xl p-6 text-center cursor-pointer transition-colors bg-slate-50/40">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="text-2xl mb-1">📂</div>
            <div className="text-xs font-extrabold text-slate-800">
              {fileName || "클릭하여 CSV 파일 선택"}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              .csv 파일 지원 (최대 500건 동시 반영)
            </div>
          </label>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold"
            >
              닫기
            </button>
            <button
              type="button"
              disabled={busy || !rawText}
              onClick={handleImport}
              className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold disabled:opacity-40"
            >
              {busy ? "반영 중..." : "근무 기록 반영하기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 4. CSV 다운로드 유틸리티 (구성원 근무 기록 / 구성원 초과 근무 기록)
// ============================================================================
export function exportAttendanceCsv(
  kind: "ALL" | "OVERTIME",
  records: HqAttendanceRecord[],
  rangeLabel: string
) {
  const targetRows =
    kind === "OVERTIME"
      ? records.filter((r) => Number(r.overtime_minutes || 0) > 0)
      : records;

  const fmtTime = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const fmtHm = (mins: number) => {
    const safe = Math.max(0, Math.round(mins || 0));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
  };

  const header =
    kind === "OVERTIME"
      ? [
          "근무일자",
          "성명",
          "부서",
          "출근시각",
          "퇴근시각",
          "총실근무",
          "초과근무(시간)",
          "초과근무(분)",
          "근무형태",
          "메모",
        ]
      : [
          "근무일자",
          "성명",
          "부서",
          "근무형태",
          "상태",
          "출근시각",
          "퇴근시각",
          "휴게(분)",
          "실근무시간",
          "초과근무시간",
          "근무지",
          "업무메모",
        ];

  const csvLines = [
    header.join(","),
    ...targetRows.map((r) => {
      const modeName = ATTENDANCE_MODES[r.work_mode]?.shortLabel || r.work_mode;
      const escapeCsv = (val: string) =>
        `"${String(val || "").replace(/"/g, '""')}"`;

      if (kind === "OVERTIME") {
        return [
          r.work_date,
          escapeCsv(r.member_name),
          escapeCsv(r.department),
          fmtTime(r.check_in_at),
          fmtTime(r.check_out_at),
          fmtHm(r.worked_minutes),
          fmtHm(r.overtime_minutes),
          String(r.overtime_minutes || 0),
          escapeCsv(modeName),
          escapeCsv(r.memo || ""),
        ].join(",");
      }

      return [
        r.work_date,
        escapeCsv(r.member_name),
        escapeCsv(r.department),
        escapeCsv(modeName),
        r.status,
        fmtTime(r.check_in_at),
        fmtTime(r.check_out_at),
        String(r.break_minutes || 0),
        fmtHm(r.worked_minutes),
        fmtHm(r.overtime_minutes),
        escapeCsv(r.location_note || ""),
        escapeCsv(r.memo || ""),
      ].join(",");
    }),
  ];

  const blob = new Blob(["\uFEFF" + csvLines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    kind === "OVERTIME"
      ? `구성원_초과근무기록_${rangeLabel}.csv`
      : `구성원_근무기록_${rangeLabel}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
