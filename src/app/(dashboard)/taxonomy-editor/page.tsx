// src/app/(dashboard)/taxonomy-editor/page.tsx
"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// 자연스러운 한글/숫자 맞춤 정렬 헬퍼
const taxSort = (a: string, b: string) => {
  const order: Record<string, number> = { '초등학교': 1, '중학교': 2, '고등학교': 3 };
  if (order[a] && order[b] && order[a] !== order[b]) return order[a] - order[b];
  return String(a).localeCompare(String(b), 'ko', { numeric: true });
};

// UUID 강제 생성 헬퍼 (question_id Not Null 에러 방지)
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
};

// 리스트 공통 정렬 로직 (페이지 -> 번호 -> 서브번호 순)
const sortQuestionsList = (data: any[]) => {
  return [...data].sort((a, b) => {
    const pA = parseInt(String(a.final_printed_page)) || a.detected_page_num || 9999;
    const pB = parseInt(String(b.final_printed_page)) || b.detected_page_num || 9999;
    if (pA !== pB) return pA - pB;
    const nA = parseInt(String(a.question_number).replace(/[^0-9]/g, '')) || 9999;
    const nB = parseInt(String(b.question_number).replace(/[^0-9]/g, '')) || 9999;
    if (nA !== nB) return nA - nB;
    return (a.sub_num || 0) - (b.sub_num || 0);
  });
};

// Supabase의 1,000줄 제한 무력화
const fetchAllRows = async (tableName: string, selectQuery: string = '*') => {
  let allData: any[] = [];
  let start = 0;
  const step = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase.from(tableName).select(selectQuery).range(start, start + step - 1);
    if (error) { console.error(`${tableName} 로드 실패:`, error); break; }
    if (data && data.length > 0) { allData = [...allData, ...data]; start += step; }
    if (!data || data.length < step) hasMore = false; 
  }
  return allData;
};

export default function TaxonomyEditorPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  
  const [categories, setCategories] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [isTaxonomyLoading, setIsTaxonomyLoading] = useState(true);

  const [workbooks, setWorkbooks] = useState<string[]>([]);
  const [selectedBook, setSelectedBook] = useState<string>("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 문항 직접 수정 상태
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editForm, setEditForm] = useState({ 
    page_number: '', question_number: '', sub_num: '',
    question: '', answer: '', 
    image_url: '', image_2_url: '', 
    answer_image_url: '', answer_image_2_url: '',
    step_1_concept: '', step_2_approach: '', step_3_process: '', step_4_conclusion: ''
  });

  // 이미지 크롭(자르기) 상태
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [cropTargetField, setCropTargetField] = useState<string | null>(null);
  const [hasCropArea, setHasCropArea] = useState(false);
  
  const imgRef = useRef<HTMLImageElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);
  const isCroppingRef = useRef(false);
  const cropStartRef = useRef<{x: number, y: number} | null>(null);
  const cropRectRef = useRef<{x: number, y: number, w: number, h: number} | null>(null);

  const [selD1, setSelD1] = useState("");
  const [selD2, setSelD2] = useState("");
  const [selD3, setSelD3] = useState("");
  const [selD4, setSelD4] = useState("");
  const [selD5, setSelD5] = useState("");
  const [selD6, setSelD6] = useState("");
  const [selD7, setSelD7] = useState("");
  const [selD8, setSelD8] = useState("");

  const mathJaxRef = useRef<boolean>(false);

  // 🌟 [수정] DB 기반 권한 체크 로직 적용
  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      
      if (!role || !tId) {
        alert("로그인 정보가 없습니다.");
        router.replace("/home");
        return;
      }

      if (role === 'SUPER_ADMIN') {
        setIsAuthorized(true);
        return;
      }

      const { data, error } = await supabase
        .from('tenant_role_permissions')
        .select('allowed_menus')
        .eq('tenant_id', tId)
        .eq('role_name', role)
        .single();

      if (!error && data && data.allowed_menus.includes("/taxonomy-editor")) {
        setIsAuthorized(true);
      } else {
        alert("⛔ 분류 교정 툴 접근 권한이 없습니다. 권한 관리 페이지에서 허용해주세요.");
        router.replace("/home");
      }
    };
    checkAccess();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) {
      loadMasterTaxonomy();
      loadWorkbooks();
      loadMathJax();
    }
  }, [isAuthorized]);

  useEffect(() => {
    const renderMath = () => {
      if ((window as any).MathJax && (window as any).MathJax.typesetPromise && !isEditingContent) {
        (window as any).MathJax.typesetPromise().catch((err: any) => console.log("MathJax 에러:", err));
      }
    };
    const timer = setTimeout(renderMath, 150);
    return () => clearTimeout(timer);
  }, [questions, selectedQuestion, isEditingContent]);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] }, startup: { typeset: false } };
      const script = document.createElement("script"); script.id = "MathJax-script"; script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"; script.async = true;
      document.head.appendChild(script);
    }
  };

  const loadMasterTaxonomy = async () => {
    setIsTaxonomyLoading(true);
    try {
      const catData = await fetchAllRows('master_category');
      const itemData = await fetchAllRows('master_item');
      setCategories(catData || []);
      setItems(itemData || []);
    } catch (e) { console.error("Taxonomy 로드 실패", e); } 
    finally { setIsTaxonomyLoading(false); }
  };

  const loadWorkbooks = async () => {
    try {
      const data = await fetchAllRows('question_db', 'source_book_name');
      const uniqueList = Array.from(new Set(data.map(q => q.source_book_name))).filter(Boolean).sort(taxSort);
      setWorkbooks(uniqueList as string[]);
    } catch (e) { console.error(e); }
  };

  const fetchQuestions = async () => {
    if (!selectedBook) return;
    setIsLoading(true);
    try {
      const { data } = await supabase.from("question_db")
        .select("*")
        .eq("source_book_name", selectedBook);
      // 🌟 완벽한 정렬 적용
      setQuestions(sortQuestionsList(data || []));
      setSelectedQuestion(null);
      setIsEditingContent(false);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const getKoreanPath = (taxId: string) => {
    if (!taxId || taxId === '미분류') return '분류 정보 없음';
    const matchedItem = items.find(i => i.item_id === taxId);
    if (matchedItem) {
      const cat = categories.find(c => c.category_id === matchedItem.category_id);
      if (cat) return [cat.depth1, cat.depth2, cat.depth3, cat.depth4, cat.depth5, cat.depth6, cat.depth7, matchedItem.depth8].filter(Boolean).join(' > ');
      return matchedItem.depth8;
    }
    const cat = categories.find(c => c.category_id === taxId);
    if (cat) return [cat.depth1, cat.depth2, cat.depth3, cat.depth4, cat.depth5, cat.depth6, cat.depth7].filter(Boolean).join(' > ');
    return '알 수 없는 분류 (DB에 없음)';
  };

  // 🌟 [핵심 기능] 오토필(Auto-fill): 현재 분류 클릭 시 드롭다운 싹 세팅하기
  const handleAutoFillTaxonomy = () => {
    const taxId = selectedQuestion?.taxonomy_id;
    if (!taxId || taxId === '미분류') return;

    const matchedItem = items.find(i => i.item_id === taxId);
    const catId = matchedItem ? matchedItem.category_id : taxId;
    const cat = categories.find(c => c.category_id === catId);

    if (cat) {
      setSelD1(cat.depth1 || "");
      setSelD2(cat.depth2 || "");
      setSelD3(cat.depth3 || "");
      setSelD4(cat.depth4 || "");
      setSelD5(cat.depth5 || "");
      setSelD6(cat.depth6 || "");
      setSelD7(cat.depth7 || "");
      setSelD8(matchedItem ? matchedItem.item_id : "");
    }
  };

  // 연쇄 드롭다운 로직 
  const d1Options = useMemo(() => Array.from(new Set(categories.map(c => c.depth1))).filter(Boolean).sort(taxSort), [categories]);
  const d2Options = useMemo(() => Array.from(new Set(categories.filter(c => c.depth1 === selD1).map(c => c.depth2))).filter(Boolean).sort(taxSort), [categories, selD1]);
  const d3Options = useMemo(() => Array.from(new Set(categories.filter(c => c.depth1 === selD1 && c.depth2 === selD2).map(c => c.depth3))).filter(Boolean).sort(taxSort), [categories, selD1, selD2]);
  const d4Options = useMemo(() => Array.from(new Set(categories.filter(c => c.depth1 === selD1 && c.depth2 === selD2 && c.depth3 === selD3).map(c => c.depth4))).filter(Boolean).sort(taxSort), [categories, selD1, selD2, selD3]);
  const d5Options = useMemo(() => Array.from(new Set(categories.filter(c => c.depth1 === selD1 && c.depth2 === selD2 && c.depth3 === selD3 && c.depth4 === selD4).map(c => c.depth5))).filter(Boolean).sort(taxSort), [categories, selD1, selD2, selD3, selD4]);
  const d6Options = useMemo(() => Array.from(new Set(categories.filter(c => c.depth1 === selD1 && c.depth2 === selD2 && c.depth3 === selD3 && c.depth4 === selD4 && c.depth5 === selD5).map(c => c.depth6))).filter(Boolean).sort(taxSort), [categories, selD1, selD2, selD3, selD4, selD5]);
  const d7Options = useMemo(() => Array.from(new Set(categories.filter(c => c.depth1 === selD1 && c.depth2 === selD2 && c.depth3 === selD3 && c.depth4 === selD4 && c.depth5 === selD5 && c.depth6 === selD6).map(c => c.depth7))).filter(Boolean).sort(taxSort), [categories, selD1, selD2, selD3, selD4, selD5, selD6]);

  const currentMatchedCat = useMemo(() => {
    if (!selD1) return null;
    return categories.find(c =>
      c.depth1 === selD1 &&
      (selD2 ? c.depth2 === selD2 : (!c.depth2 || c.depth2 === '')) &&
      (selD3 ? c.depth3 === selD3 : (!c.depth3 || c.depth3 === '')) &&
      (selD4 ? c.depth4 === selD4 : (!c.depth4 || c.depth4 === '')) &&
      (selD5 ? c.depth5 === selD5 : (!c.depth5 || c.depth5 === '')) &&
      (selD6 ? c.depth6 === selD6 : (!c.depth6 || c.depth6 === '')) &&
      (selD7 ? c.depth7 === selD7 : (!c.depth7 || c.depth7 === ''))
    );
  }, [categories, selD1, selD2, selD3, selD4, selD5, selD6, selD7]);

  const d8Options = useMemo(() => {
    if (!currentMatchedCat) return [];
    return items.filter(item => item.category_id === currentMatchedCat.category_id).sort((a,b) => taxSort(a.depth8 || '', b.depth8 || ''));
  }, [items, currentMatchedCat]);

  const finalCalculatedTaxId = selD8 || currentMatchedCat?.category_id;

  const handleD1Change = (val: string) => { setSelD1(val); setSelD2(""); setSelD3(""); setSelD4(""); setSelD5(""); setSelD6(""); setSelD7(""); setSelD8(""); };
  const handleD2Change = (val: string) => { setSelD2(val); setSelD3(""); setSelD4(""); setSelD5(""); setSelD6(""); setSelD7(""); setSelD8(""); };
  const handleD3Change = (val: string) => { setSelD3(val); setSelD4(""); setSelD5(""); setSelD6(""); setSelD7(""); setSelD8(""); };
  const handleD4Change = (val: string) => { setSelD4(val); setSelD5(""); setSelD6(""); setSelD7(""); setSelD8(""); };
  const handleD5Change = (val: string) => { setSelD5(val); setSelD6(""); setSelD7(""); setSelD8(""); };
  const handleD6Change = (val: string) => { setSelD6(val); setSelD7(""); setSelD8(""); };
  const handleD7Change = (val: string) => { setSelD7(val); setSelD8(""); };

  const handleQuestionClick = (q: any) => {
    setSelectedQuestion(q);
    setIsEditingContent(false); 
    setEditForm({ 
      page_number: String(q.final_printed_page || q.detected_page_num || ''),
      question_number: String(q.question_number || ''),
      sub_num: String(q.sub_num || ''),
      question: q.question || '', 
      answer: q.answer || '', 
      image_url: q.image_url || '',
      image_2_url: q.image_2_url || '',
      answer_image_url: q.answer_image_url || '',
      answer_image_2_url: q.answer_image_2_url || '',
      step_1_concept: q.step_1_concept || '',
      step_2_approach: q.step_2_approach || '',
      step_3_process: q.step_3_process || '',
      step_4_conclusion: q.step_4_conclusion || ''
    });
  };

  const saveTaxonomy = async () => {
    if (!selectedQuestion) return alert("수정할 문제를 먼저 선택해주세요.");
    if (!finalCalculatedTaxId) return alert("분류를 올바르게 선택해주세요.");

    setIsLoading(true);
    try {
      const { error: dbError } = await supabase.from('question_db').update({ taxonomy_id: finalCalculatedTaxId }).eq('question_id', selectedQuestion.question_id);
      if (dbError) throw dbError;

      await supabase.from('textbook_question').update({ taxonomy_id: finalCalculatedTaxId }).eq('question_id', selectedQuestion.question_id);

      setQuestions(prev => prev.map(q => q.question_id === selectedQuestion.question_id ? { ...q, taxonomy_id: finalCalculatedTaxId } : q));
      setSelectedQuestion({ ...selectedQuestion, taxonomy_id: finalCalculatedTaxId });
      
      const currentIndex = questions.findIndex(q => q.question_id === selectedQuestion.question_id);
      if (currentIndex >= 0 && currentIndex < questions.length - 1) {
        handleQuestionClick(questions[currentIndex + 1]);
      } else {
        alert("✅ 해당 교재의 마지막 문제입니다. Taxonomy ID가 저장되었습니다.");
      }
    } catch (err: any) { alert("업데이트 실패: " + err.message); } finally { setIsLoading(false); }
  };

  // 교재 내 신규 문항 강제 추가
  const createNewQuestion = async () => {
    if (!selectedBook) return alert("문항을 추가할 교재를 왼쪽 위에서 먼저 선택(조회)해주세요.");
    if (!confirm(`'${selectedBook}' 교재에 새로운 빈 문항을 강제로 추가하시겠습니까?`)) return;
    
    setIsLoading(true);
    try {
      // 🌟 [해결] Not Null 제약조건 위반 방지를 위해 강력한 UUID 직접 생성 및 주입
      const newQuestionId = generateUUID();

      const newDbData = {
        question_id: newQuestionId,
        source_book_name: selectedBook,
        question_number: 'NEW',
        question: '새로운 문항입니다. 우측 상단의 수정 버튼을 눌러 내용을 입력해주세요.',
        taxonomy_id: '미분류'
      };
      
      const { data: newQ, error: dbErr } = await supabase.from('question_db').insert(newDbData).select().single();
      if (dbErr) throw dbErr;

      const { data: tb } = await supabase.from('textbook').select('book_id').eq('title', selectedBook).maybeSingle();
      if (tb) {
        await supabase.from('textbook_question').insert({
          book_id: tb.book_id,
          question_id: newQ.question_id,
          page_number: 999,
          question_number: 'NEW',
          question: newQ.question,
          question_category: '일반',
          taxonomy_id: '미분류'
        });
      }

      setQuestions(prev => sortQuestionsList([...prev, newQ]));
      setSelectedQuestion(newQ);
      setEditForm({
        page_number: '999', question_number: 'NEW', sub_num: '0',
        question: newQ.question, answer: '', 
        image_url: '', image_2_url: '', answer_image_url: '', answer_image_2_url: '',
        step_1_concept: '', step_2_approach: '', step_3_process: '', step_4_conclusion: ''
      });
      setIsEditingContent(true);

      setTimeout(() => {
        const el = document.getElementById(`q-list-${newQ.question_id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);

    } catch (e: any) { alert("추가 실패: " + e.message); } finally { setIsLoading(false); }
  };

  // 선택 문항 완전 삭제
  const deleteQuestion = async () => {
    if (!selectedQuestion) return;
    if (!confirm("⚠️ 정말 이 문항을 DB에서 완전히 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며, 연결된 교재에서도 즉시 사라집니다.")) return;
    
    setIsLoading(true);
    try {
      await supabase.from('textbook_question').delete().eq('question_id', selectedQuestion.question_id);
      const { error } = await supabase.from('question_db').delete().eq('question_id', selectedQuestion.question_id);
      if (error) throw error;
      
      setQuestions(prev => prev.filter(q => q.question_id !== selectedQuestion.question_id));
      setSelectedQuestion(null);
      setIsEditingContent(false);
      alert("✅ 문항이 영구적으로 완전히 삭제되었습니다.");
    } catch (e: any) { alert("삭제 실패: " + e.message); } finally { setIsLoading(false); }
  };

  // 문항 이미지 드래그 앤 드롭 및 캔버스 크롭 로직 
  const handleImageInput = (file: File, fieldKey: string) => {
    if (file && file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setCropImageSrc(url);
      setCropTargetField(fieldKey);
      setHasCropArea(false);
      if (selectionBoxRef.current) selectionBoxRef.current.style.display = 'none';
    }
  };

  const handlePaste = (e: React.ClipboardEvent, fieldKey: string) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        e.preventDefault();
        handleImageInput(items[i].getAsFile() as File, fieldKey);
        break;
      }
    }
  };

  const handleDrop = (e: React.DragEvent, fieldKey: string) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleImageInput(e.dataTransfer.files[0], fieldKey);
    }
  };

  const handleCropMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    e.preventDefault();
    isCroppingRef.current = true;
    cropStartRef.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    cropRectRef.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, w: 0, h: 0 };
    setHasCropArea(false);
    if (selectionBoxRef.current) selectionBoxRef.current.style.display = 'none';
  };

  const handleCropMouseMove = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isCroppingRef.current || !cropStartRef.current) return;
    const currentX = e.nativeEvent.offsetX;
    const currentY = e.nativeEvent.offsetY;
    const newRect = {
      x: Math.min(cropStartRef.current.x, currentX),
      y: Math.min(cropStartRef.current.y, currentY),
      w: Math.abs(currentX - cropStartRef.current.x),
      h: Math.abs(currentY - cropStartRef.current.y)
    };
    cropRectRef.current = newRect;

    if (selectionBoxRef.current) {
      selectionBoxRef.current.style.display = 'block';
      selectionBoxRef.current.style.left = `${newRect.x}px`;
      selectionBoxRef.current.style.top = `${newRect.y}px`;
      selectionBoxRef.current.style.width = `${newRect.w}px`;
      selectionBoxRef.current.style.height = `${newRect.h}px`;
    }
  };

  const handleCropMouseUp = () => { 
    isCroppingRef.current = false; 
    if (cropRectRef.current && cropRectRef.current.w > 0) setHasCropArea(true);
  };

  const handleCropUpload = async (useOriginal: boolean) => {
    if (!imgRef.current || !cropImageSrc || !cropTargetField) return;
    setIsLoading(true);
    try {
      let blobToUpload: Blob | null = null;
      if (useOriginal || !cropRectRef.current || cropRectRef.current.w === 0) {
        const response = await fetch(cropImageSrc);
        blobToUpload = await response.blob();
      } else {
        const canvas = document.createElement('canvas');
        const scaleX = imgRef.current.naturalWidth / imgRef.current.width;
        const scaleY = imgRef.current.naturalHeight / imgRef.current.height;
        canvas.width = cropRectRef.current.w * scaleX;
        canvas.height = cropRectRef.current.h * scaleY;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Canvas 생성 실패");
        
        ctx.drawImage(
          imgRef.current, 
          cropRectRef.current.x * scaleX, 
          cropRectRef.current.y * scaleY, 
          cropRectRef.current.w * scaleX, 
          cropRectRef.current.h * scaleY, 
          0, 0, canvas.width, canvas.height
        );
        blobToUpload = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      }

      if (!blobToUpload) throw new Error("이미지 변환 실패");
      const fileName = `crop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
      const { error } = await supabase.storage.from('system_images').upload(`questions/${fileName}`, blobToUpload);
      if (error) throw error;
      const { data: publicUrlData } = supabase.storage.from('system_images').getPublicUrl(`questions/${fileName}`);
      
      setEditForm(prev => ({ ...prev, [cropTargetField]: publicUrlData.publicUrl }));
      setCropImageSrc(null);
      setCropTargetField(null);
      alert("✅ 이미지가 업로드 되었습니다!");
    } catch (err: any) { alert("이미지 업로드 실패: " + err.message); } finally { setIsLoading(false); }
  };

  const renderImageBox = (label: string, fieldKey: string, colorTheme: 'indigo' | 'emerald') => {
    const value = editForm[fieldKey as keyof typeof editForm];
    const colorClasses = colorTheme === 'indigo' 
      ? "border-indigo-300 bg-indigo-50/30 hover:bg-indigo-50 focus:ring-indigo-500 text-indigo-800" 
      : "border-emerald-300 bg-emerald-50/30 hover:bg-emerald-50 focus:ring-emerald-500 text-emerald-800";
    
    return (
      <div className="flex flex-col gap-1.5 bg-white p-3 rounded-xl border border-slate-200 shadow-sm relative">
        <label className="text-xs font-bold text-slate-500 flex justify-between items-center mb-1">
          <span>{label}</span>
          {value && (
            <div className="flex items-center gap-2">
              <a href={value as string} target="_blank" className="text-blue-500 hover:text-blue-700 underline tracking-tighter">원본 보기 ↗</a>
              <span className="text-slate-200">|</span>
              <button type="button" onClick={() => setEditForm({ ...editForm, [fieldKey]: '' })} className="text-rose-500 hover:text-rose-700 underline tracking-tighter">삭제 🗑️</button>
            </div>
          )}
        </label>
        <div 
          onDrop={(e) => handleDrop(e, fieldKey)} 
          onDragOver={(e) => e.preventDefault()} 
          onPaste={(e) => handlePaste(e, fieldKey)}
          tabIndex={0}
          className={`w-full h-28 border-2 border-dashed rounded-lg text-center cursor-pointer focus:ring-2 outline-none transition-all flex flex-col items-center justify-center relative group overflow-hidden ${colorClasses}`}
          onClick={() => { setCropTargetField(fieldKey); document.getElementById('globalFileInput')?.click(); }}
        >
          {value && <img src={value as string} className="absolute inset-0 w-full h-full object-contain opacity-30 group-hover:opacity-10 transition-opacity" alt="" />}
          <span className="text-2xl mb-1 relative z-10 group-hover:scale-110 transition-transform">📸</span>
          <span className="text-[10px] font-bold relative z-10">클릭, 드래그 또는 붙여넣기(Ctrl+V)</span>
        </div>
        <input type="text" value={value as string} onChange={e => setEditForm({ ...editForm, [fieldKey]: e.target.value })} className="w-full p-2 border border-slate-200 rounded-lg focus:border-blue-400 outline-none text-[10px] text-slate-500 bg-slate-50 mt-1" placeholder="직접 URL 입력..." />
      </div>
    );
  };

  const saveQuestionContent = async () => {
    if (!selectedQuestion) return;
    setIsLoading(true);
    try {
      const parsedPage = parseInt(editForm.page_number) || null;
      const parsedSubNum = parseInt(editForm.sub_num) || 0;

      const updateData = {
        final_printed_page: parsedPage,
        question_number: editForm.question_number,
        sub_num: parsedSubNum,
        question: editForm.question,
        answer: editForm.answer,
        image_url: editForm.image_url,
        image_2_url: editForm.image_2_url,
        answer_image_url: editForm.answer_image_url,
        answer_image_2_url: editForm.answer_image_2_url,
        step_1_concept: editForm.step_1_concept,
        step_2_approach: editForm.step_2_approach,
        step_3_process: editForm.step_3_process,
        step_4_conclusion: editForm.step_4_conclusion
      };

      const { error: dbError } = await supabase.from('question_db').update(updateData).eq('question_id', selectedQuestion.question_id);
      if (dbError) throw dbError;

      await supabase.from('textbook_question').update({ 
        page_number: parsedPage || 0,
        question_number: updateData.question_number,
        question: updateData.question, 
        answer: updateData.answer 
      }).eq('question_id', selectedQuestion.question_id);

      const updatedQuestion = { ...selectedQuestion, ...updateData };
      
      // 🌟 [수정 완료 후 정렬 유지]
      setQuestions(prev => sortQuestionsList(prev.map(q => q.question_id === selectedQuestion.question_id ? updatedQuestion : q)));
      
      setSelectedQuestion(updatedQuestion);
      setIsEditingContent(false);
      
      alert("✅ 문항의 메타정보 및 모든 내용이 성공적으로 수정되었습니다!");
    } catch (err: any) { alert("내용 수정 실패: " + err.message); } finally { setIsLoading(false); }
  };

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden">
      
      <input id="globalFileInput" type="file" accept="image/*" onChange={(e) => { if(e.target.files?.[0] && cropTargetField) handleImageInput(e.target.files[0], cropTargetField); e.target.value = ''; }} className="hidden" />

      {/* ===================== 최적화된 크롭퍼 모달 ===================== */}
      {cropImageSrc && (
        <div className="fixed inset-0 z-[100] bg-slate-900/90 flex flex-col items-center justify-center p-10 animate-in fade-in">
          <div className="text-center mb-6">
            <h3 className="text-2xl font-black text-white">✂️ 영역을 드래그해서 자르세요</h3>
            <p className="text-slate-400 font-medium mt-2">필요한 수식이나 그림 영역만 마우스로 덮으세요.</p>
          </div>
          <div className="relative max-w-full max-h-[65vh] overflow-hidden select-none bg-slate-800 rounded-xl shadow-2xl border border-slate-700">
            <img 
              ref={imgRef} src={cropImageSrc} alt="Crop target" 
              className="max-w-full max-h-[65vh] object-contain select-none cursor-crosshair" draggable={false}
              onMouseDown={handleCropMouseDown} onMouseMove={handleCropMouseMove} onMouseUp={handleCropMouseUp} onMouseLeave={handleCropMouseUp}
            />
            <div 
              ref={selectionBoxRef}
              style={{ display: 'none', position: 'absolute', border: '2px dashed #0ea5e9', backgroundColor: 'rgba(14, 165, 233, 0.2)', pointerEvents: 'none' }} 
            />
          </div>
          <div className="flex gap-4 mt-8">
            <button onClick={() => { setCropImageSrc(null); setHasCropArea(false); }} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-colors">취소</button>
            <button onClick={() => handleCropUpload(true)} className="px-6 py-3 bg-slate-600 hover:bg-slate-500 text-slate-300 font-bold rounded-xl transition-colors">자르지 않고 원본 통째로 업로드</button>
            <button onClick={() => handleCropUpload(false)} disabled={!hasCropArea || isLoading} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-400 text-white font-black rounded-xl transition-colors shadow-lg">
              {isLoading ? '업로드 중...' : '✂️ 선택 영역 자르기 및 업로드'}
            </button>
          </div>
        </div>
      )}

      {/* ===================== 메인 UI ===================== */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center mb-4 shrink-0 gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#002864] flex items-center gap-2">
            <span>⚙️</span> 수동 뎁스(Taxonomy) 교정 툴
          </h1>
          <p className="text-sm font-bold text-slate-500 mt-1">AI 자동 분류가 미흡한 문제를 확인하고, 정확한 8단계 뎁스로 업데이트 하거나 문항을 직접 수정합니다.</p>
        </div>
      </div>

      <div className="bg-white px-6 py-4 border border-slate-200 rounded-xl flex items-end gap-4 mb-4 shrink-0 shadow-sm">
        <div className="flex flex-col gap-1.5 flex-1 max-w-md">
          <span className="text-xs font-bold text-slate-500">마스터 DB 전체 교재 검색:</span>
          <select value={selectedBook} onChange={(e) => setSelectedBook(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg font-bold text-[#002864] bg-slate-50 text-sm shadow-sm outline-none focus:ring-2 focus:ring-[#002864]">
            <option value="">교재를 선택하세요...</option>
            {workbooks.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <button onClick={fetchQuestions} disabled={!selectedBook || isLoading} className="px-6 py-2 bg-[#002864] hover:bg-blue-900 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 transition-colors">
          조회하기
        </button>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        
        {/* ===================== 좌측: 문제 리스트 ===================== */}
        <div className="w-[400px] bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden shrink-0">
          <div className="p-3 bg-slate-100/80 border-b border-slate-200 flex justify-between items-center shrink-0">
            <h2 className="font-extrabold text-slate-800 text-sm">📋 전체 문항 리스트 ({questions.length}개)</h2>
            <button onClick={createNewQuestion} disabled={!selectedBook || isLoading} className="text-[10px] bg-[#002864] text-white px-2.5 py-1.5 rounded font-bold hover:bg-blue-800 transition-colors shadow-sm flex items-center gap-1">
              <span>➕</span> 새 문항 추가
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scroll bg-slate-50/50">
            {questions.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">교재를 조회해주세요.</div>
            ) : (
              questions.map(q => {
                const isSelected = selectedQuestion?.question_id === q.question_id;
                const hasTaxonomy = q.taxonomy_id && q.taxonomy_id !== '미분류';

                return (
                  <div id={`q-list-${q.question_id}`} key={q.question_id} onClick={() => handleQuestionClick(q)} className={`p-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm relative overflow-hidden flex flex-col gap-2 ${isSelected ? 'border-[#002864] bg-blue-50/50' : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-md'}`}>
                    {isSelected && <div className="absolute left-0 top-0 w-1.5 h-full bg-[#002864]"></div>}
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-white bg-slate-600 px-2 py-0.5 rounded shadow-sm">{q.final_printed_page || q.detected_page_num || '?'}p</span>
                        <span className="text-sm font-black text-slate-800">{q.question_number || '-'}{q.sub_num ? `-${q.sub_num}` : ''}</span>
                      </div>
                      {hasTaxonomy ? (
                        <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">분류됨</span>
                      ) : (
                        <span className="text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded animate-pulse">수정필요</span>
                      )}
                    </div>
                    <div className="text-xs font-medium text-slate-700 line-clamp-2 leading-relaxed whitespace-pre-wrap">{q.question}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ===================== 우측: 뷰어 & 수정 에디터 ===================== */}
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          
          {!selectedQuestion ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 font-bold opacity-60">
              <span className="text-5xl mb-4">👈</span>
              <p>좌측에서 수정할 문제를 선택해주세요.</p>
            </div>
          ) : (
            <>
              {/* 🌟 상단 뷰어 및 문제 수정 영역 */}
              <div className={`p-6 overflow-y-auto custom-scroll border-b-4 border-slate-100 bg-white flex flex-col transition-all ${isEditingContent ? 'flex-1' : 'h-1/2'}`}>
                <div className="flex items-start justify-between gap-3 mb-4 shrink-0">
                  <div className="flex flex-col gap-2">
                    <span className="bg-[#002864] text-white px-3 py-1 rounded-lg text-sm font-black shadow-sm w-max">
                      {selectedQuestion.final_printed_page || selectedQuestion.detected_page_num || '?'}p - {selectedQuestion.question_number}{selectedQuestion.sub_num ? `-${selectedQuestion.sub_num}` : ''}
                    </span>
                    
                    {/* 🌟 [핵심] 현재 분류 마법봉 오토필 버튼 */}
                    <button 
                      onClick={handleAutoFillTaxonomy}
                      className="text-xs font-bold text-slate-500 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 px-3 py-1.5 rounded-lg flex flex-col leading-snug text-left transition-colors cursor-pointer group shadow-sm"
                      title="클릭하면 아래의 8단계 드롭다운에 이 분류가 자동으로 세팅됩니다."
                    >
                      <span className="text-[10px] text-slate-400 mb-0.5 group-hover:text-indigo-500 transition-colors flex items-center gap-1">
                        <span>🪄 현재 분류 (클릭 시 하단 자동 세팅)</span>
                        <span className="ml-auto font-mono text-[9px] bg-white px-1 py-0.5 rounded border border-slate-200">{selectedQuestion.taxonomy_id || '미분류'}</span>
                      </span>
                      <span className={selectedQuestion.taxonomy_id && selectedQuestion.taxonomy_id !== '미분류' ? 'text-emerald-700' : 'text-rose-500'}>
                        {getKoreanPath(selectedQuestion.taxonomy_id)}
                      </span>
                    </button>
                  </div>
                  
                  {!isEditingContent ? (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => setIsEditingContent(true)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors border border-slate-300 shadow-sm flex items-center gap-1.5">
                        <span>✏️</span> 문항 & 해설 & 이미지 수정
                      </button>
                      <button onClick={deleteQuestion} className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs rounded-lg transition-colors border border-rose-200 shadow-sm flex items-center gap-1.5">
                        <span>🗑️</span> 완전 삭제
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={saveQuestionContent} disabled={isLoading} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-lg transition-colors shadow-sm">
                        저장하기
                      </button>
                      <button onClick={() => { setIsEditingContent(false); handleQuestionClick(selectedQuestion); }} className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 font-bold text-xs rounded-lg transition-colors">
                        취소
                      </button>
                    </div>
                  )}
                </div>
                
                {!isEditingContent ? (
                  <>
                    <div className="text-base font-medium text-slate-800 leading-relaxed whitespace-pre-wrap p-4 bg-slate-50 rounded-xl border border-slate-200 shadow-inner">
                      {selectedQuestion.question}
                    </div>
                    
                    {(selectedQuestion.image_url || selectedQuestion.image_2_url) && (
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        {selectedQuestion.image_url && <img src={selectedQuestion.image_url} alt="문제 이미지 1" className="max-w-full rounded-lg border border-slate-200 shadow-sm" />}
                        {selectedQuestion.image_2_url && <img src={selectedQuestion.image_2_url} alt="문제 이미지 2" className="max-w-full rounded-lg border border-slate-200 shadow-sm" />}
                      </div>
                    )}

                    {selectedQuestion.answer && (
                      <div className="mt-6 text-sm font-bold text-blue-700 bg-blue-50 p-3 rounded-xl border border-blue-100">
                        정답: {selectedQuestion.answer}
                      </div>
                    )}

                    {(selectedQuestion.step_1_concept || selectedQuestion.step_2_approach || selectedQuestion.step_3_process || selectedQuestion.step_4_conclusion) && (
                      <div className="mt-4 p-4 border border-emerald-200 bg-emerald-50/30 rounded-xl space-y-3">
                        <h4 className="text-xs font-black text-emerald-700 border-b border-emerald-200 pb-2 mb-3">📝 단계별 풀이</h4>
                        {selectedQuestion.step_1_concept && <div className="text-[13px] text-slate-700"><span className="font-bold text-emerald-600 w-16 inline-block">1. 개념</span>{selectedQuestion.step_1_concept}</div>}
                        {selectedQuestion.step_2_approach && <div className="text-[13px] text-slate-700"><span className="font-bold text-emerald-600 w-16 inline-block">2. 접근</span>{selectedQuestion.step_2_approach}</div>}
                        {selectedQuestion.step_3_process && <div className="text-[13px] text-slate-700"><span className="font-bold text-emerald-600 w-16 inline-block">3. 과정</span>{selectedQuestion.step_3_process}</div>}
                        {selectedQuestion.step_4_conclusion && <div className="text-[13px] text-slate-700"><span className="font-bold text-emerald-600 w-16 inline-block">4. 결론</span>{selectedQuestion.step_4_conclusion}</div>}
                      </div>
                    )}

                    {(selectedQuestion.answer_image_url || selectedQuestion.answer_image_2_url) && (
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        {selectedQuestion.answer_image_url && <img src={selectedQuestion.answer_image_url} alt="정답 이미지 1" className="max-w-full rounded-lg border border-emerald-200 shadow-sm" />}
                        {selectedQuestion.answer_image_2_url && <img src={selectedQuestion.answer_image_2_url} alt="정답 이미지 2" className="max-w-full rounded-lg border border-emerald-200 shadow-sm" />}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col gap-4 flex-1 pb-10">
                    
                    <div className="flex gap-4 p-4 bg-slate-100 rounded-xl border border-slate-200">
                      <div className="flex flex-col gap-1.5 flex-1">
                        <label className="text-xs font-bold text-slate-500">페이지 번호</label>
                        <input type="text" value={editForm.page_number} onChange={e => setEditForm({...editForm, page_number: e.target.value})} className="px-3 py-2 border rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none" />
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1">
                        <label className="text-xs font-bold text-slate-500">문항 번호</label>
                        <input type="text" value={editForm.question_number} onChange={e => setEditForm({...editForm, question_number: e.target.value})} className="px-3 py-2 border rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none" />
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1">
                        <label className="text-xs font-bold text-slate-500">서브 번호(꼬리)</label>
                        <input type="number" value={editForm.sub_num} onChange={e => setEditForm({...editForm, sub_num: e.target.value})} className="px-3 py-2 border rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-slate-500">문제 텍스트 (LaTeX 수식은 $ $ 또는 $$ $$ 사용)</label>
                      <textarea value={editForm.question} onChange={e => setEditForm({ ...editForm, question: e.target.value })} className="w-full min-h-[120px] p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#002864] outline-none text-sm font-medium leading-relaxed resize-y bg-yellow-50/30" />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      {renderImageBox("문제 이미지 1", "image_url", "indigo")}
                      {renderImageBox("문제 이미지 2", "image_2_url", "indigo")}
                    </div>
                    
                    <div className="flex flex-col gap-1.5 mt-4">
                      <label className="text-xs font-bold text-slate-500">정답 텍스트</label>
                      <input type="text" value={editForm.answer} onChange={e => setEditForm({ ...editForm, answer: e.target.value })} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#002864] outline-none text-sm font-bold" />
                    </div>

                    <div className="border-t border-slate-200 my-2 pt-4">
                      <h4 className="text-sm font-extrabold text-emerald-700 mb-3">📝 4단계 풀이 과정</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-slate-500">Step 1. 개념</label>
                          <textarea value={editForm.step_1_concept} onChange={e => setEditForm({ ...editForm, step_1_concept: e.target.value })} className="w-full h-20 p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-[13px] resize-none" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-slate-500">Step 2. 접근</label>
                          <textarea value={editForm.step_2_approach} onChange={e => setEditForm({ ...editForm, step_2_approach: e.target.value })} className="w-full h-20 p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-[13px] resize-none" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-slate-500">Step 3. 과정</label>
                          <textarea value={editForm.step_3_process} onChange={e => setEditForm({ ...editForm, step_3_process: e.target.value })} className="w-full h-20 p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-[13px] resize-none" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-slate-500">Step 4. 결론</label>
                          <textarea value={editForm.step_4_conclusion} onChange={e => setEditForm({ ...editForm, step_4_conclusion: e.target.value })} className="w-full h-20 p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-[13px] resize-none" />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-2 mb-4">
                      {renderImageBox("정답 이미지 1", "answer_image_url", "emerald")}
                      {renderImageBox("정답 이미지 2", "answer_image_2_url", "emerald")}
                    </div>

                  </div>
                )}
              </div>

              {/* 하단: 8단계 Taxonomy 에디터 */}
              {!isEditingContent && (
                <div className="flex-1 p-6 bg-slate-50/50 overflow-y-auto custom-scroll flex flex-col shrink-0">
                  <h3 className="font-extrabold text-slate-800 mb-4 flex items-center gap-2">
                    <span>🎯</span> Taxonomy 강제 지정 (8-Depth) 
                    <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded ml-2 shadow-sm">선택 상태 유지됨</span>
                    {isTaxonomyLoading && <span className="text-[10px] text-rose-500 animate-pulse ml-2 font-bold">분류 데이터 로딩중...</span>}
                  </h3>

                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 1 (학교)</label>
                      <select value={selD1} onChange={e => handleD1Change(e.target.value)} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#002864] shadow-sm bg-white">
                        <option value="">선택</option>{d1Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 2 (학년/학기)</label>
                      <select value={selD2} onChange={e => handleD2Change(e.target.value)} disabled={!selD1 || d2Options.length === 0} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#002864] shadow-sm disabled:bg-slate-100 bg-white">
                        <option value="">{d2Options.length === 0 && selD1 ? '옵션 없음' : '선택'}</option>{d2Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 3 (대단원)</label>
                      <select value={selD3} onChange={e => handleD3Change(e.target.value)} disabled={!selD2 || d3Options.length === 0} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#002864] shadow-sm disabled:bg-slate-100 bg-white">
                        <option value="">{d3Options.length === 0 && selD2 ? '옵션 없음' : '선택'}</option>{d3Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 4 (중단원)</label>
                      <select value={selD4} onChange={e => handleD4Change(e.target.value)} disabled={!selD3 || d4Options.length === 0} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#002864] shadow-sm disabled:bg-slate-100 bg-white">
                        <option value="">{d4Options.length === 0 && selD3 ? '옵션 없음' : '선택'}</option>{d4Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 5 (소단원)</label>
                      <select value={selD5} onChange={e => handleD5Change(e.target.value)} disabled={!selD4 || d5Options.length === 0} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#002864] shadow-sm disabled:bg-slate-100 bg-white">
                        <option value="">{d5Options.length === 0 && selD4 ? '옵션 없음' : '선택'}</option>{d5Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 6 (유형)</label>
                      <select value={selD6} onChange={e => handleD6Change(e.target.value)} disabled={!selD5 || d6Options.length === 0} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#002864] shadow-sm disabled:bg-slate-100 bg-white">
                        <option value="">{d6Options.length === 0 && selD5 ? '옵션 없음' : '선택'}</option>{d6Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 7 (개념)</label>
                      <select value={selD7} onChange={e => handleD7Change(e.target.value)} disabled={!selD6 && (!selD5 || d6Options.length > 0)} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm disabled:bg-slate-100 bg-emerald-50 text-emerald-900">
                        <option value="">{d7Options.length === 0 && (selD6 || (selD5 && d6Options.length===0)) ? '옵션 없음' : '선택'}</option>{d7Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-rose-500">Depth 8 (문항유형 - 아이템)</label>
                      <select value={selD8} onChange={e => setSelD8(e.target.value)} disabled={d8Options.length === 0} className="p-2 text-xs font-bold border border-rose-300 rounded-lg outline-none focus:ring-2 focus:ring-rose-500 shadow-sm disabled:bg-slate-100 bg-rose-50 text-rose-900">
                        <option value="">{d8Options.length === 0 ? '8뎁스 없음' : '선택'}</option>
                        {d8Options.map((o: any) => <option key={o.item_id} value={o.item_id}>{o.depth8}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="mt-auto flex justify-end">
                    <button 
                      onClick={saveTaxonomy} 
                      disabled={!finalCalculatedTaxId || isLoading} 
                      className="px-8 py-3 bg-[#002864] hover:bg-blue-900 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black rounded-xl shadow-md transition-colors flex items-center gap-2"
                    >
                      {isLoading ? "저장 중..." : "💾 DB 강제 업데이트 (Save & Next)"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}