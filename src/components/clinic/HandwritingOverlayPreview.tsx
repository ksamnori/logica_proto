// src/components/clinic/HandwritingOverlayPreview.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { QuestionDisplay } from "@/app/clinic/viewer/components/QuestionDisplay";

interface HandwritingOverlayPreviewProps {
  imageDataUrl: string;
  questionText?: string;
  questionText2?: string;
  imageUrl?: string;
  image2Url?: string;
  stageWidth?: number;
  stageHeight?: number;
  cropHeight?: number;
}

/**
 * 🌟 학생이 문제를 풀 때의 원본 스테이지 크기(stageWidth × stageHeight) 그대로
 * 실제 QuestionDisplay(MathJax 수식·표·네모 박스·이미지)와 학생의 투명 필기 레이어(imageDataUrl)를
 * (0, 0) 원점에 맞춰 겹쳐 렌더링한 뒤, 모달 너비에 맞게 CSS scale로 축소/확대하여 보여주는 컴포넌트입니다.
 * - 캔버스 텍스트 재렌더링으로 인한 MathJax 깨짐("이개" 반복 등)이 전혀 발생하지 않으며
 * - 학생 화면과 픽셀 단위로 100% 동일한 좌표에 손글씨가 겹쳐 표시됩니다.
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
}: HandwritingOverlayPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentMeasureRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({
    w: stageWidth || 640,
    h: stageHeight || 480,
  });
  const [measuredContentH, setMeasuredContentH] = useState<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!contentMeasureRef.current) return;
    const updateContentH = () => {
      if (contentMeasureRef.current) {
        setMeasuredContentH(contentMeasureRef.current.scrollHeight);
      }
    };
    updateContentH();
    const timer = setTimeout(updateContentH, 250);
    const ro = new ResizeObserver(updateContentH);
    ro.observe(contentMeasureRef.current);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [questionText, questionText2, imageUrl, image2Url]);

  const baseW = stageWidth && stageWidth > 0 ? stageWidth : naturalSize.w;
  const baseH = stageHeight && stageHeight > 0 ? stageHeight : naturalSize.h;

  const hasQuestionContext = Boolean(
    (questionText && questionText.trim()) ||
      (questionText2 && questionText2.trim()) ||
      (imageUrl && imageUrl.trim()) ||
      (image2Url && image2Url.trim())
  );

  // 문제 콘텐츠 높이와 필기 크롭 높이 중 큰 값을 사용하여 하단 빈 여백만 깔끔하게 정리
  const effectiveCropH = (() => {
    const baseCrop = cropHeight && cropHeight > 0 ? cropHeight : baseH;
    if (measuredContentH > 0) {
      return Math.min(baseH, Math.max(baseCrop, measuredContentH + 36, 180));
    }
    return Math.min(baseH, Math.max(baseCrop, 180));
  })();

  const scale =
    containerWidth > 0 && baseW > 0 ? Math.min(1, containerWidth / baseW) : 1;
  const scaledHeight = Math.round(effectiveCropH * scale);

  if (!hasQuestionContext) {
    return (
      <img
        className="w-full max-h-[380px] object-contain rounded-lg bg-white"
        src={imageDataUrl}
        alt="학생 손글씨 답안"
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden rounded-lg bg-white relative"
      style={{
        height: scaledHeight > 0 ? `${scaledHeight}px` : "auto",
        minHeight: "160px",
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
          className="opacity-75 pointer-events-none select-none"
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
          onLoad={(e) => {
            if (!stageWidth || !stageHeight) {
              const im = e.currentTarget;
              if (im.naturalWidth > 0 && im.naturalHeight > 0) {
                const dprGuess = im.naturalWidth > 1000 ? 2 : 1;
                setNaturalSize({
                  w: Math.round(im.naturalWidth / dprGuess),
                  h: Math.round(im.naturalHeight / dprGuess),
                });
              }
            }
          }}
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
  );
}
