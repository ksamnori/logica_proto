"use client";

import React, { useState } from "react";

export default function PdfClinicViewerMockup() {
  // PDF 페이지 상태 관리
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = 24;
  
  const pdfUrl = "/test260914.pdf";

  // 페이지 이동 핸들러
  const handlePrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const handleNextPage = () => setCurrentPage((p) => Math.min(totalPages, p + 1));

  return (
    <div className="bg-slate-100 h-screen flex flex-col font-pretendard select-none overflow-hidden">
      {/* 1. 상단 헤더 */}
      <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div className="font-black text-xl text-[#002864] tracking-tighter">LOGICA</div>
          <div className="w-px h-6 bg-slate-300"></div>
          <h1 className="text-lg md:text-xl font-bold text-slate-800">
            <span>이웅행</span> 학생의 클리닉
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm bg-indigo-50 border border-indigo-200 text-indigo-600">
            <span className="text-xl">🕐</span>
            <span className="text-xs font-bold opacity-80">남은 시간</span>
            <span className="text-base font-lexend font-black">59:20</span>
          </div>
          <div className="w-px h-5 bg-slate-300"></div>
          <button className="text-base font-bold text-slate-400 hover:text-slate-600 transition-colors">
            나가기
          </button>
        </div>
      </header>

      {/* 2. 메인 콘텐츠 영역 (70 : 30 분할) */}
      <main className="flex-1 overflow-hidden p-6 max-w-[1920px] w-full mx-auto flex gap-6">
        
        {/* 좌측 70% : PDF 뷰어 영역 (페이지 이동 기능 추가) */}
        <div className="flex-[7] bg-white rounded-3xl shadow-lg border border-slate-200 flex flex-col overflow-hidden relative">
          <div className="flex justify-between items-center px-6 py-4 bg-slate-50 border-b border-slate-100 shrink-0">
            <h2 className="font-extrabold text-slate-700">📄 테스트 교재 (test260914)</h2>
            <div className="flex gap-2">
              <button 
                onClick={handlePrevPage}
                disabled={currentPage === 1}
                className="w-10 h-10 rounded-lg bg-white border border-slate-200 text-slate-500 font-bold hover:bg-slate-100 disabled:opacity-30 transition-colors"
              >
                ‹
              </button>
              <div className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-[#002864] flex items-center min-w-[100px] justify-center">
                {currentPage} / {totalPages}
              </div>
              <button 
                onClick={handleNextPage}
                disabled={currentPage === totalPages}
                className="w-10 h-10 rounded-lg bg-white border border-slate-200 text-slate-500 font-bold hover:bg-slate-100 disabled:opacity-30 transition-colors"
              >
                ›
              </button>
            </div>
          </div>
          
          <div className="flex-1 w-full h-full bg-slate-200/50">
            {/* key 값을 currentPage로 주어 페이지 변경 시 iframe이 확실하게 새로고침 되도록 유도 */}
            <iframe 
              key={currentPage}
              src={`${pdfUrl}#page=${currentPage}&toolbar=0&view=FitH`} 
              className="w-full h-full border-none"
              title="PDF Viewer"
            />
          </div>
        </div>

        {/* 우측 30% : 상호작용 및 입력 영역 */}
        <div className="flex-[3] min-w-[360px] flex flex-col gap-6 h-full">
          
          {/* 상단: 기본 필기 패드 (연습장) - 남는 공간을 모두 차지하도록 flex-1 적용 */}
          <div className="flex-1 bg-white rounded-3xl shadow-lg border border-slate-200 flex flex-col overflow-hidden min-h-0">
            
            {/* 필기 패드 툴바 */}
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center shrink-0">
              <span className="font-bold text-slate-600 text-sm">✍️ 자유 연습장</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 mr-2">
                  <button className="w-6 h-6 rounded-full bg-[#1C2530] border-2 border-[#1C2530]"></button>
                  <button className="w-6 h-6 rounded-full bg-[#DC2626] border-2 border-white hover:border-slate-200"></button>
                  <button className="w-6 h-6 rounded-full bg-[#2563EB] border-2 border-white hover:border-slate-200"></button>
                </div>
                <button className="text-xs font-bold bg-white border border-slate-200 text-slate-500 px-3 py-2 rounded-lg hover:bg-slate-100">🧽 지우개</button>
                <button className="text-xs font-bold bg-white border border-slate-200 text-rose-500 px-3 py-2 rounded-lg hover:bg-rose-50">🗑️ 전체삭제</button>
              </div>
            </div>

            {/* 필기 패드 캔버스 영역 (모눈종이 배경) */}
            <div 
              className="flex-1 relative flex items-center justify-center cursor-crosshair"
              style={{
                backgroundImage: 'linear-gradient(rgba(0, 40, 100, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 40, 100, 0.05) 1px, transparent 1px)',
                backgroundSize: '20px 20px'
              }}
            >
               <p className="text-slate-300 font-bold text-sm text-center px-4 pointer-events-none">
                 문제를 풀다가 계산이 필요할 때<br/>이곳에 자유롭게 적으세요
               </p>
            </div>
          </div>

          {/* 하단: 정답 입력 키패드 (고정 크기) */}
          <div className="shrink-0 bg-white rounded-3xl shadow-lg border border-slate-200 p-5 flex flex-col gap-4">
            <div className="w-full h-14 bg-slate-50 border-[3px] border-slate-200 rounded-xl flex items-center justify-end px-4">
              <span className="text-slate-300 font-bold text-lg">정답을 입력하세요</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {['7','8','9','⌫','4','5','6','C','1','2','3','-','0','.','/'].map((k, i) => (
                <button key={i} className={`h-10 md:h-12 rounded-lg font-black text-sm md:text-base shadow-sm border transition-colors ${
                  k === '⌫' ? 'bg-slate-200 text-slate-600 border-slate-300' :
                  k === 'C' ? 'bg-rose-100 text-rose-600 border-rose-200' :
                  k === '0' ? 'col-span-2 bg-slate-50 text-slate-700 border-slate-200' :
                  k === '-' || k === '.' || k === '/' ? 'bg-slate-100 text-slate-600 border-slate-200' :
                  'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}>
                  {k}
                </button>
              ))}
            </div>
            <button className="w-full bg-[#002864] hover:bg-blue-900 text-white font-extrabold text-lg py-4 rounded-xl shadow-md transition-colors mt-2">
              ✅ 정답 제출하기
            </button>
          </div>

        </div>
      </main>
    </div>
  );
}