// src/app/clinic/ta/pad/page.tsx
"use client";

import React, { useEffect, useRef } from "react";
import { useTaHandheld, formatSeat } from "./useTaHandheld";
import SeatCanvas from "@/app/clinic/_shared/SeatCanvas";
import { DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, DEFAULT_SEAT_CARD_W, DEFAULT_SEAT_CARD_H } from "@/lib/clinicSeatLayout";

// 💡 config는 반드시 본체 스크립트가 실행되기 "전"에 window.MathJax에 있어야 한다 — MathJax는 로드되는
// 시점에 이 값을 읽어 typesetPromise 등 API를 구성한다. 예전엔 next/script의 onLoad(=본체 스크립트가
// 이미 실행되어 API가 다 붙은 뒤)에서 window.MathJax를 덮어써서 그 API가 통째로 날아가는 문제가 있었다.
// clinic/viewer/page.tsx와 동일하게, config를 먼저 심고 그 다음에 스크립트 태그를 만들어 붙인다.
let mathJaxInitStarted = false;

const initMathJax = () => {
  if (typeof window === 'undefined' || mathJaxInitStarted || document.getElementById('mathjax-script')) return;
  mathJaxInitStarted = true;
  (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]] }, chtml: { displayAlign: 'left' } };
  const script = document.createElement('script');
  script.id = 'mathjax-script';
  script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
  script.async = true;
  document.head.appendChild(script);
};

// 💡 useTaHandheld의 flushState()는 좌석 현황이 바뀔 때마다(잦음) callsSnapshot/rechecksSnapshot을
// 통째로 JSON.parse(JSON.stringify(...))로 다시 만들어서, 실제 내용이 같아도 매번 새 객체 참조가 된다.
// 그래서 currentCall/currentRecheck 객체 자체를 React.memo props로 넘기면 항상 "바뀐 것"으로 취급돼
// 매번 리렌더되며 MathJax가 그린 수식이 원본 텍스트로 되돌아간다. questionText는 문자열(원시값)이라
// 내용이 같으면 값 비교로 "안 바뀜"을 정확히 판별할 수 있으므로, 이 부분만 별도 컴포넌트로 분리한다.
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
    myAssignedSeats, assignmentMap, claimedByOthers,
    selectedCallKey, setSelectedCallKey, markState, setMarkState,
    nameModalOpen, setNameModalOpen,
    isFirstTime, setIsFirstTime, tempNameInput, setTempNameInput,
    exitModalOpen, setExitModalOpen,
    commitTaName, handleConfirmCall, handleConfirmRecheck, handleExit, formatElapsed, updateHandlingPresence,
    allSeats, allSeatObjs, canvasWidth, canvasHeight, seatWidth, seatHeight, editorLocked,
  } = useTaHandheld();

  useEffect(() => { initMathJax(); }, []);

  const seatFontSize = 60;

  const currentCall = selectedCallKey ? callsSnapshot[selectedCallKey] : null;
  const currentRecheck = selectedCallKey ? rechecksSnapshot[selectedCallKey] : null;

  // 좌석별 재확인 요청 존재 여부 (좌석 색상용)
  const recheckSeatSet = new Set(Object.values(rechecksSnapshot).map(r => r.seat));

  // 호출 + 재확인 요청을 하나의 목록으로 합쳐서 시간순으로 보여줌
  type Req = { key: string; type: 'call' | 'recheck'; seat: string; name: string; classes: string[]; time: number; qNum?: number };
  const requestList: Req[] = [
    ...Object.values(callsSnapshot).map(c => ({ key: `${c.seat}::${c.qNum}`, type: 'call' as const, seat: c.seat, name: c.name, classes: c.classes, time: c.calledAt, qNum: c.qNum })),
    ...Object.values(rechecksSnapshot).map(r => ({ key: `${r.seat}::${r.uid}`, type: 'recheck' as const, seat: r.seat, name: r.name, classes: r.classes, time: r.requestedAt })),
  ].filter(req => selectedCallKey === req.key || assignmentMap[req.seat] === taClientId || assignmentMap[req.seat] === undefined)
   .sort((a, b) => a.time - b.time);

  // 💡 [버그 수정] 예전엔 시스템 전체(callsSnapshot/rechecksSnapshot 전부)의 미처리 건수로
  // "근무 종료" 버튼을 막아서, 내 담당이 아닌 — 다른 조교에게 배정된 — 호출이 남아있다는 이유로
  // 정작 내 몫은 다 끝낸 조교(알바)가 퇴근을 못 누르는 상황이 생겼다. requestList는 이미
  // "나에게 보이는(내 담당 + 미배정)" 요청만 걸러둔 목록이므로 그 길이를 대신 쓴다.
  const unresolvedCount = requestList.length;

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

      {/* 헤더 */}
      <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div>
          <h1 className="font-lexend text-base font-bold text-[#002864] tracking-tight leading-none">Logica Clinic</h1>
          <p className="text-[10px] text-slate-400 font-medium">조교 전용 · <span onClick={() => { setTempNameInput(taName); setIsFirstTime(false); setNameModalOpen(true); }} className="cursor-pointer underline decoration-dotted hover:text-slate-600 transition-colors" title="이름 변경">{taName || '이름 설정'}</span> 조교님</p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
          <span className={`w-2 h-2 rounded-full inline-block ${isConnected ? 'bg-green-500 animate-[pulse_1.6s_infinite]' : 'bg-rose-500'}`}></span>
          <span>{isConnected ? '연결됨' : '연결 중...'}</span>
        </div>
      </div>

      {/* 💡 2560×1600급 데스크톱 모니터를 기준으로 잡되, 좌석/호출 패널은 그 너비대로 같이 커지지 않도록
          이 줄만 별도로 max-w를 좁게 잡는다 — 그 아래 "문제 상세" 영역은 이 컨테이너의 전체 너비를 그대로
          쓰게 해서, 넓어진 화면 공간이 전부 문제를 크게 보여주는 데 쓰이도록 한다. */}
      <div className="max-w-[2200px] mx-auto px-3 pt-3 space-y-2.5 flex-1 flex flex-col pb-6 min-h-0 overflow-hidden w-full">

        {/* 1+2. 좌석 현황 + 호출 요청 — 문제 상세와 달리 폭을 넓히지 않고 적당한 크기로 고정 */}
        <div className="max-w-[900px] w-full grid grid-cols-[300px_1fr] gap-2.5 items-stretch min-h-0 shrink-0">

          {/* 좌석 현황 패널 */}
          <div className="bg-white rounded-2xl shadow-sm p-2.5 flex flex-col">
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="text-[11px] font-bold text-slate-700">좌석 현황</h2>
            </div>
            <div className="w-full mb-2" style={{ aspectRatio: `${canvasWidth || DEFAULT_CANVAS_W} / ${canvasHeight || DEFAULT_CANVAS_H}` }}>
              <SeatCanvas
                seats={allSeatObjs}
                canvasWidth={canvasWidth || DEFAULT_CANVAS_W}
                canvasHeight={canvasHeight || DEFAULT_CANVAS_H}
                renderSeat={(seatObj, scale) => {
                  const seat = String(seatObj.number);
                  const st = gridSnapshot[seat];
                  const isCall = Object.keys(st?.calls || {}).length > 0;
                  const isRecheck = recheckSeatSet.has(seat);
                  const isMine = myAssignedSeats.has(seat);
                  // 💡 칸 사이에 실제 여백(GAP)을 두고, 스케일이 많이 축소돼도 둥근 모서리가
                  // 눈에 보이도록 반지름을 넉넉히 줘야 한다 — 스케일 전 좌표에 4px짜리
                  // border-radius를 주면 축소 후엔 1px도 안 남아 그냥 각진 사각형처럼 보인다.
                  const GAP = 10;
                  const renderW = Math.max(20, (seatWidth || DEFAULT_SEAT_CARD_W) - GAP);
                  const renderH = Math.max(20, (seatHeight || DEFAULT_SEAT_CARD_H) - GAP);
                  const tokenStyle = { width: renderW, height: renderH, borderRadius: 20, fontSize: seatFontSize, transform: `scale(${scale})`, transformOrigin: 'center' } as const;

                  if (!st) return <div style={tokenStyle} className="flex items-center justify-center font-bold transition-all bg-[#e2e8f0] text-[#94a3b8]">{formatSeat(seat)}</div>;

                  return (
                    <div style={tokenStyle} className={`flex items-center justify-center font-bold text-white transition-all shadow-sm ${isCall ? 'seat-call' : isRecheck ? 'seat-recheck' : st.status === 'hint' ? 'hint-flash text-yellow-900 border border-slate-200' : st.status === 'submitted' ? 'bg-blue-500' : 'bg-[#002864]'} ${isMine ? 'outline outline-2 outline-amber-500 outline-offset-1' : ''}`} title={st.name}>
                      {formatSeat(seat)}
                    </div>
                  );
                }}
              />
            </div>
            <div className="flex flex-col gap-1 text-[8px] font-semibold text-slate-400 mt-auto">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-600"></span>호출</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-600"></span>재확인 요청</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-[#002864]"></span>착석</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-slate-200"></span>공석</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-slate-200 outline outline-2 outline-amber-500 outline-offset-1"></span>내 담당</span>
            </div>
          </div>

          {/* 호출 + 재확인 요청 리스트 패널 */}
          <div className="bg-white rounded-2xl shadow-sm p-2.5 flex flex-col min-h-0">
            <h2 className="text-[11px] font-bold text-slate-700 mb-1.5 shrink-0">요청 목록 <span className="text-slate-400 font-medium">· 내 담당 {myAssignedSeats.size}명</span></h2>
            <div className="custom-scrollbar flex flex-col gap-1.5 overflow-y-auto pr-1 flex-1">
              {requestList.length === 0 ? <p className="text-[11px] text-slate-300 text-center py-6">대기 중인 요청이 없습니다.</p> :
                requestList.map((req, i) => {
                  const claimedName = claimedByOthers[req.key];
                  const isSelected = selectedCallKey === req.key;
                  const isRecheck = req.type === 'recheck';
                  return (
                    <div key={req.key} onClick={() => { if(!claimedName) { setSelectedCallKey(req.key); updateHandlingPresence(req.key); } }} className={`border border-slate-200 rounded-lg p-2 transition-all flex items-center justify-between gap-2 ${claimedName ? 'bg-slate-50 opacity-60 cursor-not-allowed' : isSelected ? (isRecheck ? 'border-blue-500 bg-blue-50 cursor-pointer' : 'border-red-500 bg-red-50 cursor-pointer') : i===0 ? 'border-amber-500 bg-white cursor-pointer hover:shadow-md' : 'bg-white cursor-pointer hover:border-[#002864]'}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5"><span className="text-[11px] font-bold text-slate-700 truncate">{req.name}</span><span className="text-[9px] text-slate-400 font-medium">{req.classes?.[0] || '반없음'} · {formatSeat(req.seat)}</span></div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {!claimedName && <span className={`text-[9px] font-semibold ${isRecheck ? 'text-blue-500' : 'text-red-500'}`}>{formatElapsed(req.time)}</span>}
                        {claimedName ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500">🔒 {claimedName}</span> : isRecheck ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-600 text-white">재확인</span> : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#002864] text-white">{req.qNum}번</span>}
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        </div>

        {/* 3. 문제 표시 영역 */}
        <div className="bg-white rounded-2xl shadow-sm p-5 border-l-4 border-[#002864] flex-1 flex flex-col min-h-0">
          <h2 className="text-sm font-bold text-slate-700 mb-2 shrink-0">문제 상세</h2>
          <div className="text-[19px] text-slate-600 leading-relaxed overflow-y-auto custom-scrollbar flex-1" id="problemArea">
            {!currentCall && !currentRecheck ? <div className="h-full flex items-center text-slate-400 text-base">왼쪽 목록에서 학생을 선택하면 문제가 여기에 표시됩니다.</div> : currentRecheck ? (
              <div className="w-full">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-blue-600">{currentRecheck.name} · {formatSeat(currentRecheck.seat)}</span>
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-blue-600 text-white">{currentRecheck.qNum}번 · 재확인 요청</span>
                </div>
                <MathText className="text-[19px] text-slate-800 font-myungjo font-semibold leading-[2.0] break-keep" html={currentRecheck.questionText} />
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-start gap-2">
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0 mt-0.5">정답</span>
                  <span className="text-base font-bold text-emerald-700">{currentRecheck.correctAnswer || '정보 없음'}</span>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 shrink-0">학생 입력 답안</span>
                  {currentRecheck.imageDataUrl ? (
                    <img src={currentRecheck.imageDataUrl} className="max-w-[720px] w-full rounded-lg border-2 border-slate-200 mt-2 bg-white" />
                  ) : (
                    <p className="text-sm text-slate-400 mt-2">입력된 이미지가 없습니다.</p>
                  )}
                </div>
                {currentRecheck.recognizedText && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">AI 인식 결과</span>
                    <p className="text-sm text-slate-500 leading-relaxed mt-1.5">{currentRecheck.recognizedText}</p>
                  </div>
                )}
              </div>
            ) : currentCall ? (
              <div className="w-full">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-[#002864]">{currentCall.name} · {formatSeat(currentCall.seat)}</span>
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-[#002864] text-white">{currentCall.qNum}번 문항{currentCall.source ? ' · '+currentCall.source : ''}</span>
                </div>
                <MathText className="text-[19px] text-slate-800 font-myungjo font-semibold leading-[2.0] break-keep" html={currentCall.questionText} />
                {currentCall.options && <div className="mt-3 flex flex-col gap-1.5">{currentCall.options.map((opt, i) => <div key={i} className="text-base text-slate-600 flex gap-2"><span className="font-bold text-slate-400 shrink-0">{i + 1}.</span><span>{opt}</span></div>)}</div>}
                {currentCall.imageUrl && <img src={currentCall.imageUrl} className="max-w-[720px] w-full rounded-lg border border-slate-200 mt-3" />}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-start gap-2">
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0 mt-0.5">정답</span>
                  <span className="text-base font-bold text-emerald-700">{currentCall.answer || '정보 없음'}</span>
                </div>
                {currentCall.explanation && (
                  <div className="mt-2 pt-3 border-t border-slate-100">
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">해설</span>
                    <p className="text-sm text-slate-500 leading-relaxed mt-1.5">{currentCall.explanation}</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* 4. 처리 상태 컨트롤 */}
        {currentRecheck ? (
          <div className="bg-white rounded-2xl shadow-sm px-4 py-2.5 flex items-center gap-3 shrink-0">
            <h2 className="text-xs font-bold text-slate-700 shrink-0">재확인 처리</h2>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => handleConfirmRecheck('incorrect')} className="bg-rose-50 hover:bg-rose-100 text-rose-600 border-2 border-rose-300 text-xs font-bold px-4 py-2.5 rounded-xl transition-colors shadow-sm">❌ 오답 처리</button>
              <button onClick={() => handleConfirmRecheck('correct')} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border-2 border-emerald-300 text-xs font-bold px-4 py-2.5 rounded-xl transition-colors shadow-sm">⭕ 정답 처리</button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm px-4 py-2.5 flex items-center gap-3 shrink-0">
            <h2 className="text-xs font-bold text-slate-700 shrink-0">상태</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => setMarkState(p => ({...p, [selectedCallKey!]: p[selectedCallKey!] === 'hint' ? null : 'hint'}))} disabled={!selectedCallKey} className={`min-w-[36px] h-[36px] px-2.5 rounded-lg flex items-center justify-center font-bold text-[12px] border-2 transition-colors disabled:opacity-30 ${markState[selectedCallKey!] === 'hint' ? 'bg-amber-100 border-amber-500 text-amber-700' : 'bg-white border-slate-200 text-slate-400'}`}>힌트</button>
              <button onClick={() => setMarkState(p => ({...p, [selectedCallKey!]: p[selectedCallKey!] === 'skip' ? null : 'skip'}))} disabled={!selectedCallKey} className={`min-w-[36px] h-[36px] px-2.5 rounded-lg flex items-center justify-center font-bold text-[12px] border-2 transition-colors disabled:opacity-30 ${markState[selectedCallKey!] === 'skip' ? 'bg-slate-200 border-slate-400 text-slate-700' : 'bg-white border-slate-200 text-slate-400'}`}>넘기기</button>
            </div>
            <button onClick={handleConfirmCall} disabled={!selectedCallKey || !markState[selectedCallKey!]} className="ml-auto bg-[#002864] hover:bg-blue-900 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-30 shadow-sm">
              확인 및 종료
            </button>
          </div>
        )}

        {/* 5. 퇴근 */}
        <button onClick={() => setExitModalOpen(true)} className="w-full bg-white border border-rose-200 text-rose-500 font-bold py-3 rounded-2xl text-xs hover:bg-rose-50 transition-colors shrink-0 shadow-sm">
          조교 근무 종료
        </button>
      </div>

      {/* 모달 1: 이름 입력 */}
      {nameModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs text-center shadow-2xl animate-[fadeIn_0.2s_ease-out]">
            <p className="text-sm font-semibold text-slate-700 mb-4">{isFirstTime ? '조교님 성함을 입력해주세요' : '이름을 변경합니다'}</p>
            <input type="text" value={tempNameInput} onChange={e => setTempNameInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && commitTaName()} placeholder="이름 입력" maxLength={10} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-center font-semibold text-slate-700 focus:outline-none focus:border-[#002864] mb-4 bg-slate-50" />
            <div className="flex gap-2">
              {!isFirstTime && <button onClick={() => setNameModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-semibold hover:bg-slate-50 transition-colors">취소</button>}
              <button onClick={commitTaName} className="flex-1 py-2.5 rounded-xl bg-[#002864] text-white text-sm font-semibold shadow-md hover:bg-blue-900 transition-colors">확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 모달 2: 퇴근 확인 */}
      {exitModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs text-center shadow-2xl animate-[fadeIn_0.2s_ease-out]">
            <p className="text-sm font-semibold text-slate-700 mb-4">{unresolvedCount > 0 ? '아직 처리하지 않은 호출이 있습니다. 모두 처리 후 종료할 수 있습니다.' : '정말 근무를 종료하시겠습니까?'}</p>
            <div className="flex gap-2">
              <button onClick={() => setExitModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-semibold hover:bg-slate-50 transition-colors">취소</button>
              <button onClick={handleExit} disabled={unresolvedCount > 0} className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-semibold shadow-md hover:bg-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">종료</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}