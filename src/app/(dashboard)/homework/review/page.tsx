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
    return [];
  }
  return [];
};

const formatMathTextForWeb = (text: string) => {
  if (!text) return "";
  let t = String(text).replace(/</g, ' &lt; ').replace(/>/g, ' &gt; ');
  t = t.replace(/\\bigcirc/g, '\\circ').replace(/\^{?[○◯]}?/g, '^{\\circ}').replace(/([0-9]+)\s*[○◯]/g, '$1^{\\circ}');
  return t;
};

const processGroupText = (items: any[]) => {
  if (!items || items.length === 0) return { common: "", remainders: [] };
  if (items.length === 1) return { common: "", remainders: [items[0].question || items[0].text_question || ""] };

  let rawStrings = items.map(i => i.question || i.text_question || "");
  if (rawStrings.some(s => !s)) return { common: "", remainders: rawStrings };

  const removeNumberingRegex = /^((?:<[^>]+>|\s|&nbsp;)*)(?:\([0-9가-힣a-zA-Z]+\)|[①-⑳]|[0-9]+[\.\)])((?:<[^>]+>|\s|&nbsp;)*)/i;
  let cleanedStrings = rawStrings.map(s => s.replace(removeNumberingRegex, "$1$2"));

  let prefix = cleanedStrings[0];
  for (let i = 1; i < cleanedStrings.length; i++) {
      let s = cleanedStrings[i];
      let j = 0;
      while (j < prefix.length && j < s.length && prefix[j] === s[j]) j++;
      prefix = prefix.substring(0, j);
  }

  let common = prefix;
  let boundary = Math.max(
      prefix.lastIndexOf("<br"), prefix.lastIndexOf("</p>"), 
      prefix.lastIndexOf("</div>"), prefix.lastIndexOf("<table")
  );
  
  if (boundary !== -1) {
      let endTag = prefix.indexOf(">", boundary);
      if (endTag !== -1) common = prefix.substring(0, endTag + 1);
      else common = prefix.substring(0, boundary);
  } else {
      let lastPunc = Math.max(prefix.lastIndexOf("."), prefix.lastIndexOf(":"), prefix.lastIndexOf("시오"));
      if (lastPunc !== -1) {
          if (prefix[lastPunc] === '오') common = prefix.substring(0, lastPunc + 1); 
          else common = prefix.substring(0, lastPunc + 1);
      } else {
          let lastSpace = prefix.lastIndexOf(" ");
          if (lastSpace !== -1) common = prefix.substring(0, lastSpace + 1);
      }
  }

  let remainders = cleanedStrings.map(s => {
      let rem = s.substring(common.length);
      rem = rem.replace(/^(\s*<br\s*\/?>\s*)+/gi, '').trim();
      return rem;
  });

  const textOnlyCommon = common.replace(/<[^>]+>/g, '').trim();
  if (textOnlyCommon.length < 2) return { common: "", remainders: rawStrings };

  return { common, remainders };
};

type GradeCode = 'O' | 'X' | 'TX' | 'TO' | '☆' | 'B' | 'RO';

function HomeworkReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const homeworkId = searchParams.get("homework_id");
  const assignmentId = searchParams.get("assignment_id"); 
  const studentId = searchParams.get("student_id");
  const isExamHw = searchParams.get("is_exam_hw") === 'true'; 

  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState(""); 
  
  const [homeworkInfo, setHomeworkInfo] = useState<any>(null);
  const [studentInfo, setStudentInfo] = useState<any>(null);
  const [hwResult, setHwResult] = useState<any>(null);
  
  const [groups, setGroups] = useState<any[]>([]);
  const [gradingMap, setGradingMap] = useState<Record<number, GradeCode | null>>({});
  const [modalQ, setModalQ] = useState<any>(null);

  const hwResultIdRef = useRef<number | null>(null);
  const mathJaxRef = useRef<boolean>(false);

  useEffect(() => {
    if ((homeworkId || assignmentId) && studentId) {
      loadHomeworkData();
      loadMathJax();
    }
  }, [homeworkId, assignmentId, studentId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== "undefined" && (window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch(() => {});
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [isLoading, groups, modalQ]);

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
      if (isExamHw && assignmentId) {
        const [ { data: stuData }, { data: aData }, { data: ansData } ] = await Promise.all([
          supabase.from('student').select('name, grade').eq('student_id', studentId).single(),
          supabase.from('exam_assignment').select('*, exam_master(*), class(name)').eq('assignment_id', assignmentId).single(),
          supabase.from('student_answer').select('question_id, grading_code').eq('exam_assignment_id', assignmentId)
        ]);

        const em = Array.isArray(aData.exam_master) ? aData.exam_master[0] : aData.exam_master;
        setStudentInfo(stuData);
        setHomeworkInfo({ homework_title: em.title, class: aData.class, textbook: { title: '맞춤 과제프린트' } });
        setHwResult({ status: aData.status, hw_result_id: aData.assignment_id }); 
        
        const { data: items } = await supabase.from('exam_item').select('question_id, sort_order').eq('exam_id', em.exam_id).order('sort_order');
        const qIds = items?.map(i => i.question_id) || [];
        
        let qs: any[] = [];
        if (qIds.length > 0) {
          const { data } = await supabase.from('question_db').select('*').in('question_id', qIds);
          qs = data || [];
        }
        
        const sortedQs = items?.map(item => {
          const q = qs.find(q => q.question_id === item.question_id);
          return q ? { ...q, tq_id: q.question_id } : null; 
        }).filter(Boolean) || [];

        let userMergedTextQuestions: any[][] = [];
        if (em.layout_settings?.userMergedTextQuestions) {
            userMergedTextQuestions = em.layout_settings.userMergedTextQuestions;
        }

        const customGroupMap = new Map<string, string>();
        userMergedTextQuestions.forEach((arr, idx) => {
            const gId = `custom_group_${idx}`;
            arr.forEach(qid => customGroupMap.set(String(qid), gId));
        });

        const groupMap = new Map(); const builtGroups: any[] = [];
        sortedQs.forEach(q => {
            let gId = customGroupMap.get(String(q.question_id));
            if (!gId) gId = `single_${q.question_id}_${Math.random()}`; 
            
            if (!groupMap.has(gId)) { 
              const newG = { 
                 id: gId, items: [], 
                 is_merged_text: !!customGroupMap.get(String(q.question_id)) 
              }; 
              groupMap.set(gId, newG); 
              builtGroups.push(newG); 
            }
            groupMap.get(gId).items.push(q);
        });

        let mainNum = 1;
        builtGroups.forEach(g => {
            g.displayNum = mainNum++;
            g.items.forEach((item: any, i: number) => {
                 item.displayQNum = g.items.length > 1 ? `${g.displayNum}. (${i + 1})` : `${g.displayNum}`;
            });
        });
        
        setGroups(builtGroups);

        const initialGrading: Record<any, GradeCode | null> = {};
        ansData?.forEach(a => { if(a.grading_code) initialGrading[a.question_id] = a.grading_code as GradeCode; });
        setGradingMap(initialGrading);
        setIsLoading(false);
        return;
      }

      // 기존 일반 교재 과제 로직
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
            .select('*, question_db(*)')
            .in('tq_id', tqIds)
            .order('page_number', { ascending: true })
            .order('question_number', { ascending: true });
          
          const builtGroups: any[] = [];
          tqs?.forEach((tq: any, idx: number) => {
              const q = tq.question_db || {};
              const item = { ...q, tq_id: tq.tq_id, question: tq.question || q.question, answer: tq.answer || q.answer, page_number: tq.page_number || q.page_number, displayQNum: String(idx + 1) };
              builtGroups.push({ id: `single_${tq.tq_id}`, is_merged_text: false, items: [item] });
          });
          
          setGroups(builtGroups);
          
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
    const flatQuestions = groups.reduce((acc, g) => acc.concat(g.items), []);
    
    flatQuestions.forEach((q: any) => {
      const m = newMap[q.tq_id];
      if (m) {
        gradedCount++;
        if (['O', 'TO', 'RO'].includes(m as string)) correctCount++;
        if (['X', 'TX', '☆', 'B'].includes(m as string)) incorrectIds.push(q.tq_id);
      }
    });

    const totalQ = flatQuestions.length;
    let newStatus = '미제출';
    if (gradedCount > 0) newStatus = '진행중';
    if (gradedCount === totalQ && totalQ > 0) newStatus = '채점완료';

    if (isExamHw && assignmentId) {
      await supabase.from('exam_assignment').update({ status: newStatus }).eq('assignment_id', assignmentId);
      return;
    }

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

      if (isExamHw && assignmentId) {
        const [ { data: existingA }, { data: existingI } ] = await Promise.all([
          supabase.from('student_answer').select('answer_id').eq('exam_assignment_id', assignmentId).eq('question_id', tqId).maybeSingle(),
          supabase.from('student_incorrect_record').select('record_id').eq('student_id', studentId).eq('source_type', '시험지').eq('question_id', tqId).maybeSingle()
        ]);

        if (existingA) await supabase.from('student_answer').update({ grading_code: mark, is_correct: isCorrect, earned_score: isCorrect ? 1 : 0 }).eq('answer_id', existingA.answer_id);
        else await supabase.from('student_answer').insert({ exam_assignment_id: assignmentId, student_id: studentId, question_id: tqId, grading_code: mark, is_correct: isCorrect, earned_score: isCorrect ? 1 : 0 });

        if (isIncorrect) {
          if (existingI) await supabase.from('student_incorrect_record').update({ status: mark, resolved_at: null }).eq('record_id', existingI.record_id);
          else await supabase.from('student_incorrect_record').insert({ student_id: studentId, question_id: tqId, source_type: '시험지', status: mark });
        } else if (isCorrect && existingI) {
          await supabase.from('student_incorrect_record').update({ status: mark, resolved_at: new Date().toISOString() }).eq('record_id', existingI.record_id);
        }
      } else {
        const [ { data: existingA }, { data: existingI } ] = await Promise.all([
          supabase.from('student_homework_answer').select('hw_answer_id').eq('homework_id', homeworkId).eq('student_id', studentId).eq('tq_id', tqId).maybeSingle(),
          supabase.from('student_incorrect_record').select('record_id').eq('student_id', studentId).eq('source_type', '교재과제').eq('tq_id', tqId).maybeSingle()
        ]);

        if (existingA) await supabase.from('student_homework_answer').update({ grading_code: mark, is_correct: isCorrect, earned_score: isCorrect ? 1 : 0 }).eq('hw_answer_id', existingA.hw_answer_id);
        else await supabase.from('student_homework_answer').insert({ homework_id: Number(homeworkId), student_id: studentId, tq_id: tqId, grading_code: mark, is_correct: isCorrect, earned_score: isCorrect ? 1 : 0 });

        if (isIncorrect) {
          if (existingI) await supabase.from('student_incorrect_record').update({ status: mark, resolved_at: null }).eq('record_id', existingI.record_id);
          else await supabase.from('student_incorrect_record').insert({ student_id: studentId, tq_id: tqId, source_type: '교재과제', status: mark });
        } else if (isCorrect && existingI) {
          await supabase.from('student_incorrect_record').update({ status: mark, resolved_at: new Date().toISOString() }).eq('record_id', existingI.record_id);
        }
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
      const flatQuestions = groups.reduce((acc, g) => acc.concat(g.items), []);
      const targets = flatQuestions.filter((q: any) => !gradingMap[q.tq_id]);
      if(targets.length === 0) { setSaveStatus(""); return; }

      targets.forEach((q: any) => newMap[q.tq_id] = mark);
      setGradingMap(newMap);

      const isCorrect = ['O', 'TO', 'RO'].includes(mark);
      const isIncorrect = ['X', 'TX', '☆', 'B'].includes(mark);

      if (isExamHw && assignmentId) {
        const [ { data: existingAns }, { data: existingInc } ] = await Promise.all([
          supabase.from('student_answer').select('answer_id, question_id').eq('exam_assignment_id', assignmentId).eq('student_id', studentId),
          supabase.from('student_incorrect_record').select('record_id, question_id').eq('student_id', studentId).eq('source_type', '시험지')
        ]);

        const ansInserts: any[] = []; const ansUpdates: any[] = [];
        const incInserts: any[] = []; const incUpdates: any[] = [];

        targets.forEach((q: any) => {
          const exA = existingAns?.find(a => a.question_id === q.tq_id);
          if (exA) ansUpdates.push({ answer_id: exA.answer_id, grading_code: mark, is_correct: isCorrect, earned_score: isCorrect ? 1 : 0 });
          else ansInserts.push({ exam_assignment_id: assignmentId, student_id: studentId, question_id: q.tq_id, grading_code: mark, is_correct: isCorrect, earned_score: isCorrect ? 1 : 0 });

          const exI = existingInc?.find(i => i.question_id === q.tq_id);
          if (isIncorrect) {
            if (exI) incUpdates.push({ record_id: exI.record_id, status: mark, resolved_at: null });
            else incInserts.push({ student_id: studentId, question_id: q.tq_id, source_type: '시험지', status: mark });
          } else if (isCorrect && exI) {
            incUpdates.push({ record_id: exI.record_id, status: mark, resolved_at: new Date().toISOString() });
          }
        });

        if (ansInserts.length > 0) await supabase.from('student_answer').insert(ansInserts);
        for(const u of ansUpdates) await supabase.from('student_answer').update({ grading_code: u.grading_code, is_correct: u.is_correct, earned_score: u.earned_score }).eq('answer_id', u.answer_id);
        
        if (incInserts.length > 0) await supabase.from('student_incorrect_record').insert(incInserts);
        for(const u of incUpdates) await supabase.from('student_incorrect_record').update({ status: u.status, resolved_at: u.resolved_at }).eq('record_id', u.record_id);

      } else {
        const [ { data: existingAns }, { data: existingInc } ] = await Promise.all([
          supabase.from('student_homework_answer').select('hw_answer_id, tq_id').eq('homework_id', homeworkId).eq('student_id', studentId),
          supabase.from('student_incorrect_record').select('record_id, tq_id').eq('student_id', studentId).eq('source_type', '교재과제')
        ]);

        const ansInserts: any[] = []; const ansUpdates: any[] = [];
        const incInserts: any[] = []; const incUpdates: any[] = [];

        targets.forEach((q: any) => {
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
      }

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

  const flatQuestions = groups.reduce((acc, g) => acc.concat(g.items), []);
  const totalQ = flatQuestions.length;
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
        <div className="max-w-[900px] mx-auto space-y-4 pb-10">
          {groups.length === 0 ? (
            <div className="text-center py-20 text-slate-400 font-bold bg-white rounded-xl border border-slate-200">배부된 문항이 없습니다.</div>
          ) : (
            groups.map((g: any, gIdx: number) => {
              const { common, remainders } = g.is_merged_text ? processGroupText(g.items) : { common: "", remainders: [] };

              return (
                <div key={`group_${gIdx}`} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
                  {g.is_merged_text && common && (
                     <div className="bg-slate-50 border-b border-slate-100 px-5 py-4">
                        <div className="font-myungjo font-semibold text-[16px] text-slate-800 leading-[2.2] tracking-wide break-keep" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(common) }} />
                     </div>
                  )}

                  {g.items.map((q: any, subIdx: number) => {
                    const mark = gradingMap[q.tq_id];
                    
                    let rowBg = "bg-white hover:bg-slate-50";
                    if (mark === 'O') rowBg = "bg-[#10b981]/10";
                    else if (mark === 'X') rowBg = "bg-[#ef4444]/10";
                    else if (mark === 'TO') rowBg = "bg-[#14b8a6]/10";
                    else if (mark === 'TX') rowBg = "bg-[#f97316]/10";
                    else if (mark === '☆') rowBg = "bg-[#f59e0b]/10";
                    else if (mark === 'B') rowBg = "bg-slate-300/30";
                    else if (mark === 'RO') rowBg = "bg-[#3b82f6]/10";

                    const textToRender = g.is_merged_text && remainders[subIdx] ? remainders[subIdx] : (q.question || q.text_question || '');

                    return (
                      <div key={q.tq_id} className={`flex items-center p-4 gap-4 ${subIdx > 0 ? 'border-t border-slate-100' : ''} ${rowBg} transition-colors`}>
                        <div className="flex flex-col items-center justify-center shrink-0 w-16 gap-1">
                          <span className="text-[#002864] font-black text-[18px] whitespace-nowrap">{q.displayQNum}</span>
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 truncate max-w-full" title="출처 페이지">{q.page_number || q.final_printed_page || q.detected_page_num || '-'}p</span>
                        </div>

                        <div className="flex-1 bg-white/60 px-4 py-3 rounded-lg border border-slate-200 flex flex-col gap-2 overflow-hidden shadow-inner">
                          <div className="font-bold text-slate-800 text-[14px] math-text whitespace-pre-wrap">
                            <span dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(textToRender) }} />
                            {getCleanUrl(q.image_url) && <img src={getCleanUrl(q.image_url)} className="max-w-full max-h-40 mt-2 mix-blend-multiply" alt="" />}
                          </div>
                          <div className="mt-2 pt-2 border-t border-dashed border-slate-200 flex items-center gap-2">
                             <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-extrabold shrink-0">DB 정답</span>
                             <div className="font-bold text-blue-800 text-[13px] math-text truncate">
                               {q.answer ? <span dangerouslySetInnerHTML={{ __html: `$ ${formatMathTextForWeb(q.answer)} $` }} /> : <span className="text-slate-400 font-normal italic">-</span>}
                             </div>
                          </div>
                        </div>

                        <div className="flex flex-col items-center gap-2 shrink-0 w-[50px]">
                           <button onClick={() => setModalQ(q)} className="bg-white border border-slate-300 hover:bg-slate-100 hover:border-slate-400 text-slate-600 text-[11px] font-bold p-1.5 rounded shadow-sm transition-colors w-full" title="상세 해설 보기">🔍 풀이</button>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5 shrink-0 w-[120px]">
                          <button onClick={() => handleGrade(q.tq_id, 'O')} className={`h-8 rounded font-black text-xs transition-all ${mark === 'O' ? 'bg-[#10b981] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-emerald-50 hover:text-[#10b981] border border-slate-200'}`}>O</button>
                          <button onClick={() => handleGrade(q.tq_id, 'X')} className={`h-8 rounded font-black text-xs transition-all ${mark === 'X' ? 'bg-[#ef4444] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-rose-50 hover:text-[#ef4444] border border-slate-200'}`}>X</button>
                          <button onClick={() => handleGrade(q.tq_id, 'TO')} className={`h-8 rounded font-bold text-[11px] transition-all ${mark === 'TO' ? 'bg-[#14b8a6] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-teal-50 hover:text-[#14b8a6] border border-slate-200'}`}>TO</button>
                          <button onClick={() => handleGrade(q.tq_id, 'TX')} className={`h-8 rounded font-bold text-[11px] transition-all ${mark === 'TX' ? 'bg-[#f97316] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-orange-50 hover:text-[#f97316] border border-slate-200'}`}>TX</button>
                          <button onClick={() => handleGrade(q.tq_id, 'RO')} className={`h-8 rounded font-bold text-[11px] transition-all ${mark === 'RO' ? 'bg-[#3b82f6] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-blue-50 hover:text-[#3b82f6] border border-slate-200'}`}>RO</button>
                          <button onClick={() => handleGrade(q.tq_id, '☆')} className={`h-8 rounded font-black text-sm transition-all ${mark === '☆' ? 'bg-[#f59e0b] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-amber-50 hover:text-[#f59e0b] border border-slate-200'}`}>☆</button>
                          <button onClick={() => handleGrade(q.tq_id, 'B')} className={`h-8 rounded font-bold text-xs transition-all col-span-2 ${mark === 'B' ? 'bg-[#64748b] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-slate-100 hover:text-[#64748b] border border-slate-200'}`}>B (빈칸)</button>
                        </div>
                      </div>
                    );
                  })}
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
              <h2 className="font-bold text-lg flex items-center gap-2"><span>🔍</span> {modalQ.displayQNum || modalQ.question_number}번 문항 상세</h2>
              <button onClick={() => setModalQ(null)} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50 space-y-6">
              
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-extrabold text-slate-800 border-b border-slate-100 pb-2 mb-3 flex items-center gap-2">
                  <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-xs">질문</span>
                </h3>
                <div className="math-text text-slate-700 font-medium whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(modalQ.question || '-').replace(/\n/g, '<br>') }} />
                {getCleanUrl(modalQ.image_url) && <img src={getCleanUrl(modalQ.image_url)} className="max-w-full mt-4 rounded-lg border border-slate-200" alt="Question" />}
              </div>
              
              <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm">
                <h3 className="font-extrabold text-blue-800 border-b border-blue-200 pb-2 mb-3 flex items-center gap-2">
                  <span className="bg-blue-200 text-blue-800 px-2 py-0.5 rounded text-xs">정답</span>
                </h3>
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