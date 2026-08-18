// src/app/(dashboard)/mapper/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const getTaxParts = (taxId: string | null | undefined) => {
  if (!taxId || taxId === '미분류') return [];
  return taxId.split('-');
};

export default function VisualMapperPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [textbooks, setTextbooks] = useState<any[]>([]);
  
  const [workbooks, setWorkbooks] = useState<string[]>([]); 
  const [wbFilterText, setWbFilterText] = useState("");

  const [selectedMainBookId, setSelectedMainBookId] = useState("");
  const [selectedWbSource, setSelectedWbSource] = useState("");

  const [mainQuestions, setMainQuestions] = useState<any[]>([]);
  const [wbQuestions, setWbQuestions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [selectedMainId, setSelectedMainId] = useState<string | null>(null);
  const [selectedWbIds, setSelectedWbIds] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string[]>>({});

  const mathJaxRef = useRef<boolean>(false);

  useEffect(() => {
    const checkAccess = () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || pos.includes('최고관리자') || pos.includes('원장');
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

  useEffect(() => {
    if (selectedMainBookId && selectedWbSource) {
      fetchQuestions(selectedMainBookId, selectedWbSource);
    } else {
      setMainQuestions([]); setWbQuestions([]); setMappings({});
    }
  }, [selectedMainBookId, selectedWbSource]);

  useEffect(() => {
    const renderMath = () => {
      if ((window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch((err: any) => console.log("MathJax 에러:", err));
      }
    };
    const timer = setTimeout(renderMath, 150);
    return () => clearTimeout(timer);
  }, [mainQuestions, wbQuestions, mappings, selectedMainId]);

  const loadMathJax = () => {
    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] }, startup: { typeset: false } };
      const script = document.createElement("script"); script.id = "MathJax-script"; script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"; script.async = true;
      document.head.appendChild(script);
    }
  };

  const loadBooks = async () => {
    const { data: tbData } = await supabase.from('textbook').select('book_id, title').order('title');
    if (tbData) setTextbooks(tbData);

    const { data: qbData } = await supabase.from('question_db')
      .select('source_book_name')
      .not('source_book_name', 'is', null)
      .limit(50000); 

    if (qbData) {
      const uniqueList = Array.from(new Set(qbData.map(q => q.source_book_name))).filter(Boolean).sort();
      setWorkbooks(uniqueList as string[]);
    }
  };

  const fetchQuestions = async (mainId: string, wbSource: string) => {
    setIsLoading(true);
    try {
      // 🌟 Number() 래핑 제거
      const { data: mainData } = await supabase.from("textbook_question")
        .select("*").eq("book_id", mainId)
        .order("page_number", { ascending: true }).order("tq_id", { ascending: true });
      
      const { data: wbData } = await supabase.from("question_db")
        .select("*").eq("source_book_name", wbSource);

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

      setMainQuestions(mainData || []);
      setWbQuestions(sortedWbData);

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
      setSelectedMainId(null); setSelectedWbIds([]);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const handleAiMatch = () => {
    if (mainQuestions.length === 0 || wbQuestions.length === 0) {
      return alert("본교재와 워크북 문항이 모두 화면에 떠 있는 상태에서 실행해주세요.");
    }

    const newMappings = { ...mappings };
    let match7DepthCount = 0;
    let match6DepthCount = 0;

    mainQuestions.forEach(mq => {
      const matchedWbIds = new Set(newMappings[mq.tq_id.toString()] || []);
      
      const mqNumStr = String(mq.question_number || "");
      const mqBaseNum = mqNumStr.replace(/[^0-9]/g, '');
      const mqBaseText = mqNumStr.replace(/[0-9\-]/g, '').trim(); 

      const mqTaxParts = getTaxParts(mq.taxonomy_id);

      wbQuestions.forEach(wq => {
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
    alert(`🤖 AI [Depth-7/6] 초정밀 매칭 완료!\n\n✅ 7-Depth 완벽 일치: ${match7DepthCount}건\n✅ 6-Depth 완벽 일치: ${match6DepthCount}건\n\n(💡 우측 상단의 'DB에 연결 저장'을 눌러야 확정됩니다.)`);
  };

  const handleMainClick = (idStr: string) => {
    setSelectedMainId(idStr);
    setSelectedWbIds(mappings[idStr] || []);
  };

  const handleWbClick = (uuid: string) => {
    if (!selectedMainId) return alert("💡 수동으로 묶으려면 먼저 왼쪽에서 '본교재 문항'을 하나 클릭해주세요!");
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
      alert("✅ 완벽하게 매핑 데이터가 DB에 저장되었습니다!");
    } catch (err: any) { alert("저장 실패: " + err.message); } finally { setIsLoading(false); }
  };

  const getMappedMainIdForWb = (wbUuid: string) => {
    for (const [mId, wIds] of Object.entries(mappings)) {
      if (wIds.includes(wbUuid)) return mId;
    }
    return null;
  };

  const filteredWorkbooks = workbooks.filter(book => 
    (book || "").toLowerCase().includes(wbFilterText.toLowerCase())
  );

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden">
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center mb-4 shrink-0 gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#002864] flex items-center gap-2"><span>🔗</span> 크로스 교재 매퍼 <span className="text-sm font-bold text-white bg-blue-500 px-2 py-0.5 rounded ml-2 shadow-sm">Cross Mapper</span></h1>
          <p className="text-sm font-bold text-slate-500 mt-1">본교재(textbook_question) 문항과 마스터DB(question_db)의 워크북 문항을 서로 연결합니다.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm font-bold text-slate-500 flex flex-col items-end">
            <span>현재 연결된 본교재</span>
            <span><span className="text-emerald-600 font-black text-xl">{Object.keys(mappings).length}</span> 문항</span>
          </div>
          <div className="w-px h-10 bg-slate-200 mx-1"></div>
          
          <button onClick={handleAiMatch} disabled={mainQuestions.length === 0 || wbQuestions.length === 0 || isLoading} className="px-5 py-3 bg-fuchsia-600 text-white font-black rounded-xl shadow-md hover:bg-fuchsia-700 disabled:opacity-50 transition-colors flex items-center gap-2">
            <span className="text-lg">🤖</span> AI 7-Depth 매칭 추천
          </button>
          
          <button onClick={handleSaveToDB} disabled={isLoading} className="px-6 py-3 bg-emerald-600 text-white font-black rounded-xl shadow-md hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-2">
            <span className="text-lg">💾</span> {isLoading ? "저장 중..." : "DB에 연결 저장"}
          </button>
        </div>
      </div>

      <div className="bg-white px-6 py-4 border border-slate-200 rounded-xl flex items-end gap-4 mb-4 shrink-0 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-slate-500">본교재 선택:</span>
          <select value={selectedMainBookId} onChange={(e) => setSelectedMainBookId(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg font-bold text-[#002864] bg-slate-50 w-64 text-sm">
            <option value="">본교재 선택...</option>
            {textbooks.map(b => <option key={b.book_id} value={b.book_id}>{b.title}</option>)}
          </select>
        </div>
        
        <div className="w-px h-8 bg-slate-300 mx-2 mb-1"></div>
        
        <div className="flex flex-col gap-1.5 flex-1">
          <span className="text-xs font-bold text-slate-500">마스터DB 워크북 소스 (교재명 검색 및 선택):</span>
          <div className="flex items-center gap-2">
            <input 
              type="text" 
              placeholder="🔍 교재명 검색..." 
              value={wbFilterText}
              onChange={(e) => setWbFilterText(e.target.value)}
              className="px-3 py-1.5 border border-emerald-300 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-emerald-600 bg-white shadow-sm font-medium"
            />
            <select value={selectedWbSource} onChange={(e) => setSelectedWbSource(e.target.value)} className="flex-1 px-3 py-1.5 border border-emerald-300 rounded-lg font-bold text-emerald-700 bg-emerald-50 truncate text-sm">
              <option value="">워크북 소스 (source_book_name) 선택...</option>
              {filteredWorkbooks.map((book, idx) => (
                <option key={idx} value={book}>{book}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          <div className="p-3 bg-indigo-50/80 border-b border-indigo-100 flex justify-between items-center shrink-0">
            <h2 className="font-extrabold text-indigo-900 text-sm">📘 본교재 (textbook_question)</h2>
            <span className="text-[10px] font-bold text-indigo-500 bg-indigo-100/50 border border-indigo-200 px-2 py-1 rounded-md">수동 연결 시 기준 클릭</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scroll bg-slate-50/30">
            {!selectedMainBookId ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">본교재를 선택해주세요.</div>
            : mainQuestions.length === 0 ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">본교재에 등록된 문항이 없습니다.</div>
            : mainQuestions.map(q => {
                const qIdStr = q.tq_id.toString();
                const isSelected = selectedMainId === qIdStr;
                const mappedWbs = mappings[qIdStr] || [];
                const hasMapping = mappedWbs.length > 0;
                
                const taxDepth = getTaxParts(q.taxonomy_id).length;

                return (
                  <div id={`main-q-${qIdStr}`} key={qIdStr} onClick={() => handleMainClick(qIdStr)} className={`p-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm relative overflow-hidden ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-transparent bg-white hover:border-indigo-300'}`}>
                    {isSelected && <div className="absolute left-0 top-0 w-1.5 h-full bg-indigo-500"></div>}
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{q.page_number}p</span>
                        <span className="text-xs font-black text-indigo-900">번호: {q.question_number}</span>
                        {taxDepth > 0 && <span className="text-[9px] font-bold text-fuchsia-600 bg-fuchsia-50 border border-fuchsia-200 px-1.5 py-0.5 rounded shadow-sm">Depth {taxDepth}</span>}
                      </div>
                      {hasMapping && (
                        <div className="flex items-center gap-2 z-10 relative">
                          <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shadow-sm">{mappedWbs.length}개 연결됨</span>
                          <button onClick={(e) => handleUnlink(qIdStr, e)} className="text-[10px] font-bold text-rose-400 hover:text-rose-600 underline">연결 끊기</button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs font-medium text-slate-700 line-clamp-3 leading-relaxed break-all whitespace-pre-wrap">
                      {q.question}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        <div className="w-20 flex flex-col justify-center items-center shrink-0">
          <div className="bg-white p-2 rounded-2xl shadow-md border border-slate-200 flex flex-col gap-2 relative">
            <button onClick={handleLink} disabled={!selectedMainId || selectedWbIds.length === 0} className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center transition-all shadow-sm ${selectedMainId && selectedWbIds.length > 0 ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white cursor-pointer hover:scale-105 active:scale-95' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`}>
              <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
              <span className="text-[9px] font-black">묶기</span>
            </button>
            <div className="text-center mt-1">
              <div className="text-[9px] font-bold text-slate-400 mb-0.5">선택 타겟</div>
              <div className="text-xs font-black text-indigo-600">{selectedWbIds.length}개</div>
            </div>
          </div>
        </div>

        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          <div className="p-3 bg-emerald-50/80 border-b border-emerald-100 flex justify-between items-center shrink-0">
            <h2 className="font-extrabold text-emerald-900 text-sm">📗 마스터DB 워크북 (question_db)</h2>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100/50 border border-emerald-200 px-2 py-1 rounded-md">수동 연결 시 대상 클릭</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scroll bg-slate-50/30">
            {!selectedWbSource ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">워크북 소스(source_book_name)를 선택해주세요.</div>
            : wbQuestions.length === 0 ? <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">해당 소스에 등록된 문항이 없습니다.</div>
            : wbQuestions.map(q => {
                const qUuid = q.question_id;
                const isSelected = selectedWbIds.includes(qUuid);
                const mappedMainId = getMappedMainIdForWb(qUuid);
                const isMappedToOther = mappedMainId && mappedMainId !== selectedMainId;
                
                const taxDepth = getTaxParts(q.taxonomy_id).length;

                return (
                  <div key={qUuid} onClick={() => handleWbClick(qUuid)} className={`p-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm relative overflow-hidden flex items-stretch gap-3 ${isSelected ? 'border-emerald-500 bg-emerald-50' : 'border-transparent bg-white hover:border-emerald-300'} ${isMappedToOther ? 'opacity-40 grayscale' : ''}`}>
                    <div className="flex flex-col items-center justify-center">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 bg-white'}`}>
                        {isSelected && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{q.final_printed_page || q.detected_page_num}p</span>
                          <span className={`text-xs font-black ${isSelected ? 'text-emerald-700' : 'text-slate-800'}`}>번호: {q.question_number}-{q.sub_num}</span>
                          {taxDepth > 0 && <span className="text-[9px] font-bold text-fuchsia-600 bg-fuchsia-50 border border-fuchsia-200 px-1.5 py-0.5 rounded shadow-sm">Depth {taxDepth}</span>}
                        </div>
                        {isMappedToOther && <span className="text-[9px] font-bold text-rose-500 bg-rose-50 px-2 py-0.5 rounded border border-rose-100">타 문항에 연결됨</span>}
                      </div>
                      <div className="text-xs font-medium text-slate-700 line-clamp-3 leading-relaxed break-all whitespace-pre-wrap">
                        {q.question}
                      </div>
                      {q.pdf_source && (
                        <div className="mt-1.5 text-[9px] font-bold text-slate-400 truncate w-max max-w-full bg-white px-1.5 py-0.5 rounded border border-slate-200">
                          {q.pdf_source.replace('.pdf', '')}
                        </div>
                      )}
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