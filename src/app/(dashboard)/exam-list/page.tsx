// src/app/(dashboard)/exam-list/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getExamsAction, deleteExamAction } from "@/app/actions/examActions";
import { supabase } from "@/lib/supabase"; 

// 분리된 모달 컴포넌트 임포트
import PublishModal from "@/components/exam/PublishModal";
import GradingModal from "@/components/exam/GradingModal";

export default function ExamListPage() {
  const router = useRouter();

  // 🌟 [보안 로직 추가] 권한 확인 상태
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  // === 메인 데이터 상태 ===
  const [exams, setExams] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // === 🌟 4분류 메인 탭 필터 상태 ===
  const [mainTab, setMainTab] = useState<'ALL' | 'EXAM' | 'HOMEWORK' | 'INCORRECT' | 'SIMILAR'>('ALL');

  // === 서브 필터 상태 ===
  const [filterGrade, setFilterGrade] = useState("ALL");
  const [filterCreator, setFilterCreator] = useState("ALL");

  // === 모달 상태 ===
  const [publishModal, setPublishModal] = useState<{ isOpen: boolean; examId: string; title: string }>({ isOpen: false, examId: "", title: "" });
  const [gradingModal, setGradingModal] = useState<{ isOpen: boolean; examId: string; title: string }>({ isOpen: false, examId: "", title: "" });

  // === 권한(SUPER_ADMIN 및 삭제 권한) 여부 상태 ===
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [canDeleteExam, setCanDeleteExam] = useState(false);

  // 🌟 컴포넌트 마운트 시 권한 검사
  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || 
                        pos.includes('최고관리자') || pos.includes('대장') || pos.includes('원장');
      
      setIsSuperAdmin(isGodMode);

      if (isGodMode) {
        setIsAuthorized(true);
        setCanDeleteExam(true);
        return;
      }

      if (!tId || !role) {
         alert("권한 정보가 없습니다.");
         router.replace("/home");
         return;
      }

      const { data } = await supabase
        .from('tenant_role_permissions')
        .select('allowed_menus')
        .eq('tenant_id', tId)
        .eq('role_name', role)
        .maybeSingle();

      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/exam-list"))) {
        alert("⛔ 문제지 보관함에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else {
        setIsAuthorized(true);
        if (data.allowed_menus.includes('action_delete_exam')) {
          setCanDeleteExam(true);
        }
      }
    };

    checkAccess();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) {
      loadExams();
    }
  }, [isAuthorized]);

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const d = new Date(dateString);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const loadExams = async () => {
    setIsLoading(true);
    const tenantId = localStorage.getItem("logica_tenant_id");
    const result = await getExamsAction();
    
    if (result.success) {
      let fetchedExams = result.data || [];
      if (tenantId && tenantId !== 'hq') {
         fetchedExams = fetchedExams.filter((e: any) => !e.tenant_id || e.tenant_id === tenantId);
      }
      setExams(fetchedExams);
    } else {
      alert(result.message);
    }
    setIsLoading(false);
  };

  const uniqueGrades = useMemo(() => Array.from(new Set(exams.map(e => e.major_grade).filter(Boolean))).sort(), [exams]);
  const uniqueCreators = useMemo(() => {
    return Array.from(new Set(exams.map(e => {
      const instructor = Array.isArray(e.instructor) ? e.instructor[0] : e.instructor;
      return instructor?.name || '시스템 선생님';
    }))).sort();
  }, [exams]);

  // 🌟 4분류 탭과 서브 필터를 동시에 적용하여 데이터 필터링
  const filteredExams = useMemo(() => {
    return exams.filter(exam => {
      const typeStr = exam.exam_type || '평가';
      
      let matchMainTab = true;
      if (mainTab === 'EXAM') {
        matchMainTab = !['과제', '과제프린트', '오답프린트', '오답', '오답유사', '과제오답유사'].includes(typeStr);
      } else if (mainTab === 'HOMEWORK') {
        matchMainTab = ['과제', '과제프린트'].includes(typeStr);
      } else if (mainTab === 'INCORRECT') {
        matchMainTab = ['오답프린트', '오답'].includes(typeStr);
      } else if (mainTab === 'SIMILAR') {
        matchMainTab = ['오답유사', '과제오답유사'].includes(typeStr);
      }

      const matchGrade = filterGrade === 'ALL' || exam.major_grade === filterGrade;
      
      const instructor = Array.isArray(exam.instructor) ? exam.instructor[0] : exam.instructor;
      const creatorName = instructor?.name || '시스템 선생님';
      const matchCreator = filterCreator === 'ALL' || creatorName === filterCreator;
      
      return matchMainTab && matchGrade && matchCreator;
    });
  }, [exams, mainTab, filterGrade, filterCreator]);

  const resetFilters = () => {
    setMainTab("ALL"); setFilterGrade("ALL"); setFilterCreator("ALL");
  };

  const deleteExam = async (examId: string, examType: string, assignCount: number) => {
    if (!isSuperAdmin && !canDeleteExam) {
      alert("⛔ 출제된 문제지를 삭제할 권한이 없습니다.\n(원장님이 부여한 삭제 권한이 필요합니다.)");
      return;
    }

    if (!confirm("⚠️ 이 문제지를 정말 삭제하시겠습니까?\n(삭제하면 복구할 수 없습니다.)")) return;
    
    // 오답 및 오답유사 프린트는 자동 배부되므로 복수 삭제 방지
    if (['오답프린트', '오답', '오답유사', '과제오답유사'].includes(examType)) {
      if (assignCount >= 2) {
        alert("🚨 2명 이상의 학생에게 배부된 개인 맞춤 프린트는 직접 삭제할 수 없습니다!\n(다른 학생의 채점 기록이 함께 증발하는 것을 방지합니다.)\n\n해당 학생의 타임라인에서 개별적으로 배부 취소(삭제)를 진행해 주세요.");
        return;
      }

      try {
        const { data: assignments } = await supabase.from('exam_assignment').select('assignment_id').eq('exam_id', examId);
        
        if (assignments && assignments.length > 0) {
          const assignIds = assignments.map(a => a.assignment_id);
          await supabase.from('student_answer').delete().in('exam_assignment_id', assignIds);
          await supabase.from('exam_assignment').delete().eq('exam_id', examId);
        }
        
        await supabase.from('exam_item').delete().eq('exam_id', examId);
        await supabase.from('exam_master').delete().eq('exam_id', examId);

        alert("🗑️ 맞춤 프린트가 완전히 파기되었습니다.");
        loadExams();
        return; 
      } catch (err: any) {
        alert("프린트 삭제 중 오류가 발생했습니다: " + err.message);
        return;
      }
    }

    const result = await deleteExamAction(examId);
    if (result.success) {
      alert(result.message);
      loadExams(); 
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

  if (isAuthorized === null) {
    return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  }
  
  if (isAuthorized === false) {
    return null; 
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-5 overflow-hidden relative">
      
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">📝 문제지 보관함</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">출제된 모든 시험지, 과제, 맞춤형 오답/유사 프린트를 분류별로 조회하고 관리합니다.</p>
        </div>
      </div>

      <div className="bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between shrink-0 flex-wrap gap-4">
        
        {/* 🌟 4분류 메인 탭 필터 (학생 대시보드와 동일한 UI/UX 구조) */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl shadow-inner">
          <button 
            onClick={() => setMainTab('ALL')} 
            className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap ${mainTab === 'ALL' ? 'bg-white text-slate-800 shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200'}`}
          >
            전체 보기
          </button>
          <div className="w-px h-5 bg-slate-300 mx-0.5"></div>
          <button 
            onClick={() => setMainTab('EXAM')} 
            className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap ${mainTab === 'EXAM' ? 'bg-blue-500 text-white shadow-md' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50'}`}
          >
            💯 정규 시험
          </button>
          <button 
            onClick={() => setMainTab('HOMEWORK')} 
            className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap ${mainTab === 'HOMEWORK' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-500 hover:text-amber-600 hover:bg-amber-50'}`}
          >
            📝 문제지 과제
          </button>
          <button 
            onClick={() => setMainTab('INCORRECT')} 
            className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap ${mainTab === 'INCORRECT' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-500 hover:text-emerald-600 hover:bg-emerald-50'}`}
          >
            ❌ 오답 복습
          </button>
          <button 
            onClick={() => setMainTab('SIMILAR')} 
            className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap ${mainTab === 'SIMILAR' ? 'bg-violet-500 text-white shadow-md' : 'text-slate-500 hover:text-violet-600 hover:bg-violet-50'}`}
          >
            🔄 쌍둥이/유사
          </button>
        </div>

        <div className="flex items-center gap-3">
          <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
            <option value="ALL">학년 전체</option>
            {uniqueGrades.map(g => <option key={g} value={g as string}>{g as string}</option>)}
          </select>
          <select value={filterCreator} onChange={e => setFilterCreator(e.target.value)} className="border border-slate-300 text-slate-600 text-sm font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-[#002864]">
            <option value="ALL">출제자 전체</option>
            {uniqueCreators.map(c => <option key={c} value={c as string}>{c as string}</option>)}
          </select>
          <button onClick={resetFilters} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-lg transition-colors border border-slate-300 flex items-center gap-1">
            🔄 초기화
          </button>
          <button onClick={createNewExam} className="ml-2 px-5 py-2.5 bg-[#002864] text-white font-bold text-sm rounded-lg hover:bg-blue-900 transition-colors shadow-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
            새 문제지
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="overflow-y-auto flex-1 custom-scroll">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm text-center w-24">학년 범위</th>
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm text-center w-28">유형 속성</th>
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm">시험지 제목 및 범위</th>
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm text-center">생성일</th>
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm text-center">출제자</th>
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm text-right">관리 액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400 font-bold">데이터를 불러오는 중입니다...</td></tr>
              ) : filteredExams.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400 font-bold">해당 조건의 문제지가 없습니다.</td></tr>
              ) : (
                filteredExams.map(exam => {
                  const instructor = Array.isArray(exam.instructor) ? exam.instructor[0] : exam.instructor;
                  const creatorName = instructor?.name ? `${instructor.name} 선생님` : '시스템 선생님';
                  const targetGrade = exam.major_grade || '공통 과정';
                  const diff = exam.avg_difficulty || '중';
                  
                  let scope = '전 범위';
                  if (exam.scope_start && exam.scope_end) scope = (exam.scope_start === exam.scope_end) ? exam.scope_start : `${exam.scope_start} ~ ${exam.scope_end}`;
                  else if (exam.scope_start) scope = exam.scope_start;

                  const assignCount = exam.exam_assignment ? exam.exam_assignment.length : 0;
                  const isDistributed = assignCount > 0;
                  
                  const createdTime = new Date(exam.created_at).getTime();
                  const isNew = !isNaN(createdTime) && ((Date.now() - createdTime) / (1000 * 3600 * 24)) <= 2;

                  // 🌟 4분류 컬러링
                  let typeColorClass = "bg-slate-100 text-slate-600 border-slate-200";
                  const typeStr = exam.exam_type || '평가';
                  
                  if (!['과제', '과제프린트', '오답프린트', '오답', '오답유사', '과제오답유사'].includes(typeStr)) {
                    typeColorClass = "bg-blue-50 text-blue-600 border-blue-200";
                  } else if (['과제', '과제프린트'].includes(typeStr)) {
                    typeColorClass = "bg-amber-50 text-amber-600 border-amber-200";
                  } else if (['오답프린트', '오답'].includes(typeStr)) {
                    typeColorClass = "bg-emerald-50 text-emerald-600 border-emerald-200";
                  } else if (['오답유사', '과제오답유사'].includes(typeStr)) {
                    typeColorClass = "bg-violet-50 text-violet-600 border-violet-200";
                  }

                  return (
                    <tr key={exam.exam_id} className="hover:bg-slate-50 transition-colors border-b border-slate-100">
                      <td className="py-4 px-5 text-center"><span className="font-extrabold text-slate-600 text-sm">{targetGrade}</span></td>
                      <td className="py-4 px-5 text-center">
                        <span className={`px-2.5 py-1 rounded text-xs font-extrabold shadow-sm border ${typeColorClass}`}>{typeStr}</span>
                      </td>
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-2 mb-1 min-w-0">
                          <button onClick={() => router.push(`/exam/viewer?exam_id=${exam.exam_id}`)} className="font-extrabold text-slate-800 text-[15px] hover:underline hover:text-blue-600 transition-colors text-left truncate">{exam.title}</button>
                          {exam.sub_title && exam.sub_title !== '-' && <span className="bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded text-[11px] font-extrabold shadow-sm shrink-0">{exam.sub_title}</span>}
                          {isNew && <span className="text-[10px] font-black text-blue-500 tracking-tighter bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 shrink-0">NEW</span>}
                        </div>
                        <div className="text-[12px] font-bold text-slate-500 tracking-tight flex items-center gap-1.5">
                          <span>{exam.total_questions || 0}문제</span><span className="text-slate-300">|</span><span>{diff}</span><span className="text-slate-300">|</span><span className="truncate max-w-[250px]" title={scope}>{scope}</span>
                        </div>
                      </td>
                      <td className="py-4 px-5 text-center text-slate-500 font-bold text-xs">{formatDate(exam.created_at)}</td>
                      <td className="py-4 px-5 text-center text-slate-600 font-bold text-xs">{creatorName}</td>
                      <td className="py-4 px-5">
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <button onClick={() => setPublishModal({ isOpen: true, examId: exam.exam_id, title: exam.title })} className="w-[64px] h-[30px] flex items-center justify-center shrink-0 bg-[#002864] hover:bg-blue-900 text-white rounded text-[11px] font-bold shadow-sm transition-colors">
                            출제하기
                          </button>
                          
                          <button onClick={() => setGradingModal({ isOpen: true, examId: exam.exam_id, title: exam.title })} className="w-[84px] h-[30px] flex items-center justify-center shrink-0 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded text-[11px] font-bold shadow-sm transition-colors">
                            출제현황({assignCount}명)
                          </button>
                          
                          {isDistributed ? (
                            isSuperAdmin ? (
                              <button onClick={() => handleForceEdit(exam.exam_id)} className="w-[76px] h-[30px] flex items-center justify-center shrink-0 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded text-[11px] font-bold shadow-sm transition-colors border border-rose-200 gap-0.5" title="최고관리자 전용 강제 수정">
                                🚨 강제수정
                              </button>
                            ) : (
                              <button disabled className="w-[76px] h-[30px] flex items-center justify-center shrink-0 bg-slate-50 text-slate-400 rounded text-[11px] font-bold cursor-not-allowed border border-slate-200 gap-0.5" title="이미 출제되어 수정할 수 없습니다">
                                🔒 수정불가
                              </button>
                            )
                          ) : (
                            <button onClick={() => editExam(exam.exam_id)} className="w-[76px] h-[30px] flex items-center justify-center shrink-0 bg-white hover:bg-slate-50 text-slate-600 rounded text-[11px] font-bold shadow-sm transition-colors border border-slate-300">
                              수정
                            </button>
                          )}

                          <button onClick={() => duplicateAndEditExam(exam.exam_id)} className="w-[76px] h-[30px] flex items-center justify-center shrink-0 bg-white hover:bg-indigo-50 text-indigo-600 rounded text-[11px] font-bold shadow-sm transition-colors border border-indigo-200">
                            복제후수정
                          </button>
                          
                          {canDeleteExam && (
                            <button onClick={() => deleteExam(exam.exam_id, exam.exam_type, assignCount)} className="w-[48px] h-[30px] flex items-center justify-center shrink-0 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded text-[11px] font-bold shadow-sm transition-colors border border-rose-200">
                              삭제
                            </button>
                          )}
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