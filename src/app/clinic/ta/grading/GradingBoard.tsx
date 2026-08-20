// src/app/clinic/ta/grading/GradingBoard.tsx
//
// 채점 판정 로직(15개 채점 코드, 점수 계산, 저장, 오답노트 연동)은 src/app/(dashboard)/exam/review
// 에서 검증된 그대로 가져왔다. 화면은 그 원본을 그대로 옮긴 게 아니라, clinic/ta 계열 화면들
// (허브/패드/학생·문제지 선택)과 톤을 맞춘 컴팩트한 카드 목록으로 새로 짰다 — 분할 패널 안에
// 여러 명을 동시에 띄워도 좁게 안 느껴지도록.
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

// 💡 객관식 판별 — options 배열이 있으면 당연히 객관식이고, options가 비어 있어도 정답이
// "③"처럼 원문자로 저장돼 있으면 객관식으로 본다(clinic/viewer의 isObjectiveQuestion과 동일 기준).
const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

// question_db/textbook_question의 options 컬럼이 JSON 문자열로 내려오는 경우가 있어 배열로 정규화한다.
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

// 정답/학생 선택이 "③"(원문자)든 "3"(보기 순번)이든 같은 보기 번호(1-based)로 정규화
const toOptionIndex = (val: any): number | null => {
  const b = String(val ?? '').trim().replace(/\$/g, '').trim();
  if (!b) return null;
  const circledIdx = CIRCLED_DIGITS.indexOf(b);
  if (circledIdx !== -1) return circledIdx + 1;
  const n = parseInt(b, 10);
  return Number.isNaN(n) ? null : n;
};

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
  let bgClass = "bg-white text-slate-400 hover:bg-slate-100 border border-slate-200";
  let checkedClass = "text-white border-transparent shadow-sm";

  if (['O', 'TO', 'RO'].includes(code)) checkedClass += " bg-[#10b981]";
  else if (['X', 'TX'].includes(code)) checkedClass += " bg-[#ef4444]";
  else if (code === '☆') checkedClass += " bg-[#f59e0b]";
  else if (code === 'B') checkedClass += " bg-[#64748b]";
  else checkedClass += " bg-[#0ea5e9]";

  const isChecked = currentCode === code;

  return (
    <button
      onClick={() => onClick(ansId, code, qId, tqId)}
      title={title}
      className={`flex justify-center items-center rounded text-[8px] font-black w-5 h-5 shrink-0 transition-colors ${isChecked ? checkedClass : bgClass}`}
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
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function GradingBoard({ mode, assignmentId, homeworkId, studentId: studentIdParam, onBack, onDirtyChange }: GradingBoardProps) {
  const isHomeworkMode = mode === 'homework';

  const [headerInfo, setHeaderInfo] = useState({ title: "📝 상세 채점표", subtitle: "데이터 불러오는 중...", type: "" });
  const [resultData, setResultData] = useState<any[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<{ [key: string]: any }>({});
  const [answerEdits, setAnswerEdits] = useState<{ [key: string]: string }>({});
  const [gradingCodeMeta, setGradingCodeMeta] = useState<any>({});
  const [wrongLogByAnswerId, setWrongLogByAnswerId] = useState<{ [key: string]: any[] }>({});

  const [isSaving, setIsSaving] = useState(false);
  const [showReportBtn, setShowReportBtn] = useState(false);
  const [totalScore, setTotalScore] = useState<number | "-">(0);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isDeletingReport, setIsDeletingReport] = useState(false);

  const [modalQ, setModalQ] = useState<any>(null);
  const [modalWrongLog, setModalWrongLog] = useState<any[] | null>(null);
  const [modalImg, setModalImg] = useState<string | null>(null);

  const [contextIds, setContextIds] = useState({ studentId: "", examPaperId: "", standardName: "" });

  const mathJaxRef = useRef(false);

  useEffect(() => {
    loadMathJax();
    if (isHomeworkMode) {
      loadHomeworkResults();
    } else if (assignmentId) {
      loadExamResults();
    } else {
      alert("잘못된 접근입니다.");
      onBack();
    }
  }, [assignmentId, homeworkId, studentIdParam]);

  // 💡 [핵심: 깜빡임 원천 차단] pendingUpdates(버튼 클릭 상태)를 의존성 배열에서 완벽히 제거했습니다.
  // 이제 버튼을 아무리 눌러도 화면이 깜빡이지 않습니다.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== "undefined" && (window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch(() => {});
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [resultData, modalQ, modalWrongLog]);

  useEffect(() => {
    onDirtyChange?.(Object.keys(pendingUpdates).length > 0 || Object.keys(answerEdits).length > 0);
  }, [pendingUpdates, answerEdits]);

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

  const loadHomeworkResults = async () => {
    try {
      const { data: gcData } = await supabase.from('master_grading_code').select('code, description, is_correct, score_ratio');
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

            const { newEarned, isCorrectEq } = calcScoreRatio(i.answer.grading_code, subScore, meta);
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
      const { data: gcData } = await supabase.from('master_grading_code').select('code, description, is_correct, score_ratio');
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

      if (exType === '입학테스트') setShowReportBtn(aData.status === '채점완료' || aData.test_status === '채점완료');

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

            const { newEarned, isCorrectEq } = calcScoreRatio(i.answer.grading_code, subScore, meta);
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
  }, [resultData, gradingCodeMeta]);

  const updateGradingCodeLocally = (answerId: string, code: string, questionId: string, tqId: number) => {
    let foundRow = null;
    for (const g of resultData) {
      const f = g.items.find((r:any) => String(r.answer.answer_id) === String(answerId));
      if (f) { foundRow = f; break; }
    }
    if (!foundRow) return;

    const { newEarned, isCorrectEq } = calcScoreRatio(code, foundRow.assigned_score, gradingCodeMeta);
    setPendingUpdates(prev => ({
      ...prev,
      [answerId]: { grading_code: code, is_correct: isCorrectEq, earned_score: newEarned, question_id: questionId, tq_id: tqId }
    }));
  };

  const markAll = (targetCode: string) => {
    if (!confirm(`모든 문항을 일괄적으로 '${targetCode}' 처리하시겠습니까?`)) return;
    const newPending = { ...pendingUpdates };
    resultData.forEach((g: any) => {
      g.items.forEach((row: any) => {
        const ansId = row.answer.answer_id;
        const { newEarned, isCorrectEq } = calcScoreRatio(targetCode, row.assigned_score, gradingCodeMeta);
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
          const payload: any = {
            grading_code: data.grading_code,
            is_correct: data.is_correct || false,
            earned_score: Number(data.earned_score) || 0
          };
          if (answerEdits[ansId]) payload.student_input = answerEdits[ansId];
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
          const updatePromises = ansUpdates.map(u => {
            const upd: any = { grading_code: u.grading_code, is_correct: u.is_correct, earned_score: u.earned_score };
            if (u.student_input) upd.student_input = u.student_input;
            return supabase.from('student_homework_answer').update(upd).eq('hw_answer_id', u.hw_answer_id);
          });
          const results = await Promise.all(updatePromises);
          const errs = results.filter(r => r.error);
          if (errs.length > 0) throw new Error("과제 답안 수정 실패: " + errs[0].error?.message);
        }

        // 🌟 completed_tq_ids도 같이 갱신한다 — 안 그러면 여기서 정답(O) 처리해도 클리닉 쪽
        // "미완료 문제 목록"(resolvePendingHomeworkQuestions)은 여전히 미완료로 보고 학생에게
        // 다시 풀게 시킨다. 반대로 status를 무조건 '채점완료'로 덮어쓰면, 일부만 정답인
        // 상태에서도 /homework 목록에는 "완료"로 잘못 표시된다. 여기서는 이 화면에 로드된
        // 전체 문항(pendingUpdates로 방금 바뀐 것 + 기존에 저장돼 있던 것)을 기준으로
        // 정답(O/TO/RO) 처리된 tq_id만 completed_tq_ids로 다시 계산하고, 전 문항이 다
        // 정답일 때만 status를 '채점완료'로 맞춘다.
        const resolvedCodeByTqId = new Map<number, string>();
        resultData.forEach((g: any) => {
          g.items.forEach((row: any) => {
            const ansId = row.answer.answer_id;
            const code = pendingUpdates[ansId]?.grading_code ?? row.answer.grading_code ?? null;
            if (row.tq_id != null) resolvedCodeByTqId.set(Number(row.tq_id), code);
          });
        });
        const allTqIds = Array.from(resolvedCodeByTqId.keys());
        const completedTqIds = allTqIds.filter(id => ['O', 'TO', 'RO'].includes(resolvedCodeByTqId.get(id) || ''));
        const allDone = allTqIds.length > 0 && completedTqIds.length === allTqIds.length;

        await supabase.from('student_homework_result')
          .update({ completed_tq_ids: completedTqIds, status: allDone ? '채점완료' : '미제출' })
          .eq('homework_id', parseInt(homeworkId as string)).eq('student_id', contextIds.studentId);

        const { data: exInc } = await supabase.from('student_incorrect_record').select('record_id, tq_id').eq('student_id', contextIds.studentId);
        const incInserts: any[] = [];
        const incUpdates: any[] = [];

        updateKeys.forEach(ansId => {
          const data = pendingUpdates[ansId];
          const code = data.grading_code;
          const hadWrong = parseWrongLog(wrongLogByAnswerId[ansId]).length > 0;
          const isFullyCorrect = ['O', 'TO', 'RO'].includes(code) && !hadWrong;

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
          const payload: any = {
            grading_code: data.grading_code,
            is_correct: data.is_correct || false,
            earned_score: Number(data.earned_score) || 0
          };
          if (answerEdits[ansId]) payload.student_input = answerEdits[ansId];
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
          const updatePromises = ansUpdates.map(u => {
            const upd: any = { grading_code: u.grading_code, is_correct: u.is_correct, earned_score: u.earned_score };
            if (u.student_input) upd.student_input = u.student_input;
            return supabase.from('student_answer').update(upd).eq('answer_id', u.answer_id);
          });
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
          const isFullyCorrect = ['O', 'TO', 'RO'].includes(code);

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
        if (headerInfo.type === '입학테스트') setShowReportBtn(true);
      }
      setPendingUpdates({});
      setAnswerEdits({});
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

          const earned = parseFloat(row.answer.earned_score) || 0;
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

      const getLv = (e: number, m: number) => { if (m===0) return '중'; const p = (e/m)*100; if(p>=70) return '상'; if(p>=50) return '중'; return '하'; };
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

      await supabase.from('admission_test_report').delete().eq('assignment_id', parseInt(assignmentId as string));

      const { error: repErr } = await supabase.from('admission_test_report').insert([payload]);

      if (repErr) throw new Error(repErr.message);

      alert("✅ 진단 리포트 재생성 완료! 이제 새 데이터가 반영됩니다.");

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

  const pendingCount = Object.keys(pendingUpdates).length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50 w-full font-pretendard">
      {/* 컴팩트 헤더 */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-2">
        <button onClick={onBack} className="shrink-0 w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-black text-[#002864] truncate">{headerInfo.title}</p>
          <p className="text-[9px] text-slate-400 font-medium truncate">{headerInfo.subtitle}</p>
        </div>
        {!isHomeworkMode && (
          <span className="shrink-0 text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 whitespace-nowrap">
            {totalScore}점
          </span>
        )}
      </div>

      {/* 툴바 */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-white border-b border-slate-100">
        <span className="text-[9px] font-bold text-slate-400">{resultData.length}문항</span>
        <div className="flex gap-1">
          <button onClick={() => markAll('O')} className="text-[9px] font-black bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-md px-2 py-1 transition-colors">전체 O</button>
          <button onClick={() => markAll('X')} className="text-[9px] font-black bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-md px-2 py-1 transition-colors">전체 X</button>
        </div>
      </div>

      {/* 문항 목록 */}
      <div className="flex-1 overflow-y-auto custom-scroll px-2.5 py-2 space-y-2">
        {resultData.length === 0 ? (
          <div className="py-10 text-center text-slate-400 font-bold text-[11px]">데이터 동기화 중입니다...</div>
        ) : (
          resultData.map((g, gIdx) => {
            const gNum = gIdx + 1;
            return (
              <div key={g.id} className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                {g.items.map((row: any, subIdx: number) => {
                  const q = row.question; const a = row.answer;
                  const currentCode = pendingUpdates[a.answer_id]?.grading_code || a.grading_code || "";

                  let markClass = "text-slate-300";
                  if (['O', 'TO', 'RO'].includes(currentCode)) markClass = "text-emerald-500";
                  else if (['X', 'TX'].includes(currentCode)) markClass = "text-red-500";
                  else if (currentCode === '☆') markClass = "text-amber-500";
                  else if (currentCode === 'B') markClass = "text-slate-500";
                  else if (currentCode) markClass = "text-sky-500";

                  const rowBg = ['O', 'TO', 'RO'].includes(currentCode) ? 'bg-emerald-50/40' : (['X', 'TX', '☆', 'B'].includes(currentCode) ? 'bg-red-50/40' : 'bg-white');
                  const qAnswer = formatMathTextForWeb(q.answer || "정보 없음");
                  const qAnswerImgUrl = getCleanUrl(q.answer_image_url);

                  const isBlankAnswer = !a.student_input || a.student_input === "미입력";
                  let sAnswerNode = <span className="truncate" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(a.student_input || "미입력") }} />;
                  if (a.student_input?.startsWith("data:image")) {
                    sAnswerNode = <img src={a.student_input} onClick={() => setModalImg(a.student_input)} className="w-9 h-9 object-contain bg-white border border-slate-300 rounded cursor-zoom-in hover:border-blue-400" alt="student_answer" />;
                  } else if (isBlankAnswer) {
                    sAnswerNode = (
                      <input
                        type="text"
                        value={answerEdits[a.answer_id] ?? ""}
                        onChange={e => setAnswerEdits(prev => ({ ...prev, [a.answer_id]: e.target.value }))}
                        placeholder="미입력 - 답 대신 입력"
                        className="w-full min-w-0 text-[10px] font-bold text-blue-700 bg-blue-50/60 border border-blue-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-400 placeholder:text-slate-400 placeholder:font-medium"
                      />
                    );
                  }

                  const wrongLog = wrongLogByAnswerId[a.answer_id] || [];
                  const isObjective = isObjectiveQuestion(q);
                  const optionsArr = isObjective ? parseOptions(q.options) : [];
                  const correctOptIdx = isObjective ? toOptionIndex(q.answer) : null;
                  const studentOptIdx = isObjective ? toOptionIndex(a.student_input) : null;

                  return (
                    <div key={a.answer_id} className={`px-2.5 py-2 ${subIdx > 0 ? 'border-t border-slate-100' : ''} ${rowBg}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {subIdx === 0 ? (
                            <span className="w-4 h-4 rounded bg-[#002864] text-white text-[8px] font-black flex items-center justify-center shrink-0">{gNum}</span>
                          ) : (
                            <span className="text-[9px] font-black text-blue-600 shrink-0">({subIdx + 1})</span>
                          )}
                          <button onClick={() => setModalQ(g)} className="text-[9px] font-bold text-slate-400 hover:text-[#002864] underline decoration-dotted shrink-0">문제보기</button>
                          <span className={`text-[8px] font-black px-1 py-0.5 rounded border shrink-0 ${isObjective ? 'bg-sky-50 text-sky-600 border-sky-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                            {isObjective ? '객관식' : '주관식'}
                          </span>
                          <span className="text-[9px] text-slate-400 shrink-0">{parseFloat(Number(row.assigned_score).toFixed(1))}점</span>
                        </div>
                        <span className={`text-[11px] font-black shrink-0 ${markClass}`}>{currentCode || '-'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] mb-1.5">
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <span className="text-emerald-700 font-bold truncate min-w-0" dangerouslySetInnerHTML={{ __html: qAnswer }} />
                          {qAnswerImgUrl && (
                            <img src={qAnswerImgUrl} onClick={() => setModalImg(qAnswerImgUrl)} className="w-9 h-9 shrink-0 object-contain bg-white border border-emerald-300 rounded cursor-zoom-in hover:border-emerald-500" alt="correct_answer" />
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <span className="text-blue-700 font-bold truncate min-w-0 flex-1">{sAnswerNode}</span>
                          {wrongLog.length > 0 && (
                            <button onClick={() => setModalWrongLog(wrongLog)} title={`이전 오답 ${wrongLog.length}개 보기`} className="shrink-0 relative w-4 h-4 rounded-full bg-rose-50 hover:bg-rose-500 text-rose-500 hover:text-white flex items-center justify-center text-[8px] leading-none transition-colors border border-rose-200">
                              📝
                              <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[7px] font-black rounded-full w-3 h-3 flex items-center justify-center leading-none">{wrongLog.length}</span>
                            </button>
                          )}
                        </div>
                      </div>
                      {isObjective && optionsArr.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {optionsArr.map((opt: string, oIdx: number) => {
                            const optNum = oIdx + 1;
                            const isCorrectOpt = correctOptIdx === optNum;
                            const isPicked = studentOptIdx === optNum;
                            return (
                              <span
                                key={oIdx}
                                title={String(opt)}
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded border max-w-[8rem] truncate ${
                                  isCorrectOpt ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                  : isPicked ? 'bg-blue-50 border-blue-400 text-blue-700'
                                  : 'bg-white border-slate-200 text-slate-400'
                                }`}
                              >
                                {isCorrectOpt ? '✓ ' : isPicked ? '● ' : ''}{optNum}. {opt}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-0.5">
                        {GRADE_CODES.map(({ code, title }) => (
                          <GradeButton key={code} code={code} title={title} currentCode={currentCode} ansId={a.answer_id} qId={row.question_id} tqId={row.tq_id} onClick={handleGradeClick} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* 하단 저장 바 */}
      <div className="shrink-0 bg-white border-t border-slate-200 px-3 py-2 flex items-center justify-between gap-1.5">
        <span className={`text-[9px] font-bold whitespace-nowrap ${pendingCount > 0 ? 'text-orange-500' : 'text-slate-400'}`}>
          {pendingCount}건 대기{pendingCount > 0 && ' 🟡'}
        </span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {headerInfo.type === '입학테스트' && showReportBtn && (
            <>
              <button onClick={() => window.open(`/print/report?assignment_id=${assignmentId}&t=${Date.now()}`, '_blank')} className="text-[9px] font-black bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg px-2 py-1.5 transition-colors">
                📊 리포트 열기
              </button>
              <button onClick={handleDeleteReport} disabled={isDeletingReport} className="text-[9px] font-black bg-white hover:bg-rose-50 text-rose-500 border border-rose-200 rounded-lg px-2 py-1.5 transition-colors disabled:opacity-50">
                {isDeletingReport ? "삭제 중" : "🗑️ 삭제"}
              </button>
            </>
          )}
          {headerInfo.type === '입학테스트' && (
            <button onClick={triggerReportGeneration} disabled={isGeneratingReport} className="text-[9px] font-black bg-[#e74c3c] hover:bg-red-700 text-white rounded-lg px-2 py-1.5 transition-colors disabled:opacity-50">
              {isGeneratingReport ? "생성 중" : "🪄 리포트 생성"}
            </button>
          )}
          <button onClick={saveOnlyGrades} disabled={isSaving} className="text-[10px] font-black bg-[#002864] hover:bg-blue-900 text-white rounded-lg px-3 py-1.5 shadow-sm transition-colors disabled:opacity-50">
            {isSaving ? "저장 중..." : "💾 저장"}
          </button>
        </div>
      </div>

      <div className="relative">
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

        {modalImg && (
          <div className="fixed inset-0 bg-slate-900/70 z-50 flex items-center justify-center p-6 no-print" onClick={() => setModalImg(null)}>
            <img src={modalImg} className="max-w-full max-h-full rounded-lg shadow-2xl bg-white" alt="answer_zoom" />
          </div>
        )}
      </div>
    </div>
  );
}
