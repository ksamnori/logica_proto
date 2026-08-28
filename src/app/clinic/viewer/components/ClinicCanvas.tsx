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
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctxRef.current = ctx;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = currentPenColor;
    ctx.lineWidth = currentPenWidth;
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
    isDrawing.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    const p = getPos(e, canvas);
    ctxRef.current?.beginPath();
    ctxRef.current?.moveTo(p.x, p.y);
    ctxRef.current?.lineTo(p.x + 0.01, p.y + 0.01);
    ctxRef.current?.stroke();
  };

  const draw = (e: any) => {
    if (!isDrawing.current || !canvasRef.current) return;
    const p = getPos(e, canvasRef.current);
    ctxRef.current?.lineTo(p.x, p.y);
    ctxRef.current?.stroke();
  };

  const stopDraw = (e: any) => {
    if (!isDrawing.current || !canvasRef.current) return;
    isDrawing.current = false;
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