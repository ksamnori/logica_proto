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
  studentStatsMap: Record<string, { examQ: number; hwQ: number; printQ: number; }>;
  LEVEL_ORDER: string[];
}

export default function StudentDashboard({
  handleStudentClick, groupedClasses, studentStatsMap, LEVEL_ORDER, currentView
}: StudentDashboardProps) {

  // 🌟 미해결 항목이 있는 학생들만 추출하여 '해야 할 일(To-Do)' 액션 리스트 생성
  const actionList = useMemo(() => {
    const list: any[] = [];
    let totalExam = 0;
    let totalHw = 0;
    let totalPrint = 0;
    
    // 💡 [핵심 버그 수정] 다중 수강생 중복 방지 (Key 중복 및 카운트 뻥튀기 차단)
    const processedStudentIds = new Set<string>();

    LEVEL_ORDER.forEach(lvl => {
      const classes = groupedClasses[lvl] || [];
      classes.forEach(cls => {
        // 현재 뷰가 특정 반을 선택한 상태라면 그 반 학생들만 필터링
        if (currentView.type === 'CLASS' && currentView.classId !== cls.class_id) return;

        cls.students.forEach((stu: any) => {
          // 이미 리스트에 추가된 다중 수강생이라면 무시하고 넘어감
          if (processedStudentIds.has(stu.id)) return;

          // page.tsx에서 내려주는 studentStatsMap을 활용해 실시간 미해결 건수 스캔
          const stats = studentStatsMap[`${stu.id}_ALL`] || { examQ: 0, hwQ: 0, printQ: 0 };
          const totalPending = stats.examQ + stats.hwQ + stats.printQ;
          
          if (totalPending > 0) {
            processedStudentIds.add(stu.id); // 처리 명단에 등록
            list.push({
              id: stu.id,
              name: stu.name,
              classId: cls.class_id,
              className: cls.name,
              level: lvl,
              stats
            });
            totalExam += stats.examQ;
            totalHw += stats.hwQ;
            totalPrint += stats.printQ;
          }
        });
      });
    });

    // 🚨 미해결 항목 총합이 많은 학생 순으로 내림차순 정렬 (가장 급한 학생이 맨 위로)
    list.sort((a, b) => {
      const aTotal = a.stats.examQ + a.stats.hwQ + a.stats.printQ;
      const bTotal = b.stats.examQ + b.stats.hwQ + b.stats.printQ;
      if (bTotal !== aTotal) return bTotal - aTotal;
      return a.name.localeCompare(b.name);
    });

    return { list, totalExam, totalHw, totalPrint };
  }, [groupedClasses, studentStatsMap, LEVEL_ORDER, currentView]);

  const { list, totalExam, totalHw, totalPrint } = actionList;

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      
      {/* 🚀 상단 요약 현황판 헤더 */}
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
        
        <div className="flex gap-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 flex flex-col items-center min-w-[110px] shadow-sm">
            <span className="text-[11px] font-extrabold text-blue-600 mb-1">💯 미해결 시험</span>
            <span className="text-2xl font-black text-blue-700">{totalExam}<span className="text-sm ml-0.5">건</span></span>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex flex-col items-center min-w-[110px] shadow-sm">
            <span className="text-[11px] font-extrabold text-amber-600 mb-1">📝 미해결 과제</span>
            <span className="text-2xl font-black text-amber-700">{totalHw}<span className="text-sm ml-0.5">건</span></span>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 flex flex-col items-center min-w-[110px] shadow-sm">
            <span className="text-[11px] font-extrabold text-emerald-600 mb-1">❌ 오답 미해결</span>
            <span className="text-2xl font-black text-emerald-700">{totalPrint}<span className="text-sm ml-0.5">건</span></span>
          </div>
        </div>
      </div>

      {/* 🚀 메인 미해결 리스트 테이블 */}
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
                  <th className="py-3.5 px-6 text-center text-blue-700">시험</th>
                  <th className="py-3.5 px-6 text-center text-amber-700">과제</th>
                  <th className="py-3.5 px-6 text-center text-emerald-700">오답 프린트</th>
                  <th className="py-3.5 px-6 w-36 text-center">관리 액션</th>
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
                    <td className="py-3.5 px-6 text-center">
                      {stu.stats.examQ > 0 ? (
                        <span className="inline-flex items-center justify-center bg-blue-100 text-blue-700 w-8 h-8 rounded-full font-black text-sm shadow-sm border border-blue-200">{stu.stats.examQ}</span>
                      ) : <span className="text-slate-300 font-medium text-xs">-</span>}
                    </td>
                    <td className="py-3.5 px-6 text-center">
                      {stu.stats.hwQ > 0 ? (
                        <span className="inline-flex items-center justify-center bg-amber-100 text-amber-700 w-8 h-8 rounded-full font-black text-sm shadow-sm border border-amber-200">{stu.stats.hwQ}</span>
                      ) : <span className="text-slate-300 font-medium text-xs">-</span>}
                    </td>
                    <td className="py-3.5 px-6 text-center">
                      {stu.stats.printQ > 0 ? (
                        <span className="inline-flex items-center justify-center bg-emerald-100 text-emerald-700 w-8 h-8 rounded-full font-black text-sm shadow-sm border border-emerald-200">{stu.stats.printQ}</span>
                      ) : <span className="text-slate-300 font-medium text-xs">-</span>}
                    </td>
                    <td className="py-3.5 px-6 text-center">
                      <button 
                        onClick={() => handleStudentClick(stu.id, stu.name, stu.classId, stu.className)}
                        className="bg-rose-500 hover:bg-rose-600 text-white px-4 py-2.5 rounded-lg text-[11px] font-black transition-colors shadow-sm w-full flex items-center justify-center gap-1.5 opacity-90 group-hover:opacity-100 group-hover:-translate-y-0.5"
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