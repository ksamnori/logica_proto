// src/app/supervisor/page.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSupervisorData } from './useSupervisorData';
import { formatDuration } from './supervisorUtils';
import LeftPanel from './LeftPanel';
import SeatGrid from './SeatGrid';
import SeatCardBody from './SeatCardBody';

export default function SupervisorDashboard() {
    const router = useRouter();
    const supervisorData = useSupervisorData();
    const {
        isAuthorized, authMessage,
        now, startedAt, connectionStatus, isMounted,
        activeStudents, activeTAs, logs,
        draggedSeat, draggedListStudent, taAction, ghostRect,
        seats, editorLocked
    } = supervisorData;

    const [instructorInfo, setInstructorInfo] = useState({ name: '', position: '' });

    useEffect(() => {
        setInstructorInfo({
            name: localStorage.getItem('logica_instructor_name') || '원장/실장',
            position: localStorage.getItem('logica_instructor_position') || '관리자'
        });
    }, []);

    const handleLogout = () => {
        if (window.confirm('로그아웃 하시겠습니까?')) {
            localStorage.removeItem('logica_instructor_id');
            localStorage.removeItem('logica_instructor_role');
            localStorage.removeItem('logica_instructor_position');
            localStorage.removeItem('logica_instructor_name');
            router.push('/');
        }
    };

    if (isAuthorized === null) {
        return (
            <div className="h-screen flex items-center justify-center bg-slate-200 font-['Pretendard']">
                <div className="bg-white p-8 rounded-2xl shadow-xl w-96 text-center border border-slate-200">
                    <div className="animate-spin text-4xl mb-4">⏳</div>
                    <h2 className="text-xl font-extrabold text-slate-800 mb-2">권한 확인 중</h2>
                    <p className="text-sm text-slate-500 font-bold">{authMessage}</p>
                </div>
            </div>
        );
    }

    if (isAuthorized === false) {
        return (
            <div className="h-screen flex items-center justify-center bg-slate-200 font-['Pretendard']">
                <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center border border-slate-200">
                    <div className="text-5xl mb-4">⛔</div>
                    <h2 className="text-2xl font-extrabold text-rose-600 mb-2">접근 권한 없음</h2>
                    <p className="text-sm text-slate-600 mb-6 font-bold leading-relaxed">{authMessage}</p>
                    <p className="text-xs text-slate-400 mb-6">수퍼바이저 대시보드는 <span className="text-[#002864] font-extrabold">최고관리자</span>, <span className="text-[#002864] font-extrabold">원장</span> 및 <span className="text-[#002864] font-extrabold">실장</span> 권한만 접속할 수 있습니다.</p>
                    <button onClick={() => window.history.back()} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 rounded-lg shadow-md transition-colors">이전 화면으로 돌아가기</button>
                </div>
            </div>
        );
    }

    const studentCount = Object.keys(activeStudents).length;
    const vacantCount = Math.max(0, seats.length - studentCount);
    let callingCount = 0, hintingCount = 0, awayCount = 0, timeUrgentCount = 0;

    Object.values(activeStudents).forEach((st: any) => {
        if (st.status === 'away') awayCount++;
        if (st.status === 'hint') hintingCount++;
        if (st.firstSeenAt && st.clinicDurationMs && (st.firstSeenAt + st.clinicDurationMs) - now <= 5 * 60 * 1000) timeUrgentCount++;
        if (st.calls && Object.keys(st.calls).length > 0) callingCount++;
    });

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-slate-200 font-['Pretendard']">
            {editorLocked && (
                <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[999] flex items-center justify-center">
                    <div className="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-sm">
                        <div className="text-4xl mb-3">🔒</div>
                        <h3 className="text-lg font-extrabold text-slate-800 mb-2">좌석 배치 수정 중입니다</h3>
                        <p className="text-sm text-slate-500">관리자가 좌석 배치를 편집하는 동안에는<br />클리닉 기능이 잠시 멈춥니다. 잠시만 기다려주세요.</p>
                    </div>
                </div>
            )}
            <style dangerouslySetInnerHTML={{ __html: `
                @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
                @keyframes pulse-red { 0%, 100% { border-color: #ef4444; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); } 50% { border-color: #fca5a5; box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); } }
                .status-help { animation: pulse-red 1.2s infinite; background-color: #fef2f2; border: 2px solid #ef4444; }
                @keyframes flash-yellow { 0%, 100% { background-color: white; } 50% { background-color: #fef9c3; border-color: #eab308; } }
                .hint-flash { animation: flash-yellow 1.5s ease-in-out infinite; }
                @keyframes blink-dot { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
                .dot-live { animation: blink-dot 1.6s ease-in-out infinite; }
                ::-webkit-scrollbar { width: 7px; height: 7px; }
                ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
            `}} />

            {draggedSeat && activeStudents[draggedSeat] && ghostRect && (
                <div id="drag-ghost" className="fixed pointer-events-none z-[9999] opacity-[0.65] shadow-2xl bg-white border border-slate-200 rounded-xl overflow-hidden"
                     style={{ left: ghostRect.left, top: ghostRect.top, width: ghostRect.width, height: ghostRect.height }}>
                    <div className="p-2 flex flex-col justify-center h-full"
                         style={{ width: ghostRect.width / ghostRect.scale, height: ghostRect.height / ghostRect.scale, transform: `scale(${ghostRect.scale})`, transformOrigin: 'top left' }}>
                        <SeatCardBody seat={draggedSeat} student={activeStudents[draggedSeat]} now={now} isMounted={isMounted} interactive={false} />
                    </div>
                </div>
            )}
            {draggedListStudent && ghostRect && (
                <div id="drag-ghost" className="fixed pointer-events-none z-[9999] opacity-[0.85] shadow-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/80 rounded-xl p-2 flex flex-col justify-center overflow-hidden"
                     style={{ left: ghostRect.left, top: ghostRect.top, width: ghostRect.width, height: ghostRect.height }}>
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                        <div className="flex items-center gap-1 min-w-0">
                            <span className="shrink-0 bg-indigo-500 text-white text-[9px] font-bold w-3.5 h-3.5 flex items-center justify-center rounded leading-none">🕒</span>
                            <span className="font-bold text-slate-700 text-[12px] truncate leading-tight">{draggedListStudent.name}</span>
                        </div>
                        <span className="shrink-0 text-[8px] font-bold px-1 py-px rounded bg-indigo-600 text-white leading-none">신규 배정</span>
                    </div>
                    {draggedListStudent.classes?.length > 0 ? (
                        <div className="text-[8px] font-bold text-emerald-600 truncate leading-none">{draggedListStudent.classes[0]}</div>
                    ) : <div className="text-[8px] font-bold text-slate-300 truncate leading-none">반 없음</div>}
                </div>
            )}

            <header className="bg-slate-900 border-b border-slate-800 text-white px-6 py-3 flex justify-between items-center z-20 shrink-0 shadow-lg">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center shadow-inner shadow-indigo-400/50">
                        <span className="text-xl">📡</span>
                    </div>
                    <div>
                        <h1 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                            Logica Clinic <span className="font-medium text-slate-400">|</span> 관제탑
                        </h1>
                        <p className="text-[11px] text-slate-400 font-medium mt-0.5 tracking-tight">전체 좌석 현황 모니터링 및 실시간 제어 시스템</p>
                    </div>
                </div>

                <div className="flex items-center gap-5">
                    <div className="flex items-center gap-2 bg-slate-800/50 p-1.5 rounded-xl border border-slate-700/50">
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 text-[11px] font-bold text-slate-300 shadow-sm"><span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0"></span>조교 {Object.keys(activeTAs).length}</div>
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 text-[11px] font-bold text-slate-300 shadow-sm"><span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>학생 {studentCount}</div>
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 text-[11px] font-bold text-slate-300 shadow-sm"><span className="w-2 h-2 rounded-full bg-slate-500 shrink-0"></span>공석 {vacantCount}</div>
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/20 border border-rose-500/30 text-[11px] font-bold text-rose-300 shadow-sm"><span className="text-rose-400">🚨</span>호출 {callingCount}</div>
                    </div>

                    <div className="flex items-center gap-3 bg-slate-800/50 pl-4 pr-3 py-1.5 rounded-xl border border-slate-700/50 hidden xl:flex">
                        <div className="text-right">
                            <div className="text-xs font-black font-mono text-slate-200">{isMounted ? new Date(now).toLocaleTimeString('ko-KR', { hour12: false }) : '--:--:--'}</div>
                            <div className="text-[9px] text-slate-500 font-bold">UPTIME {isMounted ? formatDuration(now - startedAt) : '00:00'}</div>
                        </div>
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_8px_rgba(0,0,0,0.5)] ${connectionStatus === 'connected' ? 'bg-emerald-500 dot-live' : connectionStatus === 'error' ? 'bg-rose-500' : 'bg-amber-500'}`}></span>
                    </div>

                    <div className="flex items-center gap-3 pl-2">
                        <button onClick={() => router.push('/admin-dashboard')} className="group flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-2 rounded-lg text-xs font-bold transition-all shadow-md hover:shadow-indigo-500/20">
                            <span className="group-hover:scale-110 transition-transform">⚙️</span> 운영 홈
                        </button>
                        <div className="w-px h-8 bg-slate-700 mx-1 hidden sm:block"></div>
                        <div className="text-right hidden sm:block leading-tight">
                            <div className="text-xs font-bold text-slate-200">{instructorInfo.name}</div>
                            <div className="text-[10px] font-medium text-slate-500">{instructorInfo.position}</div>
                        </div>
                        <button onClick={handleLogout} className="bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 border border-slate-700 hover:border-rose-500/50 px-3 py-2 rounded-lg text-xs font-bold transition-colors">
                            로그아웃
                        </button>
                    </div>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                <LeftPanel data={supervisorData} />
                <SeatGrid data={supervisorData} />

                <aside className="w-[260px] bg-white border-l border-slate-300 flex flex-col h-full shadow-2xl z-10 shrink-0">
                    <div className="bg-slate-800 text-white px-4 py-2 font-bold text-[12px] flex justify-between items-center shrink-0">
                        <span>⚡ 현장 라이브 로그</span>
                        <span className="text-[10px] bg-rose-500 px-1.5 py-0.5 rounded animate-pulse">Live</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
                        {logs.length === 0 ? <div className="text-center text-[11px] text-slate-400 py-8">접수된 기록이 없습니다.</div> : logs.map((log: any) => (
                            <div key={log.id} className={`bg-white p-2 rounded-lg border-l-4 ${log.borderClass} shadow-sm`}>
                                <div className="flex justify-between items-start mb-0.5">
                                    <span className="text-[9px] font-bold text-slate-400">{log.timestamp}</span>
                                    <span className={`${log.badgeBg} text-[8px] font-bold px-1 py-0.5 rounded`}>{log.badgeText}</span>
                                </div>
                                <p className="text-[12px] font-bold text-slate-800 leading-tight">{log.title}</p>
                                <p className="text-[10px] text-slate-600 mt-0.5 leading-snug">{log.subtitle}</p>
                                {log.type === 'call' && <button onClick={() => taAction(log.data.seat, 'cancel_call', log.data.qNum)} className="mt-1.5 w-full bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold py-1 rounded transition-colors">호출 종료</button>}
                            </div>
                        ))}
                    </div>
                </aside>
            </div>
        </div>
    );
}