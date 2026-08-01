// src/app/(dashboard)/seat-layout-editor/page.tsx
"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { supabase, CLINIC_ROOM } from "@/lib/supabase";
import { getActiveSeatLayout, saveSeatLayout } from "@/app/actions/clinicSeatLayout";
import { Seat, SeatLayout, DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, DEFAULT_SEAT_CARD_W, DEFAULT_SEAT_CARD_H, renumberSeats } from "@/lib/clinicSeatLayout";
import SeatCanvas from "@/app/clinic/_shared/SeatCanvas";
import EmptySeatTile from "@/app/clinic/_shared/EmptySeatTile";

const GRID_SIZE = 20; // 캔버스 좌표 기준 격자 간격 — 좌석은 항상 이 격자점에 모서리가 맞춰진다
const EDITOR_ID_KEY = "logica_seat_editor_client_id";

export default function SeatLayoutEditorPage() {
    const [layout, setLayout] = useState<SeatLayout | null>(null);
    const [seats, setSeats] = useState<Seat[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [seatW, setSeatW] = useState(DEFAULT_SEAT_CARD_W);
    const [seatH, setSeatH] = useState(DEFAULT_SEAT_CARD_H);
    const [canvasW, setCanvasW] = useState(DEFAULT_CANVAS_W);
    const [canvasH, setCanvasH] = useState(DEFAULT_CANVAS_H);
    const [sizePanelOpen, setSizePanelOpen] = useState(false);

    // 좌석 크기는 20 단위로만, 0은 안 되고(최소 20) 최대 200까지만 허용한다.
    const clampSeatSize = (v: number) => Math.min(200, Math.max(20, Math.round(v / 20) * 20));
    // 캔버스(전체 배치판) 크기도 격자와 같은 20 단위로, 최소 400까지만 허용한다.
    const clampCanvasSize = (v: number) => Math.max(400, Math.round(v / 20) * 20);

    // 캔버스를 줄이려는 크기가 이미 놓여있는 좌석의 테두리를 침범하는지 검사한다 —
    // 침범하면 좌석을 억지로 밀어내지 않고, 그 방향으로는 아예 줄이지 못하게 막는다.
    const wouldOverflowWidth = (nextW: number) => seats.some(s => s.x + seatW / 2 > nextW || s.x - seatW / 2 < 0);
    const wouldOverflowHeight = (nextH: number) => seats.some(s => s.y + seatH / 2 > nextH || s.y - seatH / 2 < 0);

    // 클리닉 쪽(학생/TA pad/supervisor) 접속 여부 — 하나라도 있으면 편집 잠금
    const [clinicOccupied, setClinicOccupied] = useState<boolean | null>(null); // null = 아직 확인 중
    const [editing, setEditing] = useState(false);

    const channelRef = useRef<any>(null);
    const editorClientIdRef = useRef<string>("");
    const dragStateRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; scale: number } | null>(null);

    useEffect(() => {
        let saved = localStorage.getItem(EDITOR_ID_KEY);
        if (!saved) {
            saved = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            localStorage.setItem(EDITOR_ID_KEY, saved);
        }
        editorClientIdRef.current = saved;

        getActiveSeatLayout().then(l => {
            setLayout(l);
            setSeats(l.seats);
            setSeatW(clampSeatSize(l.seatWidth));
            setSeatH(clampSeatSize(l.seatHeight));
            setCanvasW(clampCanvasSize(l.canvasWidth));
            setCanvasH(clampCanvasSize(l.canvasHeight));
            setLoading(false);
        });

        const channel = supabase.channel(CLINIC_ROOM);
        channelRef.current = channel;
        const checkPresence = () => {
            const state = channel.presenceState();
            let hasClinicUser = false;
            Object.values(state).forEach((metas: any) => {
                (metas as any[]).forEach(meta => {
                    if (meta.role && meta.role !== 'editor') hasClinicUser = true;
                    // 학생 presence는 role이 없고 seat/studentId만 있음
                    if (!meta.role && (meta.seat || meta.studentId)) hasClinicUser = true;
                });
            });
            setClinicOccupied(hasClinicUser);
        };
        channel
            .on('presence', { event: 'sync' }, checkPresence)
            .subscribe((status: string) => { if (status === 'SUBSCRIBED') checkPresence(); });

        return () => {
            if (channelRef.current) {
                channelRef.current.untrack().catch(() => {});
                supabase.removeChannel(channelRef.current);
            }
        };
    }, []);

    const enterEditMode = () => {
        if (clinicOccupied) return;
        channelRef.current?.track({ role: 'editor', clientId: editorClientIdRef.current, joined_at: Date.now() });
        setEditing(true);
    };

    const exitEditMode = () => {
        // 💡 저장 안 한 변경사항이 있는 채로 닫으면 그대로 날아가버리므로, dirty 상태일 때만 한 번 확인한다.
        if (dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 저장하지 않고 닫으시겠습니까?')) return;
        channelRef.current?.untrack();
        setEditing(false);
    };

    // ===== 드래그 + 스냅 =====
    const handlePointerDown = (e: React.PointerEvent, seat: Seat) => {
        if (!editing) return;
        const canvasEl = (e.currentTarget.closest('[data-seat-canvas]') as HTMLElement) || null;
        const scale = canvasEl ? Number(canvasEl.dataset.scale) || 1 : 1;
        dragStateRef.current = { id: seat.id, startX: e.clientX, startY: e.clientY, origX: seat.x, origY: seat.y, scale };
        setDraggingId(seat.id);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        const drag = dragStateRef.current;
        if (!drag) return;
        const dxScreen = e.clientX - drag.startX;
        const dyScreen = e.clientY - drag.startY;
        let x = drag.origX + dxScreen / drag.scale;
        let y = drag.origY + dyScreen / drag.scale;

        // 좌석의 "중심"이 아니라 "모서리(테두리)"가 격자선에 맞아야 모눈종이 칸에 딱 들어맞는
        // 느낌이 난다 — 카드 절반 폭/높이가 격자 간격의 배수가 아니면(예: 140/2=70은 20의 배수가
        // 아님) 중심을 격자에 맞춰도 테두리는 오히려 칸 사이 어중간한 위치에 걸린다.
        // 좌석 크기가 이제 항상 20의 배수(20~200, 20단위)이므로, 격자에 붙이는 것만으로도 옆
        // 좌석과 자동으로 딱 맞닿는다 — 별도의 자석 스냅은 더 이상 필요 없다.
        x = Math.round((x - seatW / 2) / GRID_SIZE) * GRID_SIZE + seatW / 2;
        y = Math.round((y - seatH / 2) / GRID_SIZE) * GRID_SIZE + seatH / 2;

        x = Math.max(0, Math.min(canvasW, x));
        y = Math.max(0, Math.min(canvasH, y));

        // 모든 좌석이 같은 크기(seatW x seatH)이므로, 중심 좌표 차이가 각 축에서 좌석 폭/높이보다
        // 작으면 두 박스가 겹친다. 정확히 폭/높이만큼 떨어진 경우(딱 맞닿음)는 겹침이 아니므로
        // 등호 없이 "미만"으로만 걸러야, 좌석끼리 서로 붙여서 배치하는 건 계속 가능하다.
        const overlapsExisting = seats.some(s => s.id !== drag.id && Math.abs(s.x - x) < seatW && Math.abs(s.y - y) < seatH);
        if (overlapsExisting) return; // 다른 좌석과 겹치는 위치로는 이동시키지 않고, 마지막 유효 위치에 그대로 둔다.

        // 드래그로 위치가 바뀔 때마다 즉시 책 읽는 방향(위→아래, 왼쪽→오른쪽)으로 번호를 다시
        // 매겨서, 저장하기 전에도 화면에 최종 번호가 그대로 보이게 한다.
        setSeats(prev => renumberSeats(prev.map(s => s.id === drag.id ? { ...s, x, y } : s), canvasH));
        setDirty(true);
    };

    const handlePointerUp = () => {
        dragStateRef.current = null;
        setDraggingId(null);
    };

    // ===== 좌석 추가/삭제 =====
    const applySeatCount = (count: number) => {
        if (count < 1) return;
        setSeats(prev => {
            let next = [...prev];
            if (count > next.length) {
                const toAdd = count - next.length;
                for (let i = 0; i < toAdd; i++) {
                    next.push({
                        id: `seat_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
                        number: 0, // 아래에서 책 읽는 방향으로 다시 매겨지므로 임시값
                        x: canvasW / 2 + (i - toAdd / 2) * (seatW + 10),
                        y: canvasH / 2,
                    });
                }
            } else if (count < next.length) {
                next = renumberSeats(next, canvasH).sort((a, b) => a.number - b.number).slice(0, count);
            }
            // 좌석 수를 늘리거나 줄인 뒤에도 항상 책 읽는 방향(위→아래, 왼쪽→오른쪽)으로 번호를 다시 매긴다.
            return renumberSeats(next, canvasH);
        });
        setDirty(true);
    };

    const removeSeat = (id: string) => {
        setSeats(prev => renumberSeats(prev.filter(s => s.id !== id), canvasH));
        setDirty(true);
    };

    // ===== 캔버스 크기 조정 =====
    // 키우는 건 항상 허용하지만, 줄일 때는 그 경계 안에 이미 놓인 좌석이 있으면(테두리가 밖으로
    // 밀려나게 되면) 좌석을 억지로 옮기지 않고 아예 줄이지 못하게 막는다.
    const applyCanvasSize = (axis: "w" | "h", delta: number) => {
        if (axis === "w") {
            const next = clampCanvasSize(canvasW + delta);
            if (next < canvasW && wouldOverflowWidth(next)) {
                alert('가로 끝에 이미 놓인 좌석이 있어서 더 줄일 수 없습니다. 먼저 좌석을 안쪽으로 옮겨주세요.');
                return;
            }
            setCanvasW(next);
        } else {
            const next = clampCanvasSize(canvasH + delta);
            if (next < canvasH && wouldOverflowHeight(next)) {
                alert('세로 끝에 이미 놓인 좌석이 있어서 더 줄일 수 없습니다. 먼저 좌석을 안쪽으로 옮겨주세요.');
                return;
            }
            setCanvasH(next);
        }
        setDirty(true);
    };

    const handleSave = async () => {
        setSaving(true);
        const res = await saveSeatLayout(seats, canvasW, canvasH, seatW, seatH, editorClientIdRef.current);
        setSaving(false);
        if (res.success && res.layout) {
            setLayout(res.layout);
            setSeats(res.layout.seats);
            setSeatW(clampSeatSize(res.layout.seatWidth));
            setSeatH(clampSeatSize(res.layout.seatHeight));
            setCanvasW(clampCanvasSize(res.layout.canvasWidth));
            setCanvasH(clampCanvasSize(res.layout.canvasHeight));
            setDirty(false);
            channelRef.current?.send({ type: 'broadcast', event: 'layout_updated', payload: { at: Date.now() } });
            alert('좌석 배치가 저장되었습니다.');
        } else {
            alert(`저장 실패: ${res.message || '알 수 없는 오류'}`);
        }
    };

    if (loading) {
        return <div className="p-8 text-slate-400 text-sm">불러오는 중...</div>;
    }

    if (clinicOccupied === null) {
        return <div className="p-8 text-slate-400 text-sm">클리닉 접속 현황 확인 중...</div>;
    }

    if (clinicOccupied && !editing) {
        return (
            <div className="p-8">
                <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-8 text-center max-w-lg mx-auto">
                    <div className="text-4xl mb-3">🔒</div>
                    <h2 className="text-lg font-bold text-amber-800 mb-2">클리닉 사용 중입니다</h2>
                    <p className="text-sm text-amber-700">학생, TA pad, 또는 supervisor 화면이 접속해 있는 동안에는<br />좌석 배치를 수정할 수 없습니다. 모두 종료된 후 다시 시도해주세요.</p>
                </div>
            </div>
        );
    }

    if (!editing) {
        return (
            <div className="p-8">
                <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center max-w-lg mx-auto shadow-sm">
                    <h2 className="text-lg font-bold text-slate-800 mb-2">좌석 배치 편집</h2>
                    <p className="text-sm text-slate-500 mb-6">현재 클리닉 접속자가 없습니다. 편집을 시작하면<br />편집이 끝날 때까지 클리닉 화면들이 잠깁니다.</p>
                    <button onClick={enterEditMode} className="bg-[#002864] text-white font-bold px-6 py-3 rounded-xl">편집 시작</button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full pt-20 px-4 pb-4 gap-3" onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
            <div className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shrink-0">
                <div className="flex items-center gap-3">
                    <h1 className="font-bold text-slate-800">좌석 배치 편집</h1>
                    <span className="text-xs text-slate-400">현재 {seats.length}석</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <button
                            onClick={() => setSizePanelOpen(p => !p)}
                            title="좌석 설정"
                            className={`w-9 h-9 flex items-center justify-center rounded-lg border text-base transition-colors ${sizePanelOpen ? 'bg-[#002864] text-white border-[#002864]' : 'text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                        >⚙️</button>
                        {sizePanelOpen && (
                            <div className="absolute right-0 top-11 z-20 bg-white border border-slate-200 rounded-xl shadow-lg p-4 w-56">
                                <p className="text-xs font-bold text-slate-500 mb-2">좌석 수</p>
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs text-slate-400">개수</span>
                                    <div className="flex items-center gap-1.5">
                                        <button onClick={() => applySeatCount(Math.max(1, seats.length - 1))} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 text-slate-500 font-bold">−</button>
                                        <span className="w-10 text-center text-sm font-bold text-slate-700 tabular-nums">{seats.length}</span>
                                        <button onClick={() => applySeatCount(seats.length + 1)} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 text-slate-500 font-bold">+</button>
                                    </div>
                                </div>
                                <p className="text-xs font-bold text-slate-500 mb-2">좌석 크기 (20 단위, 20~200)</p>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs text-slate-400">가로</span>
                                    <div className="flex items-center gap-1.5">
                                        <button onClick={() => { setSeatW(w => clampSeatSize(w - 20)); setDirty(true); }} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 text-slate-500 font-bold">−</button>
                                        <span className="w-10 text-center text-sm font-bold text-slate-700 tabular-nums">{seatW}</span>
                                        <button onClick={() => { setSeatW(w => clampSeatSize(w + 20)); setDirty(true); }} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 text-slate-500 font-bold">+</button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs text-slate-400">세로</span>
                                    <div className="flex items-center gap-1.5">
                                        <button onClick={() => { setSeatH(h => clampSeatSize(h - 20)); setDirty(true); }} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 text-slate-500 font-bold">−</button>
                                        <span className="w-10 text-center text-sm font-bold text-slate-700 tabular-nums">{seatH}</span>
                                        <button onClick={() => { setSeatH(h => clampSeatSize(h + 20)); setDirty(true); }} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 text-slate-500 font-bold">+</button>
                                    </div>
                                </div>
                                <p className="text-xs font-bold text-slate-500 mb-2">캔버스 크기 (20 단위, 400~)</p>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs text-slate-400">가로</span>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => applyCanvasSize('w', -20)}
                                            disabled={wouldOverflowWidth(canvasW - 20)}
                                            title={wouldOverflowWidth(canvasW - 20) ? '가로 끝에 좌석이 있어 줄일 수 없습니다' : undefined}
                                            className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 text-slate-500 font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                                        >−</button>
                                        <span className="w-10 text-center text-sm font-bold text-slate-700 tabular-nums">{canvasW}</span>
                                        <button onClick={() => applyCanvasSize('w', 20)} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 text-slate-500 font-bold">+</button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-400">세로</span>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => applyCanvasSize('h', -20)}
                                            disabled={wouldOverflowHeight(canvasH - 20)}
                                            title={wouldOverflowHeight(canvasH - 20) ? '세로 끝에 좌석이 있어 줄일 수 없습니다' : undefined}
                                            className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 text-slate-500 font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                                        >−</button>
                                        <span className="w-10 text-center text-sm font-bold text-slate-700 tabular-nums">{canvasH}</span>
                                        <button onClick={() => applyCanvasSize('h', 20)} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 text-slate-500 font-bold">+</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    <button onClick={exitEditMode} className="text-slate-500 text-sm font-semibold px-4 py-2 rounded-lg border border-slate-200">닫기</button>
                    <button onClick={handleSave} disabled={saving || !dirty} className="bg-[#002864] text-white text-sm font-bold px-5 py-2 rounded-lg disabled:opacity-30">
                        {saving ? '저장 중...' : '저장'}
                    </button>
                </div>
            </div>

            <p className="text-xs text-slate-400 shrink-0">좌석을 드래그해서 배치하세요. 항상 배경 격자점에 모서리가 딱 맞춰지고, 좌석 번호(1~{seats.length})는 책 읽는 방향(위→아래, 왼쪽→오른쪽)으로 옮길 때마다 바로 다시 매겨집니다.</p>

            <div className="flex-1 bg-slate-100 rounded-2xl min-h-0 p-4">
                <SeatCanvas
                    seats={seats}
                    canvasWidth={canvasW}
                    canvasHeight={canvasH}
                    overlay={
                        <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
                            <defs>
                                <pattern id="seat-grid-lines" width={`${(GRID_SIZE / canvasW) * 100}%`} height={`${(GRID_SIZE / canvasH) * 100}%`} patternUnits="objectBoundingBox">
                                    <path d="M 0 0 H 10000 M 0 0 V 10000" fill="none" stroke="#dbe3ee" strokeWidth={1} />
                                </pattern>
                            </defs>
                            <rect width="100%" height="100%" fill="url(#seat-grid-lines)" />
                            <rect width="100%" height="100%" fill="none" stroke="#c7d0de" strokeWidth={1} />
                        </svg>
                    }
                    renderSeat={(seat, scale) => {
                        // 💡 이 바깥 껍데기는 반드시 화면에 실제로 보이는 크기(seatW*scale)여야 한다.
                        // 껍데기를 원래(축소 전) 크기로 두면, 눈에 보이는 카드보다 훨씬 넓은 투명
                        // 영역이 남아서 뒤에 그려지는(reading-order상 나중인) 이웃 좌석의 투명 영역이
                        // 그 위를 덮어버리고, 결과적으로 카드의 왼쪽 위 한 귀퉁이만 클릭이 먹는
                        // 버그가 생긴다 — supervisor의 SeatGrid에서 이미 겪었던 것과 같은 문제.
                        const outerStyle = { width: seatW * scale, height: seatH * scale } as const;
                        const innerStyle = { width: seatW, height: seatH, transform: `scale(${scale})`, transformOrigin: 'top left' } as const;
                        return (
                            <div style={outerStyle} className="relative">
                                <div
                                    onPointerDown={(e) => handlePointerDown(e, seat)}
                                    style={innerStyle}
                                    className="relative cursor-grab active:cursor-grabbing select-none"
                                >
                                    <EmptySeatTile label={seat.number} highlighted={draggingId === seat.id} />
                                    <button
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={() => removeSeat(seat.id)}
                                        title="좌석 삭제"
                                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-500 hover:bg-rose-600 text-white rounded-full flex items-center justify-center text-[10px] shadow-md border-2 border-white z-10"
                                    >×</button>
                                </div>
                            </div>
                        );
                    }}
                />
            </div>
        </div>
    );
}
