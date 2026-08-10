// src/components/class/ClassWeekCalendar.tsx
// 💡 [12번] 반별 홀/짝 회차(week_type) 관리를 "휴일/보강일을 각각 폼에 입력해서 목록으로 쌓아보는"
// 방식에서, 학습관리 탭의 달력(LearningCalendar.tsx)과 같은 월간 달력 UI로 바꿔달라는 요청.
// 날짜를 직접 클릭해 휴일/보강일을 토글하고, 실제 수업일(회차)이 홀/짝 어느 쪽에 속하는지
// 달력 위에서 바로 확인할 수 있게 한다.
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  resolveClassWeekType, setClassHoliday, removeClassHoliday,
  setClassExtraSession, removeClassExtraSession, getKSTDateString, addDaysKST,
  migrateIncompleteForClassRound,
} from "@/lib/classRound";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

interface ClassWeekCalendarProps {
  classId: string;
  className: string;
  scheduleDays: string[]; // 예: ['화', '목']
  canEdit: boolean;
}

type DayMeta = {
  ymd: string;
  isHoliday: boolean;
  holidayId?: string;
  holidayReason?: string;
  isExtra: boolean;
  extraId?: string;
  extraReason?: string;
  isScheduledWeekday: boolean; // 정규 수업 요일인지(휴일 여부와 무관)
  isRegularSession: boolean; // 정규 요일이고 휴일이 아님(실제로 회차로 잡히는지)
  isSession: boolean; // isRegularSession || isExtra
  weekTypeAtSession?: "odd" | "even"; // 이 회차가 속한 홀/짝 (session일 때만)
};

export default function ClassWeekCalendar({ classId, className, scheduleDays, canEdit }: ClassWeekCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [weekType, setWeekType] = useState<string | null>(null);
  const [weekTypeUpdatedDate, setWeekTypeUpdatedDate] = useState<string | null>(null);
  const [forcedWeekType, setForcedWeekType] = useState<string | null>(null);
  const [forcedWeekTypeDate, setForcedWeekTypeDate] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [extraSessions, setExtraSessions] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  // 💡 "휴일 지정 -> 보강일 선택" 2단계 흐름의 1단계에서 방금 휴일로 지정한 날짜를 들고 있다가,
  // 2단계에서 다른 날짜를 보강일로 지정하는 순간 둘을 묶어 학부모 채팅방에 한 번에 안내한다.
  const [pendingHolidayDate, setPendingHolidayDate] = useState<string | null>(null);

  const loadAll = async () => {
    const [{ data: cRow }, { data: hRows }, { data: eRows }] = await Promise.all([
      supabase.from("class").select("week_type, week_type_updated_date, session_parity, forced_week_type, forced_week_type_date").eq("class_id", classId).maybeSingle(),
      supabase.from("class_holiday").select("*").eq("class_id", classId).order("holiday_date", { ascending: true }),
      supabase.from("class_extra_session").select("*").eq("class_id", classId).order("session_date", { ascending: true }),
    ]);
    setHolidays(hRows || []);
    setExtraSessions(eRows || []);

    if (cRow) {
      const { weekType: wt } = await resolveClassWeekType(supabase, {
        class_id: classId, class_name: className, week_type: cRow.week_type,
        week_type_updated_date: cRow.week_type_updated_date, session_parity: cRow.session_parity, scheduleDays,
        forced_week_type: cRow.forced_week_type, forced_week_type_date: cRow.forced_week_type_date,
      });
      // resolveClassWeekType이 DB를 이미 갱신했을 수 있으니 최신값을 다시 읽는다.
      const { data: fresh } = await supabase.from("class").select("week_type, week_type_updated_date, session_parity, forced_week_type, forced_week_type_date").eq("class_id", classId).maybeSingle();
      setWeekType(fresh?.week_type ?? wt);
      setWeekTypeUpdatedDate(fresh?.week_type_updated_date ?? null);
      setForcedWeekType(fresh?.forced_week_type ?? null);
      setForcedWeekTypeDate(fresh?.forced_week_type_date ?? null);
    }
  };

  useEffect(() => {
    if (classId) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const holidaySet = useMemo(() => new Map(holidays.map((h: any) => [h.holiday_date, h])), [holidays]);
  const extraSet = useMemo(() => new Map(extraSessions.map((e: any) => [e.session_date, e])), [extraSessions]);

  // 💡 anchor(week_type_updated_date) 이전 회차들은 그 시점의 홀/짝을 알 방법이 없어(과거 로그를
  // 안 남김) 그냥 회차 점만 찍는다. anchor 이후는 이번 달 안이 아니라 "anchor 다음날부터 이번 달
  // 말일까지" 하루도 안 건너뛰고 이어서 순회한다 — 예전엔 이번 달 1일부터만 돌아서, 표시 중인 달이
  // anchor보다 여러 달 뒤(예: 다음 달로 여러 번 넘김)일 때 그 사이에 실제로 지나간 회차들을
  // 건너뛰어 홀/짝이 틀리게 나오는 문제가 있었다. 회차마다(2회 단위 아님) 무조건 odd/even을 뒤집는다
  // (화 1회차=주간테스트, 목 2회차=과제오답유사, 다음주 화 3회차=주간테스트... 한 회차씩 교대).
  const dayMetaMap = useMemo(() => {
    const map = new Map<string, DayMeta>();
    const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const ymdOf = (d: number) => `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = ymdOf(d);
      const dayLabel = DAY_LABELS[new Date(ymd + "T00:00:00Z").getUTCDay()];
      const holiday = holidaySet.get(ymd);
      const extra = extraSet.get(ymd);
      const isScheduledWeekday = scheduleDays.includes(dayLabel);
      const isRegularSession = isScheduledWeekday && !holiday;
      const isSession = isRegularSession || !!extra;

      map.set(ymd, {
        ymd, isHoliday: !!holiday, holidayId: holiday?.id, holidayReason: holiday?.reason,
        isExtra: !!extra, extraId: extra?.id, extraReason: extra?.reason,
        isScheduledWeekday, isRegularSession, isSession, weekTypeAtSession: undefined,
      });
    }

    const monthEndYmd = ymdOf(daysInMonth);
    if (weekTypeUpdatedDate && weekTypeUpdatedDate <= monthEndYmd) {
      let simType: "odd" | "even" = weekType === "even" ? "even" : "odd";
      let cursor = weekTypeUpdatedDate;

      const anchorMeta = map.get(weekTypeUpdatedDate);
      if (anchorMeta && anchorMeta.isSession) anchorMeta.weekTypeAtSession = simType;

      while (cursor < monthEndYmd) {
        cursor = addDaysKST(cursor, 1);
        const dayLabel = DAY_LABELS[new Date(cursor + "T00:00:00Z").getUTCDay()];
        const holiday = holidaySet.get(cursor);
        const extra = extraSet.get(cursor);
        const isSession = (scheduleDays.includes(dayLabel) && !holiday) || !!extra;
        if (!isSession) continue;

        // 💡 예약된 강제 배정 날짜에 도달하면 토글 대신 예약된 타입으로 미리보기를 맞춘다
        // (resolveClassWeekType이 실제로 그 날짜에 도달했을 때 하는 것과 동일한 규칙).
        if (forcedWeekTypeDate && cursor === forcedWeekTypeDate && forcedWeekType) {
          simType = forcedWeekType === "even" ? "even" : "odd";
        } else {
          simType = simType === "odd" ? "even" : "odd"; // 회차마다 무조건 교대
        }
        const meta = map.get(cursor);
        if (meta) meta.weekTypeAtSession = simType;
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, scheduleDays, holidaySet, extraSet, weekType, weekTypeUpdatedDate, forcedWeekType, forcedWeekTypeDate]);

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayIndex = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDayIndex; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const todayStr = getKSTDateString();
  const selectedMeta = selectedDate ? dayMetaMap.get(selectedDate) : null;

  // 💡 그 반 학생들의 학부모 채팅방에 안내를 보낸다 — chat_room은 (instructor_id, parent_id) 쌍으로
  // 하나씩만 존재하므로(FloatingChat.tsx의 handleCreateOrOpenRoom과 동일 패턴), 방이 없으면 새로
  // 만들고 있으면 그대로 이어서 메시지만 추가한다. 발송이 실패해도 호출한 쪽의 핵심 동작(휴일/보강
  // 등록)은 이미 끝난 뒤이므로 에러를 삼키고 콘솔에만 남긴다.
  const notifyParents = async (content: string) => {
    try {
      const { data: cls } = await supabase.from("class").select("instructor_id").eq("class_id", classId).maybeSingle();
      const instId = cls?.instructor_id;
      if (!instId) return;

      const { data: enrolled } = await supabase.from("enrollment").select("student(parent_id)").eq("class_id", classId);
      const parentIds = new Set<string>();
      (enrolled || []).forEach((e: any) => { if (e.student?.parent_id) parentIds.add(e.student.parent_id); });
      if (parentIds.size === 0) return;

      for (const parentId of parentIds) {
        const { data: existing } = await supabase.from("chat_room").select("room_id").eq("instructor_id", instId).eq("parent_id", parentId).maybeSingle();
        let roomId = existing?.room_id;
        if (!roomId) {
          const { data: newRoom } = await supabase.from("chat_room").insert({ instructor_id: instId, parent_id: parentId }).select().single();
          roomId = newRoom?.room_id;
        }
        if (roomId) await supabase.from("chat_message").insert({ room_id: roomId, sender_type: "instructor", content, is_read: false });
      }
    } catch (e) { console.error("학부모 채팅 알림 발송 실패:", e); }
  };

  // 💡 휴일 지정은 바로 안내를 보내지 않는다 — 어느 날로 보강하는지까지 정해져야 학부모에게
  // 의미 있는 안내가 되므로, 여기서는 휴일만 확정하고 다음 실제로 보강일을 고를 때(finalizeMakeup)
  // 둘을 묶어 한 번에 보낸다.
  const toggleHoliday = async () => {
    if (!selectedDate || !selectedMeta) return;
    setIsBusy(true);
    try {
      if (selectedMeta.isHoliday && selectedMeta.holidayId) {
        await removeClassHoliday(supabase, selectedMeta.holidayId);
        if (pendingHolidayDate === selectedDate) setPendingHolidayDate(null);
        setReasonDraft("");
      } else {
        const { error } = await setClassHoliday(supabase, classId, selectedDate, reasonDraft);
        if (error) { alert("휴일 등록 중 오류: " + error.message); return; }
        setPendingHolidayDate(selectedDate);
        // 💡 사유는 여기서 지우지 않는다 — 다음 단계(보강일 지정)에서 그대로 이어 써서 최종
        // 안내 메시지("휴일 → 보강")에 함께 담기도록 유지한다.
      }
      await loadAll();
    } finally { setIsBusy(false); }
  };

  // 💡 보강일 없이 그냥 휴일 지정만으로 끝내고 싶을 때(예: 자율학습으로 대체, 보강 자체가 필요
  // 없는 경우) — 안내는 안 보내고 대기 상태만 벗어난다. 이미 만든 휴일 기록은 그대로 둔다.
  const cancelPendingHoliday = () => { setPendingHolidayDate(null); setReasonDraft(""); };

  // 💡 2단계: pendingHolidayDate로 잡아둔 휴일과, 지금 선택한 날짜(보강일)를 묶어 보강일로 등록하고
  // 학부모 채팅방에 "OO일 휴일 → OO일 보강" 안내를 한 번만 보낸다. 이미 뭔가 있는 날(정규 수업일 ·
  // 휴일 · 이미 보강일로 지정된 날)은 보강일로 다시 지정할 수 없다 — 버튼 자체가 disabled 처리되지만,
  // 함수 안에서도 한 번 더 막아 어떤 경로로 호출돼도 안전하게 한다.
  const finalizeMakeup = async () => {
    if (!selectedDate || !pendingHolidayDate || !selectedMeta) return;
    if (selectedMeta.isHoliday || selectedMeta.isRegularSession || selectedMeta.isExtra) return;
    setIsBusy(true);
    try {
      const { error } = await setClassExtraSession(supabase, classId, selectedDate, reasonDraft);
      if (error) { alert("보강일 등록 중 오류: " + error.message); return; }
      const hWeekday = DAY_LABELS[new Date(pendingHolidayDate + "T00:00:00Z").getUTCDay()];
      const mWeekday = DAY_LABELS[new Date(selectedDate + "T00:00:00Z").getUTCDay()];
      await notifyParents(`[${className}] 안내: ${pendingHolidayDate}(${hWeekday}) 수업이 휴일로 변경되어 ${selectedDate}(${mWeekday})로 보강합니다.${reasonDraft ? ` (사유: ${reasonDraft})` : ""}`);
      setPendingHolidayDate(null);
      setReasonDraft("");
      await loadAll();
    } finally { setIsBusy(false); }
  };

  // 💡 분기테스트처럼 정규 클리닉 대신 다른 이유로 그 날 회차 성격이 강제로 정해져야 하는 경우를
  // 위한 수동 배정. 분기테스트 등은 보통 날짜를 미리 알기 때문에 미래 날짜도 지정할 수 있어야 한다.
  //
  // - 오늘/과거 날짜: 즉시 적용. 선택한 날짜를 새 기준점(anchor)으로 못박아, 그 다음 실제 회차부터는
  //   다시 정상적으로(강제한 타입에서 시작해) 한 회차씩 번갈아 진행된다.
  // - 미래 날짜: "예약"만 걸어둔다(anchor는 건드리지 않는다). anchor를 미래로 못박으면
  //   resolveClassWeekType의 `lastDate >= today` 조기 반환에 걸려 오늘~그 미래 날짜 사이에 실제로
  //   지나가는 정규 회차(들)가 통째로 스킵되는 버그가 있었다(홀/짝 토글도 미완료 과제 이관도 전혀
  //   안 일어남). 대신 forced_week_type(_date)에 예약만 저장해두면, resolveClassWeekType이 평소처럼
  //   회차를 하나씩 순회하다가 실제로 그 날짜에 도달했을 때만 토글 대신 예약된 타입을 적용한다 —
  //   그 사이 회차들은 전혀 스킵되지 않는다.
  const forceAssignRound = async (type: "odd" | "even") => {
    if (!selectedDate) return;
    const label = type === "odd" ? "주간테스트" : "과제오답유사";

    if (selectedDate > todayStr) {
      if (!confirm(`${selectedDate} 회차를 '${label}'(으)로 예약 배정할까요?\n그 날짜가 되면 자동으로 적용되고, 그 전까지 실제 회차들은 평소대로 정상 진행됩니다.`)) return;
      setIsBusy(true);
      try {
        await supabase.from("class").update({ forced_week_type: type, forced_week_type_date: selectedDate }).eq("class_id", classId);
        await loadAll();
      } finally { setIsBusy(false); }
      return;
    }

    if (!confirm(`${selectedDate} 회차를 '${label}'(으)로 강제 배정할까요?\n이후 회차는 이 날짜를 기준으로 다시 번갈아 진행됩니다.`)) return;
    setIsBusy(true);
    try {
      // 💡 정규 회차 전환(resolveClassWeekType)이 매 회차마다 하는 미완료 과제 이관을, 강제 배정
      // 경로에서도 동일하게 해줘야 한다 — 안 그러면 이 날 못 끝낸 과제들의 마감일이 안 당겨져
      // 오답 클리닉으로 안 넘어간다.
      await migrateIncompleteForClassRound(supabase, classId, selectedDate);
      await supabase.from("class").update({ week_type: type, week_type_updated_date: selectedDate, session_parity: false }).eq("class_id", classId);
      await loadAll();
    } finally { setIsBusy(false); }
  };

  // 💡 미래로 예약해둔 강제 배정을 아직 적용되기 전(그 날짜가 오기 전)에 취소한다.
  const cancelForcedReservation = async () => {
    setIsBusy(true);
    try {
      await supabase.from("class").update({ forced_week_type: null, forced_week_type_date: null }).eq("class_id", classId);
      await loadAll();
    } finally { setIsBusy(false); }
  };

  // 💡 보강일 지정은 이제 항상 "휴일 지정 -> 보강일 선택"(finalizeMakeup) 경로로만 새로 만들어진다 —
  // 아무 평일이나 눌러서 곧바로 독립적으로 보강일을 만드는 건 더 이상 허용하지 않는다. 이 함수는
  // 이미 보강일로 지정된 날짜를 해제할 때만 쓴다.
  const removeExtraSession = async () => {
    if (!selectedMeta?.isExtra || !selectedMeta.extraId) return;
    setIsBusy(true);
    try {
      await removeClassExtraSession(supabase, selectedMeta.extraId);
      setReasonDraft("");
      await loadAll();
    } finally { setIsBusy(false); }
  };

  return (
    <div className="col-span-2 bg-slate-50 border border-slate-200 rounded-lg p-4">
      <div className="mb-3">
        <label className="block text-xs font-bold text-slate-500">클리닉 배정 달력</label>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="bg-[#002864] text-white px-3 py-2 flex justify-between items-center">
          <button onClick={prevMonth} className="p-1 hover:bg-white/20 rounded transition-colors" type="button">◀</button>
          <h4 className="font-extrabold text-[13px]">{currentMonth.getFullYear()}년 {currentMonth.getMonth() + 1}월</h4>
          <button onClick={nextMonth} className="p-1 hover:bg-white/20 rounded transition-colors" type="button">▶</button>
        </div>

        <div className="p-3">
          <div className="grid grid-cols-7 gap-1 text-center mb-1.5">
            {DAY_LABELS.map((d, i) => (
              <div key={d} className={`text-[10px] font-black ${i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-slate-400"}`}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, idx) => {
              if (!day) return <div key={`empty-${idx}`} className="h-12"></div>;
              const ymd = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const meta = dayMetaMap.get(ymd)!;
              const isSelected = selectedDate === ymd;
              const isToday = ymd === todayStr;

              let cellCls = "bg-white border-slate-100 hover:border-slate-300 text-slate-700 hover:bg-slate-50";
              if (isSelected) cellCls = "bg-[#002864] border-[#002864] text-white shadow-md";
              else if (meta.isHoliday) cellCls = "bg-rose-50 border-rose-200 text-rose-500";
              else if (meta.weekTypeAtSession === "odd") cellCls = "bg-emerald-50 border-emerald-200 text-emerald-700";
              else if (meta.weekTypeAtSession === "even") cellCls = "bg-violet-50 border-violet-200 text-violet-700";
              else if (meta.isSession) cellCls = "bg-slate-100 border-slate-200 text-slate-500";

              return (
                <div
                  key={ymd}
                  onClick={() => { setSelectedDate(isSelected ? null : ymd); if (!pendingHolidayDate) setReasonDraft(""); }}
                  className={`h-12 flex flex-col items-center pt-1 cursor-pointer rounded-lg border transition-all ${cellCls}`}
                >
                  <span className={`text-[11px] font-bold ${isToday && !isSelected ? "text-rose-600 underline" : ""}`}>{day}</span>
                  <div className="flex gap-0.5 mt-0.5 items-center">
                    {meta.isHoliday && <span className="text-[9px] leading-none">🚫</span>}
                    {meta.isExtra && <span className="text-[9px] leading-none">➕</span>}
                    {!meta.isHoliday && meta.isRegularSession && (
                      <span className={`w-1.5 h-1.5 rounded-full shadow-sm ${meta.weekTypeAtSession === "even" ? "bg-violet-500" : "bg-emerald-500"}`}></span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px] font-bold text-slate-400">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>주간테스트 회차</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span>과제오답유사 회차</span>
            <span>🚫 휴일</span>
            <span>➕ 보강일</span>
          </div>

          {pendingHolidayDate && canEdit && (
            <div className="mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-amber-700">🚫 {pendingHolidayDate} 휴일 지정됨 — 보강일로 쓸 날짜를 눌러주세요</span>
              <button onClick={cancelPendingHoliday} className="text-[11px] font-bold text-slate-400 hover:text-slate-600 shrink-0">보강 없이 종료</button>
            </div>
          )}

          {forcedWeekTypeDate && (
            <div className="mt-3 p-2.5 bg-sky-50 border border-sky-200 rounded-lg flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-sky-700">
                ⏳ {forcedWeekTypeDate}부터 '{forcedWeekType === "odd" ? "주간테스트" : "과제오답유사"}'로 예약 배정됨
              </span>
              {canEdit && (
                <button disabled={isBusy} onClick={cancelForcedReservation} className="text-[11px] font-bold text-slate-400 hover:text-slate-600 shrink-0 disabled:opacity-50">예약 취소</button>
              )}
            </div>
          )}

          {selectedDate && selectedMeta && (
            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <h5 className="text-[12px] font-extrabold text-slate-800">📅 {selectedDate} ({DAY_LABELS[new Date(selectedDate + "T00:00:00Z").getUTCDay()]})</h5>
                <button onClick={() => setSelectedDate(null)} className="text-[11px] font-bold text-slate-400 hover:text-slate-600">닫기</button>
              </div>
              <p className="text-[11px] text-slate-500 font-bold mb-2">
                {selectedMeta.isHoliday ? `휴일${selectedMeta.holidayReason ? ` — ${selectedMeta.holidayReason}` : ""}`
                  : selectedMeta.isExtra ? `보강일${selectedMeta.extraReason ? ` — ${selectedMeta.extraReason}` : ""}`
                  : selectedMeta.isRegularSession ? "정규 수업일"
                  : "정규 수업 요일이 아닙니다"}
                {selectedMeta.weekTypeAtSession && ` · ${selectedMeta.weekTypeAtSession === "odd" ? "주간테스트" : "과제오답유사"} 회차`}
              </p>
              {canEdit && pendingHolidayDate && selectedDate !== pendingHolidayDate && (
                // 💡 2단계(보강일 선택) 중에는 다른 조작(휴일/보강 개별 토글, 회차 강제 배정)이
                // 끼어들면 안내 문구가 뭘 가리키는지 헷갈리므로, 이 날을 보강일로 확정하는 것 하나만 보여준다.
                <div className="flex flex-col gap-2">
                  <input type="text" value={reasonDraft} onChange={e => setReasonDraft(e.target.value)} placeholder="사유 (선택)" className="px-2 py-1.5 rounded border border-slate-300 text-xs font-bold" />
                  <button disabled={isBusy || selectedMeta.isHoliday || selectedMeta.isRegularSession || selectedMeta.isExtra} onClick={finalizeMakeup} className="w-full py-1.5 rounded text-xs font-bold shadow-sm disabled:opacity-50 bg-violet-600 text-white hover:bg-violet-700">
                    📨 이 날로 보강 지정 + 학부모 안내 발송
                  </button>
                  {(selectedMeta.isRegularSession || selectedMeta.isExtra) && (
                    <p className="text-[10px] font-bold text-rose-500">이미 정규 수업일이거나 보강일로 지정된 날짜라 선택할 수 없습니다. 다른 날짜를 골라주세요.</p>
                  )}
                </div>
              )}
              {canEdit && (!pendingHolidayDate || selectedDate === pendingHolidayDate) && (
                <div className="flex flex-col gap-2">
                  <input type="text" value={reasonDraft} onChange={e => setReasonDraft(e.target.value)} placeholder="사유 (선택)" className="px-2 py-1.5 rounded border border-slate-300 text-xs font-bold" />
                  <div className="flex gap-2">
                    {/* 💡 휴일 지정은 원래 정규 수업 요일에만 의미가 있다(휴일이어야 "쉬는 정규일"이
                        된다) — 정규 요일이 아닌 날엔 이미 회차로 안 잡히므로 굳이 휴일로 지정할 필요가
                        없다. 이미 휴일로 지정돼 있으면(과거에 정규 요일이 바뀌었을 수도 있으니) 해제는
                        항상 가능하게 둔다. */}
                    {!selectedMeta.isExtra && (selectedMeta.isScheduledWeekday || selectedMeta.isHoliday) && (
                      <button disabled={isBusy} onClick={toggleHoliday} className={`flex-1 py-1.5 rounded text-xs font-bold shadow-sm disabled:opacity-50 ${selectedMeta.isHoliday ? "bg-rose-100 text-rose-700 border border-rose-300" : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-100"}`}>
                        {selectedMeta.isHoliday ? "휴일 해제" : "🚫 휴일로 지정"}
                      </button>
                    )}
                    {/* 💡 보강일은 이제 "휴일로 지정 -> 보강일 선택"(finalizeMakeup) 흐름으로만 새로
                        만들 수 있다 — 아무 평일이나 눌러서 여기서 독립적으로 새로 지정하는 건 막는다.
                        이미 보강일로 지정된 날짜에 한해 해제만 여기서 할 수 있게 남겨둔다. */}
                    {selectedMeta.isExtra && (
                      <button disabled={isBusy} onClick={removeExtraSession} className="flex-1 py-1.5 rounded text-xs font-bold shadow-sm disabled:opacity-50 bg-violet-100 text-violet-700 border border-violet-300">
                        보강일 해제
                      </button>
                    )}
                  </div>
                  {/* 💡 분기테스트 등 정규 클리닉을 못 하는 날 대비 — 이 날짜를 새 기준점으로 삼아
                      강제로 주간테스트/과제오답유사 타입을 못박는다. 오늘/과거는 즉시 적용되고, 미래는
                      "예약"만 걸어둔다(forceAssignRound 참고) — 예약된 날짜가 되기 전까지 그 사이의
                      실제 회차들은 평소대로 정상 진행된다. */}
                  {!pendingHolidayDate && selectedMeta.isSession && (
                    <div className="flex gap-2">
                      <button disabled={isBusy} onClick={() => forceAssignRound("odd")} className="flex-1 py-1.5 rounded text-xs font-bold shadow-sm disabled:opacity-50 bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                        📝 주간테스트로 {selectedDate > todayStr ? "예약" : "강제"} 배정
                      </button>
                      <button disabled={isBusy} onClick={() => forceAssignRound("even")} className="flex-1 py-1.5 rounded text-xs font-bold shadow-sm disabled:opacity-50 bg-white border border-violet-300 text-violet-700 hover:bg-violet-50">
                        📘 과제오답유사로 {selectedDate > todayStr ? "예약" : "강제"} 배정
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
