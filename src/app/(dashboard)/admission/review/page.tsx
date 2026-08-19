// src/app/(dashboard)/admission/review/page.tsx
"use client";

import React, { useEffect, useState, useRef, Suspense, memo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface GradeButtonProps {
  code: string;
  ansId: string;
  currentCode: string;
  qId: string;
  tqId: number;
  title: string;
  onClick: (ansId: string, code: string, qId: string, tqId: number) => void;
}

const GradeButton = memo(({ code, ansId, currentCode, qId, tqId, title, onClick }: GradeButtonProps) => {
  let bgClass = "bg-[#f8fafc] text-[#94a3b8] hover:bg-[#e2e8f0] hover:text-[#64748b] border border-slate-200";
  let checkedClass = "transform scale-105 text-white shadow-md border-transparent";
  
  if (['O', 'TO'].includes(code)) checkedClass += " bg-[#10b981]";
  else if (['X', 'TX'].includes(code)) checkedClass += " bg-[#ef4444]";
  else if (code === '☆') checkedClass += " bg-[#f59e0b]";
  else if (code === 'B') checkedClass += " bg-[#64748b]";
  else checkedClass += " bg-[#0ea5e9]";

  const isChecked = currentCode === code;

  return (
    <button 
      onClick={() => onClick(ansId, code, qId, tqId)} 
      title={title}
      className={`flex justify-center items-center rounded-md text-[12px] font-extrabold h-8 transition-all ${isChecked ? checkedClass : bgClass}`}
    >
      {code}
    </button>
  );
});
GradeButton.displayName = "GradeButton";


function ReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const assignmentId = searchParams.get("assignment_id") || searchParams.get("id");
  const homeworkId = searchParams.get("homework_id");
  const studentIdParam = searchParams.get("student_id");

  const isHomeworkMode = !!homeworkId;

  const [headerInfo, setHeaderInfo] = useState({ title: "📝 상세 채점표", subtitle: "데이터 불러오는 중...", type: "" });
  const [resultData, setResultData] = useState<any[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<{ [key: string]: any }>({});
  const [gradingCodeMeta, setGradingCodeMeta] = useState<any>({});
  const [wrongLogByAnswerId, setWrongLogByAnswerId] = useState<{ [key: string]: any[] }>({});
  
  const [isSaving, setIsSaving] = useState(false);
  const [showReportBtn, setShowReportBtn] = useState(false);
  const [totalScore, setTotalScore] = useState<number | "-">(0);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isDeletingReport, setIsDeletingReport] = useState(false);
  
  // 🌟 [추가] 리포트 권한 상태 관리
  const [hasReportAuth, setHasReportAuth] = useState(false);

  const [modalQ, setModalQ] = useState<any>(null);
  const [modalWrongLog, setModalWrongLog] = useState<any[] | null>(null);

  const [contextIds, setContextIds] = useState({ studentId: "", examPaperId: "", standardName: "" });

  const mathJaxRef = useRef(false);

  // 🌟 [추가] 사용자의 리포트 관리 권한 확인
  useEffect(() => {
    const checkReportAuth = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      if (role === 'SUPER_ADMIN') {
        setHasReportAuth(true);
        return;
      }

      if (role && tId) {
        const { data } = await supabase
          .from('tenant_role_permissions')
          .select('allowed_menus')
          .eq('tenant_id', tId)
          .eq('role_name', role)
          .single();
          
        // 권한 배열에 우리가 추가한 action_manage_admission_report가 있는지 확인
        if (data && data.allowed_menus.includes("action_manage_admission_report")) {
          setHasReportAuth(true);
        }
      }
    };
    checkReportAuth();
  }, []);

  useEffect(() => {
    loadMathJax();
    if (isHomeworkMode) {
      loadHomeworkResults();
    } else if (assignmentId) {
      loadExamResults();
    } else {
      alert("잘못된 접근입니다.");
      router.back();
    }
  }, [assignmentId, homeworkId, studentIdParam]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== "undefined" && (window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch(() => {});
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [resultData, modalQ, modalWrongLog]); 

  useEffect(() => {
    if (isHomeworkMode) {
      setTotalScore("-");
      return;
    }
    let tempTotal = 0;
    resultData.forEach((g: any) => {
      g.items.forEach((row: any) => {
        const ansId = row.answer.answer_id;
        let currentScore = row.answer.earned_score || 0;
        if (pendingUpdates[ansId] !== undefined) currentScore = pendingUpdates[ansId].earned_score;
        tempTotal += currentScore;
      });
    });
    setTotalScore(parseFloat(tempTotal.toFixed(1)));
  }, [resultData, pendingUpdates, isHomeworkMode]);

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

  const parseWrongLog = (raw: any) => {
    if (!raw) return [];
    let log = raw;
    if (typeof log === 'string') { try { log = JSON.parse(log); } catch (e) { return []; } }
    return Array.isArray(log) ? log : [];
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

  const calcScoreRatio = (code: string, assignedScore: number, metaMap: any, isAdmission: boolean = false) => {
    let meta = metaMap[code]; let ratio = 0; let isCorrectEq = false;
    
    if (meta) {
      const targetRatio = (isAdmission && meta.admission_ratio !== undefined && meta.admission_ratio !== null) 
                          ? meta.admission_ratio 
                          : meta.score_ratio;
                          
      ratio = parseFloat(targetRatio) || 0; 
      if (ratio > 1) ratio = ratio / 100;
      
      if (isAdmission) {
        isCorrectEq = ratio > 0;
      } else {
        isCorrectEq = meta.is_correct === true || String(meta.is_correct).toLowerCase() === 'true';
      }
    } else {
      if (['O', 'a', 'b', 'c'].includes(code)) { ratio = 1.0; isCorrectEq = true; }
      else if (code === 'TO') { ratio = 0.8; isCorrectEq = true; }
      else if (code === 'q') { ratio = 0.5; isCorrectEq = false; }
      else { ratio = 0.0; isCorrectEq = false; }

      if (isAdmission) {
        ratio = ['O', 'a', 'b', 'c', 'TO'].includes(code) ? 1.0 : 0.0;
        isCorrectEq = ratio > 0;
      }
    }
    return { newEarned: assignedScore * ratio, isCorrectEq };
  };

  const loadHomeworkResults = async () => {
    try {
      const { data: gcData } = await supabase.from('master_grading_code').select('code, description, is_correct, score_ratio, admission_ratio');
      const meta: any = {};
      gcData?.forEach(row => { if (row.code) meta[row.code] = row; });
      setGradingCodeMeta(meta);

      const { data: hwData, error: hwErr } = await supabase.from('homework_assignment')
        .select('*, textbook(title), student_homework_result(*)').eq('homework_id', homeworkId).single();
      if (hwErr) throw hwErr;

      let hwResult = null;
      if (studentIdParam) hwResult = (hwData.student_homework_result || []).find((r: any) => String(r.student_id) === String(studentIdParam)) || null;
      if (!hwResult) hwResult = hwData.student_homework_result?.[0] || null;
      if (!hwResult) throw new Error("학생 결과 데이터가 없습니다.");

      const sId = hwResult.student_id;
      setContextIds(prev => ({ ...prev, studentId: sId }));

      const title = hwData.homework_title || '교재 과제';
      const { data: stData } = await supabase.from('student').select('name').eq('student_id', sId).single();
      const studentName = Array.isArray(stData) ? stData[0]?.name : stData?.name || '학생';

      setHeaderInfo({ title: `📝 ${title} 채점표`, subtitle: `대상: ${studentName} 학생 | 교재명: ${hwData.textbook?.title || '교재'}`, type: '과제' });
      setShowReportBtn(false);

      let tqIds: number[] = [];
      if (hwData.target_questions) {
        try { tqIds = (typeof hwData.target_questions === 'string' ? JSON.parse(hwData.target_questions) : hwData.target_questions).map(Number); } catch(e){}
      }
      if (tqIds.length === 0) throw new Error("과제 문항이 없습니다.");

      const baseScore = 100 / tqIds.length;
      
      const chunkSize = 150;
      let tqData: any[] = [];
      for (let i = 0; i < tqIds.length; i += chunkSize) {
        const chunk = tqIds.slice(i, i + chunkSize);
        const { data, error } = await supabase.from('textbook_question').select('*, question_db(*)').in('tq_id', chunk);
        if (error) throw error;
        if (data) tqData = [...tqData, ...data];
      }

      const { data: existingAnswers, error: ansErr } = await supabase.from('student_homework_answer').select('*').eq('homework_id', homeworkId).eq('student_id', sId);
      if (ansErr) throw ansErr;
      let answers = existingAnswers || [];

      const dedupMap = new Map();
      answers.forEach((a: any) => {
        const key = String(a.tq_id);
        const existing = dedupMap.get(key);
        if (!existing) {
          dedupMap.set(key, a);
        } else {
          if (!existing.grading_code && a.grading_code) dedupMap.set(key, a);
          else if (Number(a.earned_score || 0) > Number(existing.earned_score || 0)) dedupMap.set(key, a);
        }
      });
      answers = Array.from(dedupMap.values());

      const groupMap = new Map(); const groups: any[] = [];
      tqData.sort((a: any, b: any) => tqIds.indexOf(a.tq_id) - tqIds.indexOf(b.tq_id)); 

      const initialPending: any = {};
      const newWrongLogMap: any = {};

      tqData.forEach((tq: any, idx: number) => {
        const q = tq.question_db || {};
        q.question = tq.question || q.question; q.answer = tq.answer || q.answer; q.image_url = q.image_url || null;
        const ans = answers.find((a: any) => String(a.tq_id) === String(tq.tq_id)) || {};
        if (ans.hw_answer_id) ans.answer_id = ans.hw_answer_id;
        if (!ans.answer_id) ans.answer_id = 'temp_hw_' + tq.tq_id;

        const wLog = parseWrongLog(ans.wrong_attempts_log);
        if (wLog.length > 0) newWrongLogMap[ans.answer_id] = wLog;

        const qNum = String(tq.question_number || tq.tq_id);
        const gId = tq.parent_tq_id ? `group_parent_${tq.parent_tq_id}` : `group_q_${qNum}`;

        if (!groupMap.has(gId)) { const newG = { id: gId, sort_order: idx, items: [] }; groupMap.set(gId, newG); groups.push(newG); }
        groupMap.get(gId).items.push({ sort_order: idx, assigned_score: baseScore, question: q, answer: ans, question_id: q.question_id, tq_id: tq.tq_id });
      });

      groups.forEach((g: any) => {
        g.sort_order = Math.min(...g.items.map((i: any) => i.sort_order));
        const subScore = baseScore / g.items.length;
        
        g.items.forEach((i: any) => {
          i.assigned_score = subScore;
          if (i.answer?.grading_code) {
            const dbEarnedScore = parseFloat(i.answer.earned_score) || 0;
            const dbIsCorrect = i.answer.is_correct === true || String(i.answer.is_correct).toLowerCase() === 'true';
            
            const { newEarned, isCorrectEq } = calcScoreRatio(i.answer.grading_code, subScore, meta, false);
            i.answer.earned_score = newEarned;
            
            if (Math.abs(dbEarnedScore - newEarned) > 0.01 || dbIsCorrect !== isCorrectEq) {
              initialPending[i.answer.answer_id] = { grading_code: i.answer.grading_code, is_correct: isCorrectEq, earned_score: newEarned, question_id: i.question_id, tq_id: i.tq_id };
            }
          }
        });
      });
      groups.sort((a, b) => a.sort_order - b.sort_order);

      setWrongLogByAnswerId(newWrongLogMap);
      setResultData(groups);
      setPendingUpdates(initialPending);
    } catch (e: any) { alert(`과제 데이터 로드 실패: ${e.message}`); }
  };

  const loadExamResults = async () => {
    try {
      const { data: gcData } = await supabase.from('master_grading_code').select('code, description, is_correct, score_ratio, admission_ratio');
      const meta: any = {}; gcData?.forEach(row => { if (row.code) meta[row.code] = row; });
      setGradingCodeMeta(meta);

      const { data: aData, error: aErr } = await supabase.from('exam_assignment').select('*, exam_master(title, sub_title, exam_type), student(name)').eq('assignment_id', assignmentId).single();
      if (aErr) throw aErr;

      const epId = aData.exam_id || aData.exam_paper_id;
      if (!epId) throw new Error("시험지 ID를 찾을 수 없습니다.");
      
      const sId = aData.student_id;
      const exType = aData.exam_master?.exam_type || '';
      const exTitle = aData.exam_master?.title || '문제지';
      const matchTag = (aData.exam_master?.sub_title || '').match(/\d+-\d+/) || exTitle.match(/\d+-\d+/);
      const stdName = matchTag ? matchTag[0] : '';
      
      setContextIds({ studentId: sId, examPaperId: epId, standardName: stdName });

      const studentName = Array.isArray(aData.student) ? aData.student[0]?.name : aData.student?.name;
      setHeaderInfo({ title: `📝 ${exTitle} 채점표`, subtitle: `대상: ${studentName} 학생 | 유형: ${exType} [평가기준: ${stdName || '미지정'}]`, type: exType });

      if (exType === '입학테스트') {
        const { data: repCheck } = await supabase.from('admission_test_report').select('report_id').eq('assignment_id', parseInt(assignmentId as string)).maybeSingle();
        setShowReportBtn(!!repCheck); 
      }

      const { data: items, error: iErr } = await supabase.from('exam_item').select('*').eq('exam_id', epId).order('sort_order');
      if (iErr) throw iErr;

      const qIds = items.map(i => i.question_id);
      const uuidIds = qIds.filter(id => typeof id === 'string' && id.includes('-'));
      const numIds = qIds.filter(id => typeof id === 'number' || (typeof id === 'string' && !id.includes('-') && !isNaN(Number(id)))).map(Number);

      let fetchedQuestions: any[] = [];
      const chunkSize = 150;
      
      for (let i = 0; i < uuidIds.length; i += chunkSize) {
        const chunk = uuidIds.slice(i, i + chunkSize);
        const { data } = await supabase.from('question_db').select('*').in('question_id', chunk);
        if(data) fetchedQuestions.push(...data);
      }
      
      const foundUuids = fetchedQuestions.map(q => q.question_id);
      const missingUuids = uuidIds.filter(id => !foundUuids.includes(id));
      
      if (missingUuids.length > 0) { 
        for (let i = 0; i < missingUuids.length; i += chunkSize) {
          const chunk = missingUuids.slice(i, i + chunkSize);
          const { data } = await supabase.from('textbook_question').select('*').in('question_id', chunk); 
          if(data) fetchedQuestions.push(...data); 
        }
      }
      
      if (numIds.length > 0) { 
        for (let i = 0; i < numIds.length; i += chunkSize) {
          const chunk = numIds.slice(i, i + chunkSize);
          const { data } = await supabase.from('textbook_question').select('*').in('tq_id', chunk); 
          if(data) fetchedQuestions.push(...data); 
        }
      }

      const qMap: any = {};
      fetchedQuestions.forEach(q => { if (q.question_id) qMap[String(q.question_id)] = q; if (q.tq_id) qMap[String(q.tq_id)] = q; });

      let { data: existingAnswers } = await supabase.from('student_answer').select('*').eq('exam_assignment_id', assignmentId).eq('student_id', sId);
      let answers = existingAnswers || [];

      const dedupMap = new Map();
      answers.forEach((a: any) => {
        const key = String(a.question_id);
        const existing = dedupMap.get(key);
        if (!existing) {
          dedupMap.set(key, a);
        } else {
          if (!existing.grading_code && a.grading_code) dedupMap.set(key, a);
          else if (Number(a.earned_score || 0) > Number(existing.earned_score || 0)) dedupMap.set(key, a);
        }
      });
      answers = Array.from(dedupMap.values());

      const groupMap = new Map(); const groups: any[] = [];
      const newWrongLogMap: any = {};
      const initialPending: any = {};

      items.forEach(item => {
        const q = qMap[String(item.question_id)] || {};
        const ans = answers.find((a:any) => String(a.question_id) === String(item.question_id)) || {};
        if (!ans.answer_id) ans.answer_id = 'temp_ex_' + item.question_id;

        const wLog = parseWrongLog(ans.wrong_attempts_log);
        if (wLog.length > 0) newWrongLogMap[ans.answer_id] = wLog;

        const baseNum = String(q.question_number || '').match(/\d+/) ? String(q.question_number).match(/\d+/)?.[0] : q.question_id;
        let gId = `group_q_${baseNum}`;
        const parentId = q.parent_question_id || q.parent_tq_id;
        if (parentId && String(parentId) !== 'null' && String(parentId).trim() !== '') gId = `group_parent_${parentId}`;

        if (!groupMap.has(gId)) { const newG = { id: gId, sort_order: item.sort_order, items: [] }; groupMap.set(gId, newG); groups.push(newG); }
        groupMap.get(gId).items.push({ sort_order: item.sort_order, assigned_score: item.assigned_score, question: q, answer: ans, question_id: item.question_id, tq_id: q.tq_id });
      });

      const baseScorePerQuestion = 100 / groups.length;
      let metaScores: any = {};
      if (exType === '입학테스트' && stdName) {
        const { data: mData } = await supabase.from('admission_standard_meta').select('question_number, assigned_score').eq('standard_name', stdName);
        mData?.forEach(m => { if (m.question_number) metaScores[m.question_number] = m.assigned_score; });
      }

      groups.forEach((g: any, index: number) => {
        g.sort_order = Math.min(...g.items.map((i:any) => i.sort_order));
        g.items.sort((a:any, b:any) => {
          const subA = a.question.sub_num || 0; const subB = b.question.sub_num || 0;
          if (a.question.question_id === a.question.parent_question_id || subA === 0) return -1;
          if (b.question.question_id === b.question.parent_question_id || subB === 0) return 1;
          return subA - subB;
        });

        const qNumStr = String(g.items[0]?.question?.question_number || '');
        const match = qNumStr.match(/\d+/);
        const logicalQNum = match ? parseInt(match[0], 10) : (index + 1);
        
        let maxScore = metaScores[logicalQNum] !== undefined 
          ? parseFloat(metaScores[logicalQNum]) 
          : Math.max(...g.items.map((i:any) => parseFloat(i.assigned_score) || 0));

        if (!maxScore || isNaN(maxScore) || maxScore === 0) {
          maxScore = baseScorePerQuestion;
        }
        const subScore = maxScore / g.items.length;

        g.items.forEach((i: any) => {
          i.assigned_score = subScore;
          if (i.answer?.grading_code) {
            const dbEarnedScore = parseFloat(i.answer.earned_score) || 0;
            const dbIsCorrect = i.answer.is_correct === true || String(i.answer.is_correct).toLowerCase() === 'true';
            
            const isAdm = exType === '입학테스트';
            const { newEarned, isCorrectEq } = calcScoreRatio(i.answer.grading_code, subScore, meta, isAdm);
            i.answer.earned_score = newEarned; 

            if (Math.abs(dbEarnedScore - newEarned) > 0.01 || dbIsCorrect !== isCorrectEq) {
              initialPending[i.answer.answer_id] = { grading_code: i.answer.grading_code, is_correct: isCorrectEq, earned_score: newEarned, question_id: i.question_id, tq_id: i.tq_id };
            }
          }
        });
      });
      groups.sort((a, b) => a.sort_order - b.sort_order);

      setWrongLogByAnswerId(newWrongLogMap);
      setResultData(groups);
      setPendingUpdates(initialPending);

    } catch (error: any) { alert(`시험 데이터 로드 실패: ${error.message}`); }
  };

  const handleGradeClick = React.useCallback((ansId: string, code: string, qId: string, tqId: number) => {
    updateGradingCodeLocally(ansId, code, qId, tqId);
  }, [resultData, gradingCodeMeta, headerInfo.type]);

  const updateGradingCodeLocally = (answerId: string, code: string, questionId: string, tqId: number) => {
    let foundRow = null;
    for (const g of resultData) {
      const f = g.items.find((r:any) => String(r.answer.answer_id) === String(answerId));
      if (f) { foundRow = f; break; }
    }
    if (!foundRow) return;

    const isAdm = headerInfo.type === '입학테스트';
    const { newEarned, isCorrectEq } = calcScoreRatio(code, foundRow.assigned_score, gradingCodeMeta, isAdm);
    
    setPendingUpdates(prev => ({
      ...prev,
      [answerId]: { grading_code: code, is_correct: isCorrectEq, earned_score: newEarned, question_id: questionId, tq_id: tqId }
    }));
  };

  const markAll = (targetCode: string) => {
    if (!confirm(`모든 문항을 일괄적으로 '${targetCode}' 처리하시겠습니까?`)) return;
    const newPending = { ...pendingUpdates };
    const isAdm = headerInfo.type === '입학테스트';

    resultData.forEach((g: any) => {
      g.items.forEach((row: any) => {
        const ansId = row.answer.answer_id;
        const { newEarned, isCorrectEq } = calcScoreRatio(targetCode, row.assigned_score, gradingCodeMeta, isAdm);
        newPending[ansId] = { grading_code: targetCode, is_correct: isCorrectEq, earned_score: newEarned, question_id: row.question_id, tq_id: row.tq_id };
      });
    });
    setPendingUpdates(newPending);
  };

  const saveOnlyGrades = async () => {
    const updateKeys = Object.keys(pendingUpdates);
    if (updateKeys.length === 0) return alert("채점된 내용이 없습니다.");
    if (!confirm(`채점 결과를 저장하고, 틀린 문제를 오답노트로 연동하시겠습니까?`)) return;

    setIsSaving(true);
    try {
      if (isHomeworkMode) {
        const ansInserts: any[] = [];
        const ansUpdates: any[] = [];
        
        for (const ansId of updateKeys) {
          const data = pendingUpdates[ansId];
          const payload = { 
            grading_code: data.grading_code, 
            is_correct: data.is_correct || false, 
            earned_score: Number(data.earned_score) || 0 
          };
          if (ansId.startsWith('temp_')) {
            ansInserts.push({ ...payload, homework_id: parseInt(homeworkId as string), student_id: contextIds.studentId, tq_id: data.tq_id });
          } else {
            ansUpdates.push({ hw_answer_id: ansId, ...payload });
          }
        }

        if (ansInserts.length > 0) {
          const { error: insErr } = await supabase.from('student_homework_answer').insert(ansInserts);
          if (insErr) throw new Error("새 과제 답안 등록 실패: " + insErr.message);
        }
        
        if (ansUpdates.length > 0) {
          const updatePromises = ansUpdates.map(u => 
            supabase.from('student_homework_answer').update({
              grading_code: u.grading_code, is_correct: u.is_correct, earned_score: u.earned_score
            }).eq('hw_answer_id', u.hw_answer_id)
          );
          const results = await Promise.all(updatePromises);
          const errs = results.filter(r => r.error);
          if (errs.length > 0) throw new Error("과제 답안 수정 실패: " + errs[0].error?.message); 
        }
        
        await supabase.from('student_homework_result').update({ status: '채점완료' }).eq('homework_id', parseInt(homeworkId as string)).eq('student_id', contextIds.studentId);

        const { data: exInc } = await supabase.from('student_incorrect_record').select('record_id, tq_id').eq('student_id', contextIds.studentId);
        const incInserts: any[] = [];
        const incUpdates: any[] = [];

        updateKeys.forEach(ansId => {
          const data = pendingUpdates[ansId];
          const code = data.grading_code;
          const hadWrong = parseWrongLog(wrongLogByAnswerId[ansId]).length > 0;
          const isFullyCorrect = ['O', 'a', 'b', 'c'].includes(code) && !hadWrong;
          
          if (data.tq_id) {
            const match = exInc?.find(e => String(e.tq_id) === String(data.tq_id));
            const p = { student_id: contextIds.studentId, tq_id: data.tq_id, question_id: data.question_id || null, source_type: '교재과제', status: code, resolved_at: isFullyCorrect ? new Date().toISOString() : null };
            if (match) incUpdates.push({ record_id: match.record_id, ...p });
            else incInserts.push(p);
          }
        });

        if (incInserts.length > 0) {
          const { error: incErr } = await supabase.from('student_incorrect_record').insert(incInserts);
          if (incErr) throw new Error("오답노트 새로 등록 실패: " + incErr.message);
        }
        if (incUpdates.length > 0) {
          const upPromises = incUpdates.map(u => 
            supabase.from('student_incorrect_record').update({ status: u.status, resolved_at: u.resolved_at }).eq('record_id', u.record_id)
          );
          const results = await Promise.all(upPromises);
          const errs = results.filter(r => r.error);
          if (errs.length > 0) throw new Error("기존 오답노트 수정 실패: " + errs[0].error?.message); 
        }
        
        await loadHomeworkResults();
        alert("🎉 [과제] 채점 내역 저장 및 오답노트 연동이 완료되었습니다!");

      } else {
        const ansInserts: any[] = [];
        const ansUpdates: any[] = [];

        for (const ansId of updateKeys) {
          const data = pendingUpdates[ansId];
          const payload = { 
            grading_code: data.grading_code, 
            is_correct: data.is_correct || false, 
            earned_score: Number(data.earned_score) || 0 
          };
          if (ansId.startsWith('temp_')) {
            ansInserts.push({ ...payload, exam_assignment_id: parseInt(assignmentId as string), student_id: contextIds.studentId, question_id: data.question_id });
          } else {
            ansUpdates.push({ answer_id: ansId, ...payload });
          }
        }

        if (ansInserts.length > 0) {
          const { error: insErr } = await supabase.from('student_answer').insert(ansInserts);
          if (insErr) throw new Error("새 시험 답안 등록 실패: " + insErr.message);
        }

        if (ansUpdates.length > 0) {
          const updatePromises = ansUpdates.map(u => 
            supabase.from('student_answer').update({
              grading_code: u.grading_code, is_correct: u.is_correct, earned_score: u.earned_score
            }).eq('answer_id', u.answer_id)
          );
          const results = await Promise.all(updatePromises);
          const errs = results.filter(r => r.error);
          if (errs.length > 0) throw new Error("시험 답안 갱신 실패: " + errs[0].error?.message);
        }

        const { data: upAns, error: fetchErr } = await supabase.from('student_answer').select('question_id, earned_score').eq('exam_assignment_id', parseInt(assignmentId as string));
        if (fetchErr) throw new Error("총점 재계산용 데이터 조회 실패: " + fetchErr.message);

        const dedupScoreMap = new Map();
        upAns?.forEach((a:any) => {
          const key = String(a.question_id);
          const existing = dedupScoreMap.get(key);
          if (!existing || Number(a.earned_score || 0) > Number(existing.earned_score || 0)) {
            dedupScoreMap.set(key, a);
          }
        });

        let tempT = 0; dedupScoreMap.forEach((a:any) => tempT += (Number(a.earned_score) || 0));
        const finalScore = parseFloat(tempT.toFixed(1));

        let { error: uErr } = await supabase.from('exam_assignment').update({ total_score: finalScore, status: '채점완료' }).eq('assignment_id', parseInt(assignmentId as string));
        if (uErr) throw new Error("시험지 총점 업데이트 실패: " + uErr.message);

        const { data: exInc } = await supabase.from('student_incorrect_record').select('record_id, question_id').eq('student_id', contextIds.studentId);
        const incInserts: any[] = [];
        const incUpdates: any[] = [];

        updateKeys.forEach(ansId => {
          const data = pendingUpdates[ansId];
          const code = data.grading_code;
          const isFullyCorrect = ['O', 'a', 'b', 'c'].includes(code);
          
          if (data.question_id) {
            const match = exInc?.find(e => String(e.question_id) === String(data.question_id));
            const p = { student_id: contextIds.studentId, question_id: data.question_id, source_type: '시험지', status: code, resolved_at: isFullyCorrect ? new Date().toISOString() : null };
            if (match) incUpdates.push({ record_id: match.record_id, ...p });
            else incInserts.push(p);
          }
        });

        if (incInserts.length > 0) {
          let { error: incErr } = await supabase.from('student_incorrect_record').insert(incInserts);
          if (incErr) throw new Error("시험 오답노트 새로 등록 실패: " + incErr.message);
        }
        if (incUpdates.length > 0) {
          const upPromises = incUpdates.map(u => 
            supabase.from('student_incorrect_record').update({ status: u.status, resolved_at: u.resolved_at }).eq('record_id', u.record_id)
          );
          const results = await Promise.all(upPromises);
          const errs = results.filter(r => r.error);
          if (errs.length > 0) throw new Error("기존 시험 오답노트 수정 실패: " + errs[0].error?.message);
        }

        await loadExamResults();
        alert(`🎉 [시험] 채점 내역 저장 및 오답노트 연동이 완료되었습니다! (총점: ${finalScore}점)`);
        
        if (headerInfo.type === '입학테스트') {
          const { data: repCheck } = await supabase.from('admission_test_report').select('report_id').eq('assignment_id', parseInt(assignmentId as string)).maybeSingle();
          setShowReportBtn(!!repCheck);
        }
      }
      setPendingUpdates({});
    } catch (err: any) { 
      console.error("저장 중 상세 오류 내역:", err);
      alert(`❌ 오류 발생:\n${err.message || '데이터베이스 저장 중 문제가 발생했습니다.'}`); 
    } finally { 
      setIsSaving(false); 
    }
  };

  const triggerReportGeneration = async () => {
    if (Object.keys(pendingUpdates).length > 0) return alert("⚠️ 저장되지 않은 채점이 있습니다. 채점 내역을 먼저 저장하세요.");
    setIsGeneratingReport(true);
    try {
      const { data: upAns } = await supabase.from('student_answer').select('question_id, earned_score').eq('exam_assignment_id', parseInt(assignmentId as string));
      const dedupScoreMap = new Map();
      upAns?.forEach((a:any) => {
        const key = String(a.question_id);
        const existing = dedupScoreMap.get(key);
        if (!existing || Number(a.earned_score || 0) > Number(existing.earned_score || 0)) {
          dedupScoreMap.set(key, a);
        }
      });
      let tempT = 0; dedupScoreMap.forEach((a:any) => tempT += (Number(a.earned_score) || 0));
      const finalScore = parseFloat(tempT.toFixed(1));

      const { data: metaData } = await supabase.from('admission_standard_meta').select('*').eq('standard_name', contextIds.standardName);
      if (!metaData || metaData.length === 0) throw new Error(`[${contextIds.standardName}] 기준표가 없습니다.`);

      let sGeo=0, sMea=0, sStat=0, sRule=0, sCalc=0;
      let sCalcSense=0, sSpatial=0, sLogic=0;
      let sThink=0, sPersist=0, sKnow=0;
      let maxThink=0, maxPersist=0, maxKnow=0;
      let sD1=0, sD2=0, sD3=0, sD4=0, sD5=0;

      resultData.forEach((g, idx) => {
        const qNumStr = String(g.items[0]?.question?.question_number || '');
        const match = qNumStr.match(/\d+/);
        const lNum = match ? parseInt(match[0], 10) : (idx + 1);

        g.items.forEach((row: any) => {
          let meta = metaData.find(m => m.question_number === lNum);
          
          if (!meta) {
            meta = { difficulty_level: 3, math_category: '수와 연산' } as any;
          }
          
          const dbAns = upAns?.find((a:any) => String(a.question_id) === String(row.question_id));
          const earned = dbAns ? (parseFloat(dbAns.earned_score) || 0) : 0;
          
          const assigned = parseFloat(row.assigned_score) || 0;
          const diff = meta.difficulty_level || 3;
          
          if (diff===1) sD1+=earned; else if(diff===2) sD2+=earned; else if(diff===3) sD3+=earned; else if(diff===4) sD4+=earned; else if(diff===5) sD5+=earned;
          const cat = meta.math_category;
          if (cat==='도형') sGeo+=earned; else if(cat==='측정') sMea+=earned; else if(cat==='확률과 통계') sStat+=earned; else if(cat==='규칙과 논리' || cat==='규칙성') sRule+=earned; else if(cat==='수와 연산') sCalc+=earned;
          
          if(meta.is_calc_sense) sCalcSense+=earned; if(meta.is_spatial_perception) sSpatial+=earned; if(meta.is_logical_reasoning) sLogic+=earned;
          if(meta.is_thinking_ability) { sThink+=earned; maxThink+=assigned; }
          if(meta.is_task_persistence) { sPersist+=earned; maxPersist+=assigned; }
          if(meta.is_background_knowledge) { sKnow+=earned; maxKnow+=assigned; }
        });
      });

      const getLv = (e: number, m: number) => { if (m===0) return '중'; const p = (e/m)*100; if(p>=70) return '상'; if(p>=40) return '중'; return '하'; };
      const lvThink = getLv(sThink, maxThink); const lvPersist = getLv(sPersist, maxPersist); const lvKnow = getLv(sKnow, maxKnow);

      const { data: cmtData } = await supabase.from('admission_eval_comment').select('comment_text').eq('thinking_level', lvThink).eq('persistence_level', lvPersist).eq('knowledge_level', lvKnow).maybeSingle();

      const payload: any = {
        assignment_id: parseInt(assignmentId as string), 
        student_id: contextIds.studentId, 
        exam_id: contextIds.examPaperId,
        total_score: finalScore,
        score_geometry: sGeo, score_measure: sMea, score_stat: sStat, score_rule: sRule, score_calc: sCalc,
        score_calc_sense: sCalcSense, score_spatial_percep: sSpatial, score_logical_reason: sLogic,
        score_thinking: sThink, score_persistence: sPersist, score_knowledge: sKnow,
        score_diff_1: sD1, score_diff_2: sD2, score_diff_3: sD3, score_diff_4: sD4, score_diff_5: sD5,
        level_thinking: lvThink, level_persistence: lvPersist, level_knowledge: lvKnow,
        final_comment: cmtData ? cmtData.comment_text : '분석 코멘트 없음'
      };

      const assignIdNum = parseInt(assignmentId as string);
      const { data: existingReport } = await supabase.from('admission_test_report').select('report_id').eq('assignment_id', assignIdNum).maybeSingle();

      if (existingReport) {
        const { error: repErr } = await supabase.from('admission_test_report').update(payload).eq('report_id', existingReport.report_id);
        if (repErr) throw new Error(repErr.message);
      } else {
        const { error: repErr } = await supabase.from('admission_test_report').insert([payload]);
        if (repErr) throw new Error(repErr.message);
      }

      alert("✅ 진단 리포트 재생성 완료! 이제 새 데이터가 반영됩니다.");
      
      setShowReportBtn(true);
      
    } catch(e: any) { 
      console.error("리포트 생성 상세 오류 내역:", e);
      alert("❌ 리포트 생성 오류:\n" + e.message); 
    } finally { 
      setIsGeneratingReport(false); 
    }
  };

  const handleDeleteReport = async () => {
    if (!confirm("⚠️ 정말 이 진단 리포트를 삭제하시겠습니까?\n(채점 내역은 그대로 유지되며, 분석 리포트 데이터만 완전히 삭제됩니다.)")) return;
    
    setIsDeletingReport(true);
    try {
      const { error } = await supabase.from('admission_test_report')
        .delete()
        .eq('assignment_id', parseInt(assignmentId as string));
        
      if (error) throw new Error(error.message);
      
      setShowReportBtn(false); 
      alert("🗑️ 진단 리포트가 완전히 파기되었습니다. 새롭게 채점 후 다시 생성해주세요.");
    } catch (e: any) {
      console.error("리포트 삭제 상세 오류 내역:", e);
      alert("❌ 리포트 삭제 오류:\n" + e.message);
    } finally {
      setIsDeletingReport(false);
    }
  };

  const getSubCodeTitle = (cd: string) => {
    switch (cd) {
      case 'a': return 'a (단순 계산 실수)';
      case 'b': return 'b (문제를 잘못 읽음)';
      case 'c': return 'c (개념 적용 오류)';
      case 'x': return 'x (과정이 없는 오답)';
      case 'y': return 'y (풀이 과정 누락)';
      case 'z': return 'z (산발적 풀이 또는 악필)';
      case 'p': return 'p (과정이 보이는 오답)';
      case 'q': return 'q (과정 절반 맞음)';
      default: return '세부 채점 옵션';
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f1f5f9] w-full">
      <main className="flex-1 overflow-y-auto custom-scroll p-4 sm:p-8 relative">
        <div className="max-w-[1500px] w-full mx-auto relative pb-24">
          
          <div className="bg-[#002864] text-white p-6 rounded-t-2xl shadow-md flex justify-between items-center no-print">
            <div>
              <button onClick={() => router.back()} className="text-white hover:text-blue-200 flex items-center gap-2 font-extrabold text-lg mb-2 transition-colors bg-blue-900/40 px-4 py-2 rounded-xl border border-blue-800/50 w-fit shadow-sm">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg> 뒤로가기
              </button>
              <h1 className="text-2xl font-bold tracking-tight">{headerInfo.title}</h1>
              <p className="text-blue-200 text-sm mt-1">{headerInfo.subtitle}</p>
            </div>
            <div className="text-right flex items-center gap-4">
              {/* 🌟 [권한적용] 상단 열기 버튼 */}
              {hasReportAuth && showReportBtn && (
                <button onClick={() => {
                  const bustStr = new Date().getTime().toString(36) + Math.random().toString(36).substring(2);
                  window.open(`/print/report?assignment_id=${assignmentId}&_bust=${bustStr}`, '_blank');
                }} className="bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold px-5 py-2.5 rounded-xl shadow-lg flex items-center gap-2 transition-colors">
                  📊 진단 분석 레포트 열기
                </button>
              )}
              <span className="text-lg font-bold bg-blue-900/50 px-4 py-2 rounded-lg border border-blue-800 flex items-center whitespace-nowrap shrink-0">
                현재 실시간 총점: <span className="text-emerald-300 text-3xl font-black ml-3">{totalScore}</span> <span className="ml-1 text-sm text-blue-200 font-normal">점</span>
              </span>
            </div>
          </div>

          <div className="bg-white shadow-md rounded-b-2xl overflow-hidden overflow-x-auto custom-scroll no-print">
            <table className="w-full text-left border-collapse min-w-max">
              <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3 w-12 text-center font-bold text-sm">번호</th>
                  <th className="p-3 w-20 text-center font-bold text-sm">문제보기</th>
                  <th className="p-3 w-[150px] font-bold text-sm">정답 (DB)</th>
                  <th className="p-3 w-[200px] font-bold text-sm">학생 답안</th>
                  <th className="p-3 w-16 text-center font-bold text-sm">배점</th>
                  <th className="p-3 w-16 text-center font-bold text-sm">상태</th>
                  <th className="p-3 font-bold text-left pl-4 min-w-[320px]">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">컴팩트 채점 도구 (14버튼)</span>
                      <div className="flex gap-2">
                        <button onClick={() => markAll('O')} className="px-2.5 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded text-[11px] font-extrabold border border-emerald-300 transition-colors">✅ 전체 O</button>
                        <button onClick={() => markAll('X')} className="px-2.5 py-1 bg-rose-100 text-rose-700 hover:bg-rose-200 rounded text-[11px] font-extrabold border border-rose-300 transition-colors">❌ 전체 X</button>
                      </div>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {resultData.length === 0 ? <tr><td colSpan={7} className="p-12 text-center text-slate-500 font-bold text-lg">데이터 동기화 중입니다...</td></tr> : 
                  resultData.map((g, gIdx) => {
                    const gNum = gIdx + 1;
                    return g.items.map((row: any, subIdx: number) => {
                      const q = row.question; const a = row.answer;
                      const currentCode = pendingUpdates[a.answer_id]?.grading_code || a.grading_code || "";
                      
                      let markHtml = <span className="text-slate-300 font-bold">-</span>;
                      if (currentCode) {
                        if (['O', 'TO'].includes(currentCode)) markHtml = <span className="text-emerald-500 font-extrabold text-xl">{currentCode}</span>;
                        else if (['X', 'TX'].includes(currentCode)) markHtml = <span className="text-red-500 font-extrabold text-xl">{currentCode}</span>;
                        else if (currentCode === '☆') markHtml = <span className="text-amber-500 font-extrabold text-xl">☆</span>;
                        else if (currentCode === 'B') markHtml = <span className="text-slate-500 font-extrabold text-lg block border border-slate-300 rounded bg-white w-6 h-6 mx-auto"></span>;
                        else if (['a','b','c','x','y','z','p','q'].includes(currentCode)) markHtml = <span className="text-sky-500 font-extrabold text-lg">{currentCode}</span>;
                      }

                      const rowBg = ['O', 'TO', 'a', 'b', 'c'].includes(currentCode) ? 'bg-emerald-50/30' : (['X', 'TX', 'x', 'y', 'z', 'p', 'q', '☆', 'B'].includes(currentCode) ? 'bg-red-50/30' : 'bg-white');
                      const qPrefix = g.items.length > 1 ? `<span class="text-blue-600 font-bold mr-1">(${subIdx + 1})</span> ` : '';
                      const qAnswer = formatMathTextForWeb(q.answer || "정보 없음");

                      let sAnswerHTML = <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(a.student_input || "미입력") }} />;
                      if (a.student_input?.startsWith("data:image")) {
                        sAnswerHTML = <img src={a.student_input} className="w-10 h-10 object-contain bg-white border border-slate-300 rounded-md cursor-zoom-in hover:scale-[4.2] hover:z-30 hover:shadow-2xl transition-transform origin-center relative z-10" alt="student_answer" />;
                      }

                      const wrongLog = wrongLogByAnswerId[a.answer_id] || [];

                      return (
                        <tr key={a.answer_id} className={`transition-colors border-b border-slate-200 ${rowBg}`}>
                          {subIdx === 0 && <td className="p-3 text-center font-bold text-sm text-[#002864] border-b border-slate-200 bg-white" rowSpan={g.items.length}>{gNum}</td>}
                          {subIdx === 0 && (
                            <td className="p-3 text-center border-b border-slate-200 bg-white" rowSpan={g.items.length}>
                              <button onClick={() => setModalQ(g)} className="bg-white border border-slate-300 hover:bg-slate-100 hover:border-slate-400 text-slate-600 text-[11px] font-bold py-1.5 px-2 rounded shadow-sm w-full">문제 🔍</button>
                            </td>
                          )}
                          <td className="p-3 font-bold text-emerald-700 bg-white/50 text-[13px] leading-tight break-all whitespace-pre-wrap">
                            <span dangerouslySetInnerHTML={{ __html: qPrefix + qAnswer }} />
                          </td>
                          <td className="p-3 font-bold text-blue-700 bg-white/50 text-[13px] leading-tight break-all whitespace-pre-wrap">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 relative whitespace-pre-wrap">{sAnswerHTML}</div>
                              {wrongLog.length > 0 && (
                                <button onClick={() => setModalWrongLog(wrongLog)} title={`이전 오답 ${wrongLog.length}개 보기`} className="shrink-0 relative w-5 h-5 rounded-full bg-rose-50 hover:bg-rose-500 text-rose-500 hover:text-white flex items-center justify-center text-[10px] leading-none transition-colors border border-rose-200 z-0">
                                  📝
                                  <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[8px] font-black rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">{wrongLog.length}</span>
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-center font-bold text-slate-500 bg-slate-50/50 text-xs">{parseFloat(Number(row.assigned_score).toFixed(1))}점</td>
                          <td className="p-3 text-center">{markHtml}</td>
                          <td className="p-3 text-left pl-4">
                            <div className="flex flex-col gap-1.5 min-w-[240px] max-w-[320px]">
                              <div className="grid grid-cols-6 gap-1.5">
                                <GradeButton code="O" title="정답" currentCode={currentCode} ansId={a.answer_id} qId={row.question_id} tqId={row.tq_id} onClick={handleGradeClick} />
                                <GradeButton code="X" title="오답" currentCode={currentCode} ansId={a.answer_id} qId={row.question_id} tqId={row.tq_id} onClick={handleGradeClick} />
                                <GradeButton code="TX" title="힌트 후 오답" currentCode={currentCode} ansId={a.answer_id} qId={row.question_id} tqId={row.tq_id} onClick={handleGradeClick} />
                                <GradeButton code="TO" title="힌트 후 정답" currentCode={currentCode} ansId={a.answer_id} qId={row.question_id} tqId={row.tq_id} onClick={handleGradeClick} />
                                <GradeButton code="☆" title="별표 (질문)" currentCode={currentCode} ansId={a.answer_id} qId={row.question_id} tqId={row.tq_id} onClick={handleGradeClick} />
                                <GradeButton code="B" title="빈칸 (미응시)" currentCode={currentCode} ansId={a.answer_id} qId={row.question_id} tqId={row.tq_id} onClick={handleGradeClick} />
                                </div>
                                <div className="grid grid-cols-8 gap-1 border-t border-slate-200 pt-1.5 mt-0.5">
                                {['a','b','c','x','y','z','p','q'].map(cd => (
                                    <GradeButton key={cd} code={cd} title={getSubCodeTitle(cd)} currentCode={currentCode} ansId={a.answer_id} qId={row.question_id} tqId={row.tq_id} onClick={handleGradeClick} />
                                ))}
                                </div>
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })
                }
              </tbody>
            </table>

            <div className="mt-8 mb-6 flex justify-center no-print">
              <button 
                onClick={() => router.back()} 
                className="bg-[#002864] hover:bg-blue-900 text-white font-extrabold text-[15px] py-4 px-12 rounded-xl shadow-lg transition-transform hover:-translate-y-1 flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                이전 화면으로 (입학테스트 관리)
              </button>
            </div>

            <div className="bg-slate-50 border-t border-slate-200 p-6 flex justify-end items-center sticky bottom-0 z-10 gap-3 shadow-[0_-10px_20px_rgba(0,0,0,0.03)]">
              <span className={`mr-5 text-sm font-bold ${Object.keys(pendingUpdates).length > 0 ? 'text-orange-500' : 'text-slate-500'}`}>
                저장 대기 중인 변경사항: {Object.keys(pendingUpdates).length}건 {Object.keys(pendingUpdates).length > 0 && '🟡'}
              </span>
              <button onClick={saveOnlyGrades} disabled={isSaving} className="bg-slate-700 hover:bg-slate-800 text-white font-extrabold text-lg py-3.5 px-6 rounded-xl shadow-lg transition-transform hover:-translate-y-0.5 disabled:opacity-50">
                {isSaving ? "저장 중... ⏳" : "1️⃣ 채점 내역 DB 저장 및 오답노트 전송"}
              </button>
              {/* 🌟 [권한적용] 하단 생성/열람/삭제 버튼들 */}
              {hasReportAuth && headerInfo.type === '입학테스트' && (
                <button onClick={triggerReportGeneration} disabled={isGeneratingReport} className="bg-[#e74c3c] hover:bg-red-700 text-white font-extrabold text-lg py-3.5 px-6 rounded-xl shadow-lg transition-transform hover:-translate-y-0.5 disabled:opacity-50">
                  {isGeneratingReport ? "리포트 생성 중... ⏳" : "2️⃣ 진단 리포트 생성하기 🪄"}
                </button>
              )}
              {hasReportAuth && headerInfo.type === '입학테스트' && showReportBtn && (
                <button onClick={() => {
                  const bustStr = new Date().getTime().toString(36) + Math.random().toString(36).substring(2);
                  window.open(`/print/report?assignment_id=${assignmentId}&_bust=${bustStr}`, '_blank');
                }} className="bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-lg py-3.5 px-6 rounded-xl shadow-lg transition-transform hover:-translate-y-0.5">
                  3️⃣ 진단 리포트 열기 📊
                </button>
              )}
              {hasReportAuth && headerInfo.type === '입학테스트' && showReportBtn && (
                <button 
                  onClick={handleDeleteReport} 
                  disabled={isDeletingReport} 
                  className="bg-white hover:bg-rose-50 text-rose-500 font-extrabold text-sm py-3.5 px-4 rounded-xl shadow-sm transition-transform hover:-translate-y-0.5 border border-rose-200 ml-4 disabled:opacity-50"
                >
                  {isDeletingReport ? "삭제 중..." : "🗑️ 리포트 삭제"}
                </button>
              )}
            </div>
          </div>
        </div>

        {modalQ && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print">
            <div className="bg-white w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              <div className="bg-[#002864] p-4 text-white flex justify-between items-center shrink-0">
                <h2 className="font-bold text-lg flex items-center gap-2"><span>🔍</span> 문항 상세 및 해설 뷰어</h2>
                <button onClick={() => setModalQ(null)} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
              </div>
              <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50 space-y-6">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <h3 className="font-extrabold text-slate-800 border-b border-slate-100 pb-2 mb-3">질문 (Question)</h3>
                  {modalQ.items.map((row: any, idx: number) => {
                    const q = row.question; const pre = modalQ.items.length > 1 ? `<b class="text-blue-600">(${idx + 1})</b> ` : '';
                    return (
                      <div key={idx} className="mb-4">
                        <div dangerouslySetInnerHTML={{ __html: pre + formatMathTextForWeb(q.question) }} className="math-text text-slate-700 font-medium whitespace-pre-wrap" />
                        {getCleanUrl(q.image_url) && <img src={getCleanUrl(q.image_url)} className="max-w-full mt-2 rounded-lg border border-slate-200" alt="Q" />}
                      </div>
                    );
                  })}
                </div>
                <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm">
                  <h3 className="font-extrabold text-blue-800 border-b border-blue-200 pb-2 mb-3">정답 (Answer)</h3>
                  {modalQ.items.map((row: any, idx: number) => {
                    const q = row.question; const pre = modalQ.items.length > 1 ? `<b class="text-blue-600">(${idx + 1})</b> ` : '';
                    return (
                      <div key={idx} className="mb-4">
                        <div dangerouslySetInnerHTML={{ __html: pre + formatMathTextForWeb(q.answer) }} className="math-text text-blue-700 font-bold text-lg whitespace-pre-wrap" />
                        {getCleanUrl(q.answer_image_url) && <img src={getCleanUrl(q.answer_image_url)} className="max-w-xs mt-2 rounded border border-slate-200" alt="A" />}
                      </div>
                    );
                  })}
                </div>
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <h3 className="font-extrabold text-slate-800 border-b border-slate-100 pb-2 mb-4">해설 및 풀이 단계</h3>
                  <div className="space-y-5 text-sm text-slate-600">
                    {modalQ.items.map((row: any, idx: number) => {
                      const q = row.question; const pre = modalQ.items.length > 1 ? `(${idx + 1}) ` : '';
                      return (
                        <div key={idx} className="space-y-4">
                          {q.step_1_concept && <div><strong className="text-indigo-600 block mb-1.5 flex items-center gap-1"><span className="bg-indigo-100 text-indigo-600 px-1.5 rounded text-xs">Step 1</span> 핵심 개념</strong><div className="math-text bg-slate-50 p-3 rounded-lg border border-slate-100 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: pre + formatMathTextForWeb(q.step_1_concept) }} /></div>}
                          {q.step_2_approach && <div><strong className="text-emerald-600 block mb-1.5 flex items-center gap-1"><span className="bg-emerald-100 text-emerald-600 px-1.5 rounded text-xs">Step 2</span> 접근 방법</strong><div className="math-text bg-slate-50 p-3 rounded-lg border border-slate-100 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: pre + formatMathTextForWeb(q.step_2_approach) }} /></div>}
                          {q.step_3_process && <div><strong className="text-amber-600 block mb-1.5 flex items-center gap-1"><span className="bg-amber-100 text-amber-600 px-1.5 rounded text-xs">Step 3</span> 풀이 과정</strong><div className="math-text bg-slate-50 p-3 rounded-lg border border-slate-100 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: pre + formatMathTextForWeb(q.step_3_process) }} /></div>}
                          {q.step_4_conclusion && <div><strong className="text-rose-600 block mb-1.5 flex items-center gap-1"><span className="bg-rose-100 text-rose-600 px-1.5 rounded text-xs">Step 4</span> 결론 도출</strong><div className="math-text bg-slate-50 p-3 rounded-lg border border-slate-100 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: pre + formatMathTextForWeb(q.step_4_conclusion) }} /></div>}
                          {q.explanation && <div><strong className="text-slate-600 block mb-1.5">[일반 해설]</strong><div className="math-text bg-slate-50 p-3 rounded-lg border border-slate-100 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: pre + formatMathTextForWeb(q.explanation) }} /></div>}
                          {q.solution && <div><strong className="text-slate-600 block mb-1.5">[일반 풀이]</strong><div className="math-text bg-slate-50 p-3 rounded-lg border border-slate-100 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: pre + formatMathTextForWeb(q.solution) }} /></div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0"><button onClick={() => setModalQ(null)} className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg shadow-sm">닫기</button></div>
            </div>
          </div>
        )}

        {modalWrongLog && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print">
            <div className="bg-white w-full max-w-lg max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              <div className="bg-rose-600 p-4 text-white flex justify-between items-center shrink-0">
                <h2 className="font-bold text-lg flex items-center gap-2"><span>📝</span> 이전 오답 기록</h2>
                <button onClick={() => setModalWrongLog(null)} className="text-white hover:text-rose-200 font-bold text-2xl leading-none">&times;</button>
              </div>
              <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50 space-y-3">
                {modalWrongLog?.map((entry, i) => {
                  const when = entry.at ? new Date(entry.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                  return (
                    <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                      <p className="text-xs font-bold text-slate-400">시도 {i + 1}{when ? ' · ' + when : ''}</p>
                      {entry.input?.startsWith('data:image') ? (
                        <img src={entry.input} className="max-w-full rounded-lg border border-slate-200 shadow-sm mt-2" alt="wrong_answer" />
                      ) : (
                        <p dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(entry.input || '') }} className="math-text text-slate-700 font-bold mt-1 whitespace-pre-wrap" />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0"><button onClick={() => setModalWrongLog(null)} className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg shadow-sm">닫기</button></div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center font-bold text-slate-400">로딩 중...</div>}>
      <ReviewContent />
    </Suspense>
  );
}