// src/components/parent/StudentCard.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

const safeParseIds = (raw: any): number[] => {
  if (!raw) return [];
  try {
    let val = raw;
    if (typeof val === 'string') {
      if (val === "null" || val.trim() === "") return [];
      val = JSON.parse(val);
    }
    if (Array.isArray(val)) return val.map(Number);
  } catch (err) {
    console.warn("데이터 파싱 경고:", err);
  }
  return [];
};

// 💡 오늘의 KST 날짜 구하기 헬퍼 함수
const getKSTDateStr = (offsetDays = 0) => {
  const kstAdjusted = new Date(Date.now() + (9 * 3600000) - (6 * 3600000) + (offsetDays * 86400000));
  return kstAdjusted.toISOString().split('T')[0];
};

// 💡 상담 유형별 테마 컬러 (어드민 패널과 통일)
const getConsultBadgeColor = (type: string) => {
  switch(type) {
    case '퇴원상담': return 'bg-rose-50 text-rose-600 border-rose-200';
    case '신규상담': return 'bg-emerald-50 text-emerald-600 border-emerald-200';
    case '성적상담': return 'bg-violet-50 text-violet-600 border-violet-200';
    case '태도상담': return 'bg-amber-50 text-amber-600 border-amber-200';
    case '입학상담': return 'bg-amber-50 text-amber-700 border-amber-200';
    default: return 'bg-indigo-50 text-indigo-600 border-indigo-100'; // 재원상담 등
  }
};

export default function StudentCard({ student }: { student: any }) {
  const [activeTab, setActiveTab] = useState<"attendance" | "progress" | "homework" | "makeup" | "exam" | "consultation">("attendance");

  // 캘린더용 상태
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // 과제(수업 일지) 데이터 로딩 상태
  const [lessonLogs, setLessonLogs] = useState<any[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(false);

  // 토스트 팝업 상태 관리
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const activeEnrollment = student.enrollment?.find((e: any) => (!e.end_date || new Date(e.end_date) >= new Date()) && unwrap(e.class)?.name);
  const currentClass = activeEnrollment ? unwrap(activeEnrollment.class) : null;
  const className = currentClass?.name || "소속 반 없음";
  const classId = currentClass?.class_id;

  // 🌟 최근 상담 기록 처리 (내용을 제외하고 시간순 정렬)
  const consultLogs = student.consultation_log ? [...student.consultation_log].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) : [];

  useEffect(() => {
    if (activeTab === "homework" && classId) {
      const fetchLogs = async () => {
        setIsLogsLoading(true);
        try {
          const { data } = await supabase
            .from("daily_lesson_log")
            .select("lesson_log_id, actual_date, actual_session_no, homework_desc")
            .eq("class_id", classId)
            .not("homework_desc", "is", null)
            .order("actual_date", { ascending: false });
          
          setLessonLogs(data || []);
        } catch (error) {
          console.error("과제 정보 로딩 에러:", error);
        } finally {
          setIsLogsLoading(false);
        }
      };
      fetchLogs();
    }
  }, [activeTab, classId]);

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

  const formatTime = (isoString: string) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    return date.toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" });
  };

  const formatDateLabel = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  // 🌟 오늘의 출결 상태 연산 로직
  const todayStatus = useMemo(() => {
    const todayStr = getKSTDateStr();
    const todayAtt = attendanceMap.get(todayStr);

    let text = "오늘 아직 등원 전입니다.";
    let color = "bg-slate-50 text-slate-500 border-slate-200";
    let icon = "⏳";

    if (todayAtt) {
      const inTime = formatTime(todayAtt.check_in_time);
      const outTime = formatTime(todayAtt.check_out_time);

      if (todayAtt.status === '결석') {
        text = "오늘 결석 처리되었습니다.";
        color = "bg-rose-50 text-rose-600 border-rose-200";
        icon = "❌";
      } else if (todayAtt.status === '조퇴') {
        text = `오늘 ${outTime || '조기'} 조퇴 하원했습니다.`;
        color = "bg-orange-50 text-orange-600 border-orange-200";
        icon = "🏃";
      } else if (todayAtt.check_out_time || todayAtt.status === '하원') {
        text = `오늘 ${outTime} 하원 완료했습니다.`;
        color = "bg-emerald-50 text-emerald-600 border-emerald-200";
        icon = "👋";
      } else if (todayAtt.status === '지각') {
        text = `오늘 ${inTime} 지각 등원 (원내 체류중)`;
        color = "bg-amber-50 text-amber-600 border-amber-200";
        icon = "🏫";
      } else {
        text = `오늘 ${inTime} 등원 완료 (원내 체류중)`;
        color = "bg-blue-50 text-blue-600 border-blue-200";
        icon = "🏫";
      }
    }
    return { text, color, icon };
  }, [attendanceMap]);

  const renderPageBlocks = (bookPages: number[], pageStatuses: Record<number, 'done' | 'homework' | 'none'>) => {
    if (!bookPages || bookPages.length === 0) {
      return <span className="text-xs font-bold text-slate-400">교재 데이터가 없습니다.</span>;
    }

    return (
      <div className="flex flex-wrap gap-1 items-center">
        {bookPages.map((p) => {
          const status = pageStatuses[p] || "none";
          let bgColor = "bg-slate-200";
          let title = `${p}p (미진행)`;

          if (status === "done") {
            bgColor = "bg-emerald-500";
            title = `${p}p (완료)`;
          } else if (status === "homework") {
            bgColor = "bg-amber-400";
            title = `${p}p (과제 진행중)`;
          }

          return (
            <button 
              key={p} 
              onClick={() => showToast(title)}
              className={`w-2 h-2.5 rounded-[1px] ${bgColor} shadow-sm transition-colors hover:scale-150 active:scale-150 transform`} 
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden font-pretendard relative max-w-full">
      <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xl font-black text-slate-800">{student.name}</span>
            <span className="text-xs font-bold text-slate-400">학생</span>
          </div>
          <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full border border-slate-200 shadow-sm">
            {student.grade || "학년 정보 없음"}
          </span>
        </div>

        {/* 🌟 오늘의 출결 현황 배너 신설 */}
        <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-sm mt-1 mb-1 ${todayStatus.color}`}>
          <span className="text-xl leading-none shrink-0">{todayStatus.icon}</span>
          <span className="font-extrabold text-[13px]">{todayStatus.text}</span>
        </div>

        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col gap-2">
          <div className="flex justify-between items-center text-xs font-bold">
            <span className="text-slate-500 shrink-0 mr-2">소속 반</span>
            <span className="text-[#002864] font-black text-right">{className}</span>
          </div>
          {currentClass?.class_schedule && currentClass.class_schedule.length > 0 && (
            <div className="flex justify-between items-start text-xs font-bold">
              <span className="text-slate-500 shrink-0 mr-2 pt-0.5">시간표</span>
              
              <div className="flex flex-col items-end gap-1 text-slate-700">
                {currentClass.class_schedule.map((sc: any, idx: number) => {
                   const sTime = sc.start_time?.substring(0, 5) || "";
                   const eTime = sc.end_time?.substring(0, 5) || "";
                   const timeString = eTime ? `${sTime}~${eTime}` : sTime;
                   return (
                     <span key={idx} className="bg-white px-2 py-0.5 rounded border border-slate-200 shadow-sm whitespace-nowrap">
                       {sc.day_of_week} {timeString}
                     </span>
                   );
                })}
              </div>

            </div>
          )}
        </div>
      </div>

      <div className="flex px-4 sm:px-6 pt-4 border-b border-slate-100 gap-1.5 overflow-x-auto no-scrollbar justify-start">
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
            className={`px-3 py-1.5 text-[11px] font-extrabold rounded-full transition-all shrink-0 border ${
              activeTab === tab.id
                ? "bg-[#002864] text-white border-[#002864] shadow-sm"
                : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-6 bg-slate-50/50 min-h-[400px]">
        
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
               <div className="flex items-center gap-1.5 mb-3">
                 <span className="text-base">🗓️</span>
                 <span className="font-extrabold text-slate-800 text-[13px]">{String(selectedDate.getMonth() + 1).padStart(2, '0')}월 {String(selectedDate.getDate()).padStart(2, '0')}일 출결 현황</span>
               </div>
               
               {selectedAtt ? (
                 <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col gap-3">
                   <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                     <span className="text-[11px] font-extrabold text-slate-400">출석 상태</span>
                     <span className={`text-sm font-black ${selectedAtt.status === '출석' ? 'text-emerald-600' : selectedAtt.status === '결석' ? 'text-rose-600' : 'text-amber-600'}`}>
                       {selectedAtt.status}
                     </span>
                   </div>
                   
                   {selectedAtt.status !== '결석' && (
                     <div className="flex items-center justify-between gap-4">
                       <div className="flex-1 bg-slate-50 p-3 rounded-lg flex flex-col items-center justify-center border border-slate-100">
                         <span className="text-[10px] font-bold text-slate-400 mb-1">등원 시간</span>
                         <span className="text-base font-black text-slate-700">
                           {formatTime(selectedAtt.check_in_time) || "-"}
                         </span>
                       </div>
                       <div className="flex-1 bg-slate-50 p-3 rounded-lg flex flex-col items-center justify-center border border-slate-100">
                         <span className="text-[10px] font-bold text-slate-400 mb-1">하원 시간</span>
                         <span className="text-base font-black text-slate-700">
                           {formatTime(selectedAtt.check_out_time) || <span className="text-sm text-emerald-500">학습 진행중</span>}
                         </span>
                       </div>
                     </div>
                   )}
                 </div>
               ) : (
                 <div className="bg-white p-5 rounded-xl border border-slate-100 text-center shadow-sm">
                   <span className="text-sm font-bold text-slate-400">해당 날짜의 출결 기록이 없습니다.</span>
                 </div>
               )}
            </div>
          </div>
        )}

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

        {activeTab === "homework" && (
          <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
            {isLogsLoading ? (
              <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="w-6 h-6 border-4 border-[#002864] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                과제 및 진도 정보를 불러오는 중입니다...
              </div>
            ) : lessonLogs.length === 0 ? (
              <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm">
                <span className="text-3xl block mb-3 opacity-50">📚</span>
                아직 등록된 과제/알림장 내역이 없습니다.
              </div>
            ) : (
              lessonLogs.map((log) => (
                <div key={log.lesson_log_id || log.actual_date} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-3 transition-shadow hover:shadow-md">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                    <span className="text-sm font-black text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">
                      {formatDateLabel(log.actual_date)}
                    </span>
                    {log.actual_session_no && (
                      <span className="text-[11px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                        {log.actual_session_no}회차 수업
                      </span>
                    )}
                  </div>
                  <div className="text-[14px] font-medium text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {log.homework_desc}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 🌟 학부모용 상담 히스토리 탭 */}
        {activeTab === "consultation" && (
          <div className="space-y-3 animate-[fadeIn_0.2s_ease-out]">
             {consultLogs.length === 0 ? (
               <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm">
                 <span className="text-3xl block mb-3 opacity-50">💬</span>
                 아직 등록된 상담 기록이 없습니다.
               </div>
             ) : (
               consultLogs.map((log: any, idx: number) => {
                 const badgeColor = getConsultBadgeColor(log.consultation_type);
                 const dateStr = formatDateLabel(log.created_at);
                 const instName = unwrap(log.instructor)?.name || '학원';
                 const hasSummary = log.parent_summary && log.parent_summary.trim() !== "";

                 return (
                   <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2 transition-colors hover:bg-slate-50">
                     <div className="flex justify-between items-center">
                       <div className="flex items-center gap-2">
                         <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${badgeColor} whitespace-nowrap shadow-sm`}>
                           {log.consultation_type || '상담진행'}
                         </span>
                         <span className="text-[11px] font-bold text-slate-500">
                           {dateStr}
                         </span>
                       </div>
                       <div className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded border border-slate-200 whitespace-nowrap">
                         담당: {instName} 선생님
                       </div>
                     </div>
                     
                     {/* 🌟 상담 주제가 등록되어 있을 경우 하단에 굵게 표시 */}
                     {hasSummary && (
                       <div className="text-[13px] font-extrabold text-slate-800 pl-1 mt-1 leading-snug">
                         {log.parent_summary}
                       </div>
                     )}
                   </div>
                 );
               })
             )}
          </div>
        )}

        {["makeup", "exam"].includes(activeTab) && (
          <div className="text-center py-16 text-slate-400 font-bold bg-white rounded-xl border border-slate-200 shadow-sm animate-[fadeIn_0.2s_ease-out]">
            <span className="text-3xl block mb-3 opacity-50">🛠️</span>
            해당 영역의 데이터 연동을 준비하고 있습니다.
          </div>
        )}
      </div>

      {/* 🌟 토스트 팝업 UI */}
      {toastMessage && (
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 w-max max-w-[90%] bg-slate-800/90 text-white px-5 py-2.5 rounded-full text-[13px] font-bold shadow-lg z-[9999] pointer-events-none transition-all animate-[fadeIn_0.2s_ease-out]">
          📖 {toastMessage}
        </div>
      )}
    </div>
  );
}