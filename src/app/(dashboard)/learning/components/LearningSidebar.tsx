// src/app/(dashboard)/learning/components/LearningSidebar.tsx
"use client";

import React, { useEffect, useState } from "react";
import { ClassInfo, ViewState } from "../types";
import { LEVEL_ORDER } from "../hooks/useLearningFetch";

interface LearningSidebarProps {
  currentView: ViewState;
  groupedClasses: Record<string, ClassInfo[]>;
  studentStatsMap: Record<string, { examQ: number; hwQ: number; printQ: number; similarQ: number; }>;
  isLoading: boolean;
  handleViewChange: (view: ViewState) => void;
  handleStudentClick: (studentId: string, studentName: string, classId: string, className: string) => void;
}

export default function LearningSidebar({
  currentView,
  groupedClasses,
  studentStatsMap,
  isLoading,
  handleViewChange,
  handleStudentClick
}: LearningSidebarProps) {
  
  const [expandedLevels, setExpandedLevels] = useState<string[]>([]);
  const [expandedClasses, setExpandedClasses] = useState<string[]>([]);
  const [isAllExpanded, setIsAllExpanded] = useState(false);

  useEffect(() => {
    if (currentView.type === 'STUDENT' || currentView.type === 'CLASS') {
      const cId = currentView.classId;
      if (cId) {
        setExpandedClasses(prev => prev.includes(cId) ? prev : [...prev, cId]);
        for (const [level, classes] of Object.entries(groupedClasses)) {
          if (classes && Array.isArray(classes) && classes.some(c => c && c.class_id === cId)) {
            setExpandedLevels(prev => prev.includes(level) ? prev : [...prev, level]);
            break;
          }
        }
      }
    }
  }, [currentView.classId, currentView.type, groupedClasses]);

  const toggleAllAccordions = () => {
    if (isAllExpanded) {
      setExpandedLevels([]); 
      setExpandedClasses([]);
    } else {
      const allLevels = LEVEL_ORDER.filter(l => groupedClasses[l] && groupedClasses[l].length > 0);
      const allClasses: string[] = [];
      
      Object.values(groupedClasses).forEach((classArr) => {
        if (Array.isArray(classArr)) {
          classArr.forEach((c) => {
            if (c && c.class_id) allClasses.push(c.class_id);
          });
        }
      });
      
      setExpandedLevels(allLevels); 
      setExpandedClasses(allClasses);
    }
    setIsAllExpanded(!isAllExpanded);
  };

  const handleLevelClick = (lvl: string) => setExpandedLevels(prev => prev.includes(lvl) ? prev.filter(l => l !== lvl) : [...prev, lvl]);
  
  const handleClassClick = (classId: string, className: string) => {
    setExpandedClasses(prev => prev.includes(classId) ? prev.filter(c => c !== classId) : [...prev, classId]);
    handleViewChange({ type: 'CLASS', classId, className, studentId: '', studentName: '' });
  };

  return (
    <div className="w-[230px] bg-white rounded-xl border border-slate-200 flex flex-col shrink-0 z-10 shadow-sm overflow-hidden">
      <div className={`p-4 border-b border-slate-200 shrink-0 flex justify-between items-center transition-colors ${currentView.type === 'ALL' ? 'bg-blue-50' : 'bg-slate-50'}`}>
        <h3 className={`text-[12px] font-extrabold flex items-center gap-1.5 cursor-pointer hover:underline ${currentView.type === 'ALL' ? 'text-blue-700' : 'text-[#002864]'}`} onClick={() => handleViewChange({type: 'ALL', classId: '', className: '', studentId: '', studentName: ''})}>
          <span>🏫 학원 전체 현황</span>
        </h3>
        <button onClick={toggleAllAccordions} className="text-[11px] font-bold bg-white border border-slate-300 px-2.5 py-1 rounded hover:bg-slate-100 transition-colors shadow-sm focus:outline-none">
          {isAllExpanded ? "접기" : "펼치기"}
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scroll">
        {isLoading ? <div className="p-8 text-center text-slate-400 font-bold text-[12px]">로딩 중...</div> : (
          LEVEL_ORDER.map(lvl => {
            const classList = groupedClasses[lvl];
            if (!classList || classList.length === 0) return null;
            
            const isLvlExpanded = expandedLevels.includes(lvl);
            const isLevelHighlighted = isLvlExpanded;
            
            return (
              <div key={lvl} className="border-b border-slate-200">
                <button onClick={() => handleLevelClick(lvl)} className={`w-full flex justify-between items-center pr-4 pl-3 py-3 transition-colors border-l-4 ${isLevelHighlighted ? 'bg-slate-100 border-[#002864]' : 'bg-white hover:bg-slate-50 border-transparent'}`}>
                  <span className={`font-extrabold text-[12px] ${isLevelHighlighted ? 'text-[#002864]' : 'text-slate-700'}`}>{isLevelHighlighted ? '📂 ' : '📁 '}{lvl}</span>
                  <svg className={`w-3.5 h-3.5 transition-transform ${isLvlExpanded ? "rotate-180 text-[#002864]" : "text-slate-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </button>
                {isLvlExpanded && (
                  <div className="flex flex-col bg-slate-50 border-t border-slate-100">
                    {classList.map(c => {
                      if (!c) return null;
                      const isClassExpanded = expandedClasses.includes(c.class_id);
                      const isClassActive = currentView.classId === c.class_id && currentView.type !== 'ALL';
                      
                      return (
                        <div key={c.class_id} className="border-b border-slate-200/60 last:border-0">
                          <button onClick={() => handleClassClick(c.class_id, c.name)} className={`w-full flex justify-between items-center pr-4 py-2.5 transition-colors border-l-4 pl-4 ${isClassActive ? 'bg-blue-50/80 border-blue-500' : 'hover:bg-blue-50/40 border-transparent'}`}>
                            <span className={`font-bold text-[11px] text-left ${isClassActive ? 'text-blue-700' : 'text-[#002864]'}`}>{isClassActive ? '📌 ' : ''}{c.name}</span>
                            <svg className={`w-3 h-3 transition-transform ${isClassExpanded ? "rotate-180" : ""} ${isClassActive ? "text-blue-500" : "text-blue-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                          </button>
                          {isClassExpanded && (
                            <div className="flex flex-col bg-white">
                              {!c.students || c.students.length === 0 ? <div className="py-3 text-center text-[10px] text-slate-400 font-bold bg-slate-50/50">학생 없음</div> : (
                                c.students.map(s => {
                                  if (!s) return null;
                                  const allStats = studentStatsMap[`${s.id}_ALL`] || { examQ: 0, hwQ: 0, printQ: 0, similarQ: 0 };
                                  const displayExamQ = allStats.examQ;
                                  const displayHwQ = allStats.hwQ;
                                  const displayPrintQ = allStats.printQ;
                                  const displaySimilarQ = allStats.similarQ;
                                  const isStudentActive = currentView.studentId === s.id && currentView.classId === c.class_id;

                                  return (
                                    <button key={s.id} onClick={() => handleStudentClick(s.id, s.name, c.class_id, c.name)} className={`w-full flex items-center justify-between pl-8 pr-3 py-2 text-[11px] font-bold transition-colors border-l-4 ${isStudentActive ? 'bg-[#eff6ff] border-[#002864] text-[#002864]' : 'text-slate-500 hover:bg-slate-50 hover:text-blue-700 border-transparent'}`}>
                                      <span className="truncate text-left flex-1 min-w-0">{isStudentActive ? '👉 ' : ''}{s.name}</span>
                                      
                                      <div className="flex items-center gap-1 shrink-0 ml-1.5">
                                        <div className="w-[18px] flex justify-center">
                                          {displayExamQ > 0 && <span className="bg-blue-100 text-blue-700 w-full py-0.5 text-center rounded-full shadow-sm text-[9px] font-black" title="시험 미해결 문항">{displayExamQ}</span>}
                                        </div>
                                        <div className="w-[18px] flex justify-center">
                                          {displayHwQ > 0 && <span className="bg-amber-100 text-amber-700 w-full py-0.5 text-center rounded-full shadow-sm text-[9px] font-black" title="과제 미해결 문항">{displayHwQ}</span>}
                                        </div>
                                        <div className="w-[18px] flex justify-center">
                                          {displayPrintQ > 0 && <span className="bg-emerald-100 text-emerald-700 w-full py-0.5 text-center rounded-full shadow-sm text-[9px] font-black" title="오답 미해결 문항">{displayPrintQ}</span>}
                                        </div>
                                        <div className="w-[18px] flex justify-center">
                                          {displaySimilarQ > 0 && <span className="bg-violet-100 text-violet-700 w-full py-0.5 text-center rounded-full shadow-sm text-[9px] font-black" title="오답유사 미해결 문항">{displaySimilarQ}</span>}
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}