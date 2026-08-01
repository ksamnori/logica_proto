// src/app/clinic/ta/dashboard/page.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ==========================================
// 상수 및 환경 설정
// ==========================================
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kfwlmbwornivkrvoeqdh.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtmd2xtYndvcm5pdmtydm9lcWRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDUzNzQsImV4cCI6MjA5NTMyMTM3NH0.Kh9MPHzUxf9xLRYTH_UqoIhxOm4lybA_OL8Z60H9vqo";
const CLINIC_ROOM = "logica-clinic-room";

const SEAT_ROWS = ["A", "B", "C", "D", "E", "F"];
const SEAT_COLS = 10;
const SEATS = SEAT_ROWS.flatMap(r => Array.from({ length: SEAT_COLS }, (_, i) => `${r}-${String(i + 1).padStart(2, "0")}`));

const LOG_AUTO_EXPIRE_MS = 5 * 60 * 1000;
const PENDING_GUARD_MS = 8000;
const GHOST_DEPARTURE_GRACE_MS = 5000;

// ==========================================
// 타입 정의
// ==========================================
type StudentStatus = "idle" | "call" | "hint" | "away" | "submitted";

interface StudentData {
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

interface LogEntry {
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

export default function TACinicDashboard() {
  // === UI 상태 (렌더링 갱신용) ===
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

  // === 실시간 동기화용 Mutable Refs (리렌더링 방지) ===
  const activeStudents = useRef<Record<string, StudentData>>({});
  const deadZombies = useRef<Record<string, number>>({});
  const seatOverrides = useRef<Record<string, { newSeat: string; timestamp: number }>>({});
  const pendingMoves = useRef<Record<string, { newSeat: string; expiresAt: number }>>({});
  const pendingDeletes = useRef<Record<string, number>>({});
  
  const clinicChannel = useRef<any>(null);
  const logIdCounter = useRef(0);
  const guardRecheckInterval = useRef<NodeJS.Timeout | null>(null);

  // ==========================================
  // 유틸리티 함수
  // ==========================================
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
    
    if (expireMs) {
      setTimeout(() => {
        setLogs(prev => prev.filter(l => l.id !== id));
      }, expireMs);
    }
    return id;
  }, []);

  const removeLogBySeatAndType = useCallback((seat: string, actionType: string, qNum?: number) => {
    setLogs(prev => prev.filter(l => !(l.seat === seat && l.actionType === actionType && (qNum === undefined || l.qNum === qNum))));
  }, []);

  const transferLogs = useCallback((oldSeat: string, newSeat: string) => {
    setLogs(prev => prev.map(log => {
      if (log.seat === oldSeat) {
        return {
          ...log,
          seat: newSeat,
          title: log.title.replace(`[${oldSeat}]`, `[${newSeat}]`),
        };
      }
      return log;
    }));
  }, []);

  const sendToStudent = useCallback((seat: string, action: string, extra: any = {}) => {
    if (clinicChannel.current) {
      clinicChannel.current.send({
        type: 'broadcast',
        event: 'ta_action',
        payload: { seat, action, ...extra, timestamp: Date.now() }
      });
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

  // ==========================================
  // 좌석 이동 (Drag & Drop)
  // ==========================================
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

    if (identifier) {
      seatOverrides.current[identifier] = { newSeat, timestamp: Date.now() };
    }

    pendingMoves.current[oldSeat] = { newSeat, expiresAt: Date.now() + 3000 };

    addLog({
      borderClass: 'border-indigo-500',
      badgeBg: 'bg-indigo-100 text-indigo-700',
      badgeText: '좌석이동',
      title: `[${oldSeat} → ${newSeat}] ${sName} 좌석 변경`,
      subtitle: `조교가 ${sName} 학생의 좌석을 옮겼습니다.`,
      seat: newSeat
    }, LOG_AUTO_EXPIRE_MS);

    flushGridToState();
  }, [addLog, flushGridToState, sendToStudent, transferLogs]);

  // ==========================================
  // Supabase Presence & Broadcast 처리
  // ==========================================
  const syncActiveStudentsFromPresence = useCallback(() => {
    if (!clinicChannel.current) return;
    const state = clinicChannel.current.presenceState();
    const presentSeats: Record<string, any> = {};
    const seatBestUpdatedAt: Record<string, number> = {};
    const taClientIdSet = new Set<string>();
    const currentTaNames: string[] = [];

    // [수정됨] any[] 에서 any로 변경하여 타입 에러 해결
    Object.values(state).forEach((metas: any) => {
      let latestMeta: any = null;
      metas.forEach((meta: any) => {
        if (!latestMeta || (meta.updatedAt || 0) > (latestMeta.updatedAt || 0)) latestMeta = meta;
      });
      if (!latestMeta) return;

      const candidateUpdatedAt = latestMeta.updatedAt || 0;
      const identifier = latestMeta.studentId || latestMeta.name;
      
      if (identifier && deadZombies.current[identifier] && candidateUpdatedAt <= deadZombies.current[identifier]) {
        return; 
      }

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
            name: latestMeta.name, 
            classes: latestMeta.classes || [], 
            activity: latestMeta.activity || null, 
            studentId: latestMeta.studentId || null,
            lastUpdatedAt: candidateUpdatedAt 
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
      if (!existing || (seatBestUpdatedAt[seat] || 0) > (seatBestUpdatedAt[existing] || 0)) {
        seatByStudentId[identifier] = seat;
      }
    });
    Object.entries(presentSeats).forEach(([seat, info]) => {
      const identifier = info.studentId || info.name;
      if (identifier && seatByStudentId[identifier] !== seat) {
        delete presentSeats[seat];
      }
    });

    Object.keys(presentSeats).forEach(seat => {
      if (!activeStudents.current[seat]) {
        activeStudents.current[seat] = { 
          name: presentSeats[seat].name, 
          classes: presentSeats[seat].classes, 
          status: 'idle', 
          activity: presentSeats[seat].activity, 
          studentId: presentSeats[seat].studentId,
          lastUpdatedAt: presentSeats[seat].lastUpdatedAt
        };
      } else {
        activeStudents.current[seat].name = presentSeats[seat].name;
        activeStudents.current[seat].classes = presentSeats[seat].classes;
        activeStudents.current[seat].activity = presentSeats[seat].activity;
        activeStudents.current[seat].lastUpdatedAt = presentSeats[seat].lastUpdatedAt;
        if (presentSeats[seat].studentId) activeStudents.current[seat].studentId = presentSeats[seat].studentId;
        if (activeStudents.current[seat].missingSince) activeStudents.current[seat].missingSince = null;
      }
    });

    Object.entries(presentSeats).forEach(([newSeat, info]) => {
      if (info.dummy) return;
      const identifier = info.studentId || info.name;
      if (!identifier) return;

      const oldSeat = Object.keys(activeStudents.current).find(seat => {
        if (seat === newSeat) return false;
        const student = activeStudents.current[seat];
        return (student.studentId || student.name) === identifier;
      });

      if (oldSeat) {
        activeStudents.current[newSeat] = { 
          ...activeStudents.current[oldSeat], 
          name: info.name, 
          classes: info.classes, 
          activity: info.activity, 
          studentId: info.studentId,
          lastUpdatedAt: info.lastUpdatedAt
        };
        delete activeStudents.current[oldSeat];
        transferLogs(oldSeat, newSeat);
      }
    });

    const nowForDeletes = Date.now();
    Object.keys(pendingDeletes.current).forEach(seat => {
      if (!presentSeats[seat]) {
        delete pendingDeletes.current[seat];
      } else if (nowForDeletes > pendingDeletes.current[seat]) {
        delete pendingDeletes.current[seat];
      } else {
        delete presentSeats[seat];
      }
    });

    Object.keys(activeStudents.current).forEach(seat => {
      if (!presentSeats[seat]) {
        if (pendingMoves.current[seat] || pendingDeletes.current[seat]) return;

        const st = activeStudents.current[seat];
        if (!st.missingSince) {
          st.missingSince = Date.now();
          return;
        }
        if (Date.now() - st.missingSince < GHOST_DEPARTURE_GRACE_MS) return;

        if (st) {
          const identifier = st.studentId || st.name;
          if (identifier) deadZombies.current[identifier] = st.lastUpdatedAt || Date.now();
        }

        const sName = st ? (st.name || '학생') : '학생';
        addLog({
          borderClass: 'border-slate-800', badgeBg: 'bg-slate-900 text-white',
          badgeText: '퇴실/이탈', title: `[${seat}] ${sName} 연결 종료`,
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
        const foundSeats = Object.keys(activeStudents.current).filter(s => {
          const st = activeStudents.current[s];
          return (st.studentId === identifier || st.name === identifier || s === seat);
        });
        if (foundSeats.length > 0) targetSeats = foundSeats;
      }

      targetSeats.forEach(targetSeat => {
        const st = activeStudents.current[targetSeat];
        if (st) {
          if (identifier) deadZombies.current[identifier] = st.lastUpdatedAt || Date.now();
          addLog({
            borderClass: 'border-slate-800', badgeBg: 'bg-slate-900 text-white',
            badgeText: '퇴실완료', title: `[${targetSeat}] ${data.name || '학생'} 정상 로그아웃`,
            subtitle: `학생이 화면을 닫거나 로그아웃했습니다.`, seat: targetSeat
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
      st.calls[data.qNum] = Date.now(); 
      st.status = 'call';
      addLog({
        borderClass: 'border-rose-500', badgeBg: 'bg-rose-100 text-rose-600',
        badgeText: '질문호출', title: `[${seat}] ${data.name} 질문 요청`,
        subtitle: `${data.qNum}번 문항 관련 대면 설명 유도를 진행 중입니다.`,
        seat, actionType: 'cancel_call', qNum: data.qNum
      });
    } else if (action === 'cancel_call') {
      if (st.calls) delete st.calls[data.qNum];
      if (Object.keys(st.calls || {}).length === 0) st.status = 'idle';
      removeLogBySeatAndType(seat, 'cancel_call', data.qNum);
      addLog({
        borderClass: 'border-slate-400', badgeBg: 'bg-slate-100 text-slate-600',
        badgeText: '호출취소', title: `[${seat}] ${data.name} 호출 취소`,
        subtitle: `${data.qNum}번 문항 호출을 학생이 직접 취소했습니다.`
      }, LOG_AUTO_EXPIRE_MS);
    } else if (action === 'away') {
      st.status = 'away';
      addLog({
        borderClass: 'border-amber-500', badgeBg: 'bg-amber-100 text-amber-700',
        badgeText: '자리비움', title: `[${seat}] ${data.name} 자리비움`,
        subtitle: `학생이 잠시 자리를 비웠습니다.`, seat
      });
    } else if (action === 'cancel_away') {
      st.status = 'idle';
      addLog({
        borderClass: 'border-slate-400', badgeBg: 'bg-slate-100 text-slate-600',
        badgeText: '복귀', title: `[${seat}] ${data.name} 자리 복귀`,
        subtitle: `학생이 자리로 돌아왔습니다.`, seat
      }, LOG_AUTO_EXPIRE_MS);
    } else if (action === 'hint') {
      st.status = 'hint';
      addLog({
        borderClass: 'border-yellow-400', badgeBg: 'bg-yellow-100 text-yellow-700',
        badgeText: '힌트열람', title: `[${seat}] ${data.name} 힌트 확인`,
        subtitle: `${data.qNum}번 문항 [${data.level}단계] 힌트 열람 완료.`, seat
      }, LOG_AUTO_EXPIRE_MS);
      setTimeout(() => {
        if (activeStudents.current[seat] && activeStudents.current[seat].status === 'hint') {
          activeStudents.current[seat].status = 'idle';
          flushGridToState();
        }
      }, 10000);
    } else if (action === 'submit') {
      st.status = 'submitted';
      st.score = data.score;
      addLog({
        borderClass: 'border-blue-500', badgeBg: 'bg-blue-100 text-blue-600',
        badgeText: '답안제출', title: `[${seat}] ${data.name} 정답 제출`,
        subtitle: `최종 채점 점수 [${data.score} / 5]. 조교 확인 후 최종 퇴실 가용 상태입니다.`, seat
      });
    } else if (action === 'recheck_request') {
      if (!st.rechecks) st.rechecks = {};
      st.rechecks[data.uid] = { ...data, seat };
      addLog({
        borderClass: 'border-indigo-500', badgeBg: 'bg-indigo-100 text-indigo-600',
        badgeText: '재확인요청', title: `[${seat}] ${data.name} · AI 채점 재확인 요청`,
        subtitle: `${data.qNum}번 문항 · AI가 오답으로 채점했습니다. 상세정보를 확인하세요.`,
        seat, actionType: 'cancel_call', qNum: data.qNum
      });
    }

    flushGridToState();
  }, [addLog, flushGridToState, removeLogBySeatAndType]);

  const handleTaActionFromOtherScreen = useCallback((payload: any) => {
    const { seat, action, qNum, taName } = payload;

    if (action === 'force_cancel_call') {
      if (qNum === undefined || qNum === null) return;
      if (!(activeStudents.current[seat] && activeStudents.current[seat].calls && activeStudents.current[seat].calls[qNum])) return; 
      
      delete activeStudents.current[seat].calls[qNum];
      if (Object.keys(activeStudents.current[seat].calls || {}).length === 0) activeStudents.current[seat].status = 'idle';
      
      addLog({
        borderClass: 'border-slate-400', badgeBg: 'bg-slate-100 text-slate-600',
        badgeText: '호출해제', title: `[${seat}] ${qNum}번 문항 지도 종료`,
        subtitle: `${taName || '조교'} 조교의 ${qNum}번 문항 관련 대면 설명이 끝나 호출을 해제했습니다.`
      }, LOG_AUTO_EXPIRE_MS);
      removeLogBySeatAndType(seat, 'cancel_call', qNum);
      flushGridToState();
    }
    else if (action === 'force_return_to_seat') {
      if (!activeStudents.current[seat] || activeStudents.current[seat].status !== 'away') return;
      addLog({
        borderClass: 'border-slate-400', badgeBg: 'bg-slate-100 text-slate-600',
        badgeText: '복귀처리', title: `[${seat}] 자리비움 해제`,
        subtitle: `다른 화면에서 자리비움 상태를 해제했습니다.`
      }, LOG_AUTO_EXPIRE_MS);
      activeStudents.current[seat].status = 'idle';
      flushGridToState();
    }
    else if (action === 'force_checkout' || action === 'force_checkout_by_ta') {
      const st = activeStudents.current[seat];
      if (!st) return;
      
      const identifier = st.studentId || st.name;
      if (identifier) deadZombies.current[identifier] = st.lastUpdatedAt || Date.now();

      addLog({
        borderClass: action === 'force_checkout_by_ta' ? 'border-rose-600' : 'border-slate-800', 
        badgeBg: action === 'force_checkout_by_ta' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white', 
        badgeText: action === 'force_checkout_by_ta' ? '강제퇴실' : '퇴실완료', 
        title: `[${seat}] 퇴실 처리`, 
        subtitle: `다른 화면의 판단으로 퇴실 처리되었습니다.`
      }, LOG_AUTO_EXPIRE_MS);

      delete activeStudents.current[seat];
      pendingDeletes.current[seat] = Date.now() + PENDING_GUARD_MS;
      scheduleGuardRecheck();
      flushGridToState();
    }
  }, [addLog, flushGridToState, removeLogBySeatAndType, scheduleGuardRecheck]);

  // ==========================================
  // 생명주기 설정
  // ==========================================
  useEffect(() => {
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    clinicChannel.current = supabaseClient.channel(CLINIC_ROOM);

    clinicChannel.current
      .on('presence', { event: 'sync' }, () => syncActiveStudentsFromPresence())
      .on('broadcast', { event: 'student_action' }, ({ payload }: any) => handleStudentAction(payload))
      .on('broadcast', { event: 'ta_action' }, ({ payload }: any) => handleTaActionFromOtherScreen(payload))
      .subscribe((status: string) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    const interval = setInterval(() => {
      if (clinicChannel.current && Date.now() % 2000 < 1000) {
        syncActiveStudentsFromPresence();
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      if (clinicChannel.current) clinicChannel.current.unsubscribe();
    };
  }, [handleStudentAction, handleTaActionFromOtherScreen, syncActiveStudentsFromPresence]);

  // ==========================================
  // 조교 액션 핸들러
  // ==========================================
  const executeTaAction = (seat: string, type: string, qNum: number | null = null) => {
    if (type === 'cancel_call' && qNum !== null) {
      if (activeStudents.current[seat]?.calls) delete activeStudents.current[seat].calls[qNum];
      if (Object.keys(activeStudents.current[seat]?.calls || {}).length === 0) activeStudents.current[seat].status = 'idle';
      
      addLog({
        borderClass: 'border-slate-400', badgeBg: 'bg-slate-100 text-slate-600',
        badgeText: '호출해제', title: `[${seat}] ${qNum}번 문항 지도 종료`,
        subtitle: `대면 설명이 끝나 호출을 해제했습니다.`
      }, LOG_AUTO_EXPIRE_MS);
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

  // ==========================================
  // Drag & Drop HTML5 구현
  // ==========================================
  const handleDragStart = (e: React.DragEvent, seat: string) => {
    setDraggedSeat(seat);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, seat: string) => {
    e.preventDefault();
    if (draggedSeat && draggedSeat !== seat && !gridSnapshot[seat]) {
      setDropTarget(seat);
    }
  };

  const handleDragLeave = () => setDropTarget(null);

  const handleDrop = (e: React.DragEvent, seat: string) => {
    e.preventDefault();
    setDropTarget(null);
    if (draggedSeat && draggedSeat !== seat && !gridSnapshot[seat]) {
      moveStudentSeat(draggedSeat, seat);
    }
    setDraggedSeat(null);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50 font-pretendard">
      {/* 글로벌 스타일: 애니메이션 및 커스텀 스크롤바 유지 */}
      <style dangerouslySetInnerHTML={{__html:`
        @keyframes pulse-red {
            0%, 100% { border-color: #ef4444; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
            50% { border-color: #fca5a5; box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
        }
        .status-help { animation: pulse-red 1.2s infinite; background-color: #fef2f2; border: 2px solid #ef4444; }
        @keyframes flash-yellow {
            0%, 100% { background-color: white; }
            50% { background-color: #fef9c3; border-color: #eab308; }
        }
        .hint-flash { animation: flash-yellow 1.5s ease-in-out infinite; }
        @keyframes blink-dot { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
        .dot-live { animation: blink-dot 1.6s ease-in-out infinite; }
        .custom-scrollbar::-webkit-scrollbar { width: 7px; height: 7px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}}/>

      {/* 헤더 */}
      <header className="bg-gradient-to-r from-[#002864] to-[#013a8f] text-white px-6 py-3.5 flex justify-between items-center shadow-md z-20 shrink-0 border-b border-white/10">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Logica Clinic <span className="text-blue-300 font-medium mx-1">-</span> 조교 대시보드 (6x10)</h1>
          <p className="text-[11px] text-blue-300/80 mt-0.5 tracking-wide">Supabase Realtime 기반 온라인 동기화</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isConnected ? 'bg-green-500 dot-live' : 'bg-rose-500'}`} title="실시간 연결 상태"></span>

          <div className="flex items-center gap-1.5 bg-white/[0.07] border border-white/10 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm" title={taNames.join(", ")}>
            <span className="w-2 h-2 rounded-full bg-red-400 inline-block shrink-0"></span>
            조교 <span className="tabular-nums">{taCount}</span>명
          </div>

          <div className="flex items-center gap-1.5 bg-white/[0.07] border border-white/10 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm">
            <span className="w-2 h-2 rounded-full bg-blue-300 inline-block shrink-0"></span>
            학생 <span className="tabular-nums">{studentCount}</span>명
          </div>

          <div className="flex items-center gap-1.5 bg-white/[0.07] border border-white/10 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm">
            <span className="w-2 h-2 rounded-full bg-slate-400 inline-block shrink-0"></span>
            공석 <span className="tabular-nums">{vacantCount}</span>석
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 영역 */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* 좌측 그리드 */}
        <main className="flex-1 p-6 bg-slate-200 overflow-y-auto custom-scrollbar">
          <p className="text-[11px] text-slate-500 font-bold mb-3">💡 학생 카드를 드래그해서 빈 자리에 놓으면 좌석을 옮길 수 있어요.</p>
          <div className="grid grid-cols-10 gap-2">
            {SEATS.map(seat => {
              const student = gridSnapshot[seat];
              const isCall = student?.status === 'call';
              const isHint = student?.status === 'hint';
              const isAway = student?.status === 'away';
              const isSubmitted = student?.status === 'submitted';
              
              const isDragTarget = dropTarget === seat;
              const isDragged = draggedSeat === seat;

              if (!student) {
                return (
                  <div key={seat} 
                    // [수정됨] onDragOver, onDrop이 정의되지 않은 오타를 handleDragOver, handleDrop으로 수정했습니다.
                    onDragOver={(e) => handleDragOver(e, seat)} 
                    onDragLeave={handleDragLeave} 
                    onDrop={(e) => handleDrop(e, seat)}
                    className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-bold transition-all ${isDragTarget ? 'border-2 border-indigo-400 bg-indigo-50 text-indigo-500 shadow-inner' : 'bg-[#e2e8f0] text-[#94a3b8]'}`}>
                    {seat}
                  </div>
                );
              }

              return (
                <div key={seat} 
                  draggable 
                  onDragStart={(e) => handleDragStart(e, seat)}
                  className={`aspect-square rounded-md p-2 flex flex-col justify-between cursor-grab active:cursor-grabbing transition-all ${isDragged ? 'opacity-40 scale-95' : 'hover:scale-105 hover:shadow-lg shadow-sm z-10'} ${isCall ? 'status-help' : isHint ? 'hint-flash' : isAway ? 'bg-amber-50 border-2 border-amber-400' : isSubmitted ? 'bg-blue-50 border-2 border-blue-400' : 'bg-[#002864] text-white'}`}
                  title="드래그해서 좌석 이동"
                >
                  <div className="flex justify-between items-start pointer-events-none">
                    <span className="text-[8px] font-bold opacity-80">{seat}</span>
                    <span className={`text-[9px] font-bold px-1 rounded ${isCall ? 'bg-rose-600 text-white' : isHint ? 'bg-yellow-400 text-yellow-900' : isAway ? 'bg-amber-500 text-white' : isSubmitted ? 'bg-blue-600 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                      {isCall ? `🚨 ${Object.keys(student.calls || {}).length}` : isHint ? '💡' : isAway ? '🚶' : isSubmitted ? '✅' : '🟢'}
                    </span>
                  </div>
                  <div className="mt-auto pointer-events-none">
                    <div className={`font-bold text-[11px] truncate ${student.status === 'idle' ? 'text-white' : 'text-slate-800'}`}>{student.name}</div>
                    <div className={`text-[8px] font-bold truncate mt-0.5 ${student.status === 'idle' ? 'text-blue-200' : 'text-slate-500'}`}>{student.classes?.[0] || '반 없음'}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </main>

        {/* 우측 사이드바 (로그) */}
        <aside className="w-[360px] bg-white border-l border-slate-300 flex flex-col h-full shadow-2xl z-10 shrink-0">
          <div className="bg-slate-800 text-white px-5 py-3 font-bold text-sm flex justify-between items-center shrink-0">
            <span>⚡ 현장 라이브 로그</span>
            <span className="text-xs bg-rose-500 px-2 py-0.5 rounded animate-pulse">Live</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 custom-scrollbar">
            {logs.length === 0 ? (
              <div className="text-center text-xs text-slate-400 py-8">아직 접수된 로그 기록이 없습니다.</div>
            ) : (
              logs.map(log => (
                <div key={log.id} className={`bg-white p-3 rounded-lg border-l-4 ${log.borderClass} shadow-sm animate-[fadeIn_0.3s_ease-out]`}>
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[10px] font-bold text-slate-400">{log.time}</span>
                    <span className={`${log.badgeBg} text-[9px] font-bold px-1.5 py-0.5 rounded`}>{log.badgeText}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-800">{log.title}</p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-snug break-keep">{log.subtitle}</p>
                  {log.actionType === 'cancel_call' && (
                    <button onClick={() => executeTaAction(log.seat!, 'cancel_call', log.qNum)} className="mt-2 w-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-1.5 rounded transition-colors shadow-sm">
                      호출 종료
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      {/* AI 채점 재확인 모달 */}
      {recheckModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-indigo-600 text-white px-5 py-3 flex justify-between items-center">
              <span className="font-bold text-sm">🔄 AI 채점 재확인 — [{recheckModal.seat}] {recheckModal.name} · {recheckModal.qNum}번</span>
              <button onClick={() => setRecheckModal(null)} className="text-white/80 hover:text-white text-lg leading-none">&times;</button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div><p className="text-[11px] font-bold text-slate-400 mb-1">문제</p><p className="text-sm text-slate-700 leading-relaxed">{recheckModal.questionText}</p></div>
              <div><p className="text-[11px] font-bold text-slate-400 mb-1">정답(원문)</p><p className="text-sm font-bold text-slate-800">{recheckModal.correctAnswer}</p></div>
              <div><p className="text-[11px] font-bold text-slate-400 mb-1">제출 이미지</p><img className="w-full rounded-lg border border-slate-200 bg-white" src={recheckModal.imageDataUrl} /></div>
              <div className="bg-indigo-50 rounded-lg p-3">
                <p className="text-[11px] font-bold text-indigo-500 mb-1">🤖 제미나이가 인식한 내용</p>
                <p className="text-sm text-slate-700 mb-1">"{recheckModal.recognizedText}"</p>
                <p className="text-xs text-slate-500 leading-relaxed">{recheckModal.aiExplanation}</p>
                {recheckModal.aiConfidence && <p className="text-[10px] text-slate-400 mt-1">AI 확신도: {Math.round(recheckModal.aiConfidence * 100)}%</p>}
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-slate-100 bg-slate-50">
              <button onClick={() => resolveRecheck('incorrect')} className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-bold py-3 rounded-xl text-sm transition-colors shadow-sm">❌ 오답 처리</button>
              <button onClick={() => resolveRecheck('correct')} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl text-sm transition-colors shadow-sm">✅ 정답 처리</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}