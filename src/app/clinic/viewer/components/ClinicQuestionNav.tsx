import React, { useRef } from 'react';
import { BOOK_TYPE_COLORS } from "@/lib/clinicHomework";

interface ClinicQuestionNavProps {
  questions: any[];
  currentQIndex: number;
  setCurrentQIndex: (idx: number) => void;
  bookFilter: string;
  switchBookFilter: (type: string | 'all') => void;
  availableBooks: { bookType: string | null; count: number }[];
  visibleIndices: number[];
  qBoxStatus: React.MutableRefObject<Record<number, string>>;
  studentAnswers: React.MutableRefObject<Record<number, string | null>>;
  callState: React.MutableRefObject<Record<number, boolean>>;
  setCanvasClearTrigger: React.Dispatch<React.SetStateAction<number>>;
  isTimedRound: boolean;
  timeIsUp: boolean;
  setSubmitConfirmModal: (val: boolean) => void;
}

export function ClinicQuestionNav({
  questions, currentQIndex, setCurrentQIndex, bookFilter, switchBookFilter,
  availableBooks, visibleIndices, qBoxStatus, studentAnswers, callState,
  setCanvasClearTrigger, isTimedRound, timeIsUp, setSubmitConfirmModal
}: ClinicQuestionNavProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="bg-white rounded-3xl shadow-lg p-6 border border-slate-200 shrink-0 relative">
      {availableBooks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4 pb-4 border-b border-slate-100">
          <button onClick={() => switchBookFilter('all')} className={`text-xs font-black px-3 py-1.5 rounded-lg border shadow-sm transition-colors ${bookFilter === 'all' ? 'bg-[#002864] border-[#002864] text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            전체 <span className="font-normal opacity-80">{questions.length}</span>
          </button>
          {availableBooks.map(b => (
            <button key={b.bookType} onClick={() => switchBookFilter(b.bookType as string)} className={`text-xs font-black px-3 py-1.5 rounded-lg border shadow-sm transition-colors ${bookFilter === b.bookType ? `${BOOK_TYPE_COLORS[b.bookType || '']?.pill || 'bg-slate-800 text-white border-slate-800'} ring-2 ring-offset-1 ring-[#002864]/30` : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
              {b.bookType} <span className="font-normal opacity-80">{b.count}</span>
            </button>
          ))}
        </div>
      )}
      <h3 className="font-bold text-slate-700 mb-4 text-center text-sm md:text-base">
        문항 이동{' '}
        <span className="text-slate-400 font-normal">
          {bookFilter === 'all' ? `(총 ${questions.length}문항)` : `(${visibleIndices.length}문항 · 전체 ${questions.length}문항 중)`}
        </span>
      </h3>
      <div className="flex items-center gap-2">
        <button onClick={() => scrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })} className="shrink-0 w-10 h-16 rounded-xl bg-slate-100 text-slate-500 font-bold text-2xl flex items-center justify-center hover:bg-slate-200">‹</button>
        <div ref={scrollRef} className="flex flex-nowrap gap-3 overflow-x-auto custom-scrollbar pb-2 scroll-smooth">
          {visibleIndices.map(i => {
            const status = qBoxStatus.current[i];
            const hasAnswer = studentAnswers.current[i] && studentAnswers.current[i] !== '미입력';

            const symbol = status === 'wrong_red' ? 'X' : (status === 'retry_yellow' || status === 'correct_yellow') ? '△' : status === 'correct_blue' ? 'O' : null;
            const statusPalette: Record<string, { light: string; solid: string }> = {
              wrong_red: { light: 'bg-rose-50 border-rose-300 text-rose-500', solid: 'bg-rose-600 border-rose-600 text-white' },
              correct_blue: { light: 'bg-blue-50 border-blue-300 text-blue-500', solid: 'bg-blue-600 border-blue-600 text-white' },
              correct_yellow: { light: 'bg-amber-50 border-amber-300 text-amber-500', solid: 'bg-amber-500 border-amber-500 text-white' },
              retry_yellow: { light: 'bg-amber-50 border-amber-300 text-amber-500', solid: 'bg-amber-500 border-amber-500 text-white' },
            };
            const isCalled = !!callState.current[i];
            const isCurrent = i === currentQIndex;
            
            let cls = '';
            if (isCalled) cls = isCurrent ? 'bg-red-600 border-red-600 text-white' : 'bg-red-100 border-red-300 text-red-700';
            else if (isCurrent) cls = status ? `${statusPalette[status].solid} ring-2 ring-offset-2 ring-[#002864]/50` : 'bg-[#002864] border-[#002864] text-white';
            else if (status) cls = statusPalette[status].light;
            else if (hasAnswer) cls = 'bg-slate-200 border-slate-300 text-slate-700';
            else cls = 'border-slate-200 text-slate-500 hover:bg-slate-50';

            return (
              <button key={i} onClick={() => { setCurrentQIndex(i); setCanvasClearTrigger(p=>p+1); }} className={`relative w-16 h-16 shrink-0 border-[3px] rounded-xl font-black text-2xl shadow-sm transition-colors flex items-center justify-center ${cls}`}>
                {!isCalled && symbol ? symbol : i + 1}
                {!isCalled && !status && hasAnswer && <span className="absolute top-1.5 right-1.5 w-3 h-3 rounded-full bg-emerald-500 shadow-sm border-2 border-white"></span>}
                {!isCalled && symbol && <span className={`absolute -bottom-1 -right-1 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${isCurrent ? 'bg-white/90 text-slate-700' : 'bg-white/80 text-slate-500 opacity-80'}`}>{i + 1}</span>}
              </button>
            );
          })}
        </div>
        <button onClick={() => scrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })} className="shrink-0 w-10 h-16 rounded-xl bg-slate-100 text-slate-500 font-bold text-2xl flex items-center justify-center hover:bg-slate-200">›</button>
      </div>
      {isTimedRound && (
        <button onClick={() => setSubmitConfirmModal(true)} disabled={timeIsUp} className="w-full mt-5 bg-slate-800 hover:bg-slate-900 text-white font-bold py-4 rounded-xl shadow-sm transition-colors text-lg disabled:opacity-40 disabled:cursor-not-allowed">
          📮 전체 제출하기
        </button>
      )}
    </div>
  );
}