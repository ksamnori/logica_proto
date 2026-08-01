// src/app/(dashboard)/home/page.tsx
"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// 분리된 모달 컴포넌트
import MemoModal from "@/components/home/MemoModal";

export default function TeacherDashboardPage() {
  const router = useRouter();

  // === 기본 데이터 및 인증 상태 ===
  const [currentUser, setCurrentUser] = useState({ instId: "", name: "" });
  const [myClasses, setMyClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("all");

  // === 패널별 상태 ===
  const [students, setStudents] = useState<any[]>([]);
  const [classStats, setClassStats] = useState({ avgScore: 0, hwRate: 0, bookName: "-", bookProgress: 0 });
  const [todoStats, setTodoStats] = useState({ grading: 0, clinic: 0 });
  
  const [csRequests, setCsRequests] = useState<any[]>([]);
  const [memos, setMemos] = useState<any[]>([]);

  // === 출결 관리 상태 ===
  const [attStudents, setAttStudents] = useState<any[]>([]);
  const [activeAttMenu, setActiveAttMenu] = useState<string | null>(null);

  // === 업무 공유 모달 상태 ===
  const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);

  useEffect(() => {
    const instId = localStorage.getItem("logica_instructor_id") || "1";
    const name = localStorage.getItem("logica_instructor_name") || "선생님";
    setCurrentUser({ instId, name });

    loadDashboardData(instId);
    
    // 바탕 클릭 시 출결 드롭다운 닫기
    const closeMenu = () => setActiveAttMenu(null);
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, []);

  useEffect(() => {
    if (myClasses.length > 0 && selectedClassId !== "all") {
      fetchClassDetails(selectedClassId);
      fetchAttendance(selectedClassId);
    }
  }, [selectedClassId]);

  // ==========================================
  // 데이터 로딩 
  // ==========================================
  const loadDashboardData = async (instId: string) => {
    // 1. 내 담당 반 가져오기
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

    // 2. 미처리 학부모 요청 (CS)
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

    // 3. 업무 공유 보드 (Memos)
    fetchMemos();

    // 4. 오늘의 할일 (가상 카운팅)
    setTodoStats({ grading: Math.floor(Math.random() * 5) + 1, clinic: Math.floor(Math.random() * 3) });
  };

  const fetchMemos = async () => {
    const { data: memoData } = await supabase.from("instructor_memo")
      .select("*").neq("status", "완료").order("created_at", { ascending: false }).limit(20);
    setMemos(memoData || []);
  };

  // 💡 [버그 픽스] UUID 하이픈 충돌을 막기 위한 안전한 배열 통합 쿼리 적용
  const fetchClassDetails = async (classId: string) => {
    // 1. 해당 반에 배정된(enrollment) 학생과 직접 소속된(student.class_id) 학생의 ID를 모두 수집합니다.
    const [ { data: enrollData }, { data: directData } ] = await Promise.all([
      supabase.from("enrollment").select("student_id").eq("class_id", classId),
      supabase.from("student").select("student_id").eq("class_id", classId)
    ]);

    const enrollIds = enrollData?.map((e: any) => e.student_id) || [];
    const directIds = directData?.map((s: any) => s.student_id) || [];
    
    // 2. 중복을 제거하여 최종 조회할 타겟 ID 배열을 만듭니다.
    const allTargetIds = Array.from(new Set([...enrollIds, ...directIds]));

    // 반에 배정된 학생이 아예 없으면 즉시 빈 데이터 반환
    if (allTargetIds.length === 0) {
      setStudents([]);
      setClassStats({ avgScore: 0, hwRate: 0, bookName: "주교재 미배정", bookProgress: 0 });
      return;
    }

    // 3. 구문 에러가 나지 않도록 배열(allTargetIds)을 그대로 .in() 조건에 주입합니다.
    const { data: classStudents } = await supabase
      .from("student")
      .select("*, parent(*), exam_assignment(*), enrollment(class(name))")
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

  // ==========================================
  // 출결 관리 (Attendance)
  // ==========================================
  const fetchAttendance = async (classId: string) => {
    const today = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0]; // KST

    // 💡 [버그 픽스] 출결 조회 시에도 동일하게 안전한 ID 배열 통합 쿼리 적용
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
      let status = "NONE";
      let time = null;

      if (todayAtt) {
        if (todayAtt.check_out_time) status = "ENDED";
        else if (todayAtt.status === "출석") status = "PRESENT";
        else if (todayAtt.status === "결석") status = "ABSENT";
        else if (todayAtt.status === "지각") status = "LATE";
        else if (todayAtt.status === "조퇴") status = "EARLY_LEAVE";

        if (todayAtt.check_in_time) {
          time = new Date(todayAtt.check_in_time).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" });
        }
      }

      return { id: st.student_id, name: st.name, att_id: todayAtt?.attendance_id, status, time };
    });

    setAttStudents(mappedAtt.sort((a: any, b: any) => a.name.localeCompare(b.name)));
  };

  const attSummary = useMemo(() => {
    let total = 0, present = 0, earlyLeave = 0, absent = 0;
    attStudents.forEach(st => {
      total++;
      if (st.status === "ABSENT") absent++;
      else if (st.status === "EARLY_LEAVE") earlyLeave++;
      else if (["PRESENT", "LATE", "ENDED"].includes(st.status)) present++;
    });
    return { total, present, leave: earlyLeave, absent };
  }, [attStudents]);

  const updateAttendance = async (studentId: string, attId: string | null, newStatus: string) => {
    const today = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];
    const nowTimestamp = new Date().toISOString();
    
    let dbStatus = "출석";
    if (newStatus === "ABSENT") dbStatus = "결석";
    if (newStatus === "LATE") dbStatus = "지각";
    if (newStatus === "EARLY_LEAVE") dbStatus = "조퇴";
    if (newStatus === "NONE") dbStatus = "미처리";

    try {
      if (attId && newStatus === "ENDED") {
        await supabase.from("attendance").update({ check_out_time: nowTimestamp }).eq("attendance_id", attId);
      } else if (attId) {
        if (newStatus === "NONE") await supabase.from("attendance").delete().eq("attendance_id", attId);
        else await supabase.from("attendance").update({ status: dbStatus }).eq("attendance_id", attId);
      } else if (newStatus !== "NONE") {
        const { data: fallback } = await supabase.from("enrollment").select("enrollment_id").eq("student_id", studentId).eq("class_id", selectedClassId).maybeSingle();
        await supabase.from("attendance").insert({
          student_id: studentId, class_id: selectedClassId, enrollment_id: fallback?.enrollment_id || null, attendance_date: today, status: dbStatus
        });
      }
    } catch (e) { console.error(e); } finally {
      fetchAttendance(selectedClassId);
    }
  };

  const bulkAttend = async () => {
    if (!confirm('현재 리스트에 있는 미처리된 모든 학생을 "출석" 처리하시겠습니까?')) return;
    const toUpdate = attStudents.filter(s => s.status === "NONE");
    for (const s of toUpdate) await updateAttendance(s.id, s.att_id, "PRESENT");
  };

  const bulkEnd = async () => {
    if (!confirm('현재 리스트에 있는 출석/지각 학생을 모두 "수업 종료" 처리하시겠습니까?')) return;
    const toUpdate = attStudents.filter(s => ["PRESENT", "LATE"].includes(s.status));
    for (const s of toUpdate) await updateAttendance(s.id, s.att_id, "ENDED");
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

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-y-auto custom-scroll p-4 sm:p-8 gap-6 relative">
      
      <section className="flex justify-between items-end shrink-0">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 mb-3 flex items-center gap-2">👨‍🏫 내 담당 클래스</h1>
          <div className="flex gap-3 flex-wrap">
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
                    className={`px-5 py-2.5 rounded-xl border-2 shadow-sm flex flex-col items-start transition-all text-left min-w-[140px] ${isActive ? "bg-[#002864] text-white border-[#002864]" : "bg-white text-slate-500 border-transparent hover:border-slate-400 hover:text-slate-700"}`}
                  >
                    <span className="text-sm font-extrabold tracking-tight leading-tight">{c.name}</span>
                    <span className="text-[10px] mt-1 font-medium opacity-80 leading-none tracking-tight whitespace-nowrap">{scheduleStr}</span>
                  </button>
                );
              })
            }
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        
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
          <span className="text-sm font-bold text-slate-500 mb-4 shrink-0">🔥 오늘의 할 일</span>
          <div className="flex flex-col gap-3">
            <div onClick={() => router.push('/homework')} className="flex justify-between items-center bg-indigo-50 p-4 rounded-xl border border-indigo-100 cursor-pointer hover:bg-indigo-100 transition-colors">
              <span className="text-xs font-bold text-indigo-600">✍️ 서술형 채점 대기</span>
              <span className="text-base font-black text-indigo-700">{todoStats.grading}건</span>
            </div>
            <div onClick={() => router.push('/makeup')} className="flex justify-between items-center bg-amber-50 p-4 rounded-xl border border-amber-100 cursor-pointer hover:bg-amber-100 transition-colors">
              <span className="text-xs font-bold text-amber-600">🩺 오늘 보강/클리닉</span>
              <span className="text-base font-black text-amber-700">{todoStats.clinic}명</span>
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
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead className="bg-white sticky top-0 shadow-sm z-10">
                <tr>
                  <th className="py-3 px-4 text-[11px] font-extrabold text-slate-400 uppercase tracking-wider">이름</th>
                  <th className="py-3 px-3 text-[11px] font-extrabold text-slate-400 uppercase tracking-wider">수강중 반 목록</th>
                  <th className="py-3 px-3 text-[11px] font-extrabold text-slate-400 uppercase tracking-wider text-center">학교</th>
                  <th className="py-3 px-3 text-[11px] font-extrabold text-slate-400 uppercase tracking-wider text-center">학년</th>
                  <th className="py-3 px-3 text-[11px] font-extrabold text-slate-400 uppercase tracking-wider text-center">학생 연락처</th>
                  <th className="py-3 px-3 text-[11px] font-extrabold text-slate-400 uppercase tracking-wider text-center">학부모 연락처</th>
                  <th className="py-3 px-3 text-[11px] font-extrabold text-slate-400 uppercase tracking-wider text-center">최근 성적</th>
                  <th className="py-3 px-4 text-[11px] font-extrabold text-slate-400 uppercase tracking-wider text-right">관리</th>
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

                    let scoreHtml = <span className="text-xs font-bold text-slate-400">미응시</span>;
                    if (s.exam_assignment?.length > 0 && s.exam_assignment[0].total_score !== null) {
                      const score = s.exam_assignment[0].total_score;
                      if (score < 70) scoreHtml = <><span className="text-[11px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">미달</span> <span className="font-extrabold text-rose-600 ml-1">{score}점</span></>;
                      else scoreHtml = <><span className="text-[11px] font-bold text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded">완료</span> <span className="font-extrabold text-slate-700 ml-1">{score}점</span></>;
                    }

                    return (
                      <tr key={s.student_id} className="hover:bg-blue-50/40 transition-colors border-b border-slate-100">
                        <td className="py-3 px-4">
                          <div 
                            className="flex items-center gap-3 cursor-pointer group w-max"
                            onClick={() => window.open(`/student/${s.student_id}`, '_blank')}
                          >
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-[#002864] flex items-center justify-center text-xs font-black shrink-0 transition-colors group-hover:bg-[#002864] group-hover:text-white">
                              {s.name.substring(1)}
                            </div>
                            <span className="text-sm font-bold text-slate-800 group-hover:text-blue-600 group-hover:underline whitespace-nowrap transition-colors">
                              {s.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-[12px] font-bold text-slate-600 truncate max-w-[120px]" title={classNames}>{classNames}</td>
                        <td className="py-3 px-3 text-center text-[12px] font-medium text-slate-500 truncate max-w-[80px]" title={schoolName}>{schoolName}</td>
                        <td className="py-3 px-3 text-center text-[12px] font-bold text-slate-600 whitespace-nowrap">{gradeText}</td>
                        <td className="py-3 px-3 text-center text-[12px] font-medium text-slate-500 whitespace-nowrap">{studentContact}</td>
                        <td className="py-3 px-3 text-center text-[12px] font-medium text-slate-500 whitespace-nowrap">{parentContact}</td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">{scoreHtml}</td>
                        <td className="py-3 px-4 text-right">
                          <button className="text-[11px] font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors shadow-sm whitespace-nowrap">리포트</button>
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
            <div className="flex flex-col items-center py-2"><span className="text-xs font-black text-blue-600">{attSummary.present}</span><span className="text-[9px] font-bold text-slate-400 mt-0.5">출석</span></div>
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
                let btnHtml = <></>;
                if (student.status === 'NONE') {
                  btnHtml = (
                    <>
                      <button onClick={() => updateAttendance(student.id, student.att_id, 'ABSENT')} className="px-2 py-1 border border-rose-300 text-rose-500 text-[10px] font-bold rounded hover:bg-rose-50 transition-colors">결석</button>
                      <button onClick={() => updateAttendance(student.id, student.att_id, 'PRESENT')} className="px-2 py-1 border border-[#002864] text-[#002864] text-[10px] font-bold rounded hover:bg-blue-50 transition-colors ml-1">출석</button>
                    </>
                  );
                } else if (['PRESENT', 'LATE'].includes(student.status)) {
                  const timeColor = student.status === 'LATE' ? 'text-orange-500' : 'text-[#002864]';
                  btnHtml = (
                    <>
                      <span className={`text-[10px] font-bold mr-2 ${timeColor}`}>{student.time} {student.status === 'LATE' ? '지각' : '출석'}</span>
                      <button onClick={() => updateAttendance(student.id, student.att_id, 'ENDED')} className="px-2 py-1 border border-slate-700 text-slate-700 text-[10px] font-bold rounded hover:bg-slate-100 transition-colors">종료</button>
                    </>
                  );
                } else if (student.status === 'ENDED') {
                  btnHtml = <span className="text-[10px] font-bold text-slate-500 px-2 py-1 bg-slate-100 rounded">수업종료</span>;
                } else if (student.status === 'ABSENT') {
                  btnHtml = <span className="text-[10px] font-bold text-rose-500 px-2 py-1 bg-rose-50 border border-rose-200 rounded">결석처리</span>;
                } else if (student.status === 'EARLY_LEAVE') {
                  btnHtml = <span className="text-[10px] font-bold text-indigo-500 px-2 py-1 bg-indigo-50 border border-indigo-200 rounded">{student.time} 조퇴</span>;
                }

                const isMenuOpen = activeAttMenu === student.id;

                return (
                  <div key={student.id} className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-center justify-between text-xs shadow-sm hover:border-slate-300 transition-colors relative">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                      </div>
                      <span className="font-bold text-slate-800">{student.name}</span>
                    </div>
                    <div className="flex items-center">
                      {btnHtml}
                      <div className="relative inline-block ml-1">
                        <button onClick={(e) => { e.stopPropagation(); setActiveAttMenu(isMenuOpen ? null : student.id); }} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                        </button>
                        {isMenuOpen && (
                          <div className="absolute right-0 top-6 w-24 bg-white shadow-xl rounded-xl border border-slate-200 z-50 py-1">
                            <button onClick={() => updateAttendance(student.id, student.att_id, 'LATE')} className="w-full text-left px-3 py-2 text-[10px] font-bold text-slate-700 hover:bg-slate-50">지각 처리</button>
                            <button onClick={() => updateAttendance(student.id, student.att_id, 'EARLY_LEAVE')} className="w-full text-left px-3 py-2 text-[10px] font-bold text-slate-700 hover:bg-slate-50">조퇴 처리</button>
                            <hr className="border-slate-100 my-0.5" />
                            <button onClick={() => updateAttendance(student.id, student.att_id, 'NONE')} className="w-full text-left px-3 py-2 text-[10px] font-bold text-slate-400 hover:bg-slate-50">초기화</button>
                          </div>
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

      <MemoModal 
        isOpen={isMemoModalOpen} 
        currentUser={currentUser} 
        onClose={() => setIsMemoModalOpen(false)} 
        onSuccess={fetchMemos} 
      />

    </div>
  );
}