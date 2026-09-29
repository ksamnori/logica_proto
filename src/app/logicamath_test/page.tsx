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
    
    return function Viewer({ pdfUrl, currentPage, totalPages, onDocumentLoadSuccess, scale, children }: any) {
      return (
        <Document file={pdfUrl} onLoadSuccess={onDocumentLoadSuccess} className="flex flex-col items-center">
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
}

export default function NextGenMathPlatform() {
  const TARGET_PDF_ID = "test260914.pdf"; 

  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  const [fields, setFields] = useState<PdfField[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({}); 
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null); 
  const [gradingResults, setGradingResults] = useState<Record<string, boolean> | null>(null);

  const [isOverwriteMode, setIsOverwriteMode] = useState(false);

  const [isScratchpadOpen, setIsScratchpadOpen] = useState(false);
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
    return () => { document.head.removeChild(meta); };
  }, []);

  useEffect(() => {
    zoomRef.current = zoomLevel;
    if (zoomWrapperRef.current) zoomWrapperRef.current.style.transform = `scale(${zoomLevel})`;
  }, [zoomLevel]);

  useEffect(() => {
    const container = pdfContainerRef.current;
    const wrapper = zoomWrapperRef.current;
    if (!container || !wrapper) return;

    let initialDist = 0;
    let startZoom = 1;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoomLevel(Math.min(3.0, Math.max(0.5, zoomRef.current - e.deltaY * 0.01)));
      }
    };

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
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const scale = dist / initialDist;
        const newZoom = Math.min(3.0, Math.max(0.5, startZoom * scale));
        wrapper.style.transform = `scale(${newZoom})`;
        zoomRef.current = newZoom; 
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        wrapper.style.transition = 'transform 0.2s ease-out';
        setZoomLevel(zoomRef.current);
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);

    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  useEffect(() => {
    const { data } = supabase.storage.from("textbooks").getPublicUrl(TARGET_PDF_ID);
    setPdfUrl(data.publicUrl);
  }, []);

  useEffect(() => {
    const fetchFields = async () => {
      const { data, error } = await supabase.from("pdf_fields").select("*").eq("pdf_id", TARGET_PDF_ID).eq("page_num", currentPage).order("created_at", { ascending: true }); 
      if (data) {
        setFields(data);
        setActiveFieldId(data.length > 0 ? data[0].id : null);
      }
      setGradingResults(null);
      setZoomLevel(1);
    };
    fetchFields();
  }, [currentPage]);

  useEffect(() => {
    if (isScratchpadOpen && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 2;
      canvas.style.width = '400px';
      canvas.style.height = '450px';
      canvas.width = 400 * dpr;
      canvas.height = 450 * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.5;
    }
  }, [isScratchpadOpen]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width * (window.devicePixelRatio || 2));
    const scaleY = canvas.height / (rect.height * (window.devicePixelRatio || 2));
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.getContext("2d")) return;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
    canvas.setPointerCapture(e.pointerId);
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas || !canvas.getContext("2d")) return;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#0f172a";
    ctx.stroke();
  };

  const stopDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDrawing(false);
    if (canvasRef.current) canvasRef.current.releasePointerCapture(e.pointerId);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleKeypadClick = (key: string) => {
    if (!activeFieldId || gradingResults) return; 

    setAnswers((prevAnswers) => {
      const currentAnswer = prevAnswers[activeFieldId] || "";
      const activeField = fields.find((f) => f.id === activeFieldId);
      let newAnswer = currentAnswer;

      if (isOverwriteMode) {
        if (key === '⌫') newAnswer = "";
        else newAnswer = key;
        setIsOverwriteMode(false); 
      } else {
        if (key === '⌫') newAnswer = currentAnswer.slice(0, -1);
        else if (activeField && currentAnswer.length < activeField.max_length) newAnswer = currentAnswer + key;
      }

      if (key !== '⌫' && activeField && newAnswer.length === activeField.max_length) {
        const currentIndex = fields.findIndex((f) => f.id === activeFieldId);
        if (currentIndex !== -1 && currentIndex < fields.length - 1) {
          setTimeout(() => {
            const nextFieldId = fields[currentIndex + 1].id;
            setActiveFieldId(nextFieldId);
            setIsOverwriteMode(false);
          }, 50);
        }
      }
      return { ...prevAnswers, [activeFieldId]: newAnswer };
    });
  };

  const handleSubmit = () => {
    const results: Record<string, boolean> = {};
    fields.forEach((field) => {
      const studentAnswer = (answers[field.id] || "").trim();
      if (studentAnswer === "") return; 

      const correctAnswer = String(field.correct_answer).trim();
      results[field.id] = (studentAnswer === correctAnswer);
    });
    setGradingResults(results);
    setActiveFieldId(null); 
  };

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) { setTotalPages(numPages); }

  return (
    <div className="bg-[#F4F7FB] h-screen flex flex-col font-pretendard select-none overflow-hidden relative">
      <style>{`
        @keyframes drawStroke { to { stroke-dashoffset: 0; } }
        .pen-stroke { stroke-dasharray: 400; stroke-dashoffset: 400; animation: drawStroke 0.4s ease-out forwards; }
        @keyframes fastBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>

      <header className="absolute top-5 left-1/2 -translate-x-1/2 w-[96%] max-w-[1200px] h-16 bg-white/90 backdrop-blur-xl border border-slate-200 shadow-sm rounded-2xl z-20 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-[#002864] to-[#3b82f6] shadow-md"><span className="font-black text-xl text-white tracking-tighter">L</span></div>
          <div className="hidden sm:block"><div className="font-extrabold text-slate-800 text-sm tracking-wide">LOGICA AI MATH</div><div className="text-[11px] font-bold text-blue-600 flex items-center gap-1">이웅행 학생</div></div>
        </div>
        
        <div className="flex items-center gap-2 bg-slate-100/80 p-1 rounded-xl">
          <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="w-8 h-8 rounded-lg bg-white shadow-sm text-slate-600 font-bold hover:bg-slate-50 disabled:opacity-30">‹</button>
          <div className="px-3 text-sm font-extrabold text-slate-700 min-w-[70px] text-center">{currentPage} / {totalPages || '-'}</div>
          <button onClick={() => setCurrentPage((p) => Math.min(totalPages || 1, p + 1))} disabled={currentPage === totalPages || totalPages === null} className="w-8 h-8 rounded-lg bg-white shadow-sm text-slate-600 font-bold hover:bg-slate-50 disabled:opacity-30">›</button>
        </div>

        <div className="flex items-center gap-2 bg-slate-100/80 p-1 rounded-xl">
          <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.25))} className="w-8 h-8 rounded-lg bg-white shadow-sm text-slate-600 font-bold hover:bg-slate-50">-</button>
          <div className="text-xs font-bold text-slate-600 px-1">{Math.round(zoomLevel * 100)}%</div>
          <button onClick={() => setZoomLevel(z => Math.min(3.0, z + 0.25))} className="w-8 h-8 rounded-lg bg-white shadow-sm text-slate-600 font-bold hover:bg-slate-50">+</button>
        </div>
      </header>

      <main ref={pdfContainerRef} className="flex-1 w-full h-full overflow-y-auto overflow-x-auto flex justify-center pt-28 pb-40 custom-scrollbar touch-pan-x touch-pan-y">
        <div ref={zoomWrapperRef} className="transition-transform duration-200 origin-top h-max pb-32" style={{ transform: `scale(${zoomLevel})` }}>
          {pdfUrl && (
            <DynamicPdfViewer pdfUrl={pdfUrl} currentPage={currentPage} totalPages={totalPages} onDocumentLoadSuccess={onDocumentLoadSuccess}>
              
              {fields.map((field) => {
                const isActive = field.id === activeFieldId;
                const value = answers[field.id] || "";
                const isGraded = gradingResults !== null;
                const isCorrect = gradingResults ? gradingResults[field.id] : null;

                const handleBoxClick = () => {
                  if (isGraded) return;
                  setActiveFieldId(field.id);
                  if (answers[field.id]) setIsOverwriteMode(true); 
                  else setIsOverwriteMode(false);
                };

                return (
                  <div
                    key={field.id}
                    onClick={handleBoxClick}
                    className={`absolute flex items-center justify-center text-xl font-bold transition-all ${
                      isActive ? "text-indigo-700 z-10 scale-110" : "text-slate-800"
                    } ${!isGraded ? "cursor-pointer" : ""}`}
                    style={{
                      left: `${field.x_pos}%`, top: `${field.y_pos}%`,
                      width: `${field.width}%`, height: `${field.height}%`
                    }}
                  >
                    <span className={isActive && isOverwriteMode ? "animate-pulse text-indigo-400" : ""}>
                      {value}
                    </span>

                    {isActive && !isOverwriteMode && value.length < field.max_length && (
                      <span className="absolute bottom-0 w-3/4 h-[3px] bg-indigo-500 rounded-full" style={{ animation: 'fastBlink 0.6s infinite' }}></span>
                    )}

                    {/* 🌟 꼬리를 싹둑! 끝 좌표를 105에서 92로 끌어올려 단정하고 경쾌하게 컷팅했습니다. */}
                    {isGraded && isCorrect === true && (
                      <svg 
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30 overflow-visible" 
                        style={{ width: '220%', height: '180%', filter: 'drop-shadow(2px 3px 2px rgba(0,0,0,0.15))' }} 
                        viewBox="0 0 140 100"
                      >
                        <path 
                          className="pen-stroke" 
                          d="M 90,75 C 15,85 5,15 70,10 C 135,5 135,65 110,75 C 105,80 95,85 85,92" 
                          fill="none" 
                          stroke="#dc2626" 
                          strokeWidth="5" 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                        />
                      </svg>
                    )}
                    
                    {/* 오답 (V 빗금) 마크 */}
                    {isGraded && isCorrect === false && (
                      <svg 
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30 overflow-visible" 
                        style={{ width: '150%', height: '150%', filter: 'drop-shadow(2px 3px 2px rgba(0,0,0,0.15))' }} 
                        viewBox="0 0 100 100"
                      >
                        <path 
                          className="pen-stroke" 
                          d="M 35,55 C 40,70 45,80 50,75 C 60,55 75,30 85,20" 
                          fill="none" 
                          stroke="#dc2626" 
                          strokeWidth="6" 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                        />
                      </svg>
                    )}
                  </div>
                );
              })}
            </DynamicPdfViewer>
          )}
        </div>
      </main>

      <div className={`absolute bottom-[88px] left-6 w-[400px] h-[500px] bg-white rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.12)] border border-slate-200 z-40 flex flex-col overflow-hidden transition-transform duration-300 ease-in-out origin-bottom ${isScratchpadOpen ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-full opacity-0 scale-95 pointer-events-none'}`}>
        <div className="flex justify-between items-center px-4 py-3 bg-slate-50 border-b border-slate-100">
          <span className="font-bold text-slate-700 text-sm">✍️ 자유 연습장</span>
          <button onClick={clearCanvas} className="text-xs font-bold text-slate-500 hover:text-rose-500 px-2 py-1 bg-white border border-slate-200 rounded">전체 지우기</button>
        </div>
        <canvas ref={canvasRef} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerOut={stopDrawing} className="flex-1 bg-white touch-none cursor-crosshair" />
      </div>

      <div className="absolute bottom-0 left-0 w-full bg-white/95 backdrop-blur-xl border-t border-slate-200/50 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] py-4 px-6 z-50">
        <div className="max-w-[1000px] mx-auto flex items-center justify-between gap-4">
          <button onClick={() => setIsScratchpadOpen(!isScratchpadOpen)} className={`flex flex-col items-center justify-center w-16 h-16 rounded-2xl border transition-colors shrink-0 ${isScratchpadOpen ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
            <span className="text-2xl mb-1">✍️</span><span className="text-[10px] font-bold">{isScratchpadOpen ? '닫기' : '연습장'}</span>
          </button>
          <div className="flex-1 flex justify-center gap-2 md:gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫'].map((key, i) => (
              <button key={i} onClick={() => handleKeypadClick(key)} className={`w-12 h-16 md:w-16 md:h-16 rounded-2xl font-black text-2xl shadow-sm border-b-4 active:border-b-0 active:translate-y-1 transition-all flex items-center justify-center ${key === '⌫' ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-white border-slate-200 text-[#002864]'}`}>{key}</button>
            ))}
          </div>
          <button 
            onClick={gradingResults ? () => { setGradingResults(null); setAnswers({}); } : handleSubmit} 
            className={`w-32 h-16 border-b-4 active:border-b-0 active:translate-y-1 text-white font-extrabold text-xl rounded-2xl shadow-lg transition-all shrink-0 ${
              gradingResults 
                ? 'bg-slate-700 border-slate-900 hover:bg-slate-800' 
                : 'bg-gradient-to-t from-[#002864] to-[#00388c] border-[#001b44] hover:from-[#001b44] hover:to-[#002864]'
            }`}
          >
            {gradingResults ? '다시풀기' : '제출하기'}
          </button>
        </div>
      </div>
    </div>
  );
}