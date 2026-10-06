// src/app/api/gemini-competency/route.ts
// 유형(depth7/depth6) 묶음을 받아 2022 개정 수학과 교과 역량(5개)을 판정한다.
// DB에는 쓰지 않는다. 결과 저장은 화면(강사 세션)에서 한다.
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const COMPETENCIES = ["문제해결", "추론", "의사소통", "연결", "정보처리"] as const;
const MODEL_NAME = process.env.GEMINI_COMPETENCY_MODEL || "gemini-3.5-flash";
const MAX_ITEMS = 40;

type InItem = {
  category_id: string;
  path: string;
  cognitive?: Record<string, number>;
  samples?: string[];
};

const RUBRIC = `
[2022 개정 수학과 교과 역량 판정 기준]
- 문제해결: 주어진 조건과 정보를 분석해 해결 전략을 세우고 값을 구하거나 상황을 해결한다. 개념·공식을 적용해 답을 "구하는" 전형적인 문항.
- 추론: 성질·규칙을 발견하거나, 이유를 설명·정당화·증명하거나, 참/거짓을 판단하거나, 귀납·유추·연역으로 결론을 이끈다.
- 의사소통: 수학 용어·기호·식·표·그래프 같은 표현을 해석하고 정확히 사용하거나, 표현 사이를 변환한다 (문장↔식, 식↔그래프, 용어의 뜻).
- 연결: 다른 단원·영역·학년의 개념을 함께 사용하거나, 실생활·다른 교과 맥락에 수학을 적용한다.
- 정보처리: 자료를 수집·정리·표현·해석한다 (표, 그래프, 도수분포, 대푯값·산포도 같은 통계량, 측정 자료), 또는 계산기·공학 도구를 활용한다. 자료를 읽고 그 자료에서 값을 구하는 것도 정보처리다.

[판정 규칙]
1. 유형의 전형적인 문항이 학생에게 "가장 중심적으로" 요구하는 역량을 primary 하나로 고른다.
2. secondary는 그 유형 문항의 상당수가 뚜렷하게 함께 요구할 때만 고르고, 아니면 빈 문자열로 둔다. primary와 같으면 안 된다.
3. 거의 모든 문항이 "구하시오"라는 이유만으로 습관적으로 문제해결을 고르지 말고, 다른 역량이 더 정확하면 그것을 고른다.
4. 사고 수준 분포는 참고 단서다. "추론 및 문제 해결" 비중이 높으면 추론·문제해결 쪽, 표현 변환 성격의 "이해 및 연산" 비중이 높으면 의사소통 쪽일 가능성이 있다.
5. 대표 문항이 없으면 경로(단원·유형 이름)만으로 판단하고 confidence를 낮게 준다.
6. confidence는 0~1 사이로 정직하게 준다. 두 역량 사이에서 망설여지면 0.6 미만.
7. reason은 한국어 50자 이내로, 왜 그 역량인지 핵심만 쓴다.
8. [자료·통계 문항 우선 규칙] 표·그래프(막대·꺾은선·그림·띠·원그래프, 히스토그램, 도수분포다각형, 줄기와 잎, 산점도)·도수분포표·통계량이 문항의 중심이고,
   자료를 읽거나 정리·해석해서 값(백분율, 각도, 전체 수량, 지워진 값, 평균·분산 등)을 구하면 "계산한다"는 이유로 문제해결을 고르지 말고 정보처리를 primary로 고른다.
   예외: 미지수에 대한 방정식을 세우는 것이 핵심이면 문제해결, 성질을 정당화·비교 판단하는 것이 핵심이면 추론,
   용어·개념 이해나 표현 사이의 변환이 핵심이면 의사소통을 primary로 하고, 이때 정보처리를 secondary로 고려한다.
   함수의 그래프(일차함수, 이차함수 등)는 자료가 아니므로 이 규칙을 적용하지 않는다.
`;

function truncate(s: string, n: number) {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

export async function POST(req: NextRequest) {
  try {
    // 🔒 1. 토큰 검증 (다른 gemini 라우트와 동일 방식)
    let token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) token = req.cookies.get("sb-access-token")?.value;
    if (!token) {
      const authCookie = req.cookies.getAll().find(c => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));
      if (authCookie) { try { token = JSON.parse(authCookie.value)[0]; } catch (e) {} }
    }
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized: 접근 권한이 없습니다." }, { status: 401 });

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ success: false, error: "Unauthorized: 유효하지 않은 세션입니다." }, { status: 401 });

    // 2. 입력 정리
    const body = await req.json();
    const items: InItem[] = Array.isArray(body?.items) ? body.items.slice(0, MAX_ITEMS) : [];
    const run: number = body?.run === 2 ? 2 : 1;
    if (items.length === 0) return NextResponse.json({ success: false, error: "판정할 유형이 없습니다." });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ success: false, error: "서버에 API 키가 설정되지 않았습니다." });

    const payload = items.map(it => ({
      category_id: String(it.category_id),
      path: truncate(it.path, 200),
      cognitive_distribution: it.cognitive || {},
      sample_questions: (it.samples || []).slice(0, 3).map(s => truncate(s, 260)),
    }));

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        // 2차 검증은 온도를 높여, 1차와 다르게 나오는(불안정한) 유형을 찾아낸다
        temperature: run === 2 ? 0.7 : 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              category_id: { type: SchemaType.STRING },
              primary: { type: SchemaType.STRING, enum: [...COMPETENCIES] } as any,
              secondary: { type: SchemaType.STRING },
              confidence: { type: SchemaType.NUMBER },
              reason: { type: SchemaType.STRING },
            },
            required: ["category_id", "primary", "confidence", "reason"],
          },
        },
      },
    });

    const prompt = `
당신은 한국 초·중·고 수학 교육과정 전문가입니다.
아래 수학 문제 유형 목록 각각에 대해 2022 개정 수학과 교과 역량을 판정하세요.
${RUBRIC}
[출력]
입력과 같은 개수, 같은 category_id로 JSON 배열을 출력하세요.
primary는 반드시 다음 중 하나: ${COMPETENCIES.join(", ")}
secondary는 위 다섯 중 하나 또는 빈 문자열.

[유형 목록]
${JSON.stringify(payload, null, 1)}
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("AI 응답 형식이 배열이 아닙니다.");

    const validIds = new Set(payload.map(p => p.category_id));
    const isComp = (v: any) => (COMPETENCIES as readonly string[]).includes(v);

    const data = parsed
      .filter((r: any) => r && validIds.has(String(r.category_id)) && isComp(r.primary))
      .map((r: any) => {
        const secondary = isComp(r.secondary) && r.secondary !== r.primary ? r.secondary : null;
        let confidence = Number(r.confidence);
        if (!isFinite(confidence)) confidence = 0;
        confidence = Math.max(0, Math.min(1, confidence));
        return {
          category_id: String(r.category_id),
          primary: r.primary,
          secondary,
          confidence,
          reason: truncate(String(r.reason || ""), 80),
        };
      });

    return NextResponse.json({ success: true, model: MODEL_NAME, run, data });
  } catch (error: any) {
    console.error("Competency mapping error:", error);
    return NextResponse.json({ success: false, error: error?.message || "AI 판정 중 오류가 발생했습니다." });
  }
}
