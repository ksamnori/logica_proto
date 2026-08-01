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

    // 로그인한 선생님 정보 상태 관리
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
            router.push('/'); // 프로젝트의 기본 로그인 페이지 경로로 알맞게 변경 가능합니다.
        }
    };

    // 1. 권한을 확인하고 있는 로딩 상태
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

    // 2. 권한이 없는 경우 (접근 거부)
    if (isAuthorized === false) {
        return (
            <div className="h-screen flex items-center justify-center bg-slate-200 font-['Pretendard']">
                <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center border border-slate-200">
                    <div className="text-5xl mb-4">⛔</div>
                    <h2 className="text-2xl font-extrabold text-rose-600 mb-2">접근 권한 없음</h2>
                    <p className="text-sm text-slate-600 mb-6 font-bold leading-relaxed">{authMessage}</p>
                    {/* 👑 수정됨: 안내 문구에 최고관리자 추가 */}
                    <p className="text-xs text-slate-400 mb-6">수퍼바이저 대시보드는 <span className="text-[#002864] font-extrabold">최고관리자</span>, <span className="text-[#002864] font-extrabold">원장</span> 및 <span className="text-[#002864] font-extrabold">실장</span> 권한만 접속할 수 있습니다.</p>
                    <button onClick={() => window.history.back()} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 rounded-lg shadow-md transition-colors">이전 화면으로 돌아가기</button>
                </div>
            </div>
        );
    }

    // 3. 정상 접속 (대시보드 렌더링)
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

            {/* 마우스 고스트 영역 (드래그 시 사용) — 잡은 카드의 실제 위치/크기에서 그대로 나타나서
                커서의 그 지점을 계속 따라다니도록, 초기 위치를 ghostRect로 지정한다.
                💡 바깥 껍데기는 화면에 보이던 크기(ghostRect.width/height) 그대로 두고, 안쪽 내용물만
                원래 크기로 그린 뒤 ghostRect.scale만큼 다시 축소한다 — 카드 본체와 똑같은 배율이라
                손으로 잡는 순간 글씨가 갑자기 커 보이거나 위치가 어긋나는 일이 없다. (예전에 걸려
                있던 scale-105는 중심 기준으로 박스 자체를 부풀려서 커서 잡은 지점과 어긋나 보이게
                했으므로 제거했다.) */}
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
                <div id="drag-ghost" className="fixed pointer-events-none z-[9999] opacity-[0.65] shadow-2xl bg-white border border-slate-200 rounded-xl overflow-hidden"
                     style={{ left: ghostRect.left, top: ghostRect.top, width: ghostRect.width, height: ghostRect.height }}>
                    <div className="p-2 flex flex-col justify-center h-full"
                         style={{ width: ghostRect.width / ghostRect.scale, height: ghostRect.height / ghostRect.scale, transform: `scale(${ghostRect.scale})`, transformOrigin: 'top left' }}>
                        <span className="bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm w-max mb-1">신규 배정</span>
                        <div className="font-bold text-slate-900 text-[13px] truncate mb-1">{draggedListStudent.name}</div>
                        {draggedListStudent.classes?.length > 0 ? (
                            <div className="text-[9px] font-bold text-emerald-600 truncate">{draggedListStudent.classes[0]}</div>
                        ) : <div className="text-[9px] font-bold text-slate-300 truncate">반 없음</div>}
                    </div>
                </div>
            )}

            <header className="bg-gradient-to-r from-[#002864] to-[#013a8f] text-white px-5 py-2 flex justify-between items-center shadow-md z-20 shrink-0">
                <div>
                    <h1 className="text-[15px] font-bold leading-tight">Logica Clinic <span className="text-blue-300 mx-1">—</span> 총책임자 대시보드</h1>
                    <p className="text-[10px] text-blue-300/80 mt-0.5 leading-tight">전체 클리닉 통합 관제 · Supabase Realtime 기반 · 💡 학생 카드를 드래그해서 빈 자리에 놓으면 좌석을 옮길 수 있어요</p>
                </div>

                <div className="flex items-center gap-3">
                    {/* 현황 배지 */}
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                        <div className="flex items-center gap-1 bg-white/[0.07] px-2 py-1 rounded-lg text-[11px] font-semibold leading-none"><span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"></span> 조교 {Object.keys(activeTAs).length}명</div>
                        <div className="flex items-center gap-1 bg-white/[0.07] px-2 py-1 rounded-lg text-[11px] font-semibold leading-none"><span className="w-1.5 h-1.5 rounded-full bg-blue-300 shrink-0"></span> 학생 {studentCount}명</div>
                        <div className="flex items-center gap-1 bg-white/[0.07] px-2 py-1 rounded-lg text-[11px] font-semibold leading-none"><span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0"></span> 공석 {vacantCount}석</div>
                        <div className="flex items-center gap-1 bg-rose-500/15 px-2 py-1 rounded-lg text-[11px] font-semibold leading-none">🚨 호출대기 {callingCount}건</div>
                    </div>

                    <div className="w-px h-5 bg-white/15 mx-0.5 hidden 2xl:block"></div>

                    {/* 가동 시간 */}
                    <div className="text-right flex items-center gap-2 hidden xl:flex">
                        <div>
                            <div className="text-sm font-bold font-mono leading-tight">{isMounted ? new Date(now).toLocaleTimeString('ko-KR', { hour12: false }) : '--:--:--'}</div>
                            <div className="text-[9px] text-blue-300/80 leading-tight">가동 시간 <span>{isMounted ? formatDuration(now - startedAt) : '00:00'}</span></div>
                        </div>
                        <span className={`w-2 h-2 rounded-full shrink-0 dot-live ${connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus === 'error' ? 'bg-rose-500' : 'bg-slate-400'}`}></span>
                    </div>

                    <div className="w-px h-5 bg-white/15 mx-0.5"></div>

                    {/* 내비게이션 & 내 정보 */}
                    <div className="flex items-center gap-2">
                        <button onClick={() => router.push('/admin-dashboard')} className="bg-[#013a8f] hover:bg-blue-800 border border-blue-400/30 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors shadow-sm whitespace-nowrap leading-none">
                            운영 대시보드 ⚙️
                        </button>
                        <div className="text-right hidden sm:block">
                            <div className="text-[11px] font-bold leading-tight">{instructorInfo.name} <span className="text-[9px] text-blue-300 font-normal">{instructorInfo.position}</span></div>
                        </div>
                        <button onClick={handleLogout} className="bg-rose-500/20 hover:bg-rose-500/40 text-rose-200 border border-rose-500/30 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors whitespace-nowrap leading-none">
                            로그아웃
                        </button>
                    </div>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                <LeftPanel data={supervisorData} />
                <SeatGrid data={supervisorData} />

                {/* 우측 라이브 로그 영역 */}
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