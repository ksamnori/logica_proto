// src/app/(dashboard)/home/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// 분리된 모달 컴포넌트
import MemoModal from "@/components/home/MemoModal";

export default function TeacherDashboardPage() {
  const router = useRouter();

  // === 기본 데이터 및 인증 상태 ===
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "", isSuperLevel: false });
  const [myClasses, setMyClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("all");

  // === 패널별 상태 ===
  const [students, setStudents] = useState<any[]>([]);
  const [classStats, setClassStats] = useState({ avgScore: 0, hwRate: 0, bookName: "-", bookProgress: 0 });
  
  // 다가오는 일정/회의 및 시험 상태
  const [upcomingSchedule, setUpcomingSchedule] = useState<{ type: string; title: string; time: string } | null>(null);
  const [upcomingExam, setUpcomingExam] = useState<{ title: string; time: string } | null>(null);

  const [csRequests, setCsRequests] = useState<any[]>([]);
  const [memos, setMemos] = useState<any[]>([]);

  // === 출결 관리 상태 ===
  const [attStudents, setAttStudents] = useState<any[]>([]);
  const [activeAttMenu, setActiveAttMenu] = useState<string | null>(null);

  // === 수동 시간 설정 모달 상태 ===
  const [manualModalData, setManualModalData] = useState<any | null>(null);
  const [manualForm, setManualForm] = useState({ status: "NONE", checkIn: "", checkOut: "" });

  // === 업무 공유 모달 상태 ===
  const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);

  // 🌟 우측 사이드바 캘린더 상태
  const [agendas, setAgendas] = useState<any[]>([]);
  const [externalEvents, setExternalEvents] = useState<any[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    const instId = localStorage.getItem("logica_instructor_id") || "1";
    const name = localStorage.getItem("logica_instructor_name") || "선생님";
    const role = localStorage.getItem("logica_instructor_role") || "";
    const position = localStorage.getItem("logica_instructor_position") || "";
    const isSuperLevel = role === 'SUPER_ADMIN' || role === 'ADMIN' || 
                         String(position).includes('최고관리자') || 
                         String(position).includes('원장') || 
                         String(position).includes('실장');

    setCurrentUser({ instId, name, isSuperLevel });

    loadDashboardData(instId);
    
    // 캘린더용 데이터 동시 로드
    fetchAgendas(instId, name, isSuperLevel);
    fetchGoogleEvents();
    
    const closeMenu = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest('.kebab-container')) return;
      setActiveAttMenu(null);
    };

    document.addEventListener("mousedown", closeMenu);
    
    // 안건(회의) 실시간 업데이트 구독
    const channel = supabase.channel('dashboard_agenda_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda' }, () => {
        fetchAgendas(instId, name, isSuperLevel);
      }).subscribe();

    return () => { 
      document.removeEventListener("mousedown", closeMenu);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (myClasses.length > 0 && selectedClassId !== "all") {
      fetchClassDetails(selectedClassId);
      fetchAttendance(selectedClassId);
    }
  }, [selectedClassId]);

  // ==========================================
  // 우측 캘린더 데이터 페치 (회의록과 동일)
  // ==========================================
  const fetchAgendas = async (instId: string, myName: string, isSuperLevel: boolean) => {
    const { data } = await supabase.from('agenda').select('*').order('created_at', { ascending: false });
    if (data) {
      const safeData = data.filter((a: any) => {
        if (!a.is_secret) return true; 
        if (isSuperLevel) return true; 
        const isCreator = a.created_by === instId;
        const isAttendee = a.attendees && a.attendees.split(',').map((n: string) => n.trim()).includes(myName);
        return isCreator || isAttendee;
      });
      setAgendas(safeData);
    }
  };

  const fetchGoogleEvents = async () => {
    try {
      const res = await fetch('/api/calendar', { cache: 'no-store' });
      const data = await res.json();
      if (data.success && data.events) {
        const external = data.events
          .filter((ev: any) => !ev.summary?.startsWith('[Logica]'))
          .map((ev: any) => {
            const startStr = ev.start?.dateTime || ev.start?.date;
            let endStr = ev.end?.dateTime || ev.end?.date;
            let isMultiDay = false;
            if (ev.end?.date) {
               const eDate = new Date(ev.end.date);
               eDate.setDate(eDate.getDate() - 1);
               endStr = eDate.toISOString().split('T')[0];
            }
            if (startStr && endStr) {
               const s = new Date(startStr); s.setHours(0,0,0,0);
               const e = new Date(endStr); e.setHours(0,0,0,0);
               if (e.getTime() > s.getTime()) isMultiDay = true;
            }
            return {
              id: ev.id,
              title: ev.summary || '(제목 없음)',
              content: ev.description || '<p>상세 내용 없음</p>',
              type: '외부 일정', 
              source: 'Meeting',
              status: '대기중',
              meeting_date: startStr,
              end_date: endStr,
              isMultiDay: isMultiDay,
              created_at: ev.created || new Date().toISOString(),
              attendees: '구글 캘린더',
              isExternal: true
            };
          });
        setExternalEvents(external);
      }
    } catch (e) { console.error('구글 캘린더 로드 실패:', e); }
  };

  const allCombinedAgendas = [...agendas, ...externalEvents];

  // ==========================================
  // 데이터 로딩 
  // ==========================================
  const loadDashboardData = async (instId: string) => {
    const { data: classes } = await supabase
      .from("class")
      .select("*, class_schedule(day_of_week, start_time, end_time)")
      .eq("instructor_id", instId);

    const sortedClasses = (classes || []).sort((a: any, b: any) => {
      const order = ["Ultimate", "Master", "Apex", "Titan", "Horizon", "여름 및 겨울 특강", "메이크업 및 보강"];
      let idxA = order.indexOf(a.level_name); let idxB = order.indexOf(b.level_name);
      if (idxA === -1) idxA = 999; if (idxB === -1) idxB = 999;
      if (idxA !== idxB) return idxA - idxB;
      return a.name.localeCompare(b.name);
    });

    setMyClasses(sortedClasses);
    if (sortedClasses.length > 0) {
      setSelectedClassId(sortedClasses[0].class_id);
    }

    const { data: classIds } = await supabase.from("class").select("class_id").eq("instructor_id", instId);
    const cIds = classIds?.map((c: any) => c.class_id) || [];
    
    if (cIds.length > 0) {
      const { data: enrolls } = await supabase.from("enrollment").select("student_id").in("class_id", cIds);
      const sIds = enrolls ? Array.from(new Set(enrolls.map((e: any) => e.student_id))) : [];

      if (sIds.length > 0) {
        const safeStudentIds = sIds.slice(0, 200); 
        const { data: csData } = await supabase.from("parent_request_log")
          .select("*, student(name)").in("student_id", safeStudentIds).eq("status", "대기").order("created_at", { ascending: false }).limit(10);
        setCsRequests(csData || []);
      }
    }

    fetchUpcomingSchedules();
    fetchMemos();
  };

  const fetchUpcomingSchedules = async () => {
    const todayStr = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];

    try {
      const { data: exams } = await supabase
        .from("admission_session")
        .select("title, test_date, start_time")
        .gte("test_date", todayStr)
        .order("test_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(1);

      if (exams && exams.length > 0) {
        const d = exams[0].test_date.split("-");
        const t = exams[0].start_time ? exams[0].start_time.substring(0, 5) : "";
        setUpcomingExam({
          title: exams[0].title,
          time: `${d[1]}.${d[2]} ${t}`
        });
      } else {
        setUpcomingExam(null);
      }

      const { data: schedules } = await supabase
        .from("agenda") 
        .select("title, meeting_date") 
        .eq('source', 'Meeting')
        .gte("meeting_date", todayStr) 
        .order("meeting_date", { ascending: true }) 
        .limit(1);

      if (schedules && schedules.length > 0) {
        const dateObj = new Date(schedules[0].meeting_date);
        const timeStr = `${String(dateObj.getHours()).padStart(2,'0')}:${String(dateObj.getMinutes()).padStart(2,'0')}`;
        setUpcomingSchedule({
          type: "회의",
          title: schedules[0].title, 
          time: timeStr !== '00:00' ? `${dateObj.getMonth()+1}.${dateObj.getDate()} ${timeStr}` : `${dateObj.getMonth()+1}.${dateObj.getDate()}`
        });
      } else {
        setUpcomingSchedule(null);
      }
    } catch (e) { console.error("일정 로드 오류:", e); }
  };

  const fetchMemos = async () => {
    const { data: memoData } = await supabase.from("instructor_memo")
      .select("*").neq("status", "완료").order("created_at", { ascending: false }).limit(20);
    setMemos(memoData || []);
  };

  const fetchClassDetails = async (classId: string) => {
    const [ { data: enrollData }, { data: directData } ] = await Promise.all([
      supabase.from("enrollment").select("student_id").eq("class_id", classId),
      supabase.from("student").select("student_id").eq("class_id", classId)
    ]);

    const enrollIds = enrollData?.map((e: any) => e.student_id) || [];
    const directIds = directData?.map((s: any) => s.student_id) || [];
    const allTargetIds = Array.from(new Set([...enrollIds, ...directIds]));

    if (allTargetIds.length === 0) {
      setStudents([]);
      setClassStats({ avgScore: 0, hwRate: 0, bookName: "주교재 미배정", bookProgress: 0 });
      return;
    }

    const { data: classStudents } = await supabase
      .from("student")
      .select("*, parent(*), exam_assignment(*), enrollment(class(name)), consultation_log(created_at)")
      .eq("status", "재원")
      .in("student_id", allTargetIds);
    
    let totalScore = 0; let scoreCount = 0; let hwSubmitCount = 0;
    
    (classStudents || []).forEach((s: any, idx: number) => {
      if (s.exam_assignment && s.exam_assignment.length > 0 && s.exam_assignment[0].total_score !== null) {
        totalScore += s.exam_assignment[0].total_score;
        scoreCount++;
      }
      if (idx % 5 !== 0) hwSubmitCount++; 
    });

    setStudents((classStudents || []).sort((a: any, b: any) => a.name.localeCompare(b.name)));

    const avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;
    const hwRate = (classStudents || []).length > 0 ? Math.round((hwSubmitCount / (classStudents || []).length) * 100) : 0;

    const { data: cbData } = await supabase.from("class_textbook").select("*, textbook(*)").eq("class_id", classId).eq("textbook.book_type", "주교재");
    const bookName = cbData && cbData.length > 0 ? cbData[0].textbook?.title : "주교재 미배정";
    const bookProgress = cbData && cbData.length > 0 ? Math.floor(Math.random() * 40) + 30 : 0; 

    setClassStats({ avgScore, hwRate, bookName, bookProgress });
  };

  const fetchAttendance = async (classId: string) => {
    const today = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];

    const [ { data: enrollData }, { data: directData } ] = await Promise.all([
      supabase.from("enrollment").select("student_id").eq("class_id", classId),
      supabase.from("student").select("student_id").eq("class_id", classId)
    ]);

    const enrollIds = enrollData?.map((e: any) => e.student_id) || [];
    const directIds = directData?.map((s: any) => s.student_id) || [];
    const allTargetIds = Array.from(new Set([...enrollIds, ...directIds]));

    if (allTargetIds.length === 0) {
      setAttStudents([]);
      return;
    }

    const { data: classStudents } = await supabase
      .from("student")
      .select(`
        student_id, name, 
        attendance(attendance_id, status, check_in_time, check_out_time, attendance_date)
      `)
      .eq("status", "재원")
      .in("student_id", allTargetIds);
    
    const mappedAtt = (classStudents || []).map((st: any) => {
      const todayAtt = st.attendance?.find((a: any) => a.attendance_date === today);
      return { 
        id: st.student_id, 
        name: st.name, 
        att_id: todayAtt?.attendance_id, 
        status: todayAtt?.status || "NONE", 
        checkIn: todayAtt?.check_in_time,
        checkOut: todayAtt?.check_out_time
      };
    });

    setAttStudents(mappedAtt.sort((a: any, b: any) => a.name.localeCompare(b.name)));
  };

  const attSummary = useMemo(() => {
    let total = 0, present = 0, earlyLeave = 0, absent = 0;
    attStudents.forEach(st => {
      total++;
      if (st.status === "결석") absent++;
      else if (st.status === "조퇴") earlyLeave++;
      else if (["출석", "지각"].includes(st.status)) present++;
    });
    return { total, present, leave: earlyLeave, absent };
  }, [attStudents]);

  const handleAttAction = async (student: any, action: string) => {
    const today = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];
    const nowTimestamp = new Date().toISOString();
    let payload: any = {};

    if (action === "ABSENT" && student.status !== "결석") {
      if (!confirm(`[${student.name}] 학생을 '결석' 처리하시겠습니까?`)) return;
    }

    if (action === "DELETE") {
      if (!confirm(`[${student.name}] 학생의 오늘 출결 기록을 초기화(삭제)하시겠습니까?`)) return;
      if (student.att_id) {
        await supabase.from("attendance").delete().eq("attendance_id", student.att_id);
      }
      fetchAttendance(selectedClassId);
      return;
    }

    if (action === "PRESENT") {
      payload = { status: "출석" };
      if (!student.checkIn) payload.check_in_time = nowTimestamp;
    } else if (action === "LATE") {
      payload = { status: "지각" };
      if (!student.checkIn) payload.check_in_time = nowTimestamp;
    } else if (action === "ABSENT") {
      payload = { status: "결석", check_in_time: null, check_out_time: null };
    } else if (action === "EARLY_LEAVE") {
      payload = { status: "조퇴" };
      if (!student.checkOut) payload.check_out_time = nowTimestamp;
    } else if (action === "ENDED") {
      payload = { check_out_time: nowTimestamp };
    }

    try {
      if (student.att_id) {
        await supabase.from("attendance").update(payload).eq("attendance_id", student.att_id);
      } else {
        const { data: fallback } = await supabase.from("enrollment").select("enrollment_id").eq("student_id", student.id).eq("class_id", selectedClassId).maybeSingle();
        await supabase.from("attendance").insert({
          student_id: student.id, class_id: selectedClassId, enrollment_id: fallback?.enrollment_id || null, attendance_date: today, ...payload
        });
      }
    } catch (e) { console.error(e); } finally {
      fetchAttendance(selectedClassId);
    }
  };

  const bulkAttend = async () => {
    if (!confirm('현재 미처리된 모든 학생을 "출석" 처리하시겠습니까?')) return;
    const toUpdate = attStudents.filter(s => s.status === "NONE");
    for (const s of toUpdate) await handleAttAction(s, "PRESENT");
  };

  const bulkEnd = async () => {
    if (!confirm('현재 출석/지각 학생을 모두 "수업 종료" 처리하시겠습니까?')) return;
    const toUpdate = attStudents.filter(s => ["출석", "지각"].includes(s.status) && !s.checkOut);
    for (const s of toUpdate) await handleAttAction(s, "ENDED");
  };

  const formatTimeForInput = (isoStr: string) => {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const openManualModal = (student: any) => {
    setManualModalData(student);
    setManualForm({
      status: student.status === "NONE" ? "출석" : student.status,
      checkIn: formatTimeForInput(student.checkIn),
      checkOut: formatTimeForInput(student.checkOut)
    });
    setActiveAttMenu(null);
  };

  const handleManualSave = async () => {
    const today = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];
    const toIsoString = (timeStr: string) => {
      if (!timeStr) return null;
      const [hh, mm] = timeStr.split(':');
      const d = new Date(`${today}T${hh}:${mm}:00+09:00`);
      return d.toISOString();
    };

    const { status, checkIn, checkOut } = manualForm;

    try {
      if (status === "NONE") {
        if (manualModalData.att_id) {
          await supabase.from("attendance").delete().eq("attendance_id", manualModalData.att_id);
        }
      } else {
        const payload: any = {
          status,
          check_in_time: toIsoString(checkIn),
          check_out_time: toIsoString(checkOut)
        };

        if (status === "결석") {
          payload.check_in_time = null;
          payload.check_out_time = null;
        }

        if (manualModalData.att_id) {
          await supabase.from("attendance").update(payload).eq("attendance_id", manualModalData.att_id);
        } else {
          const { data: fallback } = await supabase.from("enrollment").select("enrollment_id").eq("student_id", manualModalData.id).eq("class_id", selectedClassId).maybeSingle();
          await supabase.from("attendance").insert({
            student_id: manualModalData.id, class_id: selectedClassId, enrollment_id: fallback?.enrollment_id || null, attendance_date: today, ...payload
          });
        }
      }
      alert("✅ 출결이 성공적으로 수동 반영되었습니다.");
    } catch (e) { alert("❌ 업데이트 중 오류가 발생했습니다."); } 
    finally {
      setManualModalData(null);
      fetchAttendance(selectedClassId);
    }
  };

  const deleteMemo = async (memoId: string) => {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;
    try {
      await supabase.from("instructor_memo").delete().eq("memo_id", memoId);
      fetchMemos();
    } catch (e) { alert("삭제 실패"); }
  };

  const formatGrade = (grade: any) => {
    if (!grade) return "-";
    const g = parseInt(grade);
    if (isNaN(g)) return grade;
    if (g >= 1 && g <= 6) return `초${g}`;
    if (g >= 7 && g <= 9) return `중${g - 6}`;
    if (g >= 10 && g <= 12) return `고${g - 9}`;
    return `${g}학년`;
  };

  // ==========================================
  // 🌟 캘린더 렌더링 헬퍼 함수 
  // ==========================================
  const getMeetingTypeTheme = (type: string) => {
    if (type === '주간 회의') return { dot: 'bg-blue-500', text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' };
    if (type === '임시 회의') return { dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' };
    if (type === '상담/면담') return { dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' };
    if (type === '외부 일정') return { dot: 'bg-purple-500', text: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' };
    return { dot: 'bg-slate-500', text: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' };
  };

  return (
    <div className="flex w-full h-full bg-slate-50 overflow-hidden">
      
      {/* 🌟 [핵심 변경] 좌측 메인 대시보드 영역 (gap을 줄여서 위로 바짝 당김) */}
      <div className="flex-1 flex flex-col h-full overflow-y-auto custom-scroll p-4 sm:p-6 lg:p-8 gap-5 relative max-w-[1400px] mx-auto min-w-0">
        
        {/* 🌟 [핵심 변경] "내 담당 클래스" 버튼들을 제목 우측에 나란히 배치 */}
        <section className="flex flex-col xl:flex-row xl:items-center gap-3 xl:gap-6 shrink-0 w-full">
          <h1 className="text-lg font-extrabold text-slate-800 flex items-center gap-2 shrink-0">👨‍🏫 내 담당 클래스</h1>
          <div className="flex gap-2.5 flex-wrap">
            {myClasses.length === 0 ? <span className="text-slate-400 font-bold text-sm">배정된 반이 없습니다.</span> : 
              myClasses.map((c: any) => {
                let scheduleStr = "시간표 미설정";
                if (c.class_schedule?.length > 0) {
                  const days = ["월", "화", "수", "목", "금", "토", "일"];
                  c.class_schedule.sort((a: any, b: any) => days.indexOf(a.day_of_week) - days.indexOf(b.day_of_week));
                  scheduleStr = c.class_schedule.map((sc: any) => {
                    const st = sc.start_time?.substring(0, 5) || ""; const et = sc.end_time?.substring(0, 5) || "";
                    return et ? `${sc.day_of_week} ${st}~${et}` : `${sc.day_of_week} ${st}`;
                  }).join(", ");
                } else if (c.schedule_days) {
                  scheduleStr = c.schedule_days;
                }

                const isActive = selectedClassId === c.class_id;
                return (
                  <button 
                    key={c.class_id} onClick={() => setSelectedClassId(c.class_id)}
                    className={`px-4 py-2 rounded-xl border-2 shadow-sm flex flex-col items-start transition-all text-left min-w-[120px] ${isActive ? "bg-[#002864] text-white border-[#002864]" : "bg-white text-slate-500 border-transparent hover:border-slate-400 hover:text-slate-700"}`}
                  >
                    <span className="text-sm font-extrabold tracking-tight leading-tight">{c.name}</span>
                    <span className="text-[10px] mt-0.5 font-medium opacity-80 leading-none tracking-tight whitespace-nowrap">{scheduleStr}</span>
                  </button>
                );
              })
            }
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0 mt-1">
          <div className="flex flex-col gap-3 h-[220px]">
            <div onClick={() => router.push('/exam')} className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex-1 flex flex-col justify-center hover:border-blue-300 transition-colors cursor-pointer">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold text-slate-500">학업 성취도 (평균)</span>
                <span className="text-xl font-black text-slate-800 leading-none">{classStats.avgScore > 0 ? classStats.avgScore : "-"}<span className="text-xs font-bold text-slate-500 ml-0.5">점</span></span>
              </div>
              <div>
                <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                  <span>과제 제출률</span>
                  <span className="text-blue-600">{classStats.hwRate}%</span>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${classStats.hwRate < 60 ? "bg-rose-500" : "bg-blue-500"}`} style={{ width: `${classStats.hwRate}%` }}></div>
                </div>
              </div>
            </div>
            
            <div onClick={() => router.push('/progress')} className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex-1 flex flex-col justify-center hover:border-emerald-300 transition-colors cursor-pointer">
              <div className="flex justify-between items-start mb-1">
                <span className="text-xs font-bold text-slate-500">주교재 진도율</span>
              </div>
              <h3 className="text-[11px] font-extrabold text-slate-700 truncate mb-1">{classStats.bookName}</h3>
              <div className="flex items-center gap-2">
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden flex-1">
                  <div className="bg-emerald-500 h-full rounded-full transition-all duration-500" style={{ width: `${classStats.bookProgress}%` }}></div>
                </div>
                <span className="text-sm font-black text-emerald-500">{classStats.bookProgress}%</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-center hover:border-indigo-300 transition-colors h-[220px]">
            <span className="text-sm font-bold text-slate-500 mb-4 shrink-0">📅 오늘의 주요 일정</span>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col justify-center bg-indigo-50 p-3 rounded-xl border border-indigo-100 transition-colors h-[68px]">
                <span className="text-[10px] font-bold text-indigo-500 mb-1">🗣️ 진행 예정 회의</span>
                {upcomingSchedule ? (
                   <div className="flex items-center gap-2">
                      <span className="text-xs font-black bg-white text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-200 shrink-0">{upcomingSchedule.time}</span>
                      <span className="text-sm font-bold text-indigo-800 truncate leading-tight" title={upcomingSchedule.title}>{upcomingSchedule.title}</span>
                   </div>
                ) : (
                   <span className="text-xs font-bold text-indigo-400">예정된 회의 일정이 없습니다.</span>
                )}
              </div>
              <div onClick={() => router.push('/admission')} className="flex flex-col justify-center bg-amber-50 p-3 rounded-xl border border-amber-100 cursor-pointer hover:bg-amber-100 transition-colors h-[68px]">
                <span className="text-[10px] font-bold text-amber-500 mb-1">📝 임박한 입학테스트</span>
                {upcomingExam ? (
                   <div className="flex items-center gap-2">
                      <span className="text-xs font-black bg-white text-amber-600 px-1.5 py-0.5 rounded border border-amber-200 shrink-0">{upcomingExam.time}</span>
                      <span className="text-sm font-bold text-amber-800 truncate leading-tight" title={upcomingExam.title}>{upcomingExam.title}</span>
                   </div>
                ) : (
                   <span className="text-xs font-bold text-amber-400">예정된 테스트가 없습니다.</span>
                )}
              </div>
            </div>
          </div>

          <div onClick={() => router.push('/cs')} className="bg-white rounded-2xl p-4 border border-rose-100 shadow-sm flex flex-col hover:border-rose-300 transition-colors cursor-pointer h-[220px]">
            <div className="flex justify-between items-center mb-2 shrink-0">
              <span className="text-sm font-bold text-rose-500 flex items-center gap-1">🚨 미처리 학부모 요청</span>
            </div>
            <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto custom-scroll pr-1 min-h-0">
              {csRequests.length === 0 ? <div className="text-center py-6 text-slate-400 font-bold text-xs">새로 배정된 요청이 없습니다. 🎉</div> : 
                csRequests.map((r: any) => (
                  <div key={r.request_id} className="shrink-0 text-[11px] font-bold text-slate-600 bg-rose-50 p-2 rounded border border-rose-100 truncate shadow-sm cursor-pointer hover:bg-rose-100 transition-colors">
                    <span className="text-rose-600 mr-1">{r.student?.name || '알수없음'}:</span>{r.reason}
                  </div>
                ))
              }
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-purple-100 shadow-sm flex flex-col hover:border-purple-300 transition-colors cursor-pointer h-[220px]" onClick={() => router.push('/task')}>
            <div className="flex justify-between items-center mb-2 shrink-0">
              <span className="text-sm font-bold text-slate-500 flex items-center gap-1">📌 업무 공유 보드</span>
              <button onClick={(e) => { e.stopPropagation(); setIsMemoModalOpen(true); }} className="text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1.5 rounded font-bold transition-colors border border-blue-200 shadow-sm">+ 작성</button>
            </div>
            <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto custom-scroll pr-1 min-h-0">
              {memos.length === 0 ? <div className="text-center py-6 text-slate-400 font-bold text-xs mt-2">등록된 공지/업무가 없습니다.</div> : 
                memos.map((m: any) => {
                  let typeColor = 'text-slate-600 bg-slate-100 border-slate-200'; 
                  if (m.memo_type === '긴급공지') typeColor = 'text-rose-600 bg-rose-100 border-rose-200';
                  else if (m.memo_type === '학생인계') typeColor = 'text-blue-600 bg-blue-100 border-blue-200';
                  else if (m.memo_type === '일반공지') typeColor = 'text-emerald-600 bg-emerald-100 border-emerald-200';
                  return (
                    <div key={m.memo_id} className="shrink-0 flex flex-col border-b border-slate-100 pb-2 mb-1 last:border-0 hover:bg-slate-50/50 p-1 rounded transition-colors group">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[9px] font-black ${typeColor} px-1.5 py-0.5 rounded border`}>{m.memo_type}</span>
                        <div className="flex items-center">
                          <span className="text-[9px] font-bold text-slate-400">{m.author_name}</span>
                          {String(m.instructor_id) === currentUser.instId && <button onClick={(e) => { e.stopPropagation(); deleteMemo(m.memo_id); }} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 font-bold ml-2 transition-colors">×</button>}
                        </div>
                      </div>
                      <span className="text-[11px] font-bold text-slate-700 leading-snug whitespace-pre-wrap truncate">{m.content}</span>
                    </div>
                  );
                })
              }
            </div>
          </div>
        </section>

        <section className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 overflow-hidden min-h-[400px]">
          
          <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-full">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
              <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">👨‍🎓 반 학생 상세 현황</h2>
              <span className="text-xs font-bold text-slate-500 bg-white border border-slate-200 px-2 py-1 rounded-md">총 {students.length}명</span>
            </div>
            <div className="overflow-x-auto overflow-y-auto custom-scroll flex-1">
              <table className="w-full text-left border-collapse min-w-[700px]">
                <thead className="bg-white sticky top-0 shadow-sm z-10">
                  <tr>
                    <th className="py-2 pl-3 pr-1 w-24 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">이름</th>
                    <th className="py-2 px-1 w-32 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">수강중 반 목록</th>
                    <th className="py-2 px-1 w-20 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider text-center">학교</th>
                    <th className="py-2 px-1 w-12 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider text-center">학년</th>
                    <th className="py-2 px-1 w-24 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider text-center">학생 연락처</th>
                    <th className="py-2 px-1 w-24 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider text-center">부모 연락처</th>
                    <th className="py-2 px-1 w-20 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider text-center">최근 상담</th>
                    <th className="py-2 pl-1 pr-3 w-16 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.length === 0 ? <tr><td colSpan={8} className="py-16 text-center text-slate-400 font-bold">이 반에 등록된 학생이 없습니다.</td></tr> : 
                    students.map(s => {
                      const schoolName = s.school_name || s.school || "-";
                      const gradeText = formatGrade(s.grade);
                      const studentContact = s.phone || s.student_contact || "-";
                      const parentContact = s.parent?.phone || s.parent?.parent_contact || "-";
                      const classNames = s.enrollment?.map((e: any) => e.class?.name).filter(Boolean).join(", ") || "반 미배정";

                      let consultHtml = <span className="text-[10px] font-bold text-slate-300">기록없음</span>;
                      if (s.consultation_log && s.consultation_log.length > 0) {
                        const logs = [...s.consultation_log].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                        const recentDate = new Date(logs[0].created_at).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\.$/, '');
                        
                        consultHtml = (
                          <button 
                            onClick={() => window.open(`/student/${s.student_id}?tab=consult`, '_blank')}
                            className="text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-700 px-2 py-1 rounded transition-colors shadow-sm"
                          >
                            {recentDate}
                          </button>
                        );
                      }

                      return (
                        <tr key={s.student_id} className="hover:bg-blue-50/40 transition-colors border-b border-slate-100">
                          <td className="py-2.5 pl-3 pr-1 w-24">
                            <div className="flex items-center gap-2 cursor-pointer group w-max" onClick={() => window.open(`/student/${s.student_id}`, '_blank')}>
                              <div className="w-6 h-6 rounded-full bg-blue-100 text-[#002864] flex items-center justify-center text-[10px] font-black shrink-0 transition-colors group-hover:bg-[#002864] group-hover:text-white">
                                {s.name.substring(1)}
                              </div>
                              <span className="text-xs font-bold text-slate-800 group-hover:text-blue-600 group-hover:underline whitespace-nowrap transition-colors">
                                {s.name}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-1 text-[11px] font-bold text-slate-600 truncate max-w-[120px]" title={classNames}>{classNames}</td>
                          <td className="py-2.5 px-1 text-center text-[11px] font-medium text-slate-500 truncate max-w-[70px]" title={schoolName}>{schoolName}</td>
                          <td className="py-2.5 px-1 text-center text-[11px] font-bold text-slate-600 whitespace-nowrap">{gradeText}</td>
                          <td className="py-2.5 px-1 text-center text-[11px] font-medium text-slate-500 whitespace-nowrap">{studentContact}</td>
                          <td className="py-2.5 px-1 text-center text-[11px] font-medium text-slate-500 whitespace-nowrap">{parentContact}</td>
                          <td className="py-2.5 px-1 text-center whitespace-nowrap">{consultHtml}</td>
                          <td className="py-2.5 pl-1 pr-3 text-right">
                            <button onClick={() => window.open(`/student/${s.student_id}`, '_blank')} className="text-[10px] font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 px-2 py-1 rounded transition-colors shadow-sm whitespace-nowrap">리포트</button>
                          </td>
                        </tr>
                      );
                    })
                  }
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden hover:border-blue-300 transition-colors h-full">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex flex-col gap-2 shrink-0">
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-slate-500">오늘의 출결 현황</span>
                <button onClick={() => fetchAttendance(selectedClassId)} className="text-[10px] font-bold text-[#002864] bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 transition-colors">새로고침</button>
              </div>
            </div>
            
            <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-100 bg-white shrink-0">
              <div className="flex flex-col items-center py-2"><span className="text-xs font-black text-slate-800">{attSummary.total}</span><span className="text-[9px] font-bold text-slate-400 mt-0.5">전체</span></div>
              <div className="flex flex-col items-center py-2"><span className="text-xs font-black text-blue-600">{attSummary.present}</span><span className="text-[9px] font-bold text-slate-400 mt-0.5">출석/지각</span></div>
              <div className="flex flex-col items-center py-2"><span className="text-xs font-black text-indigo-500">{attSummary.leave}</span><span className="text-[9px] font-bold text-slate-400 mt-0.5">조퇴</span></div>
              <div className="flex flex-col items-center py-2"><span className="text-xs font-black text-rose-500">{attSummary.absent}</span><span className="text-[9px] font-bold text-slate-400 mt-0.5">결석</span></div>
            </div>

            <div className="flex gap-2 p-2 border-b border-slate-100 bg-white shrink-0">
              <button onClick={bulkAttend} className="flex-1 text-[10px] font-bold bg-[#002864] text-white py-1.5 rounded hover:bg-blue-900 transition-colors shadow-sm">전체 출석</button>
              <button onClick={bulkEnd} className="flex-1 text-[10px] font-bold bg-slate-700 text-white py-1.5 rounded hover:bg-slate-900 transition-colors shadow-sm">전체 종료</button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll p-3 space-y-2 bg-slate-50 relative pb-10">
              {attStudents.length === 0 ? <div className="text-center py-6 text-xs text-slate-400 font-bold">해당 반에 조회된 학생이 없습니다.</div> :
                attStudents.map(student => {
                  const isPresent = student.status === '출석';
                  const isAbsent = student.status === '결석';
                  const isLate = student.status === '지각';
                  const isEarlyLeave = student.status === '조퇴';
                  const isMenuOpen = activeAttMenu === student.id;

                  const timeInStr = student.checkIn ? new Date(student.checkIn).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" }) : "";
                  const timeOutStr = student.checkOut ? new Date(student.checkOut).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" }) : "";

                  return (
                    <div key={student.id} className="bg-white p-2 rounded-xl border border-slate-200 flex flex-col justify-center text-xs shadow-sm hover:border-slate-300 transition-colors relative gap-2">
                      
                      <div className="flex justify-between items-center w-full">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                          </div>
                          <span className="font-bold text-slate-800 text-[13px]">{student.name}</span>
                        </div>

                        <div className="relative inline-block shrink-0 kebab-container">
                          <button 
                            onClick={() => setActiveAttMenu(isMenuOpen ? null : student.id)} 
                            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg>
                          </button>
                          {isMenuOpen && (
                              <div className="absolute right-0 top-6 w-32 bg-white shadow-xl rounded-xl border border-slate-200 z-50 py-1">
                                <button onClick={() => { openManualModal(student); }} className="w-full text-left px-4 py-2.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">⚙️ 수동 설정</button>
                                <hr className="border-slate-100 my-0.5" />
                                <button onClick={() => { setActiveAttMenu(null); handleAttAction(student, 'DELETE'); }} className="w-full text-left px-4 py-2.5 text-[11px] font-bold text-rose-500 hover:bg-slate-50 flex items-center gap-2">🗑️ 기록 삭제</button>
                              </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center w-full rounded-md border border-slate-200 overflow-hidden shadow-sm">
                        <button onClick={() => handleAttAction(student, 'PRESENT')} className={`flex-1 py-1.5 text-[11px] font-extrabold transition-colors ${isPresent ? 'bg-emerald-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>출석</button>
                        <div className="w-px bg-slate-200 h-4"></div>
                        <button onClick={() => handleAttAction(student, 'ABSENT')} className={`flex-1 py-1.5 text-[11px] font-extrabold transition-colors ${isAbsent ? 'bg-rose-400 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>결석</button>
                        <div className="w-px bg-slate-200 h-4"></div>
                        <button onClick={() => handleAttAction(student, 'LATE')} className={`flex-1 py-1.5 text-[11px] font-extrabold transition-colors ${isLate ? 'bg-amber-400 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>지각</button>
                        <div className="w-px bg-slate-200 h-4"></div>
                        <button onClick={() => handleAttAction(student, 'EARLY_LEAVE')} className={`flex-1 py-1.5 text-[11px] font-extrabold transition-colors ${isEarlyLeave ? 'bg-indigo-400 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>조퇴</button>
                      </div>

                      <div className="flex items-center justify-between min-h-[24px]">
                        <div className="flex items-center gap-2">
                          { (isPresent || isLate) && (
                             <span className={`text-[10px] font-black ${isLate ? 'text-amber-500' : 'text-emerald-600'}`}>{timeInStr} {isLate ? '지각' : '출석'}</span>
                          )}
                          { isEarlyLeave && (
                             <span className="text-[10px] font-black text-indigo-500">{timeOutStr} 조퇴</span>
                          )}
                        </div>

                        <div className="flex items-center">
                           {(isPresent || isLate) && !student.checkOut && (
                              <button onClick={() => handleAttAction(student, 'ENDED')} className="px-3 py-1 bg-slate-700 text-white text-[10px] font-extrabold rounded-md shadow-sm hover:bg-slate-900 transition-colors">종료</button>
                           )}
                           {student.checkOut && !isEarlyLeave && (
                              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded-md font-extrabold border border-slate-200">종료됨 {timeOutStr}</span>
                           )}
                        </div>
                      </div>

                    </div>
                  );
                })
              }
            </div>
          </div>

        </section>
      </div>

      {/* 🌟 우측 사이드바: 캘린더 및 일정 영역 추가 */}
      <aside className="hidden 2xl:flex w-[300px] shrink-0 border-l border-slate-200 bg-white flex-col h-full shadow-sm z-10">
        
        {/* 🌟 [추가됨] 상단 플로팅 프로필 영역 공간 확보 및 대시보드 블록 상단 라인 정렬 (96px 여백) */}
        <div className="h-[96px] shrink-0 bg-slate-50 border-b border-slate-200 w-full"></div>

        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white">
          <h2 className="text-sm font-black text-slate-800 tracking-tighter">{calendarMonth.getFullYear()}년 {calendarMonth.getMonth() + 1}월</h2>
          <div className="flex items-center gap-1.5">
            <button onClick={fetchGoogleEvents} className="w-6 h-6 flex items-center justify-center bg-blue-50 hover:bg-blue-100 transition-colors rounded text-blue-600 font-bold border border-blue-200" title="구글 캘린더 동기화">🔄</button>
            <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="w-5 h-5 flex items-center justify-center bg-slate-50 rounded text-slate-500 font-bold border border-slate-200">◀</button>
            <button onClick={() => {setCalendarMonth(new Date()); setSelectedDate(null);}} className="px-1.5 py-0.5 border border-slate-300 rounded text-[9px] font-bold text-slate-600 bg-white">오늘</button>
            <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="w-5 h-5 flex items-center justify-center bg-slate-50 rounded text-slate-500 font-bold border border-slate-200">▶</button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-y-1 bg-white p-3 border-b border-slate-100">
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
            <div key={d} className={`text-center text-[10px] font-bold mb-1 ${i === 0 ? 'text-rose-500' : 'text-slate-400'}`}>{d}</div>
          ))}
          {/* 달력 렌더링 로직 (점, Bar 표시) */}
          {(() => {
            const year = calendarMonth.getFullYear();
            const month = calendarMonth.getMonth();
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const days = [];
            
            const getMeetingTypeTheme = (type: string) => {
              if (type === '주간 회의') return { dot: 'bg-blue-500' };
              if (type === '임시 회의') return { dot: 'bg-amber-500' };
              if (type === '상담/면담') return { dot: 'bg-emerald-500' };
              if (type === '외부 일정') return { dot: 'bg-purple-500' };
              return { dot: 'bg-slate-500' };
            };

            for (let i = 0; i < firstDay; i++) days.push(<div key={`empty-${i}`} className="text-center py-0.5"></div>);
            
            for (let i = 1; i <= daysInMonth; i++) {
              const currentDate = new Date(year, month, i);
              const isToday = new Date().getDate() === i && new Date().getMonth() === month && new Date().getFullYear() === year;
              const isSelected = selectedDate && selectedDate.getDate() === i && selectedDate.getMonth() === month && selectedDate.getFullYear() === year;
              
              const dayEvents = allCombinedAgendas.filter(a => {
                if (a.isMultiDay) {
                  const s = new Date(a.meeting_date); s.setHours(0,0,0,0);
                  const e = new Date(a.end_date); e.setHours(0,0,0,0);
                  return currentDate.getTime() >= s.getTime() && currentDate.getTime() <= e.getTime();
                } else {
                  const d = a.meeting_date ? new Date(a.meeting_date) : new Date(a.created_at);
                  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === i;
                }
              });

              const dotEvents = dayEvents.filter(a => {
                if (a.isMultiDay) return false;
                if (a.isExternal) return true; 
                return a.source === 'Meeting' && ['주간 회의', '임시 회의', '상담/면담'].includes(a.type);
              });
              const dayTypes = Array.from(new Set(dotEvents.map(a => a.type)));
              
              const multiDayEvents = dayEvents.filter(a => a.isMultiDay);
              let multiDayBg = null;
              
              if (multiDayEvents.length > 0) {
                const ev = multiDayEvents[0];
                const s = new Date(ev.meeting_date); s.setHours(0,0,0,0);
                const e = new Date(ev.end_date); e.setHours(0,0,0,0);
                
                let positionClasses = "left-[-8px] right-[-8px]"; 
                if (currentDate.getTime() === s.getTime() && currentDate.getTime() === e.getTime()) {
                   positionClasses = "left-1 right-1 rounded-lg";
                } else if (currentDate.getTime() === s.getTime()) {
                   positionClasses = "left-1 right-[-8px] rounded-l-full"; 
                } else if (currentDate.getTime() === e.getTime()) {
                   positionClasses = "left-[-8px] right-1 rounded-r-full"; 
                }
                
                multiDayBg = <div className={`absolute top-1/2 -translate-y-1/2 h-6 bg-purple-100 -z-10 ${positionClasses}`}></div>;
              }

              days.push(
                <div key={i} onClick={() => setSelectedDate(isSelected ? null : new Date(year, month, i))} className="text-center py-1.5 flex flex-col items-center justify-center relative cursor-pointer hover:bg-slate-100 rounded-lg transition-colors z-0">
                  {multiDayBg}
                  <span className={`text-[12px] w-6 h-6 flex items-center justify-center rounded-full transition-colors relative z-10 ${isSelected ? 'bg-rose-500 text-white font-black shadow-md' : (isToday ? 'bg-[#002864] text-white font-bold shadow-sm' : 'text-slate-700 font-medium')}`}>
                    {i}
                  </span>
                  {dayTypes.length > 0 && (
                    <div className="absolute bottom-0 flex gap-[2px] z-10">
                      {dayTypes.map((type, idx) => (
                        <span key={idx} className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white' : getMeetingTypeTheme(type as string).dot}`}></span>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return days;
          })()}
        </div>

        <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-black text-[12px] text-slate-700">{selectedDate ? '선택한 날짜의 일정' : '다가오는 전체 일정'}</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scroll pr-1 space-y-2">
            {(() => {
              let displayItems = selectedDate 
                ? allCombinedAgendas.filter(a => {
                    if (a.isMultiDay) {
                      const s = new Date(a.meeting_date); s.setHours(0,0,0,0);
                      const e = new Date(a.end_date); e.setHours(0,0,0,0);
                      const curr = new Date(selectedDate); curr.setHours(0,0,0,0);
                      return curr.getTime() >= s.getTime() && curr.getTime() <= e.getTime();
                    } else {
                      const d = a.meeting_date ? new Date(a.meeting_date) : new Date(a.created_at);
                      return d.toDateString() === selectedDate.toDateString();
                    }
                  })
                : allCombinedAgendas.filter(a => {
                    const d = a.isMultiDay ? new Date(a.end_date) : (a.meeting_date ? new Date(a.meeting_date) : new Date(a.created_at));
                    const today = new Date(); today.setHours(0, 0, 0, 0); 
                    return d.getTime() >= today.getTime();
                  });

              displayItems.sort((a,b) => {
                const d1 = a.meeting_date ? new Date(a.meeting_date).getTime() : new Date(a.created_at).getTime();
                const d2 = b.meeting_date ? new Date(b.meeting_date).getTime() : new Date(b.created_at).getTime();
                return d1 - d2;
              });

              if (!selectedDate) {
                displayItems = displayItems.slice(0, 10); 
              }

              if (displayItems.length === 0) {
                return (
                  <div className="bg-white p-6 rounded-xl border border-slate-200 text-center shadow-sm">
                    <span className="text-[11px] font-bold text-slate-400">일정이 없습니다.</span>
                  </div>
                );
              }

              const getThemeColor = (type: string, title: string) => {
                if (type === '긴급' || (title && title.includes('긴급')) || type === 'CS') return { bg: 'bg-rose-100', text: 'text-rose-600', icon: '🚨', border: 'border-rose-200' };
                if (type === '일반' || type === '비품') return { bg: 'bg-blue-100', text: 'text-blue-600', icon: '📝', border: 'border-blue-200' };
                if (type === '기타') return { bg: 'bg-emerald-100', text: 'text-emerald-600', icon: '📌', border: 'border-emerald-200' };
                return { bg: 'bg-slate-100', text: 'text-slate-600', icon: '📄', border: 'border-slate-200' }; 
              };

              return displayItems.map(item => {
                const isGoogleEvent = item.isExternal;
                const isMeetingNote = item.source === 'Meeting' && !isGoogleEvent;
                
                let theme;
                if (isGoogleEvent) theme = { bg: 'bg-purple-50', text: 'text-purple-600', icon: '📆', border: 'border-purple-200' };
                else if (isMeetingNote) theme = { bg: 'bg-[#002864]', text: 'text-white', icon: '📁', border: 'border-blue-900' };
                else theme = getThemeColor(item.type, item.title);
                
                const itemDate = item.meeting_date ? new Date(item.meeting_date) : new Date(item.created_at);

                let badgeText = item.type;
                if (isGoogleEvent) badgeText = '구글 일정';
                else if (isMeetingNote) badgeText = '회의록';
                
                let badgeStyle = `${theme.bg} border-transparent ${theme.text}`;
                if (isMeetingNote) badgeStyle = 'bg-slate-100 border-slate-300 text-slate-600';
                if (isGoogleEvent) badgeStyle = 'bg-purple-100 border-purple-300 text-purple-700';

                let dateDisplay = `${itemDate.getMonth()+1}/${itemDate.getDate()} ${itemDate.getHours()}:${String(itemDate.getMinutes()).padStart(2,'0')}`;
                if (item.isMultiDay && item.end_date) {
                  const eDate = new Date(item.end_date);
                  dateDisplay = `${itemDate.getMonth()+1}/${itemDate.getDate()} ~ ${eDate.getMonth()+1}/${eDate.getDate()}`;
                }

                return (
                  <div 
                    key={item.id} 
                    onClick={() => {
                      if(isMeetingNote || isGoogleEvent) router.push('/minutes');
                    }}
                    className={`bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-1.5 transition-colors ${isMeetingNote || isGoogleEvent ? 'cursor-pointer hover:border-blue-300 hover:bg-slate-50' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-sm ${theme.bg} ${theme.text} ${theme.border}`}>
                        {theme.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          {item.is_secret && <span className="text-[9px]">🔒</span>}
                          <h4 className="text-[12px] font-black text-slate-800 truncate">{item.title}</h4>
                        </div>
                        <p className="text-[10px] font-medium text-slate-500 truncate">
                          {item.is_secret ? "비밀 안건 (보호됨)" : (item.content ? item.content.replace(/<[^>]+>/g, ' ').trim() : '내용 없음')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pl-9">
                      <span className={`px-1.5 py-0.5 text-[8px] font-black rounded border ${badgeStyle}`}>
                        {badgeText}
                      </span>
                      <span className="text-[9px] font-bold text-slate-400">
                        {dateDisplay}
                      </span>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </aside>

      {/* 수동 설정 모달 */}
      {manualModalData && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white p-6 rounded-2xl w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-black text-slate-800 mb-5 border-b border-slate-100 pb-3 flex items-center gap-2">⚙️ 수동 출결 설정 <span className="text-sm font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded ml-auto">{manualModalData.name}</span></h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-slate-500 mb-1.5">출석 상태</label>
                <select value={manualForm.status} onChange={e => setManualForm({...manualForm, status: e.target.value})} className="border border-slate-300 p-2.5 w-full rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-[#002864] bg-slate-50">
                  <option value="출석">✅ 출석</option>
                  <option value="결석">❌ 결석</option>
                  <option value="지각">⏰ 지각</option>
                  <option value="조퇴">🏃 조퇴</option>
                  <option value="NONE">🗑️ 미처리 (초기화)</option>
                </select>
              </div>

              {manualForm.status !== "NONE" && manualForm.status !== "결석" && (
                <div>
                  <label className="block text-xs font-extrabold text-slate-500 mb-1.5">출석(시작) 시간</label>
                  <input type="time" value={manualForm.checkIn} onChange={e => setManualForm({...manualForm, checkIn: e.target.value})} className="border border-slate-300 p-2 w-full rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-[#002864]" />
                </div>
              )}

              {manualForm.status !== "NONE" && manualForm.status !== "결석" && (
                <div>
                  <label className="block text-xs font-extrabold text-slate-500 mb-1.5">조퇴/종료 시간</label>
                  <input type="time" value={manualForm.checkOut} onChange={e => setManualForm({...manualForm, checkOut: e.target.value})} className="border border-slate-300 p-2 w-full rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-[#002864]" />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-8">
              <button onClick={() => setManualModalData(null)} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-sm transition-colors">취소</button>
              <button onClick={handleManualSave} className="px-5 py-2.5 bg-[#002864] hover:bg-blue-900 text-white font-bold rounded-xl text-sm shadow-md transition-colors">저장하기</button>
            </div>
          </div>
        </div>
      )}

      <MemoModal 
        isOpen={isMemoModalOpen} 
        currentUser={currentUser} 
        onClose={() => setIsMemoModalOpen(false)} 
        onSuccess={fetchMemos} 
      />

    </div>
  );
}