"use client";

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { resolveTodaySession, closeSessionAtLimit, setActiveCall, clearActiveCall, setAway, clearAway } from '@/lib/clinicSession';
import { useClinicEndRequest } from '@/hooks/useClinicEndRequest';
import { getPointBalance } from '@/lib/mockShop';
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

const CLINIC_TYPE_THEME: any = {
    weekly_test: { label: '주간테스트', desc: '이번 주 배운 내용을 점검하는 클리닉입니다.', dark: { card: 'bg-gradient-to-br from-emerald-900 to-emerald-700 text-white', badge: 'bg-emerald-500 text-white', sub: 'text-emerald-200/70', ctaText: 'text-emerald-900' }, light: { card: 'bg-emerald-50 border border-emerald-200 text-emerald-900', badge: 'bg-emerald-200 text-emerald-800', sub: 'text-emerald-700/60' } },
    similar_hw: { label: '과제 오답 유사', desc: '직전 주 과제에서 틀린 문제와 유사한 문제로 구성됩니다.', dark: { card: 'bg-gradient-to-br from-violet-900 to-violet-700 text-white', badge: 'bg-violet-500 text-white', sub: 'text-violet-200/70', ctaText: 'text-violet-900' }, light: { card: 'bg-violet-50 border border-violet-200 text-violet-900', badge: 'bg-violet-200 text-violet-800', sub: 'text-violet-700/60' } }
};

const BLOCK_TO_ROUND: Record<string, number> = { block1: 1, block2: 2, block3: 3, block4: 4 };
const getKSTDateString = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

export default function StudentPortal() {
    const router = useRouter();

    const [studentInfo, setStudentInfo] = useState({ id: '', name: '', phone: '', classes: [] as string[] });
    const [activeTab, setActiveTab] = useState('home');
    const [weekTypes, setWeekTypes] = useState<Record<string, string>>({});
    
    const [clinicSession, setClinicSession] = useState<any>(null);
    const [roundResults, setRoundResults] = useState<Record<string, any>>({});
    const [blockStates, setBlockStates] = useState<Record<string, any>>({});
    const [hwProgress, setHwProgress] = useState<Record<string, any>>({});
    
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
    // 💡 조교 Pad/수퍼바이저에서 겪은 것과 같은 클래스의 버그(비동기 setInterval 콜백이 겹쳐 실행)를
    // 막기 위한 가드. 아래 dbSyncInterval에서 쓰인다.
    const isSyncingSessionRef = useRef(false);

    const carouselRef = useRef<HTMLDivElement>(null);
    const isDraggingRef = useRef(false);
    const startXRef = useRef(0);
    const scrollLeftRef = useRef(0);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => { setIsMounted(true); }, []);

    // 1초 타이머
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    // 초기 데이터 로드
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
            setMockPoints(getPointBalance(sid));

            const wTypes: any = {};
            classes.forEach(c => wTypes[c] = localStorage.getItem(`logica_demo_week_type_${c}`) || 'odd');
            setWeekTypes(wTypes);

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

    // ✨ DB 동기화: 5초마다 DB에서 현재 시간 및 좌석 상태 긁어와서 동기화
    // 💡 [버그 수정] 조교 Pad/수퍼바이저에서 겪은 것과 동일한 문제 — setInterval(asyncFn, 5000)은
    // 두 실행이 겹치면 나중에 시작한 게 먼저 끝나 최신 상태를 옛 스냅샷으로 덮어쓸 수 있다.
    // in-flight 가드 + 완료 시점에 다음 실행을 직접 예약하는 setTimeout 체인으로 바꾼다.
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

                // DB에서 시간 연장이 확인되었는데 이미 종료된 상태라면 해제
                // 단, ended_at이 찍혀 있으면(강제 퇴실/승인된 종료요청 등으로 이미 확정 종료된 것) 남은 시간이
                // 양수로 계산되더라도 절대 되살리면 안 된다 — 안 그러면 강제 퇴실 직후 5초 폴링이 곧바로 되돌려버린다.
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
                } catch (err) {
                    console.error('세션 동기화 중 오류:', err);
                } finally {
                    isSyncingSessionRef.current = false;
                    scheduleNext();
                }
            }, 5000);
        };
        scheduleNext();

        return () => { cancelled = true; if (timer) clearTimeout(timer); };
    }, [studentInfo.id, isMounted, manualSeat]);

    const fetchBlockStates = async (sid: string, classes: string[]) => {
        const newBlockStates: any = {};
        const newHwProgress: any = {};
        classes.forEach(c => {
            newBlockStates[c] = { weekly_test: 'NO_DATA', similar_hw: 'NO_DATA', assignment: 'NO_DATA', incomplete_assignment: 'NO_DATA' };
            newHwProgress[c] = { totalQuestions: 0, completedQuestions: 0, hwIds: [], incTotalQuestions: 0, incCompletedQuestions: 0, incHwIds: [] };
        });

        const { data: cData } = await supabaseClient.from('class').select('class_id, name').in('name', classes);
        const nameToId: any = {};
        cData?.forEach((c: any) => nameToId[c.name] = c.class_id);

        const { data: examsData } = await supabaseClient.from('exam_assignment').select('status, exam_master!inner(exam_type)').eq('student_id', sid).in('exam_master.exam_type', ['주간테스트', '과제오답유사']).order('created_at', { ascending: false });
        const exams: any[] = examsData || []; 
        
        if (exams.length > 0) {
            const wt = exams.find((e: any) => e.exam_master?.exam_type === '주간테스트' || e.exam_master?.[0]?.exam_type === '주간테스트');
            const hw = exams.find((e: any) => e.exam_master?.exam_type === '과제오답유사' || e.exam_master?.[0]?.exam_type === '과제오답유사');
            classes.forEach(c => {
                if (wt) newBlockStates[c].weekly_test = wt.status || '미응시';
                if (hw) newBlockStates[c].similar_hw = hw.status || '미응시';
            });
        }

        const { data: hwsData } = await supabaseClient.from('student_homework_result').select('status, completed_tq_ids, homework_assignment!inner(homework_id, class_id, due_date, target_questions)').eq('student_id', sid);
        const hws: any[] = hwsData || []; 
        
        if (hws.length > 0) {
            const nTime = new Date();
            classes.forEach(c => {
                const cid = nameToId[c];
                if (!cid) return;
                const getHwMeta = (h: any) => Array.isArray(h.homework_assignment) ? h.homework_assignment[0] : h.homework_assignment;

                const myHws = hws.filter((h: any) => getHwMeta(h)?.class_id === cid);
                const pendingNew = myHws.filter((h: any) => h.status !== '제출완료' && h.status !== '채점완료' && new Date(getHwMeta(h)?.due_date) >= nTime);
                const pendingOld = myHws.filter((h: any) => h.status !== '제출완료' && h.status !== '채점완료' && new Date(getHwMeta(h)?.due_date) < nTime);

                if (myHws.length > 0) {
                    newBlockStates[c].assignment = pendingNew.length > 0 ? '미응시' : '제출완료';
                    newBlockStates[c].incomplete_assignment = pendingOld.length > 0 ? '미응시' : (myHws.some((h: any) => new Date(getHwMeta(h)?.due_date) < nTime) ? '제출완료' : 'NO_DATA');
                }

                let tQ = 0, cQ = 0, aIds: number[] = [], iTQ = 0, iCQ = 0, iIds: number[] = [];
                const parseJsonSafe = (str: any) => { try { return JSON.parse(str); } catch { return []; } };
                
                pendingNew.forEach((h: any) => {
                    const meta = getHwMeta(h);
                    const tqs = typeof meta?.target_questions === 'string' ? parseJsonSafe(meta.target_questions) : meta?.target_questions;
                    const cqs = typeof h.completed_tq_ids === 'string' ? parseJsonSafe(h.completed_tq_ids) : h.completed_tq_ids;
                    if (Array.isArray(tqs)) tQ += tqs.length;
                    if (Array.isArray(cqs)) cQ += cqs.length;
                    aIds.push(meta?.homework_id);
                });
                
                pendingOld.forEach((h: any) => {
                    const meta = getHwMeta(h);
                    const tqs = typeof meta?.target_questions === 'string' ? parseJsonSafe(meta.target_questions) : meta?.target_questions;
                    const cqs = typeof h.completed_tq_ids === 'string' ? parseJsonSafe(h.completed_tq_ids) : h.completed_tq_ids;
                    if (Array.isArray(tqs)) iTQ += tqs.length;
                    if (Array.isArray(cqs)) iCQ += cqs.length;
                    iIds.push(meta?.homework_id);
                });

                newHwProgress[c] = { totalQuestions: tQ, completedQuestions: cQ, hwIds: aIds, incTotalQuestions: iTQ, incCompletedQuestions: iCQ, incHwIds: iIds };
            });
        }

        setBlockStates(newBlockStates);
        setHwProgress(newHwProgress);
    };

    useEffect(() => {
        if (!studentInfo.id || !clinicSessionRef.current) return;

        const connectPresence = async () => {
            // 💡 이 effect는 manualSeat가 바뀔 때(테스트용 좌석 셀렉터 등) 또는 오늘 세션이 새로
            // 로드/갱신될 때(clinicSession?.id) 재실행된다. clinicSessionRef는 ref라서 값이 바뀌어도
            // 이 effect를 다시 실행시키지 못하므로, 반드시 clinicSession(state)을 deps에 넣어야
            // "세션 로딩이 끝나기 전에 effect가 먼저 실행돼서 그대로 멈춰버리는" 문제가 생기지 않는다.
            // unsubscribe()만 하고 바로 재구독하면, supabase-js가 아직 클라이언트 채널 목록에서
            // 안 지워진 옛 채널 객체를 그대로 재사용해 .on() 추가 시 에러가 날 수 있다.
            // removeChannel이 완전히 끝나길 기다린 뒤에 새 채널을 만든다.
            if (channelRef.current) {
                await supabaseClient.removeChannel(channelRef.current);
                channelRef.current = null;
            }
            const channel = supabaseClient.channel(CLINIC_ROOM);
            channelRef.current = channel;

            // 좌석 배치 에디터가 저장한 현재 활성 좌석 목록. presence sync는 자주 발생하므로
            // connectPresence가 재실행될 때(세션/manualSeat 변경 시) 한 번만 불러와 재사용한다.
            const allSeats = (await getActiveSeatLayout()).seats.map(s => String(s.number));

            channel.on('presence', { event: 'sync' }, async () => {
                const state = channel.presenceState();
                setEditorLocked(Object.values(state).some((metas: any) => metas.some((m: any) => m.role === 'editor')));

                const amIOnline = Object.values(state).flat().some((m: any) => m.studentId === studentInfo.id);
                if (amIOnline) return;

                const occupied = new Set();
                Object.values(state).forEach((metas: any) => metas.forEach((m: any) => { if (m.seat) occupied.add(m.seat); }));

                const todayStr = getKSTDateString();
                // 💡 [버그 수정] ended_at 필터가 없으면 이미 종료된 옛 세션의 seat까지 "점유 중"으로
                // 잘못 집계돼, 실제로는 빈 좌석인데 새 학생 배정 시 계속 건너뛰게 되는 문제가 있었다.
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

                // 1. 좌석 이동 양방향 동기화
                if (payload.action === 'move_seat' && payload.newSeat) {
                    if (manualSeat) {
                        setTestSeat(payload.newSeat); // 테스트 좌석 모드일 때
                    } else {
                        clinicSessionRef.current = { ...clinicSessionRef.current, seat: payload.newSeat };
                        setClinicSession(clinicSessionRef.current);
                    }
                    trackedSeatRef.current = payload.newSeat;
                    channel.track({ 
                        seat: payload.newSeat, name: studentInfo.name, studentId: studentInfo.id, classes: studentInfo.classes,
                        startedAt: new Date(clinicSessionRef.current.started_at).getTime(), durationMs: clinicSessionRef.current.duration_ms, updatedAt: Date.now() 
                    });
                } 
                // 2. 강제 퇴실 캐치
                // 💡 manualSeat(수퍼바이저가 드래그로 지정한 좌석)가 있어도 강제 퇴실은 그대로 적용돼야 한다.
                // manual_seat는 실제 학생 좌석 배정에도 쓰이는 값이라, 이걸로 강제 퇴실을 걸러내면 수동 배정된
                // 학생은 강제 퇴실이 전혀 먹히지 않는 문제가 있었다.
                else if (payload.action === 'force_checkout' || payload.action === 'force_checkout_by_ta') {
                    if (sessionEndedRef.current) return;
                    sessionEndedRef.current = true;
                    
                    if (payload.action === 'force_checkout_by_ta') {
                        setTimeUpModal({ isOpen: true, icon: '🚪', title: '조교에 의해 강제 퇴실 처리되었습니다', desc: '조교가 클리닉 이용을 종료했어요.' });
                    } else {
                        setTimeUpModal({ isOpen: true, icon: '✅', title: '퇴실이 승인되었습니다', desc: '수고하셨습니다!' });
                    }
                }
                // 3. 클리닉 종료 요청에 대한 수퍼바이저 응답
                else if (payload.action === 'end_clinic_resolved' && payload.studentId === studentInfo.id) {
                    endRequestRef.current?.handleResolved({ approved: payload.approved, cooldownUntil: payload.cooldownUntil });
                }
                // 4. ✨ 시간 조정 실시간 완벽 반영 (테스트모드 무관하게 무조건 동기화) ✨
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
                // 5. 수퍼바이저/조교가 자리비움·호출을 해제하면 포탈 쪽 상태도 함께 초기화한다.
                else if (payload.action === 'force_return_to_seat') {
                    setIsPortalAway(false);
                } else if (payload.action === 'force_cancel_call') {
                    setIsPortalCalling(false);
                }
            }).subscribe();
        };

        connectPresence();
        return () => { if (channelRef.current) supabaseClient.removeChannel(channelRef.current); };
    }, [studentInfo.id, manualSeat, clinicSession?.id]);

    // 승인된 종료 요청 / 자연 시간종료 시 최종적으로 로그인 화면으로 돌려보낸다.
    // (clinic_session_state.ended_at은 이 시점 이전에 이미 승인 처리나 closeSessionAtLimit으로 확정되어 있다.)
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

    // 💡 포탈에서도 자리비움/호출을 걸 수 있게 한다 — 클리닉 문제풀이 화면과 같은 broadcast를 쓰되,
    // 호출은 특정 문항이 아니라 일반 호출이라 qNum 대신 'general'을 쓴다(수퍼바이저 로그 문구도 다르게 처리됨).
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
        supabaseClient,
        sendAction: sendClinicAction,
        sessionId: clinicSession?.id,
        endRequestStatus: clinicSession?.end_request_status,
        endRequestCooldownUntil: clinicSession?.end_request_cooldown_until,
        onApproved: finalizeAndGoToLogin,
    });
    const endRequestRef = useRef(endRequest);
    useEffect(() => { endRequestRef.current = endRequest; });

    const startClinicBlock = async (className: string, blockKey: string, round: number, typeKey: string) => {
        // 💡 2번 항목과 연결: 자리비움/호출 상태에서는 클리닉 입장도 막는다 — 상태 해제 후에만 입장 가능.
        if (isPortalAway || isPortalCalling) {
            alert('자리비움/호출 처리 중에는 클리닉에 입장할 수 없습니다. 상태를 해제한 후 다시 시도해주세요.');
            return;
        }
        const week = weekTypes[className];
        const params = new URLSearchParams({ round: String(round), class: className, week });

        const testName = typeKey === 'weekly_test' ? '주간테스트' : typeKey === 'similar_hw' ? '유사과제' : typeKey === 'assignment' ? '정규과제' : '미완성과제';

        if (typeKey === 'weekly_test' || typeKey === 'similar_hw') {
            const { data } = await supabaseClient.from('exam_assignment').select('assignment_id').eq('student_id', studentInfo.id).eq('exam_master.exam_type', typeKey === 'weekly_test' ? '주간테스트' : '과제오답유사').order('created_at', { ascending: false }).limit(1);
            if (data && data.length > 0) params.append('assignment_id', data[0].assignment_id);
        } else if (typeKey === 'assignment') {
            const hwIds = hwProgress[className]?.hwIds || [];
            if (hwIds.length > 0) params.append('homework_ids', hwIds.join(','));
        } else if (typeKey === 'incomplete_assignment') {
            const incHwIds = hwProgress[className]?.incHwIds || [];
            if (incHwIds.length > 0) params.append('homework_ids', incHwIds.join(','));
        }

        if (channelRef.current && trackedSeatRef.current) {
            await channelRef.current.send({
                type: 'broadcast', event: 'student_action',
                payload: {
                    seat: trackedSeatRef.current,
                    action: 'update_activity',
                    data: { studentId: studentInfo.id, activity: `[${className}] ${testName} 응시 진입 🏃‍♂️` }
                }
            });
            await channelRef.current.untrack();
        }

        // 💡 clinic/viewer가 같은 topic(logica-clinic-room)으로 새 채널을 구독하기 전에
        // 포털의 채널을 완전히 정리해야 한다. removeChannel은 서버에 leave를 보내고
        // 그 응답을 기다린 뒤에야 클라이언트의 채널 목록에서 지우는데, 이걸 기다리지 않고
        // router.push로 넘어가면 supabase-js가 "이미 subscribe된" 옛 채널 객체를 그대로
        // 재사용해서 clinic/viewer에서 .on('presence', ...) 추가 시 에러가 난다.
        if (channelRef.current) {
            await supabaseClient.removeChannel(channelRef.current);
            channelRef.current = null;
        }

        router.push(`/clinic/viewer?${params.toString()}`);
    };

    const toggleWeekType = (className: string) => {
        const next = weekTypes[className] === 'odd' ? 'even' : 'odd';
        localStorage.setItem(`logica_demo_week_type_${className}`, next);
        setWeekTypes((p: Record<string, string>) => ({ ...p, [className]: next }));
    };

    const demoCompleteBlock = async (className: string, blockKey: string) => {
        const round = BLOCK_TO_ROUND[blockKey];
        await supabaseClient.from('clinic_round_result').upsert({ student_id: studentInfo.id, class_name: className, round, forced_done: true, completed_at: new Date().toISOString() });
        setRoundResults((p: Record<string, any>) => ({ ...p, [`${className}::${round}`]: { correct: null, total: null, forced_done: true } }));
    };

    const setTestSeat = async (seat: string | null) => {
        if (!clinicSessionRef.current?.id) return;
        const updatePayload: any = { manual_seat: seat };
        if (seat) updatePayload.seat = seat;

        await supabaseClient.from('clinic_session_state')
            .update(updatePayload)
            .eq('id', clinicSessionRef.current.id);
            
        setManualSeat(seat);
        if (seat) {
            setClinicSession((prev: any) => ({ ...prev, seat }));
            clinicSessionRef.current.seat = seat;
        }
        
        if (channelRef.current) {
            await channelRef.current.untrack();
        }
    };

    const onDragStart = (e: React.PointerEvent) => {
        if (!carouselRef.current) return;
        isDraggingRef.current = true;
        startXRef.current = e.pageX - carouselRef.current.offsetLeft;
        scrollLeftRef.current = carouselRef.current.scrollLeft;
        carouselRef.current.classList.add('cursor-grabbing');
        carouselRef.current.classList.remove('scroll-smooth', 'snap-x', 'snap-mandatory');
    };
    const onDragMove = (e: React.PointerEvent) => {
        if (!isDraggingRef.current || !carouselRef.current) return;
        e.preventDefault();
        const x = e.pageX - carouselRef.current.offsetLeft;
        const walk = (x - startXRef.current) * 1.5;
        carouselRef.current.scrollLeft = scrollLeftRef.current - walk;
    };
    const onDragEnd = () => {
        isDraggingRef.current = false;
        if (carouselRef.current) {
            carouselRef.current.classList.remove('cursor-grabbing');
            carouselRef.current.classList.add('scroll-smooth', 'snap-x', 'snap-mandatory');
        }
    };

    const getBlockState = (className: string, blockKey: string) => {
        const wt = weekTypes[className] || 'odd';
        const b1Type = wt === 'odd' ? 'weekly_test' : 'similar_hw';
        
        let d1 = blockStates[className]?.[b1Type] === '제출완료' || blockStates[className]?.[b1Type] === '채점완료' || blockStates[className]?.[b1Type] === 'NO_DATA' || !!roundResults[`${className}::1`];
        let d2 = blockStates[className]?.assignment === '제출완료' || blockStates[className]?.assignment === '채점완료' || blockStates[className]?.assignment === 'NO_DATA' || !!roundResults[`${className}::2`];
        let d3 = blockStates[className]?.incomplete_assignment === '제출완료' || blockStates[className]?.incomplete_assignment === '채점완료' || blockStates[className]?.incomplete_assignment === 'NO_DATA' || !!roundResults[`${className}::3`];

        if (blockKey === 'block1') return d1 ? 'completed' : 'available';
        if (blockKey === 'block2') return d2 ? 'completed' : (d1 ? 'available' : 'locked');
        if (blockKey === 'block3') return d3 ? 'completed' : (d2 ? 'available' : 'locked');
        return 'preview';
    };

    const renderCard = (typeKey: string, blockKey: string, round: number, className: string, idx: number) => {
        const cState = blockStates[className] || {};
        if (cState[typeKey] === 'NO_DATA') return null;

        const state = getBlockState(className, blockKey);
        const isPreview = state === 'preview';
        const isLocked = state === 'locked';
        const isDone = state === 'completed';
        const scoreData = roundResults[`${className}::${round}`];
        const scoreLabel = scoreData?.correct != null ? `${scoreData.correct}/${scoreData.total}` : '완료';

        if (typeKey === 'weekly_test' || typeKey === 'similar_hw') {
            const theme = CLINIC_TYPE_THEME[typeKey];
            const v = isPreview ? theme.light : theme.dark;
            return (
                <div key={`${className}-${blockKey}-${idx}`} className={`clinic-card snap-start shrink-0 w-[300px] md:w-[360px] ${v.card} rounded-2xl p-6 shadow-lg relative overflow-hidden group flex flex-col`}>
                    {isDone && <span className={`absolute top-5 right-5 bg-white/90 ${theme.dark.ctaText} text-[10px] font-black px-2 py-1 rounded-full shadow-md z-20 border border-slate-100`}>✅ {scoreLabel}</span>}
                    <div className="relative z-10 mb-3">
                        <button onClick={(e) => { e.stopPropagation(); toggleWeekType(className); }} title={`테스트: 주차 토글 (현재 ${weekTypes[className] || 'odd'}주)`} className="text-[10px] font-black bg-white/80 hover:bg-white text-slate-600 pl-2 pr-2.5 py-1 rounded-full backdrop-blur-sm shadow-sm transition-colors inline-flex items-center gap-1">
                            <span>🏫</span>{className}
                        </button>
                    </div>
                    <div className="flex justify-between items-start mb-6 relative z-10">
                        <span className={`text-[10px] font-black ${v.badge} px-2 py-1 rounded shadow-sm`}>{theme.label}</span>
                        {!isDone && (isPreview ? <span className={`text-xs font-bold ${v.sub}`}>다음 주 공개</span> : <span className="text-xs font-bold text-amber-200 flex items-center gap-1">⏱️ 20분 제한</span>)}
                    </div>
                    <h3 className="text-xl font-bold mb-2 relative z-10">{theme.label} 클리닉</h3>
                    <p className={`text-sm ${v.sub} font-medium mb-6 relative z-10`}>{isPreview ? '다음 주 클리닉 미리보기입니다.' : theme.desc}</p>
                    <div className="flex items-center justify-between mt-auto relative z-10">
                        <div className="flex items-center gap-2">
                            <span className="font-lexend font-bold text-lg tracking-tight">{isPreview ? '-' : '20:00'}</span>
                        </div>
                        {isPreview ? <span className={`text-xs font-bold ${v.sub}`}>🔒 다음 주에 열려요</span> : isDone ? <button disabled className={`bg-white/70 ${theme.dark.ctaText} font-black px-6 py-2.5 rounded-xl shadow-sm opacity-90 cursor-not-allowed`}>응시됨</button> : <button onClick={() => startClinicBlock(className, blockKey, round, typeKey)} className={`bg-white ${theme.dark.ctaText} font-black px-6 py-2.5 rounded-xl shadow-md hover:opacity-90 transition-colors`}>응시하기</button>}
                    </div>
                    {state === 'available' && <button onClick={(e) => { e.stopPropagation(); demoCompleteBlock(className, blockKey); }} className="absolute bottom-2 left-3 text-[9px] underline text-white/60 hover:text-white z-50">테스트: 완료로 표시</button>}
                </div>
            );
        }

        const isInc = typeKey === 'incomplete_assignment';
        const hwAgg = hwProgress[className] || {};
        const progressCount = isDone ? (isInc ? hwAgg.incTotalQuestions : hwAgg.totalQuestions) : (isInc ? hwAgg.incCompletedQuestions : hwAgg.completedQuestions);
        const totalCount = (isInc ? hwAgg.incTotalQuestions : hwAgg.totalQuestions) || 1;
        const progressPercent = Math.round((progressCount / totalCount) * 100);

        return (
            <div key={`${className}-${blockKey}-${idx}`} className="clinic-card snap-start shrink-0 w-[300px] md:w-[360px] bg-gradient-to-br from-[#002864] to-[#004080] rounded-2xl p-6 text-white shadow-lg relative overflow-hidden group flex flex-col">
                {isLocked && <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2 z-20 rounded-2xl"><span className="text-3xl">🔒</span><span className="text-xs font-bold text-white/90 px-6 text-center">{isInc ? '과제를 완료하면 열려요' : '이번 주 클리닉을 완료하면 열려요'}</span></div>}
                {isDone && <span className="absolute top-5 right-5 bg-white/90 text-[#002864] text-[10px] font-black px-2 py-1 rounded-full shadow-md z-20 border border-slate-100">✅ {scoreLabel}</span>}
                <div className="relative z-10 mb-3">
                    <button onClick={(e) => { e.stopPropagation(); toggleWeekType(className); }} className="text-[10px] font-black bg-white/80 hover:bg-white text-slate-600 pl-2 pr-2.5 py-1 rounded-full backdrop-blur-sm shadow-sm transition-colors inline-flex items-center gap-1"><span>🏫</span>{className}</button>
                </div>
                <div className="flex justify-between items-start mb-6 relative z-10">
                    <span className="text-[10px] font-black bg-blue-500 text-white px-2 py-1 rounded shadow-sm flex items-center">{isInc ? '미완성 과제' : '통합 과제 보드'}</span>
                    {!isDone && <span className={`text-xs font-bold ${isInc ? 'text-rose-300' : 'text-blue-200'}`}>{isInc ? '마감 임박' : '⏱️ D-1'}</span>}
                </div>
                <h3 className="text-xl font-bold mb-2 relative z-10">{isInc ? '미완성 과제 모아풀기' : '이번 주 정규 과제'}</h3>
                <p className="text-sm text-blue-200 font-medium mb-4 relative z-10">{isInc ? '아직 제출하지 못한 과제 문항을 풀 수 있어요.' : '미제출 상태인 과제들을 통합하여 풀 수 있어요.'}</p>
                <div className="mb-4 relative z-10">
                    <div className="flex justify-between text-xs font-bold text-blue-200/70 mb-1"><span>진행률 ({progressCount}/{totalCount})</span><span>{progressPercent}%</span></div>
                    <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden"><div className="bg-emerald-400 h-2 rounded-full transition-all duration-700" style={{ width: `${progressPercent}%` }}></div></div>
                </div>
                <div className="mt-auto flex items-center justify-end relative z-10">
                    {isDone ? <button disabled className="bg-white/70 text-[#002864] font-black px-6 py-2.5 rounded-xl shadow-sm opacity-90 cursor-not-allowed">응시됨</button> : <button onClick={() => startClinicBlock(className, blockKey, round, typeKey)} className="bg-white text-[#002864] font-black px-6 py-2.5 rounded-xl shadow-md hover:bg-blue-50 transition-colors">응시하기</button>}
                </div>
                {state === 'available' && <button onClick={(e) => { e.stopPropagation(); demoCompleteBlock(className, blockKey); }} className="absolute bottom-2 left-3 text-[9px] underline text-white/60 hover:text-white z-50">테스트: 완료로 표시</button>}
            </div>
        );
    };

    const isSameDay = clinicSession?.session_date === getKSTDateString();
    
    // DB에서 불러온 최신 시간 정보를 기준으로 동기화된 남은 시간 계산
    const remainingMs = isSameDay ? (new Date(clinicSession?.started_at || 0).getTime() + (clinicSession?.duration_ms || DEFAULT_CLINIC_SESSION_DURATION_MS)) - now : 0;
    const isUrgent = remainingMs <= 5 * 60 * 1000;
    const m = Math.max(0, Math.floor(remainingMs / 1000 / 60));
    const s = Math.max(0, Math.floor(remainingMs / 1000) % 60);

    // 시간이 다 되면 자동으로 타임업 모달 띄우기 (DB 연동 후에도 반영됨)
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
                    <div className="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-sm">
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

            <nav className="bg-white px-8 py-4 flex justify-between items-center border-b border-slate-200 sticky top-0 z-30 shadow-sm">
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

            <main className="max-w-[1400px] w-full mx-auto p-6 md:p-8 flex-1">
                {activeTab === 'home' && studentInfo.classes.length > 0 && studentInfo.classes[0] !== '반 미배정' && (
                    <section className="mb-8">
                        <div className="flex justify-between items-end mb-4">
                            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">🚀 오늘의 학습 클리닉</h2>
                            <div className="flex items-center gap-2">
                                <button onClick={() => carouselRef.current?.scrollBy({ left: -336, behavior: 'smooth' })} className="w-8 h-8 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center hover:bg-slate-50 font-bold">‹</button>
                                <button onClick={() => carouselRef.current?.scrollBy({ left: 336, behavior: 'smooth' })} className="w-8 h-8 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center hover:bg-slate-50 font-bold">›</button>
                            </div>
                        </div>
                        <div ref={carouselRef} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerLeave={onDragEnd} 
                             className="flex gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-2 scroll-smooth select-none">
                            {studentInfo.classes.map((cls, idx) => renderCard(weekTypes[cls] === 'odd' ? 'weekly_test' : 'similar_hw', 'block1', 1, cls, idx))}
                            {studentInfo.classes.map((cls, idx) => renderCard('assignment', 'block2', 2, cls, idx))}
                            {studentInfo.classes.map((cls, idx) => renderCard('incomplete_assignment', 'block3', 3, cls, idx))}
                            {studentInfo.classes.map((cls, idx) => renderCard(weekTypes[cls] === 'odd' ? 'similar_hw' : 'weekly_test', 'block4', 4, cls, idx))}
                        </div>
                    </section>
                )}

                {activeTab === 'home' && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 flex items-center gap-8">
                        <div className="relative shrink-0">
                            <svg className="w-28 h-28 transform -rotate-90">
                                <circle cx="56" cy="56" r="50" stroke="#e2e8f0" strokeWidth="8" fill="none"></circle>
                                <circle cx="56" cy="56" r="50" stroke="#002864" strokeWidth="8" fill="none" strokeDasharray="314" strokeDashoffset="78" className="transition-all duration-1000"></circle>
                            </svg>
                            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
                                <span className="block text-xs font-bold text-slate-400">Level</span>
                                <span className="block text-3xl font-black text-[#002864] font-lexend">14</span>
                            </div>
                        </div>
                        <div className="flex-1">
                            <h3 className="text-xl font-black text-slate-800 mb-1">실버 티어</h3>
                            <p className="text-sm text-slate-500">다음 골드 티어까지 <span className="font-bold text-[#002864]">350P</span> 남았습니다!</p>
                        </div>
                    </div>
                )}
                {activeTab === 'study' && <h2 className="text-2xl font-bold text-slate-800">📚 내 학습실 준비 중</h2>}
                {activeTab === 'review' && (
                    <div className="bg-gradient-to-r from-[#002864] to-indigo-800 rounded-2xl shadow-lg p-8 flex justify-between items-center group overflow-hidden relative">
                        <div className="absolute right-[-10px] top-[-30px] text-9xl opacity-10 transform rotate-12 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-0">🚀</div>
                        <div className="relative z-10">
                            <span className="bg-indigo-500 text-white text-xs font-black px-2 py-1 rounded mb-3 inline-block shadow-sm">스마트 클리닉</span>
                            <h3 className="text-2xl font-black text-white mb-2">스마트 오답 리뷰 시작하기</h3>
                            <p className="text-indigo-200 text-sm font-bold">틀린 문제들을 스스로 정복해보세요!</p>
                        </div>
                        <button onClick={() => router.push('/student/review')} className="relative z-10 bg-white text-[#002864] font-black px-8 py-4 rounded-xl shadow-xl hover:bg-indigo-50 hover:scale-105 transition-all">
                            오답 리뷰 페이지로 이동 &rarr;
                        </button>
                    </div>
                )}
                {activeTab === 'analysis' && <h2 className="text-2xl font-bold text-slate-800">📈 성적 분석 준비 중</h2>}
            </main>

            {/* 강제 퇴실 및 시간 종료 모달 */}
            {timeUpModal.isOpen && (
                <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[80]">
                    <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center">
                        <div className="text-6xl mb-4">{timeUpModal.icon}</div>
                        <h3 className="text-2xl font-black text-slate-800 mb-2">{timeUpModal.title}</h3>
                        <p className="text-sm text-slate-500 font-bold mb-6 whitespace-pre-wrap">{timeUpModal.desc}</p>
                        <button onClick={finalizeAndGoToLogin} className="w-full bg-[#002864] hover:bg-blue-900 text-white font-bold px-6 py-4 rounded-xl text-lg shadow-sm">확인</button>
                    </div>
                </div>
            )}

            {/* 클리닉 종료 요청 확인 모달 */}
            {endRequestConfirmOpen && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[80]">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm text-center">
                        <div className="text-4xl mb-3">🚪</div>
                        <h3 className="text-lg font-extrabold text-slate-800 mb-2">클리닉 종료 요청</h3>
                        <p className="text-sm text-slate-600 mb-6">클리닉 종료를 요청하시겠습니까?<br/>조교가 승인해야 종료됩니다.</p>
                        <div className="flex gap-2">
                            <button onClick={() => setEndRequestConfirmOpen(false)} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg">취소</button>
                            <button onClick={() => { endRequest.requestEnd(); setEndRequestConfirmOpen(false); }} className="flex-1 bg-rose-600 text-white font-bold py-3 rounded-lg">요청하기</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}