// src/components/progress/QuestionModal.tsx
"use client";

import React, { useEffect } from "react";

interface QuestionModalProps {
  isOpen: boolean;
  question: any | null;
  onClose: () => void;
}

export default function QuestionModal({ isOpen, question, onClose }: QuestionModalProps) {
  // 모달이 열릴 때만 내부의 수식을 MathJax로 렌더링
  useEffect(() => {
    if (isOpen && question) {
      setTimeout(() => {
        if ((window as any).MathJax && (window as any).MathJax.typesetPromise) {
          (window as any).MathJax.typesetPromise().catch(() => {});
        }
      }, 50);
    }
  }, [isOpen, question]);

  if (!isOpen || !question) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="bg-[#002864] p-4 text-white flex justify-between items-center rounded-t-2xl shrink-0">
          <h2 className="font-bold flex items-center gap-3">
            <span className="bg-blue-800 text-xs px-2.5 py-1 rounded shadow-inner">{question.question_category || "일반"}</span> 
            <span className="text-lg">문항 번호 <span className="text-blue-200 font-black ml-1">{question.question_number || "-"}</span></span>
          </h2>
          <button onClick={onClose} className="text-white hover:text-rose-400 font-bold text-2xl leading-none">&times;</button>
        </div>
        
        <div className="p-8 overflow-y-auto custom-scroll text-slate-800 text-[16px] leading-relaxed flex-1">
          <div dangerouslySetInnerHTML={{ __html: question.raw_metadata?.question?.replace(/\n/g, '<br>') || '<span class="text-slate-400">문제 정보 없음</span>' }} />
          {question.raw_metadata?.options && Array.isArray(question.raw_metadata.options) && (
            <div className="mt-4 space-y-3 pl-2">
              {question.raw_metadata.options.map((opt: string, idx: number) => (
                <div key={idx} className="flex gap-3"><span className="text-slate-400 font-bold shrink-0">{['①','②','③','④','⑤'][idx] || `(${idx+1})`}</span><span className="font-medium">$ {opt} $</span></div>
              ))}
            </div>
          )}
        </div>
        
        <div className="bg-slate-50 p-5 border-t border-slate-200 shrink-0 rounded-b-2xl flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-xs font-bold">정답</span>
            <span className="text-[#002864] font-extrabold text-lg font-mono ml-1">$ {question.answer || "정보 없음"} $</span>
          </div>
        </div>
      </div>
    </div>
  );
}