// src/app/clinic/viewer/page.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { resolveTodaySession, closeSessionAtLimit, setActiveCall, clearActiveCall, setActiveRecheck, setAway, clearAway, checkAndBumpToggleCooldown } from "@/lib/clinicSession";
import { useToggleCooldown, TOGGLE_COOLDOWN_MS } from "@/hooks/useToggleCooldown";
import { getActiveSeatLayout } from "@/app/actions/clinicSeatLayout";
import { awardClinicMinutePoints, spendPoints } from "@/app/actions/shopPoints";
import { resolvePendingHomeworkQuestions, BOOK_TYPE_COLORS } from "@/lib/clinicHomework";
import { getISOWeekKST } from "@/lib/classRound";
import PointBadge from "@/components/clinic/PointBadge";

import {
  SUPABASE_URL, SUPABASE_ANON_KEY, CLINIC_ROOM, ROUND1_TIME_LIMIT_SECONDS,
  PEN_COLORS, ERASER_WIDTH_MULTIPLIER, getKSTDateString, formatMathTextForWeb,
  getCleanUrl, hydrateHintState, saveHintState, textbookHintFields, keypadAnswersMatch,
  isKeypadEnterable, mcAnswersMatch, isObjectiveQuestion, combineDbHints
} from "./utils";
import { QuestionDisplay } from "./components/QuestionDisplay";
import { HintRevealBox } from "./components/HintRevealBox";
import { ViewerModals } from "./components/ViewerModals";

const getSupabaseClient = () => {
  if (typeof window === 'undefined') return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!(window as any)._supabaseInstance) (window as any)._supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return (window as any)._supabaseInstance;
};
const supabaseClient = getSupabaseClient();

export default function ClinicViewer() {
  const router = useRouter();

  const [isStarted, setIsStarted] = useState(false);
  const [studentInfo, setStudentInfo] = useState({ id: '', name: '학생', classes: [] as string[] });
  const [params, setParams] = useState({ round: 0, className: '', weekType: 'odd', assignmentId: '', homeworkIdsStr: '', assignmentIdsStr: '', overdue: false });
  const [isTimedRound, setIsTimedRound] = useState(false);
  const [globalExamTitle, setGlobalExamTitle] = useState('과제');

  const [points, setPoints] = useState<number | null>(null);
  const [clinicRemainingStr, setClinicRemainingStr] = useState("60:00");
  const [isClinicUrgent, setIsClinicUrgent] = useState(false);
  const [roundRemainingSec, setRoundRemainingSec] = useState(ROUND1_TIME_LIMIT_SECONDS);
  const [timeIsUp, setTimeIsUp] = useState(false);

  const [questions, setQuestions] = useState<any[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [pendingQCount, setPendingQCount] = useState<string>("로딩 중...");
  const [bookFilter, setBookFilter] = useState<string | 'all'>('all');

  useEffect(() => {
    if (bookFilter === 'all') return;
    const cur = questions[currentQIndex];
    if (!cur || cur.bookType !== bookFilter) setBookFilter('all');
  }, [currentQIndex, questions, bookFilter]);

  const [, setUiTrigger] = useState(0);
  const forceUpdate = useCallback(() => setUiTrigger(p => p + 1), []);

  const studentAnswers = useRef<Record<number, string | null>>({});
  const studentDrawings = useRef<Record<number, string>>({});
  const keypadAnswers = useRef<Record<number, string>>({});
  const keypadCursor = useRef<Record<number, number>>({});
  const answerModes = useRef<Record<number, 'keypad' | 'pen'>>({});
  const callState = useRef<Record<number, boolean>>({});
  const recheckState = useRef<Record<number, 'pending' | null>>({});
  const taHintState = useRef<Record<number, boolean>>({});
  const hintState = useRef<Record<number, any>>({});
  const qBoxStatus = useRef<Record<number, 'correct_blue' | 'correct_yellow' | 'retry_yellow' | 'wrong_red'>>({});
  const penGradeCache = useRef<Record<number, boolean>>({});
  const penGradeMetaCache = useRef<Record<number, any>>({});
  const penGradeInFlight = useRef<Record<number, Promise<void> | undefined>>({});
  const hintRequestInFlightRef = useRef(false);

  const [currentPenWidth, setCurrentPenWidth] = useState(3);
  const [currentPenColor, setCurrentPenColor] = useState(PEN_COLORS[0]);
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [keypadCollapsed, setKeypadCollapsed] = useState(false);
  const [hintPanelExpanded, setHintPanelExpanded] = useState(true);
  const [myAwayActive, setMyAwayActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const callCooldown = useToggleCooldown(TOGGLE_COOLDOWN_MS);
  const awayCooldown = useToggleCooldown(TOGGLE_COOLDOWN_MS);

  const [resultModal, setResultModal] = useState<any>(null);
  const [recheckToast, setRecheckToast] = useState("");
  const [timeUpModal, setTimeUpModal] = useState(false);
  const [sessionTimeUpModal, setSessionTimeUpModal] = useState(false);
  const [submitConfirmModal, setSubmitConfirmModal] = useState(false);
  const [submitResultModal, setSubmitResultModal] = useState(false);
  const [pendingRecheckReview, setPendingRecheckReview] = useState<any[]>([]);
  const [hintModal, setHintModal] = useState<any>(null);
  const [emptyState, setEmptyState] = useState<any>(null);
  const [awaitingReview, setAwaitingReview] = useState(false);
  const awaitingReviewSinceRef = useRef<string | null>(null);
  const [autoLeaveSec, setAutoLeaveSec] = useState(10);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutTarget, setLogoutTarget] = useState<'portal' | 'login'>('portal');
  const [sessionInfo, setSessionInfo] = useState<any>(null);

  const optionsRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const questionNavScrollRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawing = useRef(false);
  const clinicChannelRef = useRef<any>(null);
  const mySeatRef = useRef<string | null>(null);
  const seatKeysRef = useRef<string[]>([]);
  const [editorLocked, setEditorLocked] = useState(false);
  const handleTaActionRef = useRef<any>(null);

  useEffect(() => {
    const myTenantId = localStorage.getItem("logica_tenant_id") || "hq";
    getActiveSeatLayout(myTenantId).then(layout => {
      seatKeysRef.current = layout.seats.map(s => String(s.number));
    });
  }, []);

  const hasTrackedPresenceRef = useRef(false);
  const clinicSessionStateRef = useRef<any>(null);
  const lastGradingContextRef = useRef<any>(null);
  const mathJaxRef = useRef(false);
  const correctSolvedCountRef = useRef(0);
  const totalQuestionsInRoundRef = useRef(0);
  const examAssignmentTotalsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const sId = localStorage.getItem('logica_student_id');
    const sName = localStorage.getItem('logica_student_name');
    if (!sId || !sName) { alert("로그인 세션이 만료되었습니다."); router.push('/student/login'); return; }
    setStudentInfo(prev => ({ ...prev, id: sId, name: sName }));

    const p = new URLSearchParams(window.location.search);
    const round = parseInt(p.get('round') || '0', 10);
    const className = p.get('class') ? decodeURIComponent(p.get('class')!) : '';
    const weekType = p.get('week') === 'even' ? 'even' : 'odd';
    const assignmentId = p.get('assignment_id') || '';
    const homeworkIdsStr = p.get('homework_ids') || '';
    const assignmentIdsStr = p.get('assignment_ids') || '';
    const overdue = p.get('overdue') === '1';

    if (!round || isNaN(round) || !className) {
      alert('잘못된 접근입니다. 포털에서 다시 시작해주세요.');
      router.push('/student/portal'); return;
    }

    setParams({ round, className, weekType, assignmentId, homeworkIdsStr, assignmentIdsStr, overdue });
    setIsTimedRound(round === 1 || round === 4);

    initMathJax();
    initSessionAndFetch(sId, round, className, weekType, assignmentId, homeworkIdsStr, assignmentIdsStr);

    const handleUnload = () => untrackPresence();
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.removeEventListener('pagehide', handleUnload); 
      window.removeEventListener('beforeunload', handleUnload);
      untrackPresence();
    };
  }, []);

  useEffect(() => {
    if (questions.length === 0) return;
    const draft = clinicSessionStateRef.current?.draft_progress;
    if (!draft) return;
    if (draft.round !== params.round || draft.className !== params.className || draft.weekType !== params.weekType ||
        draft.assignmentId !== params.assignmentId || draft.homeworkIdsStr !== params.homeworkIdsStr) return;
    const idx = draft.qIndex;
    if (idx < 0 || idx >= questions.length) return;

    const q = questions[idx];
    if (draft.mode === 'pen') {
      studentDrawings.current[idx] = draft.answer;
      studentAnswers.current[idx] = draft.answer;
    } else if (isObjectiveQuestion(q)) {
      studentAnswers.current[idx] = draft.answer;
    } else {
      keypadAnswers.current[idx] = draft.answer;
    }
    setCurrentQIndex(idx);
    forceUpdate();
    if (draft.mode === 'pen') setTimeout(() => initCanvas(idx), 50);

    clinicSessionStateRef.current.draft_progress = null;
    const sid = clinicSessionStateRef.current?.id;
    if (sid) supabaseClient.from('clinic_session_state').update({ draft_progress: null }).eq('id', sid).then();
  }, [questions, params]);

  const initMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]], processEscapes: true }, chtml: { displayAlign: 'left' } };
      const script = document.createElement("script"); script.id = "MathJax-script"; script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"; script.async = true;
      script.onload = () => { (window as any).MathJax?.typesetPromise?.().catch((err: any) => console.error("MathJax 타이프셋 에러:", err)); };
      document.head.appendChild(script);
    }
  };

  const loadExistingAnswers = async (sId: string, qs: any[]) => {
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

    qs.forEach((q, i) => {
      let existing = null;
      if (q.examAssignmentId && q.question_id) {
        existing = examAns.find((a: any) => String(a.exam_assignment_id) === String(q.examAssignmentId) && String(a.question_id) === String(q.question_id));
      } else if (q.homework_id && q.tq_id) {
        existing = hwAns.find((a: any) => String(a.homework_id) === String(q.homework_id) && String(a.tq_id) === String(q.tq_id));
      }

      if (existing) {
        const input = existing.student_input;
        if (input && input !== '미입력' && input !== '[손글씨 답안]') {
          studentAnswers.current[i] = input;
          if (String(input).startsWith('data:image')) {
            studentDrawings.current[i] = input;
            answerModes.current[i] = 'pen';
          } else {
            keypadAnswers.current[i] = input;
            answerModes.current[i] = 'keypad';
          }
        }

        const code = existing.grading_code;
        if (code) {
          if (code === 'O') {
            qBoxStatus.current[i] = 'correct_blue';
            correctCount++;
          } else if (code === 'TO' || code === 'RO') {
            qBoxStatus.current[i] = 'correct_yellow'; 
            correctCount++;
          } else if (code === 'X' || code === 'TX' || code === 'B' || code === '☆') {
            qBoxStatus.current[i] = 'wrong_red';
          }
        }
      }
    });
    correctSolvedCountRef.current = correctCount;
    forceUpdate();
  };

  useEffect(() => {
    if (!studentInfo.id || questions.length === 0) return;

    const handleTaRealtimeUpdate = (payload: any, type: 'exam' | 'hw') => {
      const newData = payload.new;
      if (!newData || String(newData.student_id) !== String(studentInfo.id) || !newData.grading_code) return;

      const idx = questions.findIndex(q =>
        type === 'exam'
          ? (String(q.examAssignmentId) === String(newData.exam_assignment_id) && String(q.question_id) === String(newData.question_id))
          : (String(q.homework_id) === String(newData.homework_id) && String(q.tq_id) === String(newData.tq_id))
      );

      if (idx === -1) return;

      const newCode = newData.grading_code;
      const isCorrect = ['O', 'TO', 'RO'].includes(newCode);
      const currentStatus = qBoxStatus.current[idx];
      const wasCorrect = ['correct_blue', 'correct_yellow', 'retry_yellow'].includes(currentStatus);

      if (isCorrect && !wasCorrect) {
        setRecheckToast(`🎉 조교님이 ${idx + 1}번을 정답(${newCode}) 처리했어요!`);
        setTimeout(() => setRecheckToast(""), 4000);
        if (recheckState.current[idx] === 'pending') recheckState.current[idx] = null;
        
        processCorrectAnswer(questions[idx], idx, true);
        
      } else if (!isCorrect && wasCorrect) {
        qBoxStatus.current[idx] = 'wrong_red';
        correctSolvedCountRef.current = Math.max(0, correctSolvedCountRef.current - 1);
        setRecheckToast(`🚨 조교님이 ${idx + 1}번을 오답(${newCode})으로 변경했어요.`);
        setTimeout(() => setRecheckToast(""), 4000);
      } else if (!isCorrect && currentStatus !== 'wrong_red') {
        qBoxStatus.current[idx] = 'wrong_red';
        if (recheckState.current[idx] === 'pending') {
           setRecheckToast(`조교 확인 결과 오답(${newCode})이 맞습니다. 다시 풀어보세요.`);
           setTimeout(() => setRecheckToast(""), 4000);
           recheckState.current[idx] = null;
           studentAnswers.current[idx] = null; 
           delete studentDrawings.current[idx];
           delete keypadAnswers.current[idx];
           setTimeout(() => initCanvas(idx), 50);
        }
      }
      forceUpdate();
    };

    const channel = supabaseClient.channel(`student_realtime_grading_listen_${studentInfo.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_answer' }, (payload: any) => handleTaRealtimeUpdate(payload, 'exam'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_homework_answer' }, (payload: any) => handleTaRealtimeUpdate(payload, 'hw'))
      .subscribe();

    return () => { supabaseClient.removeChannel(channel); };
  }, [studentInfo.id, questions]);

  const initSessionAndFetch = async (sId: string, round: number, cls: string, week: string, assignId: string, hwIds: string, assignIdsStr: string = '') => {
    const today = getKSTDateString();
    const kioskSeat = localStorage.getItem('logica_kiosk_seat') || undefined;
    const sessionData = await resolveTodaySession(supabaseClient, sId, today, kioskSeat);
    clinicSessionStateRef.current = sessionData;
    setSessionInfo(sessionData);
    
    if (sessionData.call_cooldown_until && new Date(sessionData.call_cooldown_until).getTime() > Date.now()) {
      callCooldown.startUntil(new Date(sessionData.call_cooldown_until).getTime());
    }
    if (sessionData.away_cooldown_until && new Date(sessionData.away_cooldown_until).getTime() > Date.now()) {
      awayCooldown.startUntil(new Date(sessionData.away_cooldown_until).getTime());
    }

    await assignSeatDirectly(sId, sessionData);
    await connectChannel(sId, sessionData);

    const { data: eData } = await supabaseClient.from('enrollment').select('class(name)').eq('student_id', sId);
    if (eData) {
      const cNames = Array.from(new Set(eData.map((e:any) => e.class?.name).filter(Boolean))) as string[];
      setStudentInfo(prev => ({ ...prev, id: sId, classes: cNames.length ? cNames : [cls] }));
    }

    if (round === 1 || round === 4) await fetchWeeklyTest(sId, week, cls, assignId);
    else if (round === 2 || round === 3) await fetchHomework(sId, hwIds, assignId, assignIdsStr);
    else await fetchIncorrect(sId);
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

      const qDbMap = new Map<any, any>((allQDbRows || []).map((q:any) => [q.question_id, q]));
      const tqMap = new Map<any, any>((tqRows || []).map((tq:any) => [tq.tq_id, tq]));

      const mapped: any[] = [];
      records.forEach((r:any) => {
        if (r.question_id && qDbMap.has(r.question_id)) {
          const q = qDbMap.get(r.question_id);
          const dbHint = combineDbHints(q.step_1_concept, q.step_2_approach);
          mapped.push({
            index: mapped.length, uid: 'rq' + mapped.length + '_' + Date.now(), record_id: r.record_id, question_id: q.question_id,
            source: '과제오답유사', questionText: formatMathTextForWeb(q.question),
            imageUrl: getCleanUrl(q.image_url), options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
            answer: String(q.answer || '').trim(), explanation: q.explanation || q.solution || '',
            hintText: dbHint,
            aiGradable: q.ai_gradable !== false, hasHint: true, needsAiHint: !dbHint
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
            aiGradable: tq.ai_gradable !== false
          });
        }
      });

      if (mapped.length === 0) { setPendingQCount(`이번 주 과제오답유사: 없음`); setQuestions([]); return; }
      
      setIsTimedRound(false);
      
      setGlobalExamTitle('이번 주 과제오답유사');
      setPendingQCount(`이번 주 과제오답유사: ${mapped.length}문제`);
      totalQuestionsInRoundRef.current = mapped.length;
      hintState.current = hydrateHintState(sId, mapped);
      
      await loadExistingAnswers(sId, mapped);
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
          matchedTitle = data.exam_master?.title;
          displayLabel = data.exam_master?.exam_type || '시험';
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

        if (cData?.class_id) {
           query = query.eq('class_id', cData.class_id);
        }

        const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();

        if (data) {
          matchedAssignId = String(data.assignment_id);
          matchedExamId = data.exam_id;
          matchedTitle = data.exam_master?.title;
          displayLabel = data.exam_master?.exam_type || '시험';
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

      setPendingQCount(`이번 주 ${displayLabel}: ${validItems.length}문제 (20분 제한)`);
      const mapped = validItems.map((it:any, i:number) => {
        const dbHint = combineDbHints(it.question_db.step_1_concept, it.question_db.step_2_approach);
        return {
          index: i, uid: 'rq' + i + '_' + Date.now(), question_id: it.question_db.question_id, record_id: null,
          examAssignmentId: matchedAssignId,
          source: matchedTitle || `이번 주 ${displayLabel}`, questionText: formatMathTextForWeb(it.question_db.question),
          imageUrl: getCleanUrl(it.question_db.image_url), options: typeof it.question_db.options === 'string' ? JSON.parse(it.question_db.options) : it.question_db.options,
          answer: String(it.question_db.answer || '').trim(), explanation: it.question_db.explanation || it.question_db.solution || '',
          hintText: dbHint,
          aiGradable: it.question_db.ai_gradable !== false, hasHint: true, needsAiHint: !dbHint
        };
      });
      totalQuestionsInRoundRef.current = mapped.length;
      hintState.current = hydrateHintState(sId, mapped);

      await loadExistingAnswers(sId, mapped);
      setQuestions(mapped);
    } catch(e) {}
  };

  const fetchAssignedExamQuestions = async (assignId: string) => {
    if (!assignId) return { rows: [], title: null };
    const { data } = await supabaseClient.from('exam_assignment').select('exam_id, exam_master(title, exam_type)').eq('assignment_id', assignId).maybeSingle();
    if (!data?.exam_id) return { rows: [], title: null };

    const { data: items } = await supabaseClient.from('exam_item').select('*, question_db(*)').eq('exam_id', data.exam_id).order('sort_order', { ascending: true });
    const validItems = (items || []).filter((it: any) => it.question_db);
    const title = data.exam_master?.title || null;

    const bookType = data.exam_master?.exam_type === '오답프린트' ? '오답' : '기타';
    const rows = validItems.map((it: any) => {
      const dbHint = combineDbHints(it.question_db.step_1_concept, it.question_db.step_2_approach);
      return {
        examAssignmentId: assignId, question_id: it.question_db.question_id,
        bookId: Number(assignId), bookType, bookTitle: title || '배정된 과제',
        source: title || '배정된 과제', questionText: formatMathTextForWeb(it.question_db.question),
        imageUrl: getCleanUrl(it.question_db.image_url), options: typeof it.question_db.options === 'string' ? JSON.parse(it.question_db.options) : it.question_db.options,
        answer: String(it.question_db.answer || '').trim(), explanation: it.question_db.explanation || it.question_db.solution || '',
        hintText: dbHint,
        aiGradable: it.question_db.ai_gradable !== false, hasHint: true, needsAiHint: !dbHint
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
      Object.assign(examAssignmentTotalsRef.current, totalsThisFetch);

      if (qs.length === 0 && examRows.length === 0) { setPendingQCount(`모든 과제를 완료했습니다!`); setQuestions([]); return; }

      setGlobalExamTitle(assignIdsArray.length > 0 ? '미완료 과제' : (examTitle || '정규 과제'));
      setPendingQCount(`대기 중인 병합 과제: ${qs.length + examRows.length}문제`);

      const hwQIds = qs.map((q: any) => q.question_id).filter(Boolean);
      const { data: freshQDb } = hwQIds.length > 0 
        ? await supabaseClient.from('question_db').select('question_id, step_1_concept, step_2_approach').in('question_id', hwQIds)
        : { data: [] };
      const freshQDbMap = new Map((freshQDb || []).map((q: any) => [q.question_id, q]));

      const mappedHw = qs.map((q:any, i:number) => {
        const raw = q.raw_metadata || {};
        const freshQ: any = freshQDbMap.get(q.question_id) || {};
        const dbHint = combineDbHints(freshQ.step_1_concept || raw.step_1_concept, freshQ.step_2_approach || raw.step_2_approach);
        const tbFields = textbookHintFields(q.bookType);

        return {
          index: i, uid: 'rq' + i + '_' + Date.now(), homework_id: q.homeworkId, tq_id: q.tq_id, question_id: q.question_id,
          source: q.homeworkTitle || '통합 과제', questionText: formatMathTextForWeb(raw.question || '(문제 텍스트 없음)'),
          imageUrl: getCleanUrl(raw.image_url || raw.imageUrl || q.image_url), options: typeof raw.options === 'string' ? JSON.parse(raw.options) : raw.options,
          answer: String(q.answer || '').trim(), explanation: raw.explanation || raw.solution || '', 
          hintText: dbHint || tbFields.hintText,
          hasHint: !!dbHint || tbFields.hasHint,
          needsAiHint: !dbHint && tbFields.needsAiHint,
          bookId: q.book_id, bookType: q.bookType, bookTitle: q.bookTitle,
          aiGradable: q.ai_gradable !== false
        };
      });
      const mappedExam = examRows.map((q: any, i: number) => ({ ...q, index: mappedHw.length + i, uid: 'rq' + (mappedHw.length + i) + '_' + Date.now() }));
      const mapped = [...mappedHw, ...mappedExam];

      totalQuestionsInRoundRef.current = mapped.length;
      hintState.current = hydrateHintState(sId, mapped);
      
      await loadExistingAnswers(sId, mapped);
      setQuestions(mapped);
    } catch(e){}
  };

  const fetchIncorrect = async (sId: string) => {
    try {
      const { data: records } = await supabaseClient.from('student_incorrect_record').select('record_id, question_id, source_type, question_db(*)').eq('student_id', sId).is('resolved_at', null).in('status', ['X', 'TX', 'T', '☆', 'B', 'TO', 'RO']);
      if (!records || records.length === 0) { setPendingQCount(`대기 중인 오답: 0문제`); setQuestions([]); return; }
      setPendingQCount(`대기 중인 오답: ${records.length}문제`);
      const mapped = records.filter((r:any) => r.question_db).map((r:any, i:number) => {
        const q = r.question_db;
        const dbHint = combineDbHints(q.step_1_concept, q.step_2_approach);
        return {
          index: i, uid: 'rq' + i + '_' + Date.now(), record_id: r.record_id, question_id: q.question_id,
          source: r.source_type || '오답노트', questionText: formatMathTextForWeb(q.question),
          imageUrl: getCleanUrl(q.image_url), options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
          answer: String(q.answer || '').trim(), explanation: q.explanation || q.solution || '', 
          hintText: dbHint,
          aiGradable: q.ai_gradable !== false, hasHint: true, needsAiHint: !dbHint
        };
      });
      totalQuestionsInRoundRef.current = mapped.length;
      hintState.current = hydrateHintState(sId, mapped);
      
      await loadExistingAnswers(sId, mapped);
      setQuestions(mapped);
    } catch(e){}
  };

  const assignSeatDirectly = async (sId: string, sessionState: any) => {
    if (mySeatRef.current) return;
    if (sessionState.manual_seat) { mySeatRef.current = sessionState.manual_seat; return; }

    const storedSeat = sessionState.session_date === getKSTDateString() ? sessionState.seat : null;
    if (storedSeat) { mySeatRef.current = storedSeat; return; }

    const todayStr = getKSTDateString();
    const { data: rows } = await supabaseClient.from('clinic_session_state').select('seat, manual_seat').eq('session_date', todayStr).is('ended_at', null);
    const occupied = new Set<string>();
    (rows || []).forEach((r: any) => { if (r.manual_seat) occupied.add(r.manual_seat); else if (r.seat) occupied.add(r.seat); });
    const candidate = seatKeysRef.current.find(s => !occupied.has(s));
    if (!candidate || mySeatRef.current) return;

    const { data: updated } = await supabaseClient.from('clinic_session_state').update({ seat: candidate }).eq('student_id', sId).is('seat', null).select().maybeSingle();
    if (updated && !mySeatRef.current) mySeatRef.current = candidate;
  };

  const connectChannel = async (sId: string, sessionState: any) => {
    if (clinicChannelRef.current) {
      await supabaseClient.removeChannel(clinicChannelRef.current);
      clinicChannelRef.current = null;
    }
    
    const myTenantId = localStorage.getItem("logica_tenant_id") || "hq";
    const channelName = `${CLINIC_ROOM}_${myTenantId}`;
    
    const channel = supabaseClient.channel(channelName);
    clinicChannelRef.current = channel;
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const hasEditor = Object.values(state).some((metas) => (metas as any[]).some(m => m.role === 'editor'));
        setEditorLocked(hasEditor);

        if (mySeatRef.current) {
          if (!hasTrackedPresenceRef.current) trackPresenceRef.current(mySeatRef.current, sId, sessionState);
          return;
        }
        const occupied = new Set();
        Object.values(state).forEach((metas) => (metas as any[]).forEach(m => { if(m.seat) occupied.add(m.seat); }));

        const manualSeat = sessionState.manual_seat;
        const storedSeat = sessionState.session_date === getKSTDateString() ? sessionState.seat : null;
        const seat = manualSeat || storedSeat || seatKeysRef.current.find(s => !occupied.has(s)) || null;

        if (seat) {
          mySeatRef.current = seat;
          supabaseClient.from('clinic_session_state').update({ seat }).eq('student_id', sId).then();
          trackPresenceRef.current(seat, sId, sessionState);
        }
      })
      .on('broadcast', { event: 'ta_action' }, ({ payload }: any) => handleTaActionRef.current(payload, sId, sessionState))
      .subscribe();
  };

  const trackPresence = (seat: string, sId: string, sessionState: any) => {
    if (!clinicChannelRef.current) return;
    hasTrackedPresenceRef.current = true;
    const activity = params.round === 1 ? (params.weekType === 'even' ? '과제오답유사 풀이중' : '주간테스트 풀이중') : params.round === 2 ? (params.overdue ? '미완료 과제 풀이중' : '과제 풀이중') : params.round === 3 ? '오답 클리닉 풀이중' : '클리닉 풀이중';
    clinicChannelRef.current.track({
      seat, name: studentInfo.name, studentId: sId, classes: studentInfo.classes, activity, updatedAt: Date.now(),
      startedAt: new Date(sessionState.started_at).getTime(), durationMs: sessionState.duration_ms
    });
  };

  const trackPresenceRef = useRef(trackPresence);
  useEffect(() => { trackPresenceRef.current = trackPresence; });

  const untrackPresence = async () => {
    if (clinicChannelRef.current) {
      const ch = clinicChannelRef.current;
      clinicChannelRef.current = null;
      try { await ch.untrack(); } catch(e) {}
      try { await supabaseClient.removeChannel(ch); } catch(e) {}
    }
  };

  const sendAction = (action: string, extra = {}) => {
    if (clinicChannelRef.current && mySeatRef.current) {
      clinicChannelRef.current.send({ type: 'broadcast', event: 'student_action', payload: { seat: mySeatRef.current, action, data: { name: studentInfo.name, studentId: studentInfo.id, ...extra } } });
    }
  };

  // =====================================================================
  // 🌟 누락 함수 복원 (getAnswerMode 등 5종 추가 완료)
  // =====================================================================

  const getAnswerMode = (idx: number, q: any): 'pen' | 'keypad' => {
    const explicit = answerModes.current[idx];
    if (explicit) return explicit;
    if (studentDrawings.current[idx]) return 'pen';
    if (q && !isKeypadEnterable(q.answer)) return 'pen';
    return 'keypad';
  };

  const gradeHandwrittenAnswerWithGemini = async (dataUrl: string, correct: string, qText: string): Promise<any> => {
    const res = await fetch('/api/clinic-grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: dataUrl, correct, questionText: qText }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API 오류');
    return data;
  };

  const generateAiHint = async (qText: string): Promise<string> => {
    try {
      const res = await fetch('/api/clinic-hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionText: qText }),
      });
      if (!res.ok) throw new Error('API 오류');
      const data = await res.json();
      return (data.hint || '').trim() || '문제의 조건을 다시 한번 꼼꼼히 읽고 식을 세워보세요.';
    } catch (e) {
      return '문제의 조건을 다시 한번 꼼꼼히 읽고 식을 세워보세요.';
    }
  };

  const persistExamAnswersToDB = async (): Promise<number> => {
    if (!isTimedRound || !params.assignmentId) return 0;
    await supabaseClient.from('student_answer').delete().eq('exam_assignment_id', params.assignmentId).eq('student_id', studentInfo.id);

    const inserts: any[] = []; const incUpserts: any[] = []; let totalScore = 0;
    for (let idx = 0; idx < questions.length; idx++) {
      const q = questions[idx];
      const ans = studentAnswers.current[idx] ? String(studentAnswers.current[idx]).trim() : '미입력';
      const isCorrect = await isQuestionCorrect(idx);
      const score = isCorrect ? (100 / totalQuestionsInRoundRef.current) : 0;
      totalScore += score;

      inserts.push({ exam_assignment_id: params.assignmentId, student_id: studentInfo.id, question_id: q.question_id, student_input: ans, is_correct: isCorrect, earned_score: score, grading_code: isCorrect ? 'O' : 'X', grading_status: '대기' });
      if (!isCorrect && q.question_id) {
        incUpserts.push({ student_id: studentInfo.id, question_id: q.question_id, source_type: '시험지', status: ans === '미입력' ? 'B' : 'X', resolved_at: null });
      }
    }

    if (inserts.length > 0) await supabaseClient.from('student_answer').insert(inserts);
    if (incUpserts.length > 0) await supabaseClient.from('student_incorrect_record').upsert(incUpserts, { onConflict: 'student_id, question_id' });
    return totalScore;
  };

  const saveExamResultsToDB = async () => {
    if (!isTimedRound || !params.assignmentId) return;
    const totalScore = await persistExamAnswersToDB();
    await supabaseClient.from('exam_assignment').update({ status: '제출완료', total_score: totalScore }).eq('assignment_id', params.assignmentId);
  };

  const ensurePenGraded = useCallback((idx: number): Promise<void> => {
    if (penGradeCache.current[idx] !== undefined) return Promise.resolve();
    if (penGradeInFlight.current[idx]) return penGradeInFlight.current[idx];
    const q = questions[idx];
    const isSubj = q && !isObjectiveQuestion(q);
    const mode = getAnswerMode(idx, q);
    const drawing = studentDrawings.current[idx];
    if (!q || !isSubj || mode !== 'pen' || !drawing) return Promise.resolve();
    const p = gradeHandwrittenAnswerWithGemini(drawing, q.answer, q.questionText)
      .then((meta: any) => { penGradeCache.current[idx] = !!meta.is_correct; penGradeMetaCache.current[idx] = meta; })
      .catch(() => {})
      .finally(() => { delete penGradeInFlight.current[idx]; });
    penGradeInFlight.current[idx] = p;
    return p;
  }, [questions]);

  const isQuestionCorrect = useCallback(async (idx: number): Promise<boolean> => {
    const q = questions[idx];
    if (!q) return false;
    const isSubj = !isObjectiveQuestion(q);
    const mode = getAnswerMode(idx, q);
    if (isSubj && mode === 'pen') {
      await ensurePenGraded(idx);
      return !!penGradeCache.current[idx];
    }
    if (isSubj) return keypadAnswersMatch(studentAnswers.current[idx], q.answer);
    return mcAnswersMatch(studentAnswers.current[idx], q.answer);
  }, [questions, ensurePenGraded]);

  useEffect(() => {
    if (!isTimedRound || !isStarted) return;
    const leavingIdx = currentQIndex;
    return () => { ensurePenGraded(leavingIdx); };
  }, [currentQIndex, isTimedRound, isStarted, ensurePenGraded]);

  const processSessionEnd = async () => {
    try {
        const incorrectQIds: number[] = [];
        const unansweredQIds: number[] = [];
        const statusMap: Record<number, string> = {};
        let corrects = 0;

        questions.forEach((q, i) => {
            const status = qBoxStatus.current[i];
            const isResolved = status === 'correct_blue' || status === 'correct_yellow' || status === 'retry_yellow';

            if (isResolved) {
                corrects++;
            } else if (q.question_id) {
                const isSubj = !isObjectiveQuestion(q);
                const mode = getAnswerMode(i, q);
                const ans = isSubj && mode === 'pen' ? studentDrawings.current[i] : studentAnswers.current[i];
                const isBlank = !ans || String(ans).trim() === '' || String(ans).trim() === '미입력';

                if (isBlank) {
                    if (params.round === 2) {
                        unansweredQIds.push(q.question_id); 
                    } else {
                        incorrectQIds.push(q.question_id); 
                        statusMap[q.question_id] = 'B';
                    }
                } else {
                    incorrectQIds.push(q.question_id);
                    statusMap[q.question_id] = 'X';
                }
            }
        });

        correctSolvedCountRef.current = corrects;

        if (incorrectQIds.length > 0 && !(params.round === 2 && params.overdue)) {
            await generateIncorrectPrint(incorrectQIds, globalExamTitle, isTimedRound, statusMap);
        }

        if (unansweredQIds.length > 0 && params.round === 2) {
            await generateOverduePrint(unansweredQIds, globalExamTitle);
        }

        if (params.round === 2) {
            const hwIdsProcessed = new Set<number>();
            const examAssignIdsProcessed = new Set<string>();
            questions.forEach(q => {
                if (q.homework_id) hwIdsProcessed.add(q.homework_id);
                if (q.examAssignmentId) examAssignIdsProcessed.add(q.examAssignmentId);
            });

            if (hwIdsProcessed.size > 0) {
                await supabaseClient.from('student_homework_result')
                    .update({ status: '제출완료' })
                    .eq('student_id', studentInfo.id)
                    .in('homework_id', Array.from(hwIdsProcessed));
            }
            if (examAssignIdsProcessed.size > 0) {
                await supabaseClient.from('exam_assignment')
                    .update({ status: '제출완료' })
                    .eq('student_id', studentInfo.id)
                    .in('assignment_id', Array.from(examAssignIdsProcessed));
            }
        }
    } catch (err) {
        console.error('Error during processSessionEnd:', err);
    }
  };

  const generateOverduePrint = async (uIds: number[], sourceTitle: string) => {
    if (uIds.length === 0) return;
    try {
      const cleanSourceTitle = sourceTitle.replace(new RegExp(`^\\[${studentInfo.name}\\]\\s*`), '').trim();
      const title = `[${studentInfo.name}] ${cleanSourceTitle} 미완료 프린트`;
      const { data: exMasters } = await supabaseClient.from('exam_master')
        .select('exam_id, created_at')
        .eq('title', title)
        .eq('exam_type', '미완료과제')
        .order('created_at', { ascending: false })
        .limit(10);

      let existingExamId = null;
      let merged = false;

      if (exMasters && exMasters.length > 0) {
          const todayStr = getKSTDateString();
          const validMasters = exMasters.filter((m: any) => {
              const createdAtKST = new Date(new Date(m.created_at).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
              return createdAtKST === todayStr;
          });

          if (validMasters.length > 0) {
              const examIds = validMasters.map((m: any) => m.exam_id);
              const { data: assignments } = await supabaseClient.from('exam_assignment')
                  .select('assignment_id, exam_id')
                  .eq('student_id', studentInfo.id)
                  .in('exam_id', examIds)
                  .eq('status', '미응시')
                  .limit(1);

              if (assignments && assignments.length > 0) {
                  existingExamId = assignments[0].exam_id;
              }
          }
      }

      if (existingExamId) {
          const { data: existingItems } = await supabaseClient.from('exam_item').select('question_id').eq('exam_id', existingExamId);
          const existingQIds = new Set((existingItems || []).map((item: any) => item.question_id));
          const newQIds = uIds.filter(id => !existingQIds.has(id));

          if (newQIds.length > 0) {
              const maxSortOrder = existingItems?.length || 0;
              const itemsToInsert = newQIds.map((qid, i) => ({
                  exam_id: existingExamId, question_id: qid, sort_order: maxSortOrder + i + 1, assigned_score: 0
              }));
              await supabaseClient.from('exam_item').insert(itemsToInsert);

              const newTotal = maxSortOrder + newQIds.length;
              await supabaseClient.from('exam_master').update({ total_questions: newTotal }).eq('exam_id', existingExamId);
              const newScore = Math.round(100 / newTotal);
              await supabaseClient.from('exam_item').update({ assigned_score: newScore }).eq('exam_id', existingExamId);
          }
          merged = true;
      }

      if (!merged) {
          const { data: cls } = await supabaseClient.from('enrollment').select('class(instructor_id)').eq('student_id', studentInfo.id).limit(1).maybeSingle();
          let instId = cls?.class?.instructor_id;
          if (!instId) { const { data: fb } = await supabaseClient.from('instructor').select('instructor_id').limit(1).maybeSingle(); instId = fb?.instructor_id; }
          if (!instId) return;

          const { data: ex } = await supabaseClient.from('exam_master').insert({ title, exam_type: '미완료과제', instructor_id: instId, total_questions: uIds.length }).select().single();
          const items = uIds.map((qid, i) => ({ exam_id: ex.exam_id, question_id: qid, sort_order: i + 1, assigned_score: Math.round(100 / uIds.length) }));
          await supabaseClient.from('exam_item').insert(items);
          await supabaseClient.from('exam_assignment').insert({ exam_id: ex.exam_id, student_id: studentInfo.id, status: '미응시' });
      }
    } catch(e) {}
  };

  const generateIncorrectPrint = async (incQIds: number[], sourceTitle: string, syncIncorrectRecord: boolean = true, statusMap?: Record<number, string>) => {
    const uIds = [...new Set(incQIds)];
    if (uIds.length === 0) return;

    if (syncIncorrectRecord) {
      const incUpserts = uIds.map(qid => ({ student_id: studentInfo.id, question_id: qid, source_type: '시험지', status: statusMap?.[qid] || 'X', resolved_at: null }));
      await supabaseClient.from('student_incorrect_record').upsert(incUpserts, { onConflict: 'student_id, question_id' });
    }

    try {
      const cleanSourceTitle = sourceTitle.replace(new RegExp(`^\\[${studentInfo.name}\\]\\s*`), '').trim();
      const title = `[${studentInfo.name}] ${cleanSourceTitle} 오답 프린트`;

      const { data: exMasters } = await supabaseClient.from('exam_master')
        .select('exam_id, created_at')
        .eq('title', title)
        .eq('exam_type', '오답프린트')
        .order('created_at', { ascending: false })
        .limit(10);

      let existingExamId = null;
      let merged = false;

      if (exMasters && exMasters.length > 0) {
          const todayStr = getKSTDateString();
          const validMasters = exMasters.filter((m: any) => {
              const createdAtKST = new Date(new Date(m.created_at).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
              return createdAtKST === todayStr;
          });

          if (validMasters.length > 0) {
              const examIds = validMasters.map((m: any) => m.exam_id);
              const { data: assignments } = await supabaseClient.from('exam_assignment')
                  .select('assignment_id, exam_id')
                  .eq('student_id', studentInfo.id)
                  .in('exam_id', examIds)
                  .eq('status', '미응시')
                  .limit(1);

              if (assignments && assignments.length > 0) {
                  existingExamId = assignments[0].exam_id;
              }
          }
      }

      if (existingExamId) {
          const { data: existingItems } = await supabaseClient.from('exam_item').select('question_id').eq('exam_id', existingExamId);
          const existingQIds = new Set((existingItems || []).map((item: any) => item.question_id));
          const newQIds = uIds.filter(id => !existingQIds.has(id));

          if (newQIds.length > 0) {
              const maxSortOrder = existingItems?.length || 0;
              const itemsToInsert = newQIds.map((qid, i) => ({
                  exam_id: existingExamId,
                  question_id: qid,
                  sort_order: maxSortOrder + i + 1,
                  assigned_score: 0
              }));
              await supabaseClient.from('exam_item').insert(itemsToInsert);

              const newTotal = maxSortOrder + newQIds.length;
              await supabaseClient.from('exam_master').update({ total_questions: newTotal }).eq('exam_id', existingExamId);
              const newScore = Math.round(100 / newTotal);
              await supabaseClient.from('exam_item').update({ assigned_score: newScore }).eq('exam_id', existingExamId);
          }
          merged = true;
      }

      if (!merged) {
          const { data: cls } = await supabaseClient.from('enrollment').select('class(instructor_id)').eq('student_id', studentInfo.id).limit(1).maybeSingle();
          let instId = cls?.class?.instructor_id;
          if (!instId) { const { data: fb } = await supabaseClient.from('instructor').select('instructor_id').limit(1).maybeSingle(); instId = fb?.instructor_id; }
          if (!instId) return;

          const { data: ex } = await supabaseClient.from('exam_master').insert({ title, exam_type: '오답프린트', instructor_id: instId, total_questions: uIds.length }).select().single();

          const items = uIds.map((qid, i) => ({ exam_id: ex.exam_id, question_id: qid, sort_order: i + 1, assigned_score: Math.round(100 / uIds.length) }));
          await supabaseClient.from('exam_item').insert(items);
          await supabaseClient.from('exam_assignment').insert({ exam_id: ex.exam_id, student_id: studentInfo.id, status: '미응시' });
      }
    } catch(e) {
        console.error(e);
    }
  };

  const handleTimeUp = async (forceAction?: string, sessionExpired = false) => {
    setTimeIsUp(true);

    await processSessionEnd(); 

    const wholeSessionEnd = sessionExpired || forceAction === 'force_checkout' || forceAction === 'force_checkout_by_ta';
    setLogoutTarget(wholeSessionEnd ? 'login' : 'portal');

    const reviewList: any[] = [];
    if (isTimedRound && !forceAction) {
      questions.forEach((q, i) => {
        const status = qBoxStatus.current[i];
        if (status === 'correct_blue' || status === 'correct_yellow' || status === 'retry_yellow') return;
        
        const isSubj = !isObjectiveQuestion(q);
        if (!isSubj || getAnswerMode(i, q) !== 'pen') return;
        const meta = penGradeMetaCache.current[i];
        const recordId = q.record_id || null; 
        reviewList.push({
          idx: i, uid: q.uid, qNum: i + 1, questionText: q.questionText, correctAnswer: q.answer,
          imageDataUrl: studentDrawings.current[i] || null,
          recognizedText: meta?.recognized_text || '', aiExplanation: meta?.explanation || '', aiConfidence: meta?.confidence ?? null,
          recordId, tqId: q.tq_id ?? null, questionId: q.question_id ?? null,
          examAssignmentId: q.question_id && params.assignmentId ? params.assignmentId : null,
          requested: false, resolved: false,
        });
      });
    }
    setPendingRecheckReview(reviewList);

    if (isTimedRound) await saveExamResultsToDB();

    if (forceAction) {
      setSessionTimeUpModal(true);
    } else if (isTimedRound) {
      setSubmitResultModal(true);
    } else {
      setSessionTimeUpModal(true);
    }

    if (reviewList.length === 0) {
      let sec = 10; setAutoLeaveSec(sec);
      const itv = setInterval(() => { sec--; setAutoLeaveSec(sec); if (sec <= 0) { clearInterval(itv); (wholeSessionEnd ? finalizeAndGoToLogin : leaveAndGoHome)(); } }, 1000);
    }
  };

  const submitSingleAnswer = async () => {
    const currentStatus = qBoxStatus.current[currentQIndex];
    const isAlreadyCorrect = currentStatus === 'correct_blue' || currentStatus === 'correct_yellow' || currentStatus === 'retry_yellow';
    
    if (isSubmitting || timeIsUp || callState.current[currentQIndex] || recheckState.current[currentQIndex] === 'pending' || isAlreadyCorrect) return;
    
    const q = questions[currentQIndex];
    const isSubjective = !isObjectiveQuestion(q);
    const useAI = isSubjective && getAnswerMode(currentQIndex, q) === 'pen';
    const myAns = studentAnswers.current[currentQIndex];

    if (!myAns) { alert(useAI ? "답을 먼저 그려주세요!" : "정답을 먼저 입력해주세요!"); return; }

    if (useAI && q.aiGradable === false) {
      requestManualGradingDirect(currentQIndex, q, myAns);
      return;
    }

    setIsSubmitting(true);
    let isCorrect = false; let gradingMeta: any = null;

    if (useAI) {
      try {
        gradingMeta = await gradeHandwrittenAnswerWithGemini(myAns, q.answer, q.questionText);
        isCorrect = !!gradingMeta.is_correct;
      } catch (err: any) {
        setIsSubmitting(false);
        alert('채점 중 문제 발생:\n' + err.message);
        return;
      }
    } else if (isSubjective) {
      isCorrect = keypadAnswersMatch(myAns, q.answer);
    } else {
      isCorrect = mcAnswersMatch(myAns, q.answer);
    }

    lastGradingContextRef.current = useAI ? { idx: currentQIndex, uid: q.uid, q, imageDataUrl: myAns, gradingMeta } : null;
    const gotTaHint = !!taHintState.current[currentQIndex];

    if (isCorrect) {
      await processCorrectAnswer(q, currentQIndex, false);
      setResultModal({ isCorrect: true, note: gotTaHint ? '조교 힌트를 받아 해결했어요.' : null, canRecheck: false });
    } else if (useAI) {
      if (gotTaHint && q.record_id) await supabaseClient.from('student_incorrect_record').update({ status: 'TX' }).eq('record_id', q.record_id);
      recheckState.current[currentQIndex] = 'pending';
      const payload = {
        uid: q.uid, qNum: currentQIndex + 1, questionText: q.questionText, correctAnswer: q.answer,
        imageDataUrl: myAns, recognizedText: gradingMeta?.recognized_text || '', aiExplanation: gradingMeta?.explanation || '',
        aiConfidence: gradingMeta?.confidence || null, initial: true,
      };
      sendAction('recheck_request', payload);
      const sid = clinicSessionStateRef.current?.id;
      if (sid) setActiveRecheck(supabaseClient, sid, q.uid, payload);
      setRecheckToast('✏️ 조교 선생님이 확인하고 있어요. 잠시만 기다려주세요.'); setTimeout(() => setRecheckToast(""), 4000);
      forceUpdate();
    } else {
      qBoxStatus.current[currentQIndex] = 'wrong_red';
      if (q.record_id) await bumpIncorrectRecord(q.record_id, gotTaHint ? 'TX' : 'X', false);
      if (!isTimedRound) await finalizeQuestionProgress(q, false, gotTaHint);
      setResultModal({ isCorrect: false, note: gotTaHint ? '조교 힌트를 받았지만 아직 오답이에요. (TX로 기록됨)' : null, canRecheck: false });
    }
    setIsSubmitting(false);
  };

  const requestManualGradingDirect = (idx: number, q: any, imageDataUrl: string) => {
    recheckState.current[idx] = 'pending';
    const payload = {
      uid: q.uid, qNum: idx + 1, questionText: q.questionText, correctAnswer: q.answer,
      imageDataUrl, recognizedText: '', aiExplanation: '', aiConfidence: null, initial: true,
    };
    sendAction('recheck_request', payload);
    const sid = clinicSessionStateRef.current?.id;
    if (sid) setActiveRecheck(supabaseClient, sid, q.uid, payload);
    setRecheckToast('✏️ 이 문제는 선생님이 직접 확인해요. 잠시만 기다려주세요.');
    setTimeout(() => setRecheckToast(""), 4000);
    forceUpdate();
  };

  const enterAwaitingReview = () => {
    awaitingReviewSinceRef.current = new Date().toISOString();
    setAwaitingReview(true);
    setEmptyState({ title: '모든 오답을 해결했습니다!', desc: '선생님이 결과를 확인하고 있어요. 잠시만 기다려주세요.', awaited: true });
    sendAction('submit', { score: correctSolvedCountRef.current });
  };

  const findNextUnresolvedIndex = (fromIdx: number) => {
    const isResolved = (i: number) => qBoxStatus.current[i] === 'correct_blue' || qBoxStatus.current[i] === 'correct_yellow' || qBoxStatus.current[i] === 'retry_yellow';
    const n = questions.length;
    for (let step = 1; step <= n; step++) {
      const i = (fromIdx + step) % n;
      if (!isResolved(i)) return i;
    }
    return null;
  };

  const processCorrectAnswer = async (q: any, idx: number, fromRecheck: boolean) => {
    const currentStatus = qBoxStatus.current[idx];
    const isAlreadyCorrect = currentStatus === 'correct_blue' || currentStatus === 'correct_yellow' || currentStatus === 'retry_yellow';
    if (isAlreadyCorrect) return; 

    const usedHint = hintState.current[idx] && hintState.current[idx].revealed;
    const helped = taHintState.current[idx] || usedHint;
    const wasWrongBefore = currentStatus === 'wrong_red';

    const newStatus = helped ? 'TO' : (wasWrongBefore ? 'RO' : 'O');
    const resolved = true; 

    correctSolvedCountRef.current++;
    qBoxStatus.current[idx] = wasWrongBefore ? 'retry_yellow' : (helped ? 'correct_yellow' : 'correct_blue');
    forceUpdate();

    if (q.record_id) {
      await bumpIncorrectRecord(q.record_id, newStatus, resolved);
    } else {
      const filterCol = q.tq_id ? 'tq_id' : 'question_id';
      const filterVal = q.tq_id ?? q.question_id;
      if (filterVal) {
        const { data: matches } = await supabaseClient.from('student_incorrect_record').select('record_id').eq('student_id', studentInfo.id).eq(filterCol, filterVal).is('resolved_at', null);
        for (const m of (matches || [])) await bumpIncorrectRecord(m.record_id, newStatus, resolved);
      }
    }

    if (!isTimedRound) await finalizeQuestionProgress(q, true, helped, wasWrongBefore);

    const nextIdx = findNextUnresolvedIndex(idx);
    if (nextIdx === null) {
      enterAwaitingReview();
      saveRoundScoreToLocalStorage();
      await processSessionEnd(); 
    } else {
      setCurrentQIndex(nextIdx);
      setTimeout(() => initCanvas(nextIdx), 100);
    }
    forceUpdate();
  };

  const saveRoundScoreToLocalStorage = () => {
    const key = `logica_clinic_${studentInfo.id}_${params.className}_round${params.round}_score`;
    try { localStorage.setItem(key, JSON.stringify({ correct: correctSolvedCountRef.current, total: totalQuestionsInRoundRef.current, savedAt: new Date().toISOString() })); } catch(e){}
  };

  const requestRecheck = () => {
    if (!lastGradingContextRef.current) return;
    const { idx, uid, q, imageDataUrl, gradingMeta } = lastGradingContextRef.current;
    setResultModal(null);
    recheckState.current[idx] = 'pending';
    const recheckPayload = { uid, qNum: idx + 1, questionText: q.questionText, correctAnswer: q.answer, imageDataUrl, recognizedText: gradingMeta?.recognized_text || '', aiExplanation: gradingMeta?.explanation || '', aiConfidence: gradingMeta?.confidence || null };
    sendAction('recheck_request', recheckPayload);
    const sid = clinicSessionStateRef.current?.id;
    if (sid) setActiveRecheck(supabaseClient, sid, uid, recheckPayload);
    lastGradingContextRef.current = null;
    setRecheckToast('🔄 조교에게 재확인을 요청했어요. 잠시만 기다려주세요.');
    setTimeout(() => setRecheckToast(""), 4000);
    forceUpdate();
  };

  const requestRecheckForReviewItem = (item: any) => {
    recheckState.current[item.idx] = 'pending';
    const recheckPayload = {
      uid: item.uid, qNum: item.qNum, questionText: item.questionText, correctAnswer: item.correctAnswer,
      imageDataUrl: item.imageDataUrl, recognizedText: item.recognizedText, aiExplanation: item.aiExplanation, aiConfidence: item.aiConfidence,
      recordId: item.recordId, tqId: item.tqId, questionId: item.questionId, examAssignmentId: item.examAssignmentId,
      deferredWrite: true,
    };
    sendAction('recheck_request', recheckPayload);
    const sid = clinicSessionStateRef.current?.id;
    if (sid) setActiveRecheck(supabaseClient, sid, item.uid, recheckPayload);
    setPendingRecheckReview(prev => prev.map(r => r.uid === item.uid ? { ...r, requested: true } : r));
  };

  const finalizeHomeworkProgress = async (q: any, isCorrect: boolean, helped: boolean = false, retried: boolean = false) => {
    if (!q.homework_id) return;
    const { data: existing } = await supabaseClient.from('student_homework_answer').select('hw_answer_id, wrong_attempts_log').eq('homework_id', q.homework_id).eq('student_id', studentInfo.id).eq('tq_id', q.tq_id).maybeSingle();
    let wrongLog = existing?.wrong_attempts_log || [];
    if (typeof wrongLog === 'string') try { wrongLog = JSON.parse(wrongLog); } catch(e){ wrongLog=[]; }
    if (!Array.isArray(wrongLog)) wrongLog = [];

    const myAns = studentAnswers.current[currentQIndex] || '미입력';
    if (!isCorrect && myAns !== '미입력') wrongLog.push({ input: myAns, at: new Date().toISOString() });

    const gradingCode = isCorrect ? (helped ? 'TO' : (retried ? 'RO' : 'O')) : (helped ? 'TX' : 'X');
    const payload = { homework_id: q.homework_id, student_id: studentInfo.id, tq_id: q.tq_id, student_input: myAns, is_correct: isCorrect, grading_code: gradingCode, earned_score: isCorrect ? 1 : 0, wrong_attempts_log: wrongLog };
    if (existing) await supabaseClient.from('student_homework_answer').update(payload).eq('hw_answer_id', existing.hw_answer_id);
    else await supabaseClient.from('student_homework_answer').insert(payload);

    if (isCorrect) {
      const { data: hwRes } = await supabaseClient.from('student_homework_result').select('hw_result_id, completed_tq_ids, homework_assignment(target_questions)').eq('homework_id', q.homework_id).eq('student_id', studentInfo.id).maybeSingle();
      if (hwRes) {
        let comp = typeof hwRes.completed_tq_ids === 'string' ? JSON.parse(hwRes.completed_tq_ids) : hwRes.completed_tq_ids;
        if (!Array.isArray(comp)) comp = [];
        const cSet = new Set(comp.map(Number)); cSet.add(Number(q.tq_id));
        let tq = typeof hwRes.homework_assignment?.target_questions === 'string' ? JSON.parse(hwRes.homework_assignment.target_questions) : hwRes.homework_assignment?.target_questions;
        if (!Array.isArray(tq)) tq = [];
        const allDone = tq.every((id:any) => cSet.has(Number(id)));
        await supabaseClient.from('student_homework_result').update({ completed_tq_ids: [...cSet], status: allDone ? '채점완료' : undefined }).eq('hw_result_id', hwRes.hw_result_id);
      }
    }
    const isFullyClean = isCorrect && !helped && !retried;
    if (!isFullyClean && !q.record_id && (q.tq_id || q.question_id) && !(params.overdue && isCorrect)) {
      q.record_id = await upsertIncorrectRecord(q, gradingCode);
    }
  };

  const finalizeExamAssignmentProgress = async (q: any, isCorrect: boolean, helped: boolean = false, retried: boolean = false) => {
    if (!q.examAssignmentId) return;

    const gradingCode = isCorrect ? (helped ? 'TO' : (retried ? 'RO' : 'O')) : (helped ? 'TX' : 'X');

    if (q.question_id) {
      const myAns = studentAnswers.current[currentQIndex] || '미입력';
      const studentInput = myAns;

      const { data: existingAns } = await supabaseClient.from('student_answer').select('answer_id').eq('exam_assignment_id', q.examAssignmentId).eq('student_id', studentInfo.id).eq('question_id', q.question_id).maybeSingle();
      const ansPayload = { exam_assignment_id: q.examAssignmentId, student_id: studentInfo.id, question_id: q.question_id, student_input: studentInput, is_correct: isCorrect, grading_code: gradingCode, grading_status: '대기' };
      if (existingAns) await supabaseClient.from('student_answer').update(ansPayload).eq('answer_id', existingAns.answer_id);
      else await supabaseClient.from('student_answer').insert(ansPayload);
    }

    const isFullyClean = isCorrect && !helped && !retried;
    if (!isFullyClean && !q.record_id && q.question_id && !(params.overdue && isCorrect)) {
      q.record_id = await upsertIncorrectRecord(q, gradingCode);
    }

    if (!isCorrect) return;
    const remaining = (examAssignmentTotalsRef.current[q.examAssignmentId] || 1) - 1;
    examAssignmentTotalsRef.current[q.examAssignmentId] = remaining;
    if (remaining <= 0) {
      await supabaseClient.from('exam_assignment').update({ status: '제출완료' }).eq('assignment_id', q.examAssignmentId);
    }
  };

  const finalizeQuestionProgress = async (q: any, isCorrect: boolean, helped: boolean = false, retried: boolean = false) => {
    if (q.examAssignmentId) await finalizeExamAssignmentProgress(q, isCorrect, helped, retried);
    else await finalizeHomeworkProgress(q, isCorrect, helped, retried);
  };

  const drawWritableHint = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save(); ctx.fillStyle = 'rgba(28,37,48,0.08)';
    for (let x = 16; x < w; x += 32) { for (let y = 16; y < h; y += 32) { ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill(); } }
    ctx.restore();
  };

  const initCanvas = (idx: number) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) { requestAnimationFrame(() => initCanvas(idx)); return; }

    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctxRef.current = ctx;
    ctx.scale(dpr, dpr); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = currentPenColor; ctx.lineWidth = currentPenWidth; ctx.globalCompositeOperation = 'source-over';
    setIsEraserMode(false);

    drawWritableHint(ctx, rect.width, rect.height);

    const saved = studentDrawings.current[idx];
    if (saved) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height); img.src = saved; }

    const getPos = (e: any) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX || e.touches?.[0].clientX) - r.left, y: (e.clientY || e.touches?.[0].clientY) - r.top }; };

    const startDraw = (e: any) => {
      isDrawing.current = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x+0.01, p.y+0.01); ctx.stroke();
    };
    const draw = (e: any) => { if (!isDrawing.current) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const stopDraw = (e: any) => {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      try { if (e?.pointerId != null) canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      studentDrawings.current[idx] = canvas.toDataURL('image/webp', 0.5); 
      studentAnswers.current[idx] = studentDrawings.current[idx];
      forceUpdate();
    };

    canvas.onpointerdown = startDraw; canvas.onpointermove = draw; canvas.onpointerup = stopDraw; canvas.onpointercancel = stopDraw;
  };

  const handleClearCanvas = () => {
    delete studentDrawings.current[currentQIndex];
    studentAnswers.current[currentQIndex] = null;
    forceUpdate();
    if (canvasRef.current && ctxRef.current) {
      const c = canvasRef.current;
      const dpr = window.devicePixelRatio || 1;
      ctxRef.current.clearRect(0, 0, c.width, c.height);
      drawWritableHint(ctxRef.current, c.width / dpr, c.height / dpr);
    }
  };

  const pressKeypad = (key: string) => {
    const idx = currentQIndex;
    let cur = keypadAnswers.current[idx] || '';
    let pos = keypadCursor.current[idx] ?? cur.length;
    pos = Math.max(0, Math.min(pos, cur.length));

    if (key === 'back') {
      if (pos > 0) { cur = cur.slice(0, pos - 1) + cur.slice(pos); pos -= 1; }
    } else if (key === 'clear') {
      cur = ''; pos = 0;
    } else {
      const insert = key === ',' ? ', ' : key;
      cur = cur.slice(0, pos) + insert + cur.slice(pos);
      pos += insert.length;
    }

    keypadAnswers.current[idx] = cur;
    keypadCursor.current[idx] = pos;
    studentAnswers.current[idx] = cur.trim() || null;
    forceUpdate();
  };

  const toggleAnswerMode = () => {
    const current = getAnswerMode(currentQIndex, questions[currentQIndex]);
    const mode = current === 'pen' ? 'keypad' : 'pen';
    if (mode === 'keypad' && !isKeypadEnterable(questions[currentQIndex]?.answer)) return;
    answerModes.current[currentQIndex] = mode;
    studentAnswers.current[currentQIndex] = mode === 'pen' ? (studentDrawings.current[currentQIndex] || null) : (keypadAnswers.current[currentQIndex] || null);
    forceUpdate();
    if (mode === 'pen') setTimeout(() => initCanvas(currentQIndex), 50);
  };

  const toggleEraser = () => {
    const next = !isEraserMode;
    setIsEraserMode(next);
    if (ctxRef.current) {
      ctxRef.current.globalCompositeOperation = next ? 'destination-out' : 'source-over';
      ctxRef.current.lineWidth = next ? currentPenWidth * ERASER_WIDTH_MULTIPLIER : currentPenWidth;
    }
  };

  const handleCallAction = async () => {
    if (callCooldown.isActive) return;
    if (!callState.current[currentQIndex] && myAwayActive) {
      alert('자리비움 중에는 호출 불가합니다.');
      return;
    }
    const sid = clinicSessionStateRef.current?.id;
    if (sid) {
      const cooldown = await checkAndBumpToggleCooldown(supabaseClient, sid, 'call');
      callCooldown.startUntil(new Date(cooldown.cooldownUntil).getTime());
      if (!cooldown.ok) return;
    } else {
      callCooldown.start();
    }
    const willCall = !callState.current[currentQIndex];
    callState.current[currentQIndex] = willCall;
    forceUpdate();
    const callPayload = {
      qNum: currentQIndex + 1,
      questionText: q.questionText,
      imageUrl: q.imageUrl,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation,
      source: q.source
    };
    sendAction(willCall ? 'call' : 'cancel_call', willCall ? callPayload : { qNum: currentQIndex + 1 });
    if (sid) {
      willCall
        ? setActiveCall(supabaseClient, sid, currentQIndex + 1, callPayload)
        : clearActiveCall(supabaseClient, sid, currentQIndex + 1);
    }
  };

  const handleAwayToggle = async () => {
    if (awayCooldown.isActive) return;
    const sid = clinicSessionStateRef.current?.id;
    if (sid) {
      const cooldown = await checkAndBumpToggleCooldown(supabaseClient, sid, 'away');
      awayCooldown.startUntil(new Date(cooldown.cooldownUntil).getTime());
      if (!cooldown.ok) return;
    } else {
      awayCooldown.start();
    }
    const next = !myAwayActive;
    setMyAwayActive(next);
    sendAction(next ? 'away' : 'cancel_away');
    if (sid) {
      next ? setAway(supabaseClient, sid) : clearAway(supabaseClient, sid);
    }
  };

  const handleTaAction = (payload: any, sId: string, sessionState: any) => {
    if (payload.action === 'force_cancel_call') {
      if (payload.qNum) {
        const qIdx = payload.qNum - 1;
        if (callState.current[qIdx]) {
          callState.current[qIdx] = false;
          if (payload.mark === 'hint') {
            taHintState.current[qIdx] = true;
            if (questions[qIdx]?.record_id) supabaseClient.from('student_incorrect_record').update({ status: 'T' }).eq('record_id', questions[qIdx].record_id).then();
          }
          forceUpdate();
        }
      }
    } else if (payload.action === 'force_return_to_seat') {
      setMyAwayActive(false);
    } else if (payload.action === 'relocated_away') {
      if (payload.seat !== mySeatRef.current) return;

      const sid = clinicSessionStateRef.current?.id;
      const qItem = questions[currentQIndex];
      if (sid && qItem) {
        const isObjective = isObjectiveQuestion(qItem);
        const mode = isObjective ? null : getAnswerMode(currentQIndex, qItem);
        const answer = isObjective ? studentAnswers.current[currentQIndex]
          : mode === 'pen' ? studentDrawings.current[currentQIndex]
          : keypadAnswers.current[currentQIndex];
        if (answer) {
          const draft = { round: params.round, className: params.className, weekType: params.weekType, assignmentId: params.assignmentId, homeworkIdsStr: params.homeworkIdsStr, qIndex: currentQIndex, answer, mode: mode || 'objective', savedAt: Date.now() };
          supabaseClient.from('clinic_session_state').update({ draft_progress: draft }).eq('id', sid).then();
        }
      }

      if (isTimedRound) persistExamAnswersToDB();

      untrackPresence();
      localStorage.removeItem('logica_student_id');
      localStorage.removeItem('logica_student_name');
      localStorage.removeItem('logica_student_phone');
      router.push('/student/login');
    } else if (payload.action === 'release_to_portal' && payload.seat === mySeatRef.current) {
      setAwaitingReview(false);
    } else if (payload.action === 'force_checkout' || payload.action === 'force_checkout_by_ta') {
      if (payload.seat !== mySeatRef.current) return;
      handleTimeUp(payload.action);
    } else if (payload.action === 'move_seat') {
      if (payload.seat === mySeatRef.current && payload.newSeat) {
        mySeatRef.current = payload.newSeat;
        supabaseClient.from('clinic_session_state').update({ seat: payload.newSeat, manual_seat: payload.newSeat }).eq('student_id', sId).is('ended_at', null).then();
        trackPresence(payload.newSeat, sId, sessionState);
      }
    } else if (payload.action === 'adjust_clinic_time' && payload.studentId === sId) {
      const dMs = Number(payload.deltaMs) || 0;
      if (clinicSessionStateRef.current) {
        clinicSessionStateRef.current.duration_ms = Math.max(0, clinicSessionStateRef.current.duration_ms + dMs);
        trackPresence(mySeatRef.current!, sId, clinicSessionStateRef.current);
      }
    } else if (payload.action === 'resolve_recheck' && payload.seat === mySeatRef.current) {
      const idx = questions.findIndex(item => item.uid === payload.uid);
      if (idx === -1 || recheckState.current[idx] !== 'pending') return;

      const isReviewItem = pendingRecheckReview.some(r => r.uid === payload.uid);
      if (isReviewItem) {
        recheckState.current[idx] = null;
        setPendingRecheckReview(prev => prev.map(r => r.uid === payload.uid ? { ...r, resolved: true, verdict: payload.verdict } : r));
        setRecheckToast(payload.verdict === 'correct' ? '🎉 조교가 정답으로 확인했어요!' : '조교 확인 결과 오답이 맞습니다.');
        setTimeout(() => setRecheckToast(""), 4000);
        return;
      }

      const qItem = questions[idx];
      if (payload.verdict === 'correct') {
        processCorrectAnswer(qItem, idx, true);
      } else {
        recheckState.current[idx] = null;
        qBoxStatus.current[idx] = 'wrong_red';
        delete studentDrawings.current[idx]; delete keypadAnswers.current[idx]; delete keypadCursor.current[idx]; studentAnswers.current[idx] = null;
        setRecheckToast('조교 확인 결과 오답이 맞습니다. 다시 풀어보세요.'); setTimeout(() => setRecheckToast(""), 4000);
        forceUpdate();
        setTimeout(() => initCanvas(idx), 50);
      }
    }
  };

  const bumpIncorrectRecord = async (recordId: number, status: string, resolved: boolean) => {
    const { data: cur } = await supabaseClient.from('student_incorrect_record').select('retry_count').eq('record_id', recordId).maybeSingle();
    await supabaseClient.from('student_incorrect_record').update({
      status, retry_count: (cur?.retry_count || 0) + 1, resolved_at: resolved ? new Date().toISOString() : null,
    }).eq('record_id', recordId);
  };

  const upsertIncorrectRecord = async (qData: any, status: string): Promise<number | undefined> => {
    const filterCol = qData.tq_id ? 'tq_id' : 'question_id';
    const filterVal = qData.tq_id ?? qData.question_id;
    if (!filterVal) return undefined;
    const { data: existingRows } = await supabaseClient.from('student_incorrect_record').select('record_id').eq('student_id', studentInfo.id).eq(filterCol, filterVal).limit(1);
    if (existingRows?.[0]) {
      await supabaseClient.from('student_incorrect_record').update({ status, resolved_at: null }).eq('record_id', existingRows[0].record_id);
      return existingRows[0].record_id;
    }
    const { data: newRecord } = await supabaseClient.from('student_incorrect_record').insert(
      { student_id: studentInfo.id, tq_id: qData.tq_id ?? null, question_id: qData.question_id ?? null, source_type: '과제오답', status, resolved_at: null }
    ).select('record_id').single();
    return newRecord?.record_id;
  };

  const leaveAndGoHome = async () => {
    setIsLoggingOut(true);
    await processSessionEnd();
    await untrackPresence();
    router.push('/student/portal');
  };

  const requestLeaveToHome = () => {
    if (awaitingReview) {
      alert('선생님이 결과를 확인하고 있어요. 확인이 끝날 때까지 잠시만 기다려주세요.');
      return;
    }
    const hasActiveCall = Object.values(callState.current).some(v => v);
    const hasPendingRecheck = Object.values(recheckState.current).some(v => v === 'pending');
    if (myAwayActive || hasActiveCall || hasPendingRecheck) {
      alert('자리비움/호출/재확인 처리 중에는 포탈로 나갈 수 없습니다. 상태 해제 후 다시 시도해주세요.');
      return;
    }
    if (window.confirm('아직 모든 문제를 푸신 게 아닙니다. 정말 나가시겠습니까?')) leaveAndGoHome();
  };

  const finalizeAndGoToLogin = async () => {
    setIsLoggingOut(true);
    await processSessionEnd();
    sendAction('depart');
    await untrackPresence();
    localStorage.removeItem('logica_student_id');
    localStorage.removeItem('logica_student_name');
    localStorage.removeItem('logica_student_phone');
    localStorage.removeItem('logica_tenant_id'); 
    router.push('/student/login');
  };

  const handleLeaveByTarget = (target: 'portal' | 'login') => {
    if (target === 'login') finalizeAndGoToLogin();
    else leaveAndGoHome();
  };

  const startClinic = () => {
    if (questions.length === 0) return;
    setIsStarted(true);
    if (!isTimedRound && questions.length === 0) {
      setEmptyState({ title: '모든 오답을 해결했습니다!', desc: '더 이상 풀 문제가 없습니다. 홈으로 돌아가세요.' });
    }
    setTimeout(() => { if ((window as any).MathJax) (window as any).MathJax.typesetPromise(); initCanvas(0); }, 100);
  };  

  const renderKeypadButton = (k: string) => {
    let btnClass = 'bg-slate-50 text-slate-700 text-2xl hover:bg-slate-100';
    let label = k;
    if (k === 'back') {
      btnClass = 'bg-slate-200 text-slate-600 text-xl hover:bg-slate-300';
      label = '⌫';
    } else if (k === 'clear') {
      btnClass = 'bg-rose-100 text-rose-600 text-xl hover:bg-rose-200';
      label = 'C';
    } else if (k === '0') {
      btnClass = 'col-span-2 bg-slate-50 text-slate-700 text-2xl hover:bg-slate-100';
    } else if (k === '-' || k === '.' || k === '/') {
      btnClass = 'bg-slate-100 text-slate-600 text-xl hover:bg-slate-200';
      if (k === '/') label = '분수 /';
    }
    return (
      <button key={k} onClick={() => pressKeypad(k)} className={`h-14 md:h-16 rounded-xl font-black transition-colors shadow-sm border border-slate-200 ${btnClass}`}>
        {label}
      </button>
    );
  };

  const q = questions[currentQIndex];
  const availableBooks = [...new Map(questions.filter(qq => qq.bookType != null).map(qq => [qq.bookType, qq])).values()]
    .map(qq => ({ bookType: qq.bookType, count: questions.filter(x => x.bookType === qq.bookType).length }));
  const visibleIndices = questions.map((_, i) => i).filter(i => bookFilter === 'all' || questions[i].bookType === bookFilter);
  
  const switchBookFilter = (bookType: string | 'all') => {
    setBookFilter(bookType);
    if (bookType !== 'all') {
      const idx = questions.findIndex(qq => qq.bookType === bookType);
      if (idx !== -1) { setCurrentQIndex(idx); setTimeout(() => initCanvas(idx), 50); }
    }
  };

  const isSubjective = q && !isObjectiveQuestion(q);
  const curAnsMode = getAnswerMode(currentQIndex, q);
  const isCall = !!callState.current[currentQIndex];
  const isRecheck = recheckState.current[currentQIndex] === 'pending';
  const isCurrentAlreadyCorrect = qBoxStatus.current[currentQIndex] === 'correct_blue' || qBoxStatus.current[currentQIndex] === 'correct_yellow' || qBoxStatus.current[currentQIndex] === 'retry_yellow';

  if (!isStarted) {
    return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 font-pretendard">
        <div className="bg-white rounded-[2rem] shadow-2xl p-10 w-full max-w-2xl text-center animate-[fadeIn_0.3s_ease-out]">
          <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-10 mx-auto mb-6 object-contain" />
          <h2 className="text-3xl font-black text-[#002864] tracking-tighter mb-4">학습 클리닉</h2>
          <p className="text-base text-slate-500 font-bold mb-8">{isTimedRound ? '그동안의 노력을 테스트해보세요!' : params.round===3?'이번 회차 전에 끝내지 못한 과제를 마무리해봐요!':'배부된 과제를 풀어봐요!'}</p>
          <div className="mb-8 bg-slate-50 border border-slate-200 rounded-2xl p-6">
            <p className="text-sm font-bold text-slate-400 mb-1">학생 이름</p><p className="text-3xl font-extrabold text-slate-800">{studentInfo.name}</p>
            <div className="mt-4"><span className="text-sm font-bold text-rose-500 bg-rose-100 px-4 py-2 rounded-full">{pendingQCount}</span></div>
          </div>
          <button onClick={startClinic} disabled={questions.length === 0} className="w-full bg-[#002864] hover:bg-blue-950 text-white font-bold py-5 text-xl rounded-2xl shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {questions.length > 0 ? (isTimedRound ? '⏱️ 20분 타이머 시작하기' : '🚀 풀이 시작하기') : '풀 문제가 없습니다!'}
          </button>

          {questions.length === 0 && (
            <div className="flex gap-4 mt-6">
              <button onClick={() => router.back()} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-4 text-lg rounded-2xl transition-all">
                이전 화면으로
              </button>
              <button onClick={leaveAndGoHome} className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-4 text-lg rounded-2xl shadow-md transition-all">
                홈으로 가기
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-100 h-screen flex flex-col font-pretendard select-none">
      {isLoggingOut && (
        <div className="fixed inset-0 bg-slate-900/85 z-[9999] flex flex-col items-center justify-center text-white text-center px-8 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]">
          <span className="text-7xl mb-4 animate-bounce">👋</span>
          <div className="font-lexend tracking-tight font-bold text-3xl">안전하게 나가는 중입니다...</div>
          <div className="text-base mt-4 text-slate-300">잠시 후 자동으로 이동합니다.</div>
        </div>
      )}

      {editorLocked && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[999] flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl shadow-2xl p-10 text-center max-w-sm">
            <div className="text-5xl mb-4">🔒</div>
            <h3 className="text-xl font-extrabold text-slate-800 mb-2">좌석 배치 수정 중입니다</h3>
            <p className="text-sm text-slate-500">관리자가 좌석 배치를 편집하는 동안에는<br />클리닉 기능이 잠시 멈춥니다. 잠시만 기다려주세요.</p>
          </div>
        </div>
      )}

      <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center shrink-0 z-20">
        <div className="flex items-center gap-4">
          <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-7 object-contain" />
          <div className="w-px h-6 bg-slate-300"></div>
          <h1 className="text-lg md:text-xl font-bold text-slate-800"><span>{studentInfo.name}</span>의 맞춤 오답 클리닉</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm transition-colors ${isClinicUrgent ? 'bg-rose-100 border-rose-300 animate-pulse text-rose-600' : 'bg-indigo-50 border border-indigo-200 text-indigo-600'}`} title="전체 이용 가능 시간">
            <span className="text-xl">🕐</span><span className="text-base font-lexend font-black">{clinicRemainingStr}</span>
          </div>
          {isTimedRound && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm ${roundRemainingSec <= 60 ? 'bg-rose-100 animate-pulse text-rose-600' : 'bg-rose-50 border border-rose-200 text-rose-600'}`}>
              <span className="text-xl">⏱️</span><span className="text-base font-lexend font-black">{String(Math.floor(roundRemainingSec/60)).padStart(2,'0')}:{String(roundRemainingSec%60).padStart(2,'0')}</span>
            </div>
          )}
          <PointBadge points={points} className="bg-yellow-50 border-yellow-200 text-yellow-700" />
          {params.round !== 1 && !awaitingReview && (
            <>
              <div className="w-px h-5 bg-slate-300"></div>
              <button onClick={requestLeaveToHome} className="text-base font-bold text-slate-400 hover:text-slate-600 transition-colors">나가기</button>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-6 flex justify-center relative">
        {emptyState && (
          <div className="absolute inset-0 bg-slate-100 flex flex-col items-center justify-center z-50 animate-[fadeIn_0.3s_ease-out]">
            <span className="text-7xl mb-4">🎉</span>
            <h2 className="text-3xl font-extrabold text-slate-700">{emptyState.title}</h2>
            <p className="text-lg text-slate-500 font-medium mt-3">
              {emptyState.awaited ? (awaitingReview ? '선생님이 결과를 확인하고 있어요. 잠시만 기다려주세요.' : '확인이 끝났어요! 홈으로 돌아가세요.') : emptyState.desc}
            </p>
            {isTimedRound && <p className="text-lg font-bold text-[#002864] bg-white border border-slate-200 rounded-full px-5 py-1.5 mt-5 shadow-sm">정답률 {correctSolvedCountRef.current}/{totalQuestionsInRoundRef.current}</p>}
            {awaitingReview ? (
              <div className="mt-6 flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-4 border-[#002864] border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm font-bold text-slate-400">확인이 끝나면 자동으로 넘어가요.</p>
              </div>
            ) : (
              <div className="flex gap-3 mt-8">
                <button onClick={() => router.back()} className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold px-8 py-3 text-lg rounded-xl transition-all">이전 화면으로</button>
                <button onClick={leaveAndGoHome} className="bg-[#002864] hover:bg-blue-900 text-white font-bold px-8 py-3 text-lg rounded-xl shadow-md transition-all">홈으로 돌아가기</button>
              </div>
            )}
          </div>
        )}

        {q && !emptyState && (
          <div className="w-full max-w-[1920px] grid grid-cols-[65fr_35fr] gap-6 md:gap-8 h-full relative">
            <div className="bg-white rounded-3xl shadow-lg flex flex-col overflow-hidden border border-slate-200 relative">
              <div className="flex items-center gap-3 p-6 border-b border-slate-100 bg-slate-50 shrink-0">
                <span className="text-4xl font-extrabold text-[#002864] w-16">{String(currentQIndex + 1).padStart(2, '0')}</span>
                <h2 className="text-sm font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1 rounded-full shadow-sm">원본: {q.source}</h2>
                {q.bookType && (
                  <span className={`text-xs font-black px-3 py-1 rounded-full border shadow-sm ${BOOK_TYPE_COLORS[q.bookType]?.pill || 'bg-slate-100 text-slate-600 border-slate-200'}`}>{q.bookType}</span>
                )}
                {isSubjective && curAnsMode === 'pen' && (
                  <span className="ml-auto shrink-0 bg-[#002864] text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-sm">✍️ 여기에 풀이를 쓸 수 있어요</span>
                )}
              </div>

              <div className="flex-1 relative overflow-hidden">
                <div className={`h-full overflow-y-auto custom-scrollbar p-8 md:p-10 ${!isTimedRound ? 'pb-32' : ''}`}>
                  <div className="relative min-h-full">
                    <div className={`transition-opacity text-2xl md:text-3xl lg:text-[36px] leading-[2.0] lg:leading-[2.2] font-semibold text-slate-800 ${isSubjective && curAnsMode === 'pen' ? 'opacity-30' : ''}`}>
                      <QuestionDisplay html={q.questionText} imageUrl={q.imageUrl} />
                    </div>
                    {isSubjective && curAnsMode === 'pen' && (
                      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full cursor-crosshair touch-none"></canvas>
                    )}
                  </div>
                </div>
              </div>

              {isCall && <div className="bg-rose-50 border-t border-rose-100 px-6 py-3 text-center text-base font-extrabold text-rose-600 shrink-0">🚨 {currentQIndex + 1}번 문제를 호출했습니다.</div>}
              {taHintState.current[currentQIndex] && <div className="bg-amber-50 border-t border-amber-100 px-6 py-3 text-center text-sm font-bold text-amber-600 shrink-0">🧑‍🏫 조교에게 힌트를 받았어요. 이어서 풀어 제출해보세요!</div>}

              {!isTimedRound && (
                <div className="absolute left-0 right-0 bottom-0 z-30 p-5 bg-blue-50/95 backdrop-blur-sm border-t border-blue-100 rounded-b-3xl shadow-[0_-12px_30px_-10px_rgba(15,23,42,0.18)]">
                  {q.hasHint !== false && hintState.current[currentQIndex]?.revealed && (
                    <div className="flex justify-end items-center mb-2">
                      <button onClick={() => setHintPanelExpanded(!hintPanelExpanded)} className="flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-md bg-blue-100 text-blue-600 text-xs font-bold shrink-0">
                        {hintPanelExpanded ? '힌트 접기' : '힌트 펼치기'}
                        <span className={`text-[10px] transition-transform ${hintPanelExpanded ? 'rotate-180' : ''}`}>▲</span>
                      </button>
                    </div>
                  )}
                  <div className="flex gap-3">
                    {q.hasHint !== false && (
                      <button 
                        onClick={() => setHintModal({ cost: 30 })} 
                        disabled={hintState.current[currentQIndex]?.revealed} 
                        className={`flex-1 border text-base py-3 rounded-xl shadow-sm font-bold transition-colors ${hintState.current[currentQIndex]?.revealed ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-white border-blue-200 hover:bg-blue-100 text-blue-700'}`}
                      >
                        {hintState.current[currentQIndex]?.revealed ? "💡 힌트 열람 완료" : "💡 힌트 열람하기 (-30P)"}
                      </button>
                    )}
                    <button onClick={handleAwayToggle} disabled={awayCooldown.isActive || (!myAwayActive && Object.values(callState.current).some(v=>v))} className={`shrink-0 border text-base font-bold py-3 px-6 rounded-xl shadow-sm transition-colors ${myAwayActive ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-300 hover:bg-slate-100 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed'}`}>{awayCooldown.isActive ? `⏳ ${Math.ceil(awayCooldown.remainingMs / 1000)}초` : myAwayActive ? '↩️ 자리 복귀' : '🚶 자리비움'}</button>
                  </div>
                  {q.hasHint !== false && hintState.current[currentQIndex]?.revealed && (
                    <div className={`overflow-hidden transition-all duration-300 ${hintPanelExpanded ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0'}`}>
                      <HintRevealBox revealedText={hintState.current[currentQIndex].hintText} />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-5 min-h-0 overflow-y-auto custom-scrollbar">
              <div className="bg-white rounded-3xl shadow-lg p-6 border border-slate-200 shrink-0 relative">
                {availableBooks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-4 pb-4 border-b border-slate-100">
                    <button onClick={() => switchBookFilter('all')} className={`text-xs font-black px-3 py-1.5 rounded-lg border shadow-sm transition-colors ${bookFilter === 'all' ? 'bg-[#002864] border-[#002864] text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                      전체 <span className="font-normal opacity-80">{questions.length}</span>
                    </button>
                    {availableBooks.map(b => (
                      <button key={b.bookType} onClick={() => switchBookFilter(b.bookType as string)} className={`text-xs font-black px-3 py-1.5 rounded-lg border shadow-sm transition-colors ${bookFilter === b.bookType ? `${BOOK_TYPE_COLORS[b.bookType || '']?.pill || 'bg-slate-800 text-white border-slate-800'} ring-2 ring-offset-1 ring-[#002864]/30` : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                        {b.bookType} <span className="font-normal opacity-80">{b.count}</span>
                      </button>
                    ))}
                  </div>
                )}
                <h3 className="font-bold text-slate-700 mb-4 text-center text-sm md:text-base">
                  문항 이동{' '}
                  <span className="text-slate-400 font-normal">
                    {bookFilter === 'all' ? `(총 ${questions.length}문항)` : `(${visibleIndices.length}문항 · 전체 ${questions.length}문항 중)`}
                  </span>
                </h3>
                <div className="flex items-center gap-2">
                  <button onClick={() => questionNavScrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })} className="shrink-0 w-10 h-16 rounded-xl bg-slate-100 text-slate-500 font-bold text-2xl flex items-center justify-center hover:bg-slate-200">‹</button>
                  <div ref={questionNavScrollRef} className="flex flex-nowrap gap-3 overflow-x-auto custom-scrollbar pb-2 scroll-smooth">
                    {visibleIndices.map(i => {
                      const status = qBoxStatus.current[i];
                      const hasAnswer = studentAnswers.current[i] && studentAnswers.current[i] !== '미입력';

                      const symbol = status === 'wrong_red' ? 'X' : (status === 'retry_yellow' || status === 'correct_yellow') ? '△' : status === 'correct_blue' ? 'O' : null;
                      const statusPalette: Record<string, { light: string; solid: string }> = {
                        wrong_red: { light: 'bg-rose-50 border-rose-300 text-rose-500', solid: 'bg-rose-600 border-rose-600 text-white' },
                        correct_blue: { light: 'bg-blue-50 border-blue-300 text-blue-500', solid: 'bg-blue-600 border-blue-600 text-white' },
                        correct_yellow: { light: 'bg-amber-50 border-amber-300 text-amber-500', solid: 'bg-amber-500 border-amber-500 text-white' },
                        retry_yellow: { light: 'bg-amber-50 border-amber-300 text-amber-500', solid: 'bg-amber-500 border-amber-500 text-white' },
                      };
                      const isCalled = !!callState.current[i];
                      const isCurrent = i === currentQIndex;
                      
                      let cls = '';
                      if (isCalled) {
                        cls = isCurrent ? 'bg-red-600 border-red-600 text-white' : 'bg-red-100 border-red-300 text-red-700';
                      } else if (isCurrent) {
                        cls = status ? `${statusPalette[status].solid} ring-2 ring-offset-2 ring-[#002864]/50` : 'bg-[#002864] border-[#002864] text-white';
                      } else if (status) {
                        cls = statusPalette[status].light;
                      } else if (hasAnswer) {
                        cls = 'bg-slate-200 border-slate-300 text-slate-700';
                      } else {
                        cls = 'border-slate-200 text-slate-500 hover:bg-slate-50';
                      }

                      return (
                        <button key={i} onClick={() => { setCurrentQIndex(i); setTimeout(() => initCanvas(i), 50); forceUpdate(); }} className={`relative w-16 h-16 shrink-0 border-[3px] rounded-xl font-black text-2xl shadow-sm transition-colors flex items-center justify-center ${cls}`}>
                          {!isCalled && symbol ? symbol : i + 1}
                          {!isCalled && !status && hasAnswer && (
                            <span className="absolute top-1.5 right-1.5 w-3 h-3 rounded-full bg-emerald-500 shadow-sm border-2 border-white"></span>
                          )}
                          {!isCalled && symbol && <span className={`absolute -bottom-1 -right-1 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${isCurrent ? 'bg-white/90 text-slate-700' : 'bg-white/80 text-slate-500 opacity-80'}`}>{i + 1}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => questionNavScrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })} className="shrink-0 w-10 h-16 rounded-xl bg-slate-100 text-slate-500 font-bold text-2xl flex items-center justify-center hover:bg-slate-200">›</button>
                </div>
                {params.round === 1 && (
                  <button onClick={() => setSubmitConfirmModal(true)} disabled={timeIsUp} className="w-full mt-5 bg-slate-800 hover:bg-slate-900 text-white font-bold py-4 rounded-xl shadow-sm transition-colors text-lg disabled:opacity-40 disabled:cursor-not-allowed">
                    📮 전체 제출하기
                  </button>
                )}
              </div>

              <div className="bg-white rounded-3xl shadow-lg p-6 flex-1 flex flex-col border border-slate-200 relative overflow-hidden">
                {(isCall || isRecheck) && (
                  <div className="absolute inset-0 z-20 bg-white/50 flex flex-col items-center pt-4 backdrop-blur-[2px]">
                    <div className={`border text-sm font-bold rounded-xl p-4 text-center w-[90%] shadow-sm ${isCall ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-indigo-50 border-indigo-200 text-indigo-600'}`}>
                      {isCall ? <>🙋 호출 중에는 정답을 입력할 수 없어요<br/>조교가 올 때까지 잠시 기다려주세요.</> : q.aiGradable === false ? <>✏️ 조교 선생님이 확인하고 있어요<br/>확인이 끝날 때까지 잠시만 기다려주세요.</> : <>🕐 조교에게 재확인을 요청했어요<br/>확인이 끝날 때까지 잠시만 기다려주세요.</>}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
                  <h3 className="font-bold text-slate-700 text-base md:text-lg"><span className="text-[#002864] text-xl md:text-2xl font-black mr-1">{currentQIndex + 1}</span>번 정답 입력</h3>
                  
                  <div className="flex items-center gap-3">
                    <button onClick={() => setKeypadCollapsed(!keypadCollapsed)} className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors">
                      <span className={`text-base font-bold transition-transform ${keypadCollapsed ? 'rotate-180' : ''}`}>◁</span>
                    </button>
                    <button onClick={toggleAnswerMode} className="text-lg md:text-xl font-black text-[#002864] bg-blue-50 px-8 py-3.5 rounded-xl border-[3px] border-blue-300 hover:bg-blue-100 shadow-sm transition-colors flex items-center gap-2">
                      <span className="text-2xl md:text-3xl">✍️</span> 손글씨로 풀기
                    </button>
                  </div>
                </div>

                <div ref={optionsRef} className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
                  {q.options && q.options.length > 0 ? (
                    q.options.map((opt: string, oIdx: number) => (
                      <label key={oIdx} className={`w-full px-5 py-4 border-2 rounded-xl text-left font-bold cursor-pointer transition-colors flex gap-4 shadow-sm items-center text-lg md:text-xl ${studentAnswers.current[currentQIndex] === String(oIdx + 1) ? 'bg-[#002864] border-[#002864] text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                        <input type="radio" name="omr" className="hidden" checked={studentAnswers.current[currentQIndex] === String(oIdx + 1)} onChange={() => { studentAnswers.current[currentQIndex] = String(oIdx + 1); forceUpdate(); }} />
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${studentAnswers.current[currentQIndex] === String(oIdx + 1) ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{oIdx + 1}</span>
                        <span className="font-myungjo" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(opt) }} />
                      </label>
                    ))
                  ) : curAnsMode === 'pen' ? (
                    <div className="w-full h-full flex flex-col gap-4 items-center justify-center">
                      <p className="text-sm md:text-base font-bold text-slate-400 text-center">✍️ 왼쪽 문제 위에 풀이 과정과 정답을 바로 그려주세요</p>
                      <div className="w-full flex flex-col gap-3">
                        <div className="flex items-center justify-center gap-3">
                          <button onClick={() => { const w = Math.max(1, currentPenWidth - 1); setCurrentPenWidth(w); if(ctxRef.current) ctxRef.current.lineWidth = isEraserMode ? w * ERASER_WIDTH_MULTIPLIER : w; }} className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 font-bold text-2xl">−</button>
                          <span className="text-lg font-bold text-slate-500 w-8 text-center">{currentPenWidth}</span>
                          <button onClick={() => { const w = Math.min(10, currentPenWidth + 1); setCurrentPenWidth(w); if(ctxRef.current) ctxRef.current.lineWidth = isEraserMode ? w * ERASER_WIDTH_MULTIPLIER : w; }} className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 font-bold text-2xl">+</button>
                        </div>
                        <div className={`flex items-center justify-center gap-3 transition-opacity ${isEraserMode ? 'opacity-30 pointer-events-none' : ''}`}>
                          {PEN_COLORS.map(color => (
                            <button key={color} onClick={() => { setCurrentPenColor(color); if(ctxRef.current) ctxRef.current.strokeStyle = color; }} className={`w-10 h-10 rounded-full border-4 transition-transform ${currentPenColor === color ? 'border-[#002864] scale-110' : 'border-white'} shadow-sm`} style={{ backgroundColor: color }}></button>
                          ))}
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          <button onClick={toggleEraser} className={`flex-1 text-lg font-bold py-3 rounded-xl ${isEraserMode ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'}`}>🧽 {isEraserMode ? '지우개 사용 중' : '지우개'}</button>
                          <button onClick={handleClearCanvas} className="flex-1 text-lg font-bold text-rose-500 bg-rose-50 py-3 rounded-xl">🗑️ 전체 지우기</button>
                        </div>
                        <div className="flex items-center gap-3 mt-3 w-full">
                          <button onClick={toggleAnswerMode} className="flex-1 text-xl font-black text-[#002864] bg-blue-50 py-4 rounded-xl border-2 border-blue-200 hover:bg-blue-100 shadow-sm transition-colors flex items-center justify-center gap-2">
                            <span className="text-2xl">🔢</span> 키패드 모드로 전환
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 font-medium text-center mt-1">
                        {isKeypadEnterable(q?.answer) ? '🤖 손글씨 답안은 자동으로 채점돼요' : '✍️ 이 문제는 정답 형식상 손글씨로만 답할 수 있어요'}
                      </p>
                    </div>
                  ) : (
                    <div className="w-full flex flex-col gap-3 h-full">
                      {(() => {
                        const idx = currentQIndex;
                        const kpVal = keypadAnswers.current[idx] || '';
                        const kpPos = Math.max(0, Math.min(keypadCursor.current[idx] ?? kpVal.length, kpVal.length));
                        const moveCursor = (pos: number) => { keypadCursor.current[idx] = pos; forceUpdate(); };
                        return (
                          <div className="w-full min-h-[4rem] text-3xl font-extrabold text-right px-4 py-3 border-[3px] border-slate-200 rounded-xl bg-slate-50 text-slate-800 flex items-center justify-end overflow-x-auto whitespace-pre cursor-text">
                            {kpVal ? (
                              <>
                                <span onClick={() => moveCursor(0)} className="inline-block w-2 self-stretch" />
                                {kpVal.split('').map((ch, i) => (
                                  <React.Fragment key={i}>
                                    {i === kpPos && <span className="inline-block w-[3px] h-6 bg-[#002864] mx-0.5 animate-pulse" />}
                                    <span onClick={() => moveCursor(i + 1)} className="hover:bg-blue-100 rounded-md px-0.5">{ch}</span>
                                  </React.Fragment>
                                ))}
                                {kpPos === kpVal.length && <span className="inline-block w-[3px] h-6 bg-[#002864] mx-0.5 animate-pulse" />}
                              </>
                            ) : <span className="text-slate-300 font-normal">0</span>}
                          </div>
                        );
                      })()}
                      <div className={`flex flex-col flex-1 overflow-hidden transition-all duration-300 ${keypadCollapsed ? 'max-h-0 opacity-0' : 'max-h-[800px] opacity-100'}`}>
                        <div className="grid grid-cols-4 gap-2.5 pt-2 flex-1">
                          <button onClick={() => pressKeypad(' ')} className="col-span-4 py-3.5 rounded-xl font-bold bg-slate-100 text-slate-500 text-base md:text-lg hover:bg-slate-200 transition-colors shadow-sm border border-slate-200">대분수 ␣ (띄어쓰기)</button>
                          {['7','8','9','back','4','5','6','clear','1','2','3','-','0','.','/'].map(renderKeypadButton)}
                          <button onClick={() => pressKeypad(',')} className="col-span-4 py-3.5 rounded-xl font-bold bg-slate-100 text-slate-500 text-base md:text-lg hover:bg-slate-200 transition-colors shadow-sm border border-slate-200">쉼표 추가 ( , )</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {!isTimedRound && (
                <div className="flex flex-col gap-3 mt-auto shrink-0">
                  <div className="flex gap-3 w-full">
                    <button onClick={submitSingleAnswer} disabled={timeIsUp || isCall || isRecheck || isSubmitting || isCurrentAlreadyCorrect} className="w-2/3 bg-[#002864] hover:bg-blue-900 text-white font-extrabold text-xl py-5 rounded-xl shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      {isCurrentAlreadyCorrect ? '✅ 정답 완료' : isSubmitting ? '채점 중...' : '✅ 정답 입력'}
                    </button>
                    <button onClick={handleCallAction} disabled={timeIsUp || callCooldown.isActive || (!callState.current[currentQIndex] && myAwayActive) || isRecheck} className={`w-1/3 font-extrabold text-xl py-5 rounded-xl shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isCall ? 'bg-rose-700 text-white' : 'bg-rose-500 text-white hover:bg-rose-600'}`}>
                      {callCooldown.isActive ? `⏳ ${Math.ceil(callCooldown.remainingMs / 1000)}초` : isCall ? '🚨 호출 취소' : '🙋 호출'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <ViewerModals
        hintModal={hintModal}
        setHintModal={setHintModal}
        onConfirmHint={async () => {
          if (hintRequestInFlightRef.current) return;
          hintRequestInFlightRef.current = true;
          try {
            const cost = hintModal.cost;
            if (hintState.current[currentQIndex]?.revealed) { setHintModal(null); return; }
            setHintModal((prev: any) => prev && { ...prev, loading: true });
            
            let finalHintText = q.hintText;
            if (!finalHintText && q.needsAiHint) {
              finalHintText = await generateAiHint(q.questionText);
            } else if (!finalHintText) {
              finalHintText = "등록된 힌트가 없습니다.";
            }

            const res = await spendPoints(studentInfo.id, cost);
            if (!res.success) { setHintModal(null); alert(res.message || '포인트가 부족합니다.'); return; }
            setPoints(res.balance);
            
            const hq = hintState.current[currentQIndex] || { revealed: false, hintText: '' };
            hq.revealed = true; 
            hq.hintText = finalHintText;
            hintState.current[currentQIndex] = hq; 
            saveHintState(studentInfo.id, q, hq);
            setHintPanelExpanded(true);
            sendAction('hint', { qNum: currentQIndex + 1, level: 1 });
            setHintModal(null); 
            forceUpdate();
          } finally {
            hintRequestInFlightRef.current = false;
          }
        }}
        resultModal={resultModal}
        setResultModal={setResultModal}
        onRetry={() => {
          studentAnswers.current[currentQIndex] = null;
          delete studentDrawings.current[currentQIndex];
          delete keypadAnswers.current[currentQIndex];
          delete keypadCursor.current[currentQIndex];
          forceUpdate();
          setTimeout(() => initCanvas(currentQIndex), 50);
        }}
        onRequestRecheck={requestRecheck}
        sessionTimeUpModal={sessionTimeUpModal}
        timeUpModal={timeUpModal}
        submitConfirmModal={submitConfirmModal}
        setSubmitConfirmModal={setSubmitConfirmModal}
        onSubmitConfirm={() => handleTimeUp()}
        submitResultModal={submitResultModal}
        pendingRecheckReview={pendingRecheckReview}
        requestRecheckForReviewItem={requestRecheckForReviewItem}
        recheckToast={recheckToast}
        autoLeaveSec={autoLeaveSec}
        correctSolvedCount={correctSolvedCountRef.current}
        totalQuestions={totalQuestionsInRoundRef.current}
        unansweredCount={questions.filter((_, i) => !studentAnswers.current[i]).length}
        logoutTarget={logoutTarget}
        onLeave={handleLeaveByTarget}
      />
    </div>
  );
}