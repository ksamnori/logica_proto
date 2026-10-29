// src/app/exam/step2/LeftPanel.tsx
import React, { useState, useMemo, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { getDiffLabelByRate, getTypeName, getDepth5Name, getDepth6Name, getSubDepth6Name, formatText, getCleanUrl, renderParentRelations, compareSubQuestions, compareQuestionsBySource, fetchMainTextbookExclusionSet, isMainTextbookQuestion, hydrateMissingQuestionImages, ensureCompleteSubQuestionBundles, matchesSourceCategoryFilter } from "./examUtils";

const parseId = (id: string) => {
  if (!id) return null;
  const match = String(id).trim().match(/^[\[\s]*([EMH])(\d)(\d)(\d+)(.*)/);
  if (!match) return null;
  
  const school = match[1] === 'E' ? 1 : match[1] === 'M' ? 2 : 3;
  const grade = parseInt(match[2], 10);
  const semester = parseInt(match[3], 10);
  const unit = parseInt(match[4], 10);
  
  const restStr = match[5];
  const restNums = restStr ? restStr.split('-').filter(Boolean).map(x => parseInt(x, 10) || 0) : [];
  
  return [school, grade, semester, unit, ...restNums];
};

const getRepresentativeId = (n: any): string => {
  if (!n || typeof n !== 'object') return "";
  if (typeof n._repId === 'string') return n._repId;
  let resolved = "";
  if (n.itemId) resolved = n.itemId;
  else if (Array.isArray(n.itemIds) && n.itemIds.length > 0) resolved = n.itemIds[0];
  else if (n.categoryId) resolved = n.categoryId;
  else if (n.children) {
    const keys = Object.keys(n.children);
    for (let i = 0; i < keys.length; i++) {
      const id = getRepresentativeId(n.children[keys[i]]);
      if (id) { resolved = id; break; }
    }
  } else {
    for (const k in n) {
      if (k !== 'itemId' && k !== 'itemIds' && k !== 'categoryId' && k !== 'defaultOpen' && k !== '_allIds' && k !== '_repId' && typeof n[k] === 'object') {
        const id = getRepresentativeId(n[k]);
        if (id) { resolved = id; break; }
      }
    }
  }
  n._repId = resolved;
  return resolved;
};

const getAllAddIds = (node: any): string[] => {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node._allIds)) return node._allIds;
  const ids: string[] = [];
  const traverse = (n: any) => {
    if (!n) return;
    if (Array.isArray(n.itemIds) && n.itemIds.length > 0) {
      n.itemIds.forEach((id: string) => ids.push(id));
    } else if (n.itemId) {
      ids.push(n.itemId);
    }
    if (n.children) Object.values(n.children).forEach(traverse);
  };
  traverse(node);
  node._allIds = ids;
  return ids;
};

const compareNodes = (aKey: string, aNode: any, bKey: string, bNode: any) => {
  const idA = getRepresentativeId(aNode) || aKey;
  const idB = getRepresentativeId(bNode) || bKey;

  const pA = parseId(idA);
  const pB = parseId(idB);

  if (pA && pB) {
    const len = Math.max(pA.length, pB.length);
    for (let i = 0; i < len; i++) {
      const valA = pA[i] !== undefined ? pA[i] : -1;
      const valB = pB[i] !== undefined ? pB[i] : -1;
      if (valA !== valB) return valA - valB;
    }
    return 0;
  }
  return String(aKey).localeCompare(String(bKey), 'ko', { numeric: true });
};

const sortNumeric = (a: string, b: string) => String(a).localeCompare(String(b), 'ko', { numeric: true });
const sortD1 = (a: string, b: string) => {
  const weight: Record<string, number> = { '초등학교': 1, '중학교': 2, '고등학교': 3 };
  return (weight[a] || 99) - (weight[b] || 99) || sortNumeric(a, b);
};

const AddTreeNode = React.memo(({ nodeKey, node, depth, selectedAddIds, toggleAddItem, toggleAddFolder }: any) => {
  const [isOpen, setIsOpen] = useState<boolean>(node?.defaultOpen ?? (depth <= 3));

  if (node.children) {
    const ids = getAllAddIds(node);
    
    const checkedCount = ids.filter((id: string) => selectedAddIds.has(id)).length;
    const isChecked = checkedCount > 0 && checkedCount === ids.length;
    const isIndeterminate = checkedCount > 0 && checkedCount < ids.length;

    const summaryClass =
      depth === 3
        ? "font-bold text-[13px] leading-snug cursor-pointer py-1.5 bg-slate-100/90 px-2.5 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-1.5 text-brand border border-slate-200/80"
        : depth === 4
        ? "flex items-center space-x-1.5 py-1 px-2 bg-slate-50/70 hover:bg-blue-50 rounded-md transition-colors select-none cursor-pointer group text-slate-800 font-bold text-[12px] leading-snug"
        : depth === 5
        ? "flex items-center space-x-1.5 py-1 px-1.5 hover:bg-blue-50 rounded-md transition-colors select-none cursor-pointer group text-slate-700 font-semibold text-[11.5px] leading-snug"
        : "flex items-center space-x-1.5 py-1 px-1.5 hover:bg-blue-50 rounded-md transition-colors select-none cursor-pointer group text-slate-600 font-semibold text-[11px] leading-snug";

    return (
      <details open={isOpen} onToggle={(e: any) => setIsOpen(e.currentTarget.open)} className={depth === 3 ? "mb-2" : depth === 4 ? "mb-1.5 pl-2 ml-1.5 border-l-2 border-slate-200" : "mb-0.5 pl-1.5 ml-2 border-l border-slate-200"}>
        <summary className={summaryClass}>
          <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 transition-transform details-arrow shrink-0" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
          <input type="checkbox" ref={el => { if (el) el.indeterminate = isIndeterminate; }} checked={isChecked} onChange={e => toggleAddFolder(node, e.target.checked)} onClick={e => e.stopPropagation()} className="w-3.5 h-3.5 rounded border-slate-300 accent-brand cursor-pointer shrink-0" />
          <span className="truncate">{nodeKey}</span>
        </summary>
        {isOpen && (
          <div className={depth === 3 ? "pl-1 mt-1 space-y-1" : "ml-3 mt-0.5 space-y-0.5"}>
            {Object.keys(node.children).sort((a, b) => compareNodes(a, node.children[a], b, node.children[b])).map(k => (
              <AddTreeNode key={k} nodeKey={k} node={node.children[k]} depth={depth + 1} selectedAddIds={selectedAddIds} toggleAddItem={toggleAddItem} toggleAddFolder={toggleAddFolder} />
            ))}
          </div>
        )}
      </details>
    );
  } else {
    const leafIds: string[] = Array.isArray(node.itemIds) && node.itemIds.length > 0 ? node.itemIds : [node.itemId];
    const isLeafChecked = leafIds.some((id: string) => selectedAddIds.has(id));
    return (
      <label className="flex items-center gap-1.5 py-1 px-2 ml-3 hover:bg-emerald-50 rounded-md text-[11px] text-slate-600 transition-colors cursor-pointer border border-transparent hover:border-emerald-100">
        <input type="checkbox" checked={isLeafChecked} onChange={e => toggleAddItem(leafIds, e.target.checked)} className="w-3.5 h-3.5 rounded border-slate-300 accent-emerald-600 shrink-0 cursor-pointer" />
        <span className="flex-1 break-keep leading-snug">{nodeKey}</span>
      </label>
    );
  }
});

export default function LeftPanel({ examData }: { examData: any }) {
  const {
    questions, setQuestions, depth5Map, depth6Map, parentSourceMap,
    leftTab, setLeftTab, checkedIds, setCheckedIds, draggedIdx, setDraggedIdx,
    addMasterData, addSelectedCatIds, setAddSelectedCatIds, newSearchResults, setNewSearchResults,
    isSearchingNew, setIsSearchingNew, showAddResults, setShowAddResults,
    twinViewOpen, setTwinViewOpen, twinTarget, twinPoolTwins, twinPoolSimilars, isSearchingTwin,
    fetchDepthMappings, fetchParentSources,
    handleDragStart, handleDragOver, handleDrop
  } = examData;

  const [currentAddD1, setCurrentAddD1] = useState<string>('중학교');
  const [currentAddD2, setCurrentAddD2] = useState<string>('');

  // 🌟 문제 목록 텍스트 검색 필터 상태
  const [questionListSearch, setQuestionListSearch] = useState("");

  // 🌟 새 문제 검색용 필터 상태
  const [addBookName1, setAddBookName1] = useState("");
  const [addBookName2, setAddBookName2] = useState("");
  const [addPageStart, setAddPageStart] = useState("");
  const [addPageEnd, setAddPageEnd] = useState("");
  const [addQuestionText, setAddQuestionText] = useState("");
  const [addSourceCategories, setAddSourceCategories] = useState<{
    extra: boolean;
    twinSimilar: boolean;
    excludeMain: boolean;
    excludeWorkbook: boolean;
  }>(() => {
    const defaults = {
      extra: true,
      twinSimilar: true,
      excludeMain: true,
      excludeWorkbook: true,
    };
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("sourceCategories");
        if (saved) return { ...defaults, ...JSON.parse(saved) };
      } catch (e) {}
    }
    return defaults;
  });
  const [searchResultFilter, setSearchResultFilter] = useState("");

  useEffect(() => {
    if (addMasterData) {
      if (!addMasterData[currentAddD1]) {
        const firstD1 = Object.keys(addMasterData).sort(sortD1)[0];
        if (firstD1) {
          setCurrentAddD1(firstD1);
          const d2Keys = Object.keys(addMasterData[firstD1].children).sort(sortNumeric);
          setCurrentAddD2(d2Keys[0] || '');
        }
      } else {
        const d2Keys = Object.keys(addMasterData[currentAddD1].children).sort(sortNumeric);
        if (!d2Keys.includes(currentAddD2)) {
          setCurrentAddD2(d2Keys[0] || '');
        }
      }
    }
  }, [addMasterData, currentAddD1, currentAddD2]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = { '최하': 0, '하': 0, '중': 0, '상': 0, '최상': 0 };
    questions.forEach((g: any) => {
      let d = (g.items[0].difficulty || getDiffLabelByRate(g.items[0].solving_probability)).trim();
      if (counts[d] !== undefined) counts[d]++; else counts['중']++;
    });
    const total = questions.length || 1;
    const maxCount = Math.max(...Object.values(counts)) || 1; 
    return Object.keys(counts).map(k => ({ label: k, count: counts[k], pct: Math.round((counts[k] / total) * 100), hPct: Math.round((counts[k] / maxCount) * 100) }));
  }, [questions]);

  const filteredQuestionEntries = useMemo(() => {
    const kw = questionListSearch.trim().toLowerCase();
    return questions
      .map((g: any, idx: number) => ({ g, idx }))
      .filter(({ g, idx }: { g: any; idx: number }) => {
        if (!kw) return true;
        const repQ = g.items[0];
        const diff = (repQ.difficulty || getDiffLabelByRate(repQ.solving_probability)).trim();
        const typeName = getTypeName(repQ);
        const depth5Name = getDepth5Name(repQ, depth5Map);
        const depth6Name = getDepth6Name(repQ, depth6Map);
        const subDepth6Name = getSubDepth6Name(repQ, depth6Map);
        const numStr = `${idx + 1}번`;
        const itemsMatch = g.items.some((q: any) => {
          const text = String(q.question || q.text_question || "").toLowerCase();
          const ans = String(q.answer || "").toLowerCase();
          const book = String(q.source_book_name || q.book_name || q.pdf_source || "").toLowerCase();
          const page = String(q.final_printed_page || q.detected_page_num || q.page_number || "").toLowerCase();
          const qNum = String(q.question_number || "").toLowerCase();
          const tax = String(q.taxonomy_id || "").toLowerCase();
          const subTax = String(q.sub_taxonomy_id || "").toLowerCase();
          const taxName = String(q.taxonomy_name || "").toLowerCase();
          const subTaxName = String(q.sub_taxonomy_name || "").toLowerCase();
          return (
            text.includes(kw) ||
            ans.includes(kw) ||
            book.includes(kw) ||
            page.includes(kw) ||
            qNum.includes(kw) ||
            tax.includes(kw) ||
            subTax.includes(kw) ||
            taxName.includes(kw) ||
            subTaxName.includes(kw)
          );
        });
        return (
          itemsMatch ||
          diff.toLowerCase().includes(kw) ||
          typeName.toLowerCase().includes(kw) ||
          depth5Name.toLowerCase().includes(kw) ||
          depth6Name.toLowerCase().includes(kw) ||
          subDepth6Name.toLowerCase().includes(kw) ||
          numStr.includes(kw)
        );
      });
  }, [questions, questionListSearch, depth5Map, depth6Map]);

  const filteredNewSearchResults = useMemo(() => {
    const kw = searchResultFilter.trim().toLowerCase();
    if (!kw) return newSearchResults;
    return newSearchResults.filter((q: any) => {
      const text = String(q.question || q.text_question || "").toLowerCase();
      const ans = String(q.answer || "").toLowerCase();
      const book = String(q.source_book_name || q.book_name || q.pdf_source || "").toLowerCase();
      const page = String(q.final_printed_page || q.detected_page_num || "").toLowerCase();
      const qNum = String(q.question_number || "").toLowerCase();
      const d6 = String(getDepth6Name(q, depth6Map) || "").toLowerCase();
      const subD6 = String(getSubDepth6Name(q, depth6Map) || "").toLowerCase();
      const tax = String(q.taxonomy_id || "").toLowerCase();
      const subTax = String(q.sub_taxonomy_id || "").toLowerCase();
      const taxName = String(q.taxonomy_name || "").toLowerCase();
      const subTaxName = String(q.sub_taxonomy_name || "").toLowerCase();
      const typeName = String(getTypeName(q) || "").toLowerCase();
      return (
        text.includes(kw) ||
        ans.includes(kw) ||
        book.includes(kw) ||
        page.includes(kw) ||
        qNum.includes(kw) ||
        d6.includes(kw) ||
        subD6.includes(kw) ||
        tax.includes(kw) ||
        subTax.includes(kw) ||
        taxName.includes(kw) ||
        subTaxName.includes(kw) ||
        typeName.includes(kw)
      );
    });
  }, [newSearchResults, searchResultFilter, depth6Map]);

  const toggleCheck = (id: string, checked: boolean) => setCheckedIds((prev: any) => { const next = new Set(prev); checked ? next.add(id) : next.delete(id); return next; });
  const toggleAllChecks = (checked: boolean) => setCheckedIds(checked ? new Set(questions.map((q: any) => q.id)) : new Set());
  const moveSelectedToTop = () => { if(checkedIds.size > 0) setQuestions([...questions.filter((q: any) => checkedIds.has(q.id)), ...questions.filter((q: any) => !checkedIds.has(q.id))]); };
  const moveSelectedToBottom = () => { if(checkedIds.size > 0) setQuestions([...questions.filter((q: any) => !checkedIds.has(q.id)), ...questions.filter((q: any) => checkedIds.has(q.id))]); };
  const deleteSelected = () => { if(checkedIds.size > 0 && confirm("선택한 문항을 삭제하시겠습니까?")) { setQuestions(questions.filter((q: any) => !checkedIds.has(q.id))); setCheckedIds(new Set()); } };

  const sortBySource = () => {
    setQuestions((prevQs: any[]) => {
      const sortedQs = prevQs.map((g: any) => ({
        ...g,
        items: g.items.length > 1 ? [...g.items].sort(compareSubQuestions) : g.items
      })).sort((a, b) => compareQuestionsBySource(a.items[0], b.items[0]));
      return sortedQs;
    });
  };

  const mergeSelected = () => {
    if (checkedIds.size === 0) return alert("병합할 문항을 선택하세요.");
    if (checkedIds.size > 1 && !confirm("선택한 문항들을 공통 지문을 가진 하나의 묶음 문항으로 병합하시겠습니까?")) {
      return;
    }
    const now = Date.now();
    setQuestions((prevQs: any[]) => {
      const newQs = [...prevQs];
      if (checkedIds.size === 1) {
        return newQs.map(g => checkedIds.has(g.id) ? { ...g, is_merged_text: true } : g);
      }
      const selectedGroups = newQs.filter(g => checkedIds.has(g.id));
      if (selectedGroups.length === 0) return prevQs;
      const unselectedGroups = newQs.filter(g => !checkedIds.has(g.id));
      
      const allMergedItems = selectedGroups
        .reduce((acc: any[], g: any) => acc.concat(g.items), [])
        .sort(compareSubQuestions);
      const mergedGroup = {
        id: `merged_${now}_${allMergedItems[0].question_id}`,
        is_group: true,
        is_merged_text: true, 
        items: allMergedItems,
        sort_order: selectedGroups[0].sort_order
      };
      const firstSelectedId = selectedGroups[0].id;
      let insertIndex = 0;
      for (let i = 0; i < newQs.length; i++) {
        if (newQs[i].id === firstSelectedId) break;
        if (!checkedIds.has(newQs[i].id)) insertIndex++;
      }
      return [...unselectedGroups.slice(0, insertIndex), mergedGroup, ...unselectedGroups.slice(insertIndex)];
    });
    setCheckedIds(new Set());
  };

  const unmergeAllQuestions = () => {
    const hasMerged = questions.some(
      (g: any) => (g.items && g.items.length > 1) || g.is_merged_text || g.is_group
    );
    if (!hasMerged) {
      alert("현재 병합된 문항이 없습니다.");
      return;
    }
    if (!confirm("모든 병합 문항을 해제하여 개별 문항으로 분리하시겠습니까?")) return;

    const now = Date.now();
    setQuestions((prevQs: any[]) => {
      const unmergedList: any[] = [];
      prevQs.forEach((g: any, gIdx: number) => {
        if (g.items && g.items.length > 1) {
          g.items.forEach((item: any, subIdx: number) => {
            unmergedList.push({
              id: `unmerged_${now}_${gIdx}_${subIdx}_${item.question_id}`,
              is_group: false,
              is_merged_text: false,
              items: [item],
              sort_order: unmergedList.length + 1,
            });
          });
        } else {
          unmergedList.push({
            ...g,
            is_group: false,
            is_merged_text: false,
            sort_order: unmergedList.length + 1,
          });
        }
      });
      return unmergedList;
    });
    setCheckedIds(new Set());
    try {
      sessionStorage.removeItem("examUserMergedTextQuestions");
    } catch (e) {}
    alert("✅ 전체 문항의 병합이 모두 해제되었습니다!");
  };

  const autoMergeSubQuestions = () => {
    if (!confirm("페이지 순으로 정렬한 뒤, 공통 지문(8글자 이상)을 가진 서브 문항들을 자동으로 병합하시겠습니까?")) return;
    
    let sortedQs = questions.map((g: any) => ({
      ...g,
      items: g.items.length > 1 ? [...g.items].sort(compareSubQuestions) : [...g.items]
    })).sort((a: any, b: any) => compareQuestionsBySource(a.items[0], b.items[0]));

    const result: any[] = [];
    let i = 0;
    
    const removeNumberingRegex = /^((?:<[^>]+>|&nbsp;|\s)*)(?:\([0-9가-힣a-zA-Z]+\)|[①-⑩]|[0-9]+[\.\)])(?:&nbsp;|\s)*/i;
    let mergedCount = 0;

    while (i < sortedQs.length) {
      let currentGroup = { ...sortedQs[i], items: [...sortedQs[i].items] }; 
      let j = i + 1;
      
      while (j < sortedQs.length) {
        const lastItem = currentGroup.items[currentGroup.items.length - 1];
        const nextItem = sortedQs[j].items[0];
        
        const text1 = lastItem.question || lastItem.text_question || "";
        const text2 = nextItem.question || nextItem.text_question || "";
        
        const clean1 = text1.replace(removeNumberingRegex, "$1");
        const clean2 = text2.replace(removeNumberingRegex, "$1");
        
        let k = 0;
        while (k < clean1.length && k < clean2.length && clean1[k] === clean2[k]) k++;
        
        const commonPrefix = clean1.substring(0, k);
        const textOnlyCommon = commonPrefix.replace(/<[^>]+>/g, '').trim();
        
        const hasSameParent = lastItem.parent_question_id && lastItem.parent_question_id !== 'null' && lastItem.parent_question_id === nextItem.parent_question_id;
        
        if (hasSameParent || textOnlyCommon.length >= 8) {
          if (!currentGroup.id.startsWith('merged_')) {
              currentGroup.id = `merged_${Date.now()}_${i}_${currentGroup.items[0].question_id}`;
          }
          currentGroup.items.push(...sortedQs[j].items);
          currentGroup.is_group = true;
          currentGroup.is_merged_text = true;
          mergedCount++;
          j++;
        } else {
          break; 
        }
      }
      
      if (currentGroup.items.length > 1) {
        currentGroup.items.sort(compareSubQuestions);
        currentGroup.is_merged_text = true;
      }
      
      result.push(currentGroup);
      i = j; 
    }

    setQuestions(result);
    if (mergedCount === 0) {
      alert("병합할 만한 조건(8글자 이상 지문 일치 등)을 만족하는 문항이 없습니다.");
    } else {
      alert(`✨ 시험지 문항들이 교재/페이지 순으로 정렬되었으며, 공통 지문을 가진 서브 문항들이 성공적으로 자동 병합되었습니다!`);
    }
  };

  const searchNewQuestions = async () => {
    const selectedCatIds = Array.from(addSelectedCatIds).filter(val => val);
    if (selectedCatIds.length === 0) return alert("검색할 단원이나 유형을 하나 이상 선택해주세요.");
    
    setShowAddResults(true); 
    setIsSearchingNew(true);
    setSearchResultFilter("");
    
    try {
      let allSearched: any[] = [];
      const expandedCatIdSet = new Set<string>();
      selectedCatIds.forEach((rawId: any) => {
        const id = String(rawId || "").trim();
        if (!id) return;
        expandedCatIdSet.add(id);
        if (id.includes("-")) {
          const parts = id.split("-");
          if (parts.length > 2) expandedCatIdSet.add(parts.slice(0, -1).join("-"));
        }
      });
      const expandedCatIds = Array.from(expandedCatIdSet);

      for (let i = 0; i < expandedCatIds.length; i += 40) {
        const chunk = expandedCatIds.slice(i, i + 40);
        
        // 🌟 1. 기본 쿼리 생성 (sub_taxonomy_id 까지 포함하여 단원 검색 범위 확장)
        let query = supabase.from('question_db').select('*').or(`item_id.in.(${chunk.join(',')}),taxonomy_id.in.(${chunk.join(',')}),sub_taxonomy_id.in.(${chunk.join(',')}),thk_taxonomy_id.in.(${chunk.join(',')})`);
        
        if (addQuestionText.trim()) query = query.ilike("question", `%${addQuestionText.trim()}%`);

        const { data, error } = await query.limit(1000); // 넉넉하게 불러온 뒤 페이지 필터 적용
        
        if (error) throw error;
        if (data) allSearched = allSearched.concat(data);
      }
      
      // 🌟 2. 검색 교재명 필터 적용 (book_name 및 source_book_name 모두 매칭)
      const kw1 = addBookName1.trim().toLowerCase();
      const kw2 = addBookName2.trim().toLowerCase();
      if (kw1 || kw2) {
        allSearched = allSearched.filter((q: any) => {
          const combinedBook = `${q.book_name || ""} ${q.source_book_name || ""}`.toLowerCase();
          if (kw1 && !combinedBook.includes(kw1)) return false;
          if (kw2 && !combinedBook.includes(kw2)) return false;
          return true;
        });
      }

      // 🌟 3. 페이지 번호 필터 적용 (숫자 파싱)
      const isPageFilterActive = addPageStart !== "" || addPageEnd !== "";
      if (isPageFilterActive) {
        const minPage = addPageStart ? parseInt(addPageStart, 10) : 0;
        const maxPage = addPageEnd ? parseInt(addPageEnd, 10) : 999999;
        
        allSearched = allSearched.filter(q => {
          if (!q.final_printed_page) return false;
          const pageNum = parseInt(String(q.final_printed_page).replace(/[^0-9]/g, ''), 10);
          if (isNaN(pageNum)) return false;
          return pageNum >= minPage && pageNum <= maxPage;
        });
      }

      const mainExclusion = await fetchMainTextbookExclusionSet(supabase);
      const existingIds = new Set(questions.reduce((acc: string[], g: any) => acc.concat(g.items.map((i:any) => i.question_id)), []));
      const uniqueSearchedMap = new Map<string, any>();
      allSearched.forEach((q: any) => {
        if (q && q.question_id) uniqueSearchedMap.set(String(q.question_id), q);
      });
      let newQs = Array.from(uniqueSearchedMap.values()).filter(
        q =>
          !existingIds.has(q.question_id) &&
          !q.is_hidden &&
          q.is_hidden !== 'Y' &&
          q.is_hidden !== 'true' &&
          matchesSourceCategoryFilter(q, addSourceCategories, mainExclusion)
      );
      
      // 랜덤하게 50개만 보여주기
      newQs = newQs.sort(() => 0.5 - Math.random()).slice(0, 50); 
      
      await hydrateMissingQuestionImages(supabase, newQs);
      await fetchDepthMappings(newQs); 
      await fetchParentSources(newQs);
      
      setNewSearchResults(newQs);
      
    } catch (e) { 
      alert("검색 중 오류가 발생했습니다."); 
    } finally { 
      setIsSearchingNew(false); 
    }
  };

  const addNewQuestionToExam = async (q: any) => {
    const cloned = JSON.parse(JSON.stringify(q));
    let bundleItems = await ensureCompleteSubQuestionBundles(supabase, [cloned], newSearchResults, false);
    if (bundleItems.length > 1) {
      await hydrateMissingQuestionImages(supabase, bundleItems);
      await fetchDepthMappings(bundleItems);
      await fetchParentSources(bundleItems);
      bundleItems = [...bundleItems].sort(compareSubQuestions);
    }
    const addedIds = new Set(bundleItems.map((item: any) => String(item.question_id)));
    const newGroup = {
      id: bundleItems.length > 1 ? `merged_${Date.now()}_${bundleItems[0].question_id}` : `single_${cloned.question_id}_${Date.now()}`,
      is_group: bundleItems.length > 1,
      is_merged_text: bundleItems.length > 1,
      items: bundleItems,
    };
    setQuestions((prev: any) => [...prev, newGroup]);
    setNewSearchResults((prev: any) => prev.filter((item: any) => !addedIds.has(String(item.question_id))));
    setTimeout(() => {
      const rightList = document.getElementById('right-problem-list');
      if (rightList) rightList.scrollTo({ top: rightList.scrollHeight, behavior: 'smooth' });
    }, 100);
  };

  const addTwinToExam = (newQ: any) => {
    if (!twinTarget) return;
    const cloned = JSON.parse(JSON.stringify(newQ));
    cloned.question_id = cloned.question_id + '_added_' + Date.now();
    const newQuestions = [...questions];
    newQuestions.splice(twinTarget.idx + 1, 0, { id: 'single_' + cloned.question_id, items: [cloned] });
    setQuestions(newQuestions);
    setTwinViewOpen(false);
  };

  const replaceWithTwin = (newQ: any) => {
    if (!twinTarget) return;
    const newQuestions = [...questions];
    newQuestions[twinTarget.idx].items[twinTarget.subIdx] = newQ;
    setQuestions(newQuestions);
    setTwinViewOpen(false);
  };

  return (
    <section className="w-[45%] bg-white border-r border-slate-200 flex flex-col relative z-10 shadow-[4px_0_15px_rgba(0,0,0,0.03)] min-h-0">
      {!twinViewOpen && (
        <div className="flex border-b border-slate-200 shrink-0">
          <button onClick={() => { setLeftTab("list"); setShowAddResults(false); }} className={`flex-1 py-3 text-[14px] font-bold transition-all ${leftTab === "list" ? "text-brand border-b-[3px] border-brand bg-white" : "text-slate-400 hover:text-slate-600 bg-slate-50 border-b-[3px] border-transparent hover:bg-white"}`}>문항 목록 / 통계</button>
          <button onClick={() => setLeftTab("add")} className={`flex-1 py-3 text-[14px] font-bold transition-all ${leftTab === "add" ? "text-brand border-b-[3px] border-brand bg-white" : "text-slate-400 hover:text-slate-600 bg-slate-50 border-b-[3px] border-transparent hover:bg-white"}`}>새 문제 추가</button>
        </div>
      )}

      {/* 탭 1: 문항 목록 및 통계 */}
      {leftTab === "list" && !twinViewOpen && (
        <div className="flex-1 flex flex-col overflow-hidden bg-white min-h-0">
          <div className="px-6 py-5 shrink-0 border-b border-slate-200 bg-white">
            <div className="flex justify-between items-end mb-4">
              <span className="text-slate-800 font-bold text-lg">📊 출제 통계 요약</span>
              <div className="text-right">
                <span className="text-slate-400 font-bold text-sm">학습지 문제 수</span>
                <span className="text-3xl font-bold text-brand ml-2">
                  {questions.length}<span className="text-base text-slate-500 ml-1">제</span>
                </span>
                {questions.reduce((acc: number, g: any) => acc + (g.items?.length || 1), 0) !== questions.length && (
                  <div className="text-[11px] font-bold text-slate-400 mt-0.5">
                    비병합 개별 기준 총 {questions.reduce((acc: number, g: any) => acc + (g.items?.length || 1), 0)}문항
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-around items-stretch h-28 px-4 pb-2 mt-2 border-b border-slate-100">
              {stats.map((st, i) => {
                const colors = ["bg-slate-300 text-slate-400", "bg-sky-400 text-sky-500", "bg-blue-500 text-blue-600", "bg-indigo-500 text-indigo-500", "bg-rose-500 text-rose-500"];
                const labelColors = ["text-slate-500", "text-sky-600", "text-blue-700", "text-indigo-600", "text-rose-600"];
                return (
                  <div key={st.label} className="flex flex-col items-center justify-end h-full w-1/5">
                    <span className={`text-xs font-bold ${colors[i].split(' ')[1]}`}>{st.pct}%</span>
                    <div className="flex-1 w-full flex flex-col justify-end items-center mt-1">
                      <div className={`w-8 rounded-t-md transition-all duration-700 shadow-inner ${colors[i].split(' ')[0]}`} style={{ height: `${st.hPct}%`, minHeight: '4px' }}></div>
                    </div>
                    <span className={`text-[13px] font-bold mt-1 ${labelColors[i]}`}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="relative flex-1 bg-slate-50 min-h-0">
            <div className="absolute inset-0 overflow-y-auto custom-scrollbar flex flex-col pb-6">
              <div className="sticky top-0 bg-slate-50/95 backdrop-blur-sm px-5 py-3 border-b border-slate-200 z-20 shadow-sm flex flex-col gap-2.5 shrink-0">
                <div className="flex justify-between items-center">
                  <h4 className="font-bold text-slate-700 text-sm">
                    문제 목록 및 순서
                    {questionListSearch.trim() && (
                      <span className="ml-1.5 text-xs font-bold text-brand">
                        ({filteredQuestionEntries.length}/{questions.length})
                      </span>
                    )}
                  </h4>
                  <span className="text-xs font-bold text-blue-500 bg-blue-100 border border-blue-200 px-2 py-1 rounded">✋ 드래그하거나 선택하여 이동</span>
                </div>

                {/* 🌟 문제 리스트 텍스트 검색 필터칸 */}
                <div className="relative">
                  <input
                    type="text"
                    value={questionListSearch}
                    onChange={(e) => setQuestionListSearch(e.target.value)}
                    placeholder="🔍 문제 텍스트, 단원/유형, 출처 교재, 페이지, 난이도 검색..."
                    className="w-full px-3 py-1.5 pr-8 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm"
                  />
                  {questionListSearch && (
                    <button
                      onClick={() => setQuestionListSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                      title="검색어 지우기"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap justify-between items-center gap-1.5 bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                  <label className="flex items-center space-x-1.5 px-1 cursor-pointer shrink-0">
                    <input type="checkbox" checked={questions.length > 0 && checkedIds.size === questions.length} onChange={(e) => toggleAllChecks(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-brand cursor-pointer" />
                    <span className="text-[12px] font-bold text-slate-600 whitespace-nowrap">전체 선택</span>
                  </label>
                  <div className="flex flex-wrap gap-1 items-center ml-auto">
                    <button onClick={moveSelectedToTop} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11.5px] font-bold rounded border border-slate-200 transition-colors whitespace-nowrap">↑ 맨 위로</button>
                    <button onClick={moveSelectedToBottom} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11.5px] font-bold rounded border border-slate-200 transition-colors whitespace-nowrap">↓ 맨 아래로</button>
                    
                    <button onClick={sortBySource} className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11.5px] font-bold rounded border border-blue-200 transition-colors shadow-sm whitespace-nowrap" title="교재 및 페이지/번호 순으로 전체 정렬">🔄 순서 정렬</button>
                    
                    <button onClick={autoMergeSubQuestions} className="px-2 py-1 bg-violet-50 hover:bg-violet-100 text-violet-700 text-[11.5px] font-bold rounded border border-violet-200 transition-colors shadow-sm whitespace-nowrap" title="서브문항 일괄 압축">✨ 자동 정렬/병합</button>
                    <button onClick={mergeSelected} className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[11.5px] font-bold rounded border border-indigo-200 transition-colors shadow-sm whitespace-nowrap">🔗 선택 병합</button>
                    <button onClick={unmergeAllQuestions} className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11.5px] font-bold rounded border border-amber-200 transition-colors shadow-sm whitespace-nowrap" title="묶여 있는 모든 서브문항 병합을 일괄 해제">✂️ 전체 병합 해제</button>
                    <button onClick={deleteSelected} className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[11.5px] font-bold rounded border border-rose-200 transition-colors whitespace-nowrap">🗑️ 삭제</button>
                  </div>
                </div>
              </div>
              <ul className="p-4 space-y-2">
                {filteredQuestionEntries.length === 0 ? (
                  <li className="text-center py-8 text-xs font-bold text-slate-400">
                    검색 조건에 맞는 문항이 없습니다.
                  </li>
                ) : (
                  filteredQuestionEntries.map(({ g, idx }: { g: any; idx: number }) => {
                    const repQ = g.items[0];
                    const diff = (repQ.difficulty || getDiffLabelByRate(repQ.solving_probability)).trim();
                    const typeName = getTypeName(repQ) + (g.items.length > 1 ? ` 외 ${g.items.length-1}` : '');
                    const depth5Name = getDepth5Name(repQ, depth5Map); 
                    let diffColor = "border-blue-500 text-blue-600";
                    if(diff === '최하') diffColor = "border-slate-400 text-slate-500";
                    else if(diff === '하') diffColor = "border-sky-400 text-sky-500";
                    else if(diff === '상') diffColor = "border-indigo-500 text-indigo-600";
                    else if(diff === '최상') diffColor = "border-rose-500 text-rose-600";

                    return (
                      <li key={g.id} 
                          draggable 
                          onDragStart={(e) => handleDragStart(e, idx)} 
                          onDragOver={handleDragOver} 
                          onDrop={(e) => handleDrop(e, idx)}
                          onClick={() => toggleCheck(g.id, !checkedIds.has(g.id))}
                          className={`flex items-center justify-between bg-white hover:bg-blue-50 p-2.5 rounded-xl border transition-all shadow-sm cursor-pointer select-none ${draggedIdx === idx ? 'opacity-50 border-blue-400' : 'border-slate-200'}`}>
                        <div className="flex items-center space-x-2 w-[55%] pointer-events-none">
                          
                          <input type="checkbox" checked={checkedIds.has(g.id)} readOnly className="w-4 h-4 rounded border-slate-300 accent-brand shrink-0" />
                          
                          <div className="p-1 text-slate-300 hover:text-blue-500 hover:bg-blue-100 rounded cursor-grab pointer-events-auto" 
                               title="드래그하여 순서 변경"
                               onClick={(e) => e.stopPropagation()}>
                             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                          </div>
                          
                          <span className="font-bold text-brand text-[15px] w-5 text-center cursor-pointer hover:underline pointer-events-auto" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  document.getElementById(`problem-card-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }}>
                            {idx + 1}
                          </span>
                          
                          <div className="flex items-center space-x-1.5 overflow-hidden pointer-events-none">
                            <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold border border-slate-200 whitespace-nowrap">{typeName}</span>
                            <span className={`text-[12px] font-bold px-1 border-l-2 ${diffColor}`}>{diff}</span>
                          </div>
                        </div>
                        
                        <div className="text-[12px] text-slate-600 font-bold truncate w-[45%] text-right cursor-pointer hover:underline pointer-events-auto" 
                             title={depth5Name} 
                             onClick={(e) => {
                               e.stopPropagation();
                               document.getElementById(`problem-card-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                             }}>
                          {depth5Name}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 탭 2: 새 문제 추가 검색 뷰 */}
      {leftTab === "add" && !twinViewOpen && (
        <div className="flex-1 flex flex-col bg-slate-50 transition-opacity min-h-0">
          {!showAddResults ? (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <div className="px-6 py-4 bg-white border-b border-slate-200 flex justify-between items-center shrink-0 shadow-sm">
                <div>
                  <h3 className="font-bold text-lg flex items-center gap-2">🔍 새로운 문항 검색</h3>
                  <p className="text-xs text-slate-400 font-bold mt-1">단원이나 유형을 선택하여 문항을 검색하세요.</p>
                </div>
                <button onClick={searchNewQuestions} className="px-5 py-2.5 bg-brand text-white text-sm font-bold rounded-lg shadow-sm hover:bg-blue-900 transition-colors">문항 검색하기</button>
              </div>

              {/* 🌟 1. 검색 필터 UI 패널 */}
              <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 shrink-0 shadow-inner space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-3.5 py-2 rounded-lg border border-slate-200">
                  <span className="text-xs font-bold text-slate-600">출처 교재 구분 필터</span>
                  <div className="flex flex-wrap items-center gap-3.5">
                    <label className="flex items-center space-x-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={addSourceCategories.extra}
                        onChange={(e) => setAddSourceCategories((prev) => ({ ...prev, extra: e.target.checked }))}
                        className="w-3.5 h-3.5 accent-brand rounded border-slate-300 cursor-pointer"
                      />
                      <span className="text-slate-700 font-bold text-xs">추가문제</span>
                    </label>
                    <label className="flex items-center space-x-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={addSourceCategories.twinSimilar}
                        onChange={(e) => setAddSourceCategories((prev) => ({ ...prev, twinSimilar: e.target.checked }))}
                        className="w-3.5 h-3.5 accent-brand rounded border-slate-300 cursor-pointer"
                      />
                      <span className="text-slate-700 font-bold text-xs">쌍둥이/유사</span>
                    </label>
                    <div className="h-3.5 w-[1px] bg-slate-300" />
                    <label className="flex items-center space-x-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={addSourceCategories.excludeMain}
                        onChange={(e) => setAddSourceCategories((prev) => ({ ...prev, excludeMain: e.target.checked }))}
                        className="w-3.5 h-3.5 accent-rose-600 rounded border-slate-300 cursor-pointer"
                      />
                      <span className="text-slate-700 font-bold text-xs">주교재 제외</span>
                    </label>
                    <label className="flex items-center space-x-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={addSourceCategories.excludeWorkbook}
                        onChange={(e) => setAddSourceCategories((prev) => ({ ...prev, excludeWorkbook: e.target.checked }))}
                        className="w-3.5 h-3.5 accent-rose-600 rounded border-slate-300 cursor-pointer"
                      />
                      <span className="text-slate-700 font-bold text-xs">워크북 제외</span>
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">교재명 키워드 필터</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" placeholder="단어 1 (예: 쎈)" 
                        value={addBookName1} onChange={(e) => setAddBookName1(e.target.value)} 
                        className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm font-bold focus:outline-none focus:border-brand bg-white" 
                      />
                      <input 
                        type="text" placeholder="단어 2 (옵션)" 
                        value={addBookName2} onChange={(e) => setAddBookName2(e.target.value)} 
                        className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm font-bold focus:outline-none focus:border-brand bg-white" 
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">페이지 번호 범위 필터</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="number" placeholder="시작" min="1"
                        value={addPageStart} onChange={(e) => setAddPageStart(e.target.value)} 
                        className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm font-bold focus:outline-none focus:border-brand text-center bg-white" 
                      />
                      <span className="text-slate-400 font-bold">~</span>
                      <input 
                        type="number" placeholder="끝" min="1"
                        value={addPageEnd} onChange={(e) => setAddPageEnd(e.target.value)} 
                        className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm font-bold focus:outline-none focus:border-brand text-center bg-white" 
                      />
                      <span className="text-slate-500 font-bold text-sm shrink-0">p</span>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">문제 텍스트 키워드 필터</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="🔍 문제 지문 내 포함된 텍스트로 검색 (옵션)..."
                      value={addQuestionText}
                      onChange={(e) => setAddQuestionText(e.target.value)}
                      className="w-full px-3 py-1.5 pr-8 border border-slate-300 rounded text-sm font-bold focus:outline-none focus:border-brand bg-white"
                    />
                    {addQuestionText && (
                      <button
                        onClick={() => setAddQuestionText("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {!addMasterData ? (
                <div className="flex-1 flex items-center justify-center text-slate-400 font-bold">분류 체계를 불러오는 중...</div>
              ) : (
                <>
                  <div className="shrink-0 border-b border-slate-200 bg-white shadow-sm z-10">
                    <div className="flex px-4 pt-4 space-x-5 border-b border-slate-100 overflow-x-auto whitespace-nowrap no-scrollbar">
                      {Object.keys(addMasterData).sort(sortD1).map(d1 => (
                        <button key={d1} onClick={() => setCurrentAddD1(d1)} className={`pb-3 px-2 text-base font-bold border-b-4 transition-colors ${currentAddD1 === d1 ? 'border-brand text-brand' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>{d1}</button>
                      ))}
                    </div>
                    <div className="flex px-4 py-3 gap-2 flex-wrap">
                      {addMasterData[currentAddD1] && Object.keys(addMasterData[currentAddD1].children).sort(sortNumeric).map(d2 => (
                        <button key={d2} onClick={() => setCurrentAddD2(d2)} className={`w-[110px] flex justify-center items-center py-2 rounded-full text-[14px] font-bold transition-colors shrink-0 ${currentAddD2 === d2 ? 'bg-slate-800 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{d2}</button>
                      ))}
                    </div>
                  </div>

                  <div className="relative flex-1 bg-white min-h-0">
                    <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6">
                      {(addMasterData[currentAddD1] && addMasterData[currentAddD1].children[currentAddD2]) ? (
                        Object.keys(addMasterData[currentAddD1].children[currentAddD2].children)
                        .sort((a, b) => compareNodes(a, addMasterData[currentAddD1].children[currentAddD2].children[a], b, addMasterData[currentAddD1].children[currentAddD2].children[b]))
                        .map(k => (
                          <AddTreeNode key={k} nodeKey={k} node={addMasterData[currentAddD1].children[currentAddD2].children[k]} depth={3} selectedAddIds={addSelectedCatIds} 
                            toggleAddItem={(idOrIds: string | string[], chk: boolean) => { const targetIds = Array.isArray(idOrIds) ? idOrIds : [idOrIds]; setAddSelectedCatIds((prev:any) => { const n = new Set(prev); targetIds.forEach((id: string) => { if (!id) return; chk ? n.add(id) : n.delete(id); }); return n; }); }} 
                            toggleAddFolder={(node: any, chk: boolean) => { const ids = getAllAddIds(node); setAddSelectedCatIds((prev:any) => { const n = new Set(prev); ids.forEach((id: string) => chk ? n.add(id) : n.delete(id)); return n; }); }} />
                        ))
                      ) : (
                        <div className="text-center py-10 text-slate-400 font-bold">해당 학년/학기에 등록된 단원 정보가 없습니다.</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <div className="px-6 py-4 bg-white border-b border-slate-200 flex flex-col gap-3 shrink-0 shadow-sm">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      📑 문항 검색 결과
                      <span className="text-brand bg-blue-50 px-2 py-0.5 rounded text-sm">
                        {searchResultFilter.trim() ? `${filteredNewSearchResults.length} / ${newSearchResults.length}` : newSearchResults.length}
                      </span>
                    </h3>
                  </div>
                  <button onClick={() => setShowAddResults(false)} className="px-4 py-2 bg-slate-100 text-slate-600 text-sm font-bold rounded-lg border border-slate-300 hover:bg-slate-200 transition-colors">⟵ 다시 선택</button>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={searchResultFilter}
                    onChange={(e) => setSearchResultFilter(e.target.value)}
                    placeholder="🔍 검색된 문제 리스트 내 텍스트, 출처, 유형 필터..."
                    className="w-full px-3 py-1.5 pr-8 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-brand focus:ring-1 focus:ring-brand"
                  />
                  {searchResultFilter && (
                    <button
                      onClick={() => setSearchResultFilter("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <div className="relative flex-1 bg-slate-50 min-h-0">
                <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6 space-y-4">
                  {isSearchingNew ? <div className="text-center py-20 font-bold text-slate-400">문제를 검색 중입니다...</div> :
                   filteredNewSearchResults.length === 0 ? <div className="text-center py-10 font-bold text-slate-400">조건에 맞는 새로운 문항이 없습니다.</div> :
                   filteredNewSearchResults.map((q: any) => {
                     const d = q.difficulty || getDiffLabelByRate(q.solving_probability);
                     const d6 = getDepth6Name(q, depth6Map);
                     const subD6 = q.sub_taxonomy_id && q.sub_taxonomy_id !== q.taxonomy_id ? getSubDepth6Name(q, depth6Map) : "";
                     let diffColor = "text-blue-500 bg-blue-50 border-blue-100";
                     if(d === '최하') diffColor = "text-slate-500 bg-slate-100 border-slate-200";
                     else if(d === '하') diffColor = "text-sky-500 bg-sky-50 border-sky-100";
                     else if(d === '상') diffColor = "text-indigo-500 bg-indigo-50 border-indigo-100";
                     else if(d === '최상') diffColor = "text-rose-500 bg-rose-50 border-rose-100";

                     return (
                       <div key={q.question_id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm relative hover:border-brand transition-colors group">
                         <div className="flex justify-between items-start mb-3 border-b border-slate-100 pb-3">
                           <div className="flex flex-col gap-1.5">
                             <div className="flex gap-1.5 items-center flex-wrap">
                               <span className="text-xs font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">{getTypeName(q)}</span>
                               <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${diffColor}`}>{d}</span>
                               <span className="text-xs font-bold text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded">{d6}</span>
                               {subD6 && (
                                 <span className="text-xs font-bold text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">🧭 서브: {subD6}</span>
                               )}
                             </div>
                             {/* 검색 결과에서도 출처(교재/페이지) 표시 */}
                             <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5 mt-1">
                               <span className="bg-slate-100 text-slate-500 px-1.5 py-[2px] rounded border border-slate-200 leading-none">출처</span>
                               <span className="leading-none mt-0.5">
                                 {q.source_book_name || q.book_name || q.pdf_source || '출처 없음'}
                                 {q.final_printed_page || q.detected_page_num ? ` p.${String(q.final_printed_page || q.detected_page_num).replace(/p/gi, '').trim()}` : ''}
                                 {q.question_number ? ` ${String(q.question_number).replace(/번/g, '').trim()}번` : ''}
                               </span>
                             </div>
                           </div>
                           <button onClick={() => addNewQuestionToExam(q)} className="bg-brand hover:bg-blue-900 text-white text-[12px] font-bold px-4 py-2 rounded shadow-sm transition-colors shrink-0">➕ 추가</button>
                         </div>
                         <div className="font-myungjo text-[15px] font-semibold leading-[2.0] text-slate-800 break-keep" dangerouslySetInnerHTML={{ __html: formatText(q.question) }} />
                         {q.image_url && getCleanUrl(q.image_url) && <img src={getCleanUrl(q.image_url)} className="max-h-32 mt-3 mix-blend-multiply border border-slate-200 rounded object-contain" alt="" />}
                         {q.image_2_url && getCleanUrl(q.image_2_url) && <img src={getCleanUrl(q.image_2_url)} className="max-h-32 mt-2 mix-blend-multiply border border-slate-200 rounded object-contain" alt="" />}
                         {q.question_2 && String(q.question_2).trim() !== '' && String(q.question_2) !== 'null' && (
                           <div className="font-myungjo text-[15px] font-semibold leading-[2.0] text-slate-800 break-keep mt-2" dangerouslySetInnerHTML={{ __html: formatText(q.question_2) }} />
                         )}
                       </div>
                     );
                   })
                  }
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 쌍둥이 문제 검색 결과 뷰 */}
      {twinViewOpen && (
        <div className="absolute inset-0 flex flex-col bg-slate-50 z-30 min-h-0">
          <div className="bg-indigo-600 text-white px-6 py-4 flex justify-between items-center shrink-0 shadow-md">
            <div>
              <h3 className="font-bold text-lg flex items-center">
                <span className="bg-white text-indigo-700 px-2 py-0.5 rounded mr-2 text-sm">{twinTarget ? twinTarget.idx + 1 : 0}번</span> 쌍둥이/유사 문항 검색
              </h3>
              <p className="text-indigo-200 text-xs mt-1">원하는 문항을 우측 시험지에 즉시 반영할 수 있습니다.</p>
            </div>
            <button onClick={() => setTwinViewOpen(false)} className="px-4 py-2 bg-indigo-800 text-white text-sm font-bold rounded-lg border border-indigo-500 hover:bg-indigo-900">✕ 돌아가기</button>
          </div>
          <div className="relative flex-1 bg-slate-50 min-h-0">
            <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6 space-y-4">
              {isSearchingTwin ? <div className="text-center py-20 font-bold text-slate-400">유사 문항을 검색 중입니다...</div> : 
               (twinPoolTwins.length === 0 && twinPoolSimilars.length === 0) ? <div className="text-center py-20 font-bold text-rose-500">추천할 유사 문항이 없습니다.</div> :
               [...twinPoolTwins, ...twinPoolSimilars].map((altQ: any) => {
                 const isTwin = twinPoolTwins.some((t:any) => t.question_id === altQ.question_id);
                 return (
                  <div key={altQ.question_id} className="bg-white border-2 border-slate-200 rounded-xl p-5 shadow-sm hover:border-indigo-400 transition-all">
                    <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                      <div className="flex items-center space-x-2">
                        {isTwin ? <span className="text-xs bg-rose-100 text-rose-700 border border-rose-200 px-2 py-0.5 rounded font-bold shadow-sm">🚀 쌍둥이</span> : <span className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded font-bold shadow-sm">💡 유사</span>}
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-bold shadow-sm shrink-0">{getTypeName(altQ)}</span>
                        <span className="text-xs text-slate-500 font-bold border border-slate-200 px-1 rounded">{altQ.difficulty || '중'}</span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => addTwinToExam(altQ)} className="px-3 py-1.5 bg-emerald-600 text-white text-[13px] font-bold rounded shadow-sm hover:bg-emerald-700">이 문항 추가</button>
                        <button onClick={() => replaceWithTwin(altQ)} className="px-3 py-1.5 bg-indigo-600 text-white text-[13px] font-bold rounded shadow-sm hover:bg-indigo-700">이 문항으로 교체</button>
                      </div>
                    </div>
                    <div className="mb-2">{renderParentRelations(altQ, parentSourceMap)}</div>
                    <div className="font-myungjo font-semibold text-[15px] text-slate-800 leading-[2.0] break-keep" dangerouslySetInnerHTML={{ __html: formatText(altQ.question) }}></div>
                    {altQ.image_url && getCleanUrl(altQ.image_url) && <img src={getCleanUrl(altQ.image_url)} className="max-h-32 mt-3 mix-blend-multiply border border-slate-200 rounded object-contain" alt="Q" />}
                    {altQ.image_2_url && getCleanUrl(altQ.image_2_url) && <img src={getCleanUrl(altQ.image_2_url)} className="max-h-32 mt-2 mix-blend-multiply border border-slate-200 rounded object-contain" alt="Q2" />}
                    {altQ.question_2 && String(altQ.question_2).trim() !== '' && String(altQ.question_2) !== 'null' && (
                      <div className="font-myungjo font-semibold text-[15px] text-slate-800 leading-[2.0] break-keep mt-2" dangerouslySetInnerHTML={{ __html: formatText(altQ.question_2) }}></div>
                    )}
                  </div>
                 );
               })
              }
            </div>
          </div>
        </div>
      )}
    </section>
  );
}