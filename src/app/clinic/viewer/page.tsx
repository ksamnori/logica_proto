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

// ==========================================
// 상수 및 환경 설정
// ==========================================
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const getSupabaseClient = () => {
    if (typeof window === 'undefined') return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (!(window as any)._supabaseInstance) (window as any)._supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return (window as any)._supabaseInstance;
};
const supabaseClient = getSupabaseClient();
// 💡 자정 이후(00시~09시 KST)에는 UTC 날짜와 KST 날짜가 어긋나 세션이 "다른 날"로 기록되는 버그가 있었음 — 항상 KST 기준으로 통일
const getKSTDateString = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

const CLINIC_ROOM = "logica-clinic-room";
const ROUND1_TIME_LIMIT_SECONDS = 20 * 60;

const GEMINI_API_KEY_STORAGE_KEY = 'logica_gemini_api_key';
const GEMINI_MODEL_STORAGE_KEY = 'logica_gemini_model';
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const PEN_COLORS = ['#1C2530', '#DC2626', '#2563EB', '#16A34A'];
const ERASER_WIDTH_MULTIPLIER = 6;

// ==========================================
// 유틸리티
// ==========================================
const formatMathTextForWeb = (text: string) => {
  if (!text) return "";
  // 💡 <br> 태그는 실제 줄바꿈으로 남아야 하므로, </> 이스케이프보다 먼저 placeholder로 빼뒀다가 되돌린다.
  // (순서가 바뀌면 <br>이 &lt;br&gt;로 이스케이프되어 화면에 글자 그대로 노출되고, 아래 콤마 정리 규칙도 항상 무효가 된다.)
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

// 💡 힌트 열람 상태(hintState)는 React ref라 컴포넌트가 다시 마운트되면(새로고침, 재입장) 사라진다.
// 문항 자체는 question_id/tq_id로 안정적으로 식별 가능하므로, localStorage에 학생별·문항별로
// 열람 여부를 남겨뒀다가 문항을 불러올 때마다 복원한다 — 안 그러면 같은 힌트를 다시 눌러
// 포인트가 또 차감되는 문제가 생긴다.
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

// 💡 힌트가 없는 건 "교재 문제 전체"가 아니라 주교재/부교재뿐이다 — 워크북(과 연산교재)은
// textbook_question에 큐레이션된 힌트 컬럼이 없을 뿐, AI가 그 자리에서 생성해 보여준다.
const NO_HINT_BOOK_TYPES = ['주교재', '부교재'];
const textbookHintFields = (bookType: string | null | undefined) => {
  if (bookType && NO_HINT_BOOK_TYPES.includes(bookType)) {
    return { hasHint: false, needsAiHint: false, hints: ['교재 문제라 힌트가 없습니다.', '교재 문제라 힌트가 없습니다.'] };
  }
  return { hasHint: true, needsAiHint: true, hints: ['', ''] };
};

// 💡 옛날 순수 HTML 버전은 innerHTML을 직접 조작하는 명령형 코드라, 문제를 바꿀 때만 DOM이 갱신되고
// 그 외(호출/자리비움 등 실시간 브로드캐스트로 인한 화면 갱신)에는 애초에 이 부분이 다시 그려지지 않았다.
// React에서 같은 안정성을 얻으려면 "리렌더될 때마다 재타이프셋"(→ 매번 원본 텍스트로 잠깐 되돌아갔다가
// 다시 그려지는 깜빡임 발생)이 아니라, "이 내용이 실제로 바뀔 때만 리렌더되도록" 컴포넌트를 분리해야 한다.
// React.memo로 감싸서 questionText/imageUrl이 바뀔 때만(=문항이 실제로 바뀔 때만) DOM이 갱신되게 하고,
// 그 순간에만 MathJax를 다시 타이프셋한다 — 그 사이 부모가 아무리 자주 리렌더돼도 이 DOM은 그대로 유지된다.
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

// 힌트 열람 텍스트도 같은 이유로 분리 — hintState.current는 ref라서 자체적으론 리렌더를 유발하지 않지만,
// forceUpdate()로 부모가 리렌더될 때 이 블록도 매번 다시 그려지고 있었다. revealed 배열 자체가 바뀔 때만 갱신되게 한다.
// 💡 예전엔 revealed 배열(레벨1, 레벨2 ...)을 map으로 전부 한 번에 렌더링해서, 학생이 두 단계를
// 모두 열람하면 두 힌트가 동시에 쭉 쌓여 보이는("힌트 여러 개 나오는 현상") 문제가 있었다.
// 탭으로 전환해서 한 번에 한 레벨만 보이게 하고, 새 레벨을 열람하면 그 탭으로 자동 전환한다.
const HintRevealBox = React.memo(function HintRevealBox({ revealed }: { revealed: { level: number; text: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(revealed.length - 1);
  const prevLenRef = useRef(revealed.length);
  useEffect(() => {
    // 새 힌트가 추가된 경우에만 최신 탭으로 자동 전환하고, 그 외(같은 배열 재참조 등)엔 사용자가
    // 보고 있던 탭을 유지한다.
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

  // === UI & 라우팅 파라미터 상태 ===
  const [isStarted, setIsStarted] = useState(false);
  const [studentInfo, setStudentInfo] = useState({ id: '', name: '학생', classes: [] as string[] });
  const [params, setParams] = useState({ round: 0, className: '', weekType: 'odd', assignmentId: '', homeworkIdsStr: '' });
  const [isTimedRound, setIsTimedRound] = useState(false);
  const [globalExamTitle, setGlobalExamTitle] = useState('과제');

  // === 포인트 (클리닉 이용 1분당 1P 적립) ===
  // 💡 0으로 초기화하면 첫 조회 결과가 반영되는 순간 PointBadge가 "0 → 실제잔액"을 진짜 적립으로
  // 착각해 화면에 들어올 때마다 튀어오르는 애니메이션이 뜬다. null(아직 모름)로 시작한다.
  const [points, setPoints] = useState<number | null>(null);

  // === 타이머 상태 ===
  const [clinicRemainingStr, setClinicRemainingStr] = useState("60:00");
  const [isClinicUrgent, setIsClinicUrgent] = useState(false);
  const [roundRemainingSec, setRoundRemainingSec] = useState(ROUND1_TIME_LIMIT_SECONDS);
  const [timeIsUp, setTimeIsUp] = useState(false);

  // === 문항 및 답안 상태 ===
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [pendingQCount, setPendingQCount] = useState<string>("로딩 중...");
  // 💡 [7번] 정규과제/미완성과제 문제가 여러 교재(주교재/부교재/워크북/기타 등)에 걸쳐 있을 때,
  // 풀이 화면 안에서 상단 탭으로 교재를 골라 "문항 이동" 그리드를 필터링한다. 'all'이면 전부
  // 보여준다. 예전엔 bookId(교재 개별 ID)로 나눴는데, 같은 종류(예: 주교재)라도 배정마다 서로
  // 다른 bookId를 쓰면 "주교재" 탭이 여러 개로 쪼개져 보이거나, 학생이 원래 기대하던
  // 주교재/부교재/워크북/기타 네 종류 구분이 사라진 것처럼 보였다. bookType(교재 종류) 기준으로
  // 묶어서 항상 그 네 종류 그대로 탭이 나오게 한다.
  const [bookFilter, setBookFilter] = useState<string | 'all'>('all');

  // 💡 채점/완료로 문항이 배열에서 빠지며 currentQIndex가 다른 교재의 문제로 넘어갈 수 있다 —
  // 탭이 가리키는 교재와 실제 보이는 문항이 항상 일치하도록, 어긋나면 '전체' 탭으로 되돌린다.
  useEffect(() => {
    if (bookFilter === 'all') return;
    const cur = questions[currentQIndex];
    if (!cur || cur.bookType !== bookFilter) setBookFilter('all');
  }, [currentQIndex, questions, bookFilter]);

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
  // 💡 round!==1(오답클리닉/과제)에서는 정답을 맞혀도 문항 박스가 목록에서 사라지지 않고, 대신
  // 이 상태로 색이 바뀐다. wrong_red를 거친 뒤 correct가 되면(재도전) retry_yellow(세모)로,
  // 조교 도움(호출/힌트)을 받아 처음부터 맞히면 correct_yellow(O, 노랑), 도움 없이 한 번에
  // 맞히면 correct_blue(O, 파랑)로 기록한다.
  const qBoxStatus = useRef<Record<number, 'correct_blue' | 'correct_yellow' | 'retry_yellow' | 'wrong_red'>>({});
  // 💡 [10번] 라운드1(시험)은 문항마다 "정답 입력" 버튼/즉시채점이 아예 없다(그 버튼은
  // !isTimedRound일 때만 렌더링됨) — 손글씨 답안은 시간 종료 시점에 한꺼번에 keypadAnswersMatch로
  // 채점됐는데, 이 함수는 손글씨(캔버스 데이터URL)를 전혀 못 읽어서 항상 오답으로 잡혔다.
  // 문항을 벗어날 때(다음 문항으로 이동할 때)마다 그 문항의 손글씨를 미리 AI로 채점해 여기 캐시해두면,
  // 시간이 다 됐을 때는 대부분 이미 채점이 끝나 있어 정답 개수가 즉시 나온다.
  const penGradeCache = useRef<Record<number, boolean>>({});
  const penGradeInFlight = useRef<Record<number, Promise<void> | undefined>>({});
  // 💡 hintModal.loading(state)만으로 중복 클릭을 막으면, 리렌더가 아직 커밋되기 전(같은 틱 안)에
  // 두 번째 클릭 핸들러가 여전히 loading:false인 옛 클로저를 읽을 수 있다 — ref는 즉시(동기) 갱신되므로
  // 리렌더 타이밍과 무관하게 확실히 재진입을 막는다.
  const hintRequestInFlightRef = useRef(false);
  const [currentPenWidth, setCurrentPenWidth] = useState(3);
  const [currentPenColor, setCurrentPenColor] = useState(PEN_COLORS[0]);
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [keypadCollapsed, setKeypadCollapsed] = useState(false);
  const [hintPanelExpanded, setHintPanelExpanded] = useState(true);
  const [myAwayActive, setMyAwayActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  // 💡 [8번: 완료 후 동결] round!==1에서 마지막 오답까지 다 풀면(emptyState 진입) 바로 "홈으로
  // 돌아가기"를 보여주지 않고, 슈퍼바이저가 오답 프린트를 검토/생성(또는 명시적으로 내보내기)할
  // 때까지 학생 화면을 붙잡아 둔다. 슈퍼바이저 쪽 release_to_portal 브로드캐스트를 받거나,
  // (연결이 끊겼다 다시 붙는 경우를 대비해) 이 학생 앞으로 새로 생성된 '오답프린트' 배정을
  // 주기적으로 폴링해 발견하면 풀어준다 — 둘 중 아무거나 먼저 오면 동결 해제.
  const [awaitingReview, setAwaitingReview] = useState(false);
  const awaitingReviewSinceRef = useRef<string | null>(null);
  const [autoLeaveSec, setAutoLeaveSec] = useState(10);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutTarget, setLogoutTarget] = useState<'portal' | 'login'>('portal');
  const [sessionInfo, setSessionInfo] = useState<any>(null);

  // === 캔버스 및 기타 Ref ===
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
  // 💡 round=2에 병합된 exam_type='과제'/'과제프린트' 문항의 assignment_id별 남은 문항 수.
  // 전부 정답으로 풀리면(0이 되면) 그 exam_assignment를 완료 처리한다.
  const examAssignmentTotalsRef = useRef<Record<string, number>>({});

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
      // 💡 클리닉 시작 버튼 클릭 직후에는 이 스크립트가 아직 로드 중일 수 있어, 최초 typesetPromise() 호출이
      // 조용히 무시되곤 했다(마운트 시점에는 typesetPromise가 아직 없으므로). 로드 완료 시 한 번 더 타이프셋한다.
      script.onload = () => { (window as any).MathJax?.typesetPromise?.().catch((err: any) => console.error("MathJax 타이프셋 에러:", err)); };
      document.head.appendChild(script);
    }
  };

  // ==========================================
  // 2. 세션 타이머 및 데이터 로딩
  // ==========================================
  const initSessionAndFetch = async (sId: string, round: number, cls: string, week: string, assignId: string, hwIds: string) => {
    const today = getKSTDateString();
    const sessionData = await resolveTodaySession(supabaseClient, sId, today);
    clinicSessionStateRef.current = sessionData;
    setSessionInfo(sessionData);

    await connectChannel(sId, sessionData);
    // 💡 좌석 배정을 presence sync 이벤트에만 맡기면, 실시간 연결이 막히거나 늦을 때 세션은 생겨도
    // 좌석은 영원히 null로 남아 조교 화면에서 학생이 보이지 않게 된다. DB 조회로 직접(REST) 배정한다.
    assignSeatDirectly(sId, sessionData);

    const { data: eData } = await supabaseClient.from('enrollment').select('class(name)').eq('student_id', sId);
    if (eData) {
      const cNames = Array.from(new Set(eData.map((e:any) => e.class?.name).filter(Boolean))) as string[];
      setStudentInfo(prev => ({ ...prev, classes: cNames.length ? cNames : [cls] }));
    }

    if (round === 1 || round === 4) await fetchWeeklyTest(sId, week, cls, assignId);
    // 💡 round===3(오답프린트 라운드)도 exam_assignment 기반 배정을 읽어야 한다 — 예전엔 여기서
    // assignId를 무조건 버려서, "편집 후 만들기"로 만든 오답프린트가 실제로 생성돼도 학생이
    // 라운드3에 들어오면 항상 "풀 문제가 없습니다"만 보였다(exam_assignment을 절대 조회 안 했으므로).
    else if (round === 2 || round === 3) await fetchHomework(sId, hwIds, assignId);
    else await fetchIncorrect(sId);
  };

  // 💡 '과제오답유사' 라운드: 정식 출제(exam_master) 없이, 과제 채점 중 틀린 문항이 쌓이는
  // student_incorrect_record(source_type='과제오답')를 그대로 문제 세트로 사용한다.
  const fetchHomeworkSimilarIncorrect = async (sId: string) => {
    try {
      // 💡 과제 오답은 두 출처가 섞여 쌓인다: 문제은행(exam) 문항은 question_id→question_db,
      // 교재(주교재/워크북) 문항은 tq_id→textbook_question. 두 테이블 사이에 FK가 없어 embed가
      // 안 되므로, record를 먼저 가져온 뒤 tq_id/question_id를 모아 따로 조회해 JS에서 합친다.
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
        // 💡 round=1은 실제 주간테스트 전용이다 — assignment_id가 가리키는 exam_master가
        // exam_type='주간테스트'가 아니면(예: '과제'/'과제프린트') 절대 여기서 불러오면 안 된다.
        // 라벨을 실제 타입으로 고쳐 보여주는 건 미봉책이었고, 애초에 이 라운드가 다른 종류를
        // 끌어오는 것 자체가 문제였다.
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

  // 💡 exam_type='과제'/'과제프린트'로 강사가 개별 배정한 exam_assignment 문항을, tq_id 기반
  // 정규과제와 별도 라운드로 보내지 않고 이 함수(round=2) 안에서 같은 큐에 병합한다. 새로 만들지 않고
  // 기존 정규과제 흐름(타이머 없음, 문항별 즉시 채점, 오답은 큐에 남아 다시 풀 때까지 반복) 그대로 재사용한다.
  const fetchAssignedExamQuestions = async (assignId: string) => {
    if (!assignId) return { rows: [], title: null };
    const { data } = await supabaseClient.from('exam_assignment').select('exam_id, exam_master(title, exam_type)').eq('assignment_id', assignId).maybeSingle();
    if (!data?.exam_id) return { rows: [], title: null };

    const { data: items } = await supabaseClient.from('exam_item').select('*, question_db(*)').eq('exam_id', data.exam_id).order('sort_order', { ascending: true });
    const validItems = (items || []).filter((it: any) => it.question_db);
    const title = data.exam_master?.title || null;

    // 💡 [9번] 주교재/워크북처럼 상단 교재 필터 탭에서 구분해 볼 수 있도록 카테고리로 태그한다.
    // 실제 textbook_question으로 복제하지 않고, questions 배열에만 bookId/bookType을 붙여
    // 기존 availableBooks/switchBookFilter 로직이 그대로 인식하게 한다. exam_type이
    // '오답프린트'인 배정은 일반 "기타" 과제와 섞이면 눈에 안 띄니, 빨간 "오답" 배지로 구분한다.
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
    // 💡 React StrictMode(개발 모드)의 mount→cleanup→mount 재실행이나 Fast Refresh로
    // 이 effect가 두 번 실행되면, unsubscribe()만으로는 supabase-js 채널 목록에서 즉시
    // 지워지지 않아 두 번째 호출이 "이미 subscribe된" 옛 채널 객체를 재사용하게 되고
    // .on('presence', ...) 추가 시 에러가 난다. removeChannel을 기다린 뒤 새로 만든다.
    if (clinicChannelRef.current) {
      await supabaseClient.removeChannel(clinicChannelRef.current);
      clinicChannelRef.current = null;
    }
    const channel = supabaseClient.channel(CLINIC_ROOM);
    clinicChannelRef.current = channel;
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const hasEditor = Object.values(state).some((metas) => (metas as any[]).some(m => m.role === 'editor'));
        setEditorLocked(hasEditor);

        if (mySeatRef.current) {
          // 좌석은 이미 DB 직접 배정으로 정해졌을 수 있다 — presence 등록만 아직이면 여기서 한다.
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
          // 💡 connectChannel은 마운트 시 한 번만 실행되므로, 이 presence-sync 콜백이 직접
          // trackPresence를 참조하면 그 시점(아직 studentInfo.name/classes가 채워지기 전, "학생"/[]
          // 기본값)에 영원히 고정된다. ref로 감싸 항상 최신 studentInfo를 참조하도록 한다.
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
      // 💡 unsubscribe()만 하면 supabase-js 클라이언트의 채널 목록에서 안 지워져서, 다음
      // connectChannel()이 같은 topic으로 .channel()을 호출할 때 이 "이미 subscribe된" 옛
      // 객체를 재사용하게 된다. removeChannel로 완전히 제거해야 다음 구독이 안전하다.
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
      // 💡 [8번] 슈퍼바이저가 오답 프린트를 생성했거나 명시적으로 내보낸 경우 — 동결 해제.
      setAwaitingReview(false);
    } else if (payload.action === 'force_checkout' || payload.action === 'force_checkout_by_ta') {
      if (payload.seat !== mySeatRef.current) return;
      handleTimeUp(payload.action);
    } else if (payload.action === 'move_seat') {
      if (payload.seat === mySeatRef.current && payload.newSeat) {
        mySeatRef.current = payload.newSeat;
        // 💡 [버그 수정] seat만 갱신하고 manual_seat는 그대로 둬서, manual_seat를 우선하는 화면
        // (수퍼바이저)에서는 옛 좌석이 계속 보이는 불일치가 있었다. 두 컬럼을 함께 갱신하고,
        // student_id로만 필터링하면 그날 지난(ended_at이 찍힌) 옛 세션 행까지 덩달아 갱신돼
        // "좀비" 좌석 데이터가 쌓이므로 현재 진행 중인 세션 행으로 범위를 좁힌다.
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

  // 💡 handleTaAction은 questions/isTimedRound 등 리액트 state를 참조하는데,
  // connectChannel의 broadcast 구독은 최초 렌더링 시 한 번만 등록된다.
  // 구독 콜백이 그 시점의(state가 비어있던) handleTaAction을 영원히 붙잡고 있으면
  // 이후 채점된 questions를 절대 찾지 못해 재확인(recheck) 승인이 항상 무시된다.
  // 매 렌더마다 ref를 최신 함수로 갱신해 구독 콜백은 항상 최신 버전을 호출하도록 한다.
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

  // 💡 클리닉 이용 1분당 1P 적립. 실제 지급량은 서버(awardClinicMinutePoints)가 "마지막 지급
  // 이후 실제로 흐른 시간"만 분 단위로 잘라 지급하므로, 이 주기를 짧게 잡아도(더 자주 호출해도)
  // 더 빨리 받게 되지는 않는다 — 화면에 반영되는 지연 시간만 줄어들 뿐이다. 어차피 1분 단위로만
  // 오르는데 20초마다 확인하면 3번 중 2번은 아무것도 못 받는 헛 쿼리라서(DB 요청 낭비), 실제
  // 지급 주기(1분)보다 살짝만 긴 65초로 잡아 쿼리 수를 1/3로 줄이면서도 체감 지연은 거의 없게 한다.
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

  // 💡 [6번] 수퍼바이저 화면(useSupervisorData.tsx)은 clinic_session_state.last_seen_at이
  // HEARTBEAT_TIMEOUT_MS(45초) 넘게 갱신되지 않으면 "하트비트가 끊겨 비정상 종료"로 간주해
  // 좌석 카드를 통째로 목록에서 지워버린다 — 그 안에 있던 제출완료(submitted) 배지와
  // 오답프린트 생성/내보내기 버튼도 함께 사라진다. 이 화면이 실제로 last_seen_at을 갱신하는
  // 하트비트를 보낸 적이 없었던 게 "클리닉이 끝난 뒤 수퍼바이저 대시보드에 아무 것도 남아있지
  // 않던" 원인이다 — 학생이 문제를 다 풀고 awaitingReview로 얼어붙어도, 화면은 계속 열려있으니
  // 15초 주기로 살아있음을 알려 45초 타임아웃에 걸리지 않게 한다.
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

  // 💡 객관식 보기(options)는 QuestionDisplay처럼 별도 컴포넌트로 메모하면 선택 상태(ref 기반) 갱신이
  // 끊기므로, 문항이 바뀔 때만 이 영역을 다시 타이프셋하도록 별도 effect로 처리한다.
  // (그렇지 않으면 첫 문항 이후로는 보기 안의 수식이 LaTeX 원문 그대로 노출된다.)
  useEffect(() => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise && optionsRef.current) {
      mj.typesetPromise([optionsRef.current]).catch((err: any) => console.error("MathJax 타이프셋 에러:", err));
    }
  }, [currentQIndex, questions[currentQIndex]?.options]);

  // 💡 자리비움/호출/재확인 대기 중에는 화면 이동(뒤로가기/닫기/새로고침)을 막는다.
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

  // 💡 [8번] 동결 해제는 기본적으로 release_to_portal 브로드캐스트로 오지만, 그 순간 학생 탭이
  // 새로고침/재연결 중이면 놓칠 수 있다. 대신 "이 학생 앞으로 오답 프린트가 실제로 생성됐는지"를
  // DB에서 직접 확인할 수 있으므로(브로드캐스트 없이도 확인 가능한 durable 신호), 동결 중엔
  // 주기적으로 폴링해서 놓친 해제도 스스로 복구한다.
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

    // 💡 [6번] enterAwaitingReview가 보내는 'submit' 브로드캐스트는 그 순간 열려있던 수퍼바이저
    // 화면에만 전달되고 재생되지 않는다 — 수퍼바이저가 그때 접속 전이었거나 새로고침 중이었으면
    // "제출완료" 배지(및 오답프린트 생성/내보내기 버튼)를 영영 못 본다. 동결 중엔 주기적으로
    // 같은 신호를 다시 보내서, 나중에 들어오거나 재연결한 수퍼바이저 화면도 몇 초 안에 따라잡게 한다.
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

  // 💡 [10번] 문항 idx의 손글씨 답안을 AI로 채점해 penGradeCache에 남긴다. 이미 채점됐거나
  // 채점할 손글씨가 없으면 아무 일도 하지 않는다. 실패하면(API 키 없음 등) 캐시에 남기지 않아
  // 최종 집계 시점에 다시 시도된다 — 재확인 요청 같은 별도 절차 없이, 실패 시엔 오답으로 간주해
  // 오답프린트로 보내는 쪽이 "그냥 사라지는" 것보다 안전하다.
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

  // 손글씨(라운드1)는 AI 채점 캐시를, 그 외(객관식/키패드)는 기존 텍스트 비교를 쓴다.
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

  // 💡 [10번] "다른 문제로 넘어갈 때 미리 채점" — cleanup은 effect가 다시 실행되기 "직전"(=
  // currentQIndex가 막 바뀐 시점)에 그 시점의 currentQIndex(막 떠난 문항)를 클로저로 들고
  // 실행되므로, 정확히 "방금 떠난 문항"을 백그라운드로 채점하기에 알맞다.
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

    // 라운드(문제풀이) 시간초과는 포털로만 돌아가면 되지만, 클리닉 전체 이용시간 종료(자연 만료/조교 강제퇴실)는
    // 하루 세션 자체가 끝난 것이므로 로그인 화면으로 완전히 내보내야 한다.
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
    // 💡 isSubmitting으로 중복 클릭을 막는다. AI 채점은 네트워크 왕복이 있어서
    // 버튼이 계속 눌리는 상태로 남아있으면 여러 번 눌러 여러 번 채점 요청/신호가 나갈 수 있다.
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

  // 💡 [8번] 이 라운드의 오답을 전부 풀면 바로 "홈으로 돌아가기"를 보여주지 않고, 슈퍼바이저가
  // 오답 프린트를 검토/생성하거나 명시적으로 내보낼 때까지 화면을 붙잡아 둔다(동결). TA/슈퍼바이저
  // 화면에는 'submit' 브로드캐스트로 완료(submitted) 상태를 알린다.
  const enterAwaitingReview = () => {
    awaitingReviewSinceRef.current = new Date().toISOString();
    setAwaitingReview(true);
    setEmptyState({ title: '모든 오답을 해결했습니다!', desc: '선생님이 결과를 확인하고 있어요. 잠시만 기다려주세요.', awaited: true });
    sendAction('submit', { score: correctSolvedCountRef.current });
  };

  // 다음으로 풀어야 할(아직 정답 처리되지 않은) 문항의 인덱스를 fromIdx 다음부터 순환하며 찾는다.
  // 하나도 없으면(전부 정답 처리됨) null.
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
    // 💡 wasWrongBefore를 finalizeQuestionProgress 호출 전에 미리 계산해서 넘긴다 — grading_code에
    // "도움 없이 재도전해서 맞음"(RO)을 남기기 위함. 이 정보가 없으면 재도전 성공이 순수 첫시도
    // 정답(O)과 DB상 구별이 안 돼서, 학습관리 탭에서 "실제로는 한 번 틀렸던 문항"을 걸러낼 수 없었다.
    const wasWrongBefore = qBoxStatus.current[idx] === 'wrong_red';

    // 💡 오답 배부(오답프린트) 문항은 examAssignmentId 경로로 로드돼서 q.record_id가 애초에 안 붙어있다
    // (fetchAssignedExamQuestions가 record_id를 넣어주지 않음) — 이번 시도에서 한 번도 안 틀리고 바로
    // 맞히면(재도전 없이 첫 시도 정답) q.record_id가 끝까지 비어 있어 원래 오답노트 기록의 resolved_at이
    // 영영 안 채워지는 버그가 있었다. record_id가 없어도 student_id+tq_id/question_id로 열려있는
    // (resolved_at이 null인) 오답 기록을 찾아 함께 닫는다.
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

    // 💡 예전엔 여기서 questions 배열에서 문항을 splice로 지우고 뒤쪽 인덱스를 전부 한 칸씩
    // 당겨왔다("문항 박스가 사라지는" 원인). 이제는 배열은 그대로 두고 qBoxStatus만 기록해서
    // 박스가 목록에 남은 채 O/X/세모로 색만 바뀌게 한다. wasWrongBefore면(이번 세션에서 한 번
    // 틀렸다가 다시 맞힘) 세모(retry_yellow), 아니면 도움 여부에 따라 O(파랑/노랑)로 기록한다.
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

  // 💡 [13번] helped(힌트/조교 호출 도움을 받았는지)를 grading_code에 반영한다. 예전엔 이 함수가
  // isCorrect만 받아서 항상 순수 'O'/'X'로만 기록했다 — processCorrectAnswer/submitSingleAnswer는
  // 도움 여부(helped/gotTaHint)를 이미 알고 있었는데 그 정보가 여기까지 전달되지 않아, 학습관리
  // 탭에서 "도움받아 푼 문제"와 "혼자 힘으로 푼 문제"가 똑같이 보였다(오답노트 경로의
  // student_incorrect_record만 TO/TX를 기록했고, 정작 더 흔한 과제 채점엔 반영이 안 됐다).
  const finalizeHomeworkProgress = async (q: any, isCorrect: boolean, helped: boolean = false, retried: boolean = false) => {
    if (!q.homework_id) return;
    const { data: existing } = await supabaseClient.from('student_homework_answer').select('hw_answer_id, wrong_attempts_log').eq('homework_id', q.homework_id).eq('student_id', studentInfo.id).eq('tq_id', q.tq_id).maybeSingle();
    let wrongLog = existing?.wrong_attempts_log || [];
    if (typeof wrongLog === 'string') try { wrongLog = JSON.parse(wrongLog); } catch(e){ wrongLog=[]; }
    if (!Array.isArray(wrongLog)) wrongLog = [];

    const myAns = studentAnswers.current[currentQIndex] || '미입력';
    if (!isCorrect && myAns !== '미입력') wrongLog.push({ input: myAns, at: new Date().toISOString() });

    // 💡 RO = 도움 없이 스스로 재도전해서 맞힘. O(첫시도 정답)와 실제 정답 여부/배점은 동일하게
    // 취급하되(O 취급하는 곳들엔 'RO'도 함께 넣어줌), 학습관리 탭 통계에서만 별도로 걸러낸다.
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
      // 💡 과제 오답도 시험 오답(saveExamResultsToDB)과 동일하게 student_incorrect_record에 쌓아
      // 오답노트/오답유사 클리닉 파이프라인에 자동 편입되게 한다(기존엔 이 upsert가 빠져 있었음).
      // 과제 문항 대부분은 question_db가 아니라 textbook_question(tq_id) 소속이라 tq_id도 함께 본다.
      // record_id가 이미 있는 문항(오답노트/오답유사에서 온 문항)은 위에서 이미 status를 갱신했으므로
      // 여기서 다시 덮어쓰지 않는다.
      // student_id+tq_id 조합엔 upsert onConflict가 걸릴 unique 제약이 없다고 가정하고
      // 직접 조회 후 없을 때만 insert한다.
      const filterCol = q.tq_id ? 'tq_id' : 'question_id';
      const filterVal = q.tq_id ?? q.question_id;
      const { data: existingRecord } = await supabaseClient.from('student_incorrect_record').select('record_id').eq('student_id', studentInfo.id).eq(filterCol, filterVal).is('resolved_at', null).maybeSingle();
      if (!existingRecord) {
        // 💡 방금 새로 만든 오답노트 기록의 record_id를 q에 다시 붙여준다. 안 붙이면, 같은 세션
        // 안에서 이 문항을 바로 재도전해 맞혀도 processCorrectAnswer가 q.record_id를 못 찾아서
        // 방금 만든 이 기록을 영영 못 풀고(resolved_at 안 채워진 채) 유령으로 남긴다.
        const { data: newRecord } = await supabaseClient.from('student_incorrect_record').insert(
          { student_id: studentInfo.id, tq_id: q.tq_id ?? null, question_id: q.question_id ?? null, source_type: '과제오답', status: helped ? 'TX' : 'X', resolved_at: null }
        ).select('record_id').single();
        if (newRecord) q.record_id = newRecord.record_id;
      } else {
        q.record_id = existingRecord.record_id;
      }
    }
  };

  // 💡 round=2에 병합된 exam_type='과제'/'과제프린트' 문항(tq_id 없음, examAssignmentId만 있음) 전용.
  // 오답이면 오답노트에 쌓고(다시 풀 때까지 큐에 남음), 그 assignment의 문항이 전부 정답으로
  // 풀리면 exam_assignment.status를 완료 처리한다.
  const finalizeExamAssignmentProgress = async (q: any, isCorrect: boolean, helped: boolean = false, retried: boolean = false) => {
    if (!q.examAssignmentId) return;

    // 💡 [학습관리 오답프린트 O/X 미표시] student_answer는 원래 라운드1(saveExamResultsToDB)만
    // 채워서, exam_assignment 기반(examAssignmentId, 즉 과제프린트·오답프린트로 배정된) 문항을
    // 클리닉에서 실시간으로 풀 때는 문항별 채점 기록이 어디에도 안 남았다 — 학습관리에서 이
    // 배정을 열어보면 실제로 풀었어도 항상 ✅0 ❌0으로만 보이던 원인. 정답/오답과 무관하게
    // 여기서 직접 upsert해서 다른 배정 유형(student_homework_answer)과 동일하게 문항별 기록을 남긴다.
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
          // 💡 finalizeHomeworkProgress와 동일한 이유로, 새로 만든 오답노트 기록의 record_id를
          // q에 붙여둔다 — 안 그러면 같은 세션에서 바로 재도전해 맞혀도 이 기록을 못 풀고 남긴다.
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

  // 문항이 tq_id 기반(정규 교재 과제)인지 exam_assignment 기반(과제프린트로 배정된 것)인지에 따라
  // 알맞은 진행률 저장 함수로 갈라 보낸다.
  const finalizeQuestionProgress = async (q: any, isCorrect: boolean, helped: boolean = false, retried: boolean = false) => {
    if (q.examAssignmentId) await finalizeExamAssignmentProgress(q, isCorrect, helped, retried);
    else await finalizeHomeworkProgress(q, isCorrect, helped, retried);
  };

  const saveExamResultsToDB = async () => {
    if (!isTimedRound || !params.assignmentId) return;
    await supabaseClient.from('student_answer').delete().eq('exam_assignment_id', params.assignmentId).eq('student_id', studentInfo.id);

    const inserts: any[] = []; const incUpserts: any[] = []; let totalScore = 0;
    // 💡 [10번] 여기서도 handleTimeUp과 같은 채점 기준(isQuestionCorrect)을 써야 한다 — 예전엔
    // 여기 따로 keypadAnswersMatch만 써서, generateIncorrectPrint가 정확히 오답을 잡아내도
    // student_answer/student_incorrect_record엔 손글씨 문항이 여전히 잘못(항상 오답)
    // 기록되는 불일치가 있었다.
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

    // 💡 [8번] 예전엔 오답을 student_incorrect_record에 남기는 걸 아래 "오답프린트(exam_assignment)"
    // 생성 성공 여부에 완전히 얹어놨다 — instructor_id 조회가 하나라도 실패하면(반에 담당 강사가
    // 지정 안 돼 있거나, 폴백으로 쓰던 instructor 테이블 조회가 행이 0/2개 이상이라 .single()이
    // 에러를 던지면) catch(e){}가 통째로 삼켜서, 라운드는 '제출완료'로 끝나는데 오답은 어디에도
    // 남지 않는(=학습 관리/오답노트/클리닉에 하나도 안 뜨는) 현상이 났다. 오답을 "보내는" 가장
    // 기초적인 경로(student_incorrect_record)는 강사 조회와 무관하게 항상 먼저 확정해두고,
    // 강사용 오답 프린트(exam_assignment) 생성은 그 위에 얹는 부가 기능으로 분리한다.
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

  // 💡 이제 캔버스가 문제 텍스트 위에 겹쳐지므로, 예전의 촘촘한 격자선은 흐려진 문제 글자와
  // 뒤섞여 지저분해 보인다. 대신 넓은 간격의 옅은 점만 찍어서 "여기 써도 되는 표면"이라는
  // 느낌만 은은하게 주고, 밑에 깔린 문제는 최대한 방해하지 않게 한다.
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

    // 💡 여기서 ctx.strokeStyle/lineWidth를 currentPenWidth/currentPenColor로 다시 대입하면 안 된다 —
    // 펜 굵기·색상 버튼은 ctxRef.current(=이 ctx와 동일 객체)에 직접 값을 넣어 즉시 반영하는데,
    // 획을 시작할 때마다 여기서 클로저에 캡처된 옛 값으로 되돌리면 버튼으로 바꾼 게 다음 획에서
    // 매번 원래 색/굵기로 덮어써진다(실제로 겪은 버그). ctx는 initCanvas가 이미 세팅해뒀고
    // 버튼들이 그 위에 직접 갱신하므로, 여기서는 그 값을 그대로 존중한다.
    // 💡 [2번] setPointerCapture 없이 그냥 캔버스 요소에만 리스너를 달면, 빠르게 획을 그을 때
    // 포인터가 캔버스 경계를 살짝 벗어나는 순간 브라우저가 더 이상 이 요소로 move/up 이벤트를
    // 보내지 않는다 — 획이 중간에 끊기고, 다시 안으로 들어와도 이어지지 않은 채 새 점으로
    // 시작해버렸다(화면 밖으로 나갔다 돌아오면 "이어그려지지 않는" 원인). pointerdown에서
    // 포인터를 캡처하면 버튼을 떼기 전까지는 경계를 벗어나도 move/up이 계속 이 캔버스로 온다.
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

    // 포인터가 캡처되어 있으므로 pointerleave에서는 더 이상 획을 끊지 않는다 — 실제로 손을
    // 뗄 때(pointerup)와 비정상 종료(pointercancel)에서만 stopDraw를 호출한다.
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

  // 💡 워크북/연산교재 문항은 textbook_question에 큐레이션된 힌트 컬럼이 없어서, 손글씨 채점과
  // 같은 제미나이 키/모델 설정을 재사용해 그 자리에서 힌트를 생성한다. API 키가 없거나 호출이
  // 실패해도 힌트 기능 자체는 계속 쓸 수 있어야 하므로 목업 문구로 조용히 대체한다.
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
    // 💡 ㉠, ㉡처럼 기호를 순서대로 나열하는 답(예: "가장 큰 수부터 순서대로 기호를 쓰세요")은
    // 쉼표 뒤에 띄어쓰기가 있는 표기가 자연스러워서, 쉼표 키는 ","가 아니라 ", "를 그대로 넣는다.
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
    // 💡 손글씨는 이제 왼쪽 문제 패널 위에 캔버스를 오버레이로 얹는 방식이라, 캔버스가 그 위치에
    // 실제로 마운트된 뒤에 크기를 잡아야 한다 — pen 모드로 막 전환된 시점엔 아직 렌더 전이라 바로
    // initCanvas를 부르면 rect.width가 0으로 잡히므로 다음 페인트 이후로 살짝 늦춰서 호출한다.
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

  // 💡 자리비움/호출/재확인 대기 중에는 포탈로 못 나가게 막는다 — 확인 절차를 우회해 URL로 빠져나가는 것도 방지.
  const requestLeaveToHome = () => {
    // 💡 [8번] 테스트 중 발견: awaitingReview(동결) 상태를 안 막으면, 헤더의 "나가기" 버튼으로
    // confirm 한 번만 누르고 슈퍼바이저 승인 없이 바로 나갈 수 있었다 — 동결의 의미가 없어짐.
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

  // 승인된 종료 요청 / 클리닉 전체 시간종료(자연만료·강제퇴실) 시: 하루 세션이 완전히 끝난 것이므로 로그인 화면으로 보낸다.
  const finalizeAndGoToLogin = async () => {
    setIsLoggingOut(true);
    sendAction('depart');
    await untrackPresence();
    localStorage.removeItem('logica_student_id');
    localStorage.removeItem('logica_student_name');
    localStorage.removeItem('logica_student_phone');
    router.push('/student/login');
  };

  const q = questions[currentQIndex];
  // 💡 [7번] 교재 문항(bookType 있음)이 하나라도 있으면 상단 탭을 보여준다 — 주간테스트/
  // 오답클리닉은 애초에 bookType이 없는 문제들이라 availableBooks가 항상 비어 있어 자연히
  // 탭이 안 뜬다. bookId가 아니라 bookType(주교재/부교재/워크북/기타) 기준으로 묶어서, 같은
  // 종류가 서로 다른 배정(bookId)에서 왔더라도 탭 하나로 합쳐 보인다.
  const availableBooks = [...new Map(questions.filter(qq => qq.bookType != null).map(qq => [qq.bookType, qq])).values()]
    .map(qq => ({ bookType: qq.bookType, count: questions.filter(x => x.bookType === qq.bookType).length }));
  const visibleIndices = questions.map((_, i) => i).filter(i => bookFilter === 'all' || questions[i].bookType === bookFilter);
  // 탭 전환 시 bookFilter만 바꾸면, currentQIndex가 아직 안 따라와서 아래 정합성 가드가 방금
  // 고른 탭을 즉시 '전체'로 되돌려버린다 — 탭을 고른 문항으로 함께 점프시켜야 한다.
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
                {/* 💡 캔버스를 이 스크롤 컨테이너 "밖"(형제)에 절대 위치로 얹었더니, 문제가 길어서
                    스크롤이 필요할 때 캔버스가 포인터 이벤트를 다 가로채면서 정작 스크롤 가능한
                    div는 캔버스의 조상이 아니라서 휠/터치 스크롤이 전혀 먹지 않는 문제가 있었다.
                    캔버스를 스크롤 컨테이너의 "자식"으로 넣어서 문제 내용과 같은 높이로 함께
                    스크롤되도록 한다. 안내 배지만 스크롤과 무관하게 항상 보이도록 밖에 남긴다. */}
                {/* 💡 [4번] 힌트 패널이 카드 맨 아래에 공중에 뜬 채 항상 깔려 있으므로, 그 뒤에
                    가려지는 문제/필기 맨 아래 부분도 스크롤해서 볼 수 있도록 여유 공간을 둔다. */}
                <div className={`h-full overflow-y-auto custom-scrollbar p-8 ${!isTimedRound ? 'pb-40' : ''}`}>
                  {/* 💡 이 안쪽 relative 래퍼는 문제 텍스트(정상 흐름 요소) 높이만큼 자연스럽게 늘어난다.
                      canvas(inset-0)는 바로 이 래퍼 기준으로 늘어나므로, 문제가 스크롤 컨테이너의
                      보이는 높이보다 길어도 캔버스가 전체 내용 길이만큼 커져서 어디로 스크롤하든
                      항상 그 위치에 그릴 수 있다. (스크롤 컨테이너 자체에 relative를 주면 캔버스가
                      "보이는 높이"에만 맞춰져서 스크롤할수록 캔버스가 내용과 같이 밀려 올라가
                      화면 밖으로 사라져버린다.) */}
                  {/* 💡 [1번] 이 래퍼가 문제 텍스트 높이에만 맞춰지면(min-h 없이) 문제가 짧을 때
                      캔버스(inset-0)도 그만큼만 생겨서, 흰 박스 안 빈 아래쪽 공간은 아예 필기가
                      안 되는 "위쪽 일부만 써지는" 현상이 났다. 스크롤 컨테이너의 보이는 높이만큼은
                      항상 확보해서(min-h-full) 짧은 문제도 박스 전체가 필기 가능하게 한다. */}
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

              {/* 💡 [4번] 예전엔 이 힌트 블록이 flex-col 안의 일반 흐름 요소(shrink-0)였다 — 힌트를
                  펼치면 안의 아코디언(HintRevealBox, 최대 260px)이 커지면서 형제인 위쪽 flex-1
                  캔버스 영역이 그만큼 눌려 줄어들었고, 캔버스는 리사이즈를 감지 못해 이미 그린
                  그림이 눌린 비율로 늘어나 보였다("힌트 접힘에 따라 필기가 줄어듦"). 힌트를 문서
                  흐름에서 완전히 빼서(absolute) 카드 맨 아래에 공중에 뜬 패널처럼 얹으면, 펼치고
                  접어도 캔버스가 차지하는 실제 박스 크기는 전혀 바뀌지 않는다. */}
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

            {/* 💡 이 컬럼은 원래 min-h-0 없이 flex-1이라 grid 행 높이(h-full)를 무시하고 내용물
                (문항 이동 카드 + 정답 입력 카드 + 제출 버튼) 크기만큼 그냥 늘어났다 — 화면이 낮으면
                (예: 노트북 1280x720) 그 늘어난 부분이 overflow-hidden인 <main> 바깥으로 빠져나가
                스크롤도 안 되고 그냥 안 보이게 잘렸다(특히 맨 아래 "정답 입력" 제출 버튼). min-h-0로
                진짜 grid 행 높이만큼만 차지하게 하고, 그래도 모자라면(작은 화면) 이 컬럼 자체가
                스크롤되게 해서 최소한 화면 안에서 아래로 스크롤만 하면 항상 닿을 수 있게 한다. */}
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
                      // 💡 라운드1(타이머 시험)은 processCorrectAnswer를 안 거치므로 qBoxStatus가 항상
                      // 비어있어 원래 번호만 보인다. round!==1에서만 O/X/세모로 바뀐다.
                      const status = qBoxStatus.current[i];
                      const symbol = status === 'wrong_red' ? 'X' : status === 'retry_yellow' ? '△' : status ? 'O' : null;
                      // 💡 [5번] 예전엔 "현재 선택된 문항"을 옅은 상태색 배경 위에 파란 링만 둘러서
                      // 표시했다 — 링 색(파랑)과 상태색(빨강/파랑/노랑)이 뒤섞여 지금 뭘 선택했는지
                      // 한눈에 안 들어왔다. 선택된 박스는 그 상태색 "꽉 찬" 진한 배경으로 채워
                      // 미선택 박스(옅은 배경)와 명확히 구분되게 한다.
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

      {/* 모달 1: 힌트 확인 */}
      {hintModal && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-[320px] text-center">
            <div className="text-4xl mb-3">🪙</div><h3 className="text-lg font-extrabold text-slate-800 mb-2">포인트 차감 안내</h3>
            <p className="text-sm text-slate-600 mb-6 font-medium leading-relaxed">{hintModal.level}단계 힌트를 열람하시겠습니까?<br/>보유 포인트에서 <span className="font-bold text-rose-500">{hintModal.cost}P</span>가 차감됩니다.</p>
            <div className="flex gap-2">
              <button disabled={hintModal.loading} onClick={() => setHintModal(null)} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-40">취소</button>
              <button disabled={hintModal.loading} onClick={async () => {
                // 💡 hintModal.loading(state)만으로 막으면 리렌더 커밋 전(같은 틱)의 두 번째 클릭이
                // 여전히 loading:false인 옛 클로저를 읽고 통과할 수 있다. ref는 동기로 즉시 갱신되므로
                // 모바일 더블탭 등으로 이 핸들러가 겹쳐 불려도 두 번째 호출은 여기서 확실히 막힌다.
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

      {/* 모달 2: 개별 정답 결과 */}
      {resultModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center transform transition-transform scale-100 animate-[fadeIn_0.2s_ease-out]">
            <div className="text-6xl mb-4">{resultModal.isCorrect ? "🎉" : "💥"}</div>
            <h3 className={`text-2xl font-black mb-2 ${resultModal.isCorrect ? 'text-emerald-600' : 'text-rose-600'}`}>{resultModal.isCorrect ? "정답입니다!" : "아쉽게 틀렸습니다"}</h3>
            <p className="text-sm text-slate-500 font-bold mb-8 leading-relaxed">{resultModal.isCorrect ? (resultModal.note ? `완벽히 복습되었습니다. ${resultModal.note}` : "완벽히 복습되었습니다. 오답 노트에서 제외됩니다.") : (resultModal.note || "다시 한번 풀어보거나, 힌트를 열람해보세요.")}</p>
            <button onClick={() => {
              // 💡 정답 처리(문항 박스 색 변경 + 다음 미해결 문항으로 이동)는 이미 채점 시점에
              // processCorrectAnswer가 끝냈다(모달이 뜨기 전에). 여기서는 모달만 닫으면 된다 —
              // 예전엔 이 버튼도 questions 배열을 한 번 더 splice해서, 모달이 뜬 사이 currentQIndex가
              // 이미 다음 문항으로 넘어가 있으면 그 무관한(아직 안 푼) 문항까지 잘못 지워지는 버그가 있었다.
              if (!resultModal.isCorrect) { studentAnswers.current[currentQIndex]=null; delete studentDrawings.current[currentQIndex]; delete keypadAnswers.current[currentQIndex]; forceUpdate(); setTimeout(()=>initCanvas(currentQIndex),50); }
              setResultModal(null);
            }} className={`w-full font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all ${resultModal.isCorrect ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-800 hover:bg-slate-900 text-white'}`}>
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
            <button onClick={logoutTarget === 'login' ? finalizeAndGoToLogin : leaveAndGoHome} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all">홈으로 돌아가기</button>
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
            <button onClick={logoutTarget === 'login' ? finalizeAndGoToLogin : leaveAndGoHome} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm transition-all">홈으로 돌아가기</button>
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
