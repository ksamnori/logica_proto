// src/app/clinic/viewer/hooks/useClinicRealtime.ts
import { useEffect, useRef } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { resolveTodaySession, clearActiveCall, clearActiveRecheck, clearAway } from "@/lib/clinicSession";
import { awardClinicMinutePoints } from "@/app/actions/shopPoints";
import { getKSTDateString, CLINIC_ROOM, isObjectiveQuestion } from '../utils';

interface UseClinicRealtimeProps {
  supabaseClient: SupabaseClient;
  studentInfo: { id: string; name: string; classes: string[] };
  params: { round: number; className: string; weekType: string; assignmentId: string; homeworkIdsStr: string; assignmentIdsStr: string; overdue: boolean };
  questions: any[];
  currentQIndex: number;
  isTimedRound: boolean;
  
  // Refs
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
  
  // Callbacks
  setEditorLocked: (locked: boolean) => void;
  setRecheckToast: (toast: string) => void;
  setMyAwayActive: (active: boolean) => void;
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

export function useClinicRealtime({
  supabaseClient, studentInfo, params, questions, currentQIndex, isTimedRound,
  mySeatRef, seatKeysRef, clinicSessionStateRef, callState, recheckState, taHintState, qBoxStatus,
  studentAnswers, studentDrawings, keypadAnswers, keypadCursor, correctSolvedCountRef,
  setEditorLocked, setRecheckToast, setMyAwayActive, setPendingRecheckReview, setSessionInfo, setPoints, setCanvasClearTrigger,
  forceUpdate, processCorrectAnswer, handleTimeUp, persistExamAnswersToDB, getAnswerMode, router, callCooldown, awayCooldown
}: UseClinicRealtimeProps) {
  
  const clinicChannelRef = useRef<any>(null);
  const handleTaActionRef = useRef<any>(null);
  const trackPresenceRef = useRef<any>(null);

  // 1. 학생 상태 수신 (채점 결과)
  useEffect(() => {
    if (!studentInfo.id || questions.length === 0) return;

    const handleTaRealtimeUpdate = async (payload: any, type: 'exam' | 'hw') => {
      let newData = payload.new;

      if (!newData.student_id || (!newData.question_id && !newData.tq_id)) {
        if (type === 'exam' && newData.answer_id) {
          const { data } = await supabaseClient.from('student_answer').select('*').eq('answer_id', newData.answer_id).single();
          if (data) newData = data;
        } else if (type === 'hw' && newData.hw_answer_id) {
          const { data } = await supabaseClient.from('student_homework_answer').select('*').eq('hw_answer_id', newData.hw_answer_id).single();
          if (data) newData = data;
        }
      }

      if (!newData || String(newData.student_id) !== String(studentInfo.id) || !newData.grading_code) return;

      const idx = questions.findIndex(qItem =>
        type === 'exam'
          ? (String(qItem.examAssignmentId) === String(newData.exam_assignment_id) && String(qItem.question_id) === String(newData.question_id))
          : (String(qItem.homework_id) === String(newData.homework_id) && String(qItem.tq_id) === String(newData.tq_id))
      );

      if (idx === -1) return;

      const newCode = newData.grading_code;
      const isCorrect = ['O', 'TO', 'RO'].includes(newCode);
      const currentStatus = qBoxStatus.current[idx];
      const wasCorrect = ['correct_blue', 'correct_yellow', 'retry_yellow'].includes(currentStatus || '');

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

    const channel = supabaseClient.channel(`student_realtime_grading_listen_${studentInfo.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_answer' }, (payload: any) => handleTaRealtimeUpdate(payload, 'exam'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_homework_answer' }, (payload: any) => handleTaRealtimeUpdate(payload, 'hw'))
      .subscribe();

    return () => { supabaseClient.removeChannel(channel); };
  }, [studentInfo.id, questions]);

  // 2. 조교(TA) Broadcast 수신 (최신 상태 유지를 위해 Ref에 할당)
  handleTaActionRef.current = (payload: any, sId: string, sessionState: any) => {
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
    } else if (payload.action === 'force_checkout' || payload.action === 'force_checkout_by_ta') {
      if (payload.seat !== mySeatRef.current) return;
      handleTimeUp(payload.action);
    } else if (payload.action === 'move_seat') {
      if (payload.seat === mySeatRef.current && payload.newSeat) {
        mySeatRef.current = payload.newSeat;
        supabaseClient.from('clinic_session_state').update({ seat: payload.newSeat, manual_seat: payload.newSeat }).eq('student_id', sId).is('ended_at', null).then();
        trackPresenceRef.current(payload.newSeat, sId, sessionState);
      }
    } else if (payload.action === 'adjust_clinic_time' && payload.studentId === sId) {
      const dMs = Number(payload.deltaMs) || 0;
      if (clinicSessionStateRef.current) {
        clinicSessionStateRef.current.duration_ms = Math.max(0, clinicSessionStateRef.current.duration_ms + dMs);
        trackPresenceRef.current(mySeatRef.current!, sId, clinicSessionStateRef.current);
      }
    } else if (payload.action === 'resolve_recheck') {
      const idx = questions.findIndex(item => item.uid === payload.uid);
      setPendingRecheckReview(prev => {
        const isReviewItem = prev.some(r => r.uid === payload.uid);
        if (isReviewItem) {
          if (idx !== -1) recheckState.current[idx] = null;
          setRecheckToast(payload.verdict === 'correct' ? '🎉 조교가 정답으로 확인했어요!' : '조교 확인 결과 오답이 맞습니다.');
          setTimeout(() => setRecheckToast(""), 4000);
          return prev.map(r => r.uid === payload.uid ? { ...r, resolved: true, verdict: payload.verdict } : r);
        }
        return prev;
      });

      if (idx === -1) return;
      const qItem = questions[idx];
      recheckState.current[idx] = null;

      if (payload.verdict === 'correct') {
        processCorrectAnswer(qItem, idx, true);
      } else {
        qBoxStatus.current[idx] = 'wrong_red';
        delete studentDrawings.current[idx]; delete keypadAnswers.current[idx]; delete keypadCursor.current[idx]; studentAnswers.current[idx] = null;
        setRecheckToast('조교 확인 결과 오답이 맞습니다. 다시 풀어보세요.'); setTimeout(() => setRecheckToast(""), 4000);
        setCanvasClearTrigger(p => p + 1);
        forceUpdate();
      }
    } 
    // 🌟 멈춤 현상을 완전히 해소하는 리로드 신호 수신
    else if (payload.action === 'force_refresh') {
      window.location.reload();
    }
  };

  // 3. 상태 트래킹 (Track Presence)
  trackPresenceRef.current = (seat: string, sId: string, sessionState: any) => {
    if (!clinicChannelRef.current) return;
    const activity = params.round === 1 ? (params.weekType === 'even' ? '과제오답유사 풀이중' : '주간테스트 풀이중') : params.round === 2 ? (params.overdue ? '미완료 과제 풀이중' : '과제 풀이중') : params.round === 3 ? '오답 클리닉 풀이중' : '클리닉 풀이중';
    clinicChannelRef.current.track({
      seat, name: studentInfo.name, studentId: sId, classes: studentInfo.classes, activity, updatedAt: Date.now(),
      startedAt: new Date(sessionState.started_at).getTime(), durationMs: sessionState.duration_ms
    });
  };

  // 4. 채널 연결 (Connect Channel)
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

        let amIPresent = false;
        const occupied = new Set<string>();
        Object.values(state).forEach((metas) => {
          (metas as any[]).forEach(m => { 
            if (m.seat) occupied.add(m.seat); 
            if (m.studentId === sId) amIPresent = true;
          });
        });

        if (mySeatRef.current) {
          if (!amIPresent) trackPresenceRef.current(mySeatRef.current, sId, sessionState);
          return;
        }

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

  // 5. 지속적 생명주기 관리 (포인트 적립 및 하트비트)
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
      const { data } = await supabaseClient.from('clinic_session_state').select('duration_ms').eq('id', sid).maybeSingle();
      if (data && clinicSessionStateRef.current) {
        clinicSessionStateRef.current.duration_ms = data.duration_ms;
      }
      await supabaseClient.from('clinic_session_state').update({ last_seen_at: new Date().toISOString() }).eq('id', sid);
    };
    beat();
    const iv = setInterval(beat, 15000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [studentInfo.id]);

  return { initSession, untrackPresence, sendAction };
}