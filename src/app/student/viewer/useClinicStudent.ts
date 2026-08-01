// src/app/student/viewer/useClinicStudent.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { getActiveSeatLayout } from '@/app/actions/clinicSeatLayout';

// ==========================================
// 환경 변수 및 상수
// ==========================================
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// 싱글톤 패턴으로 Supabase 클라이언트 생성 (Next.js HMR 충돌 방지)
const getSupabaseClient = () => {
    if (typeof window === 'undefined') return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (!(window as any)._supabaseInstance) (window as any)._supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return (window as any)._supabaseInstance;
};
const supabaseClient = getSupabaseClient();

const CLINIC_ROOM = 'logica-clinic-room';

const getKSTDateString = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

export function useClinicStudent() {
    const router = useRouter();

    // === 학생 기본 정보 ===
    const [myStudentId, setMyStudentId] = useState<string>('');
    const [myName, setMyName] = useState<string>('');
    const [mySeat, setMySeat] = useState<string | null>(null);
    const [isScreenStarted, setIsScreenStarted] = useState(false);
    
    // === 문제 및 풀이 상태 ===
    const [dbQuestions, setDbQuestions] = useState<any[]>([]);
    const [currentQIndex, setCurrentQIndex] = useState(0);
    const [studentAnswers, setStudentAnswers] = useState<Record<number, string | null>>({});
    const [keypadAnswers, setKeypadAnswers] = useState<Record<number, string>>({});
    const [studentDrawings, setStudentDrawings] = useState<Record<number, string>>({});
    const [answerModes, setAnswerModes] = useState<Record<number, 'pen' | 'keypad'>>({});
    
    // === 호출 및 상태 ===
    const [callState, setCallState] = useState<Record<number, boolean>>({});
    const [myAwayActive, setMyAwayActive] = useState(false);
    const [editorLocked, setEditorLocked] = useState(false);

    // === Refs ===
    const channelRef = useRef<any>(null);
    const trackedSeatRef = useRef<string | null>(null);
    const typingTimeoutRef = useRef<any>(null);

    // 1. 초기 세션 확인 및 문제 로드
    useEffect(() => {
        const sid = localStorage.getItem('logica_student_id');
        const sname = localStorage.getItem('logica_student_name') || '학생';
        if (!sid) { 
            alert("로그인 세션이 만료되었습니다."); 
            router.push('/student/login'); 
            return; 
        }
        setMyStudentId(sid); 
        setMyName(sname);
        
        // TODO: 실제 DB에서 문제를 불러오는 로직으로 교체 필요
        setDbQuestions([
            { question_id: 'q1', questionText: '1+1은?', answer: '2' },
            { question_id: 'q2', questionText: '2x2는?', answer: '4' },
            { question_id: 'q3', questionText: '10-3은?', answer: '7' }
        ]);
    }, [router]);

    // 2. Supabase Realtime 연결 및 좌석 배정
    useEffect(() => {
        if (!myStudentId) return;

        const connectAndAssignSeat = async () => {
            const channel = supabaseClient.channel(CLINIC_ROOM);
            channelRef.current = channel;

            const allSeats = (await getActiveSeatLayout()).seats.map(s => String(s.number));

            channel.on('presence', { event: 'sync' }, async () => {
                const presenceStateForLock = channel.presenceState();
                setEditorLocked(Object.values(presenceStateForLock).some((metas: any) => metas.some((m: any) => m.role === 'editor')));

                if (trackedSeatRef.current) return;

                const state = channel.presenceState();
                const amIOnline = Object.values(state).flat().some((m: any) => m.studentId === myStudentId);
                if (amIOnline) return;

                const occupied = new Set();
                Object.values(state).forEach((metas: any) => metas.forEach((m: any) => { if (m.seat) occupied.add(m.seat); }));

                const todayStr = getKSTDateString();
                const { data: dbSessions } = await supabaseClient.from('clinic_session_state').select('seat').eq('session_date', todayStr).not('seat', 'is', null);
                dbSessions?.forEach((s: any) => occupied.add(s.seat));

                let targetSeat = null;
                const { data: sessionData } = await supabaseClient.from('clinic_session_state').select('seat').eq('student_id', myStudentId).maybeSingle();
                
                if (sessionData && sessionData.seat) {
                    targetSeat = sessionData.seat;
                } else {
                    targetSeat = allSeats.find(s => !occupied.has(s)) || null;
                    if (targetSeat) {
                        await supabaseClient.from('clinic_session_state').upsert({
                            student_id: myStudentId, session_date: todayStr, seat: targetSeat,
                            started_at: new Date().toISOString(), updated_at: new Date().toISOString()
                        }, { onConflict: 'student_id' });
                    }
                }

                if (targetSeat) {
                    trackedSeatRef.current = targetSeat;
                    setMySeat(targetSeat);
                    channel.track({ seat: targetSeat, name: myName, studentId: myStudentId, updatedAt: Date.now() });
                }
            })
            .on('broadcast', { event: 'ta_action' }, ({ payload }: { payload: any }) => {
                if (payload.seat !== trackedSeatRef.current) return;
                
                if (payload.action === 'move_seat' && payload.newSeat) {
                    trackedSeatRef.current = payload.newSeat;
                    setMySeat(payload.newSeat);
                    channel.track({ seat: payload.newSeat, name: myName, studentId: myStudentId, updatedAt: Date.now() });
                } else if (payload.action === 'force_checkout' || payload.action === 'force_checkout_by_ta') {
                    supabaseClient.from('clinic_session_state').update({ seat: null }).eq('student_id', myStudentId).then();
                    router.push('/student/portal');
                } else if (payload.action === 'force_cancel_call') {
                    // 조교가 강제로 호출을 해제한 경우 클라이언트 상태 업데이트
                    if (payload.qNum) {
                        setCallState(prev => ({ ...prev, [payload.qNum - 1]: false }));
                    }
                } else if (payload.action === 'force_return_to_seat') {
                    setMyAwayActive(false);
                }
            }).subscribe();
        };

        connectAndAssignSeat();

        return () => { if (channelRef.current) supabaseClient.removeChannel(channelRef.current); };
    }, [myStudentId, myName, router]);

    // 3. 문제 변경 시 현재 상태 브로드캐스트
    useEffect(() => {
        if (!isScreenStarted || !channelRef.current || !trackedSeatRef.current || dbQuestions.length === 0) return;
        channelRef.current.send({
            type: 'broadcast', event: 'student_action',
            payload: { seat: trackedSeatRef.current, action: 'update_activity', data: { studentId: myStudentId, name: myName, activity: `${currentQIndex + 1}번 풀이 중`, qNum: currentQIndex + 1 } }
        });
    }, [currentQIndex, isScreenStarted, dbQuestions.length, myStudentId, myName]);

    // === 액션 함수들 ===
    const reportTypingAction = useCallback(() => {
        if (!channelRef.current || !trackedSeatRef.current || typingTimeoutRef.current) return;
        channelRef.current.send({ type: 'broadcast', event: 'student_action', payload: { seat: trackedSeatRef.current, action: 'typing', data: { studentId: myStudentId } } });
        typingTimeoutRef.current = setTimeout(() => { typingTimeoutRef.current = null; }, 1500);
    }, [myStudentId]);

    const sendAction = useCallback((action: string, extraData = {}) => {
        if (!channelRef.current || !trackedSeatRef.current) return;
        channelRef.current.send({ type: 'broadcast', event: 'student_action', payload: { seat: trackedSeatRef.current, action, data: { name: myName, studentId: myStudentId, ...extraData } } });
    }, [myName, myStudentId]);

    const toggleCallTA = useCallback(() => {
        const isCalling = !callState[currentQIndex];
        setCallState(p => ({ ...p, [currentQIndex]: isCalling }));
        sendAction(isCalling ? 'call' : 'cancel_call', { qNum: currentQIndex + 1 });
    }, [callState, currentQIndex, sendAction]);

    const toggleAway = useCallback(() => {
        const isAway = !myAwayActive;
        setMyAwayActive(isAway);
        sendAction(isAway ? 'away' : 'cancel_away');
    }, [myAwayActive, sendAction]);

    const leaveClinic = useCallback(async () => {
        document.body.style.pointerEvents = 'none';
        await supabaseClient.from('clinic_session_state').update({ seat: null }).eq('student_id', myStudentId);
        sendAction('depart');
        if (channelRef.current) await channelRef.current.untrack();
        router.push('/student/portal');
    }, [myStudentId, sendAction, router]);

    const toggleAnswerMode = useCallback(() => {
        setAnswerModes(p => ({ ...p, [currentQIndex]: p[currentQIndex] === 'pen' ? 'keypad' : 'pen' }));
    }, [currentQIndex]);

    return {
        mySeat, myName, isScreenStarted, setIsScreenStarted,
        dbQuestions, currentQIndex, setCurrentQIndex,
        answerModes, keypadAnswers, setKeypadAnswers,
        studentDrawings, setStudentDrawings, studentAnswers, setStudentAnswers,
        callState, myAwayActive, editorLocked,
        toggleCallTA, toggleAway, leaveClinic, toggleAnswerMode, reportTypingAction, sendAction
    };
}