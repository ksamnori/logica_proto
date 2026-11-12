// src/app/api/gemini-parse/route.ts
// =========================================================
// Ultimate 로지카 PDF 추출·분류·검수 서버 엔진
// 버전: V115.1 (Vision Extract) + V121.1 (1-Pass Extract+Solve) + V5.0.0 (Explicit Cache Classifier)
// 핵심 비용 절감 및 수식 방어 아키텍처:
// 1. 작업별 최적 경량 모델 분담 + 최소 추론(thinkingLevel: MINIMAL / LOW) 적용
//    - 단순 비전 추출(extract) & 트리플 분류(classify) & 수식 교정(fix_latex): gemini-3.5-flash-lite (MINIMAL)
//    - 1-Pass 통합 추출+풀이(extract_and_solve) & 4단계 풀이(solve / solve_page): gemini-3.8-flash (LOW)
// 2. 타임스탬프·가변 숫자를 제거한 100% 고정 프롬프트(Static Prompt)로 암시적 프리픽스 캐시 적중 유도
// 3. Phase 2 대량 분류 시 명시적 컨텍스트 캐싱(cachedContents 생성 -> 배치 재사용 -> 종료 즉시 삭제) 지원
// 4. 빈칸 네모박스 3종($\square$, $\boxed{\phantom{000...}}$, 분수 박스) 구분 및 \squarecm 단위 붙음 원천 차단
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const EXTRACT_MODEL = process.env.GEMINI_EXTRACT_MODEL || "gemini-3.5-flash-lite";
const SOLVE_MODEL = process.env.GEMINI_SOLVE_MODEL || "gemini-3.8-flash";
const CLASSIFY_MODEL = process.env.GEMINI_CLASSIFY_MODEL || "gemini-3.5-flash-lite";
const FIX_LATEX_MODEL = process.env.GEMINI_FIX_LATEX_MODEL || "gemini-3.5-flash-lite";

// 🌟 추출 및 해설 프롬프트 공통 네모박스 3종 & 단위 오류 방지 정적 규칙 (V115.1 & V121.1)
const BOX_AND_UNIT_RULES = String.raw`### [빈칸(네모박스) 형태별 정밀 구분 및 수식 오류 방지 규칙 - 필수 준수!]
1. **일반 작은 정사각형 기호 ($\square$)**:
   - "$\square$ 안에 알맞은 수를 써넣으시오."나 "$3 + \square = 7$"처럼 글자 1개 크기의 작은 정사각형 기호만 $\square$로 표기하십시오.
2. **옆으로 긴 직사각형 빈 네모칸 ($\boxed{\phantom{000...}}$)**:
   - 여러 자리 수, 수식, 또는 긴 답을 써넣도록 가로로 길게 그려진 빈 네모박스는 절대 \square로 처리하지 마십시오.
   - 박스의 실제 가로 길이에 비례하여 0의 개수를 조절한 \boxed{\phantom{000}} 형태로 달러($) 수식 안에 작성하십시오.
   - 길이 기준: 짧은 직사각형 $\boxed{\phantom{000}}$ | 중간 길이 $\boxed{\phantom{00000}}$ | 긴 답안칸 $\boxed{\phantom{00000000}}$
3. **분수가 들어가는 큰 네모박스 ($\frac{\boxed{\phantom{000}}}{\boxed{\phantom{000}}}$)**:
   - 분수를 써넣는 세로로 큰 빈 박스나 분자·분모 빈칸은 분자와 분모 자리에 각각 \boxed{\phantom{000}}을 배치하여 $\frac{\boxed{\phantom{000}}}{\boxed{\phantom{000}}}$ (대분수면 $\boxed{\phantom{00}}\frac{\boxed{\phantom{000}}}{\boxed{\phantom{000}}}$, 폭에 맞춰 0 개수 조절)로 크게 표기하십시오.
4. **\squarecm, \squarem 등 명령어+단위 붙임 절대 금지 (빨간색 수식 오류 방지)**:
   - \square 바로 뒤에 cm, m, mm, km, g, kg, L, mL 등 영문 단위나 알파벳을 공백 없이 붙여 $\squarecm$, $\squarem$처럼 쓰면 치명적인 LaTeX 렌더링 에러가 발생합니다.
   - 문제와 해설 모든 곳에서 반드시 $\square\text{ cm}$ 또는 $\square$ cm (긴 박스면 $\boxed{\phantom{000}}\text{ cm}$ 또는 $\boxed{\phantom{000}}$ cm)처럼 명령어와 단위를 명확히 분리하십시오.`;

// 🌟 V115.1 타임스탬프·가변 페이지 번호를 완전히 제거한 100% 고정 비전 추출 프롬프트 (암시적 캐시 적중)
const STATIC_EXTRACT_PROMPT = String.raw`당신은 초중등 수학 교재(로지카 MAX) 문제 판독 엔진입니다.
제공된 이미지는 교재의 한 페이지 전체입니다.
문제가 전혀 없는 표지, 목차, 개념 설명 전용 페이지라면 빈 배열("problems": [])을 반환하십시오.

### [치명적 금지 사항 및 시각적 주의점]
1. **음영/반전 색상 숫자(❶, ❷, ①, ②) 강력 인식**: 어두운 원형 배경 안의 흰색 숫자나 괄호/원 문자를 기호나 노이즈로 착각하여 누락하지 마십시오.
2. **3단계 하위 문항 완벽 분리**: [본문 지문] -> [(1), (2)] -> [①, ②] 구조는 뭉뚱그리지 말고 가장 작은 단위의 문항까지 개별 JSON 객체로 쪼개십시오.
   - 단일 문제(하위 없음): sub_num: 0, sub_sub_num: 0
   - 1단계 하위 (1): sub_num: 1, sub_sub_num: 0
   - 2단계 하위 (1) 안의 ①: sub_num: 1, sub_sub_num: 1
3. **문항 번호 고정**: "개념 확인", "개념 노트", "QUIZ" 등은 번호가 아니니 "Q"로 기입하고, 확인 3은 띄어쓰기 없이 "확인3"으로 기입하십시오.

${BOX_AND_UNIT_RULES}

### [공통 지시문 및 페이지 탐지 규칙]
1. **공통 지시문 복제 및 도형 요약**: 공통 지시문은 쪼개진 모든 소문항 question 앞에 빠짐없이 복사해 붙이고, 도형/표/그래프는 발문 끝에 [그림 정보: ...]로 수치와 조건을 요약하십시오.
2. **페이지 번호 탐지**: 이미지 최하단 구석에 인쇄된 실제 페이지 번호(숫자)를 찾아 final_printed_page에 기입하십시오.

[추출 예시]
{"problems": [{"final_printed_page": "15", "question_number": "4", "sub_num": 1, "sub_sub_num": 1, "question": "$\\square$ 안에 알맞은 수를 써넣으시오. (1) 넓이를 구하는 과정이다. 빈칸을 채우시오. ① 윗변의 길이는 $\\square\\text{ cm}$이고, 분수로 나타내면 $\\frac{\\boxed{\\phantom{000}}}{\\boxed{\\phantom{000}}}\\text{ m}$, 식은 $\\boxed{\\phantom{000000}}$이다."}]}`;

// 🌟 V121.1 1-Pass [추출 + 4단계 풀이] 통합 고정 프롬프트 (페이지 이미지 1회 전송으로 최대 비용 절감)
const STATIC_SINGLE_PASS_PROMPT = String.raw`당신은 초중등 수학 교재(로지카 MAX) 문제 판독 및 해설 작성 엔진입니다.
제공된 이미지는 교재 한 페이지 전체입니다.
이 페이지의 모든 문제를 빠짐없이 개별 분리하여 추출하고, 동시에 간결한 4단계 해설과 정답을 작성하십시오.
문제가 전혀 없는 표지/개념설명 페이지라면 빈 배열("problems": [])을 반환하십시오.

### [1. 문항 분리 및 추출 규칙 (요약 절대 금지)]
1. **음영/반전 색상 숫자(❶, ❷, ①, ②) 강력 인식** 및 **소문항 완벽 분리**:
   - (1)~(6) 괄호 소문항이나 [본문] -> [(1), (2)] -> [①, ②] 3단계 구조는 모두 개별 객체로 분리하십시오.
   - 단일 문제: sub_num: 0, sub_sub_num: 0
   - 1단계 소문항 (1): sub_num: 1, sub_sub_num: 0
   - 2단계 소문항 (1) 안의 ①: sub_num: 1, sub_sub_num: 1
2. **문항 번호 규칙**: "개념 확인", "개념 노트", "QUIZ" 등은 "Q", 확인 3은 띄어쓰기 없이 "확인3"으로 기입하십시오.
3. **공통 지시문 복제**: 쪼개진 모든 소문항 question 앞에 공통 지시문을 복사하여 붙이십시오.
4. **수식/그림/쪽수**: 분수는 \frac{}{}를 써서 달러($) LaTeX으로 표기하고, 도형/표 조건은 발문 끝에 [그림 정보: ...]로 요약하십시오. 하단 구석 인쇄 쪽수는 final_printed_page에 숫자로 기입하십시오.

${BOX_AND_UNIT_RULES}

### [2. 4단계 간결 해설 규칙 (수식은 $ LaTeX 유지, \squarecm 같은 붙임 금지)]
- step_1_concept: 핵심 개념 1문장 요약
- step_2_approach: 풀이 전략 1~2문장 요약
- step_3_process: 주요 식과 계산 과정 2~3문장 요약
- step_4_conclusion: 최종 정답 도출 1문장
- answer: 최종 정답만 짧게 기입 (객관식은 원문자 ①~⑤ 포함)`;

const EXTRACT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    problems: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          final_printed_page: { type: "STRING", nullable: true },
          question_number: { type: "STRING" },
          sub_num: { type: "INTEGER", nullable: true },
          sub_sub_num: { type: "INTEGER", nullable: true },
          question: { type: "STRING" },
        },
        required: ["question_number", "question"],
      },
    },
  },
  required: ["problems"],
};

const SINGLE_PASS_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    problems: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          final_printed_page: { type: "STRING", nullable: true },
          question_number: { type: "STRING" },
          sub_num: { type: "INTEGER", nullable: true },
          sub_sub_num: { type: "INTEGER", nullable: true },
          question: { type: "STRING" },
          step_1_concept: { type: "STRING" },
          step_2_approach: { type: "STRING" },
          step_3_process: { type: "STRING" },
          step_4_conclusion: { type: "STRING" },
          answer: { type: "STRING" },
        },
        required: [
          "question_number",
          "question",
          "step_1_concept",
          "step_2_approach",
          "step_3_process",
          "step_4_conclusion",
          "answer",
        ],
      },
    },
  },
  required: ["problems"],
};

const SOLVE_SINGLE_SCHEMA = {
  type: "OBJECT",
  properties: {
    step_1_concept: { type: "STRING" },
    step_2_approach: { type: "STRING" },
    step_3_process: { type: "STRING" },
    step_4_conclusion: { type: "STRING" },
    answer: { type: "STRING" },
  },
  required: [
    "step_1_concept",
    "step_2_approach",
    "step_3_process",
    "step_4_conclusion",
    "answer",
  ],
};

const SOLVE_PAGE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      question_id: { type: "STRING" },
      step_1_concept: { type: "STRING" },
      step_2_approach: { type: "STRING" },
      step_3_process: { type: "STRING" },
      step_4_conclusion: { type: "STRING" },
      answer: { type: "STRING" },
    },
    required: [
      "question_id",
      "step_1_concept",
      "step_2_approach",
      "step_3_process",
      "step_4_conclusion",
      "answer",
    ],
  },
};

export interface GeminiUsageMeta {
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
  model: string;
}

function safeParseJson(rawText: string): any {
  let text = (rawText || "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^`{3}(?:json)?\s*/i, "");
    text = text.replace(/\s*`{3}$/, "");
  }
  text = text.replace(/@@/g, "\\\\");
  try {
    return JSON.parse(text);
  } catch {
    // 1차 복구: LaTeX 단일 백슬래시(\square, \phantom, \boxed, \frac, \text 등)가 이스케이프 없이 노출된 경우 방어
    const repairedEscapes = text
      .replace(/\\(?!["\\/bfnrtu])/g, "\\\\")
      .replace(/\\(?=boxed|blacksquare|because|frac|text|times|triangle|therefore|neq|nabla)/g, "\\\\")
      .replace(/,\s*([\]}])/g, "$1")
      .replace(/[\u0000-\u0007\u000B\u000E-\u001F]/g, "");
    try {
      return JSON.parse(repairedEscapes);
    } catch {
      const cleaned = text
        .replace(/,\s*([\]}])/g, "$1")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
      return JSON.parse(cleaned);
    }
  }
}

function buildStaticClassifyInstruction(
  currGuide: string,
  subGuide: string,
  thkGuide: string,
  applySubTaxonomy: boolean,
  applyThinking: boolean
): string {
  const subRuleText = applySubTaxonomy
    ? "\n3. [서브 교과 정밀 매핑 (sub_curriculum_id)]: [2-1. 서브 교과 세부유형 리스트]에서 실제 요구 개념에 가장 부합하는 Depth 8 `item_id` 코드만 기입하십시오."
    : "";
  const thkRuleText = applyThinking
    ? "\n4. [사고력 할당 (thinking_id)]: 조건이 복합적이거나 사고력 문장제인 경우 적합한 `THK-XX-XX-XX` 코드만 기입하십시오."
    : "";

  const blocks: string[] = [currGuide || ""];
  if (applySubTaxonomy && subGuide) blocks.push(subGuide);
  if (applyThinking && thkGuide) blocks.push(thkGuide);
  const joinedGuides = blocks.filter(Boolean).join("\n\n");

  return `당신은 대한민국 수학 교육과정 데이터 분류 전문가입니다.
전달되는 수학 문제 JSON 배열의 각 문항을 아래 분류표에 맞춰 정밀 분류하십시오.

${joinedGuides}

### [절대 규칙]
1. [고유 ID 유지]: 입력된 \`question_id\`를 반환 배열에 100% 동일하게 유지하십시오.
2. [메인 교과 Depth 8 강제 매핑 (curriculum_id)]: 반드시 [1-1. 메인 교과 세부유형 리스트]의 Depth 8 \`item_id\` 코드만 기입하십시오. 상위 Depth 7 단원 코드 사용을 금지합니다.${subRuleText}${thkRuleText}
5. [인지 영역]: "이해 및 연산", "적용 및 응용", "추론 및 문제 해결" 중 택 1
6. [유형, 난이도 및 정답률(solving_probability)]:
   - 문제 유형: "MULTIPLE_CHOICE", "SUBJECTIVE", "DESCRIPTIVE" 중 택 1
   - 난이도("최하", "하", "중", "상", "최상")와 정답률(15~95 사이 5단위 정수):
     * 최상: 15~30 | 상: 30~50 | 중: 50~70 | 하: 70~85 | 최하: 85~95
`;
}

function buildClassifyResponseSchema(applySubTaxonomy: boolean, applyThinking: boolean) {
  const properties: Record<string, any> = {
    question_id: { type: "STRING" },
    curriculum_id: { type: "STRING", description: "메인 교과 Depth 8 item_id 코드" },
    difficulty: { type: "STRING", description: "최하, 하, 중, 상, 최상 중 하나" },
    problem_type: { type: "STRING", description: "MULTIPLE_CHOICE, SUBJECTIVE, DESCRIPTIVE 중 하나" },
    cognitive_level: { type: "STRING", description: "이해 및 연산, 적용 및 응용, 추론 및 문제 해결 중 하나" },
    solving_probability: { type: "INTEGER", description: "15~95 사이 5단위 정수" },
  };
  const required = [
    "question_id",
    "curriculum_id",
    "difficulty",
    "problem_type",
    "cognitive_level",
    "solving_probability",
  ];
  if (applySubTaxonomy) {
    properties.sub_curriculum_id = { type: "STRING", description: "서브 교과 Depth 8 item_id 코드" };
    required.push("sub_curriculum_id");
  }
  if (applyThinking) {
    properties.thinking_id = { type: "STRING", description: "매칭된 THK ID 코드" };
    required.push("thinking_id");
  }
  return {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties,
      required,
    },
  };
}

function makeImageInlinePart(imageBase64: string) {
  const base64Data = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
  return {
    inlineData: {
      mimeType: "image/jpeg",
      data: base64Data,
    },
  };
}

interface CallGeminiOptions {
  apiKey: string;
  model: string;
  parts: any[];
  maxOutputTokens?: number;
  responseSchema?: any;
  preferredThinking?: "MINIMAL" | "LOW";
  cachedContent?: string | null;
}

async function callGeminiRest(opts: CallGeminiOptions): Promise<{ text: string; usage: GeminiUsageMeta }> {
  const {
    apiKey,
    parts,
    maxOutputTokens = 16384,
    responseSchema,
    preferredThinking = "LOW",
    cachedContent,
  } = opts;

  let targetModel = opts.model.replace(/^models\//, "");

  const computeEffectiveLevel = (m: string, pref: "MINIMAL" | "LOW"): "MINIMAL" | "LOW" => {
    if (pref === "MINIMAL" && !m.toLowerCase().includes("flash-lite")) {
      return "LOW";
    }
    return pref;
  };

  type ThinkingMode = "LEVEL" | "BUDGET" | "NONE";
  const modesToTry: ThinkingMode[] = ["LEVEL", "BUDGET", "NONE"];

  let lastError = "";
  for (let mIdx = 0; mIdx < modesToTry.length; mIdx++) {
    const mode = modesToTry[mIdx];
    const effectiveLevel = computeEffectiveLevel(targetModel, preferredThinking);

    const generationConfig: Record<string, any> = {
      responseMimeType: "application/json",
      maxOutputTokens,
    };
    if (responseSchema) {
      generationConfig.responseSchema = responseSchema;
    }
    if (mode === "LEVEL") {
      generationConfig.thinkingConfig = { thinkingLevel: effectiveLevel };
    } else if (mode === "BUDGET") {
      generationConfig.thinkingConfig = {
        thinkingBudget: effectiveLevel === "MINIMAL" ? 0 : 1024,
      };
    }

    const payload: Record<string, any> = {
      contents: [{ role: "user", parts }],
      generationConfig,
    };
    if (cachedContent) {
      payload.cachedContent = cachedContent;
    }

    const res = await fetch(`${GEMINI_API_BASE}/models/${targetModel}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    const rawJson = await res.json().catch(() => ({}));

    if (res.ok) {
      const candParts: any[] = rawJson?.candidates?.[0]?.content?.parts || [];
      const nonThoughtTexts = candParts
        .filter((p) => !p?.thought && typeof p?.text === "string")
        .map((p) => p.text);
      const text =
        nonThoughtTexts.length > 0
          ? nonThoughtTexts.join("")
          : candParts
              .filter((p) => typeof p?.text === "string")
              .map((p) => p.text)
              .join("");

      const u = rawJson?.usageMetadata || {};
      const usage: GeminiUsageMeta = {
        promptTokens: Number(u.promptTokenCount || 0),
        cachedTokens: Number(u.cachedContentTokenCount || 0),
        outputTokens: Number(u.candidatesTokenCount || 0),
        thoughtTokens: Number(u.thoughtsTokenCount || 0),
        totalTokens: Number(u.totalTokenCount || 0),
        model: targetModel,
      };
      return { text, usage };
    }

    const errMsg = String(rawJson?.error?.message || `HTTP ${res.status}`);
    lastError = `[${res.status}] ${errMsg}`;

    // 1) 모델 미지원(404)이고 캐시가 묶이지 않은 호출이면 상위 호환 SOLVE_MODEL로 즉시 폴백
    if (res.status === 404 && !cachedContent && targetModel !== SOLVE_MODEL) {
      targetModel = SOLVE_MODEL.replace(/^models\//, "");
      mIdx = -1; // 새 모델로 LEVEL부터 재시도
      continue;
    }

    // 2) thinkingConfig 관련 스키마 오류(400)인 경우 BUDGET -> NONE 순으로 자동 폴백
    if (
      res.status === 400 &&
      /thinking/i.test(errMsg) &&
      mode !== "NONE"
    ) {
      continue;
    }

    // 그 외 에러(429, 503, 캐시 만료 등)는 상위 핸들러로 전달
    throw new Error(lastError);
  }

  throw new Error(lastError || "Gemini API 응답 실패");
}

export async function POST(req: NextRequest) {
  try {
    // 🔒 1. 보안 자물쇠: 토큰 검증
    let token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) token = req.cookies.get("sb-access-token")?.value;
    if (!token) {
      const allCookies = req.cookies.getAll();
      const authCookie = allCookies.find(
        (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
      );
      if (authCookie) {
        try {
          token = JSON.parse(authCookie.value)[0];
        } catch {}
      }
    }

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: 접근 권한이 없습니다." },
        { status: 401 }
      );
    }

    // 🌟 병렬 요청 시 Supabase Auth(GoTrue) 커넥션 풀 고갈 및 refresh_token 타임아웃(500) 방지를 위한 토큰 메모리 캐시 + JWT 폴백 검증
    const nowMs = Date.now();
    const globalAny = globalThis as any;
    if (!globalAny.__logicaVerifiedTokens) {
      globalAny.__logicaVerifiedTokens = new Map<string, number>();
    }
    const tokenCache: Map<string, number> = globalAny.__logicaVerifiedTokens;

    let isTokenValid = false;
    const cachedExp = tokenCache.get(token);
    if (cachedExp && cachedExp > nowMs) {
      isTokenValid = true;
    } else {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payloadJson = Buffer.from(parts[1], "base64url").toString("utf-8");
          const payload = JSON.parse(payloadJson);
          if (payload && payload.sub && (!payload.exp || payload.exp * 1000 > nowMs)) {
            isTokenValid = true;
            tokenCache.set(
              token,
              Math.min(nowMs + 10 * 60 * 1000, (payload.exp || nowMs / 1000 + 600) * 1000)
            );
          }
        }
      } catch {}

      if (!isTokenValid) {
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } }
        );
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser(token);

        if (!authError && user) {
          isTokenValid = true;
          tokenCache.set(token, nowMs + 10 * 60 * 1000);
        }
      }
    }

    if (!isTokenValid) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: 유효하지 않은 세션입니다." },
        { status: 401 }
      );
    }

    // 🔑 환경변수에서 GEMINI_API_KEY 로드 (클라이언트 노출 원천 차단)
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "서버에 GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const action = body.action || "extract";

    // =========================================================
    // ACTION 1: Phase 1 경량 비전 추출 전용 엔진 (V115.1 — gemini-3.5-flash-lite + MINIMAL)
    // =========================================================
    if (action === "extract") {
      const { imageBase64 } = body;
      if (!imageBase64) {
        return NextResponse.json(
          { success: false, error: "imageBase64가 필요합니다." },
          { status: 400 }
        );
      }

      const imagePart = makeImageInlinePart(imageBase64);
      const { text, usage } = await callGeminiRest({
        apiKey,
        model: EXTRACT_MODEL,
        parts: [{ text: STATIC_EXTRACT_PROMPT }, imagePart],
        maxOutputTokens: 16384,
        responseSchema: EXTRACT_RESPONSE_SCHEMA,
        preferredThinking: "MINIMAL",
      });

      const parsed = safeParseJson(text);
      return NextResponse.json({
        success: true,
        data: {
          problems: Array.isArray(parsed) ? parsed : parsed?.problems || [],
        },
        usage,
      });
    }

    // =========================================================
    // ACTION 1-B: Phase 1 [1-Pass 통합 추출 + 4단계 풀이] 엔진 (V121.1 — 이미지 1회 호출로 추출+해설 동시 해결)
    // =========================================================
    if (action === "extract_and_solve") {
      const { imageBase64 } = body;
      if (!imageBase64) {
        return NextResponse.json(
          { success: false, error: "imageBase64가 필요합니다." },
          { status: 400 }
        );
      }

      const imagePart = makeImageInlinePart(imageBase64);
      const { text, usage } = await callGeminiRest({
        apiKey,
        model: SOLVE_MODEL,
        parts: [{ text: STATIC_SINGLE_PASS_PROMPT }, imagePart],
        maxOutputTokens: 32768,
        responseSchema: SINGLE_PASS_RESPONSE_SCHEMA,
        preferredThinking: "LOW",
      });

      const parsed = safeParseJson(text);
      return NextResponse.json({
        success: true,
        data: {
          problems: Array.isArray(parsed) ? parsed : parsed?.problems || [],
        },
        usage,
      });
    }

    // =========================================================
    // ACTION 2-A: Phase 1 단건 핀포인트 보완 풀이 엔진 (V121.1 solve_item_ai_async)
    // =========================================================
    if (action === "solve") {
      const { imageBase64, question, question_number, sub_num, sub_sub_num } = body;
      if (!imageBase64 || !question) {
        return NextResponse.json(
          { success: false, error: "imageBase64와 question이 필요합니다." },
          { status: 400 }
        );
      }

      const sDisp = sub_num && Number(sub_num) > 0 ? `(${sub_num})` : "";
      const ssDisp = sub_sub_num && Number(sub_sub_num) > 0 ? `-${sub_sub_num}` : "";
      const prompt = `당신은 초중등 수학 교재의 해설지 전문 작성 AI입니다.
첨부된 교재 페이지 이미지(${question_number || ""}번${sDisp}${ssDisp} 주변)를 참고하여 문제를 풀고 4단계 해설을 작성하십시오.
- 각 step 필드는 최대 2~3문장 이내로 간결하게 작성하고 수식은 달러($) LaTeX을 유지하십시오.

${BOX_AND_UNIT_RULES}

[문제 텍스트]
${question}`;

      const imagePart = makeImageInlinePart(imageBase64);
      const { text, usage } = await callGeminiRest({
        apiKey,
        model: SOLVE_MODEL,
        parts: [{ text: prompt }, imagePart],
        maxOutputTokens: 8192,
        responseSchema: SOLVE_SINGLE_SCHEMA,
        preferredThinking: "LOW",
      });

      const parsed = safeParseJson(text);
      return NextResponse.json({
        success: true,
        data: parsed,
        usage,
      });
    }

    // =========================================================
    // ACTION 2-B: Phase 1 페이지 단위 일괄 4단계 풀이 엔진 (V121.1 2-Pass / 미완성 해설 보완용)
    // =========================================================
    if (action === "solve_page") {
      const { imageBase64, items } = body;
      if (!imageBase64 || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json(
          { success: false, error: "imageBase64와 items 배열이 필요합니다." },
          { status: 400 }
        );
      }

      const slimQuestions = items.map((it: any) => ({
        question_id: it.question_id,
        question_number: it.question_number,
        sub_num: it.sub_num || 0,
        sub_sub_num: it.sub_sub_num || 0,
        question: it.question,
      }));

      const prompt = `당신은 초중등 수학 교재의 해설지 전문 작성 AI입니다.
함께 첨부된 교재 원본 페이지 이미지를 참고하여, 아래 JSON 배열로 주어진 ${slimQuestions.length}개 문항의 4단계 해설과 정답을 작성하십시오.

[지시 사항]
1. 전달된 각 문항의 \`question_id\`를 반환 배열에 100% 동일하게 유지하십시오.
2. 도형, 표, 그래프는 첨부된 페이지 이미지의 해당 문항 번호 주변을 확인하십시오.
3. 각 step 필드는 최대 2~3문장 이내로 간결하게 작성하고 수식은 달러($) LaTeX 형식을 유지하십시오.

${BOX_AND_UNIT_RULES}

[풀어야 할 페이지 내 문항 목록 JSON]
${JSON.stringify(slimQuestions)}`;

      const imagePart = makeImageInlinePart(imageBase64);
      const { text, usage } = await callGeminiRest({
        apiKey,
        model: SOLVE_MODEL,
        parts: [{ text: prompt }, imagePart],
        maxOutputTokens: 32768,
        responseSchema: SOLVE_PAGE_SCHEMA,
        preferredThinking: "LOW",
      });

      let parsed = safeParseJson(text);
      if (!Array.isArray(parsed)) {
        parsed = parsed?.items || parsed?.solutions || [parsed];
      }

      return NextResponse.json({
        success: true,
        data: parsed,
        usage,
      });
    }

    // =========================================================
    // ACTION 3-A: Phase 2 명시적 컨텍스트 캐시 생성 (V5.0.0 — 분류표 >= 2,048 토큰 시 활성화)
    // =========================================================
    if (action === "create_classify_cache") {
      const {
        staticInstruction: clientStaticInstruction,
        currGuide,
        subGuide,
        thkGuide,
        applySubTaxonomy,
        applyThinking,
      } = body;

      const instructionText =
        typeof clientStaticInstruction === "string" && clientStaticInstruction.trim()
          ? clientStaticInstruction
          : buildStaticClassifyInstruction(
              currGuide || "",
              subGuide || "",
              thkGuide || "",
              Boolean(applySubTaxonomy),
              Boolean(applyThinking)
            );

      const cleanModel = CLASSIFY_MODEL.replace(/^models\//, "");
      const cachePayload = {
        model: `models/${cleanModel}`,
        displayName: "math_taxonomy_guide_cache",
        systemInstruction: {
          parts: [{ text: "당신은 대한민국 수학 교육과정 정밀 분류 엔진입니다." }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: instructionText }],
          },
        ],
        ttl: "3600s",
      };

      try {
        const res = await fetch(`${GEMINI_API_BASE}/cachedContents`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(cachePayload),
        });
        const rawJson = await res.json().catch(() => ({}));
        if (res.ok && rawJson?.name) {
          return NextResponse.json({
            success: true,
            data: {
              cacheName: String(rawJson.name),
              cachedTokenCount: Number(rawJson?.usageMetadata?.totalTokenCount || 0),
              model: cleanModel,
            },
          });
        }
        const reason = String(rawJson?.error?.message || `HTTP ${res.status}`);
        return NextResponse.json({
          success: true,
          data: {
            cacheName: null,
            fallbackReason: reason.slice(0, 140),
          },
        });
      } catch (cacheErr: any) {
        return NextResponse.json({
          success: true,
          data: {
            cacheName: null,
            fallbackReason: String(cacheErr?.message || "캐시 생성 생략").slice(0, 140),
          },
        });
      }
    }

    // =========================================================
    // ACTION 3-B: Phase 2 명시적 컨텍스트 캐시 즉시 삭제 (V5.0.0 — TTL 보관료 0원 차단)
    // =========================================================
    if (action === "delete_classify_cache") {
      const { cacheName } = body;
      if (
        typeof cacheName === "string" &&
        cacheName.startsWith("cachedContents/") &&
        /^[a-zA-Z0-9/_-]+$/.test(cacheName)
      ) {
        try {
          await fetch(`${GEMINI_API_BASE}/${cacheName}`, {
            method: "DELETE",
            headers: { "x-goog-api-key": apiKey },
          });
        } catch {}
      }
      return NextResponse.json({ success: true, data: { deleted: true } });
    }

    // =========================================================
    // ACTION 3-C: Phase 2 정밀 트리플 분류 엔진 (V5.0.0 — gemini-3.5-flash-lite + MINIMAL + 명시적/고정프리픽스 캐시)
    // =========================================================
    if (action === "classify") {
      const {
        batchData,
        cacheName,
        staticInstruction: clientStaticInstruction,
        currGuide,
        subGuide,
        thkGuide,
        applySubTaxonomy,
        applyThinking,
      } = body;

      if (!Array.isArray(batchData) || batchData.length === 0) {
        return NextResponse.json(
          { success: false, error: "분류할 문항 배치 데이터가 비어 있습니다." },
          { status: 400 }
        );
      }

      const simplifiedBatch = batchData.map((item: any) => ({
        question_id: item.question_id,
        question: item.question,
        answer: item.answer ?? null,
      }));
      const batchPayload = `분석할 문제 JSON 배열:\n${JSON.stringify(simplifiedBatch)}`;

      const responseSchema = buildClassifyResponseSchema(
        Boolean(applySubTaxonomy),
        Boolean(applyThinking)
      );

      const fallbackInstruction =
        typeof clientStaticInstruction === "string" && clientStaticInstruction.trim()
          ? clientStaticInstruction
          : buildStaticClassifyInstruction(
              currGuide || "",
              subGuide || "",
              thkGuide || "",
              Boolean(applySubTaxonomy),
              Boolean(applyThinking)
            );

      let resultObj: { text: string; usage: GeminiUsageMeta };
      const validCacheName =
        typeof cacheName === "string" &&
        cacheName.startsWith("cachedContents/") &&
        /^[a-zA-Z0-9/_-]+$/.test(cacheName)
          ? cacheName
          : null;

      if (validCacheName) {
        try {
          // 명시적 캐시 활성 시 거대한 분류표 재전송 없이 캐시 참조 + 배치 데이터만 전송
          resultObj = await callGeminiRest({
            apiKey,
            model: CLASSIFY_MODEL,
            parts: [{ text: batchPayload }],
            maxOutputTokens: 16384,
            responseSchema,
            preferredThinking: "MINIMAL",
            cachedContent: validCacheName,
          });
        } catch (cachedErr: any) {
          // 캐시 만료/오류 시 고정 프리픽스 모드로 자동 복구하여 배치 실패 원천 차단
          if (fallbackInstruction.trim()) {
            resultObj = await callGeminiRest({
              apiKey,
              model: CLASSIFY_MODEL,
              parts: [{ text: fallbackInstruction }, { text: batchPayload }],
              maxOutputTokens: 16384,
              responseSchema,
              preferredThinking: "MINIMAL",
            });
          } else {
            throw cachedErr;
          }
        }
      } else {
        resultObj = await callGeminiRest({
          apiKey,
          model: CLASSIFY_MODEL,
          parts: [{ text: fallbackInstruction }, { text: batchPayload }],
          maxOutputTokens: 16384,
          responseSchema,
          preferredThinking: "MINIMAL",
        });
      }

      let parsedResults = safeParseJson(resultObj.text || "[]");
      if (!Array.isArray(parsedResults)) {
        parsedResults = parsedResults ? [parsedResults] : [];
      }

      return NextResponse.json({
        success: true,
        data: parsedResults,
        usage: resultObj.usage,
      });
    }

    // =========================================================
    // ACTION 4: V302 AI 텍스트/수식 자동 교정 (fix_latex — 경량 모델 + 네모박스·단위 가드레일)
    // =========================================================
    if (action === "fix_latex") {
      const { fields } = body;
      if (!fields || typeof fields !== "object") {
        return NextResponse.json(
          { success: false, error: "교정할 fields 객체가 필요합니다." },
          { status: 400 }
        );
      }

      const prompt = `다음 JSON 객체는 수학 문제 및 해설의 각 필드 텍스트입니다.
어색하게 깨진 수식이나 기호를 사람이 읽기 좋은 완벽한 LaTeX 형태(단일 $ 또는 이중 $$ 사용)로 교정하여 동일한 JSON 키 구조로 반환해주세요.
한국어 설명이나 문장 구조 등 다른 내용은 절대 삭제하거나 바꾸지 마세요.

${BOX_AND_UNIT_RULES}

원본 JSON:
${JSON.stringify(fields, null, 2)}`;

      const { text, usage } = await callGeminiRest({
        apiKey,
        model: FIX_LATEX_MODEL,
        parts: [{ text: prompt }],
        maxOutputTokens: 8192,
        preferredThinking: "MINIMAL",
      });

      const parsed = safeParseJson(text);
      return NextResponse.json({
        success: true,
        data: parsed,
        usage,
      });
    }

    return NextResponse.json(
      { success: false, error: `지원하지 않는 action입니다: ${action}` },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("Gemini Parse API Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "서버 오류" },
      { status: 500 }
    );
  }
}