// src/app/clinic/viewer/components/QuestionDisplay.tsx
"use client";

import React, { useEffect, useRef } from "react";

export const QuestionDisplay = React.memo(function QuestionDisplay({
  html,
  imageUrl,
  image2Url,
  html2,
}: {
  html: string;
  imageUrl?: string;
  image2Url?: string;
  html2?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise && ref.current) {
      mj.typesetPromise([ref.current]).catch((err: any) => console.error("MathJax 타이프셋 에러:", err));
    }
  }, [html, html2]);

  const cleanTags = (str: string) =>
    (str || "")
      .replace(/&lt;\s*b\s*&gt;/gi, "<b>")
      .replace(/&lt;\s*\/\s*b\s*&gt;/gi, "</b>")
      .replace(/<\s*b\s*>/gi, "<b>")
      .replace(/<\s*\/\s*b\s*>/gi, "</b>");

  const processedHtml = cleanTags(html);
  const processedHtml2 = html2 ? cleanTags(html2) : "";

  return (
    <div ref={ref}>
      {processedHtml && (
        <div
          className="text-[16px] word-break-keep whitespace-pre-wrap leading-[1.6] text-slate-800 font-myungjo font-semibold"
          dangerouslySetInnerHTML={{ __html: processedHtml }}
        />
      )}
      {imageUrl && (
        <img
          src={imageUrl}
          className="mt-4 max-w-full rounded-lg border border-slate-200"
          alt="Question Image"
        />
      )}
      {image2Url && (
        <img
          src={image2Url}
          className="mt-4 max-w-full rounded-lg border border-slate-200"
          alt="Question Image 2"
        />
      )}
      {processedHtml2 && (
        <div
          className="mt-4 text-[16px] word-break-keep whitespace-pre-wrap leading-[1.6] text-slate-800 font-myungjo font-semibold"
          dangerouslySetInnerHTML={{ __html: processedHtml2 }}
        />
      )}
    </div>
  );
});
