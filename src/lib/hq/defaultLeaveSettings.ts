// src/lib/hq/defaultLeaveSettings.ts
import { DEFAULT_OVERTIME_COMP_SETTINGS } from "./defaultWorkRules";
import type {
  HqAnnualLeaveGlobalSettings,
  HqAnnualLeavePolicyItem,
  HqCustomLeaveItem,
  HqOvertimeAssignedMember,
} from "./types";

function buildDefaultLeaveMembers(): HqOvertimeAssignedMember[] {
  // 스크린샷(145137.png) 상단 아바타 순서: [근식][동현][문수] + 전체 구성원
  const topOrder = ["김근식", "김동현", "김문수"];
  const pool = DEFAULT_OVERTIME_COMP_SETTINGS.policies[0]?.assigned_members || [];
  const prioritized: HqOvertimeAssignedMember[] = [];
  topOrder.forEach((nm) => {
    const found = pool.find((m) => m.name === nm);
    if (found) prioritized.push({ ...found, id: `lvm-${found.id}` });
  });
  pool.forEach((m) => {
    if (!topOrder.includes(m.name)) {
      prioritized.push({ ...m, id: `lvm-${m.id}` });
    }
  });
  return prioritized;
}

export const GRACE_PERIOD_OPTIONS: string[] = [
  "유예기간 없음",
  "1개월",
  "2개월",
  "3개월",
  "6개월",
  "12개월",
  "18개월",
  "19개월",
  "20개월",
  "21개월",
  "22개월",
  "23개월",
  "24개월",
];

export const FISCAL_DATE_OPTIONS: string[] = [
  "1월 1일",
  "3월 1일",
  "4월 1일",
  "7월 1일",
  "10월 1일",
];

export const DEFAULT_ANNUAL_LEAVE_POLICY: HqAnnualLeavePolicyItem = {
  id: "alp-default",
  policy_id: "lv-annual",
  name: "기본 연차 정책",
  description: "",
  is_default: true,
  request_on_register: true,
  request_on_cancel: false,
  usage_unit_category: "시간",
  hourly_sub_unit: "2시간",
  advance_use_enabled: true,
  advance_use_mode: "자유롭게 사용 가능",
  advance_use_limit_days: 3,
  accrual_basis: "회계일",
  fiscal_month_day: "1월 1일",
  effective_start_date: "2021-01-01",
  first_year_monthly_rule: "매월 개근시 1일 부여",
  first_year_annual_rule: "첫 회계일에 근무한 기간의 연차 부여",
  decimal_rounding: "일 단위 올림 처리",
  extra_bonus_days: 0,
  use_group_hire_date: true,
  monthly_expire_point: "입사일로부터 1년 후",
  monthly_grace_period: "유예기간 없음",
  annual_expire_point: "부여일로부터 1년 후",
  annual_grace_period: "유예기간 없음",
  smart_promotion_enabled: true,
  apply_all_default: true,
  assigned_members: buildDefaultLeaveMembers(),
};

export const DEFAULT_ANNUAL_LEAVE_SETTINGS: HqAnnualLeaveGlobalSettings = {
  hide_visibility_banner: false,
  retiree_adjustment_rule: "구성원에게 유리한 기준으로 적용",
  promotion_remind_member: false,
  promotion_remind_admin: false,
  promotion_plan_notify_timing: "사용 계획일 10일 전",
  smart_annual_timing: "소멸 6개월 전 + 10일 후",
  smart_monthly_timing_1st: "소멸 3개월 전",
  smart_monthly_timing_2nd: "소멸 1개월 전",
  policies: [DEFAULT_ANNUAL_LEAVE_POLICY],
};

/**
 * 설정 > 휴가 > 맞춤 휴가 16개 기본 휴가 종류 (스크린샷 145644~145910 100% 반영)
 */
export const DEFAULT_CUSTOM_LEAVES: HqCustomLeaveItem[] = [
  {
    id: "cl-subfertility",
    policy_id: "lv-subfertility",
    name: "난임 치료",
    icon: "🤰",
    description:
      "난임 치료를 위해 사용하는 휴가입니다. 매년 최대 3일까지 사용할 수 있어요.",
    is_mandatory: true,
    grant_method: "반복 부여",
    repeat_cycle: "회계일(1월 1일) 기준 매년",
    grant_unit: "일 단위 부여",
    grant_amount: 3,
    usage_unit: "일 단위 사용",
    pay_type: "일부 유급",
    partial_paid_days: 2,
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "모두",
    proof_document_mode: "사후 제출",
    proof_document_guide: "난임치료 시술 확인서 또는 진료 확인서",
    deduct_on_holidays: false,
  },
  {
    id: "cl-miscarriage",
    policy_id: "lv-miscarriage",
    name: "유산·사산",
    icon: "🏥",
    description:
      "유산 또는 사산으로 인한 신체적 · 정신적 건강 회복을 위해 사용하는 휴가입니다.",
    is_mandatory: true,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 10,
    usage_unit: "한번에 모두 사용",
    pay_type: "유급",
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "여성",
    proof_document_mode: "사후 제출",
    proof_document_guide: "임신 주수가 기재된 의료기관 진단서",
    deduct_on_holidays: true,
  },
  {
    id: "cl-miscarriage-multi",
    policy_id: "lv-miscarriage-multi",
    name: "유산·사산 (다태아)",
    icon: "🏥",
    description:
      "유산 또는 사산으로 인한 신체적 · 정신적 건강 회복을 위해 사용하는 휴가입니다.",
    is_mandatory: true,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 15,
    usage_unit: "한번에 모두 사용",
    pay_type: "유급",
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "여성",
    proof_document_mode: "사후 제출",
    proof_document_guide: "다태아 임신 및 임신 주수가 기재된 진단서",
    deduct_on_holidays: true,
  },
  {
    id: "cl-premature",
    policy_id: "lv-premature",
    name: "산전후 - 미숙아",
    icon: "👶",
    description: "",
    is_mandatory: true,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 100,
    usage_unit: "한번에 모두 사용",
    pay_type: "일부 유급",
    partial_paid_days: 60,
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "여성",
    proof_document_mode: "사후 제출",
    proof_document_guide: "출생증명서 및 신생아 중환자실 입원 확인서",
    deduct_on_holidays: true,
  },
  {
    id: "cl-spouse-miscarriage",
    policy_id: "lv-spouse-miscarriage",
    name: "배우자 유산 · 사산",
    icon: "👶",
    description:
      "배우자의 유산 · 사산으로 인한 돌봄이 필요한 시기에 사용할 수 있습니다.",
    is_mandatory: true,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 5,
    usage_unit: "한번에 모두 사용",
    pay_type: "유급",
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "모두",
    proof_document_mode: "사후 제출",
    proof_document_guide: "의료기관 진단서 및 가족관계 확인 서류",
    deduct_on_holidays: false,
  },
  {
    id: "cl-menstrual",
    policy_id: "lv-menstrual",
    name: "보건",
    icon: "💊",
    description: "",
    is_mandatory: true,
    grant_method: "반복 부여",
    repeat_cycle: "입사 월부터 매월",
    repeat_use_group_hire: false,
    grant_unit: "일 단위 부여",
    grant_amount: 1,
    usage_unit: "한번에 모두 사용",
    pay_type: "무급",
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "여성",
    proof_document_mode: "없음",
    proof_document_guide: "",
    deduct_on_holidays: false,
  },
  {
    id: "cl-maternity",
    policy_id: "lv-maternity",
    name: "산전후 - 본인",
    icon: "🤰",
    description: "",
    is_mandatory: true,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 90,
    usage_unit: "한번에 모두 사용",
    pay_type: "일부 유급",
    partial_paid_days: 60,
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "여성",
    proof_document_mode: "사후 제출",
    proof_document_guide: "",
    deduct_on_holidays: true,
  },
  {
    id: "cl-maternity-multi",
    policy_id: "lv-maternity-multi",
    name: "산전후 - 본인 (다태아)",
    icon: "🤰",
    description: "",
    is_mandatory: true,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 120,
    usage_unit: "한번에 모두 사용",
    pay_type: "일부 유급",
    partial_paid_days: 75,
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "여성",
    proof_document_mode: "사후 제출",
    proof_document_guide: "",
    deduct_on_holidays: true,
  },
  {
    id: "cl-military",
    policy_id: "lv-military",
    name: "군소집훈련",
    icon: "⛺",
    description: "",
    is_mandatory: true,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 1,
    usage_unit: "시간차 사용 (제한없음)",
    pay_type: "유급",
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "모두",
    proof_document_mode: "사후 제출",
    proof_document_guide: "예비군/민방위 교육훈련 소집통지서 및 필증",
    deduct_on_holidays: false,
  },
  {
    id: "cl-sick",
    policy_id: "lv-sick",
    name: "병가",
    icon: "🏥",
    description: "",
    is_mandatory: false,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 30,
    usage_unit: "일 단위 사용",
    pay_type: "무급",
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "모두",
    proof_document_mode: "사후 제출",
    proof_document_guide: "병원 진단서 또는 진료 확인서",
    deduct_on_holidays: false,
  },
  {
    id: "cl-paternity",
    policy_id: "lv-paternity",
    name: "배우자출산",
    icon: "👶",
    description: "",
    is_mandatory: true,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 10,
    usage_unit: "한번에 모두 사용",
    pay_type: "유급",
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "모두",
    proof_document_mode: "사후 제출",
    proof_document_guide: "출생증명서 등 증빙 서류",
    deduct_on_holidays: false,
  },
  {
    id: "cl-condolence-1",
    policy_id: "lv-condolence-1",
    name: "조의 - 부모/배우자/자녀",
    icon: "✉️",
    description: "신청일 기준이 아닌 발생일 기준",
    is_mandatory: false,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 3,
    usage_unit: "한번에 모두 사용",
    pay_type: "유급",
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "모두",
    proof_document_mode: "사후 제출",
    proof_document_guide: "사망진단서 또는 부고장 등 확인 서류",
    deduct_on_holidays: false,
  },
  {
    id: "cl-condolence-2",
    policy_id: "lv-condolence-2",
    name: "조의 - 조부모/형제/자매",
    icon: "✉️",
    description: "신청일 기준이 아닌 발생일 기준",
    is_mandatory: false,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 2,
    usage_unit: "한번에 모두 사용",
    pay_type: "유급",
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "모두",
    proof_document_mode: "사후 제출",
    proof_document_guide: "부고장 등 확인 서류",
    deduct_on_holidays: false,
  },
  {
    id: "cl-marriage",
    policy_id: "lv-marriage",
    name: "결혼 - 본인",
    icon: "💍",
    description: "",
    is_mandatory: false,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 5,
    usage_unit: "한번에 모두 사용",
    pay_type: "유급",
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "모두",
    proof_document_mode: "사후 제출",
    proof_document_guide: "청첩장 또는 혼인관계증명서",
    deduct_on_holidays: false,
  },
  {
    id: "cl-emergency",
    policy_id: "lv-emergency",
    name: "비상",
    icon: "⚠️",
    description: "",
    is_mandatory: false,
    grant_method: "신청 시 부여",
    grant_unit: "일 단위 부여",
    grant_amount: 1,
    usage_unit: "한번에 모두 사용",
    pay_type: "무급",
    request_on_register: true,
    request_on_cancel: false,
    target_gender: "모두",
    proof_document_mode: "없음",
    proof_document_guide: "",
    deduct_on_holidays: false,
  },
  {
    id: "cl-reward",
    policy_id: "lv-reward",
    name: "보상",
    icon: "✨",
    description: "",
    is_mandatory: true,
    is_reward_type: true,
    grant_method: "관리자가 직접 부여",
    grant_unit: "시간 단위 부여",
    grant_amount: 8,
    usage_unit: "시간차 사용 (제한없음)",
    pay_type: "유급",
    request_on_register: true,
    request_on_cancel: false,
    allow_advance_register: false,
    target_gender: "모두",
    proof_document_mode: "없음",
    proof_document_guide: "",
    deduct_on_holidays: false,
  },
];

export interface AccrualPreviewRow {
  sortMs: number;
  dateLabel: string;
  badgeText?: string;
  badgeVariant?: "blue" | "slate";
  monthlyText: string;
  annualRawText?: string; // 올림 전 비례 일수 (예: "1.89일")
  annualText: string;
}

function formatDotDate(d: Date): string {
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}`;
}

function parseFiscalMonthDay(label: string): { month: number; day: number } {
  const m = /(\d+)월\s*(\d+)일/.exec(label);
  if (!m) return { month: 1, day: 1 };
  return { month: Number(m[1]), day: Number(m[2]) };
}

function roundProRataDays(
  raw: number,
  mode: HqAnnualLeavePolicyItem["decimal_rounding"]
): string {
  if (mode === "일 단위 올림 처리") {
    return `${Math.ceil(raw)}일`;
  }
  if (mode === "0.5일 단위 올림 처리") {
    const val = Math.ceil(raw * 2) / 2;
    return `${val}일`;
  }
  if (mode === "시간 단위로 비례 부여") {
    const wholeDays = Math.floor(raw);
    const hours = Math.round((raw - wholeDays) * 8);
    if (hours === 8) return `${wholeDays + 1}일`;
    return hours > 0 ? `${wholeDays}일 ${hours}시간` : `${wholeDays}일`;
  }
  return `${Math.round(raw * 100) / 100}일`;
}

/**
 * 연차 부여 방식 모달 내 '연차 자동 부여 미리보기' 다년도 스케줄 생성기
 * (스크린샷 145353.png 회계일 기준 & 145419.png 입사일 기준 100% 대응)
 */
export function buildAccrualPreviewRows(
  pol: HqAnnualLeavePolicyItem,
  hireDateIso: string
): AccrualPreviewRow[] {
  const parts = hireDateIso.split("-").map(Number);
  const hire =
    parts.length === 3 && !parts.some(Number.isNaN)
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : new Date(2026, 10, 16);

  const bonus = Math.max(0, Number(pol.extra_bonus_days || 0));
  const rows: AccrualPreviewRow[] = [
    {
      sortMs: hire.getTime(),
      dateLabel: formatDotDate(hire),
      badgeText: "입사일",
      badgeVariant: "blue",
      monthlyText: "-",
      annualText: "-",
    },
  ];

  // 1) 1년 미만 월차 스케줄
  if (pol.first_year_monthly_rule === "입사 시 11일 선부여") {
    rows[0].monthlyText = "11일";
  } else if (pol.first_year_monthly_rule === "매월 개근시 1일 부여") {
    for (let m = 1; m <= 11; m++) {
      const dt = new Date(
        hire.getFullYear(),
        hire.getMonth() + m,
        hire.getDate()
      );
      rows.push({
        sortMs: dt.getTime() + m,
        dateLabel: formatDotDate(dt),
        monthlyText: "1일",
        annualText: "-",
      });
    }
  }

  // 2) 회계일 vs 입사일 다년도 연차 스케줄
  if (pol.accrual_basis === "회계일") {
    const { month, day } = parseFiscalMonthDay(pol.fiscal_month_day);
    let firstFiscalYear = hire.getFullYear();
    const candidate = new Date(firstFiscalYear, month - 1, day);
    if (candidate.getTime() <= hire.getTime()) {
      firstFiscalYear += 1;
    }

    for (let idx = 1; idx <= 5; idx++) {
      const fDate = new Date(firstFiscalYear + (idx - 1), month - 1, day);
      if (
        idx === 1 &&
        pol.first_year_annual_rule === "첫 회계일에 근무한 기간의 연차 부여"
      ) {
        const diffDays = Math.max(
          1,
          Math.round((fDate.getTime() - hire.getTime()) / 86400000) + 1
        );
        const rawDays = Math.min(15, (diffDays / 365) * (15 + bonus));
        const rawStr = `${rawDays.toFixed(2)}일`;
        const finalStr = roundProRataDays(rawDays, pol.decimal_rounding);
        rows.push({
          sortMs: fDate.getTime(),
          dateLabel: formatDotDate(fDate),
          badgeText: "1번째 회계일",
          badgeVariant: "slate",
          monthlyText: "-",
          annualRawText: rawStr !== finalStr ? rawStr : undefined,
          annualText: finalStr,
        });
      } else {
        // 2번째 회계일=15일, 3번째=15일, 4번째=16일, 5번째=16일...
        const addYears = Math.max(0, Math.floor((idx - 2) / 2));
        const total = Math.min(25, 15 + addYears) + bonus;
        rows.push({
          sortMs: fDate.getTime(),
          dateLabel: formatDotDate(fDate),
          badgeText: `${idx}번째 회계일`,
          badgeVariant: "slate",
          monthlyText: "-",
          annualText: `${total}일`,
        });
      }
    }
  } else {
    // 입사일 기준: 2년차(15일), 3년차(15일), 4년차(16일), 5년차(16일), 6년차(17일)
    for (let yr = 1; yr <= 5; yr++) {
      const aDate = new Date(
        hire.getFullYear() + yr,
        hire.getMonth(),
        hire.getDate()
      );
      const addDays = Math.floor((yr - 1) / 2);
      const total = Math.min(25, 15 + addDays) + bonus;
      rows.push({
        sortMs: aDate.getTime(),
        dateLabel: formatDotDate(aDate),
        badgeText: `${yr + 1}년차`,
        badgeVariant: "slate",
        monthlyText: "-",
        annualText: `${total}일`,
      });
    }
  }

  return rows.sort((a, b) => a.sortMs - b.sortMs);
}
