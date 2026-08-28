// src/app/student/portal/page.tsx
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { resolveTodaySession, closeSessionAtLimit, setActiveCall, clearActiveCall, setAway, clearAway, checkAndBumpToggleCooldown } from '@/lib/clinicSession';
import { resolveClassWeekType } from '@/lib/classRound';
import { useClinicEndRequest } from '@/hooks/useClinicEndRequest';
import { useToggleCooldown, TOGGLE_COOLDOWN_MS } from '@/hooks/useToggleCooldown';
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
    const [selectedClass, setSelectedClass] = useState('');
    
    const [clinicSession, setClinicSession] = useState<any>(null);
    const [roundResults, setRoundResults] = useState<Record<string, any>>({});
    const [blockStates, setBlockStates] = useState<Record<string, any>>({});
    const [hwProgress, setHwProgress] = useState<Record<string, any>>({});
    const [classWeekTypes, setClassWeekTypes] = useState<Record<string, string>>({});
    
    const [now, setNow] = useState(Date.now());
    const [timeUpModal, setTimeUpModal] = useState({ isOpen: false, icon: '⏰', title: '클리닉 시간이 종료되었습니다', desc: '오늘 배정된 클리닉 시간이 모두 지났어요.' });
    const [endRequestConfirmOpen, setEndRequestConfirmOpen] = useState(false);

    const [mockPoints, setMockPoints] = useState(0);
    const [isPortalAway, setIsPortalAway] = useState(false);
    const [isPortalCalling, setIsPortalCalling] = useState(false);
    const callCooldown = useToggleCooldown(TOGGLE_COOLDOWN_MS);
    const awayCooldown = useToggleCooldown(TOGGLE_COOLDOWN_MS);
    const [manualSeat, setManualSeat] = useState<string | null>(null);
    const [editorLocked, setEditorLocked] = useState(false);
    const [recheckToast, setRecheckToast] = useState("");
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
            const kioskSeat = localStorage.getItem('logica_kiosk_seat') || undefined;
            const session = await resolveTodaySession(supabaseClient, sid, today, kioskSeat);

            clinicSessionRef.current = session;
            setClinicSession(session);
            setManualSeat(session.manual_seat || null);
            if (session.call_cooldown_until && new Date(session.call_cooldown_until).getTime() > Date.now()) {
                callCooldown.startUntil(new Date(session.call_cooldown_until).getTime());
            }
            if (session.away_cooldown_until && new Date(session.away_cooldown_until).getTime() > Date.now()) {
                awayCooldown.startUntil(new Date(session.away_cooldown_until).getTime());
            }

            const { data: rData } = await supabaseClient.from('clinic_round_result').select('*').eq('student_id', sid);
            const results: any = {};
            rData?.forEach((r: any) => results[`${r.class_name}::${r.round}`] = r);
            setRoundResults(results);

            await fetchBlockStates(sid, classes);
        };

        initData();
    }, [router]);

    useEffect(() => {
        if (!studentInfo.id) return;
        const refresh = () => {
            if (document.visibilityState === 'visible') fetchBlockStates(studentInfo.id, studentInfo.classes);
        };
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('focus', refresh);
        return () => {
            document.removeEventListener('visibilitychange', refresh);
            window.removeEventListener('focus', refresh);
        };
    }, [studentInfo.id, studentInfo.classes]);

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

    useEffect(() => {
        if (!studentInfo.id) return;
        let cancelled = false;
        const beat = async () => {
            const sid = clinicSessionRef.current?.id;
            if (!sid || cancelled) return;
            await supabaseClient.from('clinic_session_state').update({ last_seen_at: new Date().toISOString() }).eq('id', sid);
        };
        beat();
        const iv = setInterval(beat, 15000);
        return () => { cancelled = true; clearInterval(iv); };
    }, [studentInfo.id]);

    const fetchBlockStates = async (sid: string, classes: string[]) => {
        const today = getKSTDateString();
        const newBlockStates: any = {};
        const newHwProgress: any = {};
        classes.forEach(c => {
            newBlockStates[c] = { exam: 'NO_DATA', hw: 'NO_DATA', print: 'NO_DATA', overdue: 'NO_DATA' };
            newHwProgress[c] = { 
                activeExamMode: 'DONE',
                examIds: [], hwExamIds: [], printIds: [], hwIds: [], overdueHwIds: [], overdueExamIds: [],
                examTitle: '', hwTitle: '', printTitle: '', overdueTitle: '',
                examQCount: 0, hwQCount: 0, printQCount: 0, overdueQCount: 0
            };
        });

        const { data: cData } = await supabaseClient.from('class')
            .select('class_id, name, week_type, week_type_updated_date, session_parity, forced_week_type, forced_week_type_date, class_schedule(day_of_week)')
            .in('name', classes);
        const nameToId: any = {};
        cData?.forEach((c: any) => { nameToId[c.name] = c.class_id; });

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

        // 🌟 수정 1: 실제로 풀이 흔적(O, X, 세모 등)이 남은 문항을 DB에서 먼저 모두 가져옴
        const [{ data: hwAnsData }, { data: examAnsData }, { data: examsData }] = await Promise.all([
            supabaseClient.from('student_homework_answer')
                .select('homework_id, tq_id')
                .eq('student_id', sid)
                .in('grading_code', ['O', 'X', 'TO', 'RO', 'TX', 'T', '☆']),
            supabaseClient.from('student_answer')
                .select('exam_assignment_id, question_id')
                .eq('student_id', sid)
                .in('grading_code', ['O', 'X', 'TO', 'RO', 'TX', 'T', '☆']),
            supabaseClient.from('exam_assignment')
                .select('assignment_id, status, class_id, exam_master!inner(exam_type, title, total_questions)')
                .eq('student_id', sid)
        ]);

        const hwAttemptedMap = new Map<number, Set<number>>();
        hwAnsData?.forEach((a: any) => {
            if (!hwAttemptedMap.has(a.homework_id)) hwAttemptedMap.set(a.homework_id, new Set());
            hwAttemptedMap.get(a.homework_id)!.add(a.tq_id);
        });

        const examAttemptedMap = new Map<number, Set<number>>();
        examAnsData?.forEach((a: any) => {
            if (!examAttemptedMap.has(a.exam_assignment_id)) examAttemptedMap.set(a.exam_assignment_id, new Set());
            examAttemptedMap.get(a.exam_assignment_id)!.add(a.question_id);
        });

        const classIds = Object.values(nameToId).filter(Boolean);
        let hwsData: any[] = [];
        if (classIds.length > 0) {
            const { data } = await supabaseClient.from('homework_assignment')
                .select('homework_id, class_id, target_student_id, due_date, homework_title, target_questions')
                .in('class_id', classIds as string[])
                .neq('homework_title', '[시스템] 수업 진도 완료 기록');
            hwsData = data || [];
        }

        const { data: hwResData } = await supabaseClient.from('student_homework_result')
            .select('homework_id, status, completed_tq_ids')
            .eq('student_id', sid);
        const hwResMap = new Map();
        hwResData?.forEach((r: any) => hwResMap.set(r.homework_id, r));

        classes.forEach(c => {
            const cid = nameToId[c];
            if (!cid) return;

            let hwPending = 0, printPending = 0, overduePending = 0;
            let hwExamIds: number[] = [], printIds: number[] = [], hwIds: number[] = [], overdueHwIds: number[] = [], overdueExamIds: number[] = [];
            let hTitles: string[] = [], pTitles: string[] = [], oTitles: string[] = [];
            let hCount = 0, pCount = 0, oCount = 0;

            let regularExamPending = 0;
            let regularExamIds: number[] = [];
            let regularETitles: string[] = [];
            let regularECount = 0;

            let similarExamPending = 0;
            let similarExamIds: number[] = [];
            let similarETitles: string[] = [];
            let similarECount = 0;

            const isEvenWeek = newClassWeekTypes[c] === 'even';

            examsData?.forEach((ex: any) => {
                if (ex.class_id && ex.class_id !== cid) return;
                const type = Array.isArray(ex.exam_master) ? ex.exam_master[0]?.exam_type : ex.exam_master?.exam_type;
                const title = Array.isArray(ex.exam_master) ? ex.exam_master[0]?.title : ex.exam_master?.title;
                const tq = Array.isArray(ex.exam_master) ? ex.exam_master[0]?.total_questions : ex.exam_master?.total_questions;
                const isPending = !['제출완료', '채점완료', '완료'].includes(ex.status);

                // 🌟 수정 2: 전체 문항에서 "아예 손도 안 댄(미입력) 문제" 수만 추출
                const attempted = examAttemptedMap.get(ex.assignment_id)?.size || 0;
                const remain = Math.max(0, (tq || 0) - attempted);

                if (type === '오답프린트') {
                    if (isPending) { printPending++; printIds.push(ex.assignment_id); pTitles.push(title); pCount += remain; }
                } else if (type === '과제' || type === '과제프린트') {
                    if (isPending) { hwPending++; hwExamIds.push(ex.assignment_id); hTitles.push(title); hCount += remain; }
                } else if (type === '오답유사' || type === '과제오답유사') {
                    if (isPending) { similarExamPending++; similarExamIds.push(ex.assignment_id); similarETitles.push(title); similarECount += remain; }
                } else if (type === '미완료과제') {
                    if (isPending) { overduePending++; overdueExamIds.push(ex.assignment_id); oTitles.push(title); oCount += remain; }
                } else { 
                    if (isPending) { regularExamPending++; regularExamIds.push(ex.assignment_id); regularETitles.push(title); regularECount += remain; }
                }
            });

            const hasSimilar = similarExamPending > 0;
            const hasRegular = regularExamPending > 0;

            let activeExamMode = 'DONE';
            let finalExamPending = 0;
            let finalExamIds: number[] = [];
            let finalETitles: string[] = [];
            let finalECount = 0;

            if (isEvenWeek) {
                if (hasSimilar) {
                    activeExamMode = 'SIMILAR'; finalExamPending = similarExamPending; finalExamIds = similarExamIds; finalETitles = similarETitles; finalECount = similarECount;
                } else if (hasRegular) {
                    activeExamMode = 'TEST'; finalExamPending = regularExamPending; finalExamIds = regularExamIds; finalETitles = regularETitles; finalECount = regularECount;
                }
            } else {
                if (hasRegular) {
                    activeExamMode = 'TEST'; finalExamPending = regularExamPending; finalExamIds = regularExamIds; finalETitles = regularETitles; finalECount = regularECount;
                } else if (hasSimilar) {
                    activeExamMode = 'SIMILAR'; finalExamPending = similarExamPending; finalExamIds = similarExamIds; finalETitles = similarETitles; finalECount = similarECount;
                }
            }

            hwsData?.forEach((hw: any) => {
                if (hw.class_id !== cid) return;
                if (hw.target_student_id && hw.target_student_id !== sid) return;
                
                const resObj = hwResMap.get(hw.homework_id);
                const status = resObj?.status || '미제출';
                const isPending = !['제출완료', '채점완료', '완료'].includes(status);
                if (!isPending) return;
                
                let tqLen = 0;
                try { tqLen = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions).length : (hw.target_questions?.length || 0); } catch(e){}

                // 🌟 수정 3: 과제에서도 동일하게 시도한 문제(O, X 등)를 뺀 순수 미입력 문제 계산
                const attempted = hwAttemptedMap.get(hw.homework_id)?.size || 0;
                const remain = Math.max(0, tqLen - attempted);
                
                if (remain === 0) return;

                if (hw.due_date && hw.due_date <= today) { 
                    overduePending++; overdueHwIds.push(hw.homework_id); oTitles.push(hw.homework_title); oCount += remain; 
                } else { 
                    hwPending++; hwIds.push(hw.homework_id); hTitles.push(hw.homework_title); hCount += remain; 
                }
            });

            newBlockStates[c].exam = finalExamPending > 0 ? '미응시' : '제출완료';
            newBlockStates[c].hw = hwPending > 0 ? '미응시' : '제출완료';
            newBlockStates[c].print = printPending > 0 ? '미응시' : '제출완료';
            newBlockStates[c].overdue = overduePending > 0 ? '미응시' : '제출완료';

            if (roundResults[`${c}::1`]) newBlockStates[c].exam = '제출완료';
            if (roundResults[`${c}::2`]) newBlockStates[c].hw = '제출완료';
            if (roundResults[`${c}::3`]) newBlockStates[c].print = '제출완료';

            const getShortTitle = (titles: string[]) => {
                const unique = [...new Set(titles)].filter(Boolean);
                if (unique.length === 0) return '';
                if (unique.length === 1) return unique[0];
                return `${unique[0]} 외 ${unique.length - 1}건`;
            };

            newHwProgress[c] = { 
                activeExamMode,
                examIds: finalExamIds, hwExamIds, printIds, hwIds, overdueHwIds, overdueExamIds,
                examTitle: getShortTitle(finalETitles), hwTitle: getShortTitle(hTitles), printTitle: getShortTitle(pTitles), overdueTitle: getShortTitle(oTitles),
                examQCount: finalECount, hwQCount: hCount, printQCount: pCount, overdueQCount: oCount
            };
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
            const myTenantId = localStorage.getItem('logica_tenant_id') || 'hq';
            const channel = supabaseClient.channel(`${CLINIC_ROOM}_${myTenantId}`);
            channelRef.current = channel;

            const allSeats = (await getActiveSeatLayout(myTenantId)).seats.map(s => String(s.number));

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
                else if (payload.action === 'relocated_away') {
                    if (channelRef.current) channelRef.current.untrack();
                    localStorage.removeItem('logica_student_id');
                    localStorage.removeItem('logica_student_name');
                    localStorage.removeItem('logica_student_phone');
                    router.push('/student/login');
                }
                else if (payload.action === 'resolve_recheck') {
                    setRecheckToast(payload.verdict === 'correct' ? '🎉 조교가 정답으로 확인했어요! (자세한 내용은 클리닉에서 확인해주세요)' : '조교 확인 결과 오답이 맞습니다.');
                    setTimeout(() => setRecheckToast(""), 4000);
                }
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

        const allPendingHwIds: number[] = [];
        Object.values(hwProgress).forEach((prog: any) => {
            if (prog.hwIds && prog.hwIds.length > 0) {
                allPendingHwIds.push(...prog.hwIds);
            }
        });
        
        if (allPendingHwIds.length > 0) {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            await supabaseClient.from('homework_assignment')
                .update({ due_date: yesterday })
                .in('homework_id', allPendingHwIds);
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

    const togglePortalAway = async () => {
        if (awayCooldown.isActive) return;
        if (isPortalCalling) { alert('조교 호출 중에는 자리비움 상태로 전환할 수 없습니다.'); return; }
        const sid = clinicSessionRef.current?.id;
        if (sid) {
            const cooldown = await checkAndBumpToggleCooldown(supabaseClient, sid, 'away');
            awayCooldown.startUntil(new Date(cooldown.cooldownUntil).getTime());
            if (!cooldown.ok) return;
        } else {
            awayCooldown.start();
        }
        const next = !isPortalAway;
        setIsPortalAway(next);
        sendClinicAction(next ? 'away' : 'cancel_away');
        if (sid) (next ? setAway : clearAway)(supabaseClient, sid);
    };

    const togglePortalCall = async () => {
        if (callCooldown.isActive) return;
        if (isPortalAway) { alert('자리비움 중에는 조교를 호출할 수 없습니다.'); return; }
        const sid = clinicSessionRef.current?.id;
        if (sid) {
            const cooldown = await checkAndBumpToggleCooldown(supabaseClient, sid, 'call');
            callCooldown.startUntil(new Date(cooldown.cooldownUntil).getTime());
            if (!cooldown.ok) return;
        } else {
            callCooldown.start();
        }
        const next = !isPortalCalling;
        setIsPortalCalling(next);
        sendClinicAction(next ? 'call' : 'cancel_call', { qNum: 'general' });
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

        if (typeKey !== 'exam' && blockStates[className]?.exam === '미응시') {
            alert('오늘의 첫 번째 학습(테스트/과제오답유사)을 먼저 완료해야 다음 클리닉을 진행할 수 있습니다.');
            return;
        }

        const params = new URLSearchParams({ round: String(round), class: className });
        const prog = hwProgress[className] || {};

        let testName = '';
        if (typeKey === 'exam') {
            testName = '시험';
            params.append('week', prog.activeExamMode === 'SIMILAR' ? 'even' : 'odd');
            if (prog.examIds && prog.examIds.length > 0) params.append('assignment_id', prog.examIds[0]);
        } else if (typeKey === 'hw') {
            testName = '과제';
            if (prog.hwIds && prog.hwIds.length > 0) params.append('homework_ids', prog.hwIds.join(','));
            if (prog.hwExamIds && prog.hwExamIds.length > 0) params.append('assignment_id', prog.hwExamIds[0]);
        } else if (typeKey === 'overdue') {
            testName = '미완료 과제';
            if (prog.overdueHwIds && prog.overdueHwIds.length > 0) params.append('homework_ids', prog.overdueHwIds.join(','));
            if (prog.overdueExamIds && prog.overdueExamIds.length > 0) params.append('assignment_id', prog.overdueExamIds[0]);
        } else if (typeKey === 'print') {
            testName = '오답프린트';
            if (prog.printIds && prog.printIds.length > 0) params.append('assignment_id', prog.printIds[0]);
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
        
        const isExamDone = cState.exam === '제출완료' || cState.exam === '채점완료'; 
        const isLocked = typeKey !== 'exam' && !isDone && !isExamDone; 

        const prog = hwProgress[className] || {};
        const activeExamMode = prog.activeExamMode || 'TEST';

        let qCount = 0;
        let titleName = '';
        if (typeKey === 'exam') { qCount = prog.examQCount; titleName = prog.examTitle; }
        else if (typeKey === 'hw') { qCount = prog.hwQCount; titleName = prog.hwTitle; }
        else if (typeKey === 'print') { qCount = prog.printQCount; titleName = prog.printTitle; }

        const scoreData = roundResults[`${className}::${round}`];
        const scoreLabel = scoreData?.forced_done ? '완료' : (scoreData?.correct != null ? `${scoreData.correct}/${scoreData.total}` : '완료');

        let theme;
        if (typeKey === 'exam') {
            if (activeExamMode === 'SIMILAR') {
                theme = { label: '🔁 과제오답유사', desc: '과제에서 틀렸던 문제와 비슷한 문제를 다시 풀어봅니다.', bg: 'bg-gradient-to-br from-violet-700 to-violet-600', badge: 'bg-violet-400 text-violet-900', btnText: 'text-violet-900', textColor: 'text-violet-100', accent: 'text-violet-200' };
            } else {
                theme = { label: '📝 주간테스트', desc: '이번 주 주간테스트를 응시합니다.', bg: 'bg-gradient-to-br from-[#002864] to-blue-800', badge: 'bg-blue-500 text-white', btnText: 'text-[#002864]', textColor: 'text-blue-200', accent: 'text-blue-300' };
            }
        }
        else if (typeKey === 'hw') theme = { label: '📚 과제', desc: '미제출 과제 문항을 학습합니다.', bg: 'bg-gradient-to-br from-amber-600 to-amber-500', badge: 'bg-amber-400 text-amber-900', btnText: 'text-amber-900', textColor: 'text-amber-100', accent: 'text-amber-200' };
        else theme = { label: '🖨️ 오답', desc: '틀린 문제들만 모아 다시 풉니다.', bg: 'bg-gradient-to-br from-emerald-700 to-emerald-600', badge: 'bg-emerald-400 text-emerald-900', btnText: 'text-emerald-900', textColor: 'text-emerald-100', accent: 'text-emerald-200' };

        return (
            <div key={`${className}-${typeKey}`} className={`w-full ${theme.bg} rounded-[1.5rem] p-6 md:p-8 text-white shadow-xl relative overflow-hidden group flex flex-col min-h-[220px] md:min-h-[240px] justify-between transition-all duration-300 ${isLocked ? 'grayscale-[60%] opacity-80' : ''}`}>
                {isLocked && <div className="absolute inset-0 bg-slate-900/10 z-0"></div>}
                
                {isDone && <span className={`absolute top-5 right-5 bg-white/90 ${theme.btnText} text-xs md:text-sm font-black px-3 py-1.5 rounded-full shadow-md z-20 border border-slate-100`}>✅ {scoreLabel}</span>}
                
                <div className="relative z-10">
                    <div className="flex justify-between items-start mb-3">
                        <span className={`text-xs md:text-sm font-black ${isLocked ? 'bg-white/30 text-white shadow-sm' : theme.badge} px-3 py-1.5 rounded-lg shadow-sm flex items-center`}>
                            {isLocked ? '🔒 잠김' : theme.label}
                        </span>
                        {!isDone && qCount > 0 && <span className={`text-xs md:text-sm font-bold ${isLocked ? 'text-white/70 bg-black/20' : theme.textColor + ' bg-black/10'} px-2.5 py-1 rounded-md`}>남은 문제: {qCount}</span>}
                    </div>
                    <h3 className={`text-xl md:text-2xl font-black mb-1 leading-tight ${isLocked ? 'text-white/90' : ''}`}>
                        {theme.label.replace(/[^가-힣 ]/g, '').trim()} 클리닉
                    </h3>
                    {!isDone && titleName && <p className={`text-[11px] md:text-xs font-bold ${isLocked ? 'text-white/70' : theme.accent} mb-1.5 truncate`} title={titleName}>{titleName}</p>}
                    <p className={`text-sm font-medium mt-1 line-clamp-2 leading-snug ${isLocked ? 'text-white/70' : theme.textColor}`}>
                        {isLocked ? '첫 번째 학습을 먼저 완료해주세요.' : theme.desc}
                    </p>
                </div>
                
                <div className="flex items-center justify-end relative z-10 mt-3 md:mt-4">
                    {isDone ? 
                        <button disabled className={`bg-white/70 ${theme.btnText} font-black px-6 py-2.5 md:py-3 text-sm md:text-base rounded-xl shadow-sm opacity-90 cursor-not-allowed`}>완료됨</button> 
                    : isLocked ?
                        <button disabled className="bg-black/20 text-white/80 font-black px-6 py-2.5 md:py-3 text-sm md:text-base rounded-xl shadow-sm cursor-not-allowed flex items-center gap-2">
                            <span>🔒</span> 잠김
                        </button>
                    : 
                        <button onClick={() => startClinicBlock(className, round, typeKey)} className={`bg-white ${theme.btnText} font-black px-6 py-2.5 md:py-3 text-sm md:text-base rounded-xl shadow-lg hover:scale-105 hover:bg-slate-50 transition-all`}>응시하기</button>
                    }
                </div>
            </div>
        );
    };

    const renderOverdueCard = (className: string) => {
        const cState = blockStates[className] || {};
        const isDone = cState.overdue !== '미응시';
        
        const isExamDone = cState.exam === '제출완료' || cState.exam === '채점완료';
        const isLocked = !isDone && !isExamDone;

        const prog = hwProgress[className] || {};
        const qCount = prog.overdueQCount || 0;
        const titleName = prog.overdueTitle || '';

        const theme = {
            label: '⏰ 미완료 과제',
            desc: '다음 수업 전까지 끝내지 못해 밀린 과제입니다.',
            bg: 'bg-gradient-to-br from-rose-700 to-rose-600',
            badge: 'bg-rose-400 text-rose-900',
            btnText: 'text-rose-900',
            textColor: 'text-rose-100',
            accent: 'text-rose-300'
        };

        return (
            <div key={`${className}-overdue`} className={`w-full ${theme.bg} rounded-[1.5rem] p-6 md:p-8 text-white shadow-xl relative overflow-hidden group flex flex-col min-h-[220px] md:min-h-[240px] justify-between transition-all duration-300 ${isLocked ? 'grayscale-[60%] opacity-80' : ''}`}>
                {isLocked && <div className="absolute inset-0 bg-slate-900/10 z-0"></div>}
                
                {isDone && <span className={`absolute top-5 right-5 bg-white/90 ${theme.btnText} text-xs md:text-sm font-black px-3 py-1.5 rounded-full shadow-md z-20 border border-slate-100`}>✅ 밀린 과제 없음</span>}
                
                <div className="relative z-10">
                    <div className="flex justify-between items-start mb-3">
                        <span className={`text-xs md:text-sm font-black ${isLocked ? 'bg-white/30 text-white shadow-sm' : theme.badge} px-3 py-1.5 rounded-lg shadow-sm flex items-center`}>
                            {isLocked ? '🔒 잠김' : theme.label}
                        </span>
                        {!isDone && qCount > 0 && <span className={`text-xs md:text-sm font-bold ${isLocked ? 'text-white/70 bg-black/20' : theme.textColor + ' bg-black/10'} px-2.5 py-1 rounded-md`}>남은 문제: {qCount}</span>}
                    </div>
                    <h3 className={`text-xl md:text-2xl font-black mb-1 leading-tight ${isLocked ? 'text-white/90' : ''}`}>미완료 과제 클리닉</h3>
                    {!isDone && titleName && <p className={`text-[11px] md:text-xs font-bold ${isLocked ? 'text-white/70' : theme.accent} mb-1.5 truncate`} title={titleName}>{titleName}</p>}
                    <p className={`text-sm font-medium mt-1 line-clamp-2 leading-snug ${isLocked ? 'text-white/70' : theme.textColor}`}>
                        {isLocked ? '첫 번째 학습을 먼저 완료해주세요.' : theme.desc}
                    </p>
                </div>
                
                <div className="flex items-center justify-end relative z-10 mt-3 md:mt-4">
                    {isDone ?
                        <button disabled className={`bg-white/70 ${theme.btnText} font-black px-6 py-2.5 md:py-3 text-sm md:text-base rounded-xl shadow-sm opacity-90 cursor-not-allowed`}>밀린 과제 없음</button>
                    : isLocked ?
                        <button disabled className="bg-black/20 text-white/80 font-black px-6 py-2.5 md:py-3 text-sm md:text-base rounded-xl shadow-sm cursor-not-allowed flex items-center gap-2">
                            <span>🔒</span> 잠김
                        </button>
                    :
                        <button onClick={() => startClinicBlock(className, 2, 'overdue')} className={`bg-white ${theme.btnText} font-black px-6 py-2.5 md:py-3 text-sm md:text-base rounded-xl shadow-lg hover:scale-105 hover:bg-slate-50 transition-all`}>학습하기</button>
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

            <nav className="bg-white px-6 md:px-8 py-2.5 md:py-3 flex justify-between items-center border-b border-slate-200 sticky top-0 z-30 shadow-sm">
                <div className="flex items-center gap-6">
                    <div className="flex items-center">
                        <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-8 object-contain" />
                        <span className="ml-2 text-blue-500 font-bold text-sm">Student</span>
                    </div>
                </div>
                <div className="flex items-center gap-3 md:gap-4">
                    {isSameDay && (
                        <div className={`flex items-center gap-1.5 border rounded-full px-3 py-1.5 shadow-sm transition-colors ${isUrgent ? 'bg-rose-100 border-rose-300 animate-pulse' : 'bg-indigo-50 border-indigo-200'}`}>
                            <span className="text-indigo-500 text-sm">🕐</span>
                            <span className="text-sm font-black font-lexend text-indigo-600">{isMounted && remainingMs <= 0 ? '종료' : `${m}:${String(s).padStart(2, '0')}`}</span>
                        </div>
                    )}
                    {isSameDay && (
                        <button onClick={togglePortalAway} disabled={isPortalCalling || awayCooldown.isActive} className={`text-xs font-bold rounded-full px-3.5 py-1.5 border shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isPortalAway ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                            {awayCooldown.isActive ? `⏳ ${Math.ceil(awayCooldown.remainingMs / 1000)}초` : isPortalAway ? '↩️ 자리 복귀' : '🚶 자리비움'}
                        </button>
                    )}
                    {isSameDay && (
                        <button onClick={togglePortalCall} disabled={isPortalAway || callCooldown.isActive} className={`text-xs font-bold rounded-full px-3.5 py-1.5 border shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isPortalCalling ? 'bg-rose-600 border-rose-600 text-white animate-pulse' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                            {callCooldown.isActive ? `⏳ ${Math.ceil(callCooldown.remainingMs / 1000)}초` : isPortalCalling ? '🚨 호출 취소' : '🙋 조교 호출'}
                        </button>
                    )}

                    <button onClick={toggleFullScreen} className="flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-full px-3 py-1.5 cursor-pointer hover:bg-slate-200 transition-colors shadow-sm hidden sm:flex">
                        <span className="text-xs font-bold text-slate-600">{isFullscreen ? '🗗 기본화면' : '📺 전체화면'}</span>
                    </button>

                    <button onClick={() => router.push('/student/shop')} className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5 cursor-pointer hover:bg-amber-100 transition-colors shadow-sm">
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

            <main className="max-w-[1280px] w-full mx-auto py-6 px-6 md:py-8 md:px-8 flex-1">
                {studentInfo.classes.length > 0 && studentInfo.classes[0] !== '반 미배정' && (
                    <section className="mb-4">
                        <div className="flex items-center gap-4 mb-6">
                            <h2 className="text-2xl md:text-3xl font-black text-slate-800 flex items-center gap-3">🚀 오늘의 학습 클리닉</h2>
                            {studentInfo.classes.length > 1 && studentInfo.classes.map((cls) => (
                                <button key={cls} onClick={() => setSelectedClass(cls)} className={`text-sm md:text-base font-black px-5 py-2 rounded-full shadow-sm transition-colors inline-flex items-center gap-1.5 ${selectedClass === cls ? 'bg-[#002864] text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                    <span>🏫</span>{cls}
                                </button>
                            ))}
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 md:gap-6">
                            {renderCard('exam', 1, selectedClass)}
                            {renderCard('hw', 2, selectedClass)}
                            {renderOverdueCard(selectedClass)}
                            {renderCard('print', 3, selectedClass)}
                        </div>
                    </section>
                )}
            </main>

            {recheckToast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-lg z-[80]">
                    {recheckToast}
                </div>
            )}

            {timeUpModal.isOpen && (
                <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[80]">
                    <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-sm text-center">
                        <div className="text-7xl mb-4">{timeUpModal.icon}</div>
                        <h3 className="text-2xl font-black text-slate-800 mb-3">{timeUpModal.title}</h3>
                        <p className="text-base text-slate-500 font-bold mb-6 whitespace-pre-wrap">{timeUpModal.desc}</p>
                        <button onClick={finalizeAndGoToLogin} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm">확인</button>
                    </div>
                </div>
            )}

            {endRequestConfirmOpen && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[80]">
                    <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm text-center">
                        <div className="text-5xl mb-4">🚪</div>
                        <h3 className="text-xl font-extrabold text-slate-800 mb-4">클리닉 종료 요청</h3>
                        <p className="text-sm text-slate-600 mb-8">클리닉 종료를 요청하시겠습니까?<br/>조교가 승인해야 종료됩니다.</p>
                        <div className="flex gap-4">
                            <button onClick={() => setEndRequestConfirmOpen(false)} className="flex-1 bg-slate-100 text-slate-600 font-bold text-base py-3 rounded-xl hover:bg-slate-200 transition-colors">취소</button>
                            <button onClick={() => { endRequest.requestEnd(); setEndRequestConfirmOpen(false); }} className="flex-1 bg-rose-600 text-white font-bold text-base py-3 rounded-xl hover:bg-rose-700 transition-colors shadow-sm">요청하기</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}