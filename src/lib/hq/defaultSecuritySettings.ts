// src/lib/hq/defaultSecuritySettings.ts
import type { HqSecuritySettings } from "./types";

export const PASSKEY_LIMIT_OPTIONS = ["1개", "2개", "3개", "4개", "5개"] as const;
export const LOGIN_ATTEMPT_OPTIONS = ["3회", "5회", "10회"] as const;
export const PC_AUTO_LOGOUT_OPTIONS = [
  "3시간",
  "6시간",
  "12시간",
  "1일",
  "3일",
  "7일",
  "14일",
] as const;
export const MOBILE_AUTO_LOGOUT_OPTIONS = [
  "30일",
  "90일",
  "180일",
  "365일",
] as const;
export const IP_RESTRICTION_SCOPE_OPTIONS = [
  "모든 기능 제한",
  "쓰기·다운로드만 제한",
  "급여·인사 민감정보만 제한",
] as const;

export const AUDIT_INFO_TYPE_GROUPS: {
  group: string;
  items: { key: string; label: string }[];
}[] = [
  {
    group: "개인정보",
    items: [
      { key: "개인정보", label: "개인정보" },
      { key: "특이사항", label: "특이사항" },
      { key: "가족정보", label: "가족정보" },
      { key: "학력사항", label: "학력사항" },
      { key: "경력사항", label: "경력사항" },
      { key: "자격사항", label: "자격사항" },
      { key: "개인정보-기타", label: "기타" },
    ],
  },
  {
    group: "소득정보",
    items: [
      { key: "사업소득", label: "사업소득" },
      { key: "근로소득", label: "근로소득" },
      { key: "퇴직소득", label: "퇴직소득" },
      { key: "기타소득", label: "기타소득" },
      { key: "소득정보-기타", label: "기타" },
    ],
  },
  {
    group: "인사정보",
    items: [
      { key: "인사정보", label: "인사정보" },
      { key: "평가정보", label: "평가정보" },
      { key: "채용정보", label: "채용정보" },
      { key: "인사정보-기타", label: "기타" },
    ],
  },
  {
    group: "근태정보",
    items: [
      { key: "근무정보", label: "근무정보" },
      { key: "휴가정보", label: "휴가정보" },
      { key: "근태정보-기타", label: "기타" },
    ],
  },
];

export const DEFAULT_SECURITY_SETTINGS: HqSecuritySettings = {
  two_factor_enabled: false,
  two_factor_exempt_ips: [],
  otp_reset_logs: [],
  ip_restriction_enabled: false,
  allowed_ips: [],
  ip_restriction_scope: "모든 기능 제한",
  ip_restrict_super_admin: false,

  allow_email_login: true,
  allow_phone_login: true,
  allow_passkey_login: true,
  passkey_max_limit: "3개",
  login_max_attempts: "5회",
  pc_auto_logout: "7일",
  mobile_auto_logout: "365일",
  allow_on_leave_login: false,
  temp_auth_codes: [],
};

/**
 * "3시간", "7일", "365일" 등 자동 로그아웃 주기 라벨을 초(seconds) 단위로 변환
 */
export function parseAutoLogoutSeconds(label?: string): number {
  const clean = String(label || "").trim();
  const hourMatch = /^(\d+)\s*시간$/.exec(clean);
  if (hourMatch) return Math.max(1, Number(hourMatch[1])) * 3600;
  const dayMatch = /^(\d+)\s*일$/.exec(clean);
  if (dayMatch) return Math.max(1, Number(dayMatch[1])) * 86400;
  return 7 * 86400; // 기본 7일
}

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let val = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    val = ((val << 8) | n) >>> 0;
  }
  return val;
}

/**
 * 접속 클라이언트 IP가 단일 IP, 와일드카드(예: 58.149.52.*), 또는 CIDR(예: 121.165.204.0/24)과 일치하는지 판정
 */
export function isIpMatchedByRule(clientIp: string, rule: string): boolean {
  const c = clientIp.trim().replace(/^::ffff:/i, "");
  const r = rule.trim().replace(/^::ffff:/i, "");
  if (!c || !r) return false;
  if (c === r) return true;

  if (r.includes("*")) {
    const regexStr =
      "^" +
      r
        .split(".")
        .map((seg) => (seg === "*" ? "\\d+" : seg.replace(/\D/g, "")))
        .join("\\.") +
      "$";
    return new RegExp(regexStr).test(c);
  }

  if (r.includes("/")) {
    const [baseIp, maskStr] = r.split("/");
    const bits = Number(maskStr);
    const clientNum = ipv4ToUint32(c);
    const baseNum = ipv4ToUint32(baseIp || "");
    if (
      clientNum !== null &&
      baseNum !== null &&
      Number.isInteger(bits) &&
      bits >= 0 &&
      bits <= 32
    ) {
      if (bits === 0) return true;
      const mask = (0xffffffff << (32 - bits)) >>> 0;
      return (clientNum & mask) === (baseNum & mask);
    }
  }

  return false;
}
