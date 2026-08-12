// src/app/exam/step1/LeftPanel.tsx
import React, { useState, useMemo } from "react";
import { TEST_DATA } from "./useStep1Data";

export const getAllIds = (node: any) => {
  const ids: string[] = [];
  const traverse = (n: any) => {
    if (!n) return;
    if (n.itemId) ids.push(n.itemId);
    if (n.children) {
      Object.values(n.children).forEach(traverse);
    } else {
      for (const k in n) {
        if (k !== 'itemId' && k !== 'categoryId' && typeof n[k] === 'object') traverse(n[k]);
      }
    }
  };
  traverse(node);
  return ids;
};

// 💡 [핵심 알고리즘 1] ID 문자열을 E, 5, 1, 3, 01, 02 등 각각의 독립적인 숫자로 완벽히 분해합니다.
const parseId = (id: string) => {
  // 예: "E512-01-02..." -> match[1]='E', match[2]='5', match[3]='1', match[4]='2', match[5]='-01-02...'
  const match = String(id).trim().match(/^[\[\s]*([EMH])(\d)(\d)(\d+)(.*)/);
  if (!match) return null;
  
  const school = match[1] === 'E' ? 1 : match[1] === 'M' ? 2 : 3;
  const grade = parseInt(match[2], 10);
  const semester = parseInt(match[3], 10);
  const unit = parseInt(match[4], 10);
  
  // 대시(-) 뒤의 숫자들도 모두 분리하여 배열로 담습니다.
  const restStr = match[5];
  const restNums = restStr ? restStr.split('-').filter(Boolean).map(x => parseInt(x, 10) || 0) : [];
  
  return [school, grade, semester, unit, ...restNums];
};

// 💡 [핵심 알고리즘 2] 노드 안에 숨겨져 있는 실제 DB의 itemId를 찾아옵니다.
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

// 💡 [핵심 알고리즘 3] 분해한 ID 배열을 바탕으로 첫번째 뎁스부터 차례대로 크기를 비교합니다.
const compareNodes = (aKey: string, aNode: any, bKey: string, bNode: any) => {
  const idA = getRepresentativeId(aNode) || aKey;
  const idB = getRepresentativeId(bNode) || bKey;

  const pA = parseId(idA);
  const pB = parseId(idB);

  // 구조에 맞는 ID라면 앞에서부터 숫자로 완벽 비교
  if (pA && pB) {
    const len = Math.max(pA.length, pB.length);
    for (let i = 0; i < len; i++) {
      const valA = pA[i] !== undefined ? pA[i] : -1;
      const valB = pB[i] !== undefined ? pB[i] : -1;
      if (valA !== valB) return valA - valB;
    }
    return 0;
  }
  
  // 만약 규칙 외의 문자열(테스트용 등)이라면 자연스러운 한글/숫자 비교로 대체
  return String(aKey).localeCompare(String(bKey), 'ko', { numeric: true });
};

// 초/중/고 및 학년/학기용 정렬 헬퍼
const sortNumeric = (a: string, b: string) => String(a).localeCompare(String(b), 'ko', { numeric: true });
const sortD1 = (a: string, b: string) => {
  const weight: Record<string, number> = { '초등학교': 1, '중학교': 2, '고등학교': 3 };
  return (weight[a] || 99) - (weight[b] || 99) || sortNumeric(a, b);
};

const TreeNode = React.memo(({ nodeKey, node, depth, selectedItemIds, toggleItem, toggleFolder }: any) => {
  // 💡 요청사항 반영: 아코디언이 열리는 기본 한계를 뎁스 4(대단원)까지만 설정
  const [isOpen, setIsOpen] = useState(depth <= 4);

  if (node.children) {
    const ids: string[] = [];
    const traverse = (n: any) => { if (n.itemId) ids.push(n.itemId); if (n.children) Object.values(n.children).forEach(traverse); };
    traverse(node);
    
    const checkedCount = ids.filter((id: string) => selectedItemIds.has(id)).length;
    const isChecked = checkedCount > 0 && checkedCount === ids.length;
    const isIndeterminate = checkedCount > 0 && checkedCount < ids.length;

    return (
      <details open={isOpen} onToggle={(e: any) => setIsOpen(e.currentTarget.open)} className={depth === 4 ? "mb-2 pl-2 border-l-2 border-slate-100 ml-2" : "mb-1 pl-2 border-l border-slate-100 ml-3"}>
        <summary className="flex items-center space-x-2 p-2 hover:bg-blue-50 rounded-lg transition-colors select-none cursor-pointer group">
          <svg className="w-4 h-4 text-slate-400 group-hover:text-blue-500 transition-transform details-arrow shrink-0" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
          <input type="checkbox" ref={el => { if (el) el.indeterminate = isIndeterminate; }} checked={isChecked} onChange={e => toggleFolder(node, e.target.checked)} onClick={e => e.stopPropagation()} className="w-4 h-4 rounded border-slate-300 accent-[#002864] cursor-pointer" />
          <span className="text-slate-700 font-bold text-[14px]">{nodeKey}</span>
        </summary>
        {isOpen && (
          <div className="ml-4 mt-1 space-y-1 border-l border-slate-100 pl-2">
            {/* 자식 노드들도 완벽한 ID 기준 정렬 적용 */}
            {Object.keys(node.children).sort((a, b) => compareNodes(a, node.children[a], b, node.children[b])).map(k => (
              <TreeNode key={k} nodeKey={k} node={node.children[k]} depth={depth + 1} selectedItemIds={selectedItemIds} toggleItem={toggleItem} toggleFolder={toggleFolder} />
            ))}
          </div>
        )}
      </details>
    );
  } else {
    return (
      <label className="flex items-center space-x-3 p-1.5 hover:bg-emerald-50 rounded-md transition-colors cursor-pointer">
        <input type="checkbox" checked={selectedItemIds.has(node.itemId)} onChange={e => toggleItem(node.itemId, e.target.checked)} className="w-4 h-4 text-emerald-600 rounded border-slate-300 accent-emerald-600 cursor-pointer" />
        <span className="text-slate-600 text-sm flex-1 break-keep leading-snug">{nodeKey}</span>
      </label>
    );
  }
});

export default function LeftPanel({ step1Data }: { step1Data: any }) {
  const {
    isLoading, masterData, thinkingData, currentMode, currentD1, currentD2, setCurrentD2,
    selectedItemIds, setSelectedItemIds, searchKeyword, setSearchKeyword, searchResults,
    switchMainTab, updateD1, toggleItem, toggleFolder
  } = step1Data;

  const memoizedTree = useMemo(() => {
    if (isLoading) return <div className="flex-1 flex items-center justify-center font-bold text-slate-400">단원 트리를 불러오는 중...</div>;
    
    let targetData: any = {};
    if (currentMode === "regular") targetData = masterData[currentD1]?.[currentD2];
    else if (currentMode === "thinking") targetData = thinkingData[currentD1];
    else if (currentMode === "test") targetData = (TEST_DATA as any)[currentD1];

    if (!targetData) return <div className="p-6 text-slate-400 font-bold text-center">선택된 단원이 없습니다.</div>;

    return (
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        {/* 아코디언의 최상단 레벨(대단원)이 Depth 4에 해당하므로 depth={4} 부여 */}
        {Object.keys(targetData).sort((a, b) => compareNodes(a, targetData[a], b, targetData[b])).map(k => (
          <TreeNode key={k} nodeKey={k} node={targetData[k]} depth={4} selectedItemIds={selectedItemIds} toggleItem={toggleItem} toggleFolder={toggleFolder} />
        ))}
      </div>
    );
  }, [isLoading, masterData, thinkingData, currentMode, currentD1, currentD2, selectedItemIds]);

  return (
    <section className="w-[50%] bg-white border-r border-slate-200 flex flex-col shadow-sm z-10 min-h-0">
      <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
        <h2 className="font-extrabold text-slate-800 text-lg flex items-center gap-2"><span className="text-xl">📂</span> 문제은행 분류표</h2>
        <div className="flex bg-slate-200 p-1 rounded-lg">
          <button onClick={() => switchMainTab('regular')} className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all ${currentMode === 'regular' ? 'bg-white text-[#002864] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>정규 교과</button>
          <button onClick={() => switchMainTab('thinking')} className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all ${currentMode === 'thinking' ? 'bg-white text-[#002864] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>사고력 교과</button>
          <button onClick={() => switchMainTab('test')} className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all ${currentMode === 'test' ? 'bg-white text-[#002864] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>테스트 전용</button>
        </div>
      </div>

      <div className="px-4 py-3 bg-white border-b border-slate-100 shrink-0">
        <div className="relative">
          <input 
            type="text" value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)} 
            placeholder="단원명, 유형, 키워드를 입력하여 즉시 검색 (2글자 이상)..." 
            className="w-full bg-slate-50 border border-slate-300 text-sm font-bold rounded-lg pl-10 pr-10 py-2.5 focus:outline-none focus:border-[#002864] focus:ring-1 focus:ring-[#002864] transition-colors"
          />
          <svg className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          {searchKeyword && (
            <button onClick={() => setSearchKeyword('')} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors bg-white rounded-full p-0.5">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          )}
        </div>
      </div>

      {searchKeyword.trim() !== "" ? (
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-slate-50/50">
          <div className="text-sm font-extrabold text-[#002864] mb-3 px-1">검색 결과 {searchKeyword.trim().length >= 2 && `(${searchResults.length}건)`}</div>
          {searchKeyword.trim().length < 2 ? (
            <div className="text-center py-10 text-slate-400 font-bold">✌️ 원활한 검색을 위해 2글자 이상 입력해 주세요.</div>
          ) : searchResults.length === 0 ? (
            <div className="text-center py-10 text-slate-400 font-bold">입력하신 키워드와 일치하는 단원이나 유형이 없습니다.</div>
          ) : (
            <ul className="space-y-2">
              {searchResults.map((res: any, i: number) => {
                const ids = getAllIds(res.node);
                if (ids.length === 0) return null; 
                const checkedCount = ids.filter((id: string) => selectedItemIds.has(id)).length;
                const isChecked = checkedCount > 0 && checkedCount === ids.length;
                const isIndeterminate = checkedCount > 0 && checkedCount < ids.length;
                const depth = res.path ? res.path.split(' > ').length - 1 : 0;

                return (
                  <li key={i} style={{ marginLeft: `${depth * 24}px` }} 
                      onClick={() => setSelectedItemIds((prev:any) => { const next = new Set(prev); ids.forEach(id => !isChecked ? next.add(id) : next.delete(id)); return next; })} 
                      className={`p-3 bg-white border rounded-lg cursor-pointer flex items-start gap-3 transition-colors ${isChecked ? 'border-emerald-400 bg-emerald-50/30' : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50'}`}>
                    <input type="checkbox" readOnly checked={isChecked} ref={el => { if(el) el.indeterminate = isIndeterminate; }} className="mt-1 w-4 h-4 rounded border-slate-300 accent-emerald-600 cursor-pointer pointer-events-none shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[14px] font-extrabold truncate ${isChecked ? 'text-emerald-700' : 'text-slate-700'}`}>{res.title}</div>
                      <div className="text-[11px] font-bold text-slate-400 mt-1 truncate">{res.path}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-slate-200 bg-white">
            <div className="flex px-4 pt-4 space-x-5 border-b border-slate-100 overflow-x-auto whitespace-nowrap no-scrollbar">
              {currentMode === 'regular' && Object.keys(masterData).sort(sortD1).map(d1 => (
                <button key={d1} onClick={() => updateD1(d1)} className={`pb-3 px-2 text-base font-bold border-b-4 transition-colors ${currentD1 === d1 ? 'border-[#002864] text-[#002864]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>{d1}</button>
              ))}
              {currentMode === 'thinking' && Object.keys(thinkingData).sort(sortD1).map(d1 => (
                <button key={d1} onClick={() => updateD1(d1)} className={`pb-3 px-2 text-base font-bold border-b-4 transition-colors ${currentD1 === d1 ? 'border-[#002864] text-[#002864]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>{d1}</button>
              ))}
              {currentMode === 'test' && Object.keys(TEST_DATA).sort(sortD1).map(d1 => (
                <button key={d1} onClick={() => updateD1(d1)} className={`pb-3 px-2 text-base font-bold border-b-4 transition-colors ${currentD1 === d1 ? 'border-[#002864] text-[#002864]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>{d1}</button>
              ))}
            </div>
            {currentMode === 'regular' && (
              <div className="flex px-4 py-3 gap-2 flex-wrap">
                {Object.keys(masterData[currentD1] || {}).sort(sortNumeric).map(d2 => (
                  <button key={d2} onClick={() => setCurrentD2(d2)} className={`w-[110px] flex justify-center items-center py-2 rounded-full text-[14px] font-bold transition-colors shrink-0 ${currentD2 === d2 ? 'bg-slate-800 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{d2}</button>
                ))}
              </div>
            )}
          </div>
          {memoizedTree}
        </>
      )}
    </section>
  );
}