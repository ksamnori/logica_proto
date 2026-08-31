// src/app/supervisor/useSupervisorData.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabaseClient, CLINIC_ROOM, getKSTDateString, DEFAULT_CLINIC_DURATION_MS, LOG_AUTO_EXPIRE_MS, PENDING_GUARD_MS, HEARTBEAT_TIMEOUT_MS, formatDuration } from './supervisorUtils';
import { endTodaySession, pickLatestSessionPerStudent, resolveEndSessionForStudent, END_REQUEST_COOLDOWN_MS, clearActiveCall, clearActiveRecheck, clearAway } from '@/lib/clinicSession';
import { getActiveSeatLayout } from '@/app/actions/clinicSeatLayout';
import { listPadDevicesByTenant } from '@/app/actions/clinicPadDevice';
import { Seat, SEAT_LAYOUT_UPDATED_EVENT, DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, DEFAULT_SEAT_CARD_W, DEFAULT_SEAT_CARD_H } from '@/lib/clinicSeatLayout';

const PERSIST_UNTIL_RESOLVED_TYPES = ['call', 'away', 'recheck', 'end_request'];

export function useSupervisorData() {
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
    const [authMessage, setAuthMessage] = useState<string>('권한을 확인하는 중입니다...');

    const [now, setNow] = useState(Date.now());
    const [startedAt] = useState(Date.now());
    const [connectionStatus, setConnectionStatus] = useState('connecting');
    const [activeStudents, setActiveStudents] = useState<Record<string, any>>({});
    const [activeTAs, setActiveTAs] = useState<Record<string, any>>({});
    const [taStats, setTaStats] = useState<Record<string, any>>({});
    const [logs, setLogs] = useState<any[]>([]);
    const [isMounted, setIsMounted] = useState(false);
    
    const [leftTab, setLeftTab] = useState<'ta' | 'students' | 'records'>('ta');
    const [allStudents, setAllStudents] = useState<Record<string, { label: string; students: any[] }>>({});
    const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});

    const [clinicRecords, setClinicRecords] = useState<Record<string, any>>({});
    const [expandedRecords, setExpandedRecords] = useState<Record<string, boolean>>({});
    
    const [draggedSeat, setDraggedSeat] = useState<string | null>(null);
    const [draggedListStudent, setDraggedListStudent] = useState<any>(null);
    const [selectedSeatForMove, setSelectedSeatForMove] = useState<string | null>(null);
    const [ghostRect, setGhostRect] = useState<{ left: number; top: number; width: number; height: number; scale: number } | null>(null);
    const dragOffsetRef = useRef({ x: 0, y: 0 });

    const [forceCheckoutModal, setForceCheckoutModal] = useState<{ isOpen: boolean, seat: string | null }>({ isOpen: false, seat: null });
    const [recheckModal, setRecheckModal] = useState<{ isOpen: boolean, seat: string | null, uid: string | null }>({ isOpen: false, seat: null, uid: null });
    const [endRequestModal, setEndRequestModal] = useState<{ isOpen: boolean, seat: string | null }>({ isOpen: false, seat: null });
    const [reservationModal, setReservationModal] = useState<{ isOpen: boolean; seat: string | null; student: any | null }>({ isOpen: false, seat: null, student: null });
    const RESERVATION_GRACE_MS = 10 * 60 * 1000;

    const studentsRef = useRef<Record<string, any>>({});
    const channelRef = useRef<any>(null);

    const registeredSeatsRef = useRef<Set<string>>(new Set());
    const pendingMovesRef = useRef<Record<string, any>>({});
    const lastRelocateAtRef = useRef<number>(0);
    const pendingDeletesRef = useRef<Record<string, number>>({});
    const pendingTimeAdjustRef = useRef<Record<string, any>>({});
    const syncPresenceRef = useRef<any>(null);
    const checkReservationExpiryRef = useRef<any>(null);
    const checkClinicTimeExpiryRef = useRef<any>(null);

    const [seats, setSeats] = useState<string[]>([]);
    const [seatObjs, setSeatObjs] = useState<Seat[]>([]);
    const [canvasWidth, setCanvasWidth] = useState(DEFAULT_CANVAS_W);
    const [canvasHeight, setCanvasHeight] = useState(DEFAULT_CANVAS_H);
    const [seatWidth, setSeatWidth] = useState(DEFAULT_SEAT_CARD_W);
    const [seatHeight, setSeatHeight] = useState(DEFAULT_SEAT_CARD_H);
    const [editorLocked, setEditorLocked] = useState(false);

    const loadSeats = useCallback(() => {
        getActiveSeatLayout().then(layout => {
            const sorted = [...layout.seats].sort((a, b) => a.number - b.number);
            setSeats(sorted.map(s => String(s.number)));
            setSeatObjs(sorted);
            setCanvasWidth(layout.canvasWidth);
            setCanvasHeight(layout.canvasHeight);
            setSeatWidth(layout.seatWidth);
            setSeatHeight(layout.seatHeight);
        });
        listPadDevicesByTenant().then(deviceBySeat => {
            registeredSeatsRef.current = new Set(Object.keys(deviceBySeat));
        });
    }, []);

    useEffect(() => { loadSeats(); }, [loadSeats]);

    useEffect(() => {
        setIsMounted(true);
        const verifyAdminAccess = () => {
            const instId = localStorage.getItem('logica_instructor_id');
            const role = localStorage.getItem('logica_instructor_role') || '';
            const position = localStorage.getItem('logica_instructor_position') || '';

            if (!instId) {
                setAuthMessage('로그인이 필요합니다. 먼저 시스템에 로그인해 주세요.');
                setIsAuthorized(false);
                return;
            }

            if (
                role === 'ADMIN' || role === 'MANAGER' || role === 'PRINCIPAL' || role === 'SUPER_ADMIN' ||
                position.includes('원장') || position.includes('실장') || position.includes('최고관리자') || position.includes('대장')
            ) {
                setIsAuthorized(true);
            } else {
                setAuthMessage(`접근 불가: [${position || '미지정'}] 권한입니다. 원장 또는 실장만 접속 가능합니다.`);
                setIsAuthorized(false);
            }
        };
        verifyAdminAccess();
    }, []);

    const updateStudents = useCallback((newStudents: any) => {
        studentsRef.current = newStudents;
        setActiveStudents({ ...newStudents });
    }, []);

    const appendLog = useCallback((borderClass: string, badgeBg: string, badgeText: string, title: string | React.ReactNode, subtitle: string | React.ReactNode, type?: string, data?: any) => {
        const logId = `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const persistUntilResolved = !!type && PERSIST_UNTIL_RESOLVED_TYPES.includes(type);
        
        const newLog = {
            id: logId, 
            timestamp: new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            borderClass, badgeBg, badgeText, title, subtitle, type, data, 
            expiresAt: persistUntilResolved ? null : Date.now() + LOG_AUTO_EXPIRE_MS
        };

        setLogs(prev => [newLog, ...prev].slice(0, 100));

        if (!persistUntilResolved) {
            setTimeout(() => {
                setLogs(prev => prev.filter(l => l.id !== logId));
            }, LOG_AUTO_EXPIRE_MS);
        }
        return logId;
    }, []);

    const removeLogsByTypeAndSeat = useCallback((type: string, seat: string, qNum?: any, uid?: string | null) => {
        setLogs(prev => prev.filter(l => {
            const matchSeatAndType = l.data?.seat === seat && l.type === type;
            if (!matchSeatAndType) return true;
            if (qNum != null && l.data?.qNum !== qNum) return true;
            if (uid != null && l.data?.uid !== uid) return true;
            return false;
        }));
    }, []);

    const sendToStudent = (seat: string, action: string, extra = {}) => {
        if (!channelRef.current) return;
        channelRef.current.send({ type: 'broadcast', event: 'ta_action', payload: { seat, action, ...extra, timestamp: Date.now() } });
    };

    useEffect(() => {
        if (!isAuthorized) return;
        
        const fetchAllStudents = async () => {
            const { data } = await supabaseClient.from('student').select('student_id, name, enrollment(class(name, code))');
            if (data) {
                const grouped: Record<string, { label: string; students: any[] }> = {};
                data.forEach((s: any) => {
                    const classEntries = s.enrollment?.map((e: any) => e.class).filter(Boolean) || [];
                    const classes = classEntries.map((c: any) => c.name);
                    const firstClass = classEntries[0];
                    const cLabel = firstClass ? firstClass.name : '반 미배정';
                    const cKey = firstClass ? `${firstClass.name}::${firstClass.code || ''}` : '반 미배정';
                    if (!grouped[cKey]) grouped[cKey] = { label: cLabel, students: [] };
                    grouped[cKey].students.push({ id: s.student_id, name: s.name, classes });
                });
                const sortedGrouped: Record<string, { label: string; students: any[] }> = {};
                Object.keys(grouped).sort((a, b) => grouped[a].label.localeCompare(grouped[b].label)).forEach(k => {
                    sortedGrouped[k] = { label: grouped[k].label, students: grouped[k].students.sort((a, b) => a.name.localeCompare(b.name)) };
                });
                setAllStudents(sortedGrouped);
                if (Object.keys(sortedGrouped).length > 0) setExpandedClasses({ [Object.keys(sortedGrouped)[0]]: true });
            }
        };

        const loadInitialSeatsFromDB = async () => {
            const todayStr = getKSTDateString();
            const { data: rawSessionData } = await supabaseClient.from('clinic_session_state').select('*').eq('session_date', todayStr);
            const sessionData = rawSessionData && rawSessionData.length > 0 ? pickLatestSessionPerStudent(rawSessionData) : [];

            const newStudents = { ...studentsRef.current };
            for (const sess of sessionData) {
                let effectiveSeat = sess.manual_seat;
                if (!effectiveSeat && sess.seat) {
                    effectiveSeat = sess.seat;
                    await supabaseClient.from('clinic_session_state').update({ manual_seat: effectiveSeat }).eq('id', sess.id);
                }
                if (!effectiveSeat) continue;

                const { data: sData } = await supabaseClient.from('student').select('name, enrollment(class(name))').eq('student_id', sess.student_id).single();
                const metaName = sData?.name || '학생';
                const metaClasses = sData?.enrollment?.map((e: any) => e.class?.name).filter(Boolean) || ['반 미배정'];

                if (!newStudents[effectiveSeat]) {
                    newStudents[effectiveSeat] = {
                        name: metaName, classes: metaClasses, status: 'idle', studentId: sess.student_id, sessionId: sess.id,
                        firstSeenAt: new Date(sess.started_at).getTime() || Date.now(),
                        clinicDurationMs: sess.duration_ms || DEFAULT_CLINIC_DURATION_MS,
                        sessionNo: sess.session_no || 1,
                        totalCalls: 0, totalHints: 0, calls: {},
                        lastUpdatedAt: Date.now() // 초기화 시점 기록
                    };
                }
            }

            const assignedStudentIds = new Set(Object.values(newStudents).map((s: any) => s.studentId));
            const { data: reservations } = await supabaseClient.from('clinic_reservation').select('*').eq('session_date', todayStr);
            (reservations || []).forEach((r: any) => {
                if (assignedStudentIds.has(r.student_id) || newStudents[r.seat]) return;
                const expiresAt = new Date(r.expires_at).getTime();
                if (Date.now() > expiresAt) return;
                newStudents[r.seat] = {
                    type: 'reserved', name: r.student_name || '학생', classes: r.classes || [], studentId: r.student_id,
                    reservedFor: new Date(r.reserved_for).getTime(), expiresAt, calls: {}, totalCalls: 0, totalHints: 0
                };
            });

            updateStudents(newStudents);
        };
        fetchAllStudents(); loadInitialSeatsFromDB();
    }, [isAuthorized, updateStudents]);

    const fetchClinicRecords = useCallback(async () => {
        const todayStr = getKSTDateString();
        const { data: sessions } = await supabaseClient
            .from('clinic_session_state')
            .select('student_id, session_no, started_at, ended_at')
            .eq('session_date', todayStr)
            .order('session_no', { ascending: true });

        if (!sessions || sessions.length === 0) { setClinicRecords({}); return; }

        const studentIds = Array.from(new Set(sessions.map((s: any) => s.student_id)));
        const { data: students } = await supabaseClient.from('student').select('student_id, name').in('student_id', studentIds);
        const nameMap: Record<string, string> = {};
        (students || []).forEach((s: any) => { nameMap[s.student_id] = s.name; });

        const grouped: Record<string, any> = {};
        sessions.forEach((s: any) => {
            const startedAt = new Date(s.started_at).getTime();
            const endedAt = s.ended_at ? new Date(s.ended_at).getTime() : null;
            const durationMs = Math.max(0, (endedAt ?? Date.now()) - startedAt);

            if (!grouped[s.student_id]) grouped[s.student_id] = { name: nameMap[s.student_id] || '학생', totalMs: 0, sessions: [] };
            grouped[s.student_id].sessions.push({ sessionNo: s.session_no, startedAt, endedAt, durationMs });
            grouped[s.student_id].totalMs += durationMs;
        });

        setClinicRecords(grouped);
    }, []);

    useEffect(() => {
        if (!isAuthorized || leftTab !== 'records') return;
        fetchClinicRecords();
        const interval = setInterval(fetchClinicRecords, 10000);
        return () => clearInterval(interval);
    }, [isAuthorized, leftTab, fetchClinicRecords]);

    const toggleRecordExpand = useCallback((studentId: string) => {
        setExpandedRecords(prev => ({ ...prev, [studentId]: !prev[studentId] }));
    }, []);

    useEffect(() => {
        if (!isAuthorized) return;
        const interval = setInterval(() => {
            setNow(Date.now());
            if (channelRef.current && syncPresenceRef.current) syncPresenceRef.current(channelRef.current.presenceState());
            checkReservationExpiryRef.current?.();
            checkClinicTimeExpiryRef.current?.();
        }, 1000);
        return () => clearInterval(interval);
    }, [isAuthorized]);

    useEffect(() => {
        if (!isAuthorized || !isMounted) return;
        const dbCrossValidationInterval = setInterval(async () => {
            const todayStr = getKSTDateString();
            const { data: rawSessionData, error } = await supabaseClient.from('clinic_session_state').select('*').eq('session_date', todayStr);
            if (error || !rawSessionData) return;
            const sessionData = pickLatestSessionPerStudent(rawSessionData);

            const dbSeats = new Map();
            for (const s of sessionData) {
                let effectiveSeat = s.manual_seat;
                if (!effectiveSeat && s.seat) {
                    effectiveSeat = s.seat;
                    supabaseClient.from('clinic_session_state').update({ manual_seat: effectiveSeat }).eq('id', s.id).then();
                }
                if (effectiveSeat) dbSeats.set(effectiveSeat, s);
            }

            const current = { ...studentsRef.current };
            let isModified = false;

            for (const [targetSeat, dbRecord] of Array.from(dbSeats.entries())) {
                const staleReservedSeat = Object.keys(current).find(s => current[s].type === 'reserved' && current[s].studentId === dbRecord.student_id);
                if (staleReservedSeat) {
                    delete current[staleReservedSeat]; isModified = true;
                    supabaseClient.from('clinic_reservation').delete().eq('student_id', dbRecord.student_id).eq('session_date', todayStr).then();
                }

                const oldSeat = Object.keys(current).find(s => current[s].studentId === dbRecord.student_id && current[s].type !== 'reserved');
                if (oldSeat && oldSeat !== targetSeat) {
                    current[targetSeat] = { ...current[oldSeat], clinicDurationMs: dbRecord.duration_ms, sessionId: dbRecord.id };
                    delete current[oldSeat]; isModified = true;
                } else if (!oldSeat && !current[targetSeat]) {
                    const { data: sData } = await supabaseClient.from('student').select('name, enrollment(class(name))').eq('student_id', dbRecord.student_id).single();
                    const entryName = sData?.name || '학생';
                    current[targetSeat] = {
                        name: entryName, classes: sData?.enrollment?.map((e: any) => e.class?.name).filter(Boolean) || ['반 미배정'],
                        status: 'idle', studentId: dbRecord.student_id, sessionId: dbRecord.id, firstSeenAt: new Date(dbRecord.started_at).getTime() || Date.now(),
                        clinicDurationMs: dbRecord.duration_ms || DEFAULT_CLINIC_DURATION_MS,
                        sessionNo: dbRecord.session_no || 1,
                        endRequestPending: dbRecord.end_request_status === 'pending',
                        totalCalls: 0, totalHints: 0, calls: {}, activity: '포털/수동 배정 연동',
                        lastUpdatedAt: Date.now() // 초기화
                    };
                    isModified = true;
                    const justStarted = Date.now() - (new Date(dbRecord.started_at).getTime() || 0) < 10000;
                    if (justStarted) {
                        appendLog('border-emerald-500', 'bg-emerald-100 text-emerald-700', '입장', `[${targetSeat}] ${entryName} 입장`, `클리닉에 접속했습니다.`);
                    }
                } else if (oldSeat === targetSeat) {
                    const isTimeAdjusting = pendingTimeAdjustRef.current[targetSeat] && Date.now() < pendingTimeAdjustRef.current[targetSeat].expiresAt;
                    if (!isTimeAdjusting && dbRecord.duration_ms !== undefined && current[targetSeat].clinicDurationMs !== dbRecord.duration_ms) {
                        current[targetSeat].clinicDurationMs = dbRecord.duration_ms; isModified = true;
                    }
                    if (current[targetSeat].sessionId !== dbRecord.id) {
                        current[targetSeat].sessionId = dbRecord.id; isModified = true;
                    }
                    if (dbRecord.session_no && current[targetSeat].sessionNo !== dbRecord.session_no) {
                        current[targetSeat].sessionNo = dbRecord.session_no;
                        current[targetSeat].firstSeenAt = new Date(dbRecord.started_at).getTime() || current[targetSeat].firstSeenAt;
                        isModified = true;
                    }
                    const dbPending = dbRecord.end_request_status === 'pending';
                    if (dbPending && !current[targetSeat].endRequestPending) {
                        current[targetSeat].endRequestPending = true;
                        appendLog('border-rose-500', 'bg-rose-100 text-rose-600', '종료요청',
                            <span className="underline decoration-dotted cursor-pointer hover:text-rose-600" onClick={() => setEndRequestModal({ isOpen: true, seat: targetSeat })}>{current[targetSeat].name}</span>,
                            `클리닉 종료를 요청했습니다 · 클릭해서 승인/거부하세요.`, 'end_request', { seat: targetSeat }
                        );
                        isModified = true;
                    } else if (!dbPending && current[targetSeat].endRequestPending) {
                        current[targetSeat].endRequestPending = false;
                        removeLogsByTypeAndSeat('end_request', targetSeat);
                        isModified = true;
                    }
                }

                if (current[targetSeat] && current[targetSeat].type !== 'reserved') {
                    const st = current[targetSeat];
                    if (!st.calls) st.calls = {};
                    if (!st.rechecks) st.rechecks = {};
                    const dbCalls = dbRecord.active_calls || {};
                    const dbRechecks = dbRecord.active_rechecks || {};

                    Object.keys(dbCalls).forEach(qNumKey => {
                        if (st.calls[qNumKey]) return;
                        const qNum = qNumKey === 'general' ? 'general' : Number(qNumKey);
                        st.calls[qNumKey] = dbCalls[qNumKey]?.requestedAt || Date.now();
                        if (st.status !== 'offline') st.status = 'call';
                        isModified = true;
                        const isGeneral = qNumKey === 'general';
                        appendLog('border-rose-500', 'bg-rose-100 text-rose-600', isGeneral ? '조교호출' : '질문호출',
                            isGeneral ? `${st.name} 학생이 조교를 호출했습니다.` : `[${targetSeat}] ${st.name} 질문 요청`,
                            isGeneral ? `[${targetSeat}] 포탈에서 호출했습니다 · 확인 후 처리하세요.` : `${qNumKey}번 문항 설명 대기 중`,
                            'call', { seat: targetSeat, qNum }
                        );
                    });
                    Object.keys(st.calls).forEach(qNumKey => {
                        if (dbCalls[qNumKey]) return;
                        delete st.calls[qNumKey];
                        if (Object.keys(st.calls).length === 0 && st.status === 'call') st.status = 'idle';
                        removeLogsByTypeAndSeat('call', targetSeat, (qNumKey === 'general' ? 'general' : Number(qNumKey)) as any);
                        isModified = true;
                    });

                    Object.keys(dbRechecks).forEach(uid => {
                        if (st.rechecks[uid]) return;
                        st.rechecks[uid] = { ...dbRechecks[uid], seat: targetSeat };
                        isModified = true;
                        appendLog('border-indigo-500', 'bg-indigo-100 text-indigo-600', '재확인요청',
                            <span className="underline decoration-dotted cursor-pointer hover:text-indigo-600" onClick={() => setRecheckModal({ isOpen: true, seat: targetSeat, uid })}>{st.name}</span>,
                            `${dbRechecks[uid]?.qNum ?? ''}번 문항 · 직접 확인하세요.`, 'recheck', { seat: targetSeat, uid }
                        );
                    });
                    Object.keys(st.rechecks).forEach(uid => {
                        if (dbRechecks[uid]) return;
                        delete st.rechecks[uid];
                        removeLogsByTypeAndSeat('recheck', targetSeat, null, uid);
                        isModified = true;
                    });

                    const dbAwaySince = dbRecord.away_since ? new Date(dbRecord.away_since).getTime() : null;
                    if (dbAwaySince && !st.awaySince) {
                        st.awaySince = dbAwaySince; 
                        if (st.status !== 'offline') st.status = 'away'; 
                        isModified = true;
                        appendLog('border-amber-500', 'bg-amber-100 text-amber-700', '자리비움', `[${targetSeat}] ${st.name} 자리비움`, `학생이 자리를 비웠습니다.`, 'away', { seat: targetSeat });
                    } else if (!dbAwaySince && st.awaySince) {
                        st.awaySince = null; 
                        if (st.status === 'away') st.status = 'idle'; 
                        isModified = true;
                        removeLogsByTypeAndSeat('away', targetSeat);
                    }
                }
            }

            // 🌟 핵심 방어: 타임아웃 발생 시 완전히 퇴실 처리(삭제)하지 않고 '오프라인' 상태로 전환
            for (const [seat, dbRecord] of Array.from(dbSeats.entries())) {
                if (!current[seat] || current[seat].dummy || current[seat].type === 'reserved' || !dbRecord.last_seen_at) continue;
                
                const sinceLastSeen = Date.now() - new Date(dbRecord.last_seen_at).getTime();
                
                if (sinceLastSeen > HEARTBEAT_TIMEOUT_MS) {
                    if (current[seat].status !== 'offline') {
                        current[seat].status = 'offline';
                        isModified = true;
                        appendLog('border-slate-500', 'bg-slate-100 text-slate-500', '오프라인', `[${seat}] ${current[seat].name} 화면 꺼짐`, `학생 패드의 화면이 꺼졌거나 앱이 백그라운드로 내려갔습니다.`);
                    }
                } else if (sinceLastSeen <= HEARTBEAT_TIMEOUT_MS && current[seat].status === 'offline') {
                    // 패드 화면이 다시 켜져서 하트비트가 수신되면 오프라인 상태 해제
                    current[seat].status = 'idle';
                    isModified = true;
                    appendLog('border-emerald-500', 'bg-emerald-100 text-emerald-600', '복귀', `[${seat}] ${current[seat].name} 연결 복구`, `기기 연결이 정상적으로 복구되었습니다.`);
                }
            }

            Object.keys(current).forEach(uiSeat => {
                const isPendingDelete = pendingDeletesRef.current[uiSeat] && Date.now() < pendingDeletesRef.current[uiSeat];
                const isPendingMove = pendingMovesRef.current[uiSeat] && Date.now() < pendingMovesRef.current[uiSeat].expiresAt;
                if (!dbSeats.has(uiSeat) && !isPendingDelete && !isPendingMove && !current[uiSeat].dummy && current[uiSeat].type !== 'reserved') {
                    delete current[uiSeat]; isModified = true;
                }
            });

            if (isModified) updateStudents(current);
        }, 5000);
        return () => clearInterval(dbCrossValidationInterval);
    }, [isAuthorized, isMounted, updateStudents, appendLog, removeLogsByTypeAndSeat]);

    const recordTaStat = (key: string, mark: string) => {
        setTaStats(prev => {
            const next = { ...prev };
            if (!next[key]) next[key] = { total: 0, hint: 0, skip: 0 };
            next[key].total++;
            if (mark === 'hint') next[key].hint++; else if (mark === 'skip') next[key].skip++;
            return next;
        });
    };

    const handleTaActionFromOtherScreen = (payload: any) => {
        const { seat, action, qNum, taName, taClientId, mark, uid } = payload;
        const currentStudents = { ...studentsRef.current };

        if (action === 'force_cancel_call') {
            if (currentStudents[seat]?.calls) delete currentStudents[seat].calls[qNum];
            if (Object.keys(currentStudents[seat]?.calls || {}).length === 0 && currentStudents[seat]?.status !== 'offline') currentStudents[seat].status = 'idle';
            removeLogsByTypeAndSeat('call', seat, qNum);
            appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '호출해제', `[${seat}] ${qNum}번 문항 지도 종료`, `${taName || '총책임자'} · ${mark === 'hint' ? '힌트 제공 후 종료' : mark === 'skip' ? '설명 없이 넘어감' : '지도 종료'}`);
            recordTaStat(taClientId || taName || '총책임자', mark);
        } else if (action === 'force_return_to_seat') {
            if (currentStudents[seat]) { 
                if (currentStudents[seat].status !== 'offline') currentStudents[seat].status = 'idle'; 
                currentStudents[seat].awaySince = null; 
            }
            removeLogsByTypeAndSeat('away', seat);
            appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '복귀처리', `[${seat}] 자리비움 해제`, `다른 화면에서 해제했습니다.`);
        } else if (action === 'force_checkout' || action === 'force_checkout_by_ta') {
            if (currentStudents[seat]) {
                const st = currentStudents[seat];
                if (st.studentId) endTodaySession(supabaseClient, st.studentId, getKSTDateString());
                appendLog(action === 'force_checkout_by_ta' ? 'border-rose-600' : 'border-slate-800', action === 'force_checkout_by_ta' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white', action === 'force_checkout_by_ta' ? '강제퇴실' : '퇴실완료', `[${seat}] ${st.name} 퇴실 처리`, `다른 화면에서 처리되었습니다.`);
                removeLogsByTypeAndSeat('call', seat); removeLogsByTypeAndSeat('submit', seat); removeLogsByTypeAndSeat('away', seat); removeLogsByTypeAndSeat('recheck', seat);
                delete currentStudents[seat]; pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
            }
        } else if (action === 'resolve_recheck') {
            if (currentStudents[seat] && currentStudents[seat].rechecks) {
                delete currentStudents[seat].rechecks[uid];
            }
            removeLogsByTypeAndSeat('recheck', seat, null, uid);
        }
        updateStudents(currentStudents);
    };

    useEffect(() => {
        if (!isAuthorized) return;
        
        const myTenantId = localStorage.getItem("logica_tenant_id") || "hq";
        const channelName = `${CLINIC_ROOM}_${myTenantId}`;
        
        const channel = supabaseClient.channel(channelName);
        channelRef.current = channel;

        channel
            .on('presence', { event: 'sync' }, () => { if (syncPresenceRef.current) syncPresenceRef.current(channel.presenceState()); })
            .on('broadcast', { event: 'student_action' }, ({ payload }: { payload: any }) => {
                const { seat, data, action } = payload;
                const st = { ...studentsRef.current };
                const activeSeat = Object.keys(st).find(s => st[s].studentId === data.studentId) || seat;

                if (action === 'depart') {
                    if (st[activeSeat]) {
                        appendLog('border-indigo-400', 'bg-indigo-50 text-indigo-600', '화면전환', `[${activeSeat}] ${st[activeSeat].name} 이동`, `포탈로 이동했거나 대기 중입니다.`);
                    }
                } else if (st[activeSeat]) {
                    // 활동 신호가 들어왔다는 건 앱이 켜져있다는 뜻이므로 상태 복구 (최종 안전장치)
                    if (st[activeSeat].status === 'offline') {
                        st[activeSeat].status = 'idle';
                    }

                    if (action === 'update_activity') { 
                        st[activeSeat].activity = data.activity; 
                        appendLog('border-blue-400', 'bg-blue-50 text-blue-700', '활동갱신', `[${activeSeat}] ${data.name || '학생'} 상태 갱신`, data.activity, 'update_activity', { seat: activeSeat });
                    }
                    else if (action === 'typing') {
                        st[activeSeat].isTyping = true;
                        if (st[activeSeat].typingTimeout) clearTimeout(st[activeSeat].typingTimeout);
                        st[activeSeat].typingTimeout = setTimeout(() => {
                            if (studentsRef.current[activeSeat]) updateStudents({ ...studentsRef.current, [activeSeat]: { ...studentsRef.current[activeSeat], isTyping: false } });
                        }, 2000);
                    } else if (action === 'call') {
                        st[activeSeat].calls[data.qNum] = Date.now(); st[activeSeat].status = 'call';
                        if (data.qNum === 'general') {
                            appendLog('border-rose-500', 'bg-rose-100 text-rose-600', '조교호출', `${data.name} 학생이 조교를 호출했습니다.`, `[${activeSeat}] 포탈에서 호출했습니다 · 확인 후 처리하세요.`, 'call', { seat: activeSeat, qNum: data.qNum });
                        } else {
                            appendLog('border-rose-500', 'bg-rose-100 text-rose-600', '질문호출', `[${activeSeat}] ${data.name} 질문 요청`, `${data.qNum}번 문항 설명 대기 중`, 'call', { seat: activeSeat, qNum: data.qNum });
                        }
                    } else if (action === 'cancel_call') {
                        delete st[activeSeat].calls[data.qNum];
                        if (Object.keys(st[activeSeat].calls).length === 0 && st[activeSeat].status !== 'offline') st[activeSeat].status = 'idle';
                        removeLogsByTypeAndSeat('call', activeSeat, data.qNum);
                    } else if (action === 'away') {
                        st[activeSeat].status = 'away'; st[activeSeat].awaySince = Date.now();
                        appendLog('border-amber-500', 'bg-amber-100 text-amber-700', '자리비움', `[${activeSeat}] ${data.name} 자리비움`, `학생이 자리를 비웠습니다.`, 'away', { seat: activeSeat });
                    } else if (action === 'cancel_away') {
                        st[activeSeat].status = 'idle'; st[activeSeat].awaySince = null;
                        removeLogsByTypeAndSeat('away', activeSeat);
                    } else if (action === 'hint') {
                        st[activeSeat].status = 'hint'; st[activeSeat].lastHint = { qNum: data.qNum, level: data.level, at: Date.now() }; st[activeSeat].totalHints = (st[activeSeat].totalHints || 0) + 1;
                        setTimeout(() => { if (studentsRef.current[activeSeat]?.status === 'hint') updateStudents({ ...studentsRef.current, [activeSeat]: { ...studentsRef.current[activeSeat], status: 'idle' } }); }, 10000);
                    } else if (action === 'submit') {
                        st[activeSeat].status = 'submitted'; st[activeSeat].score = data.score;
                        appendLog('border-emerald-500', 'bg-emerald-100 text-emerald-600', '답안제출', `[${activeSeat}] ${data.name} 제출`, `최종 점수 [${data.score} / 5].`);
                    } else if (action === 'recheck_request') {
                        if (!st[activeSeat].rechecks) st[activeSeat].rechecks = {};
                        st[activeSeat].rechecks[data.uid] = { ...data, seat: activeSeat };
                        appendLog('border-indigo-500', 'bg-indigo-100 text-indigo-600', '재확인요청',
                            <span className="underline decoration-dotted cursor-pointer hover:text-indigo-600" onClick={() => setRecheckModal({ isOpen: true, seat: activeSeat, uid: data.uid })}>{data.name}</span>,
                            `${data.qNum}번 문항 · 직접 확인하세요.`, 'recheck', { seat: activeSeat, uid: data.uid }
                        );
                    } else if (action === 'end_clinic_request') {
                        st[activeSeat].endRequestPending = true;
                        appendLog('border-rose-500', 'bg-rose-100 text-rose-600', '종료요청',
                            <span className="underline decoration-dotted cursor-pointer hover:text-rose-600" onClick={() => setEndRequestModal({ isOpen: true, seat: activeSeat })}>{data.name}</span>,
                            `클리닉 종료를 요청했습니다 · 클릭해서 승인/거부하세요.`, 'end_request', { seat: activeSeat }
                        );
                    } else if (action === 'end_clinic_cancel_request') {
                        st[activeSeat].endRequestPending = false;
                        removeLogsByTypeAndSeat('end_request', activeSeat);
                    }
                }
                updateStudents(st);
            })
            .on('broadcast', { event: 'ta_action' }, ({ payload }: { payload: any }) => handleTaActionFromOtherScreen(payload))
            .on('broadcast', { event: SEAT_LAYOUT_UPDATED_EVENT }, () => loadSeats())
            .subscribe((status: string) => setConnectionStatus(status === 'SUBSCRIBED' ? 'connected' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : 'connecting'));

        return () => { supabaseClient.removeChannel(channel); };
    }, [isAuthorized, updateStudents, appendLog, removeLogsByTypeAndSeat, loadSeats]);

    const syncActiveStudentsFromPresence = (presenceState: any) => {
        const currentStudents = { ...studentsRef.current };
        const presenceByStudentId: any = {};
        const newActiveTAs: any = {};

        let hasEditor = false;
        Object.values(presenceState).forEach((metas: any) => {
            let latestMeta = metas.reduce((prev: any, curr: any) => (curr.updatedAt || 0) > (prev.updatedAt || 0) ? curr : prev, metas[0]);
            if (!latestMeta) return;

            if (latestMeta.role === 'editor') {
                hasEditor = true;
                return;
            }
            if (latestMeta.role === 'ta') {
                const key = latestMeta.clientId || latestMeta.name;
                newActiveTAs[key] = { name: latestMeta.name || '이름 미상', joined_at: latestMeta.joined_at || Date.now(), handling: latestMeta.handling || null, clientId: latestMeta.clientId || key };
            } else if (latestMeta.studentId) {
                if (!presenceByStudentId[latestMeta.studentId] || latestMeta.updatedAt > presenceByStudentId[latestMeta.studentId].lastUpdatedAt) {
                    presenceByStudentId[latestMeta.studentId] = { ...latestMeta, lastUpdatedAt: latestMeta.updatedAt };
                }
            }
        });

        let isModified = false;
        Object.keys(currentStudents).forEach(seat => {
            const st = currentStudents[seat];
            if (st.dummy || !st.studentId || st.type === 'reserved') return;
            const pData = presenceByStudentId[st.studentId];
            if (pData) {
                st.lastUpdatedAt = pData.lastUpdatedAt;
                if (pData.activity && st.activity !== pData.activity) { st.activity = pData.activity; isModified = true; }
            }
        });
        setActiveTAs(newActiveTAs);
        setEditorLocked(hasEditor);
        if (isModified) updateStudents(currentStudents);
    };
    syncPresenceRef.current = syncActiveStudentsFromPresence;

    const checkClinicTimeExpiry = useCallback(() => {
        const current = { ...studentsRef.current };
        let isModified = false;
        Object.keys(current).forEach(seat => {
            const st = current[seat];
            if (st.dummy || st.type === 'reserved' || !st.studentId || !st.firstSeenAt || st.clinicDurationMs == null) return;
            if (Date.now() < st.firstSeenAt + st.clinicDurationMs) return;

            endTodaySession(supabaseClient, st.studentId, getKSTDateString());
            sendToStudent(seat, 'force_checkout');
            appendLog('border-slate-800', 'bg-slate-900 text-white', '시간종료', `[${seat}] ${st.name} 이용시간 종료`, `배정된 클리닉 시간이 모두 소진되어 자동 퇴실 처리되었습니다.`);
            removeLogsByTypeAndSeat('call', seat); removeLogsByTypeAndSeat('submit', seat); removeLogsByTypeAndSeat('away', seat); removeLogsByTypeAndSeat('recheck', seat); removeLogsByTypeAndSeat('end_request', seat);
            delete current[seat];
            pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
            isModified = true;
        });
        if (isModified) updateStudents(current);
    }, [updateStudents, appendLog, removeLogsByTypeAndSeat]);
    checkClinicTimeExpiryRef.current = checkClinicTimeExpiry;

    const checkReservationExpiry = useCallback(() => {
        const current = { ...studentsRef.current };
        let isModified = false;
        Object.keys(current).forEach(seat => {
            const st = current[seat];
            if (st.type === 'reserved' && Date.now() > st.expiresAt) {
                appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '예약만료', `[${seat}] ${st.name}`, `예약 시간이 초과되어 예약이 종료되었습니다.`);
                if (st.studentId) supabaseClient.from('clinic_reservation').delete().eq('student_id', st.studentId).eq('session_date', getKSTDateString()).then();
                delete current[seat];
                isModified = true;
            }
        });
        if (isModified) updateStudents(current);
    }, [updateStudents, appendLog]);
    checkReservationExpiryRef.current = checkReservationExpiry;

    useEffect(() => {
        const handlePointerMove = (e: PointerEvent) => {
            if (!draggedSeat && !draggedListStudent) return;
            const ghost = document.getElementById('drag-ghost');
            if (ghost) {
                ghost.style.left = `${e.clientX - dragOffsetRef.current.x}px`;
                ghost.style.top = `${e.clientY - dragOffsetRef.current.y}px`;
            }
            const elements = document.elementsFromPoint(e.clientX, e.clientY);
            const cell = elements.find(el => el.getAttribute('data-seat'));
            document.querySelectorAll('[data-seat]').forEach(el => el.classList.remove('ring-4', 'ring-indigo-400'));
            if (cell) {
                const targetSeat = cell.getAttribute('data-seat');
                if (targetSeat && targetSeat !== draggedSeat && !studentsRef.current[targetSeat]) {
                    cell.classList.add('ring-4', 'ring-indigo-400');
                }
            }
        };

        const handlePointerUp = async (e: PointerEvent) => {
            if (!draggedSeat && !draggedListStudent) return;
            document.querySelectorAll('[data-seat]').forEach(el => el.classList.remove('ring-4', 'ring-indigo-400'));
            const elements = document.elementsFromPoint(e.clientX, e.clientY);
            const cell = elements.find(el => el.getAttribute('data-seat'));
            
            if (draggedListStudent) {
                if (cell) {
                    const targetSeat = cell.getAttribute('data-seat')!;
                    if (!studentsRef.current[targetSeat]) {
                        setReservationModal({ isOpen: true, seat: targetSeat, student: draggedListStudent });
                    } else alert('이미 다른 학생이 있는 자리입니다.');
                }
                setDraggedListStudent(null);
                setGhostRect(null);
                return;
            }

            if (cell) {
                const targetSeat = cell.getAttribute('data-seat')!;
                if (targetSeat !== draggedSeat && !studentsRef.current[targetSeat] && !registeredSeatsRef.current.has(targetSeat)) {
                    alert(`${targetSeat}번 좌석엔 등록된 패드가 없습니다. 학생이 인계받을 화면이 없어 이동할 수 없습니다.\n먼저 /clinic-pad-registry에서 그 좌석에 패드를 등록해주세요.`);
                } else if (targetSeat !== draggedSeat && !studentsRef.current[targetSeat]) {
                    const studentId = studentsRef.current[draggedSeat!]?.studentId;
                    const sessionId = studentsRef.current[draggedSeat!]?.sessionId;
                    const sName = studentsRef.current[draggedSeat!]?.name || '학생';

                    if (studentId && sessionId) {
                        const RELOCATE_DEBOUNCE_MS = 5000;
                        const sinceLastRelocate = Date.now() - lastRelocateAtRef.current;
                        if (sinceLastRelocate < RELOCATE_DEBOUNCE_MS) {
                            const remainingSec = Math.ceil((RELOCATE_DEBOUNCE_MS - sinceLastRelocate) / 1000);
                            alert(`방금 다른 좌석 이동이 있었습니다. ${remainingSec}초 후 다시 시도해주세요.`);
                        } else if (window.confirm(`${sName} 학생을 ${draggedSeat}에서 ${targetSeat}으로 이동하시겠습니까?\n(실제로 그 자리 패드에서 이어받아야 이동이 완료됩니다)`)) {
                            const token = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
                            const expiresAt = new Date(Date.now() + 60000).toISOString();
                            lastRelocateAtRef.current = Date.now();
                            await supabaseClient.from('clinic_session_state')
                                .update({ transfer_token: token, transfer_token_expires_at: expiresAt })
                                .eq('id', sessionId);
                            sendToStudent(draggedSeat!, 'relocated_away', {});
                            sendToStudent(targetSeat, 'relocated_in', { studentId, name: sName, token });
                            appendLog('border-indigo-500', 'bg-indigo-100 text-indigo-600', '좌석이동', `${sName} 학생`, `[${draggedSeat}] → [${targetSeat}] 이동 요청 — 목적지 패드에서 인계 대기 중`);
                        }
                    }
                } else if (studentsRef.current[targetSeat] && targetSeat !== draggedSeat) {
                    alert('빈 자리로만 옮길 수 있습니다.');
                }
            }
            setDraggedSeat(null); setSelectedSeatForMove(null); setGhostRect(null);
        };

        if (draggedSeat || draggedListStudent) {
            document.addEventListener('pointermove', handlePointerMove);
            document.addEventListener('pointerup', handlePointerUp);
        }
        return () => {
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerUp);
        };
    }, [draggedSeat, draggedListStudent, updateStudents, appendLog]);

    const handlePointerDown = (e: React.PointerEvent, seat: string) => {
        if (e.button !== 0 || !activeStudents[seat] || (e.target as HTMLElement).closest('button')) return;
        const st = activeStudents[seat];
        const hasPendingRecheck = !!(st.rechecks && Object.keys(st.rechecks).length > 0);
        if (st.type !== 'reserved' && ((st.status && st.status !== 'idle') || hasPendingRecheck)) {
            const statusLabel = hasPendingRecheck ? '채점 대기' : st.status === 'away' ? '자리비움' : st.status === 'call' ? '호출' : st.status === 'hint' ? '힌트 진행' : st.status === 'submitted' ? '제출' : st.status;
            alert(`[${statusLabel}] 상태인 학생은 자리를 이동할 수 없습니다. 상태 해제 후 다시 시도해주세요.`);
            return;
        }
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const scale = target.offsetWidth > 0 ? rect.width / target.offsetWidth : 1;
        dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        setGhostRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, scale });
        setDraggedSeat(seat); setSelectedSeatForMove(seat); e.preventDefault();
    };

    const handleListPointerDown = (e: React.PointerEvent, student: any) => {
        if (e.button !== 0) return;
        const anySeatEl = document.querySelector('[data-seat]') as HTMLElement | null;
        const rect = anySeatEl?.getBoundingClientRect();
        const width = rect?.width || seatWidth;
        const height = rect?.height || seatHeight;
        dragOffsetRef.current = { x: width / 2, y: height / 2 };
        setGhostRect({ left: e.clientX - width / 2, top: e.clientY - height / 2, width, height, scale: 1 });
        setDraggedListStudent(student); e.preventDefault();
    };

    const confirmReservation = async (timeStr: string) => {
        const { seat, student } = reservationModal;
        if (!seat || !student || !timeStr) return;
        const [h, m] = timeStr.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) { alert('시간을 올바르게 입력해주세요.'); return; }

        const reservedDate = new Date();
        reservedDate.setHours(h, m, 0, 0);
        const reservedFor = reservedDate.getTime();
        const expiresAt = reservedFor + RESERVATION_GRACE_MS;
        const todayStr = getKSTDateString();

        const currentStudents = { ...studentsRef.current };
        currentStudents[seat] = {
            type: 'reserved', name: student.name, classes: student.classes, studentId: student.id,
            reservedFor, expiresAt, calls: {}, totalCalls: 0, totalHints: 0
        };
        updateStudents(currentStudents);
        appendLog('border-indigo-500', 'bg-indigo-100 text-indigo-700', '예약', `[${seat}] ${student.name}`, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} 예약 등록`);
        setReservationModal({ isOpen: false, seat: null, student: null });

        await supabaseClient.from('clinic_reservation').upsert({
            student_id: student.id, student_name: student.name, classes: student.classes, seat, session_date: todayStr,
            reserved_for: new Date(reservedFor).toISOString(), expires_at: new Date(expiresAt).toISOString()
        }, { onConflict: 'student_id, session_date' });
    };

    const cancelReservation = async (seat: string) => {
        const st = studentsRef.current[seat];
        const currentStudents = { ...studentsRef.current };
        delete currentStudents[seat];
        updateStudents(currentStudents);
        if (st?.studentId) await supabaseClient.from('clinic_reservation').delete().eq('student_id', st.studentId).eq('session_date', getKSTDateString());
    };

    const adjustClinicTime = async (seat: string, deltaMinutes: number) => {
        const st = studentsRef.current[seat];
        if (!st) return;
        const newDuration = Math.max(0, (st.clinicDurationMs || DEFAULT_CLINIC_DURATION_MS) + (deltaMinutes * 60 * 1000));
        const currentStudents = { ...studentsRef.current };
        currentStudents[seat].clinicDurationMs = newDuration;
        updateStudents(currentStudents);
        pendingTimeAdjustRef.current[seat] = { value: newDuration, expiresAt: Date.now() + 3000 };
        
        if (st.studentId) await supabaseClient.from('clinic_session_state').update({ duration_ms: newDuration }).eq('student_id', st.studentId);
        sendToStudent(seat, 'adjust_clinic_time', { deltaMs: deltaMinutes * 60 * 1000, newDuration, studentId: st.studentId || null });
    };

    const confirmForceCheckout = () => {
        const seat = forceCheckoutModal.seat;
        if (!seat) return;
        const currentStudents = { ...studentsRef.current };
        if (currentStudents[seat]) {
            const st = currentStudents[seat];
            sendToStudent(seat, 'force_checkout_by_ta');
            if (st.studentId) endTodaySession(supabaseClient, st.studentId, getKSTDateString());
            removeLogsByTypeAndSeat('call', seat); delete currentStudents[seat];
            pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
        }
        updateStudents(currentStudents);
        setForceCheckoutModal({ isOpen: false, seat: null });
    };

    const resolveEndRequest = async (approved: boolean) => {
        const seat = endRequestModal.seat;
        if (!seat) return;
        const st = studentsRef.current[seat];
        setEndRequestModal({ isOpen: false, seat: null });
        if (!st) return;

        removeLogsByTypeAndSeat('end_request', seat);

        if (approved) {
            sendToStudent(seat, 'end_clinic_resolved', { approved: true, studentId: st.studentId || null });
            if (st.studentId) await resolveEndSessionForStudent(supabaseClient, st.studentId, getKSTDateString(), true);
            const currentStudents = { ...studentsRef.current };
            appendLog('border-slate-800', 'bg-slate-900 text-white', '퇴실완료', `[${seat}] ${st.name} 퇴실`, `종료 요청이 승인되었습니다.`);
            delete currentStudents[seat];
            pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
            updateStudents(currentStudents);
        } else {
            const cooldownUntil = Date.now() + END_REQUEST_COOLDOWN_MS;
            sendToStudent(seat, 'end_clinic_resolved', { approved: false, cooldownUntil, studentId: st.studentId || null });
            if (st.studentId) await resolveEndSessionForStudent(supabaseClient, st.studentId, getKSTDateString(), false);
            const currentStudents = { ...studentsRef.current };
            if (currentStudents[seat]) currentStudents[seat].endRequestPending = false;
            appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '종료요청거부', `[${seat}] ${st.name}`, `종료 요청을 거부했습니다 (5분 쿨타임).`);
            updateStudents(currentStudents);
        }
    };

    const resolveRecheck = async (seat: string, uid: string, verdict: 'correct' | 'incorrect') => {
        const st = studentsRef.current[seat];
        if (!st) return;

        if (verdict === 'correct') {
           const targetRecheck = st.rechecks?.[uid];
           if (targetRecheck) {
               if (targetRecheck.recordId) {
                   await supabaseClient.from('student_incorrect_record').delete().eq('record_id', targetRecheck.recordId);
               } else if (targetRecheck.tqId || targetRecheck.questionId) {
                   const filterCol = targetRecheck.tqId ? 'tq_id' : 'question_id';
                   const filterVal = targetRecheck.tqId ?? targetRecheck.questionId;
                   await supabaseClient.from('student_incorrect_record').delete()
                       .eq('student_id', st.studentId)
                       .eq(filterCol, filterVal);
               }
           }
        }

        sendToStudent(seat, 'resolve_recheck', { uid, verdict });

        if (st.sessionId) {
            await clearActiveRecheck(supabaseClient, st.sessionId, uid);
        }

        const currentStudents = { ...studentsRef.current };
        if (currentStudents[seat] && currentStudents[seat].rechecks) {
            delete currentStudents[seat].rechecks[uid];
        }
        removeLogsByTypeAndSeat('recheck', seat, null, uid);
        updateStudents(currentStudents);
        setRecheckModal({ isOpen: false, seat: null, uid: null });
    };

    const taAction = (seat: string, type: string, qNum: any = null) => {
        const currentStudents = { ...studentsRef.current };
        if (type === 'cancel_call') {
            if (qNum !== null) {
                if (currentStudents[seat]?.calls) delete currentStudents[seat].calls[qNum];
                if (Object.keys(currentStudents[seat]?.calls || {}).length === 0 && currentStudents[seat]?.status !== 'offline') currentStudents[seat].status = 'idle';
                removeLogsByTypeAndSeat('call', seat, qNum);
                sendToStudent(seat, 'force_cancel_call', { qNum });
                recordTaStat('총책임자', '');
                if (currentStudents[seat]?.sessionId) clearActiveCall(supabaseClient, currentStudents[seat].sessionId, qNum);
            }
        } else if (type === 'clear_away') {
            if (currentStudents[seat]) { 
                if (currentStudents[seat].status !== 'offline') currentStudents[seat].status = 'idle'; 
                currentStudents[seat].awaySince = null; 
            }
            removeLogsByTypeAndSeat('away', seat); sendToStudent(seat, 'force_return_to_seat');
            if (currentStudents[seat]?.sessionId) clearAway(supabaseClient, currentStudents[seat].sessionId);
        } else if (type === 'confirm_checkout') {
            if (currentStudents[seat]) {
                const st = currentStudents[seat]; sendToStudent(seat, 'force_checkout');
                if (st.studentId) endTodaySession(supabaseClient, st.studentId, getKSTDateString());
                removeLogsByTypeAndSeat('submit', seat); delete currentStudents[seat];
                pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
            }
        } else if (type === 'force_refresh') {
            sendToStudent(seat, 'force_refresh');
            appendLog('border-blue-500', 'bg-blue-100 text-blue-700', '새로고침', `[${seat}] 기기 새로고침`, `학생 패드에 강제 새로고침 신호를 전송했습니다.`);
        }
        updateStudents(currentStudents);
    };

    return {
        isAuthorized, authMessage,
        now, startedAt, connectionStatus, isMounted,
        activeStudents, activeTAs, taStats, logs,
        allStudents, leftTab, setLeftTab, expandedClasses, setExpandedClasses,
        clinicRecords, expandedRecords, toggleRecordExpand, fetchClinicRecords,
        draggedSeat, draggedListStudent, selectedSeatForMove,
        forceCheckoutModal, setForceCheckoutModal, recheckModal, setRecheckModal,
        endRequestModal, setEndRequestModal, resolveEndRequest,
        reservationModal, setReservationModal, confirmReservation, cancelReservation,
        handlePointerDown, handleListPointerDown, adjustClinicTime, confirmForceCheckout, taAction, sendToStudent, removeLogsByTypeAndSeat, appendLog,
        resolveRecheck,
        ghostRect,
        seats, seatObjs, canvasWidth, canvasHeight, seatWidth, seatHeight, editorLocked
    };
}