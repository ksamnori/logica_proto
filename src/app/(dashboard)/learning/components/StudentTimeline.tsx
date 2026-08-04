"use client";

import React from "react";

interface StudentTimelineProps {
  currentView: any;
  activeTab: string;
  dateFilter: string;
  setDateFilter: (filter: 'ALL' | '1W' | '1M') => void;
  isLoading: boolean;
  filteredTimeline: any[];
  selectedBlocks: string[];
  setSelectedBlocks: React.Dispatch<React.SetStateAction<string[]>>;
  handleSelectAllStudent: () => void;
  handleBulkCompleteStudent: () => void;
  handleBulkDeleteStudent: () => void;
  handleGenerateIncorrectPrint: () => void;
  isGeneratingPrint: boolean;
  formatDateLabel: (dateStr: string, includeTime?: boolean) => string;
  handleForceComplete: (e: React.MouseEvent, type: string, id: string, targetStudentId: string) => void;
  handleDeleteExam: (assignmentId: string, studentId: string) => void;
  handleDeleteHomework: (hwId: string, studentId: string) => void;
  handleDeletePrint: (assignmentId: string, examId: string) => void;
}

export default function StudentTimeline({
  currentView, activeTab, dateFilter, setDateFilter, isLoading,
  filteredTimeline = [], selectedBlocks = [], setSelectedBlocks, handleSelectAllStudent,
  handleBulkCompleteStudent, handleBulkDeleteStudent, handleGenerateIncorrectPrint,
  isGeneratingPrint, formatDateLabel, handleForceComplete, handleDeleteExam, handleDeleteHomework, handleDeletePrint
}: StudentTimelineProps) {

  const renderHeader = () => {
    let titleStr = "전체 활동 타임라인";
    let visibleCount = filteredTimeline?.length || 0;
    if (activeTab === 'EXAM') titleStr = "전체 시험 타임라인";
    else if (activeTab === 'HOMEWORK') titleStr = "전체 과제 타임라인";
    else if (activeTab === 'INCORRECT') titleStr = "전체 오답 풀이 타임라인";

    const isAllSelected = visibleCount > 0 && selectedBlocks.length === visibleCount;

    return (
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
            <span className="bg-[#002864] text-white text-[11px] font-bold px-2 py-0.5 rounded shadow-sm whitespace-nowrap">{currentView?.className || '반 미지정'}</span>
            <span className="text-[#002864] whitespace-nowrap">{currentView?.studentName || '알 수 없음'}</span> 학생 {titleStr}
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-slate-300 rounded-lg overflow-hidden shadow-sm">
              <button onClick={() => setDateFilter('1W')} className={`px-4 py-2 text-[12px] font-bold transition-colors ${dateFilter === '1W' ? 'bg-[#002864] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>1주일</button>
              <div className="w-px bg-slate-300"></div>
              <button onClick={() => setDateFilter('1M')} className={`px-4 py-2 text-[12px] font-bold transition-colors ${dateFilter === '1M' ? 'bg-[#002864] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>1개월</button>
              <div className="w-px bg-slate-300"></div>
              <button onClick={() => setDateFilter('ALL')} className={`px-4 py-2 text-[12px] font-bold transition-colors ${dateFilter === 'ALL' ? 'bg-[#002864] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>전체</button>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-200 shadow-sm mt-0.5">
          <label className="flex items-center gap-2 cursor-pointer pl-2">
            <input type="checkbox" checked={isAllSelected} onChange={handleSelectAllStudent} className="w-5 h-5 accent-rose-500" />
            <span className="text-[13px] font-bold text-slate-700 whitespace-nowrap">전체 선택</span>
          </label>
          <div className="flex items-center gap-2">
            <button onClick={handleBulkCompleteStudent} disabled={selectedBlocks.length === 0} className="px-3 py-1.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold text-[12px] transition-colors disabled:opacity-40 whitespace-nowrap">
              ✅ 선택 완료처리 ({selectedBlocks.length})
            </button>
            <button onClick={handleBulkDeleteStudent} disabled={selectedBlocks.length === 0} className="px-3 py-1.5 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-bold text-[12px] transition-colors disabled:opacity-40 whitespace-nowrap">
              🗑️ 선택 삭제 ({selectedBlocks.length})
            </button>
            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            <button onClick={handleGenerateIncorrectPrint} disabled={selectedBlocks.length === 0 || isGeneratingPrint} className="px-4 py-1.5 rounded font-black text-[12px] text-white bg-[#002864] hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1 whitespace-nowrap">
              {isGeneratingPrint ? '생성 중...' : `🖨️ 오답 프린트 생성`}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {renderHeader()}
      <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-slate-50/50">
        {isLoading ? (
          <div className="text-center font-bold text-slate-400 py-10 text-[13px]">타임라인을 구성하는 중입니다...</div>
        ) : filteredTimeline.length === 0 ? (
          <div className="text-center font-bold text-slate-400 py-10 text-[13px]">해당 기간에 기록된 활동이 없습니다.</div>
        ) : (
          <div className="space-y-3 pb-20">
            {filteredTimeline.map((item, idx) => {
              if (!item || !item.id || !item.type) return null;

              const isSelected = selectedBlocks.includes(item.id);
              const isCompleted = item.isCompleted;
              
              let badgeColor = "bg-slate-100 text-slate-500";
              let typeLabel = "";
              
              if (item.type === 'exam') { badgeColor = "bg-blue-100 text-blue-700 border-blue-200"; typeLabel = "📝 시험"; }
              else if (item.type.includes('hw')) { badgeColor = "bg-amber-100 text-amber-700 border-amber-200"; typeLabel = "📚 과제"; }
              else { badgeColor = "bg-emerald-100 text-emerald-700 border-emerald-200"; typeLabel = "🖨️ 오답프린트"; }

              const rowBgClass = isSelected 
                ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' 
                : isCompleted 
                  ? 'bg-slate-200/60 border-slate-300 text-slate-600 hover:bg-slate-200/80' 
                  : 'bg-white border-slate-200 hover:border-[#002864]';

              return (
                <div key={`${item.id}_${idx}`} onClick={() => setSelectedBlocks(p => p.includes(item.id) ? p.filter(id => id !== item.id) : [...p, item.id])} 
                  className={`border-2 rounded-xl p-3 flex items-center justify-between gap-3 transition-all cursor-pointer shadow-sm ${rowBgClass}`}
                >
                  <div className="flex items-center gap-3 w-1/2 min-w-0 shrink-0 flex-1">
                    <input type="checkbox" checked={isSelected} readOnly className="w-5 h-5 accent-rose-500 pointer-events-none shrink-0" />
                    <div className="w-[100px] shrink-0 text-[11px] font-bold text-slate-400 leading-tight truncate">
                      {formatDateLabel(item.date, true)} 
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold border shrink-0 whitespace-nowrap ${badgeColor}`}>{typeLabel}</span>
                    <div className="flex-1 font-extrabold text-[14px] truncate" title={item.title || '제목 없음'}>
                      {item.title || '제목 없음'}
                    </div>
                  </div>

                  {/* 💡 우측 컨테이너 너비 확장 (440px) 및 간격 여유 확보 */}
                  <div className="flex items-center gap-3 shrink-0 justify-end w-[440px]">
                    <div className="text-[12px] font-bold text-slate-500 shrink-0 w-[60px] text-right whitespace-nowrap">총 {item.total || 0}문항</div>
                    
                    <div className="flex items-center gap-1.5 shrink-0 w-[90px] justify-center">
                      <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 whitespace-nowrap">✅ {item.oCount || 0}</span>
                      <span className="text-[11px] font-bold text-rose-500 bg-rose-50 px-2 py-0.5 rounded border border-rose-100 whitespace-nowrap">❌ {item.xCount || 0}</span>
                    </div>
                    
                    <div className="flex items-center gap-1.5 shrink-0 w-[130px] justify-end">
                      <button onClick={(e) => handleForceComplete(e, item.type.includes('hw') && item.type !== 'hw_exam' ? 'hw' : 'exam', item.realId, currentView.studentId)} className="text-[11px] font-bold text-slate-600 hover:text-emerald-600 transition-colors bg-white border border-slate-200 px-2 py-0.5 rounded shadow-sm whitespace-nowrap shrink-0">
                        ✅ 완료처리
                      </button>
                      <span className={`w-[54px] text-center px-1 py-0.5 rounded text-[10px] font-extrabold whitespace-nowrap shrink-0 ${isCompleted ? 'bg-slate-300 text-slate-700 border border-slate-400' : 'bg-rose-50 text-rose-500 border border-rose-200'}`}>
                        {item.status || '미제출'}
                      </span>
                    </div>
                    
                    {/* 💡 통합 교재 과제(type: hw)일 경우 연필(✏️) 숨김 & 너비 여유 확보 */}
                    <div className="flex items-center gap-2.5 shrink-0 border-l border-slate-300 pl-4 w-[120px] justify-end">
                      {item.type !== 'hw' && (
                        <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?id=${item.masterId}&exam_id=${item.masterId}`, '_blank'); }} className="text-[14px] hover:text-blue-600 transition-colors shrink-0">✏️</button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); if(item.type === 'exam' || item.type === 'hw_exam') handleDeleteExam(item.realId, currentView.studentId); else if(item.type.includes('hw')) handleDeleteHomework(item.realId, currentView.studentId); else if(item.type === 'print') handleDeletePrint(item.realId, item.masterId); }} className="text-[14px] hover:text-rose-500 transition-colors shrink-0">🗑️</button>
                      <button onClick={(e) => { e.stopPropagation(); window.location.href = item.type.includes('hw') ? `/homework/review?homework_id=${item.realId}&student_id=${currentView.studentId}` : `/exam/review?assignment_id=${item.realId}`; }} className="text-[11px] font-bold text-white bg-[#002864] hover:bg-blue-900 px-3 py-1.5 rounded transition-colors shadow-sm ml-0.5 shrink-0 whitespace-nowrap">상세 ➔</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}