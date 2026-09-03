// src/app/exam/step2/useExamData.ts
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getDiffLabelByRate, smartSplitTaxonomy, getDepth5Name, extractParentIds } from "./examUtils";

const URL_MASTER_CAT = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_data/Master_Category.json";
const URL_MASTER_ITEM = "https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_data/Master_Item.json";

export function useExamData() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [questions, setQuestions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isClinicMode, setIsClinicMode] = useState(false);

  const [depth5Map, setDepth5Map] = useState<Record<string, string>>({});
  const [depth6Map, setDepth6Map] = useState<Record<string, string>>({});
  const [parentSourceMap, setParentSourceMap] = useState<Record<string, any>>({});

  const [leftTab, setLeftTab] = useState<"list" | "add">("list");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
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
    const itemIds = [...new Set(items.map(q => q.item_id).filter(Boolean))];
    if (itemIds.length === 0) return;
    try {
      for (let i = 0; i < itemIds.length; i += 100) {
        const chunk = itemIds.slice(i, i + 100);
        const { data } = await supabase.from('master_item').select('item_id, depth5, depth6').in('item_id', chunk);
        if (data) {
          setDepth5Map(prev => {
            const next = { ...prev };
            data.forEach(row => { if (row.depth5) next[row.item_id] = row.depth5; });
            return next;
          });
          setDepth6Map(prev => {
            const next = { ...prev };
            data.forEach(row => { if (row.depth6) next[row.item_id] = row.depth6; });
            return next;
          });
        }
      }
    } catch(e) {}
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
          g.items.sort((a: any, b: any) => {
              if (a.question_id === a.parent_question_id || a.sub_num === 0) return -1;
              if (b.question_id === b.parent_question_id || b.sub_num === 0) return 1;
              return (a.sub_num || 0) - (b.sub_num || 0);
          });
        });

        if (restoredGroups.length === 0) throw new Error('복원할 문항을 찾을 수 없습니다.');

        const allItems = restoredGroups.reduce((acc, g) => acc.concat(g.items), []);
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
      try {
        const isDuplicate = !!(duplicateUrlId || duplicateSessionId);
        if (urlExamId) {
          sessionStorage.setItem('editExamId', urlExamId);
          sessionStorage.removeItem('duplicateExamId');
        } else if (duplicateUrlId) {
          sessionStorage.setItem('duplicateExamId', duplicateUrlId);
          sessionStorage.removeItem('editExamId');
        }

        const { data: examData } = await supabase.from('exam_master').select('title, layout_settings').eq('exam_id', loadExamId).single();
        if (examData && examData.title) {
            const titleToSet = isDuplicate ? `${examData.title} (복제본)` : examData.title;
            sessionStorage.setItem('examTitle', titleToSet);
        }

        let userMergedTextQuestions: any[][] = [];
        if (examData?.layout_settings?.userMergedTextQuestions) {
            userMergedTextQuestions = examData.layout_settings.userMergedTextQuestions;
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
          g.items.sort((a: any, b: any) => {
              if (a.question_id === a.parent_question_id || a.sub_num === 0) return -1;
              if (b.question_id === b.parent_question_id || b.sub_num === 0) return 1;
              return (a.sub_num || 0) - (b.sub_num || 0);
          });
        });
        allGroups.sort((a, b) => a.sort_order - b.sort_order);

        const allItems = allGroups.reduce((acc, g) => acc.concat(g.items), []);
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

    try {
      let allData: any[] = [];
      const searchIds = new Set<string>();
      selectedItemIdsArray.forEach((id: string) => {
        searchIds.add(id);
        if (id.includes('-')) {
          const parts = id.split('-');
          if (parts.length > 2) searchIds.add(parts.slice(0, -1).join('-'));
        }
      });
      
      const chunk = Array.from(searchIds);
      for (let i = 0; i < chunk.length; i += 100) {
        const currentChunk = chunk.slice(i, i + 100);
        let orQueryStr = `item_id.in.(${currentChunk.join(',')}),taxonomy_id.in.(${currentChunk.join(',')}),thk_taxonomy_id.in.(${currentChunk.join(',')})`;

        if (examMode === "test") {
          const pdfQueries = currentChunk.map(kw => `pdf_source.ilike.%${kw}%`).join(',');
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

      const isRateFilterActive = (rateMax < 100 || rateMin > 0) && examMode !== "test";
      const filteredData = allData.filter(q => {
        if (q.is_hidden === true || q.is_hidden === 'Y' || q.is_hidden === 'true') return false;
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
        return true;
      });

      if (filteredData.length === 0) {
        alert(`선택한 조건에 맞는 문제가 없습니다. Step 1으로 돌아갑니다.`);
        return router.push("/exam/step1");
      }

      let groupMap = new Map();
      filteredData.forEach(q => {
        let gId = `single_${q.question_id}_${Math.random()}`;
        if (!groupMap.has(gId)) groupMap.set(gId, { id: gId, items: [] });
        groupMap.get(gId).items.push(q);
      });

      let allGroups = Array.from(groupMap.values());
      allGroups.forEach(g => {
        g.items.sort((a: any, b: any) => {
            if (a.question_id === a.parent_question_id || a.sub_num === 0) return -1;
            if (b.question_id === b.parent_question_id || b.sub_num === 0) return 1;
            return (a.sub_num || 0) - (b.sub_num || 0);
        });
      });

      let selectedGroups: any[] = [];
      if (examMode === 'test' && testCategory === '입학테스트') {
        selectedGroups = allGroups.slice(0, qCountReq);
      } else {
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

        let shortages = 0;
        for (let k in targetCounts) {
          const required = targetCounts[k as keyof typeof targetCounts];
          const available = diffPool[k].length;
          if (available >= required) selectedGroups.push(...diffPool[k].splice(0, required));
          else {
            selectedGroups.push(...diffPool[k].splice(0, available));
            shortages += (required - available);
          }
        }
        if (shortages > 0) {
          let remaining = Object.values(diffPool).reduce((acc, val) => acc.concat(val), []).sort(() => 0.5 - Math.random());
          selectedGroups.push(...remaining.splice(0, shortages));
        }
        selectedGroups = selectedGroups.slice(0, qCountReq);
      }
      
      const allItems = selectedGroups.reduce((acc, g) => acc.concat(g.items), []);
      await fetchDepthMappings(allItems);
      await fetchParentSources(allItems);

      selectedGroups.sort((a, b) => {
        const repA = a.items[0]; const repB = b.items[0];
        const srcA = repA.pdf_source || repA.source_book_name || repA.raw_source_tags || '';
        const srcB = repB.pdf_source || repB.source_book_name || repB.raw_source_tags || '';
        if (srcA !== srcB) return srcA.localeCompare(srcB);
        const numA = parseInt(String(repA.question_number || '0').replace(/[^0-9]/g, ''), 10) || 0;
        const numB = parseInt(String(repB.question_number || '0').replace(/[^0-9]/g, ''), 10) || 0;
        return numA - numB;
      });
      setQuestions(selectedGroups);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const loadAddTaxonomyTree = async () => {
    try {
      const [resCat, resItem] = await Promise.all([fetch(URL_MASTER_CAT), fetch(URL_MASTER_ITEM)]);
      const catData = await resCat.json();
      const itemData = await resItem.json();
      
      const fullTree: any = {}; const catMap: any = {};
      catData.forEach((cat: any) => {
        const d1 = cat.depth1; if(!d1) return;
        if(!fullTree[d1]) fullTree[d1] = { children: {}, categoryId: null };
        let currentLevel = fullTree[d1].children;
        const depths = [cat.depth2, cat.depth3, cat.depth4, cat.depth5, cat.depth6, cat.depth7].filter((d:any) => d && !d.includes('세부 정보'));
        if (depths.length === 0) { catMap[cat.category_id] = fullTree[d1]; } 
        else {
          depths.forEach((d:any, idx:number) => {
            if (!currentLevel[d]) currentLevel[d] = { children: {}, categoryId: (idx === depths.length - 1) ? cat.category_id : null };
            if (idx === depths.length - 1) catMap[cat.category_id] = currentLevel[d];
            currentLevel = currentLevel[d].children;
          });
        }
      });
      itemData.forEach((item: any) => {
        const parentCat = catMap[item.category_id];
        if (parentCat) {
          let leafName = item.depth8 || '기본 유형';
          if (!parentCat.children) parentCat.children = {}; 
          parentCat.children[leafName] = { itemId: item.item_id, children: null };
        }
      });
      setAddMasterData(fullTree);
    } catch (e) {}
  };

  const handleDragStart = (e: React.DragEvent, idx: number) => { 
    // 🌟 고스트 이미지 위치 버그 방지를 위해 비동기 처리
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

    const targetId = q.thk_taxonomy_id && String(q.thk_taxonomy_id).trim() !== '' ? q.thk_taxonomy_id : (q.taxonomy_id || q.item_id);

    if (!targetId || targetId === 'null' || targetId === 'undefined') {
      alert("이 문항은 분류 코드가 명확하지 않아 검색이 불가능합니다.");
      setIsSearchingTwin(false);
      return;
    }

    try {
      let fallbackId = targetId;
      if (targetId.includes('-')) {
        const parts = targetId.split('-');
        if (parts.length > 2) fallbackId = parts.slice(0, -1).join('-');
      }
      
      const parentId = q.parent_question_id || 'NO_PARENT_ID_MATCH';
      const currentQuestionId = q.question_id;

      const orQueryStr = `parent_question_id.eq."${currentQuestionId}",question_id.eq."${parentId}",parent_question_id.eq."${parentId}",item_id.ilike."${fallbackId}%",taxonomy_id.ilike."${fallbackId}%",thk_taxonomy_id.ilike."${fallbackId}%"`;

      const { data, error } = await supabase.from('question_db')
        .select('*')
        .or(orQueryStr)
        .neq('question_id', currentQuestionId)
        .limit(200);

      if (error) throw error;

      const existingIds = new Set(questions.reduce((acc: string[], g: any) => acc.concat(g.items.map((i: any) => String(i.question_id))), []));
      const filteredData = (data || []).filter((item: any) => !existingIds.has(String(item.question_id)) && item.is_hidden !== true && item.is_hidden !== 'Y' && item.is_hidden !== 'true');

      if (filteredData.length === 0) {
        setIsSearchingTwin(false);
        return;
      }

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

  const goToStep3 = () => {
    if (questions.length === 0) return alert("출제할 문항이 없습니다.");
    sessionStorage.setItem("examQuestions", JSON.stringify(questions.map(g => g.items.map((i:any) => i.question_id))));
    sessionStorage.setItem("qCount", String(questions.length));
    
    const userMergedTextQuestions = questions
      .filter(g => g.is_merged_text)
      .map(g => g.items.map((i: any) => i.question_id));
    sessionStorage.setItem('examUserMergedTextQuestions', JSON.stringify(userMergedTextQuestions));

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
    
    sessionStorage.setItem('majorGrade', maxGrade);

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

    const sorted = [...questions].sort((a, b) => {
      const s1 = a.items[0].taxonomy_name || ''; const s2 = b.items[0].taxonomy_name || '';
      return s1.localeCompare(s2);
    });
    sessionStorage.setItem('scopeStart', getDepth5Name(sorted[0].items[0], depth5Map));
    sessionStorage.setItem('scopeEnd', getDepth5Name(sorted[sorted.length-1].items[0], depth5Map));

    router.push("/exam/viewer"); 
  };

  return {
    router, questions, setQuestions, isLoading, showAnswer, setShowAnswer,
    depth5Map, depth6Map, parentSourceMap,
    leftTab, setLeftTab, checkedIds, setCheckedIds, draggedIdx, setDraggedIdx,
    addMasterData, addSelectedCatIds, setAddSelectedCatIds, newSearchResults, setNewSearchResults,
    isSearchingNew, setIsSearchingNew, showAddResults, setShowAddResults,
    twinViewOpen, setTwinViewOpen, twinTarget, setTwinTarget, twinPoolTwins, setTwinPoolTwins,
    twinPoolSimilars, setTwinPoolSimilars, isSearchingTwin, setIsSearchingTwin,
    editingId, setEditingId, editForm, setEditForm,
    fetchDepthMappings, fetchParentSources, loadAddTaxonomyTree, goToStep3,
    handleDragStart, handleDragOver, handleDrop, openTwinSearch,
    isClinicMode 
  };
}