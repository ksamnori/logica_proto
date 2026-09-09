// src/app/clinic/ta/pad/page.tsx
"use client";

import React, { useEffect, useRef } from "react";
import { useTaHandheld, formatSeat } from "./useTaHandheld";
import SeatCanvas from "@/app/clinic/_shared/SeatCanvas";
import { DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, DEFAULT_SEAT_CARD_W, DEFAULT_SEAT_CARD_H } from "@/lib/clinicSeatLayout";
import TaTopBar from "../TaTopBar";

let mathJaxInitStarted = false;

const initMathJax = () => {
  if (typeof window === 'undefined' || mathJaxInitStarted || document.getElementById('mathjax-script')) return;
  mathJaxInitStarted = true;
  (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] }, chtml: { displayAlign: 'left' } };
  const script = document.createElement('script');
  script.id = 'mathjax-script';
  script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
  script.async = true;
  document.head.appendChild(script);
};

const MathText = React.memo(function MathText({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise && ref.current) {
      mj.typesetPromise([ref.current]).catch((err: any) => console.error("MathJax 에러:", err));
    }
  }, [html]);
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

export default function TaHandheldDashboard() {
  const {
    taName, taClientId, isConnected, gridSnapshot, callsSnapshot, rechecksSnapshot,
    claimedByOthers,
    selectedCallKey, setSelectedCallKey, markState, setMarkState,
    handleConfirmCall, handleConfirmRecheck, formatElapsed, updateHandlingPresence,
    allSeats, allSeatObjs, canvasWidth, canvasHeight, seatWidth, seatHeight, editorLocked,
  } = useTaHandheld();

  useEffect(() => { initMathJax(); }, []);

  const seatFontSize = 60;

  const currentCall = selectedCallKey ? callsSnapshot[selectedCallKey] : null;
  const currentRecheck = selectedCallKey ? rechecksSnapshot[selectedCallKey] : null;

  const recheckSeatSet = new Set(Object.values(rechecksSnapshot).map(r => r.seat));

  type Req = { key: string; type: 'call' | 'recheck'; seat: string; name: string; classes: string[]; time: number; qNum?: number; initial?: boolean };
  const requestList: Req[] = [
    ...Object.values(callsSnapshot).map(c => ({ key: `${c.seat}::${c.qNum}`, type: 'call' as const, seat: c.seat, name: c.name, classes: c.classes, time: c.calledAt, qNum: c.qNum })),
    ...Object.values(rechecksSnapshot).map(r => ({ key: `${r.seat}::${r.uid}`, type: 'recheck' as const, seat: r.seat, name: r.name, classes: r.classes, time: r.requestedAt, initial: r.initial })),
  ].sort((a, b) => a.time - b.time);

  return (
    <div className="h-screen bg-slate-100 flex flex-col overflow-hidden font-pretendard select-none">
      {editorLocked && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[999] flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-sm">
            <div className="text-4xl mb-3">🔒</div>
            <h3 className="text-lg font-extrabold text-slate-800 mb-2">좌석 배치 수정 중입니다</h3>
            <p className="text-sm text-slate-500">관리자가 좌석 배치를 편집하는 동안에는<br />클리닉 기능이 잠시 멈춥니다. 잠시만 기다려주세요.</p>
          </div>
        </div>
      )}
      <style dangerouslySetInnerHTML={{__html:`
        @keyframes pulse-red { 0%,100%{ box-shadow:0 0 0 2px rgba(220,38,38,.25);} 50%{ box-shadow:0 0 0 4px rgba(220,38,38,.12);} }
        .seat-call{ background:#dc2626; box-shadow:0 0 0 2px rgba(220,38,38,.25); animation:pulse-red 1.4s infinite; }
        @keyframes pulse-blue { 0%,100%{ box-shadow:0 0 0 2px rgba(37,99,235,.25);} 50%{ box-shadow:0 0 0 4px rgba(37,99,235,.12);} }
        .seat-recheck{ background:#2563eb; box-shadow:0 0 0 2px rgba(37,99,235,.25); animation:pulse-blue 1.4s infinite; }
        @keyframes flash-yellow { 0%,100%{background:white;} 50%{background:#fef9c3; border-color:#eab308;} }
        .hint-flash{ animation:flash-yellow 1.5s ease-in-out infinite; }
        .custom-scrollbar::-webkit-scrollbar { width:5px; } .custom-scrollbar::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:10px; }
      `}}/>

      <TaTopBar taName={taName} isConnected={isConnected} hasActiveRequest={!!selectedCallKey} />

      <div className="max-w-[2200px] mx-auto px-4 pt-4 space-y-3 flex-1 flex flex-col pb-6 min-h-0 overflow-hidden w-full">

        {/* 💡 [핵심 수정] 상단 영역 높이를 h-[32%] ~ h-[35%]로 줄여 하단 문제 영역이 화면의 65% 이상을 차지하도록 끌어올렸습니다. */}
        {/* 💡 세로 뷰(모바일/태블릿 세로)를 고려해 우측 리스트 폭을 280px로 유연하게 조정했습니다. */}
        <div className="max-w-[1400px] w-full grid grid-cols-[1fr_280px] md:grid-cols-[1fr_350px] gap-3 md:gap-4 items-stretch min-h-0 shrink-0 h-[32%] md:h-[35%]">

          {/* 좌석 현황 패널 */}
          <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 flex flex-col min-h-0 h-full">
            <div className="flex items-center justify-between mb-2 md:mb-3 shrink-0">
              <h2 className="text-[13px] font-bold text-slate-700">좌석 현황</h2>
            </div>
            
            <div className="flex flex-1 min-h-0 gap-3 md:gap-5 items-stretch">
              <div className="flex flex-col gap-2 md:gap-3 text-[10px] md:text-[11px] font-semibold text-slate-500 shrink-0 border-r border-slate-100 pr-3 md:pr-5 py-1 md:py-2">
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-red-600 shadow-sm"></span>호출</span>
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-blue-600 shadow-sm"></span>재확인 요청</span>
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-[#002864] shadow-sm"></span>착석</span>
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-slate-200 border border-slate-300"></span>공석</span>
              </div>

              <div className="flex-1 relative min-w-0 min-h-0 bg-slate-50/50 border border-slate-100 rounded-xl overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center p-2">
                  <div className="w-full h-full max-w-full max-h-full flex items-center justify-center" style={{ aspectRatio: `${canvasWidth || DEFAULT_CANVAS_W} / ${canvasHeight || DEFAULT_CANVAS_H}` }}>
                    <SeatCanvas
                      seats={allSeatObjs}
                      canvasWidth={canvasWidth || DEFAULT_CANVAS_W}
                      canvasHeight={canvasHeight || DEFAULT_CANVAS_H}
                      renderSeat={(seatObj, scale) => {
                        const seat = String(seatObj.number);
                        const st = gridSnapshot[seat];
                        const isCall = Object.keys(st?.calls || {}).length > 0;
                        const isRecheck = recheckSeatSet.has(seat);
                        const GAP = 10;
                        const renderW = Math.max(20, (seatWidth || DEFAULT_SEAT_CARD_W) - GAP);
                        const renderH = Math.max(20, (seatHeight || DEFAULT_SEAT_CARD_H) - GAP);
                        const tokenStyle = { width: renderW, height: renderH, borderRadius: 20, fontSize: seatFontSize, transform: `scale(${scale})`, transformOrigin: 'center' } as const;

                        if (!st) return <div style={tokenStyle} className="flex items-center justify-center font-bold transition-all bg-[#e2e8f0] text-[#94a3b8] shadow-sm">{formatSeat(seat)}</div>;

                        return (
                          <div style={tokenStyle} className={`flex items-center justify-center font-bold text-white transition-all shadow-sm ${isCall ? 'seat-call' : isRecheck ? 'seat-recheck' : st.status === 'hint' ? 'hint-flash text-yellow-900 border border-slate-200' : st.status === 'submitted' ? 'bg-blue-500' : 'bg-[#002864]'}`} title={st.name}>
                            {formatSeat(seat)}
                          </div>
                        );
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 호출 + 재확인 요청 리스트 패널 */}
          <div className="bg-white rounded-2xl shadow-sm p-3 md:p-4 flex flex-col min-h-0 h-full">
            <h2 className="text-[13px] font-bold text-slate-700 mb-2 md:mb-3 shrink-0 flex items-center justify-between">
              전체 요청 목록 
            </h2>
            <div className="custom-scrollbar flex flex-col gap-2 overflow-y-auto pr-1 flex-1">
              {requestList.length === 0 ? <p className="text-[12px] text-slate-400 text-center py-8">대기 중인 요청이 없습니다.</p> :
                requestList.map((req, i) => {
                  const claimedName = claimedByOthers[req.key];
                  const isSelected = selectedCallKey === req.key;
                  const isRecheck = req.type === 'recheck';
                  return (
                    <div key={req.key} onClick={() => { if(!claimedName) { setSelectedCallKey(req.key); updateHandlingPresence(req.key); } }} className={`border rounded-xl p-2.5 transition-all flex items-center justify-between gap-2 ${claimedName ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed' : isSelected ? (isRecheck ? 'border-blue-500 bg-blue-50 cursor-pointer shadow-sm' : 'border-red-500 bg-red-50 cursor-pointer shadow-sm') : i===0 ? 'border-amber-400 bg-white cursor-pointer hover:shadow-md' : 'bg-white border-slate-200 cursor-pointer hover:border-[#002864]'}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5"><span className="text-[12px] font-extrabold text-slate-700 truncate">{req.name}</span></div>
                        <div className="text-[10px] text-slate-400 font-bold mt-0.5">{req.classes?.[0] || '반없음'} · {formatSeat(req.seat)}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!claimedName && <span className={`text-[10px] font-bold ${isRecheck ? 'text-blue-500' : 'text-red-500'}`}>{formatElapsed(req.time)}</span>}
                        {claimedName ? <span className="text-[10px] font-bold px-2 py-1 rounded bg-slate-200 text-slate-500">🔒 {claimedName}</span> : isRecheck ? (req.initial ? <span className="text-[10px] font-black px-2 py-1 rounded shadow-sm border border-amber-600 bg-amber-500 text-white">1차채점</span> : <span className="text-[10px] font-black px-2 py-1 rounded shadow-sm border border-blue-700 bg-blue-600 text-white">재확인</span>) : <span className="text-[10px] font-black px-2 py-1 rounded shadow-sm bg-[#002864] border border-blue-900 text-white">{req.qNum}번</span>}
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        </div>

        {/* 3. 문제 표시 영역 (💡 상단 높이를 줄여 이 부분이 화면을 더 넓게 쓰도록 자동 계산됨) */}
        <div className="bg-white rounded-2xl shadow-sm p-5 md:p-6 border-l-4 border-[#002864] flex-1 flex flex-col min-h-0">
          <h2 className="text-sm font-bold text-slate-700 mb-3 shrink-0">문제 상세</h2>
          <div className="text-[19px] text-slate-600 leading-relaxed overflow-y-auto custom-scrollbar flex-1 pr-2" id="problemArea">
            {!currentCall && !currentRecheck ? <div className="h-full flex items-center justify-center text-slate-400 text-base font-medium">위 목록에서 학생을 선택하면 문제가 여기에 표시됩니다.</div> : currentRecheck ? (
              <div className="w-full">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
                  <span className="text-base font-extrabold text-blue-700">{currentRecheck.name} <span className="text-sm text-slate-400 font-bold ml-1">· {formatSeat(currentRecheck.seat)}</span></span>
                  <span className={`text-xs font-black px-2.5 py-1 rounded text-white shadow-sm ${currentRecheck.initial ? 'bg-amber-500 border border-amber-600' : 'bg-blue-600 border border-blue-700'}`}>{currentRecheck.qNum}번 · {currentRecheck.initial ? '조교 채점 대기' : '재확인 요청'}</span>
                </div>
                <MathText className="text-[20px] text-slate-800 font-myungjo font-semibold leading-[2.0] break-keep" html={currentRecheck.questionText} />
                <div className="mt-6 pt-4 border-t-2 border-dashed border-slate-200 flex items-start gap-3">
                  <span className="text-xs font-black px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 shrink-0 mt-0.5">정답</span>
                  <span className="text-lg font-black text-emerald-700">{currentRecheck.correctAnswer || '정보 없음'}</span>
                </div>
                <div className="mt-5 pt-4 border-t-2 border-dashed border-slate-200">
                  <span className="text-xs font-black px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-600 shrink-0">학생 입력 답안</span>
                  {currentRecheck.imageDataUrl ? (
                    <img src={currentRecheck.imageDataUrl} className="max-w-[720px] w-full rounded-xl border-2 border-slate-200 mt-3 bg-white shadow-sm" />
                  ) : (
                    <p className="text-sm text-slate-400 font-medium mt-3">입력된 이미지가 없습니다.</p>
                  )}
                </div>
                {currentRecheck.recognizedText && (
                  <div className="mt-5 pt-4 border-t-2 border-dashed border-slate-200">
                    <span className="text-xs font-black px-2 py-1 rounded border border-slate-300 bg-slate-100 text-slate-600">AI 인식 결과</span>
                    <p className="text-base text-slate-600 font-medium leading-relaxed mt-2.5 bg-slate-50 p-4 rounded-xl border border-slate-100">{currentRecheck.recognizedText}</p>
                  </div>
                )}
              </div>
            ) : currentCall ? (
              <div className="w-full">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
                  <span className="text-base font-extrabold text-[#002864]">{currentCall.name} <span className="text-sm text-slate-400 font-bold ml-1">· {formatSeat(currentCall.seat)}</span></span>
                  <span className="text-xs font-black px-2.5 py-1 rounded bg-[#002864] border border-blue-900 shadow-sm text-white">{currentCall.qNum}번 문항{currentCall.source ? ' · '+currentCall.source : ''}</span>
                </div>
                <MathText className="text-[20px] text-slate-800 font-myungjo font-semibold leading-[2.0] break-keep" html={currentCall.questionText} />
                {currentCall.options && <div className="mt-5 flex flex-col gap-2">{currentCall.options.map((opt, i) => <div key={i} className="text-[17px] text-slate-700 font-medium flex gap-2 bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-100"><span className="font-black text-indigo-400 shrink-0">{i + 1}.</span><span>{opt}</span></div>)}</div>}
                {currentCall.imageUrl && <img src={currentCall.imageUrl} className="max-w-[720px] w-full rounded-xl border-2 border-slate-200 mt-4 shadow-sm" />}
                <div className="mt-6 pt-4 border-t-2 border-dashed border-slate-200 flex items-start gap-3">
                  <span className="text-xs font-black px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 shrink-0 mt-0.5">정답</span>
                  <span className="text-lg font-black text-emerald-700">{currentCall.answer || '정보 없음'}</span>
                </div>
                {currentCall.explanation && (
                  <div className="mt-5 pt-4 border-t-2 border-dashed border-slate-200">
                    <span className="text-xs font-black px-2 py-1 rounded border border-slate-300 bg-slate-100 text-slate-600">해설</span>
                    <p className="text-base text-slate-600 font-medium leading-relaxed mt-2.5 bg-slate-50 p-4 rounded-xl border border-slate-100">{currentCall.explanation}</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* 4. 처리 상태 컨트롤 */}
        {currentRecheck ? (
          <div className="bg-white rounded-2xl shadow-sm px-6 py-4 flex items-center gap-4 shrink-0 border border-slate-200">
            <h2 className="text-sm font-black text-slate-700 shrink-0">{currentRecheck.initial ? '조교 채점' : '재확인 처리'}</h2>
            <div className="ml-auto flex items-center gap-3">
              <button onClick={() => handleConfirmRecheck('incorrect')} className="bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-600 border-2 border-rose-300 text-sm font-bold px-6 py-3 rounded-xl transition-colors shadow-sm">❌ 오답 처리</button>
              <button onClick={() => handleConfirmRecheck('correct')} className="bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-700 border-2 border-emerald-300 text-sm font-bold px-6 py-3 rounded-xl transition-colors shadow-sm">⭕ 정답 처리</button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm px-6 py-4 flex items-center gap-4 shrink-0 border border-slate-200">
            <h2 className="text-sm font-black text-slate-700 shrink-0">상태</h2>
            <div className="flex items-center gap-3">
              <button onClick={() => setMarkState(p => ({...p, [selectedCallKey!]: p[selectedCallKey!] === 'hint' ? null : 'hint'}))} disabled={!selectedCallKey} className={`min-w-[44px] h-[44px] px-3.5 rounded-xl flex items-center justify-center font-black text-[13px] border-2 transition-colors disabled:opacity-30 shadow-sm ${markState[selectedCallKey!] === 'hint' ? 'bg-amber-100 border-amber-500 text-amber-700' : 'bg-white border-slate-300 text-slate-500 hover:border-amber-300'}`}>힌트</button>
              <button onClick={() => setMarkState(p => ({...p, [selectedCallKey!]: p[selectedCallKey!] === 'skip' ? null : 'skip'}))} disabled={!selectedCallKey} className={`min-w-[44px] h-[44px] px-3.5 rounded-xl flex items-center justify-center font-black text-[13px] border-2 transition-colors disabled:opacity-30 shadow-sm ${markState[selectedCallKey!] === 'skip' ? 'bg-slate-200 border-slate-400 text-slate-700' : 'bg-white border-slate-300 text-slate-500 hover:border-slate-400'}`}>넘기기</button>
            </div>
            <button onClick={handleConfirmCall} disabled={!selectedCallKey || !markState[selectedCallKey!]} className="ml-auto bg-[#002864] hover:bg-blue-900 active:bg-slate-900 text-white text-sm font-bold px-8 py-3 rounded-xl transition-colors disabled:opacity-30 shadow-md">
              확인 및 종료
            </button>
          </div>
        )}
      </div>
    </div>
  );
}