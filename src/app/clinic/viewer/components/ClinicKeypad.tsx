// src/app/clinic/viewer/components/ClinicKeypad.tsx
import React from 'react';

interface ClinicKeypadProps {
  currentQIndex: number;
  keypadAnswers: React.MutableRefObject<Record<number, string>>;
  keypadCursor: React.MutableRefObject<Record<number, number>>;
  studentAnswers: React.MutableRefObject<Record<number, string | null>>;
  keypadCollapsed: boolean;
  forceUpdate: () => void;
}

export function ClinicKeypad({
  currentQIndex, keypadAnswers, keypadCursor, studentAnswers, keypadCollapsed, forceUpdate
}: ClinicKeypadProps) {

  const pressKeypad = (key: string) => {
    const idx = currentQIndex;
    let cur = keypadAnswers.current[idx] || '';
    let pos = keypadCursor.current[idx] ?? cur.length;
    pos = Math.max(0, Math.min(pos, cur.length));

    if (key === 'back') {
      if (pos > 0) { cur = cur.slice(0, pos - 1) + cur.slice(pos); pos -= 1; }
    } else if (key === 'clear') {
      cur = ''; pos = 0;
    } else {
      const insert = key === ',' ? ', ' : key;
      cur = cur.slice(0, pos) + insert + cur.slice(pos);
      pos += insert.length;
    }

    keypadAnswers.current[idx] = cur;
    keypadCursor.current[idx] = pos;
    studentAnswers.current[idx] = cur.trim() || null;
    forceUpdate();
  };

  const renderKeypadButton = (k: string) => {
    let btnClass = 'bg-slate-50 text-slate-700 text-base hover:bg-slate-100'; 
    let label = k;
    if (k === 'back') {
      btnClass = 'bg-slate-200 text-slate-600 text-sm hover:bg-slate-300';
      label = '지우기 ⌫';
    } else if (k === 'clear') {
      btnClass = 'bg-rose-100 text-rose-600 text-sm hover:bg-rose-200';
      label = '전체 삭제 C';
    } else if (k === '0') {
      btnClass = 'col-span-2 bg-slate-50 text-slate-700 text-base hover:bg-slate-100';
    } else if (k === '-' || k === '.' || k === '/') {
      btnClass = 'bg-slate-100 text-slate-600 text-sm hover:bg-slate-200';
      if (k === '/') label = '분수 ( / )';
    }
    return (
      // 🌟 잘림 현상 방지를 위해 버튼 높이를 h-10 -> h-9 (md:h-11) 로 미세하게 축소
      <button key={k} onClick={() => pressKeypad(k)} className={`h-9 md:h-11 rounded-lg font-black transition-colors shadow-sm border border-slate-200 ${btnClass}`}>
        {label}
      </button>
    );
  };

  const idx = currentQIndex;
  const kpVal = keypadAnswers.current[idx] || '';
  const kpPos = Math.max(0, Math.min(keypadCursor.current[idx] ?? kpVal.length, kpVal.length));
  const moveCursor = (pos: number) => { keypadCursor.current[idx] = pos; forceUpdate(); };

  return (
    <div className="w-full flex flex-col gap-2 h-full">
      <div className="w-full min-h-[3.5rem] text-3xl font-extrabold text-right px-4 py-3 border-[3px] border-slate-200 rounded-xl bg-slate-50 text-slate-800 flex items-center justify-end overflow-x-auto whitespace-pre cursor-text">
        {kpVal ? (
          <>
            <span onClick={() => moveCursor(0)} className="inline-block w-2 self-stretch" />
            {kpVal.split('').map((ch, i) => (
              <React.Fragment key={i}>
                {i === kpPos && <span className="inline-block w-[3px] h-6 bg-[#002864] mx-0.5 animate-pulse" />}
                <span onClick={() => moveCursor(i + 1)} className="hover:bg-blue-100 rounded-md px-0.5">{ch}</span>
              </React.Fragment>
            ))}
            {kpPos === kpVal.length && <span className="inline-block w-[3px] h-6 bg-[#002864] mx-0.5 animate-pulse" />}
          </>
        ) : <span className="text-slate-300 font-normal">정답을 입력하세요</span>}
      </div>
      
      <div className={`flex flex-col flex-1 overflow-y-auto custom-scrollbar transition-all duration-300 ${keypadCollapsed ? 'max-h-0 opacity-0' : 'max-h-[800px] opacity-100'}`}>
        {/* 🌟 pb-4 추가 및 max-h 완화로 밑부분이 잘리는 현상 방어 */}
        <div className="grid grid-cols-4 gap-1.5 pt-2 pb-4 flex-1">
          <button onClick={() => pressKeypad(' ')} className="col-span-4 py-1.5 rounded-lg font-bold bg-slate-100 text-slate-500 text-sm hover:bg-slate-200 transition-colors shadow-sm border border-slate-200">대분수 띄어쓰기 ( ␣ )</button>
          {['7','8','9','back','4','5','6','clear','1','2','3','-','0','.','/'].map(renderKeypadButton)}
          <button onClick={() => pressKeypad(',')} className="col-span-4 py-1.5 rounded-lg font-bold bg-slate-100 text-slate-500 text-sm hover:bg-slate-200 transition-colors shadow-sm border border-slate-200">쉼표 추가 ( , )</button>
        </div>
      </div>
    </div>
  );
}