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

/** 최고관리자 판별 (화면 표시용. 실제 조회 제한은 DB 정책 is_contest_super_admin() 이 담당) */
export function isContestSuperAdmin(role: string, position: string): boolean {
  const r = (role || "").toUpperCase();
  if (r === "SUPER_ADMIN") return true;
  return r !== "TEACHER" && (position || "").includes("최고관리자");
}

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

/** 본문을 안전하게 HTML로 바꾸고, 마크다운 이미지 ![](url) 만 <img>로 살림. 수식($...$)은 MathJax가 처리 */
export function renderProblemText(text: string | null | undefined): string {
  if (!text) return "";
  return escapeHtml(String(text)).replace(
    /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, url: string) =>
      `<img src="${url.replace(/"/g, "&quot;")}" alt="그림" loading="lazy" class="my-3 max-w-[360px] max-h-[300px] rounded-lg border border-slate-200 bg-white p-1.5" />`
  );
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

export async function typesetMath(el: HTMLElement | null) {
  if (!el) return;
  await ensureMathJax();
  const mj = (window as any).MathJax;
  try {
    mj.typesetClear?.([el]);
    await mj.typesetPromise([el]);
  } catch {
    /* 깨진 수식 하나 때문에 화면 전체가 멈추지 않도록 무시 */
  }
}
