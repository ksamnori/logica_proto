"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// 환경 변수 설정
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface StudentTimelineProps {
  currentView: any;
  activeTab: string;
  dateFilter: string;
  setDateFilter: (filter: 'ALL' | '1W' | '1M') => void;
  isLoading: boolean;
  filteredTimeline: any[];
  selectedBlocks: string[];
  setSelectedBlocks: React.Dispatch<React.SetStateAction<string[]>>;
  handleSelectAllStudent: () => void;
  handleBulkCompleteStudent: () => void;
  handleBulkDeleteStudent: () => void;
  handleGenerateIncorrectPrint: () => void; 
  isGeneratingPrint: boolean;
  formatDateLabel: (dateStr: string, includeTime?: boolean) => string;
  handleForceComplete: (e: React.MouseEvent, type: string, id: string, targetStudentId: string) => void;
  handleDeleteExam: (assignmentId: string, studentId: string) => void;
  handleDeleteHomework: (hwId: string, studentId: string) => void;
  handleDeletePrint: (assignmentId: string, examId: string) => void;
}

// Taxonomy ID를 실제 이름으로 변환
const formatTaxonomyName = (id: string, categoryMap: Record<string, string>) => {
  if (!id) return "분류 없음";
  if (categoryMap && categoryMap[id]) return categoryMap[id];
  return id; 
};

export default function StudentTimeline({
  currentView, activeTab, dateFilter, setDateFilter, isLoading,
  filteredTimeline = [], selectedBlocks = [], setSelectedBlocks, handleSelectAllStudent,
  handleBulkCompleteStudent, handleBulkDeleteStudent,
  formatDateLabel, handleForceComplete, handleDeleteExam, handleDeleteHomework, handleDeletePrint
}: StudentTimelineProps) {
  
  const [modalTab, setModalTab] = useState<'TAXONOMY' | 'PERIOD' | 'SELECTED' | null>(null);
  const [isEngineRunning, setIsEngineRunning] = useState(false);

  // 💡 출제 방식 및 문제 수, 디테일 옵션 상태 관리
  const [genMethod, setGenMethod] = useState<'SAME' | 'TWIN'>('SAME');
  const [twinCount, setTwinCount] = useState<number>(1);
  const [similarCount, setSimilarCount] = useState<number>(1);
  const [difficultyOption, setDifficultyOption] = useState<string>('그대로');
  const [excludeOriginal, setExcludeOriginal] = useState<boolean>(true); // 기본: 원본 제외
  const [maxTypeLimit, setMaxTypeLimit] = useState<number>(3);
  const [isMaxTypeLimitActive, setIsMaxTypeLimitActive] = useState<boolean>(true);

  const todayDate = new Date().toISOString().split('T')[0];
  const lastMonthDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(lastMonthDate);
  const [endDate, setEndDate] = useState(todayDate);

  const [taxonomyTree, setTaxonomyTree] = useState<any>({});
  const [taxonomyStats, setTaxonomyStats] = useState<Record<string, { total: number; correct: number; pending: number }>>({});
  const [isTaxonomyLoading, setIsTaxonomyLoading] = useState(false);
  const [selectedTaxonomyIds, setSelectedTaxonomyIds] = useState<Set<string>>(new Set());

  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchMasterCategory = async () => {
      try {
        const buildMap = (dataArray: any[]) => {
          const map: Record<string, string> = {};
          dataArray.forEach(item => {
            if (!item.category_id || !item.full_path) return;
            const parts = item.category_id.split('-');
            const paths = item.full_path.split('>').map((s: string) => s.trim());
            let currentPrefix = "";

            parts.forEach((p: string, idx: number) => {
              currentPrefix = currentPrefix ? `${currentPrefix}-${p}` : p;
              const pathIdx = paths.length - parts.length + idx;
              if (pathIdx >= 0 && paths[pathIdx]) {
                let name = paths[pathIdx];
                if (idx === 0 && pathIdx >= 1) {
                  const grade = paths[pathIdx - 1].replace(/초등학교 |중학교 |고등학교 /g, '');
                  name = `[${grade}] ${name}`;
                }
                map[currentPrefix] = name;
              }
            });
          });
          return map;
        };

        let finalMap: Record<string, string> = {};
        const { data: fileData, error: fileError } = await supabaseClient.storage.from('system_data').download('master_category.json');
        if (!fileError && fileData) {
          const text = await fileData.text();
          const json = JSON.parse(text);
          const dataArray = Array.isArray(json) ? json : Object.values(json);
          finalMap = buildMap(dataArray);
        }

        if (Object.keys(finalMap).length === 0) {
          let allData: any[] = [];
          let from = 0;
          while (true) {
            const { data, error } = await supabaseClient.from('master_category').select('category_id, full_path').range(from, from + 999);
            if (error || !data || data.length === 0) break;
            allData = allData.concat(data);
            if (data.length < 1000) break;
            from += 1000;
          }
          finalMap = buildMap(allData);
        }

        setCategoryMap(finalMap);
      } catch (err) {
        console.error("마스터 카테고리 로딩 실패:", err);
      }
    };
    fetchMasterCategory();
  }, []);

  useEffect(() => {
    if (modalTab === 'TAXONOMY' && currentView?.studentId) {
      loadTaxonomyData();
    }
  }, [modalTab, currentView?.studentId]);

  const loadTaxonomyData = async () => {
    setIsTaxonomyLoading(true);
    try {
      const { data: ansData } = await supabaseClient
        .from('student_answer')
        .select('is_correct, question_db(taxonomy_id)')
        .eq('student_id', currentView.studentId)
        .not('question_db', 'is', null);

      const { data: incData } = await supabaseClient
        .from('student_incorrect_record')
        .select('question_db(taxonomy_id)')
        .eq('student_id', currentView.studentId)
        .is('resolved_at', null)
        .not('question_db', 'is', null);

      const stats: Record<string, { total: number; correct: number; pending: number }> = {};
      
      const addStat = (taxId: string, isCorrect?: boolean, isPending?: boolean) => {
        if (!taxId) return;
        const parts = taxId.split('-');
        for (let i = 1; i <= Math.min(parts.length, 7); i++) {
          const prefix = parts.slice(0, i).join('-');
          if (!stats[prefix]) stats[prefix] = { total: 0, correct: 0, pending: 0 };
          if (isCorrect !== undefined) {
            stats[prefix].total += 1;
            if (isCorrect) stats[prefix].correct += 1;
          }
          if (isPending) stats[prefix].pending += 1;
        }
      };

      ansData?.forEach((row: any) => {
          const qDb = Array.isArray(row.question_db) ? row.question_db[0] : row.question_db;
          addStat(qDb?.taxonomy_id, row.is_correct, false);
      });

      incData?.forEach((row: any) => {
          const qDb = Array.isArray(row.question_db) ? row.question_db[0] : row.question_db;
          addStat(qDb?.taxonomy_id, undefined, true);
      });

      setTaxonomyStats(stats);

      const tree: any = {};
      Object.keys(stats).forEach(prefix => {
          const parts = prefix.split('-');
          let currentLevel = tree;
          let currentPrefix = "";
          parts.forEach((part, idx) => {
              currentPrefix = currentPrefix ? `${currentPrefix}-${part}` : part;
              if (!currentLevel[currentPrefix]) {
                  currentLevel[currentPrefix] = { children: {} };
              }
              if (idx < parts.length - 1) {
                  currentLevel = currentLevel[currentPrefix].children;
              }
          });
      });

      setTaxonomyTree(tree);
    } catch (e) {
      console.error("분류 체계 로딩 오류:", e);
    } finally {
      setIsTaxonomyLoading(false);
    }
  };

  const toggleTaxNode = (prefix: string, isChecked: boolean) => {
    setSelectedTaxonomyIds(prev => {
      const next = new Set(prev);
      const allKeys = Object.keys(taxonomyStats);

      if (isChecked) {
        allKeys.forEach(k => {
          if (k === prefix || k.startsWith(prefix + '-')) next.add(k);
        });
      } else {
        allKeys.forEach(k => {
          if (k === prefix || k.startsWith(prefix + '-')) next.delete(k);
        });
        const parts = prefix.split('-');
        let ancestor = '';
        parts.forEach(p => {
          ancestor = ancestor ? `${ancestor}-${p}` : p;
          next.delete(ancestor);
        });
      }
      return next;
    });
  };

  const openModal = (tab: 'TAXONOMY' | 'PERIOD' | 'SELECTED') => {
    if (tab === 'SELECTED' && selectedBlocks.length === 0) {
      alert('먼저 오답을 추출할 학습지(블록)를 타임라인에서 체크해주세요!');
      return;
    }
    setModalTab(tab);
  };

  // 💡 [핵심] 원본 오답 개수 파악
  const getBasePendingCount = () => {
    if (modalTab === 'TAXONOMY') {
      const selectedArray = Array.from(selectedTaxonomyIds).sort();
      const topLevelSelected = selectedArray.filter(id => {
         return !selectedArray.some(otherId => id !== otherId && id.startsWith(otherId + '-'));
      });
      return topLevelSelected.reduce((acc, id) => acc + (taxonomyStats[id]?.pending || 0), 0);
    } else if (modalTab === 'SELECTED') {
      return filteredTimeline.filter(item => selectedBlocks.includes(item.id)).reduce((acc, curr) => acc + (curr.xCount || 0), 0);
    } else if (modalTab === 'PERIOD') {
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime() + 86400000;
      return filteredTimeline.filter(item => {
         const t = new Date(item.date).getTime();
         return t >= start && t < end;
      }).reduce((acc, curr) => acc + (curr.xCount || 0), 0);
    }
    return 0;
  };

  const basePendingCount = getBasePendingCount();
  
  // 💡 [핵심 완벽 적용] 실시간 오답 개수 로직: 드롭다운 수치에 따라 즉시 100% 반영됨!
  let finalQuestionCount = 0;
  if (genMethod === 'SAME') {
    finalQuestionCount = basePendingCount;
  } else {
    // 쌍둥이/유사 출제 모드일 경우: (원본 수 × 쌍둥이 수) + (원본 수 × 유사 수)
    finalQuestionCount = (basePendingCount * twinCount) + (basePendingCount * similarCount);
    // 기존 문제 제외를 해제했을 경우, 원본 문제 개수도 학습지에 더해줍니다.
    if (!excludeOriginal) {
      finalQuestionCount += basePendingCount; 
    }
  }

  // (만약 TAXONOMY 모드이고 유형별 제한이 켜져있다면, 각 유형별로 제한을 씌워 더 정확하게 깎아줍니다)
  if (modalTab === 'TAXONOMY' && isMaxTypeLimitActive && genMethod === 'TWIN') {
     const selectedArray = Array.from(selectedTaxonomyIds).sort();
     const topLevelSelected = selectedArray.filter(id => !selectedArray.some(otherId => id !== otherId && id.startsWith(otherId + '-')));
     let cappedTotal = 0;
     topLevelSelected.forEach(id => {
        let pending = taxonomyStats[id]?.pending || 0;
        let expected = (pending * twinCount) + (pending * similarCount);
        if (!excludeOriginal) expected += pending;
        cappedTotal += Math.min(expected, maxTypeLimit);
     });
     finalQuestionCount = cappedTotal;
  }

  // 💡 [핵심] 편집 후 만들기 라우팅 로직 (데이터 풀패키지 전달)
  const handleEditAndCreate = () => {
    if (finalQuestionCount === 0) return alert("추출할 오답 문항이 없습니다. 세팅을 확인해주세요.");
    
    // 현재 세팅된 모든 값들을 스토리지에 상세하게 담아 step2로 넘깁니다.
    const payload = {
      studentId: currentView?.studentId,
      studentName: currentView?.studentName,
      sourceMode: modalTab,
      basePendingCount, // 💡 Step2에서 참고할 수 있도록 원본 갯수도 명시
      finalQuestionCount, // 💡 Step2에서 목표로 삼을 최종 갯수 명시
      selectedTaxonomyIds: Array.from(selectedTaxonomyIds),
      selectedBlocks,
      startDate,
      endDate,
      genMethod,
      twinCount,      // 💡 선택한 쌍둥이 배수
      similarCount,   // 💡 선택한 유사 배수
      difficultyOption,
      excludeOriginal,
      isMaxTypeLimitActive,
      maxTypeLimit
    };
    
    sessionStorage.setItem('logica_clinic_pending_print', JSON.stringify(payload));
    window.location.href = '/exam/step2?source=clinic_incorrect';
  };

  const handleCreatePrint = async () => {
    if (finalQuestionCount === 0) return alert("추출할 오답 문항이 0개입니다. 조건이나 문제 수를 확인해주세요.");
    setIsEngineRunning(true);
    
    try {
      // 오해를 유발했던 DB 풀(Pool) 알림창은 제거하고, 정확한 타겟팅 알림창으로 변경했습니다.
      alert(
        `[자동 출제 시스템 가동 🚀]\n\n` +
        `설정하신 조건에 따라 총 ${finalQuestionCount}개의 맞춤형 유사/쌍둥이 문항을 구성하여 3라운드 클리닉 패드로 전송합니다.\n` +
        `(실제 DB 문항 보유 상황에 따라 최종 생성 개수는 일부 조정될 수 있습니다.)`
      );

      // (추후 여기에 실제 서버 API 호출 로직을 결합하면 됩니다.)
      setModalTab(null);
    } catch (err) {
      console.error(err);
      alert("출제 가동 중 오류가 발생했습니다.");
    } finally {
      setIsEngineRunning(false);
    }
  };

  const renderHeader = () => {
    const isAllSelected = filteredTimeline?.length > 0 && selectedBlocks.length === filteredTimeline.length;
    return (
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
            <span className="bg-[#002864] text-white text-[11px] font-bold px-2 py-0.5 rounded shadow-sm whitespace-nowrap">{currentView?.className || '반 미지정'}</span>
            <span className="text-[#002864] whitespace-nowrap">{currentView?.studentName || '알 수 없음'}</span> 학생 전체 활동 타임라인
          </h2>
          <div className="flex bg-white border border-slate-300 rounded-lg overflow-hidden shadow-sm">
            <button onClick={() => setDateFilter('1W')} className={`px-4 py-2 text-[12px] font-bold ${dateFilter === '1W' ? 'bg-[#002864] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>1주일</button>
            <div className="w-px bg-slate-300"></div>
            <button onClick={() => setDateFilter('1M')} className={`px-4 py-2 text-[12px] font-bold ${dateFilter === '1M' ? 'bg-[#002864] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>1개월</button>
            <div className="w-px bg-slate-300"></div>
            <button onClick={() => setDateFilter('ALL')} className={`px-4 py-2 text-[12px] font-bold ${dateFilter === 'ALL' ? 'bg-[#002864] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>전체</button>
          </div>
        </div>

        <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-200 shadow-sm mt-0.5">
          <div className="flex items-center gap-3 pl-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isAllSelected} onChange={handleSelectAllStudent} className="w-5 h-5 accent-rose-500" />
              <span className="text-[13px] font-bold text-slate-700">전체 선택</span>
            </label>
            <div className="w-px h-4 bg-slate-300 mx-1"></div>
            <button onClick={handleBulkCompleteStudent} disabled={selectedBlocks.length === 0} className="px-3 py-1.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold text-[12px] disabled:opacity-40">✅ 선택 완료 ({selectedBlocks.length})</button>
            <button onClick={handleBulkDeleteStudent} disabled={selectedBlocks.length === 0} className="px-3 py-1.5 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-bold text-[12px] disabled:opacity-40">🗑️ 선택 삭제 ({selectedBlocks.length})</button>
          </div>

          <div className="flex items-center gap-2 pr-1">
            <span className="text-[12px] font-bold text-slate-500 mr-1 flex items-center gap-1">🖨️ 오답 프린트 생성 <span className="text-slate-300 ml-1">|</span></span>
            <button onClick={() => openModal('SELECTED')} className="px-3 py-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold text-[12px] transition-all shadow-sm">선택 문제지 오답</button>
            <button onClick={() => openModal('TAXONOMY')} className="px-3 py-1.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-[12px] transition-all shadow-sm">유형별 오답</button>
            <button onClick={() => openModal('PERIOD')} className="px-3 py-1.5 rounded bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 font-bold text-[12px] transition-all shadow-sm">기간별 오답</button>
          </div>
        </div>
      </div>
    );
  };

  const renderTaxonomyTree = (nodes: any, depth: number = 1) => {
    return Object.keys(nodes).sort().map(key => {
      const node = nodes[key];
      const stat = taxonomyStats[key] || { total: 0, correct: 0, pending: 0 };
      const rate = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
      const isLeaf = Object.keys(node.children).length === 0;
      
      const displayName = formatTaxonomyName(key, categoryMap);

      const progressBar = stat.total > 0 && (
        <div className="flex items-center gap-2 w-[100px] shrink-0 ml-auto mr-2">
           <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden shadow-inner">
              <div className={`h-full transition-all duration-700 ${rate >= 80 ? 'bg-emerald-400' : rate >= 50 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${rate}%` }}></div>
           </div>
           <span className={`text-[10px] font-black w-7 text-right ${rate >= 80 ? 'text-emerald-600' : rate >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>{rate}%</span>
        </div>
      );

      // 말단 노드 (폰트 사이즈 복구)
      if (isLeaf) {
        return (
          <div key={key} className="flex items-center py-1 px-1.5 ml-3 hover:bg-slate-50 rounded transition-colors group">
            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0 py-1">
              <input type="checkbox" checked={selectedTaxonomyIds.has(key)} onChange={e => toggleTaxNode(key, e.target.checked)} className="w-3.5 h-3.5 rounded border-slate-300 accent-[#002864] shrink-0 cursor-pointer" />
              <span className="text-[13px] font-semibold text-slate-600 truncate group-hover:text-[#002864] transition-colors" title={displayName}>{displayName}</span>
              {stat.pending > 0 && <span className="ml-1 text-[10px] font-extrabold text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-[1px] rounded leading-none shadow-sm">오답 {stat.pending}</span>}
            </label>
            {progressBar}
          </div>
        );
      }

      // 상위 폴더 노드 (폰트 사이즈 복구)
      return (
        <details key={key} open={depth <= 2} className={depth === 1 ? "mb-2" : "mb-1 pl-1 ml-2 border-l border-slate-200"}>
          <summary className={`cursor-pointer flex items-center py-1.5 transition-colors select-none group ${depth === 1 ? "bg-slate-50 hover:bg-slate-100 px-3 rounded-lg border border-slate-200 shadow-sm" : "hover:bg-slate-50 px-2 rounded-md"}`}>
            <svg className="w-4 h-4 text-slate-400 group-hover:text-[#002864] transition-transform details-arrow shrink-0 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
            <input type="checkbox" checked={selectedTaxonomyIds.has(key)} onChange={e => toggleTaxNode(key, e.target.checked)} onClick={e => e.stopPropagation()} className="w-3.5 h-3.5 rounded border-slate-300 accent-[#002864] shrink-0 cursor-pointer mr-2" />
            <span className={`flex-1 truncate ${depth === 1 ? "text-[14px] font-extrabold text-[#002864]" : "text-[13px] font-bold text-slate-700"}`} title={displayName}>{displayName}</span>
            {progressBar}
          </summary>
          <div className={depth === 1 ? "pl-2 mt-1 space-y-0.5" : "mt-0.5 space-y-0.5"}>
            {renderTaxonomyTree(node.children, depth + 1)}
          </div>
        </details>
      );
    });
  };

  const renderModal = () => {
    if (!modalTab) return null;

    return (
      <div className="fixed inset-0 z-[100] flex justify-center items-center bg-slate-900/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-white w-[1100px] h-[720px] max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          
          <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 bg-white shrink-0">
            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
              {currentView?.studentName} 학생 오답 관리
              {modalTab === 'TAXONOMY' && <span className="text-sm font-bold text-slate-500 ml-2">선택된 원본 오답 <span className="text-rose-500">{basePendingCount}개</span></span>}
            </h2>
            <button onClick={() => setModalTab(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* 좌측 탭 네비게이션 */}
            <div className="w-40 border-r border-slate-200 bg-slate-50 flex flex-col pt-4 shrink-0">
              <button onClick={() => setModalTab('TAXONOMY')} className={`py-4 px-5 text-left font-bold text-sm transition-all border-l-4 ${modalTab === 'TAXONOMY' ? 'border-sky-500 bg-white text-slate-800' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>단원별 취약 유형</button>
              <button onClick={() => setModalTab('PERIOD')} className={`py-4 px-5 text-left font-bold text-sm transition-all border-l-4 ${modalTab === 'PERIOD' ? 'border-sky-500 bg-white text-slate-800' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>기간별 오답</button>
              <button onClick={() => setModalTab('SELECTED')} className={`py-4 px-5 text-left font-bold text-sm transition-all border-l-4 ${modalTab === 'SELECTED' ? 'border-sky-500 bg-white text-slate-800' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>학습지별 오답</button>
            </div>

            {/* 중앙 영역 */}
            <div className="flex-1 flex flex-col bg-white overflow-hidden relative">
              <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6">
                
                {modalTab === 'TAXONOMY' && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center mb-4 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
                      <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">💡 최근 1년 내 푼 단원의 <strong className="text-slate-800">정답률(%)</strong>과 <strong className="text-rose-500">오답 수</strong>입니다.</span>
                    </div>
                    {isTaxonomyLoading ? (
                       <div className="text-center py-20 text-slate-400 font-bold animate-pulse text-sm">데이터를 분석 중입니다... 📊</div>
                    ) : Object.keys(taxonomyTree).length === 0 ? (
                       <div className="text-center py-20 text-slate-400 font-bold text-sm">학생의 학습 데이터가 없습니다.</div>
                    ) : (
                       <div className="pb-8 pl-1">
                         {renderTaxonomyTree(taxonomyTree, 1)}
                       </div>
                    )}
                  </div>
                )}

                {modalTab === 'PERIOD' && (
                  <div className="flex flex-col h-full">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-6">
                      <span className="text-xs font-bold text-slate-600 flex items-center gap-1">💡 기간의 시작일을 기준으로 <strong className="text-sky-600">최대 1년 전 오답</strong>까지 조회할 수 있습니다.</span>
                    </div>
                    <div className="flex flex-col items-center justify-center flex-1 pb-10 gap-8">
                      <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-5 w-72 relative group">
                        <div className="absolute -top-3 left-5 bg-sky-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm">시작일</div>
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full text-xl font-black text-slate-700 bg-slate-50 border-2 border-slate-100 hover:border-sky-300 rounded-lg px-4 py-3 outline-none focus:border-sky-500 transition-colors mt-2 text-center" />
                      </div>
                      <div className="w-1 h-6 bg-slate-200 rounded-full"></div>
                      <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-5 w-72 relative group">
                        <div className="absolute -top-3 left-5 bg-rose-400 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm">종료일</div>
                        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full text-xl font-black text-slate-700 bg-slate-50 border-2 border-slate-100 hover:border-rose-400 rounded-lg px-4 py-3 outline-none focus:border-rose-400 transition-colors mt-2 text-center" />
                      </div>
                    </div>
                  </div>
                )}

                {modalTab === 'SELECTED' && (
                  <div>
                    <div className="flex justify-between items-center mb-4 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
                      <span className="text-xs font-bold text-slate-600">타임라인에서 선택된 학습지 <span className="text-rose-500">{selectedBlocks.length}개</span></span>
                    </div>
                    <ul className="border border-slate-200 rounded-lg overflow-hidden">
                      {filteredTimeline.filter(item => selectedBlocks.includes(item.id)).map(item => (
                        <li key={item.id} className="px-4 py-3 border-b last:border-0 border-slate-100 flex items-center justify-between hover:bg-slate-50">
                          <span className="font-bold text-sm text-slate-700 truncate w-3/4">{item.title}</span>
                          <span className="text-xs font-bold text-rose-500 bg-rose-50 px-2 py-1 rounded border border-rose-100 shadow-sm">오답 {item.xCount}개</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              </div>
            </div>

            {/* 💡 우측 출제 옵션 패널 (줄바꿈 방지 적용) */}
            <div className="w-[420px] bg-white border-l border-slate-200 flex flex-col shrink-0 z-10 shadow-[-4px_0_15px_rgba(0,0,0,0.02)]">
              <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
                
                {/* 💡 상세 출제 설정 */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 text-[13px] font-bold text-slate-600 leading-loose shadow-sm break-keep">
                  대상 문제의 <span className="text-sky-500 font-black">쌍둥이문제</span> 
                  <select 
                    value={twinCount} 
                    onChange={e => { setTwinCount(Number(e.target.value)); setGenMethod('TWIN'); }} 
                    className="border border-slate-300 rounded-md mx-1.5 p-1 outline-none text-slate-800 bg-white focus:border-sky-500 font-black cursor-pointer shadow-sm"
                  >
                    {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>개와 <span className="text-sky-500 font-black">유사문제</span> 
                  <select 
                    value={similarCount} 
                    onChange={e => { setSimilarCount(Number(e.target.value)); setGenMethod('TWIN'); }} 
                    className="border border-slate-300 rounded-md mx-1.5 p-1 outline-none text-slate-800 bg-white focus:border-sky-500 font-black cursor-pointer shadow-sm"
                  >
                    {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>개로 학습지를 만듭니다. 유사문제 난이도는 
                  <select 
                    value={difficultyOption}
                    onChange={e => { setDifficultyOption(e.target.value); setGenMethod('TWIN'); }}
                    className="border border-slate-300 rounded-md mx-1.5 p-1 outline-none text-slate-800 bg-white focus:border-sky-500 font-black cursor-pointer shadow-sm"
                  >
                    <option value="그대로">그대로</option><option value="더 쉽게">더 쉽게</option><option value="더 어렵게">더 어렵게</option>
                  </select> 출제합니다.
                </div>

                {/* 💡 디테일 체크박스 옵션 */}
                <div className="space-y-4 mb-8 pl-1">
                  <label className="flex items-center gap-2 cursor-pointer group w-max">
                    <input type="checkbox" checked={excludeOriginal} onChange={e => setExcludeOriginal(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-sky-500" />
                    <span className="text-[14px] font-bold text-slate-700 group-hover:text-slate-900 transition-colors">기존 출제 문제 제외</span>
                  </label>
                  
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input type="checkbox" checked={isMaxTypeLimitActive} onChange={(e) => setIsMaxTypeLimitActive(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-sky-500" />
                      <span className="text-[14px] font-bold text-slate-700 group-hover:text-slate-900 transition-colors">유형별 최대 문제 수 제한</span>
                    </label>
                    <div className={`flex items-center border rounded shadow-sm overflow-hidden transition-colors ${isMaxTypeLimitActive ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                      <button onClick={() => setMaxTypeLimit(p => Math.max(1, p - 1))} disabled={!isMaxTypeLimitActive} className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 border-r border-slate-200 transition-colors font-bold disabled:opacity-40">−</button>
                      <input type="text" value={maxTypeLimit} readOnly className="w-10 text-center text-[13px] font-bold text-slate-700 outline-none bg-transparent" />
                      <button onClick={() => setMaxTypeLimit(p => p + 1)} disabled={!isMaxTypeLimitActive} className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 border-l border-slate-200 transition-colors font-bold disabled:opacity-40">+</button>
                    </div>
                    <span className="text-[14px] font-bold text-slate-700">개</span>
                  </div>
                </div>
              </div>

              {/* 💡 하단 실시간 문항 수 집계 & 버튼 영역 */}
              <div className="bg-slate-50/80 border-t border-slate-200 p-6 shrink-0 flex flex-col items-center">
                <div className="text-center flex flex-col items-center justify-center">
                  <span className="font-extrabold text-slate-800 text-base">최대 예상 문항 수</span>
                  <div className="flex items-end mt-1">
                    <span className="font-black text-4xl text-[#002864] tracking-tighter">{finalQuestionCount}</span>
                    <span className="font-extrabold text-slate-800 text-base mb-1 ml-1.5">개</span>
                  </div>
                </div>
                <div className="text-center mt-3 mb-6">
                  <span className="text-[11px] font-bold text-rose-500">※ DB 보유량에 따라 실제 생성되는 문제 수는 다를 수 있습니다.</span>
                </div>
                
                <div className="flex gap-2 w-full">
                  <button onClick={handleEditAndCreate} className="flex-1 px-4 py-3.5 bg-white border border-slate-300 rounded-xl shadow-sm hover:bg-slate-50 transition-colors text-sm font-bold text-slate-600">편집 후 만들기</button>
                  <button onClick={handleCreatePrint} disabled={isEngineRunning || finalQuestionCount === 0} className="flex-1 px-4 py-3.5 bg-sky-500 hover:bg-sky-600 border border-transparent rounded-xl shadow-md transition-colors text-sm font-extrabold text-white disabled:opacity-50">바로 만들기</button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        details > summary { list-style: none; }
        details > summary::-webkit-details-marker { display: none; }
      `}} />
      {renderHeader()}
      <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50">
        {isLoading ? (
          <div className="text-center font-bold text-slate-400 py-10 text-[13px]">타임라인을 구성하는 중입니다...</div>
        ) : filteredTimeline.length === 0 ? (
          <div className="text-center font-bold text-slate-400 py-10 text-[13px]">해당 기간에 기록된 활동이 없습니다.</div>
        ) : (
          <div className="space-y-3 pb-20">
            {filteredTimeline.map((item, idx) => {
              if (!item || !item.id || !item.type) return null;

              const isSelected = selectedBlocks.includes(item.id);
              const isCompleted = item.isCompleted;
              
              let badgeColor = "bg-slate-100 text-slate-500";
              let typeLabel = "";
              
              if (item.type === 'exam') { badgeColor = "bg-blue-100 text-blue-700 border-blue-200"; typeLabel = "📝 시험"; }
              else if (item.type.includes('hw')) { badgeColor = "bg-amber-100 text-amber-700 border-amber-200"; typeLabel = "📚 과제"; }
              else { badgeColor = "bg-emerald-100 text-emerald-700 border-emerald-200"; typeLabel = "🖨️ 오답프린트"; }

              const rowBgClass = isSelected 
                ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' 
                : isCompleted 
                  ? 'bg-slate-200/60 border-slate-300 text-slate-600 hover:bg-slate-200/80' 
                  : 'bg-white border-slate-200 hover:border-[#002864]';

              return (
                <div key={`${item.id}_${idx}`} onClick={() => setSelectedBlocks(p => p.includes(item.id) ? p.filter(id => id !== item.id) : [...p, item.id])} 
                  className={`border-2 rounded-xl p-3 flex items-center justify-between gap-3 transition-all cursor-pointer shadow-sm ${rowBgClass}`}
                >
                  <div className="flex items-center gap-3 w-1/2 min-w-0 shrink-0 flex-1">
                    <input type="checkbox" checked={isSelected} readOnly className="w-5 h-5 accent-rose-500 pointer-events-none shrink-0" />
                    <div className="w-[100px] shrink-0 text-[11px] font-bold text-slate-400 leading-tight truncate">
                      {formatDateLabel(item.date, true)} 
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold border shrink-0 whitespace-nowrap ${badgeColor}`}>{typeLabel}</span>
                    <div className="flex-1 font-extrabold text-[14px] truncate" title={item.title || '제목 없음'}>
                      {item.title || '제목 없음'}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 justify-end w-[440px]">
                    <div className="text-[12px] font-bold text-slate-500 shrink-0 w-[60px] text-right whitespace-nowrap">총 {item.total || 0}문항</div>
                    
                    <div className="flex items-center gap-1.5 shrink-0 w-[90px] justify-center">
                      <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 whitespace-nowrap">✅ {item.oCount || 0}</span>
                      <span className="text-[11px] font-bold text-rose-500 bg-rose-50 px-2 py-0.5 rounded border border-rose-100 whitespace-nowrap">❌ {item.xCount || 0}</span>
                    </div>
                    
                    <div className="flex items-center gap-1.5 shrink-0 w-[130px] justify-end">
                      <button onClick={(e) => handleForceComplete(e, item.type.includes('hw') && item.type !== 'hw_exam' ? 'hw' : 'exam', item.realId, currentView.studentId)} className="text-[11px] font-bold text-slate-600 hover:text-emerald-600 transition-colors bg-white border border-slate-200 px-2 py-0.5 rounded shadow-sm whitespace-nowrap shrink-0">
                        ✅ 완료처리
                      </button>
                      <span className={`w-[54px] text-center px-1 py-0.5 rounded text-[10px] font-extrabold whitespace-nowrap shrink-0 ${isCompleted ? 'bg-slate-300 text-slate-700 border border-slate-400' : 'bg-rose-50 text-rose-500 border border-rose-200'}`}>
                        {item.status || '미제출'}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2.5 shrink-0 border-l border-slate-300 pl-4 w-[120px] justify-end">
                      {item.type !== 'hw' && (
                        <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?id=${item.masterId}&exam_id=${item.masterId}`, '_blank'); }} className="text-[14px] hover:text-blue-600 transition-colors shrink-0">✏️</button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); if(item.type === 'exam' || item.type === 'hw_exam') handleDeleteExam(item.realId, currentView.studentId); else if(item.type.includes('hw')) handleDeleteHomework(item.realId, currentView.studentId); else if(item.type === 'print') handleDeletePrint(item.realId, item.masterId); }} className="text-[14px] hover:text-rose-500 transition-colors shrink-0">🗑️</button>
                      
                      <button onClick={(e) => { e.stopPropagation(); window.location.href = item.type.includes('hw') ? `/homework/review?homework_id=${item.realId}&student_id=${currentView.studentId}` : `/exam/review?assignment_id=${item.realId}`; }} className="text-[11px] font-bold text-slate-500 bg-slate-100 border border-slate-200 hover:bg-slate-200 px-3 py-1.5 rounded transition-colors shadow-sm ml-0.5 shrink-0 whitespace-nowrap">상세 ➔</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {renderModal()}
    </>
  );
}