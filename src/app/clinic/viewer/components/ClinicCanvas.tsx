// src/app/clinic/viewer/components/ClinicCanvas.tsx
import React, { useRef, useEffect, useCallback } from 'react';
import { ERASER_WIDTH_MULTIPLIER, CANVAS_BACKING_SCALE } from '../utils';

interface ClinicCanvasProps {
  qIndex: number;
  currentPenWidth: number;
  currentPenColor: string;
  isEraserMode: boolean;
  studentDrawings: React.MutableRefObject<Record<number, string>>;
  studentAnswers: React.MutableRefObject<Record<number, string | null>>;
  forceUpdate: () => void;
  clearTrigger: number;
  onStrokeSaved?: (idx: number) => void;
}

// 무손실(alpha=255) 1픽셀 메타데이터 시그니처: 흰 배경(#ffffff)에서 육안·AI에 완전히 투명처럼 보이며(99.6% 백색),
// DB(student_answer.student_input)에서 PNG 문자열만 단독 로드할 때도 2배수 해상도와 여백(STAGE_PADDING_PX) 적용본임을 100% 판별합니다.
export const CANVAS_META_SIGNATURE = { r: 254, g: 253, b: 252, a: 255 } as const;

let activeCanvasSyncFlusher: (() => string | null) | null = null;

/**
 * [정답 제출하기], [시험 제출], [채점 재확인 요청], 문항 이동 직전에 호출하여
 * 디바운스 대기 중이거나 아직 펜이 닿아 있는 마지막 획(예: 분수 1/2의 분자 '1')까지
 * 0ms 동기로 추출해 studentDrawings / studentAnswers에 즉시 반영합니다.
 */
export function flushActiveClinicCanvas(): string | null {
  if (activeCanvasSyncFlusher) {
    return activeCanvasSyncFlusher();
  }
  return null;
}

export const ClinicCanvas: React.FC<ClinicCanvasProps> = ({
  qIndex,
  currentPenWidth,
  currentPenColor,
  isEraserMode,
  studentDrawings,
  studentAnswers,
  forceUpdate,
  clearTrigger,
  onStrokeSaved,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const logicalSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const backingScaleRef = useRef<number>(CANVAS_BACKING_SCALE);

  const isDrawing = useRef(false);
  const activePointerId = useRef<number | null>(null);
  const activePointerType = useRef<string>('');
  const lastPenActiveAtRef = useRef<number>(0);
  const lastPointerMoveAtRef = useRef<number>(0);
  const hasUnsavedStrokeRef = useRef(false);
  const hasAnyInkRef = useRef(false);
  const isEncodingBlobRef = useRef(false);
  const strokeVersionRef = useRef(0);
  const initRafRef = useRef<number | null>(null);
  const latestClearTriggerRef = useRef<number>(clearTrigger);
  latestClearTriggerRef.current = clearTrigger;

  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const lastMid = useRef<{ x: number; y: number } | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const styleRef = useRef({
    penColor: currentPenColor,
    penWidth: currentPenWidth,
    eraser: isEraserMode,
  });
  styleRef.current = {
    penColor: currentPenColor,
    penWidth: currentPenWidth,
    eraser: isEraserMode,
  };

  const onStrokeSavedRef = useRef(onStrokeSaved);
  onStrokeSavedRef.current = onStrokeSaved;
  const qIndexRef = useRef(qIndex);
  qIndexRef.current = qIndex;

  // 태블릿/iOS Safari의 최대 캔버스 픽셀 제한(16.7M px) 초과로 인한 그리기 먹통 방지
  const resolveSafeBackingScale = (cssW: number, cssH: number): number => {
    const MAX_CANVAS_PIXELS = 12_000_000;
    const areaAtDefault = cssW * cssH * CANVAS_BACKING_SCALE * CANVAS_BACKING_SCALE;
    if (areaAtDefault <= MAX_CANVAS_PIXELS) return CANVAS_BACKING_SCALE;
    return Math.max(1, Math.min(CANVAS_BACKING_SCALE, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, cssW * cssH))));
  };

  const resetActiveStrokeState = useCallback(() => {
    const canvas = canvasRef.current;
    if (activePointerId.current != null && canvas) {
      try {
        if (canvas.hasPointerCapture?.(activePointerId.current)) {
          canvas.releasePointerCapture(activePointerId.current);
        }
      } catch {}
    }
    isDrawing.current = false;
    activePointerId.current = null;
    activePointerType.current = '';
    lastPos.current = null;
    lastMid.current = null;
  }, []);

  const applyContextStyles = useCallback((ctx: CanvasRenderingContext2D) => {
    const { penColor, penWidth, eraser } = styleRef.current;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = penColor;
    ctx.fillStyle = penColor;
    ctx.lineWidth = eraser ? penWidth * ERASER_WIDTH_MULTIPLIER : penWidth;
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
  }, []);

  const stampMetadataPixel = (ctx: CanvasRenderingContext2D) => {
    // 2배수 기본 스케일일 때만 2x 메타데이터 시그니처를 기록 (축소 폴백 시 오판 방지)
    if (backingScaleRef.current !== CANVAS_BACKING_SCALE) return;
    try {
      const px = ctx.createImageData(1, 1);
      px.data[0] = CANVAS_META_SIGNATURE.r;
      px.data[1] = CANVAS_META_SIGNATURE.g;
      px.data[2] = CANVAS_META_SIGNATURE.b;
      px.data[3] = CANVAS_META_SIGNATURE.a;
      ctx.putImageData(px, 0, 0);
    } catch {}
  };

  const saveCanvasData = useCallback(
    (targetIdx: number = qIndexRef.current, syncFlush: boolean = false): string | null => {
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (!canvas || !ctx || canvas.width <= 0 || canvas.height <= 0) return null;

      // 아직 펜이 화면에 닿아 있는 상태에서 다른 손으로 제출 버튼을 누른 경우 진행 중인 선분까지 즉시 마감
      if (isDrawing.current && lastMid.current && lastPos.current) {
        ctx.save();
        applyContextStyles(ctx);
        ctx.beginPath();
        ctx.moveTo(lastMid.current.x, lastMid.current.y);
        ctx.lineTo(lastPos.current.x, lastPos.current.y);
        ctx.stroke();
        ctx.restore();
        lastMid.current = { ...lastPos.current };
      }

      if (!hasAnyInkRef.current) {
        return studentDrawings.current[targetIdx] || null;
      }

      stampMetadataPixel(ctx);

      if (syncFlush) {
        try {
          const dataUrl = canvas.toDataURL('image/png');
          studentDrawings.current[targetIdx] = dataUrl;
          studentAnswers.current[targetIdx] = dataUrl;
          hasUnsavedStrokeRef.current = false;
          onStrokeSavedRef.current?.(targetIdx);
          forceUpdate();
          return dataUrl;
        } catch {
          return studentDrawings.current[targetIdx] || null;
        }
      }

      // 이전 비동기 PNG 인코딩이 진행 중이면 중복 인코딩 폭주를 막고 완료 후 재시도
      if (isEncodingBlobRef.current) return studentDrawings.current[targetIdx] || null;
      isEncodingBlobRef.current = true;
      const versionSnapshot = strokeVersionRef.current;

      canvas.toBlob((blob) => {
        if (!blob) {
          isEncodingBlobRef.current = false;
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          isEncodingBlobRef.current = false;
          const dataUrl = reader.result as string;
          // 비동기 변환 도중 지우기/초기화나 더 최신 획이 발생했으면 구버전 결과로 덮어쓰지 않음
          if (!hasAnyInkRef.current && targetIdx === qIndexRef.current) return;
          if (targetIdx === qIndexRef.current && strokeVersionRef.current !== versionSnapshot) {
            return;
          }
          studentDrawings.current[targetIdx] = dataUrl;
          studentAnswers.current[targetIdx] = dataUrl;
          if (strokeVersionRef.current === versionSnapshot) {
            hasUnsavedStrokeRef.current = false;
          }
          onStrokeSavedRef.current?.(targetIdx);
          forceUpdate();
        };
        reader.onerror = () => {
          isEncodingBlobRef.current = false;
        };
        reader.readAsDataURL(blob);
      }, 'image/png');

      return studentDrawings.current[targetIdx] || null;
    },
    [applyContextStyles, forceUpdate, studentAnswers, studentDrawings]
  );

  // 전역 동기 플러시 핸들러 등록
  useEffect(() => {
    const flusher = (): string | null => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (hasUnsavedStrokeRef.current || isDrawing.current) {
        return saveCanvasData(qIndexRef.current, true);
      }
      return studentDrawings.current[qIndexRef.current] || null;
    };
    activeCanvasSyncFlusher = flusher;
    return () => {
      if (activeCanvasSyncFlusher === flusher) {
        activeCanvasSyncFlusher = null;
      }
    };
  }, [saveCanvasData, studentDrawings]);

  const initCanvas = useCallback(() => {
    const attemptInit = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        initRafRef.current = requestAnimationFrame(attemptInit);
        return;
      }
      initRafRef.current = null;

      // 문항 전환/지우기 시 남아있던 포인터 잠금 상태를 완전히 초기화
      resetActiveStrokeState();
      hasUnsavedStrokeRef.current = false;
      strokeVersionRef.current += 1;

      const cssW = Math.max(1, Math.round(rect.width));
      const cssH = Math.max(1, Math.round(rect.height));
      const safeScale = resolveSafeBackingScale(cssW, cssH);
      logicalSizeRef.current = { w: cssW, h: cssH };
      backingScaleRef.current = safeScale;

      canvas.width = Math.max(1, Math.round(cssW * safeScale));
      canvas.height = Math.max(1, Math.round(cssH * safeScale));

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctxRef.current = ctx;
      ctx.setTransform(safeScale, 0, 0, safeScale, 0, 0);
      applyContextStyles(ctx);

      const saved = studentDrawings.current[qIndex];
      hasAnyInkRef.current = Boolean(saved);
      if (saved) {
        const img = new Image();
        img.onload = () => {
          if (!ctxRef.current || qIndexRef.current !== qIndex) return;
          const drawW = Math.round(img.naturalWidth / CANVAS_BACKING_SCALE) || cssW;
          const drawH = Math.round(img.naturalHeight / CANVAS_BACKING_SCALE) || cssH;
          ctxRef.current.save();
          ctxRef.current.globalCompositeOperation = 'source-over';
          // 기존 필기를 늘리거나 찌그러뜨리지 않고 원본 논리 좌표 크기 그대로 복원
          ctxRef.current.drawImage(
            img,
            0,
            0,
            img.naturalWidth > 1000 ? drawW : cssW,
            img.naturalWidth > 1000 ? drawH : cssH
          );
          ctxRef.current.restore();
        };
        img.src = saved;
      }
    };
    attemptInit();
  }, [qIndex, applyContextStyles, resetActiveStrokeState, studentDrawings]);

  // 문항 변경 또는 지우기(clearTrigger) 시에만 캔버스 초기화 (색상/굵기 변경 시에는 절대 초기화하지 않음)
  useEffect(() => {
    const currentIdx = qIndex;
    const effectClearTrigger = clearTrigger;
    initRafRef.current = requestAnimationFrame(() => initCanvas());
    return () => {
      if (initRafRef.current != null) {
        cancelAnimationFrame(initRafRef.current);
        initRafRef.current = null;
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      // 같은 문항에서 '모두 지우기'나 '다시 풀기'로 clearTrigger만 증가한 경우에는 지운 필기를 재저장하지 않음
      const isSameQuestionClear =
        latestClearTriggerRef.current !== effectClearTrigger && qIndexRef.current === currentIdx;
      if (!isSameQuestionClear && (hasUnsavedStrokeRef.current || isDrawing.current)) {
        saveCanvasData(currentIdx, true);
      }
      resetActiveStrokeState();
    };
  }, [qIndex, clearTrigger, initCanvas, resetActiveStrokeState, saveCanvasData]);

  // 윈도우 포커스 이탈/탭 전환 시 pointerup 누락으로 isDrawing이 영구 고정되는 현상 방지
  useEffect(() => {
    const finishStaleStroke = () => {
      if (!isDrawing.current) return;
      const ctx = ctxRef.current;
      if (ctx && lastPos.current && lastMid.current) {
        ctx.save();
        applyContextStyles(ctx);
        ctx.beginPath();
        ctx.moveTo(lastMid.current.x, lastMid.current.y);
        ctx.lineTo(lastPos.current.x, lastPos.current.y);
        ctx.stroke();
        ctx.restore();
      }
      resetActiveStrokeState();
      if (hasAnyInkRef.current) {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        const idxSnapshot = qIndexRef.current;
        saveTimeoutRef.current = setTimeout(() => {
          saveCanvasData(idxSnapshot, false);
          saveTimeoutRef.current = null;
        }, 300);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') finishStaleStroke();
    };
    window.addEventListener('blur', finishStaleStroke);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', finishStaleStroke);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [applyContextStyles, resetActiveStrokeState, saveCanvasData]);

  // 문제 이미지(<img>) 지연 로드나 수식 렌더링으로 스테이지 크기가 바뀔 때 기존 필기를 보존한 채 캔버스 버퍼 동기화
  useEffect(() => {
    const canvas = canvasRef.current;
    const targetEl = canvas?.parentElement || canvas;
    if (!canvas || !targetEl || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => {
      const c = canvasRef.current;
      const ctx = ctxRef.current;
      if (!c || !ctx) return;
      const rect = c.getBoundingClientRect();
      const nextW = Math.max(1, Math.round(rect.width));
      const nextH = Math.max(1, Math.round(rect.height));
      const prev = logicalSizeRef.current;

      if (prev.w === 0 || prev.h === 0) return;
      if (Math.abs(nextW - prev.w) < 2 && Math.abs(nextH - prev.h) < 2) return;

      const nextScale = resolveSafeBackingScale(nextW, nextH);
      const prevScale = backingScaleRef.current;

      const backup = document.createElement('canvas');
      backup.width = c.width;
      backup.height = c.height;
      const bCtx = backup.getContext('2d');
      if (bCtx) {
        bCtx.drawImage(c, 0, 0);
      }

      logicalSizeRef.current = { w: nextW, h: nextH };
      backingScaleRef.current = nextScale;
      c.width = Math.max(1, Math.round(nextW * nextScale));
      c.height = Math.max(1, Math.round(nextH * nextScale));

      ctx.setTransform(nextScale, 0, 0, nextScale, 0, 0);
      if (bCtx) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(backup, 0, 0, backup.width / prevScale, backup.height / prevScale);
        ctx.restore();
      }
      applyContextStyles(ctx);

      if (hasAnyInkRef.current) {
        hasUnsavedStrokeRef.current = true;
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        const idxSnapshot = qIndexRef.current;
        saveTimeoutRef.current = setTimeout(() => {
          saveCanvasData(idxSnapshot, false);
          saveTimeoutRef.current = null;
        }, 500);
      }
    });

    ro.observe(targetEl);
    return () => ro.disconnect();
  }, [applyContextStyles, saveCanvasData]);

  useEffect(() => {
    if (ctxRef.current) {
      applyContextStyles(ctxRef.current);
    }
  }, [currentPenColor, currentPenWidth, isEraserMode, applyContextStyles]);

  const getPos = (e: any, canvas: HTMLCanvasElement) => {
    const r = canvas.getBoundingClientRect();
    const rawX = (e.clientX ?? e.touches?.[0]?.clientX ?? 0) - r.left;
    const rawY = (e.clientY ?? e.touches?.[0]?.clientY ?? 0) - r.top;
    // 캔버스 경계 살짝 바깥으로 스친 스트로크도 끊기지 않고 경계선 안쪽에 자연스럽게 안착
    return {
      x: Math.max(1, Math.min(r.width - 1, rawX)),
      y: Math.max(1, Math.min(r.height - 1, rawY)),
    };
  };

  const startDraw = (e: any) => {
    const now = Date.now();
    const pType = String(e.pointerType || '');
    if (pType === 'pen') {
      lastPenActiveAtRef.current = now;
    } else if (pType === 'touch') {
      // 펜을 사용 중인 동안·직후(2.5초 이내)나 손바닥 크기 접촉은 팜 리젝션으로 무시하되,
      // 펜을 내려놓고 손가락으로 필기할 때는 영구 차단되지 않도록 자동 허용
      const isRecentPen = lastPenActiveAtRef.current > 0 && now - lastPenActiveAtRef.current < 2500;
      const isPalmSized = lastPenActiveAtRef.current > 0 && ((Number(e.width) || 0) > 28 || (Number(e.height) || 0) > 28);
      if ((isDrawing.current && activePointerType.current === 'pen') || isRecentPen || isPalmSized) {
        return;
      }
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    // 이전 스트로크의 pointerup이 누락되어 isDrawing이 고착된 경우(펜/마우스 재입력, 또는 1.2초 이상 정지된 stale 터치) 즉시 복구
    if (isDrawing.current) {
      const isPenTakeover = pType === 'pen';
      const isMouseTakeover = pType === 'mouse' && activePointerId.current !== e.pointerId;
      const isStaleTouch =
        pType === 'touch' &&
        (activePointerId.current === e.pointerId ||
          (Boolean(e.isPrimary) && now - lastPointerMoveAtRef.current > 1200));

      if (isPenTakeover || isMouseTakeover || isStaleTouch) {
        resetActiveStrokeState();
      } else {
        return;
      }
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!ctxRef.current) {
      initCanvas();
    }
    if (!ctxRef.current) return;

    isDrawing.current = true;
    hasUnsavedStrokeRef.current = true;
    hasAnyInkRef.current = true;
    strokeVersionRef.current += 1;
    activePointerId.current = e.pointerId;
    activePointerType.current = pType;
    lastPointerMoveAtRef.current = now;

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}

    const p = getPos(e, canvas);
    lastPos.current = p;
    lastMid.current = p;

    applyContextStyles(ctxRef.current);
    ctxRef.current.beginPath();
    ctxRef.current.fillStyle = isEraserMode ? 'rgba(0,0,0,1)' : currentPenColor;
    ctxRef.current.arc(
      p.x,
      p.y,
      (isEraserMode ? currentPenWidth * ERASER_WIDTH_MULTIPLIER : currentPenWidth) / 2,
      0,
      Math.PI * 2
    );
    ctxRef.current.fill();

    ctxRef.current.beginPath();
    ctxRef.current.moveTo(p.x, p.y);
  };

  const draw = (e: any) => {
    if (
      !isDrawing.current ||
      e.pointerId !== activePointerId.current ||
      !canvasRef.current ||
      !ctxRef.current ||
      !lastPos.current ||
      !lastMid.current
    ) {
      return;
    }

    const now = Date.now();
    lastPointerMoveAtRef.current = now;
    if (activePointerType.current === 'pen') {
      lastPenActiveAtRef.current = now;
    }

    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (!events || events.length === 0) return;

    ctxRef.current.beginPath();
    ctxRef.current.moveTo(lastMid.current.x, lastMid.current.y);

    for (const ev of events) {
      const currentPos = getPos(ev, canvasRef.current);
      const midPos = {
        x: (lastPos.current.x + currentPos.x) / 2,
        y: (lastPos.current.y + currentPos.y) / 2,
      };
      ctxRef.current.quadraticCurveTo(lastPos.current.x, lastPos.current.y, midPos.x, midPos.y);
      lastPos.current = currentPos;
      lastMid.current = midPos;
    }

    ctxRef.current.stroke();
  };

  const stopDraw = (e: any) => {
    if (
      !isDrawing.current ||
      (e?.pointerId != null && activePointerId.current != null && e.pointerId !== activePointerId.current) ||
      !canvasRef.current ||
      !ctxRef.current
    ) {
      return;
    }

    if (activePointerType.current === 'pen') {
      lastPenActiveAtRef.current = Date.now();
    }

    if (lastPos.current && lastMid.current) {
      ctxRef.current.beginPath();
      ctxRef.current.moveTo(lastMid.current.x, lastMid.current.y);
      ctxRef.current.lineTo(lastPos.current.x, lastPos.current.y);
      ctxRef.current.stroke();
    }

    resetActiveStrokeState();

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    const targetIdx = qIndexRef.current;
    // 제출·문항이동 시 flushActiveClinicCanvas()가 0ms 동기 플러시를 보장하므로,
    // 평상시 유휴 디바운스는 500ms로 두어 연속 필기 중 PNG 인코딩 프리징 방지
    saveTimeoutRef.current = setTimeout(() => {
      saveCanvasData(targetIdx, false);
      saveTimeoutRef.current = null;
    }, 500);
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        backgroundImage: 'radial-gradient(rgba(28, 37, 48, 0.12) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        backgroundPosition: '16px 16px',
      }}
      className="absolute inset-0 z-10 w-full h-full cursor-crosshair touch-none"
      onPointerDown={startDraw}
      onPointerMove={draw}
      onPointerUp={stopDraw}
      onPointerCancel={stopDraw}
      onLostPointerCapture={stopDraw}
    />
  );
};