"use client";

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { resolveTodaySession, closeSessionAtLimit, setActiveCall, clearActiveCall, setAway, clearAway } from '@/lib/clinicSession';
import { resolveClassWeekType } from '@/lib/classRound';
import { useClinicEndRequest } from '@/hooks/useClinicEndRequest';
import { getPointBalance } from '@/app/actions/shopPoints';
import { getActiveSeatLayout } from '@/app/actions/clinicSeatLayout';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const getSupabaseClient = () => {
    if (typeof window === 'undefined') return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (!(window as any)._supabaseInstance) (window as any)._supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return (window as any)._supabaseInstance;
};
const supabaseClient = getSupabaseClient();

const CLINIC_ROOM = 'logica-clinic-room';
const DEFAULT_CLINIC_SESSION_DURATION_MS = 60 * 60 * 1000;

const getKSTDateString = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

export default function StudentPortal() {
    const router = useRouter();

    const [studentInfo, setStudentInfo] = useState({ id: '', name: '', phone: '', classes: [] as string[] });
    const [activeTab, setActiveTab] = useState('home');
    const [selectedClass, setSelectedClass] = useState('');
    
    const [clinicSession, setClinicSession] = useState<any>(null);
    const [roundResults, setRoundResults] = useState<Record<string, any>>({});
    const [blockStates, setBlockStates] = useState<Record<string, any>>({});
    const [hwProgress, setHwProgress] = useState<Record<string, any>>({});
    // 💡 [11번] 반별 홀/짝 회차(week_type)는 시험 클리닉이 "주간테스트"로 나갈지 "과제오답유사"로
    // 나갈지를 결정하는데, startClinicBlock이 이 값을 전혀 읽지 않고 있었다 — 그래서 라운드1은
    // week 파라미터를 아예 안 보내 항상 clinic/viewer의 기본값('odd'=주간테스트)으로 고정되어
    // 있었고, resolveClassWeekType으로 관리되는 홀짝 전환은 실제로는 아무 효과가 없었다.
    const [classWeekTypes, setClassWeekTypes] = useState<Record<string, string>>({});
    
    const [now, setNow] = useState(Date.now());
    const [timeUpModal, setTimeUpModal] = useState({ isOpen: false, icon: '⏰', title: '클리닉 시간이 종료되었습니다', desc: '오늘 배정된 클리닉 시간이 모두 지났어요.' });
    const [endRequestConfirmOpen, setEndRequestConfirmOpen] = useState(false);

    const [mockPoints, setMockPoints] = useState(0);
    const [isPortalAway, setIsPortalAway] = useState(false);
    const [isPortalCalling, setIsPortalCalling] = useState(false);
    const [manualSeat, setManualSeat] = useState<string | null>(null);
    const [editorLocked, setEditorLocked] = useState(false);
    const channelRef = useRef<any>(null);
    const sessionEndedRef = useRef(false);

    const clinicSessionRef = useRef<any>(null);
    const trackedSeatRef = useRef<string | null>(null);
    const isSyncingSessionRef = useRef(false);

    const [isMounted, setIsMounted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false); 

    useEffect(() => { setIsMounted(true); }, []);

    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.log("전체화면을 지원하지 않는 기기입니다.", err);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener("fullscreenchange", handleFullscreenChange);
        return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
    }, []);

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const sid = localStorage.getItem('logica_student_id');
        const sname = localStorage.getItem('logica_student_name');
        if (!sid || !sname) {
            alert('로그인 정보가 만료되었습니다.');
            router.push('/student/login');
            return;
        }

        const initData = async () => {
            let classes: string[] = [];
            try {
                const { data } = await supabaseClient.from('student').select('enrollment(class(name))').eq('student_id', sid).single();
                if (data?.enrollment) classes = Array.from(new Set(data.enrollment.map((e: any) => e.class?.name).filter(Boolean)));
            } catch (e) {}
            if (classes.length === 0) classes = ['반 미배정'];
            setStudentInfo({ id: sid, name: sname, phone: localStorage.getItem('logica_student_phone') || '', classes });
            setSelectedClass(classes[0]);
            getPointBalance(sid).then(setMockPoints).catch(err => console.error('포인트 조회 중 오류:', err));

            const today = getKSTDateString();
            const session = await resolveTodaySession(supabaseClient, sid, today);

            clinicSessionRef.current = session;
            setClinicSession(session);
            setManualSeat(session.manual_seat || null);

            const { data: rData } = await supabaseClient.from('clinic_round_result').select('*').eq('student_id', sid);
            const results: any = {};
            rData?.forEach((r: any) => results[`${r.class_name}::${r.round}`] = r);
            setRoundResults(results);

            await fetchBlockStates(sid, classes);
        };

        initData();
    }, [router]);

    useEffect(() => {
        if (!studentInfo.id || !isMounted) return;

        const runDbSync = async () => {
            if (!clinicSessionRef.current?.id) return;
            const { data, error } = await supabaseClient
                .from('clinic_session_state')
                .select('duration_ms, seat, manual_seat, started_at, ended_at, end_request_status, end_request_cooldown_until')
                .eq('id', clinicSessionRef.current.id)
                .maybeSingle();

            if (!error && data) {
                let hasChanges = false;

                if (clinicSessionRef.current?.duration_ms !== data.duration_ms ||
                    clinicSessionRef.current?.seat !== data.seat ||
                    clinicSessionRef.current?.manual_seat !== data.manual_seat) {

                    const updatedSession = { ...clinicSessionRef.current, ...data };
                    clinicSessionRef.current = updatedSession;
                    setClinicSession(updatedSession);
                    hasChanges = true;

                    if (data.manual_seat !== manualSeat) {
                        setManualSeat(data.manual_seat);
                    }
                }

                if (hasChanges && sessionEndedRef.current && !data.ended_at) {
                    const remaining = (new Date(data.started_at).getTime() + data.duration_ms) - Date.now();
                    if (remaining > 0) {
                        sessionEndedRef.current = false;
                        setTimeUpModal(prev => ({ ...prev, isOpen: false }));
                    }
                }
            }
        };

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const scheduleNext = () => {
            if (cancelled) return;
            timer = setTimeout(async () => {
                if (cancelled) return;
                if (isSyncingSessionRef.current) { scheduleNext(); return; }
                isSyncingSessionRef.current = true;
                try {
                    await runDbSync();
                } catch (err) {} finally {
                    isSyncingSessionRef.current = false;
                    scheduleNext();
                }
            }, 5000);
        };
        scheduleNext();

        return () => { cancelled = true; if (timer) clearTimeout(timer); };
    }, [studentInfo.id, isMounted, manualSeat]);

    const fetchBlockStates = async (sid: string, classes: string[]) => {
        const today = getKSTDateString();
        const newBlockStates: any = {};
        const newHwProgress: any = {};
        classes.forEach(c => {
            newBlockStates[c] = { exam: 'NO_DATA', hw: 'NO_DATA', print: 'NO_DATA' };
            newHwProgress[c] = { examIds: [], hwExamIds: [], printIds: [], hwIds: [], overdueHwIds: [] };
        });

        const { data: cData } = await supabaseClient.from('class')
            .select('class_id, name, week_type, week_type_updated_date, session_parity, forced_week_type, forced_week_type_date, class_schedule(day_of_week)')
            .in('name', classes);
        const nameToId: any = {};
        cData?.forEach((c: any) => { nameToId[c.name] = c.class_id; });

        // 💡 [11번] ClassEditModal을 아무도 열지 않아도(=관리자가 안 봐도), 학생이 포탈에 들어올
        // 때마다 지나간 회차만큼 자동으로 홀/짝을 갱신한다 — resolveClassWeekType은 idempotent라
        // 여러 화면에서 동시에 호출해도 안전하다.
        const newClassWeekTypes: Record<string, string> = {};
        await Promise.all((cData || []).map(async (c: any) => {
            const scheduleDays = (c.class_schedule || []).map((s: any) => s.day_of_week);
            try {
                const { weekType: wt } = await resolveClassWeekType(supabaseClient, {
                    class_id: c.class_id, class_name: c.name, week_type: c.week_type,
                    week_type_updated_date: c.week_type_updated_date, session_parity: c.session_parity, scheduleDays,
                    forced_week_type: c.forced_week_type, forced_week_type_date: c.forced_week_type_date,
                });
                newClassWeekTypes[c.name] = wt;
            } catch (e) { newClassWeekTypes[c.name] = c.week_type === 'even' ? 'even' : 'odd'; }
        }));
        setClassWeekTypes(newClassWeekTypes);

        const { data: examsData } = await supabaseClient.from('exam_assignment')
            .select('assignment_id, status, class_id, exam_master!inner(exam_type)')
            .eq('student_id', sid);

        const classIds = Object.values(nameToId).filter(Boolean);
        let hwsData: any[] = [];
        if (classIds.length > 0) {
            const { data } = await supabaseClient.from('homework_assignment')
                .select('homework_id, class_id, target_student_id, due_date')
                .in('class_id', classIds as string[])
                .neq('homework_title', '[시스템] 수업 진도 완료 기록');
            hwsData = data || [];
        }

        const { data: hwResData } = await supabaseClient.from('student_homework_result')
            .select('homework_id, status')
            .eq('student_id', sid);
        const hwResMap = new Map();
        hwResData?.forEach((r: any) => hwResMap.set(r.homework_id, r.status));

        classes.forEach(c => {
            const cid = nameToId[c];
            if (!cid) return;

            let examPending = 0, hwPending = 0, printPending = 0, overduePending = 0;
            let examIds: number[] = [], hwExamIds: number[] = [], printIds: number[] = [], hwIds: number[] = [], overdueHwIds: number[] = [];

            examsData?.forEach((ex: any) => {
                if (ex.class_id && ex.class_id !== cid) return;
                const type = Array.isArray(ex.exam_master) ? ex.exam_master[0]?.exam_type : ex.exam_master?.exam_type;
                const isPending = !['제출완료', '채점완료', '완료'].includes(ex.status);

                if (type === '오답프린트') {
                    if (isPending) { printPending++; printIds.push(ex.assignment_id); }
                } else if (type === '과제' || type === '과제프린트') {
                    if (isPending) { hwPending++; hwExamIds.push(ex.assignment_id); }
                } else {
                    if (isPending) { examPending++; examIds.push(ex.assignment_id); }
                }
            });

            hwsData?.forEach((hw: any) => {
                if (hw.class_id !== cid) return;
                if (hw.target_student_id && hw.target_student_id !== sid) return;
                const status = hwResMap.get(hw.homework_id) || '미제출';
                const isPending = !['제출완료', '채점완료', '완료'].includes(status);
                if (!isPending) return;
                // 💡 지난 회차(수업일)를 넘긴 채 남은 과제는 classRound.ts의 migrateIncompleteForClassRound가
                // due_date를 그 회차 날짜로 당겨둔다 — 그래서 due_date가 오늘 이하로 내려와 있으면
                // "다음 수업이 이미 찾아온" 미완료 과제로 분류해 별도 박스로 옮긴다.
                if (hw.due_date && hw.due_date <= today) { overduePending++; overdueHwIds.push(hw.homework_id); }
                else { hwPending++; hwIds.push(hw.homework_id); }
            });

            newBlockStates[c].exam = examPending > 0 ? '미응시' : '제출완료';
            newBlockStates[c].hw = hwPending > 0 ? '미응시' : '제출완료';
            newBlockStates[c].print = printPending > 0 ? '미응시' : '제출완료';
            newBlockStates[c].overdue = overduePending > 0 ? '미응시' : '제출완료';

            if (roundResults[`${c}::1`]) newBlockStates[c].exam = '제출완료';
            if (roundResults[`${c}::2`]) newBlockStates[c].hw = '제출완료';
            if (roundResults[`${c}::3`]) newBlockStates[c].print = '제출완료';

            newHwProgress[c] = { examIds, hwExamIds, printIds, hwIds, overdueHwIds };
        });

        setBlockStates(newBlockStates);
        setHwProgress(newHwProgress);
    };

    useEffect(() => {
        if (!studentInfo.id || !clinicSessionRef.current) return;

        const connectPresence = async () => {
            if (channelRef.current) {
                await supabaseClient.removeChannel(channelRef.current);
                channelRef.current = null;
            }
            const channel = supabaseClient.channel(CLINIC_ROOM);
            channelRef.current = channel;

            const allSeats = (await getActiveSeatLayout()).seats.map(s => String(s.number));

            channel.on('presence', { event: 'sync' }, async () => {
                const state = channel.presenceState();
                setEditorLocked(Object.values(state).some((metas: any) => metas.some((m: any) => m.role === 'editor')));

                const amIOnline = Object.values(state).flat().some((m: any) => m.studentId === studentInfo.id);
                if (amIOnline) return;

                const occupied = new Set();
                Object.values(state).forEach((metas: any) => metas.forEach((m: any) => { if (m.seat) occupied.add(m.seat); }));

                const todayStr = getKSTDateString();
                const { data: dbSessions } = await supabaseClient.from('clinic_session_state').select('seat').eq('session_date', todayStr).is('ended_at', null).not('seat', 'is', null);
                dbSessions?.forEach((s: any) => occupied.add(s.seat));

                let targetSeat = trackedSeatRef.current || manualSeat;
                let isReal = !manualSeat;

                if (!targetSeat) {
                    targetSeat = clinicSessionRef.current?.seat || allSeats.find(s => !occupied.has(s)) || null;
                    if (targetSeat && targetSeat !== clinicSessionRef.current?.seat && clinicSessionRef.current?.id) {
                        await supabaseClient.from('clinic_session_state').update({ seat: targetSeat }).eq('id', clinicSessionRef.current.id);
                        clinicSessionRef.current = { ...clinicSessionRef.current, seat: targetSeat };
                        setClinicSession(clinicSessionRef.current);
                    }
                }

                if (targetSeat) {
                    trackedSeatRef.current = targetSeat;
                    channel.track({
                        seat: targetSeat, 
                        name: studentInfo.name, 
                        studentId: studentInfo.id, 
                        classes: studentInfo.classes,
                        startedAt: isReal ? new Date(clinicSessionRef.current?.started_at || Date.now()).getTime() : Date.now(),
                        durationMs: clinicSessionRef.current?.duration_ms || DEFAULT_CLINIC_SESSION_DURATION_MS,
                        updatedAt: Date.now()
                    }).then(() => {
                        channel.send({
                            type: 'broadcast', event: 'student_action',
                            payload: { seat: targetSeat, action: 'update_activity', data: { studentId: studentInfo.id, activity: '포털에서 문제 선택 중 📋' } }
                        });
                    });
                }
            })
            .on('broadcast', { event: 'ta_action' }, ({ payload }: { payload: any }) => {
                const currentSeat = manualSeat || clinicSessionRef.current?.seat;
                if (payload.seat !== currentSeat && payload.studentId !== studentInfo.id) return;

                if (payload.action === 'move_seat' && payload.newSeat) {
                    if (manualSeat) setManualSeat(payload.newSeat);
                    else {
                        clinicSessionRef.current = { ...clinicSessionRef.current, seat: payload.newSeat };
                        setClinicSession(clinicSessionRef.current);
                    }
                    trackedSeatRef.current = payload.newSeat;
                    channel.track({ 
                        seat: payload.newSeat, name: studentInfo.name, studentId: studentInfo.id, classes: studentInfo.classes,
                        startedAt: new Date(clinicSessionRef.current.started_at).getTime(), durationMs: clinicSessionRef.current.duration_ms, updatedAt: Date.now() 
                    });
                } 
                else if (payload.action === 'force_checkout' || payload.action === 'force_checkout_by_ta') {
                    if (sessionEndedRef.current) return;
                    sessionEndedRef.current = true;
                    if (payload.action === 'force_checkout_by_ta') setTimeUpModal({ isOpen: true, icon: '🚪', title: '조교에 의해 강제 퇴실 처리되었습니다', desc: '조교가 클리닉 이용을 종료했어요.' });
                    else setTimeUpModal({ isOpen: true, icon: '✅', title: '퇴실이 승인되었습니다', desc: '수고하셨습니다!' });
                }
                else if (payload.action === 'end_clinic_resolved' && payload.studentId === studentInfo.id) {
                    endRequestRef.current?.handleResolved({ approved: payload.approved, cooldownUntil: payload.cooldownUntil });
                }
                else if (payload.action === 'adjust_clinic_time') {
                    const nextDuration = payload.newDuration !== undefined ? payload.newDuration : Math.max(0, (clinicSessionRef.current?.duration_ms || 0) + Number(payload.deltaMs || 0));
                    clinicSessionRef.current = { ...clinicSessionRef.current, duration_ms: nextDuration };
                    setClinicSession({ ...clinicSessionRef.current }); 
                    
                    if (trackedSeatRef.current) {
                        channel.track({
                            seat: trackedSeatRef.current, name: studentInfo.name, studentId: studentInfo.id, classes: studentInfo.classes,
                            startedAt: new Date(clinicSessionRef.current.started_at).getTime(), durationMs: nextDuration, updatedAt: Date.now()
                        });
                    }

                    const remainingMs = (new Date(clinicSessionRef.current.started_at).getTime() + nextDuration) - Date.now();
                    if (sessionEndedRef.current && remainingMs > 0) {
                        sessionEndedRef.current = false;
                        setTimeUpModal(prev => ({ ...prev, isOpen: false }));
                    }
                }
                else if (payload.action === 'force_return_to_seat') setIsPortalAway(false);
                else if (payload.action === 'force_cancel_call') setIsPortalCalling(false);
            }).subscribe();
        };

        connectPresence();
        return () => { if (channelRef.current) supabaseClient.removeChannel(channelRef.current); };
    }, [studentInfo.id, manualSeat, clinicSession?.id]);

    const finalizeAndGoToLogin = async () => {
        if (channelRef.current && trackedSeatRef.current) {
            await channelRef.current.send({ type: 'broadcast', event: 'student_action', payload: { seat: trackedSeatRef.current, action: 'depart', data: { studentId: studentInfo.id, name: studentInfo.name } } });
            await channelRef.current.untrack();
        }
        localStorage.removeItem('logica_student_id');
        localStorage.removeItem('logica_student_name');
        localStorage.removeItem('logica_student_phone');
        router.push('/student/login');
    };

    const sendClinicAction = (action: string, extra: any = {}) => {
        if (channelRef.current && trackedSeatRef.current) {
            channelRef.current.send({ type: 'broadcast', event: 'student_action', payload: { seat: trackedSeatRef.current, action, data: { studentId: studentInfo.id, name: studentInfo.name, ...extra } } });
        }
    };

    const togglePortalAway = () => {
        if (isPortalCalling) { alert('조교 호출 중에는 자리비움 상태로 전환할 수 없습니다.'); return; }
        const next = !isPortalAway;
        setIsPortalAway(next);
        sendClinicAction(next ? 'away' : 'cancel_away');
        const sid = clinicSessionRef.current?.id;
        if (sid) (next ? setAway : clearAway)(supabaseClient, sid);
    };

    const togglePortalCall = () => {
        if (isPortalAway) { alert('자리비움 중에는 조교를 호출할 수 없습니다.'); return; }
        const next = !isPortalCalling;
        setIsPortalCalling(next);
        sendClinicAction(next ? 'call' : 'cancel_call', { qNum: 'general' });
        const sid = clinicSessionRef.current?.id;
        if (sid) (next ? setActiveCall(supabaseClient, sid, 'general', { qNum: 'general' }) : clearActiveCall(supabaseClient, sid, 'general'));
    };

    const endRequest = useClinicEndRequest({
        supabaseClient, sendAction: sendClinicAction, sessionId: clinicSession?.id,
        endRequestStatus: clinicSession?.end_request_status, endRequestCooldownUntil: clinicSession?.end_request_cooldown_until,
        onApproved: finalizeAndGoToLogin,
    });
    const endRequestRef = useRef(endRequest);
    useEffect(() => { endRequestRef.current = endRequest; });

    const startClinicBlock = async (className: string, round: number, typeKey: string) => {
        if (isPortalAway || isPortalCalling) {
            alert('자리비움/호출 처리 중에는 클리닉에 입장할 수 없습니다. 상태를 해제한 후 다시 시도해주세요.');
            return;
        }
        const params = new URLSearchParams({ round: String(round), class: className });
        const prog = hwProgress[className] || {};

        let testName = '';
        if (typeKey === 'exam') {
            testName = '시험';
            params.append('week', classWeekTypes[className] === 'even' ? 'even' : 'odd');
            if (prog.examIds.length > 0) params.append('assignment_id', prog.examIds[0]);
        } else if (typeKey === 'hw') {
            testName = '과제';
            if (prog.hwIds.length > 0) params.append('homework_ids', prog.hwIds.join(','));
            if (prog.hwExamIds.length > 0) params.append('assignment_id', prog.hwExamIds[0]);
        } else if (typeKey === 'overdue') {
            testName = '미완료 과제';
            if (prog.overdueHwIds.length > 0) params.append('homework_ids', prog.overdueHwIds.join(','));
        } else if (typeKey === 'print') {
            testName = '오답프린트';
            if (prog.printIds.length > 0) params.append('assignment_id', prog.printIds[0]);
        }

        if (channelRef.current && trackedSeatRef.current) {
            await channelRef.current.send({
                type: 'broadcast', event: 'student_action',
                payload: { seat: trackedSeatRef.current, action: 'update_activity', data: { studentId: studentInfo.id, activity: `[${className}] ${testName} 응시 진입 🏃‍♂️` } }
            });
            await channelRef.current.untrack();
        }

        if (channelRef.current) {
            await supabaseClient.removeChannel(channelRef.current);
            channelRef.current = null;
        }

        router.push(`/clinic/viewer?${params.toString()}`);
    };

    const renderCard = (typeKey: string, round: number, className: string) => {
        const cState = blockStates[className] || {};
        const isDone = cState[typeKey] === '제출완료' || cState[typeKey] === '채점완료';
        const prog = hwProgress[className] || {};

        let pendingCount = 0;
        if (typeKey === 'exam') pendingCount = prog.examIds?.length || 0;
        else if (typeKey === 'hw') pendingCount = (prog.hwIds?.length || 0) + (prog.hwExamIds?.length || 0);
        else if (typeKey === 'print') pendingCount = prog.printIds?.length || 0;

        const scoreData = roundResults[`${className}::${round}`];
        const scoreLabel = scoreData?.forced_done ? '완료' : (scoreData?.correct != null ? `${scoreData.correct}/${scoreData.total}` : '완료');

        // 💡 라운드1(exam)은 반의 홀/짝 회차에 따라 실제로 완전히 다른 내용(주간테스트 ↔
        // 과제오답유사)을 내보내는데(fetchWeeklyTest), 예전엔 두 경우 모두 같은 파란 "📝 시험" 박스로
        // 보여서 학생이 오늘 뭘 풀게 될지 미리 구분할 수 없었다. 홀/짝별로 색/이름을 나눈다.
        const isEvenWeek = classWeekTypes[className] === 'even';
        let theme;
        if (typeKey === 'exam' && isEvenWeek) theme = { label: '🔁 과제오답유사', desc: '과제에서 틀렸던 문제와 비슷한 문제를 다시 풀어봅니다.', bg: 'bg-gradient-to-br from-cyan-700 to-cyan-600', badge: 'bg-cyan-400 text-cyan-900', btnText: 'text-cyan-900', textColor: 'text-cyan-100' };
        else if (typeKey === 'exam') theme = { label: '📝 주간테스트', desc: '이번 주 주간테스트를 응시합니다.', bg: 'bg-gradient-to-br from-[#002864] to-blue-800', badge: 'bg-blue-500 text-white', btnText: 'text-[#002864]', textColor: 'text-blue-200' };
        else if (typeKey === 'hw') theme = { label: '📚 과제', desc: '미제출 과제 문항을 학습합니다.', bg: 'bg-gradient-to-br from-amber-600 to-amber-500', badge: 'bg-amber-400 text-amber-900', btnText: 'text-amber-900', textColor: 'text-amber-100' };
        else theme = { label: '🖨️ 오답', desc: '틀린 문제들만 모아 다시 풉니다.', bg: 'bg-gradient-to-br from-emerald-700 to-emerald-600', badge: 'bg-emerald-400 text-emerald-900', btnText: 'text-emerald-900', textColor: 'text-emerald-100' };

        return (
            <div key={`${className}-${typeKey}`} className={`w-full ${theme.bg} rounded-[1.5rem] p-6 md:p-8 text-white shadow-xl relative overflow-hidden group flex flex-col min-h-[240px] md:min-h-[260px] justify-between`}>
                {isDone && <span className={`absolute top-5 right-5 bg-white/90 ${theme.btnText} text-[12px] font-black px-3 py-1.5 rounded-full shadow-md z-20 border border-slate-100`}>✅ {scoreLabel}</span>}
                <div>
                    <div className="flex justify-between items-start mb-5 relative z-10">
                        <span className={`text-[12px] font-black ${theme.badge} px-2.5 py-1.5 rounded-lg shadow-sm flex items-center`}>{theme.label}</span>
                        {!isDone && pendingCount > 0 && <span className={`text-sm font-bold ${theme.textColor}`}>남은 항목: {pendingCount}건</span>}
                    </div>
                    <h3 className="text-2xl font-black mb-2 relative z-10">{theme.label.replace(/[^가-힣 ]/g, '').trim()} 클리닉</h3>
                    <p className={`text-base ${theme.textColor} font-medium relative z-10`}>{theme.desc}</p>
                </div>
                <div className="flex items-center justify-end relative z-10">
                    {isDone ? 
                        <button disabled className={`bg-white/70 ${theme.btnText} font-black px-6 py-3 text-base rounded-xl shadow-sm opacity-90 cursor-not-allowed`}>완료됨</button> 
                    : 
                        <button onClick={() => startClinicBlock(className, round, typeKey)} className={`bg-white ${theme.btnText} font-black px-6 py-3 text-base rounded-xl shadow-lg hover:scale-105 hover:bg-slate-50 transition-all`}>응시하기</button>
                    }
                </div>
            </div>
        );
    };

    // 💡 예전엔 이 자리가 하드코딩된 "예정된 시험" D-Day 목업이었다. 실제로는 다음 수업 회차가
    // 지날 때까지 못 끝낸 과제(classRound.ts의 migrateIncompleteForClassRound가 due_date를
    // 그 회차 날짜로 당겨 표시해 둔 것)를 보여줘야 해서, hwProgress의 overdueHwIds를 그대로 쓴다.
    const renderOverdueCard = (className: string) => {
        const cState = blockStates[className] || {};
        const isDone = cState.overdue !== '미응시';
        const prog = hwProgress[className] || {};
        const overdueCount = prog.overdueHwIds?.length || 0;

        const theme = {
            label: '⏰ 미완료 과제',
            desc: '다음 수업 전까지 끝내지 못해 밀린 과제입니다.',
            bg: 'bg-gradient-to-br from-violet-700 to-violet-600',
            badge: 'bg-violet-400 text-violet-900',
            btnText: 'text-violet-900',
            textColor: 'text-violet-100'
        };

        return (
            <div key={`${className}-overdue`} className={`w-full ${theme.bg} rounded-[1.5rem] p-6 md:p-8 text-white shadow-xl relative overflow-hidden group flex flex-col min-h-[240px] md:min-h-[260px] justify-between`}>
                {isDone && <span className={`absolute top-5 right-5 bg-white/90 ${theme.btnText} text-[12px] font-black px-3 py-1.5 rounded-full shadow-md z-20 border border-slate-100`}>✅ 밀린 과제 없음</span>}
                <div>
                    <div className="flex justify-between items-start mb-5 relative z-10">
                        <span className={`text-[12px] font-black ${theme.badge} px-2.5 py-1.5 rounded-lg shadow-sm flex items-center`}>{theme.label}</span>
                        {!isDone && overdueCount > 0 && <span className={`text-sm font-bold ${theme.textColor}`}>남은 항목: {overdueCount}건</span>}
                    </div>
                    <h3 className="text-2xl font-black mb-2 relative z-10">미완료 과제 클리닉</h3>
                    <p className={`text-base ${theme.textColor} font-medium relative z-10`}>{theme.desc}</p>
                </div>
                <div className="flex items-center justify-end relative z-10">
                    {isDone ?
                        <button disabled className={`bg-white/70 ${theme.btnText} font-black px-6 py-3 text-base rounded-xl shadow-sm opacity-90 cursor-not-allowed`}>밀린 과제 없음</button>
                    :
                        <button onClick={() => startClinicBlock(className, 2, 'overdue')} className={`bg-white ${theme.btnText} font-black px-6 py-3 text-base rounded-xl shadow-lg hover:scale-105 hover:bg-slate-50 transition-all`}>학습하기</button>
                    }
                </div>
            </div>
        );
    };

    const isSameDay = clinicSession?.session_date === getKSTDateString();
    const remainingMs = isSameDay ? (new Date(clinicSession?.started_at || 0).getTime() + (clinicSession?.duration_ms || DEFAULT_CLINIC_SESSION_DURATION_MS)) - now : 0;
    const isUrgent = remainingMs <= 5 * 60 * 1000;
    const m = Math.max(0, Math.floor(remainingMs / 1000 / 60));
    const s = Math.max(0, Math.floor(remainingMs / 1000) % 60);

    useEffect(() => {
        if (isSameDay && remainingMs <= 0 && isMounted && !sessionEndedRef.current) {
            sessionEndedRef.current = true;
            if (clinicSessionRef.current?.id) {
                closeSessionAtLimit(supabaseClient, clinicSessionRef.current.id, clinicSessionRef.current.started_at, clinicSessionRef.current.duration_ms);
            }
            setTimeUpModal({ isOpen: true, icon: '⏰', title: '클리닉 시간이 종료되었습니다', desc: '오늘 배정된 클리닉 이용 시간이 모두 지났어요.\n수고하셨습니다!' });
        }
    }, [remainingMs, isSameDay, isMounted]);

    return (
        <div className="min-h-screen flex flex-col bg-slate-100 font-['Pretendard']">
            {editorLocked && (
                <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[999] flex items-center justify-center px-6">
                    <div className="bg-white rounded-3xl shadow-2xl p-8 text-center max-w-sm">
                        <div className="text-4xl mb-3">🔒</div>
                        <h3 className="text-lg font-extrabold text-slate-800 mb-2">좌석 배치 수정 중입니다</h3>
                        <p className="text-sm text-slate-500">관리자가 좌석 배치를 편집하는 동안에는<br />클리닉 기능이 잠시 멈춥니다. 잠시만 기다려주세요.</p>
                    </div>
                </div>
            )}
            <style dangerouslySetInnerHTML={{ __html: `
                @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;700;900&display=swap');
                .font-lexend { font-family: 'Lexend', sans-serif; }
                .no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}} />

            {/* 💡 상단 패딩 축소 (py-4 -> py-3) */}
            <nav className="bg-white px-6 md:px-8 py-2.5 md:py-3 flex justify-between items-center border-b border-slate-200 sticky top-0 z-30 shadow-sm">
                <div className="flex items-center gap-8">
                    <div className="flex items-center">
                        <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-8 object-contain" />
                        <span className="ml-2 text-blue-500 font-bold text-sm">Student</span>
                    </div>
                    <div className="hidden md:flex gap-6 text-sm mt-1">
                        <button onClick={() => setActiveTab('home')} className={`font-bold transition-all ${activeTab === 'home' ? 'text-[#002864] border-b-2 border-[#002864]' : 'text-slate-500 hover:text-slate-800 pb-0.5'}`}>홈</button>
                        <button onClick={() => setActiveTab('study')} className={`font-bold transition-all ${activeTab === 'study' ? 'text-[#002864] border-b-2 border-[#002864]' : 'text-slate-500 hover:text-slate-800 pb-0.5'}`}>내 학습실</button>
                        <button onClick={() => setActiveTab('review')} className={`font-bold transition-all ${activeTab === 'review' ? 'text-[#002864] border-b-2 border-[#002864]' : 'text-slate-500 hover:text-slate-800 pb-0.5'}`}>오답노트</button>
                        <button onClick={() => setActiveTab('analysis')} className={`font-bold transition-all ${activeTab === 'analysis' ? 'text-[#002864] border-b-2 border-[#002864]' : 'text-slate-500 hover:text-slate-800 pb-0.5'}`}>성적분석</button>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {isSameDay && (
                        <div className={`flex items-center gap-1.5 border rounded-full px-3 py-1.5 shadow-sm transition-colors ${isUrgent ? 'bg-rose-100 border-rose-300 animate-pulse' : 'bg-indigo-50 border-indigo-200'}`}>
                            <span className="text-indigo-500 text-sm">🕐</span>
                            <span className="text-sm font-black font-lexend text-indigo-600">{isMounted && remainingMs <= 0 ? '종료' : `${m}:${String(s).padStart(2, '0')}`}</span>
                        </div>
                    )}
                    {isSameDay && (
                        <button onClick={togglePortalAway} disabled={isPortalCalling} className={`text-xs font-bold rounded-full px-3 py-1.5 border shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isPortalAway ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                            {isPortalAway ? '↩️ 자리 복귀' : '🚶 자리비움'}
                        </button>
                    )}
                    {isSameDay && (
                        <button onClick={togglePortalCall} disabled={isPortalAway} className={`text-xs font-bold rounded-full px-3 py-1.5 border shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isPortalCalling ? 'bg-rose-600 border-rose-600 text-white animate-pulse' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                            {isPortalCalling ? '🚨 호출 취소' : '🙋 조교 호출'}
                        </button>
                    )}

                    <button onClick={toggleFullScreen} className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-full px-3 py-1.5 cursor-pointer hover:bg-slate-200 transition-colors shadow-sm hidden sm:flex">
                        <span className="text-[11px] font-bold text-slate-600">{isFullscreen ? '🗗 기본화면' : '📺 전체화면'}</span>
                    </button>

                    <button onClick={() => router.push('/student/shop')} className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5 cursor-pointer hover:bg-amber-100 transition-colors shadow-sm">
                        <span className="text-amber-500 text-sm font-black font-lexend">{mockPoints.toLocaleString()} P</span>
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-200 px-1.5 rounded-full">상점 가기 🛒</span>
                    </button>
                    <div className="w-px h-5 bg-slate-200 mx-1"></div>
                    <div className="flex items-center gap-3">
                        <div className="text-right">
                            <p className="text-sm font-bold text-slate-800">{studentInfo.name} 학생</p>
                            <p className="text-[11px] font-bold text-emerald-500 mt-0.5">{studentInfo.classes.join(', ')}</p>
                        </div>
                        <div className="w-10 h-10 rounded-full bg-[#002864] text-white flex items-center justify-center text-xl shadow-md">👦🏻</div>
                        {endRequest.state === 'idle' && (
                            <button onClick={() => setEndRequestConfirmOpen(true)} className="text-xs font-bold text-slate-400 hover:text-rose-500 border border-slate-200 hover:border-rose-300 rounded-full px-3 py-1.5 transition-colors">
                                클리닉 종료 요청
                            </button>
                        )}
                        {endRequest.state === 'pending' && (
                            <button onClick={endRequest.cancelRequest} className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5 animate-pulse">
                                ⏳ 요청 취소
                            </button>
                        )}
                        {endRequest.state === 'cooldown' && (
                            <span className="text-xs font-bold text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-3 py-1.5">
                                재요청까지 {Math.floor(endRequest.cooldownRemainingMs / 60000)}:{String(Math.floor(endRequest.cooldownRemainingMs / 1000) % 60).padStart(2, '0')}
                            </span>
                        )}
                    </div>
                </div>
            </nav>

            {/* 💡 메인 영역 상하 패딩 축소 (py-8 -> py-4 ~ py-5) */}
            <main className="max-w-[1200px] w-full mx-auto py-5 px-6 md:py-6 md:px-8 flex-1">
                {activeTab === 'home' && studentInfo.classes.length > 0 && studentInfo.classes[0] !== '반 미배정' && (
                    <section className="mb-4">
                        {/* 💡 헤더 영역 여백 축소 (mb-8 -> mb-5) */}
                        <div className="flex items-center gap-4 mb-5">
                            <h2 className="text-3xl font-black text-slate-800 flex items-center gap-3">🚀 오늘의 학습 클리닉</h2>
                            {studentInfo.classes.length > 1 && studentInfo.classes.map((cls) => (
                                <button key={cls} onClick={() => setSelectedClass(cls)} className={`text-base font-black px-5 py-2 rounded-full shadow-sm transition-colors inline-flex items-center gap-1.5 ${selectedClass === cls ? 'bg-[#002864] text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                    <span>🏫</span>{cls}
                                </button>
                            ))}
                        </div>
                        {/* 💡 카드 그리드 간격 축소 (gap-8 -> gap-6) */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                            {renderCard('exam', 1, selectedClass)}
                            {renderCard('hw', 2, selectedClass)}
                            {renderCard('print', 3, selectedClass)}
                            {renderOverdueCard(selectedClass)}
                        </div>
                    </section>
                )}

                {activeTab === 'study' && <h2 className="text-3xl font-bold text-slate-800">📚 내 학습실 준비 중</h2>}
                {activeTab === 'review' && (
                    <div className="bg-gradient-to-r from-[#002864] to-indigo-800 rounded-3xl shadow-lg p-12 flex justify-between items-center group overflow-hidden relative">
                        <div className="absolute right-[-10px] top-[-30px] text-9xl opacity-10 transform rotate-12 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-0">🚀</div>
                        <div className="relative z-10">
                            <span className="bg-indigo-500 text-white text-sm font-black px-4 py-1.5 rounded-lg mb-4 inline-block shadow-sm">스마트 클리닉</span>
                            <h3 className="text-4xl font-black text-white mb-3">스마트 오답 리뷰 시작하기</h3>
                            <p className="text-indigo-200 text-lg font-bold">틀린 문제들을 스스로 정복해보세요!</p>
                        </div>
                        <button onClick={() => router.push('/student/review')} className="relative z-10 bg-white text-[#002864] font-black px-10 py-5 text-lg rounded-2xl shadow-xl hover:bg-indigo-50 hover:scale-105 transition-all">
                            오답 리뷰 페이지로 이동 &rarr;
                        </button>
                    </div>
                )}
                {activeTab === 'analysis' && <h2 className="text-3xl font-bold text-slate-800">📈 성적 분석 준비 중</h2>}
            </main>

            {timeUpModal.isOpen && (
                <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[80]">
                    <div className="bg-white rounded-3xl shadow-2xl p-12 w-full max-w-md text-center">
                        <div className="text-7xl mb-6">{timeUpModal.icon}</div>
                        <h3 className="text-3xl font-black text-slate-800 mb-4">{timeUpModal.title}</h3>
                        <p className="text-lg text-slate-500 font-bold mb-8 whitespace-pre-wrap">{timeUpModal.desc}</p>
                        <button onClick={finalizeAndGoToLogin} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-8 py-5 rounded-2xl text-xl shadow-sm">확인</button>
                    </div>
                </div>
            )}

            {endRequestConfirmOpen && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[80]">
                    <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-md text-center">
                        <div className="text-6xl mb-6">🚪</div>
                        <h3 className="text-2xl font-extrabold text-slate-800 mb-4">클리닉 종료 요청</h3>
                        <p className="text-base text-slate-600 mb-10">클리닉 종료를 요청하시겠습니까?<br/>조교가 승인해야 종료됩니다.</p>
                        <div className="flex gap-4">
                            <button onClick={() => setEndRequestConfirmOpen(false)} className="flex-1 bg-slate-100 text-slate-600 font-bold text-lg py-4 rounded-2xl hover:bg-slate-200 transition-colors">취소</button>
                            <button onClick={() => { endRequest.requestEnd(); setEndRequestConfirmOpen(false); }} className="flex-1 bg-rose-600 text-white font-bold text-lg py-4 rounded-2xl hover:bg-rose-700 transition-colors shadow-sm">요청하기</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}