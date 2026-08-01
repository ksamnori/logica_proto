"use client";

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import Script from 'next/script';
import { useRouter } from 'next/navigation';

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
const ROUND1_TIME_LIMIT_SECONDS = 20 * 60;

const SEAT_ROWS = ['A', 'B', 'C', 'D', 'E', 'F'];
const SEAT_COLS = 10;
const ALL_SEATS = SEAT_ROWS.flatMap(r => Array.from({ length: SEAT_COLS }, (_, i) => `${r}-${String(i + 1).padStart(2, '0')}`));

const getKSTDateString = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

export default function ClinicViewer() {
    const router = useRouter();

    const [myStudentId, setMyStudentId] = useState<string>('');
    const [myName, setMyName] = useState<string>('');
    const [mySeat, setMySeat] = useState<string | null>(null);
    const [isScreenStarted, setIsScreenStarted] = useState(false);
    
    const [dbQuestions, setDbQuestions] = useState<any[]>([]);
    const [currentQIndex, setCurrentQIndex] = useState(0);
    
    const [studentAnswers, setStudentAnswers] = useState<Record<number, string | null>>({});
    const [keypadAnswers, setKeypadAnswers] = useState<Record<number, string>>({});
    const [studentDrawings, setStudentDrawings] = useState<Record<number, string>>({});
    const [answerModes, setAnswerModes] = useState<Record<number, 'pen' | 'keypad'>>({});
    const [callState, setCallState] = useState<Record<number, boolean>>({});
    const [myAwayActive, setMyAwayActive] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const isDrawingRef = useRef(false);
    const [penWidth, setPenWidth] = useState(3);
    
    const channelRef = useRef<any>(null);
    const trackedSeatRef = useRef<string | null>(null);
    const sessionDurationRef = useRef(DEFAULT_CLINIC_SESSION_DURATION_MS);
    const sessionStartedAtRef = useRef(Date.now());
    const typingTimeoutRef = useRef<any>(null);

    useEffect(() => {
        const sid = localStorage.getItem('logica_student_id');
        const sname = localStorage.getItem('logica_student_name') || '학생';
        if (!sid) { alert("로그인 세션이 만료되었습니다."); router.push('/student/login'); return; }
        setMyStudentId(sid); setMyName(sname);
        
        setDbQuestions([
            { question_id: 'q1', questionText: '1+1은?', answer: '2' },
            { question_id: 'q2', questionText: '2x2는?', answer: '4' },
            { question_id: 'q3', questionText: '10-3은?', answer: '7' }
        ]);
    }, [router]);

    useEffect(() => {
        if (!myStudentId) return;

        const connectAndAssignSeat = async () => {
            const channel = supabaseClient.channel(CLINIC_ROOM);
            channelRef.current = channel;

            channel.on('presence', { event: 'sync' }, async () => {
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
                    targetSeat = ALL_SEATS.find(s => !occupied.has(s)) || null;
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
                    supabaseClient.from('clinic_session_state').update({ seat: payload.newSeat }).eq('student_id', myStudentId).then();
                    channel.track({ seat: payload.newSeat, name: myName, studentId: myStudentId, updatedAt: Date.now() });
                } else if (payload.action === 'force_checkout' || payload.action === 'force_checkout_by_ta') {
                    supabaseClient.from('clinic_session_state').update({ seat: null }).eq('student_id', myStudentId).then();
                    router.push('/student/portal');
                }
            }).subscribe();
        };

        connectAndAssignSeat();

        return () => { if (channelRef.current) supabaseClient.removeChannel(channelRef.current); };
    }, [myStudentId, myName, router]);

    useEffect(() => {
        if (!isScreenStarted || !channelRef.current || !trackedSeatRef.current || dbQuestions.length === 0) return;
        channelRef.current.send({
            type: 'broadcast', event: 'student_action',
            payload: { seat: trackedSeatRef.current, action: 'update_activity', data: { studentId: myStudentId, name: myName, activity: `${currentQIndex + 1}번 풀이 중`, qNum: currentQIndex + 1 } }
        });
        if ((window as any).MathJax) (window as any).MathJax.typesetPromise();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentQIndex, isScreenStarted, dbQuestions.length]);

    const reportTypingAction = () => {
        if (!channelRef.current || !trackedSeatRef.current) return;
        if (typingTimeoutRef.current) return;
        channelRef.current.send({ type: 'broadcast', event: 'student_action', payload: { seat: trackedSeatRef.current, action: 'typing', data: { studentId: myStudentId } } });
        typingTimeoutRef.current = setTimeout(() => { typingTimeoutRef.current = null; }, 1500);
    };

    const sendAction = (action: string, extraData = {}) => {
        if (!channelRef.current || !trackedSeatRef.current) return;
        channelRef.current.send({ type: 'broadcast', event: 'student_action', payload: { seat: trackedSeatRef.current, action, data: { name: myName, studentId: myStudentId, ...extraData } } });
    };

    const toggleCallTA = () => {
        const isCalling = !callState[currentQIndex];
        setCallState(p => ({ ...p, [currentQIndex]: isCalling }));
        sendAction(isCalling ? 'call' : 'cancel_call', { qNum: currentQIndex + 1 });
    };

    const toggleAway = () => {
        const isAway = !myAwayActive;
        setMyAwayActive(isAway);
        sendAction(isAway ? 'away' : 'cancel_away');
    };

    const leaveClinic = async () => {
        document.body.style.pointerEvents = 'none';
        await supabaseClient.from('clinic_session_state').update({ seat: null }).eq('student_id', myStudentId);
        sendAction('depart');
        if (channelRef.current) await channelRef.current.untrack();
        router.push('/student/portal');
    };

    useEffect(() => {
        if (answerModes[currentQIndex] !== 'pen' || !dbQuestions[currentQIndex]) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1C2530'; ctx.lineWidth = penWidth;
        ctxRef.current = ctx;

        const saved = studentDrawings[currentQIndex];
        if (saved) {
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
            img.src = saved;
        }
    }, [currentQIndex, answerModes, penWidth]);

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!ctxRef.current || !canvasRef.current) return;
        isDrawingRef.current = true;
        const rect = canvasRef.current.getBoundingClientRect();
        ctxRef.current.beginPath();
        ctxRef.current.moveTo(e.clientX - rect.left, e.clientY - rect.top);
        reportTypingAction();
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawingRef.current || !ctxRef.current || !canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        ctxRef.current.lineTo(e.clientX - rect.left, e.clientY - rect.top);
        ctxRef.current.stroke();
    };

    const handlePointerUp = () => {
        if (!isDrawingRef.current || !canvasRef.current) return;
        isDrawingRef.current = false;
        const dataUrl = canvasRef.current.toDataURL('image/png');
        setStudentDrawings(p => ({ ...p, [currentQIndex]: dataUrl }));
        setStudentAnswers(p => ({ ...p, [currentQIndex]: dataUrl }));
    };

    const handleKeypadInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setKeypadAnswers(p => ({ ...p, [currentQIndex]: val }));
        setStudentAnswers(p => ({ ...p, [currentQIndex]: val }));
        reportTypingAction();
    };

    const toggleAnswerMode = () => {
        const mode = answerModes[currentQIndex] === 'pen' ? 'keypad' : 'pen';
        setAnswerModes(p => ({ ...p, [currentQIndex]: mode }));
    };

    if (!isScreenStarted) {
        return (
            <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50">
                <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg text-center">
                    <div className="text-4xl font-black text-[#002864] mb-4">Logica Clinic</div>
                    <button onClick={() => setIsScreenStarted(true)} className="w-full bg-[#002864] text-white font-bold py-4 rounded-xl shadow-md transition-all hover:scale-105">
                        🚀 오답 풀이 시작하기
                    </button>
                </div>
            </div>
        );
    }

    const q = dbQuestions[currentQIndex];
    if (!q) return null;

    return (
        <div className="bg-slate-100 h-screen flex flex-col">
            <Script id="mathjax" src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js" strategy="lazyOnload" />
            
            <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-4">
                    <div className="text-2xl font-bold text-[#002864] tracking-tighter">Logica</div>
                    <div className="w-px h-6 bg-slate-300"></div>
                    <h1 className="text-lg font-bold text-slate-800">[{mySeat || '배정중'}] {myName}의 맞춤 클리닉</h1>
                </div>
                <div className="flex items-center gap-4">
                    <button onClick={leaveClinic} className="text-sm font-bold text-slate-400 hover:text-slate-600">나가기</button>
                </div>
            </header>

            <main className="flex-1 overflow-hidden p-6 flex justify-center">
                <div className="w-full max-w-6xl grid grid-cols-10 gap-6 h-full relative">
                    <div className="col-span-7 flex flex-col gap-4">
                        <div className="bg-white rounded-2xl shadow-md p-4 flex gap-2 overflow-x-auto border border-slate-200" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                            {dbQuestions.map((_, idx) => (
                                <button key={idx} onClick={() => setCurrentQIndex(idx)} 
                                        className={`w-10 h-10 shrink-0 border-2 rounded-lg font-bold transition-colors ${currentQIndex === idx ? 'bg-[#002864] text-white border-[#002864]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                    {idx + 1}
                                </button>
                            ))}
                        </div>

                        <div className="bg-white rounded-2xl shadow-md flex flex-col flex-1 border border-slate-200 overflow-hidden">
                            <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                <span className="text-3xl font-extrabold text-[#002864] w-14">{String(currentQIndex + 1).padStart(2, '0')}</span>
                            </div>
                            <div className="flex-1 overflow-y-auto p-8 text-slate-800 text-lg leading-relaxed" dangerouslySetInnerHTML={{ __html: q.questionText }}></div>
                        </div>
                    </div>

                    <div className="col-span-3 flex flex-col gap-4">
                        <div className="bg-white rounded-2xl p-4 flex-1 flex flex-col shadow-md">
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="font-bold text-sm text-slate-700">정답 입력</h3>
                                <button onClick={toggleAnswerMode} className="text-[10px] font-bold text-[#002864] bg-blue-50 px-2 py-1 rounded">
                                    {answerModes[currentQIndex] === 'pen' ? '🔢 키패드' : '✍️ 손글씨'}
                                </button>
                            </div>
                            {answerModes[currentQIndex] === 'pen' ? (
                                <canvas ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
                                        className="w-full flex-1 rounded-xl border-2 border-slate-300 cursor-crosshair touch-none bg-white" />
                            ) : (
                                <input type="text" onChange={handleKeypadInput} value={keypadAnswers[currentQIndex] || ''} className="w-full text-2xl font-extrabold text-right px-3 py-4 border-2 border-slate-200 rounded-lg focus:border-[#002864] outline-none" placeholder="0" />
                            )}
                        </div>
                        <div className="flex gap-3 mt-auto shrink-0">
                            <button onClick={() => sendAction('submit', { score: 100 })} className="flex-1 bg-[#002864] hover:bg-blue-900 text-white font-extrabold text-lg py-4 rounded-xl shadow-md transition-colors">✅ 제출</button>
                            <button onClick={toggleCallTA} className={`flex-1 font-extrabold text-lg py-4 rounded-xl shadow-md transition-colors ${callState[currentQIndex] ? 'bg-rose-700 text-white' : 'bg-rose-500 text-white'}`}>
                                {callState[currentQIndex] ? '🚨 취소' : '🙋 호출'}
                            </button>
                            <button onClick={toggleAway} className={`px-4 font-bold text-sm rounded-xl shadow-md transition-colors ${myAwayActive ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-slate-300 text-slate-600'}`}>
                                {myAwayActive ? '복귀' : '비움'}
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}