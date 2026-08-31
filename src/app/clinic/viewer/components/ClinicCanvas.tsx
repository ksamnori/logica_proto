// src/app/clinic/viewer/components/ClinicCanvas.tsx
import React, { useRef, useEffect } from 'react';
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
  const activePointerId = useRef<number | null>(null); // 🌟 멀티 터치 방지용 고유 ID 추적기

  const lastPos = useRef<{x: number, y: number} | null>(null);
  const lastMid = useRef<{x: number, y: number} | null>(null);

  const drawWritableHint = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save();
    ctx.fillStyle = 'rgba(28,37,48,0.08)';
    for (let x = 16; x < w; x += 32) {
      for (let y = 16; y < h; y += 32) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  };

  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    if (rect.width === 0) { requestAnimationFrame(initCanvas); return; }

    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    
    const ctx = canvas.getContext('2d', { desynchronized: true });
    if (!ctx) return;
    
    ctxRef.current = ctx;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = currentPenColor;
    ctx.fillStyle = currentPenColor;
    ctx.lineWidth = isEraserMode ? currentPenWidth * ERASER_WIDTH_MULTIPLIER : currentPenWidth;
    ctx.globalCompositeOperation = isEraserMode ? 'destination-out' : 'source-over';

    drawWritableHint(ctx, rect.width, rect.height);

    const saved = studentDrawings.current[qIndex];
    if (saved) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = saved;
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => initCanvas(), 50);
    return () => clearTimeout(timer);
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
      x: (e.clientX || e.touches?.[0]?.clientX) - r.left, 
      y: (e.clientY || e.touches?.[0]?.clientY) - r.top 
    };
  };

  const startDraw = (e: any) => {
    // 🌟 핵심 방어: 이미 다른 손가락/펜으로 그리고 있다면 추가 터치는 철저히 무시
    if (isDrawing.current) return;
    
    isDrawing.current = true;
    activePointerId.current = e.pointerId; // 🌟 첫 터치의 고유 ID 기억
    
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
    // 🌟 최초 터치된 손가락/펜(activePointerId)이 아니면 무시 (직선 그어짐 완벽 방지)
    if (!isDrawing.current || e.pointerId !== activePointerId.current || !canvasRef.current || !ctxRef.current || !lastPos.current || !lastMid.current) return;
    
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    
    for (const ev of events) {
      const currentPos = getPos(ev, canvasRef.current);
      
      const midPos = {
        x: (lastPos.current.x + currentPos.x) / 2,
        y: (lastPos.current.y + currentPos.y) / 2
      };

      ctxRef.current.beginPath();
      ctxRef.current.moveTo(lastMid.current.x, lastMid.current.y);
      ctxRef.current.quadraticCurveTo(lastPos.current.x, lastPos.current.y, midPos.x, midPos.y);
      ctxRef.current.stroke();

      lastPos.current = currentPos;
      lastMid.current = midPos;
    }
  };

  const stopDraw = (e: any) => {
    // 🌟 최초 터치된 손가락/펜이 손을 뗄 때만 종료 로직 실행
    if (!isDrawing.current || e.pointerId !== activePointerId.current || !canvasRef.current || !ctxRef.current) return;
    
    if (lastPos.current && lastMid.current) {
        ctxRef.current.beginPath();
        ctxRef.current.moveTo(lastMid.current.x, lastMid.current.y);
        ctxRef.current.lineTo(lastPos.current.x, lastPos.current.y);
        ctxRef.current.stroke();
    }

    isDrawing.current = false;
    activePointerId.current = null; // 🌟 ID 초기화
    lastPos.current = null;
    lastMid.current = null;

    try { if (e?.pointerId != null) canvasRef.current.releasePointerCapture(e.pointerId); } catch (err) {}
    
    const dataUrl = canvasRef.current.toDataURL('image/webp', 0.5);
    studentDrawings.current[qIndex] = dataUrl;
    studentAnswers.current[qIndex] = dataUrl;
    forceUpdate();
  };

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
      onPointerDown={startDraw}
      onPointerMove={draw}
      onPointerUp={stopDraw}
      onPointerCancel={stopDraw}
    />
  );
};