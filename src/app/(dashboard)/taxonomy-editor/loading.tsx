// src/app/(dashboard)/taxonomy-editor/loading.tsx
import React from "react";

export default function TaxonomyEditorLoading() {
  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden">
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex justify-between items-center mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-brand flex items-center gap-2">
            <span>⚙️</span> 문제 교정 및 쌍둥이/유사 문제 생성
          </h1>
          <p className="text-sm font-bold text-slate-400 mt-1">
            8단계 분류 체계와 교재 인덱스를 불러오고 있습니다...
          </p>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-2 bg-blue-50 text-brand rounded-xl border border-blue-200 text-xs font-bold">
          <span className="w-3.5 h-3.5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <span>에디터 준비 중...</span>
        </div>
      </div>

      <div className="bg-white px-6 py-4 border border-slate-200 rounded-xl mb-4 shrink-0 shadow-sm animate-pulse">
        <div className="h-6 bg-slate-100 rounded-md w-2/3 mb-3" />
        <div className="h-9 bg-slate-100 rounded-lg w-full" />
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        <div className="w-[400px] bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col gap-3 shrink-0">
          <div className="h-8 bg-slate-100 rounded-lg animate-pulse" />
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <div className="w-9 h-9 border-4 border-brand border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-bold text-slate-600">문항 교정 에디터를 여는 중입니다...</p>
            <p className="text-xs font-medium text-slate-400">초기 분류 데이터를 병렬로 불러오고 있습니다.</p>
          </div>
        </div>

        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col items-center justify-center gap-3 p-8">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-base font-bold text-slate-700">
            문제 교정 및 쌍둥이/유사 생성 워크스페이스 로딩 중
          </p>
          <p className="text-xs font-bold text-slate-400">
            첫 진입 시 분류 체계와 교재 목록을 캐싱하며, 이후에는 즉시 열립니다.
          </p>
        </div>
      </div>
    </div>
  );
}
