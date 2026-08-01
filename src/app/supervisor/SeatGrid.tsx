// src/app/supervisor/SeatGrid.tsx
import React, { useState, useEffect } from 'react';
import { supabaseClient } from './supervisorUtils';
import { clearActiveRecheck } from '@/lib/clinicSession';
import SeatCanvas from '../clinic/_shared/SeatCanvas';
import EmptySeatTile from '../clinic/_shared/EmptySeatTile';
import SeatCardBody from './SeatCardBody';
import { DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, DEFAULT_SEAT_CARD_W, DEFAULT_SEAT_CARD_H } from '@/lib/clinicSeatLayout';

export default function SeatGrid({ data }: { data: any }) {
    const {
        now, isMounted, activeStudents, draggedSeat, draggedListStudent, selectedSeatForMove,
        forceCheckoutModal, setForceCheckoutModal, recheckModal, setRecheckModal, confirmForceCheckout,
        endRequestModal, setEndRequestModal, resolveEndRequest,
        reservationModal, setReservationModal, confirmReservation, cancelReservation,
        handlePointerDown, adjustClinicTime, taAction, sendToStudent, appendLog, removeLogsByTypeAndSeat,
        seatObjs, canvasWidth, canvasHeight, seatWidth, seatHeight,
    } = data;

    const cw = canvasWidth || DEFAULT_CANVAS_W;
    const ch = canvasHeight || DEFAULT_CANVAS_H;
    const CARD_W = seatWidth || DEFAULT_SEAT_CARD_W;
    const CARD_H = seatHeight || DEFAULT_SEAT_CARD_H;
    // 좌석끼리 딱 붙어 겹쳐 보이지 않도록, 실제 카드는 격자 칸보다 살짝 작게 그려서 사이에 여백을 둔다.
    const GAP = 10;
    const RENDER_W = Math.max(20, CARD_W - GAP);
    const RENDER_H = Math.max(20, CARD_H - GAP);

    const getCurrentTimeStr = () => {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    };
    const [reservationTime, setReservationTime] = useState(getCurrentTimeStr);
    useEffect(() => { if (reservationModal.isOpen) setReservationTime(getCurrentTimeStr()); }, [reservationModal.isOpen]);

    const [resHour, resMinute] = reservationTime.split(':').map(Number);
    const shiftHour = (delta: number) => {
        const next = ((resHour + delta) % 24 + 24) % 24;
        setReservationTime(`${String(next).padStart(2, '0')}:${String(resMinute).padStart(2, '0')}`);
    };
    const shiftMinute = (delta: number) => {
        const next = ((resMinute + delta) % 60 + 60) % 60;
        setReservationTime(`${String(resHour).padStart(2, '0')}:${String(next).padStart(2, '0')}`);
    };
    const handleHourWheel = (e: React.WheelEvent) => { e.preventDefault(); shiftHour(e.deltaY < 0 ? 1 : -1); };
    const handleMinuteWheel = (e: React.WheelEvent) => { e.preventDefault(); shiftMinute(e.deltaY < 0 ? 1 : -1); };
    const typeHour = (raw: string) => {
        const num = raw === '' ? 0 : parseInt(raw.replace(/\D/g, '').slice(-2) || '0', 10);
        setReservationTime(`${String(Math.min(23, Math.max(0, num))).padStart(2, '0')}:${String(resMinute).padStart(2, '0')}`);
    };
    const typeMinute = (raw: string) => {
        const num = raw === '' ? 0 : parseInt(raw.replace(/\D/g, '').slice(-2) || '0', 10);
        setReservationTime(`${String(resHour).padStart(2, '0')}:${String(Math.min(59, Math.max(0, num))).padStart(2, '0')}`);
    };

    return (
        <main className="flex-1 p-6 bg-slate-200 overflow-y-auto relative">
            <div className="w-full" style={{ aspectRatio: `${cw} / ${ch}` }}>
            <SeatCanvas
                seats={seatObjs || []}
                canvasWidth={cw}
                canvasHeight={ch}
                renderSeat={(seatObj, scale) => {
                    const seat = String(seatObj.number);
                    const student = activeStudents[seat];
                    // 💡 data-seat는 실제 화면에 보이는 크기(RENDER_W*scale)와 정확히 같은 크기의
                    // 바깥 껍데기에만 둔다. 카드 내용물은 그 안에서 transform:scale로 축소/확대되는데,
                    // transform은 레이아웃 크기에는 영향을 안 주기 때문에, data-seat를 (스케일 적용
                    // 전) 원래 크기 요소에 두면 elementsFromPoint가 화면에는 안 보이는 훨씬 넓은
                    // 영역까지 "이 좌석"으로 잘못 인식해서, 드래그 중 뜨는 보라색 하이라이트 박스가
                    // 실제 카드보다 훨씬 크고 엉뚱한 위치에 그려지는 버그가 있었다.
                    const outerStyle = { width: RENDER_W * scale, height: RENDER_H * scale } as const;
                    // 💡 hover:shadow-md 등 CSS transition이 걸린 요소에 transform:scale까지 같이
                    // 있으면, 호버할 때 브라우저가 텍스트를 다시 래스터화하면서 글씨 크기가 잠깐
                    // 깨져 보이는 경우가 있다. willChange/backfaceVisibility로 이 요소를 별도 레이어에
                    // 고정해서 재래스터화를 막는다(아래 className도 transition-all 대신 색상/그림자만
                    // 트랜지션하도록 좁혀서 transform 자체는 절대 애니메이션 대상이 되지 않게 한다).
                    const innerStyle = { width: RENDER_W, height: RENDER_H, transform: `scale(${scale})`, transformOrigin: 'top left', willChange: 'transform', backfaceVisibility: 'hidden' } as const;
                    if (!student) {
                        return (
                            <div data-seat={seat} style={outerStyle}>
                                <div style={innerStyle}>
                                    <EmptySeatTile label={seat} highlighted={!!((draggedSeat || draggedListStudent) && selectedSeatForMove !== seat)} />
                                </div>
                            </div>
                        );
                    }

                    if (student.type === 'reserved') {
                        return (
                            <div data-seat={seat} style={outerStyle}>
                            <div onPointerDown={(e) => handlePointerDown(e, seat)} style={innerStyle}
                                 className="relative border-2 border-dashed border-slate-300 bg-slate-100 opacity-80 rounded-xl p-2 flex flex-col justify-center cursor-grab active:cursor-grabbing">
                                <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`${student.name} 학생의 예약을 취소하시겠습니까?`)) cancelReservation(seat); }} title="예약 취소" className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-slate-500 hover:bg-rose-600 text-white rounded-full flex items-center justify-center shadow-md border-2 border-white z-30 transition-transform hover:scale-125">
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                                <div className="pointer-events-none overflow-hidden">
                                    <div className="flex items-center justify-between gap-1 mb-0.5">
                                        <div className="flex items-center gap-1 min-w-0">
                                            <span className="shrink-0 bg-slate-500 text-white text-[9px] font-bold w-3.5 h-3.5 flex items-center justify-center rounded leading-none">{seat}</span>
                                            <span className="font-bold text-slate-700 text-[12px] truncate leading-tight" title={student.name}>{student.name}</span>
                                        </div>
                                        <span className="shrink-0 text-[8px] font-bold px-1 py-px rounded bg-slate-400 text-white leading-none">🕒 예약</span>
                                    </div>
                                    {student.classes?.length > 0 ? (
                                        <div className="text-[8px] font-bold text-slate-400 truncate mb-0.5 leading-none">{student.classes[0]}</div>
                                    ) : <div className="text-[8px] font-bold text-slate-300 truncate mb-0.5 leading-none">반 없음</div>}
                                    <div className="text-[9px] font-bold text-indigo-500 mt-0.5 leading-tight">⏰ {new Date(student.reservedFor).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })} 예약</div>
                                </div>
                            </div>
                            </div>
                        );
                    }

                    const isCall = student.status === 'call';
                    const isHint = student.status === 'hint';
                    const isAway = student.status === 'away';
                    const isSubmitted = student.status === 'submitted';
                    const isDragging = draggedSeat === seat;

                    const cardClass = isCall ? 'status-help bg-white'
                                    : isHint ? 'hint-flash bg-white border-slate-200'
                                    : isAway ? 'bg-amber-50 border-amber-400'
                                    : isSubmitted ? 'bg-blue-50 border-blue-400'
                                    : 'bg-white border-slate-200 hover:shadow-md hover:border-slate-300';

                    return (
                        <div data-seat={seat} style={outerStyle}>
                        <div onPointerDown={(e) => handlePointerDown(e, seat)} style={innerStyle}
                             className={`relative border ${isAway || isSubmitted ? 'border-2' : ''} rounded-xl p-2 flex flex-col justify-center shadow-sm cursor-grab active:cursor-grabbing transition-[background-color,border-color,box-shadow,opacity] duration-300 ${cardClass} ${isDragging ? 'opacity-[0.85] ring-4 ring-indigo-500 ring-offset-1' : ''}`}>
                            <button onClick={(e) => { e.stopPropagation(); setForceCheckoutModal({ isOpen: true, seat }); }} title="강제 퇴실" className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-500 hover:bg-rose-600 text-white rounded-full flex items-center justify-center shadow-md border-2 border-white z-30 transition-transform hover:scale-125">
                                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                            <div className="pointer-events-none overflow-hidden">
                                <SeatCardBody
                                    seat={seat} student={student} now={now} isMounted={isMounted}
                                    onClearAway={() => taAction(seat, 'clear_away')}
                                    onConfirmCheckout={() => taAction(seat, 'confirm_checkout')}
                                    onOpenEndRequest={() => setEndRequestModal({ isOpen: true, seat })}
                                    onAdjustTime={(delta) => adjustClinicTime(seat, delta)}
                                />
                            </div>
                        </div>
                        </div>
                    );
                }}
            />
            </div>

            {/* 강제 퇴실 모달 */}
            {forceCheckoutModal.isOpen && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-[340px] text-center">
                        <div className="text-4xl mb-3">🚪</div>
                        <h3 className="text-lg font-extrabold text-slate-800 mb-2">강제 퇴실 확인</h3>
                        <p className="text-sm text-slate-600 mb-6"><span className="font-bold text-rose-600">{activeStudents[forceCheckoutModal.seat!]?.name}</span> 학생을 퇴실시키겠습니까?</p>
                        <div className="flex gap-2">
                            <button onClick={() => setForceCheckoutModal({ isOpen: false, seat: null })} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg">취소</button>
                            <button onClick={confirmForceCheckout} className="flex-1 bg-rose-600 text-white font-bold py-3 rounded-lg">강제 퇴실</button>
                        </div>
                    </div>
                </div>
            )}

            {/* AI 재확인 모달 */}
            {recheckModal.isOpen && (
                <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-40 px-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                        <div className="bg-indigo-600 text-white px-5 py-3 flex justify-between items-center">
                            <span className="font-bold text-sm">🔄 AI 채점 재확인</span>
                            <button onClick={() => setRecheckModal({ isOpen: false, seat: null, uid: null })} className="text-white/80 hover:text-white">✕</button>
                        </div>
                        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                            <img className="w-full rounded-lg border border-slate-200" src={activeStudents[recheckModal.seat!]?.rechecks?.[recheckModal.uid!]?.imageDataUrl || ''} alt="답안" />
                        </div>
                        <div className="flex gap-2 p-4 border-t border-slate-100">
                            <button onClick={() => { const sid = activeStudents[recheckModal.seat!]?.sessionId; if (sid && recheckModal.uid) clearActiveRecheck(supabaseClient, sid, recheckModal.uid); sendToStudent(recheckModal.seat!, 'resolve_recheck', { uid: recheckModal.uid, verdict: 'incorrect' }); removeLogsByTypeAndSeat('recheck', recheckModal.seat!, Number(recheckModal.uid)); setRecheckModal({ isOpen: false, seat: null, uid: null }); }} className="flex-1 bg-rose-50 text-rose-600 font-bold py-3 rounded-xl">❌ 오답</button>
                            <button onClick={() => { const sid = activeStudents[recheckModal.seat!]?.sessionId; if (sid && recheckModal.uid) clearActiveRecheck(supabaseClient, sid, recheckModal.uid); sendToStudent(recheckModal.seat!, 'resolve_recheck', { uid: recheckModal.uid, verdict: 'correct' }); removeLogsByTypeAndSeat('recheck', recheckModal.seat!, Number(recheckModal.uid)); setRecheckModal({ isOpen: false, seat: null, uid: null }); }} className="flex-1 bg-emerald-600 text-white font-bold py-3 rounded-xl">✅ 정답</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 클리닉 종료 요청 승인/거부 모달 */}
            {endRequestModal.isOpen && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-[340px] text-center">
                        <div className="text-4xl mb-3">🚪</div>
                        <h3 className="text-lg font-extrabold text-slate-800 mb-2">클리닉 종료 요청</h3>
                        <p className="text-sm text-slate-600 mb-6"><span className="font-bold text-rose-600">{activeStudents[endRequestModal.seat!]?.name}</span> 학생이 클리닉 종료를 요청했습니다. 승인하면 지금 이 시점이 이용시간 종료로 기록됩니다.</p>
                        <div className="flex gap-2">
                            <button onClick={() => resolveEndRequest(false)} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg">거부 (5분 쿨타임)</button>
                            <button onClick={() => resolveEndRequest(true)} className="flex-1 bg-rose-600 text-white font-bold py-3 rounded-lg">승인 (종료)</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 예약 시간 입력 모달 */}
            {reservationModal.isOpen && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-[340px]">
                        <div className="text-center mb-4">
                            <div className="text-4xl mb-2">🕒</div>
                            <h3 className="text-lg font-extrabold text-slate-800">예약 시간 입력</h3>
                            <p className="text-sm text-slate-500 mt-1"><span className="font-bold text-indigo-600">{reservationModal.student?.name}</span> 학생을 [{reservationModal.seat}] 자리에 예약합니다.</p>
                        </div>
                        <div className="flex items-center justify-center gap-4 mb-4 bg-slate-50 border border-slate-200 rounded-xl py-4">
                            <div className="flex flex-col items-center gap-0.5">
                                <button onClick={() => shiftHour(1)} className="text-slate-300 hover:text-indigo-600 leading-none text-xs transition-colors">▲</button>
                                <input
                                    type="text" inputMode="numeric" value={String(resHour).padStart(2, '0')}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => typeHour(e.target.value)}
                                    onWheel={handleHourWheel}
                                    className="w-14 text-center text-3xl font-black text-slate-800 font-lexend tabular-nums cursor-ns-resize bg-transparent border-none outline-none rounded-lg hover:bg-white focus:bg-white focus:ring-2 focus:ring-indigo-200 transition-colors"
                                />
                                <button onClick={() => shiftHour(-1)} className="text-slate-300 hover:text-indigo-600 leading-none text-xs transition-colors">▼</button>
                            </div>
                            <div className="text-3xl font-black text-slate-300">:</div>
                            <div className="flex flex-col items-center gap-0.5">
                                <button onClick={() => shiftMinute(1)} className="text-slate-300 hover:text-indigo-600 leading-none text-xs transition-colors">▲</button>
                                <input
                                    type="text" inputMode="numeric" value={String(resMinute).padStart(2, '0')}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => typeMinute(e.target.value)}
                                    onWheel={handleMinuteWheel}
                                    className="w-14 text-center text-3xl font-black text-slate-800 font-lexend tabular-nums cursor-ns-resize bg-transparent border-none outline-none rounded-lg hover:bg-white focus:bg-white focus:ring-2 focus:ring-indigo-200 transition-colors"
                                />
                                <button onClick={() => shiftMinute(-1)} className="text-slate-300 hover:text-indigo-600 leading-none text-xs transition-colors">▼</button>
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-400 text-center mb-4">예약 시간 + 10분 안에 로그인하지 않으면 예약이 자동 취소됩니다.</p>
                        <div className="flex gap-2">
                            <button onClick={() => setReservationModal({ isOpen: false, seat: null, student: null })} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg">취소</button>
                            <button onClick={() => confirmReservation(reservationTime)} className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-lg">예약하기</button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}