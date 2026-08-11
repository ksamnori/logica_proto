// src/app/clinic/viewer/page.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { resolveTodaySession, closeSessionAtLimit, setActiveCall, clearActiveCall, setActiveRecheck, setAway, clearAway } from "@/lib/clinicSession";
import { getActiveSeatLayout } from "@/app/actions/clinicSeatLayout";
import { awardClinicMinutePoints, spendPoints } from "@/app/actions/shopPoints";
import { resolvePendingHomeworkQuestions, BOOK_TYPE_COLORS } from "@/lib/clinicHomework";
import PointBadge from "@/components/clinic/PointBadge";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const getSupabaseClient = () => {
    if (typeof window === 'undefined') return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (!(window as any)._supabaseInstance) (window as any)._supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return (window as any)._supabaseInstance;
};
const supabaseClient = getSupabaseClient();
const getKSTDateString = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

const CLINIC_ROOM = "logica-clinic-room";
const ROUND1_TIME_LIMIT_SECONDS = 20 * 60;

const GEMINI_API_KEY_STORAGE_KEY = 'logica_gemini_api_key';
const GEMINI_MODEL_STORAGE_KEY = 'logica_gemini_model';
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const PEN_COLORS = ['#1C2530', '#DC2626', '#2563EB', '#16A34A'];
const ERASER_WIDTH_MULTIPLIER = 6;

const formatMathTextForWeb = (text: string) => {
  if (!text) return "";
  let t = text.replace(/<br\s*\/?>/gi, '__LOGICA_BR_PLACEHOLDER__');
  t = t.replace(/</g, ' &lt; ').replace(/>/g, ' &gt; ');
  t = t.replace(/__LOGICA_BR_PLACEHOLDER__/g, '<br>');
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

const hintStorageKey = (sId: string, q: any) => `logica_hint_${sId}_${q.question_id ?? 'q'}_${q.tq_id ?? 'tq'}`;

const hydrateHintState = (sId: string, mapped: any[]): Record<number, any> => {
  const next: Record<number, any> = {};
  if (typeof window === 'undefined') return next;
  mapped.forEach((q, i) => {
    try {
      const raw = window.localStorage.getItem(hintStorageKey(sId, q));
      if (raw) next[i] = JSON.parse(raw);
    } catch (e) {}
  });
  return next;
};

const saveHintState = (sId: string, q: any, hq: any) => {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(hintStorageKey(sId, q), JSON.stringify(hq)); } catch (e) {}
};

const NO_HINT_BOOK_TYPES = ['주교재', '부교재'];
const textbookHintFields = (bookType: string | null | undefined) => {
  if (bookType && NO_HINT_BOOK_TYPES.includes(bookType)) {
    return { hasHint: false, needsAiHint: false, hints: ['교재 문제라 힌트가 없습니다.', '교재 문제라 힌트가 없습니다.'] };
  }
  return { hasHint: true, needsAiHint: true, hints: ['', ''] };
};

const QuestionDisplay = React.memo(function QuestionDisplay({ html, imageUrl }: { html: string; imageUrl?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise && ref.current) {
      mj.typesetPromise([ref.current]).catch((err: any) => console.error("MathJax 타이프셋 에러:", err));
    }
  }, [html]);
  return (
    <div ref={ref}>
      <div className="text-[16px] word-break-keep whitespace-pre-wrap leading-[1.6] text-slate-800 font-myungjo font-semibold" dangerouslySetInnerHTML={{ __html: html }} />
      {imageUrl && <img src={imageUrl} className="mt-4 max-w-full rounded-lg border border-slate-200" />}
    </div>
  );
});

const HintRevealBox = React.memo(function HintRevealBox({ revealed }: { revealed: { level: number; text: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(revealed.length - 1);
  const prevLenRef = useRef(revealed.length);
  useEffect(() => {
    if (revealed.length !== prevLenRef.current) {
      setActiveIdx(revealed.length - 1);
      prevLenRef.current = revealed.length;
    }
  }, [revealed]);
  const safeIdx = Math.min(activeIdx, revealed.length - 1);
  const active = revealed[safeIdx];
  useEffect(() => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise && ref.current) {
      mj.typesetPromise([ref.current]).catch((err: any) => console.error("MathJax 타이프셋 에러:", err));
    }
  }, [active]);
  if (!active) return null;
  return (
    <div className="mt-4">
      {revealed.length > 1 && (
        <div className="flex gap-1.5 mb-2">
          {revealed.map((h, i) => (
            <button key={i} onClick={() => setActiveIdx(i)} className={`text-[11px] font-bold px-2.5 py-1 rounded-md transition-colors ${i === safeIdx ? 'bg-blue-700 text-white' : 'bg-blue-100 text-blue-600 hover:bg-blue-200'}`}>LV {h.level} 힌트</button>
          ))}
        </div>
      )}
      <div ref={ref} className="p-4 bg-blue-900 text-blue-50 rounded-lg text-sm font-medium leading-relaxed max-h-[220px] overflow-y-auto custom-scrollbar">
        <span dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(active.text) }}/>
      </div>
    </div>
  );
});

export default function ClinicViewer() {
  const router = useRouter();

  const [isStarted, setIsStarted] = useState(false);
  const [studentInfo, setStudentInfo] = useState({ id: '', name: '학생', classes: [] as string[] });
  const [params, setParams] = useState({ round: 0, className: '', weekType: 'odd', assignmentId: '', homeworkIdsStr: '' });
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
  const answerModes = useRef<Record<number, 'keypad' | 'pen'>>({});
  const callState = useRef<Record<number, boolean>>({});
  const recheckState = useRef<Record<number, 'pending' | null>>({});
  const taHintState = useRef<Record<number, boolean>>({});
  const hintState = useRef<Record<number, any>>({});
  const qBoxStatus = useRef<Record<number, 'correct_blue' | 'correct_yellow' | 'retry_yellow' | 'wrong_red'>>({});
  const penGradeCache = useRef<Record<number, boolean>>({});
  const penGradeInFlight = useRef<Record<number, Promise<void> | undefined>>({});
  const hintRequestInFlightRef = useRef(false);
  const [currentPenWidth, setCurrentPenWidth] = useState(3);
  const [currentPenColor, setCurrentPenColor] = useState(PEN_COLORS[0]);
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [keypadCollapsed, setKeypadCollapsed] = useState(false);
  const [hintPanelExpanded, setHintPanelExpanded] = useState(true);
  const [myAwayActive, setMyAwayActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [resultModal, setResultModal] = useState<any>(null);
  const [recheckToast, setRecheckToast] = useState("");
  const [timeUpModal, setTimeUpModal] = useState(false);
  const [sessionTimeUpModal, setSessionTimeUpModal] = useState(false);
  const [submitConfirmModal, setSubmitConfirmModal] = useState(false);
  const [submitResultModal, setSubmitResultModal] = useState(false);
  const [geminiModalOpen, setGeminiModalOpen] = useState(false);
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

  useEffect(() => {
    getActiveSeatLayout().then(layout => {
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

    return () => {
      window.removeEventListener('pagehide', handleUnload); window.removeEventListener('beforeunload', handleUnload);
      untrackPresence();
    };
  }, []);

  const initMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]], processEscapes: true }, chtml: { displayAlign: 'left' } };
      const script = document.createElement("script"); script.id = "MathJax-script"; script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"; script.async = true;
      script.onload = () => { (window as any).MathJax?.typesetPromise?.().catch((err: any) => console.error("MathJax 타이프셋 에러:", err)); };
      document.head.appendChild(script);
    }
  };

  const initSessionAndFetch = async (sId: string, round: number, cls: string, week: string, assignId: string, hwIds: string) => {
    const today = getKSTDateString();
    const sessionData = await resolveTodaySession(supabaseClient, sId, today);
    clinicSessionStateRef.current = sessionData;
    setSessionInfo(sessionData);

    await connectChannel(sId, sessionData);
    assignSeatDirectly(sId, sessionData);

    const { data: eData } = await supabaseClient.from('enrollment').select('class(name)').eq('student_id', sId);
    if (eData) {
      const cNames = Array.from(new Set(eData.map((e:any) => e.class?.name).filter(Boolean))) as string[];
      setStudentInfo(prev => ({ ...prev, classes: cNames.length ? cNames : [cls] }));
    }

    if (round === 1 || round === 4) await fetchWeeklyTest(sId, week, cls, assignId);
    else if (round === 2 || round === 3) await fetchHomework(sId, hwIds, assignId);
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
      const qDbMap = new Map<any, any>((qDbRows || []).map((q:any) => [q.question_id, q]));
      const tqMap = new Map<any, any>((tqRows || []).map((tq:any) => [tq.tq_id, tq]));

      const mapped: any[] = [];
      records.forEach((r:any) => {
        if (r.question_id && qDbMap.has(r.question_id)) {
          const q = qDbMap.get(r.question_id);
          mapped.push({
            index: mapped.length, uid: 'rq' + mapped.length + '_' + Date.now(), record_id: r.record_id, question_id: q.question_id,
            source: '과제오답유사', questionText: formatMathTextForWeb(q.question),
            imageUrl: getCleanUrl(q.image_url), options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
            answer: String(q.answer || '').trim(), explanation: q.explanation || q.solution || '', hints: [q.step_1_concept || "개념 힌트 없음", q.step_2_approach || "접근법 힌트 없음"]
          });
        } else if (r.tq_id && tqMap.has(r.tq_id)) {
          const tq = tqMap.get(r.tq_id);
          const raw = tq.raw_metadata || {};
          mapped.push({
            index: mapped.length, uid: 'rq' + mapped.length + '_' + Date.now(), record_id: r.record_id, tq_id: tq.tq_id,
            source: '과제오답유사', questionText: formatMathTextForWeb(raw.question || '(문제 텍스트 없음)'),
            imageUrl: getCleanUrl(raw.image_url || raw.imageUrl || tq.image_url), options: typeof raw.options === 'string' ? JSON.parse(raw.options) : raw.options,
            answer: String(tq.answer || '').trim(), explanation: raw.explanation || raw.solution || '', ...textbookHintFields(tq.textbook?.book_type),
            bookId: tq.book_id, bookType: tq.textbook?.book_type, bookTitle: tq.textbook?.title
          });
        }
      });

      if (mapped.length === 0) { setPendingQCount(`이번 주 과제오답유사: 없음`); setQuestions([]); return; }
      setGlobalExamTitle('이번 주 과제오답유사');
      setPendingQCount(`이번 주 과제오답유사: ${mapped.length}문제`);
      totalQuestionsInRoundRef.current = mapped.length;
      hintState.current = hydrateHintState(sId, mapped);
      setQuestions(mapped);
    } catch(e) {}
  };

  const fetchWeeklyTest = async (sId: string, week: string, cls: string, assignId: string) => {
    if (week === 'even') return fetchHomeworkSimilarIncorrect(sId);
    try {
      let matchedExamId = null; let matchedTitle = null;
      const examType = '주간테스트';
      let displayLabel = examType;

      if (assignId) {
        const { data } = await supabaseClient.from('exam_assignment').select('exam_id, exam_master!inner(title, exam_type)').eq('assignment_id', assignId).eq('exam_master.exam_type', examType).maybeSingle();
        if (data && data.exam_id) {
          matchedExamId = data.exam_id;
          matchedTitle = data.exam_master?.title;
          displayLabel = data.exam_master?.exam_type || displayLabel;
        }
      }

      if (!matchedExamId) {
        const { data: sData } = await supabaseClient.from('student').select('grade').eq('student_id', sId).maybeSingle();
        const myGradeLabel = sData?.grade ? (parseInt(sData.grade) >= 1 && parseInt(sData.grade) <= 6 ? `초등학교 ${sData.grade}학년` : parseInt(sData.grade) >= 7 && parseInt(sData.grade) <= 9 ? `중학교 ${parseInt(sData.grade) - 6}학년` : `고등학교 ${parseInt(sData.grade) - 9}학년`) : '';
        const { data: exams } = await supabaseClient.from('exam_master').select('exam_id, title, major_grade').eq('exam_type', examType).order('created_at', { ascending: false });
        const matched = (exams || []).find((e:any) => e.major_grade === myGradeLabel || String(e.major_grade) === String(sData?.grade));
        if (matched) { matchedExamId = matched.exam_id; matchedTitle = matched.title; }
      }

      if (!matchedExamId) {
        setPendingQCount(`이번 주 ${displayLabel}: 없음`);
        setQuestions([]); return;
      }

      setGlobalExamTitle(matchedTitle || `이번 주 ${displayLabel}`);
      const { data: items } = await supabaseClient.from('exam_item').select('*, question_db(*)').eq('exam_id', matchedExamId).order('sort_order', { ascending: true });
      const validItems = (items || []).filter((it:any) => it.question_db);

      if (validItems.length === 0) { setPendingQCount(`이번 주 ${displayLabel}: 문제 없음`); setQuestions([]); return; }

      setPendingQCount(`이번 주 ${displayLabel}: ${validItems.length}문제 (20분 제한)`);
      const mapped = validItems.map((it:any, i:number) => ({
        index: i, uid: 'rq' + i + '_' + Date.now(), question_id: it.question_db.question_id, record_id: null,
        source: matchedTitle || `이번 주 ${displayLabel}`, questionText: formatMathTextForWeb(it.question_db.question),
        imageUrl: getCleanUrl(it.question_db.image_url), options: typeof it.question_db.options === 'string' ? JSON.parse(it.question_db.options) : it.question_db.options,
        answer: String(it.question_db.answer || '').trim(), explanation: it.question_db.explanation || it.question_db.solution || '',
        hints: [it.question_db.step_1_concept || "개념 힌트 없음", it.question_db.step_2_approach || "접근법 힌트 없음"]
      }));
      totalQuestionsInRoundRef.current = mapped.length;
      hintState.current = hydrateHintState(sId, mapped);
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
    const rows = validItems.map((it: any) => ({
      examAssignmentId: assignId, question_id: it.question_db.question_id,
      bookId: Number(assignId), bookType, bookTitle: title || '배정된 과제',
      source: title || '배정된 과제', questionText: formatMathTextForWeb(it.question_db.question),
      imageUrl: getCleanUrl(it.question_db.image_url), options: typeof it.question_db.options === 'string' ? JSON.parse(it.question_db.options) : it.question_db.options,
      answer: String(it.question_db.answer || '').trim(), explanation: it.question_db.explanation || it.question_db.solution || '',
      hints: [it.question_db.step_1_concept || "개념 힌트 없음", it.question_db.step_2_approach || "접근법 힌트 없음"],
    }));
    return { rows, title };
  };

  const fetchHomework = async (sId: string, hwIdsStr: string, assignId: string = '') => {
    try {
      const hwIdsArray = hwIdsStr ? hwIdsStr.split(',').map(Number).filter(n => !isNaN(n)) : [];
      const [{ rows: qs }, { rows: examRows, title: examTitle }] = await Promise.all([
        hwIdsArray.length > 0 ? resolvePendingHomeworkQuestions(supabaseClient, sId, hwIdsArray) : Promise.resolve({ rows: [] }),
        fetchAssignedExamQuestions(assignId),
      ]);

      if (examRows.length > 0) examAssignmentTotalsRef.current[assignId] = examRows.length;

      if (qs.length === 0 && examRows.length === 0) { setPendingQCount(`모든 과제를 완료했습니다!`); setQuestions([]); return; }

      setGlobalExamTitle(examTitle || '정규 과제');
      setPendingQCount(`대기 중인 병합 과제: ${qs.length + examRows.length}문제`);

      const mappedHw = qs.map((q:any, i:number) => {
        const raw = q.raw_metadata || {};
        return {
          index: i, uid: 'rq' + i + '_' + Date.now(), homework_id: q.homeworkId, tq_id: q.tq_id, question_id: q.question_id,
          source: q.homeworkTitle || '통합 과제', questionText: formatMathTextForWeb(raw.question || '(문제 텍스트 없음)'),
          imageUrl: getCleanUrl(raw.image_url || raw.imageUrl || q.image_url), options: typeof raw.options === 'string' ? JSON.parse(raw.options) : raw.options,
          answer: String(q.answer || '').trim(), explanation: raw.explanation || raw.solution || '', ...textbookHintFields(q.bookType),
          bookId: q.book_id, bookType: q.bookType, bookTitle: q.bookTitle
        };
      });
      const mappedExam = examRows.map((q: any, i: number) => ({ ...q, index: mappedHw.length + i, uid: 'rq' + (mappedHw.length + i) + '_' + Date.now() }));
      const mapped = [...mappedHw, ...mappedExam];

      totalQuestionsInRoundRef.current = mapped.length;
      hintState.current = hydrateHintState(sId, mapped);
      setQuestions(mapped);
    } catch(e){}
  };

  const fetchIncorrect = async (sId: string) => {
    try {
      const { data: records } = await supabaseClient.from('student_incorrect_record').select('record_id, question_id, source_type, question_db(*)').eq('student_id', sId).is('resolved_at', null).in('status', ['X', 'TX', 'T', '☆', 'B']);
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
      hintState.current = hydrateHintState(sId, mapped);
      setQuestions(mapped);
    } catch(e){}
  };

  // ==========================================
  // 3. 실시간 동기화 (Presence)
  // ==========================================
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
    
    // 🌟 [핵심 보안 추가] 학생 뷰어도 로그인된 자기 지점(tenant_id)의 실시간 방으로 연결되게 격리합니다!
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
    const activity = params.round === 1 ? (params.weekType === 'even' ? '과제오답유사 풀이중' : '주간테스트 풀이중') : params.round === 2 ? '과제 풀이중' : params.round === 3 ? '미완성 과제 풀이중' : '클리닉 풀이중';
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
      const idx = questions.findIndex(q => q.uid === payload.uid);
      if (idx === -1 || recheckState.current[idx] !== 'pending') return;

      const q = questions[idx];
      if (payload.verdict === 'correct') {
        processCorrectAnswer(q, idx, true).then(() => {
          setRecheckToast('🎉 조교가 정답으로 확인했어요!'); setTimeout(() => setRecheckToast(""), 4000);
        });
      } else {
        recheckState.current[idx] = null;
        qBoxStatus.current[idx] = 'wrong_red';
        delete studentDrawings.current[idx]; delete keypadAnswers.current[idx]; studentAnswers.current[idx] = null;
        setRecheckToast('조교 확인 결과 오답이 맞습니다. 다시 풀어보세요.'); setTimeout(() => setRecheckToast(""), 4000);
        forceUpdate();
        setTimeout(() => initCanvas(idx), 50);
      }
    }
  };

  const handleTaActionRef = useRef(handleTaAction);
  useEffect(() => { handleTaActionRef.current = handleTaAction; });

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
        if (!timeIsUp) {
          if (clinicSessionStateRef.current.id) closeSessionAtLimit(supabaseClient, clinicSessionStateRef.current.id, clinicSessionStateRef.current.started_at, clinicSessionStateRef.current.duration_ms);
          handleTimeUp(undefined, true);
        }
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

  useEffect(() => {
    if (!studentInfo.id) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await awardClinicMinutePoints(studentInfo.id);
        if (!cancelled) setPoints(res.balance);
      } catch (err) {
        console.error('포인트 적립 확인 중 오류:', err);
      }
    };
    tick();
    const iv = setInterval(tick, 65000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [studentInfo.id]);

  useEffect(() => {
    if (!studentInfo.id) return;
    let cancelled = false;
    const beat = async () => {
      const sid = clinicSessionStateRef.current?.id;
      if (!sid || cancelled) return;
      await supabaseClient.from('clinic_session_state').update({ last_seen_at: new Date().toISOString() }).eq('id', sid);
    };
    beat();
    const iv = setInterval(beat, 15000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [studentInfo.id]);

  useEffect(() => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise && optionsRef.current) {
      mj.typesetPromise([optionsRef.current]).catch((err: any) => console.error("MathJax 타이프셋 에러:", err));
    }
  }, [currentQIndex, questions[currentQIndex]?.options]);

  const hasActiveCallForGuard = Object.values(callState.current).some(v => v);
  const hasPendingRecheckForGuard = Object.values(recheckState.current).some(v => v === 'pending');
  const isNavigationBlocked = myAwayActive || hasActiveCallForGuard || hasPendingRecheckForGuard || awaitingReview;
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isNavigationBlocked) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isNavigationBlocked]);

  useEffect(() => {
    if (!isNavigationBlocked) return;
    const blockBack = () => {
      window.history.pushState(null, '', window.location.href);
      alert('자리비움/호출/재확인 처리 중에는 화면을 이동할 수 없습니다. 상태 해제 후 다시 시도해주세요.');
    };
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

  const ensurePenGraded = useCallback((idx: number): Promise<void> => {
    if (penGradeCache.current[idx] !== undefined) return Promise.resolve();
    if (penGradeInFlight.current[idx]) return penGradeInFlight.current[idx];
    const q = questions[idx];
    const isSubj = q && !(q.options && q.options.length > 0);
    const mode = answerModes.current[idx] || (studentDrawings.current[idx] ? 'pen' : 'keypad');
    const drawing = studentDrawings.current[idx];
    if (!q || !isSubj || mode !== 'pen' || !drawing) return Promise.resolve();
    const p = gradeHandwrittenAnswerWithGemini(drawing, q.answer, q.questionText)
      .then(meta => { penGradeCache.current[idx] = !!meta.is_correct; })
      .catch(() => {})
      .finally(() => { delete penGradeInFlight.current[idx]; });
    penGradeInFlight.current[idx] = p;
    return p;
  }, [questions]);

  const isQuestionCorrect = useCallback(async (idx: number): Promise<boolean> => {
    const q = questions[idx];
    if (!q) return false;
    const isSubj = !(q.options && q.options.length > 0);
    const mode = answerModes.current[idx] || (studentDrawings.current[idx] ? 'pen' : 'keypad');
    if (isSubj && mode === 'pen') {
      await ensurePenGraded(idx);
      return !!penGradeCache.current[idx];
    }
    return keypadAnswersMatch(studentAnswers.current[idx], q.answer);
  }, [questions, ensurePenGraded]);

  useEffect(() => {
    if (!isTimedRound || !isStarted) return;
    const leavingIdx = currentQIndex;
    return () => { ensurePenGraded(leavingIdx); };
  }, [currentQIndex, isTimedRound, isStarted, ensurePenGraded]);

  const handleTimeUp = async (forceAction?: string, sessionExpired = false) => {
    setTimeIsUp(true);
    const results = await Promise.all(questions.map((_, i) => isQuestionCorrect(i)));
    let corrects = 0;
    const incQIds: number[] = [];
    questions.forEach((q, i) => { if (results[i]) corrects++; else if (q.question_id) incQIds.push(q.question_id); });
    correctSolvedCountRef.current = corrects;

    if (incQIds.length > 0) await generateIncorrectPrint(incQIds, globalExamTitle);

    const wholeSessionEnd = sessionExpired || forceAction === 'force_checkout' || forceAction === 'force_checkout_by_ta';
    setLogoutTarget(wholeSessionEnd ? 'login' : 'portal');

    if (forceAction) {
      setSessionTimeUpModal(true);
    } else if (isTimedRound) {
      await saveExamResultsToDB();
      setSubmitResultModal(true);
    } else {
      setSessionTimeUpModal(true);
    }

    let sec = 10; setAutoLeaveSec(sec);
    const itv = setInterval(() => { sec--; setAutoLeaveSec(sec); if (sec <= 0) { clearInterval(itv); (wholeSessionEnd ? finalizeAndGoToLogin : leaveAndGoHome)(); } }, 1000);
  };

  const submitSingleAnswer = async () => {
    if (isSubmitting || timeIsUp || callState.current[currentQIndex] || recheckState.current[currentQIndex] === 'pending') return;
    const q = questions[currentQIndex];
    const isSubjective = !(q.options && q.options.length > 0);
    const useAI = isSubjective && (answerModes.current[currentQIndex] || (studentDrawings.current[currentQIndex] ? 'pen' : 'keypad')) === 'pen';
    const myAns = studentAnswers.current[currentQIndex];

    if (!myAns) { alert(useAI ? "답을 먼저 그려주세요!" : "정답을 먼저 입력해주세요!"); return; }

    setIsSubmitting(true);
    let isCorrect = false; let gradingMeta: any = null;

    if (useAI) {
      try {
        gradingMeta = await gradeHandwrittenAnswerWithGemini(myAns, q.answer, q.questionText);
        isCorrect = !!gradingMeta.is_correct;
      } catch (err: any) {
        setIsSubmitting(false);
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
      qBoxStatus.current[currentQIndex] = 'wrong_red';
      if (gotTaHint && q.record_id) await supabaseClient.from('student_incorrect_record').update({ status: 'TX' }).eq('record_id', q.record_id);
      if (!isTimedRound) await finalizeQuestionProgress(q, false, gotTaHint);
      setResultModal({ isCorrect: false, note: gotTaHint ? '조교 힌트를 받았지만 아직 오답이에요. (TX로 기록됨)' : null, canRecheck: useAI });
    }
    setIsSubmitting(false);
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
    const usedHint = hintState.current[idx] && (hintState.current[idx].level1 || hintState.current[idx].level2);
    const helped = taHintState.current[idx] || usedHint;
    const newStatus = helped ? 'TO' : 'O';
    const wasWrongBefore = qBoxStatus.current[idx] === 'wrong_red';

    if (q.record_id) {
      await supabaseClient.from('student_incorrect_record').update({ status: newStatus, resolved_at: new Date().toISOString() }).eq('record_id', q.record_id);
    } else {
      const filterCol = q.tq_id ? 'tq_id' : 'question_id';
      const filterVal = q.tq_id ?? q.question_id;
      if (filterVal) {
        await supabaseClient.from('student_incorrect_record').update({ status: newStatus, resolved_at: new Date().toISOString() }).eq('student_id', studentInfo.id).eq(filterCol, filterVal).is('resolved_at', null);
      }
    }
    if (!isTimedRound) await finalizeQuestionProgress(q, true, helped, wasWrongBefore);

    correctSolvedCountRef.current++;

    qBoxStatus.current[idx] = wasWrongBefore ? 'retry_yellow' : (helped ? 'correct_yellow' : 'correct_blue');

    const nextIdx = findNextUnresolvedIndex(idx);
    if (nextIdx === null) {
      enterAwaitingReview();
      saveRoundScoreToLocalStorage();
    } else {
      setCurrentQIndex(nextIdx);
      setTimeout(() => initCanvas(nextIdx), 100);
    }
    forceUpdate();
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
    setRecheckToast('🔄 조교에게 재확인을 요청했어요. 잠시만 기다려주세요.'); setTimeout(() => setRecheckToast(""), 4000);
    forceUpdate();
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
    } else if (!q.record_id && (q.tq_id || q.question_id)) {
      const filterCol = q.tq_id ? 'tq_id' : 'question_id';
      const filterVal = q.tq_id ?? q.question_id;
      const { data: existingRecord } = await supabaseClient.from('student_incorrect_record').select('record_id').eq('student_id', studentInfo.id).eq(filterCol, filterVal).is('resolved_at', null).maybeSingle();
      if (!existingRecord) {
        const { data: newRecord } = await supabaseClient.from('student_incorrect_record').insert(
          { student_id: studentInfo.id, tq_id: q.tq_id ?? null, question_id: q.question_id ?? null, source_type: '과제오답', status: helped ? 'TX' : 'X', resolved_at: null }
        ).select('record_id').single();
        if (newRecord) q.record_id = newRecord.record_id;
      } else {
        q.record_id = existingRecord.record_id;
      }
    }
  };

  const finalizeExamAssignmentProgress = async (q: any, isCorrect: boolean, helped: boolean = false, retried: boolean = false) => {
    if (!q.examAssignmentId) return;

    if (q.question_id) {
      const myAns = studentAnswers.current[currentQIndex] || '미입력';
      const studentInput = typeof myAns === 'string' && myAns.startsWith('data:image') ? '[손글씨 답안]' : myAns;
      const gradingCode = isCorrect ? (helped ? 'TO' : (retried ? 'RO' : 'O')) : (helped ? 'TX' : 'X');
      const { data: existingAns } = await supabaseClient.from('student_answer').select('answer_id').eq('exam_assignment_id', q.examAssignmentId).eq('student_id', studentInfo.id).eq('question_id', q.question_id).maybeSingle();
      const ansPayload = { exam_assignment_id: q.examAssignmentId, student_id: studentInfo.id, question_id: q.question_id, student_input: studentInput, is_correct: isCorrect, grading_code: gradingCode, grading_status: '대기' };
      if (existingAns) await supabaseClient.from('student_answer').update(ansPayload).eq('answer_id', existingAns.answer_id);
      else await supabaseClient.from('student_answer').insert(ansPayload);
    }

    if (!isCorrect) {
      if (!q.record_id && q.question_id) {
        const { data: existingRecord } = await supabaseClient.from('student_incorrect_record').select('record_id').eq('student_id', studentInfo.id).eq('question_id', q.question_id).is('resolved_at', null).maybeSingle();
        if (!existingRecord) {
          const { data: newRecord } = await supabaseClient.from('student_incorrect_record').insert(
            { student_id: studentInfo.id, question_id: q.question_id, source_type: '과제오답', status: helped ? 'TX' : 'X', resolved_at: null }
          ).select('record_id').single();
          if (newRecord) q.record_id = newRecord.record_id;
        } else {
          q.record_id = existingRecord.record_id;
        }
      }
      return;
    }
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

  const saveExamResultsToDB = async () => {
    if (!isTimedRound || !params.assignmentId) return;
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
    await supabaseClient.from('exam_assignment').update({ status: '제출완료', total_score: totalScore }).eq('assignment_id', params.assignmentId);
  };

  const generateIncorrectPrint = async (incQIds: number[], sourceTitle: string) => {
    const uIds = [...new Set(incQIds)];
    if (uIds.length === 0) return;

    const incUpserts = uIds.map(qid => ({ student_id: studentInfo.id, question_id: qid, source_type: '시험지', status: 'X', resolved_at: null }));
    const { error: incErr } = await supabaseClient.from('student_incorrect_record').upsert(incUpserts, { onConflict: 'student_id, question_id' });
    if (incErr) console.error('오답 기록 저장 실패:', incErr);

    try {
      const { data: cls } = await supabaseClient.from('enrollment').select('class(instructor_id)').eq('student_id', studentInfo.id).limit(1).maybeSingle();
      let instId = cls?.class?.instructor_id;
      if (!instId) { const { data: fb } = await supabaseClient.from('instructor').select('instructor_id').limit(1).maybeSingle(); instId = fb?.instructor_id; }
      if (!instId) { console.error('오답 프린트 생성 실패: 담당 강사를 찾을 수 없습니다.'); return; }

      const title = `[${studentInfo.name}] ${sourceTitle} 오답 프린트`;
      const { data: ex, error: exErr } = await supabaseClient.from('exam_master').insert({ title, exam_type: '오답프린트', instructor_id: instId, total_questions: uIds.length }).select().single();
      if (exErr || !ex) { console.error('오답 프린트 생성 실패:', exErr); return; }

      const items = uIds.map((qid, i) => ({ exam_id: ex.exam_id, question_id: qid, sort_order: i + 1, assigned_score: Math.round(100 / uIds.length) }));
      await supabaseClient.from('exam_item').insert(items);
      await supabaseClient.from('exam_assignment').insert({ exam_id: ex.exam_id, student_id: studentInfo.id, status: '미응시' });
    } catch(e) { console.error('오답 프린트 생성 중 오류:', e); }
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
      studentDrawings.current[idx] = canvas.toDataURL('image/png'); studentAnswers.current[idx] = studentDrawings.current[idx];
    };

    canvas.onpointerdown = startDraw; canvas.onpointermove = draw; canvas.onpointerup = stopDraw; canvas.onpointercancel = stopDraw;
  };

  const gradeHandwrittenAnswerWithGemini = async (dataUrl: string, correct: string, qText: string) => {
    const key = localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY);
    if (!key) throw new Error('API 키가 설정되지 않았습니다.');
    const model = localStorage.getItem(GEMINI_MODEL_STORAGE_KEY) || DEFAULT_GEMINI_MODEL;
    const base64 = dataUrl.split(',')[1];

    const prompt = `당신은 수학 채점자입니다. 이미지 속 손글씨 답안을 채점하세요.

문제: ${qText.replace(/<[^>]+>/g, '')}
정답(원문): "${correct}"

지침:
- 이미지의 옅은 회색 격자 배경은 무시하고, 학생이 손으로 쓴 잉크(펜) 자국만 답으로 읽으세요.
- 학생이 답을 지우거나 위에 덧쓴 경우, 최종적으로 남긴 것으로 보이는 답을 기준으로 판단하세요.
- 표기 형식이 정답과 다르더라도 수학적으로 동일하면 정답으로 처리하세요 (예: "4"와 "4.0", "1/2"와 "0.5", "-3"과 "－3").
- 글씨가 불명확해서 여러 숫자/기호로 읽힐 수 있으면, 가장 가능성 높은 해석을 recognized_text에 적고 confidence를 낮게 주세요.
- 반드시 아래 JSON 스키마의 필드명을 정확히 그대로 사용해 응답하세요.`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: base64 } }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              recognized_text: { type: 'STRING', description: '이미지에서 인식한 학생의 답' },
              is_correct: { type: 'BOOLEAN', description: '정답 여부' },
              confidence: { type: 'NUMBER', description: '인식 확신도 0~1' },
              explanation: { type: 'STRING', description: '판단 이유' }
            },
            required: ['recognized_text', 'is_correct', 'confidence', 'explanation']
          },
          temperature: 0
        }
      })
    });
    if (!res.ok) throw new Error('API 오류');
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  };

  const AI_HINT_MOCK: Record<1 | 2, string> = {
    1: '문제에서 주어진 조건을 다시 한 번 차근차근 읽고, 어떤 개념을 써야 할지 떠올려보세요.',
    2: '주어진 조건들을 식으로 정리한 뒤, 구하려는 값을 중심으로 순서를 세워 풀어보세요.'
  };
  const generateAiHint = async (qText: string, level: 1 | 2): Promise<string> => {
    const key = localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY);
    if (!key) return AI_HINT_MOCK[level];
    const model = localStorage.getItem(GEMINI_MODEL_STORAGE_KEY) || DEFAULT_GEMINI_MODEL;
    const levelInstruction = level === 1
      ? '정답을 직접 알려주지 말고, 이 문제를 풀기 위해 떠올려야 할 "핵심 개념"을 1~2문장으로 짧게 알려주세요.'
      : '정답을 직접 알려주지 말고, 이 문제를 어떤 순서/방법으로 접근하면 좋을지 구체적인 풀이 방향을 2~3문장으로 알려주세요.';
    const prompt = `당신은 초중고 수학 과외 선생님입니다. 아래 문제에 대한 단계별 힌트를 작성하세요.\n\n문제: ${qText.replace(/<[^>]+>/g, '')}\n\n${levelInstruction}\n정답이나 최종 계산 결과는 절대 언급하지 마세요.`;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4 } })
      });
      if (!res.ok) throw new Error('API 오류');
      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      return text || AI_HINT_MOCK[level];
    } catch (e) {
      return AI_HINT_MOCK[level];
    }
  };

  const pressKeypad = (key: string) => {
    let cur = keypadAnswers.current[currentQIndex] || '';
    if (key === 'back') cur = cur.slice(0, -1);
    else if (key === 'clear') cur = '';
    else if (key === ',') cur += ', ';
    else cur += key;
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

  const toggleEraser = () => {
    const next = !isEraserMode;
    setIsEraserMode(next);
    if (ctxRef.current) {
      ctxRef.current.globalCompositeOperation = next ? 'destination-out' : 'source-over';
      ctxRef.current.lineWidth = next ? currentPenWidth * ERASER_WIDTH_MULTIPLIER : currentPenWidth;
    }
  };

  const leaveAndGoHome = async () => {
    setIsLoggingOut(true);
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
    sendAction('depart');
    await untrackPresence();
    localStorage.removeItem('logica_student_id');
    localStorage.removeItem('logica_student_name');
    localStorage.removeItem('logica_student_phone');
    localStorage.removeItem('logica_tenant_id'); // 🌟 꼬리표 안전하게 초기화
    router.push('/student/login');
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
      {editorLocked && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[999] flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-sm">
            <div className="text-4xl mb-3">🔒</div>
            <h3 className="text-lg font-extrabold text-slate-800 mb-2">좌석 배치 수정 중입니다</h3>
            <p className="text-sm text-slate-500">관리자가 좌석 배치를 편집하는 동안에는<br />클리닉 기능이 잠시 멈춥니다. 잠시만 기다려주세요.</p>
          </div>
        </div>
      )}
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
          <PointBadge points={points} className="bg-yellow-50 border-yellow-200 text-yellow-700" />
          {params.round !== 1 && !awaitingReview && (<>
            <div className="w-px h-4 bg-slate-300"></div>
            <button onClick={requestLeaveToHome} className="text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors">나가기</button>
          </>)}
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-6 flex justify-center relative">
        {emptyState && (
          <div className="absolute inset-0 bg-slate-100 flex flex-col items-center justify-center z-50 animate-[fadeIn_0.3s_ease-out]">
            <span className="text-6xl mb-4">🎉</span><h2 className="text-2xl font-extrabold text-slate-700">{emptyState.title}</h2>
            <p className="text-slate-500 font-medium mt-2">
              {emptyState.awaited ? (awaitingReview ? '선생님이 결과를 확인하고 있어요. 잠시만 기다려주세요.' : '확인이 끝났어요! 홈으로 돌아가세요.') : emptyState.desc}
            </p>
            {isTimedRound && <p className="text-sm font-bold text-[#002864] bg-white border border-slate-200 rounded-full px-4 py-1.5 mt-4 shadow-sm">정답률 {correctSolvedCountRef.current}/{totalQuestionsInRoundRef.current}</p>}
            {awaitingReview ? (
              <div className="mt-6 flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-4 border-[#002864] border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs font-bold text-slate-400">확인이 끝나면 자동으로 넘어가요.</p>
              </div>
            ) : (
              <button onClick={leaveAndGoHome} className="mt-6 bg-[#002864] hover:bg-blue-900 text-white font-bold px-8 py-3 rounded-xl shadow-md transition-all">홈으로 돌아가기</button>
            )}
          </div>
        )}

        {q && !emptyState && (
          <div className="w-full max-w-7xl grid grid-cols-10 gap-6 h-full relative">
            <div className="col-span-6 bg-white rounded-2xl shadow-md flex flex-col overflow-hidden border border-slate-200 relative">
              <div className="flex items-center gap-2 p-6 border-b border-slate-100 bg-slate-50 shrink-0">
                <span className="text-3xl font-extrabold text-[#002864] w-14">{String(currentQIndex + 1).padStart(2, '0')}</span>
                <h2 className="text-sm font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1 rounded-full shadow-sm">원본: {q.source}</h2>
                {q.bookType && (
                  <span className={`text-xs font-black px-2.5 py-1 rounded-full border shadow-sm ${BOOK_TYPE_COLORS[q.bookType]?.pill || 'bg-slate-100 text-slate-600 border-slate-200'}`}>{q.bookType}</span>
                )}
                {isSubjective && curAnsMode === 'pen' && (
                  <span className="ml-auto shrink-0 bg-[#002864] text-white text-[11px] font-bold px-3 py-1.5 rounded-full shadow-sm">✍️ 여기에 풀이를 쓸 수 있어요</span>
                )}
              </div>

              <div className="flex-1 relative overflow-hidden">
                <div className={`h-full overflow-y-auto custom-scrollbar p-8 ${!isTimedRound ? 'pb-40' : ''}`}>
                  <div className="relative min-h-full">
                    <div className={`transition-opacity ${isSubjective && curAnsMode === 'pen' ? 'opacity-30' : ''}`}>
                      <QuestionDisplay html={q.questionText} imageUrl={q.imageUrl} />
                    </div>
                    {isSubjective && curAnsMode === 'pen' && (
                      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full cursor-crosshair touch-none"></canvas>
                    )}
                  </div>
                </div>
              </div>

              {isCall && <div className="bg-rose-50 border-t border-rose-100 px-5 py-2.5 text-center text-sm font-extrabold text-rose-600 shrink-0">🚨 {currentQIndex + 1}번 문제를 호출했습니다.</div>}
              {taHintState.current[currentQIndex] && <div className="bg-amber-50 border-t border-amber-100 px-5 py-2 text-center text-xs font-bold text-amber-600 shrink-0">🧑‍🏫 조교에게 힌트를 받았어요. 이어서 풀어 제출해보세요!</div>}

              {!isTimedRound && (
                <div className="absolute left-0 right-0 bottom-0 z-30 p-5 bg-blue-50/95 backdrop-blur-sm border-t border-blue-100 rounded-b-2xl shadow-[0_-8px_20px_-6px_rgba(15,23,42,0.18)]">
                  {q.hasHint !== false && (
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-sm font-bold text-blue-800 flex items-center gap-1">💡 AI 단계별 힌트</span>
                      {hintState.current[currentQIndex]?.revealed?.length > 0 && (
                        <button onClick={() => setHintPanelExpanded(!hintPanelExpanded)} className="flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-md bg-blue-100 text-blue-600 text-[11px] font-bold shrink-0">
                          {hintPanelExpanded ? '힌트 접기' : '힌트 펼치기'}
                          <span className={`text-[10px] transition-transform ${hintPanelExpanded ? 'rotate-180' : ''}`}>▲</span>
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {q.hasHint !== false && <>
                      <button onClick={() => { setHintModal({ level: 1, cost: 10 }); }} disabled={hintState.current[currentQIndex]?.level1} className={`flex-1 border text-sm font-bold py-3 rounded shadow-sm transition-colors ${hintState.current[currentQIndex]?.level1 ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-white border-blue-200 hover:bg-blue-100 text-blue-700'}`}>{hintState.current[currentQIndex]?.level1 ? "1단계 힌트 열람 완료" : "1단계 개념 힌트 (-10P)"}</button>
                      <button onClick={() => { setHintModal({ level: 2, cost: 30 }); }} disabled={!hintState.current[currentQIndex]?.level1 || hintState.current[currentQIndex]?.level2} className={`flex-1 border text-sm font-bold py-3 rounded shadow-sm transition-colors ${hintState.current[currentQIndex]?.level2 ? 'bg-slate-100 text-slate-400' : hintState.current[currentQIndex]?.level1 ? 'bg-white border-blue-200 hover:bg-blue-100 text-blue-700' : 'opacity-50 cursor-not-allowed bg-slate-100 text-slate-400'}`}>{hintState.current[currentQIndex]?.level2 ? "2단계 힌트 열람 완료" : "2단계 접근 방법 (-30P)"}</button>
                    </>}
                    <button onClick={() => { const next = !myAwayActive; setMyAwayActive(next); sendAction(next ? 'away' : 'cancel_away'); const sid = clinicSessionStateRef.current?.id; if (sid) (next ? setAway : clearAway)(supabaseClient, sid); }} disabled={!myAwayActive && Object.values(callState.current).some(v=>v)} className={`shrink-0 border text-sm font-bold py-3 px-4 rounded shadow-sm transition-colors ${myAwayActive ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-300 hover:bg-slate-100 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed'}`}>{myAwayActive ? '↩️ 자리 복귀' : '🚶 자리비움'}</button>
                  </div>
                  {q.hasHint !== false && hintState.current[currentQIndex]?.revealed?.length > 0 && (
                    <div className={`overflow-hidden transition-all duration-300 ${hintPanelExpanded ? 'max-h-[260px] opacity-100' : 'max-h-0 opacity-0'}`}>
                      <HintRevealBox revealed={hintState.current[currentQIndex].revealed} />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="col-span-4 flex flex-col gap-4 min-h-0 overflow-y-auto custom-scrollbar">
              <div className="bg-white rounded-2xl shadow-md p-6 border border-slate-200 shrink-0 relative">
                {availableBooks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-4 pb-4 border-b border-slate-100">
                    <button onClick={() => switchBookFilter('all')} className={`text-xs font-black px-2.5 py-1.5 rounded-full border shadow-sm transition-colors ${bookFilter === 'all' ? 'bg-[#002864] border-[#002864] text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                      전체 <span className="font-normal opacity-80">{questions.length}</span>
                    </button>
                    {availableBooks.map(b => (
                      <button key={b.bookType} onClick={() => switchBookFilter(b.bookType as string)} className={`text-xs font-black px-2.5 py-1.5 rounded-full border shadow-sm transition-colors ${bookFilter === b.bookType ? `${BOOK_TYPE_COLORS[b.bookType || '']?.pill || 'bg-slate-800 text-white border-slate-800'} ring-2 ring-offset-1 ring-[#002864]/30` : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                        {b.bookType} <span className="font-normal opacity-80">{b.count}</span>
                      </button>
                    ))}
                  </div>
                )}
                <h3 className="font-bold text-slate-700 mb-4 text-center text-sm">
                  문항 이동{' '}
                  <span className="text-slate-400 font-normal">
                    {bookFilter === 'all' ? `(총 ${questions.length}문항)` : `(${visibleIndices.length}문항 · 전체 ${questions.length}문항 중)`}
                  </span>
                </h3>
                <div className="flex items-center gap-2">
                  <button onClick={() => questionNavScrollRef.current?.scrollBy({ left: -170, behavior: 'smooth' })} className="shrink-0 w-8 h-16 rounded-lg bg-slate-100 text-slate-500 font-bold text-xl flex items-center justify-center hover:bg-slate-200">‹</button>
                  <div ref={questionNavScrollRef} className="flex flex-nowrap gap-3 overflow-x-auto custom-scrollbar pb-1 scroll-smooth">
                    {visibleIndices.map(i => {
                      const status = qBoxStatus.current[i];
                      const symbol = status === 'wrong_red' ? 'X' : status === 'retry_yellow' ? '△' : status ? 'O' : null;
                      const statusPalette: Record<string, { light: string; solid: string }> = {
                        wrong_red: { light: 'bg-rose-50 border-rose-300 text-rose-500', solid: 'bg-rose-600 border-rose-600 text-white' },
                        correct_blue: { light: 'bg-blue-50 border-blue-300 text-blue-500', solid: 'bg-blue-600 border-blue-600 text-white' },
                        correct_yellow: { light: 'bg-amber-50 border-amber-300 text-amber-500', solid: 'bg-amber-500 border-amber-500 text-white' },
                        retry_yellow: { light: 'bg-amber-50 border-amber-300 text-amber-500', solid: 'bg-amber-500 border-amber-500 text-white' },
                      };
                      const isCalled = !!callState.current[i];
                      const isCurrent = i === currentQIndex;
                      const cls = isCalled
                        ? (isCurrent ? 'bg-red-600 border-red-600 text-white' : 'bg-red-100 border-red-300 text-red-700')
                        : isCurrent
                          ? (status ? `${statusPalette[status].solid} ring-2 ring-offset-2 ring-[#002864]/50` : 'bg-[#002864] border-[#002864] text-white')
                          : (status ? statusPalette[status].light : 'border-slate-200 text-slate-500 hover:bg-slate-50');
                      return (
                        <button key={i} onClick={() => { setCurrentQIndex(i); setTimeout(() => initCanvas(i), 50); forceUpdate(); }} className={`relative w-16 h-16 shrink-0 border-2 rounded-lg font-extrabold text-2xl shadow-sm transition-colors flex items-center justify-center ${cls}`}>
                          {!isCalled && symbol ? symbol : i + 1}
                          {!isCalled && symbol && <span className={`absolute -bottom-1 -right-1 rounded px-0.5 text-[9px] font-bold leading-none ${isCurrent ? 'bg-white/90 text-slate-700' : 'bg-white/80 text-slate-500 opacity-80'}`}>{i + 1}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => questionNavScrollRef.current?.scrollBy({ left: 170, behavior: 'smooth' })} className="shrink-0 w-8 h-16 rounded-lg bg-slate-100 text-slate-500 font-bold text-xl flex items-center justify-center hover:bg-slate-200">›</button>
                </div>
                {params.round === 1 && (
                  <button onClick={() => setSubmitConfirmModal(true)} disabled={timeIsUp} className="w-full mt-4 bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 rounded-lg shadow-sm transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                    📮 전체 제출하기
                  </button>
                )}
              </div>

              <div className="bg-white rounded-2xl shadow-md p-4 flex-1 flex flex-col border border-slate-200 relative overflow-hidden">
                {(isCall || isRecheck) && <div className="absolute inset-0 z-20 bg-white/50 flex flex-col items-center pt-2 backdrop-blur-[1px]"><div className={`border text-xs font-bold rounded-lg p-3 text-center w-[90%] shadow-sm ${isCall ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-indigo-50 border-indigo-200 text-indigo-600'}`}>{isCall ? <>🙋 호출 중에는 정답을 입력할 수 없어요<br/>조교가 올 때까지 잠시 기다려주세요.</> : <>🕐 조교에게 재확인을 요청했어요<br/>확인이 끝날 때까지 잠시만 기다려주세요.</>}</div></div>}

                <h3 className="font-bold text-slate-700 mb-2 text-center text-sm"><span className="text-[#002864] text-lg font-black mr-1">{currentQIndex + 1}</span>번 정답 입력</h3>
                <div ref={optionsRef} className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto">
                  {q.options && q.options.length > 0 ? (
                    q.options.map((opt: string, oIdx: number) => (
                      <label key={oIdx} className={`w-full px-4 py-3 border-2 rounded-lg text-left font-bold cursor-pointer transition-colors flex gap-3 shadow-sm items-center ${studentAnswers.current[currentQIndex] === String(oIdx + 1) ? 'bg-[#002864] border-[#002864] text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                        <input type="radio" name="omr" className="hidden" checked={studentAnswers.current[currentQIndex] === String(oIdx + 1)} onChange={() => { studentAnswers.current[currentQIndex] = String(oIdx + 1); forceUpdate(); }} />
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${studentAnswers.current[currentQIndex] === String(oIdx + 1) ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{oIdx + 1}</span>
                        <span className="font-myungjo" dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(opt) }} />
                      </label>
                    ))
                  ) : curAnsMode === 'pen' ? (
                    <div className="w-full h-full flex flex-col gap-4 items-center justify-center">
                      <p className="text-xs font-bold text-slate-400 text-center">✍️ 왼쪽 문제 위에 풀이 과정과 정답을 바로 그려주세요</p>
                      <div className="w-full flex flex-col gap-3">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => { const w = Math.max(1, currentPenWidth - 1); setCurrentPenWidth(w); if(ctxRef.current) ctxRef.current.lineWidth = isEraserMode ? w * ERASER_WIDTH_MULTIPLIER : w; }} className="w-9 h-9 rounded-lg bg-slate-100 text-slate-500 font-bold text-lg">−</button>
                          <span className="text-xs font-bold text-slate-500 w-6 text-center">{currentPenWidth}</span>
                          <button onClick={() => { const w = Math.min(10, currentPenWidth + 1); setCurrentPenWidth(w); if(ctxRef.current) ctxRef.current.lineWidth = isEraserMode ? w * ERASER_WIDTH_MULTIPLIER : w; }} className="w-9 h-9 rounded-lg bg-slate-100 text-slate-500 font-bold text-lg">+</button>
                        </div>
                        <div className={`flex items-center justify-center gap-2 transition-opacity ${isEraserMode ? 'opacity-30 pointer-events-none' : ''}`}>
                          {PEN_COLORS.map(color => (
                            <button key={color} onClick={() => { setCurrentPenColor(color); if(ctxRef.current) ctxRef.current.strokeStyle = color; }} className={`w-7 h-7 rounded-full border-2 transition-transform ${currentPenColor === color ? 'border-[#002864] scale-110' : 'border-white'} shadow-sm`} style={{ backgroundColor: color }}></button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={toggleEraser} className={`flex-1 text-sm font-bold py-2.5 rounded-lg ${isEraserMode ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'}`}>🧽 {isEraserMode ? '지우개 사용 중' : '지우개'}</button>
                          <button onClick={() => { delete studentDrawings.current[currentQIndex]; studentAnswers.current[currentQIndex] = null; if(canvasRef.current && ctxRef.current) { const c = canvasRef.current; const dpr = window.devicePixelRatio || 1; ctxRef.current.clearRect(0,0,c.width,c.height); drawWritableHint(ctxRef.current, c.width / dpr, c.height / dpr); } }} className="flex-1 text-sm font-bold text-rose-500 bg-rose-50 py-2.5 rounded-lg">🗑️ 전체 지우기</button>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setGeminiModalOpen(true)} className="shrink-0 w-9 h-9 rounded-lg bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center">⚙️</button>
                          <button onClick={toggleAnswerMode} className="flex-1 text-sm font-bold text-[#002864] bg-blue-50 py-2.5 rounded-lg">🔢 키패드로 전환</button>
                        </div>
                      </div>
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
                      <div className={`overflow-hidden transition-all duration-300 ${keypadCollapsed ? 'max-h-0 opacity-0' : 'max-h-[260px] opacity-100'}`}>
                        <div className="grid grid-cols-4 gap-1.5 pt-1">
                          {['7','8','9','back','4','5','6','clear','1','2','3','-','0','.','/'].map(k => (
                            <button key={k} onClick={() => pressKeypad(k)} className={`py-2.5 rounded-lg font-bold ${k==='back' ? 'bg-slate-100 text-slate-500 text-sm' : k==='clear' ? 'bg-rose-50 text-rose-500 text-sm' : k==='0' ? 'col-span-2 bg-slate-50 text-slate-700 text-lg' : k==='-' || k==='.' || k==='/' ? 'bg-slate-100 text-slate-500 text-base' : 'bg-slate-50 text-slate-700 text-lg'}`}>{k === 'back' ? '⌫' : k === 'clear' ? 'C' : k === '/' ? '분수 /' : k}</button>
                          ))}
                          <button onClick={() => pressKeypad(',')} className="col-span-4 py-1.5 rounded-lg font-bold bg-slate-100 text-slate-500 text-xs">쉼표 추가 ( , )</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {!isTimedRound && (
                <div className="flex flex-col gap-3 mt-auto shrink-0">
                  <div className="flex gap-3 w-full">
                    <button onClick={submitSingleAnswer} disabled={timeIsUp || isCall || isRecheck || isSubmitting} className="w-2/3 bg-[#002864] hover:bg-blue-900 text-white font-extrabold text-lg py-5 rounded-xl shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      {isSubmitting ? '채점 중...' : '✅ 정답 입력'}
                    </button>
                    <button onClick={() => { if(!callState.current[currentQIndex] && myAwayActive){ alert('자리비움 중에는 호출 불가합니다.'); return;} const willCall = !callState.current[currentQIndex]; callState.current[currentQIndex] = willCall; forceUpdate(); const callPayload = { qNum: currentQIndex + 1, questionText: q.questionText, imageUrl: q.imageUrl, options: q.options, answer: q.answer, explanation: q.explanation, source: q.source }; sendAction(willCall ? 'call' : 'cancel_call', willCall ? callPayload : { qNum: currentQIndex + 1 }); const sid = clinicSessionStateRef.current?.id; if (sid) (willCall ? setActiveCall(supabaseClient, sid, currentQIndex + 1, callPayload) : clearActiveCall(supabaseClient, sid, currentQIndex + 1)); }} disabled={timeIsUp || (!callState.current[currentQIndex] && myAwayActive) || isRecheck} className={`w-1/3 font-extrabold text-lg py-5 rounded-xl shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isCall ? 'bg-rose-700 text-white' : 'bg-rose-500 text-white hover:bg-rose-600'}`}>{isCall ? '🚨 호출 취소' : '🙋 호출'}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* 모달 */}
      {hintModal && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-[320px] text-center">
            <div className="text-4xl mb-3">🪙</div><h3 className="text-lg font-extrabold text-slate-800 mb-2">포인트 차감 안내</h3>
            <p className="text-sm text-slate-600 mb-6 font-medium leading-relaxed">{hintModal.level}단계 힌트를 열람하시겠습니까?<br/>보유 포인트에서 <span className="font-bold text-rose-500">{hintModal.cost}P</span>가 차감됩니다.</p>
            <div className="flex gap-2">
              <button disabled={hintModal.loading} onClick={() => setHintModal(null)} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-40">취소</button>
              <button disabled={hintModal.loading} onClick={async () => {
                if (hintRequestInFlightRef.current) return;
                hintRequestInFlightRef.current = true;
                try {
                  const level = hintModal.level as 1 | 2; const cost = hintModal.cost;
                  const key = `level${level}` as 'level1' | 'level2';
                  if (hintState.current[currentQIndex]?.[key]) { setHintModal(null); return; }
                  setHintModal((prev: any) => prev && { ...prev, loading: true });
                  let hintText = q.hints[level - 1];
                  if (q.needsAiHint) {
                    hintText = await generateAiHint(q.questionText, level);
                  }
                  const res = await spendPoints(studentInfo.id, cost);
                  if (!res.success) { setHintModal(null); alert(res.message || '포인트가 부족합니다.'); return; }
                  setPoints(res.balance);
                  const hq = hintState.current[currentQIndex] || { level1: false, level2: false, revealed: [] };
                  hq[key] = true; hq.revealed = [...hq.revealed, { level, text: hintText }];
                  hintState.current[currentQIndex] = hq; saveHintState(studentInfo.id, q, hq);
                  setHintPanelExpanded(true);
                  sendAction('hint', { qNum: currentQIndex + 1, level });
                  setHintModal(null); forceUpdate();
                } finally {
                  hintRequestInFlightRef.current = false;
                }
              }} className="flex-1 bg-[#002864] text-white font-bold py-3 rounded-lg hover:bg-blue-900 transition-colors disabled:opacity-60">{hintModal.loading ? '힌트 생성 중...' : '열람하기'}</button>
            </div>
          </div>
        </div>
      )}

      {resultModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center transform transition-transform scale-100 animate-[fadeIn_0.2s_ease-out]">
            <div className="text-6xl mb-4">{resultModal.isCorrect ? "🎉" : "💥"}</div>
            <h3 className={`text-2xl font-black mb-2 ${resultModal.isCorrect ? 'text-emerald-600' : 'text-rose-600'}`}>{resultModal.isCorrect ? "정답입니다!" : "아쉽게 틀렸습니다"}</h3>
            <p className="text-sm text-slate-500 font-bold mb-8 leading-relaxed">{resultModal.isCorrect ? (resultModal.note ? `완벽히 복습되었습니다. ${resultModal.note}` : "완벽히 복습되었습니다. 오답 노트에서 제외됩니다.") : (resultModal.note || "다시 한번 풀어보거나, 힌트를 열람해보세요.")}</p>
            <button onClick={() => {
              if (!resultModal.isCorrect) { studentAnswers.current[currentQIndex]=null; delete studentDrawings.current[currentQIndex]; delete keypadAnswers.current[currentQIndex]; forceUpdate(); setTimeout(()=>initCanvas(currentQIndex),50); }
              setResultModal(null);
            }} className={`w-full font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all ${resultModal.isCorrect ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-800 hover:bg-slate-900 text-white'}`}>
              {resultModal.isCorrect ? "확인 및 다음 문제" : "다시 풀기"}
            </button>
            {resultModal.canRecheck && <button onClick={() => { requestRecheck(); setResultModal(null); }} className="w-full mt-2.5 bg-white border-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-bold px-6 py-3 rounded-xl text-sm transition-all">🔄 AI 채점이 이상해요 — 조교에게 재확인 요청</button>}
          </div>
        </div>
      )}

      {sessionTimeUpModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[80] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center">
            <div className="text-6xl mb-4">⏰</div><h3 className="text-2xl font-black text-slate-800 mb-2">클리닉 시간이 종료되었습니다</h3>
            <p className="text-sm text-slate-500 font-bold mb-6">오늘 배정된 클리닉 이용 시간이 모두 지났어요.<br/>수고하셨습니다!</p>
            <button onClick={logoutTarget === 'login' ? finalizeAndGoToLogin : leaveAndGoHome} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all">홈으로 돌아가기</button>
            <p className="text-xs font-bold text-slate-400 mt-4"><span>{autoLeaveSec}</span>초 후 자동으로 나가집니다...</p>
          </div>
        </div>
      )}

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

      {submitResultModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[60] animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center">
            <div className="text-6xl mb-4">📮</div><h3 className="text-2xl font-black text-slate-800 mb-2">제출 완료!</h3>
            <p className="text-sm text-slate-500 font-bold mb-4">답안을 제출했어요. 수고했어요!</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl py-3 mb-6"><p className="text-xs font-bold text-slate-400 mb-1">정답률</p><p className="text-2xl font-black text-[#002864]">{correctSolvedCountRef.current}/{totalQuestionsInRoundRef.current}</p></div>
            <button onClick={logoutTarget === 'login' ? finalizeAndGoToLogin : leaveAndGoHome} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all">홈으로 돌아가기</button>
            <p className="text-xs font-bold text-slate-400 mt-4"><span>{autoLeaveSec}</span>초 후 자동으로 나가집니다...</p>
          </div>
        </div>
      )}

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

      {recheckToast && <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[80] bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-2xl max-w-md text-center animate-[fadeIn_0.3s_ease-out]">{recheckToast}</div>}
    </div>
  );
}