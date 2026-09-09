// src/app/clinic/viewer/page.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { closeSessionAtLimit, setActiveCall, clearActiveCall, setActiveRecheck, setAway, clearAway, checkAndBumpToggleCooldown } from "@/lib/clinicSession";
import { useToggleCooldown, TOGGLE_COOLDOWN_MS } from "@/hooks/useToggleCooldown";
import { getActiveSeatLayout } from "@/app/actions/clinicSeatLayout";
import { spendPoints } from "@/app/actions/shopPoints";
import { BOOK_TYPE_COLORS } from "@/lib/clinicHomework";
import PointBadge from "@/components/clinic/PointBadge";

import { generateIncorrectPrint, finalizeSessionData } from '@/lib/clinicPrintActions';
import { useClinicTimer } from "./hooks/useClinicTimer";
import { useClinicDataFetch } from "./hooks/useClinicDataFetch";
import { useClinicRealtime } from "./hooks/useClinicRealtime";

import { ClinicCanvas } from "./components/ClinicCanvas";
import { ClinicKeypad } from "./components/ClinicKeypad";
import { ClinicQuestionNav } from "./components/ClinicQuestionNav";
import { QuestionDisplay } from "./components/QuestionDisplay";
import { ViewerModals } from "./components/ViewerModals";
import { HintRevealBox } from "./components/HintRevealBox"; 

import {
  SUPABASE_URL, SUPABASE_ANON_KEY, ROUND1_TIME_LIMIT_SECONDS,
  PEN_COLORS, ERASER_WIDTH_MULTIPLIER, getKSTDateString, formatMathTextForWeb,
  saveHintState, keypadAnswersMatch, isKeypadEnterable, mcAnswersMatch, isObjectiveQuestion
} from "./utils";

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function ClinicViewer() {
  const router = useRouter();

  const [isStarted, setIsStarted] = useState(false);
  const [studentInfo, setStudentInfo] = useState({ id: '', name: '학생', classes: [] as string[] });
  
  const [params, setParams] = useState({ round: 0, className: '', weekType: 'odd', assignmentId: '', homeworkIdsStr: '', assignmentIdsStr: '', overdue: false, retry: false });
  
  const [points, setPoints] = useState<number | null>(null);
  const [timeIsUp, setTimeIsUp] = useState(false);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [bookFilter, setBookFilter] = useState<string | 'all'>('all');

  const [, setUiTrigger] = useState(0);
  const forceUpdate = useCallback(() => setUiTrigger(p => p + 1), []);

  const studentAnswers = useRef<Record<number, string | null>>({});
  const studentDrawings = useRef<Record<number, string>>({});
  const keypadAnswers = useRef<Record<number, string>>({});
  const keypadCursor = useRef<Record<number, number>>({});
  const answerModes = useRef<Record<number, 'keypad' | 'pen'>>({});
  const qBoxStatus = useRef<any>({});
  const callState = useRef<Record<number, boolean>>({});
  const recheckState = useRef<Record<number, 'pending' | null>>({});
  const taHintState = useRef<Record<number, boolean>>({});
  const hintState = useRef<Record<number, any>>({});
  const totalQuestionsInRoundRef = useRef(0);
  const correctSolvedCountRef = useRef(0);
  const examAssignmentTotalsRef = useRef<Record<string, number>>({});
  
  const mySeatRef = useRef<string | null>(null);
  const seatKeysRef = useRef<string[]>([]);
  const clinicSessionStateRef = useRef<any>(null);

  const [editorLocked, setEditorLocked] = useState(false);
  const [recheckToast, setRecheckToast] = useState("");
  const [myAwayActive, setMyAwayActive] = useState(false);
  const [pendingRecheckReview, setPendingRecheckReview] = useState<any[]>([]);
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [canvasClearTrigger, setCanvasClearTrigger] = useState(0); 

  const callCooldown = useToggleCooldown(TOGGLE_COOLDOWN_MS);
  const awayCooldown = useToggleCooldown(TOGGLE_COOLDOWN_MS);

  const [callCooldownUntil, setCallCooldownUntil] = useState<number>(0);
  const [remainCallSec, setRemainCallSec] = useState(0);

  const autoLeaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 🌟 동적으로 설정된 제한 시간(초)을 화면 렌더링에 사용하기 위해 상태 추가
  const [dynamicTimeLimitMin, setDynamicTimeLimitMin] = useState<number>(20);

  useEffect(() => {
    if (callCooldownUntil <= 0) return;
    const tick = () => {
      const remain = Math.ceil((callCooldownUntil - Date.now()) / 1000);
      if (remain <= 0) {
        setRemainCallSec(0);
      } else {
        setRemainCallSec(remain);
      }
    };
    tick(); 
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [callCooldownUntil]);

  useEffect(() => {
      return () => {
          if (autoLeaveTimerRef.current) clearInterval(autoLeaveTimerRef.current);
      };
  }, []);

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
    const retry = p.get('retry') === 'true';

    if (!round || isNaN(round) || !className) {
      alert('잘못된 접근입니다. 포털에서 다시 시작해주세요.');
      router.push('/student/portal'); return;
    }

    setParams({ round, className, weekType, assignmentId, homeworkIdsStr, assignmentIdsStr, overdue, retry });
    
    initMathJax();
    initSession(sId, round, className);

    const handleUnload = () => untrackPresence();
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      untrackPresence();
    };
  }, []);

  const { questions, setQuestions, pendingQCount, globalExamTitle, isTimedRound: fetchedIsTimedRound, fetchQuestions } = useClinicDataFetch({
    supabaseClient, studentInfo, params, forceUpdate,
    refs: { studentAnswers, studentDrawings, keypadAnswers, answerModes, qBoxStatus, totalQuestionsInRoundRef, hintState, correctSolvedCountRef, examAssignmentTotalsRef }
  });

  const isTimedRound = fetchedIsTimedRound && !params.retry;

  // 🌟 질문 데이터를 다 불러왔을 때, 동적으로 설정된 제한 시간(초)을 분(Minute)으로 변환하여 UI에 반영
  useEffect(() => {
    if (questions.length > 0 && typeof window !== 'undefined' && (window as any).__dynamicTimeLimit) {
        setDynamicTimeLimitMin((window as any).__dynamicTimeLimit / 60);
    }
  }, [questions]);

  const processCorrectAnswerRef = useRef<any>(null);
  const handleTimeUpRef = useRef<any>(null);
  const persistExamAnswersToDBRef = useRef<any>(null);
  const getAnswerMode = (idx: number, qItem: any): 'pen' | 'keypad' => {
    const explicit = answerModes.current[idx];
    if (explicit) return explicit;
    if (studentDrawings.current[idx]) return 'pen';
    if (qItem && !isKeypadEnterable(qItem.answer)) return 'pen';
    return 'keypad';
  };

  const { initSession, untrackPresence, sendAction } = useClinicRealtime({
    supabaseClient, studentInfo, params, questions, currentQIndex, isTimedRound,
    mySeatRef, seatKeysRef, clinicSessionStateRef, callState, recheckState, taHintState, qBoxStatus,
    studentAnswers, studentDrawings, keypadAnswers, keypadCursor, correctSolvedCountRef,
    setEditorLocked, setRecheckToast, setMyAwayActive, setPendingRecheckReview, setSessionInfo, setPoints, setCanvasClearTrigger, forceUpdate,
    processCorrectAnswer: (...args) => processCorrectAnswerRef.current(...args),
    handleTimeUp: (...args) => handleTimeUpRef.current(...args),
    persistExamAnswersToDB: () => persistExamAnswersToDBRef.current(),
    getAnswerMode, router, callCooldown, awayCooldown
  });

  const penGradeCache = useRef<Record<number, boolean>>({});
  const penGradeMetaCache = useRef<Record<number, any>>({});
  const penGradeInFlight = useRef<Record<number, Promise<void> | undefined>>({});
  const hintRequestInFlightRef = useRef(false);

  const [currentPenWidth, setCurrentPenWidth] = useState(3);
  const [currentPenColor, setCurrentPenColor] = useState(PEN_COLORS[0]);
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [keypadCollapsed, setKeypadCollapsed] = useState(false);
  const [hintPanelExpanded, setHintPanelExpanded] = useState(true);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBatchGrading, setIsBatchGrading] = useState(false); 

  const [resultModal, setResultModal] = useState<any>(null);
  const [timeUpModal, setTimeUpModal] = useState(false);
  const [sessionTimeUpModal, setSessionTimeUpModal] = useState(false);
  const [submitConfirmModal, setSubmitConfirmModal] = useState(false);
  const [submitResultModal, setSubmitResultModal] = useState(false);
  const [hintModal, setHintModal] = useState<any>(null);
  const [emptyState, setEmptyState] = useState<any>(null);
  
  const [awaitingReview, setAwaitingReview] = useState(false);
  const awaitingReviewSinceRef = useRef<string | null>(null);
  const [autoLeaveSec, setAutoLeaveSec] = useState(10);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutTarget, setLogoutTarget] = useState<'portal' | 'login'>('portal');

  const optionsRef = useRef<HTMLDivElement>(null);
  const mathJaxRef = useRef(false);
  const lastGradingContextRef = useRef<any>(null);

  const { clinicRemainingStr, isClinicUrgent, roundRemainingSec } = useClinicTimer({
    isStarted, isTimedRound, timeIsUp, clinicSessionStateRef, supabaseClient, handleTimeUp: (f, s) => handleTimeUpRef.current(f, s)
  });

  useEffect(() => {
    const myTenantId = localStorage.getItem("logica_tenant_id") || "hq";
    getActiveSeatLayout(myTenantId).then(layout => {
      seatKeysRef.current = layout.seats.map(s => String(s.number));
    });
  }, []);

  useEffect(() => {
    if (bookFilter === 'all') return;
    const cur = questions[currentQIndex];
    if (!cur || cur.bookType !== bookFilter) setBookFilter('all');
  }, [currentQIndex, questions, bookFilter]);

  useEffect(() => {
    if (params.round > 0 && studentInfo.id) {
      fetchQuestions();
    }
  }, [params, studentInfo.id, fetchQuestions]);

  useEffect(() => {
    if (questions.length === 0) return;
    const draft = clinicSessionStateRef.current?.draft_progress;
    if (!draft) return;
    if (draft.round !== params.round || draft.className !== params.className || draft.weekType !== params.weekType ||
        draft.assignmentId !== params.assignmentId || draft.homeworkIdsStr !== params.homeworkIdsStr) return;
    const idx = draft.qIndex;
    if (idx < 0 || idx >= questions.length) return;

    const qItem = questions[idx];
    if (draft.mode === 'pen') {
      studentDrawings.current[idx] = draft.answer;
      studentAnswers.current[idx] = draft.answer;
    } else if (isObjectiveQuestion(qItem)) {
      studentAnswers.current[idx] = draft.answer;
    } else {
      keypadAnswers.current[idx] = draft.answer;
    }
    setCurrentQIndex(idx);
    forceUpdate();
  }, [questions, params]);

  const questionsRef = useRef(questions);
  useEffect(() => { questionsRef.current = questions; }, [questions]);

  useEffect(() => {
    if (!isStarted || questionsRef.current.length === 0) return;
    
    const currentQs = questionsRef.current;
    const isHomework = !!currentQs[0]?.homework_id;
    const tableName = isHomework ? 'student_homework_answer' : 'student_answer';
    const channelId = `sv_sync_grading_${studentInfo.id}_${Date.now()}`;

    const channel = supabaseClient.channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, (payload) => {
        const newData = payload.new as any;
        if (!newData || String(newData.student_id) !== String(studentInfo.id)) return;
        
        const isMatch = isHomework 
          ? String(newData.homework_id) === String(currentQs[0].homework_id)
          : true; 
          
        if (isMatch) {
          const targetQId = isHomework ? newData.tq_id : newData.question_id;
          const idx = questionsRef.current.findIndex((q: any) => String(isHomework ? q.tq_id : q.question_id) === String(targetQId));
          
          if (idx !== -1) {
             const code = newData.grading_code;
             if (code) {
                let isChanged = false;

                if (recheckState.current[idx] === 'pending') {
                   recheckState.current[idx] = null;
                   isChanged = true;
                }

                if (['O', 'TO', 'RO'].includes(code)) {
                   const expectedStatus = code === 'O' ? 'correct_blue' : (code === 'TO' ? 'correct_yellow' : 'retry_yellow');
                   if (!['correct_blue', 'correct_yellow', 'retry_yellow'].includes(qBoxStatus.current[idx])) {
                      qBoxStatus.current[idx] = expectedStatus;
                      correctSolvedCountRef.current++;
                      isChanged = true;
                      setRecheckToast(`🎉 선생님이 ${idx + 1}번을 맞게 채점했어요!`);
                      setTimeout(() => setRecheckToast(""), 4000);
                   }
                } else if (['X', 'TX', '☆', 'B'].includes(code)) {
                   if (qBoxStatus.current[idx] !== 'wrong_red') {
                      qBoxStatus.current[idx] = 'wrong_red';
                      isChanged = true;
                      setRecheckToast(`❌ 선생님이 ${idx + 1}번을 오답 처리했어요.`);
                      setTimeout(() => setRecheckToast(""), 4000);
                   }
                }
                
                if (isChanged) forceUpdate();
             }
          }
        }
      })
      .subscribe();

    return () => { supabaseClient.removeChannel(channel); };
  }, [isStarted, params, studentInfo.id, forceUpdate]);

  const initMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]], processEscapes: true }, chtml: { displayAlign: 'left' } };
      const script = document.createElement("script"); script.id = "MathJax-script"; script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"; script.async = true;
      script.onload = () => { (window as any).MathJax?.typesetPromise?.().catch((err: any) => console.error("MathJax 타이프셋 에러:", err)); };
      document.head.appendChild(script);
    }
  };

  const handleClearCanvas = () => {
    delete studentDrawings.current[currentQIndex];
    studentAnswers.current[currentQIndex] = null;
    setCanvasClearTrigger(p => p + 1);
    forceUpdate();
  };

  const toggleAnswerMode = () => {
    const current = getAnswerMode(currentQIndex, questions[currentQIndex]);
    const mode = current === 'pen' ? 'keypad' : 'pen';
    if (mode === 'keypad' && !isKeypadEnterable(questions[currentQIndex]?.answer)) return;
    answerModes.current[currentQIndex] = mode;
    studentAnswers.current[currentQIndex] = mode === 'pen' ? (studentDrawings.current[currentQIndex] || null) : (keypadAnswers.current[currentQIndex] || null);
    forceUpdate();
  };

  const toggleEraser = () => {
    setIsEraserMode(!isEraserMode);
  };

  const handleCallAction = async () => {
    const now = Date.now();
    if (now < callCooldownUntil) {
      const remainSec = Math.ceil((callCooldownUntil - now) / 1000);
      alert(`장난 호출을 막기 위해 1분의 대기 시간이 있습니다.\n${remainSec}초 후에 다시 눌러주세요!`);
      return;
    }

    if (!callState.current[currentQIndex] && myAwayActive) { 
      alert('자리비움 중에는 호출 불가합니다.'); 
      return; 
    }
    
    const willCall = !callState.current[currentQIndex];
    callState.current[currentQIndex] = willCall;
    forceUpdate();
    
    const qItem = questions[currentQIndex];
    const callPayload = { qNum: currentQIndex + 1, questionText: qItem.questionText, imageUrl: qItem.imageUrl, options: qItem.options, answer: qItem.answer, explanation: qItem.explanation, source: qItem.source };
    sendAction(willCall ? 'call' : 'cancel_call', willCall ? callPayload : { qNum: currentQIndex + 1 });
    
    const sid = clinicSessionStateRef.current?.id;
    if (sid) {
      willCall ? setActiveCall(supabaseClient, sid, currentQIndex + 1, callPayload) : clearActiveCall(supabaseClient, sid, currentQIndex + 1);
    }

    setCallCooldownUntil(Date.now() + 60000);
    setRemainCallSec(60);

    if (willCall) {
      setTimeout(() => {
        alert("선생님을 호출했습니다. 자리에서 잠시만 기다려주세요!");
      }, 100);
    }
  };

  const handleAwayToggle = async () => {
    if (awayCooldown.isActive) return;
    const sid = clinicSessionStateRef.current?.id;
    if (sid) {
      const cooldown = await checkAndBumpToggleCooldown(supabaseClient, sid, 'away');
      awayCooldown.startUntil(new Date(cooldown.cooldownUntil).getTime());
      if (!cooldown.ok) return;
    } else { awayCooldown.start(); }
    
    const next = !myAwayActive;
    setMyAwayActive(next);
    sendAction(next ? 'away' : 'cancel_away');
    if (sid) { next ? setAway(supabaseClient, sid) : clearAway(supabaseClient, sid); }
  };

  const hasActiveCallForGuard = Object.values(callState.current).some(v => v);
  const hasPendingRecheckForGuard = Object.values(recheckState.current).some(v => v === 'pending');
  const isNavigationBlocked = myAwayActive || hasActiveCallForGuard || hasPendingRecheckForGuard || awaitingReview;

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => { 
      if ((window as any).__isForceRefreshing) return;
      if (!isNavigationBlocked) return; 
      e.preventDefault(); 
      e.returnValue = ''; 
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isNavigationBlocked]);

  useEffect(() => {
    if (!isNavigationBlocked) return;
    const blockBack = () => { window.history.pushState(null, '', window.location.href); alert('자리비움/호출/재확인 처리 중에는 화면을 이동할 수 없습니다. 상태 해제 후 다시 시도해주세요.'); };
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', blockBack);
    return () => window.removeEventListener('popstate', blockBack);
  }, [isNavigationBlocked]);

  useEffect(() => {
    if (!awaitingReview || !studentInfo.id) return;
    let cancelled = false;
    const since = awaitingReviewSinceRef.current;
    const check = async () => {
      const { data } = await supabaseClient.from('exam_assignment')
        .select('assignment_id, created_at, exam_master!inner(exam_type)')
        .eq('student_id', studentInfo.id).eq('exam_master.exam_type', '오답프린트')
        .gt('created_at', since || new Date(0).toISOString()).limit(1);
      if (!cancelled && data && data.length > 0) setAwaitingReview(false);
    };
    check();
    const itv = setInterval(check, 5000);
    const rebroadcast = () => sendAction('submit', { score: correctSolvedCountRef.current });
    rebroadcast();
    const rebroadcastItv = setInterval(rebroadcast, 8000);
    return () => { cancelled = true; clearInterval(itv); clearInterval(rebroadcastItv); };
  }, [awaitingReview, studentInfo.id]);

  const startClinic = () => {
    if (questions.length === 0) return;
    setIsStarted(true);
    
    if (params.retry) {
        const firstWrongIdx = questions.findIndex((_, i) => {
            const st = qBoxStatus.current[i];
            return !st || st === 'wrong_red' || st === 'B' || st === 'X' || st === 'TX';
        });
        if (firstWrongIdx !== -1) {
            setCurrentQIndex(firstWrongIdx);
        } else {
            setEmptyState({ title: '모든 오답을 해결했습니다!', desc: '더 이상 풀 문제가 정없습니다. 홈으로 돌아가세요.' });
        }
    } else if (!isTimedRound && questions.length === 0) {
      setEmptyState({ title: '모든 오답을 해결했습니다!', desc: '더 이상 풀 문제가 없습니다. 홈으로 돌아가세요.' });
    }
    setTimeout(() => { if ((window as any).MathJax) (window as any).MathJax.typesetPromise(); }, 100);
  };

  const gradeHandwrittenAnswerWithGemini = async (dataUrl: string, correct: string, qText: string): Promise<any> => {
    const res = await fetch('/api/clinic-grade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageDataUrl: dataUrl, correct, questionText: qText }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API 오류');
    return data;
  };

  const generateAiHint = async (qText: string): Promise<string> => {
    try {
      const res = await fetch('/api/clinic-hint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionText: qText }) });
      if (!res.ok) throw new Error('API 오류');
      const data = await res.json();
      return (data.hint || '').trim() || '문제의 조건을 다시 한번 꼼꼼히 읽고 식을 세워보세요.';
    } catch (e) { return '문제의 조건을 다시 한번 꼼꼼히 읽고 식을 세워보세요.'; }
  };

  const ensurePenGraded = useCallback((idx: number): Promise<void> => {
    if (penGradeCache.current[idx] !== undefined) return Promise.resolve();
    if (penGradeInFlight.current[idx]) return penGradeInFlight.current[idx];
    const qItem = questions[idx];
    const isSubj = qItem && !isObjectiveQuestion(qItem);
    const mode = getAnswerMode(idx, qItem);
    const drawing = studentDrawings.current[idx];
    if (!qItem || !isSubj || mode !== 'pen' || !drawing) return Promise.resolve();
    const p = gradeHandwrittenAnswerWithGemini(drawing, qItem.answer, qItem.questionText)
      .then((meta: any) => { penGradeCache.current[idx] = !!meta.is_correct; penGradeMetaCache.current[idx] = meta; })
      .catch(() => {})
      .finally(() => { delete penGradeInFlight.current[idx]; });
    penGradeInFlight.current[idx] = p;
    return p;
  }, [questions]);

  const isQuestionCorrect = useCallback(async (idx: number): Promise<boolean> => {
    const qItem = questions[idx];
    if (!qItem) return false;
    const isSubj = !isObjectiveQuestion(qItem);
    const mode = getAnswerMode(idx, qItem);
    if (isSubj && mode === 'pen') { await ensurePenGraded(idx); return !!penGradeCache.current[idx]; }
    if (isSubj) return keypadAnswersMatch(studentAnswers.current[idx], qItem.answer);
    return mcAnswersMatch(studentAnswers.current[idx], qItem.answer);
  }, [questions, ensurePenGraded]);

  useEffect(() => {
    if (!isTimedRound || !isStarted) return;
    const leavingIdx = currentQIndex;
    return () => { ensurePenGraded(leavingIdx); };
  }, [currentQIndex, isTimedRound, isStarted, ensurePenGraded]);

  const persistExamAnswersToDB = async (): Promise<number> => {
    if (!isTimedRound || !params.assignmentId) return 0;
    await supabaseClient.from('student_answer').delete().eq('exam_assignment_id', params.assignmentId).eq('student_id', studentInfo.id);

    const inserts: any[] = []; const incUpserts: any[] = []; let totalScore = 0;
    for (let idx = 0; idx < questions.length; idx++) {
      const qItem = questions[idx];
      const ans = studentAnswers.current[idx] ? String(studentAnswers.current[idx]).trim() : '미입력';
      const isCorrect = await isQuestionCorrect(idx);
      const score = isCorrect ? (100 / totalQuestionsInRoundRef.current) : 0;
      totalScore += score;

      inserts.push({ exam_assignment_id: params.assignmentId, student_id: studentInfo.id, question_id: qItem.question_id, student_input: ans, is_correct: isCorrect, earned_score: score, grading_code: isCorrect ? 'O' : 'X', grading_status: '대기' });
      if (!isCorrect && qItem.question_id) { incUpserts.push({ student_id: studentInfo.id, question_id: qItem.question_id, source_type: '시험지', status: ans === '미입력' ? 'B' : 'X', resolved_at: null }); }
    }

    if (inserts.length > 0) await supabaseClient.from('student_answer').insert(inserts);
    if (incUpserts.length > 0) await supabaseClient.from('student_incorrect_record').upsert(incUpserts, { onConflict: 'student_id, question_id' });
    return totalScore;
  };
  persistExamAnswersToDBRef.current = persistExamAnswersToDB;

  const saveExamResultsToDB = async () => {
    if (!isTimedRound || !params.assignmentId) return;
    const totalScore = await persistExamAnswersToDB();
    await supabaseClient.from('exam_assignment').update({ status: '제출완료', total_score: totalScore }).eq('assignment_id', params.assignmentId);
  };

  const processSessionEnd = async () => {
    try {
        const incorrectQIds: number[] = []; const unansweredQIds: number[] = []; const statusMap: Record<number, string> = {};
        let corrects = 0;

        questions.forEach((qItem, i) => {
            const status = qBoxStatus.current[i];
            const isResolved = status === 'correct_blue' || status === 'correct_yellow' || status === 'retry_yellow' || status === 'O' || status === 'TO' || status === 'RO';

            if (isResolved) {
                corrects++;
            } else if (qItem.question_id) {
                const isSubj = !isObjectiveQuestion(qItem);
                const mode = getAnswerMode(i, qItem);
                const ans = isSubj && mode === 'pen' ? studentDrawings.current[i] : studentAnswers.current[i];
                const isBlank = !ans || String(ans).trim() === '' || String(ans).trim() === '미입력';

                if (isBlank) {
                    if (params.round === 2) unansweredQIds.push(qItem.question_id); 
                    else { incorrectQIds.push(qItem.question_id); statusMap[qItem.question_id] = 'B'; }
                } else {
                    incorrectQIds.push(qItem.question_id);
                    statusMap[qItem.question_id] = 'X';
                }
            }
        });
        correctSolvedCountRef.current = corrects;
        await finalizeSessionData(supabaseClient, studentInfo, params, globalExamTitle, isTimedRound, incorrectQIds, unansweredQIds, statusMap, questions);
    } catch (err) { console.error('Error during processSessionEnd:', err); }
  };

  const handleTimeUp = async (forceAction?: string, sessionExpired = false) => {
    setTimeIsUp(true); setIsBatchGrading(true);

    if (isTimedRound) {
        let corrects = 0;
        for (let idx = 0; idx < questions.length; idx++) {
            const currentStatus = qBoxStatus.current[idx];
            if (currentStatus === 'correct_blue' || currentStatus === 'correct_yellow' || currentStatus === 'retry_yellow' || currentStatus === 'O' || currentStatus === 'TO' || currentStatus === 'RO') {
                corrects++;
                continue;
            }

            const qItem = questions[idx];
            const isSubj = !isObjectiveQuestion(qItem);
            const mode = getAnswerMode(idx, qItem);
            const ans = isSubj && mode === 'pen' ? studentDrawings.current[idx] : studentAnswers.current[idx];
            const isBlank = !ans || String(ans).trim() === '' || String(ans).trim() === '미입력';

            if (isBlank) {
                qBoxStatus.current[idx] = 'wrong_red';
            } else {
                const isCorrect = await isQuestionCorrect(idx);
                if (isCorrect) {
                    qBoxStatus.current[idx] = 'correct_blue';
                    corrects++;
                } else {
                    qBoxStatus.current[idx] = 'wrong_red';
                }
            }
        }
        correctSolvedCountRef.current = corrects;
        forceUpdate(); 
    }

    await processSessionEnd(); 

    const wholeSessionEnd = sessionExpired || forceAction === 'force_checkout' || forceAction === 'force_checkout_by_ta';
    setLogoutTarget(wholeSessionEnd ? 'login' : 'portal');

    const reviewList: any[] = [];
    setPendingRecheckReview(reviewList);
    
    if (isTimedRound) await saveExamResultsToDB();
    setIsBatchGrading(false);

    if (forceAction) setSessionTimeUpModal(true);
    else if (isTimedRound) setSubmitResultModal(true);
    else setSessionTimeUpModal(true);

    if (reviewList.length === 0) {
      let sec = 10; setAutoLeaveSec(sec);
      autoLeaveTimerRef.current = setInterval(() => { 
          sec--; 
          setAutoLeaveSec(sec); 
          if (sec <= 0) { 
              if (autoLeaveTimerRef.current) clearInterval(autoLeaveTimerRef.current);
              (wholeSessionEnd ? finalizeAndGoToLogin : leaveAndGoHome)(); 
          } 
      }, 1000);
    }
  };
  handleTimeUpRef.current = handleTimeUp;

  const appendToExistingIncorrectPrint = async (qItem: any) => {
    if (!qItem.question_id) return;
    try {
      const { data: assignments } = await supabaseClient.from('exam_assignment')
        .select('assignment_id, exam_id, status, exam_master!inner(exam_type, total_questions)').eq('student_id', studentInfo.id).eq('exam_master.exam_type', '오답프린트')
        .not('status', 'in', '("제출완료", "채점완료", "완료")').order('created_at', { ascending: false }).limit(1);

      if (assignments && assignments.length > 0) {
        const assign = assignments[0]; const examId = assign.exam_id;
        const { data: existingItem } = await supabaseClient.from('exam_item').select('item_id').eq('exam_id', examId).eq('question_id', qItem.question_id).maybeSingle();
        if (!existingItem) {
          const { count } = await supabaseClient.from('exam_item').select('*', { count: 'exact', head: true }).eq('exam_id', examId);
          const nextSortOrder = (count || 0) + 1;
          await supabaseClient.from('exam_item').insert({ exam_id: examId, question_id: qItem.question_id, sort_order: nextSortOrder });
          await supabaseClient.from('exam_master').update({ total_questions: nextSortOrder }).eq('exam_id', examId);
        }
      }
    } catch (err) { console.error('오답 프린트 추가 실패:', err); }
  };

  const submitSingleAnswer = async () => {
    const currentStatus = qBoxStatus.current[currentQIndex];
    const isAlreadyCorrect = currentStatus === 'correct_blue' || currentStatus === 'correct_yellow' || currentStatus === 'retry_yellow' || currentStatus === 'O' || currentStatus === 'TO' || currentStatus === 'RO';
    
    if (isSubmitting || timeIsUp || callState.current[currentQIndex] || recheckState.current[currentQIndex] === 'pending' || isAlreadyCorrect) return;
    
    const qItem = questions[currentQIndex];
    const isSubjective = !isObjectiveQuestion(qItem);
    const useAI = isSubjective && getAnswerMode(currentQIndex, qItem) === 'pen';
    const myAns = studentAnswers.current[currentQIndex];

    if (!myAns) { alert(useAI ? "답을 먼저 그려주세요!" : "정답을 먼저 입력해주세요!"); return; }

    if (useAI && qItem.aiGradable === false) { requestManualGradingDirect(currentQIndex, qItem, myAns); return; }

    setIsSubmitting(true);
    let isCorrect = false; let gradingMeta: any = null;

    if (useAI) {
      try {
        gradingMeta = await gradeHandwrittenAnswerWithGemini(myAns, qItem.answer, qItem.questionText);
        isCorrect = !!gradingMeta.is_correct;
      } catch (err: any) { setIsSubmitting(false); alert('채점 중 문제 발생:\n' + err.message); return; }
    } else if (isSubjective) { isCorrect = keypadAnswersMatch(myAns, qItem.answer); } 
    else { isCorrect = mcAnswersMatch(myAns, qItem.answer); }

    lastGradingContextRef.current = useAI ? { idx: currentQIndex, uid: qItem.uid, q: qItem, imageDataUrl: myAns, gradingMeta } : null;
    const gotTaHint = !!taHintState.current[currentQIndex];

    if (isCorrect) {
      await processCorrectAnswer(qItem, currentQIndex, false);
      setResultModal({ isCorrect: true, note: gotTaHint ? '선생님 힌트를 받아 해결했어요.' : null, canRecheck: false });
    } else if (useAI) {
      if (gotTaHint && qItem.record_id) {
          await supabaseClient.from('student_incorrect_record').update({ status: 'TX' }).eq('record_id', qItem.record_id);
          await appendToExistingIncorrectPrint(qItem);
      }
      recheckState.current[currentQIndex] = 'pending';
      const payload = {
        uid: qItem.uid, qNum: currentQIndex + 1, questionText: qItem.questionText, correctAnswer: qItem.answer,
        imageDataUrl: myAns, recognizedText: gradingMeta?.recognized_text || '', aiExplanation: gradingMeta?.explanation || '', aiConfidence: gradingMeta?.confidence || null, initial: true,
      };
      sendAction('recheck_request', payload);
      const sid = clinicSessionStateRef.current?.id;
      if (sid) setActiveRecheck(supabaseClient, sid, qItem.uid, payload);
      setRecheckToast('✏️ 선생님이 꼼꼼하게 확인하고 있어요. 잠시만 기다려주세요.'); setTimeout(() => setRecheckToast(""), 4000);
      forceUpdate();
    } else {
      qBoxStatus.current[currentQIndex] = 'wrong_red';
      if (qItem.record_id) { await bumpIncorrectRecord(qItem.record_id, gotTaHint ? 'TX' : 'X', false); await appendToExistingIncorrectPrint(qItem); }
      if (!isTimedRound) {
        const assignId = params.assignmentId;
        if (assignId) {
            const gradingCode = gotTaHint ? 'TX' : 'X';
            const { data: existingAns } = await supabaseClient.from('student_answer').select('answer_id, earned_score').eq('exam_assignment_id', assignId).eq('student_id', studentInfo.id).eq('question_id', qItem.question_id).maybeSingle();
            
            const ansPayload: any = { 
                exam_assignment_id: assignId, 
                student_id: studentInfo.id, 
                question_id: qItem.question_id, 
                student_input: myAns, 
                is_correct: false, 
                grading_code: gradingCode, 
                grading_status: '완료' 
            };
            
            if (params.retry) {
                ansPayload.earned_score = existingAns?.earned_score || 0; 
            }
            
            if (existingAns) await supabaseClient.from('student_answer').update(ansPayload).eq('answer_id', existingAns.answer_id);
            else await supabaseClient.from('student_answer').insert(ansPayload);
            
            if (!qItem.record_id && qItem.question_id) { qItem.record_id = await upsertIncorrectRecord(qItem, gradingCode); await appendToExistingIncorrectPrint(qItem); }
        } else if (qItem.homework_id) {
            const { data: existing } = await supabaseClient.from('student_homework_answer').select('hw_answer_id, wrong_attempts_log').eq('homework_id', qItem.homework_id).eq('student_id', studentInfo.id).eq('tq_id', qItem.tq_id).maybeSingle();
            let wrongLog = existing?.wrong_attempts_log || [];
            if (typeof wrongLog === 'string') try { wrongLog = JSON.parse(wrongLog); } catch(e){ wrongLog=[]; }
            if (!Array.isArray(wrongLog)) wrongLog = [];
            wrongLog.push({ input: myAns, at: new Date().toISOString() });
            const gradingCode = gotTaHint ? 'TX' : 'X';
            const payload = { homework_id: qItem.homework_id, student_id: studentInfo.id, tq_id: qItem.tq_id, student_input: myAns, is_correct: false, grading_code: gradingCode, earned_score: 0, wrong_attempts_log: wrongLog };
            if (existing) await supabaseClient.from('student_homework_answer').update(payload).eq('hw_answer_id', existing.hw_answer_id);
            else await supabaseClient.from('student_homework_answer').insert(payload);
            if (!qItem.record_id && (qItem.tq_id || qItem.question_id)) { qItem.record_id = await upsertIncorrectRecord(qItem, gradingCode); await appendToExistingIncorrectPrint(qItem); }
        }
      }
      setResultModal({ isCorrect: false, note: gotTaHint ? '선생님 힌트를 받았지만 아직 오답이에요. (TX로 기록됨)' : null, canRecheck: false });
    }
    setIsSubmitting(false);
  };

  const requestManualGradingDirect = (idx: number, qItem: any, imageDataUrl: string) => {
    recheckState.current[idx] = 'pending';
    const payload = { uid: qItem.uid, qNum: idx + 1, questionText: qItem.questionText, correctAnswer: qItem.answer, imageDataUrl, recognizedText: '', aiExplanation: '', aiConfidence: null, initial: true };
    sendAction('recheck_request', payload);
    const sid = clinicSessionStateRef.current?.id;
    if (sid) setActiveRecheck(supabaseClient, sid, qItem.uid, payload);
    setRecheckToast('✏️ 이 문제는 선생님이 직접 확인해요. 잠시만 기다려주세요.'); setTimeout(() => setRecheckToast(""), 4000);
    forceUpdate();
  };

  const findNextUnresolvedIndex = (fromIdx: number) => {
    const isResolved = (i: number) => {
        const st = qBoxStatus.current[i];
        return st === 'correct_blue' || st === 'correct_yellow' || st === 'retry_yellow' || st === 'O' || st === 'TO' || st === 'RO';
    };
    const n = questions.length;
    for (let step = 1; step <= n; step++) { const i = (fromIdx + step) % n; if (!isResolved(i)) return i; }
    return null;
  };

  const processCorrectAnswer = async (qItem: any, idx: number, fromRecheck: boolean) => {
    const currentStatus = qBoxStatus.current[idx];
    const isAlreadyCorrect = currentStatus === 'correct_blue' || currentStatus === 'correct_yellow' || currentStatus === 'retry_yellow' || currentStatus === 'O' || currentStatus === 'TO' || currentStatus === 'RO';
    if (isAlreadyCorrect) return; 

    const usedHint = hintState.current[idx] && hintState.current[idx].revealed;
    const helped = taHintState.current[idx] || usedHint;
    const wasWrongBefore = currentStatus === 'wrong_red' || currentStatus === 'X' || currentStatus === 'TX' || currentStatus === 'B';
    const newStatus = helped ? 'TO' : (wasWrongBefore || params.retry ? 'RO' : 'O');
    
    const resolved = !helped;

    correctSolvedCountRef.current++;
    qBoxStatus.current[idx] = wasWrongBefore ? 'retry_yellow' : (helped ? 'correct_yellow' : 'correct_blue');
    forceUpdate();

    if (fromRecheck && wasWrongBefore && !helped) {
      if (qItem.record_id) {
        await supabaseClient.from('student_incorrect_record').delete().eq('record_id', qItem.record_id); qItem.record_id = null;
      } else {
        const filterCol = qItem.tq_id ? 'tq_id' : 'question_id'; const filterVal = qItem.tq_id ?? qItem.question_id;
        if (filterVal) { await supabaseClient.from('student_incorrect_record').delete().eq('student_id', studentInfo.id).eq(filterCol, filterVal); }
      }
    } else {
      if (qItem.record_id) { await bumpIncorrectRecord(qItem.record_id, newStatus, resolved); }
      else {
        const filterCol = qItem.tq_id ? 'tq_id' : 'question_id'; const filterVal = qItem.tq_id ?? qItem.question_id;
        if (filterVal) {
          const { data: matches } = await supabaseClient.from('student_incorrect_record').select('record_id').eq('student_id', studentInfo.id).eq(filterCol, filterVal).is('resolved_at', null);
          for (const m of (matches || [])) await bumpIncorrectRecord(m.record_id, newStatus, resolved);
        }
      }
    }

    if (!isTimedRound) {
        const assignId = params.assignmentId;
        if (assignId) {
            const gradingCode = helped ? 'TO' : (params.retry || wasWrongBefore ? 'RO' : 'O');
            const { data: existingAns } = await supabaseClient.from('student_answer').select('answer_id, earned_score').eq('exam_assignment_id', assignId).eq('student_id', studentInfo.id).eq('question_id', qItem.question_id).maybeSingle();
            
            const ansPayload: any = { 
                exam_assignment_id: assignId, 
                student_id: studentInfo.id, 
                question_id: qItem.question_id, 
                student_input: studentAnswers.current[idx], 
                is_correct: true, 
                grading_code: gradingCode, 
                grading_status: '완료' 
            };
            
            if (params.retry) {
                ansPayload.earned_score = existingAns?.earned_score || 0; 
            }
            
            if (existingAns) await supabaseClient.from('student_answer').update(ansPayload).eq('answer_id', existingAns.answer_id);
            else await supabaseClient.from('student_answer').insert(ansPayload);
            
            if (!params.retry) {
                const remaining = (examAssignmentTotalsRef.current[assignId] || 1) - 1;
                examAssignmentTotalsRef.current[assignId] = remaining;
                if (remaining <= 0) await supabaseClient.from('exam_assignment').update({ status: '제출완료' }).eq('assignment_id', assignId);
            }
        } else if (qItem.homework_id) {
            const gradingCode = helped ? 'TO' : (wasWrongBefore ? 'RO' : 'O');
            const { data: existing } = await supabaseClient.from('student_homework_answer').select('hw_answer_id').eq('homework_id', qItem.homework_id).eq('student_id', studentInfo.id).eq('tq_id', qItem.tq_id).maybeSingle();
            const payload = { homework_id: qItem.homework_id, student_id: studentInfo.id, tq_id: qItem.tq_id, student_input: studentAnswers.current[idx], is_correct: true, grading_code: gradingCode, earned_score: 1 };
            if (existing) await supabaseClient.from('student_homework_answer').update(payload).eq('hw_answer_id', existing.hw_answer_id);
            else await supabaseClient.from('student_homework_answer').insert(payload);
            const { data: hwRes } = await supabaseClient.from('student_homework_result').select('hw_result_id, completed_tq_ids, homework_assignment(target_questions)').eq('homework_id', qItem.homework_id).eq('student_id', studentInfo.id).maybeSingle();
            if (hwRes) {
                let comp = typeof hwRes.completed_tq_ids === 'string' ? JSON.parse(hwRes.completed_tq_ids) : hwRes.completed_tq_ids;
                if (!Array.isArray(comp)) comp = [];
                const cSet = new Set(comp.map(Number)); cSet.add(Number(qItem.tq_id));
                
                const hwAssign: any = Array.isArray(hwRes.homework_assignment) 
                    ? hwRes.homework_assignment[0] 
                    : hwRes.homework_assignment;

                let tq = typeof hwAssign?.target_questions === 'string' 
                    ? JSON.parse(hwAssign.target_questions) 
                    : hwAssign?.target_questions;
                
                if (!Array.isArray(tq)) tq = [];
                const allDone = tq.every((id:any) => cSet.has(Number(id)));
                await supabaseClient.from('student_homework_result').update({ completed_tq_ids: [...cSet], status: allDone ? '채점완료' : undefined }).eq('hw_result_id', hwRes.hw_result_id);
            }
        }
    }

    const nextIdx = findNextUnresolvedIndex(idx);
    if (nextIdx === null) {
      setEmptyState({ title: '모든 문제를 해결했습니다!', desc: '수고하셨습니다. 이제 홈으로 돌아가세요.', awaited: false });
      sendAction('submit', { score: correctSolvedCountRef.current });
      
      if (params.retry && params.assignmentId) {
          await supabaseClient.from('exam_assignment').update({ status: '최종완료' }).eq('assignment_id', params.assignmentId);
      }
      
      try { localStorage.setItem(`logica_clinic_${studentInfo.id}_${params.className}_round${params.round}_score`, JSON.stringify({ correct: correctSolvedCountRef.current, total: totalQuestionsInRoundRef.current, savedAt: new Date().toISOString() })); } catch(e){}
      
      const incorrectQIds: number[] = []; const statusMap: Record<number, string> = {};
      questions.forEach((qi, i) => { const st = qBoxStatus.current[i]; if ((st === 'wrong_red' || st === 'X' || st === 'TX') && qi.question_id) { incorrectQIds.push(qi.question_id); statusMap[qi.question_id] = 'X'; } });
      if (incorrectQIds.length > 0) { await generateIncorrectPrint(supabaseClient, studentInfo, incorrectQIds, globalExamTitle, isTimedRound, statusMap); }
    } else {
      setCurrentQIndex(nextIdx);
      setTimeout(() => setCanvasClearTrigger(p=>p+1), 100);
    }
    forceUpdate();
  };
  processCorrectAnswerRef.current = processCorrectAnswer;

  const requestRecheck = () => {
    if (!lastGradingContextRef.current) return;
    const { idx, uid, q, imageDataUrl, gradingMeta } = lastGradingContextRef.current;
    setResultModal(null); recheckState.current[idx] = 'pending';
    const recheckPayload = { uid, qNum: idx + 1, questionText: q.questionText, correctAnswer: q.answer, imageDataUrl, recognizedText: gradingMeta?.recognized_text || '', aiExplanation: gradingMeta?.explanation || '', aiConfidence: gradingMeta?.confidence || null };
    sendAction('recheck_request', recheckPayload);
    const sid = clinicSessionStateRef.current?.id;
    if (sid) setActiveRecheck(supabaseClient, sid, uid, recheckPayload);
    lastGradingContextRef.current = null;
    setRecheckToast('🔄 선생님께 다시 확인해 달라고 요청했어요. 잠시만 기다려주세요.'); setTimeout(() => setRecheckToast(""), 4000);
    forceUpdate();
  };

  const requestRecheckForReviewItem = (item: any) => {
    recheckState.current[item.idx] = 'pending';
    const recheckPayload = {
      uid: item.uid, qNum: item.qNum, questionText: item.questionText, correctAnswer: item.correctAnswer, imageDataUrl: item.imageDataUrl, recognizedText: item.recognizedText, aiExplanation: item.aiExplanation, aiConfidence: item.aiConfidence,
      recordId: item.recordId, tqId: item.tqId, questionId: item.questionId, examAssignmentId: item.examAssignmentId, deferredWrite: true,
    };
    sendAction('recheck_request', recheckPayload);
    const sid = clinicSessionStateRef.current?.id;
    if (sid) setActiveRecheck(supabaseClient, sid, item.uid, recheckPayload);
    setPendingRecheckReview(prev => prev.map(r => r.uid === item.uid ? { ...r, requested: true } : r));
  };

  const bumpIncorrectRecord = async (recordId: number, status: string, resolved: boolean) => {
    const { data: cur } = await supabaseClient.from('student_incorrect_record').select('retry_count').eq('record_id', recordId).maybeSingle();
    await supabaseClient.from('student_incorrect_record').update({ status, retry_count: (cur?.retry_count || 0) + 1, resolved_at: resolved ? new Date().toISOString() : null }).eq('record_id', recordId);
  };

  const upsertIncorrectRecord = async (qData: any, status: string): Promise<number | undefined> => {
    const filterCol = qData.tq_id ? 'tq_id' : 'question_id'; const filterVal = qData.tq_id ?? qData.question_id;
    if (!filterVal) return undefined;
    const { data: existingRows } = await supabaseClient.from('student_incorrect_record').select('record_id').eq('student_id', studentInfo.id).eq(filterCol, filterVal).limit(1);
    if (existingRows?.[0]) { await supabaseClient.from('student_incorrect_record').update({ status, resolved_at: null }).eq('record_id', existingRows[0].record_id); return existingRows[0].record_id; }
    const { data: newRecord } = await supabaseClient.from('student_incorrect_record').insert({ student_id: studentInfo.id, tq_id: qData.tq_id ?? null, question_id: qData.question_id ?? null, source_type: '과제오답', status, resolved_at: null }).select('record_id').single();
    return newRecord?.record_id;
  };

  const leaveAndGoHome = async () => {
    if (autoLeaveTimerRef.current) clearInterval(autoLeaveTimerRef.current);
    setIsLoggingOut(true); sendAction('depart'); await untrackPresence(); router.push('/student/portal');
  };

  const requestLeaveToHome = () => {
    const hasActiveCall = Object.values(callState.current).some(v => v);
    const hasPendingRecheck = Object.values(recheckState.current).some(v => v === 'pending');
    if (myAwayActive || hasActiveCall || hasPendingRecheck) { alert('자리비움/질문/재확인 처리 중에는 포탈로 나갈 수 없습니다. 상태 해제 후 다시 시도해주세요.'); return; }
    if (window.confirm('아직 모든 문제를 푼 게 아니에요. 임시저장하고 밖으로 나갈까요?')) leaveAndGoHome();
  };

  const finalizeAndGoToLogin = async () => {
    if (autoLeaveTimerRef.current) clearInterval(autoLeaveTimerRef.current);
    setIsLoggingOut(true); await processSessionEnd(); sendAction('depart'); await untrackPresence();
    localStorage.removeItem('logica_student_id'); localStorage.removeItem('logica_student_name'); localStorage.removeItem('logica_student_phone');
    router.push('/student/login');
  };

  const handleLeaveByTarget = (target: 'portal' | 'login') => { if (target === 'login') finalizeAndGoToLogin(); else leaveAndGoHome(); };

  const q = questions[currentQIndex];
  const availableBooks = [...new Map(questions.filter(qq => qq.bookType != null).map(qq => [qq.bookType, qq])).values()]
    .map(qq => ({ bookType: qq.bookType, count: questions.filter(x => x.bookType === qq.bookType).length }));
  const visibleIndices = questions.map((_, i) => i).filter(i => bookFilter === 'all' || questions[i].bookType === bookFilter);
  
  const switchBookFilter = (bookType: string | 'all') => {
    setBookFilter(bookType);
    if (bookType !== 'all') {
      const idx = questions.findIndex(qq => qq.bookType === bookType);
      if (idx !== -1) { setCurrentQIndex(idx); setCanvasClearTrigger(p=>p+1); }
    }
  };

  const isSubjective = q && !isObjectiveQuestion(q);
  const curAnsMode = getAnswerMode(currentQIndex, q);
  const isCall = !!callState.current[currentQIndex];
  const isRecheck = recheckState.current[currentQIndex] === 'pending';
  const isCurrentAlreadyCorrect = qBoxStatus.current[currentQIndex] === 'correct_blue' || qBoxStatus.current[currentQIndex] === 'correct_yellow' || qBoxStatus.current[currentQIndex] === 'retry_yellow' || qBoxStatus.current[currentQIndex] === 'O' || qBoxStatus.current[currentQIndex] === 'TO' || qBoxStatus.current[currentQIndex] === 'RO';

  if (!isStarted) {
    let remainCount = 0; 
    questions.forEach((_, i) => { 
        const st = qBoxStatus.current[i]; 
        if (!st || st === 'wrong_red' || st === 'B' || st === 'X' || st === 'TX') remainCount++; 
    });

    const noQuestionsLeft = questions.length === 0 || (params.retry && remainCount === 0);

    const displayPendingInfo = params.retry 
        ? `${globalExamTitle || '시험 오답 정정'} : 남은 문제 ${remainCount}문항`
        : pendingQCount;

    return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 font-pretendard">
        <div className="bg-white rounded-[2rem] shadow-2xl p-10 w-full max-w-2xl text-center animate-[fadeIn_0.3s_ease-out]">
          <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-10 mx-auto mb-6 object-contain" />
          <h2 className="text-3xl font-black text-[#002864] tracking-tighter mb-4">학습 클리닉</h2>
          <p className="text-base text-slate-500 font-bold mb-8">
              {params.retry 
                ? (remainCount === 0 ? '🎉 오답이 없습니다! 완벽합니다.' : '채점이 확정되었습니다. 틀린 문제를 다시 고쳐보세요!') 
                : (isTimedRound ? '그동안의 노력을 테스트해보세요!' : params.round===3?'이번 회차 전에 끝내지 못한 과제를 마무리해봐요!':'배부된 과제를 풀어봐요!')}
          </p>
          <div className="mb-8 bg-slate-50 border border-slate-200 rounded-2xl p-6">
            <p className="text-sm font-bold text-slate-400 mb-1">학생 이름</p><p className="text-3xl font-extrabold text-slate-800">{studentInfo.name}</p>
            <div className="mt-4 flex flex-col items-center gap-2">
              <span className="text-sm font-bold text-rose-500 bg-rose-100 px-5 py-2 rounded-full shadow-sm">{displayPendingInfo}</span>
            </div>
          </div>
          
          {!noQuestionsLeft ? (
              <button onClick={startClinic} className="w-full bg-[#002864] hover:bg-blue-950 text-white font-bold py-5 text-xl rounded-2xl shadow-md transition-all">
                {params.retry ? '🚀 오답 정정 시작하기' : (isTimedRound ? `⏱️ ${dynamicTimeLimitMin}분 타이머 시작하기` : '🚀 풀이 시작하기')}
              </button>
          ) : (
              <div className="flex flex-col gap-4 mt-2">
                <div className="bg-emerald-50 text-emerald-600 font-bold py-4 rounded-xl border border-emerald-200 text-lg">
                  {params.retry ? '💯 모든 문제를 맞췄습니다! 완료 처리합니다.' : '풀 문제가 없습니다!'}
                </div>
                <button 
                  onClick={async () => {
                    setIsSubmitting(true);
                    if (params.retry && params.assignmentId) {
                        await supabaseClient.from('exam_assignment').update({ status: '최종완료' }).eq('assignment_id', params.assignmentId);
                    }
                    await processSessionEnd();
                    leaveAndGoHome();
                  }} 
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 text-xl rounded-2xl shadow-md transition-all"
                >
                  ✅ 완료하고 홈으로 가기
                </button>
              </div>
          )}
          
          {questions.length === 0 && !params.retry && (
            <div className="flex gap-4 mt-6">
              <button onClick={() => router.back()} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-4 text-lg rounded-2xl transition-all">이전 화면으로</button>
              <button onClick={leaveAndGoHome} className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-4 text-lg rounded-2xl shadow-md transition-all">홈으로 가기</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-100 h-screen flex flex-col font-pretendard select-none">
      {(isSubmitting || isBatchGrading) && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center px-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 flex flex-col items-center max-w-sm w-full text-center">
            <div className="w-12 h-12 border-4 border-blue-100 border-t-[#002864] rounded-full animate-spin mb-4 shadow-sm"></div>
            <h2 className="text-lg md:text-xl font-black text-slate-800 mb-2 tracking-tight">답안을 꼼꼼히 채점 중입니다</h2>
            <p className="text-slate-500 font-medium text-xs md:text-sm">선생님의 채점 기준을 바탕으로 분석하고 있어요.<br/>잠시만 기다려주세요...</p>
          </div>
        </div>
      )}

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
            <p className="text-sm text-slate-500">선생님이 좌석 배치를 편집하는 동안에는<br />기능이 잠시 멈춥니다. 잠시만 기다려주세요.</p>
          </div>
        </div>
      )}

      <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center shrink-0 z-20">
        <div className="flex items-center gap-4">
          <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-7 object-contain" />
          <div className="w-px h-6 bg-slate-300"></div>
          <h1 className="text-lg md:text-xl font-bold text-slate-800"><span>{studentInfo.name}</span> 학생의 오답 클리닉</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm transition-colors ${isClinicUrgent ? 'bg-rose-100 border-rose-300 animate-pulse text-rose-600' : 'bg-indigo-50 border border-indigo-200 text-indigo-600'}`} title="전체 이용 가능 시간">
            <span className="text-xl">🕐</span>
            <span className="text-xs font-bold opacity-80">남은 시간</span>
            <span className="text-base font-lexend font-black">{clinicRemainingStr}</span>
          </div>
          {isTimedRound && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm ${roundRemainingSec <= 60 ? 'bg-rose-100 animate-pulse text-rose-600' : 'bg-rose-50 border border-rose-200 text-rose-600'}`}>
              <span className="text-xl">⏱️</span>
              <span className="text-xs font-bold opacity-80">타이머</span>
              <span className="text-base font-lexend font-black">{String(Math.floor(roundRemainingSec/60)).padStart(2,'0')}:{String(roundRemainingSec%60).padStart(2,'0')}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 bg-yellow-50 border border-yellow-200 rounded-full px-3 py-1.5 shadow-sm">
             <span className="text-xs font-bold text-yellow-700 pl-1">나의 포인트</span>
             <PointBadge points={points} className="bg-transparent border-none text-yellow-700 shadow-none px-1 py-0" />
          </div>
          {(!isTimedRound || params.retry) && (
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
              {emptyState.desc}
            </p>
            {isTimedRound && <p className="text-lg font-bold text-[#002864] bg-white border border-slate-200 rounded-full px-5 py-1.5 mt-5 shadow-sm">정답률 {correctSolvedCountRef.current}/{totalQuestionsInRoundRef.current}</p>}
            <div className="flex gap-3 mt-8">
              <button onClick={() => router.back()} className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold px-8 py-3 text-lg rounded-xl transition-all">이전 화면으로</button>
              <button onClick={leaveAndGoHome} className="bg-[#002864] hover:bg-blue-900 text-white font-bold px-8 py-3 text-lg rounded-xl shadow-md transition-all">홈으로 돌아가기</button>
            </div>
          </div>
        )}

        {q && !emptyState && (
          <div className="w-full max-w-[1920px] grid grid-cols-[65fr_35fr] gap-6 md:gap-8 h-full relative">
            <div className="bg-white rounded-3xl shadow-lg flex flex-col overflow-hidden border border-slate-200 relative">
              <div className="flex items-center gap-3 p-6 border-b border-slate-100 bg-slate-50 shrink-0">
                <div className="flex items-center shrink-0">
                  <span className="text-4xl font-extrabold text-[#002864] leading-none">{String(currentQIndex + 1).padStart(2, '0')}</span>
                  {(!isTimedRound && q.pageNum) && (
                    <div className="flex flex-col ml-3 pl-3 border-l-2 border-blue-200 justify-center h-8">
                      <span className="text-[10px] font-bold text-blue-400 leading-tight">p.{q.pageNum}</span>
                      {q.questionNum && <span className="text-xs font-black text-[#002864] leading-tight">{q.questionNum}번</span>}
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-2 ml-2">
                  <h2 className="text-sm font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1 rounded-full shadow-sm">원본: {q.source}</h2>
                  {q.bookType && (
                    <span className={`text-xs font-black px-3 py-1 rounded-full border shadow-sm ${BOOK_TYPE_COLORS[q.bookType]?.pill || 'bg-slate-100 text-slate-600 border-slate-200'}`}>{q.bookType}</span>
                  )}
                </div>

                <div className="ml-auto flex items-center gap-3 shrink-0">
                  {isSubjective && curAnsMode === 'pen' && (
                    <span className="hidden md:inline-block bg-slate-100 text-slate-500 border border-slate-200 text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">
                      ✍️ 캔버스에 자유롭게 적으세요
                    </span>
                  )}
                  <button 
                    onClick={handleCallAction} 
                    disabled={timeIsUp || remainCallSec > 0 || (!callState.current[currentQIndex] && myAwayActive) || isRecheck} 
                    className={`font-extrabold text-sm px-5 py-2.5 rounded-xl shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isCall ? 'bg-rose-700 text-white' : 'bg-rose-500 text-white hover:bg-rose-600'}`}
                  >
                    {remainCallSec > 0 ? `⏳ ${remainCallSec}초 대기` : isCall ? '🚨 선생님 부르기 취소' : '🙋 선생님 부르기'}
                  </button>
                </div>

              </div>

              <div className="flex-1 relative overflow-hidden">
                <div className={`h-full overflow-y-auto custom-scrollbar p-8 md:p-10 ${!isTimedRound ? 'pb-32' : ''}`}>
                  <div className="relative min-h-full">
                    <div className={`transition-opacity text-2xl md:text-3xl lg:text-[36px] leading-[2.0] lg:leading-[2.2] font-semibold text-slate-800 ${isSubjective && curAnsMode === 'pen' ? 'opacity-30' : ''}`}>
                      <QuestionDisplay html={q.questionText} imageUrl={q.imageUrl} />
                    </div>
                    {isSubjective && curAnsMode === 'pen' && (
                      <ClinicCanvas
                        qIndex={currentQIndex}
                        currentPenWidth={currentPenWidth}
                        currentPenColor={currentPenColor}
                        isEraserMode={isEraserMode}
                        studentDrawings={studentDrawings}
                        studentAnswers={studentAnswers}
                        forceUpdate={forceUpdate}
                        clearTrigger={canvasClearTrigger}
                      />
                    )}
                  </div>
                </div>
              </div>

              {isCall && <div className="bg-rose-50 border-t border-rose-100 px-6 py-3 text-center text-base font-extrabold text-rose-600 shrink-0">🚨 {currentQIndex + 1}번 문제를 선생님께 질문했어요. 잠시 기다려주세요!</div>}
              {taHintState.current[currentQIndex] && <div className="bg-amber-50 border-t border-amber-100 px-6 py-3 text-center text-sm font-bold text-amber-600 shrink-0">🧑‍🏫 선생님의 힌트를 받았어요. 이어서 푼 뒤 제출해보세요!</div>}

              {!isTimedRound && (
                <div className="absolute left-0 right-0 bottom-0 z-30 p-5 bg-blue-50/95 backdrop-blur-sm border-t border-blue-100 rounded-b-3xl shadow-[0_-12px_30px_-10px_rgba(15,23,42,0.18)]">
                  {q.hasHint !== false && hintState.current[currentQIndex]?.revealed && (
                    <div className="flex justify-end items-center mb-2">
                      <button onClick={() => setHintPanelExpanded(!hintPanelExpanded)} className="flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-md bg-blue-100 text-blue-600 text-xs font-bold shrink-0">
                        {hintPanelExpanded ? '힌트 닫기' : '힌트 펼치기'}
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
                        {hintState.current[currentQIndex]?.revealed ? "💡 힌트 열람 완료" : "💡 힌트 열어보기 (-30 포인트)"}
                      </button>
                    )}
                    <button onClick={handleAwayToggle} disabled={awayCooldown.isActive || (!myAwayActive && Object.values(callState.current).some(v=>v))} className={`shrink-0 border text-base font-bold py-3 px-6 rounded-xl shadow-sm transition-colors ${myAwayActive ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-300 hover:bg-slate-100 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed'}`}>{awayCooldown.isActive ? `⏳ ${Math.ceil(awayCooldown.remainingMs / 1000)}초` : myAwayActive ? '↩️ 자리 복귀' : '🚶 화장실 다녀오기'}</button>
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
              
              <ClinicQuestionNav 
                questions={questions} currentQIndex={currentQIndex} setCurrentQIndex={setCurrentQIndex}
                bookFilter={bookFilter} switchBookFilter={switchBookFilter} availableBooks={availableBooks} visibleIndices={visibleIndices}
                qBoxStatus={qBoxStatus as any} studentAnswers={studentAnswers} callState={callState}
                setCanvasClearTrigger={setCanvasClearTrigger} isTimedRound={isTimedRound} timeIsUp={timeIsUp} setSubmitConfirmModal={setSubmitConfirmModal}
              />

              <div className="bg-white rounded-3xl shadow-lg p-6 flex-1 flex flex-col border border-slate-200 relative overflow-hidden">
                {(isCall || isRecheck) && (
                  <div className="absolute inset-0 z-20 bg-white/50 flex flex-col items-center pt-4 backdrop-blur-[2px]">
                    <div className={`border text-sm font-bold rounded-xl p-4 text-center w-[90%] shadow-sm ${isCall ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-indigo-50 border-indigo-200 text-indigo-600'}`}>
                      {isCall ? <>🙋 선생님을 불렀어요!<br/>오실 때까지 잠시만 기다려주세요.</> : q.aiGradable === false ? <>✏️ 선생님이 꼼꼼히 확인하고 있어요<br/>확인이 끝날 때까지 잠시만 기다려주세요.</> : <>🕐 선생님께 다시 확인해 달라고 부탁했어요<br/>확인이 끝날 때까지 잠시만 기다려주세요.</>}
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
                        <span className="font-myungjo" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(opt).replace(/<\s*b\s*>/gi, '<b>').replace(/<\s*\/\s*b\s*>/gi, '</b>') }} />
                      </label>
                    ))
                  ) : curAnsMode === 'pen' ? (
                    <div className="w-full h-full flex flex-col gap-2 items-center justify-center py-2 overflow-y-auto custom-scrollbar">
                      <p className="text-sm md:text-base font-bold text-slate-400 text-center shrink-0 leading-snug break-keep">✍️ 빈 공간에 자유롭게 풀이 과정을 적고 정답을 구해보세요!</p>
                      <div className="w-full flex flex-col gap-2 my-auto shrink-0 py-2">
                        <div className="flex items-center justify-center gap-3">
                          <button onClick={() => { const w = Math.max(1, currentPenWidth - 1); setCurrentPenWidth(w); }} className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 font-bold text-2xl">−</button>
                          <span className="text-lg font-bold text-slate-500 w-8 text-center">{currentPenWidth}</span>
                          <button onClick={() => { const w = Math.min(10, currentPenWidth + 1); setCurrentPenWidth(w); }} className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 font-bold text-2xl">+</button>
                        </div>
                        <div className={`flex items-center justify-center gap-3 transition-opacity ${isEraserMode ? 'opacity-30 pointer-events-none' : ''}`}>
                          {PEN_COLORS.map(color => (
                            <button key={color} onClick={() => { setCurrentPenColor(color); }} className={`w-10 h-10 rounded-full border-4 transition-transform ${currentPenColor === color ? 'border-[#002864] scale-110' : 'border-white'} shadow-sm`} style={{ backgroundColor: color }}></button>
                          ))}
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          <button onClick={toggleEraser} className={`flex-1 text-lg font-bold py-3 rounded-xl ${isEraserMode ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'}`}>🧽 {isEraserMode ? '지우개 쓰는 중' : '지우개로 지우기'}</button>
                          <button onClick={handleClearCanvas} className="flex-1 text-lg font-bold text-rose-500 bg-rose-50 py-3 rounded-xl">🗑️ 모두 지우기</button>
                        </div>
                        <div className="flex items-center gap-3 mt-3 w-full">
                          <button onClick={toggleAnswerMode} className="flex-1 text-xl font-black text-[#002864] bg-blue-50 py-4 rounded-xl border-2 border-blue-200 hover:bg-blue-100 shadow-sm transition-colors flex items-center justify-center gap-2">
                            <span className="text-2xl">🔢</span> 키패드로 돌아가기
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] md:text-xs text-slate-400 font-medium text-center shrink-0 px-2 break-keep">
                        {isKeypadEnterable(q?.answer) ? '🤖 손글씨 정답도 똑똑한 AI가 자동으로 채점해 줄 거예요' : '✍️ 이 문제는 정답의 형태가 복잡해서 손글씨로만 답을 적을 수 있어요'}
                      </p>
                    </div>
                  ) : (
                    <ClinicKeypad 
                      currentQIndex={currentQIndex} keypadAnswers={keypadAnswers} keypadCursor={keypadCursor}
                      studentAnswers={studentAnswers} keypadCollapsed={keypadCollapsed} forceUpdate={forceUpdate}
                    />
                  )}
                </div>
              </div>

              {!isTimedRound && (
                <div className="flex flex-col gap-3 mt-auto shrink-0">
                  <button 
                    onClick={submitSingleAnswer} 
                    disabled={timeIsUp || isCall || isRecheck || isSubmitting || isCurrentAlreadyCorrect} 
                    className="w-full bg-[#002864] hover:bg-blue-900 text-white font-extrabold text-xl py-5 rounded-xl shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isCurrentAlreadyCorrect ? '✅ 채점 통과' : isSubmitting ? '채점 중...' : '✅ 정답 제출하기'}
                  </button>
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
          setCanvasClearTrigger(p=>p+1);
          forceUpdate();
        }}
        onRequestRecheck={requestRecheck}
        sessionTimeUpModal={sessionTimeUpModal}
        timeUpModal={timeUpModal}
        submitConfirmModal={submitConfirmModal}
        setSubmitConfirmModal={setSubmitConfirmModal}
        onSubmitConfirm={() => handleTimeUpRef.current()}
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