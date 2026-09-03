// src/components/admin/ClassVacancyChart.tsx
"use client";

import React, { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

const ClassVacancyBadge = ({ vacancy }: { vacancy: number }) => {
  if (vacancy <= 0) return <span className="text-[9px] font-black text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded shadow-sm">마감</span>;
  if (vacancy <= 2) return <span className="text-[9px] font-black text-amber-500 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded shadow-sm">마감 임박</span>;
  return <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded shadow-sm">{vacancy}자리 여유</span>;
};

interface ClassVacancyChartProps {
  classStats: any[];
  levelCounts: any;
  openClassModal: (classItem: any) => void;
}

export default function ClassVacancyChart({ classStats, levelCounts, openClassModal }: ClassVacancyChartProps) {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<any>(null);

  useEffect(() => {
    if (levelCounts && chartRef.current) {
      if (chartInstance.current) chartInstance.current.destroy();
      
      const total = Object.values(levelCounts).reduce((a: any, b: any) => a + b, 0) as number;
      if (total === 0) return;

      chartInstance.current = new Chart(chartRef.current, {
        type: 'doughnut',
        data: {
          labels: ['Ultimate', 'Master', 'Apex', 'Titan', 'Horizon', '기타'],
          datasets: [{
            data: [levelCounts['Ultimate']||0, levelCounts['Master']||0, levelCounts['Apex']||0, levelCounts['Titan']||0, levelCounts['Horizon']||0, levelCounts['기타']||0],
            backgroundColor: ['#0f172a', '#002864', '#0ea5e9', '#10b981', '#f59e0b', '#cbd5e1'],
            borderWidth: 0,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '65%',
          plugins: { legend: { position: 'right', labels: { font: { weight: 'bold', size: 11 }, usePointStyle: true, padding: 15 } } }
        },
        plugins: [{
          id: 'textCenter',
          beforeDraw: function(chart) {
            const { width, height, ctx } = chart;
            ctx.restore();
            const fontSize = (height / 110).toFixed(2);
            ctx.font = `900 ${fontSize}em Pretendard`;
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#1e293b";
            const text = `${total}건`, textX = Math.round((width - ctx.measureText(text).width) / 2) - 40, textY = height / 2;
            ctx.fillText(text, textX, textY);
            ctx.save();
          }
        }]
      });
    }
    
    // 컴포넌트가 언마운트될 때 차트 인스턴스 파괴 (메모리 누수 방지)
    return () => {
      if (chartInstance.current) chartInstance.current.destroy();
    };
  }, [levelCounts]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
      <div className="lg:col-span-2 bg-transparent rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-[380px]">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-white shrink-0 rounded-t-2xl">
          <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">🏫 수강반 결원 모니터링 <span className="text-xs font-normal text-slate-400">(목표 정원 기준)</span></h3>
          <span className="text-[10px] font-bold text-rose-500 bg-rose-50 border border-rose-100 px-2 py-1 rounded shadow-sm">결원이 많은 순 (모집 시급) 정렬</span>
        </div>
        <div className="flex-1 overflow-y-auto custom-scroll p-5 bg-transparent border-t-0 border-slate-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {classStats.length === 0 ? <div className="col-span-full text-center py-10 text-slate-400 font-bold text-sm">운영 중인 반이 없습니다.</div> : 
              classStats.map(c => {
                const bgClass = c.vacancy > 2 ? 'bg-blue-50/20 border-blue-200' : 'bg-white border-slate-200';
                const barColor = c.vacancy <= 0 ? 'bg-rose-400' : c.vacancy <= 2 ? 'bg-amber-400' : 'bg-[#002864]';
                return (
                  <div key={c.class_id} onClick={() => openClassModal(c)} className={`p-3 border rounded-xl hover:shadow-md transition-all cursor-pointer flex flex-col justify-between ${bgClass}`}>
                    <div className="flex justify-between items-start mb-2 gap-1">
                      <span className="text-[11px] font-extrabold text-slate-700 truncate" title={c.name}>{c.name}</span>
                      <ClassVacancyBadge vacancy={c.vacancy} />
                    </div>
                    <div>
                      <div className="flex justify-between items-end mb-1">
                        <span className="text-[10px] font-bold text-slate-400">{c.instructor?.name || '미정'} 선생님</span>
                        <span className="text-sm font-black text-[#002864]">{c.sCount}<span className="text-[9px] text-slate-400 font-bold ml-0.5">/ {c.capacity}명</span></span>
                      </div>
                      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden shadow-inner mt-1">
                        <div className={`${barColor} h-1.5 rounded-full transition-all duration-1000`} style={{ width: `${c.fillRate}%` }}></div>
                      </div>
                    </div>
                  </div>
                );
              })
            }
          </div>
        </div>
      </div>

      <div className="lg:col-span-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden h-[380px]">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
          <h3 className="text-sm font-extrabold text-slate-800">📊 레벨별 수강 비중 <span className="text-xs font-normal text-slate-500">(총 수강 건수)</span></h3>
        </div>
        <div className="flex-1 p-5 flex flex-col items-center justify-center relative bg-white">
          <div className="absolute inset-0 p-5 pb-8 flex items-center justify-center">
            <canvas id="levelChart" ref={chartRef}></canvas>
          </div>
          {(!levelCounts || Object.values(levelCounts).reduce((a:any,b:any)=>a+b,0) === 0) && (
            <div className="z-10 text-xs font-bold text-slate-400 bg-white/80 p-2 rounded">재원생 데이터가 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}