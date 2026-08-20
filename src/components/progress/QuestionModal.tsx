// src/components/progress/QuestionModal.tsx
"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface QuestionModalProps {
  isOpen: boolean;
  question: any;
  onClose: () => void;
}

export default function QuestionModal({ isOpen, question, onClose }: QuestionModalProps) {
  const [qData, setQData] = useState<any>(null);

  useEffect(() => {
    if (isOpen && question) {
      setQData(question);
      if (question.question_id) {
        supabase.from('question_db').select('*').eq('question_id', question.question_id).single().then(({data}) => {
          if (data) {
            setQData((prev: any) => {
              const merged = { ...prev };
              for (const key in data) {
                if (data[key] !== null && data[key] !== undefined && data[key] !== '') {
                  merged[key] = data[key];
                }
              }
              return merged;
            });
          }
        });
      }
    } else {
      setQData(null);
    }
  }, [isOpen, question]);

  useEffect(() => {
    if (qData) {
      const timer = setTimeout(() => {
        if (typeof window !== "undefined" && (window as any).MathJax && (window as any).MathJax.typesetPromise) {
          (window as any).MathJax.typesetPromise().catch(() => {});
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [qData]);

  if (!isOpen || !qData) return null;

  const displayQNum = String(qData.question_number || '').replace(/TWIN/gi, 'T').replace(/SIMILAR/gi, 'S').replace(/CLINIC/gi, 'C');
  
  // 🌟 [핵심 수정] 원장님 스키마에 맞춘 4단계 해설 컬럼 매핑
  const hasStep = !!(qData.step_1_concept || qData.step_2_approach || qData.step_3_process || qData.step_4_conclusion);
  
  // 🌟 [핵심 수정] answer가 비어있으면 solution 컬럼에서 답을 가져오도록 백업 추가
  const finalAnswer = qData.answer || qData.solution || '-';

  const renderHTML = (html: any) => {
    if (!html) return '-';
    return String(html).replace(/\\bigcirc/g, '\\circ').replace(/\n/g, '<br>');
  };

  const renderAnswer = (ans: any) => {
    if (!ans || ans === '-') return '-';
    const str = renderHTML(ans);
    if (str.includes('<img') || str.includes('<br>')) return str;
    return `$ ${str} $`;
  };

  return (
    <div className="fixed inset-0 z-[9999] flex justify-center items-center bg-slate-900/40 backdrop-blur-sm p-4 animate-[fadeIn_0.1s_ease-out]" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-[#002864] px-5 py-3.5 flex justify-between items-center text-white shrink-0 shadow-md z-10">
          <h3 className="font-extrabold text-sm flex items-center gap-2">
            <span>🔍</span> {qData.page_number}p - {displayQNum}번 문항 상세
          </h3>
          <button onClick={onClose} className="text-white/80 hover:text-rose-400 transition-colors font-bold text-2xl leading-none">&times;</button>
        </div>

        <div className="p-6 overflow-y-auto custom-scroll bg-slate-50 space-y-4">
           <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="text-[11px] font-black text-slate-400 mb-2.5 border-b border-slate-100 pb-2">질문 내용</div>
              <div className="math-text text-slate-800 font-medium whitespace-pre-wrap leading-relaxed"
                   dangerouslySetInnerHTML={{ __html: renderHTML(qData.question) }} />
           </div>

           <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm">
              <div className="text-[11px] font-black text-blue-400 mb-2.5 border-b border-blue-200 pb-2">DB 정답</div>
              <div className="math-text text-blue-800 font-bold text-[15px] whitespace-pre-wrap"
                   dangerouslySetInnerHTML={{ __html: renderAnswer(finalAnswer) }} />
           </div>

           {qData.explanation && !hasStep && (
             <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="text-[11px] font-black text-slate-400 mb-2.5 border-b border-slate-100 pb-2">상세 해설</div>
                <div className="math-text text-slate-700 font-medium whitespace-pre-wrap leading-relaxed"
                     dangerouslySetInnerHTML={{ __html: renderHTML(qData.explanation) }} />
             </div>
           )}

           {/* 🌟 원본 스키마 컬럼명 완벽 대응 */}
           {hasStep && (
             <div className="mt-6 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
               <div className="text-[12px] font-black text-slate-600 mb-4 border-b border-slate-100 pb-2 flex items-center gap-1.5">
                 <span>💡</span> 4단계 상세 해설
               </div>
               <div className="space-y-5">
                 {qData.step_1_concept && (
                   <div className="relative pl-3 border-l-4 border-emerald-400">
                     <div className="text-[11px] font-black text-emerald-600 mb-1">1단계 (조건 분석)</div>
                     <div className="math-text text-slate-700 text-[13px] font-medium whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderHTML(qData.step_1_concept) }} />
                   </div>
                 )}
                 {qData.step_2_approach && (
                   <div className="relative pl-3 border-l-4 border-indigo-400">
                     <div className="text-[11px] font-black text-indigo-600 mb-1">2단계 (개념 적용)</div>
                     <div className="math-text text-slate-700 text-[13px] font-medium whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderHTML(qData.step_2_approach) }} />
                   </div>
                 )}
                 {qData.step_3_process && (
                   <div className="relative pl-3 border-l-4 border-amber-400">
                     <div className="text-[11px] font-black text-amber-600 mb-1">3단계 (수식 전개)</div>
                     <div className="math-text text-slate-700 text-[13px] font-medium whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderHTML(qData.step_3_process) }} />
                   </div>
                 )}
                 {qData.step_4_conclusion && (
                   <div className="relative pl-3 border-l-4 border-rose-400">
                     <div className="text-[11px] font-black text-rose-600 mb-1">4단계 (검토 및 마무리)</div>
                     <div className="math-text text-slate-700 text-[13px] font-medium whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderHTML(qData.step_4_conclusion) }} />
                   </div>
                 )}
               </div>
             </div>
           )}

        </div>
      </div>
    </div>
  );
}