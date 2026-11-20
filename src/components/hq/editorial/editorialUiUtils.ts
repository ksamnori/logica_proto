// src/components/hq/editorial/editorialUiUtils.ts
import type { CompetencyName, DifficultyKey } from "@/lib/hq/editorialTypes";

export const DIFF_ORDER: DifficultyKey[] = ["최하", "하", "중", "상", "최상", "미지정"];

export const DIFF_STYLE: Record<
  DifficultyKey,
  { bg: string; text: string; bar: string; label: string }
> = {
  최하: { bg: "bg-sky-50", text: "text-sky-700", bar: "bg-sky-400", label: "최하" },
  하: { bg: "bg-emerald-50", text: "text-emerald-700", bar: "bg-emerald-400", label: "하" },
  중: { bg: "bg-blue-50", text: "text-blue-700", bar: "bg-blue-500", label: "중" },
  상: { bg: "bg-amber-50", text: "text-amber-700", bar: "bg-amber-500", label: "상" },
  최상: { bg: "bg-rose-50", text: "text-rose-700", bar: "bg-rose-500", label: "최상" },
  미지정: { bg: "bg-slate-100", text: "text-slate-500", bar: "bg-slate-300", label: "미지정" },
};

export const COMPETENCY_LIST: CompetencyName[] = [
  "문제해결",
  "추론",
  "의사소통",
  "연결",
  "정보처리",
];

export const COMPETENCY_STYLE: Record<
  CompetencyName,
  { badge: string; bar: string; dot: string }
> = {
  문제해결: {
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    bar: "bg-blue-500",
    dot: "bg-blue-500",
  },
  추론: {
    badge: "bg-violet-50 text-violet-700 border-violet-200",
    bar: "bg-violet-500",
    dot: "bg-violet-500",
  },
  의사소통: {
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
  },
  연결: {
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    bar: "bg-amber-500",
    dot: "bg-amber-500",
  },
  정보처리: {
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    bar: "bg-rose-500",
    dot: "bg-rose-500",
  },
};

export const PROBLEM_TYPE_LABEL: Record<string, string> = {
  MULTIPLE_CHOICE: "객관식",
  SUBJECTIVE: "단답형",
  DESCRIPTIVE: "서술형",
};

export function sortSchoolLevel(a: string, b: string): number {
  const rank: Record<string, number> = { 초등학교: 1, 중학교: 2, 고등학교: 3 };
  const ra = rank[a] || 99;
  const rb = rank[b] || 99;
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b, "ko", { numeric: true });
}

export function sortNaturalKo(a: string, b: string): number {
  return String(a || "").localeCompare(String(b || ""), "ko", { numeric: true });
}

export function formatQuestionNumberLabel(
  qNum?: string | null,
  subNum?: number | null,
  subSubNum?: number | null
): string {
  let base = String(qNum || "1").trim().replace(/-0$/, "");
  if (subNum && subNum > 0) base += `-(${subNum})`;
  if (subSubNum && subSubNum > 0) base += `-${subSubNum}`;
  return base;
}

export function resolveQuestionImageUrl(raw?: string | null): string {
  if (!raw || raw === "null" || raw === "undefined") return "";
  let val = String(raw).trim();
  if (val.startsWith("[")) {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed) && parsed.length > 0) val = String(parsed[0]).trim();
    } catch {
      // ignore
    }
  }
  val = val
    .replace(/^["']|["']$/g, "")
    .trim()
    .replace(
      /\/storage\/v1\/object\/public\/system_images\/questions\//g,
      "/storage/v1/object/public/question_images/"
    );
  const lower = val.toLowerCase();
  if (!val || val === "null") return "";
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("data:image") ||
    lower.startsWith("blob:")
  ) {
    return val;
  }
  const cleanPath = val
    .replace(/^\/+/, "")
    .replace(/^(?:system_images\/questions\/|question_images\/|questions\/)/, "");
  const baseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kfwlmbwornivkrvoeqdh.supabase.co";
  return `${baseUrl}/storage/v1/object/public/question_images/${cleanPath}`;
}

// ============================================================================
// 수식(MathJax) 안전 HTML 변환 및 직렬 렌더링 큐
// ============================================================================

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type MathSeg = { kind: "text" | "inline" | "display"; value: string };

function looksLikeInlineMath(content: string, nextChar: string): boolean {
  if (!content.trim()) return false;
  if (/^\s|\s$/.test(content)) return false;
  if (/^\d/.test(nextChar || "")) return false;
  if (/\n\s*\n/.test(content)) return false;
  if (/[\\^_{}]/.test(content)) return true;
  if (/[가-힣]/.test(content)) return false;
  if (/[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(content)) return false;
  return true;
}

function findUnescapedDollar(src: string, from: number): number {
  let i = src.indexOf("$", from);
  while (i !== -1 && i > 0 && src[i - 1] === "\\") {
    i = src.indexOf("$", i + 1);
  }
  return i;
}

function splitMathSegments(src: string): MathSeg[] {
  const out: MathSeg[] = [];
  let text = "";
  const flush = () => {
    if (text) {
      out.push({ kind: "text", value: text });
      text = "";
    }
  };
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("\\$", i)) {
      text += "$";
      i += 2;
      continue;
    }
    if (src.startsWith("$$", i)) {
      const j = src.indexOf("$$", i + 2);
      if (j > i + 2) {
        flush();
        out.push({ kind: "display", value: src.slice(i + 2, j) });
        i = j + 2;
        continue;
      }
      text += "$$";
      i += 2;
      continue;
    }
    if (src.startsWith("\\[", i) || src.startsWith("\\(", i)) {
      const isDisp = src[i + 1] === "[";
      const closeTok = isDisp ? "\\]" : "\\)";
      const j = src.indexOf(closeTok, i + 2);
      if (j !== -1) {
        flush();
        out.push({
          kind: isDisp ? "display" : "inline",
          value: src.slice(i + 2, j),
        });
        i = j + 2;
        continue;
      }
    }
    if (src[i] === "$") {
      const j = findUnescapedDollar(src, i + 1);
      if (j !== -1 && looksLikeInlineMath(src.slice(i + 1, j), src[j + 1])) {
        flush();
        out.push({ kind: "inline", value: src.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
      text += "$";
      i += 1;
      continue;
    }
    text += src[i];
    i += 1;
  }
  flush();
  return out;
}

const BARE_LATEX_CMDS = new Set([
  "frac",
  "dfrac",
  "tfrac",
  "sqrt",
  "boxed",
  "phantom",
  "square",
  "blacksquare",
  "times",
  "div",
  "cdot",
  "pi",
  "le",
  "leq",
  "ge",
  "geq",
  "neq",
  "approx",
  "circ",
  "angle",
  "triangle",
  "pm",
  "infty",
  "overline",
  "degree",
]);

function wrapBareLatex(text: string): MathSeg[] {
  const out: MathSeg[] = [];
  let last = 0;
  const re = /\\([a-zA-Z]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!BARE_LATEX_CMDS.has(m[1])) continue;
    let end = m.index + m[0].length;
    if (text[end] === "[") {
      const close = text.indexOf("]", end);
      if (close !== -1) end = close + 1;
    }
    while (text[end] === "{") {
      let depth = 0;
      let k = end;
      for (; k < text.length; k++) {
        if (text[k] === "{") depth++;
        else if (text[k] === "}" && --depth === 0) break;
      }
      if (depth !== 0 || k >= text.length) break;
      end = k + 1;
    }
    if (m.index > last) out.push({ kind: "text", value: text.slice(last, m.index) });
    out.push({ kind: "inline", value: text.slice(m.index, end) });
    last = end;
    re.lastIndex = end;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

export function renderEditorialMathHtml(raw?: string | null): string {
  if (!raw) return "";
  return splitMathSegments(String(raw))
    .flatMap((seg) => (seg.kind === "text" ? wrapBareLatex(seg.value) : [seg]))
    .map((seg) => {
      if (seg.kind === "text") {
        return escapeHtml(seg.value)
          .replace(/\$/g, '<span class="tex2jax_ignore">$</span>')
          .replace(/\n/g, "<br/>");
      }
      const body = escapeHtml(seg.value);
      return seg.kind === "display" ? `\\[${body}\\]` : `\\(${body}\\)`;
    })
    .join("");
}

interface MathJaxGlobal {
  tex?: Record<string, unknown>;
  svg?: Record<string, unknown>;
  startup?: { typeset?: boolean; promise?: Promise<void> };
  typesetClear?: (els?: HTMLElement[]) => void;
  typesetPromise?: (els?: HTMLElement[]) => Promise<void>;
}

function getMathJaxWindow(): { MathJax?: MathJaxGlobal } {
  return window as unknown as { MathJax?: MathJaxGlobal };
}

let mjLoadPromise: Promise<void> | null = null;
let mjTypesetQueue: Promise<void> = Promise.resolve();

export function ensureEditorialMathJax(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const w = getMathJaxWindow();
  if (w.MathJax?.typesetPromise) return Promise.resolve();
  if (mjLoadPromise) return mjLoadPromise;

  mjLoadPromise = new Promise((resolve) => {
    if (!w.MathJax) {
      w.MathJax = {
        tex: {
          inlineMath: [
            ["$", "$"],
            ["\\(", "\\)"],
          ],
          displayMath: [
            ["$$", "$$"],
            ["\\[", "\\]"],
          ],
          processEscapes: true,
        },
        svg: { fontCache: "global" },
        startup: { typeset: false },
      };
    }
    let script = document.getElementById("MathJax-script") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "MathJax-script";
      script.async = true;
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
      document.head.appendChild(script);
    }
    const check = () =>
      w.MathJax?.typesetPromise ? resolve() : setTimeout(check, 100);
    check();
  });
  return mjLoadPromise;
}

export function typesetEditorialElement(el: HTMLElement | null): Promise<void> {
  if (!el) return Promise.resolve();
  mjTypesetQueue = mjTypesetQueue
    .then(() => ensureEditorialMathJax())
    .then(async () => {
      const mj = getMathJaxWindow().MathJax;
      if (!el.isConnected || !mj) return;
      try {
        await mj.startup?.promise;
        mj.typesetClear?.([el]);
        await mj.typesetPromise?.([el]);
      } catch (err) {
        console.warn("[Editorial MathJax] 수식 렌더링 경고:", err);
      }
    });
  return mjTypesetQueue;
}
