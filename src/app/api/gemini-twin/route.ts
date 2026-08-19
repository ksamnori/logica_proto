// src/app/api/gemini-twin/route.ts
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { originalQuestion, originalAnswer, taxonomyStr } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: "서버에 API 키가 설정되지 않았습니다." }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // 쌍둥이 및 유사 문항 생성 스키마
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.7, 
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              question_type: { type: SchemaType.STRING, description: "'쌍둥이' 또는 '유사'" },
              question: { type: SchemaType.STRING, description: "생성된 문제 텍스트 (LaTeX 수식 포함)" },
              answer: { type: SchemaType.STRING, description: "생성된 문제의 단답형 정답" },
              step_1_concept: { type: SchemaType.STRING, description: "핵심 개념 1줄 요약" },
              step_2_approach: { type: SchemaType.STRING, description: "전략 2~3줄 요약" },
              step_3_process: { type: SchemaType.STRING, description: "주요 방정식 2~5개만 세우고 종료" },
              step_4_conclusion: { type: SchemaType.STRING, description: "최종 정답 1줄" }
            },
            required: ["question_type", "question", "answer", "step_1_concept", "step_2_approach", "step_3_process", "step_4_conclusion"]
          }
        }
      }
    });

    const prompt = `
      당신은 초중등 수학 교재의 해설지 전문 작성 및 클리닉 문항 출제 AI입니다.
      학생이 틀린 문제를 완벽하게 복습할 수 있도록 변형 문제 딱 2개를 생성하십시오.

      [원본 문항 정보]
      - 문항 분류(Taxonomy): ${taxonomyStr}
      - 원본 문제 텍스트: ${originalQuestion}
      - 원본 정답: ${originalAnswer || '제공되지 않음'}

      [🚨 변형 문항 출제 규칙 (정확히 2개 생성)]
      1. 첫 번째 문항 "쌍둥이" (동일 난이도): 원본 뼈대 유지. 숫자/조건만 비틀기. (question_type: "쌍둥이")
      2. 두 번째 문항 "유사" (동일 난이도): 핵심 개념은 같으나 역방향 추론이나 실생활 문장제로 비틀기. (question_type: "유사")

      [🚨 해설 작성 및 치명적 금지 사항]
      1. 분량 제한: 각 step 필드는 무조건 '최대 3문장' 또는 '최대 3줄' 이내로 작성. 계산 전개가 길어져도 강제 종료.
      2. 수식 포맷: 달러 기호($)를 사용한 LaTeX 형식 유지. (예: 분수는 \\frac{1}{2})
      3. step_1_concept: 핵심 개념 1줄 요약. ("이 문제는 ~한 문제이므로 ~을 생각하여 푼다." 등)
      4. step_2_approach: 전략 2~3줄 요약.
      5. step_3_process: [집중 주의] 주요 방정식 2~5개만 세우고 즉시 멈추십시오. 번호 매기며 끝없이 전개 금지.
      6. step_4_conclusion: 최종 정답만 딱 1줄.
      7. answer: 정답 텍스트만 짧게 기입.
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    return NextResponse.json({ success: true, data: JSON.parse(responseText) });

  } catch (error: any) {
    console.error("Twin Generator Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}