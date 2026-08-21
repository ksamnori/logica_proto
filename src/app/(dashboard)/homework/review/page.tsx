// src/app/(dashboard)/homework/review/page.tsx
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

// 💡 [수정] 수식 내 부등호(<, >)가 HTML 태그로 오인되어 깨지는 현상을 막기 위한 유틸리티 함수
const formatMathTextForWeb = (text: string) => {
  if (!text) return "";
  let t = String(text).replace(/</g, ' &lt; ').replace(/>/g, ' &gt; ');
  t = t.replace(/\\bigcirc/g, '\\circ').replace(/\^{?[○◯]}?/g, '^{\\circ}').replace(/([0-9]+)\s*[○◯]/g, '$1^{\\circ}');
  return t;
};

// 💡 'RO' 타입 추가
type GradeCode = 'O' | 'X' | 'TX' | 'TO' | '☆' | 'B' | 'RO';

function HomeworkReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const homeworkId = searchParams.get("homework_id");
  const studentId = searchParams.get("student_id");

  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState(""); 
  
  const [homeworkInfo, setHomeworkInfo] = useState<any>(null);
  const [studentInfo, setStudentInfo] = useState<any>(null);
  const [hwResult, setHwResult] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  
  const [gradingMap, setGradingMap] = useState<Record<number, GradeCode | null>>({});
  const [modalQ, setModalQ] = useState<any>(null);

  const hwResultIdRef = useRef<number | null>(null);
  const mathJaxRef = useRef<boolean>(false);

  useEffect(() => {
    if (homeworkId && studentId) {
      loadHomeworkData();
      loadMathJax();
    }
  }, [homeworkId, studentId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== "undefined" && (window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch(() => {});
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [isLoading, questions, modalQ]);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = {
        tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]], processEscapes: true },
        chtml: { displayAlign: 'left' },
      };
      const script = document.createElement("script");
      script.id = "MathJax-script";
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
      script.async = true;
      document.head.appendChild(script);
    }
  };

  const loadHomeworkData = async () => {
    setIsLoading(true);
    try {
      const [ { data: stuData }, { data: hwData }, { data: resData }, { data: ansData } ] = await Promise.all([
        supabase.from('student').select('name, grade').eq('student_id', studentId).single(),
        supabase.from('homework_assignment').select('*, textbook(title), class(name)').eq('homework_id', homeworkId).single(),
        supabase.from('student_homework_result').select('*').eq('homework_id', homeworkId).eq('student_id', studentId).maybeSingle(),
        supabase.from('student_homework_answer').select('tq_id, grading_code').eq('homework_id', homeworkId).eq('student_id', studentId)
      ]);

      setStudentInfo(stuData);
      setHomeworkInfo(hwData);
      setHwResult(resData);
      if (resData) hwResultIdRef.current = resData.hw_result_id;

      if (hwData && hwData.target_questions) {
        const tqIds = safeParseIds(hwData.target_questions);
        if (tqIds.length > 0) {
          const { data: tqs } = await supabase.from('textbook_question')
            .select('*')
            .in('tq_id', tqIds)
            .order('page_number', { ascending: true })
            .order('question_number', { ascending: true });
          
          setQuestions(tqs || []);
          
          const initialGrading: Record<number, GradeCode | null> = {};
          if (ansData && ansData.length > 0) {
            ansData.forEach(a => { if (a.grading_code) initialGrading[a.tq_id] = a.grading_code as GradeCode; });
          } else if (resData && resData.incorrect_questions) {
            const inc = safeParseIds(resData.incorrect_questions);
            tqIds.forEach(id => {
              if (inc.includes(id)) initialGrading[id] = 'X';
              else if (resData.status === '채점완료') initialGrading[id] = 'O';
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

  const updateHomeworkResult = async (newMap: Record<number, GradeCode | null>) => {
    let correctCount = 0; 
    let gradedCount = 0;
    const incorrectIds: number[] = [];
    
    questions.forEach(q => {
      const m = newMap[q.tq_id];
      if (m) {
        gradedCount++;
        if (['O', 'TO', 'RO'].includes(m as string)) correctCount++;
        if (['X', 'TX', '☆', 'B'].includes(m as string)) incorrectIds.push(q.tq_id);
      }
    });

    const totalQ = questions.length;
    let newStatus = '미제출';
    if (gradedCount > 0) newStatus = '진행중';
    if (gradedCount === totalQ && totalQ > 0) newStatus = '채점완료';

    let currentResultId = hwResultIdRef.current;
    
    if (!currentResultId) {
      const { data: existing } = await supabase.from('student_homework_result')
        .select('hw_result_id').eq('homework_id', homeworkId).eq('student_id', studentId).maybeSingle();
      if (existing) currentResultId = existing.hw_result_id;
    }

    if (currentResultId) {
      await supabase.from('student_homework_result').update({
        status: newStatus, correct_count: correctCount, incorrect_questions: incorrectIds, checked_at: new Date().toISOString()
      }).eq('hw_result_id', currentResultId);
    } else {
      const { data } = await supabase.from('student_homework_result').insert({
        homework_id: Number(homeworkId), student_id: studentId, status: newStatus, correct_count: correctCount, incorrect_questions: incorrectIds, checked_at: new Date().toISOString()
      }).select('hw_result_id').single();
      if (data) hwResultIdRef.current = data.hw_result_id;
    }
  };

  const handleGrade = async (tqId: number, mark: GradeCode) => {
    const newMap = { ...gradingMap, [tqId]: mark };
    setGradingMap(newMap);
    setSaveStatus("저장 중...");

    try {
      const isCorrect = ['O', 'TO', 'RO'].includes(mark);
      const isIncorrect = ['X', 'TX', '☆', 'B'].includes(mark);

      const [ { data: existingA }, { data: existingI } ] = await Promise.all([
        supabase.from('student_homework_answer').select('hw_answer_id').eq('homework_id', homeworkId).eq('student_id', studentId).eq('tq_id', tqId).maybeSingle(),
        supabase.from('student_incorrect_record').select('record_id').eq('student_id', studentId).eq('source_type', '교재과제').eq('tq_id', tqId).maybeSingle()
      ]);

      if (existingA) {
        await supabase.from('student_homework_answer').update({ grading_code: mark, is_correct: isCorrect, earned_score: isCorrect ? 1 : 0 }).eq('hw_answer_id', existingA.hw_answer_id);
      } else {
        await supabase.from('student_homework_answer').insert({ homework_id: Number(homeworkId), student_id: studentId, tq_id: tqId, grading_code: mark, is_correct: isCorrect, earned_score: isCorrect ? 1 : 0 });
      }

      if (isIncorrect) {
        if (existingI) await supabase.from('student_incorrect_record').update({ status: mark, resolved_at: null }).eq('record_id', existingI.record_id);
        else await supabase.from('student_incorrect_record').insert({ student_id: studentId, tq_id: tqId, source_type: '교재과제', status: mark });
      } else if (isCorrect) {
        if (existingI) await supabase.from('student_incorrect_record').update({ status: mark, resolved_at: new Date().toISOString() }).eq('record_id', existingI.record_id);
      }

      await updateHomeworkResult(newMap);

      setSaveStatus("✅ 자동 저장됨");
      setTimeout(() => setSaveStatus(""), 2000);

    } catch (error) {
      console.error("실 저장 실패:", error);
      setSaveStatus("❌ 저장 실패");
    }
  };

  const setAllRemaining = async (mark: GradeCode) => {
    if (!confirm(`미채점된 문항을 일괄적으로 '${mark}' 처리하시겠습니까?\n처리 즉시 저장됩니다.`)) return;
    setSaveStatus("일괄 저장 중...");
    
    try {
      const newMap = { ...gradingMap };
      const targets = questions.filter(q => !gradingMap[q.tq_id]);
      if(targets.length === 0) { setSaveStatus(""); return; }

      targets.forEach(q => newMap[q.tq_id] = mark);
      setGradingMap(newMap);

      const isCorrect = ['O', 'TO', 'RO'].includes(mark);
      const isIncorrect = ['X', 'TX', '☆', 'B'].includes(mark);

      const [ { data: existingAns }, { data: existingInc } ] = await Promise.all([
        supabase.from('student_homework_answer').select('hw_answer_id, tq_id').eq('homework_id', homeworkId).eq('student_id', studentId),
        supabase.from('student_incorrect_record').select('record_id, tq_id').eq('student_id', studentId).eq('source_type', '교재과제')
      ]);

      const ansInserts: any[] = []; const ansUpdates: any[] = [];
      const incInserts: any[] = []; const incUpdates: any[] = [];

      targets.forEach(q => {
        const exA = existingAns?.find(a => a.tq_id === q.tq_id);
        if (exA) ansUpdates.push({ hw_answer_id: exA.hw_answer_id, grading_code: mark, is_correct: isCorrect, earned_score: isCorrect ? 1 : 0 });
        else ansInserts.push({ homework_id: Number(homeworkId), student_id: studentId, tq_id: q.tq_id, grading_code: mark, is_correct: isCorrect, earned_score: isCorrect ? 1 : 0 });

        const exI = existingInc?.find(i => i.tq_id === q.tq_id);
        if (isIncorrect) {
          if (exI) incUpdates.push({ record_id: exI.record_id, status: mark, resolved_at: null });
          else incInserts.push({ student_id: studentId, tq_id: q.tq_id, source_type: '교재과제', status: mark });
        } else if (isCorrect && exI) {
          incUpdates.push({ record_id: exI.record_id, status: mark, resolved_at: new Date().toISOString() });
        }
      });

      if (ansInserts.length > 0) await supabase.from('student_homework_answer').insert(ansInserts);
      for(const u of ansUpdates) await supabase.from('student_homework_answer').update({ grading_code: u.grading_code, is_correct: u.is_correct, earned_score: u.earned_score }).eq('hw_answer_id', u.hw_answer_id);
      
      if (incInserts.length > 0) await supabase.from('student_incorrect_record').insert(incInserts);
      for(const u of incUpdates) await supabase.from('student_incorrect_record').update({ status: u.status, resolved_at: u.resolved_at }).eq('record_id', u.record_id);

      await updateHomeworkResult(newMap);

      setSaveStatus("✅ 일괄 저장 완료");
      setTimeout(() => setSaveStatus(""), 2000);
    } catch (e) {
      console.error(e); setSaveStatus("❌ 저장 실패");
    }
  };

  const getCleanUrl = (url: string) => {
    if (!url || url === 'null') return '';
    let validUrl = url;
    if (typeof validUrl === 'string' && validUrl.trim().startsWith('[')) { try { validUrl = JSON.parse(validUrl)[0]; } catch(e) {} }
    if (validUrl && validUrl !== 'null' && !validUrl.startsWith('http') && !validUrl.startsWith('data:image')) { 
      validUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/question_images/${validUrl}`; 
    }
    return validUrl;
  };

  if (isLoading) {
    return <div className="h-screen flex items-center justify-center bg-slate-50 font-bold text-slate-400">데이터를 불러오는 중입니다...</div>;
  }

  const totalQ = questions.length;
  const gradedQ = Object.values(gradingMap).filter(v => v !== null).length;

  return (
    <div className="flex flex-col h-screen bg-slate-100 overflow-hidden font-pretendard">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button onClick={() => window.location.href = '/learning'} className="text-white hover:text-blue-200 flex items-center gap-2 font-extrabold text-lg mb-2 transition-colors bg-blue-900/40 px-4 py-2 rounded-xl border border-blue-800/50 w-fit shadow-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg> 뒤로가기
          </button>
          <div className="w-px h-6 bg-slate-300"></div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-[#002864] text-white text-[10px] px-2 py-0.5 rounded font-bold">{homeworkInfo?.class?.name || '반 미지정'}</span>
              <span className="text-slate-500 font-bold text-xs">{studentInfo?.name} 학생 ({studentInfo?.grade || '-'})</span>
            </div>
            <h1 className="text-xl font-extrabold text-slate-800 tracking-tight leading-none">
              📚 {homeworkInfo?.homework_title} <span className="text-sm text-slate-400 font-bold ml-2">실시간 쾌속 채점</span>
            </h1>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {saveStatus && (
            <div className={`px-4 py-1.5 rounded-full text-sm font-extrabold shadow-sm transition-all ${saveStatus.includes('✅') ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : saveStatus.includes('❌') ? 'bg-rose-100 text-rose-700 border border-rose-200' : 'bg-amber-100 text-amber-700 border border-amber-200 animate-pulse'}`}>
              {saveStatus}
            </div>
          )}
          <div className="text-right mr-2 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
            <div className="text-[11px] font-bold text-slate-500 mb-0.5">채점 완료 진행률</div>
            <div className="font-black text-lg text-[#002864] leading-none">{gradedQ} / {totalQ}</div>
          </div>
        </div>
      </header>

      <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 shrink-0 flex justify-between items-center shadow-inner">
        <span className="text-xs font-bold text-slate-500">교재명: <span className="text-slate-800">{homeworkInfo?.textbook?.title || '-'}</span></span>
        <div className="flex gap-2">
          <button onClick={() => setAllRemaining('O')} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-xs font-bold hover:bg-emerald-100 transition-colors shadow-sm">
            ✅ 미채점 전체 정답 (O)
          </button>
          <button onClick={() => setAllRemaining('X')} className="px-3 py-1.5 bg-rose-50 text-rose-600 border border-rose-200 rounded text-xs font-bold hover:bg-rose-100 transition-colors shadow-sm">
            ❌ 미채점 전체 오답 (X)
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-6 bg-slate-100/50 custom-scroll">
        <div className="max-w-[900px] mx-auto space-y-2 pb-10">
          {questions.length === 0 ? (
            <div className="text-center py-20 text-slate-400 font-bold bg-white rounded-xl border border-slate-200">배부된 문항이 없습니다.</div>
          ) : (
            questions.map((q, idx) => {
              const mark = gradingMap[q.tq_id];
              
              let rowBg = "bg-white border-slate-200 hover:border-blue-200";
              if (mark === 'O') rowBg = "bg-[#10b981]/10 border-[#10b981]";
              else if (mark === 'X') rowBg = "bg-[#ef4444]/10 border-[#ef4444]";
              else if (mark === 'TO') rowBg = "bg-[#14b8a6]/10 border-[#14b8a6]";
              else if (mark === 'TX') rowBg = "bg-[#f97316]/10 border-[#f97316]";
              else if (mark === '☆') rowBg = "bg-[#f59e0b]/10 border-[#f59e0b]";
              else if (mark === 'B') rowBg = "bg-slate-300/30 border-slate-400";
              else if (mark === 'RO') rowBg = "bg-[#3b82f6]/10 border-[#3b82f6]";

              const displayQNum = String(q.question_number || '')
                .replace(/TWIN/gi, 'T')
                .replace(/SIMILAR/gi, 'S')
                .replace(/CLINIC/gi, 'C');

              return (
                <div key={q.tq_id} className={`rounded-xl border shadow-sm transition-all overflow-hidden flex items-center p-3 gap-4 ${rowBg}`}>
                  
                  <div className="flex items-center gap-2 shrink-0 w-[190px]">
                    <span className="text-slate-400 font-extrabold text-sm w-5 text-center shrink-0">{idx + 1}</span>
                    <span className="text-[#002864] font-black text-[15px] whitespace-nowrap shrink-0">{displayQNum}번</span>
                    <span className="text-[10px] font-bold bg-slate-100/80 px-1.5 py-0.5 rounded text-slate-500 border border-slate-200 shrink-0">{q.page_number}p</span>
                    <button onClick={() => setModalQ(q)} className="bg-white border border-slate-300 hover:bg-slate-100 hover:border-slate-400 text-slate-600 text-[11px] font-bold p-1.5 rounded shadow-sm transition-colors flex items-center justify-center ml-auto" title="문제 보기">
                      🔍
                    </button>
                  </div>

                  <div className="flex-1 bg-white/70 px-3 py-2 rounded-lg border border-slate-200 flex items-center gap-3 overflow-hidden shadow-inner">
                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-extrabold shrink-0">DB 정답</span>
                    <div className="font-bold text-slate-800 text-[13px] break-all math-text whitespace-pre-wrap max-h-[3.5rem] overflow-y-auto custom-scroll w-full flex items-center">
                      {/* 💡 [수정] formatMathTextForWeb을 사용하여 정답 텍스트 파싱 깨짐 방지 */}
                      {q.answer ? <span dangerouslySetInnerHTML={{ __html: `$ ${formatMathTextForWeb(q.answer)} $` }} /> : <span className="text-slate-400 font-normal italic">-</span>}
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1 shrink-0 w-[350px]">
                    <button onClick={() => handleGrade(q.tq_id, 'O')} className={`h-10 rounded-md font-black text-xs transition-all ${mark === 'O' ? 'bg-[#10b981] text-white shadow-md transform scale-105' : 'bg-white text-slate-400 hover:bg-emerald-50 hover:text-[#10b981] border border-slate-200'}`}>O</button>
                    <button onClick={() => handleGrade(q.tq_id, 'X')} className={`h-10 rounded-md font-black text-xs transition-all ${mark === 'X' ? 'bg-[#ef4444] text-white shadow-md transform scale-105' : 'bg-white text-slate-400 hover:bg-rose-50 hover:text-[#ef4444] border border-slate-200'}`}>X</button>
                    <button onClick={() => handleGrade(q.tq_id, 'TO')} className={`h-10 rounded-md font-bold text-[11px] transition-all ${mark === 'TO' ? 'bg-[#14b8a6] text-white shadow-md transform scale-105' : 'bg-white text-slate-400 hover:bg-teal-50 hover:text-[#14b8a6] border border-slate-200'}`}>TO</button>
                    <button onClick={() => handleGrade(q.tq_id, 'TX')} className={`h-10 rounded-md font-bold text-[11px] transition-all ${mark === 'TX' ? 'bg-[#f97316] text-white shadow-md transform scale-105' : 'bg-white text-slate-400 hover:bg-orange-50 hover:text-[#f97316] border border-slate-200'}`}>TX</button>
                    {/* 💡 [수정] RO 버튼 위치 이동 (TX와 ☆ 사이) */}
                    <button onClick={() => handleGrade(q.tq_id, 'RO')} className={`h-10 rounded-md font-bold text-[11px] transition-all ${mark === 'RO' ? 'bg-[#3b82f6] text-white shadow-md transform scale-105' : 'bg-white text-slate-400 hover:bg-blue-50 hover:text-[#3b82f6] border border-slate-200'}`}>RO</button>
                    <button onClick={() => handleGrade(q.tq_id, '☆')} className={`h-10 rounded-md font-black text-sm transition-all ${mark === '☆' ? 'bg-[#f59e0b] text-white shadow-md transform scale-105' : 'bg-white text-slate-400 hover:bg-amber-50 hover:text-[#f59e0b] border border-slate-200'}`}>☆</button>
                    <button onClick={() => handleGrade(q.tq_id, 'B')} className={`h-10 rounded-md font-bold text-xs transition-all ${mark === 'B' ? 'bg-[#64748b] text-white shadow-md transform scale-105' : 'bg-white text-slate-400 hover:bg-slate-100 hover:text-[#64748b] border border-slate-200'}`}>B</button>
                  </div>

                </div>
              );
            })
          )}
        </div>

        <div className="mt-6 pt-6 border-t border-slate-300 flex justify-center pb-20 gap-4">
          <button 
            onClick={() => window.location.href = '/learning'} 
            className="bg-[#002864] hover:bg-blue-900 text-white font-extrabold text-[15px] py-4 px-12 rounded-xl shadow-lg transition-transform hover:-translate-y-1 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            이전 화면으로 (다음 학생 채점)
          </button>
        </div>
      </main>

      {modalQ && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-lg flex items-center gap-2"><span>🔍</span> {modalQ.question_number}번 문항 상세</h2>
              <button onClick={() => setModalQ(null)} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50 space-y-6">
              
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-extrabold text-slate-800 border-b border-slate-100 pb-2 mb-3 flex items-center gap-2">
                  <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-xs">질문</span>
                </h3>
                {/* 💡 [수정] 모달 내 질문 렌더링 시 formatMathTextForWeb 적용 */}
                <div className="math-text text-slate-700 font-medium whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(modalQ.question || '-').replace(/\n/g, '<br>') }} />
                {getCleanUrl(modalQ.image_url) && <img src={getCleanUrl(modalQ.image_url)} className="max-w-full mt-4 rounded-lg border border-slate-200" alt="Question" />}
              </div>
              
              <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm">
                <h3 className="font-extrabold text-blue-800 border-b border-blue-200 pb-2 mb-3 flex items-center gap-2">
                  <span className="bg-blue-200 text-blue-800 px-2 py-0.5 rounded text-xs">정답</span>
                </h3>
                {/* 💡 [수정] 모달 내 정답 렌더링 시 formatMathTextForWeb 적용 */}
                <div className="math-text text-blue-700 font-bold text-lg whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: `$ ${formatMathTextForWeb(modalQ.answer || '-')} $` }} />
              </div>

            </div>
            <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0">
              <button onClick={() => setModalQ(null)} className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg shadow-sm">닫기</button>
            </div>
          </div>
        </div>
      )}

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