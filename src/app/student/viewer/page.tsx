// src/app/student/viewer/page.tsx
"use client";

import React, { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { useClinicStudent } from './useClinicStudent';

export default function ClinicViewer() {
    // 💡 분리된 로직(Hook)에서 필요한 상태와 함수만 가져옵니다.
    const {
        mySeat, myName, isScreenStarted, setIsScreenStarted,
        dbQuestions, currentQIndex, setCurrentQIndex,
        answerModes, keypadAnswers, setKeypadAnswers,
        studentDrawings, setStudentDrawings, setStudentAnswers,
        callState, myAwayActive, editorLocked,
        toggleCallTA, toggleAway, leaveClinic, toggleAnswerMode, reportTypingAction, sendAction
    } = useClinicStudent();

    // === 캔버스(손글씨) 관련 상태 및 Refs ===
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const isDrawingRef = useRef(false);
    const [penWidth] = useState(3);

    // 💡 MathJax 안전 렌더링 (버그 수정)
    useEffect(() => {
        if (!isScreenStarted || dbQuestions.length === 0) return;
        
        // MathJax가 아직 로드되지 않았을 때 앱이 뻗는 현상을 방지합니다.
        if (typeof window !== 'undefined' && (window as any).MathJax && (window as any).MathJax.typesetPromise) {
            (window as any).MathJax.typesetPromise().catch((err: any) => console.error("MathJax 렌더링 에러:", err));
        }
    }, [currentQIndex, isScreenStarted, dbQuestions]);

    // === 캔버스 셋업 및 그리기 로직 ===
    useEffect(() => {
        if (answerModes[currentQIndex] !== 'pen' || !dbQuestions[currentQIndex]) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        
        // 캔버스 해상도 선명하게 유지
        canvas.width = rect.width * dpr; 
        canvas.height = rect.height * dpr;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.scale(dpr, dpr); 
        ctx.lineCap = 'round'; 
        ctx.lineJoin = 'round'; 
        ctx.strokeStyle = '#1C2530'; 
        ctx.lineWidth = penWidth;
        ctxRef.current = ctx;

        // 이전에 그렸던 그림이 있다면 복원
        const saved = studentDrawings[currentQIndex];
        if (saved) {
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
            img.src = saved;
        }
    }, [currentQIndex, answerModes, penWidth, studentDrawings]);

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
        
        // 그림 데이터를 저장하여 상태 동기화
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

    // ==========================================
    // 렌더링 영역
    // ==========================================
    if (!isScreenStarted) {
        return (
            <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50">
                <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg text-center animate-[fadeIn_0.3s_ease-out]">
                    <div className="text-4xl font-black text-[#002864] mb-4 tracking-tighter">Logica Clinic</div>
                    <button onClick={() => setIsScreenStarted(true)} className="w-full bg-[#002864] text-white font-bold py-4 rounded-xl shadow-md transition-all hover:bg-blue-900">
                        🚀 오답 풀이 시작하기
                    </button>
                </div>
            </div>
        );
    }

    const q = dbQuestions[currentQIndex];
    if (!q) return <div className="h-screen flex items-center justify-center text-slate-500 font-bold">문제를 불러오는 중입니다...</div>;

    return (
        <div className="bg-slate-100 h-screen flex flex-col font-pretendard">
            {editorLocked && (
                <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[999] flex items-center justify-center px-6">
                    <div className="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-sm">
                        <div className="text-4xl mb-3">🔒</div>
                        <h3 className="text-lg font-extrabold text-slate-800 mb-2">좌석 배치 수정 중입니다</h3>
                        <p className="text-sm text-slate-500">관리자가 좌석 배치를 편집하는 동안에는<br />클리닉 기능이 잠시 멈춥니다. 잠시만 기다려주세요.</p>
                    </div>
                </div>
            )}
            {/* 수식 렌더링 스크립트 */}
            <Script id="mathjax" src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js" strategy="lazyOnload" />
            
            {/* 상단 헤더 */}
            <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center shrink-0 z-10 relative">
                <div className="flex items-center gap-4">
                    <div className="text-2xl font-black text-[#002864] tracking-tighter">Logica</div>
                    <div className="w-px h-6 bg-slate-300"></div>
                    <h1 className="text-lg font-bold text-slate-800">[{mySeat || '배정중'}] {myName}의 맞춤 클리닉</h1>
                </div>
                <div className="flex items-center gap-4">
                    <button onClick={leaveClinic} className="text-sm font-bold text-slate-400 hover:text-rose-500 transition-colors">나가기</button>
                </div>
            </header>

            <main className="flex-1 overflow-hidden p-6 flex justify-center">
                <div className="w-full max-w-6xl grid grid-cols-10 gap-6 h-full relative">
                    
                    {/* 좌측 문제 패널 */}
                    <div className="col-span-7 flex flex-col gap-4 overflow-hidden">
                        {/* 문항 번호 네비게이션 */}
                        <div className="bg-white rounded-2xl shadow-sm p-4 flex gap-2 overflow-x-auto border border-slate-200 shrink-0" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                            {dbQuestions.map((_, idx) => (
                                <button key={idx} onClick={() => setCurrentQIndex(idx)} 
                                        className={`w-11 h-11 shrink-0 border-2 rounded-xl font-bold transition-colors shadow-sm ${currentQIndex === idx ? 'bg-[#002864] text-white border-[#002864]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                    {idx + 1}
                                </button>
                            ))}
                        </div>

                        {/* 실제 문제 뷰어 */}
                        <div className="bg-white rounded-2xl shadow-sm flex flex-col flex-1 border border-slate-200 overflow-hidden">
                            <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
                                <span className="text-2xl font-black text-[#002864] w-14 tracking-tighter">{String(currentQIndex + 1).padStart(2, '0')}</span>
                            </div>
                            {/* MathJax를 통해 수식이 렌더링 될 영역 */}
                            <div className="flex-1 overflow-y-auto p-8 text-slate-800 text-lg leading-relaxed font-medium" dangerouslySetInnerHTML={{ __html: q.questionText }}></div>
                        </div>
                    </div>

                    {/* 우측 정답 입력 및 컨트롤 패널 */}
                    <div className="col-span-3 flex flex-col gap-4">
                        
                        {/* 정답 입력 영역 */}
                        <div className="bg-white rounded-2xl p-5 flex-1 flex flex-col shadow-sm border border-slate-200 overflow-hidden">
                            <div className="flex justify-between items-center mb-3 shrink-0">
                                <h3 className="font-bold text-sm text-slate-700">정답 입력</h3>
                                <button onClick={toggleAnswerMode} className="text-[11px] font-bold text-[#002864] bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors border border-indigo-100 shadow-sm">
                                    {answerModes[currentQIndex] === 'pen' ? '🔢 키패드로 변경' : '✍️ 손글씨로 변경'}
                                </button>
                            </div>
                            
                            {answerModes[currentQIndex] === 'pen' ? (
                                <canvas 
                                    ref={canvasRef} 
                                    onPointerDown={handlePointerDown} 
                                    onPointerMove={handlePointerMove} 
                                    onPointerUp={handlePointerUp} 
                                    onPointerLeave={handlePointerUp}
                                    className="w-full flex-1 rounded-xl border-2 border-slate-200 cursor-crosshair touch-none bg-slate-50 shadow-inner" 
                                />
                            ) : (
                                <input 
                                    type="text" 
                                    onChange={handleKeypadInput} 
                                    value={keypadAnswers[currentQIndex] || ''} 
                                    className="w-full text-3xl font-black text-center px-4 py-6 border-2 border-slate-200 rounded-xl focus:border-[#002864] focus:ring-4 focus:ring-blue-100 outline-none transition-all shadow-inner" 
                                    placeholder="정답 입력" 
                                />
                            )}
                        </div>
                        
                        {/* 하단 액션 버튼들 */}
                        <div className="flex flex-col gap-3 shrink-0">
                            <button onClick={() => sendAction('submit', { score: 100 })} className="w-full bg-[#002864] hover:bg-[#001b44] text-white font-extrabold text-lg py-4 rounded-xl shadow-md transition-colors border-b-4 border-[#001330] active:border-b-0 active:translate-y-1">
                                ✅ 답안 제출하기
                            </button>
                            
                            <div className="flex gap-3">
                                <button onClick={toggleCallTA} className={`flex-1 font-extrabold text-base py-3.5 rounded-xl shadow-sm transition-colors border-b-4 active:border-b-0 active:translate-y-1 ${callState[currentQIndex] ? 'bg-rose-600 text-white border-rose-800' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
                                    {callState[currentQIndex] ? '🚨 호출 취소' : '🙋 조교 호출'}
                                </button>
                                <button onClick={toggleAway} className={`flex-1 font-extrabold text-base py-3.5 rounded-xl shadow-sm transition-colors border-b-4 active:border-b-0 active:translate-y-1 ${myAwayActive ? 'bg-amber-500 text-white border-amber-700' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
                                    {myAwayActive ? '🚶 자리 복귀' : '🚻 자리 비움'}
                                </button>
                            </div>
                        </div>

                    </div>
                </div>
            </main>
        </div>
    );
}