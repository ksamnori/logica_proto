// src/lib/hq/publishingRights.ts
// 출판사 실무 규칙 모음 (클라이언트·서버 공용 / 순수 함수)
//  - ISBN-13 체크디지트 검증 · 부가기호 해석
//  - 납본(국립중앙도서관, 발행일로부터 30일 이내) 기한 계산
//  - 출판 공정 단계 이동 전 체크리스트(Stage Gate)
//  - 출판권 존속기간(저작권법 제59조: 특약 없으면 최초 발행일부터 3년) 계산
//  - 인세 정산(정가 × 인세대상부수 × 인세율, 선인세 상계) 및 원천세(3.3% / 8.8%) 계산

import type {
  HqCompanySettings,
  HqContract,
  HqContractRightsMeta,
  HqPayrollRecord,
  HqPrintRunItem,
  HqPublication,
  HqPublicationMeta,
  HqPubStage,
  HqRightsScope,
  HqRoyaltyBasis,
  HqRoyaltySettleCycle,
} from "./types";

// ============================================================================
// 1. ISBN
// ============================================================================

export function normalizeIsbn(raw?: string | null): string {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^0-9X]/g, "");
}

export interface IsbnCheckResult {
  ok: boolean;
  empty: boolean;
  digits: string;
  message: string;
}

export function validateIsbn13(raw?: string | null): IsbnCheckResult {
  const digits = normalizeIsbn(raw);
  if (!digits) {
    return { ok: false, empty: true, digits, message: "ISBN 미입력" };
  }
  if (digits.length !== 13 || /X/.test(digits)) {
    return {
      ok: false,
      empty: false,
      digits,
      message: `ISBN-13은 숫자 13자리여야 합니다 (현재 ${digits.length}자리)`,
    };
  }
  if (!digits.startsWith("978") && !digits.startsWith("979")) {
    return {
      ok: false,
      empty: false,
      digits,
      message: "ISBN-13은 978 또는 979로 시작해야 합니다",
    };
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  if (check !== Number(digits[12])) {
    return {
      ok: false,
      empty: false,
      digits,
      message: `체크기호 불일치 (마지막 자리는 ${check}이어야 합니다)`,
    };
  }
  const isKorea = digits.startsWith("97889") || digits.startsWith("97911");
  return {
    ok: true,
    empty: false,
    digits,
    message: isKorea ? "유효한 ISBN (한국 발행)" : "유효한 ISBN",
  };
}

/**
 * 12자리(체크기호 제외) 입력 시 ISBN-13 체크기호를 자동 계산하여 완성하고,
 * 한국 표준 접두부(979-11, 978-89) 하이픈 표기로 정돈합니다.
 */
export function completeOrFormatIsbn13(raw?: string | null): string {
  const digitsOnly = String(raw || "").replace(/\D/g, "");
  if (digitsOnly.length < 12) return String(raw || "").trim();
  const base12 = digitsOnly.slice(0, 12);
  if (!base12.startsWith("978") && !base12.startsWith("979")) {
    return String(raw || "").trim();
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  const full13 = digitsOnly.length >= 13 ? digitsOnly.slice(0, 13) : `${base12}${check}`;
  if (full13.startsWith("97911") || full13.startsWith("97889")) {
    // 발행자 번호 자릿수는 출판사마다 2~6자리로 다르므로 이미 하이픈이 있으면 보존하고 체크기호만 보정
    const rawTrim = String(raw || "").trim();
    if (/^97[89]-\d{2}-\d+-\d+(?:-\d)?$/.test(rawTrim)) {
      const parts = rawTrim.split("-");
      if (parts.length === 4) return `${rawTrim}-${check}`;
      if (parts.length === 5 && digitsOnly.length === 12) {
        parts[4] = String(check);
        return parts.join("-");
      }
      return rawTrim;
    }
    return `${full13.slice(0, 3)}-${full13.slice(3, 5)}-${full13.slice(5, 9)}-${full13.slice(9, 12)}-${full13.slice(12)}`;
  }
  return full13;
}

export const ADDON_READER_OPTIONS: { code: string; label: string }[] = [
  { code: "6", label: "6 · 초등 학습참고서" },
  { code: "5", label: "5 · 중·고등 학습참고서" },
  { code: "7", label: "7 · 아동" },
  { code: "4", label: "4 · 청소년" },
  { code: "0", label: "0 · 교양" },
  { code: "1", label: "1 · 실용" },
  { code: "9", label: "9 · 전문" },
];

export const ADDON_FORM_OPTIONS: { code: string; label: string }[] = [
  { code: "3", label: "3 · 단행본" },
  { code: "4", label: "4 · 전집·시리즈(세트)" },
  { code: "5", label: "5 · 전자출판물(eBook)" },
  { code: "7", label: "7 · 그림책·만화" },
  { code: "8", label: "8 · 혼합자료(교구·부록)" },
];

export const ADDON_KDC_PRESETS: { code: string; label: string }[] = [
  { code: "410", label: "410 · 수학" },
  { code: "411", label: "411 · 산수·연산" },
  { code: "415", label: "415 · 기하학·도형" },
  { code: "400", label: "400 · 자연과학 일반" },
  { code: "370", label: "370 · 교육학" },
  { code: "004", label: "004 · 전산·정보과학" },
];

// 부가기호(5자리) = 독자대상(1) + 발행형태(1) + 내용분류 KDC(3)
const ADDON_READER: Record<string, string> = {
  "0": "교양",
  "1": "실용",
  "2": "여성",
  "4": "청소년",
  "5": "중·고등 학습참고서",
  "6": "초등 학습참고서",
  "7": "아동",
  "9": "전문",
};
const ADDON_FORM: Record<string, string> = {
  "0": "문고본",
  "1": "사전",
  "2": "신서판",
  "3": "단행본",
  "4": "전집·총서",
  "5": "전자출판물",
  "6": "도감",
  "7": "그림책·만화",
  "8": "혼합자료",
};
const ADDON_KDC: Record<string, string> = {
  "0": "총류",
  "1": "철학",
  "2": "종교",
  "3": "사회과학",
  "4": "자연과학",
  "5": "기술과학",
  "6": "예술",
  "7": "언어",
  "8": "문학",
  "9": "역사",
};

export function describeAddOnCode(code?: string | null): {
  ok: boolean;
  text: string;
} {
  const c = String(code || "").replace(/\D/g, "");
  if (!c) return { ok: false, text: "" };
  if (c.length !== 5) return { ok: false, text: "부가기호는 숫자 5자리입니다" };
  const reader = ADDON_READER[c[0]];
  const form = ADDON_FORM[c[1]];
  const kdc = ADDON_KDC[c[2]];
  if (!reader || !form) {
    return { ok: false, text: "독자대상/발행형태 기호가 올바르지 않습니다" };
  }
  const kdcText = c.slice(2) === "410" ? "수학" : kdc || "내용분류";
  return { ok: true, text: `${reader} · ${form} · ${kdcText}(${c.slice(2)})` };
}

// ============================================================================
// 2. 납본 · 날짜 유틸
// ============================================================================

export function addDaysIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
}

export function addYearsIso(dateStr: string, years: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const dt = new Date(y + years, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
}

export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

export const LEGAL_DEPOSIT_DAYS = 30;

export function getLegalDepositInfo(book: Pick<HqPublication, "stage" | "publish_date" | "pub_meta">): {
  required: boolean;
  done: boolean;
  dueDate: string | null;
  daysLeft: number | null;
  label: string;
} {
  const meta = book.pub_meta || {};
  const status = meta.legal_deposit_status || "NONE";
  if (book.stage !== "PUBLISHED" || !book.publish_date) {
    return { required: false, done: false, dueDate: null, daysLeft: null, label: "" };
  }
  if (status === "DONE") {
    return {
      required: true,
      done: true,
      dueDate: null,
      daysLeft: null,
      label: `납본 완료${meta.legal_deposit_date ? ` (${meta.legal_deposit_date})` : ""}`,
    };
  }
  const dueDate = addDaysIso(book.publish_date, LEGAL_DEPOSIT_DAYS);
  const left = daysUntil(dueDate);
  const label =
    status === "SUBMITTED"
      ? "납본 발송 · 수령확인 대기"
      : left === null
      ? "납본 필요"
      : left < 0
      ? `납본 기한 ${Math.abs(left)}일 경과`
      : `납본 D-${left}`;
  return { required: true, done: false, dueDate, daysLeft: left, label };
}

// ============================================================================
// 3. 판 · 쇄 표기
// ============================================================================

export function formatEditionLabel(edition: number, printing: number): string {
  const ed = edition <= 1 ? "초판" : `${edition}판`;
  return `${ed} ${Math.max(1, printing)}쇄`;
}

export function parseEditionLabel(label?: string | null): {
  edition: number;
  printing: number;
} {
  const s = String(label || "");
  let edition = 1;
  if (/개정/.test(s)) edition = 2;
  const edMatch = s.match(/(\d+)\s*판/);
  if (edMatch) edition = Math.max(1, Number(edMatch[1]));
  const prMatch = s.match(/(\d+)\s*쇄/);
  const printing = prMatch ? Math.max(1, Number(prMatch[1])) : 1;
  return { edition, printing };
}

export function getPrintHistory(book: Pick<HqPublication, "pub_meta">): HqPrintRunItem[] {
  const list = book.pub_meta?.print_history;
  return Array.isArray(list)
    ? [...list].sort(
        (a, b) => a.edition_no - b.edition_no || a.printing_no - b.printing_no
      )
    : [];
}

export function sumPrintedCopies(book: Pick<HqPublication, "pub_meta" | "print_run">): number {
  const hist = getPrintHistory(book);
  if (hist.length === 0) return Math.max(0, Number(book.print_run || 0));
  return hist.reduce((acc, h) => acc + Math.max(0, Number(h.copies || 0)), 0);
}

const isYmd = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function sanitizePrintRun(raw: any): HqPrintRunItem | null {
  if (!raw || typeof raw !== "object") return null;
  const edition = Math.max(1, Math.round(Number(raw.edition_no) || 1));
  const printing = Math.max(1, Math.round(Number(raw.printing_no) || 1));
  if (!isYmd(raw.print_date)) return null;
  return {
    id: String(raw.id || `pr-${edition}-${printing}-${raw.print_date}`).slice(0, 60),
    edition_no: edition,
    printing_no: printing,
    print_date: raw.print_date,
    copies: Math.max(0, Math.round(Number(raw.copies) || 0)),
    vendor: raw.vendor ? String(raw.vendor).slice(0, 80) : undefined,
    isbn: raw.isbn ? String(raw.isbn).slice(0, 20) : undefined,
    memo: raw.memo ? String(raw.memo).slice(0, 200) : undefined,
  };
}

/** API 입력값 정제 (hq_publication.pub_meta) */
export function sanitizePubMeta(raw: unknown): HqPublicationMeta {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, any>;
  const out: HqPublicationMeta = {};
  if (r.isbn_status === "NONE" || r.isbn_status === "APPLIED" || r.isbn_status === "ISSUED") {
    out.isbn_status = r.isbn_status;
  }
  if (isYmd(r.isbn_applied_at)) out.isbn_applied_at = r.isbn_applied_at;
  if (isYmd(r.isbn_issued_at)) out.isbn_issued_at = r.isbn_issued_at;
  if (typeof r.add_on_code === "string") out.add_on_code = r.add_on_code.replace(/\D/g, "").slice(0, 5);
  if (typeof r.set_isbn === "string") out.set_isbn = r.set_isbn.trim().slice(0, 24) || undefined;
  if (typeof r.ebook_isbn === "string") out.ebook_isbn = r.ebook_isbn.trim().slice(0, 24) || undefined;
  if (typeof r.cip_no === "string") out.cip_no = r.cip_no.trim().slice(0, 40);
  if (typeof r.colophon_checked === "boolean") out.colophon_checked = r.colophon_checked;
  if (typeof r.barcode_ready === "boolean") out.barcode_ready = r.barcode_ready;
  if (
    r.legal_deposit_status === "NONE" ||
    r.legal_deposit_status === "SUBMITTED" ||
    r.legal_deposit_status === "DONE"
  ) {
    out.legal_deposit_status = r.legal_deposit_status;
  }
  if (isYmd(r.legal_deposit_date)) out.legal_deposit_date = r.legal_deposit_date;
  if (Number.isFinite(Number(r.current_edition)) && r.current_edition !== undefined) {
    out.current_edition = Math.max(1, Math.round(Number(r.current_edition)));
  }
  if (Number.isFinite(Number(r.current_printing)) && r.current_printing !== undefined) {
    out.current_printing = Math.max(1, Math.round(Number(r.current_printing)));
  }
  if (Array.isArray(r.print_history)) {
    out.print_history = r.print_history
      .map(sanitizePrintRun)
      .filter((x: HqPrintRunItem | null): x is HqPrintRunItem => Boolean(x))
      .slice(0, 200);
  }
  return out;
}

// ============================================================================
// 4. 출판 공정 Stage Gate (다음 단계 이동 전 누락 점검)
// ============================================================================

const STAGE_ORDER: HqPubStage[] = [
  "PLANNING",
  "MANUSCRIPT",
  "EDITING",
  "DESIGN",
  "PROOF_FINAL",
  "PRINTING",
  "PUBLISHED",
];

export function stageIndex(stage: HqPubStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function isInHouseAuthor(authorName?: string | null): boolean {
  const n = String(authorName || "").trim();
  if (!n) return true;
  return /천종현수학연구소|편집부|연구소|연구진/.test(n);
}

export function contractMatchesBook(
  c: Pick<HqContract, "pub_id" | "book_title">,
  book: Pick<HqPublication, "pub_id" | "title">
): boolean {
  if (c.pub_id) return c.pub_id === book.pub_id;
  const a = String(c.book_title || "").replace(/\s+/g, "");
  const b = String(book.title || "").replace(/\s+/g, "");
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

export interface StageGateIssue {
  level: "BLOCK" | "WARN";
  text: string;
}

export function getStageGateIssues(
  book: HqPublication,
  nextStage: HqPubStage,
  linkedContracts: HqContract[]
): StageGateIssue[] {
  const issues: StageGateIssue[] = [];
  const idx = stageIndex(nextStage);
  const meta: HqPublicationMeta = book.pub_meta || {};
  const isbnCheck = validateIsbn13(book.isbn);
  const isbnStatus = meta.isbn_status || (isbnCheck.ok ? "ISSUED" : "NONE");

  const activeContracts = linkedContracts.filter(
    (c) => c.status !== "CANCELLED" && c.status !== "EXPIRED"
  );
  const signedRoyalty = activeContracts.filter(
    (c) => c.category === "ROYALTY" && c.status === "SIGNED"
  );
  const unsigned = activeContracts.filter(
    (c) =>
      (c.category === "ROYALTY" || c.category === "OUTSOURCING") &&
      c.status !== "SIGNED"
  );

  // 최종교열 단계 진입 시: ISBN 신청이 되어 있어야 판권면·바코드 작업 가능
  if (idx >= stageIndex("PROOF_FINAL") && isbnStatus === "NONE") {
    issues.push({
      level: "WARN",
      text: "ISBN 발행번호 신청 전입니다 (판권면·표지 바코드 반영을 위해 최종교열 전에 신청 권장)",
    });
  }

  if (idx >= stageIndex("PRINTING")) {
    if (!isbnCheck.ok) {
      issues.push({
        level: "BLOCK",
        text: isbnCheck.empty
          ? "ISBN이 아직 발급·입력되지 않았습니다"
          : `ISBN 오류: ${isbnCheck.message}`,
      });
    }
    if (meta.set_isbn && !validateIsbn13(meta.set_isbn).ok) {
      issues.push({
        level: "BLOCK",
        text: `세트 ISBN 오류: ${validateIsbn13(meta.set_isbn).message}`,
      });
    }
    if (meta.ebook_isbn && !validateIsbn13(meta.ebook_isbn).ok) {
      issues.push({
        level: "BLOCK",
        text: `전자책 ISBN 오류: ${validateIsbn13(meta.ebook_isbn).message}`,
      });
    }
    if (!meta.add_on_code) {
      issues.push({ level: "WARN", text: "부가기호(5자리)가 입력되지 않았습니다" });
    }
    if (!meta.colophon_checked) {
      issues.push({ level: "WARN", text: "판권면(발행일·판쇄·ISBN·정가) 최종 검수 체크가 없습니다" });
    }
    if (!meta.barcode_ready) {
      issues.push({ level: "WARN", text: "표지 ISBN 바코드 반영 체크가 없습니다" });
    }
    if (!isInHouseAuthor(book.author_name) && signedRoyalty.length === 0) {
      issues.push({
        level: "BLOCK",
        text: `외부 저자(${book.author_name}) 출판권 설정 계약이 체결되지 않았습니다 (저작권 분쟁 위험)`,
      });
    }
    if (unsigned.length > 0) {
      issues.push({
        level: "WARN",
        text: `서명 미완료 계약 ${unsigned.length}건: ${unsigned
          .map((c) => `${c.counterparty_name}(${c.status === "DRAFT" ? "임시저장" : "서명대기"})`)
          .join(", ")}`,
      });
    }
    if (!book.list_price || book.list_price <= 0) {
      issues.push({ level: "WARN", text: "정가가 입력되지 않았습니다 (판권면·인세 산정 기준)" });
    }
  }

  if (idx >= stageIndex("PUBLISHED")) {
    if (!book.publish_date) {
      issues.push({
        level: "WARN",
        text: "발행일이 비어 있어 오늘 날짜로 기록됩니다 (납본 30일 기한 기산일)",
      });
    }
    if (getPrintHistory(book).length === 0 && !(book.print_run > 0)) {
      issues.push({ level: "WARN", text: "인쇄 부수(쇄 이력)가 없습니다 (발행부수 기준 인세 산정 불가)" });
    }
  }

  return issues;
}

// ============================================================================
// 5. 출판권 · 저작권 약정
// ============================================================================

export const RIGHTS_SCOPE_LABELS: Record<HqRightsScope, string> = {
  PRINT_PUBLISH: "종이책 출판권",
  EBOOK_EXCLUSIVE: "전자책 배타적발행권",
  AUDIO: "오디오북",
  DERIVATIVE: "2차적저작물(강의·앱·문제DB)",
  OVERSEAS: "해외 번역출판 대리",
  COPYRIGHT_TRANSFER: "저작재산권 양도",
};

export const ROYALTY_BASIS_LABELS: Record<HqRoyaltyBasis, string> = {
  PRINT: "발행부수 기준 (쇄 발행 시 정산)",
  SALES: "판매부수 기준 (기간 마감 정산)",
};

export const SETTLE_CYCLE_LABELS: Record<HqRoyaltySettleCycle, string> = {
  PER_PRINTING: "쇄 발행 시마다",
  QUARTERLY: "분기별",
  HALF: "반기별",
  YEARLY: "연 1회",
};

export const DEFAULT_RIGHTS_META: Required<
  Pick<
    HqContractRightsMeta,
    | "deal_type"
    | "royalty_basis"
    | "settle_cycle"
    | "rights_scope"
    | "term_years"
    | "auto_renew"
    | "author_free_copies"
    | "royalty_free_copies"
    | "co_author_share_pct"
  >
> = {
  deal_type: "ROYALTY",
  royalty_basis: "PRINT",
  settle_cycle: "PER_PRINTING",
  rights_scope: ["PRINT_PUBLISH", "EBOOK_EXCLUSIVE"],
  term_years: 5,
  auto_renew: true,
  author_free_copies: 10,
  royalty_free_copies: 0,
  co_author_share_pct: 100,
};

export function withRightsDefaults(meta?: HqContractRightsMeta | null) {
  return { ...DEFAULT_RIGHTS_META, ...(meta || {}) };
}

const SCOPE_KEYS = Object.keys(RIGHTS_SCOPE_LABELS) as HqRightsScope[];

/** API 입력값 정제 (알 수 없는 키 제거 · 타입 보정) */
export function sanitizeRightsMeta(raw: unknown): HqContractRightsMeta {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: HqContractRightsMeta = {};
  if (r.deal_type === "ROYALTY" || r.deal_type === "FLAT_FEE") out.deal_type = r.deal_type;
  if (r.royalty_basis === "PRINT" || r.royalty_basis === "SALES") out.royalty_basis = r.royalty_basis;
  if (
    r.settle_cycle === "PER_PRINTING" ||
    r.settle_cycle === "QUARTERLY" ||
    r.settle_cycle === "HALF" ||
    r.settle_cycle === "YEARLY"
  ) {
    out.settle_cycle = r.settle_cycle;
  }
  if (Array.isArray(r.rights_scope)) {
    out.rights_scope = r.rights_scope.filter((s): s is HqRightsScope =>
      SCOPE_KEYS.includes(s as HqRightsScope)
    );
  }
  const num = (v: unknown, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : undefined;
  };
  const term = num(r.term_years, 70);
  if (term !== undefined) out.term_years = term;
  if (typeof r.auto_renew === "boolean") out.auto_renew = r.auto_renew;
  const afc = num(r.author_free_copies, 100000);
  if (afc !== undefined) out.author_free_copies = afc;
  const rfc = num(r.royalty_free_copies, 1000000);
  if (rfc !== undefined) out.royalty_free_copies = rfc;
  if (r.co_author_share_pct !== undefined && Number.isFinite(Number(r.co_author_share_pct))) {
    out.co_author_share_pct = Math.min(100, Math.max(0.1, Math.round(Number(r.co_author_share_pct) * 100) / 100));
  }
  if (typeof r.note === "string") out.note = r.note.slice(0, 500);
  return out;
}

/** 저작권법 제59조: 출판권 존속기간은 특약이 없으면 맨 처음 발행한 날부터 3년 */
export const STATUTORY_PUBLISH_RIGHT_YEARS = 3;

export function computeRightsExpiry(
  c: Pick<HqContract, "end_date" | "start_date" | "rights_meta" | "category">,
  book?: Pick<HqPublication, "publish_date" | "pub_meta"> | null
): { expiryDate: string | null; basis: string; daysLeft: number | null } {
  if (c.end_date) {
    return { expiryDate: c.end_date, basis: "계약서 종료일", daysLeft: daysUntil(c.end_date) };
  }
  const meta = c.rights_meta || {};
  if (meta.rights_scope?.includes("COPYRIGHT_TRANSFER") || c.category === "OUTSOURCING") {
    return { expiryDate: null, basis: "저작재산권 양도 (기간 없음)", daysLeft: null };
  }
  const firstPrint = getPrintHistory(book || { pub_meta: null })[0]?.print_date;
  const startBase = firstPrint || book?.publish_date || null;
  const years = meta.term_years && meta.term_years > 0 ? meta.term_years : STATUTORY_PUBLISH_RIGHT_YEARS;
  if (!startBase) {
    return {
      expiryDate: null,
      basis: `최초 발행일부터 ${years}년 (미발행)`,
      daysLeft: null,
    };
  }
  const exp = addYearsIso(startBase, years);
  return {
    expiryDate: exp,
    basis: `최초 발행일 ${startBase} + ${years}년${meta.term_years ? "" : " (법정 기본값)"}`,
    daysLeft: daysUntil(exp),
  };
}

// ============================================================================
// 6. 원천세 (사업소득 3.3% / 기타소득 8.8%)
// ============================================================================

export type WithholdingMode = "BIZ_33" | "OTHER_88";

export function calcWithholding(
  gross: number,
  mode: WithholdingMode
): { incomeTax: number; localIncomeTax: number; total: number; note: string } {
  const g = Math.max(0, Math.round(Number(gross) || 0));
  const floor10 = (n: number) => Math.floor(n / 10) * 10;
  let incomeTax = 0;
  let note = "";
  if (mode === "OTHER_88") {
    // 필요경비 60% → 기타소득금액 40% × 20%. 기타소득금액 5만원 이하(지급액 125,000원 이하) 과세최저한
    if (g <= 125_000) {
      note = "기타소득 과세최저한(지급액 12.5만원 이하) 비과세";
    } else {
      incomeTax = floor10(g * 0.08);
      note = "기타소득 8.8% (필요경비 60% 공제 후 22%)";
    }
  } else {
    incomeTax = floor10(g * 0.03);
    note = "사업소득 3.3% (소득세 3% + 지방소득세 0.3%)";
  }
  // 소득세법 제86조 소액부징수: 원천징수세액 1,000원 미만은 징수하지 않음
  if (incomeTax > 0 && incomeTax < 1_000) {
    incomeTax = 0;
    note = "소액부징수 (소득세 1,000원 미만)";
  }
  const localIncomeTax = floor10(incomeTax * 0.1);
  return { incomeTax, localIncomeTax, total: incomeTax + localIncomeTax, note };
}

// ============================================================================
// 7. 인세 정산
// ============================================================================

export interface RoyaltyCalcInput {
  listPrice: number;
  copies: number;
  freeCopies?: number;
  ratePct: number;
  advanceTotal: number;
  advanceRecoupedSoFar: number;
}

export interface RoyaltyCalcResult {
  royaltyCopies: number;
  grossRoyalty: number;
  recoupNow: number;
  payable: number;
  advanceRemainingBefore: number;
  advanceRemainingAfter: number;
}

export function computeRoyaltySettlement(input: RoyaltyCalcInput): RoyaltyCalcResult {
  const price = Math.max(0, Math.round(Number(input.listPrice) || 0));
  const copies = Math.max(0, Math.round(Number(input.copies) || 0));
  const free = Math.max(0, Math.round(Number(input.freeCopies) || 0));
  const royaltyCopies = Math.max(0, copies - free);
  const rate = Math.max(0, Number(input.ratePct) || 0);
  const grossRoyalty = Math.floor((price * royaltyCopies * rate) / 100);
  const remainingBefore = Math.max(
    0,
    Math.round(Number(input.advanceTotal) || 0) -
      Math.round(Number(input.advanceRecoupedSoFar) || 0)
  );
  const recoupNow = Math.min(remainingBefore, grossRoyalty);
  return {
    royaltyCopies,
    grossRoyalty,
    recoupNow,
    payable: grossRoyalty - recoupNow,
    advanceRemainingBefore: remainingBefore,
    advanceRemainingAfter: remainingBefore - recoupNow,
  };
}

/** hq_payroll.calc_meta 에 기록되는 인세 원장 키 */
export interface RoyaltyLedgerMeta {
  royalty_kind?: "ADVANCE" | "SETTLEMENT";
  contract_id?: string;
  pub_id?: string | null;
  period_label?: string;
  basis?: HqRoyaltyBasis;
  printing_label?: string;
  copies?: number;
  free_copies?: number;
  royalty_copies?: number;
  bookPrice?: number;
  salesCopies?: number;
  royaltyPct?: number;
  gross_royalty?: number;
  advance_recouped?: number;
  advanceDeduct?: number;
  royalty_tax_mode?: WithholdingMode;
}

export function newClientId(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// 8. 원천징수 신고 · 간이지급명세서용 소득 구분/필요경비 해석
// ============================================================================

export interface ExternalWithholdingSummary {
  mode: WithholdingMode;
  shortBadge: string;
  ledgerLabel: string;
  hometaxCodeHint: string;
  grossAmount: number;
  necessaryExpense: number; // 기타소득 필요경비(60%), 사업소득은 0
  taxableIncome: number; // 과세소득금액(기타소득 40%, 사업소득 100%)
  nominalRateText: string;
  incomeTax: number;
  localIncomeTax: number;
  withholdingTotal: number;
  netAmount: number;
  taxExemptionNote: string;
}

export function describeExternalWithholdingRecord(
  r: Pick<
    HqPayrollRecord,
    | "pay_type"
    | "gross_amount"
    | "income_tax"
    | "local_income_tax"
    | "net_amount"
    | "calc_meta"
  >
): ExternalWithholdingSummary {
  const gross = Math.max(0, Math.round(Number(r.gross_amount || 0)));
  const isOther88 =
    r.pay_type === "OTHER_88" ||
    (r.pay_type === "ROYALTY" && r.calc_meta?.royalty_tax_mode === "OTHER_88");
  const mode: WithholdingMode = isOther88 ? "OTHER_88" : "BIZ_33";
  const necessaryExpense = isOther88 ? Math.round(gross * 0.6) : 0;
  const taxableIncome = Math.max(0, gross - necessaryExpense);
  const incomeTax = Math.max(0, Math.round(Number(r.income_tax || 0)));
  const localIncomeTax = Math.max(0, Math.round(Number(r.local_income_tax || 0)));
  const withholdingTotal = incomeTax + localIncomeTax;
  const netAmount = Math.max(0, Math.round(Number(r.net_amount ?? gross - withholdingTotal)));

  const shortBadge =
    r.pay_type === "ROYALTY"
      ? isOther88
        ? "저자인세(기타 8.8%)"
        : "저자인세(사업 3.3%)"
      : isOther88
      ? "기타소득 8.8%"
      : "외주 사업 3.3%";

  const ledgerLabel =
    r.pay_type === "ROYALTY"
      ? isOther88
        ? "저자인세 · 기타소득(8.8%)"
        : "저자인세 · 사업소득(3.3%)"
      : isOther88
      ? "원고·검토 · 기타소득(8.8%)"
      : "외주용역 · 사업소득(3.3%)";

  const hometaxCodeHint =
    r.pay_type === "ROYALTY"
      ? isOther88
        ? "기타소득(저작자 외 원고료·인세, 필요경비 60%)"
        : "거주자 사업소득(저술·작가 940100 등)"
      : isOther88
      ? "기타소득(원고료·자문·심사료, 필요경비 60%)"
      : "거주자 사업소득(디자인·조판·출판외주 940909 등)";

  let taxExemptionNote = "";
  if (gross > 0 && incomeTax === 0) {
    if (isOther88 && gross <= 125_000) {
      taxExemptionNote = "과세최저한(기타소득금액 5만원 이하 · 지급액 12.5만원 이하) 비과세";
    } else {
      taxExemptionNote = "소액부징수(원천징수 소득세 1,000원 미만 면제)";
    }
  }

  return {
    mode,
    shortBadge,
    ledgerLabel,
    hometaxCodeHint,
    grossAmount: gross,
    necessaryExpense,
    taxableIncome,
    nominalRateText: isOther88
      ? "소득세 20% + 지방세 2% (필요경비 60% 차감 후 실효 8.8%)"
      : "소득세 3.0% + 지방소득세 0.3% (합계 3.3%)",
    incomeTax,
    localIncomeTax,
    withholdingTotal,
    netAmount,
    taxExemptionNote,
  };
}

// ============================================================================
// 9. 판권면(Colophon) 표준 문안 생성기 (인디자인 편집 붙여넣기용)
// ============================================================================

function formatKoreanDate(ymd?: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "20XX년 X월 X일";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

export function buildColophonText(params: {
  title: string;
  subtitle?: string | null;
  editionInfo?: string | null;
  publishDate?: string | null;
  authorName?: string | null;
  editorName?: string | null;
  designerName?: string | null;
  printVendor?: string | null;
  isbn?: string | null;
  addOnCode?: string | null;
  setIsbn?: string | null;
  ebookIsbn?: string | null;
  cipNo?: string | null;
  listPrice?: number;
  printHistory?: HqPrintRunItem[];
  company?: Partial<HqCompanySettings> | null;
}): string {
  const hist = params.printHistory || [];
  const firstRun = hist[0];
  const latestRun = hist[hist.length - 1];
  const pubName = params.company?.company_name || "(주)천종현수학연구소";
  const ceo = params.company?.ceo_names?.[0] || "천종현";
  const addr = params.company?.address || "";
  const phone = params.company?.phone || "";
  const edLabel = (params.editionInfo || "초판 1쇄").trim();

  const lines: string[] = [];
  lines.push(
    params.subtitle ? `${params.title} — ${params.subtitle}` : params.title || "(도서명)"
  );
  lines.push("");

  if (firstRun && latestRun && firstRun.id !== latestRun.id) {
    lines.push(
      `${formatEditionLabel(firstRun.edition_no, firstRun.printing_no)} 발행  ${formatKoreanDate(
        firstRun.print_date
      )}`
    );
    lines.push(
      `${formatEditionLabel(latestRun.edition_no, latestRun.printing_no)} 발행  ${formatKoreanDate(
        latestRun.print_date
      )}`
    );
  } else {
    lines.push(`${edLabel} 발행  ${formatKoreanDate(params.publishDate || firstRun?.print_date)}`);
  }

  lines.push(`지은이  ${params.authorName || pubName}`);
  lines.push(`펴낸이  ${ceo}`);
  lines.push(`펴낸곳  ${pubName}`);
  if (params.editorName) lines.push(`편  집  ${params.editorName}`);
  if (params.designerName) lines.push(`디자인  ${params.designerName}`);
  if (params.printVendor) lines.push(`인쇄·제본  ${params.printVendor}`);
  if (addr) lines.push(`주  소  ${addr}`);
  if (phone) lines.push(`전  화  ${phone}`);
  lines.push("");

  const addOn = params.addOnCode ? ` ${params.addOnCode}` : "";
  lines.push(`ISBN ${params.isbn || "979-11-XXXX-XXX-X"}${addOn}`);
  if (params.setIsbn) lines.push(`ISBN ${params.setIsbn} (세트)`);
  if (params.ebookIsbn) lines.push(`ISBN ${params.ebookIsbn} (전자책)`);
  if (params.cipNo) lines.push(`CIP 제어번호 ${params.cipNo}`);
  lines.push(
    `정가 ${(params.listPrice || 0) > 0 ? `${Number(params.listPrice).toLocaleString("ko-KR")}원` : "별도 표기"}`
  );
  lines.push("");
  lines.push(
    "이 책의 저작권은 저작권자 및 발행처에 있습니다. 서면 허락 없이 무단 복제·전재·스캔 배포를 금합니다."
  );
  lines.push("파본이나 잘못 만들어진 책은 구입하신 곳에서 교환해 드립니다.");
  return lines.join("\n");
}
