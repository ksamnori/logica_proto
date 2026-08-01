// src/components/exam/ViewerHeader.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";

interface ViewerHeaderProps {
  isExamDistributed: boolean;
  isNewExam: boolean;
  currentExamId: string | null;
  onAttemptLeave: (action: () => void) => void;
}

export default function ViewerHeader({ isExamDistributed, isNewExam, currentExamId, onAttemptLeave }: ViewerHeaderProps) {
  const router = useRouter();

  return (
    <header className="bg-white h-20 px-6 flex justify-between items-center shrink-0 shadow-sm border-b border-slate-200 z-40 no-print">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => onAttemptLeave(() => router.push('/exam-list'))}>
            <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-8 object-contain" alt="Logica" />
            <span className="text-xl font-extrabold text-slate-800 ml-2 whitespace-nowrap">시험지 수정 및 배포</span>
        </div>
        
        <div className="w-px h-6 bg-slate-300"></div>

        <div className="flex items-center gap-2 whitespace-nowrap">
          <button 
            disabled={isExamDistributed}
            onClick={() => {
                if (isExamDistributed) return;
                onAttemptLeave(() => {
                    const targetUrl = currentExamId ? `/exam/step2?exam_id=${currentExamId}` : '/exam/step2';
                    router.push(targetUrl);
                });
            }} 
            className={`flex items-center gap-1.5 font-bold bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg text-sm shadow-sm transition-colors ${isExamDistributed ? 'text-slate-400 opacity-60 cursor-not-allowed pointer-events-none' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
          >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg> 
              {isExamDistributed ? '수정 불가' : '이전 단계 (문제 수정)'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 whitespace-nowrap">
        <div className="flex space-x-6 mr-4 hidden md:flex">
            <div className="flex items-center space-x-2"><span className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 text-center text-sm font-bold border border-slate-200">1</span><span className="font-bold text-slate-400 hidden xl:inline">조건 및 단원 설정</span></div>
            <div className="flex items-center space-x-2"><span className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 text-center text-sm font-bold border border-slate-200">2</span><span className="font-bold text-slate-400 hidden xl:inline">문항 뷰어 & 편집</span></div>
            <div className="flex items-center space-x-2"><span className="w-6 h-6 rounded-full bg-[#002864] text-white text-center text-sm font-bold shadow-sm">3</span><span className="font-bold text-[#002864] hidden xl:inline">시험지 배포</span></div>
        </div>
        <div className="w-px h-6 bg-slate-300 hidden md:block"></div>
        
        {!isNewExam && (
          <button onClick={() => onAttemptLeave(() => {
              try { window.close(); } catch (e) {}
              setTimeout(() => router.push('/exam-list'), 200);
          })} className="text-slate-500 hover:text-rose-500 font-bold flex items-center gap-2 bg-slate-50 border border-slate-200 hover:bg-rose-50 px-3 py-1.5 rounded-lg text-sm shadow-sm transition-colors">
             닫기 ✖
          </button>
        )}
      </div>
    </header>
  );
}