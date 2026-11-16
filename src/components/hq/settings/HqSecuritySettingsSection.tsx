// src/components/hq/settings/HqSecuritySettingsSection.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { hqFetch } from "@/lib/hq/clientApi";
import {
  AUDIT_INFO_TYPE_GROUPS,
  DEFAULT_SECURITY_SETTINGS,
  IP_RESTRICTION_SCOPE_OPTIONS,
  LOGIN_ATTEMPT_OPTIONS,
  MOBILE_AUTO_LOGOUT_OPTIONS,
  PASSKEY_LIMIT_OPTIONS,
  PC_AUTO_LOGOUT_OPTIONS,
} from "@/lib/hq/defaultSecuritySettings";
import type {
  HqAllowedIpEntry,
  HqAuditActivityType,
  HqAuditEventType,
  HqAuditLogItem,
  HqCompanyExtraSettings,
  HqCompanySettings,
  HqMember,
  HqSecuritySettings,
  HqTempAuthCodeEntry,
} from "@/lib/hq/types";
import type { HqSettingsTab } from "./HqSettingsModal";

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function shortAvatarText(name: string): string {
  const clean = name.trim();
  if (clean.length >= 2) return clean.slice(-2);
  return clean || "HQ";
}

const AVATAR_PALETTE = [
  "#38bdf8",
  "#4ade80",
  "#fb923c",
  "#f87171",
  "#2dd4bf",
  "#a78bfa",
  "#facc15",
  "#818cf8",
];

function formatAuditKoreanDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const hr24 = d.getHours();
  const ampm = hr24 < 12 ? "오전" : "오후";
  const hr12 = hr24 % 12 === 0 ? 12 : hr24 % 12;
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}. ${mm}. ${dd} ${ampm} ${hr12}:${min}:${sec}`;
}

interface SecuritySectionProps {
  settings: HqCompanySettings;
  members: HqMember[];
  canEdit: boolean;
  saving: boolean;
  onSaveExtra: (
    nextExtra: Partial<HqCompanyExtraSettings>,
    toastMessage: string
  ) => Promise<void>;
  onNavigateTab: (tab: HqSettingsTab) => void;
}

function useMergedSecurity(settings: HqCompanySettings): HqSecuritySettings {
  const raw = settings.extra_settings?.security_settings;
  return useMemo(
    () => ({
      ...DEFAULT_SECURITY_SETTINGS,
      ...(raw || {}),
      two_factor_exempt_ips: Array.isArray(raw?.two_factor_exempt_ips)
        ? raw!.two_factor_exempt_ips
        : [],
      otp_reset_logs: Array.isArray(raw?.otp_reset_logs)
        ? raw!.otp_reset_logs
        : [],
      allowed_ips: Array.isArray(raw?.allowed_ips) ? raw!.allowed_ips : [],
      temp_auth_codes: Array.isArray(raw?.temp_auth_codes)
        ? raw!.temp_auth_codes
        : [],
    }),
    [raw]
  );
}

/* ========================================================================= */
/* 1. 설정 > 결제·보안 > 보안 · 인증 설정 (스크린샷 181845 동일)             */
/* ========================================================================= */
export function HqSecurityAuthSection({
  settings,
  members,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: SecuritySectionProps) {
  const sec = useMergedSecurity(settings);

  const [myIp, setMyIp] = useState<string>("");
  const [ipModalKind, setIpModalKind] = useState<null | "2FA_EXEMPT" | "ALLOW">(
    null
  );
  const [ipLabelInput, setIpLabelInput] = useState("");
  const [ipValueInput, setIpValueInput] = useState("");
  const [enableIpAfterSave, setEnableIpAfterSave] = useState(false);

  // 구성원 OTP 재설정 드롭다운
  const [otpPickerOpen, setOtpPickerOpen] = useState(false);
  const [otpSearch, setOtpSearch] = useState("");
  const [selectedOtpMemberId, setSelectedOtpMemberId] = useState<string>("");

  // 기능 제한 범위 드롭다운
  const [scopeDropdownOpen, setScopeDropdownOpen] = useState(false);

  useEffect(() => {
    hqFetch<{ success: boolean; data: { ip: string } }>(
      "/api/hq/audit-logs?mode=my-ip"
    )
      .then((res) => {
        if (res.data?.ip) setMyIp(res.data.ip);
      })
      .catch(() => {});
  }, []);

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status !== "퇴직"),
    [members]
  );

  const patchSecurity = async (
    partial: Partial<HqSecuritySettings>,
    toast: string
  ) => {
    await onSaveExtra(
      {
        security_settings: {
          ...sec,
          ...partial,
        },
      },
      toast
    );
  };

  const renderSwitch = (
    checked: boolean,
    onToggle: () => void,
    disabled = false
  ) => (
    <button
      type="button"
      disabled={!canEdit || disabled || saving}
      onClick={onToggle}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
        checked ? "bg-[#00c458]" : "bg-slate-200"
      } ${!canEdit || disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`w-4 h-4 rounded-full bg-white shadow-xs absolute top-1 transition-all ${
          checked ? "left-6" : "left-1"
        }`}
      />
    </button>
  );

  const handleToggleIpRestriction = () => {
    if (!sec.ip_restriction_enabled && sec.allowed_ips.length === 0) {
      setIpLabelInput("본사 현재 접속 네트워크");
      setIpValueInput(myIp || "");
      setEnableIpAfterSave(true);
      setIpModalKind("ALLOW");
      return;
    }
    patchSecurity(
      { ip_restriction_enabled: !sec.ip_restriction_enabled },
      !sec.ip_restriction_enabled
        ? "특정 IP 접근 제한이 활성화되었습니다."
        : "특정 IP 접근 제한이 해제되었습니다."
    );
  };

  const handleAddIpEntry = async () => {
    const cleanIp = ipValueInput.trim();
    if (!cleanIp) {
      alert("IP 주소 또는 CIDR 대역(예: 58.149.52.180)을 입력해주세요.");
      return;
    }
    const newEntry: HqAllowedIpEntry = {
      id: `ip-${uid()}`,
      label: ipLabelInput.trim() || "지정 네트워크",
      ip_or_cidr: cleanIp,
      created_at: new Date().toISOString(),
    };

    if (ipModalKind === "2FA_EXEMPT") {
      await patchSecurity(
        {
          two_factor_exempt_ips: [...sec.two_factor_exempt_ips, newEntry],
        },
        `'${newEntry.ip_or_cidr}' 주소가 2단계 인증 제외 IP로 등록되었습니다.`
      );
    } else if (ipModalKind === "ALLOW") {
      const nextList = [...sec.allowed_ips, newEntry];
      await patchSecurity(
        {
          allowed_ips: nextList,
          ip_restriction_enabled: enableIpAfterSave
            ? true
            : sec.ip_restriction_enabled,
        },
        enableIpAfterSave
          ? `'${newEntry.ip_or_cidr}' 등록과 함께 IP 접근 제한이 활성화되었습니다.`
          : `'${newEntry.ip_or_cidr}' 주소가 접근 허용 IP에 추가되었습니다.`
      );
      setEnableIpAfterSave(false);
    }
    setIpLabelInput("");
    setIpValueInput("");
  };

  const handleDeleteIpEntry = async (id: string) => {
    if (ipModalKind === "2FA_EXEMPT") {
      await patchSecurity(
        {
          two_factor_exempt_ips: sec.two_factor_exempt_ips.filter(
            (x) => x.id !== id
          ),
        },
        "2단계 인증 제외 IP가 삭제되었습니다."
      );
    } else if (ipModalKind === "ALLOW") {
      const nextList = sec.allowed_ips.filter((x) => x.id !== id);
      await patchSecurity(
        {
          allowed_ips: nextList,
          ip_restriction_enabled:
            nextList.length === 0 ? false : sec.ip_restriction_enabled,
        },
        nextList.length === 0
          ? "허용 IP가 모두 제거되어 IP 접근 제한이 자동 해제되었습니다."
          : "접근 허용 IP가 삭제되었습니다."
      );
    }
  };

  const handleResetMemberOtp = async () => {
    const found = activeMembers.find(
      (m) => m.instructor_id === selectedOtpMemberId
    );
    if (!found) {
      alert("OTP를 재설정할 구성원을 선택해주세요.");
      return;
    }
    await patchSecurity(
      {
        otp_reset_logs: [
          {
            id: `otp-${uid()}`,
            member_name: found.name,
            reset_by: "관리자",
            reset_at: new Date().toISOString(),
          },
          ...sec.otp_reset_logs,
        ].slice(0, 30),
      },
      `${found.name} 님의 2단계 인증(OTP) 등록 정보가 초기화되었습니다.`
    );
    hqFetch("/api/hq/audit-logs", {
      method: "POST",
      body: {
        activity_type: "인증",
        event_type: "수정",
        info_type: "인사정보",
        description: `${found.name} 구성원 2단계 인증 OTP 재설정`,
      },
    }).catch(() => {});
    setOtpPickerOpen(false);
    setSelectedOtpMemberId("");
  };

  const currentModalIps =
    ipModalKind === "2FA_EXEMPT" ? sec.two_factor_exempt_ips : sec.allowed_ips;

  return (
    <>
      <div
        onClick={() => {
          if (otpPickerOpen) setOtpPickerOpen(false);
          if (scopeDropdownOpen) setScopeDropdownOpen(false);
        }}
        className="space-y-10"
      >
        {/* 타이틀 */}
        <div>
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            보안 · 인증
          </h2>
        </div>

        {/* =============================================================== */}
        {/* 1) 2단계 인증 섹션 (181845 상단)                                */}
        {/* =============================================================== */}
        <section className="space-y-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[15px] font-extrabold text-slate-900">
                2단계 인증
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                로그인 시 OTP 인증 코드 입력 단계가 추가돼요.
              </p>
            </div>
            {renderSwitch(sec.two_factor_enabled, () =>
              patchSecurity(
                { two_factor_enabled: !sec.two_factor_enabled },
                !sec.two_factor_enabled
                  ? "2단계 인증 정책이 활성화되었습니다."
                  : "2단계 인증 정책이 해제되었습니다."
              )
            )}
          </div>

          <div className="space-y-2.5">
            {/* 카드 1: 2단계 인증 제외 IP */}
            <div
              onClick={() => {
                if (!sec.two_factor_enabled) return;
                setEnableIpAfterSave(false);
                setIpLabelInput("");
                setIpValueInput("");
                setIpModalKind("2FA_EXEMPT");
              }}
              className={`px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-3 transition-colors ${
                sec.two_factor_enabled
                  ? "hover:border-slate-300 cursor-pointer shadow-2xs"
                  : "opacity-50 cursor-not-allowed"
              }`}
            >
              <div className="flex items-center gap-3.5">
                <span className="w-8 h-8 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center text-sm shrink-0">
                  🔓
                </span>
                <div>
                  <div className="text-[13px] font-bold text-slate-800">
                    2단계 인증 제외 IP
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    특정 IP만 인증을 제외할 수 있어요.
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold text-slate-400 flex items-center gap-1 shrink-0">
                <span>
                  {sec.two_factor_exempt_ips.length > 0
                    ? `${sec.two_factor_exempt_ips.length}개`
                    : "없음"}
                </span>
                <span>›</span>
              </span>
            </div>

            {/* 카드 2: 구성원 OTP 재설정 */}
            <div
              onClick={(e) => e.stopPropagation()}
              className={`px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-3 relative ${
                sec.two_factor_enabled ? "shadow-2xs" : "opacity-50"
              }`}
            >
              <div className="flex items-center gap-3.5">
                <span className="w-8 h-8 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center text-sm shrink-0">
                  📱
                </span>
                <div>
                  <div className="text-[13px] font-bold text-slate-800">
                    구성원 OTP 재설정
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    기기를 변경하거나 분실한 경우 특정 구성원의 OTP를 재설정할 수 있어요.
                  </p>
                </div>
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  disabled={!sec.two_factor_enabled || !canEdit}
                  onClick={() => setOtpPickerOpen((p) => !p)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 disabled:cursor-not-allowed"
                >
                  <span>구성원 선택</span>
                  <span className="text-[10px]">⌄</span>
                </button>

                {otpPickerOpen && (
                  <div className="absolute right-0 top-full mt-2 w-[260px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-2.5 z-40 text-xs">
                    <input
                      value={otpSearch}
                      onChange={(e) => setOtpSearch(e.target.value)}
                      placeholder="🔍 검색"
                      className="w-full px-3 py-2 rounded-lg border border-[#00c458] focus:outline-none text-xs font-medium mb-2"
                    />
                    <div className="text-[10px] font-bold text-slate-400 px-1.5 mb-1">
                      구성원 목록
                    </div>
                    <div className="max-h-[210px] overflow-y-auto custom-scroll space-y-0.5">
                      {activeMembers
                        .filter(
                          (m) =>
                            !otpSearch.trim() ||
                            m.name.includes(otpSearch.trim()) ||
                            m.department.includes(otpSearch.trim())
                        )
                        .map((m, idx) => {
                          const selected =
                            selectedOtpMemberId === m.instructor_id;
                          return (
                            <button
                              key={m.instructor_id}
                              type="button"
                              onClick={() =>
                                setSelectedOtpMemberId(m.instructor_id)
                              }
                              className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between text-left ${
                                selected ? "bg-emerald-50" : "hover:bg-slate-50"
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span
                                  style={{
                                    backgroundColor:
                                      AVATAR_PALETTE[
                                        idx % AVATAR_PALETTE.length
                                      ],
                                  }}
                                  className="w-6 h-6 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center shrink-0"
                                >
                                  {shortAvatarText(m.name)}
                                </span>
                                <span className="font-bold text-slate-800">
                                  {m.name}
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {m.department}
                                </span>
                              </span>
                              {selected && (
                                <span className="text-[#00c458] font-bold">
                                  ✓
                                </span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                    <button
                      type="button"
                      disabled={!selectedOtpMemberId || saving}
                      onClick={handleResetMemberOtp}
                      className="w-full mt-2 py-2.5 rounded-lg bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold disabled:opacity-50"
                    >
                      선택 구성원 OTP 재설정하기
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* =============================================================== */}
        {/* 2) 특정 IP에서만 접근 허용 섹션 (181845 하단 — 실제 API 연동)   */}
        {/* =============================================================== */}
        <section className="space-y-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[15px] font-extrabold text-slate-900">
                특정 IP에서만 접근 허용
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                특정 IP 주소에서만 HQ 워크스페이스를 사용할 수 있도록 설정해요.
                {myIp && (
                  <span className="ml-1.5 text-slate-500 font-semibold">
                    (내 현재 접속 IP: {myIp})
                  </span>
                )}
              </p>
            </div>
            {renderSwitch(
              sec.ip_restriction_enabled,
              handleToggleIpRestriction
            )}
          </div>

          <div className="space-y-2.5">
            {/* 카드 1: 접근 허용 IP */}
            <div
              onClick={() => {
                setEnableIpAfterSave(false);
                setIpLabelInput("");
                setIpValueInput("");
                setIpModalKind("ALLOW");
              }}
              className={`px-5 py-4 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 flex items-center justify-between gap-3 cursor-pointer shadow-2xs transition-colors ${
                !sec.ip_restriction_enabled && sec.allowed_ips.length === 0
                  ? "opacity-75"
                  : ""
              }`}
            >
              <div className="flex items-center gap-3.5">
                <span className="w-8 h-8 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center text-sm shrink-0">
                  ✅
                </span>
                <div>
                  <div className="text-[13px] font-bold text-slate-800">
                    접근 허용 IP
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    설정한 IP에서만 HQ에 접근할 수 있어요.
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1 shrink-0">
                <span>
                  {sec.allowed_ips.length > 0
                    ? `${sec.allowed_ips.length}개`
                    : "없음"}
                </span>
                <span>›</span>
              </span>
            </div>

            {/* 카드 2: 기능 제한 범위 설정 */}
            <div
              onClick={(e) => e.stopPropagation()}
              className={`px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-3 relative ${
                sec.ip_restriction_enabled ? "shadow-2xs" : "opacity-55"
              }`}
            >
              <div className="flex items-center gap-3.5">
                <span className="w-8 h-8 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center text-sm shrink-0">
                  🛡️
                </span>
                <div>
                  <div className="text-[13px] font-bold text-slate-800">
                    기능 제한 범위 설정
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    허용하지 않은 IP에서 접근 시 HQ 사용 범위를 설정해요.
                  </p>
                </div>
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  disabled={!sec.ip_restriction_enabled || !canEdit}
                  onClick={() => setScopeDropdownOpen((p) => !p)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 disabled:cursor-not-allowed"
                >
                  <span>{sec.ip_restriction_scope}</span>
                  <span className="text-[10px]">⌄</span>
                </button>

                {scopeDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-[230px] bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 z-40 text-xs">
                    {IP_RESTRICTION_SCOPE_OPTIONS.map((opt) => {
                      const selected = sec.ip_restriction_scope === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            setScopeDropdownOpen(false);
                            patchSecurity(
                              { ip_restriction_scope: opt },
                              `기능 제한 범위가 '${opt}'(으)로 변경되었습니다.`
                            );
                          }}
                          className={`w-full px-3.5 py-2 text-left flex items-center gap-2 ${
                            selected
                              ? "bg-slate-100 font-bold text-slate-900"
                              : "hover:bg-slate-50 text-slate-700"
                          }`}
                        >
                          <span className="w-4 text-[#00c458] font-bold">
                            {selected ? "✓" : ""}
                          </span>
                          <span>{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 카드 3: 최고 관리자 적용 */}
            <div
              className={`px-5 py-4 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-3 ${
                sec.ip_restriction_enabled ? "shadow-2xs" : "opacity-55"
              }`}
            >
              <div className="flex items-center gap-3.5">
                <span className="w-8 h-8 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center text-sm shrink-0">
                  👑
                </span>
                <div>
                  <div className="text-[13px] font-bold text-slate-800">
                    최고 관리자 적용
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    최고 관리자도 설정된 IP에서만 HQ에 접근할 수 있도록 해요.
                  </p>
                </div>
              </div>
              {renderSwitch(
                sec.ip_restrict_super_admin,
                () =>
                  patchSecurity(
                    {
                      ip_restrict_super_admin: !sec.ip_restrict_super_admin,
                    },
                    !sec.ip_restrict_super_admin
                      ? "최고 관리자에게도 IP 접근 제한이 적용됩니다."
                      : "최고 관리자는 IP 제한 대상에서 제외됩니다."
                  ),
                !sec.ip_restriction_enabled
              )}
            </div>
          </div>
        </section>

        {/* 하단 이전/다음 카드 (← 퇴직자 문서 발급 설정 / 로그인 설정 →) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("retiree-doc")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                퇴직자 문서 발급 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("login-setting")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                로그인 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">다음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* IP 등록·관리 모달 */}
      {ipModalKind && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[480px] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                {ipModalKind === "2FA_EXEMPT"
                  ? "2단계 인증 제외 IP 관리"
                  : "접근 허용 IP 관리"}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIpModalKind(null);
                  setEnableIpAfterSave(false);
                }}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {myIp && (
                <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-600">
                    현재 내 접속 IP:{" "}
                    <b className="font-mono text-slate-900">{myIp}</b>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIpValueInput(myIp);
                      if (!ipLabelInput) setIpLabelInput("본사 사무실 네트워크");
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-[11px] font-bold text-slate-700"
                  >
                    내 IP 자동 입력
                  </button>
                </div>
              )}

              {canEdit && (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-5 gap-2">
                    <input
                      value={ipLabelInput}
                      onChange={(e) => setIpLabelInput(e.target.value)}
                      placeholder="별칭 (예: 본사 4층)"
                      className="col-span-2 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-medium focus:outline-none"
                    />
                    <input
                      value={ipValueInput}
                      onChange={(e) => setIpValueInput(e.target.value)}
                      placeholder="예: 58.149.52.180 또는 /24"
                      className="col-span-3 px-3 py-2.5 rounded-xl bg-[#f5f6f8] font-mono focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleAddIpEntry}
                    className="w-full py-2.5 rounded-xl bg-[#00c458] hover:bg-[#00b04f] text-white font-extrabold"
                  >
                    + IP 주소 추가하기
                  </button>
                </div>
              )}

              <div className="border-t border-slate-100 pt-3">
                <div className="text-[11px] font-bold text-slate-500 mb-2">
                  등록된 IP 목록 ({currentModalIps.length}건)
                </div>
                {currentModalIps.length === 0 ? (
                  <div className="py-6 text-center text-slate-400">
                    등록된 IP 주소가 없습니다.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto custom-scroll">
                    {currentModalIps.map((item) => (
                      <div
                        key={item.id}
                        className="px-3.5 py-2.5 rounded-xl border border-slate-200 flex items-center justify-between"
                      >
                        <div>
                          <span className="font-bold text-slate-800">
                            {item.label}
                          </span>
                          <span className="ml-2 font-mono text-slate-500">
                            {item.ip_or_cidr}
                          </span>
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => handleDeleteIpEntry(item.id)}
                            className="text-[11px] font-bold text-slate-400 hover:text-rose-500"
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ========================================================================= */
/* 2. 설정 > 결제·보안 > 로그인 설정 Beta (스크린샷 181906 ~ 181944 동일)   */
/* ========================================================================= */
export function HqLoginSettingsSection({
  settings,
  members,
  canEdit,
  saving,
  onSaveExtra,
  onNavigateTab,
}: SecuritySectionProps) {
  const sec = useMergedSecurity(settings);

  const [openMenu, setOpenMenu] = useState<
    null | "PASSKEY" | "ATTEMPT" | "PC_LOGOUT" | "MOBILE_LOGOUT" | "TEMP_CODE"
  >(null);
  const [guideOpen, setGuideOpen] = useState(false);

  // 잠긴 계정 목록
  const [lockedAccounts, setLockedAccounts] = useState<
    { identifier: string; fail_count: number; locked_until: string | null }[]
  >([]);

  // 임시 이메일 인증번호 발급 상태 (181944 동일)
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedTempMemberId, setSelectedTempMemberId] = useState<string>("");
  const [issuedCodeModal, setIssuedCodeModal] =
    useState<HqTempAuthCodeEntry | null>(null);
  const [copiedTempCode, setCopiedTempCode] = useState(false);

  const loadLockedAccounts = useCallback(() => {
    hqFetch<{
      success: boolean;
      data: {
        lockedAccounts: {
          identifier: string;
          fail_count: number;
          locked_until: string | null;
        }[];
      };
    }>("/api/hq/audit-logs")
      .then((res) => {
        if (Array.isArray(res.data?.lockedAccounts)) {
          setLockedAccounts(res.data.lockedAccounts);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadLockedAccounts();
  }, [loadLockedAccounts]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status !== "퇴직"),
    [members]
  );

  const patchSecurity = async (
    partial: Partial<HqSecuritySettings>,
    toast: string
  ) => {
    await onSaveExtra(
      {
        security_settings: {
          ...sec,
          ...partial,
        },
      },
      toast
    );
  };

  const renderSwitch = (
    checked: boolean,
    onToggle: () => void,
    disabled = false
  ) => (
    <button
      type="button"
      disabled={!canEdit || disabled || saving}
      onClick={onToggle}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
        checked ? "bg-[#00c458]" : "bg-slate-200"
      } ${!canEdit || disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`w-4 h-4 rounded-full bg-white shadow-xs absolute top-1 transition-all ${
          checked ? "left-6" : "left-1"
        }`}
      />
    </button>
  );

  const renderSelectBox = (
    menuKey: "PASSKEY" | "ATTEMPT" | "PC_LOGOUT" | "MOBILE_LOGOUT",
    currentValue: string,
    options: readonly string[],
    onPick: (val: string) => void
  ) => {
    const isOpen = openMenu === menuKey;
    return (
      <div
        className="relative w-[200px] shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setOpenMenu(isOpen ? null : menuKey)}
          className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f6f8] hover:bg-slate-200/60 text-xs font-semibold text-slate-800 flex items-center justify-between transition-colors disabled:opacity-60"
        >
          <span>{currentValue}</span>
          <span className="text-slate-400 text-[10px]">▾</span>
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-1.5 w-full bg-white rounded-2xl shadow-2xl border border-slate-200 py-1.5 z-40 text-xs">
            {options.map((opt) => {
              const selected = currentValue === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    onPick(opt);
                  }}
                  className={`w-full px-3.5 py-2 text-left flex items-center gap-2 transition-colors ${
                    selected
                      ? "bg-slate-100/90 font-bold text-slate-900"
                      : "hover:bg-slate-50 text-slate-700 font-medium"
                  }`}
                >
                  <span className="w-4 text-[#00c458] font-bold">
                    {selected ? "✓" : ""}
                  </span>
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const handleIssueTempCode = async () => {
    const target = activeMembers.find(
      (m) => m.instructor_id === selectedTempMemberId
    );
    if (!target) {
      alert("임시 인증번호를 발급할 구성원을 선택해주세요.");
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const now = Date.now();
    const entry: HqTempAuthCodeEntry = {
      id: `tmp-${uid()}`,
      member_id: target.instructor_id,
      member_name: target.name,
      department: target.department,
      code,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
      issued_by: "관리자",
    };

    await patchSecurity(
      {
        temp_auth_codes: [entry, ...sec.temp_auth_codes].slice(0, 30),
      },
      `${target.name} 님의 임시 인증번호가 발급되었습니다.`
    );

    hqFetch("/api/hq/audit-logs", {
      method: "POST",
      body: {
        activity_type: "인증",
        event_type: "생성",
        info_type: "개인정보",
        description: `${target.name} 구성원 임시 이메일 인증번호 발급`,
      },
    }).catch(() => {});

    setOpenMenu(null);
    setSelectedTempMemberId("");
    setCopiedTempCode(false);
    setIssuedCodeModal(entry);
  };

  const handleUnlockAccount = async (identifier: string) => {
    try {
      await hqFetch("/api/hq/auth/login-policy", {
        method: "POST",
        body: { action: "UNLOCK", identifier },
      });
      loadLockedAccounts();
    } catch (err: any) {
      alert(err?.message || "잠금 해제 실패");
    }
  };

  return (
    <>
      <div
        onClick={() => {
          if (openMenu) setOpenMenu(null);
        }}
        className="space-y-10"
      >
        {/* 상단 타이틀 + Beta 배지 (181906 동일) */}
        <div className="flex items-start gap-1.5">
          <h2 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            로그인 설정
          </h2>
          <span className="text-[11px] font-extrabold italic text-[#f06553] mt-0.5">
            Beta
          </span>
        </div>

        {/* 1) 로그인 수단 */}
        <section className="space-y-2">
          <h3 className="text-[15px] font-extrabold text-slate-900 pb-1">
            로그인 수단
          </h3>

          <div className="divide-y divide-slate-100">
            <div className="py-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold text-slate-800">
                  이메일 인증
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  이메일 계정 및 인증 코드를 통해 로그인해요.
                </p>
              </div>
              {renderSwitch(sec.allow_email_login, () => {
                if (sec.allow_email_login && !sec.allow_phone_login) {
                  alert(
                    "최소 1개 이상의 로그인 수단(이메일 또는 휴대폰)이 활성화되어야 합니다."
                  );
                  return;
                }
                patchSecurity(
                  { allow_email_login: !sec.allow_email_login },
                  !sec.allow_email_login
                    ? "이메일 로그인이 허용되었습니다."
                    : "이메일 로그인이 비활성화되었습니다."
                );
              })}
            </div>

            <div className="py-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold text-slate-800">
                  휴대폰 문자 인증
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  내 프로필에 등록된 휴대전화번호 기반으로 로그인해요.
                </p>
              </div>
              {renderSwitch(sec.allow_phone_login, () => {
                if (sec.allow_phone_login && !sec.allow_email_login) {
                  alert(
                    "최소 1개 이상의 로그인 수단(이메일 또는 휴대폰)이 활성화되어야 합니다."
                  );
                  return;
                }
                patchSecurity(
                  { allow_phone_login: !sec.allow_phone_login },
                  !sec.allow_phone_login
                    ? "휴대폰 번호 로그인이 허용되었습니다."
                    : "휴대폰 번호 로그인이 비활성화되었습니다."
                );
              })}
            </div>

            <div className="py-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold text-slate-800">
                  패스키 인증
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  모바일 또는 내 설정에서 패스키를 등록한 구성원만 사용할 수 있어요.
                </p>
              </div>
              {renderSwitch(sec.allow_passkey_login, () =>
                patchSecurity(
                  { allow_passkey_login: !sec.allow_passkey_login },
                  !sec.allow_passkey_login
                    ? "패스키 인증 옵션이 활성화되었습니다."
                    : "패스키 인증 옵션이 비활성화되었습니다."
                )
              )}
            </div>
          </div>

          <p className="text-xs text-slate-400 pt-2">
            두 개 이상의 수단이 활성화된 경우 구성원이 사용할 방식을 로그인 시점에 직접 선택해요.{" "}
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="text-blue-600 font-semibold hover:underline"
            >
              자세히 보기
            </button>
          </p>
        </section>

        {/* 2) 패스키 인증 관리 */}
        <section className="space-y-3">
          <h3 className="text-[15px] font-extrabold text-slate-900">
            패스키 인증 관리
          </h3>
          <div className="py-2 flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px] font-bold text-slate-800">
                패스키 등록 최대 한도
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                구성원 한 명당 등록할 수 있는 패스키의 최대 개수를 설정해요.
              </p>
            </div>
            {renderSelectBox(
              "PASSKEY",
              sec.passkey_max_limit,
              PASSKEY_LIMIT_OPTIONS,
              (val) =>
                patchSecurity(
                  { passkey_max_limit: val },
                  `패스키 등록 최대 한도가 '${val}'로 저장되었습니다.`
                )
            )}
          </div>
        </section>

        {/* 3) 로그인 실패시 잠금 (실제 로그인 페이지 연동) */}
        <section className="space-y-3">
          <h3 className="text-[15px] font-extrabold text-slate-900">
            로그인 실패시 잠금
          </h3>
          <div className="py-2 flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px] font-bold text-slate-800">
                로그인 시도 횟수
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                설정한 횟수 이상 로그인에 실패하면 계정이 잠겨요.
              </p>
            </div>
            {renderSelectBox(
              "ATTEMPT",
              sec.login_max_attempts,
              LOGIN_ATTEMPT_OPTIONS,
              (val) =>
                patchSecurity(
                  { login_max_attempts: val },
                  `로그인 실패 잠금 기준이 '${val}'로 변경되었습니다.`
                )
            )}
          </div>

          {lockedAccounts.length > 0 && (
            <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-200 space-y-2 text-xs">
              <div className="font-extrabold text-rose-700">
                🔒 현재 로그인 잠금 중인 계정 ({lockedAccounts.length}건)
              </div>
              {lockedAccounts.map((acc) => (
                <div
                  key={acc.identifier}
                  className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-rose-100"
                >
                  <span className="font-semibold text-slate-700">
                    {acc.identifier}{" "}
                    <span className="text-slate-400">
                      (실패 {acc.fail_count}회)
                    </span>
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleUnlockAccount(acc.identifier)}
                      className="px-2.5 py-1 rounded-md bg-rose-600 text-white text-[11px] font-bold hover:bg-rose-700"
                    >
                      잠금 해제
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 4) 자동 로그아웃 (PC / 모바일 세션 쿠키 실제 연동) */}
        <section className="space-y-2">
          <h3 className="text-[15px] font-extrabold text-slate-900 pb-1">
            자동 로그아웃
          </h3>

          <div className="divide-y divide-slate-100">
            <div className="py-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold text-slate-800">
                  PC 자동 로그아웃 주기
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  PC 사용 환경의 편의성을 고려하여 설정해 주세요.
                </p>
              </div>
              {renderSelectBox(
                "PC_LOGOUT",
                sec.pc_auto_logout,
                PC_AUTO_LOGOUT_OPTIONS,
                (val) =>
                  patchSecurity(
                    { pc_auto_logout: val },
                    `PC 자동 로그아웃 주기가 '${val}'로 설정되었습니다.`
                  )
              )}
            </div>

            <div className="py-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold text-slate-800">
                  모바일 자동 로그아웃 주기
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  모바일 사용 환경의 편의성을 고려하여 설정해 주세요.
                </p>
              </div>
              {renderSelectBox(
                "MOBILE_LOGOUT",
                sec.mobile_auto_logout,
                MOBILE_AUTO_LOGOUT_OPTIONS,
                (val) =>
                  patchSecurity(
                    { mobile_auto_logout: val },
                    `모바일 자동 로그아웃 주기가 '${val}'로 설정되었습니다.`
                  )
              )}
            </div>
          </div>
        </section>

        {/* 5) 구성원 로그인 관리 (휴직자 허용 실제 연동 + 임시 이메일 인증번호 발급) */}
        <section className="space-y-2">
          <h3 className="text-[15px] font-extrabold text-slate-900 pb-1">
            구성원 로그인 관리
          </h3>

          <div className="divide-y divide-slate-100">
            <div className="py-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold text-slate-800">
                  휴직자 로그인 허용
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  휴직 기간 동안 휴직자가 HQ에 접근할 수 있는지 여부를 결정해요.
                </p>
              </div>
              {renderSwitch(sec.allow_on_leave_login, () =>
                patchSecurity(
                  { allow_on_leave_login: !sec.allow_on_leave_login },
                  !sec.allow_on_leave_login
                    ? "휴직 중인 구성원의 로그인이 허용되었습니다."
                    : "휴직 중인 구성원의 로그인이 제한되었습니다."
                )
              )}
            </div>

            <div
              onClick={(e) => e.stopPropagation()}
              className="py-4 flex items-center justify-between gap-4 relative"
            >
              <div>
                <div className="text-[13px] font-bold text-slate-800">
                  임시 이메일 인증번호 발급
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  이메일로 인증번호를 받기 어려운 구성원에게 임시 이메일 인증번호를 발급해요.
                </p>
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() =>
                    setOpenMenu(openMenu === "TEMP_CODE" ? null : "TEMP_CODE")
                  }
                  className="text-xs font-bold text-slate-700 hover:text-slate-900 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <span>구성원 선택</span>
                  <span className="text-[10px] text-slate-400">⌄</span>
                </button>

                {/* 스크린샷 181944 동일 플로팅 팝오버 */}
                {openMenu === "TEMP_CODE" && (
                  <div className="absolute right-0 bottom-full mb-2 w-[270px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-2.5 z-40 text-xs">
                    <div className="px-2.5 py-1.5 rounded-lg border border-[#00c458] flex items-center gap-1.5 mb-2">
                      <span className="text-slate-400 text-[11px]">🔍</span>
                      <input
                        autoFocus
                        value={memberQuery}
                        onChange={(e) => setMemberQuery(e.target.value)}
                        placeholder="검색"
                        className="w-full focus:outline-none text-xs"
                      />
                    </div>

                    <div className="text-[10px] font-bold text-slate-400 px-1.5 mb-1">
                      구성원 목록
                    </div>

                    <div className="max-h-[260px] overflow-y-auto custom-scroll space-y-0.5">
                      {activeMembers
                        .filter(
                          (m) =>
                            !memberQuery.trim() ||
                            m.name.includes(memberQuery.trim()) ||
                            m.department.includes(memberQuery.trim())
                        )
                        .map((m, idx) => {
                          const selected =
                            selectedTempMemberId === m.instructor_id;
                          return (
                            <button
                              key={m.instructor_id}
                              type="button"
                              onClick={() =>
                                setSelectedTempMemberId(m.instructor_id)
                              }
                              className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between text-left transition-colors ${
                                selected ? "bg-emerald-50" : "hover:bg-slate-50"
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span
                                  style={{
                                    backgroundColor:
                                      AVATAR_PALETTE[
                                        idx % AVATAR_PALETTE.length
                                      ],
                                  }}
                                  className="w-6 h-6 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center shrink-0"
                                >
                                  {shortAvatarText(m.name)}
                                </span>
                                <span className="font-bold text-slate-800">
                                  {m.name}
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {m.department}
                                </span>
                              </span>
                              {selected && (
                                <span className="text-[#00c458] font-bold">
                                  ✓
                                </span>
                              )}
                            </button>
                          );
                        })}
                    </div>

                    <button
                      type="button"
                      disabled={!selectedTempMemberId || saving}
                      onClick={handleIssueTempCode}
                      className="w-full mt-2.5 py-2.5 rounded-xl bg-[#5cd679] hover:bg-[#00c458] text-white font-extrabold transition-colors disabled:opacity-50"
                    >
                      임시 이메일 인증번호 발급하기
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 하단 이전/다음 카드 (← 보안 · 인증 설정 / 회사 정보 →) */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("security-auth")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <span className="text-slate-400 text-base">←</span>
            <div className="text-right">
              <div className="text-xs font-extrabold text-slate-800">
                보안 · 인증 설정
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">이전으로</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("company")}
            className="px-5 py-4 rounded-2xl bg-[#f8f9fa] hover:bg-slate-100 border border-slate-200/60 flex items-center justify-between transition-colors text-left"
          >
            <div>
              <div className="text-xs font-extrabold text-slate-800">
                회사 정보
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">처음으로</div>
            </div>
            <span className="text-slate-400 text-base">→</span>
          </button>
        </div>
      </div>

      {/* 로그인 수단 안내 모달 */}
      {guideOpen && (
        <div className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-6 text-xs space-y-3.5">
            <div className="flex items-center justify-between">
              <h4 className="text-base font-extrabold text-slate-900">
                HQ 로그인 정책 동작 안내
              </h4>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>
            <ul className="space-y-2 text-slate-600 leading-relaxed list-disc pl-4">
              <li>
                <b>이메일 / 휴대폰 로그인</b>: 비활성화한 수단은 실제{" "}
                <code>/hq/login</code> 화면에서 즉시 차단됩니다.
              </li>
              <li>
                <b>로그인 실패 잠금</b>: 지정 횟수(3·5·10회) 연속 실패 시 계정이 15분간 자동 잠기며, 감사 로그에 기록됩니다.
              </li>
              <li>
                <b>자동 로그아웃 주기</b>: 접속 기기(PC/모바일)에 따라 세션 쿠키 및 워크스페이스 만료 주기가 자동 반영됩니다.
              </li>
              <li>
                <b>휴직자 로그인 허용</b>: OFF 시 <code>휴직</code> 상태인 구성원의 HQ 입장이 제한됩니다.
              </li>
            </ul>
            <button
              type="button"
              onClick={() => setGuideOpen(false)}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-extrabold"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* 발급된 임시 이메일 인증번호 확인·복사 모달 */}
      {issuedCodeModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-[80] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[400px] rounded-2xl shadow-2xl border border-slate-200 p-6 text-xs space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-base font-extrabold text-slate-900">
                🔑 임시 이메일 인증번호 발급 완료
              </h4>
              <button
                type="button"
                onClick={() => setIssuedCodeModal(null)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>
            <p className="text-slate-500 leading-relaxed">
              <b>{issuedCodeModal.member_name}</b> (
              {issuedCodeModal.department || "본부"}) 구성원에게 전달할 1회용 임시 인증번호입니다. 발급 시각으로부터{" "}
              <b>10분간</b> 유효합니다.
            </p>
            <div className="py-4 px-5 rounded-2xl bg-slate-50 border border-slate-200 text-center">
              <div className="text-2xl font-mono font-extrabold tracking-[0.25em] text-slate-900">
                {issuedCodeModal.code}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(issuedCodeModal.code);
                    setCopiedTempCode(true);
                  } catch {
                    // ignore
                  }
                }}
                className="py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 font-extrabold text-slate-700"
              >
                {copiedTempCode ? "✓ 복사됨" : "📋 인증번호 복사"}
              </button>
              <button
                type="button"
                onClick={() => setIssuedCodeModal(null)}
                className="py-2.5 rounded-xl bg-[#00c458] text-white font-extrabold"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ========================================================================= */
/* 3. 설정 > 결제·보안 > 감사 로그 Beta 모달 (스크린샷 182006 ~ 182049 동일)  */
/* ========================================================================= */
interface AuditLogModalProps {
  isOpen: boolean;
  members: HqMember[];
  onClose: () => void;
}

export function HqAuditLogModal({
  isOpen,
  members,
  onClose,
}: AuditLogModalProps) {
  const [logs, setLogs] = useState<HqAuditLogItem[]>([]);
  const [loading, setLoading] = useState(false);

  // 열린 필터 팝오버
  const [openFilter, setOpenFilter] = useState<
    null | "ACTIVITY" | "USER" | "EVENT" | "INFO" | "PERIOD" | "DELEGATED"
  >(null);

  // 6종 필터 상태
  const [selectedActivities, setSelectedActivities] = useState<
    HqAuditActivityType[]
  >([]);
  const [selectedUserNames, setSelectedUserNames] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [orgViewMode, setOrgViewMode] = useState(false);
  const [includeSubOrg, setIncludeSubOrg] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<HqAuditEventType[]>([]);
  const [selectedInfoLabels, setSelectedInfoLabels] = useState<string[]>([]);
  const [infoSearch, setInfoSearch] = useState("");
  const [periodPreset, setPeriodPreset] = useState<
    "TODAY" | "7D" | "30D" | "90D" | "ALL"
  >("7D");
  const [delegatedFilter, setDelegatedFilter] = useState<
    "ALL" | "YES" | "NO"
  >("ALL");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { logs: HqAuditLogItem[] };
      }>("/api/hq/audit-logs");
      if (Array.isArray(res.data?.logs)) {
        setLogs(res.data.logs);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    members.forEach((m) => {
      if (m.department) set.add(m.department);
    });
    return Array.from(set);
  }, [members]);

  const filteredLogs = useMemo(() => {
    const now = Date.now();
    const cutoffMs =
      periodPreset === "TODAY"
        ? now - 24 * 3600 * 1000
        : periodPreset === "7D"
          ? now - 7 * 24 * 3600 * 1000
          : periodPreset === "30D"
            ? now - 30 * 24 * 3600 * 1000
            : periodPreset === "90D"
              ? now - 90 * 24 * 3600 * 1000
              : 0;

    return logs.filter((log) => {
      if (cutoffMs > 0) {
        const t = new Date(log.created_at).getTime();
        if (!Number.isNaN(t) && t < cutoffMs) return false;
      }
      if (
        selectedActivities.length > 0 &&
        !selectedActivities.includes(log.activity_type)
      ) {
        return false;
      }
      if (
        selectedUserNames.length > 0 &&
        !selectedUserNames.includes(log.user_name)
      ) {
        return false;
      }
      if (
        selectedEvents.length > 0 &&
        !selectedEvents.includes(log.event_type)
      ) {
        return false;
      }
      if (
        selectedInfoLabels.length > 0 &&
        !selectedInfoLabels.includes(log.info_type)
      ) {
        return false;
      }
      if (delegatedFilter === "YES" && !log.delegated) return false;
      if (delegatedFilter === "NO" && log.delegated) return false;
      return true;
    });
  }, [
    logs,
    periodPreset,
    selectedActivities,
    selectedUserNames,
    selectedEvents,
    selectedInfoLabels,
    delegatedFilter,
  ]);

  if (!isOpen) return null;

  const resetFilters = () => {
    setSelectedActivities([]);
    setSelectedUserNames([]);
    setSelectedEvents([]);
    setSelectedInfoLabels([]);
    setPeriodPreset("7D");
    setDelegatedFilter("ALL");
    setOpenFilter(null);
  };

  const handleDownloadCsv = () => {
    const headers = [
      "활동 유형",
      "사용자",
      "이메일",
      "이벤트",
      "정보 유형",
      "상세설명·사유",
      "권한위임",
      "날짜",
      "접속 정보(IP)",
    ];
    const rows = filteredLogs.map((l) => [
      l.activity_type,
      l.user_name,
      l.user_email,
      l.event_type,
      l.info_type,
      l.description,
      l.delegated ? "해당" : "해당안함",
      formatAuditKoreanDate(l.created_at),
      l.ip_address,
    ]);
    const csvContent =
      "\uFEFF" +
      [headers, ...rows]
        .map((r) =>
          r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
        )
        .join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `HQ_감사로그_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    hqFetch("/api/hq/audit-logs", {
      method: "POST",
      body: {
        activity_type: "개인정보 접근",
        event_type: "다운로드",
        info_type: "인사정보",
        description: `감사 로그 필터 적용 내역 다운로드 (${filteredLogs.length}건)`,
      },
    })
      .then(() => fetchLogs())
      .catch(() => {});
  };

  const toggleArr = <T,>(arr: T[], item: T): T[] =>
    arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];

  const periodLabelMap = {
    TODAY: "기간 오늘",
    "7D": "기간 최근 7일",
    "30D": "기간 최근 30일",
    "90D": "기간 최근 90일",
    ALL: "기간 전체",
  };

  return (
    <div
      onClick={() => {
        if (openFilter) setOpenFilter(null);
      }}
      className="fixed inset-0 bg-slate-900/45 z-[75] flex items-center justify-center p-3 sm:p-6"
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (openFilter) setOpenFilter(null);
        }}
        className="bg-white w-full max-w-[1060px] h-[88vh] max-h-[860px] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs"
      >
        {/* 상단 새로고침 + 닫기 버튼 (182006 동일) */}
        <div className="px-7 pt-5 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={fetchLogs}
            className="px-3 py-1 rounded-full border border-slate-200 hover:bg-slate-50 text-[11px] font-semibold text-slate-600 flex items-center gap-1.5"
          >
            <span>↻</span>
            <span>{loading ? "불러오는 중..." : "새로고침 하기"}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-600 flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* 타이틀 + 다운로드 버튼 */}
        <div className="px-7 pt-4 pb-5 flex items-center justify-between shrink-0">
          <div className="flex items-start gap-1.5">
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              감사 로그
            </h2>
            <span className="text-[11px] font-extrabold italic text-[#f06553] mt-0.5">
              Beta
            </span>
          </div>

          <button
            type="button"
            onClick={handleDownloadCsv}
            className="px-3.5 py-2 rounded-lg border border-blue-200 bg-white hover:bg-blue-50/60 text-blue-600 font-bold flex items-center gap-1.5 shadow-2xs"
          >
            <span>⬇️</span>
            <span>필터 적용 내역 다운로드</span>
          </button>
        </div>

        {/* 6종 필터 바 (182015 ~ 182049 동일) */}
        <div className="px-7 py-3 border-y border-slate-100 flex flex-wrap items-center justify-between gap-2 shrink-0 relative">
          <div
            className="flex flex-wrap items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 1. 활동 유형 */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenFilter(openFilter === "ACTIVITY" ? null : "ACTIVITY")
                }
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 ${
                  selectedActivities.length > 0
                    ? "border-blue-400 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>✓ 활동 유형</span>
                {selectedActivities.length > 0 && (
                  <b>{selectedActivities.length}</b>
                )}
                <span className="text-[9px]">▾</span>
              </button>

              {openFilter === "ACTIVITY" && (
                <div className="absolute left-0 top-full mt-1.5 w-[160px] bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-40">
                  {(
                    ["개인정보 접근", "인증", "권한 변경"] as HqAuditActivityType[]
                  ).map((act) => (
                    <label
                      key={act}
                      className="px-3 py-2 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedActivities.includes(act)}
                        onChange={() =>
                          setSelectedActivities(
                            toggleArr(selectedActivities, act)
                          )
                        }
                        className="rounded border-slate-300"
                      />
                      <span className="font-medium text-slate-700">{act}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* 2. 사용자 (182024 2단 구성원·조직 검색) */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenFilter(openFilter === "USER" ? null : "USER")
                }
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 ${
                  selectedUserNames.length > 0
                    ? "border-blue-400 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>👤 사용자</span>
                {selectedUserNames.length > 0 && (
                  <b>{selectedUserNames.length}</b>
                )}
                <span className="text-[9px]">▾</span>
              </button>

              {openFilter === "USER" && (
                <div className="absolute left-0 top-full mt-1.5 w-[440px] bg-white rounded-2xl shadow-2xl border border-slate-200 grid grid-cols-2 overflow-hidden z-40">
                  <div className="p-2.5 border-r border-slate-100 flex flex-col">
                    <div className="flex items-center gap-1.5 mb-2">
                      <input
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        placeholder="🔍 검색"
                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-[#00c458] focus:outline-none text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={() => setOrgViewMode((p) => !p)}
                        className="px-2 py-1.5 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-700 shrink-0"
                      >
                        {orgViewMode ? "목록 보기" : "조직도 보기"}
                      </button>
                    </div>

                    <div className="text-[10px] font-bold text-slate-400 px-1 mb-1">
                      {orgViewMode ? "부서 목록" : "구성원 목록"}
                    </div>

                    <div className="max-h-[250px] overflow-y-auto custom-scroll space-y-0.5">
                      {orgViewMode
                        ? departments.map((dept) => (
                            <button
                              key={dept}
                              type="button"
                              onClick={() => {
                                const deptNames = members
                                  .filter((m) => m.department === dept)
                                  .map((m) => m.name);
                                setSelectedUserNames(
                                  Array.from(
                                    new Set([
                                      ...selectedUserNames,
                                      ...deptNames,
                                    ])
                                  )
                                );
                              }}
                              className="w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 text-left font-bold text-slate-700"
                            >
                              🏢 {dept}
                            </button>
                          ))
                        : members
                            .filter(
                              (m) =>
                                !userSearch.trim() ||
                                m.name.includes(userSearch.trim()) ||
                                m.department.includes(userSearch.trim())
                            )
                            .map((m, idx) => {
                              const checked = selectedUserNames.includes(
                                m.name
                              );
                              return (
                                <button
                                  key={m.instructor_id}
                                  type="button"
                                  onClick={() =>
                                    setSelectedUserNames(
                                      toggleArr(selectedUserNames, m.name)
                                    )
                                  }
                                  className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between text-left ${
                                    checked
                                      ? "bg-emerald-50"
                                      : "hover:bg-slate-50"
                                  }`}
                                >
                                  <span className="flex items-center gap-2">
                                    <span
                                      style={{
                                        backgroundColor:
                                          AVATAR_PALETTE[
                                            idx % AVATAR_PALETTE.length
                                          ],
                                      }}
                                      className="w-5 h-5 rounded-full text-white text-[9px] font-extrabold flex items-center justify-center"
                                    >
                                      {shortAvatarText(m.name)}
                                    </span>
                                    <span className="font-bold text-slate-800">
                                      {m.name}
                                    </span>
                                    <span className="text-[10px] text-slate-400">
                                      {m.work_status === "퇴직"
                                        ? "퇴직"
                                        : m.department}
                                    </span>
                                  </span>
                                  {checked && (
                                    <span className="text-[#00c458] font-bold">
                                      ✓
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                    </div>
                  </div>

                  <div className="p-3 flex flex-col justify-between bg-slate-50/40">
                    <div>
                      {selectedUserNames.length === 0 ? (
                        <div className="text-[11px] text-slate-400">
                          선택없음
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedUserNames.map((nm) => (
                            <span
                              key={nm}
                              className="px-2 py-1 rounded-md bg-white border border-slate-200 text-[11px] font-bold text-slate-700 flex items-center gap-1"
                            >
                              <span>{nm}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedUserNames(
                                    selectedUserNames.filter((x) => x !== nm)
                                  )
                                }
                                className="text-slate-400 hover:text-slate-700"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <label className="flex items-center gap-1.5 text-[11px] text-slate-600 pt-2 border-t border-slate-100 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeSubOrg}
                        onChange={(e) => setIncludeSubOrg(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span>하위 조직 함께 선택</span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* 3. 이벤트 (182032 동일) */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenFilter(openFilter === "EVENT" ? null : "EVENT")
                }
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 ${
                  selectedEvents.length > 0
                    ? "border-blue-400 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>🖱️ 이벤트</span>
                {selectedEvents.length > 0 && <b>{selectedEvents.length}</b>}
                <span className="text-[9px]">▾</span>
              </button>

              {openFilter === "EVENT" && (
                <div className="absolute left-0 top-full mt-1.5 w-[140px] bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-40">
                  {(
                    [
                      "다운로드",
                      "생성",
                      "조회",
                      "수정",
                      "삭제",
                    ] as HqAuditEventType[]
                  ).map((ev) => (
                    <label
                      key={ev}
                      className="px-3 py-2 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(ev)}
                        onChange={() =>
                          setSelectedEvents(toggleArr(selectedEvents, ev))
                        }
                        className="rounded border-slate-300"
                      />
                      <span className="font-medium text-slate-700">{ev}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* 4. 정보 유형 (182040 동일 그룹별 검색 체크박스) */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenFilter(openFilter === "INFO" ? null : "INFO")
                }
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 ${
                  selectedInfoLabels.length > 0
                    ? "border-blue-400 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>📄 정보 유형</span>
                {selectedInfoLabels.length > 0 && (
                  <b>{selectedInfoLabels.length}</b>
                )}
                <span className="text-[9px]">▾</span>
              </button>

              {openFilter === "INFO" && (
                <div className="absolute left-0 top-full mt-1.5 w-[200px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-2.5 z-40">
                  <input
                    value={infoSearch}
                    onChange={(e) => setInfoSearch(e.target.value)}
                    placeholder="정보유형 검색"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#00c458] focus:outline-none text-[11px]"
                  />
                  <div className="text-[10px] font-bold text-slate-500 px-1 py-1.5">
                    총 {selectedInfoLabels.length}개 선택
                  </div>
                  <div className="max-h-[280px] overflow-y-auto custom-scroll space-y-2.5 pr-1">
                    {AUDIT_INFO_TYPE_GROUPS.map((grp) => {
                      const items = grp.items.filter(
                        (it) =>
                          !infoSearch.trim() ||
                          it.label.includes(infoSearch.trim()) ||
                          grp.group.includes(infoSearch.trim())
                      );
                      if (items.length === 0) return null;
                      return (
                        <div
                          key={grp.group}
                          className="pt-1 border-t border-slate-100 first:border-t-0"
                        >
                          <div className="text-[10px] font-bold text-slate-400 px-1 mb-1">
                            {grp.group}
                          </div>
                          {items.map((it) => (
                            <label
                              key={it.key}
                              className="px-1.5 py-1.5 rounded hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedInfoLabels.includes(it.label)}
                                onChange={() =>
                                  setSelectedInfoLabels(
                                    toggleArr(selectedInfoLabels, it.label)
                                  )
                                }
                                className="rounded border-slate-300"
                              />
                              <span className="text-slate-700 font-medium">
                                {it.label}
                              </span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 5. 기간 (기본 최근 7일 — 파란 배지) */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenFilter(openFilter === "PERIOD" ? null : "PERIOD")
                }
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 ${
                  periodPreset !== "ALL"
                    ? "border-blue-400 bg-blue-50/70 text-blue-600"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>📅 {periodLabelMap[periodPreset]}</span>
                {periodPreset !== "ALL" && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setPeriodPreset("ALL");
                    }}
                    className="hover:text-blue-900"
                  >
                    ✕
                  </span>
                )}
              </button>

              {openFilter === "PERIOD" && (
                <div className="absolute left-0 top-full mt-1.5 w-[150px] bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-40">
                  {(["TODAY", "7D", "30D", "90D", "ALL"] as const).map((pr) => (
                    <button
                      key={pr}
                      type="button"
                      onClick={() => {
                        setPeriodPreset(pr);
                        setOpenFilter(null);
                      }}
                      className={`w-full px-3 py-1.5 text-left font-medium ${
                        periodPreset === pr
                          ? "bg-blue-50 text-blue-700 font-bold"
                          : "hover:bg-slate-50 text-slate-700"
                      }`}
                    >
                      {periodLabelMap[pr]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 6. 권한위임 (182049 동일) */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenFilter(openFilter === "DELEGATED" ? null : "DELEGATED")
                }
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 ${
                  delegatedFilter !== "ALL"
                    ? "border-blue-400 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>
                  ⚙️ 권한위임
                  {delegatedFilter === "YES"
                    ? ": 해당"
                    : delegatedFilter === "NO"
                      ? ": 해당안함"
                      : ""}
                </span>
                <span className="text-[9px]">▾</span>
              </button>

              {openFilter === "DELEGATED" && (
                <div className="absolute left-0 top-full mt-1.5 w-[140px] bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-40">
                  <button
                    type="button"
                    onClick={() => {
                      setDelegatedFilter("YES");
                      setOpenFilter(null);
                    }}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700"
                  >
                    해당
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDelegatedFilter("NO");
                      setOpenFilter(null);
                    }}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 font-semibold text-slate-700"
                  >
                    해당안함
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 text-[11px] text-slate-600">
            <span>
              <b className="text-blue-600">조건에 모두 해당</b> 하는 결과입니다.
            </span>
            <span className="text-slate-400 font-bold">
              {filteredLogs.length}
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
            >
              초기화
            </button>
          </div>
        </div>

        {/* 감사 로그 테이블 */}
        <div className="flex-1 overflow-auto custom-scroll px-7">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-white border-b border-slate-100 text-[11px] font-semibold text-slate-400 z-10">
              <tr>
                <th className="py-3 pr-3 w-[92px]">활동 유형</th>
                <th className="py-3 px-3 w-[200px]">사용자</th>
                <th className="py-3 px-3 w-[72px]">이벤트</th>
                <th className="py-3 px-3 w-[95px]">정보 유형</th>
                <th className="py-3 px-3">상세설명 · 사유</th>
                <th className="py-3 px-3 w-[155px]">날짜</th>
                <th className="py-3 pl-3 w-[135px]">접속 정보 (IP)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-16 text-center text-slate-400 font-medium"
                  >
                    선택한 조건에 해당하는 감사 로그 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 pr-3">
                      {log.activity_type === "개인정보 접근" ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full bg-[#fde8ef] text-[#b4235a] text-[10px] font-extrabold">
                          개인정보
                        </span>
                      ) : log.activity_type === "권한 변경" ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-extrabold">
                          권한 변경
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-0.5 rounded-full border border-slate-200 bg-white text-slate-700 text-[10px] font-bold">
                          인증
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-3">
                      <span className="font-extrabold text-slate-900">
                        {log.user_name}
                      </span>{" "}
                      <span className="text-[11px] text-slate-400">
                        {log.user_email}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 font-bold text-slate-800">
                      {log.event_type}
                    </td>
                    <td className="py-3.5 px-3 font-semibold text-slate-700">
                      {log.info_type || "-"}
                    </td>
                    <td className="py-3.5 px-3 text-slate-600">
                      {log.description}
                    </td>
                    <td className="py-3.5 px-3 text-[11px] text-slate-400 leading-snug">
                      {formatAuditKoreanDate(log.created_at)}
                    </td>
                    <td
                      title={log.ip_address}
                      className="py-3.5 pl-3 font-mono text-[11px] text-slate-400 truncate max-w-[135px]"
                    >
                      {log.ip_address}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
