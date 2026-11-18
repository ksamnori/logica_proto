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
  if (t.includes("연차") || t.includes("반차") || t.includes("시간차")) {
    return true;
  }
  return false;
}

export function roundProRataNumber(
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

/**
 * 근로기준법 제60조 제1항·제4항:
 * 계속 근로 1년 이상 기본 15일 + 최초 1년을 초과하는 매 2년마다 1일 가산 (상한 25일)
 * 공식: min(25, 15 + floor((근속연수 - 1) / 2))
 */
export function calcStatutoryAnnualDaysForCompletedYears(
  completedYears: number
): number {
  if (completedYears < 1) return 0;
  const addDays = Math.max(0, Math.floor((completedYears - 1) / 2));
  return Math.min(25, 15 + addDays);
}

/**
 * 단시간 근로자(주 15~40시간 미만) 비례 산정 및 초단시간 근로자(주 15시간 미만) 제외
 */
export function applyShortTimeWorkerRatio(
  fullTimeDays: number,
  weeklyWorkHours?: number
): number {
  const hrs =
    typeof weeklyWorkHours === "number" && !Number.isNaN(weeklyWorkHours)
      ? weeklyWorkHours
      : 40;
  if (hrs > 0 && hrs < 15) return 0;
  if (hrs >= 15 && hrs < 40) {
    return roundLeave4(fullTimeDays * (hrs / 40));
  }
  return roundLeave4(fullTimeDays);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInCalendarMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

export function addMonthsClampedYmd(
  y: number,
  m1: number,
  d: number,
  addMonths: number
): string {
  const totalMonthIndex = y * 12 + (m1 - 1) + addMonths;
  const targetY = Math.floor(totalMonthIndex / 12);
  const targetM = (totalMonthIndex % 12) + 1;
  const maxDay = daysInCalendarMonth(targetY, targetM);
  const clampedDay = Math.min(d, maxDay);
  return `${targetY}-${pad2(targetM)}-${pad2(clampedDay)}`;
}

export function addDaysUtcYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, (d || 1) + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function daysBetweenUtcYmd(startYmd: string, endYmd: string): number {
  const [sy, sm, sd] = startYmd.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = endYmd.slice(0, 10).split("-").map(Number);
  const sMs = Date.UTC(sy || 2026, (sm || 1) - 1, sd || 1);
  const eMs = Date.UTC(ey || 2026, (em || 1) - 1, ed || 1);
  return Math.round((eMs - sMs) / 86400000);
}

function parseFiscalMonthDayStr(raw?: string): { month: number; day: number } {
  const m = /(\d+)\s*월\s*(\d+)\s*일/.exec(raw || "");
  if (!m) return { month: 1, day: 1 };
  return {
    month: Math.min(12, Math.max(1, Number(m[1]))),
    day: Math.min(31, Math.max(1, Number(m[2]))),
  };
}

function getKstTodayYmd(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
  autoGrant: number; // 기준일(오늘)까지 실제 발생 확정된 연차 일수
  scheduledFutureGrant: number; // 아직 발생일이 도래하지 않은 예정 연차 일수
  grantDateLabels: string[]; // 해당 월 발생일 안내 (예: ["11.06 (+1일)"])
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
  isShortTimeExcluded: boolean; // 주 15시간 미만 초단시간 근로자 적용 제외 여부
  effectiveHireDate: string;
  rows: MonthlyAnnualLedgerRow[];
  monthlyUsed12: number[]; // 길이 12 (1월 ~ 12월 사용일수)
  totalAutoGrantYearEnd: number; // 당해연도 말(12.31)까지 계속 재직 시 총 발생 예정 연차
  totalAutoGrantToDate: number; // 오늘 날짜까지 실제로 발생한 확정 연차
  totalExpired: number;
  totalUsedYear: number; // 1월 1일 ~ 12월 31일 전체 사용(예정 승인건 포함) 합계
  totalAdjustedYear: number;
  availableRemainDays: number; // 현재 실제 발생한 연차 기준 잔여 연차 일수
}

interface InternalGrantEvent {
  grantDate: string; // YYYY-MM-DD
  month: number; // 1..12
  days: number;
  kind: "MONTHLY" | "FISCAL_ANNUAL" | "HIRE_ANNUAL";
}

export function computeMemberAnnualLeaveLedgerForYear(params: {
  memberId: string;
  hireDate?: string | null;
  groupHireDate?: string | null;
  useMemberGroupHireDate?: boolean;
  weeklyWorkHours?: number;
  resignDate?: string | null;
  year: number;
  currentYear?: number;
  currentMonth?: number;
  currentDay?: number;
  todayYmd?: string;
  policy?: HqAnnualLeavePolicyItem;
  leaveDocs: LeaveLedgerDocLite[] | HqApprovalDoc[];
  adjustments: HqLeaveAdjustmentItem[];
  uploadedMonthly?: HqUploadedMonthlyUsageItem[];
}): MemberAnnualLeaveYearSummary {
  const kstToday = params.todayYmd || getKstTodayYmd();
  const [kstY, kstM, kstD] = kstToday.split("-").map(Number);

  const curY = params.currentYear ?? kstY;
  const curM = params.currentMonth ?? kstM;
  // currentYear/currentMonth만 넘기고 todayYmd를 생략한 호출부의 경우 오늘 일자(같은 연월이면 kstD, 아니면 말일) 적용
  const curD =
    params.currentDay ??
    (curY === kstY && curM === kstM
      ? kstD
      : daysInCalendarMonth(curY, curM));
  const asOfTodayYmd =
    params.todayYmd || `${curY}-${pad2(curM)}-${pad2(curD)}`;

  const pol = params.policy || DEFAULT_ANNUAL_LEAVE_POLICY;
  const targetYear = params.year;

  const isYearEndBasis =
    pol.annual_expire_point === "당해 연말 (매년 12월 31일)" ||
    pol.monthly_expire_point === "당해 연말 (매년 12월 31일)";

  // 연차 산정은 법정 원칙에 따라 '입사일(hireDate)'을 기본으로 사용.
  // 관리자가 연차 정책에서 명시적으로 그룹입사일 기준을 켰고(_explicit_group_hire_basis) 구성원도 그룹입사일을 사용 중인 경우에만 그룹입사일 적용.
  const explicitPolicyGroupBasis = Boolean(
    pol.use_group_hire_date && (pol as any)._explicit_group_hire_basis
  );
  const effectiveHireStr = (
    (explicitPolicyGroupBasis &&
    params.useMemberGroupHireDate !== false &&
    params.groupHireDate
      ? params.groupHireDate
      : params.hireDate) || `${targetYear}-01-01`
  ).slice(0, 10);

  const [rawY, rawM, rawD] = effectiveHireStr.split("-").map(Number);
  const hireY = rawY || targetYear;
  const hireM = rawM || 1;
  const hireD = rawD || 1;
  const cleanHireYmd = `${hireY}-${pad2(hireM)}-${pad2(hireD)}`;

  const weeklyHours =
    typeof params.weeklyWorkHours === "number" &&
    !Number.isNaN(params.weeklyWorkHours)
      ? params.weeklyWorkHours
      : 40;
  const isShortTimeExcluded = weeklyHours > 0 && weeklyHours < 15;
  const cleanResignYmd = params.resignDate
    ? String(params.resignDate).slice(0, 10)
    : null;

  const bonus = Math.max(0, Number(pol.extra_bonus_days || 0));
  const monthlyUsed12 = Array<number>(12).fill(0);

  if (hireY > targetYear) {
    return {
      year: targetYear,
      isYearEndBasis,
      isShortTimeExcluded,
      effectiveHireDate: cleanHireYmd,
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

  // =========================================================================
  // 1) targetYear 내에 발생하는 법정 연차 이벤트 정밀 생성 (일자 단위 판별)
  // =========================================================================
  const eventsInTargetYear: InternalGrantEvent[] = [];

  if (!isShortTimeExcluded) {
    // (A) 계속 근로 1년 미만 월 단위 연차 (근로기준법 제60조 제2항: 입사일로부터 1개월 개근 시 1일, 최대 11일)
    if (pol.first_year_monthly_rule === "입사 시 11일 선부여") {
      if (hireY === targetYear && (!cleanResignYmd || cleanResignYmd >= cleanHireYmd)) {
        const upfront = applyShortTimeWorkerRatio(11, weeklyHours);
        eventsInTargetYear.push({
          grantDate: cleanHireYmd,
          month: hireM,
          days: upfront,
          kind: "MONTHLY",
        });
      }
    } else if (pol.first_year_monthly_rule === "매월 개근시 1일 부여") {
      for (let k = 1; k <= 11; k += 1) {
        const grantDate = addMonthsClampedYmd(hireY, hireM, hireD, k);
        if (!grantDate.startsWith(`${targetYear}-`)) continue;
        if (cleanResignYmd && cleanResignYmd < grantDate) continue;
        const mNum = Number(grantDate.slice(5, 7));
        eventsInTargetYear.push({
          grantDate,
          month: mNum,
          days: applyShortTimeWorkerRatio(1, weeklyHours),
          kind: "MONTHLY",
        });
      }
    }

    // (B) 계속 근로 1년 이상 기본 연차(15일) 및 3년 이상 가산 연차(매 2년 1일, 상한 25일)
    if (pol.accrual_basis === "입사일") {
      // 입사일 기준: 만 N년 근무 후 다음 날(366일째 = hireY+N년 동월 동일)에 재직 중이어야 발생
      if (targetYear >= hireY + 1) {
        const completedYears = targetYear - hireY;
        const annivDate = addMonthsClampedYmd(
          hireY,
          hireM,
          hireD,
          completedYears * 12
        );
        if (!cleanResignYmd || cleanResignYmd >= annivDate) {
          const baseDays =
            calcStatutoryAnnualDaysForCompletedYears(completedYears) + bonus;
          eventsInTargetYear.push({
            grantDate: annivDate,
            month: Number(annivDate.slice(5, 7)),
            days: applyShortTimeWorkerRatio(baseDays, weeklyHours),
            kind: "HIRE_ANNUAL",
          });
        }
      }
    } else {
      // 회계연도 기준 (기본 매년 1월 1일)
      const { month: fiscalM, day: fiscalD } = parseFiscalMonthDayStr(
        pol.fiscal_month_day
      );
      const firstCandidateInHireYear = `${hireY}-${pad2(fiscalM)}-${pad2(
        fiscalD
      )}`;
      const firstFiscalYear =
        firstCandidateInHireYear > cleanHireYmd ? hireY : hireY + 1;

      if (targetYear >= firstFiscalYear) {
        const fiscalSeq = targetYear - firstFiscalYear + 1; // 1번째 회계일, 2번째 회계일...
        const maxDay = daysInCalendarMonth(targetYear, fiscalM);
        const fiscalDate = `${targetYear}-${pad2(fiscalM)}-${pad2(
          Math.min(fiscalD, maxDay)
        )}`;

        if (!cleanResignYmd || cleanResignYmd >= fiscalDate) {
          let grantedFullTimeDays = 0;
          const daysEmployedBeforeFirstFiscal = daysBetweenUtcYmd(
            cleanHireYmd,
            `${firstFiscalYear}-${pad2(fiscalM)}-${pad2(
              Math.min(fiscalD, daysInCalendarMonth(firstFiscalYear, fiscalM))
            )}`
          );

          if (
            fiscalSeq === 1 &&
            daysEmployedBeforeFirstFiscal < 365 &&
            pol.first_year_annual_rule ===
              "첫 회계일에 근무한 기간의 연차 부여"
          ) {
            // 중도 입사자의 다음 해 첫 회계일: 15일 × (전년도 재직일수 / 365)
            const rawProRata =
              ((15 + bonus) * Math.max(1, daysEmployedBeforeFirstFiscal)) / 365;
            grantedFullTimeDays = roundProRataNumber(
              rawProRata,
              pol.decimal_rounding
            );
          } else {
            const completedYears =
              hireM === fiscalM && hireD === fiscalD
                ? fiscalSeq
                : Math.max(1, fiscalSeq - 1);
            grantedFullTimeDays =
              calcStatutoryAnnualDaysForCompletedYears(completedYears) + bonus;
          }

          eventsInTargetYear.push({
            grantDate: fiscalDate,
            month: fiscalM,
            days: applyShortTimeWorkerRatio(grantedFullTimeDays, weeklyHours),
            kind: "FISCAL_ANNUAL",
          });
        }
      }
    }
  }

  // =========================================================================
  // 2) 사용 내역 · 수동 조정 내역 집계
  // =========================================================================
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

  for (let m = 1; m <= 12; m += 1) {
    const ym = `${targetYear}-${pad2(m)}`;
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
    const monthUsed = roundLeave4(docsSum > 0 ? docsSum : uploadedVal);
    monthlyUsed12[m - 1] = monthUsed;

    if (m < startMonth) continue;

    const isHireMonth = hireY === targetYear && m === hireM;
    const isCurrentMonth = targetYear === curY && m === curM;

    const monthEvents = eventsInTargetYear.filter((ev) => ev.month === m);
    const isFiscalMonth = monthEvents.some((ev) => ev.kind === "FISCAL_ANNUAL");

    let accruedInMonth = 0;
    let futureInMonth = 0;
    const grantDateLabels: string[] = [];

    for (const ev of monthEvents) {
      const mmdd = `${Number(ev.grantDate.slice(5, 7))}.${ev.grantDate.slice(
        8,
        10
      )}`;
      const isAccrued =
        targetYear < curY ||
        (targetYear === curY && ev.grantDate <= asOfTodayYmd);

      if (isAccrued) {
        accruedInMonth = roundLeave4(accruedInMonth + ev.days);
        grantDateLabels.push(`${mmdd} (+${ev.days}일)`);
      } else {
        futureInMonth = roundLeave4(futureInMonth + ev.days);
        grantDateLabels.push(`${mmdd} (+${ev.days}일 예정)`);
      }
    }

    const monthAdjs = memberAdjs.filter((a) => a.year_month === ym);
    const adjusted = roundLeave4(
      monthAdjs.reduce((acc, a) => acc + Number(a.delta_days || 0), 0)
    );

    totalAutoGrantYearEnd = roundLeave4(
      totalAutoGrantYearEnd + accruedInMonth + futureInMonth
    );
    totalAutoGrantToDate = roundLeave4(totalAutoGrantToDate + accruedInMonth);

    totalUsedYear = roundLeave4(totalUsedYear + monthUsed);
    totalAdjustedYear = roundLeave4(totalAdjustedYear + adjusted);
    running = roundLeave4(running + accruedInMonth - monthUsed + adjusted);

    // 소멸 처리: 과거 연도 연말 소멸 정책 또는 입사 만 1년 도래 시 1년 미만 월차 미사용분 소멸
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
      autoGrant: accruedInMonth,
      scheduledFutureGrant: futureInMonth,
      grantDateLabels,
      expired,
      used: monthUsed,
      adjusted,
      runningBalance: running,
      usedItems: monthDocs,
      adjItems: monthAdjs,
    });
  }

  // 현재 보유(잔여) 연차는 '오늘까지 실제 발생한 연차(totalAutoGrantToDate)'에서 차감하여 정확히 표시
  const availableRemainDays =
    isYearEndBasis && targetYear < curY
      ? 0
      : roundLeave4(
          Math.max(0, totalAutoGrantToDate + totalAdjustedYear - totalUsedYear)
        );

  return {
    year: targetYear,
    isYearEndBasis,
    isShortTimeExcluded,
    effectiveHireDate: cleanHireYmd,
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

// ============================================================================
// 근로기준법 제60조~제62조 시뮬레이터 & 퇴직 시(입사일 vs 회계연도) 재정산 계산기
// ============================================================================
export interface StatutoryLeaveSimulationResult {
  isEligible: boolean;
  ineligibleReason?: string;
  tenureDays: number; // 재직일수 (입사일 포함)
  completedYears: number;
  completedMonthsInFirstYear: number;
  isExact365DayRetiree: boolean; // 만 1년(365일)만 채우고 366일째 미재직 퇴사자 여부
  hireBasisTotalDays: number; // 입사일 기준 누적 총 발생 연차
  fiscalBasisTotalDays: number; // 회계연도(1.1) 기준 누적 총 발생 연차
  retirementExtraCompDays: number; // 퇴사 시 추가 보상 필요 차액 (max(0, 입사일 - 회계연도))
  currentYearGrantDays: number; // 당해/최근 주기 발생 연차 일수
  unusedDays: number; // 미사용 연차 일수 (입사일 기준)
  dailyOrdinaryHours: number; // 1일 소정근로시간 (통상 8시간, 단시간 비례)
  hourlyOrdinaryWage: number; // 통상시급 (월 통상임금 / 209h 기준)
  dailyOrdinaryWage: number; // 1일 통상임금
  estimatedAllowanceWon: number; // 미사용 연차수당 예상액 (원)
  firstYearMonthlyExpireDate: string; // 1년 미만 월차 사용기한 (입사 만 1년 전날)
  promotionSchedule: {
    kind: "UNDER_1Y" | "OVER_1Y";
    expireDate: string;
    firstNoticeWindow: string;
    extraMonthlyNoticeWindow?: string;
    secondDesignationDeadline: string;
  };
  breakdownNotes: string[];
}

export function simulateStatutoryAnnualLeave(params: {
  hireDate: string;
  asOfDate?: string; // 기준일 또는 마지막 근무일(퇴직 전날/퇴직일)
  isRetiringOnAsOfDate?: boolean; // true이면 asOfDate를 마지막 재직일(그 다음날 미재직)로 간주
  weeklyWorkHours?: number;
  monthlyOrdinaryWage?: number;
  totalUsedDays?: number;
  lastYearAttendanceUnder80?: boolean;
  lastYearFullAttendedMonths?: number; // 출근율 80% 미만 시 직전연도 개근 개월 수 (0~11)
}): StatutoryLeaveSimulationResult {
  const cleanHire = (params.hireDate || getKstTodayYmd()).slice(0, 10);
  const cleanAsOf = (params.asOfDate || getKstTodayYmd()).slice(0, 10);
  const weeklyHrs =
    typeof params.weeklyWorkHours === "number" &&
    !Number.isNaN(params.weeklyWorkHours)
      ? params.weeklyWorkHours
      : 40;
  const monthlyWage = Math.max(0, Number(params.monthlyOrdinaryWage || 0));
  const usedDays = Math.max(0, Number(params.totalUsedDays || 0));

  const [hy, hm, hd] = cleanHire.split("-").map(Number);
  const firstYearAnniv = addMonthsClampedYmd(hy, hm, hd, 12); // 366일째(만 1년 다음 날)
  const firstYearEnd = addDaysUtcYmd(firstYearAnniv, -1); // 최초 1년 근로 종료일(365일째)

  if (cleanAsOf < cleanHire) {
    return {
      isEligible: false,
      ineligibleReason: "기준일이 입사일보다 이전입니다.",
      tenureDays: 0,
      completedYears: 0,
      completedMonthsInFirstYear: 0,
      isExact365DayRetiree: false,
      hireBasisTotalDays: 0,
      fiscalBasisTotalDays: 0,
      retirementExtraCompDays: 0,
      currentYearGrantDays: 0,
      unusedDays: 0,
      dailyOrdinaryHours: 8,
      hourlyOrdinaryWage: 0,
      dailyOrdinaryWage: 0,
      estimatedAllowanceWon: 0,
      firstYearMonthlyExpireDate: firstYearEnd,
      promotionSchedule: {
        kind: "UNDER_1Y",
        expireDate: firstYearEnd,
        firstNoticeWindow: "-",
        secondDesignationDeadline: "-",
      },
      breakdownNotes: [],
    };
  }

  // 퇴사일 처리: 흔히 실무에서 '만 1년 채우고 퇴사(예: 2025.05.06 입사 ~ 2026.05.05 마지막 근무)' 시 366일째(2026.05.06) 미재직!
  const lastEmployedYmd = cleanAsOf;
  const tenureDays = daysBetweenUtcYmd(cleanHire, lastEmployedYmd) + 1;

  if (weeklyHrs < 15) {
    return {
      isEligible: false,
      ineligibleReason:
        "4주 평균 1주 소정근로시간이 15시간 미만인 초단시간 근로자는 법정 연차유급휴가 적용 대상에서 제외됩니다 (근로기준법 제18조 제3항).",
      tenureDays,
      completedYears: 0,
      completedMonthsInFirstYear: 0,
      isExact365DayRetiree: false,
      hireBasisTotalDays: 0,
      fiscalBasisTotalDays: 0,
      retirementExtraCompDays: 0,
      currentYearGrantDays: 0,
      unusedDays: 0,
      dailyOrdinaryHours: roundLeave4(weeklyHrs / 5),
      hourlyOrdinaryWage: 0,
      dailyOrdinaryWage: 0,
      estimatedAllowanceWon: 0,
      firstYearMonthlyExpireDate: firstYearEnd,
      promotionSchedule: {
        kind: "UNDER_1Y",
        expireDate: firstYearEnd,
        firstNoticeWindow: "-",
        secondDesignationDeadline: "-",
      },
      breakdownNotes: [],
    };
  }

  const notes: string[] = [];

  // 1) 입사일 기준 누적 발생 연차 계산
  let firstYearMonthlyCount = 0;
  for (let k = 1; k <= 11; k += 1) {
    const mGrantDate = addMonthsClampedYmd(hy, hm, hd, k);
    if (mGrantDate <= lastEmployedYmd) {
      firstYearMonthlyCount += 1;
    }
  }

  const firstYearMonthlyScaled = applyShortTimeWorkerRatio(
    firstYearMonthlyCount,
    weeklyHrs
  );
  let hireBasisTotal = firstYearMonthlyScaled;
  if (firstYearMonthlyCount > 0) {
    notes.push(
      `1년 미만 월 단위 발생분: ${firstYearMonthlyCount}개월 개근 → ${firstYearMonthlyScaled}일 (사용기한: ${firstYearEnd})`
    );
  }

  let completedYears = 0;
  let latestAnnualGrant = firstYearMonthlyScaled;
  for (let yr = 1; yr <= 50; yr += 1) {
    const anniv = addMonthsClampedYmd(hy, hm, hd, yr * 12);
    // 만 yr년 근무 후 다음 날(anniv)에 재직 중이어야 발생!
    // 만약 isRetiringOnAsOfDate가 true이고 퇴직일(마지막 근무일)이 firstYearEnd(365일째)라면 anniv > lastEmployedYmd 이므로 미발생.
    if (anniv <= lastEmployedYmd) {
      completedYears = yr;
      let rawYrDays = calcStatutoryAnnualDaysForCompletedYears(yr);
      // 가장 최근 연차 주기에 대해 출근율 80% 미만 옵션 반영
      const nextAnniv = addMonthsClampedYmd(hy, hm, hd, (yr + 1) * 12);
      const isLatestCycle = nextAnniv > lastEmployedYmd;
      if (isLatestCycle && params.lastYearAttendanceUnder80) {
        rawYrDays = Math.min(
          11,
          Math.max(0, Math.floor(params.lastYearFullAttendedMonths ?? 0))
        );
        notes.push(
          `${yr + 1}년차(${anniv}): 직전 1년 출근율 80% 미만 → 개근 ${rawYrDays}개월분만 발생`
        );
      } else {
        const scaled = applyShortTimeWorkerRatio(rawYrDays, weeklyHrs);
        notes.push(
          `만 ${yr}년 도래(${anniv}, ${yr + 1}년차): ${scaled}일 발생${
            rawYrDays > 15 ? ` (가산 +${rawYrDays - 15}일 포함)` : ""
          }`
        );
      }
      const scaledYrDays = applyShortTimeWorkerRatio(rawYrDays, weeklyHrs);
      hireBasisTotal = roundLeave4(hireBasisTotal + scaledYrDays);
      latestAnnualGrant = scaledYrDays;
    } else {
      break;
    }
  }

  const isExact365DayRetiree =
    Boolean(params.isRetiringOnAsOfDate) && lastEmployedYmd === firstYearEnd;
  if (isExact365DayRetiree) {
    notes.push(
      `⚠️ 입사 만 1년(365일, ${firstYearEnd}) 만료 퇴사: 366일째(${firstYearAnniv})에 재직 중이 아니므로 1년 이상 기본 연차 15일은 발생하지 않습니다 (최대 11일만 인정).`
    );
  }

  // 2) 회계연도(1월 1일) 기준 누적 발생 연차 계산 (퇴직 정산 비교용)
  let fiscalBasisTotal = firstYearMonthlyScaled;
  const firstJan1Year = hm === 1 && hd === 1 ? hy + 1 : hy + 1;
  const asOfYear = Number(lastEmployedYmd.slice(0, 4));
  for (let fy = firstJan1Year; fy <= asOfYear; fy += 1) {
    const jan1 = `${fy}-01-01`;
    if (jan1 > lastEmployedYmd) break;
    const seq = fy - firstJan1Year + 1;
    let rawFiscalDays = 0;
    const daysWorkedFirstYr = daysBetweenUtcYmd(cleanHire, `${firstJan1Year}-01-01`);
    if (seq === 1 && daysWorkedFirstYr < 365) {
      rawFiscalDays = Math.round(((15 * daysWorkedFirstYr) / 365) * 100) / 100;
    } else {
      const compYrs = hm === 1 && hd === 1 ? seq : Math.max(1, seq - 1);
      rawFiscalDays = calcStatutoryAnnualDaysForCompletedYears(compYrs);
    }
    fiscalBasisTotal = roundLeave4(
      fiscalBasisTotal + applyShortTimeWorkerRatio(rawFiscalDays, weeklyHrs)
    );
  }

  const retirementExtraCompDays = roundLeave4(
    Math.max(0, hireBasisTotal - fiscalBasisTotal)
  );

  // 3) 통상임금 및 미사용 연차수당 계산
  // 주 40시간제 월 소정근로시간 = (40 + 8) * 365 / 7 / 12 ≈ 209시간
  const monthlyStandardHours =
    weeklyHrs >= 40
      ? 209
      : Math.round((((weeklyHrs * 1.2) * 365) / 7 / 12) * 100) / 100;
  const dailyOrdinaryHours =
    weeklyHrs >= 40 ? 8 : roundLeave4((weeklyHrs / 40) * 8);
  const hourlyOrdinaryWage =
    monthlyWage > 0 && monthlyStandardHours > 0
      ? Math.round(monthlyWage / monthlyStandardHours)
      : 0;
  // 40시간제 공식: (월 통상임금 / 209) * 8시간
  const dailyOrdinaryWage =
    monthlyWage > 0
      ? Math.round((monthlyWage / monthlyStandardHours) * 8)
      : 0;

  const unusedDays = roundLeave4(Math.max(0, hireBasisTotal - usedDays));
  // 단시간 근로자의 경우 이미 일수가 (weeklyHrs / 40)으로 비례 환산되어 있으므로 8시간 기준 1일 통상임금 곱셈과 동일
  const estimatedAllowanceWon = Math.round(dailyOrdinaryWage * unusedDays);

  // 4) 근로기준법 제61조 연차 사용촉진 법정 일정 산출
  let promotionSchedule: StatutoryLeaveSimulationResult["promotionSchedule"];
  if (completedYears === 0) {
    const threeMonthsBefore = addMonthsClampedYmd(hy, hm, hd, 9);
    const firstEnd = addDaysUtcYmd(threeMonthsBefore, 9);
    const oneMonthBefore = addMonthsClampedYmd(hy, hm, hd, 11);
    const extraEnd = addDaysUtcYmd(oneMonthBefore, 4);
    const tenDaysBefore = addDaysUtcYmd(firstYearEnd, -10);
    promotionSchedule = {
      kind: "UNDER_1Y",
      expireDate: firstYearEnd,
      firstNoticeWindow: `${threeMonthsBefore} ~ ${firstEnd} (만료 3개월 전 기준 10일 이내)`,
      extraMonthlyNoticeWindow: `${oneMonthBefore} ~ ${extraEnd} (만료 1개월 전 기준 5일 이내, 잔여 2개월분)`,
      secondDesignationDeadline: `${tenDaysBefore}까지 (만료 10일 전까지 회사 시기 지정)`,
    };
  } else {
    const cycleStart = addMonthsClampedYmd(hy, hm, hd, completedYears * 12);
    const cycleEnd = addDaysUtcYmd(
      addMonthsClampedYmd(hy, hm, hd, (completedYears + 1) * 12),
      -1
    );
    const sixMonthsBefore = addMonthsClampedYmd(
      hy,
      hm,
      hd,
      completedYears * 12 + 6
    );
    const firstEnd = addDaysUtcYmd(sixMonthsBefore, 9);
    const twoMonthsBefore = addDaysUtcYmd(
      addMonthsClampedYmd(hy, hm, hd, completedYears * 12 + 10),
      -1
    );
    void cycleStart;
    promotionSchedule = {
      kind: "OVER_1Y",
      expireDate: cycleEnd,
      firstNoticeWindow: `${sixMonthsBefore} ~ ${firstEnd} (만료 6개월 전 기준 10일 이내 서면 촉구)`,
      secondDesignationDeadline: `${twoMonthsBefore}까지 (만료 2개월 전까지 회사 시기 지정 서면 통보)`,
    };
  }

  return {
    isEligible: true,
    tenureDays,
    completedYears,
    completedMonthsInFirstYear: firstYearMonthlyCount,
    isExact365DayRetiree,
    hireBasisTotalDays: hireBasisTotal,
    fiscalBasisTotalDays: fiscalBasisTotal,
    retirementExtraCompDays,
    currentYearGrantDays: latestAnnualGrant,
    unusedDays,
    dailyOrdinaryHours,
    hourlyOrdinaryWage,
    dailyOrdinaryWage,
    estimatedAllowanceWon,
    firstYearMonthlyExpireDate: firstYearEnd,
    promotionSchedule,
    breakdownNotes: notes,
  };
}
