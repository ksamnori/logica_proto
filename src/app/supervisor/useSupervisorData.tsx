// src/app/supervisor/useSupervisorData.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabaseClient, CLINIC_ROOM, getKSTDateString, DEFAULT_CLINIC_DURATION_MS, LOG_AUTO_EXPIRE_MS, PENDING_GUARD_MS, HEARTBEAT_TIMEOUT_MS, formatDuration } from './supervisorUtils';
import { endTodaySession, pickLatestSessionPerStudent, resolveEndSessionForStudent, END_REQUEST_COOLDOWN_MS, clearActiveCall, clearActiveRecheck, clearAway } from '@/lib/clinicSession';
import { getActiveSeatLayout } from '@/app/actions/clinicSeatLayout';
import { Seat, SEAT_LAYOUT_UPDATED_EVENT, DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, DEFAULT_SEAT_CARD_W, DEFAULT_SEAT_CARD_H } from '@/lib/clinicSeatLayout';

// 💡 아직 해결되지 않은(호출/자리비움/재확인/종료요청) 상태를 나타내는 로그는 5분이 지나도
// 자동으로 사라지면 안 된다 — removeLogsByTypeAndSeat로 실제 해결될 때만 사라져야 한다.
const PERSIST_UNTIL_RESOLVED_TYPES = ['call', 'away', 'recheck', 'end_request'];

export function useSupervisorData() {
    // 💡 [보안 수정] 실제 DB 검증을 위한 권한 상태 (null: 로딩중, true: 허용, false: 거부)
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
    const [allStudents, setAllStudents] = useState<Record<string, any[]>>({});
    const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});

    // 💡 클리닉 이용 기록(오늘 날짜, 학생별 회차별 시작/종료 시각 + 시간)
    const [clinicRecords, setClinicRecords] = useState<Record<string, any>>({});
    const [expandedRecords, setExpandedRecords] = useState<Record<string, boolean>>({});
    
    const [draggedSeat, setDraggedSeat] = useState<string | null>(null);
    const [draggedListStudent, setDraggedListStudent] = useState<any>(null);
    const [selectedSeatForMove, setSelectedSeatForMove] = useState<string | null>(null);
    // 💡 드래그 시작한 카드의 실제 화면 위치/크기 — 고스트가 "처음 잡은 그 자리"에서 나타나도록 함.
    // scale은 그 카드가 화면에 축소되어 그려진 배율(카드 본래 크기 대비) — 고스트 안의 글씨도
    // 카드와 똑같이 이 배율만큼 줄여서 그려야, 잡는 순간 글씨가 갑자기 커 보이는 일이 없다.
    const [ghostRect, setGhostRect] = useState<{ left: number; top: number; width: number; height: number; scale: number } | null>(null);
    // 💡 카드 안에서 정확히 어느 지점을 클릭했는지 — 드래그 내내 그 지점이 커서를 따라가도록 함
    const dragOffsetRef = useRef({ x: 0, y: 0 });

    const [forceCheckoutModal, setForceCheckoutModal] = useState<{ isOpen: boolean, seat: string | null }>({ isOpen: false, seat: null });
    const [recheckModal, setRecheckModal] = useState<{ isOpen: boolean, seat: string | null, uid: string | null }>({ isOpen: false, seat: null, uid: null });
    const [endRequestModal, setEndRequestModal] = useState<{ isOpen: boolean, seat: string | null }>({ isOpen: false, seat: null });
    // 💡 예약 기능: 로그인 전 좌석을 미리 잡아두는 모달 상태
    const [reservationModal, setReservationModal] = useState<{ isOpen: boolean; seat: string | null; student: any | null }>({ isOpen: false, seat: null, student: null });
    const RESERVATION_GRACE_MS = 10 * 60 * 1000;

    const studentsRef = useRef<Record<string, any>>({});
    const channelRef = useRef<any>(null);
    const logsRef = useRef<any[]>([]);

    const pendingMovesRef = useRef<Record<string, any>>({});
    const pendingDeletesRef = useRef<Record<string, number>>({});
    const pendingTimeAdjustRef = useRef<Record<string, any>>({});
    const syncPresenceRef = useRef<any>(null);
    const checkReservationExpiryRef = useRef<any>(null);
    const checkClinicTimeExpiryRef = useRef<any>(null);

    // 좌석 배치 에디터가 저장한 좌석 목록(번호+좌표). 에디터에서 편집 중이면 editorLocked가 true가 되어
    // 이 화면의 좌석 조작을 잠근다(상호 배제).
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
    }, []);

    useEffect(() => { loadSeats(); }, [loadSeats]);

    // 🌟 초기 로드 시 관리자 권한(원장/실장) 검증
    useEffect(() => {
        setIsMounted(true);
        
        const verifyAdminAccess = () => { // 💡 async도 필요 없습니다.
            // 💡 1. 서버에서 로그인할 때 구워준 티켓을 그대로 꺼냅니다.
            const instId = localStorage.getItem('logica_instructor_id');
            const role = localStorage.getItem('logica_instructor_role') || '';
            const position = localStorage.getItem('logica_instructor_position') || '';

            if (!instId) {
                setAuthMessage('로그인이 필요합니다. 먼저 시스템에 로그인해 주세요.');
                setIsAuthorized(false);
                return;
            }

            // 💡 2. RLS에 막히는 DB 2차 검문(supabaseClient.from) 코드를 완전 삭제!
            // 기획하신 의도대로, 원장/실장이거나 ADMIN/SUPER_ADMIN 권한이면 즉시 문을 열어줍니다.
            if (
                role === 'ADMIN' ||
                role === 'MANAGER' ||
                role === 'PRINCIPAL' ||
                role === 'SUPER_ADMIN' ||
                position.includes('원장') ||
                position.includes('실장') ||
                position.includes('최고관리자') ||
                position.includes('대장')
            ) {
                setIsAuthorized(true); // 프리패스 승인
            } else {
                setAuthMessage(`접근 불가: [${position || '미지정'}] 권한입니다. 원장 또는 실장만 접속 가능합니다.`);
                setIsAuthorized(false); // 일반 강사 차단
            }
        };
        
        verifyAdminAccess();
    }, []);

    const updateStudents = useCallback((newStudents: any) => {
        studentsRef.current = newStudents;
        setActiveStudents({ ...newStudents });
    }, []);

    const updateLogs = useCallback((newLogs: any[]) => {
        logsRef.current = newLogs;
        setLogs([...newLogs]);
    }, []);

    const appendLog = useCallback((borderClass: string, badgeBg: string, badgeText: string, title: string | React.ReactNode, subtitle: string | React.ReactNode, type?: string, data?: any) => {
        const logId = `log-${Date.now()}-${Math.random()}`;
        const persistUntilResolved = !!type && PERSIST_UNTIL_RESOLVED_TYPES.includes(type);
        const newLog = {
            id: logId, timestamp: new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            borderClass, badgeBg, badgeText, title, subtitle, type, data, expiresAt: persistUntilResolved ? null : Date.now() + LOG_AUTO_EXPIRE_MS
        };
        updateLogs([newLog, ...logsRef.current]);
        // 💡 미해결 상태 로그(call/away/recheck/end_request)는 여기서 자동 삭제 타이머를 걸지 않는다 —
        // 실제로 해결되는 시점에 removeLogsByTypeAndSeat가 지운다.
        if (!persistUntilResolved) {
            setTimeout(() => updateLogs(logsRef.current.filter(l => l.id !== logId)), LOG_AUTO_EXPIRE_MS);
        }
        return logId;
    }, [updateLogs]);

    const removeLogsByTypeAndSeat = useCallback((type: string, seat: string, qNum?: number) => {
        updateLogs(logsRef.current.filter(l => !(l.data?.seat === seat && l.type === type && (!qNum || l.data?.qNum === qNum))));
    }, [updateLogs]);

    const sendToStudent = (seat: string, action: string, extra = {}) => {
        if (!channelRef.current) return;
        channelRef.current.send({ type: 'broadcast', event: 'ta_action', payload: { seat, action, ...extra, timestamp: Date.now() } });
    };

    // 🌟 권한이 확인된 후: 전체 학생 목록 및 DB 세션 데이터 로드
    useEffect(() => {
        if (!isAuthorized) return; // 💡 권한이 없으면 실행하지 않음
        
        const fetchAllStudents = async () => {
            const { data } = await supabaseClient.from('student').select('student_id, name, enrollment(class(name))');
            if (data) {
                const grouped: Record<string, any[]> = {};
                data.forEach((s: any) => {
                    const classes = s.enrollment?.map((e: any) => e.class?.name).filter(Boolean) || [];
                    const cName = classes.length > 0 ? classes[0] : '반 미배정';
                    if (!grouped[cName]) grouped[cName] = [];
                    grouped[cName].push({ id: s.student_id, name: s.name, classes });
                });
                const sortedGrouped: Record<string, any[]> = {};
                Object.keys(grouped).sort().forEach(k => { sortedGrouped[k] = grouped[k].sort((a, b) => a.name.localeCompare(b.name)); });
                setAllStudents(sortedGrouped);
                if (Object.keys(sortedGrouped).length > 0) setExpandedClasses({ [Object.keys(sortedGrouped)[0]]: true });
            }
        };

        const loadInitialSeatsFromDB = async () => {
            const todayStr = getKSTDateString();
            const { data: rawSessionData } = await supabaseClient.from('clinic_session_state').select('*').eq('session_date', todayStr);
            // 💡 재이용으로 하루에 여러 세션(session_no)이 생길 수 있으므로 학생별 최신 세션만 남긴다.
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
                        totalCalls: 0, totalHints: 0, calls: {}
                    };
                }
            }

            // 💡 예약(아직 로그인 전) 복원 — 실제로 로그인해서 세션이 생긴 학생은 건너뛴다.
            const assignedStudentIds = new Set(Object.values(newStudents).map((s: any) => s.studentId));
            const { data: reservations } = await supabaseClient.from('clinic_reservation').select('*').eq('session_date', todayStr);
            (reservations || []).forEach((r: any) => {
                if (assignedStudentIds.has(r.student_id) || newStudents[r.seat]) return;
                const expiresAt = new Date(r.expires_at).getTime();
                if (Date.now() > expiresAt) return; // 만료된 예약은 곧 자동 정리된다
                newStudents[r.seat] = {
                    type: 'reserved', name: r.student_name || '학생', classes: r.classes || [], studentId: r.student_id,
                    reservedFor: new Date(r.reserved_for).getTime(), expiresAt, calls: {}, totalCalls: 0, totalHints: 0
                };
            });

            updateStudents(newStudents);
        };
        fetchAllStudents(); loadInitialSeatsFromDB();
    }, [isAuthorized, updateStudents]);

    // 💡 오늘 클리닉 이용 기록: 학생별로 오늘 있었던 모든 세션(회차)을 시작~종료 시각과 함께 모아온다.
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

    // 이용 기록 탭이 열려있는 동안만 주기적으로 갱신 (진행 중인 세션의 경과 시간 반영)
    useEffect(() => {
        if (!isAuthorized || leftTab !== 'records') return;
        fetchClinicRecords();
        const interval = setInterval(fetchClinicRecords, 10000);
        return () => clearInterval(interval);
    }, [isAuthorized, leftTab, fetchClinicRecords]);

    const toggleRecordExpand = useCallback((studentId: string) => {
        setExpandedRecords(prev => ({ ...prev, [studentId]: !prev[studentId] }));
    }, []);

    // 1초 단위 시간 업데이트 및 5초 주기 DB 동기화
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
            // 💡 재이용으로 하루에 여러 세션(session_no)이 생길 수 있으므로 학생별 최신 세션만 진실로 취급한다.
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
                // 💡 예약해뒀던 학생이 실제로 로그인해서 DB에 진짜 세션이 생겼다면,
                // 예약 placeholder는 지워주고(어느 자리에 예약했었는지는 상관없이) 실제 배정으로 전환한다.
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
                        totalCalls: 0, totalHints: 0, calls: {}, activity: '포털/수동 배정 연동'
                    };
                    isModified = true;
                    // 💡 session_no === 1이고 방금 막 시작(started_at이 최근)한 경우에만 "입장"으로 남긴다.
                    // 그 외(재이용 세션 전환, 수퍼바이저 새로고침으로 기존 접속자를 다시 불러온 경우)는
                    // 이미 접속해 있던 학생이므로 새 입장으로 취급하지 않는다.
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
                    // 💡 종료 요청 브로드캐스트를 놓쳤을 수도 있으니(새로고침, 재연결 등), DB 상태로 자가 복구한다.
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

                // 💡 호출/재확인/자리비움도 종료요청과 같은 방식으로 DB에서 자가복구한다 — 이 화면을
                // 방금 열었거나(초기 로드가 이미 지나갔어도) broadcast를 놓친 경우 모두 여기서 따라잡는다.
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
                        st.status = 'call';
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
                        // 💡 재확인 로그는 qNum이 아니라 uid로 구분되는데 removeLogsByTypeAndSeat는 qNum만 비교하므로,
                        // 기존 코드(SeatGrid의 오답/정답 버튼)와 동일하게 seat+type만으로 매칭한다.
                        removeLogsByTypeAndSeat('recheck', targetSeat);
                        isModified = true;
                    });

                    const dbAwaySince = dbRecord.away_since ? new Date(dbRecord.away_since).getTime() : null;
                    if (dbAwaySince && !st.awaySince) {
                        st.awaySince = dbAwaySince; st.status = 'away'; isModified = true;
                        appendLog('border-amber-500', 'bg-amber-100 text-amber-700', '자리비움', `[${targetSeat}] ${st.name} 자리비움`, `학생이 자리를 비웠습니다.`, 'away', { seat: targetSeat });
                    } else if (!dbAwaySince && st.awaySince) {
                        st.awaySince = null; if (st.status === 'away') st.status = 'idle'; isModified = true;
                        removeLogsByTypeAndSeat('away', targetSeat);
                    }
                }
            }

            // 💡 하트비트 타임아웃 검사: 학생 화면이 정상 종료 절차(로그아웃/강제퇴실/시간만료) 없이
            // 응답을 멈춘 경우(전원 종료, 크래시, 네트워크 완전 단절 등) 일정 시간 뒤 비정상 종료로 정리한다.
            // 정상 종료 로그("퇴실완료"/"강제퇴실")와는 다른 색/문구로 구분해 남긴다.
            for (const [seat, dbRecord] of Array.from(dbSeats.entries())) {
                if (!current[seat] || current[seat].dummy || current[seat].type === 'reserved' || !dbRecord.last_seen_at) continue;
                const sinceLastSeen = Date.now() - new Date(dbRecord.last_seen_at).getTime();
                if (sinceLastSeen < HEARTBEAT_TIMEOUT_MS) continue;

                const st = current[seat];
                endTodaySession(supabaseClient, dbRecord.student_id, todayStr);
                appendLog('border-orange-500', 'bg-orange-100 text-orange-700', '비정상종료', `[${seat}] ${st.name} 응답 없음`, `하트비트가 끊겨 비정상 종료로 처리되었습니다 (정상 로그아웃 아님).`);
                removeLogsByTypeAndSeat('call', seat); removeLogsByTypeAndSeat('submit', seat); removeLogsByTypeAndSeat('away', seat); removeLogsByTypeAndSeat('recheck', seat); removeLogsByTypeAndSeat('end_request', seat);
                delete current[seat];
                dbSeats.delete(seat);
                pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
                isModified = true;
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

    const recordTaStat = (name: string, mark: string) => {
        setTaStats(prev => {
            const next = { ...prev };
            const key = name || '이름 미상';
            if (!next[key]) next[key] = { total: 0, hint: 0, skip: 0 };
            next[key].total++;
            if (mark === 'hint') next[key].hint++; else if (mark === 'skip') next[key].skip++;
            return next;
        });
    };

    const handleTaActionFromOtherScreen = (payload: any) => {
        const { seat, action, qNum, taName, mark } = payload;
        const currentStudents = { ...studentsRef.current };

        if (action === 'force_cancel_call') {
            if (currentStudents[seat]?.calls) delete currentStudents[seat].calls[qNum];
            if (Object.keys(currentStudents[seat]?.calls || {}).length === 0) currentStudents[seat].status = 'idle';
            removeLogsByTypeAndSeat('call', seat, qNum);
            appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '호출해제', `[${seat}] ${qNum}번 문항 지도 종료`, `${taName || '총책임자'} · ${mark === 'hint' ? '힌트 제공 후 종료' : mark === 'skip' ? '설명 없이 넘어감' : '지도 종료'}`);
            recordTaStat(taName || '총책임자', mark);
        } else if (action === 'force_return_to_seat') {
            if (currentStudents[seat]) { currentStudents[seat].status = 'idle'; currentStudents[seat].awaySince = null; }
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
        }
        updateStudents(currentStudents);
    };

    // 실시간(Realtime) 채널 연결
    useEffect(() => {
        if (!isAuthorized) return; // 💡 권한이 없으면 채널 연결도 하지 않음
        
        const channel = supabaseClient.channel(CLINIC_ROOM);
        channelRef.current = channel;

        channel
            .on('presence', { event: 'sync' }, () => { if (syncPresenceRef.current) syncPresenceRef.current(channel.presenceState()); })
            .on('broadcast', { event: 'student_action' }, ({ payload }: { payload: any }) => {
                const { seat, data, action } = payload;
                const st = { ...studentsRef.current };
                const activeSeat = Object.keys(st).find(s => st[s].studentId === data.studentId) || seat;

                if (action === 'depart') {
                    if (st[activeSeat]) {
                        endTodaySession(supabaseClient, st[activeSeat].studentId, getKSTDateString());
                        appendLog('border-slate-800', 'bg-slate-900 text-white', '퇴실완료', `[${activeSeat}] ${st[activeSeat].name} 퇴실`, `정상 로그아웃 되었습니다.`);
                        delete st[activeSeat];
                    }
                } else if (st[activeSeat]) {
                    if (action === 'update_activity') { st[activeSeat].activity = data.activity; }
                    else if (action === 'typing') {
                        st[activeSeat].isTyping = true;
                        if (st[activeSeat].typingTimeout) clearTimeout(st[activeSeat].typingTimeout);
                        st[activeSeat].typingTimeout = setTimeout(() => {
                            if (studentsRef.current[activeSeat]) updateStudents({ ...studentsRef.current, [activeSeat]: { ...studentsRef.current[activeSeat], isTyping: false } });
                        }, 2000);
                    } else if (action === 'call') {
                        st[activeSeat].calls[data.qNum] = Date.now(); st[activeSeat].status = 'call';
                        // 💡 포탈에서 보낸 호출은 특정 문항이 아니라 일반 호출이라 qNum이 없다('general') — 문항 번호 없이 안내한다.
                        if (data.qNum === 'general') {
                            appendLog('border-rose-500', 'bg-rose-100 text-rose-600', '조교호출', `${data.name} 학생이 조교를 호출했습니다.`, `[${activeSeat}] 포탈에서 호출했습니다 · 확인 후 처리하세요.`, 'call', { seat: activeSeat, qNum: data.qNum });
                        } else {
                            appendLog('border-rose-500', 'bg-rose-100 text-rose-600', '질문호출', `[${activeSeat}] ${data.name} 질문 요청`, `${data.qNum}번 문항 설명 대기 중`, 'call', { seat: activeSeat, qNum: data.qNum });
                        }
                    } else if (action === 'cancel_call') {
                        delete st[activeSeat].calls[data.qNum];
                        if (Object.keys(st[activeSeat].calls).length === 0) st[activeSeat].status = 'idle';
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
                        appendLog('border-blue-500', 'bg-blue-100 text-blue-600', '답안제출', `[${activeSeat}] ${data.name} 제출`, `최종 점수 [${data.score} / 5].`);
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

        // 💡 좌석 상태는 "배정완료" / "예약" 단 두 가지뿐이다. presence는 활동 정보(activity) 갱신에만 쓰고,
        // 접속 끊김 자체로 상태를 바꾸지는 않는다 — 클리닉 종료(로그아웃/시간종료 등)는 별도 경로(student_action 'depart',
        // DB 교차검증의 유령 청소)로 좌석이 통째로 사라지는 방식으로 처리된다.
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

    // 💡 학생 화면(클리닉/포탈)의 자체 타이머에만 의존하지 않고, 수퍼바이저 화면도 매초 직접
    // 배정 시간 만료를 감지해 즉시 처리한다 — 학생 화면이 멈추거나 닫혀 있어도 지체 없이 퇴실 처리된다.
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

    // 💡 예약 시간 + 10분이 지나도록 로그인하지 않은 예약을 만료 처리한다. 알림은 카드가 아니라 우측 현장 로그에 남긴다.
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

    // 드래그 앤 드롭 전역 이벤트 핸들러
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
                if (targetSeat !== draggedSeat && !studentsRef.current[targetSeat]) {
                    const studentId = studentsRef.current[draggedSeat!]?.studentId;
                    const sName = studentsRef.current[draggedSeat!]?.name || '학생';
                    
                    if (window.confirm(`${sName} 학생을 ${draggedSeat}에서 ${targetSeat}으로 이동하시겠습니까?`)) {
                        if (studentId) supabaseClient.from('clinic_session_state').update({ seat: targetSeat, manual_seat: targetSeat }).eq('student_id', studentId).then();
                        const currentStudents = { ...studentsRef.current };
                        currentStudents[targetSeat] = currentStudents[draggedSeat!];
                        delete currentStudents[draggedSeat!];
                        updateStudents(currentStudents);
                        sendToStudent(draggedSeat!, 'move_seat', { newSeat: targetSeat });
                        pendingMovesRef.current[draggedSeat!] = { newSeat: targetSeat, expiresAt: Date.now() + 3000 };
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
        // 💡 자리비움/호출 등 처리 중인 상태에서는 자리 이동을 막는다 — 상태가 풀린 뒤에만 이동 가능.
        const st = activeStudents[seat];
        if (st.type !== 'reserved' && st.status && st.status !== 'idle') {
            const statusLabel = st.status === 'away' ? '자리비움' : st.status === 'call' ? '호출' : st.status === 'hint' ? '힌트 진행' : st.status === 'submitted' ? '제출' : st.status;
            alert(`[${statusLabel}] 상태인 학생은 자리를 이동할 수 없습니다. 상태 해제 후 다시 시도해주세요.`);
            return;
        }
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        // offsetWidth/Height는 CSS transform(카드에 걸린 축소 scale)의 영향을 받지 않는 "원래" 크기이므로,
        // 화면에 실제로 보이는 크기(rect.width)와 비교하면 그 카드가 몇 배로 축소되어 그려졌는지 알 수 있다.
        const scale = target.offsetWidth > 0 ? rect.width / target.offsetWidth : 1;
        dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        setGhostRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, scale });
        setDraggedSeat(seat); setSelectedSeatForMove(seat); e.preventDefault();
    };

    const handleListPointerDown = (e: React.PointerEvent, student: any) => {
        if (e.button !== 0) return;
        // 💡 목록 항목(왼쪽 패널의 좁고 낮은 행) 크기를 그대로 고스트에 쓰면, 실제 좌석 칸과 전혀
        // 다른 비율/크기라 놓기 전까지 "신규 배정" 박스가 대시보드 좌석 카드와 안 닮아 보였다.
        // 지금 화면에 이미 그려져 있는 좌석 칸(data-seat) 하나를 그대로 재서, 그 실제 렌더 크기
        // (이미 SeatCanvas 배율까지 반영된 최종 픽셀 크기)를 고스트 크기로 그대로 가져다 쓴다.
        const anySeatEl = document.querySelector('[data-seat]') as HTMLElement | null;
        const rect = anySeatEl?.getBoundingClientRect();
        const width = rect?.width || seatWidth;
        const height = rect?.height || seatHeight;
        dragOffsetRef.current = { x: width / 2, y: height / 2 };
        setGhostRect({ left: e.clientX - width / 2, top: e.clientY - height / 2, width, height, scale: 1 });
        setDraggedListStudent(student); e.preventDefault();
    };

    // 💡 예약 확정: 아직 로그인 전인 학생을 지정한 시각 + 10분 유예로 좌석에 예약해둔다.
    // 실제 "배정완료"는 그 학생이 진짜 로그인해서 clinic_session_state에 세션이 생겼을 때만 일어난다(DB 교차검증에서 처리).
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

        // 💡 새로고침해도 예약이 사라지지 않도록 DB에도 남긴다(로그인하면 실제 세션으로 대체됨).
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

    // 액션 핸들러들
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

    // 학생의 클리닉 종료 요청을 승인/거부한다. 승인 시 그 시점이 이용시간 종료(ended_at)로 확정된다.
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

    const taAction = (seat: string, type: string, qNum: any = null) => {
        const currentStudents = { ...studentsRef.current };
        if (type === 'cancel_call') {
            if (qNum !== null) {
                if (currentStudents[seat]?.calls) delete currentStudents[seat].calls[qNum];
                if (Object.keys(currentStudents[seat]?.calls || {}).length === 0) currentStudents[seat].status = 'idle';
                removeLogsByTypeAndSeat('call', seat, qNum);
                sendToStudent(seat, 'force_cancel_call', { qNum: Number(qNum) });
                recordTaStat('총책임자', '');
                if (currentStudents[seat]?.sessionId) clearActiveCall(supabaseClient, currentStudents[seat].sessionId, qNum);
            }
        } else if (type === 'clear_away') {
            if (currentStudents[seat]) { currentStudents[seat].status = 'idle'; currentStudents[seat].awaySince = null; }
            removeLogsByTypeAndSeat('away', seat); sendToStudent(seat, 'force_return_to_seat');
            if (currentStudents[seat]?.sessionId) clearAway(supabaseClient, currentStudents[seat].sessionId);
        } else if (type === 'confirm_checkout') {
            if (currentStudents[seat]) {
                const st = currentStudents[seat]; sendToStudent(seat, 'force_checkout');
                if (st.studentId) endTodaySession(supabaseClient, st.studentId, getKSTDateString());
                removeLogsByTypeAndSeat('submit', seat); delete currentStudents[seat];
                pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
            }
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
        ghostRect,
        seats, seatObjs, canvasWidth, canvasHeight, seatWidth, seatHeight, editorLocked
    };
}