// src/app/(dashboard)/taxonomy-editor/useTaxonomy.ts
import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { taxSort, generateUUID, sortQuestionsList, fetchAllRows } from "./taxonomyUtils";

export function useTaxonomy() {
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

  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [cloneForm, setCloneForm] = useState({ targetBookName: '', pageNumber: '', questionNumber: '', subNumber: '' });

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
  }, [questions, selectedQuestion, isEditingContent, generatedTwins, isTwinModalOpen, isCloneModalOpen]);

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
      const { error: qErr } = await supabase.from('question_db').update({ source_book_name: newName.trim() }).eq('source_book_name', selectedBook);
      if (qErr) throw qErr;

      const { data: tb } = await supabase.from('textbook').select('book_id').eq('title', selectedBook).maybeSingle();
      if (tb) await supabase.from('textbook').update({ title: newName.trim() }).eq('book_id', tb.book_id);

      alert(`✅ '${newName.trim()}'(으)로 이름이 통째로 변경되었습니다!`);
      
      setSelectedBook(newName.trim());
      setQuestions(prev => prev.map(q => ({ ...q, source_book_name: newName.trim() })));
      await loadWorkbooks(); 
    } catch (err: any) { alert("이름 변경 실패: " + err.message); } finally { setIsLoading(false); }
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
        const qidsToSearch = fetchedQuestions.map(q => String(q.question_id).trim()).filter(id => !searchedParentIds.has(id.toLowerCase()));
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
      const newDbData = { 
        question_id: newQuestionId, source_book_name: selectedBook, question_number: 'NEW', 
        question: '새로운 문항입니다. 우측 상단의 수정 버튼을 눌러 내용을 입력해주세요.', 
        taxonomy_id: '미분류', difficulty: null 
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
    } catch (e: any) { alert("추가 실패: " + e.message); } finally { setIsLoading(false); }
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

  const executeClone = async () => {
    if (!selectedQuestion) return;
    if (!cloneForm.targetBookName.trim()) return alert("대상 교재 이름을 입력하세요.");

    setIsLoading(true);
    try {
      const newUuid = generateUUID();
      const parsedSubNum = cloneForm.subNumber ? parseInt(cloneForm.subNumber) : 0;
      
      const qDbInsert = {
        ...selectedQuestion, question_id: newUuid, source_book_name: cloneForm.targetBookName.trim(), book_name: cloneForm.targetBookName.trim(), 
        final_printed_page: cloneForm.pageNumber ? parseInt(cloneForm.pageNumber) : null, question_number: cloneForm.questionNumber || 'NEW',
        sub_num: parsedSubNum, parent_question_id: null, derivation_type: '복제',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };

      const { error: dbErr } = await supabase.from('question_db').insert(qDbInsert);
      if (dbErr) throw dbErr;

      const { data: tb } = await supabase.from('textbook').select('book_id').eq('title', cloneForm.targetBookName.trim()).maybeSingle();
      if (tb) {
        await supabase.from('textbook_question').insert({
          book_id: tb.book_id, question_id: newUuid, page_number: cloneForm.pageNumber ? parseInt(cloneForm.pageNumber) : 999,
          question_number: cloneForm.questionNumber || 'NEW', question: qDbInsert.question, answer: qDbInsert.answer,
          taxonomy_id: qDbInsert.taxonomy_id || '미분류', question_category: '일반'
        });
      }

      alert(`✅ [${cloneForm.targetBookName.trim()}] 교재로 문항이 복제되었습니다!`);
      setIsCloneModalOpen(false);
      
      if (cloneForm.targetBookName.trim() === selectedBook) fetchQuestions(); 
      else loadWorkbooks(); 
    } catch (e: any) { alert("복제 실패: " + e.message); } finally { setIsLoading(false); }
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
        body: JSON.stringify({ originalQuestion: selectedQuestion.question, originalAnswer: selectedQuestion.answer, taxonomyStr: taxStr })
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
        isSelected: true, isPreviewMode: false,
        question_type: twin.question_type || (idx === 0 ? '쌍둥이' : '유사')
      }));

      setGeneratedTwins(cleanedTwins);
    } catch (e: any) { alert("쌍둥이 생성 중 오류 발생: " + e.message); setIsTwinModalOpen(false); } finally { setIsGeneratingTwins(false); }
  };

  const saveTwinsToDB = async () => {
    const selectedTwinsToSave = generatedTwins.filter(t => t.isSelected !== false);
    if (selectedTwinsToSave.length === 0) return alert("저장할 문항을 하나 이상 체크박스에서 선택해주세요.");
    if (!confirm(`선택된 ${selectedTwinsToSave.length}개의 쌍둥이/유사 문항을 마스터 DB에 저장하시겠습니까?\n(원본 문항에 꼬리로 연결됩니다.)`)) return;

    setIsLoading(true);
    try {
      const twinInserts = selectedTwinsToSave.map((twin, idx) => ({
        question_id: generateUUID(), parent_question_id: selectedQuestion.question_id,
        source_book_name: selectedBook, detected_page_num: selectedQuestion.detected_page_num || 0,
        final_printed_page: selectedQuestion.final_printed_page, question_number: `${selectedQuestion.question_number}-T${idx + 1}`, 
        question: twin.question, answer: twin.answer, step_1_concept: twin.step_1_concept, step_2_approach: twin.step_2_approach, step_3_process: twin.step_3_process, step_4_conclusion: twin.step_4_conclusion,
        taxonomy_id: selectedQuestion.taxonomy_id, difficulty: selectedQuestion.difficulty || '중', is_human_verified: true,
        derivation_type: twin.question_type === '유사' ? '유사' : 'TWIN' 
      }));

      const { error } = await supabase.from('question_db').insert(twinInserts);
      if (error) throw error;

      alert(`✅ 선택된 ${selectedTwinsToSave.length}개의 문항이 성공적으로 저장되었습니다!`);
      setIsTwinModalOpen(false);
      fetchQuestions(); 
    } catch (e: any) { alert("쌍둥이 저장 실패: " + e.message); } finally { setIsLoading(false); }
  };

  const handleTwinChange = (index: number, field: string, value: any) => {
    const updated = [...generatedTwins];
    updated[index][field] = value;
    setGeneratedTwins(updated);
  };

  const allQMap = useMemo(() => new Map(questions.map(q => [String(q.question_id).trim().toLowerCase(), q])), [questions]);

  const normalRoots = useMemo(() => questions.filter(q => {
      const pid = q.parent_question_id;
      return !pid || String(pid).trim().toLowerCase() === 'null' || String(pid).trim() === '';
  }), [questions]);

  const trueOrphans = useMemo(() => questions.filter(q => {
      const pid = q.parent_question_id;
      return pid && String(pid).trim().toLowerCase() !== 'null' && String(pid).trim() !== '' && !allQMap.has(String(pid).trim().toLowerCase());
  }), [questions, allQMap]);

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
    children.forEach(c => { result = [...result, ...getDescendants(String(c.question_id).trim().toLowerCase(), visited)]; });
    return result;
  };

  return {
    isAuthorized, perms, isTaxonomyLoading, workbooks, selectedBook, questions, selectedQuestion, isLoading,
    isEditingContent, editForm, cropImageSrc, cropTargetField, hasCropArea, imgRef, selectionBoxRef,
    selD1, selD2, selD3, selD4, selD5, selD6, selD7, selD8,
    isGeneratingTwins, generatedTwins, isTwinModalOpen, isCloneModalOpen, cloneForm,
    d1Options, d2Options, d3Options, d4Options, d5Options, d6Options, d7Options, d8Options, finalCalculatedTaxId,
    normalRoots, trueOrphans, getDescendants,
    setSelectedBook, setEditForm, setIsEditingContent, setCropImageSrc, setCropTargetField, setHasCropArea,
    setSelD8, setIsTwinModalOpen, setGeneratedTwins, setIsCloneModalOpen, setCloneForm,
    handleRenameBook, fetchQuestions, getKoreanPath, handleAutoFillTaxonomy, handleD1Change, handleD2Change, handleD3Change, handleD4Change, handleD5Change, handleD6Change, handleD7Change,
    handleQuestionClick, saveTaxonomy, createNewQuestion, deleteQuestion, executeClone, handleImageInput, handlePaste, handleDrop, handleCropMouseDown, handleCropMouseMove, handleCropMouseUp, handleCropUpload,
    saveQuestionContent, handleGenerateTwins, saveTwinsToDB, handleTwinChange
  };
}