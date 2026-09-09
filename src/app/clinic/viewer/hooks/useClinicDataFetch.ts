// src/app/clinic/viewer/hooks/useClinicDataFetch.ts
import { useState, useCallback } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { resolvePendingHomeworkQuestions } from '@/lib/clinicHomework';
import { formatMathTextForWeb, getCleanUrl, combineDbHints, textbookHintFields, hydrateHintState } from '../utils';

interface UseClinicDataFetchProps {
  supabaseClient: SupabaseClient;
  studentInfo: { id: string; name: string; classes: string[] };
  params: { round: number; className: string; weekType: string; assignmentId: string; homeworkIdsStr: string; assignmentIdsStr: string; overdue: boolean };
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
      if (!records || records.length === 0) { setPendingQCount(`이번 주 과제오답유사: 없음`); setQuestions([]); return; }

      const qIds = [...new Set(records.filter((r:any) => r.question_id).map((r:any) => r.question_id))];
      const tqIds = [...new Set(records.filter((r:any) => r.tq_id).map((r:any) => r.tq_id))];
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
        if (r.question_id && qDbMap.has(r.question_id)) {
          const qItem = qDbMap.get(r.question_id);
          const dbHint = combineDbHints(qItem.step_1_concept, qItem.step_2_approach);
          mapped.push({
            index: mapped.length, uid: 'rq' + mapped.length + '_' + Date.now(), record_id: r.record_id, question_id: qItem.question_id,
            source: '과제오답유사', questionText: formatMathTextForWeb(qItem.question),
            imageUrl: getCleanUrl(qItem.image_url), options: typeof qItem.options === 'string' ? JSON.parse(qItem.options) : qItem.options,
            answer: String(qItem.answer || '').trim(), explanation: qItem.explanation || qItem.solution || '',
            hintText: dbHint,
            aiGradable: qItem.ai_gradable !== false, hasHint: true, needsAiHint: !dbHint,
            pageNum: qItem.page_number || qItem.final_printed_page || qItem.detected_page_num,
            questionNum: qItem.question_number
          });
        } else if (r.tq_id && tqMap.has(r.tq_id)) {
          const tq = tqMap.get(r.tq_id);
          const raw = tq.raw_metadata || {};
          const freshQ: any = qDbMap.get(tq.question_id) || {};
          const dbHint = combineDbHints(freshQ.step_1_concept || raw.step_1_concept, freshQ.step_2_approach || raw.step_2_approach);
          const tbFields = textbookHintFields(tq.textbook?.book_type);
          
          mapped.push({
            index: mapped.length, uid: 'rq' + mapped.length + '_' + Date.now(), record_id: r.record_id, tq_id: tq.tq_id, question_id: tq.question_id,
            source: '과제오답유사', questionText: formatMathTextForWeb(raw.question || '(문제 텍스트 없음)'),
            imageUrl: getCleanUrl(raw.image_url || raw.imageUrl || tq.image_url), options: typeof raw.options === 'string' ? JSON.parse(raw.options) : raw.options,
            answer: String(tq.answer || '').trim(), explanation: raw.explanation || raw.solution || '',
            hintText: dbHint || tbFields.hintText,
            hasHint: !!dbHint || tbFields.hasHint,
            needsAiHint: !dbHint && tbFields.needsAiHint,
            bookId: tq.book_id, bookType: tq.textbook?.book_type, bookTitle: tq.textbook?.title,
            aiGradable: tq.ai_gradable !== false,
            pageNum: tq.page_number || freshQ.page_number || raw.page_number || raw.detected_page_num,
            questionNum: tq.question_number || freshQ.question_number || raw.question_number
          });
        }
      });

      if (mapped.length === 0) { setPendingQCount(`이번 주 과제오답유사: 없음`); setQuestions([]); return; }
      
      setIsTimedRound(false);
      setGlobalExamTitle('이번 주 과제오답유사');
      refs.totalQuestionsInRoundRef.current = mapped.length;
      refs.hintState.current = hydrateHintState(sId, mapped);
      
      await loadExistingAnswers(sId, mapped, '이번 주 과제오답유사');
      setQuestions(mapped);
    } catch(e) {}
  };

  const fetchWeeklyTest = async (sId: string, week: string, cls: string, assignId: string) => {
    try {
      let matchedExamId = null; let matchedTitle = null; let matchedAssignId = assignId;
      let displayLabel = '시험';

      if (matchedAssignId) {
        const { data } = await supabaseClient.from('exam_assignment')
          .select('exam_id, exam_master(title, exam_type)')
          .eq('assignment_id', matchedAssignId)
          .eq('student_id', sId)
          .maybeSingle();

        if (data && data.exam_id) {
          matchedExamId = data.exam_id;
          const master: any = Array.isArray(data.exam_master) ? data.exam_master[0] : data.exam_master;
          matchedTitle = master?.title;
          displayLabel = master?.exam_type || '시험';
        }
      }

      if (!matchedExamId && week === 'even') {
        return fetchHomeworkSimilarIncorrect(sId);
      }

      if (!matchedExamId) {
        const { data: cData } = await supabaseClient.from('class').select('class_id').eq('name', cls).maybeSingle();
        let query = supabaseClient.from('exam_assignment')
          .select('assignment_id, exam_id, exam_master!inner(title, exam_type)')
          .eq('student_id', sId)
          .not('exam_master.exam_type', 'in', '("과제", "과제프린트", "오답프린트", "오답유사", "과제오답유사", "미완료과제")')
          .not('status', 'in', '("제출완료", "채점완료", "완료")');

        if (cData?.class_id) query = query.eq('class_id', cData.class_id);

        const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();

        if (data) {
          matchedAssignId = String(data.assignment_id);
          matchedExamId = data.exam_id;
          const master: any = Array.isArray(data.exam_master) ? data.exam_master[0] : data.exam_master;
          matchedTitle = master?.title;
          displayLabel = master?.exam_type || '시험';
        }
      }

      if (!matchedExamId) {
        setPendingQCount(`이번 주 시험: 없음`);
        setQuestions([]); return;
      }

      setGlobalExamTitle(matchedTitle || `이번 주 ${displayLabel}`);
      const { data: items } = await supabaseClient.from('exam_item').select('*, question_db(*)').eq('exam_id', matchedExamId).order('sort_order', { ascending: true });
      const validItems = (items || []).filter((it:any) => it.question_db);

      if (validItems.length === 0) { setPendingQCount(`이번 주 ${displayLabel}: 문제 없음`); setQuestions([]); return; }

      const mapped = validItems.map((it:any, i:number) => {
        const dbHint = combineDbHints(it.question_db.step_1_concept, it.question_db.step_2_approach);
        return {
          index: i, uid: 'rq' + i + '_' + Date.now(), question_id: it.question_db.question_id, record_id: null,
          examAssignmentId: matchedAssignId,
          source: matchedTitle || `이번 주 ${displayLabel}`, questionText: formatMathTextForWeb(it.question_db.question),
          imageUrl: getCleanUrl(it.question_db.image_url), options: typeof it.question_db.options === 'string' ? JSON.parse(it.question_db.options) : it.question_db.options,
          answer: String(it.question_db.answer || '').trim(), explanation: it.question_db.explanation || it.question_db.solution || '',
          hintText: dbHint,
          aiGradable: it.question_db.ai_gradable !== false, hasHint: true, needsAiHint: !dbHint,
          pageNum: it.question_db.page_number || it.question_db.final_printed_page || it.question_db.detected_page_num,
          questionNum: it.question_db.question_number
        };
      });
      refs.totalQuestionsInRoundRef.current = mapped.length;
      refs.hintState.current = hydrateHintState(sId, mapped);

      // 🌟 [핵심 변경] 시험 유형에 따라 60분 또는 20분 타이머 동적 설정
      const is60MinTest = ['중간평가', '중간테스트', '분기평가', '분기테스트'].includes(displayLabel) || 
                          ['중간평가', '중간테스트', '분기평가', '분기테스트'].some(k => (matchedTitle || '').includes(k));
      
      if (typeof window !== 'undefined') {
          // window 객체에 임시로 저장하여 useClinicTimer가 이를 읽어감
          (window as any).__dynamicTimeLimit = is60MinTest ? 3600 : 1200; 
      }

      const titleBase = matchedTitle || `이번 주 ${displayLabel}`;
      const limitText = is60MinTest ? '60분 제한' : '20분 제한'; // 화면에 표시될 텍스트 변경
      
      await loadExistingAnswers(sId, mapped, ((params.round === 1 && week === 'odd') || params.round === 4) ? `${titleBase} (${limitText})` : titleBase);
      setQuestions(mapped);
    } catch(e) {}
  };

  const fetchAssignedExamQuestions = async (assignId: string) => {
    if (!assignId) return { rows: [], title: null };
    const { data } = await supabaseClient.from('exam_assignment').select('exam_id, exam_master(title, exam_type)').eq('assignment_id', assignId).maybeSingle();
    if (!data?.exam_id) return { rows: [], title: null };

    const { data: items } = await supabaseClient.from('exam_item').select('*, question_db(*)').eq('exam_id', data.exam_id).order('sort_order', { ascending: true });
    const validItems = (items || []).filter((it: any) => it.question_db);
    
    const master: any = Array.isArray(data.exam_master) ? data.exam_master[0] : data.exam_master;
    const title = master?.title || null;
    const bookType = master?.exam_type === '오답프린트' ? '오답' : '기타';
    
    const rows = validItems.map((it: any) => {
      const dbHint = combineDbHints(it.question_db.step_1_concept, it.question_db.step_2_approach);
      return {
        examAssignmentId: assignId, question_id: it.question_db.question_id,
        bookId: Number(assignId), bookType, bookTitle: title || '배정된 과제',
        source: title || '배정된 과제', questionText: formatMathTextForWeb(it.question_db.question),
        imageUrl: getCleanUrl(it.question_db.image_url), options: typeof it.question_db.options === 'string' ? JSON.parse(it.question_db.options) : it.question_db.options,
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
        ? await supabaseClient.from('question_db').select('question_id, step_1_concept, step_2_approach, page_number, question_number').in('question_id', hwQIds)
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
          imageUrl: getCleanUrl(raw.image_url || raw.imageUrl || qItem.image_url), options: typeof raw.options === 'string' ? JSON.parse(raw.options) : raw.options,
          answer: String(qItem.answer || '').trim(), explanation: raw.explanation || raw.solution || '', 
          hintText: dbHint || tbFields.hintText,
          hasHint: !!dbHint || tbFields.hasHint,
          needsAiHint: !dbHint && tbFields.needsAiHint,
          bookId: qItem.book_id, bookType: qItem.bookType, bookTitle: qItem.bookTitle,
          aiGradable: qItem.ai_gradable !== false,
          pageNum: qItem.page_number || freshQ.page_number || raw.page_number || raw.detected_page_num,
          questionNum: qItem.question_number || freshQ.question_number || raw.question_number
        };
      });
      const mappedExam = examRows.map((qItem: any, i: number) => ({ ...qItem, index: mappedHw.length + i, uid: 'rq' + (mappedHw.length + i) + '_' + Date.now() }));
      const mapped = [...mappedHw, ...mappedExam];

      refs.totalQuestionsInRoundRef.current = mapped.length;
      refs.hintState.current = hydrateHintState(sId, mapped);
      
      await loadExistingAnswers(sId, mapped, baseTitle);
      setQuestions(mapped);
    } catch(e){}
  };

  const fetchIncorrect = async (sId: string) => {
    try {
      const { data: records } = await supabaseClient.from('student_incorrect_record').select('record_id, question_id, source_type, question_db(*)').eq('student_id', sId).is('resolved_at', null).in('status', ['X', 'TX', 'T', '☆', 'B', 'TO', 'RO']);
      if (!records || records.length === 0) { setPendingQCount(`대기 중인 오답: 0문제`); setQuestions([]); return; }
      
      const mapped = records.filter((r:any) => r.question_db).map((r:any, i:number) => {
        const qItem = r.question_db;
        const dbHint = combineDbHints(qItem.step_1_concept, qItem.step_2_approach);
        return {
          index: i, uid: 'rq' + i + '_' + Date.now(), record_id: r.record_id, question_id: qItem.question_id,
          source: r.source_type || '오답노트', questionText: formatMathTextForWeb(qItem.question),
          imageUrl: getCleanUrl(qItem.image_url), options: typeof qItem.options === 'string' ? JSON.parse(qItem.options) : qItem.options,
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
    } catch(e){}
  };

  const fetchQuestions = useCallback(async () => {
    const { round, weekType, className, assignmentId, homeworkIdsStr, assignmentIdsStr } = params;
    const isTimed = (round === 1 && weekType === 'odd') || round === 4;
    setIsTimedRound(isTimed);

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