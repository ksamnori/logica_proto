// src/lib/hq/leaveBalanceEngine.ts
import { DEFAULT_ANNUAL_LEAVE_POLICY } from "./defaultLeaveSettings";
import type {
  HqAnnualLeavePolicyItem,
  HqApprovalDoc,
  HqLeaveAdjustmentItem,
  HqUploadedMonthlyUsageItem,
} from "./types";

export function roundLeave4(val: number): number {
  return Math.round((Number(val) || 0) * 10000) / 10000;
}

export function isAnnualDeductibleLeaveType(leaveType?: string | null): boolean {
  const t = String(leaveType || "").trim();
  if (!t) return true;
  if (
    t.includes("연차") ||
    t.includes("반차") ||
    t.includes("시간차")
  ) {
    return true;
  }
  return false;
}

function roundProRataNumber(
  raw: number,
  mode: HqAnnualLeavePolicyItem["decimal_rounding"]
): number {
  if (mode === "일 단위 올림 처리") {
    return Math.ceil(raw);
  }
  if (mode === "0.5일 단위 올림 처리") {
    return Math.ceil(raw * 2) / 2;
  }
  if (mode === "시간 단위로 비례 부여") {
    // 1일 8시간 기준 0.125일(1시간) 단위 반올림
    return Math.round(raw * 8) / 8;
  }
  return Math.round(raw * 100) / 100;
}

export interface LeaveLedgerDocLite {
  approval_id: string;
  drafter_id: string;
  status: string;
  effective_date: string | null;
  end_date?: string | null;
  leave_type: string | null;
  leave_days: number;
}

export interface MonthlyAnnualLedgerRow {
  ym: string;
  monthNum: number;
  isHireMonth: boolean;
  isFiscalMonth: boolean;
  isCurrentMonth: boolean;
  autoGrant: number;
  expired: number;
  used: number;
  adjusted: number;
  runningBalance: number;
  usedItems: LeaveLedgerDocLite[];
  adjItems: HqLeaveAdjustmentItem[];
}

export interface MemberAnnualLeaveYearSummary {
  year: number;
  isYearEndBasis: boolean;
  rows: MonthlyAnnualLedgerRow[];
  monthlyUsed12: number[]; // 길이 12 (1월 ~ 12월 사용일수)
  totalAutoGrantYearEnd: number; // 해당연도 연말(12.31)까지 총 발생 연차
  totalAutoGrantToDate: number; // 현재 월까지 발생 연차
  totalExpired: number;
  totalUsedYear: number; // 1월 1일 ~ 12월 31일 전체 사용(예정 승인건 포함) 합계
  totalAdjustedYear: number;
  availableRemainDays: number; // 정책에 따른 현재 남은 연차 일수
}

export function computeMemberAnnualLeaveLedgerForYear(params: {
  memberId: string;
  hireDate?: string | null;
  groupHireDate?: string | null;
  year: number;
  currentYear?: number;
  currentMonth?: number;
  policy?: HqAnnualLeavePolicyItem;
  leaveDocs: LeaveLedgerDocLite[] | HqApprovalDoc[];
  adjustments: HqLeaveAdjustmentItem[];
  uploadedMonthly?: HqUploadedMonthlyUsageItem[];
}): MemberAnnualLeaveYearSummary {
  const now = new Date();
  const curY = params.currentYear ?? now.getFullYear();
  const curM = params.currentMonth ?? now.getMonth() + 1;
  const pol = params.policy || DEFAULT_ANNUAL_LEAVE_POLICY;
  const targetYear = params.year;

  const isYearEndBasis =
    pol.annual_expire_point === "당해 연말 (매년 12월 31일)" ||
    pol.monthly_expire_point === "당해 연말 (매년 12월 31일)";

  const effectiveHireStr =
    (pol.use_group_hire_date && params.groupHireDate
      ? params.groupHireDate
      : params.hireDate) || `${targetYear}-01-01`;

  const [rawY, rawM, rawD] = effectiveHireStr.slice(0, 10).split("-").map(Number);
  const hireY = rawY || targetYear;
  const hireM = rawM || 1;
  const hireD = rawD || 1;
  const bonus = Math.max(0, Number(pol.extra_bonus_days || 0));

  const monthlyUsed12 = Array<number>(12).fill(0);

  if (hireY > targetYear) {
    return {
      year: targetYear,
      isYearEndBasis,
      rows: [],
      monthlyUsed12,
      totalAutoGrantYearEnd: 0,
      totalAutoGrantToDate: 0,
      totalExpired: 0,
      totalUsedYear: 0,
      totalAdjustedYear: 0,
      availableRemainDays: 0,
    };
  }

  // 해당 구성원의 유효 연차 신청건 (승인완료 + 결재대기/진행중 포함, 당해 연말 12.31까지 예정분 모두 반영)
  const memberDeductibleDocs = (params.leaveDocs || []).filter(
    (d) =>
      String(d.drafter_id) === String(params.memberId) &&
      (d.status === "APPROVED" ||
        d.status === "PENDING" ||
        d.status === "IN_PROGRESS") &&
      isAnnualDeductibleLeaveType(d.leave_type) &&
      (d.effective_date || "").startsWith(`${targetYear}-`)
  );

  const memberAdjs = (params.adjustments || []).filter(
    (a) =>
      String(a.member_id) === String(params.memberId) &&
      a.year_month.startsWith(`${targetYear}-`)
  );

  const uploadedEntry = (params.uploadedMonthly || []).find(
    (u) =>
      String(u.member_id) === String(params.memberId) && u.year === targetYear
  );

  const startMonth = hireY === targetYear ? hireM : 1;
  const rows: MonthlyAnnualLedgerRow[] = [];

  let totalAutoGrantYearEnd = 0;
  let totalAutoGrantToDate = 0;
  let totalExpired = 0;
  let totalUsedYear = 0;
  let totalAdjustedYear = 0;
  let running = 0;

  // 직전연도 입사자의 전년도 기발생 월차 개월수 (최대 11일 한도 관리용)
  const prevYearMonthlyCount =
    hireY === targetYear - 1 ? Math.max(0, 12 - hireM) : 0;
  const remainingFirstYearMonthlyQuota = Math.max(0, 11 - prevYearMonthlyCount);

  for (let m = 1; m <= 12; m += 1) {
    const ym = `${targetYear}-${String(m).padStart(2, "0")}`;
    const monthDocs = memberDeductibleDocs.filter((d) =>
      (d.effective_date || "").startsWith(ym)
    );
    const docsSum = roundLeave4(
      monthDocs.reduce((acc, d) => acc + Number(d.leave_days || 0), 0)
    );
    const uploadedVal =
      uploadedEntry && Array.isArray(uploadedEntry.months)
        ? Number(uploadedEntry.months[m - 1] || 0)
        : 0;
    // 업로드된 과거 월별 사용내역과 전자결재 기록 중 큰 값(또는 합산 방지) 반영:
    // 결재문서가 없는 과거 월은 업로드 값을 사용하고, 결재문서가 있으면 결재문서 + 업로드 보정치를 합산하지 않고 업로드 기준과 자연스럽게 병합
    const monthUsed = roundLeave4(docsSum > 0 ? docsSum : uploadedVal);
    monthlyUsed12[m - 1] = monthUsed;

    if (m < startMonth) continue;

    const isHireMonth = hireY === targetYear && m === hireM;
    const isCurrentMonth = targetYear === curY && m === curM;
    let isFiscalMonth = false;
    let autoGrant = 0;

    if (hireY === targetYear) {
      // 1) 당해연도 입사자 (1년 미만)
      if (pol.first_year_monthly_rule === "입사 시 11일 선부여") {
        if (isHireMonth) {
          // 연말 소멸 기준이면 당해 연말까지 발생분(12 - hireM, 최소 1) 또는 11일 중 정책 반영
          autoGrant = isYearEndBasis ? Math.max(1, 12 - hireM) : 11;
        }
      } else if (
        pol.first_year_monthly_rule === "매월 개근시 1일 부여" &&
        m > hireM
      ) {
        autoGrant = 1;
      }
    } else if (hireY === targetYear - 1) {
      // 2) 직전연도 중도입사자 (1번째 회계일 + 잔여 1년미만 월차)
      if (m === 1) {
        isFiscalMonth = true;
        if (pol.first_year_annual_rule === "1년 만근시 15일 부여") {
          autoGrant = 15 + bonus;
        } else {
          const hireDt = new Date(hireY, hireM - 1, hireD);
          const fiscalDt = new Date(targetYear, 0, 1);
          const diffDays = Math.max(
            1,
            Math.round((fiscalDt.getTime() - hireDt.getTime()) / 86400000)
          );
          const rawProRata = Math.min(15, (diffDays / 365) * (15 + bonus));
          autoGrant = roundProRataNumber(rawProRata, pol.decimal_rounding);
        }
      }
      // 입사 1년 도래 전까지 남은 월차 부여 (1월 ~ hireM 중 remainingFirstYearMonthlyQuota 한도)
      if (
        pol.first_year_monthly_rule === "매월 개근시 1일 부여" &&
        m >= 1 &&
        m <= remainingFirstYearMonthlyQuota
      ) {
        autoGrant = roundLeave4(autoGrant + 1);
      }
    } else {
      // 3) 2년 이상 근속자: 매년 1월 1일(회계일) 법정 연차 + 근속가산 부여
      if (m === 1) {
        isFiscalMonth = true;
        const fiscalIdx =
          hireM === 1 && hireD === 1
            ? targetYear - hireY + 1
            : targetYear - hireY;
        const addYears = Math.max(0, Math.floor((fiscalIdx - 2) / 2));
        autoGrant = Math.min(25, 15 + addYears) + bonus;
      }
    }

    const monthAdjs = memberAdjs.filter((a) => a.year_month === ym);
    const adjusted = roundLeave4(
      monthAdjs.reduce((acc, a) => acc + Number(a.delta_days || 0), 0)
    );

    totalAutoGrantYearEnd = roundLeave4(totalAutoGrantYearEnd + autoGrant);
    if (targetYear < curY || (targetYear === curY && m <= curM)) {
      totalAutoGrantToDate = roundLeave4(totalAutoGrantToDate + autoGrant);
    }

    totalUsedYear = roundLeave4(totalUsedYear + monthUsed);
    totalAdjustedYear = roundLeave4(totalAdjustedYear + adjusted);
    running = roundLeave4(running + autoGrant - monthUsed + adjusted);

    // 과거 연도이며 당해 연말(12월 31일) 소멸 정책인 경우 12월 말 미사용 잔여분 자동 소멸 처리
    let expired = 0;
    if (isYearEndBasis && targetYear < curY && m === 12 && running > 0) {
      expired = running;
      totalExpired = roundLeave4(totalExpired + expired);
      running = 0;
    }

    rows.push({
      ym,
      monthNum: m,
      isHireMonth,
      isFiscalMonth,
      isCurrentMonth,
      autoGrant,
      expired,
      used: monthUsed,
      adjusted,
      runningBalance: running,
      usedItems: monthDocs,
      adjItems: monthAdjs,
    });
  }

  // 당해 연말(12월 31일) 사용 기준이면 연말까지 사용 가능한 총 발생분에서 올해 전체(12.31까지 예정분 포함) 사용일수를 차감
  const baseGrantForRemain =
    isYearEndBasis || pol.advance_use_enabled
      ? totalAutoGrantYearEnd
      : totalAutoGrantToDate;

  const availableRemainDays =
    isYearEndBasis && targetYear < curY
      ? 0
      : roundLeave4(
          Math.max(0, baseGrantForRemain + totalAdjustedYear - totalUsedYear)
        );

  return {
    year: targetYear,
    isYearEndBasis,
    rows,
    monthlyUsed12,
    totalAutoGrantYearEnd,
    totalAutoGrantToDate,
    totalExpired,
    totalUsedYear,
    totalAdjustedYear,
    availableRemainDays,
  };
}
