// src/app/supervisor/SeatCardBody.tsx
import React from 'react';
import { formatDuration } from './supervisorUtils';

interface SeatCardBodyProps {
    seat: string;
    student: any;
    now: number;
    isMounted: boolean;
    interactive?: boolean; 
    onClearAway?: () => void;
    onConfirmCheckout?: () => void;
    onOpenEndRequest?: () => void;
    onAdjustTime?: (deltaMin: number) => void;
    onForceRefresh?: () => void;
    onForceReset?: () => void;
}

export default function SeatCardBody({
    seat, student, now, isMounted, interactive = true,
    onClearAway, onConfirmCheckout, onOpenEndRequest, onAdjustTime, onForceRefresh, onForceReset
}: SeatCardBodyProps) {
    const isCall = student.status === 'call';
    const isAway = student.status === 'away';
    const isSubmitted = student.status === 'submitted';
    const isOffline = student.status === 'offline';
    
    // 🌟 포털 대기 상태 감지 (온라인 상태이면서 포털에 머무를 때)
    const isPortalIdle = student.status === 'idle' && (student.activity?.includes('포털') || !student.activity);

    const badgeBg = isOffline ? 'bg-slate-500 text-white' 
                  : isCall ? 'bg-rose-600 text-white' 
                  : student.status === 'hint' ? 'bg-yellow-400 text-yellow-900' 
                  : isAway ? 'bg-amber-500 text-white' 
                  : isSubmitted ? 'bg-blue-600 text-white' 
                  : isPortalIdle ? 'bg-indigo-100 text-indigo-700' 
                  : 'bg-emerald-100 text-emerald-700';

    // 🌟 대기중일 때는 '온라인' 대신 확실하게 '대기중' 배지를 띄워줍니다
    const badgeText = isOffline ? '⚫ 오프라인' 
                    : isCall ? `🚨 ${Object.keys(student.calls || {}).length}` 
                    : student.status === 'hint' ? '💡 힌트' 
                    : isAway ? '🚶 자리비움' 
                    : isSubmitted ? '✅ 완료' 
                    : isPortalIdle ? '📋 대기중' 
                    : '🟢 온라인';

    const remainingMs = (student.firstSeenAt + student.clinicDurationMs) - now;
    const isUrgent = remainingMs <= 5 * 60 * 1000;

    const pe = interactive ? 'pointer-events-auto' : '';

    return (
        <div className="flex flex-col h-full w-full justify-between min-h-0">
            {/* 1. 상단 헤더: 좌석, 이름, 리셋, 상태 */}
            <div className="flex items-center justify-between pb-1 border-b border-slate-200 shrink-0">
                <div className="flex items-center gap-1 min-w-0">
                    <span className="shrink-0 bg-[#002864] text-white text-[10px] font-black w-4 h-4 flex items-center justify-center rounded shadow-sm leading-none">{seat}</span>
                    <span className="font-extrabold text-slate-900 text-[12px] truncate leading-none" title={student.name}>{student.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {interactive && (
                        <button onClick={(e) => { e.stopPropagation(); onForceReset?.(); }} className={`shrink-0 text-[9px] font-bold bg-slate-100 text-slate-500 hover:bg-fuchsia-500 hover:text-white border border-slate-200 hover:border-fuchsia-500 px-1.5 py-0.5 rounded leading-none transition-colors ${pe}`}>
                            ↻ 리셋
                        </button>
                    )}
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm leading-none ${badgeBg}`}>{badgeText}</span>
                </div>
            </div>

            {/* 2. 중앙 컨텐츠 구역 */}
            <div className="flex flex-col justify-center flex-1 min-h-0 py-0.5 gap-0.5">
                <div className="text-[10px] font-bold text-emerald-600 truncate leading-none mt-0.5">
                    {student.classes?.length > 0 ? student.classes[0] : '반 없음'}
                </div>
                {/* 🌟 텍스트 증발 버그 픽스: truncate 속성을 자식 span으로 이동시키고, flex 구조를 안전하게 개조했습니다 */}
                <div className="text-[10px] font-bold text-indigo-600 flex items-center gap-1 mt-0.5 min-w-0">
                    <span className="truncate leading-none">{student.activity || '-'}</span>
                    {student.isTyping && <span className="shrink-0 animate-pulse leading-none">✍️</span>}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold leading-none mt-1">
                    <span>⏱ {isMounted ? formatDuration(now - student.firstSeenAt) : '00:00'}</span>
                    <div className="flex items-center gap-1">
                        {student.totalCalls > 0 && <span className="text-rose-500">🚨{student.totalCalls}</span>}
                        {student.totalHints > 0 && <span className="text-amber-500">💡{student.totalHints}</span>}
                    </div>
                </div>
            </div>

            {/* 3. 상태 제어 버튼 */}
            <div className={`flex flex-col gap-0.5 shrink-0 ${pe}`}>
                {student.endRequestPending && (
                    <button onClick={(e) => { e.stopPropagation(); onOpenEndRequest?.(); }} className="w-full text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded py-0.5 animate-pulse leading-none shadow-sm">🚪 종료요청 승인</button>
                )}
                {isAway && <button onClick={(e) => { e.stopPropagation(); onClearAway?.(); }} className="w-full bg-amber-100 text-amber-700 text-[10px] font-bold py-0.5 rounded border border-amber-300 shadow-sm leading-none">복귀 처리</button>}
                {isSubmitted && (
                    <button onClick={(e) => { e.stopPropagation(); onConfirmCheckout?.(); }} className="w-full bg-slate-800 text-white text-[10px] font-bold py-0.5 rounded shadow-sm leading-none">퇴실처리 ({student.score}점)</button>
                )}
                {isOffline && (
                    <button onClick={(e) => { e.stopPropagation(); onConfirmCheckout?.(); }} className="w-full bg-slate-800 text-white text-[10px] font-bold py-0.5 rounded shadow-sm leading-none animate-pulse">강제퇴실</button>
                )}
            </div>

            {/* 4. 하단 영역 */}
            {student.firstSeenAt && student.clinicDurationMs != null && (
                <div className={`flex items-center justify-between border-t border-slate-200 pt-1 mt-0.5 shrink-0 ${pe}`}>
                    <span className={`text-[11px] font-black leading-none ${isUrgent ? 'text-rose-600' : 'text-slate-700'}`}>
                        ⏳ {isMounted ? formatDuration(remainingMs) : '00:00'}
                    </span>
                    <div className="flex items-center rounded border border-slate-300 bg-white overflow-hidden shadow-sm shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); onAdjustTime?.(-10); }} className="w-5 h-4 flex items-center justify-center hover:bg-slate-100 active:bg-slate-200 text-slate-600 font-bold leading-none text-[12px] transition-colors">-</button>
                        <span className="w-px h-3 bg-slate-300"></span>
                        <button onClick={(e) => { e.stopPropagation(); onAdjustTime?.(10); }} className="w-5 h-4 flex items-center justify-center hover:bg-slate-100 active:bg-slate-200 text-slate-600 font-bold leading-none text-[12px] transition-colors">+</button>
                    </div>
                </div>
            )}
        </div>
    );
}