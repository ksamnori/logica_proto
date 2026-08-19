// src/app/api/gemini-parse/route.ts
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    // 환경 변수에 등록된 API 키를 사용합니다.
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: "서버에 API 키가 설정되지 않았습니다." }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // 원장님의 Python 코드와 동일한 2.5-flash 모델 및 스키마 적용
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.0,
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
                  sub_num: { type: SchemaType.INTEGER },
                  question: { type: SchemaType.STRING }
                }
              }
            }
          }
        }
      }
    });

    const prompt = `
      당신은 초등 수학 교재(로지카 MAX) 문제 판독 엔진입니다.
      제공된 이미지는 교재의 한 페이지 전체입니다.

      ### [🚨 치명적 금지 사항 (요약 절대 금지) 🚨]
      1. **뭉뚱그리기 엄벌**: 이미지에 '(1)'부터 '(6)'까지 괄호 문항이 6개 보이면, 반드시 6개의 개별 JSON 객체로 분리하여 추출해야 합니다.
      2. **문항 번호 고정**: "개념 확인", "개념 노트", "QUIZ" 등은 번호가 아니니 무시하고 "Q" 기입. '확인 3'은 띄어쓰기 없이 "확인3"으로 기입.

      ### [🚨 추출 규칙 🚨]
      1. **공통 지시문 복제**: 공통 지시문은 쪼개진 모든 소문항 텍스트 앞에 빠짐없이 복사하여 붙이십시오.
      2. **수식 및 빈칸 처리**: 분수는 \\frac{}{}, 빈칸(네모)은 \\square 기호를 사용해 자연스러운 달러($) 수식으로 변환하십시오.
      3. **페이지 번호 강력 탐지 (가장 중요)**: PDF 물리적 순서와 종이에 인쇄된 실제 페이지 번호는 완전히 다릅니다! 반드시 이미지의 최하단(바닥) 구석을 샅샅이 살펴보고 종이에 인쇄된 실제 페이지 번호(숫자)를 찾아 final_printed_page에 기입하십시오.
    `;

    const imagePart = {
      inlineData: {
        data: imageBase64.split(",")[1], // base64 헤더 제거
        mimeType: "image/jpeg"
      }
    };

    const result = await model.generateContent([prompt, imagePart]);
    const responseText = result.response.text();
    
    return NextResponse.json({ success: true, data: JSON.parse(responseText) });

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}