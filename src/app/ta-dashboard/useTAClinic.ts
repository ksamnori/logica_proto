// src/app/ta-dashboard/useTAClinic.ts
import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ==========================================
// 상수 및 환경 설정 (보안 강화)
// ==========================================
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
// 💡 보안: 하드코딩된 토큰 삭제. 반드시 환경변수(.env.local)에 값을 넣고 사용하세요.
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const CLINIC_ROOM = "logica-clinic-room";

const SEAT_ROWS = ["A", "B", "C", "D", "E", "F"];
const SEAT_COLS = 10;
export const SEATS = SEAT_ROWS.flatMap(r => Array.from({ length: SEAT_COLS }, (_, i) => `${r}-${String(i + 1).padStart(2, "0")}`));

const LOG_AUTO_EXPIRE_MS = 5 * 60 * 1000;
const PENDING_GUARD_MS = 8000;
const GHOST_DEPARTURE_GRACE_MS = 5000;

// ==========================================
// 타입 정의
// ==========================================
export type StudentStatus = "idle" | "call" | "hint" | "away" | "submitted";

export interface StudentData {
  name: string;
  classes: string[];
  status: StudentStatus;
  activity?: string;
  studentId?: string;
  lastUpdatedAt: number;
  missingSince?: number | null;
  calls?: Record<string, number>;
  score?: number;
  rechecks?: Record<string, any>;
}

export interface LogEntry {
  id: string;
  time: string;
  borderClass: string;
  badgeBg: string;
  badgeText: string;
  title: string;
  subtitle: string;
  seat?: string;
  actionType?: "cancel_call";
  qNum?: number;
}

export function useTAClinic() {
  // === UI 상태 ===
  const [isConnected, setIsConnected] = useState(false);
  const [taCount, setTaCount] = useState(0);
  const [taNames, setTaNames] = useState<string[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [vacantCount, setVacantCount] = useState(60);
  const [gridSnapshot, setGridSnapshot] = useState<Record<string, StudentData>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [recheckModal, setRecheckModal] = useState<any>(null);

  // === D&D 상태 ===
  const [draggedSeat, setDraggedSeat] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // === 실시간 동기화용 Refs ===
  const activeStudents = useRef<Record<string, StudentData>>({});
  const deadZombies = useRef<Record<string, number>>({});
  const seatOverrides = useRef<Record<string, { newSeat: string; timestamp: number }>>({});
  const pendingMoves = useRef<Record<string, { newSeat: string; expiresAt: number }>>({});
  const pendingDeletes = useRef<Record<string, number>>({});
  const clinicChannel = useRef<any>(null);
  const logIdCounter = useRef(0);
  const guardRecheckInterval = useRef<NodeJS.Timeout | null>(null);

  // === 유틸리티 함수 ===
  const flushGridToState = useCallback(() => {
    setGridSnapshot(JSON.parse(JSON.stringify(activeStudents.current)));
    const sCount = Object.keys(activeStudents.current).length;
    setStudentCount(sCount);
    setVacantCount(Math.max(0, 60 - sCount));
  }, []);

  const addLog = useCallback((log: Omit<LogEntry, "id" | "time">, expireMs: number | null = null) => {
    const id = `log-${++logIdCounter.current}`;
    const time = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [{ ...log, id, time }, ...prev]);
    if (expireMs) setTimeout(() => setLogs(prev => prev.filter(l => l.id !== id)), expireMs);
    return id;
  }, []);

  const removeLogBySeatAndType = useCallback((seat: string, actionType: string, qNum?: number) => {
    setLogs(prev => prev.filter(l => !(l.seat === seat && l.actionType === actionType && (qNum === undefined || l.qNum === qNum))));
  }, []);

  const transferLogs = useCallback((oldSeat: string, newSeat: string) => {
    setLogs(prev => prev.map(log => log.seat === oldSeat ? { ...log, seat: newSeat, title: log.title.replace(`[${oldSeat}]`, `[${newSeat}]`) } : log));
  }, []);

  const sendToStudent = useCallback((seat: string, action: string, extra: any = {}) => {
    if (clinicChannel.current) {
      clinicChannel.current.send({ type: 'broadcast', event: 'ta_action', payload: { seat, action, ...extra, timestamp: Date.now() } });
    }
  }, []);

  const scheduleGuardRecheck = useCallback(() => {
    if (guardRecheckInterval.current) return;
    guardRecheckInterval.current = setInterval(() => {
      if (Object.keys(pendingMoves.current).length === 0 && Object.keys(pendingDeletes.current).length === 0) {
        if (guardRecheckInterval.current) clearInterval(guardRecheckInterval.current);
        guardRecheckInterval.current = null;
        return;
      }
      syncActiveStudentsFromPresence();
    }, 1000);
  }, []);

  // === 좌석 이동 로직 ===
  const moveStudentSeat = useCallback((oldSeat: string, newSeat: string) => {
    if (!activeStudents.current[oldSeat] || oldSeat === newSeat) return;
    if (activeStudents.current[newSeat]) {
      alert("이미 다른 학생이 있는 자리로는 옮길 수 없어요. 빈 자리로만 옮겨주세요.");
      return;
    }

    const student = activeStudents.current[oldSeat];
    const sName = student.name || '학생';
    const identifier = student.studentId || student.name;

    sendToStudent(oldSeat, 'move_seat', { newSeat });
    activeStudents.current[newSeat] = { ...activeStudents.current[oldSeat] };
    delete activeStudents.current[oldSeat];
    transferLogs(oldSeat, newSeat);

    if (identifier) seatOverrides.current[identifier] = { newSeat, timestamp: Date.now() };
    pendingMoves.current[oldSeat] = { newSeat, expiresAt: Date.now() + 3000 };

    addLog({
      borderClass: 'border-indigo-500', badgeBg: 'bg-indigo-100 text-indigo-700',
      badgeText: '좌석이동', title: `[${oldSeat} → ${newSeat}] ${sName} 좌석 변경`,
      subtitle: `조교가 ${sName} 학생의 좌석을 옮겼습니다.`, seat: newSeat
    }, LOG_AUTO_EXPIRE_MS);

    flushGridToState();
  }, [addLog, flushGridToState, sendToStudent, transferLogs]);

  // === Supabase Realtime 통신 로직 ===
  const syncActiveStudentsFromPresence = useCallback(() => {
    if (!clinicChannel.current) return;
    const state = clinicChannel.current.presenceState();
    const presentSeats: Record<string, any> = {};
    const seatBestUpdatedAt: Record<string, number> = {};
    const taClientIdSet = new Set<string>();
    const currentTaNames: string[] = [];

    Object.values(state).forEach((metas) => {
      let latestMeta: any = null;
      (metas as any[]).forEach(meta => { if (!latestMeta || (meta.updatedAt || 0) > (latestMeta.updatedAt || 0)) latestMeta = meta; });
      if (!latestMeta) return;

      const candidateUpdatedAt = latestMeta.updatedAt || 0;
      const identifier = latestMeta.studentId || latestMeta.name;
      
      if (identifier && deadZombies.current[identifier] && candidateUpdatedAt <= deadZombies.current[identifier]) return; 

      let actualSeat = latestMeta.seat;
      if (identifier && seatOverrides.current[identifier]) {
        if (latestMeta.seat === seatOverrides.current[identifier].newSeat && candidateUpdatedAt > seatOverrides.current[identifier].timestamp) {
          delete seatOverrides.current[identifier];
        } else {
          actualSeat = seatOverrides.current[identifier].newSeat;
        }
      }
      
      if (actualSeat) {
        if (seatBestUpdatedAt[actualSeat] === undefined || candidateUpdatedAt > seatBestUpdatedAt[actualSeat]) {
          seatBestUpdatedAt[actualSeat] = candidateUpdatedAt;
          presentSeats[actualSeat] = { 
            name: latestMeta.name, classes: latestMeta.classes || [], activity: latestMeta.activity || null, 
            studentId: latestMeta.studentId || null, lastUpdatedAt: candidateUpdatedAt 
          };
        }
      }
      if (latestMeta.role === 'ta') {
        const dedupeKey = latestMeta.clientId || `${latestMeta.name || '이름미상'}_(clientId없음)`;
        if (!taClientIdSet.has(dedupeKey)) {
          taClientIdSet.add(dedupeKey);
          currentTaNames.push(latestMeta.name || '이름 미상');
        }
      }
    });

    setTaCount(taClientIdSet.size);
    setTaNames(currentTaNames);

    const seatByStudentId: Record<string, string> = {};
    Object.entries(presentSeats).forEach(([seat, info]) => {
      const identifier = info.studentId || info.name;
      if (!identifier) return; 
      const existing = seatByStudentId[identifier];
      if (!existing || (seatBestUpdatedAt[seat] || 0) > (seatBestUpdatedAt[existing] || 0)) seatByStudentId[identifier] = seat;
    });
    Object.entries(presentSeats).forEach(([seat, info]) => {
      const identifier = info.studentId || info.name;
      if (identifier && seatByStudentId[identifier] !== seat) delete presentSeats[seat];
    });

    Object.keys(presentSeats).forEach(seat => {
      if (!activeStudents.current[seat]) {
        activeStudents.current[seat] = { 
          name: presentSeats[seat].name, classes: presentSeats[seat].classes, status: 'idle', 
          activity: presentSeats[seat].activity, studentId: presentSeats[seat].studentId, lastUpdatedAt: presentSeats[seat].lastUpdatedAt
        };
      } else {
        Object.assign(activeStudents.current[seat], {
          name: presentSeats[seat].name, classes: presentSeats[seat].classes, activity: presentSeats[seat].activity, lastUpdatedAt: presentSeats[seat].lastUpdatedAt
        });
        if (presentSeats[seat].studentId) activeStudents.current[seat].studentId = presentSeats[seat].studentId;
        if (activeStudents.current[seat].missingSince) activeStudents.current[seat].missingSince = null;
      }
    });

    Object.entries(presentSeats).forEach(([newSeat, info]) => {
      if (info.dummy) return;
      const identifier = info.studentId || info.name;
      if (!identifier) return;

      const oldSeat = Object.keys(activeStudents.current).find(seat => seat !== newSeat && (activeStudents.current[seat].studentId || activeStudents.current[seat].name) === identifier);
      if (oldSeat) {
        activeStudents.current[newSeat] = { ...activeStudents.current[oldSeat], name: info.name, classes: info.classes, activity: info.activity, studentId: info.studentId, lastUpdatedAt: info.lastUpdatedAt };
        delete activeStudents.current[oldSeat];
        transferLogs(oldSeat, newSeat);
      }
    });

    const nowForDeletes = Date.now();
    Object.keys(pendingDeletes.current).forEach(seat => {
      if (!presentSeats[seat] || nowForDeletes > pendingDeletes.current[seat]) delete pendingDeletes.current[seat];
      else delete presentSeats[seat];
    });

    Object.keys(activeStudents.current).forEach(seat => {
      if (!presentSeats[seat] && !pendingMoves.current[seat] && !pendingDeletes.current[seat]) {
        const st = activeStudents.current[seat];
        if (!st.missingSince) { st.missingSince = Date.now(); return; }
        if (Date.now() - st.missingSince < GHOST_DEPARTURE_GRACE_MS) return;

        if (st) {
          const identifier = st.studentId || st.name;
          if (identifier) deadZombies.current[identifier] = st.lastUpdatedAt || Date.now();
        }

        addLog({
          borderClass: 'border-slate-800', badgeBg: 'bg-slate-900 text-white',
          badgeText: '퇴실/이탈', title: `[${seat}] ${st?.name || '학생'} 연결 종료`,
          subtitle: `학생이 화면을 닫거나 완전히 로그아웃했습니다.`, seat
        }, LOG_AUTO_EXPIRE_MS);
        delete activeStudents.current[seat];
      }
    });

    flushGridToState();
  }, [addLog, flushGridToState, transferLogs]);

  const handleStudentAction = useCallback((payload: any) => {
    const { seat, action, data } = payload;
    if (action === 'depart') {
      const identifier = data.studentId || data.name;
      let targetSeats = [seat];
      if (identifier) {
        const foundSeats = Object.keys(activeStudents.current).filter(s => activeStudents.current[s].studentId === identifier || activeStudents.current[s].name === identifier || s === seat);
        if (foundSeats.length > 0) targetSeats = foundSeats;
      }

      targetSeats.forEach(targetSeat => {
        const st = activeStudents.current[targetSeat];
        if (st) {
          if (identifier) deadZombies.current[identifier] = st.lastUpdatedAt || Date.now();
          addLog({
            borderClass: 'border-slate-800', badgeBg: 'bg-slate-900 text-white', badgeText: '퇴실완료', 
            title: `[${targetSeat}] ${data.name || '학생'} 정상 로그아웃`, subtitle: `학생이 화면을 닫거나 로그아웃했습니다.`, seat: targetSeat
          }, LOG_AUTO_EXPIRE_MS);
          delete activeStudents.current[targetSeat];
        }
      });
      flushGridToState();
      return;
    }

    if (!activeStudents.current[seat]) return;
    const st = activeStudents.current[seat];

    if (action === 'call') {
      if (!st.calls) st.calls = {};
      st.calls[data.qNum] = Date.now(); st.status = 'call';
      addLog({
        borderClass: 'border-rose-500', badgeBg: 'bg-rose-100 text-rose-600', badgeText: '질문호출', 
        title: `[${seat}] ${data.name} 질문 요청`, subtitle: `${data.qNum}번 문항 관련 대면 설명 유도를 진행 중입니다.`, seat, actionType: 'cancel_call', qNum: data.qNum
      });
    } else if (action === 'cancel_call') {
      if (st.calls) delete st.calls[data.qNum];
      if (Object.keys(st.calls || {}).length === 0) st.status = 'idle';
      removeLogBySeatAndType(seat, 'cancel_call', data.qNum);
      addLog({ borderClass: 'border-slate-400', badgeBg: 'bg-slate-100 text-slate-600', badgeText: '호출취소', title: `[${seat}] ${data.name} 호출 취소`, subtitle: `${data.qNum}번 문항 호출을 학생이 직접 취소했습니다.` }, LOG_AUTO_EXPIRE_MS);
    } else if (action === 'away') {
      st.status = 'away';
      addLog({ borderClass: 'border-amber-500', badgeBg: 'bg-amber-100 text-amber-700', badgeText: '자리비움', title: `[${seat}] ${data.name} 자리비움`, subtitle: `학생이 잠시 자리를 비웠습니다.`, seat });
    } else if (action === 'cancel_away') {
      st.status = 'idle';
      addLog({ borderClass: 'border-slate-400', badgeBg: 'bg-slate-100 text-slate-600', badgeText: '복귀', title: `[${seat}] ${data.name} 자리 복귀`, subtitle: `학생이 자리로 돌아왔습니다.`, seat }, LOG_AUTO_EXPIRE_MS);
    } else if (action === 'hint') {
      st.status = 'hint';
      addLog({ borderClass: 'border-yellow-400', badgeBg: 'bg-yellow-100 text-yellow-700', badgeText: '힌트열람', title: `[${seat}] ${data.name} 힌트 확인`, subtitle: `${data.qNum}번 문항 [${data.level}단계] 힌트 열람 완료.`, seat }, LOG_AUTO_EXPIRE_MS);
      setTimeout(() => { if (activeStudents.current[seat]?.status === 'hint') { activeStudents.current[seat].status = 'idle'; flushGridToState(); } }, 10000);
    } else if (action === 'submit') {
      st.status = 'submitted'; st.score = data.score;
      addLog({ borderClass: 'border-blue-500', badgeBg: 'bg-blue-100 text-blue-600', badgeText: '답안제출', title: `[${seat}] ${data.name} 정답 제출`, subtitle: `최종 채점 점수 [${data.score} / 5]. 조교 확인 후 최종 퇴실 가용 상태입니다.`, seat });
    } else if (action === 'recheck_request') {
      if (!st.rechecks) st.rechecks = {};
      st.rechecks[data.uid] = { ...data, seat };
      addLog({ borderClass: 'border-indigo-500', badgeBg: 'bg-indigo-100 text-indigo-600', badgeText: '재확인요청', title: `[${seat}] ${data.name} · AI 채점 재확인 요청`, subtitle: `${data.qNum}번 문항 · AI가 오답으로 채점했습니다. 상세정보를 확인하세요.`, seat, actionType: 'cancel_call', qNum: data.qNum });
    }
    flushGridToState();
  }, [addLog, flushGridToState, removeLogBySeatAndType]);

  const handleTaActionFromOtherScreen = useCallback((payload: any) => {
    const { seat, action, qNum, taName } = payload;
    if (action === 'force_cancel_call' && qNum !== undefined) {
      if (!(activeStudents.current[seat]?.calls?.[qNum])) return; 
      delete activeStudents.current[seat].calls[qNum];
      if (Object.keys(activeStudents.current[seat].calls || {}).length === 0) activeStudents.current[seat].status = 'idle';
      addLog({ borderClass: 'border-slate-400', badgeBg: 'bg-slate-100 text-slate-600', badgeText: '호출해제', title: `[${seat}] ${qNum}번 문항 지도 종료`, subtitle: `${taName || '조교'} 조교의 ${qNum}번 문항 관련 대면 설명이 끝나 호출을 해제했습니다.` }, LOG_AUTO_EXPIRE_MS);
      removeLogBySeatAndType(seat, 'cancel_call', qNum);
      flushGridToState();
    } else if (action === 'force_return_to_seat') {
      if (activeStudents.current[seat]?.status !== 'away') return;
      addLog({ borderClass: 'border-slate-400', badgeBg: 'bg-slate-100 text-slate-600', badgeText: '복귀처리', title: `[${seat}] 자리비움 해제`, subtitle: `다른 화면에서 자리비움 상태를 해제했습니다.` }, LOG_AUTO_EXPIRE_MS);
      activeStudents.current[seat].status = 'idle';
      flushGridToState();
    } else if (action === 'force_checkout' || action === 'force_checkout_by_ta') {
      const st = activeStudents.current[seat];
      if (!st) return;
      if (st.studentId || st.name) deadZombies.current[st.studentId || st.name] = st.lastUpdatedAt || Date.now();
      addLog({ borderClass: action === 'force_checkout_by_ta' ? 'border-rose-600' : 'border-slate-800', badgeBg: action === 'force_checkout_by_ta' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white', badgeText: action === 'force_checkout_by_ta' ? '강제퇴실' : '퇴실완료', title: `[${seat}] 퇴실 처리`, subtitle: `다른 화면의 판단으로 퇴실 처리되었습니다.` }, LOG_AUTO_EXPIRE_MS);
      delete activeStudents.current[seat];
      pendingDeletes.current[seat] = Date.now() + PENDING_GUARD_MS;
      scheduleGuardRecheck();
      flushGridToState();
    }
  }, [addLog, flushGridToState, removeLogBySeatAndType, scheduleGuardRecheck]);

  // === 생명주기 및 초기화 ===
  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error("Supabase 환경 변수가 누락되었습니다.");
        return;
    }
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    clinicChannel.current = supabaseClient.channel(CLINIC_ROOM);

    clinicChannel.current
      .on('presence', { event: 'sync' }, syncActiveStudentsFromPresence)
      .on('broadcast', { event: 'student_action' }, ({ payload }: any) => handleStudentAction(payload))
      .on('broadcast', { event: 'ta_action' }, ({ payload }: any) => handleTaActionFromOtherScreen(payload))
      .subscribe((status: string) => setIsConnected(status === 'SUBSCRIBED'));

    const interval = setInterval(() => {
      if (clinicChannel.current && Date.now() % 2000 < 1000) syncActiveStudentsFromPresence();
    }, 1000);

    return () => {
      clearInterval(interval);
      if (clinicChannel.current) clinicChannel.current.unsubscribe();
    };
  }, [handleStudentAction, handleTaActionFromOtherScreen, syncActiveStudentsFromPresence]);

  // === 외부 제공(Export) 함수들 ===
  const executeTaAction = (seat: string, type: string, qNum: number | null = null) => {
    if (type === 'cancel_call' && qNum !== null) {
      if (activeStudents.current[seat]?.calls) delete activeStudents.current[seat].calls[qNum];
      if (Object.keys(activeStudents.current[seat]?.calls || {}).length === 0) activeStudents.current[seat].status = 'idle';
      addLog({ borderClass: 'border-slate-400', badgeBg: 'bg-slate-100 text-slate-600', badgeText: '호출해제', title: `[${seat}] ${qNum}번 문항 지도 종료`, subtitle: `대면 설명이 끝나 호출을 해제했습니다.` }, LOG_AUTO_EXPIRE_MS);
      removeLogBySeatAndType(seat, 'cancel_call', qNum);
      sendToStudent(seat, 'force_cancel_call', { qNum });
      flushGridToState();
    }
  };

  const resolveRecheck = (verdict: 'correct' | 'incorrect') => {
    if (!recheckModal) return;
    const { seat, uid, qNum, name } = recheckModal;
    sendToStudent(seat, 'resolve_recheck', { uid, verdict });
    addLog({
      borderClass: verdict === 'correct' ? 'border-emerald-500' : 'border-rose-500',
      badgeBg: verdict === 'correct' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600',
      badgeText: verdict === 'correct' ? '재확인·정답' : '재확인·오답',
      title: `[${seat}] ${name} 재확인 결과: ${verdict === 'correct' ? '정답' : '오답'} 처리`,
      subtitle: `${qNum}번 문항 · 조교가 이미지를 직접 확인해 처리했습니다.`
    }, LOG_AUTO_EXPIRE_MS);
    if (activeStudents.current[seat]?.rechecks) delete activeStudents.current[seat].rechecks[uid];
    setRecheckModal(null);
  };

  const handleDragStart = (e: React.DragEvent, seat: string) => {
    setDraggedSeat(seat);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, seat: string) => {
    e.preventDefault();
    if (draggedSeat && draggedSeat !== seat && !gridSnapshot[seat]) setDropTarget(seat);
  };
  const handleDragLeave = () => setDropTarget(null);
  const handleDrop = (e: React.DragEvent, seat: string) => {
    e.preventDefault();
    setDropTarget(null);
    if (draggedSeat && draggedSeat !== seat && !gridSnapshot[seat]) moveStudentSeat(draggedSeat, seat);
    setDraggedSeat(null);
  };

  return {
    isConnected, taCount, taNames, studentCount, vacantCount, gridSnapshot, logs,
    recheckModal, setRecheckModal, draggedSeat, dropTarget,
    executeTaAction, resolveRecheck, handleDragStart, handleDragOver, handleDragLeave, handleDrop
  };
}