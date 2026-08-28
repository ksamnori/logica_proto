// src/app/(dashboard)/mapper/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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

const getTaxParts = (taxId: string | null | undefined) => {
  if (!taxId || taxId === '미분류') return [];
  return taxId.split('-');
};

// 🌟 업데이트됨: 괄호 제거 및 다중 서브 문항 완벽 병합 처리
const formatQNum = (qNum: string | number, subNum?: string | number) => {
  // 1. 본 문항 번호 공백 및 기존 -0 꼬리표 1차 제거
  let numStr = String(qNum || "").trim().replace(/-0$/, '');
  
  if (subNum !== undefined && subNum !== null && String(subNum).trim() !== "") {
    // 2. 괄호 기호만 제거하여 순수 번호 추출 (예: "(1)" -> "1")
    const cleanSubNum = String(subNum).replace(/[()]/g, '').trim();
    if (cleanSubNum !== "") {
      numStr = `${numStr}-${cleanSubNum}`;
    }
  }
  
  // 3. 서브 번호가 0이어서 최종 결합이 -0으로 끝나면 다시 제거 (예: 2-2-0 -> 2-2)
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

export default function VisualMapperPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [textbooks, setTextbooks] = useState<any[]>([]);
  
  const [workbooks, setWorkbooks] = useState<string[]>([]); 
  
  const [wbFilterText1, setWbFilterText1] = useState("");
  const [wbFilterText2, setWbFilterText2] = useState("");

  const [selectedMainBookId, setSelectedMainBookId] = useState("");
  const [selectedWbSource1, setSelectedWbSource1] = useState("");
  const [selectedWbSource2, setSelectedWbSource2] = useState("");

  const [mainQuestions, setMainQuestions] = useState<any[]>([]);
  const [wbQuestions1, setWbQuestions1] = useState<any[]>([]);
  const [wbQuestions2, setWbQuestions2] = useState<any[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);

  const [selectedMainIds, setSelectedMainIds] = useState<string[]>([]);
  const [selectedWbIds, setSelectedWbIds] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string[]>>({});

  const mathJaxRef = useRef<boolean>(false);

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

      if (!error && data && data.allowed_menus.includes("/mapper")) {
        setIsAuthorized(true);
      } else {
        alert("⛔ 교재 매핑 툴 접근 권한이 없습니다. 권한 관리 페이지에서 허용해주세요.");
        router.replace("/home");
      }
    };
    checkAccess();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) {
      loadBooks();
      loadMathJax();
    }
  }, [isAuthorized]);

  useEffect(() => {
    if (selectedMainBookId) fetchMainQuestions(selectedMainBookId);
    else { setMainQuestions([]); setMappings({}); setSelectedMainIds([]); setSelectedWbIds([]); }
  }, [selectedMainBookId]);

  useEffect(() => {
    if (selectedWbSource1) fetchWbQuestions(selectedWbSource1, setWbQuestions1);
    else setWbQuestions1([]);
  }, [selectedWbSource1]);

  useEffect(() => {
    if (selectedWbSource2) fetchWbQuestions(selectedWbSource2, setWbQuestions2);
    else setWbQuestions2([]);
  }, [selectedWbSource2]);

  useEffect(() => {
    const renderMath = () => {
      if ((window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch((err: any) => console.log("MathJax 에러:", err));
      }
    };
    const timer = setTimeout(renderMath, 150);
    return () => clearTimeout(timer);
  }, [mainQuestions, wbQuestions1, wbQuestions2, mappings, selectedMainIds]);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] }, startup: { typeset: false } };
      const script = document.createElement("script"); script.id = "MathJax-script"; script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"; script.async = true;
      document.head.appendChild(script);
    }
  };

  const loadBooks = async () => {
    const tbData = await fetchAllRows('textbook', 'book_id, title');
    if (tbData) {
      setTextbooks(tbData.sort((a, b) => a.title.localeCompare(b.title, 'ko', { numeric: true })));
    }

    const qbData = await fetchAllRows('question_db', 'source_book_name');
    if (qbData) {
      const uniqueList = Array.from(new Set(qbData.map(q => q.source_book_name))).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
      setWorkbooks(uniqueList as string[]);
    }
  };

  const fetchMainQuestions = async (mainId: string) => {
    setIsLoading(true);
    try {
      const { data: mainData } = await supabase.from("textbook_question")
        .select("*").eq("book_id", mainId);
      
      const sortedMainData = (mainData || []).sort((a, b) => {
        const pageA = parseInt(String(a.page_number));
        const pA = isNaN(pageA) ? 99999 : pageA;
        const pageB = parseInt(String(b.page_number));
        const pB = isNaN(pageB) ? 99999 : pageB;
        if (pA !== pB) return pA - pB;

        const dispA = formatQNum(a.question_number, a.sub_num);
        const dispB = formatQNum(b.question_number, b.sub_num);
        return compareNatural(dispA, dispB);
      });
      
      const initialMap: Record<string, string[]> = {};
      sortedMainData.forEach(mq => {
        if (mq.similar_tq_ids) {
          try {
            let parsed = typeof mq.similar_tq_ids === 'string' ? JSON.parse(mq.similar_tq_ids) : mq.similar_tq_ids;
            if (Array.isArray(parsed) && parsed.length > 0) {
              initialMap[mq.tq_id.toString()] = parsed.map(String);
            }
          } catch (e) {}
        }
      });
      setMappings(initialMap);
      setMainQuestions(sortedMainData);
      setSelectedMainIds([]); setSelectedWbIds([]);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const fetchWbQuestions = async (source: string, setter: React.Dispatch<React.SetStateAction<any[]>>) => {
    setIsLoading(true);
    try {
      const { data: wbData } = await supabase.from("question_db").select("*").eq("source_book_name", source);

      const sortedWbData = (wbData || []).sort((a, b) => {
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
      setter(sortedWbData);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const handleAiMatch = () => {
    if (mainQuestions.length === 0) {
      return alert("기준이 될 본교재를 먼저 선택해주세요.");
    }
    if (wbQuestions1.length === 0 && wbQuestions2.length === 0) {
      return alert("부교재를 하나 이상 선택해주세요.");
    }

    const allWbQs = [...wbQuestions1, ...wbQuestions2];
    const uniqueWbQs = Array.from(new Map(allWbQs.map(item => [item.question_id, item])).values());

    const newMappings = { ...mappings };
    let match7DepthCount = 0;
    let match6DepthCount = 0;

    mainQuestions.forEach(mq => {
      const matchedWbIds = new Set(newMappings[mq.tq_id.toString()] || []);
      
      const mqNumStr = String(mq.question_number || "");
      const mqBaseNum = mqNumStr.replace(/[^0-9]/g, '');
      const mqBaseText = mqNumStr.replace(/[0-9\-]/g, '').trim(); 
      const mqTaxParts = getTaxParts(mq.taxonomy_id);

      uniqueWbQs.forEach(wq => {
        if (matchedWbIds.has(wq.question_id)) return;

        const wqNumStr = String(wq.question_number || "");
        const wqBaseNum = wqNumStr.split('-')[0].replace(/[^0-9]/g, '');
        const wqBaseText = wqNumStr.split('-')[0].replace(/[0-9\-]/g, '').trim();
        const wqTaxParts = getTaxParts(wq.taxonomy_id);

        let isTaxonomyMatch = false;
        let matchedDepth = 0;

        if (mqTaxParts.length > 0 && wqTaxParts.length > 0) {
          if (mqTaxParts.length >= 7 && wqTaxParts.length >= 7) {
            if (mqTaxParts.slice(0, 7).join('-') === wqTaxParts.slice(0, 7).join('-')) {
              isTaxonomyMatch = true;
              matchedDepth = 7;
            }
          } else if (mqTaxParts.length >= 6 && wqTaxParts.length >= 6) {
            if (mqTaxParts.slice(0, 6).join('-') === wqTaxParts.slice(0, 6).join('-')) {
              isTaxonomyMatch = true;
              matchedDepth = 6;
            }
          }
        }

        const isNumberMatch = mqBaseNum !== "" && wqBaseNum !== "" && (mqBaseNum === wqBaseNum);
        const isTextMatch = mqBaseText === wqBaseText;
        const isExactStringMatch = (!mqBaseNum || !wqBaseNum) && (mqNumStr.trim() === wqNumStr.trim());

        if (isTaxonomyMatch && ((isNumberMatch && isTextMatch) || isExactStringMatch)) {
          matchedWbIds.add(wq.question_id);
          if (matchedDepth === 7) match7DepthCount++;
          else if (matchedDepth === 6) match6DepthCount++;
        }
      });

      if (matchedWbIds.size > 0) {
        newMappings[mq.tq_id.toString()] = Array.from(matchedWbIds);
      }
    });

    setMappings(newMappings);
    alert(`🤖 AI [Depth-7/6] 초정밀 매칭 완료!\n\n✅ 7-Depth 일치: ${match7DepthCount}건\n✅ 6-Depth 일치: ${match6DepthCount}건\n\n(💡 우측 상단의 'DB에 연결 저장'을 눌러야 확정됩니다.)`);
  };

  const handleMainClick = (idStr: string) => {
    setSelectedMainIds(prev => {
      const isSelected = prev.includes(idStr);
      const newSelected = isSelected ? prev.filter(id => id !== idStr) : [...prev, idStr];
      
      if (newSelected.length === 1) {
        setSelectedWbIds(mappings[newSelected[0]] || []);
      } else if (newSelected.length === 0) {
        setSelectedWbIds([]);
      }
      return newSelected;
    });
  };

  const handleFocusFamily = (tqIdStr: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    setSelectedMainIds([tqIdStr]);
    const similarWbIds = mappings[tqIdStr] || [];
    setSelectedWbIds(similarWbIds);
    
    const mainQ = mainQuestions.find(mq => mq.tq_id.toString() === tqIdStr);
    const mainQuestionId = mainQ ? String(mainQ.question_id).trim() : null;

    setTimeout(() => {
      const mainEl = document.getElementById(`main-q-${tqIdStr}`);
      if (mainEl) mainEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

      if (mainQuestionId) {
        const targetWb1 = wbQuestions1.find(wq => 
          similarWbIds.includes(wq.question_id) || 
          (wq.parent_question_id && String(wq.parent_question_id).trim() === mainQuestionId)
        );
        if (targetWb1) {
          const wb1El = document.getElementById(`wb1-q-${targetWb1.question_id}`);
          if (wb1El) wb1El.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        
        const targetWb2 = wbQuestions2.find(wq => 
          similarWbIds.includes(wq.question_id) || 
          (wq.parent_question_id && String(wq.parent_question_id).trim() === mainQuestionId)
        );
        if (targetWb2) {
          const wb2El = document.getElementById(`wb2-q-${targetWb2.question_id}`);
          if (wb2El) wb2El.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }, 100);
  };

  const onFindTwinParent = (parentQId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const parentMq = mainQuestions.find(mq => String(mq.question_id).trim() === String(parentQId).trim());
    
    if (parentMq) {
      handleFocusFamily(parentMq.tq_id.toString());
    } else {
      alert("해당 부모(본교재) 문항이 현재 선택된 본교재 내에 없거나 아직 로드되지 않았습니다.");
    }
  };

  const handleWbClick = (uuid: string) => {
    if (selectedMainIds.length === 0) return alert("💡 묶어줄 '본교재 문항'을 먼저 한 개 이상 클릭해주세요!");
    setSelectedWbIds(prev => prev.includes(uuid) ? prev.filter(id => id !== uuid) : [...prev, uuid]);
  };

  const handleToggleSelectAllMain = () => {
    if (mainQuestions.length === 0) return;
    const allMainIds = mainQuestions.map(q => q.tq_id.toString());
    const isAllSelected = allMainIds.every(id => selectedMainIds.includes(id));
    
    if (isAllSelected) {
      setSelectedMainIds(prev => prev.filter(id => !allMainIds.includes(id)));
      setSelectedWbIds([]);
    } else {
      setSelectedMainIds(Array.from(new Set([...selectedMainIds, ...allMainIds])));
    }
  };

  const handleToggleSelectAllWb1 = () => {
    if (wbQuestions1.length === 0) return;
    if (selectedMainIds.length === 0) return alert("💡 묶어줄 '본교재 문항'을 먼저 한 개 이상 클릭해주세요!");
    
    const allWb1Ids = wbQuestions1.map(q => q.question_id);
    const isAllSelected = allWb1Ids.every(id => selectedWbIds.includes(id));

    if (isAllSelected) {
      setSelectedWbIds(prev => prev.filter(id => !allWb1Ids.includes(id)));
    } else {
      setSelectedWbIds(prev => Array.from(new Set([...prev, ...allWb1Ids])));
    }
  };

  const handleToggleSelectAllWb2 = () => {
    if (wbQuestions2.length === 0) return;
    if (selectedMainIds.length === 0) return alert("💡 묶어줄 '본교재 문항'을 먼저 한 개 이상 클릭해주세요!");
    
    const allWb2Ids = wbQuestions2.map(q => q.question_id);
    const isAllSelected = allWb2Ids.every(id => selectedWbIds.includes(id));

    if (isAllSelected) {
      setSelectedWbIds(prev => prev.filter(id => !allWb2Ids.includes(id)));
    } else {
      setSelectedWbIds(prev => Array.from(new Set([...prev, ...allWb2Ids])));
    }
  };

  const handleLink = () => {
    if (selectedMainIds.length === 0) return;
    
    setMappings(prev => {
      const newMap = { ...prev };
      selectedMainIds.forEach(mId => {
        newMap[mId] = Array.from(new Set([...(newMap[mId] || []), ...selectedWbIds]));
      });
      return newMap;
    });
    
    moveToNextMainQuestion();
  };

  const handleUnlink = (mainIdStr: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMappings(prev => { const newMap = { ...prev }; delete newMap[mainIdStr]; return newMap; });
    if (selectedMainIds.includes(mainIdStr) && selectedMainIds.length === 1) {
      setSelectedWbIds([]);
    }
  };

  const handleTwinLink = async () => {
    if (selectedMainIds.length === 0 || selectedWbIds.length === 0) return;
    
    if (selectedMainIds.length > 1) {
      return alert("⚠️ 1:N 쌍둥이 처리는 오직 '1개의 본교재 문항'을 기준으로만 가능합니다.\n본교재를 1개만 체크한 상태에서 진행해주세요.");
    }

    const mainIdToLink = selectedMainIds[0];

    if (!confirm(`선택한 ${selectedWbIds.length}개의 문항을 본교재 문항의 '쌍둥이(자식)'로 영구 편입하시겠습니까?\n\n⚠️ 주의: 이 작업은 즉시 마스터 DB에 반영됩니다.`)) return;

    setIsLoading(true);
    try {
      const mainQ = mainQuestions.find(q => q.tq_id.toString() === mainIdToLink);
      if (!mainQ) throw new Error("본교재 문항을 찾을 수 없습니다.");

      const { error } = await supabase.from('question_db')
        .update({
           parent_question_id: mainQ.question_id,
           derivation_type: 'TWIN'
        })
        .in('question_id', selectedWbIds);

      if (error) throw error;

      setMappings(prev => {
        const newMap = { ...prev };
        for (const key in newMap) {
          newMap[key] = newMap[key].filter(id => !selectedWbIds.includes(id));
        }
        return newMap;
      });

      alert("✅ 쌍둥이 편입이 완료되었습니다!");
      
      if (selectedWbSource1) fetchWbQuestions(selectedWbSource1, setWbQuestions1);
      if (selectedWbSource2) fetchWbQuestions(selectedWbSource2, setWbQuestions2);

      moveToNextMainQuestion();

    } catch (e: any) {
      alert("쌍둥이 묶기 실패: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMultiTwinLink = async () => {
    if (selectedMainIds.length === 0 || selectedWbIds.length === 0) return;

    if (selectedMainIds.length !== selectedWbIds.length) {
      return alert(`좌측 본교재 ${selectedMainIds.length}개, 우측 부교재 ${selectedWbIds.length}개가 선택되었습니다.\n1:1 매칭을 위해서는 좌우 선택 개수가 동일해야 합니다.`);
    }

    if (!confirm(`선택하신 ${selectedMainIds.length}쌍의 문항을 클릭한 순서대로 각각 1:1 쌍둥이로 영구 편입하시겠습니까?`)) return;

    setIsLoading(true);
    try {
      let errorMessages = [];

      for (let i = 0; i < selectedMainIds.length; i++) {
        const tqIdStr = selectedMainIds[i];
        const wbId = selectedWbIds[i];
        const mainQ = mainQuestions.find(q => q.tq_id.toString() === tqIdStr);

        if (!mainQ) {
          errorMessages.push(`본교재 문항(${tqIdStr}) 데이터 누락`);
          continue;
        }

        const { error } = await supabase.from('question_db')
          .update({
            parent_question_id: mainQ.question_id,
            derivation_type: 'TWIN'
          })
          .eq('question_id', wbId);

        if (error) {
          errorMessages.push(error.message);
        }
      }

      if (errorMessages.length > 0) {
        console.error("DB 업데이트 에러 발생:", errorMessages);
        throw new Error("일부 항목 저장 중 오류가 발생했습니다: " + errorMessages[0]);
      }

      setMappings(prev => {
        const newMap = { ...prev };
        for (const key in newMap) {
          newMap[key] = newMap[key].filter(id => !selectedWbIds.includes(id));
        }
        return newMap;
      });

      alert("✅ 1:1 다중 쌍둥이 편입이 완료되었습니다!");
      
      if (selectedWbSource1) fetchWbQuestions(selectedWbSource1, setWbQuestions1);
      if (selectedWbSource2) fetchWbQuestions(selectedWbSource2, setWbQuestions2);

      setSelectedMainIds([]);
      setSelectedWbIds([]);

    } catch (e: any) {
      alert("1:1 쌍둥이 묶기 실패: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnlinkTwin = async (wbQuestionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("이 문항의 쌍둥이 종속 관계를 해제하시겠습니까? (원본 유실로 처리됩니다)")) return;
    setIsLoading(true);
    try {
      const { error } = await supabase.from('question_db')
        .update({ parent_question_id: null })
        .eq('question_id', wbQuestionId);
      if (error) throw error;
      
      if (selectedWbSource1) fetchWbQuestions(selectedWbSource1, setWbQuestions1);
      if (selectedWbSource2) fetchWbQuestions(selectedWbSource2, setWbQuestions2);
    } catch(err: any) {
      alert("해제 실패: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const moveToNextMainQuestion = () => {
    if (selectedMainIds.length === 0) return;
    
    const lastSelectedId = selectedMainIds[selectedMainIds.length - 1];
    const currentIndex = mainQuestions.findIndex(q => q.tq_id.toString() === lastSelectedId);
    
    if (currentIndex >= 0 && currentIndex < mainQuestions.length - 1) {
      const nextId = mainQuestions[currentIndex + 1].tq_id.toString();
      handleFocusFamily(nextId);
    } else {
      setSelectedMainIds([]); setSelectedWbIds([]);
    }
  };

  const handleSaveToDB = async () => {
    if (!selectedMainBookId) return alert("저장할 교재를 선택해주세요.");
    if (!confirm(`총 ${Object.keys(mappings).length}개의 본교재 문항에 설정된 수평(과제용) 연결을 저장하시겠습니까?\n(쌍둥이 편입은 이 버튼을 누르지 않아도 이미 저장되어 있습니다.)`)) return;

    setIsLoading(true);
    try {
      const updates = Object.entries(mappings).map(([mainIdStr, wbIdsArr]) => {
        return supabase.from('textbook_question').update({ similar_tq_ids: wbIdsArr }).eq('tq_id', Number(mainIdStr));
      });

      const mappedMainIds = Object.keys(mappings);
      const unmappedUpdates = mainQuestions.filter(mq => !mappedMainIds.includes(mq.tq_id.toString())).map(mq => {
         return supabase.from('textbook_question').update({ similar_tq_ids: [] }).eq('tq_id', mq.tq_id);
      });

      await Promise.all([...updates, ...unmappedUpdates]);
      alert("✅ 완벽하게 3단 수평 매핑 데이터가 DB에 저장되었습니다!");
    } catch (err: any) { alert("저장 실패: " + err.message); } finally { setIsLoading(false); }
  };

  const getMappedMainIdsForWb = (wbUuid: string) => {
    return Object.entries(mappings)
      .filter(([mId, wIds]) => wIds.includes(wbUuid))
      .map(([mId, _]) => mId);
  };

  const filteredWorkbooks1 = workbooks.filter(book => (book || "").toLowerCase().includes(wbFilterText1.toLowerCase()));
  const filteredWorkbooks2 = workbooks.filter(book => (book || "").toLowerCase().includes(wbFilterText2.toLowerCase()));

  const isMainAllSelected = mainQuestions.length > 0 && mainQuestions.every(q => selectedMainIds.includes(q.tq_id.toString()));
  const isWb1AllSelected = wbQuestions1.length > 0 && wbQuestions1.every(q => selectedWbIds.includes(q.question_id));
  const isWb2AllSelected = wbQuestions2.length > 0 && wbQuestions2.every(q => selectedWbIds.includes(q.question_id));

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden">
      {/* 헤더 바 */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center mb-4 shrink-0 gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#002864] flex items-center gap-2"><span>🔗</span> 3단 크로스 교재 매퍼 <span className="text-sm font-bold text-white bg-blue-500 px-2 py-0.5 rounded ml-2 shadow-sm">Cross Mapper</span></h1>
          <p className="text-sm font-bold text-slate-500 mt-1">본교재 1권에 여러 부교재 문항을 불러와 과제용으로 연결하거나, 완전히 쌍둥이 자식으로 엮어줍니다.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm font-bold text-slate-500 flex flex-col items-end">
            <span>수평 연결(과제용) 문항</span>
            <span><span className="text-emerald-600 font-black text-xl">{Object.keys(mappings).length}</span> 문항</span>
          </div>
          <div className="w-px h-10 bg-slate-200 mx-1"></div>
          
          <button onClick={handleAiMatch} disabled={mainQuestions.length === 0 || (wbQuestions1.length === 0 && wbQuestions2.length === 0) || isLoading} className="px-5 py-3 bg-fuchsia-600 text-white font-black rounded-xl shadow-md hover:bg-fuchsia-700 disabled:opacity-50 transition-colors flex items-center gap-2">
            <span className="text-lg">🤖</span> AI 3단 동시 매칭
          </button>
          
          <button onClick={handleSaveToDB} disabled={isLoading} className="px-6 py-3 bg-emerald-600 text-white font-black rounded-xl shadow-md hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-2">
            <span className="text-lg">💾</span> {isLoading ? "저장 중..." : "DB에 수평 연결 저장"}
          </button>
        </div>
      </div>

      <div className="bg-white px-6 py-4 border border-slate-200 rounded-xl grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4 shrink-0 shadow-sm">
        
        {/* 본교재 선택 */}
        <div className="flex flex-col gap-1.5 xl:border-r border-slate-200 xl:pr-4">
          <span className="text-xs font-black text-indigo-600">📘 [허브] 본교재 선택:</span>
          <select value={selectedMainBookId} onChange={(e) => setSelectedMainBookId(e.target.value)} className="px-3 py-1.5 border border-indigo-300 rounded-lg font-bold text-indigo-900 bg-indigo-50 w-full text-sm shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="">본교재 선택...</option>
            {textbooks.map(b => <option key={b.book_id} value={b.book_id}>{b.title}</option>)}
          </select>
        </div>
        
        {/* 부교재 1 선택 */}
        <div className="flex flex-col gap-1.5 xl:border-r border-slate-200 xl:pr-4">
          <span className="text-xs font-black text-emerald-600">📗 [꼬리] 부교재/쌍둥이 1:</span>
          <div className="flex items-center gap-2">
            <input type="text" placeholder="검색..." value={wbFilterText1} onChange={(e) => setWbFilterText1(e.target.value)} className="w-24 px-2 py-1.5 border border-emerald-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 bg-white shadow-sm font-medium outline-none" />
            <select value={selectedWbSource1} onChange={(e) => setSelectedWbSource1(e.target.value)} className="flex-1 px-3 py-1.5 border border-emerald-300 rounded-lg font-bold text-emerald-800 bg-emerald-50 truncate text-sm shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none">
              <option value="">부교재 1 소스 선택...</option>
              {filteredWorkbooks1.map((book, idx) => <option key={idx} value={book}>{book}</option>)}
            </select>
          </div>
        </div>

        {/* 부교재 2 선택 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-black text-violet-600">📙 [꼬리] 부교재/쌍둥이 2:</span>
          <div className="flex items-center gap-2">
            <input type="text" placeholder="검색..." value={wbFilterText2} onChange={(e) => setWbFilterText2(e.target.value)} className="w-24 px-2 py-1.5 border border-violet-300 rounded-lg text-xs focus:ring-2 focus:ring-violet-600 bg-white shadow-sm font-medium outline-none" />
            <select value={selectedWbSource2} onChange={(e) => setSelectedWbSource2(e.target.value)} className="flex-1 px-3 py-1.5 border border-violet-300 rounded-lg font-bold text-violet-800 bg-violet-50 truncate text-sm shadow-sm focus:ring-2 focus:ring-violet-500 outline-none">
              <option value="">부교재 2 소스 선택...</option>
              {filteredWorkbooks2.map((book, idx) => <option key={idx} value={book}>{book}</option>)}
            </select>
          </div>
        </div>

      </div>

      <div className="flex-1 flex gap-3 overflow-hidden min-h-0">
        
        {/* ======================= 왼쪽: 본교재 리스트 ======================= */}
        <div className="flex-[1.2] bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          <div className="p-3 bg-indigo-100/80 border-b border-indigo-200 flex justify-between items-center shrink-0">
            <h2 className="font-extrabold text-indigo-900 text-sm">📘 허브: 본교재 문항</h2>
            <button 
              onClick={handleToggleSelectAllMain} 
              className={`text-[10px] font-bold px-2 py-1 rounded-md border transition-colors ${isMainAllSelected ? 'bg-indigo-500 text-white border-indigo-500 hover:bg-indigo-600' : 'text-indigo-600 bg-indigo-50 border-indigo-200 hover:bg-indigo-100'}`}
            >
              {isMainAllSelected ? '전체해제' : '전체선택'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scroll bg-slate-50/50">
            {!selectedMainBookId ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">본교재를 선택해주세요.</div>
            : mainQuestions.length === 0 ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">등록된 문항이 없습니다.</div>
            : mainQuestions.map(q => {
                const qIdStr = q.tq_id.toString();
                const isSelected = selectedMainIds.includes(qIdStr);
                const mappedWbs = mappings[qIdStr] || [];
                const hasMapping = mappedWbs.length > 0;
                const taxDepth = getTaxParts(q.taxonomy_id).length;

                const myTwinsInWb = [...wbQuestions1, ...wbQuestions2].filter(wq => 
                  wq.parent_question_id && String(wq.parent_question_id).trim() === String(q.question_id).trim()
                );
                const hasTwins = myTwinsInWb.length > 0;

                return (
                  <div id={`main-q-${qIdStr}`} key={qIdStr} onClick={() => handleMainClick(qIdStr)} className={`p-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm relative overflow-hidden flex items-stretch gap-2 ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-transparent bg-white hover:border-indigo-300 hover:shadow-md'}`}>
                    
                    <div className="flex flex-col justify-start pt-1 shrink-0">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-300 bg-white'}`}>
                        {isSelected && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] font-black text-white bg-indigo-500 px-2 py-0.5 rounded shadow-sm">{q.page_number}p</span>
                          <span className="text-sm font-black text-indigo-900 ml-1">{formatQNum(q.question_number, q.sub_num)}</span>
                          {taxDepth > 0 && <span className="text-[9px] font-bold text-fuchsia-600 bg-fuchsia-50 border border-fuchsia-200 px-1.5 py-0.5 rounded shadow-sm hidden 2xl:inline-block">Depth {taxDepth}</span>}
                          
                          {hasTwins && (
                            <button 
                              onClick={(e) => handleFocusFamily(qIdStr, e)}
                              className="text-[10px] font-extrabold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full shadow-sm ml-1 flex items-center gap-1 hover:bg-rose-100 hover:border-rose-300 transition-colors z-10 relative"
                              title="클릭 시 꼬리 문항으로 스크롤 이동합니다"
                            >
                              <span>👯</span>쌍둥이 {myTwinsInWb.length}개 <span className="text-[11px] leading-none opacity-70">🔍</span>
                            </button>
                          )}
                        </div>
                        {hasMapping && (
                          <div className="flex items-center gap-2 z-10 relative">
                            <button 
                              onClick={(e) => handleFocusFamily(qIdStr, e)}
                              className="text-[10px] font-extrabold text-white bg-blue-500 px-2 py-0.5 rounded-full shadow-sm hover:bg-blue-600 transition-colors flex items-center gap-1"
                              title="클릭 시 꼬리 문항으로 스크롤 이동합니다"
                            >
                              {mappedWbs.length}개 수평연결됨 <span className="text-[11px] leading-none opacity-80">🔍</span>
                            </button>
                            <button onClick={(e) => handleUnlink(qIdStr, e)} className="text-[10px] font-bold text-slate-400 hover:text-rose-600 underline">초기화</button>
                          </div>
                        )}
                      </div>
                      <div className="text-xs font-medium text-slate-700 line-clamp-3 leading-relaxed break-all whitespace-pre-wrap">{q.question}</div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* ======================= 중앙: 연결 버튼 ======================= */}
        <div className="w-20 flex flex-col justify-center items-center shrink-0 z-10 gap-3">
          
          <div className="bg-white p-2 rounded-2xl shadow-md border border-slate-200 flex flex-col gap-2 relative w-full">
            <button onClick={handleLink} disabled={selectedMainIds.length === 0 || selectedWbIds.length === 0} className={`w-full h-14 rounded-xl flex flex-col items-center justify-center transition-all shadow-sm ${selectedMainIds.length > 0 && selectedWbIds.length > 0 ? 'bg-gradient-to-br from-indigo-500 to-blue-500 text-white cursor-pointer hover:scale-105 active:scale-95' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`}>
              <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
              <span className="text-[10px] font-black">수평 연결</span>
            </button>
            <div className="text-center mt-0.5 mb-1">
              <div className="text-[9px] font-black text-indigo-600 leading-tight">유사/과제<br/>(다중 병합)</div>
            </div>
          </div>

          <div className="bg-white p-2 rounded-2xl shadow-md border border-rose-200 flex flex-col gap-2 relative w-full">
            <button onClick={handleTwinLink} disabled={selectedMainIds.length !== 1 || selectedWbIds.length === 0} className={`w-full h-14 rounded-xl flex flex-col items-center justify-center transition-all shadow-sm ${selectedMainIds.length === 1 && selectedWbIds.length > 0 ? 'bg-gradient-to-br from-rose-500 to-fuchsia-500 text-white cursor-pointer hover:scale-105 active:scale-95' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`}>
              <span className="text-lg mb-0.5">👯</span>
              <span className="text-[10px] font-black">수직 편입</span>
            </button>
            <div className="text-center mt-0.5 mb-1">
              <div className="text-[9px] font-black text-rose-600 leading-tight">쌍둥이화<br/>(1개만 가능)</div>
            </div>
          </div>

          <div className="bg-white p-2 rounded-2xl shadow-md border border-amber-200 flex flex-col gap-2 relative w-full">
            <button onClick={handleMultiTwinLink} disabled={selectedMainIds.length === 0 || selectedMainIds.length !== selectedWbIds.length} className={`w-full h-14 rounded-xl flex flex-col items-center justify-center transition-all shadow-sm ${selectedMainIds.length > 0 && selectedMainIds.length === selectedWbIds.length ? 'bg-gradient-to-br from-amber-500 to-orange-500 text-white cursor-pointer hover:scale-105 active:scale-95' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`}>
              <span className="text-lg mb-0.5">🧬</span>
              <span className="text-[10px] font-black">1:1 쌍둥이</span>
            </button>
            <div className="text-center mt-0.5 mb-1">
              <div className="text-[9px] font-black text-amber-600 leading-tight">다중 선택<br/>순서 매칭</div>
            </div>
          </div>

          <div className="text-center mt-2">
            <span className="text-[10px] font-bold text-slate-400">꼬리 선택됨</span>
            <div className="text-sm font-black text-slate-700">{selectedWbIds.length}개</div>
          </div>

        </div>

        {/* ======================= 우측 1: 부교재 1 리스트 ======================= */}
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          <div className="p-3 bg-emerald-100/80 border-b border-emerald-200 flex justify-between items-center shrink-0">
            <h2 className="font-extrabold text-emerald-900 text-sm truncate">📗 꼬리 1</h2>
            <button 
              onClick={handleToggleSelectAllWb1} 
              className={`text-[10px] font-bold px-2 py-1 rounded-md border transition-colors ${isWb1AllSelected ? 'bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600' : 'text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'}`}
            >
              {isWb1AllSelected ? '전체해제' : '전체선택'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scroll bg-slate-50/50">
            {!selectedWbSource1 ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm text-center">선택 대기중</div>
            : wbQuestions1.length === 0 ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">문항 없음</div>
            : wbQuestions1.map(q => {
                const qUuid = q.question_id;
                const isSelected = selectedWbIds.includes(qUuid);
                
                const mappedMainIds = getMappedMainIdsForWb(qUuid);
                const isMappedToCurrentSelection = selectedMainIds.some(id => mappedMainIds.includes(id));
                const isMappedToOther = mappedMainIds.length > 0 && !isMappedToCurrentSelection;

                const isTwin = q.parent_question_id && String(q.parent_question_id).trim().toLowerCase() !== 'null';
                const isMyTwin = isTwin && selectedMainIds.some(mId => {
                  const mainQ = mainQuestions.find(mq => mq.tq_id.toString() === mId);
                  return mainQ && String(q.parent_question_id).trim() === String(mainQ.question_id).trim();
                });

                return (
                  <div id={`wb1-q-${qUuid}`} key={qUuid} onClick={() => handleWbClick(qUuid)} className={`p-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm relative overflow-hidden flex items-stretch gap-2 ${isSelected ? 'border-emerald-500 bg-emerald-50' : 'border-transparent bg-white hover:border-emerald-300 hover:shadow-md'} ${isMappedToOther ? 'opacity-40 grayscale' : ''}`}>
                    <div className="flex flex-col justify-start pt-1 shrink-0">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 bg-white'}`}>
                        {isSelected && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[12px] font-black text-white bg-emerald-500 px-2 py-0.5 rounded shadow-sm">{q.final_printed_page || q.detected_page_num}p</span>
                          <span className={`text-sm font-black ml-0.5 ${isSelected ? 'text-emerald-700' : 'text-slate-800'}`}>{formatQNum(q.question_number, q.sub_num)}</span>
                        </div>
                        
                        <div className="flex items-center gap-1">
                          {isMyTwin && (
                            <div className="flex items-center gap-1 z-10">
                              <span className="text-[9px] font-bold text-fuchsia-600 bg-fuchsia-50 px-1.5 py-0.5 rounded border border-fuchsia-200 shrink-0 shadow-sm">내 쌍둥이</span>
                              <button onClick={(e) => handleUnlinkTwin(qUuid, e)} className="text-[9px] font-bold text-slate-400 hover:text-rose-600 underline px-1">해제</button>
                            </div>
                          )}
                          {isTwin && !isMyTwin && (
                            <button 
                              onClick={(e) => onFindTwinParent(q.parent_question_id, e)} 
                              className="text-[9px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-300 hover:bg-indigo-100 hover:text-indigo-700 hover:border-indigo-300 transition-colors shrink-0 shadow-sm flex items-center gap-0.5 z-10"
                              title="본교재의 쌍둥이 부모 위치로 이동합니다"
                            >
                              타문항 쌍둥이 <span className="text-[11px] leading-none">🔍</span>
                            </button>
                          )}
                          {isMappedToOther && (
                            <button 
                              onClick={(e) => handleFocusFamily(mappedMainIds[0], e)} 
                              className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-300 hover:bg-indigo-100 hover:text-indigo-700 hover:border-indigo-300 transition-colors shrink-0 shadow-sm flex items-center gap-0.5 z-10"
                              title="본교재의 수평 연결 기준 위치로 이동합니다"
                            >
                              타문항 연결 <span className="text-[11px] leading-none">🔍</span>
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-xs font-medium text-slate-700 line-clamp-3 leading-relaxed break-all whitespace-pre-wrap">{q.question}</div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* ======================= 우측 2: 부교재 2 리스트 ======================= */}
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          <div className="p-3 bg-violet-100/80 border-b border-violet-200 flex justify-between items-center shrink-0">
            <h2 className="font-extrabold text-violet-900 text-sm truncate">📙 꼬리 2</h2>
            <button 
              onClick={handleToggleSelectAllWb2} 
              className={`text-[10px] font-bold px-2 py-1 rounded-md border transition-colors ${isWb2AllSelected ? 'bg-violet-500 text-white border-violet-500 hover:bg-violet-600' : 'text-violet-600 bg-violet-50 border-violet-200 hover:bg-violet-100'}`}
            >
              {isWb2AllSelected ? '전체해제' : '전체선택'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scroll bg-slate-50/50">
            {!selectedWbSource2 ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm text-center">선택 대기중</div>
            : wbQuestions2.length === 0 ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">문항 없음</div>
            : wbQuestions2.map(q => {
                const qUuid = q.question_id;
                const isSelected = selectedWbIds.includes(qUuid);
                
                const mappedMainIds = getMappedMainIdsForWb(qUuid);
                const isMappedToCurrentSelection = selectedMainIds.some(id => mappedMainIds.includes(id));
                const isMappedToOther = mappedMainIds.length > 0 && !isMappedToCurrentSelection;

                const isTwin = q.parent_question_id && String(q.parent_question_id).trim().toLowerCase() !== 'null';
                const isMyTwin = isTwin && selectedMainIds.some(mId => {
                  const mainQ = mainQuestions.find(mq => mq.tq_id.toString() === mId);
                  return mainQ && String(q.parent_question_id).trim() === String(mainQ.question_id).trim();
                });

                return (
                  <div id={`wb2-q-${qUuid}`} key={qUuid} onClick={() => handleWbClick(qUuid)} className={`p-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm relative overflow-hidden flex items-stretch gap-2 ${isSelected ? 'border-violet-500 bg-violet-50' : 'border-transparent bg-white hover:border-violet-300 hover:shadow-md'} ${isMappedToOther ? 'opacity-40 grayscale' : ''}`}>
                    <div className="flex flex-col justify-start pt-1 shrink-0">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-violet-500 border-violet-500 text-white' : 'border-slate-300 bg-white'}`}>
                        {isSelected && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[12px] font-black text-white bg-violet-500 px-2 py-0.5 rounded shadow-sm">{q.final_printed_page || q.detected_page_num}p</span>
                          <span className={`text-sm font-black ml-0.5 ${isSelected ? 'text-violet-700' : 'text-slate-800'}`}>{formatQNum(q.question_number, q.sub_num)}</span>
                        </div>
                        
                        <div className="flex items-center gap-1">
                          {isMyTwin && (
                            <div className="flex items-center gap-1 z-10">
                              <span className="text-[9px] font-bold text-fuchsia-600 bg-fuchsia-50 px-1.5 py-0.5 rounded border border-fuchsia-200 shrink-0 shadow-sm">내 쌍둥이</span>
                              <button onClick={(e) => handleUnlinkTwin(qUuid, e)} className="text-[9px] font-bold text-slate-400 hover:text-rose-600 underline px-1">해제</button>
                            </div>
                          )}
                          {isTwin && !isMyTwin && (
                            <button 
                              onClick={(e) => onFindTwinParent(q.parent_question_id, e)} 
                              className="text-[9px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-300 hover:bg-indigo-100 hover:text-indigo-700 hover:border-indigo-300 transition-colors shrink-0 shadow-sm flex items-center gap-0.5 z-10"
                              title="본교재의 쌍둥이 부모 위치로 이동합니다"
                            >
                              타문항 쌍둥이 <span className="text-[11px] leading-none">🔍</span>
                            </button>
                          )}
                          {isMappedToOther && (
                            <button 
                              onClick={(e) => handleFocusFamily(mappedMainIds[0], e)} 
                              className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-300 hover:bg-indigo-100 hover:text-indigo-700 hover:border-indigo-300 transition-colors shrink-0 shadow-sm flex items-center gap-0.5 z-10"
                              title="본교재의 수평 연결 기준 위치로 이동합니다"
                            >
                              타문항 연결 <span className="text-[11px] leading-none">🔍</span>
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-xs font-medium text-slate-700 line-clamp-3 leading-relaxed break-all whitespace-pre-wrap">{q.question}</div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

      </div>
    </div>
  );
}