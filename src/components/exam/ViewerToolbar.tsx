// src/components/exam/ViewerToolbar.tsx
"use client";

import React from "react";

interface ViewerToolbarProps {
  currentPage: number;
  totalPages: number;
  pageInputValue: string;
  setPageInputValue: (val: string) => void;
  handlePageMove: (n: number) => void;
  handlePageStep: (delta: number) => void;
  zoomFactor: number;
  startZoom: (delta: number) => void;
  stopZoom: () => void;
  resetZoom: () => void;
}

export default function ViewerToolbar({
  currentPage,
  totalPages,
  pageInputValue,
  setPageInputValue,
  handlePageMove,
  handlePageStep,
  zoomFactor,
  startZoom,
  stopZoom,
  resetZoom
}: ViewerToolbarProps) {
  return (
    <div className="no-print flex items-center gap-3 py-3 px-6 bg-white border-t border-slate-200 w-full justify-center shrink-0">
      <button onClick={() => handlePageStep(-1)} className="px-4 py-1.5 rounded-lg border border-slate-300 font-bold text-sm text-slate-600 hover:bg-slate-50">◀ 이전</button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={pageInputValue}
        onChange={e => setPageInputValue(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onBlur={() => { if (pageInputValue) handlePageMove(parseInt(pageInputValue)); }}
        className="w-16 text-center border border-slate-300 rounded-lg py-1.5 font-bold text-sm"
      />
      <span className="text-slate-400 font-bold text-sm">/ {totalPages} 페이지</span>
      <button onClick={() => handlePageStep(1)} className="px-4 py-1.5 rounded-lg border border-slate-300 font-bold text-sm text-slate-600 hover:bg-slate-50">다음 ▶</button>
      
      <div className="w-px h-5 bg-slate-200 mx-1"></div>
      
      <div className="flex items-center gap-1 bg-slate-50 rounded-lg border border-slate-200 p-0.5 select-none">
          <button 
            onMouseDown={() => startZoom(-0.01)} onMouseUp={stopZoom} onMouseLeave={stopZoom} onTouchStart={() => startZoom(-0.01)} onTouchEnd={stopZoom}
            className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 font-bold transition-colors text-lg leading-none pb-0.5"
          >-</button>
          <span className="text-slate-600 font-bold text-[11px] w-12 text-center">🔍 {Math.round(zoomFactor * 100)}%</span>
          <button 
            onMouseDown={() => startZoom(0.01)} onMouseUp={stopZoom} onMouseLeave={stopZoom} onTouchStart={() => startZoom(0.01)} onTouchEnd={stopZoom}
            className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 font-bold transition-colors text-lg leading-none pb-0.5"
          >+</button>
      </div>

      <button onClick={resetZoom} className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold text-[11px] text-slate-500 hover:bg-slate-50">초기화</button>
    </div>
  );
}