// src/app/clinic/viewer/components/QuestionDisplay.tsx
"use client";

import React, { useEffect, useRef } from "react";

export const QuestionDisplay = React.memo(function QuestionDisplay({ html, imageUrl }: { html: string; imageUrl?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise && ref.current) {
      mj.typesetPromise([ref.current]).catch((err: any) => console.error("MathJax 타이프셋 에러:", err));
    }
  }, [html]);
  return (
    <div ref={ref}>
      <div className="text-[16px] word-break-keep whitespace-pre-wrap leading-[1.6] text-slate-800 font-myungjo font-semibold" dangerouslySetInnerHTML={{ __html: html }} />
      {imageUrl && <img src={imageUrl} className="mt-4 max-w-full rounded-lg border border-slate-200" alt="Question Image" />}
    </div>
  );
});