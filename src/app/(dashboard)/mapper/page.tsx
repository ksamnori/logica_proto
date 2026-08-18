// src/app/(dashboard)/mapper/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// 🌟 [추가] Supabase의 1,000줄 제한 무력화 (전체 데이터 루프 호출)
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

export default function VisualMapperPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [textbooks, setTextbooks] = useState<any[]>([]);
  
  const [workbooks, setWorkbooks] = useState<string[]>([]); 
  
  // 3단 구성을 위한 2개의 부교재 필터 상태
  const [wbFilterText1, setWbFilterText1] = useState("");
  const [wbFilterText2, setWbFilterText2] = useState("");

  const [selectedMainBookId, setSelectedMainBookId] = useState("");
  const [selectedWbSource1, setSelectedWbSource1] = useState("");
  const [selectedWbSource2, setSelectedWbSource2] = useState("");

  const [mainQuestions, setMainQuestions] = useState<any[]>([]);
  const [wbQuestions1, setWbQuestions1] = useState<any[]>([]);
  const [wbQuestions2, setWbQuestions2] = useState<any[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);

  const [selectedMainId, setSelectedMainId] = useState<string | null>(null);
  const [selectedWbIds, setSelectedWbIds] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string[]>>({});

  const mathJaxRef = useRef<boolean>(false);

  useEffect(() => {
    const checkAccess = () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      // LOGICA Factory 권한 통일
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER' || pos.includes('최고관리자') || pos.includes('원장') || pos.includes('부원장') || pos.includes('실장') || pos.includes('전임강사');
      if (isGodMode) setIsAuthorized(true);
      else { alert("⛔ 교재 매핑 기능은 관리자 전용입니다."); router.replace("/home"); }
    };
    checkAccess();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) {
      loadBooks();
      loadMathJax();
    }
  }, [isAuthorized]);

  // 독립적인 데이터 호출 (본교재, 부교재1, 부교재2가 각자 동작함)
  useEffect(() => {
    if (selectedMainBookId) fetchMainQuestions(selectedMainBookId);
    else { setMainQuestions([]); setMappings({}); setSelectedMainId(null); setSelectedWbIds([]); }
  }, [selectedMainBookId]);

  useEffect(() => {
    if (selectedWbSource1) fetchWbQuestions(selectedWbSource1, setWbQuestions1);
    else setWbQuestions1([]);
  }, [selectedWbSource1]);

  useEffect(() => {
    if (selectedWbSource2) fetchWbQuestions(selectedWbSource2, setWbQuestions2);
    else setWbQuestions2([]);
  }, [selectedWbSource2]);

  // 수식 렌더링 타이머
  useEffect(() => {
    const renderMath = () => {
      if ((window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch((err: any) => console.log("MathJax 에러:", err));
      }
    };
    const timer = setTimeout(renderMath, 150);
    return () => clearTimeout(timer);
  }, [mainQuestions, wbQuestions1, wbQuestions2, mappings, selectedMainId]);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] }, startup: { typeset: false } };
      const script = document.createElement("script"); script.id = "MathJax-script"; script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"; script.async = true;
      document.head.appendChild(script);
    }
  };

  const loadBooks = async () => {
    // 🌟 [수정] 제한 없이 모든 데이터를 가져와서 자연스러운 숫자 순서로 정렬합니다.
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

  // 본교재 전용 Fetch 로직
  const fetchMainQuestions = async (mainId: string) => {
    setIsLoading(true);
    try {
      const { data: mainData } = await supabase.from("textbook_question")
        .select("*").eq("book_id", mainId)
        .order("page_number", { ascending: true }).order("tq_id", { ascending: true });
      
      const initialMap: Record<string, string[]> = {};
      mainData?.forEach(mq => {
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
      setMainQuestions(mainData || []);
      setSelectedMainId(null); setSelectedWbIds([]);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  // 부교재 전용 공통 Fetch 로직
  const fetchWbQuestions = async (source: string, setter: React.Dispatch<React.SetStateAction<any[]>>) => {
    setIsLoading(true);
    try {
      const { data: wbData } = await supabase.from("question_db").select("*").eq("source_book_name", source);

      const sortedWbData = (wbData || []).sort((a, b) => {
        const pageA = parseInt(String(a.final_printed_page)) || a.detected_page_num || 99999;
        const pageB = parseInt(String(b.final_printed_page)) || b.detected_page_num || 99999;
        if (pageA !== pageB) return pageA - pageB;
        
        const qNumA = parseInt(String(a.question_number).replace(/[^0-9]/g, '')) || 99999;
        const qNumB = parseInt(String(b.question_number).replace(/[^0-9]/g, '')) || 99999;
        if (qNumA !== qNumB) return qNumA - qNumB;
        
        const subA = a.sub_num || 0;
        const subB = b.sub_num || 0;
        return subA - subB;
      });
      setter(sortedWbData);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  // ==========================================
  // 🤖 3단계를 모두 아우르는 통합 AI 추천 매칭
  // ==========================================
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
    setSelectedMainId(idStr);
    setSelectedWbIds(mappings[idStr] || []);
  };

  const handleWbClick = (uuid: string) => {
    if (!selectedMainId) return alert("💡 수동으로 묶으려면 먼저 맨 왼쪽의 '본교재 문항'을 하나 클릭해주세요!");
    setSelectedWbIds(prev => prev.includes(uuid) ? prev.filter(id => id !== uuid) : [...prev, uuid]);
  };

  const handleLink = () => {
    if (!selectedMainId) return;
    setMappings(prev => ({ ...prev, [selectedMainId]: selectedWbIds }));
    
    const currentIndex = mainQuestions.findIndex(q => q.tq_id.toString() === selectedMainId);
    if (currentIndex >= 0 && currentIndex < mainQuestions.length - 1) {
      const nextId = mainQuestions[currentIndex + 1].tq_id.toString();
      setSelectedMainId(nextId);
      setSelectedWbIds(mappings[nextId] || []);
      setTimeout(() => { const el = document.getElementById(`main-q-${nextId}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
    } else {
      setSelectedMainId(null); setSelectedWbIds([]);
    }
  };

  const handleUnlink = (mainIdStr: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMappings(prev => { const newMap = { ...prev }; delete newMap[mainIdStr]; return newMap; });
    if (selectedMainId === mainIdStr) setSelectedWbIds([]);
  };

  const handleSaveToDB = async () => {
    if (!selectedMainBookId) return alert("저장할 교재를 선택해주세요.");
    if (!confirm(`총 ${Object.keys(mappings).length}개의 본교재 문항에 설정된 워크북 매핑을 저장하시겠습니까?`)) return;

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
      alert("✅ 완벽하게 3단 매핑 데이터가 DB에 저장되었습니다!");
    } catch (err: any) { alert("저장 실패: " + err.message); } finally { setIsLoading(false); }
  };

  const getMappedMainIdForWb = (wbUuid: string) => {
    for (const [mId, wIds] of Object.entries(mappings)) {
      if (wIds.includes(wbUuid)) return mId;
    }
    return null;
  };

  const filteredWorkbooks1 = workbooks.filter(book => (book || "").toLowerCase().includes(wbFilterText1.toLowerCase()));
  const filteredWorkbooks2 = workbooks.filter(book => (book || "").toLowerCase().includes(wbFilterText2.toLowerCase()));

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden">
      {/* 헤더 바 */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center mb-4 shrink-0 gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#002864] flex items-center gap-2"><span>🔗</span> 3단 크로스 교재 매퍼 <span className="text-sm font-bold text-white bg-blue-500 px-2 py-0.5 rounded ml-2 shadow-sm">Cross Mapper</span></h1>
          <p className="text-sm font-bold text-slate-500 mt-1">본교재 1권에 여러 부교재 문항을 동시에 불러와 한 번에 꼬리를 연결합니다.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm font-bold text-slate-500 flex flex-col items-end">
            <span>현재 연결된 본교재</span>
            <span><span className="text-emerald-600 font-black text-xl">{Object.keys(mappings).length}</span> 문항</span>
          </div>
          <div className="w-px h-10 bg-slate-200 mx-1"></div>
          
          <button onClick={handleAiMatch} disabled={mainQuestions.length === 0 || (wbQuestions1.length === 0 && wbQuestions2.length === 0) || isLoading} className="px-5 py-3 bg-fuchsia-600 text-white font-black rounded-xl shadow-md hover:bg-fuchsia-700 disabled:opacity-50 transition-colors flex items-center gap-2">
            <span className="text-lg">🤖</span> AI 3단 동시 매칭
          </button>
          
          <button onClick={handleSaveToDB} disabled={isLoading} className="px-6 py-3 bg-emerald-600 text-white font-black rounded-xl shadow-md hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-2">
            <span className="text-lg">💾</span> {isLoading ? "저장 중..." : "DB에 연결 저장"}
          </button>
        </div>
      </div>

      {/* 🚀 3단 교재 선택 필터 영역 */}
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
          <span className="text-xs font-black text-emerald-600">📗 [꼬리] 부교재/워크북 1:</span>
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
          <span className="text-xs font-black text-violet-600">📙 [꼬리] 부교재/워크북 2:</span>
          <div className="flex items-center gap-2">
            <input type="text" placeholder="검색..." value={wbFilterText2} onChange={(e) => setWbFilterText2(e.target.value)} className="w-24 px-2 py-1.5 border border-violet-300 rounded-lg text-xs focus:ring-2 focus:ring-violet-600 bg-white shadow-sm font-medium outline-none" />
            <select value={selectedWbSource2} onChange={(e) => setSelectedWbSource2(e.target.value)} className="flex-1 px-3 py-1.5 border border-violet-300 rounded-lg font-bold text-violet-800 bg-violet-50 truncate text-sm shadow-sm focus:ring-2 focus:ring-violet-500 outline-none">
              <option value="">부교재 2 소스 선택...</option>
              {filteredWorkbooks2.map((book, idx) => <option key={idx} value={book}>{book}</option>)}
            </select>
          </div>
        </div>

      </div>

      {/* 🚀 4열(3단 리스트 + 버튼) 컨텐츠 영역 */}
      <div className="flex-1 flex gap-3 overflow-hidden min-h-0">
        
        {/* ======================= 왼쪽: 본교재 리스트 ======================= */}
        <div className="flex-[1.2] bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          <div className="p-3 bg-indigo-100/80 border-b border-indigo-200 flex justify-between items-center shrink-0">
            <h2 className="font-extrabold text-indigo-900 text-sm">📘 허브: 본교재 문항</h2>
            <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-md">수동 연결 시 기준 클릭</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scroll bg-slate-50/50">
            {!selectedMainBookId ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">본교재를 선택해주세요.</div>
            : mainQuestions.length === 0 ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">등록된 문항이 없습니다.</div>
            : mainQuestions.map(q => {
                const qIdStr = q.tq_id.toString();
                const isSelected = selectedMainId === qIdStr;
                const mappedWbs = mappings[qIdStr] || [];
                const hasMapping = mappedWbs.length > 0;
                const taxDepth = getTaxParts(q.taxonomy_id).length;

                return (
                  <div id={`main-q-${qIdStr}`} key={qIdStr} onClick={() => handleMainClick(qIdStr)} className={`p-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm relative overflow-hidden ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-transparent bg-white hover:border-indigo-300 hover:shadow-md'}`}>
                    {isSelected && <div className="absolute left-0 top-0 w-1.5 h-full bg-indigo-500"></div>}
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        {/* 🌟 1. 눈에 확 띄는 페이지 뱃지 (본교재: Indigo) */}
                        <span className="text-[12px] font-black text-white bg-indigo-500 px-2 py-0.5 rounded shadow-sm">{q.page_number}p</span>
                        <span className="text-sm font-black text-indigo-900 ml-1">{q.question_number}</span>
                        {taxDepth > 0 && <span className="text-[9px] font-bold text-fuchsia-600 bg-fuchsia-50 border border-fuchsia-200 px-1.5 py-0.5 rounded shadow-sm hidden 2xl:inline-block">Depth {taxDepth}</span>}
                      </div>
                      {hasMapping && (
                        <div className="flex items-center gap-2 z-10 relative">
                          <span className="text-[10px] font-extrabold text-white bg-rose-500 px-2 py-0.5 rounded-full shadow-sm">{mappedWbs.length}개 연결됨</span>
                          <button onClick={(e) => handleUnlink(qIdStr, e)} className="text-[10px] font-bold text-slate-400 hover:text-rose-600 underline">초기화</button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs font-medium text-slate-700 line-clamp-3 leading-relaxed break-all whitespace-pre-wrap">{q.question}</div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* ======================= 중앙: 연결 버튼 ======================= */}
        <div className="w-16 flex flex-col justify-center items-center shrink-0 z-10">
          <div className="bg-white p-2 rounded-2xl shadow-md border border-slate-200 flex flex-col gap-2 relative">
            <button onClick={handleLink} disabled={!selectedMainId || selectedWbIds.length === 0} className={`w-12 h-14 rounded-xl flex flex-col items-center justify-center transition-all shadow-sm ${selectedMainId && selectedWbIds.length > 0 ? 'bg-gradient-to-br from-indigo-500 to-rose-500 text-white cursor-pointer hover:scale-105 active:scale-95' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`}>
              <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
              <span className="text-[10px] font-black">묶기</span>
            </button>
            <div className="text-center mt-1">
              <div className="text-[10px] font-black text-rose-600">{selectedWbIds.length}개</div>
            </div>
          </div>
        </div>

        {/* ======================= 우측 1: 부교재 1 리스트 ======================= */}
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          <div className="p-3 bg-emerald-100/80 border-b border-emerald-200 flex justify-between items-center shrink-0">
            <h2 className="font-extrabold text-emerald-900 text-sm truncate">📗 꼬리 1</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scroll bg-slate-50/50">
            {!selectedWbSource1 ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm text-center">선택 대기중</div>
            : wbQuestions1.length === 0 ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">문항 없음</div>
            : wbQuestions1.map(q => {
                const qUuid = q.question_id;
                const isSelected = selectedWbIds.includes(qUuid);
                const mappedMainId = getMappedMainIdForWb(qUuid);
                const isMappedToOther = mappedMainId && mappedMainId !== selectedMainId;

                return (
                  <div key={qUuid} onClick={() => handleWbClick(qUuid)} className={`p-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm relative overflow-hidden flex items-stretch gap-2 ${isSelected ? 'border-emerald-500 bg-emerald-50' : 'border-transparent bg-white hover:border-emerald-300 hover:shadow-md'} ${isMappedToOther ? 'opacity-40 grayscale' : ''}`}>
                    <div className="flex flex-col justify-start pt-1 shrink-0">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 bg-white'}`}>
                        {isSelected && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* 🌟 2. 눈에 확 띄는 페이지 뱃지 (부교재 1: Emerald) */}
                          <span className="text-[12px] font-black text-white bg-emerald-500 px-2 py-0.5 rounded shadow-sm">{q.final_printed_page || q.detected_page_num}p</span>
                          <span className={`text-sm font-black ml-0.5 ${isSelected ? 'text-emerald-700' : 'text-slate-800'}`}>{q.question_number}-{q.sub_num}</span>
                        </div>
                        {isMappedToOther && <span className="text-[9px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100 shrink-0">연결됨</span>}
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
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scroll bg-slate-50/50">
            {!selectedWbSource2 ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm text-center">선택 대기중</div>
            : wbQuestions2.length === 0 ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">문항 없음</div>
            : wbQuestions2.map(q => {
                const qUuid = q.question_id;
                const isSelected = selectedWbIds.includes(qUuid);
                const mappedMainId = getMappedMainIdForWb(qUuid);
                const isMappedToOther = mappedMainId && mappedMainId !== selectedMainId;

                return (
                  <div key={qUuid} onClick={() => handleWbClick(qUuid)} className={`p-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm relative overflow-hidden flex items-stretch gap-2 ${isSelected ? 'border-violet-500 bg-violet-50' : 'border-transparent bg-white hover:border-violet-300 hover:shadow-md'} ${isMappedToOther ? 'opacity-40 grayscale' : ''}`}>
                    <div className="flex flex-col justify-start pt-1 shrink-0">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-violet-500 border-violet-500 text-white' : 'border-slate-300 bg-white'}`}>
                        {isSelected && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* 🌟 3. 눈에 확 띄는 페이지 뱃지 (부교재 2: Violet) */}
                          <span className="text-[12px] font-black text-white bg-violet-500 px-2 py-0.5 rounded shadow-sm">{q.final_printed_page || q.detected_page_num}p</span>
                          <span className={`text-sm font-black ml-0.5 ${isSelected ? 'text-violet-700' : 'text-slate-800'}`}>{q.question_number}-{q.sub_num}</span>
                        </div>
                        {isMappedToOther && <span className="text-[9px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100 shrink-0">연결됨</span>}
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