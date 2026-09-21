// src/app/api/gemini-parse/route.ts
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    // 🔒 1. 보안 자물쇠: 토큰 검증
    let token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) token = req.cookies.get("sb-access-token")?.value;
    if (!token) {
      const allCookies = req.cookies.getAll();
      const authCookie = allCookies.find(c => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'));
      if (authCookie) {
        try { token = JSON.parse(authCookie.value)[0]; } catch(e) {}
      }
    }

    if (!token) return NextResponse.json({ success: false, error: "Unauthorized: 접근 권한이 없습니다." }, { status: 401 });

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) return NextResponse.json({ success: false, error: "Unauthorized: 유효하지 않은 세션입니다." }, { status: 401 });

    // ----------------------------------------------------
    // 2. 본문 로직
    // ----------------------------------------------------
    const { imageBase64 } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ success: false, error: "서버에 API 키가 설정되지 않았습니다." }, { status: 500 });

    const genAI = new GoogleGenerativeAI(apiKey);
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
        data: imageBase64.split(",")[1],
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