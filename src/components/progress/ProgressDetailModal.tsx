// src/components/progress/ProgressDetailModal.tsx
"use client";

import React, { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface ProgressDetailModalProps {
  data: {
    bookId: string;
    classId: string;
    students: { id: string; name: string }[];
    bookTitle: string;
    pages: number[];
    groupedQs: Record<number, any[]>;
    statusMap: Record<string, string>;
  };
  onClose: () => void;
}

export default function ProgressDetailModal({ data, onClose }: ProgressDetailModalProps) {
  const [ansMap, setAnsMap] = useState<Record<string, Record<number, string>>>({});
  const [isLoading, setIsLoading] = useState(true);

  const [selectedQ, setSelectedQ] = useState<any>(null);
  const [qData, setQData] = useState<any>(null); 

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const dragDistance = useRef(0);
  const startX = useRef(0);
  const scrollLeft = useRef(0);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const newAnsMap: Record<string, Record<number, string>> = {};

        data.students.forEach(stu => {
          newAnsMap[stu.id] = {};
          data.pages.forEach(p => {
            const qs = data.groupedQs[p] || [];
            qs.forEach(q => {
              const st = data.statusMap[`${data.classId}_${q.tq_id}_${stu.id}`];
              if (st === 'done') newAnsMap[stu.id][q.tq_id] = 'DONE';
              if (st === 'homework') newAnsMap[stu.id][q.tq_id] = 'HOMEWORK';
            });
          });
        });

        const { data: hws } = await supabase.from('homework_assignment')
          .select('homework_id')
          .eq('book_id', data.bookId)
          .eq('class_id', data.classId);
          
        const hwIds = hws?.map(h => h.homework_id) || [];
        const studentIds = data.students.map(s => s.id);

        if (hwIds.length > 0 && studentIds.length > 0) {
          const { data: ans } = await supabase.from('student_homework_answer')
            .select('tq_id, grading_code, student_id')
            .in('homework_id', hwIds)
            .in('student_id', studentIds);
          
          ans?.forEach(a => {
            if (a.grading_code && newAnsMap[a.student_id]) {
              newAnsMap[a.student_id][a.tq_id] = a.grading_code;
            }
          });
        }
        
        setAnsMap(newAnsMap);
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    if (data) fetchData();
  }, [data]);

  useEffect(() => {
    if (!isLoading && data.pages.length > 0) {
      setTimeout(() => {
        let targetPage = data.pages[0]; 

        for (let i = data.pages.length - 1; i >= 0; i--) {
          const p = data.pages[i];
          const pageQs = data.groupedQs[p] || [];
          
          const hasActivity = pageQs.some(q => 
            data.students.some(stu => ansMap[stu.id]?.[q.tq_id])
          );
          
          if (hasActivity) {
            targetPage = p;
            break;
          }
        }

        const targetEl = document.getElementById(`page-col-${targetPage}`);
        if (targetEl && scrollRef.current) {
           scrollRef.current.scrollTo({
              left: Math.max(0, targetEl.offsetLeft - 120),
              behavior: 'smooth'
           });
        }
      }, 150); 
    }
  }, [isLoading, data.pages, data.groupedQs, data.students, ansMap]);

  useEffect(() => {
    if (selectedQ) {
      setQData(selectedQ);
      if (selectedQ.question_id) {
        supabase.from('question_db').select('*').eq('question_id', selectedQ.question_id).single().then(({data}) => {
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
  }, [selectedQ]);

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

  const startContinuousScroll = (direction: 'left' | 'right') => {
    if (scrollIntervalRef.current) return;
    const step = direction === 'left' ? -15 : 15;
    scrollIntervalRef.current = setInterval(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollBy({ left: step, behavior: 'auto' });
      }
    }, 16); 
  };

  const stopContinuousScroll = () => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopContinuousScroll();
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    setIsDragging(true);
    dragDistance.current = 0;
    startX.current = e.pageX - scrollRef.current.offsetLeft;
    scrollLeft.current = scrollRef.current.scrollLeft;
  };
  const onMouseLeave = () => setIsDragging(false);
  const onMouseUp = () => setIsDragging(false);
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - startX.current) * 1.5;
    dragDistance.current = Math.abs(x - startX.current);
    scrollRef.current.scrollLeft = scrollLeft.current - walk;
  };

  const getBlockStyle = (code: string) => {
    if (!code) return "bg-slate-50 border-slate-200 text-transparent"; 
    if (code === 'O') return "bg-blue-50 border-blue-400 text-blue-600 shadow-sm"; 
    if (code === 'X') return "bg-red-50 border-red-400 text-red-600 shadow-sm"; 
    if (code === 'TO') return "bg-emerald-50 border-emerald-400 text-emerald-600 shadow-sm"; 
    if (code === 'TX') return "bg-rose-50 border-rose-400 text-rose-600 shadow-sm"; 
    if (code === '☆') return "bg-amber-50 border-amber-400 text-amber-600 shadow-sm"; 
    if (code === 'B') return "bg-slate-100 border-slate-400 text-slate-600 shadow-sm"; 
    if (code === 'DONE') return "bg-indigo-50 border-indigo-300 text-indigo-600 shadow-sm"; 
    if (code === 'HOMEWORK') return "bg-yellow-50 border-yellow-400 text-yellow-600 shadow-sm"; 
    return "bg-slate-50 border-slate-200 text-transparent";
  };

  const getCodeLabel = (code: string) => {
    if (!code) return "";
    if (code === 'DONE') return "✔";
    if (code === 'HOMEWORK') return "과제";
    return code; 
  };

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
    <div className="fixed inset-0 z-[9999] flex justify-center items-center bg-slate-900/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out] p-4 sm:p-6 font-pretendard">
      
      <div className="bg-white w-full max-w-[1100px] h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0 select-none">
          <div>
             <h2 className="text-xl font-black text-slate-800 flex items-center gap-2 tracking-tight">
               <span>🔍</span> 상세 진도 매트릭스 뷰
             </h2>
             <div className="flex items-center gap-3 mt-1.5">
               <span className="text-[12px] font-extrabold text-[#002864] bg-blue-50 px-2.5 py-0.5 rounded border border-blue-200 shadow-sm">{data.bookTitle}</span>
               <span className="text-[11px] font-bold text-slate-400">* 표 안을 잡고 끌거나, 박스를 클릭하면 문제가 뜹니다.</span>
             </div>
             
             <div className="flex items-center gap-2 bg-white px-2.5 py-1 rounded-md border border-slate-200 shadow-sm flex-wrap mt-2">
                 <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1"><span className="w-2.5 h-3.5 rounded-sm bg-blue-50 border border-blue-400 inline-block shadow-sm"></span>O</span>
                 <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1"><span className="w-2.5 h-3.5 rounded-sm bg-red-50 border border-red-400 inline-block shadow-sm"></span>X</span>
                 <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1"><span className="w-2.5 h-3.5 rounded-sm bg-emerald-50 border border-emerald-400 inline-block shadow-sm"></span>TO</span>
                 <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1"><span className="w-2.5 h-3.5 rounded-sm bg-rose-50 border border-rose-400 inline-block shadow-sm"></span>TX</span>
                 <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1"><span className="w-2.5 h-3.5 rounded-sm bg-amber-50 border border-amber-400 inline-block shadow-sm"></span>☆</span>
                 <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1"><span className="w-2.5 h-3.5 rounded-sm bg-slate-100 border border-slate-400 inline-block shadow-sm"></span>B</span>
                 <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1"><span className="w-2.5 h-3.5 rounded-sm bg-indigo-50 border border-indigo-300 inline-block shadow-sm"></span>✔</span>
             </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex bg-slate-200/60 rounded-lg p-1 border border-slate-300/50 shadow-inner">
              <button 
                onMouseDown={() => startContinuousScroll('left')}
                onMouseUp={stopContinuousScroll}
                onMouseLeave={stopContinuousScroll}
                onTouchStart={() => startContinuousScroll('left')}
                onTouchEnd={stopContinuousScroll}
                className="px-4 py-1.5 bg-white hover:bg-slate-50 rounded-md text-slate-600 font-bold shadow-sm transition-transform active:scale-95 text-[11px] flex items-center gap-1 select-none pointer-events-auto"
              >
                ◀ 좌로 이동
              </button>
              <div className="w-1"></div>
              <button 
                onMouseDown={() => startContinuousScroll('right')}
                onMouseUp={stopContinuousScroll}
                onMouseLeave={stopContinuousScroll}
                onTouchStart={() => startContinuousScroll('right')}
                onTouchEnd={stopContinuousScroll}
                className="px-4 py-1.5 bg-white hover:bg-slate-50 rounded-md text-slate-600 font-bold shadow-sm transition-transform active:scale-95 text-[11px] flex items-center gap-1 select-none pointer-events-auto"
              >
                우로 이동 ▶
              </button>
            </div>

            <button onClick={onClose} className="text-slate-400 hover:text-rose-500 transition-colors bg-white hover:bg-rose-50 p-2 rounded-full shadow-sm border border-slate-200">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
        </div>
        
        <div 
          ref={scrollRef}
          onMouseDown={onMouseDown}
          onMouseLeave={onMouseLeave}
          onMouseUp={onMouseUp}
          onMouseMove={onMouseMove}
          className="flex-1 overflow-auto custom-scroll relative bg-slate-100/50"
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
           {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                 <div className="w-10 h-10 border-4 border-[#002864] border-t-transparent rounded-full animate-spin"></div>
                 <div className="font-extrabold text-slate-500 text-sm">상세 채점 데이터를 매핑 중입니다...</div>
              </div>
           ) : data.pages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 font-bold">
                <span className="text-4xl mb-3 opacity-50">📭</span>
                교재에 등록된 문항이 없습니다.
              </div>
           ) : (
             <table className="w-max border-collapse select-none">
               <thead>
                 <tr>
                   <th className="sticky top-0 left-0 z-30 bg-[#f8fafc] border-b border-r border-slate-300 py-2.5 px-3 shadow-[2px_2px_5px_rgba(0,0,0,0.05)] w-24 min-w-[96px] text-center">
                     <span className="text-[11px] font-black text-slate-500">학생명</span>
                   </th>
                   {data.pages.map(p => (
                     <th key={p} id={`page-col-${p}`} className="sticky top-0 z-20 bg-white border-b border-r border-slate-200 py-2 px-2 text-center min-w-[70px] shadow-[0_2px_5px_rgba(0,0,0,0.02)]">
                       <span className="text-[12px] font-black text-[#002864]">{p}p</span>
                     </th>
                   ))}
                 </tr>
               </thead>
               <tbody>
                 {data.students.map((stu, sIdx) => (
                   <tr key={stu.id} className="group hover:bg-blue-50/20 transition-colors">
                     <td className={`sticky left-0 z-10 border-b border-r border-slate-300 py-2 px-3 font-black text-[12px] text-slate-700 shadow-[2px_0_5px_rgba(0,0,0,0.03)] group-hover:bg-blue-50/50 ${sIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}`}>
                       <div className="truncate w-full text-center">{stu.name}</div>
                     </td>
                     
                     {data.pages.map(p => {
                       const pageQs = data.groupedQs[p] || [];
                       return (
                         <td key={p} className={`border-b border-r border-slate-200 p-1.5 align-top group-hover:bg-blue-50/10 ${sIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}`}>
                           <div className="flex flex-wrap gap-[2px] justify-start max-w-[120px]">
                             {pageQs.map((q: any) => {
                               const code = ansMap[stu.id]?.[q.tq_id];
                               const displayQNum = String(q.question_number || '').replace(/TWIN/gi, 'T').replace(/SIMILAR/gi, 'S').replace(/CLINIC/gi, 'C');
                               return (
                                 <div 
                                    key={q.tq_id} 
                                    title={`${p}p ${displayQNum}번 문항`} 
                                    onClick={() => {
                                      if (dragDistance.current > 5) return; 
                                      setSelectedQ(q);
                                    }}
                                    className={`w-[20px] h-[20px] flex items-center justify-center rounded-[3px] border hover:scale-125 transition-transform text-[9px] font-black tracking-tighter cursor-pointer ${getBlockStyle(code)}`}
                                 >
                                    {getCodeLabel(code)}
                                 </div>
                               );
                             })}
                           </div>
                         </td>
                       );
                     })}
                   </tr>
                 ))}
               </tbody>
             </table>
           )}
        </div>
      </div>

      {qData && (
        <div className="fixed inset-0 z-[200] flex justify-center items-center bg-slate-900/40 backdrop-blur-sm p-4 animate-[fadeIn_0.1s_ease-out]">
          <div className="bg-white w-full max-w-2xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-[#002864] px-5 py-3.5 flex justify-between items-center text-white shrink-0 shadow-md z-10">
              <h3 className="font-extrabold text-sm flex items-center gap-2">
                <span>🔍</span> {qData.page_number}p - {String(qData.question_number).replace(/TWIN/gi, 'T').replace(/SIMILAR/gi, 'S').replace(/CLINIC/gi, 'C')}번 문항 상세
              </h3>
              <button onClick={() => { setSelectedQ(null); setQData(null); }} className="text-white/80 hover:text-rose-400 transition-colors font-bold text-2xl leading-none">&times;</button>
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
                       dangerouslySetInnerHTML={{ __html: renderAnswer(qData.answer || qData.solution || '-') }} />
               </div>

               {qData.explanation && !(qData.step_1_concept || qData.step_2_approach || qData.step_3_process || qData.step_4_conclusion) && (
                 <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <div className="text-[11px] font-black text-slate-400 mb-2.5 border-b border-slate-100 pb-2">상세 해설</div>
                    <div className="math-text text-slate-700 font-medium whitespace-pre-wrap leading-relaxed"
                         dangerouslySetInnerHTML={{ __html: renderHTML(qData.explanation) }} />
                 </div>
               )}

               {/* 🌟 원본 스키마 컬럼명 완벽 대응 */}
               {(qData.step_1_concept || qData.step_2_approach || qData.step_3_process || qData.step_4_conclusion) && (
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
      )}

    </div>
  );
}