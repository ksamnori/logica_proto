// src/app/(dashboard)/learning/components/LearningCalendar.tsx
"use client";

import React, { useState, useMemo } from "react";

interface LearningCalendarProps {
  currentView: any;
  activeTab: string;
  timelineData: any[];
  globalList: any[];
  classCalendarEvents: any[];
  selectedDate: string | null;
  setSelectedDate: (date: string | null) => void;
  handleCalendarSummaryClick: (tab: 'DASHBOARD' | 'EXAM' | 'HOMEWORK' | 'INCORRECT' | 'SIMILAR' | 'OVERDUE') => void;
  handleViewAllStudents: () => void; 
}

export default function LearningCalendar({
  currentView, activeTab, timelineData, globalList, classCalendarEvents, selectedDate, setSelectedDate, handleCalendarSummaryClick, handleViewAllStudents
}: LearningCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  const eventsToUse = useMemo(() => {
    if (currentView.type === 'STUDENT') return timelineData;
    if (currentView.type === 'GLOBAL_LIST') {
      return globalList.map(g => ({
        date: g.sort_date || g.created_at,
        type: g.is_exam_hw ? 'hw_exam' : (activeTab === 'EXAM' ? 'exam' : activeTab === 'INCORRECT' ? 'print' : activeTab === 'SIMILAR' ? 'similar' : activeTab === 'OVERDUE' ? 'overdue' : 'hw'),
        isCompleted: ['채점완료', '제출완료', '완료'].includes(g.status || '미제출')
      }));
    }
    if (currentView.type === 'CLASS') return classCalendarEvents.filter(e => e.class_id === currentView.classId);
    return classCalendarEvents;
  }, [currentView, timelineData, globalList, classCalendarEvents, activeTab]);

  const dotsMap = useMemo(() => {
    const map: Record<string, { exam: number, hw: number, print: number, similar: number, overdue: number }> = {};
    eventsToUse.forEach(ev => {
      if (!ev.date) return;
      const d = new Date(ev.date);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      if (!ev.isCompleted) {
        if (!map[ymd]) map[ymd] = { exam: 0, hw: 0, print: 0, similar: 0, overdue: 0 };
        if (ev.type === 'exam') map[ymd].exam++;
        else if (ev.type === 'overdue') map[ymd].overdue++; // 🌟 미완료점 추가
        else if (ev.type?.includes('hw')) map[ymd].hw++;
        else if (ev.type === 'print') map[ymd].print++;
        else if (ev.type === 'similar') map[ymd].similar++; 
      }
    });
    return map;
  }, [eventsToUse]);

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayIndex = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  const days = [];
  for (let i = 0; i < firstDayIndex; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      
      <div className="bg-[#002864] text-white px-4 py-3 flex justify-between items-center shrink-0">
        <button onClick={prevMonth} className="p-1 hover:bg-white/20 rounded transition-colors">◀</button>
        <h3 className="font-extrabold text-[14px]">{currentMonth.getFullYear()}년 {currentMonth.getMonth() + 1}월</h3>
        <button onClick={nextMonth} className="p-1 hover:bg-white/20 rounded transition-colors">▶</button>
      </div>

      <div className="p-4 flex-1 overflow-y-auto custom-scroll bg-slate-50/30">
        <div className="grid grid-cols-7 gap-1 text-center mb-2">
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
            <div key={d} className={`text-[10px] font-black ${i === 0 ? 'text-rose-500' : i === 6 ? 'text-blue-500' : 'text-slate-400'}`}>{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((day, idx) => {
            if (!day) return <div key={`empty-${idx}`} className="h-10"></div>;
            
            const ymd = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dots = dotsMap[ymd];
            const isSelected = selectedDate === ymd;
            const isToday = ymd === todayStr;

            return (
              <div 
                key={ymd}
                onClick={() => setSelectedDate(isSelected ? null : ymd)}
                className={`h-11 flex flex-col items-center pt-1 cursor-pointer rounded-lg border transition-all ${
                  isSelected ? 'bg-[#002864] border-[#002864] text-white shadow-md' 
                  : 'bg-white border-slate-100 hover:border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className={`text-[11px] font-bold ${isToday && !isSelected ? 'text-rose-500' : ''}`}>{day}</span>
                
                {/* 🌟 캘린더에 미완료 빨간색 마커 추가 */}
                <div className="flex flex-wrap justify-center gap-0.5 mt-0.5 px-1">
                  {dots?.exam > 0 && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-sm" title={`시험 미해결 ${dots.exam}건`}></span>}
                  {dots?.hw > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-sm" title={`과제 미해결 ${dots.hw}건`}></span>}
                  {dots?.overdue > 0 && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shadow-sm" title={`미완료과제 ${dots.overdue}건`}></span>}
                  {dots?.print > 0 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-sm" title={`오답 미해결 ${dots.print}건`}></span>}
                  {dots?.similar > 0 && <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shadow-sm" title={`오답유사 미해결 ${dots.similar}건`}></span>}
                </div>
              </div>
            );
          })}
        </div>

        {selectedDate && (
          <div className="mt-5 p-3.5 bg-rose-50/50 border border-rose-200 rounded-xl shadow-inner animate-fade-in">
            <h4 className="text-[12px] font-extrabold text-rose-900 mb-2 flex items-center gap-1.5">
              <span>📅</span> {selectedDate} 미해결 요약
            </h4>
            
            {/* 🌟 5분류 요약 박스로 개편 */}
            <div className="grid grid-cols-2 gap-1.5 bg-white p-1.5 rounded-lg border border-rose-100 shadow-sm">
              <div onClick={() => handleCalendarSummaryClick('EXAM')} className="flex flex-col items-center gap-1 cursor-pointer hover:bg-blue-50/80 p-2 rounded-lg transition-colors w-full border border-transparent hover:border-blue-100">
                <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-black">📝 시험</span>
                <span className="text-[13px] font-black text-slate-700">{dotsMap[selectedDate]?.exam || 0}건</span>
              </div>
              <div onClick={() => handleCalendarSummaryClick('HOMEWORK')} className="flex flex-col items-center gap-1 cursor-pointer hover:bg-amber-50/80 p-2 rounded-lg transition-colors w-full border border-transparent hover:border-amber-100">
                <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black">📚 과제</span>
                <span className="text-[13px] font-black text-slate-700">{dotsMap[selectedDate]?.hw || 0}건</span>
              </div>
              <div onClick={() => handleCalendarSummaryClick('OVERDUE')} className="flex flex-col items-center gap-1 cursor-pointer hover:bg-rose-50/80 p-2 rounded-lg transition-colors w-full border border-transparent hover:border-rose-100 col-span-2">
                <span className="text-[9px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-black">⏰ 미완료</span>
                <span className="text-[13px] font-black text-slate-700">{dotsMap[selectedDate]?.overdue || 0}건</span>
              </div>
              <div onClick={() => handleCalendarSummaryClick('INCORRECT')} className="flex flex-col items-center gap-1 cursor-pointer hover:bg-emerald-50/80 p-2 rounded-lg transition-colors w-full border border-transparent hover:border-emerald-100">
                <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-black">❌ 오답</span>
                <span className="text-[13px] font-black text-slate-700">{dotsMap[selectedDate]?.print || 0}건</span>
              </div>
              <div onClick={() => handleCalendarSummaryClick('SIMILAR')} className="flex flex-col items-center gap-1 cursor-pointer hover:bg-violet-50/80 p-2 rounded-lg transition-colors w-full border border-transparent hover:border-violet-100">
                <span className="text-[9px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-black">🔄 유사</span>
                <span className="text-[13px] font-black text-slate-700">{dotsMap[selectedDate]?.similar || 0}건</span>
              </div>
            </div>
            
            <button onClick={() => setSelectedDate(null)} className="mt-3 w-full py-1.5 text-[11px] font-bold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors shadow-sm">
              날짜 선택 해제 (전체 보기) ↺
            </button>
            {currentView.type !== 'ALL' && (
              <button onClick={handleViewAllStudents} className="mt-1.5 w-full py-1.5 text-[11px] font-bold text-[#002864] bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors shadow-sm">
                학생 선택 해제 (전체 학생 보기) 👥
              </button>
            )}
          </div>
        )}

        {!selectedDate && currentView.type !== 'ALL' && (
          <div className="mt-4 px-1">
            <button onClick={handleViewAllStudents} className="w-full py-1.5 text-[11px] font-bold text-[#002864] bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors shadow-sm">
              학생 선택 해제 (전체 학생 보기) 👥
            </button>
          </div>
        )}
      </div>
    </div>
  );
}