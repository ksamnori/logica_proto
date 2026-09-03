// src/app/(dashboard)/learning/components/StudentDashboard.tsx
"use client";

import React, { useMemo } from 'react';

interface StudentDashboardProps {
  currentView: any;
  activeTab: string;
  isFilterActive: boolean;
  setIsFilterActive: (v: boolean) => void;
  handleViewChange: (view: any) => void;
  handleStudentClick: (studentId: string, studentName: string, classId: string, className: string) => void;
  groupedClasses: Record<string, any[]>;
  studentStatsMap: Record<string, { examC: number; examQ: number; hwC: number; hwQ: number; printC: number; printQ: number; similarC: number; similarQ: number; overdueC: number; overdueQ: number; }>;
  LEVEL_ORDER: string[];
}

export default function StudentDashboard({
  handleStudentClick, groupedClasses, studentStatsMap, LEVEL_ORDER, currentView
}: StudentDashboardProps) {

  const actionList = useMemo(() => {
    const list: any[] = [];
    let totalExamC = 0, totalExamQ = 0;
    let totalHwC = 0, totalHwQ = 0;
    let totalPrintC = 0, totalPrintQ = 0;
    let totalSimilarC = 0, totalSimilarQ = 0;
    let totalOverdueC = 0, totalOverdueQ = 0;
    
    const processedStudentIds = new Set<string>();

    LEVEL_ORDER.forEach(lvl => {
      const classes = groupedClasses[lvl] || [];
      classes.forEach(cls => {
        if (currentView.type === 'CLASS' && currentView.classId !== cls.class_id) return;

        cls.students.forEach((stu: any) => {
          if (processedStudentIds.has(stu.id)) return;

          const stats = studentStatsMap[`${stu.id}_ALL`] || { examC: 0, examQ: 0, hwC: 0, hwQ: 0, printC: 0, printQ: 0, similarC: 0, similarQ: 0, overdueC: 0, overdueQ: 0 };
          const totalPendingCount = stats.examC + stats.hwC + stats.printC + stats.similarC + stats.overdueC;
          
          if (totalPendingCount > 0) {
            processedStudentIds.add(stu.id); 
            list.push({
              id: stu.id,
              name: stu.name,
              classId: cls.class_id,
              className: cls.name,
              level: lvl,
              stats
            });
            totalExamC += stats.examC; totalExamQ += stats.examQ;
            totalHwC += stats.hwC; totalHwQ += stats.hwQ;
            totalPrintC += stats.printC; totalPrintQ += stats.printQ;
            totalSimilarC += stats.similarC; totalSimilarQ += stats.similarQ;
            totalOverdueC += stats.overdueC; totalOverdueQ += stats.overdueQ;
          }
        });
      });
    });

    list.sort((a, b) => {
      const aTotal = a.stats.examC + a.stats.hwC + a.stats.printC + a.stats.similarC + a.stats.overdueC;
      const bTotal = b.stats.examC + b.stats.hwC + b.stats.printC + b.stats.similarC + b.stats.overdueC;
      if (bTotal !== aTotal) return bTotal - aTotal;
      return a.name.localeCompare(b.name);
    });

    return { list, totalExamC, totalExamQ, totalHwC, totalHwQ, totalPrintC, totalPrintQ, totalSimilarC, totalSimilarQ, totalOverdueC, totalOverdueQ };
  }, [groupedClasses, studentStatsMap, LEVEL_ORDER, currentView]);

  const { list, totalExamC, totalExamQ, totalHwC, totalHwQ, totalPrintC, totalPrintQ, totalSimilarC, totalSimilarQ, totalOverdueC, totalOverdueQ } = actionList;

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      
      <div className="px-8 py-6 border-b border-slate-200 bg-white flex justify-between items-end shrink-0 shadow-sm z-10">
        <div>
          <h2 className="text-2xl font-black text-rose-600 tracking-tight flex items-center gap-2">
            <span>🚨</span> 미해결 집중 관리 (Action Center)
          </h2>
          <p className="text-sm font-bold text-slate-500 mt-1.5">
            {currentView.type === 'CLASS' ? (
              <span className="text-[#002864] font-extrabold bg-blue-50 px-2 py-0.5 rounded border border-blue-100 mr-1">[{currentView.className}] 반</span>
            ) : (
              <span className="text-slate-600 font-extrabold mr-1">학원 전체 학생 중</span> 
            )} 
            미제출/미해결된 항목이 있는 학생들을 모아보고 즉시 관리합니다.
          </p>
        </div>
        
        {/* 🌟 건수 중심 + 하단 문항수 표시 UI */}
        <div className="flex gap-3 overflow-x-auto pb-1">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-3 flex flex-col items-center min-w-[85px] shadow-sm shrink-0">
            <span className="text-[11px] font-extrabold text-blue-600 mb-1">💯 시험</span>
            <span className="text-2xl font-black text-blue-700">{totalExamC}<span className="text-sm ml-0.5">건</span></span>
            <span className="text-[10px] font-bold text-slate-400 mt-0.5">총 {totalExamQ}문항</span>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 flex flex-col items-center min-w-[85px] shadow-sm shrink-0">
            <span className="text-[11px] font-extrabold text-amber-600 mb-1">📝 과제</span>
            <span className="text-2xl font-black text-amber-700">{totalHwC}<span className="text-sm ml-0.5">건</span></span>
            <span className="text-[10px] font-bold text-slate-400 mt-0.5">총 {totalHwQ}문항</span>
          </div>
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-3 flex flex-col items-center min-w-[85px] shadow-sm shrink-0">
            <span className="text-[11px] font-extrabold text-rose-600 mb-1">⏰ 미완료</span>
            <span className="text-2xl font-black text-rose-700">{totalOverdueC}<span className="text-sm ml-0.5">건</span></span>
            <span className="text-[10px] font-bold text-slate-400 mt-0.5">총 {totalOverdueQ}문항</span>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-3 flex flex-col items-center min-w-[85px] shadow-sm shrink-0">
            <span className="text-[11px] font-extrabold text-emerald-600 mb-1">❌ 오답</span>
            <span className="text-2xl font-black text-emerald-700">{totalPrintC}<span className="text-sm ml-0.5">건</span></span>
            <span className="text-[10px] font-bold text-slate-400 mt-0.5">총 {totalPrintQ}문항</span>
          </div>
          <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-3 flex flex-col items-center min-w-[85px] shadow-sm shrink-0">
            <span className="text-[11px] font-extrabold text-violet-600 mb-1">🔄 유사</span>
            <span className="text-2xl font-black text-violet-700">{totalSimilarC}<span className="text-sm ml-0.5">건</span></span>
            <span className="text-[10px] font-bold text-slate-400 mt-0.5">총 {totalSimilarQ}문항</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scroll p-6 sm:p-8">
        {list.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 font-bold bg-white border border-slate-200 rounded-2xl shadow-sm">
            <span className="text-6xl mb-4">✨</span>
            <p className="text-xl text-emerald-600 font-black tracking-tight mb-1">모든 학생이 학습을 완벽하게 마쳤습니다!</p>
            <p className="text-sm text-slate-500">현재 미해결된 시험, 과제, 오답 항목이 없습니다.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-[12px] font-extrabold text-slate-600 uppercase tracking-wider">
                  <th className="py-3.5 px-6 w-16 text-center">순위</th>
                  <th className="py-3.5 px-6 w-48">수강반</th>
                  <th className="py-3.5 px-6 w-32">학생명</th>
                  <th className="py-3.5 px-3 text-center text-blue-700">시험</th>
                  <th className="py-3.5 px-3 text-center text-amber-700">과제</th>
                  <th className="py-3.5 px-3 text-center text-rose-700">미완료</th>
                  <th className="py-3.5 px-3 text-center text-emerald-700">오답</th>
                  <th className="py-3.5 px-3 text-center text-violet-700">유사</th>
                  <th className="py-3.5 px-6 w-32 text-center">관리 액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((stu, idx) => (
                  <tr key={stu.id} className="hover:bg-rose-50/40 transition-colors group">
                    <td className="py-3.5 px-6 text-center text-xs font-bold text-slate-400">
                      {idx < 3 ? <span className="text-rose-500 font-black">{idx + 1}</span> : idx + 1}
                    </td>
                    <td className="py-3.5 px-6">
                      <span className="bg-slate-100 border border-slate-200 text-slate-600 px-2.5 py-1 rounded text-xs font-extrabold shadow-sm">
                        {stu.className}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 font-black text-slate-800 text-[14px]">
                      {stu.name}
                    </td>
                    
                    {/* 🌟 테이블 배지 UI 변경 (건수 뱃지 + 하단 회색 문항수) */}
                    <td className="py-3.5 px-3 text-center">
                      {stu.stats.examC > 0 ? (
                        <div className="flex flex-col items-center gap-1">
                          <span className="inline-flex items-center justify-center bg-blue-100 text-blue-700 w-7 h-7 rounded-full font-black text-xs shadow-sm border border-blue-200">{stu.stats.examC}</span>
                          <span className="text-[10px] text-slate-400 font-bold">{stu.stats.examQ}문항</span>
                        </div>
                      ) : <span className="text-slate-300 font-medium text-xs">-</span>}
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      {stu.stats.hwC > 0 ? (
                        <div className="flex flex-col items-center gap-1">
                          <span className="inline-flex items-center justify-center bg-amber-100 text-amber-700 w-7 h-7 rounded-full font-black text-xs shadow-sm border border-amber-200">{stu.stats.hwC}</span>
                          <span className="text-[10px] text-slate-400 font-bold">{stu.stats.hwQ}문항</span>
                        </div>
                      ) : <span className="text-slate-300 font-medium text-xs">-</span>}
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      {stu.stats.overdueC > 0 ? (
                        <div className="flex flex-col items-center gap-1">
                          <span className="inline-flex items-center justify-center bg-rose-100 text-rose-700 w-7 h-7 rounded-full font-black text-xs shadow-sm border border-rose-200">{stu.stats.overdueC}</span>
                          <span className="text-[10px] text-slate-400 font-bold">{stu.stats.overdueQ}문항</span>
                        </div>
                      ) : <span className="text-slate-300 font-medium text-xs">-</span>}
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      {stu.stats.printC > 0 ? (
                        <div className="flex flex-col items-center gap-1">
                          <span className="inline-flex items-center justify-center bg-emerald-100 text-emerald-700 w-7 h-7 rounded-full font-black text-xs shadow-sm border border-emerald-200">{stu.stats.printC}</span>
                          <span className="text-[10px] text-slate-400 font-bold">{stu.stats.printQ}문항</span>
                        </div>
                      ) : <span className="text-slate-300 font-medium text-xs">-</span>}
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      {stu.stats.similarC > 0 ? (
                        <div className="flex flex-col items-center gap-1">
                          <span className="inline-flex items-center justify-center bg-violet-100 text-violet-700 w-7 h-7 rounded-full font-black text-xs shadow-sm border border-violet-200">{stu.stats.similarC}</span>
                          <span className="text-[10px] text-slate-400 font-bold">{stu.stats.similarQ}문항</span>
                        </div>
                      ) : <span className="text-slate-300 font-medium text-xs">-</span>}
                    </td>
                    
                    <td className="py-3.5 px-6 text-center">
                      <button 
                        onClick={() => handleStudentClick(stu.id, stu.name, stu.classId, stu.className)}
                        className="bg-rose-500 hover:bg-rose-600 text-white px-3 py-2 rounded-lg text-[11px] font-black transition-colors shadow-sm w-full flex items-center justify-center gap-1.5 opacity-90 group-hover:opacity-100 group-hover:-translate-y-0.5"
                      >
                        정리하기 ➔
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}