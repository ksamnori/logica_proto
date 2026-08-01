// src/components/admission/AssignModal.tsx
"use client";

import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface AssignModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: any;
  onSuccess: () => void;
  formatGrade: (grade: any) => string;
  getGradeOrder: (g: any) => number;
}

// 💡 ISO 시간 문자열 변환 (접수일자 출력용)
const formatDateTime = (isoString: string) => {
  if (!isoString) return "-";
  const d = new Date(isoString);
  const yy = String(d.getFullYear()).slice(2);
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${yy}.${MM}.${dd} ${hh}:${mm}`;
};

// 💡 LevelTestModal과 동일한 날짜 추출 로직 이식 (T 분리 및 8자리 숫자 처리)
const formatTestDate = (val: any) => {
  if (!val) return "";
  const str = String(val).trim();
  if (str.includes("T")) return str.split("T")[0]; 
  if (str.length === 8 && !isNaN(Number(str))) return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6)}`; 
  return str; 
};

// 💡 직관적인 학년 포맷터
const formatKoreanGrade = (grade: any) => {
  if (!grade) return '-';
  if (String(grade) === "7") return "7세";
  if (typeof grade === 'string' && grade.includes('세')) return grade;
  const num = parseInt(grade, 10);
  if (isNaN(num)) return String(grade);
  if (num >= 1 && num <= 6) return `초${num}`;
  if (num >= 7 && num <= 9) return `중${num - 6}`;
  if (num >= 10 && num <= 12) return `고${num - 9}`;
  return String(grade);
};

export default function AssignModal({ isOpen, onClose, session, onSuccess, getGradeOrder }: AssignModalProps) {
  const [waitingStudents, setWaitingStudents] = useState<any[]>([]);
  const [selectedWaitingIds, setSelectedWaitingIds] = useState<string[]>([]);
  
  // 💡 필터 상태: 시간 필터 제거하고 날짜 필터(filterDate) 하나만 사용
  const [filterGrade, setFilterGrade] = useState("all");
  const [filterDate, setFilterDate] = useState("all");
  const [searchKeyword, setSearchKeyword] = useState("");
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && session) {
      loadWaitings();
      setFilterGrade("all");
      setFilterDate("all");
      setSearchKeyword("");
      setSelectedWaitingIds([]);
    }
  }, [isOpen, session]);

  const loadWaitings = async () => {
    try {
      const { data: apps } = await supabase.from('admission_application').select('student_id').eq('admission_session_id', session.admission_session_id);
      const assignedIds = apps ? apps.map(a => a.student_id) : [];
      
      // 1. 폼제출 (임시 대기생) 로드
      const { data: tempStus } = await supabase
        .from("temp_admission_applicants")
        .select("*")
        .neq("status", "배정완료");

      const waitingTempList = (tempStus || []).map((s: any) => ({
        id: s.id,
        student_name: s.student_name,
        grade: s.grade || "미입력",
        school_name: s.school_name || "",
        contact: s.contact,
        test_date: s.test_date, // 💡 raw 데이터 그대로 저장
        created_at: s.created_at,
        source: 'temp'
      }));
      
      // 2. 신규생 (정식 대기생) 로드
      const { data: formalStus } = await supabase
        .from('student')
        .select('student_id, name, grade, school, school_name, created_at, test_date, parent(phone)')
        .eq('status', '입학테스트')
        .order('created_at', { ascending: true });
        
      const waitingFormalList = (formalStus || [])
        .filter((s: any) => !assignedIds.includes(s.student_id))
        .map((s: any) => ({
          id: s.student_id,
          student_name: s.name,
          grade: s.grade || "미입력",
          school_name: s.school_name || s.school || "",
          contact: Array.isArray(s.parent) ? s.parent[0]?.phone : (s.parent?.phone || "번호없음"),
          test_date: s.test_date, // 💡 raw 데이터 그대로 저장
          created_at: s.created_at,
          source: 'student'
        }));

      setWaitingStudents([...waitingTempList, ...waitingFormalList]);
    } catch (e: any) { alert(`오류 발생: ${e.message}`); }
  };

  // 💡 LevelTestModal과 동일한 날짜 필터링 로직 적용
  const filteredWaiting = useMemo(() => {
    return waitingStudents.filter(s => {
      const matchGrade = filterGrade === 'all' || formatKoreanGrade(s.grade) === filterGrade;
      
      // formatTestDate를 이용해 YYYY-MM-DD 형태의 문자열로 비교
      const dateVal = formatTestDate(s.test_date) || "날짜없음";
      const matchDate = filterDate === 'all' || dateVal === filterDate;
      
      const keyword = searchKeyword.toLowerCase().trim();
      const school = s.school_name || "";
      const phone = s.contact || "";
      
      const matchKeyword = !keyword || 
        (s.student_name && s.student_name.toLowerCase().includes(keyword)) ||
        school.toLowerCase().includes(keyword) ||
        phone.includes(keyword);

      return matchGrade && matchDate && matchKeyword;
    });
  }, [waitingStudents, filterGrade, filterDate, searchKeyword]);

  // 💡 Select 박스용 날짜 추출 (중복 제거 및 정렬)
  const uniqueGrades = Array.from(new Set(waitingStudents.map(s => formatKoreanGrade(s.grade)).filter(Boolean))).sort((a, b) => getGradeOrder(a) - getGradeOrder(b));
  const uniqueDates = Array.from(
    new Set(waitingStudents.map(s => formatTestDate(s.test_date) || "날짜없음").filter(d => d !== "날짜없음"))
  ).sort();

  const isAllWaitingChecked = filteredWaiting.length > 0 && filteredWaiting.every(s => selectedWaitingIds.includes(s.id));

  const toggleWaitingCheck = (id: string) => setSelectedWaitingIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  const toggleAllWaiting = (checked: boolean) => {
    if (checked) {
      const newIds = new Set([...selectedWaitingIds, ...filteredWaiting.map(s => s.id)]);
      setSelectedWaitingIds(Array.from(newIds));
    } else {
      const filteredIds = filteredWaiting.map(s => s.id);
      setSelectedWaitingIds(selectedWaitingIds.filter(id => !filteredIds.includes(id)));
    }
  };

  const submitAssign = async () => {
    if (selectedWaitingIds.length === 0) return alert("배정할 학생을 최소 1명 선택해주세요.");
    setIsSubmitting(true);
    
    try {
      const sessionId = session.admission_session_id;
      const examId = session.exam_id;
      let successCount = 0;

      const checkedTempIds = selectedWaitingIds.filter(id => waitingStudents.find(w => w.id === id && w.source === 'temp'));
      const checkedFormalIds = selectedWaitingIds.filter(id => waitingStudents.find(w => w.id === id && w.source === 'student'));

      if (checkedTempIds.length > 0) {
        const { data: tempStudents, error: tempErr } = await supabase.from("temp_admission_applicants").select("*").in("id", checkedTempIds);
        if (tempErr || !tempStudents) throw new Error("대기생 정보를 불러올 수 없습니다.");

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
            school_name: temp.school_name,
            school: temp.school_name,
            parent_id: parentId,
            status: "입학테스트"
          }).select().single();

          if (sErr) throw new Error(`[${temp.student_name}] 등록 실패: ${sErr.message}`);
          
          const newStudentId = newStudent.student_id;

          await supabase.from("admission_application").insert({ admission_session_id: sessionId, student_id: newStudentId, application_status: "예약완료" });

          try {
            const { data: exSession } = await supabase.from("exam_session").select("session_id").eq("name", session.title).limit(1).maybeSingle();
            if (exSession && examId) {
              await supabase.from("exam_assignment").insert({ student_id: newStudentId, session_id: exSession.session_id, exam_paper_id: examId, status: "응시전" });
            }
          } catch (e) {}

          await supabase.from("temp_admission_applicants").update({ status: "배정완료" }).eq("id", temp.id);
          successCount++;
        }
      }

      if (checkedFormalIds.length > 0) {
        for (const studentId of checkedFormalIds) {
          await supabase.from("admission_application").insert({ admission_session_id: sessionId, student_id: studentId, application_status: "예약완료" });

          try {
            const { data: exSession } = await supabase.from("exam_session").select("session_id").eq("name", session.title).limit(1).maybeSingle();
            if (exSession && examId) {
              await supabase.from("exam_assignment").insert({ student_id: studentId, session_id: exSession.session_id, exam_paper_id: examId, status: "응시전" });
            }
          } catch (e) {}
          successCount++;
        }
      }

      alert(`🎉 총 ${successCount}명의 대기생이 성공적으로 배정되었습니다!`);
      onSuccess();
      onClose();
    } catch (e: any) {
      alert(`❌ 오류: ${e.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col h-[750px] max-h-[90vh]">
        
        {/* 헤더 */}
        <div className="bg-[#002864] text-white p-5 flex justify-between items-center shrink-0">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">👨‍🎓 입학 대기생 배정하기</h3>
            <p className="text-blue-200 text-xs mt-1">{session.title} 방에 배정합니다.</p>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-white transition-colors text-2xl leading-none">&times;</button>
        </div>
        
        {/* 💡 3단 필터 영역 (학년 + 희망날짜 + 검색어) */}
        <div className="p-3 bg-white border-b border-slate-200 flex gap-2 shrink-0 relative z-10 flex-wrap">
          <select 
            value={filterGrade} 
            onChange={(e) => setFilterGrade(e.target.value)} 
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm font-bold text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#002864] w-32"
          >
            <option value="all">🎓 전체 학년</option>
            {uniqueGrades.map(g => <option key={g} value={g as string}>{g}</option>)}
          </select>

          {/* LevelTestModal과 동일한 날짜 필터 셀렉트 */}
          <select 
            value={filterDate} 
            onChange={(e) => setFilterDate(e.target.value)} 
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm font-bold text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#002864] w-36"
          >
            <option value="all">🗓️ 전체 날짜</option>
            {uniqueDates.map(d => <option key={d} value={d as string}>{d}</option>)}
          </select>

          <div className="relative flex-1 min-w-[180px]">
            <input 
              type="text" 
              placeholder="이름, 학교, 연락처 검색" 
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#002864] transition-colors"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          </div>
        </div>

        {/* 요약 및 전체선택 바 */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
          <span className="text-sm font-bold text-slate-700">
            검색된 대기생: <span className="text-[#002864]">{filteredWaiting.length}</span>명
          </span>
          <label className="flex items-center space-x-1.5 cursor-pointer text-xs text-slate-600 font-bold bg-white border border-slate-300 px-2.5 py-1.5 rounded hover:bg-slate-50 transition-colors shadow-sm">
            <input type="checkbox" checked={isAllWaitingChecked} onChange={(e) => toggleAllWaiting(e.target.checked)} className="w-3.5 h-3.5 accent-[#002864]" />
            <span>현재 목록 전체 선택</span>
          </label>
        </div>

        {/* 대기생 리스트 */}
        <div className="flex-1 overflow-y-auto custom-scroll p-4 bg-slate-50">
          <div className="space-y-2">
            {filteredWaiting.length === 0 ? (
              <div className="text-center text-slate-400 py-10 font-bold text-sm">조건에 맞는 대기생이 없습니다.</div>
            ) : (
              filteredWaiting.map(std => {
                const sourceBadge = std.source === 'temp' 
                  ? <span className="text-[10px] bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-bold shrink-0">📝 폼제출</span>
                  : <span className="text-[10px] bg-purple-100 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded font-bold shrink-0">👤 신규생</span>;

                return (
                  <label key={std.id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg cursor-pointer hover:bg-blue-50 shadow-sm transition-all hover:border-blue-300 gap-2">
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <input type="checkbox" checked={selectedWaitingIds.includes(std.id)} onChange={() => toggleWaitingCheck(std.id)} className="w-4 h-4 accent-[#002864] shrink-0" />
                      
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="font-extrabold text-slate-800 text-[14px] shrink-0">{std.student_name}</span>
                        {sourceBadge}
                        <span className="text-[10px] bg-[#002864] text-white px-1.5 py-0.5 rounded font-bold shrink-0">{formatKoreanGrade(std.grade)}</span>
                        
                        <span className="text-slate-200 shrink-0">|</span>
                        <span className="text-[12px] text-slate-600 font-bold truncate">🏫 {std.school_name || '학교미입력'}</span>
                        
                        <span className="text-slate-200 shrink-0 hidden sm:inline-block">|</span>
                        <span className="text-[11px] text-[#002864] font-black shrink-0 hidden sm:inline-block bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                          📅 {formatTestDate(std.test_date) || "날짜없음"}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className="text-[11px] font-black text-slate-500 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                        📞 {std.contact}
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium">접수: {formatDateTime(std.created_at)}</span>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* 하단 배정 버튼 */}
        <div className="p-4 bg-white border-t border-slate-200 shrink-0">
          <button 
            onClick={submitAssign} 
            disabled={isSubmitting || selectedWaitingIds.length === 0} 
            className="w-full bg-[#002864] hover:bg-blue-900 text-white font-extrabold py-3.5 rounded-xl shadow-md transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "배정 중... ⏳" : `✅ 선택한 대기생 배정 완료하기 (${selectedWaitingIds.length}명)`}
          </button>
        </div>

      </div>
    </div>
  );
}