// src/components/exam/ViewerSidebar.tsx
"use client";

import React from "react";
import PublishPanel from "@/components/exam/PublishPanel";
import WeekPickerCalendar from "@/components/exam/WeekPickerCalendar";
import { addDaysKST } from "@/lib/classRound";

interface ViewerSidebarProps {
  isSidebarFolded: boolean;
  setIsSidebarFolded: (v: boolean) => void;
  isAdmissionLock: boolean;
  titleMode: string;
  template: string;
  colorNum: string;
  colorTitle: string;
  colorLine: string;
  palette: string[];
  columns: number;
  splits: number;
  examTitle: string;
  displayBadge: string;
  examDate: string;
  layoutType: string;
  testDate: string;
  isWeekPopupOpen: boolean;
  setIsWeekPopupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  savedExamId: string | null;
  weeklyTargetGrade: string;
  isSaving: boolean;
  isGeneratingPdf: boolean;
  handleSettingChange: (field: string, val: any) => void;
  savePalette: (hex: string, idx: number, e: React.MouseEvent) => void;
  handleWeekDateSelect: (d: string) => void;
  handleWeeklyMetaChange: (grade: string) => void;
  setIsExamDistributed: (v: boolean) => void;
  saveExam: (skipNav: boolean) => Promise<boolean>;
  handlePrint: () => void;
  downloadPdfViaServer: () => void;
}

const getMonthWeekLabel = (dateStr: string) => {
  const dayNum = new Date(dateStr + 'T00:00:00Z').getUTCDay() || 7; 
  const thursday = addDaysKST(dateStr, 4 - dayNum);
  const d = new Date(thursday + 'T00:00:00Z');
  const month = d.getUTCMonth() + 1;
  const weekOfMonth = Math.ceil(d.getUTCDate() / 7);
  return `${month}월 ${weekOfMonth}주차`;
};

export default function ViewerSidebar({
  isSidebarFolded, setIsSidebarFolded, isAdmissionLock, titleMode, template,
  colorNum, colorTitle, colorLine, palette, columns, splits, examTitle, displayBadge,
  examDate, layoutType, testDate, isWeekPopupOpen, setIsWeekPopupOpen, savedExamId,
  weeklyTargetGrade, isSaving, isGeneratingPdf, handleSettingChange, savePalette,
  handleWeekDateSelect, handleWeeklyMetaChange, setIsExamDistributed, saveExam,
  handlePrint, downloadPdfViaServer
}: ViewerSidebarProps) {
  
  return (
    <aside className={`no-print shrink-0 h-full bg-slate-50 border-slate-300 transition-all duration-500 ease-in-out z-20 overflow-hidden flex flex-col border-r ${isSidebarFolded ? 'w-0 opacity-0 border-r-0' : 'w-[720px] opacity-100'}`}>
      <div className="w-[720px] h-full flex flex-col">
        
        <div className="p-4 bg-white border-b border-slate-200 flex justify-between items-center shrink-0 sticky top-0 z-10">
            <span className="font-extrabold text-slate-800 text-lg flex items-center gap-2">⚙️ 설정 및 배포 관리</span>
            <button onClick={() => setIsSidebarFolded(true)} className="text-slate-400 hover:text-[#002864] text-xs font-bold flex items-center gap-1 transition-colors">
                ◀ 설정 접기
            </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4 items-start">
           <div className="w-full flex gap-4 items-stretch">
              
              {/* 왼쪽 단: 템플릿 및 레이아웃 설정 */}
              <div className="w-1/2 flex flex-col">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col gap-4">
                  <h3 className="font-bold text-slate-700 border-b pb-2 flex items-center gap-1.5 text-[13px] shrink-0">🎨 템플릿 및 레이아웃 설정</h3>
                  
                  <div className="flex flex-col gap-4">
                      <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1.5">제목 표시 모드</label>
                          <div className="flex gap-2">
                              <button onClick={() => handleSettingChange('titleMode', 'first')} className={`flex-1 px-2 py-1.5 rounded border font-bold text-[11px] ${titleMode === 'first' ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'} ${isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}`}>첫 장만 표시</button>
                              <button onClick={() => handleSettingChange('titleMode', 'all')} className={`flex-1 px-2 py-1.5 rounded border font-bold text-[11px] ${titleMode === 'all' ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'} ${isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}`}>전체 표시</button>
                          </div>
                      </div>
                      <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1.5">디자인 템플릿</label>
                          <select value={isAdmissionLock ? '입학테스트' : template} onChange={e => handleSettingChange('template', e.target.value)} className={`w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold text-slate-700 bg-white focus:outline-none focus:border-[#002864] ${isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}`}>
                              <option value="basic1">기본1 (좌측 여백 활용)</option>
                              <option value="basic2">기본2 (슬림 헤더, 하단 라벨)</option>
                              {isAdmissionLock && <option value="입학테스트">입학테스트 전용</option>}
                          </select>
                      </div>
                      <div className={isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1.5">색상 설정 (미리보기 즉시 반영)</label>
                          <div className="space-y-2 border border-slate-100 p-2 rounded bg-slate-50/50">
                              <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5"><span className="text-[11px] text-slate-600 font-bold">번호 색상</span>
                                      <div className="flex gap-1">{palette.map((p,i) => <button key={i} onClick={() => handleSettingChange('colorNum', p)} onContextMenu={(e) => savePalette(colorNum, i, e)} className="w-3.5 h-3.5 rounded-full border border-slate-300" style={{background:p}}/>)}</div>
                                  </div>
                                  <input type="color" value={colorNum} onChange={e => handleSettingChange('colorNum', e.target.value)} className="w-6 h-5 rounded cursor-pointer p-0 border-0" />
                              </div>
                              <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5"><span className="text-[11px] text-slate-600 font-bold">제목 색상</span>
                                      <div className="flex gap-1">{palette.map((p,i) => <button key={i} onClick={() => handleSettingChange('colorTitle', p)} onContextMenu={(e) => savePalette(colorTitle, i, e)} className="w-3.5 h-3.5 rounded-full border border-slate-300" style={{background:p}}/>)}</div>
                                  </div>
                                  <input type="color" value={colorTitle} onChange={e => handleSettingChange('colorTitle', e.target.value)} className="w-6 h-5 rounded cursor-pointer p-0 border-0" />
                              </div>
                              <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5"><span className="text-[11px] text-slate-600 font-bold">라인 색상</span>
                                      <div className="flex gap-1">{palette.map((p,i) => <button key={i} onClick={() => handleSettingChange('colorLine', p)} onContextMenu={(e) => savePalette(colorLine, i, e)} className="w-3.5 h-3.5 rounded-full border border-slate-300" style={{background:p}}/>)}</div>
                                  </div>
                                  <input type="color" value={colorLine} onChange={e => handleSettingChange('colorLine', e.target.value)} className="w-6 h-5 rounded cursor-pointer p-0 border-0" />
                              </div>
                          </div>
                      </div>
                      <div className="flex gap-4">
                          <div className="flex-1">
                              <label className="block text-[11px] font-bold text-slate-500 mb-1.5">단 구성</label>
                              <div className="flex gap-1">
                                  <button onClick={() => handleSettingChange('column', 1)} className={`flex-1 py-1.5 rounded border font-bold text-[11px] ${columns === 1 ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500'} ${isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}`}>1단</button>
                                  <button onClick={() => handleSettingChange('column', 2)} className={`flex-1 py-1.5 rounded border font-bold text-[11px] ${columns === 2 ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500'} ${isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}`}>2단</button>
                              </div>
                          </div>
                          <div className="flex-1">
                              <label className="block text-[11px] font-bold text-slate-500 mb-1.5">분할 설정</label>
                              <div className="flex gap-1">
                                  {[2,4,6].map(num => (
                                    <button key={num} onClick={() => handleSettingChange('split', num)} className={`flex-1 py-1.5 rounded border font-bold text-[11px] ${splits === num ? 'border-[#002864] bg-blue-50 text-[#002864]' : 'border-slate-200 text-slate-500'} ${isAdmissionLock ? 'opacity-40 pointer-events-none' : ''}`}>{num}</button>
                                  ))}
                              </div>
                          </div>
                      </div>
                  </div>
                </div>
              </div>

              {/* 오른쪽 단: 시험지 메타 수정 */}
              <div className="w-1/2 flex flex-col">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col gap-4">
                  <h3 className="font-bold text-slate-700 border-b pb-2 flex items-center gap-1.5 text-[13px] shrink-0">✏️ 시험지 메타 수정</h3>
                  
                  <div className="flex-1 flex flex-col gap-4">
                      <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1.5">시험지 제목</label>
                          <input type="text" value={examTitle} onChange={e => handleSettingChange('examTitle', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold focus:border-[#002864] focus:outline-none" />
                      </div>
                      <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1.5">학년 / 과정 표기</label>
                          <input type="text" value={displayBadge} onChange={e => handleSettingChange('displayBadge', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold focus:border-[#002864] focus:outline-none" />
                      </div>
                      <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1.5">날짜</label>
                          <div className="flex flex-col gap-2">
                              <input type="date" value={examDate} onChange={e => handleSettingChange('examDate', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold focus:border-[#002864] focus:outline-none" />
                              <div className="flex gap-2">
                                  <button onClick={() => handleSettingChange('examDate', new Date().toISOString().split('T')[0])} className="flex-1 py-1 bg-slate-50 border border-slate-200 rounded font-bold text-[11px] text-slate-600 hover:bg-slate-100 transition-colors">오늘 날짜</button>
                                  <button onClick={() => handleSettingChange('examDate', '')} className="flex-1 py-1 bg-slate-50 border border-slate-200 rounded font-bold text-[11px] text-slate-400 hover:bg-slate-100 transition-colors">지우기</button>
                              </div>
                          </div>
                      </div>
                      <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1.5">프린트 양식</label>
                          <select value={layoutType} onChange={e => handleSettingChange('layoutType', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold focus:border-[#002864] focus:outline-none">
                              <option value="선택없음">선택없음</option>
                              <option value="과제프린트">과제프린트</option>
                              <option value="오답프린트">오답프린트</option>
                              <option value="주간테스트">주간테스트</option>
                              <option value="중간평가">중간평가</option>
                              <option value="분기평가">분기평가</option>
                              <option value="입학테스트">입학테스트</option>
                          </select>
                      </div>
                      {layoutType === '주간테스트' && (
                          <div>
                              <label className="block text-[11px] font-bold text-slate-500 mb-1.5">주차 (달력에서 날짜 선택 → ISO 주차 자동 계산, 전원 공통)</label>
                              <div className="flex items-center gap-2">
                                  <span className="shrink-0 text-[11px] font-bold text-[#002864] bg-[#EEF6FF] border border-blue-100 rounded px-2 py-1.5">{getMonthWeekLabel(testDate)}</span>
                                  <div className="relative flex-1">
                                      <button type="button" onClick={() => setIsWeekPopupOpen(v => !v)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-[11px] font-bold text-left bg-white hover:bg-slate-50">
                                          📅 주차 선택하기
                                      </button>
                                      {isWeekPopupOpen && (
                                          <>
                                              <div className="fixed inset-0 z-40" onClick={() => setIsWeekPopupOpen(false)} />
                                              <div className="absolute z-50 mt-2 left-0 w-full">
                                                  <WeekPickerCalendar selectedDate={testDate} onSelect={handleWeekDateSelect} />
                                              </div>
                                          </>
                                      )}
                                  </div>
                              </div>
                          </div>
                      )}
                  </div>
                </div>
              </div>
           </div>

           {/* 하단 전체 너비: 분리된 배포 관리 패널 호출 (주간테스트일 땐 학년 배정 UI도 여기 포함) */}
           <div className="w-full mb-8 mt-4">
              <PublishPanel
                examId={savedExamId}
                layoutType={layoutType}
                initialTargetGrade={weeklyTargetGrade}
                onWeeklyMetaChange={handleWeeklyMetaChange}
                onPublishComplete={() => setIsExamDistributed(true)}
              />
           </div>
        </div>

        <div className="p-4 bg-white border-t border-slate-200 shrink-0 flex gap-2">
          <button onClick={() => saveExam(false)} disabled={isSaving} className="flex-1 bg-slate-600 hover:bg-slate-700 text-white py-2 rounded-lg font-bold text-[13px] shadow-sm transition-colors flex justify-center items-center gap-1.5 disabled:opacity-50">
            <span>💾</span> {isSaving ? "저장 중..." : "저장"}
          </button>
          <button onClick={handlePrint} disabled={isSaving} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-bold text-[13px] shadow-sm transition-colors flex justify-center items-center gap-1.5 disabled:opacity-50">
            <span>🖨️</span> 인쇄
          </button>
          <button onClick={downloadPdfViaServer} disabled={isSaving || isGeneratingPdf} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg font-bold text-[13px] shadow-sm transition-colors flex justify-center items-center gap-1.5 disabled:opacity-50">
            <span>⬇️</span> {isGeneratingPdf ? "추출 중..." : "PDF"}
          </button>
        </div>
      </div>
    </aside>
  );
}