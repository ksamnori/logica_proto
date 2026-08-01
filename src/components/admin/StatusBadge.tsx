// src/components/admin/StatusBadge.tsx
import React from 'react';

export const ClassVacancyBadge = ({ vacancy }: { vacancy: number }) => {
  if (vacancy <= 0) {
    return <span className="text-[9px] font-black text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded shadow-sm">마감</span>;
  }
  if (vacancy <= 2) {
    return <span className="text-[9px] font-black text-amber-500 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded shadow-sm">마감 임박</span>;
  }
  return <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded shadow-sm">{vacancy}자리 여유</span>;
};

export const NotiStatusBadge = ({ status }: { status: string }) => {
  const isFail = status?.includes('실패') || status?.includes('에러');
  const isWait = status?.includes('대기') || status?.includes('예약');

  if (isFail) {
    return <span className="bg-rose-50 text-rose-600 border border-rose-100 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 shadow-sm">실패</span>;
  }
  if (isWait) {
    return <span className="bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 shadow-sm">{status}</span>;
  }
  return <span className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 shadow-sm">성공</span>;
};