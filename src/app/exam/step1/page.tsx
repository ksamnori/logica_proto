// src/app/exam/step1/page.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useStep1Data } from "./useStep1Data";
import LeftPanel from "./LeftPanel";
import RightPanel from "./RightPanel";

export default function ExamStep1Page() {
  const router = useRouter();
  const step1Data = useStep1Data();

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50 font-pretendard select-none">
      <header className="bg-white h-20 px-6 flex justify-between items-center shrink-0 shadow-sm border-b border-slate-200 z-10">
        <div className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => router.push('/exam-list')}>
          <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-8 object-contain" alt="Logica" />
          <span className="text-xl font-extrabold text-slate-800 ml-2">스마트 출제 엔진</span>
        </div>
        <div className="flex space-x-6">
          <div className="flex items-center space-x-2"><span className="w-6 h-6 rounded-full bg-[#002864] text-white text-center text-sm font-bold shadow-sm">1</span><span className="font-bold text-[#002864]">조건 및 단원 설정</span></div>
          <div className="flex items-center space-x-2"><span className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 text-center text-sm font-bold border border-slate-200">2</span><span className="font-bold text-slate-400">문항 뷰어 & 편집</span></div>
          <div className="flex items-center space-x-2"><span className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 text-center text-sm font-bold border border-slate-200">3</span><span className="font-bold text-slate-400">시험지 배포</span></div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <LeftPanel step1Data={step1Data} />
        
        <section className="flex-1 flex flex-col relative bg-slate-50">
          <RightPanel step1Data={step1Data} />

          <div className="bg-[#002864] absolute bottom-0 w-full px-8 py-5 flex items-center justify-between text-white shadow-[0_-10px_30px_rgba(0,0,0,0.2)] z-20">
            <div className="text-lg flex items-center gap-6">
              <div><span className="text-blue-200 font-bold text-sm">목표 문항 수</span><span className="text-3xl font-extrabold text-blue-100 ml-2">{step1Data.qCount}</span><span className="font-bold ml-1 text-sm">개</span></div>
              <div className="w-px h-8 bg-blue-800"></div>
              <div><span className="text-blue-200 font-bold text-sm">선택된 단원/테스트</span><span className="text-3xl font-extrabold text-emerald-400 ml-2">{step1Data.selectedItemIds.size}</span><span className="font-bold ml-1 text-sm">개</span></div>
            </div>
            <button onClick={step1Data.generateExam} className="bg-blue-500 hover:bg-blue-400 text-white font-extrabold px-10 py-4 rounded-xl shadow-lg transition-transform hover:scale-[1.02]">
              다음 단계 ➔
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}