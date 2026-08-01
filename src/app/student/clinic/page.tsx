// src/app/student/clinic/page.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

// ==========================================
// 상수 및 환경 설정
// ==========================================
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kfwlmbwornivkrvoeqdh.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtmd2xtYndvcm5pdmtydm9lcWRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDUzNzQsImV4cCI6MjA5NTMyMTM3NH0.Kh9MPHzUxf9xLRYTH_UqoIhxOm4lybA_OL8Z60H9vqo";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const CLINIC_ROOM = "logica-clinic-room";

const DEFAULT_CLINIC_SESSION_DURATION_MS = 60 * 60 * 1000;
const ROUND1_TIME_LIMIT_SECONDS = 20 * 60;
const SEAT_ROWS = ['A', 'B', 'C', 'D', 'E', 'F'];
const ALL_SEATS = SEAT_ROWS.flatMap(r => Array.from({ length: 10 }, (_, i) => `${r}-${String(i + 1).padStart(2, '0')}`));

const GEMINI_API_KEY_STORAGE_KEY = 'logica_gemini_api_key';
const GEMINI_MODEL_STORAGE_KEY = 'logica_gemini_model';
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

// ==========================================
// 유틸리티
// ==========================================
const formatMathTextForWeb = (text: string) => {
  if (!text) return "";
  let t = text.replace(/</g, ' &lt; ').replace(/>/g, ' &gt; ');
  t = t.replace(/<br>\s*,\s*<br>/g, ', ').replace(/<br>\s*,/g, ', ').replace(/,\s*<br>/g, ', ');
  while (/\\text\s*\{\s*\\text\s*\{/.test(t)) { t = t.replace(/\\text\s*\{\s*\\text\s*\{([^{}]+)\}\s*\}/g, '\\text{$1}'); }
  t = t.replace(/\\text\s*\{([^{}]*[가-힣]+[^{}]*)\}/g, '$1');
  t = t.replace(/\\bigcirc/g, '\\circ').replace(/\^{?[○◯]}?/g, '^{\\circ}').replace(/([0-9]+)\s*[○◯]/g, '$1^{\\circ}');
  t = t.replace(/[◀◁]\s*\|?\s*[▶▷]/g, '□').replace(/◁\|▷/g, '□').replace(/◀\|▶/g, '□');
  t = t.replace(/\\overset\s*\{\s*([^}]+)\s*\}\s*\{\s*\\square\s*\}/g, ' $1 ').replace(/\\overset\s*\{\s*([^}]+)\s*\}\s*\{\s*□\s*\}/g, ' $1 '); 
  t = t.replace(/\n/g, '<br>'); return t;
};

const getCleanUrl = (url: string) => {
  if (!url || url === 'null') return '';
  let validUrl = url;
  if (typeof validUrl === 'string' && validUrl.trim().startsWith('[')) { try { validUrl = JSON.parse(validUrl)[0]; } catch(e) {} }
  if (validUrl && validUrl !== 'null' && !validUrl.startsWith('http') && !validUrl.startsWith('data:image')) { validUrl = SUPABASE_URL + '/storage/v1/object/public/question_images/' + validUrl; }
  return validUrl;
};

export default function StudentClinicPage() {
  const router = useRouter();

  // === UI & 라우팅 파라미터 상태 ===
  const [isStarted, setIsStarted] = useState(false);
  const [studentInfo, setStudentInfo] = useState({ id: '', name: '학생', classes: [] as string[] });
  const [params, setParams] = useState({ round: 0, className: '', weekType: 'odd', assignmentId: '', homeworkIdsStr: '' });
  const [isTimedRound, setIsTimedRound] = useState(false);
  const [globalExamTitle, setGlobalExamTitle] = useState('과제');
  
  // === 타이머 상태 ===
  const [clinicRemainingStr, setClinicRemainingStr] = useState("60:00");
  const [isClinicUrgent, setIsClinicUrgent] = useState(false);
  const [roundRemainingSec, setRoundRemainingSec] = useState(ROUND1_TIME_LIMIT_SECONDS);
  const [timeIsUp, setTimeIsUp] = useState(false);

  // === 문항 및 답안 상태 ===
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [pendingQCount, setPendingQCount] = useState<string>("로딩 중...");
  
  // 잦은 업데이트가 발생하는 답안, 캔버스 등은 Ref로 관리하여 리렌더링 방지
  const [, setUiTrigger] = useState(0);
  const forceUpdate = useCallback(() => setUiTrigger(p => p + 1), []);
  
  const studentAnswers = useRef<Record<number, string | null>>({});
  const studentDrawings = useRef<Record<number, string>>({});
  const keypadAnswers = useRef<Record<number, string>>({});
  const answerModes = useRef<Record<number, 'keypad' | 'pen'>>({});
  const callState = useRef<Record<number, boolean>>({});
  const recheckState = useRef<Record<number, 'pending' | null>>({});
  const taHintState = useRef<Record<number, boolean>>({});
  const hintState = useRef<Record<number, any>>({});
  const [currentPenWidth, setCurrentPenWidth] = useState(3);
  const [keypadCollapsed, setKeypadCollapsed] = useState(false);
  const [myAwayActive, setMyAwayActive] = useState(false);

  // === 모달 및 오버레이 상태 ===
  const [resultModal, setResultModal] = useState<any>(null);
  const [recheckToast, setRecheckToast] = useState("");
  const [timeUpModal, setTimeUpModal] = useState(false);
  const [sessionTimeUpModal, setSessionTimeUpModal] = useState(false);
  const [submitConfirmModal, setSubmitConfirmModal] = useState(false);
  const [submitResultModal, setSubmitResultModal] = useState(false);
  const [geminiModalOpen, setGeminiModalOpen] = useState(false);
  const [hintModal, setHintModal] = useState<any>(null);
  const [emptyState, setEmptyState] = useState<any>(null);
  const [autoLeaveSec, setAutoLeaveSec] = useState(10);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  
  // === 캔버스 및 기타 Ref ===
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawing = useRef(false);
  const clinicChannelRef = useRef<any>(null);
  const mySeatRef = useRef<string | null>(null);
  const clinicSessionStateRef = useRef<any>(null);
  const lastGradingContextRef = useRef<any>(null);
  const mathJaxRef = useRef(false);
  const correctSolvedCountRef = useRef(0);
  const totalQuestionsInRoundRef = useRef(0);

  // ==========================================
  // 1. 초기화 및 권한 체크
  // ==========================================
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

    if (!round || isNaN(round) || !className) {
      alert('잘못된 접근입니다. 포털에서 다시 시작해주세요.');
      router.push('/student/portal'); return;
    }

    setParams({ round, className, weekType, assignmentId, homeworkIdsStr });
    setIsTimedRound(round === 1 || round === 4);

    initMathJax();
    initSessionAndFetch(sId, round, className, weekType, assignmentId, homeworkIdsStr);

    const handleUnload = () => untrackPresence();
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
    return () => { window.removeEventListener('pagehide', handleUnload); window.removeEventListener('beforeunload', handleUnload); untrackPresence(); };
  }, []);

  const initMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]], processEscapes: true }, chtml: { displayAlign: 'left' } };
      const script = document.createElement("script"); script.id = "MathJax-script"; script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"; script.async = true;
      document.head.appendChild(script);
    }
  };

  // ==========================================
  // 2. 세션 타이머 및 데이터 로딩
  // ==========================================
  const initSessionAndFetch = async (sId: string, round: number, cls: string, week: string, assignId: string, hwIds: string) => {
    const today = new Date().toISOString().slice(0, 10);
    let { data: sessionData } = await supabase.from('clinic_session_state').select('*').eq('student_id', sId).maybeSingle();
    
    if (!sessionData || sessionData.session_date !== today) {
      const fresh = { student_id: sId, session_date: today, started_at: new Date().toISOString(), duration_ms: DEFAULT_CLINIC_SESSION_DURATION_MS, seat: null, manual_seat: sessionData?.manual_seat || null };
      const { data } = await supabase.from('clinic_session_state').upsert(fresh).select().single();
      sessionData = data || fresh;
    }
    clinicSessionStateRef.current = sessionData;

    connectChannel(sId, sessionData);

    const { data: eData } = await supabase.from('enrollment').select('class(name)').eq('student_id', sId);
    if (eData) {
      const cNames = Array.from(new Set(eData.map((e:any) => e.class?.name).filter(Boolean))) as string[];
      setStudentInfo(prev => ({ ...prev, classes: cNames.length ? cNames : [cls] }));
    }

    if (round === 1 || round === 4) await fetchWeeklyTest(sId, week, cls, assignId);
    else if (round === 2 || round === 3) await fetchHomework(sId, hwIds);
    else await fetchIncorrect(sId);
  };

  const fetchWeeklyTest = async (sId: string, week: string, cls: string, assignId: string) => {
    try {
      let matchedExamId = null; let matchedTitle = null;
      const examType = week === 'even' ? '과제오답유사' : '주간테스트';
      
      if (assignId) {
      const { data } = await supabase.from('exam_assignment').select('exam_id, exam_master(title)').eq('assignment_id', assignId).maybeSingle();
      if (data && data.exam_id) { 
        matchedExamId = data.exam_id; 
        // 배열로 들어올 경우와 객체로 들어올 경우 모두 안전하게 처리
        matchedTitle = Array.isArray(data.exam_master) 
          ? data.exam_master[0]?.title 
          : (data.exam_master as any)?.title; 
      }
    }

      if (!matchedExamId) {
        const { data: sData } = await supabase.from('student').select('grade').eq('student_id', sId).maybeSingle();
        const myGradeLabel = sData?.grade ? (parseInt(sData.grade) >= 1 && parseInt(sData.grade) <= 6 ? `초등학교 ${sData.grade}학년` : parseInt(sData.grade) >= 7 && parseInt(sData.grade) <= 9 ? `중학교 ${parseInt(sData.grade) - 6}학년` : `고등학교 ${parseInt(sData.grade) - 9}학년`) : '';
        const { data: exams } = await supabase.from('exam_master').select('exam_id, title, major_grade').eq('exam_type', examType).order('created_at', { ascending: false });
        const matched = (exams || []).find((e:any) => e.major_grade === myGradeLabel || String(e.major_grade) === String(sData?.grade));
        if (matched) { matchedExamId = matched.exam_id; matchedTitle = matched.title; }
      }

      if (!matchedExamId) {
        setPendingQCount(`이번 주 ${examType}: 없음`);
        setQuestions([]); return;
      }

      setGlobalExamTitle(matchedTitle || `이번 주 ${examType}`);
      const { data: items } = await supabase.from('exam_item').select('*, question_db(*)').eq('exam_id', matchedExamId).order('sort_order', { ascending: true });
      const validItems = (items || []).filter((it:any) => it.question_db);

      if (validItems.length === 0) { setPendingQCount(`이번 주 ${examType}: 문제 없음`); setQuestions([]); return; }
      
      setPendingQCount(`이번 주 ${examType}: ${validItems.length}문제 (20분 제한)`);
      const mapped = validItems.map((it:any, i:number) => ({
        index: i, uid: 'rq' + i + '_' + Date.now(), question_id: it.question_db.question_id, record_id: null,
        source: matchedTitle || `이번 주 ${examType}`, questionText: formatMathTextForWeb(it.question_db.question),
        imageUrl: getCleanUrl(it.question_db.image_url), options: typeof it.question_db.options === 'string' ? JSON.parse(it.question_db.options) : it.question_db.options,
        answer: String(it.question_db.answer || '').trim(), explanation: it.question_db.explanation || it.question_db.solution || '',
        hints: [it.question_db.step_1_concept || "개념 힌트 없음", it.question_db.step_2_approach || "접근법 힌트 없음"]
      }));
      totalQuestionsInRoundRef.current = mapped.length;
      setQuestions(mapped);
    } catch(e) {}
  };

  const fetchHomework = async (sId: string, hwIdsStr: string) => {
    try {
      if (!hwIdsStr) { setPendingQCount(`대기 중인 과제: 0문제`); setQuestions([]); return; }
      const hwIdsArray = hwIdsStr.split(',').map(Number).filter(n => !isNaN(n));
      const { data: assignments } = await supabase.from('homework_assignment').select('homework_id, homework_title, target_questions, student_homework_result(status, completed_tq_ids)').in('homework_id', hwIdsArray);
      if (!assignments || assignments.length === 0) { setPendingQCount(`대기 중인 과제: 0문제`); setQuestions([]); return; }

      let allTqIds: number[] = []; const metaMap: any = {};
      assignments.forEach((hw:any) => {
        let tqIds = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : hw.target_questions;
        const res = hw.student_homework_result?.find((r:any) => r.student_id === sId) || {};
        let compIds = typeof res.completed_tq_ids === 'string' ? JSON.parse(res.completed_tq_ids) : res.completed_tq_ids;
        if (!Array.isArray(tqIds)) tqIds = []; if (!Array.isArray(compIds)) compIds = [];
        
        tqIds.forEach((idNum: number) => {
          if (!compIds.includes(idNum)) { allTqIds.push(idNum); metaMap[idNum] = { homework_id: hw.homework_id, homework_title: hw.homework_title }; }
        });
      });

      allTqIds = [...new Set(allTqIds)];
      if (allTqIds.length === 0) { setPendingQCount(`모든 과제를 완료했습니다!`); setQuestions([]); return; }

      setGlobalExamTitle('정규 과제');
      const { data: qs } = await supabase.from('textbook_question').select('*').in('tq_id', allTqIds);
      setPendingQCount(`대기 중인 병합 과제: ${(qs||[]).length}문제`);
      
      const mapped = (qs||[]).map((q:any, i:number) => {
        const raw = q.raw_metadata || {};
        return {
          index: i, uid: 'rq' + i + '_' + Date.now(), homework_id: metaMap[q.tq_id]?.homework_id || null, tq_id: q.tq_id, question_id: q.question_id,
          source: metaMap[q.tq_id]?.homework_title || '통합 과제', questionText: formatMathTextForWeb(raw.question || '(문제 텍스트 없음)'),
          imageUrl: getCleanUrl(raw.image_url || raw.imageUrl || q.image_url), options: typeof raw.options === 'string' ? JSON.parse(raw.options) : raw.options,
          answer: String(q.answer || '').trim(), explanation: raw.explanation || raw.solution || '', hints: ['교재 문제라 힌트가 없습니다.', '교재 문제라 힌트가 없습니다.']
        };
      });
      totalQuestionsInRoundRef.current = mapped.length;
      setQuestions(mapped);
    } catch(e){}
  };

  const fetchIncorrect = async (sId: string) => {
    try {
      const { data: records } = await supabase.from('student_incorrect_record').select('record_id, question_id, source_type, question_db(*)').eq('student_id', sId).is('resolved_at', null).in('current_status', ['X', 'TX', 'T', '☆', 'B']);
      if (!records || records.length === 0) { setPendingQCount(`대기 중인 오답: 0문제`); setQuestions([]); return; }
      setPendingQCount(`대기 중인 오답: ${records.length}문제`);
      const mapped = records.filter((r:any) => r.question_db).map((r:any, i:number) => {
        const q = r.question_db;
        return {
          index: i, uid: 'rq' + i + '_' + Date.now(), record_id: r.record_id, question_id: q.question_id,
          source: r.source_type || '오답노트', questionText: formatMathTextForWeb(q.question),
          imageUrl: getCleanUrl(q.image_url), options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
          answer: String(q.answer || '').trim(), explanation: q.explanation || q.solution || '', hints: [q.step_1_concept || "개념 힌트 없음", q.step_2_approach || "접근법 힌트 없음"]
        };
      });
      totalQuestionsInRoundRef.current = mapped.length;
      setQuestions(mapped);
    } catch(e){}
  };

  // ==========================================
  // 3. 실시간 동기화 (Presence)
  // ==========================================
  const connectChannel = (sId: string, sessionState: any) => {
    clinicChannelRef.current = supabase.channel(CLINIC_ROOM);
    clinicChannelRef.current
      .on('presence', { event: 'sync' }, () => {
        if (mySeatRef.current) return;
        const state = clinicChannelRef.current.presenceState();
        const occupied = new Set();
        Object.values(state).forEach((metas: any) => metas.forEach((m: any) => { if(m.seat) occupied.add(m.seat); }));
        
        const manualSeat = sessionState.manual_seat;
        const storedSeat = sessionState.session_date === new Date().toISOString().slice(0, 10) ? sessionState.seat : null;
        const seat = manualSeat || storedSeat || ALL_SEATS.find(s => !occupied.has(s)) || null;
        
        if (seat) {
          mySeatRef.current = seat;
          supabase.from('clinic_session_state').update({ seat }).eq('student_id', sId).then();
          trackPresence(seat, sId, sessionState);
        }
      })
      .on('broadcast', { event: 'ta_action' }, ({ payload }: any) => handleTaAction(payload, sId, sessionState))
      .subscribe();
  };

  const trackPresence = (seat: string, sId: string, sessionState: any) => {
    if (!clinicChannelRef.current) return;
    const activity = params.round === 1 ? (params.weekType === 'even' ? '과제오답유사 풀이중' : '주간테스트 풀이중') : params.round === 2 ? '과제 풀이중' : params.round === 3 ? '미완성 과제 풀이중' : '클리닉 풀이중';
    clinicChannelRef.current.track({
      seat, name: studentInfo.name, studentId: sId, classes: studentInfo.classes, activity, updatedAt: Date.now(),
      startedAt: new Date(sessionState.started_at).getTime(), durationMs: sessionState.duration_ms
    });
  };

  const untrackPresence = async () => {
    if (clinicChannelRef.current) {
      try { await clinicChannelRef.current.untrack(); await clinicChannelRef.current.unsubscribe(); } catch(e){}
      clinicChannelRef.current = null;
    }
  };

  const sendAction = (action: string, extra = {}) => {
    if (clinicChannelRef.current && mySeatRef.current) {
      clinicChannelRef.current.send({ type: 'broadcast', event: 'student_action', payload: { seat: mySeatRef.current, action, data: { name: studentInfo.name, studentId: studentInfo.id, ...extra } } });
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
            if (questions[qIdx]?.record_id) supabase.from('student_incorrect_record').update({ current_status: 'T' }).eq('record_id', questions[qIdx].record_id).then();
          }
          forceUpdate();
        }
      }
    } else if (payload.action === 'force_return_to_seat') {
      setMyAwayActive(false);
    } else if (payload.action === 'force_checkout' || payload.action === 'force_checkout_by_ta') {
      if (payload.seat !== mySeatRef.current) return;
      handleTimeUp(payload.action);
    } else if (payload.action === 'move_seat') {
      if (payload.seat === mySeatRef.current && payload.newSeat) {
        mySeatRef.current = payload.newSeat;
        supabase.from('clinic_session_state').update({ seat: payload.newSeat }).eq('student_id', sId).then();
        trackPresence(payload.newSeat, sId, sessionState);
      }
    } else if (payload.action === 'adjust_clinic_time' && payload.studentId === sId) {
      const dMs = Number(payload.deltaMs) || 0;
      if (clinicSessionStateRef.current) {
        clinicSessionStateRef.current.duration_ms = Math.max(0, clinicSessionStateRef.current.duration_ms + dMs);
        trackPresence(mySeatRef.current!, sId, clinicSessionStateRef.current);
      }
    } else if (payload.action === 'resolve_recheck' && payload.seat === mySeatRef.current) {
      const idx = questions.findIndex(q => q.uid === payload.uid);
      if (idx === -1 || recheckState.current[idx] !== 'pending') return;

      const q = questions[idx];
      if (payload.verdict === 'correct') {
        processCorrectAnswer(q, idx, true).then(() => {
          setRecheckToast('🎉 조교가 정답으로 확인했어요!'); setTimeout(() => setRecheckToast(""), 4000);
        });
      } else {
        recheckState.current[idx] = null;
        delete studentDrawings.current[idx]; delete keypadAnswers.current[idx]; studentAnswers.current[idx] = null;
        setRecheckToast('조교 확인 결과 오답이 맞습니다. 다시 풀어보세요.'); setTimeout(() => setRecheckToast(""), 4000);
        forceUpdate();
        setTimeout(() => initCanvas(idx), 50);
      }
    }
  };

  // ==========================================
  // 4. 타이머 처리
  // ==========================================
  useEffect(() => {
    const sessionTimer = setInterval(() => {
      if (!clinicSessionStateRef.current) return;
      const rem = (new Date(clinicSessionStateRef.current.started_at).getTime() + clinicSessionStateRef.current.duration_ms) - Date.now();
      setIsClinicUrgent(rem <= 5 * 60 * 1000);
      if (rem <= 0) {
        setClinicRemainingStr("00:00");
        if (!timeIsUp) handleTimeUp();
      } else {
        const ts = Math.floor(rem / 1000);
        setClinicRemainingStr(`${Math.floor(ts / 3600) > 0 ? Math.floor(ts / 3600) + ':' : ''}${String(Math.floor((ts % 3600) / 60)).padStart(2,'0')}:${String(ts % 60).padStart(2,'0')}`);
      }
    }, 1000);

    let roundTimer: any;
    if (isStarted && isTimedRound && !timeIsUp) {
      roundTimer = setInterval(() => {
        setRoundRemainingSec(p => {
          if (p <= 1) { clearInterval(roundTimer); handleTimeUp(); return 0; }
          return p - 1;
        });
      }, 1000);
    }
    return () => { clearInterval(sessionTimer); if (roundTimer) clearInterval(roundTimer); };
  }, [isStarted, isTimedRound, timeIsUp]);

  // ==========================================
  // 5. 답안 제출 및 AI 채점 (Gemini)
  // ==========================================
  const startClinic = () => {
    if (questions.length === 0) return;
    setIsStarted(true);
    if (!isTimedRound && questions.length === 0) {
      setEmptyState({ title: '모든 오답을 해결했습니다!', desc: '더 이상 풀 문제가 없습니다. 홈으로 돌아가세요.' });
    }
    setTimeout(() => { if ((window as any).MathJax) (window as any).MathJax.typesetPromise(); initCanvas(0); }, 100);
  };

  const handleTimeUp = async (forceAction?: string) => {
    setTimeIsUp(true);
    let corrects = 0;
    questions.forEach((q, i) => { if (keypadAnswersMatch(studentAnswers.current[i], q.answer)) corrects++; });
    correctSolvedCountRef.current = corrects;
    
    const incQIds = questions.filter((q, i) => !keypadAnswersMatch(studentAnswers.current[i], q.answer) && q.question_id).map(q => q.question_id);
    if (incQIds.length > 0) await generateIncorrectPrint(incQIds, globalExamTitle);

    if (forceAction) {
      setSessionTimeUpModal(true);
    } else if (isTimedRound) {
      await saveExamResultsToDB();
      setSubmitResultModal(true);
    } else {
      setSessionTimeUpModal(true); 
    }

    let sec = 10; setAutoLeaveSec(sec);
    const itv = setInterval(() => { sec--; setAutoLeaveSec(sec); if (sec <= 0) { clearInterval(itv); leaveAndGoHome(); } }, 1000);
  };

  const submitSingleAnswer = async () => {
    if (timeIsUp || callState.current[currentQIndex] || recheckState.current[currentQIndex] === 'pending') return;
    const q = questions[currentQIndex];
    const isSubjective = !(q.options && q.options.length > 0);
    const useAI = isSubjective && (answerModes.current[currentQIndex] || (studentDrawings.current[currentQIndex] ? 'pen' : 'keypad')) === 'pen';
    const myAns = studentAnswers.current[currentQIndex];

    if (!myAns) { alert(useAI ? "답을 먼저 그려주세요!" : "정답을 먼저 입력해주세요!"); return; }

    let isCorrect = false; let gradingMeta: any = null;

    if (useAI) {
      try {
        gradingMeta = await gradeHandwrittenAnswerWithGemini(myAns, q.answer, q.questionText);
        isCorrect = !!gradingMeta.is_correct;
      } catch (err: any) {
        if (err.message.includes('API 키가 설정되지')) setGeminiModalOpen(true);
        else alert('AI 채점 중 문제 발생:\n' + err.message);
        return;
      }
    } else {
      isCorrect = keypadAnswersMatch(myAns, q.answer);
    }

    lastGradingContextRef.current = useAI ? { idx: currentQIndex, uid: q.uid, q, imageDataUrl: myAns, gradingMeta } : null;
    const gotTaHint = !!taHintState.current[currentQIndex];

    if (isCorrect) {
      await processCorrectAnswer(q, currentQIndex, false);
      setResultModal({ isCorrect: true, note: gotTaHint ? '조교 힌트를 받아 해결했어요.' : null, canRecheck: false });
    } else {
      if (gotTaHint) {
        if (q.record_id) await supabase.from('student_incorrect_record').update({ current_status: 'TX' }).eq('record_id', q.record_id);
        if (!isTimedRound) await finalizeHomeworkProgress(q, false);
      } else {
        if (!isTimedRound) await finalizeHomeworkProgress(q, false);
      }
      setResultModal({ isCorrect: false, note: gotTaHint ? '조교 힌트를 받았지만 아직 오답이에요. (TX로 기록됨)' : null, canRecheck: useAI });
    }
  };

  const processCorrectAnswer = async (q: any, idx: number, fromRecheck: boolean) => {
    const usedHint = hintState.current[idx] && (hintState.current[idx].level1 || hintState.current[idx].level2);
    const newStatus = (taHintState.current[idx] || usedHint) ? 'TO' : 'O';
    
    if (q.record_id) await supabase.from('student_incorrect_record').update({ current_status: newStatus, resolved_at: new Date().toISOString() }).eq('record_id', q.record_id);
    if (!isTimedRound) await finalizeHomeworkProgress(q, true);

    correctSolvedCountRef.current++;
    const newQs = [...questions]; newQs.splice(idx, 1);
    
    [studentAnswers, hintState, callState, taHintState, studentDrawings, keypadAnswers, answerModes, recheckState].forEach(ref => {
      delete ref.current[idx];
      Object.keys(ref.current).map(Number).filter(k => k > idx).sort((a,b)=>a-b).forEach(k => { ref.current[k-1] = ref.current[k]; delete ref.current[k]; });
    });

    setQuestions(newQs);
    if (newQs.length === 0) {
      setEmptyState({ title: '모든 오답을 해결했습니다!', desc: '더 이상 풀 문제가 없습니다. 홈으로 돌아가세요.' });
      saveRoundScoreToLocalStorage();
    } else {
      setCurrentQIndex(Math.min(idx, newQs.length - 1));
      setTimeout(() => initCanvas(Math.min(idx, newQs.length - 1)), 100);
    }
    forceUpdate();
  };

  const requestRecheck = () => {
    if (!lastGradingContextRef.current) return;
    const { idx, uid, q, imageDataUrl, gradingMeta } = lastGradingContextRef.current;
    setResultModal(null);
    recheckState.current[idx] = 'pending';
    sendAction('recheck_request', { uid, qNum: idx + 1, questionText: q.questionText, correctAnswer: q.answer, imageDataUrl, recognizedText: gradingMeta?.recognized_text || '', aiExplanation: gradingMeta?.explanation || '', aiConfidence: gradingMeta?.confidence || null });
    lastGradingContextRef.current = null;
    setRecheckToast('🔄 조교에게 재확인을 요청했어요. 잠시만 기다려주세요.'); setTimeout(() => setRecheckToast(""), 4000);
    forceUpdate();
  };

  const finalizeHomeworkProgress = async (q: any, isCorrect: boolean) => {
    if (!q.homework_id) return;
    const { data: existing } = await supabase.from('student_homework_answer').select('hw_answer_id, wrong_attempts_log').eq('homework_id', q.homework_id).eq('student_id', studentInfo.id).eq('tq_id', q.tq_id).maybeSingle();
    let wrongLog = existing?.wrong_attempts_log || [];
    if (typeof wrongLog === 'string') try { wrongLog = JSON.parse(wrongLog); } catch(e){ wrongLog=[]; }
    if (!Array.isArray(wrongLog)) wrongLog = [];
    
    const myAns = studentAnswers.current[currentQIndex] || '미입력';
    if (!isCorrect && myAns !== '미입력') wrongLog.push({ input: myAns, at: new Date().toISOString() });

    const payload = { homework_id: q.homework_id, student_id: studentInfo.id, tq_id: q.tq_id, student_input: myAns, is_correct: isCorrect, grading_code: isCorrect ? 'O' : 'X', earned_score: isCorrect ? 1 : 0, wrong_attempts_log: wrongLog };
    if (existing) await supabase.from('student_homework_answer').update(payload).eq('hw_answer_id', existing.hw_answer_id);
    else await supabase.from('student_homework_answer').insert(payload);

    if (isCorrect) {
      const { data: hwRes } = await supabase.from('student_homework_result').select('hw_result_id, completed_tq_ids, homework_assignment(target_questions)').eq('homework_id', q.homework_id).eq('student_id', studentInfo.id).maybeSingle();
      if (hwRes) {
        let comp = typeof hwRes.completed_tq_ids === 'string' ? JSON.parse(hwRes.completed_tq_ids) : hwRes.completed_tq_ids;
        if (!Array.isArray(comp)) comp = [];
        const cSet = new Set(comp.map(Number)); cSet.add(Number(q.tq_id));
        const hwAssign = hwRes.homework_assignment as any;
let tq = typeof hwAssign?.target_questions === 'string' ? JSON.parse(hwAssign.target_questions) : hwAssign?.target_questions;
        if (!Array.isArray(tq)) tq = [];
        const allDone = tq.every((id:any) => cSet.has(Number(id)));
        await supabase.from('student_homework_result').update({ completed_tq_ids: [...cSet], status: allDone ? '채점완료' : undefined }).eq('hw_result_id', hwRes.hw_result_id);
      }
    }
  };

  const saveExamResultsToDB = async () => {
    if (!isTimedRound || !params.assignmentId) return;
    await supabase.from('student_answer').delete().eq('exam_assignment_id', params.assignmentId).eq('student_id', studentInfo.id);
    
    const inserts: any[] = []; const incUpserts: any[] = []; let totalScore = 0;
    questions.forEach((q, idx) => {
      const ans = studentAnswers.current[idx] ? String(studentAnswers.current[idx]).trim() : '미입력';
      const isCorrect = ans !== '미입력' && keypadAnswersMatch(ans, q.answer);
      const score = isCorrect ? (100 / totalQuestionsInRoundRef.current) : 0;
      totalScore += score;

      inserts.push({ exam_assignment_id: params.assignmentId, student_id: studentInfo.id, question_id: q.question_id, student_input: ans, is_correct: isCorrect, earned_score: score, grading_code: isCorrect ? 'O' : 'X', grading_status: '대기' });
      if (!isCorrect && q.question_id) {
        incUpserts.push({ student_id: studentInfo.id, question_id: q.question_id, source_type: '시험지', status: ans === '미입력' ? 'B' : 'X', resolved_at: null });
      }
    });

    if (inserts.length > 0) await supabase.from('student_answer').insert(inserts);
    if (incUpserts.length > 0) await supabase.from('student_incorrect_record').upsert(incUpserts, { onConflict: 'student_id, question_id' });
    await supabase.from('exam_assignment').update({ status: '제출완료', total_score: totalScore }).eq('assignment_id', params.assignmentId);
  };

  const generateIncorrectPrint = async (incQIds: number[], sourceTitle: string) => {
    const uIds = [...new Set(incQIds)];
    if (uIds.length === 0) return;
    try {
      const { data: cls } = await supabase.from('enrollment').select('class(instructor_id)').eq('student_id', studentInfo.id).limit(1).single();
      // 배열로 들어올 경우와 객체로 들어올 경우 모두 대응
      let instId = Array.isArray(cls?.class) ? cls?.class[0]?.instructor_id : (cls?.class as any)?.instructor_id;
      if (!instId) { const { data: fb } = await supabase.from('instructor').select('instructor_id').limit(1).single(); instId = fb?.instructor_id; }
      if (!instId) return;

      const title = `[${studentInfo.name}] ${sourceTitle} 오답 프린트`;
      const { data: ex } = await supabase.from('exam_master').insert({ title, exam_type: '오답프린트', instructor_id: instId, total_questions: uIds.length }).select().single();
      
      const items = uIds.map((qid, i) => ({ exam_id: ex.exam_id, question_id: qid, sort_order: i + 1, assigned_score: Math.round(100 / uIds.length) }));
      await supabase.from('exam_item').insert(items);
      await supabase.from('exam_assignment').insert({ exam_id: ex.exam_id, student_id: studentInfo.id, status: '미응시' });
    } catch(e) {}
  };

  const saveRoundScoreToLocalStorage = () => {
    const key = `logica_clinic_${studentInfo.id}_${params.className}_round${params.round}_score`;
    try { localStorage.setItem(key, JSON.stringify({ correct: correctSolvedCountRef.current, total: totalQuestionsInRoundRef.current, savedAt: new Date().toISOString() })); } catch(e){}
  };

  // ==========================================
  // 6. UI 컨트롤 및 캔버스
  // ==========================================
  const keypadAnswersMatch = (myAns: string | null, correctAns: string) => {
    if (!myAns) return false;
    const a = String(myAns).trim(); const b = String(correctAns).trim();
    if (a === b) return true;
    const m1 = a.match(/^-?\d+(?:\.\d+)?(?:\/-?\d+(?:\.\d+)?)?/);
    const m2 = b.match(/^-?\d+(?:\.\d+)?(?:\/-?\d+(?:\.\d+)?)?/);
    if (!m1 || !m2) return false;
    const p1 = m1[0].includes('/') ? parseFloat(m1[0].split('/')[0])/parseFloat(m1[0].split('/')[1]) : parseFloat(m1[0]);
    const p2 = m2[0].includes('/') ? parseFloat(m2[0].split('/')[0])/parseFloat(m2[0].split('/')[1]) : parseFloat(m2[0]);
    return p1 === p2;
  };

  const drawGrid = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save(); ctx.strokeStyle = 'rgba(28,37,48,0.06)'; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
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
    ctx.scale(dpr, dpr); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1C2530'; ctx.lineWidth = currentPenWidth;
    
    drawGrid(ctx, rect.width, rect.height);

    const saved = studentDrawings.current[idx];
    if (saved) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height); img.src = saved; }

    const getPos = (e: any) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX || e.touches?.[0].clientX) - r.left, y: (e.clientY || e.touches?.[0].clientY) - r.top }; };
    
    const startDraw = (e: any) => { isDrawing.current = true; const p = getPos(e); ctx.lineWidth = currentPenWidth; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x+0.01, p.y+0.01); ctx.stroke(); };
    const draw = (e: any) => { if (!isDrawing.current) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const stopDraw = () => { if (!isDrawing.current) return; isDrawing.current = false; studentDrawings.current[idx] = canvas.toDataURL('image/png'); studentAnswers.current[idx] = studentDrawings.current[idx]; };

    canvas.onpointerdown = startDraw; canvas.onpointermove = draw; canvas.onpointerup = stopDraw; canvas.onpointerleave = stopDraw; canvas.onpointercancel = stopDraw;
  };

  const gradeHandwrittenAnswerWithGemini = async (dataUrl: string, correct: string, qText: string) => {
    const key = localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY);
    if (!key) throw new Error('API 키가 설정되지 않았습니다.');
    const model = localStorage.getItem(GEMINI_MODEL_STORAGE_KEY) || DEFAULT_GEMINI_MODEL;
    const base64 = dataUrl.split(',')[1];
    
    const prompt = `당신은 깐깐한 수학 채점자입니다. 아래 손글씨 답안을 채점하세요. 문제: ${qText.replace(/<[^>]+>/g, '')}\n정답(원문): "${correct}"\n인식결과, 정답여부(is_correct: true/false), 확신도, 이유를 포함해 JSON으로만 응답하세요.`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: base64 } }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } })
    });
    if (!res.ok) throw new Error('API 오류');
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  };

  const pressKeypad = (key: string) => {
    let cur = keypadAnswers.current[currentQIndex] || '';
    if (key === 'back') cur = cur.slice(0, -1); else if (key === 'clear') cur = ''; else cur += key;
    keypadAnswers.current[currentQIndex] = cur;
    studentAnswers.current[currentQIndex] = cur.trim() || null;
    forceUpdate();
  };

  const toggleAnswerMode = () => {
    const mode = answerModes.current[currentQIndex] === 'pen' ? 'keypad' : 'pen';
    answerModes.current[currentQIndex] = mode;
    studentAnswers.current[currentQIndex] = mode === 'pen' ? (studentDrawings.current[currentQIndex] || null) : (keypadAnswers.current[currentQIndex] || null);
    forceUpdate();
    if (mode === 'pen') setTimeout(() => initCanvas(currentQIndex), 50);
  };

  const leaveAndGoHome = async () => {
    setIsLoggingOut(true);
    await untrackPresence();
    router.push('/student/portal');
  };

  const q = questions[currentQIndex];
  if (!isStarted) {
    return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 font-pretendard">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg text-center animate-[fadeIn_0.3s_ease-out]">
          <div className="font-lexend text-4xl font-black text-[#002864] tracking-tighter mb-4">Logica Clinic</div>
          <p className="text-sm text-slate-500 font-bold mb-8">{isTimedRound ? '그동안의 노력을 테스트해보세요!' : params.round===3?'이번 회차 전에 끝내지 못한 과제를 마무리해봐요!':'배부된 과제를 풀어봐요!'}</p>
          <div className="mb-8 bg-slate-50 border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-bold text-slate-400 mb-1">학생 이름</p><p className="text-2xl font-extrabold text-slate-800">{studentInfo.name}</p>
            <div className="mt-4"><span className="text-xs font-bold text-rose-500 bg-rose-100 px-3 py-1.5 rounded-full">{pendingQCount}</span></div>
          </div>
          <button onClick={startClinic} disabled={questions.length === 0} className="w-full bg-[#002864] hover:bg-blue-950 text-white font-bold py-4 rounded-xl shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {questions.length > 0 ? (isTimedRound ? '⏱️ 20분 타이머 시작하기' : '🚀 풀이 시작하기') : '풀 문제가 없습니다!'}
          </button>
        </div>
      </div>
    );
  }

  const isSubjective = q && !(q.options && q.options.length > 0);
  const curAnsMode = answerModes.current[currentQIndex] || (studentDrawings.current[currentQIndex] ? 'pen' : 'keypad');
  const isCall = !!callState.current[currentQIndex];
  const isRecheck = recheckState.current[currentQIndex] === 'pending';

  return (
    <div className="bg-slate-100 h-screen flex flex-col font-pretendard select-none">
      {isLoggingOut && <div className="fixed inset-0 bg-slate-900/85 z-[9999] flex flex-col items-center justify-center text-white text-center px-8 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]"><span className="text-6xl mb-4 animate-bounce">👋</span><div className="font-lexend tracking-tight font-bold text-2xl">안전하게 나가는 중입니다...</div><div className="text-sm mt-3 text-slate-300">잠시 후 자동으로 이동합니다.</div></div>}
      <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <div className="font-lexend text-2xl font-bold text-[#002864] tracking-tighter">Logica</div><div className="w-px h-6 bg-slate-300"></div>
          <h1 className="text-lg font-bold text-slate-800"><span>{studentInfo.name}</span>의 맞춤 오답 클리닉</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-sm transition-colors ${isClinicUrgent ? 'bg-rose-100 border-rose-300 animate-pulse text-rose-600' : 'bg-indigo-50 border border-indigo-200 text-indigo-600'}`} title="전체 이용 가능 시간">
            <span className="text-lg">🕐</span><span className="font-lexend font-black">{clinicRemainingStr}</span>
          </div>
          {isTimedRound && (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-sm ${roundRemainingSec <= 60 ? 'bg-rose-100 animate-pulse text-rose-600' : 'bg-rose-50 border border-rose-200 text-rose-600'}`}>
              <span className="text-lg">⏱️</span><span className="font-lexend font-black">{String(Math.floor(roundRemainingSec/60)).padStart(2,'0')}:{String(roundRemainingSec%60).padStart(2,'0')}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 bg-yellow-50 border border-yellow-200 px-3 py-1.5 rounded-full shadow-sm"><span className="text-yellow-500 text-lg">🪙</span><span className="font-bold text-yellow-700">1,250 P</span></div>
          <div className="w-px h-4 bg-slate-300"></div>
          <button onClick={leaveAndGoHome} className="text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors">나가기</button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-6 flex justify-center relative">
        {emptyState && (
          <div className="absolute inset-0 bg-slate-100 flex flex-col items-center justify-center z-50 animate-[fadeIn_0.3s_ease-out]">
            <span className="text-6xl mb-4">🎉</span><h2 className="text-2xl font-extrabold text-slate-700">{emptyState.title}</h2>
            <p className="text-slate-500 font-medium mt-2">{emptyState.desc}</p>
            {isTimedRound && <p className="text-sm font-bold text-[#002864] bg-white border border-slate-200 rounded-full px-4 py-1.5 mt-4 shadow-sm">정답률 {correctSolvedCountRef.current}/{totalQuestionsInRoundRef.current}</p>}
            <button onClick={leaveAndGoHome} className="mt-6 bg-[#002864] hover:bg-blue-900 text-white font-bold px-8 py-3 rounded-xl shadow-md transition-all">홈으로 돌아가기</button>
          </div>
        )}

        {q && !emptyState && (
          <div className="w-full max-w-6xl grid grid-cols-10 gap-6 h-full relative">
            <div className="col-span-7 bg-white rounded-2xl shadow-md flex flex-col overflow-hidden border border-slate-200">
              <div className="flex items-center p-6 border-b border-slate-100 bg-slate-50 shrink-0">
                <span className="text-3xl font-extrabold text-[#002864] w-14">{String(currentQIndex + 1).padStart(2, '0')}</span>
                <h2 className="text-sm font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1 rounded-full shadow-sm">원본: {q.source}</h2>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                <div className="text-[16px] word-break-keep whitespace-pre-wrap leading-[1.6] text-slate-800 font-myungjo font-semibold" dangerouslySetInnerHTML={{ __html: q.questionText }} />
                {q.imageUrl && <img src={q.imageUrl} className="mt-4 max-w-full rounded-lg border border-slate-200" />}
              </div>

              {isCall && <div className="bg-rose-50 border-t border-rose-100 px-5 py-2.5 text-center text-sm font-extrabold text-rose-600 shrink-0">🚨 {currentQIndex + 1}번 문제를 호출했습니다.</div>}
              {taHintState.current[currentQIndex] && <div className="bg-amber-50 border-t border-amber-100 px-5 py-2 text-center text-xs font-bold text-amber-600 shrink-0">🧑‍🏫 조교에게 힌트를 받았어요. 이어서 풀어 제출해보세요!</div>}

              {!isTimedRound && (
                <div className="bg-blue-50/50 p-5 border-t border-blue-100 shrink-0">
                  <div className="flex justify-between items-center mb-3"><span className="text-sm font-bold text-blue-800 flex items-center gap-1">💡 AI 단계별 힌트</span></div>
                  <div className="flex gap-2">
                    <button onClick={() => { setHintModal({ level: 1, cost: 10 }); }} disabled={hintState.current[currentQIndex]?.level1} className={`flex-1 border text-sm font-bold py-3 rounded shadow-sm transition-colors ${hintState.current[currentQIndex]?.level1 ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-white border-blue-200 hover:bg-blue-100 text-blue-700'}`}>{hintState.current[currentQIndex]?.level1 ? "1단계 힌트 열람 완료" : "1단계 개념 힌트 (-10P)"}</button>
                    <button onClick={() => { setHintModal({ level: 2, cost: 30 }); }} disabled={!hintState.current[currentQIndex]?.level1 || hintState.current[currentQIndex]?.level2} className={`flex-1 border text-sm font-bold py-3 rounded shadow-sm transition-colors ${hintState.current[currentQIndex]?.level2 ? 'bg-slate-100 text-slate-400' : hintState.current[currentQIndex]?.level1 ? 'bg-white border-blue-200 hover:bg-blue-100 text-blue-700' : 'opacity-50 cursor-not-allowed bg-slate-100 text-slate-400'}`}>{hintState.current[currentQIndex]?.level2 ? "2단계 힌트 열람 완료" : "2단계 접근 방법 (-30P)"}</button>
                    <button onClick={() => { setMyAwayActive(!myAwayActive); sendAction(myAwayActive ? 'cancel_away' : 'away'); }} disabled={!myAwayActive && Object.values(callState.current).some(v=>v)} className={`shrink-0 border text-sm font-bold py-3 px-4 rounded shadow-sm transition-colors ${myAwayActive ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-300 hover:bg-slate-100 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed'}`}>{myAwayActive ? '↩️ 자리 복귀' : '🚶 자리비움'}</button>
                  </div>
                  {hintState.current[currentQIndex]?.revealed?.length > 0 && (
                    <div className="mt-4 p-4 bg-blue-900 text-blue-50 rounded-lg text-sm font-medium leading-relaxed">
                      {hintState.current[currentQIndex].revealed.map((h:any, i:number) => (
                        <div key={i} className="mb-3"><span className="bg-blue-700 text-white text-[10px] px-2 py-0.5 rounded mr-1">LV {h.level}</span><br/><span className="mt-1 block" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(h.text) }}/></div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="col-span-3 flex flex-col gap-4">
              <div className="bg-white rounded-2xl shadow-md p-6 border border-slate-200 shrink-0 relative">
                <h3 className="font-bold text-slate-700 mb-4 text-center text-sm">문항 이동 <span className="text-slate-400 font-normal">(총 {questions.length}문항)</span></h3>
                <div className="flex flex-nowrap gap-2 overflow-x-auto custom-scrollbar pb-1">
                  {questions.map((_, i) => (
                    <button key={i} onClick={() => { setCurrentQIndex(i); setTimeout(() => initCanvas(i), 50); forceUpdate(); }} className={`w-10 h-10 shrink-0 border-2 rounded-lg font-bold shadow-sm transition-colors flex items-center justify-center ${callState.current[i] ? (i === currentQIndex ? 'bg-red-600 border-red-600 text-white' : 'bg-red-100 border-red-300 text-red-700') : (i === currentQIndex ? 'bg-[#002864] border-[#002864] text-white' : 'border-slate-200 text-slate-500')}`}>
                      {i + 1}
                    </button>
                  ))}
                </div>
                {!isTimedRound && (
                  <button onClick={() => setSubmitConfirmModal(true)} disabled={timeIsUp} className="w-full mt-4 bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 rounded-lg shadow-sm transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                    📮 전체 제출하기
                  </button>
                )}
              </div>
              
              <div className="bg-white rounded-2xl shadow-md p-4 flex-1 flex flex-col border border-slate-200 relative overflow-hidden">
                {(isCall || isRecheck) && <div className="absolute inset-0 z-20 bg-white/50 flex flex-col items-center pt-2 backdrop-blur-[1px]"><div className={`border text-xs font-bold rounded-lg p-3 text-center w-[90%] shadow-sm ${isCall ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-indigo-50 border-indigo-200 text-indigo-600'}`}>{isCall ? <>🙋 호출 중에는 정답을 입력할 수 없어요<br/>조교가 올 때까지 잠시 기다려주세요.</> : <>🕐 조교에게 재확인을 요청했어요<br/>확인이 끝날 때까지 잠시만 기다려주세요.</>}</div></div>}

                <h3 className="font-bold text-slate-700 mb-2 text-center text-sm"><span className="text-[#002864] text-lg font-black mr-1">{currentQIndex + 1}</span>번 정답 입력</h3>
                <div className="flex flex-col gap-2 flex-1">
                  {q.options && q.options.length > 0 ? (
                    q.options.map((opt: string, oIdx: number) => (
                      <label key={oIdx} className={`w-full px-4 py-3 border-2 rounded-lg text-left font-bold cursor-pointer transition-colors flex gap-3 shadow-sm items-center ${studentAnswers.current[currentQIndex] === String(oIdx + 1) ? 'bg-[#002864] border-[#002864] text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                        <input type="radio" name="omr" className="hidden" checked={studentAnswers.current[currentQIndex] === String(oIdx + 1)} onChange={() => { studentAnswers.current[currentQIndex] = String(oIdx + 1); forceUpdate(); }} />
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${studentAnswers.current[currentQIndex] === String(oIdx + 1) ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{oIdx + 1}</span>
                        <span className="font-myungjo" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(opt) }} />
                      </label>
                    ))
                  ) : curAnsMode === 'pen' ? (
                    <div className="w-full h-full flex flex-col gap-2 relative">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-400">✍️ 풀이 과정과 정답을 그려주세요</label>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => { setCurrentPenWidth(Math.max(1, currentPenWidth - 1)); if(ctxRef.current) ctxRef.current.lineWidth = Math.max(1, currentPenWidth - 1); }} className="w-6 h-6 rounded bg-slate-100 text-slate-500 font-bold">−</button>
                          <span className="text-[10px] font-bold text-slate-400 w-4 text-center">{currentPenWidth}</span>
                          <button onClick={() => { setCurrentPenWidth(Math.min(10, currentPenWidth + 1)); if(ctxRef.current) ctxRef.current.lineWidth = Math.min(10, currentPenWidth + 1); }} className="w-6 h-6 rounded bg-slate-100 text-slate-500 font-bold">+</button>
                          <button onClick={() => { delete studentDrawings.current[currentQIndex]; studentAnswers.current[currentQIndex] = null; if(canvasRef.current && ctxRef.current) { ctxRef.current.clearRect(0,0,canvasRef.current.width,canvasRef.current.height); drawGrid(ctxRef.current, canvasRef.current.width, canvasRef.current.height); } }} className="text-[10px] font-bold text-rose-500 ml-1">지우기</button>
                          <button onClick={() => setGeminiModalOpen(true)} className="text-slate-300 hover:text-slate-500 text-xs ml-1">⚙️</button>
                          <button onClick={toggleAnswerMode} className="text-[10px] font-bold text-[#002864] bg-blue-50 px-2 py-1 rounded ml-1">🔢 키패드</button>
                        </div>
                      </div>
                      <canvas ref={canvasRef} className="w-full flex-1 min-h-[160px] rounded-xl border-2 border-slate-300 bg-white shadow-inner cursor-crosshair touch-none"></canvas>
                      <p className="text-[10px] text-slate-400 font-medium text-center">🤖 채점은 제미나이(Gemini) AI가 도와줘요</p>
                    </div>
                  ) : (
                    <div className="w-full flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-bold text-slate-400">🔢 정답을 입력해주세요</label>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setKeypadCollapsed(!keypadCollapsed)} className="w-5 h-5 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center"><span className={`text-[9px] transition-transform ${keypadCollapsed ? 'rotate-180' : ''}`}>◁</span></button>
                          <button onClick={toggleAnswerMode} className="text-[10px] font-bold text-[#002864] bg-blue-50 px-1.5 py-0.5 rounded">✍️ 손글씨</button>
                        </div>
                      </div>
                      <input readOnly value={keypadAnswers.current[currentQIndex] || ''} className="w-full text-lg font-extrabold text-right px-3 py-1.5 border-2 border-slate-200 rounded-lg bg-slate-50 text-slate-800 outline-none" placeholder="0" />
                      <div className={`overflow-hidden transition-all duration-300 ${keypadCollapsed ? 'max-h-0 opacity-0' : 'max-h-[150px] opacity-100'}`}>
                        <div className="grid grid-cols-4 gap-1 pt-1">
                          {['7','8','9','back','4','5','6','clear','1','2','3','-','0','.','/'].map(k => (
                            <button key={k} onClick={() => pressKeypad(k)} className={`py-1.5 rounded-lg font-bold ${k==='back' ? 'bg-slate-100 text-slate-500 text-xs' : k==='clear' ? 'bg-rose-50 text-rose-500 text-xs' : k==='0' ? 'col-span-2 bg-slate-50 text-slate-700 text-sm' : k==='-' || k==='.' || k==='/' ? 'bg-slate-100 text-slate-500 text-sm' : 'bg-slate-50 text-slate-700 text-sm'}`}>{k === 'back' ? '⌫' : k === 'clear' ? 'C' : k === '/' ? '분수 /' : k}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {!isTimedRound && (
                <div className="flex flex-col gap-3 mt-auto shrink-0">
                  <div className="flex gap-3 w-full">
                    <button onClick={submitSingleAnswer} disabled={timeIsUp || isCall || isRecheck} className="w-2/3 bg-[#002864] hover:bg-blue-900 text-white font-extrabold text-lg py-5 rounded-xl shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed">✅ 정답 저장</button>
                    <button onClick={() => { if(!callState.current[currentQIndex] && myAwayActive){ alert('자리비움 중에는 호출 불가합니다.'); return;} callState.current[currentQIndex] = !callState.current[currentQIndex]; forceUpdate(); sendAction(callState.current[currentQIndex] ? 'call' : 'cancel_call', callState.current[currentQIndex] ? { qNum: currentQIndex + 1, questionText: q.questionText, imageUrl: q.imageUrl, options: q.options, answer: q.answer, explanation: q.explanation, source: q.source } : { qNum: currentQIndex + 1 }); }} disabled={timeIsUp || (!callState.current[currentQIndex] && myAwayActive) || isRecheck} className={`w-1/3 font-extrabold text-lg py-5 rounded-xl shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isCall ? 'bg-rose-700 text-white' : 'bg-rose-500 text-white hover:bg-rose-600'}`}>{isCall ? '🚨 호출 취소' : '🙋 호출'}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* 모달 1: 힌트 확인 */}
      {hintModal && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-[320px] text-center">
            <div className="text-4xl mb-3">🪙</div><h3 className="text-lg font-extrabold text-slate-800 mb-2">포인트 차감 안내</h3>
            <p className="text-sm text-slate-600 mb-6 font-medium leading-relaxed">{hintModal.level}단계 힌트를 열람하시겠습니까?<br/>보유 포인트에서 <span className="font-bold text-rose-500">{hintModal.cost}P</span>가 차감됩니다.</p>
            <div className="flex gap-2">
              <button onClick={() => setHintModal(null)} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg hover:bg-slate-200 transition-colors">취소</button>
              <button onClick={() => { const hq = hintState.current[currentQIndex] || { level1: false, level2: false, revealed: [] }; hq[`level${hintModal.level}`] = true; hq.revealed.push({ level: hintModal.level, text: q.hints[hintModal.level - 1] }); hintState.current[currentQIndex] = hq; sendAction('hint', { qNum: currentQIndex + 1, level: hintModal.level }); setHintModal(null); forceUpdate(); }} className="flex-1 bg-[#002864] text-white font-bold py-3 rounded-lg hover:bg-blue-900 transition-colors">열람하기</button>
            </div>
          </div>
        </div>
      )}

      {/* 모달 2: 개별 정답 결과 */}
      {resultModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center transform transition-transform scale-100 animate-[fadeIn_0.2s_ease-out]">
            <div className="text-6xl mb-4">{resultModal.isCorrect ? "🎉" : "💥"}</div>
            <h3 className={`text-2xl font-black mb-2 ${resultModal.isCorrect ? 'text-emerald-600' : 'text-rose-600'}`}>{resultModal.isCorrect ? "정답입니다!" : "아쉽게 틀렸습니다"}</h3>
            <p className="text-sm text-slate-500 font-bold mb-8 leading-relaxed">{resultModal.isCorrect ? (resultModal.note ? `완벽히 복습되었습니다. ${resultModal.note}` : "완벽히 복습되었습니다. 오답 노트에서 제외됩니다.") : (resultModal.note || "다시 한번 풀어보거나, 힌트를 열람해보세요.")}</p>
            <button onClick={() => { if(resultModal.isCorrect){ const nQ=[...questions]; nQ.splice(currentQIndex,1); [studentAnswers, hintState, callState, taHintState, studentDrawings, keypadAnswers, answerModes, recheckState].forEach(ref=>{ delete ref.current[currentQIndex]; Object.keys(ref.current).map(Number).filter(k=>k>currentQIndex).sort((a,b)=>a-b).forEach(k=>{ref.current[k-1]=ref.current[k]; delete ref.current[k];});}); setQuestions(nQ); if(nQ.length===0){ setEmptyState({title:'모든 오답을 해결했습니다!',desc:'더 이상 풀 문제가 없습니다. 홈으로 돌아가세요.'}); } else{ setCurrentQIndex(Math.min(currentQIndex, nQ.length-1)); setTimeout(()=>initCanvas(Math.min(currentQIndex, nQ.length-1)),50); } forceUpdate(); } else{ studentAnswers.current[currentQIndex]=null; delete studentDrawings.current[currentQIndex]; delete keypadAnswers.current[currentQIndex]; forceUpdate(); setTimeout(()=>initCanvas(currentQIndex),50); } setResultModal(null); }} className={`w-full font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all ${resultModal.isCorrect ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-800 hover:bg-slate-900 text-white'}`}>
              {resultModal.isCorrect ? "확인 및 다음 문제" : "다시 풀기"}
            </button>
            {resultModal.canRecheck && <button onClick={() => { requestRecheck(); setResultModal(null); }} className="w-full mt-2.5 bg-white border-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-bold px-6 py-3 rounded-xl text-sm transition-all">🔄 AI 채점이 이상해요 — 조교에게 재확인 요청</button>}
          </div>
        </div>
      )}

      {/* 모달 3: 세션 종료 (시간 다됨) */}
      {sessionTimeUpModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[80] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center">
            <div className="text-6xl mb-4">⏰</div><h3 className="text-2xl font-black text-slate-800 mb-2">클리닉 시간이 종료되었습니다</h3>
            <p className="text-sm text-slate-500 font-bold mb-6">오늘 배정된 클리닉 이용 시간이 모두 지났어요.<br/>수고하셨습니다!</p>
            <button onClick={leaveAndGoHome} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all">홈으로 돌아가기</button>
            <p className="text-xs font-bold text-slate-400 mt-4"><span>{autoLeaveSec}</span>초 후 자동으로 나가집니다...</p>
          </div>
        </div>
      )}

      {/* 모달 4: 테스트 타임 오버 / 제출 완료 */}
      {timeUpModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[60] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center">
            <div className="text-6xl mb-4">⏰</div><h3 className="text-2xl font-black text-slate-800 mb-2">시간이 모두 지났습니다!</h3>
            <p className="text-sm text-slate-500 font-bold mb-4">20분 제한 시간이 모두 지났어요.<br/>지금까지 입력한 답안이 제출됩니다.</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl py-3 mb-6"><p className="text-xs font-bold text-slate-400 mb-1">정답률</p><p className="text-2xl font-black text-[#002864]">{correctSolvedCountRef.current}/{totalQuestionsInRoundRef.current}</p></div>
            <button onClick={leaveAndGoHome} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all">홈으로 돌아가기</button>
            <p className="text-xs font-bold text-slate-400 mt-4"><span>{autoLeaveSec}</span>초 후 자동으로 나가집니다...</p>
          </div>
        </div>
      )}

      {/* 모달 5: 전체 제출 확인 */}
      {submitConfirmModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[70] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center">
            <div className="text-4xl mb-3">📝</div><h3 className="text-lg font-extrabold text-slate-800 mb-3">테스트/과제 제출</h3>
            <p className="text-sm text-slate-600 mb-6 font-medium leading-relaxed" dangerouslySetInnerHTML={{ __html: questions.filter((_,i)=>!studentAnswers.current[i]).length > 0 ? `아직 풀지 않은 문제가 <span class="text-rose-500 font-black">${questions.filter((_,i)=>!studentAnswers.current[i]).length}개</span> 있어요.<br>그래도 제출하시겠습니까?` : `정말 제출하시겠습니까?<br>제출 후에는 답을 바꿀 수 없어요.` }}></p>
            <div className="flex gap-2">
              <button onClick={() => setSubmitConfirmModal(false)} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg hover:bg-slate-200 transition-colors">취소</button>
              <button onClick={() => { setSubmitConfirmModal(false); handleTimeUp(); }} className="flex-1 bg-[#002864] text-white font-bold py-3 rounded-lg hover:bg-blue-900 transition-colors shadow-sm">제출하기</button>
            </div>
          </div>
        </div>
      )}

      {/* 모달 6: 전체 제출 완료 */}
      {submitResultModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[60] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center">
            <div className="text-6xl mb-4">📮</div><h3 className="text-2xl font-black text-slate-800 mb-2">제출 완료!</h3>
            <p className="text-sm text-slate-500 font-bold mb-4">답안을 제출했어요. 수고했어요!</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl py-3 mb-6"><p className="text-xs font-bold text-slate-400 mb-1">정답률</p><p className="text-2xl font-black text-[#002864]">{correctSolvedCountRef.current}/{totalQuestionsInRoundRef.current}</p></div>
            <button onClick={leaveAndGoHome} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all">홈으로 돌아가기</button>
            <p className="text-xs font-bold text-slate-400 mt-4"><span>{autoLeaveSec}</span>초 후 자동으로 나가집니다...</p>
          </div>
        </div>
      )}

      {/* 모달 7: 제미나이 설정 */}
      {geminiModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[90] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm text-left">
            <h3 className="text-lg font-extrabold text-slate-800 mb-1">🤖 AI 채점 설정 (제미나이)</h3>
            <p className="text-xs text-slate-400 font-medium mb-4 leading-relaxed">손글씨 답안을 Google Gemini 비전 API로 채점합니다.<br/>API 키는 브라우저에만 저장되며 Google API로 직접 전송됩니다.</p>
            <label className="text-xs font-bold text-slate-500">Gemini API 키</label>
            <input type="password" id="gemini-key" defaultValue={localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) || ''} placeholder="AIza..." className="w-full mt-1 mb-3 px-3 py-2.5 border-2 border-slate-200 rounded-lg text-sm focus:border-[#002864] outline-none" />
            <label className="text-xs font-bold text-slate-500">모델명</label>
            <input type="text" id="gemini-model" defaultValue={localStorage.getItem(GEMINI_MODEL_STORAGE_KEY) || DEFAULT_GEMINI_MODEL} className="w-full mt-1 mb-1 px-3 py-2.5 border-2 border-slate-200 rounded-lg text-sm focus:border-[#002864] outline-none" />
            <p className="text-[10px] text-slate-400 font-medium mb-4">API 키는 Google AI Studio에서 발급받을 수 있어요.</p>
            <div className="flex gap-2">
              <button onClick={() => setGeminiModalOpen(false)} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg text-sm hover:bg-slate-200 transition-colors">취소</button>
              <button onClick={() => { const k=(document.getElementById('gemini-key') as HTMLInputElement).value.trim(); const m=(document.getElementById('gemini-model') as HTMLInputElement).value.trim(); if(k) localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, k); if(m) localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, m); setGeminiModalOpen(false); }} className="flex-1 bg-[#002864] hover:bg-blue-900 text-white font-bold py-3 rounded-lg text-sm transition-colors shadow-sm">저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 재확인 토스트 */}
      {recheckToast && <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[80] bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-2xl max-w-md text-center animate-[fadeIn_0.3s_ease-out]">{recheckToast}</div>}
    </div>
  );
}