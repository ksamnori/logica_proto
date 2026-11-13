// src/components/clinic/HandwritingOverlayPreview.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { QuestionDisplay } from "@/app/clinic/viewer/components/QuestionDisplay";
import {
  CANVAS_BACKING_SCALE,
  STAGE_PADDING_PX,
  STAGE_BOTTOM_PADDING_PX,
} from "@/app/clinic/viewer/utils";
import { CANVAS_META_SIGNATURE } from "@/app/clinic/viewer/components/ClinicCanvas";

export interface HandwritingOverlayPreviewProps {
  imageDataUrl: string;
  questionText?: string;
  questionText2?: string;
  imageUrl?: string;
  image2Url?: string;
  stageWidth?: number;
  stageHeight?: number;
  cropHeight?: number;
  stagePadding?: number;
}

/**
 * 학생 풀이 화면의 원본 스테이지 좌표계(stageWidth × stageHeight + 여백)를 1:1 복원하여
 * 문제 지문(MathJax·표·네모 박스·이미지)과 학생 투명 필기 레이어를 정확히 겹쳐 표시합니다.
 * - 이미지 픽셀 자체에서 실제 필기 하단 끝점(detectedInkMaxY)과 메타데이터 시그니처를 자동 측정하여
 *   분수의 분자·분모나 아래쪽 풀이 과정이 절대 잘리지 않도록 보장합니다.
 * - 관리자/조교가 좌석으로 찾아가지 않고도 모달 안에서 [전체 영역] 및 [필기만 보기]를 즉시 전환할 수 있습니다.
 */
export default function HandwritingOverlayPreview({
  imageDataUrl,
  questionText,
  questionText2,
  imageUrl,
  image2Url,
  stageWidth,
  stageHeight,
  cropHeight,
  stagePadding,
}: HandwritingOverlayPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentMeasureRef = useRef<HTMLDivElement>(null);

  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({
    w: stageWidth || 720,
    h: stageHeight || 540,
  });
  const [detectedPadding, setDetectedPadding] = useState<number | null>(null);
  const [detectedInkMaxY, setDetectedInkMaxY] = useState<number>(0);
  const [measuredContentH, setMeasuredContentH] = useState<number>(0);

  const [showFullStage, setShowFullStage] = useState<boolean>(false);
  const [inkOnlyMode, setInkOnlyMode] = useState<boolean>(false);

  useEffect(() => {
    setDetectedPadding(null);
    setDetectedInkMaxY(0);
    setShowFullStage(false);
    setInkOnlyMode(false);
    if (stageWidth && stageHeight) {
      setNaturalSize({ w: stageWidth, h: stageHeight });
    }
  }, [imageDataUrl, stageWidth, stageHeight]);

  useEffect(() => {
    if (!containerRef.current) return;
    const updateWidth = () => {
      if (containerRef.current && containerRef.current.clientWidth > 0) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    const raf = requestAnimationFrame(updateWidth);
    const ro = new ResizeObserver(updateWidth);
    ro.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [imageDataUrl]);

  useEffect(() => {
    if (!contentMeasureRef.current) return;
    const updateContentH = () => {
      if (contentMeasureRef.current) {
        setMeasuredContentH(contentMeasureRef.current.scrollHeight);
      }
    };
    updateContentH();
    const timer = setTimeout(updateContentH, 280);
    const ro = new ResizeObserver(updateContentH);
    ro.observe(contentMeasureRef.current);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [questionText, questionText2, imageUrl, image2Url, stagePadding, detectedPadding]);

  const baseW = stageWidth && stageWidth > 0 ? stageWidth : naturalSize.w;
  const baseH = stageHeight && stageHeight > 0 ? stageHeight : naturalSize.h;
  const effectivePad =
    stagePadding !== undefined ? stagePadding : detectedPadding !== null ? detectedPadding : 0;

  const hasQuestionContext = Boolean(
    (questionText && questionText.trim()) ||
      (questionText2 && questionText2.trim()) ||
      (imageUrl && imageUrl.trim()) ||
      (image2Url && image2Url.trim())
  );

  // 실제 필기 하단 좌표(detectedInkMaxY) + 여유 패딩(52px)을 반드시 포함하여 어떠한 경우에도 필기가 잘리지 않음
  const effectiveCropH = (() => {
    if (showFullStage) return baseH;
    const baseCrop = cropHeight && cropHeight > 0 ? cropHeight : baseH;
    const neededForContent = measuredContentH > 0 ? measuredContentH + 44 : 0;
    const neededForInk = detectedInkMaxY > 0 ? detectedInkMaxY + 52 : 0;
    return Math.min(baseH, Math.max(baseCrop, neededForContent, neededForInk, 200));
  })();

  const scale =
    containerWidth > 0 && baseW > 0 ? Math.min(1, containerWidth / baseW) : 1;
  const scaledHeight = Math.max(160, Math.round(effectiveCropH * scale));
  const canExpandMore = baseH - effectiveCropH > 24;

  const inspectInkImage = (im: HTMLImageElement) => {
    if (im.naturalWidth <= 0 || im.naturalHeight <= 0) return;

    let inferredScale = im.naturalWidth > 1000 ? 2 : 1;
    let hasNewStageSig = false;

    try {
      const probe = document.createElement("canvas");
      probe.width = im.naturalWidth;
      probe.height = im.naturalHeight;
      const pCtx = probe.getContext("2d");
      if (pCtx) {
        pCtx.drawImage(im, 0, 0);
        const topPx = pCtx.getImageData(0, 0, 1, 1).data;
        if (
          topPx[0] === CANVAS_META_SIGNATURE.r &&
          topPx[1] === CANVAS_META_SIGNATURE.g &&
          topPx[2] === CANVAS_META_SIGNATURE.b &&
          topPx[3] === CANVAS_META_SIGNATURE.a
        ) {
          hasNewStageSig = true;
          inferredScale = CANVAS_BACKING_SCALE;
        }

        const resolvedStageW =
          stageWidth && stageWidth > 0
            ? stageWidth
            : Math.max(1, Math.round(im.naturalWidth / inferredScale));
        const resolvedStageH =
          stageHeight && stageHeight > 0
            ? stageHeight
            : Math.max(1, Math.round(im.naturalHeight / inferredScale));

        if (!stageWidth || !stageHeight) {
          setNaturalSize({ w: resolvedStageW, h: resolvedStageH });
        }
        if (stagePadding === undefined) {
          setDetectedPadding(hasNewStageSig ? STAGE_PADDING_PX : 0);
        }

        // 전체 픽셀 중 실제 잉크가 찍힌 가장 아래쪽 Y좌표 산출 (마커 픽셀 및 순백색 제외)
        const fullData = pCtx.getImageData(0, 0, im.naturalWidth, im.naturalHeight).data;
        const w = im.naturalWidth;
        const h = im.naturalHeight;
        let maxInkPixelY = 0;
        for (let y = h - 1; y >= 0; y--) {
          let foundInRow = false;
          const rowStart = y * w * 4;
          for (let x = 0; x < w; x++) {
            if (x === 0 && y === 0 && hasNewStageSig) continue;
            const idx = rowStart + x * 4;
            const a = fullData[idx + 3];
            if (a > 10) {
              const r = fullData[idx];
              const g = fullData[idx + 1];
              const b = fullData[idx + 2];
              if (!(r >= 250 && g >= 250 && b >= 250)) {
                foundInRow = true;
                break;
              }
            }
          }
          if (foundInRow) {
            maxInkPixelY = y;
            break;
          }
        }

        if (maxInkPixelY > 0) {
          const cssInkBottom = Math.ceil((maxInkPixelY / h) * resolvedStageH);
          setDetectedInkMaxY(cssInkBottom);
        }
        return;
      }
    } catch {
      // 외부 도메인 CORS 예외 시 기본 크기 추정 폴백
    }

    if (!stageWidth || !stageHeight) {
      setNaturalSize({
        w: Math.max(1, Math.round(im.naturalWidth / inferredScale)),
        h: Math.max(1, Math.round(im.naturalHeight / inferredScale)),
      });
    }
  };

  if (!hasQuestionContext) {
    return (
      <div className="w-full rounded-lg bg-white border border-slate-100 p-2">
        <img
          className="w-full max-h-[520px] object-contain rounded-lg bg-white"
          src={imageDataUrl}
          alt="학생 손글씨 답안"
        />
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-1.5">
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setInkOnlyMode((v) => !v)}
          className={`text-[11px] font-bold px-2 py-0.5 rounded border transition-colors ${
            inkOnlyMode
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
          }`}
        >
          {inkOnlyMode ? "문제 함께 보기" : "필기만 강조"}
        </button>
        {(canExpandMore || showFullStage) && (
          <button
            type="button"
            onClick={() => setShowFullStage((v) => !v)}
            className={`text-[11px] font-bold px-2 py-0.5 rounded border transition-colors ${
              showFullStage
                ? "bg-slate-700 text-white border-slate-700"
                : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
            }`}
          >
            {showFullStage ? "여백 접기" : "전체 영역 펼치기"}
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-lg bg-white relative border border-slate-100"
        style={{
          height: scaledHeight > 0 ? `${scaledHeight}px` : "auto",
          minHeight: "180px",
          backgroundImage: "radial-gradient(#cbd5e1 1.25px, transparent 1.25px)",
          backgroundSize: "20px 20px",
        }}
      >
        <div
          style={{
            width: `${baseW}px`,
            height: `${baseH}px`,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            position: "relative",
          }}
        >
          <div
            ref={contentMeasureRef}
            className="pointer-events-none select-none transition-opacity"
            style={{
              opacity: inkOnlyMode ? 0.12 : 0.75,
              padding:
                effectivePad > 0
                  ? `${effectivePad}px ${effectivePad}px ${STAGE_BOTTOM_PADDING_PX}px ${effectivePad}px`
                  : undefined,
            }}
          >
            <QuestionDisplay
              html={questionText || ""}
              imageUrl={imageUrl}
              image2Url={image2Url}
              html2={questionText2}
            />
          </div>
          <img
            src={imageDataUrl}
            alt="학생 손글씨 답안"
            onLoad={(e) => inspectInkImage(e.currentTarget)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: `${baseW}px`,
              height: `${baseH}px`,
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}
