// src/components/hq/leaves/HqCustomGrantModal.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import HqFlexTargetPicker from "./HqFlexTargetPicker";
import { hqFetch } from "@/lib/hq/clientApi";
import {
  isCustomLeaveEligibleForGender,
  isManuallyGrantableCustomLeave,
} from "@/lib/hq/defaultLeaveSettings";
import type {
  HqCustomLeaveGrantItem,
  HqCustomLeaveGrantPeriodMode,
  HqCustomLeaveItem,
  HqMember,
  HqOrgChartNode,
} from "@/lib/hq/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  customLeaves: HqCustomLeaveItem[];
  activeMembers: HqMember[];
  orgNodes?: HqOrgChartNode[] | null;
  lockedPersonalMember?: HqMember | null;
  initialLeaveId?: string;
  initialTargetIds?: string[];
  onSubmitted: (nextCustomGrants?: HqCustomLeaveGrantItem[]) => Promise<void>;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function endOfYearIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-12-31`;
}

export default function HqCustomGrantModal({
  isOpen,
  onClose,
  customLeaves,
  activeMembers,
  orgNodes,
  lockedPersonalMember,
  initialLeaveId,
  initialTargetIds,
  onSubmitted,
}: Props) {
  const [leaveId, setLeaveId] = useState("");
  const [amountStr, setAmountStr] = useState("1");
  const [unitMode, setUnitMode] = useState<"DAYS" | "HOURS">("DAYS");
  const [targetIds, setTargetIds] = useState<string[]>([]);

  // 사용 가능 기간 (Screenshot 3: 언제든 사용 가능 | 사용 기한 지정 -> 시작일·만료일 / 시작일만 / 만료일만)
  const [periodMode, setPeriodMode] =
    useState<HqCustomLeaveGrantPeriodMode>("ALWAYS");
  const [periodPopoverOpen, setPeriodPopoverOpen] = useState(false);
  const [periodTab, setPeriodTab] = useState<"ALWAYS" | "SPECIFY">("ALWAYS");
  const [validFrom, setValidFrom] = useState(todayIso);
  const [expiresAt, setExpiresAt] = useState(endOfYearIso);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const periodRef = useRef<HTMLDivElement | null>(null);

  // 개인 상세페이지에서 진입한 경우 그 개인이 받을 수 있는(수동 부여 가능 + 성별 부합) 휴가 목록만 노출
  const grantableLeaves = useMemo(() => {
    const base = customLeaves.filter((c) => isManuallyGrantableCustomLeave(c));
    if (!lockedPersonalMember) return base;
    const g = lockedPersonalMember.profile_extra?.gender || "";
    return base.filter((c) => isCustomLeaveEligibleForGender(c, g));
  }, [customLeaves, lockedPersonalMember]);

  const selectedLeave = useMemo(
    () =>
      grantableLeaves.find((c) => c.id === leaveId) || grantableLeaves[0] || null,
    [grantableLeaves, leaveId]
  );

  // 선택된 휴가의 성별 조건에 부합하는 부여 가능 구성원 풀
  const eligibleMembers = useMemo(() => {
    if (!selectedLeave) return activeMembers;
    if (selectedLeave.target_gender === "모두") return activeMembers;
    return activeMembers.filter((m) =>
      isCustomLeaveEligibleForGender(
        selectedLeave,
        m.profile_extra?.gender || ""
      )
    );
  }, [activeMembers, selectedLeave]);

  useEffect(() => {
    if (!isOpen) return;
    const preferred =
      (initialLeaveId && grantableLeaves.find((c) => c.id === initialLeaveId)) ||
      grantableLeaves[0] ||
      null;
    if (preferred) {
      setLeaveId(preferred.id);
      if (preferred.grant_unit.startsWith("시간")) {
        setUnitMode("HOURS");
        setAmountStr(String(preferred.grant_amount || 8));
      } else {
        setUnitMode("DAYS");
        setAmountStr(String(preferred.grant_amount || 1));
      }
    }
    if (lockedPersonalMember) {
      setTargetIds([lockedPersonalMember.instructor_id]);
    } else if (initialTargetIds && initialTargetIds.length > 0) {
      setTargetIds(initialTargetIds);
    } else {
      setTargetIds([]);
    }
    setPeriodMode("ALWAYS");
    setPeriodTab("ALWAYS");
    setPeriodPopoverOpen(false);
    setValidFrom(todayIso());
    setExpiresAt(endOfYearIso());
    setReason("");
  }, [
    isOpen,
    initialLeaveId,
    initialTargetIds,
    lockedPersonalMember,
    grantableLeaves,
  ]);

  // 성별 제한 휴가로 변경 시 부적격 대상 자동 정리
  useEffect(() => {
    if (!isOpen || !selectedLeave) return;
    const allowedSet = new Set(eligibleMembers.map((m) => m.instructor_id));
    setTargetIds((prev) => prev.filter((id) => allowedSet.has(id)));
  }, [eligibleMembers, isOpen, selectedLeave]);

  useEffect(() => {
    if (!periodPopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      if (periodRef.current && !periodRef.current.contains(e.target as Node)) {
        setPeriodPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [periodPopoverOpen]);

  if (!isOpen) return null;

  const handleChangeLeave = (nextId: string) => {
    setLeaveId(nextId);
    const found = grantableLeaves.find((c) => c.id === nextId);
    if (found) {
      if (found.grant_unit.startsWith("시간")) {
        setUnitMode("HOURS");
        setAmountStr(String(found.grant_amount || 8));
      } else {
        setUnitMode("DAYS");
        setAmountStr(String(found.grant_amount || 1));
      }
    }
  };

  const periodTriggerLabel =
    periodMode === "ALWAYS"
      ? "언제든 사용 가능"
      : periodMode === "RANGE"
        ? "시작일 · 만료일 입력"
        : periodMode === "START_ONLY"
          ? "시작일만 입력"
          : "만료일만 입력";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLeave) {
      alert("부여할 맞춤 휴가 종류를 선택해 주세요.");
      return;
    }
    if (targetIds.length === 0) {
      alert("부여 대상을 최소 1명 이상 선택해 주세요.");
      return;
    }
    const rawNum = Number(amountStr);
    if (!rawNum || rawNum <= 0) {
      alert("0보다 큰 부여 시간을 입력해 주세요.");
      return;
    }

    const effValidFrom =
      periodMode === "RANGE" || periodMode === "START_ONLY" ? validFrom : null;
    const effExpiresAt =
      periodMode === "RANGE" || periodMode === "END_ONLY" ? expiresAt : null;

    if (
      periodMode === "RANGE" &&
      effValidFrom &&
      effExpiresAt &&
      effValidFrom > effExpiresAt
    ) {
      alert("만료일은 시작일보다 빠를 수 없습니다.");
      return;
    }

    const grantedDays =
      unitMode === "HOURS" ? Math.round((rawNum / 8) * 1000) / 1000 : rawNum;

    setSubmitting(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data?: { customGrants?: HqCustomLeaveGrantItem[] };
      }>("/api/hq/leaves", {
        method: "POST",
        body: {
          action: "GRANT_CUSTOM_LEAVE",
          leave_id: selectedLeave.id,
          leave_name: selectedLeave.name,
          granted_amount: grantedDays,
          grant_unit_mode: unitMode,
          granted_hours: unitMode === "HOURS" ? rawNum : undefined,
          period_mode: periodMode,
          valid_from: effValidFrom,
          expires_at: effExpiresAt,
          reason: reason.trim() || `${selectedLeave.name} 직접 부여`,
          targets: targetIds.map((id) => {
            const m = activeMembers.find((x) => x.instructor_id === id);
            return {
              member_id: id,
              member_name: m?.name || "",
              department: m?.department || "",
            };
          }),
        },
      });
      await onSubmitted(res.data?.customGrants);
      onClose();
    } catch (err: any) {
      alert(err?.message || "맞춤 휴가 부여에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const genderHint =
    selectedLeave?.target_gender === "여성"
      ? `여성 전용 휴가입니다. 성별이 '여'로 등록된 구성원(${eligibleMembers.length}명)만 선택됩니다.`
      : selectedLeave?.target_gender === "남성"
        ? `남성 전용 휴가입니다. 성별이 '남'으로 등록된 구성원(${eligibleMembers.length}명)만 선택됩니다.`
        : undefined;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-[480px] p-7 my-8 relative"
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[20px] font-extrabold text-slate-900 tracking-tight">
              맞춤 휴가 부여하기
            </h3>
            <p className="text-xs text-slate-400 mt-1 font-medium">
              {lockedPersonalMember
                ? `${lockedPersonalMember.name} 님이 받을 수 있는 맞춤 휴가를 부여합니다.`
                : "선택한 구성원에게 맞춤 휴가를 부여합니다."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs font-bold flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4 text-xs">
          {/* 1행: 휴가 종류 + 부여 시간 */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-7">
              <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                휴가 종류 <span className="text-rose-500">*</span>
              </label>
              <select
                value={selectedLeave?.id || ""}
                onChange={(e) => handleChangeLeave(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-[#00c458] outline-none font-bold text-slate-800 bg-white"
              >
                {grantableLeaves.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-5">
              <label className="flex items-center justify-between text-[11px] font-bold text-slate-600 mb-1.5">
                <span>
                  부여 시간 <span className="text-rose-500">*</span>
                </span>
                <span
                  title="시간 단위 부여 시 8시간 = 1일로 자동 환산됩니다."
                  className="text-slate-300 cursor-help"
                >
                  ⓘ
                </span>
              </label>
              <div className="flex items-center rounded-xl border border-slate-200 focus-within:border-[#00c458] bg-white overflow-hidden">
                <input
                  type="number"
                  step={unitMode === "HOURS" ? "0.5" : "0.25"}
                  min={unitMode === "HOURS" ? "0.5" : "0.25"}
                  required
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  className="w-full px-3 py-2.5 font-bold text-slate-900 outline-none min-w-0"
                />
                <select
                  value={unitMode}
                  onChange={(e) =>
                    setUnitMode(e.target.value as "DAYS" | "HOURS")
                  }
                  className="px-2.5 py-2.5 border-l border-slate-100 bg-slate-50/70 font-bold text-slate-700 outline-none shrink-0"
                >
                  <option value="DAYS">일</option>
                  <option value="HOURS">시간</option>
                </select>
              </div>
            </div>
          </div>

          {/* 2행: 부여 대상 (플렉스 2단 피커 + 전원 선택 / 개인 페이지 진입 시 고정 또는 확장 가능) */}
          {lockedPersonalMember ? (
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                부여 대상 <span className="text-rose-500">*</span>
              </label>
              <div className="px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-[10px] font-extrabold inline-flex items-center justify-center">
                    {lockedPersonalMember.name.slice(-2)}
                  </span>
                  <span className="font-extrabold text-slate-900">
                    {lockedPersonalMember.name}
                  </span>
                  <span className="text-[11px] text-slate-400 font-semibold">
                    {lockedPersonalMember.department}
                  </span>
                </div>
                <span className="text-[11px] font-bold text-[#00a84b]">
                  개인 지정됨
                </span>
              </div>
            </div>
          ) : (
            <HqFlexTargetPicker
              label="부여 대상"
              members={eligibleMembers}
              orgNodes={orgNodes}
              selectedIds={targetIds}
              onChange={setTargetIds}
              placeholder="부여 대상 선택"
              eligibilityHint={genderHint}
            />
          )}

          {/* 3행: 사용 가능 기간 (Screenshot 3 100% 재현) */}
          <div ref={periodRef} className="relative">
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              사용 가능 기간 <span className="text-rose-500">*</span>
            </label>
            <button
              type="button"
              onClick={() => setPeriodPopoverOpen((v) => !v)}
              className={`w-full px-3.5 py-2.5 rounded-xl border text-left font-bold text-slate-800 bg-white flex items-center justify-between transition-colors ${
                periodPopoverOpen
                  ? "border-[#00c458] ring-2 ring-[#00c458]/15"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <span>{periodTriggerLabel}</span>
              <span className="text-[10px] text-slate-400">
                {periodPopoverOpen ? "▴" : "▾"}
              </span>
            </button>

            {periodPopoverOpen && (
              <div className="absolute left-0 right-0 top-full mt-1.5 rounded-2xl bg-white border border-slate-200 shadow-2xl p-2.5 z-40 space-y-2">
                {/* 상단 세그먼트 탭: 언제든 사용 가능 | 사용 기한 지정 */}
                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setPeriodTab("ALWAYS");
                      setPeriodMode("ALWAYS");
                      setPeriodPopoverOpen(false);
                    }}
                    className={`py-1.5 rounded-lg text-[11px] font-extrabold transition-all ${
                      periodTab === "ALWAYS"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    언제든 사용 가능
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPeriodTab("SPECIFY");
                      if (periodMode === "ALWAYS") setPeriodMode("RANGE");
                    }}
                    className={`py-1.5 rounded-lg text-[11px] font-extrabold transition-all ${
                      periodTab === "SPECIFY"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    사용 기한 지정
                  </button>
                </div>

                {periodTab === "SPECIFY" && (
                  <div className="py-1 space-y-0.5">
                    {(
                      [
                        { key: "RANGE", label: "시작일 · 만료일 입력" },
                        { key: "START_ONLY", label: "시작일만 입력" },
                        { key: "END_ONLY", label: "만료일만 입력" },
                      ] as const
                    ).map((opt) => {
                      const active = periodMode === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => {
                            setPeriodMode(opt.key);
                            setPeriodPopoverOpen(false);
                          }}
                          className="w-full px-3 py-2 rounded-xl hover:bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-800"
                        >
                          <span>{opt.label}</span>
                          {active && (
                            <span className="text-[#00c458] font-extrabold">
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 기한 지정 선택 시 날짜 입력 필드 노출 */}
            {periodMode !== "ALWAYS" && (
              <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                {(periodMode === "RANGE" || periodMode === "START_ONLY") && (
                  <div
                    className={
                      periodMode === "START_ONLY" ? "sm:col-span-2" : ""
                    }
                  >
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                      사용 시작일
                    </label>
                    <input
                      type="date"
                      required
                      value={validFrom}
                      onChange={(e) => setValidFrom(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-bold text-slate-800 outline-none focus:border-[#00c458]"
                    />
                  </div>
                )}
                {(periodMode === "RANGE" || periodMode === "END_ONLY") && (
                  <div
                    className={periodMode === "END_ONLY" ? "sm:col-span-2" : ""}
                  >
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                      사용 만료일
                    </label>
                    <input
                      type="date"
                      required
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-bold text-slate-800 outline-none focus:border-[#00c458]"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 4행: 부여 사유 */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              메모 · 부여 사유 (선택)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="부여 사유를 입력해주세요 (선택)"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-[#00c458] outline-none font-semibold text-slate-800"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || grantableLeaves.length === 0}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c800] to-[#00b8b0] hover:opacity-95 text-white text-xs font-extrabold shadow-md transition-opacity disabled:opacity-40 mt-2"
          >
            {submitting ? "부여 처리 중..." : "맞춤 휴가 부여하기"}
          </button>
        </form>
      </div>
    </div>
  );
}
