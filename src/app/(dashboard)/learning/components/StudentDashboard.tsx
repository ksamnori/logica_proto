// src/app/(dashboard)/learning/components/StudentDashboard.tsx
import React from "react";

// page.tsx에서 사용하던 타입들을 가져옵니다.
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
  currentView,
  activeTab,
  isFilterActive,
  setIsFilterActive,
  handleViewChange,
  handleStudentClick,
  groupedClasses,
  studentStatsMap,
  LEVEL_ORDER
}: StudentDashboardProps) {

  // 💡 기존 page.tsx에 있던 학생 카드 렌더링 함수를 이 안으로 옮겨왔습니다.
  const renderStudentCard = (s: any, classId: string, cName: string, showClassNameBadge = false) => {
    const stats = (activeTab === 'INCORRECT' || classId === 'UNKNOWN') 
      ? studentStatsMap[`${s.id}_ALL`] 
      : studentStatsMap[`${s.id}_${classId}`];
      
    const { pending = 0, pendingQ = 0 } = stats || { pending: 0, pendingQ: 0 };
    const displayCount = activeTab === 'INCORRECT' ? pendingQ : pending;
    
    if (isFilterActive && displayCount === 0) return null;

    return (
      <div 
        key={s.id} 
        onClick={() => handleStudentClick(s.id, s.name, classId, cName)} 
        className={`px-3 py-2.5 rounded-xl border shadow-sm cursor-pointer transition-all flex items-center justify-between ${
          displayCount > 0 
          ? 'bg-rose-50/50 border-rose-300 hover:border-rose-500 hover:-translate-y-0.5' 
          : 'bg-white border-slate-200 hover:border-[#002864] hover:-translate-y-0.5'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {showClassNameBadge && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${displayCount > 0 ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>{cName}</span>}
          <div className={`font-extrabold text-[13px] truncate ${displayCount > 0 ? 'text-rose-900' : 'text-slate-800'}`}>{s.name}</div>
        </div>
        
        <div className="flex shrink-0 ml-1.5">
          {displayCount > 0 && (
             <span className={`text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm ${activeTab === 'INCORRECT' ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'}`}>
               {activeTab === 'INCORRECT' ? `오답 ${displayCount}문항` : `미해결 ${displayCount}건`}
             </span>
          )}
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
              <h2 className="text-lg font-extrabold text-slate-800">전체 반 학생 요약 목록</h2>
              <p className="text-[11px] font-bold text-slate-400 mt-0.5">모든 반의 학생들을 한눈에 확인하고 미해결 항목을 관리하세요.</p>
            </>
          ) : (
            <h2 className="text-lg font-extrabold text-slate-800"><span className="text-[#002864]">{currentView.className}</span> 반 학생 목록</h2>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeTab !== 'DASHBOARD' && (
            <button 
              onClick={() => handleViewChange({ type: 'GLOBAL_LIST', classId: '', className: '', studentId: '', studentName: '' })}
              className="px-4 py-2 rounded-lg text-[12px] font-bold bg-white text-[#002864] border border-[#002864] hover:bg-blue-50 transition-colors shadow-sm"
            >
              전체 {activeTab === 'EXAM' ? '시험 목록' : activeTab === 'HOMEWORK' ? '과제 리스트' : '오답 프린트'} 보기 ➔
            </button>
          )}
          <button onClick={() => setIsFilterActive(!isFilterActive)} className={`px-4 py-2 rounded-lg border text-[12px] font-bold shadow-sm transition-colors ${isFilterActive ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
            🚨 미해결 학생만 보기
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scroll p-5 bg-slate-50/50">
        {isAllView ? (
          LEVEL_ORDER.map(lvl => {
            const classList = groupedClasses[lvl];
            if (!classList || classList.length === 0) return null;
            
            const visibleClasses = classList.filter(c => c.students.some((s: any) => {
              const stats = studentStatsMap[`${s.id}_${c.class_id}`] || { pending: 0, pendingQ: 0 };
              return !isFilterActive || (stats.pending > 0 || stats.pendingQ > 0);
            }));
            
            if (visibleClasses.length === 0) return null;

            return visibleClasses.map((c, cIdx) => (
              <div key={`class_group_${c.class_id}_${cIdx}`} className="mb-6">
                <div className="flex items-center gap-2 mb-3 border-b border-slate-200 pb-1.5">
                  <span className="bg-[#002864] text-white text-[9px] font-black px-1.5 py-0.5 rounded tracking-wider">{lvl}</span>
                  <h2 className="text-base font-extrabold text-slate-800">{c.name}</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                  {c.students.map((s: any) => renderStudentCard(s, c.class_id, c.name, true))}
                </div>
              </div>
            ));
          })
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
            {Object.values(groupedClasses).flat().find((c: any) => c.class_id === currentView.classId)?.students.map((s: any) => renderStudentCard(s, currentView.classId, currentView.className))}
          </div>
        )}
      </div>
    </>
  );
}