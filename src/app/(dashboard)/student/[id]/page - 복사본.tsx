// src/app/(dashboard)/student/[id]/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function StudentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.id as string;

  const [instId, setInstId] = useState("");
  const [instName, setInstName] = useState("");

  // === 탭 관리 ===
  const [activeTab, setActiveTab] = useState<"info" | "consult" | "attend" | "hw" | "exam" | "clinic" | "billing">("info");

  // === 핵심 데이터 상태 ===
  const [student, setStudent] = useState<any>(null);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [allClasses, setAllClasses] = useState<any[]>([]);
  
  // === 각 탭별 리스트 데이터 ===
  const [consultLogs, setConsultLogs] = useState<any[]>([]);
  const [attendances, setAttendances] = useState<any[]>([]);
  const [hwList, setHwList] = useState<any[]>([]);
  const [examList, setExamList] = useState<any[]>([]);
  const [clinicList, setClinicList] = useState<any[]>([]);
  const [billingList, setBillingList] = useState<any[]>([]);

  // === 모달 상태 ===
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isConsultModalOpen, setIsConsultModalOpen] = useState(false);
  const [isBillingModalOpen, setIsBillingModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  // === 폼 상태 (수정) ===
  const [editForm, setEditForm] = useState({
    name: "", status: "재원", school: "", grade: "", phone: "",
    parentId: "", parentName: "", parentRel: "", parentPhone: "", newClassId: ""
  });

  // === 폼 상태 (상담) ===
  const [consultForm, setConsultForm] = useState({ logId: null as any, type: "재원상담", method: "전화", content: "" });

  // === 폼 상태 (출결/달력) ===
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [attendForm, setAttendForm] = useState({ id: "", status: "출석", lateMin: 0, remark: "" });

  // === 폼 상태 (청구 및 수납) ===
  const [billForm, setBillForm] = useState({ month: "", dueDate: "", classId: "", amount: "" });
  const [payForm, setPayForm] = useState({ billingId: "", amount: 0, method: "계좌이체" });

  useEffect(() => {
    if (typeof window !== "undefined") {
      setInstId(localStorage.getItem("logica_instructor_id") || "");
      setInstName(localStorage.getItem("logica_instructor_name") || "시스템");
    }
    if (studentId) {
      loadInitialData();
      loadClasses();
    }
  }, [studentId]);

  // 탭 변경 시 데이터 로드
  useEffect(() => {
    if (activeTab === "consult") loadConsultLogs();
    if (activeTab === "attend") loadAttendance();
    if (activeTab === "billing") loadBillings();
  }, [activeTab, calYear, calMonth]);


  // 연락처 자동 하이픈 함수
  const formatPhone = (val: string) => {
    let v = val.replace(/[^0-9]/g, '');
    if (v.length > 3 && v.length <= 7) return v.replace(/(\d{3})(\d+)/, '$1-$2');
    if (v.length > 7) return v.replace(/(\d{3})(\d{4})(\d+)/, '$1-$2-$3');
    return v;
  };

  // ==========================================
  // [1] 데이터 로드 (기본 정보, 반, 각종 리스트)
  // ==========================================
  const loadInitialData = async () => {
    try {
      // 1. 학생 기본 정보
      const { data: stuData } = await supabase.from("student").select("*, parent(*)").eq("student_id", studentId).single();
      setStudent(stuData);

      // 2. 수강 이력
      const { data: enrollData } = await supabase.from("enrollment").select("enrollment_id, class_id, class(name)").eq("student_id", studentId);
      setEnrollments(enrollData || []);

      // 3. 서브 탭 데이터들 (과제, 시험, 클리닉)
      const { data: hwData } = await supabase.from("student_homework_result").select("status, homework_assignment(homework_title, target_questions, textbook(title))").eq("student_id", studentId);
      setHwList(hwData || []);

      const { data: exData } = await supabase.from("exam_assignment").select("test_status, total_score, exam_master(title)").eq("student_id", studentId);
      setExamList(exData || []);

      const { data: clData } = await supabase.from("clinic_task").select("*, textbook_question(question_number)").eq("student_id", studentId);
      setClinicList(clData || []);

    } catch (error) { console.error("로딩 에러:", error); }
  };

  const loadClasses = async () => {
    const { data } = await supabase.from("class").select("class_id, name, level_name, tuition_fee").order("name");
    setAllClasses(data || []);
  };

  const loadConsultLogs = async () => {
    const { data } = await supabase.from("consultation_log").select("*, instructor(name)").eq("student_id", studentId).order("created_at", { ascending: false });
    setConsultLogs(data || []);
  };

  const loadAttendance = async () => {
    const startDate = new Date(calYear, calMonth, 1).toISOString().split('T')[0];
    const endDate = new Date(calYear, calMonth + 1, 0).toISOString().split('T')[0];
    const { data } = await supabase.from("attendance").select("*").eq("student_id", studentId).gte("attendance_date", startDate).lte("attendance_date", endDate);
    setAttendances(data || []);
  };

  const loadBillings = async () => {
    const { data } = await supabase.from("academy_billing").select("*, class(name)").eq("student_id", studentId).order("billing_month", { ascending: false });
    setBillingList(data || []);
  };

  // ==========================================
  // [2] 학생 정보 수정 및 배정 로직
  // ==========================================
  const openEditModal = () => {
    setEditForm({
      name: student?.name || "", status: student?.status || "재원", school: student?.school || "", grade: student?.grade || "", phone: student?.phone || "",
      parentId: student?.parent?.parent_id || "", parentName: student?.parent?.name || "", parentRel: student?.parent?.relationship || "", parentPhone: student?.parent?.phone || "", newClassId: ""
    });
    setIsEditModalOpen(true);
  };

  const submitEditStudent = async () => {
    try {
      let finalParentId = editForm.parentId;

      // 학부모 정보 신규 생성 또는 업데이트
      if (!finalParentId && (editForm.parentName || editForm.parentPhone)) {
        const { data: newParent } = await supabase.from("parent").insert({ name: editForm.parentName, relationship: editForm.parentRel, phone: editForm.parentPhone }).select().single();
        if (newParent) finalParentId = newParent.parent_id;
      } else if (finalParentId) {
        await supabase.from("parent").update({ name: editForm.parentName, relationship: editForm.parentRel, phone: editForm.parentPhone }).eq("parent_id", finalParentId);
      }

      // 학생 정보 업데이트 (class_id는 enrollment 테이블로 관리하므로 제거)
      const updates: any = { name: editForm.name, status: editForm.status, school: editForm.school, grade: editForm.grade, phone: editForm.phone };
      if (finalParentId) updates.parent_id = finalParentId;

      await supabase.from("student").update(updates).eq("student_id", studentId);
      alert("학생 정보가 수정되었습니다.");
      setIsEditModalOpen(false);
      loadInitialData();
    } catch (e: any) { alert("저장 실패: " + e.message); }
  };

  const addEnrollment = async () => {
    if (!editForm.newClassId) return alert("추가할 수강반을 선택해주세요.");
    const existing = enrollments.find(e => e.class_id.toString() === editForm.newClassId);
    if (existing) return alert("이미 해당 수강반에 배정되어 있습니다.");

    try {
      await supabase.from("enrollment").insert({ student_id: studentId, class_id: editForm.newClassId, start_date: new Date().toISOString().split('T')[0], status: "예약" });
      alert("수강반 배정이 추가되었습니다.");
      loadInitialData();
    } catch (e) { alert("추가 실패"); }
  };

  const removeEnrollment = async (enrollId: string) => {
    if (!confirm("해당 학생을 이 수강반에서 제외하시겠습니까?")) return;
    await supabase.from("enrollment").delete().eq("enrollment_id", enrollId);
    loadInitialData();
  };

  const deleteStudentData = async () => {
    if (!confirm("⚠️ 경고: 학생의 기본 정보뿐만 아니라 모든 기록이 완전히 삭제되며 복구할 수 없습니다.\n\n정말 삭제하시겠습니까?")) return;
    try {
      await Promise.all([
        supabase.from('student_homework_result').delete().eq('student_id', studentId),
        supabase.from('student_exam_result').delete().eq('student_id', studentId),
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

  // ==========================================
  // [3] 상담 기록 로직
  // ==========================================
  const openConsultNew = () => {
    setConsultForm({ logId: null, type: "재원상담", method: "전화", content: "" });
    setIsConsultModalOpen(true);
  };

  const openConsultEdit = (log: any) => {
    setConsultForm({ logId: log.log_id, type: log.consultation_type, method: log.contact_method, content: log.content });
    setIsConsultModalOpen(true);
  };

  const submitConsultLog = async () => {
    if (!consultForm.content.trim()) return alert("상담 내용을 입력해주세요.");
    try {
      if (consultForm.logId) {
        await supabase.from("consultation_log").update({ consultation_type: consultForm.type, contact_method: consultForm.method, content: consultForm.content }).eq("log_id", consultForm.logId);
      } else {
        await supabase.from("consultation_log").insert({ student_id: studentId, instructor_id: instId, consultation_type: consultForm.type, contact_method: consultForm.method, content: consultForm.content });
      }
      setIsConsultModalOpen(false);
      loadConsultLogs();
    } catch (e) { alert("상담 기록 저장 실패"); }
  };

  const deleteConsultLog = async (logId: string) => {
    if (!confirm("이 기록을 삭제하시겠습니까?")) return;
    await supabase.from("consultation_log").delete().eq("log_id", logId);
    loadConsultLogs();
  };

  // ==========================================
  // [4] 출결 달력 및 폼 로직
  // ==========================================
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

  // ==========================================
  // [5] 청구 및 수납 로직
  // ==========================================
  const openNewBilling = () => {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    setBillForm({
      month: `${now.getFullYear()}-${String(now.getMonth()+2).padStart(2,'0')}`,
      dueDate: nextMonth.toISOString().split('T')[0],
      classId: "", amount: ""
    });
    setIsBillingModalOpen(true);
  };

  const submitBilling = async () => {
    if (!billForm.month || !billForm.dueDate || !billForm.classId || !billForm.amount) return alert("모든 항목을 입력해주세요.");
    try {
      await supabase.from("academy_billing").insert({
        student_id: studentId, class_id: billForm.classId, billing_month: billForm.month, amount: parseInt(billForm.amount), due_date: billForm.dueDate, status: "미납"
      });
      setIsBillingModalOpen(false);
      loadBillings();
    } catch (e) { alert("청구 발행 실패"); }
  };

  const submitPayment = async () => {
    try {
      await supabase.from("academy_billing").update({ status: "완납" }).eq("billing_id", payForm.billingId);
      await supabase.from("payment_history").insert({
        billing_id: payForm.billingId, payment_method: payForm.method, paid_amount: payForm.amount, transaction_key: `MANUAL_PAY_${Date.now()}`
      });
      setIsPaymentModalOpen(false);
      loadBillings();
    } catch (e) { alert("수납 처리 실패"); }
  };

  // ==========================================
  // 렌더링 헬퍼 함수들
  // ==========================================
  const getEnrolledClassNames = () => {
    return enrollments.length > 0 ? enrollments.map(e => e.class?.name).join(", ") : "미배정";
  };

  const renderCalendar = () => {
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
  };

  if (!student) return <div className="p-10 text-center font-bold text-slate-500">데이터를 불러오는 중입니다...</div>;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-50 h-full relative overflow-y-auto custom-scroll p-4 sm:p-8">
      <div className="max-w-[1200px] w-full mx-auto space-y-6 pb-20">
        
        {/* 상단 프로필 헤더 */}
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
                <span>📱 {student.phone || "-"}</span><span className="text-slate-300">|</span><span>👨‍👩‍👧 {student.parent?.phone || "-"}</span>
              </p>
            </div>
          </div>
          <div className="relative z-10 flex gap-3">
            <button onClick={openEditModal} className="px-5 py-2.5 bg-white border border-slate-300 text-slate-600 font-bold rounded-xl shadow-sm hover:bg-slate-50 transition-colors flex items-center gap-2 text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
              정보 수정
            </button>
          </div>
        </div>

        {/* 탭 네비게이션 & 콘텐츠 컨테이너 */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
          <div className="flex overflow-x-auto border-b border-slate-200 bg-slate-50/50 px-2 pt-2 custom-scroll shrink-0">
            {[
              { id: 'info', name: '학생 상세 정보 및 수강반' }, { id: 'consult', name: '상담 기록' }, { id: 'attend', name: '출결 기록' },
              { id: 'hw', name: '과제 현황' }, { id: 'exam', name: '시험 성적' }, { id: 'clinic', name: '클리닉 분석' }, { id: 'billing', name: '수납/청구' }
            ].map(tab => (
              <button 
                key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                className={`px-6 py-3.5 font-bold text-sm whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.id ? 'text-[#002864] border-[#002864]' : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-100'}`}
              >
                {tab.name}
              </button>
            ))}
          </div>

          <div className="p-8 bg-white flex-1 relative overflow-hidden">
            
            {/* 탭 1: 상세 정보 */}
            {activeTab === "info" && (
              <div className="space-y-8 animate-[fadeIn_0.3s_ease-out]">
                <div>
                  <h3 className="text-base font-extrabold text-slate-800 mb-4 flex items-center gap-2"><span className="w-1.5 h-4 bg-[#0ea5e9] rounded-full"></span>학생 기본 정보</h3>
                  <div className="grid grid-cols-12 gap-6 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <div className="col-span-12 lg:col-span-3"><label className="block text-xs font-bold text-slate-500 mb-1">이름</label><input type="text" value={student.name} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-3"><label className="block text-xs font-bold text-slate-500 mb-1">상태</label><input type="text" value={student.status} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-3"><label className="block text-xs font-bold text-slate-500 mb-1">학교</label><input type="text" value={student.school || ""} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-3"><label className="block text-xs font-bold text-slate-500 mb-1">학년</label><input type="text" value={student.grade || ""} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-3"><label className="block text-xs font-bold text-slate-500 mb-1">연락처</label><input type="text" value={student.phone || ""} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-3"><label className="block text-xs font-bold text-slate-500 mb-1">배정 클래스</label><input type="text" value={getEnrolledClassNames()} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none truncate" /></div>
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-800 mb-4 flex items-center gap-2"><span className="w-1.5 h-4 bg-emerald-400 rounded-full"></span>학부모 정보</h3>
                  <div className="grid grid-cols-12 gap-6 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <div className="col-span-12 lg:col-span-4"><label className="block text-xs font-bold text-slate-500 mb-1">학부모 성함</label><input type="text" value={student.parent?.name || "미등록"} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-4"><label className="block text-xs font-bold text-slate-500 mb-1">관계</label><input type="text" value={student.parent?.relationship || "-"} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                    <div className="col-span-12 lg:col-span-4"><label className="block text-xs font-bold text-slate-500 mb-1">연락처</label><input type="text" value={student.parent?.phone || "-"} readOnly className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 font-bold text-slate-800 focus:outline-none" /></div>
                  </div>
                </div>
              </div>
            )}

            {/* 탭 2: 상담 기록 */}
            {activeTab === "consult" && (
              <div className="space-y-4 animate-[fadeIn_0.3s_ease-out] h-full flex flex-col">
                <div className="flex justify-between items-center mb-2 border-b border-slate-100 pb-4 shrink-0">
                  <h3 className="font-extrabold text-slate-700">상담 타임라인</h3>
                  <button onClick={openConsultNew} className="px-4 py-2 bg-[#002864] text-white font-bold rounded-lg text-xs shadow-sm hover:bg-blue-900 transition-colors flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg> 새 상담 기록
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scroll space-y-4 pb-10">
                  {consultLogs.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold border border-dashed border-slate-300 rounded-xl bg-slate-50">등록된 상담 기록이 없습니다.</div> : 
                    consultLogs.map(log => (
                      <div key={log.log_id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-400"></div>
                        <div className="flex justify-between items-start mb-3 pl-2">
                          <div className="flex items-center gap-3">
                            <span className={`text-xs font-black px-2.5 py-1 rounded border ${log.contact_method === '채널톡' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>{log.contact_method}</span>
                            <span className="font-bold text-slate-800">{log.consultation_type}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-400">{new Date(log.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' })}</span>
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 ml-2">
                              <button onClick={() => openConsultEdit(log)} className="text-xs text-slate-400 hover:text-blue-600 font-bold px-2 py-1 rounded bg-slate-50 hover:bg-blue-50 transition-colors">수정</button>
                              <button onClick={() => deleteConsultLog(log.log_id)} className="text-xs text-slate-400 hover:text-rose-600 font-bold px-2 py-1 rounded bg-slate-50 hover:bg-rose-50 transition-colors">삭제</button>
                            </div>
                          </div>
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line mb-3 pl-2">{log.content}</p>
                        <div className="text-[11px] font-bold text-slate-400 text-right">기록자: {log.instructor?.name || '알 수 없음'} 선생님</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* 탭 3: 출결 기록 */}
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
                      {renderCalendar()}
                    </div>
                  </div>
                </div>

                <div className="col-span-12 lg:col-span-5">
                  <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 h-full flex flex-col shadow-inner min-h-[400px]">
                    {selectedDate ? (
                      <div className="flex flex-col h-full">
                        <h3 className="font-extrabold text-slate-700 text-lg mb-6 pb-4 border-b border-slate-200">{selectedDate.split('-')[0]}년 {parseInt(selectedDate.split('-')[1])}월 {parseInt(selectedDate.split('-')[2])}일 출결</h3>
                        <div className="space-y-5 flex-1">
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
                        </div>
                        <div className="mt-4 shrink-0">
                          <button onClick={saveAttendance} className="w-full py-3.5 bg-[#002864] text-white font-bold rounded-xl shadow-md hover:bg-blue-900 transition-colors text-sm">기록 저장하기</button>
                        </div>
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

            {/* 탭 4: 과제 현황 */}
            {activeTab === "hw" && (
              <div className="space-y-4 animate-[fadeIn_0.3s_ease-out]">
                <h3 className="font-extrabold text-slate-700 mb-4">제출 및 채점 현황</h3>
                <div className="space-y-3">
                  {hwList.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold text-sm bg-slate-50 border border-dashed border-slate-300 rounded-xl">배부된 과제가 없습니다.</div> :
                    hwList.map((hw, idx) => {
                      const assign = hw.homework_assignment;
                      if (!assign) return null;
                      const qCount = assign.target_questions ? (typeof assign.target_questions === 'string' ? JSON.parse(assign.target_questions).length : assign.target_questions.length) : 0;
                      return (
                        <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 flex justify-between items-center shadow-sm">
                          <div>
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold mb-1 inline-block">{assign.textbook?.title || '기타 교재'}</span>
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

            {/* 탭 5: 시험 성적 */}
            {activeTab === "exam" && (
              <div className="space-y-4 animate-[fadeIn_0.3s_ease-out]">
                <h3 className="font-extrabold text-slate-700 mb-4">테스트 결과</h3>
                <div className="space-y-3">
                  {examList.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold text-sm bg-slate-50 border border-dashed border-slate-300 rounded-xl">시험 기록이 없습니다.</div> :
                    examList.map((ex, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 flex justify-between items-center shadow-sm">
                        <div><h4 className="font-bold text-slate-800 text-sm">{ex.exam_master?.title}</h4></div>
                        <div className="text-right flex items-center gap-3">
                          <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">{ex.test_status}</span>
                          <span className="font-black text-slate-700 w-12 text-right">{ex.total_score !== null ? `${ex.total_score}점` : '-'}</span>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* 탭 6: 클리닉 분석 */}
            {activeTab === "clinic" && (
              <div className="space-y-4 animate-[fadeIn_0.3s_ease-out]">
                <h3 className="font-extrabold text-slate-700 mb-4">누적 오답 및 유사 문제 배부 내역</h3>
                <div className="space-y-3">
                  {clinicList.length === 0 ? <div className="text-center py-10 text-slate-400 font-bold text-sm bg-slate-50 border border-dashed border-slate-300 rounded-xl">클리닉/오답 배부 내역이 없습니다.</div> :
                    clinicList.map((c, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 flex justify-between items-center shadow-sm">
                        <div>
                          <span className="text-[10px] bg-rose-50 text-rose-500 border border-rose-100 px-2 py-0.5 rounded font-bold mb-1 inline-block">{c.task_type}</span>
                          <h4 className="font-bold text-slate-800 text-sm">연결 문항 번호: {c.textbook_question?.question_number || '-'}</h4>
                        </div>
                        <div className="text-right"><span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded">{c.status}</span></div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* 탭 7: 수납/청구 */}
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
                    <button onClick={openNewBilling} className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg text-xs shadow-sm hover:bg-emerald-700 transition-colors flex items-center gap-1">
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
                      billingList.map(bill => (
                        <div key={bill.billing_id} className={`bg-white p-4 rounded-xl border ${bill.status === '완납' ? 'border-slate-200' : 'border-rose-300'} shadow-sm flex items-center justify-between hover:bg-slate-50 transition-colors`}>
                          <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-xl bg-slate-100 flex flex-col items-center justify-center border border-slate-200 shrink-0 shadow-inner">
                              <span className="text-[10px] text-slate-500 font-bold">{bill.billing_month.split('-')[0]}년</span>
                              <span className="text-base font-black text-slate-700">{bill.billing_month.split('-')[1]}월</span>
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                {bill.status === "완납" ? <span className="bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded text-[11px] font-black border border-emerald-200">✅ 완납</span> : <span className="bg-rose-100 text-rose-600 px-2.5 py-1 rounded text-[11px] font-black border border-rose-200">🔴 미납</span>}
                                <span className="text-sm font-extrabold text-[#002864]">{bill.class?.name || '미배정'}</span>
                              </div>
                              <div className="text-xs font-bold text-slate-400">납부 기한: {bill.due_date}까지</div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span className="text-xl font-black text-slate-800">{parseInt(bill.amount).toLocaleString()}원</span>
                            {bill.status === "완납" ? <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded border border-emerald-100">결제완료</span> : <button onClick={() => { setPayForm({ billingId: bill.billing_id, amount: parseInt(bill.amount), method: "계좌이체" }); setIsPaymentModalOpen(true); }} className="px-4 py-1.5 bg-[#002864] text-white text-xs font-bold rounded-lg hover:bg-blue-900 transition-colors shadow-sm">수납 처리</button>}
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
        
        {/* 위험: 삭제 버튼 */}
        <div className="flex justify-end pt-4">
          <button onClick={deleteStudentData} className="text-xs font-bold text-rose-400 hover:text-rose-600 underline px-2 py-1">데이터 완전 삭제 (위험)</button>
        </div>
      </div>

      {/* ========================================== */}
      {/* 팝업 모달들 */}
      {/* ========================================== */}
      
      {/* 학생 정보 수정 모달 */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-[#002864] p-5 text-white flex justify-between items-center shrink-0 rounded-t-2xl">
              <h3 className="text-lg font-extrabold">학생 정보 수정</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-white hover:text-rose-400 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            </div>
            <div className="p-6 overflow-y-auto custom-scroll flex-1 space-y-6 bg-slate-50">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h4 className="font-bold text-sm text-[#0ea5e9] mb-4 border-b border-slate-100 pb-2">기본 정보</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">이름</label><input type="text" value={editForm.name} onChange={e=>setEditForm({...editForm, name: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]" /></div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">상태</label>
                    <select value={editForm.status} onChange={e=>setEditForm({...editForm, status: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]">
                      <option value="재원">재원</option><option value="휴원">휴원</option><option value="퇴원">퇴원</option><option value="입학테스트">입학테스트</option>
                    </select>
                  </div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">학교</label><input type="text" value={editForm.school} onChange={e=>setEditForm({...editForm, school: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]" /></div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">학년</label>
                    <select value={editForm.grade} onChange={e=>setEditForm({...editForm, grade: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]">
                      <option value="초1">초1</option><option value="초2">초2</option><option value="초3">초3</option><option value="초4">초4</option><option value="초5">초5</option><option value="초6">초6</option>
                      <option value="중1">중1</option><option value="중2">중2</option><option value="중3">중3</option>
                      <option value="고1">고1</option><option value="고2">고2</option><option value="고3">고3</option>
                    </select>
                  </div>
                  <div className="col-span-2"><label className="block text-xs font-bold text-slate-500 mb-1">학생 연락처</label><input type="text" value={editForm.phone} onChange={e=>setEditForm({...editForm, phone: formatPhone(e.target.value)})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]" /></div>
                  
                  {/* 수강반 관리 영역 */}
                  <div className="col-span-2 bg-blue-50/50 p-4 rounded-lg border border-blue-100 mt-2">
                    <label className="block text-xs font-bold text-slate-600 mb-2">현재 소속된 수강반</label>
                    <ul className="mb-4 space-y-2">
                      {enrollments.length === 0 ? <li className="text-xs text-slate-400 font-bold bg-white px-3 py-2 rounded-lg border border-slate-200">배정된 수강반이 없습니다.</li> : 
                        enrollments.map(e => (
                          <li key={e.enrollment_id} className="flex justify-between items-center bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm">
                            <span className="text-sm font-bold text-[#002864]">{e.class?.name || '미배정'}</span>
                            <button onClick={() => removeEnrollment(e.enrollment_id)} className="px-2.5 py-1 bg-rose-50 text-rose-500 rounded hover:bg-rose-100 transition-colors text-xs font-bold border border-rose-100">제외</button>
                          </li>
                        ))
                      }
                    </ul>
                    <label className="block text-xs font-bold text-slate-600 mb-2 border-t border-blue-200 pt-3">새 수강반 배정 추가</label>
                    <div className="flex gap-2">
                      <select value={editForm.newClassId} onChange={e=>setEditForm({...editForm, newClassId: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-[#002864] focus:outline-none focus:border-[#002864]">
                        <option value="">선택 안함</option>
                        {allClasses.map(c => <option key={c.class_id} value={c.class_id.toString()}>{c.name} ({c.level_name})</option>)}
                      </select>
                      <button onClick={addEnrollment} className="shrink-0 px-4 py-2 bg-[#002864] text-white font-bold rounded-lg text-xs hover:bg-blue-900 transition-colors">추가</button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h4 className="font-bold text-sm text-emerald-600 mb-4 border-b border-slate-100 pb-2">학부모 정보</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">학부모 성함</label><input type="text" value={editForm.parentName} onChange={e=>setEditForm({...editForm, parentName: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]" /></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">관계</label><input type="text" value={editForm.parentRel} onChange={e=>setEditForm({...editForm, parentRel: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]" /></div>
                  <div className="col-span-2"><label className="block text-xs font-bold text-slate-500 mb-1">학부모 연락처</label><input type="text" value={editForm.parentPhone} onChange={e=>setEditForm({...editForm, parentPhone: formatPhone(e.target.value)})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-[#002864]" /></div>
                </div>
              </div>
            </div>
            <div className="p-5 bg-white border-t border-slate-200 flex justify-end gap-3 shrink-0 rounded-b-2xl">
              <button onClick={() => setIsEditModalOpen(false)} className="px-5 py-2 bg-slate-100 text-slate-600 font-bold rounded-lg hover:bg-slate-200 transition-colors">닫기</button>
              <button onClick={submitEditStudent} className="px-5 py-2 bg-[#002864] text-white font-bold rounded-lg shadow-sm hover:bg-blue-900 transition-colors">저장하기</button>
            </div>
          </div>
        </div>
      )}

      {/* 상담 기록 모달 */}
      {isConsultModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl flex flex-col transform transition-all animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-indigo-600 p-5 text-white flex justify-between items-center shrink-0 rounded-t-2xl">
              <h3 className="text-lg font-extrabold flex items-center gap-2"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>{consultForm.logId ? '상담 기록 수정' : '새 상담 기록 등록'}</h3>
              <button onClick={() => setIsConsultModalOpen(false)} className="text-white hover:text-rose-200 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            </div>
            <div className="p-6 space-y-5 bg-slate-50">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">상담 유형</label>
                  <select value={consultForm.type} onChange={e=>setConsultForm({...consultForm, type: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:border-indigo-500">
                    <option value="재원상담">재원상담</option><option value="신규상담">신규상담</option><option value="퇴원상담">퇴원상담</option><option value="성적상담">성적상담</option><option value="태도상담">태도상담</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">연락 방법</label>
                  <select value={consultForm.method} onChange={e=>setConsultForm({...consultForm, method: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:border-indigo-500">
                    <option value="전화">전화</option><option value="방문">방문</option><option value="채널톡">채널톡 (웹챗)</option><option value="문자/카톡">문자/카카오톡</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">상담 내용</label>
                <textarea rows={5} value={consultForm.content} onChange={e=>setConsultForm({...consultForm, content: e.target.value})} placeholder="학부모님과 나눈 대화 내용을 상세히 기록해주세요." className="w-full bg-white border border-slate-300 rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-indigo-500 resize-none"></textarea>
              </div>
            </div>
            <div className="p-5 bg-white border-t border-slate-200 flex justify-end gap-3 shrink-0 rounded-b-2xl">
              <button onClick={() => setIsConsultModalOpen(false)} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors text-sm">취소</button>
              <button onClick={submitConsultLog} className="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-md text-sm">기록 저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 청구서 발행 모달 */}
      {isBillingModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-emerald-600 p-5 text-white flex justify-between items-center shrink-0 rounded-t-2xl">
              <h3 className="text-lg font-extrabold flex items-center gap-2">새 청구서 발행</h3>
              <button onClick={() => setIsBillingModalOpen(false)} className="text-white hover:text-emerald-200 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            </div>
            <div className="p-6 space-y-4 bg-slate-50">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">청구 월</label>
                <input type="month" value={billForm.month} onChange={e=>setBillForm({...billForm, month: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">납부 기한 (언제까지 내야하나요?)</label>
                <input type="date" value={billForm.dueDate} onChange={e=>setBillForm({...billForm, dueDate: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">청구 대상 수강반 (선택시 금액 자동 입력)</label>
                <select value={billForm.classId} onChange={e => {
                  const cId = e.target.value;
                  const cInfo = allClasses.find(c => c.class_id.toString() === cId);
                  setBillForm({...billForm, classId: cId, amount: cInfo ? cInfo.tuition_fee?.toString()||"0" : ""});
                }} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-[#002864] focus:outline-none focus:border-emerald-500">
                  <option value="">청구할 반을 선택하세요</option>
                  {enrollments.map(e => {
                    const cInfo = allClasses.find(c => c.class_id === e.class_id);
                    return cInfo ? <option key={cInfo.class_id} value={cInfo.class_id}>{cInfo.name} (기본: {cInfo.tuition_fee?.toLocaleString()||0}원)</option> : null;
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">최종 청구 금액</label>
                <div className="flex items-center gap-2">
                  <input type="number" value={billForm.amount} onChange={e=>setBillForm({...billForm, amount: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-emerald-500" />
                  <span className="font-bold text-slate-500">원</span>
                </div>
              </div>
            </div>
            <div className="p-5 bg-white border-t border-slate-200 flex justify-end gap-3 shrink-0 rounded-b-2xl">
              <button onClick={() => setIsBillingModalOpen(false)} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 text-sm">취소</button>
              <button onClick={submitBilling} className="px-5 py-2.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-md text-sm">발행하기</button>
            </div>
          </div>
        </div>
      )}

      {/* 수납 처리 모달 */}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl flex flex-col animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-[#002864] p-5 text-white flex justify-between items-center shrink-0 rounded-t-2xl">
              <h3 className="text-lg font-extrabold flex items-center gap-2">수납 완료 처리</h3>
              <button onClick={() => setIsPaymentModalOpen(false)} className="text-white hover:text-blue-200 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            </div>
            <div className="p-6 space-y-4 bg-slate-50">
              <div className="text-center mb-2">
                <p className="text-xs font-bold text-slate-500">결제할 금액</p>
                <p className="text-3xl font-black text-rose-600">{payForm.amount.toLocaleString()}원</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">결제 수단</label>
                <select value={payForm.method} onChange={e=>setPayForm({...payForm, method: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:border-[#002864]">
                  <option value="계좌이체">계좌이체</option><option value="현장 카드결제">현장 카드결제</option><option value="현금">현금</option><option value="간편결제">간편결제 (카카오페이 등)</option>
                </select>
              </div>
            </div>
            <div className="p-5 bg-white border-t border-slate-200 flex justify-end gap-3 shrink-0 rounded-b-2xl">
              <button onClick={() => setIsPaymentModalOpen(false)} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 text-sm">취소</button>
              <button onClick={submitPayment} className="px-5 py-2.5 bg-[#002864] text-white font-bold rounded-xl hover:bg-blue-900 shadow-md text-sm">수납 확인</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}