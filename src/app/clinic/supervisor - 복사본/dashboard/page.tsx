"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// --- 환경 변수 & 초기 설정 ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const CLINIC_ROOM = 'logica-clinic-room';

const SEAT_ROWS = ['A', 'B', 'C', 'D', 'E', 'F'];
const SEAT_COLS = 10;
const seats = SEAT_ROWS.flatMap(row => 
    Array.from({ length: SEAT_COLS }, (_, i) => `${row}-${String(i + 1).padStart(2, '0')}`)
);

const DEFAULT_CLINIC_DURATION_MS = 60 * 60 * 1000;
const ALERT_THRESHOLD_MS = 3 * 60 * 1000;
const LOG_AUTO_EXPIRE_MS = 5 * 60 * 1000;
const PENDING_GUARD_MS = 8000;

// 한국 표준시(KST) 기준 날짜 문자열 구하기
const getKSTDateString = () => {
    const kstTime = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return kstTime.toISOString().split('T')[0];
};

const formatDuration = (ms: number) => {
    if (ms < 0 || isNaN(ms)) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

const formatShortAgo = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}초`;
    return `${Math.floor(sec / 60)}분`;
};

export default function SupervisorDashboard() {
    // 수퍼 어드민 로그인 상태 관리
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminPin, setAdminPin] = useState('');

    const [now, setNow] = useState(Date.now());
    const [startedAt] = useState(Date.now());
    const [connectionStatus, setConnectionStatus] = useState('connecting');
    const [activeStudents, setActiveStudents] = useState<Record<string, any>>({});
    const [activeTAs, setActiveTAs] = useState<Record<string, any>>({});
    const [taStats, setTaStats] = useState<Record<string, any>>({});
    const [logs, setLogs] = useState<any[]>([]);
    const [isMounted, setIsMounted] = useState(false);
    
    // ✨ 좌측 탭 및 학생 목록 상태
    const [leftTab, setLeftTab] = useState<'ta' | 'students'>('ta');
    const [allStudents, setAllStudents] = useState<Record<string, any[]>>({});
    const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});
    const [draggedListStudent, setDraggedListStudent] = useState<any>(null);

    useEffect(() => { setIsMounted(true); }, []);
    
    const [forceCheckoutModal, setForceCheckoutModal] = useState<{ isOpen: boolean, seat: string | null }>({ isOpen: false, seat: null });
    const [recheckModal, setRecheckModal] = useState<{ isOpen: boolean, seat: string | null, uid: string | null }>({ isOpen: false, seat: null, uid: null });

    const [selectedSeatForMove, setSelectedSeatForMove] = useState<string | null>(null);
    const [draggedSeat, setDraggedSeat] = useState<string | null>(null);

    const studentsRef = useRef<Record<string, any>>({});
    const channelRef = useRef<any>(null);
    const logsRef = useRef<any[]>([]);
    
    const pendingMovesRef = useRef<Record<string, any>>({});
    const pendingDeletesRef = useRef<Record<string, number>>({});
    const pendingTimeAdjustRef = useRef<Record<string, any>>({});
    const syncPresenceRef = useRef<any>(null);

    const updateStudents = useCallback((newStudents: any) => {
        studentsRef.current = newStudents;
        // 깊은 복사 느낌으로 새 객체를 넘겨 강제 렌더링 유발
        setActiveStudents({ ...newStudents });
    }, []);

    const updateLogs = useCallback((newLogs: any[]) => {
        logsRef.current = newLogs;
        setLogs([...newLogs]);
    }, []);

    // 🌟 초기 로드: 전체 학생 목록 및 DB 세션 데이터 로드
    useEffect(() => {
        if (!isAdmin) return;

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
                Object.keys(grouped).sort().forEach(k => {
                    sortedGrouped[k] = grouped[k].sort((a, b) => a.name.localeCompare(b.name));
                });
                
                setAllStudents(sortedGrouped);
                if (Object.keys(sortedGrouped).length > 0) {
                    setExpandedClasses({ [Object.keys(sortedGrouped)[0]]: true });
                }
            }
        };

        const loadInitialSeatsFromDB = async () => {
            const todayStr = getKSTDateString();
            const { data: sessionData } = await supabaseClient
                .from('clinic_session_state')
                .select('*')
                .eq('session_date', todayStr);
            
            if (!sessionData || sessionData.length === 0) return;

            const newStudents = { ...studentsRef.current };
            
            for (const sess of sessionData) {
                let effectiveSeat = sess.manual_seat;
                
                if (!effectiveSeat && sess.seat) {
                    effectiveSeat = sess.seat;
                    await supabaseClient.from('clinic_session_state').update({ manual_seat: effectiveSeat }).eq('student_id', sess.student_id);
                }

                if (!effectiveSeat) continue;
                
                const { data: sData } = await supabaseClient.from('student').select('name, enrollment(class(name))').eq('student_id', sess.student_id).single();
                const metaName = sData?.name || '학생';
                const metaClasses = sData?.enrollment?.map((e: any) => e.class?.name).filter(Boolean) || ['반 미배정'];
                
                if (!newStudents[effectiveSeat]) {
                    newStudents[effectiveSeat] = {
                        name: metaName,
                        classes: metaClasses,
                        status: 'idle',
                        studentId: sess.student_id,
                        firstSeenAt: new Date(sess.started_at).getTime() || Date.now(),
                        clinicDurationMs: sess.duration_ms || DEFAULT_CLINIC_DURATION_MS,
                        totalCalls: 0, totalHints: 0, calls: {},
                        offlineSince: null // 강제로 초기 온라인 적용
                    };
                }
            }
            updateStudents(newStudents);
        };

        fetchAllStudents();
        loadInitialSeatsFromDB();
    }, [isAdmin, updateStudents]);

    // 1초 타이머 (화면 시간 및 상태 싱크)
    useEffect(() => {
        if (!isAdmin) return;
        const interval = setInterval(() => {
            setNow(Date.now());
            if (channelRef.current && syncPresenceRef.current) {
                syncPresenceRef.current(channelRef.current.presenceState());
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [isAdmin]);

    // ✨ [핵심수정] 5초 주기 DB 단일 진실 원천 강제 동기화 로직 ✨
    useEffect(() => {
        if (!isAdmin || !isMounted) return;
        
        const dbCrossValidationInterval = setInterval(async () => {
            const todayStr = getKSTDateString();
            
            // JOIN 에러를 방지하기 위해 가장 기본적이고 안전한 쿼리만 실행
            const { data: sessionData, error } = await supabaseClient
                .from('clinic_session_state')
                .select('*')
                .eq('session_date', todayStr);

            if (error || !sessionData) return;

            const dbSeats = new Map();
            
            for (const s of sessionData) {
                let effectiveSeat = s.manual_seat;
                
                // 메뉴얼 시트 최우선 검증
                if (!effectiveSeat && s.seat) {
                    effectiveSeat = s.seat;
                    supabaseClient.from('clinic_session_state').update({ manual_seat: effectiveSeat }).eq('student_id', s.student_id).then();
                }
                
                if (effectiveSeat) {
                    dbSeats.set(effectiveSeat, s);
                }
            }

            const current = { ...studentsRef.current };
            let isModified = false;

            // 1. DB를 기준으로 화면의 자리를 우선적으로 이동/추가합니다.
            for (const [targetSeat, dbRecord] of Array.from(dbSeats.entries())) {
                const oldSeat = Object.keys(current).find(s => current[s].studentId === dbRecord.student_id);

                if (oldSeat && oldSeat !== targetSeat) {
                    // 화면에 있던 학생의 자리가 DB 기준과 다르면 무조건 덮어씌움
                    current[targetSeat] = { ...current[oldSeat], clinicDurationMs: dbRecord.duration_ms };
                    delete current[oldSeat];
                    isModified = true;
                } 
                else if (!oldSeat && !current[targetSeat]) {
                    // 화면에 없던 학생이 DB에 새롭게 확인된 경우 (수동 추가, 외부 접속 등)
                    const { data: sData } = await supabaseClient.from('student').select('name, enrollment(class(name))').eq('student_id', dbRecord.student_id).single();
                    const studentName = sData?.name || '학생';
                    const classes = sData?.enrollment?.map((e: any) => e.class?.name).filter(Boolean) || ['반 미배정'];
                    
                    current[targetSeat] = {
                        name: studentName,
                        classes: classes,
                        status: 'idle',
                        studentId: dbRecord.student_id,
                        firstSeenAt: new Date(dbRecord.started_at).getTime() || Date.now(),
                        clinicDurationMs: dbRecord.duration_ms || DEFAULT_CLINIC_DURATION_MS,
                        totalCalls: 0,
                        totalHints: 0,
                        calls: {},
                        offlineSince: null, // 초기 강제 온라인 상태
                        activity: '포털/수동 배정 연동'
                    };
                    isModified = true;
                } 
                else if (oldSeat === targetSeat) {
                    // 자리는 그대로인데 DB의 시간이 조절된 경우 갱신
                    const isTimeAdjusting = pendingTimeAdjustRef.current[targetSeat] && Date.now() < pendingTimeAdjustRef.current[targetSeat].expiresAt;
                    if (!isTimeAdjusting && dbRecord.duration_ms !== undefined && current[targetSeat].clinicDurationMs !== dbRecord.duration_ms) {
                        current[targetSeat].clinicDurationMs = dbRecord.duration_ms;
                        isModified = true;
                    }
                }
            }

            // 2. DB 작업이 완벽히 끝난 후, 화면에 남아있는 빈 껍데기를 지웁니다. (유령 청소)
            Object.keys(current).forEach(uiSeat => {
                const isPendingDelete = pendingDeletesRef.current[uiSeat] && Date.now() < pendingDeletesRef.current[uiSeat];
                const isPendingMove = pendingMovesRef.current[uiSeat] && Date.now() < pendingMovesRef.current[uiSeat].expiresAt;

                if (!dbSeats.has(uiSeat) && !isPendingDelete && !isPendingMove && !current[uiSeat].dummy) {
                    appendLog('border-slate-800', 'bg-slate-900 text-white', '교차검증', `[${uiSeat}] 유령 청소 완료`, `DB에 해당 좌석(메뉴얼 시트 기준) 정보가 없어 정리되었습니다.`);
                    delete current[uiSeat];
                    isModified = true;
                }
            });

            if (isModified) updateStudents(current);
        }, 5000);

        return () => clearInterval(dbCrossValidationInterval);
    }, [isAdmin, isMounted, updateStudents]);

    const appendLog = useCallback((borderClass: string, badgeBg: string, badgeText: string, title: string | React.ReactNode, subtitle: string | React.ReactNode, type?: string, data?: any) => {
        const logId = `log-${Date.now()}-${Math.random()}`;
        const newLog = {
            id: logId, timestamp: new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            borderClass, badgeBg, badgeText, title, subtitle, type, data, expiresAt: Date.now() + LOG_AUTO_EXPIRE_MS
        };
        updateLogs([newLog, ...logsRef.current]);
        setTimeout(() => updateLogs(logsRef.current.filter(l => l.id !== logId)), LOG_AUTO_EXPIRE_MS);
        return logId;
    }, [updateLogs]);

    const removeLogsByTypeAndSeat = useCallback((type: string, seat: string, qNum?: number) => {
        updateLogs(logsRef.current.filter(l => !(l.data?.seat === seat && l.type === type && (!qNum || l.data?.qNum === qNum))));
    }, [updateLogs]);

    useEffect(() => {
        if (!isAdmin) return;

        const channel = supabaseClient.channel(CLINIC_ROOM);
        channelRef.current = channel;

        channel
            .on('presence', { event: 'sync' }, () => {
                if (syncPresenceRef.current) syncPresenceRef.current(channel.presenceState());
            })
            .on('broadcast', { event: 'student_action' }, ({ payload }: { payload: any }) => {
                const { seat, data, action } = payload;
                const st = { ...studentsRef.current };
                
                const activeSeat = Object.keys(st).find(s => st[s].studentId === data.studentId) || seat;

                if (action === 'depart') {
                    if (st[activeSeat]) {
                        supabaseClient.from('clinic_session_state').update({ seat: null, manual_seat: null }).eq('student_id', st[activeSeat].studentId).then();
                        appendLog('border-slate-800', 'bg-slate-900 text-white', '퇴실완료', `[${activeSeat}] ${st[activeSeat].name} 퇴실`, `정상적으로 로그아웃하여 자리가 비워졌습니다.`);
                        delete st[activeSeat];
                    }
                } else if (st[activeSeat]) {
                    if (action === 'update_activity') {
                        st[activeSeat].activity = data.activity;
                    } else if (action === 'typing') {
                        st[activeSeat].isTyping = true;
                        if (st[activeSeat].typingTimeout) clearTimeout(st[activeSeat].typingTimeout);
                        st[activeSeat].typingTimeout = setTimeout(() => {
                            if (studentsRef.current[activeSeat]) {
                                updateStudents({ ...studentsRef.current, [activeSeat]: { ...studentsRef.current[activeSeat], isTyping: false } });
                            }
                        }, 2000);
                    } else if (action === 'call') {
                        st[activeSeat].calls[data.qNum] = Date.now();
                        st[activeSeat].status = 'call';
                        appendLog('border-rose-500', 'bg-rose-100 text-rose-600', '질문호출', `[${activeSeat}] ${data.name} 질문 요청`, `${data.qNum}번 문항 설명 대기 중`, 'call', { seat: activeSeat, qNum: data.qNum });
                    } else if (action === 'cancel_call') {
                        delete st[activeSeat].calls[data.qNum];
                        if (Object.keys(st[activeSeat].calls).length === 0) st[activeSeat].status = 'idle';
                        removeLogsByTypeAndSeat('call', activeSeat, data.qNum);
                    } else if (action === 'away') {
                        st[activeSeat].status = 'away';
                        st[activeSeat].awaySince = Date.now();
                        appendLog('border-amber-500', 'bg-amber-100 text-amber-700', '자리비움', `[${activeSeat}] ${data.name} 자리비움`, `학생이 자리를 비웠습니다.`, 'away', { seat: activeSeat });
                    } else if (action === 'cancel_away') {
                        st[activeSeat].status = 'idle';
                        st[activeSeat].awaySince = null;
                        removeLogsByTypeAndSeat('away', activeSeat);
                        appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '복귀', `[${activeSeat}] ${data.name} 복귀`, `자리로 돌아왔습니다.`);
                    } else if (action === 'hint') {
                        st[activeSeat].status = 'hint';
                        st[activeSeat].lastHint = { qNum: data.qNum, level: data.level, at: Date.now() };
                        st[activeSeat].totalHints = (st[activeSeat].totalHints || 0) + 1;
                        appendLog('border-yellow-400', 'bg-yellow-100 text-yellow-700', '힌트열람', `[${activeSeat}] ${data.name} 힌트 확인`, `${data.qNum}번 문항 [${data.level}단계] 힌트 열람 완료.`);
                        setTimeout(() => {
                            if (studentsRef.current[activeSeat]?.status === 'hint') updateStudents({ ...studentsRef.current, [activeSeat]: { ...studentsRef.current[activeSeat], status: 'idle' } });
                        }, 10000);
                    } else if (action === 'submit') {
                        st[activeSeat].status = 'submitted';
                        st[activeSeat].score = data.score;
                        appendLog('border-blue-500', 'bg-blue-100 text-blue-600', '답안제출', `[${activeSeat}] ${data.name} 제출`, `최종 점수 [${data.score} / 5].`);
                    } else if (action === 'recheck_request') {
                        if (!st[activeSeat].rechecks) st[activeSeat].rechecks = {};
                        st[activeSeat].rechecks[data.uid] = { ...data, seat: activeSeat };
                        appendLog('border-indigo-500', 'bg-indigo-100 text-indigo-600', '재확인요청', <span className="underline decoration-dotted cursor-pointer hover:text-indigo-600" onClick={() => setRecheckModal({ isOpen: true, seat: activeSeat, uid: data.uid })}>{data.name}</span>, `${data.qNum}번 문항 · AI가 오답으로 채점했습니다. 이름을 클릭해 손글씨 이미지를 직접 확인하세요.`, 'recheck', { seat: activeSeat, uid: data.uid });
                    }
                }
                updateStudents(st);
            })
            .on('broadcast', { event: 'ta_action' }, ({ payload }: { payload: any }) => handleTaActionFromOtherScreen(payload))
            .subscribe((status: string) => {
                if (status === 'SUBSCRIBED') setConnectionStatus('connected');
                else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnectionStatus('error');
            });

        return () => { supabaseClient.removeChannel(channel); };
    }, [isAdmin, updateStudents, appendLog, removeLogsByTypeAndSeat]);

    const sendToStudent = (seat: string, action: string, extra = {}) => {
        if (!channelRef.current) return;
        channelRef.current.send({ type: 'broadcast', event: 'ta_action', payload: { seat, action, ...extra, timestamp: Date.now() } });
    };

    // ✨ [핵심수정] 프레즌스 간섭 차단 및 '강제 온라인' 로직 ✨
    const syncActiveStudentsFromPresence = (presenceState: any) => {
        const currentStudents = { ...studentsRef.current };
        const currentTime = Date.now();
        
        const presenceByStudentId: any = {};
        const newActiveTAs: any = {};

        Object.values(presenceState).forEach((metas: any) => {
            let latestMeta = metas.reduce((prev: any, curr: any) => (curr.updatedAt || 0) > (prev.updatedAt || 0) ? curr : prev, metas[0]);
            if (!latestMeta) return;

            if (latestMeta.role === 'ta') {
                const key = latestMeta.clientId || latestMeta.name;
                newActiveTAs[key] = { name: latestMeta.name || '이름 미상', joined_at: latestMeta.joined_at || Date.now(), handling: latestMeta.handling || null, clientId: latestMeta.clientId || key };
            } else if (latestMeta.studentId) {
                if (!presenceByStudentId[latestMeta.studentId] || latestMeta.updatedAt > presenceByStudentId[latestMeta.studentId].lastUpdatedAt) {
                    presenceByStudentId[latestMeta.studentId] = {
                        ...latestMeta,
                        lastUpdatedAt: latestMeta.updatedAt
                    };
                }
            }
        });

        let isModified = false;
        
        Object.keys(currentStudents).forEach(seat => {
            const st = currentStudents[seat];
            if (st.dummy || !st.studentId) return;

            const pData = presenceByStudentId[st.studentId];
            const remainingMs = (st.firstSeenAt + st.clinicDurationMs) - currentTime;
            
            // 프레즌스 연결이 잡히지 않을 때
            if (!pData) {
                // 학습 시간이 단 1초라도 남아있다면 (remainingMs > 0), 무조건 강제로 온라인 유지
                if (remainingMs > 0 && st.offlineSince !== null) {
                    st.offlineSince = null; 
                    isModified = true;
                } else if (remainingMs <= 0 && !st.offlineSince) {
                    // 시간이 끝난 뒤에 연결마저 끊기면 오프라인 전환
                    st.offlineSince = currentTime;
                    isModified = true;
                }
            } else {
                if (st.offlineSince) {
                    st.offlineSince = null;
                    isModified = true;
                }
                st.lastUpdatedAt = pData.lastUpdatedAt;
                if (pData.activity && st.activity !== pData.activity) {
                    st.activity = pData.activity;
                    isModified = true;
                }
            }
        });

        setActiveTAs(newActiveTAs);
        if (isModified) updateStudents(currentStudents);
    };

    syncPresenceRef.current = syncActiveStudentsFromPresence;

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
            if (currentStudents[seat]) {
                currentStudents[seat].status = 'idle';
                currentStudents[seat].awaySince = null;
            }
            removeLogsByTypeAndSeat('away', seat);
            appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '복귀처리', `[${seat}] 자리비움 해제`, `다른 화면에서 자리비움 상태를 해제했습니다.`);
        } else if (action === 'force_checkout' || action === 'force_checkout_by_ta') {
            if (currentStudents[seat]) {
                const st = currentStudents[seat];
                if (st.studentId) supabaseClient.from('clinic_session_state').update({ seat: null, manual_seat: null }).eq('student_id', st.studentId).then();
                appendLog(action === 'force_checkout_by_ta' ? 'border-rose-600' : 'border-slate-800', action === 'force_checkout_by_ta' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white', action === 'force_checkout_by_ta' ? '강제퇴실' : '퇴실완료', `[${seat}] ${st.name} 퇴실 처리`, `다른 화면에서 퇴실 처리되었습니다.`);
                removeLogsByTypeAndSeat('call', seat); removeLogsByTypeAndSeat('submit', seat); removeLogsByTypeAndSeat('away', seat); removeLogsByTypeAndSeat('recheck', seat);
                delete currentStudents[seat];
                pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
            }
        }
        updateStudents(currentStudents);
    };

    const recordTaStat = (name: string, mark: string) => {
        setTaStats(prev => {
            const next = { ...prev };
            const key = name || '이름 미상';
            if (!next[key]) next[key] = { total: 0, hint: 0, skip: 0 };
            next[key].total++;
            if (mark === 'hint') next[key].hint++;
            else if (mark === 'skip') next[key].skip++;
            return next;
        });
    };

    const taAction = (seat: string, type: string, qNum: any = null) => {
        const currentStudents = { ...studentsRef.current };
        if (type === 'cancel_call') {
            if (qNum !== null) {
                if (currentStudents[seat]?.calls) delete currentStudents[seat].calls[qNum];
                if (Object.keys(currentStudents[seat]?.calls || {}).length === 0) currentStudents[seat].status = 'idle';
                removeLogsByTypeAndSeat('call', seat, qNum);
                sendToStudent(seat, 'force_cancel_call', { qNum: Number(qNum) });
                appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '호출해제', `[${seat}] ${qNum}번 문항 지도 종료`, `대면 설명이 끝나 호출을 해제했습니다.`);
                recordTaStat('총책임자', '');
            } else {
                const calls = Object.keys(currentStudents[seat]?.calls || {});
                calls.forEach(q => {
                    removeLogsByTypeAndSeat('call', seat, Number(q));
                    sendToStudent(seat, 'force_cancel_call', { qNum: Number(q) });
                    recordTaStat('총책임자', '');
                });
                currentStudents[seat].calls = {};
                currentStudents[seat].status = 'idle';
                appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '호출해제', `[${seat}] 대면 지도 종료`, `질문 대응이 끝나 호출 상태를 해제했습니다.`);
            }
        } else if (type === 'clear_away') {
            if (currentStudents[seat]) { currentStudents[seat].status = 'idle'; currentStudents[seat].awaySince = null; }
            removeLogsByTypeAndSeat('away', seat);
            sendToStudent(seat, 'force_return_to_seat');
            appendLog('border-slate-400', 'bg-slate-100 text-slate-600', '복귀처리', `[${seat}] 자리비움 해제`, `수동으로 자리비움 상태를 해제했습니다.`);
        } else if (type === 'confirm_checkout') {
            if (currentStudents[seat]) {
                const st = currentStudents[seat];
                sendToStudent(seat, 'force_checkout');
                if (st.studentId) supabaseClient.from('clinic_session_state').update({ seat: null, manual_seat: null }).eq('student_id', st.studentId).then();
                appendLog('border-slate-800', 'bg-slate-900 text-white', '퇴실완료', `[${seat}] ${st.name} 퇴실 처리`, `수동으로 퇴실 처리되어 자리가 반납되었습니다.`);
                removeLogsByTypeAndSeat('submit', seat); removeLogsByTypeAndSeat('recheck', seat);
                delete currentStudents[seat];
                pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
            }
        }
        updateStudents(currentStudents);
    };

    const confirmForceCheckout = () => {
        const seat = forceCheckoutModal.seat;
        if (!seat) return;
        const currentStudents = { ...studentsRef.current };
        if (currentStudents[seat]) {
            const st = currentStudents[seat];
            
            sendToStudent(seat, 'force_checkout_by_ta');
            if (st.studentId) supabaseClient.from('clinic_session_state').update({ seat: null, manual_seat: null }).eq('student_id', st.studentId).then();

            appendLog('border-rose-600', 'bg-rose-600 text-white', '강제퇴실', `[${seat}] ${st.name} 강제 퇴실 처리`, `수동으로 강제 퇴실 처리되어 자리가 회수되었습니다.`);
            removeLogsByTypeAndSeat('call', seat); removeLogsByTypeAndSeat('submit', seat); removeLogsByTypeAndSeat('away', seat); removeLogsByTypeAndSeat('recheck', seat);
            
            delete currentStudents[seat];
            pendingDeletesRef.current[seat] = Date.now() + PENDING_GUARD_MS;
        }
        updateStudents(currentStudents);
        setForceCheckoutModal({ isOpen: false, seat: null });
    };

    const adjustClinicTime = async (seat: string, deltaMinutes: number) => {
        const st = studentsRef.current[seat];
        if (!st) return;
        
        const deltaMs = deltaMinutes * 60 * 1000;
        const newDuration = Math.max(0, (st.clinicDurationMs || DEFAULT_CLINIC_DURATION_MS) + deltaMs);
        
        const currentStudents = { ...studentsRef.current };
        currentStudents[seat].clinicDurationMs = newDuration;
        updateStudents(currentStudents);
        
        pendingTimeAdjustRef.current[seat] = { value: newDuration, expiresAt: Date.now() + 3000 };
        
        if (st.studentId) {
            const { error } = await supabaseClient.from('clinic_session_state')
                .update({ duration_ms: newDuration })
                .eq('student_id', st.studentId);
                
            if (error) {
                alert(`🚨 DB 갱신 실패: ${error.message}`);
                return;
            }
        }
        
        sendToStudent(seat, 'adjust_clinic_time', { deltaMs, newDuration, studentId: st.studentId || null });
        
        const sign = deltaMinutes > 0 ? '+' : '';
        appendLog('border-indigo-400', 'bg-indigo-100 text-indigo-700', '시간조정', `[${seat}] ${st.name} 이용시간 ${sign}${deltaMinutes}분 조정`, `DB에 새 시간(${formatDuration(newDuration)})이 성공적으로 갱신되었습니다.`);
    };

    // ✨ 드래그 앤 드롭 시 manual_seat 강제 덮어쓰기 및 학생 목록에서 배정 ✨
    useEffect(() => {
        const handlePointerMove = (e: PointerEvent) => {
            if (!draggedSeat && !draggedListStudent) return;
            const ghost = document.getElementById('drag-ghost');
            if (ghost) { ghost.style.left = `${e.clientX + 10}px`; ghost.style.top = `${e.clientY + 10}px`; }
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
            
            // 1. 학생 목록(Student List)에서 드래그하여 배정하는 경우
            if (draggedListStudent) {
                if (cell) {
                    const targetSeat = cell.getAttribute('data-seat')!;
                    if (!studentsRef.current[targetSeat]) {
                        if (window.confirm(`${draggedListStudent.name} 학생을 [${targetSeat}] 자리에 강제 배정하고 클리닉을 (재)시작하시겠습니까?`)) {
                            
                            const todayStr = getKSTDateString();
                            const nowIso = new Date().toISOString();
                            
                            // DB 반영 (시작 시간 리셋 및 수동 좌석 강제 덮어쓰기)
                            supabaseClient.from('clinic_session_state').upsert({
                                student_id: draggedListStudent.id,
                                session_date: todayStr,
                                started_at: nowIso,
                                duration_ms: DEFAULT_CLINIC_DURATION_MS,
                                seat: targetSeat,
                                manual_seat: targetSeat
                            }).then(({ error }) => {
                                if (error) alert(`🚨 DB 반영 실패: ${error.message}`);
                            });

                            // 화면 즉시 반영 (강제 온라인 상태 적용)
                            const currentStudents = { ...studentsRef.current };
                            currentStudents[targetSeat] = {
                                name: draggedListStudent.name,
                                classes: draggedListStudent.classes,
                                status: 'idle',
                                studentId: draggedListStudent.id,
                                firstSeenAt: Date.now(),
                                clinicDurationMs: DEFAULT_CLINIC_DURATION_MS,
                                totalCalls: 0,
                                totalHints: 0,
                                calls: {},
                                offlineSince: null, // 🟢 드래그로 수동 배정 시 무조건 온라인
                                activity: '수동 배정됨'
                            };
                            updateStudents(currentStudents);
                            
                            pendingMovesRef.current[targetSeat] = { newSeat: targetSeat, expiresAt: Date.now() + 5000 };
                            appendLog('border-indigo-500', 'bg-indigo-100 text-indigo-700', '수동배정', `[${targetSeat}] ${draggedListStudent.name} 수동 배정`, `학생 목록에서 수동으로 자리를 지정하고 새 시간을 부여했습니다.`);
                        }
                    } else {
                        alert('이미 다른 학생이 있는 자리입니다.');
                    }
                }
                setDraggedListStudent(null);
                return;
            }

            // 2. 대시보드 내에서 좌석 간 이동하는 경우
            if (cell) {
                const targetSeat = cell.getAttribute('data-seat')!;
                if (targetSeat !== draggedSeat && !studentsRef.current[targetSeat]) {
                    const studentId = studentsRef.current[draggedSeat!]?.studentId;
                    const sName = studentsRef.current[draggedSeat!]?.name || '학생';
                    
                    if (window.confirm(`정말 ${sName} 학생을 ${draggedSeat}에서 ${targetSeat}으로 이동하시겠습니까?`)) {
                        
                        if (studentId) {
                            const { error } = await supabaseClient.from('clinic_session_state')
                                .update({ seat: targetSeat, manual_seat: targetSeat })
                                .eq('student_id', studentId);

                            if (error) {
                                alert(`🚨 DB 반영 실패: ${error.message}`);
                            }
                        }

                        const currentStudents = { ...studentsRef.current };
                        currentStudents[targetSeat] = currentStudents[draggedSeat!];
                        delete currentStudents[draggedSeat!];
                        updateStudents(currentStudents);
                        
                        sendToStudent(draggedSeat!, 'move_seat', { newSeat: targetSeat });
                        
                        pendingMovesRef.current[draggedSeat!] = { newSeat: targetSeat, expiresAt: Date.now() + 5000 };
                        
                        appendLog('border-indigo-500', 'bg-indigo-100 text-indigo-700', '좌석이동', `[${draggedSeat} → ${targetSeat}] ${sName} 좌석 변경`, `수동(메뉴얼)으로 좌석을 고정 지정했습니다.`);
                    }
                } else if (studentsRef.current[targetSeat] && targetSeat !== draggedSeat) {
                    alert('이미 다른 학생이 있는 자리로는 옮길 수 없어요. 빈 자리로만 옮겨주세요.');
                }
            }
            setDraggedSeat(null);
            setSelectedSeatForMove(null);
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
        setDraggedSeat(seat);
        setSelectedSeatForMove(seat);
        e.preventDefault();
    };

    const handleListPointerDown = (e: React.PointerEvent, student: any) => {
        if (e.button !== 0) return;
        setDraggedListStudent(student);
        e.preventDefault();
    };

    const toggleClass = (cName: string) => {
        setExpandedClasses(p => ({ ...p, [cName]: !p[cName] }));
    };

    if (!isAdmin) {
        return (
            <div className="h-screen flex items-center justify-center bg-slate-200 font-['Pretendard']">
                <div className="bg-white p-8 rounded-2xl shadow-xl w-96 text-center border border-slate-200">
                    <h2 className="text-2xl font-extrabold text-[#002864] mb-2 tracking-tight">Logica Clinic</h2>
                    <p className="text-sm text-slate-500 mb-6 font-bold">수퍼 어드민 통합 관제 로그인</p>
                    <input
                        type="password"
                        placeholder="관리자 PIN 번호 (예: 1234)"
                        className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-center mb-4 focus:ring-2 focus:ring-blue-500 focus:outline-none font-bold"
                        value={adminPin}
                        onChange={(e) => setAdminPin(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                if (adminPin === '1234' || adminPin === 'admin') setIsAdmin(true);
                                else alert('PIN 번호가 일치하지 않습니다.');
                            }
                        }}
                    />
                    <button
                        onClick={() => {
                            if (adminPin === '1234' || adminPin === 'admin') setIsAdmin(true);
                            else alert('PIN 번호가 일치하지 않습니다.');
                        }}
                        className="w-full bg-[#002864] hover:bg-[#013a8f] text-white font-bold py-3 rounded-lg transition-colors shadow-md"
                    >
                        대시보드 접속
                    </button>
                </div>
            </div>
        );
    }

    const studentCount = Object.keys(activeStudents).length;
    const vacantCount = Math.max(0, seats.length - studentCount);
    let callingCount = 0, hintingCount = 0, awayCount = 0, timeUrgentCount = 0;
    let longWaitBanner = null;

    Object.entries(activeStudents).forEach(([seat, st]: [string, any]) => {
        if (st.status === 'away') awayCount++;
        if (st.status === 'hint') hintingCount++;
        if (st.firstSeenAt && st.clinicDurationMs && (st.firstSeenAt + st.clinicDurationMs) - now <= 5 * 60 * 1000) timeUrgentCount++;

        if (st.calls && Object.keys(st.calls).length > 0) {
            callingCount++;
            Object.entries(st.calls).forEach(([qNum, at]: [string, any]) => {
                if (now - at > ALERT_THRESHOLD_MS) {
                    longWaitBanner = `[${seat}] ${st.name} 학생이 ${qNum}번 문항 관련 도움을 ${formatDuration(now - at)}째 기다리고 있습니다. 담당 조교 배정을 확인해주세요.`;
                }
            });
        }
    });

    return (
        <>
            <style dangerouslySetInnerHTML={{ __html: `
                @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
                body { font-family: 'Pretendard', sans-serif; background-color: #f1f5f9; }
                @keyframes pulse-red { 0%, 100% { border-color: #ef4444; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); } 50% { border-color: #fca5a5; box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); } }
                .status-help { animation: pulse-red 1.2s infinite; background-color: #fef2f2; border: 2px solid #ef4444; }
                @keyframes flash-yellow { 0%, 100% { background-color: white; } 50% { background-color: #fef9c3; border-color: #eab308; } }
                .hint-flash { animation: flash-yellow 1.5s ease-in-out infinite; }
                @keyframes blink-dot { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
                .dot-live { animation: blink-dot 1.6s ease-in-out infinite; }
                ::-webkit-scrollbar { width: 7px; height: 7px; }
                ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
            `}} />

            {/* 좌석 이동 고스트 */}
            {draggedSeat && activeStudents[draggedSeat] && (
                <div id="drag-ghost" className="fixed pointer-events-none z-[9999] opacity-90 shadow-2xl scale-105 transition-transform bg-white border border-slate-200 rounded-xl p-3 flex flex-col w-[160px] min-h-[196px]">
                    <span className="bg-[#002864] text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm w-max mb-1">{draggedSeat}</span>
                    <div className="font-bold text-slate-900 text-[13px] mt-auto">{activeStudents[draggedSeat].name}</div>
                </div>
            )}
            
            {/* 학생 목록 드래그 고스트 */}
            {draggedListStudent && (
                <div id="drag-ghost" className="fixed pointer-events-none z-[9999] opacity-90 shadow-2xl scale-105 transition-transform bg-white border border-slate-200 rounded-xl p-3 flex flex-col w-[160px] min-h-[100px]">
                    <span className="bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm w-max mb-1">신규 배정</span>
                    <div className="font-bold text-slate-900 text-[13px] mt-auto">{draggedListStudent.name}</div>
                </div>
            )}

            <header className="bg-gradient-to-r from-[#002864] to-[#013a8f] text-white px-8 py-3.5 flex justify-between items-center shadow-md z-20 shrink-0 border-b border-white/10">
                <div>
                    <h1 className="text-xl font-bold tracking-tight">Logica Clinic <span className="text-blue-300 font-medium mx-1">—</span> 총책임자 대시보드</h1>
                    <p className="text-[11px] text-blue-300/80 mt-0.5 tracking-wide">전체 클리닉 통합 관제 · Supabase Realtime(Presence + Broadcast) 기반</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right leading-tight pr-4 border-r border-white/15">
                        <div className="text-lg font-bold font-mono tabular-nums tracking-tight">{isMounted ? new Date(now).toLocaleTimeString('ko-KR', { hour12: false }) : '--:--:--'}</div>
                        <div className="text-[10px] text-blue-300/80">가동 시간 <span className="tabular-nums">{isMounted ? formatDuration(now - startedAt) : '00:00'}</span></div>
                    </div>
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 dot-live ${connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus === 'error' ? 'bg-rose-500' : 'bg-slate-400'}`} title="실시간 연결 상태"></span>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-[540px]">
                        <div className="flex items-center gap-1.5 bg-white/[0.07] border border-white/10 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-red-400 inline-block shrink-0"></span> 조교 <span className="tabular-nums">{Object.keys(activeTAs).length}</span>명
                        </div>
                        <div className="flex items-center gap-1.5 bg-white/[0.07] border border-white/10 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-blue-300 inline-block shrink-0"></span> 학생 <span className="tabular-nums">{studentCount}</span>명
                        </div>
                        <div className="flex items-center gap-1.5 bg-white/[0.07] border border-white/10 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-slate-400 inline-block shrink-0"></span> 공석 <span className="tabular-nums">{vacantCount}</span>석
                        </div>
                        <div className="flex items-center gap-1.5 bg-rose-500/15 border border-rose-400/30 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm">
                            🚨 호출대기 <span className="tabular-nums">{callingCount}</span>건
                        </div>
                        <div className="flex items-center gap-1.5 bg-amber-400/15 border border-amber-300/30 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm">
                            💡 힌트열람 <span className="tabular-nums">{hintingCount}</span>명
                        </div>
                        <div className="flex items-center gap-1.5 bg-white/[0.06] border border-white/10 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm">
                            🚶 자리비움 <span className="tabular-nums">{awayCount}</span>명
                        </div>
                        <div className="flex items-center gap-1.5 bg-rose-500/15 border border-rose-400/30 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm">
                            ⏳ 시간임박 <span className="tabular-nums">{timeUrgentCount}</span>명
                        </div>
                    </div>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                <aside className="w-[360px] bg-white border-r border-slate-300 flex flex-col h-full shrink-0 shadow-lg z-10">
                    <div className="flex shrink-0 border-b border-slate-200">
                        <button onClick={() => setLeftTab('ta')} className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors ${leftTab === 'ta' ? 'bg-white border-indigo-600 text-indigo-700' : 'bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100'}`}>
                            👩‍🏫 조교 현황
                        </button>
                        <button onClick={() => setLeftTab('students')} className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors ${leftTab === 'students' ? 'bg-white border-indigo-600 text-indigo-700' : 'bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100'}`}>
                            👩‍🎓 학생 목록
                        </button>
                    </div>

                    {leftTab === 'ta' ? (
                        <div className="flex-1 overflow-y-auto p-3 bg-slate-50">
                            {Object.keys(activeTAs).length === 0 && Object.keys(taStats).length === 0 ? (
                                <div className="text-center text-xs text-slate-400 py-8">접속한 조교가 없습니다.</div>
                            ) : (
                                <>
                                    {Object.values(activeTAs).sort((a, b) => a.joined_at - b.joined_at).map(ta => (
                                        <div key={ta.clientId} className="bg-white border border-slate-200 rounded-xl p-3 mb-2 shadow-sm hover:shadow-md hover:border-slate-300 transition-all">
                                            <div className="flex justify-between items-start">
                                                <span className="font-bold text-slate-800 text-sm">{ta.name}</span>
                                                <span className="text-[10px] text-slate-400 font-semibold tracking-tight">근무 <span className="tabular-nums">{formatDuration(now - ta.joined_at)}</span></span>
                                            </div>
                                            {ta.handling ? (
                                                <div className="text-[11px] font-bold text-rose-600 mt-1.5 flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 dot-live shrink-0"></span>
                                                    [{ta.handling.split('::')[0]}] {activeStudents[ta.handling.split('::')[0]]?.name || '학생'} · {ta.handling.split('::')[1]}번 상담 중
                                                </div>
                                            ) : (
                                                <div className="text-[11px] font-bold text-emerald-600 mt-1.5 flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>대기 중
                                                </div>
                                            )}
                                            <div className="text-[10px] text-slate-400 font-semibold mt-2 pt-2 border-t border-slate-100">
                                                누적 처리 <span className="text-slate-600 font-bold">{taStats[ta.name]?.total || 0}건</span> · 힌트 {taStats[ta.name]?.hint || 0} · 넘어가기 {taStats[ta.name]?.skip || 0}
                                            </div>
                                        </div>
                                    ))}
                                    {Object.keys(taStats).filter(n => n !== '총책임자' && !Object.values(activeTAs).some((t: any) => t.name === n)).length > 0 && (
                                        <>
                                            <div className="text-[10px] font-bold text-slate-400 mt-3 mb-1.5 px-1">오프라인 (처리 기록만 남음)</div>
                                            {Object.keys(taStats).filter(n => n !== '총책임자' && !Object.values(activeTAs).some((t: any) => t.name === n)).map(n => (
                                                <div key={n} className="bg-slate-100 border border-slate-200 rounded-xl p-3 mb-2 opacity-80">
                                                    <div className="flex justify-between items-start">
                                                        <span className="font-bold text-slate-500 text-sm">{n}</span>
                                                        <span className="text-[10px] text-slate-400 font-semibold">오프라인</span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 font-semibold mt-2 pt-2 border-t border-slate-200">
                                                        누적 처리 <span className="text-slate-600 font-bold">{taStats[n].total}건</span> · 힌트 {taStats[n].hint} · 넘어가기 {taStats[n].skip}
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                    {taStats['총책임자'] && (
                                        <>
                                            <div className="text-[10px] font-bold text-slate-400 mt-3 mb-1.5 px-1">총책임자 직접 처리</div>
                                            <div className="bg-slate-100 border border-slate-200 rounded-xl p-3 mb-2">
                                                <span className="font-bold text-slate-500 text-sm">총책임자</span>
                                                <div className="text-[10px] text-slate-400 font-semibold mt-2 pt-2 border-t border-slate-200">
                                                    누적 처리 <span className="text-slate-600 font-bold">{taStats['총책임자'].total}건</span> · 힌트 {taStats['총책임자'].hint} · 넘어가기 {taStats['총책임자'].skip}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto p-3 bg-slate-50">
                            <p className="text-[10px] text-slate-400 font-bold mb-3 px-1">💡 빈자리에 끌어다 놓으면 강제로 클리닉 시간이 부여됩니다.</p>
                            {Object.entries(allStudents).map(([cName, stds]) => (
                                <div key={cName} className="mb-2">
                                    <button onClick={() => toggleClass(cName)} className="w-full flex justify-between items-center bg-white p-2.5 rounded-lg border border-slate-200 font-bold text-sm text-slate-700 hover:bg-slate-100 shadow-sm transition-colors">
                                        <span>{cName} <span className="text-xs text-indigo-500 ml-1">({stds.length})</span></span>
                                        <span className="text-slate-400 text-xs">{expandedClasses[cName] ? '▲' : '▼'}</span>
                                    </button>
                                    {expandedClasses[cName] && (
                                        <div className="pl-2 pr-1 py-2 space-y-1.5">
                                            {stds.map(st => {
                                                const isSeated = Object.values(activeStudents).some(s => s.studentId === st.id);
                                                return (
                                                    <div key={st.id} 
                                                         onPointerDown={(e) => isSeated ? null : handleListPointerDown(e, st)}
                                                         className={`p-2.5 rounded-lg text-sm flex justify-between items-center border transition-all ${isSeated ? 'bg-slate-100 border-slate-200 opacity-50' : 'bg-white border-slate-200 hover:border-indigo-400 cursor-grab hover:shadow-md'}`}>
                                                        <span className="font-bold text-slate-800">{st.name}</span>
                                                        {isSeated && <span className="text-[10px] font-bold text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">배정됨</span>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </aside>

                <main className="flex-1 p-6 bg-slate-200 overflow-y-auto relative">
                    {longWaitBanner && (
                        <div className="sticky top-0 z-20 mb-3 bg-rose-600 text-white text-sm font-bold px-4 py-2.5 rounded-lg shadow-md flex items-center gap-2">
                            <span>⚠️</span><span>{longWaitBanner}</span>
                        </div>
                    )}
                    <p className="text-xs text-slate-500 font-bold mb-3">💡 학생 카드를 드래그해서 빈 자리에 놓으면 좌석을 옮길 수 있어요.</p>
                    <div className="grid grid-cols-10 gap-3">
                        {seats.map(seat => {
                            const student = activeStudents[seat];
                            
                            if (!student) {
                                return (
                                    <div key={seat} data-seat={seat}
                                         className={`bg-slate-100/50 border-2 border-dashed ${(draggedSeat || draggedListStudent) && selectedSeatForMove !== seat ? 'border-indigo-300 opacity-100 bg-indigo-50/50' : 'border-slate-300 opacity-60'} rounded-xl p-2 flex flex-col items-center justify-center transition-colors min-h-[196px]`}>
                                        <span className="text-slate-400 text-[10px] font-bold pointer-events-none">{seat}</span>
                                    </div>
                                );
                            }

                            const isOffline = !!student.offlineSince;
                            const isCall = student.status === 'call';
                            const isHint = student.status === 'hint';
                            const isAway = student.status === 'away';
                            const isSubmitted = student.status === 'submitted';
                            const isDragging = draggedSeat === seat;
                            
                            const cardClass = isOffline ? 'bg-slate-100 border-slate-300 opacity-70 grayscale-[50%]' 
                                            : isCall ? 'status-help bg-white' 
                                            : isHint ? 'hint-flash bg-white border-slate-200' 
                                            : isAway ? 'bg-amber-50 border-amber-400' 
                                            : isSubmitted ? 'bg-blue-50 border-blue-400' 
                                            : 'bg-white border-slate-200 hover:shadow-md hover:border-slate-300';
                            
                            const badgeBg = isOffline ? 'bg-slate-500 text-white'
                                          : isCall ? 'bg-rose-600 text-white' 
                                          : isHint ? 'bg-yellow-400 text-yellow-900' 
                                          : isAway ? 'bg-amber-500 text-white' 
                                          : isSubmitted ? 'bg-blue-600 text-white' 
                                          : 'bg-emerald-100 text-emerald-700';
                            
                            const badgeText = isOffline ? '⚫ 오프라인'
                                            : isCall ? `🚨 ${Object.keys(student.calls || {}).length}` 
                                            : isHint ? '💡 힌트' 
                                            : isAway ? '🚶 자리비움' 
                                            : isSubmitted ? '✅ 완료' 
                                            : '🟢 온라인';
                            
                            const remainingMs = (student.firstSeenAt + student.clinicDurationMs) - now;
                            const isUrgent = remainingMs <= 5 * 60 * 1000;

                            const calls = Object.entries(student.calls || {}).sort(([, a]:any, [, b]:any) => a - b);
                            const oldestCallAt = calls.length > 0 ? calls[0][1] : null;

                            return (
                                <div key={seat} data-seat={seat} 
                                     onPointerDown={(e) => handlePointerDown(e, seat)}
                                     className={`relative border ${isAway || isSubmitted ? 'border-2' : ''} rounded-xl p-3 flex flex-col justify-between shadow-sm cursor-grab active:cursor-grabbing min-h-[196px] transition-all duration-300 ${cardClass} ${isDragging ? 'opacity-35 ring-4 ring-indigo-500 ring-offset-1' : ''}`}
                                     title="드래그해서 좌석을 옮길 수 있어요">
                                    <button onClick={(e) => { e.stopPropagation(); setForceCheckoutModal({ isOpen: true, seat }); }} title="강제 퇴실" className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-500 hover:bg-rose-600 text-white rounded-full flex items-center justify-center shadow-md border-2 border-white z-30 transition-transform hover:scale-125">
                                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                    
                                    <div className="flex justify-between items-start mb-1 pointer-events-none">
                                        <span className="bg-[#002864] text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm">{seat}</span>
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${badgeBg}`}>{badgeText}</span>
                                    </div>
                                    
                                    <div className="mt-auto pointer-events-none">
                                        <div className="font-bold text-slate-900 text-[13px] truncate" title={student.name}>{student.name}</div>
                                        {student.classes?.length > 0 ? (
                                            <div className="relative inline-block mb-1 pointer-events-auto group">
                                                <div className="text-[9px] font-bold text-emerald-600 truncate cursor-default">
                                                    {student.classes[0]} {student.classes.length > 1 && <span className="text-emerald-400">+{student.classes.length - 1}</span>}
                                                </div>
                                                {student.classes.length > 1 && (
                                                    <div className="hidden group-hover:block absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded shadow-lg px-2 py-1 whitespace-nowrap z-20">
                                                        <span className="text-[10px] font-bold text-emerald-600">{student.classes.slice(1).join(', ')}</span>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="text-[9px] font-bold text-slate-300 truncate mb-1">반 없음</div>
                                        )}
                                        
                                        {student.activity && (
                                            <div className="text-[10px] font-bold text-indigo-600 truncate mb-1 flex items-center gap-1">
                                                {student.activity} {student.isTyping && <span className="animate-pulse">✍️</span>}
                                            </div>
                                        )}
                                        
                                        <div className="flex items-center gap-2 mt-1 text-[9px] text-slate-400 font-bold">
                                            <span>⏱ <span className="tabular-nums">{isMounted ? formatDuration(now - student.firstSeenAt) : '00:00'}</span></span>
                                            {student.totalCalls > 0 && <span className="text-rose-400">🚨×{student.totalCalls}</span>}
                                            {student.totalHints > 0 && <span className="text-amber-400">💡×{student.totalHints}</span>}
                                        </div>

                                        {isAway && <div className="text-[10px] font-bold text-amber-600 mt-1">비운 지 <span className="tabular-nums">{isMounted ? formatDuration(now - student.awaySince) : '00:00'}</span></div>}
                                        {isCall && oldestCallAt && <div className="text-[10px] font-bold text-rose-600 mt-1">대기 <span className="tabular-nums">{isMounted ? formatDuration(now - Number(oldestCallAt)) : '00:00'}</span></div>}
                                        {student.lastHint && <div className="text-[9px] font-bold text-indigo-400 mt-1 truncate" title="최근 힌트 열람">최근 힌트 Q{student.lastHint.qNum}·{student.lastHint.level}단계 ({isMounted ? formatShortAgo(now - student.lastHint.at) : '방금'} 전)</div>}

                                        <div className="pointer-events-auto">
                                            {isAway && <button onClick={(e) => { e.stopPropagation(); taAction(seat, 'clear_away'); }} className="w-full bg-amber-100 hover:bg-amber-200 text-amber-700 text-[10px] font-bold py-1.5 rounded border border-amber-300 transition-colors leading-tight mt-1.5">복귀 처리</button>}
                                            {isSubmitted && (
                                                <div className="flex flex-col gap-1 mt-1.5">
                                                    <div className="bg-white border border-blue-200 rounded text-center py-0.5 text-[10px] font-bold text-blue-800">{student.score}/5점</div>
                                                    <button onClick={(e) => { e.stopPropagation(); taAction(seat, 'confirm_checkout'); }} className="bg-slate-800 hover:bg-slate-900 text-white text-[10px] font-bold py-1.5 rounded transition-all shadow-sm leading-tight">퇴실처리</button>
                                                </div>
                                            )}
                                        </div>

                                        {student.firstSeenAt && student.clinicDurationMs != null && (
                                            <div className={`flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-100 pointer-events-auto ${isUrgent ? 'text-rose-600' : 'text-slate-400'}`}>
                                                <span className="text-[9px] font-bold whitespace-nowrap">⏳ <span className="tabular-nums">{isMounted ? formatDuration(remainingMs) : '00:00'}</span></span>
                                                <div className="flex items-center rounded-md border border-slate-200 overflow-hidden shadow-sm shrink-0">
                                                    <button onClick={(e) => { e.stopPropagation(); adjustClinicTime(seat, -10); }} title="이용시간 10분 감소" className="w-5 h-5 flex items-center justify-center bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition-colors leading-none">
                                                        <svg className="w-2 h-2" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                    </button>
                                                    <span className="w-px h-3.5 bg-slate-200"></span>
                                                    <button onClick={(e) => { e.stopPropagation(); adjustClinicTime(seat, 10); }} title="이용시간 10분 증가" className="w-5 h-5 flex items-center justify-center bg-white hover:bg-emerald-50 text-slate-400 hover:text-emerald-500 transition-colors leading-none">
                                                        <svg className="w-2 h-2" viewBox="0 0 10 6" fill="none"><path d="M1 5L5 1L9 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </main>

                <aside className="w-[400px] bg-white border-l border-slate-300 flex flex-col h-full shadow-2xl z-10 shrink-0">
                    <div className="bg-slate-800 text-white px-5 py-3 font-bold text-sm flex justify-between items-center shrink-0">
                        <span>⚡ 현장 라이브 로그</span>
                        <span className="text-xs bg-rose-500 px-2 py-0.5 rounded animate-pulse">Live</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
                        {logs.length === 0 ? (
                            <div className="text-center text-xs text-slate-400 py-8">아직 접수된 로그 기록이 없습니다.</div>
                        ) : (
                            logs.map(log => (
                                <div key={log.id} className={`bg-white p-3 rounded-lg border-l-4 ${log.borderClass} shadow-sm transform translate-y-0 transition-all duration-300`}>
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-[10px] font-bold text-slate-400">{log.timestamp}</span>
                                        <span className={`${log.badgeBg} text-[9px] font-bold px-1.5 py-0.5 rounded`}>{log.badgeText}</span>
                                    </div>
                                    <p className="text-sm font-bold text-slate-800">{log.title}</p>
                                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{log.subtitle}</p>
                                    {log.type === 'call' && (
                                        <button onClick={() => taAction(log.data.seat, 'cancel_call', log.data.qNum)} className="mt-2 w-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-1.5 rounded transition-colors">호출 종료</button>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </aside>
            </div>

            {forceCheckoutModal.isOpen && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-[340px] text-center">
                        <div className="text-4xl mb-3">🚪</div>
                        <h3 className="text-lg font-extrabold text-slate-800 mb-2">강제 퇴실 확인</h3>
                        <p className="text-sm text-slate-600 mb-6 font-medium leading-relaxed">
                            <span className="font-bold text-rose-600">{activeStudents[forceCheckoutModal.seat!]?.name}</span> 학생을 강제 퇴실시키겠습니까?
                        </p>
                        <div className="flex gap-2">
                            <button onClick={() => setForceCheckoutModal({ isOpen: false, seat: null })} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3 rounded-lg transition-colors">취소</button>
                            <button onClick={confirmForceCheckout} className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 rounded-lg transition-colors">강제 퇴실</button>
                        </div>
                    </div>
                </div>
            )}

            {recheckModal.isOpen && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-40 px-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                        <div className="bg-indigo-600 text-white px-5 py-3 flex justify-between items-center">
                            <span className="font-bold text-sm">🔄 AI 채점 재확인 — {activeStudents[recheckModal.seat!]?.rechecks?.[recheckModal.uid!]?.name}</span>
                            <button onClick={() => setRecheckModal({ isOpen: false, seat: null, uid: null })} className="text-white/80 hover:text-white text-lg leading-none">✕</button>
                        </div>
                        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                            <div>
                                <p className="text-[11px] font-bold text-slate-400 mb-1">문제</p>
                                <p className="text-sm text-slate-700 leading-relaxed">{activeStudents[recheckModal.seat!]?.rechecks?.[recheckModal.uid!]?.questionText || '(문제 내용 없음)'}</p>
                            </div>
                            <div>
                                <p className="text-[11px] font-bold text-slate-400 mb-1">정답(원문)</p>
                                <p className="text-sm font-bold text-slate-800">{activeStudents[recheckModal.seat!]?.rechecks?.[recheckModal.uid!]?.correctAnswer || '(정답 정보 없음)'}</p>
                            </div>
                            <div>
                                <p className="text-[11px] font-bold text-slate-400 mb-1">학생이 제출한 이미지</p>
                                <img className="w-full rounded-lg border border-slate-200 bg-white" src={activeStudents[recheckModal.seat!]?.rechecks?.[recheckModal.uid!]?.imageDataUrl || ''} alt="답안" />
                            </div>
                            <div className="bg-indigo-50 rounded-lg p-3">
                                <p className="text-[11px] font-bold text-indigo-500 mb-1">🤖 제미나이가 인식한 내용</p>
                                <p className="text-sm text-slate-700 mb-1">"{activeStudents[recheckModal.seat!]?.rechecks?.[recheckModal.uid!]?.recognizedText || '(인식된 내용 없음)'}"</p>
                                <p className="text-xs text-slate-500 leading-relaxed">{activeStudents[recheckModal.seat!]?.rechecks?.[recheckModal.uid!]?.aiExplanation || ''}</p>
                                {activeStudents[recheckModal.seat!]?.rechecks?.[recheckModal.uid!]?.aiConfidence !== undefined && (
                                    <p className="text-[10px] text-slate-400 mt-1">AI 확신도: Math.round({activeStudents[recheckModal.seat!]?.rechecks?.[recheckModal.uid!]?.aiConfidence} * 100)%</p>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-2 p-4 border-t border-slate-100">
                            <button onClick={() => { 
                                sendToStudent(recheckModal.seat!, 'resolve_recheck', { uid: recheckModal.uid, verdict: 'incorrect' }); 
                                appendLog('border-rose-500', 'bg-rose-100 text-rose-600', '재확인·오답', `[${recheckModal.seat!}] ${activeStudents[recheckModal.seat!]?.name} 재확인 결과: 오답 처리`, `총책임자가 처리했습니다.`);
                                removeLogsByTypeAndSeat('recheck', recheckModal.seat!, Number(recheckModal.uid));
                                setRecheckModal({ isOpen: false, seat: null, uid: null }); 
                            }} className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold py-3 rounded-xl text-sm transition-colors">❌ 오답 처리</button>
                            
                            <button onClick={() => { 
                                sendToStudent(recheckModal.seat!, 'resolve_recheck', { uid: recheckModal.uid, verdict: 'correct' }); 
                                appendLog('border-emerald-500', 'bg-emerald-100 text-emerald-600', '재확인·정답', `[${recheckModal.seat!}] ${activeStudents[recheckModal.seat!]?.name} 재확인 결과: 정답 처리`, `총책임자가 처리했습니다.`);
                                removeLogsByTypeAndSeat('recheck', recheckModal.seat!, Number(recheckModal.uid));
                                setRecheckModal({ isOpen: false, seat: null, uid: null }); 
                            }} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl text-sm transition-colors">✅ 정답 처리</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}