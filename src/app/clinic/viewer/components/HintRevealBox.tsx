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

  // 🌟 오염된 HTML 태그 치환 로직 적용 ( <b>, < b >, < / b > 등 )
  const processedText = formatMathTextForWeb(revealedText)
    .replace(/&lt;\s*b\s*&gt;/gi, '<b>')
    .replace(/&lt;\s*\/\s*b\s*&gt;/gi, '</b>')
    .replace(/<\s*b\s*>/gi, '<b>')
    .replace(/<\s*\/\s*b\s*>/gi, '</b>');

  return (
    <div className="mt-4">
      <div ref={ref} className="p-5 bg-blue-900 text-blue-50 rounded-lg text-sm font-medium leading-relaxed max-h-[260px] overflow-y-auto custom-scrollbar">
        <span dangerouslySetInnerHTML={{ __html: processedText }}/>
      </div>
    </div>
  );
});