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

const parseWrongLog = (raw: any) => {
  if (!raw) return [];
  let log = raw;
  if (typeof log === 'string') { try { log = JSON.parse(log); } catch (e) { return []; } }
  return Array.isArray(log) ? log : [];
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
  const [standardName, setStandardName] = useState<string>("");
  
  const [matrixData, setMatrixData] = useState<{
    cols: any[];
    rows: any[];
    cellMap: Map<string, any>;
  }>({ cols: [], rows: [], cellMap: new Map() });

  const [pendingUpdates, setPendingUpdates] = useState<{ [key: string]: any }>({});
  const [gradingCodeMeta, setGradingCodeMeta] = useState<any>({});

  const [isSaving, setIsSaving] = useState(false);
  const [processingReportId, setProcessingReportId] = useState<string | null>(null);
  
  const [modalQ, setModalQ] = useState<any>(null);
  const [modalWrongLog, setModalWrongLog] = useState<any[] | null>(null);
  const [modalImg, setModalImg] = useState<string | null>(null);

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
  }, [matrixData, modalQ, modalWrongLog]);

  useEffect(() => {
    onDirtyChange?.(Object.keys(pendingUpdates).length > 0);
  }, [pendingUpdates]);

  useEffect(() => {
    if (matrixData.cols.length === 0) return;

    const tableName = isHomeworkMode ? 'student_homework_answer' : 'student_answer';
    const channelId = `grading_realtime_${tableName}_${assignmentId || homeworkId}`;
    
    const channel = supabase.channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, (payload) => {
        const newData = payload.new as any;
        if (!newData) return;

        setMatrixData(prev => {
          const newMap = new Map(prev.cellMap);
          for (const [key, cell] of newMap.entries()) {
            const isMatch = isHomeworkMode
              ? (String(cell.homeworkId) === String(newData.homework_id) && String(cell.studentId) === String(newData.student_id) && String(cell.tqId) === String(newData.tq_id))
              : (String(cell.assignmentId) === String(newData.exam_assignment_id) && String(cell.studentId) === String(newData.student_id) && String(cell.qId) === String(newData.question_id));

            if (isMatch) {
              newMap.set(key, {
                ...cell,
                answerId: newData.hw_answer_id || newData.answer_id || cell.answerId,
                studentInput: newData.student_input,
                wrongLog: parseWrongLog(newData.wrong_attempts_log),
                currentCode: newData.grading_code || cell.currentCode
              });
              break; 
            }
          }
          return { ...prev, cellMap: newMap };
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [matrixData.cols, isHomeworkMode, assignmentId, homeworkId]);

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
    let t = String(text).replace(/<br\s*\/?>/gi, '__LOGICA_BR_PLACEHOLDER__');
    t = t.replace(/</g, ' &lt; ').replace(/>/g, ' &gt; ');
    t = t.replace(/__LOGICA_BR_PLACEHOLDER__/g, '<br>');
    t = t.replace(/<br>\s*,\s*<br>/g, ', ').replace(/<br>\s*,/g, ', ').replace(/,\s*<br>/g, ', ');
    while (/\\text\s*\{\s*\\text\s*\{/.test(t)) { t = t.replace(/\\text\s*\{\s*\\text\s*\{([^{}]+)\}\s*\}/g, '\\text{$1}'); }
    t = t.replace(/\\text\s*\{([^{}]*[가-힣]+[^{}]*)\}/g, '$1');
    t = t.replace(/\\bigcirc/g, '\\circ').replace(/\^{?[○◯]}?/g, '^{\\circ}').replace(/([0-9]+)\s*[○◯]/g, '$1^{\\circ}');
    t = t.replace(/[◀◁]\s*\|?\s*[▶▷]/g, '□').replace(/◁\|▷/g, '□').replace(/◀\|▶/g, '□');
    t = t.replace(/\\overset\s*\{\s*([^}]+)\s*\}\s*\{\s*\\square\s*\}/g, ' $1 ').replace(/\\overset\s*\{\s*([^}]+)\s*\}\s*\{\s*□\s*\}/g, ' $1 ');
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

      const { data: baseHw } = await supabase.from('homework_assignment').select('*, class(name)').eq('homework_id', homeworkId).single();
      if (!baseHw) { alert("과제 기준 데이터를 찾을 수 없습니다."); onBack(); return; }

      setHeaderInfo({ title: `📚 ${baseHw.homework_title} ${gradeAll ? '일괄 채점' : '개별 채점'}`, subtitle: `[${baseHw.class?.name || '반 미지정'}] 스프레드시트 뷰`, type: '과제' });

      const { data: allHws } = await supabase.from('homework_assignment').select('*').eq('class_id', baseHw.class_id).eq('homework_title', baseHw.homework_title);
      const hwIdsToFetchStatus = allHws?.map(h => h.homework_id) || [];
      const { data: hwResults } = await supabase.from('student_homework_result').select('homework_id, student_id, status, completed_tq_ids').in('homework_id', hwIdsToFetchStatus);

      const baseResult = hwResults?.find(r => String(r.homework_id) === String(baseHw.homework_id));
      const isBaseCompleted = ['채점완료', '제출완료', '완료'].includes(baseResult?.status || '');

      let validStudentIds: string[] = [];

      if (gradeAll) {
        const { data: enrolls } = await supabase.from('enrollment').select('student_id, student(status)').eq('class_id', baseHw.class_id);
        const classStudentIds = enrolls?.filter((e: any) => {
          const s = Array.isArray(e.student) ? e.student[0] : e.student;
          return s?.status === '재원';
        }).map(e => e.student_id) || [];

        classStudentIds.forEach(sId => {
          let studentHws = allHws?.filter(h => String(h.target_student_id) === String(sId)) || [];
          const globalHw = allHws?.find(h => !h.target_student_id);
          let targetHw = studentHws.length > 0 ? studentHws[0] : globalHw;
          if (String(sId) === String(baseHw.target_student_id)) targetHw = baseHw;

          if (targetHw) {
            const res = hwResults?.find(r => String(r.homework_id) === String(targetHw.homework_id) && String(r.student_id) === String(sId));
            const isComp = ['채점완료', '제출완료', '완료'].includes(res?.status || '');
            if (isComp === isBaseCompleted) validStudentIds.push(sId);
          }
        });
      } else {
        if (baseHw.target_student_id) validStudentIds.push(baseHw.target_student_id);
        else if (studentIdParam) validStudentIds.push(studentIdParam);
      }

      if (validStudentIds.length === 0) { alert("채점할 대상 학생이 없습니다."); onBack(); return; }

      const { data: targetStudents } = await supabase.from('student').select('student_id, name, status').in('student_id', validStudentIds);

      let cols = (targetStudents || [])
        .filter(s => s.status === '재원')
        .map(s => ({ id: s.student_id, name: s.name || '알수없음' }))
        .sort((a,b) => a.name.localeCompare(b.name));
      
      if (!gradeAll && studentIdParam) cols = cols.filter(c => String(c.id) === String(studentIdParam));
      if (cols.length === 0) { alert("🎉 해당 과제의 채점이 모두 완료되었습니다!"); onBack(); return; }

      const studentHwMap = new Map();
      const globalHw = allHws?.find(h => !h.target_student_id);
      
      cols.forEach(s => {
        let studentHws = allHws?.filter(h => String(h.target_student_id) === String(s.id)) || [];
        if (studentHws.length === 0 && globalHw) { studentHwMap.set(s.id, globalHw); return; }
        studentHws.sort((a, b) => b.homework_id - a.homework_id); 
        let selectedHw = studentHws[0];
        if (String(s.id) === String(baseHw.target_student_id)) { selectedHw = baseHw; } 
        else {
          const matched = studentHws.find(h => {
            const r = hwResults?.find(res => String(res.homework_id) === String(h.homework_id));
            const isComp = ['채점완료', '제출완료', '완료'].includes(r?.status || '');
            return isComp === isBaseCompleted;
          });
          if (matched) selectedHw = matched;
        }
        if (selectedHw) studentHwMap.set(s.id, selectedHw);
      });

      let hwTargetQs: any[] = [];
      try { hwTargetQs = typeof baseHw.target_questions === 'string' ? JSON.parse(baseHw.target_questions) : baseHw.target_questions; } catch(e){}
      
      if (!hwTargetQs || hwTargetQs.length === 0) { alert("과제에 포함된 문항이 없습니다."); onBack(); return; }

      const allTqIds = new Set<number>();
      cols.forEach(s => {
        const hw = studentHwMap.get(s.id);
        const res = hwResults?.find(r => String(r.homework_id) === String(hw.homework_id));
        const completedIds = new Set(safeParseIds(res?.completed_tq_ids));

        let tqs = safeParseIds(hw.target_questions);
        tqs.forEach((id: number) => {
          if (!isBaseCompleted && completedIds.has(id)) return;
          allTqIds.add(id);
        });
      });

      if (allTqIds.size === 0) { alert("🎉 이 과제에 남은 모든 문항의 채점이 완료되었습니다!"); onBack(); return; }

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

      const rows = tqData.map((tq: any, index: number) => {
        const q = tq.question_db || {};
        return {
          id: tq.tq_id,
          qId: q.question_id,
          displayNum: `${index + 1}`,
          pageNum: tq.page_number || q.page_number || q.final_printed_page || q.detected_page_num || null,
          answer: tq.answer || q.answer,
          fullQuestion: { displayQNum: `${index + 1}`, items: [{ question: { ...q, question: tq.question || q.question, answer: tq.answer || q.answer } }] },
          assignedScore: 100 / (tqData.length || 1)
        };
      });

      const activeHwIds = Array.from(new Set(cols.map(s => studentHwMap.get(s.id).homework_id)));
      const { data: answers } = await supabase.from('student_homework_answer').select('*').in('homework_id', activeHwIds);
      
      const cellMap = new Map();
      cols.forEach(s => {
        const hw = studentHwMap.get(s.id);
        const res = hwResults?.find(r => String(r.homework_id) === String(hw.homework_id));
        const completedIds = new Set(safeParseIds(res?.completed_tq_ids));
        const hwTargetSet = new Set(safeParseIds(hw.target_questions));

        // 🌟 학생별 문제 번호 1부터 초기화
        let studentQNum = 1;

        rows.forEach(r => {
          const key = `${s.id}_${r.id}`;
          if (!hwTargetSet.has(r.id) || (!isBaseCompleted && completedIds.has(r.id))) {
            cellMap.set(key, { isBlocked: true });
            return;
          }
          
          const existingAns = answers?.find(a => String(a.student_id) === String(s.id) && String(a.homework_id) === String(hw.homework_id) && String(a.tq_id) === String(r.id));
          
          cellMap.set(key, {
            isBlocked: false,
            studentQNum: studentQNum++, // 🌟 배정된 문제에 한해 순차적으로 번호 부여
            answerId: existingAns?.hw_answer_id || null,
            homeworkId: hw.homework_id,
            studentId: s.id,
            tqId: r.id,
            qId: r.qId,
            currentCode: existingAns?.grading_code || null,
            assignedScore: r.assignedScore,
            studentInput: existingAns?.student_input,
            wrongLog: parseWrongLog(existingAns?.wrong_attempts_log)
          });
        });
      });

      setMatrixData({ cols, rows, cellMap });
      setPendingUpdates({});
    } catch (e: any) { alert(`데이터 로드 실패: ${e.message}`); onBack(); }
  };

  const loadMatrixExam = async () => {
    try {
      const { data: gcData } = await supabase.from('master_grading_code').select('code, description, is_correct, score_ratio');
      const meta: any = {}; gcData?.forEach(row => { if (row.code) meta[row.code] = row; });
      setGradingCodeMeta(meta);

      const { data: baseEx } = await supabase.from('exam_assignment').select('*, exam_master(*), class(name)').eq('assignment_id', assignmentId).single();
      if (!baseEx) { alert("시험 기준 데이터를 찾을 수 없습니다."); onBack(); return; }

      const m = Array.isArray(baseEx.exam_master) ? baseEx.exam_master[0] : baseEx.exam_master;
      const exTitle = m?.title || '문제지';
      const exType = m?.exam_type || '';
      
      const matchTag = (m?.sub_title || '').match(/\d+-\d+/) || exTitle.match(/\d+-\d+/);
      const stdName = matchTag ? matchTag[0] : '';
      setStandardName(stdName);

      setHeaderInfo({ title: `📝 ${exTitle} ${gradeAll ? '일괄 채점' : '개별 채점'}`, subtitle: `[${baseEx.class?.name || '반 미지정'}] 스프레드시트 뷰`, type: exType });

      const { data: allAssigns } = await supabase.from('exam_assignment').select('*, student(name)').eq('exam_id', m.exam_id).eq('class_id', baseEx.class_id);
      const isBaseCompleted = ['채점완료', '완료'].includes(baseEx.status);

      let cols = (allAssigns || [])
        .filter((a: any) => gradeAll ? ['채점완료', '완료'].includes(a.status) === isBaseCompleted : true)
        .map((a: any) => {
          const sObj = Array.isArray(a.student) ? a.student[0] : a.student;
          return {
            id: a.student_id,
            name: sObj?.name || '알수없음',
            assignmentId: a.assignment_id,
            status: a.status,
            testStatus: a.test_status,
            totalScore: a.total_score || 0,
            hasReport: false
          };
        }).sort((a: any, b: any) => a.name.localeCompare(b.name));

      if (!gradeAll && studentIdParam) cols = cols.filter(c => String(c.id) === String(studentIdParam));
      if (cols.length === 0) { alert("대상 학생이 없습니다."); onBack(); return; }

      if (exType === '입학테스트') {
        const assignIds = cols.map(c => c.assignmentId);
        const { data: reports } = await supabase.from('admission_test_report').select('assignment_id').in('assignment_id', assignIds);
        const reportedIds = new Set(reports?.map(r => r.assignment_id));
        cols.forEach(c => { c.hasReport = reportedIds.has(c.assignmentId); });
      }

      const { data: items } = await supabase.from('exam_item').select('*').eq('exam_id', m.exam_id).order('sort_order');
      if (!items || items.length === 0) { alert("시험에 포함된 문항이 없습니다."); onBack(); return; }

      const qIds = items.map(i => i.question_id);
      let fetchedQuestions: any[] = [];
      for (let i = 0; i < qIds.length; i += 150) {
        const chunk = qIds.slice(i, i + 150);
        const { data } = await supabase.from('question_db').select('*').in('question_id', chunk);
        if(data) fetchedQuestions = [...fetchedQuestions, ...data];
      }

      const qMap: any = {}; fetchedQuestions.forEach(q => qMap[q.question_id] = q);

      let userMergedTextQuestions: any[][] = [];
      if (m?.layout_settings?.userMergedTextQuestions) {
          userMergedTextQuestions = m.layout_settings.userMergedTextQuestions;
      }

      const customGroupMap = new Map<string, string>();
      userMergedTextQuestions.forEach((arr, idx) => {
          const gId = `custom_group_${idx}`;
          arr.forEach(qid => customGroupMap.set(String(qid), gId));
      });

      let mainNum = 0; let currentGroupId: string | null = null; let subNum = 1;

      const rows = items.map((item, index) => {
        const q = qMap[item.question_id] || {};
        let gId = customGroupMap.get(String(item.question_id));
        if (!gId) gId = `single_${item.question_id}_${Math.random()}`;

        if (gId !== currentGroupId) { mainNum++; currentGroupId = gId; subNum = 1; } 
        else { subNum++; }

        const isMerged = gId.startsWith('custom_group_');
        const displayNum = isMerged ? `${mainNum}. (${subNum})` : `${mainNum}`;
        const pageInfo = q.page_number || q.final_printed_page || q.detected_page_num || null;

        return {
          id: item.question_id,
          displayNum,
          pageNum: pageInfo,
          answer: q.answer,
          fullQuestion: { displayQNum: displayNum, items: [{ question: q }] },
          assignedScore: item.assigned_score || (100 / items.length)
        };
      });

      const assignIdsToFetch = cols.map(c => c.assignmentId);
      const { data: answers } = await supabase.from('student_answer').select('*').in('exam_assignment_id', assignIdsToFetch);

      const cellMap = new Map();
      cols.forEach(s => {
        // 🌟 학생별 문제 번호 1부터 초기화
        let studentQNum = 1;

        rows.forEach(r => {
          const key = `${s.id}_${r.id}`;
          const existingAns = answers?.find(a => String(a.student_id) === String(s.id) && String(a.question_id) === String(r.id));
          
          cellMap.set(key, {
            isBlocked: false,
            studentQNum: studentQNum++, // 🌟 배정된 문제에 한해 순차적으로 번호 부여
            answerId: existingAns?.answer_id || null,
            assignmentId: s.assignmentId,
            studentId: s.id,
            qId: r.id,
            tqId: null,
            currentCode: existingAns?.grading_code || null,
            assignedScore: r.assignedScore,
            studentInput: existingAns?.student_input,
            wrongLog: parseWrongLog(existingAns?.wrong_attempts_log)
          });
        });
      });

      setMatrixData({ cols, rows, cellMap });
      setPendingUpdates({});
    } catch (error: any) { alert(`데이터 로드 실패: ${error.message}`); onBack(); }
  };

  const fireInstantSave = async (payloads: any[]) => {
    if (payloads.length === 0) return;
    try {
      let successIds: string[] = [];
      
      if (isHomeworkMode) {
        const inserts = payloads.filter(p => !p.answer_id).map(p => ({
          homework_id: p.homework_id, student_id: p.student_id, tq_id: p.tq_id, grading_code: p.grading_code, is_correct: p.is_correct, earned_score: p.earned_score
        }));
        const updates = payloads.filter(p => p.answer_id).map(p => ({
          hw_answer_id: p.answer_id, grading_code: p.grading_code, is_correct: p.is_correct, earned_score: p.earned_score
        }));
        
        if (inserts.length > 0) {
          const { data, error } = await supabase.from('student_homework_answer').insert(inserts).select();
          if (error) throw error;
          if (data) {
            successIds.push(...data.map(d => `${d.student_id}_${d.tq_id}`));
            setMatrixData(prev => {
              const m = new Map(prev.cellMap);
              data.forEach(d => {
                const key = `${d.student_id}_${d.tq_id}`;
                const c = m.get(key);
                if (c) m.set(key, { ...c, answerId: d.hw_answer_id });
              });
              return { ...prev, cellMap: m };
            });
          }
        }
        if (updates.length > 0) {
          const results = await Promise.all(updates.map(u => supabase.from('student_homework_answer').update({ grading_code: u.grading_code, is_correct: u.is_correct, earned_score: u.earned_score }).eq('hw_answer_id', u.hw_answer_id).select()));
          results.forEach(res => {
            if (res.error) console.error(res.error);
            if (res.data) successIds.push(...res.data.map(d => `${d.student_id}_${d.tq_id}`));
          });
        }
      } else {
        const inserts = payloads.filter(p => !p.answer_id).map(p => ({
          exam_assignment_id: p.assignment_id, student_id: p.student_id, question_id: p.q_id, grading_code: p.grading_code, is_correct: p.is_correct, earned_score: p.earned_score
        }));
        const updates = payloads.filter(p => p.answer_id).map(p => ({
          answer_id: p.answer_id, grading_code: p.grading_code, is_correct: p.is_correct, earned_score: p.earned_score
        }));
        
        if (inserts.length > 0) {
          const { data, error } = await supabase.from('student_answer').insert(inserts).select();
          if (error) throw error;
          if (data) {
            successIds.push(...data.map(d => `${d.student_id}_${d.question_id}`));
            setMatrixData(prev => {
              const m = new Map(prev.cellMap);
              data.forEach(d => {
                const key = `${d.student_id}_${d.question_id}`;
                const c = m.get(key);
                if (c) m.set(key, { ...c, answerId: d.answer_id });
              });
              return { ...prev, cellMap: m };
            });
          }
        }
        if (updates.length > 0) {
          const results = await Promise.all(updates.map(u => supabase.from('student_answer').update({ grading_code: u.grading_code, is_correct: u.is_correct, earned_score: u.earned_score }).eq('answer_id', u.answer_id).select()));
          results.forEach(res => {
            if (res.error) console.error(res.error);
            if (res.data) successIds.push(...res.data.map(d => `${d.student_id}_${d.question_id}`));
          });
        }
      }

      if (successIds.length > 0) {
        setPendingUpdates(prev => {
          const next = { ...prev };
          successIds.forEach(id => delete next[id]);
          return next;
        });
      }
    } catch (err) {
      console.error("Instant save failed:", err);
    }
  };

  const handleMatrixGrade = (sId: string, rowId: string, code: string) => {
    const key = `${sId}_${rowId}`;
    const cell = matrixData.cellMap.get(key);
    if (!cell || cell.isBlocked) return;

    const { newEarned, isCorrectEq } = calcScoreRatio(code, cell.assignedScore, gradingCodeMeta);
    
    setMatrixData(prev => {
      const newMap = new Map(prev.cellMap);
      newMap.set(key, { ...cell, currentCode: code });
      return { ...prev, cellMap: newMap };
    });

    const payload = {
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

    setPendingUpdates(prev => ({ ...prev, [key]: payload }));
    fireInstantSave([payload]); 
  };

  const markCol = (sId: string, code: string) => {
    const payloads: any[] = [];
    setMatrixData(prev => {
      const newMap = new Map(prev.cellMap);
      matrixData.rows.forEach(r => {
        const key = `${sId}_${r.id}`;
        const cell = newMap.get(key);
        if (!cell || cell.isBlocked) return;
        
        const { newEarned, isCorrectEq } = calcScoreRatio(code, cell.assignedScore, gradingCodeMeta);
        newMap.set(key, { ...cell, currentCode: code });
        
        payloads.push({
          type: isHomeworkMode ? 'hw' : 'exam',
          answer_id: cell.answerId, homework_id: cell.homeworkId, assignment_id: cell.assignmentId,
          student_id: sId, q_id: cell.qId, tq_id: cell.tqId,
          grading_code: code, is_correct: isCorrectEq, earned_score: newEarned
        });
      });
      return { ...prev, cellMap: newMap };
    });

    const newPending = { ...pendingUpdates };
    payloads.forEach(p => { newPending[`${p.student_id}_${isHomeworkMode ? p.tq_id : p.q_id}`] = p; });
    setPendingUpdates(newPending);
    fireInstantSave(payloads); 
  };

  const markRow = (rowId: string, code: string) => {
    const payloads: any[] = [];
    setMatrixData(prev => {
      const newMap = new Map(prev.cellMap);
      matrixData.cols.forEach(c => {
        const key = `${c.id}_${rowId}`;
        const cell = newMap.get(key);
        if (!cell || cell.isBlocked) return;
        
        const { newEarned, isCorrectEq } = calcScoreRatio(code, cell.assignedScore, gradingCodeMeta);
        newMap.set(key, { ...cell, currentCode: code });

        payloads.push({
          type: isHomeworkMode ? 'hw' : 'exam',
          answer_id: cell.answerId, homework_id: cell.homeworkId, assignment_id: cell.assignmentId,
          student_id: c.id, q_id: cell.qId, tq_id: cell.tqId,
          grading_code: code, is_correct: isCorrectEq, earned_score: newEarned
        });
      });
      return { ...prev, cellMap: newMap };
    });

    const newPending = { ...pendingUpdates };
    payloads.forEach(p => { newPending[`${p.student_id}_${isHomeworkMode ? p.tq_id : p.q_id}`] = p; });
    setPendingUpdates(newPending);
    fireInstantSave(payloads);
  };

  const saveMatrixGrades = async () => {
    if (Object.keys(pendingUpdates).length > 0) return alert("현재 백그라운드 저장 중인 항목이 있습니다. 잠시 후 다시 시도해주세요.");
    if (!confirm("현재 DB에 실시간 저장되어 있습니다.\n\n최종 마감을 위해 오답노트를 발급하고 제출 상태를 갱신하시겠습니까?")) return;

    setIsSaving(true);
    try {
      const studentStatuses = new Set<string>();

      matrixData.cols.forEach(c => {
        matrixData.rows.forEach(r => {
          const key = `${c.id}_${r.id}`;
          const cell = matrixData.cellMap.get(key);
          if (cell && !cell.isBlocked && cell.currentCode) {
            if (isHomeworkMode) studentStatuses.add(`${cell.homeworkId}_${cell.studentId}`);
            else studentStatuses.add(`${cell.assignmentId}_${cell.studentId}`);
          }
        });
      });

      if (isHomeworkMode) {
        for (const statusKey of Array.from(studentStatuses)) {
          const [hwId, stId] = statusKey.split('_');
          
          const resolvedCodeByTqId = new Map<number, string>();
          matrixData.rows.forEach(r => {
             const key = `${stId}_${r.id}`;
             const cell = matrixData.cellMap.get(key);
             if (cell && !cell.isBlocked && String(cell.homeworkId) === String(hwId)) {
                if (r.id != null) resolvedCodeByTqId.set(Number(r.id), cell.currentCode || null);
             }
          });
          
          const allTqIds = Array.from(resolvedCodeByTqId.keys());
          const completedTqIds = allTqIds.filter(id => ['O', 'TO', 'RO'].includes(resolvedCodeByTqId.get(id) || ''));
          const allDone = allTqIds.length > 0 && completedTqIds.length === allTqIds.length;
          
          await supabase.from('student_homework_result').update({ completed_tq_ids: completedTqIds, status: allDone ? '채점완료' : '미제출' }).eq('homework_id', hwId).eq('student_id', stId);
        }
      } else {
        for (const statusKey of Array.from(studentStatuses)) {
          const [assignId, stId] = statusKey.split('_');
          const { data: upAns } = await supabase.from('student_answer').select('question_id, earned_score').eq('exam_assignment_id', assignId);
          let tempT = 0; upAns?.forEach(a => tempT += (Number(a.earned_score) || 0));
          await supabase.from('exam_assignment').update({ total_score: tempT, status: '채점완료' }).eq('assignment_id', assignId);
        }
      }

      const uniqueStudents = Array.from(new Set(Array.from(studentStatuses).map(s => s.split('_')[1])));
      for (const stId of uniqueStudents) {
        const { data: exInc } = await supabase.from('student_incorrect_record').select('*').eq('student_id', stId).in('source_type', ['교재과제', '시험지']);
        
        const incInserts: any[] = [];
        const incUpdates: any[] = [];

        matrixData.rows.forEach(r => {
          const key = `${stId}_${r.id}`;
          const cell = matrixData.cellMap.get(key);
          if (!cell || cell.isBlocked || !cell.currentCode) return;

          const hadWrong = cell?.wrongLog && cell.wrongLog.length > 0;
          const isFullyCorrect = ['O', 'TO', 'RO'].includes(cell.currentCode) && !hadWrong;

          const targetQId = isHomeworkMode ? cell.tqId : cell.qId;
          const matchField = isHomeworkMode ? 'tq_id' : 'question_id';

          const match = exInc?.find(e => String(e[matchField]) === String(targetQId));
          const p = { student_id: stId, [matchField]: targetQId, source_type: isHomeworkMode ? '교재과제' : '시험지', status: cell.currentCode, resolved_at: isFullyCorrect ? new Date().toISOString() : null };
          
          if (match) incUpdates.push({ record_id: match.record_id, ...p });
          else incInserts.push(p);
        });

        if (incInserts.length > 0) await supabase.from('student_incorrect_record').insert(incInserts);
        if (incUpdates.length > 0) await Promise.all(incUpdates.map(u => supabase.from('student_incorrect_record').update({ status: u.status, resolved_at: u.resolved_at }).eq('record_id', u.record_id)));
      }

      alert("🎉 완료 상태 갱신 및 오답노트 발급이 처리되었습니다!");
      if (isHomeworkMode) loadMatrixHomework(); else loadMatrixExam();

    } catch (err: any) {
      console.error("상태 갱신 오류:", err);
      alert(`❌ 오류:\n${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const triggerReportGeneration = async (sId: string, assignId: string) => {
    const hasUnsaved = Object.keys(pendingUpdates).some(k => pendingUpdates[k].student_id === sId);
    if (hasUnsaved) return alert("⚠️ 해당 학생의 실시간 데이터가 저장 중입니다. 잠시 후 다시 시도하세요.");
    
    setProcessingReportId(sId);
    try {
      const { data: upAns } = await supabase.from('student_answer').select('question_id, earned_score').eq('exam_assignment_id', assignId);
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

      const { data: metaData } = await supabase.from('admission_standard_meta').select('*').eq('standard_name', standardName);
      if (!metaData || metaData.length === 0) throw new Error(`[${standardName}] 기준표가 없습니다.`);

      let sGeo=0, sMea=0, sStat=0, sRule=0, sCalc=0;
      let sCalcSense=0, sSpatial=0, sLogic=0;
      let sThink=0, sPersist=0, sKnow=0;
      let maxThink=0, maxPersist=0, maxKnow=0;
      let sD1=0, sD2=0, sD3=0, sD4=0, sD5=0;

      matrixData.rows.forEach((r, idx) => {
        const qNumStr = String(r.fullQuestion.items[0]?.question?.question_number || '');
        const match = qNumStr.match(/\d+/);
        const lNum = match ? parseInt(match[0], 10) : (idx + 1);

        let meta = metaData.find(m => m.question_number === lNum) || { difficulty_level: 3, math_category: '수와 연산' } as any;

        const cell = matrixData.cellMap.get(`${sId}_${r.id}`);
        if (!cell || cell.isBlocked) return;

        const ansRecord = upAns?.find(a => String(a.question_id) === String(r.id));
        const earned = parseFloat(ansRecord?.earned_score) || 0;
        const assigned = parseFloat(cell.assignedScore) || 0;
        const diff = meta.difficulty_level || 3;

        if (diff===1) sD1+=earned; else if(diff===2) sD2+=earned; else if(diff===3) sD3+=earned; else if(diff===4) sD4+=earned; else if(diff===5) sD5+=earned;
        const cat = meta.math_category;
        if (cat==='도형') sGeo+=earned; else if(cat==='측정') sMea+=earned; else if(cat==='확률과 통계') sStat+=earned; else if(cat==='규칙과 논리' || cat==='규칙성') sRule+=earned; else if(cat==='수와 연산') sCalc+=earned;

        if(meta.is_calc_sense) sCalcSense+=earned; if(meta.is_spatial_perception) sSpatial+=earned; if(meta.is_logical_reasoning) sLogic+=earned;
        if(meta.is_thinking_ability) { sThink+=earned; maxThink+=assigned; }
        if(meta.is_task_persistence) { sPersist+=earned; maxPersist+=assigned; }
        if(meta.is_background_knowledge) { sKnow+=earned; maxKnow+=assigned; }
      });

      const getLv = (e: number, m: number) => { if (m===0) return '중'; const p = (e/m)*100; if(p>=70) return '상'; if(p>=50) return '중'; return '하'; };
      const lvThink = getLv(sThink, maxThink); const lvPersist = getLv(sPersist, maxPersist); const lvKnow = getLv(sKnow, maxKnow);

      const { data: cmtData } = await supabase.from('admission_eval_comment').select('comment_text').eq('thinking_level', lvThink).eq('persistence_level', lvPersist).eq('knowledge_level', lvKnow).maybeSingle();

      const payload: any = {
        assignment_id: assignId,
        student_id: sId,
        exam_id: matrixData.rows[0]?.fullQuestion.items[0]?.question?.exam_id || null, 
        total_score: finalScore,
        score_geometry: sGeo, score_measure: sMea, score_stat: sStat, score_rule: sRule, score_calc: sCalc,
        score_calc_sense: sCalcSense, score_spatial_percep: sSpatial, score_logical_reason: sLogic,
        score_thinking: sThink, score_persistence: sPersist, score_knowledge: sKnow,
        score_diff_1: sD1, score_diff_2: sD2, score_diff_3: sD3, score_diff_4: sD4, score_diff_5: sD5,
        level_thinking: lvThink, level_persistence: lvPersist, level_knowledge: lvKnow,
        final_comment: cmtData ? cmtData.comment_text : '분석 코멘트 없음'
      };

      await supabase.from('admission_test_report').delete().eq('assignment_id', assignId);
      const { error: repErr } = await supabase.from('admission_test_report').insert([payload]);
      if (repErr) throw new Error(repErr.message);

      alert("✅ 진단 리포트가 성공적으로 생성되었습니다.");
      loadMatrixExam(); 
    } catch(e: any) {
      console.error(e);
      alert("❌ 리포트 생성 오류:\n" + e.message);
    } finally {
      setProcessingReportId(null);
    }
  };

  const handleDeleteReport = async (sId: string, assignId: string) => {
    if (!confirm("⚠️ 정말 이 진단 리포트를 삭제하시겠습니까?")) return;
    setProcessingReportId(sId);
    try {
      const { error } = await supabase.from('admission_test_report').delete().eq('assignment_id', assignId);
      if (error) throw new Error(error.message);
      alert("🗑️ 진단 리포트가 파기되었습니다.");
      loadMatrixExam();
    } catch (e: any) {
      alert("❌ 리포트 삭제 오류:\n" + e.message);
    } finally {
      setProcessingReportId(null);
    }
  };

  const pendingCount = Object.keys(pendingUpdates).length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50 w-full font-pretendard">
      <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div>
          <h2 className="text-[14px] font-black text-[#002864] flex items-center gap-1.5">{headerInfo.title}</h2>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">{headerInfo.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[11px] font-bold whitespace-nowrap ${pendingCount > 0 ? 'text-orange-500 animate-pulse' : 'text-slate-400'}`}>
            {pendingCount > 0 ? '실시간 저장 중...' : '모두 저장됨'}
          </span>
          <button onClick={saveMatrixGrades} disabled={isSaving || pendingCount > 0} className="text-[11px] font-black bg-[#002864] hover:bg-blue-900 text-white rounded-lg px-4 py-2 shadow-sm transition-colors disabled:opacity-50">
            {isSaving ? "처리 중..." : "💾 최종 완료 및 마감"}
          </button>
        </div>
      </div>

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
                  <th key={c.id} className="p-2 min-w-[140px] w-[140px] border-r border-b bg-slate-100 text-center align-top relative group">
                    <div className="font-extrabold text-[12px] text-[#002864] truncate" title={c.name}>{c.name}</div>
                    
                    {!isHomeworkMode && (
                      <div className="text-[10px] text-slate-500 font-bold mt-0.5 mb-1 bg-white border border-slate-200 rounded px-1 w-max mx-auto">
                        총점: <span className="text-emerald-600">{c.totalScore}</span>
                      </div>
                    )}

                    {headerInfo.type === '입학테스트' && (
                      <div className="mt-1 flex flex-col gap-1 mb-2">
                        {c.hasReport ? (
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => window.open(`/print/report?assignment_id=${c.assignmentId}&t=${Date.now()}`, '_blank')} className="text-[9px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200 rounded px-1.5 py-0.5 hover:bg-emerald-100">열기</button>
                            <button onClick={() => handleDeleteReport(c.id, c.assignmentId)} disabled={processingReportId === c.id} className="text-[9px] font-bold bg-rose-50 text-rose-500 border border-rose-200 rounded px-1.5 py-0.5 hover:bg-rose-100 disabled:opacity-50">삭제</button>
                          </div>
                        ) : (
                          <button onClick={() => triggerReportGeneration(c.id, c.assignmentId)} disabled={processingReportId === c.id} className="text-[9px] font-bold bg-blue-50 text-blue-600 border border-blue-200 rounded px-2 py-0.5 mx-auto hover:bg-blue-100 disabled:opacity-50">
                            {processingReportId === c.id ? "생성 중.." : "리포트 발급"}
                          </button>
                        )}
                      </div>
                    )}

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
                        <span className="text-[12px] font-black text-[#002864] truncate whitespace-nowrap">
                          {r.displayNum}{r.displayNum.includes('(') ? '' : '번'}
                        </span>
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
                  
                  {matrixData.cols.map(c => {
                    const key = `${c.id}_${r.id}`;
                    const cell = matrixData.cellMap.get(key);
                    
                    if (!cell || cell.isBlocked) {
                      return <td key={key} className="border-r border-b bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQIW2NkQAKrVq36zwjjgzhhYWGMYAEYB8RmROaABAD2OQQ/9rX+aQAAAABJRU5ErkJggg==')] opacity-15 pointer-events-none" />;
                    }

                    const currentCode = pendingUpdates[key]?.grading_code || cell.currentCode;
                    const hasInput = cell.studentInput && cell.studentInput !== '미입력';
                    
                    const cleanInputUrl = getCleanUrl(cell.studentInput);
                    const isImg = hasInput && (
                      String(cell.studentInput).startsWith('data:image') ||
                      /\.(jpeg|jpg|gif|png|svg|webp)$/i.test(String(cell.studentInput)) ||
                      /^[\w-]+\.[\w]+$/.test(String(cell.studentInput)) ||
                      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(cell.studentInput))
                    );
                    
                    return (
                      <td key={key} className="p-2 border-r border-b transition-colors align-middle relative">
                        <div className="flex items-center justify-between mb-1 px-1 h-[16px]">
                           <div className="flex items-center gap-1 min-w-0 shrink-0">
                             {/* 🌟 학생 패드 기준 문항 번호 뱃지 추가 */}
                             <span className="shrink-0 flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 text-[9px] font-black" title="학생 화면에서의 문제 번호">
                               {cell.studentQNum}
                             </span>
                             <div className="text-[9px] text-slate-500 font-semibold truncate max-w-[45px] cursor-help" title={!isImg && hasInput ? cell.studentInput : ''}>
                               {isImg ? (
                                 <span onClick={() => setModalImg(cleanInputUrl || cell.studentInput)} className="text-blue-500 underline cursor-zoom-in">이미지 보기</span>
                               ) : hasInput ? (
                                 <span dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(cell.studentInput) }} />
                               ) : (
                                 <span className="text-slate-300">미입력</span>
                               )}
                             </div>
                           </div>
                           {cell.wrongLog?.length > 0 && (
                             <button onClick={() => setModalWrongLog(cell.wrongLog)} className="text-[8px] bg-rose-100 hover:bg-rose-500 text-rose-600 hover:text-white transition-colors font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none">
                               오답 {cell.wrongLog.length}
                             </button>
                           )}
                        </div>

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
              <h2 className="font-bold text-lg flex items-center gap-2"><span>🔍</span> {modalQ.displayQNum || modalQ.items?.[0]?.question?.question_number}번 문항 상세</h2>
              <button onClick={() => setModalQ(null)} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50 space-y-6">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-extrabold text-slate-800 border-b border-slate-100 pb-2 mb-3">질문 (Question)</h3>
                <div className="math-text text-slate-700 font-medium whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(modalQ.items?.[0]?.question?.question || '-').replace(/\n/g, '<br>') }} />
                {getCleanUrl(modalQ.items?.[0]?.question?.image_url) && <img src={getCleanUrl(modalQ.items[0].question.image_url)} className="max-w-full mt-4 rounded-lg border border-slate-200" alt="Question" />}
              </div>
              <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm">
                <h3 className="font-extrabold text-blue-800 border-b border-blue-200 pb-2 mb-3">정답 (Answer)</h3>
                <div className="math-text text-blue-700 font-bold text-lg whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: `$ ${formatMathTextForWeb(modalQ.items?.[0]?.question?.answer || '-')} $` }} />
              </div>
            </div>
            <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0">
              <button onClick={() => setModalQ(null)} className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg shadow-sm">닫기</button>
            </div>
          </div>
        </div>
      )}

      {modalWrongLog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-rose-600 p-4 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-lg flex items-center gap-2"><span>📝</span> 이전 오답 기록</h2>
              <button onClick={() => setModalWrongLog(null)} className="text-white hover:text-rose-200 font-bold text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50 space-y-3">
              {modalWrongLog.map((entry, i) => {
                const when = entry.at ? new Date(entry.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                
                const cleanInputUrl = getCleanUrl(entry.input);
                const isImgLog = entry.input && (
                  String(entry.input).startsWith('data:image') ||
                  /\.(jpeg|jpg|gif|png|svg|webp)$/i.test(String(entry.input)) ||
                  /^[\w-]+\.[\w]+$/.test(String(entry.input)) ||
                  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(entry.input))
                );

                return (
                  <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <p className="text-xs font-bold text-slate-400">시도 {i + 1}{when ? ' · ' + when : ''}</p>
                    {isImgLog ? (
                      <img src={cleanInputUrl || entry.input} className="max-w-full rounded-lg border border-slate-200 shadow-sm mt-2" alt="wrong_answer" />
                    ) : (
                      <p dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(entry.input || '') }} className="math-text text-slate-700 font-bold mt-1 whitespace-pre-wrap" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0">
              <button onClick={() => setModalWrongLog(null)} className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg shadow-sm">닫기</button>
            </div>
          </div>
        </div>
      )}

      {modalImg && (
        <div className="fixed inset-0 bg-slate-900/70 z-50 flex items-center justify-center p-6 cursor-zoom-out" onClick={() => setModalImg(null)}>
          <img src={modalImg} className="max-w-full max-h-full rounded-lg shadow-2xl bg-white" alt="answer_zoom" />
        </div>
      )}
    </div>
  );
}