// src/app/(dashboard)/learning/components/GlobalList.tsx
import React from "react";

// 공통 유틸리티 함수 (여기서 직접 사용하도록 선언)
const unwrap = (obj: any) => Array.isArray(obj) ? obj[0] : obj;

interface GlobalListProps {
  activeTab: string;
  globalList: any[];
  isLoading: boolean;
  globalSelectedBlocks: string[];
  handleSelectAllGlobal: () => void;
  handleBulkCompleteGlobal: () => void;
  handleBulkDeleteGlobal: () => void;
  handleViewChange: (view: any) => void;
  toggleGlobalSelection: (id: string) => void;
  formatDateLabel: (dateStr: string, includeTime?: boolean) => string;
  handleForceComplete: (e: React.MouseEvent, type: string, id: string, targetStudentId: string) => void;
  handleDeleteExam: (assignmentId: string, studentId: string) => void;
  handleDeleteHomework: (hwId: string, studentId: string) => void;
  handleDeletePrint: (assignmentId: string, examId: string) => void;
}

export default function GlobalList({
  activeTab,
  globalList,
  isLoading,
  globalSelectedBlocks,
  handleSelectAllGlobal,
  handleBulkCompleteGlobal,
  handleBulkDeleteGlobal,
  handleViewChange,
  toggleGlobalSelection,
  formatDateLabel,
  handleForceComplete,
  handleDeleteExam,
  handleDeleteHomework,
  handleDeletePrint
}: GlobalListProps) {
  
  return (
    <>
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 shrink-0 shadow-sm z-10 flex flex-col gap-2.5">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-base font-extrabold text-slate-800 flex items-center gap-1.5">
              <span className="text-[#002864]">🌐 학원 전체 {activeTab === 'EXAM' ? '시험 목록' : activeTab === 'HOMEWORK' ? '과제 리스트' : '오답 프린트'}</span> 
            </h2>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">배부된 전체 목록을 최신순으로 확인하고 수정합니다.</p>
          </div>
          <button onClick={() => handleViewChange({ type: 'ALL', classId: '', className: '', studentId: '', studentName: '' })} className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-100 rounded-lg text-[12px] font-bold text-slate-600 transition-colors shadow-sm">
            돌아가기 ↺
          </button>
        </div>

        <div className="flex justify-between items-center bg-white p-1.5 rounded-lg border border-slate-200 shadow-sm mt-0.5">
          <label className="flex items-center gap-1.5 cursor-pointer pl-1.5">
            <input type="checkbox" checked={globalList.length > 0 && globalSelectedBlocks.length === globalList.length} onChange={handleSelectAllGlobal} className="w-4 h-4 accent-rose-500" />
            <span className="text-[12px] font-bold text-slate-700">전체 선택</span>
          </label>
          <div className="flex items-center gap-1.5">
            <button onClick={handleBulkCompleteGlobal} disabled={globalSelectedBlocks.length === 0} className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold text-[11px] transition-colors disabled:opacity-40">
              ✅ 선택 완료처리 ({globalSelectedBlocks.length})
            </button>
            <button onClick={handleBulkDeleteGlobal} disabled={globalSelectedBlocks.length === 0} className="px-2.5 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-bold text-[11px] transition-colors disabled:opacity-40">
              🗑️ 선택 삭제 ({globalSelectedBlocks.length})
            </button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scroll p-5 bg-slate-50/50">
        {isLoading ? (
          <div className="text-center font-bold text-slate-400 py-10 text-[12px]">전체 리스트를 불러오는 중입니다...</div>
        ) : globalList.length === 0 ? (
          <div className="text-center font-bold text-slate-400 py-10 text-[12px]">배부된 기록이 없습니다.</div>
        ) : (
          <div className="space-y-2.5 pb-20">
            
            {activeTab === 'EXAM' && globalList.map((res: any, idx: number) => {
              const m = unwrap(res.exam_master) || {};
              const studentName = unwrap(res.student)?.name || '알수없음';
              const className = unwrap(res.class)?.name || '반 미지정';
              const itemId = `exam_${res.assignment_id}_${res.student_id}`;
              const isSelected = globalSelectedBlocks.includes(itemId);
              
              let statusBadge = "bg-slate-100 text-slate-500";
              if(res.status === '미응시' || res.status === '응시전') statusBadge = "bg-rose-50 text-rose-500 border border-rose-100";
              else if(res.status === '채점완료' || res.status === '제출완료' || res.status === '완료') statusBadge = "bg-emerald-50 text-emerald-600 border border-emerald-100";
              else statusBadge = "bg-amber-50 text-amber-600 border border-amber-100";

              return (
                <div key={itemId} onClick={() => toggleGlobalSelection(itemId)} className={`bg-white border-2 rounded-xl p-2.5 flex items-center justify-between gap-3 transition-all cursor-pointer shadow-sm ${isSelected ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' : 'border-slate-200 hover:border-[#002864]'}`}>
                  <div className="flex items-center gap-2.5 w-1/2 min-w-0 shrink-0 flex-1">
                    <input type="checkbox" checked={isSelected} readOnly className="w-4 h-4 accent-rose-500 pointer-events-none shrink-0" />
                    <div className="w-[80px] shrink-0 text-[10px] font-bold text-slate-400 leading-tight">
                      {formatDateLabel(res.created_at, false)}
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold border shrink-0 bg-blue-100 text-blue-700 border-blue-200">📝 시험</span>
                    <span className="bg-[#002864] text-white text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0">{className}</span>
                    <span className="text-[11px] font-bold text-slate-700 shrink-0 w-[50px] truncate">{studentName}</span>
                    <div className="flex-1 font-extrabold text-slate-800 text-[13px] truncate" title={m.title || '제목 없음'}>
                      {m.title || '제목 없음'}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 justify-end w-1/2">
                    <div className="text-[10px] font-bold text-slate-500 shrink-0 w-[50px] text-right">총 {m.total_questions || 0}문항</div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">✅ {res.oCount}</span>
                      <span className="text-[10px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">❌ {res.xCount}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 w-[120px] justify-end">
                      <button onClick={(e) => handleForceComplete(e, 'exam', res.assignment_id, res.student_id)} className="text-[9px] font-bold text-slate-600 hover:text-emerald-600 transition-colors flex items-center gap-1 bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm">
                        ✅ 완료처리
                      </button>
                      <span className={`w-[50px] text-center px-1 py-0.5 rounded text-[9px] font-extrabold ${statusBadge}`}>
                        {res.status || '대기'}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-1.5 shrink-0 border-l border-slate-200 pl-2">
                      <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?id=${m.exam_id}&exam_id=${m.exam_id}`, '_blank'); }} className="text-[11px] hover:text-blue-600 transition-colors" title="수정">✏️</button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteExam(res.assignment_id, res.student_id); }} className="text-[11px] hover:text-rose-500 transition-colors" title="삭제">🗑️</button>
                      <button onClick={(e) => { e.stopPropagation(); window.location.href = `/exam/review?assignment_id=${res.assignment_id}`; }} className="text-[10px] font-bold text-white bg-[#002864] hover:bg-blue-900 px-2 py-1 rounded transition-colors shadow-sm ml-0.5">상세/수정 ➔</button>
                    </div>
                  </div>
                </div>
              );
            })}

            {activeTab === 'HOMEWORK' && globalList.map((res: any, idx: number) => {
              const itemId = res.is_exam_hw ? `hw_exam_${res.assignment_id}_${res.student_id}` : `hw_${res.homework_id}_${res.student_id}`;
              const isSelected = globalSelectedBlocks.includes(itemId);

              if (res.is_exam_hw) {
                const m = unwrap(res.exam_master) || {};
                const studentName = unwrap(res.student)?.name || '알수없음';
                const className = res.class_name;
                
                let statusBadge = "bg-slate-100 text-slate-500";
                if(res.status === '미응시' || res.status === '응시전') statusBadge = "bg-rose-50 text-rose-500 border border-rose-100";
                else if(res.status === '채점완료' || res.status === '제출완료') statusBadge = "bg-emerald-50 text-emerald-600 border border-emerald-100";
                else statusBadge = "bg-amber-50 text-amber-600 border border-amber-100";

                return (
                  <div key={itemId} onClick={() => toggleGlobalSelection(itemId)} className={`bg-white border-2 rounded-xl p-2.5 flex items-center justify-between gap-3 transition-all cursor-pointer shadow-sm ${isSelected ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' : 'border-slate-200 hover:border-[#002864]'}`}>
                    <div className="flex items-center gap-2.5 w-1/2 min-w-0 shrink-0 flex-1">
                      <input type="checkbox" checked={isSelected} readOnly className="w-4 h-4 accent-rose-500 pointer-events-none shrink-0" />
                      <div className="w-[80px] shrink-0 text-[10px] font-bold text-slate-400 leading-tight">
                        {formatDateLabel(res.sort_date || res.created_at, false)}
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold border shrink-0 bg-amber-100 text-amber-700 border-amber-200">📝 문제지 과제</span>
                      <span className="bg-[#002864] text-white text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0">{className}</span>
                      <span className="text-[11px] font-bold text-slate-700 shrink-0 w-[50px] truncate">{studentName}</span>
                      <div className="flex-1 font-extrabold text-slate-800 text-[13px] truncate" title={m.title || '제목 없음'}>
                        {m.title || '제목 없음'}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0 justify-end w-1/2">
                      <div className="text-[12px] font-bold text-slate-500 shrink-0 w-[60px] text-right">총 {res.totalQ}문항</div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">✅ {res.oCount}</span>
                        <span className="text-[11px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">❌ {res.xCount}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 w-[140px] justify-end">
                        <button onClick={(e) => handleForceComplete(e, 'exam', res.assignment_id, res.student_id)} className="text-[10px] font-bold text-slate-600 hover:text-emerald-600 transition-colors flex items-center gap-1 bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm">
                          ✅ 완료처리
                        </button>
                        <span className={`w-[56px] text-center px-1.5 py-0.5 rounded text-[10px] font-extrabold ${statusBadge}`}>
                          {res.status || '미제출'}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 shrink-0 border-l border-slate-200 pl-2">
                        <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?id=${m.exam_id}&exam_id=${m.exam_id}`, '_blank'); }} className="text-[13px] hover:text-blue-600 transition-colors" title="수정">✏️</button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteExam(res.assignment_id, res.student_id); }} className="text-[13px] hover:text-rose-500 transition-colors" title="삭제">🗑️</button>
                        <button onClick={(e) => { e.stopPropagation(); window.location.href = `/exam/review?assignment_id=${res.assignment_id}`; }} className="text-[11px] font-bold text-white bg-[#002864] hover:bg-blue-900 px-3 py-1.5 rounded transition-colors shadow-sm ml-1">상세/채점 ➔</button>
                      </div>
                    </div>
                  </div>
                );
              } else {
                const hw = res.homework_assignment || {};
                const studentName = unwrap(res.student)?.name || '알수없음';
                const className = res.class_name;
                
                let statusStr = res.status || '미제출';
                let statusBadge = "bg-slate-100 text-slate-500";
                if(statusStr === '미제출') statusBadge = "bg-rose-50 text-rose-500 border border-rose-100";
                else if(statusStr === '진행중') statusBadge = "bg-amber-50 text-amber-600 border border-amber-100";
                else statusBadge = "bg-emerald-50 text-emerald-600 border border-emerald-100";
                
                return (
                  <div key={itemId} onClick={() => toggleGlobalSelection(itemId)} className={`bg-white border-2 rounded-xl p-2.5 flex items-center justify-between gap-3 transition-all cursor-pointer shadow-sm ${isSelected ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' : 'border-slate-200 hover:border-[#002864]'}`}>
                    <div className="flex items-center gap-2.5 w-1/2 min-w-0 shrink-0 flex-1">
                      <input type="checkbox" checked={isSelected} readOnly className="w-4 h-4 accent-rose-500 pointer-events-none shrink-0" />
                      <div className="w-[80px] shrink-0 text-[10px] font-bold text-slate-400 leading-tight">
                        {formatDateLabel(res.sort_date || res.created_at, false)}
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold border shrink-0 bg-amber-100 text-amber-700 border-amber-200">📚 교재 과제</span>
                      <span className="bg-[#002864] text-white text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0">{className}</span>
                      <span className="text-[11px] font-bold text-slate-700 shrink-0 w-[50px] truncate">{studentName}</span>
                      <div className="flex-1 font-extrabold text-slate-800 text-[13px] truncate" title={hw.homework_title}>
                        {hw.homework_title}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 justify-end w-1/2">
                      <div className="text-[10px] font-bold text-slate-500 shrink-0 w-[50px] text-right">총 {res.totalQ}문항</div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">✅ {res.oCount}</span>
                        <span className="text-[10px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">❌ {res.xCount}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 w-[120px] justify-end">
                        <button onClick={(e) => handleForceComplete(e, 'hw', hw.homework_id, res.student_id)} className="text-[9px] font-bold text-slate-600 hover:text-emerald-600 transition-colors bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm">
                          ✅ 완료처리
                        </button>
                        <span className={`w-[50px] text-center px-1 py-0.5 rounded text-[9px] font-extrabold ${statusBadge}`}>
                          {statusStr}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 shrink-0 border-l border-slate-200 pl-2">
                        <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?homework_id=${hw.homework_id}`, '_blank'); }} className="text-[13px] hover:text-blue-600 transition-colors" title="수정">✏️</button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteHomework(hw.homework_id, res.student_id); }} className="text-[13px] hover:text-rose-500 transition-colors" title="삭제">🗑️</button>
                        <button onClick={(e) => { e.stopPropagation(); window.location.href = `/homework/review?homework_id=${hw.homework_id}&student_id=${res.student_id}`; }} className="text-[10px] font-bold text-white bg-[#002864] hover:bg-blue-900 px-2 py-1 rounded transition-colors shadow-sm ml-0.5">상세/채점 ➔</button>
                      </div>
                    </div>
                  </div>
                );
              }
            })}

            {activeTab === 'INCORRECT' && globalList.map((p: any, idx: number) => {
              const studentName = unwrap(p.student)?.name || '알수없음';
              const m = unwrap(p.exam_master);
              const qCount = m?.total_questions || 0;
              const statusBadge = p.status === '미응시' ? 'bg-rose-50 text-rose-500 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100';
              const className = unwrap(p.class)?.name || '반 미지정';
              
              const itemId = `print_${p.assignment_id}_${p.student_id}`;
              const isSelected = globalSelectedBlocks.includes(itemId);

              return (
                <div key={itemId} onClick={() => toggleGlobalSelection(itemId)} className={`bg-white border-2 rounded-xl p-2.5 flex items-center justify-between gap-3 transition-all cursor-pointer shadow-sm ${isSelected ? 'border-rose-400 bg-rose-50/30 shadow-rose-100' : 'border-slate-200 hover:border-[#002864]'}`}>
                  <div className="flex items-center gap-2.5 w-1/2 min-w-0 shrink-0 flex-1">
                    <input type="checkbox" checked={isSelected} readOnly className="w-4 h-4 accent-rose-500 pointer-events-none shrink-0" />
                    <div className="w-[80px] shrink-0 text-[10px] font-bold text-slate-400 leading-tight">
                      {formatDateLabel(p.created_at, false)}
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold border shrink-0 bg-emerald-100 text-emerald-700 border-emerald-200">🖨️ 오답프린트</span>
                    <span className="bg-[#002864] text-white text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0">{className}</span>
                    <span className="text-[11px] font-bold text-slate-700 shrink-0 w-[50px] truncate">{studentName}</span>
                    <div className="flex-1 font-extrabold text-slate-800 text-[13px] truncate" title={m?.title || '제목 없음'}>
                      {m?.title || '제목 없음'}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 justify-end w-1/2">
                    <div className="text-[10px] font-bold text-slate-500 shrink-0 w-[50px] text-right">총 {qCount}문항</div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">✅ {p.oCount}</span>
                      <span className="text-[10px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">❌ {p.xCount}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 w-[120px] justify-end">
                      <button onClick={(e) => handleForceComplete(e, 'print', p.assignment_id, p.student_id)} className="text-[9px] font-bold text-slate-600 hover:text-emerald-600 transition-colors flex items-center gap-1 bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm">
                        ✅ 완료처리
                      </button>
                      <span className={`w-[50px] text-center px-1 py-0.5 rounded text-[9px] font-extrabold ${statusBadge}`}>
                        {p.status || '미응시'}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-1.5 shrink-0 border-l border-slate-200 pl-2">
                      <button onClick={(e) => { e.stopPropagation(); window.open(`/exam/viewer?exam_id=${m?.exam_id}`, '_blank'); }} className="text-[13px] hover:text-blue-600 transition-colors" title="수정">✏️</button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeletePrint(p.assignment_id, unwrap(p.exam_master)?.exam_id); }} className="text-[13px] hover:text-rose-500 transition-colors" title="삭제">🗑️</button>
                      <button onClick={(e) => { e.stopPropagation(); window.location.href = `/exam/review?assignment_id=${p.assignment_id}`; }} className="text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-1 rounded shadow-sm transition-colors ml-0.5">프린트 채점 ➔</button>
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