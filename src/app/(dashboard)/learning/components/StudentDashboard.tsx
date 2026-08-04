"use client";

import React from "react";

interface StudentDashboardProps {
  currentView: any;
  activeTab: string;
  isFilterActive: boolean;
  setIsFilterActive: (active: boolean) => void;
  handleViewChange: (view: any) => void;
  handleStudentClick: (studentId: string, studentName: string, classId: string, className: string) => void;
  groupedClasses: Record<string, any[]>;
  studentStatsMap: Record<string, any>;
  LEVEL_ORDER: string[];
}

export default function StudentDashboard({
  currentView, activeTab, isFilterActive, setIsFilterActive, handleViewChange,
  handleStudentClick, groupedClasses, studentStatsMap, LEVEL_ORDER
}: StudentDashboardProps) {

  const renderStudentCard = (s: any, classId: string, cName: string) => {
    // 💡 [핵심 수정] 탭이나 반(Class)에 상관없이 무조건 학생 본인의 전체(_ALL) 미해결 문제 수를 가져옵니다!
    // 이렇게 해야 탭을 이리저리 이동해도 3색 버블의 숫자가 절대 변하지 않습니다.
    const allStats = studentStatsMap[`${s.id}_ALL`] || { examQ: 0, hwQ: 0, printQ: 0 };
    
    const displayExamQ = allStats.examQ;
    const displayHwQ = allStats.hwQ;
    const displayPrintQ = allStats.printQ;

    // 💡 카드의 빨간색 음영(하이라이트) 여부는 현재 선택된 탭에 맞춰서 똑똑하게 반응합니다.
    let displayTotal = 0;
    if (activeTab === 'EXAM') displayTotal = displayExamQ;
    else if (activeTab === 'HOMEWORK') displayTotal = displayHwQ;
    else if (activeTab === 'INCORRECT') displayTotal = displayPrintQ;
    else displayTotal = displayExamQ + displayHwQ + displayPrintQ;

    // 미해결 학생만 보기 필터가 켜져 있고, 현재 탭의 미해결 건수가 없으면 숨김
    if (isFilterActive && displayTotal === 0) return null;

    return (
      <div key={`${s.id}_${classId}`} onClick={() => handleStudentClick(s.id, s.name, classId, cName)} 
        className={`px-3 py-3 rounded-xl border shadow-sm cursor-pointer transition-all flex items-center justify-between ${
          displayTotal > 0 ? 'bg-rose-50/50 border-rose-300 hover:border-rose-500 hover:-translate-y-0.5' : 'bg-white border-slate-200 hover:border-[#002864] hover:-translate-y-0.5'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={`font-extrabold text-[14px] truncate ${displayTotal > 0 ? 'text-rose-900' : 'text-slate-800'}`}>{s.name}</div>
        </div>
        
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {displayExamQ > 0 && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 min-w-[28px] text-center rounded-full shadow-sm text-[12px] font-black" title="시험 미해결 문항">{displayExamQ}</span>}
          {displayHwQ > 0 && <span className="bg-amber-100 text-amber-700 px-2 py-0.5 min-w-[28px] text-center rounded-full shadow-sm text-[12px] font-black" title="과제 미해결 문항">{displayHwQ}</span>}
          {displayPrintQ > 0 && <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 min-w-[28px] text-center rounded-full shadow-sm text-[12px] font-black" title="오답 미해결 문항">{displayPrintQ}</span>}
        </div>
      </div>
    );
  };

  const isAllView = currentView.type === 'ALL';

  return (
    <>
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex justify-between items-center">
        <div>
          {isAllView ? (
            <>
              <h2 className="text-base font-extrabold text-slate-800">전체 학생 요약 대시보드</h2>
              <p className="text-[12px] font-bold text-slate-500 mt-0.5">모든 반의 학생들을 한눈에 확인하고 미해결 항목을 관리하세요.</p>
            </>
          ) : (
            <h2 className="text-base font-extrabold text-slate-800"><span className="text-[#002864]">{currentView.className}</span> 반 학생 목록</h2>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeTab !== 'DASHBOARD' && (
            <button onClick={() => handleViewChange({ type: 'GLOBAL_LIST', classId: '', className: '', studentId: '', studentName: '' })} className="px-4 py-2 rounded-lg text-[13px] font-bold bg-white text-[#002864] border border-[#002864] hover:bg-blue-50 transition-colors shadow-sm">
              전체 {activeTab === 'EXAM' ? '시험 목록' : activeTab === 'HOMEWORK' ? '과제 리스트' : '오답 프린트'} 보기 ➔
            </button>
          )}
          <button onClick={() => setIsFilterActive(!isFilterActive)} className={`px-4 py-2 rounded-lg border text-[13px] font-bold shadow-sm transition-colors ${isFilterActive ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
            🚨 미해결 학생만 보기
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50">
        {isAllView ? (
          LEVEL_ORDER.map(lvl => {
            const classList = groupedClasses[lvl];
            if (!classList || classList.length === 0) return null;
            const visibleClasses = classList.filter(c => c.students.some((s: any) => {
              const allStats = studentStatsMap[`${s.id}_ALL`] || { examQ: 0, hwQ: 0, printQ: 0 };
              let dTotal = 0;
              if (activeTab === 'EXAM') dTotal = allStats.examQ;
              else if (activeTab === 'HOMEWORK') dTotal = allStats.hwQ;
              else if (activeTab === 'INCORRECT') dTotal = allStats.printQ;
              else dTotal = allStats.examQ + allStats.hwQ + allStats.printQ;
              return !isFilterActive || dTotal > 0;
            }));
            if (visibleClasses.length === 0) return null;

            return visibleClasses.map((c, cIdx) => (
              <div key={`class_group_${c.class_id}_${cIdx}`} className="mb-8">
                <div className="flex items-center gap-2 mb-3 border-b border-slate-200 pb-2">
                  <span className="bg-[#002864] text-white text-[11px] font-black px-2 py-0.5 rounded tracking-wider">{lvl}</span>
                  <h2 className="text-[15px] font-extrabold text-slate-800">{c.name}</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                  {c.students.map((s: any) => renderStudentCard(s, c.class_id, c.name))}
                </div>
              </div>
            ));
          })
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
            {Object.values(groupedClasses).flat().find((c: any) => c.class_id === currentView.classId)?.students.map((s: any) => renderStudentCard(s, currentView.classId, currentView.className))}
          </div>
        )}
      </div>
    </>
  );
}