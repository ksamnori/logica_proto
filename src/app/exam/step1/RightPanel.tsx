// src/app/exam/step1/RightPanel.tsx
import React, { useEffect, useRef } from "react";

export default function RightPanel({ step1Data }: { step1Data: any }) {
  const {
    qCount, setQCount, diffBounds, setDiffBounds, rateMax, setRateMax, rateMin, setRateMin,
    types, setTypes, isSettingsDisabled
  } = step1Data;

  const diffTrackRef = useRef<HTMLDivElement>(null);
  const draggingHandleRef = useRef<number | null>(null);
  const qCountOptions = [5, 10, 20, 25, 30, 50];

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (draggingHandleRef.current === null || !diffTrackRef.current || isSettingsDisabled) return;

      const rect = diffTrackRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      let pct = Math.round(((clientX - rect.left) / rect.width) * 100);
      pct = Math.max(0, Math.min(100, pct));
      
      const idx = draggingHandleRef.current;
      setDiffBounds((prev: number[]) => {
        const minBound = idx === 0 ? 0 : prev[idx - 1];
        const maxBound = idx === 3 ? 100 : prev[idx + 1];
        pct = Math.max(minBound, Math.min(maxBound, pct));
        
        if (prev[idx] === pct) return prev; 
        const next = [...prev];
        next[idx] = pct;
        return next;
      });
    };

    const handleUp = () => { draggingHandleRef.current = null; };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("touchmove", handleMove, { passive: true });
    document.addEventListener("mouseup", handleUp);
    document.addEventListener("touchend", handleUp);

    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.removeEventListener("touchend", handleUp);
    };
  }, [isSettingsDisabled, setDiffBounds]);

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-32 custom-scrollbar">
      <h2 className="font-extrabold text-2xl text-slate-800 mb-6 flex items-center justify-between">
        <span>🎯 출제 조건 설정</span>
        {isSettingsDisabled && <span className="text-sm bg-rose-100 text-rose-600 px-3 py-1 rounded-lg">테스트 전용 자동 설정 모드</span>}
      </h2>

      <div className={`transition-all duration-300 ${isSettingsDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
        
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h3 className="font-bold text-slate-700 mb-4 border-b pb-2 flex justify-between items-center">
            <span>1. 총 출제 문항 수</span><span className="text-xs font-normal text-slate-400">최대 150문제</span>
          </h3>
          <div className="flex items-center justify-between mb-5">
            <div className="flex space-x-2">
              {qCountOptions.map(num => (
                <button key={num} onClick={() => setQCount(num)} className={`w-16 py-2 rounded-lg font-bold border-2 transition-all ${qCount === num ? 'border-[#002864] text-[#002864] bg-blue-50' : 'border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{num}</button>
              ))}
            </div>
            <div className="flex items-center space-x-2">
              <input type="number" min="1" max="150" value={qCount} onChange={(e) => setQCount(Number(e.target.value))} className="w-20 px-3 py-2 rounded-lg text-[#002864] font-extrabold text-center border border-slate-300 outline-none focus:border-[#002864]" />
              <span className="text-slate-500 font-bold text-sm">문제</span>
            </div>
          </div>
          <div className="relative pt-2">
            <input type="range" min="1" max="150" value={qCount} onChange={(e) => setQCount(Number(e.target.value))} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#002864]" />
            <div className="flex justify-between text-xs text-slate-400 mt-2 font-bold"><span>1</span><span>150</span></div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex justify-between items-center mb-6 border-b pb-2">
            <h3 className="font-bold text-slate-700">2. 난이도 배분 (레벨별 슬라이더)</h3>
            <div className="flex space-x-2">
              <button onClick={() => setDiffBounds([10, 30, 70, 90])} className="px-3 py-1 text-xs font-bold rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm">기본 분포</button>
              <button onClick={() => setDiffBounds([20, 60, 90, 100])} className="px-3 py-1 text-xs font-bold rounded border border-slate-200 bg-white text-emerald-600 hover:bg-emerald-50 shadow-sm">하위권 맞춤</button>
              <button onClick={() => setDiffBounds([0, 10, 40, 80])} className="px-3 py-1 text-xs font-bold rounded border border-slate-200 bg-white text-rose-600 hover:bg-rose-50 shadow-sm">상위권 맞춤</button>
            </div>
          </div>

          <div className="relative w-full h-12 bg-slate-100 rounded-lg flex select-none mb-3 shadow-inner" ref={diffTrackRef}>
            <div className="bg-slate-200 rounded-l-lg text-slate-500 flex items-center justify-center font-extrabold text-[13px] overflow-hidden transition-all duration-100" style={{ width: `${diffBounds[0]}%` }}>{diffBounds[0] >= 5 ? `${diffBounds[0]}%` : ''}</div>
            <div className="bg-sky-200 text-sky-800 flex items-center justify-center font-extrabold text-[13px] overflow-hidden transition-all duration-100" style={{ width: `${diffBounds[1]-diffBounds[0]}%` }}>{diffBounds[1]-diffBounds[0] >= 5 ? `${diffBounds[1]-diffBounds[0]}%` : ''}</div>
            <div className="bg-blue-500 text-white shadow-[inset_0_0_10px_rgba(0,0,0,0.1)] flex items-center justify-center font-extrabold text-[13px] overflow-hidden transition-all duration-100" style={{ width: `${diffBounds[2]-diffBounds[1]}%` }}>{diffBounds[2]-diffBounds[1] >= 5 ? `${diffBounds[2]-diffBounds[1]}%` : ''}</div>
            <div className="bg-indigo-500 text-white flex items-center justify-center font-extrabold text-[13px] overflow-hidden transition-all duration-100" style={{ width: `${diffBounds[3]-diffBounds[2]}%` }}>{diffBounds[3]-diffBounds[2] >= 5 ? `${diffBounds[3]-diffBounds[2]}%` : ''}</div>
            <div className="bg-rose-400 rounded-r-lg text-white flex items-center justify-center font-extrabold text-[13px] overflow-hidden transition-all duration-100" style={{ width: `${100-diffBounds[3]}%` }}>{100-diffBounds[3] >= 5 ? `${100-diffBounds[3]}%` : ''}</div>
            
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} onMouseDown={() => { draggingHandleRef.current = idx; }} onTouchStart={() => { draggingHandleRef.current = idx; }} 
                   className="absolute top-1/2 -translate-y-1/2 -ml-[7px] w-[14px] h-[28px] bg-white border-2 border-[#002864] rounded cursor-ew-resize flex items-center justify-center gap-[2px] shadow-md hover:scale-110 hover:border-blue-500 transition-transform z-10 hover:z-20 active:z-20" 
                   style={{ left: `${diffBounds[idx]}%` }}>
                <div className="w-[2px] h-[12px] bg-slate-300 rounded-[1px]"></div><div className="w-[2px] h-[12px] bg-slate-300 rounded-[1px]"></div>
              </div>
            ))}
          </div>
          <div className="flex w-full mt-1">
            <div className="text-center text-[13px] font-bold text-slate-500 transition-all duration-100" style={{ width: `${diffBounds[0]}%` }}>최하</div>
            <div className="text-center text-[13px] font-bold text-sky-600 transition-all duration-100" style={{ width: `${diffBounds[1]-diffBounds[0]}%` }}>하</div>
            <div className="text-center text-[15px] font-extrabold text-blue-700 transition-all duration-100" style={{ width: `${diffBounds[2]-diffBounds[1]}%` }}>중</div>
            <div className="text-center text-[13px] font-bold text-indigo-600 transition-all duration-100" style={{ width: `${diffBounds[3]-diffBounds[2]}%` }}>상</div>
            <div className="text-center text-[13px] font-bold text-rose-500 transition-all duration-100" style={{ width: `${100-diffBounds[3]}%` }}>최상</div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h3 className="font-bold text-slate-700 mb-4 border-b pb-2">3. 출제 속성 및 포맷</h3>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <label className="block text-sm font-bold text-slate-500 mb-3">문제 유형 (복수 선택 가능)</label>
              <div className="space-y-3">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input type="checkbox" checked={types.obj} onChange={e => setTypes({...types, obj: e.target.checked})} className="w-4 h-4 accent-[#002864] rounded border-slate-300" />
                  <span className="text-slate-700 font-medium text-sm">객관식</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input type="checkbox" checked={types.subj} onChange={e => setTypes({...types, subj: e.target.checked})} className="w-4 h-4 accent-[#002864] rounded border-slate-300" />
                  <span className="text-slate-700 font-medium text-sm">주관식 (단답형)</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input type="checkbox" checked={types.essay} onChange={e => setTypes({...types, essay: e.target.checked})} className="w-4 h-4 accent-[#002864] rounded border-slate-300" />
                  <span className="text-slate-700 font-medium text-sm">서술형</span>
                </label>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-3">
                <label className="block text-sm font-bold text-slate-500">세부 정답률 필터</label>
                <span className="text-xs font-extrabold text-[#002864] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">{rateMax}% ~ {rateMin}%</span>
              </div>
              
              <div className="relative w-full h-10 flex items-center">
                <style dangerouslySetInnerHTML={{__html: `
                  .dual-slider::-webkit-slider-thumb { pointer-events: auto; appearance: none; width: 20px; height: 20px; background: white; border: 2px solid #002864; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.2); cursor: grab; }
                  .dual-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.1); }
                `}} />
                <div className="absolute w-full h-2 bg-slate-200 rounded-full"></div>
                <div className="absolute h-2 bg-blue-400 rounded-full transition-all" style={{ left: `${100 - rateMax}%`, right: `${rateMin}%` }}></div>
                
                <input type="range" min="0" max="100" value={100 - rateMax} 
                       onChange={e => { const v = 100 - Number(e.target.value); if(v >= rateMin) setRateMax(v); }} 
                       className="dual-slider absolute w-full h-2 appearance-none bg-transparent pointer-events-none" />
                       
                <input type="range" min="0" max="100" value={100 - rateMin} 
                       onChange={e => { const v = 100 - Number(e.target.value); if(v <= rateMax) setRateMin(v); }} 
                       className="dual-slider absolute w-full h-2 appearance-none bg-transparent pointer-events-none" />
              </div>
              
              <div className="flex justify-between mt-1 text-[11px] font-bold text-slate-400">
                <span>100% (쉬움)</span>
                <span>0% (어려움)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}