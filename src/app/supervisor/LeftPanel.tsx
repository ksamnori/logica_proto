// src/app/supervisor/LeftPanel.tsx
import React from 'react';
import { formatDuration, formatHM, formatClockTime } from './supervisorUtils';

export default function LeftPanel({ data }: { data: any }) {
    const {
        now, activeTAs, taStats, activeStudents, allStudents,
        leftTab, setLeftTab, expandedClasses, setExpandedClasses,
        clinicRecords, expandedRecords, toggleRecordExpand, fetchClinicRecords,
        handleListPointerDown
    } = data;

    const toggleClass = (cName: string) => setExpandedClasses((p: any) => ({ ...p, [cName]: !p[cName] }));

    const sortedRecords = Object.entries(clinicRecords as Record<string, any>).sort(([, a]: any, [, b]: any) => {
        const aLatest = a.sessions[a.sessions.length - 1]?.startedAt || 0;
        const bLatest = b.sessions[b.sessions.length - 1]?.startedAt || 0;
        return bLatest - aLatest;
    });

    return (
        <aside className="w-[230px] bg-white border-r border-slate-300 flex flex-col h-full shrink-0 shadow-lg z-10">
            <div className="flex shrink-0 border-b border-slate-200">
                <button onClick={() => setLeftTab('ta')} className={`flex-1 py-2 text-[11px] font-bold border-b-2 transition-colors ${leftTab === 'ta' ? 'bg-white border-indigo-600 text-indigo-700' : 'bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100'}`}>👩‍🏫 조교 현황</button>
                <button onClick={() => setLeftTab('students')} className={`flex-1 py-2 text-[11px] font-bold border-b-2 transition-colors ${leftTab === 'students' ? 'bg-white border-indigo-600 text-indigo-700' : 'bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100'}`}>👩‍🎓 학생 목록</button>
                <button onClick={() => setLeftTab('records')} className={`flex-1 py-2 text-[11px] font-bold border-b-2 transition-colors ${leftTab === 'records' ? 'bg-white border-indigo-600 text-indigo-700' : 'bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100'}`}>📋 이용 기록</button>
            </div>

            {leftTab === 'records' ? (
                <div className="flex-1 overflow-y-auto p-3 bg-slate-50">
                    <div className="flex items-center justify-between mb-3 px-1">
                        <p className="text-[10px] text-slate-400 font-bold">오늘 클리닉 이용 기록</p>
                        <button onClick={() => fetchClinicRecords()} className="text-[10px] text-indigo-500 font-bold hover:text-indigo-700">↻ 새로고침</button>
                    </div>
                    {sortedRecords.length === 0 ? (
                        <div className="text-center text-xs text-slate-400 py-8">오늘 기록이 없습니다.</div>
                    ) : (
                        sortedRecords.map(([studentId, rec]: [string, any]) => (
                            <div key={studentId} className="mb-2 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                                <button onClick={() => toggleRecordExpand(studentId)} className="w-full flex justify-between items-center p-2 hover:bg-slate-50 transition-colors">
                                    <span className="font-bold text-[12px] text-slate-800">{rec.name}</span>
                                    <span className="flex items-center gap-2">
                                        <span className="text-[12px] font-bold text-indigo-600 tabular-nums">{formatHM(rec.totalMs)}</span>
                                        <span className="text-slate-400 text-xs">{expandedRecords[studentId] ? '▲' : '▼'}</span>
                                    </span>
                                </button>
                                {expandedRecords[studentId] && (
                                    <div className="px-3 pb-3 space-y-1.5 border-t border-slate-100 pt-2">
                                        {rec.sessions.map((s: any) => (
                                            <div key={s.sessionNo} className="flex items-center justify-between text-[10px] text-slate-500">
                                                <span className="font-bold text-slate-600 w-10 shrink-0">{s.sessionNo}회차</span>
                                                <span className="tabular-nums flex-1 text-center">
                                                    {formatClockTime(s.startedAt)} ~ {s.endedAt ? formatClockTime(s.endedAt) : '진행중'}
                                                </span>
                                                <span className="tabular-nums font-bold text-slate-700 w-10 text-right">{formatHM(s.durationMs)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            ) : leftTab === 'ta' ? (
                <div className="flex-1 overflow-y-auto p-3 bg-slate-50">
                    {Object.keys(activeTAs).length === 0 && Object.keys(taStats).length === 0 ? (
                        <div className="text-center text-xs text-slate-400 py-8">접속한 조교가 없습니다.</div>
                    ) : (
                        <>
                            {Object.values(activeTAs).sort((a: any, b: any) => a.joined_at - b.joined_at).map((ta: any) => (
                                <div key={ta.clientId} className="bg-white border border-slate-200 rounded-xl p-3 mb-2 shadow-sm hover:shadow-md hover:border-slate-300 transition-all">
                                    <div className="flex justify-between items-start">
                                        <span className="font-bold text-slate-800 text-[12px]">{ta.name}</span>
                                        <span className="text-[10px] text-slate-400 font-semibold tracking-tight">근무 <span className="tabular-nums">{formatDuration(now - ta.joined_at)}</span></span>
                                    </div>
                                    {ta.handling ? (
                                        <div className="text-[11px] font-bold text-rose-600 mt-1.5 flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 dot-live shrink-0"></span>
                                            [{ta.handling.split('::')[0]}] {activeStudents[ta.handling.split('::')[0]]?.name || '학생'} · {ta.handling.split('::')[1]}번 상담 중
                                        </div>
                                    ) : (
                                        <div className="text-[11px] font-bold text-emerald-600 mt-1.5 flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>대기 중
                                        </div>
                                    )}
                                    <div className="text-[10px] text-slate-400 font-semibold mt-2 pt-2 border-t border-slate-100">
                                        누적 처리 <span className="text-slate-600 font-bold">{taStats[ta.clientId]?.total || 0}건</span> · 힌트 {taStats[ta.clientId]?.hint || 0} · 넘어가기 {taStats[ta.clientId]?.skip || 0}
                                    </div>
                                </div>
                            ))}
                        </>
                    )}
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto p-3 bg-slate-50">
                    <p className="text-[10px] text-slate-400 font-bold mb-3 px-1">💡 빈자리에 끌어다 놓으면 시간을 예약할 수 있어요. 학생이 실제 로그인하면 자동으로 배정됩니다.</p>
                    {Object.entries(allStudents).map(([cKey, group]: [string, any]) => (
                        <div key={cKey} className="mb-2">
                            <button onClick={() => toggleClass(cKey)} className="w-full flex justify-between items-center bg-white p-2 rounded-lg border border-slate-200 font-bold text-[12px] text-slate-700 hover:bg-slate-100 shadow-sm transition-colors">
                                <span>{group.label} <span className="text-xs text-indigo-500 ml-1">({group.students.length})</span></span>
                                <span className="text-slate-400 text-xs">{expandedClasses[cKey] ? '▲' : '▼'}</span>
                            </button>
                            {expandedClasses[cKey] && (
                                <div className="pl-2 pr-1 py-2 space-y-1.5">
                                    {group.students.map((st: any) => {
                                        const matched: any = Object.values(activeStudents).find((s: any) => s.studentId === st.id);
                                        const isSeated = !!matched;
                                        return (
                                            <div key={st.id} onPointerDown={(e) => isSeated ? null : handleListPointerDown(e, st)}
                                                 className={`p-2 rounded-lg text-[12px] flex justify-between items-center border transition-all ${isSeated ? 'bg-slate-100 border-slate-200 opacity-50' : 'bg-white border-slate-200 hover:border-indigo-400 cursor-grab hover:shadow-md'}`}>
                                                <span className="font-bold text-slate-800">{st.name}</span>
                                                {isSeated && <span className="text-[10px] font-bold text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">{matched.type === 'reserved' ? '예약됨' : '배정됨'}</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </aside>
    );
}