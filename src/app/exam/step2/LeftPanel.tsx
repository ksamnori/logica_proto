// src/app/exam/step2/LeftPanel.tsx
import React, { useState, useMemo, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getDiffLabelByRate, getTypeName, getDepth5Name, getDepth6Name, formatText, getCleanUrl, renderParentRelations } from "./examUtils";

// 💡 [정렬 알고리즘] ID 분해 및 완벽한 숫자 정렬
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
  if (!n) return "";
  if (n.itemId) return n.itemId;
  if (n.categoryId) return n.categoryId;
  if (n.children) {
    const keys = Object.keys(n.children);
    for (let i = 0; i < keys.length; i++) {
      const id = getRepresentativeId(n.children[keys[i]]);
      if (id) return id;
    }
  }
  for (const k in n) {
    if (k !== 'itemId' && k !== 'categoryId' && typeof n[k] === 'object') {
      const id = getRepresentativeId(n[k]);
      if (id) return id;
    }
  }
  return "";
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

// 💡 아코디언 트리 노드 렌더링 (대단원이 Depth 3으로 시작)
const AddTreeNode = React.memo(({ nodeKey, node, depth, selectedAddIds, toggleAddItem, toggleAddFolder }: any) => {
  const [isOpen, setIsOpen] = useState(depth <= 3);

  if (node.children) {
    const ids: string[] = [];
    const traverse = (n: any) => { if (n.itemId) ids.push(n.itemId); if (n.children) Object.values(n.children).forEach(traverse); };
    traverse(node);
    
    const checkedCount = ids.filter((id: string) => selectedAddIds.has(id)).length;
    const isChecked = checkedCount > 0 && checkedCount === ids.length;
    const isIndeterminate = checkedCount > 0 && checkedCount < ids.length;

    return (
      <details open={isOpen} onToggle={(e: any) => setIsOpen(e.currentTarget.open)} className={depth === 3 ? "mb-2" : "mb-1 pl-1 ml-2 border-l border-slate-200"}>
        <summary className={depth === 3 ? "font-bold text-[16px] cursor-pointer py-2 bg-slate-100 px-3 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-2 text-[#002864]" : "flex items-center space-x-2 p-1.5 hover:bg-blue-50 rounded-lg transition-colors select-none cursor-pointer group text-slate-700 font-bold text-[14px]"}>
          <svg className="w-4 h-4 text-slate-400 group-hover:text-blue-500 transition-transform details-arrow shrink-0" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
          <input type="checkbox" ref={el => { if (el) el.indeterminate = isIndeterminate; }} checked={isChecked} onChange={e => toggleAddFolder(node, e.target.checked)} onClick={e => e.stopPropagation()} className="w-4 h-4 rounded border-slate-300 accent-[#002864] cursor-pointer shrink-0" />
          <span className="truncate">{nodeKey}</span>
        </summary>
        {isOpen && (
          <div className={depth === 3 ? "pl-2 mt-2 space-y-1" : "ml-4 mt-1 space-y-1"}>
            {Object.keys(node.children).sort((a, b) => compareNodes(a, node.children[a], b, node.children[b])).map(k => (
              <AddTreeNode key={k} nodeKey={k} node={node.children[k]} depth={depth + 1} selectedAddIds={selectedAddIds} toggleAddItem={toggleAddItem} toggleAddFolder={toggleAddFolder} />
            ))}
          </div>
        )}
      </details>
    );
  } else {
    return (
      <label className="flex items-center gap-2 py-1.5 px-3 ml-4 hover:bg-emerald-50 rounded-lg text-[13px] text-slate-600 transition-colors cursor-pointer border border-transparent hover:border-emerald-100">
        <input type="checkbox" checked={selectedAddIds.has(node.itemId)} onChange={e => toggleAddItem(node.itemId, e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-emerald-600 shrink-0 cursor-pointer" />
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

  // 💡 [핵심 추가] 상단 버튼 탭을 위한 로컬 상태 관리 (학교 / 학년-학기)
  const [currentAddD1, setCurrentAddD1] = useState<string>('중학교');
  const [currentAddD2, setCurrentAddD2] = useState<string>('');

  // 💡 데이터 로딩 시 또는 상위 탭(D1) 변경 시 하위 탭(D2) 자동 선택 로직
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

  const toggleCheck = (id: string, checked: boolean) => setCheckedIds((prev: any) => { const next = new Set(prev); checked ? next.add(id) : next.delete(id); return next; });
  const toggleAllChecks = (checked: boolean) => setCheckedIds(checked ? new Set(questions.map((q: any) => q.id)) : new Set());
  const moveSelectedToTop = () => { if(checkedIds.size > 0) setQuestions([...questions.filter((q: any) => checkedIds.has(q.id)), ...questions.filter((q: any) => !checkedIds.has(q.id))]); };
  const moveSelectedToBottom = () => { if(checkedIds.size > 0) setQuestions([...questions.filter((q: any) => !checkedIds.has(q.id)), ...questions.filter((q: any) => checkedIds.has(q.id))]); };
  const deleteSelected = () => { if(checkedIds.size > 0 && confirm("선택한 문항을 삭제하시겠습니까?")) { setQuestions(questions.filter((q: any) => !checkedIds.has(q.id))); setCheckedIds(new Set()); } };

  const searchNewQuestions = async () => {
    const selectedCatIds = Array.from(addSelectedCatIds).filter(val => val);
    if (selectedCatIds.length === 0) return alert("검색할 단원이나 유형을 하나 이상 선택해주세요.");
    setShowAddResults(true); setIsSearchingNew(true);
    try {
      let allSearched: any[] = [];
      for (let i = 0; i < selectedCatIds.length; i += 50) {
        const chunk = selectedCatIds.slice(i, i + 50);
        const { data, error } = await supabase.from('question_db').select('*').or(`item_id.in.(${chunk.join(',')}),taxonomy_id.in.(${chunk.join(',')}),thk_taxonomy_id.in.(${chunk.join(',')})`).limit(300);
        if (error) throw error;
        if (data) allSearched = allSearched.concat(data);
      }
      const existingIds = new Set(questions.flatMap((g: any) => g.items.map((i:any) => i.question_id)));
      let newQs = allSearched.filter(q => !existingIds.has(q.question_id) && !q.is_hidden && q.is_hidden !== 'Y');
      newQs = newQs.sort(() => 0.5 - Math.random()).slice(0, 50); 
      await fetchDepthMappings(newQs); await fetchParentSources(newQs);
      setNewSearchResults(newQs);
    } catch (e) { alert("검색 오류"); } finally { setIsSearchingNew(false); }
  };

  const addNewQuestionToExam = (q: any) => {
    const cloned = JSON.parse(JSON.stringify(q));
    const newGroup = { id: `single_${cloned.question_id}_${Date.now()}`, is_group: false, items: [cloned] };
    setQuestions((prev: any) => [...prev, newGroup]);
    setNewSearchResults((prev: any) => prev.filter((item: any) => item.question_id !== q.question_id));
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
          <button onClick={() => { setLeftTab("list"); setShowAddResults(false); }} className={`flex-1 py-3 text-[14px] font-extrabold transition-all ${leftTab === "list" ? "text-[#002864] border-b-[3px] border-[#002864] bg-white" : "text-slate-400 hover:text-slate-600 bg-slate-50 border-b-[3px] border-transparent hover:bg-white"}`}>문항 목록 / 통계</button>
          <button onClick={() => setLeftTab("add")} className={`flex-1 py-3 text-[14px] font-extrabold transition-all ${leftTab === "add" ? "text-[#002864] border-b-[3px] border-[#002864] bg-white" : "text-slate-400 hover:text-slate-600 bg-slate-50 border-b-[3px] border-transparent hover:bg-white"}`}>새 문제 추가</button>
        </div>
      )}

      {/* 탭 1: 문항 목록 및 통계 */}
      {leftTab === "list" && !twinViewOpen && (
        <div className="flex-1 flex flex-col overflow-hidden bg-white min-h-0">
          <div className="px-6 py-5 shrink-0 border-b border-slate-200 bg-white">
            <div className="flex justify-between items-end mb-4">
              <span className="text-slate-800 font-extrabold text-lg">📊 출제 통계 요약</span>
              <div className="text-right">
                <span className="text-slate-400 font-bold text-sm">학습지 문제 수</span>
                <span className="text-3xl font-extrabold text-[#002864] ml-2">{questions.length}<span className="text-base text-slate-500 ml-1">제</span></span>
              </div>
            </div>
            <div className="flex justify-around items-stretch h-28 px-4 pb-2 mt-2 border-b border-slate-100">
              {stats.map((st, i) => {
                const colors = ["bg-slate-300 text-slate-400", "bg-sky-400 text-sky-500", "bg-blue-500 text-blue-600", "bg-indigo-500 text-indigo-500", "bg-rose-500 text-rose-500"];
                const labelColors = ["text-slate-500", "text-sky-600", "text-blue-700", "text-indigo-600", "text-rose-600"];
                return (
                  <div key={st.label} className="flex flex-col items-center justify-end h-full w-1/5">
                    <span className={`text-[11px] font-bold ${colors[i].split(' ')[1]}`}>{st.pct}%</span>
                    <div className="flex-1 w-full flex flex-col justify-end items-center mt-1">
                      <div className={`w-8 rounded-t-md transition-all duration-700 shadow-inner ${colors[i].split(' ')[0]}`} style={{ height: `${st.hPct}%`, minHeight: '4px' }}></div>
                    </div>
                    <span className={`text-[13px] font-extrabold mt-1 ${labelColors[i]}`}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="relative flex-1 bg-slate-50 min-h-0">
            <div className="absolute inset-0 overflow-y-auto custom-scrollbar flex flex-col pb-6">
              <div className="sticky top-0 bg-slate-50/95 backdrop-blur-sm px-5 py-3 border-b border-slate-200 z-20 shadow-sm flex flex-col gap-3 shrink-0">
                <div className="flex justify-between items-center">
                  <h4 className="font-bold text-slate-700 text-sm">문제 목록 및 순서</h4>
                  <span className="text-xs font-bold text-blue-500 bg-blue-100 border border-blue-200 px-2 py-1 rounded">✋ 드래그하거나 선택하여 이동</span>
                </div>
                <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                  <label className="flex items-center space-x-2 px-1 cursor-pointer">
                    <input type="checkbox" checked={questions.length > 0 && checkedIds.size === questions.length} onChange={(e) => toggleAllChecks(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-[#002864] cursor-pointer" />
                    <span className="text-[13px] font-extrabold text-slate-600">전체 선택</span>
                  </label>
                  <div className="flex space-x-1.5">
                    <button onClick={moveSelectedToTop} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold rounded border border-slate-200 transition-colors">↑ 맨 위로</button>
                    <button onClick={moveSelectedToBottom} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold rounded border border-slate-200 transition-colors">↓ 맨 아래로</button>
                    <button onClick={deleteSelected} className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[11px] font-bold rounded border border-rose-200 transition-colors">🗑️ 삭제</button>
                  </div>
                </div>
              </div>
              <ul className="p-4 space-y-2">
                {questions.map((g: any, idx: number) => {
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
                    <li key={g.id} draggable onDragStart={(e) => handleDragStart(e, idx)} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, idx)}
                        className={`flex items-center justify-between bg-white hover:bg-blue-50 p-2.5 rounded-xl border transition-all shadow-sm ${draggedIdx === idx ? 'opacity-50 border-blue-400' : 'border-slate-200'}`}>
                      <div className="flex items-center space-x-2 w-[55%]">
                        <input type="checkbox" checked={checkedIds.has(g.id)} onChange={(e) => toggleCheck(g.id, e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-[#002864] shrink-0 cursor-pointer" />
                        <div className="p-1 text-slate-300 hover:text-blue-500 hover:bg-blue-100 rounded cursor-grab" title="드래그하여 순서 변경"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg></div>
                        <span className="font-extrabold text-[#002864] text-[15px] w-5 text-center cursor-pointer" onClick={() => document.getElementById(`problem-card-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{idx + 1}</span>
                        <div className="flex items-center space-x-1.5 overflow-hidden">
                          <span className="text-[11px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold border border-slate-200 whitespace-nowrap">{typeName}</span>
                          <span className={`text-[12px] font-extrabold px-1 border-l-2 ${diffColor}`}>{diff}</span>
                        </div>
                      </div>
                      <div className="text-[12px] text-slate-600 font-bold truncate w-[45%] text-right cursor-pointer" title={depth5Name} onClick={() => document.getElementById(`problem-card-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{depth5Name}</div>
                    </li>
                  );
                })}
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
                  <h3 className="font-extrabold text-lg flex items-center gap-2">🔍 새로운 문항 검색</h3>
                  <p className="text-xs text-slate-400 font-bold mt-1">단원이나 유형을 선택하여 문항을 검색하세요.</p>
                </div>
                <button onClick={searchNewQuestions} className="px-5 py-2.5 bg-[#002864] text-white text-sm font-extrabold rounded-lg shadow-sm hover:bg-blue-900 transition-colors">문항 검색하기</button>
              </div>

              {/* 💡 [핵심 변경] Step 1 스타일의 상단 탭 및 버튼 영역 추가 */}
              {!addMasterData ? (
                <div className="flex-1 flex items-center justify-center text-slate-400 font-bold">분류 체계를 불러오는 중...</div>
              ) : (
                <>
                  <div className="shrink-0 border-b border-slate-200 bg-white shadow-sm z-10">
                    <div className="flex px-4 pt-4 space-x-5 border-b border-slate-100 overflow-x-auto whitespace-nowrap no-scrollbar">
                      {Object.keys(addMasterData).sort(sortD1).map(d1 => (
                        <button key={d1} onClick={() => setCurrentAddD1(d1)} className={`pb-3 px-2 text-base font-bold border-b-4 transition-colors ${currentAddD1 === d1 ? 'border-[#002864] text-[#002864]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>{d1}</button>
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
                          // 💡 트리 렌더링 시작을 Depth 3(대단원)으로 지정
                          <AddTreeNode key={k} nodeKey={k} node={addMasterData[currentAddD1].children[currentAddD2].children[k]} depth={3} selectedAddIds={addSelectedCatIds} 
                            toggleAddItem={(id: string, chk: boolean) => setAddSelectedCatIds((prev:any) => { const n = new Set(prev); chk ? n.add(id) : n.delete(id); return n; })} 
                            toggleAddFolder={(node: any, chk: boolean) => { const ids: string[] = []; const trav = (n: any) => { if(n.itemId) ids.push(n.itemId); if(n.children) Object.values(n.children).forEach(trav); }; trav(node); setAddSelectedCatIds((prev:any) => { const n = new Set(prev); ids.forEach((id: string) => chk ? n.add(id) : n.delete(id)); return n; }); }} />
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
              <div className="px-6 py-4 bg-white border-b border-slate-200 flex justify-between items-center shrink-0 shadow-sm">
                <div><h3 className="font-extrabold text-lg flex items-center gap-2">📑 문항 검색 결과 <span className="text-[#002864] bg-blue-50 px-2 py-0.5 rounded text-sm">{newSearchResults.length}</span></h3></div>
                <button onClick={() => setShowAddResults(false)} className="px-4 py-2 bg-slate-100 text-slate-600 text-sm font-extrabold rounded-lg border border-slate-300 hover:bg-slate-200 transition-colors">⟵ 다시 선택</button>
              </div>
              <div className="relative flex-1 bg-slate-50 min-h-0">
                <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6 space-y-4">
                  {isSearchingNew ? <div className="text-center py-20 font-bold text-slate-400">문제를 검색 중입니다...</div> :
                   newSearchResults.length === 0 ? <div className="text-center py-10 font-bold text-slate-400">조건에 맞는 새로운 문항이 없습니다.</div> :
                   newSearchResults.map((q: any) => {
                     const d = q.difficulty || getDiffLabelByRate(q.solving_probability);
                     const d6 = getDepth6Name(q, depth6Map);
                     let diffColor = "text-blue-500 bg-blue-50 border-blue-100";
                     if(d === '최하') diffColor = "text-slate-500 bg-slate-100 border-slate-200";
                     else if(d === '하') diffColor = "text-sky-500 bg-sky-50 border-sky-100";
                     else if(d === '상') diffColor = "text-indigo-500 bg-indigo-50 border-indigo-100";
                     else if(d === '최상') diffColor = "text-rose-500 bg-rose-50 border-rose-100";

                     return (
                       <div key={q.question_id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm relative hover:border-[#002864] transition-colors group">
                         <div className="flex justify-between items-start mb-3 border-b border-slate-100 pb-3">
                           <div className="flex flex-col gap-1.5">
                             <div className="flex gap-1.5 items-center">
                               <span className="text-[11px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">{getTypeName(q)}</span>
                               <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded border ${diffColor}`}>{d}</span>
                               <span className="text-[11px] font-bold text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded">{d6}</span>
                             </div>
                             {renderParentRelations(q, parentSourceMap)}
                           </div>
                           <button onClick={() => addNewQuestionToExam(q)} className="bg-[#002864] hover:bg-blue-900 text-white text-[12px] font-bold px-4 py-2 rounded shadow-sm transition-colors shrink-0">➕ 추가</button>
                         </div>
                         <div className="font-myungjo text-[15px] font-semibold leading-[2.0] text-slate-800 break-keep" dangerouslySetInnerHTML={{ __html: formatText(q.question) }} />
                         {q.image_url && <img src={getCleanUrl(q.image_url)} className="max-h-32 mt-3 mix-blend-multiply border border-slate-200 rounded" alt="" />}
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
              <h3 className="font-extrabold text-lg flex items-center">
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
                        {isTwin ? <span className="text-[11px] bg-rose-100 text-rose-700 border border-rose-200 px-2 py-0.5 rounded font-extrabold shadow-sm">🚀 쌍둥이</span> : <span className="text-[11px] bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded font-bold shadow-sm">💡 유사</span>}
                        <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-bold shadow-sm shrink-0">{getTypeName(altQ)}</span>
                        <span className="text-[11px] text-slate-500 font-bold border border-slate-200 px-1 rounded">{altQ.difficulty || '중'}</span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => addTwinToExam(altQ)} className="px-3 py-1.5 bg-emerald-600 text-white text-[13px] font-bold rounded shadow-sm hover:bg-emerald-700">이 문항 추가</button>
                        <button onClick={() => replaceWithTwin(altQ)} className="px-3 py-1.5 bg-indigo-600 text-white text-[13px] font-bold rounded shadow-sm hover:bg-indigo-700">이 문항으로 교체</button>
                      </div>
                    </div>
                    <div className="mb-2">{renderParentRelations(altQ, parentSourceMap)}</div>
                    <div className="font-myungjo font-semibold text-[15px] text-slate-800 leading-[2.0] break-keep" dangerouslySetInnerHTML={{ __html: formatText(altQ.question) }}></div>
                    {altQ.image_url && <img src={getCleanUrl(altQ.image_url)} className="max-h-32 mt-3 mix-blend-multiply border border-slate-200 rounded" alt="Q" />}
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