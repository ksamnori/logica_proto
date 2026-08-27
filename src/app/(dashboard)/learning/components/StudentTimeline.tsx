// src/app/(dashboard)/learning/components/StudentTimeline.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

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
  handleExtractCommonHomework: () => void; 
  isGeneratingPrint: boolean;
  formatDateLabel: (dateStr: string, includeTime?: boolean) => string;
  handleForceComplete: (e: React.MouseEvent, type: string, id: string, targetStudentId: string) => void;
  handleDeleteExam: (assignmentId: string, studentId: string) => void;
  handleDeleteHomework: (hwId: string, studentId: string) => void;
  handleDeletePrint: (assignmentId: string, examId: string) => void;
  handlePrintItem: (e: React.MouseEvent, type: string, masterId: any, targetQuestions?: any[], title?: string, subTitle?: string) => void; 
  handleEditHomeworkToStep2?: (e: React.MouseEvent, type: string, hwId: any, targetQuestions?: any[], title?: string, subTitle?: string, studentName?: string, studentId?: string, classId?: string) => void; 
  handleEditExamToStep2?: (e: React.MouseEvent, assignId: any, masterId: any, title: string, subTitle: string, studentName: string, studentId: string, classId: string, examType: string) => void; 
}

const formatTaxonomyName = (id: string, categoryMap: Record<string, string>) => {
  if (!id) return "분류 없음";
  if (categoryMap && categoryMap[id]) return categoryMap[id];
  return id;
};

const getLocalDateStr = (isoString: string) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
};

const InlineCalendar = ({ label, dateValue, onDateChange, colorTheme }: { label: string, dateValue: string, onDateChange: (d: string) => void, colorTheme: 'blue' | 'red' }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date(dateValue));

  useEffect(() => {
    setCurrentMonth(new Date(dateValue));
  }, [dateValue]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const handlePrevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const handleNextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const theme = colorTheme === 'blue' ? {
    bg: 'bg-sky-500', text: 'text-sky-600', lightBg: 'bg-sky-50', border: 'border-sky-200'
  } : {
    bg: 'bg-rose-400', text: 'text-rose-500', lightBg: 'bg-rose-50', border: 'border-rose-200'
  };

  const days = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(<div key={`empty-${i}`} className="w-6 h-6"></div>);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSelected = dateValue === dateStr;
    const isToday = new Date().toISOString().split('T')[0] === dateStr;

    days.push(
      <button
        key={d}
        onClick={() => onDateChange(dateStr)}
        className={`w-6 h-6 flex items-center justify-center rounded-full text-[11px] font-bold transition-all
          ${isSelected ? `${theme.bg} text-white shadow-md transform scale-110` :
            isToday ? `${theme.text} ${theme.lightBg} border ${theme.border}` :
            `text-slate-600 hover:bg-slate-100`}`}
      >
        {d}
      </button>
    );
  }

  return (
    <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-3 w-[220px]">
      <div className="flex justify-between items-center mb-3">
        <span className={`text-[10px] font-black ${theme.text} ${theme.lightBg} px-2 py-1 rounded-md shadow-sm border ${theme.border}`}>{label}</span>
        <div className="flex items-center gap-1">
          <button onClick={handlePrevMonth} className="w-5 h-5 flex items-center justify-center hover:bg-slate-100 rounded-full text-slate-400 transition-colors text-[10px]">◀</button>
          <span className="font-extrabold text-[12px] text-slate-700 w-14 text-center">{year}.{String(month + 1).padStart(2, '0')}</span>
          <button onClick={handleNextMonth} className="w-5 h-5 flex items-center justify-center hover:bg-slate-100 rounded-full text-slate-400 transition-colors text-[10px]">▶</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1.5 text-center text-[10px] font-black text-slate-400">
        <div className="text-rose-400">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div className="text-blue-400">토</div>
      </div>
      <div className="grid grid-cols-7 gap-1 justify-items-center">
        {days}
      </div>
    </div>
  );
};

export default function StudentTimeline({
  currentView, activeTab, dateFilter, setDateFilter, isLoading,
  filteredTimeline = [], selectedBlocks = [], setSelectedBlocks, handleSelectAllStudent,
  handleBulkCompleteStudent, handleBulkDeleteStudent,
  handleGenerateIncorrectPrint, handleExtractCommonHomework, isGeneratingPrint,
  formatDateLabel, handleForceComplete, handleDeleteExam, handleDeleteHomework, handleDeletePrint, handlePrintItem, handleEditHomeworkToStep2, handleEditExamToStep2
}: StudentTimelineProps) {

  const [modalTab, setModalTab] = useState<'TAXONOMY' | 'PERIOD' | 'SELECTED' | null>(null);
  const [isEngineRunning, setIsEngineRunning] = useState(false);

  const [genMethod, setGenMethod] = useState<'SAME' | 'TWIN'>('TWIN');
  const [twinCount, setTwinCount] = useState<number>(1);
  const [similarCount, setSimilarCount] = useState<number>(1);
  const [difficultyOption, setDifficultyOption] = useState<string>('그대로');
  const [excludeOriginal, setExcludeOriginal] = useState<boolean>(true);
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
  const [allIncorrectRecords, setAllIncorrectRecords] = useState<any[]>([]);

  const [isCalculating, setIsCalculating] = useState(false);
  const [matchedCache, setMatchedCache] = useState<string[]>([]);

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
          finalMap = buildMap(Array.isArray(json) ? json : Object.values(json));
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
    if ((modalTab === 'TAXONOMY' || modalTab === 'PERIOD') && currentView?.studentId) {
      loadTaxonomyData();
    }
  }, [modalTab, currentView?.studentId]);

  const loadTaxonomyData = async () => {
    setIsTaxonomyLoading(true);
    try {
      const { data: statsData, error: statsErr } = await supabaseClient.rpc('get_taxonomy_stats', { p_student_id: currentView.studentId });

      if (!statsErr && statsData) {
        const stats: Record<string, { total: number; correct: number; pending: number }> = {};

        statsData.forEach((row: any) => {
          const parts = (row.taxonomy_id || '').split('-');
          for (let i = 1; i <= Math.min(parts.length, 5); i++) {
            const prefix = parts.slice(0, i).join('-');
            if (!stats[prefix]) stats[prefix] = { total: 0, correct: 0, pending: 0 };
            stats[prefix].total += Number(row.total_cnt);
            stats[prefix].correct += Number(row.correct_cnt);
            stats[prefix].pending += Number(row.pending_cnt);
          }
        });

        setTaxonomyStats(stats);

        const tree: any = {};
        Object.keys(stats).forEach(prefix => {
            const parts = prefix.split('-');
            let currentLevel = tree;
            let currentPrefix = "";
            parts.forEach((part, idx) => {
                currentPrefix = currentPrefix ? `${currentPrefix}-${part}` : part;
                if (!currentLevel[currentPrefix]) currentLevel[currentPrefix] = { children: {} };
                if (idx < parts.length - 1) currentLevel = currentLevel[currentPrefix].children;
            });
        });
        setTaxonomyTree(tree);
      }

      const { data: incData } = await supabaseClient.from('student_incorrect_record')
        .select('record_id, question_id, created_at, question_db!inner(taxonomy_id, difficulty)')
        .eq('student_id', currentView.studentId)
        .is('resolved_at', null);

      setAllIncorrectRecords(incData || []);
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
        allKeys.forEach(k => { if (k === prefix || k.startsWith(prefix + '-')) next.add(k); });
      } else {
        allKeys.forEach(k => { if (k === prefix || k.startsWith(prefix + '-')) next.delete(k); });
        const parts = prefix.split('-');
        let ancestor = '';
        parts.forEach(p => { ancestor = ancestor ? `${ancestor}-${p}` : p; next.delete(ancestor); });
      }
      return next;
    });
  };

  const openModal = (tab: 'TAXONOMY' | 'PERIOD' | 'SELECTED') => {
    if (tab === 'SELECTED' && selectedBlocks.length === 0) return alert('먼저 타임라인에서 학습지를 체크해주세요!');
    setModalTab(tab);
  };

  const getBasePendingCount = () => {
    if (modalTab === 'TAXONOMY') {
      const selectedArray = Array.from(selectedTaxonomyIds).sort();
      const topLevelSelected = selectedArray.filter(id => !selectedArray.some(otherId => id !== otherId && id.startsWith(otherId + '-')));
      return topLevelSelected.reduce((acc, id) => acc + (taxonomyStats[id]?.pending || 0), 0);
    } else if (modalTab === 'SELECTED') {
      return filteredTimeline.filter(item => selectedBlocks.includes(item.id)).reduce((acc, curr) => acc + (curr.xCount || 0), 0);
    } else if (modalTab === 'PERIOD') {
      const targetWQs = allIncorrectRecords.filter(r => {
         const localDate = getLocalDateStr(r.created_at);
         return localDate >= startDate && localDate <= endDate;
      });
      const uniqueQids = new Set(targetWQs.map(r => r.question_id));
      return uniqueQids.size;
    }
    return 0;
  };

  const basePendingCount = getBasePendingCount();

  let expectedFinalCount = 0;
  if (genMethod === 'SAME') {
    expectedFinalCount = basePendingCount;
  } else {
    expectedFinalCount = (basePendingCount * twinCount) + (basePendingCount * similarCount);
    if (!excludeOriginal) expectedFinalCount += basePendingCount;
  }

  useEffect(() => {
    if (!modalTab || expectedFinalCount === 0) {
      setMatchedCache([]);
      return;
    }
    setIsCalculating(true);
    const timer = setTimeout(() => { calculateExactMatches(); }, 300);
    return () => clearTimeout(timer);
  }, [selectedTaxonomyIds, selectedBlocks, modalTab, twinCount, similarCount, difficultyOption, excludeOriginal, genMethod, isMaxTypeLimitActive, maxTypeLimit, startDate, endDate, expectedFinalCount]);

  const calculateExactMatches = async () => {
    try {
      let uniqueQids: string[] = [];

      if (modalTab === 'TAXONOMY') {
          const selArr = Array.from(selectedTaxonomyIds);
          const targetWQs = allIncorrectRecords.filter(r => {
              const tax = Array.isArray(r.question_db) ? r.question_db[0]?.taxonomy_id : r.question_db?.taxonomy_id;
              if (!tax) return false;
              return selArr.some(sel => tax.startsWith(sel));
          });
          uniqueQids = Array.from(new Set(targetWQs.map(r => r.question_id)));
      } else if (modalTab === 'PERIOD') {
          const targetWQs = allIncorrectRecords.filter(r => {
              const localDate = getLocalDateStr(r.created_at);
              return localDate >= startDate && localDate <= endDate;
          });
          uniqueQids = Array.from(new Set(targetWQs.map(r => r.question_id)));
      } else if (modalTab === 'SELECTED') {
          let tempQIds: string[] = [];
          for (const block of selectedBlocks) {
            // 시험 및 오답, 유사프린트 계열
            if (block.startsWith('exam_') || block.startsWith('hw_exam_') || block.startsWith('print_') || block.startsWith('similar_')) {
              const assignId = block.split('_').reverse()[1]; 
              const { data: ans } = await supabaseClient.from('student_answer')
                .select('question_id')
                .eq('exam_assignment_id', assignId)
                .in('grading_code', ['X', 'TX', '☆', 'B']);
              ans?.forEach(a => { if (a.question_id) tempQIds.push(a.question_id); });
            } 
            // 일반 교재 과제 계열
            else if (block.startsWith('hw_')) {
              const hwId = block.split('_')[1];
              const { data: hwAns } = await supabaseClient.from('student_homework_answer')
                .select('tq_id, question_id')
                .eq('homework_id', hwId)
                .eq('student_id', currentView.studentId)
                .in('grading_code', ['X', 'TX', '☆', 'B']);

              if (hwAns && hwAns.length > 0) {
                const tqIds = hwAns.map(a => a.tq_id).filter(Boolean);
                if (tqIds.length > 0) {
                  const { data: tqs } = await supabaseClient.from('textbook_question').select('question_id').in('tq_id', tqIds);
                  tqs?.forEach(t => { if(t.question_id) tempQIds.push(t.question_id); });
                }
                hwAns.forEach(a => { if (a.question_id) tempQIds.push(a.question_id); });
              }
            }
          }
          uniqueQids = Array.from(new Set(tempQIds.filter(Boolean)));
      }

      if (uniqueQids.length === 0) { setMatchedCache([]); setIsCalculating(false); return; }
      if (genMethod === 'SAME') { setMatchedCache(uniqueQids); setIsCalculating(false); return; }

      const { data: matchedIds, error } = await supabaseClient.rpc('get_clinic_matches', {
        p_target_qids: uniqueQids,
        p_twin_count: twinCount,
        p_sim_count: similarCount,
        p_diff_opt: difficultyOption,
        p_exclude_orig: excludeOriginal,
        p_max_limit: maxTypeLimit,
        p_is_limit_active: isMaxTypeLimitActive
      });

      if (error) {
        console.error("Match Engine RPC Error:", error);
        setMatchedCache([]);
      } else {
        setMatchedCache(matchedIds || []);
      }
    } catch (err) {
      console.error("Calculate Catch Error:", err);
    } finally {
      setIsCalculating(false);
    }
  };

  const handleEditAndCreate = async () => {
    if (matchedCache.length === 0) return alert("추출 조건에 부합하는 문제가 없습니다. 세팅을 확인해주세요.");

    let subTitle = '맞춤 오답 복습';
    if (modalTab === 'TAXONOMY') subTitle = '단원별 취약 유형 복습';
    else if (modalTab === 'PERIOD') subTitle = '기간별 맞춤 오답 복습';
    else if (modalTab === 'SELECTED') subTitle = '학습지 맞춤 오답 복습';

    sessionStorage.clear();
    
    sessionStorage.setItem('restoreExamQuestions', '1');
    sessionStorage.setItem('examQuestions', JSON.stringify(matchedCache));
    sessionStorage.setItem('examTitle', `[맞춤 오답 클리닉] ${currentView?.studentName} 학생`);
    sessionStorage.setItem('examSubTitle', subTitle); 

    sessionStorage.setItem('clinicTargetStudentId', currentView?.studentId);
    sessionStorage.setItem('clinicTargetClassId', currentView?.classId);
    sessionStorage.setItem('isClinicMode', 'true');
    
    // 🌟 4분류: 마법사로 넘기는 프린트 속성을 '오답유사'로 지정
    sessionStorage.setItem('examType', '오답유사');

    window.location.href = '/exam/step2?source=clinic_incorrect';
  };

  const handleCreatePrint = async () => {
    if (matchedCache.length === 0) return alert("추출 조건에 부합하는 문제가 없습니다.");
    
    const myTenantId = localStorage.getItem("logica_tenant_id");
    if (!myTenantId) throw new Error("소속 지점 정보가 없습니다. 다시 로그인 해주세요.");

    setIsEngineRunning(true);

    try {
      const instId = localStorage.getItem('logica_instructor_id');
      if (!instId) throw new Error("로그인 정보를 찾을 수 기 없습니다. 다시 로그인 해주세요.");

      const examTitle = `[맞춤 오답 클리닉] ${currentView?.studentName} 학생`;

      let subTitle = '맞춤 오답 복습';
      if (modalTab === 'TAXONOMY') subTitle = '단원별 취약 유형 복습';
      else if (modalTab === 'PERIOD') subTitle = '기간별 맞춤 오답 복습';
      else if (modalTab === 'SELECTED') subTitle = '학습지 맞춤 오답 복습';

      // 🌟 4분류: 즉시 생성할 때 exam_type을 '오답유사'로
      const { data: masterData, error: masterErr } = await supabaseClient.from('exam_master').insert({
        title: examTitle,
        sub_title: subTitle,
        exam_type: '오답유사',
        total_questions: matchedCache.length,
        instructor_id: instId,
        tenant_id: myTenantId, 
        layout_settings: {
          column: 2,
          split: 4,
          titleMode: 'all',
          template: 'basic1',
          numberColor: '#175b6a',
          titleColor: '#002864',
          lineColor: '#94a3b8'
        }
      }).select().single();

      if (masterErr || !masterData) throw new Error(`시험지 마스터 생성 실패: ${masterErr?.message}`);
      const newExamId = masterData.exam_id;

      const examItems = matchedCache.map((qId, idx) => ({
        exam_id: newExamId,
        question_id: qId,
        sort_order: idx + 1
      }));
      const { error: itemsErr } = await supabaseClient.from('exam_item').insert(examItems);
      if (itemsErr) throw new Error(`문항 저장 실패: ${itemsErr.message}`);

      const { error: assignErr } = await supabaseClient.from('exam_assignment').insert({
        exam_id: newExamId,
        student_id: currentView.studentId,
        class_id: currentView.classId,
        status: '미응시'
      });
      if (assignErr) throw new Error(`학생 배부 실패: ${assignErr.message}`);

      const tasks = matchedCache.map(qId => ({
        student_id: currentView.studentId,
        task_type: '유형오답클리닉',
        question_id: qId,
        status: '대기'
      }));

      const { error: taskErr } = await supabaseClient.from('clinic_task').insert(tasks);
      if (taskErr) throw new Error(`클리닉 전송 실패: ${taskErr.message}`);

      alert(`[출제 및 전송 완료! 🎉]\n조회된 ${matchedCache.length}개의 맞춤 문항이 '학습 타임라인'에 배부되었으며,\n학생의 클리닉 패드로 즉시 전송되었습니다!`);
      setModalTab(null);

      setTimeout(() => {
        window.location.reload();
      }, 500);

    } catch (err: any) {
      console.error(err);
      alert(`출제 중 오류가 발생했습니다: ${err.message}`);
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
              <input type="checkbox" checked={isAllSelected || false} onChange={handleSelectAllStudent || (() => {})} className="w-5 h-5 accent-rose-500" />
              <span className="text-[13px] font-bold text-slate-700">전체 선택</span>
            </label>
            <div className="w-px h-4 bg-slate-300 mx-1"></div>
            {activeTab === 'HOMEWORK' && selectedBlocks.length >= 2 && (
              <button onClick={handleExtractCommonHomework} className="px-3 py-1.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 font-bold text-[12px] transition-colors shadow-sm mr-1 animate-pulse">
                🔗 공통 과제 분리
              </button>
            )}
            <button onClick={handleBulkCompleteStudent} disabled={selectedBlocks.length === 0} className="px-3 py-1.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold text-[12px] disabled:opacity-40">✅ 선택 완료 ({selectedBlocks.length})</button>
            <button onClick={handleBulkDeleteStudent} disabled={selectedBlocks.length === 0} className="px-3 py-1.5 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-bold text-[12px] disabled:opacity-40">🗑️ 선택 삭제 ({selectedBlocks.length})</button>
          </div>

          <div className="flex items-center gap-2 pr-1">
            <span className="text-[12px] font-bold text-slate-500 mr-1 flex items-center gap-1">🖨️ 맞춤 오답 프린트 생성기 <span className="text-slate-300 ml-1">|</span></span>
            
            {selectedBlocks.length > 0 && (
              <button 
                onClick={() => openModal('SELECTED')} 
                className="px-3 py-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold text-[12px] transition-all shadow-sm"
              >
                학습지별 오답 추출
              </button>
            )}
            
            <button onClick={() => openModal('TAXONOMY')} className="px-3 py-1.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-[12px] transition-all shadow-sm">유형별 약점 추출</button>
            <button onClick={() => openModal('PERIOD')} className="px-3 py-1.5 rounded bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 font-bold text-[12px] transition-all shadow-sm">기간별 오답 추출</button>
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

      if (isLeaf) {
        return (
          <div key={key} className="flex items-center py-1 px-1.5 ml-10 hover:bg-slate-50 rounded transition-colors group">
            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0 py-1">
              <input type="checkbox" checked={selectedTaxonomyIds.has(key)} onChange={e => toggleTaxNode(key, e.target.checked)} className="w-3.5 h-3.5 rounded border-slate-300 accent-[#002864] shrink-0 cursor-pointer" />
              <span className="flex-1 text-[13px] font-semibold text-slate-600 truncate group-hover:text-[#002864] transition-colors min-w-0" title={displayName}>{displayName}</span>
              {stat.pending > 0 && <span className="ml-1 text-[10px] font-extrabold text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-[1px] rounded shadow-sm whitespace-nowrap shrink-0 flex items-center justify-center">오답 {stat.pending}</span>}
            </label>
            {progressBar}
          </div>
        );
      }

      return (
        <details key={key} open={depth <= 2} className={depth === 1 ? "mb-2" : "mb-1 pl-1 ml-2 border-l border-slate-200"}>
          <summary className={`cursor-pointer flex items-center py-1.5 transition-colors select-none group ${depth === 1 ? "bg-slate-50 hover:bg-slate-100 px-3 rounded-lg border border-slate-200 shadow-sm" : "hover:bg-slate-50 px-2 rounded-md"}`}>
            <svg className="w-4 h-4 text-slate-400 group-hover:text-[#002864] transition-transform details-arrow shrink-0 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7-7"></path></svg>
            <input type="checkbox" checked={selectedTaxonomyIds.has(key)} onChange={e => toggleTaxNode(key, e.target.checked)} onClick={e => e.stopPropagation()} className="w-3.5 h-3.5 rounded border-slate-300 accent-[#002864] shrink-0 cursor-pointer mr-2" />
            <span className={`flex-1 truncate min-w-0 ${depth === 1 ? "text-[14px] font-extrabold text-[#002864]" : "text-[13px] font-bold text-slate-700"}`} title={displayName}>{displayName}</span>
            {stat.pending > 0 && <span className="ml-2 text-[10px] font-extrabold text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-[1px] rounded shadow-sm whitespace-nowrap shrink-0 flex items-center justify-center">오답 {stat.pending}</span>}
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
              <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs border border-blue-200">생성 마법사</span>
              {currentView?.studentName} 학생 맞춤 클리닉 출제
            </h2>
            <button onClick={() => setModalTab(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <div className="w-40 border-r border-slate-200 bg-slate-50 flex flex-col pt-4 shrink-0">
              <button onClick={() => setModalTab('SELECTED')} className={`py-4 px-5 text-left font-bold text-sm transition-all border-l-4 ${modalTab === 'SELECTED' ? 'border-sky-500 bg-white text-slate-800' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>학습지별 오답</button>
              <button onClick={() => setModalTab('TAXONOMY')} className={`py-4 px-5 text-left font-bold text-sm transition-all border-l-4 ${modalTab === 'TAXONOMY' ? 'border-sky-500 bg-white text-slate-800' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>유형별 오답</button>
              <button onClick={() => setModalTab('PERIOD')} className={`py-4 px-5 text-left font-bold text-sm transition-all border-l-4 ${modalTab === 'PERIOD' ? 'border-sky-500 bg-white text-slate-800' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>기간별 오답</button>
            </div>

            <div className="flex-1 flex flex-col bg-white overflow-hidden relative">
              <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6">

                {modalTab === 'TAXONOMY' && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center mb-4 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
                      <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">💡 최근 1년 내 푼 단원의 <strong className="text-slate-800">최초 정답률(%)</strong>과 <strong className="text-rose-500">현재 미해결 오답 수</strong>입니다.</span>
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
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-6 flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-600 flex items-center gap-1">💡 선택한 기간에 발생한 <strong className="text-sky-600">미해결 오답</strong>을 조회합니다.</span>
                      <span className="text-xs font-black text-rose-500 bg-rose-50 px-2 py-1 rounded shadow-sm border border-rose-100">조회된 오답: {basePendingCount}개</span>
                    </div>
                    <div className="flex items-start justify-center flex-1 pb-10 gap-2 mt-2">
                      <div className="flex flex-col items-center gap-2">
                        <InlineCalendar label="시작일" dateValue={startDate} onDateChange={setStartDate} colorTheme="blue" />
                        <div className="text-[11px] font-black text-sky-600 bg-sky-50 px-3 py-1 rounded-full border border-sky-100 shadow-sm">{startDate}</div>
                      </div>
                      <div className="flex flex-col items-center justify-center h-[230px] px-2">
                        <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"></path></svg>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <InlineCalendar label="종료일" dateValue={endDate} onDateChange={setEndDate} colorTheme="red" />
                        <div className="text-[11px] font-black text-rose-500 bg-rose-50 px-3 py-1 rounded-full border border-rose-100 shadow-sm">{endDate}</div>
                      </div>
                    </div>
                  </div>
                )}

                {modalTab === 'SELECTED' && (
                  <div>
                    <div className="flex justify-between items-center mb-4 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
                      <span className="text-xs font-bold text-slate-600">타임라인에서 선택된 학습지 <span className="text-rose-500 font-black">{selectedBlocks.length}개</span>의 오답을 추출합니다.</span>
                    </div>
                    <ul className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
                      {filteredTimeline.filter(item => selectedBlocks.includes(item.id)).map(item => (
                        <li key={item.id} className="px-4 py-3 border-b last:border-0 border-slate-100 flex items-center justify-between hover:bg-slate-50 transition-colors">
                          <span className="font-bold text-sm text-slate-700 truncate w-3/4">{(item.title || '').replace(/^\[시스템\]\s*/, '')}</span>
                          <span className="text-xs font-black text-rose-500 bg-rose-50 px-2 py-1 rounded border border-rose-100 shadow-sm">미해결 오답 {item.xCount}개</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              </div>
            </div>

            <div className="w-[420px] bg-white border-l border-slate-200 flex flex-col shrink-0 z-10 shadow-[-4px_0_15px_rgba(0,0,0,0.02)]">
              <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">

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

              <div className="bg-slate-50/80 border-t border-slate-200 p-6 shrink-0 flex flex-col items-center">
                <div className="text-center flex flex-col items-center justify-center">
                  <span className="font-extrabold text-slate-800 text-base">최종 출제 문항 수</span>
                  <div className="flex items-end mt-1 h-12">
                    {isCalculating ? (
                      <span className="font-black text-2xl text-sky-500 tracking-tighter animate-pulse mb-1">매칭 중...</span>
                    ) : (
                      <>
                        <span className="font-black text-4xl text-[#002864] tracking-tighter">{matchedCache.length}</span>
                        <span className="font-extrabold text-slate-800 text-base mb-1 ml-1.5">개</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 w-full mt-4">
                  <button onClick={handleEditAndCreate} disabled={matchedCache.length === 0 || isCalculating} className="flex-1 px-4 py-3.5 bg-white border border-slate-300 rounded-xl shadow-sm hover:bg-slate-50 transition-colors text-sm font-bold text-slate-600 disabled:opacity-50">편집 후 만들기</button>
                  <button onClick={handleCreatePrint} disabled={isEngineRunning || matchedCache.length === 0 || isCalculating} className="flex-1 px-4 py-3.5 bg-sky-500 hover:bg-sky-600 border border-transparent rounded-xl shadow-md transition-colors text-sm font-extrabold text-white disabled:opacity-50">바로 배부하기</button>
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

              // 🌟 4분류 컬러링 적용
              let badgeColor = "bg-slate-100 text-slate-500";
              let typeLabel = "";

              if (item.type === 'exam') { badgeColor = "bg-blue-100 text-blue-700 border-blue-200"; typeLabel = "📝 시험"; }
              else if (item.type.includes('hw')) { badgeColor = "bg-amber-100 text-amber-700 border-amber-200"; typeLabel = "📚 과제"; }
              else if (item.type === 'print') { badgeColor = "bg-emerald-100 text-emerald-700 border-emerald-200"; typeLabel = "❌ 오답"; }
              else if (item.type === 'similar') { badgeColor = "bg-violet-100 text-violet-700 border-violet-200"; typeLabel = "🔄 오답유사"; }

              const rowBgClass = isSelected
                ? 'border-rose-400 bg-rose-50/30 shadow-rose-100'
                : isCompleted
                  ? 'bg-slate-200/60 border-slate-300 text-slate-600 hover:bg-slate-200/80'
                  : 'bg-white border-slate-200 hover:border-[#002864]';

              const displayTitle = (item.title || '제목 없음').replace(/^\[시스템\]\s*/, '');

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
                    
                    <div className="flex-1 flex items-center gap-2 min-w-0">
                      {item.subTitle && (
                        <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded shadow-sm shrink-0 whitespace-nowrap">
                          {item.subTitle}
                        </span>
                      )}
                      <div className="font-extrabold text-[14px] truncate" title={displayTitle}>
                        {displayTitle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 justify-end w-[480px]">
                    <div className="text-[12px] font-bold text-slate-500 shrink-0 w-[60px] text-right whitespace-nowrap">총 {item.total || 0}문항</div>

                    <div className="flex flex-row flex-nowrap items-center gap-1.5 shrink-0 w-[120px] justify-center">
                      <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100 whitespace-nowrap shadow-sm">✅ {item.oCount || 0}</span>
                      <span className="text-[11px] font-bold text-rose-500 bg-rose-50 px-2 py-1 rounded-md border border-rose-100 whitespace-nowrap shadow-sm">❌ {item.xCount || 0}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 w-[130px] justify-end">
                      <button onClick={(e) => handleForceComplete(e, item.type.includes('hw') && item.type !== 'hw_exam' ? 'hw' : 'exam', item.realId, currentView.studentId)} className="text-[11px] font-bold text-slate-600 hover:text-emerald-600 transition-colors bg-white border border-slate-200 px-2 py-0.5 rounded shadow-sm whitespace-nowrap shrink-0">
                        ✅ 완료처리
                      </button>
                      <span className={`w-[54px] text-center px-1 py-0.5 rounded text-[10px] font-extrabold whitespace-nowrap shrink-0 ${isCompleted ? 'bg-slate-300 text-slate-700 border border-slate-400' : 'bg-rose-50 text-rose-500 border border-rose-200'}`}>
                        {item.status || '미제출'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0 border-l border-slate-300 pl-4 w-[160px] justify-end">
                      {item.type === 'exam' || item.type === 'print' || item.type === 'hw_exam' || item.type === 'similar' ? (
                        <button onClick={(e) => handleEditExamToStep2?.(e, item.realId, item.masterId, displayTitle, item.subTitle, currentView?.studentName, currentView?.studentId, currentView?.classId, item.type)} className="text-[14px] hover:text-blue-600 transition-colors shrink-0 mr-0.5" title="문제 수정">✏️</button>
                      ) : (
                        <button onClick={(e) => handleEditHomeworkToStep2?.(e, item.type, item.realId, item.target_questions, displayTitle, item.subTitle, currentView?.studentName, currentView?.studentId, currentView?.classId)} className="text-[14px] hover:text-blue-600 transition-colors shrink-0 mr-0.5" title="과제 문항 수정">✏️</button>
                      )}
                      
                      <button onClick={(e) => { e.stopPropagation(); if(item.type === 'exam' || item.type === 'hw_exam') handleDeleteExam(item.realId, currentView.studentId); else if(item.type.includes('hw')) handleDeleteHomework(item.realId, currentView.studentId); else if(item.type === 'print' || item.type === 'similar') handleDeletePrint(item.realId, item.masterId); }} className="text-[14px] hover:text-rose-500 transition-colors shrink-0 mr-0.5" title="삭제">🗑️</button>
                      
                      <button 
                        onClick={(e) => handlePrintItem(e, item.type || (activeTab === 'EXAM' ? 'exam' : activeTab === 'HOMEWORK' && !item.type.includes('hw_exam') ? 'hw' : activeTab === 'INCORRECT' ? 'print' : 'similar'), item.masterId, item.target_questions, displayTitle, item.subTitle)} 
                        className="text-[15px] hover:text-emerald-600 transition-colors shrink-0 mx-0.5" 
                        title="프린트 출력"
                      >
                        🖨️
                      </button>

                      <button onClick={(e) => { 
                          e.stopPropagation(); 
                          let detailHref = '';
                          if (item.type === 'hw_exam' || item.type === 'print' || item.type === 'similar') {
                            detailHref = `/homework/review?assignment_id=${item.realId}&student_id=${currentView.studentId}&is_exam_hw=true`;
                          } else if (item.type === 'hw') {
                            detailHref = `/homework/review?homework_id=${item.realId}&student_id=${currentView.studentId}`;
                          } else {
                            detailHref = `/exam/review?assignment_id=${item.realId}`;
                          }
                          window.location.href = detailHref; 
                        }} 
                        className="text-[11px] font-bold text-slate-500 bg-slate-100 border border-slate-200 hover:bg-slate-200 px-3 py-1.5 rounded transition-colors shadow-sm ml-0.5 shrink-0 whitespace-nowrap"
                      >상세 ➔</button>
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