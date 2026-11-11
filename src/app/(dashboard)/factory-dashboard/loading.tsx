// src/app/(dashboard)/factory-dashboard/loading.tsx
import React from "react";

export default function FactoryDashboardLoading() {
  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden">
      <div className="bg-slate-900 rounded-2xl p-8 shadow-lg flex flex-col md:flex-row justify-between items-center mb-6 shrink-0 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <span>📊</span> 마스터 DB 컨트롤 타워
            <span className="text-xs font-bold text-slate-900 bg-emerald-400 px-2.5 py-1 rounded shadow-sm tracking-widest uppercase">
              Live Status
            </span>
          </h1>
          <p className="text-sm font-bold text-slate-400 mt-2">
            학원에 적재된 모든 문제은행 자산의 통계를 불러오고 있습니다...
          </p>
        </div>
        <div className="px-5 py-2.5 bg-white/10 text-white/70 font-bold rounded-xl border border-white/20 text-sm">
          초기화 중...
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-2xl border border-slate-200 shadow-sm p-10 gap-4">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-base font-bold text-slate-700">
          마스터 DB 통계 대시보드를 준비하고 있습니다...
        </p>
        <p className="text-xs font-bold text-slate-400">
          잠시만 기다려주세요. 문항 메타데이터를 병렬로 고속 집계합니다.
        </p>
      </div>
    </div>
  );
}
