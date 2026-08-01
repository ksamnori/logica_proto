// src/app/(dashboard)/exam-list/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getExamsAction, deleteExamAction } from "@/app/actions/examActions"; // 💡 서버 액션 임포트

// 분리된 모달 컴포넌트 임포트
import PublishModal from "@/components/exam/PublishModal";
import GradingModal from "@/components/exam/GradingModal";

export default function ExamListPage() {
  const router = useRouter();

  // === 메인 데이터 상태 ===
  const [exams, setExams] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // === 필터 상태 ===
  const [filterGrade, setFilterGrade] = useState("ALL");
  const [filterType, setFilterType] = useState("ALL");
  const [filterCreator, setFilterCreator] = useState("ALL");

  // === 모달 상태 ===
  const [publishModal, setPublishModal] = useState<{ isOpen: boolean; examId: string; title: string }>({ isOpen: false, examId: "", title: "" });
  const [gradingModal, setGradingModal] = useState<{ isOpen: boolean; examId: string; title: string }>({ isOpen: false, examId: "", title: "" });

  // 💡 최고관리자(SUPER_ADMIN) 여부 상태
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    // 💡 마운트 시 권한 체크: '원장'도 제외하고 오직 'SUPER_ADMIN', '최고관리자'만 허용
    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    const isSuper = role.toUpperCase() === "SUPER_ADMIN" || pos.includes("최고관리자");
    setIsSuperAdmin(isSuper);

    loadExams();
  }, []);

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const d = new Date(dateString);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  // 💡 서버 액션을 통한 안전한 데이터 조회
  const loadExams = async () => {
    setIsLoading(true);
    const result = await getExamsAction();
    if (result.success) {
      setExams(result.data);
    } else {
      alert(result.message);
    }
    setIsLoading(false);
  };

  // 안전한 구조분해 및 필터 목록 생성
  const uniqueGrades = useMemo(() => Array.from(new Set(exams.map(e => e.major_grade).filter(Boolean))).sort(), [exams]);
  const uniqueTypes = useMemo(() => Array.from(new Set(exams.map(e => e.exam_type || '평가'))).sort(), [exams]);
  const uniqueCreators = useMemo(() => {
    return Array.from(new Set(exams.map(e => {
      // 💡 배열 형태로 넘어올 경우를 대비한 안전한 처리
      const instructor = Array.isArray(e.instructor) ? e.instructor[0] : e.instructor;
      return instructor?.name || '시스템 선생님';
    }))).sort();
  }, [exams]);

  const filteredExams = useMemo(() => {
    return exams.filter(exam => {
      const matchGrade = filterGrade === 'ALL' || exam.major_grade === filterGrade;
      const matchType = filterType === 'ALL' || (exam.exam_type || '평가') === filterType;
      
      const instructor = Array.isArray(exam.instructor) ? exam.instructor[0] : exam.instructor;
      const creatorName = instructor?.name || '시스템 선생님';
      
      const matchCreator = filterCreator === 'ALL' || creatorName === filterCreator;
      return matchGrade && matchType && matchCreator;
    });
  }, [exams, filterGrade, filterType, filterCreator]);

  const resetFilters = () => {
    setFilterGrade("ALL"); setFilterType("ALL"); setFilterCreator("ALL");
  };

  // 💡 서버 액션을 통한 안전한 삭제 처리
  const deleteExam = async (examId: string) => {
    if (!confirm("⚠️ 이 문제지를 정말 삭제하시겠습니까?\n(삭제하면 복구할 수 없습니다.)")) return;
    
    const result = await deleteExamAction(examId);
    if (result.success) {
      alert(result.message);
      loadExams(); // 삭제 성공 시 목록 새로고침
    } else {
      alert(result.message);
    }
  };

  const createNewExam = () => {
    sessionStorage.removeItem('editExamId');
    sessionStorage.removeItem('duplicateExamId');
    router.push('/exam/step1'); 
  };

  const editExam = (examId: string) => {
    sessionStorage.setItem('editExamId', examId);
    sessionStorage.removeItem('duplicateExamId');
    router.push(`/exam/step2?exam_id=${examId}`);
  };

  // 💡 최고관리자 전용 강제 수정 핸들러
  const handleForceEdit = (examId: string) => {
    if (confirm("🚨 경고: 이미 배부되어 학생이 풀고 있을 수 있는 시험지입니다!\n강제 수정 시 기존 문항 및 채점 기록과 충돌이 발생할 수 있습니다.\n\n정말 강제로 수정하시겠습니까? (최고관리자 전용 기능)")) {
      editExam(examId);
    }
  };

  const duplicateAndEditExam = (examId: string) => {
    sessionStorage.setItem('duplicateExamId', examId);
    sessionStorage.removeItem('editExamId');
    router.push(`/exam/step2?duplicate_exam_id=${examId}`);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-6 overflow-hidden relative">
      
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">📝 생성된 문제지 보관함</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">출제된 모든 시험지와 학생들의 채점 및 출제 현황을 관리합니다.</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 shrink-0 flex-wrap justify-between">
        <div className="flex items-center gap-3">
          <span className="font-bold text-slate-600 text-sm mr-2">🔍 검색 필터</span>
          <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
            <option value="ALL">학년 전체</option>
            {uniqueGrades.map(g => <option key={g} value={g as string}>{g as string}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
            <option value="ALL">유형 전체</option>
            {uniqueTypes.map(t => <option key={t} value={t as string}>{t as string}</option>)}
          </select>
          <select value={filterCreator} onChange={e => setFilterCreator(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
            <option value="ALL">출제자 전체</option>
            {uniqueCreators.map(c => <option key={c} value={c as string}>{c as string}</option>)}
          </select>
          <button onClick={resetFilters} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-lg transition-colors border border-slate-300 flex items-center gap-1">
            🔄 초기화
          </button>
        </div>
        <button onClick={createNewExam} className="px-5 py-2.5 bg-[#002864] text-white font-bold text-sm rounded-lg hover:bg-blue-900 transition-colors shadow-sm flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
          새 문제지 만들기
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="overflow-y-auto flex-1 custom-scroll">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm text-center w-24">학년 범위</th>
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm text-center w-28">유형</th>
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm">시험지 제목 및 범위</th>
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm text-center">생성일</th>
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm text-center">출제자</th>
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm text-right">관리 액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400 font-bold">로딩 중...</td></tr>
              ) : filteredExams.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400 font-bold">조건에 맞는 문제지가 없습니다.</td></tr>
              ) : (
                filteredExams.map(exam => {
                  const instructor = Array.isArray(exam.instructor) ? exam.instructor[0] : exam.instructor;
                  const creatorName = instructor?.name ? `${instructor.name} 선생님` : '시스템 선생님';
                  const targetGrade = exam.major_grade || '공통 과정';
                  const diff = exam.avg_difficulty || '중';
                  
                  let scope = '전 범위';
                  if (exam.scope_start && exam.scope_end) scope = (exam.scope_start === exam.scope_end) ? exam.scope_start : `${exam.scope_start} ~ ${exam.scope_end}`;
                  else if (exam.scope_start) scope = exam.scope_start;

                  const isDistributed = exam.exam_assignment ? exam.exam_assignment.length > 0 : false;
                  
                  const createdTime = new Date(exam.created_at).getTime();
                  const isNew = !isNaN(createdTime) && ((Date.now() - createdTime) / (1000 * 3600 * 24)) <= 2;

                  return (
                    <tr key={exam.exam_id} className="hover:bg-blue-50/30 transition-colors border-b border-slate-100">
                      <td className="py-4 px-5 text-center"><span className="font-extrabold text-slate-600 text-sm">{targetGrade}</span></td>
                      <td className="py-4 px-5 text-center"><span className="bg-slate-100 border border-slate-200 text-slate-600 px-2.5 py-1 rounded text-xs font-bold shadow-sm">{exam.exam_type || '평가'}</span></td>
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-2 mb-1">
                          <button onClick={() => router.push(`/exam/viewer?exam_id=${exam.exam_id}`)} className="font-extrabold text-[#002864] text-[15px] hover:underline hover:text-blue-600 transition-colors text-left">{exam.title}</button>
                          {exam.sub_title && exam.sub_title !== '-' && <span className="bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded text-[11px] font-extrabold shadow-sm">{exam.sub_title}</span>}
                          {isNew && <span className="text-[10px] font-black text-blue-500 tracking-tighter bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">NEW</span>}
                        </div>
                        <div className="text-[12px] font-bold text-amber-600 tracking-tight flex items-center gap-1.5">
                          <span>{exam.total_questions || 0}문제</span><span className="text-amber-300">|</span><span>{diff}</span><span className="text-amber-300">|</span><span className="truncate max-w-[250px]" title={scope}>{scope}</span>
                        </div>
                      </td>
                      <td className="py-4 px-5 text-center text-slate-500 font-bold text-xs">{formatDate(exam.created_at)}</td>
                      <td className="py-4 px-5 text-center text-slate-600 font-bold text-xs">{creatorName}</td>
                      <td className="py-4 px-5">
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <button onClick={() => setPublishModal({ isOpen: true, examId: exam.exam_id, title: exam.title })} className="w-[64px] shrink-0 py-1.5 bg-[#002864] hover:bg-blue-900 text-white rounded text-[11px] font-bold shadow-sm transition-colors text-center px-0">출제하기</button>
                          <button onClick={() => setGradingModal({ isOpen: true, examId: exam.exam_id, title: exam.title })} className="w-[64px] shrink-0 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded text-[11px] font-bold shadow-sm transition-colors text-center px-0">출제현황</button>
                          
                          {/* 💡 이미 출제된 시험지일 경우 권한에 따른 버튼 분기 처리 */}
                          {isDistributed ? (
                            isSuperAdmin ? (
                              <button onClick={() => handleForceEdit(exam.exam_id)} className="w-[60px] shrink-0 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded text-[11px] font-bold shadow-sm transition-colors border border-rose-200 text-center px-0" title="최고관리자 전용 강제 수정">🚨 강제수정</button>
                            ) : (
                              <button disabled className="w-[60px] shrink-0 py-1.5 bg-slate-50 text-slate-400 rounded text-[11px] font-bold cursor-not-allowed border border-slate-200 text-center px-0" title="이미 출제되어 수정할 수 없습니다">🔒 수정불가</button>
                            )
                          ) : (
                            <button onClick={() => editExam(exam.exam_id)} className="w-[60px] shrink-0 py-1.5 bg-white hover:bg-slate-50 text-slate-600 rounded text-[11px] font-bold shadow-sm transition-colors border border-slate-300 text-center px-0">수정</button>
                          )}

                          <button onClick={() => duplicateAndEditExam(exam.exam_id)} className="w-[76px] shrink-0 py-1.5 bg-white hover:bg-indigo-50 text-indigo-600 rounded text-[11px] font-bold shadow-sm transition-colors border border-indigo-200 text-center px-0">복제후수정</button>
                          
                          <button onClick={() => deleteExam(exam.exam_id)} className="w-[48px] shrink-0 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded text-[11px] font-bold shadow-sm transition-colors border border-rose-200 text-center px-0">삭제</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PublishModal 
        isOpen={publishModal.isOpen} 
        examId={publishModal.examId} 
        title={publishModal.title} 
        onClose={() => setPublishModal({ isOpen: false, examId: "", title: "" })} 
        onSuccess={loadExams} 
      />

      <GradingModal 
        isOpen={gradingModal.isOpen} 
        examId={gradingModal.examId} 
        title={gradingModal.title} 
        onClose={() => setGradingModal({ isOpen: false, examId: "", title: "" })} 
        onUpdate={loadExams} 
      />
    </div>
  );
}