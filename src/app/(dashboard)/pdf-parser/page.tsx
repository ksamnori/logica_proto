// src/app/(dashboard)/pdf-parser/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// UUID 강제 생성 헬퍼
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
};

const applySafeCleaner = (text: string) => {
  if (!text) return text;
  let cleaned = text.replace(/@@/g, '\\').replace(/<{/g, '{').replace(/}>/g, '}');
  cleaned = cleaned.replace(/\xa0/g, ' ').replace(/\u200b/g, '');
  cleaned = cleaned.replace(/∠/g, '\\angle ').replace(/°/g, '^{\\circ}');
  cleaned = cleaned.replace(/\\?degree\b/g, '^{\\circ}');
  return cleaned.trim();
};

export default function PdfParserPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [pdfjsLoaded, setPdfjsLoaded] = useState(false);
  const [ocrLoaded, setOcrLoaded] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageNum, setPageNum] = useState<number>(1);
  const [numPages, setNumPages] = useState<number>(0);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mathJaxRef = useRef<boolean>(false);
  
  const isCroppingRef = useRef(false);
  const cropStartRef = useRef<{x: number, y: number} | null>(null);
  const cropRectRef = useRef<{x: number, y: number, w: number, h: number} | null>(null);

  const [activeCropTarget, setActiveCropTarget] = useState<{ id: string, field: 'blob' | 'blob2' | 'answerBlob' } | null>(null);

  const [bookTitle, setBookTitle] = useState("");
  const [currentQNum, setCurrentQNum] = useState<number>(1);
  const [isDragOver, setIsDragOver] = useState(false);

  const [parsedItems, setParsedItems] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const [aiStartPage, setAiStartPage] = useState<number>(1);
  const [aiEndPage, setAiEndPage] = useState<number>(1);
  const [isAiScanning, setIsAiScanning] = useState(false);
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    const checkAccess = () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER' || 
                        pos.includes('최고관리자') || pos.includes('원장') || 
                        pos.includes('부원장') || pos.includes('실장') || pos.includes('전임강사');
      if (isGodMode) setIsAuthorized(true);
      else { alert("⛔ 권한이 없습니다."); router.replace("/home"); }
    };
    checkAccess();

    if (!(window as any).pdfjsLib) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        setPdfjsLoaded(true);
      };
      document.head.appendChild(script);
    } else { setPdfjsLoaded(true); }

    if (!(window as any).Tesseract) {
      const scriptOCR = document.createElement('script');
      scriptOCR.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      scriptOCR.onload = () => setOcrLoaded(true);
      document.head.appendChild(scriptOCR);
    } else { setOcrLoaded(true); }

    if (!document.getElementById("MathJax-script") && !mathJaxRef.current) {
      mathJaxRef.current = true;
      (window as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] }, startup: { typeset: false } };
      const script = document.createElement("script"); script.id = "MathJax-script"; script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"; script.async = true;
      document.head.appendChild(script);
    }
  }, [router]);

  useEffect(() => {
    const renderMath = () => {
      if ((window as any).MathJax && (window as any).MathJax.typesetPromise) {
        (window as any).MathJax.typesetPromise().catch((err: any) => console.log("MathJax 에러:", err));
      }
    };
    const timer = setTimeout(renderMath, 150);
    return () => clearTimeout(timer);
  }, [parsedItems]);

  const renderPage = async (num: number, pdf: any = pdfDoc) => {
    if (!pdf || !canvasRef.current) return;
    try {
      const page = await pdf.getPage(num);
      const viewport = page.getViewport({ scale: 2.0 }); 
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    } catch (e) { console.error("PDF 렌더링 에러:", e); }
  };

  useEffect(() => {
    if (pdfDoc && !isAiScanning) renderPage(pageNum);
  }, [pageNum, pdfDoc, isAiScanning]);

  const handlePdfDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!pdfjsLoaded) return alert("파싱 엔진 로딩 중입니다.");

    const file = e.dataTransfer.files[0];
    if (file && file.type === "application/pdf") {
      setBookTitle(file.name.replace(/\.pdf$/i, ''));
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await (window as any).pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      setPageNum(1);
      setAiStartPage(1);
      setAiEndPage(pdf.numPages);
    } else { alert("PDF 파일만 인식할 수 있습니다."); }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pdfjsLoaded) return;
    setBookTitle(file.name.replace(/\.pdf$/i, ''));
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await (window as any).pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    setPdfDoc(pdf);
    setNumPages(pdf.numPages);
    setPageNum(1);
    setAiStartPage(1);
    setAiEndPage(pdf.numPages);
  };

  const runAiFullScan = async () => {
    if (!pdfDoc) return;
    if (aiStartPage > aiEndPage) return alert("시작 페이지가 끝 페이지보다 클 수 없습니다.");

    setIsAiScanning(true);
    setAiProgress({ current: 0, total: aiEndPage - aiStartPage + 1 });
    
    let lastKnownPrintedPage: number | null = null;
    let autoIncQNum = currentQNum;

    try {
      for (let i = aiStartPage; i <= aiEndPage; i++) {
        setPageNum(i); 
        setAiProgress(p => ({ ...p, current: i - aiStartPage + 1 }));

        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); 
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;
        const ctx = tempCanvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        
        const base64Image = tempCanvas.toDataURL('image/jpeg', 0.5);

        const res = await fetch('/api/gemini-parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64Image })
        });

        const contentType = res.headers.get("content-type");
        let data;
        
        if (contentType?.includes("application/json")) {
          data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(`AI 서버 오류: ${data.error}`); 
          }
        } else {
          const text = await res.text();
          throw new Error(`네트워크 오류 (${res.status}): ${text.substring(0, 100)}...`);
        }

        const probItems = data.data.problems || [];
        
        let currentPrintedPage: number | null = null;
        for (const item of probItems) {
          const rawPage = String(item.final_printed_page || "");
          const cleaned = rawPage.replace(/\D/g, '').replace(/^0+/, '');
          if (cleaned) {
            currentPrintedPage = parseInt(cleaned);
            break;
          }
        }

        if (currentPrintedPage === null && lastKnownPrintedPage !== null) currentPrintedPage = lastKnownPrintedPage + 1;
        if (currentPrintedPage !== null) lastKnownPrintedPage = currentPrintedPage;

        const seenQuestions = new Set();
        
        for (const item of probItems) {
          let qNum = String(item.question_number || "").trim().replace(/^0+/, '');
          if (!qNum || qNum.toLowerCase() === "none" || qNum.toLowerCase() === "null") continue;

          let cleanQText = applySafeCleaner(item.question);

          if (qNum.includes("개념") || qNum.toUpperCase().includes("QUIZ") || qNum.includes("노트")) {
            qNum = "Q";
          } else if (qNum.includes("확인")) {
            qNum = qNum.replace(/\s/g, "");
          } else if (/^확인\s*\d+/.test(cleanQText) && !qNum.includes("확인")) {
            qNum = `확인${qNum}`.replace(/\s/g, "");
          }

          const normalizedText = cleanQText.replace(/\s+/g, '');
          if (seenQuestions.has(normalizedText)) continue;
          seenQuestions.add(normalizedText);

          setParsedItems(prev => [...prev, {
            id: generateUUID(),
            qNum: qNum === "Q" ? autoIncQNum : qNum,
            pageNum: currentPrintedPage ? String(currentPrintedPage) : String(i),
            difficulty: '중', // 🌟 AI 생성 시 기본 난이도 '중'
            blob: undefined, 
            preview: undefined,
            questionText: cleanQText,
            answer: '',
            isExtracting: false,
            isPreviewMode: false
          }]);

          if (qNum !== "Q" && !isNaN(parseInt(qNum))) {
            autoIncQNum = parseInt(qNum) + 1;
          }
        }
      }
      setCurrentQNum(autoIncQNum);
      alert("🎉 전수 스캔이 완료되었습니다! 우측 대기열에서 텍스트를 확인하고 필요시 이미지를 크롭하여 끼워넣으세요.");
    } catch (e: any) {
      alert("🚨 전수 스캔 중 오류 발생: " + e.message); 
    } finally {
      setIsAiScanning(false);
      renderPage(pageNum); 
    }
  };


  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!pdfDoc) return;
    isCroppingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    cropStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    cropRectRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, w: 0, h: 0 };
    
    if (overlayRef.current) {
      overlayRef.current.style.display = 'none';
      if (activeCropTarget?.field === 'blob2') overlayRef.current.className = "absolute border-[3px] border-violet-500 bg-violet-500/20 pointer-events-none hidden z-20";
      else if (activeCropTarget?.field === 'answerBlob') overlayRef.current.className = "absolute border-[3px] border-emerald-500 bg-emerald-500/20 pointer-events-none hidden z-20";
      else overlayRef.current.className = "absolute border-[3px] border-indigo-500 bg-indigo-500/20 pointer-events-none hidden z-20";
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCroppingRef.current || !cropStartRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const newRect = {
      x: Math.min(cropStartRef.current.x, e.clientX - rect.left),
      y: Math.min(cropStartRef.current.y, e.clientY - rect.top),
      w: Math.abs(e.clientX - rect.left - cropStartRef.current.x),
      h: Math.abs(e.clientY - rect.top - cropStartRef.current.y)
    };
    cropRectRef.current = newRect;

    if (overlayRef.current) {
      overlayRef.current.style.display = 'block';
      overlayRef.current.style.left = `${newRect.x}px`;
      overlayRef.current.style.top = `${newRect.y}px`;
      overlayRef.current.style.width = `${newRect.w}px`;
      overlayRef.current.style.height = `${newRect.h}px`;
    }
  };

  const handleMouseUp = async () => {
    if (!isCroppingRef.current) return;
    isCroppingRef.current = false; 
    if (overlayRef.current) overlayRef.current.style.display = 'none';
    
    const box = cropRectRef.current;
    if (!box || box.w < 20 || box.h < 20 || !canvasRef.current) { cropRectRef.current = null; return; }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = box.w * scaleX; tempCanvas.height = box.h * scaleY;
    const tCtx = tempCanvas.getContext('2d');
    if (!tCtx) return;

    tCtx.drawImage(canvas, box.x * scaleX, box.y * scaleY, box.w * scaleX, box.h * scaleY, 0, 0, tempCanvas.width, tempCanvas.height);
    const blob = await new Promise<Blob | null>(res => tempCanvas.toBlob(res, 'image/png'));
    if (!blob) return;

    const previewUrl = URL.createObjectURL(blob);
    
    if (activeCropTarget) {
      setParsedItems(prev => prev.map(item => {
        if (item.id === activeCropTarget.id) {
          if (activeCropTarget.field === 'blob') return { ...item, blob: blob, preview: previewUrl };
          if (activeCropTarget.field === 'blob2') return { ...item, blob2: blob, preview2: previewUrl };
          if (activeCropTarget.field === 'answerBlob') return { ...item, answerBlob: blob, answerPreview: previewUrl };
        }
        return item;
      }));
      setActiveCropTarget(null); 
    } else {
      setParsedItems(prev => [...prev, {
        id: generateUUID(),
        qNum: String(currentQNum),
        pageNum: String(pageNum),
        difficulty: '중', // 🌟 수동 드래그 생성 시 기본 난이도 '중'
        blob: blob, preview: previewUrl,
        blob2: undefined, preview2: undefined,
        answerBlob: undefined, answerPreview: undefined,
        answer: '', questionText: '', isExtracting: false,
        isPreviewMode: false 
      }]);
      setCurrentQNum(prev => prev + 1);
    }
    cropRectRef.current = null; 
  };

  const updateItem = (id: string, field: string, value: any) => { setParsedItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item)); };
  const removeItem = (id: string) => { 
    setParsedItems(prev => prev.filter(item => item.id !== id));
    if (activeCropTarget?.id === id) setActiveCropTarget(null);
  };

  const handleExtractText = async (id: string, imageUrl: string) => {
    if (!ocrLoaded || !(window as any).Tesseract) return alert("OCR 엔진 로딩 중입니다.");
    updateItem(id, 'isExtracting', true);
    try {
      const result = await (window as any).Tesseract.recognize(imageUrl, 'kor+eng');
      updateItem(id, 'questionText', result.data.text);
    } catch (e) { alert("텍스트 추출 실패"); } finally { updateItem(id, 'isExtracting', false); }
  };

  const uploadToDb = async () => {
    if (!bookTitle) return alert("교재명을 입력해주세요.");
    if (parsedItems.length === 0) return alert("추출된 문항이 없습니다.");
    
    setIsUploading(true);
    try {
      let insertedCount = 0;
      for (const item of parsedItems) {
        
        let mainUrl = null;
        if (item.blob) {
          const fileName1 = `parsed_1_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
          await supabase.storage.from('system_images').upload(`questions/${fileName1}`, item.blob);
          mainUrl = supabase.storage.from('system_images').getPublicUrl(`questions/${fileName1}`).data.publicUrl;
        }

        let image2Url = null;
        if (item.blob2) {
          const fileName2 = `parsed_2_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
          await supabase.storage.from('system_images').upload(`questions/${fileName2}`, item.blob2);
          image2Url = supabase.storage.from('system_images').getPublicUrl(`questions/${fileName2}`).data.publicUrl;
        }

        let answerImgUrl = null;
        if (item.answerBlob) {
          const fileNameA = `parsed_A_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
          await supabase.storage.from('system_images').upload(`questions/${fileNameA}`, item.answerBlob);
          answerImgUrl = supabase.storage.from('system_images').getPublicUrl(`questions/${fileNameA}`).data.publicUrl;
        }
        
        const finalQuestionText = item.questionText.trim() ? item.questionText.trim() : '수동 이미지 추출 문항';

        // 🌟 [핵심] difficulty를 null이 아닌 item.difficulty(최상,상,중,하,최하)로 올바르게 전송
        const { error: dbErr } = await supabase.from('question_db').insert({
          question_id: item.id,
          source_book_name: bookTitle,
          detected_page_num: parseInt(item.pageNum) || 0,
          final_printed_page: item.pageNum || null,
          question_number: item.qNum || '0',
          image_url: mainUrl,
          image_2_url: image2Url,
          answer_image_url: answerImgUrl,
          question: finalQuestionText, 
          answer: item.answer || null,
          taxonomy_id: null,
          difficulty: item.difficulty || '중', 
          is_human_verified: true
        });

        if (dbErr) throw dbErr;
        insertedCount++;
      }

      alert(`✅ ${insertedCount}개의 문항이 문제은행에 완벽히 적재되었습니다!`);
      setParsedItems([]); setActiveCropTarget(null);
    } catch (e: any) { alert("업로드 중 오류 발생: " + e.message); } finally { setIsUploading(false); }
  };

  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">권한 확인 중...</div>;
  if (isAuthorized === false) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-4 sm:p-6 overflow-hidden gap-4">
      
      <div className="bg-slate-900 rounded-2xl p-6 shadow-lg flex flex-col xl:flex-row justify-between items-center shrink-0 gap-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <span>✂️</span> PDF 자동 분해 파서 <span className="text-xs bg-indigo-500 text-indigo-50 px-2 py-0.5 rounded ml-2">Auto Parser</span>
          </h1>
          <p className="text-sm font-bold text-slate-400 mt-1">AI를 통해 텍스트를 자동 추출하거나 마우스로 드래그하여 이미지를 잘라냅니다.</p>
        </div>

        <div className="flex items-center gap-4 bg-slate-800 p-3 rounded-xl border border-slate-700 w-full xl:w-auto">
          <div className="flex flex-col gap-1 flex-1 xl:w-64">
            <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">저장될 마스터 교재명</label>
            <input type="text" value={bookTitle} onChange={e => setBookTitle(e.target.value)} placeholder="PDF를 드롭하면 자동입력" className="px-3 py-1.5 bg-slate-900 text-white border border-slate-600 rounded-lg text-sm font-bold focus:outline-none focus:border-indigo-500" />
          </div>
          <div className="flex flex-col gap-1 w-24">
            <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">시작 번호</label>
            <input type="number" value={currentQNum} onChange={e => setCurrentQNum(parseInt(e.target.value)||1)} className="px-3 py-1.5 bg-slate-900 text-white border border-slate-600 rounded-lg text-sm font-black focus:outline-none focus:border-indigo-500 text-center" />
          </div>
        </div>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        
        {/* 좌측: PDF 뷰어 및 크롭퍼 */}
        <div className="flex-[2] bg-slate-800 rounded-2xl border border-slate-700 shadow-sm flex flex-col overflow-hidden relative">
          
          <div className="p-3 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center shrink-0">
            <h2 className="font-extrabold text-white text-sm flex items-center gap-2">
              📄 PDF 원본 뷰어
              {ocrLoaded && <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30">OCR 엔진 ON</span>}
            </h2>

            {pdfDoc && (
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 bg-indigo-500/20 border border-indigo-500/50 p-1 rounded-lg">
                  <span className="text-xs font-bold text-indigo-200 ml-2">AI 스캔 구간:</span>
                  <input type="number" value={aiStartPage} onChange={e=>setAiStartPage(Number(e.target.value))} className="w-12 px-1 py-0.5 text-center text-xs font-bold bg-slate-900 text-white border border-slate-600 rounded" />
                  <span className="text-slate-400 text-xs">~</span>
                  <input type="number" value={aiEndPage} onChange={e=>setAiEndPage(Number(e.target.value))} className="w-12 px-1 py-0.5 text-center text-xs font-bold bg-slate-900 text-white border border-slate-600 rounded" />
                  <button onClick={runAiFullScan} disabled={isAiScanning} className="ml-2 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black rounded shadow-sm disabled:opacity-50 transition-colors flex items-center gap-1">
                    {isAiScanning ? `처리중... ${aiProgress.current}/${aiProgress.total}` : "🤖 AI 자동 추출 시작"}
                  </button>
                </div>

                <div className="flex items-center gap-3 bg-slate-800 rounded-lg p-1 border border-slate-600 shadow-sm">
                  <button onClick={() => setPageNum(p => Math.max(1, p - 1))} disabled={pageNum <= 1 || isAiScanning} className="px-3 py-1 hover:bg-slate-700 text-white rounded text-xs font-bold disabled:opacity-30">◀ 이전</button>
                  <span className="text-xs font-black text-indigo-300 w-16 text-center">{pageNum} / {numPages}</span>
                  <button onClick={() => setPageNum(p => Math.min(numPages, p + 1))} disabled={pageNum >= numPages || isAiScanning} className="px-3 py-1 hover:bg-slate-700 text-white rounded text-xs font-bold disabled:opacity-30">다음 ▶</button>
                </div>
              </div>
            )}
          </div>

          <div 
            className={`flex-1 overflow-auto custom-scroll relative ${!pdfDoc ? 'flex items-center justify-center p-8' : 'p-6 bg-slate-700'}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handlePdfDrop}
          >
            {activeCropTarget && (
              <div className="sticky top-0 left-0 w-full bg-yellow-400/90 text-yellow-900 font-black text-sm p-3 mb-4 text-center rounded shadow-lg z-30 pointer-events-none backdrop-blur animate-pulse">
                현재 타겟 모드 작동 중! 마우스로 드래그하면 선택한 곳에 이미지가 추가됩니다.
              </div>
            )}

            {!pdfDoc ? (
              <div className={`w-full max-w-lg p-10 border-2 border-dashed rounded-2xl text-center transition-colors cursor-pointer ${isDragOver ? "border-indigo-500 bg-indigo-500/10" : "border-slate-600 hover:border-slate-500 hover:bg-slate-700/50"}`} onClick={() => document.getElementById('pdfInput')?.click()}>
                <input id="pdfInput" type="file" accept=".pdf" onChange={handleFileInput} className="hidden" />
                <span className="text-5xl block mb-4 opacity-80">📁</span>
                <p className="text-lg font-extrabold text-white mb-2">여기에 PDF 파일을 끌어다 놓으세요</p>
                <p className="text-sm font-medium text-slate-400">클릭해서 파일을 선택하셔도 됩니다.</p>
              </div>
            ) : (
              <div className="relative mx-auto shadow-2xl" style={{ width: 'fit-content' }}>
                <canvas ref={canvasRef} className="block max-w-full h-auto bg-white rounded" />
                {!isAiScanning && (
                  <>
                    <div 
                      className="absolute inset-0 cursor-crosshair z-10"
                      onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
                    />
                    <div ref={overlayRef} className="absolute border-[3px] border-indigo-500 bg-indigo-500/20 pointer-events-none hidden z-20" />
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 우측: 추출된 문항 큐(Queue) */}
        <div className="flex-1 w-[450px] md:min-w-[450px] bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden shrink-0">
          
          <div className="p-4 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center shrink-0">
            <div>
              <h2 className="font-extrabold text-indigo-900 text-sm flex items-center gap-1.5">
                <span>📥</span> 추출 대기열
              </h2>
              <p className="text-[10px] font-bold text-indigo-500 mt-0.5">드래그한 이미지나 AI 추출 데이터가 쌓입니다.</p>
            </div>
            <span className="bg-indigo-600 text-white font-black text-xs px-2 py-1 rounded-lg">{parsedItems.length}개 대기중</span>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-4 bg-slate-50/50">
            {parsedItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <span className="text-4xl mb-2 opacity-30">✂️</span>
                <span className="text-sm font-bold">좌측에서 영역을 잘라내거나 AI 자동 추출을 실행하세요.</span>
              </div>
            ) : (
              parsedItems.map((item) => {
                const isTargetBlob = activeCropTarget?.id === item.id && activeCropTarget?.field === 'blob';
                const isTargetBlob2 = activeCropTarget?.id === item.id && activeCropTarget?.field === 'blob2';
                const isTargetAnswer = activeCropTarget?.id === item.id && activeCropTarget?.field === 'answerBlob';
                const isAnyTarget = activeCropTarget?.id === item.id;

                return (
                  <div key={item.id} className={`bg-white border rounded-xl p-4 shadow-sm transition-all relative group flex flex-col gap-3 ${isAnyTarget ? 'border-indigo-400 shadow-indigo-100/50 ring-1 ring-indigo-400' : 'border-slate-200 hover:border-indigo-300'}`}>
                    <button onClick={() => removeItem(item.id)} className="absolute top-3 right-3 w-7 h-7 bg-rose-50 text-rose-500 rounded-lg flex items-center justify-center font-bold text-sm hover:bg-rose-100 transition-colors z-10 opacity-0 group-hover:opacity-100">✕</button>
                    
                    {/* 🌟 1. 페이지 / 번호 / 난이도 입력칸 */}
                    <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100 pr-8">
                      <div className="flex items-center gap-1.5 flex-[0.8] min-w-0">
                        <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap shrink-0">페이지:</span>
                        <input type="text" value={item.pageNum} onChange={(e) => updateItem(item.id, 'pageNum', e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs font-bold text-indigo-700 outline-none focus:ring-1 focus:ring-indigo-500 bg-white shadow-sm" />
                      </div>
                      <div className="flex items-center gap-1.5 flex-[0.8] min-w-0">
                        <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap shrink-0">번호:</span>
                        <input type="text" value={item.qNum} onChange={(e) => updateItem(item.id, 'qNum', e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs font-bold text-indigo-700 outline-none focus:ring-1 focus:ring-indigo-500 bg-white shadow-sm" />
                      </div>
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap shrink-0">난이도:</span>
                        <select value={item.difficulty} onChange={(e) => updateItem(item.id, 'difficulty', e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs font-bold text-indigo-700 outline-none focus:ring-1 focus:ring-indigo-500 bg-white shadow-sm">
                          <option value="최상">최상</option>
                          <option value="상">상</option>
                          <option value="중">중</option>
                          <option value="하">하</option>
                          <option value="최하">최하</option>
                        </select>
                      </div>
                    </div>
                    
                    <div className="flex flex-col gap-2">
                      {item.preview ? (
                        <div className="relative w-full h-40 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center p-2 overflow-hidden shadow-sm">
                          <img src={item.preview} alt="메인 문제" className="max-w-full max-h-full object-contain mix-blend-multiply" />
                          <span className="absolute bottom-2 left-2 bg-slate-700/80 text-white text-[10px] px-2 py-1 rounded font-bold backdrop-blur-sm">메인 이미지</span>
                          <button onClick={() => { updateItem(item.id, 'blob', undefined); updateItem(item.id, 'preview', undefined); }} className="absolute top-2 right-2 bg-white/90 rounded-full w-6 h-6 flex items-center justify-center shadow text-rose-500 text-[12px] leading-none hover:bg-white hover:text-rose-600 transition-colors">✕</button>
                        </div>
                      ) : (
                        <button onClick={() => setActiveCropTarget(isTargetBlob ? null : {id: item.id, field: 'blob'})} className={`w-full h-24 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-[11px] font-bold transition-colors shadow-sm ${isTargetBlob ? 'bg-indigo-100 border-indigo-400 text-indigo-700' : 'bg-slate-50 border-slate-300 text-slate-400 hover:bg-slate-100 hover:text-slate-500'}`}>
                          <span className="text-2xl mb-1">+</span>
                          <span>메인 이미지 채우기</span>
                          {isTargetBlob && <span className="text-[9px] text-indigo-600 mt-1 font-black animate-pulse">드래그 대기중...</span>}
                        </button>
                      )}
                      
                      <div className="grid grid-cols-2 gap-2">
                        {item.preview2 ? (
                          <div className="relative h-28 bg-violet-50 rounded-lg border border-violet-200 flex items-center justify-center p-1 shadow-sm">
                            <img src={item.preview2} alt="추가 문제" className="max-w-full max-h-full object-contain mix-blend-multiply" />
                            <span className="absolute bottom-1 left-1 bg-violet-600/70 text-white text-[9px] px-1.5 py-0.5 rounded font-bold backdrop-blur-sm">문제 이미지 2</span>
                            <button onClick={() => { updateItem(item.id, 'blob2', undefined); updateItem(item.id, 'preview2', undefined); }} className="absolute top-1 right-1 bg-white/90 rounded-full w-5 h-5 flex items-center justify-center shadow text-rose-500 text-[12px] leading-none hover:bg-white hover:text-rose-600 transition-colors">✕</button>
                          </div>
                        ) : (
                          <button onClick={() => setActiveCropTarget(isTargetBlob2 ? null : {id: item.id, field: 'blob2'})} className={`h-28 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-[11px] font-bold transition-colors shadow-sm ${isTargetBlob2 ? 'bg-violet-100 border-violet-400 text-violet-700' : 'bg-slate-50 border-slate-300 text-slate-400 hover:bg-slate-100 hover:text-slate-500'}`}>
                            <span className="text-2xl mb-1">+</span>
                            <span>문제 이미지 추가</span>
                            {isTargetBlob2 && <span className="text-[9px] text-violet-600 mt-1 font-black animate-pulse">드래그 대기중...</span>}
                          </button>
                        )}

                        {item.answerPreview ? (
                          <div className="relative h-28 bg-emerald-50 rounded-lg border border-emerald-200 flex items-center justify-center p-1 shadow-sm">
                            <img src={item.answerPreview} alt="정답 이미지" className="max-w-full max-h-full object-contain mix-blend-multiply" />
                            <span className="absolute bottom-1 left-1 bg-emerald-600/70 text-white text-[9px] px-1.5 py-0.5 rounded font-bold backdrop-blur-sm">정답 이미지</span>
                            <button onClick={() => { updateItem(item.id, 'answerBlob', undefined); updateItem(item.id, 'answerPreview', undefined); }} className="absolute top-1 right-1 bg-white/90 rounded-full w-5 h-5 flex items-center justify-center shadow text-rose-500 text-[12px] leading-none hover:bg-white hover:text-rose-600 transition-colors">✕</button>
                          </div>
                        ) : (
                          <button onClick={() => setActiveCropTarget(isTargetAnswer ? null : {id: item.id, field: 'answerBlob'})} className={`h-28 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-[11px] font-bold transition-colors shadow-sm ${isTargetAnswer ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'bg-slate-50 border-slate-300 text-slate-400 hover:bg-slate-100 hover:text-slate-500'}`}>
                            <span className="text-2xl mb-1">+</span>
                            <span>정답 이미지 추가</span>
                            {isTargetAnswer && <span className="text-[9px] text-emerald-600 mt-1 font-black animate-pulse">드래그 대기중...</span>}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-500">문제 텍스트</span>
                        <div className="flex items-center gap-1.5">
                          <button 
                            onClick={() => updateItem(item.id, 'isPreviewMode', !item.isPreviewMode)}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors shadow-sm ${item.isPreviewMode ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                          >
                            {item.isPreviewMode ? <><span>✏️</span> 텍스트 편집 모드</> : <><span>👀</span> 수식 미리보기</>}
                          </button>

                          {item.preview && !item.isPreviewMode && (
                            <button 
                              onClick={() => handleExtractText(item.id, item.preview)} 
                              disabled={item.isExtracting}
                              className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded text-[10px] font-bold transition-colors shadow-sm disabled:opacity-50"
                            >
                              {item.isExtracting ? <span className="animate-pulse">분석 중...</span> : <><span>🪄</span> OCR 추출</>}
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {item.isPreviewMode ? (
                        <div className="w-full min-h-[4rem] px-2 py-1.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 bg-white whitespace-pre-wrap overflow-x-auto shadow-inner">
                          {item.questionText || <span className="text-slate-400 italic text-xs">텍스트가 없습니다.</span>}
                        </div>
                      ) : (
                        <textarea 
                          placeholder="추출된 문제 텍스트가 이곳에 들어갑니다. (직접 수정 가능)" 
                          value={item.questionText} 
                          onChange={(e) => updateItem(item.id, 'questionText', e.target.value)} 
                          className="w-full h-16 px-2 py-1.5 border border-slate-300 rounded text-xs font-medium text-slate-700 outline-none focus:ring-1 focus:ring-indigo-500 resize-y bg-yellow-50/30"
                        />
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-1 rounded border border-emerald-100 whitespace-nowrap">정답 텍스트</span>
                      {item.isPreviewMode ? (
                        <div className="flex-1 px-2 py-1 border border-slate-200 rounded text-sm font-bold text-emerald-800 bg-white overflow-x-auto shadow-inner min-h-[28px] flex items-center">
                          {item.answer || <span className="text-slate-400 italic text-xs font-medium">정답이 없습니다.</span>}
                        </div>
                      ) : (
                        <input type="text" placeholder="(선택) 정답 입력" value={item.answer} onChange={(e) => updateItem(item.id, 'answer', e.target.value)} className="flex-1 px-2 py-1 border border-slate-300 rounded text-xs font-bold text-slate-700 outline-none focus:ring-1 focus:ring-emerald-500" />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="p-4 bg-white border-t border-slate-200 shrink-0">
            <button 
              onClick={uploadToDb} 
              disabled={parsedItems.length === 0 || isUploading}
              className="w-full py-3 bg-[#002864] hover:bg-blue-900 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black rounded-xl shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {isUploading ? "🚀 마스터 DB로 쏘아 올리는 중..." : "🚀 대기열 전체 DB 일괄 저장"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}