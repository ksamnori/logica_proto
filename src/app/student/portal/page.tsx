// src/app/student/portal/page.tsx
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { resolveTodaySession, closeSessionAtLimit, setActiveCall, clearActiveCall, setAway, clearAway, checkAndBumpToggleCooldown } from '@/lib/clinicSession';
import { resolveClassWeekType } from '@/lib/classRound';
import { useClinicEndRequest } from '@/hooks/useClinicEndRequest';
import { useToggleCooldown, TOGGLE_COOLDOWN_MS } from '@/hooks/useToggleCooldown';
import { getPointBalance } from '@/app/actions/shopPoints';
import { getActiveSeatLayout } from '@/app/actions/clinicSeatLayout';
import { processIncompleteHomeworks, generateIncorrectClinic } from '@/app/actions/clinicActions';

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

const [isGeneratingPrint, setIsGeneratingPrint] = useState(false);
const [isProcessingEnd, setIsProcessingEnd] = useState(false); 

const [selectedTaskIdx, setSelectedTaskIdx] = useState<Record<string, number>>({});

const channelRef = useRef<any>(null);
const sessionEndedRef = useRef(false);

const clinicSessionRef = useRef<any>(null);
const trackedSeatRef = useRef<string | null>(null);
const isSyncingSessionRef = useRef(false);

const [isMounted, setIsMounted] = useState(false);

useEffect(() => { setIsMounted(true); }, []);

useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
}, []);

/* STREAMING_CHUNK:Initializing student data and clinic session... */
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

        await fetchBlockStates(sid, classes, sname);
    };

    initData();
}, [router]);

const endRequest = useClinicEndRequest({
    supabaseClient, 
    sendAction: (action, extra) => sendClinicAction(action, extra), 
    sessionId: clinicSession?.id,
    endRequestStatus: clinicSession?.end_request_status, 
    endRequestCooldownUntil: clinicSession?.end_request_cooldown_until,
    onApproved: () => finalizeAndGoToLogin()
});
const endRequestRef = useRef(endRequest);
useEffect(() => { endRequestRef.current = endRequest; });

/* STREAMING_CHUNK:Syncing session state from DB... */
const runDbSync = useCallback(async () => {
    if (!clinicSessionRef.current?.id) return;
    const { data, error } = await supabaseClient
        .from('clinic_session_state')
        .select('duration_ms, seat, manual_seat, started_at, ended_at, end_request_status, end_request_cooldown_until, active_calls, active_rechecks, away_since')
        .eq('id', clinicSessionRef.current.id)
        .maybeSingle();

    if (!error && data) {
        let hasChanges = false;
        let needsDbUpdate = false;
        const updatePayload: any = {};
        
        if (data.active_calls && data.active_calls['REFRESH']) {
            const newCalls = { ...data.active_calls };
            delete newCalls['REFRESH'];
            await supabaseClient.from('clinic_session_state').update({ active_calls: newCalls }).eq('id', clinicSessionRef.current.id);
            window.location.reload();
            return;
        }

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

        if (sessionEndedRef.current && !data.ended_at) {
            const remaining = (new Date(data.started_at).getTime() + data.duration_ms) - Date.now();
            if (remaining > 0) {
                sessionEndedRef.current = false;
                setTimeUpModal(prev => ({ ...prev, isOpen: false }));
            }
        } else if (data.ended_at && !sessionEndedRef.current) {
            sessionEndedRef.current = true;
            setTimeUpModal({ isOpen: true, icon: '🚪', title: '퇴실 처리되었습니다', desc: '조교가 클리닉 이용을 종료했어요.' });
        }

        if (data.active_calls) {
            let callChanged = false;
            const newCalls = { ...data.active_calls };
            Object.keys(newCalls).forEach(qNum => {
                if (newCalls[qNum].verdict === 'resolved') {
                    delete newCalls[qNum];
                    callChanged = true;
                }
            });
            if (callChanged) {
                updatePayload.active_calls = newCalls;
                needsDbUpdate = true;
            }
            setIsPortalCalling(!!newCalls['general']);
        } else {
            setIsPortalCalling(false);
        }

        if (data.active_rechecks) {
            let recheckChanged = false;
            const newRechecks = { ...data.active_rechecks };
            Object.keys(newRechecks).forEach(uid => {
                if (newRechecks[uid].verdict) {
                    setRecheckToast(newRechecks[uid].verdict === 'correct' ? '🎉 조교님이 정답으로 확인했어요!' : '조교 확인 결과 오답이 맞습니다. (상세 내용은 클리닉에서 확인)');
                    setTimeout(() => setRecheckToast(""), 4000);
                    delete newRechecks[uid]; 
                    recheckChanged = true;
                }
            });
            if (recheckChanged) {
                updatePayload.active_rechecks = newRechecks;
                needsDbUpdate = true;
            }
        }

        if (needsDbUpdate) {
            await supabaseClient.from('clinic_session_state').update(updatePayload).eq('id', clinicSessionRef.current.id);
        }

        setIsPortalAway(!!data.away_since);

        if (endRequestRef.current?.state === 'pending' && data.end_request_status !== 'pending') {
            if (data.ended_at) {
                endRequestRef.current.handleResolved({ approved: true });
            } else if (data.end_request_status === 'idle') {
                endRequestRef.current.handleResolved({ approved: false, cooldownUntil: data.end_request_cooldown_until });
            }
        }
    }
}, [manualSeat]);

const runDbSyncRef = useRef<any>(null);
useEffect(() => { runDbSyncRef.current = runDbSync; }, [runDbSync]);

const fetchBlockStatesRef = useRef<any>(null);
useEffect(() => { fetchBlockStatesRef.current = fetchBlockStates; });

/* STREAMING_CHUNK:Setting up interval polling and presence heartbeat... */
useEffect(() => {
    if (!studentInfo.id || !isMounted) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tick = 0;
    
    const scheduleNext = () => {
        if (cancelled) return;
        timer = setTimeout(async () => {
            if (cancelled) return;
            if (isSyncingSessionRef.current) { scheduleNext(); return; }
            isSyncingSessionRef.current = true;
            try {
                await runDbSyncRef.current();
                tick++;
                if (tick % 2 === 0 && fetchBlockStatesRef.current && studentInfo.classes.length > 0) {
                    await fetchBlockStatesRef.current(studentInfo.id, studentInfo.classes, studentInfo.name);
                }
            } catch (err) {} finally {
                isSyncingSessionRef.current = false;
                scheduleNext();
            }
        }, 5000);
    };
    scheduleNext();

    const handleFocus = () => { 
        if (runDbSyncRef.current) runDbSyncRef.current(); 
        if (fetchBlockStatesRef.current && studentInfo.classes.length > 0) fetchBlockStatesRef.current(studentInfo.id, studentInfo.classes, studentInfo.name);
    };
    const handleVisibility = () => { 
        if (document.visibilityState === 'visible') {
            if (runDbSyncRef.current) runDbSyncRef.current(); 
            if (fetchBlockStatesRef.current && studentInfo.classes.length > 0) fetchBlockStatesRef.current(studentInfo.id, studentInfo.classes, studentInfo.name);
        }
    };
    
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => { 
        cancelled = true; 
        if (timer) clearTimeout(timer); 
        window.removeEventListener('focus', handleFocus); 
        document.removeEventListener('visibilitychange', handleVisibility); 
    };
}, [studentInfo.id, isMounted, studentInfo.classes, studentInfo.name]);

useEffect(() => {
    if (!studentInfo.id) return;
    let cancelled = false;
    const beat = async () => {
        const sid = clinicSessionRef.current?.id;
        if (!sid || cancelled) return;
        await supabaseClient.from('clinic_session_state').update({ last_seen_at: new Date().toISOString() }).eq('id', sid);

        if (channelRef.current && trackedSeatRef.current) {
            channelRef.current.track({
                seat: trackedSeatRef.current, 
                name: studentInfo.name, 
                studentId: studentInfo.id, 
                classes: studentInfo.classes,
                activity: '포털 대기 중 📋', 
                updatedAt: Date.now(),
                startedAt: new Date(clinicSessionRef.current?.started_at || Date.now()).getTime(),
                durationMs: clinicSessionRef.current?.duration_ms || DEFAULT_CLINIC_SESSION_DURATION_MS
            }).catch(() => {});
        }
    };
    beat();
    const iv = setInterval(beat, 15000);
    return () => { cancelled = true; clearInterval(iv); };
}, [studentInfo.id]);

/* STREAMING_CHUNK:Fetching block states for assignments and exams... */
const fetchBlockStates = async (sid: string, classes: string[], sName: string) => {
    const today = getKSTDateString();
    const newBlockStates: any = {};
    const newHwProgress: any = {};
    
    const cleanTitle = (raw: string, studentName: string) => {
        if (!raw) return '제목 없음';
        let t = raw;
        
        if (studentName) {
            const nameTag = `[${studentName}]`;
            t = t.split(nameTag).join('').trim();
        }
        
        const overdueMatches = t.match(/(미완료\s*프린트\s*)+/);
        if (overdueMatches) {
            const count = overdueMatches[0].match(/미완료\s*프린트/g)?.length || 1;
            t = t.replace(/(미완료\s*프린트\s*)+/, count > 1 ? `미완료 프린트 (${count}차) ` : '미완료 프린트 ');
        }
        
        const wrongMatches = t.match(/(오답\s*프린트\s*)+/);
        if (wrongMatches) {
            const count = wrongMatches[0].match(/오답\s*프린트/g)?.length || 1;
            t = t.replace(/(오답\s*프린트\s*)+/, count > 1 ? `오답 프린트 (${count}차) ` : '오답 프린트 ');
        }
        
        return t.replace(/\s+/g, ' ').trim() || '제목 없음';
    };

    classes.forEach(c => {
        newBlockStates[c] = { exam: 'NO_DATA', hw: 'NO_DATA', print: 'NO_DATA', overdue: 'NO_DATA' };
        newHwProgress[c] = { 
            activeExamMode: 'DONE',
            hasAnyExamClearedToday: false, 
            examList: [], hwList: [], overdueList: [], printTitles: [],
            examQCount: 0, hwQCount: 0, printQCount: 0, overdueQCount: 0,
            examPendingCount: 0, hwPendingCount: 0, printPendingCount: 0, overduePendingCount: 0,
            examStatus: '대기', examInitialScore: null, examType: ''
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

    const { data: incData } = await supabaseClient.from('student_incorrect_record')
        .select('record_id, question_id, tq_id, status')
        .eq('student_id', sid)
        .in('status', ['X', 'TX', 'TO', 'B'])
        .is('resolved_at', null);

    const rawTqIds = (incData || []).map((r: any) => r.tq_id).filter(Boolean);
    let tqToQidMap = new Map();
    if (rawTqIds.length > 0) {
        const safeTqIds = rawTqIds.filter((id: any) => !isNaN(Number(id)));
        if (safeTqIds.length > 0) {
            const { data: tqRows } = await supabaseClient.from('textbook_question').select('tq_id, question_id').in('tq_id', safeTqIds);
            tqRows?.forEach((t: any) => { if (t.question_id) tqToQidMap.set(t.tq_id, t.question_id); });
        }
    }

    const recordsToHealMissingQid = (incData || []).filter((r: any) => !r.question_id && r.tq_id && tqToQidMap.has(r.tq_id));
    if (recordsToHealMissingQid.length > 0) {
        Promise.all(recordsToHealMissingQid.map((r: any) => 
            supabaseClient.from('student_incorrect_record')
                .update({ question_id: tqToQidMap.get(r.tq_id) })
                .eq('record_id', r.record_id)
        )).catch(err => console.error('Self-healing failed', err));
    }

    const resolvedQids = (incData || []).map((r: any) => r.question_id || tqToQidMap.get(r.tq_id)).filter(Boolean);
    let uniqueIncIds = Array.from(new Set(resolvedQids)) as any[];

    const [{ data: hwAnsData }, { data: examAnsData }, { data: examsData }] = await Promise.all([
        supabaseClient.from('student_homework_answer')
            .select('homework_id, tq_id, grading_code')
            .eq('student_id', sid)
            .in('grading_code', ['O', 'TO', 'RO']),
        supabaseClient.from('student_answer')
            .select('exam_assignment_id, question_id, grading_code')
            .eq('student_id', sid)
            .in('grading_code', ['O', 'TO', 'RO']),
        supabaseClient.from('exam_assignment')
            .select('assignment_id, status, total_score, class_id, created_at, exam_master!inner(exam_type, title, total_questions)')
            .eq('student_id', sid)
    ]);

    const printExamIds = new Set(
        (examsData || [])
        .filter((ex: any) => ['오답프린트', '오답'].includes(ex.exam_master?.exam_type))
        .map((ex: any) => ex.assignment_id)
    );

    const fullyResolvedQids = new Set<any>();
    examAnsData?.forEach((a: any) => {
        if (printExamIds.has(a.exam_assignment_id) && ['O', 'RO'].includes(a.grading_code)) {
            fullyResolvedQids.add(a.question_id);
        }
    });

    const recordsToHealResolved = (incData || []).filter((r: any) => {
        const qid = r.question_id || tqToQidMap.get(r.tq_id);
        return qid && fullyResolvedQids.has(qid);
    });

    if (recordsToHealResolved.length > 0) {
        const rIdsToHeal = recordsToHealResolved.map((r: any) => r.record_id);
        supabaseClient.from('student_incorrect_record')
            .update({ resolved_at: new Date().toISOString(), status: 'RO' })
            .in('record_id', rIdsToHeal)
            .then(() => {});
        
        uniqueIncIds = uniqueIncIds.filter(id => !fullyResolvedQids.has(id));
    }

    let fixingQids = new Set<any>();
    const fixingExamIds = (examsData || [])
        .filter((ex: any) => ex.status === '채점확정')
        .map((ex: any) => ex.assignment_id);

    if (fixingExamIds.length > 0) {
        const { data: fixingAnswers } = await supabaseClient.from('student_answer')
            .select('question_id')
            .in('exam_assignment_id', fixingExamIds);
        fixingAnswers?.forEach((a: any) => fixingQids.add(a.question_id));
    }

    uniqueIncIds = uniqueIncIds.filter(id => !fixingQids.has(id));
    const totalPrintQCount = uniqueIncIds.length;

    const hwResolvedMap = new Map<number, Set<number>>();
    hwAnsData?.forEach((a: any) => {
        if (!hwResolvedMap.has(a.homework_id)) hwResolvedMap.set(a.homework_id, new Set());
        hwResolvedMap.get(a.homework_id)!.add(a.tq_id);
    });

    const examResolvedMap = new Map<number, Set<any>>();
    examAnsData?.forEach((a: any) => {
        if (!examResolvedMap.has(a.exam_assignment_id)) examResolvedMap.set(a.exam_assignment_id, new Set());
        examResolvedMap.get(a.exam_assignment_id)!.add(a.question_id);
    });

    const classIds = Object.values(nameToId).filter(Boolean);
    let hwsData: any[] = [];
    
    const hwFilters = [];
    if (classIds.length > 0) hwFilters.push(`class_id.in.(${classIds.join(',')})`);
    hwFilters.push(`target_student_id.eq.${sid}`);
    
    const { data: hwAssignments } = await supabaseClient.from('homework_assignment')
        .select('homework_id, class_id, target_student_id, due_date, homework_title, target_questions')
        .or(hwFilters.join(','))
        .neq('homework_title', '[시스템] 수업 진도 완료 기록');
    hwsData = hwAssignments || [];

    const { data: hwResData } = await supabaseClient.from('student_homework_result')
        .select('homework_id, status, completed_tq_ids')
        .eq('student_id', sid);
    const hwResMap = new Map();
    hwResData?.forEach((r: any) => hwResMap.set(r.homework_id, r));

    classes.forEach(c => {
        const cid = nameToId[c];

        let hwExams: any[] = [];
        let similarExams: any[] = [];
        let overdueExams: any[] = [];
        let regularExams: any[] = [];
        let hasAnyExamClearedToday = false; 

        examsData?.forEach((ex: any) => {
            if (ex.class_id && ex.class_id !== cid) return;
            const type = Array.isArray(ex.exam_master) ? ex.exam_master[0]?.exam_type : ex.exam_master?.exam_type;
            const rawTitle = Array.isArray(ex.exam_master) ? ex.exam_master[0]?.title : ex.exam_master?.title;
            const tq = Array.isArray(ex.exam_master) ? ex.exam_master[0]?.total_questions : ex.exam_master?.total_questions;
            
            const isFinalDone = ['최종완료', '완료', '채점완료'].includes(ex.status);
            
            const resolved = examResolvedMap.get(ex.assignment_id)?.size || 0;
            const remain = Math.max(0, (tq || 0) - resolved);

            const isTestType = !['과제', '과제프린트', '미완료과제', '오답프린트', '오답'].includes(type);
            if (isTestType && !['미응시', '진행중', '대기'].includes(ex.status)) {
                hasAnyExamClearedToday = true;
            }

            const cleanedTitle = cleanTitle(rawTitle, sName);
            const item = { id: ex.assignment_id, title: cleanedTitle, remain, status: ex.status, score: ex.total_score, type: 'exam', exType: type };

            if (type === '오답프린트' || type === '오답') { } 
            else if (type === '과제' || type === '과제프린트') {
                if (!isFinalDone) hwExams.push(item);
            } else if (type === '오답유사' || type === '과제오답유사') {
                if (!isFinalDone) similarExams.push(item);
            } else if (type === '미완료과제') {
                if (!isFinalDone) overdueExams.push(item);
            } else { 
                if (!isFinalDone) regularExams.push(item);
            }
        });

        let normalHws: any[] = [];
        let overdueNormalHws: any[] = [];

        hwsData?.forEach((hw: any) => {
            if (hw.class_id && hw.class_id !== cid) return; 
            if (hw.target_student_id && hw.target_student_id !== sid) return;
            
            const resObj = hwResMap.get(hw.homework_id);
            const status = resObj?.status || '미제출';
            if (['제출완료', '채점완료', '완료'].includes(status)) return;
            
            let tqLen = 0;
            try { tqLen = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions).length : (hw.target_questions?.length || 0); } catch(e){}

            const resolved = hwResolvedMap.get(hw.homework_id)?.size || 0;
            const remain = Math.max(0, tqLen - resolved);
            if (remain === 0) return;

            const cleanedTitle = cleanTitle(hw.homework_title, sName);
            const item = { id: hw.homework_id, title: cleanedTitle, remain, status, score: null, type: 'hw' };

            if (hw.due_date && hw.due_date < today) {
                overdueNormalHws.push(item);
            } else { 
                normalHws.push(item);
            }
        });

        const hasSimilar = similarExams.length > 0;
        const hasRegular = regularExams.length > 0;

        let finalExamList: any[] = [];
        let activeExamMode = 'DONE';
        
        if (hasRegular) {
            activeExamMode = 'TEST';
            finalExamList = regularExams;
        } else if (hasSimilar) {
            activeExamMode = 'SIMILAR';
            finalExamList = similarExams;
        }

        const finalHwList = [...hwExams, ...normalHws];
        const finalOverdueList = [...overdueExams, ...overdueNormalHws];

        const eCount = finalExamList.reduce((acc, it) => acc + it.remain, 0);
        const hCount = finalHwList.reduce((acc, it) => acc + it.remain, 0);
        const oCount = finalOverdueList.reduce((acc, it) => acc + it.remain, 0);

        const firstExam = finalExamList[0] || {};

        newBlockStates[c].exam = finalExamList.length > 0 ? '미응시' : '최종완료';
        newBlockStates[c].hw = finalHwList.length > 0 ? '미응시' : '최종완료';
        newBlockStates[c].print = totalPrintQCount > 0 ? '미응시' : '최종완료';
        newBlockStates[c].overdue = finalOverdueList.length > 0 ? '미응시' : '최종완료';

        if (roundResults[`${c}::1`]) newBlockStates[c].exam = '최종완료';
        if (roundResults[`${c}::2`]) newBlockStates[c].hw = '최종완료';
        if (roundResults[`${c}::3`]) newBlockStates[c].print = '최종완료';

        newHwProgress[c] = { 
            activeExamMode,
            hasAnyExamClearedToday,
            examList: finalExamList,
            hwList: finalHwList,
            overdueList: finalOverdueList,
            printTitles: totalPrintQCount > 0 ? ['[통합] 누적 오답 클리닉'] : [],
            
            examQCount: eCount, hwQCount: hCount, printQCount: totalPrintQCount, overdueQCount: oCount,
            examPendingCount: finalExamList.length, hwPendingCount: finalHwList.length, printPendingCount: totalPrintQCount > 0 ? 1 : 0, overduePendingCount: finalOverdueList.length,
            examStatus: firstExam.status || '대기', examType: activeExamMode === 'SIMILAR' ? '오답유사' : (firstExam.exType || '')
        };
    });

    setBlockStates(newBlockStates);
    setHwProgress(newHwProgress);
};

/* STREAMING_CHUNK:Finalization and portal actions... */
const finalizeAndGoToLogin = async () => {
    if (isProcessingEnd) return;
    setIsProcessingEnd(true);

    try {
        if (channelRef.current && trackedSeatRef.current) {
            await channelRef.current.send({ type: 'broadcast', event: 'student_action', payload: { seat: trackedSeatRef.current, action: 'depart', data: { studentId: studentInfo.id, name: studentInfo.name } } });
            await channelRef.current.untrack();
        }

        const allPendingHwIds: number[] = [];
        Object.values(hwProgress).forEach((prog: any) => {
            if (prog.hwList) {
                prog.hwList.forEach((it: any) => { if (it.type === 'hw') allPendingHwIds.push(it.id); });
            }
        });
        
        if (allPendingHwIds.length > 0) {
            const myTenantId = localStorage.getItem("logica_tenant_id") || "hq";
            
            try {
                const result = await processIncompleteHomeworks(studentInfo.id, allPendingHwIds, myTenantId);
                if (!result.success) {
                    alert(`미완료 과제 전환 중 일부 오류가 발생했습니다.\n원장님/선생님께 확인을 부탁드려주세요: ${result.error}`);
                }
            } catch (processErr) {
                console.error("미완료 과제 전환 실패:", processErr);
            }
        }

        localStorage.removeItem('logica_student_id');
        localStorage.removeItem('logica_student_name');
        localStorage.removeItem('logica_student_phone');
        router.push('/student/login');
    } finally {
        setIsProcessingEnd(false);
    }
};

const sendClinicAction = (action: string, extra: any = {}) => {
    if (channelRef.current && trackedSeatRef.current) {
        channelRef.current.send({ type: 'broadcast', event: 'student_action', payload: { seat: trackedSeatRef.current, action, data: { studentId: studentInfo.id, name: studentInfo.name, ...extra } } });
    }
};

const togglePortalAway = async () => {
    if (awayCooldown.isActive) return;
    if (isPortalCalling) { alert('선생님을 불렀을 때는 화장실에 갈 수 없어요.'); return; }
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
    if (isPortalAway) { alert('화장실에 간 상태에서는 선생님을 부를 수 없어요.'); return; }
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

const startClinicBlock = async (className: string, round: number, typeKey: string) => {
    if (isPortalAway || isPortalCalling) {
        alert('화장실을 가거나 선생님을 불렀을 때는 학습을 시작할 수 없어요. 먼저 상태를 해제해주세요!');
        return;
    }

    const prog = hwProgress[className] || {};
    const cState = blockStates[className] || {};
    const isExamClearedToProceed = cState.exam === '최종완료' || prog.hasAnyExamClearedToday;

    if (typeKey !== 'exam' && !isExamClearedToProceed) {
        alert('오늘의 첫 번째 학습(테스트/과제오답유사)을 제출한 후에 다른 클리닉을 진행할 수 있습니다.');
        return;
    }

    const params = new URLSearchParams({ round: String(round), class: className });
    let testName = '';

    if (typeKey === 'print') {
        testName = '오답 클리닉 풀이중';
        setIsGeneratingPrint(true);
        
        try {
            const { data: classData } = await supabaseClient.from('class').select('class_id, instructor_id').eq('name', className).limit(1).maybeSingle();
            const targetClassId = classData?.class_id || null;
            const targetInstructorId = classData?.instructor_id || null;

            const { data: incData } = await supabaseClient.from('student_incorrect_record')
                .select('question_id, tq_id, status')
                .eq('student_id', studentInfo.id)
                .in('status', ['X', 'TX', 'TO', 'B'])
                .is('resolved_at', null);

            const rawTqIds = (incData || []).map((r: any) => r.tq_id).filter(Boolean);
            let tqToQidMap = new Map();
            if (rawTqIds.length > 0) {
                const safeTqIds = rawTqIds.filter((id: any) => !isNaN(Number(id)));
                if (safeTqIds.length > 0) {
                    const { data: tqRows } = await supabaseClient.from('textbook_question').select('tq_id, question_id').in('tq_id', safeTqIds);
                    tqRows?.forEach((t: any) => { if (t.question_id) tqToQidMap.set(t.tq_id, t.question_id); });
                }
            }

            const resolvedQids = (incData || []).map((r: any) => r.question_id || tqToQidMap.get(r.tq_id)).filter(Boolean);
            
            const { data: fixingExams } = await supabaseClient.from('exam_assignment')
                .select('assignment_id')
                .eq('student_id', studentInfo.id)
                .eq('status', '채점확정');
                
            let fixingQids = new Set<any>();
            if (fixingExams && fixingExams.length > 0) {
                const fIds = fixingExams.map((ex: any) => ex.assignment_id);
                const { data: fixingAnswers } = await supabaseClient.from('student_answer')
                    .select('question_id')
                    .in('exam_assignment_id', fIds);
                fixingAnswers?.forEach((a: any) => fixingQids.add(a.question_id));
            }

            const filteredQids = resolvedQids.filter((id: any) => !fixingQids.has(id));
            const uniqueQids = Array.from(new Set(filteredQids)) as any[];
            
            if (uniqueQids.length === 0) {
                alert('정정할 오답이 없습니다.');
                setIsGeneratingPrint(false);
                return;
            }
            
            const myTenantId = localStorage.getItem("logica_tenant_id") || "hq";
            
            const result = await generateIncorrectClinic({
                studentId: studentInfo.id,
                studentName: studentInfo.name,
                targetClassId,
                targetInstructorId,
                uniqueQids: uniqueQids as number[], 
                tenantId: myTenantId
            });

            if (!result.success || !result.assignmentId) {
                throw new Error(result.error || "시험지 배부를 실패했습니다.");
            }

            params.append('assignment_id', String(result.assignmentId));
        } catch (e: any) {
            console.error(e);
            alert(`문제지를 통합 생성하는 중 오류가 발생했습니다: ${e.message}`);
            setIsGeneratingPrint(false);
            return;
        }
        setIsGeneratingPrint(false);
    } else {
        const listKey = typeKey === 'exam' ? 'examList' : typeKey === 'hw' ? 'hwList' : typeKey === 'overdue' ? 'overdueList' : null;
        const items = listKey ? prog[listKey] || [] : [];
        const cardKey = `${className}-${typeKey}`;
        const selectedIdx = selectedTaskIdx[cardKey] || 0;
        const selectedItem = items[selectedIdx] || items[0];

        if (!selectedItem) {
            alert('수행할 항목이 없습니다.');
            return;
        }

        if (selectedItem.type === 'hw') {
            params.append('homework_ids', String(selectedItem.id));
            testName = '과제 풀이중';
        } else {
            params.append('assignment_id', String(selectedItem.id));
            if (typeKey === 'exam') {
                if (selectedItem.status === '채점확정') {
                    testName = '오답 정정중';
                    params.append('retry', 'true');
                } else {
                    const exactType = selectedItem.exType || '테스트';
                    testName = `${exactType} 풀이중`;
                }
                params.append('week', prog.activeExamMode === 'SIMILAR' ? 'even' : 'odd');
            } else if (typeKey === 'hw') {
                testName = '과제 풀이중';
            } else if (typeKey === 'overdue') {
                testName = '미완료 과제 풀이중';
                params.append('overdue', '1'); 
            }
        }
    }

    if (channelRef.current && trackedSeatRef.current) {
        await channelRef.current.send({
            type: 'broadcast', event: 'student_action',
            payload: { seat: trackedSeatRef.current, action: 'update_activity', data: { studentId: studentInfo.id, activity: `[${className}] ${testName} 🏃‍♂️` } }
        });
        await channelRef.current.untrack();
    }

    if (channelRef.current) {
        await supabaseClient.removeChannel(channelRef.current);
        channelRef.current = null;
    }

    router.push(`/clinic/viewer?${params.toString()}`);
};

/* STREAMING_CHUNK:Rendering UI cards with pastel themes... */
const renderCard = (typeKey: string, round: number, className: string) => {
    const cState = blockStates[className] || {};
    const prog = hwProgress[className] || {};
    const listKey = typeKey === 'exam' ? 'examList' : typeKey === 'hw' ? 'hwList' : typeKey === 'overdue' ? 'overdueList' : null;
    const items = listKey ? prog[listKey] || [] : [];
    const cardKey = `${className}-${typeKey}`;
    
    const selectedIdx = selectedTaskIdx[cardKey] || 0;
    const selectedItem = items[selectedIdx] || items[0] || {};
    const hasMultiple = items.length > 1;

    const isBoxDone = (typeKey === 'print' ? (prog.printPendingCount === 0) : (items.length === 0)) || cState[typeKey] === '최종완료' || cState[typeKey] === '채점완료';
    
    const isExamClearedToProceed = cState.exam === '최종완료' 
        || prog.hasAnyExamClearedToday 
        || (prog.examList?.length || 0) === 0;
    const isLocked = typeKey !== 'exam' && !isBoxDone && !isExamClearedToProceed; 

    const qCount = typeKey === 'exam' ? prog.examQCount : typeKey === 'hw' ? prog.hwQCount : typeKey === 'print' ? prog.printQCount : 0;
    const pendingStacks = typeKey === 'print' ? prog.printPendingCount : items.length;
    const titleArray = typeKey === 'print' ? (prog.printTitles || []) : items.map((it:any) => it.title);

    const examStatus = typeKey === 'exam' ? (selectedItem.status || '대기') : '대기';
    const initialScore = typeKey === 'exam' ? selectedItem.score : null;

    const isSelectedItemWaiting = typeKey === 'exam' && examStatus === '제출완료'; 
    const isSelectedItemFixing = typeKey === 'exam' && examStatus === '채점확정'; 
    const isSelectedItem100 = isSelectedItemFixing && initialScore === 100;

    const exType = selectedItem.exType || prog.examType || '';

    let theme: any;
    if (typeKey === 'exam') {
        if (prog.activeExamMode === 'SIMILAR') {
            theme = { label: '🔁 과제오답유사', desc: '과제에서 틀렸던 문제와 비슷한 문제를 다시 풀어봅니다.', bg: 'bg-gradient-to-br from-violet-200 to-violet-50', badge: 'bg-white/60 text-violet-800 border border-violet-200', btnBg: 'bg-white hover:bg-violet-50', btnText: 'text-violet-700', textColor: 'text-violet-900/80', accent: 'text-violet-800' };
        } else {
            if (['분기테스트', '분기평가'].includes(exType)) {
                theme = { label: '📅 분기평가', desc: '해당 분기의 학업 성취도를 종합적으로 평가합니다.', bg: 'bg-gradient-to-br from-fuchsia-200 to-fuchsia-50', badge: 'bg-white/60 text-fuchsia-800 border border-fuchsia-200', btnBg: 'bg-white hover:bg-fuchsia-50', btnText: 'text-fuchsia-700', textColor: 'text-fuchsia-900/80', accent: 'text-fuchsia-800' };
            } else if (['중간테스트', '중간평가'].includes(exType)) {
                theme = { label: '📝 중간평가', desc: '이번 중간평가를 응시합니다.', bg: 'bg-gradient-to-br from-indigo-200 to-indigo-50', badge: 'bg-white/60 text-indigo-800 border border-indigo-200', btnBg: 'bg-white hover:bg-indigo-50', btnText: 'text-indigo-700', textColor: 'text-indigo-900/80', accent: 'text-indigo-800' };
            } else if (['입학테스트', '진단평가'].includes(exType)) {
                theme = { label: '📊 진단평가', desc: '현재 실력을 진단하기 위한 평가를 진행합니다.', bg: 'bg-gradient-to-br from-cyan-200 to-cyan-50', badge: 'bg-white/60 text-cyan-800 border border-cyan-200', btnBg: 'bg-white hover:bg-cyan-50', btnText: 'text-cyan-700', textColor: 'text-cyan-900/80', accent: 'text-cyan-800' };
            } else {
                const finalLabel = exType === '주간테스트' || !exType ? '📝 주간테스트' : `📝 ${exType}`;
                theme = { label: finalLabel, desc: '오늘 배정된 테스트를 응시합니다.', bg: 'bg-gradient-to-br from-blue-200 to-blue-50', badge: 'bg-white/60 text-blue-800 border border-blue-200', btnBg: 'bg-white hover:bg-blue-50', btnText: 'text-blue-700', textColor: 'text-slate-600', accent: 'text-blue-800' };
            }
        }

        if (isSelectedItemWaiting) {
            theme.label = '⏳ 채점 대기 중';
            theme.desc = '제출이 완료되었습니다! 선생님이 확인 후 최종 확정해 주실 때까지 잠시 기다려주세요.';
            theme.bg = 'bg-gradient-to-br from-slate-200 to-slate-50';
            theme.badge = 'bg-slate-300/50 text-slate-800';
            theme.btnBg = 'bg-white/50';
            theme.btnText = 'text-slate-600';
            theme.textColor = 'text-slate-600';
            theme.accent = 'text-slate-700';
        } else if (isSelectedItemFixing) {
            theme.label = '✍️ 시험지 오답 고치기';
            theme.desc = '채점이 확정되었습니다. 돌려받은 기존 시험지를 보면서 틀린 문제를 다시 풀고 정답을 입력하세요!';
            theme.bg = 'bg-gradient-to-br from-amber-200 to-yellow-50';
            theme.badge = 'bg-white/60 text-amber-900 border border-amber-300';
            theme.btnBg = 'bg-amber-400 hover:bg-amber-300'; 
            theme.btnText = 'text-amber-950';
            theme.textColor = 'text-slate-700';
            theme.accent = 'text-amber-800';
        }
    }
    else if (typeKey === 'hw') theme = { label: '📚 과제', desc: '미제출 과제 문항을 학습합니다.', bg: 'bg-gradient-to-br from-orange-200 to-orange-50', badge: 'bg-white/60 text-orange-900 border border-orange-200', btnBg: 'bg-white hover:bg-orange-50', btnText: 'text-orange-700', textColor: 'text-slate-600', accent: 'text-orange-800' };
    else theme = { label: '🖨️ 오답', desc: '틀린 문제들만 모아 다시 풉니다.', bg: 'bg-gradient-to-br from-emerald-200 to-emerald-50', badge: 'bg-white/60 text-emerald-900 border border-emerald-200', btnBg: 'bg-white hover:bg-emerald-50', btnText: 'text-emerald-700', textColor: 'text-slate-600', accent: 'text-emerald-800' };

    const badgeLabel = typeKey === 'print' ? '통합' : typeKey === 'exam' ? `남은 평가 ${pendingStacks}건` : `남은 과제 ${pendingStacks}건`;

    return (
        <div key={cardKey} className={`w-full h-full ${theme.bg} rounded-[2rem] p-8 md:p-10 shadow-xl relative overflow-hidden group flex flex-col transition-all duration-300 ${isLocked ? 'grayscale opacity-60 bg-slate-200' : ''}`}>
            {isLocked && <div className="absolute inset-0 bg-white/40 z-0"></div>}
            {isBoxDone && <span className={`absolute top-6 right-6 bg-white/90 text-slate-800 text-sm md:text-base font-black px-4 py-2 rounded-full shadow-md z-20 border border-slate-100`}>✅ 모두 완료됨</span>}
            
            <div className="relative z-10 shrink-0">
                <div className="flex flex-wrap items-center gap-2.5 mb-3 pr-[120px] md:pr-[220px]">
                    <span className={`text-sm md:text-base font-black ${isLocked ? 'bg-white/60 text-slate-500 shadow-sm' : theme.badge} px-4 py-2 rounded-xl shadow-sm flex items-center`}>
                        {isLocked ? '🔒 잠김' : theme.label}
                    </span>
                    {pendingStacks > 1 && !isBoxDone && !isLocked && !isSelectedItemWaiting && (
                        <span className="text-sm font-bold bg-white/60 text-slate-700 px-3 py-1.5 rounded-lg shadow-sm border border-white">
                            {badgeLabel}
                        </span>
                    )}
                </div>
                
                <div className="absolute top-0 right-0 flex flex-col items-end gap-2 z-20 w-auto max-w-[55%] md:max-w-[300px]">
                    <div className="flex items-center gap-2">
                        {isSelectedItemWaiting && initialScore !== null && (
                            <span className="text-sm md:text-base font-bold text-slate-700 bg-white/60 px-3.5 py-1.5 rounded-lg whitespace-nowrap shadow-sm border border-white/50">가채점: {initialScore}점</span>
                        )}
                        {!isBoxDone && !isSelectedItemWaiting && qCount > 0 && <span className={`text-sm md:text-base font-bold ${isLocked ? 'text-slate-500 bg-white/50' : 'text-slate-700 bg-white/60'} px-3.5 py-1.5 rounded-lg whitespace-nowrap shadow-sm border border-white/50`}>남은 문제: {selectedItem.remain || qCount}</span>}
                    </div>
                    {hasMultiple && !isBoxDone && !isLocked && !isSelectedItemWaiting && (
                        <select
                            value={selectedIdx}
                            onChange={(e) => setSelectedTaskIdx(prev => ({ ...prev, [cardKey]: Number(e.target.value) }))}
                            className="max-w-full w-[240px] text-xs md:text-sm font-bold bg-white/60 text-slate-800 border border-white/50 rounded-xl px-3 py-2 outline-none cursor-pointer truncate appearance-none hover:bg-white/80 transition-colors shadow-sm"
                            style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23475569%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px top 50%', backgroundSize: '10px auto' }}
                        >
                            {items.map((item: any, idx: number) => (
                                <option key={idx} value={idx} className="text-slate-800 bg-white">
                                    {item.title} (남은 {item.remain}문제)
                                </option>
                            ))}
                        </select>
                    )}
                </div>
                
                <h3 className={`text-[26px] md:text-[32px] lg:text-[36px] font-black mb-1.5 leading-tight ${isLocked ? 'text-slate-400' : 'text-slate-800'} pr-[80px] md:pr-[120px]`}>
                    {isSelectedItemWaiting || isSelectedItemFixing ? '' : theme.label.replace(/[^가-힣 ]/g, '').trim() + ' 클리닉'}
                    {isSelectedItemWaiting ? '채점 결과 확인 중' : ''}
                    {isSelectedItemFixing && !isSelectedItem100 ? '시험지 오답 고치기' : ''}
                    {isSelectedItem100 ? '모든 문제를 맞췄습니다!' : ''}
                </h3>
                
                <p className={`text-sm md:text-base font-medium mt-0 mb-1.5 leading-snug ${isLocked ? 'text-slate-400' : theme.textColor} pr-[60px] md:pr-[10px]`}>
                    {isLocked ? '첫 번째 학습을 먼저 제출해주세요.' : (isSelectedItem100 ? '선택하신 학습에 더 이상 정정할 오답이 없습니다!' : theme.desc)}
                </p>
            </div>

            <div className="relative z-10 flex flex-1 min-h-0 items-stretch justify-between gap-4 mt-2">
                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col justify-start pb-1">
                    {!isBoxDone && titleArray.length > 0 && (
                        <div className="flex flex-col gap-2">
                            {titleArray.slice(0, 4).map((t: string, idx: number) => (
                                <div key={idx} className={`text-lg md:text-xl font-bold ${isLocked ? 'text-slate-400' : theme.accent} truncate flex items-center gap-3`} title={t}>
                                    <span className="w-2 h-2 rounded-full bg-current opacity-70 shrink-0"></span> <span className="truncate text-slate-700">{t}</span>
                                </div>
                            ))}
                            {titleArray.length > 4 && (
                                <div className={`text-sm md:text-base font-bold ${isLocked ? 'text-slate-300' : theme.accent} pl-5 mt-1`}>
                                    ...외 {titleArray.length - 4}개의 학습 대기 중
                                </div>
                            )}
                        </div>
                    )}
                </div>
                
                <div className="shrink-0 self-end flex flex-col items-end gap-2.5">
                    {isBoxDone ? 
                        <button disabled className={`bg-white/70 text-slate-500 font-black px-8 py-3.5 md:py-4 text-lg md:text-xl rounded-2xl shadow-sm opacity-90 cursor-not-allowed`}>
                            학습 전체 완료
                        </button> 
                    : isSelectedItem100 ?
                        <button disabled className={`bg-white/70 text-slate-500 font-black px-8 py-3.5 md:py-4 text-lg md:text-xl rounded-2xl shadow-sm opacity-90 cursor-not-allowed`}>
                            💯 정답 완료
                        </button>
                    : isSelectedItemWaiting ?
                        <button disabled className="bg-white/60 text-slate-500 font-black px-8 py-3.5 md:py-4 text-lg md:text-xl rounded-2xl shadow-sm cursor-not-allowed flex items-center gap-2">
                            <span>🔒</span> 확인 대기
                        </button>
                    : isLocked ?
                        <button disabled className="bg-white/50 text-slate-400 font-black px-8 py-3.5 md:py-4 text-lg md:text-xl rounded-2xl shadow-sm cursor-not-allowed flex items-center gap-2 border border-white">
                            <span>🔒</span> 잠김
                        </button>
                    : 
                        <button disabled={isGeneratingPrint} onClick={() => startClinicBlock(className, round, typeKey)} className={`${theme.btnBg} ${theme.btnText} font-black px-8 py-3.5 md:py-4 text-lg md:text-xl rounded-2xl shadow-md border border-white/50 hover:shadow-lg hover:scale-105 transition-all ${isGeneratingPrint && typeKey === 'print' ? 'opacity-70 animate-pulse' : ''}`}>
                            {isGeneratingPrint && typeKey === 'print' ? '⏳ 통합 생성 중...' : (isSelectedItemFixing ? '오답 정정 시작하기' : '학습하기')}
                        </button>
                    }
                </div>
            </div>
        </div>
    );
};

/* STREAMING_CHUNK:Rendering overdue card... */
const renderOverdueCard = (className: string) => {
    const typeKey = 'overdue';
    const cState = blockStates[className] || {};
    const prog = hwProgress[className] || {};
    const items = prog.overdueList || [];
    const cardKey = `${className}-${typeKey}`;
    const selectedIdx = selectedTaskIdx[cardKey] || 0;
    const selectedItem = items[selectedIdx] || items[0] || {};
    const hasMultiple = items.length > 1;

    const isBoxDone = items.length === 0 || cState.overdue === '최종완료';
    
    const firstExamStatus = prog.examStatus || '대기';
    const isExamClearedToProceed = cState.exam === '최종완료' || prog.hasAnyExamClearedToday;
    const isLocked = !isBoxDone && !isExamClearedToProceed;

    const qCount = prog.overdueQCount || 0;
    const titleArray = items.map((it:any) => it.title);
    const pendingStacks = items.length;

    const theme = {
        label: '⏰ 미완료 과제',
        desc: '다음 수업 전까지 끝내지 못해 밀린 과제입니다.',
        bg: 'bg-gradient-to-br from-rose-200 to-rose-50',
        badge: 'bg-white/60 text-rose-900 border border-rose-200',
        btnBg: 'bg-white hover:bg-rose-50',
        btnText: 'text-rose-700',
        textColor: 'text-slate-600',
        accent: 'text-rose-800'
    };

    return (
        <div key={cardKey} className={`w-full h-full ${theme.bg} rounded-[2rem] p-8 md:p-10 shadow-xl relative overflow-hidden group flex flex-col justify-between transition-all duration-300 ${isLocked ? 'grayscale opacity-60 bg-slate-200' : ''}`}>
            {isLocked && <div className="absolute inset-0 bg-white/40 z-0"></div>}
            
            {isBoxDone && <span className={`absolute top-6 right-6 bg-white/90 text-slate-800 text-sm md:text-base font-black px-4 py-2 rounded-full shadow-md z-20 border border-slate-100`}>✅ 밀린 과제 없음</span>}
            
            <div className="relative z-10 shrink-0">
                <div className="flex flex-wrap items-center gap-2.5 mb-3 pr-[120px] md:pr-[220px]">
                    <span className={`text-sm md:text-base font-black ${isLocked ? 'bg-white/60 text-slate-500 shadow-sm' : theme.badge} px-4 py-2 rounded-xl shadow-sm flex items-center`}>
                        {isLocked ? '🔒 잠김' : theme.label}
                    </span>
                    {pendingStacks > 1 && !isBoxDone && !isLocked && (
                        <span className="text-sm font-bold bg-white/60 text-slate-700 px-3 py-1.5 rounded-lg shadow-sm border border-white">
                            밀린 과제 {pendingStacks}건
                        </span>
                    )}
                </div>
                
                <div className="absolute top-0 right-0 flex flex-col items-end gap-2 z-20 w-auto max-w-[55%] md:max-w-[300px]">
                    {!isBoxDone && qCount > 0 && <span className={`text-sm md:text-base font-bold ${isLocked ? 'text-slate-500 bg-white/50' : 'text-slate-700 bg-white/60'} px-3.5 py-1.5 rounded-lg whitespace-nowrap shadow-sm border border-white/50`}>남은 문제: {selectedItem.remain || qCount}</span>}
                    {hasMultiple && !isBoxDone && !isLocked && (
                        <select
                            value={selectedIdx}
                            onChange={(e) => setSelectedTaskIdx(prev => ({ ...prev, [cardKey]: Number(e.target.value) }))}
                            className="max-w-full w-[240px] text-xs md:text-sm font-bold bg-white/60 text-slate-800 border border-white/50 rounded-xl px-3 py-2 outline-none cursor-pointer truncate appearance-none hover:bg-white/80 transition-colors shadow-sm"
                            style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23475569%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px top 50%', backgroundSize: '10px auto' }}
                        >
                            {items.map((item: any, idx: number) => (
                                <option key={idx} value={idx} className="text-slate-800 bg-white">
                                    {item.title} (남은 {item.remain}문제)
                                </option>
                            ))}
                        </select>
                    )}
                </div>
                
                <h3 className={`text-[26px] md:text-[32px] lg:text-[36px] font-black mb-1.5 leading-tight ${isLocked ? 'text-slate-400' : 'text-slate-800'} pr-[80px] md:pr-[120px]`}>미완료 과제 클리닉</h3>
                <p className={`text-sm md:text-base font-medium mt-0 mb-1.5 leading-snug ${isLocked ? 'text-slate-400' : theme.textColor} pr-[60px] md:pr-[10px]`}>
                    {isLocked ? '첫 번째 학습을 먼저 제출해주세요.' : theme.desc}
                </p>
            </div>

            <div className="relative z-10 flex flex-1 min-h-0 items-stretch justify-between gap-4 mt-2">
                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col justify-start pb-1">
                    {!isBoxDone && titleArray.length > 0 && (
                        <div className="flex flex-col gap-2">
                            {titleArray.slice(0, 4).map((t: string, idx: number) => (
                                <div key={idx} className={`text-lg md:text-xl font-bold ${isLocked ? 'text-slate-400' : theme.accent} truncate flex items-center gap-3`} title={t}>
                                    <span className="w-2 h-2 rounded-full bg-current opacity-70 shrink-0"></span> <span className="truncate text-slate-700">{t}</span>
                                </div>
                            ))}
                            {titleArray.length > 4 && (
                                <div className={`text-sm md:text-base font-bold ${isLocked ? 'text-slate-300' : theme.accent} pl-5 mt-1`}>
                                    ...외 {titleArray.length - 4}개의 학습 대기 중
                                </div>
                            )}
                        </div>
                    )}
                </div>
                
                <div className="shrink-0 self-end flex flex-col items-end gap-2.5">
                    {isBoxDone ?
                        <button disabled className={`bg-white/70 text-slate-500 font-black px-8 py-3.5 md:py-4 text-lg md:text-xl rounded-2xl shadow-sm opacity-90 cursor-not-allowed`}>밀린 과제 없음</button>
                    : isLocked ?
                        <button disabled className="bg-white/50 text-slate-400 font-black px-8 py-3.5 md:py-4 text-lg md:text-xl rounded-2xl shadow-sm cursor-not-allowed flex items-center gap-2 border border-white">
                            <span>🔒</span> 잠김
                        </button>
                    :
                        <button onClick={() => startClinicBlock(className, 2, 'overdue')} className={`${theme.btnBg} ${theme.btnText} font-black px-8 py-3.5 md:py-4 text-lg md:text-xl rounded-2xl shadow-md border border-white/50 hover:shadow-lg hover:scale-105 transition-all`}>학습하기</button>
                    }
                </div>
            </div>
        </div>
    );
};

const isSameDay = clinicSession?.session_date === getKSTDateString();
const remainingMs = isSameDay ? (new Date(clinicSession?.started_at || 0).getTime() + (clinicSession?.duration_ms || DEFAULT_CLINIC_SESSION_DURATION_MS)) - now : 0;
const isUrgent = remainingMs <= 5 * 60 * 1000;

const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
const hours = Math.floor(totalSec / 3600);
const mins = Math.floor((totalSec % 3600) / 60);
const secs = totalSec % 60;
const timeStr = `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

/* STREAMING_CHUNK:Rendering main page layout... */
return (
    <div className="h-screen flex flex-col bg-slate-50 font-['Pretendard'] overflow-hidden">
        {editorLocked && (
            <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[999] flex items-center justify-center px-6">
                <div className="bg-white rounded-3xl shadow-2xl p-8 text-center max-w-sm">
                    <div className="text-4xl mb-3">🔒</div>
                    <h3 className="text-lg font-extrabold text-slate-800 mb-2">좌석 배치 수정 중입니다</h3>
                    <p className="text-sm text-slate-500">선생님이 좌석 배치를 편집하는 동안에는<br />클리닉 기능이 잠시 멈춥니다. 잠시만 기다려주세요.</p>
                </div>
            </div>
        )}
        <style dangerouslySetInnerHTML={{ __html: `
            @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;700;900&display=swap');
            .font-lexend { font-family: 'Lexend', sans-serif; }
            .no-scrollbar::-webkit-scrollbar { display: none; }
            .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `}} />

        <nav className="bg-white px-8 py-4 flex justify-between items-center border-b border-slate-200 sticky top-0 z-30 shadow-sm shrink-0">
            <div className="flex items-center gap-8">
                <div className="flex items-center">
                    <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" alt="Logica" className="h-10 object-contain" />
                </div>
            </div>
            <div className="flex items-center gap-4 md:gap-5">
                {isSameDay && (
                    <div className={`flex items-center gap-2 border rounded-full px-4 py-2 shadow-sm transition-colors ${isUrgent ? 'bg-rose-100 border-rose-300 animate-pulse' : 'bg-indigo-50 border-indigo-200'}`}>
                        <span className="text-indigo-500 text-base md:text-lg">🕐</span>
                        <span className="text-sm font-bold text-indigo-600 opacity-80">남은 시간</span>
                        <span className="text-xl md:text-2xl font-black font-lexend text-indigo-600 tracking-wider">{isMounted && remainingMs <= 0 ? '종료' : timeStr}</span>
                    </div>
                )}
                {isSameDay && (
                    <button onClick={togglePortalAway} disabled={isPortalCalling || awayCooldown.isActive} className={`text-sm md:text-base font-bold rounded-full px-5 py-2.5 border shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isPortalAway ? 'bg-amber-400 border-amber-400 text-amber-950' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                        {awayCooldown.isActive ? `⏳ ${Math.ceil(awayCooldown.remainingMs / 1000)}초` : isPortalAway ? '↩️ 자리 복귀' : '🚶 화장실 다녀오기'}
                    </button>
                )}
                {isSameDay && (
                    <button onClick={togglePortalCall} disabled={isPortalAway || callCooldown.isActive} className={`text-sm md:text-base font-bold rounded-full px-5 py-2.5 border shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isPortalCalling ? 'bg-rose-500 border-rose-500 text-white animate-pulse' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                        {callCooldown.isActive ? `⏳ ${Math.ceil(callCooldown.remainingMs / 1000)}초` : isPortalCalling ? '🚨 부르기 취소' : '🙋 선생님 부르기'}
                    </button>
                )}

                <button onClick={() => router.push('/student/shop')} className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-4 py-2.5 cursor-pointer hover:bg-amber-100 transition-colors shadow-sm">
                    <span className="text-sm md:text-base font-bold text-amber-700">나의 포인트</span>
                    <span className="text-amber-500 text-lg md:text-xl font-black font-lexend">{mockPoints.toLocaleString()} P</span>
                </button>
                <div className="w-px h-8 bg-slate-200 mx-2"></div>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <p className="text-base md:text-lg font-black text-slate-800">{studentInfo.name} 학생</p>
                        <p className="text-sm font-bold text-emerald-500 mt-0.5">{studentInfo.classes.join(', ')}</p>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-indigo-200 text-indigo-800 flex items-center justify-center text-2xl shadow-sm border border-indigo-300">👦🏻</div>
                    
                    {endRequest.state === 'idle' && (
                        <button onClick={() => setEndRequestConfirmOpen(true)} className="text-sm md:text-base font-black text-white bg-slate-700 hover:bg-slate-800 border border-slate-600 rounded-full px-6 py-3 transition-colors shadow-md flex items-center gap-2">
                            👋 오늘 공부 끝내기
                        </button>
                    )}
                    {endRequest.state === 'pending' && (
                        <button onClick={endRequest.cancelRequest} className="text-sm md:text-base font-black text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-5 py-3 animate-pulse shadow-sm">
                            ⏳ 끝내기 취소
                        </button>
                    )}
                    {endRequest.state === 'cooldown' && (
                        <span className="text-sm md:text-base font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-5 py-3 shadow-sm">
                            재요청까지 {Math.floor(endRequest.cooldownRemainingMs / 60000)}:{String(Math.floor(endRequest.cooldownRemainingMs / 1000) % 60).padStart(2, '0')}
                        </span>
                    )}
                </div>
            </div>
        </nav>

        <main className="w-full max-w-[1600px] mx-auto p-8 lg:p-12 flex-1 flex flex-col min-h-0">
            {studentInfo.classes.length > 0 && (
                <section className="flex flex-col flex-1 min-h-0">
                    <div className="flex items-center gap-5 mb-8 shrink-0">
                        <h2 className="text-3xl md:text-[40px] font-black text-slate-800 flex items-center gap-4">🚀 오늘의 학습 클리닉</h2>
                        {studentInfo.classes.length > 1 && studentInfo.classes.map((cls) => {
                            const prog = hwProgress[cls] || {};
                            let totalPending = (prog.examPendingCount || 0) + (prog.hwPendingCount || 0) + (prog.printPendingCount || 0) + (prog.overduePendingCount || 0);
                            
                            if (prog.examStatus === '채점확정' && prog.examInitialScore === 100) {
                                totalPending = Math.max(0, totalPending - 1);
                            }

                            return (
                                <button key={cls} onClick={() => setSelectedClass(cls)} className={`relative text-base md:text-xl font-black px-6 py-2.5 rounded-full shadow-sm transition-colors inline-flex items-center gap-2 ${selectedClass === cls ? 'bg-indigo-400 text-white border-transparent' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                    <span>🏫</span>{cls}
                                    {totalPending > 0 && (
                                        <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-rose-400 text-xs font-black text-white shadow-sm ring-2 ring-white">
                                            {totalPending > 99 ? '99+' : totalPending}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 grid-rows-2 gap-8 lg:gap-10 flex-1 min-h-0">
                        {renderCard('exam', 1, selectedClass)}
                        {renderCard('hw', 2, selectedClass)}
                        {renderOverdueCard(selectedClass)}
                        {renderCard('print', 3, selectedClass)}
                    </div>
                </section>
            )}
        </main>

        {recheckToast && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-base font-bold px-6 py-4 rounded-xl shadow-lg z-[80]">
                {recheckToast}
            </div>
        )}

        {timeUpModal.isOpen && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[80]">
                <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-sm text-center">
                    <div className="text-7xl mb-4">{timeUpModal.icon}</div>
                    <h3 className="text-2xl font-black text-slate-800 mb-3">{timeUpModal.title}</h3>
                    <p className="text-lg text-slate-500 font-bold mb-6 whitespace-pre-wrap">{timeUpModal.desc}</p>
                    <button onClick={finalizeAndGoToLogin} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-bold px-6 py-4 rounded-xl text-xl shadow-sm">확인</button>
                </div>
            </div>
        )}

        {endRequestConfirmOpen && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[80]">
                <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md text-center">
                    <div className="text-6xl mb-5">🚪</div>
                    <h3 className="text-3xl font-extrabold text-slate-800 mb-4">학습 종료 요청</h3>
                    <p className="text-lg text-slate-600 mb-8 font-medium">오늘 공부를 모두 마치고 종료하시겠어요?<br/>선생님이 확인 후 승인해 줍니다.</p>
                    <div className="flex gap-4">
                        <button onClick={() => setEndRequestConfirmOpen(false)} className="flex-1 bg-slate-100 text-slate-600 font-bold text-lg py-4 rounded-xl hover:bg-slate-200 transition-colors">취소</button>
                        <button onClick={() => { endRequest.requestEnd(); setEndRequestConfirmOpen(false); }} className="flex-1 bg-rose-500 text-white font-bold text-lg py-4 rounded-xl hover:bg-rose-600 transition-colors shadow-sm">종료 요청</button>
                    </div>
                </div>
            </div>
        )}
    </div>
);


}