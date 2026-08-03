"use client";

import React, { useState } from "react";

export default function StudentCard({ student }: { student: any }) {
  const classNames = student.enrollment?.map((e: any) => e.class?.name).filter(Boolean).join(", ") || "배정된 반 없음";
  const scheduleInfo = student.enrollment?.flatMap((e: any) => e.class?.class_schedule || []).map((sch: any) => `${sch.day_of_week} ${sch.start_time.slice(0, 5)}`).filter(Boolean).join(", ") || "시간표 미정";

  // 💡 [탭 상태 관리]
  const tabs = [
    { id: "calendar", label: "출결" },
    { id: "progress", label: "진도" },
    { id: "homework", label: "과제" },
    { id: "makeup", label: "보강" },
    { id: "grade", label: "성적" },
    { id: "counseling", label: "상담" },
  ];
  const [activeTab, setActiveTab] = useState("calendar"); // 첫 화면은 출결(달력)

  // 💡 [캘린더 상태 관리]
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const formatDate = (year: number, month: number, day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(today.getFullYear(), today.getMonth(), today.getDate()));

  // (임시 DB 데이터) 
  const mockDailyData: Record<string, any> = {
    [formatDate(today.getFullYear(), today.getMonth(), today.getDate())]: {
      attendance: { status: "출석", time: "16:02" },
      assignment: { title: "도형의 방정식 기본 프린트", status: "제출 완료", score: "90%" },
      exam: { title: "주간 평가", score: 92, avg: 85 } // 시험이 있는 날
    },
    [formatDate(today.getFullYear(), today.getMonth(), today.getDate() - 2)]: {
      attendance: { status: "결석", time: "-" },
      assignment: { title: "이차함수 활용", status: "미제출", score: "-" },
      exam: null
    },
    [formatDate(today.getFullYear(), today.getMonth(), today.getDate() - 5)]: {
      attendance: { status: "출석", time: "15:58" },
      assignment: { title: "다항식의 연산", status: "제출 완료", score: "100%" },
      exam: { title: "월말 평가", score: 100, avg: 78 } // 시험이 있는 날
    }
  };

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const calendarDays: (number | null)[] = [
  ...Array.from({ length: firstDayOfMonth }, () => null),
  ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ];  

  const dailyDetail = mockDailyData[selectedDate];

  return (
    <div className="w-full animate-[fadeIn_0.3s_ease-out]">
      
      {/* 1. 상단 프로필 영역 (높이 압축 완료!) */}
      <div className="mb-4">
        <div className="flex justify-between items-end mb-2 px-1">
          <h2 className="text-xl font-black text-slate-800 flex items-baseline gap-1.5">
            {student.name} <span className="text-xs font-bold text-slate-500">학생</span>
          </h2>
          <span className="text-xs font-extrabold text-slate-400 bg-slate-100 px-2 py-1 rounded-md">
            {student.school} {student.grade}
          </span>
        </div>
        
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm flex flex-col gap-2">
          <div className="flex justify-between items-center gap-2">
            <span className="text-[11px] font-bold text-slate-400 shrink-0">소속 반</span>
            <span className="text-xs font-extrabold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded text-right truncate">
              {classNames}
            </span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-[11px] font-bold text-slate-400 shrink-0">시간표</span>
            <span className="text-xs font-extrabold text-slate-700 text-right truncate">
              {scheduleInfo}
            </span>
          </div>
        </div>
      </div>

      {/* 2. 6가지 카테고리 탭 (가로 스크롤) */}
      <div className="flex overflow-x-auto gap-2 mb-4 pb-2 [&::-webkit-scrollbar]:hidden" style={{ msOverflowStyle: 'none', scrollbarWidth: 'none' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-bold rounded-full transition-all shrink-0 ${
              activeTab === tab.id
                ? "bg-slate-800 text-white shadow-md"
                : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 3. 메인 콘텐츠 렌더링 영역 */}
      {activeTab === "calendar" ? (
        <>
          {/* 달력 영역 */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm mb-4">
            <div className="flex justify-between items-center mb-3">
              <button onClick={() => setCurrentMonth(new Date(year, month - 1, 1))} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-full transition-colors">◀</button>
              <h3 className="font-black text-base text-slate-800">{year}년 {month + 1}월</h3>
              <button onClick={() => setCurrentMonth(new Date(year, month + 1, 1))} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-full transition-colors">▶</button>
            </div>
            
            <div className="grid grid-cols-7 gap-1 mb-1 text-center">
              {['일', '월', '화', '수', '목', '금', '토'].map((day, idx) => (
                <div key={day} className={`text-[10px] font-bold ${idx === 0 ? 'text-rose-500' : idx === 6 ? 'text-blue-500' : 'text-slate-400'}`}>{day}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day, index) => {
                if (!day) return <div key={`empty-${index}`} className="h-9"></div>;
                
                const dateStr = formatDate(year, month, day);
                const isSelected = selectedDate === dateStr;
                const dailyInfo = mockDailyData[dateStr];
                const hasAttendance = dailyInfo?.attendance;
                const hasExam = dailyInfo?.exam; // 💡 평가(시험) 여부 확인
                const isToday = dateStr === formatDate(today.getFullYear(), today.getMonth(), today.getDate());

                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(dateStr)}
                    className={`relative h-10 w-full flex flex-col items-center justify-start pt-1.5 rounded-xl text-sm font-bold transition-all
                      ${isSelected ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-indigo-50 text-slate-700'}
                      ${isToday && !isSelected ? 'border border-indigo-200 text-indigo-600' : ''}
                    `}
                  >
                    <span>{day}</span>
                    
                    {/* 💡 [핵심] 출결과 평가 포인트 인디케이터 */}
                    <div className="absolute bottom-1.5 flex gap-0.5">
                      {hasAttendance && !isSelected && <div className="w-1 h-1 bg-emerald-400 rounded-full"></div>}
                      {hasExam && !isSelected && <div className="w-1 h-1 bg-amber-400 rounded-full"></div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 선택된 날짜 상세 내역 */}
          <div className="bg-slate-100/70 rounded-2xl p-4 border border-slate-200">
            <h4 className="font-extrabold text-sm text-slate-800 mb-3 flex items-center gap-1.5">
              📅 {selectedDate.split("-")[1]}월 {selectedDate.split("-")[2]}일 학습 현황
            </h4>
            
            {!dailyDetail ? (
              <div className="text-center py-6 text-slate-400 font-bold text-xs">
                해당 날짜에는 학원 일정이 없습니다.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="bg-white p-3 rounded-xl shadow-sm flex justify-between items-center border border-slate-100">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 mb-0.5">출결</div>
                    <div className={`font-black text-sm ${dailyDetail.attendance.status === "결석" ? "text-rose-500" : "text-emerald-600"}`}>
                      {dailyDetail.attendance.status}
                    </div>
                  </div>
                  <div className="text-sm font-bold text-slate-600">{dailyDetail.attendance.time}</div>
                </div>

                {dailyDetail.assignment && (
                  <div className="bg-white p-3 rounded-xl shadow-sm border-l-[3px] border-indigo-500">
                    <div className="flex justify-between items-start mb-1">
                      <div className="text-[10px] font-bold text-indigo-500">과제</div>
                      <div className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md">{dailyDetail.assignment.status}</div>
                    </div>
                    <div className="font-bold text-sm text-slate-700 mb-1">{dailyDetail.assignment.title}</div>
                    <div className="text-right text-[10px] font-bold text-slate-500">성취도: <span className="text-indigo-600 text-xs">{dailyDetail.assignment.score}</span></div>
                  </div>
                )}

                {dailyDetail.exam && (
                  <div className="bg-white p-3 rounded-xl shadow-sm border-l-[3px] border-amber-400">
                    <div className="text-[10px] font-bold text-amber-500 mb-1">평가/시험</div>
                    <div className="flex items-end justify-between">
                      <div className="font-bold text-sm text-slate-700">{dailyDetail.exam.title}</div>
                      <div className="text-right">
                        <div className="text-lg font-black text-slate-800">{dailyDetail.exam.score}<span className="text-[10px] ml-0.5 font-bold text-slate-500">점</span></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        /* 다른 탭을 눌렀을 때 임시로 보여질 화면 */
        <div className="bg-white rounded-2xl p-10 border border-slate-200 shadow-sm text-center">
          <div className="text-3xl mb-3">🛠️</div>
          <h3 className="text-sm font-bold text-slate-800 mb-1">
            {tabs.find(t => t.id === activeTab)?.label} 메뉴 준비 중
          </h3>
          <p className="text-xs text-slate-400 font-bold">
            해당 영역의 데이터 연동을 준비하고 있습니다.
          </p>
        </div>
      )}
    </div>
  );
}