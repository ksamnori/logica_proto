// src/app/clinic/viewer/hooks/useClinicRealtime.ts
import { useEffect, useRef } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { resolveTodaySession } from "@/lib/clinicSession";
import { awardClinicMinutePoints } from "@/app/actions/shopPoints";
import { getKSTDateString, CLINIC_ROOM, isObjectiveQuestion } from '../utils';

interface UseClinicRealtimeProps {
  supabaseClient: SupabaseClient;
  studentInfo: { id: string; name: string; classes: string[] };
  params: { round: number; className: string; weekType: string; assignmentId: string; homeworkIdsStr: string; assignmentIdsStr: string; overdue: boolean; retry?: boolean };
  questions: any[];
  currentQIndex: number;
  isTimedRound: boolean;
  
  mySeatRef: React.MutableRefObject<string | null>;
  seatKeysRef: React.MutableRefObject<string[]>;
  clinicSessionStateRef: React.MutableRefObject<any>;
  callState: React.MutableRefObject<Record<number, boolean>>;
  recheckState: React.MutableRefObject<Record<number, 'pending' | null>>;
  taHintState: React.MutableRefObject<Record<number, boolean>>;
  qBoxStatus: React.MutableRefObject<Record<number, string>>;
  studentAnswers: React.MutableRefObject<Record<number, string | null>>;
  studentDrawings: React.MutableRefObject<Record<number, string>>;
  keypadAnswers: React.MutableRefObject<Record<number, string>>;
  keypadCursor: React.MutableRefObject<Record<number, number>>;
  correctSolvedCountRef: React.MutableRefObject<number>;
  
  setEditorLocked: (locked: boolean) => void;
  setRecheckToast: (toast: string) => void;
  setMyAwayActive: (active: boolean | ((prev: boolean) => boolean)) => void;
  setPendingRecheckReview: React.Dispatch<React.SetStateAction<any[]>>;
  setSessionInfo: (info: any) => void;
  setPoints: React.Dispatch<React.SetStateAction<number | null>>;
  setCanvasClearTrigger: React.Dispatch<React.SetStateAction<number>>;
  forceUpdate: () => void;
  processCorrectAnswer: (qItem: any, idx: number, fromRecheck: boolean) => Promise<void>;
  handleTimeUp: (forceAction?: string, sessionExpired?: boolean) => Promise<void>;
  persistExamAnswersToDB: () => Promise<number>;
  getAnswerMode: (idx: number, qItem: any) => 'pen' | 'keypad';
  router: any;
  callCooldown: any;
  awayCooldown: any;
}

// 🌟 동시 재접속 폭주(Thundering Herd) 방지용 지수 백오프 + 랜덤 지터 계산기
// 1회차: 3.0~6.5초, 2회차: 4.5~8.0초, 3회차: 6.75~10.25초 ... 최대 12.0~15.5초 범위로 기기별 분산
function getJitteredReconnectDelay(attempt: number): number {
  const baseExp = Math.min(12000, Math.round(3000 * Math.pow(1.5, Math.min(attempt, 4))));
  const jitter = Math.floor(Math.random() * 3500);
  return baseExp + jitter;
}

export function useClinicRealtime({
  supabaseClient, studentInfo, params, questions, currentQIndex, isTimedRound,
  mySeatRef, seatKeysRef, clinicSessionStateRef, callState, recheckState, taHintState, qBoxStatus,
  studentAnswers, studentDrawings, keypadAnswers, keypadCursor, correctSolvedCountRef,
  setEditorLocked, setRecheckToast, setMyAwayActive, setPendingRecheckReview, setSessionInfo, setPoints, setCanvasClearTrigger,
  forceUpdate, processCorrectAnswer, handleTimeUp, persistExamAnswersToDB, getAnswerMode, router, callCooldown, awayCooldown
}: UseClinicRealtimeProps) {
  
  const clinicChannelRef = useRef<any>(null);
  const clinicChannelDisposedRef = useRef(false);
  const clinicReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clinicRetryAttemptRef = useRef<number>(0);

  const gradingChannelRef = useRef<any>(null);
  const handleTaActionRef = useRef<any>(null);
  const trackPresenceRef = useRef<any>(null);
  const lastTrackAtRef = useRef<number>(0);
  const lastTrackKeyRef = useRef<string>('');

  // 🌟 questions 배열 참조가 바뀔 때마다 실시간 채널이 해체·재구독되지 않도록 최신 참조를 Ref로 유지
  const questionsRef = useRef<any[]>(questions);
  questionsRef.current = questions;
  const hasQuestions = questions.length > 0;

  const callbacksRef = useRef({ 
      processCorrectAnswer, handleTimeUp, forceUpdate, setRecheckToast, 
      setCanvasClearTrigger, setMyAwayActive, setPendingRecheckReview, persistExamAnswersToDB
  });
  
  useEffect(() => {
    callbacksRef.current = { 
        processCorrectAnswer, handleTimeUp, forceUpdate, setRecheckToast, 
        setCanvasClearTrigger, setMyAwayActive, setPendingRecheckReview, persistExamAnswersToDB
    };
  });

  const runSelfCorrectionRef = useRef<any>(null);
  const checkoutHandledRef = useRef(false);

  useEffect(() => {
    if (!studentInfo.id || !hasQuestions) return;
    let cancelled = false;
    let isRunningCorrection = false;

    const runSelfCorrection = async () => {
      const sid = clinicSessionStateRef.current?.id;
      if (!sid || cancelled || checkoutHandledRef.current || isRunningCorrection) return;
      isRunningCorrection = true;
      try {

      const { data, error } = await supabaseClient
        .from('clinic_session_state')
        .select('duration_ms, active_calls, active_rechecks, away_since, ended_at')
        .eq('id', sid)
        .maybeSingle();

      if (error || !data || cancelled) return;

      const currentQuestions = questionsRef.current;
      let hasChanges = false;
      const { processCorrectAnswer, handleTimeUp, forceUpdate, setRecheckToast, setCanvasClearTrigger, setMyAwayActive, setPendingRecheckReview } = callbacksRef.current;

      if (data.active_calls && data.active_calls['REFRESH']) {
          const newCalls = { ...data.active_calls };
          delete newCalls['REFRESH'];
          await supabaseClient.from('clinic_session_state').update({ active_calls: newCalls }).eq('id', sid);
          
          if (setRecheckToast) {
              setRecheckToast('🎉 밖에서 채점이 확정되었습니다! (학습 종료 후 포탈에서 확인 가능)');
              setTimeout(() => setRecheckToast(""), 4000);
          }
          return;
      }

      if (data.ended_at) {
          if (!checkoutHandledRef.current) {
              checkoutHandledRef.current = true;
              cancelled = true;
              clearInterval(interval);
              handleTimeUp('force_checkout_by_ta', true);
          }
          return;
      }

      if (clinicSessionStateRef.current && clinicSessionStateRef.current.duration_ms !== data.duration_ms) {
        clinicSessionStateRef.current.duration_ms = data.duration_ms;
      }

      const dbCalls = data.active_calls || {};
      const callsToDelete: string[] = [];

      Object.keys(dbCalls).forEach((qNumStr) => {
        const callRec = dbCalls[qNumStr];
        if (callRec && callRec.verdict === 'resolved') {
          if (qNumStr !== 'general') {
              const qIdx = Number(qNumStr) - 1;
              if (qIdx >= 0 && !isNaN(qIdx)) {
                  callState.current[qIdx] = false; 
                  hasChanges = true;
                  if (callRec.mark === 'hint') {
                      taHintState.current[qIdx] = true;
                      if (currentQuestions[qIdx]?.record_id) {
                        supabaseClient.from('student_incorrect_record').update({ status: 'T' }).eq('record_id', currentQuestions[qIdx].record_id).then();
                      }
                  }
              }
          }
          callsToDelete.push(qNumStr); 
        }
      });

      Object.keys(callState.current).forEach((qIdxStr) => {
          const qIdx = Number(qIdxStr);
          const qNum = qIdx + 1;
          const callRec = dbCalls[qNum];
          
          if (callState.current[qIdx] && (!callRec || callRec.verdict === 'resolved')) {
              callState.current[qIdx] = false;
              hasChanges = true;
          }
      });

      setMyAwayActive((prevAway: boolean) => {
        const isDbAway = !!data.away_since;
        if (prevAway && !isDbAway) return false;
        return prevAway;
      });

      const dbRechecks = data.active_rechecks || {};
      const rechecksToDelete: string[] = [];
      
      Object.keys(dbRechecks).forEach((uid) => {
        const rec = dbRechecks[uid];
        if (rec && rec.verdict) {
           const qIdx = rec.qNum ? Number(rec.qNum) - 1 : currentQuestions.findIndex((q: any) => q.uid === uid);
           
           setPendingRecheckReview((prev: any[]) => {
               const exists = prev.some(r => r.uid === uid || (rec.qNum && r.qNum === rec.qNum));
               if (exists) {
                   return prev.map(r => (r.uid === uid || (rec.qNum && r.qNum === rec.qNum)) ? { ...r, resolved: true, verdict: rec.verdict } : r);
               }
               return prev;
           });

           if (qIdx >= 0 && currentQuestions[qIdx]) {
               recheckState.current[qIdx] = null; 
               const currentStatus = qBoxStatus.current[qIdx];
               
               if (rec.verdict === 'correct' && currentStatus !== 'correct_blue') {
                   setRecheckToast(`🎉 조교님이 ${qIdx + 1}번을 정답 처리했어요!`);
                   processCorrectAnswer(currentQuestions[qIdx], qIdx, true);
               } else if (rec.verdict === 'incorrect' && currentStatus !== 'wrong_red') {
                   qBoxStatus.current[qIdx] = 'wrong_red';
                   delete studentDrawings.current[qIdx]; delete keypadAnswers.current[qIdx]; delete keypadCursor.current[qIdx]; studentAnswers.current[qIdx] = null;
                   setRecheckToast('조교 확인 결과 오답이 맞습니다. 다시 풀어보세요.'); 
                   setCanvasClearTrigger(p => p + 1);
               }
               setTimeout(() => setRecheckToast(""), 4000);
               hasChanges = true;
           } else {
               Object.keys(recheckState.current).forEach(k => { recheckState.current[Number(k)] = null; });
               hasChanges = true;
           }
           rechecksToDelete.push(uid); 
        } else {
           const qIdx = rec.qNum ? Number(rec.qNum) - 1 : currentQuestions.findIndex((q: any) => q.uid === uid);
           if (qIdx >= 0 && recheckState.current[qIdx] !== 'pending') {
               recheckState.current[qIdx] = 'pending';
               hasChanges = true;
           }
        }
      });

      if (callsToDelete.length > 0 || rechecksToDelete.length > 0) {
          const updatePayload: any = {};
          if (callsToDelete.length > 0) {
              const newCalls = { ...data.active_calls };
              callsToDelete.forEach(k => delete newCalls[k]);
              updatePayload.active_calls = newCalls;
          }
          if (rechecksToDelete.length > 0) {
              const newRechecks = { ...data.active_rechecks };
              rechecksToDelete.forEach(k => delete newRechecks[k]);
              updatePayload.active_rechecks = newRechecks;
          }
          await supabaseClient.from('clinic_session_state').update(updatePayload).eq('id', sid);
      }

      if (hasChanges) forceUpdate();
      } finally {
        isRunningCorrection = false;
      }
    };

    runSelfCorrectionRef.current = runSelfCorrection;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      runSelfCorrection();
    }, 8000);
    const handleFocus = () => runSelfCorrection();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') runSelfCorrection();
    };
    
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => { 
        cancelled = true; 
        clearInterval(interval); 
        window.removeEventListener('focus', handleFocus);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [studentInfo.id, hasQuestions]); 

  useEffect(() => {
    if (!studentInfo.id || !hasQuestions) return;

    let isDisposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let gradingRetryAttempt = 0;
    let hasConnectedOnce = false;
    let isSyncingReconnect = false;

    const handleTaRealtimeUpdate = async (payload: any, type: 'exam' | 'hw') => {
      if (isDisposed) return;
      let newData = payload.new;
      if (!newData) return;

      if (!newData.student_id || (!newData.question_id && !newData.tq_id)) {
        if (type === 'exam' && newData.answer_id) {
          const { data } = await supabaseClient.from('student_answer').select('*').eq('answer_id', newData.answer_id).single();
          if (data) newData = data;
        } else if (type === 'hw' && newData.hw_answer_id) {
          const { data } = await supabaseClient.from('student_homework_answer').select('*').eq('hw_answer_id', newData.hw_answer_id).single();
          if (data) newData = data;
        }
      }

      if (isDisposed || !newData || String(newData.student_id) !== String(studentInfo.id) || !newData.grading_code) return;

      const currentQuestions = questionsRef.current;
      const idx = currentQuestions.findIndex(qItem =>
        type === 'exam'
          ? ((!qItem.examAssignmentId || !newData.exam_assignment_id || String(qItem.examAssignmentId) === String(newData.exam_assignment_id)) && String(qItem.question_id) === String(newData.question_id))
          : (String(qItem.homework_id) === String(newData.homework_id) && String(qItem.tq_id) === String(newData.tq_id))
      );

      if (idx === -1) return;

      const newCode = newData.grading_code;
      const isCorrect = ['O', 'TO', 'RO'].includes(newCode);
      const currentStatus = qBoxStatus.current[idx];
      const wasCorrect = ['correct_blue', 'correct_yellow', 'retry_yellow', 'O', 'TO', 'RO'].includes(currentStatus || '');

      const { setRecheckToast, processCorrectAnswer, forceUpdate, setCanvasClearTrigger } = callbacksRef.current;

      if (isCorrect && !wasCorrect) {
        setRecheckToast(`🎉 조교님이 ${idx + 1}번을 정답(${newCode}) 처리했어요!`);
        setTimeout(() => setRecheckToast(""), 4000);
        if (recheckState.current[idx] === 'pending') recheckState.current[idx] = null;
        processCorrectAnswer(currentQuestions[idx], idx, true);
      } else if (!isCorrect && wasCorrect) {
        qBoxStatus.current[idx] = 'wrong_red';
        correctSolvedCountRef.current = Math.max(0, correctSolvedCountRef.current - 1);
        setRecheckToast(`🚨 조교님이 ${idx + 1}번을 오답(${newCode})으로 변경했어요.`);
        setTimeout(() => setRecheckToast(""), 4000);
        forceUpdate();
      } else if (!isCorrect && currentStatus !== 'wrong_red') {
        qBoxStatus.current[idx] = 'wrong_red';
        if (recheckState.current[idx] === 'pending') {
           setRecheckToast(`조교 확인 결과 오답(${newCode})이 맞습니다. 다시 풀어보세요.`);
           setTimeout(() => setRecheckToast(""), 4000);
           recheckState.current[idx] = null;
           studentAnswers.current[idx] = null; 
           delete studentDrawings.current[idx];
           delete keypadAnswers.current[idx];
           setCanvasClearTrigger(p => p + 1);
        } else {
           setRecheckToast(`조교님이 ${idx + 1}번을 오답(${newCode}) 처리했어요.`);
           setTimeout(() => setRecheckToast(""), 4000);
        }
        forceUpdate();
      }
    };

    // 🌟 웹소켓이 잠깐 끊겼다가 재연결(SUBSCRIBED)된 경우, 끊겨 있던 몇 초 사이에 조교가 변경한 정·오답만 안전하게 동기화
    // (학생이 현재 필기 중인 오답 재풀이 캔버스는 건드리지 않도록 정↔오 상태가 역전된 항목만 반영)
    const syncMissedGradingOnReconnect = async () => {
      if (isDisposed || isSyncingReconnect) return;
      isSyncingReconnect = true;
      try {
        if (runSelfCorrectionRef.current) {
          await runSelfCorrectionRef.current();
        }

        const currentQuestions = questionsRef.current;
        if (!currentQuestions.length || isDisposed) return;

        const examAssignIds = Array.from(
          new Set(currentQuestions.map((q: any) => q.examAssignmentId).filter(Boolean))
        );
        const hwIds = Array.from(
          new Set(currentQuestions.map((q: any) => q.homework_id).filter(Boolean))
        );

        const [examRes, hwRes] = await Promise.all([
          examAssignIds.length > 0
            ? supabaseClient
                .from('student_answer')
                .select('answer_id, student_id, exam_assignment_id, question_id, grading_code')
                .eq('student_id', studentInfo.id)
                .in('exam_assignment_id', examAssignIds)
                .not('grading_code', 'is', null)
            : Promise.resolve({ data: [] as any[] }),
          hwIds.length > 0
            ? supabaseClient
                .from('student_homework_answer')
                .select('hw_answer_id, student_id, homework_id, tq_id, grading_code')
                .eq('student_id', studentInfo.id)
                .in('homework_id', hwIds)
                .not('grading_code', 'is', null)
            : Promise.resolve({ data: [] as any[] }),
        ]);

        if (isDisposed) return;

        for (const row of examRes.data || []) {
          const idx = currentQuestions.findIndex(
            (q: any) =>
              (!q.examAssignmentId || String(q.examAssignmentId) === String(row.exam_assignment_id)) &&
              String(q.question_id) === String(row.question_id)
          );
          if (idx === -1) continue;
          const isCorrect = ['O', 'TO', 'RO'].includes(row.grading_code);
          const wasCorrect = ['correct_blue', 'correct_yellow', 'retry_yellow', 'O', 'TO', 'RO'].includes(
            qBoxStatus.current[idx] || ''
          );
          if ((isCorrect && !wasCorrect) || (!isCorrect && wasCorrect)) {
            await handleTaRealtimeUpdate({ new: row }, 'exam');
          }
        }

        for (const row of hwRes.data || []) {
          const idx = currentQuestions.findIndex(
            (q: any) =>
              String(q.homework_id) === String(row.homework_id) &&
              String(q.tq_id) === String(row.tq_id)
          );
          if (idx === -1) continue;
          const isCorrect = ['O', 'TO', 'RO'].includes(row.grading_code);
          const wasCorrect = ['correct_blue', 'correct_yellow', 'retry_yellow', 'O', 'TO', 'RO'].includes(
            qBoxStatus.current[idx] || ''
          );
          if ((isCorrect && !wasCorrect) || (!isCorrect && wasCorrect)) {
            await handleTaRealtimeUpdate({ new: row }, 'hw');
          }
        }
      } catch (err) {
        console.warn('재연결 후 채점 상태 동기화 경고(무시 가능):', err);
      } finally {
        isSyncingReconnect = false;
      }
    };

    const connectGradingChannel = () => {
        if (isDisposed) return;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        if (gradingChannelRef.current) {
            const oldCh = gradingChannelRef.current;
            gradingChannelRef.current = null;
            supabaseClient.removeChannel(oldCh).catch(() => {});
        }
        
        const channelName = `student_realtime_grading_listen_${studentInfo.id}`;
        
        supabaseClient.getChannels().forEach((ch) => {
            if (ch.topic === `realtime:${channelName}`) {
                supabaseClient.removeChannel(ch).catch(() => {});
            }
        });
        
        // 🌟 clinic_session_state 테이블은 모든 학생의 하트비트(last_seen_at) UPDATE가 집중되므로
        // postgres_changes 구독에서 제외하여 IncreaseSubscriptionConnectionPool 타임아웃을 방지합니다.
        const channel = supabaseClient.channel(channelName)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'student_answer', filter: `student_id=eq.${studentInfo.id}` }, (payload: any) => handleTaRealtimeUpdate(payload, 'exam'))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'student_homework_answer', filter: `student_id=eq.${studentInfo.id}` }, (payload: any) => handleTaRealtimeUpdate(payload, 'hw'));
          
        gradingChannelRef.current = channel;
        channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                gradingRetryAttempt = 0;
                if (hasConnectedOnce) {
                    // 재연결된 경우에만 끊겨 있던 찰나의 채점 변경분을 1회 보정
                    syncMissedGradingOnReconnect();
                } else {
                    hasConnectedOnce = true;
                }
                return;
            }
            // 의도적인 CLOSED 상태에서는 재연결하지 않고, 실제 오류/타임아웃 시에만 지수 백오프 + 랜덤 지터 후 재연결
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                if (isDisposed || gradingChannelRef.current !== channel) return;
                if (reconnectTimer) clearTimeout(reconnectTimer);
                const delayMs = getJitteredReconnectDelay(gradingRetryAttempt++);
                reconnectTimer = setTimeout(() => {
                    if (!isDisposed && gradingChannelRef.current === channel) {
                        connectGradingChannel();
                    }
                }, delayMs);
            }
        });
    };

    connectGradingChannel();

    return () => { 
        isDisposed = true;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (gradingChannelRef.current) {
            const ch = gradingChannelRef.current;
            gradingChannelRef.current = null;
            supabaseClient.removeChannel(ch).catch(() => {});
        }
    };
  }, [studentInfo.id, hasQuestions]);

  handleTaActionRef.current = (payload: any, sId: string, sessionState: any) => {
    const currentSeat = mySeatRef.current;
    if (payload.seat !== currentSeat && payload.studentId !== sId) return;

    const currentQuestions = questionsRef.current;

    if (payload.action === 'force_cancel_call') {
      if (payload.qNum !== undefined && payload.qNum !== 'general') {
        const qIdx = Number(payload.qNum) - 1;
        if (qIdx >= 0 && !isNaN(qIdx)) {
          callState.current[qIdx] = false;
          if (payload.mark === 'hint') {
            taHintState.current[qIdx] = true;
            if (currentQuestions[qIdx]?.record_id) {
              supabaseClient.from('student_incorrect_record').update({ status: 'T' }).eq('record_id', currentQuestions[qIdx].record_id).then();
            }
          }
          callbacksRef.current.forceUpdate();
        }
      }
      if (runSelfCorrectionRef.current) runSelfCorrectionRef.current();
    } else if (payload.action === 'force_return_to_seat') {
      callbacksRef.current.setMyAwayActive(false);
    } else if (payload.action === 'relocated_away') {
      const sid = clinicSessionStateRef.current?.id;
      const qItem = currentQuestions[currentQIndex];
      if (sid && qItem) {
        const isObjective = isObjectiveQuestion(qItem);
        const mode = isObjective ? null : getAnswerMode(currentQIndex, qItem);
        const answer = isObjective ? studentAnswers.current[currentQIndex] : mode === 'pen' ? studentDrawings.current[currentQIndex] : keypadAnswers.current[currentQIndex];
        if (answer) {
          const draft = { round: params.round, className: params.className, weekType: params.weekType, assignmentId: params.assignmentId, homeworkIdsStr: params.homeworkIdsStr, qIndex: currentQIndex, answer, mode: mode || 'objective', savedAt: Date.now() };
          supabaseClient.from('clinic_session_state').update({ draft_progress: draft }).eq('id', sid).then();
        }
      }
      if (isTimedRound) callbacksRef.current.persistExamAnswersToDB();
      untrackPresence();
      localStorage.removeItem('logica_student_id');
      localStorage.removeItem('logica_student_name');
      localStorage.removeItem('logica_student_phone');
      router.push('/student/login');
    } else if (payload.action === 'force_checkout' || payload.action === 'force_checkout_by_ta') {
      callbacksRef.current.handleTimeUp(payload.action);
    } else if (payload.action === 'move_seat') {
      if (payload.newSeat) {
        mySeatRef.current = payload.newSeat;
        supabaseClient.from('clinic_session_state').update({ seat: payload.newSeat, manual_seat: payload.newSeat }).eq('student_id', sId).is('ended_at', null).then();
        trackPresenceRef.current(payload.newSeat, sId, sessionState);
      }
    } else if (payload.action === 'adjust_clinic_time') {
      const dMs = Number(payload.deltaMs) || 0;
      if (clinicSessionStateRef.current) {
        clinicSessionStateRef.current.duration_ms = Math.max(0, clinicSessionStateRef.current.duration_ms + dMs);
        trackPresenceRef.current(mySeatRef.current!, sId, clinicSessionStateRef.current);
      }
    } else if (payload.action === 'resolve_recheck') {
      const { setPendingRecheckReview, setRecheckToast, processCorrectAnswer, setCanvasClearTrigger, forceUpdate } = callbacksRef.current;
      
      const qNum = payload.qNum;
      const idx = qNum ? Number(qNum) - 1 : currentQuestions.findIndex((item: any) => item.uid === payload.uid);
      
      setPendingRecheckReview((prev: any[]) => {
        const isReviewItem = prev.some(r => r.uid === payload.uid || (qNum && r.qNum === qNum));
        if (isReviewItem) {
          if (idx >= 0) recheckState.current[idx] = null;
          setRecheckToast(payload.verdict === 'correct' ? '🎉 조교가 정답으로 확인했어요!' : '조교 확인 결과 오답이 맞습니다.');
          setTimeout(() => setRecheckToast(""), 4000);
          return prev.map(r => (r.uid === payload.uid || (qNum && r.qNum === qNum)) ? { ...r, resolved: true, verdict: payload.verdict } : r);
        }
        return prev;
      });

      if (idx >= 0 && currentQuestions[idx]) {
          const qItem = currentQuestions[idx];
          recheckState.current[idx] = null;
    
          if (payload.verdict === 'correct') {
            setRecheckToast(`🎉 조교님이 ${idx + 1}번을 정답 처리했어요!`);
            processCorrectAnswer(qItem, idx, true);
          } else {
            qBoxStatus.current[idx] = 'wrong_red';
            delete studentDrawings.current[idx]; 
            delete keypadAnswers.current[idx]; 
            delete keypadCursor.current[idx]; 
            studentAnswers.current[idx] = null;
            setRecheckToast('조교 확인 결과 오답이 맞습니다. 다시 풀어보세요.'); 
            setCanvasClearTrigger(p => p + 1);
            forceUpdate();
          }
      } else {
          Object.keys(recheckState.current).forEach(k => { recheckState.current[Number(k)] = null; });
          forceUpdate();
      }
      setTimeout(() => setRecheckToast(""), 4000);

      const sid = clinicSessionStateRef.current?.id;
      if (sid) {
         supabaseClient.from('clinic_session_state').select('active_rechecks').eq('id', sid).maybeSingle().then(({ data }) => {
             if (data && data.active_rechecks) {
                 const newRechecks = { ...data.active_rechecks };
                 let modified = false;
                 Object.keys(newRechecks).forEach(k => {
                     if (newRechecks[k].qNum === qNum || k === payload.uid) {
                         delete newRechecks[k];
                         modified = true;
                     }
                 });
                 if (modified) supabaseClient.from('clinic_session_state').update({ active_rechecks: newRechecks }).eq('id', sid).then();
             }
         });
      }
    } else if (payload.action === 'force_refresh') {
      if (callbacksRef.current.setRecheckToast) {
          callbacksRef.current.setRecheckToast('🎉 밖에서 채점이 확정되었습니다! (학습 종료 후 포탈에서 확인 가능)');
          setTimeout(() => callbacksRef.current.setRecheckToast(""), 4000);
      }
    }
  };

  // 🌟 ClientPresenceRateLimitReached 원천 차단: 모든 track() 호출에 최소 5초 스로틀 강제 적용
  trackPresenceRef.current = (seat: string, sId: string, sessionState: any, force = false, customActivity?: string) => {
    if (!clinicChannelRef.current || !seat) return;
    const defaultActivity = params.round === 1 ? (params.weekType === 'even' ? '과제오답유사 풀이중' : '주간테스트 풀이중') : params.round === 2 ? (params.overdue ? '미완료 과제 풀이중' : '과제 풀이중') : params.round === 3 ? '오답 클리닉 풀이중' : '클리닉 풀이중';
    const activity = customActivity || defaultActivity;
    const dur = sessionState?.duration_ms || 0;
    const key = `${seat}_${activity}_${dur}`;
    const now = Date.now();
    // 상태가 같으면 25초 이내 재전송 금지, 상태가 바뀌었더라도 최소 5초 이내 연속 track() 금지
    if (now - lastTrackAtRef.current < 5000) return;
    if (!force && key === lastTrackKeyRef.current && now - lastTrackAtRef.current < 25000) return;
    lastTrackKeyRef.current = key;
    lastTrackAtRef.current = now;
    clinicChannelRef.current.track({
      seat, name: studentInfo.name, studentId: sId, classes: studentInfo.classes, activity, updatedAt: now,
      startedAt: new Date(sessionState?.started_at || now).getTime(), durationMs: sessionState?.duration_ms
    }).catch(() => {});
  };

  const connectChannel = async (sId: string, sessionState: any) => {
    if (clinicReconnectTimerRef.current) {
      clearTimeout(clinicReconnectTimerRef.current);
      clinicReconnectTimerRef.current = null;
    }
    clinicChannelDisposedRef.current = false;

    if (clinicChannelRef.current) {
      const oldCh = clinicChannelRef.current;
      clinicChannelRef.current = null;
      try { await supabaseClient.removeChannel(oldCh); } catch (e) {}
    }
    const myTenantId = localStorage.getItem("logica_tenant_id") || "hq";
    const channelName = `${CLINIC_ROOM}_${myTenantId}`;
    
    // 동일 토픽으로 남아있는 좀비 채널 정리
    supabaseClient.getChannels().forEach((ch: any) => {
      if (ch.topic === `realtime:${channelName}`) {
        supabaseClient.removeChannel(ch).catch(() => {});
      }
    });

    if (clinicChannelDisposedRef.current) return;

    const channel = supabaseClient.channel(channelName);
    clinicChannelRef.current = channel;
    
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const hasEditor = Object.values(state).some((metas) => (metas as any[]).some(m => m.role === 'editor'));
        setEditorLocked(hasEditor);

        let amIPresent = false;
        const occupied = new Set<string>();
        Object.values(state).forEach((metas) => {
          (metas as any[]).forEach(m => { 
            if (m.seat) occupied.add(m.seat); 
            if (m.studentId === sId) amIPresent = true;
          });
        });

        if (mySeatRef.current) {
          if (!amIPresent) trackPresenceRef.current(mySeatRef.current, sId, clinicSessionStateRef.current || sessionState);
          return;
        }

        const manualSeat = sessionState.manual_seat;
        const storedSeat = sessionState.session_date === getKSTDateString() ? sessionState.seat : null;
        const seat = manualSeat || storedSeat || seatKeysRef.current.find(s => !occupied.has(s)) || null;

        if (seat) {
          mySeatRef.current = seat;
          supabaseClient.from('clinic_session_state').update({ seat }).eq('student_id', sId).then();
          trackPresenceRef.current(seat, sId, clinicSessionStateRef.current || sessionState);
        }
      })
      .on('broadcast', { event: 'ta_action' }, ({ payload }: any) => handleTaActionRef.current(payload, sId, clinicSessionStateRef.current || sessionState))
      .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
              clinicRetryAttemptRef.current = 0;
              return;
          }
          // 의도적 CLOSED 이벤트에서는 재연결하지 않고, 실제 오류/타임아웃이며 종료되지 않은 상태에서만 지터 분산 재연결
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              if (clinicChannelDisposedRef.current || clinicChannelRef.current !== channel) return;
              if (clinicReconnectTimerRef.current) clearTimeout(clinicReconnectTimerRef.current);
              const delayMs = getJitteredReconnectDelay(clinicRetryAttemptRef.current++);
              clinicReconnectTimerRef.current = setTimeout(() => {
                  if (!clinicChannelDisposedRef.current && clinicChannelRef.current === channel) {
                      connectChannel(sId, clinicSessionStateRef.current || sessionState);
                  }
              }, delayMs);
          }
      });
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

  const initSession = async (sId: string, round: number, cls: string) => {
    clinicChannelDisposedRef.current = false;
    clinicRetryAttemptRef.current = 0;
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
  };

  const untrackPresence = async () => {
    clinicChannelDisposedRef.current = true;
    if (clinicReconnectTimerRef.current) {
      clearTimeout(clinicReconnectTimerRef.current);
      clinicReconnectTimerRef.current = null;
    }
    if (clinicChannelRef.current) {
      const ch = clinicChannelRef.current;
      clinicChannelRef.current = null; 
      try { await ch.untrack(); } catch(e) {}
      try { await supabaseClient.removeChannel(ch); } catch(e) {}
    }
  };

  // 컴포넌트 언마운트 시 클리닉 프레즌스 채널 및 재연결 타이머 보장 정리
  useEffect(() => {
    return () => {
      clinicChannelDisposedRef.current = true;
      if (clinicReconnectTimerRef.current) {
        clearTimeout(clinicReconnectTimerRef.current);
        clinicReconnectTimerRef.current = null;
      }
      if (clinicChannelRef.current) {
        const ch = clinicChannelRef.current;
        clinicChannelRef.current = null;
        try { ch.untrack(); } catch (e) {}
        try { supabaseClient.removeChannel(ch); } catch (e) {}
      }
    };
  }, [supabaseClient]);

  const sendAction = async (action: string, extra: any = {}) => {
    if (clinicChannelRef.current && mySeatRef.current) {
      clinicChannelRef.current.send({ type: 'broadcast', event: 'student_action', payload: { seat: mySeatRef.current, action, data: { name: studentInfo.name, studentId: studentInfo.id, ...extra } } });

      if (action === 'update_activity' && extra.activity) {
          trackPresenceRef.current(mySeatRef.current, studentInfo.id, clinicSessionStateRef.current, false, extra.activity);
      }
    }

    const sid = clinicSessionStateRef.current?.id;
    if (!sid) return;

    try {
        if (action === 'call' || action === 'cancel_call') {
            const { data } = await supabaseClient.from('clinic_session_state').select('active_calls').eq('id', sid).maybeSingle();
            let calls = data?.active_calls || {};
            if (action === 'call') {
                calls[extra.qNum] = { requestedAt: Date.now(), qNum: extra.qNum };
            } else {
                delete calls[extra.qNum];
            }
            await supabaseClient.from('clinic_session_state').update({ active_calls: calls }).eq('id', sid);
        }
        else if (action === 'recheck_request') {
            const { data } = await supabaseClient.from('clinic_session_state').select('active_rechecks').eq('id', sid).maybeSingle();
            let rechecks = data?.active_rechecks || {};
            
            let safeQNum = extra.qNum;
            if (!safeQNum && extra.uid) {
                const fIdx = questionsRef.current.findIndex(q => q.uid === extra.uid);
                if (fIdx !== -1) safeQNum = fIdx + 1;
            }

            rechecks[extra.uid] = { ...extra, requestedAt: Date.now(), qNum: safeQNum };
            await supabaseClient.from('clinic_session_state').update({ active_rechecks: rechecks }).eq('id', sid);
        }
        else if (action === 'away' || action === 'cancel_away') {
            await supabaseClient.from('clinic_session_state').update({ away_since: action === 'away' ? new Date().toISOString() : null, last_seen_at: new Date().toISOString() }).eq('id', sid);
        }
        else if (action === 'submit' || action === 'depart') {
            await supabaseClient.from('clinic_session_state').update({ last_seen_at: new Date().toISOString() }).eq('id', sid);
        }
    } catch(e) { console.error(e); }
  };

  useEffect(() => {
    if (!studentInfo.id) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await awardClinicMinutePoints(studentInfo.id);
        if (!cancelled) setPoints(res.balance);
      } catch (err) { console.error('포인트 에러:', err); }
    };
    tick();
    const iv = setInterval(tick, 65000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [studentInfo.id, setPoints]);

  useEffect(() => {
    if (!studentInfo.id) return;
    let cancelled = false;
    const beat = async () => {
      const sid = clinicSessionStateRef.current?.id;
      if (!sid || cancelled) return;
      await supabaseClient.from('clinic_session_state').update({ last_seen_at: new Date().toISOString() }).eq('id', sid);

      // 🌟 Presence 목록에서 내 세션이 유실된 경우에만 trackPresenceRef를 호출합니다.
      if (clinicChannelRef.current && mySeatRef.current) {
        const state = clinicChannelRef.current.presenceState?.() || {};
        const amIPresent = Object.values(state).some((metas: any) =>
          (metas as any[]).some((m: any) => m.studentId === studentInfo.id && m.seat === mySeatRef.current)
        );
        if (!amIPresent) {
          trackPresenceRef.current(mySeatRef.current, studentInfo.id, clinicSessionStateRef.current);
        }
      }
    };
    beat();
    const iv = setInterval(beat, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [studentInfo.id]);

  return { initSession, untrackPresence, sendAction };
}