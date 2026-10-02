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

    return function Viewer({ pdfUrl, currentPage, totalPages, onDocumentLoadSuccess, onPageLoadSuccess, scale, children }: any) {
      return (
        <Document file={pdfUrl} onLoadSuccess={onDocumentLoadSuccess} options={pdfOptions} className="flex flex-col items-center">
          {totalPages && (
            <Page 
              pageNumber={currentPage} 
              renderTextLayer={false} 
              renderAnnotationLayer={false} 
              width={850} 
              onLoadSuccess={onPageLoadSuccess}
              scale={scale} 
              devicePixelRatio={typeof window !== 'undefined' ? Math.max(window.devicePixelRatio, 3) : 3}
              className="relative shadow-2xl rounded-lg overflow-hidden bg-white" 
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
    return `https://www.youtube.com/embed/${match[2]}?rel=0&modestbranding=1`;
  }
  return url; 
};

// 🌟 펜 색상 팔레트 설정
const PEN_COLORS = [
  { name: "검정", hex: "#0f172a" },
  { name: "빨강", hex: "#ef4444" },
  { name: "파랑", hex: "#3b82f6" },
  { name: "초록", hex: "#10b981" },
  { name: "노랑", hex: "#eab308" }
];

export default function NextGenMathPlatform() {
  const [pdfFiles, setPdfFiles] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");

  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [pdfBaseHeight, setPdfBaseHeight] = useState<number>(1202); 

  const [fields, setFields] = useState<PdfField[]>([]);
  const [conceptVideos, setConceptVideos] = useState<ConceptVideo[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({}); 
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null); 
  const [gradingResults, setGradingResults] = useState<Record<string, boolean> | null>(null);

  const [isOverwriteMode, setIsOverwriteMode] = useState(false);
  const [isScratchpadOpen, setIsScratchpadOpen] = useState(false);
  const [closedPopups, setClosedPopups] = useState<Set<string>>(new Set());
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);

  const [screenPenColor, setScreenPenColor] = useState<string>(PEN_COLORS[0].hex);
  const [scratchPenColor, setScratchPenColor] = useState<string>(PEN_COLORS[0].hex);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const activeScratchPointerId = useRef<number | null>(null); 
  
  const screenCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isScreenDrawingMode, setIsScreenDrawingMode] = useState(false);
  const [isScreenDrawing, setIsScreenDrawing] = useState(false);
  const isScreenDrawingModeRef = useRef(isScreenDrawingMode);
  const activeScreenPointerId = useRef<number | null>(null); 

  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const zoomWrapperRef = useRef<HTMLDivElement>(null); 
  const zoomRef = useRef(zoomLevel);

  useEffect(() => {
    isScreenDrawingModeRef.current = isScreenDrawingMode;
  }, [isScreenDrawingMode]);

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
  }, [zoomLevel]);

  useEffect(() => {
    const container = pdfContainerRef.current;
    if (!container) return;

    let initialDist = 0; let startZoom = 1;

    const onGestureStart = (e: any) => { 
      if (isScreenDrawingModeRef.current) { e.preventDefault(); return; }
      e.preventDefault(); startZoom = zoomRef.current; 
    };
    const onGestureChange = (e: any) => { 
      if (isScreenDrawingModeRef.current) { e.preventDefault(); return; }
      e.preventDefault(); setZoomLevel(Math.max(0.5, Math.min(3.0, startZoom * e.scale))); 
    };
    const onGestureEnd = (e: any) => { 
      if (isScreenDrawingModeRef.current) { e.preventDefault(); return; }
      e.preventDefault(); 
    };

    const onTouchStart = (e: TouchEvent) => {
      if (isScreenDrawingModeRef.current) return;
      if (e.touches.length === 2) {
        initialDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        startZoom = zoomRef.current;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (isScreenDrawingModeRef.current) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        if (initialDist === 0) return;
        const scale = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) / initialDist;
        setZoomLevel(Math.max(0.5, Math.min(3.0, startZoom * scale)));
      }
    };
    const onTouchEnd = (e: TouchEvent) => { 
      if (isScreenDrawingModeRef.current) return;
      if (e.touches.length < 2) { initialDist = 0; } 
    };
    const onWheel = (e: WheelEvent) => { 
      if (isScreenDrawingModeRef.current) return;
      if (e.ctrlKey) { e.preventDefault(); setZoomLevel(z => Math.max(0.5, Math.min(3.0, z - e.deltaY * 0.01))); } 
    };

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
    const fetchPdfs = async () => {
      const { data, error } = await supabase.storage.from("textbooks").list();
      if (data) {
        const pdfs = data.filter((file) => file.name && file.name.toLowerCase().endsWith(".pdf"));
        setPdfFiles(pdfs);
        if (pdfs.length > 0) setSelectedFile(pdfs[0].name);
      }
    };
    fetchPdfs();
  }, []);

  useEffect(() => {
    if (!selectedFile) return;
    const { data } = supabase.storage.from("textbooks").getPublicUrl(selectedFile);
    setPdfUrl(data.publicUrl);
    
    const fetchVideos = async () => {
      const { data } = await supabase.from('pdf_concept_videos').select('*').eq('pdf_id', selectedFile);
      if (data) setConceptVideos(data);
    };
    fetchVideos();

    setCurrentPage(1);
    setAnswers({});
    setGradingResults(null);
    setClosedPopups(new Set());
    setActiveFieldId(null);
    setIsScreenDrawingMode(false);
  }, [selectedFile]);

  useEffect(() => {
    if (!selectedFile) return;
    const fetchFields = async () => {
      const { data } = await supabase.from("pdf_fields").select("*").eq("pdf_id", selectedFile).eq("page_num", currentPage); 
      if (data) {
        const sortedData = data.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || new Date(a.created_at || "").getTime() - new Date(b.created_at || "").getTime());
        setFields(sortedData);
        const firstInput = sortedData.find((f) => f.field_type === 'input');
        setActiveFieldId(firstInput ? firstInput.id : null);
      }
      setGradingResults(null);
      setClosedPopups(new Set());
      setZoomLevel(1);
      setIsScreenDrawingMode(false);
    };
    fetchFields();
  }, [selectedFile, currentPage]);

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

  // 🌟 전체 화면 투명 필기장 해상도 초고도화 적용
  useEffect(() => {
    const timer = setTimeout(() => {
      const canvas = screenCanvasRef.current;
      if (canvas) {
        // 기존 대비 2배(x2) 해상도를 할당하여 줌 픽셀 깨짐 방지
        const dpr = (window.devicePixelRatio || 2) * 2; 
        
        if (canvas.width === 0 || canvas.width !== Math.floor(850 * dpr)) {
          canvas.width = Math.floor(850 * dpr);
          canvas.height = Math.floor(pdfBaseHeight * dpr);
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.scale(dpr, dpr);
            ctx.lineCap = "round"; 
            ctx.lineJoin = "round"; 
          }
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [currentPage, pdfUrl, pdfBaseHeight]);

  // 🌟 연습장 팝업 해상도 초고도화 적용
  useEffect(() => {
    if (isScratchpadOpen && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      
      const dpr = (window.devicePixelRatio || 2) * 2; 
      canvas.width = Math.floor(400 * dpr); 
      canvas.height = Math.floor(450 * dpr);
      ctx.scale(dpr, dpr); 
      ctx.lineCap = "round"; 
      ctx.lineJoin = "round"; 
    }
  }, [isScratchpadOpen]);

  const getScreenPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = screenCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = 850 / rect.width; 
    const scaleY = pdfBaseHeight / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const startScreenDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isScreenDrawingMode) return;
    if (activeScreenPointerId.current !== null) return; 
    activeScreenPointerId.current = e.pointerId;

    const canvas = screenCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const pos = getScreenPos(e);
    
    ctx.strokeStyle = screenPenColor;
    ctx.lineWidth = 1.5; 
    
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsScreenDrawing(true);
    canvas.setPointerCapture(e.pointerId);
  };

  const drawScreen = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isScreenDrawing || !isScreenDrawingMode) return;
    if (e.pointerId !== activeScreenPointerId.current) return; 

    const canvas = screenCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const pos = getScreenPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopScreenDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId === activeScreenPointerId.current) {
      activeScreenPointerId.current = null;
      setIsScreenDrawing(false);
      screenCanvasRef.current?.releasePointerCapture(e.pointerId);
    }
  };

  const clearScreenCanvas = () => {
    const canvas = screenCanvasRef.current;
    if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const getScratchPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = 400 / rect.width;
    const scaleY = 450 / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => { 
    if (activeScratchPointerId.current !== null) return; 
    activeScratchPointerId.current = e.pointerId;

    setIsDrawing(true); 
    const canvas = canvasRef.current!; 
    const ctx = canvas.getContext("2d")!; 
    const pos = getScratchPos(e);
    
    ctx.strokeStyle = scratchPenColor;
    ctx.lineWidth = 1.5;
    
    ctx.beginPath(); 
    ctx.moveTo(pos.x, pos.y); 
    canvas.setPointerCapture(e.pointerId); 
  };
  
  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => { 
    if (!isDrawing) return; 
    if (e.pointerId !== activeScratchPointerId.current) return;

    const canvas = canvasRef.current!; 
    const ctx = canvas.getContext("2d")!; 
    const pos = getScratchPos(e);
    ctx.lineTo(pos.x, pos.y); 
    ctx.stroke(); 
  };
  
  const stopDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => { 
    if (e.pointerId === activeScratchPointerId.current) {
      activeScratchPointerId.current = null;
      setIsDrawing(false); 
      canvasRef.current?.releasePointerCapture(e.pointerId); 
    }
  };
  
  const clearCanvas = () => { 
    const canvas = canvasRef.current; 
    if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); 
  };

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

  const handleSubmit = () => {
    const results: Record<string, boolean> = { ...(gradingResults || {}) };
    const attemptedGroups = new Set();
    fields.forEach((f) => { if ((answers[f.id] || "").trim() !== "") attemptedGroups.add(f.problem_num || f.id); });
    
    fields.forEach((field) => {
      if (field.field_type === 'video') return; 
      if (!attemptedGroups.has(field.problem_num || field.id)) return;
      if (results[field.id] === true) return; 

      if (field.field_type === 'select') {
        const isSelected = answers[field.id] === 'O';
        results[field.id] = (isSelected && field.correct_answer === 'O');
      } else {
        results[field.id] = ((answers[field.id] || "").trim() === String(field.correct_answer).trim());
      }
    });
    setGradingResults(Object.keys(results).length > 0 ? results : null);
    setActiveFieldId(null); 
    setIsScreenDrawingMode(false);
  };

  const handleResetAll = () => {
    if(!confirm("이 페이지의 입력을 모두 지우고 초기화할까요?")) return;
    setAnswers({});
    setGradingResults(null);
    setClosedPopups(new Set());
    setActiveFieldId(null);
    clearScreenCanvas();
  };

  const handlePageLoadSuccess = (page: any) => { 
    const ratio = page.originalHeight / page.originalWidth;
    setPdfBaseHeight(850 * ratio);
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

      {isScreenDrawingMode && (
        <div className="absolute bottom-[110px] left-1/2 -translate-x-1/2 bg-slate-800/90 backdrop-blur-md px-5 py-3 rounded-full shadow-2xl z-50 flex items-center gap-3 animate-fade-in border border-slate-700">
          <span className="text-white text-sm font-bold mr-2 hidden sm:inline">🖍️ 필기 중</span>
          
          <div className="flex gap-2 mr-3 border-r border-slate-600 pr-4">
            {PEN_COLORS.map(c => (
              <button
                key={c.hex}
                onClick={() => setScreenPenColor(c.hex)}
                className={`w-6 h-6 rounded-full transition-all border-2 ${screenPenColor === c.hex ? 'border-white scale-110 shadow-[0_0_8px_rgba(255,255,255,0.8)]' : 'border-transparent opacity-80 hover:opacity-100'}`}
                style={{ backgroundColor: c.hex }}
                title={c.name}
              />
            ))}
          </div>

          <button onClick={clearScreenCanvas} className="bg-slate-600 hover:bg-rose-500 text-white text-xs font-bold px-3 py-1.5 rounded-md transition-colors">지우기</button>
          <button onClick={() => setIsScreenDrawingMode(false)} className="bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold px-3 py-1.5 rounded-md transition-colors">완료</button>
        </div>
      )}

      <header className="absolute top-5 left-1/2 -translate-x-1/2 w-[96%] max-w-[1200px] h-16 bg-white/90 backdrop-blur-xl border border-slate-200 shadow-sm rounded-2xl z-30 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-[#002864] to-[#3b82f6] shadow-md shrink-0">
            <span className="font-black text-lg sm:text-xl text-white tracking-tighter">L</span>
          </div>
          <div className="flex flex-col">
            <select 
              value={selectedFile} 
              onChange={(e) => setSelectedFile(e.target.value)} 
              className="border border-slate-300 rounded p-1 text-xs sm:text-sm font-bold max-w-[140px] sm:max-w-[220px] outline-none text-slate-700 bg-white shadow-sm cursor-pointer"
            >
              {pdfFiles.length === 0 && <option value="">교재 로딩 중...</option>}
              {pdfFiles.map((file) => <option key={file.id ?? file.name} value={file.name}>{file.name}</option>)}
            </select>
            <div className="text-[10px] sm:text-[11px] font-bold text-blue-600 mt-0.5 ml-1">이웅행 학생</div>
          </div>
        </div>
        
        <div className="flex-1 flex justify-center pl-2 sm:pl-0">
          {activeConceptVideo && (
            <button onClick={() => setPlayingVideoUrl(getEmbedUrl(activeConceptVideo.video_url))} className="flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-white font-extrabold rounded-full shadow-md transition-all hover:scale-105 active:scale-95 border border-amber-300">
              <span className="text-sm sm:text-base">📺</span> <span className="text-xs sm:text-sm whitespace-nowrap">기본 이론 강의</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 bg-slate-100/80 p-1.5 px-4 rounded-xl shadow-inner mr-2 hidden sm:block"><div className="text-sm font-extrabold text-slate-700">{currentPage} / {totalPages || '-'}</div></div>
        <div className="flex items-center gap-1 sm:gap-2 bg-slate-100/80 p-1 rounded-xl shrink-0">
          <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.25))} className="w-6 h-6 sm:w-8 sm:h-8 rounded-lg bg-white shadow-sm text-slate-600 font-bold hover:bg-slate-50">-</button>
          <div className="text-[10px] sm:text-xs font-bold text-slate-600 px-1 hidden sm:block">{Math.round(zoomLevel * 100)}%</div>
          <button onClick={() => setZoomLevel(z => Math.min(3.0, z + 0.25))} className="w-6 h-6 sm:w-8 sm:h-8 rounded-lg bg-white shadow-sm text-slate-600 font-bold hover:bg-slate-50">+</button>
        </div>
      </header>

      <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="fixed left-2 sm:left-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-14 sm:h-14 bg-white/80 backdrop-blur-md border border-slate-200 shadow-lg rounded-full flex items-center justify-center text-slate-600 font-black text-xl sm:text-2xl z-40 hover:bg-white hover:scale-105 disabled:opacity-0 transition-all">‹</button>
      <button onClick={() => setCurrentPage(p => Math.min(totalPages || 1, p + 1))} disabled={currentPage === totalPages || totalPages === null} className="fixed right-2 sm:right-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-14 sm:h-14 bg-white/80 backdrop-blur-md border border-slate-200 shadow-lg rounded-full flex items-center justify-center text-slate-600 font-black text-xl sm:text-2xl z-40 hover:bg-white hover:scale-105 disabled:opacity-0 transition-all">›</button>

      <main 
        ref={pdfContainerRef} 
        style={{ touchAction: isScreenDrawingMode ? 'none' : 'pan-x pan-y' }} 
        className={`flex-1 w-full h-full overflow-auto pt-24 pb-28 custom-scrollbar ${isScreenDrawingMode ? 'overflow-hidden' : ''}`}
      >
        <div 
          style={{ 
            width: `${850 * zoomLevel}px`, 
            height: `${pdfBaseHeight * zoomLevel}px`, 
            transition: 'width 0.2s, height 0.2s',
            margin: '0 auto', 
            position: 'relative'
          }}
        >
          <div 
            ref={zoomWrapperRef} 
            style={{ 
              transform: `scale(${zoomLevel})`, 
              transformOrigin: 'top left', 
              width: '850px', 
              height: `${pdfBaseHeight}px`,
              transition: 'transform 0.2s ease-out'
            }}
          >
            {pdfUrl ? (
              <DynamicPdfViewer pdfUrl={pdfUrl} currentPage={currentPage} totalPages={totalPages} onDocumentLoadSuccess={onDocumentLoadSuccess} onPageLoadSuccess={handlePageLoadSuccess}>
                
                <canvas
                  ref={screenCanvasRef}
                  onPointerDown={startScreenDrawing}
                  onPointerMove={drawScreen}
                  onPointerUp={stopScreenDrawing}
                  onPointerOut={stopScreenDrawing}
                  className={`absolute top-0 left-0 w-full h-full z-[5] ${isScreenDrawingMode ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'}`}
                />
                
                {fields.map((field) => {
                  const isActive = field.id === activeFieldId;
                  const value = answers[field.id] || "";
                  
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
                    
                    if (isCorrect === true) return; 

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
                    <div 
                      key={field.id} 
                      onClick={handleBoxClick} 
                      className={`absolute flex flex-col items-center justify-center text-xl font-bold transition-all z-10 ${isActive && !isSelectType && !isVideoType ? "text-indigo-700 scale-110" : "text-slate-800"} ${(!isFieldGraded || isVideoType || isCorrect === false) ? "cursor-pointer" : ""}`} 
                      style={{ left: `${field.x_pos}%`, top: `${field.y_pos}%`, width: `${field.width}%`, height: `${field.height}%` }}
                    >
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

                {gradingResults && Object.keys(problemGroups).map(groupId => {
                  if (closedPopups.has(groupId)) return null; 

                  const group = problemGroups[groupId];
                  if (group.fields.length === 0) return null; 
                  
                  const isGroupWrong = group.fields.some(f => gradingResults[f.id] === false);
                  if (!isGroupWrong) return null;

                  return (
                    <div key={`popup-${groupId}`} className="absolute flex flex-col items-center bg-slate-800/95 backdrop-blur-sm px-2.5 py-2 rounded-xl shadow-xl z-50 animate-pop-up pointer-events-auto border border-slate-700" style={{ left: `${group.bottomX}%`, top: `calc(${group.bottomY}% + 15px)`, transform: 'translateX(-50%)' }}>
                      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-800/95 rotate-45 border-t border-l border-slate-700"></div>
                      
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
            ) : (
              <div className="w-full h-[80vh] flex flex-col items-center justify-center text-slate-400 font-bold gap-3">
                <span className="text-4xl">📚</span>
                <span>왼쪽 위 드롭다운에서 풀이할 교재를 선택해 주세요.</span>
              </div>
            )}
          </div>
        </div>
      </main>

      <div className={`absolute bottom-[100px] left-6 w-[350px] sm:w-[400px] h-[400px] sm:h-[500px] bg-white rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.12)] border border-slate-200 z-40 flex flex-col overflow-hidden transition-transform duration-300 ease-in-out origin-bottom ${isScratchpadOpen ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-full opacity-0 scale-95 pointer-events-none'}`}>
        <div className="flex justify-between items-center px-4 py-3 bg-slate-50 border-b border-slate-100">
          <span className="font-bold text-slate-700 text-sm">✍️ 자유 연습장</span>
          
          <div className="flex items-center gap-1.5">
            {PEN_COLORS.map(c => (
              <button
                key={c.hex}
                onClick={() => setScratchPenColor(c.hex)}
                className={`w-5 h-5 rounded-full transition-all border-2 ${scratchPenColor === c.hex ? 'border-slate-500 scale-110 shadow-sm' : 'border-transparent opacity-80 hover:opacity-100'}`}
                style={{ backgroundColor: c.hex }}
                title={c.name}
              />
            ))}
            <button onClick={clearCanvas} className="text-xs font-bold text-slate-500 hover:text-rose-500 px-2 py-1 ml-2 bg-white border border-slate-200 rounded">전체 지우기</button>
          </div>
        </div>
        <canvas ref={canvasRef} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerOut={stopDrawing} className="flex-1 bg-white touch-none cursor-crosshair" />
      </div>

      <div className="absolute bottom-0 left-0 w-full bg-white/95 backdrop-blur-xl border-t border-slate-200/50 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] py-3 px-2 sm:px-6 z-50">
        <div className="max-w-[1000px] mx-auto flex items-center justify-between gap-1.5 sm:gap-4 w-full">
          
          <div className="flex gap-1.5 sm:gap-2">
            <button 
              onClick={() => setIsScreenDrawingMode(!isScreenDrawingMode)} 
              className={`flex flex-col items-center justify-center w-12 h-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl border transition-colors shrink-0 shadow-sm ${isScreenDrawingMode ? 'bg-indigo-600 border-indigo-700 text-white animate-pulse' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <span className="text-xl sm:text-2xl mb-0.5">🖍️</span><span className="text-[9px] sm:text-[10px] font-bold">{isScreenDrawingMode ? '필기 중' : '화면 필기'}</span>
            </button>
            <button onClick={() => setIsScratchpadOpen(!isScratchpadOpen)} className={`flex flex-col items-center justify-center w-12 h-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl border transition-colors shrink-0 ${isScratchpadOpen ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
              <span className="text-xl sm:text-2xl mb-0.5">✍️</span><span className="text-[9px] sm:text-[10px] font-bold">{isScratchpadOpen ? '닫기' : '연습장'}</span>
            </button>
            <button onClick={handleResetAll} className="flex flex-col items-center justify-center w-12 h-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl border transition-colors shrink-0 bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-rose-500 hidden sm:flex">
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
          
          <button onClick={handleSubmit} className="w-24 sm:w-32 h-14 sm:h-16 border-b-4 active:border-b-0 active:translate-y-1 text-white font-extrabold text-sm sm:text-xl rounded-xl sm:rounded-2xl shadow-lg transition-all shrink-0 bg-gradient-to-t from-[#002864] to-[#00388c] border-[#001b44] hover:from-[#001b44] hover:to-[#002864]">
            채점하기
          </button>
        </div>
      </div>
    </div>
  );
}