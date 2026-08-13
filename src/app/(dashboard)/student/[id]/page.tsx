// src/app/(dashboard)/student/[id]/page.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

import StudentEditModal from "@/components/student/StudentEditModal";
import ConsultModal from "@/components/student/ConsultModal";
import { BillingModal, PaymentModal } from "@/components/student/BillingModals";

// 🌟 [안전 장치] Supabase에서 객체 배열로 반환되는 관계 데이터를 단일 객체로 꺼내줍니다.
const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

export default function StudentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.id as string;

  const [currentUser, setCurrentUser] = useState({ instId: "", name: "", isAdmin: false });

  const [activeTab, setActiveTab] = useState<"info" | "consult" | "attend" | "hw" | "exam" | "clinic" | "billing">("info");

  const [student, setStudent] = useState<any>(null);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [allClasses, setAllClasses] = useState<any[]>([]);
  
  const [consultLogs, setConsultLogs] = useState<any[]>([]);
  const [attendances, setAttendances] = useState<any[]>([]);
  const [hwList, setHwList] = useState<any[]>([]);
  const [examList, setExamList] = useState<any[]>([]);
  const [clinicList, setClinicList] = useState<any[]>([]);
  const [billingList, setBillingList] = useState<any[]>([]);

  const [schoolExams, setSchoolExams] = useState<any[]>([]);
  const [isSchoolExamModalOpen, setIsSchoolExamModalOpen] = useState(false);
  const [schoolExamForm, setSchoolExamForm] = useState({
    year: new Date().getFullYear(),
    semester: 1,
    examType: "중간고사",
    subject: "수학",
    score: ""
  });
  const [isSavingSchoolExam, setIsSavingSchoolExam] = useState(false);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isConsultModalOpen, setIsConsultModalOpen] = useState(false);
  const [isBillingModalOpen, setIsBillingModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  
  // 🌟 [추가] 재등록 관련 상태
  const [isReEnrollModalOpen, setIsReEnrollModalOpen] = useState(false);
  const [isSubmittingReEnroll, setIsSubmittingReEnroll] = useState(false);
  const [reEnrollForm, setReEnrollForm] = useState({
    classId: "",
    startDate: new Date().toISOString().split('T')[0]
  });

  const [selectedConsultLog, setSelectedConsultLog] = useState<any>(null);
  const [payFormInit, setPayFormInit] = useState<any>(null);

  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [attendForm, setAttendForm] = useState({ id: "", status: "출석", lateMin: 0, remark: "" });

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
      const { data } = await supabase
        .from('tenant_role_permissions')
        .select('allowed_menus')
        .eq('tenant_id', tId)
        .eq('role_name', role)
        .maybeSingle();

      if (data && data.allowed_menus) {
        setAllowedActions(data.allowed_menus);
      }
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
    if (activeTab === "consult") loadConsultLogs();
    if (activeTab === "attend") loadAttendance();
    if (activeTab === "billing") loadBillings();
    if (activeTab === "exam") loadSchoolExams(); 
  }, [activeTab, calYear, calMonth]);

  const loadInitialData = async () => {
    try {
      const { data: stuData } = await supabase.from("student").select("*, parent(*)").eq("student_id", studentId).single();
      setStudent(stuData);

      // 🌟 [수정] 수강 이력을 위해 start_date, end_date, status 도 가져오고 역순 정렬
      const { data: enrollData } = await supabase
        .from("enrollment")
        .select("enrollment_id, class_id, start_date, end_date, status, class(name)")
        .eq("student_id", studentId)
        .order("start_date", { ascending: false });
      setEnrollments(enrollData || []);

      const { data: hwData } = await supabase.from("student_homework_result").select("status, homework_assignment(homework_title, target_questions, textbook(title))").eq("student_id", studentId);
      setHwList(hwData || []);

      const { data: exData } = await supabase.from("exam_assignment").select("test_status, total_score, exam_master(title)").eq("student_id", studentId);
      setExamList(exData || []);

      const { data: clData } = await supabase.from("clinic_task").select("*, textbook_question(question_number)").eq("student_id", studentId);
      setClinicList(clData || []);
    } catch (error) { console.error("로딩 에러:", error); }
  };

  const loadClasses = async () => {
    const tId = localStorage.getItem("logica_tenant_id");
    let query = supabase.from("class").select("class_id, name, level_name, tuition_fee").eq("status", "예정");
    if (tId) query = query.eq("tenant_id", tId);
    
    const { data } = await query.order("name");
    setAllClasses(data || []);
  };

  const loadConsultLogs = async () => {
    try {
      const { data: regularLogs } = await supabase
        .from("consultation_log")
        .select("*, instructor(name)")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(200);

      const { data: admissionLogs } = await supabase
        .from("admission_application")
        .select("application_id, counseling_memo, test_result, created_at, admission_session(title)")
        .eq("student_id", studentId)
        .not("counseling_memo", "is", null);

      const formattedAdmissionLogs = (admissionLogs || [])
        .filter((app: any) => app.counseling_memo && app.counseling_memo.trim() !== "")
        .map((app: any) => {
          const sessionTitle = Array.isArray(app.admission_session) 
            ? app.admission_session[0]?.title 
            : app.admission_session?.title;

          return {
            log_id: `admission_${app.application_id}`,
            consultation_type: "입학 상담",
            contact_method: "방문/테스트",
            content: `[테스트 내역: ${sessionTitle || '미상'}]\n[테스트 결과: ${app.test_result}]\n\n${app.counseling_memo}`,
            created_at: app.created_at,
            instructor: { name: "입학 담당" },
            is_admission: true
          };
        });

      const combinedLogs = [...(regularLogs || []), ...formattedAdmissionLogs].sort((a, b) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setConsultLogs(combinedLogs);
    } catch (error) {
      console.error("상담 내역 로딩 에러:", error);
    }
  };

  const loadAttendance = async () => {
    const startDate = new Date(calYear, calMonth, 1).toISOString().split('T')[0];
    const endDate = new Date(calYear, calMonth + 1, 0).toISOString().split('T')[0];
    const { data } = await supabase.from("attendance").select("*").eq("student_id", studentId).gte("attendance_date", startDate).lte("attendance_date", endDate);
    setAttendances(data || []);
  };

  const loadBillings = async () => {
    const { data } = await supabase.from("academy_billing").select("*, class(name)").eq("student_id", studentId).order("billing_month", { ascending: false }).limit(200);
    setBillingList(data || []);
  };

  const loadSchoolExams = async () => {
    try {
      const { data, error } = await supabase
        .from("student_school_exam")
        .select("*")
        .eq("student_id", studentId)
        .order("year", { ascending: false })
        .order("semester", { ascending: false })
        .order("exam_type", { ascending: true })
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      setSchoolExams(data || []);
    } catch (error) {
      console.error("학교 성적 로드 에러:", error);
    }
  };

  const handleSaveSchoolExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolExamForm.score || isNaN(Number(schoolExamForm.score))) {
      alert("올바른 점수를 입력해주세요.");
      return;
    }

    setIsSavingSchoolExam(true);
    try {
      const tId = localStorage.getItem("logica_tenant_id");
      const { error } = await supabase.from("student_school_exam").insert({
        student_id: studentId,
        year: schoolExamForm.year,
        semester: schoolExamForm.semester,
        exam_type: schoolExamForm.examType,
        subject: schoolExamForm.subject,
        score: parseFloat(schoolExamForm.score),
        tenant_id: tId
      });

      if (error) throw error;

      alert("학교 내신 성적이 등록되었습니다.");
      setIsSchoolExamModalOpen(false);
      setSchoolExamForm({ ...schoolExamForm, score: "" }); 
      loadSchoolExams();
    } catch (error: any) {
      alert("저장에 실패했습니다: " + error.message);
    } finally {
      setIsSavingSchoolExam(false);
    }
  };

  const deleteSchoolExam = async (id: string) => {
    if (!confirm("이 성적 기록을 삭제하시겠습니까?")) return;
    try {
      const { error } = await supabase.from("student_school_exam").delete().eq("id", id);
      if (error) throw error;
      loadSchoolExams();
    } catch (error: any) {
      alert("삭제 실패: " + error.message);
    }
  };

  // 🌟 [추가] 재등록(수강 이력 추가) 처리 함수
  const handleReEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reEnrollForm.classId) return alert("배정할 반을 선택해주세요.");
    if (!reEnrollForm.startDate) return alert("시작일을 선택해주세요.");
    
    setIsSubmittingReEnroll(true);
    try {
      const tId = localStorage.getItem("logica_tenant_id");
      
      // 1. 학생 상태를 '재원'으로 롤백
      await supabase.from("student").update({ status: "재원", updated_at: new Date().toISOString() }).eq("student_id", studentId);
      
      // 2. 새로운 수강 이력 인서트
      await supabase.from("enrollment").insert({
        student_id: studentId,
        class_id: reEnrollForm.classId,
        start_date: reEnrollForm.startDate,
        status: "수강중",
        tenant_id: tId
      });

      alert("🎉 성공적으로 재원 처리 및 반 배정이 완료되었습니다.");
      setIsReEnrollModalOpen(false);
      loadInitialData(); // 최신 상태 갱신
    } catch (err: any) {
      alert("재등록 실패: " + err.message);
    } finally {
      setIsSubmittingReEnroll(false);
    }
  };

  // 🌟 [추가] 진행중인 수강 이력 종료 처리
  const handleEndEnrollment = async (enrollmentId: string) => {
    const endDate = prompt("수강 종료일(퇴원/휴원일 또는 분반일)을 YYYY-MM-DD 형식으로 입력해주세요.", new Date().toISOString().split('T')[0]);
    if (!endDate) return;

    try {
      await supabase.from("enrollment").update({ 
        end_date: endDate, 
        status: "수강종료",
        updated_at: new Date().toISOString()
      }).eq("enrollment_id", enrollmentId);
      
      alert("수강 이력이 종료되었습니다.\n💡 학생의 상태(퇴원/휴원 등)도 변경하려면 우측 상단의 [정보 수정]을 이용해주세요.");
      loadInitialData();
    } catch (err: any) {
      alert("종료 처리 실패: " + err.message);
    }
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
      router.push("/student");
    } catch (error: any) { alert("삭제 실패: " + error.message); }
  };

  const deleteConsultLog = async (logId: string) => {
    if (!confirm("이 기록을 삭제하시겠습니까?")) return;
    await supabase.from("consultation_log").delete().eq("log_id", logId);
    loadConsultLogs();
  };

  const handleDateClick = (dateStr: string) => {
    setSelectedDate(dateStr);
    const record = attendances.find(a => a.attendance_date === dateStr);
    if (record) {
      setAttendForm({ id: record.attendance_id, status: record.status || "출석", lateMin: record.late_minutes || 0, remark: record.remark || "" });
    } else {
      setAttendForm({ id: "", status: "출석", lateMin: 0, remark: "" });
    }
  };

  const saveAttendance = async () => {
    if (!selectedDate) return;
    try {
      const { data: enrolls } = await supabase.from('enrollment').select('enrollment_id, class_id').eq('student_id', studentId).order('created_at', { ascending: false }).limit(1);
      const enrollId = enrolls?.[0]?.enrollment_id;
      const classId = enrolls?.[0]?.class_id || student?.class_id;

      if (!enrollId) return alert("수강 이력이 없어 저장이 불가능합니다. 반을 먼저 배정해주세요.");

      const payload = { student_id: studentId, class_id: classId, enrollment_id: enrollId, attendance_date: selectedDate, status: attendForm.status, late_minutes: attendForm.lateMin, remark: attendForm.remark };

      if (attendForm.id) {
        await supabase.from('attendance').update(payload).eq('attendance_id', attendForm.id);
      } else {
        await supabase.from('attendance').insert(payload);
      }
      alert("출결이 저장되었습니다.");
      loadAttendance();
    } catch (e) { alert("저장 실패"); }
  };

  // 🌟 [수정] 현재 진행중인 활성 반 이름만 콤마로 연결하여 가져옵니다.
  const getEnrolledClassNames = () => {
    const activeEnrolls = enrollments.filter(e => !e.end_date || e.status === '수강중');
    return activeEnrolls.length > 0 ? activeEnrolls.map(e => unwrap(e.class)?.name).join(", ") : "미배정";
  };

  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    
    let attendMap: any = {};
    attendances.forEach(a => attendMap[a.attendance_date] = a.status);

    const blanks = Array.from({ length: firstDay }).map((_, i) => <div key={`blank-${i}`} className="aspect-square"></div>);
    
    const days = Array.from({ length: daysInMonth }).map((_, i) => {
      const d = i + 1;
      const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const status = attendMap[dateStr];
      const isActive = dateStr === selectedDate;
      
      let dotColor = "bg-transparent";
      if (status === "출석") dotColor = "bg-[#10b981]";
      else if (status === "지각") dotColor = "bg-[#eab308]";
      else if (status === "조퇴") dotColor = "bg-[#f97316]";
      else if (status === "결석") dotColor = "bg-[#ef4444]";

      return (
        <div key={d} onClick={() => handleDateClick(dateStr)} className={`aspect-square rounded-lg flex flex-col items-center justify-center font-bold text-sm cursor-pointer transition-colors ${isActive ? 'bg-[#002864] text-white' : 'hover:bg-slate-200 text-slate-700'}`}>
          <span>{d}</span>
          <div className={`w-1.5 h-1.5 rounded-full mt-1 ${dotColor}`}></div>
        </div>
      );
    });

    return [...blanks, ...days];
  }, [calYear, calMonth, attendances, selectedDate]);

  if (!student) return <div className="p-10 text-center font-bold text-slate-500">데이터를 불러오는 중입니다...</div>;

  const TABS = [
    { id: 'info', name: '학생 상세 정보 및 수강반' },
    ...(allowedActions.includes('action_view_consult') ? [{ id: 'consult', name: '상담 기록' }] : []),
    { id: 'attend', name: '출결 기록' },
    { id: 'hw', name: '과제 현황' },
    ...(allowedActions.includes('action_view_exam') ? [{ id: 'exam', name: '시험 성적' }] : []),
    ...(allowedActions.includes('action_view_clinic') ? [{ id: 'clinic', name: '클리닉 분석' }] : []),
    { id: 'billing', name: '수납/청구' }
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-50 h-full relative overflow-y-auto custom-scroll p-4 pt-20 sm:p-8 sm:pt-24">
      <div className="max-w-[1200px] w-full mx-auto space-y-6 pb-20">
        
        <div className="flex justify-between items-start bg-white p-8 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden shrink-0">
          <div className="absolute top-0 right-0 w-64 h-full bg-gradient-to-l from-blue-50 to-transparent"></div>
          <div className="flex items-center gap-6 relative z-10">
            <div className="w-24 h-24 bg-gradient-to-br from-[#002864] to-[#1e3a8a] text-white rounded-full flex items-center justify-center text-4xl font-extrabold shadow-lg shrink-0">
              {student.name.substring(1, 3) || "-"}
            </div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">{student.name}</h1>
                <span className={`${student.status === '재원' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'} px-2.5 py-1 rounded text-xs font-black border shadow-sm`}>{student.status}</span>
              </div>
              <p className="text-sm font-bold text-slate-500 mt-1">
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs mr-2">{getEnrolledClassNames()}</span>
                <span>{student.school || ""} {student.grade || ""}</span>
              </p>
              <p className="text-xs font-bold text-slate-400 mt-2 flex items-center gap-2">
                <span>📱 {student.phone || "-"}</span><span className="text-slate-300">|</span><span>👨‍👩‍👧 {unwrap(student.parent)?.phone || "-"}</span>
              </p>
            </div>
          </div>
          <div className="relative z-10 flex gap-3">
            {/* 🌟 [추가] 휴원/퇴원생일 경우 재등록 버튼 활성화 */}
            {(student.status === "휴원" || student.status === "퇴원") && (
              <button onClick={() => setIsReEnrollModalOpen(true)} className="px-5 py-2.5 bg-emerald-600 text-white font-bold rounded-xl shadow-md hover:bg-emerald-700 transition-colors flex items-center gap-2 text-sm animate-pulse">
                🔄 복귀/재등록 처리
              </button>
            )}
            <button onClick={() => setIsEditModalOpen(true)} className="px-5 py-2.5 bg-[#002864] text-white font-bold rounded-xl shadow-md hover:bg-blue-900 transition-colors flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
              정보 수정
            </button>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
          <div className="flex overflow-x-auto border-b border-slate-200 bg-slate-50/50 px-2 pt-2 custom-scroll shrink-0">
            {TABS.map(tab => (
              <button 
                key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                className={`px-6 py-3.5 font-bold text-sm whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.id ? 'text-[#002864] border-[#002864]' : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-100'}`}
              >
                {tab.name}
              </button>
            ))}
          </div>

          <div className="p-8 bg-white flex-1 relative overflow-hidden">
            
            {activeTab === "info" && (
              <div className="space-y-8 animate-[fadeIn_0.3s_ease-out]">
                {/* 1. 학생 기본 정보 */}
                <div>
                  <h3 className="text-base font-extrabold text-slate-800 mb-4 flex items-center gap-2"><span className="w-1.5 h-4 bg-[#0ea5e9] rounded-full"></span>학생 기본 정보</h3>
                  <div className="grid grid-cols-12 gap-6 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <div className="col-span-12 lg:col-span-2"><label className="block text-xs font-bold text-slate-500 mb-1">이름</label><input type="text" value={student.name} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-2"><label className="block text-xs font-bold text-slate-500 mb-1">성별</label><input type="text" value={student.gender || "미입력"} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-blue-700 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-2"><label className="block text-xs font-bold text-slate-500 mb-1">상태</label><input type="text" value={student.status} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-3"><label className="block text-xs font-bold text-slate-500 mb-1">학교</label><input type="text" value={student.school || ""} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-3"><label className="block text-xs font-bold text-slate-500 mb-1">학년</label><input type="text" value={student.grade || ""} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    
                    <div className="col-span-12 lg:col-span-4"><label className="block text-xs font-bold text-slate-500 mb-1">연락처</label><input type="text" value={student.phone || ""} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-8"><label className="block text-xs font-bold text-slate-500 mb-1">현재 배정 클래스</label><input type="text" value={getEnrolledClassNames()} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none truncate" /></div>
                  </div>
                </div>

                {/* 🌟 [추가] 2. 수강 이력 타임라인 */}
                <div>
                  <h3 className="text-base font-extrabold text-slate-800 mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-4 bg-purple-500 rounded-full"></span>수강 이력 타임라인
                  </h3>
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                    {enrollments.length === 0 ? (
                      <div className="text-center text-slate-400 font-bold py-6">수강 이력이 없습니다.</div>
                    ) : (
                      <div className="space-y-4">
                        {enrollments.map((en, idx) => (
                          <div key={en.enrollment_id} className="flex items-center justify-between border-b border-slate-100 last:border-0 pb-4 last:pb-0">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${!en.end_date || en.status === '수강중' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                  {!en.end_date || en.status === '수강중' ? '수강중' : '수강종료'}
                                </span>
                                <span className="font-bold text-slate-800 text-sm">{unwrap(en.class)?.name || '알 수 없는 반'}</span>
                              </div>
                              <div className="text-xs font-bold text-slate-400">
                                {en.start_date} ~ {en.end_date || '현재 진행 중'}
                              </div>
                            </div>
                            {(!en.end_date || en.status === '수강중') && (
                              <button onClick={() => handleEndEnrollment(en.enrollment_id)} className="text-[11px] font-bold text-rose-500 hover:text-rose-700 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100 transition-colors">
                                수강 종료 처리
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. 학부모 정보 */}
                <div>
                  <h3 className="text-base font-extrabold text-slate-800 mb-4 flex items-center gap-2"><span className="w-1.5 h-4 bg-emerald-400 rounded-full"></span>학부모 정보</h3>
                  <div className="grid grid-cols-12 gap-6 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <div className="col-span-12 lg:col-span-4"><label className="block text-xs font-bold text-slate-500 mb-1">학부모 성함</label><input type="text" value={unwrap(student.parent)?.name || "미등록"} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-4"><label className="block text-xs font-bold text-slate-500 mb-1">관계</label><input type="text" value={unwrap(student.parent)?.relationship || "-"} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-4"><label className="block text-xs font-bold text-slate-500 mb-1">연락처</label><input type="text" value={unwrap(student.parent)?.phone || "-"} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "consult" && (
              <div className="space-y-4 animate-[fadeIn_0.3s_ease-out] h-full flex flex-col">
                <div className="flex justify-between items-center mb-2 border-b border-slate-100 pb-4 shrink-0">
                  <h3 className="font-extrabold text-slate-700">상담 타임라인</h3>
                  <button onClick={() => { setSelectedConsultLog(null); setIsConsultModalOpen(true); }} className="px-4 py-2 bg-[#002864] text-white font-bold rounded-lg text-xs shadow-sm hover:bg-blue-900 transition-colors flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg> 새 상담 기록
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scroll space-y-4 pb-10">
                  {consultLogs.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold border border-dashed border-slate-300 rounded-xl bg-slate-50">등록된 상담 기록이 없습니다.</div> : 
                    consultLogs.map((log, idx) => (
                      <div key={log.log_id || log.id || idx} className={`bg-white p-5 rounded-2xl border shadow-sm relative overflow-hidden group ${log.is_admission ? 'border-amber-200' : 'border-slate-200'}`}>
                        <div className={`absolute top-0 left-0 w-1.5 h-full ${log.is_admission ? 'bg-amber-400' : 'bg-indigo-400'}`}></div>
                        <div className="flex justify-between items-start mb-3 pl-2">
                          <div className="flex items-center gap-3">
                            <span className={`text-xs font-black px-2.5 py-1 rounded border ${log.is_admission ? 'bg-amber-100 text-amber-700 border-amber-200' : (log.contact_method === '채널톡' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 'bg-indigo-50 text-indigo-600 border-indigo-100')}`}>{log.contact_method}</span>
                            <span className="font-bold text-slate-800">{log.consultation_type}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-400">{new Date(log.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' })}</span>
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 ml-2">
                              {!log.is_admission && (
                                <>
                                  <button onClick={() => { setSelectedConsultLog(log); setIsConsultModalOpen(true); }} className="text-xs text-slate-400 hover:text-blue-600 font-bold px-2 py-1 rounded bg-slate-50 hover:bg-blue-50 transition-colors">수정</button>
                                  <button onClick={() => deleteConsultLog(log.log_id)} className="text-xs text-slate-400 hover:text-rose-600 font-bold px-2 py-1 rounded bg-slate-50 hover:bg-rose-50 transition-colors">삭제</button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line mb-3 pl-2">{log.content}</p>
                        <div className="text-[11px] font-bold text-slate-400 text-right">기록자: {unwrap(log.instructor)?.name || '알 수 없음'} {log.is_admission ? '' : '선생님'}</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {activeTab === "attend" && (
              <div className="grid grid-cols-12 gap-8 h-full animate-[fadeIn_0.3s_ease-out]">
                <div className="col-span-12 lg:col-span-7 flex flex-col">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-extrabold text-xl text-[#002864]">{calYear}년 {calMonth + 1}월</h3>
                    <div className="flex gap-2">
                      <button onClick={() => { if(calMonth===0){setCalMonth(11); setCalYear(y=>y-1)}else setCalMonth(m=>m-1); setSelectedDate(null); }} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"><svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg></button>
                      <button onClick={() => { if(calMonth===11){setCalMonth(0); setCalYear(y=>y+1)}else setCalMonth(m=>m+1); setSelectedDate(null); }} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"><svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg></button>
                    </div>
                  </div>
                  <div className="flex gap-4 mb-4 text-xs font-bold text-slate-500 justify-end">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#10b981]"></span>출석</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#eab308]"></span>지각</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#f97316]"></span>조퇴</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]"></span>결석</span>
                    </div>
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm max-w-[450px] mx-auto w-full">
                    <div className="grid grid-cols-7 gap-1 text-slate-400 text-xs text-center mb-2 font-bold">
                      <div>일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div>토</div>
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {calendarDays}
                    </div>
                  </div>
                </div>

                <div className="col-span-12 lg:col-span-5">
                  <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 h-full flex flex-col shadow-inner min-h-[400px]">
                    {selectedDate ? (
                      <div className="flex flex-col h-full">
                        <h3 className="font-extrabold text-slate-700 text-lg mb-6 pb-4 border-b border-slate-200">{selectedDate.split('-')[0]}년 {parseInt(selectedDate.split('-')[1])}월 {parseInt(selectedDate.split('-')[2])}일 출결</h3>
                        <div className="space-y-5 flex-1">
                          
                          {allowedActions.includes('action_edit_attend') ? (
                            <>
                              <div>
                                <label className="block text-sm font-bold text-slate-600 mb-2">출결 상태</label>
                                <select value={attendForm.status} onChange={e => setAttendForm({...attendForm, status: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-4 py-3 font-bold text-slate-800 focus:border-[#002864] focus:outline-none focus:ring-2 focus:ring-blue-100">
                                  <option value="출석">🟢 출석</option><option value="지각">🟡 지각</option><option value="조퇴">🟠 조퇴</option><option value="결석">🔴 결석</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-sm font-bold text-slate-600 mb-2">지각/조퇴 시간 (분)</label>
                                <div className="flex items-center gap-2">
                                  <input type="number" min="0" value={attendForm.lateMin} onChange={e => setAttendForm({...attendForm, lateMin: parseInt(e.target.value)||0})} className="w-full bg-white border border-slate-300 rounded-lg px-4 py-3 font-bold text-slate-800 focus:border-[#002864] focus:outline-none" />
                                  <span className="font-bold text-slate-500">분</span>
                                </div>
                              </div>
                              <div>
                                <label className="block text-sm font-bold text-slate-600 mb-2">비고 (선생님 메모)</label>
                                <textarea rows={3} value={attendForm.remark} onChange={e => setAttendForm({...attendForm, remark: e.target.value})} placeholder="예: 병원 진료 후 늦게 등원함" className="w-full bg-white border border-slate-300 rounded-lg px-4 py-3 text-sm focus:border-[#002864] focus:outline-none resize-none"></textarea>
                              </div>
                            </>
                          ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold text-sm text-center pt-10">
                              <svg className="w-10 h-10 text-slate-300 mb-3 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                              출결 기록을 수정할 권한이 없습니다.<br/>열람만 가능합니다.
                            </div>
                          )}
                        </div>
                        
                        {allowedActions.includes('action_edit_attend') && (
                          <div className="mt-4 shrink-0">
                            <button onClick={saveAttendance} className="w-full py-3.5 bg-[#002864] text-white font-bold rounded-xl shadow-md hover:bg-blue-900 transition-colors text-sm">기록 저장하기</button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold text-sm text-center pt-20">
                        <svg className="w-12 h-12 text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        좌측 달력에서 날짜를 클릭하면<br/>출결 기록을 열람 및 수정할 수 있습니다.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "hw" && (
              <div className="space-y-4 animate-[fadeIn_0.3s_ease-out]">
                <h3 className="font-extrabold text-slate-700 mb-4">제출 및 채점 현황</h3>
                <div className="space-y-3">
                  {hwList.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold text-sm bg-slate-50 border border-dashed border-slate-300 rounded-xl">배부된 과제가 없습니다.</div> :
                    hwList.map((hw, idx) => {
                      const assign = unwrap(hw.homework_assignment);
                      if (!assign) return null;
                      const qCount = assign.target_questions ? (typeof assign.target_questions === 'string' ? JSON.parse(assign.target_questions).length : assign.target_questions.length) : 0;
                      return (
                        <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 flex justify-between items-center shadow-sm">
                          <div>
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold mb-1 inline-block">{unwrap(assign.textbook)?.title || '기타 교재'}</span>
                            <h4 className="font-bold text-slate-800 text-sm">{assign.homework_title}</h4>
                          </div>
                          <div className="text-right">
                            <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">{hw.status}</span>
                            <p className="text-[10px] text-slate-400 mt-1">총 {qCount}문항</p>
                          </div>
                        </div>
                      );
                    })
                  }
                </div>
              </div>
            )}

            {activeTab === "exam" && (
              <div className="space-y-8 animate-[fadeIn_0.3s_ease-out]">
                <div>
                  <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2">
                    <h3 className="font-extrabold text-slate-700 flex items-center gap-2">
                      <span className="w-1.5 h-4 bg-indigo-500 rounded-full"></span>학교 내신 성적
                    </h3>
                    <button 
                      onClick={() => setIsSchoolExamModalOpen(true)} 
                      className="px-3 py-1.5 bg-indigo-50 text-indigo-600 font-bold rounded-lg text-xs hover:bg-indigo-100 transition-colors shadow-sm"
                    >
                      + 성적 추가
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {schoolExams.length === 0 ? (
                      <div className="col-span-full text-center py-6 text-slate-400 font-bold text-sm bg-slate-50 border border-dashed border-slate-300 rounded-xl">등록된 학교 성적이 없습니다.</div>
                    ) : (
                      schoolExams.map((se, idx) => (
                        <div key={se.id || idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative group hover:border-indigo-300 transition-colors">
                          <button 
                            onClick={() => deleteSchoolExam(se.id)} 
                            className="absolute top-2 right-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded-full w-6 h-6 flex items-center justify-center shadow-sm border border-slate-100"
                            title="삭제"
                          >
                            ✕
                          </button>
                          <div className="text-[10px] font-bold text-slate-400 mb-1">{se.year}년 {se.semester}학기 {se.exam_type}</div>
                          <div className="flex justify-between items-end">
                            <div className="font-black text-slate-700">{se.subject}</div>
                            <div className="text-lg font-black text-indigo-600">{se.score}점</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2">
                    <h3 className="font-extrabold text-slate-700 flex items-center gap-2">
                      <span className="w-1.5 h-4 bg-emerald-500 rounded-full"></span>학원 자체 테스트 결과
                    </h3>
                  </div>
                  <div className="space-y-3">
                    {examList.length === 0 ? (
                      <div className="text-center py-10 text-slate-400 font-bold text-sm bg-slate-50 border border-dashed border-slate-300 rounded-xl">시험 기록이 없습니다.</div>
                    ) : (
                      examList.map((ex, idx) => (
                        <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 flex justify-between items-center shadow-sm">
                          <div><h4 className="font-bold text-slate-800 text-sm">{unwrap(ex.exam_master)?.title}</h4></div>
                          <div className="text-right flex items-center gap-3">
                            <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">{ex.test_status}</span>
                            <span className="font-black text-slate-700 w-12 text-right">{ex.total_score !== null ? `${ex.total_score}점` : '-'}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            )}

            {activeTab === "clinic" && (
              <div className="space-y-4 animate-[fadeIn_0.3s_ease-out]">
                <h3 className="font-extrabold text-slate-700 mb-4">누적 오답 및 유사 문제 배부 내역</h3>
                <div className="space-y-3">
                  {clinicList.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold text-sm bg-slate-50 border border-dashed border-slate-300 rounded-xl">클리닉/오답 배부 내역이 없습니다.</div> :
                    clinicList.map((c, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 flex justify-between items-center shadow-sm">
                        <div>
                          <span className="text-[10px] bg-rose-50 text-rose-500 border border-rose-100 px-2 py-0.5 rounded font-bold mb-1 inline-block">{c.task_type}</span>
                          <h4 className="font-bold text-slate-800 text-sm">연결 문항 번호: {unwrap(c.textbook_question)?.question_number || '-'}</h4>
                        </div>
                        <div className="text-right"><span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded">{c.status}</span></div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

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
                    <h3 className="font-extrabold text-slate-700">월별 수납 및 청구 내역</h3>
                    <button onClick={() => setIsBillingModalOpen(true)} className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg text-xs shadow-sm hover:bg-emerald-700 transition-colors flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg> 수동 청구서 발행
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col items-center justify-center">
                      <span className="text-xs font-bold text-slate-500 mb-1">총 청구 금액</span><span className="text-lg font-black text-slate-800">{total.toLocaleString()}원</span>
                    </div>
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 shadow-sm flex flex-col items-center justify-center">
                      <span className="text-xs font-bold text-rose-500 mb-1">미납 금액</span><span className="text-lg font-black text-rose-600">{unpaid.toLocaleString()}원</span>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-sm flex flex-col items-center justify-center">
                      <span className="text-xs font-bold text-emerald-600 mb-1">납부 완료 금액</span><span className="text-lg font-black text-emerald-700">{paid.toLocaleString()}원</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {billingList.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold border border-dashed border-slate-300 rounded-xl bg-slate-50">청구 내역이 없습니다.</div> :
                      billingList.map((bill, idx) => (
                        <div key={bill.billing_id || bill.id || idx} className={`bg-white p-4 rounded-xl border ${bill.status === '완납' ? 'border-slate-200' : 'border-rose-300'} shadow-sm flex items-center justify-between hover:bg-slate-50 transition-colors`}>
                          <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-xl bg-slate-100 flex flex-col items-center justify-center border border-slate-200 shrink-0 shadow-inner">
                              <span className="text-[10px] text-slate-500 font-bold">{bill.billing_month.split('-')[0]}년</span>
                              <span className="text-base font-black text-slate-700">{bill.billing_month.split('-')[1]}월</span>
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                {bill.status === "완납" ? <span className="bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded text-[11px] font-black border border-emerald-200">✅ 완납</span> : <span className="bg-rose-100 text-rose-600 px-2.5 py-1 rounded text-[11px] font-black border border-rose-200">🔴 미납</span>}
                                <span className="text-sm font-extrabold text-[#002864]">{unwrap(bill.class)?.name || '미배정'}</span>
                              </div>
                              <div className="text-xs font-bold text-slate-400">납부 기한: {bill.due_date}까지</div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span className="text-xl font-black text-slate-800">{parseInt(bill.amount).toLocaleString()}원</span>
                            {bill.status === "완납" ? <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded border border-emerald-100">결제완료</span> : <button onClick={() => { setPayFormInit({ billingId: bill.billing_id, amount: parseInt(bill.amount), method: "계좌이체" }); setIsPaymentModalOpen(true); }} className="px-4 py-1.5 bg-[#002864] text-white text-xs font-bold rounded-lg hover:bg-blue-900 transition-colors shadow-sm">수납 처리</button>}
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

      {/* 학교 성적 모달 */}
      {isSchoolExamModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-indigo-600 p-4 flex justify-between items-center text-white shrink-0">
              <h2 className="font-bold text-lg flex items-center gap-2">🏫 학교 성적 등록</h2>
              <button onClick={() => setIsSchoolExamModalOpen(false)} className="text-indigo-200 hover:text-white font-bold text-2xl leading-none">&times;</button>
            </div>
            
            <form onSubmit={handleSaveSchoolExam} className="p-6 bg-slate-50 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">연도</label>
                  <input type="number" value={schoolExamForm.year} onChange={(e) => setSchoolExamForm({...schoolExamForm, year: parseInt(e.target.value)})} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">학기</label>
                  <select value={schoolExamForm.semester} onChange={(e) => setSchoolExamForm({...schoolExamForm, semester: parseInt(e.target.value)})} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white">
                    <option value={1}>1학기</option>
                    <option value={2}>2학기</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">고사</label>
                  <select value={schoolExamForm.examType} onChange={(e) => setSchoolExamForm({...schoolExamForm, examType: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white">
                    <option value="중간고사">중간고사</option>
                    <option value="기말고사">기말고사</option>
                    <option value="수행평가">수행평가</option>
                    <option value="모의고사">모의고사</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">과목</label>
                  <select value={schoolExamForm.subject} onChange={(e) => setSchoolExamForm({...schoolExamForm, subject: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white">
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
                <label className="block text-xs font-bold text-slate-500 mb-1">취득 점수</label>
                <div className="relative">
                  <input 
                    type="number" 
                    step="0.1"
                    required
                    value={schoolExamForm.score} 
                    onChange={(e) => setSchoolExamForm({...schoolExamForm, score: e.target.value})} 
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 font-black text-indigo-700 text-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" 
                    placeholder="예: 95.5" 
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">점</span>
                </div>
              </div>

              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setIsSchoolExamModalOpen(false)} className="flex-1 py-3 bg-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-300 transition-colors text-sm">취소</button>
                <button type="submit" disabled={isSavingSchoolExam} className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm text-sm">
                  {isSavingSchoolExam ? "저장 중..." : "성적 등록하기"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🌟 [추가] 재등록 모달 */}
      {isReEnrollModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-emerald-600 p-4 flex justify-between items-center text-white shrink-0">
              <h2 className="font-bold text-lg flex items-center gap-2">🔄 학생 재원(재등록) 처리</h2>
              <button onClick={() => setIsReEnrollModalOpen(false)} className="text-emerald-200 hover:text-white font-bold text-2xl leading-none">&times;</button>
            </div>
            
            <form onSubmit={handleReEnroll} className="p-6 bg-slate-50 flex flex-col gap-4">
              <div className="text-sm font-bold text-slate-600 mb-2 leading-relaxed">
                <span className="text-emerald-600">[{student.name}]</span> 학생을 다시 재원생으로 전환하고 새로운 반에 배정합니다.
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">배정할 수강 반 <span className="text-rose-500">*</span></label>
                <select 
                  required
                  value={reEnrollForm.classId} 
                  onChange={(e) => setReEnrollForm({...reEnrollForm, classId: e.target.value})} 
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 font-bold text-slate-700 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-white"
                >
                  <option value="" disabled>반을 선택해주세요</option>
                  {allClasses.map(c => (
                    <option key={c.class_id} value={c.class_id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">수강 시작일 (재등록일) <span className="text-rose-500">*</span></label>
                <input 
                  type="date" 
                  required
                  value={reEnrollForm.startDate} 
                  onChange={(e) => setReEnrollForm({...reEnrollForm, startDate: e.target.value})} 
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 font-bold text-slate-700 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-white" 
                />
              </div>

              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => setIsReEnrollModalOpen(false)} className="flex-1 py-3 bg-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-300 transition-colors text-sm">취소</button>
                <button type="submit" disabled={isSubmittingReEnroll} className="flex-1 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm text-sm">
                  {isSubmittingReEnroll ? "처리 중..." : "재등록 완료하기"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}