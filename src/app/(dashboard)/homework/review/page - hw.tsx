"use client";

import React, { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

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
    console.warn("데이터 파싱 경고:", err);
  }
  return [];
};

function HomeworkReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const homeworkId = searchParams.get("homework_id");
  const studentId = searchParams.get("student_id");

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  const [homeworkInfo, setHomeworkInfo] = useState<any>(null);
  const [studentInfo, setStudentInfo] = useState<any>(null);
  const [hwResult, setHwResult] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  
  // 채점 상태 관리: tq_id -> 'O', 'X', '△'
  const [gradingMap, setGradingMap] = useState<Record<number, 'O' | 'X' | '△' | null>>({});
  
  const mathJaxRef = useRef<boolean>(false);

  useEffect(() => {
    if (homeworkId && studentId) {
      loadHomeworkData();
      loadMathJax();
    }
  }, [homeworkId, studentId]);

  useEffect(() => {
    if (!isLoading && questions.length > 0) {
      if ((window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch((err: any) => console.log("MathJax 에러:", err));
      }
    }
  }, [isLoading, questions, gradingMap]);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = {
        tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] },
        startup: { typeset: false },
      };
      const script = document.createElement("script");
      script.id = "MathJax-script";
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
      script.async = true;
      document.head.appendChild(script);
    }
  };

  const loadHomeworkData = async () => {
    setIsLoading(true);
    try {
      // 1. 학생 및 과제 기본 정보 로드
      const [ { data: stuData }, { data: hwData }, { data: resData } ] = await Promise.all([
        supabase.from('student').select('name, grade').eq('student_id', studentId).single(),
        supabase.from('homework_assignment').select('*, textbook(title), class(name)').eq('homework_id', homeworkId).single(),
        supabase.from('student_homework_result').select('*').eq('homework_id', homeworkId).eq('student_id', studentId).maybeSingle()
      ]);

      setStudentInfo(stuData);
      setHomeworkInfo(hwData);
      setHwResult(resData);

      // 2. 문항 로드 (target_questions 기반)
      if (hwData && hwData.target_questions) {
        const tqIds = safeParseIds(hwData.target_questions);
        if (tqIds.length > 0) {
          const { data: tqs } = await supabase.from('textbook_question')
            .select('*')
            .in('tq_id', tqIds)
            .order('page_number', { ascending: true })
            .order('question_number', { ascending: true });
          
          setQuestions(tqs || []);
          
          // 3. 기존 채점 내역이 있다면 복원
          const initialGrading: Record<number, 'O' | 'X' | '△' | null> = {};
          if (resData && resData.incorrect_questions) {
            const inc = safeParseIds(resData.incorrect_questions);
            tqIds.forEach(id => {
              if (inc.includes(id)) initialGrading[id] = 'X';
              else if (resData.status === '채점완료') initialGrading[id] = 'O'; // 채점완료인데 오답이 아니면 정답
            });
          }
          setGradingMap(initialGrading);
        }
      }
    } catch (e) {
      console.error(e);
      alert("데이터를 불러오는 중 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGrade = (tqId: number, mark: 'O' | 'X' | '△') => {
    setGradingMap(prev => ({
      ...prev,
      [tqId]: prev[tqId] === mark ? null : mark
    }));
  };

  const setAllRemaining = (mark: 'O' | 'X') => {
    const newMap = { ...gradingMap };
    questions.forEach(q => {
      if (!newMap[q.tq_id]) newMap[q.tq_id] = mark;
    });
    setGradingMap(newMap);
  };

  const saveGrading = async () => {
    if (!confirm("채점 결과를 저장하시겠습니까?")) return;
    setIsSaving(true);

    try {
      const incorrectIds: number[] = [];
      let correctCount = 0;

      questions.forEach(q => {
        const mark = gradingMap[q.tq_id];
        if (mark === 'X' || mark === '△') incorrectIds.push(q.tq_id);
        if (mark === 'O') correctCount++;
      });

      // 1. student_homework_result 업데이트
      await supabase.from('student_homework_result')
        .update({
          status: '채점완료',
          correct_count: correctCount,
          incorrect_questions: incorrectIds,
          checked_at: new Date().toISOString()
        })
        .eq('hw_result_id', hwResult.hw_result_id);

      // 2. 오답인 경우 student_incorrect_record에 자동 등록 (이미 있으면 무시)
      if (incorrectIds.length > 0) {
        const { data: existingRecords } = await supabase.from('student_incorrect_record')
          .select('tq_id')
          .eq('student_id', studentId)
          .eq('source_type', '교재과제')
          .in('tq_id', incorrectIds);
          
        const existingTqIds = (existingRecords || []).map(r => r.tq_id);
        const newIncorrects = incorrectIds.filter(id => !existingTqIds.includes(id));

        if (newIncorrects.length > 0) {
          const insertData = newIncorrects.map(id => ({
            student_id: studentId,
            tq_id: id,
            source_type: '교재과제',
            status: 'X',
            retry_count: 0
          }));
          await supabase.from('student_incorrect_record').insert(insertData);
        }
      }

      alert("🎉 채점이 완료되었습니다. (오답은 오답노트에 자동 등록되었습니다)");
      router.back();

    } catch (e: any) {
      console.error(e);
      alert("저장 중 오류가 발생했습니다: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="h-screen flex items-center justify-center bg-slate-50 font-bold text-slate-400">데이터를 불러오는 중입니다...</div>;
  }

  const totalQ = questions.length;
  const gradedQ = Object.values(gradingMap).filter(v => v !== null).length;
  const isComplete = totalQ > 0 && gradedQ === totalQ;

  return (
    <div className="flex flex-col h-screen bg-slate-100 overflow-hidden font-pretendard">
      {/* 헤더 */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-700 font-bold flex items-center gap-1 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors">
            <span>←</span> 뒤로
          </button>
          <div className="w-px h-6 bg-slate-300"></div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-[#002864] text-white text-[10px] px-2 py-0.5 rounded font-bold">{homeworkInfo?.class?.name || '반 미지정'}</span>
              <span className="text-slate-500 font-bold text-xs">{studentInfo?.name} 학생 ({studentInfo?.grade || '-'})</span>
            </div>
            <h1 className="text-xl font-extrabold text-slate-800 tracking-tight leading-none">
              📚 {homeworkInfo?.homework_title}
            </h1>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-right mr-2">
            <div className="text-xs font-bold text-slate-500 mb-0.5">채점 진행률</div>
            <div className="font-black text-lg text-[#002864] leading-none">{gradedQ} / {totalQ}</div>
          </div>
          <button 
            onClick={saveGrading}
            className={`px-6 py-3 rounded-xl font-extrabold text-sm shadow-md transition-all flex items-center gap-2 ${isComplete ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-[#002864] hover:bg-blue-900 text-white'}`}
          >
            {isSaving ? '저장 중...' : (isComplete ? '✅ 채점 완료 및 저장' : '💾 중간 저장하기')}
          </button>
        </div>
      </header>

      {/* 툴바 */}
      <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 shrink-0 flex justify-between items-center shadow-inner">
        <span className="text-xs font-bold text-slate-500">교재명: <span className="text-slate-800">{homeworkInfo?.textbook?.title || '-'}</span></span>
        <div className="flex gap-2">
          <button onClick={() => setAllRemaining('O')} className="px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded text-xs font-bold hover:bg-blue-100 transition-colors shadow-sm">
            미채점 전체 정답 (O) 처리
          </button>
        </div>
      </div>

      {/* 메인 리스트 */}
      <main className="flex-1 overflow-y-auto p-6 bg-slate-100/50 custom-scroll">
        <div className="max-w-4xl mx-auto space-y-4 pb-32">
          {questions.length === 0 ? (
            <div className="text-center py-20 text-slate-400 font-bold bg-white rounded-xl border border-slate-200">배부된 문항이 없습니다.</div>
          ) : (
            questions.map((q, idx) => {
              const mark = gradingMap[q.tq_id];
              // 💡 텍스트 유무에 따른 방어 로직 적용
              const hasText = q.question && q.question.trim() !== "";
              
              return (
                <div key={q.tq_id} className={`bg-white rounded-xl border-2 shadow-sm transition-all overflow-hidden flex flex-col ${mark === 'O' ? 'border-blue-300 shadow-blue-100/50' : mark === 'X' ? 'border-rose-300 shadow-rose-100/50' : mark === '△' ? 'border-amber-300 shadow-amber-100/50' : 'border-slate-200 hover:border-slate-300'}`}>
                  
                  {/* 문항 상단바 */}
                  <div className="bg-slate-50 px-5 py-2.5 border-b border-slate-100 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 font-extrabold text-sm">{idx + 1}</span>
                      <div className="h-4 w-px bg-slate-300"></div>
                      <span className="text-slate-600 font-bold text-sm bg-white px-2 py-0.5 rounded border border-slate-200">{q.page_number}p</span>
                      <span className="text-[#002864] font-black text-base">{q.question_number}번</span>
                      <span className="text-[10px] text-slate-400 font-bold bg-slate-100 px-1.5 py-0.5 rounded">{q.question_category || '일반'}</span>
                    </div>
                  </div>

                  {/* 문항 내용 및 정답 (불완전 데이터 방어) */}
                  <div className="p-5 flex flex-col sm:flex-row gap-6">
                    <div className="flex-1 min-w-0 flex flex-col gap-4">
                      {/* 문제 텍스트 */}
                      {hasText ? (
                        <div className="text-slate-800 text-[15px] leading-relaxed break-keep" dangerouslySetInnerHTML={{ __html: q.question }} />
                      ) : (
                        <div className="text-slate-400 font-bold text-sm italic py-4 bg-slate-50 rounded-lg text-center border border-dashed border-slate-200">
                          🚫 문제 텍스트가 입력되지 않은 문항입니다. 교재를 참고해 주세요.
                        </div>
                      )}
                      
                      {/* 정답 표시 */}
                      <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100 flex items-start gap-3 mt-auto">
                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[11px] font-extrabold shrink-0 mt-0.5">정답</span>
                        <div className="font-bold text-slate-800 text-[15px] break-all">
                          {q.answer ? `$ ${q.answer} $` : <span className="text-slate-400 text-sm font-normal italic">정답 데이터 없음</span>}
                        </div>
                      </div>
                    </div>

                    {/* 채점 버튼 그룹 */}
                    <div className="w-full sm:w-[140px] shrink-0 flex sm:flex-col gap-2">
                      <button 
                        onClick={() => handleGrade(q.tq_id, 'O')}
                        className={`flex-1 py-3 rounded-lg font-black text-lg transition-all ${mark === 'O' ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-blue-50 hover:text-blue-500 border border-slate-200'}`}
                      >
                        O 정답
                      </button>
                      <button 
                        onClick={() => handleGrade(q.tq_id, 'X')}
                        className={`flex-1 py-3 rounded-lg font-black text-lg transition-all ${mark === 'X' ? 'bg-rose-500 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-rose-50 hover:text-rose-400 border border-slate-200'}`}
                      >
                        X 오답
                      </button>
                      <button 
                        onClick={() => handleGrade(q.tq_id, '△')}
                        className={`flex-1 py-2 rounded-lg font-black text-base transition-all ${mark === '△' ? 'bg-amber-500 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-amber-50 hover:text-amber-500 border border-slate-200'}`}
                      >
                        △ 세모
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}

export default function HomeworkReviewPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center font-bold text-slate-400">페이지 준비 중...</div>}>
      <HomeworkReviewContent />
    </Suspense>
  );
}