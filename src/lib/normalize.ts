// src/lib/normalize.ts
// 전화번호·학년 표기 통일
// - 전화번호: 010-1234-5678 형식 (학생 형제 구분 꼬리표 -1, -2 는 그대로 유지)
// - 학년: 초1~초6, 중1~중3, 고1~고3, 7세 반
// - 알아볼 수 없는 값은 에러 없이 원래 글자를 그대로 돌려줍니다 (저장이 막히지 않도록).
// DB에도 같은 규칙의 트리거(phone_grade_normalize.sql)가 있어서, 구글폼 등 어디로 들어와도 같은 형식으로 저장됩니다.

// ---------------- 전화번호 ----------------

/** 숫자만 남기고, +82·82 국가번호와 앞자리 0이 빠진 번호(구글 시트)를 바로잡은 숫자열 */
function phoneDigits(raw: string): string {
  let d = raw.replace(/[^0-9+]/g, "");
  if (d.startsWith("+82")) d = "0" + d.slice(3);
  d = d.replace(/\+/g, "");
  if (/^82(1[016789]|[2-6])/.test(d) && (d.length === 11 || d.length === 12)) d = "0" + d.slice(2);
  if (/^1[016789]\d{7,8}$/.test(d)) d = "0" + d; // 구글 시트가 앞의 0을 지운 경우: 1012345678 → 01012345678
  if (/^00/.test(d)) d = d.slice(1);
  return d;
}

/** 숫자열을 하이픈 형식으로. 전화번호 모양이 아니면 null */
function hyphenate(d: string): string | null {
  if (/^01[016789]\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;   // 010-1234-5678
  if (/^01[16789]\d{7}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;    // 011-123-4567
  if (/^02\d{8}$/.test(d)) return `02-${d.slice(2, 6)}-${d.slice(6)}`;                          // 02-1234-5678
  if (/^02\d{7}$/.test(d)) return `02-${d.slice(2, 5)}-${d.slice(5)}`;                          // 02-123-4567
  if (/^0[3-9]\d{9}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;      // 031-1234-5678, 070-...
  if (/^0[3-9]\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;      // 031-123-4567
  if (/^1[5-9]\d{6}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`;                         // 1588-1234
  return null;
}

/**
 * 저장용 전화번호 정리. 010-1234-5678 형식으로 바꿉니다.
 * - "01012345678", "010 1234 5678", "010.1234.5678", "+82 10-1234-5678", "1012345678"(구글 시트) 모두 변환
 * - 학생 형제 구분 꼬리표: "010-1234-5678-1", "01012345678-2" → "010-1234-5678-1", "010-1234-5678-2"
 * - 글자가 섞인 값(예: unassigned_...)이나 알아볼 수 없는 값은 그대로 둡니다.
 */
export function formatPhone(raw: string | null | undefined): string {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (/^unassigned|_/i.test(s)) return s; // 더미 값은 건드리지 않음
  if (/[A-Za-z가-힣]/.test(s)) {
    // "010-1234-5678 (엄마)" 처럼 글자가 섞여 있으면 휴대폰 번호 부분만 골라냄
    const hit = s.match(/(\+?82[\s-]?)?0?1[016789][\s.-]?\d{3,4}[\s.-]?\d{4}/);
    return hit ? (hyphenate(phoneDigits(hit[0])) || s) : s;
  }

  const whole = hyphenate(phoneDigits(s));
  if (whole) return whole;

  // 꼬리표(-1, -2 …)가 붙은 학생 번호
  const m = s.match(/^(.*\d)\s*-\s*(\d{1,2})$/);
  if (m) {
    const base = hyphenate(phoneDigits(m[1]));
    if (base) return `${base}-${Number(m[2])}`;
  }
  return s;
}

/** 입력칸에서 타이핑하는 동안 쓰는 하이픈 자동 입력 (010-1234-5678, 최대 13자) */
export function formatPhoneTyping(val: string): string {
  const v = val.replace(/[^0-9]/g, "").slice(0, 11);
  if (v.startsWith("02")) {
    if (v.length <= 2) return v;
    if (v.length <= 5) return `${v.slice(0, 2)}-${v.slice(2)}`;
    if (v.length <= 9) return `${v.slice(0, 2)}-${v.slice(2, 5)}-${v.slice(5)}`;
    return `${v.slice(0, 2)}-${v.slice(2, 6)}-${v.slice(6, 10)}`;
  }
  if (v.length <= 3) return v;
  if (v.length <= 7) return `${v.slice(0, 3)}-${v.slice(3)}`;
  if (v.length <= 10) return `${v.slice(0, 3)}-${v.slice(3, 6)}-${v.slice(6)}`;
  return `${v.slice(0, 3)}-${v.slice(3, 7)}-${v.slice(7)}`;
}

/** DB 검색용: 하이픈 형식과 숫자만 형식 둘 다 (예전 데이터가 남아 있어도 찾을 수 있게) */
export function phoneVariants(raw: string | null | undefined): string[] {
  const f = formatPhone(raw);
  if (!f) return [];
  const digits = f.replace(/[^0-9]/g, "");
  return Array.from(new Set([f, digits].filter(Boolean)));
}

// ---------------- 학년 ----------------

export const GRADE_OPTIONS = ["7세 반", "초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"] as const;

const MAX: Record<string, number> = { 초: 6, 중: 3, 고: 3 };
const KOR_NUM: Record<string, string> = { 일: "1", 이: "2", 삼: "3", 사: "4", 오: "5", 육: "6", 한: "1", 두: "2", 세: "3", 네: "4" };

/** 학교 이름으로 초·중·고 짐작 (예: 서울중, 한빛중학교, 대한여고, 새솔초등학교) */
function levelFromSchool(school: string | null | undefined): "초" | "중" | "고" | null {
  const s = String(school || "").replace(/\s/g, "");
  if (!s) return null;
  if (/(초등학교|초교|초)$/.test(s) || s.includes("초등")) return "초";
  if (/(중학교|중)$/.test(s) || s.includes("중학")) return "중";
  if (/(고등학교|고교|고)$/.test(s) || s.includes("고등")) return "고";
  return null;
}

/** 한 단계 아래 학년 (예비중1 → 초6) */
function prevGrade(level: "초" | "중" | "고", n: number): string {
  if (n > 1) return `${level}${n - 1}`;
  if (level === "중") return "초6";
  if (level === "고") return "중3";
  return "7세 반";
}

/**
 * 학년 표기를 초1 / 중3 / 고2 / 7세 반 형식으로 통일합니다.
 * - "중학교 1학년", "중등 1", "중1학년", "M1", "중 1" → 중1
 * - "1학년" + 학교 "OO중학교" → 중1 (학교 이름으로 초·중·고를 판단)
 * - 숫자만 "7" → 중1 (1~6 초, 7~9 중, 10~12 고: 기존 프로그램 규칙)
 * - "예비중1" → 초6, "예비고1" → 중3
 * - "7세", "7세반", "7살", "유치부" → 7세 반
 * - 알아볼 수 없는 값(미입력, 졸업, 재수 등)은 그대로 둡니다.
 */
export function normalizeGrade(raw: string | null | undefined, school?: string | null): string {
  if (raw == null) return "";
  const original = String(raw).trim();
  if (!original) return "";
  let s = original.replace(/\s+/g, "").replace(/[()]/g, "");

  // 유치부
  const age = s.match(/^([4-7])(세|살)/);
  if (age) return `${age[1]}세 반`;
  if (/^(유치|유아|7세)/.test(s)) return "7세 반";

  // 한글 숫자 (일학년, 이학년 …)
  s = s.replace(/([일이삼사오육한두세네])학년/, (_m, k: string) => `${KOR_NUM[k]}학년`);

  const pre = /^예비/.test(s);
  if (pre) s = s.replace(/^예비/, "");

  // 학교급 + 숫자
  const m = s.match(/^(초등학교|초등학생|초등|초|elementary|e|중학교|중학생|중등|중|middle|m|고등학교|고등학생|고등|고|high|h)-?([1-6])(학년)?$/i);
  let level: "초" | "중" | "고" | null = null;
  let n: number | null = null;
  if (m) {
    const k = m[1].toLowerCase();
    level = k.startsWith("초") || k === "e" || k === "elementary" ? "초" : k.startsWith("중") || k === "m" || k === "middle" ? "중" : "고";
    n = Number(m[2]);
  } else {
    const num = s.match(/^([1-9]|1[0-2])(학년)?$/);
    if (num) {
      const v = Number(num[1]);
      const hint = levelFromSchool(school);
      if (hint && v <= MAX[hint]) { level = hint; n = v; }
      else if (v <= 6) { level = "초"; n = v; }
      else if (v <= 9) { level = "중"; n = v - 6; }
      else { level = "고"; n = v - 9; }
    }
  }

  if (!level || n == null || n < 1 || n > MAX[level]) return original;
  return pre ? prevGrade(level, n) : `${level}${n}`;
}

/** 학년 정렬 순서 (7세 반 0, 초1 1 … 고3 12, 그 밖 99) */
export function gradeOrder(g: string | null | undefined): number {
  const v = normalizeGrade(g);
  if (v.endsWith("세 반")) return 0;
  const i = (GRADE_OPTIONS as readonly string[]).indexOf(v);
  return i >= 0 ? i : 99;
}
