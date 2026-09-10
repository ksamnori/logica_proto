// src/app/(dashboard)/taxonomy-editor/page.tsx
"use client";

import React from "react";
import { useTaxonomy } from "./useTaxonomy";
import { formatQNum, getCleanUrl } from "./taxonomyUtils";

export default function TaxonomyEditorPage() {
  const {
    isAuthorized, perms, isTaxonomyLoading, workbooks, selectedBook, questions, selectedQuestion, isLoading,
    isEditingContent, editForm, cropImageSrc, cropTargetField, hasCropArea, imgRef, selectionBoxRef,
    selD1, selD2, selD3, selD4, selD5, selD6, selD7, selD8,
    isGeneratingTwins, generatedTwins, isTwinModalOpen, isCloneModalOpen, cloneForm, twinTargetBook, similarTargetBook,
    isFixingLatex, // 🌟 추가됨
    d1Options, d2Options, d3Options, d4Options, d5Options, d6Options, d7Options, d8Options, finalCalculatedTaxId,
    normalRoots, trueOrphans, getDescendants,
    setSelectedBook, setEditForm, setIsEditingContent, setCropImageSrc, setCropTargetField, setHasCropArea,
    setSelD8, setIsTwinModalOpen, setCloneForm, setIsCloneModalOpen, setTwinTargetBook, setSimilarTargetBook,
    handleRenameBook, fetchQuestions, getKoreanPath, handleAutoFillTaxonomy, handleD1Change, handleD2Change, handleD3Change, handleD4Change, handleD5Change, handleD6Change, handleD7Change,
    handleQuestionClick, saveTaxonomy, createNewQuestion, deleteQuestion, executeClone, handleImageInput, handlePaste, handleDrop, handleCropMouseDown, handleCropMouseMove, handleCropMouseUp, handleCropUpload,
    saveQuestionContent, handleGenerateTwins, saveTwinsToDB, handleTwinChange, handleFixLatex // 🌟 추가됨
  } = useTaxonomy();

  const renderImageBox = (label: string, fieldKey: string, colorTheme: 'indigo' | 'emerald') => {
    const rawValue = editForm[fieldKey as keyof typeof editForm] as string;
    const displayUrl = getCleanUrl(rawValue); 
    const colorClasses = colorTheme === 'indigo' ? "border-indigo-300 bg-indigo-50/30 hover:bg-indigo-50 focus:ring-indigo-500 text-indigo-800" : "border-emerald-300 bg-emerald-50/30 hover:bg-emerald-50 focus:ring-emerald-500 text-emerald-800";
    
    return (
      <div className="flex flex-col gap-1.5 bg-white p-3 rounded-xl border border-slate-200 shadow-sm relative">
        <label className="text-xs font-bold text-slate-500 flex justify-between items-center mb-1">
          <span>{label}</span>
          {rawValue && (
            <div className="flex items-center gap-2">
              <a href={displayUrl} target="_blank" className="text-blue-500 hover:text-blue-700 underline tracking-tighter" rel="noreferrer">원본 보기 ↗</a>
              <span className="text-slate-200">|</span>
              <button type="button" onClick={() => setEditForm({ ...editForm, [fieldKey]: '' })} className="text-rose-500 hover:text-rose-700 underline tracking-tighter">삭제 🗑️</button>
            </div>
          )}
        </label>
        <div 
          onDrop={(e) => handleDrop(e, fieldKey)} onDragOver={(e) => e.preventDefault()} onPaste={(e) => handlePaste(e, fieldKey)} tabIndex={0}
          className={`w-full h-28 border-2 border-dashed rounded-lg text-center cursor-pointer focus:ring-2 outline-none transition-all flex flex-col items-center justify-center relative group overflow-hidden ${colorClasses}`}
          onClick={() => { setCropTargetField(fieldKey); document.getElementById('globalFileInput')?.click(); }}
        >
          {rawValue && <img src={displayUrl} className="absolute inset-0 w-full h-full object-contain opacity-30 group-hover:opacity-10 transition-opacity" alt="" />}
          <span className="text-2xl mb-1 relative z-10 group-hover:scale-110 transition-transform">📸</span>
          <span className="text-[10px] font-bold relative z-10">클릭, 드래그 또는 붙여넣기(Ctrl+V)</span>
        </div>
        <input type="text" value={rawValue} onChange={e => setEditForm({ ...editForm, [fieldKey]: e.target.value })} className="w-full p-2 border border-slate-200 rounded-lg focus:border-blue-400 outline-none text-[10px] text-slate-500 bg-slate-50 mt-1" placeholder="직접 URL 입력..." />
      </div>
    );
  };

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden relative">
      
      <input id="globalFileInput" type="file" accept="image/*" onChange={(e) => { if(e.target.files?.[0] && cropTargetField) handleImageInput(e.target.files[0], cropTargetField); e.target.value = ''; }} className="hidden" />

      {/* 문항 복제 모달 */}
      {isCloneModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 flex flex-col items-center justify-center p-6 animate-in fade-in backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
            <div className="p-5 bg-gradient-to-r from-emerald-600 to-teal-600 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-black text-white flex items-center gap-2">
                  <span>📋</span> 문항 복제 (다른 교재로)
                </h2>
              </div>
              <button onClick={() => setIsCloneModalOpen(false)} className="text-white hover:text-emerald-200 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors">
                닫기 ✕
              </button>
            </div>
            
            <div className="p-6 flex flex-col gap-5 bg-slate-50">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500">타겟 교재 이름 (기존 선택 또는 새 이름 입력)</label>
                <input 
                  type="text" 
                  list="workbook-options"
                  value={cloneForm.targetBookName} 
                  onChange={(e) => setCloneForm(prev => ({...prev, targetBookName: e.target.value}))} 
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-emerald-500 outline-none shadow-sm bg-white" 
                  placeholder="새로운 교재 이름 입력..."
                />
                <datalist id="workbook-options">
                  {workbooks.map(b => <option key={b} value={b} />)}
                </datalist>
              </div>
              
              <div className="flex gap-4">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-xs font-bold text-slate-500">새 페이지 번호</label>
                  <input 
                    type="number" 
                    value={cloneForm.pageNumber} 
                    onChange={(e) => setCloneForm(prev => ({...prev, pageNumber: e.target.value}))} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-emerald-500 outline-none shadow-sm bg-white" 
                    placeholder="ex) 12"
                  />
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-xs font-bold text-slate-500">새 문항 번호</label>
                  <input 
                    type="text" 
                    value={cloneForm.questionNumber} 
                    onChange={(e) => setCloneForm(prev => ({...prev, questionNumber: e.target.value}))} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-emerald-500 outline-none shadow-sm bg-white" 
                    placeholder="ex) 15"
                  />
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-xs font-bold text-slate-500">새 서브 번호</label>
                  <input 
                    type="number" 
                    value={cloneForm.subNumber} 
                    onChange={(e) => setCloneForm(prev => ({...prev, subNumber: e.target.value}))} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-emerald-500 outline-none shadow-sm bg-white" 
                    placeholder="ex) 0"
                  />
                </div>
              </div>
            </div>

            <div className="p-5 bg-white border-t border-slate-200 flex justify-end shrink-0">
              <button 
                onClick={executeClone} 
                disabled={isLoading || !cloneForm.targetBookName}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-black rounded-xl shadow-md transition-colors flex items-center gap-2"
              >
                {isLoading ? "복제 중..." : "🚀 복제 실행"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 크롭퍼 모달 */}
      {cropImageSrc && (
        <div className="fixed inset-0 z-[100] bg-slate-900/90 flex flex-col items-center justify-center p-10 animate-in fade-in">
          <div className="text-center mb-6">
            <h3 className="text-2xl font-black text-white">✂️ 영역을 드래그해서 자르세요</h3>
            <p className="text-slate-400 font-medium mt-2">필요한 수식이나 그림 영역만 마우스로 덮으세요.</p>
          </div>
          <div className="relative max-w-full max-h-[65vh] overflow-hidden select-none bg-slate-800 rounded-xl shadow-2xl border border-slate-700">
            <img 
              ref={imgRef} src={cropImageSrc} alt="Crop target" 
              className="max-w-full max-h-[65vh] object-contain select-none cursor-crosshair" draggable={false}
              onMouseDown={handleCropMouseDown} onMouseMove={handleCropMouseMove} onMouseUp={handleCropMouseUp} onMouseLeave={handleCropMouseUp}
            />
            <div ref={selectionBoxRef} style={{ display: 'none', position: 'absolute', border: '2px dashed #0ea5e9', backgroundColor: 'rgba(14, 165, 233, 0.2)', pointerEvents: 'none' }} />
          </div>
          <div className="flex gap-4 mt-8">
            <button onClick={() => { setCropImageSrc(null); setHasCropArea(false); }} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-colors">취소</button>
            <button onClick={() => handleCropUpload(true)} className="px-6 py-3 bg-slate-600 hover:bg-slate-500 text-slate-300 font-bold rounded-xl transition-colors">자르지 않고 원본 통째로 업로드</button>
            <button onClick={() => handleCropUpload(false)} disabled={!hasCropArea || isLoading} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-400 text-white font-black rounded-xl transition-colors shadow-lg">
              {isLoading ? '업로드 중...' : '✂️ 선택 영역 자르기 및 업로드'}
            </button>
          </div>
        </div>
      )}

      {/* AI 쌍둥이/유사 문항 모달 */}
      {isTwinModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 flex flex-col items-center justify-center p-6 sm:p-10 animate-in fade-in backdrop-blur-sm">
          <div className="bg-white w-full max-w-6xl h-full max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
            <div className="p-5 bg-gradient-to-r from-fuchsia-600 to-indigo-600 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-black text-white flex items-center gap-2">
                  <span>👯</span> AI 쌍둥이/유사 문항 생성기
                </h2>
                <p className="text-fuchsia-100 font-bold text-xs mt-1">숫자와 상황이 변형된 클리닉용 유사 문항이 자동으로 생성되었습니다. 저장할 문제를 선택하세요.</p>
              </div>
              <button onClick={() => setIsTwinModalOpen(false)} className="text-white hover:text-fuchsia-200 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors">
                닫기 ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scroll">
              {isGeneratingTwins ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                  <span className="text-5xl animate-spin">🌀</span>
                  <p className="font-extrabold text-lg">AI가 쌍둥이와 유사 문제를 생성하고 있습니다...</p>
                  <p className="text-sm font-bold text-slate-400">수식과 4단계 해설을 작성 중이므로 약 10초 정도 소요됩니다.</p>
                </div>
              ) : generatedTwins.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {generatedTwins.map((twin, idx) => (
                    <div key={idx} className={`bg-white border rounded-2xl p-5 shadow-sm transition-all flex flex-col gap-3 ${twin.isSelected === false ? 'border-slate-200 opacity-60 grayscale-[50%]' : 'border-indigo-300 hover:shadow-md'}`}>
                      <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                        
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={twin.isSelected !== false}
                            onChange={(e) => handleTwinChange(idx, 'isSelected', e.target.checked)}
                            className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                          />
                          <span className={`px-2 py-1 rounded text-xs font-black transition-colors ${twin.isSelected === false ? 'text-slate-400 bg-slate-100' : (twin.question_type === '유사' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700')}`}>
                            {twin.question_type === '유사' ? '💡 유사 문항' : '👯 쌍둥이 문항'}
                          </span>
                        </label>
                        
                        <button
                          onClick={() => handleTwinChange(idx, 'isPreviewMode', !twin.isPreviewMode)}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors shadow-sm ${twin.isPreviewMode ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                        >
                          {twin.isPreviewMode ? <><span>✏️</span> 텍스트 편집 모드</> : <><span>👀</span> 수식 미리보기</>}
                        </button>
                      </div>
                      
                      <div className="flex flex-col gap-1.5 flex-1 mt-1">
                        <label className="text-[11px] font-bold text-slate-500">문제 텍스트</label>
                        {twin.isPreviewMode ? (
                          <div className="w-full min-h-[6rem] p-3 text-sm border border-slate-200 rounded-lg bg-white overflow-x-auto shadow-inner whitespace-pre-wrap font-medium text-slate-800">
                            {twin.question || <span className="text-slate-400 italic text-xs">텍스트가 없습니다.</span>}
                          </div>
                        ) : (
                          <textarea value={twin.question} onChange={(e) => handleTwinChange(idx, 'question', e.target.value)} className="w-full h-24 p-3 text-sm border border-slate-300 rounded-lg bg-yellow-50/30 resize-none outline-none focus:ring-2 focus:ring-indigo-400" />
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5 mt-2">
                        <label className="text-[11px] font-bold text-slate-500">정답</label>
                        {twin.isPreviewMode ? (
                          <div className="w-full min-h-[38px] p-2 px-3 text-sm border border-slate-200 rounded-lg bg-white overflow-x-auto shadow-inner font-bold text-emerald-800 flex items-center">
                            {twin.answer || <span className="text-slate-400 italic text-xs">정답이 없습니다.</span>}
                          </div>
                        ) : (
                          <input type="text" value={twin.answer} onChange={(e) => handleTwinChange(idx, 'answer', e.target.value)} className="w-full p-2 px-3 text-sm font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
                        )}
                      </div>

                      <details className="group mt-2">
                        <summary className="text-xs font-bold text-indigo-500 cursor-pointer hover:text-indigo-700 outline-none select-none flex items-center gap-1">
                          <span>▶</span> 상세 해설 (4단계) 보기 및 수정
                        </summary>
                        <div className="mt-3 flex flex-col gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                          {twin.isPreviewMode ? (
                            <div className="flex flex-col gap-2">
                              {twin.step_1_concept && <div className="text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 shadow-inner"><span className="font-bold text-indigo-600 mr-2">1. 개념</span>{twin.step_1_concept}</div>}
                              {twin.step_2_approach && <div className="text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 shadow-inner"><span className="font-bold text-indigo-600 mr-2">2. 접근</span>{twin.step_2_approach}</div>}
                              {twin.step_3_process && <div className="text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 shadow-inner"><span className="font-bold text-indigo-600 mr-2">3. 과정</span>{twin.step_3_process}</div>}
                              {twin.step_4_conclusion && <div className="text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 shadow-inner"><span className="font-bold text-indigo-600 mr-2">4. 결론</span>{twin.step_4_conclusion}</div>}
                            </div>
                          ) : (
                            <>
                              <textarea value={twin.step_1_concept} onChange={(e) => handleTwinChange(idx, 'step_1_concept', e.target.value)} placeholder="1. 개념" className="w-full text-xs p-2 border border-slate-300 rounded resize-none h-12 outline-none focus:border-indigo-400" />
                              <textarea value={twin.step_2_approach} onChange={(e) => handleTwinChange(idx, 'step_2_approach', e.target.value)} placeholder="2. 접근" className="w-full text-xs p-2 border border-slate-300 rounded resize-none h-12 outline-none focus:border-indigo-400" />
                              <textarea value={twin.step_3_process} onChange={(e) => handleTwinChange(idx, 'step_3_process', e.target.value)} placeholder="3. 과정" className="w-full text-xs p-2 border border-slate-300 rounded resize-none h-16 outline-none focus:border-indigo-400" />
                              <textarea value={twin.step_4_conclusion} onChange={(e) => handleTwinChange(idx, 'step_4_conclusion', e.target.value)} placeholder="4. 결론" className="w-full text-xs p-2 border border-slate-300 rounded resize-none h-12 outline-none focus:border-indigo-400" />
                            </>
                          )}
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-slate-400 font-bold">생성된 문항이 없습니다.</div>
              )}
            </div>

            {/* 2개로 분리된 드롭다운 영역 */}
            <div className="p-5 bg-white border-t border-slate-200 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-6">
                
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-slate-500">👯 쌍둥이 문항 저장 대상:</label>
                  <select
                    value={twinTargetBook}
                    onChange={(e) => setTwinTargetBook(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg font-bold text-indigo-700 bg-indigo-50 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm cursor-pointer text-sm"
                  >
                    <option value={`${selectedBook} 쌍둥이`}>{selectedBook} 쌍둥이</option>
                    <option value="주간테스트">주간테스트</option>
                    <option value="중간테스트">중간테스트</option>
                    <option value="분기테스트">분기테스트</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-slate-500">💡 유사 문항 저장 대상:</label>
                  <select
                    value={similarTargetBook}
                    onChange={(e) => setSimilarTargetBook(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg font-bold text-amber-700 bg-amber-50 outline-none focus:ring-2 focus:ring-amber-500 shadow-sm cursor-pointer text-sm"
                  >
                    <option value={`${selectedBook} 유사`}>{selectedBook} 유사</option>
                    <option value="주간테스트">주간테스트</option>
                    <option value="중간테스트">중간테스트</option>
                    <option value="분기테스트">분기테스트</option>
                  </select>
                </div>

              </div>
              <button 
                onClick={saveTwinsToDB} 
                disabled={isGeneratingTwins || generatedTwins.length === 0 || isLoading}
                className="px-8 py-3 bg-[#002864] hover:bg-blue-900 disabled:bg-slate-300 text-white font-black rounded-xl shadow-lg transition-colors flex items-center gap-2"
              >
                {isLoading ? "저장 중..." : `💾 선택된 ${generatedTwins.filter(t => t.isSelected !== false).length}개 문항 저장`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 메인 UI */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center mb-4 shrink-0 gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#002864] flex items-center gap-2">
            <span>⚙️</span> 문제 교정 및 쌍둥이/유사 문제 생성
          </h1>
          <p className="text-sm font-bold text-slate-500 mt-1">AI 자동 분류가 미흡한 문제를 확인하고, 정확한 8단계 뎁스로 업데이트 하거나 문항을 직접 수정합니다.</p>
        </div>
      </div>

      <div className="bg-white px-6 py-4 border border-slate-200 rounded-xl flex items-end gap-4 mb-4 shrink-0 shadow-sm">
        <div className="flex flex-col gap-1.5 flex-1 max-w-md">
          <span className="text-xs font-bold text-slate-500">마스터 DB 전체 교재 검색:</span>
          <div className="flex items-center gap-2">
            <select value={selectedBook} onChange={(e) => setSelectedBook(e.target.value)} className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg font-bold text-[#002864] bg-slate-50 text-sm shadow-sm outline-none focus:ring-2 focus:ring-[#002864]">
              <option value="">교재를 선택하세요...</option>
              {workbooks.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <button onClick={handleRenameBook} disabled={!selectedBook || isLoading} className="whitespace-nowrap shrink-0 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold rounded-lg shadow-sm border border-slate-300 transition-colors disabled:opacity-50" title="선택한 문제지 덩어리의 이름을 통째로 변경합니다.">
              ✏️ 이름 일괄 변경
            </button>
          </div>
        </div>
        <button onClick={fetchQuestions} disabled={!selectedBook || isLoading} className="px-6 py-2 bg-[#002864] hover:bg-blue-900 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 transition-colors whitespace-nowrap shrink-0">
          조회하기
        </button>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        
        {/* 좌측: 문제 리스트 */}
        <div className="w-[400px] bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden shrink-0">
          <div className="p-3 bg-slate-100/80 border-b border-slate-200 flex justify-between items-center shrink-0">
            <h2 className="font-extrabold text-slate-800 text-sm">📋 전체 문항 리스트 ({questions.length}개)</h2>
            <button onClick={createNewQuestion} disabled={!selectedBook || isLoading || !perms.add} className={`text-[10px] text-white px-2.5 py-1.5 rounded font-bold shadow-sm flex items-center gap-1 transition-colors ${perms.add ? 'bg-[#002864] hover:bg-blue-800' : 'bg-slate-300 cursor-not-allowed'}`} title={!perms.add ? "새 문항 추가 권한이 없습니다." : ""}>
              <span>➕</span> 새 문항 추가
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 custom-scroll bg-slate-50/50">
            {questions.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">교재를 조회해주세요.</div>
            ) : (
              <>
                {normalRoots.map(q => {
                  const isSelected = selectedQuestion?.question_id === q.question_id;
                  const hasTaxonomy = q.taxonomy_id && q.taxonomy_id !== '미분류';
                  const myTwins = getDescendants(String(q.question_id).trim().toLowerCase());

                  return (
                    <React.Fragment key={q.question_id}>
                      <div id={`q-list-${q.question_id}`} onClick={() => handleQuestionClick(q)} className={`p-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm relative overflow-hidden flex flex-col gap-2 mt-2 ${isSelected ? 'border-[#002864] bg-blue-50/50' : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-md'}`}>
                        {isSelected && <div className="absolute left-0 top-0 w-1.5 h-full bg-[#002864]"></div>}
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-white bg-slate-600 px-2 py-0.5 rounded shadow-sm">{q.final_printed_page || q.detected_page_num || '?'}p</span>
                            <span className="text-sm font-black text-slate-800">{formatQNum(q.question_number, q.sub_num)}</span>
                          </div>
                          {hasTaxonomy ? (
                            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">분류됨</span>
                          ) : (
                            <span className="text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded animate-pulse">수정필요</span>
                          )}
                        </div>
                        <div className="text-xs font-medium text-slate-700 line-clamp-2 leading-relaxed whitespace-pre-wrap">{q.question}</div>
                      </div>

                      {myTwins.length > 0 && (
                        <div className="pl-5 ml-3 my-1 border-l-2 border-indigo-200 flex flex-col gap-1.5 relative">
                          <div className="absolute top-0 left-0 w-3 border-t-2 border-indigo-200 mt-4"></div>
                          
                          {myTwins.map(twin => {
                            const isTwinSelected = selectedQuestion?.question_id === twin.question_id;
                            const isSimilar = twin.derivation_type === '유사';
                            const badgeLabel = twin.derivation_type === 'TWIN' || twin.derivation_type === '쌍둥이' ? '쌍둥이' : '유사';
                            
                            return (
                              <div id={`q-list-${twin.question_id}`} key={twin.question_id} onClick={() => handleQuestionClick(twin)} className={`p-2.5 rounded-lg border transition-all cursor-pointer shadow-sm relative overflow-hidden flex flex-col gap-1.5 ${isTwinSelected ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500' : 'border-slate-200 bg-white hover:border-indigo-300'}`}>
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm border ${isSimilar ? 'text-amber-700 bg-amber-100 border-amber-200' : 'text-fuchsia-700 bg-fuchsia-100 border-fuchsia-200'}`}>
                                      {isSimilar ? '💡 유사' : `👯 ${badgeLabel}`}
                                    </span>
                                    <span className="text-[11px] font-black text-slate-700">{formatQNum(twin.question_number, twin.sub_num)}</span>
                                  </div>
                                </div>
                                <div className="text-[11px] font-medium text-slate-600 line-clamp-1 truncate">{twin.question}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}

                {trueOrphans.length > 0 && (
                  <div className="pt-4 mt-4 border-t border-slate-200">
                    <div className="text-[10px] font-bold text-rose-500 mb-2 px-2 bg-rose-50 py-1 rounded-md border border-rose-100 inline-block">⚠️ 원본이 완전히 유실된 문항</div>
                    <div className="flex flex-col gap-2">
                      {trueOrphans.map(q => {
                        const isSelected = selectedQuestion?.question_id === q.question_id;
                        const isSimilar = q.derivation_type === '유사';
                        const myTwins = getDescendants(String(q.question_id).trim().toLowerCase());

                        return (
                          <React.Fragment key={q.question_id}>
                            <div id={`q-list-${q.question_id}`} onClick={() => handleQuestionClick(q)} className={`p-2.5 rounded-lg border transition-all cursor-pointer shadow-sm relative overflow-hidden flex flex-col gap-1.5 ${isSelected ? 'border-rose-500 bg-rose-50/50 ring-1 ring-rose-500' : 'border-slate-200 bg-white hover:border-rose-300'}`}>
                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm border ${isSimilar ? 'text-amber-700 bg-amber-100 border-amber-200' : 'text-fuchsia-700 bg-fuchsia-100 border-fuchsia-200'}`}>
                                    {q.derivation_type || '쌍둥이'}
                                  </span>
                                  <span className="text-[11px] font-black text-slate-700">{formatQNum(q.question_number, q.sub_num)}</span>
                                </div>
                              </div>
                              <div className="text-[11px] font-medium text-slate-600 line-clamp-1 truncate">{q.question}</div>
                            </div>
                            
                            {myTwins.length > 0 && (
                              <div className="pl-5 ml-3 my-1 border-l-2 border-indigo-200 flex flex-col gap-1.5 relative">
                                <div className="absolute top-0 left-0 w-3 border-t-2 border-indigo-200 mt-4"></div>
                                {myTwins.map(twin => {
                                  const isTwinSelected = selectedQuestion?.question_id === twin.question_id;
                                  return (
                                    <div id={`q-list-${twin.question_id}`} key={twin.question_id} onClick={() => handleQuestionClick(twin)} className={`p-2.5 rounded-lg border transition-all cursor-pointer shadow-sm relative overflow-hidden flex flex-col gap-1.5 ${isTwinSelected ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500' : 'border-slate-200 bg-white hover:border-indigo-300'}`}>
                                      <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm border text-fuchsia-700 bg-fuchsia-100 border-fuchsia-200">
                                            {twin.derivation_type || '쌍둥이'}
                                          </span>
                                          <span className="text-[11px] font-black text-slate-700">{formatQNum(twin.question_number, twin.sub_num)}</span>
                                        </div>
                                      </div>
                                      <div className="text-[11px] font-medium text-slate-600 line-clamp-1 truncate">{twin.question}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 우측: 뷰어 & 수정 에디터 */}
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
          
          {!selectedQuestion ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 font-bold opacity-60">
              <span className="text-5xl mb-4">👈</span>
              <p>좌측에서 수정할 문제를 선택해주세요.</p>
            </div>
          ) : (
            <>
              {/* 상단 뷰어 및 문제 수정 영역 */}
              <div className={`p-6 overflow-y-auto custom-scroll border-b-4 border-slate-100 bg-white flex flex-col transition-all ${isEditingContent ? 'flex-1' : 'flex-[2]'}`}>
                <div className="flex items-start justify-between gap-3 mb-4 shrink-0">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="bg-[#002864] text-white px-3 py-1 rounded-lg text-sm font-black shadow-sm w-max">
                        {selectedQuestion.final_printed_page || selectedQuestion.detected_page_num || '?'}p - {formatQNum(selectedQuestion.question_number, selectedQuestion.sub_num)}
                      </span>
                      <span className="bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm">
                        난이도: {selectedQuestion.difficulty || '미지정'}
                      </span>
                      <span className="bg-sky-50 border border-sky-200 text-sky-700 px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm">
                        정답률: {selectedQuestion.solving_probability !== null && selectedQuestion.solving_probability !== undefined ? `${selectedQuestion.solving_probability}%` : '미입력'}
                      </span>
                    </div>
                    
                    <button 
                      onClick={handleAutoFillTaxonomy}
                      className="text-xs font-bold text-slate-500 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 px-3 py-1.5 rounded-lg flex flex-col leading-snug text-left transition-colors cursor-pointer group shadow-sm mt-1"
                    >
                      <span className="text-[10px] text-slate-400 mb-0.5 group-hover:text-indigo-500 transition-colors flex items-center gap-1">
                        <span>🪄 현재 분류 (클릭 시 하단 자동 세팅)</span>
                        <span className="ml-auto font-mono text-[9px] bg-white px-1 py-0.5 rounded border border-slate-200">{selectedQuestion.taxonomy_id || '미분류'}</span>
                      </span>
                      <span className={selectedQuestion.taxonomy_id && selectedQuestion.taxonomy_id !== '미분류' ? 'text-emerald-700' : 'text-rose-500'}>
                        {getKoreanPath(selectedQuestion.taxonomy_id)}
                      </span>
                    </button>
                  </div>
                  
                  {!isEditingContent ? (
                    <div className="flex gap-2 shrink-0">
                      {/* 🌟 1. AI 유사생성 */}
                      <button onClick={handleGenerateTwins} disabled={!perms.twin || !!selectedQuestion.parent_question_id} className={`px-3 py-2 font-black text-xs rounded-lg transition-colors shadow-md flex items-center gap-1.5 ${perms.twin && !selectedQuestion.parent_question_id ? 'bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`} title={!!selectedQuestion.parent_question_id ? "쌍둥이 문항에서는 또 생성할 수 없습니다." : (!perms.twin ? "생성 권한이 없습니다." : "")}>
                        <span>👯</span> <span>AI 유사생성</span>
                      </button>

                      {/* 🌟 2. 타 교재로 복제 */}
                      <button 
                        onClick={() => {
                          setCloneForm({ 
                            targetBookName: selectedBook, 
                            pageNumber: selectedQuestion.final_printed_page || '', 
                            questionNumber: selectedQuestion.question_number || '',
                            subNumber: selectedQuestion.sub_num || ''
                          });
                          setIsCloneModalOpen(true);
                        }} 
                        disabled={!perms.add} 
                        className={`px-3 py-2 font-bold text-xs rounded-lg transition-colors border shadow-sm flex items-center gap-1.5 ${perms.add ? 'bg-slate-100 hover:bg-slate-200 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'}`} 
                        title={!perms.add ? "새 문항 추가 권한이 없습니다." : "현재 문제를 다른 교재로 복제합니다."}
                      >
                        <span>📋</span> 타 교재로 복제
                      </button>

                      {/* 🌟 3. AI 수식 자동 복구 (신규 추가) */}
                      <button 
                        onClick={handleFixLatex} 
                        disabled={!perms.edit || isFixingLatex} 
                        className={`px-3 py-2 font-bold text-xs rounded-lg transition-colors border shadow-sm flex items-center gap-1.5 ${perms.edit && !isFixingLatex ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'}`} 
                        title="AI를 사용하여 깨진 텍스트 수식을 정교한 LaTeX로 일괄 복구합니다."
                      >
                        {isFixingLatex ? <><span>🪄</span> 복구 중...</> : <><span>🪄</span> AI 수식 자동 복구</>}
                      </button>
                      
                      {/* 🌟 4. 문항 수정 */}
                      <button onClick={() => setIsEditingContent(true)} disabled={!perms.edit} className={`px-3 py-2 font-bold text-xs rounded-lg transition-colors border shadow-sm flex items-center gap-1.5 ${perms.edit ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300' : 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'}`} title={!perms.edit ? "수정 권한이 없습니다." : ""}>
                        <span>✏️</span> 문항 수정
                      </button>

                      {/* 🌟 5. 삭제 */}
                      <button onClick={deleteQuestion} disabled={!perms.delete} className={`px-3 py-2 font-bold text-xs rounded-lg transition-colors border shadow-sm flex items-center gap-1.5 ${perms.delete ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 border-rose-200' : 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'}`} title={!perms.delete ? "삭제 권한이 없습니다." : ""}>
                        <span>🗑️</span> 삭제
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={saveQuestionContent} disabled={isLoading} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-lg transition-colors shadow-sm">
                        저장하기
                      </button>
                      <button onClick={() => { setIsEditingContent(false); handleQuestionClick(selectedQuestion); }} className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 font-bold text-xs rounded-lg transition-colors">
                        취소
                      </button>
                    </div>
                  )}
                </div>
                
                {!isEditingContent ? (
                  <div key={`view-wrapper-${selectedQuestion.question_id}`} className="flex flex-col">
                    <div className="text-base font-medium text-slate-800 leading-relaxed whitespace-pre-wrap p-4 bg-slate-50 rounded-xl border border-slate-200 shadow-inner mt-2">
                      {selectedQuestion.question}
                    </div>
                    
                    {(selectedQuestion.image_url || selectedQuestion.image_2_url) && (
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        {selectedQuestion.image_url && <img src={getCleanUrl(selectedQuestion.image_url)} alt="문제 이미지 1" className="max-w-full rounded-lg border border-slate-200 shadow-sm" />}
                        {selectedQuestion.image_2_url && <img src={getCleanUrl(selectedQuestion.image_2_url)} alt="문제 이미지 2" className="max-w-full rounded-lg border border-slate-200 shadow-sm" />}
                      </div>
                    )}

                    {selectedQuestion.answer && (
                      <div className="mt-6 text-sm font-bold text-blue-700 bg-blue-50 p-3 rounded-xl border border-blue-100">
                        정답: {selectedQuestion.answer}
                      </div>
                    )}

                    {(selectedQuestion.step_1_concept || selectedQuestion.step_2_approach || selectedQuestion.step_3_process || selectedQuestion.step_4_conclusion) && (
                      <div className="mt-4 p-4 border border-emerald-200 bg-emerald-50/30 rounded-xl space-y-3">
                        <h4 className="text-xs font-black text-emerald-700 border-b border-emerald-200 pb-2 mb-3">📝 단계별 풀이</h4>
                        {selectedQuestion.step_1_concept && <div className="text-[13px] text-slate-700"><span className="font-bold text-emerald-600 w-16 inline-block">1. 개념</span>{selectedQuestion.step_1_concept}</div>}
                        {selectedQuestion.step_2_approach && <div className="text-[13px] text-slate-700"><span className="font-bold text-emerald-600 w-16 inline-block">2. 접근</span>{selectedQuestion.step_2_approach}</div>}
                        {selectedQuestion.step_3_process && <div className="text-[13px] text-slate-700"><span className="font-bold text-emerald-600 w-16 inline-block">3. 과정</span>{selectedQuestion.step_3_process}</div>}
                        {selectedQuestion.step_4_conclusion && <div className="text-[13px] text-slate-700"><span className="font-bold text-emerald-600 w-16 inline-block">4. 결론</span>{selectedQuestion.step_4_conclusion}</div>}
                      </div>
                    )}

                    {(selectedQuestion.answer_image_url || selectedQuestion.answer_image_2_url) && (
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        {selectedQuestion.answer_image_url && <img src={getCleanUrl(selectedQuestion.answer_image_url)} alt="정답 이미지 1" className="max-w-full rounded-lg border border-emerald-200 shadow-sm" />}
                        {selectedQuestion.answer_image_2_url && <img src={getCleanUrl(selectedQuestion.answer_image_2_url)} alt="정답 이미지 2" className="max-w-full rounded-lg border border-emerald-200 shadow-sm" />}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 flex-1 pb-10 mt-2">
                    
                    <div className="flex gap-4 p-4 bg-slate-100 rounded-xl border border-slate-200 flex-wrap">
                      <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                        <label className="text-xs font-bold text-slate-500">페이지 번호</label>
                        <input type="text" value={editForm.page_number} onChange={e => setEditForm({...editForm, page_number: e.target.value})} className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none shadow-sm bg-white" />
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                        <label className="text-xs font-bold text-slate-500">문항 번호</label>
                        <input type="text" value={editForm.question_number} onChange={e => setEditForm({...editForm, question_number: e.target.value})} className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none shadow-sm bg-white" />
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                        <label className="text-xs font-bold text-slate-500">서브 번호(꼬리)</label>
                        <input type="number" value={editForm.sub_num} onChange={e => setEditForm({...editForm, sub_num: e.target.value})} className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none shadow-sm bg-white" />
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                        <label className="text-xs font-bold text-slate-500">난이도</label>
                        <select value={editForm.difficulty || '미지정'} onChange={e => setEditForm({...editForm, difficulty: e.target.value})} className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none shadow-sm bg-white">
                          <option value="최상">최상</option>
                          <option value="상">상</option>
                          <option value="중">중</option>
                          <option value="하">하</option>
                          <option value="최하">최하</option>
                          <option value="미지정">미지정</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                        <label className="text-xs font-bold text-slate-500">예상 정답률(%)</label>
                        <input type="number" step="0.1" value={editForm.solving_probability} onChange={e => setEditForm({...editForm, solving_probability: e.target.value})} placeholder="빈칸 가능" className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-[#002864] outline-none shadow-sm bg-white" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-slate-500">
                        문제 텍스트 (LaTeX 수식은 <code className="font-mono text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded border border-indigo-100">$</code> 기호 또는 <code className="font-mono text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded border border-indigo-100">$$</code> 기호로 양끝을 감싸서 사용)
                      </label>
                      <textarea value={editForm.question} onChange={e => setEditForm({ ...editForm, question: e.target.value })} className="w-full min-h-[300px] p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#002864] outline-none text-sm font-medium leading-relaxed resize-y bg-yellow-50/30" />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      {renderImageBox("문제 이미지 1", "image_url", "indigo")}
                      {renderImageBox("문제 이미지 2", "image_2_url", "indigo")}
                    </div>
                    
                    <div className="flex flex-col gap-1.5 mt-4">
                      <label className="text-xs font-bold text-slate-500">정답 텍스트</label>
                      <input type="text" value={editForm.answer} onChange={e => setEditForm({ ...editForm, answer: e.target.value })} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#002864] outline-none text-sm font-bold" />
                    </div>

                    <div className="border-t border-slate-200 my-2 pt-4">
                      <h4 className="text-sm font-extrabold text-emerald-700 mb-3">📝 4단계 풀이 과정</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-slate-500">Step 1. 개념</label>
                          <textarea value={editForm.step_1_concept} onChange={e => setEditForm({ ...editForm, step_1_concept: e.target.value })} className="w-full h-20 p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-[13px] resize-none" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-slate-500">Step 2. 접근</label>
                          <textarea value={editForm.step_2_approach} onChange={e => setEditForm({ ...editForm, step_2_approach: e.target.value })} className="w-full h-20 p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-[13px] resize-none" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-slate-500">Step 3. 과정</label>
                          <textarea value={editForm.step_3_process} onChange={e => setEditForm({ ...editForm, step_3_process: e.target.value })} className="w-full h-20 p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-[13px] resize-none" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-slate-500">Step 4. 결론</label>
                          <textarea value={editForm.step_4_conclusion} onChange={e => setEditForm({ ...editForm, step_4_conclusion: e.target.value })} className="w-full h-20 p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-[13px] resize-none" />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-2 mb-4">
                      {renderImageBox("정답 이미지 1", "answer_image_url", "emerald")}
                      {renderImageBox("정답 이미지 2", "answer_image_2_url", "emerald")}
                    </div>

                  </div>
                )}
              </div>

              {/* 하단: 8단계 Taxonomy 에디터 */}
              {!isEditingContent && (
                <div className="flex-1 p-6 bg-slate-50/50 overflow-y-auto custom-scroll flex flex-col shrink-0">
                  <h3 className="font-extrabold text-slate-800 mb-4 flex items-center gap-2">
                    <span>🎯</span> Taxonomy 강제 지정 (8-Depth) 
                    <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded ml-2 shadow-sm">선택 상태 유지됨</span>
                    {isTaxonomyLoading && <span className="text-[10px] text-rose-500 animate-pulse ml-2 font-bold">분류 데이터 로딩중...</span>}
                  </h3>

                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 1 (학교)</label>
                      <select value={selD1} onChange={e => handleD1Change(e.target.value)} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#002864] shadow-sm bg-white">
                        <option value="">선택</option>{d1Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 2 (학년/학기)</label>
                      <select value={selD2} onChange={e => handleD2Change(e.target.value)} disabled={!selD1 || d2Options.length === 0} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#002864] shadow-sm disabled:bg-slate-100 bg-white">
                        <option value="">{d2Options.length === 0 && selD1 ? '옵션 없음' : '선택'}</option>{d2Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 3 (대단원)</label>
                      <select value={selD3} onChange={e => handleD3Change(e.target.value)} disabled={!selD2 || d3Options.length === 0} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#002864] shadow-sm disabled:bg-slate-100 bg-white">
                        <option value="">{d3Options.length === 0 && selD2 ? '옵션 없음' : '선택'}</option>{d3Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 4 (중단원)</label>
                      <select value={selD4} onChange={e => handleD4Change(e.target.value)} disabled={!selD3 || d4Options.length === 0} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#002864] shadow-sm disabled:bg-slate-100 bg-white">
                        <option value="">{d4Options.length === 0 && selD3 ? '옵션 없음' : '선택'}</option>{d4Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 5 (소단원)</label>
                      <select value={selD5} onChange={e => handleD5Change(e.target.value)} disabled={!selD4 || d5Options.length === 0} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#002864] shadow-sm disabled:bg-slate-100 bg-white">
                        <option value="">{d5Options.length === 0 && selD4 ? '옵션 없음' : '선택'}</option>{d5Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 6 (유형)</label>
                      <select value={selD6} onChange={e => handleD6Change(e.target.value)} disabled={!selD5 || d6Options.length === 0} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#002864] shadow-sm disabled:bg-slate-100 bg-white">
                        <option value="">{d6Options.length === 0 && selD5 ? '옵션 없음' : '선택'}</option>{d6Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-500">Depth 7 (개념)</label>
                      <select value={selD7} onChange={e => handleD7Change(e.target.value)} disabled={!selD6 && (!selD5 || d6Options.length > 0)} className="p-2 text-xs font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm disabled:bg-slate-100 bg-emerald-50 text-emerald-900">
                        <option value="">{d7Options.length === 0 && (selD6 || (selD5 && d6Options.length===0)) ? '옵션 없음' : '선택'}</option>{d7Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-rose-500">Depth 8 (문항유형 - 아이템)</label>
                      <select value={selD8} onChange={e => setSelD8(e.target.value)} disabled={d8Options.length === 0} className="p-2 text-xs font-bold border border-rose-300 rounded-lg outline-none focus:ring-2 focus:ring-rose-500 shadow-sm disabled:bg-slate-100 bg-rose-50 text-rose-900">
                        <option value="">{d8Options.length === 0 ? '8뎁스 없음' : '선택'}</option>
                        {d8Options.map((o: any) => <option key={o.item_id} value={o.item_id}>{o.depth8}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="mt-auto flex justify-end">
                    <button 
                      onClick={saveTaxonomy} 
                      disabled={!finalCalculatedTaxId || isLoading} 
                      className="px-8 py-3 bg-[#002864] hover:bg-blue-900 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black rounded-xl shadow-md transition-colors flex items-center gap-2"
                    >
                      {isLoading ? "저장 중..." : "💾 DB 강제 업데이트 (Save & Next)"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}