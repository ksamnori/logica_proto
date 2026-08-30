// src/app/(dashboard)/taxonomy-editor/page.tsx
"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const taxSort = (a: string, b: string) => {
  const order: Record<string, number> = { '초등학교': 1, '중학교': 2, '고등학교': 3 };
  if (order[a] && order[b] && order[a] !== order[b]) return order[a] - order[b];
  return String(a).localeCompare(String(b), 'ko', { numeric: true });
};

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
};

const formatQNum = (qNum: string | number, subNum?: string | number) => {
  let numStr = String(qNum || "").trim().replace(/-0$/, '');
  
  if (subNum !== undefined && subNum !== null && String(subNum).trim() !== "") {
    const cleanSubNum = String(subNum).replace(/[()]/g, '').trim();
    if (cleanSubNum !== "") {
      numStr = `${numStr}-${cleanSubNum}`;
    }
  }
  
  return numStr.replace(/-0$/, '');
};

const parseNatural = (str: string) => {
  return String(str || "")
    .match(/(\d+)|(\D+)/g)
    ?.map(part => {
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

const fetchAllRows = async (tableName: string, selectQuery: string = '*', filterCol?: string, filterVal?: string) => {
  let allData: any[] = [];
  let start = 0;
  const step = 1000;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(tableName).select(selectQuery);
    
    if (filterCol && filterVal !== undefined) {
      query = query.eq(filterCol, filterVal);
    }
    
    if (tableName === 'question_db' || tableName === 'textbook_question') {
      query = query.order('question_id', { ascending: true });
    } else if (tableName === 'master_category') {
      query = query.order('category_id', { ascending: true });
    } else if (tableName === 'master_item') {
      query = query.order('item_id', { ascending: true });
    }

    query = query.range(start, start + step - 1);
    
    const { data, error } = await query;
    if (error) { console.error(`${tableName} 로드 실패:`, error); break; }
    if (data && data.length > 0) { allData = [...allData, ...data]; start += step; }
    if (!data || data.length < step) hasMore = false; 
  }
  return allData;
};

export default function TaxonomyEditorPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [perms, setPerms] = useState({ add: false, delete: false, edit: false, twin: false });

  const [categories, setCategories] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [isTaxonomyLoading, setIsTaxonomyLoading] = useState(true);

  const [workbooks, setWorkbooks] = useState<string[]>([]);
  const [selectedBook, setSelectedBook] = useState<string>("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editForm, setEditForm] = useState({ 
    page_number: '', question_number: '', sub_num: '',
    difficulty: '미지정', solving_probability: '',
    question: '', answer: '', 
    image_url: '', image_2_url: '', 
    answer_image_url: '', answer_image_2_url: '',
    step_1_concept: '', step_2_approach: '', step_3_process: '', step_4_conclusion: ''
  });

  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [cropTargetField, setCropTargetField] = useState<string | null>(null);
  const [hasCropArea, setHasCropArea] = useState(false);
  
  const imgRef = useRef<HTMLImageElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);
  const isCroppingRef = useRef(false);
  const cropStartRef = useRef<{x: number, y: number} | null>(null);
  const cropRectRef = useRef<{x: number, y: number, w: number, h: number} | null>(null);

  const [selD1, setSelD1] = useState(""); const [selD2, setSelD2] = useState("");
  const [selD3, setSelD3] = useState(""); const [selD4, setSelD4] = useState("");
  const [selD5, setSelD5] = useState(""); const [selD6, setSelD6] = useState("");
  const [selD7, setSelD7] = useState(""); const [selD8, setSelD8] = useState("");

  const mathJaxRef = useRef<boolean>(false);

  const [isGeneratingTwins, setIsGeneratingTwins] = useState(false);
  const [generatedTwins, setGeneratedTwins] = useState<any[]>([]);
  const [isTwinModalOpen, setIsTwinModalOpen] = useState(false);

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
        setPerms({ add: true, delete: true, edit: true, twin: true });
        return; 
      }
      
      const { data, error } = await supabase.from('tenant_role_permissions').select('allowed_menus').eq('tenant_id', tId).eq('role_name', role).single();
      
      if (!error && data && data.allowed_menus.includes("/taxonomy-editor")) {
        setIsAuthorized(true);
        setPerms({
          add: data.allowed_menus.includes("action_add_question"),
          delete: data.allowed_menus.includes("action_delete_question"),
          edit: data.allowed_menus.includes("action_edit_question"),
          twin: data.allowed_menus.includes("action_generate_twins"),
        });
      } else { 
        alert("⛔ 권한이 없습니다."); 
        router.replace("/home"); 
      }
    };
    checkAccess();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) { loadMasterTaxonomy(); loadWorkbooks(); loadMathJax(); }
  }, [isAuthorized]);

  useEffect(() => {
    const renderMath = () => {
      if ((window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch((err: any) => console.log("MathJax 에러:", err));
      }
    };
    const timer = setTimeout(renderMath, 150);
    return () => clearTimeout(timer);
  }, [questions, selectedQuestion, isEditingContent, generatedTwins, isTwinModalOpen]);

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
      setCategories(catData || []); setItems(itemData || []);
    } catch (e) { console.error("Taxonomy 로드 실패", e); } 
    finally { setIsTaxonomyLoading(false); }
  };

  const loadWorkbooks = async () => {
    try {
      const tbData = await fetchAllRows('textbook', 'title');
      const qbData = await fetchAllRows('question_db', 'source_book_name');
      const titles = tbData.map(t => t.title);
      const sources = qbData.map(q => q.source_book_name);
      
      const uniqueList = Array.from(new Set([...titles, ...sources])).filter(Boolean).sort(taxSort);
      setWorkbooks(uniqueList as string[]);
    } catch (e) { console.error(e); }
  };

  const handleRenameBook = async () => {
    if (!selectedBook) return alert("이름을 변경할 교재(문제지 덩어리)를 먼저 선택해주세요.");
    
    const newName = prompt(`현재 이름: ${selectedBook}\n새로운 덩어리 이름을 입력하세요:`, selectedBook);
    if (!newName || newName.trim() === "" || newName.trim() === selectedBook) return;

    setIsLoading(true);
    try {
      const { error: qErr } = await supabase
        .from('question_db')
        .update({ source_book_name: newName.trim() })
        .eq('source_book_name', selectedBook);
      if (qErr) throw qErr;

      const { data: tb } = await supabase.from('textbook').select('book_id').eq('title', selectedBook).maybeSingle();
      if (tb) {
        await supabase.from('textbook').update({ title: newName.trim() }).eq('book_id', tb.book_id);
      }

      alert(`✅ '${newName.trim()}'(으)로 이름이 통째로 변경되었습니다!`);
      
      setSelectedBook(newName.trim());
      setQuestions(prev => prev.map(q => ({ ...q, source_book_name: newName.trim() })));
      await loadWorkbooks(); 

    } catch (err: any) {
      alert("이름 변경 실패: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchQuestions = async () => {
    if (!selectedBook) return;
    setIsLoading(true);
    try {
      const qidSet = new Set<string>();

      let from1 = 0;
      while(true) {
         const {data} = await supabase.from("question_db").select("question_id").eq("source_book_name", selectedBook).range(from1, from1+999);
         if (data) data.forEach(d => qidSet.add(String(d.question_id).trim()));
         if (!data || data.length < 1000) break;
         from1 += 1000;
      }

      const { data: tb } = await supabase.from('textbook').select('book_id').eq('title', selectedBook).maybeSingle();
      if (tb) {
         let from2 = 0;
         while(true) {
           const {data} = await supabase.from('textbook_question').select('question_id').eq('book_id', tb.book_id).range(from2, from2+999);
           if (data) data.forEach(d => qidSet.add(String(d.question_id).trim()));
           if (!data || data.length < 1000) break;
           from2 += 1000;
         }
      }

      let fetchedQuestions: any[] = [];
      const qidArray = Array.from(qidSet);
      for (let i = 0; i < qidArray.length; i += 500) {
         const chunk = qidArray.slice(i, i + 500);
         const {data} = await supabase.from("question_db").select("*").in("question_id", chunk);
         if (data) fetchedQuestions.push(...data);
      }

      let currentQids = new Set(fetchedQuestions.map(q => String(q.question_id).trim().toLowerCase()));

      while (true) {
        const pids = fetchedQuestions.map(q => q.parent_question_id).filter(id => id && String(id).trim().toLowerCase() !== 'null');
        const uniqueCleanPids = Array.from(new Set(pids.map(id => String(id).trim())));
        const missingPids = uniqueCleanPids.filter(pid => !currentQids.has(pid.toLowerCase()));
        
        if (missingPids.length === 0) break; 
        
        missingPids.forEach(pid => currentQids.add(pid.toLowerCase()));
        
        let newlyFetchedParents: any[] = [];
        for (let i = 0; i < missingPids.length; i += 500) {
          const chunk = missingPids.slice(i, i + 500);
          const { data: chunkData } = await supabase.from("question_db").select("*").in("question_id", chunk);
          if (chunkData) newlyFetchedParents.push(...chunkData);
        }
        
        fetchedQuestions = [...fetchedQuestions, ...newlyFetchedParents];
      }

      let searchedParentIds = new Set<string>();
      while (true) {
        const qidsToSearch = fetchedQuestions
          .map(q => String(q.question_id).trim())
          .filter(id => !searchedParentIds.has(id.toLowerCase()));
          
        if (qidsToSearch.length === 0) break;
        
        qidsToSearch.forEach(id => searchedParentIds.add(id.toLowerCase()));
        
        let newlyFetchedChildren: any[] = [];
        for (let i = 0; i < qidsToSearch.length; i += 500) {
          const chunk = qidsToSearch.slice(i, i + 500);
          const { data: chunkData } = await supabase.from("question_db").select("*").in("parent_question_id", chunk);
          if (chunkData) {
            const freshChildren = chunkData.filter(c => !currentQids.has(String(c.question_id).trim().toLowerCase()));
            newlyFetchedChildren.push(...freshChildren);
          }
        }
        
        newlyFetchedChildren.forEach(q => currentQids.add(String(q.question_id).trim().toLowerCase()));
        fetchedQuestions = [...fetchedQuestions, ...newlyFetchedChildren];
      }

      const finalMap = new Map();
      fetchedQuestions.forEach(q => finalMap.set(q.question_id, q));
      const finalQuestions = Array.from(finalMap.values());

      setQuestions(sortQuestionsList(finalQuestions));
      setSelectedQuestion(null); 
      setIsEditingContent(false);
    } catch (e) { 
      console.error(e); 
    } finally { 
      setIsLoading(false); 
    }
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

  const handleAutoFillTaxonomy = () => {
    const taxId = selectedQuestion?.taxonomy_id;
    if (!taxId || taxId === '미분류') return;
    const matchedItem = items.find(i => i.item_id === taxId);
    const catId = matchedItem ? matchedItem.category_id : taxId;
    const cat = categories.find(c => c.category_id === catId);
    if (cat) {
      setSelD1(cat.depth1 || ""); setSelD2(cat.depth2 || ""); setSelD3(cat.depth3 || ""); setSelD4(cat.depth4 || "");
      setSelD5(cat.depth5 || ""); setSelD6(cat.depth6 || ""); setSelD7(cat.depth7 || ""); setSelD8(matchedItem ? matchedItem.item_id : "");
    }
  };

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
      c.depth1 === selD1 && (selD2 ? c.depth2 === selD2 : (!c.depth2 || c.depth2 === '')) &&
      (selD3 ? c.depth3 === selD3 : (!c.depth3 || c.depth3 === '')) && (selD4 ? c.depth4 === selD4 : (!c.depth4 || c.depth4 === '')) &&
      (selD5 ? c.depth5 === selD5 : (!c.depth5 || c.depth5 === '')) && (selD6 ? c.depth6 === selD6 : (!c.depth6 || c.depth6 === '')) &&
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
    setSelectedQuestion(q); setIsEditingContent(false); 
    setEditForm({ 
      page_number: String(q.final_printed_page || q.detected_page_num || ''), question_number: String(q.question_number || ''),
      sub_num: String(q.sub_num || ''), difficulty: q.difficulty || '미지정',
      solving_probability: q.solving_probability !== null && q.solving_probability !== undefined ? String(q.solving_probability) : '',
      question: q.question || '', answer: q.answer || '', image_url: q.image_url || '', image_2_url: q.image_2_url || '',
      answer_image_url: q.answer_image_url || '', answer_image_2_url: q.answer_image_2_url || '',
      step_1_concept: q.step_1_concept || '', step_2_approach: q.step_2_approach || '',
      step_3_process: q.step_3_process || '', step_4_conclusion: q.step_4_conclusion || ''
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
      if (currentIndex >= 0 && currentIndex < questions.length - 1) handleQuestionClick(questions[currentIndex + 1]);
      else alert("✅ 해당 교재의 마지막 문제입니다. Taxonomy ID가 저장되었습니다.");
    } catch (err: any) { alert("업데이트 실패: " + err.message); } finally { setIsLoading(false); }
  };

  const createNewQuestion = async () => {
    if (!selectedBook) return alert("문항을 추가할 교재를 왼쪽 위에서 먼저 선택(조회)해주세요.");
    if (!confirm(`'${selectedBook}' 교재에 새로운 빈 문항을 강제로 추가하시겠습니까?`)) return;
    setIsLoading(true);
    try {
      const newQuestionId = generateUUID();
      // 🌟 '미지정' 대신 DB가 허용하는 null 전송
      const newDbData = { 
        question_id: newQuestionId, 
        source_book_name: selectedBook, 
        question_number: 'NEW', 
        question: '새로운 문항입니다. 우측 상단의 수정 버튼을 눌러 내용을 입력해주세요.', 
        taxonomy_id: '미분류', 
        difficulty: null 
      };
      
      const { data: newQ, error: dbErr } = await supabase.from('question_db').insert(newDbData).select().single();
      if (dbErr) throw dbErr;
      
      const { data: tb } = await supabase.from('textbook').select('book_id').eq('title', selectedBook).maybeSingle();
      if (tb) {
        await supabase.from('textbook_question').insert({ book_id: tb.book_id, question_id: newQ.question_id, page_number: 999, question_number: 'NEW', question: newQ.question, question_category: '일반', taxonomy_id: '미분류' });
      }
      
      setQuestions(prev => sortQuestionsList([...prev, newQ])); setSelectedQuestion(newQ);
      setEditForm({ page_number: '999', question_number: 'NEW', sub_num: '0', difficulty: '미지정', solving_probability: '', question: newQ.question, answer: '', image_url: '', image_2_url: '', answer_image_url: '', answer_image_2_url: '', step_1_concept: '', step_2_approach: '', step_3_process: '', step_4_conclusion: '' });
      setIsEditingContent(true);
      setTimeout(() => { const el = document.getElementById(`q-list-${newQ.question_id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
    } catch (e: any) { 
      alert("추가 실패: " + e.message); 
    } finally { 
      setIsLoading(false); 
    }
  };

  const deleteQuestion = async () => {
    if (!selectedQuestion) return;
    if (!confirm("⚠️ 정말 이 문항을 DB에서 완전히 삭제하시겠습니까? (연결된 자식 쌍둥이 문항도 함께 영향을 받을 수 있습니다.)")) return;
    setIsLoading(true);
    try {
      await supabase.from('textbook_question').delete().eq('question_id', selectedQuestion.question_id);
      const { error } = await supabase.from('question_db').delete().eq('question_id', selectedQuestion.question_id);
      if (error) throw error;
      setQuestions(prev => prev.filter(q => q.question_id !== selectedQuestion.question_id));
      setSelectedQuestion(null); setIsEditingContent(false);
      alert("✅ 문항이 삭제되었습니다.");
    } catch (e: any) { alert("삭제 실패: " + e.message); } finally { setIsLoading(false); }
  };

  const getCleanUrl = (url: string) => {
    if (!url || url === 'null' || url === 'undefined') return '';
    let validUrl = String(url).trim();
    
    if (validUrl.startsWith('[')) {
      try {
        const parsed = JSON.parse(validUrl);
        if (Array.isArray(parsed) && parsed.length > 0) {
          validUrl = String(parsed[0]).trim();
        }
      } catch(e) {}
    }
    
    validUrl = validUrl.replace(/^["']|["']$/g, '').trim();
    
    const lowerUrl = validUrl.toLowerCase();
    
    if (validUrl && validUrl !== 'null' && !lowerUrl.startsWith('http') && !lowerUrl.startsWith('data:image') && !lowerUrl.startsWith('blob:')) {
      if (validUrl.startsWith('/')) validUrl = validUrl.substring(1);
      
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kfwlmbwornivkrvoeqdh.supabase.co";
      validUrl = `${baseUrl}/storage/v1/object/public/question_images/${validUrl}`;
    }
    
    return validUrl;
  };

  const handleImageInput = (file: File, fieldKey: string) => {
    if (file && file.type.startsWith("image/")) { const url = URL.createObjectURL(file); setCropImageSrc(url); setCropTargetField(fieldKey); setHasCropArea(false); if (selectionBoxRef.current) selectionBoxRef.current.style.display = 'none'; }
  };

  const handlePaste = (e: React.ClipboardEvent, fieldKey: string) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) { if (items[i].type.indexOf("image") !== -1) { e.preventDefault(); handleImageInput(items[i].getAsFile() as File, fieldKey); break; } }
  };

  const handleDrop = (e: React.DragEvent, fieldKey: string) => {
    e.preventDefault(); if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleImageInput(e.dataTransfer.files[0], fieldKey);
  };

  const handleCropMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    e.preventDefault(); isCroppingRef.current = true;
    cropStartRef.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    cropRectRef.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, w: 0, h: 0 };
    setHasCropArea(false); if (selectionBoxRef.current) selectionBoxRef.current.style.display = 'none';
  };

  const handleCropMouseMove = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isCroppingRef.current || !cropStartRef.current) return;
    const currentX = e.nativeEvent.offsetX; const currentY = e.nativeEvent.offsetY;
    const newRect = { x: Math.min(cropStartRef.current.x, currentX), y: Math.min(cropStartRef.current.y, currentY), w: Math.abs(currentX - cropStartRef.current.x), h: Math.abs(currentY - cropStartRef.current.y) };
    cropRectRef.current = newRect;
    if (selectionBoxRef.current) { selectionBoxRef.current.style.display = 'block'; selectionBoxRef.current.style.left = `${newRect.x}px`; selectionBoxRef.current.style.top = `${newRect.y}px`; selectionBoxRef.current.style.width = `${newRect.w}px`; selectionBoxRef.current.style.height = `${newRect.h}px`; }
  };

  const handleCropMouseUp = () => { isCroppingRef.current = false; if (cropRectRef.current && cropRectRef.current.w > 0) setHasCropArea(true); };

  const handleCropUpload = async (useOriginal: boolean) => {
    if (!imgRef.current || !cropImageSrc || !cropTargetField) return;
    setIsLoading(true);
    try {
      let blobToUpload: Blob | null = null;
      if (useOriginal || !cropRectRef.current || cropRectRef.current.w === 0) {
        const response = await fetch(cropImageSrc); blobToUpload = await response.blob();
      } else {
        const canvas = document.createElement('canvas');
        const scaleX = imgRef.current.naturalWidth / imgRef.current.width; const scaleY = imgRef.current.naturalHeight / imgRef.current.height;
        canvas.width = cropRectRef.current.w * scaleX; canvas.height = cropRectRef.current.h * scaleY;
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error("Canvas 생성 실패");
        ctx.drawImage(imgRef.current, cropRectRef.current.x * scaleX, cropRectRef.current.y * scaleY, cropRectRef.current.w * scaleX, cropRectRef.current.h * scaleY, 0, 0, canvas.width, canvas.height);
        blobToUpload = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      }
      if (!blobToUpload) throw new Error("이미지 변환 실패");
      
      const fileName = `crop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
      const { error } = await supabase.storage.from('question_images').upload(fileName, blobToUpload);
      if (error) throw error;
      
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kfwlmbwornivkrvoeqdh.supabase.co";
      const finalUploadUrl = `${baseUrl}/storage/v1/object/public/question_images/${fileName}`;
      
      setEditForm(prev => ({ ...prev, [cropTargetField]: finalUploadUrl })); 
      setCropImageSrc(null); setCropTargetField(null); 
      alert("✅ 이미지가 업로드 되었습니다!");
    } catch (err: any) { alert("이미지 업로드 실패: " + err.message); } finally { setIsLoading(false); }
  };

  const renderImageBox = (label: string, fieldKey: string, colorTheme: 'indigo' | 'emerald') => {
    const rawValue = editForm[fieldKey as keyof typeof editForm] as string;
    const displayUrl = getCleanUrl(rawValue); 
    const colorClasses = colorTheme === 'indigo' ? "border-indigo-300 bg-indigo-50/30 hover:bg-indigo-50 focus:ring-indigo-500 text-indigo-800" : "border-emerald-300 bg-emerald-50/30 hover:bg-emerald-50 focus:ring-emerald-500 text-emerald-800";
    
    return (
      <div className="flex flex-col gap-1.5 bg-white p-3 rounded-xl border border-slate-200 shadow-sm relative">
        <label className="text-xs font-bold text-slate-500 flex justify-between items-center mb-1">
          <span>{label}</span>
          {rawValue && (
            <div className="flex items-center gap-2">
              <a href={displayUrl} target="_blank" className="text-blue-500 hover:text-blue-700 underline tracking-tighter">원본 보기 ↗</a>
              <span className="text-slate-200">|</span>
              <button type="button" onClick={() => setEditForm({ ...editForm, [fieldKey]: '' })} className="text-rose-500 hover:text-rose-700 underline tracking-tighter">삭제 🗑️</button>
            </div>
          )}
        </label>
        <div 
          onDrop={(e) => handleDrop(e, fieldKey)} onDragOver={(e) => e.preventDefault()} onPaste={(e) => handlePaste(e, fieldKey)} tabIndex={0}
          className={`w-full h-28 border-2 border-dashed rounded-lg text-center cursor-pointer focus:ring-2 outline-none transition-all flex flex-col items-center justify-center relative group overflow-hidden ${colorClasses}`}
          onClick={() => { setCropTargetField(fieldKey); document.getElementById('globalFileInput')?.click(); }}
        >
          {rawValue && <img src={displayUrl} className="absolute inset-0 w-full h-full object-contain opacity-30 group-hover:opacity-10 transition-opacity" alt="" />}
          <span className="text-2xl mb-1 relative z-10 group-hover:scale-110 transition-transform">📸</span>
          <span className="text-[10px] font-bold relative z-10">클릭, 드래그 또는 붙여넣기(Ctrl+V)</span>
        </div>
        <input type="text" value={rawValue} onChange={e => setEditForm({ ...editForm, [fieldKey]: e.target.value })} className="w-full p-2 border border-slate-200 rounded-lg focus:border-blue-400 outline-none text-[10px] text-slate-500 bg-slate-50 mt-1" placeholder="직접 URL 입력..." />
      </div>
    );
  };

  const saveQuestionContent = async () => {
    if (!selectedQuestion) return;
    setIsLoading(true);
    try {
      const parsedPage = parseInt(editForm.page_number) || null;
      const parsedSubNum = parseInt(editForm.sub_num) || 0;
      const parsedProbability = editForm.solving_probability.trim() === '' ? null : parseFloat(editForm.solving_probability);

      const updateData = {
        final_printed_page: parsedPage, question_number: editForm.question_number, sub_num: parsedSubNum,
        difficulty: editForm.difficulty === '미지정' ? null : editForm.difficulty, solving_probability: parsedProbability,
        question: editForm.question, answer: editForm.answer,
        image_url: editForm.image_url, image_2_url: editForm.image_2_url, answer_image_url: editForm.answer_image_url, answer_image_2_url: editForm.answer_image_2_url,
        step_1_concept: editForm.step_1_concept, step_2_approach: editForm.step_2_approach, step_3_process: editForm.step_3_process, step_4_conclusion: editForm.step_4_conclusion
      };

      const { error: dbError } = await supabase.from('question_db').update(updateData).eq('question_id', selectedQuestion.question_id);
      if (dbError) throw dbError;

      await supabase.from('textbook_question').update({ page_number: parsedPage || 0, question_number: updateData.question_number, question: updateData.question, answer: updateData.answer }).eq('question_id', selectedQuestion.question_id);

      const updatedQuestion = { ...selectedQuestion, ...updateData };
      setQuestions(prev => sortQuestionsList(prev.map(q => q.question_id === selectedQuestion.question_id ? updatedQuestion : q)));
      setSelectedQuestion(updatedQuestion); setIsEditingContent(false);
      alert("✅ 수정되었습니다!");
    } catch (err: any) { alert("수정 실패: " + err.message); } finally { setIsLoading(false); }
  };

  const handleGenerateTwins = async () => {
    if (!selectedQuestion) return alert("원본 문항을 먼저 왼쪽 리스트에서 선택해주세요.");
    
    const taxStr = getKoreanPath(selectedQuestion.taxonomy_id);
    if (!taxStr || taxStr === '분류 정보 없음' || taxStr === '미분류') {
      if (!confirm("현재 문항의 분류(Taxonomy)가 지정되지 않았습니다.\nAI가 문항의 핵심 개념을 파악하기 어려울 수 있습니다. 그래도 계속하시겠습니까?")) return;
    }

    setIsGeneratingTwins(true);
    setGeneratedTwins([]);
    setIsTwinModalOpen(true);

    try {
      const res = await fetch('/api/gemini-twin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalQuestion: selectedQuestion.question,
          originalAnswer: selectedQuestion.answer,
          taxonomyStr: taxStr
        })
      });

      const contentType = res.headers.get("content-type");
      if (!res.ok || !contentType?.includes("application/json")) {
        throw new Error(`AI 서버 연결 오류 (${res.status})`);
      }

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
        isSelected: true,
        isPreviewMode: false,
        question_type: twin.question_type || (idx === 0 ? '쌍둥이' : '유사')
      }));

      setGeneratedTwins(cleanedTwins);

    } catch (e: any) {
      alert("쌍둥이 생성 중 오류 발생: " + e.message);
      setIsTwinModalOpen(false);
    } finally {
      setIsGeneratingTwins(false);
    }
  };

  const saveTwinsToDB = async () => {
    const selectedTwinsToSave = generatedTwins.filter(t => t.isSelected !== false);
    if (selectedTwinsToSave.length === 0) return alert("저장할 문항을 하나 이상 체크박스에서 선택해주세요.");
    
    if (!confirm(`선택된 ${selectedTwinsToSave.length}개의 쌍둥이/유사 문항을 마스터 DB에 저장하시겠습니까?\n(원본 문항에 꼬리로 연결됩니다.)`)) return;

    setIsLoading(true);
    try {
      const twinInserts = selectedTwinsToSave.map((twin, idx) => ({
        question_id: generateUUID(),
        parent_question_id: selectedQuestion.question_id,
        source_book_name: selectedBook, 
        detected_page_num: selectedQuestion.detected_page_num || 0,
        final_printed_page: selectedQuestion.final_printed_page,
        question_number: `${selectedQuestion.question_number}-T${idx + 1}`, 
        question: twin.question,
        answer: twin.answer,
        step_1_concept: twin.step_1_concept,
        step_2_approach: twin.step_2_approach,
        step_3_process: twin.step_3_process,
        step_4_conclusion: twin.step_4_conclusion,
        taxonomy_id: selectedQuestion.taxonomy_id,
        difficulty: selectedQuestion.difficulty || '중',
        is_human_verified: true,
        derivation_type: twin.question_type === '유사' ? '유사' : 'TWIN' 
      }));

      const { error } = await supabase.from('question_db').insert(twinInserts);
      if (error) throw error;

      alert(`✅ 선택된 ${selectedTwinsToSave.length}개의 문항이 성공적으로 저장되었습니다!`);
      setIsTwinModalOpen(false);
      fetchQuestions(); 

    } catch (e: any) {
      alert("쌍둥이 저장 실패: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTwinChange = (index: number, field: string, value: any) => {
    const updated = [...generatedTwins];
    updated[index][field] = value;
    setGeneratedTwins(updated);
  };

  const allQMap = useMemo(() => {
    return new Map(questions.map(q => [String(q.question_id).trim().toLowerCase(), q]));
  }, [questions]);

  const normalRoots = useMemo(() => {
    return questions.filter(q => {
      const pid = q.parent_question_id;
      return !pid || String(pid).trim().toLowerCase() === 'null' || String(pid).trim() === '';
    });
  }, [questions]);

  const trueOrphans = useMemo(() => {
    return questions.filter(q => {
      const pid = q.parent_question_id;
      return pid && String(pid).trim().toLowerCase() !== 'null' && String(pid).trim() !== '' && !allQMap.has(String(pid).trim().toLowerCase());
    });
  }, [questions, allQMap]);

  const childrenMap = useMemo(() => {
    const map = new Map<string, any[]>();
    questions.forEach(q => {
      const pid = q.parent_question_id;
      if (pid && String(pid).trim().toLowerCase() !== 'null' && String(pid).trim() !== '') {
        const key = String(pid).trim().toLowerCase();
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(q);
      }
    });
    return map;
  }, [questions]);

  const getDescendants = (parentId: string, visited = new Set<string>()): any[] => {
    if (visited.has(parentId)) return [];
    visited.add(parentId);
    const children = childrenMap.get(parentId.toLowerCase()) || [];
    let result = [...children];
    children.forEach(c => {
      result = [...result, ...getDescendants(String(c.question_id).trim().toLowerCase(), visited)];
    });
    return result;
  };

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden relative">
      
      <input id="globalFileInput" type="file" accept="image/*" onChange={(e) => { if(e.target.files?.[0] && cropTargetField) handleImageInput(e.target.files[0], cropTargetField); e.target.value = ''; }} className="hidden" />

      {/* 크롭퍼 모달 */}
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
            <div ref={selectionBoxRef} style={{ display: 'none', position: 'absolute', border: '2px dashed #0ea5e9', backgroundColor: 'rgba(14, 165, 233, 0.2)', pointerEvents: 'none' }} />
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

      {/* AI 쌍둥이/유사 문항 모달 */}
      {isTwinModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 flex flex-col items-center justify-center p-6 sm:p-10 animate-in fade-in backdrop-blur-sm">
          <div className="bg-white w-full max-w-6xl h-full max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
            <div className="p-5 bg-gradient-to-r from-fuchsia-600 to-indigo-600 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-black text-white flex items-center gap-2">
                  <span>👯</span> AI 쌍둥이/유사 문항 생성기
                </h2>
                <p className="text-fuchsia-100 font-bold text-xs mt-1">숫자와 상황이 변형된 클리닉용 유사 문항이 자동으로 생성되었습니다. 저장할 문제를 선택하세요.</p>
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
                  <p className="text-sm font-bold text-slate-400">수식과 4단계 해설을 작성 중이므로 약 10초 정도 소요됩니다.</p>
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
                        
                        <button
                          onClick={() => handleTwinChange(idx, 'isPreviewMode', !twin.isPreviewMode)}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors shadow-sm ${twin.isPreviewMode ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                        >
                          {twin.isPreviewMode ? <><span>✏️</span> 텍스트 편집 모드</> : <><span>👀</span> 수식 미리보기</>}
                        </button>
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

            <div className="p-5 bg-white border-t border-slate-200 flex justify-end shrink-0">
              <button 
                onClick={saveTwinsToDB} 
                disabled={isGeneratingTwins || generatedTwins.length === 0 || isLoading}
                className="px-8 py-3 bg-[#002864] hover:bg-blue-900 disabled:bg-slate-300 text-white font-black rounded-xl shadow-lg transition-colors flex items-center gap-2"
              >
                {isLoading ? "저장 중..." : `💾 선택된 ${generatedTwins.filter(t => t.isSelected !== false).length}개 쌍둥이/유사 문항을 마스터 DB에 저장`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 메인 UI */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center mb-4 shrink-0 gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#002864] flex items-center gap-2">
            <span>⚙️</span> 문제 교정 및 쌍둥이/유사 문제 생성
          </h1>
          <p className="text-sm font-bold text-slate-500 mt-1">AI 자동 분류가 미흡한 문제를 확인하고, 정확한 8단계 뎁스로 업데이트 하거나 문항을 직접 수정합니다.</p>
        </div>
      </div>

      <div className="bg-white px-6 py-4 border border-slate-200 rounded-xl flex items-end gap-4 mb-4 shrink-0 shadow-sm">
        <div className="flex flex-col gap-1.5 flex-1 max-w-md">
          <span className="text-xs font-bold text-slate-500">마스터 DB 전체 교재 검색:</span>
          <div className="flex items-center gap-2">
            <select value={selectedBook} onChange={(e) => setSelectedBook(e.target.value)} className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg font-bold text-[#002864] bg-slate-50 text-sm shadow-sm outline-none focus:ring-2 focus:ring-[#002864]">
              <option value="">교재를 선택하세요...</option>
              {workbooks.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <button onClick={handleRenameBook} disabled={!selectedBook || isLoading} className="whitespace-nowrap shrink-0 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold rounded-lg shadow-sm border border-slate-300 transition-colors disabled:opacity-50" title="선택한 문제지 덩어리의 이름을 통째로 변경합니다.">
              ✏️ 이름 일괄 변경
            </button>
          </div>
        </div>
        <button onClick={fetchQuestions} disabled={!selectedBook || isLoading} className="px-6 py-2 bg-[#002864] hover:bg-blue-900 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 transition-colors whitespace-nowrap shrink-0">
          조회하기
        </button>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        
        {/* 좌측: 문제 리스트 */}
        <div className="w-[400px] bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden shrink-0">
          <div className="p-3 bg-slate-100/80 border-b border-slate-200 flex justify-between items-center shrink-0">
            <h2 className="font-extrabold text-slate-800 text-sm">📋 전체 문항 리스트 ({questions.length}개)</h2>
            <button onClick={createNewQuestion} disabled={!selectedBook || isLoading || !perms.add} className={`text-[10px] text-white px-2.5 py-1.5 rounded font-bold shadow-sm flex items-center gap-1 transition-colors ${perms.add ? 'bg-[#002864] hover:bg-blue-800' : 'bg-slate-300 cursor-not-allowed'}`} title={!perms.add ? "새 문항 추가 권한이 없습니다." : ""}>
              <span>➕</span> 새 문항 추가
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 custom-scroll bg-slate-50/50">
            {questions.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">교재를 조회해주세요.</div>
            ) : (
              <>
                {normalRoots.map(q => {
                  const isSelected = selectedQuestion?.question_id === q.question_id;
                  const hasTaxonomy = q.taxonomy_id && q.taxonomy_id !== '미분류';
                  const myTwins = getDescendants(String(q.question_id).trim().toLowerCase());

                  return (
                    <React.Fragment key={q.question_id}>
                      <div id={`q-list-${q.question_id}`} onClick={() => handleQuestionClick(q)} className={`p-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm relative overflow-hidden flex flex-col gap-2 mt-2 ${isSelected ? 'border-[#002864] bg-blue-50/50' : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-md'}`}>
                        {isSelected && <div className="absolute left-0 top-0 w-1.5 h-full bg-[#002864]"></div>}
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-white bg-slate-600 px-2 py-0.5 rounded shadow-sm">{q.final_printed_page || q.detected_page_num || '?'}p</span>
                            <span className="text-sm font-black text-slate-800">{formatQNum(q.question_number, q.sub_num)}</span>
                          </div>
                          {hasTaxonomy ? (
                            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">분류됨</span>
                          ) : (
                            <span className="text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded animate-pulse">수정필요</span>
                          )}
                        </div>
                        <div className="text-xs font-medium text-slate-700 line-clamp-2 leading-relaxed whitespace-pre-wrap">{q.question}</div>
                      </div>

                      {myTwins.length > 0 && (
                        <div className="pl-5 ml-3 my-1 border-l-2 border-indigo-200 flex flex-col gap-1.5 relative">
                          <div className="absolute top-0 left-0 w-3 border-t-2 border-indigo-200 mt-4"></div>
                          
                          {myTwins.map(twin => {
                            const isTwinSelected = selectedQuestion?.question_id === twin.question_id;
                            const isSimilar = twin.derivation_type === '유사';
                            const badgeLabel = twin.derivation_type === 'TWIN' || twin.derivation_type === '쌍둥이' ? '쌍둥이' : '유사';
                            
                            return (
                              <div id={`q-list-${twin.question_id}`} key={twin.question_id} onClick={() => handleQuestionClick(twin)} className={`p-2.5 rounded-lg border transition-all cursor-pointer shadow-sm relative overflow-hidden flex flex-col gap-1.5 ${isTwinSelected ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500' : 'border-slate-200 bg-white hover:border-indigo-300'}`}>
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm border ${isSimilar ? 'text-amber-700 bg-amber-100 border-amber-200' : 'text-fuchsia-700 bg-fuchsia-100 border-fuchsia-200'}`}>
                                      {isSimilar ? '💡 유사' : `👯 ${badgeLabel}`}
                                    </span>
                                    <span className="text-[11px] font-black text-slate-700">{formatQNum(twin.question_number, twin.sub_num)}</span>
                                  </div>
                                </div>
                                <div className="text-[11px] font-medium text-slate-600 line-clamp-1 truncate">{twin.question}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}

                {trueOrphans.length > 0 && (
                  <div className="pt-4 mt-4 border-t border-slate-200">
                    <div className="text-[10px] font-bold text-rose-500 mb-2 px-2 bg-rose-50 py-1 rounded-md border border-rose-100 inline-block">⚠️ 원본이 완전히 유실된 문항</div>
                    <div className="flex flex-col gap-2">
                      {trueOrphans.map(q => {
                        const isSelected = selectedQuestion?.question_id === q.question_id;
                        const isSimilar = q.derivation_type === '유사';
                        const myTwins = getDescendants(String(q.question_id).trim().toLowerCase());

                        return (
                          <React.Fragment key={q.question_id}>
                            <div id={`q-list-${q.question_id}`} onClick={() => handleQuestionClick(q)} className={`p-2.5 rounded-lg border transition-all cursor-pointer shadow-sm relative overflow-hidden flex flex-col gap-1.5 ${isSelected ? 'border-rose-500 bg-rose-50/50 ring-1 ring-rose-500' : 'border-slate-200 bg-white hover:border-rose-300'}`}>
                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm border ${isSimilar ? 'text-amber-700 bg-amber-100 border-amber-200' : 'text-fuchsia-700 bg-fuchsia-100 border-fuchsia-200'}`}>
                                    {q.derivation_type || '쌍둥이'}
                                  </span>
                                  <span className="text-[11px] font-black text-slate-700">{formatQNum(q.question_number, q.sub_num)}</span>
                                </div>
                              </div>
                              <div className="text-[11px] font-medium text-slate-600 line-clamp-1 truncate">{q.question}</div>
                            </div>
                            
                            {myTwins.length > 0 && (
                              <div className="pl-5 ml-3 my-1 border-l-2 border-indigo-200 flex flex-col gap-1.5 relative">
                                <div className="absolute top-0 left-0 w-3 border-t-2 border-indigo-200 mt-4"></div>
                                {myTwins.map(twin => {
                                  const isTwinSelected = selectedQuestion?.question_id === twin.question_id;
                                  return (
                                    <div id={`q-list-${twin.question_id}`} key={twin.question_id} onClick={() => handleQuestionClick(twin)} className={`p-2.5 rounded-lg border transition-all cursor-pointer shadow-sm relative overflow-hidden flex flex-col gap-1.5 ${isTwinSelected ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500' : 'border-slate-200 bg-white hover:border-indigo-300'}`}>
                                      <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm border text-fuchsia-700 bg-fuchsia-100 border-fuchsia-200">
                                            {twin.derivation_type || '쌍둥이'}
                                          </span>
                                          <span className="text-[11px] font-black text-slate-700">{formatQNum(twin.question_number, twin.sub_num)}</span>
                                        </div>
                                      </div>
                                      <div className="text-[11px] font-medium text-slate-600 line-clamp-1 truncate">{twin.question}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 우측: 뷰어 & 수정 에디터 */}
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          
          {!selectedQuestion ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 font-bold opacity-60">
              <span className="text-5xl mb-4">👈</span>
              <p>좌측에서 수정할 문제를 선택해주세요.</p>
            </div>
          ) : (
            <>
              {/* 상단 뷰어 및 문제 수정 영역 */}
              <div className={`p-6 overflow-y-auto custom-scroll border-b-4 border-slate-100 bg-white flex flex-col transition-all ${isEditingContent ? 'flex-1' : 'flex-[2]'}`}>
                <div className="flex items-start justify-between gap-3 mb-4 shrink-0">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="bg-[#002864] text-white px-3 py-1 rounded-lg text-sm font-black shadow-sm w-max">
                        {selectedQuestion.final_printed_page || selectedQuestion.detected_page_num || '?'}p - {formatQNum(selectedQuestion.question_number, selectedQuestion.sub_num)}
                      </span>
                      <span className="bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm">
                        난이도: {selectedQuestion.difficulty || '미지정'}
                      </span>
                      <span className="bg-sky-50 border border-sky-200 text-sky-700 px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm">
                        정답률: {selectedQuestion.solving_probability !== null && selectedQuestion.solving_probability !== undefined ? `${selectedQuestion.solving_probability}%` : '미입력'}
                      </span>
                    </div>
                    
                    <button 
                      onClick={handleAutoFillTaxonomy}
                      className="text-xs font-bold text-slate-500 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 px-3 py-1.5 rounded-lg flex flex-col leading-snug text-left transition-colors cursor-pointer group shadow-sm mt-1"
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
                      <button onClick={handleGenerateTwins} disabled={!perms.twin || !!selectedQuestion.parent_question_id} className={`px-4 py-2 font-black text-xs rounded-lg transition-colors shadow-md flex items-center gap-1.5 mr-2 ${perms.twin && !selectedQuestion.parent_question_id ? 'bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`} title={!!selectedQuestion.parent_question_id ? "쌍둥이 문항에서는 또 생성할 수 정 없습니다." : (!perms.twin ? "생성 권한이 없습니다." : "")}>
                        <span>👯</span> <span>쌍둥이/유사 생성</span>
                      </button>
                      
                      <button onClick={() => setIsEditingContent(true)} disabled={!perms.edit} className={`px-4 py-2 font-bold text-xs rounded-lg transition-colors border shadow-sm flex items-center gap-1.5 ${perms.edit ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300' : 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'}`} title={!perms.edit ? "수정 권한이 없습니다." : ""}>
                        <span>✏️</span> 문항 & 해설 & 이미지 수정
                      </button>
                      <button onClick={deleteQuestion} disabled={!perms.delete} className={`px-3 py-2 font-bold text-xs rounded-lg transition-colors border shadow-sm flex items-center gap-1.5 ${perms.delete ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 border-rose-200' : 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'}`} title={!perms.delete ? "삭제 권한이 없습니다." : ""}>
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
                  <div key={`view-wrapper-${selectedQuestion.question_id}`} className="flex flex-col">
                    <div className="text-base font-medium text-slate-800 leading-relaxed whitespace-pre-wrap p-4 bg-slate-50 rounded-xl border border-slate-200 shadow-inner mt-2">
                      {selectedQuestion.question}
                    </div>
                    
                    {(selectedQuestion.image_url || selectedQuestion.image_2_url) && (
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        {selectedQuestion.image_url && <img src={getCleanUrl(selectedQuestion.image_url)} alt="문제 이미지 1" className="max-w-full rounded-lg border border-slate-200 shadow-sm" />}
                        {selectedQuestion.image_2_url && <img src={getCleanUrl(selectedQuestion.image_2_url)} alt="문제 이미지 2" className="max-w-full rounded-lg border border-slate-200 shadow-sm" />}
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
                        {selectedQuestion.answer_image_url && <img src={getCleanUrl(selectedQuestion.answer_image_url)} alt="정답 이미지 1" className="max-w-full rounded-lg border border-emerald-200 shadow-sm" />}
                        {selectedQuestion.answer_image_2_url && <img src={getCleanUrl(selectedQuestion.answer_image_2_url)} alt="정답 이미지 2" className="max-w-full rounded-lg border border-emerald-200 shadow-sm" />}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 flex-1 pb-10 mt-2">
                    
                    <div className="flex gap-4 p-4 bg-slate-100 rounded-xl border border-slate-200 flex-wrap">
                      <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                        <label className="text-xs font-bold text-slate-500">페이지 번호</label>
                        <input type="text" value={editForm.page_number} onChange={e => setEditForm({...editForm, page_number: e.target.value})} className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none shadow-sm bg-white" />
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                        <label className="text-xs font-bold text-slate-500">문항 번호</label>
                        <input type="text" value={editForm.question_number} onChange={e => setEditForm({...editForm, question_number: e.target.value})} className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none shadow-sm bg-white" />
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                        <label className="text-xs font-bold text-slate-500">서브 번호(꼬리)</label>
                        <input type="number" value={editForm.sub_num} onChange={e => setEditForm({...editForm, sub_num: e.target.value})} className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none shadow-sm bg-white" />
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                        <label className="text-xs font-bold text-slate-500">난이도</label>
                        <select value={editForm.difficulty || '미지정'} onChange={e => setEditForm({...editForm, difficulty: e.target.value})} className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none shadow-sm bg-white">
                          <option value="최상">최상</option>
                          <option value="상">상</option>
                          <option value="중">중</option>
                          <option value="하">하</option>
                          <option value="최하">최하</option>
                          <option value="미지정">미지정</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                        <label className="text-xs font-bold text-slate-500">예상 정답률(%)</label>
                        <input type="number" step="0.1" value={editForm.solving_probability} onChange={e => setEditForm({...editForm, solving_probability: e.target.value})} placeholder="빈칸 가능" className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none shadow-sm bg-white" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-slate-500">
                        문제 텍스트 (LaTeX 수식은 <code className="font-mono text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded border border-indigo-100">$</code> 기호 또는 <code className="font-mono text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded border border-indigo-100">$$</code> 기호로 양끝을 감싸서 사용)
                      </label>
                      <textarea value={editForm.question} onChange={e => setEditForm({ ...editForm, question: e.target.value })} className="w-full min-h-[300px] p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#002864] outline-none text-sm font-medium leading-relaxed resize-y bg-yellow-50/30" />
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