"use client";

import React, { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import dynamic from "next/dynamic";
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const DynamicPdfViewer = dynamic(
  async () => {
    const { Document, Page, pdfjs } = await import("react-pdf");
    pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;
    const pdfOptions = { cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`, cMapPacked: true };

    return function Viewer({ pdfUrl, currentPage, totalPages, onDocumentLoadSuccess, scale, children }: any) {
      return (
        <Document file={pdfUrl} onLoadSuccess={onDocumentLoadSuccess} options={pdfOptions} className="flex flex-col items-center">
          {totalPages && (
            <Page 
              pageNumber={currentPage} 
              renderTextLayer={false} 
              renderAnnotationLayer={false} 
              width={850} 
              scale={scale} 
              devicePixelRatio={typeof window !== 'undefined' ? Math.max(window.devicePixelRatio, 3) : 3}
              className="relative shadow-2xl rounded-lg overflow-hidden transition-transform duration-100 origin-top bg-white" 
            >
              {children}
            </Page>
          )}
        </Document>
      );
    };
  },
  { ssr: false }
);

interface PdfField {
  id: string;
  x_pos: number;
  y_pos: number;
  width: number;
  height: number;
  max_length: number;
  correct_answer: string;
  problem_num?: string;
  video_url?: string;
  display_order?: number;
  field_type?: 'input' | 'select' | 'video';
}

interface ConceptVideo {
  start_page: number;
  end_page: number;
  video_url: string;
}

const getEmbedUrl = (url: string) => {
  if (!url) return "";
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#\&\?]*).*/;
  const match = url.match(regExp);
  if (match && match[2].length === 11) {
    // 🌟 rel=0 (관련 동영상 내 채널로 제한), modestbranding=1 (유튜브 로고 최소화)
    return `https://www.youtube.com/embed/${match[2]}?rel=0&modestbranding=1`;
  }
  return url; 
};

export default function NextGenMathPlatform() {
  const TARGET_PDF_ID = "test260914.pdf"; 

  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  const [fields, setFields] = useState<PdfField[]>([]);
  const [conceptVideos, setConceptVideos] = useState<ConceptVideo[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({}); 
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null); 
  const [gradingResults, setGradingResults] = useState<Record<string, boolean> | null>(null);

  const [isOverwriteMode, setIsOverwriteMode] = useState(false);
  const [isScratchpadOpen, setIsScratchpadOpen] = useState(false);
  
  // 🌟 팝업 닫힘 상태를 관리하는 Set
  const [closedPopups, setClosedPopups] = useState<Set<string>>(new Set());

  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const zoomWrapperRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoomLevel);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    document.head.appendChild(meta);
    const preventNativeZoom = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', preventNativeZoom, { passive: false });
    return () => { document.head.removeChild(meta); document.removeEventListener('gesturestart', preventNativeZoom); };
  }, []);

  useEffect(() => {
    zoomRef.current = zoomLevel;
    if (zoomWrapperRef.current) zoomWrapperRef.current.style.transform = `scale(${zoomLevel})`;
  }, [zoomLevel]);

  useEffect(() => {
    const container = pdfContainerRef.current;
    const wrapper = zoomWrapperRef.current;
    if (!container || !wrapper) return;

    let initialDist = 0; let startZoom = 1;

    const onGestureStart = (e: any) => { e.preventDefault(); startZoom = zoomRef.current; wrapper.style.transition = 'none'; };
    const onGestureChange = (e: any) => { e.preventDefault(); setZoomLevel(Math.max(0.5, Math.min(3.0, startZoom * e.scale))); };
    const onGestureEnd = (e: any) => { e.preventDefault(); wrapper.style.transition = 'transform 0.2s ease-out'; };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        initialDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        startZoom = zoomRef.current;
        wrapper.style.transition = 'none';
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        if (initialDist === 0) return;
        const scale = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) / initialDist;
        setZoomLevel(Math.max(0.5, Math.min(3.0, startZoom * scale)));
      }
    };
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length < 2) { initialDist = 0; wrapper.style.transition = 'transform 0.2s ease-out'; } };
    const onWheel = (e: WheelEvent) => { if (e.ctrlKey) { e.preventDefault(); setZoomLevel(z => Math.max(0.5, Math.min(3.0, z - e.deltaY * 0.01))); } };

    container.addEventListener('gesturestart', onGestureStart, { passive: false });
    container.addEventListener('gesturechange', onGestureChange, { passive: false });
    container.addEventListener('gestureend', onGestureEnd, { passive: false });
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('gesturestart', onGestureStart); container.removeEventListener('gesturechange', onGestureChange); container.removeEventListener('gestureend', onGestureEnd); container.removeEventListener('touchstart', onTouchStart); container.removeEventListener('touchmove', onTouchMove); container.removeEventListener('touchend', onTouchEnd); container.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    const { data } = supabase.storage.from("textbooks").getPublicUrl(TARGET_PDF_ID);
    setPdfUrl(data.publicUrl);
    const fetchVideos = async () => {
      const { data } = await supabase.from('pdf_concept_videos').select('*').eq('pdf_id', TARGET_PDF_ID);
      if (data) setConceptVideos(data);
    };
    fetchVideos();
  }, []);

  useEffect(() => {
    const fetchFields = async () => {
      const { data } = await supabase.from("pdf_fields").select("*").eq("pdf_id", TARGET_PDF_ID).eq("page_num", currentPage); 
      if (data) {
        const sortedData = data.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || new Date(a.created_at || "").getTime() - new Date(b.created_at || "").getTime());
        setFields(sortedData);
        const firstInput = sortedData.find((f) => f.field_type === 'input');
        setActiveFieldId(firstInput ? firstInput.id : null);
      }
      setGradingResults(null);
      setClosedPopups(new Set()); // 페이지 넘기면 팝업 닫힘 기록 초기화
      setZoomLevel(1);
    };
    fetchFields();
  }, [currentPage]);

  const problemGroups: Record<string, { fields: PdfField[], bottomY: number, bottomX: number, videoUrl?: string }> = {};
  fields.forEach(f => {
    const groupId = f.problem_num || f.id; 
    if (!problemGroups[groupId]) problemGroups[groupId] = { fields: [], bottomY: 0, bottomX: 0, videoUrl: f.video_url };
    
    if (f.field_type !== 'video') {
      problemGroups[groupId].fields.push(f);
      const currentBottomY = f.y_pos + f.height;
      if (currentBottomY > problemGroups[groupId].bottomY) {
        problemGroups[groupId].bottomY = currentBottomY;
        problemGroups[groupId].bottomX = f.x_pos + (f.width / 2);
      }
    }
    if (f.video_url) problemGroups[groupId].videoUrl = f.video_url;
  });

  const activeConceptVideo = conceptVideos.find(v => currentPage >= v.start_page && currentPage <= v.end_page);

  useEffect(() => {
    if (isScratchpadOpen && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 2;
      canvas.width = 400 * dpr; canvas.height = 450 * dpr;
      ctx.scale(dpr, dpr); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 2.5;
    }
  }, [isScratchpadOpen]);

  const startDrawing = (e: any) => { setIsDrawing(true); const canvas = canvasRef.current!; const ctx = canvas.getContext("2d")!; const rect = canvas.getBoundingClientRect(); ctx.beginPath(); ctx.moveTo((e.clientX - rect.left) * (canvas.width / (rect.width * 2)), (e.clientY - rect.top) * (canvas.height / (rect.height * 2))); canvas.setPointerCapture(e.pointerId); };
  const draw = (e: any) => { if (!isDrawing) return; const canvas = canvasRef.current!; const ctx = canvas.getContext("2d")!; const rect = canvas.getBoundingClientRect(); ctx.lineTo((e.clientX - rect.left) * (canvas.width / (rect.width * 2)), (e.clientY - rect.top) * (canvas.height / (rect.height * 2))); ctx.strokeStyle = "#0f172a"; ctx.stroke(); };
  const stopDrawing = (e: any) => { setIsDrawing(false); canvasRef.current?.releasePointerCapture(e.pointerId); };
  const clearCanvas = () => { const canvas = canvasRef.current; if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); };

  const handleKeypadClick = (key: string) => {
    if (!activeFieldId) return; 
    setAnswers((prev) => {
      const activeField = fields.find((f) => f.id === activeFieldId);
      if (!activeField || activeField.field_type !== 'input') return prev;

      let newAnswer = prev[activeFieldId] || "";

      if (isOverwriteMode) { newAnswer = key === '⌫' ? "" : key; setIsOverwriteMode(false); } 
      else { newAnswer = key === '⌫' ? newAnswer.slice(0, -1) : newAnswer.length < activeField.max_length ? newAnswer + key : newAnswer; }

      if (key !== '⌫' && newAnswer.length === activeField.max_length) {
        const nextInput = fields.slice(fields.findIndex(f => f.id === activeFieldId) + 1).find(f => f.field_type === 'input');
        setTimeout(() => { setActiveFieldId(nextInput ? nextInput.id : null); setIsOverwriteMode(false); }, 50);
      }
      return { ...prev, [activeFieldId]: newAnswer };
    });
  };

  // 🌟 제출(채점) 로직 수정: 기존 정답 기록은 지우지 않고 새로 시도한 부분만 업데이트
  const handleSubmit = () => {
    const results: Record<string, boolean> = { ...(gradingResults || {}) };
    const attemptedGroups = new Set();
    fields.forEach((f) => { if ((answers[f.id] || "").trim() !== "") attemptedGroups.add(f.problem_num || f.id); });
    
    fields.forEach((field) => {
      if (field.field_type === 'video') return; 
      if (!attemptedGroups.has(field.problem_num || field.id)) return;
      if (results[field.id] === true) return; // 이미 맞춘 정답은 덮어쓰지 않음

      if (field.field_type === 'select') {
        const isSelected = answers[field.id] === 'O';
        results[field.id] = (isSelected && field.correct_answer === 'O');
      } else {
        results[field.id] = ((answers[field.id] || "").trim() === String(field.correct_answer).trim());
      }
    });
    setGradingResults(Object.keys(results).length > 0 ? results : null);
    setActiveFieldId(null); 
  };

  // 전체 지우기 기능
  const handleResetAll = () => {
    if(!confirm("이 페이지의 입력을 모두 지우고 초기화할까요?")) return;
    setAnswers({});
    setGradingResults(null);
    setClosedPopups(new Set());
    setActiveFieldId(null);
  };

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) { setTotalPages(numPages); }

  return (
    <div className="bg-[#F4F7FB] h-screen flex flex-col font-pretendard select-none overflow-hidden relative">
      <style>{`
        @font-face { font-family: 'TeacherHandwriting'; src: url('/fonts/TeacherHandwriting.ttf') format('truetype'); font-weight: normal; font-style: normal; }
        .font-handwriting { font-family: 'TeacherHandwriting', sans-serif !important; }
        @keyframes drawStroke { to { stroke-dashoffset: 0; } }
        .pen-stroke { stroke-dasharray: 600; stroke-dashoffset: 600; animation: drawStroke 0.4s ease-out forwards; }
        .pen-stroke-fast { stroke-dasharray: 600; stroke-dashoffset: 600; animation: drawStroke 0.2s ease-out forwards; }
        @keyframes heartbeat { 0% { transform: scale(0.3); opacity: 0.8; } 60% { transform: scale(1.8); opacity: 0; } 100% { transform: scale(0.3); opacity: 0; } }
        @keyframes popUp { 0% { transform: translateX(-50%) translateY(-10px) scale(0.9); opacity: 0; } 100% { transform: translateX(-50%) translateY(0) scale(1); opacity: 1; } }
        .animate-pop-up { animation: popUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .animate-fade-in { animation: fadeIn 0.2s ease-out forwards; }
      `}</style>

      {playingVideoUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in touch-none">
          <div className="w-[95%] max-w-4xl bg-black rounded-2xl overflow-hidden shadow-2xl relative border border-slate-700">
            <div className="flex justify-between items-center p-3 bg-slate-900 border-b border-slate-700">
              <span className="text-slate-200 font-bold text-sm">📺 개념 / 문제 해설 영상</span>
              <button onClick={() => setPlayingVideoUrl(null)} className="text-slate-400 hover:text-white px-3 py-1 bg-slate-800 rounded-md font-bold text-xs">✕ 닫기</button>
            </div>
            <div className="relative pt-[56.25%] w-full bg-black">
              <iframe className="absolute top-0 left-0 w-full h-full" src={playingVideoUrl} frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen></iframe>
            </div>
          </div>
        </div>
      )}

      <header className="absolute top-5 left-1/2 -translate-x-1/2 w-[96%] max-w-[1200px] h-16 bg-white/90 backdrop-blur-xl border border-slate-200 shadow-sm rounded-2xl z-20 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-[#002864] to-[#3b82f6] shadow-md"><span className="font-black text-xl text-white tracking-tighter">L</span></div>
          <div className="hidden md:block"><div className="font-extrabold text-slate-800 text-sm tracking-wide">LOGICA AI MATH</div><div className="text-[11px] font-bold text-blue-600 flex items-center gap-1">이웅행 학생</div></div>
        </div>
        
        <div className="flex-1 flex justify-center">
          {activeConceptVideo && (
            <button onClick={() => setPlayingVideoUrl(getEmbedUrl(activeConceptVideo.video_url))} className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-white font-extrabold rounded-full shadow-md transition-all hover:scale-105 active:scale-95 border border-amber-300">
              <span className="text-base">📺</span> <span className="text-sm">기본 이론 강의</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 bg-slate-100/80 p-1.5 px-4 rounded-xl shadow-inner mr-2 hidden sm:block"><div className="text-sm font-extrabold text-slate-700">{currentPage} / {totalPages || '-'}</div></div>
        <div className="flex items-center gap-2 bg-slate-100/80 p-1 rounded-xl">
          <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.25))} className="w-8 h-8 rounded-lg bg-white shadow-sm text-slate-600 font-bold hover:bg-slate-50">-</button>
          <div className="text-xs font-bold text-slate-600 px-1 hidden sm:block">{Math.round(zoomLevel * 100)}%</div>
          <button onClick={() => setZoomLevel(z => Math.min(3.0, z + 0.25))} className="w-8 h-8 rounded-lg bg-white shadow-sm text-slate-600 font-bold hover:bg-slate-50">+</button>
        </div>
      </header>

      <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="fixed left-2 sm:left-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-14 sm:h-14 bg-white/80 backdrop-blur-md border border-slate-200 shadow-lg rounded-full flex items-center justify-center text-slate-600 font-black text-xl sm:text-2xl z-40 hover:bg-white hover:scale-105 disabled:opacity-0 transition-all">‹</button>
      <button onClick={() => setCurrentPage(p => Math.min(totalPages || 1, p + 1))} disabled={currentPage === totalPages || totalPages === null} className="fixed right-2 sm:right-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-14 sm:h-14 bg-white/80 backdrop-blur-md border border-slate-200 shadow-lg rounded-full flex items-center justify-center text-slate-600 font-black text-xl sm:text-2xl z-40 hover:bg-white hover:scale-105 disabled:opacity-0 transition-all">›</button>

      <main ref={pdfContainerRef} style={{ touchAction: 'pan-x pan-y' }} className="flex-1 w-full h-full overflow-y-auto overflow-x-auto flex justify-center pt-24 pb-28 custom-scrollbar">
        <div ref={zoomWrapperRef} className="transition-transform duration-200 origin-top h-max pb-4" style={{ transform: `scale(${zoomLevel})` }}>
          {pdfUrl && (
            <DynamicPdfViewer pdfUrl={pdfUrl} currentPage={currentPage} totalPages={totalPages} onDocumentLoadSuccess={onDocumentLoadSuccess}>
              
              {fields.map((field) => {
                const isActive = field.id === activeFieldId;
                const value = answers[field.id] || "";
                
                // 해당 필드의 채점 상태 확인
                const isFieldGraded = gradingResults && gradingResults[field.id] !== undefined;
                const isCorrect = isFieldGraded ? gradingResults[field.id] : null;
                
                const isSelectType = field.field_type === 'select';
                const isVideoType = field.field_type === 'video';
                const isSelectedOption = answers[field.id] === 'O'; 

                const handleBoxClick = () => {
                  if (isVideoType) {
                    if (field.video_url) setPlayingVideoUrl(getEmbedUrl(field.video_url));
                    return;
                  }
                  
                  if (isCorrect === true) return; // 🌟 맞춘 정답은 수정 불가

                  // 🌟 틀린 문제(오답) 클릭 시: 채점 상태와 팝업 숨김 상태를 해제하여 다시 풀 수 있게 함
                  if (isFieldGraded && isCorrect === false) {
                    const groupId = field.problem_num || field.id;
                    setGradingResults(prev => {
                      if (!prev) return null;
                      const next = { ...prev };
                      fields.forEach(f => { if ((f.problem_num || f.id) === groupId) delete next[f.id]; });
                      return Object.keys(next).length > 0 ? next : null;
                    });
                    setClosedPopups(prev => {
                      const next = new Set(prev);
                      next.delete(groupId);
                      return next;
                    });
                  }

                  if (isSelectType) {
                    setAnswers(prev => {
                      const newAnswers = { ...prev };
                      if (prev[field.id] === "O") newAnswers[field.id] = "";
                      else {
                        if (field.problem_num) fields.forEach(f => { if (f.field_type === 'select' && f.problem_num === field.problem_num) newAnswers[f.id] = ""; });
                        newAnswers[field.id] = "O";
                      }
                      return newAnswers;
                    });
                    setActiveFieldId(null); 
                  } else {
                    setActiveFieldId(field.id);
                    setIsOverwriteMode(answers[field.id] ? true : false);
                  }
                };

                return (
                  <div key={field.id} onClick={handleBoxClick} className={`absolute flex flex-col items-center justify-center text-xl font-bold transition-all ${isActive && !isSelectType && !isVideoType ? "text-indigo-700 z-10 scale-110" : "text-slate-800"} ${(!isFieldGraded || isVideoType || isCorrect === false) ? "cursor-pointer" : ""}`} style={{ left: `${field.x_pos}%`, top: `${field.y_pos}%`, width: `${field.width}%`, height: `${field.height}%` }}>
                    
                    {isVideoType ? (
                      <div className="w-full h-full bg-amber-500 hover:bg-amber-600 rounded-lg flex items-center justify-center shadow-lg transition-all hover:scale-105">
                        <span className="text-white text-base sm:text-xl drop-shadow-sm">▶</span>
                      </div>
                    ) : (
                      <>
                        {!isSelectType && (
                          <>
                            <span className={`font-handwriting ${isActive && isOverwriteMode ? "animate-pulse text-indigo-400" : ""}`}>{value}</span>
                            {isActive && !isOverwriteMode && value.length < field.max_length && (
                              <div className="absolute flex items-center justify-center pointer-events-none"><span className="absolute w-8 h-8 bg-indigo-400 rounded-full" style={{ animation: 'heartbeat 1.5s ease-out infinite' }}></span></div>
                            )}
                          </>
                        )}

                        {isSelectType && isSelectedOption && !isFieldGraded && <svg className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20 overflow-visible" style={{ width: '220%', height: '180%', opacity: 0.8 }} viewBox="0 0 140 100"><path className="pen-stroke-fast" d="M 90,75 C 15,85 5,15 70,10 C 135,5 135,65 110,75 C 105,77 102,78 98,79" fill="none" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        {isFieldGraded && isCorrect === true && <svg className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30 overflow-visible" style={{ width: '220%', height: '180%', filter: 'drop-shadow(2px 3px 2px rgba(0,0,0,0.15))' }} viewBox="0 0 140 100"><path className="pen-stroke" d="M 90,75 C 15,85 5,15 70,10 C 135,5 135,65 110,75 C 105,77 102,78 98,79" fill="none" stroke="#dc2626" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        {isFieldGraded && isCorrect === false && <svg className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30 overflow-visible" style={{ width: '150%', height: '150%', filter: 'drop-shadow(2px 3px 2px rgba(0,0,0,0.15))' }} viewBox="0 0 100 100"><path className="pen-stroke" d="M 35,55 C 40,70 45,80 50,75 C 60,55 75,30 85,20" fill="none" stroke="#dc2626" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </>
                    )}
                  </div>
                );
              })}

              {/* 🌟 팝업 닫힘 상태(closedPopups)를 반영하여 렌더링 */}
              {gradingResults && Object.keys(problemGroups).map(groupId => {
                if (closedPopups.has(groupId)) return null; 

                const group = problemGroups[groupId];
                if (group.fields.length === 0) return null; 
                
                const isGroupWrong = group.fields.some(f => gradingResults[f.id] === false);
                if (!isGroupWrong) return null;

                return (
                  <div key={`popup-${groupId}`} className="absolute flex flex-col items-center bg-slate-800/95 backdrop-blur-sm px-2.5 py-2 rounded-xl shadow-xl z-50 animate-pop-up pointer-events-auto border border-slate-700" style={{ left: `${group.bottomX}%`, top: `calc(${group.bottomY}% + 15px)`, transform: 'translateX(-50%)' }}>
                    <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-800/95 rotate-45 border-t border-l border-slate-700"></div>
                    
                    {/* 🌟 팝업 상단 닫기 X 버튼 추가 */}
                    <div className="flex items-center justify-between w-full px-1 pb-1.5 mb-1.5 border-b border-slate-600/50">
                      <span className="text-[10px] font-bold text-rose-400">🚨 오답 클리닉</span>
                      <button onClick={(e) => { e.stopPropagation(); setClosedPopups(prev => new Set(prev).add(groupId)); }} className="text-slate-400 hover:text-white text-[10px] font-black px-1.5 py-0.5 rounded hover:bg-slate-700">✕ 닫기</button>
                    </div>

                    <div className="flex items-center gap-1.5 z-10 relative">
                      {group.videoUrl && (
                        <button onClick={() => setPlayingVideoUrl(getEmbedUrl(group.videoUrl!))} className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 rounded-lg text-xs text-white font-bold transition-all hover:scale-105 active:scale-95 shadow-md">
                          ▶️ 해설 보기
                        </button>
                      )}
                      <button onClick={() => alert('taxonomy_id 기반 유사 문제 생성 기능 연결 예정!')} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 rounded-lg text-xs text-white font-extrabold transition-all hover:scale-105 active:scale-95 shadow-md">
                        🔄 연습 하기
                      </button>
                    </div>
                  </div>
                );
              })}
            </DynamicPdfViewer>
          )}
        </div>
      </main>

      <div className={`absolute bottom-[100px] left-6 w-[350px] sm:w-[400px] h-[400px] sm:h-[500px] bg-white rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.12)] border border-slate-200 z-40 flex flex-col overflow-hidden transition-transform duration-300 ease-in-out origin-bottom ${isScratchpadOpen ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-full opacity-0 scale-95 pointer-events-none'}`}>
        <div className="flex justify-between items-center px-4 py-3 bg-slate-50 border-b border-slate-100">
          <span className="font-bold text-slate-700 text-sm">✍️ 자유 연습장</span>
          <button onClick={clearCanvas} className="text-xs font-bold text-slate-500 hover:text-rose-500 px-2 py-1 bg-white border border-slate-200 rounded">전체 지우기</button>
        </div>
        <canvas ref={canvasRef} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerOut={stopDrawing} className="flex-1 bg-white touch-none cursor-crosshair" />
      </div>

      <div className="absolute bottom-0 left-0 w-full bg-white/95 backdrop-blur-xl border-t border-slate-200/50 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] py-3 px-2 sm:px-6 z-50">
        <div className="max-w-[1000px] mx-auto flex items-center justify-between gap-1.5 sm:gap-4 w-full">
          
          <div className="flex gap-1.5 sm:gap-2">
            <button onClick={() => setIsScratchpadOpen(!isScratchpadOpen)} className={`flex flex-col items-center justify-center w-12 h-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl border transition-colors shrink-0 ${isScratchpadOpen ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
              <span className="text-xl sm:text-2xl mb-0.5">✍️</span><span className="text-[9px] sm:text-[10px] font-bold">{isScratchpadOpen ? '닫기' : '연습장'}</span>
            </button>
            
            {/* 🌟 전체 초기화(지우개) 버튼 추가 */}
            <button onClick={handleResetAll} className="flex flex-col items-center justify-center w-12 h-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl border transition-colors shrink-0 bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-rose-500">
              <span className="text-xl sm:text-2xl mb-0.5">🗑️</span><span className="text-[9px] sm:text-[10px] font-bold">초기화</span>
            </button>
          </div>
          
          <div className="flex-1 flex justify-center gap-1 sm:gap-2 w-full min-w-0">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫'].map((key, i) => (
              <button 
                key={i} onClick={() => handleKeypadClick(key)} 
                className={`flex-1 min-w-[24px] max-w-[64px] h-14 sm:h-16 rounded-xl sm:rounded-2xl font-bold text-xl sm:text-3xl shadow-sm border-b-4 active:border-b-0 active:translate-y-1 transition-all flex items-center justify-center font-handwriting ${key === '⌫' ? 'bg-slate-100 border-slate-200 text-slate-500 font-sans' : 'bg-white border-slate-200 text-[#002864]'}`}
              >
                {key}
              </button>
            ))}
          </div>
          
          {/* 🌟 채점 버튼 하나로 고정 및 명칭 변경 */}
          <button onClick={handleSubmit} className="w-24 sm:w-32 h-14 sm:h-16 border-b-4 active:border-b-0 active:translate-y-1 text-white font-extrabold text-sm sm:text-xl rounded-xl sm:rounded-2xl shadow-lg transition-all shrink-0 bg-gradient-to-t from-[#002864] to-[#00388c] border-[#001b44] hover:from-[#001b44] hover:to-[#002864]">
            채점하기
          </button>
        </div>
      </div>
    </div>
  );
}