// src/app/(dashboard)/exam-list/page.tsx
"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { getExamsAction, deleteExamAction } from "@/app/actions/examActions";
import { supabase } from "@/lib/supabase"; 

// 분리된 모달 컴포넌트 임포트
import PublishModal from "@/components/exam/PublishModal";
import GradingModal from "@/components/exam/GradingModal";

export default function ExamListPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [exams, setExams] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [mainTab, setMainTab] = useState<'ALL' | 'EXAM' | 'HOMEWORK' | 'INCORRECT' | 'SIMILAR'>('ALL');
  const [filterGrade, setFilterGrade] = useState("ALL");
  const [filterCreator, setFilterCreator] = useState("ALL");

  const [publishModal, setPublishModal] = useState<{ isOpen: boolean; examId: string; title: string }>({ isOpen: false, examId: "", title: "" });
  const [gradingModal, setGradingModal] = useState<{ isOpen: boolean; examId: string; title: string }>({ isOpen: false, examId: "", title: "" });

  // 🌟 [정답지 조회 모달 상태]
  const [answerModal, setAnswerModal] = useState<{ isOpen: boolean; examId: string; title: string }>({ isOpen: false, examId: "", title: "" });
  const [answerData, setAnswerData] = useState<{ num: number; answer: string }[]>([]);
  const [isLoadingAnswers, setIsLoadingAnswers] = useState(false);

  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [canDeleteExam, setCanDeleteExam] = useState(false);

  const mathJaxRef = useRef(false);

  // MathJax 초기화
  useEffect(() => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = {
        tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]], processEscapes: true },
        chtml: { displayAlign: 'center', displayIndent: '0em' },
        svg: { fontCache: 'global' }
      };
      const script = document.createElement("script");
      script.id = "MathJax-script";
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  // 정답지 모달 렌더링 후 수식 변환 트리거
  useEffect(() => {
    if (answerModal.isOpen && answerData.length > 0) {
      const timer = setTimeout(() => {
        if (typeof window !== "undefined" && (window as any).MathJax && (window as any).MathJax.typesetPromise) {
          (window as any).MathJax.typesetPromise().catch(() => {});
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [answerModal.isOpen, answerData]);

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

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-';
    const d = new Date(dateString);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const loadExams = async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    
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
    
    if (!isSilent) setIsLoading(false);
  };

  const openAnswerModal = async (examId: string, title: string) => {
    setAnswerModal({ isOpen: true, examId, title });
    setIsLoadingAnswers(true);
    setAnswerData([]);
    try {
      const { data, error } = await supabase
        .from('exam_item')
        .select('sort_order, question_db(answer)')
        .eq('exam_id', examId)
        .order('sort_order', { ascending: true });
      
      if (error) throw error;

      const formatted = (data || []).map((item, idx) => {
        const qdb: any = Array.isArray(item.question_db) ? item.question_db[0] : item.question_db;
        return {
          num: idx + 1,
          answer: qdb?.answer || '정답 없음'
        };
      });
      setAnswerData(formatted);
    } catch (err: any) {
      alert('정답 데이터를 불러오는 데 실패했습니다.');
    } finally {
      setIsLoadingAnswers(false);
    }
  };

  // 🌟 [핵심 변경] 수식을 완벽하게 파싱하고 줄바꿈 및 한글 깨짐을 방지하는 로직
  const formatMathTextForWeb = (text: string) => {
    if (!text) return "";
    let t = String(text);
    
    // 1. <br> 태그 보호
    t = t.replace(/<br\s*\/?>/gi, '[[BR]]');
    // 2. HTML 꺾쇠 이스케이프 처리
    t = t.replace(/</g, ' &lt; ').replace(/>/g, ' &gt; ');
    // 3. 보호된 <br> 태그 복구
    t = t.replace(/\[\[BR\]\]/g, '<br>');
    
    // 4. 기존 $ 또는 $$ 기호 완벽 제거 (전체를 $로 감쌀 때 오류 방지)
    t = t.replace(/\$\$/g, '');
    t = t.replace(/\$/g, '');

    // 5. 쉼표(,) 뒤에 띄어쓰기가 없으면 띄어쓰기 강제 추가 (자연스러운 줄바꿈 유도)
    t = t.replace(/,(?=[^\s])/g, ', ');

    // 6. 한글을 MathJax 변수(이탤릭체)로 인식하지 못하도록 \text{}로 감싸기
    t = t.replace(/([가-힣]+([ \t]*[가-힣]+)*)/g, '\\text{$1}');

    // 7. 동그라미 숫자(①~⑳)도 \text{}로 감싸기 (깨짐 방지)
    t = t.replace(/([①-⑳])/g, '\\text{$1}');
    
    return t;
  };

  const handlePrintAnswers = () => {
    const printWin = window.open('', '_blank');
    if (!printWin) {
      alert('팝업 차단이 설정되어 있습니다. 팝업을 허용해주세요.');
      return;
    }
    
    const content = answerData.map(item => `
      <div style="border: 1px solid #cbd5e1; padding: 12px; border-radius: 8px; text-align: center; break-inside: avoid; background-color: #fff; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <div style="font-size: 13px; font-weight: bold; color: #002864; background: #eff6ff; padding: 3px 10px; border-radius: 12px; display: inline-block; margin-bottom: 8px; flex-shrink: 0;">${item.num}번</div>
        <div style="font-size: 15px; font-weight: bold; color: #334155; word-break: break-all; white-space: normal; line-height: 1.5; width: 100%; overflow-x: auto;">
          $${formatMathTextForWeb(item.answer) || '-'}$
        </div>
      </div>
    `).join('');

    printWin.document.write(`
      <html>
        <head>
          <title>${answerModal.title} - 정답지</title>
          <style>
            body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; padding: 30px; background-color: #f8fafc; }
            h2 { text-align: center; color: #002864; margin-bottom: 30px; font-size: 24px; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; }
            .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
            /* 인쇄 시 MathJax 줄바꿈 강제 설정 */
            mjx-container { white-space: normal !important; word-wrap: break-word !important; }
            @media print { 
              .no-print { display: none; } 
              body { background-color: white; padding: 10px; }
            }
          </style>
          <script>
            MathJax = {
              tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']] },
              svg: { fontCache: 'global' }
            };
          </script>
          <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
        </head>
        <body>
          <div class="no-print" style="text-align: right; margin-bottom: 20px;">
            <button onclick="window.print()" style="padding: 10px 20px; font-size: 15px; font-weight: bold; cursor: pointer; background: #002864; color: white; border: none; border-radius: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">🖨️ 인쇄하기</button>
          </div>
          <h2>📑 [정답지] ${answerModal.title}</h2>
          <div class="grid">
            ${content}
          </div>
        </body>
      </html>
    `);
    printWin.document.close();
  };

  const uniqueGrades = useMemo(() => Array.from(new Set(exams.map(e => e.major_grade).filter(Boolean))).sort(), [exams]);
  const uniqueCreators = useMemo(() => {
    return Array.from(new Set(exams.map(e => {
      const instructor = Array.isArray(e.instructor) ? e.instructor[0] : e.instructor;
      return instructor?.name || '시스템 선생님';
    }))).sort();
  }, [exams]);

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
        loadExams(true); 
        return; 
      } catch (err: any) {
        alert("프린트 삭제 중 오류가 발생했습니다: " + err.message);
        return;
      }
    }

    const result = await deleteExamAction(examId);
    if (result.success) {
      alert(result.message);
      loadExams(true);
    } else {
      alert(result.message);
    }
  };

  const clearSessionStorageForExam = () => {
    const keysToRemove = [
      'restoreExamQuestions', 'examQuestions', 'examTitle', 'examSubTitle', 'examType',
      'editOriginalType', 'editOriginalId', 'editStudentId', 'editClassId', 'editMasterId',
      'examUserMergedTextQuestions', 'clinicTargetStudentId', 'clinicTargetClassId', 'clinicTargetStudentIds',
      'editHomeworkId', 'editExamId', 'duplicateExamId', 'splitHomeworkIds', 'splitCommonTqIds',
      'isClinicMode'
    ];
    keysToRemove.forEach(k => sessionStorage.removeItem(k));
  };

  const createNewExam = () => {
    clearSessionStorageForExam();
    router.push('/exam/step1'); 
  };

  const editExam = (examId: string) => {
    clearSessionStorageForExam();
    sessionStorage.setItem('editExamId', examId);
    router.push(`/exam/step2?exam_id=${examId}`);
  };

  const handleForceEdit = (examId: string) => {
    if (confirm("🚨 경고: 이미 배부되어 학생이 풀고 있을 수 있는 시험지입니다!\n강제 수정 시 기존 문항 및 채점 기록과 충돌이 발생할 수 있습니다.\n\n정말 강제로 수정하시겠습니까? (최고관리자 전용 기능)")) {
      editExam(examId);
    }
  };

  const duplicateAndEditExam = (examId: string) => {
    clearSessionStorageForExam();
    sessionStorage.setItem('duplicateExamId', examId);
    router.push(`/exam/step2?duplicate_exam_id=${examId}`);
  };

  if (isAuthorized === null) {
    return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  }
  
  if (isAuthorized === false) {
    return null; 
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-5 overflow-hidden relative font-pretendard">
      
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">📝 문제지 보관함</h2>
          <p className="text-sm font-bold text-slate-400 mt-1">출제된 모든 시험지, 과제, 맞춤형 오답/유사 프린트를 분류별로 조회하고 관리합니다.</p>
        </div>
      </div>

      <div className="bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between shrink-0 flex-wrap gap-4">
        
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
                <th className="py-3 px-5 font-extrabold text-slate-500 text-sm text-center">생성일시</th>
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
                          <button 
                            onClick={() => openAnswerModal(exam.exam_id, exam.title)} 
                            className="bg-slate-100 hover:bg-slate-200 text-slate-500 border border-slate-200 px-2 py-0.5 rounded text-[11px] font-extrabold shadow-sm shrink-0 transition-colors" 
                            title="정답지만 모아보기 및 인쇄"
                          >
                            📑 정답
                          </button>

                          <button onClick={() => router.push(`/exam/viewer?exam_id=${exam.exam_id}`)} className="font-extrabold text-slate-800 text-[15px] hover:underline hover:text-blue-600 transition-colors text-left truncate">{exam.title}</button>
                          
                          {exam.sub_title && exam.sub_title !== '-' && <span className="bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded text-[11px] font-extrabold shadow-sm shrink-0">{exam.sub_title}</span>}
                          {isNew && <span className="text-[10px] font-black text-blue-500 tracking-tighter bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 shrink-0">NEW</span>}
                        </div>
                        <div className="text-[12px] font-bold text-slate-500 tracking-tight flex items-center gap-1.5 pl-[52px]">
                          <span>{exam.total_questions || 0}문제</span><span className="text-slate-300">|</span><span>{diff}</span><span className="text-slate-300">|</span><span className="truncate max-w-[250px]" title={scope}>{scope}</span>
                        </div>
                      </td>
                      <td className="py-4 px-5 text-center text-slate-500 font-bold text-xs">{formatDateTime(exam.created_at)}</td>
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
        onSuccess={() => loadExams(true)} 
      />

      <GradingModal 
        isOpen={gradingModal.isOpen} 
        examId={gradingModal.examId} 
        title={gradingModal.title} 
        onClose={() => setGradingModal({ isOpen: false, examId: "", title: "" })} 
        onUpdate={() => loadExams(true)} 
      />

      {/* 🌟 방어용 스크롤 및 오버플로우 방지가 적용된 정답지 모달 뷰어 */}
      {answerModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-lg flex items-center gap-2"><span>📑</span> 정답지 조회: {answerModal.title}</h2>
              <button onClick={() => setAnswerModal({ isOpen: false, examId: '', title: '' })} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50" id="print-answer-area">
              {isLoadingAnswers ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400">
                  <div className="w-8 h-8 border-4 border-[#002864] border-t-transparent rounded-full animate-spin mb-4"></div>
                  <div className="font-bold">정답을 불러오는 중입니다...</div>
                </div>
              ) : answerData.length === 0 ? (
                <div className="text-center py-10 text-slate-400 font-bold">등록된 정답이 없습니다.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {answerData.map(item => (
                    <div key={item.num} className="bg-white border border-slate-200 pt-4 pb-2 px-2 rounded-xl shadow-sm flex flex-col items-center justify-center text-center overflow-hidden">
                      <span className="text-xs font-black text-[#002864] bg-blue-50 px-2.5 py-0.5 rounded-full mb-2 shadow-sm shrink-0">{item.num}번</span>
                      {/* 🌟 텍스트 오버플로우 방지용 내부 스크롤 박스 */}
                      <div className="w-full overflow-x-auto custom-scroll pb-1">
                        <div 
                          className="math-text text-[14px] font-bold text-slate-700 break-all whitespace-normal leading-relaxed px-1 mx-auto" 
                          dangerouslySetInnerHTML={{ __html: `$${formatMathTextForWeb(item.answer) || '-'}$` }} 
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="p-4 bg-white border-t border-slate-200 flex justify-end gap-3 shrink-0">
              <button 
                onClick={handlePrintAnswers} 
                disabled={isLoadingAnswers || answerData.length === 0}
                className="px-6 py-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-extrabold rounded-lg shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <span>🖨️</span> 인쇄하기
              </button>
              <button 
                onClick={() => setAnswerModal({ isOpen: false, examId: '', title: '' })} 
                className="px-6 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg shadow-sm transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}