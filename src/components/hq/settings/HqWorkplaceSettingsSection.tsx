// src/components/hq/settings/HqWorkplaceSettingsSection.tsx
"use client";

import React, { useMemo, useState } from "react";
import { DEFAULT_WORK_FORM_POLICIES } from "@/lib/hq/defaultApprovalPolicies";
import { DEFAULT_ORG_CHART_NODES } from "@/lib/hq/defaultCompanySettings";
import {
  DEFAULT_WORKPLACES,
  DEFAULT_WORKPLACE_IPS,
} from "@/lib/hq/defaultWorkRules";
import type {
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqWorkFormPolicy,
  HqWorkplaceLocationItem,
  HqWorkplaceWifiIpItem,
} from "@/lib/hq/types";
import type { HqSettingsTab } from "./HqSettingsModal";

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const RADIUS_OPTIONS = [50, 100, 200, 300, 500, 1000] as const;

function calcDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function formatRadius(meters: number): string {
  return meters >= 1000 ? `${meters / 1000}km` : `${meters}m`;
}

interface Props {
  settings: HqCompanySettings;
  canEdit: boolean;
  saving: boolean;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onNavigateTab: (tab: HqSettingsTab) => void;
}

export default function HqWorkplaceSettingsSection({
  settings,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: Props) {
  const ex = settings.extra_settings || {};

  const workplaces: HqWorkplaceLocationItem[] = useMemo(() => {
    const raw =
      ex.workplaces && ex.workplaces.length > 0
        ? ex.workplaces
        : DEFAULT_WORKPLACES;
    return raw.map((wp) =>
      wp.sync_company_address && settings.address
        ? {
            ...wp,
            name: wp.name || `${settings.company_name} 본사`,
            address: settings.address,
          }
        : wp
    );
  }, [ex.workplaces, settings.address, settings.company_name]);

  const workplaceIps: HqWorkplaceWifiIpItem[] =
    ex.workplace_ips || DEFAULT_WORKPLACE_IPS;

  const workForms: HqWorkFormPolicy[] =
    ex.work_form_policies && ex.work_form_policies.length > 0
      ? ex.work_form_policies
      : DEFAULT_WORK_FORM_POLICIES;

  const orgDepts = useMemo(() => {
    const nodes =
      ex.org_chart_nodes && ex.org_chart_nodes.length > 0
        ? ex.org_chart_nodes
        : DEFAULT_ORG_CHART_NODES;
    return nodes.filter((n) => !n.is_hidden).map((n) => n.name);
  }, [ex.org_chart_nodes]);

  // 근무지 추가/수정 모달 상태
  const [wpDraft, setWpDraft] = useState<HqWorkplaceLocationItem | null>(null);
  const [isNewWp, setIsNewWp] = useState(false);
  const [openWpMenuId, setOpenWpMenuId] = useState<string | null>(null);
  const [locatingGps, setLocatingGps] = useState(false);
  const [distanceTestResult, setDistanceTestResult] = useState<string | null>(
    null
  );

  // 허용 IP 추가/수정 모달 상태
  const [ipDraft, setIpDraft] = useState<HqWorkplaceWifiIpItem | null>(null);
  const [isNewIp, setIsNewIp] = useState(false);

  // 1) 근무지 모달 열기 / 저장 / GPS 토글 / 삭제
  const openCreateWpModal = () => {
    setOpenWpMenuId(null);
    setDistanceTestResult(null);
    setIsNewWp(true);
    setWpDraft({
      id: `wp-${uid()}`,
      name: "",
      address: "",
      detail_address: "",
      latitude: 37.5032,
      longitude: 127.0938,
      radius_meters: 200,
      gps_enabled: false,
      is_primary: false,
      sync_company_address: false,
      apply_scope: "ALL",
      applied_departments: [],
    });
  };

  const openEditWpModal = (wp: HqWorkplaceLocationItem) => {
    setOpenWpMenuId(null);
    setDistanceTestResult(null);
    setIsNewWp(false);
    setWpDraft({ ...wp });
  };

  const handleFetchBrowserGps = () => {
    if (!wpDraft) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      alert("현재 브라우저에서 GPS 위치 조회를 지원하지 않습니다.");
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setWpDraft((prev) =>
          prev ? { ...prev, latitude: lat, longitude: lng } : null
        );
        setDistanceTestResult("현재 접속 위치의 GPS 좌표가 입력되었습니다.");
        setLocatingGps(false);
      },
      (err) => {
        alert(
          err.code === 1
            ? "브라우저 위치 권한이 거부되어 있습니다. 주소창 좌측 권한에서 위치를 허용하거나 위·경도를 직접 입력해 주세요."
            : "현재 GPS 좌표를 가져오지 못했습니다."
        );
        setLocatingGps(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleTestDistance = () => {
    if (!wpDraft) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      alert("현재 브라우저에서 위치 조회를 지원하지 않습니다.");
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const dist = calcDistanceMeters(
          wpDraft.latitude,
          wpDraft.longitude,
          pos.coords.latitude,
          pos.coords.longitude
        );
        const inside = dist <= wpDraft.radius_meters;
        setDistanceTestResult(
          inside
            ? `✅ 현재 위치가 설정 근무지 반경(${formatRadius(
                wpDraft.radius_meters
              )}) 이내입니다. (약 ${dist}m 거리)`
            : `⚠️ 현재 위치가 설정 근무지로부터 약 ${
                dist >= 1000
                  ? `${(dist / 1000).toFixed(1)}km`
                  : `${dist}m`
              } 떨어져 있습니다.`
        );
        setLocatingGps(false);
      },
      () => {
        alert("현재 위치를 확인할 수 없습니다. 위치 권한을 확인해 주세요.");
        setLocatingGps(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSaveWorkplace = async () => {
    if (!wpDraft) return;
    if (!wpDraft.name.trim()) {
      alert("근무지 이름을 입력해주세요.");
      return;
    }
    if (!wpDraft.address.trim()) {
      alert("근무지 주소를 입력해주세요.");
      return;
    }

    const clean: HqWorkplaceLocationItem = {
      ...wpDraft,
      name: wpDraft.name.trim(),
      address: wpDraft.address.trim(),
      detail_address: (wpDraft.detail_address || "").trim(),
      latitude: Number(wpDraft.latitude || 37.5032),
      longitude: Number(wpDraft.longitude || 127.0938),
    };

    const nextList = isNewWp
      ? [...workplaces, clean]
      : workplaces.map((w) => (w.id === clean.id ? clean : w));

    await onSaveExtra(
      { workplaces: nextList },
      isNewWp
        ? `'${clean.name}' 근무지가 등록되었습니다.`
        : `'${clean.name}' 근무지 설정이 저장되었습니다.`
    );
    setWpDraft(null);
  };

  const handleQuickToggleGps = async (target: HqWorkplaceLocationItem) => {
    if (!canEdit) return;
    const nextEnabled = !target.gps_enabled;
    const nextList = workplaces.map((w) =>
      w.id === target.id ? { ...w, gps_enabled: nextEnabled } : w
    );
    await onSaveExtra(
      { workplaces: nextList },
      nextEnabled
        ? `'${target.name}' GPS 반경(${formatRadius(
            target.radius_meters
          )}) 기준이 활성화되었습니다.`
        : `'${target.name}' GPS 기준이 사용 안 함으로 변경되었습니다.`
    );
  };

  const handleSetPrimaryWp = async (targetId: string) => {
    setOpenWpMenuId(null);
    const nextList = workplaces.map((w) => ({
      ...w,
      is_primary: w.id === targetId,
    }));
    await onSaveExtra(
      { workplaces: nextList },
      "기본 근무지가 변경되었습니다."
    );
  };

  const handleDeleteWp = async (target: HqWorkplaceLocationItem) => {
    setOpenWpMenuId(null);
    if (target.is_primary) {
      alert("기본 근무지는 삭제할 수 없습니다.");
      return;
    }
    if (!confirm(`'${target.name}' 근무지를 삭제하시겠습니까?`)) return;
    await onSaveExtra(
      { workplaces: workplaces.filter((w) => w.id !== target.id) },
      `'${target.name}' 근무지가 삭제되었습니다.`
    );
  };

  // 2) 허용 IP 추가 / 수정 / 토글 / 삭제
  const openCreateIpModal = () => {
    setIsNewIp(true);
    setIpDraft({
      id: `wpip-${uid()}`,
      name: "",
      ip_cidr: "",
      memo: "",
      is_enabled: true,
    });
  };

  const openEditIpModal = (item: HqWorkplaceWifiIpItem) => {
    setIsNewIp(false);
    setIpDraft({ ...item });
  };

  const handleSaveIp = async () => {
    if (!ipDraft) return;
    if (!ipDraft.name.trim()) {
      alert("네트워크 이름을 입력해주세요. (예: 본사 오피스 Wi-Fi)");
      return;
    }
    if (!ipDraft.ip_cidr.trim()) {
      alert("허용할 공인 IPv4 주소 또는 CIDR 대역을 입력해주세요.");
      return;
    }

    const clean: HqWorkplaceWifiIpItem = {
      ...ipDraft,
      name: ipDraft.name.trim(),
      ip_cidr: ipDraft.ip_cidr.trim(),
      memo: (ipDraft.memo || "").trim(),
    };

    const nextIps = isNewIp
      ? [...workplaceIps, clean]
      : workplaceIps.map((i) => (i.id === clean.id ? clean : i));

    await onSaveExtra(
      { workplace_ips: nextIps },
      isNewIp
        ? `'${clean.name}' 출퇴근 허용 IP가 등록되었습니다.`
        : `'${clean.name}' IP 설정이 저장되었습니다.`
    );
    setIpDraft(null);
  };

  const handleToggleIp = async (target: HqWorkplaceWifiIpItem) => {
    if (!canEdit) return;
    const nextIps = workplaceIps.map((i) =>
      i.id === target.id ? { ...i, is_enabled: !i.is_enabled } : i
    );
    await onSaveExtra(
      { workplace_ips: nextIps },
      `'${target.name}' 허용 IP 상태가 변경되었습니다.`
    );
  };

  const handleDeleteIp = async (target: HqWorkplaceWifiIpItem) => {
    if (!confirm(`'${target.name}' 허용 IP를 삭제하시겠습니까?`)) return;
    await onSaveExtra(
      { workplace_ips: workplaceIps.filter((i) => i.id !== target.id) },
      `'${target.name}' 허용 IP가 삭제되었습니다.`
    );
  };

  return (
    <>
      <div className="space-y-9">
        {/* 상단 헤더 */}
        <div>
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            근무지
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            구성원이 출퇴근을 기록할 수 있는 근무지 위치(GPS)와 사내 허용 네트워크(IP)를 관리해 보세요.
          </p>
        </div>

        {/* =============================================================== */}
        {/* 섹션 1: 근무지 관리 (GPS 위치 반경 구성)                         */}
        {/* =============================================================== */}
        <section className="space-y-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-extrabold text-slate-900">
                근무지 위치 (GPS)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                근무지 주소와 GPS 허용 반경을 미리 구성해 두고, 필요할 때 언제든 GPS 인증을 켜거나 끌 수 있어요.
              </p>
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={openCreateWpModal}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
              >
                <span className="text-[#00c458] font-extrabold text-sm leading-none">
                  +
                </span>
                <span>근무지 추가</span>
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {workplaces.map((wp) => (
              <div
                key={wp.id}
                onClick={() => openEditWpModal(wp)}
                className="px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40 transition-all flex flex-wrap items-center justify-between gap-3 shadow-2xs cursor-pointer relative"
              >
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  <span
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center text-base shrink-0 mt-0.5 ${
                      wp.gps_enabled
                        ? "bg-emerald-50 border-emerald-200 text-emerald-600"
                        : "bg-slate-50 border-slate-100 text-slate-400"
                    }`}
                  >
                    📍
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-bold text-slate-900">
                        {wp.name}
                      </span>
                      {wp.is_primary && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                          기본
                        </span>
                      )}
                      {wp.gps_enabled ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-[#00c458] text-[10px] font-extrabold">
                          GPS 사용 중 · 반경 {formatRadius(wp.radius_meters)}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold">
                          GPS 미적용 (반경 {formatRadius(wp.radius_meters)} 구성됨)
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-500 mt-1">
                      {wp.address}
                      {wp.detail_address ? ` (${wp.detail_address})` : ""}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      좌표 {wp.latitude.toFixed(4)}, {wp.longitude.toFixed(4)} ·{" "}
                      {wp.apply_scope === "ALL"
                        ? "전사 구성원 적용"
                        : `${(wp.applied_departments || []).join(", ") || "지정 조직"} 적용`}
                    </p>
                  </div>
                </div>

                <div
                  className="flex items-center gap-2.5 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-400">
                      GPS
                    </span>
                    <button
                      type="button"
                      disabled={!canEdit || saving}
                      onClick={() => handleQuickToggleGps(wp)}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                        wp.gps_enabled ? "bg-[#00c458]" : "bg-slate-200"
                      }`}
                      title="GPS 인증 켜기/끄기"
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${
                          wp.gps_enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {canEdit && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenWpMenuId((p) => (p === wp.id ? null : wp.id))
                        }
                        className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 font-bold text-xs"
                      >
                        ⋯
                      </button>

                      {openWpMenuId === wp.id && (
                        <div className="absolute right-0 mt-1 w-40 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-30 text-xs">
                          <button
                            type="button"
                            onClick={() => openEditWpModal(wp)}
                            className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            근무지 설정
                          </button>
                          {!wp.is_primary && (
                            <button
                              type="button"
                              onClick={() => handleSetPrimaryWp(wp.id)}
                              className="w-full px-3.5 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              기본 근무지로 지정
                            </button>
                          )}
                          {!wp.is_primary && (
                            <>
                              <div className="my-1 border-t border-slate-100" />
                              <button
                                type="button"
                                onClick={() => handleDeleteWp(wp)}
                                className="w-full px-3.5 py-1.5 text-left font-semibold text-rose-500 hover:bg-rose-50"
                              >
                                삭제하기
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* =============================================================== */}
        {/* 섹션 2: 출퇴근 허용 IP (사내 Wi-Fi 네트워크)                     */}
        {/* =============================================================== */}
        <section className="space-y-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-extrabold text-slate-900">
                출퇴근 허용 IP (Wi-Fi 네트워크)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                사내 유·무선 공유기의 공인 IP를 등록해 두면 근무 정책에서 네트워크 제한 시 기준 IP로 활용됩니다.
              </p>
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={openCreateIpModal}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 shadow-2xs flex items-center gap-1.5"
              >
                <span className="text-[#00c458] font-extrabold text-sm leading-none">
                  +
                </span>
                <span>IP 추가</span>
              </button>
            )}
          </div>

          {workplaceIps.length === 0 ? (
            <div className="p-8 rounded-2xl border border-dashed border-slate-200 bg-[#fafafa] text-center space-y-2">
              <div className="text-xl">📶</div>
              <div className="text-xs font-bold text-slate-700">
                등록된 출퇴근 허용 IP가 없어요
              </div>
              <p className="text-[11px] text-slate-400">
                필요 시 사내 오피스 Wi-Fi의 공인 IP를 등록하여 사내 접속 출퇴근 제한에 사용할 수 있습니다.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {workplaceIps.map((ip) => (
                <div
                  key={ip.id}
                  onClick={() => openEditIpModal(ip)}
                  className="px-5 py-3.5 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-sm shrink-0">
                      📶
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-slate-900">
                          {ip.name}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-100 font-mono text-[11px] font-bold text-slate-700">
                          {ip.ip_cidr}
                        </span>
                      </div>
                      {ip.memo && (
                        <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                          {ip.memo}
                        </p>
                      )}
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={!canEdit || saving}
                      onClick={() => handleToggleIp(ip)}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                        ip.is_enabled ? "bg-[#00c458]" : "bg-slate-200"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${
                          ip.is_enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleDeleteIp(ip)}
                        className="px-2 py-1 rounded-lg hover:bg-rose-50 text-[11px] font-bold text-slate-400 hover:text-rose-500"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* =============================================================== */}
        {/* 섹션 3: 근무 정책별 위치/IP 제한 연동 요약                       */}
        {/* =============================================================== */}
        <section className="rounded-2xl bg-[#f8f9fa] border border-slate-200/70 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
                <span className="px-1.5 py-0.5 rounded bg-blue-500 text-white text-[10px]">
                  연동
                </span>
                <span>근무 정책별 근무지 밖 등록 제한 현황</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                실제 출퇴근 차단 여부는 각 근무 정책(근무 · 외근 · 원격근무 · 출장)의 &apos;근무지 밖 근무 등록 제한&apos; 설정을 따릅니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab("work-policy")}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700"
            >
              근무 정책 · 승인에서 변경 →
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {workForms.map((wf) => (
              <span
                key={wf.id}
                className="px-3 py-1.5 rounded-xl bg-white border border-slate-200/80 text-[11px] flex items-center gap-1.5"
              >
                <span>{wf.icon}</span>
                <span className="font-bold text-slate-800">{wf.name}:</span>
                <span
                  className={
                    wf.offsite_restriction === "사용 안 함"
                      ? "text-slate-400 font-semibold"
                      : "text-emerald-600 font-extrabold"
                  }
                >
                  {wf.offsite_restriction}
                </span>
              </span>
            ))}
          </div>
        </section>

        {/* 하단 이전/다음 이동 카드 (초과 근무 보상 ← / → 연차 설정) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("overtime-comp")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                초과 근무 보상
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("leave-setting")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                연차 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 모달 A: 근무지 추가 / 수정 (GPS 위경도 & 반경 구성)                */}
      {/* ================================================================= */}
      {wpDraft && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[520px] max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs">
            <div className="flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setWpDraft(null)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll pr-0.5 space-y-5">
              <div>
                <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  {isNewWp ? "근무지 추가" : "근무지 설정"}
                </h3>
                <p className="text-slate-500 mt-1">
                  근무지 주소와 출퇴근 인정 GPS 반경을 구성합니다.
                </p>
              </div>

              <div className="space-y-3.5">
                {/* 근무지 이름 */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    근무지 이름
                  </label>
                  <input
                    disabled={!canEdit}
                    value={wpDraft.name}
                    onChange={(e) =>
                      setWpDraft({ ...wpDraft, name: e.target.value })
                    }
                    placeholder="예: (주)천종현수학연구소 본사, 물류센터"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>

                {/* 회사 정보 주소 연동 옵션 */}
                <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80 cursor-pointer">
                  <div>
                    <div className="font-bold text-slate-800">
                      [회사 정보] 본사 주소와 자동 동기화
                    </div>
                    <div className="text-[11px] text-slate-400">
                      활성화 시 기본 정보 &gt; 회사 정보의 주소를 그대로 참조합니다.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={Boolean(wpDraft.sync_company_address)}
                    onChange={(e) =>
                      setWpDraft({
                        ...wpDraft,
                        sync_company_address: e.target.checked,
                        address: e.target.checked
                          ? settings.address || wpDraft.address
                          : wpDraft.address,
                      })
                    }
                    className="w-4 h-4 accent-[#00c458]"
                  />
                </label>

                {/* 도로명 주소 & 상세 주소 */}
                <div className="space-y-2">
                  <label className="block font-bold text-slate-700">
                    근무지 주소
                  </label>
                  <input
                    disabled={!canEdit || Boolean(wpDraft.sync_company_address)}
                    value={wpDraft.address}
                    onChange={(e) =>
                      setWpDraft({ ...wpDraft, address: e.target.value })
                    }
                    placeholder="도로명 또는 지번 주소 입력"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-800 disabled:text-slate-500 focus:outline-none"
                  />
                  <input
                    disabled={!canEdit}
                    value={wpDraft.detail_address || ""}
                    onChange={(e) =>
                      setWpDraft({ ...wpDraft, detail_address: e.target.value })
                    }
                    placeholder="상세 주소 / 층 · 호수 (선택)"
                    className="w-full px-3.5 py-2 rounded-xl bg-[#f5f6f8] text-slate-700 focus:outline-none"
                  />
                </div>

                {/* GPS 좌표 및 허용 반경 시각 프리뷰 */}
                <div className="p-4 rounded-2xl border border-slate-200 space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-extrabold text-slate-900 text-[13px]">
                      📍 GPS 좌표 · 허용 반경 구성
                    </div>
                    <div className="flex items-center gap-1.5">
                      {canEdit && (
                        <button
                          type="button"
                          disabled={locatingGps}
                          onClick={handleFetchBrowserGps}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-[#00a84b] font-bold text-[11px]"
                        >
                          {locatingGps ? "조회 중..." : "현재 위치 좌표 가져오기"}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={locatingGps}
                        onClick={handleTestDistance}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px]"
                      >
                        거리 테스트
                      </button>
                    </div>
                  </div>

                  {/* 미니 레이더 시각 프리뷰 */}
                  <div className="h-28 rounded-xl bg-gradient-to-br from-emerald-50/60 via-slate-50 to-sky-50/60 border border-slate-200/70 flex items-center justify-center relative overflow-hidden">
                    <div className="w-24 h-24 rounded-full border border-dashed border-emerald-400/70 bg-emerald-400/10 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
                        <span className="w-3 h-3 rounded-full bg-[#00c458] ring-4 ring-white shadow" />
                      </div>
                    </div>
                    <span className="absolute bottom-2 right-3 px-2 py-0.5 rounded-md bg-white/90 border border-slate-200 text-[10px] font-bold text-slate-600">
                      반경 {formatRadius(wpDraft.radius_meters)} 인정 구역
                    </span>
                  </div>

                  {distanceTestResult && (
                    <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-semibold text-slate-700">
                      {distanceTestResult}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        위도 (Latitude)
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        disabled={!canEdit}
                        value={wpDraft.latitude}
                        onChange={(e) =>
                          setWpDraft({
                            ...wpDraft,
                            latitude: Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-[#f5f6f8] font-mono font-bold text-slate-800 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        경도 (Longitude)
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        disabled={!canEdit}
                        value={wpDraft.longitude}
                        onChange={(e) =>
                          setWpDraft({
                            ...wpDraft,
                            longitude: Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-[#f5f6f8] font-mono font-bold text-slate-800 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1.5">
                      출퇴근 허용 반경
                    </label>
                    <div className="grid grid-cols-6 gap-1.5">
                      {RADIUS_OPTIONS.map((r) => {
                        const active = wpDraft.radius_meters === r;
                        return (
                          <button
                            key={r}
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              setWpDraft({ ...wpDraft, radius_meters: r })
                            }
                            className={`py-1.5 rounded-lg border text-[11px] font-bold transition-all ${
                              active
                                ? "bg-emerald-50 border-[#00c458] text-[#00a84b]"
                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            {formatRadius(r)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* GPS 인증 활성화 스위치 + 적용 조직 */}
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  <div className="py-3.5 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-slate-800 text-[13px]">
                        GPS 위치 인증 적용
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        아직 GPS 적용 여부가 미정이면 OFF로 두고 구성만 먼저 저장해도 됩니다.
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        setWpDraft({
                          ...wpDraft,
                          gps_enabled: !wpDraft.gps_enabled,
                        })
                      }
                      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                        wpDraft.gps_enabled ? "bg-[#00c458]" : "bg-slate-200"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                          wpDraft.gps_enabled ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="py-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="font-bold text-slate-800 text-[13px]">
                        적용 대상 범위
                      </div>
                      <select
                        disabled={!canEdit}
                        value={wpDraft.apply_scope}
                        onChange={(e) =>
                          setWpDraft({
                            ...wpDraft,
                            apply_scope: e.target.value as "ALL" | "DEPARTMENT",
                          })
                        }
                        className="px-3 py-2 rounded-xl bg-[#f5f6f8] font-bold text-slate-800 focus:outline-none"
                      >
                        <option value="ALL">전사 구성원 적용</option>
                        <option value="DEPARTMENT">특정 조직만 적용</option>
                      </select>
                    </div>

                    {wpDraft.apply_scope === "DEPARTMENT" && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {orgDepts.map((dept) => {
                          const checked = (
                            wpDraft.applied_departments || []
                          ).includes(dept);
                          return (
                            <button
                              key={dept}
                              type="button"
                              disabled={!canEdit}
                              onClick={() => {
                                const prev = wpDraft.applied_departments || [];
                                const next = checked
                                  ? prev.filter((d) => d !== dept)
                                  : [...prev, dept];
                                setWpDraft({
                                  ...wpDraft,
                                  applied_departments: next,
                                });
                              }}
                              className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                                checked
                                  ? "bg-emerald-50 border-[#00c458] text-[#00a84b]"
                                  : "bg-slate-50 border-slate-200 text-slate-500"
                              }`}
                            >
                              {dept}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {canEdit && (
              <div className="pt-5 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveWorkplace}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:opacity-95 text-white text-xs font-extrabold shadow-md transition-opacity"
                >
                  {saving ? "저장 중..." : "저장하기"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 모달 B: 출퇴근 허용 IP 추가 / 수정                                 */}
      {/* ================================================================= */}
      {ipDraft && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[440px] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden p-7 text-xs space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-900">
                {isNewIp ? "출퇴근 허용 IP 추가" : "출퇴근 허용 IP 수정"}
              </h3>
              <button
                type="button"
                onClick={() => setIpDraft(null)}
                className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  네트워크 이름
                </label>
                <input
                  autoFocus
                  disabled={!canEdit}
                  value={ipDraft.name}
                  onChange={(e) =>
                    setIpDraft({ ...ipDraft, name: e.target.value })
                  }
                  placeholder="예: 본사 연구소 Wi-Fi"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-semibold text-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  공인 IPv4 주소 또는 대역(CIDR)
                </label>
                <input
                  disabled={!canEdit}
                  value={ipDraft.ip_cidr}
                  onChange={(e) =>
                    setIpDraft({ ...ipDraft, ip_cidr: e.target.value })
                  }
                  placeholder="예: 211.234.56.78 또는 211.234.56.0/24"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] font-mono font-bold text-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  비고 (선택)
                </label>
                <input
                  disabled={!canEdit}
                  value={ipDraft.memo || ""}
                  onChange={(e) =>
                    setIpDraft({ ...ipDraft, memo: e.target.value })
                  }
                  placeholder="예: KT 기업회선 고정 IP"
                  className="w-full px-3.5 py-2 rounded-xl bg-[#f5f6f8] text-slate-700 focus:outline-none"
                />
              </div>
            </div>

            {canEdit && (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveIp}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c73c] to-[#00b894] hover:opacity-95 text-white text-xs font-extrabold shadow-md"
              >
                {saving ? "저장 중..." : "저장하기"}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
