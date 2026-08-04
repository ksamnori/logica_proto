// src/app/(dashboard)/learning/components/StudentTimeline.tsx
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
  currentView,
  activeTab,
  dateFilter,
  setDateFilter,
  isLoading,
  filteredTimeline,
  selectedBlocks,
  setSelectedBlocks,
  handleSelectAllStudent,
  handleBulkCompleteStudent,
  handleBulkDeleteStudent,
  handleGenerateIncorrectPrint,
  isGeneratingPrint,
  formatDateLabel,
  handleForceComplete,
  handleDeleteExam,
  handleDeleteHomework,
  handleDeletePrint
}: StudentTimelineProps) {

  // 💡 기존 page.tsx에 있던 학생 전용 헤더를 이 안으로 옮겨왔습니다.
  const renderHeader = () => {
    let titleStr = "전체 활동 타임라인";
    let visibleCount = filteredTimeline.length;
    
    if (activeTab === 'EXAM') titleStr = "전체 시험 타임라인";
    else if (activeTab === 'HOMEWORK') titleStr = "전체 과제 타임라인";
    else if (activeTab === 'INCORRECT') titleStr = "전체 오답 풀이 타임라인";

    const isAllSelected = visibleCount > 0 && selectedBlocks.length === visibleCount;

    return (
      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex flex-col gap-2.5">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
            <span className="bg-[#002864] text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm">{currentView.className}</span>
            <span className="text-[#002864]">{currentView.studentName}</span> 학생 {titleStr}
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-slate-300 rounded-lg overflow-hidden shadow-sm">
              <button onClick={() => setDateFilter('1W')} className={`px-3 py-1.5 text-[11px] font-bold transition-colors ${dateFilter === '1W' ? 'bg-[#002864] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>1주일</button>
              <div className="w-px bg-slate-300"></div>
              <button onClick={() => setDateFilter('1M')} className={`px-3 py-1.5 text-[11px] font-bold transition-colors ${dateFilter === '1M' ? 'bg-[#002864] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>1개월</button>
              <div className="w-px bg-slate-300"></div>
              <button onClick={() => setDateFilter('ALL')} className={`px-3 py-1.5 text-[11px] font-bold transition-colors ${dateFilter === 'ALL' ? 'bg-[#002864] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>전체</button>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center bg-white p-1.5 rounded-lg border border-slate-200 shadow-sm mt-0.5">
          <label className="flex items-center gap-1.5 cursor-pointer pl-1.5">
            <input type="checkbox" checked={isAllSelected} onChange={handleSelectAllStudent} className="w-4 h-4 accent-rose-500" />
            <span className="text-[12px] font-bold text-slate-700">전체 선택</span>
          </label>
          <div className="flex items-center gap-1.5">
            <button onClick={handleBulkCompleteStudent} disabled={selectedBlocks.length === 0} className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold text-[11px] transition-colors disabled:opacity-40">
              ✅ 선택 완료처리 ({selectedBlocks.length})
            </button>
            <button onClick={handleBulkDeleteStudent} disabled={selectedBlocks.length === 0} className="px-2.5 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-bold text-[11px] transition-colors disabled:opacity-40">
              🗑️ 선택 삭제 ({selectedBlocks.length})
            </button>
            <div className="w-px h-4 bg-slate-300 mx-0.5"></div>
            <button onClick={handleGenerateIncorrectPrint} disabled={selectedBlocks.length === 0 || isGeneratingPrint} className="px-3 py-1 rounded font-black text-[11px] text-white bg-[#002864] hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1">
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
          <div className="text-center font-bold text-slate-400 py-20 text-[12px]">타임라인을 구성하는 중입니다...</div>
        ) : filteredTimeline.length === 0 ? (
          <div className="text-center font-bold text-slate-400 py-20 border-2 border-dashed border-slate-200 rounded-2xl text-[12px]">해당 기간에 기록된 활동이 없습니다.</div>
        ) : (
          <div className="space-y-2.5 pb-20">
            {filteredTimeline.map((item, idx) => {
              const isSelected = selectedBlocks.includes(item.id);
              let badgeColor = "bg-slate-100 text-slate-500";
              let typeLabel = "";
              if (item.type === 'exam') { badgeColor = "bg-blue-100 text-blue-700 border-blue-200"; typeLabel = "📝 시험"; }
              else if (item.type === 'hw' || item.type === 'hw_exam') { badgeColor = "bg-amber-100 text-amber-700 border-amber-200"; typeLabel = "📚 과제"; }
              else { badgeColor = "bg-emerald-100 text-emerald-700 border-emerald-200"; typeLabel = "🖨️ 오답프린트"; }

              return (
                <div 
                  key={`${item.id}_${idx}`} 
                  className={`bg-white border-2 rounded-xl p-2.5 flex items-center justify-between gap-3 transition-all cursor-pointer shadow-sm ${isSelected ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' : 'border-slate-200 hover:border-[#002864]'}`}
                  onClick={() => setSelectedBlocks(p => p.includes(item.id) ? p.filter(id => id !== item.id) : [...p, item.id])}
                >
                  {/* 좌측 (날짜, 뱃지, 제목) */}
                  <div className="flex items-center gap-2.5 min-w-0 shrink-0 flex-1">
                    <input type="checkbox" checked={isSelected} readOnly className="w-4 h-4 accent-rose-500 pointer-events-none shrink-0" />
                    <div className="w-[80px] shrink-0 text-[10px] font-bold text-slate-400 leading-tight">
                      {formatDateLabel(item.date, false)}
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold border shrink-0 ${badgeColor}`}>{typeLabel}</span>
                    <div className="flex-1 font-extrabold text-slate-800 text-[13px] truncate" title={item.title}>
                      {item.title}
                    </div>
                  </div>

                  {/* 💡 우측 (문항수, 정답수, 완료버튼, 상세버튼 - 고정 너비로 완벽 정렬) */}
                  <div className="flex items-center shrink-0 justify-end w-auto">
                    
                    {/* 1. 총 문항 수 */}
                    <div className="text-[11px] font-bold text-slate-500 w-[60px] text-right shrink-0">
                      총 {item.total}문항
                    </div>
                    
                    {/* 2. O / X 결과 */}
                    <div className="flex items-center justify-center gap-1 w-[85px] shrink-0 ml-3">
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 w-[36px] text-center inline-block">✅ {item.oCount}</span>
                      <span className="text-[10px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100 w-[36px] text-center inline-block">❌ {item.xCount}</span>
                    </div>

                    {/* 3. 완료처리 버튼 및 상태 배지 */}
                    <div className="flex items-center justify-end gap-1.5 w-[130px] shrink-0 ml-2">
                      <button onClick={(e) => handleForceComplete(e, item.type.includes('hw') && item.type !== 'hw_exam' ? 'hw' : 'exam', item.realId, currentView.studentId)} className="text-[9px] font-bold text-slate-600 hover:text-emerald-600 transition-colors bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm shrink-0">
                        ✅ 완료처리
                      </button>
                      <span className={`w-[52px] text-center px-1 py-0.5 rounded text-[9px] font-extrabold shrink-0 ${item.isCompleted ? 'bg-slate-100 text-slate-500' : 'bg-rose-50 text-rose-500 border border-rose-200'}`}>
                        {item.status || '미제출'}
                      </span>
                    </div>
                    
                    {/* 4. 수정 / 삭제 / 상세 버튼 */}
                    <div className="flex items-center justify-end gap-1.5 w-[120px] shrink-0 border-l border-slate-200 pl-3 ml-3">
                      {item.type !== 'exam' ? (
                         <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?${item.type.includes('hw') ? 'homework_id' : 'exam_id'}=${item.masterId}`, '_blank'); }} className="text-[13px] hover:text-blue-600 transition-colors shrink-0" title="수정">✏️</button>
                      ) : (
                         <div className="w-[13px] shrink-0"></div> /* 시험일 경우 줄맞춤을 위해 투명 블록 생성 */
                      )}
                      <button onClick={(e) => { 
                        e.stopPropagation(); 
                        if(item.type === 'exam' || item.type === 'hw_exam') handleDeleteExam(item.realId, currentView.studentId);
                        else if(item.type === 'hw') handleDeleteHomework(item.realId, currentView.studentId);
                        else if(item.type === 'print') handleDeletePrint(item.realId, item.masterId);
                      }} className="text-[13px] hover:text-rose-500 transition-colors shrink-0" title="삭제">🗑️</button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation(); 
                          window.location.href = item.type === 'hw' ? `/homework/review?homework_id=${item.realId}&student_id=${currentView.studentId}` : `/exam/review?assignment_id=${item.realId}`;
                        }}
                        className="text-[10px] font-bold text-white bg-[#002864] hover:bg-blue-900 px-2.5 py-1.5 rounded transition-colors shadow-sm shrink-0 ml-1"
                      >
                        상세/채점 ➔
                      </button>
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