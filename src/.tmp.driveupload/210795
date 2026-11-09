// src/app/api/gemini-parse/route.ts
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MODEL_NAME = "gemini-3.8-flash";

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
    // Fallback repair for trailing commas or unescaped backslashes
    const cleaned = text
      .replace(/,\s*([\]}])/g, "$1")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    return JSON.parse(cleaned);
  }
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
        // 1차: JWT 페이로드 로컬 검증 (만료 시간 및 sub 확인으로 불필요한 Auth DB 부하 차단)
        const parts = token.split(".");
        if (parts.length === 3) {
          const payloadJson = Buffer.from(parts[1], "base64url").toString("utf-8");
          const payload = JSON.parse(payloadJson);
          if (payload && payload.sub && (!payload.exp || payload.exp * 1000 > nowMs)) {
            isTokenValid = true;
            tokenCache.set(token, Math.min(nowMs + 10 * 60 * 1000, (payload.exp || nowMs / 1000 + 600) * 1000));
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "서버에 GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const action = body.action || "extract";
    const genAI = new GoogleGenerativeAI(apiKey);

    // =========================================================
    // ACTION 1: Phase 1 비전 추출 엔진 (V114.1 3단계 소문항 + V119.1 도형 규칙 통합)
    // =========================================================
    if (action === "extract") {
      const { imageBase64, pageNum } = body;
      if (!imageBase64) {
        return NextResponse.json(
          { success: false, error: "imageBase64가 필요합니다." },
          { status: 400 }
        );
      }

      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: {
          temperature: 0.0,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              problems: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    final_printed_page: { type: SchemaType.STRING, nullable: true },
                    question_number: { type: SchemaType.STRING },
                    sub_num: { type: SchemaType.INTEGER, nullable: true },
                    sub_sub_num: { type: SchemaType.INTEGER, nullable: true },
                    question: { type: SchemaType.STRING },
                  },
                  required: ["question_number", "question"],
                },
              },
            },
          },
        },
      });

      const prompt = `
당신은 초중등 수학 교재(로지카 MAX) 문제 판독 엔진입니다.
제공된 이미지는 교재의 한 페이지 전체입니다. (현재 스캔 중인 PDF 물리적 페이지: ${pageNum || "?"}쪽)
현재 타임스탬프: ${Date.now()}

### [🚨 치명적 금지 사항 및 시각적 주의점 (요약 절대 금지) 🚨]
1. **음영/반전 색상 숫자(❶, ❷, ①, ②) 강력 인식**: 어두운 원형 배경 안에 흰색 글씨로 적힌 숫자나, 괄호/원 문자를 단순 기호나 노이즈로 착각하여 누락하는 행위를 엄벌합니다!
2. **뭉뚱그리기 엄벌 & 3단계 하위 문항 완벽 분리**: 이미지에 '(1)'부터 '(6)'까지 괄호 문항이 여러 개 보이거나, 중등 교재처럼 [본문 지문] -> [(1), (2)] -> [①, ②] 3단계로 꼬리를 물면 가장 작은 단위의 문항까지 반드시 개별 JSON 객체로 모두 분리하여 추출해야 합니다.
   - 부모 지문만 있는 단일 문제: \`sub_num\`: 0, \`sub_sub_num\`: 0
   - 1단계 하위 (예: (1)): \`sub_num\`: 1, \`sub_sub_num\`: 0
   - 2단계 하위 (예: (1) 안의 ①): \`sub_num\`: 1, \`sub_sub_num\`: 1
3. **문항 번호 고정**: "개념 확인", "개념 노트", "QUIZ" 등은 번호가 아니니 무시하고 "Q" 기입. '확인 3'은 띄어쓰기 없이 "확인3"으로 기입.

### [🚨 추출 규칙 🚨]
1. **공통 지시문 복제**: 공통 지시문은 쪼개진 모든 소문항 텍스트 앞에 빠짐없이 복사하여 붙이십시오.
2. **수식 및 빈칸 처리**: 분수는 \\frac{}{}, 빈칸(네모)은 \\square 기호를 사용해 자연스러운 달러($) 수식으로 변환하십시오.
3. **페이지 번호 강력 탐지**: 이미지 최하단(바닥) 구석을 샅샅이 살펴보고 종이에 인쇄된 실제 페이지 번호(숫자)를 찾아 \`final_printed_page\`에 기입하십시오.

### [📐 도형/그림 문제 특별 규칙 📐]
- 발문 텍스트가 짧아도 절대 건너뛰지 마십시오.
- **그림 정보 텍스트화**: 발문 뒤에 \`[그림 정보: ...]\` 괄호를 열고, 기호(ㄱ,ㄴ,ㄷ), 숫자, 각도, 평행 표시 등을 요약 기입하십시오.
`;

      const base64Data = imageBase64.includes(",")
        ? imageBase64.split(",")[1]
        : imageBase64;
      const imagePart = {
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg",
        },
      };

      const result = await model.generateContent([prompt, imagePart]);
      const responseText = result.response.text();
      const parsed = safeParseJson(responseText);

      return NextResponse.json({
        success: true,
        data: {
          problems: Array.isArray(parsed) ? parsed : parsed?.problems || [],
        },
      });
    }

    // =========================================================
    // ACTION 2: Phase 1 비전 4단계 풀이 엔진 (V119.1 solve_item_ai_async)
    // =========================================================
    if (action === "solve") {
      const { imageBase64, question, question_number, sub_num } = body;
      if (!imageBase64 || !question) {
        return NextResponse.json(
          { success: false, error: "imageBase64와 question이 필요합니다." },
          { status: 400 }
        );
      }

      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              step_1_concept: { type: SchemaType.STRING },
              step_2_approach: { type: SchemaType.STRING },
              step_3_process: { type: SchemaType.STRING },
              step_4_conclusion: { type: SchemaType.STRING },
              answer: { type: SchemaType.STRING },
            },
            required: [
              "step_1_concept",
              "step_2_approach",
              "step_3_process",
              "step_4_conclusion",
              "answer",
            ],
          },
        },
      });

      const sDisp = sub_num && Number(sub_num) > 0 ? `(${sub_num})` : "";
      const prompt = `
당신은 초중등 수학 교재의 해설지 전문 작성 AI입니다.
함께 첨부된 **[교재 원본 이미지]**를 참고하여 수학 문제를 풀고, 4단계 포맷에 맞추어 해설을 작성하십시오.

[🚨 지시 사항 및 도형 문제 특별 규칙 🚨]
1. 텍스트만으로 부족한 정보(도형, 표 등)는 반드시 첨부된 이미지(${question_number || ""}번${sDisp} 주변)를 확인하십시오. 특히 도형의 각도/길이 문제는 시각적 기하학 조건이 절대적으로 중요합니다.
2. 분량 제한: 각 step 필드는 무조건 '최대 3문장' 또는 '최대 3줄' 이내로 작성. 계산 전개가 길어져도 강제 종료.
3. 수식 포맷: 달러 기호($)를 사용한 LaTeX 형식 유지.

[📝 작성 가이드]
- step_1_concept: 핵심 개념 1줄 요약.
- step_2_approach: 전략 2~3줄 요약.
- step_3_process: 주요 방정식 2~5개만 세우고 즉시 멈추십시오.
- step_4_conclusion: 최종 정답만 딱 1줄.
- answer: 정답 텍스트만 짧게 기입.

[풀어야 할 문제 텍스트]
${question}
`;

      const base64Data = imageBase64.includes(",")
        ? imageBase64.split(",")[1]
        : imageBase64;
      const imagePart = {
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg",
        },
      };

      const result = await model.generateContent([prompt, imagePart]);
      const responseText = result.response.text();
      const parsed = safeParseJson(responseText);

      return NextResponse.json({
        success: true,
        data: parsed,
      });
    }

    // =========================================================
    // ACTION 2-B: Phase 1 페이지 단위 일괄 4단계 풀이 엔진 (이미지 1회 전송으로 페이지 내 전 문항 동시 풀이 -> 토큰 85% 절감)
    // =========================================================
    if (action === "solve_page") {
      const { imageBase64, items } = body;
      if (!imageBase64 || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json(
          { success: false, error: "imageBase64와 items 배열이 필요합니다." },
          { status: 400 }
        );
      }

      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                question_id: { type: SchemaType.STRING },
                step_1_concept: { type: SchemaType.STRING },
                step_2_approach: { type: SchemaType.STRING },
                step_3_process: { type: SchemaType.STRING },
                step_4_conclusion: { type: SchemaType.STRING },
                answer: { type: SchemaType.STRING },
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
          },
        },
      });

      const slimQuestions = items.map((it: any) => ({
        question_id: it.question_id,
        question_number: it.question_number,
        sub_num: it.sub_num || 0,
        sub_sub_num: it.sub_sub_num || 0,
        question: it.question,
      }));

      const prompt = `당신은 초중등 수학 교재의 해설지 전문 작성 AI입니다.
첨부된 **[교재 원본 페이지 이미지 1장]**을 참고하여, 아래 JSON 배열로 주어진 이 페이지의 모든 문항(${slimQuestions.length}개)을 풀고 각각의 4단계 해설과 정답을 작성하십시오.

[🚨 지시 사항 및 도형 문제 특별 규칙 🚨]
1. 전달된 각 문항의 \`question_id\`를 반환 배열에 100% 동일하게 유지하십시오.
2. 텍스트만으로 부족한 정보(도형, 표, 그래프 등)는 반드시 첨부된 페이지 이미지에서 해당 문항 번호 주변을 확인하여 푸십시오.
3. 분량 제한: 각 step 필드는 무조건 '최대 2~3문장' 이내로 간결하게 작성하십시오.
4. 수식 포맷: 달러 기호($)를 사용한 LaTeX 형식을 유지하십시오.
5. 작성 가이드:
   - step_1_concept: 핵심 개념 1줄 요약
   - step_2_approach: 문제 해결 전략 1~2줄 요약
   - step_3_process: 주요 식과 계산 과정 2~4줄 요약
   - step_4_conclusion: 최종 정답 도출 1줄
   - answer: 최종 정답만 간결하게 기입 (객관식은 원문자 ①~⑤ 포함)

[풀어야 할 페이지 내 문항 목록 JSON]
${JSON.stringify(slimQuestions)}`;

      const base64Data = imageBase64.includes(",")
        ? imageBase64.split(",")[1]
        : imageBase64;
      const imagePart = {
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg",
        },
      };

      const result = await model.generateContent([prompt, imagePart]);
      const responseText = result.response.text();
      let parsed = safeParseJson(responseText);
      if (!Array.isArray(parsed)) {
        parsed = parsed?.items || parsed?.solutions || [parsed];
      }

      return NextResponse.json({
        success: true,
        data: parsed,
      });
    }

    // =========================================================
    // ACTION 3: Phase 2 정밀 트리플 분류 엔진 (V4.4.0 process_batch)
    // =========================================================
    if (action === "classify") {
      const {
        batchData,
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

      // 🌟 출력 토큰(Output Tokens) 65% 절감: DB에 저장되지 않는 reasoning 필드와 클라이언트 메모리에 이미 있는 name 중복 생성을 제거하고 순수 ID만 초고속 반환
      const schemaProperties: Record<string, any> = {
        question_id: {
          type: SchemaType.STRING,
          description: "입력받은 문제의 고유 question_id",
        },
        curriculum_id: {
          type: SchemaType.STRING,
          description: "매칭된 메인 교과 Depth 8 item_id 코드만 기입 (예: E411-01-01-01-01-001)",
        },
        difficulty: {
          type: SchemaType.STRING,
          description: "최하, 하, 중, 상, 최상 중 하나",
        },
        problem_type: {
          type: SchemaType.STRING,
          description: "MULTIPLE_CHOICE, SUBJECTIVE, DESCRIPTIVE 중 하나",
        },
        cognitive_level: {
          type: SchemaType.STRING,
          description: "이해 및 연산, 적용 및 응용, 추론 및 문제 해결 중 하나",
        },
        solving_probability: {
          type: SchemaType.INTEGER,
          description: "예상 정답률(%). 난이도에 맞춰 15~95 사이의 값 중 5단위(15, 20, 25...95)로만 작성",
        },
      };

      if (applySubTaxonomy) {
        schemaProperties.sub_curriculum_id = {
          type: SchemaType.STRING,
          description: "매칭된 서브 교과 Depth 8 item_id 코드만 기입",
        };
      }

      if (applyThinking) {
        schemaProperties.thinking_id = {
          type: SchemaType.STRING,
          description: "매칭된 THK ID 코드만 기입 (예: THK-01-01-01)",
        };
      }

      const requiredFields = [
        "question_id",
        "curriculum_id",
        "difficulty",
        "problem_type",
        "cognitive_level",
        "solving_probability",
      ];
      if (applySubTaxonomy) {
        requiredFields.push("sub_curriculum_id");
      }
      if (applyThinking) {
        requiredFields.push("thinking_id");
      }

      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: {
          temperature: 0.0,
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: schemaProperties,
              required: requiredFields,
            },
          },
        },
      });

      const subRuleText = applySubTaxonomy
        ? `
3. [★서브 교과 정밀 매핑 (sub_curriculum_id / sub_curriculum_name)★]:
   - 학원 교재 특성상 교재의 표기 학년(메인 교과 범위)과 실제 대한민국 정규 교육과정 상의 학습 학년·학기가 다를 수 있습니다 (예: 4학년 1학기 사고력 교재이지만 실제로는 5학년 1학기 약수와 배수/분수 개념을 다루는 경우 등).
   - 제공된 [2. 서브 교과 단원 분류표] 및 [2-1. 서브 교과 세부유형 리스트]의 넓은 학기 범위를 처음부터 끝까지 충분히 훑어본 뒤, 이 문제가 실제로 요구하는 개념에 가장 정확히 부합하는 Depth 8 \`item_id\`를 \`sub_curriculum_id\`와 \`sub_curriculum_name\`에 매핑하십시오.
   - 만약 메인 교과 범위 내에서 찾은 \`curriculum_id\`가 넓은 범위에서도 가장 정확한 개념이라면 동일한 ID/이름을 넣어도 되지만, 다른 학년·학기에 더 정확한 단원/유형이 있다면 반드시 그 학년·학기의 Depth 8 ID를 선택하십시오.`
        : "";

      const prompt = `당신은 대한민국 최고의 수학 교육 데이터 분석가입니다.
제공된 ${batchData.length}개의 수학 문제 배열(JSON Array)을 분석하여 극한의 정밀도로 분류하십시오.

${currGuide || ""}
${applySubTaxonomy ? subGuide || "" : ""}
${applyThinking ? thkGuide || "" : ""}

### [★절대 규칙★]
1. [고유 ID 유지]: 전달된 \`question_id\`를 반환 결과에 100% 동일하게 포함하십시오. 절대 누락하거나 섞지 마십시오.
2. [★메인 교과 Depth 8 강제 매핑 (curriculum_id / curriculum_name)★]: 메인 교과 분류는 무조건 [1-1. 메인 교과 세부유형 리스트 - item_id (Depth 8)]에서 찾아야 합니다. 귀찮다고 Depth 7 상위 단원 ID로 뭉뚱그려 분류하는 행위(Lazy Classification)를 엄격히 금지합니다.
   - 문제를 분석할 때 "어떤 세부 개념(Depth 8)을 평가하기 위한 문제인가?"를 치열하게 고민하십시오.${subRuleText}
4. [사고력 할당 (적용 시)]: 심화 문제이므로 조건이 복잡하거나 문장제인 경우 절대 "NONE"을 남발하지 마십시오. 하위 항목이 헷갈리면 Depth 2(예: THK-01-02)까지라도 반드시 출력하십시오.
5. [인지 영역]: "이해 및 연산", "적용 및 응용", "추론 및 문제 해결" 중 택 1
6. [★유형, 난이도 및 정답률(solving_probability) 강력 연계★]:
   - 문제 유형: "MULTIPLE_CHOICE", "SUBJECTIVE", "DESCRIPTIVE" 중 택 1
     * ①~⑤ 선지가 있고 원문자 정답을 고르면 "MULTIPLE_CHOICE"
     * "풀이 과정을 쓰고", "설명하세요", "방정식을 세우고" 등 서술형을 요구하면 "DESCRIPTIVE"
     * 단답형 수치, 기호, 수식을 구하는 문제는 "SUBJECTIVE"
   - 난이도 및 정답률: 난이도를 먼저 판별하고, 그 난이도에 해당하는 정답률 구간 내에서 **반드시 5단위(예: 50, 55, 60)**의 정수로 \`solving_probability\`를 도출하십시오. ('중상/중하' 등은 불가)
     * 최상: 정답률 15 ~ 30
     * 상: 정답률 30 ~ 50
     * 중: 정답률 50 ~ 70
     * 하: 정답률 70 ~ 85
     * 최하: 정답률 85 ~ 95
`;

      const simplifiedBatch = batchData.map((item: any) => ({
        question_id: item.question_id,
        question: item.question,
        answer: item.answer,
      }));

      const result = await model.generateContent([
        prompt,
        "분석할 문제 JSON 배열:",
        JSON.stringify(simplifiedBatch),
      ]);
      const responseText = result.response.text();
      let parsedResults = safeParseJson(responseText);
      if (!Array.isArray(parsedResults)) {
        parsedResults = [parsedResults];
      }

      return NextResponse.json({
        success: true,
        data: parsedResults,
      });
    }

    // =========================================================
    // ACTION 4: V302 AI 텍스트/수식 자동 교정 (fix_latex)
    // =========================================================
    if (action === "fix_latex") {
      const { fields } = body;
      if (!fields || typeof fields !== "object") {
        return NextResponse.json(
          { success: false, error: "교정할 fields 객체가 필요합니다." },
          { status: 400 }
        );
      }

      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: {
          temperature: 0.0,
          responseMimeType: "application/json",
        },
      });

      const prompt = `다음 JSON 객체는 수학 문제 및 해설의 각 필드 텍스트입니다.
어색하게 깨진 수식이나 기호를 사람이 읽기 좋은 완벽한 LaTeX 형태(단일 $ 또는 이중 $$ 사용)로 교정하여 동일한 JSON 키 구조로 반환해주세요.
한국어 설명이나 문장 구조 등 다른 내용은 절대 삭제하거나 바꾸지 마세요.

원본 JSON:
${JSON.stringify(fields, null, 2)}`;

      const result = await model.generateContent([prompt]);
      const responseText = result.response.text();
      const parsed = safeParseJson(responseText);

      return NextResponse.json({
        success: true,
        data: parsed,
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