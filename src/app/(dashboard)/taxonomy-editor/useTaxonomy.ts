// src/app/(dashboard)/taxonomy-editor/useTaxonomy.ts
import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { taxSort, generateUUID, sortQuestionsList, fetchAllRows, getCleanUrl } from "./taxonomyUtils";
import { hydrateMissingQuestionImages } from "../../exam/step2/examUtils";

// 🌟 별도 파일 import 없이 기존 /api/gemini-twin (PUT) 엔드포인트를 호출하여 SERVICE_ROLE_KEY로 RLS를 우회하는 내장 헬퍼
async function uploadQuestionImageServerAction(
  imageBase64: string,
  fileName: string,
  contentType: string = "image/png"
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  try {
    const res = await fetch("/api/gemini-twin", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upload_image", imageBase64, fileName, contentType }),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e?.message || "서버 업로드 요청 실패" };
  }
}

async function saveTwinsServerAction(
  twinInserts: any[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch("/api/gemini-twin", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_twins", twinInserts }),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e?.message || "서버 저장 요청 실패" };
  }
}

async function syncTextbookRawMetadataImagesClient(
  questionId: string,
  updateData: Record<string, any>,
  textbookUpdateData?: Record<string, any>
) {
  try {
    const imgFields = [
      "image_url",
      "image_2_url",
      "answer_image_url",
      "answer_image_2_url",
      "image_box",
      "image_2_box",
      "answer_image_box",
    ];
    const hasImageUpdate =
      updateData && imgFields.some((k) => Object.prototype.hasOwnProperty.call(updateData, k));

    if (!hasImageUpdate) {
      if (textbookUpdateData && Object.keys(textbookUpdateData).length > 0) {
        await supabase.from("textbook_question").update(textbookUpdateData).eq("question_id", questionId);
      }
      return;
    }

    const { data: tqRows } = await supabase
      .from("textbook_question")
      .select("tq_id, raw_metadata")
      .eq("question_id", questionId);

    if (Array.isArray(tqRows) && tqRows.length > 0) {
      for (const row of tqRows) {
        let meta: Record<string, any> = {};
        if (row.raw_metadata) {
          if (typeof row.raw_metadata === "string") {
            try {
              meta = JSON.parse(row.raw_metadata) || {};
            } catch (e) {
              meta = {};
            }
          } else if (typeof row.raw_metadata === "object") {
            meta = { ...row.raw_metadata };
          }
        }
        for (const f of imgFields) {
          if (Object.prototype.hasOwnProperty.call(updateData, f)) {
            const val = updateData[f];
            meta[f] = val === "" ? null : val;
            if (f === "image_url") {
              meta.imageUrl = val === "" ? null : val;
              meta.image_deleted = !val || String(val).trim() === "";
            }
            if (f === "image_2_url") {
              meta.image2Url = val === "" ? null : val;
              meta.image_2_deleted = !val || String(val).trim() === "";
            }
            if (f === "answer_image_url") {
              meta.answerImageUrl = val === "" ? null : val;
              meta.answer_image_deleted = !val || String(val).trim() === "";
            }
            if (f === "answer_image_2_url") {
              meta.answerImage2Url = val === "" ? null : val;
              meta.answer_image_2_deleted = !val || String(val).trim() === "";
            }
          }
        }
        await supabase
          .from("textbook_question")
          .update({
            ...(textbookUpdateData || {}),
            raw_metadata: meta,
          })
          .eq("tq_id", row.tq_id);
      }
    } else if (textbookUpdateData && Object.keys(textbookUpdateData).length > 0) {
      await supabase.from("textbook_question").update(textbookUpdateData).eq("question_id", questionId);
    }
  } catch (e) {
    console.warn("textbook_question raw_metadata 동기화 경고:", e);
  }
}

async function updateQuestionServerAction(
  questionId: string,
  updateData: Record<string, any>,
  textbookUpdateData?: Record<string, any>
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch("/api/gemini-twin", {
      method: "PUT",
      headers,
      body: JSON.stringify({ action: "update_question", questionId, updateData, textbookUpdateData }),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e?.message || "서버 업데이트 요청 실패" };
  }
}


export const isExcludedDiagnosticBookName = (name?: any): boolean => {
  if (!name || typeof name !== "string") return false;
  return name.includes("입학테스트") || name.includes("진단평가");
};

export const isExcludedDiagnosticQuestionRow = (q: any): boolean => {
  if (!q) return false;
  return (
    isExcludedDiagnosticBookName(q.source_book_name) ||
    isExcludedDiagnosticBookName(q.book_name)
  );
};

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
  
  // 🌟 [핵심 변경] 폼 상태에 박스(배율) 속성들을 기본값으로 추가합니다.
  const [editForm, setEditForm] = useState({ 
    page_number: '', question_number: '', sub_num: '',
    difficulty: '미지정', solving_probability: '',
    question: '', question_2: '', answer: '', 
    image_url: '', image_2_url: '', 
    answer_image_url: '', answer_image_2_url: '',
    image_box: '', image_2_box: '', answer_image_box: '',
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
  const [twinAiModel, setTwinAiModel] = useState<"gemini-3.8-flash" | "gemini-4-argon">("gemini-3.8-flash");

  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [cloneForm, setCloneForm] = useState({ targetBookName: '', pageNumber: '', questionNumber: '', subNumber: '' });

  const [twinTargetBook, setTwinTargetBook] = useState<string>('');
  const [similarTargetBook, setSimilarTargetBook] = useState<string>('');

  const [isFixingLatex, setIsFixingLatex] = useState(false);

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
      const CACHE_KEY = "logica_taxonomy_workbooks_v2";
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setWorkbooks(parsed.filter((b: string) => b && !isExcludedDiagnosticBookName(b)));
          }
        }
      } catch (e) {}

      // 1단계: 가벼운 textbook 테이블 먼저 즉시 로드하여 드롭다운 대기시간 제거
      const tbData = await fetchAllRows('textbook', 'title');
      const titles = (tbData || [])
        .map((t: any) => t.title)
        .filter((t: any) => t && !isExcludedDiagnosticBookName(t));

      if (titles.length > 0) {
        setWorkbooks((prev) => {
          const merged = Array.from(new Set([...prev, ...titles])).filter((b) => b && !isExcludedDiagnosticBookName(b)).sort(taxSort);
          return merged as string[];
        });
      }

      // 2단계: question_db에서 입학테스트/진단평가 제외하고 병렬 배치로 빠르게 source_book_name, book_name 수집
      const qbNames = new Set<string>();
      const step = 1000;
      const batchPages = 5;
      let pageIdx = 0;
      let keepGoing = true;

      while (keepGoing) {
        const promises = [];
        for (let b = 0; b < batchPages; b++) {
          const start = (pageIdx + b) * step;
          promises.push(
            supabase
              .from("question_db")
              .select("source_book_name, book_name")
              .order("question_id", { ascending: true })
              .range(start, start + step - 1)
          );
        }
        const results = await Promise.all(promises);
        for (const res of results) {
          const rows = res.data || [];
          rows.forEach((q: any) => {
            if (isExcludedDiagnosticQuestionRow(q)) return;
            if (q.source_book_name && !isExcludedDiagnosticBookName(q.source_book_name)) {
              qbNames.add(String(q.source_book_name).trim());
            }
            if (q.book_name && !isExcludedDiagnosticBookName(q.book_name)) {
              qbNames.add(String(q.book_name).trim());
            }
          });
          if (rows.length < step) {
            keepGoing = false;
          }
        }
        pageIdx += batchPages;
      }

      const uniqueList = Array.from(new Set([...titles, ...Array.from(qbNames)]))
        .filter((b) => b && !isExcludedDiagnosticBookName(b))
        .sort(taxSort);
      setWorkbooks(uniqueList as string[]);
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(uniqueList));
      } catch (e) {}
    } catch (e) { console.error(e); }
  };

  const handleRenameBook = async () => {
    if (!selectedBook) return alert("이름을 변경할 교재(문제지 덩어리)를 먼저 선택해주세요.");
    
    const newName = prompt(`현재 이름: ${selectedBook}\n새로운 덩어리 이름을 입력하세요:`, selectedBook);
    const trimmedNew = newName ? newName.trim() : "";
    if (!trimmedNew || trimmedNew === selectedBook) return;

    setIsLoading(true);
    try {
      const oldName = selectedBook;

      // 1) question_db에서 source_book_name 과 book_name 양쪽 모두 새 이름으로 일괄 업데이트
      const [{ error: qErr1 }, { error: qErr2 }] = await Promise.all([
        supabase
          .from('question_db')
          .update({ source_book_name: trimmedNew, book_name: trimmedNew })
          .eq('source_book_name', oldName),
        supabase
          .from('question_db')
          .update({ source_book_name: trimmedNew, book_name: trimmedNew })
          .eq('book_name', oldName),
      ]);
      if (qErr1) throw qErr1;
      if (qErr2) throw qErr2;

      // 2) textbook 테이블 처리: 새 이름의 교재가 이미 존재하면 문항(textbook_question)을 합치고 기존 교재를 정리, 없으면 title 변경
      const [{ data: oldTb }, { data: targetTb }] = await Promise.all([
        supabase.from('textbook').select('book_id').eq('title', oldName).maybeSingle(),
        supabase.from('textbook').select('book_id').eq('title', trimmedNew).maybeSingle(),
      ]);

      if (oldTb) {
        if (targetTb && targetTb.book_id !== oldTb.book_id) {
          await supabase
            .from('textbook_question')
            .update({ book_id: targetTb.book_id })
            .eq('book_id', oldTb.book_id);
          await supabase.from('textbook').delete().eq('book_id', oldTb.book_id);
        } else {
          await supabase.from('textbook').update({ title: trimmedNew }).eq('book_id', oldTb.book_id);
        }
      }

      // 3) 세션 캐시 및 최근 선택 교재 목록에서 예전 이름을 제거하고 새 이름으로 즉시 갱신
      try {
        sessionStorage.removeItem("logica_taxonomy_workbooks_v2");
      } catch (e) {}

      setWorkbooks((prev) => {
        const next = prev.map((b) => (b === oldName ? trimmedNew : b));
        return Array.from(new Set(next)).filter((b) => b && !isExcludedDiagnosticBookName(b)).sort(taxSort);
      });

      try {
        const savedRecent = JSON.parse(localStorage.getItem("logica_taxonomy_recent_books") || "[]");
        if (Array.isArray(savedRecent)) {
          const nextRecent = Array.from(new Set(savedRecent.map((b: string) => (b === oldName ? trimmedNew : b))));
          localStorage.setItem("logica_taxonomy_recent_books", JSON.stringify(nextRecent));
        }
      } catch (e) {}

      setSelectedBook(trimmedNew);
      setQuestions((prev) =>
        prev.map((q) => ({
          ...q,
          source_book_name: q.source_book_name === oldName || !q.source_book_name ? trimmedNew : q.source_book_name,
          book_name: q.book_name === oldName || !q.book_name ? trimmedNew : q.book_name,
        }))
      );

      alert(`✅ '${trimmedNew}'(으)로 교재 이름(source_book_name 및 book_name)이 통째로 변경되었습니다!`);
      await loadWorkbooks();
      await fetchQuestions(trimmedNew);
    } catch (err: any) {
      alert("이름 변경 실패: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchQuestions = async (bookOverride?: any) => {
    const targetBook = typeof bookOverride === "string" ? bookOverride : selectedBook;
    if (!targetBook) return;
    if (isExcludedDiagnosticBookName(targetBook)) {
      setQuestions([]);
      setSelectedQuestion(null);
      return;
    }
    if (typeof bookOverride === "string" && bookOverride !== selectedBook) {
      setSelectedBook(bookOverride);
    }
    setIsLoading(true);
    try {
      const qidSet = new Set<string>();

      let from1 = 0;
      while(true) {
         const {data} = await supabase
           .from("question_db")
           .select("question_id, source_book_name, book_name")
           .or(`source_book_name.eq."${targetBook}",book_name.eq."${targetBook}"`)
           .range(from1, from1+999);
         if (data) {
           data.forEach((d: any) => {
             if (!isExcludedDiagnosticQuestionRow(d)) {
               qidSet.add(String(d.question_id).trim());
             }
           });
         }
         if (!data || data.length < 1000) break;
         from1 += 1000;
      }

      const { data: tb } = await supabase.from('textbook').select('book_id').eq('title', targetBook).maybeSingle();
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
      fetchedQuestions.forEach((q: any) => {
        if (!isExcludedDiagnosticQuestionRow(q)) {
          finalMap.set(q.question_id, q);
        }
      });
      const finalQuestions = Array.from(finalMap.values());
      await hydrateMissingQuestionImages(supabase, finalQuestions);

      setQuestions(sortQuestionsList(finalQuestions));
      setSelectedQuestion(null); 
      setIsEditingContent(false);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const getKoreanPath = (taxId: string, fallbackName?: string) => {
    if (!taxId || taxId === '미분류') return '분류 정보 없음';
    const matchedItem = items.find(i => i.item_id === taxId);
    if (matchedItem) {
      const cat = categories.find(c => c.category_id === matchedItem.category_id);
      const leafName = matchedItem.depth8 || matchedItem.depth7 || matchedItem.depth6 || '기본 유형';
      if (cat) return [cat.depth1, cat.depth2, cat.depth3, cat.depth4, cat.depth5, cat.depth6, cat.depth7, leafName].filter(Boolean).join(' > ');
      return leafName;
    }
    const cat = categories.find(c => c.category_id === taxId);
    if (cat) return [cat.depth1, cat.depth2, cat.depth3, cat.depth4, cat.depth5, cat.depth6, cat.depth7].filter(Boolean).join(' > ');
    if (fallbackName) return fallbackName;
    return '알 수 없는 분류 (DB에 없음)';
  };

  const handleAutoFillTaxonomy = (overrideTaxId?: string) => {
    const taxId = typeof overrideTaxId === 'string' && overrideTaxId ? overrideTaxId : selectedQuestion?.taxonomy_id;
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
    return items.filter(item => item.category_id === currentMatchedCat.category_id).sort((a,b) => 
      taxSort(a.depth8 || a.depth7 || a.depth6 || '', b.depth8 || b.depth7 || b.depth6 || '')
    );
  }, [items, currentMatchedCat]);

  const finalCalculatedTaxId = selD8 || currentMatchedCat?.category_id;

  const handleD1Change = (val: string) => { setSelD1(val); setSelD2(""); setSelD3(""); setSelD4(""); setSelD5(""); setSelD6(""); setSelD7(""); setSelD8(""); };
  const handleD2Change = (val: string) => { setSelD2(val); setSelD3(""); setSelD4(""); setSelD5(""); setSelD6(""); setSelD7(""); setSelD8(""); };
  const handleD3Change = (val: string) => { setSelD3(val); setSelD4(""); setSelD5(""); setSelD6(""); setSelD7(""); setSelD8(""); };
  const handleD4Change = (val: string) => { setSelD4(val); setSelD5(""); setSelD6(""); setSelD7(""); setSelD8(""); };
  const handleD5Change = (val: string) => { setSelD5(val); setSelD6(""); setSelD7(""); setSelD8(""); };
  const handleD6Change = (val: string) => { setSelD6(val); setSelD7(""); setSelD8(""); };
  const handleD7Change = (val: string) => { setSelD7(val); setSelD8(""); };

  // 🌟 [핵심 변경] 문항 클릭 시, DB에서 박스(비율) 설정들을 찾아 문자열 포맷(JSON)으로 폼에 올립니다.
  const handleQuestionClick = (q: any) => {
    setSelectedQuestion(q); setIsEditingContent(false); setTwinAiModel('gemini-3.8-flash'); 
    setEditForm({ 
      page_number: String(q.final_printed_page || q.detected_page_num || ''), question_number: String(q.question_number || ''),
      sub_num: String(q.sub_num || ''), difficulty: q.difficulty || '미지정',
      solving_probability: q.solving_probability !== null && q.solving_probability !== undefined ? String(q.solving_probability) : '',
      question: q.question || '', question_2: q.question_2 || '', answer: q.answer || '', 
      image_url: q.image_url || '', image_2_url: q.image_2_url || '',
      answer_image_url: q.answer_image_url || '', answer_image_2_url: q.answer_image_2_url || '',
      image_box: typeof q.image_box === 'object' && q.image_box !== null ? JSON.stringify(q.image_box) : (q.image_box || ''),
      image_2_box: typeof q.image_2_box === 'object' && q.image_2_box !== null ? JSON.stringify(q.image_2_box) : (q.image_2_box || ''),
      answer_image_box: typeof q.answer_image_box === 'object' && q.answer_image_box !== null ? JSON.stringify(q.answer_image_box) : (q.answer_image_box || ''),
      step_1_concept: q.step_1_concept || '', step_2_approach: q.step_2_approach || '',
      step_3_process: q.step_3_process || '', step_4_conclusion: q.step_4_conclusion || ''
    });
  };

  const saveTaxonomy = async () => {
    if (!selectedQuestion) return alert("수정할 문제를 먼저 선택해주세요.");
    if (!finalCalculatedTaxId) return alert("분류를 올바르게 선택해주세요.");
    setIsLoading(true);
    try {
      const srvTax = await updateQuestionServerAction(
        selectedQuestion.question_id,
        { taxonomy_id: finalCalculatedTaxId },
        { taxonomy_id: finalCalculatedTaxId }
      );
      if (!srvTax.success) {
        const { error: dbError } = await supabase.from('question_db').update({ taxonomy_id: finalCalculatedTaxId }).eq('question_id', selectedQuestion.question_id);
        if (dbError) throw dbError;
        await supabase.from('textbook_question').update({ taxonomy_id: finalCalculatedTaxId }).eq('question_id', selectedQuestion.question_id);
      }
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
      setEditForm({ 
        page_number: '999', question_number: 'NEW', sub_num: '0', difficulty: '미지정', solving_probability: '', question: newQ.question, question_2: '', answer: '', 
        image_url: '', image_2_url: '', answer_image_url: '', answer_image_2_url: '', 
        image_box: '', image_2_box: '', answer_image_box: '',
        step_1_concept: '', step_2_approach: '', step_3_process: '', step_4_conclusion: '' 
      });
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
    e.preventDefault(); 
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleImageInput(e.dataTransfer.files[0], fieldKey);
    }
  };

  const handleCropExisting = async (existingUrl: string, fieldKey: string) => {
    if (!existingUrl) return;
    setIsLoading(true);
    try {
      const cleanUrl = getCleanUrl(existingUrl);
      const response = await fetch(cleanUrl);
      const blob = await response.blob();
      const localUrl = URL.createObjectURL(blob);
      
      setCropImageSrc(localUrl);
      setCropTargetField(fieldKey);
      setHasCropArea(false);
      if (selectionBoxRef.current) selectionBoxRef.current.style.display = 'none';
    } catch (e: any) {
      alert("이미지를 불러오는데 실패했습니다: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCropMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    e.preventDefault(); 
    if (!imgRef.current) return;
    isCroppingRef.current = true;
    
    const rect = imgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    cropStartRef.current = { x, y };
    cropRectRef.current = { x, y, w: 0, h: 0 };
    setHasCropArea(false); 
    if (selectionBoxRef.current) selectionBoxRef.current.style.display = 'none';
  };

  const handleCropMouseMove = (e: MouseEvent | React.MouseEvent) => {
    if (!isCroppingRef.current || !cropStartRef.current || !imgRef.current) return;
    
    const rect = imgRef.current.getBoundingClientRect();
    let currentX = e.clientX - rect.left;
    let currentY = e.clientY - rect.top;
    
    currentX = Math.max(0, Math.min(currentX, rect.width));
    currentY = Math.max(0, Math.min(currentY, rect.height));

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
        const response = await fetch(cropImageSrc); blobToUpload = await response.blob();
      } else {
        const canvas = document.createElement('canvas');
        const img = imgRef.current;
        const rect = img.getBoundingClientRect();
        
        const renderRatio = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
        const renderWidth = img.naturalWidth * renderRatio;
        const renderHeight = img.naturalHeight * renderRatio;
        const offsetX = (rect.width - renderWidth) / 2;
        const offsetY = (rect.height - renderHeight) / 2;

        const safeCropX = Math.max(0, cropRectRef.current.x - offsetX);
        const safeCropY = Math.max(0, cropRectRef.current.y - offsetY);
        const safeCropEndX = Math.min(renderWidth, cropRectRef.current.x + cropRectRef.current.w - offsetX);
        const safeCropEndY = Math.min(renderHeight, cropRectRef.current.y + cropRectRef.current.h - offsetY);
        const safeCropW = safeCropEndX - safeCropX;
        const safeCropH = safeCropEndY - safeCropY;

        if (safeCropW <= 0 || safeCropH <= 0) throw new Error("이미지 영역을 정확히 드래그해주세요.");

        const sourceX = safeCropX / renderRatio;
        const sourceY = safeCropY / renderRatio;
        const sourceW = safeCropW / renderRatio;
        const sourceH = safeCropH / renderRatio;

        canvas.width = sourceW;
        canvas.height = sourceH;
        const ctx = canvas.getContext('2d'); 
        if (!ctx) throw new Error("Canvas 생성 실패");
        
        ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);
        blobToUpload = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      }
      
      if (!blobToUpload) throw new Error("이미지 변환 실패");
      
      const fileName = `crop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
      const base64DataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(blobToUpload!);
      });

      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kfwlmbwornivkrvoeqdh.supabase.co";
      let finalUploadUrl = `${baseUrl}/storage/v1/object/public/question_images/${fileName}`;

      const serverUpload = await uploadQuestionImageServerAction(base64DataUrl, fileName, "image/png");
      if (serverUpload.success && serverUpload.publicUrl) {
        finalUploadUrl = serverUpload.publicUrl;
      } else {
        const { error } = await supabase.storage.from('question_images').upload(fileName, blobToUpload, { contentType: 'image/png' });
        if (error) throw new Error(serverUpload.error || error.message);
      }
      
      setEditForm(prev => ({ ...prev, [cropTargetField as string]: finalUploadUrl })); 

      if (selectedQuestion) {
        const updRes = await updateQuestionServerAction(selectedQuestion.question_id, { [cropTargetField]: finalUploadUrl });
        if (!updRes.success) {
          await supabase.from('question_db').update({ [cropTargetField]: finalUploadUrl }).eq('question_id', selectedQuestion.question_id);
          await syncTextbookRawMetadataImagesClient(selectedQuestion.question_id, { [cropTargetField]: finalUploadUrl });
        }
        
        const updatedQuestion = { ...selectedQuestion, [cropTargetField]: finalUploadUrl };
        setSelectedQuestion(updatedQuestion);
        setQuestions(prev => prev.map(q => q.question_id === selectedQuestion.question_id ? updatedQuestion : q));
      }
      
      setCropImageSrc(null); setCropTargetField(null); 
      alert("✅ 이미지가 성공적으로 잘라내어 저장(업서트)되었습니다!");
    } catch (err: any) { alert("이미지 업로드 실패: " + err.message); } finally { setIsLoading(false); }
  };

  // 🌟 이미지 삭제 버튼 클릭 시: 폼 상태에서 제거함과 동시에 DB(question_db 및 textbook_question.raw_metadata)에서도 해당 문항의 이미지 정보를 즉시 비웁니다.
  const handleDeleteImage = async (fieldKey: string, boxFieldKey?: string) => {
    const resolvedBoxKey =
      boxFieldKey ||
      (fieldKey === "image_url"
        ? "image_box"
        : fieldKey === "image_2_url"
        ? "image_2_box"
        : fieldKey === "answer_image_url"
        ? "answer_image_box"
        : undefined);

    setEditForm((prev) => ({
      ...prev,
      [fieldKey]: "",
      ...(resolvedBoxKey ? { [resolvedBoxKey]: "" } : {}),
    }));

    if (!selectedQuestion) return;

    const dbPatch: Record<string, any> = {
      [fieldKey]: null,
      ...(resolvedBoxKey ? { [resolvedBoxKey]: null } : {}),
    };

    try {
      const srvRes = await updateQuestionServerAction(selectedQuestion.question_id, dbPatch);
      if (!srvRes.success) {
        const { error: dbErr } = await supabase
          .from("question_db")
          .update(dbPatch)
          .eq("question_id", selectedQuestion.question_id);
        if (dbErr) throw dbErr;
        await syncTextbookRawMetadataImagesClient(selectedQuestion.question_id, dbPatch);
      }

      const nextRawMeta =
        selectedQuestion.raw_metadata && typeof selectedQuestion.raw_metadata === "object"
          ? {
              ...selectedQuestion.raw_metadata,
              [fieldKey]: null,
              ...(fieldKey === "image_url" ? { imageUrl: null, image_deleted: true } : {}),
              ...(fieldKey === "image_2_url" ? { image2Url: null, image_2_deleted: true } : {}),
              ...(fieldKey === "answer_image_url" ? { answerImageUrl: null, answer_image_deleted: true } : {}),
              ...(fieldKey === "answer_image_2_url" ? { answerImage2Url: null, answer_image_2_deleted: true } : {}),
              ...(resolvedBoxKey ? { [resolvedBoxKey]: null } : {}),
            }
          : selectedQuestion.raw_metadata;

      const updatedQuestion = {
        ...selectedQuestion,
        ...dbPatch,
        ...(nextRawMeta !== undefined ? { raw_metadata: nextRawMeta } : {}),
      };
      setSelectedQuestion(updatedQuestion);
      setQuestions((prev) =>
        prev.map((q) => (q.question_id === selectedQuestion.question_id ? updatedQuestion : q))
      );
    } catch (err: any) {
      alert("이미지 정보 삭제 실패: " + err.message);
    }
  };

  // 🌟 [핵심 변경] 저장 버튼 클릭 시, 폼에 들고 있는 문자열 박스(비율)들을 객체로 파싱해서 DB에 정확하게 저장!
  const saveQuestionContent = async () => {
    if (!selectedQuestion) return;
    setIsLoading(true);
    try {
      const parsedPage = parseInt(editForm.page_number) || null;
      const parsedSubNum = parseInt(editForm.sub_num) || 0;
      const parsedProbability = editForm.solving_probability.trim() === '' ? null : parseFloat(editForm.solving_probability);

      const normalizeBoxForDb = (raw: any) => {
        if (!raw || raw === 'null' || raw === 'undefined') return null;
        let parsed = raw;
        for (let i = 0; i < 4; i++) {
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch(e) { break; }
          } else { break; }
        }
        if (Array.isArray(parsed)) return { bbox: parsed };
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return parsed;
        return null;
      };

      const cleanImageUrl = editForm.image_url?.trim() || null;
      const cleanImage2Url = editForm.image_2_url?.trim() || null;
      const cleanAnswerImageUrl = editForm.answer_image_url?.trim() || null;
      const cleanAnswerImage2Url = editForm.answer_image_2_url?.trim() || null;

      const parsedImgBox = cleanImageUrl ? normalizeBoxForDb(editForm.image_box) : null;
      const parsedImg2Box = cleanImage2Url ? normalizeBoxForDb(editForm.image_2_box) : null;
      const parsedAnsImgBox = cleanAnswerImageUrl ? normalizeBoxForDb(editForm.answer_image_box) : null;

      const updateData = {
        final_printed_page: parsedPage, question_number: editForm.question_number, sub_num: parsedSubNum,
        difficulty: editForm.difficulty === '미지정' ? null : editForm.difficulty, solving_probability: parsedProbability,
        question: editForm.question, question_2: editForm.question_2 || null, answer: editForm.answer,
        
        image_url: cleanImageUrl, 
        image_2_url: cleanImage2Url, 
        answer_image_url: cleanAnswerImageUrl, 
        answer_image_2_url: cleanAnswerImage2Url,
        
        // 🌟 박스(배율) JSON 데이터 저장 (이미지가 삭제된 경우 박스 데이터도 함께 null로 정리)
        image_box: parsedImgBox, 
        image_2_box: parsedImg2Box ? JSON.stringify(parsedImg2Box) : null, 
        answer_image_box: parsedAnsImgBox,

        step_1_concept: editForm.step_1_concept, step_2_approach: editForm.step_2_approach, step_3_process: editForm.step_3_process, step_4_conclusion: editForm.step_4_conclusion
      };

      const tqUpdate = { page_number: parsedPage || 0, question_number: updateData.question_number, question: updateData.question, answer: updateData.answer };
      const srvUpdate = await updateQuestionServerAction(selectedQuestion.question_id, updateData, tqUpdate);
      if (!srvUpdate.success) {
        const { error: dbError } = await supabase.from('question_db').update(updateData).eq('question_id', selectedQuestion.question_id);
        if (dbError) throw dbError;
        await syncTextbookRawMetadataImagesClient(selectedQuestion.question_id, updateData, tqUpdate);
      }

      const nextRawMeta =
        selectedQuestion.raw_metadata && typeof selectedQuestion.raw_metadata === "object"
          ? {
              ...selectedQuestion.raw_metadata,
              image_url: cleanImageUrl,
              imageUrl: cleanImageUrl,
              image_deleted: !cleanImageUrl,
              image_2_url: cleanImage2Url,
              image2Url: cleanImage2Url,
              image_2_deleted: !cleanImage2Url,
              answer_image_url: cleanAnswerImageUrl,
              answerImageUrl: cleanAnswerImageUrl,
              answer_image_deleted: !cleanAnswerImageUrl,
              answer_image_2_url: cleanAnswerImage2Url,
              answerImage2Url: cleanAnswerImage2Url,
              answer_image_2_deleted: !cleanAnswerImage2Url,
              image_box: parsedImgBox,
              image_2_box: parsedImg2Box ? JSON.stringify(parsedImg2Box) : null,
              answer_image_box: parsedAnsImgBox,
            }
          : selectedQuestion.raw_metadata;

      const updatedQuestion = {
        ...selectedQuestion,
        ...updateData,
        ...(nextRawMeta !== undefined ? { raw_metadata: nextRawMeta } : {}),
      };
      setQuestions(prev => sortQuestionsList(prev.map(q => q.question_id === selectedQuestion.question_id ? updatedQuestion : q)));
      setSelectedQuestion(updatedQuestion); setIsEditingContent(false);
      
      alert("✅ 모든 정보(이미지 2개 배율 포함)가 성공적으로 저장되었습니다!");
    } catch (err: any) { alert("수정 실패: " + err.message); } finally { setIsLoading(false); }
  };

  // 🌟 SVG 벡터 코드를 고해상도(300 DPI급) PNG Blob으로 변환하여 Supabase Storage(question_images)에 자동 업로드하는 헬퍼
  const uploadSvgAsPngToStorage = async (svgRaw: string, prefix: string): Promise<string | null> => {
    if (!svgRaw || typeof svgRaw !== "string" || !svgRaw.includes("<svg")) return null;
    try {
      let cleanSvg = svgRaw.trim();
      const svgMatch = cleanSvg.match(/<svg[\s\S]*<\/svg>/i);
      if (svgMatch) cleanSvg = svgMatch[0];
      if (!cleanSvg.includes("xmlns=")) {
        cleanSvg = cleanSvg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      }

      let baseW = 800;
      let baseH = 380;
      const vbMatch = cleanSvg.match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)\s*["']/i);
      if (vbMatch) {
        const w = parseFloat(vbMatch[3]);
        const h = parseFloat(vbMatch[4]);
        if (w > 0 && h > 0) {
          baseW = w;
          baseH = h;
        }
      }

      const scale = 3; // 3배수 고해상도 렌더링 (인쇄 품질)
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(baseW * scale);
      canvas.height = Math.round(baseH * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      const svgBlob = new Blob([cleanSvg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      const rendered = await new Promise<{ blob: Blob | null; dataUrl: string }>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          const dUrl = canvas.toDataURL("image/png", 1.0);
          canvas.toBlob((b) => resolve({ blob: b, dataUrl: dUrl }), "image/png", 1.0);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({ blob: null, dataUrl: "" });
        };
        img.src = url;
      });

      if (!rendered.dataUrl && !rendered.blob) return null;

      const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kfwlmbwornivkrvoeqdh.supabase.co";

      // 1차: 서버 액션(SERVICE_ROLE_KEY)을 통해 RLS 정책과 무관하게 안전 업로드
      if (rendered.dataUrl) {
        const serverRes = await uploadQuestionImageServerAction(rendered.dataUrl, fileName, "image/png");
        if (serverRes.success && serverRes.publicUrl) {
          return serverRes.publicUrl;
        }
      }

      // 2차 폴백: 클라이언트 직접 업로드 시 upsert:true를 제거하여 RLS UPDATE 정책 위반 방지
      if (rendered.blob) {
        const { error } = await supabase.storage
          .from("question_images")
          .upload(fileName, rendered.blob, { contentType: "image/png" });
        if (!error) {
          return `${baseUrl}/storage/v1/object/public/question_images/${fileName}`;
        }
        console.warn("SVG->PNG 스토리지 업로드 경고:", error.message);
      }
      return null;
    } catch (e) {
      console.error("SVG 렌더링/업로드 오류:", e);
      return null;
    }
  };

  const handleGenerateTwins = async (modelOverride?: any) => {
    if (!selectedQuestion) return alert("원본 문항을 먼저 왼쪽 리스트에서 선택해주세요.");
    
    // 🌟 항상 기본적으로 gemini-3.8-flash로 동작하며, 모달 안에서 명시적으로 Argon을 눌렀을 때만 1회성으로 Argon 사용
    const targetModel: "gemini-3.8-flash" | "gemini-4-argon" =
      isTwinModalOpen && modelOverride === "gemini-4-argon"
        ? "gemini-4-argon"
        : "gemini-3.8-flash";

    setTwinAiModel(targetModel);

    const taxStr = getKoreanPath(selectedQuestion.taxonomy_id);
    if (!isTwinModalOpen && (!taxStr || taxStr === '분류 정보 없음' || taxStr === '미분류')) {
      if (!confirm("현재 문항의 분류(Taxonomy)가 지정되지 않았습니다.\nAI가 문항의 핵심 개념을 파악하기 어려울 수 있습니다. 그래도 계속하시겠습니까?")) return;
    }

    setIsGeneratingTwins(true);
    setGeneratedTwins([]);
    
    if (!isTwinModalOpen) {
      setTwinTargetBook(`${selectedBook} 쌍둥이`);
      setSimilarTargetBook(`${selectedBook} 유사`);
      setIsTwinModalOpen(true);
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch('/api/gemini-twin', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ 
          originalQuestion: selectedQuestion.question,
          originalQuestion2: selectedQuestion.question_2 || '',
          originalAnswer: selectedQuestion.answer, 
          taxonomyStr: taxStr,
          step1Concept: selectedQuestion.step_1_concept || '',
          step2Approach: selectedQuestion.step_2_approach || '',
          step3Process: selectedQuestion.step_3_process || '',
          step4Conclusion: selectedQuestion.step_4_conclusion || '',
          imageUrl: selectedQuestion.image_url ? getCleanUrl(selectedQuestion.image_url) : '',
          image2Url: selectedQuestion.image_2_url ? getCleanUrl(selectedQuestion.image_2_url) : '',
          answerImageUrl: selectedQuestion.answer_image_url ? getCleanUrl(selectedQuestion.answer_image_url) : '',
          modelName: targetModel
        })
      });

      const contentType = res.headers.get("content-type");
      if (!res.ok || !contentType?.includes("application/json")) throw new Error(`AI 서버 연결 오류 (${res.status})`);

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const cleanedTwins = data.data.map((twin: any, idx: number) => ({
        ...twin,
        question: twin.question?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
        question_2: twin.question_2?.replace(/\\\\(?=[a-zA-Z])/g, '\\') || '',
        answer: twin.answer?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
        step_1_concept: twin.step_1_concept?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
        step_2_approach: twin.step_2_approach?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
        step_3_process: twin.step_3_process?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
        step_4_conclusion: twin.step_4_conclusion?.replace(/\\\\(?=[a-zA-Z])/g, '\\'),
        svg_code: twin.svg_code || '',
        answer_svg_code: twin.answer_svg_code || '',
        isSelected: true,
        isPreviewMode: true,
        question_type: twin.question_type || (idx === 0 ? '쌍둥이' : '유사')
      }));

      setGeneratedTwins(cleanedTwins);
    } catch (e: any) { alert("쌍둥이 생성 중 오류 발생: " + e.message); setIsTwinModalOpen(false); } finally { setIsGeneratingTwins(false); }
  };

  const handleFixLatex = async () => {
    if (!selectedQuestion) return alert("원본 문항을 먼저 선택해주세요.");
    if (!confirm("AI를 사용하여 깨진 수식을 완벽한 LaTeX 형태로 자동 교정하시겠습니까?\n\n수정된 내용은 즉시 저장됩니다.")) return;

    setIsFixingLatex(true);
    try {
      const payload = {
        question: selectedQuestion.question || "",
        answer: selectedQuestion.answer || "",
        step_1_concept: selectedQuestion.step_1_concept || "",
        step_2_approach: selectedQuestion.step_2_approach || "",
        step_3_process: selectedQuestion.step_3_process || "",
        step_4_conclusion: selectedQuestion.step_4_conclusion || ""
      };

      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch('/api/gemini-fix-latex', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`서버 연결 오류 (${res.status})`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const updatedQuestion = { ...selectedQuestion, ...data.data };
      
      setEditForm(prev => ({
        ...prev,
        question: data.data.question || prev.question,
        answer: data.data.answer || prev.answer,
        step_1_concept: data.data.step_1_concept || prev.step_1_concept,
        step_2_approach: data.data.step_2_approach || prev.step_2_approach,
        step_3_process: data.data.step_3_process || prev.step_3_process,
        step_4_conclusion: data.data.step_4_conclusion || prev.step_4_conclusion,
      }));
      
      setSelectedQuestion(updatedQuestion);
      setQuestions(prev => prev.map(q => q.question_id === updatedQuestion.question_id ? updatedQuestion : q));

      const latexUpdatePayload = {
        question: data.data.question,
        answer: data.data.answer,
        step_1_concept: data.data.step_1_concept,
        step_2_approach: data.data.step_2_approach,
        step_3_process: data.data.step_3_process,
        step_4_conclusion: data.data.step_4_conclusion,
      };
      const srvLatex = await updateQuestionServerAction(
        selectedQuestion.question_id,
        latexUpdatePayload,
        { question: data.data.question, answer: data.data.answer }
      );
      if (!srvLatex.success) {
        const { error: dbError } = await supabase.from('question_db').update(latexUpdatePayload).eq('question_id', selectedQuestion.question_id);
        if (dbError) throw dbError;
        await supabase.from('textbook_question').update({
          question: data.data.question,
          answer: data.data.answer,
        }).eq('question_id', selectedQuestion.question_id);
      }

      alert("✅ AI 수식 교정이 완벽하게 적용되어 저장되었습니다!");

    } catch (e: any) {
      alert("수식 교정 중 오류 발생: " + e.message);
    } finally {
      setIsFixingLatex(false);
    }
  };

  const saveTwinsToDB = async () => {
    const selectedTwinsToSave = generatedTwins.filter(t => t.isSelected !== false);
    if (selectedTwinsToSave.length === 0) return alert("저장할 문항을 하나 이상 체크박스에서 선택해주세요.");
    
    const twinCount = selectedTwinsToSave.filter(t => t.question_type !== '유사').length;
    const similarCount = selectedTwinsToSave.filter(t => t.question_type === '유사').length;

    let confirmMsg = `선택된 ${selectedTwinsToSave.length}개의 문항을 저장하시겠습니까?`;
    if (twinCount > 0 && similarCount > 0) {
      confirmMsg = `쌍둥이 ${twinCount}개 ➔ [${twinTargetBook}]\n유사 ${similarCount}개 ➔ [${similarTargetBook}]\n위 설정대로 마스터 DB에 저장하시겠습니까?`;
    } else if (twinCount > 0) {
      confirmMsg = `쌍둥이 ${twinCount}개 ➔ [${twinTargetBook}] 교재로 저장하시겠습니까?`;
    } else if (similarCount > 0) {
      confirmMsg = `유사 ${similarCount}개 ➔ [${similarTargetBook}] 교재로 저장하시겠습니까?`;
    }

    if (!confirm(confirmMsg)) return;

    setIsLoading(true);
    try {
      // 🌟 선택한 문항이 이미 부모를 가진 자식(쌍둥이/유사) 문항이라면, 그 부모(최상위 루트)의 ID를 물려받아 '형제 문항(부모의 쌍둥이)'으로 들어가도록 설정!
      let targetParentId = selectedQuestion.question_id;
      const rawPid = selectedQuestion.parent_question_id;
      if (rawPid && String(rawPid).trim() !== '' && String(rawPid).trim().toLowerCase() !== 'null') {
        let currPid = String(rawPid).trim();
        const visited = new Set<string>();
        while (currPid && !visited.has(currPid.toLowerCase())) {
          visited.add(currPid.toLowerCase());
          const pObj = allQMap.get(currPid.toLowerCase());
          if (
            pObj &&
            pObj.parent_question_id &&
            String(pObj.parent_question_id).trim() !== '' &&
            String(pObj.parent_question_id).trim().toLowerCase() !== 'null'
          ) {
            currPid = String(pObj.parent_question_id).trim();
          } else {
            break;
          }
        }
        targetParentId = currPid;
      }

      // 🌟 기존 형제 문항들의 번호(-T1, -S1 등)를 확인하여 중복 없는 다음 순번(T1, T2... / S1, S2...) 자동 부여
      const baseQNum = String(selectedQuestion.question_number || 'NEW').replace(/-[TS]\d+$/i, '');
      const existingSiblings = getDescendants(String(targetParentId).trim().toLowerCase());
      let maxT = 0;
      let maxS = 0;
      existingSiblings.forEach((sib: any) => {
        const qn = String(sib.question_number || '');
        const mT = qn.match(/-T(\d+)$/i);
        if (mT) maxT = Math.max(maxT, parseInt(mT[1], 10) || 0);
        const mS = qn.match(/-S(\d+)$/i);
        if (mS) maxS = Math.max(maxS, parseInt(mS[1], 10) || 0);
      });

      let tCount = maxT + 1;
      let sCount = maxS + 1;

      const twinInserts: any[] = [];
      for (const twin of selectedTwinsToSave) {
        const targetBook = twin.question_type === '유사' ? similarTargetBook : twinTargetBook;
        const suffix = twin.question_type === '유사' ? `S${sCount++}` : `T${tCount++}`;
        const newQId = generateUUID();

        // 🌟 새로 생성된 SVG 도형/그래프 코드가 있으면 300DPI PNG로 렌더링 후 Supabase Storage에 자동 업로드!
        let finalImg1Url = selectedQuestion.image_url || null;
        let finalImg2Url = selectedQuestion.image_2_url || null;
        let finalAnsImgUrl = selectedQuestion.answer_image_url || null;

        if (twin.svg_code && String(twin.svg_code).includes("<svg")) {
          const uploadedProblemImg = await uploadSvgAsPngToStorage(twin.svg_code, `twin_${newQId}_core`);
          if (uploadedProblemImg) {
            if (!selectedQuestion.image_url && selectedQuestion.image_2_url) {
              finalImg2Url = uploadedProblemImg;
            } else {
              finalImg1Url = uploadedProblemImg;
            }
          }
        }

        if (twin.answer_svg_code && String(twin.answer_svg_code).includes("<svg")) {
          const uploadedAnsImg = await uploadSvgAsPngToStorage(twin.answer_svg_code, `twin_${newQId}_sol`);
          if (uploadedAnsImg) {
            finalAnsImgUrl = uploadedAnsImg;
          }
        }

        twinInserts.push({
          question_id: newQId, 
          parent_question_id: targetParentId,
          source_book_name: targetBook, 
          book_name: targetBook,        
          detected_page_num: selectedQuestion.detected_page_num || 0,
          final_printed_page: selectedQuestion.final_printed_page, 
          question_number: `${baseQNum}-${suffix}`, 
          question: twin.question, 
          question_2: twin.question_2 !== undefined && twin.question_2 !== '' ? twin.question_2 : (selectedQuestion.question_2 || null),
          answer: twin.answer, 
          step_1_concept: twin.step_1_concept, 
          step_2_approach: twin.step_2_approach, 
          step_3_process: twin.step_3_process, 
          step_4_conclusion: twin.step_4_conclusion,
          taxonomy_id: selectedQuestion.taxonomy_id,
          taxonomy_name: selectedQuestion.taxonomy_name || null,
          sub_taxonomy_id: selectedQuestion.sub_taxonomy_id || null,
          sub_taxonomy_name: selectedQuestion.sub_taxonomy_name || null,
          thk_taxonomy_id: selectedQuestion.thk_taxonomy_id || null,
          thk_taxonomy_name: selectedQuestion.thk_taxonomy_name || null,
          difficulty: selectedQuestion.difficulty || '중', 
          is_human_verified: true,
          derivation_type: twin.question_type === '유사' ? '유사' : 'TWIN',
          
          // 🌟 새로 렌더링된 이미지 URL(또는 기존 이미지 URL) 및 배율 박스 속성 저장
          image_url: finalImg1Url,
          image_2_url: finalImg2Url,
          answer_image_url: finalAnsImgUrl,
          answer_image_2_url: selectedQuestion.answer_image_2_url || null,
          image_box: selectedQuestion.image_box,
          image_2_box: selectedQuestion.image_2_box,
          answer_image_box: selectedQuestion.answer_image_box,

          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }

      // 1차: 서버 액션(SERVICE_ROLE_KEY)으로 RLS에 막히지 않고 question_db 및 textbook_question 일괄 저장
      const srvSave = await saveTwinsServerAction(twinInserts);
      const uniqueBooks = Array.from(new Set(twinInserts.map(q => q.source_book_name)));

      if (!srvSave.success) {
        // 2차 폴백: 클라이언트 직접 저장
        const { error } = await supabase.from('question_db').insert(twinInserts);
        if (error) throw new Error(srvSave.error || error.message);

        for (const book of uniqueBooks) {
          const { data: tb } = await supabase.from('textbook').select('book_id').eq('title', book).maybeSingle();
          if (tb) {
            const tqInserts = twinInserts.filter(q => q.source_book_name === book).map(q => ({
              book_id: tb.book_id,
              question_id: q.question_id,
              page_number: q.final_printed_page || 999,
              question_number: q.question_number,
              question: q.question,
              answer: q.answer,
              taxonomy_id: q.taxonomy_id,
              taxonomy_name: q.taxonomy_name || null,
              sub_taxonomy_id: q.sub_taxonomy_id || null,
              sub_taxonomy_name: q.sub_taxonomy_name || null,
              thk_taxonomy_id: q.thk_taxonomy_id || null,
              thk_taxonomy_name: q.thk_taxonomy_name || null,
              question_category: '일반'
            }));
            await supabase.from('textbook_question').insert(tqInserts);
          }
        }
      }

      // 🌟 저장 즉시 좌측 트리(부모의 자식/형제 목록)에 새로 생성된 문항들이 바로 반영되도록 상태 업데이트
      setQuestions(prev => sortQuestionsList([...prev, ...twinInserts]));

      alert(`✅ 선택된 ${selectedTwinsToSave.length}개의 문항이 성공적으로 저장되었습니다!`);
      setIsTwinModalOpen(false);
      setTwinAiModel('gemini-3.8-flash');
      
      loadWorkbooks(); 

    } catch (e: any) { alert("쌍둥이 저장 실패: " + e.message); } finally { setIsLoading(false); }
  };

  const handleTwinChange = (index: number, field: string, value: any) => {
    const updated = [...generatedTwins];
    updated[index][field] = value;
    setGeneratedTwins(updated);
  };

  const allQMap = useMemo(() => new Map(questions.map(q => [String(q.question_id).trim().toLowerCase(), q])), [questions]);

  const activeParentQuestion = useMemo(() => {
    if (!selectedQuestion?.parent_question_id) return null;
    let currPid = String(selectedQuestion.parent_question_id).trim();
    if (!currPid || currPid.toLowerCase() === 'null') return null;
    let foundParent: any = null;
    const visited = new Set<string>();
    while (currPid && !visited.has(currPid.toLowerCase())) {
      visited.add(currPid.toLowerCase());
      const pObj = allQMap.get(currPid.toLowerCase());
      if (pObj) {
        foundParent = pObj;
        const nextPid = pObj.parent_question_id ? String(pObj.parent_question_id).trim() : '';
        if (nextPid && nextPid.toLowerCase() !== 'null') {
          currPid = nextPid;
        } else {
          break;
        }
      } else {
        break;
      }
    }
    return foundParent;
  }, [selectedQuestion, allQMap]);

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
    twinTargetBook, similarTargetBook, isFixingLatex, twinAiModel, setTwinAiModel,
    d1Options, d2Options, d3Options, d4Options, d5Options, d6Options, d7Options, d8Options, finalCalculatedTaxId,
    normalRoots, trueOrphans, getDescendants, activeParentQuestion,
    setSelectedBook, setEditForm, setIsEditingContent, setCropImageSrc, setCropTargetField, setHasCropArea,
    setSelD8, setIsTwinModalOpen, setGeneratedTwins, setIsCloneModalOpen, setCloneForm, setTwinTargetBook, setSimilarTargetBook,
    handleRenameBook, fetchQuestions, getKoreanPath, handleAutoFillTaxonomy, handleD1Change, handleD2Change, handleD3Change, handleD4Change, handleD5Change, handleD6Change, handleD7Change,
    handleQuestionClick, saveTaxonomy, createNewQuestion, deleteQuestion, executeClone, handleImageInput, handlePaste, handleDrop, handleCropMouseDown, handleCropMouseMove, handleCropMouseUp, handleCropUpload,
    handleCropExisting, handleDeleteImage,
    saveQuestionContent, handleGenerateTwins, saveTwinsToDB, handleTwinChange, handleFixLatex
  };
}