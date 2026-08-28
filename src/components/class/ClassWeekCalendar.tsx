// src/components/class/ClassWeekCalendar.tsx
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
  canEdit: boolean;
  scheduleRefreshKey?: number;
  isSpecialOrMakeup?: boolean; 
  specialStartDate?: string;   
  specialEndDate?: string;     
}

type DayMeta = {
  ymd: string;
  isHoliday: boolean;
  holidayId?: string;
  holidayReason?: string;
  isExtra: boolean;
  extraId?: string;
  extraReason?: string;
  extraStartTime?: string | null;
  extraEndTime?: string | null;
  extraReplacesHolidayId?: string | null;
  isScheduledWeekday: boolean; 
  isRegularSession: boolean; 
  isSession: boolean; 
  weekTypeAtSession?: "odd" | "even"; 
};

export default function ClassWeekCalendar({ classId, className, canEdit, scheduleRefreshKey, isSpecialOrMakeup = false, specialStartDate, specialEndDate }: ClassWeekCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [weekType, setWeekType] = useState<string | null>(null);
  const [weekTypeUpdatedDate, setWeekTypeUpdatedDate] = useState<string | null>(null);
  const [forcedWeekType, setForcedWeekType] = useState<string | null>(null);
  const [forcedWeekTypeDate, setForcedWeekTypeDate] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [extraSessions, setExtraSessions] = useState<any[]>([]);
  
  const [scheduleDays, setScheduleDays] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");
  const [extraStartTime, setExtraStartTime] = useState("");
  const [extraEndTime, setExtraEndTime] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [pendingHolidayDate, setPendingHolidayDate] = useState<string | null>(null);
  const [baseScheduleMap, setBaseScheduleMap] = useState<Record<string, { start: string; end: string }>>({});

  const [managers, setManagers] = useState<any[]>([]);
  const [notificationTarget, setNotificationTarget] = useState<string>("parents");

  useEffect(() => {
    const fetchManagers = async () => {
      let tId = localStorage.getItem("logica_tenant_id");
      if (tId === 'hq') tId = '1ff4299c-d72b-4d99-97b0-45fee08e3b73'; 
      
      let query = supabase.from("instructor").select("instructor_id, name, position, role").eq("status", "재직");
      if (tId) query = query.eq("tenant_id", tId);
      
      const { data } = await query;
      if (data) {
        const mgrs = data.filter(i => i.role === 'MANAGER' || (i.position && i.position.includes('실장')));
        setManagers(mgrs);
        if (mgrs.length > 0) {
          setNotificationTarget(mgrs[0].instructor_id); 
        }
      }
    };
    fetchManagers();
  }, []);

  const loadAll = async () => {
    const [{ data: cRow }, { data: hRows }, { data: eRows }, { data: sRows }] = await Promise.all([
      supabase.from("class").select("week_type, week_type_updated_date, session_parity, forced_week_type, forced_week_type_date").eq("class_id", classId).maybeSingle(),
      supabase.from("class_holiday").select("*").eq("class_id", classId).order("holiday_date", { ascending: true }),
      supabase.from("class_extra_session").select("*").eq("class_id", classId).order("session_date", { ascending: true }),
      supabase.from("class_schedule").select("day_of_week, start_time, end_time").eq("class_id", classId),
    ]);
    
    setHolidays(hRows || []);
    setExtraSessions(eRows || []);
    const persistedScheduleDays = (sRows || []).map((s: any) => s.day_of_week);
    setScheduleDays(persistedScheduleDays);

    const bMap: Record<string, { start: string; end: string }> = {};
    sRows?.forEach((s: any) => {
        bMap[s.day_of_week] = {
            start: s.start_time?.substring(0, 5) || "",
            end: s.end_time?.substring(0, 5) || ""
        };
    });
    setBaseScheduleMap(bMap);

    if (cRow && !isSpecialOrMakeup) {
      const { weekType: wt } = await resolveClassWeekType(supabase, {
        class_id: classId, class_name: className, week_type: cRow.week_type,
        week_type_updated_date: cRow.week_type_updated_date, session_parity: cRow.session_parity, scheduleDays: persistedScheduleDays,
        forced_week_type: cRow.forced_week_type, forced_week_type_date: cRow.forced_week_type_date,
      });
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
  }, [classId, scheduleRefreshKey]);

  const holidaySet = useMemo(() => new Map(holidays.map((h: any) => [h.holiday_date, h])), [holidays]);
  const extraSet = useMemo(() => new Map(extraSessions.map((e: any) => [e.session_date, e])), [extraSessions]);

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
      
      let isRegularSession = isScheduledWeekday && !holiday;
      if (isSpecialOrMakeup) {
          if (specialStartDate && ymd < specialStartDate) isRegularSession = false;
          if (specialEndDate && ymd > specialEndDate) isRegularSession = false;
      }
      
      const isSession = isRegularSession || !!extra;

      map.set(ymd, {
        ymd, isHoliday: !!holiday, holidayId: holiday?.id, holidayReason: holiday?.reason,
        isExtra: !!extra, extraId: extra?.id, extraReason: extra?.reason,
        extraStartTime: extra?.start_time ? String(extra.start_time).slice(0, 5) : null,
        extraEndTime: extra?.end_time ? String(extra.end_time).slice(0, 5) : null,
        extraReplacesHolidayId: extra?.replaces_holiday_id ?? null,
        isScheduledWeekday, isRegularSession, isSession, weekTypeAtSession: undefined,
      });
    }

    const monthEndYmd = ymdOf(daysInMonth);
    if (!isSpecialOrMakeup && weekTypeUpdatedDate && weekTypeUpdatedDate <= monthEndYmd) {
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

        if (forcedWeekTypeDate && cursor === forcedWeekTypeDate && forcedWeekType) {
          simType = forcedWeekType === "even" ? "even" : "odd";
        } else {
          simType = simType === "odd" ? "even" : "odd"; 
        }
        const meta = map.get(cursor);
        if (meta) meta.weekTypeAtSession = simType;
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, scheduleDays, holidaySet, extraSet, weekType, weekTypeUpdatedDate, forcedWeekType, forcedWeekTypeDate, isSpecialOrMakeup, specialStartDate, specialEndDate]);

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayIndex = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDayIndex; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const todayStr = getKSTDateString();
  const selectedMeta = selectedDate ? dayMetaMap.get(selectedDate) : null;
  const selectedDayLabel = selectedDate ? DAY_LABELS[new Date(selectedDate + "T00:00:00Z").getUTCDay()] : "";
  const defaultTimes = baseScheduleMap[selectedDayLabel] || { start: "", end: "" };

  const notifyParents = async (content: string) => {
    try {
      const { data: cls } = await supabase.from("class").select("instructor_id").eq("class_id", classId).maybeSingle();
      const instId = cls?.instructor_id;
      if (!instId) return;

      const { data: enrolled } = await supabase.from("enrollment").select("student(parent_id)").eq("class_id", classId);
      const parentIds = new Set<string>();
      (enrolled || []).forEach((e: any) => { 
        const st = Array.isArray(e.student) ? e.student[0] : e.student;
        if (st?.parent_id) parentIds.add(st.parent_id); 
      });
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
        if (error) { alert("제외(Pass) 처리 중 오류: " + error.message); return; }
        setPendingHolidayDate(selectedDate);
      }
      await loadAll();
    } finally { setIsBusy(false); }
  };

  const cancelPendingHoliday = () => { setPendingHolidayDate(null); setReasonDraft(""); setExtraStartTime(""); setExtraEndTime(""); };

  const finalizeMakeup = async () => {
    if (!selectedDate || !pendingHolidayDate || !selectedMeta) return;
    if (selectedMeta.isHoliday || selectedMeta.isRegularSession || selectedMeta.isExtra) return;
    setIsBusy(true);
    try {
      const pendingHolidayId = holidaySet.get(pendingHolidayDate)?.id ?? null;
      const { error } = await setClassExtraSession(supabase, classId, selectedDate, reasonDraft, extraStartTime, extraEndTime, pendingHolidayId);
      if (error) { alert("저장 중 오류: " + error.message); return; }
      
      setPendingHolidayDate(null);
      setReasonDraft("");
      setExtraStartTime("");
      setExtraEndTime("");
      await loadAll();
    } finally { setIsBusy(false); }
  };

  // 🌟 학부모 또는 사내 메신저(실장님 등)에게 알림을 쏘는 진짜 로직!
  const handleSendNotification = async () => {
    if (!selectedDate || !selectedMeta?.isExtra) return;
    setIsBusy(true);
    try {
      const { data: cls } = await supabase.from("class").select("instructor(name)").eq("class_id", classId).maybeSingle();
      const instObj = Array.isArray(cls?.instructor) ? cls?.instructor[0] : cls?.instructor;
      const instructorName = instObj?.name || "담당 선생님";

      const linkedHoliday = selectedMeta.extraReplacesHolidayId
        ? holidays.find((h: any) => h.id === selectedMeta.extraReplacesHolidayId)
        : null;

      const mWeekday = DAY_LABELS[new Date(selectedDate + "T00:00:00Z").getUTCDay()];
      const timeNote = selectedMeta.extraStartTime ? ` ${selectedMeta.extraStartTime}${selectedMeta.extraEndTime ? `~${selectedMeta.extraEndTime}` : ""}` : "";
      const reason = selectedMeta.extraReason ? ` (사유: ${selectedMeta.extraReason})` : "";

      let msg = "";
      if (linkedHoliday) {
        const hDate = linkedHoliday.holiday_date;
        const hWeekday = DAY_LABELS[new Date(hDate + "T00:00:00Z").getUTCDay()];
        msg = isSpecialOrMakeup
          ? `[${className}] 일정 변경 안내\n${hDate}(${hWeekday}) 일정이 제외되고 ${selectedDate}(${mWeekday})${timeNote}로 일정이 대체/변경되었습니다.${reason}`
          : `[${className}] 보강 안내\n${hDate}(${hWeekday}) 수업이 휴일로 변경되어 ${selectedDate}(${mWeekday})${timeNote}로 보강이 배정되었습니다.${reason}`;
      } else {
        msg = isSpecialOrMakeup
          ? `[${className}] 추가 일정 안내\n${selectedDate}(${mWeekday})${timeNote}에 일정이 추가/변경되었습니다.${reason}`
          : `[${className}] 추가 보강 안내\n${selectedDate}(${mWeekday})${timeNote}에 보강이 배정되었습니다.${reason}`;
      }

      if (notificationTarget === 'parents') {
         await notifyParents(msg);
         alert(`📨 학부모 전체에게 다음 내용으로 알림이 발송되었습니다.\n\n${msg}`);
      } else {
         // 🌟 사내 메신저 발송 (FloatingChat과 완벽히 동일한 DB 처리)
         const myInstId = localStorage.getItem("logica_instructor_id");
         const myTenantId = localStorage.getItem("logica_tenant_id");
         
         if (!myInstId) {
           alert("로그인 정보가 없어 사내 메신저 발송에 실패했습니다.");
           setIsBusy(false);
           return;
         }

         let roomId = null;
         
         if (notificationTarget === myInstId) {
           // 나와의 채팅방
           const { data: myRoomsData } = await supabase.from('internal_chat_member').select('room_id').eq('instructor_id', myInstId);
           const myRoomIds = (myRoomsData || []).map(r => r.room_id);
           if (myRoomIds.length > 0) {
              const { data: selfRoomData } = await supabase.from('internal_chat_room')
                 .select('room_id')
                 .in('room_id', myRoomIds)
                 .ilike('title', '%(나)%')
                 .limit(1).maybeSingle();
              if (selfRoomData) roomId = selfRoomData.room_id;
           }
           if (!roomId) {
              const titleWithPos = `${instructorName} (나)`;
              const { data: newRoom } = await supabase.from('internal_chat_room').insert({ room_type: 'DIRECT', title: titleWithPos, created_by: myInstId, tenant_id: myTenantId }).select().single();
              if (newRoom) {
                 roomId = newRoom.room_id;
                 await supabase.from('internal_chat_member').insert([{ room_id: roomId, instructor_id: myInstId }]);
              }
           }
         } else {
           // 실장님 혹은 다른 강사와의 1:1 방
           const { data: targetRoomsData } = await supabase.from('internal_chat_member').select('room_id').eq('instructor_id', notificationTarget);
           const targetRoomIds = (targetRoomsData || []).map(r => r.room_id);
           if (targetRoomIds.length > 0) {
              const { data: commonMembersData } = await supabase.from('internal_chat_member')
                  .select('room_id, internal_chat_room!inner(room_type)')
                  .eq('instructor_id', myInstId)
                  .in('room_id', targetRoomIds)
                  .eq('internal_chat_room.room_type', 'DIRECT');
              const commonMembers = (commonMembersData || []);
              if (commonMembers.length > 0) roomId = commonMembers[0].room_id;
           }
           if (!roomId) {
              const targetMgr = managers.find(m => m.instructor_id === notificationTarget);
              const titleWithPos = `${targetMgr?.name || '실장'} ${targetMgr?.position || '선생님'}`;
              const { data: newRoom } = await supabase.from('internal_chat_room').insert({ room_type: 'DIRECT', title: titleWithPos, created_by: myInstId, tenant_id: myTenantId }).select().single();
              if (newRoom) {
                 roomId = newRoom.room_id;
                 await supabase.from('internal_chat_member').insert([
                     { room_id: roomId, instructor_id: myInstId }, 
                     { room_id: roomId, instructor_id: notificationTarget }
                 ]);
              }
           }
         }

         if (roomId) {
             await supabase.from('internal_chat_message').insert({ room_id: roomId, sender_id: myInstId, content: msg });
             await supabase.from("internal_chat_member").update({ last_read_at: new Date().toISOString(), is_active: true }).eq("room_id", roomId).eq("instructor_id", myInstId);
             if (notificationTarget !== myInstId) {
                 await supabase.from("internal_chat_member").update({ is_active: true }).eq("room_id", roomId).eq("instructor_id", notificationTarget);
             }
             const targetMgr = managers.find(m => m.instructor_id === notificationTarget);
             const mgrName = targetMgr ? targetMgr.name : '실장';
             alert(`📨 사내 메신저를 통해 [${mgrName}] 선생님의 채팅방으로 일정이 전송되었습니다!\n우측 하단 메신저 아이콘을 눌러 확인해보세요.`);
         } else {
             alert("채팅방을 생성/조회할 수 없어 발송에 실패했습니다.");
         }
      }

    } catch (e) {
      console.error(e);
      alert("알림 발송 중 오류가 발생했습니다.");
    } finally {
      setIsBusy(false);
    }
  };

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
      await migrateIncompleteForClassRound(supabase, classId, selectedDate);
      await supabase.from("class").update({ week_type: type, week_type_updated_date: selectedDate, session_parity: false }).eq("class_id", classId);
      await loadAll();
    } finally { setIsBusy(false); }
  };

  const cancelForcedReservation = async () => {
    setIsBusy(true);
    try {
      await supabase.from("class").update({ forced_week_type: null, forced_week_type_date: null }).eq("class_id", classId);
      await loadAll();
    } finally { setIsBusy(false); }
  };

  const removeExtraSession = async () => {
    if (!selectedMeta?.isExtra || !selectedMeta.extraId) return;
    const linkedHoliday = selectedMeta.extraReplacesHolidayId
      ? holidays.find((h: any) => h.id === selectedMeta.extraReplacesHolidayId)
      : null;

    const confirmMsg = linkedHoliday
      ? `이 일정을 취소하면 원래 제외되었던 ${linkedHoliday.holiday_date}도 함께 복원됩니다. 계속할까요?`
      : "추가된 일정을 취소합니다. 계속할까요?";
    if (!confirm(confirmMsg)) return;

    setIsBusy(true);
    try {
      await removeClassExtraSession(supabase, selectedMeta.extraId);
      if (linkedHoliday) await removeClassHoliday(supabase, linkedHoliday.id);
      setReasonDraft("");
      await loadAll();
    } finally { setIsBusy(false); }
  };

  const saveSpecialClassTime = async () => {
    if (!selectedDate || !selectedMeta) return;
    setIsBusy(true);
    try {
       if (selectedMeta.isExtra && selectedMeta.extraId) {
          await supabase.from('class_extra_session').update({ start_time: extraStartTime, end_time: extraEndTime, reason: reasonDraft || '시간 변경' }).eq('id', selectedMeta.extraId);
       } else {
          await setClassExtraSession(supabase, classId, selectedDate, reasonDraft || '시간 변경', extraStartTime, extraEndTime, null);
       }
       await loadAll();
       alert('수업 시간이 성공적으로 변경되었습니다.');
    } catch(e) {
       console.error(e);
       alert('시간 변경 중 오류가 발생했습니다.');
    } finally {
       setIsBusy(false);
    }
  };

  useEffect(() => {
    if (selectedDate && selectedMeta) {
      if (selectedMeta.isExtra) {
        setExtraStartTime(selectedMeta.extraStartTime || defaultTimes.start);
        setExtraEndTime(selectedMeta.extraEndTime || defaultTimes.end);
      } else {
        setExtraStartTime(defaultTimes.start);
        setExtraEndTime(defaultTimes.end);
      }
    }
  }, [selectedDate, selectedMeta, defaultTimes.start, defaultTimes.end]);


  return (
    <div className="col-span-2 bg-slate-50 border border-slate-200 rounded-lg p-4">
      <div className="mb-3">
        <label className="block text-xs font-bold text-slate-500">
          {isSpecialOrMakeup ? "특강/보강 달력 일정표" : "클리닉 배정 달력"}
        </label>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className={`text-white px-3 py-2 flex justify-between items-center ${isSpecialOrMakeup ? 'bg-indigo-600' : 'bg-[#002864]'}`}>
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
              if (isSelected) cellCls = isSpecialOrMakeup ? "bg-indigo-600 border-indigo-600 text-white shadow-md" : "bg-[#002864] border-[#002864] text-white shadow-md";
              else if (meta.isHoliday) cellCls = "bg-slate-200 border-slate-300 text-slate-400";
              else if (!isSpecialOrMakeup && meta.weekTypeAtSession === "odd") cellCls = "bg-emerald-50 border-emerald-200 text-emerald-700";
              else if (!isSpecialOrMakeup && meta.weekTypeAtSession === "even") cellCls = "bg-violet-50 border-violet-200 text-violet-700";
              else if (meta.isSession) cellCls = isSpecialOrMakeup ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-slate-100 border-slate-200 text-slate-500";

              return (
                <div
                  key={ymd}
                  onClick={() => { setSelectedDate(isSelected ? null : ymd); if (!pendingHolidayDate) { setReasonDraft(""); setExtraStartTime(""); setExtraEndTime(""); } }}
                  className={`h-12 flex flex-col items-center pt-1 cursor-pointer rounded-lg border transition-all ${cellCls} ${isToday && !isSelected ? "ring-2 ring-inset ring-indigo-300" : ""}`}
                >
                  <span className="text-[11px] font-bold">{day}</span>
                  <div className="flex gap-0.5 mt-0.5 items-center">
                    {meta.isHoliday && <span className="text-[9px] leading-none">🚫</span>}
                    {meta.isExtra && <span className="text-[9px] leading-none">➕</span>}
                    {!meta.isHoliday && meta.isRegularSession && (
                      <span className={`w-1.5 h-1.5 rounded-full shadow-sm ${isSpecialOrMakeup ? 'bg-indigo-500' : meta.weekTypeAtSession === "even" ? "bg-violet-500" : "bg-emerald-500"}`}></span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px] font-bold text-slate-400">
            {isSpecialOrMakeup ? (
              <>
                 <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>정규 특강일</span>
                 <span>🚫 제외(Pass)</span>
                 <span>➕ 시간 변경/추가</span>
              </>
            ) : (
              <>
                 <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>주간테스트 회차</span>
                 <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span>과제오답유사 회차</span>
                 <span>🚫 휴일</span>
                 <span>➕ 보강일</span>
              </>
            )}
          </div>

          {pendingHolidayDate && canEdit && (
            <div className={`mt-3 p-2.5 border rounded-lg flex items-center justify-between gap-2 ${isSpecialOrMakeup ? 'bg-slate-100 border-slate-300' : 'bg-amber-50 border-amber-200'}`}>
              <span className={`text-[11px] font-bold ${isSpecialOrMakeup ? 'text-slate-600' : 'text-amber-700'}`}>
                🚫 {pendingHolidayDate} {isSpecialOrMakeup ? '일정이 제외(Pass)됨 — 대체일로 쓸 날짜를 눌러주세요' : '휴일 지정됨 — 보강일로 쓸 날짜를 눌러주세요'}
              </span>
              <button onClick={cancelPendingHoliday} className="text-[11px] font-bold text-slate-400 hover:text-slate-600 shrink-0">대체 없이 종료</button>
            </div>
          )}

          {!isSpecialOrMakeup && forcedWeekTypeDate && (
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
            <div className={`mt-3 p-3 border rounded-xl ${isSpecialOrMakeup ? 'bg-indigo-50/50 border-indigo-100' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <h5 className="text-[12px] font-extrabold text-slate-800">📅 {selectedDate} ({selectedDayLabel})</h5>
                <button onClick={() => setSelectedDate(null)} className="text-[11px] font-bold text-slate-400 hover:text-slate-600">닫기</button>
              </div>
              <p className="text-[11px] text-slate-500 font-bold mb-2">
                {selectedMeta.isHoliday ? `제외됨${selectedMeta.holidayReason ? ` — ${selectedMeta.holidayReason}` : ""}`
                  : selectedMeta.isExtra ? (() => {
                      const timeLabel = selectedMeta.extraStartTime ? ` ${selectedMeta.extraStartTime}${selectedMeta.extraEndTime ? `~${selectedMeta.extraEndTime}` : ""}` : "";
                      return `${isSpecialOrMakeup ? '일정 변경/추가됨' : '보강일'}${timeLabel}${selectedMeta.extraReason ? ` — ${selectedMeta.extraReason}` : ""}`;
                    })()
                  : selectedMeta.isRegularSession ? (isSpecialOrMakeup ? "정상 특강일" : "정규 수업일")
                  : "수업 요일이 아닙니다"}
                {!isSpecialOrMakeup && selectedMeta.weekTypeAtSession && ` · ${selectedMeta.weekTypeAtSession === "odd" ? "주간테스트" : "과제오답유사"} 회차`}
              </p>

              {canEdit && pendingHolidayDate && selectedDate !== pendingHolidayDate && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input type="time" value={extraStartTime} onChange={e => setExtraStartTime(e.target.value)} className="flex-1 px-2 py-1.5 rounded border border-slate-300 text-xs font-bold" />
                    <span className="text-slate-400 text-xs">~</span>
                    <input type="time" value={extraEndTime} onChange={e => setExtraEndTime(e.target.value)} className="flex-1 px-2 py-1.5 rounded border border-slate-300 text-xs font-bold" />
                  </div>
                  <input type="text" value={reasonDraft} onChange={e => setReasonDraft(e.target.value)} placeholder="사유 (선택)" className="px-2 py-1.5 rounded border border-slate-300 text-xs font-bold" />
                  <button disabled={isBusy || selectedMeta.isHoliday || selectedMeta.isRegularSession || selectedMeta.isExtra} onClick={finalizeMakeup} className="w-full py-1.5 rounded text-xs font-bold shadow-sm disabled:opacity-50 bg-indigo-600 text-white hover:bg-indigo-700">
                    💾 {isSpecialOrMakeup ? '이 날로 일정 대체 (저장)' : '이 날로 보강 지정 (저장)'}
                  </button>
                  {(selectedMeta.isRegularSession || selectedMeta.isExtra) && (
                    <p className="text-[10px] font-bold text-rose-500">이미 지정된 날짜라 선택할 수 없습니다. 다른 빈 날짜를 골라주세요.</p>
                  )}
                </div>
              )}
              
              {canEdit && (!pendingHolidayDate || selectedDate === pendingHolidayDate) && (
                <div className="flex flex-col gap-2">
                  {isSpecialOrMakeup && (selectedMeta.isRegularSession || selectedMeta.isExtra) && !selectedMeta.isHoliday && (
                     <div className="flex items-center gap-2 mt-1 mb-1 p-2 bg-white rounded-lg border border-indigo-100 shadow-sm">
                        <span className="text-[10px] font-extrabold text-indigo-800 shrink-0">시간 변경</span>
                        <input type="time" value={extraStartTime} onChange={e => setExtraStartTime(e.target.value)} className="w-full px-1.5 py-1 rounded border border-slate-200 text-xs font-bold focus:border-indigo-400 outline-none" />
                        <span className="text-slate-400 text-xs">~</span>
                        <input type="time" value={extraEndTime} onChange={e => setExtraEndTime(e.target.value)} className="w-full px-1.5 py-1 rounded border border-slate-200 text-xs font-bold focus:border-indigo-400 outline-none" />
                        <button disabled={isBusy} onClick={saveSpecialClassTime} className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] px-2 py-1.5 rounded shadow-sm font-bold transition-colors">저장</button>
                     </div>
                  )}

                  {!selectedMeta.isExtra && <input type="text" value={reasonDraft} onChange={e => setReasonDraft(e.target.value)} placeholder="사유 (선택)" className="px-2 py-1.5 rounded border border-slate-300 text-xs font-bold" />}
                  
                  <div className="flex gap-2 mt-1">
                    {!selectedMeta.isExtra && (selectedMeta.isScheduledWeekday || selectedMeta.isHoliday) && (
                      <button disabled={isBusy} onClick={toggleHoliday} className={`flex-1 py-1.5 rounded text-xs font-bold shadow-sm disabled:opacity-50 ${selectedMeta.isHoliday ? "bg-slate-200 text-slate-700 border border-slate-300" : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-100"}`}>
                        {selectedMeta.isHoliday ? "제외(Pass) 해제" : "🚫 이번 일정 제외(Pass)"}
                      </button>
                    )}
                    
                    {selectedMeta.isExtra && (
                      <div className="flex flex-col gap-1.5 mt-1 w-full">
                        <div className="flex gap-1.5 w-full">
                          <select 
                            value={notificationTarget} 
                            onChange={e => setNotificationTarget(e.target.value)} 
                            className="w-[120px] shrink-0 px-2 py-1 rounded text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 focus:outline-none focus:border-indigo-400"
                          >
                            <option value="parents">반 학부모 전체</option>
                            {managers.map((m: any) => (
                              <option key={m.instructor_id} value={m.instructor_id}>
                                {m.name} {m.position || '선생님'}
                              </option>
                            ))}
                          </select>
                          <button disabled={isBusy} onClick={handleSendNotification} className="flex-1 py-1.5 rounded text-xs font-bold shadow-sm disabled:opacity-50 bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1">
                            📨 알림 발송
                          </button>
                        </div>
                        <button disabled={isBusy} onClick={removeExtraSession} className="w-full py-1.5 rounded text-xs font-bold shadow-sm disabled:opacity-50 bg-rose-100 text-rose-700 border border-rose-300 hover:bg-rose-200 transition-colors">
                          {isSpecialOrMakeup ? "추가 일정 취소" : "보강일 해제"}
                        </button>
                      </div>
                    )}
                  </div>

                  {!isSpecialOrMakeup && !pendingHolidayDate && selectedMeta.isSession && (
                    <div className="flex gap-2 mt-1">
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