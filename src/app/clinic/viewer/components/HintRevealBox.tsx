// src/app/clinic/viewer/components/HintRevealBox.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { formatMathTextForWeb } from "../utils";

export const HintRevealBox = React.memo(function HintRevealBox({ revealed }: { revealed: { level: number; text: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(revealed.length - 1);
  const prevLenRef = useRef(revealed.length);

  useEffect(() => {
    if (revealed.length !== prevLenRef.current) {
      setActiveIdx(revealed.length - 1);
      prevLenRef.current = revealed.length;
    }
  }, [revealed]);

  const safeIdx = Math.min(activeIdx, revealed.length - 1);
  const active = revealed[safeIdx];

  useEffect(() => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise && ref.current) {
      mj.typesetPromise([ref.current]).catch((err: any) => console.error("MathJax 타이프셋 에러:", err));
    }
  }, [active]);

  if (!active) return null;

  return (
    <div className="mt-4">
      {revealed.length > 1 && (
        <div className="flex gap-1.5 mb-2">
          {revealed.map((h, i) => (
            <button key={i} onClick={() => setActiveIdx(i)} className={`text-[11px] font-bold px-2.5 py-1 rounded-md transition-colors ${i === safeIdx ? 'bg-blue-700 text-white' : 'bg-blue-100 text-blue-600 hover:bg-blue-200'}`}>LV {h.level} 힌트</button>
          ))}
        </div>
      )}
      <div ref={ref} className="p-4 bg-blue-900 text-blue-50 rounded-lg text-sm font-medium leading-relaxed max-h-[220px] overflow-y-auto custom-scrollbar">
        <span dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(active.text) }}/>
      </div>
    </div>
  );
});