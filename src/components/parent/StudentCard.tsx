// src/components/parent/StudentCard.tsx
"use client";

import React, { useState } from "react";

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

export default function StudentCard({ student }: { student: any }) {
  const [activeTab, setActiveTab] = useState<"attendance" | "progress" | "homework" | "makeup" | "exam" | "consultation">("attendance");

  // 캘린더용 상태
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const activeEnrollment = student.enrollment?.find((e: any) => (!e.end_date || new Date(e.end_date) >= new Date()) && unwrap(e.class)?.name);
  const currentClass = activeEnrollment ? unwrap(activeEnrollment.class) : null;
  const className = currentClass?.name || "소속 반 없음";

  // --- 출결 캘린더 로직 ---
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const handlePrevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const handleNextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const attendanceMap = new Map();
  if (student.attendance) {
    student.attendance.forEach((record: any) => {
      if (record.attendance_date) {
        attendanceMap.set(record.attendance_date, record);
      }
    });
  }

  const selectedDateStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
  const selectedAtt = attendanceMap.get(selectedDateStr);

  // --- 진도 블록 렌더링 로직 ---
  const renderPageBlocks = (bookPages: number[], pageStatuses: Record<number, 'done' | 'homework' | 'none'>) => {
    if (!bookPages || bookPages.length === 0) {
      return <span className="text-xs font-bold text-slate-400">교재 데이터가 없습니다.</span>;
    }

    return (
      <div className="flex flex-wrap gap-1 items-center">
        {bookPages.map((p) => {
          const status = pageStatuses[p] || "none";
          let bgColor = "bg-slate-200";
          let title = `${p}p 대기`;

          if (status === "done") {
            bgColor = "bg-emerald-500";
            title = `${p}p 완료`;
          } else if (status === "homework") {
            bgColor = "bg-amber-400";
            title = `${p}p 과제 진행중`;
          }

          return (
            <div key={p} title={title} className={`w-2 h-4 rounded-[2px] ${bgColor} shadow-sm transition-colors`} />
          );
        })}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden font-pretendard">
      {/* 학생 기본 정보 */}
      <div className="p-6 border-b border-slate-100 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xl font-black text-slate-800">{student.name}</span>
            <span className="text-xs font-bold text-slate-400">학생</span>
          </div>
          <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full border border-slate-200 shadow-sm">
            {student.grade || "학년 정보 없음"}
          </span>
        </div>

        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col gap-2">
          <div className="flex justify-between text-xs font-bold">
            <span className="text-slate-500">소속 반</span>
            <span className="text-[#002864] font-black">{className}</span>
          </div>
          {currentClass?.class_schedule && currentClass.class_schedule.length > 0 && (
            <div className="flex justify-between text-xs font-bold">
              <span className="text-slate-500">시간표</span>
              <span className="text-slate-700">
                {currentClass.class_schedule.map((sc: any, idx: number) => {
                   const sTime = sc.start_time?.substring(0, 5) || "";
                   return `${sc.day_of_week} ${sTime}`;
                }).join(", ")}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex px-6 pt-4 border-b border-slate-100 gap-2 overflow-x-auto no-scrollbar">
        {[
          { id: "attendance", label: "출결" },
          { id: "progress", label: "진도" },
          { id: "homework", label: "과제" },
          { id: "makeup", label: "보강" },
          { id: "exam", label: "성적" },
          { id: "consultation", label: "상담" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 text-xs font-extrabold rounded-full transition-all shrink-0 border ${
              activeTab === tab.id
                ? "bg-[#002864] text-white border-[#002864] shadow-sm"
                : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 영역 */}
      <div className="p-6 bg-slate-50/50">
        
        {/* 🌟 1. 출결 캘린더 탭 (복구됨) */}
        {activeTab === "attendance" && (
          <div className="animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex justify-between items-center mb-6 px-2">
                <button onClick={handlePrevMonth} className="text-slate-400 hover:text-slate-600 transition-colors p-1"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"></path></svg></button>
                <span className="font-black text-lg text-[#002864]">{year}년 {month + 1}월</span>
                <button onClick={handleNextMonth} className="text-slate-400 hover:text-slate-600 transition-colors p-1"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"></path></svg></button>
              </div>
              
              <div className="grid grid-cols-7 text-center text-[11px] font-extrabold mb-3">
                <span className="text-rose-500">일</span>
                <span className="text-slate-400">월</span>
                <span className="text-slate-400">화</span>
                <span className="text-slate-400">수</span>
                <span className="text-slate-400">목</span>
                <span className="text-slate-400">금</span>
                <span className="text-blue-500">토</span>
              </div>
              
              <div className="grid grid-cols-7 gap-y-3 text-center text-[13px] font-bold">
                {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`empty-${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const d = i + 1;
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const isSelected = selectedDateStr === dateStr;
                  const att = attendanceMap.get(dateStr);
                  
                  let dotColor = "";
                  if (att) {
                    if (att.status === '출석') dotColor = 'bg-emerald-500';
                    else if (att.status === '결석') dotColor = 'bg-rose-500';
                    else if (att.status === '지각') dotColor = 'bg-amber-500';
                    else dotColor = 'bg-slate-400';
                  }

                  return (
                     <div key={d} onClick={() => setSelectedDate(new Date(year, month, d))} className="flex flex-col items-center cursor-pointer group">
                       <div className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all ${isSelected ? 'bg-[#5b64f9] text-white shadow-md shadow-indigo-200' : 'hover:bg-slate-100 text-slate-700'}`}>
                         {d}
                       </div>
                       <div className="h-2 mt-1">
                          {att && <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />}
                       </div>
                     </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-4 bg-slate-50 rounded-xl p-4 border border-slate-200 shadow-sm">
               <div className="flex items-center gap-1.5 mb-2.5">
                 <span className="text-base">🗓️</span>
                 <span className="font-extrabold text-slate-800 text-[13px]">{String(selectedDate.getMonth() + 1).padStart(2, '0')}월 {String(selectedDate.getDate()).padStart(2, '0')}일 학습 현황</span>
               </div>
               <div className="bg-white p-3.5 rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
                 <div>
                   <div className="text-[10px] font-extrabold text-slate-400 mb-0.5">출결</div>
                   <div className={`text-sm font-black ${selectedAtt ? (selectedAtt.status === '출석' ? 'text-emerald-600' : selectedAtt.status === '결석' ? 'text-rose-600' : 'text-amber-600') : 'text-slate-600'}`}>
                     {selectedAtt ? selectedAtt.status : '등원 기록 없음'}
                   </div>
                 </div>
                 {selectedAtt && selectedAtt.check_in_time && (
                   <div className="text-right">
                     <div className="text-xl font-black text-[#002864] tracking-tight">{selectedAtt.check_in_time.substring(0, 5)}</div>
                   </div>
                 )}
               </div>
            </div>
          </div>
        )}

        {/* 🌟 2. 진도 탭 (유지됨) */}
        {activeTab === "progress" && (
          <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 bg-white px-3 py-2 rounded-lg border border-slate-200 w-fit mb-4 shadow-sm">
              <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5"><span className="w-2.5 h-3 rounded-sm bg-emerald-500 inline-block"></span> 완료</span>
              <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5"><span className="w-2.5 h-3 rounded-sm bg-amber-400 inline-block"></span> 과제 진행중</span>
              <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5"><span className="w-2.5 h-3 rounded-sm bg-slate-200 inline-block"></span> 미진행</span>
            </div>

            {!student.progressBooks || student.progressBooks.length === 0 ? (
              <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm">
                현재 반에 배정된 교재 진도 정보가 없습니다.
              </div>
            ) : (
              student.progressBooks.map((cb: any) => {
                const tb = unwrap(cb.textbook);
                const stats = cb.stats || { percent: 0, donePagesCount: 0, maxPageCount: 0, pageStatuses: {}, bookPages: [] };

                let bookBadgeClass = "bg-blue-50 text-blue-700 border-blue-200";
                if (tb?.book_type === "부교재") bookBadgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
                else if (tb?.book_type === "연산교재") bookBadgeClass = "bg-purple-50 text-purple-700 border-purple-200";
                else if (tb?.book_type === "워크북") bookBadgeClass = "bg-amber-50 text-amber-700 border-amber-200";

                return (
                  <div key={cb.class_textbook_id || cb.book_id} className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border shadow-sm ${bookBadgeClass} mr-2 inline-block mb-1`}>
                          {tb?.book_type || "교재"}
                        </span>
                        <div className="font-black text-slate-800 text-[15px]">{tb?.title || "교재명 없음"}</div>
                      </div>
                      <div className="text-right">
                        <span className="text-base font-black text-[#002864] tabular-nums">{stats.percent}%</span>
                        <div className="text-[10px] font-bold text-slate-400 tabular-nums mt-0.5">
                          {stats.donePagesCount} / {stats.maxPageCount}p
                        </div>
                      </div>
                    </div>
                    <div className="p-3 bg-slate-50/70 rounded-lg border border-slate-100 overflow-hidden">
                      {renderPageBlocks(stats.bookPages, stats.pageStatuses)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 미구현 탭들 */}
        {["homework", "makeup", "exam", "consultation"].includes(activeTab) && (
          <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm animate-[fadeIn_0.2s_ease-out]">
            <span className="text-3xl block mb-3 opacity-50">🛠️</span>
            해당 영역의 데이터 연동을 준비하고 있습니다.
          </div>
        )}
      </div>
    </div>
  );
}