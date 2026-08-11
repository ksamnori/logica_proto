// src/app/leveltest/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// 💡 시/분 선택용 배열 생성 (09시~22시, 10분 단위)
const hours = Array.from({ length: 14 }, (_, i) => String(i + 9).padStart(2, "0"));
const minutes = ["00", "10", "20", "30", "40", "50"];

export default function LevelTestPage() {
  // === 1. 방 개설 및 수정 (좌측) 상태 ===
  const [editSessionId, setEditSessionId] = useState<number | null>(null); // 수정 모드 판별용
  const [sGradeSem, setSGradeSem] = useState("42");
  const [sCode, setSCode] = useState("A");
  const [sYymm, setSYymm] = useState("");
  const [yymmOptions, setYymmOptions] = useState<{ value: string; label: string }[]>([]);
  const [examId, setExamId] = useState("");
  const [comment, setComment] = useState("");
  const [testDate, setTestDate] = useState("");
  
  // 💡 시간을 시(Hour)와 분(Minute)으로 분리
  const [testHour, setTestHour] = useState("");
  const [testMinute, setTestMinute] = useState("");

  const previewName = `LT${sGradeSem}${sCode}${sYymm}`;

  // === 데이터 상태 ===
  const [exams, setExams] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);

  // === 2. 배정 관리 (우측) 상태 ===
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [waitingStudents, setWaitingStudents] = useState<any[]>([]);
  const [gradeFilter, setGradeFilter] = useState("all"); // 학년 필터
  const [assignedApps, setAssignedApps] = useState<any[]>([]);
  const [checkedStudents, setCheckedStudents] = useState<string[]>([]);
  const [isAllChecked, setIsAllChecked] = useState(false);

  // === 상담 모달 상태 ===
  const [counselData, setCounselData] = useState<any | null>(null);

  const [isLoading, setIsLoading] = useState(false);

  // 학년 필터가 적용된 학생 목록 계산
  const filteredStudents = waitingStudents.filter(
    std => gradeFilter === "all" || String(std.grade) === String(gradeFilter)
  );

  // 초기 로딩
  useEffect(() => {
    initDateSelects();
    loadExams();
    loadSessions();
  }, []);

  // 일정(Session)이 변경될 때마다 학생 명단 갱신 및 상태 초기화
  useEffect(() => {
    loadWaitingStudents();
    setGradeFilter("all"); // 세션 변경 시 필터 초기화
    setCheckedStudents([]);
    setIsAllChecked(false);
  }, [selectedSessionId]);

  // 필터가 변경될 때마다 체크박스 초기화
  useEffect(() => {
    setCheckedStudents([]);
    setIsAllChecked(false);
  }, [gradeFilter]);

  // ==========================================
  // 유틸리티 함수
  // ==========================================
  const initDateSelects = () => {
    const options = [];
    const now = new Date();
    for (let i = -1; i <= 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const yy = String(d.getFullYear()).slice(2);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      options.push({ value: yy + mm, label: `${yy}년 ${mm}월` });
    }
    setYymmOptions(options);
    setSYymm(options[1].value); // 기본값: 현재 월
  };

  const formatKoreanGrade = (grade: any) => {
    if (String(grade) === "7") return "7세 반";
    if (typeof grade === 'string' && grade.includes('세')) return grade;

    const num = parseInt(grade, 10);
    if (isNaN(num)) return String(grade);
    
    if (num >= 1 && num <= 6) return `초등학교 ${num}학년`;
    if (num >= 8 && num <= 9) return `중학교 ${num - 6}학년`;
    if (num >= 10 && num <= 12) return `고등학교 ${num - 9}학년`;
    
    return String(grade);
  };

  const getPhone = (s: any) => s.phone || s.student_contact || "-";

  // 창 닫을 때 부모 창(admission) 새로고침
  const handleCloseWindow = () => {
    if (window.opener && !window.opener.closed) {
      window.opener.location.reload();
    }
    window.close();
  };

  // ==========================================
  // 데이터 불러오기
  // ==========================================
  const loadExams = async () => {
    try {
      const { data, error } = await supabase
        .from("exam_master")
        .select("exam_id, title, sub_title, exam_type, exam_tags")
        .or("exam_type.eq.입학테스트,exam_tags.ilike.%입학테스트%")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setExams(data || []);
    } catch (e) { console.error("시험지 로드 오류:", e); }
  };

  const loadSessions = async () => {
    try {
      const { data, error } = await supabase
        .from("admission_session")
        .select("*, exam_master(title, sub_title)")
        .order("test_date", { ascending: false });
      if (error) throw error;
      setSessions(data || []);
    } catch (e) { console.error("세션 로드 오류:", e); }
  };

  const loadWaitingStudents = async () => {
    if (!selectedSessionId) {
      setWaitingStudents([]);
      setAssignedApps([]);
      return;
    }

    try {
      const { data: apps, error: aError } = await supabase.from("admission_application").select("*").eq("admission_session_id", selectedSessionId);
      if (aError) throw aError;
      
      const assignedIds = (apps || []).map((a: any) => a.student_id);
      setAssignedApps(apps || []);
      
      // 학생 불러오기 (배정된 학생 + 대기생)
      let query = supabase.from("student").select("student_id, name, grade, phone, status").order("created_at", { ascending: true });
      if (assignedIds.length > 0) {
        query = query.or(`status.eq.입학테스트,student_id.in.(${assignedIds.map(id => `"${id}"`).join(",")})`);
      } else {
        query = query.eq("status", "입학테스트");
      }

      const { data: stus, error: sError } = await query;
      if (sError) throw sError;
      
      setWaitingStudents(stus || []);
    } catch (e: any) { console.error("학생 로드 오류:", e.message); }
  };

  // ==========================================
  // 방 개설 및 수정, 삭제 로직
  // ==========================================
  const handleExamChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setExamId(val);
    const ex = exams.find(x => String(x.exam_id) === val);
    if (ex) {
      setComment(ex.sub_title ? `${ex.title} [${ex.sub_title}]` : ex.title);
    } else {
      setComment("");
    }
  };

  const handleEditClick = (s: any) => {
    setEditSessionId(s.admission_session_id);
    
    const match = s.title.match(/^LT(\d{2})([A-E])(\d{4})$/);
    if (match) {
      setSGradeSem(match[1]);
      setSCode(match[2]);
      setSYymm(match[3]);
    }
    
    setExamId(s.exam_id || "");
    setComment(s.session_comment || "");
    setTestDate(s.test_date || "");
    
    const timeStr = s.start_time?.substring(0, 5) || "";
    if (timeStr) {
      const [h, m] = timeStr.split(":");
      setTestHour(h);
      setTestMinute(m);
    } else {
      setTestHour("");
      setTestMinute("");
    }
  };

  const cancelEdit = () => {
    setEditSessionId(null);
    setTestDate(""); setTestHour(""); setTestMinute(""); setExamId(""); setComment("");
  };

  const saveSession = async () => {
    if (!testDate || !testHour || !testMinute || !examId) return alert("시험지, 날짜, 시작 시간은 필수입니다!");
    
    // 🌟 [추가됨] 테스트 방을 개설할 때 소속 지점 꼬리표 챙기기
    const myTenantId = localStorage.getItem("logica_tenant_id");
    if (!myTenantId) return alert("소속 지점 정보가 없습니다. 다시 로그인 해주세요.");

    setIsLoading(true);
    const finalTime = `${testHour}:${testMinute}`;
    const dateTime = new Date(`${testDate}T${finalTime}:00+09:00`);

    try {
      if (editSessionId) {
        const oldSession = sessions.find(s => s.admission_session_id === editSessionId);
        if (oldSession) {
          await supabase.from("exam_session").update({
            name: previewName,
            test_date: dateTime.toISOString(),
            exam_id: examId
          }).eq("name", oldSession.title);
        }

        const { error } = await supabase.from("admission_session").update({
          title: previewName,
          test_date: testDate,
          start_time: finalTime + ":00",
          exam_id: examId,
          session_comment: comment || null,
        }).eq("admission_session_id", editSessionId);

        if (error) throw error;
        alert(`🎉 입학테스트 방이 성공적으로 수정되었습니다!`);
        setEditSessionId(null);

      } else {
        const { error: exErr } = await supabase.from("exam_session").insert([{
          name: previewName,
          test_date: dateTime.toISOString(),
          description: "입학테스트 듀얼 동기화 방",
          exam_id: examId 
        }]);
        if (exErr) console.warn("섀도 방 생성 실패 (무시 가능):", exErr);

        // 🌟 [수정됨] 새 테스트 방 생성 시 지점 꼬리표 부착
        const { error } = await supabase.from("admission_session").insert([{
          title: previewName,
          test_date: testDate,
          start_time: finalTime + ":00",
          exam_id: examId, 
          session_comment: comment || null,
          status: "모집중",
          tenant_id: myTenantId // 👈 꼬리표 추가!
        }]);
        if (error) throw error;

        alert(`🎉 입학테스트 방 [${previewName}] 성공적으로 개설되었습니다!`);
      }
      
      setTestDate(""); setTestHour(""); setTestMinute(""); setExamId(""); setComment("");
      loadSessions();
    } catch (e: any) { alert(`❌ 오류 발생: ${e.message}`); } finally { setIsLoading(false); }
  };

  const deleteSession = async (sessionId: string, sessionTitle: string) => {
    if (!confirm(`⚠️ [${sessionTitle}]\n이 일정을 정말 삭제하시겠습니까?\n이 방에 배정된 예약자, 학생 답안, 성적 리포트 등 모든 찌꺼기가 강제로 삭제됩니다.`)) return;

    setIsLoading(true);
    try {
      await supabase.from("admission_application").delete().eq("admission_session_id", sessionId);

      const assignmentIds = new Set<number>();
      
      const { data: admAssignments } = await supabase.from("exam_assignment").select("assignment_id").eq("admission_session_id", sessionId);
      admAssignments?.forEach(a => assignmentIds.add(a.assignment_id));

      const { data: exSession } = await supabase.from("exam_session").select("session_id").eq("name", sessionTitle).limit(1).maybeSingle();
      let exSessId = null;
      if (exSession) {
        exSessId = exSession.session_id;
        const { data: shadowAssignments } = await supabase.from("exam_assignment").select("assignment_id").eq("session_id", exSessId);
        shadowAssignments?.forEach(a => assignmentIds.add(a.assignment_id));
      }

      const idsArray = Array.from(assignmentIds);

      if (idsArray.length > 0) {
        await supabase.from("student_answer").delete().in("exam_assignment_id", idsArray);
        await supabase.from("student_exam_result").delete().in("assignment_id", idsArray);
        await supabase.from("student_progress").delete().in("assignment_id", idsArray);
        await supabase.from("admission_test_report").delete().in("assignment_id", idsArray);
        await supabase.from("exam_assignment").delete().in("assignment_id", idsArray);
      }
      
      await supabase.from("exam_assignment").delete().eq("admission_session_id", sessionId);
      if (exSessId) {
        await supabase.from("exam_assignment").delete().eq("session_id", exSessId);
        await supabase.from("exam_session").delete().eq("session_id", exSessId);
      }

      const { error } = await supabase.from("admission_session").delete().eq("admission_session_id", sessionId);
      if (error) throw error;

      alert(`✅ [${sessionTitle}] 일정이 관련 찌꺼기들과 함께 깔끔하게 파기되었습니다.`);
      if (String(selectedSessionId) === String(sessionId)) setSelectedSessionId("");
      loadSessions();
    } catch (e: any) { 
      alert(`❌ 강제 삭제 실패:\n${e.message}`); 
    } finally {
      setIsLoading(false);
    }
  };

  // ==========================================
  // 배정 및 취소 로직
  // ==========================================
  const toggleCheckAll = (isChecked: boolean) => {
    setIsAllChecked(isChecked);
    const availableIds = filteredStudents.filter(s => s.status === "입학테스트" && !assignedApps.find(a => a.student_id === s.student_id)).map(s => s.student_id);
    if (isChecked) setCheckedStudents(availableIds);
    else setCheckedStudents([]);
  };

  const toggleStudentCheck = (studentId: string) => {
    setCheckedStudents(prev => {
      const newChecked = prev.includes(studentId) ? prev.filter(id => id !== studentId) : [...prev, studentId];
      const availableCount = filteredStudents.filter(s => s.status === "입학테스트" && !assignedApps.find(a => a.student_id === s.student_id)).length;
      setIsAllChecked(newChecked.length === availableCount && availableCount > 0);
      return newChecked;
    });
  };

  const assignStudents = async () => {
    if (!selectedSessionId) return alert("배정할 테스트 일정을 먼저 선택해주세요!");
    if (checkedStudents.length === 0) return alert("배정할 대기생을 1명 이상 선택해주세요!");

    setIsLoading(true);
    try {
      const { data: admSession } = await supabase.from("admission_session").select("*").eq("admission_session_id", selectedSessionId).single();
      if (!admSession) return;

      const insertData = checkedStudents.map(id => ({ admission_session_id: parseInt(selectedSessionId), student_id: id, application_status: "예약완료" }));
      const { error } = await supabase.from("admission_application").insert(insertData);
      
      if (error) {
        if (error.code === "23505") alert("❌ 이미 이 일정에 배정된 학생이 포함되어 있습니다.");
        else alert(`❌ 오류 발생: ${error.message}`);
        return;
      }

      try {
        const { data: exSession } = await supabase.from("exam_session").select("session_id").eq("name", admSession.title).limit(1).maybeSingle();
        if (exSession && admSession.exam_id) {
          const shadowData = checkedStudents.map(id => ({ 
            student_id: id, 
            session_id: exSession.session_id, 
            exam_paper_id: admSession.exam_id, 
            test_status: "응시전" 
          }));
          await supabase.from("exam_assignment").insert(shadowData);
        }
      } catch (e) { console.warn("섀도 방 배정 오류:", e); }

      alert(`🎉 총 ${checkedStudents.length}명의 지원자가 성공적으로 예약 배정되었습니다!`);
      loadWaitingStudents();
    } catch (e: any) { alert(`❌ 오류: ${e.message}`); } finally { setIsLoading(false); }
  };

  const unassignStudent = async (studentId: string, studentName: string) => {
    if (!selectedSessionId) return;
    if (!confirm(`[${studentName}] 지원자의 테스트 예약을 정말 취소하시겠습니까?\n(해당 학생이 제출한 답안이 있다면 함께 영구 삭제됩니다.)`)) return;

    try {
      const { data: admSession } = await supabase.from("admission_session").select("title").eq("admission_session_id", selectedSessionId).single();
      if (admSession) {
        const { data: exSession } = await supabase.from("exam_session").select("session_id").eq("name", admSession.title).limit(1).maybeSingle();
        if (exSession) {
          const exSessId = exSession.session_id;
          const { data: assignments } = await supabase.from("exam_assignment").select("assignment_id").eq("session_id", exSessId).eq("student_id", studentId);
          if (assignments && assignments.length > 0) {
            for (let a of assignments) {
              const pk = a.assignment_id;
              await supabase.from("student_answer").delete().eq("assignment_id", pk);
              await supabase.from("student_answer").delete().eq("exam_assignment_id", pk);
              await supabase.from("student_exam_result").delete().eq("assignment_id", pk);
              await supabase.from("student_progress").delete().eq("assignment_id", pk);
              await supabase.from("admission_test_report").delete().eq("assignment_id", pk);
            }
            await supabase.from("student_answer").delete().eq("session_id", exSessId).eq("student_id", studentId);
            await supabase.from("exam_assignment").delete().eq("session_id", exSessId).eq("student_id", studentId);
          }
        }
      }

      const { error } = await supabase.from("admission_application").delete().eq("admission_session_id", selectedSessionId).eq("student_id", studentId);
      if (error) throw error;
      
      alert(`✅ ${studentName} 지원자의 예약이 취소되었습니다.`);
      loadWaitingStudents();
    } catch (e: any) { alert(`❌ 취소 중 오류 발생: ${e.message}`); }
  };

  // ==========================================
  // 상담 (Counseling) 모달 로직
  // ==========================================
  const saveCounseling = async () => {
    if (!counselData?.appId) return;
    setIsLoading(true);
    try {
      const { error } = await supabase.from("admission_application").update({
        test_result: counselData.result, counseling_memo: counselData.memo
      }).eq("application_id", counselData.appId);
      
      if (error) throw error;

      if (counselData.result === "합격") {
        if (confirm("해당 지원자가 '합격' 처리되었습니다.\n학생 데이터베이스 상태를 정규 '재원'으로 승급하시겠습니까?")) {
          await supabase.from("student").update({ status: "재원" }).eq("student_id", counselData.studentId);
          alert("🎉 해당 학생이 정규 '재원'생으로 자동 승급되었습니다!");
        }
      }

      setCounselData(null);
      loadWaitingStudents();
    } catch (e: any) { alert(`❌ 저장 실패: ${e.message}`); } finally { setIsLoading(false); }
  };

  return (
    <div className="p-8 min-h-screen flex justify-center items-start bg-slate-50 relative">
      
      <button onClick={handleCloseWindow} className="fixed top-6 right-6 bg-slate-800 hover:bg-rose-600 text-white px-5 py-2.5 rounded-xl shadow-2xl transition-all duration-300 font-extrabold flex items-center gap-2 z-50 group border border-slate-600 hover:border-rose-500">
        <svg className="w-5 h-5 group-hover:rotate-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        창 닫기
      </button>

      <div className="max-w-6xl w-full grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* 1. 방 개설 영역 */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col h-[750px]">
          <div className={`${editSessionId ? 'bg-amber-700' : 'bg-[#002864]'} text-white p-6 shrink-0 transition-colors`}>
            <h2 className="text-xl font-bold">🗓️ 1. 입학테스트 일정(방) {editSessionId ? "수정 모드" : "개설"}</h2>
            <p className={`${editSessionId ? 'text-amber-200' : 'text-blue-200'} text-sm mt-1 transition-colors`}>자동 코드 네이밍 시스템 (예: LT42A2607) 적용</p>
          </div>
          
          <div className="p-6 space-y-4 border-b border-slate-200 bg-slate-50 shrink-0">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">테스트 방 코드 설정 <span className="text-red-500">*</span></label>
              <div className="flex space-x-2">
                <span className="px-3 py-2 bg-slate-200 rounded-lg border border-slate-300 font-extrabold text-slate-700 flex items-center shrink-0">LT</span>
                <select value={sGradeSem} onChange={(e) => setSGradeSem(e.target.value)} className="w-1/3 px-2 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#002864] focus:outline-none font-bold text-slate-700 text-sm">
                  <optgroup label="초등">
                    <option value="11">초1-1</option><option value="12">초1-2</option>
                    <option value="21">초2-1</option><option value="22">초2-2</option>
                    <option value="31">초3-1</option><option value="32">초3-2</option>
                    <option value="41">초4-1</option><option value="42">초4-2</option>
                    <option value="51">초5-1</option><option value="52">초5-2</option>
                    <option value="61">초6-1</option><option value="62">초6-2</option>
                  </optgroup>
                  <optgroup label="중등">
                    <option value="71">중1-1</option><option value="72">중1-2</option>
                    <option value="81">중2-1</option><option value="82">중2-2</option>
                    <option value="91">중3-1</option><option value="92">중3-2</option>
                  </optgroup>
                  <optgroup label="고등">
                    <option value="01">고1-1</option><option value="02">고1-2</option>
                  </optgroup>
                </select>
                <select value={sCode} onChange={(e) => setSCode(e.target.value)} className="w-1/4 px-2 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#002864] focus:outline-none font-bold text-slate-700 text-sm">
                  <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option><option value="E">E</option>
                </select>
                <select value={sYymm} onChange={(e) => setSYymm(e.target.value)} className="w-1/3 px-2 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#002864] focus:outline-none font-bold text-slate-700 text-sm">
                  {yymmOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
              <div className={`mt-2 p-2.5 rounded-lg text-sm font-bold flex justify-between items-center shadow-inner ${editSessionId ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-blue-50 border border-blue-200 text-blue-800'}`}>
                <span>{editSessionId ? '수정 후 적용될 이름:' : '최종 생성될 방 이름:'}</span>
                <span className={`${editSessionId ? 'text-amber-700' : 'text-[#002864]'} text-lg font-black tracking-wider`}>{previewName}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">사용할 시험지 선택 <span className="text-red-500">*</span></label>
              <select value={examId} onChange={handleExamChange} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#002864] focus:outline-none font-bold text-slate-700">
                <option value="">{exams.length === 0 ? "시험지를 불러오는 중..." : "(필수) 사용할 시험지를 선택하세요"}</option>
                {exams.map(e => <option key={e.exam_id} value={e.exam_id}>{e.title} {e.sub_title ? `[${e.sub_title}]` : '[과정정보 없음]'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">시험 구분 코멘트 (선택)</label>
              <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="예: [초6/중1] 입학테스트 공통" className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#002864] focus:outline-none font-bold text-slate-700 text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">시험 날짜 <span className="text-red-500">*</span></label>
                <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#002864] focus:outline-none font-bold text-slate-700" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">시작 시간 <span className="text-red-500">*</span></label>
                <div className="flex space-x-2">
                  <select 
                    value={testHour} 
                    onChange={(e) => setTestHour(e.target.value)} 
                    className="w-1/2 px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#002864] focus:outline-none font-bold text-slate-700 cursor-pointer"
                  >
                    <option value="">시</option>
                    {hours.map(h => (
                      <option key={h} value={h}>{h}시</option>
                    ))}
                  </select>
                  <select 
                    value={testMinute} 
                    onChange={(e) => setTestMinute(e.target.value)} 
                    className="w-1/2 px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#002864] focus:outline-none font-bold text-slate-700 cursor-pointer"
                  >
                    <option value="">분</option>
                    {minutes.map(m => (
                      <option key={m} value={m}>{m}분</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            
            <div className="flex gap-2 mt-2">
              <button onClick={saveSession} disabled={isLoading} className={`flex-1 ${editSessionId ? 'bg-amber-600 hover:bg-amber-700' : 'bg-[#002864] hover:bg-blue-900'} text-white font-bold py-3 rounded-lg transition-colors shadow-md text-lg disabled:opacity-50`}>
                {isLoading ? "처리 중..." : (editSessionId ? "테스트 방 수정하기" : "테스트 방 개설하기")}
              </button>
              {editSessionId && (
                <button onClick={cancelEdit} disabled={isLoading} className="px-5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-3 rounded-lg transition-colors shadow-sm text-sm shrink-0">
                  수정 취소
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-white min-h-0">
            <h3 className="font-bold text-slate-700 mb-3">📋 개설된 입학테스트 일정</h3>
            <div className="space-y-3">
              {sessions.length === 0 ? <div className="text-center text-slate-400 py-4">개설된 일정이 없습니다.</div> :
                sessions.map(s => {
                  const tDate = s.test_date;
                  const tTime = s.start_time?.substring(0, 5) || "";
                  const examTitle = s.exam_master ? `${s.exam_master.title} ${s.exam_master.sub_title ? `[${s.exam_master.sub_title}]` : ''}` : '시험지 미지정';
                  
                  return (
                    <div key={s.admission_session_id} className={`border ${editSessionId === s.admission_session_id ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'} rounded-lg p-3 transition-colors flex justify-between items-start group`}>
                      <div className="flex-1 pr-2 min-w-0">
                        <div className={`font-bold ${editSessionId === s.admission_session_id ? 'text-amber-800' : 'text-[#002864]'} truncate`}>{s.title}</div>
                        <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5 whitespace-nowrap overflow-hidden">
                          <span className="shrink-0">🗓️ {tDate} {tTime}</span><span className="shrink-0">|</span><span className="truncate" title={examTitle}>📝 {examTitle}</span>
                        </div>
                        {s.session_comment && <div className="mt-2 text-[11px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded w-fit inline-block truncate max-w-full">💬 {s.session_comment}</div>}
                      </div>
                      <div className="mt-1 opacity-0 group-hover:opacity-100 flex gap-1 shrink-0 transition-opacity">
                        <button onClick={() => handleEditClick(s)} className="bg-white hover:bg-amber-50 text-amber-600 hover:text-amber-700 border border-slate-200 hover:border-amber-300 px-2.5 py-1 rounded text-[11px] font-bold shadow-sm transition-colors">
                          수정
                        </button>
                        <button onClick={() => deleteSession(s.admission_session_id, s.title)} className="bg-white hover:bg-rose-50 text-rose-500 hover:text-rose-600 border border-slate-200 hover:border-rose-300 px-2.5 py-1 rounded text-[11px] font-bold shadow-sm transition-colors">
                          삭제
                        </button>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        </div>

        {/* 2. 대기생 배정 및 상담 패널 */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col h-[750px]">
          <div className="bg-emerald-700 text-white p-6 shrink-0">
            <h2 className="text-xl font-bold">👨‍🎓 2. 지원자 배정 및 상담 결과 관리</h2>
            <p className="text-emerald-200 text-sm mt-1">대기생을 방에 넣고 합격 여부와 상담 내용을 기록합니다.</p>
          </div>

          <div className="p-6 border-b border-slate-200 bg-slate-50 shrink-0">
            <label className="block text-sm font-bold text-slate-700 mb-1">관리할 일정 선택 <span className="text-red-500">*</span></label>
            <select value={selectedSessionId} onChange={(e) => setSelectedSessionId(e.target.value)} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-600 font-bold text-emerald-800 focus:outline-none">
              <option value="">일정을 먼저 개설하거나 선택해주세요</option>
              {sessions.map(s => <option key={s.admission_session_id} value={s.admission_session_id}>[{s.test_date}] {s.title} {s.session_comment ? `- ${s.session_comment}` : ''}</option>)}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-white flex flex-col min-h-0">
            <div className="flex justify-between items-center mb-3 shrink-0">
              <div className="flex items-center">
                <h3 className="font-bold text-slate-700">📝 지원자 및 대기생 명단</h3>
                <select 
                  value={gradeFilter} 
                  onChange={(e) => setGradeFilter(e.target.value)} 
                  className="ml-3 text-xs border border-slate-300 rounded-md px-2 py-1.5 focus:ring-2 focus:ring-emerald-600 font-bold text-slate-600 outline-none shadow-sm cursor-pointer bg-slate-50"
                >
                  <option value="all">전체 학년 보기</option>
                  {Array.from(new Set(waitingStudents.map(s => s.grade)))
                    .sort((a, b) => Number(a) - Number(b))
                    .map(g => (
                      <option key={g} value={g}>{formatKoreanGrade(g)}</option>
                    ))}
                </select>
              </div>
              <label className="flex items-center space-x-1 cursor-pointer text-sm text-slate-600 font-bold bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-200 transition-colors shadow-sm">
                <input type="checkbox" checked={isAllChecked} onChange={(e) => toggleCheckAll(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
                <span>전체 선택</span>
              </label>
            </div>
            
            <div className="space-y-2 border border-slate-200 rounded-lg p-3 bg-slate-50 flex-1 overflow-y-auto custom-scroll">
              {!selectedSessionId ? <div className="text-center text-slate-400 py-4">일정을 선택하면 학생 명단이 나타납니다.</div> :
               filteredStudents.length === 0 ? <div className="text-center text-slate-400 py-4">조건에 맞는 대기 학생이 없습니다.</div> :
               filteredStudents.map(std => {
                 const isAssigned = assignedApps.some(a => a.student_id === std.student_id);
                 const appData = assignedApps.find(a => a.student_id === std.student_id) || {};
                 const korGradeName = formatKoreanGrade(std.grade);

                 if (isAssigned) {
                   const tResult = appData.test_result || "대기";
                   let resultBadge = <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-bold">⏳ 대기</span>;
                   if (tResult === "합격") resultBadge = <span className="text-xs bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-extrabold">🎉 합격</span>;
                   else if (tResult === "불합격") resultBadge = <span className="text-xs bg-red-100 text-red-600 border border-red-200 px-2 py-0.5 rounded font-bold">❌ 불합격</span>;

                   return (
                     <div key={std.student_id} className="flex items-center justify-between p-3 bg-white border-2 border-emerald-400 rounded-lg shadow-sm gap-2">
                       <div className="flex items-center space-x-3 min-w-0">
                         <div className="w-5 h-5 flex items-center justify-center bg-emerald-500 rounded text-white text-xs font-bold shrink-0">✓</div>
                         <div className="flex flex-col min-w-0">
                           <div className="flex items-center gap-2">
                             <span className="font-extrabold text-slate-800 truncate">{std.name}</span>
                             {resultBadge}
                           </div>
                           <span className="text-xs text-slate-400 font-medium mt-0.5 truncate">{korGradeName} | {getPhone(std)}</span>
                         </div>
                       </div>
                       <div className="flex items-center gap-1.5 shrink-0">
                         <button onClick={() => setCounselData({ appId: appData.application_id, studentId: std.student_id, name: std.name, result: tResult, memo: appData.counseling_memo || '' })} className="text-[12px] bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 px-2.5 py-1.5 rounded-md font-bold transition-colors shadow-sm flex items-center">
                           📝 상담 및 결과
                         </button>
                         <button onClick={() => unassignStudent(std.student_id, std.name)} className="text-[12px] bg-white hover:bg-red-50 text-red-500 border border-slate-200 hover:border-red-200 px-2.5 py-1.5 rounded-md font-bold transition-colors shadow-sm">
                           배정 취소
                         </button>
                       </div>
                     </div>
                   );
                 } else if (std.status === "입학테스트") {
                   return (
                     <label key={std.student_id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 shadow-sm transition-all gap-2">
                       <div className="flex items-center space-x-3 min-w-0">
                         <input type="checkbox" checked={checkedStudents.includes(std.student_id)} onChange={() => toggleStudentCheck(std.student_id)} className="w-5 h-5 accent-emerald-600 shrink-0" />
                         <div className="flex items-center min-w-0">
                           <span className="font-bold text-slate-800 truncate">{std.name}</span>
                           <span className="text-xs bg-[#002864] text-white px-2 py-0.5 rounded ml-2 font-bold shrink-0">{korGradeName}</span>
                         </div>
                       </div>
                       <div className="text-sm text-slate-500 font-medium shrink-0">{getPhone(std)}</div>
                     </label>
                   );
                 }
                 return null;
               })
              }
            </div>
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-200 shrink-0">
            <button onClick={assignStudents} disabled={isLoading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-lg py-4 rounded-xl transition-all shadow-lg disabled:opacity-50">
              {isLoading ? "배정 처리 중... ⏳" : "선택한 대기생 배정 완료하기 ✅"}
            </button>
          </div>
        </div>

      </div>

      {/* 상담 및 결과 기록 모달 */}
      {counselData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="bg-slate-800 text-white p-5 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg">📝 입학 상담 및 결과 기록</h3>
              <button onClick={() => setCounselData(null)} className="text-slate-300 hover:text-white transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto custom-scroll">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">지원자 이름</label>
                <div className="font-extrabold text-xl text-[#002864]">{counselData.name}</div>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">입학테스트 결과 판정</label>
                <select value={counselData.result} onChange={e => setCounselData({ ...counselData, result: e.target.value })} className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#002864] font-bold text-slate-700 focus:outline-none">
                  <option value="대기">⏳ 대기 (결과 미정)</option>
                  <option value="합격">🎉 합격 (입학 승인)</option>
                  <option value="불합격">❌ 불합격</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">상담 메모</label>
                <textarea rows={4} value={counselData.memo} onChange={e => setCounselData({ ...counselData, memo: e.target.value })} className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#002864] focus:outline-none text-sm resize-none custom-scroll" placeholder="상담 내용, 특이사항, 배정 희망 반 등을 자유롭게 기록하세요."></textarea>
              </div>
            </div>
            <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end space-x-2 shrink-0">
              <button onClick={() => setCounselData(null)} className="px-5 py-2.5 rounded-lg font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 transition-colors">취소</button>
              <button onClick={saveCounseling} disabled={isLoading} className="px-5 py-2.5 rounded-lg font-bold text-white bg-[#002864] hover:bg-blue-900 shadow transition-colors disabled:opacity-50">기록 저장하기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}