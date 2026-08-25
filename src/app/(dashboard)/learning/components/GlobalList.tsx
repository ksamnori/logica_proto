// src/app/(dashboard)/learning/components/GlobalList.tsx
"use client";

import React from "react";

const unwrap = (obj: any) => Array.isArray(obj) ? obj[0] : obj;

interface GlobalListProps {
  currentView: any;
  activeTab: string;
  globalList: any[];
  isLoading: boolean;
  globalSelectedBlocks: string[];
  handleSelectAllGlobal: () => void;
  handleBulkCompleteGlobal: () => void;
  handleBulkDeleteGlobal: () => void;
  handleExtractCommonHomework: () => void; 
  handleViewChange: (view: any) => void;
  toggleGlobalSelection: (id: string) => void;
  formatDateLabel: (dateStr: string, includeTime?: boolean) => string;
  handleForceComplete: (e: React.MouseEvent, type: string, id: string, targetStudentId: string) => void;
  handleDeleteExam: (assignmentId: string, studentId: string) => void;
  handleDeleteHomework: (hwId: string, studentId: string) => void;
  handleDeletePrint: (assignmentId: string, examId: string) => void;
  handlePrintItem: (e: React.MouseEvent, type: string, masterId: any, targetQuestions?: any[], title?: string, subTitle?: string) => void; 
  handleEditHomeworkToStep2?: (e: React.MouseEvent, type: string, hwId: any, targetQuestions?: any[], title?: string, subTitle?: string, studentName?: string, studentId?: string, classId?: string) => void; 
  handleEditExamToStep2?: (e: React.MouseEvent, assignId: any, masterId: any, title: string, subTitle: string, studentName: string, studentId: string, classId: string, examType: string) => void; 
}

export default function GlobalList({
  currentView, activeTab, globalList, isLoading, globalSelectedBlocks, handleSelectAllGlobal,
  handleBulkCompleteGlobal, handleBulkDeleteGlobal, handleExtractCommonHomework, handleViewChange, toggleGlobalSelection,
  formatDateLabel, handleForceComplete, handleDeleteExam, handleDeleteHomework, handleDeletePrint, handlePrintItem, handleEditHomeworkToStep2, handleEditExamToStep2
}: GlobalListProps) {
  
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-[14px] font-extrabold text-slate-800 flex items-center gap-1.5">
              {currentView.type === 'CLASS' ? (
                <span className="text-[#002864]">📌 [{currentView.className}] 반 {activeTab === 'EXAM' ? '시험 목록' : activeTab === 'HOMEWORK' ? '과제 리스트' : '오답 프린트'}</span> 
              ) : (
                <span className="text-[#002864]">🌐 학원 전체 {activeTab === 'EXAM' ? '시험 목록' : activeTab === 'HOMEWORK' ? '과제 리스트' : '오답 프린트'}</span> 
              )}
            </h2>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">배부된 전체 목록을 최신순으로 확인하고 수정합니다.</p>
          </div>
        </div>

        <div className="flex justify-between items-center bg-white p-1.5 rounded-lg border border-slate-200 shadow-sm mt-0.5">
          <label className="flex items-center gap-1.5 cursor-pointer pl-1.5">
            <input type="checkbox" checked={globalList.length > 0 && globalSelectedBlocks.length === globalList.length} onChange={handleSelectAllGlobal} className="w-4 h-4 accent-rose-500" />
            <span className="text-[12px] font-bold text-slate-700">전체 선택</span>
          </label>
          <div className="flex items-center gap-1.5">
            {activeTab === 'HOMEWORK' && globalSelectedBlocks.length >= 2 && (
              <button onClick={handleExtractCommonHomework} className="px-3 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 font-bold text-[11px] transition-colors whitespace-nowrap shadow-sm mr-2 animate-pulse">
                🔗 공통 과제 분리
              </button>
            )}
            <button onClick={handleBulkCompleteGlobal} disabled={globalSelectedBlocks.length === 0} className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold text-[11px] transition-colors disabled:opacity-40 whitespace-nowrap">
              ✅ 선택 완료처리 ({globalSelectedBlocks.length})
            </button>
            <button onClick={handleBulkDeleteGlobal} disabled={globalSelectedBlocks.length === 0} className="px-2.5 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-bold text-[11px] transition-colors disabled:opacity-40 whitespace-nowrap">
              🗑️ 선택 삭제 ({globalSelectedBlocks.length})
            </button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scroll p-4 bg-slate-50/50">
        {isLoading ? (
          <div className="text-center font-bold text-slate-400 py-10 text-[12px]">전체 리스트를 불러오는 중입니다...</div>
        ) : globalList.length === 0 ? (
          <div className="text-center font-bold text-slate-400 py-10 text-[12px]">배부된 기록이 없습니다.</div>
        ) : (
          <div className="space-y-2.5 pb-20">
            {globalList.map((res: any, idx: number) => {
              const m = activeTab === 'HOMEWORK' && !res.is_exam_hw ? {} : unwrap(res.exam_master) || {};
              const hw = activeTab === 'HOMEWORK' && !res.is_exam_hw ? res.homework_assignment || {} : {};
              const studentName = activeTab === 'HOMEWORK' && !res.is_exam_hw ? (unwrap(res.student)?.name || '알수없음') : (unwrap(res.student)?.name || '알수없음');
              const className = activeTab === 'HOMEWORK' ? res.class_name : (unwrap(res.class)?.name || '반 미지정');
              
              const safeId = res.assignment_id || res.homework_id || `temp_${idx}`;
              const itemId = activeTab === 'EXAM' ? `exam_${safeId}_${res.student_id}` 
                           : activeTab === 'INCORRECT' ? `print_${safeId}_${res.student_id}`
                           : res.is_exam_hw ? `hw_exam_${safeId}_${res.student_id}` : `hw_${safeId}_${res.student_id}`;
              const isSelected = globalSelectedBlocks.includes(itemId);
              
              let statusStr = res.status || '미제출';
              const isCompleted = ['채점완료', '제출완료', '완료'].includes(statusStr); 

              let statusBadge = "bg-slate-100 text-slate-500";
              if(['미응시', '응시전', '미제출'].includes(statusStr)) statusBadge = "bg-rose-50 text-rose-500 border border-rose-100";
              else if(isCompleted) statusBadge = "bg-slate-300 text-slate-700 border border-slate-400";
              else statusBadge = "bg-amber-50 text-amber-600 border border-amber-100";

              let typeBadge = activeTab === 'EXAM' ? "📝 시험" : activeTab === 'INCORRECT' ? "🖨️ 오답프린트" : res.is_exam_hw ? "📝 문제지 과제" : "📚 교재 과제";
              let typeColor = activeTab === 'EXAM' ? "bg-blue-100 text-blue-700 border-blue-200" : activeTab === 'INCORRECT' ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200";
              let titleStr = activeTab === 'HOMEWORK' && !res.is_exam_hw ? hw.homework_title : m.title || '제목 없음';
              let totalQ = activeTab === 'HOMEWORK' ? res.totalQ : (m.title ? m.total_questions : 0);
              let createdDate = activeTab === 'HOMEWORK' ? (res.sort_date || res.created_at) : res.created_at;

              const rowBgClass = isSelected 
                ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' 
                : isCompleted 
                  ? 'bg-slate-200/60 border-slate-300 text-slate-600 hover:bg-slate-200/80' 
                  : 'bg-white border-slate-200 hover:border-[#002864]';

              // 🌟 [수정] 오답프린트(INCORRECT) 탭도 homework/review 페이지 레이아웃으로 라우팅되도록 변경
              let detailHref = '';
              if (activeTab === 'HOMEWORK' && !res.is_exam_hw) {
                detailHref = `/homework/review?homework_id=${hw.homework_id}&student_id=${res.student_id}`;
              } else if (res.is_exam_hw || activeTab === 'INCORRECT') {
                detailHref = `/homework/review?assignment_id=${res.assignment_id}&student_id=${res.student_id}&is_exam_hw=true`;
              } else {
                detailHref = `/exam/review?assignment_id=${res.assignment_id}`;
              }

              return (
                <div key={`${itemId}_${idx}`} onClick={() => toggleGlobalSelection(itemId)} className={`border-2 rounded-xl p-2 flex items-center justify-between gap-3 transition-all cursor-pointer shadow-sm ${rowBgClass}`}>
                  <div className="flex items-center gap-2 w-1/2 min-w-0 shrink-0 flex-1">
                    <input type="checkbox" checked={isSelected} readOnly className="w-4 h-4 accent-rose-500 pointer-events-none shrink-0" />
                    <div className="w-[85px] shrink-0 text-[10px] font-bold text-slate-400 leading-tight truncate">
                      {formatDateLabel(createdDate, true)}
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold border shrink-0 whitespace-nowrap ${typeColor}`}>{typeBadge}</span>
                    <span className="bg-[#002864] text-white text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 whitespace-nowrap">{className}</span>
                    <span className="text-[11px] font-bold text-slate-700 shrink-0 w-[50px] truncate">{studentName}</span>
                    <div className="flex-1 font-extrabold text-[12px] truncate" title={titleStr}>{titleStr}</div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0 justify-end w-[380px]">
                    <div className="text-[11px] font-bold text-slate-500 shrink-0 w-[50px] text-right whitespace-nowrap">총 {totalQ || 0}문항</div>
                    
                    <div className="flex flex-row flex-nowrap items-center gap-1.5 shrink-0 w-[120px] justify-center">
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-100 whitespace-nowrap shadow-sm">✅ {res.oCount || 0}</span>
                      <span className="text-[10px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded-md border border-rose-100 whitespace-nowrap shadow-sm">❌ {res.xCount || 0}</span>
                      {res.helpedCount > 0 && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-100 whitespace-nowrap shadow-sm" title="힌트 또는 조교 호출 도움을 받아 푼 문항 수">🧑‍🏫 {res.helpedCount}</span>}
                    </div>
                    
                    <div className="flex items-center gap-1.5 shrink-0 w-[110px] justify-end">
                      <button onClick={(e) => handleForceComplete(e, activeTab === 'HOMEWORK' && !res.is_exam_hw ? 'hw' : activeTab === 'INCORRECT' ? 'print' : 'exam', activeTab === 'HOMEWORK' && !res.is_exam_hw ? hw.homework_id : res.assignment_id, res.student_id)} className="text-[10px] font-bold text-slate-600 hover:text-emerald-600 transition-colors bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap shrink-0">
                        ✅ 완료처리
                      </button>
                      <span className={`w-[50px] text-center px-1 py-0.5 rounded text-[9px] font-extrabold whitespace-nowrap shrink-0 ${statusBadge}`}>{statusStr}</span>
                    </div>
                    
                    <div className="flex items-center gap-2 shrink-0 border-l border-slate-300 pl-3 w-[140px] justify-end">
                      {!(activeTab === 'HOMEWORK' && !res.is_exam_hw) ? (
                        <button onClick={(e) => handleEditExamToStep2?.(e, res.assignment_id, m?.exam_id, titleStr, res.subTitle, studentName, res.student_id, res.class_id, m?.exam_type)} className="text-[12px] hover:text-blue-600 transition-colors shrink-0 mr-0.5" title="문제 수정">✏️</button>
                      ) : (
                        <button onClick={(e) => handleEditHomeworkToStep2?.(e, res.type, hw.homework_id, res.target_questions || hw?.target_questions, titleStr, res.subTitle, studentName, res.student_id, res.class_id)} className="text-[12px] hover:text-blue-600 transition-colors shrink-0 mr-0.5" title="과제 문항 수정">✏️</button>
                      )}
                      
                      <button onClick={(e) => { e.stopPropagation(); activeTab === 'HOMEWORK' && !res.is_exam_hw ? handleDeleteHomework(hw.homework_id, res.student_id) : activeTab === 'INCORRECT' ? handleDeletePrint(res.assignment_id, m?.exam_id) : handleDeleteExam(res.assignment_id, res.student_id); }} className="text-[12px] hover:text-rose-500 transition-colors shrink-0 mr-0.5" title="삭제">🗑️</button>
                      
                      <button onClick={(e) => handlePrintItem(e, res.type, res.masterId, res.target_questions || hw.target_questions, titleStr, res.subTitle)} className="text-[13px] hover:text-emerald-600 transition-colors shrink-0 mx-0.5" title="프린트 출력">🖨️</button>

                      <button onClick={(e) => { e.stopPropagation(); window.location.href = detailHref; }} className="text-[10px] font-bold text-white bg-[#002864] hover:bg-blue-900 px-2 py-1 rounded transition-colors shadow-sm ml-0.5 shrink-0 whitespace-nowrap">상세 ➔</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}