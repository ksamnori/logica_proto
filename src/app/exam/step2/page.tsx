// src/app/exam/step2/page.tsx
"use client";

import React, { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useExamData } from "./useExamData";
import LeftPanel from "./LeftPanel";
import RightPreview from "./RightPreview";

function ExamStep2Content() {
  const router = useRouter();
  const examData = useExamData();

  useEffect(() => {
    if (!document.getElementById("MathJax-script")) {
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]] }, svg: { fontCache: 'global' } };
      const script = document.createElement("script");
      script.id = "MathJax-script";
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if ((window as any).MathJax?.typesetPromise) {
      (window as any).MathJax.typesetPromise().catch(() => {});
    }
  }, [
    examData.questions, examData.showAnswer, examData.twinPoolTwins, 
    examData.twinPoolSimilars, examData.newSearchResults, examData.editingId, 
    examData.leftTab, examData.twinViewOpen, examData.showAddResults
  ]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50 font-pretendard">
      <header className="bg-white h-20 px-6 flex justify-between items-center shrink-0 shadow-sm border-b border-slate-200 z-10">
        <div className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => router.push('/exam-list')}>
          <img src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png" className="h-8 object-contain" alt="Logica" />
          <span className="text-xl font-extrabold text-slate-800 ml-2">스마트 출제 엔진</span>
        </div>
        <div className="flex space-x-6">
          <div className="flex items-center space-x-2"><span className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 text-center text-sm font-bold">1</span><span className="font-bold text-slate-400">조건 및 단원 설정</span></div>
          {/* 🌟 편집기 탭을 눌러도 뒤로 가기 에러를 막을 수 있도록 안전 플래그(Session) 추가 */}
          <div className="flex items-center space-x-2 cursor-pointer hover:opacity-80" onClick={() => { sessionStorage.setItem("restoreExamQuestions", "1"); router.push('/exam/step2'); }}>
            <span className="w-6 h-6 rounded-full bg-[#002864] text-white text-center text-sm font-bold shadow-sm">2</span><span className="font-bold text-[#002864]">문항 뷰어 & 편집</span>
          </div>
          <div className="flex items-center space-x-2"><span className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 text-center text-sm font-bold border border-slate-200">3</span><span className="font-bold text-slate-400">시험지 배포</span></div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <LeftPanel examData={examData} />
        <RightPreview examData={examData} />
      </main>
    </div>
  );
}

export default function ExamStep2Page() {
  return (
    <Suspense fallback={<div className="h-screen w-full flex items-center justify-center bg-slate-50 text-[#002864] font-bold">로딩 중...</div>}>
      <ExamStep2Content />
    </Suspense>
  );
}