// src/app/clinic/ta/pad/useTaHandheld.ts
import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { clearActiveCall, clearActiveRecheck } from "@/lib/clinicSession";
import { getActiveSeatLayout } from "@/app/actions/clinicSeatLayout";
import { SEAT_LAYOUT_UPDATED_EVENT, formatSeatLabel, Seat, DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, DEFAULT_SEAT_CARD_W, DEFAULT_SEAT_CARD_H } from "@/lib/clinicSeatLayout";

// ==========================================
// 상수 및 환경 설정 (보안 강화)
// ==========================================
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const CLINIC_ROOM = "logica-clinic-room";

// 좌석 표기: 좌석 배치 에디터의 번호(1..N)를 그대로 쓴다("A-01" 같은 영화관식 표기는 폐기).
export const formatSeat = formatSeatLabel;

const SEAT_POLL_INTERVAL_MS = 3000;
// 💡 자정 이후(00시~09시 KST)에는 UTC 날짜와 KST 날짜가 어긋나 세션을 못 찾는 버그가 있었음 — 항상 KST 기준으로 통일
const getKSTDateString = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
const TA_NAME_STORAGE_KEY = 'logica_ta_name';
const TA_CLIENT_ID_STORAGE_KEY = 'logica_ta_client_id';

// ==========================================
// 타입 정의
// ==========================================
export type StudentStatus = "idle" | "call" | "hint" | "away" | "submitted";

export interface StudentData {
  name: string;
  classes: string[];
  status: StudentStatus;
  studentId?: string;
  sessionId?: string;
  lastUpdatedAt: number;
  missingSince?: number | null;
  calls?: Record<string, number>;
  score?: number;
}

export interface CallData {
  seat: string;
  studentId?: string;
  qNum: number;
  name: string;
  classes: string[];
  questionText: string;
  imageUrl: string;
  options: string[] | null;
  answer: string;
  explanation: string;
  source: string;
  calledAt: number;
}

export interface RecheckData {
  seat: string;
  studentId?: string;
  uid: string;
  qNum: number;
  name: string;
  classes: string[];
  questionText: string;
  correctAnswer: string;
  imageDataUrl: string;
  recognizedText: string;
  aiExplanation: string;
  aiConfidence: number | null;
  requestedAt: number;
}

// 싱글톤 패턴으로 Supabase 클라이언트 생성
const getSupabaseClient = () => {
    if (typeof window === 'undefined') return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (!(window as any)._supabaseInstance) (window as any)._supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return (window as any)._supabaseInstance;
};
const supabaseClient = getSupabaseClient();

export function useTaHandheld() {
  // === 인증 및 세션 상태 ===
  const [taName, setTaName] = useState<string>("");
  const [taClientId, setTaClientId] = useState<string>("");
  const [taJoinedAt, setTaJoinedAt] = useState<number>(0);
  
  // === UI & 렌더링 상태 ===
  const [isConnected, setIsConnected] = useState(false);
  const [gridSnapshot, setGridSnapshot] = useState<Record<string, StudentData>>({});
  const [callsSnapshot, setCallsSnapshot] = useState<Record<string, CallData>>({});
  const [rechecksSnapshot, setRechecksSnapshot] = useState<Record<string, RecheckData>>({});
  const [myAssignedSeats, setMyAssignedSeats] = useState<Set<string>>(new Set());
  const [assignmentMap, setAssignmentMap] = useState<Record<string, string>>({});
  const [claimedByOthers, setClaimedByOthers] = useState<Record<string, string>>({});
  const [totalTaCount, setTotalTaCount] = useState(0);
  const [allSeats, setAllSeats] = useState<string[]>([]);
  const [allSeatObjs, setAllSeatObjs] = useState<Seat[]>([]);
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_CANVAS_W);
  const [canvasHeight, setCanvasHeight] = useState(DEFAULT_CANVAS_H);
  const [seatWidth, setSeatWidth] = useState(DEFAULT_SEAT_CARD_W);
  const [seatHeight, setSeatHeight] = useState(DEFAULT_SEAT_CARD_H);
  const [editorLocked, setEditorLocked] = useState(false);
  
  // 💡 [최적화] 경과 시간 계산용 가벼운 Tick 상태
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  // === 컨트롤 & 선택 상태 ===
  const [selectedCallKey, setSelectedCallKey] = useState<string | null>(null);
  const [markState, setMarkState] = useState<Record<string, 'hint' | 'skip' | null>>({});

  // === 모달 상태 ===
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [tempNameInput, setTempNameInput] = useState("");
  const [exitModalOpen, setExitModalOpen] = useState(false);

  // === 실시간 동기화용 Mutable Refs ===
  const activeStudentsRef = useRef<Record<string, StudentData>>({});
  const callsRef = useRef<Record<string, CallData>>({});
  const rechecksRef = useRef<Record<string, RecheckData>>({});
  const clinicChannelRef = useRef<any>(null);
  // 💡 fetchSeatsFromDB는 여러 개의 await를 거치는 비동기 함수라, 이전 호출이 아직 끝나기 전에
  // 폴링 인터벌이 다음 호출을 또 시작하면 두 실행이 겹칠 수 있다. 늦게 시작한(=더 오래된 DB
  // 스냅샷을 읽은) 호출이 나중에 끝나면 activeStudentsRef를 오래된 값으로 덮어써서, 방금 옮긴
  // 좌석이 잠깐 되돌아갔다가 다시 사라지는 등 호출/재확인 요청이 깜빡이며 유실될 수 있었다.
  const isFetchingSeatsRef = useRef(false);
  // 💡 위 가드가 "영원히 true로 고정"되면(네트워크 요청이 완료도 실패도 안 하고 멈추는 경우 등)
  // 폴링이 통째로 멈춰버린다 — 실제로 겪었다(에러도 안 나고, 한 번 멈추면 계속 옛 좌석에 고정됨).
  // 가드를 세운 시각을 같이 기록해, 너무 오래(정상적인 쿼리 소요 시간을 한참 넘게) 걸리면
  // 스스로 풀고 다시 시도하게 한다.
  const fetchingSeatsStartedAtRef = useRef(0);

  // ==========================================
  // 유틸리티 및 초기화
  // ==========================================
  useEffect(() => {
    let savedName = localStorage.getItem(TA_NAME_STORAGE_KEY) || "";
    let savedClientId = localStorage.getItem(TA_CLIENT_ID_STORAGE_KEY);
    
    if (!savedClientId) {
      savedClientId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(TA_CLIENT_ID_STORAGE_KEY, savedClientId);
    }
    
    setTaClientId(savedClientId);
    setTaJoinedAt(Date.now());

    if (savedName) {
      setTaName(savedName);
    } else {
      setIsFirstTime(true);
      setNameModalOpen(true);
    }

    const handleBeforeUnload = () => { if (clinicChannelRef.current) clinicChannelRef.current.untrack(); };
    window.addEventListener('pagehide', handleBeforeUnload);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', handleBeforeUnload);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (taName && taClientId && SUPABASE_URL && SUPABASE_ANON_KEY) connectClinicChannel();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taName, taClientId]);

  // 💡 좌석 현황은 realtime presence가 아니라 DB(clinic_session_state)를 기준으로 판단한다.
  // presence는 접속이 끊기면 즉시 사라지는 반면, 학생은 하루 종일 같은 물리적 좌석을 유지해야
  // 하므로(포털에서 다음 라운드를 고르는 동안 등) DB에 좌석이 실제로 비워질 때(조교/수퍼바이저의
  // 강제퇴실)만 사라지는 게 맞다. 주기적으로 폴링해서 activeStudentsRef를 갱신한다.
  // 💡 [버그 수정] 예전엔 1초 틱 하나 안에서 `Date.now() % N < 1000`으로 "이번 틱에 할지 말지"를
  // 가늠했는데, setInterval의 실제 발화 시각은 시간이 지나며 조금씩 밀릴 수 있어서(다른 무거운
  //작업, 백그라운드 탭 스로틀링 등) 이 나머지 연산이 매번 그 좁은 창을 벗어나면 fetchSeatsFromDB가
  // 에러 하나 없이 영원히 다시 안 불리는 경우가 실제로 있었다(좌석 이동이 계속 반영 안 되는 원인).
  // 서로 다른 주기는 독립적인 setInterval로 분리해, 한쪽이 밀려도 다른 쪽 스케줄에 영향이 없게 한다.
  useEffect(() => {
    const tickInterval = setInterval(() => setCurrentTime(Date.now()), 1000);
    const presenceInterval = setInterval(() => { if (clinicChannelRef.current) syncFromPresenceRef.current(); }, 2000);

    // 💡 setInterval(fn, N)은 "fn을 N마다 실행 시도"할 뿐, fn 자체가 멈추거나 씹혀도 인터벌은 계속
    // 살아있는 것처럼 보일 수 있어 디버깅이 어려웠다(에러 하나 없이 좌석 갱신만 영원히 멈춤).
    // 대신 매번 자기 완료 시점에 다음 실행을 직접 예약하는 setTimeout 체인을 쓴다 — 이러면
    // "돌고는 있는데 fetchSeatsFromDB만 조용히 안 불린다"는 상태 자체가 구조적으로 불가능하다.
    let cancelled = false;
    let seatTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNextSeatFetch = () => {
      if (cancelled) return;
      seatTimer = setTimeout(async () => {
        if (cancelled) return;
        try { await fetchSeatsFromDBRef.current(); } finally { scheduleNextSeatFetch(); }
      }, SEAT_POLL_INTERVAL_MS);
    };
    fetchSeatsFromDBRef.current().finally(scheduleNextSeatFetch);

    return () => {
      cancelled = true;
      clearInterval(tickInterval);
      clearInterval(presenceInterval);
      if (seatTimer) clearTimeout(seatTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taName, taClientId]);

  const formatElapsed = useCallback((calledAt: number) => {
    const mins = Math.floor((currentTime - calledAt) / 60000);
    return mins < 1 ? '방금' : `${mins}분`;
  }, [currentTime]);

  const flushState = useCallback(() => {
    setGridSnapshot(JSON.parse(JSON.stringify(activeStudentsRef.current)));
    setCallsSnapshot(JSON.parse(JSON.stringify(callsRef.current)));
    setRechecksSnapshot(JSON.parse(JSON.stringify(rechecksRef.current)));
  }, []);

  const sendToStudent = useCallback((seat: string, action: string, extra: any = {}) => {
    if (clinicChannelRef.current) {
      clinicChannelRef.current.send({ type: 'broadcast', event: 'ta_action', payload: { seat, action, ...extra, timestamp: Date.now() } });
    }
  }, []);

  const updateHandlingPresence = useCallback((callKey: string | null) => {
    if (!clinicChannelRef.current || !taName || !taClientId) return;
    clinicChannelRef.current.untrack().catch(() => {}).then(() => {
      clinicChannelRef.current.track({ role: 'ta', name: taName, joined_at: taJoinedAt, clientId: taClientId, handling: callKey, updatedAt: Date.now() });
    });
  }, [taName, taClientId, taJoinedAt]);

  // 💡 scheduleGhostRecheck는 useCallback(fn, [])로 마운트 시 딱 한 번만 만들어지는데,
  // 그 안에서 부르는 syncFromPresence()를 직접 참조하면 그 마운트 시점(taClientId가 아직
  // 빈 문자열이던 때)의 오래된 버전에 영원히 고정된다. syncFromPresenceRef를 매 렌더마다
  // 최신 함수로 갱신해서, 이 인터벌이 항상 최신 taClientId를 참조하는 버전을 호출하도록 한다.
  const syncFromPresenceRef = useRef<() => void>(() => {});

  // ==========================================
  // 실시간 동기화 로직
  // ==========================================

  // 좌석 배정(어느 조교가 어느 좌석을 담당하는지)만 계산한다 — 좌석에 누가 앉아있는지 자체는
  // fetchSeatsFromDB가 activeStudentsRef를 채워서 결정하고, 여기서는 그 결과(현재 점유된 좌석
  // 목록)를 그대로 받아 조교 인원수에 맞게 나눈다.
  const computeAssignment = (taMetas: any[], occupiedSeats: string[]) => {
    const map: Record<string, string> = {};
    const tas = [...taMetas].sort((a, b) => (a.joined_at - b.joined_at) || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));
    const studentSeats = [...occupiedSeats].sort((a, b) => Number(a) - Number(b));
    const N = tas.length; const M = studentSeats.length;
    if (N === 0 || M === 0) return map;
    const base = Math.floor(M / N); const remainder = M % N;
    let idx = 0;
    tas.forEach((ta, i) => {
      const count = base + (i < remainder ? 1 : 0);
      for (let k = 0; k < count; k++) { map[studentSeats[idx]] = ta.clientId; idx++; }
    });
    return map;
  };

  // 💡 좌석 현황(누가 어느 좌석에 앉아있는지)은 realtime presence가 아니라 DB를 기준으로
  // 판단한다. 여기서는 오직 "지금 접속해있는 조교가 몇 명인지, 각자 어떤 요청을 처리 중인지"만
  // presence로 파악해서, DB가 알려준 점유 좌석 목록을 조교 수만큼 나눠 배정한다.
  const syncFromPresence = useCallback(() => {
    if (!clinicChannelRef.current) return;
    const state = clinicChannelRef.current.presenceState();
    const taUpdatedAtByKey: Record<string, number> = {};
    const newClaimedByOthers: Record<string, string> = {};
    const taMetasMap = new Map<string, any>();

    let hasEditor = false;
    Object.values(state).forEach((metas) => {
      let latestMeta: any = null;
      (metas as any[]).forEach(meta => { if (!latestMeta || (meta.updatedAt || 0) > (latestMeta.updatedAt || 0)) latestMeta = meta; });
      if (!latestMeta) return;
      if (latestMeta.role === 'editor') { hasEditor = true; return; }
      if (latestMeta.role !== 'ta') return;

      const candidateUpdatedAt = latestMeta.updatedAt || 0;
      const key = latestMeta.clientId || `${latestMeta.name || '이름미상'}_(clientId없음)`;
      if (taUpdatedAtByKey[key] === undefined || candidateUpdatedAt > taUpdatedAtByKey[key]) {
        taUpdatedAtByKey[key] = candidateUpdatedAt;
        if (latestMeta.clientId) taMetasMap.set(latestMeta.clientId, { clientId: latestMeta.clientId, joined_at: latestMeta.joined_at || 0 });
        if (latestMeta.handling && latestMeta.clientId !== taClientId) newClaimedByOthers[latestMeta.handling] = latestMeta.name || '다른 조교';
      }
    });

    const newAssignmentMap = computeAssignment(Array.from(taMetasMap.values()), Object.keys(activeStudentsRef.current));
    setAssignmentMap(newAssignmentMap);
    setMyAssignedSeats(new Set(Object.keys(newAssignmentMap).filter(s => newAssignmentMap[s] === taClientId)));
    setClaimedByOthers(newClaimedByOthers);
    setTotalTaCount(taMetasMap.size);
    setEditorLocked(hasEditor);

    setSelectedCallKey(prevKey => {
      if (prevKey && newClaimedByOthers[prevKey]) return null;
      return prevKey;
    });
  }, [taClientId]);

  // DB(clinic_session_state)에서 오늘 좌석이 배정된 학생 목록을 가져와 activeStudentsRef를
  // 갱신한다. 기존에 진행 중이던 호출/힌트/자리비움 등의 상태(status, calls)는 그대로 보존하고,
  // 이름/반/좌석 배정 여부만 DB 기준으로 새로고침한다.
  const fetchSeatsFromDB = useCallback(async () => {
    // 💡 이전 호출이 아직 안 끝났으면 건너뛴다 — 겹쳐서 실행되면 늦게 시작한(더 오래된 DB
    // 스냅샷을 읽은) 호출이 나중에 끝나면서 activeStudentsRef를 옛 좌석으로 되돌려버릴 수 있다.
    // 다만 이 가드가 영원히 true로 고정되면(네트워크 요청이 끝내 완료도 실패도 안 하고 멈추는
    // 경우 등) 폴링이 통째로 멈춰버리므로, 정상 소요 시간을 한참 넘겼으면 스스로 풀고 진행한다.
    const STUCK_GUARD_MS = 10000;
    if (isFetchingSeatsRef.current) {
      if (Date.now() - fetchingSeatsStartedAtRef.current < STUCK_GUARD_MS) return;
      console.warn('좌석 조회가 오래 멈춰있어 강제로 다시 시도합니다.');
    }
    isFetchingSeatsRef.current = true;
    fetchingSeatsStartedAtRef.current = Date.now();
    try {
      await fetchSeatsFromDBBody();
    } catch (err) {
      console.error('좌석 조회 중 오류:', err);
    } finally {
      isFetchingSeatsRef.current = false;
    }
  }, [flushState]);

  const fetchSeatsFromDBBody = async () => {
    const todayStr = getKSTDateString();
    // 💡 [버그 수정] ended_at 필터가 없어서, 이미 끝난(종료 처리된) 세션인데도 seat 컬럼이
    // 비워지지 않은 옛 행이 있으면(경합 상황 등으로 실제 발생 가능) 그 옛 좌석이 "최신"으로
    // 잘못 뽑혀 좀비 호출/좀비 좌석으로 계속 남는 원인이 됐다. 종료되지 않은 세션만 대상으로 한다.
    const { data: sessions, error } = await supabaseClient
      .from('clinic_session_state')
      .select('id, student_id, seat, session_no, active_calls, active_rechecks, away_since')
      .eq('session_date', todayStr)
      .is('ended_at', null)
      .not('seat', 'is', null);
    if (error) return;

    // 💡 재이용으로 하루에 여러 세션이 생길 수 있으므로, 혹시 옛 세션의 seat가 아직 안 비워졌더라도
    // 학생별로 가장 최신(session_no가 큰) 세션의 좌석만 신뢰한다.
    const latestByStudent = new Map<string, any>();
    (sessions || []).filter((r: any) => r.seat).forEach((r: any) => {
      const prev = latestByStudent.get(r.student_id);
      if (!prev || (r.session_no || 1) > (prev.session_no || 1)) latestByStudent.set(r.student_id, r);
    });
    const rows = Array.from(latestByStudent.values());
    const studentIds = Array.from(new Set(rows.map((r: any) => r.student_id)));

    let nameMap: Record<string, string> = {};
    let classMap: Record<string, string[]> = {};
    if (studentIds.length > 0) {
      const [{ data: students }, { data: enrollments }] = await Promise.all([
        supabaseClient.from('student').select('student_id, name').in('student_id', studentIds),
        supabaseClient.from('enrollment').select('student_id, class(name)').in('student_id', studentIds),
      ]);
      (students || []).forEach((s: any) => { nameMap[s.student_id] = s.name; });
      (enrollments || []).forEach((e: any) => {
        const cn = e.class?.name;
        if (!cn) return;
        if (!classMap[e.student_id]) classMap[e.student_id] = [];
        classMap[e.student_id].push(cn);
      });
    }

    // 💡 [버그 수정] 좌석 이동을 studentId로 추적한다. 예전엔 prev를 "같은 좌석 키"로만 찾아서,
    // 학생 좌석이 바뀌면(수퍼바이저/조교가 옮기거나 재배정) 옛 좌석의 상태(calls 등)를 통째로
    // 잃어버렸고, 그 결과 아래 "유령 정리" 로직이 진행 중이던 호출/재확인 요청까지 조용히 지워버렸다.
    const oldSeatByStudentId: Record<string, string> = {};
    Object.keys(activeStudentsRef.current).forEach(seat => {
      const sid = activeStudentsRef.current[seat].studentId;
      if (sid) oldSeatByStudentId[sid] = seat;
    });

    const newActive: Record<string, StudentData> = {};
    rows.forEach((row: any) => {
      const oldSeat = oldSeatByStudentId[row.student_id];
      const prev = oldSeat ? activeStudentsRef.current[oldSeat] : undefined;
      const name = nameMap[row.student_id] || prev?.name || '학생';
      const classes = classMap[row.student_id] || prev?.classes || [];
      const calls = { ...(prev?.calls || {}) };
      let status = prev?.status || 'idle';

      // 💡 호출/재확인/자리비움은 broadcast 순간에 열려있던 화면에만 전달되므로, 이 화면이 방금
      // 열렸거나 그 broadcast를 놓쳤다면 DB(active_calls/active_rechecks/away_since)에서 다시
      // 읽어와 이미 진행 중인 요청을 복원한다 — 수퍼바이저 화면과 동일한 자가복구 패턴.
      const dbCalls = row.active_calls || {};
      Object.keys(dbCalls).forEach(qNumKey => {
        const key = `${row.seat}::${qNumKey}`;
        if (!callsRef.current[key]) {
          const c = dbCalls[qNumKey] || {};
          callsRef.current[key] = {
            seat: row.seat, studentId: row.student_id, qNum: qNumKey === 'general' ? ('general' as any) : Number(qNumKey),
            name, classes, questionText: c.questionText || '', imageUrl: c.imageUrl || '', options: c.options || null,
            answer: c.answer || '', explanation: c.explanation || '', source: c.source || '', calledAt: c.requestedAt || Date.now(),
          };
        }
        calls[qNumKey] = callsRef.current[key].calledAt;
        status = 'call';
      });
      // DB에서 이미 사라진 호출은 로컬에서도 정리한다(다른 화면에서 처리 완료된 경우).
      Object.keys(calls).forEach(qNumKey => {
        if (dbCalls[qNumKey]) return;
        delete calls[qNumKey];
        const key = `${row.seat}::${qNumKey}`;
        delete callsRef.current[key];
        setMarkState(p => { if (p[key] === undefined) return p; const n = { ...p }; delete n[key]; return n; });
        setSelectedCallKey(p => p === key ? null : p);
      });
      if (Object.keys(calls).length === 0 && status === 'call') status = 'idle';

      const dbRechecks = row.active_rechecks || {};
      Object.keys(dbRechecks).forEach(uid => {
        const key = `${row.seat}::${uid}`;
        if (!rechecksRef.current[key]) {
          const r = dbRechecks[uid] || {};
          rechecksRef.current[key] = {
            seat: row.seat, studentId: row.student_id, uid, qNum: r.qNum, name, classes,
            questionText: r.questionText || '', correctAnswer: r.correctAnswer || '',
            imageDataUrl: r.imageDataUrl || '', recognizedText: r.recognizedText || '',
            aiExplanation: r.aiExplanation || '', aiConfidence: r.aiConfidence ?? null,
            requestedAt: r.requestedAt || Date.now(),
          };
        }
      });
      Object.keys(rechecksRef.current).forEach(key => {
        if (rechecksRef.current[key].seat !== row.seat) return;
        const uid = rechecksRef.current[key].uid;
        if (dbRechecks[uid]) return;
        delete rechecksRef.current[key];
        setMarkState(p => { if (p[key] === undefined) return p; const n = { ...p }; delete n[key]; return n; });
        setSelectedCallKey(p => p === key ? null : p);
      });

      if (row.away_since) status = 'away';
      else if (status === 'away') status = 'idle';

      newActive[row.seat] = {
        name, classes, status, studentId: row.student_id, sessionId: row.id,
        lastUpdatedAt: Date.now(),
        calls,
        score: prev?.score,
      };
    });

    activeStudentsRef.current = newActive;

    const newSeatByStudentId: Record<string, string> = {};
    Object.keys(newActive).forEach(seat => {
      const sid = newActive[seat].studentId;
      if (sid) newSeatByStudentId[sid] = seat;
    });

    // 좌석이 바뀐 학생의 호출/재확인 요청은 studentId로 찾아 새 좌석 키로 옮겨 그대로 유지하고,
    // 정말로 좌석 자체가 사라진(=강제퇴실 등) 경우에만 정리한다.
    const migrateOrPrune = <T extends { seat: string; studentId?: string; qNum?: number; uid?: string }>(
      ref: Record<string, T>, buildKey: (seat: string, entry: T) => string
    ) => {
      Object.keys(ref).forEach(key => {
        const entry = ref[key];
        if (newActive[entry.seat]) return; // 좌석 그대로 유지 중
        const newSeat = entry.studentId ? newSeatByStudentId[entry.studentId] : undefined;
        if (newSeat) {
          const newKey = buildKey(newSeat, entry);
          delete ref[key];
          ref[newKey] = { ...entry, seat: newSeat };
          if (newKey !== key) {
            setMarkState(prev => { if (prev[key] === undefined) return prev; const n = {...prev}; n[newKey] = n[key]; delete n[key]; return n; });
            setSelectedCallKey(prev => prev === key ? newKey : prev);
          }
        } else {
          delete ref[key];
          setMarkState(prev => { const n = {...prev}; delete n[key]; return n; });
          setSelectedCallKey(prev => prev === key ? null : prev);
        }
      });
    };
    migrateOrPrune(callsRef.current, (seat, entry) => `${seat}::${entry.qNum}`);
    migrateOrPrune(rechecksRef.current, (seat, entry) => `${seat}::${entry.uid}`);

    flushState();
    syncFromPresenceRef.current();
  };

  const fetchSeatsFromDBRef = useRef(fetchSeatsFromDB);
  useEffect(() => { fetchSeatsFromDBRef.current = fetchSeatsFromDB; });

  useEffect(() => { syncFromPresenceRef.current = syncFromPresence; });

  // 💡 [버그 수정] activeStudentsRef는 3초 주기 DB 폴링(fetchSeatsFromDB)으로만 갱신되는데,
  // 예전엔 payload.seat가 그 시점에 activeStudentsRef에 없으면(막 배정된 좌석에서 곧바로
  // 호출/재확인 등을 보낸 경우 등) 액션 자체를 조용히 버렸다 — 에러도 로그도 없이 사라졌다.
  // 1) 먼저 studentId로 한 번 더 찾아본다(수퍼바이저 화면은 이미 이렇게 하고 있다).
  // 2) 그래도 못 찾으면, 폴링을 기다리지 않고 DB를 즉시 한 번 더 확인한 뒤 한 번만 재시도한다.
  const handleStudentAction = useCallback((payload: any, isRetry = false) => {
    const { seat: broadcastSeat, action, data } = payload;
    const seat = activeStudentsRef.current[broadcastSeat]
      ? broadcastSeat
      : Object.keys(activeStudentsRef.current).find(s => activeStudentsRef.current[s].studentId === data?.studentId);

    if (!seat && action !== 'depart') {
      if (isRetry) return; // 즉시 재조회까지 실패하면 포기한다(그 사이 실제로 퇴실했을 수 있음).
      fetchSeatsFromDBRef.current().then(() => handleStudentActionRef.current(payload, true));
      return;
    }

    if (action === 'depart') {
      // 💡 좌석 점유는 DB(clinic_session_state) 기준이므로, 학생이 탭을 닫아 'depart'
      // 신호가 와도 좌석 자체는 지우지 않는다(하루 종일 같은 좌석을 유지). 진행 중이던
      // 호출/자리비움 등 실시간 상태만 idle로 되돌린다. 실제 퇴실 처리는 TA/수퍼바이저의
      // 강제퇴실(DB에서 seat를 null로)을 fetchSeatsFromDB가 감지했을 때 이루어진다.
      if (activeStudentsRef.current[seat]) activeStudentsRef.current[seat].status = 'idle';
      flushState(); return;
    }

    const st = activeStudentsRef.current[seat];
    if (action === 'call') {
      if (!st.calls) st.calls = {}; st.calls[data.qNum] = Date.now(); st.status = 'call';
      callsRef.current[`${seat}::${data.qNum}`] = { seat, studentId: st.studentId, qNum: data.qNum, name: data.name, classes: st.classes || [], questionText: data.questionText || '', imageUrl: data.imageUrl || '', options: data.options || null, answer: data.answer || '', explanation: data.explanation || '', source: data.source || '', calledAt: Date.now() };
    } else if (action === 'cancel_call') {
      delete callsRef.current[`${seat}::${data.qNum}`];
      setMarkState(prev => { const n = {...prev}; delete n[`${seat}::${data.qNum}`]; return n; });
      setSelectedCallKey(prev => prev === `${seat}::${data.qNum}` ? null : prev);
      if (st.calls) delete st.calls[data.qNum];
      if (Object.keys(st.calls || {}).length === 0) st.status = 'idle';
    } else if (action === 'renumber_call') {
      const { oldQNum, newQNum } = data;
      const oldKey = `${seat}::${oldQNum}`; const newKey = `${seat}::${newQNum}`;
      if (callsRef.current[oldKey]) {
        callsRef.current[newKey] = { ...callsRef.current[oldKey], qNum: newQNum };
        delete callsRef.current[oldKey];
        setMarkState(prev => { const n = {...prev}; if(n[oldKey]!==undefined){ n[newKey]=n[oldKey]; delete n[oldKey]; } return n; });
        setSelectedCallKey(prev => prev === oldKey ? newKey : prev);
      }
      if (st.calls && st.calls[oldQNum]) { const at = st.calls[oldQNum]; delete st.calls[oldQNum]; st.calls[newQNum] = at; }
    } else if (action === 'away') { st.status = 'away'; } 
    else if (action === 'cancel_away') { st.status = 'idle'; } 
    else if (action === 'hint') {
      st.status = 'hint';
      setTimeout(() => { if (activeStudentsRef.current[seat]?.status === 'hint') { activeStudentsRef.current[seat].status = 'idle'; flushState(); } }, 10000);
    } else if (action === 'submit') { st.status = 'submitted'; st.score = data.score; }
    else if (action === 'recheck_request') {
      rechecksRef.current[`${seat}::${data.uid}`] = {
        seat, studentId: st.studentId, uid: data.uid, qNum: data.qNum, name: data.name, classes: st.classes || [],
        questionText: data.questionText || '', correctAnswer: data.correctAnswer || '',
        imageDataUrl: data.imageDataUrl || '', recognizedText: data.recognizedText || '',
        aiExplanation: data.aiExplanation || '', aiConfidence: data.aiConfidence ?? null,
        requestedAt: Date.now(),
      };
    }
    flushState();
  }, [flushState]);

  const handleTaActionFromOtherScreen = useCallback((payload: any) => {
    const { seat, action, qNum } = payload;
    if (action === 'force_cancel_call' && qNum !== null && qNum !== undefined) {
      const key = `${seat}::${qNum}`;
      delete callsRef.current[key];
      setMarkState(prev => { const n = {...prev}; delete n[key]; return n; });
      setSelectedCallKey(prev => prev === key ? null : prev);
      if (activeStudentsRef.current[seat]?.calls) delete activeStudentsRef.current[seat].calls![qNum];
      if (Object.keys(activeStudentsRef.current[seat]?.calls || {}).length === 0) activeStudentsRef.current[seat].status = 'idle';
      flushState();
    } else if (action === 'force_checkout') {
      // 💡 [버그 수정] callsRef만 정리하고 rechecksRef는 안 지웠었다 — 다른 화면(수퍼바이저 등)에서
      // 강제퇴실시키면 이미 사라진 학생의 재확인 요청이 조교 Pad 목록에 고아 상태로 계속 남아있었다.
      Object.keys(callsRef.current).forEach(key => {
        if (callsRef.current[key].seat === seat) { delete callsRef.current[key]; setMarkState(prev=>{const n={...prev}; delete n[key]; return n;}); setSelectedCallKey(prev=>prev===key?null:prev); }
      });
      Object.keys(rechecksRef.current).forEach(key => {
        if (rechecksRef.current[key].seat === seat) { delete rechecksRef.current[key]; setMarkState(prev=>{const n={...prev}; delete n[key]; return n;}); setSelectedCallKey(prev=>prev===key?null:prev); }
      });
      delete activeStudentsRef.current[seat];
      flushState();
    } else if (action === 'force_return_to_seat') {
      if (activeStudentsRef.current[seat]) activeStudentsRef.current[seat].status = 'idle';
      flushState();
    } else if (action === 'resolve_recheck') {
      const { uid } = payload;
      const key = `${seat}::${uid}`;
      if (rechecksRef.current[key]) {
        delete rechecksRef.current[key];
        setSelectedCallKey(prev => prev === key ? null : prev);
        setMarkState(prev => { const n = {...prev}; delete n[key]; return n; });
        flushState();
      }
    }
  }, [flushState]);

  // connectClinicChannel이 이름 변경 등으로 여러 번 호출될 수 있으므로, 그때마다 등록되는
  // .on() 콜백도 항상 최신 handleStudentAction/handleTaActionFromOtherScreen을 참조하도록 ref로 감싼다.
  const handleStudentActionRef = useRef(handleStudentAction);
  useEffect(() => { handleStudentActionRef.current = handleStudentAction; });
  const handleTaActionFromOtherScreenRef = useRef(handleTaActionFromOtherScreen);
  useEffect(() => { handleTaActionFromOtherScreenRef.current = handleTaActionFromOtherScreen; });

  const loadAllSeats = useCallback(() => {
    getActiveSeatLayout().then(layout => {
      const sorted = [...layout.seats].sort((a, b) => a.number - b.number);
      setAllSeats(sorted.map(s => String(s.number)));
      setAllSeatObjs(sorted);
      setCanvasWidth(layout.canvasWidth);
      setCanvasHeight(layout.canvasHeight);
      setSeatWidth(layout.seatWidth);
      setSeatHeight(layout.seatHeight);
    });
  }, []);

  useEffect(() => { loadAllSeats(); }, [loadAllSeats]);

  const connectClinicChannel = async () => {
    // 💡 이름 변경(연필 아이콘) 등으로 이 함수가 재호출될 때, 이전 채널을 unsubscribe()만 하고
    // 바로 새 채널을 만들면 supabase-js가 "아직 목록에서 안 지워진, 이미 subscribe된" 옛 채널
    // 객체를 그대로 재사용해서 .on() 추가 시 에러가 난다(포털→뷰어 전환에서 겪은 것과 동일 버그).
    // removeChannel이 완전히 끝나길 기다린 뒤에 새 채널을 만든다.
    if (clinicChannelRef.current) {
      await supabaseClient.removeChannel(clinicChannelRef.current);
      clinicChannelRef.current = null;
    }
    clinicChannelRef.current = supabaseClient.channel(CLINIC_ROOM);
    clinicChannelRef.current
      .on('presence', { event: 'sync' }, () => syncFromPresenceRef.current())
      .on('broadcast', { event: 'student_action' }, ({ payload }: any) => handleStudentActionRef.current(payload))
      .on('broadcast', { event: 'ta_action' }, ({ payload }: any) => handleTaActionFromOtherScreenRef.current(payload))
      .on('broadcast', { event: SEAT_LAYOUT_UPDATED_EVENT }, () => loadAllSeats())
      .subscribe((status: string) => {
        setIsConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') updateHandlingPresence(selectedCallKey);
      });
  };

  // ==========================================
  // 노출할 액션 함수들
  // ==========================================
  const commitTaName = () => {
    const val = tempNameInput.trim();
    if (!val) return;
    setTaName(val);
    localStorage.setItem(TA_NAME_STORAGE_KEY, val);
    setNameModalOpen(false);
    setIsFirstTime(false);
  };

  const handleConfirmCall = () => {
    if (!selectedCallKey || !markState[selectedCallKey]) return;
    const c = callsSnapshot[selectedCallKey];
    if (!c) return;
    sendToStudent(c.seat, 'force_cancel_call', { qNum: Number(c.qNum), mark: markState[selectedCallKey], taName: taName });

    const sid = activeStudentsRef.current[c.seat]?.sessionId;
    if (sid) clearActiveCall(supabaseClient, sid, c.qNum);

    delete callsRef.current[selectedCallKey];
    setMarkState(prev => { const n = {...prev}; delete n[selectedCallKey]; return n; });
    setSelectedCallKey(null);
    updateHandlingPresence(null);

    if (activeStudentsRef.current[c.seat]?.calls) delete activeStudentsRef.current[c.seat].calls![c.qNum];
    if (Object.keys(activeStudentsRef.current[c.seat]?.calls || {}).length === 0) activeStudentsRef.current[c.seat].status = 'idle';
    flushState();
  };

  const handleConfirmRecheck = (verdict: 'correct' | 'incorrect') => {
    if (!selectedCallKey) return;
    const r = rechecksRef.current[selectedCallKey];
    if (!r) return;
    sendToStudent(r.seat, 'resolve_recheck', { uid: r.uid, verdict });

    const sid = activeStudentsRef.current[r.seat]?.sessionId;
    if (sid) clearActiveRecheck(supabaseClient, sid, r.uid);

    delete rechecksRef.current[selectedCallKey];
    setMarkState(prev => { const n = {...prev}; delete n[selectedCallKey]; return n; });
    setSelectedCallKey(null);
    updateHandlingPresence(null);
    flushState();
  };

  const handleExit = () => {
    if (clinicChannelRef.current) clinicChannelRef.current.untrack();
    localStorage.removeItem(TA_CLIENT_ID_STORAGE_KEY);
    alert('근무가 종료되었습니다. (목업 - 실제 이동 없음)');
    setExitModalOpen(false);
  };

  return {
    taName, taClientId, isConnected, gridSnapshot, callsSnapshot, rechecksSnapshot,
    myAssignedSeats, assignmentMap, claimedByOthers, totalTaCount,
    selectedCallKey, setSelectedCallKey, markState, setMarkState,
    nameModalOpen, setNameModalOpen,
    isFirstTime, setIsFirstTime, tempNameInput, setTempNameInput,
    exitModalOpen, setExitModalOpen,
    commitTaName, handleConfirmCall, handleConfirmRecheck, handleExit, formatElapsed, updateHandlingPresence,
    allSeats, allSeatObjs, canvasWidth, canvasHeight, seatWidth, seatHeight, editorLocked,
  };
}