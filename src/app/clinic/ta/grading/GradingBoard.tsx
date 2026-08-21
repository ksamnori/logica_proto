// src/app/clinic/ta/grading/GradingBoard.tsx
"use client";

import React, { useEffect, useState, useRef, memo } from "react";
import { supabase } from "@/lib/supabase";

const GRADE_CODES: { code: string; title: string }[] = [
  { code: 'O', title: '정답' },
  { code: 'X', title: '오답' },
  { code: 'TX', title: '힌트 후 오답' },
  { code: 'TO', title: '힌트 후 정답' },
  { code: 'RO', title: '도움 없이 재도전하여 정답' },
  { code: '☆', title: '별표 (질문)' },
  { code: 'B', title: '빈칸 (미응시)' },
];

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

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

const parseOptions = (raw: any): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};

const isObjectiveQuestion = (q: any) => {
  if (!q) return false;
  if (parseOptions(q.options).length > 0) return true;
  const ans = String(q.answer ?? '').trim().replace(/\$/g, '').trim();
  return CIRCLED_DIGITS.includes(ans);
};

const getResultStyle = (code: string | null) => {
  if (!code) return 'bg-white text-slate-400';
  if (['O', 'TO', 'RO'].includes(code)) return 'bg-emerald-50 text-emerald-600';
  if (['X', 'TX'].includes(code)) return 'bg-rose-50 text-rose-600';
  if (code === '☆') return 'bg-amber-50 text-amber-500';
  if (code === 'B') return 'bg-slate-100 text-slate-500';
  return 'bg-blue-50 text-blue-600';
};

interface GradeButtonProps {
  code: string;
  currentCode: string;
  onClick: () => void;
}

const GradeButton = memo(({ code, currentCode, onClick }: GradeButtonProps) => {
  let bgClass = "bg-white text-slate-500 hover:bg-slate-100";
  let checkedClass = "text-white";

  if (['O', 'TO', 'RO'].includes(code)) checkedClass += " bg-[#10b981]";
  else if (['X', 'TX'].includes(code)) checkedClass += " bg-[#ef4444]";
  else if (code === '☆') checkedClass += " bg-[#f59e0b]";
  else if (code === 'B') checkedClass += " bg-[#64748b]";
  else checkedClass += " bg-[#0ea5e9]";

  const isChecked = currentCode === code;

  return (
    <button
      onClick={onClick}
      className={`flex justify-center items-center text-[10px] font-bold h-[28px] w-full transition-colors ${isChecked ? checkedClass : bgClass}`}
    >
      {code}
    </button>
  );
});
GradeButton.displayName = "GradeButton";

interface GradingBoardProps {
  mode: 'exam' | 'homework';
  assignmentId?: string;
  homeworkId?: string;
  studentId?: string;
  gradeAll?: boolean; 
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function GradingBoard({ mode, assignmentId, homeworkId, studentId: studentIdParam, gradeAll = false, onBack, onDirtyChange }: GradingBoardProps) {
  const isHomeworkMode = mode === 'homework';

  const [headerInfo, setHeaderInfo] = useState({ title: "📝 상세 채점표", subtitle: "데이터 불러오는 중...", type: "" });
  
  const [matrixData, setMatrixData] = useState<{
    cols: any[];
    rows: any[];
    cellMap: Map<string, any>;
  }>({ cols: [], rows: [], cellMap: new Map() });

  const [pendingUpdates, setPendingUpdates] = useState<{ [key: string]: any }>({});
  const [gradingCodeMeta, setGradingCodeMeta] = useState<any>({});

  const [isSaving, setIsSaving] = useState(false);
  const [modalQ, setModalQ] = useState<any>(null);

  const mathJaxRef = useRef(false);

  useEffect(() => {
    loadMathJax();
    if (isHomeworkMode) loadMatrixHomework();
    else if (assignmentId) loadMatrixExam();
    else { alert("잘못된 접근입니다."); onBack(); }
  }, [assignmentId, homeworkId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== "undefined" && (window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch(() => {});
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [matrixData, pendingUpdates, modalQ]);

  useEffect(() => {
    onDirtyChange?.(Object.keys(pendingUpdates).length > 0);
  }, [pendingUpdates]);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = {
        tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]], processEscapes: true },
        chtml: { displayAlign: 'left', displayIndent: '0em' },
        svg: { fontCache: 'global' }
      };
      const script = document.createElement("script");
      script.id = "MathJax-script";
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
      script.async = true;
      document.head.appendChild(script);
    }
  };

  const formatMathTextForWeb = (text: string) => {
    if (!text) return "";
    let t = String(text).replace(/</g, ' &lt; ').replace(/>/g, ' &gt; ');
    t = t.replace(/\\bigcirc/g, '\\circ').replace(/\^{?[○◯]}?/g, '^{\\circ}').replace(/([0-9]+)\s*[○◯]/g, '$1^{\\circ}');
    return t;
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

  const calcScoreRatio = (code: string, assignedScore: number, metaMap: any) => {
    let meta = metaMap[code]; let ratio = 0; let isCorrectEq = false;
    if (meta) {
      ratio = parseFloat(meta.score_ratio) || 0; if (ratio > 1) ratio = ratio / 100;
      isCorrectEq = meta.is_correct === true || String(meta.is_correct).toLowerCase() === 'true';
    } else {
      if (['O', 'RO'].includes(code)) { ratio = 1.0; isCorrectEq = true; }
      else if (code === 'TO') { ratio = 0.8; isCorrectEq = true; }
      else { ratio = 0.0; isCorrectEq = false; }
    }
    return { newEarned: assignedScore * ratio, isCorrectEq };
  };

  const loadMatrixHomework = async () => {
    try {
      const { data: gcData } = await supabase.from('master_grading_code').select('code, description, is_correct, score_ratio');
      const meta: any = {}; gcData?.forEach(row => { if (row.code) meta[row.code] = row; });
      setGradingCodeMeta(meta);

      const { data: baseHw } = await supabase.from('homework_assignment').select('*, class(name), student_homework_result(student_id)').eq('homework_id', homeworkId).single();
      if (!baseHw) {
        alert("과제 기준 데이터를 찾을 수 없습니다.");
        onBack();
        return;
      }

      setHeaderInfo({ title: `📚 ${baseHw.homework_title} ${gradeAll ? '일괄 채점' : '개별 채점'}`, subtitle: `[${baseHw.class?.name || '반 미지정'}] 스프레드시트 뷰`, type: '과제' });

      let validStudentIds: string[] = [];
      if (baseHw.target_student_id) {
         validStudentIds.push(baseHw.target_student_id);
      } else if (baseHw.student_homework_result) {
         validStudentIds = baseHw.student_homework_result.map((r: any) => r.student_id);
      }

      if (validStudentIds.length === 0) {
        alert("이 과제를 배부받은 학생이 없습니다.");
        onBack();
        return;
      }

      const { data: targetStudents } = await supabase.from('student').select('student_id, name, status').in('student_id', validStudentIds);

      let cols = (targetStudents || [])
        .filter(s => s.status === '재원')
        .map(s => ({ id: s.student_id, name: s.name || '알수없음' }))
        .sort((a,b) => a.name.localeCompare(b.name));
      
      if (!gradeAll && studentIdParam) {
        cols = cols.filter(c => c.id === studentIdParam);
      }

      // 🌟 [핵심 변경] 채점할 대상 학생이 없으면 에러 던지지 않고 깔끔하게 뒤로가기
      if (cols.length === 0) {
        alert("🎉 해당 과제의 채점이 모두 완료되었습니다!");
        onBack();
        return;
      }

      const { data: allHws } = await supabase.from('homework_assignment').select('*').eq('class_id', baseHw.class_id).eq('homework_title', baseHw.homework_title);
      const hwIdsToFetchStatus = allHws?.map(h => h.homework_id) || [];
      const { data: hwResults } = await supabase.from('student_homework_result').select('homework_id, student_id, status, completed_tq_ids').in('homework_id', hwIdsToFetchStatus);

      const baseResult = hwResults?.find(r => r.homework_id === baseHw.homework_id);
      const isBaseCompleted = ['채점완료', '제출완료', '완료'].includes(baseResult?.status || '');

      const studentHwMap = new Map();
      const globalHw = allHws?.find(h => !h.target_student_id);
      
      cols.forEach(s => {
        let studentHws = allHws?.filter(h => h.target_student_id === s.id) || [];
        
        if (studentHws.length === 0 && globalHw) {
          studentHwMap.set(s.id, globalHw);
          return;
        }
        
        studentHws.sort((a, b) => b.homework_id - a.homework_id); 

        let selectedHw = studentHws[0];
        if (s.id === baseHw.target_student_id) {
          selectedHw = baseHw;
        } else {
          const matched = studentHws.find(h => {
            const r = hwResults?.find(res => res.homework_id === h.homework_id);
            const isComp = ['채점완료', '제출완료', '완료'].includes(r?.status || '');
            return isComp === isBaseCompleted;
          });
          if (matched) selectedHw = matched;
        }
        
        if (selectedHw) studentHwMap.set(s.id, selectedHw);
      });

      let hwTargetQs: any[] = [];
      try { hwTargetQs = typeof baseHw.target_questions === 'string' ? JSON.parse(baseHw.target_questions) : baseHw.target_questions; } catch(e){}
      
      if (!hwTargetQs || hwTargetQs.length === 0) {
        alert("과제에 포함된 문항이 없습니다.");
        onBack();
        return;
      }

      const allTqIds = new Set<number>();
      cols.forEach(s => {
        const hw = studentHwMap.get(s.id);
        const res = hwResults?.find(r => r.homework_id === hw.homework_id);
        const completedIds = new Set(safeParseIds(res?.completed_tq_ids));

        let tqs = safeParseIds(hw.target_questions);
        tqs.forEach((id: number) => {
          if (!isBaseCompleted && completedIds.has(id)) return;
          allTqIds.add(id);
        });
      });

      // 🌟 [핵심 변경] 모든 문항이 채점완료라면 에러 화면으로 튕기지 않고 기분 좋게 뒤로가기
      if (allTqIds.size === 0) {
        alert("🎉 이 과제에 남은 모든 문항의 채점이 완료되었습니다!");
        onBack();
        return;
      }

      const tqList = Array.from(allTqIds);
      let tqData: any[] = [];
      for (let i = 0; i < tqList.length; i += 150) {
        const chunk = tqList.slice(i, i + 150);
        const { data } = await supabase.from('textbook_question').select('*, question_db(*)').in('tq_id', chunk);
        if (data) tqData = [...tqData, ...data];
      }

      tqData.sort((a, b) => {
        if ((a.page_number || 0) !== (b.page_number || 0)) return (a.page_number || 0) - (b.page_number || 0);
        return String(a.question_number || '').localeCompare(String(b.question_number || ''), undefined, { numeric: true });
      });

      const rows = tqData.map((tq: any) => {
        const q = tq.question_db || {};
        return {
          id: tq.tq_id,
          qId: q.question_id,
          displayNum: String(tq.question_number || q.question_number || '').replace(/TWIN/gi, 'T').replace(/SIMILAR/gi, 'S').replace(/CLINIC/gi, 'C'),
          pageNum: tq.page_number || q.page_number,
          answer: tq.answer || q.answer,
          fullQuestion: { items: [{ question: { ...q, question: tq.question || q.question, answer: tq.answer || q.answer } }] },
          assignedScore: 100 / (tqData.length || 1)
        };
      });

      const activeHwIds = Array.from(new Set(cols.map(s => studentHwMap.get(s.id).homework_id)));
      const { data: answers } = await supabase.from('student_homework_answer').select('*').in('homework_id', activeHwIds);
      
      const cellMap = new Map();
      const initialPending: any = {};

      const targetSet = new Set(tqList);

      cols.forEach(s => {
        const hw = studentHwMap.get(s.id);
        const res = hwResults?.find(r => r.homework_id === hw.homework_id);
        const completedIds = new Set(safeParseIds(res?.completed_tq_ids));
        const hwTargetSet = new Set(safeParseIds(hw.target_questions));

        rows.forEach(r => {
          const key = `${s.id}_${r.id}`;
          
          if (!hwTargetSet.has(r.id) || (!isBaseCompleted && completedIds.has(r.id))) {
            cellMap.set(key, { isBlocked: true });
            return;
          }

          const existingAns = answers?.find(a => a.student_id === s.id && a.homework_id === hw.homework_id && a.tq_id === r.id);
          cellMap.set(key, {
            isBlocked: false,
            answerId: existingAns?.hw_answer_id || null,
            homeworkId: hw.homework_id,
            studentId: s.id,
            tqId: r.id,
            qId: r.qId,
            currentCode: existingAns?.grading_code || null,
            assignedScore: r.assignedScore
          });
        });
      });

      setMatrixData({ cols, rows, cellMap });
      setPendingUpdates(initialPending);

    } catch (e: any) { 
      alert(`데이터 로드 실패: ${e.message}`); 
      onBack();
    }
  };

  const loadMatrixExam = async () => {
    try {
      const { data: gcData } = await supabase.from('master_grading_code').select('code, description, is_correct, score_ratio');
      const meta: any = {}; gcData?.forEach(row => { if (row.code) meta[row.code] = row; });
      setGradingCodeMeta(meta);

      const { data: baseEx } = await supabase.from('exam_assignment').select('*, exam_master(*), class(name)').eq('assignment_id', assignmentId).single();
      if (!baseEx) {
        alert("시험 기준 데이터를 찾을 수 없습니다.");
        onBack();
        return;
      }

      const m = Array.isArray(baseEx.exam_master) ? baseEx.exam_master[0] : baseEx.exam_master;
      setHeaderInfo({ title: `📝 ${m?.title} ${gradeAll ? '일괄 채점' : '개별 채점'}`, subtitle: `[${baseEx.class?.name || '반 미지정'}] 스프레드시트 뷰`, type: m?.exam_type });

      const { data: allAssigns } = await supabase.from('exam_assignment').select('*, student(name)').eq('exam_id', m.exam_id).eq('class_id', baseEx.class_id);
      let cols = (allAssigns || []).map((a: any) => {
        const sObj = Array.isArray(a.student) ? a.student[0] : a.student;
        return {
          id: a.student_id,
          name: sObj?.name || '알수없음',
          assignmentId: a.assignment_id
        };
      }).sort((a: any, b: any) => a.name.localeCompare(b.name));

      if (!gradeAll && studentIdParam) {
        cols = cols.filter(c => c.id === studentIdParam);
      }

      if (cols.length === 0) {
        alert("대상 학생이 없습니다.");
        onBack();
        return;
      }

      const { data: items } = await supabase.from('exam_item').select('*').eq('exam_id', m.exam_id).order('sort_order');
      if (!items || items.length === 0) {
        alert("시험에 포함된 문항이 없습니다.");
        onBack();
        return;
      }

      const qIds = items.map(i => i.question_id);
      let fetchedQuestions: any[] = [];
      for (let i = 0; i < qIds.length; i += 150) {
        const chunk = qIds.slice(i, i + 150);
        const { data } = await supabase.from('question_db').select('*').in('question_id', chunk);
        if (data) fetchedQuestions = [...fetchedQuestions, ...data];
      }

      const qMap: any = {}; fetchedQuestions.forEach(q => qMap[q.question_id] = q);

      const rows = items.map(item => {
        const q = qMap[item.question_id] || {};
        return {
          id: item.question_id,
          displayNum: item.sort_order,
          pageNum: q.page_number || null,
          answer: q.answer,
          fullQuestion: { items: [{ question: q }] },
          assignedScore: item.assigned_score || (100 / items.length)
        };
      });

      const assignIdsToFetch = cols.map(c => c.assignmentId);
      const { data: answers } = await supabase.from('student_answer').select('*').in('exam_assignment_id', assignIdsToFetch);

      const cellMap = new Map();
      cols.forEach(s => {
        rows.forEach(r => {
          const key = `${s.id}_${r.id}`;
          const existingAns = answers?.find(a => a.student_id === s.id && a.question_id === r.id);
          cellMap.set(key, {
            isBlocked: false,
            answerId: existingAns?.answer_id || null,
            assignmentId: s.assignmentId,
            studentId: s.id,
            qId: r.id,
            tqId: null,
            currentCode: existingAns?.grading_code || null,
            assignedScore: r.assignedScore
          });
        });
      });

      setMatrixData({ cols, rows, cellMap });
    } catch (error: any) { 
      alert(`데이터 로드 실패: ${error.message}`); 
      onBack();
    }
  };

  const handleMatrixGrade = (sId: string, rowId: string, code: string) => {
    const key = `${sId}_${rowId}`;
    const cell = matrixData.cellMap.get(key);
    if (!cell || cell.isBlocked) return;

    const { newEarned, isCorrectEq } = calcScoreRatio(code, cell.assignedScore, gradingCodeMeta);
    
    setPendingUpdates(prev => ({
      ...prev,
      [key]: {
        type: isHomeworkMode ? 'hw' : 'exam',
        answer_id: cell.answerId,
        homework_id: cell.homeworkId,
        assignment_id: cell.assignmentId,
        student_id: sId,
        q_id: cell.qId,
        tq_id: cell.tqId,
        grading_code: code,
        is_correct: isCorrectEq,
        earned_score: newEarned
      }
    }));
  };

  const markCol = (sId: string, code: string) => {
    const newPending = { ...pendingUpdates };
    matrixData.rows.forEach(r => {
      const key = `${sId}_${r.id}`;
      const cell = matrixData.cellMap.get(key);
      if (!cell || cell.isBlocked) return;
      const { newEarned, isCorrectEq } = calcScoreRatio(code, cell.assignedScore, gradingCodeMeta);
      newPending[key] = {
        type: isHomeworkMode ? 'hw' : 'exam',
        answer_id: cell.answerId,
        homework_id: cell.homeworkId,
        assignment_id: cell.assignmentId,
        student_id: sId,
        q_id: cell.qId,
        tq_id: cell.tqId,
        grading_code: code,
        is_correct: isCorrectEq,
        earned_score: newEarned
      };
    });
    setPendingUpdates(newPending);
  };

  const markRow = (rowId: string, code: string) => {
    const newPending = { ...pendingUpdates };
    matrixData.cols.forEach(c => {
      const key = `${c.id}_${rowId}`;
      const cell = matrixData.cellMap.get(key);
      if (!cell || cell.isBlocked) return;
      const { newEarned, isCorrectEq } = calcScoreRatio(code, cell.assignedScore, gradingCodeMeta);
      newPending[key] = {
        type: isHomeworkMode ? 'hw' : 'exam',
        answer_id: cell.answerId,
        homework_id: cell.homeworkId,
        assignment_id: cell.assignmentId,
        student_id: c.id,
        q_id: cell.qId,
        tq_id: cell.tqId,
        grading_code: code,
        is_correct: isCorrectEq,
        earned_score: newEarned
      };
    });
    setPendingUpdates(newPending);
  };

  const saveMatrixGrades = async () => {
    const updateKeys = Object.keys(pendingUpdates);
    if (updateKeys.length === 0) return alert("채점된 내용이 없습니다.");
    if (!confirm("채점 결과를 한 번에 저장하시겠습니까?\n틀린 문제는 학생별 오답노트로 연동됩니다.")) return;

    setIsSaving(true);
    try {
      const ansInserts: any[] = [];
      const ansUpdates: any[] = [];
      const studentStatuses = new Set<string>();

      updateKeys.forEach(key => {
        const data = pendingUpdates[key];
        const payload: any = {
          grading_code: data.grading_code,
          is_correct: data.is_correct || false,
          earned_score: Number(data.earned_score) || 0
        };

        if (isHomeworkMode) {
          studentStatuses.add(`${data.homework_id}_${data.student_id}`);
          if (!data.answer_id) ansInserts.push({ ...payload, homework_id: data.homework_id, student_id: data.student_id, tq_id: data.tq_id });
          else ansUpdates.push({ hw_answer_id: data.answer_id, ...payload });
        } else {
          studentStatuses.add(`${data.assignment_id}_${data.student_id}`);
          if (!data.answer_id) ansInserts.push({ ...payload, exam_assignment_id: data.assignment_id, student_id: data.student_id, question_id: data.q_id });
          else ansUpdates.push({ answer_id: data.answer_id, ...payload });
        }
      });

      if (isHomeworkMode) {
        if (ansInserts.length > 0) await supabase.from('student_homework_answer').insert(ansInserts);
        if (ansUpdates.length > 0) {
          await Promise.all(ansUpdates.map(u => supabase.from('student_homework_answer').update({ grading_code: u.grading_code, is_correct: u.is_correct, earned_score: u.earned_score }).eq('hw_answer_id', u.hw_answer_id)));
        }
      } else {
        if (ansInserts.length > 0) await supabase.from('student_answer').insert(ansInserts);
        if (ansUpdates.length > 0) {
          await Promise.all(ansUpdates.map(u => supabase.from('student_answer').update({ grading_code: u.grading_code, is_correct: u.is_correct, earned_score: u.earned_score }).eq('answer_id', u.answer_id)));
        }
      }

      if (isHomeworkMode) {
        for (const statusKey of Array.from(studentStatuses)) {
          const [hwId, stId] = statusKey.split('_');
          
          const { data: allAns } = await supabase.from('student_homework_answer').select('tq_id, grading_code').eq('homework_id', hwId).eq('student_id', stId);
          const completedTqIds = (allAns || []).filter(a => ['O', 'TO', 'RO'].includes(a.grading_code)).map(a => a.tq_id);
          
          const hwObj = Array.from(matrixData.cellMap.values()).find(c => String(c.homeworkId) === hwId && String(c.studentId) === stId && !c.isBlocked);
          if (hwObj) {
            const { data: dbHw } = await supabase.from('homework_assignment').select('target_questions').eq('homework_id', hwId).single();
            let targetQs = [];
            try { targetQs = typeof dbHw?.target_questions === 'string' ? JSON.parse(dbHw.target_questions) : dbHw?.target_questions; } catch(e){}
            const isAllDone = targetQs.length > 0 && completedTqIds.length === targetQs.length;
            await supabase.from('student_homework_result').update({ completed_tq_ids: completedTqIds, status: isAllDone ? '채점완료' : '미제출' }).eq('homework_id', hwId).eq('student_id', stId);
          }
        }
      } else {
        for (const statusKey of Array.from(studentStatuses)) {
          const [assignId, stId] = statusKey.split('_');
          const { data: upAns } = await supabase.from('student_answer').select('question_id, earned_score').eq('exam_assignment_id', assignId);
          let tempT = 0; upAns?.forEach(a => tempT += (Number(a.earned_score) || 0));
          await supabase.from('exam_assignment').update({ total_score: tempT, status: '채점완료' }).eq('assignment_id', assignId);
        }
      }

      const uniqueStudents = Array.from(new Set(updateKeys.map(k => pendingUpdates[k].student_id)));
      for (const stId of uniqueStudents) {
        const stKeys = updateKeys.filter(k => pendingUpdates[k].student_id === stId);
        const { data: exInc } = await supabase.from('student_incorrect_record').select('*').eq('student_id', stId).in('source_type', ['교재과제', '시험지']);
        
        const incInserts: any[] = [];
        const incUpdates: any[] = [];

        stKeys.forEach(k => {
          const data = pendingUpdates[k];
          const isFullyCorrect = ['O', 'TO', 'RO'].includes(data.grading_code);
          const targetQId = isHomeworkMode ? data.tq_id : data.q_id;
          const matchField = isHomeworkMode ? 'tq_id' : 'question_id';

          const match = exInc?.find(e => String(e[matchField]) === String(targetQId));
          const p = { student_id: stId, [matchField]: targetQId, source_type: isHomeworkMode ? '교재과제' : '시험지', status: data.grading_code, resolved_at: isFullyCorrect ? new Date().toISOString() : null };
          
          if (match) incUpdates.push({ record_id: match.record_id, ...p });
          else incInserts.push(p);
        });

        if (incInserts.length > 0) await supabase.from('student_incorrect_record').insert(incInserts);
        if (incUpdates.length > 0) await Promise.all(incUpdates.map(u => supabase.from('student_incorrect_record').update({ status: u.status, resolved_at: u.resolved_at }).eq('record_id', u.record_id)));
      }

      alert("🎉 채점 내역이 성공적으로 저장되었습니다!");
      setPendingUpdates({});
      if (isHomeworkMode) loadMatrixHomework(); else loadMatrixExam();

    } catch (err: any) {
      console.error(err);
      alert(`❌ 저장 오류:\n${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const pendingCount = Object.keys(pendingUpdates).length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50 w-full font-pretendard">
      {/* 헤더 */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div>
          <h2 className="text-[14px] font-black text-[#002864] flex items-center gap-1.5">{headerInfo.title}</h2>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">{headerInfo.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[11px] font-bold whitespace-nowrap ${pendingCount > 0 ? 'text-orange-500' : 'text-slate-400'}`}>
            {pendingCount}건 대기 중
          </span>
          <button onClick={saveMatrixGrades} disabled={isSaving || pendingCount === 0} className="text-[11px] font-black bg-[#002864] hover:bg-blue-900 text-white rounded-lg px-4 py-2 shadow-sm transition-colors disabled:opacity-50">
            {isSaving ? "저장 중..." : "💾 일괄 저장"}
          </button>
        </div>
      </div>

      {/* 매트릭스 뷰 */}
      <div className="flex-1 overflow-auto custom-scroll relative bg-slate-100/50">
        {matrixData.cols.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-400 font-bold text-sm">데이터를 불러오는 중입니다...</div>
        ) : (
          <table className="w-max bg-white">
            <thead className="sticky top-0 z-20 shadow-sm">
              <tr>
                <th className="sticky left-0 z-30 bg-slate-200 p-2 min-w-[150px] w-[150px] border-r border-b text-center align-middle shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                  <div className="flex justify-between items-end px-1">
                    <span className="text-[11px] font-bold text-slate-500">문항 ⬇</span>
                    <span className="text-[11px] font-bold text-slate-500">학생 ➔</span>
                  </div>
                </th>
                {matrixData.cols.map(c => (
                  <th key={c.id} className="p-2 min-w-[140px] w-[140px] border-r border-b bg-slate-100 text-center align-top">
                    <div className="font-extrabold text-[12px] text-[#002864] truncate" title={c.name}>{c.name}</div>
                    <div className="flex mt-2">
                      <button onClick={()=>markCol(c.id, 'O')} className="flex-1 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 border-r-0 rounded-l text-[10px] font-bold hover:bg-emerald-100 transition-colors">전체 O</button>
                      <button onClick={()=>markCol(c.id, 'X')} className="flex-1 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-r text-[10px] font-bold hover:bg-rose-100 transition-colors">전체 X</button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixData.rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/50">
                  <td className="sticky left-0 z-10 bg-white p-2 border-r border-b shadow-[2px_0_5px_rgba(0,0,0,0.02)] align-top min-w-[150px] w-[150px]">
                    <div className="flex justify-between items-center mb-1.5 border-b border-slate-100 pb-1.5 px-0.5">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        {r.pageNum && <span className="text-[10px] font-bold text-slate-400">{r.pageNum}p</span>}
                        {r.pageNum && <span className="text-[10px] text-slate-300">|</span>}
                        <span className="text-[12px] font-black text-[#002864] truncate">{r.displayNum}번</span>
                      </div>
                      <button onClick={()=>setModalQ(r.fullQuestion)} className="text-[11px] text-slate-400 hover:text-blue-500 font-bold px-1 transition-colors" title="상세 보기">🔍</button>
                    </div>
                    
                    <div 
                      onClick={()=>setModalQ(r.fullQuestion)}
                      className="text-[11px] text-blue-700 font-bold bg-blue-50/50 hover:bg-blue-100 px-1 py-2 rounded border border-blue-100 mb-2 cursor-pointer transition-colors text-center overflow-hidden line-clamp-2 break-all" 
                      title="클릭하여 문제/정답 전체 보기"
                      dangerouslySetInnerHTML={{__html: formatMathTextForWeb(r.answer || "-")}} 
                    />
                    
                    <div className="flex mt-auto">
                      <button onClick={()=>markRow(r.id, 'O')} className="flex-1 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 border-r-0 rounded-l text-[10px] font-bold hover:bg-emerald-100 transition-colors">전체 O</button>
                      <button onClick={()=>markRow(r.id, 'X')} className="flex-1 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-r text-[10px] font-bold hover:bg-rose-100 transition-colors">전체 X</button>
                    </div>
                  </td>
                  
                  {/* 채점 셀 */}
                  {matrixData.cols.map(c => {
                    const key = `${c.id}_${r.id}`;
                    const cell = matrixData.cellMap.get(key);
                    
                    if (!cell || cell.isBlocked) {
                      return <td key={key} className="border-r border-b bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQIW2NkQAKrVq36zwjjgzhhYWGMYAEYB8RmROaABAD2OQQ/9rX+aQAAAABJRU5ErkJggg==')] opacity-15 pointer-events-none" />;
                    }

                    const currentCode = pendingUpdates[key]?.grading_code || cell.currentCode;
                    
                    return (
                      <td key={key} className="p-2 border-r border-b transition-colors align-middle">
                        <div className="grid grid-cols-4 gap-px bg-slate-300 border border-slate-300 rounded overflow-hidden w-full max-w-[120px] mx-auto shadow-sm">
                          {GRADE_CODES.map(({code}) => (
                            <GradeButton
                              key={code} code={code}
                              currentCode={currentCode}
                              onClick={() => handleMatrixGrade(c.id, r.id, code)}
                            />
                          ))}
                          <div className={`flex items-center justify-center text-[11px] font-black h-[28px] ${getResultStyle(currentCode)}`}>
                            {currentCode || ''}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalQ && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-lg flex items-center gap-2"><span>🔍</span> 문항 상세 및 해설 뷰어</h2>
              <button onClick={() => setModalQ(null)} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50 space-y-6">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-extrabold text-slate-800 border-b border-slate-100 pb-2 mb-3">질문 (Question)</h3>
                {modalQ.items.map((row: any, idx: number) => {
                  const q = row.question;
                  return (
                    <div key={idx} className="mb-4">
                      <div dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(q.question) }} className="math-text text-slate-700 font-medium whitespace-pre-wrap" />
                      {getCleanUrl(q.image_url) && <img src={getCleanUrl(q.image_url)} className="max-w-full mt-2 rounded-lg border border-slate-200" alt="Q" />}
                    </div>
                  );
                })}
              </div>
              <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm">
                <h3 className="font-extrabold text-blue-800 border-b border-blue-200 pb-2 mb-3">정답 (Answer)</h3>
                {modalQ.items.map((row: any, idx: number) => {
                  const q = row.question;
                  return (
                    <div key={idx} className="mb-4">
                      <div dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(q.answer) }} className="math-text text-blue-700 font-bold text-lg whitespace-pre-wrap" />
                      {getCleanUrl(q.answer_image_url) && <img src={getCleanUrl(q.answer_image_url)} className="max-w-xs mt-2 rounded border border-slate-200" alt="A" />}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0"><button onClick={() => setModalQ(null)} className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg shadow-sm">닫기</button></div>
          </div>
        </div>
      )}
    </div>
  );
}