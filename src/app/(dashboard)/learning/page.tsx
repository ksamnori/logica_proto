// src/app/(dashboard)/learning/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { ViewState, TabType } from "./types";
import { useLearningFetch, LEVEL_ORDER } from "./hooks/useLearningFetch";
import { useLearningActions } from "./hooks/useLearningActions";

import LearningSidebar from "./components/LearningSidebar";
import StudentDashboard from "./components/StudentDashboard";
import GlobalList from "./components/GlobalList";
import StudentTimeline from "./components/StudentTimeline";
import LearningCalendar from "./components/LearningCalendar";

export default function LearningPage() {
  const [activeTab, setActiveTab] = useState<TabType>('DASHBOARD');
  const [currentView, setCurrentView] = useState<ViewState>({ type: 'ALL', classId: '', className: '', studentId: '', studentName: '' });

  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [globalSelectedBlocks, setGlobalSelectedBlocks] = useState<string[]>([]);

  const [showCompleted, setShowCompleted] = useState<boolean>(false);
  const [dateFilter, setDateFilter] = useState<'ALL' | '1W' | '1M'>('ALL');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isGeneratingPrint, setIsGeneratingPrint] = useState(false);
  const [isFilterActive, setIsFilterActive] = useState(false);

  // 🌟 반 전체 일괄 프린트 생성기 상태
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  
  // 🌟 오답 추출 기간 설정 (기본값: 최근 1주일)
  const [bulkStartDate, setBulkStartDate] = useState(() => {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000); 
    d.setDate(d.getDate() - 7); 
    return d.toISOString().split('T')[0];
  });
  const [bulkEndDate, setBulkEndDate] = useState(() => {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  });

  // 🌟 클리닉 수행 목표 날짜 설정 (기본값: 오늘)
  const [bulkTargetDate, setBulkTargetDate] = useState(() => {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  });
  
  const [bulkTwin, setBulkTwin] = useState(1);
  const [bulkSim, setBulkSim] = useState(1);
  const [bulkDiff, setBulkDiff] = useState('그대로');
  const [bulkExclude, setBulkExclude] = useState(true);
  const [bulkLimitActive, setBulkLimitActive] = useState(true);
  const [bulkLimit, setBulkLimit] = useState(3);
  const [bulkTotalLimitActive, setBulkTotalLimitActive] = useState(true);
  const [bulkTotalLimit, setBulkTotalLimit] = useState(10);

  const [bulkStatus, setBulkStatus] = useState({ isRunning: false, current: 0, total: 0, studentName: '' });

  const {
    isAuthorized, isLoading, setIsLoading,
    groupedClasses, allStudentsList, currentStats,
    globalList, setGlobalList, timelineData, setTimelineData,
    classCalendarEvents,
    fetchBaseData, fetchStatsForTab, fetchStudentTimeline, fetchGlobalListForTab
  } = useLearningFetch();

  const actions = useLearningActions({
    currentView, activeTab, allStudentsList,
    selectedBlocks, setSelectedBlocks, globalSelectedBlocks, setGlobalSelectedBlocks,
    setIsLoading, setIsGeneratingPrint, setDateFilter,
    fetchStudentTimeline, fetchGlobalListForTab, fetchStatsForTab
  });

  useEffect(() => {
    if (isAuthorized) fetchBaseData();
  }, [isAuthorized]);

  useEffect(() => {
    if (allStudentsList.length > 0) {
      const savedTab = (sessionStorage.getItem('logica_learning_tab') as TabType) || 'DASHBOARD';
      const savedViewStr = sessionStorage.getItem('logica_learning_view');
      let view: ViewState = { type: 'ALL', classId: '', className: '', studentId: '', studentName: '' };

      if (savedViewStr) {
        try { 
          const parsed = JSON.parse(savedViewStr); 
          if (['ALL', 'CLASS', 'STUDENT'].includes(parsed.type)) view = parsed;
        } catch(e){}
      }

      const urlStudentId = new URLSearchParams(window.location.search).get('studentId');
      if (urlStudentId) {
        const matched = allStudentsList.find(s => s.id === urlStudentId);
        if (matched) view = { type: 'STUDENT', classId: matched.classId, className: matched.className, studentId: matched.id, studentName: matched.name };
      }

      setActiveTab(savedTab);
      setCurrentView(view);
      setIsFilterActive(false);

      fetchStatsForTab(allStudentsList);

      if (view.type === 'STUDENT') fetchStudentTimeline(view.studentId, view.classId, allStudentsList);
      else fetchGlobalListForTab(savedTab, allStudentsList);
    }
  }, [allStudentsList]);

  const handleMainTabClick = (tab: TabType) => {
    setActiveTab(tab);
    sessionStorage.setItem('logica_learning_tab', tab);
    setSelectedBlocks([]); setGlobalSelectedBlocks([]); setIsFilterActive(false); setSelectedDate(null); 
    if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
    else fetchGlobalListForTab(tab, allStudentsList);
  };

  const handleCalendarSummaryClick = (tab: TabType) => {
    setActiveTab(tab);
    sessionStorage.setItem('logica_learning_tab', tab);
    setSelectedBlocks([]); setGlobalSelectedBlocks([]); setGlobalList([]); setTimelineData([]);
    if (currentView.type === 'STUDENT') fetchStudentTimeline(currentView.studentId, currentView.classId, allStudentsList);
    else fetchGlobalListForTab(tab, allStudentsList);
  };

  const handleViewChange = (view: ViewState) => {
    setCurrentView(view);
    sessionStorage.setItem('logica_learning_view', JSON.stringify(view));
    setSelectedBlocks([]); setGlobalSelectedBlocks([]); setSelectedDate(null); 
    setGlobalList([]); setTimelineData([]);
    if (view.type === 'STUDENT') fetchStudentTimeline(view.studentId, view.classId, allStudentsList);
    else fetchGlobalListForTab(activeTab, allStudentsList);
  };

  const handleStudentClick = (studentId: string, studentName: string, classId: string, className: string) => {
    handleViewChange({ type: 'STUDENT', classId, className, studentId, studentName });
  };

  const filterByDate = (dateStr: string) => {
    if (selectedDate) {
      const d = new Date(dateStr);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return ymd === selectedDate;
    }
    if (dateFilter === 'ALL') return true;
    const diff = new Date().getTime() - new Date(dateStr).getTime();
    return dateFilter === '1W' ? diff <= 7 * 24 * 3600000 : diff <= 30 * 24 * 3600000;
  };

  const filteredGlobalList = useMemo(() => {
    return globalList.filter(item => {
      if (currentView.type === 'CLASS' && item.class_id !== currentView.classId) return false;
      if (!filterByDate(item.sort_date || item.created_at)) return false;
      const isCompleted = ['채점완료', '제출완료', '완료'].includes(item.status);
      if (!showCompleted && isCompleted) return false; 
      return true;
    });
  }, [globalList, dateFilter, selectedDate, currentView, showCompleted]);

  const filteredTimeline = useMemo(() => {
    return timelineData.filter(item => {
      if (!filterByDate(item.date)) return false;
      if (activeTab === 'EXAM' && item.type !== 'exam') return false;
      if (activeTab === 'HOMEWORK' && !item.type.includes('hw')) return false;
      if (activeTab === 'INCORRECT' && item.type !== 'print') return false;
      if (activeTab === 'SIMILAR' && item.type !== 'similar') return false; 
      if (!showCompleted && item.isCompleted) return false; 
      return true;
    });
  }, [timelineData, dateFilter, activeTab, selectedDate, showCompleted]);

  const toggleGlobalSelection = (id: string) => {
    setGlobalSelectedBlocks(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  };

  const handleSelectAllGlobal = () => {
    if (globalSelectedBlocks.length === filteredGlobalList.length && filteredGlobalList.length > 0) {
      setGlobalSelectedBlocks([]);
    } else {
      setGlobalSelectedBlocks(filteredGlobalList.map(res => {
         const safeId = res.assignment_id || res.homework_id || Math.random().toString(36).substr(2, 9);
         if (activeTab === 'EXAM') return `exam_${safeId}_${res.student_id}`;
         if (activeTab === 'HOMEWORK') return res.is_exam_hw ? `hw_exam_${safeId}_${res.student_id}` : `hw_${safeId}_${res.student_id}`;
         if (activeTab === 'INCORRECT') return `print_${safeId}_${res.student_id}`;
         if (activeTab === 'SIMILAR') return `similar_${safeId}_${res.student_id}`; 
         return '';
      }));
    }
  };

  const handleSelectAllStudent = () => {
    const visibleIds = filteredTimeline.map((i: any) => i.id);
    if (selectedBlocks.length === visibleIds.length && visibleIds.length > 0) setSelectedBlocks([]); 
    else setSelectedBlocks(visibleIds);
  };

  const studentStatsMap = useMemo(() => {
    const map: Record<string, { examQ: number; hwQ: number; printQ: number; similarQ: number; }> = {};
    currentStats.forEach(e => {
      let statClassId = e.class_id || 'UNKNOWN';
      const key = `${e.student_id}_${statClassId}`;
      const globalKey = `${e.student_id}_ALL`;
      if (!map[key]) map[key] = { examQ: 0, hwQ: 0, printQ: 0, similarQ: 0 };
      if (!map[globalKey]) map[globalKey] = { examQ: 0, hwQ: 0, printQ: 0, similarQ: 0 };
      
      const statusStr = e.status || '미제출';
      const isPending = ['미제출', '진행중', '미응시', '응시전', '응시중'].includes(statusStr);
      if (isPending) { 
        const qCount = e.qCount || 0;
        if (e.type === 'EXAM') { map[key].examQ += qCount; map[globalKey].examQ += qCount; }
        else if (e.type === 'HW') { map[key].hwQ += qCount; map[globalKey].hwQ += qCount; }
        else if (e.type === 'PRINT') { map[key].printQ += qCount; map[globalKey].printQ += qCount; }
        else if (e.type === 'SIMILAR') { map[key].similarQ += qCount; map[globalKey].similarQ += qCount; }
      }
    });
    return map;
  }, [currentStats]);

  const formatDateLabel = (dateStr: string, includeTime = false) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const dt = `${d.getMonth()+1}/${d.getDate()}(${['일','월','화','수','목','금','토'][d.getDay()]})`;
    if (includeTime) return `${dt} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    return dt;
  };

  const handleRunBulkPrint = async () => {
    const studentsInClass = allStudentsList.filter(s => s.classId === currentView.classId);
    if (studentsInClass.length === 0) return alert('선택하신 반에 등록된 학생이 없습니다.');

    setBulkStatus({ isRunning: true, current: 0, total: studentsInClass.length, studentName: '' });

    let successCount = 0;
    let skipCount = 0;

    const myTenantId = localStorage.getItem("logica_tenant_id") || 'hq';
    const instId = localStorage.getItem('logica_instructor_id') || 'system';

    for (let i = 0; i < studentsInClass.length; i++) {
      const st = studentsInClass[i];
      setBulkStatus({ isRunning: true, current: i + 1, total: studentsInClass.length, studentName: st.name });

      try {
        const { data: records, error: recErr } = await supabase.from('student_incorrect_record')
          .select('question_id, created_at')
          .eq('student_id', st.id)
          .is('resolved_at', null);

        if (recErr || !records || records.length === 0) { skipCount++; continue; }

        const targetQids = records.filter(r => {
          const d = new Date(r.created_at);
          const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
          return kst >= bulkStartDate && kst <= bulkEndDate;
        }).map(r => r.question_id).filter(Boolean);

        const uniqueQids = Array.from(new Set(targetQids));
        if (uniqueQids.length === 0) { skipCount++; continue; }

        const { data: matchedIds } = await supabase.rpc('get_clinic_matches', {
          p_target_qids: uniqueQids,
          p_twin_count: bulkTwin,
          p_sim_count: bulkSim,
          p_diff_opt: bulkDiff,
          p_exclude_orig: bulkExclude,
          p_max_limit: bulkLimit,
          p_is_limit_active: bulkLimitActive
        });

        if (!matchedIds || matchedIds.length === 0) { skipCount++; continue; }

        let finalMatchedIds = matchedIds;
        if (bulkTotalLimitActive && bulkTotalLimit > 0) {
            finalMatchedIds = matchedIds.slice(0, bulkTotalLimit);
        }

        if (finalMatchedIds.length === 0) { skipCount++; continue; }

        const formattedTargetDate = `${bulkTargetDate.split('-')[1]}월 ${bulkTargetDate.split('-')[2]}일`;
        const examTitle = `[${currentView.className}] ${st.name} 오답유사 클리닉`;
        const subTitle = `${formattedTargetDate} 수행 목표`;

        const { data: masterData, error: mstErr } = await supabase.from('exam_master').insert({
          title: examTitle, sub_title: subTitle, exam_type: '오답유사', total_questions: finalMatchedIds.length,
          instructor_id: instId, tenant_id: myTenantId,
          layout_settings: { column: 2, split: 4, titleMode: 'all', template: 'basic1', numberColor: '#175b6a', titleColor: '#002864', lineColor: '#94a3b8', examDate: bulkTargetDate }
        }).select().single();

        if (mstErr || !masterData) { skipCount++; continue; }

        const examItems = finalMatchedIds.map((qId: string, idx: number) => ({ exam_id: masterData.exam_id, question_id: qId, sort_order: idx + 1 }));
        await supabase.from('exam_item').insert(examItems);

        await supabase.from('exam_assignment').insert({ exam_id: masterData.exam_id, student_id: st.id, class_id: currentView.classId, status: '미응시' });

        const tasks = finalMatchedIds.map((qId: string) => ({ student_id: st.id, task_type: '유형오답클리닉', question_id: qId, status: '대기' }));
        await supabase.from('clinic_task').insert(tasks);

        successCount++;
      } catch (err) {
        console.error("Bulk Generate Error for student " + st.name, err);
        skipCount++;
      }
    }

    alert(`✅ 일괄 생성이 완료되었습니다.\n- 성공: ${successCount}명 배부 완료\n- 스킵(조건에 맞는 오답 없음): ${skipCount}명`);
    setBulkStatus({ isRunning: false, current: 0, total: 0, studentName: '' });
    setIsBulkModalOpen(false);

    fetchGlobalListForTab(activeTab, allStudentsList);
    fetchStatsForTab(allStudentsList);
  };

  if (isAuthorized === null) {
    return (
      <div className="flex w-full h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-[#002864] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-slate-500 font-bold text-sm">보안 권한을 확인하는 중입니다...</span>
        </div>
      </div>
    );
  }
  
  if (isAuthorized === false) return null; 

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-4 overflow-hidden relative">
      <div className="flex justify-between items-center shrink-0">
        
        <div className="flex items-center gap-2 p-1.5 bg-slate-200/60 rounded-xl shadow-inner overflow-x-auto">
          <button onClick={() => handleMainTabClick('DASHBOARD')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'DASHBOARD' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>📈 학생 대시보드</button>
          <div className="w-px h-6 bg-slate-300 mx-0.5 shrink-0"></div>
          <button onClick={() => handleMainTabClick('EXAM')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'EXAM' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>💯 시험</button>
          <button onClick={() => handleMainTabClick('HOMEWORK')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'HOMEWORK' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>📝 과제</button>
          <button onClick={() => handleMainTabClick('INCORRECT')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'INCORRECT' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>❌ 오답</button>
          <button onClick={() => handleMainTabClick('SIMILAR')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all whitespace-nowrap shrink-0 ${activeTab === 'SIMILAR' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>🔄 오답유사</button>
          
          {currentView.type === 'CLASS' && (
            <>
              <div className="w-px h-6 bg-slate-300 mx-0.5 shrink-0"></div>
              <button 
                onClick={() => setIsBulkModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 text-white font-black text-[13px] shadow-sm transition-colors animate-[fadeIn_0.3s_ease-out] shrink-0"
              >
                <span className="text-sm">🖨️</span>
                <span>[{currentView.className}] 전원 오답유사 생성</span>
              </button>
            </>
          )}
        </div>

      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        <LearningSidebar 
           currentView={currentView} groupedClasses={groupedClasses} studentStatsMap={studentStatsMap} 
           isLoading={isLoading} handleViewChange={handleViewChange} handleStudentClick={handleStudentClick} 
        />

        <div className="flex-1 flex flex-col relative bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          { (currentView.type === 'ALL' || currentView.type === 'CLASS') && activeTab === 'DASHBOARD' && (
            <StudentDashboard currentView={currentView} activeTab={activeTab} isFilterActive={isFilterActive} setIsFilterActive={setIsFilterActive} handleViewChange={handleViewChange} handleStudentClick={handleStudentClick} groupedClasses={groupedClasses} studentStatsMap={studentStatsMap} LEVEL_ORDER={LEVEL_ORDER} />
          )}  

          { (currentView.type === 'ALL' || currentView.type === 'CLASS') && activeTab !== 'DASHBOARD' && (
            <div className="flex flex-col h-full overflow-hidden">
              {(activeTab === 'INCORRECT' || activeTab === 'SIMILAR') && currentView.type === 'ALL' && (
                <div className="bg-indigo-50/80 border border-indigo-200 p-4 m-6 mb-2 rounded-xl flex items-center justify-between shadow-sm shrink-0">
                  <div className="flex flex-col gap-1">
                     <h3 className="text-indigo-800 font-extrabold text-[13px] flex items-center gap-1.5"><span>💡</span> 오답 및 오답유사 프린트는 어디서 만드나요?</h3>
                     <p className="text-indigo-600/90 font-bold text-[11px] pl-5 leading-relaxed">
                        좌측 아코디언 메뉴에서 <strong className="text-indigo-700 font-black">특정 반</strong>을 선택하시면 상단 탭 맨 우측에 <strong className="text-indigo-700 font-black">전원 일괄 생성</strong> 버튼이 나타나며,<br/>
                        <strong className="text-indigo-700 font-black">특정 학생</strong>을 선택하시면 해당 학생만을 위한 오답 생성 마법사가 열립니다.
                     </p>
                  </div>
                </div>
              )}
              <div className="w-full flex justify-end px-5 pt-3 pb-1 -mb-1 relative z-20 pointer-events-none">
                 <button onClick={() => setShowCompleted(prev => !prev)} className={`pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all border shadow-sm ${showCompleted ? 'bg-blue-50 border-blue-200 text-[#002864] hover:bg-blue-100' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`} title="완료된 항목 숨김/표시 전환">
                    <span>{showCompleted ? '✅' : '🔒'}</span><span>{showCompleted ? '완료 포함' : '미완료만 보기'}</span>
                 </button>
              </div>
              <GlobalList 
                currentView={currentView} activeTab={activeTab} globalList={filteredGlobalList} isLoading={isLoading} 
                globalSelectedBlocks={globalSelectedBlocks} handleSelectAllGlobal={handleSelectAllGlobal} 
                toggleGlobalSelection={toggleGlobalSelection} formatDateLabel={formatDateLabel} 
                handleViewChange={handleViewChange} 
                {...actions} 
              />
            </div>
          )}

          {currentView.type === 'STUDENT' && (
            <div className="flex flex-col h-full overflow-hidden">
              {activeTab !== 'DASHBOARD' && (
                <div className="w-full flex justify-end px-5 pt-3 pb-1 -mb-1 relative z-20 pointer-events-none">
                   <button onClick={() => setShowCompleted(prev => !prev)} className={`pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all border shadow-sm ${showCompleted ? 'bg-blue-50 border-blue-200 text-[#002864] hover:bg-blue-100' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`} title="완료된 항목 숨김/표시 전환">
                      <span>{showCompleted ? '✅' : '🔒'}</span><span>{showCompleted ? '완료 포함' : '미완료만 보기'}</span>
                   </button>
                </div>
              )}
              <StudentTimeline 
                currentView={currentView} activeTab={activeTab} dateFilter={dateFilter} setDateFilter={setDateFilter} 
                isLoading={isLoading} filteredTimeline={filteredTimeline} selectedBlocks={selectedBlocks} 
                setSelectedBlocks={setSelectedBlocks} handleSelectAllStudent={handleSelectAllStudent} 
                isGeneratingPrint={isGeneratingPrint} formatDateLabel={formatDateLabel} 
                {...actions} 
              />
            </div>
          )}
        </div>

        <div className="w-[300px] shrink-0">
          <LearningCalendar 
             currentView={currentView} activeTab={activeTab} timelineData={timelineData} globalList={globalList} 
             classCalendarEvents={classCalendarEvents} selectedDate={selectedDate} setSelectedDate={setSelectedDate} 
             handleCalendarSummaryClick={handleCalendarSummaryClick} handleViewAllStudents={() => handleViewChange({ type: 'ALL', classId: '', className: '', studentId: '', studentName: '' })}
          />
        </div>
      </div>

      {/* 일괄 배부 모달 */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 z-[100] flex justify-center items-center bg-slate-900/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white w-[600px] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 bg-violet-50 shrink-0">
              <h2 className="text-lg font-black text-violet-800 flex items-center gap-2">
                <span className="text-xl">🖨️</span>
                [{currentView.className}] 전원 맞춤 오답유사 일괄 생성
              </h2>
              <button disabled={bulkStatus.isRunning} onClick={() => setIsBulkModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-30">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>

            <div className="p-6 flex flex-col gap-6 bg-white">
              {bulkStatus.isRunning ? (
                <div className="flex flex-col items-center justify-center py-10 gap-4">
                   <div className="text-4xl animate-bounce">🚀</div>
                   <h3 className="text-xl font-extrabold text-slate-800">일괄 배부 진행 중입니다...</h3>
                   <div className="w-full bg-slate-100 rounded-full h-4 mt-2 overflow-hidden shadow-inner">
                      <div className="bg-violet-500 h-full transition-all duration-300" style={{ width: `${(bulkStatus.current / bulkStatus.total) * 100}%` }}></div>
                   </div>
                   <p className="text-sm font-bold text-slate-500">
                     ({bulkStatus.current} / {bulkStatus.total}) <span className="text-violet-600">{bulkStatus.studentName}</span> 생성 중...
                   </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-extrabold text-slate-800">1. 오답 추출 기간 설정</label>
                    <div className="flex items-center gap-3">
                      {/* 🌟 transition-colors 제거 및 colorScheme: 'light' 추가로 깜빡임 해결 */}
                      <input type="date" style={{ colorScheme: 'light' }} value={bulkStartDate} onChange={e => setBulkStartDate(e.target.value)} className="flex-1 px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-700 outline-none focus:border-violet-500" />
                      <span className="text-slate-400 font-bold">~</span>
                      <input type="date" style={{ colorScheme: 'light' }} value={bulkEndDate} onChange={e => setBulkEndDate(e.target.value)} className="flex-1 px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-700 outline-none focus:border-violet-500" />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 mt-2">
                    <label className="text-sm font-extrabold text-slate-800">2. 생성 옵션 설정</label>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-[14px] font-bold text-slate-600 leading-loose shadow-sm break-keep">
                      해당 기간 오답의 <span className="text-violet-500 font-black">쌍둥이</span>
                      <select value={bulkTwin} onChange={e => setBulkTwin(Number(e.target.value))} className="border border-slate-300 rounded-md mx-2 p-1.5 outline-none text-slate-800 bg-white focus:border-violet-500 font-black shadow-sm">
                        {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>개와 <span className="text-violet-500 font-black">유사</span>
                      <select value={bulkSim} onChange={e => setBulkSim(Number(e.target.value))} className="border border-slate-300 rounded-md mx-2 p-1.5 outline-none text-slate-800 bg-white focus:border-violet-500 font-black shadow-sm">
                        {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>개로 학습지를 만듭니다. 난이도는
                      <select value={bulkDiff} onChange={e => setBulkDiff(e.target.value)} className="border border-slate-300 rounded-md mx-2 p-1.5 outline-none text-slate-800 bg-white focus:border-violet-500 font-black shadow-sm">
                        <option value="그대로">그대로</option><option value="더 쉽게">더 쉽게</option><option value="더 어렵게">더 어렵게</option>
                      </select> 출제합니다.
                      
                      <div className="mt-4 pt-4 border-t border-slate-200 flex flex-col gap-3">
                        <label className="flex items-center gap-2 cursor-pointer group w-max">
                          <input type="checkbox" checked={bulkExclude} onChange={e => setBulkExclude(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-violet-500" />
                          <span className="text-[13px] font-bold text-slate-700 group-hover:text-slate-900 transition-colors">기존에 이미 틀렸던 원본 문제는 포함하지 않기</span>
                        </label>

                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 cursor-pointer group">
                            <input type="checkbox" checked={bulkLimitActive} onChange={(e) => setBulkLimitActive(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-violet-500" />
                            <span className="text-[13px] font-bold text-slate-700 group-hover:text-slate-900 transition-colors">한 유형당 최대 </span>
                          </label>
                          <div className={`flex items-center border rounded shadow-sm overflow-hidden transition-colors ${bulkLimitActive ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                            <button onClick={() => setBulkLimit(p => Math.max(1, p - 1))} disabled={!bulkLimitActive} className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 border-r border-slate-200 transition-colors font-bold disabled:opacity-40">−</button>
                            <input type="text" value={bulkLimit} readOnly className="w-10 text-center text-[13px] font-bold text-slate-700 outline-none bg-transparent" />
                            <button onClick={() => setBulkLimit(p => p + 1)} disabled={!bulkLimitActive} className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 border-l border-slate-200 transition-colors font-bold disabled:opacity-40">+</button>
                          </div>
                          <span className="text-[13px] font-bold text-slate-700">문제까지만 제한</span>
                        </div>

                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 cursor-pointer group">
                            <input type="checkbox" checked={bulkTotalLimitActive} onChange={(e) => setBulkTotalLimitActive(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-violet-500" />
                            <span className="text-[13px] font-bold text-slate-700 group-hover:text-slate-900 transition-colors">학생당 총 출제 문항 수 제한</span>
                          </label>
                          <div className={`flex items-center border rounded shadow-sm overflow-hidden transition-colors ${bulkTotalLimitActive ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                            <button onClick={() => setBulkTotalLimit(p => Math.max(1, p - 1))} disabled={!bulkTotalLimitActive} className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 border-r border-slate-200 transition-colors font-bold disabled:opacity-40">−</button>
                            <input type="text" value={bulkTotalLimit} readOnly className="w-10 text-center text-[13px] font-bold text-slate-700 outline-none bg-transparent" />
                            <button onClick={() => setBulkTotalLimit(p => p + 1)} disabled={!bulkTotalLimitActive} className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 border-l border-slate-200 transition-colors font-bold disabled:opacity-40">+</button>
                          </div>
                          <span className="text-[13px] font-bold text-slate-700">문제까지만 출제</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 mt-2">
                    <label className="text-sm font-extrabold text-slate-800">3. 클리닉 수행 목표일 지정 <span className="text-xs text-slate-400 font-medium">(선택)</span></label>
                    <div className="flex items-center gap-3">
                      {/* 🌟 transition-colors 제거 및 colorScheme: 'light' 추가로 깜빡임 해결 */}
                      <input 
                        type="date" 
                        style={{ colorScheme: 'light' }}
                        value={bulkTargetDate} 
                        onChange={e => setBulkTargetDate(e.target.value)} 
                        className="flex-1 px-4 py-3 bg-violet-50 border border-violet-200 rounded-xl font-bold text-violet-700 outline-none focus:border-violet-500 shadow-sm" 
                      />
                      <span className="text-[12px] font-bold text-slate-500 flex-1 pl-2">
                        지정된 날짜가 학생 화면에 표시되어, <br/> 언제 풀어야 하는지 명확히 인지하게 합니다.
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-4">
                    <button onClick={() => setIsBulkModalOpen(false)} className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-extrabold rounded-xl transition-colors">취소</button>
                    <button onClick={handleRunBulkPrint} className="flex-1 py-4 bg-violet-500 hover:bg-violet-600 text-white font-extrabold rounded-xl shadow-md transition-colors">🚀 전원 일괄 배부하기</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}