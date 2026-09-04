// src/app/(dashboard)/student/[id]/page.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

import StudentEditModal from "@/components/student/StudentEditModal";
import ConsultModal from "@/components/student/ConsultModal";
import { BillingModal, PaymentModal } from "@/components/student/BillingModals";

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
    return [];
  }
  return [];
};

const getTodayKST = () => {
  const d = new Date();
  d.setHours(d.getHours() + 9);
  return d.toISOString().split('T')[0];
};

export default function StudentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.id as string;

  const [currentUser, setCurrentUser] = useState({ instId: "", name: "", isAdmin: false });

  const [activeTab, setActiveTab] = useState<string>("info");
  
  const [isNotFound, setIsNotFound] = useState(false);

  const [student, setStudent] = useState<any>(null);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [allClasses, setAllClasses] = useState<any[]>([]);
  
  const [consultLogs, setConsultLogs] = useState<any[]>([]);
  const [attendances, setAttendances] = useState<any[]>([]);
  const [progressBooks, setProgressBooks] = useState<any[]>([]);
  const [examResults, setExamResults] = useState<any[]>([]);
  const [hwList, setHwList] = useState<any[]>([]);
  const [clinicList, setClinicList] = useState<any[]>([]);
  const [billingList, setBillingList] = useState<any[]>([]);
  const [schoolExams, setSchoolExams] = useState<any[]>([]);

  // Modals
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isConsultModalOpen, setIsConsultModalOpen] = useState(false);
  const [isBillingModalOpen, setIsBillingModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isReEnrollModalOpen, setIsReEnrollModalOpen] = useState(false);
  const [isSchoolExamModalOpen, setIsSchoolExamModalOpen] = useState(false);

  const [selectedConsultLog, setSelectedConsultLog] = useState<any>(null);
  const [payFormInit, setPayFormInit] = useState<any>(null);
  
  const [reEnrollForm, setReEnrollForm] = useState({ classId: "", startDate: getTodayKST() });
  const [schoolExamForm, setSchoolExamForm] = useState({ year: new Date().getFullYear(), semester: 1, examType: "중간고사", subject: "수학", score: "" });
  const [isSavingSchoolExam, setIsSavingSchoolExam] = useState(false);
  const [isSubmittingReEnroll, setIsSubmittingReEnroll] = useState(false);

  // Calendar & Attendance Form
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  
  const [selectedDate, setSelectedDate] = useState<string | null>(getTodayKST());
  const [attendForm, setAttendForm] = useState({ id: "", status: "출석", checkIn: "", checkOut: "", remark: "" });

  const [allowedActions, setAllowedActions] = useState<string[]>([]);

  const loadPermissions = async () => {
    const role = localStorage.getItem("logica_instructor_role") || "TEACHER";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    const tId = localStorage.getItem("logica_tenant_id");

    const isSA = role === 'SUPER_ADMIN' || pos.includes('최고관리자');
    const isPrin = role === 'ADMIN' || pos.includes('원장');

    if (isSA || isPrin) {
      setAllowedActions(["action_view_consult", "action_view_exam", "action_view_clinic", "action_edit_attend"]);
      return;
    }

    if (tId) {
      const { data } = await supabase.from('tenant_role_permissions').select('allowed_menus').eq('tenant_id', tId).eq('role_name', role).maybeSingle();
      if (data && data.allowed_menus) setAllowedActions(data.allowed_menus);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const instId = localStorage.getItem("logica_instructor_id") || "";
      const name = localStorage.getItem("logica_instructor_name") || "시스템";
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const isAdmin = ["ADMIN", "MANAGER", "PRINCIPAL"].includes(role.toUpperCase()) || pos.includes("원장") || pos.includes("실장");
      setCurrentUser({ instId, name, isAdmin });
    }
    if (studentId) {
      loadPermissions(); 
      loadInitialData();
      loadClasses();
    }
  }, [studentId]);

  useEffect(() => {
    if (studentId && student) {
      loadConsultLogs();
      loadAttendance();
    }
  }, [studentId, student, calYear, calMonth]);

  useEffect(() => {
    if (activeTab === "billing") loadBillings();
    if (activeTab === "exam") {
      loadExamResults();
      loadSchoolExams(); 
    }
    if (activeTab === "hw") loadHwList();
    if (activeTab === "clinic") loadClinicList();
  }, [activeTab]);

  useEffect(() => {
    if (selectedDate) {
      const record = attendances.find(a => a.attendance_date === selectedDate);
      if (record) {
        setAttendForm({ 
          id: record.attendance_id, 
          status: record.status || "출석", 
          checkIn: formatTimeForInput(record.check_in_time), 
          checkOut: formatTimeForInput(record.check_out_time), 
          remark: record.remark || "" 
        });
      } else {
        setAttendForm({ id: "", status: "출석", checkIn: "", checkOut: "", remark: "" });
      }
    }
  }, [selectedDate, attendances]);

  const loadInitialData = async () => {
    try {
      const { data: stuData, error } = await supabase.from("student").select("*, parent(*)").eq("student_id", studentId).maybeSingle();
      
      if (error) console.error("데이터 로딩 오류:", error);

      if (!stuData) {
        setIsNotFound(true);
        return;
      }

      setStudent(stuData);

      const { data: enrollData } = await supabase.from("enrollment")
        .select("enrollment_id, class_id, start_date, end_date, status, class(name)")
        .eq("student_id", studentId).order("start_date", { ascending: false });
      
      setEnrollments(enrollData || []);
      if (enrollData && enrollData.length > 0) {
        loadProgressData(enrollData.map(e => e.class_id));
      }
    } catch (error) { console.error("로딩 에러:", error); }
  };

  const loadClasses = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    
    let query = supabase.from("class")
      .select("class_id, code, name, level_name, instructor(name)")
      .neq("status", "종료")
      .neq("status", "폐강");
      
    if (tId) query = query.eq("tenant_id", tId);
    const { data } = await query.order("name");
    setAllClasses(data || []);
  };

  const loadConsultLogs = async () => {
    const { data: regularLogs } = await supabase.from("consultation_log").select("*, instructor(name)").eq("student_id", studentId).order("created_at", { ascending: false }).limit(200);
    const { data: admissionLogs } = await supabase.from("admission_application").select("application_id, counseling_memo, test_result, created_at, admission_session(title)").eq("student_id", studentId).not("counseling_memo", "is", null);

    const formattedAdmissionLogs = (admissionLogs || []).filter((app: any) => app.counseling_memo && app.counseling_memo.trim() !== "").map((app: any) => ({
      log_id: `admission_${app.application_id}`,
      consultation_type: "입학 상담",
      contact_method: "방문/테스트",
      content: `[결과: ${app.test_result}]\n${app.counseling_memo}`,
      created_at: app.created_at,
      instructor: { name: "입학 담당" },
      is_admission: true
    }));

    const combinedLogs = [...(regularLogs || []), ...formattedAdmissionLogs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setConsultLogs(combinedLogs);
  };

  const loadAttendance = async () => {
    const prevStartDate = new Date(calYear, calMonth - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(calYear, calMonth + 1, 0).toISOString().split('T')[0];
    const { data } = await supabase.from("attendance").select("*").eq("student_id", studentId).gte("attendance_date", prevStartDate).lte("attendance_date", endDate);
    setAttendances(data || []);
  };

  const loadProgressData = async (classIds: string[]) => {
    if (classIds.length === 0) return;
    const { data: cbData } = await supabase.from('class_textbook').select('*, textbook(*), class(name)').in('class_id', classIds);
    if (!cbData || cbData.length === 0) return;

    const bookIds = cbData.map((cb: any) => cb.book_id);
    const { data: qData } = await supabase.from('textbook_question').select('tq_id, book_id, page_number').in('book_id', bookIds);
    const { data: assignments } = await supabase.from('homework_assignment').select('homework_id, book_id, target_questions, target_student_id, class_id').in('book_id', bookIds).in('class_id', classIds);
    const { data: results } = await supabase.from('student_homework_result').select('homework_id, status, completed_tq_ids').eq('student_id', studentId);

    const resultMap = new Map(results?.map(r => [r.homework_id, r]));
    const statusMap: Record<string, 'done' | 'homework'> = {}; 
    
    assignments?.forEach(hw => {
       const isTarget = !hw.target_student_id || hw.target_student_id === studentId;
       if (!isTarget) return;
       const res = resultMap.get(hw.homework_id);
       const targetQs = safeParseIds(hw.target_questions);
       const completedQs = res ? safeParseIds(res.completed_tq_ids) : [];

       targetQs.forEach(tq => { if (!statusMap[tq]) statusMap[tq] = 'homework'; });
       completedQs.forEach(tq => { statusMap[tq] = 'done'; });
    });

    const books = cbData.map(cb => {
       const bQs = qData?.filter(q => q.book_id === cb.book_id) || [];
       const pageMap: Record<number, number[]> = {};
       bQs.forEach(q => {
          if(!pageMap[q.page_number]) pageMap[q.page_number] = [];
          pageMap[q.page_number].push(q.tq_id);
       });

       const pages = Object.keys(pageMap).map(Number).sort((a,b)=>a-b);
       const pageStatuses: Record<number, string> = {};
       let doneCount = 0;

       pages.forEach(p => {
          const tqs = pageMap[p];
          let d=0, h=0;
          tqs.forEach(tq => {
             if(statusMap[tq]==='done') d++;
             else if(statusMap[tq]==='homework') h++;
          });
          if(d === tqs.length && tqs.length > 0) { pageStatuses[p] = 'done'; doneCount++; }
          else if(d > 0 || h > 0) { pageStatuses[p] = 'homework'; }
          else { pageStatuses[p] = 'none'; }
       });

       return {
          ...cb,
          tbTitle: unwrap(cb.textbook)?.title,
          tbType: unwrap(cb.textbook)?.book_type,
          className: unwrap(cb.class)?.name,
          pages,
          pageStatuses,
          doneCount,
          percent: pages.length > 0 ? Math.round((doneCount/pages.length)*100) : 0
       };
    });

    setProgressBooks(books);
  };

  const loadExamResults = async () => {
    const { data } = await supabase.from("student_exam_result")
      .select("original_score, final_score, class_avg, submitted_at, exam_assignment(exam_master(title))")
      .eq("student_id", studentId)
      .not("final_score", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(10);
    
    setExamResults(data?.reverse() || []);
  };

  const loadHwList = async () => {
    const { data } = await supabase.from("student_homework_result")
      .select("status, completed_tq_ids, checked_at, homework_assignment(homework_title, target_questions, created_at, due_date, textbook(title, book_type))")
      .eq("student_id", studentId)
      .order("checked_at", { ascending: false });
    setHwList(data || []);
  };

  const loadClinicList = async () => {
    const { data } = await supabase.from("clinic_task")
      .select("*, textbook_question(question_number)")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });
    setClinicList(data || []);
  };

  const loadBillings = async () => {
    const { data } = await supabase.from("academy_billing").select("*, class(name)").eq("student_id", studentId).order("billing_month", { ascending: false }).limit(200);
    setBillingList(data || []);
  };

  const loadSchoolExams = async () => {
    const { data } = await supabase.from("student_school_exam").select("*").eq("student_id", studentId).order("year", { ascending: false }).order("semester", { ascending: false }).order("exam_type", { ascending: true });
    setSchoolExams(data || []);
  };

  const handleSaveSchoolExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSchoolExam(true);
    try {
      const tId = localStorage.getItem("logica_tenant_id");
      await supabase.from("student_school_exam").insert({ student_id: studentId, year: schoolExamForm.year, semester: schoolExamForm.semester, exam_type: schoolExamForm.examType, subject: schoolExamForm.subject, score: parseFloat(schoolExamForm.score), tenant_id: tId });
      alert("학교 내신 성적이 등록되었습니다.");
      setIsSchoolExamModalOpen(false);
      setSchoolExamForm({ ...schoolExamForm, score: "" }); 
      loadSchoolExams();
    } catch (error: any) { alert("저장 실패"); } finally { setIsSavingSchoolExam(false); }
  };

  const deleteSchoolExam = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await supabase.from("student_school_exam").delete().eq("id", id);
    loadSchoolExams();
  };

  const handleReEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingReEnroll(true);
    try {
      const tId = localStorage.getItem("logica_tenant_id");
      await supabase.from("student").update({ status: "재원", updated_at: new Date().toISOString() }).eq("student_id", studentId);
      await supabase.from("enrollment").insert({ student_id: studentId, class_id: reEnrollForm.classId, start_date: reEnrollForm.startDate, status: "수강중", tenant_id: tId });
      alert("재등록 처리 완료");
      setIsReEnrollModalOpen(false);
      loadInitialData(); 
    } catch (err) { alert("실패"); } finally { setIsSubmittingReEnroll(false); }
  };

  const handleEndEnrollment = async (enrollmentId: string) => {
    const endDate = prompt("수강 종료일(YYYY-MM-DD)", new Date().toISOString().split('T')[0]);
    if (!endDate) return;
    try {
      await supabase.from("enrollment").update({ end_date: endDate, status: "수강종료", updated_at: new Date().toISOString() }).eq("enrollment_id", enrollmentId);
      loadInitialData();
    } catch (err) { alert("실패"); }
  };

  const deleteConsultLog = async (logId: string) => {
    if (!confirm("이 기록을 삭제하시겠습니까?")) return;
    await supabase.from("consultation_log").delete().eq("log_id", logId);
    loadConsultLogs();
  };

  const formatTimeForInput = (isoStr: string | null | undefined) => {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const toIsoString = (timeStr: string, dateStr: string) => {
    if (!timeStr) return null;
    const [hh, mm] = timeStr.split(':');
    const d = new Date(`${dateStr}T${hh}:${mm}:00+09:00`);
    return d.toISOString();
  };

  const handleDateClick = (dateStr: string) => {
    setSelectedDate(dateStr);
  };

  const saveAttendance = async () => {
    if (!selectedDate) return;
    try {
      const { data: enrolls } = await supabase.from('enrollment').select('enrollment_id, class_id').eq('student_id', studentId).order('created_at', { ascending: false }).limit(1);
      const enrollId = enrolls?.[0]?.enrollment_id;
      const classId = enrolls?.[0]?.class_id || student?.class_id;
      if (!enrollId) return alert("수강 이력이 없습니다.");

      const payload = { 
        student_id: studentId, class_id: classId, enrollment_id: enrollId, attendance_date: selectedDate, 
        status: attendForm.status, 
        check_in_time: toIsoString(attendForm.checkIn, selectedDate),
        check_out_time: toIsoString(attendForm.checkOut, selectedDate),
        remark: attendForm.remark 
      };

      if (attendForm.id) await supabase.from('attendance').update(payload).eq('attendance_id', attendForm.id);
      else await supabase.from('attendance').insert(payload);
      
      alert("출결 기록이 저장되었습니다.");
      loadAttendance();
    } catch (e) { alert("저장 실패"); }
  };

  const deleteAttendance = async () => {
    if (!attendForm.id) return;
    if (!confirm("해당 날짜의 출결 기록을 삭제하시겠습니까?")) return;
    try {
      await supabase.from('attendance').delete().eq('attendance_id', attendForm.id);
      alert("기록이 삭제되었습니다.");
      setAttendForm({ id: "", status: "출석", checkIn: "", checkOut: "", remark: "" });
      loadAttendance();
    } catch (e) { alert("삭제 실패"); }
  };

  const deleteStudentData = async () => {
    if (!currentUser.isAdmin) {
      alert("🚫 학생의 모든 데이터를 완전히 삭제하는 기능은 원장 및 관리자만 수행할 수 있습니다.");
      return;
    }
    if (!confirm("⚠️ 경고: 학생의 기본 정보뿐만 전적, 출결, 수납 등 모든 기록이 완전히 삭제되며 절대 복구할 수 없습니다.\n\n정말 삭제하시겠습니까?")) return;
    
    try {
      await Promise.all([
        supabase.from('student_homework_result').delete().eq('student_id', studentId),
        supabase.from('student_exam_result').delete().eq('student_id', studentId),
        supabase.from('student_school_exam').delete().eq('student_id', studentId),
        supabase.from('student_incorrect_record').delete().eq('student_id', studentId),
        supabase.from('student_progress').delete().eq('student_id', studentId),
        supabase.from('admission_test_report').delete().eq('student_id', studentId),
        supabase.from('exam_assignment').delete().eq('student_id', studentId),
        supabase.from('attendance').delete().eq('student_id', studentId),
        supabase.from('consultation_log').delete().eq('student_id', studentId),
        supabase.from('academy_billing').delete().eq('student_id', studentId),
        supabase.from('enrollment').delete().eq('student_id', studentId)
      ]);
      await supabase.from('student').delete().eq('student_id', studentId);
      alert("✅ 학생 데이터가 완전히 삭제되었습니다.");
      router.back(); 
    } catch (error: any) { alert("삭제 실패: " + error.message); }
  };

  const getEnrolledClassNames = () => {
    const activeEnrolls = enrollments.filter(e => !e.end_date || e.status === '수강중');
    return activeEnrolls.length > 0 ? activeEnrolls.map(e => unwrap(e.class)?.name).join(", ") : "미배정";
  };

  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    
    let attendMap: any = {};
    attendances.forEach(a => attendMap[a.attendance_date] = a.status);

    let consultMap: any = {};
    consultLogs.forEach(c => {
      const dateStr = new Date(c.created_at).toISOString().split('T')[0];
      consultMap[dateStr] = true;
    });

    const blanks = Array.from({ length: firstDay }).map((_, i) => <div key={`blank-${i}`} className="aspect-square"></div>);
    
    const days = Array.from({ length: daysInMonth }).map((_, i) => {
      const d = i + 1;
      const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const status = attendMap[dateStr];
      const hasConsult = consultMap[dateStr];
      const isActive = dateStr === selectedDate;
      
      let dotColor = "bg-transparent";
      if (status === "출석") dotColor = "bg-[#10b981]";
      else if (status === "지각") dotColor = "bg-[#eab308]";
      else if (status === "조퇴") dotColor = "bg-[#f97316]";
      else if (status === "결석") dotColor = "bg-[#ef4444]";

      const bgClass = isActive 
        ? 'bg-[#002864] text-white border-[#002864] shadow-md' 
        : (hasConsult ? 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100' : 'bg-white border-slate-100 hover:border-slate-300 text-slate-700');

      return (
        <div key={d} onClick={() => handleDateClick(dateStr)} className={`relative aspect-square rounded-lg flex flex-col items-center justify-center font-black text-[12px] cursor-pointer transition-all border ${bgClass}`}>
          {hasConsult && (
             <span className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 border-[1.5px] border-white rounded-full shadow-sm z-10" title="상담 기록 있음"></span>
          )}
          <span className="leading-none z-0 mt-0.5">{d}</span>
          <div className={`w-1.5 h-1.5 rounded-full mt-1 ${status && status !== 'NONE' ? dotColor : 'bg-transparent'}`}></div>
        </div>
      );
    });

    return [...blanks, ...days];
  }, [calYear, calMonth, attendances, selectedDate, consultLogs]);

  const attSummary = useMemo(() => {
    let curr = { total: 0, present: 0, leave: 0, absent: 0 };
    let prev = { total: 0, present: 0, leave: 0, absent: 0 };
    
    const currStart = new Date(calYear, calMonth, 1).toISOString().split('T')[0];
    const currEnd = new Date(calYear, calMonth + 1, 0).toISOString().split('T')[0];
    const prevStart = new Date(calYear, calMonth - 1, 1).toISOString().split('T')[0];
    const prevEnd = new Date(calYear, calMonth, 0).toISOString().split('T')[0];

    attendances.forEach(st => {
      if (st.attendance_date >= currStart && st.attendance_date <= currEnd) {
        curr.total++;
        if (st.status === "결석") curr.absent++;
        else if (st.status === "조퇴") curr.leave++;
        else if (["출석", "지각"].includes(st.status)) curr.present++;
      } else if (st.attendance_date >= prevStart && st.attendance_date <= prevEnd) {
        prev.total++;
        if (st.status === "결석") prev.absent++;
        else if (st.status === "조퇴") prev.leave++;
        else if (["출석", "지각"].includes(st.status)) prev.present++;
      }
    });
    return { curr, prev };
  }, [attendances, calYear, calMonth]);

  const renderCalendarBlock = () => (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm w-full flex flex-col items-center">
      <div className="w-full max-w-[260px]">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-[13px] font-black text-[#002864]">{calYear}년 {calMonth + 1}월</h3>
          <div className="flex gap-1.5">
            <button onClick={() => { if(calMonth===0){setCalMonth(11); setCalYear(y=>y-1)}else setCalMonth(m=>m-1); setSelectedDate(null); }} className="p-1 rounded bg-slate-50 hover:bg-slate-100 transition-colors"><svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg></button>
            <button onClick={() => { if(calMonth===11){setCalMonth(0); setCalYear(y=>y+1)}else setCalMonth(m=>m+1); setSelectedDate(null); }} className="p-1 rounded bg-slate-50 hover:bg-slate-100 transition-colors"><svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg></button>
          </div>
        </div>
        
        <div className="grid grid-cols-7 gap-1 text-slate-400 text-[10px] text-center mb-2 font-bold">
          <div>일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div>토</div>
        </div>
        <div className="grid grid-cols-7 gap-1.5 mb-4">
          {calendarDays}
        </div>

        <div className="flex flex-wrap gap-1.5 text-[9px] font-bold text-slate-500 justify-center bg-slate-50 p-2 rounded-lg border border-slate-100">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#10b981]"></span>출석</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#eab308]"></span>지각</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#f97316]"></span>조퇴</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]"></span>결석</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-blue-500 border-[1.5px] border-white shadow-sm rounded-full"></span>상담</span>
        </div>
      </div>
    </div>
  );

  const renderExamChart = () => {
    if (examResults.length === 0) return <div className="text-center py-20 text-slate-400 font-bold text-sm bg-slate-50 rounded-xl">최근 시험 데이터가 없습니다.</div>;

    const width = 800;
    const height = 250;
    const paddingX = 40;
    const paddingY = 40;
    const maxScore = 100;
    
    const xStep = examResults.length > 1 ? (width - paddingX * 2) / (examResults.length - 1) : 0;
    const getY = (score: number) => height - paddingY - (score / maxScore) * (height - paddingY * 2);

    const studentPoints = examResults.map((r, i) => `${paddingX + i * xStep},${getY(r.final_score || 0)}`).join(" ");
    const avgPoints = examResults.map((r, i) => `${paddingX + i * xStep},${getY(r.class_avg || 0)}`).join(" ");

    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm overflow-x-auto">
        <div className="flex justify-end gap-4 mb-4">
          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5"><div className="w-3 h-1 bg-blue-500 rounded"></div>학생 점수</span>
          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5"><div className="w-3 h-1 bg-slate-300 rounded"></div>반 평균</span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto min-w-[500px]">
          {[0, 25, 50, 75, 100].map(score => (
            <g key={score}>
              <line x1={paddingX} y1={getY(score)} x2={width - paddingX} y2={getY(score)} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 4" />
              <text x={paddingX - 10} y={getY(score) + 4} fontSize="10" fill="#94a3b8" textAnchor="end" fontWeight="bold">{score}</text>
            </g>
          ))}
          
          {examResults.length > 1 && (
            <>
              <polyline points={avgPoints} fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinejoin="round" />
              <polyline points={studentPoints} fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}

          {examResults.map((r, i) => {
             const cx = paddingX + i * xStep;
             const sy = getY(r.final_score || 0);
             const ay = getY(r.class_avg || 0);
             const title = unwrap(r.exam_assignment)?.exam_master?.title || '시험';
             const shortTitle = title.length > 8 ? title.substring(0,8)+'..' : title;
             
             return (
               <g key={i}>
                 <circle cx={cx} cy={ay} r="3" fill="#cbd5e1" />
                 <circle cx={cx} cy={sy} r="5" fill="#fff" stroke="#3b82f6" strokeWidth="2" />
                 <text x={cx} y={sy - 12} fontSize="11" fill="#1e40af" textAnchor="middle" fontWeight="900">{r.final_score}</text>
                 <text x={cx} y={height - 10} fontSize="9" fill="#64748b" textAnchor="middle" fontWeight="bold">{shortTitle}</text>
               </g>
             );
          })}
        </svg>
      </div>
    );
  };

  if (isNotFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[80vh] bg-slate-50 p-10 font-pretendard">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-md w-full animate-[fadeIn_0.3s_ease-out]">
          <div className="text-5xl mb-4">👻</div>
          <h2 className="text-xl font-black text-slate-800 mb-2">학생을 찾을 수 없습니다.</h2>
          <p className="text-sm font-bold text-slate-500 mb-6">이미 삭제되었거나 잘못된 접근입니다.</p>
          <button onClick={() => router.back()} className="px-6 py-3 bg-[#002864] text-white font-bold rounded-lg shadow-sm hover:bg-blue-900 transition-colors w-full">
            이전 화면으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  if (!student) return <div className="p-10 text-center font-bold text-slate-500">데이터를 불러오는 중입니다...</div>;

  const TABS = [
    { id: 'info', name: '상세 정보 및 수강반' },
    ...(allowedActions.includes('action_view_consult') ? [{ id: 'consult', name: '상담 기록' }] : []),
    { id: 'attend', name: '출결 기록' },
    { id: 'progress', name: '진도 기록' },
    ...(allowedActions.includes('action_view_exam') ? [{ id: 'exam', name: '시험 성적' }] : []),
    { id: 'hw', name: '과제 현황' },
    ...(allowedActions.includes('action_view_clinic') ? [{ id: 'clinic', name: '오답 클리닉' }] : []),
    { id: 'billing', name: '수납/청구' }
  ];

  const activeProgressBooks = progressBooks.filter(b => b.status !== '완료');
  const completedProgressBooks = progressBooks.filter(b => b.status === '완료');

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-50 h-full relative overflow-y-auto custom-scroll p-4 pt-20 sm:p-8 sm:pt-24 font-pretendard">
      <div className="max-w-[1300px] w-full mx-auto space-y-5 pb-20">
        
        {/* 학생 헤더 */}
        <div className="flex justify-between items-start bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden shrink-0">
          <div className="absolute top-0 right-0 w-64 h-full bg-gradient-to-l from-blue-50/50 to-transparent"></div>
          <div className="flex items-center gap-5 relative z-10">
            <div className="w-20 h-20 bg-gradient-to-br from-[#002864] to-[#1e3a8a] text-white rounded-full flex items-center justify-center text-3xl font-black shadow-md shrink-0">
              {student.name.substring(1, 3) || "-"}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-black text-slate-800 tracking-tight">{student.name}</h1>
                <span className={`${student.status === '재원' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'} px-2 py-0.5 rounded text-[10px] font-black border shadow-sm`}>{student.status}</span>
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded mr-1.5">{getEnrolledClassNames()}</span>
                <span>{student.school || ""} {student.grade || ""}</span>
              </p>
            </div>
          </div>
          <div className="relative z-10 flex items-center gap-2">
            <button onClick={() => router.back()} className="px-3 py-2 bg-white text-slate-600 font-bold rounded-lg shadow-sm border border-slate-200 hover:bg-slate-50 hover:text-slate-800 transition-colors flex items-center gap-1 text-xs mr-2">
              ← 목록으로
            </button>
            {(student.status === "휴원" || student.status === "퇴원") && (
              <button onClick={() => setIsReEnrollModalOpen(true)} className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg shadow-sm hover:bg-emerald-700 transition-colors flex items-center gap-1.5 text-xs animate-pulse">
                🔄 복귀/재등록
              </button>
            )}
            <button onClick={() => setIsEditModalOpen(true)} className="px-4 py-2 bg-[#002864] text-white font-bold rounded-lg shadow-sm hover:bg-blue-900 transition-colors flex items-center gap-1.5 text-xs">
              정보 수정
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
          <div className="flex overflow-x-auto border-b border-slate-200 bg-slate-50/80 px-2 pt-2 custom-scroll shrink-0">
            {TABS.map(tab => (
              <button 
                key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                className={`px-5 py-3 font-black text-[12px] whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.id ? 'text-[#002864] border-[#002864]' : 'text-slate-400 border-transparent hover:text-slate-700 hover:bg-slate-100/50'}`}
              >
                {tab.name}
              </button>
            ))}
          </div>

          <div className="p-6 bg-white flex-1 relative overflow-hidden">
            
            {/* 🌟 1. INFO 탭 */}
            {activeTab === "info" && (
              <div className="flex flex-col lg:flex-row gap-6 animate-[fadeIn_0.2s_ease-out] h-full">
                <div className="flex-1 min-w-0 flex flex-col gap-4">
                  
                  {/* 🌟 학생/학부모/수강이력 패널 */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm">
                    <h3 className="text-[12px] font-black text-slate-600 mb-3 flex items-center gap-1.5"><span className="w-1 h-3.5 bg-[#0ea5e9] rounded-full"></span>학생 정보</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="flex flex-col"><span className="text-[11px] text-slate-400 font-bold">성별</span><span className="text-[13px] font-black text-slate-700 mt-0.5">{student.gender || "-"}</span></div>
                      <div className="flex flex-col"><span className="text-[11px] text-slate-400 font-bold">학교</span><span className="text-[13px] font-black text-slate-700 mt-0.5">{student.school || "-"}</span></div>
                      <div className="flex flex-col"><span className="text-[11px] text-slate-400 font-bold">학년</span><span className="text-[13px] font-black text-slate-700 mt-0.5">{student.grade || "-"}</span></div>
                      <div className="flex flex-col"><span className="text-[11px] text-slate-400 font-bold">학생 연락처</span><span className="text-[13px] font-black text-slate-700 mt-0.5">{student.phone || "-"}</span></div>
                    </div>
                  </div>
                  
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm">
                    <h3 className="text-[12px] font-black text-slate-600 mb-3 flex items-center gap-1.5"><span className="w-1 h-3.5 bg-emerald-400 rounded-full"></span>학부모 정보</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="flex flex-col"><span className="text-[11px] text-slate-400 font-bold">성함</span><span className="text-[13px] font-black text-slate-700 mt-0.5">{unwrap(student.parent)?.name || "미등록"}</span></div>
                      <div className="flex flex-col"><span className="text-[11px] text-slate-400 font-bold">관계</span><span className="text-[13px] font-black text-slate-700 mt-0.5">{unwrap(student.parent)?.relationship || "-"}</span></div>
                      <div className="flex flex-col"><span className="text-[11px] text-slate-400 font-bold">연락처</span><span className="text-[13px] font-black text-slate-700 mt-0.5">{unwrap(student.parent)?.phone || "-"}</span></div>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm flex-1">
                    <h3 className="text-[12px] font-black text-slate-600 mb-3 flex items-center gap-1.5"><span className="w-1 h-3.5 bg-purple-500 rounded-full"></span>수강 이력</h3>
                    <div className="space-y-2">
                      {enrollments.length === 0 ? <div className="text-[11px] text-slate-400 font-bold">이력이 없습니다.</div> :
                        enrollments.map((en) => (
                          <div key={en.enrollment_id} className="flex justify-between items-center bg-white p-2.5 rounded border border-slate-100 shadow-sm">
                            <div className="flex items-center gap-2.5">
                               <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${!en.end_date || en.status === '수강중' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                {!en.end_date || en.status === '수강중' ? '수강중' : '수강종료'}
                               </span>
                               <span className="text-[13px] font-bold text-slate-700">{unwrap(en.class)?.name}</span>
                            </div>
                            <span className="text-[11px] text-slate-400 font-bold">{en.start_date} ~ {en.end_date || '현재'}</span>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                </div>

                <div className="w-full lg:w-[280px] shrink-0 flex flex-col gap-4">
                  {renderCalendarBlock()}
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 shadow-sm flex-1 overflow-hidden flex flex-col">
                    <div className="flex justify-between items-center mb-2 shrink-0">
                      <h3 className="text-[11px] font-black text-slate-700">최근 상담 요약</h3>
                      <button onClick={() => setActiveTab('consult')} className="text-[9px] text-blue-500 hover:underline font-bold">전체보기</button>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scroll space-y-2 pr-1">
                       {consultLogs.slice(0, 3).map((log, i) => (
                         <div key={i} className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm">
                           <div className="flex justify-between items-start mb-1">
                             <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">{log.contact_method}</span>
                             <span className="text-[9px] text-slate-400 font-bold">{new Date(log.created_at).toLocaleDateString().replace(/\.$/, '')}</span>
                           </div>
                           <p className="text-[10px] text-slate-600 font-medium line-clamp-2 leading-snug">{log.content}</p>
                         </div>
                       ))}
                       {consultLogs.length === 0 && <div className="text-[10px] text-slate-400 text-center py-4 font-bold">기록이 없습니다.</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 🌟 2. CONSULT 탭 */}
            {activeTab === "consult" && (
              <div className="flex flex-col lg:flex-row gap-6 animate-[fadeIn_0.3s_ease-out] h-full">
                <div className="flex-1 min-w-0 flex flex-col h-full">
                  <div className="flex justify-between items-center mb-2 border-b border-slate-100 pb-4 shrink-0">
                    <h3 className="font-extrabold text-slate-700">상담 타임라인 전체보기</h3>
                    <button onClick={() => { setSelectedConsultLog(null); setIsConsultModalOpen(true); }} className="px-4 py-2 bg-[#002864] text-white font-bold rounded-lg text-[11px] shadow-sm hover:bg-blue-900 transition-colors flex items-center gap-1">
                      + 새 상담 기록
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scroll space-y-4 pb-10 pr-2">
                    {consultLogs.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold border border-slate-200 rounded-xl bg-slate-50 text-xs">등록된 상담 기록이 없습니다.</div> : 
                      consultLogs.map((log, idx) => (
                        <div key={log.log_id || log.id || idx} className={`bg-white p-4 rounded-xl border shadow-sm relative overflow-hidden group ${log.is_admission ? 'border-amber-200' : 'border-slate-200'}`}>
                          <div className={`absolute top-0 left-0 w-1 h-full ${log.is_admission ? 'bg-amber-400' : 'bg-indigo-400'}`}></div>
                          <div className="flex justify-between items-start mb-2 pl-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${log.is_admission ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>{log.contact_method}</span>
                              <span className="text-[11px] font-bold text-slate-800">{log.consultation_type}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-slate-400">{new Date(log.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' })}</span>
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 ml-1">
                                {!log.is_admission && (
                                  <>
                                    <button onClick={() => { setSelectedConsultLog(log); setIsConsultModalOpen(true); }} className="text-[10px] text-slate-400 hover:text-blue-600 font-bold px-1.5 rounded bg-slate-50 hover:bg-blue-50 transition-colors">수정</button>
                                    <button onClick={() => deleteConsultLog(log.log_id)} className="text-[10px] text-slate-400 hover:text-rose-600 font-bold px-1.5 rounded bg-slate-50 hover:bg-rose-50 transition-colors">삭제</button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-line mb-2 pl-2">{log.content}</p>
                          <div className="text-[9px] font-bold text-slate-400 text-right">기록자: {unwrap(log.instructor)?.name || '알 수 없음'} {log.is_admission ? '' : '선생님'}</div>
                        </div>
                      ))
                    }
                  </div>
                </div>
                <div className="w-full lg:w-[280px] shrink-0 flex flex-col gap-4">
                  {renderCalendarBlock()}
                </div>
              </div>
            )}

            {/* 🌟 3. ATTEND 탭 */}
            {activeTab === "attend" && (
              <div className="flex flex-col lg:flex-row gap-6 animate-[fadeIn_0.3s_ease-out] h-full">
                <div className="flex-1 min-w-0 flex flex-col h-full gap-4">
                  
                  <div className="bg-slate-50 rounded-xl p-5 border border-slate-100 shadow-sm shrink-0">
                    <div className="flex flex-col xl:flex-row gap-4">
                      <div className="flex-1 opacity-70">
                        <h3 className="text-[12px] font-black text-slate-500 mb-3">{calMonth === 0 ? 12 : calMonth}월 출결 통계 <span className="font-bold font-normal text-[10px] text-slate-400">(이전달)</span></h3>
                        <div className="grid grid-cols-4 gap-2">
                          <div className="bg-white border border-slate-200 rounded-lg p-2.5 text-center shadow-sm">
                            <div className="text-[10px] font-bold text-slate-500 mb-0.5">전체</div>
                            <div className="text-base font-black text-slate-800">{attSummary.prev.total}</div>
                          </div>
                          <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-2.5 text-center shadow-sm">
                            <div className="text-[10px] font-bold text-emerald-600 mb-0.5">출석/지각</div>
                            <div className="text-base font-black text-emerald-700">{attSummary.prev.present}</div>
                          </div>
                          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-2.5 text-center shadow-sm">
                            <div className="text-[10px] font-bold text-indigo-600 mb-0.5">조퇴</div>
                            <div className="text-base font-black text-indigo-700">{attSummary.prev.leave}</div>
                          </div>
                          <div className="bg-rose-50 border border-rose-100 rounded-lg p-2.5 text-center shadow-sm">
                            <div className="text-[10px] font-bold text-rose-600 mb-0.5">결석</div>
                            <div className="text-base font-black text-rose-700">{attSummary.prev.absent}</div>
                          </div>
                        </div>
                      </div>

                      <div className="hidden xl:block w-px bg-slate-200 my-2"></div>

                      <div className="flex-1">
                        <h3 className="text-[12px] font-black text-[#002864] mb-3">{calMonth + 1}월 출결 통계 <span className="font-bold font-normal text-[10px] text-slate-400">(조회월)</span></h3>
                        <div className="grid grid-cols-4 gap-2">
                          <div className="bg-white border border-slate-200 rounded-lg p-2.5 text-center shadow-sm">
                            <div className="text-[10px] font-bold text-slate-500 mb-0.5">전체</div>
                            <div className="text-base font-black text-slate-800">{attSummary.curr.total}</div>
                          </div>
                          <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-2.5 text-center shadow-sm">
                            <div className="text-[10px] font-bold text-emerald-600 mb-0.5">출석/지각</div>
                            <div className="text-base font-black text-emerald-700">{attSummary.curr.present}</div>
                          </div>
                          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-2.5 text-center shadow-sm">
                            <div className="text-[10px] font-bold text-indigo-600 mb-0.5">조퇴</div>
                            <div className="text-base font-black text-indigo-700">{attSummary.curr.leave}</div>
                          </div>
                          <div className="bg-rose-50 border border-rose-100 rounded-lg p-2.5 text-center shadow-sm">
                            <div className="text-[10px] font-bold text-rose-600 mb-0.5">결석</div>
                            <div className="text-base font-black text-rose-700">{attSummary.curr.absent}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-5 border border-slate-100 h-full flex flex-col shadow-sm min-h-[300px]">
                    {selectedDate ? (
                      <div className="flex flex-col h-full">
                        <div className="flex justify-between items-center mb-4 border-b border-slate-200 pb-3">
                           <h3 className="font-extrabold text-slate-700 text-sm">{selectedDate.split('-')[0]}년 {parseInt(selectedDate.split('-')[1])}월 {parseInt(selectedDate.split('-')[2])}일 출결</h3>
                           {attendForm.id && allowedActions.includes('action_edit_attend') && (
                             <button onClick={deleteAttendance} className="text-[10px] text-rose-500 font-bold hover:underline">기록 삭제</button>
                           )}
                        </div>
                        <div className="space-y-4 flex-1">
                          {allowedActions.includes('action_edit_attend') ? (
                            <>
                              <div>
                                <label className="block text-[11px] font-bold text-slate-600 mb-1.5">출결 상태</label>
                                <select value={attendForm.status} onChange={e => setAttendForm({...attendForm, status: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-[12px] font-bold text-slate-800 focus:border-[#002864] focus:outline-none">
                                  <option value="출석">🟢 출석</option><option value="지각">🟡 지각</option><option value="조퇴">🟠 조퇴</option><option value="결석">🔴 결석</option>
                                </select>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">등원 시간 (출석/지각)</label>
                                  <input type="time" value={attendForm.checkIn} onChange={e => setAttendForm({...attendForm, checkIn: e.target.value})} disabled={attendForm.status === '결석'} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-[12px] font-bold text-slate-800 focus:border-[#002864] focus:outline-none disabled:opacity-50" />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">하원 시간 (조퇴/종료)</label>
                                  <input type="time" value={attendForm.checkOut} onChange={e => setAttendForm({...attendForm, checkOut: e.target.value})} disabled={attendForm.status === '결석'} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-[12px] font-bold text-slate-800 focus:border-[#002864] focus:outline-none disabled:opacity-50" />
                                </div>
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-slate-600 mb-1.5">비고 (선생님 메모)</label>
                                <textarea rows={2} value={attendForm.remark} onChange={e => setAttendForm({...attendForm, remark: e.target.value})} placeholder="예: 병원 진료 후 늦게 등원함" className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-[12px] focus:border-[#002864] focus:outline-none resize-none"></textarea>
                              </div>
                            </>
                          ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold text-xs text-center pt-10">
                              수정 권한이 없습니다.
                            </div>
                          )}
                        </div>
                        {allowedActions.includes('action_edit_attend') && (
                          <div className="mt-4 shrink-0">
                            <button onClick={saveAttendance} className="w-full py-2.5 bg-[#002864] text-white font-bold rounded-lg shadow-sm hover:bg-blue-900 transition-colors text-[12px]">기록 저장</button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold text-xs text-center py-20">
                        우측 달력에서 날짜를 클릭하세요.
                      </div>
                    )}
                  </div>
                </div>
                <div className="w-full lg:w-[280px] shrink-0 flex flex-col gap-4">
                  {renderCalendarBlock()}
                </div>
              </div>
            )}

            {/* 🌟 4. PROGRESS 탭 */}
            {activeTab === "progress" && (
              <div className="flex flex-col lg:flex-row gap-6 animate-[fadeIn_0.2s_ease-out] h-full">
                <div className="flex-1 min-w-0 flex flex-col h-full overflow-y-auto custom-scroll pr-2">
                  <h3 className="text-[13px] font-black text-slate-700 mb-3 border-b border-slate-100 pb-2">진행 중인 교재</h3>
                  {activeProgressBooks.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">진행 중인 교재가 없습니다.</div> :
                    <div className="space-y-4">
                      {activeProgressBooks.map((b, i) => (
                        <div key={i} className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                           <div className="flex justify-between items-center mb-3">
                             <div>
                               <div className="flex items-center gap-1.5 mb-1">
                                 <span className="text-[9px] font-black bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border">{b.className}</span>
                                 <span className="text-[9px] font-black bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100">{b.tbType}</span>
                               </div>
                               <h4 className="font-black text-slate-800 text-[13px]">{b.tbTitle}</h4>
                             </div>
                             <div className="flex flex-col items-end">
                               <span className="text-lg font-black text-[#002864] leading-none">{b.percent}%</span>
                               <span className="text-[9px] font-bold text-slate-400 mt-1">{b.doneCount} / {b.pages.length}p</span>
                             </div>
                           </div>
                           <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-100 flex flex-wrap gap-[3px]">
                              {b.pages.length === 0 ? <span className="text-[10px] text-slate-400">페이지 데이터 없음</span> :
                                 b.pages.map((p: number) => {
                                   const st = b.pageStatuses[p];
                                   let bg = 'bg-slate-200'; let tt = `${p}p 대기`;
                                   if(st === 'done') { bg = 'bg-[#002864]'; tt = `${p}p 완료`; }
                                   else if(st === 'homework') { bg = 'bg-amber-400'; tt = `${p}p 과제 진행중`; }
                                   return <div key={p} title={tt} className={`w-1.5 h-3.5 rounded-[1.5px] ${bg} shadow-sm transition-colors cursor-help`}/>
                                 })
                              }
                           </div>
                        </div>
                      ))}
                    </div>
                  }
                </div>
                
                <div className="w-full lg:w-[280px] shrink-0 flex flex-col gap-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm w-full flex flex-col h-full min-h-[400px]">
                    <h3 className="text-[12px] font-black text-emerald-600 mb-3 border-b border-slate-100 pb-2 flex items-center gap-1.5">
                      <span className="text-base">🏆</span> 완료된 교재 목록
                    </h3>
                    <div className="flex-1 overflow-y-auto custom-scroll space-y-2.5 pr-1">
                       {completedProgressBooks.length === 0 ? (
                         <div className="text-center py-10 text-slate-400 font-bold text-[10px] bg-slate-50 rounded-lg">아직 완료된 교재가 없습니다.</div>
                       ) : (
                         completedProgressBooks.map((b, i) => (
                           <div key={i} className="bg-emerald-50 border border-emerald-100 p-3 rounded-lg shadow-sm">
                              <div className="flex gap-1.5 mb-1.5">
                                <span className="text-[8px] font-black text-slate-500 bg-white px-1 py-0.5 rounded border border-slate-200">{b.className}</span>
                                <span className="text-[8px] font-black text-emerald-600 bg-white px-1 py-0.5 rounded border border-emerald-200">{b.tbType}</span>
                              </div>
                              <div className="text-[11px] font-black text-slate-800 truncate mb-1" title={b.tbTitle}>{b.tbTitle}</div>
                              <div className="text-[9px] text-slate-500 font-bold text-right">종료일: {b.actual_end_date || '-'}</div>
                           </div>
                         ))
                       )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 🌟 5. EXAM 탭 */}
            {activeTab === "exam" && (
              <div className="space-y-6 animate-[fadeIn_0.2s_ease-out]">
                {renderExamChart()}

                <div>
                  <div className="flex justify-between items-center mb-3 border-b border-slate-100 pb-2">
                    <h3 className="font-extrabold text-slate-700 text-[13px] flex items-center gap-1.5">
                      <span className="w-1 h-3 bg-emerald-500 rounded-full"></span>자체 테스트 기록
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {examResults.length === 0 ? <div className="col-span-full text-[11px] text-slate-400 text-center py-4 bg-slate-50 rounded-xl">테스트 기록이 없습니다.</div> :
                       examResults.slice().reverse().map((ex, i) => (
                         <div key={i} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                           <div className="text-[10px] font-black text-slate-500 mb-1 truncate" title={unwrap(ex.exam_assignment)?.exam_master?.title}>{unwrap(ex.exam_assignment)?.exam_master?.title}</div>
                           <div className="flex justify-between items-end mt-2">
                             <div className="text-[9px] text-slate-400 font-bold">반 평균 {ex.class_avg || '-'}</div>
                             <div className="text-sm font-black text-[#002864]">{ex.final_score !== null ? `${ex.final_score}점` : '-'}</div>
                           </div>
                         </div>
                       ))
                    }
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-3 border-b border-slate-100 pb-2 mt-6">
                    <h3 className="font-extrabold text-slate-700 text-[13px] flex items-center gap-1.5">
                      <span className="w-1 h-3 bg-indigo-500 rounded-full"></span>학교 내신 성적
                    </h3>
                    <button onClick={() => setIsSchoolExamModalOpen(true)} className="px-2.5 py-1 bg-indigo-50 text-indigo-600 font-bold rounded text-[10px] hover:bg-indigo-100 transition-colors shadow-sm">
                      + 성적 추가
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {schoolExams.length === 0 ? <div className="col-span-full text-[11px] text-center py-4 text-slate-400 bg-slate-50 rounded-xl">학교 성적이 없습니다.</div> :
                      schoolExams.map((se, idx) => (
                        <div key={se.id || idx} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm relative group">
                          <button onClick={() => deleteSchoolExam(se.id)} className="absolute top-1.5 right-1.5 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 bg-white rounded-full w-5 h-5 flex items-center justify-center border border-slate-100 text-[10px]">✕</button>
                          <div className="text-[9px] font-bold text-slate-400 mb-0.5">{se.year}년 {se.semester}학기 {se.exam_type}</div>
                          <div className="flex justify-between items-end">
                            <div className="font-black text-[11px] text-slate-700">{se.subject}</div>
                            <div className="text-[13px] font-black text-indigo-600">{se.score}점</div>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </div>
              </div>
            )}

            {/* 🌟 6. HW 탭 */}
            {activeTab === "hw" && (
              <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
                <h3 className="font-black text-slate-700 text-[13px] mb-3">과제 제출 및 채점 기록</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {hwList.length === 0 ? <div className="col-span-full text-center py-10 text-slate-400 font-bold text-[11px] bg-slate-50 border border-slate-200 rounded-xl">배부된 과제가 없습니다.</div> :
                    hwList
                    .filter(hw => {
                      const assign = unwrap(hw.homework_assignment);
                      return assign && assign.homework_title !== '[시스템] 수업 진도 완료 기록';
                    })
                    .map((hw, idx) => {
                      const assign = unwrap(hw.homework_assignment);
                      if (!assign) return null;
                      
                      const qCount = assign.target_questions ? (typeof assign.target_questions === 'string' ? JSON.parse(assign.target_questions).length : assign.target_questions.length) : 0;
                      const compCount = hw.completed_tq_ids ? (typeof hw.completed_tq_ids === 'string' ? JSON.parse(hw.completed_tq_ids).length : hw.completed_tq_ids.length) : 0;
                      
                      let statusCol = 'bg-slate-100 text-slate-600';
                      if(hw.status.includes('제출')) statusCol = 'bg-blue-50 text-blue-600 border border-blue-200';
                      else if(hw.status.includes('완료')) statusCol = 'bg-emerald-50 text-emerald-600 border border-emerald-200';
                      else if(hw.status.includes('미')) statusCol = 'bg-rose-50 text-rose-500 border border-rose-100';

                      const createdDate = assign.created_at ? new Date(assign.created_at).toLocaleDateString().replace(/\.$/, '') : '-';
                      const dueDate = assign.due_date ? new Date(assign.due_date).toLocaleDateString().replace(/\.$/, '') : '-';
                      const checkedDate = hw.checked_at ? new Date(hw.checked_at).toLocaleDateString().replace(/\.$/, '') : '-';

                      return (
                        <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col justify-between shadow-sm hover:border-blue-300 transition-colors">
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-black border border-slate-200">{unwrap(assign.textbook)?.title || '기타'}</span>
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${statusCol}`}>{hw.status}</span>
                          </div>
                          <h4 className="font-black text-slate-800 text-[13px] mb-2 truncate" title={assign.homework_title}>{assign.homework_title}</h4>
                          
                          <div className="flex flex-col gap-1 mt-1 mb-3 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                             <div className="flex justify-between items-center text-[10px]">
                               <span className="font-bold text-slate-400">배부일: <span className="text-slate-600">{createdDate}</span></span>
                               <span className="font-bold text-slate-400">마감일: <span className="text-rose-500">{dueDate}</span></span>
                             </div>
                             <div className="flex justify-between items-center text-[10px]">
                               <span className="font-bold text-slate-400">제출/확인: <span className="text-blue-600">{hw.status === '미제출' ? '-' : checkedDate}</span></span>
                             </div>
                          </div>

                          <div className="flex justify-between items-end mt-auto pt-2 border-t border-slate-50">
                            <div className="text-[10px] font-black text-slate-600">진행률 <span className="text-[#002864] ml-0.5">{compCount} / {qCount}</span></div>
                          </div>
                        </div>
                      );
                    })
                  }
                </div>
              </div>
            )}

            {/* 🌟 7. CLINIC 탭 */}
            {activeTab === "clinic" && (
              <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
                <h3 className="font-black text-slate-700 text-[13px] mb-3">누적 오답 및 맞춤 클리닉 배부 내역</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {clinicList.length === 0 ? <div className="col-span-full text-center py-10 text-slate-400 font-bold text-[11px] bg-slate-50 border border-slate-200 rounded-xl">클리닉/오답 배부 내역이 없습니다.</div> :
                    clinicList.map((c, idx) => {
                      let typeCol = 'bg-rose-50 text-rose-500 border border-rose-100';
                      if(c.task_type === '유사') typeCol = 'bg-indigo-50 text-indigo-500 border border-indigo-100';
                      if(c.task_type === '쌍둥이') typeCol = 'bg-amber-50 text-amber-600 border border-amber-200';

                      return (
                        <div key={idx} className="bg-white p-3.5 rounded-xl border border-slate-200 flex flex-col justify-between shadow-sm hover:border-rose-300 transition-colors">
                          <div className="flex justify-between items-start mb-2">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${typeCol}`}>{c.task_type} 문항</span>
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${c.status==='해결'?'bg-emerald-50 text-emerald-600':'bg-slate-100 text-slate-500'}`}>{c.status}</span>
                          </div>
                          <div className="text-[11px] font-black text-slate-700 mb-2">본교재 연결 문항: <span className="text-[#002864] ml-0.5">{unwrap(c.textbook_question)?.question_number || '-'}번</span></div>
                          <div className="text-[9px] font-bold text-slate-400 mt-auto text-right">시도 횟수: {c.attempt_count}회</div>
                        </div>
                      );
                    })
                  }
                </div>
              </div>
            )}

            {/* 🌟 8. BILLING 탭 */}
            {activeTab === "billing" && (() => {
              let total = 0, paid = 0, unpaid = 0;
              billingList.forEach(b => {
                const amt = parseInt(b.amount) || 0;
                total += amt;
                if (b.status === "완납") paid += amt; else unpaid += amt;
              });

              return (
                <div className="space-y-4 animate-[fadeIn_0.3s_ease-out]">
                  <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-4">
                    <h3 className="font-extrabold text-slate-700 text-[13px]">월별 수납 및 청구 내역</h3>
                    <button onClick={() => setIsBillingModalOpen(true)} className="px-3 py-1.5 bg-emerald-600 text-white font-bold rounded-lg text-[11px] shadow-sm hover:bg-emerald-700 transition-colors flex items-center gap-1">
                      + 수동 청구
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col items-center justify-center">
                      <span className="text-[10px] font-bold text-slate-500 mb-0.5">총 청구 금액</span><span className="text-sm font-black text-slate-800">{total.toLocaleString()}원</span>
                    </div>
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 shadow-sm flex flex-col items-center justify-center">
                      <span className="text-[10px] font-bold text-rose-500 mb-0.5">미납 금액</span><span className="text-sm font-black text-rose-600">{unpaid.toLocaleString()}원</span>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 shadow-sm flex flex-col items-center justify-center">
                      <span className="text-[10px] font-bold text-emerald-600 mb-0.5">납부 완료 금액</span><span className="text-sm font-black text-emerald-700">{paid.toLocaleString()}원</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {billingList.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold border border-slate-200 rounded-xl bg-slate-50 text-[11px]">청구 내역이 없습니다.</div> :
                      billingList.map((bill, idx) => (
                        <div key={bill.billing_id || bill.id || idx} className={`bg-white p-3 rounded-xl border ${bill.status === '완납' ? 'border-slate-200' : 'border-rose-300'} shadow-sm flex items-center justify-between hover:bg-slate-50 transition-colors`}>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-slate-100 flex flex-col items-center justify-center border border-slate-200 shrink-0 shadow-inner">
                              <span className="text-[8px] text-slate-500 font-bold">{bill.billing_month.split('-')[0]}</span>
                              <span className="text-[12px] font-black text-slate-700 leading-none">{bill.billing_month.split('-')[1]}월</span>
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-0.5">
                                {bill.status === "완납" ? <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] font-black border border-emerald-200">✅ 완납</span> : <span className="bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded text-[9px] font-black border border-rose-200">🔴 미납</span>}
                                <span className="text-[12px] font-extrabold text-[#002864]">{unwrap(bill.class)?.name || '미배정'}</span>
                              </div>
                              <div className="text-[9px] font-bold text-slate-400">납부 기한: {bill.due_date}까지</div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-[14px] font-black text-slate-800">{parseInt(bill.amount).toLocaleString()}원</span>
                            {bill.status === "완납" ? <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">결제완료</span> : <button onClick={() => { setPayFormInit({ billingId: bill.billing_id, amount: parseInt(bill.amount), method: "계좌이체" }); setIsPaymentModalOpen(true); }} className="px-3 py-1 bg-[#002864] text-white text-[9px] font-bold rounded hover:bg-blue-900 transition-colors shadow-sm">수납 처리</button>}
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </div>
              );
            })()}

          </div>
        </div>
        
        {currentUser.isAdmin && (
          <div className="flex justify-end pt-4">
            <button onClick={deleteStudentData} className="text-xs font-bold text-rose-400 hover:text-rose-600 underline px-2 py-1">학생 데이터 완전 삭제 (위험)</button>
          </div>
        )}
      </div>

      <StudentEditModal 
        isOpen={isEditModalOpen} 
        studentId={studentId} 
        student={student} 
        enrollments={enrollments} 
        allClasses={allClasses} 
        onClose={() => setIsEditModalOpen(false)} 
        onSuccess={loadInitialData} 
      />

      <ConsultModal 
        isOpen={isConsultModalOpen} 
        studentId={studentId} 
        instId={currentUser.instId} 
        logData={selectedConsultLog} 
        onClose={() => setIsConsultModalOpen(false)} 
        onSuccess={loadConsultLogs} 
      />

      <BillingModal 
        isOpen={isBillingModalOpen} 
        studentId={studentId} 
        enrollments={enrollments} 
        allClasses={allClasses} 
        onClose={() => setIsBillingModalOpen(false)} 
        onSuccess={loadBillings} 
      />

      <PaymentModal 
        isOpen={isPaymentModalOpen} 
        payFormInit={payFormInit} 
        onClose={() => setIsPaymentModalOpen(false)} 
        onSuccess={loadBillings} 
      />

      {isSchoolExamModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-indigo-600 p-4 flex justify-between items-center text-white shrink-0">
              <h2 className="font-bold text-sm flex items-center gap-1.5">🏫 학교 성적 등록</h2>
              <button onClick={() => setIsSchoolExamModalOpen(false)} className="text-indigo-200 hover:text-white font-bold text-xl leading-none">&times;</button>
            </div>
            
            <form onSubmit={handleSaveSchoolExam} className="p-5 bg-slate-50 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">연도</label>
                  <input type="number" value={schoolExamForm.year} onChange={(e) => setSchoolExamForm({...schoolExamForm, year: parseInt(e.target.value)})} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">학기</label>
                  <select value={schoolExamForm.semester} onChange={(e) => setSchoolExamForm({...schoolExamForm, semester: parseInt(e.target.value)})} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white text-sm">
                    <option value={1}>1학기</option>
                    <option value={2}>2학기</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">고사</label>
                  <select value={schoolExamForm.examType} onChange={(e) => setSchoolExamForm({...schoolExamForm, examType: e.target.value})} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white text-sm">
                    <option value="중간고사">중간고사</option>
                    <option value="기말고사">기말고사</option>
                    <option value="수행평가">수행평가</option>
                    <option value="모의고사">모의고사</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">과목</label>
                  <select value={schoolExamForm.subject} onChange={(e) => setSchoolExamForm({...schoolExamForm, subject: e.target.value})} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white text-sm">
                    <option value="수학">수학</option>
                    <option value="영어">영어</option>
                    <option value="국어">국어</option>
                    <option value="과학">과학</option>
                    <option value="사회">사회</option>
                    <option value="기타">기타</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">취득 점수</label>
                <div className="relative">
                  <input type="number" step="0.1" required value={schoolExamForm.score} onChange={(e) => setSchoolExamForm({...schoolExamForm, score: e.target.value})} className="w-full px-2.5 py-2 rounded-lg border border-slate-300 font-black text-indigo-700 text-base focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" placeholder="예: 95.5" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">점</span>
                </div>
              </div>

              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setIsSchoolExamModalOpen(false)} className="flex-1 py-2 bg-slate-200 text-slate-600 font-bold rounded-lg hover:bg-slate-300 transition-colors text-xs">취소</button>
                <button type="submit" disabled={isSavingSchoolExam} className="flex-1 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm text-xs">
                  {isSavingSchoolExam ? "저장 중..." : "등록"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🌟 재등록 드롭다운 로직 완벽 적용 */}
      {isReEnrollModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-emerald-600 p-4 flex justify-between items-center text-white shrink-0">
              <h2 className="font-bold text-sm flex items-center gap-1.5">🔄 학생 재원(재등록) 처리</h2>
              <button onClick={() => setIsReEnrollModalOpen(false)} className="text-emerald-200 hover:text-white font-bold text-xl leading-none">&times;</button>
            </div>
            
            <form onSubmit={handleReEnroll} className="p-5 bg-slate-50 flex flex-col gap-3">
              <div className="text-[11px] font-bold text-slate-600 mb-1 leading-relaxed">
                <span className="text-emerald-600">[{student?.name}]</span> 학생을 다시 재원생으로 전환하고 새로운 반에 배정합니다.
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">배정할 수강 반 <span className="text-rose-500">*</span></label>
                <select required value={reEnrollForm.classId} onChange={(e) => setReEnrollForm({...reEnrollForm, classId: e.target.value})} className="w-full px-2.5 py-2 rounded-lg border border-slate-300 font-bold text-slate-700 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-white text-sm">
                  <option value="" disabled>반을 선택해주세요</option>
                  {allClasses.map(c => {
                    const fullCode = c.code || c.name || '';
                    const displayName = fullCode.replace(/\d{4}$/, '').trim();
                    const instName = c.instructor?.name || '미정';
                    return (
                      <option key={c.class_id} value={c.class_id}>{displayName} ({instName})</option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">수강 시작일 (재등록일) <span className="text-rose-500">*</span></label>
                <input type="date" required value={reEnrollForm.startDate} onChange={(e) => setReEnrollForm({...reEnrollForm, startDate: e.target.value})} className="w-full px-2.5 py-2 rounded-lg border border-slate-300 font-bold text-slate-700 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-white text-sm" />
              </div>

              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setIsReEnrollModalOpen(false)} className="flex-1 py-2 bg-slate-200 text-slate-600 font-bold rounded-lg hover:bg-slate-300 transition-colors text-xs">취소</button>
                <button type="submit" disabled={isSubmittingReEnroll} className="flex-1 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm text-xs">
                  {isSubmittingReEnroll ? "처리 중..." : "재등록 완료"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}