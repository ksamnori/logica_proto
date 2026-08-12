// src/app/exam/step2/RightPreview.tsx
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getDiffLabelByRate, getTypeName, getDepth6Name, formatText, getCleanUrl, renderParentRelations, isThinking } from "./examUtils";

export default function RightPreview({ examData }: { examData: any }) {
  const {
    router, questions, setQuestions, isLoading, showAnswer, setShowAnswer,
    depth6Map, parentSourceMap, editingId, setEditingId, editForm, setEditForm,
    handleDragStart, handleDragOver, handleDrop, openTwinSearch, goToStep3,
    draggedIdx, setDraggedIdx,
    isClinicMode // 💡 여기 isClinicMode 변수를 추가로 받아옵니다.
  } = examData;

  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).MathJax?.typesetPromise) {
      setTimeout(() => {
        (window as any).MathJax.typesetPromise().catch(() => {});
      }, 50);
    }
  }, [draggedIdx, dragOverIdx]);

  const startEditing = (q: any) => {
    setEditingId(q.question_id);
    setEditForm({
      question: q.question || '', answer: q.answer || '', explanation: q.explanation || '', solution: q.solution || '',
      step_1_concept: q.step_1_concept || '', step_2_approach: q.step_2_approach || '', step_3_process: q.step_3_process || '', step_4_conclusion: q.step_4_conclusion || ''
    });
  };

  const saveEdit = async () => {
    try {
      const realId = editingId?.includes('_added_') ? editingId.split('_added_')[0] : editingId;
      const { error } = await supabase.from('question_db').update(editForm).eq('question_id', realId);
      if (error) throw error;
      setQuestions((prev: any) => prev.map((g: any) => ({
        ...g, items: g.items.map((item: any) => item.question_id === editingId ? { ...item, ...editForm } : item)
      })));
      alert("✅ 수정이 데이터베이스에 완벽하게 반영되었습니다!");
      setEditingId(null);
    } catch(e: any) { alert("❌ 저장 실패: " + e.message); }
  };

  return (
    <section className="flex-1 flex flex-col relative bg-slate-100 min-w-0">
      <div className="bg-white px-6 py-4 border-b border-slate-200 shrink-0 flex justify-between items-center shadow-sm z-10">
        <h2 className="font-extrabold text-xl text-slate-800 flex items-center"><span className="mr-2">📝</span> 시험지 미리보기</h2>
        <div className="flex space-x-2">
          
          {/* 💡 클리닉(오답 프린트) 모드가 아닐 때만 'Step 1 가기' 버튼을 보여줍니다! */}
          {!isClinicMode && (
             <button onClick={() => router.push('/exam/step1')} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-lg transition-colors border border-slate-300">⟵ Step 1 가기</button>
          )}

          <button onClick={() => setShowAnswer(!showAnswer)} className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg transition-colors border border-blue-200">정답/해설 보기</button>
          <button onClick={goToStep3} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-md">Step 3. 배포 ➔</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 pb-32 space-y-6 scroll-smooth" id="right-problem-list">
        {isLoading ? <div className="text-center font-bold text-slate-500 mt-20 flex flex-col items-center"><svg className="animate-spin h-12 w-12 text-[#002864] mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p>DB에서 문제를 추출 중입니다...</p></div> : 
         questions.map((g: any, idx: number) => {
           const qNum = idx + 1;
           const repQ = g.items[0];
           const isThk = isThinking(repQ);
           const depth6Name = getDepth6Name(repQ, depth6Map); 
           const diffLabel = (repQ.difficulty || getDiffLabelByRate(repQ.solving_probability)).trim();
           const rateVal = repQ.solving_probability != null ? Math.round(repQ.solving_probability) + '%' : '-';
           const typeName = getTypeName(repQ);
           
           const isEditingMode = g.items.some((q: any) => editingId === q.question_id);

           const isDragged = draggedIdx === idx;
           const isDragOverTarget = dragOverIdx === idx && draggedIdx !== idx;

           let cardClass = "rounded-xl shadow-sm overflow-hidden flex flex-row group transition-all duration-200 ";
           
           if (isDragged) {
             cardClass += "opacity-40 border-2 border-dashed border-[#002864] bg-slate-50 scale-[0.98] ";
           } else if (isDragOverTarget) {
             cardClass += "border-2 border-emerald-400 bg-emerald-50/50 scale-[1.01] z-20 shadow-md ";
           } else {
             cardClass += "bg-white border border-slate-200 hover:border-blue-400 ";
           }

           if (!isEditingMode) {
             cardClass += "cursor-grab active:cursor-grabbing ";
           }

           let diffColor = "text-blue-500 bg-blue-50 border-blue-100";
           if (diffLabel === '최하') diffColor = "text-slate-500 bg-slate-100 border-slate-200";
           else if (diffLabel === '하') diffColor = "text-sky-500 bg-sky-50 border-sky-100";
           else if (diffLabel === '상') diffColor = "text-indigo-500 bg-indigo-50 border-indigo-100";
           else if (diffLabel === '최상') diffColor = "text-rose-500 bg-rose-50 border-rose-100";

           return (
             <div key={g.id} id={`problem-card-${idx}`} 
               draggable={!isEditingMode}
               onDragStart={(e) => { 
                 if(!isEditingMode) handleDragStart(e, idx); 
               }}
               onDragEnd={() => {
                 setDragOverIdx(null);
                 setDraggedIdx(null);
               }}
               onDragEnter={(e) => {
                 e.preventDefault();
                 if (draggedIdx !== null && draggedIdx !== idx) setDragOverIdx(idx);
               }}
               onDragOver={(e) => {
                 e.preventDefault();
                 handleDragOver(e);
               }}
               onDragLeave={(e) => {
                 if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                   if (dragOverIdx === idx) setDragOverIdx(null);
                 }
               }}
               onDrop={(e) => {
                 setDragOverIdx(null);
                 handleDrop(e, idx);
               }}
               className={cardClass}
             >
               <div className="w-[64px] flex flex-col items-center py-5 shrink-0 gap-1.5 border-r border-slate-200 relative pointer-events-none" style={{ backgroundColor: isDragOverTarget ? 'transparent' : '#f8fafc' }}>
                 <span className="font-lexend font-black text-[22px] text-slate-800 mb-2 mt-2">{qNum}</span>
                 <span className={`text-[11px] font-bold border px-1 py-0.5 rounded w-[45px] text-center tracking-tighter ${diffColor}`}>{diffLabel}</span>
                 {isThk && <span className="text-[10px] font-bold text-indigo-500 bg-white border border-indigo-200 px-1 py-0.5 rounded w-[45px] text-center tracking-tighter">사고력</span>}
                 <span className="text-[11px] font-bold text-slate-500 bg-white border border-slate-200 px-1 py-0.5 rounded w-[45px] text-center tracking-tighter">{rateVal}</span>
                 <span className="text-[11px] font-bold text-slate-500 bg-white border border-slate-200 px-1 py-0.5 rounded w-[45px] text-center tracking-tighter">{typeName}</span>
                 {(repQ.is_new_trend === true || repQ.is_new_trend === 'Y') && <span className="text-[10px] font-bold text-rose-500 bg-white border border-rose-200 px-1 py-0.5 rounded w-[45px] text-center tracking-tighter">신경향</span>}
               </div>
               
               <div className="flex-1 flex flex-col relative p-5 min-w-0">
                 <div className="flex justify-between items-center mb-2 border-b border-slate-100 pb-1 pointer-events-none">
                   <span className={`text-[14px] font-bold ${isDragOverTarget ? 'text-emerald-700' : 'text-slate-600'}`}>{depth6Name}</span>
                 </div>
                 
                 {g.items.map((q: any, subIdx: number) => {
                   const isEditing = editingId === q.question_id;

                   return (
                     <div key={q.question_id} className={`relative ${subIdx < g.items.length - 1 ? 'mb-8 pb-8 border-b-2 border-dashed border-slate-200' : ''}`}>
                       <div className="flex justify-between items-start mb-1">
                         <div className="flex-1 flex flex-col gap-0.5 pointer-events-none">
                           {renderParentRelations(q, parentSourceMap)}
                         </div>
                         
                         <div className="flex gap-1.5 shrink-0 z-10 relative ml-2" onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }} draggable>
                           <button onClick={() => startEditing(q)} className="p-1.5 text-slate-400 hover:text-amber-600 bg-white border border-slate-200 rounded shadow-sm" title="수정"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                           <button onClick={() => { if(confirm("문항을 시험지에서 삭제하시겠습니까?")) setQuestions(questions.filter((gItem:any) => gItem.id !== q.question_id)); }} className="p-1.5 text-slate-400 hover:text-rose-600 bg-white border border-slate-200 rounded shadow-sm" title="삭제"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                         </div>
                       </div>

                       {!isEditing ? (
                         <>
                           <div className="font-myungjo font-semibold text-[16px] text-slate-800 leading-[2.2] tracking-wide break-keep pointer-events-none" dangerouslySetInnerHTML={{ __html: formatText(q.question) }} />
                           {q.image_url && <img src={getCleanUrl(q.image_url)} className="max-w-full object-contain my-4 mix-blend-multiply rounded border border-slate-200 pointer-events-none" style={{ maxHeight: '250px' }} alt="" draggable="false" />}
                           
                           {showAnswer && (
                             <div className="mt-6 pt-5 border-t border-dashed border-slate-200 bg-white/50 p-4 rounded-lg pointer-events-none">
                               <div className="flex items-center gap-2 mb-2"><span className="text-xs font-bold text-rose-500 bg-rose-100 px-2 py-0.5 rounded">정답</span><span className="font-myungjo font-bold text-slate-700" dangerouslySetInnerHTML={{ __html: formatText(q.answer) }}></span></div>
                               {q.answer_image_url && <img src={getCleanUrl(q.answer_image_url)} className="max-w-xs mt-3 rounded border border-slate-200" alt="" draggable="false" />}
                               <div className="mt-4 pt-3 border-t border-dashed border-slate-300 text-slate-600 text-[15px] font-myungjo leading-[2.0]">
                                 {q.explanation && <div className="mb-2"><b className="text-blue-700">[해설]</b> <span dangerouslySetInnerHTML={{ __html: formatText(q.explanation) }} /></div>}
                                 {q.solution && <div className="mb-2"><b className="text-blue-700">[풀이]</b> <span dangerouslySetInnerHTML={{ __html: formatText(q.solution) }} /></div>}
                                 {q.step_1_concept && <div className="mb-2"><b className="text-blue-700">[개념]</b> <span dangerouslySetInnerHTML={{ __html: formatText(q.step_1_concept) }} /></div>}
                                 {q.step_2_approach && <div className="mb-2"><b className="text-blue-700">[접근]</b> <span dangerouslySetInnerHTML={{ __html: formatText(q.step_2_approach) }} /></div>}
                                 {q.step_3_process && <div className="mb-2"><b className="text-blue-700">[풀이과정]</b> <span dangerouslySetInnerHTML={{ __html: formatText(q.step_3_process) }} /></div>}
                                 {q.step_4_conclusion && <div><b className="text-rose-600">[결론]</b> <span dangerouslySetInnerHTML={{ __html: formatText(q.step_4_conclusion) }} /></div>}
                               </div>
                             </div>
                           )}
                         </>
                       ) : (
                         <div className="p-5 bg-amber-50 rounded-xl border border-amber-200 shadow-inner cursor-default mt-2" onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }} draggable>
                           <label className="block text-[12px] font-extrabold text-amber-800 mb-1">📝 문제 수정</label>
                           <textarea value={editForm.question} onChange={e => setEditForm({...editForm, question: e.target.value})} className="w-full p-3 border border-amber-300 rounded mb-3 text-[14px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={3}></textarea>
                           
                           <label className="block text-[12px] font-extrabold text-amber-800 mb-1">🎯 정답 수정</label>
                           <textarea value={editForm.answer} onChange={e => setEditForm({...editForm, answer: e.target.value})} className="w-full p-2 border border-amber-300 rounded mb-3 text-[14px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={1}></textarea>
                           
                           <label className="block text-[12px] font-extrabold text-amber-800 mb-1 mt-2">📖 일반 해설 및 풀이</label>
                           <div className="flex gap-2 mb-3">
                               <textarea value={editForm.explanation} onChange={e => setEditForm({...editForm, explanation: e.target.value})} className="w-1/2 p-2 border border-amber-300 rounded text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={2} placeholder="일반 해설"></textarea>
                               <textarea value={editForm.solution} onChange={e => setEditForm({...editForm, solution: e.target.value})} className="w-1/2 p-2 border border-amber-300 rounded text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={2} placeholder="일반 풀이"></textarea>
                           </div>

                           <label className="block text-[12px] font-extrabold text-amber-800 mb-1 mt-2">🔍 단계별 해설 (스텝 1~4)</label>
                           <div className="grid grid-cols-2 gap-2 mb-3">
                               <textarea value={editForm.step_1_concept} onChange={e => setEditForm({...editForm, step_1_concept: e.target.value})} className="w-full p-2 border border-amber-300 rounded text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={2} placeholder="[스텝 1: 개념 및 접근법]"></textarea>
                               <textarea value={editForm.step_2_approach} onChange={e => setEditForm({...editForm, step_2_approach: e.target.value})} className="w-full p-2 border border-amber-300 rounded text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={2} placeholder="[스텝 2: 풀이 전략]"></textarea>
                               <textarea value={editForm.step_3_process} onChange={e => setEditForm({...editForm, step_3_process: e.target.value})} className="w-full p-2 border border-amber-300 rounded text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={2} placeholder="[스텝 3: 풀이 과정]"></textarea>
                               <textarea value={editForm.step_4_conclusion} onChange={e => setEditForm({...editForm, step_4_conclusion: e.target.value})} className="w-full p-2 border border-amber-300 rounded text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 custom-scrollbar cursor-text bg-white" rows={2} placeholder="[스텝 4: 결론]"></textarea>
                           </div>

                           <div className="flex justify-end gap-2 mt-4">
                               <button onClick={() => setEditingId(null)} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 font-bold text-xs rounded hover:bg-slate-50 shadow-sm cursor-pointer">취소</button>
                               <button onClick={saveEdit} className="px-4 py-2 bg-[#002864] text-white font-bold text-xs rounded hover:bg-blue-900 shadow-sm cursor-pointer">💾 각각 저장</button>
                           </div>
                         </div>
                       )}
                       
                       <div className="mt-4 flex justify-end" onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }} draggable>
                         <button onClick={() => openTwinSearch(idx, subIdx, q)} className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 font-bold text-[12px] rounded shadow-sm flex items-center gap-1.5">
                           <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 00-2-2v8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                           쌍둥이 유사 검색
                         </button>
                       </div>
                     </div>
                   );
                 })}
               </div>
             </div>
           );
         })
        }
      </div>
    </section>
  );
}