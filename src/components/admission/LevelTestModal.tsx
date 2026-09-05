// src/components/admission/LevelTestModal.tsx
"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const hours = Array.from({ length: 14 }, (_, i) => String(i + 9).padStart(2, "0"));
const minutes = ["00", "10", "20", "30", "40", "50"];

const now = new Date();
const currentYY = String(now.getFullYear()).slice(2);
const parsedYY = parseInt(currentYY);
const defaultYear = parsedYY >= 26 && parsedYY <= 30 ? currentYY : (parsedYY < 26 ? "26" : "30");
const defaultMonth = String(now.getMonth() + 1).padStart(2, "0");

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

const getGradeOrder = (grade: any) => {
  if (!grade) return 999;
  if (typeof grade === 'string' && grade.includes('세')) return 0;
  const num = parseInt(grade, 10);
  return isNaN(num) ? 999 : num;
};

const formatTestDate = (val: any) => {
  if (!val) return "";
  const str = String(val).trim();
  if (str.includes("T")) return str.split("T")[0]; 
  if (str.length === 8 && !isNaN(Number(str))) return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6)}`; 
  return str; 
};

const formatKoreanDate = (dateStr: string) => {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parseInt(parts[1], 10)}월 ${parseInt(parts[2], 10)}일`;
};

const extractGradeFromTitle = (title: string) => {
  const match = title.match(/^LT(\d{2})/);
  if (!match) return "";
  const code = parseInt(match[1], 10);
  const g = Math.floor(code / 10);
  const sem = code % 10;
  if (g >= 1 && g <= 6) return `초${g}-${sem}`;
  if (g >= 7 && g <= 9) return `중${g - 6}-${sem}`;
  if (g >= 10 && g <= 12) return `고${g - 9}-${sem}`;
  return "";
};

const formatContact = (val: any) => {
  if (!val) return "";
  const str = String(val).trim();
  const numOnly = str.replace(/[^0-9]/g, "");
  if (numOnly.length === 11 && !str.includes("-")) return `${numOnly.slice(0,3)}-${numOnly.slice(3,7)}-${numOnly.slice(7)}`;
  if (numOnly.length === 10 && !str.includes("-")) {
    if (numOnly.startsWith("02")) return `${numOnly.slice(0,2)}-${numOnly.slice(2,6)}-${numOnly.slice(6)}`;
    return `${numOnly.slice(0,3)}-${numOnly.slice(3,6)}-${numOnly.slice(6)}`;
  }
  return str;
};

const getKSTDateStr = (isoString?: string) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
};

interface LevelTestModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function LevelTestModal({ onClose, onSuccess }: LevelTestModalProps) {
  const [editSessionId, setEditSessionId] = useState<number | null>(null);
  const [sGradeSem, setSGradeSem] = useState("11");
  const [sCode, setSCode] = useState("A");
  const [sYear, setSYear] = useState(defaultYear);
  const [sMonth, setSMonth] = useState(defaultMonth);
  const [examId, setExamId] = useState("");
  const [comment, setComment] = useState("");
  const [testDate, setTestDate] = useState("");
  const [testHour, setTestHour] = useState("");
  const [testMinute, setTestMinute] = useState("");

  const dateDay = testDate ? testDate.split("-")[2] : "";
  const timeSuffix = (testHour && testMinute) ? `-${testHour}${testMinute}` : "";
  const previewName = `LT${sGradeSem}${sCode}${sYear}${sMonth}${dateDay}${timeSuffix}`;

  const [exams, setExams] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);

  const [sessionDateFilter, setSessionDateFilter] = useState("");
  const [sessionTimeFilter, setSessionTimeFilter] = useState(""); 
  const [sessionSortOrder, setSessionSortOrder] = useState<"asc" | "desc">("asc");
  const [sessionGradeOrder, setSessionGradeOrder] = useState<"asc" | "desc">("asc");
  
  const [leftDateFilter, setLeftDateFilter] = useState("all"); 
  const [selectedSessionId, setSelectedSessionId] = useState("");
  
  const [waitingStudents, setWaitingStudents] = useState<any[]>([]);
  
  const [gradeFilter, setGradeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all"); 
  const [searchKeyword, setSearchKeyword] = useState("");

  const [assignedApps, setAssignedApps] = useState<any[]>([]);
  const [checkedStudents, setCheckedStudents] = useState<string[]>([]);
  const [isAllChecked, setIsAllChecked] = useState(false);

  const [isLoading, setIsLoading] = useState(false);

  const [userPosition, setUserPosition] = useState("");
  const [userRole, setUserRole] = useState("");
  const [hasAdminPermission, setHasAdminPermission] = useState(false);

  const todayKst = getKSTDateStr(new Date().toISOString());

  const filteredStudents = waitingStudents.filter(std => {
    const keyword = searchKeyword.trim().toLowerCase();
    const rawContact = std.contact ? std.contact.replace(/[^0-9]/g, "") : "";
    const searchPhone = keyword.replace(/[^0-9]/g, "");

    const passKeyword = !keyword || 
      (std.student_name && std.student_name.toLowerCase().includes(keyword)) ||
      (searchPhone && rawContact.includes(searchPhone));

    if (std.isAssigned) return passKeyword;

    const passGrade = gradeFilter === "all" || String(std.grade) === String(gradeFilter);
    const dateVal = formatTestDate(std.test_date) || "날짜없음";
    const passDate = dateFilter === "all" || dateVal === dateFilter;

    return passGrade && passDate && passKeyword;
  }).sort((a, b) => {
    if (a.isAssigned !== b.isAssigned) return a.isAssigned ? -1 : 1;
    return getGradeOrder(a.grade) - getGradeOrder(b.grade);
  });

  const uniqueDates = Array.from(
    new Set(waitingStudents.map(s => formatTestDate(s.test_date) || "날짜없음"))
  ).sort();

  const uniqueSessionDates = Array.from(
    new Set(sessions.map(s => s.test_date).filter(Boolean))
  ).sort();

  const uniqueSessionTimes = Array.from(
    new Set(sessions.map(s => s.start_time ? s.start_time.substring(0, 5) : "").filter(Boolean))
  ).sort();

  const filteredLeftSessions = sessions.filter(s => leftDateFilter === "all" || s.test_date === leftDateFilter);

  useEffect(() => {
    const pos = localStorage.getItem("logica_instructor_position") || "";
    const role = localStorage.getItem("logica_instructor_role") || "";
    setUserPosition(pos);
    setUserRole(role);

    const isAdmin = ["SUPER_ADMIN", "ADMIN", "MANAGER", "PRINCIPAL"].includes(role.toUpperCase()) || 
                    ["최고관리자", "대장", "원장", "실장"].some(p => pos.includes(p));
    setHasAdminPermission(isAdmin);

    loadExams();
    loadSessions();
  }, []);

  useEffect(() => {
    loadWaitingStudents();
    setGradeFilter("all");
    setDateFilter("all"); 
    setSearchKeyword("");
    setCheckedStudents([]);
    setIsAllChecked(false);
  }, [selectedSessionId]);

  useEffect(() => {
    setCheckedStudents([]);
    setIsAllChecked(false);
  }, [gradeFilter, dateFilter, searchKeyword]);

  const loadExams = async () => {
    try {
      const { data, error } = await supabase
        .from("exam_master")
        .select("exam_id, title, sub_title, exam_type, exam_tags")
        .or("exam_type.eq.입학테스트,exam_tags.ilike.%입학테스트%"); 
      if (error) throw error;

      const sortedExams = (data || []).sort((a, b) => {
        const strA = a.sub_title || a.title;
        const strB = b.sub_title || b.title;
        
        const getScore = (str: string) => {
          if (!str) return 9999;
          let score = 0;
          if (str.includes("세")) score -= 100;
          else if (str.includes("초")) score += 100;
          else if (str.includes("중")) score += 200;
          else if (str.includes("고")) score += 300;
          else score += 400;
          const numMatch = str.match(/\d+/);
          if (numMatch) score += parseInt(numMatch[0], 10);
          const subMatch = str.match(/\d+-(\d+)/);
          if (subMatch) score += parseInt(subMatch[1], 10) * 0.1;
          return score;
        };

        return getScore(strA) - getScore(strB);
      });

      setExams(sortedExams);
    } catch (e) { console.error("시험지 로드 오류:", e); }
  };

  const loadSessions = async () => {
    try {
      const { data, error } = await supabase
        .from("admission_session")
        .select("*, exam_master(title, sub_title)");
      if (error) throw error;
      
      const sortedSessions = (data || []).sort((a, b) => {
         const dtA = new Date(`${a.test_date}T${a.start_time || '00:00:00'}`).getTime();
         const dtB = new Date(`${b.test_date}T${b.start_time || '00:00:00'}`).getTime();
         if (!isNaN(dtA) && !isNaN(dtB) && dtA !== dtB) return dtA - dtB;
         const matchA = a.title.match(/LT(\d{2})/);
         const matchB = b.title.match(/LT(\d{2})/);
         const numA = matchA ? parseInt(matchA[1], 10) : 9999;
         const numB = matchB ? parseInt(matchB[1], 10) : 9999;
         if (numA !== numB) return numA - numB;
         return a.title.localeCompare(b.title);
      });

      setSessions(sortedSessions);
    } catch (e) { console.error("세션 로드 오류:", e); }
  };

  const loadWaitingStudents = async () => {
    if (!selectedSessionId) {
      setWaitingStudents([]);
      setAssignedApps([]);
      return;
    }
    try {
      // 🌟 [변경점] 전체 배정 현황을 가져와서 다른 방에 배정되었는지(타 일정 중복) 확인합니다.
      const { data: allApps } = await supabase.from("admission_application").select("student_id, admission_session_id");
      const otherAppsMap: Record<string, boolean> = {};
      allApps?.forEach(a => {
        if (String(a.admission_session_id) !== String(selectedSessionId)) {
          otherAppsMap[a.student_id] = true;
        }
      });

      // 🌟 에러 수정 1: 존재하지 않는 school_name을 제외하고 select
      const { data: apps, error: aError } = await supabase
        .from("admission_application")
        .select("*, student(name, grade, school, parent(phone))") 
        .eq("admission_session_id", selectedSessionId);
      
      if (aError) throw aError;
      setAssignedApps(apps || []);

      const studentIdsInSession = (apps || []).map((a: any) => a.student_id);

      const assignMap: any = {};
      if (studentIdsInSession.length > 0) {
        const { data: assignments } = await supabase.from("exam_assignment").select("student_id, status").in("student_id", studentIdsInSession);
        assignments?.forEach(a => {
          if (['채점완료', '완료'].includes(a.status)) {
            assignMap[a.student_id] = '채점완료';
          } else if (!assignMap[a.student_id]) {
            assignMap[a.student_id] = a.status;
          }
        });
      }

      const assignedList = (apps || [])
        .map((a: any) => {
          const st = Array.isArray(a.student) ? a.student[0] : a.student;
          const pPhone = st?.parent?.phone || "-";
          
          const assignStatus = assignMap[a.student_id];
          const isDone = ['채점완료', '완료'].includes(assignStatus);
          let displayResult = a.test_result || a.application_status || a.status || '대기';
          
          if (isDone && !['합격', '불합격'].includes(displayResult)) {
            displayResult = '검토중';
          }

          return {
            id: a.student_id,
            student_id: a.student_id,
            student_name: st?.name || "이름없음",
            grade: st?.grade || "미입력",
            school_name: st?.school || "",
            contact: pPhone,
            test_date: "-",
            created_at: a.created_at, 
            isAssigned: true,
            displayResult, 
            source: 'assigned'
          };
        })
        .filter((item: any) => !['검토중', '합격', '불합격'].includes(item.displayResult));
      
      const { data: tempStus, error: sError } = await supabase
        .from("temp_admission_applicants")
        .select("*")
        .neq("status", "배정완료");
      
      if (sError) throw sError;

      const waitingTempList = (tempStus || []).map((s: any) => ({
        ...s,
        isAssigned: false,
        isAssignedOther: false, // 임시생은 아직 다른 곳에 배정될 수 없으므로 무조건 false
        source: 'temp'
      }));

      // 🌟 에러 수정 2: 존재하지 않는 school_name을 제외하고 select
      const { data: formalStus, error: fError } = await supabase
        .from("student")
        .select("student_id, name, grade, school, created_at, parent(phone)")
        .eq("status", "입학테스트");

      if (fError) throw fError;

      // 🌟 [핵심 변경점] 기존에는 allAssignedIds 에 있으면 명단에서 아예 지워버렸지만, 
      // 이제는 '현재 방(studentIdsInSession)'에 없는 학생이면 무조건 띄워줍니다!
      const waitingFormalList = (formalStus || [])
        .filter((s: any) => !studentIdsInSession.includes(s.student_id)) 
        .map((s: any) => ({
          id: s.student_id, 
          student_id: s.student_id,
          student_name: s.name,
          grade: s.grade || "미입력",
          school_name: s.school || "",
          contact: Array.isArray(s.parent) ? s.parent[0]?.phone : (s.parent?.phone || "번호없음"),
          test_date: s.created_at,
          created_at: s.created_at, 
          isAssigned: false,
          isAssignedOther: !!otherAppsMap[s.student_id], // 🌟 타 일정 중복 여부 확인
          source: 'student'
        }));

      setWaitingStudents([...assignedList, ...waitingTempList, ...waitingFormalList]);
    } catch (e: any) { console.error("학생 로드 오류:", e.message); }
  };

  const handleExamChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setExamId(val);
    const ex = exams.find(x => String(x.exam_id) === val);
    if (ex) setComment(ex.sub_title ? `${ex.title} [${ex.sub_title}]` : ex.title);
    else setComment("");
  };

  const handleEditClick = (s: any) => {
    if (!hasAdminPermission) return; 

    setEditSessionId(s.admission_session_id);
    
    const match = s.title.match(/^LT(\d{2})([A-E])(\d{2})(\d{2})(\d{2})?(?:-(\d{2})(\d{2}))?$/);
    if (match) {
      setSGradeSem(match[1]);
      setSCode(match[2]);
      setSYear(match[3]);
      setSMonth(match[4]);
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
      setTestHour(""); setTestMinute("");
    }
  };

  const cancelEdit = () => {
    setEditSessionId(null);
    setTestDate(""); setTestHour(""); setTestMinute(""); setExamId(""); setComment("");
  };

  const saveSession = async () => {
    if (!hasAdminPermission) return alert("저장 권한이 없습니다."); 
    if (!testDate || !testHour || !testMinute || !examId) return alert("시험지, 날짜, 시작 시간은 필수입니다!");
    
    const myTenantId = localStorage.getItem("logica_tenant_id");
    if (!myTenantId) return alert("소속 지점 정보가 없습니다. 새로고침 후 다시 시도해주세요.");

    setIsLoading(true);
    const finalTime = `${testHour}:${testMinute}`;
    const dateTime = new Date(`${testDate}T${finalTime}:00+09:00`);

    try {
      if (editSessionId) {
        const oldSession = sessions.find(s => s.admission_session_id === editSessionId);
        if (oldSession) {
          await supabase.from("exam_session").update({
            name: previewName, test_date: dateTime.toISOString(), exam_id: examId
          }).eq("name", oldSession.title);
        }

        const { error } = await supabase.from("admission_session").update({
          title: previewName, test_date: testDate, start_time: finalTime + ":00", exam_id: examId, session_comment: comment || null,
        }).eq("admission_session_id", editSessionId);

        if (error) throw error;
        alert(`🎉 입학테스트 방이 성공적으로 수정되었습니다!`);
        
        setEditSessionId(null);
      } else {
        const { error: exErr } = await supabase.from("exam_session").insert([{
          name: previewName, test_date: dateTime.toISOString(), description: "입학테스트 듀얼 동기화 방", exam_id: examId 
        }]);
        if (exErr) console.warn("섀도 방 생성 실패 (무시 가능):", exErr);

        const { error } = await supabase.from("admission_session").insert([{
          title: previewName, 
          test_date: testDate, 
          start_time: finalTime + ":00", 
          exam_id: examId, 
          session_comment: comment || null, 
          status: "모집중",
          tenant_id: myTenantId
        }]);
        if (error) throw error;

        alert(`🎉 입학테스트 방 [${previewName}] 성공적으로 개설되었습니다!`);
      }
      
      loadSessions();
      onSuccess(); 
    } catch (e: any) { alert(`❌ 오류 발생: ${e.message}`); } finally { setIsLoading(false); }
  };

  const deleteSession = async (sessionId: string, sessionTitle: string) => {
    if (!hasAdminPermission) return alert("삭제 권한이 없습니다."); 

    if (!confirm(`⚠️ [${sessionTitle}]\n이 일정을 정말 삭제하시겠습니까?\n이 방에 배정된 예약자, 학생 답안, 성적 리포트 등 모든 데이터가 완벽하게 폭파됩니다.`)) return;
    setIsLoading(true);
    
    try {
      const { error: appErr } = await supabase.from("admission_application").delete().eq("admission_session_id", sessionId);
      if (appErr) throw new Error(`예약자 내역 삭제 실패: ${appErr.message}`);

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
        await Promise.all([
          supabase.from("student_answer").delete().in("assignment_id", idsArray),
          supabase.from("student_answer").delete().in("exam_assignment_id", idsArray), 
          supabase.from("student_exam_result").delete().in("assignment_id", idsArray),
          supabase.from("student_progress").delete().in("assignment_id", idsArray),
          supabase.from("admission_test_report").delete().in("assignment_id", idsArray)
        ]);
        
        const { error: assignErr } = await supabase.from("exam_assignment").delete().in("assignment_id", idsArray);
        if (assignErr) throw new Error(`시험 배정 내역 삭제 실패: ${assignErr.message}`);
      }
      
      await supabase.from("exam_assignment").delete().eq("admission_session_id", sessionId);
      if (exSessId) {
        await supabase.from("exam_assignment").delete().eq("session_id", exSessId);
        const { error: shadowSessErr } = await supabase.from("exam_session").delete().eq("session_id", exSessId);
        if (shadowSessErr) throw new Error(`동기화된 시험지 방 삭제 실패: ${shadowSessErr.message}`);
      }

      const { error: sessErr } = await supabase.from("admission_session").delete().eq("admission_session_id", sessionId);
      if (sessErr) throw new Error(`입학테스트 방 본체 삭제 실패: ${sessErr.message}`);

      alert(`✅ [${sessionTitle}] 일정이 흔적 없이 완벽하게 삭제되었습니다.`);
      if (String(selectedSessionId) === String(sessionId)) setSelectedSessionId("");
      loadSessions();
      onSuccess();
    } catch (e: any) { 
      alert(`❌ 강제 삭제 중단됨:\n${e.message}`); 
    } finally { 
      setIsLoading(false); 
    }
  };

  const toggleCheckAll = (isChecked: boolean) => {
    setIsAllChecked(isChecked);
    const availableIds = filteredStudents.filter(s => !s.isAssigned).map(s => s.id);
    
    if (isChecked) setCheckedStudents(availableIds);
    else setCheckedStudents([]);
  };

  const toggleStudentCheck = (studentId: string) => {
    setCheckedStudents(prev => {
      const newChecked = prev.includes(studentId) ? prev.filter(id => id !== studentId) : [...prev, studentId];
      const availableCount = filteredStudents.filter(s => !s.isAssigned).length;
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

      let successCount = 0;

      const checkedTempIds = checkedStudents.filter(id => waitingStudents.find(w => w.id === id && w.source === 'temp'));
      const checkedFormalIds = checkedStudents.filter(id => waitingStudents.find(w => w.id === id && w.source === 'student'));

      if (checkedTempIds.length > 0) {
        const { data: tempStudents, error: tempErr } = await supabase
          .from("temp_admission_applicants")
          .select("*")
          .in("id", checkedTempIds);

        if (tempErr || !tempStudents) throw new Error("대기생 정보를 불러올 수 없습니다.");

        const myTenantId = localStorage.getItem("logica_tenant_id");
        if (!myTenantId) throw new Error("소속 지점 정보가 없습니다.");

        for (const temp of tempStudents) {
          const rawPhone = temp.contact ? temp.contact.replace(/[^0-9]/g, "") : null;
          let parentId = null;

          if (rawPhone) {
            const { data: existParent } = await supabase.from("parent").select("parent_id").eq("phone", rawPhone).maybeSingle();
            if (existParent) {
              parentId = existParent.parent_id;
            } else {
              const { data: newParent } = await supabase.from("parent").insert({ phone: rawPhone, name: `${temp.student_name} 학부모` }).select().single();
              if (newParent) parentId = newParent.parent_id;
            }
          }

          const { data: newStudent, error: sErr } = await supabase.from("student").insert({
            name: temp.student_name,
            grade: temp.grade || "미입력",
            school: temp.school_name, 
            parent_id: parentId,
            status: "입학테스트",
            tenant_id: myTenantId 
          }).select().single();

          if (sErr) throw new Error(`[${temp.student_name}] 등록 실패: ${sErr.message}`);
          
          const newStudentId = newStudent.student_id;

          await supabase.from("admission_application").insert({
            admission_session_id: parseInt(selectedSessionId),
            student_id: newStudentId,
            application_status: "예약완료"
          });

          try {
            const { data: exSession } = await supabase.from("exam_session").select("session_id").eq("name", admSession.title).limit(1).maybeSingle();
            if (exSession && admSession.exam_id) {
              await supabase.from("exam_assignment").insert({ 
                student_id: newStudentId, session_id: exSession.session_id, exam_paper_id: admSession.exam_id, status: "응시전" 
              });
            }
          } catch (e) {}

          await supabase.from("temp_admission_applicants").update({ status: "배정완료" }).eq("id", temp.id);
          successCount++;
        }
      }

      if (checkedFormalIds.length > 0) {
        for (const studentId of checkedFormalIds) {
          await supabase.from("admission_application").insert({
            admission_session_id: parseInt(selectedSessionId),
            student_id: studentId,
            application_status: "예약완료"
          });

          try {
            const { data: exSession } = await supabase.from("exam_session").select("session_id").eq("name", admSession.title).limit(1).maybeSingle();
            if (exSession && admSession.exam_id) {
              await supabase.from("exam_assignment").insert({ 
                student_id: studentId, session_id: exSession.session_id, exam_paper_id: admSession.exam_id, status: "응시전" 
              });
            }
          } catch (e) {}
          
          successCount++;
        }
      }

      alert(`🎉 총 ${successCount}명의 지원자가 성공적으로 예약 배정되었습니다!`);
      loadWaitingStudents();
      onSuccess();
    } catch (e: any) { alert(`❌ 오류: ${e.message}`); } finally { setIsLoading(false); }
  };

  const unassignStudent = async (studentId: string, studentName: string) => {
    if (!selectedSessionId) return;
    if (!confirm(`[${studentName}] 지원자의 테스트 예약을 취소하시겠습니까?`)) return;

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
              await supabase.from("student_exam_result").delete().eq("assignment_id", pk);
              await supabase.from("student_progress").delete().eq("assignment_id", pk);
              await supabase.from("admission_test_report").delete().eq("assignment_id", pk);
            }
            await supabase.from("exam_assignment").delete().eq("session_id", exSessId).eq("student_id", studentId);
          }
        }
      }

      const { error } = await supabase.from("admission_application").delete().eq("admission_session_id", selectedSessionId).eq("student_id", studentId);
      if (error) throw error;
      alert(`✅ 예약이 취소되었습니다.`);
      loadWaitingStudents();
      onSuccess();
    } catch (e: any) { alert(`❌ 취소 오류: ${e.message}`); }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/80 backdrop-blur-sm flex justify-center items-center p-4">
      <div className="bg-slate-50 w-full max-w-7xl h-[90vh] rounded-2xl shadow-2xl flex flex-col relative overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* 헤더 */}
        <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-xl font-bold">새 일정 만들기 및 일괄 배정 관리</h2>
            <p className="text-sm text-slate-300 mt-1">입학테스트 방을 생성하고 대기생들을 일괄적으로 배정합니다.</p>
          </div>
          <button onClick={onClose} className="bg-white/10 hover:bg-rose-500 text-white p-2 rounded-lg transition-colors group flex items-center gap-2 font-bold px-4">
            <span>닫기</span>
            <svg className="w-5 h-5 group-hover:rotate-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        {/* 본문 콘텐츠 - 좌우 그리드 */}
        <div className="flex-1 overflow-hidden p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* ==================================================== */}
          {/* 1. 방 개설 영역 */}
          {/* ==================================================== */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden relative">
            
            {!hasAdminPermission && (
              <div className="absolute inset-0 z-[55] bg-slate-100/70 backdrop-blur-[2px] flex flex-col items-center justify-center p-6 text-center">
                <div className="bg-white p-5 rounded-2xl shadow-lg border border-slate-200">
                  <span className="text-4xl mb-3 block">🔒</span>
                  <h4 className="font-bold text-slate-800 text-lg">접근 권한이 없습니다</h4>
                  <p className="text-sm text-slate-500 mt-2 font-medium">입학테스트 방 개설 및 삭제는<br/>원장, 실장만 가능합니다.</p>
                </div>
              </div>
            )}

            <div className={`${editSessionId ? 'bg-amber-700' : 'bg-[#002864]'} text-white p-3 shrink-0`}>
              <h3 className="font-bold text-sm">🗓️ 1. 방 {editSessionId ? "수정" : "개설"}</h3>
            </div>
            
            <div className="p-3 space-y-2 border-b border-slate-100 bg-slate-50 shrink-0">
              
              <div className="flex flex-col gap-1">
                <label className="block text-[11px] font-bold text-slate-700">테스트 방 코드 설정 <span className="text-red-500">*</span></label>
                <div className="flex space-x-1">
                  <span className="px-2 py-1.5 bg-slate-200 rounded border border-slate-300 font-extrabold text-slate-700 text-xs shrink-0 flex items-center">LT</span>
                  <select value={sGradeSem} onChange={(e) => setSGradeSem(e.target.value)} className="flex-1 px-1 py-1.5 rounded border border-slate-300 font-bold text-[11px] outline-none focus:border-[#002864]">
                    <option value="11">초1-1</option><option value="12">초1-2</option>
                    <option value="21">초2-1</option><option value="22">초2-2</option>
                    <option value="31">초3-1</option><option value="32">초3-2</option>
                    <option value="41">초4-1</option><option value="42">초4-2</option>
                    <option value="51">초5-1</option><option value="52">초5-2</option>
                    <option value="61">초6-1</option><option value="62">초6-2</option>
                    <option value="71">중1-1</option><option value="72">중1-2</option>
                  </select>
                  <select value={sCode} onChange={(e) => setSCode(e.target.value)} className="w-[40px] px-1 py-1.5 rounded border border-slate-300 font-bold text-[11px] outline-none focus:border-[#002864]">
                    <option value="A">A</option><option value="B">B</option>
                  </select>
                  <select value={sYear} onChange={(e) => setSYear(e.target.value)} className="w-[50px] px-1 py-1.5 rounded border border-slate-300 font-bold text-[11px] outline-none focus:border-[#002864]">
                    <option value="26">26년</option><option value="27">27년</option><option value="28">28년</option><option value="29">29년</option><option value="30">30년</option>
                  </select>
                  <select value={sMonth} onChange={(e) => setSMonth(e.target.value)} className="w-[45px] px-1 py-1.5 rounded border border-slate-300 font-bold text-[11px] outline-none focus:border-[#002864]">
                    {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map(m => (
                      <option key={m} value={m}>{m}월</option>
                    ))}
                  </select>
                </div>
                <div className="text-[10px] font-bold text-blue-800 text-right">미리보기: {previewName}</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">시험 날짜 <span className="text-red-500">*</span></label>
                  <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} className="w-full px-2 py-1.5 rounded border border-slate-300 font-bold text-[11px] outline-none focus:border-[#002864]" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">시작 시간 <span className="text-red-500">*</span></label>
                  <div className="flex space-x-1">
                    <select value={testHour} onChange={(e) => setTestHour(e.target.value)} className="w-1/2 px-1 py-1.5 rounded border border-slate-300 font-bold text-[11px] outline-none focus:border-[#002864]"><option value="">시</option>{hours.map(h => <option key={h} value={h}>{h}시</option>)}</select>
                    <select value={testMinute} onChange={(e) => setTestMinute(e.target.value)} className="w-1/2 px-1 py-1.5 rounded border border-slate-300 font-bold text-[11px] outline-none focus:border-[#002864]"><option value="">분</option>{minutes.map(m => <option key={m} value={m}>{m}분</option>)}</select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">사용할 시험지 <span className="text-red-500">*</span></label>
                  <select value={examId} onChange={handleExamChange} className="w-full px-2 py-1.5 rounded border border-slate-300 font-bold text-[11px] outline-none focus:border-[#002864]">
                    <option value="">시험지를 선택하세요</option>
                    {exams.map(e => <option key={e.exam_id} value={e.exam_id} className="truncate">{e.title} {e.sub_title ? `[${e.sub_title}]` : ''}</option>)}
                  </select>
                </div>
                <div className="min-w-0">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">시험 구분 코멘트</label>
                  <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="예: [초6/중1] 입학테스트 공통" className="w-full px-2 py-1.5 rounded border border-slate-300 font-bold text-slate-700 text-[11px] outline-none focus:border-[#002864]" />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={saveSession} disabled={isLoading || !hasAdminPermission} className={`flex-1 ${editSessionId ? 'bg-amber-600 hover:bg-amber-700' : 'bg-[#002864] hover:bg-blue-900'} text-white font-bold py-2 rounded shadow transition-colors text-xs`}>{isLoading ? "저장 중..." : (editSessionId ? "수정하기" : "개설하기")}</button>
                {editSessionId && <button onClick={cancelEdit} className="px-4 bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors font-bold rounded text-xs">취소</button>}
              </div>
            </div>
            
            <div className="p-2 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between">
               <div className="flex items-center gap-2 w-full">
                 <span className="text-[11px] font-bold text-slate-600 shrink-0 pl-1">🗓️ 날짜</span>
                 <select value={leftDateFilter} onChange={(e) => setLeftDateFilter(e.target.value)} className="flex-1 text-[11px] border border-slate-300 rounded px-2 py-1.5 font-bold text-slate-700 focus:ring-1 focus:ring-[#002864] outline-none">
                   <option value="all">전체 일정 보기</option>
                   {uniqueSessionDates.map(d => <option key={d as string} value={d as string}>{formatKoreanDate(d as string)}</option>)}
                 </select>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll">
              {filteredLeftSessions.length === 0 ? (
                 <div className="p-10 text-center text-slate-400 font-bold text-sm">해당 날짜에 개설된 일정이 없습니다.</div>
              ) : (
                filteredLeftSessions.map(s => {
                  const examTitle = s.exam_master ? `${s.exam_master.title} ${s.exam_master.sub_title ? `[${s.exam_master.sub_title}]` : ''}` : '시험지 미지정';
                  const isSelected = String(selectedSessionId) === String(s.admission_session_id);
                  const sessionDt = `${formatKoreanDate(s.test_date)} ${s.start_time?.substring(0, 5) || ''}`.trim();
                  const gradeStr = extractGradeFromTitle(s.title);

                  return (
                    <div key={s.admission_session_id} onClick={() => setSelectedSessionId(s.admission_session_id)} className={`px-4 py-2.5 border-b border-slate-100 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 border-blue-200 shadow-inner' : 'hover:bg-slate-50'}`}>
                      <div className="flex justify-between items-start mb-0.5">
                        <div className="text-[12px] font-extrabold text-slate-800 truncate leading-tight flex-1 mr-2">
                          {sessionDt} <span className="text-[#002864] ml-1">{s.title}</span> {gradeStr && <span className="text-emerald-600 ml-1">{gradeStr}</span>}
                        </div>
                        {hasAdminPermission && (
                          <div className="flex gap-1.5 shrink-0 ml-auto">
                            <button onClick={(e) => { e.stopPropagation(); handleEditClick(s); }} className="text-[10px] text-amber-600 hover:underline">수정</button>
                            <button onClick={(e) => { e.stopPropagation(); deleteSession(s.admission_session_id, s.title); }} className="text-[10px] text-rose-500 hover:underline">삭제</button>
                          </div>
                        )}
                      </div>
                      <div className="text-[11px] font-medium text-slate-500 truncate leading-tight">
                        📝 {examTitle} {s.session_comment && <span className="text-emerald-600 ml-1">💬 {s.session_comment}</span>}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ==================================================== */}
          {/* 2. 대기생 배정 영역 (우측) */}
          {/* ==================================================== */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="bg-emerald-700 text-white p-4 shrink-0">
              <h3 className="font-bold">👨‍🎓 2. 지원자 배정 관리</h3>
            </div>
            
            <div className="p-3 border-b border-slate-100 bg-slate-50 shrink-0 flex flex-wrap gap-1.5 items-center">
              <select 
                value={sessionDateFilter} 
                onChange={(e) => {
                  setSessionDateFilter(e.target.value);
                  setSelectedSessionId(""); 
                }}
                className="w-[85px] px-1.5 py-1.5 rounded border border-slate-300 font-bold text-[11px] text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 shadow-sm transition-all shrink-0"
              >
                <option value="">🗓️ 날짜</option>
                {uniqueSessionDates.map(d => (
                  <option key={d as string} value={d as string}>{formatKoreanDate(d as string)}</option>
                ))}
              </select>

              <select 
                value={sessionTimeFilter} 
                onChange={(e) => {
                  setSessionTimeFilter(e.target.value);
                  setSelectedSessionId(""); 
                }}
                className="w-[75px] px-1.5 py-1.5 rounded border border-slate-300 font-bold text-[11px] text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 shadow-sm transition-all shrink-0"
              >
                <option value="">⏰ 시간</option>
                {uniqueSessionTimes.map(t => (
                  <option key={t as string} value={t as string}>{t as string}</option>
                ))}
              </select>

              <div className="flex gap-1 shrink-0 bg-white border border-slate-300 rounded p-0.5 shadow-sm">
                <button 
                  onClick={() => setSessionSortOrder(prev => prev === "asc" ? "desc" : "asc")}
                  className="px-2 py-1 rounded hover:bg-slate-100 text-[10px] font-bold text-slate-600 transition-colors"
                  title="시간 오름차순/내림차순"
                >
                  시간 {sessionSortOrder === "asc" ? "🔼" : "🔽"}
                </button>
                <div className="w-px bg-slate-200 my-1"></div>
                <button 
                  onClick={() => setSessionGradeOrder(prev => prev === "asc" ? "desc" : "asc")}
                  className="px-2 py-1 rounded hover:bg-slate-100 text-[10px] font-bold text-slate-600 transition-colors"
                  title="학년 오름차순/내림차순"
                >
                  학년 {sessionGradeOrder === "asc" ? "🔼" : "🔽"}
                </button>
              </div>

              <select 
                value={selectedSessionId} 
                onChange={(e) => setSelectedSessionId(e.target.value)} 
                className="flex-1 min-w-[120px] px-2 py-1.5 rounded border border-emerald-400 font-bold text-[11px] text-emerald-800 focus:outline-none focus:ring-1 focus:ring-emerald-600 shadow-sm transition-all text-ellipsis"
              >
                <option value="">일정 선택</option>
                {[...sessions]
                  .filter(s => {
                    const matchDate = !sessionDateFilter || s.test_date === sessionDateFilter;
                    const matchTime = !sessionTimeFilter || (s.start_time && s.start_time.substring(0, 5) === sessionTimeFilter);
                    return matchDate && matchTime;
                  })
                  .sort((a, b) => {
                     const dtA = new Date(`${a.test_date}T${a.start_time || '00:00:00'}`).getTime();
                     const dtB = new Date(`${b.test_date}T${b.start_time || '00:00:00'}`).getTime();
                     
                     if (!isNaN(dtA) && !isNaN(dtB) && dtA !== dtB) {
                       return sessionSortOrder === "asc" ? dtA - dtB : dtB - dtA;
                     }

                     const matchA = a.title.match(/LT(\d{2})/);
                     const matchB = b.title.match(/LT(\d{2})/);
                     const numA = matchA ? parseInt(matchA[1], 10) : 9999;
                     const numB = matchB ? parseInt(matchB[1], 10) : 9999;
                     
                     if (numA !== numB) {
                       return sessionGradeOrder === "asc" ? numA - numB : numB - numA;
                     }
                     
                     return a.title.localeCompare(b.title);
                  })
                  .map(s => (
                    <option key={s.admission_session_id} value={s.admission_session_id}>
                      [{formatKoreanDate(s.test_date)} {s.start_time?.substring(0,5)}] {s.title} {s.session_comment ? `- ${s.session_comment}` : ''}
                    </option>
                  ))
                }
              </select>
            </div>

            <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="font-bold text-slate-700 text-[11px] whitespace-nowrap mr-1">📝 명단</h3>
                
                <select 
                  value={gradeFilter} 
                  onChange={(e) => setGradeFilter(e.target.value)} 
                  className="text-[11px] border border-slate-300 rounded px-1.5 py-1 focus:ring-1 focus:ring-emerald-600 font-bold text-slate-600 outline-none shadow-sm cursor-pointer bg-slate-50"
                >
                  <option value="all">학년</option>
                  {Array.from(new Set(waitingStudents.map(s => s.grade)))
                    .sort((a, b) => getGradeOrder(a) - getGradeOrder(b))
                    .map(g => (
                      <option key={g} value={g as string}>{formatKoreanGrade(g)}</option>
                    ))}
                </select>

                <select 
                  value={dateFilter} 
                  onChange={(e) => setDateFilter(e.target.value)} 
                  className="text-[11px] border border-slate-300 rounded px-1.5 py-1 focus:ring-1 focus:ring-emerald-600 font-bold text-slate-600 outline-none shadow-sm cursor-pointer bg-slate-50"
                >
                  <option value="all">신청일</option>
                  {uniqueDates.map(d => (
                    <option key={d} value={d as string}>{d as string}</option>
                  ))}
                </select>

                <input 
                  type="text" 
                  placeholder="이름, 연락처" 
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  className="text-[11px] border border-slate-300 rounded px-2 py-1 focus:ring-1 focus:ring-emerald-600 font-bold text-slate-600 outline-none shadow-sm bg-slate-50 w-24 sm:w-28"
                />
              </div>
              
              <label className="flex items-center space-x-1 cursor-pointer text-[10px] text-slate-600 font-bold bg-slate-100 border border-slate-200 px-2 py-1 rounded hover:bg-slate-200 transition-colors shadow-sm whitespace-nowrap ml-1">
                <input type="checkbox" checked={isAllChecked} onChange={(e) => toggleCheckAll(e.target.checked)} className="w-3 h-3 accent-emerald-600" />
                <span>전체선택</span>
              </label>
            </div>

            <div className="flex-1 overflow-y-auto p-3 custom-scroll space-y-2 bg-slate-50">
              {!selectedSessionId ? <div className="text-center text-slate-400 py-10 text-xs font-medium">일정을 선택하면 명단이 나타납니다.</div> :
               filteredStudents.length === 0 ? <div className="text-center text-slate-400 py-10 text-xs font-medium">조건에 맞는 대기생이 없습니다.</div> :
               filteredStudents.map(std => {
                 const stdId = std.id; 
                 const isAssigned = std.isAssigned;
                 const korGradeName = formatKoreanGrade(std.grade);

                 const sourceBadge = std.source === 'temp' 
                   ? <span className="text-[9px] bg-blue-100 text-blue-700 border border-blue-200 px-1 py-0.5 rounded font-bold shrink-0">📝 폼제출</span>
                   : <span className="text-[9px] bg-purple-100 text-purple-700 border border-purple-200 px-1 py-0.5 rounded font-bold shrink-0">👤 신규생</span>;

                 const isTodayReg = std.created_at ? getKSTDateStr(std.created_at) === todayKst : false;

                 if (isAssigned) {
                   return (
                     <div key={stdId} className="flex items-center justify-between p-2.5 bg-white border-2 border-emerald-400 rounded-lg shadow-sm gap-2">
                       <div className="flex items-center space-x-2.5 min-w-0">
                         <div className="w-4 h-4 flex items-center justify-center bg-emerald-500 rounded text-white text-[10px] font-bold shrink-0">✓</div>
                         <div className="flex flex-col min-w-0 gap-0.5">
                           <div className="flex items-center gap-1">
                             <span className="font-extrabold text-slate-800 truncate text-[13px]">{std.student_name}</span>
                             <span className="text-[9px] bg-[#002864] text-white px-1 py-0.5 rounded font-bold shrink-0">{korGradeName}</span>
                             <span className="text-[9px] bg-emerald-100 text-emerald-700 border border-emerald-200 px-1 py-0.5 rounded font-bold shrink-0">✅ 배정됨</span>
                             {isTodayReg && <span className="text-[9px] bg-rose-100 text-rose-600 border border-rose-200 px-1 py-0.5 rounded font-extrabold shrink-0">🔥오늘등록</span>}
                           </div>
                           <div className="text-[10px] text-slate-400 font-medium truncate flex items-center gap-1">
                             <span>🏫 {std.school_name || "미입력"}</span>
                             <span className="text-slate-300">|</span>
                             <span>📞 {formatContact(std.contact)}</span>
                           </div>
                         </div>
                       </div>
                       <div className="flex items-center gap-1 shrink-0">
                         <button onClick={() => unassignStudent(stdId, std.student_name)} className="text-[10px] bg-white hover:bg-red-50 text-red-500 border border-slate-200 hover:border-red-200 px-2 py-1 rounded font-bold transition-colors shadow-sm">
                           취소
                         </button>
                       </div>
                     </div>
                   )
                 } else {
                   return (
                     <label key={stdId} className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 shadow-sm transition-all gap-2">
                       <div className="flex items-center space-x-2.5 min-w-0">
                         <input type="checkbox" checked={checkedStudents.includes(stdId)} onChange={() => toggleStudentCheck(stdId)} className="w-3.5 h-3.5 accent-emerald-600 shrink-0" />
                         <div className="flex flex-col min-w-0 gap-0.5">
                           <div className="flex items-center gap-1">
                             <span className="font-bold text-slate-800 truncate text-[13px]">{std.student_name}</span>
                             <span className="text-[9px] bg-[#002864] text-white px-1 py-0.5 rounded font-bold shrink-0">{korGradeName}</span>
                             {sourceBadge}
                             {/* 🌟 앗! 이 학생은 다른 방에 들어가 있는 학생이네요! (중복 배정 가능) */}
                             {std.isAssignedOther && <span className="text-[9px] bg-amber-100 text-amber-700 border border-amber-200 px-1 py-0.5 rounded font-extrabold shrink-0">🔄 타 일정 중복</span>}
                             {isTodayReg && <span className="text-[9px] bg-rose-100 text-rose-600 border border-rose-200 px-1 py-0.5 rounded font-extrabold shrink-0">🔥오늘등록</span>}
                           </div>
                           <div className="text-[10px] text-slate-500 font-medium truncate flex items-center gap-1">
                             <span>🏫 {std.school_name || "-"}</span>
                             <span className="text-slate-300">|</span>
                             <span>📅 {formatTestDate(std.test_date) || "-"}</span>
                             <span className="text-slate-300">|</span>
                             <span>📞 {formatContact(std.contact)}</span>
                           </div>
                         </div>
                       </div>
                     </label>
                   )
                 }
               })
              }
            </div>

            <div className="p-3 bg-white border-t border-slate-200 shrink-0">
              <button onClick={assignStudents} disabled={isLoading || !selectedSessionId} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded text-xs shadow-md transition-colors disabled:opacity-50">
                선택한 대기생 배정 완료하기 ✅
              </button>
            </div>
           </div>

        </div>
      </div>
    </div>
  );
}