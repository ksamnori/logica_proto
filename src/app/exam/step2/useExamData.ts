// src/app/exam/step2/useExamData.ts
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { getDiffLabelByRate, smartSplitTaxonomy, getDepth5Name, getDepth6Name, extractParentIds, compareSubQuestions, compareQuestionsBySource, buildMergedQuestionGroups, fetchMainTextbookExclusionSet, isMainTextbookQuestion, isWorkbookQuestion, hydrateMissingQuestionImages, matchesSourceCategoryFilter, ensureCompleteSubQuestionBundles } from "./examUtils";
import { DIAGNOSTIC_SEMESTERS, getDiagnosticQuarterInfo, matchDiagnosticSemester } from "../step1/useStep1Data";
import { normalizeMasterCategories, normalizeMasterCategoryRow } from "../../../lib/normalize";

const URL_MASTER_CAT = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_data/Master_Category.json";
const URL_MASTER_ITEM = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_data/Master_Item.json";

export function useExamData() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [questions, setQuestions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isClinicMode, setIsClinicMode] = useState(false);
  
  const [isRestoredMode, setIsRestoredMode] = useState(false);

  const [depth5Map, setDepth5Map] = useState<Record<string, string>>({});
  const [depth6Map, setDepth6Map] = useState<Record<string, string>>({});
  const [parentSourceMap, setParentSourceMap] = useState<Record<string, any>>({});

  const [leftTab, setLeftTab] = useState<"list" | "add">("list");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<string>>(new Set());

  const normalizeHiddenKey = (raw: any): string => {
    const s = String(raw || "");
    const m = s.match(/^(.*?)__img([12])$/);
    if (m) return `${m[1].replace(/_added_\d+$/, "")}__img${m[2]}`;
    return s.replace(/_added_\d+$/, "");
  };

  const toggleHideImage = (questionId: string, slot: 1 | 2 = 1) => {
    const realId = String(questionId).replace(/_added_\d+$/, "");
    const key = `${realId}__img${slot}`;
    const otherSlot = slot === 1 ? 2 : 1;
    const otherKey = `${realId}__img${otherSlot}`;
    setHiddenImageIds((prev) => {
      const next = new Set(prev);
      // 레거시 단일 키(realId)가 있던 경우 두 슬롯이 모두 숨겨진 것으로 간주하고 개별 키로 전환
      if (next.has(realId)) {
        next.delete(realId);
        next.add(otherKey);
      } else if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      sessionStorage.setItem("examHiddenImageQuestions", JSON.stringify(Array.from(next)));
      return next;
    });
  };
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  const [addMasterData, setAddMasterData] = useState<any>(null);
  const [addSelectedCatIds, setAddSelectedCatIds] = useState<Set<string>>(new Set());
  const [newSearchResults, setNewSearchResults] = useState<any[]>([]);
  const [isSearchingNew, setIsSearchingNew] = useState(false);
  const [showAddResults, setShowAddResults] = useState(false);

  const [twinViewOpen, setTwinViewOpen] = useState(false);
  const [twinTarget, setTwinTarget] = useState<{ idx: number, subIdx: number, q: any } | null>(null);
  const [twinPoolTwins, setTwinPoolTwins] = useState<any[]>([]);
  const [twinPoolSimilars, setTwinPoolSimilars] = useState<any[]>([]);
  const [isSearchingTwin, setIsSearchingTwin] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  useEffect(() => {
    const clinicFlag = sessionStorage.getItem('isClinicMode') === 'true' || searchParams.get('source') === 'clinic_incorrect';
    setIsClinicMode(clinicFlag);

    fetchAndFilterQuestions();
    loadAddTaxonomyTree();
  }, []);

  const fetchDepthMappings = async (items: any[]) => {
    const rawTaxIds = [...new Set(
      items
        .flatMap((q: any) => [q?.taxonomy_id, q?.sub_taxonomy_id, q?.item_id])
        .map((id: any) => (id ? String(id).trim().toUpperCase() : ""))
        .filter((id: string) => id && id !== "NULL" && id !== "UNDEFINED" && id !== "미분류")
    )];
    if (rawTaxIds.length === 0) return;

    try {
      const catIdByTaxId = new Map<string, string>();
      const itemD6ByTaxId = new Map<string, string>();
      const catIdsToFetch = new Set<string>();

      for (let i = 0; i < rawTaxIds.length; i += 100) {
        const chunk = rawTaxIds.slice(i, i + 100);
        const { data: mItems } = await supabase
          .from('master_item')
          .select('item_id, category_id, depth6, depth8')
          .in('item_id', chunk);

        if (mItems) {
          mItems.forEach((row: any) => {
            const iId = String(row.item_id || "").trim().toUpperCase();
            if (row.depth6) {
              itemD6ByTaxId.set(iId, String(row.depth6).trim());
            }
            if (row.category_id) {
              const cId = String(row.category_id).trim().toUpperCase();
              catIdByTaxId.set(iId, cId);
              catIdsToFetch.add(cId);
            }
          });
        }

        // taxonomy_id가 item_id(끝자리가 3자리 일련번호이거나 6세그먼트 이상) 형태이면 앞 세그먼트도 category_id 후보로 추가
        chunk.forEach((tid) => {
          if (!catIdByTaxId.has(tid)) {
            const parts = tid.split("-");
            if (parts.length >= 6 || (parts.length >= 4 && /^\d{3}$/.test(parts[parts.length - 1]))) {
              const parentCat = parts.slice(0, -1).join("-");
              catIdByTaxId.set(tid, parentCat);
              catIdsToFetch.add(parentCat);
            }
            catIdsToFetch.add(tid);
          }
        });
      }

      const catIdsArr = Array.from(catIdsToFetch);
      const catMap = new Map<string, { depth5?: string; depth6?: string }>();
      for (let i = 0; i < catIdsArr.length; i += 100) {
        const chunk = catIdsArr.slice(i, i + 100);
        const { data: mCats } = await supabase
          .from('master_category')
          .select('*')
          .in('category_id', chunk);
        if (mCats) {
          mCats.forEach((rawC: any) => {
            const c = normalizeMasterCategoryRow(rawC);
            const cId = String(c.category_id || "").trim().toUpperCase();
            catMap.set(cId, { depth5: c.depth5, depth6: c.depth6 });
          });
        }
      }

      const nextD5: Record<string, string> = {};
      const nextD6: Record<string, string> = {};
      rawTaxIds.forEach((tid) => {
        const directCat = catMap.get(tid);
        const mappedCatId = catIdByTaxId.get(tid);
        const parentCat = mappedCatId ? catMap.get(mappedCatId) : undefined;
        const d5 = directCat?.depth5 || parentCat?.depth5 || "";
        const d6 = directCat?.depth6 || parentCat?.depth6 || itemD6ByTaxId.get(tid) || "";
        if (d5) nextD5[tid] = d5;
        if (d6) nextD6[tid] = d6;
      });

      if (Object.keys(nextD5).length > 0) {
        setDepth5Map((prev) => ({ ...prev, ...nextD5 }));
      }
      if (Object.keys(nextD6).length > 0) {
        setDepth6Map((prev) => ({ ...prev, ...nextD6 }));
      }
    } catch (e) {}
  };

  const fetchParentSources = async (questionsArray: any[]) => {
    let idsToFetch = new Set<string>();
    questionsArray.forEach(q => {
      const ext = extractParentIds(q.parent_relations, q.parent_question_id);
      ext.twins.forEach(id => idsToFetch.add(id));
      ext.similars.forEach(id => idsToFetch.add(id));
    });
    
    let idsArr = Array.from(idsToFetch);
    if (idsArr.length === 0) return;
    
    try {
      for (let i = 0; i < idsArr.length; i += 100) {
        const chunk = idsArr.slice(i, i + 100);
        const { data } = await supabase.from('question_db')
          .select('question_id, source_book_name, final_printed_page, question_number, raw_source_tags, pdf_source, detected_page_num')
          .in('question_id', chunk);
        if (data) {
          setParentSourceMap(prev => {
            const next = { ...prev };
            data.forEach(row => { next[row.question_id] = row; });
            return next;
          });
        }
      }
    } catch(e) {}
  };

  const fetchAndFilterQuestions = async () => {
    setIsLoading(true);

    if (sessionStorage.getItem('restoreExamQuestions') === '1' && sessionStorage.getItem('examQuestions')) {
      setIsRestoredMode(true); 
      setTimeout(() => sessionStorage.removeItem('restoreExamQuestions'), 1500);
      try {
        const parsedGroups = JSON.parse(sessionStorage.getItem('examQuestions') || "[]");
        const toRealId = (qid: string) => String(qid).replace(/_added_\d+$/, '');
        
        const flatParsed = parsedGroups.reduce((acc: any[], val: any) => acc.concat(Array.isArray(val) ? val : [val]), []);
        const realIds = [...new Set(flatParsed.map(toRealId))];

        let allData: any[] = [];
        for (let i = 0; i < realIds.length; i += 100) {
          const chunk = realIds.slice(i, i + 100);
          const { data, error } = await supabase.from('question_db').select('*').in('question_id', chunk);
          if (error) throw error;
          if (data) allData = allData.concat(data);
        }
        
        const byId = new Map(allData.map(q => [String(q.question_id), q]));

        const mergedTextQuestions = JSON.parse(sessionStorage.getItem('examUserMergedTextQuestions') || '[]');
        try {
          const savedHidden = JSON.parse(sessionStorage.getItem('examHiddenImageQuestions') || '[]');
          if (Array.isArray(savedHidden)) setHiddenImageIds(new Set(savedHidden.map(normalizeHiddenKey)));
        } catch (e) {}
        const customGroupMap = new Map<string, string>();
        mergedTextQuestions.forEach((arr: any[], idx: number) => {
           const gId = `restored_custom_group_${idx}`;
           arr.forEach(qid => customGroupMap.set(String(qid), gId));
        });

        const groupMap = new Map<string, any>();
        let sortCounter = 0;

        parsedGroups.forEach((group: any) => {
          const qids = Array.isArray(group) ? group : [group];
          
          qids.forEach((qid: string) => {
            const real = byId.get(toRealId(qid));
            if (!real) return;
            const copy = JSON.parse(JSON.stringify(real));
            copy.question_id = qid; 
            
            let gId = customGroupMap.get(String(toRealId(qid))) || customGroupMap.get(String(qid));
            if (!gId) {
               if (Array.isArray(group)) gId = `array_group_${sortCounter}`;
               else gId = `single_${qid}_${Math.random()}`;
            }

            if (!groupMap.has(gId)) {
              groupMap.set(gId, { 
                id: gId, 
                is_merged_text: !!(customGroupMap.get(String(toRealId(qid))) || customGroupMap.get(String(qid))), 
                items: [], 
                sort_order: sortCounter 
              });
            }
            groupMap.get(gId).items.push(copy);
          });
          sortCounter++;
        });

        let restoredGroups = Array.from(groupMap.values());
        restoredGroups.sort((a, b) => a.sort_order - b.sort_order);
        
        restoredGroups.forEach((g: any) => {
          if (g.items && g.items.length > 1) {
            g.items.sort(compareSubQuestions);
          }
        });

        if (restoredGroups.length === 0) throw new Error('복원할 문항을 찾을 수 없습니다.');

        const allItems = restoredGroups.reduce((acc, g) => acc.concat(g.items), []);
        await hydrateMissingQuestionImages(supabase, allItems);
        await fetchDepthMappings(allItems);
        await fetchParentSources(allItems);

        setQuestions(restoredGroups);
        setIsLoading(false);
        return;
      } catch (error) {
        console.error(error);
        alert("이전 문항 데이터를 복원하는데 실패했습니다.");
        setIsLoading(false);
        return; 
      }
    }

    const urlExamId = searchParams.get('exam_id');
    const duplicateUrlId = searchParams.get('duplicate_exam_id');
    const editExamId = sessionStorage.getItem('editExamId');
    const duplicateSessionId = sessionStorage.getItem('duplicateExamId');
    const loadExamId = urlExamId || duplicateUrlId || editExamId || duplicateSessionId;

    if (loadExamId) {
      setIsRestoredMode(true); 
      try {
        if (urlExamId) {
          sessionStorage.setItem('editExamId', urlExamId);
          sessionStorage.removeItem('duplicateExamId');
        } else if (duplicateUrlId) {
          sessionStorage.setItem('duplicateExamId', duplicateUrlId);
          sessionStorage.removeItem('editExamId');
        }

        const { data: examData } = await supabase.from('exam_master').select('title, exam_type, layout_settings').eq('exam_id', loadExamId).single();
        sessionStorage.removeItem('examMode');
        sessionStorage.removeItem('testCategory');
        sessionStorage.removeItem('testSourceFilter');
        sessionStorage.removeItem('diagnosticQuestionIds');
        if (examData) {
            if (examData.title) {
                const isDuplicate = !!(duplicateUrlId || duplicateSessionId);
                const titleToSet = isDuplicate ? `${examData.title} (복제본)` : examData.title;
                sessionStorage.setItem('examTitle', titleToSet);
            }
            if (examData.exam_type) {
                sessionStorage.setItem('examType', examData.exam_type);
            } else {
                sessionStorage.setItem('examType', '선택없음');
            }
        }

        let userMergedTextQuestions: any[][] = [];
        const parsedLayout = typeof examData?.layout_settings === "string"
          ? (() => { try { return JSON.parse(examData.layout_settings); } catch (e) { return null; } })()
          : examData?.layout_settings;
        if (parsedLayout?.userMergedTextQuestions) {
            userMergedTextQuestions = parsedLayout.userMergedTextQuestions;
        }
        if (Array.isArray(parsedLayout?.hiddenImageQuestions)) {
            const cleanedHidden = parsedLayout.hiddenImageQuestions.map(normalizeHiddenKey);
            setHiddenImageIds(new Set(cleanedHidden));
            sessionStorage.setItem("examHiddenImageQuestions", JSON.stringify(cleanedHidden));
        }

        const customGroupMap = new Map<string, string>();
        userMergedTextQuestions.forEach((arr, idx) => {
            const gId = `custom_group_${idx}`;
            arr.forEach(qid => customGroupMap.set(String(qid), gId));
        });

        const { data: examItems, error: itemsErr } = await supabase.from('exam_item').select('*').eq('exam_id', loadExamId).order('sort_order');
        if (itemsErr || !examItems || examItems.length === 0) {
          alert("저장된 시험지 문항 정보를 찾을 수 없습니다. Step 1으로 이동합니다.");
          return router.push("/exam/step1");
        }

        const qIds = examItems.map((item: any) => item.question_id);
        let allData: any[] = [];
        for (let i = 0; i < qIds.length; i += 100) {
          const chunk = qIds.slice(i, i + 100);
          const { data: questionsData, error: qErr } = await supabase.from("question_db").select("*").in('question_id', chunk);
          if (qErr) throw qErr;
          if (questionsData) allData = allData.concat(questionsData);
        }

        const orderedQuestions = examItems.map((item: any) => {
          const q = allData.find((qu: any) => String(qu.question_id) === String(item.question_id));
          return q ? { ...q, sort_order: item.sort_order } : null;
        }).filter(Boolean);

        let groupMap = new Map();
        orderedQuestions.forEach((q: any) => {
          let gId = customGroupMap.get(String(q.question_id));
          
          if (!gId) {
              gId = `single_${q.question_id}_${Math.random()}`;
          }

          if (!groupMap.has(gId)) {
             groupMap.set(gId, { 
                id: gId, items: [], sort_order: q.sort_order, 
                is_merged_text: !!customGroupMap.get(String(q.question_id)) 
             });
          }
          groupMap.get(gId).items.push(q);
        });

        let allGroups = Array.from(groupMap.values());
        allGroups.forEach((g: any) => {
          if (g.items && g.items.length > 1) {
            g.items.sort(compareSubQuestions);
            g.is_merged_text = true;
          }
        });
        allGroups.sort((a, b) => a.sort_order - b.sort_order);
        const isLoadedDiag = examData?.exam_type === '입학테스트' || examData?.exam_type === '진단평가';
        if (isLoadedDiag && userMergedTextQuestions.length === 0 && orderedQuestions.length > 0) {
          allGroups = buildMergedQuestionGroups(orderedQuestions, true, true);
        }

        const allItems = allGroups.reduce((acc, g) => acc.concat(g.items), []);
        await hydrateMissingQuestionImages(supabase, allItems);
        await fetchDepthMappings(allItems);
        await fetchParentSources(allItems);

        setQuestions(allGroups);
      } catch (e) {
        console.error(e);
        alert("시험지를 불러오는 중 오류가 발생했습니다.");
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setIsRestoredMode(false); 

    const itemIdsStr = sessionStorage.getItem("selectedItemIds");
    if (!itemIdsStr) {
      alert("선택된 단원 정보가 없습니다. Step 1으로 돌아갑니다.");
      router.push("/exam/step1");
      return;
    }
    
    const pTypes = JSON.parse(sessionStorage.getItem("problemTypes") || '{"obj":true,"subj":true,"essay":true}');
    const [rateMax, rateMin] = JSON.parse(sessionStorage.getItem("correctRateRange") || '[100,0]');
    const distributions = JSON.parse(sessionStorage.getItem("distributions") || '[10,20,40,20,10]');
    const qCountReq = parseInt(sessionStorage.getItem("qCount") || "20");
    const examMode = sessionStorage.getItem("examMode");
    const testCategory = sessionStorage.getItem("testCategory");
    const selectedItemIdsArray = JSON.parse(itemIdsStr);

    const bookName1 = sessionStorage.getItem("bookName1") || "";
    const bookName2 = sessionStorage.getItem("bookName2") || "";
    const pageStart = sessionStorage.getItem("pageStart") || "";
    const pageEnd = sessionStorage.getItem("pageEnd") || "";
    let sourceCategories = {
      extra: true,
      twinSimilar: true,
      excludeMain: true,
      excludeWorkbook: true,
    };
    try {
      const scStr = sessionStorage.getItem("sourceCategories");
      if (scStr) {
        sourceCategories = { ...sourceCategories, ...JSON.parse(scStr) };
      }
    } catch (e) {}

    try {
      let allData: any[] = [];
      const searchIds = new Set<string>();
      const diagSelections: { sem: (typeof DIAGNOSTIC_SEMESTERS)[number]; quarterKey: string | null }[] = [];
      const isDiagnosticMode = examMode === "test" && (testCategory === "진단평가" || testCategory === "입학테스트");

      selectedItemIdsArray.forEach((rawId: string) => {
        const id = String(rawId || "");
        if (id.includes("__QTR__")) {
          const [baseSrc, qtrKey] = id.split("__QTR__");
          const sem = DIAGNOSTIC_SEMESTERS.find((s) => s.baseSource === baseSrc);
          if (sem) {
            diagSelections.push({ sem, quarterKey: qtrKey || null });
          } else {
            searchIds.add(baseSrc);
          }
          return;
        }

        if (isDiagnosticMode) {
          const sem = DIAGNOSTIC_SEMESTERS.find((s) => s.baseSource === id);
          if (sem) {
            diagSelections.push({ sem, quarterKey: null });
            return;
          }
        }

        searchIds.add(id);
        if (examMode !== "test" && id.includes("-")) {
          const parts = id.split("-");
          if (parts.length > 2) searchIds.add(parts.slice(0, -1).join("-"));
        }
      });

      // 🌟 1) 진단평가 모드일 때: Step 1에서 전달된 정확한 question_id 목록 또는 진단평가 전용 페이지네이션 쿼리로 조회
      // (기존처럼 "4-1" 같은 학기 코드를 일반 ilike 검색에 넣으면 일반 교재 수천 건이 먼저 조회되어 1000건 제한에 걸려 진단평가 문항이 누락되던 문제 완벽 해결)
      if (isDiagnosticMode || diagSelections.length > 0) {
        let preMatchedQIds: string[] = [];
        try {
          preMatchedQIds = JSON.parse(sessionStorage.getItem("diagnosticQuestionIds") || "[]");
        } catch (e) {}

        if (Array.isArray(preMatchedQIds) && preMatchedQIds.length > 0) {
          for (let i = 0; i < preMatchedQIds.length; i += 100) {
            const idChunk = preMatchedQIds.slice(i, i + 100);
            const { data, error } = await supabase
              .from("question_db")
              .select("*")
              .in("question_id", idChunk);
            if (error) throw error;
            if (data) allData = allData.concat(data);
          }
        } else {
          let from = 0;
          const step = 1000;
          while (true) {
            const { data, error } = await supabase
              .from("question_db")
              .select("*")
              .or("pdf_source.ilike.%입학테스트%,pdf_source.ilike.%진단평가%,source_book_name.ilike.%입학테스트%,source_book_name.ilike.%진단평가%,book_name.ilike.%입학테스트%,book_name.ilike.%진단평가%")
              .order("question_id", { ascending: true })
              .range(from, from + step - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            allData = allData.concat(data);
            if (data.length < step) break;
            from += step;
          }
        }
      }

      // 🌟 2) 일반/사고력/기타 테스트 검색 (sub_taxonomy_id 포함하여 단원 검색 범위 확장)
      const chunk = Array.from(searchIds);
      for (let i = 0; i < chunk.length; i += 50) {
        const currentChunk = chunk.slice(i, i + 50);
        let orQueryStr = `item_id.in.(${currentChunk.join(',')}),taxonomy_id.in.(${currentChunk.join(',')}),sub_taxonomy_id.in.(${currentChunk.join(',')}),thk_taxonomy_id.in.(${currentChunk.join(',')})`;

        if (examMode === "test") {
          const pdfQueries = currentChunk.map(kw => `pdf_source.ilike.%${kw}%,source_book_name.ilike.%${kw}%,book_name.ilike.%${kw}%`).join(',');
          orQueryStr = `${orQueryStr},${pdfQueries}`;
        }

        let finalQuery = supabase.from("question_db").select("*").or(orQueryStr);
        const testSourceFilter = sessionStorage.getItem("testSourceFilter");
        
        if (testSourceFilter) {
            finalQuery = finalQuery.eq("source_book_name", testSourceFilter);
        }

        const { data, error } = await finalQuery.limit(2000);
        if (error) throw error;
        if (data) allData = allData.concat(data);
      }

      // 중복 문항 제거
      const uniqueDataMap = new Map<string, any>();
      allData.forEach((q: any) => {
        if (q && q.question_id) uniqueDataMap.set(String(q.question_id), q);
      });
      allData = Array.from(uniqueDataMap.values());

      const mainExclusion = !isDiagnosticMode ? await fetchMainTextbookExclusionSet(supabase) : null;
      const isPageFilterActive = !isDiagnosticMode && (pageStart !== "" || pageEnd !== "");
      const minPage = pageStart ? parseInt(pageStart, 10) : 0;
      const maxPage = pageEnd ? parseInt(pageEnd, 10) : 999999;
      const kwBook1 = !isDiagnosticMode ? bookName1.trim().toLowerCase() : "";
      const kwBook2 = !isDiagnosticMode ? bookName2.trim().toLowerCase() : "";

      const isRateFilterActive = (rateMax < 100 || rateMin > 0) && examMode !== "test";
      const filteredData = allData.filter(q => {
        if (q.is_hidden === true || q.is_hidden === 'Y' || q.is_hidden === 'true') return false;
        // 🌟 주교재 제외 / 워크북 제외 / 추가문제 / 쌍둥이·유사 필터 적용
        if (!isDiagnosticMode) {
          if ((sourceCategories.excludeMain ?? true) && isMainTextbookQuestion(q, mainExclusion)) return false;
          if ((sourceCategories.excludeWorkbook ?? true) && isWorkbookQuestion(q, mainExclusion)) return false;
          if (examMode !== "test" && !matchesSourceCategoryFilter(q, sourceCategories, mainExclusion)) return false;

          if (kwBook1 || kwBook2) {
            const combinedBookName = `${q.book_name || ""} ${q.source_book_name || ""}`.toLowerCase();
            if (kwBook1 && !combinedBookName.includes(kwBook1)) return false;
            if (kwBook2 && !combinedBookName.includes(kwBook2)) return false;
          }
        }

        if (diagSelections.length > 0) {
          const matchesDiag = diagSelections.some(({ sem, quarterKey }) => {
            if (!matchDiagnosticSemester(q, sem)) return false;
            if (!quarterKey) return true;
            return getDiagnosticQuarterInfo(q.created_at).key === quarterKey;
          });
          if (!matchesDiag) return false;
        }
        
        if (examMode !== "test") {
          const pt = String(q.problem_type || '').toUpperCase();
          let isObj = false, isSubj = false, isEssay = false;
          if (pt === 'SUBJECTIVE' || pt === 'SHORT_ANSWER') isSubj = true;
          else if (pt === 'ESSAY' || pt === 'DESCRIPTIVE') isEssay = true;
          else isObj = true; 
          if ((isObj && !pTypes.obj) || (isSubj && !pTypes.subj) || (isEssay && !pTypes.essay)) return false;
        }
        
        if (isRateFilterActive) {
          if (q.solving_probability === null || q.solving_probability === undefined) return true;
          if (q.solving_probability > rateMax || q.solving_probability < rateMin) return false;
        }

        if (isPageFilterActive) {
          if (!q.final_printed_page) return false;
          const pageNum = parseInt(String(q.final_printed_page).replace(/[^0-9]/g, ''), 10);
          if (isNaN(pageNum) || pageNum < minPage || pageNum > maxPage) return false;
        }

        return true;
      });

      if (filteredData.length === 0) {
        alert(`선택한 조건에 맞는 문제가 없습니다. Step 1으로 돌아갑니다.`);
        return router.push("/exam/step1");
      }

      // 🌟 1) 서브문항이 있는 문항이 불려왔을 때 같은 묶음의 모든 서브문항((1), (2) 등)을 빠짐없이 함께 확보
      const completeFilteredData = await ensureCompleteSubQuestionBundles(
        supabase,
        filteredData,
        allData,
        isDiagnosticMode
      );

      // 🌟 2) 서브문항 자동 병합: 동일 묶음의 서브문항들은 하나의 그룹(g.items)으로 함께 유지
      let allGroups = buildMergedQuestionGroups(completeFilteredData, isDiagnosticMode);

      let selectedGroups: any[] = [];
      if (examMode === 'test' && (testCategory === '진단평가' || testCategory === '입학테스트')) {
        selectedGroups = diagSelections.length > 0 ? allGroups : allGroups.slice(0, qCountReq);
      } else {
        // 🌟 3) 총 출제 문항 수(qCountReq)는 '병합되지 않은 상태의 개별 문항 수(g.items.length 합계)'를 기준으로 선발하되,
        // 서브문항 묶음(g.items)은 절대 쪼개지 않고 통째로 포함합니다.
        const diffPool: Record<string, any[]> = { '최하': [], '하': [], '중': [], '상': [], '최상': [] };
        allGroups.forEach(g => {
          let d = (g.items[0].difficulty || getDiffLabelByRate(g.items[0].solving_probability)).trim();
          if (diffPool[d]) diffPool[d].push(g); else diffPool['중'].push(g);
        });
        for (let k in diffPool) diffPool[k].sort(() => 0.5 - Math.random());

        let targetCounts = {
          '최하': Math.round(qCountReq * (distributions[0] / 100)),
          '하': Math.round(qCountReq * (distributions[1] / 100)),
          '중': Math.round(qCountReq * (distributions[2] / 100)),
          '상': Math.round(qCountReq * (distributions[3] / 100)),
          '최상': Math.round(qCountReq * (distributions[4] / 100))
        };

        let currentSum = Object.values(targetCounts).reduce((a,b) => a+b, 0);
        while(currentSum < qCountReq) { targetCounts['중']++; currentSum++; }
        while(currentSum > qCountReq && targetCounts['중'] > 0) { targetCounts['중']--; currentSum--; }

        let totalSelectedItems = 0;
        for (let k in targetCounts) {
          const requiredItems = targetCounts[k as keyof typeof targetCounts];
          let currentDiffItems = 0;
          const pool = diffPool[k];
          const unpicked: any[] = [];

          for (const g of pool) {
            const gSize = Array.isArray(g.items) && g.items.length > 0 ? g.items.length : 1;
            if (
              currentDiffItems + gSize <= requiredItems &&
              totalSelectedItems + gSize <= qCountReq
            ) {
              selectedGroups.push(g);
              currentDiffItems += gSize;
              totalSelectedItems += gSize;
            } else {
              unpicked.push(g);
            }
          }
          diffPool[k] = unpicked;
        }

        // 부족한 문항 수를 남은 풀에서 채우되, 남은 문항 수(qCountReq - totalSelectedItems) 이하로 들어맞는 묶음을 우선 선택
        if (totalSelectedItems < qCountReq) {
          const remaining = Object.values(diffPool)
            .reduce((acc, val) => acc.concat(val), [])
            .sort(() => 0.5 - Math.random());
          const stillRemaining: any[] = [];

          for (const g of remaining) {
            const gSize = Array.isArray(g.items) && g.items.length > 0 ? g.items.length : 1;
            if (totalSelectedItems + gSize <= qCountReq) {
              selectedGroups.push(g);
              totalSelectedItems += gSize;
            } else {
              stillRemaining.push(g);
            }
          }

          // 만약 남은 후보가 모두 다문항 묶음뿐이어서 아직 qCountReq에 미달한 경우, 묶음을 쪼개지 않고 가장 작은 묶음을 통째로 추가
          if (totalSelectedItems < qCountReq && stillRemaining.length > 0) {
            stillRemaining.sort((a, b) => (a.items?.length || 1) - (b.items?.length || 1));
            for (const g of stillRemaining) {
              if (totalSelectedItems >= qCountReq) break;
              selectedGroups.push(g);
              totalSelectedItems += g.items?.length || 1;
            }
          }
        }
      }
      
      const allItems = selectedGroups.reduce((acc, g) => acc.concat(g.items), []);
      await hydrateMissingQuestionImages(supabase, allItems);
      await fetchDepthMappings(allItems);
      await fetchParentSources(allItems);

      selectedGroups.sort((a, b) => compareQuestionsBySource(a.items[0], b.items[0]));
      setQuestions(selectedGroups);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const loadAddTaxonomyTree = async () => {
    try {
      const [resCat, resItem] = await Promise.all([fetch(URL_MASTER_CAT), fetch(URL_MASTER_ITEM)]);
      const rawCatData = await resCat.json();
      const itemData = await resItem.json();
      const catData = normalizeMasterCategories(rawCatData);
      
      const fullTree: any = {}; const catMap: any = {};
      catData.forEach((cat: any) => {
        const d1 = cat.depth1; if(!d1) return;
        if(!fullTree[d1]) fullTree[d1] = { children: {}, categoryId: null };
        let currentLevel = fullTree[d1].children;
        const depths = [cat.depth2, cat.depth3, cat.depth4, cat.depth5, cat.depth6, cat.depth7].filter((d:any) => d && !d.includes('세부 정보'));
        if (depths.length === 0) { catMap[cat.category_id] = fullTree[d1]; } 
        else {
          depths.forEach((d:any, idx:number) => {
            if (!currentLevel[d]) {
              currentLevel[d] = {
                children: {},
                categoryId: (idx === depths.length - 1) ? cat.category_id : null,
                defaultOpen: idx <= 1, // 과정(depth2, idx=0) 및 대단원(depth3, idx=1)까지만 기본 펼침(중단원 depth4 기본 접힘)
              };
            }
            if (idx === depths.length - 1) catMap[cat.category_id] = currentLevel[d];
            currentLevel = currentLevel[d].children;
          });
        }
      });
      itemData.forEach((item: any) => {
        const parentCat = catMap[item.category_id];
        if (parentCat) {
          const leafName = item.depth8 || item.depth7 || item.depth6 || item.type || '기본 유형';
          if (!parentCat.children) parentCat.children = {};
          if (parentCat.children[leafName]) {
            const existing = parentCat.children[leafName];
            if (!existing.itemIds) existing.itemIds = existing.itemId ? [existing.itemId] : [];
            if (!existing.itemIds.includes(item.item_id)) existing.itemIds.push(item.item_id);
          } else {
            parentCat.children[leafName] = { itemId: item.item_id, itemIds: [item.item_id], children: null };
          }
        }
      });
      setAddMasterData(fullTree);
    } catch (e) {}
  };

  const handleDragStart = (e: React.DragEvent, idx: number) => { 
    e.dataTransfer.effectAllowed = "move"; 
    setTimeout(() => {
      setDraggedIdx(idx);
    }, 0);
  };
  
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) return;
    
    setQuestions(prevQs => {
      const newQs = [...prevQs]; 
      const draggedItem = newQs[draggedIdx];
      
      if (checkedIds.has(draggedItem.id) && checkedIds.size > 1) {
        const selected = newQs.filter(q => checkedIds.has(q.id));
        const unselected = newQs.filter(q => !checkedIds.has(q.id));
        let insertPos = 0;
        for (let i = 0; i <= targetIdx; i++) { if (!checkedIds.has(prevQs[i].id)) insertPos++; }
        unselected.splice(insertPos, 0, ...selected);
        return unselected;
      } else {
        newQs.splice(draggedIdx, 1);
        newQs.splice(targetIdx, 0, draggedItem);
        return newQs;
      }
    });
    setDraggedIdx(null);
  };

  const openTwinSearch = async (idx: number, subIdx: number, q: any) => {
    setTwinTarget({ idx, subIdx, q });
    setTwinViewOpen(true);
    setIsSearchingTwin(true);
    setTwinPoolTwins([]);
    setTwinPoolSimilars([]);

    const rawCandidateIds = [
      q.thk_taxonomy_id,
      q.taxonomy_id,
      q.sub_taxonomy_id,
      q.item_id,
    ]
      .map((val) => (val ? String(val).trim() : ""))
      .filter((val) => val && val !== "null" && val !== "undefined" && val !== "None" && val !== "미분류");

    if (rawCandidateIds.length === 0) {
      alert("이 문항은 분류 코드가 명확하지 않아 검색이 불가능합니다.");
      setIsSearchingTwin(false);
      return;
    }

    try {
      const fallbackPrefixes = Array.from(
        new Set(
          rawCandidateIds.map((tid) => {
            if (tid.includes("-")) {
              const parts = tid.split("-");
              if (parts.length > 2) return parts.slice(0, -1).join("-");
            }
            return tid;
          })
        )
      );

      const parentId = q.parent_question_id || "NO_PARENT_ID_MATCH";
      const currentQuestionId = q.question_id;

      const prefixOrClauses = fallbackPrefixes
        .map(
          (fb) =>
            `item_id.ilike."${fb}%",taxonomy_id.ilike."${fb}%",sub_taxonomy_id.ilike."${fb}%",thk_taxonomy_id.ilike."${fb}%"`
        )
        .join(",");

      const orQueryStr = `parent_question_id.eq."${currentQuestionId}",question_id.eq."${parentId}",parent_question_id.eq."${parentId}",${prefixOrClauses}`;

      const { data, error } = await supabase.from('question_db')
        .select('*')
        .or(orQueryStr)
        .neq('question_id', currentQuestionId)
        .limit(200);

      if (error) throw error;

      const mainExclusion = await fetchMainTextbookExclusionSet(supabase);
      let twinSourceCategories = { excludeMain: true, excludeWorkbook: true };
      try {
        const scStr = sessionStorage.getItem("sourceCategories");
        if (scStr) twinSourceCategories = { ...twinSourceCategories, ...JSON.parse(scStr) };
      } catch (e) {}
      const existingIds = new Set(questions.reduce((acc: string[], g: any) => acc.concat(g.items.map((i: any) => String(i.question_id))), []));
      const filteredData = (data || []).filter(
        (item: any) =>
          !existingIds.has(String(item.question_id)) &&
          item.is_hidden !== true &&
          item.is_hidden !== 'Y' &&
          item.is_hidden !== 'true' &&
          !((twinSourceCategories.excludeMain ?? true) && isMainTextbookQuestion(item, mainExclusion)) &&
          !((twinSourceCategories.excludeWorkbook ?? true) && isWorkbookQuestion(item, mainExclusion))
      );

      if (filteredData.length === 0) {
        setIsSearchingTwin(false);
        return;
      }

      await hydrateMissingQuestionImages(supabase, filteredData);
      await fetchDepthMappings(filteredData);
      await fetchParentSources(filteredData);

      const twins: any[] = [];
      const similars: any[] = [];

      filteredData.forEach(item => {
        const isExactTwin = (item.parent_question_id === currentQuestionId) || 
                            (item.question_id === parentId && parentId !== 'NO_PARENT_ID_MATCH') || 
                            (item.parent_question_id === parentId && parentId !== 'NO_PARENT_ID_MATCH');
        if (isExactTwin) twins.push(item);
        else similars.push(item);
      });

      setTwinPoolTwins(twins.sort(() => 0.5 - Math.random()).slice(0, 2));
      setTwinPoolSimilars(similars.sort(() => 0.5 - Math.random()).slice(0, 10));

    } catch (err) {
      console.error("쌍둥이 검색 에러:", err);
    } finally {
      setIsSearchingTwin(false);
    }
  };

  // 🌟 [핵심 변경] Step 3로 이동할 때 현재 화면의 1~6번 '모든' 문제를 빠짐없이 세션에 저장합니다!
  const goToStep3 = () => {
    if (questions.length === 0) return alert("출제할 문항이 없습니다.");
    
    // 💡 질문 리스트(questions) 안에 있는 모든 문항 ID들을 배열로 추출하여 세션에 구워줍니다.
    const allQuestionIds = questions.map(g => {
        if (g.is_merged_text || (g.items && g.items.length > 1)) {
           // 병합 문항은 배열 형태로 묶어줍니다.
           return g.items.map((i: any) => i.question_id);
        }
        // 일반 문항은 단일 ID로 저장합니다.
        return g.items[0].question_id;
    });

    sessionStorage.setItem("examQuestions", JSON.stringify(allQuestionIds));
    sessionStorage.setItem("qCount", String(questions.length));
    
    const userMergedTextQuestions = questions
      .filter(g => g.is_merged_text || (g.items && g.items.length > 1))
      .map(g => g.items.map((i: any) => i.question_id));
    sessionStorage.setItem('examUserMergedTextQuestions', JSON.stringify(userMergedTextQuestions));
    sessionStorage.setItem('examHiddenImageQuestions', JSON.stringify(Array.from(hiddenImageIds)));

    sessionStorage.setItem("restoreExamQuestions", "1"); 
    
    const gradeCount: Record<string, number> = {};
    
    questions.forEach(g => {
      const q = g.items[0];
      const taxId = String(q.taxonomy_id || q.item_id || '').trim().toUpperCase();
      let gradeStr = '';

      if (taxId.length >= 3) {
        const schoolType = taxId[0]; 
        const grade = taxId[1];      
        const semester = taxId[2];   

        let schoolName = '';
        if (schoolType === 'E') schoolName = '초등';
        else if (schoolType === 'M') schoolName = '중등';
        else if (schoolType === 'H') schoolName = '고등';

        if (schoolName && !isNaN(Number(grade)) && !isNaN(Number(semester))) {
          gradeStr = `${schoolName} ${grade}-${semester}`;
        }
      }

      if (!gradeStr) {
        const srcText = `${q.taxonomy_name || ''} ${q.source_book_name || ''} ${q.book_name || ''} ${q.pdf_source || ''}`;
        const mMid = srcText.match(/중(?:등)?\s*([1-3]-[1-2])/);
        if (mMid) gradeStr = `중등 ${mMid[1]}`;
        else {
          const mMid7 = srcText.match(/(?:^|[^0-9])7-([1-2])(?:[^0-9]|$)/);
          if (mMid7) gradeStr = `중등 1-${mMid7[1]}`;
          else {
            const mElem = srcText.match(/([1-6]-[1-2])/);
            if (mElem) gradeStr = `초등 ${mElem[1]}`;
          }
        }
      }
      
      if (gradeStr) {
        gradeCount[gradeStr] = (gradeCount[gradeStr] || 0) + 1;
      }
    });

    let maxGrade = '공통 과정';
    let maxCount = 0;
    for (const [grade, count] of Object.entries(gradeCount)) {
      if (count > maxCount) {
        maxCount = count;
        maxGrade = grade;
      }
    }
    
    const existingSubTitle = sessionStorage.getItem("examSubTitle");
    if (existingSubTitle && maxGrade === "공통 과정") {
      maxGrade = existingSubTitle;
    }
    sessionStorage.setItem('majorGrade', maxGrade);
    if (!existingSubTitle && maxGrade && maxGrade !== "공통 과정") {
      sessionStorage.setItem("examSubTitle", maxGrade);
    }

    const diffCount: Record<string, number> = {};
    questions.forEach(g => {
      const diff = (g.items[0].difficulty || getDiffLabelByRate(g.items[0].solving_probability)).trim();
      diffCount[diff] = (diffCount[diff] || 0) + 1;
    });
    
    let maxDiff = '중';
    let maxDiffCount = 0;
    for (const [diff, count] of Object.entries(diffCount)) {
      if (count > maxDiffCount) { maxDiffCount = count; maxDiff = diff; }
    }
    sessionStorage.setItem('avgDifficulty', maxDiff);

    const allQsForScope = questions
      .flatMap((g: any) => g.items || [])
      .filter((q: any) => q && (q.taxonomy_id || q.item_id || q.taxonomy_name));

    const sortedByTaxId = (allQsForScope.length > 0 ? [...allQsForScope] : questions.map((g: any) => g.items[0])).sort((a, b) => {
      const t1 = String(a?.taxonomy_id || a?.item_id || a?.taxonomy_name || '').trim();
      const t2 = String(b?.taxonomy_id || b?.item_id || b?.taxonomy_name || '').trim();
      return t1.localeCompare(t2, 'ko', { numeric: true });
    });

    const firstQ = sortedByTaxId[0] || questions[0]?.items?.[0];
    const lastQ = sortedByTaxId[sortedByTaxId.length - 1] || questions[questions.length - 1]?.items?.[0];
    const startD6 = firstQ ? getDepth6Name(firstQ, depth6Map) : '';
    const endD6 = lastQ ? getDepth6Name(lastQ, depth6Map) : '';
    sessionStorage.setItem('scopeStart', startD6 && startD6 !== '유형 분류 없음' ? startD6 : '');
    sessionStorage.setItem('scopeEnd', endD6 && endD6 !== '유형 분류 없음' ? endD6 : '');

    router.push("/exam/viewer"); 
  };

  return {
    router, questions, setQuestions, isLoading, showAnswer, setShowAnswer,
    depth5Map, depth6Map, parentSourceMap,
    leftTab, setLeftTab, checkedIds, setCheckedIds, hiddenImageIds, setHiddenImageIds, toggleHideImage, draggedIdx, setDraggedIdx,
    addMasterData, addSelectedCatIds, setAddSelectedCatIds, newSearchResults, setNewSearchResults,
    isSearchingNew, setIsSearchingNew, showAddResults, setShowAddResults,
    twinViewOpen, setTwinViewOpen, twinTarget, setTwinTarget, twinPoolTwins, setTwinPoolTwins,
    twinPoolSimilars, setTwinPoolSimilars, isSearchingTwin, setIsSearchingTwin,
    editingId, setEditingId, editForm, setEditForm,
    fetchDepthMappings, fetchParentSources, loadAddTaxonomyTree, goToStep3,
    handleDragStart, handleDragOver, handleDrop, openTwinSearch,
    isClinicMode, isRestoredMode
  };
}