// src/app/clinic/viewer/components/ClinicCanvas.tsx
import React, { useRef, useEffect, useCallback } from 'react';
import { ERASER_WIDTH_MULTIPLIER } from '../utils';

interface ClinicCanvasProps {
  qIndex: number;
  currentPenWidth: number;
  currentPenColor: string;
  isEraserMode: boolean;
  studentDrawings: React.MutableRefObject<Record<number, string>>;
  studentAnswers: React.MutableRefObject<Record<number, string | null>>;
  forceUpdate: () => void;
  clearTrigger: number;
}

export const ClinicCanvas: React.FC<ClinicCanvasProps> = ({
  qIndex, currentPenWidth, currentPenColor, isEraserMode,
  studentDrawings, studentAnswers, forceUpdate, clearTrigger
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  
  const isDrawing = useRef(false);
  const activePointerId = useRef<number | null>(null);
  const hasUnsavedStrokeRef = useRef(false);

  const lastPos = useRef<{x: number, y: number} | null>(null);
  const lastMid = useRef<{x: number, y: number} | null>(null);
  
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    if (rect.width === 0) { requestAnimationFrame(initCanvas); return; }

    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctxRef.current = ctx;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = currentPenColor;
    ctx.fillStyle = currentPenColor;
    ctx.lineWidth = isEraserMode ? currentPenWidth * ERASER_WIDTH_MULTIPLIER : currentPenWidth;
    ctx.globalCompositeOperation = isEraserMode ? 'destination-out' : 'source-over';

    const saved = studentDrawings.current[qIndex];
    if (saved) {
      const img = new Image();
      img.onload = () => {
        if (!ctxRef.current) return;
        ctxRef.current.save();
        ctxRef.current.globalCompositeOperation = 'source-over';
        ctxRef.current.drawImage(img, 0, 0, rect.width, rect.height);
        ctxRef.current.restore();
      };
      img.src = saved;
    }
  }, [qIndex, currentPenColor, currentPenWidth, isEraserMode, studentDrawings]);

  const saveCanvasData = useCallback((targetIdx: number = qIndex, syncFlush: boolean = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (syncFlush) {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        studentDrawings.current[targetIdx] = dataUrl;
        studentAnswers.current[targetIdx] = dataUrl;
        hasUnsavedStrokeRef.current = false;
        forceUpdate();
      } catch (e) {}
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        studentDrawings.current[targetIdx] = dataUrl;
        studentAnswers.current[targetIdx] = dataUrl;
        hasUnsavedStrokeRef.current = false;
        forceUpdate();
      };
      reader.readAsDataURL(blob);
    }, 'image/png');
  }, [qIndex, studentDrawings, studentAnswers, forceUpdate]);

  useEffect(() => {
    const currentIdx = qIndex;
    const timer = setTimeout(() => initCanvas(), 50);
    return () => {
      clearTimeout(timer);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (hasUnsavedStrokeRef.current) {
        saveCanvasData(currentIdx, true);
      }
    };
  }, [qIndex, clearTrigger]);

  useEffect(() => {
    if (ctxRef.current) {
      ctxRef.current.strokeStyle = currentPenColor;
      ctxRef.current.fillStyle = currentPenColor; 
      ctxRef.current.lineWidth = isEraserMode ? currentPenWidth * ERASER_WIDTH_MULTIPLIER : currentPenWidth;
      ctxRef.current.globalCompositeOperation = isEraserMode ? 'destination-out' : 'source-over';
    }
  }, [currentPenColor, currentPenWidth, isEraserMode]);

  const getPos = (e: any, canvas: HTMLCanvasElement) => {
    const r = canvas.getBoundingClientRect();
    return { 
      x: (e.clientX ?? e.touches?.[0]?.clientX ?? 0) - r.left, 
      y: (e.clientY ?? e.touches?.[0]?.clientY ?? 0) - r.top 
    };
  };

  const startDraw = (e: any) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    if (isDrawing.current) return;
    
    isDrawing.current = true;
    hasUnsavedStrokeRef.current = true;
    activePointerId.current = e.pointerId; 
    
    const canvas = canvasRef.current;
    if (!canvas || !ctxRef.current) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    
    const p = getPos(e, canvas);
    lastPos.current = p;
    lastMid.current = p;

    ctxRef.current.beginPath();
    ctxRef.current.fillStyle = isEraserMode ? 'rgba(0,0,0,1)' : currentPenColor;
    ctxRef.current.arc(p.x, p.y, (isEraserMode ? currentPenWidth * ERASER_WIDTH_MULTIPLIER : currentPenWidth) / 2, 0, Math.PI * 2);
    ctxRef.current.fill();
    
    ctxRef.current.beginPath();
    ctxRef.current.moveTo(p.x, p.y);
  };

  const draw = (e: any) => {
    if (!isDrawing.current || e.pointerId !== activePointerId.current || !canvasRef.current || !ctxRef.current || !lastPos.current || !lastMid.current) return;
    
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    
    ctxRef.current.beginPath();
    ctxRef.current.moveTo(lastMid.current.x, lastMid.current.y);

    for (const ev of events) {
      const currentPos = getPos(ev, canvasRef.current);
      
      const midPos = {
        x: (lastPos.current.x + currentPos.x) / 2,
        y: (lastPos.current.y + currentPos.y) / 2
      };

      ctxRef.current.quadraticCurveTo(lastPos.current.x, lastPos.current.y, midPos.x, midPos.y);

      lastPos.current = currentPos;
      lastMid.current = midPos;
    }
    
    ctxRef.current.stroke();
  };

  const stopDraw = (e: any) => {
    if (!isDrawing.current || e.pointerId !== activePointerId.current || !canvasRef.current || !ctxRef.current) return;
    
    if (lastPos.current && lastMid.current) {
        ctxRef.current.beginPath();
        ctxRef.current.moveTo(lastMid.current.x, lastMid.current.y);
        ctxRef.current.lineTo(lastPos.current.x, lastPos.current.y);
        ctxRef.current.stroke();
    }

    isDrawing.current = false;
    activePointerId.current = null; 
    lastPos.current = null;
    lastMid.current = null;

    try { if (e?.pointerId != null) canvasRef.current.releasePointerCapture(e.pointerId); } catch (err) {}
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    const targetIdx = qIndex;
    saveTimeoutRef.current = setTimeout(() => {
      saveCanvasData(targetIdx, false);
      saveTimeoutRef.current = null;
    }, 400); 
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        backgroundImage: 'radial-gradient(rgba(28, 37, 48, 0.12) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        backgroundPosition: '16px 16px',
      }}
      className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
      onPointerDown={startDraw}
      onPointerMove={draw}
      onPointerUp={stopDraw}
      onPointerCancel={stopDraw}
    />
  );
};