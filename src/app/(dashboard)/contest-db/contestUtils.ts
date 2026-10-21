// src/app/(dashboard)/contest-db/contestUtils.ts
// 사고력·문장제 문제 DB(pub_contest_problems 중 orca_math) 화면용 상수·타입·렌더링 도우미

export const CONTEST_TABLE = "pub_contest_problems";
// DB 조회 정책("Word problems only")과 같은 범위. 쿼리에도 명시해야 전용 인덱스(idx_pub_orca)를 탐
export const WORD_PROBLEM_SOURCE = "orca_math";
export const PAGE_SIZE = 50;

export type ViewMode = "word" | "all";

// 좌측 목록: 해설은 빼고 문제 본문까지만 조회 (50건씩이라 가벼움)
export const LIST_COLUMNS =
  "id, source_dataset, competition, country, exam_year, difficulty, topics_ko, keywords_ko, has_ko, has_figure, problem_en, problem_ko";

export interface ContestListItem {
  id: string;
  source_dataset: string;
  competition: string | null;
  country: string | null;
  exam_year: number | null;
  difficulty: number | null;
  topics_ko: string[] | null;
  keywords_ko: string[] | null;
  has_ko: boolean;
  has_figure: boolean;
  problem_en: string;
  problem_ko: string | null;
}

export interface ContestProblem extends ContestListItem {
  question_type_ko: string | null;
  solutions_en: string[] | null;
  solutions_ko: string[] | null;
  final_answer: string | null;
  images: string[] | null;
}

export interface ContestFilters {
  koStatus: "" | "true" | "false";
  topic: string;
  keyword: string;
  text: string;
  // 아래는 "전체 문제" 탭에서만 사용
  dataset: string;
  competition: string;
  country: string;
  questionType: string;
  onlyFigure: boolean;
}

export const EMPTY_FILTERS: ContestFilters = {
  koStatus: "", topic: "", keyword: "", text: "",
  dataset: "", competition: "", country: "", questionType: "", onlyFigure: false,
};

/** 문제 DB 열람 권한 ('word' = 문장제만, 'all' = 전체, null = 없음). DB 허용 명단(contest_db_access)이 기준 */
export type ContestAccessLevel = "word" | "all" | null;

export const DATASET_OPTIONS = [
  { value: "NuminaMath-1.5", label: "NuminaMath-1.5" },
  { value: "MathNet", label: "MathNet" },
  { value: "Omni-MATH", label: "Omni-MATH" },
];

// NuminaMath-1.5 출처 (전체 문제 탭의 출처 선택용)
export const NUMINA_SOURCES = [
  "cn_k12", "olympiads", "orca_math", "synthetic_math", "aops_forum", "cn_contest",
  "metamath", "inequalities", "amc_aime", "number_theory", "olympiads_ref",
];

export const TOPIC_OPTIONS = ["대수", "기하", "정수론", "조합", "부등식", "논리와 퍼즐", "미적분"];

export const KEYWORD_OPTIONS = [
  "원에 내접하는 사각형", "원주각과 접선", "삼각형의 오심", "닮음과 합동", "비둘기집의 원리",
  "산술·기하·코시 부등식", "합동식과 나머지", "소수와 합성수", "부정방정식(정수해)", "점화식과 수열",
  "다항식과 근과 계수", "함수방정식", "경우의 수와 순열·조합", "확률과 기댓값", "색칠과 격자판",
];

export const QUESTION_TYPE_OPTIONS = ["객관식", "단답/서술형", "단답+증명", "증명", "경시/올림피아드"];

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------------
// 수식 전처리
//  문제 데이터는 "$12짜리 연필" 같은 달러 금액과 진짜 수식($2x+3$)이 섞여 있고,
//  해설에는 $ 없이 \boxed{12}, \frac{1}{2} 만 덩그러니 있는 경우도 많습니다.
//  그대로 MathJax에 넘기면 금액 사이 문장이 통째로 수식이 되거나 코드가 그대로 보이므로,
//  여기서 직접 "수식 / 일반 글"을 나눈 뒤
//   - 수식은 모든 화면의 MathJax 설정이 공통으로 아는 \( \), \[ \] 로 감싸고
//   - 일반 글의 $ 는 MathJax가 건드리지 않는 span 에 넣어 글자 그대로 보이게 합니다.
// ---------------------------------------------------------------------
type Segment = { kind: "text" | "inline" | "display"; value: string };

/** $...$ 사이가 진짜 수식인지, 달러 금액 사이의 문장인지 판별 (Pandoc 규칙 + 문장 감지) */
function looksLikeInlineMath(content: string, nextChar: string): boolean {
  if (!content.trim()) return false;
  if (/^\s|\s$/.test(content)) return false;        // "$12 and $" 처럼 $ 안쪽이 공백이면 금액
  if (/^\d/.test(nextChar || "")) return false;       // "$5 ... $10" 의 두 번째 $ 뒤가 숫자
  if (/\n\s*\n/.test(content)) return false;          // 문단을 넘어가면 수식 아님
  if (/[\\^_{}]/.test(content)) return true;          // LaTeX 기호가 있으면 수식
  if (/[가-힣]/.test(content)) return false;          // 한글 문장
  if (/[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(content)) return false; // 영어 문장
  return true;
}

function findUnescaped(src: string, token: string, from: number): number {
  let i = src.indexOf(token, from);
  while (i !== -1 && i > 0 && src[i - 1] === "\\") i = src.indexOf(token, i + 1);
  return i;
}

export function splitMath(src: string): Segment[] {
  const out: Segment[] = [];
  let text = "";
  const flush = () => { if (text) { out.push({ kind: "text", value: text }); text = ""; } };
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("\\$", i)) { text += "$"; i += 2; continue; }   // 이미 이스케이프된 달러
    if (src.startsWith("$$", i)) {
      const j = src.indexOf("$$", i + 2);
      if (j > i + 2) { flush(); out.push({ kind: "display", value: src.slice(i + 2, j) }); i = j + 2; continue; }
      text += "$$"; i += 2; continue;
    }
    if (src.startsWith("\\[", i) || src.startsWith("\\(", i)) {
      const display = src[i + 1] === "[";
      const j = src.indexOf(display ? "\\]" : "\\)", i + 2);
      if (j !== -1) { flush(); out.push({ kind: display ? "display" : "inline", value: src.slice(i + 2, j) }); i = j + 2; continue; }
    }
    if (src[i] === "$") {
      const j = findUnescaped(src, "$", i + 1);
      if (j !== -1 && looksLikeInlineMath(src.slice(i + 1, j), src[j + 1])) {
        flush(); out.push({ kind: "inline", value: src.slice(i + 1, j) }); i = j + 1; continue;
      }
      text += "$"; i += 1; continue;                                   // 금액 표시 달러
    }
    text += src[i]; i += 1;
  }
  flush();
  return out;
}

// $ 없이 글 속에 들어 있는 LaTeX 명령 (해설의 \boxed{12} 등)
const BARE_COMMANDS = new Set([
  "frac", "dfrac", "tfrac", "sqrt", "boxed", "times", "div", "cdot", "pi", "le", "leq", "ge", "geq",
  "neq", "approx", "circ", "angle", "triangle", "pm", "infty", "overline", "degree", "%",
]);

/** 글 속 LaTeX 명령을 찾아 \( \) 로 감쌀 구간을 돌려줌 (중괄호 짝을 끝까지 따라감) */
function wrapBareCommands(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  const re = /\\([a-zA-Z]+|%)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!BARE_COMMANDS.has(m[1])) continue;
    let end = m.index + m[0].length;
    if (text[end] === "[") { const close = text.indexOf("]", end); if (close !== -1) end = close + 1; }
    while (text[end] === "{") {
      let depth = 0, k = end;
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

const IMG_RE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
const LITERAL_DOLLAR = '<span class="tex2jax_ignore">$</span>';

function renderTextSegment(value: string): string {
  return escapeHtml(value)
    .replace(/\$/g, LITERAL_DOLLAR)
    .replace(IMG_RE, (_m, url: string) =>
      `<img src="${url.replace(/"/g, "&quot;")}" alt="그림" loading="lazy" class="my-3 max-w-[360px] max-h-[300px] rounded-lg border border-slate-200 bg-white p-1.5" />`);
}

/** 문제·해설 텍스트를 안전한 HTML로 바꾸고, 수식은 MathJax가 확실히 읽는 형태로 정리 */
export function renderProblemText(text: string | null | undefined): string {
  if (!text) return "";
  return splitMath(String(text))
    .flatMap((seg) => (seg.kind === "text" ? wrapBareCommands(seg.value) : [seg]))
    .map((seg) => {
      if (seg.kind === "text") return renderTextSegment(seg.value);
      const body = escapeHtml(seg.value);
      return seg.kind === "display" ? `\\[${body}\\]` : `\\(${body}\\)`;
    })
    .join("");
}

/** 정답 칸: 이미 수식 구분자가 있으면 그대로, 숫자·식이면 수식으로, 말로 된 답은 글자로 */
export function renderAnswer(answer: string | null | undefined): string {
  const a = String(answer || "").trim();
  if (!a) return "";
  if (/\$|\\\(|\\\[/.test(a)) return renderProblemText(a);
  if (/[가-힣]/.test(a) || /[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(a)) return renderProblemText(a);
  return `\\(${escapeHtml(a)}\\)`;
}

/** 목록에 보여줄 한 줄 미리보기 (수식 기호를 걷어 내고 앞부분만) */
export function previewLine(text: string | null | undefined, max = 60): string {
  const plain = String(text || "").replace(/\$+/g, "").replace(/\\[a-zA-Z]+/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

/** 수동 편집 시 여러 풀이를 하나의 텍스트 칸에서 나누는 구분자 */
export const SOLUTION_SPLIT = "---SOLUTION_SPLIT---";

let mathJaxLoading: Promise<void> | null = null;

/** 다른 화면(exam/viewer 등)과 같은 MathJax CDN을 한 번만 불러옴 */
export function ensureMathJax(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const w = window as any;
  if (w.MathJax?.typesetPromise) return Promise.resolve();
  if (mathJaxLoading) return mathJaxLoading;

  mathJaxLoading = new Promise((resolve) => {
    if (!w.MathJax) {
      w.MathJax = {
        tex: {
          inlineMath: [["$", "$"], ["\\(", "\\)"]],
          displayMath: [["$$", "$$"], ["\\[", "\\]"]],
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
    const wait = () => (w.MathJax?.typesetPromise ? resolve() : setTimeout(wait, 100));
    wait();
  });
  return mathJaxLoading;
}

// MathJax 는 렌더링이 겹치면 일부만 바뀐 채 멈출 수 있어서, 요청을 한 줄로 세워 차례로 처리
let typesetChain: Promise<void> = Promise.resolve();

export function typesetMath(el: HTMLElement | null): Promise<void> {
  if (!el) return Promise.resolve();
  typesetChain = typesetChain
    .then(() => ensureMathJax())
    .then(async () => {
      const mj = (window as any).MathJax;
      if (!el.isConnected) return; // 그 사이 화면에서 사라진 영역은 건너뜀
      try {
        await mj.startup?.promise;
        mj.typesetClear?.([el]);
        await mj.typesetPromise([el]);
      } catch (err) {
        console.warn("MathJax 렌더링 오류:", err); // 깨진 수식 하나 때문에 화면 전체가 멈추지 않도록
      }
    });
  return typesetChain;
}
