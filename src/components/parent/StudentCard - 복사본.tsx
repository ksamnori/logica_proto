// src/components/parent/StudentCard.tsx
"use client";
import React from "react";

export default function StudentCard({ student: s }: { student: any }) {
  let classList: string[] = [];
  let scheduleList: string[] = [];
  
  s.enrollment?.forEach((e: any) => { 
    if (e.class?.name && !classList.includes(e.class.name)) classList.push(e.class.name);
    e.class?.class_schedule?.forEach((cs: any) => { scheduleList.push(`${cs.day_of_week} ${cs.start_time ? cs.start_time.substring(0,5) : ''}`); });
  }); 
  
  const classNamesStr = classList.length > 0 ? classList.join(', ') : '반 미배정';
  const scheduleStr = scheduleList.length > 0 ? scheduleList.join(', ') : '시간표 정보 없음';
  const schoolName = s.school_name || s.school || '학교 미상';
  const statusName = s.status || '재원';
  const statusColor = statusName === '재원' ? 'bg-emerald-100 text-emerald-700' : (statusName === '퇴원' ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-slate-100 text-slate-500 border-slate-200');

  let recentScore: number | string = '-';
  let trendBars = <span className="text-[10px] text-slate-400 mb-1">데이터 부족</span>;
  
  if (s.exam_assignment && s.exam_assignment.length > 0) {
    const validExams = s.exam_assignment.filter((a: any) => a.total_score !== null).sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const last5 = validExams.slice(-5);
    if (last5.length > 0) {
      recentScore = last5[last5.length - 1].total_score;
      trendBars = (
        <>{last5.map((ex: any, i: number) => {
          const h = Math.max(15, ex.total_score);
          const isLast = i === last5.length - 1;
          return <div key={i} className={`w-2.5 rounded-t-sm ${isLast ? 'bg-[#002864]' : 'bg-blue-200'}`} style={{ height: `${h}%` }}></div>;
        })}</>
      );
    }
  }

  const hwColor = s.mockHwRate >= 85 ? 'bg-emerald-500' : 'bg-amber-500';

  const formatGrade = (grade: any) => {
    if (!grade) return "-";
    const g = parseInt(grade);
    if (isNaN(g)) return grade;
    if (g >= 1 && g <= 6) return `초${g}`;
    if (g >= 7 && g <= 9) return `중${g - 6}`;
    if (g >= 10 && g <= 12) return `고${g - 9}`;
    return `${g}학년`;
  };

  const renderCalendar = (attendance: any[]) => {
    const now = new Date();
    const year = now.getFullYear(); const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); const daysInMonth = new Date(year, month + 1, 0).getDate();
    let attendMap: any = {};
    (attendance || []).forEach(att => { attendMap[att.attendance_date] = att.status; });
    const blanks = Array.from({ length: firstDay }).map((_, i) => <div key={`blank-${i}`}></div>);
    const days = Array.from({ length: daysInMonth }).map((_, i) => {
      const d = i + 1; const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const status = attendMap[dateStr]; const isToday = d === now.getDate();
      let dotColor = "bg-transparent";
      if (status === "출석") dotColor = "bg-[#10b981]"; else if (status === "지각") dotColor = "bg-[#eab308]"; else if (status === "조퇴") dotColor = "bg-[#f97316]"; else if (status === "결석") dotColor = "bg-[#ef4444]";
      return (
        <div key={d} className={`flex flex-col items-center justify-center py-0.5 ${isToday ? "bg-blue-50 text-blue-600 rounded shadow-sm border border-blue-100" : "text-slate-600"}`}>
          <span className="text-[9px] font-bold">{d}</span>
          <div className={`w-1.5 h-1.5 rounded-full mx-auto mt-[2px] ${dotColor}`}></div>
        </div>
      );
    });

    return (
      <>
        <div className="flex justify-between items-center mb-1.5 px-1">
          <span className="text-[10px] font-bold text-slate-500">{month + 1}월 출석 현황</span>
          <div className="flex gap-1 text-[8px] font-bold text-slate-400">
            <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-[#10b981]"></span>출석</span>
            <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]"></span>결석</span>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center text-[9px] font-bold text-slate-400 mb-0.5">
          <div>일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div>토</div>
        </div>
        <div className="grid grid-cols-7 gap-[1px]">{blanks}{days}</div>
      </>
    );
  };

  return (
    <div className="border border-slate-200 p-5 rounded-2xl shadow-sm bg-white relative flex flex-col gap-4 hover:border-[#002864] transition-colors group">
      <div className="absolute left-0 top-0 h-full w-1.5 bg-[#002864] rounded-l-2xl"></div>
      <div className="pl-2">
        <h3 className="font-extrabold text-xl text-slate-800 flex items-center gap-2">
          {s.name} <span className={`text-[10px] font-bold ${statusColor} px-2.5 py-0.5 rounded-md border border-transparent`}>{statusName}</span>
        </h3>
        <p className="text-xs font-bold text-slate-500 mt-1.5">🏫 {schoolName} | {formatGrade(s.grade)}</p>
      </div>
      
      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 ml-2 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-2">
        <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-500 bg-white px-2 py-1 rounded border border-slate-200">소속 반</span><span className="text-sm font-extrabold text-[#002864]">{classNamesStr}</span></div>
        <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-500 bg-white px-2 py-1 rounded border border-slate-200">시간표</span><span className="text-sm font-bold text-slate-700">{scheduleStr}</span></div>
      </div>

      <div className="grid grid-cols-2 gap-3 ml-2">
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 flex flex-col min-h-[90px]">
          <p className="text-[10px] font-bold text-slate-400 mb-2">현재 주교재 진도</p>
          <div className="text-sm font-medium mt-auto flex items-center justify-center h-full text-xs text-slate-300">내용 없음</div>
        </div>
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 flex flex-col min-h-[90px]">
          <p className="text-[10px] font-bold text-slate-400 mb-2">배부된 과제</p>
          <div className="text-sm font-medium mt-auto flex items-center justify-center h-full text-xs text-slate-300">내용 없음</div>
        </div>
        <div className="bg-blue-50/50 rounded-xl p-3 border border-blue-100 flex flex-col justify-between min-h-[90px]">
          <p className="text-[10px] font-bold text-blue-500 mb-3">최근 테스트 결과</p>
          <div className="flex justify-between items-end h-12">
            <div className="flex items-end leading-none">{recentScore !== '-' ? <><span className="text-2xl font-black text-slate-700">{recentScore}</span><span className="text-xs font-bold text-slate-500 mb-1 ml-0.5">점</span></> : <span className="text-2xl font-black text-slate-400">-</span>}</div>
            <div className="flex items-end gap-1.5 h-full">{trendBars}</div>
          </div>
        </div>
        <div className="bg-emerald-50/50 rounded-xl p-3 border border-emerald-100 flex flex-col justify-between min-h-[90px]">
          <p className="text-[10px] font-bold text-emerald-600 mb-3">최근 과제 수행률</p>
          <div className="flex items-end leading-none mb-1.5"><span className="text-2xl font-black text-slate-700">{s.mockHwRate}</span><span className="text-xs font-bold text-slate-500 mb-1 ml-0.5">%</span></div>
          <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden mt-auto"><div className={`${hwColor} h-full rounded-full`} style={{ width: `${s.mockHwRate}%` }}></div></div>
        </div>
        <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200 shadow-sm flex flex-col justify-center col-span-2 sm:col-span-1">{renderCalendar(s.attendance)}</div>
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 flex flex-col min-h-[90px] col-span-2 sm:col-span-1">
          <p className="text-[10px] font-bold text-slate-400 mb-2">보강 일정</p><div className="text-sm font-medium mt-auto flex items-center justify-center h-full text-xs text-slate-300">일정 없음</div>
        </div>
      </div>
      <div className="bg-amber-50/40 rounded-xl p-3 border border-amber-100 ml-2 mt-1 flex flex-col min-h-[70px]">
        <p className="text-[10px] font-bold text-amber-600 mb-1">👩‍🏫 선생님 전달사항</p><div className="text-sm font-medium mt-auto flex items-center justify-center h-full text-xs text-slate-400">등록된 전달사항이 없습니다.</div>
      </div>
    </div>
  );
}