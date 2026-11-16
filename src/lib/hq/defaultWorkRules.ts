// src/lib/hq/defaultWorkRules.ts
import type { HqWorkRuleItem } from "./types";

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
  const shortTag = rule.worker_type === "단시간 근로자" ? " 단시간" : "";
  const offText = offDays.length > 0 ? offDays.join(", ") : "없음";
  return `출근 시간: ${startText} · 주 ${weekly}시간 근무${shortTag} · 쉬는 날: ${offText}`;
}

export function patternShortBadge(
  pattern: HqWorkRuleItem["pattern_type"]
): string {
  if (pattern === "시차 출퇴근 유형") return "시차";
  if (pattern === "선택적 근로시간 유형") return "선택";
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
    assigned_members: [
      {
        id: "wm-jowh",
        name: "조원형",
        job_label: "마케팅",
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
