// src/app/clinic/viewer/components/HintRevealBox.tsx
"use client";

import React, { useEffect, useRef } from "react";
import { formatMathTextForWeb } from "../utils";

export const HintRevealBox = React.memo(function HintRevealBox({ revealedText }: { revealedText: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise && ref.current) {
      mj.typesetPromise([ref.current]).catch((err: any) => console.error("MathJax 타이프셋 에러:", err));
    }
  }, [revealedText]);

  if (!revealedText) return null;

  return (
    <div className="mt-4">
      <div ref={ref} className="p-5 bg-blue-900 text-blue-50 rounded-lg text-sm font-medium leading-relaxed max-h-[260px] overflow-y-auto custom-scrollbar">
        <span dangerouslySetInnerHTML={{ __html: formatMathTextForWeb(revealedText) }}/>
      </div>
    </div>
  );
});