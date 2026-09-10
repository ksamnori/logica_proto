// src/app/supervisor/page.tsx
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSupervisorData } from './useSupervisorData';
import { formatDuration } from './supervisorUtils';
import { supabaseClient } from './supervisorUtils';
import LeftPanel from './LeftPanel';
import SeatGrid from './SeatGrid';
import SeatCardBody from './SeatCardBody';

// 🌟 재사용 가능한 MathText 컴포넌트 추가
const MathText = React.memo(function MathText({ html, className }: { html: string; className?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const mj = (window as any).MathJax;
        if (mj && mj.typesetPromise && ref.current) {
            mj.typesetPromise([ref.current]).catch((err: any) => console.error("MathJax 에러:", err));
        }
    }, [html]);
    return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

export default function SupervisorDashboard() {
    const router = useRouter();
    const supervisorData = useSupervisorData();
    const {
        isAuthorized, authMessage,
        now, startedAt, connectionStatus, isMounted,
        activeStudents, activeTAs, logs,
        draggedSeat, draggedListStudent, taAction, ghostRect,
        seats, editorLocked,
        pendingVerifications
    } = supervisorData;

    const [instructorInfo, setInstructorInfo] = useState({ name: '', position: '' });
    
    const [isVerificationListOpen, setIsVerificationListOpen] = useState(false);
    const [verifyingExam, setVerifyingExam] = useState<any | null>(null);
    const [verifyingAnswers, setVerifyingAnswers] = useState<any[]>([]);
    const [verificationOverrides, setVerificationOverrides] = useState<Record<string, boolean>>({});
    const [isVerifying, setIsVerifying] = useState(false);

    // 🌟 학생 호출 처리 모달 상태
    const [callProcessModal, setCallProcessModal] = useState<{ isOpen: boolean, seat: string, qNum: any, callInfo: any } | null>(null);

    const mathJaxRef = useRef(false);
    const initMathJax = () => {
        if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
            mathJaxRef.current = true;
            (window as any).MathJax = {
                tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]], processEscapes: true },
                chtml: { displayAlign: 'left' }
            };
            const script = document.createElement("script");
            script.id = "MathJax-script";
            script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
            script.async = true;
            document.head.appendChild(script);
        }
    };

    useEffect(() => {
        initMathJax();
    }, []);

    useEffect(() => {
        setInstructorInfo({
            name: localStorage.getItem('logica_instructor_name') || '원장/실장',
            position: localStorage.getItem('logica_instructor_position') || '관리자'
        });
    }, []);

    // MathJax 완벽 렌더링을 위해 의존성에 callProcessModal 추가
    useEffect(() => {
        if (verifyingAnswers.length > 0 || callProcessModal) {
            const timer = setTimeout(() => {
                const mj = (window as any).MathJax;
                if (mj && mj.typesetPromise) {
                    mj.typesetClear(); 
                    mj.typesetPromise().catch((err: any) => console.error("MathJax 에러:", err));
                }
            }, 300); 
            return () => clearTimeout(timer);
        }
    }, [verifyingAnswers, verifyingExam, callProcessModal]);

    // 🌟 수동 수식 새로고침 함수
    const forceMathRefresh = () => {
        const mj = (window as any).MathJax;
        if (mj && mj.typesetPromise) {
            mj.typesetClear();
            mj.typesetPromise().catch((err: any) => console.error("MathJax 강제 새로고침 에러:", err));
        }
    };

    const openVerificationModal = async (exam: any) => {
        setIsVerifying(true);
        try {
            const { data: answers } = await supabaseClient.from('student_answer')
                .select('*')
                .eq('exam_assignment_id', exam.assignment_id)
                .eq('is_correct', false)
                .order('question_id', { ascending: true });
            
            if (!answers || answers.length === 0) {
                setVerifyingAnswers([]);
                setVerifyingExam(exam);
                setIsVerifying(false);
                return;
            }

            const { data: assignmentRecord } = await supabaseClient.from('exam_assignment').select('exam_id').eq('assignment_id', exam.assignment_id).maybeSingle();
            let qIds = answers.map(a => a.question_id).filter(Boolean);

            if (assignmentRecord?.exam_id) {
                const { data: items } = await supabaseClient.from('exam_item').select('question_id, tq_id').eq('exam_id', assignmentRecord.exam_id);
                if (items) {
                    items.forEach(i => {
                        if (i.question_id) qIds.push(i.question_id);
                        if (i.tq_id) qIds.push(i.tq_id);
                    });
                }
            }
            qIds = Array.from(new Set(qIds));

            const qMap: any = {};
            
            if (qIds.length > 0) {
                const fetchSafe = async (query: any) => {
                    try { const res = await query; return res.data || []; } 
                    catch (e) { return []; }
                };

                const [tqByTqId, tqByQid] = await Promise.all([
                    fetchSafe(supabaseClient.from('textbook_question').select('*').in('tq_id', qIds)),
                    fetchSafe(supabaseClient.from('textbook_question').select('*').in('question_id', qIds))
                ]);
                
                const tqRecords = [...tqByTqId, ...tqByQid];
                
                const realQIds = new Set(qIds);
                tqRecords.forEach(tq => {
                    if (tq.question_id) realQIds.add(tq.question_id);
                });

                const qDbRecords = await fetchSafe(supabaseClient.from('question_db').select('*').in('question_id', Array.from(realQIds)));
                
                const qDbMap = new Map();
                qDbRecords.forEach((q: any) => qDbMap.set(String(q.question_id), q));

                const tqMapByTqId = new Map();
                const tqMapByQid = new Map();
                tqRecords.forEach((tq: any) => {
                    tqMapByTqId.set(String(tq.tq_id), tq);
                    tqMapByQid.set(String(tq.question_id), tq);
                });

                const parseVal = (val: any) => (!val || val === 'null' || val === 'undefined') ? '' : String(val).trim();

                qIds.forEach(id => {
                    const strId = String(id);
                    let tqBase = tqMapByTqId.get(strId) || tqMapByQid.get(strId);
                    let qDbBase = qDbMap.get(strId);

                    if (tqBase && tqBase.question_id) {
                        qDbBase = qDbMap.get(String(tqBase.question_id)) || qDbBase;
                    }

                    const fallbackDb = qDbBase || {};
                    const fallbackTq = tqBase || {};

                    let rawImgUrl = parseVal(fallbackDb.image_url) || parseVal(fallbackDb.image_2_url);
                    let finalImgUrl = '';
                    
                    if (rawImgUrl) {
                        if (rawImgUrl.startsWith('http') || rawImgUrl.startsWith('data:')) {
                            finalImgUrl = rawImgUrl;
                        } else {
                            const { data } = supabaseClient.storage.from('question_images').getPublicUrl(rawImgUrl);
                            finalImgUrl = data.publicUrl;
                        }
                    }

                    qMap[strId] = {
                        questionText: parseVal(fallbackTq.question) || parseVal(fallbackDb.question) || parseVal(fallbackDb.question_text),
                        imageUrl: finalImgUrl,
                        correctAnswer: parseVal(fallbackTq.answer) || parseVal(fallbackDb.answer)
                    };
                });
            }
            
            const merged = answers.map(a => {
                const cleanInput = a.student_input ? String(a.student_input).replace(/^"|"$/g, '').trim() : '';
                const isDrawing = cleanInput.includes('data:image');
                const searchId = String(a.question_id);
                const info = qMap[searchId] || {};
                
                return {
                    ...a,
                    cleanInput,
                    isDrawing,
                    questionText: info.questionText || '',
                    imageUrl: info.imageUrl || '',
                    correctAnswer: info.correctAnswer || ''
                };
            });
            
            setVerifyingAnswers(merged);
        } catch (err) {
            console.error("검수 데이터 로드 에러:", err);
            setVerifyingAnswers([]);
        }
        
        setVerificationOverrides({});
        setVerifyingExam(exam);
        setIsVerifying(false);
    };

    const handleLogout = () => {
        if (window.confirm('로그아웃 하시겠습니까?')) {
            localStorage.removeItem('logica_instructor_id');
            localStorage.removeItem('logica_instructor_role');
            localStorage.removeItem('logica_instructor_position');
            localStorage.removeItem('logica_instructor_name');
            router.push('/');
        }
    };

    if (isAuthorized === null) {
        return (
            <div className="h-screen flex items-center justify-center bg-slate-200 font-['Pretendard']">
                <div className="bg-white p-8 rounded-2xl shadow-xl w-96 text-center border border-slate-200">
                    <div className="animate-spin text-4xl mb-4">⏳</div>
                    <h2 className="text-xl font-extrabold text-slate-800 mb-2">권한 확인 중</h2>
                    <p className="text-sm text-slate-500 font-bold">{authMessage}</p>
                </div>
            </div>
        );
    }

    if (isAuthorized === false) {
        return (
            <div className="h-screen flex items-center justify-center bg-slate-200 font-['Pretendard']">
                <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center border border-slate-200">
                    <div className="text-5xl mb-4">⛔</div>
                    <h2 className="text-2xl font-extrabold text-rose-600 mb-2">접근 권한 없음</h2>
                    <p className="text-sm text-slate-600 mb-6 font-bold leading-relaxed">{authMessage}</p>
                    <p className="text-xs text-slate-400 mb-6">수퍼바이저 대시보드는 <span className="text-[#002864] font-extrabold">최고관리자</span>, <span className="text-[#002864] font-extrabold">원장</span> 및 <span className="text-[#002864] font-extrabold">실장</span> 권한만 접속할 수 있습니다.</p>
                    <button onClick={() => window.history.back()} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 rounded-lg shadow-md transition-colors">이전 화면으로 돌아가기</button>
                </div>
            </div>
        );
    }

    const studentCount = Object.keys(activeStudents).length;
    const vacantCount = Math.max(0, seats.length - studentCount);
    let callingCount = 0, hintingCount = 0, awayCount = 0, timeUrgentCount = 0;

    Object.values(activeStudents).forEach((st: any) => {
        if (st.status === 'away') awayCount++;
        if (st.status === 'hint') hintingCount++;
        if (st.firstSeenAt && st.clinicDurationMs && (st.firstSeenAt + st.clinicDurationMs) - now <= 5 * 60 * 1000) timeUrgentCount++;
        if (st.calls && Object.keys(st.calls).length > 0) callingCount++;
    });

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-slate-200 font-['Pretendard'] relative">
            
            {pendingVerifications.length > 0 && !verifyingExam && !isVerificationListOpen && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-[fadeIn_0.3s_ease-out]">
                    <button 
                        onClick={() => setIsVerificationListOpen(true)} 
                        className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-3.5 rounded-full font-black shadow-[0_8px_30px_rgba(245,158,11,0.5)] animate-bounce flex items-center gap-3 transition-colors border-2 border-white/20"
                    >
                        <span className="text-xl">🚨</span> 
                        <span>{pendingVerifications.length}건의 테스트 채점 검수 대기중!</span>
                    </button>
                </div>
            )}

            {isVerificationListOpen && !verifyingExam && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9998] flex items-center justify-center p-4 md:p-8 animate-[fadeIn_0.2s_ease-out]">
                    <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
                        <div className="bg-amber-500 text-white px-6 py-5 flex justify-between items-center shrink-0">
                            <h2 className="text-xl font-black flex items-center gap-2"><span className="text-2xl">🚨</span> 채점 검수 대기 목록</h2>
                            <button onClick={() => setIsVerificationListOpen(false)} className="text-white/70 hover:text-white text-3xl font-black transition-colors">&times;</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 bg-slate-50 custom-scroll">
                            {pendingVerifications.length === 0 ? (
                                <div className="text-center py-10 text-slate-500 font-bold">대기 중인 검수 항목이 없습니다.</div>
                            ) : pendingVerifications.map(exam => (
                                <div key={exam.assignment_id} className="flex justify-between items-center p-4 m-2 bg-white rounded-xl shadow-sm border border-slate-200 hover:border-amber-300 transition-colors">
                                    <div>
                                        <p className="font-black text-slate-800 text-lg">{exam.studentName} <span className="text-sm font-bold text-slate-500">학생</span></p>
                                        <p className="text-xs font-bold text-slate-400 mt-1">{exam.examTitle}</p>
                                    </div>
                                    <button 
                                        onClick={() => { setIsVerificationListOpen(false); openVerificationModal(exam); }} 
                                        className="bg-[#002864] hover:bg-blue-900 text-white px-5 py-2.5 rounded-lg text-sm font-black shadow-md transition-colors"
                                    >
                                        검수하기
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {verifyingExam && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 md:p-8 animate-[fadeIn_0.2s_ease-out]">
                    <div className="bg-slate-100 rounded-[2rem] shadow-2xl w-full max-w-5xl h-full max-h-[90vh] flex flex-col overflow-hidden">
                        <div className="bg-[#002864] text-white px-8 py-5 flex justify-between items-center shrink-0">
                            <div>
                                <h2 className="text-2xl font-black">📝 {verifyingExam.studentName} 학생 테스트 오답 검수</h2>
                                <p className="text-sm font-bold text-blue-200 mt-1">{verifyingExam.examTitle}</p>
                            </div>
                            {/* 🌟 수식 새로고침 버튼 추가 */}
                            <div className="flex items-center gap-4">
                                <button onClick={forceMathRefresh} className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg text-sm font-bold transition-colors">
                                    <span>🔄</span> 수식 깨짐 해결
                                </button>
                                <button onClick={() => setVerifyingExam(null)} className="text-white/70 hover:text-white text-4xl font-black transition-colors">&times;</button>
                            </div>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scroll">
                            {verifyingAnswers.length === 0 ? (
                                <div className="text-center py-20 flex flex-col items-center">
                                    <span className="text-6xl mb-4">💯</span>
                                    <span className="text-slate-500 font-extrabold text-xl">가채점 결과 모두 정답입니다! (오답 없음)</span>
                                </div>
                            ) : verifyingAnswers.map((ans, idx) => {
                                const isOverridden = verificationOverrides[ans.answer_id] === true;
                                return (
                                    <div key={ans.answer_id} className={`bg-white rounded-2xl shadow-sm border-[3px] overflow-hidden flex flex-col md:flex-row transition-colors ${isOverridden ? 'border-emerald-400' : 'border-rose-200'}`}>
                                        <div className="w-full md:w-2/3 p-6 relative bg-white border-b md:border-b-0 md:border-r border-slate-100 min-h-[300px] flex flex-col justify-start items-start">
                                            <div className="relative w-full max-w-full z-10 text-lg">
                                                {/* 🌟 MathText 컴포넌트로 교체 완료 */}
                                                {ans.questionText ? (
                                                    <MathText className="font-bold text-slate-800 leading-relaxed font-myungjo" html={ans.questionText} />
                                                ) : (
                                                    <div className="text-sm font-bold text-slate-400 bg-slate-50 p-4 rounded-xl border border-slate-200 text-center">
                                                        [문제 텍스트 데이터가 없습니다]
                                                    </div>
                                                )}
                                                
                                                {ans.imageUrl && ans.imageUrl !== '' && (
                                                    <img src={ans.imageUrl} className="max-w-full rounded-lg mt-4 shadow-sm" alt="문제 원본 이미지" />
                                                )}
                                            </div>
                                            
                                            {ans.isDrawing && (
                                                <img src={ans.cleanInput} className="absolute top-0 left-0 w-full h-full object-contain object-top pointer-events-none opacity-90 mix-blend-multiply z-20 p-6" alt="학생 손글씨" />
                                            )}
                                        </div>

                                        <div className="w-full md:w-1/3 p-6 flex flex-col justify-between bg-slate-50">
                                            <div className="flex flex-col gap-4">
                                                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                                    <span className="text-xs font-black text-slate-400 block mb-1">학생 입력 답안</span>
                                                    {ans.isDrawing ? (
                                                        <span className="inline-block px-3 py-1 bg-slate-100 text-slate-600 font-bold rounded-lg text-sm">✍️ 손글씨 풀이 (좌측 확인)</span>
                                                    ) : (
                                                        <span className="inline-block px-3 py-1 bg-slate-100 text-slate-800 font-black rounded-lg text-lg truncate max-w-full" title={ans.cleanInput}>{ans.cleanInput || '미입력'}</span>
                                                    )}
                                                </div>
                                                <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 shadow-sm overflow-hidden">
                                                    <span className="text-xs font-black text-emerald-600 block mb-1">실제 정답</span>
                                                    {/* 🌟 MathText 컴포넌트로 교체 완료 */}
                                                    {ans.correctAnswer ? (
                                                        <MathText className="inline-block font-black text-emerald-800 text-lg leading-tight font-myungjo" html={ans.correctAnswer} />
                                                    ) : (
                                                        <span className="inline-block font-black text-emerald-600 text-sm opacity-60">정답 데이터 없음</span>
                                                    )}
                                                </div>
                                            </div>
                                            
                                            <div className="mt-6 flex flex-col gap-2">
                                                <button 
                                                    onClick={() => setVerificationOverrides(p => ({ ...p, [ans.answer_id]: true }))}
                                                    className={`w-full py-3.5 rounded-xl font-black text-lg transition-all ${isOverridden ? 'bg-emerald-500 text-white shadow-md ring-2 ring-emerald-300 ring-offset-2' : 'bg-white border-2 border-slate-200 text-slate-500 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600'}`}
                                                >✅ 정답으로 인정</button>
                                                <button 
                                                    onClick={() => setVerificationOverrides(p => { const next = {...p}; delete next[ans.answer_id]; return next; })}
                                                    className={`w-full py-3.5 rounded-xl font-black text-lg transition-all ${!isOverridden ? 'bg-rose-500 text-white shadow-md ring-2 ring-rose-300 ring-offset-2' : 'bg-white border-2 border-slate-200 text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600'}`}
                                                >❌ 오답 유지</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        
                        <div className="bg-white p-6 border-t border-slate-200 flex justify-end gap-3 shrink-0 rounded-b-[2rem]">
                            <button onClick={() => setVerifyingExam(null)} className="px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-colors">나중에 검수하기 (목록으로)</button>
                            <button onClick={async () => {
                                setIsVerifying(true);
                                await supervisorData.confirmVerification(verifyingExam.assignment_id, verifyingExam.student_id, verificationOverrides);
                                setVerifyingExam(null);
                                setIsVerifying(false);
                            }} disabled={isVerifying} className="px-10 py-4 bg-[#002864] hover:bg-blue-900 text-white text-lg font-black rounded-xl shadow-lg transition-colors flex items-center gap-2 disabled:opacity-50">
                                {isVerifying ? '처리 중...' : '최종 확정 및 오답 클리닉 개방'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 호출 상세 처리 모달 */}
            {callProcessModal && callProcessModal.isOpen && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 md:p-8 animate-[fadeIn_0.2s_ease-out]">
                    <div className="bg-slate-100 rounded-[2rem] shadow-2xl w-full max-w-4xl h-full max-h-[85vh] flex flex-col overflow-hidden">
                        <div className="bg-rose-600 text-white px-8 py-5 flex justify-between items-center shrink-0">
                            <h2 className="text-2xl font-black">🙋 {activeStudents[callProcessModal.seat]?.name || '학생'} 질문 상세 보기</h2>
                            {/* 🌟 수식 새로고침 버튼 추가 */}
                            <div className="flex items-center gap-4">
                                <button onClick={forceMathRefresh} className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg text-sm font-bold transition-colors">
                                    <span>🔄</span> 수식 깨짐 해결
                                </button>
                                <button onClick={() => setCallProcessModal(null)} className="text-white/70 hover:text-white text-4xl font-black transition-colors">&times;</button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-4 custom-scroll bg-white">
                            <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
                                <span className="text-xl font-extrabold text-rose-600">{callProcessModal.seat} <span className="text-base text-slate-400 font-bold ml-1">좌석</span></span>
                                <span className="text-sm font-black px-3 py-1.5 rounded bg-rose-600 shadow-sm text-white">{callProcessModal.qNum}번 문항{callProcessModal.callInfo.source ? ' · '+callProcessModal.callInfo.source : ''}</span>
                            </div>
                            
                            <MathText className="text-[16px] md:text-[17px] text-slate-800 font-myungjo font-semibold leading-[1.8] break-keep" html={callProcessModal.callInfo.questionText} />
                            
                            {callProcessModal.callInfo.options && (
                                <div className="mt-4 flex flex-col gap-2">
                                    {callProcessModal.callInfo.options.map((opt: string, i: number) => (
                                        <div key={i} className="text-[15px] text-slate-700 font-medium flex gap-2 bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-100">
                                            <span className="font-black text-rose-400 shrink-0">{i + 1}.</span>
                                            <MathText className="flex-1" html={opt} />
                                        </div>
                                    ))}
                                </div>
                            )}
                            
                            {callProcessModal.callInfo.imageUrl && (
                                <img src={callProcessModal.callInfo.imageUrl} className="max-w-[720px] w-full rounded-xl border-2 border-slate-200 mt-4 shadow-sm" alt="문제 첨부 이미지" />
                            )}
                            
                            <div className="mt-6 pt-4 border-t-2 border-dashed border-slate-200 flex items-start gap-3">
                                <span className="text-xs font-black px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 shrink-0 mt-0.5">정답</span>
                                <MathText className="text-[16px] md:text-lg font-black text-emerald-700" html={callProcessModal.callInfo.answer ? `$ ${callProcessModal.callInfo.answer.replace(/\$/g, '')} $` : '정보 없음'} />
                            </div>
                            
                            {callProcessModal.callInfo.explanation && (
                                <div className="mt-5 pt-4 border-t-2 border-dashed border-slate-200">
                                    <span className="text-xs font-black px-2 py-1 rounded border border-slate-300 bg-slate-100 text-slate-600">해설</span>
                                    <div className="mt-2.5 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                        <MathText className="text-[14px] md:text-[15px] text-slate-600 font-medium leading-relaxed" html={callProcessModal.callInfo.explanation.replace(/\n/g, '<br>')} />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="bg-slate-50 p-6 border-t border-slate-200 flex justify-end gap-3 shrink-0 rounded-b-[2rem]">
                            <button onClick={() => setCallProcessModal(null)} className="px-6 py-4 bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 font-bold rounded-xl transition-colors">닫기</button>
                            <button onClick={() => { taAction(callProcessModal.seat, 'cancel_call', callProcessModal.qNum, 'skip'); setCallProcessModal(null); }} className="px-8 py-4 bg-slate-200 hover:bg-slate-300 text-slate-700 text-lg font-black rounded-xl shadow-sm transition-colors">
                                ⏭️ 설명 생략 (그냥 넘기기)
                            </button>
                            <button onClick={() => { taAction(callProcessModal.seat, 'cancel_call', callProcessModal.qNum, 'hint'); setCallProcessModal(null); }} className="px-8 py-4 bg-amber-500 hover:bg-amber-600 text-white text-lg font-black rounded-xl shadow-lg transition-colors">
                                💡 힌트 제공 후 종료
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {editorLocked && (
                <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[999] flex items-center justify-center">
                    <div className="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-sm">
                        <div className="text-4xl mb-3">🔒</div>
                        <h3 className="text-lg font-extrabold text-slate-800 mb-2">좌석 배치 수정 중입니다</h3>
                        <p className="text-sm text-slate-500">관리자가 좌석 배치를 편집하는 동안에는<br />클리닉 기능이 잠시 멈춥니다. 잠시만 기다려주세요.</p>
                    </div>
                </div>
            )}
            <style dangerouslySetInnerHTML={{ __html: `
                @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
                @keyframes pulse-red { 0%, 100% { border-color: #ef4444; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); } 50% { border-color: #fca5a5; box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); } }
                .status-help { animation: pulse-red 1.2s infinite; background-color: #fef2f2; border: 2px solid #ef4444; }
                @keyframes flash-yellow { 0%, 100% { background-color: white; } 50% { background-color: #fef9c3; border-color: #eab308; } }
                .hint-flash { animation: flash-yellow 1.5s ease-in-out infinite; }
                @keyframes blink-dot { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
                .dot-live { animation: blink-dot 1.6s ease-in-out infinite; }
                ::-webkit-scrollbar { width: 7px; height: 7px; }
                ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
            `}} />

            {draggedSeat && activeStudents[draggedSeat] && ghostRect && (
                <div id="drag-ghost" className="fixed pointer-events-none z-[9999] opacity-[0.65] shadow-2xl bg-white border border-slate-200 rounded-xl overflow-hidden"
                     style={{ left: ghostRect.left, top: ghostRect.top, width: ghostRect.width, height: ghostRect.height }}>
                    <div className="p-2 flex flex-col justify-center h-full"
                         style={{ width: ghostRect.width / ghostRect.scale, height: ghostRect.height / ghostRect.scale, transform: `scale(${ghostRect.scale})`, transformOrigin: 'top left' }}>
                        <SeatCardBody seat={draggedSeat} student={activeStudents[draggedSeat]} now={now} isMounted={isMounted} interactive={false} />
                    </div>
                </div>
            )}
            {draggedListStudent && ghostRect && (
                <div id="drag-ghost" className="fixed pointer-events-none z-[9999] opacity-[0.85] shadow-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/80 rounded-xl p-2 flex flex-col justify-center overflow-hidden"
                     style={{ left: ghostRect.left, top: ghostRect.top, width: ghostRect.width, height: ghostRect.height }}>
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                        <div className="flex items-center gap-1 min-w-0">
                            <span className="shrink-0 bg-indigo-500 text-white text-[9px] font-bold w-3.5 h-3.5 flex items-center justify-center rounded leading-none">🕒</span>
                            <span className="font-bold text-slate-700 text-[12px] truncate leading-tight">{draggedListStudent.name}</span>
                        </div>
                        <span className="shrink-0 text-[8px] font-bold px-1 py-px rounded bg-indigo-600 text-white leading-none">신규 배정</span>
                    </div>
                    {draggedListStudent.classes?.length > 0 ? (
                        <div className="text-[8px] font-bold text-emerald-600 truncate leading-none">{draggedListStudent.classes[0]}</div>
                    ) : <div className="text-[8px] font-bold text-slate-300 truncate leading-none">반 없음</div>}
                </div>
            )}

            <header className="bg-slate-900 border-b border-slate-800 text-white px-6 py-3 flex justify-between items-center z-20 shrink-0 shadow-lg">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center shadow-inner shadow-indigo-400/50">
                        <span className="text-xl">📡</span>
                    </div>
                    <div>
                        <h1 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                            Logica Clinic <span className="font-medium text-slate-400">|</span> 관제탑
                        </h1>
                        <p className="text-[11px] text-slate-400 font-medium mt-0.5 tracking-tight">전체 좌석 현황 모니터링 및 실시간 제어 시스템</p>
                    </div>
                </div>

                <div className="flex items-center gap-5">
                    <div className="flex items-center gap-2 bg-slate-800/50 p-1.5 rounded-xl border border-slate-700/50">
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 text-[11px] font-bold text-slate-300 shadow-sm"><span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0"></span>조교 {Object.keys(activeTAs).length}</div>
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 text-[11px] font-bold text-slate-300 shadow-sm"><span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>학생 {studentCount}</div>
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 text-[11px] font-bold text-slate-300 shadow-sm"><span className="w-2 h-2 rounded-full bg-slate-500 shrink-0"></span>공석 {vacantCount}</div>
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/20 border border-rose-500/30 text-[11px] font-bold text-rose-300 shadow-sm"><span className="text-rose-400">🚨</span>호출 {callingCount}</div>
                    </div>

                    <div className="flex items-center gap-3 bg-slate-800/50 pl-4 pr-3 py-1.5 rounded-xl border border-slate-700/50 hidden xl:flex">
                        <div className="text-right">
                            <div className="text-xs font-black font-mono text-slate-200">{isMounted ? new Date(now).toLocaleTimeString('ko-KR', { hour12: false }) : '--:--:--'}</div>
                            <div className="text-[9px] text-slate-500 font-bold">UPTIME {isMounted ? formatDuration(now - startedAt) : '00:00'}</div>
                        </div>
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_8px_rgba(0,0,0,0.5)] ${connectionStatus === 'connected' ? 'bg-emerald-500 dot-live' : connectionStatus === 'error' ? 'bg-rose-500' : 'bg-amber-500'}`}></span>
                    </div>

                    <div className="flex items-center gap-3 pl-2">
                        <button onClick={() => router.push('/admin-dashboard')} className="group flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-2 rounded-lg text-xs font-bold transition-all shadow-md hover:shadow-indigo-500/20">
                            <span className="group-hover:scale-110 transition-transform">⚙️</span> 운영 홈
                        </button>
                        <div className="w-px h-8 bg-slate-700 mx-1 hidden sm:block"></div>
                        <div className="text-right hidden sm:block leading-tight">
                            <div className="text-xs font-bold text-slate-200">{instructorInfo.name}</div>
                            <div className="text-[10px] font-medium text-slate-500">{instructorInfo.position}</div>
                        </div>
                        <button onClick={handleLogout} className="bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 border border-slate-700 hover:border-rose-500/50 px-3 py-2 rounded-lg text-xs font-bold transition-colors">
                            로그아웃
                        </button>
                    </div>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                <LeftPanel data={supervisorData} />
                <SeatGrid data={supervisorData} />

                <aside className="w-[260px] bg-white border-l border-slate-300 flex flex-col h-full shadow-2xl z-10 shrink-0">
                    <div className="bg-slate-800 text-white px-4 py-2 font-bold text-[12px] flex justify-between items-center shrink-0">
                        <span>⚡ 현장 라이브 로그</span>
                        <span className="text-[10px] bg-rose-500 px-1.5 py-0.5 rounded animate-pulse">Live</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
                        {logs.length === 0 ? <div className="text-center text-[11px] text-slate-400 py-8">접수된 기록이 없습니다.</div> : logs.map((log: any) => (
                            <div key={log.id} className={`bg-white p-2 rounded-lg border-l-4 ${log.borderClass} shadow-sm`}>
                                <div className="flex justify-between items-start mb-0.5">
                                    <span className="text-[9px] font-bold text-slate-400">{log.timestamp}</span>
                                    <span className={`${log.badgeBg} text-[8px] font-bold px-1 py-0.5 rounded`}>{log.badgeText}</span>
                                </div>
                                <p className="text-[12px] font-bold text-slate-800 leading-tight">{log.title}</p>
                                <p className="text-[10px] text-slate-600 mt-0.5 leading-snug">{log.subtitle}</p>
                                
                                {log.type === 'call' && (
                                    <button 
                                        onClick={() => {
                                            const st = activeStudents[log.data.seat];
                                            const callInfo = st?.calls?.[log.data.qNum];
                                            if (log.data.qNum === 'general' || !callInfo?.questionText) {
                                                taAction(log.data.seat, 'cancel_call', log.data.qNum, 'skip');
                                            } else {
                                                setCallProcessModal({ isOpen: true, seat: log.data.seat, qNum: log.data.qNum, callInfo });
                                            }
                                        }} 
                                        className="mt-1.5 w-full bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold py-1 rounded transition-colors"
                                    >
                                        {log.data.qNum === 'general' ? '호출 확인 완료' : '상세 보기 및 처리'}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </aside>
            </div>
        </div>
    );
}