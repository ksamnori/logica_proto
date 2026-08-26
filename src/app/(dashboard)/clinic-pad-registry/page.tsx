// src/app/(dashboard)/clinic-pad-registry/page.tsx
// 클리닉 좌석과 키오스크 패드(기기ID)를 1:1로 묶어주는 관리 화면. 좌석 배치도는
// seat-layout-editor가 그대로 저장해둔 걸 읽기 전용으로 보여주고, 좌석을 클릭하면
// 그 좌석에 물릴 기기ID를 입력/변경/해제할 수 있다.
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ensureInstructorSession } from "@/lib/session";
import { getActiveSeatLayout } from "@/app/actions/clinicSeatLayout";
import { listPadDevicesByTenant, assignPadDevice, unassignPadDevice } from "@/app/actions/clinicPadDevice";
import { Seat, SeatLayout } from "@/lib/clinicSeatLayout";
import SeatCanvas from "@/app/clinic/_shared/SeatCanvas";

export default function ClinicPadRegistryPage() {
    const router = useRouter();

    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
    const [layout, setLayout] = useState<SeatLayout | null>(null);
    const [deviceBySeat, setDeviceBySeat] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [modalSeat, setModalSeat] = useState<Seat | null>(null);
    const [deviceIdInput, setDeviceIdInput] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const checkAccess = async () => {
            if (!(await ensureInstructorSession())) {
                alert("로그인 정보가 없습니다. 다시 로그인해 주세요.");
                router.replace("/");
                return;
            }
            const role = localStorage.getItem("logica_instructor_role") || "";
            const pos = localStorage.getItem("logica_instructor_position") || "";
            const tId = localStorage.getItem("logica_tenant_id") || "";

            const isGodMode = role === 'SUPER_ADMIN' || role === 'ADMIN' ||
                              pos.includes('최고관리자') || pos.includes('대장') || pos.includes('원장');

            if (isGodMode) { setIsAuthorized(true); return; }

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

            if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/clinic-pad-registry"))) {
                alert("⛔ 키오스크 패드 등록 페이지에 접근할 권한이 없습니다.");
                router.replace("/home");
            } else {
                setIsAuthorized(true);
            }
        };
        checkAccess();
    }, [router]);

    const reload = async () => {
        const [l, devices] = await Promise.all([getActiveSeatLayout(), listPadDevicesByTenant()]);
        setLayout(l);
        setDeviceBySeat(devices);
        setLoading(false);
    };

    useEffect(() => {
        if (!isAuthorized) return;
        reload();
    }, [isAuthorized]);

    const openSeat = (seat: Seat) => {
        setModalSeat(seat);
        setDeviceIdInput(deviceBySeat[String(seat.number)] || "");
    };

    const closeModal = () => { setModalSeat(null); setDeviceIdInput(""); };

    const handleSave = async () => {
        if (!modalSeat) return;
        const trimmed = deviceIdInput.trim();
        if (!trimmed) { alert("기기ID를 입력해주세요."); return; }
        setSaving(true);
        const res = await assignPadDevice(trimmed, String(modalSeat.number));
        setSaving(false);
        if (!res.success) { alert(`등록 실패: ${res.message || '알 수 없는 오류'}`); return; }
        await reload();
        closeModal();
    };

    const handleUnassign = async () => {
        if (!modalSeat) return;
        if (!window.confirm(`${modalSeat.number}번 좌석의 패드 등록을 해제하시겠습니까?`)) return;
        setSaving(true);
        const res = await unassignPadDevice(String(modalSeat.number));
        setSaving(false);
        if (!res.success) { alert(`해제 실패: ${res.message || '알 수 없는 오류'}`); return; }
        await reload();
        closeModal();
    };

    if (isAuthorized === null) {
        return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
    }
    if (isAuthorized === false) return null;
    if (loading || !layout) {
        return <div className="p-8 text-slate-400 text-sm">불러오는 중...</div>;
    }

    return (
        <div className="flex flex-col h-full pt-28 px-4 pb-4 gap-3">
            <div className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shrink-0">
                <div className="flex items-center gap-3">
                    <h1 className="font-bold text-slate-800">키오스크 패드 등록</h1>
                    <span className="text-xs text-slate-400">
                        등록됨 {Object.keys(deviceBySeat).length} / 전체 {layout.seats.length}석
                    </span>
                </div>
                <p className="text-xs text-slate-400">
                    좌석을 클릭해서 그 자리 패드의 기기ID를 등록하세요. 기기ID는 패드의 로그인 화면에 표시됩니다.
                </p>
            </div>

            <div className="flex-1 bg-slate-100 rounded-2xl min-h-0 p-4">
                <SeatCanvas
                    seats={layout.seats}
                    canvasWidth={layout.canvasWidth}
                    canvasHeight={layout.canvasHeight}
                    renderSeat={(seat, scale) => {
                        const w = layout.seatWidth, h = layout.seatHeight;
                        const deviceId = deviceBySeat[String(seat.number)];
                        return (
                            <div style={{ width: w * scale, height: h * scale }}>
                                <button
                                    onClick={() => openSeat(seat)}
                                    style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }}
                                    className={`w-full h-full rounded-xl p-2 flex flex-col items-center justify-center gap-1 shadow-sm border-2 transition-colors ${deviceId ? 'bg-emerald-50 border-emerald-300 hover:bg-emerald-100' : 'bg-white/80 border-dashed border-slate-300 hover:bg-slate-50'}`}
                                >
                                    <span className="text-slate-600 text-[11px] font-black">{seat.number}번</span>
                                    <span className={`text-[9px] font-bold truncate max-w-full px-1 ${deviceId ? 'text-emerald-700' : 'text-slate-400'}`}>
                                        {deviceId ? deviceId : '미등록'}
                                    </span>
                                </button>
                            </div>
                        );
                    }}
                />
            </div>

            {modalSeat && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[10000] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
                        <h3 className="font-bold text-slate-800 mb-1">{modalSeat.number}번 좌석 패드 등록</h3>
                        <p className="text-xs text-slate-500 mb-4">이 좌석의 패드 로그인 화면에 표시된 기기ID를 입력하세요.</p>
                        <input
                            value={deviceIdInput}
                            onChange={(e) => setDeviceIdInput(e.target.value)}
                            placeholder="기기ID"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#002864]/30"
                        />
                        <div className="flex flex-col gap-2">
                            <button onClick={handleSave} disabled={saving} className="bg-[#002864] text-white font-bold text-sm px-5 py-2.5 rounded-lg disabled:opacity-50">
                                {saving ? '저장 중...' : '저장'}
                            </button>
                            {deviceBySeat[String(modalSeat.number)] && (
                                <button onClick={handleUnassign} disabled={saving} className="bg-rose-50 text-rose-600 font-bold text-sm px-5 py-2.5 rounded-lg hover:bg-rose-100 disabled:opacity-50">
                                    등록 해제
                                </button>
                            )}
                            <button onClick={closeModal} disabled={saving} className="text-slate-500 font-semibold text-sm px-5 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50">
                                취소
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
