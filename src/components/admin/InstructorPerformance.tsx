// src/components/admin/InstructorPerformance.tsx
"use client";

import React from "react";

interface InstructorPerformanceProps {
  instructorsStats: any[];
  openClassModal?: (classItem: any) => void;
}

export default function InstructorPerformance({ instructorsStats, openClassModal }: InstructorPerformanceProps) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col hover:border-blue-300 transition-colors flex-1 min-h-[300px] max-h-[450px]">
      
      {/* 헤더 영역 */}
      <div className="flex justify-between items-center mb-4 shrink-0">
        <span className="text-sm font-extrabold text-slate-700 flex items-center gap-1.5">
          👨‍🏫 강사별 원생 관리 성과
        </span>
        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">
          실시간 요약
        </span>
      </div>

      {/* 리스트 렌더링 영역 (카드 형태 -> 슬림형 가로 리스트로 개편) */}
      <div className="flex-1 overflow-y-auto custom-scroll pr-1 flex flex-col gap-2.5">
        {instructorsStats.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs font-bold text-slate-400">
            데이터가 없습니다.
          </div>
        ) : (
          instructorsStats.map((inst, idx) => {
            // 강사별 프로필 아바타 색상 랜덤 배정
            const avatarColors = [
              'bg-blue-100 text-blue-700 border-blue-200', 
              'bg-indigo-100 text-indigo-700 border-indigo-200', 
              'bg-emerald-100 text-emerald-700 border-emerald-200', 
              'bg-amber-100 text-amber-700 border-amber-200',
              'bg-violet-100 text-violet-700 border-violet-200'
            ];
            const colorClass = avatarColors[idx % 5];

            return (
              <div 
                key={inst.instructor_id} 
                className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 hover:bg-white hover:border-blue-200 hover:shadow-sm transition-all group"
              >
                {/* 좌측: 강사 아바타 및 이름 */}
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-black shrink-0 border shadow-sm ${colorClass}`}>
                    {inst.name?.charAt(0) || '강'}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-extrabold text-slate-800">{inst.name}</span>
                      <span className="text-[10px] font-bold text-slate-400">{inst.position || '강사'}</span>
                    </div>
                    <span className="text-[11px] font-bold text-slate-500">
                      담당 수강반 <span className="text-indigo-500 font-black">{inst.myClasses?.length || 0}</span>개
                    </span>
                  </div>
                </div>

                {/* 우측: 성과 지표 뱃지 */}
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex items-baseline gap-1">
                    <span className="text-[10px] font-bold text-slate-400">총 관리</span>
                    <span className="text-sm font-black text-[#002864] group-hover:text-blue-600 transition-colors">
                      {inst.studentCount}명
                    </span>
                  </div>
                  <div className="flex gap-1.5 mt-0.5">
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded shadow-sm border flex items-center gap-0.5 ${inst.newCnt > 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                      입학 +{inst.newCnt}
                    </span>
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded shadow-sm border flex items-center gap-0.5 ${inst.leftCnt > 0 ? 'bg-rose-50 text-rose-500 border-rose-200' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                      퇴원 -{inst.leftCnt}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}