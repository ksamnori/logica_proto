// src/app/clinic/_shared/SeatCanvas.tsx
// 좌석 배치를 고정 가상 캔버스(예: 1600x900) 좌표에서 실제 컨테이너 크기에 맞춰 비율로 그려주는
// 공용 렌더러. supervisor의 SeatGrid, TA pad, 좌석 배치 에디터가 모두 이 위에서 좌석 카드만 다르게 그린다.
// 각 좌석은 (x,y) 지점에 앵커만 잡아주고, 실제 카드 크기는 renderSeat가 scale을 받아 스스로 정한다
// — TA pad의 작은 정사각형 칸과 supervisor의 정보량 많은 카드가 크기 체계가 완전히 다르기 때문.
"use client";

import React, { useEffect, useRef, useState } from "react";
import { Seat } from "@/lib/clinicSeatLayout";

interface SeatCanvasProps {
    seats: Seat[];
    canvasWidth: number;
    canvasHeight: number;
    renderSeat: (seat: Seat, scale: number) => React.ReactNode;
    overlay?: React.ReactNode; // 정렬 가이드 라인 등, 캔버스 좌표계 위에 얹을 요소
    className?: string;
    onContainerRef?: (el: HTMLDivElement | null) => void;
}

export default function SeatCanvas({
    seats, canvasWidth, canvasHeight, renderSeat, overlay, className, onContainerRef,
}: SeatCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const update = () => {
            const w = el.clientWidth;
            const h = el.clientHeight;
            if (w === 0 || h === 0) return;
            setScale(Math.min(w / canvasWidth, h / canvasHeight));
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, [canvasWidth, canvasHeight]);

    return (
        <div
            ref={(el) => { containerRef.current = el; onContainerRef?.(el); }}
            className={`relative w-full h-full ${className || ""}`}
        >
            <div
                className="relative"
                style={{ width: canvasWidth * scale, height: canvasHeight * scale, margin: "0 auto" }}
                data-seat-canvas
                data-scale={scale}
            >
                {seats.map(seat => (
                    <div
                        key={seat.id}
                        data-seat={seat.number}
                        data-seat-id={seat.id}
                        style={{
                            position: "absolute",
                            left: seat.x * scale,
                            top: seat.y * scale,
                            transform: "translate(-50%, -50%)",
                        }}
                    >
                        {renderSeat(seat, scale)}
                    </div>
                ))}
                {overlay}
            </div>
        </div>
    );
}
