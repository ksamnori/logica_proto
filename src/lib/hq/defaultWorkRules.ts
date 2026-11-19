// src/lib/hq/defaultWorkRules.ts
import type {
  HqOvertimeCompSettings,
  HqWorkEditBreakWindow,
  HqWorkRuleItem,
  HqWorkplaceLocationItem,
  HqWorkplaceWifiIpItem,
} from "./types";

export const ALL_WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;

export const TIME_OPTIONS_30M: string[] = [
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "20:00",
];

export function parseHmToMinutes(hm?: string): number | null {
  if (!hm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatMinutesToKoreanAmPm(totalMin: number): string {
  const normalized = ((totalMin % 1440) + 1440) % 1440;
  const h24 = Math.floor(normalized / 60);
  const min = normalized % 60;
  const period = h24 < 12 ? "오전" : "오후";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${period} ${h12}:${String(min).padStart(2, "0")}`;
}

export function formatHmToKoreanAmPm(hm?: string): string {
  const mins = parseHmToMinutes(hm);
  if (mins === null) return hm || "오전 9:00";
  return formatMinutesToKoreanAmPm(mins);
}

export function calcWeeklyWorkHours(rule: HqWorkRuleItem): number {
  if (rule.per_day_custom_enabled && rule.per_day_schedule) {
    let totalMin = 0;
    rule.work_days.forEach((d) => {
      const sc = rule.per_day_schedule?.[d];
      const h = sc ? Number(sc.work_hours ?? rule.daily_work_hours ?? 8) : Number(rule.daily_work_hours ?? 8);
      const m = sc ? Number(sc.work_minutes ?? rule.daily_work_minutes ?? 0) : Number(rule.daily_work_minutes ?? 0);
      totalMin += h * 60 + m;
    });
    return Math.round((totalMin / 60) * 10) / 10;
  }
  const dayCount = rule.work_days.length;
  const dailyHours =
    Number(rule.daily_work_hours || 0) +
    Number(rule.daily_work_minutes || 0) / 60;
  return Math.round(dayCount * dailyHours * 10) / 10;
}

export function calcBreakMinutes(rule: HqWorkRuleItem): number {
  let total = 0;
  const b1s = parseHmToMinutes(rule.break_start_1);
  const b1e = parseHmToMinutes(rule.break_end_1);
  if (b1s !== null && b1e !== null && b1e > b1s) {
    total += b1e - b1s;
  }
  const b2s = parseHmToMinutes(rule.break_start_2);
  const b2e = parseHmToMinutes(rule.break_end_2);
  if (b2s !== null && b2e !== null && b2e > b2s) {
    total += b2e - b2s;
  }
  return total;
}

export function calcStandardCheckInOutPreview(rule: HqWorkRuleItem): {
  checkInLabel: string;
  checkInGraceLabel: string;
  checkOutLabel: string;
  checkOutGraceLabel: string;
} {
  const startMin = parseHmToMinutes(rule.start_time) ?? 540;
  const workMin =
    Number(rule.daily_work_hours || 0) * 60 +
    Number(rule.daily_work_minutes || 0);
  const breakMin = calcBreakMinutes(rule);
  const endMin = startMin + workMin + breakMin;
  const grace = Number(rule.grace_minutes || 0);

  return {
    checkInLabel: formatMinutesToKoreanAmPm(startMin),
    checkInGraceLabel:
      grace > 0
        ? `${formatMinutesToKoreanAmPm(startMin + grace)} 까지 정시 출근 가능`
        : "정각까지 정시 출근 인정",
    checkOutLabel: formatMinutesToKoreanAmPm(endMin),
    checkOutGraceLabel:
      grace > 0
        ? `${formatMinutesToKoreanAmPm(endMin - grace)} 부터 정시 퇴근 가능`
        : "정각부터 정시 퇴근 인정",
  };
}

export function formatWorkRuleSummary(rule: HqWorkRuleItem): string {
  const startText = formatHmToKoreanAmPm(rule.start_time);
  const weekly = calcWeeklyWorkHours(rule);
  const offDays = ALL_WEEKDAYS.filter((d) => !rule.work_days.includes(d));
  const shortTag =
    rule.worker_type === "초단시간 근로자"
      ? " 초단시간"
      : rule.worker_type === "단시간 근로자"
        ? " 단시간"
        : "";
  const offText = offDays.length > 0 ? offDays.join(", ") : "없음";
  return `출근 시간: ${startText} · 주 ${weekly}시간 근무${shortTag} · 쉬는 날: ${offText}`;
}

export function patternShortBadge(
  pattern: HqWorkRuleItem["pattern_type"]
): string {
  if (pattern === "시차 출퇴근 유형" || pattern === "시차 근무 유형") {
    return "시차";
  }
  if (pattern === "선택적 근로시간 유형" || pattern === "선택적 근무 유형") {
    return "선택적";
  }
  if (pattern === "교대 근무 유형") return "교대";
  return "고정";
}

function makeBaseRule(
  partial: Partial<HqWorkRuleItem> & Pick<HqWorkRuleItem, "id" | "name">
): HqWorkRuleItem {
  return {
    pattern_type: "고정 근무 유형",
    worker_type: "통상 근로자",
    cycle_start_day: "월요일",
    work_days: ["월", "화", "수", "목", "금"],
    paid_rest_days: ["일"],
    start_time: "09:00",
    daily_work_hours: 8,
    daily_work_minutes: 0,
    break_start_1: "13:00",
    break_end_1: "14:00",
    break_start_2: "",
    break_end_2: "",
    custom_leave_day_hours: false,
    leave_include_break_mode: "구성원이 사용 시 선택",
    leave_break_duration: "1시간",
    assigned_members: [],
    past_assigned_count: 0,
    overtime_cycle_unit: "월 단위",
    overtime_cycle_day: "매월 1일",
    overtime_allow_mode: "한도 없이 허용",
    split_within_statutory_overtime: true,
    overtime_input_unit: "제한 안 함",
    overtime_min_duration: "제한 안 함",
    night_work_allow_mode: "한도 없이 허용",
    holiday_work_allow_mode: "한도 없이 허용",
    realtime_enabled: true,
    grace_minutes: 10,
    reflect_checkin_on_checkout: false,
    allow_early_checkin: false,
    allow_manual_break_log: false,
    missing_checkout_policy: "출근 기록만 남김",
    default_checkout_mode: "현재 시각으로 퇴근을 우선",
    checkout_confirm_mode: "항상 확인 후 퇴근하도록 제한",
    auto_record_enabled: true,
    reflect_realtime_to_work_hours: true,
    allow_exceed_max_52h: false,
    allow_insufficient_break: true,
    ...partial,
  };
}

export const DEFAULT_WORK_RULES: HqWorkRuleItem[] = [
  makeBaseRule({
    id: "wr-parttime",
    name: "단시간",
    is_default: true,
    worker_type: "단시간 근로자",
    start_time: "09:30",
    daily_work_hours: 4,
    daily_work_minutes: 0,
    break_start_1: "12:00",
    break_end_1: "13:00",
    assigned_members: [],
  }),
  makeBaseRule({
    id: "wr-basic-1",
    name: "기본1",
    start_time: "09:30",
    daily_work_hours: 8,
    break_start_1: "12:00",
    break_end_1: "13:00",
    assigned_members: [
      {
        id: "wm-wonjj",
        name: "원종준",
        job_label: "교재 집필",
        avatar_bg: "#fb923c",
        applied_from_label: "입사일 부터 적용 중",
        status: "ACTIVE",
      },
    ],
  }),
  makeBaseRule({
    id: "wr-basic-2",
    name: "기본 2",
    start_time: "10:00",
    daily_work_hours: 8,
    assigned_members: [],
  }),
  makeBaseRule({
    id: "wr-basic-9",
    name: "기본 9시",
    start_time: "09:00",
    daily_work_hours: 8,
    break_start_1: "13:00",
    break_end_1: "14:00",
    past_assigned_count: 11,
    assigned_members: [
      {
        id: "wm-kimms",
        name: "김문수",
        job_label: "편집",
        avatar_bg: "#f87171",
        applied_from_label: "2023년 1월 1일 부터 적용 중",
        status: "ACTIVE",
      },
      {
        id: "wm-kimdh",
        name: "김동현",
        job_label: "",
        avatar_bg: "#4ade80",
        applied_from_label: "2023년 1월 1일 부터 적용 중",
        status: "ACTIVE",
      },
      {
        id: "wm-baeksy",
        name: "백시연",
        job_label: "교재 집필",
        avatar_bg: "#2dd4bf",
        applied_from_label: "2023년 1월 1일 부터 적용 중",
        status: "ACTIVE",
      },
      {
        id: "wm-simhy",
        name: "심혜영",
        job_label: "디자인",
        avatar_bg: "#38bdf8",
        applied_from_label: "입사일 부터 적용 중",
        status: "ACTIVE",
      },
      {
        id: "wm-minsr",
        name: "민세리",
        job_label: "",
        avatar_bg: "#fb7185",
        applied_from_label: "입사일 부터 적용 중",
        status: "ACTIVE",
      },
      {
        id: "wm-hanms",
        name: "한민서",
        job_label: "마케팅",
        avatar_bg: "#a78bfa",
        applied_from_label: "입사일 부터 적용 중",
        status: "ACTIVE",
      },
      {
        id: "wm-choisy",
        name: "최수연",
        job_label: "디자인",
        avatar_bg: "#fb923c",
        applied_from_label: "입사일 부터 적용 중",
        status: "ACTIVE",
      },
      {
        id: "wm-leeuh",
        name: "이웅행",
        job_label: "",
        avatar_bg: "#facc15",
        applied_from_label: "입사일 부터 적용 중",
        status: "ACTIVE",
      },
      {
        id: "wm-parkjw",
        name: "박주원",
        job_label: "",
        avatar_bg: "#64748b",
        applied_from_label: "입사일 부터 적용 중",
        status: "ACTIVE",
      },
    ],
  }),
  makeBaseRule({
    id: "wr-basic-ceo",
    name: "기본",
    start_time: "09:00",
    daily_work_hours: 8,
    assigned_members: [
      {
        id: "wm-chun",
        name: "천종현",
        job_label: "경영",
        avatar_bg: "#9ba8cf",
        applied_from_label: "입사일 부터 적용 중",
        status: "ACTIVE",
      },
    ],
  }),
  makeBaseRule({
    id: "wr-830",
    name: "8시30분 출근",
    start_time: "08:30",
    daily_work_hours: 8,
    assigned_members: [
      {
        id: "wm-kimgs",
        name: "김근식",
        job_label: "관리팀",
        avatar_bg: "#34d399",
        applied_from_label: "입사일 부터 적용 중",
        status: "ACTIVE",
      },
      {
        id: "wm-jowh",
        name: "조원형",
        job_label: "마케팅",
        avatar_bg: "#fb923c",
        applied_from_label: "입사일 부터 적용 중",
        status: "ACTIVE",
      },
      {
        id: "wm-wonhj",
        name: "원호준",
        job_label: "교재 집필",
        avatar_bg: "#fb923c",
        applied_from_label: "입사일 부터 적용 중",
        status: "ACTIVE",
      },
    ],
  }),
];

/**
 * 설정 > 근무 > 초과 근무 보상 기본값 (전사 포괄 계약 기본 적용)
 */
export const DEFAULT_OVERTIME_COMP_SETTINGS: HqOvertimeCompSettings = {
  item_count_mode: "7_ITEMS",
  deduct_within_statutory_from_inclusive: false,
  policies: [
    {
      id: "ot-pol-default",
      name: "기본 초과 근무 보상 정책",
      description: "",
      is_default: true,
      deduction_cycle_unit: "월 단위",
      deduction_cycle_period: "매달 1일 ~ 매달 31일 (말일)",
      apply_all_inclusive_default: true,
      assigned_members: [
        {
          id: "otm-chun",
          name: "천종현",
          job_label: "경영",
          avatar_bg: "#9ba8cf",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-kimms",
          name: "김문수",
          job_label: "편집",
          avatar_bg: "#eb7d66",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-kimjy",
          name: "김종열",
          job_label: "마케팅",
          avatar_bg: "#b57edc",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-kimhw",
          name: "김형원",
          job_label: "편집",
          avatar_bg: "#eb7d66",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-yoojs",
          name: "유종세",
          job_label: "편집",
          avatar_bg: "#9ba8cf",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-leeha",
          name: "이현아",
          job_label: "편집",
          avatar_bg: "#43c57a",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-jowk",
          name: "조원경",
          job_label: "인사",
          avatar_bg: "#eb7d66",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-leejh",
          name: "이정환",
          job_label: "교재 집필",
          avatar_bg: "#43c57a",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-hwangdh",
          name: "황다혜",
          job_label: "교재 집필",
          avatar_bg: "#f7b299",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-kimgs",
          name: "김근식",
          job_label: "관리팀",
          avatar_bg: "#34d399",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-kimdh",
          name: "김동현",
          job_label: "집필팀",
          avatar_bg: "#4ade80",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-minsr",
          name: "민세리",
          job_label: "집필팀",
          avatar_bg: "#fb7185",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-parkjw",
          name: "박주원",
          job_label: "",
          avatar_bg: "#64748b",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-baeksy",
          name: "백시연",
          job_label: "교재 집필",
          avatar_bg: "#2dd4bf",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-simhy",
          name: "심혜영",
          job_label: "디자인",
          avatar_bg: "#38bdf8",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-wonjj",
          name: "원종준",
          job_label: "교재 집필",
          avatar_bg: "#fb923c",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-leeuh",
          name: "이웅행",
          job_label: "",
          avatar_bg: "#facc15",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-jowh",
          name: "조원형",
          job_label: "마케팅",
          avatar_bg: "#fb923c",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-choisy",
          name: "최수연",
          job_label: "디자인",
          avatar_bg: "#fb923c",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
        {
          id: "otm-hanms",
          name: "한민서",
          job_label: "마케팅",
          avatar_bg: "#a78bfa",
          period_label: "입사일 - 퇴직일까지",
          status: "ACTIVE",
        },
      ],
    },
  ],
};

/**
 * 설정 > 근무 > 근무지 기본값 (본사 기본 구성 + GPS는 기본 OFF로 언제든 ON 전환 가능)
 */
export const DEFAULT_WORKPLACES: HqWorkplaceLocationItem[] = [
  {
    id: "wp-hq-main",
    name: "(주)천종현수학연구소 본사",
    address: "서울특별시 송파구 백제고분로34길 11-15",
    detail_address: "본사 사무실",
    latitude: 37.5032,
    longitude: 127.0938,
    radius_meters: 200,
    gps_enabled: false,
    is_primary: true,
    sync_company_address: true,
    apply_scope: "ALL",
    applied_departments: [],
  },
];

export const DEFAULT_WORKPLACE_IPS: HqWorkplaceWifiIpItem[] = [];


export function resolveWorkRuleForMember(
  workRules?: HqWorkRuleItem[] | null,
  memberName?: string | null,
  scheduleHint?: string | null
): HqWorkRuleItem {
  const rules =
    Array.isArray(workRules) && workRules.length > 0
      ? workRules
      : DEFAULT_WORK_RULES;
  if (memberName) {
    const matched = rules.find((r) =>
      (r.assigned_members || []).some(
        (am) => am.name === memberName && am.status === "ACTIVE"
      )
    );
    if (matched) return matched;
  }
  if (scheduleHint) {
    const byName = rules.find((r) => r.name === scheduleHint);
    if (byName) return byName;
  }
  return (
    rules.find((r) => r.id === "wr-basic-9") ||
    rules.find((r) => r.name.includes("기본")) ||
    DEFAULT_WORK_RULES[3] ||
    DEFAULT_WORK_RULES[0]
  );
}

/**
 * 출퇴근 구간(inMinutes ~ outMinutes)과 총 휴게시간(breakMinutes)에 대해
 * 근무 유형 추천 휴게시간(예: 오후 1:00 ~ 오후 2:00) 또는 저장된 휴게 구간을 정확히 산출
 */
export function resolveBreakWindowsForSpan(params: {
  inMinutes: number;
  outMinutes: number;
  breakMinutes: number;
  explicitBreaks?: HqWorkEditBreakWindow[] | null;
  explicitStart?: number | null;
  explicitEnd?: number | null;
  rule?: HqWorkRuleItem | null;
}): HqWorkEditBreakWindow[] {
  const {
    inMinutes,
    outMinutes,
    breakMinutes,
    explicitBreaks,
    explicitStart,
    explicitEnd,
    rule,
  } = params;

  const totalBreak = Math.max(0, Math.round(breakMinutes || 0));
  if (totalBreak <= 0) return [];

  const isOvernight = outMinutes < inMinutes;
  const endUnwrapped = isOvernight ? outMinutes + 1440 : outMinutes;
  const span = endUnwrapped - inMinutes;
  if (span <= 0) return [];

  const unwrapMin = (m: number) =>
    isOvernight && m < inMinutes ? m + 1440 : m;

  const clampInsideShift = (
    rawStart: number,
    dur: number
  ): HqWorkEditBreakWindow | null => {
    const safeDur = Math.min(
      dur,
      Math.max(0, span - (span > dur + 10 ? 10 : 0))
    );
    if (safeDur <= 0) return null;
    const minStart = span > safeDur + 10 ? inMinutes + 5 : inMinutes;
    const maxStart =
      span > safeDur + 10
        ? endUnwrapped - safeDur - 5
        : endUnwrapped - safeDur;
    const s = Math.max(minStart, Math.min(maxStart, rawStart));
    return {
      start_minutes: Math.round(s),
      end_minutes: Math.round(s + safeDur),
    };
  };

  // 1) 명시적으로 저장된 휴게 구간 배열 우선
  if (Array.isArray(explicitBreaks) && explicitBreaks.length > 0) {
    const valid = explicitBreaks
      .map((b) => {
        const s = unwrapMin(Number(b.start_minutes));
        const eRaw = Number(b.end_minutes);
        const e = eRaw < s ? eRaw + 1440 : unwrapMin(eRaw);
        return { start_minutes: s, end_minutes: e };
      })
      .filter(
        (b) =>
          Number.isFinite(b.start_minutes) &&
          Number.isFinite(b.end_minutes) &&
          b.end_minutes > b.start_minutes &&
          b.start_minutes >= inMinutes &&
          b.end_minutes <= endUnwrapped
      );
    const sumExplicit = valid.reduce(
      (acc, b) => acc + (b.end_minutes - b.start_minutes),
      0
    );
    if (valid.length > 0 && Math.abs(sumExplicit - totalBreak) <= 5) {
      return valid;
    }
    if (valid.length > 0) {
      const adjusted = clampInsideShift(valid[0].start_minutes, totalBreak);
      if (adjusted) return [adjusted];
    }
  }

  // 2) 단일 시작/종료 분 필드가 저장된 경우
  if (
    typeof explicitStart === "number" &&
    Number.isFinite(explicitStart) &&
    typeof explicitEnd === "number" &&
    Number.isFinite(explicitEnd)
  ) {
    const s = unwrapMin(explicitStart);
    const e = explicitEnd < s ? explicitEnd + 1440 : unwrapMin(explicitEnd);
    if (e > s && s >= inMinutes && s < endUnwrapped) {
      const adjusted = clampInsideShift(s, totalBreak);
      if (adjusted) return [adjusted];
    }
  }

  // 3) 근무 유형 추천 휴게시간 (기본 9시 등: 오후 1:00 ~ 오후 2:00 = 780 ~ 840)
  const candidatePairs: { s: number; e: number }[] = [];
  const pushRulePair = (sh?: string, eh?: string) => {
    const ps = parseHmToMinutes(sh);
    const pe = parseHmToMinutes(eh);
    if (ps === null || pe === null) return;
    const s = unwrapMin(ps);
    const e = pe <= ps ? pe + 1440 : unwrapMin(pe);
    if (e > s) candidatePairs.push({ s, e });
  };

  if (rule) {
    pushRulePair(rule.break_start_1, rule.break_end_1);
    pushRulePair(rule.break_start_2, rule.break_end_2);
  }
  if (candidatePairs.length === 0) {
    candidatePairs.push({ s: unwrapMin(780), e: unwrapMin(840) });
  }

  const inShiftPairs = candidatePairs.filter(
    (p) => p.s > inMinutes && p.s < endUnwrapped
  );

  if (inShiftPairs.length === 1) {
    const p = inShiftPairs[0];
    if (
      p.s >= inMinutes &&
      p.s + totalBreak <= endUnwrapped &&
      !(p.s + totalBreak === endUnwrapped && span > totalBreak + 15)
    ) {
      return [{ start_minutes: p.s, end_minutes: p.s + totalBreak }];
    }
    const adjusted = clampInsideShift(p.s, totalBreak);
    if (adjusted) return [adjusted];
  } else if (inShiftPairs.length >= 2) {
    let remaining = totalBreak;
    const out: HqWorkEditBreakWindow[] = [];
    inShiftPairs.forEach((p, idx) => {
      if (remaining <= 0) return;
      const ruleDur = p.e - p.s;
      const alloc =
        idx === inShiftPairs.length - 1
          ? remaining
          : Math.min(remaining, ruleDur);
      const clamped = clampInsideShift(p.s, alloc);
      if (clamped) {
        out.push(clamped);
        remaining -= clamped.end_minutes - clamped.start_minutes;
      }
    });
    if (out.length > 0) return out;
  }

  // 4) 추천 휴게시간이 근무 구간 밖(야간/오후 교대 등)인 경우 근무 구간 중앙 배치
  const midRaw = Math.round((inMinutes + (span - totalBreak) / 2) / 15) * 15;
  const fallback = clampInsideShift(midRaw, totalBreak);
  return fallback ? [fallback] : [];
}
