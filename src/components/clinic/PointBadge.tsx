// src/components/clinic/PointBadge.tsx
"use client";

import React, { useEffect, useRef, useState } from 'react';

// 포인트가 오를 때 슈퍼마리오 물음표 블럭을 칠 때처럼 살짝 튀어오르면서, "+N"이 위로 떠오르다
// 사라지는 연출을 준다. points는 잔액을 비동기로 조회하는 동안 null(아직 모름)일 수 있다 —
// 이 첫 번째 "실제 값이 채워지는" 렌더에서는 절대 애니메이션이 트리거되지 않아야 한다. 만약
// 호출부가 로딩 중 기본값으로 0 같은 걸 먼저 넣어뒀다가 실제 잔액으로 바뀌면, 그 차이를 진짜
// 적립으로 착각해 페이지에 들어올 때마다 튀어오르는 버그가 생긴다 — 그래서 로딩 중에는 반드시
// null을 넘겨야 한다.
let floaterSeq = 0;

export default function PointBadge({ points, className = '' }: { points: number | null; className?: string }) {
  const prevRef = useRef<number | null>(null);
  const [bump, setBump] = useState(false);
  const [floaters, setFloaters] = useState<{ id: number; amount: number }[]>([]);

  useEffect(() => {
    if (points === null) return;
    const prev = prevRef.current;
    prevRef.current = points;
    if (prev === null) return;
    const diff = points - prev;
    if (diff <= 0) return;

    setBump(true);
    const id = ++floaterSeq;
    setFloaters(f => [...f, { id, amount: diff }]);
    const t1 = setTimeout(() => setBump(false), 280);
    const t2 = setTimeout(() => setFloaters(f => f.filter(x => x.id !== id)), 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [points]);

  return (
    <div className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-sm border ${bump ? 'point-badge-bump' : ''} ${className}`}>
      <span className="text-lg">🪙</span>
      <span className="font-lexend font-black tabular-nums">{points === null ? '···' : points.toLocaleString()} P</span>
      {floaters.map(f => (
        <span key={f.id} className="point-badge-float absolute -top-1 right-3 text-xs font-black text-emerald-500 pointer-events-none">+{f.amount}</span>
      ))}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes point-badge-bump-kf { 0% { transform: translateY(0) scale(1); } 30% { transform: translateY(-6px) scale(1.12); } 55% { transform: translateY(1px) scale(0.97); } 100% { transform: translateY(0) scale(1); } }
        .point-badge-bump { animation: point-badge-bump-kf 0.28s ease-out; }
        @keyframes point-badge-float-kf { 0% { opacity: 0; transform: translateY(4px); } 20% { opacity: 1; } 100% { opacity: 0; transform: translateY(-22px); } }
        .point-badge-float { animation: point-badge-float-kf 0.9s ease-out forwards; }
      `}} />
    </div>
  );
}
