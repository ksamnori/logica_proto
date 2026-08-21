// src/app/(dashboard)/learning/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
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
    const map: Record<string, { examQ: number; hwQ: number; printQ: number; }> = {};
    currentStats.forEach(e => {
      let statClassId = e.class_id || 'UNKNOWN';
      const key = `${e.student_id}_${statClassId}`;
      const globalKey = `${e.student_id}_ALL`;
      if (!map[key]) map[key] = { examQ: 0, hwQ: 0, printQ: 0 };
      if (!map[globalKey]) map[globalKey] = { examQ: 0, hwQ: 0, printQ: 0 };
      
      const statusStr = e.status || '미제출';
      const isPending = ['미제출', '진행중', '미응시', '응시전', '응시중'].includes(statusStr);
      if (isPending) { 
        const qCount = e.qCount || 0;
        if (e.type === 'EXAM') { map[key].examQ += qCount; map[globalKey].examQ += qCount; }
        else if (e.type === 'HW') { map[key].hwQ += qCount; map[globalKey].hwQ += qCount; }
        else if (e.type === 'PRINT') { map[key].printQ += qCount; map[globalKey].printQ += qCount; }
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
        <div className="flex gap-2 p-1.5 bg-slate-200/60 rounded-xl shadow-inner">
          <button onClick={() => handleMainTabClick('DASHBOARD')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all ${activeTab === 'DASHBOARD' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>📈 학생 대시보드</button>
          <div className="w-px h-6 bg-slate-300 mx-0.5 my-auto"></div>
          <button onClick={() => handleMainTabClick('EXAM')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all ${activeTab === 'EXAM' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>💯 시험</button>
          <button onClick={() => handleMainTabClick('HOMEWORK')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all ${activeTab === 'HOMEWORK' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>📝 과제</button>
          <button onClick={() => handleMainTabClick('INCORRECT')} className={`px-5 py-2 rounded-lg font-black text-[13px] transition-all ${activeTab === 'INCORRECT' ? 'bg-white text-[#002864] shadow-md' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>❌ 오답 프린트</button>
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
              {activeTab === 'INCORRECT' && currentView.type === 'ALL' && (
                <div className="bg-indigo-50/80 border border-indigo-200 p-4 m-6 mb-2 rounded-xl flex items-center justify-between shadow-sm shrink-0">
                  <div className="flex flex-col gap-1">
                     <h3 className="text-indigo-800 font-extrabold text-[13px] flex items-center gap-1.5"><span>💡</span> 오답 프린트는 어디서 만드나요?</h3>
                     <p className="text-indigo-600/90 font-bold text-[11px] pl-5 leading-relaxed">
                        오답 프린트는 학생 개인의 오답 기록을 바탕으로 만들어지는 <strong className="text-indigo-700 font-black">개인 맞춤형 문제지</strong>입니다.<br/>
                        좌측 학생 명단에서 <strong className="text-indigo-700 font-black bg-white px-1 py-0.5 rounded shadow-sm">특정 학생을 선택</strong>하시면 타임라인 우측 상단에 🖨️ 생성 장치(버튼)가 나타납니다.
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
                handleViewChange={handleViewChange} // 🌟 누락되었던 부분 복구!
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
    </div>
  );
}