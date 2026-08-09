// src/components/exam/WeekPickerCalendar.tsx
"use client";

import React, { useMemo, useState } from "react";
import { addDaysKST } from "@/lib/classRound";

// ISO 8601(월~일) 기준이라 월요일을 맨 왼쪽, 일요일을 맨 오른쪽에 둔다.
const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

interface WeekPickerCalendarProps {
  selectedDate: string; // yyyy-mm-dd
  onSelect: (date: string) => void;
}

export default function WeekPickerCalendar({ selectedDate, onSelect }: WeekPickerCalendarProps) {
  const [viewMonth, setViewMonth] = useState(() => new Date(selectedDate + "T00:00:00Z"));

  const weekRange = useMemo(() => {
    const dayNum = new Date(selectedDate + "T00:00:00Z").getUTCDay() || 7; // 1(월)~7(일)
    const monday = addDaysKST(selectedDate, -(dayNum - 1));
    const sunday = addDaysKST(monday, 6);
    return { start: monday, end: sunday };
  }, [selectedDate]);

  const prevMonth = () => setViewMonth(new Date(Date.UTC(viewMonth.getUTCFullYear(), viewMonth.getUTCMonth() - 1, 1)));
  const nextMonth = () => setViewMonth(new Date(Date.UTC(viewMonth.getUTCFullYear(), viewMonth.getUTCMonth() + 1, 1)));

  const year = viewMonth.getUTCFullYear();
  const month = viewMonth.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstDayIndex = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // 월요일=0 기준으로 변환
  const ymdOf = (d: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayIndex; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm select-none">
      <div className="bg-[#002864] text-white px-3 py-2 flex justify-between items-center">
        <button type="button" onClick={prevMonth} className="p-1 hover:bg-white/20 rounded transition-colors">◀</button>
        <h4 className="font-extrabold text-[12px]">{year}년 {month + 1}월</h4>
        <button type="button" onClick={nextMonth} className="p-1 hover:bg-white/20 rounded transition-colors">▶</button>
      </div>
      <div className="p-2.5">
        <div className="grid grid-cols-7 gap-0.5 text-center mb-1">
          {DAY_LABELS.map((d, i) => (
            <div key={d} className={`text-[9px] font-black ${i === 6 ? "text-rose-500" : i === 5 ? "text-blue-500" : "text-slate-400"}`}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((day, idx) => {
            if (!day) return <div key={`e-${idx}`} className="h-8" />;
            const ymd = ymdOf(day);
            const inSelectedWeek = ymd >= weekRange.start && ymd <= weekRange.end;

            // 날짜 하나가 아니라 "그 주 전체"를 고르는 개념이라, 클릭한 날짜만 따로 강조하지 않고
            // 선택된 주(월~일) 7칸을 모두 동일하게 강조한다.
            const cls = inSelectedWeek
              ? "bg-emerald-500 text-white shadow-sm hover:bg-emerald-600"
              : "bg-white text-slate-600 hover:bg-slate-100";

            return (
              <button
                type="button"
                key={ymd}
                onClick={() => onSelect(ymd)}
                className={`h-8 flex items-center justify-center text-[11px] font-bold rounded transition-colors ${cls}`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
