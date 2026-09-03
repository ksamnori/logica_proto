// src/components/admin/InstructorPerformance.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";

interface InstructorPerformanceProps {
  instructorsStats: any[];
  openClassModal: (classItem: any) => void;
}

export default function InstructorPerformance({ instructorsStats, openClassModal }: InstructorPerformanceProps) {
  const router = useRouter();

  return (
    <div className="mb-6">
      <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-white rounded-t-2xl border shadow-sm relative z-10">
        <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">👨‍🏫 강사별 운영 및 원생 관리 성과</h3>
        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 border border-slate-200 px-2 py-1 rounded shadow-sm">실시간 자동 분류</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-5 bg-transparent border border-t-0 border-slate-200 rounded-b-2xl shadow-sm">
        {instructorsStats.length === 0 ? <div className="col-span-full text-center py-10 text-slate-400 font-bold text-sm">강사 데이터를 불러오는 중입니다...</div> : 
          instructorsStats.map(inst => (
            <div key={inst.instructor_id} className="border border-slate-200 rounded-xl p-3 shadow-sm bg-white flex gap-2.5 h-[110px]">
              
              <div className="w-[72px] bg-slate-100 rounded-lg shadow-inner overflow-hidden flex-shrink-0 border border-slate-200 relative h-full">
                {inst.profile_image_url ? (
                  <img 
                    src={inst.profile_image_url.startsWith('http') ? inst.profile_image_url : `https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/${inst.profile_image_url}`} 
                    className="absolute inset-0 w-full h-full object-cover" 
                    alt="profile"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-2xl font-black text-blue-400 bg-blue-50">
                    {inst.name?.charAt(0) || 'T'}
                  </div>
                )}
              </div>
              
              <div className="flex-1 flex flex-col min-w-0 h-full">
                <div className="flex justify-between items-center mb-1.5 gap-1 shrink-0">
                  <div 
                    className="font-extrabold text-[13px] text-slate-800 truncate leading-none mt-0.5 cursor-pointer hover:text-[#002864] hover:underline" 
                    onClick={() => router.push('/instructor')}
                    title="강사 관리 페이지로 이동"
                  >
                    {inst.name} 선생님
                  </div>
                  
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="flex gap-0.5 text-[9px] font-bold">
                      <span className="text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100 shadow-sm flex items-center">입학 +{inst.newCnt}</span>
                      <span className="text-rose-500 bg-rose-50 px-1 py-0.5 rounded border border-rose-100 shadow-sm flex items-center">퇴원 -{inst.leftCnt}</span>
                    </div>
                    
                    <div className="text-right leading-none shrink-0 border-l border-slate-200 pl-1.5 flex items-baseline">
                      <span className="text-base font-black text-[#002864]">{inst.studentCount}</span><span className="text-[9px] font-bold text-slate-400 ml-0.5">명</span>
                    </div>
                  </div>
                </div>
                
                <div className="border-t border-slate-100 pt-1.5 flex flex-col flex-1 min-h-0">
                  <div className="text-[9px] font-bold text-slate-500 mb-1 flex items-center gap-1 shrink-0"><span>📚</span> 담당 수강반 ({inst.myClasses.length})</div>
                  <div className="flex flex-wrap gap-1 content-start flex-1 overflow-y-auto custom-scroll pr-1 pb-1 min-h-0">
                    {inst.myClasses.length === 0 ? <span className="text-[10px] text-slate-400 font-bold">배정된 반 없음</span> : 
                      inst.myClasses.map((c: any) => (
                        <span 
                          key={c.class_id} 
                          onClick={(e) => { e.stopPropagation(); openClassModal({...c, instructor: { name: inst.name }}); }} 
                          className="text-[9px] font-bold bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-slate-600 shadow-sm whitespace-nowrap cursor-pointer hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors"
                        >
                          {c.name}
                        </span>
                      ))
                    }
                  </div>
                </div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}