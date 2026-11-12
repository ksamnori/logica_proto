// src/app/(dashboard)/pdf-parser/pdfparserutils.ts
// =========================================================
// V115.1 / V121.1 / V5.0.0 + V302 통합 유틸리티 엔진
// - 빈칸 네모박스 3종($\square$, $\boxed{\phantom{000...}}$, 분수 박스) 보존 및 노출 매크로 자동 $ 감싸기
// - \squarecm, \squarem, \triangleABC 등 명령어+알파벳 붙음 오류 2중 차단
// - JSON 파싱 중 제어문자(\x08oxed, \x0crac, \x09ext 등) 복구
// - Phase 2 대소문자 정규화(canonicalIdMap) 및 인쇄 페이지 역산(inferPrintedPagesInPlace)
// =========================================================

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
// Phase 2: 학년·학기 Prefix 범위 확장 엔진 (V5.0.0 100% 호환)
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
// Phase 1 & V302: 무적의 텍스트/수식 정제 엔진 (V115.1 & V121.1 가드레일 통합)
// =========================================================

// 수식 밖에서 달러($) 없이 노출된 박스/대분수박스/분수박스 매크로를 안전하게 감싸기 위한 정규식
const BARE_BOX_FRAC_RE =
  /((?:\\boxed\{\\phantom\{[0-9]+\}\}\s*)?\\d?frac\{\\boxed\{\\phantom\{[0-9]+\}\}\}\{\\boxed\{\\phantom\{[0-9]+\}\}\}(?:\s*\\text\{[^{}]*\})?|\\boxed\{\\phantom\{[0-9]+\}\}(?:\s*\\text\{[^{}]*\})?|\\square(?![A-Za-z])(?:\s*\\text\{[^{}]*\})?)/g;

// \squarecm, \squarem, \triangleABC 등 명령어+알파벳 붙음 오류를 공백으로 안전 분리
export function separateMacroAndAlpha(input: string): string {
  if (!input) return input;
  return input
    .replace(/\\square(?=[A-Za-z])/g, "\\square ")
    .replace(/\\blacksquare(?=[A-Za-z])/g, "\\blacksquare ")
    .replace(/\\angle(?=[A-Za-z])/g, "\\angle ")
    .replace(/\\triangle(?!(?:left|right|q|down)\b)(?=[A-Za-z])/g, "\\triangle ")
    .replace(/\\blacktriangle(?!(?:left|right|down)\b)(?=[A-Za-z])/g, "\\blacktriangle ")
    .replace(/\\times(?=[A-Za-z])/g, "\\times ")
    .replace(/\\div(?!ideontimes\b)(?=[A-Za-z])/g, "\\div ")
    .replace(/\\cdot(?![sp]\b)(?=[A-Za-z])/g, "\\cdot ")
    .replace(/\\cdots(?=[A-Za-z])/g, "\\cdots ")
    .replace(/\\pi(?!tchfork\b)(?=[A-Za-z])/g, "\\pi ")
    .replace(/\\parallel(?=[A-Za-z])/g, "\\parallel ")
    .replace(/\\perp(?=[A-Za-z])/g, "\\perp ")
    .replace(/\\sim(?!(?:eq|ilar)\b)(?=[A-Za-z])/g, "\\sim ")
    .replace(/\\cong(?=[A-Za-z])/g, "\\cong ")
    .replace(/\\bigcirc(?=[A-Za-z])/g, "\\bigcirc ")
    .replace(/\\rightarrow(?=[A-Za-z])/g, "\\rightarrow ")
    .replace(/\\Rightarrow(?=[A-Za-z])/g, "\\Rightarrow ");
}

export function applySafeCleaner(text: string | null | undefined): string {
  if (!text || typeof text !== "string") return text || "";

  let cleaned = text.replace(/@@/g, "\\").replace(/<\{/g, "{").replace(/\}>/g, "}");
  cleaned = cleaned.replace(/\xa0/g, " ").replace(/\u200b/g, "");

  // 1) JSON 이스케이프 제어문자 오변환 복구 (\boxed, \blacksquare, \frac, \text, \times, \triangle 등)
  cleaned = cleaned
    .replace(/\x08oxed/g, "\\boxed")
    .replace(/\x08lacksquare/g, "\\blacksquare")
    .replace(/\x08ecause/g, "\\because")
    .replace(/\x0crac/g, "\\frac")
    .replace(/\x09ext/g, "\\text")
    .replace(/\x09imes/g, "\\times")
    .replace(/\x09riangle/g, "\\triangle")
    .replace(/\x09herefore/g, "\\therefore");

  cleaned = cleaned.replace(/∠/g, "\\angle ").replace(/°/g, "^{\\circ}");
  cleaned = cleaned.replace(/\\?degree\b/g, "^{\\circ}");

  // 2) \squarecm, \squarem, \squarekg, \triangleABC 등 매크로+알파벳 붙음 오류 완벽 분리
  cleaned = separateMacroAndAlpha(cleaned);

  // 3) 인접 인라인 수식 두 개가 붙어 $$ 블록 수식으로 오인되는 현상 1차 분리
  cleaned = cleaned.replace(
    /(\$(?:\\square|\\boxed\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}))\$\$([^$]+\$)/g,
    "$1$ $$$2"
  );

  // 4) 달러($) 짝이 정상일 때, 수식 바깥에 날것으로 노출된 \boxed{\phantom{...}} 나 \square 를 $...$로 자동 감싸기
  const dollarCount = (cleaned.match(/\$/g) || []).length;
  if (dollarCount % 2 === 0) {
    const segments = cleaned.split(/(\$\$[\s\S]*?\$\$|\$[^$]*?\$)/g);
    for (let i = 0; i < segments.length; i += 2) {
      if (segments[i] && segments[i].includes("\\")) {
        segments[i] = segments[i].replace(BARE_BOX_FRAC_RE, "$$$1$$");
      }
    }
    cleaned = segments.join("");
  }

  // 5) 자동 감싸기 후 인접한 인라인 수식($$)이 생겼다면 공백으로 안전 분리
  cleaned = cleaned.replace(
    /(\$(?:\\square|(?:\\boxed\{\\phantom\{[0-9]+\}\}\s*)?\\d?frac\{\\boxed\{\\phantom\{[0-9]+\}\}\}\{\\boxed\{\\phantom\{[0-9]+\}\}\}|\\boxed\{\\phantom\{[0-9]+\}\}))\$\$([^$]+\$)/g,
    "$1$ $$$2"
  );

  return cleaned.trim();
}

export function fixJsonEscapes(text: string | null | undefined): string {
  if (!text) return text || "";
  let res = text
    .replace(/\x08oxed/g, "\\boxed")
    .replace(/\x08lacksquare/g, "\\blacksquare")
    .replace(/\x08ecause/g, "\\because")
    .replace(/\x0crac/g, "\\frac")
    .replace(/\x09ext/g, "\\text")
    .replace(/\x09imes/g, "\\times")
    .replace(/\x09riangle/g, "\\triangle")
    .replace(/\x09herefore/g, "\\therefore")
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

  // 먼저 V115.1 / V121.1 안전 정제기(제어문자 복구, \squarecm 분리, 노출 네모박스 $ 감싸기) 수행
  let text = applySafeCleaner(input);

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

  // \square 뒤에 알파벳이 붙지 않도록 이미 분리된 상태에서 수식 치환 수행
  text = text
    .replace(/\\square(?![a-zA-Z])/g, "□")
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
    // □cm -> \squarecm 재발 원천 차단을 위해 유니코드->LaTeX 치환 직후 매크로+알파벳 분리 실행
    m = separateMacroAndAlpha(m);

    if (m.startsWith("$$") && m.endsWith("$$")) {
      let inner = m.slice(2, -2);
      // 한글이 포함된 중첩 \text{...}만 정리하고 영문 단위(\text{ cm})는 그대로 보존
      let prevInner = "";
      while (prevInner !== inner) {
        prevInner = inner;
        inner = inner.replace(/\\+text\s*\{\s*([^{}]*[가-힣ㄱ-ㅎㅏ-ㅣ][^{}]*)\s*\}/g, "$1");
      }
      inner = inner.replace(/([ \t]*[가-힣ㄱ-ㅎㅏ-ㅣ][가-힣ㄱ-ㅎㅏ-ㅣ \t.,!?~]*[ \t]*)/g, "\\text{$1}");
      inner = separateMacroAndAlpha(inner);
      m = `$$${inner}$$`;
    } else if (m.startsWith("$") && m.endsWith("$")) {
      let inner = m.slice(1, -1);
      if (!/^\s*[가-힣ㄱ-ㅎㅏ-ㅣ]+\s*$/.test(inner)) {
        let prevInner = "";
        while (prevInner !== inner) {
          prevInner = inner;
          inner = inner.replace(/\\+text\s*\{\s*([^{}]*[가-힣ㄱ-ㅎㅏ-ㅣ][^{}]*)\s*\}/g, "$1");
        }
        inner = inner.replace(/([ \t]*[가-힣ㄱ-ㅎㅏ-ㅣ][가-힣ㄱ-ㅎㅏ-ㅣ \t.,!?~]*[ \t]*)/g, "\\text{$1}");
        inner = separateMacroAndAlpha(inner);
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
    /(?<!\$)(\\dfrac\s*\{(?:[^{}]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*\}\s*\{(?:[^{}]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*\})(?!\$)/g,
    "$$$1$$"
  );
}

export function safeWrapMathSymbol(text: string | null | undefined, symbol: string): string {
  if (!text) return "";
  const mathPattern = /(\$\$[\s\S]+?\$\$|\$(?:(?!\n\n)(?:\\\$|[^$]))+\$|\\begin\{[a-zA-Z*]+\}[\s\S]*?\\end\{[a-zA-Z*]+\})/g;
  const parts = text.split(mathPattern);
  const re = new RegExp(`(?<!\\$)\\\\${symbol}(?![a-zA-Z])(?!\\$)`, "g");
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
  let res = applySafeCleaner(fixJsonEscapes(text));
  res = res.replace(
    /(?<!\$)(\\d?frac\s*\{(?:[^{}]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*\}\s*\{(?:[^{}]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*\})(?!\$)/g,
    "$$$1$$"
  );
  res = res.replaceAll("\\frac", "\\dfrac").replaceAll("\\ddfrac", "\\dfrac");
  for (let i = 0; i < 3; i++) {
    res = res.replace(/(?<!\$)\$([^$]+)\$[ \t]*\$([^$]+)\$(?!\$)/g, "$$$1 $2$$");
  }
  return separateMacroAndAlpha(res);
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
  return applySafeCleaner(res);
}

// =========================================================
// V115.1: 비동기 완료 순서 무관 인쇄 페이지 역산 보정기
// =========================================================
export function inferPrintedPagesInPlace(
  items: any[],
  directPrintedMap: Record<number, number>
): void {
  const knownRealPages = Object.keys(directPrintedMap)
    .map((k) => Number(k))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
  if (knownRealPages.length === 0) return;

  for (const it of items) {
    const realP = Number(it?.detected_page_num);
    if (isNaN(realP) || realP <= 0) continue;
    if (directPrintedMap[realP] !== undefined) {
      it.final_printed_page = String(directPrintedMap[realP]).slice(0, 20);
    } else if (!it.final_printed_page) {
      const prevCandidates = knownRealPages.filter((kp) => kp < realP);
      const refP =
        prevCandidates.length > 0
          ? prevCandidates[prevCandidates.length - 1]
          : knownRealPages[0];
      const inferred = directPrintedMap[refP] + (realP - refP);
      if (inferred > 0) {
        it.final_printed_page = String(inferred).slice(0, 20);
      }
    }
  }
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
  if (s.includes("최상")) return "최상";
  if (s.includes("중상") || s === "상") return "상";
  if (s.includes("중하") || s === "중") return "중";
  if (s.includes("최하")) return "최하";
  if (s.includes("하")) return "하";
  if ((ALLOWED_DIFFICULTIES as readonly string[]).includes(s)) return s;
  return "중";
}

export function sanitizeCurriculumId(
  val: any,
  canonicalIdMap?: Map<string, string> | Record<string, string> | null
): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s || ["NONE", "NULL", "미분류", "-"].includes(s.toUpperCase())) return null;
  const codeMatch = s.match(/[EMH]\d{2,3}(?:-[0-9A-Za-z]+)+/i);
  const candidate = codeMatch
    ? codeMatch[0].toUpperCase()
    : (s.split(/[\s:()\[\]]+/)[0]?.trim().toUpperCase() || "");
  if (!candidate) return null;
  if (canonicalIdMap) {
    if (canonicalIdMap instanceof Map) {
      const mapped = canonicalIdMap.get(candidate);
      if (mapped) return mapped.slice(0, 50);
    } else if (canonicalIdMap[candidate]) {
      return String(canonicalIdMap[candidate]).slice(0, 50);
    }
  }
  return candidate.slice(0, 50);
}

export function sanitizeThinkingId(val: any): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s || ["NONE", "NULL", "미분류", "-"].includes(s.toUpperCase())) return null;
  const thkMatch = s.match(/THK-\d{2}(?:-\d{2}){0,2}/i);
  if (thkMatch) return thkMatch[0].toUpperCase().slice(0, 20);
  return null;
}

export function sanitizeCognitiveLevel(val: any): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s || s === "미지정" || ["NONE", "NULL"].includes(s.toUpperCase())) return null;
  if (s.includes("추론") || s.includes("문제")) return "추론 및 문제 해결";
  if (s.includes("적용") || s.includes("응용")) return "적용 및 응용";
  if (s.includes("이해") || s.includes("연산")) return "이해 및 연산";
  return s.slice(0, 20);
}

export function autoInferProblemType(
  qText: string,
  q2Text: string,
  ansText: string,
  currentPt?: string | null
): string {
  const ptStr = String(currentPt || "").trim().toUpperCase();
  if (ptStr.includes("MULTIPLE_CHOICE") || ptStr.includes("객관식")) {
    return "MULTIPLE_CHOICE";
  }
  if (ptStr.includes("DESCRIPTIVE") || ptStr.includes("서술형")) {
    return "DESCRIPTIVE";
  }
  if (ptStr.includes("SUBJECTIVE") || ptStr.includes("주관식") || ptStr.includes("단답형")) {
    return "SUBJECTIVE";
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
  return "SUBJECTIVE";
}

export function clampVarchar(val: any, maxLen = 20, fallback: string | null = null): string | null {
  if (val === null || val === undefined) return fallback;
  const s = String(val).trim();
  if (!s || ["NONE", "NULL", "UNDEFINED"].includes(s.toUpperCase())) return fallback;
  return s.slice(0, maxLen);
}

export function normalizeRecordForQuestionDb(raw: any, fallbackBookTitle = ""): any {
  const rec: any = { ...raw };

  if (!rec.question_id) {
    rec.question_id = rec.id || generateUUID();
  }

  rec.question =
    rec.question !== undefined && rec.question !== null
      ? String(rec.question)
      : String(rec.questionText || "");
  const q2Val = rec.question_2 !== undefined ? rec.question_2 : rec.questionText2;
  rec.question_2 = q2Val && String(q2Val).trim() !== "" ? String(q2Val) : null;

  rec.difficulty = normalizeDifficultyForDb(rec.difficulty);

  const probVal = rec.solving_probability;
  if (
    probVal === null ||
    probVal === undefined ||
    String(probVal).trim() === "" ||
    String(probVal) === "None"
  ) {
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
  rec.question_number =
    qn !== null && qn !== undefined && String(qn).trim() !== ""
      ? String(qn).trim().slice(0, 20)
      : "1";

  rec.problem_type = autoInferProblemType(
    rec.question,
    rec.question_2 || "",
    rec.answer || "",
    rec.problem_type
  );
  rec.cognitive_level = sanitizeCognitiveLevel(rec.cognitive_level);

  const bn =
    rec.book_name ||
    rec.source_book_name ||
    fallbackBookTitle ||
    (rec.pdf_source ? String(rec.pdf_source).replace(/\.pdf$/i, "") : "");
  rec.book_name = bn || null;
  rec.source_book_name = bn || null;

  rec.taxonomy_id = sanitizeCurriculumId(rec.taxonomy_id);
  rec.sub_taxonomy_id = sanitizeCurriculumId(rec.sub_taxonomy_id);
  if (!rec.sub_taxonomy_id) {
    rec.sub_taxonomy_name = null;
  }

  rec.thk_taxonomy_id = sanitizeThinkingId(rec.thk_taxonomy_id);
  if (!rec.thk_taxonomy_id) {
    rec.thk_taxonomy_name = null;
  }

  rec.ai_status = clampVarchar(rec.ai_status, 20, "완료");
  rec.classification_status = clampVarchar(rec.classification_status, 20, "COMPLETE");
  rec.verification_status = clampVarchar(rec.verification_status, 20, "APPROVED");
  rec.image_type = clampVarchar(rec.image_type, 20, null);
  rec.image_2_type = clampVarchar(rec.image_2_type, 20, null);
  rec.answer_image_type = clampVarchar(rec.answer_image_type, 20, null);
  rec.engine_ver = clampVarchar(rec.engine_ver, 20, null);

  const verified = Boolean(
    rec.is_human_verified || rec.human_verified || rec.verification_status === "APPROVED"
  );
  rec.is_human_verified = verified;
  rec.human_verified = verified;

  return rec;
}