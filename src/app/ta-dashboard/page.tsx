// src/app/ta-dashboard/page.tsx
"use client";

import React from "react";
import { useTAClinic, SEATS } from "./useTAClinic"; // 경로를 맞게 설정해주세요

export default function TACinicDashboard() {
  // 분리한 커스텀 훅에서 필요한 데이터와 함수만 쏙 빼서 사용합니다.
  const {
    isConnected, taCount, taNames, studentCount, vacantCount, gridSnapshot, logs,
    recheckModal, setRecheckModal, draggedSeat, dropTarget,
    executeTaAction, resolveRecheck, handleDragStart, handleDragOver, handleDragLeave, handleDrop
  } = useTAClinic();

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50 font-pretendard">
      <style dangerouslySetInnerHTML={{__html:`
        @keyframes pulse-red {
            0%, 100% { border-color: #ef4444; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
            50% { border-color: #fca5a5; box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
        }
        .status-help { animation: pulse-red 1.2s infinite; background-color: #fef2f2; border: 2px solid #ef4444; }
        @keyframes flash-yellow {
            0%, 100% { background-color: white; }
            50% { background-color: #fef9c3; border-color: #eab308; }
        }
        .hint-flash { animation: flash-yellow 1.5s ease-in-out infinite; }
        @keyframes blink-dot { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
        .dot-live { animation: blink-dot 1.6s ease-in-out infinite; }
        .custom-scrollbar::-webkit-scrollbar { width: 7px; height: 7px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}}/>

      {/* 헤더 */}
      <header className="bg-gradient-to-r from-[#002864] to-[#013a8f] text-white px-6 py-3.5 flex justify-between items-center shadow-md z-20 shrink-0 border-b border-white/10">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Logica Clinic <span className="text-blue-300 font-medium mx-1">-</span> 조교 대시보드 (6x10)</h1>
          <p className="text-[11px] text-blue-300/80 mt-0.5 tracking-wide">Supabase Realtime 기반 온라인 동기화</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isConnected ? 'bg-green-500 dot-live' : 'bg-rose-500'}`} title="실시간 연결 상태"></span>
          <div className="flex items-center gap-1.5 bg-white/[0.07] border border-white/10 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm" title={taNames.join(", ")}>
            <span className="w-2 h-2 rounded-full bg-red-400 inline-block shrink-0"></span>조교 <span className="tabular-nums">{taCount}</span>명
          </div>
          <div className="flex items-center gap-1.5 bg-white/[0.07] border border-white/10 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm">
            <span className="w-2 h-2 rounded-full bg-blue-300 inline-block shrink-0"></span>학생 <span className="tabular-nums">{studentCount}</span>명
          </div>
          <div className="flex items-center gap-1.5 bg-white/[0.07] border border-white/10 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold shadow-sm">
            <span className="w-2 h-2 rounded-full bg-slate-400 inline-block shrink-0"></span>공석 <span className="tabular-nums">{vacantCount}</span>석
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 영역 */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* 좌측 그리드 */}
        <main className="flex-1 p-6 bg-slate-200 overflow-y-auto custom-scrollbar">
          <p className="text-[11px] text-slate-500 font-bold mb-3">💡 학생 카드를 드래그해서 빈 자리에 놓으면 좌석을 옮길 수 있어요.</p>
          <div className="grid grid-cols-10 gap-2">
            {SEATS.map(seat => {
              const student = gridSnapshot[seat];
              const isCall = student?.status === 'call';
              const isHint = student?.status === 'hint';
              const isAway = student?.status === 'away';
              const isSubmitted = student?.status === 'submitted';
              
              const isDragTarget = dropTarget === seat;
              const isDragged = draggedSeat === seat;

              if (!student) {
                return (
                  <div key={seat} 
                    onDragOver={(e) => handleDragOver(e, seat)} // 💡 버그 수정됨
                    onDragLeave={handleDragLeave} 
                    onDrop={(e) => handleDrop(e, seat)}          // 💡 버그 수정됨
                    className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-bold transition-all ${isDragTarget ? 'border-2 border-indigo-400 bg-indigo-50 text-indigo-500 shadow-inner' : 'bg-[#e2e8f0] text-[#94a3b8]'}`}>
                    {seat}
                  </div>
                );
              }

              return (
                <div key={seat} 
                  draggable 
                  onDragStart={(e) => handleDragStart(e, seat)}
                  className={`aspect-square rounded-md p-2 flex flex-col justify-between cursor-grab active:cursor-grabbing transition-all ${isDragged ? 'opacity-40 scale-95' : 'hover:scale-105 hover:shadow-lg shadow-sm z-10'} ${isCall ? 'status-help' : isHint ? 'hint-flash' : isAway ? 'bg-amber-50 border-2 border-amber-400' : isSubmitted ? 'bg-blue-50 border-2 border-blue-400' : 'bg-[#002864] text-white'}`}
                  title="드래그해서 좌석 이동"
                >
                  <div className="flex justify-between items-start pointer-events-none">
                    <span className="text-[8px] font-bold opacity-80">{seat}</span>
                    <span className={`text-[9px] font-bold px-1 rounded ${isCall ? 'bg-rose-600 text-white' : isHint ? 'bg-yellow-400 text-yellow-900' : isAway ? 'bg-amber-500 text-white' : isSubmitted ? 'bg-blue-600 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                      {isCall ? `🚨 ${Object.keys(student.calls || {}).length}` : isHint ? '💡' : isAway ? '🚶' : isSubmitted ? '✅' : '🟢'}
                    </span>
                  </div>
                  <div className="mt-auto pointer-events-none">
                    <div className={`font-bold text-[11px] truncate ${student.status === 'idle' ? 'text-white' : 'text-slate-800'}`}>{student.name}</div>
                    <div className={`text-[8px] font-bold truncate mt-0.5 ${student.status === 'idle' ? 'text-blue-200' : 'text-slate-500'}`}>{student.classes?.[0] || '반 없음'}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </main>

        {/* 우측 사이드바 (로그) */}
        <aside className="w-[360px] bg-white border-l border-slate-300 flex flex-col h-full shadow-2xl z-10 shrink-0">
          <div className="bg-slate-800 text-white px-5 py-3 font-bold text-sm flex justify-between items-center shrink-0">
            <span>⚡ 현장 라이브 로그</span>
            <span className="text-xs bg-rose-500 px-2 py-0.5 rounded animate-pulse">Live</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 custom-scrollbar">
            {logs.length === 0 ? (
              <div className="text-center text-xs text-slate-400 py-8">아직 접수된 로그 기록이 없습니다.</div>
            ) : (
              logs.map(log => (
                <div key={log.id} className={`bg-white p-3 rounded-lg border-l-4 ${log.borderClass} shadow-sm animate-[fadeIn_0.3s_ease-out]`}>
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[10px] font-bold text-slate-400">{log.time}</span>
                    <span className={`${log.badgeBg} text-[9px] font-bold px-1.5 py-0.5 rounded`}>{log.badgeText}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-800">{log.title}</p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-snug break-keep">{log.subtitle}</p>
                  {log.actionType === 'cancel_call' && (
                    <button onClick={() => executeTaAction(log.seat!, 'cancel_call', log.qNum)} className="mt-2 w-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-1.5 rounded transition-colors shadow-sm">
                      호출 종료
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      {/* AI 채점 재확인 모달 */}
      {recheckModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-indigo-600 text-white px-5 py-3 flex justify-between items-center">
              <span className="font-bold text-sm">🔄 AI 채점 재확인 — [{recheckModal.seat}] {recheckModal.name} · {recheckModal.qNum}번</span>
              <button onClick={() => setRecheckModal(null)} className="text-white/80 hover:text-white text-lg leading-none">&times;</button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div><p className="text-[11px] font-bold text-slate-400 mb-1">문제</p><p className="text-sm text-slate-700 leading-relaxed">{recheckModal.questionText}</p></div>
              <div><p className="text-[11px] font-bold text-slate-400 mb-1">정답(원문)</p><p className="text-sm font-bold text-slate-800">{recheckModal.correctAnswer}</p></div>
              <div><p className="text-[11px] font-bold text-slate-400 mb-1">제출 이미지</p><img className="w-full rounded-lg border border-slate-200 bg-white" src={recheckModal.imageDataUrl} /></div>
              <div className="bg-indigo-50 rounded-lg p-3">
                <p className="text-[11px] font-bold text-indigo-500 mb-1">🤖 제미나이가 인식한 내용</p>
                <p className="text-sm text-slate-700 mb-1">"{recheckModal.recognizedText}"</p>
                <p className="text-xs text-slate-500 leading-relaxed">{recheckModal.aiExplanation}</p>
                {recheckModal.aiConfidence && <p className="text-[10px] text-slate-400 mt-1">AI 확신도: {Math.round(recheckModal.aiConfidence * 100)}%</p>}
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-slate-100 bg-slate-50">
              <button onClick={() => resolveRecheck('incorrect')} className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-bold py-3 rounded-xl text-sm transition-colors shadow-sm">❌ 오답 처리</button>
              <button onClick={() => resolveRecheck('correct')} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl text-sm transition-colors shadow-sm">✅ 정답 처리</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}