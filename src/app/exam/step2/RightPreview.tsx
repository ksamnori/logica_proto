// src/app/exam/step2/RightPreview.tsx
import React, { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { getDiffLabelByRate, getTypeName, getDepth6Name, formatText, getCleanUrl, isThinking, processGroupText } from "./examUtils";

export default function RightPreview({ examData }: { examData: any }) {
  const {
    router, questions, setQuestions, isLoading, showAnswer, setShowAnswer,
    depth6Map, editingId, setEditingId, editForm, setEditForm,
    handleDragStart, handleDragOver, handleDrop, openTwinSearch, goToStep3,
    draggedIdx, setDraggedIdx,
    isClinicMode, isRestoredMode
  } = examData;

  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [previewBadge, setPreviewBadge] = useState<string | null>(null);

  // AI 유사생성 및 교체 모달 관련 상태
  const [isTwinModalOpen, setIsTwinModalOpen] = useState(false);
  const [isGeneratingTwins, setIsGeneratingTwins] = useState(false);
  const [generatedTwins, setGeneratedTwins] = useState<any[]>([]);
  const [aiTargetInfo, setAiTargetInfo] = useState<{ idx: number, subIdx: number, q: any } | null>(null);
  const [isSavingTwin, setIsSavingTwin] = useState(false);

  useEffect(() => {
    const examMode = sessionStorage.getItem("examMode"); 
    const testCategory = sessionStorage.getItem("testCategory");
    const storedTitle = sessionStorage.getItem("examTitle");
    const storedBadge = sessionStorage.getItem("examSubTitle");

    if (isClinicMode) {
      setPreviewTitle(storedTitle || "오답 클리닉 문항");
      setPreviewBadge(storedBadge || "맞춤형 클리닉");
    } else if (isRestoredMode) {
      setPreviewTitle(storedTitle || "출제 문항 미리보기");
      setPreviewBadge(storedBadge || "편집 모드");
    } else if (examMode === "test" && testCategory) {
      setPreviewTitle(`[${testCategory}] 출제 문항`);
      setPreviewBadge("테스트 전용");
    } else if (examMode === "regular" || examMode === "thinking") {
      setPreviewTitle(storedTitle || "신규 출제 시험지");
      setPreviewBadge(examMode === "regular" ? "정규 교과" : "사고력 교과");
    } else {
      setPreviewTitle(storedTitle || "출제 문항 미리보기");
      setPreviewBadge(storedBadge || "편집 모드");
    }
  }, [questions, isClinicMode, isRestoredMode]);

  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).MathJax?.typesetPromise) {
      setTimeout(() => {
        (window as any).MathJax.typesetPromise().catch(() => {});
      }, 50);
    }
  }, [draggedIdx, dragOverIdx, generatedTwins, isTwinModalOpen]);

  const forceMathRefresh = () => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise) {
      mj.typesetClear();
      mj.typesetPromise().catch((err: any) => console.error("MathJax 강제 새로고침 에러:", err));
    }
  };

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

  const unmergeGroup = (groupId: string) => {
    if (!confirm("병합을 해제하여 각 문항을 독립적으로 분리하시겠습니까?")) return;
    setQuestions((prev: any[]) => {
      const newQs: any[] = [];
      for (const g of prev) {
        if (g.id === groupId) {
          if (g.items.length > 1) {
            g.items.forEach((item: any, i: number) => {
              newQs.push({
                id: `unmerged_${Date.now()}_${item.question_id}_${i}`,
                is_group: false,
                is_merged_text: false,
                items: [item],
                sort_order: g.sort_order + (i * 0.01)
              });
            });
          } else {
             newQs.push({ ...g, is_merged_text: false });
          }
        } else {
          newQs.push(g);
        }
      }
      return newQs;
    });
  };

  const openAiTwinModal = (idx: number, subIdx: number, q: any) => {
    setAiTargetInfo({ idx, subIdx, q });
    setGeneratedTwins([]);
    setIsTwinModalOpen(true);
  };

  const handleManualCreate = () => {
    setGeneratedTwins([{
       question_type: '유사',
       question: aiTargetInfo?.q.question || '',
       answer: aiTargetInfo?.q.answer || '',
       step_1_concept: aiTargetInfo?.q.step_1_concept || '',
       step_2_approach: aiTargetInfo?.q.step_2_approach || '',
       step_3_process: aiTargetInfo?.q.step_3_process || '',
       step_4_conclusion: aiTargetInfo?.q.step_4_conclusion || '',
       isSelected: true,
       isPreviewMode: false
    }]);
  };

  const handleTriggerAIGeneration = async () => {
    if (!aiTargetInfo) return;
    setIsGeneratingTwins(true);
    setGeneratedTwins([]);

    try {
      const taxStr = getDepth6Name(aiTargetInfo.q, depth6Map) || '분류 정보 없음';
      
      const res = await fetch('/api/gemini-twin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          originalQuestion: aiTargetInfo.q.question, 
          originalAnswer: aiTargetInfo.q.answer, 
          taxonomyStr: taxStr,
          step1Concept: aiTargetInfo.q.step_1_concept || '',
          step2Approach: aiTargetInfo.q.step_2_approach || '',
          step3Process: aiTargetInfo.q.step_3_process || '',
          step4Conclusion: aiTargetInfo.q.step_4_conclusion || ''
        })
      });

      const contentType = res.headers.get("content-type");
      if (!res.ok || !contentType?.includes("application/json")) throw new Error(`AI 서버 연결 오류 (${res.status})`);

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const cleanedTwins = data.data.map((twin: any, idx: number) => ({
        ...twin,
        question: twin.question?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
        answer: twin.answer?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
        step_1_concept: twin.step_1_concept?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
        step_2_approach: twin.step_2_approach?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
        step_3_process: twin.step_3_process?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
        step_4_conclusion: twin.step_4_conclusion?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
        isSelected: idx === 0,
        isPreviewMode: false,
        question_type: twin.question_type || (idx === 0 ? '쌍둥이' : '유사')
      }));

      setGeneratedTwins(cleanedTwins);
    } catch (e: any) {
      console.error(e);
      alert("AI 쌍둥이/유사 생성 중 오류 발생: " + e.message);
    } finally {
      setIsGeneratingTwins(false);
    }
  };

  const handleTwinChange = (index: number, field: string, value: any) => {
    setGeneratedTwins(prev => {
      const next = [...prev];
      if (field === 'isSelected' && value === true) {
         next.forEach((t, i) => next[i] = { ...t, isSelected: i === index });
      } else {
         next[index] = { ...next[index], [field]: value };
      }
      return next;
    });
  };

  const saveTwinAndReplace = async () => {
    const selectedTwin = generatedTwins.find(t => t.isSelected);
    if (!selectedTwin) return alert("교체할 문항을 1개 선택해주세요.");
    if (!aiTargetInfo) return;

    setIsSavingTwin(true);
    try {
      const generateUUID = () => {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
          return v.toString(16);
        });
      };
      
      const dbInserts = [];
      let selectedQuestionUiData = null;

      for (let i = 0; i < generatedTwins.length; i++) {
        const twin = generatedTwins[i];
        const newQid = generateUUID();
        
        // 🚨 [핵심 에러 해결] 원본 속성 통째 복사(...aiTargetInfo.q) 제거!
        // question_db 테이블에 실제로 존재하는 컬럼만 명시적으로 담아 DB 에러를 막습니다.
        const dbData = {
          source_book_name: aiTargetInfo.q.source_book_name,
          book_name: aiTargetInfo.q.book_name,
          pdf_source: aiTargetInfo.q.pdf_source,
          final_printed_page: aiTargetInfo.q.final_printed_page,
          detected_page_num: aiTargetInfo.q.detected_page_num,
          question_number: aiTargetInfo.q.question_number,
          sub_num: aiTargetInfo.q.sub_num,
          difficulty: aiTargetInfo.q.difficulty,
          taxonomy_id: aiTargetInfo.q.taxonomy_id,
          taxonomy_name: aiTargetInfo.q.taxonomy_name,
          options: aiTargetInfo.q.options,
          image_url: aiTargetInfo.q.image_url,
          image_2_url: aiTargetInfo.q.image_2_url,
          is_new_trend: aiTargetInfo.q.is_new_trend,
          ai_gradable: aiTargetInfo.q.ai_gradable,

          question_id: newQid,
          question: twin.question,
          answer: twin.answer,
          step_1_concept: twin.step_1_concept,
          step_2_approach: twin.step_2_approach,
          step_3_process: twin.step_3_process,
          step_4_conclusion: twin.step_4_conclusion,
          problem_type: twin.question_type || '유사', 
          parent_question_id: aiTargetInfo.q.question_id, 
          derivation_type: twin.question_type === '유사' ? '유사' : 'TWIN',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        dbInserts.push(dbData);
        
        if (twin.isSelected) {
          // 🚨 화면에 보여지는 UI 상태는 기존 프론트 전용 속성(sort_order, id 등)이 유지되어야 합니다.
          selectedQuestionUiData = {
            ...aiTargetInfo.q,
            ...dbData
          };
        }
      }

      // 1. 순수 DB 속성만 필터링한 데이터 Insert (이제 에러 발생 안함)
      const { error } = await supabase.from('question_db').insert(dbInserts);
      if (error) throw error;

      // 옵션: 연동 교재 테이블에도 삽입
      if (aiTargetInfo.q.source_book_name) {
         const { data: tb } = await supabase.from('textbook').select('book_id').eq('title', aiTargetInfo.q.source_book_name).maybeSingle();
         if (tb) {
            const tqInserts = dbInserts.map(q => ({
               book_id: tb.book_id,
               question_id: q.question_id,
               page_number: q.final_printed_page || 999,
               question_number: q.question_number,
               question: q.question,
               answer: q.answer,
               taxonomy_id: q.taxonomy_id,
               question_category: '일반'
            }));
            await supabase.from('textbook_question').insert(tqInserts);
         }
      }

      // 🚨 2. (추가 안정성) 현재 시험지 기록에 연결된 문항이었다면, 새 문제 ID로 갈아끼워줍니다.
      if (aiTargetInfo.q.exam_item_id) {
         await supabase.from('exam_item')
           .update({ question_id: selectedQuestionUiData.question_id })
           .eq('exam_item_id', aiTargetInfo.q.exam_item_id);
      }

      // 3. 화면 UI 교체 적용
      setQuestions((prev: any[]) => {
        const newQs = [...prev];
        const group = { ...newQs[aiTargetInfo.idx] };
        group.items = [...group.items];
        group.items[aiTargetInfo.subIdx] = selectedQuestionUiData;
        newQs[aiTargetInfo.idx] = group;
        return newQs;
      });

      alert(`✅ ${dbInserts.length}개의 AI 문항이 모두 DB에 저장되었으며, 선택한 문항으로 즉시 교체되었습니다!`);
      setIsTwinModalOpen(false);
    } catch (err: any) {
      alert("❌ 교체 및 저장 중 에러가 발생했습니다: " + err.message);
    } finally {
      setIsSavingTwin(false);
    }
  };

  return (
    <section className="flex-1 flex flex-col relative bg-slate-100 min-w-0">
      <div className="bg-white px-6 py-4 border-b border-slate-200 shrink-0 flex justify-between items-center shadow-sm z-10">
        <div>
          <h2 className="font-extrabold text-xl text-slate-800 flex items-center"><span className="mr-2">📝</span> 시험지 미리보기</h2>
          {(previewTitle || previewBadge) && (
             <div className="flex items-center gap-2 mt-1.5 animate-[fadeIn_0.3s_ease-out]">
               {previewBadge && <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded shadow-sm">{previewBadge}</span>}
               {previewTitle && <span className="text-[13px] font-bold text-slate-600">{previewTitle}</span>}
             </div>
          )}
        </div>
        <div className="flex space-x-2 items-center">
          
          <button onClick={forceMathRefresh} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-lg transition-colors border border-slate-300">
            <span>🔄</span> 수식 깨짐 해결
          </button>
          
          {!isClinicMode && !isRestoredMode && (
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

           let cardClass = "rounded-xl shadow-sm overflow-hidden flex flex-row group transition-colors duration-200 border-2 ";
           if (isDragged) cardClass += "opacity-40 border-dashed border-[#002864] bg-slate-50 ";
           else if (isDragOverTarget) cardClass += "border-emerald-400 bg-emerald-50/50 z-20 shadow-md ";
           else cardClass += "bg-white border-slate-200 hover:border-blue-400 ";

           if (!isEditingMode) cardClass += "cursor-grab active:cursor-grabbing ";

           let diffColor = "text-blue-500 bg-blue-50 border-blue-100";
           if (diffLabel === '최하') diffColor = "text-slate-500 bg-slate-100 border-slate-200";
           else if (diffLabel === '하') diffColor = "text-sky-500 bg-sky-50 border-sky-100";
           else if (diffLabel === '상') diffColor = "text-indigo-500 bg-indigo-50 border-indigo-100";
           else if (diffLabel === '최상') diffColor = "text-rose-500 bg-rose-50 border-rose-100";

           const isGroupMerged = g.is_merged_text && g.items.length > 1;
           const { common, remainders } = isGroupMerged ? processGroupText(g.items) : { common: "", remainders: [] };

           return (
             <div key={g.id} id={`problem-card-${idx}`} 
               draggable={!isEditingMode}
               onDragStart={(e) => { if(!isEditingMode) handleDragStart(e, idx); }}
               onDragEnd={() => { setDragOverIdx(null); setDraggedIdx(null); }}
               onDragEnter={(e) => { e.preventDefault(); if (draggedIdx !== null && draggedIdx !== idx) setDragOverIdx(idx); }}
               onDragOver={(e) => { e.preventDefault(); handleDragOver(e); }}
               onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { if (dragOverIdx === idx) setDragOverIdx(null); } }}
               onDrop={(e) => { setDragOverIdx(null); handleDrop(e, idx); }}
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
                 <div className="flex justify-between items-center mb-1.5 pointer-events-none">
                   <span className={`text-[14px] font-bold ${isDragOverTarget ? 'text-emerald-700' : 'text-slate-600'}`}>{depth6Name}</span>
                 </div>
                 
                 {isGroupMerged && common && !isEditingMode && (
                   <div className="font-myungjo font-semibold text-[16px] text-slate-800 leading-[2.2] tracking-wide break-keep pointer-events-none mb-4" dangerouslySetInnerHTML={{ __html: formatText(common) }} />
                 )}

                 {g.items.map((q: any, subIdx: number) => {
                   const isEditing = editingId === q.question_id;
                   const textToRender = isGroupMerged && remainders[subIdx] ? remainders[subIdx] : (q.question || q.text_question || '');
                   
                   // 🌟 쌍둥이 및 유사 라벨 판별 로직
                   const isTwin = q.problem_type === '쌍둥이' || q.derivation_type === 'TWIN' || q.derivation_type === '쌍둥이';
                   const isSimilar = q.problem_type === '유사' || q.derivation_type === '유사';

                   return (
                     <div key={q.question_id} className={`relative ${subIdx < g.items.length - 1 ? 'mb-8 pb-8 border-b-2 border-dashed border-slate-200' : ''}`}>
                       <div className="flex justify-between items-start mb-0">
                         <div className="flex-1 flex items-center pointer-events-none mb-2">
                           <div className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
                             <span className="bg-slate-100 text-slate-500 px-1.5 py-[2px] rounded border border-slate-200 leading-none">출처</span>
                             <span className="leading-none mt-0.5 flex items-center">
                               {isTwin && <span className="text-fuchsia-600 font-black mr-1.5">[쌍둥이]</span>}
                               {isSimilar && <span className="text-amber-600 font-black mr-1.5">[유사]</span>}
                               {q.source_book_name || q.book_name || q.pdf_source || '출처 정보 없음'}
                               {q.final_printed_page || q.detected_page_num ? ` p.${String(q.final_printed_page || q.detected_page_num).replace(/p/gi, '').trim()}` : ''}
                               {q.question_number ? ` ${String(q.question_number).replace(/번/g, '').trim()}${q.sub_num && String(q.sub_num) !== '0' ? `-${q.sub_num}` : ''}번` : ''}
                             </span>
                           </div>
                         </div>
                         
                         <div className="flex gap-1.5 shrink-0 z-10 relative ml-2" onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }} draggable>
                           {isGroupMerged && subIdx === 0 && (
                             <button onClick={() => unmergeGroup(g.id)} className="p-1.5 text-slate-400 hover:text-indigo-600 bg-white border border-slate-200 rounded shadow-sm" title="병합 해제">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"></path></svg>
                             </button>
                           )}
                           <button onClick={() => startEditing(q)} className="p-1.5 text-slate-400 hover:text-amber-600 bg-white border border-slate-200 rounded shadow-sm" title="수정"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                           <button onClick={() => { if(confirm("문항을 시험지에서 삭제하시겠습니까?")) setQuestions(questions.map((gItem:any) => gItem.id === g.id ? { ...gItem, items: gItem.items.filter((i:any) => i.question_id !== q.question_id) } : gItem).filter((gItem:any) => gItem.items.length > 0)); }} className="p-1.5 text-slate-400 hover:text-rose-600 bg-white border border-slate-200 rounded shadow-sm" title="삭제"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                         </div>
                       </div>

                       {!isEditing ? (
                         <>
                           <div className="flex gap-1.5 items-start mt-0">
                             <div className="flex-1 space-y-3">
                               {textToRender && <div className="font-myungjo font-semibold text-[16px] text-slate-800 leading-[2.2] tracking-wide break-keep pointer-events-none" dangerouslySetInnerHTML={{ __html: formatText(textToRender) }} />}
                               {q.image_url && <img src={getCleanUrl(q.image_url)} className="max-w-full object-contain my-4 mix-blend-multiply rounded border border-slate-200 pointer-events-none" style={{ maxHeight: '250px' }} alt="" draggable="false" />}
                               
                               {q.options && q.options !== 'null' && typeof q.options === 'string' && (
                                  <div className="pl-2 pt-2">
                                    {(() => {
                                      try {
                                        const opts = JSON.parse(q.options);
                                        if (Array.isArray(opts) && opts.length > 0) {
                                          return (
                                            <ul className="space-y-1.5 list-none">
                                              {opts.map((opt: string, oi: number) => (
                                                <li key={oi} className="flex gap-2 text-[15px]">
                                                  <span className="shrink-0 text-slate-500 w-5">①②③④⑤⑥⑦⑧⑨⑩[oi]</span>
                                                  <span dangerouslySetInnerHTML={{ __html: formatText(opt) }} />
                                                </li>
                                              ))}
                                            </ul>
                                          );
                                        }
                                      } catch(e) {}
                                      return null;
                                    })()}
                                  </div>
                               )}
                             </div>
                           </div>
                           
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

                           <div className="flex justify-end gap-2 mt-4">
                               <button onClick={() => setEditingId(null)} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 font-bold text-xs rounded hover:bg-slate-50 shadow-sm cursor-pointer">취소</button>
                               <button onClick={saveEdit} className="px-4 py-2 bg-[#002864] text-white font-bold text-xs rounded hover:bg-blue-900 shadow-sm cursor-pointer">💾 각각 저장</button>
                           </div>
                         </div>
                       )}
                       
                       {/* AI 생성 및 기존 문제 검색 버튼 영역 */}
                       <div className="mt-4 flex justify-end gap-2" onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }} draggable>
                         
                         <button onClick={() => openAiTwinModal(idx, subIdx, q)} className="px-3 py-1.5 bg-gradient-to-r from-fuchsia-50 to-indigo-50 hover:from-fuchsia-100 hover:to-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-[12px] rounded shadow-sm flex items-center gap-1.5 transition-colors">
                           <span className="text-[14px]">🤖</span>
                           AI 유사생성 및 교체
                         </button>

                         <button onClick={() => openTwinSearch(idx, subIdx, q)} className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 font-bold text-[12px] rounded shadow-sm flex items-center gap-1.5 transition-colors">
                           <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 00-2-2v8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                           기존 문제로 교체 검색
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

      {/* AI 유사 문항 직접 교체 모달 */}
      {isTwinModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 flex flex-col items-center justify-center p-6 sm:p-10 animate-in fade-in backdrop-blur-sm">
          <div className="bg-white w-full max-w-5xl h-full max-h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
            <div className="p-5 bg-gradient-to-r from-fuchsia-600 to-indigo-600 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-black text-white flex items-center gap-2">
                  <span>🤖</span> AI 유사 문항 직접 작성 및 교체
                </h2>
                <p className="text-fuchsia-100 font-bold text-xs mt-1">기존 문항을 완벽히 대체할 새 문항을 AI로 생성하거나, 직접 타이핑하여 현재 시험지에 즉시 반영합니다.</p>
              </div>
              <button onClick={() => setIsTwinModalOpen(false)} className="text-white hover:text-fuchsia-200 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors">
                닫기 ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scroll">
              {isGeneratingTwins ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                  <span className="text-5xl animate-spin">🌀</span>
                  <p className="font-extrabold text-lg">AI가 유사 문항을 창조하고 있습니다...</p>
                  <p className="text-sm font-bold text-slate-400">수식과 4단계 해설을 작성 중이므로 약 10~15초 정도 소요됩니다.</p>
                </div>
              ) : generatedTwins.length > 0 ? (
                <div className="flex flex-col gap-6">
                  {generatedTwins.map((twin, idx) => (
                    <div key={idx} className={`bg-white border rounded-2xl p-5 shadow-sm transition-all flex flex-col gap-3 ${twin.isSelected ? 'border-indigo-400 ring-2 ring-indigo-50' : 'border-slate-200 opacity-60'}`}>
                      <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                        
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input 
                            type="radio" 
                            name="aiTwinSelect"
                            checked={twin.isSelected} 
                            onChange={() => handleTwinChange(idx, 'isSelected', true)}
                            className="w-4 h-4 text-indigo-600 cursor-pointer" 
                          />
                          <span className={`px-2 py-1 rounded text-xs font-black ${twin.question_type === '유사' ? 'bg-amber-100 text-amber-700' : 'bg-fuchsia-100 text-fuchsia-700'}`}>
                            {twin.question_type === '유사' ? '💡 유사 문항으로 교체' : '👯 쌍둥이 문항으로 교체'}
                          </span>
                        </label>
                        
                        <button
                          onClick={() => handleTwinChange(idx, 'isPreviewMode', !twin.isPreviewMode)}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors shadow-sm ${twin.isPreviewMode ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                        >
                          {twin.isPreviewMode ? <><span>✏️</span> 텍스트 편집 모드</> : <><span>👀</span> 수식 미리보기</>}
                        </button>
                      </div>
                      
                      <div className="flex flex-col gap-1.5 flex-1 mt-1">
                        <label className="text-[11px] font-bold text-slate-500">새 문제 텍스트</label>
                        {twin.isPreviewMode ? (
                          <div className="w-full min-h-[6rem] p-3 text-sm border border-slate-200 rounded-lg bg-white overflow-x-auto shadow-inner whitespace-pre-wrap font-medium text-slate-800">
                            {twin.question || <span className="text-slate-400 italic text-xs">텍스트가 없습니다.</span>}
                          </div>
                        ) : (
                          <textarea value={twin.question} onChange={(e) => handleTwinChange(idx, 'question', e.target.value)} className="w-full h-24 p-3 text-sm border border-slate-300 rounded-lg bg-yellow-50/30 resize-none outline-none focus:ring-2 focus:ring-indigo-400" />
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5 mt-2">
                        <label className="text-[11px] font-bold text-slate-500">정답</label>
                        {twin.isPreviewMode ? (
                          <div className="w-full min-h-[38px] p-2 px-3 text-sm border border-slate-200 rounded-lg bg-white overflow-x-auto shadow-inner font-bold text-emerald-800 flex items-center">
                            {twin.answer || <span className="text-slate-400 italic text-xs">정답이 없습니다.</span>}
                          </div>
                        ) : (
                          <input type="text" value={twin.answer} onChange={(e) => handleTwinChange(idx, 'answer', e.target.value)} className="w-full p-2 px-3 text-sm font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
                        )}
                      </div>

                      <details className="group mt-2" open={!twin.isPreviewMode}>
                        <summary className="text-xs font-bold text-indigo-500 cursor-pointer hover:text-indigo-700 outline-none select-none flex items-center gap-1">
                          <span>▶</span> 상세 해설 (4단계) 작성/수정
                        </summary>
                        <div className="mt-3 flex flex-col gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                          {twin.isPreviewMode ? (
                            <div className="flex flex-col gap-2">
                              {twin.step_1_concept && <div className="text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 shadow-inner"><span className="font-bold text-indigo-600 mr-2">1. 개념</span>{twin.step_1_concept}</div>}
                              {twin.step_2_approach && <div className="text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 shadow-inner"><span className="font-bold text-indigo-600 mr-2">2. 접근</span>{twin.step_2_approach}</div>}
                              {twin.step_3_process && <div className="text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 shadow-inner"><span className="font-bold text-indigo-600 mr-2">3. 과정</span>{twin.step_3_process}</div>}
                              {twin.step_4_conclusion && <div className="text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 shadow-inner"><span className="font-bold text-indigo-600 mr-2">4. 결론</span>{twin.step_4_conclusion}</div>}
                            </div>
                          ) : (
                            <>
                              <textarea value={twin.step_1_concept} onChange={(e) => handleTwinChange(idx, 'step_1_concept', e.target.value)} placeholder="1. 개념" className="w-full text-xs p-2 border border-slate-300 rounded resize-none h-12 outline-none focus:border-indigo-400" />
                              <textarea value={twin.step_2_approach} onChange={(e) => handleTwinChange(idx, 'step_2_approach', e.target.value)} placeholder="2. 접근" className="w-full text-xs p-2 border border-slate-300 rounded resize-none h-12 outline-none focus:border-indigo-400" />
                              <textarea value={twin.step_3_process} onChange={(e) => handleTwinChange(idx, 'step_3_process', e.target.value)} placeholder="3. 과정" className="w-full text-xs p-2 border border-slate-300 rounded resize-none h-16 outline-none focus:border-indigo-400" />
                              <textarea value={twin.step_4_conclusion} onChange={(e) => handleTwinChange(idx, 'step_4_conclusion', e.target.value)} placeholder="4. 결론" className="w-full text-xs p-2 border border-slate-300 rounded resize-none h-12 outline-none focus:border-indigo-400" />
                            </>
                          )}
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-6">
                  <div className="text-center">
                    <div className="text-6xl mb-4">🪄</div>
                    <h3 className="text-xl font-black text-slate-800 mb-2">문제를 어떻게 만드시겠습니까?</h3>
                    <p className="text-slate-500 font-bold text-sm">AI에게 변형을 맡기거나, 직접 백지상태에서 타이핑할 수 있습니다.</p>
                  </div>
                  <div className="flex gap-4">
                    <button onClick={handleTriggerAIGeneration} className="px-6 py-4 bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:scale-105 transition-transform rounded-2xl shadow-lg text-white flex flex-col items-center gap-2 w-48">
                      <span className="text-3xl">🤖</span>
                      <span className="font-black">AI 자동 생성 시작</span>
                    </button>
                    <button onClick={handleManualCreate} className="px-6 py-4 bg-white border-2 border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 hover:scale-105 transition-transform rounded-2xl shadow-sm text-slate-700 flex flex-col items-center gap-2 w-48">
                      <span className="text-3xl">⌨️</span>
                      <span className="font-black text-indigo-700">직접 양식 작성하기</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 bg-white border-t border-slate-200 flex justify-end shrink-0">
              <button 
                onClick={saveTwinAndReplace} 
                disabled={isGeneratingTwins || generatedTwins.length === 0 || isSavingTwin}
                className="px-8 py-3 bg-[#002864] hover:bg-blue-900 disabled:bg-slate-300 text-white font-black rounded-xl shadow-lg transition-colors flex items-center gap-2"
              >
                {isSavingTwin ? "저장 중..." : `💾 생성된 ${generatedTwins.length}개 모두 DB 저장 및 선택 문항으로 교체`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}