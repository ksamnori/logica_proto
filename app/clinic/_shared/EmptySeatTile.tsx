// src/app/clinic/_shared/EmptySeatTile.tsx
// supervisor의 SeatGrid에서 빈 좌석을 그릴 때 쓰는 카드와, 좌석 배치 에디터의 좌석 토큰이
// 반드시 똑같이 생기도록 하나의 컴포넌트로 공유한다 — 두 화면을 따로 스타일링하면 또 어긋난다.
"use client";

import React from "react";

interface EmptySeatTileProps {
    label: string | number;
    highlighted?: boolean; // 드래그 중이거나 드롭 타겟일 때 강조
    className?: string;
}

export default function EmptySeatTile({ label, highlighted, className }: EmptySeatTileProps) {
    return (
        <div className={`w-full h-full bg-white/80 border-2 border-dashed rounded-xl p-2 flex flex-col items-center justify-center shadow-sm transition-colors ${highlighted ? 'border-indigo-400 bg-indigo-50 opacity-100' : 'border-slate-300 opacity-80'} ${className || ''}`}>
            <span className="text-slate-500 text-[10px] font-bold pointer-events-none">{label}</span>
        </div>
    );
}
