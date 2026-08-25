// src/app/clinic/ta/pad/useTaHandheld.ts
import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { clearActiveCall, clearActiveRecheck } from "@/lib/clinicSession";
import { seedTaTenantId, getInstructorName } from "../taAccess";
import { getActiveSeatLayout } from "@/app/actions/clinicSeatLayout";
import { SEAT_LAYOUT_UPDATED_EVENT, formatSeatLabel, Seat, DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, DEFAULT_SEAT_CARD_W, DEFAULT_SEAT_CARD_H } from "@/lib/clinicSeatLayout";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const CLINIC_ROOM = "logica-clinic-room";

export const formatSeat = formatSeatLabel;

const SEAT_POLL_INTERVAL_MS = 3000;
const getKSTDateString = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
const TA_NAME_STORAGE_KEY = 'logica_ta_name';
const TA_CLIENT_ID_STORAGE_KEY = 'logica_ta_client_id';

export type StudentStatus = "idle" | "call" | "hint" | "away" | "submitted";

export interface StudentData {
  name: string; classes: string[]; status: StudentStatus; studentId?: string; sessionId?: string;
  lastUpdatedAt: number; missingSince?: number | null; calls?: Record<string, number>; score?: number;
}

export interface CallData {
  seat: string; studentId?: string; qNum: number; name: string; classes: string[];
  questionText: string; imageUrl: string; options: string[] | null; answer: string; explanation: string; source: string; calledAt: number;
}

export interface RecheckData {
  seat: string; studentId?: string; uid: string; qNum: number; name: string; classes: string[];
  questionText: string; correctAnswer: string; imageDataUrl: string; recognizedText: string; aiExplanation: string; aiConfidence: number | null; requestedAt: number;
}

const getSupabaseClient = () => {
    if (typeof window === 'undefined') return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (!(window as any)._supabaseInstance) (window as any)._supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return (window as any)._supabaseInstance;
};
const supabaseClient = getSupabaseClient();

export function useTaHandheld() {
  const [taName, setTaName] = useState<string>("");
  const [taClientId, setTaClientId] = useState<string>("");
  const [taJoinedAt, setTaJoinedAt] = useState<number>(0);
  
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
  
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  const [selectedCallKey, setSelectedCallKey] = useState<string | null>(null);
  const [markState, setMarkState] = useState<Record<string, 'hint' | 'skip' | null>>({});

  const activeStudentsRef = useRef<Record<string, StudentData>>({});
  const callsRef = useRef<Record<string, CallData>>({});
  const rechecksRef = useRef<Record<string, RecheckData>>({});
  const clinicChannelRef = useRef<any>(null);
  const connectChainRef = useRef<Promise<void>>(Promise.resolve());
  const isFetchingSeatsRef = useRef(false);
  const fetchingSeatsStartedAtRef = useRef(0);
  const allSeatObjsRef = useRef<Seat[]>([]);
  const prevAssignmentRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let savedName = localStorage.getItem(TA_NAME_STORAGE_KEY) || "";
    let savedClientId = localStorage.getItem(TA_CLIENT_ID_STORAGE_KEY);

    if (!savedClientId) {
      savedClientId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(TA_CLIENT_ID_STORAGE_KEY, savedClientId);
    }

    setTaClientId(savedClientId);
    setTaJoinedAt(Date.now());

    // 💡 이름을 따로 물어보지 않는다 — 강사 로그인 시 저장된 실명을 그대로 쓴다.
    if (!savedName) savedName = getInstructorName();

    if (savedName) {
      localStorage.setItem(TA_NAME_STORAGE_KEY, savedName);
      seedTaTenantId();
      setTaName(savedName);
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
    return () => {
      if (clinicChannelRef.current) {
        supabaseClient.removeChannel(clinicChannelRef.current);
        clinicChannelRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taName, taClientId]);

  useEffect(() => {
    const tickInterval = setInterval(() => setCurrentTime(Date.now()), 1000);
    const presenceInterval = setInterval(() => { if (clinicChannelRef.current) syncFromPresenceRef.current(); }, 2000);

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

  const syncFromPresenceRef = useRef<() => void>(() => {});

  const spatialPartition = (seats: Seat[], k: number): Seat[][] => {
    if (k <= 1) return [seats];
    if (seats.length === 0) return Array.from({ length: k }, () => []);
    const left = Math.floor(k / 2), right = k - left;
    const xs = seats.map(s => s.x), ys = seats.map(s => s.y);
    const spreadX = Math.max(...xs) - Math.min(...xs);
    const spreadY = Math.max(...ys) - Math.min(...ys);
    const axis: 'x' | 'y' = spreadX >= spreadY ? 'x' : 'y';
    const sorted = [...seats].sort((a, b) => a[axis] - b[axis]);
    const cut = Math.round(sorted.length * left / k);
    return [...spatialPartition(sorted.slice(0, cut), left), ...spatialPartition(sorted.slice(cut), right)];
  };

  const computeAssignment = (taMetas: any[], occupiedSeats: string[]) => {
    const tas = [...taMetas].sort((a, b) => (a.joined_at - b.joined_at) || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));
    const N = tas.length;
    if (N === 0 || occupiedSeats.length === 0) { prevAssignmentRef.current = {}; return {}; }

    const seatByNumber = new Map(allSeatObjsRef.current.map(s => [String(s.number), s] as const));
    const seatObj = (num: string): Seat => seatByNumber.get(num) || { id: num, number: Number(num), x: Number(num), y: 0 };

    const activeIds = new Set(tas.map(t => t.clientId));
    const occupiedSet = new Set(occupiedSeats);

    const sticky: Record<string, string> = {};
    Object.entries(prevAssignmentRef.current).forEach(([seat, taId]) => {
      if (occupiedSet.has(seat) && activeIds.has(taId)) sticky[seat] = taId;
    });

    let map: Record<string, string>;
    if (Object.keys(sticky).length === 0) {
      map = {};
      const groups = spatialPartition(occupiedSeats.map(seatObj), N);
      tas.forEach((ta, i) => { (groups[i] || []).forEach(s => { map[String(s.number)] = ta.clientId; }); });
    } else {
      map = { ...sticky };
      const centroidOf = (taId: string) => {
        const seats = Object.keys(map).filter(s => map[s] === taId).map(seatObj);
        if (seats.length === 0) return null;
        return { x: seats.reduce((a, s) => a + s.x, 0) / seats.length, y: seats.reduce((a, s) => a + s.y, 0) / seats.length };
      };
      const leftover = occupiedSeats.filter(s => !map[s]).map(seatObj);
      const overallCentroid = leftover.length === 0
        ? { x: 0, y: 0 }
        : { x: leftover.reduce((a, s) => a + s.x, 0) / leftover.length, y: leftover.reduce((a, s) => a + s.y, 0) / leftover.length };

      leftover.forEach(s => {
        let bestTa = tas[0].clientId, bestDist = Infinity;
        tas.forEach(ta => {
          const c = centroidOf(ta.clientId) || overallCentroid;
          const d = (c.x - s.x) ** 2 + (c.y - s.y) ** 2;
          if (d < bestDist) { bestDist = d; bestTa = ta.clientId; }
        });
        map[String(s.number)] = bestTa;
      });

      let guard = 0;
      while (guard++ < occupiedSeats.length * N) {
        const counts = new Map(tas.map(t => [t.clientId, 0]));
        Object.values(map).forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
        let maxTa = tas[0].clientId, maxCount = -Infinity, minTa = tas[0].clientId, minCount = Infinity;
        tas.forEach(t => {
          const c = counts.get(t.clientId) || 0;
          if (c > maxCount) { maxCount = c; maxTa = t.clientId; }
          if (c < minCount) { minCount = c; minTa = t.clientId; }
        });
        if (maxCount - minCount <= 1) break;

        const minCentroid = centroidOf(minTa) || overallCentroid;
        const candidates = Object.keys(map).filter(s => map[s] === maxTa).map(seatObj)
          .sort((a, b) => ((a.x - minCentroid.x) ** 2 + (a.y - minCentroid.y) ** 2) - ((b.x - minCentroid.x) ** 2 + (b.y - minCentroid.y) ** 2));
        if (candidates.length === 0) break;
        map[String(candidates[0].number)] = minTa;
      }
    }

    prevAssignmentRef.current = map;
    return map;
  };

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

  const fetchSeatsFromDB = useCallback(async () => {
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
    const { data: sessions, error } = await supabaseClient
      .from('clinic_session_state')
      .select('id, student_id, seat, session_no, active_calls, active_rechecks, away_since')
      .eq('session_date', todayStr)
      .is('ended_at', null)
      .not('seat', 'is', null);
    if (error) return;

    // 💡 clinic_session_state에는 tenant_id 컬럼이 없어 지점으로 직접 필터링할 수 없다. 대신 이미
    // 지점별로 로드해둔 좌석 배치(allSeatObjsRef)에 실제로 존재하는 좌석 번호로만 좁혀서, 다른 지점의
    // 활성 세션이 우리 지점 몫으로 섞여 들어와 담당 배정되는 걸 막는다. 좌석 배치가 아예 없는 본사
    // 계정(tenant_id가 UUID가 아님 → getActiveSeatLayout이 빈 배치 반환)은 이 필터로 자연히 0명이 된다.
    const knownSeats = new Set(allSeatObjsRef.current.map(s => String(s.number)));
    const latestByStudent = new Map<string, any>();
    (sessions || []).filter((r: any) => r.seat && knownSeats.has(String(r.seat))).forEach((r: any) => {
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

    const migrateOrPrune = <T extends { seat: string; studentId?: string; qNum?: number; uid?: string }>(
      ref: Record<string, T>, buildKey: (seat: string, entry: T) => string
    ) => {
      Object.keys(ref).forEach(key => {
        const entry = ref[key];
        if (newActive[entry.seat]) return; 
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

  const handleStudentAction = useCallback((payload: any, isRetry = false) => {
    const { seat: broadcastSeat, action, data } = payload;
    const seat = activeStudentsRef.current[broadcastSeat]
      ? broadcastSeat
      : Object.keys(activeStudentsRef.current).find(s => activeStudentsRef.current[s].studentId === data?.studentId);

    if (!seat && action !== 'depart') {
      if (isRetry) return; 
      fetchSeatsFromDBRef.current().then(() => handleStudentActionRef.current(payload, true));
      return;
    }

    if (action === 'depart') {
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

  const handleStudentActionRef = useRef(handleStudentAction);
  useEffect(() => { handleStudentActionRef.current = handleStudentAction; });
  const handleTaActionFromOtherScreenRef = useRef(handleTaActionFromOtherScreen);
  useEffect(() => { handleTaActionFromOtherScreenRef.current = handleTaActionFromOtherScreen; });

  const loadAllSeats = useCallback(() => {
    const myTenantId = localStorage.getItem("logica_tenant_id") || "hq";
    getActiveSeatLayout(myTenantId).then(layout => {
      const sorted = [...layout.seats].sort((a, b) => a.number - b.number);
      setAllSeats(sorted.map(s => String(s.number)));
      setAllSeatObjs(sorted);
      allSeatObjsRef.current = sorted;
      prevAssignmentRef.current = {};
      setCanvasWidth(layout.canvasWidth);
      setCanvasHeight(layout.canvasHeight);
      setSeatWidth(layout.seatWidth);
      setSeatHeight(layout.seatHeight);
    });
  }, []);

  useEffect(() => { loadAllSeats(); }, [loadAllSeats]);

  const connectClinicChannel = () => {
    connectChainRef.current = connectChainRef.current.then(async () => {
      if (clinicChannelRef.current) {
        await supabaseClient.removeChannel(clinicChannelRef.current);
        clinicChannelRef.current = null;
      }
      
      // 🌟 [보안 패치 유지] 조교(TA)도 소속 지점의 클리닉 방으로 연결
      const myTenantId = localStorage.getItem("logica_tenant_id") || "hq";
      const channelName = `${CLINIC_ROOM}_${myTenantId}`;
      
      clinicChannelRef.current = supabaseClient.channel(channelName);
      clinicChannelRef.current
        .on('presence', { event: 'sync' }, () => syncFromPresenceRef.current())
        .on('broadcast', { event: 'student_action' }, ({ payload }: any) => handleStudentActionRef.current(payload))
        .on('broadcast', { event: 'ta_action' }, ({ payload }: any) => handleTaActionFromOtherScreenRef.current(payload))
        .on('broadcast', { event: SEAT_LAYOUT_UPDATED_EVENT }, () => loadAllSeats())
        .subscribe((status: string) => {
          setIsConnected(status === 'SUBSCRIBED');
          if (status === 'SUBSCRIBED') updateHandlingPresence(selectedCallKey);
        });
    }).catch(err => console.error('클리닉 채널 연결 오류:', err));
  };

  const handleConfirmCall = () => {
    if (!selectedCallKey || !markState[selectedCallKey]) return;
    const c = callsSnapshot[selectedCallKey];
    if (!c) return;
    // 💡 일반 호출(포털에서 누른 호출)은 qNum이 숫자가 아니라 문자열 'general'이다. 여기서 Number()로
    // 캐스팅하면 NaN이 되어, 이 broadcast를 받는 다른 조교 패드/감독관 화면의 로컬 상태 키('general')와
    // 안 맞아서 그 화면에서는 호출 표시가 즉시 안 지워진다(다음 DB 폴링 때야 뒤늦게 정리됨).
    sendToStudent(c.seat, 'force_cancel_call', { qNum: c.qNum, mark: markState[selectedCallKey], taName: taName });

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

  return {
    taName, taClientId, isConnected, gridSnapshot, callsSnapshot, rechecksSnapshot,
    myAssignedSeats, assignmentMap, claimedByOthers, totalTaCount,
    selectedCallKey, setSelectedCallKey, markState, setMarkState,
    handleConfirmCall, handleConfirmRecheck, formatElapsed, updateHandlingPresence,
    allSeats, allSeatObjs, canvasWidth, canvasHeight, seatWidth, seatHeight, editorLocked,
  };
}