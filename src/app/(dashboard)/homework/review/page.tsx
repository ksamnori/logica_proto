// src/app/(dashboard)/homework/review/page.tsx
"use client";

import React, { useEffect, useState, useRef, Suspense, memo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
// 대문항(그룹) 기준 균등 배점 + 서브문항((1),(2) 등) 분할 배점 및 TO/RO 부분점수(score_ratio) 계산 유틸리티

/**
 * 소수점 첫째 자리까지 반올림 (예: 97.5 -> 97.5, 100.0 -> 100)
 */
function roundScore(val: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 10) / 10;
}

/**
 * 채점 기호(O, TO, RO, X, TX 등)와 문항 배점(assignedScore), 마스터 채점 기준(metaMap)을 바탕으로
 * 획득 점수(newEarned), 정답 여부(isCorrectEq), 적용 비율(ratio)을 계산합니다.
 */
function calcScoreRatio(
  code: string | null | undefined,
  assignedScore: number,
  metaMap?: Record<string, any>,
  isAdmission: boolean = false
): { newEarned: number; isCorrectEq: boolean; ratio: number } {
  if (!code) return { newEarned: 0, isCorrectEq: false, ratio: 0 };
  const c = String(code).trim();
  if (!c) return { newEarned: 0, isCorrectEq: false, ratio: 0 };

  const meta = metaMap?.[c];
  let ratio = 0;
  let isCorrectEq = false;

  if (meta) {
    const rawRatio =
      isAdmission && meta.admission_ratio !== undefined && meta.admission_ratio !== null
        ? meta.admission_ratio
        : meta.score_ratio;
    ratio = parseFloat(rawRatio);
    if (isNaN(ratio)) ratio = 0;
    if (ratio > 1) ratio = ratio / 100;

    if (isAdmission) {
      isCorrectEq = ratio > 0;
    } else {
      isCorrectEq =
        meta.is_correct === true ||
        String(meta.is_correct).toLowerCase() === "true" ||
        ["O", "TO", "RO", "a", "b", "c"].includes(c);
    }
  } else {
    if (["O", "a", "b", "c"].includes(c)) {
      ratio = 1.0;
      isCorrectEq = true;
    } else if (c === "TO" || c === "RO") {
      ratio = isAdmission && c === "TO" ? 1.0 : 0.8;
      isCorrectEq = isAdmission ? ratio > 0 : true;
    } else if (c === "q") {
      ratio = isAdmission ? 0.0 : 0.5;
      isCorrectEq = false;
    } else {
      ratio = 0.0;
      isCorrectEq = false;
    }
  }

  const base = Number(assignedScore) || 0;
  const newEarned = Math.round((base * ratio + Number.EPSILON) * 1000) / 1000;
  return { newEarned, isCorrectEq, ratio };
}

/**
 * layout_settings에서 userMergedTextQuestions 배열을 안전하게 추출합니다.
 */
function extractMergedQuestionGroups(layoutSettings: any): string[][] {
  if (!layoutSettings) return [];
  let s = layoutSettings;
  if (typeof s === "string") {
    try {
      s = JSON.parse(s);
    } catch {
      return [];
    }
  }
  if (Array.isArray(s?.userMergedTextQuestions)) {
    return s.userMergedTextQuestions
      .filter((arr: any) => Array.isArray(arr) && arr.length > 0)
      .map((arr: any[]) => arr.map((id: any) => String(id)));
  }
  return [];
}

/**
 * 시험 문항 목록(items)과 layout_settings(userMergedTextQuestions)를 기반으로
 * 대문항(그룹)당 배점을 먼저 구한 뒤(예: 20대문항이면 대문항당 5점),
 * 그룹 내 서브문항 개수로 나눈 세부 배점(예: 서브문항 2개면 각 2.5점) 맵을 반환합니다.
 */
function buildExamQuestionScoreMap(
  items: { question_id: any; sort_order?: number; assigned_score?: any }[],
  layoutSettings?: any,
  examType?: string,
  totalQuestionsFallback?: number
): {
  scoreByQuestionId: Map<string, number>;
  groupCount: number;
  groups: { id: string; is_merged_text: boolean; items: any[]; groupScore: number; subScore: number }[];
} {
  const mergedArrays = extractMergedQuestionGroups(layoutSettings);
  const customGroupMap = new Map<string, string>();
  const customGroupSizeMap = new Map<string, number>();

  mergedArrays.forEach((arr, idx) => {
    const gId = `custom_group_${idx}`;
    customGroupSizeMap.set(gId, arr.length);
    arr.forEach((qid) => customGroupMap.set(String(qid), gId));
  });

  const scoreByQuestionId = new Map<string, number>();

  if (!items || items.length === 0) {
    const flatCount = totalQuestionsFallback || 1;
    const extraSubItems = mergedArrays.reduce(
      (acc, arr) => acc + Math.max(0, arr.length - 1),
      0
    );
    const groupCount = Math.max(1, flatCount - extraSubItems);
    const baseGroupScore = 100 / groupCount;

    mergedArrays.forEach((arr) => {
      const subScore = baseGroupScore / (arr.length || 1);
      arr.forEach((qid) => scoreByQuestionId.set(String(qid), subScore));
    });

    return { scoreByQuestionId, groupCount, groups: [] };
  }

  const sortedItems = [...items].sort(
    (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
  );

  const groupMap = new Map<
    string,
    { id: string; is_merged_text: boolean; items: any[]; groupScore: number; subScore: number }
  >();
  const groups: {
    id: string;
    is_merged_text: boolean;
    items: any[];
    groupScore: number;
    subScore: number;
  }[] = [];

  sortedItems.forEach((item, idx) => {
    const qidStr = String(item.question_id);
    const customGId = customGroupMap.get(qidStr);
    const gId = customGId || `single_${qidStr}_${idx}`;

    if (!groupMap.has(gId)) {
      const newG = {
        id: gId,
        is_merged_text: !!customGId,
        items: [] as any[],
        groupScore: 0,
        subScore: 0,
      };
      groupMap.set(gId, newG);
      groups.push(newG);
    }
    groupMap.get(gId)!.items.push(item);
  });

  const groupCount = groups.length || 1;
  const baseGroupScore = 100 / groupCount;
  const isAdmissionExam = Boolean(
    examType && (examType.includes("입학테스트") || examType.includes("진단평가"))
  );

  groups.forEach((g) => {
    const explicitMax = Math.max(
      ...g.items.map((i: any) => parseFloat(i.assigned_score) || 0)
    );
    const groupMaxScore =
      isAdmissionExam && explicitMax > 0 ? explicitMax : baseGroupScore;
    const subScore = groupMaxScore / (g.items.length || 1);

    g.groupScore = groupMaxScore;
    g.subScore = subScore;

    g.items.forEach((item: any) => {
      scoreByQuestionId.set(String(item.question_id), subScore);
    });
  });

  return { scoreByQuestionId, groupCount, groups };
}

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

const getCleanUrl = (url: string) => {
  if (!url || url === 'null') return '';
  let validUrl = url;
  if (typeof validUrl === 'string' && validUrl.trim().startsWith('[')) { try { validUrl = JSON.parse(validUrl)[0]; } catch(e) {} }
  if (validUrl && validUrl !== 'null' && !validUrl.startsWith('http') && !validUrl.startsWith('data:image')) { 
    validUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/question_images/${validUrl}`; 
  }
  return validUrl;
};

const parseQNum = (numStr: any) => {
  if (!numStr) return { main: 99999, dash: 0, paren: 0, orig: '' };
  const s = String(numStr).trim();
  let main = 0, dash = 0, paren = 0;
  
  const mMain = s.match(/^(\d+)/);
  if (mMain) main = parseInt(mMain[1], 10);
  else return { main: 99999, dash: 0, paren: 0, orig: s };

  const noParen = s.replace(/\(\d+\)/g, ''); 
  const mDash = noParen.match(/-(\d+)/);
  if (mDash) dash = parseInt(mDash[1], 10);

  const mParen = s.match(/\((\d+)\)/);
  if (mParen) paren = parseInt(mParen[1], 10);

  return { main, dash, paren, orig: s };
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

const MathText = memo(({ html, className = "", isDiv = false }: { html: string, className?: string, isDiv?: boolean }) => {
  if (isDiv) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});
MathText.displayName = "MathText";

const QuestionContent = memo(({ textToRender, imageUrl, answer }: { textToRender: string, imageUrl: string, answer: string }) => {
  return (
    <div className="flex-1 bg-white/60 px-4 py-3 rounded-lg border border-slate-200 flex flex-col gap-2 overflow-hidden shadow-inner">
      <div className="font-bold text-slate-800 text-[14px] math-text whitespace-pre-wrap">
        <MathText html={textToRender} />
        {imageUrl && <img src={imageUrl} className="max-w-full max-h-40 mt-2 mix-blend-multiply" alt="" />}
      </div>
      <div className="mt-2 pt-2 border-t border-dashed border-slate-200 flex items-center gap-2">
         <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold shrink-0">DB 정답</span>
         <div className="font-bold text-blue-800 text-[13px] math-text truncate">
           {answer ? <MathText html={answer} /> : <span className="text-slate-400 font-normal italic">-</span>}
         </div>
      </div>
    </div>
  );
});
QuestionContent.displayName = "QuestionContent";


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
  const [gradingMap, setGradingMap] = useState<Record<any, GradeCode | null>>({});
  const [gradingCodeMeta, setGradingCodeMeta] = useState<Record<string, any>>({});
  const gradingCodeMetaRef = useRef<Record<string, any>>({});
  
  const [studentInputMap, setStudentInputMap] = useState<Record<any, string | null>>({});
  
  const [modalQ, setModalQ] = useState<any>(null);
  const [modalStudentAns, setModalStudentAns] = useState<{ qNum: string; input: string | null } | null>(null);

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
  }, [isLoading, groups, modalQ, modalStudentAns]);

  useEffect(() => {
    if (groups.length === 0) return;
    const tableName = (isExamHw && assignmentId) ? 'student_answer' : 'student_homework_answer';
    const channelId = `hw_review_sync_${assignmentId || homeworkId}_${studentId}_${Date.now()}`;
    
    const channel = supabase.channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, (payload) => {
        const newData = payload.new as any;
        if (!newData) return;
        if (String(newData.student_id) !== String(studentId)) return;

        if (isExamHw && assignmentId) {
          if (String(newData.exam_assignment_id) === String(assignmentId)) {
            setGradingMap(prev => ({ ...prev, [newData.question_id]: newData.grading_code }));
            if (newData.student_input) setStudentInputMap(prev => ({ ...prev, [newData.question_id]: newData.student_input }));
          }
        } else if (homeworkId) {
          if (String(newData.homework_id) === String(homeworkId)) {
            setGradingMap(prev => ({ ...prev, [newData.tq_id]: newData.grading_code }));
            if (newData.student_input) setStudentInputMap(prev => ({ ...prev, [newData.tq_id]: newData.student_input }));
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [groups, assignmentId, homeworkId, isExamHw, studentId]);

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

  const handleRefreshMathJax = () => {
    if (typeof window !== "undefined" && (window as any).MathJax) {
      if ((window as any).MathJax.typesetClear) {
        (window as any).MathJax.typesetClear();
      }
      if ((window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch((err: any) => {
          console.error("MathJax 강제 새로고침 오류:", err);
        });
      }
    }
  };

  const loadHomeworkData = async () => {
    setIsLoading(true);
    try {
      const { data: gcData } = await supabase.from('master_grading_code').select('code, description, is_correct, score_ratio, admission_ratio');
      const metaMap: Record<string, any> = {};
      gcData?.forEach((row: any) => { if (row.code) metaMap[row.code] = row; });
      setGradingCodeMeta(metaMap);
      gradingCodeMetaRef.current = metaMap;

      if (isExamHw && assignmentId) {
        const [ { data: stuData }, { data: aData }, { data: ansData } ] = await Promise.all([
          supabase.from('student').select('name, grade').eq('student_id', studentId).single(),
          supabase.from('exam_assignment').select('*, exam_master(*), class(name)').eq('assignment_id', assignmentId).single(),
          supabase.from('student_answer').select('answer_id, question_id, grading_code, student_input, earned_score').eq('exam_assignment_id', assignmentId)
        ]);

        const em = Array.isArray(aData.exam_master) ? aData.exam_master[0] : aData.exam_master;
        const isAdm = Boolean(em?.exam_type && (em.exam_type.includes('입학테스트') || em.exam_type.includes('진단평가')));
        setStudentInfo(stuData);
        setHomeworkInfo({ homework_title: em.title, class: aData.class, textbook: { title: em.exam_type || '학습지' }, exam_type: em.exam_type });
        setHwResult({ status: aData.status, hw_result_id: aData.assignment_id }); 
        
        const { data: items } = await supabase.from('exam_item').select('question_id, sort_order, assigned_score').eq('exam_id', em.exam_id).order('sort_order');
        const qIds = items?.map(i => i.question_id) || [];
        
        let qs: any[] = [];
        if (qIds.length > 0) {
          const { data } = await supabase.from('question_db').select('*').in('question_id', qIds);
          qs = data || [];
        }
        
        const sortedQs = items?.map(item => {
          const q = qs.find(q => String(q.question_id) === String(item.question_id));
          return q ? { ...q, tq_id: q.question_id, item_assigned_score: item.assigned_score } : null; 
        }).filter(Boolean) || [];

        const userMergedTextQuestions = extractMergedQuestionGroups(em.layout_settings);

        const customGroupMap = new Map<string, string>();
        userMergedTextQuestions.forEach((arr, idx) => {
            const gId = `custom_group_${idx}`;
            arr.forEach(qid => customGroupMap.set(String(qid), gId));
        });

        const groupMap = new Map(); const builtGroups: any[] = [];
        sortedQs.forEach((q: any) => {
            let gId = customGroupMap.get(String(q.question_id));
            let isMerged = !!gId;
            if (!gId) {
              const parsed = parseQNum(q.question_number);
              const pageKey = String(q.page_number || q.final_printed_page || q.detected_page_num || '');
              const bookKey = String(q.book_name || q.pdf_source || '');
              if (parsed.paren > 0 && parsed.main !== 99999) {
                gId = `paren_group_${bookKey}_${pageKey}_${parsed.main}_${parsed.dash}`;
                isMerged = true;
              } else {
                gId = `single_${q.question_id}_${Math.random()}`;
              }
            }
            
            if (!groupMap.has(gId)) { 
              const newG = { 
                 id: gId, items: [], 
                 is_merged_text: isMerged 
              }; 
              groupMap.set(gId, newG); 
              builtGroups.push(newG); 
            }
            groupMap.get(gId).items.push(q);
        });

        const baseGroupScore = 100 / (builtGroups.length || 1);
        let mainNum = 1;
        builtGroups.forEach(g => {
            g.displayNum = mainNum++;
            if (g.items.length <= 1) g.is_merged_text = false;
            const explicitMax = Math.max(...g.items.map((i: any) => parseFloat(i.item_assigned_score) || 0));
            const groupMaxScore = (isAdm && explicitMax > 0) ? explicitMax : baseGroupScore;
            const subScore = groupMaxScore / (g.items.length || 1);
            g.items.forEach((item: any, i: number) => {
                 item.displayQNum = g.items.length > 1 ? `${g.displayNum}. (${i + 1})` : `${g.displayNum}`;
                 item.assigned_score = subScore;
            });
        });
        
        setGroups(builtGroups);

        const initialGrading: Record<any, GradeCode | null> = {};
        const initialInputMap: Record<any, string | null> = {};

        ansData?.forEach(a => { 
          if(a.grading_code) initialGrading[a.question_id] = a.grading_code as GradeCode; 
          if(a.student_input) initialInputMap[a.question_id] = a.student_input;
        });
        
        setGradingMap(initialGrading);
        setStudentInputMap(initialInputMap);

        // 기존에 잘못 계산되어 저장된 earned_score 및 total_score 자동 보정
        const flatBuilt = builtGroups.reduce((acc: any[], g: any) => acc.concat(g.items), []);
        let expectedTotal = 0;
        let gradedCnt = 0;
        const staleAnswerUpdates: { answer_id: any; earned_score: number; is_correct: boolean }[] = [];

        flatBuilt.forEach((q: any) => {
          const code = initialGrading[q.tq_id];
          if (code) {
            gradedCnt++;
            const { newEarned, isCorrectEq } = calcScoreRatio(code, q.assigned_score, metaMap, isAdm);
            expectedTotal += newEarned;
            const dbAns = ansData?.find((a: any) => String(a.question_id) === String(q.tq_id));
            if (dbAns && dbAns.answer_id && Math.abs((Number(dbAns.earned_score) || 0) - newEarned) > 0.001) {
              staleAnswerUpdates.push({ answer_id: dbAns.answer_id, earned_score: newEarned, is_correct: isCorrectEq });
            }
          }
        });

        const roundedExpectedTotal = roundScore(expectedTotal);
        if (staleAnswerUpdates.length > 0) {
          Promise.all(
            staleAnswerUpdates.map(u =>
              supabase.from('student_answer').update({ earned_score: u.earned_score, is_correct: u.is_correct }).eq('answer_id', u.answer_id)
            )
          ).catch(() => {});
        }
        if (gradedCnt > 0 && Math.abs((Number(aData.total_score) || 0) - roundedExpectedTotal) > 0.01) {
          supabase.from('exam_assignment').update({ total_score: roundedExpectedTotal }).eq('assignment_id', assignmentId).then(() => {});
        }

        setIsLoading(false);
        return;
      }

      const [ { data: stuData }, { data: hwData }, { data: resData }, { data: ansData } ] = await Promise.all([
        supabase.from('student').select('name, grade').eq('student_id', studentId).single(),
        supabase.from('homework_assignment').select('*, textbook(title), class(name)').eq('homework_id', homeworkId).single(),
        supabase.from('student_homework_result').select('*').eq('homework_id', homeworkId).eq('student_id', studentId).maybeSingle(),
        supabase.from('student_homework_answer').select('hw_answer_id, tq_id, grading_code, student_input, earned_score').eq('homework_id', homeworkId).eq('student_id', studentId)
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
            .in('tq_id', tqIds);

          tqs?.sort((a: any, b: any) => {
            const qA_db = a.question_db || {};
            const qB_db = b.question_db || {};
            
            const pageA = parseInt(a.page_number || qA_db.page_number || qA_db.final_printed_page || qA_db.detected_page_num || '0', 10) || 0;
            const pageB = parseInt(b.page_number || qB_db.page_number || qB_db.final_printed_page || qB_db.detected_page_num || '0', 10) || 0;
            if (pageA !== pageB) return pageA - pageB;
            
            const qA = parseQNum(a.question_number || qA_db.question_number);
            const qB = parseQNum(b.question_number || qB_db.question_number);
            
            if (qA.main !== qB.main) return qA.main - qB.main;
            if (qA.dash !== qB.dash) return qA.dash - qB.dash;
            if (qA.paren !== qB.paren) return qA.paren - qB.paren;
            
            return qA.orig.localeCompare(qB.orig, undefined, { numeric: true });
          });
          
          const groupMap = new Map<string, any>();
          const builtGroups: any[] = [];
          tqs?.forEach((tq: any) => {
              const q = tq.question_db || {};
              const pageNum = tq.page_number || q.page_number || q.final_printed_page || q.detected_page_num || '';
              const qNumStr = tq.question_number || q.question_number;
              const parsed = parseQNum(qNumStr);
              const item = { ...q, tq_id: tq.tq_id, question: tq.question || q.question, answer: tq.answer || q.answer, page_number: pageNum, question_number: qNumStr };

              let gId = '';
              let isMerged = false;
              if (tq.parent_tq_id) {
                gId = `parent_tq_${tq.parent_tq_id}`;
                isMerged = true;
              } else if (parsed.paren > 0 && parsed.main !== 99999) {
                gId = `paren_tq_${pageNum}_${parsed.main}_${parsed.dash}`;
                isMerged = true;
              } else {
                gId = `single_${tq.tq_id}`;
              }

              if (!groupMap.has(gId)) {
                const newG = { id: gId, is_merged_text: isMerged, items: [] as any[] };
                groupMap.set(gId, newG);
                builtGroups.push(newG);
              }
              groupMap.get(gId)!.items.push(item);
          });

          const baseGroupScore = 100 / (builtGroups.length || 1);
          let mainNum = 1;
          builtGroups.forEach(g => {
            g.displayNum = mainNum++;
            if (g.items.length <= 1) g.is_merged_text = false;
            const subScore = baseGroupScore / (g.items.length || 1);
            g.items.forEach((item: any, i: number) => {
              item.displayQNum = g.items.length > 1 ? `${g.displayNum}. (${i + 1})` : `${g.displayNum}`;
              item.assigned_score = subScore;
            });
          });
          
          setGroups(builtGroups);
          
          const initialGrading: Record<any, GradeCode | null> = {};
          const initialInputMap: Record<any, string | null> = {};

          if (ansData && ansData.length > 0) {
            ansData.forEach(a => { 
              if (a.grading_code) initialGrading[a.tq_id] = a.grading_code as GradeCode; 
              if (a.student_input) initialInputMap[a.tq_id] = a.student_input;
            });
          } else if (resData && resData.incorrect_questions) {
            const inc = safeParseIds(resData.incorrect_questions);
            tqIds.forEach(id => {
              if (inc.includes(id)) initialGrading[id] = 'X';
              else if (resData.status === '채점완료') initialGrading[id] = 'O';
            });
          }
          
          setGradingMap(initialGrading);
          setStudentInputMap(initialInputMap);
        }
      }
    } catch (e) {
      console.error(e);
      alert("데이터를 불러오는 중 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const updateHomeworkResult = async (newMap: Record<any, GradeCode | null>) => {
    let correctCount = 0; 
    let gradedCount = 0;
    let totalScoreSum = 0;
    const incorrectIds: any[] = [];
    const flatQuestions = groups.reduce((acc, g) => acc.concat(g.items), []);
    const totalGroups = groups.length || 1;
    const defaultScore = 100 / (flatQuestions.length || 1);
    const isAdm = Boolean(homeworkInfo?.exam_type && (homeworkInfo.exam_type.includes('입학테스트') || homeworkInfo.exam_type.includes('진단평가')));
    
    flatQuestions.forEach((q: any) => {
      const m = newMap[q.tq_id];
      if (m) {
        gradedCount++;
        const assignedScore = q.assigned_score ?? (100 / totalGroups);
        const { newEarned, isCorrectEq } = calcScoreRatio(m, assignedScore || defaultScore, gradingCodeMetaRef.current, isAdm);
        totalScoreSum += newEarned;
        if (['O', 'TO', 'RO'].includes(m as string) || isCorrectEq) correctCount++;
        if (['X', 'TX', '☆', 'B'].includes(m as string)) incorrectIds.push(q.tq_id);
      }
    });

    let newStatus = '미제출';
    if (gradedCount > 0) newStatus = '진행중';
    if (gradedCount === flatQuestions.length && flatQuestions.length > 0) newStatus = '채점완료';

    if (isExamHw && assignmentId) {
      const calculatedScore = roundScore(totalScoreSum);
      await supabase.from('exam_assignment').update({ 
        status: newStatus,
        total_score: calculatedScore 
      }).eq('assignment_id', assignmentId);
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

  const handleGrade = async (tqId: any, clickedMark: GradeCode) => {
    const isCanceling = gradingMap[tqId] === clickedMark;
    const nextMark = isCanceling ? null : clickedMark;

    const newMap = { ...gradingMap, [tqId]: nextMark };
    setGradingMap(newMap);
    setSaveStatus("저장 중...");

    try {
      const flatQuestions = groups.reduce((acc, g) => acc.concat(g.items), []);
      const totalQ = flatQuestions.length || 1;
      const targetQ = flatQuestions.find((q: any) => String(q.tq_id) === String(tqId));
      const assignedScore = targetQ?.assigned_score ?? (100 / totalQ);
      const isAdm = Boolean(homeworkInfo?.exam_type && (homeworkInfo.exam_type.includes('입학테스트') || homeworkInfo.exam_type.includes('진단평가')));

      const { newEarned: earnedScore, isCorrectEq } = calcScoreRatio(nextMark, assignedScore, gradingCodeMetaRef.current, isAdm);
      const isCorrect = nextMark ? (['O', 'TO', 'RO'].includes(nextMark) || isCorrectEq) : false;
      const isIncorrect = nextMark ? ['X', 'TX', '☆', 'B'].includes(nextMark) : false;

      const dynamicSourceType = isExamHw ? (homeworkInfo?.exam_type || '시험지') : '교재과제';

      if (isExamHw && assignmentId) {
        const [ { data: existingA }, { data: existingI } ] = await Promise.all([
          supabase.from('student_answer').select('answer_id').eq('exam_assignment_id', assignmentId).eq('question_id', tqId).maybeSingle(),
          supabase.from('student_incorrect_record').select('record_id').eq('student_id', studentId).eq('question_id', tqId).maybeSingle()
        ]);

        if (existingA) {
          await supabase.from('student_answer').update({ grading_code: nextMark, is_correct: isCorrect, earned_score: earnedScore }).eq('answer_id', existingA.answer_id);
        } else if (nextMark) {
          await supabase.from('student_answer').insert({ exam_assignment_id: assignmentId, student_id: studentId, question_id: tqId, grading_code: nextMark, is_correct: isCorrect, earned_score: earnedScore });
        }

        if (isIncorrect) {
          if (existingI) await supabase.from('student_incorrect_record').update({ status: nextMark, resolved_at: null, source_type: dynamicSourceType }).eq('record_id', existingI.record_id);
          else await supabase.from('student_incorrect_record').insert({ student_id: studentId, question_id: tqId, source_type: dynamicSourceType, status: nextMark });
        } else if (isCorrect && existingI) {
          await supabase.from('student_incorrect_record').update({ status: nextMark, resolved_at: new Date().toISOString(), source_type: dynamicSourceType }).eq('record_id', existingI.record_id);
        } else if (isCanceling && existingI) {
          await supabase.from('student_incorrect_record').delete().eq('record_id', existingI.record_id);
        }
      } else {
        const [ { data: existingA }, { data: existingI } ] = await Promise.all([
          supabase.from('student_homework_answer').select('hw_answer_id').eq('homework_id', homeworkId).eq('student_id', studentId).eq('tq_id', tqId).maybeSingle(),
          supabase.from('student_incorrect_record').select('record_id').eq('student_id', studentId).eq('tq_id', tqId).maybeSingle()
        ]);

        if (existingA) {
          await supabase.from('student_homework_answer').update({ grading_code: nextMark, is_correct: isCorrect, earned_score: earnedScore }).eq('hw_answer_id', existingA.hw_answer_id);
        } else if (nextMark) {
          await supabase.from('student_homework_answer').insert({ homework_id: Number(homeworkId), student_id: studentId, tq_id: tqId, grading_code: nextMark, is_correct: isCorrect, earned_score: earnedScore });
        }

        if (isIncorrect) {
          if (existingI) await supabase.from('student_incorrect_record').update({ status: nextMark, resolved_at: null, source_type: dynamicSourceType }).eq('record_id', existingI.record_id);
          else await supabase.from('student_incorrect_record').insert({ student_id: studentId, tq_id: tqId, source_type: dynamicSourceType, status: nextMark });
        } else if (isCorrect && existingI) {
          await supabase.from('student_incorrect_record').update({ status: nextMark, resolved_at: new Date().toISOString(), source_type: dynamicSourceType }).eq('record_id', existingI.record_id);
        } else if (isCanceling && existingI) {
          await supabase.from('student_incorrect_record').delete().eq('record_id', existingI.record_id);
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
      const isAdm = Boolean(homeworkInfo?.exam_type && (homeworkInfo.exam_type.includes('입학테스트') || homeworkInfo.exam_type.includes('진단평가')));
      
      const totalQ = flatQuestions.length || 1;
      const dynamicSourceType = isExamHw ? (homeworkInfo?.exam_type || '시험지') : '교재과제';

      if (isExamHw && assignmentId) {
        const [ { data: existingAns }, { data: existingInc } ] = await Promise.all([
          supabase.from('student_answer').select('answer_id, question_id').eq('exam_assignment_id', assignmentId).eq('student_id', studentId),
          supabase.from('student_incorrect_record').select('record_id, question_id').eq('student_id', studentId)
        ]);

        const ansInserts: any[] = []; const ansUpdates: any[] = [];
        const incInserts: any[] = []; const incUpdates: any[] = [];

        targets.forEach((q: any) => {
          const qAssigned = q.assigned_score ?? (100 / totalQ);
          const { newEarned: earnedScore, isCorrectEq } = calcScoreRatio(mark, qAssigned, gradingCodeMetaRef.current, isAdm);
          const itemCorrect = isCorrect || isCorrectEq;

          const exA = existingAns?.find(a => String(a.question_id) === String(q.tq_id));
          if (exA) ansUpdates.push({ answer_id: exA.answer_id, grading_code: mark, is_correct: itemCorrect, earned_score: earnedScore });
          else ansInserts.push({ exam_assignment_id: assignmentId, student_id: studentId, question_id: q.tq_id, grading_code: mark, is_correct: itemCorrect, earned_score: earnedScore });

          const exI = existingInc?.find(i => String(i.question_id) === String(q.tq_id));
          if (isIncorrect) {
            if (exI) incUpdates.push({ record_id: exI.record_id, status: mark, resolved_at: null, source_type: dynamicSourceType });
            else incInserts.push({ student_id: studentId, question_id: q.tq_id, source_type: dynamicSourceType, status: mark });
          } else if (itemCorrect && exI) {
            incUpdates.push({ record_id: exI.record_id, status: mark, resolved_at: new Date().toISOString(), source_type: dynamicSourceType });
          }
        });

        if (ansInserts.length > 0) await supabase.from('student_answer').insert(ansInserts);
        for(const u of ansUpdates) await supabase.from('student_answer').update({ grading_code: u.grading_code, is_correct: u.is_correct, earned_score: u.earned_score }).eq('answer_id', u.answer_id);
        
        if (incInserts.length > 0) await supabase.from('student_incorrect_record').insert(incInserts);
        for(const u of incUpdates) await supabase.from('student_incorrect_record').update({ status: u.status, resolved_at: u.resolved_at, source_type: u.source_type }).eq('record_id', u.record_id);

      } else {
        const [ { data: existingAns }, { data: existingInc } ] = await Promise.all([
          supabase.from('student_homework_answer').select('hw_answer_id, tq_id').eq('homework_id', homeworkId).eq('student_id', studentId),
          supabase.from('student_incorrect_record').select('record_id, tq_id').eq('student_id', studentId)
        ]);

        const ansInserts: any[] = []; const ansUpdates: any[] = [];
        const incInserts: any[] = []; const incUpdates: any[] = [];

        targets.forEach((q: any) => {
          const qAssigned = q.assigned_score ?? (100 / totalQ);
          const { newEarned: earnedScore, isCorrectEq } = calcScoreRatio(mark, qAssigned, gradingCodeMetaRef.current, false);
          const itemCorrect = isCorrect || isCorrectEq;

          const exA = existingAns?.find(a => String(a.tq_id) === String(q.tq_id));
          if (exA) ansUpdates.push({ hw_answer_id: exA.hw_answer_id, grading_code: mark, is_correct: itemCorrect, earned_score: earnedScore });
          else ansInserts.push({ homework_id: Number(homeworkId), student_id: studentId, tq_id: q.tq_id, grading_code: mark, is_correct: itemCorrect, earned_score: earnedScore });

          const exI = existingInc?.find(i => String(i.tq_id) === String(q.tq_id));
          if (isIncorrect) {
            if (exI) incUpdates.push({ record_id: exI.record_id, status: mark, resolved_at: null, source_type: dynamicSourceType });
            else incInserts.push({ student_id: studentId, tq_id: q.tq_id, source_type: dynamicSourceType, status: mark });
          } else if (itemCorrect && exI) {
            incUpdates.push({ record_id: exI.record_id, status: mark, resolved_at: new Date().toISOString(), source_type: dynamicSourceType });
          }
        });

        if (ansInserts.length > 0) await supabase.from('student_homework_answer').insert(ansInserts);
        for(const u of ansUpdates) await supabase.from('student_homework_answer').update({ grading_code: u.grading_code, is_correct: u.is_correct, earned_score: u.earned_score }).eq('hw_answer_id', u.hw_answer_id);
        
        if (incInserts.length > 0) await supabase.from('student_incorrect_record').insert(incInserts);
        for(const u of incUpdates) await supabase.from('student_incorrect_record').update({ status: u.status, resolved_at: u.resolved_at, source_type: u.source_type }).eq('record_id', u.record_id);
      }

      await updateHomeworkResult(newMap);

      setSaveStatus("✅ 일괄 저장 완료");
      setTimeout(() => setSaveStatus(""), 2000);
    } catch (e) {
      console.error(e); setSaveStatus("❌ 저장 실패");
    }
  };

  if (isLoading) {
    return <div className="h-screen flex items-center justify-center bg-slate-50 font-bold text-slate-400">데이터를 불러오는 중입니다...</div>;
  }

  const flatQuestions = groups.reduce((acc, g) => acc.concat(g.items), []);
  const totalQ = flatQuestions.length;
  const gradedQ = Object.values(gradingMap).filter(v => v !== null).length;
  const isAdmExam = Boolean(homeworkInfo?.exam_type && (homeworkInfo.exam_type.includes('입학테스트') || homeworkInfo.exam_type.includes('진단평가')));
  const liveScoreSum = flatQuestions.reduce((acc: number, q: any) => {
    const m = gradingMap[q.tq_id];
    if (!m) return acc;
    const qAssigned = q.assigned_score ?? (100 / (totalQ || 1));
    return acc + calcScoreRatio(m, qAssigned, gradingCodeMeta, isAdmExam).newEarned;
  }, 0);
  const liveScore = roundScore(liveScoreSum);

  return (
    <div className="flex flex-col h-screen bg-slate-100 overflow-hidden font-pretendard">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="text-white hover:text-blue-200 flex items-center gap-2 font-bold text-lg mb-2 transition-colors bg-blue-900/40 px-4 py-2 rounded-xl border border-blue-800/50 w-fit shadow-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg> 뒤로가기
          </button>
          <div className="w-px h-6 bg-slate-300"></div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-brand text-white text-xs px-2 py-0.5 rounded font-bold">{homeworkInfo?.class?.name || '반 미지정'}</span>
              <span className="text-slate-500 font-bold text-xs">{studentInfo?.name} 학생 ({studentInfo?.grade || '-'})</span>
            </div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight leading-none">
              📚 {homeworkInfo?.homework_title} <span className="text-sm text-slate-400 font-bold ml-2">실시간 쾌속 채점</span>
            </h1>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {saveStatus && (
            <div className={`px-4 py-1.5 rounded-full text-sm font-bold shadow-sm transition-all ${saveStatus.includes('✅') ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : saveStatus.includes('❌') ? 'bg-rose-100 text-rose-700 border border-rose-200' : 'bg-amber-100 text-amber-700 border border-amber-200 animate-pulse'}`}>
              {saveStatus}
            </div>
          )}
          <div className="text-right bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-200">
            <div className="text-xs font-bold text-emerald-600 mb-0.5">현재 실시간 총점</div>
            <div className="font-bold text-lg text-emerald-700 leading-none">{liveScore}점</div>
          </div>
          <div className="text-right mr-2 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
            <div className="text-xs font-bold text-slate-500 mb-0.5">채점 완료 진행률</div>
            <div className="font-bold text-lg text-brand leading-none">{gradedQ} / {totalQ}</div>
          </div>
        </div>
      </header>

      <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 shrink-0 flex justify-between items-center shadow-inner">
        <span className="text-xs font-bold text-slate-500">항목명: <span className="text-slate-800">{homeworkInfo?.textbook?.title || '-'}</span> <span className="ml-2 text-slate-400">(총 {groups.length}문항 / 세부 {totalQ}문항)</span></span>
        <div className="flex gap-2">
          <button onClick={handleRefreshMathJax} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-xs font-bold hover:bg-indigo-100 transition-colors shadow-sm">
            🔄 수식 새로고침
          </button>
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
                        <MathText isDiv className="font-myungjo font-semibold text-[16px] text-slate-800 leading-[2.2] tracking-wide break-keep" html={formatMathTextForWeb(common)} />
                     </div>
                  )}

                  {g.items.map((q: any, subIdx: number) => {
                    const mark = gradingMap[q.tq_id];
                    const hasStudentInput = studentInputMap[q.tq_id] && studentInputMap[q.tq_id] !== '미입력';
                    
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
                        {/* 🌟 수정된 왼쪽 문항정보 레이아웃 */}
                        <div className="flex flex-col items-center justify-start shrink-0 w-[72px] gap-1.5 pt-1">
                          <span className="text-brand font-bold text-[18px] whitespace-nowrap leading-none">{q.displayQNum}</span>
                          
                          <div className="flex flex-col items-center gap-0.5 w-full mt-1">
                            {q.assigned_score !== undefined && (
                              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200 truncate w-full text-center" title="문항 배점">
                                {roundScore(q.assigned_score)}점
                              </span>
                            )}
                            <span className="text-xs font-bold text-slate-400 bg-slate-100 px-1 py-0.5 rounded border border-slate-200 truncate w-full text-center" title="출처 페이지">
                              {q.page_number || q.final_printed_page || q.detected_page_num || '-'}p
                            </span>
                            {q.question_number && (
                              <span className="text-xs font-bold text-slate-400 bg-slate-100 px-1 py-0.5 rounded border border-slate-200 truncate w-full text-center" title="실제 문제 번호">
                                No.{q.question_number}
                              </span>
                            )}
                          </div>
                          
                          <button 
                            onClick={() => setModalStudentAns({ qNum: q.displayQNum || q.question_number, input: studentInputMap[q.tq_id] || null })} 
                            className={`text-xs font-bold py-1 px-1.5 rounded shadow-sm transition-colors w-full mt-auto flex items-center justify-center gap-1 ${hasStudentInput ? 'bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-600' : 'bg-slate-50 border border-slate-200 text-slate-400 hover:bg-slate-100'}`}
                            title="학생이 제출한 필기/텍스트 답안 보기"
                          >
                            📝 답안
                          </button>
                        </div>

                        <QuestionContent 
                          textToRender={formatMathTextForWeb(textToRender)} 
                          imageUrl={getCleanUrl(q.image_url)} 
                          answer={q.answer ? `$ ${formatMathTextForWeb(q.answer)} $` : ''} 
                        />

                        <div className="flex items-center justify-center shrink-0 px-2">
                           <button onClick={() => setModalQ(q)} className="w-[42px] h-[48px] flex flex-col items-center justify-center gap-0.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg shadow-sm transition-colors" title="상세 해설 보기">
                             <span className="text-[14px] leading-none">🔍</span>
                             <span className="text-xs font-bold leading-none">풀이</span>
                           </button>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5 shrink-0 w-[120px]">
                          <button onClick={() => handleGrade(q.tq_id, 'O')} className={`h-8 rounded font-bold text-xs transition-all ${mark === 'O' ? 'bg-[#10b981] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-emerald-50 hover:text-[#10b981] border border-slate-200'}`}>O</button>
                          <button onClick={() => handleGrade(q.tq_id, 'X')} className={`h-8 rounded font-bold text-xs transition-all ${mark === 'X' ? 'bg-[#ef4444] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-rose-50 hover:text-[#ef4444] border border-slate-200'}`}>X</button>
                          <button onClick={() => handleGrade(q.tq_id, 'TO')} className={`h-8 rounded font-bold text-xs transition-all ${mark === 'TO' ? 'bg-[#14b8a6] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-teal-50 hover:text-[#14b8a6] border border-slate-200'}`}>TO</button>
                          <button onClick={() => handleGrade(q.tq_id, 'TX')} className={`h-8 rounded font-bold text-xs transition-all ${mark === 'TX' ? 'bg-[#f97316] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-orange-50 hover:text-[#f97316] border border-slate-200'}`}>TX</button>
                          <button onClick={() => handleGrade(q.tq_id, 'RO')} className={`h-8 rounded font-bold text-xs transition-all ${mark === 'RO' ? 'bg-[#3b82f6] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-blue-50 hover:text-[#3b82f6] border border-slate-200'}`}>RO</button>
                          <button onClick={() => handleGrade(q.tq_id, '☆')} className={`h-8 rounded font-bold text-sm transition-all ${mark === '☆' ? 'bg-[#f59e0b] text-white shadow transform scale-105' : 'bg-white text-slate-400 hover:bg-amber-50 hover:text-[#f59e0b] border border-slate-200'}`}>☆</button>
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
            onClick={() => router.back()} 
            className="bg-brand hover:bg-blue-900 text-white font-bold text-[15px] py-4 px-12 rounded-xl shadow-lg transition-transform hover:-translate-y-1 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            이전 화면으로 돌아가기
          </button>
        </div>
      </main>

      {/* 해설 보기 팝업 */}
      {modalQ && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-brand p-4 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-lg flex items-center gap-2"><span>🔍</span> {modalQ.displayQNum || modalQ.question_number}번 문항 상세</h2>
              <button onClick={() => setModalQ(null)} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50 space-y-6">
              
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-3 flex items-center gap-2">
                  <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-xs">질문</span>
                </h3>
                <MathText isDiv className="math-text text-slate-700 font-medium whitespace-pre-wrap leading-relaxed" html={formatMathTextForWeb(modalQ.question || modalQ.text_question || '-').replace(/\n/g, '<br>')} />
                {getCleanUrl(modalQ.image_url) && <img src={getCleanUrl(modalQ.image_url)} className="max-w-full mt-4 rounded-lg border border-slate-200" alt="Question" />}
              </div>
              
              <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm">
                <h3 className="font-bold text-blue-800 border-b border-blue-200 pb-2 mb-3 flex items-center gap-2">
                  <span className="bg-blue-200 text-blue-800 px-2 py-0.5 rounded text-xs">정답</span>
                </h3>
                <MathText isDiv className="math-text text-blue-700 font-bold text-lg whitespace-pre-wrap" html={`$ ${formatMathTextForWeb(modalQ.answer || '-')} $`} />
              </div>

            </div>
            <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0">
              <button onClick={() => setModalQ(null)} className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg shadow-sm">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 학생 답안 팝업 모달 */}
      {modalStudentAns && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-indigo-600 p-4 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-lg flex items-center gap-2"><span>📝</span> {modalStudentAns.qNum}번 학생 제출 답안</h2>
              <button onClick={() => setModalStudentAns(null)} className="text-white hover:text-indigo-200 font-bold text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto custom-scroll flex-1 bg-slate-50 flex justify-center items-center text-center">
              {!modalStudentAns.input || modalStudentAns.input === '미입력' ? (
                <span className="text-slate-400 font-bold text-sm">제출된 답안이 없습니다 (미입력).</span>
              ) : (modalStudentAns.input.startsWith('data:image') || /\.(jpeg|jpg|gif|png|svg|webp)$/i.test(modalStudentAns.input) || /^[\w-]+\.[\w]+$/.test(modalStudentAns.input) || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(modalStudentAns.input)) ? (
                <img src={getCleanUrl(modalStudentAns.input)} alt="student_answer" className="max-w-full rounded-lg border border-slate-200 shadow-sm mix-blend-multiply" />
              ) : (
                <MathText isDiv className="math-text text-slate-800 font-bold text-xl whitespace-pre-wrap" html={formatMathTextForWeb(modalStudentAns.input)} />
              )}
            </div>
            <div className="p-4 bg-white border-t border-slate-200 flex justify-end shrink-0">
              <button onClick={() => setModalStudentAns(null)} className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg shadow-sm transition-colors">닫기</button>
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
