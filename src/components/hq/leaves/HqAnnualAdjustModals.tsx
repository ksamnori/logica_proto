// src/components/hq/leaves/HqAnnualAdjustModals.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import HqFlexTargetPicker from "./HqFlexTargetPicker";
import { hqFetch } from "@/lib/hq/clientApi";
import { computeMemberAnnualLeaveLedgerForYear } from "@/lib/hq/leaveBalanceEngine";
import type {
  HqAnnualLeavePolicyItem,
  HqApprovalDoc,
  HqLeaveAdjustmentItem,
  HqMember,
  HqOrgChartNode,
  HqUploadedMonthlyUsageItem,
} from "@/lib/hq/types";

// ============================================================================
// 1. 일반 연차 수동 조정 모달 ('연차를 수동으로 부여 · 차감해요')
// ============================================================================
interface ManualAdjustModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeMembers: HqMember[];
  orgNodes?: HqOrgChartNode[] | null;
  initialTargetIds?: string[];
  initialYm?: string;
  onSubmitted: () => Promise<void>;
}

export function HqManualAnnualAdjustModal({
  isOpen,
  onClose,
  activeMembers,
  orgNodes,
  initialTargetIds,
  initialYm,
  onSubmitted,
}: ManualAdjustModalProps) {
  const now = useMemo(() => new Date(), []);
  const defaultYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}`;

  const [direction, setDirection] = useState<"ADD" | "DEDUCT">("ADD");
  const [amountStr, setAmountStr] = useState("1");
  const [unitMode, setUnitMode] = useState<"DAYS" | "HOURS">("DAYS");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [ym, setYm] = useState(defaultYm);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDirection("ADD");
    setAmountStr("1");
    setUnitMode("DAYS");
    setTargetIds(
      initialTargetIds && initialTargetIds.length > 0 ? initialTargetIds : []
    );
    setYm(initialYm || defaultYm);
    setReason("");
  }, [isOpen, initialTargetIds, initialYm, defaultYm]);

  if (!isOpen) return null;

  const rawNum = Math.abs(Number(amountStr) || 0);
  const convertedDays =
    unitMode === "HOURS" ? Math.round((rawNum / 8) * 1000) / 1000 : rawNum;
  const signedDelta = direction === "ADD" ? convertedDays : -convertedDays;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (targetIds.length === 0) {
      alert("조정 대상을 최소 1명 이상 선택해 주세요.");
      return;
    }
    if (!rawNum || !signedDelta) {
      alert("0보다 큰 조정 시간을 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    try {
      await hqFetch("/api/hq/leaves", {
        method: "POST",
        body: {
          action: "BATCH_ADJUSTMENT",
          year_month: ym,
          delta_days: signedDelta,
          unit_mode: unitMode,
          raw_input_amount: rawNum,
          adjustment_category: "MANUAL",
          reason:
            reason.trim() ||
            (direction === "ADD" ? "연차 수동 부여" : "연차 수동 차감"),
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
      await onSubmitted();
      onClose();
    } catch (err: any) {
      alert(err?.message || "연차 조정 반영에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-[480px] p-7 my-8"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[20px] font-extrabold text-slate-900 tracking-tight">
              연차 조정
            </h3>
            <p className="text-xs text-slate-400 mt-1 font-medium">
              연차를 수동으로 부여 · 차감해요. 당해 연말(12.31) 잔여연차에 즉시 반영됩니다.
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
          {/* 1) 조정 구분 (부여 / 차감) + 조정 시간 (일 / 시간) */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-6">
              <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                조정 구분 <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200/70">
                <button
                  type="button"
                  onClick={() => setDirection("ADD")}
                  className={`py-2 rounded-lg font-extrabold transition-all ${
                    direction === "ADD"
                      ? "bg-white text-[#00a84b] shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  + 부여
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("DEDUCT")}
                  className={`py-2 rounded-lg font-extrabold transition-all ${
                    direction === "DEDUCT"
                      ? "bg-white text-rose-600 shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  - 차감
                </button>
              </div>
            </div>

            <div className="sm:col-span-6">
              <label className="flex items-center justify-between text-[11px] font-bold text-slate-600 mb-1.5">
                <span>
                  조정 시간 <span className="text-rose-500">*</span>
                </span>
                <span className="text-[10px] font-extrabold text-slate-400">
                  {signedDelta > 0 ? `+${signedDelta}일` : `${signedDelta}일`}
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

          {/* 2) 조정 대상 (플렉스 2단 조직·구성원 선택 + 전원 선택) */}
          <HqFlexTargetPicker
            label="조정 대상"
            members={activeMembers}
            orgNodes={orgNodes}
            selectedIds={targetIds}
            onChange={setTargetIds}
            placeholder="조정 대상 선택"
          />

          {/* 3) 반영 연월 */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              적용 시점 (반영 연월) <span className="text-rose-500">*</span>
            </label>
            <input
              type="month"
              required
              value={ym}
              onChange={(e) => setYm(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-[#00c458] outline-none font-bold text-slate-800 bg-white"
            />
          </div>

          {/* 4) 조정 사유 */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
              조정 사유 <span className="text-rose-500">*</span>
            </label>
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 포상 추가 연차 부여 / 이전 사용분 차감 조정"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-[#00c458] outline-none font-semibold text-slate-800"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c800] to-[#00b8b0] hover:opacity-95 text-white text-xs font-extrabold shadow-md transition-opacity disabled:opacity-40 mt-2"
          >
            {submitting ? "연차 조정 반영 중..." : "연차 조정하기"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 2. 재직자 / 퇴직자 정산용 잔여 연차 조정 모달
//    (Screenshot 6: 재직자 정산용 잔여 연차 조정 / 퇴직자 정산용 잔여 연차 조정)
// ============================================================================
interface SettlementAdjustModalProps {
  mode: "ACTIVE_SETTLEMENT" | "RETIREE_SETTLEMENT" | null;
  onClose: () => void;
  allMembers: HqMember[];
  annualPolicy: HqAnnualLeavePolicyItem;
  retireeRule: string;
  leaveDocs: HqApprovalDoc[];
  adjustments: HqLeaveAdjustmentItem[];
  uploadedMonthly: HqUploadedMonthlyUsageItem[];
  onSubmitted: () => Promise<void>;
}

export function HqSettlementAnnualAdjustModal({
  mode,
  onClose,
  allMembers,
  annualPolicy,
  retireeRule,
  leaveDocs,
  adjustments,
  uploadedMonthly,
  onSubmitted,
}: SettlementAdjustModalProps) {
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [deptFilter, setDeptFilter] = useState("ALL");
  const [keyword, setKeyword] = useState("");
  const [includeActiveForRetireeSim, setIncludeActiveForRetireeSim] =
    useState(false);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [deltaByMember, setDeltaByMember] = useState<Record<string, string>>(
    {}
  );
  const [ym, setYm] = useState(
    `${currentYear}-${String(currentMonth).padStart(2, "0")}`
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const retiredOnly = useMemo(
    () =>
      allMembers.filter(
        (m) => m.work_status === "퇴직" || Boolean(m.resign_date)
      ),
    [allMembers]
  );

  useEffect(() => {
    if (!mode) return;
    setDeptFilter("ALL");
    setKeyword("");
    setCheckedIds([]);
    setDeltaByMember({});
    setYm(
      mode === "ACTIVE_SETTLEMENT"
        ? `${currentYear}-12`
        : `${currentYear}-${String(currentMonth).padStart(2, "0")}`
    );
    setReason(
      mode === "ACTIVE_SETTLEMENT"
        ? `${currentYear}년 재직자 연차수당 지급 정산`
        : "퇴직자 잔여 연차수당 지급 정산"
    );
    setIncludeActiveForRetireeSim(
      mode === "RETIREE_SETTLEMENT" && retiredOnly.length === 0
    );
  }, [mode, currentYear, currentMonth, retiredOnly.length]);

  const poolMembers = useMemo(() => {
    if (!mode) return [];
    const base =
      mode === "ACTIVE_SETTLEMENT"
        ? allMembers.filter((m) => m.work_status === "재직")
        : includeActiveForRetireeSim
          ? allMembers
          : retiredOnly;

    return base
      .filter((m) => {
        if (deptFilter !== "ALL" && m.department !== deptFilter) return false;
        if (keyword.trim()) {
          const q = keyword.trim().toLowerCase();
          if (
            !m.name.toLowerCase().includes(q) &&
            !(m.department || "").toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [
    mode,
    allMembers,
    includeActiveForRetireeSim,
    retiredOnly,
    deptFilter,
    keyword,
  ]);

  const departments = useMemo(() => {
    const s = new Set<string>();
    allMembers.forEach((m) => {
      if (m.department) s.add(m.department);
    });
    return Array.from(s);
  }, [allMembers]);

  // 각 구성원의 현재 잔여 연차 및 (퇴직자 모드일 때) 입사일 기준 비교값 계산
  const ledgerMap = useMemo(() => {
    const map = new Map<
      string,
      {
        autoDays: number;
        usedDays: number;
        adjDays: number;
        remainDays: number;
        hireBasisRemain?: number;
      }
    >();
    if (!mode) return map;

    const hirePolicy: HqAnnualLeavePolicyItem = {
      ...annualPolicy,
      accrual_basis: "입사일",
    };

    poolMembers.forEach((m) => {
      const fiscalSum = computeMemberAnnualLeaveLedgerForYear({
        memberId: m.instructor_id,
        hireDate: m.hire_date,
        groupHireDate: m.profile_extra?.group_hire_date || null,
        year: currentYear,
        currentYear,
        currentMonth,
        policy: annualPolicy,
        leaveDocs,
        adjustments,
        uploadedMonthly,
      });

      let hireBasisRemain: number | undefined;
      if (mode === "RETIREE_SETTLEMENT") {
        const hireSum = computeMemberAnnualLeaveLedgerForYear({
          memberId: m.instructor_id,
          hireDate: m.hire_date,
          groupHireDate: m.profile_extra?.group_hire_date || null,
          year: currentYear,
          currentYear,
          currentMonth,
          policy: hirePolicy,
          leaveDocs,
          adjustments,
          uploadedMonthly,
        });
        hireBasisRemain = hireSum.availableRemainDays;
      }

      map.set(m.instructor_id, {
        autoDays: fiscalSum.totalAutoGrantYearEnd,
        usedDays: fiscalSum.totalUsedYear,
        adjDays: fiscalSum.totalAdjustedYear,
        remainDays: fiscalSum.availableRemainDays,
        hireBasisRemain,
      });
    });

    return map;
  }, [
    mode,
    poolMembers,
    annualPolicy,
    currentYear,
    currentMonth,
    leaveDocs,
    adjustments,
    uploadedMonthly,
  ]);

  if (!mode) return null;

  const isAllChecked =
    poolMembers.length > 0 &&
    poolMembers.every((m) => checkedIds.includes(m.instructor_id));

  const toggleAll = () => {
    if (isAllChecked) {
      setCheckedIds([]);
    } else {
      setCheckedIds(poolMembers.map((m) => m.instructor_id));
    }
  };

  const applyZeroOutPreset = () => {
    const targetList =
      checkedIds.length > 0
        ? poolMembers.filter((m) => checkedIds.includes(m.instructor_id))
        : poolMembers;

    const nextIds = new Set(checkedIds);
    const nextDeltas = { ...deltaByMember };

    targetList.forEach((m) => {
      const info = ledgerMap.get(m.instructor_id);
      if (!info) return;
      // 퇴직자 유리한 기준 적용 시 법정(입사일) 기준이 더 크면 차액 가산 후 차감 가능하도록 안내, 기본은 현재 잔여분 0일 정산 차감
      if (
        mode === "RETIREE_SETTLEMENT" &&
        retireeRule === "구성원에게 유리한 기준으로 적용" &&
        typeof info.hireBasisRemain === "number" &&
        info.hireBasisRemain > info.remainDays
      ) {
        const bonusGap =
          Math.round((info.hireBasisRemain - info.remainDays) * 100) / 100;
        nextDeltas[m.instructor_id] = String(bonusGap);
        nextIds.add(m.instructor_id);
      } else if (info.remainDays > 0) {
        nextDeltas[m.instructor_id] = String(-info.remainDays);
        nextIds.add(m.instructor_id);
      }
    });

    setDeltaByMember(nextDeltas);
    setCheckedIds(Array.from(nextIds));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetsPayload = checkedIds
      .map((id) => {
        const m = allMembers.find((x) => x.instructor_id === id);
        const info = ledgerMap.get(id);
        const d = Number(deltaByMember[id] || 0);
        if (!m || !d || Number.isNaN(d)) return null;
        const beforeRem = info?.remainDays ?? 0;
        const afterRem = Math.round((beforeRem + d) * 100) / 100;
        return {
          member_id: id,
          member_name: m.name,
          department: m.department || "",
          delta_days: d,
          before_remain_days: beforeRem,
          after_remain_days: afterRem,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    if (targetsPayload.length === 0) {
      alert(
        "정산할 구성원을 체크하고 0이 아닌 정산 조정 일수를 입력해 주세요."
      );
      return;
    }

    setSubmitting(true);
    try {
      await hqFetch("/api/hq/leaves", {
        method: "POST",
        body: {
          action: "BATCH_ADJUSTMENT",
          year_month: ym,
          delta_days: targetsPayload[0].delta_days,
          adjustment_category: mode,
          reason:
            reason.trim() ||
            (mode === "ACTIVE_SETTLEMENT"
              ? "재직자 정산용 잔여 연차 조정"
              : "퇴직자 정산용 잔여 연차 조정"),
          targets: targetsPayload,
        },
      });
      await onSubmitted();
      onClose();
    } catch (err: any) {
      alert(err?.message || "정산용 잔여 연차 조정에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-[820px] p-7 my-8 space-y-5"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[20px] font-extrabold text-slate-900 tracking-tight">
              {mode === "ACTIVE_SETTLEMENT"
                ? "재직자 정산용 잔여 연차 조정"
                : "퇴직자 정산용 잔여 연차 조정"}
            </h3>
            <p className="text-xs text-slate-400 mt-1 font-medium">
              {mode === "ACTIVE_SETTLEMENT"
                ? "재직자 연차 수당 지급을 위해 잔여분을 확인 · 일괄 조정해요."
                : `퇴직자 연차 수당 지급을 위해 잔여분을 확인 · 조정해요. (회사 기준: ${retireeRule})`}
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

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* 상단 필터 + 전원선택 + 일괄 자동채움 툴바 */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700"
              >
                <option value="ALL">전체 조직</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>

              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="구성원 이름 검색"
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800 outline-none w-36"
              />

              {mode === "RETIREE_SETTLEMENT" && (
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeActiveForRetireeSim}
                    onChange={(e) =>
                      setIncludeActiveForRetireeSim(e.target.checked)
                    }
                    className="rounded border-slate-300"
                  />
                  <span>퇴직 예정(재직) 시뮬레이션 포함</span>
                </label>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleAll}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 font-bold text-slate-700"
              >
                {isAllChecked ? "전원 해제" : "전원 선택"}
              </button>
              <button
                type="button"
                onClick={applyZeroOutPreset}
                className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[#00a84b] hover:bg-emerald-100 font-extrabold"
              >
                {mode === "ACTIVE_SETTLEMENT"
                  ? "잔여연차 전액 수당 정산 차감 (0일 맞춤)"
                  : "정산 기준 자동 계산 채우기"}
              </button>
            </div>
          </div>

          {/* 구성원별 잔여연차 확인 및 정산 조정 테이블 */}
          <div className="max-h-[320px] overflow-y-auto rounded-2xl border border-slate-200">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 z-10">
                <tr>
                  <th className="py-2.5 pl-4 pr-2 w-10">
                    <input
                      type="checkbox"
                      checked={isAllChecked}
                      onChange={toggleAll}
                      className="rounded border-slate-300"
                    />
                  </th>
                  <th className="py-2.5 px-3">이름 · 조직</th>
                  <th className="py-2.5 px-3 text-right">입사일</th>
                  <th className="py-2.5 px-3 text-right">현재 잔여</th>
                  {mode === "RETIREE_SETTLEMENT" && (
                    <th className="py-2.5 px-3 text-right">입사일(법정) 기준</th>
                  )}
                  <th className="py-2.5 px-3 text-right w-36">
                    정산 조정 (+부여 / -차감)
                  </th>
                  <th className="py-2.5 pl-3 pr-4 text-right">조정 후 잔여</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {poolMembers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={mode === "RETIREE_SETTLEMENT" ? 7 : 6}
                      className="py-12 text-center text-slate-400 font-semibold"
                    >
                      해당 조건의 구성원이 없습니다.
                    </td>
                  </tr>
                ) : (
                  poolMembers.map((m) => {
                    const checked = checkedIds.includes(m.instructor_id);
                    const info = ledgerMap.get(m.instructor_id);
                    const curRem = info?.remainDays ?? 0;
                    const deltaVal = Number(deltaByMember[m.instructor_id] || 0);
                    const afterRem =
                      Math.round((curRem + deltaVal) * 100) / 100;

                    return (
                      <tr
                        key={m.instructor_id}
                        className={
                          checked ? "bg-emerald-50/35" : "hover:bg-slate-50/60"
                        }
                      >
                        <td className="py-2.5 pl-4 pr-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setCheckedIds((prev) =>
                                checked
                                  ? prev.filter((x) => x !== m.instructor_id)
                                  : [...prev, m.instructor_id]
                              )
                            }
                            className="rounded border-slate-300"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">
                            {m.name}
                            {m.work_status === "퇴직" && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[10px] font-bold">
                                퇴직
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {m.department}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-500 tabular-nums">
                          {m.hire_date || "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-extrabold text-slate-900 tabular-nums">
                          {curRem}일
                        </td>
                        {mode === "RETIREE_SETTLEMENT" && (
                          <td className="py-2.5 px-3 text-right font-bold text-blue-600 tabular-nums">
                            {info?.hireBasisRemain ?? curRem}일
                          </td>
                        )}
                        <td className="py-2.5 px-3 text-right">
                          <input
                            type="number"
                            step="0.25"
                            placeholder="0"
                            value={deltaByMember[m.instructor_id] ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDeltaByMember((p) => ({
                                ...p,
                                [m.instructor_id]: val,
                              }));
                              if (val && Number(val) !== 0 && !checked) {
                                setCheckedIds((prev) => [
                                  ...prev,
                                  m.instructor_id,
                                ]);
                              }
                            }}
                            className="w-28 px-2.5 py-1.5 rounded-lg border border-slate-200 text-right font-bold text-slate-900 bg-white focus:border-[#00c458] outline-none"
                          />
                        </td>
                        <td className="py-2.5 pl-3 pr-4 text-right font-extrabold text-[#00a84b] tabular-nums">
                          {afterRem}일
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 하단 반영 연월 + 정산 메모 */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-4">
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                정산 반영 연월 <span className="text-rose-500">*</span>
              </label>
              <input
                type="month"
                required
                value={ym}
                onChange={(e) => setYm(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-800"
              />
            </div>
            <div className="sm:col-span-8">
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                정산 메모 · 사유 <span className="text-rose-500">*</span>
              </label>
              <input
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-semibold text-slate-800"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00c800] to-[#00b8b0] hover:opacity-95 text-white text-xs font-extrabold shadow-md disabled:opacity-40"
          >
            {submitting
              ? "정산 조정 내역 저장 중..."
              : `선택한 ${checkedIds.length}명 잔여 연차 정산 반영하기`}
          </button>
        </form>
      </div>
    </div>
  );
}
