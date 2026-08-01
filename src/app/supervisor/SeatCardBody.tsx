// src/app/supervisor/SeatCardBody.tsx
// 좌석 카드 안쪽 내용(배지/이름/반/상태 등)을 그리는 공용 부분. SeatGrid의 실제 카드와, 드래그 중
// 커서를 따라다니는 고스트 미리보기가 반드시 똑같은 정보를 보여줘야 하므로 하나로 공유한다.
// 호출/자리비움 등 상태의 "정확한 정보"(대기 시간, 자리비움 시간, 최근 힌트 등)는 카드에 텍스트로
// 늘어놓지 않고 상태 배지 색깔로만 표시한다 — 자세한 내용은 우측 현장 라이브 로그에서 확인한다.
import React from 'react';
import { formatDuration } from './supervisorUtils';

interface SeatCardBodyProps {
    seat: string;
    student: any;
    now: number;
    isMounted: boolean;
    interactive?: boolean; // false면 버튼이 눌리지 않는 미리보기 전용(드래그 고스트)
    onClearAway?: () => void;
    onConfirmCheckout?: () => void;
    onOpenEndRequest?: () => void;
    onAdjustTime?: (deltaMin: number) => void;
}

export default function SeatCardBody({
    seat, student, now, isMounted, interactive = true,
    onClearAway, onConfirmCheckout, onOpenEndRequest, onAdjustTime,
}: SeatCardBodyProps) {
    const isCall = student.status === 'call';
    const isAway = student.status === 'away';
    const isSubmitted = student.status === 'submitted';

    const badgeBg = isCall ? 'bg-rose-600 text-white' : student.status === 'hint' ? 'bg-yellow-400 text-yellow-900' : isAway ? 'bg-amber-500 text-white' : isSubmitted ? 'bg-blue-600 text-white' : 'bg-emerald-100 text-emerald-700';
    const badgeText = isCall ? `🚨 ${Object.keys(student.calls || {}).length}` : student.status === 'hint' ? '💡 힌트' : isAway ? '🚶 자리비움' : isSubmitted ? '✅ 완료' : '🟢 온라인';

    const remainingMs = (student.firstSeenAt + student.clinicDurationMs) - now;
    const isUrgent = remainingMs <= 5 * 60 * 1000;

    const pe = interactive ? 'pointer-events-auto' : '';

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1 min-w-0">
                    <span className="shrink-0 bg-[#002864] text-white text-[9px] font-bold w-3.5 h-3.5 flex items-center justify-center rounded leading-none">{seat}</span>
                    <span className="font-bold text-slate-900 text-[12px] truncate leading-tight" title={student.name}>{student.name}</span>
                </div>
                <span className={`shrink-0 text-[8px] font-bold px-1 py-px rounded leading-none ${badgeBg}`}>{badgeText}</span>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
                {student.classes?.length > 0 ? (
                    <span className="text-[8px] font-bold text-emerald-600 truncate leading-none">{student.classes[0]}</span>
                ) : <span className="text-[8px] font-bold text-slate-300 truncate leading-none">반 없음</span>}
                {student.sessionNo > 1 && <span className="shrink-0 text-[7px] font-bold px-1 py-px rounded bg-indigo-100 text-indigo-600 leading-none">재이용 {student.sessionNo}회차</span>}
            </div>
            {student.activity && (
                <div className="text-[9px] font-bold text-indigo-600 truncate flex items-center gap-1 leading-tight">{student.activity} {student.isTyping && <span className="animate-pulse">✍️</span>}</div>
            )}
            {student.endRequestPending && (
                <button onClick={(e) => { e.stopPropagation(); onOpenEndRequest?.(); }} className={`${pe} w-full text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded px-1 py-0.5 animate-pulse leading-tight`}>🚪 종료 요청 · 클릭해서 처리</button>
            )}
            <div className="flex items-center gap-1.5 text-[8px] text-slate-400 font-bold leading-none">
                <span>⏱ <span className="tabular-nums">{isMounted ? formatDuration(now - student.firstSeenAt) : '00:00'}</span></span>
                {student.totalCalls > 0 && <span className="text-rose-400">🚨×{student.totalCalls}</span>}
                {student.totalHints > 0 && <span className="text-amber-400">💡×{student.totalHints}</span>}
            </div>
            <div className={pe}>
                {isAway && <button onClick={(e) => { e.stopPropagation(); onClearAway?.(); }} className="w-full bg-amber-100 text-amber-700 text-[9px] font-bold py-1 rounded border border-amber-300 leading-none">복귀 처리</button>}
                {isSubmitted && (
                    <div className="flex flex-col gap-0.5">
                        <div className="bg-white border border-blue-200 rounded text-center py-px text-[9px] font-bold text-blue-800 leading-tight">{student.score}/5점</div>
                        <button onClick={(e) => { e.stopPropagation(); onConfirmCheckout?.(); }} className="bg-slate-800 text-white text-[9px] font-bold py-1 rounded leading-none">퇴실처리</button>
                    </div>
                )}
            </div>
            {student.firstSeenAt && student.clinicDurationMs != null && (
                <div className={`flex items-center justify-between pt-1 border-t border-slate-100 ${pe} ${isUrgent ? 'text-rose-600' : 'text-slate-400'}`}>
                    <span className="text-[8px] font-bold whitespace-nowrap leading-none">⏳ <span className="tabular-nums">{isMounted ? formatDuration(remainingMs) : '00:00'}</span></span>
                    <div className="flex items-center rounded-md border border-slate-200 overflow-hidden shadow-sm shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); onAdjustTime?.(-10); }} className="w-4 h-4 flex items-center justify-center bg-white text-slate-400 leading-none text-[10px]">-</button>
                        <span className="w-px h-3 bg-slate-200"></span>
                        <button onClick={(e) => { e.stopPropagation(); onAdjustTime?.(10); }} className="w-4 h-4 flex items-center justify-center bg-white text-slate-400 leading-none text-[10px]">+</button>
                    </div>
                </div>
            )}
        </div>
    );
}
