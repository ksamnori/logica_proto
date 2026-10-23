// src/app/clinic/viewer/hooks/useClinicDataFetch.ts
import { useState, useCallback } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { resolvePendingHomeworkQuestions } from '@/lib/clinicHomework';
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
import { formatMathTextForWeb, getCleanUrl, safeParseOptions, combineDbHints, textbookHintFields, hydrateHintState } from '../utils';

interface UseClinicDataFetchProps {
  supabaseClient: SupabaseClient;
  studentInfo: { id: string; name: string; classes: string[] };
  params: { round: number; className: string; weekType: string; assignmentId: string; homeworkIdsStr: string; assignmentIdsStr: string; overdue: boolean; retry?: boolean };
  forceUpdate: () => void;
  refs: {
    studentAnswers: React.MutableRefObject<Record<number, string | null>>;
    studentDrawings: React.MutableRefObject<Record<number, string>>;
    keypadAnswers: React.MutableRefObject<Record<number, string>>;
    answerModes: React.MutableRefObject<Record<number, 'keypad' | 'pen'>>;
    qBoxStatus: React.MutableRefObject<Record<number, 'correct_blue' | 'correct_yellow' | 'retry_yellow' | 'wrong_red'>>;
    totalQuestionsInRoundRef: React.MutableRefObject<number>;
    hintState: React.MutableRefObject<Record<number, any>>;
    correctSolvedCountRef: React.MutableRefObject<number>;
    examAssignmentTotalsRef: React.MutableRefObject<Record<string, number>>;
  };
}

const NON_TIMED_EXAM_TYPES = ['과제', '과제프린트', '오답프린트', '오답', '오답유사', '과제오답유사', '미완료과제'];

export function useClinicDataFetch({ supabaseClient, studentInfo, params, forceUpdate, refs }: UseClinicDataFetchProps) {
  const [questions, setQuestions] = useState<any[]>([]);
  const [pendingQCount, setPendingQCount] = useState<string>("로딩 중...");
  const [globalExamTitle, setGlobalExamTitle] = useState('과제');
  const [isTimedRound, setIsTimedRound] = useState(false);

  const loadExistingAnswers = async (sId: string, qs: any[], baseTitle: string) => {
    if (qs.length === 0) return;
    const examAssignIds = [...new Set(qs.map(q => q.examAssignmentId).filter(Boolean))];
    const hwIds = [...new Set(qs.map(q => q.homework_id).filter(Boolean))];

    const [examAnsRes, hwAnsRes] = await Promise.all([
      examAssignIds.length > 0 ? supabaseClient.from('student_answer').select('question_id, exam_assignment_id, student_input, grading_code').in('exam_assignment_id', examAssignIds).eq('student_id', sId) : Promise.resolve({ data: [] }),
      hwIds.length > 0 ? supabaseClient.from('student_homework_answer').select('tq_id, homework_id, student_input, grading_code').in('homework_id', hwIds).eq('student_id', sId) : Promise.resolve({ data: [] })
    ]);

    const examAns = examAnsRes.data || [];
    const hwAns = hwAnsRes.data || [];
    let correctCount = 0;
    let attemptedCount = 0; 

    qs.forEach((qItem, i) => {
      let existing = null;
      if (qItem.examAssignmentId && qItem.question_id) {
        existing = examAns.find((a: any) => String(a.exam_assignment_id) === String(qItem.examAssignmentId) && String(a.question_id) === String(qItem.question_id));
      } else if (qItem.homework_id && qItem.tq_id) {
        existing = hwAns.find((a: any) => String(a.homework_id) === String(qItem.homework_id) && String(a.tq_id) === String(qItem.tq_id));
      }

      if (existing) {
        const input = existing.student_input;
        if (input && input !== '미입력' && input !== '[손글씨 답안]') {
          refs.studentAnswers.current[i] = input;
          if (String(input).startsWith('data:image')) {
            refs.studentDrawings.current[i] = input;
            refs.answerModes.current[i] = 'pen';
          } else {
            refs.keypadAnswers.current[i] = input;
            refs.answerModes.current[i] = 'keypad';
          }
        }

        const code = existing.grading_code;
        if (code) {
          if (['O', 'X', 'TO', 'RO', 'TX', 'T', '☆'].includes(code)) {
              attemptedCount++;
          }
          if (code === 'O') {
            refs.qBoxStatus.current[i] = 'correct_blue';
            correctCount++;
          } else if (code === 'TO' || code === 'RO') {
            refs.qBoxStatus.current[i] = 'correct_yellow'; 
            correctCount++;
          } else if (code === 'X' || code === 'TX' || code === 'B' || code === '☆') {
            refs.qBoxStatus.current[i] = 'wrong_red';
          }
        }
      }
    });

    refs.correctSolvedCountRef.current = correctCount;
    const remainCount = Math.max(0, qs.length - attemptedCount);
    
    setPendingQCount(`${baseTitle} : 총 ${qs.length}문항 (남은 문제: ${remainCount}문항)`);
    forceUpdate();
  };

  const fetchHomeworkSimilarIncorrect = async (sId: string) => {
    try {
      const { data: records } = await supabaseClient.from('student_incorrect_record').select('record_id, tq_id, question_id, source_type').eq('student_id', sId).eq('source_type', '과제오답').is('resolved_at', null);
      if (!records || records.length === 0) {
        setIsTimedRound(false);
        setPendingQCount(`이번 주 시험/과제오답유사: 없음`);
        setQuestions([]);
        return;
      }

      let qIds = [...new Set(records.filter((r:any) => r.question_id).map((r:any) => r.question_id))];
      
      const tqIds = [...new Set(records.filter((r:any) => r.tq_id).map((r:any) => r.tq_id))]
        .filter(id => id && (typeof id === 'number' || (typeof id === 'string' && !id.includes('-') && !isNaN(Number(id)))))
        .map(Number);

      const uuidFromTqIds = [...new Set(records.filter((r:any) => r.tq_id).map((r:any) => r.tq_id))]
        .filter(id => id && typeof id === 'string' && id.includes('-'));

      if (uuidFromTqIds.length > 0) {
        qIds = [...new Set([...qIds, ...uuidFromTqIds])];
      }

      const [{ data: qDbRows }, { data: tqRows }] = await Promise.all([
        qIds.length > 0 ? supabaseClient.from('question_db').select('*').in('question_id', qIds) : Promise.resolve({ data: [] }),
        tqIds.length > 0 ? supabaseClient.from('textbook_question').select('*, textbook(book_type, title)').in('tq_id', tqIds) : Promise.resolve({ data: [] }),
      ]);
      
      const tqQIds = (tqRows || []).map((tq: any) => tq.question_id).filter(Boolean);
      const allQIds = [...new Set([...qIds, ...tqQIds])];
      const { data: allQDbRows } = allQIds.length > 0 ? await supabaseClient.from('question_db').select('*').in('question_id', allQIds) : { data: [] };

      const qDbMap = new Map<any, any>((allQDbRows || []).map((qItem:any) => [qItem.question_id, qItem]));
      const tqMap = new Map<any, any>((tqRows || []).map((tq:any) => [tq.tq_id, tq]));

      const mapped: any[] = [];
      records.forEach((r:any) => {
        const isTqIdUuid = r.tq_id && typeof r.tq_id === 'string' && r.tq_id.includes('-');
        const targetQId = isTqIdUuid ? r.tq_id : r.question_id;

        if (targetQId && qDbMap.has(targetQId)) {
          const qItem = qDbMap.get(targetQId);
          const dbHint = combineDbHints(qItem.step_1_concept, qItem.step_2_approach);
          mapped.push({
            index: mapped.length, uid: 'rq' + mapped.length + '_' + Date.now(), record_id: r.record_id, question_id: qItem.question_id,
            source: '과제오답유사', questionText: formatMathTextForWeb(qItem.question),
            imageUrl: getCleanUrl(qItem.image_url), options: safeParseOptions(qItem.options),
            answer: String(qItem.answer || '').trim(), explanation: qItem.explanation || qItem.solution || '',
            hintText: dbHint,
            aiGradable: qItem.ai_gradable !== false, hasHint: true, needsAiHint: !dbHint,
            pageNum: qItem.page_number || qItem.final_printed_page || qItem.detected_page_num,
            questionNum: qItem.question_number
          });
        } else if (!isTqIdUuid && r.tq_id && tqMap.has(r.tq_id)) {
          const tq = tqMap.get(r.tq_id);
          const raw = tq.raw_metadata || {};
          const freshQ: any = qDbMap.get(tq.question_id) || {};
          const dbHint = combineDbHints(freshQ.step_1_concept || raw.step_1_concept, freshQ.step_2_approach || raw.step_2_approach);
          const tbFields = textbookHintFields(tq.textbook?.book_type);
          
          mapped.push({
            index: mapped.length, uid: 'rq' + mapped.length + '_' + Date.now(), record_id: r.record_id, tq_id: tq.tq_id, question_id: tq.question_id,
            source: '과제오답유사', questionText: formatMathTextForWeb(raw.question || '(문제 텍스트 없음)'),
            imageUrl: getCleanUrl(raw.image_url || raw.imageUrl || tq.image_url), options: safeParseOptions(raw.options),
            answer: String(tq.answer || '').trim(), explanation: raw.explanation || raw.solution || '',
            hintText: dbHint || tbFields.hintText,
            hasHint: !!dbHint || tbFields.hasHint,
            needsAiHint: !dbHint && tbFields.needsAiHint,
            bookId: tq.book_id, bookType: tq.textbook?.book_type, bookTitle: tq.textbook?.title,
            aiGradable: tq.ai_gradable !== false,
            pageNum: tq.page_number || freshQ.final_printed_page || freshQ.detected_page_num || raw.page_number || raw.detected_page_num,
            questionNum: tq.question_number || freshQ.question_number || raw.question_number
          });
        }
      });

      if (mapped.length === 0) {
        setIsTimedRound(false);
        setPendingQCount(`이번 주 과제오답유사: 없음`);
        setQuestions([]);
        return;
      }
      
      setIsTimedRound(false);
      setGlobalExamTitle('이번 주 과제오답유사');
      refs.totalQuestionsInRoundRef.current = mapped.length;
      refs.hintState.current = hydrateHintState(sId, mapped);
      
      await loadExistingAnswers(sId, mapped, '이번 주 과제오답유사');
      setQuestions(mapped);
    } catch (e) {
      console.error('fetchHomeworkSimilarIncorrect error:', e);
      setPendingQCount('문제를 불러오지 못했습니다.');
    }
  };

  // 🌟 odd/even 의존성을 없애고 실제 배정된 시험지 종류(exam_type)로 타이머 및 폴백을 자동 판별
  const fetchWeeklyTest = async (sId: string, _week: string, cls: string, assignId: string) => {
    try {
      let matchedExamId = null; let matchedTitle = null; let matchedAssignId = assignId;
      let displayLabel = '시험';
      let matchedMaster: any = null;

      // 1. 지정된 assignmentId가 있으면 우선 조회
      if (matchedAssignId) {
        const { data } = await supabaseClient.from('exam_assignment')
          .select('exam_id, exam_master(title, exam_type, layout_settings, total_questions)')
          .eq('assignment_id', matchedAssignId)
          .eq('student_id', sId)
          .maybeSingle();

        if (data && data.exam_id) {
          matchedExamId = data.exam_id;
          const master: any = Array.isArray(data.exam_master) ? data.exam_master[0] : data.exam_master;
          matchedMaster = master;
          matchedTitle = master?.title;
          displayLabel = master?.exam_type || '시험';
        }
      }

      // 2. 지정된 assignmentId가 없으면 미완료 정규 테스트 -> 오답유사 순으로 탐색
      if (!matchedExamId) {
        const { data: cData } = await supabaseClient.from('class').select('class_id').eq('name', cls).maybeSingle();
        let query = supabaseClient.from('exam_assignment')
          .select('assignment_id, exam_id, exam_master!inner(title, exam_type, layout_settings, total_questions)')
          .eq('student_id', sId)
          .not('exam_master.exam_type', 'in', '("과제", "과제프린트", "오답프린트", "오답", "오답유사", "과제오답유사", "미완료과제")')
          .not('status', 'in', '("제출완료", "채점완료", "완료", "최종완료")');

        if (cData?.class_id) query = query.eq('class_id', cData.class_id);

        const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();

        if (data) {
          matchedAssignId = String(data.assignment_id);
          matchedExamId = data.exam_id;
          const master: any = Array.isArray(data.exam_master) ? data.exam_master[0] : data.exam_master;
          matchedMaster = master;
          matchedTitle = master?.title;
          displayLabel = master?.exam_type || '시험';
        } else {
          // 정규 테스트가 없으면 배정된 오답유사/과제오답유사 시험지가 있는지 확인
          let simQuery = supabaseClient.from('exam_assignment')
            .select('assignment_id, exam_id, exam_master!inner(title, exam_type, layout_settings, total_questions)')
            .eq('student_id', sId)
            .in('exam_master.exam_type', ['오답유사', '과제오답유사'])
            .not('status', 'in', '("제출완료", "채점완료", "완료", "최종완료")');

          if (cData?.class_id) simQuery = simQuery.eq('class_id', cData.class_id);
          const { data: simData } = await simQuery.order('created_at', { ascending: false }).limit(1).maybeSingle();

          if (simData) {
            matchedAssignId = String(simData.assignment_id);
            matchedExamId = simData.exam_id;
            const master: any = Array.isArray(simData.exam_master) ? simData.exam_master[0] : simData.exam_master;
            matchedMaster = master;
            matchedTitle = master?.title;
            displayLabel = master?.exam_type || '과제오답유사';
          }
        }
      }

      // 3. 배정된 시험지가 아예 없으면 과제오답 기록(student_incorrect_record) 폴백 시도
      if (!matchedExamId) {
        return fetchHomeworkSimilarIncorrect(sId);
      }

      const isTimedExam = !NON_TIMED_EXAM_TYPES.includes(displayLabel) && !params.retry;
      setIsTimedRound(isTimedExam);

      setGlobalExamTitle(matchedTitle || `이번 주 ${displayLabel}`);
      const { data: items } = await supabaseClient.from('exam_item').select('*, question_db(*)').eq('exam_id', matchedExamId).order('sort_order', { ascending: true });
      const validItems = (items || []).filter((it:any) => it.question_db);

      if (validItems.length === 0) { setPendingQCount(`이번 주 ${displayLabel}: 문제 없음`); setQuestions([]); return; }

      const { scoreByQuestionId, groupCount } = buildExamQuestionScoreMap(
        validItems,
        matchedMaster?.layout_settings,
        displayLabel,
        validItems.length
      );
      const defaultItemScore = 100 / (groupCount || validItems.length || 1);

      const mapped = validItems.map((it:any, i:number) => {
        const dbHint = combineDbHints(it.question_db.step_1_concept, it.question_db.step_2_approach);
        const qId = it.question_db.question_id;
        return {
          index: i, uid: 'rq' + i + '_' + Date.now(), question_id: qId, record_id: null,
          examAssignmentId: matchedAssignId,
          assigned_score: scoreByQuestionId.get(String(qId)) ?? defaultItemScore,
          source: matchedTitle || `이번 주 ${displayLabel}`, questionText: formatMathTextForWeb(it.question_db.question),
          imageUrl: getCleanUrl(it.question_db.image_url), options: safeParseOptions(it.question_db.options),
          answer: String(it.question_db.answer || '').trim(), explanation: it.question_db.explanation || it.question_db.solution || '',
          hintText: dbHint,
          aiGradable: it.question_db.ai_gradable !== false, hasHint: true, needsAiHint: !dbHint,
          pageNum: it.question_db.page_number || it.question_db.final_printed_page || it.question_db.detected_page_num,
          questionNum: it.question_db.question_number
        };
      });
      refs.totalQuestionsInRoundRef.current = mapped.length;
      refs.hintState.current = hydrateHintState(sId, mapped);

      if (!isTimedExam && matchedAssignId) {
        refs.examAssignmentTotalsRef.current[matchedAssignId] = mapped.length;
      }

      const is60MinTest = ['중간평가', '중간테스트', '분기평가', '분기테스트'].includes(displayLabel) || 
                          ['중간평가', '중간테스트', '분기평가', '분기테스트'].some(k => (matchedTitle || '').includes(k));
      
      if (typeof window !== 'undefined') {
          (window as any).__dynamicTimeLimit = is60MinTest ? 3600 : 1200; 
      }

      const titleBase = matchedTitle || `이번 주 ${displayLabel}`;
      const limitText = is60MinTest ? '60분 제한' : '20분 제한';
      
      await loadExistingAnswers(sId, mapped, isTimedExam ? `${titleBase} (${limitText})` : titleBase);
      setQuestions(mapped);
    } catch (e) {
      console.error('fetchWeeklyTest error:', e);
      setPendingQCount('시험 문제를 불러오지 못했습니다.');
    }
  };

  const fetchAssignedExamQuestions = async (assignId: string) => {
    if (!assignId) return { rows: [], title: null };
    const { data } = await supabaseClient.from('exam_assignment').select('exam_id, exam_master(title, exam_type, layout_settings, total_questions)').eq('assignment_id', assignId).maybeSingle();
    if (!data?.exam_id) return { rows: [], title: null };

    const { data: items } = await supabaseClient.from('exam_item').select('*, question_db(*)').eq('exam_id', data.exam_id).order('sort_order', { ascending: true });
    const validItems = (items || []).filter((it: any) => it.question_db);
    
    const master: any = Array.isArray(data.exam_master) ? data.exam_master[0] : data.exam_master;
    const title = master?.title || null;
    const bookType = master?.exam_type === '오답프린트' ? '오답' : '기타';
    const { scoreByQuestionId, groupCount } = buildExamQuestionScoreMap(
      validItems,
      master?.layout_settings,
      master?.exam_type,
      validItems.length
    );
    const defaultItemScore = 100 / (groupCount || validItems.length || 1);
    
    const rows = validItems.map((it: any) => {
      const dbHint = combineDbHints(it.question_db.step_1_concept, it.question_db.step_2_approach);
      const qId = it.question_db.question_id;
      return {
        examAssignmentId: assignId, question_id: qId,
        assigned_score: scoreByQuestionId.get(String(qId)) ?? defaultItemScore,
        bookId: Number(assignId), bookType, bookTitle: title || '배정된 과제',
        source: title || '배정된 과제', questionText: formatMathTextForWeb(it.question_db.question),
        imageUrl: getCleanUrl(it.question_db.image_url), options: safeParseOptions(it.question_db.options),
        answer: String(it.question_db.answer || '').trim(), explanation: it.question_db.explanation || it.question_db.solution || '',
        hintText: dbHint,
        aiGradable: it.question_db.ai_gradable !== false, hasHint: true, needsAiHint: !dbHint,
        pageNum: it.question_db.page_number || it.question_db.final_printed_page || it.question_db.detected_page_num,
        questionNum: it.question_db.question_number
      };
    });
    return { rows, title };
  };

  const fetchAssignedExamQuestionsMulti = async (assignIds: string[]) => {
    const results = await Promise.all(assignIds.map(id => fetchAssignedExamQuestions(id)));
    const rows = results.flatMap(r => r.rows);
    const title = results.find(r => r.title)?.title || null;
    return { rows, title };
  };

  const fetchHomework = async (sId: string, hwIdsStr: string, assignId: string = '', assignIdsStr: string = '') => {
    try {
      setIsTimedRound(false);
      const hwIdsArray = hwIdsStr ? hwIdsStr.split(',').map(Number).filter(n => !isNaN(n)) : [];
      const assignIdsArray = assignIdsStr ? assignIdsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
      const [{ rows: qs }, { rows: examRows, title: examTitle }] = await Promise.all([
        hwIdsArray.length > 0 ? resolvePendingHomeworkQuestions(supabaseClient, sId, hwIdsArray) : Promise.resolve({ rows: [] }),
        assignIdsArray.length > 0 ? fetchAssignedExamQuestionsMulti(assignIdsArray) : fetchAssignedExamQuestions(assignId),
      ]);

      const totalsThisFetch: Record<string, number> = {};
      examRows.forEach((r: any) => {
        if (!r.examAssignmentId) return;
        totalsThisFetch[r.examAssignmentId] = (totalsThisFetch[r.examAssignmentId] || 0) + 1;
      });
      Object.assign(refs.examAssignmentTotalsRef.current, totalsThisFetch);

      if (qs.length === 0 && examRows.length === 0) { setPendingQCount(`모든 과제를 완료했습니다!`); setQuestions([]); return; }

      const baseTitle = assignIdsArray.length > 0 ? '미완료 과제' : (examTitle || '정규 과제');
      setGlobalExamTitle(baseTitle);

      const hwQIds = qs.map((qItem: any) => qItem.question_id).filter(Boolean);
      const { data: freshQDb } = hwQIds.length > 0 
        ? await supabaseClient.from('question_db').select('question_id, step_1_concept, step_2_approach, final_printed_page, detected_page_num, question_number').in('question_id', hwQIds)
        : { data: [] };
      const freshQDbMap = new Map((freshQDb || []).map((qItem: any) => [qItem.question_id, qItem]));

      const mappedHw = qs.map((qItem:any, i:number) => {
        const raw = qItem.raw_metadata || {};
        const freshQ: any = freshQDbMap.get(qItem.question_id) || {};
        const dbHint = combineDbHints(freshQ.step_1_concept || raw.step_1_concept, freshQ.step_2_approach || raw.step_2_approach);
        const tbFields = textbookHintFields(qItem.bookType);

        return {
          index: i, uid: 'rq' + i + '_' + Date.now(), homework_id: qItem.homeworkId, tq_id: qItem.tq_id, question_id: qItem.question_id,
          source: qItem.homeworkTitle || '통합 과제', questionText: formatMathTextForWeb(raw.question || '(문제 텍스트 없음)'),
          imageUrl: getCleanUrl(raw.image_url || raw.imageUrl || qItem.image_url), options: safeParseOptions(raw.options),
          answer: String(qItem.answer || '').trim(), explanation: raw.explanation || raw.solution || '', 
          hintText: dbHint || tbFields.hintText,
          hasHint: !!dbHint || tbFields.hasHint,
          needsAiHint: !dbHint && tbFields.needsAiHint,
          bookId: qItem.book_id, bookType: qItem.bookType, bookTitle: qItem.bookTitle,
          aiGradable: qItem.ai_gradable !== false,
          pageNum: qItem.page_number || freshQ.final_printed_page || freshQ.detected_page_num || raw.page_number || raw.detected_page_num,
          questionNum: qItem.question_number || freshQ.question_number || raw.question_number
        };
      });
      const mappedExam = examRows.map((qItem: any, i: number) => ({ ...qItem, index: mappedHw.length + i, uid: 'rq' + (mappedHw.length + i) + '_' + Date.now() }));
      const mapped = [...mappedHw, ...mappedExam];

      refs.totalQuestionsInRoundRef.current = mapped.length;
      refs.hintState.current = hydrateHintState(sId, mapped);
      
      await loadExistingAnswers(sId, mapped, baseTitle);
      setQuestions(mapped);
    } catch (e) {
      console.error('fetchHomework error:', e);
      setPendingQCount('과제를 불러오지 못했습니다.');
    }
  };

  const fetchIncorrect = async (sId: string) => {
    try {
      setIsTimedRound(false);
      const { data: records } = await supabaseClient.from('student_incorrect_record').select('record_id, question_id, source_type, question_db(*)').eq('student_id', sId).is('resolved_at', null).in('status', ['X', 'TX', 'T', '☆', 'B', 'TO', 'RO']);
      if (!records || records.length === 0) { setPendingQCount(`대기 중인 오답: 0문제`); setQuestions([]); return; }
      
      const mapped = records.filter((r:any) => r.question_db).map((r:any, i:number) => {
        const qItem = r.question_db;
        const dbHint = combineDbHints(qItem.step_1_concept, qItem.step_2_approach);
        return {
          index: i, uid: 'rq' + i + '_' + Date.now(), record_id: r.record_id, question_id: qItem.question_id,
          source: r.source_type || '오답노트', questionText: formatMathTextForWeb(qItem.question),
          imageUrl: getCleanUrl(qItem.image_url), options: safeParseOptions(qItem.options),
          answer: String(qItem.answer || '').trim(), explanation: qItem.explanation || qItem.solution || '', 
          hintText: dbHint,
          aiGradable: qItem.ai_gradable !== false, hasHint: true, needsAiHint: !dbHint,
          pageNum: qItem.page_number || qItem.final_printed_page || qItem.detected_page_num,
          questionNum: qItem.question_number
        };
      });
      refs.totalQuestionsInRoundRef.current = mapped.length;
      refs.hintState.current = hydrateHintState(sId, mapped);
      
      await loadExistingAnswers(sId, mapped, '대기 중인 오답');
      setQuestions(mapped);
    } catch (e) {
      console.error('fetchIncorrect error:', e);
      setPendingQCount('오답 문제를 불러오지 못했습니다.');
    }
  };

  const fetchQuestions = useCallback(async () => {
    const { round, weekType, className, assignmentId, homeworkIdsStr, assignmentIdsStr } = params;

    if (round === 1 || round === 4) await fetchWeeklyTest(studentInfo.id, weekType, className, assignmentId);
    else if (round === 2 || round === 3) await fetchHomework(studentInfo.id, homeworkIdsStr, assignmentId, assignmentIdsStr);
    else await fetchIncorrect(studentInfo.id);
  }, [params, studentInfo.id]);

  return {
    questions,
    pendingQCount,
    globalExamTitle,
    isTimedRound,
    setQuestions,
    fetchQuestions
  };
}