"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

// ==========================================
// 1. 코어 유틸리티
// ==========================================
const taxSort = (a: string, b: string) => {
  const order: Record<string, number> = { '초등학교': 1, '중학교': 2, '고등학교': 3 };
  if (order[a] && order[b] && order[a] !== order[b]) return order[a] - order[b];
  return String(a).localeCompare(String(b), 'ko', { numeric: true });
};

const formatQNum = (qNum: string | number, subNum?: string | number) => {
  let numStr = String(qNum || "").trim().replace(/-0$/, '');
  if (subNum !== undefined && subNum !== null && String(subNum).trim() !== "") {
    const cleanSubNum = String(subNum).replace(/[()]/g, '').trim();
    if (cleanSubNum !== "") numStr = `${numStr}-${cleanSubNum}`;
  }
  return numStr.replace(/-0$/, '');
};

const parseNatural = (str: string) => {
  return String(str || "").match(/(\d+)|(\D+)/g)?.map(part => {
    const num = parseInt(part, 10);
    return isNaN(num) ? part : num;
  }) || [];
};

const compareNatural = (strA: string, strB: string) => {
  const partsA = parseNatural(strA);
  const partsB = parseNatural(strB);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const partA = partsA[i];
    const partB = partsB[i];
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;
    if (typeof partA === 'number' && typeof partB === 'number') {
      if (partA !== partB) return partA - partB; 
    } else if (typeof partA === 'string' && typeof partB === 'string') {
      const cmp = String(partA).localeCompare(String(partB));
      if (cmp !== 0) return cmp; 
    } else {
      return typeof partA === 'number' ? -1 : 1;
    }
  }
  return 0;
};

const sortQuestionsList = (data: any[]) => {
  return [...data].sort((a, b) => {
    const parsePage = (p1: any, p2: any) => {
      const v1 = parseInt(String(p1));
      if (!isNaN(v1) && v1 > 0) return v1;
      const v2 = parseInt(String(p2));
      if (!isNaN(v2) && v2 > 0) return v2;
      return 99999;
    };
    const pageA = parsePage(a.final_printed_page, a.detected_page_num);
    const pageB = parsePage(b.final_printed_page, b.detected_page_num);
    if (pageA !== pageB) return pageA - pageB;

    const dispA = formatQNum(a.question_number, a.sub_num);
    const dispB = formatQNum(b.question_number, b.sub_num);
    return compareNatural(dispA, dispB);
  });
};

const fetchAllRows = async (tableName: string, selectQuery: string = '*') => {
  let allData: any[] = [];
  let start = 0;
  const step = 1000;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase.from(tableName).select(selectQuery).range(start, start + step - 1);
    if (error) break;
    if (data && data.length > 0) { allData = [...allData, ...data]; start += step; }
    if (!data || data.length < step) hasMore = false; 
  }
  return allData;
};

// ==========================================
// 2. 메인 컴포넌트
// ==========================================
interface ColumnData {
  id: string;
  title: string;
  bookName: string;
  questions: any[];
  theme: string;
}

export default function TwinManagerPage() {
  const [workbooks, setWorkbooks] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const [selectedQIds, setSelectedQIds] = useState<string[]>([]);
  const [editingQ, setEditingQ] = useState<any | null>(null);

  // 🌟 업데이트: AI 모달용 상태 관리 추가
  const [isTwinModalOpen, setIsTwinModalOpen] = useState(false);
  const [isGeneratingTwins, setIsGeneratingTwins] = useState(false);
  const [generatedTwins, setGeneratedTwins] = useState<any[]>([]);

  const mathJaxRef = useRef<boolean>(false);

  const [columns, setColumns] = useState<ColumnData[]>([
    { id: 'col1', title: '1. 본교재', bookName: '', questions: [], theme: 'indigo' },
    { id: 'col2', title: '2. 워크북', bookName: '', questions: [], theme: 'emerald' },
    { id: 'col3', title: '3. 추가문제', bookName: '', questions: [], theme: 'violet' },
    { id: 'col4', title: '4. 수동 배정 (쌍둥이)', bookName: '', questions: [], theme: 'fuchsia' },
    { id: 'col5', title: '5. 수동 배정 (유사)', bookName: '', questions: [], theme: 'amber' },
  ]);

  useEffect(() => {
    loadWorkbooks();
    loadMathJax();
  }, []);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { 
        tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] }, 
        startup: { typeset: false } 
      };
      const script = document.createElement("script"); 
      script.id = "MathJax-script"; 
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"; 
      script.async = true;
      document.head.appendChild(script);
    }
  };

  const forceMathJaxRender = () => {
    setTimeout(() => {
      const w = window as any;
      if (w.MathJax && w.MathJax.typesetPromise) {
        if (w.MathJax.typesetClear) w.MathJax.typesetClear();
        w.MathJax.typesetPromise().catch((err: any) => console.log("MathJax 에러:", err));
      }
    }, 150);
  };

  const loadWorkbooks = async () => {
    try {
      const tbData = await fetchAllRows('textbook', 'title');
      const qbData = await fetchAllRows('question_db', 'source_book_name');
      const titles = tbData.map(t => t.title);
      const sources = qbData.map(q => q.source_book_name);
      
      const uniqueList = Array.from(new Set([...titles, ...sources])).filter(Boolean).sort(taxSort);
      setWorkbooks(uniqueList as string[]);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchColumnData = async (colIndex: number, targetBookName: string) => {
    const newCols = [...columns];
    newCols[colIndex].bookName = targetBookName;
    
    if (!targetBookName.trim()) {
      newCols[colIndex].questions = [];
      setColumns(newCols);
      return;
    }

    setIsLoading(true);
    try {
      const qidSet = new Set<string>();

      let from1 = 0;
      while(true) {
        const { data, error } = await supabase.from("question_db")
          .select("question_id")
          .or(`source_book_name.eq.${targetBookName},book_name.eq.${targetBookName}`)
          .range(from1, from1 + 999);
        if (error) throw error;
        if (data) data.forEach(d => qidSet.add(String(d.question_id).trim()));
        if (!data || data.length < 1000) break;
        from1 += 1000;
      }

      const { data: tb } = await supabase.from('textbook').select('book_id').eq('title', targetBookName).maybeSingle();
      if (tb) {
        let from2 = 0;
        while(true) {
          const { data, error } = await supabase.from('textbook_question')
            .select('question_id')
            .eq('book_id', tb.book_id)
            .range(from2, from2 + 999);
          if (error) throw error;
          if (data) data.forEach(d => qidSet.add(String(d.question_id).trim()));
          if (!data || data.length < 1000) break;
          from2 += 1000;
        }
      }

      let fetchedQuestions: any[] = [];
      const qidArray = Array.from(qidSet);
      for (let i = 0; i < qidArray.length; i += 500) {
        const chunk = qidArray.slice(i, i + 500);
        const { data, error } = await supabase.from("question_db").select("*").in("question_id", chunk);
        if (error) throw error;
        if (data) fetchedQuestions.push(...data);
      }

      newCols[colIndex].questions = sortQuestionsList(fetchedQuestions);
      setColumns(newCols);
      forceMathJaxRender();
    } catch (e: any) {
      alert("데이터 조회 중 오류: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  // 1. TwinManagerPage 컴포넌트 내부에 함수 추가 (fetchColumnData 아래쯤에 배치)
  const handleRenameColumnBook = async (colIndex: number, currentName: string) => {
    if (!currentName) return alert("이름을 변경할 교재가 없습니다.");
    
    const newName = prompt(`현재 묶음 이름: ${currentName}\n\n새로운 교재(묶음) 이름을 입력하세요:\n(이 작업은 마스터 DB의 이름을 통째로 변경합니다.)`, currentName);
    
    if (!newName || newName.trim() === "" || newName.trim() === currentName) return;

    setIsLoading(true);
    try {
      // 1) question_db 업데이트
      const { error: qErr } = await supabase.from('question_db')
        .update({ source_book_name: newName.trim(), book_name: newName.trim() })
        .or(`source_book_name.eq.${currentName},book_name.eq.${currentName}`);
      
      if (qErr) throw qErr;

      // 2) textbook 테이블 업데이트 (본교재로 등록된 경우)
      const { data: tb } = await supabase.from('textbook').select('book_id').eq('title', currentName).maybeSingle();
      if (tb) {
        await supabase.from('textbook').update({ title: newName.trim() }).eq('book_id', tb.book_id);
      }

      alert(`✅ '${newName.trim()}'(으)로 이름이 통째로 변경되었습니다!`);

      // 3) 상태 및 화면 업데이트
      setColumns(prev => {
        const newCols = [...prev];
        newCols[colIndex].bookName = newName.trim();
        newCols[colIndex].questions = newCols[colIndex].questions.map(q => ({
          ...q,
          source_book_name: newName.trim(),
          book_name: newName.trim()
        }));
        return newCols;
      });
      
      loadWorkbooks(); // 콤보박스 자동완성 리스트 갱신

    } catch (err: any) {
      alert("이름 변경 실패: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const allQuestionsMap = React.useMemo(() => {
    const map = new Map();
    columns.forEach(col => {
      col.questions.forEach(q => map.set(q.question_id, q));
    });
    return map;
  }, [columns]);

  const scrollToQuestion = (targetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const el = document.getElementById(`q-card-${targetId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-4', 'ring-rose-400', 'animate-pulse');
      setTimeout(() => el.classList.remove('ring-4', 'ring-rose-400', 'animate-pulse'), 1500);
    } else {
      alert("해당 문항이 현재 5개 탭 화면 중 어디에도 로드되어 있지 않습니다.");
    }
  };

  // ==========================================
  // 3. 🌟 생성된 문항 모달 프리뷰 로직 (Taxonomy 구조 반영)
  // ==========================================
  const handleGenerateTwinsClick = async () => {
    if (selectedQIds.length === 0) return alert("AI로 생성할 문항을 체크박스로 먼저 선택해주세요.");
    
    const twinBookName = columns[3].bookName;
    const simBookName = columns[4].bookName;

    if (!twinBookName || !simBookName) {
      if (!confirm("4번(쌍둥이) 또는 5번(유사) 탭의 교재 이름이 비어있습니다.\n이대로 생성하면 '원본교재명 쌍둥이/유사'로 임의 배정됩니다. 진행하시겠습니까?")) return;
    }

    setIsTwinModalOpen(true);
    setIsGeneratingTwins(true);
    setGeneratedTwins([]);

    let accumulatedTwins: any[] = [];
    let errorCount = 0;

    try {
      for (const qId of selectedQIds) {
        const q = allQuestionsMap.get(qId);
        if (!q) continue;

        const taxStr = q.taxonomy_id || '미분류';

        const res = await fetch('/api/gemini-twin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            originalQuestion: q.question, 
            originalAnswer: q.answer, 
            taxonomyStr: taxStr,
            step1Concept: q.step_1_concept || '',
            step2Approach: q.step_2_approach || '',
            step3Process: q.step_3_process || '',
            step4Conclusion: q.step_4_conclusion || ''
          })
        });

        if (!res.ok) { errorCount++; continue; }
        const data = await res.json();
        if (!data.success) { errorCount++; continue; }

        const cleanedTwins = data.data.map((twin: any, idx: number) => ({
          ...twin,
          parent_q: q, // 저장을 위해 부모 정보를 메타데이터로 남김
          question: twin.question?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
          answer: twin.answer?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
          step_1_concept: twin.step_1_concept?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
          step_2_approach: twin.step_2_approach?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
          step_3_process: twin.step_3_process?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
          step_4_conclusion: twin.step_4_conclusion?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
          isSelected: true, 
          isPreviewMode: false,
          question_type: twin.question_type || (idx === 0 ? '쌍둥이' : '유사')
        }));

        accumulatedTwins = [...accumulatedTwins, ...cleanedTwins];
      }

      setGeneratedTwins(accumulatedTwins);
      forceMathJaxRender();
      if(errorCount > 0) alert(`일부 문항(${errorCount}건)의 AI 생성이 실패했습니다.`);
    } catch (e: any) {
      alert("AI 생성 중 오류: " + e.message);
    } finally {
      setIsGeneratingTwins(false);
    }
  };

  const handleTwinChange = (index: number, field: string, value: any) => {
    const updated = [...generatedTwins];
    updated[index][field] = value;
    setGeneratedTwins(updated);
    if (field === 'isPreviewMode' && value === true) {
      forceMathJaxRender();
    }
  };

  // 모달 안에서 선택된 애들만 최종적으로 DB에 Insert 하는 로직 (순차 번호계산 포함)
  const saveTwinsToDB = async () => {
    const selectedTwinsToSave = generatedTwins.filter(t => t.isSelected !== false);
    if (selectedTwinsToSave.length === 0) return alert("저장할 문항을 하나 이상 체크박스에서 선택해주세요.");

    setIsLoading(true);
    let successCount = 0;

    try {
      // 부모 단위로 묶어서 DB의 기존 번호표를 확인
      const groupedByParent = selectedTwinsToSave.reduce((acc: any, twin) => {
        const pid = twin.parent_q.question_id;
        if (!acc[pid]) acc[pid] = [];
        acc[pid].push(twin);
        return acc;
      }, {});

      const twinsToInsert = [];

      for (const [pid, twins] of Object.entries(groupedByParent)) {
        const parentQ = (twins as any)[0].parent_q;

        const { data: existingTwins } = await supabase
          .from('question_db')
          .select('question_number')
          .eq('parent_question_id', pid);

        let maxT = 0;
        let maxS = 0;

        if (existingTwins) {
          existingTwins.forEach(child => {
            const match = child.question_number?.match(/-(T|S)(\d+)$/i);
            if (match) {
              const type = match[1].toUpperCase();
              const num = parseInt(match[2], 10);
              if (type === 'T' && num > maxT) maxT = num;
              if (type === 'S' && num > maxS) maxS = num;
            }
          });
        }

        let nextT = maxT + 1;
        let nextS = maxS + 1;

        for (const twin of twins as any[]) {
          const isSimilar = twin.question_type === '유사';
          const twinBookName = columns[3].bookName;
          const simBookName = columns[4].bookName;
          const targetBook = isSimilar ? (simBookName || `${parentQ.source_book_name} 유사`) : (twinBookName || `${parentQ.source_book_name} 쌍둥이`);
          const suffix = isSimilar ? `S${nextS++}` : `T${nextT++}`;

          twinsToInsert.push({
            question_id: crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random()}`, 
            parent_question_id: pid,
            source_book_name: targetBook, 
            book_name: targetBook,        
            detected_page_num: parentQ.detected_page_num || 0,
            final_printed_page: parentQ.final_printed_page, 
            question_number: `${formatQNum(parentQ.question_number, parentQ.sub_num)}-${suffix}`, 
            question: twin.question, 
            answer: twin.answer, 
            step_1_concept: twin.step_1_concept, 
            step_2_approach: twin.step_2_approach, 
            step_3_process: twin.step_3_process, 
            step_4_conclusion: twin.step_4_conclusion,
            taxonomy_id: parentQ.taxonomy_id, 
            difficulty: parentQ.difficulty || '중', 
            derivation_type: isSimilar ? '유사' : 'TWIN',
          });
        }
      }

      const { error } = await supabase.from('question_db').insert(twinsToInsert);
      if (error) throw error;

      successCount += twinsToInsert.length;
      alert(`✅ 선택된 ${successCount}개의 문항이 DB에 성공적으로 저장되었습니다!`);
      
      setIsTwinModalOpen(false);
      
      // 새로고침 반영
      const twinBookName = columns[3].bookName;
      const simBookName = columns[4].bookName;
      if (twinBookName) await fetchColumnData(3, twinBookName);
      if (simBookName) await fetchColumnData(4, simBookName);
      
      setSelectedQIds([]);
      forceMathJaxRender();
    } catch (e: any) {
      alert("저장 중 오류가 발생했습니다: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  // ==========================================
  // 4. 문항 편집 & 삭제 로직
  // ==========================================
  const saveQuestionEdit = async () => {
    if (!editingQ) return;
    setIsLoading(true);
    try {
      const updateData = {
        question: editingQ.question,
        answer: editingQ.answer,
        final_printed_page: editingQ.final_printed_page ? parseInt(editingQ.final_printed_page) : null,
        question_number: editingQ.question_number,
        sub_num: editingQ.sub_num ? parseInt(editingQ.sub_num) : null,
        difficulty: editingQ.difficulty,
        solving_probability: editingQ.solving_probability ? parseFloat(editingQ.solving_probability) : null,
        step_1_concept: editingQ.step_1_concept,
        step_2_approach: editingQ.step_2_approach,
        step_3_process: editingQ.step_3_process,
        step_4_conclusion: editingQ.step_4_conclusion,
      };

      const { error } = await supabase.from('question_db').update(updateData).eq('question_id', editingQ.question_id);
      if (error) throw error;

      await supabase.from('textbook_question').update({ 
        question: updateData.question, answer: updateData.answer, 
        page_number: updateData.final_printed_page, question_number: updateData.question_number 
      }).eq('question_id', editingQ.question_id);

      setColumns(prev => prev.map(col => ({
        ...col,
        questions: sortQuestionsList(col.questions.map(q => q.question_id === editingQ.question_id ? { ...q, ...updateData } : q))
      })));
      setEditingQ(null);
      forceMathJaxRender();
      alert("✅ 문항이 완벽하게 수정되었습니다.");
    } catch(e: any) {
      alert("수정 실패: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteQuestion = async () => {
    if (!editingQ) return;
    if (!confirm("🚨 정말 이 문항을 마스터 DB에서 완전히 삭제하시겠습니까?\n이 작업은 복구할 수 없으며, 연결된 자식 문항들이 고아 상태가 됩니다.")) return;
    
    setIsLoading(true);
    try {
      await supabase.from('textbook_question').delete().eq('question_id', editingQ.question_id);
      const { error } = await supabase.from('question_db').delete().eq('question_id', editingQ.question_id);
      if (error) throw error;

      setColumns(prev => prev.map(col => ({
        ...col,
        questions: col.questions.filter(q => q.question_id !== editingQ.question_id)
      })));
      setEditingQ(null);
      alert("🗑️ 문항이 영구 삭제되었습니다.");
    } catch(e: any) {
      alert("삭제 실패: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  // ==========================================
  // 5. 견고해진 드래그 앤 드롭 로직
  // ==========================================
  const onDragStart = (e: React.DragEvent, qId: string, sourceColId: string) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ qId, sourceColId }));
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); 
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault(); 
    e.dataTransfer.dropEffect = "move";
    const dropZone = (e.target as HTMLElement).closest('.drop-zone');
    if (dropZone) dropZone.classList.add('bg-slate-200/60');
  };

  const onDragLeave = (e: React.DragEvent) => {
    const dropZone = (e.target as HTMLElement).closest('.drop-zone');
    if (dropZone && !dropZone.contains(e.relatedTarget as Node)) {
      dropZone.classList.remove('bg-slate-200/60');
    }
  };

  const onDrop = async (e: React.DragEvent, targetColIndex: number) => {
    e.preventDefault();
    document.querySelectorAll('.drop-zone').forEach(el => el.classList.remove('bg-slate-200/60'));
    
    const dataStr = e.dataTransfer.getData("text/plain");
    if (!dataStr) return;

    const { qId, sourceColId } = JSON.parse(dataStr);
    const targetCol = columns[targetColIndex];
    
    if (!targetCol.bookName) return alert("해당 묶음에 먼저 교재 이름을 지정(또는 조회)해야 합니다.");
    if (sourceColId === targetCol.id) return; 

    setIsLoading(true);
    try {
      const { error } = await supabase.from('question_db').update({
        book_name: targetCol.bookName,
        source_book_name: targetCol.bookName,
      }).eq('question_id', qId);

      if (error) throw error;

      setColumns(prev => {
        const newCols = [...prev];
        const sourceIndex = newCols.findIndex(c => c.id === sourceColId);
        
        const draggedQuestion = newCols[sourceIndex].questions.find(q => q.question_id === qId);
        newCols[sourceIndex].questions = newCols[sourceIndex].questions.filter(q => q.question_id !== qId);
        
        if (draggedQuestion) {
          const updatedQ = { ...draggedQuestion, book_name: targetCol.bookName, source_book_name: targetCol.bookName };
          newCols[targetColIndex].questions = sortQuestionsList([...newCols[targetColIndex].questions, updatedQ]);
        }
        return newCols;
      });

    } catch (err: any) {
      alert("이동 실패: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleDerivationType = async (q: any, colIndex: number) => {
    const newType = q.derivation_type === '유사' ? 'TWIN' : '유사';
    setIsLoading(true);
    try {
      await supabase.from('question_db').update({ derivation_type: newType }).eq('question_id', q.question_id);
      setColumns(prev => {
        const newCols = [...prev];
        newCols[colIndex].questions = newCols[colIndex].questions.map(item => 
          item.question_id === q.question_id ? { ...item, derivation_type: newType } : item
        );
        return newCols;
      });
    } catch(e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const renderQuestionCard = (q: any, colId: string, colIndex: number) => {
    const parentQ = q.parent_question_id ? allQuestionsMap.get(q.parent_question_id) : null;
    const myChildren: any[] = [];
    columns.forEach(col => {
      col.questions.forEach(childQ => {
        if (childQ.parent_question_id === q.question_id) myChildren.push(childQ);
      });
    });
    
    const isChecked = selectedQIds.includes(q.question_id);

    return (
      <div 
        key={q.question_id} id={`q-card-${q.question_id}`}
        draggable
        onDragStart={(e) => onDragStart(e, q.question_id, colId)}
        className={`p-3 bg-white border rounded-xl shadow-sm mb-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-all flex flex-col gap-2 relative group ${isChecked ? 'border-fuchsia-500 ring-1 ring-fuchsia-400 bg-fuchsia-50/20' : 'border-slate-200 hover:border-blue-400'}`}
      >
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <button 
            onClick={(e) => { e.stopPropagation(); setEditingQ(q); forceMathJaxRender(); }} 
            className="text-[10px] text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 px-1.5 py-1 rounded border border-slate-200 shadow-sm transition-colors"
          >
            ✏️ 편집
          </button>
          <div className="text-slate-300 group-hover:text-slate-500 cursor-grab active:cursor-grabbing text-xs">⠿</div>
        </div>
        
        <div className="flex justify-between items-start pr-16">
          <div className="flex items-center gap-2 flex-wrap">
            <input 
              type="checkbox" 
              checked={isChecked}
              onChange={(e) => {
                if (e.target.checked) setSelectedQIds(prev => [...prev, q.question_id]);
                else setSelectedQIds(prev => prev.filter(id => id !== q.question_id));
              }}
              className="w-3.5 h-3.5 text-fuchsia-600 rounded border-slate-300 focus:ring-fuchsia-500 cursor-pointer"
            />
            <span className="text-[10px] font-black text-slate-100 bg-slate-700 px-1.5 py-0.5 rounded shadow-sm">
              {q.final_printed_page || q.detected_page_num || '?'}p
            </span>
            <span className="text-xs font-black text-slate-800">{formatQNum(q.question_number, q.sub_num)}</span>
          </div>
          <button 
            onClick={() => toggleDerivationType(q, colIndex)}
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shadow-sm transition-colors ${q.derivation_type === '유사' ? 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100' : 'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200 hover:bg-fuchsia-100'}`}
          >
            {q.derivation_type === '유사' ? '유사' : '쌍둥이'} 🔄
          </button>
        </div>
        
        <div className="text-[11px] font-medium text-slate-600 line-clamp-2 leading-relaxed whitespace-pre-wrap">{q.question}</div>

        <div className="mt-1 pt-2 border-t border-slate-100 flex flex-col gap-1.5">
          {parentQ && (
            <div className="flex items-center gap-1">
              <span className="text-slate-300 text-xs">ㄴ</span>
              <button onClick={(e) => scrollToQuestion(parentQ.question_id, e)} className="text-[10px] font-bold text-indigo-700 bg-indigo-50/80 px-1.5 py-0.5 rounded hover:bg-indigo-100 truncate flex-1 text-left border border-indigo-100 shadow-sm transition-colors">
                [부모] {parentQ.book_name || parentQ.source_book_name} {parentQ.final_printed_page}p, {formatQNum(parentQ.question_number)}
              </button>
            </div>
          )}
          
          {myChildren.map(child => (
            <div key={child.question_id} className="flex items-center gap-1">
              <span className="text-slate-300 text-xs">ㄴ</span>
              <button onClick={(e) => scrollToQuestion(child.question_id, e)} className="text-[10px] font-bold text-emerald-700 bg-emerald-50/80 px-1.5 py-0.5 rounded hover:bg-emerald-100 truncate flex-1 text-left border border-emerald-100 shadow-sm transition-colors">
                [{child.derivation_type === '유사' ? '유사' : '쌍둥이'}] {child.book_name || child.source_book_name} {child.final_printed_page}p, {formatQNum(child.question_number)}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-100 font-pretendard p-4 overflow-hidden relative">
      {isLoading && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-xs font-bold px-4 py-1.5 rounded-full animate-pulse shadow-lg flex items-center gap-2">
          <span>🌀</span> 통신 중...
        </div>
      )}

      {/* 🌟 1. AI 쌍둥이 생성 확인 모달 (Taxonomy Editor 이식본) */}
      {isTwinModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 flex flex-col items-center justify-center p-6 sm:p-10 animate-in fade-in backdrop-blur-sm">
          <div className="bg-white w-full max-w-6xl h-full max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
            <div className="p-5 bg-gradient-to-r from-fuchsia-600 to-indigo-600 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-black text-white flex items-center gap-2">
                  <span>👯</span> 체크된 문항 AI 쌍둥이/유사 생성기
                </h2>
                <p className="text-fuchsia-100 font-bold text-xs mt-1">
                  선택한 {selectedQIds.length}개 원본을 바탕으로 새 문항이 생성되었습니다. 수식과 풀이를 검토한 뒤 DB에 저장하세요.
                </p>
              </div>
              <button onClick={() => setIsTwinModalOpen(false)} className="text-white hover:text-fuchsia-200 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors">
                닫기 ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scroll">
              {isGeneratingTwins ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                  <span className="text-5xl animate-spin">🌀</span>
                  <p className="font-extrabold text-lg">AI가 쌍둥이와 유사 문제를 생성하고 있습니다...</p>
                  <p className="text-sm font-bold text-slate-400">선택된 문항이 많을수록 시간이 더 걸릴 수 있습니다.</p>
                </div>
              ) : generatedTwins.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {generatedTwins.map((twin, idx) => (
                    <div key={idx} className={`bg-white border rounded-2xl p-5 shadow-sm transition-all flex flex-col gap-3 ${twin.isSelected === false ? 'border-slate-200 opacity-60 grayscale-[50%]' : 'border-indigo-300 hover:shadow-md'}`}>
                      <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                        
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={twin.isSelected !== false}
                            onChange={(e) => handleTwinChange(idx, 'isSelected', e.target.checked)}
                            className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                          />
                          <span className={`px-2 py-1 rounded text-xs font-black transition-colors ${twin.isSelected === false ? 'text-slate-400 bg-slate-100' : (twin.question_type === '유사' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700')}`}>
                            {twin.question_type === '유사' ? '💡 유사 문항' : '👯 쌍둥이 문항'}
                          </span>
                        </label>
                        
                        <div className="flex items-center gap-2">
                           <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                             부모: {twin.parent_q.final_printed_page}p, {formatQNum(twin.parent_q.question_number)}
                           </span>
                           <button
                             onClick={() => handleTwinChange(idx, 'isPreviewMode', !twin.isPreviewMode)}
                             className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors shadow-sm ${twin.isPreviewMode ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                           >
                             {twin.isPreviewMode ? <><span>✏️</span> 편집 모드</> : <><span>👀</span> 수식 미리보기</>}
                           </button>
                        </div>
                      </div>
                      
                      <div className="flex flex-col gap-1.5 flex-1 mt-1">
                        <label className="text-[11px] font-bold text-slate-500">문제 텍스트</label>
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

                      <details className="group mt-2">
                        <summary className="text-xs font-bold text-indigo-500 cursor-pointer hover:text-indigo-700 outline-none select-none flex items-center gap-1">
                          <span>▶</span> 상세 해설 (4단계) 보기 및 수정
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
                <div className="text-center py-20 text-slate-400 font-bold">생성된 문항이 없습니다.</div>
              )}
            </div>

            <div className="p-5 bg-white border-t border-slate-200 flex justify-end items-center shrink-0">
              <button 
                onClick={saveTwinsToDB} 
                disabled={isGeneratingTwins || generatedTwins.length === 0 || isLoading}
                className="px-8 py-3 bg-[#002864] hover:bg-blue-900 disabled:bg-slate-300 text-white font-black rounded-xl shadow-lg transition-colors flex items-center gap-2"
              >
                {isLoading ? "저장 중..." : `💾 선택된 ${generatedTwins.filter(t => t.isSelected !== false).length}개 문항 DB에 배포 (자동 번호계산 적용)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🌟 2. 원본 문항 편집 모달 */}
      {editingQ && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] overflow-hidden flex flex-col border border-slate-200">
            <div className="p-4 bg-slate-800 text-white flex justify-between items-center shrink-0">
              <h3 className="font-bold text-sm flex items-center gap-2"><span>✏️</span> 문항 상세 편집 및 교정</h3>
              <button onClick={() => setEditingQ(null)} className="text-slate-300 hover:text-white font-bold px-2 py-1 bg-white/10 rounded">닫기 ✕</button>
            </div>
            
            <div className="p-5 flex flex-col gap-4 bg-slate-50 overflow-y-auto custom-scroll flex-1">
              <div className="flex gap-4 p-4 bg-slate-100/50 rounded-xl border border-slate-200 flex-wrap">
                <div className="flex-1 flex flex-col gap-1 min-w-[100px]">
                  <label className="text-[10px] font-bold text-slate-500">페이지</label>
                  <input type="number" value={editingQ.final_printed_page || ''} onChange={e => setEditingQ({...editingQ, final_printed_page: e.target.value})} className="px-3 py-2 border rounded-lg text-xs outline-none focus:border-blue-400" />
                </div>
                <div className="flex-1 flex flex-col gap-1 min-w-[100px]">
                  <label className="text-[10px] font-bold text-slate-500">문항 번호</label>
                  <input type="text" value={editingQ.question_number || ''} onChange={e => setEditingQ({...editingQ, question_number: e.target.value})} className="px-3 py-2 border rounded-lg text-xs outline-none focus:border-blue-400" />
                </div>
                <div className="flex-1 flex flex-col gap-1 min-w-[100px]">
                  <label className="text-[10px] font-bold text-slate-500">꼬리 번호(Sub)</label>
                  <input type="number" value={editingQ.sub_num || ''} onChange={e => setEditingQ({...editingQ, sub_num: e.target.value})} className="px-3 py-2 border rounded-lg text-xs outline-none focus:border-blue-400" />
                </div>
                <div className="flex-1 flex flex-col gap-1 min-w-[100px]">
                  <label className="text-[10px] font-bold text-slate-500">난이도</label>
                  <select value={editingQ.difficulty || '미지정'} onChange={e => setEditingQ({...editingQ, difficulty: e.target.value})} className="px-3 py-2 border rounded-lg text-xs outline-none focus:border-blue-400">
                    <option value="최상">최상</option><option value="상">상</option><option value="중">중</option><option value="하">하</option><option value="최하">최하</option><option value="미지정">미지정</option>
                  </select>
                </div>
                <div className="flex-1 flex flex-col gap-1 min-w-[100px]">
                  <label className="text-[10px] font-bold text-slate-500">예상 정답률(%)</label>
                  <input type="number" step="0.1" value={editingQ.solving_probability || ''} onChange={e => setEditingQ({...editingQ, solving_probability: e.target.value})} placeholder="빈칸 가능" className="px-3 py-2 border rounded-lg text-xs outline-none focus:border-blue-400" />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500">문제 내용 (LaTeX 허용)</label>
                <textarea value={editingQ.question || ''} onChange={e => setEditingQ({...editingQ, question: e.target.value})} className="p-3 border rounded-xl text-sm font-medium h-32 resize-y outline-none focus:border-blue-400 bg-yellow-50/30" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500">정답 텍스트</label>
                <input type="text" value={editingQ.answer || ''} onChange={e => setEditingQ({...editingQ, answer: e.target.value})} className="p-3 border rounded-xl text-sm font-bold outline-none focus:border-blue-400" />
              </div>

              <div className="border-t border-slate-200 mt-2 pt-4">
                <h4 className="text-sm font-extrabold text-emerald-700 mb-3">📝 4단계 풀이 해설</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500">Step 1. 개념</label>
                    <textarea value={editingQ.step_1_concept || ''} onChange={e => setEditingQ({...editingQ, step_1_concept: e.target.value})} className="p-2.5 border rounded-lg h-20 outline-none focus:border-emerald-400 text-xs resize-none" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500">Step 2. 접근</label>
                    <textarea value={editingQ.step_2_approach || ''} onChange={e => setEditingQ({...editingQ, step_2_approach: e.target.value})} className="p-2.5 border rounded-lg h-20 outline-none focus:border-emerald-400 text-xs resize-none" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500">Step 3. 과정</label>
                    <textarea value={editingQ.step_3_process || ''} onChange={e => setEditingQ({...editingQ, step_3_process: e.target.value})} className="p-2.5 border rounded-lg h-24 outline-none focus:border-emerald-400 text-xs resize-none" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500">Step 4. 결론</label>
                    <textarea value={editingQ.step_4_conclusion || ''} onChange={e => setEditingQ({...editingQ, step_4_conclusion: e.target.value})} className="p-2.5 border rounded-lg h-24 outline-none focus:border-emerald-400 text-xs resize-none" />
                  </div>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center shrink-0">
              <button onClick={deleteQuestion} className="px-4 py-2 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg flex items-center gap-1">
                🗑️ 이 문항 영구 삭제
              </button>
              
              <div className="flex gap-2">
                <button onClick={() => setEditingQ(null)} className="px-6 py-2.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg">취소</button>
                <button onClick={saveQuestionEdit} className="px-8 py-2.5 text-xs font-black text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm">💾 즉시 저장</button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* 상단 컨트롤 바 */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-col gap-3 mb-4 shrink-0 pr-20">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-xl font-black text-[#002864] flex items-center gap-2">
            <span>🗂️</span> 쌍둥이 문제 팩토리 (수동 배정)
          </h1>
          
          <div className="flex items-center gap-2 ml-4 border-l border-slate-200 pl-4">
            <button 
              onClick={forceMathJaxRender}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg shadow-sm text-xs transition-colors border border-slate-300"
              title="화면상의 깨진 수식을 강제로 렌더링합니다."
            >
              🧮 수식 새로고침
            </button>
            <button 
              onClick={handleGenerateTwinsClick}
              disabled={selectedQIds.length === 0}
              className={`px-4 py-1.5 font-bold rounded-lg shadow-sm text-xs transition-all flex items-center gap-1 ${selectedQIds.length > 0 ? 'bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
            >
              ✨ 체크된 {selectedQIds.length}개 문항 AI로 쌍둥이/유사 생성
            </button>
          </div>
        </div>
        <p className="text-[11px] font-bold text-slate-500">
          원하는 문제집 5벌을 띄워놓고 드래그 앤 드롭으로 문항을 분배하여 완벽한 1벌의 쌍둥이 문제지를 완성합니다.
        </p>
      </div>

      <div className="flex-1 flex gap-3 overflow-hidden min-h-0">
        {columns.map((col, idx) => (
          <div 
            key={col.id} 
            className={`flex-1 flex flex-col bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shadow-sm transition-all drop-zone ring-${col.theme}-400 relative`}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, idx)}
          >
            <div className={`p-3 border-b border-slate-200 shrink-0 bg-white`}>
              <div className={`text-xs font-black mb-1.5 text-${col.theme}-700 flex justify-between items-center`}>
                <span>{col.title}</span>
                {/* 🌟 이름 일괄 변경 버튼 추가 */}
                {col.bookName && col.questions.length > 0 && (
                  <button 
                    onClick={() => handleRenameColumnBook(idx, col.bookName)}
                    className="text-[10px] font-bold text-slate-500 bg-slate-100 hover:bg-blue-100 hover:text-blue-700 px-2 py-0.5 rounded border border-slate-200 shadow-sm transition-colors"
                    title="이 탭에 불러와진 교재 묶음의 이름을 통째로 변경합니다."
                  >
                    ✏️ 이름 일괄 변경
                  </button>
                )}
              </div>
              
              <div className="flex gap-1.5">
                <input 
                  type="text" 
                  list={`combo-workbooks-${idx}`}
                  value={col.bookName}
                  onChange={(e) => {
                    const newCols = [...columns];
                    newCols[idx].bookName = e.target.value;
                    setColumns(newCols);
                  }}
                  placeholder={idx < 3 ? "DB 교재 검색/선택" : "기존 선택 or 신규 입력"}
                  className={`w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-bold bg-${col.theme}-50 outline-none focus:ring-2 focus:ring-${col.theme}-400 shadow-sm`}
                />
                <datalist id={`combo-workbooks-${idx}`}>
                  {workbooks.map(b => <option key={b} value={b} />)}
                </datalist>
                <button 
                  onClick={() => fetchColumnData(idx, col.bookName)}
                  className={`px-3 py-1.5 text-white text-[10px] rounded-lg font-bold shadow-sm shrink-0 transition-colors ${idx < 3 ? 'bg-slate-700 hover:bg-slate-800' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  {idx < 3 ? '조회' : '불러오기 / 신규지정'}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 custom-scroll relative pointer-events-auto">
              {/* 드래그 시 마우스 이벤트가 막히지 않도록 빈 공간에 덮어씌움 (Drop 튕김 방지) */}
              <div className="absolute inset-0 z-0 bg-transparent" />
              
              <div className="relative z-10 h-full">
                {col.questions.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400 font-bold text-[11px] text-center border-2 border-dashed border-slate-300 rounded-lg pointer-events-none bg-slate-50/50">
                    {!col.bookName ? "이름을 지정하고 조회하세요." : "여기로 문제 카드를 끌어오세요."}
                  </div>
                ) : (
                  col.questions.map(q => renderQuestionCard(q, col.id, idx))
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}