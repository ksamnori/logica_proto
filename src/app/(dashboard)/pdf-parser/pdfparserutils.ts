// src/app/(dashboard)/pdf-parser/pdfParserUtils.ts

export const generateUUID = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const TARGET_FIELDS = [
  "question",
  "question_2",
  "answer",
  "step_1_concept",
  "step_2_approach",
  "step_3_process",
  "step_4_conclusion",
] as const;

export type TargetFieldKey = (typeof TARGET_FIELDS)[number];

export const ALLOWED_DIFFICULTIES = ["최상", "상", "중", "하", "최하"] as const;

export const INTEGRATED_PROBLEM_TYPES = [
  "MULTIPLE_CHOICE",
  "SUBJECTIVE",
  "DESCRIPTIVE",
  "대표 문제",
  "유사 문제",
  "연습 문제",
  "도전 문제",
  "문제 해결 전략 탐구",
  "일반",
  "기타",
];

export const COGNITIVE_LEVEL_OPTIONS = [
  "이해 및 연산",
  "적용 및 응용",
  "추론 및 문제 해결",
  "미지정",
];

// =========================================================
// Phase 2: 학년·학기 Prefix 범위 확장 엔진 (V4.4.0 100% 호환)
// =========================================================
export const ALL_SEMESTER_PREFIXES = [
  "E11", "E12", "E21", "E22", "E31", "E32",
  "E41", "E42", "E51", "E52", "E61", "E62",
  "M11", "M12", "M21", "M22", "M31", "M32",
  "H11", "H12", "H21", "H22", "H31", "H32",
];

export function normalizeBoundToken(token: string, isEnd = false): string {
  const t = token.trim().toUpperCase();
  if (/^[EMH][1-6][1-2]$/.test(t)) return t;
  const mGrade = t.match(/^([EMH])([1-6])$/);
  if (mGrade) {
    return `${mGrade[1]}${mGrade[2]}${isEnd ? "2" : "1"}`;
  }
  if (t === "E") return isEnd ? "E62" : "E11";
  if (t === "M") return isEnd ? "M32" : "M11";
  if (t === "H") return isEnd ? "H32" : "H11";
  return t;
}

export function expandPrefixSpec(specStr: string): string[] {
  if (!specStr || !specStr.trim()) return [];
  const result: string[] = [];
  const parts = specStr
    .split(/,+/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (part.includes("~") || part.includes("-")) {
      const sep = part.includes("~") ? "~" : "-";
      const idxSep = part.indexOf(sep);
      const b0 = part.slice(0, idxSep).trim();
      const b1 = part.slice(idxSep + 1).trim();
      if (b0 && b1) {
        const startTok = normalizeBoundToken(b0, false);
        const endTok = normalizeBoundToken(b1, true);
        const idx1 = ALL_SEMESTER_PREFIXES.indexOf(startTok);
        const idx2 = ALL_SEMESTER_PREFIXES.indexOf(endTok);
        if (idx1 !== -1 && idx2 !== -1) {
          const lo = Math.min(idx1, idx2);
          const hi = Math.max(idx1, idx2);
          for (let i = lo; i <= hi; i++) {
            const p = ALL_SEMESTER_PREFIXES[i];
            if (!result.includes(p)) result.push(p);
          }
          continue;
        }
      }
    }
    const normalizedSingle = normalizeBoundToken(part, false);
    const normalizedEnd = normalizeBoundToken(part, true);
    if (
      normalizedSingle !== normalizedEnd &&
      ALL_SEMESTER_PREFIXES.includes(normalizedSingle) &&
      ALL_SEMESTER_PREFIXES.includes(normalizedEnd)
    ) {
      const idx1 = ALL_SEMESTER_PREFIXES.indexOf(normalizedSingle);
      const idx2 = ALL_SEMESTER_PREFIXES.indexOf(normalizedEnd);
      for (let i = Math.min(idx1, idx2); i <= Math.max(idx1, idx2); i++) {
        const p = ALL_SEMESTER_PREFIXES[i];
        if (!result.includes(p)) result.push(p);
      }
      continue;
    }
    const tok = part.trim().toUpperCase();
    if (tok && !result.includes(tok)) result.push(tok);
  }
  return result;
}

export function matchesAnyPrefix(codeVal: string | null | undefined, prefixes: string[]): boolean {
  const c = String(codeVal || "").trim().toUpperCase();
  if (!c) return false;
  return prefixes.some((p) => c.startsWith(p.toUpperCase()));
}

// =========================================================
// Phase 1 & V302: 무적의 텍스트/수식 정제 엔진 & 18종 마법 도구
// =========================================================
export function applySafeCleaner(text: string | null | undefined): string {
  if (!text || typeof text !== "string") return text || "";
  let cleaned = text.replace(/@@/g, "\\").replace(/<\{/g, "{").replace(/\}>/g, "}");
  cleaned = cleaned.replace(/\xa0/g, " ").replace(/\u200b/g, "");
  cleaned = cleaned.replace(/∠/g, "\\angle ").replace(/°/g, "^{\\circ}");
  cleaned = cleaned.replace(/\\?degree\b/g, "^{\\circ}");
  return cleaned.trim();
}

export function fixJsonEscapes(text: string | null | undefined): string {
  if (!text) return text || "";
  let res = text
    .replace(/\x0c/g, "\\f")
    .replace(/\x08/g, "\\b")
    .replace(/\x0b/g, "\\v")
    .replace(/\x07/g, "\\a")
    .replace(/♀/g, "\\f");
  res = res.replace(/(?<![a-zA-Z\\])rac\s*\{/g, "\\frac{");
  return res;
}

const UNICODE_TO_LATEX: Record<string, string> = {
  "□": "\\square",
  "■": "\\blacksquare",
  "★": "\\star",
  "♥": "\\heartsuit",
  "♡": "\\heartsuit",
  "○": "\\bigcirc",
  "●": "\\bullet",
  "△": "\\triangle",
  "▲": "\\blacktriangle",
  "⊙": "\\odot",
  "◊": "\\lozenge",
  "◇": "\\diamond",
  "▶": "\\blacktriangleright",
  "▷": "\\triangleright",
  "◀": "\\blacktriangleleft",
  "◁": "\\triangleleft",
  "▼": "\\blacktriangledown",
  "▽": "\\triangledown",
  "⟹": "\\implies",
  "⇒": "\\Rightarrow",
  "→": "\\rightarrow",
  "←": "\\leftarrow",
  "⟺": "\\iff",
  "÷": "\\div",
  "×": "\\times",
};

const NUM_CIRCLE_MAP: Record<string, string> = {
  "1": "①",
  "2": "②",
  "3": "③",
  "4": "④",
  "5": "⑤",
  "6": "⑥",
  "7": "⑦",
  "8": "⑧",
  "9": "⑨",
  "10": "⑩",
  "11": "⑪",
  "12": "⑫",
  "13": "⑬",
  "14": "⑭",
  "15": "⑮",
};

export function cleanLatex(input: string | null | undefined): string {
  if (!input || typeof input !== "string") return input || "";
  let text = input;

  // 백슬래시가 날아간 ext{ } 복구 및 빈 껍데기 제거
  text = text.replace(/(?:\t|\\t| )?ext\s*\{/g, "\\text{");
  text = text.replace(/\\text\s*\{\s*\}/g, " ");
  text = text.replace(/\\text\s*\{÷\}/g, "\\div");
  text = text.replace(/\\text\s*\{×\}/g, "\\times");
  text = text.replace(/\\text\s*\{=\}/g, "=");

  // 탭(\t)으로 변환되어 날아간 imes 및 extdiv 구출
  text = text.replace(/(?<![a-zA-Z\\])imes(?![a-zA-Z])/g, "\\times");
  text = text.replace(/(?<![a-zA-Z\\])extdiv(?![a-zA-Z])/g, "\\div");

  text = fixJsonEscapes(text);
  text = text.replace(/ *(?=\n)/g, "  ");

  for (const [k, v] of Object.entries(NUM_CIRCLE_MAP)) {
    text = text
      .replaceAll(`\\num{${k}}`, v)
      .replaceAll(`\\num {${k}}`, v)
      .replaceAll(`\\circled{${k}}`, v)
      .replaceAll(`\\circled {${k}}`, v);
  }

  text = text
    .replaceAll("\\square", "□")
    .replaceAll("\\frac", "\\dfrac")
    .replaceAll("\\ddfrac", "\\dfrac")
    .replaceAll("\\textdiv", "\\div")
    .replaceAll("\\textbraceleft", "\\{")
    .replaceAll("\\textbraceright", "\\}")
    .replaceAll("\\textcdots", "\\cdots")
    .replaceAll("\\textcdot", "\\cdot")
    .replaceAll("\\textcircled{*}", "\\circledast")
    .replaceAll("\\boldsysbol", "\\mathbf")
    .replaceAll("\\boldsymbol", "\\mathbf")
    .replaceAll("\\textellipsis", "\\dots")
    .replaceAll("(::", "(\\because ")
    .replaceAll("::", "\\therefore ")
    .replaceAll("₩", "\\");

  text = text.replace(/\\abs\s*\{\s*([^{}]+)\s*\}/g, "|$1|");
  text = text.replace(/\\abs\s*([a-zA-Z0-9가-힣])/g, "|$1|");
  text = text.replaceAll("\\abs", "|");

  text = text.replace(/\^(\d{2,})/g, "^{$1}");
  text = text.replace(/\$\{4,\}/g, "$$").replaceAll("$$$", "$$");
  text = text.replace(/(\$\$?)\s*(\d+\.)(?=\s)/g, "$1  \n  \n$2");

  const mathPattern = /(\$\$[\s\S]+?\$\$|\$(?:(?!\n\n)(?:\\\$|[^$]))+\$|\\begin\{[a-zA-Z*]+\}[\s\S]*?\\end\{[a-zA-Z*]+\})/g;
  const parts = text.split(mathPattern);

  for (let i = 1; i < parts.length; i += 2) {
    let m = parts[i];
    for (const [ch, latex] of Object.entries(UNICODE_TO_LATEX)) {
      m = m.replaceAll(ch, latex);
    }
    if (m.startsWith("$$") && m.endsWith("$$")) {
      let inner = m.slice(2, -2);
      let prevInner = "";
      while (prevInner !== inner) {
        prevInner = inner;
        inner = inner.replace(/\\+text\s*\{\s*([^{}]*)\s*\}/g, "$1");
      }
      inner = inner.replace(/([ \t]*[가-힣ㄱ-ㅎㅏ-ㅣ][가-힣ㄱ-ㅎㅏ-ㅣ \t.,!?~]*[ \t]*)/g, "\\text{$1}");
      m = `$$${inner}$$`;
    } else if (m.startsWith("$") && m.endsWith("$")) {
      let inner = m.slice(1, -1);
      if (!/^\s*[가-힣ㄱ-ㅎㅏ-ㅣ]+\s*$/.test(inner)) {
        let prevInner = "";
        while (prevInner !== inner) {
          prevInner = inner;
          inner = inner.replace(/\\+text\s*\{\s*([^{}]*)\s*\}/g, "$1");
        }
        inner = inner.replace(/([ \t]*[가-힣ㄱ-ㅎㅏ-ㅣ][가-힣ㄱ-ㅎㅏ-ㅣ \t.,!?~]*[ \t]*)/g, "\\text{$1}");
        m = `$${inner}$`;
      }
    }
    parts[i] = m;
  }

  return parts.join("").trim();
}

export function resetDollarAndText(text: string | null | undefined): string {
  if (!text) return "";
  let raw = text.replaceAll("$", "");
  let prev = "";
  while (prev !== raw) {
    prev = raw;
    raw = raw.replace(/\\+text\s*\{\s*([^{}]*)\s*\}/g, "$1");
  }
  return raw;
}

export function forceInsertDfracDollar(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(
    /(?<!\$)(\\dfrac\s*\{(?:[^{}]|\{[^{}]*\})*\}\s*\{(?:[^{}]|\{[^{}]*\})*\})(?!\$)/g,
    "$$$1$$"
  );
}

export function safeWrapMathSymbol(text: string | null | undefined, symbol: string): string {
  if (!text) return "";
  const mathPattern = /(\$\$[\s\S]+?\$\$|\$(?:(?!\n\n)(?:\\\$|[^$]))+\$|\\begin\{[a-zA-Z*]+\}[\s\S]*?\\end\{[a-zA-Z*]+\})/g;
  const parts = text.split(mathPattern);
  const re = new RegExp(`(?<!\\$)\\\\${symbol}(?!\\$)`, "g");
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(re, `$\\${symbol}$`);
  }
  return parts.join("");
}

export const forceInsertDivDollar = (t: string) => safeWrapMathSymbol(t, "div");
export const forceInsertTimesDollar = (t: string) => safeWrapMathSymbol(t, "times");
export const forceInsertBigcircDollar = (t: string) => safeWrapMathSymbol(t, "bigcirc");
export const forceInsertRightarrowDollar = (t: string) => safeWrapMathSymbol(t, "rightarrow");
export const forceInsertAngleDollar = (t: string) => safeWrapMathSymbol(t, "angle");
export const forceInsertTriangleDollar = (t: string) => safeWrapMathSymbol(t, "triangle");

export function forceInsertUnitDollar(text: string | null | undefined): string {
  if (!text) return "";
  const mathPattern = /(\$\$[\s\S]+?\$\$|\$(?:(?!\n\n)(?:\\\$|[^$]))+\$|\\begin\{[a-zA-Z*]+\}[\s\S]*?\\end\{[a-zA-Z*]+\})/g;
  const parts = text.split(mathPattern);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/(?<!\$)(cm\^2|m\^2|mm\^2|cm\^3|m\^3|mm\^3)(?!\$)/g, "$$$1$$");
  }
  return parts.join("");
}

export function forceInsertDotDollar(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(
    /(?<!\$)(?<!\d)(-?\d+\.(?:\d|\\d?dot\s*\{?\s*\d\s*\}?|\\cdots)+)(?!\$)/g,
    "$$$1$$"
  );
}

export function convertSlashToDfrac(text: string | null | undefined): string {
  if (!text) return "";
  let res = text.replace(/\$\s*(\d+)\s*\/\s*(\d+)\s*\$/g, "$\\dfrac{$1}{$2}$");
  res = res.replace(/(?<!\$)(\d+)(?:와|과)\s*(\d+)\s*\/\s*(\d+)(?!\$)/g, "$$$1\\dfrac{$2}{$3}$$");
  res = res.replace(/(?<!\$)(?<!\d)(\d+)\s*\/\s*(\d+)(?!\d)(?!\$)/g, "$\\dfrac{$1}{$2}$");
  return res;
}

export function autoWrapNakedMath(text: string | null | undefined): string {
  if (!text) return "";
  let res = fixJsonEscapes(text);
  res = res.replace(
    /(?<!\$)(\\d?frac\s*\{(?:[^{}]|\{[^{}]*\})*\}\s*\{(?:[^{}]|\{[^{}]*\})*\})(?!\$)/g,
    "$$$1$$"
  );
  res = res.replaceAll("\\frac", "\\dfrac").replaceAll("\\ddfrac", "\\dfrac");
  for (let i = 0; i < 3; i++) {
    res = res.replace(/(?<!\$)\$([^$]+)\$[ \t]*\$([^$]+)\$(?!\$)/g, "$$$1 $2$$");
  }
  return res;
}

export function fixLeftRightBraces(text: string | null | undefined): string {
  if (!text) return "";
  return text.replaceAll("\\left{", "\\left\\{").replaceAll("\\right}", "\\right\\}");
}

export function removeExcessiveNewlines(text: string | null | undefined): string {
  if (!text) return "";
  return text.replaceAll("\xa0", " ").replace(/\n[ \t]*\n+/g, "\n").trim();
}

export function forceInsertThereforeDollar(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/(?<!\$)\\therefore/g, "$\\therefore");
}

export function fixCircledNumbers(text: string | null | undefined): string {
  if (!text) return "";
  let res = text;
  const map: Record<string, string> = {
    "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤",
    "6": "⑥", "7": "⑦", "8": "⑧", "9": "⑨", "10": "⑩",
  };
  for (const [k, v] of Object.entries(map)) {
    res = res.replace(new RegExp(`\\\\circled\\s*\\{\\s*${k}\\s*\\}`, "g"), v);
    res = res.replace(new RegExp(`\\\\textcircled\\s*\\{\\s*${k}\\s*\\}`, "g"), v);
  }
  return res;
}

export function forceRemoveNDebris(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replaceAll("\\n", "")
    .replace(/\$\s+\$/g, "")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function runFiveCombo(text: string | null | undefined): string {
  if (!text) return "";
  let res = resetDollarAndText(text);
  res = forceInsertDfracDollar(res);
  res = forceInsertDivDollar(res);
  res = forceInsertTimesDollar(res);
  res = forceInsertDotDollar(res);
  return res;
}

// =========================================================
// Phase 1·2·V302: 완벽 동기화 정렬 (sort_db_key) 및 question_db 정규화
// =========================================================
export function sortDbKey(item: any): [number, number, number, number, number] {
  let pVal = item?.detected_page_num;
  if (pVal === null || pVal === undefined || String(pVal).trim() === "") {
    pVal = item?.final_printed_page;
  }
  const p = parseInt(String(pVal), 10);
  const safeP = isNaN(p) ? 9999 : p;

  const qStr = String(item?.question_number || "");
  const qMatch = qStr.match(/\d+/);
  const qNum = qMatch ? parseInt(qMatch[0], 10) : 9999;

  const weight = qStr.includes("확인") ? 1 : 0;

  const sVal = parseInt(String(item?.sub_num ?? 0), 10);
  const safeS = isNaN(sVal) ? 0 : sVal;

  const ssVal = parseInt(String(item?.sub_sub_num ?? 0), 10);
  const safeSs = isNaN(ssVal) ? 0 : ssVal;

  return [safeP, qNum, weight, safeS, safeSs];
}

export function sortProblemsList<T>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ka = sortDbKey(a);
    const kb = sortDbKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  });
}

export function normalizeDifficultyForDb(val: any): string {
  if (!val) return "중";
  const s = String(val).trim();
  if (s === "중상") return "상";
  if (s === "중하") return "중";
  if ((ALLOWED_DIFFICULTIES as readonly string[]).includes(s)) return s;
  return "중";
}

export function autoInferProblemType(qText: string, q2Text: string, ansText: string, currentPt?: string | null): string {
  if (currentPt && ["MULTIPLE_CHOICE", "SUBJECTIVE", "DESCRIPTIVE"].includes(currentPt)) {
    return currentPt;
  }
  const fullQ = `${qText || ""}\n${q2Text || ""}`;
  const ans = String(ansText || "").trim();
  if (/[①②③④⑤]/.test(fullQ) && /[①②③④⑤]/.test(ans)) {
    return "MULTIPLE_CHOICE";
  }
  if (
    /풀이\s*과정|설명하세요|설명하시오|방정식을\s*세우고/.test(fullQ) ||
    ans === "해설 참조"
  ) {
    return "DESCRIPTIVE";
  }
  if (currentPt && !["일반", "유사", "쌍둥이", "None", "null", ""].includes(currentPt)) {
    return currentPt;
  }
  return "SUBJECTIVE";
}

export function normalizeRecordForQuestionDb(raw: any, fallbackBookTitle = ""): any {
  const rec = { ...raw };

  if (!rec.question_id) {
    rec.question_id = rec.id || generateUUID();
  }

  rec.question = rec.question !== undefined && rec.question !== null ? String(rec.question) : String(rec.questionText || "");
  const q2Val = rec.question_2 !== undefined ? rec.question_2 : rec.questionText2;
  rec.question_2 = q2Val && String(q2Val).trim() !== "" ? String(q2Val) : null;

  rec.difficulty = normalizeDifficultyForDb(rec.difficulty);

  const probVal = rec.solving_probability;
  if (probVal === null || probVal === undefined || String(probVal).trim() === "" || String(probVal) === "None") {
    rec.solving_probability = 50;
  } else {
    const parsed = parseInt(String(probVal), 10);
    rec.solving_probability = isNaN(parsed) ? 50 : Math.max(5, Math.min(100, parsed));
  }

  for (const k of ["sub_num", "sub_sub_num"] as const) {
    const v = rec[k];
    const parsed = parseInt(String(v ?? 0), 10);
    rec[k] = isNaN(parsed) ? 0 : parsed;
  }

  const fpp = rec.final_printed_page ?? rec.pageNum;
  if (fpp !== null && fpp !== undefined && String(fpp).trim() !== "") {
    rec.final_printed_page = String(fpp).trim().slice(0, 20);
    if (rec.detected_page_num === null || rec.detected_page_num === undefined) {
      const m = rec.final_printed_page.match(/\d+/);
      if (m) rec.detected_page_num = parseInt(m[0], 10);
    }
  } else {
    rec.final_printed_page = null;
  }

  const dpn = rec.detected_page_num;
  if (dpn !== null && dpn !== undefined && String(dpn).trim() !== "") {
    const parsed = parseInt(String(dpn), 10);
    rec.detected_page_num = isNaN(parsed) ? 1 : parsed;
  } else {
    rec.detected_page_num = 1;
  }

  const qn = rec.question_number ?? rec.qNum;
  rec.question_number = qn !== null && qn !== undefined && String(qn).trim() !== "" ? String(qn).trim().slice(0, 20) : "1";

  rec.problem_type = autoInferProblemType(rec.question, rec.question_2 || "", rec.answer || "", rec.problem_type);

  const cog = rec.cognitive_level;
  rec.cognitive_level = !cog || String(cog).trim() === "" || cog === "미지정" || cog === "None" ? null : String(cog).trim();

  const bn = rec.book_name || rec.source_book_name || fallbackBookTitle || (rec.pdf_source ? String(rec.pdf_source).replace(/\.pdf$/i, "") : "");
  rec.book_name = bn || null;
  rec.source_book_name = bn || null;

  if (!rec.sub_taxonomy_id || String(rec.sub_taxonomy_id).trim() in { "": 1, None: 1, null: 1 }) {
    rec.sub_taxonomy_id = null;
    rec.sub_taxonomy_name = null;
  }
  if (!rec.thk_taxonomy_id || String(rec.thk_taxonomy_id).trim() in { "": 1, None: 1, null: 1 }) {
    rec.thk_taxonomy_id = null;
    rec.thk_taxonomy_name = null;
  }

  const verified = Boolean(rec.is_human_verified || rec.human_verified || rec.verification_status === "APPROVED");
  rec.is_human_verified = verified;
  rec.human_verified = verified;
  if (!rec.verification_status) {
    rec.verification_status = verified ? "APPROVED" : "PENDING";
  }

  return rec;
}