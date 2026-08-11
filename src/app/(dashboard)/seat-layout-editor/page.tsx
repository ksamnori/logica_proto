// src/app/(dashboard)/seat-layout-editor/page.tsx
"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { supabase, CLINIC_ROOM } from "@/lib/supabase";
import { getActiveSeatLayout, saveSeatLayout } from "@/app/actions/clinicSeatLayout";
import { Seat, SeatLayout, DEFAULT_CANVAS_W, DEFAULT_CANVAS_H, DEFAULT_SEAT_CARD_W, DEFAULT_SEAT_CARD_H, renumberSeats } from "@/lib/clinicSeatLayout";
import SeatCanvas from "@/app/clinic/_shared/SeatCanvas";
import EmptySeatTile from "@/app/clinic/_shared/EmptySeatTile";

const GRID_SIZE = 20; 
const EDITOR_ID_KEY = "logica_seat_editor_client_id";

export default function SeatLayoutEditorPage() {
    const router = useRouter();

    // 🌟 [보안 로직 추가] 권한 확인 상태
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

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

    const clampSeatSize = (v: number) => Math.min(200, Math.max(20, Math.round(v / 20) * 20));
    const clampCanvasSize = (v: number) => Math.max(400, Math.round(v / 20) * 20);

    const wouldOverflowWidth = (nextW: number) => seats.some(s => s.x + seatW / 2 > nextW || s.x - seatW / 2 < 0);
    const wouldOverflowHeight = (nextH: number) => seats.some(s => s.y + seatH / 2 > nextH || s.y - seatH / 2 < 0);

    const [clinicOccupied, setClinicOccupied] = useState<boolean | null>(null); 
    const [editing, setEditing] = useState(false);
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);
    const [closeConfirmPortalTarget, setCloseConfirmPortalTarget] = useState<HTMLElement | null>(null);
    useEffect(() => { setCloseConfirmPortalTarget(document.body); }, []);

    const channelRef = useRef<any>(null);
    const editorClientIdRef = useRef<string>("");
    const dragStateRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; scale: number } | null>(null);

    const applyLayoutState = useCallback((l: SeatLayout) => {
        setLayout(l);
        setSeats(l.seats);
        setSeatW(clampSeatSize(l.seatWidth));
        setSeatH(clampSeatSize(l.seatHeight));
        setCanvasW(clampCanvasSize(l.canvasWidth));
        setCanvasH(clampCanvasSize(l.canvasHeight));
    }, []);

    // 🌟 [보안 로직 추가] 컴포넌트 마운트 시 즉시 권한부터 검사합니다!
    useEffect(() => {
        const checkAccess = async () => {
            const role = localStorage.getItem("logica_instructor_role") || "";
            const pos = localStorage.getItem("logica_instructor_position") || "";
            const tId = localStorage.getItem("logica_tenant_id") || "";
            
            const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' || 
                              pos.includes('최고관리자') || pos.includes('대장') || pos.includes('원장');
            
            if (isGodMode) {
                setIsAuthorized(true);
                return;
            }

            if (!tId || !role) {
                alert("권한 정보가 없습니다.");
                router.replace("/home");
                return;
            }

            const { data } = await supabase
                .from('tenant_role_permissions')
                .select('allowed_menus')
                .eq('tenant_id', tId)
                .eq('role_name', role)
                .maybeSingle();

            // 좌석 배치도 메뉴 접근 권한이 없다면 가차없이 쫓아냅니다.
            if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/seat-layout-editor"))) {
                alert("⛔ 좌석 배치도 편집 페이지에 접근할 권한이 없습니다.");
                router.replace("/home");
            } else {
                setIsAuthorized(true);
            }
        };

        checkAccess();
    }, [router]);

    // 🌟 권한이 확인된 후에만 데이터를 불러오고 소켓 연결을 시작합니다.
    useEffect(() => {
        if (!isAuthorized) return;

        let saved = localStorage.getItem(EDITOR_ID_KEY);
        if (!saved) {
            saved = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            localStorage.setItem(EDITOR_ID_KEY, saved);
        }
        editorClientIdRef.current = saved;

        getActiveSeatLayout().then(l => {
            applyLayoutState(l);
            setLoading(false);
        });

        const myTenantId = localStorage.getItem("logica_tenant_id") || "hq";
        const channelName = `${CLINIC_ROOM}_${myTenantId}`;

        const channel = supabase.channel(channelName);
        channelRef.current = channel;
        const checkPresence = () => {
            const state = channel.presenceState();
            let hasClinicUser = false;
            Object.values(state).forEach((metas: any) => {
                (metas as any[]).forEach(meta => {
                    if (meta.role && meta.role !== 'editor') hasClinicUser = true;
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
    }, [isAuthorized, applyLayoutState]);

    const enterEditMode = () => {
        if (clinicOccupied) return;
        channelRef.current?.track({ role: 'editor', clientId: editorClientIdRef.current, joined_at: Date.now() });
        setEditing(true);
    };

    const leaveEditMode = () => {
        channelRef.current?.untrack();
        setEditing(false);
        setShowCloseConfirm(false);
    };

    const exitEditMode = () => {
        if (dirty) { setShowCloseConfirm(true); return; }
        leaveEditMode();
    };

    const confirmSaveAndClose = async () => {
        const ok = await doSave();
        if (ok) leaveEditMode();
    };

    const confirmDiscardAndClose = () => {
        if (layout) applyLayoutState(layout);
        setDirty(false);
        leaveEditMode();
    };

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

        x = Math.round((x - seatW / 2) / GRID_SIZE) * GRID_SIZE + seatW / 2;
        y = Math.round((y - seatH / 2) / GRID_SIZE) * GRID_SIZE + seatH / 2;

        x = Math.max(0, Math.min(canvasW, x));
        y = Math.max(0, Math.min(canvasH, y));

        const overlapsExisting = seats.some(s => s.id !== drag.id && Math.abs(s.x - x) < seatW && Math.abs(s.y - y) < seatH);
        if (overlapsExisting) return; 

        setSeats(prev => renumberSeats(prev.map(s => s.id === drag.id ? { ...s, x, y } : s), canvasH));
        setDirty(true);
    };

    const handlePointerUp = () => {
        dragStateRef.current = null;
        setDraggingId(null);
    };

    const applySeatCount = (count: number) => {
        if (count < 1) return;
        setSeats(prev => {
            let next = [...prev];
            if (count > next.length) {
                const toAdd = count - next.length;
                for (let i = 0; i < toAdd; i++) {
                    next.push({
                        id: `seat_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
                        number: 0, 
                        x: canvasW / 2 + (i - toAdd / 2) * (seatW + 10),
                        y: canvasH / 2,
                    });
                }
            } else if (count < next.length) {
                next = renumberSeats(next, canvasH).sort((a, b) => a.number - b.number).slice(0, count);
            }
            return renumberSeats(next, canvasH);
        });
        setDirty(true);
    };

    const removeSeat = (id: string) => {
        setSeats(prev => renumberSeats(prev.filter(s => s.id !== id), canvasH));
        setDirty(true);
    };

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

    const doSave = async (): Promise<boolean> => {
        setSaving(true);
        const res = await saveSeatLayout(seats, canvasW, canvasH, seatW, seatH, editorClientIdRef.current);
        setSaving(false);
        
        if (res.success && res.layout) {
            applyLayoutState(res.layout);
            setDirty(false);
            channelRef.current?.send({ type: 'broadcast', event: 'layout_updated', payload: { at: Date.now() } });
            return true;
        }
        alert(`저장 실패: ${res.message || '알 수 없는 오류'}`);
        return false;
    };

    const handleSave = async () => {
        const ok = await doSave();
        if (ok) alert('좌석 배치가 저장되었습니다.');
    };

    // 🌟 권한 확인 중이거나 권한이 없을 경우 화면 원천 차단
    if (isAuthorized === null) {
        return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
    }
    
    if (isAuthorized === false) {
        return null; // 이미 useEffect에서 alert 후 home으로 튕겨냅니다.
    }

    if (loading) {
        return <div className="p-8 text-slate-400 text-sm">불러오는 중...</div>;
    }

    if (clinicOccupied === null) {
        return <div className="p-8 text-slate-400 text-sm">클리닉 접속 현황 확인 중...</div>;
    }

    if (clinicOccupied && !editing) {
        return (
            <div className="p-8 pt-28">
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
            <div className="p-8 pt-28">
                <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center max-w-lg mx-auto shadow-sm">
                    <h2 className="text-lg font-bold text-slate-800 mb-2">좌석 배치 편집</h2>
                    <p className="text-sm text-slate-500 mb-6">현재 클리닉 접속자가 없습니다. 편집을 시작하면<br />편집이 끝날 때까지 클리닉 화면들이 잠깁니다.</p>
                    <button onClick={enterEditMode} className="bg-[#002864] text-white font-bold px-6 py-3 rounded-xl">편집 시작</button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full pt-28 px-4 pb-4 gap-3" onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
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

            {showCloseConfirm && closeConfirmPortalTarget && createPortal(
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[10000] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
                        <h3 className="font-bold text-slate-800 mb-2">저장하지 않은 변경사항이 있습니다</h3>
                        <p className="text-sm text-slate-500 mb-6">닫기 전에 변경사항을 저장하시겠습니까?</p>
                        <div className="flex flex-col gap-2">
                            <button onClick={confirmSaveAndClose} disabled={saving} className="bg-[#002864] text-white font-bold text-sm px-5 py-2.5 rounded-lg disabled:opacity-50">
                                {saving ? '저장 중...' : '저장하고 닫기'}
                            </button>
                            <button onClick={confirmDiscardAndClose} disabled={saving} className="bg-rose-50 text-rose-600 font-bold text-sm px-5 py-2.5 rounded-lg hover:bg-rose-100 disabled:opacity-50">저장하지 않고 닫기</button>
                            <button onClick={() => setShowCloseConfirm(false)} disabled={saving} className="text-slate-500 font-semibold text-sm px-5 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50">취소</button>
                        </div>
                    </div>
                </div>,
                closeConfirmPortalTarget
            )}
        </div>
    );
}