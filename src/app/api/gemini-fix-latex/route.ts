// src/app/api/gemini-fix-latex/route.ts
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { NextResponse } from "next/server";

const circleMap: Record<string, string> = {
  'ㄱ':'㉠', 'ㄴ':'㉡', 'ㄷ':'㉢', 'ㄹ':'㉣', 'ㅁ':'㉤', 'ㅂ':'㉥', 'ㅅ':'㉦', 'ㅇ':'㉧', 'ㅈ':'㉨', 'ㅊ':'㉩', 'ㅋ':'㉪', 'ㅌ':'㉫', 'ㅍ':'㉬', 'ㅎ':'㉭',
  '1':'①', '2':'②', '3':'③', '4':'④', '5':'⑤', '6':'⑥', '7':'⑦', '8':'⑧', '9':'⑨', '10':'⑩',
  'a':'ⓐ', 'b':'ⓑ', 'c':'ⓒ', 'd':'ⓓ', 'e':'ⓔ'
};

// 🌟 괄호 유무, 띄어쓰기, \text 중첩 등 모든 파편화된 원문자를 완벽하게 ㉠으로 치환
function forceCleanSymbols(text: string) {
  if (!text) return text;
  let res = text;
  
  res = res.replace(/\\(?:text)?circled\s*(?:\{\s*\\text\s*\{\s*([가-힣a-zA-Z0-9]+)\s*\}\s*\}|\{\s*([가-힣a-zA-Z0-9]+)\s*\}|([가-힣a-zA-Z0-9]))/g, (m, p1, p2, p3) => {
    const key = p1 || p2 || p3;
    return circleMap[key] || m;
  });
  
  return res;
}

export async function POST(req: Request) {
  try {
    const rawPayload = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ success: false, error: "서버에 API 키가 설정되지 않았습니다." });
    }

    // 🛡️ 1차 방어: 깨진 기호 완벽 치환
    const payload = {
      question: forceCleanSymbols(rawPayload.question),
      answer: forceCleanSymbols(rawPayload.answer),
      step_1_concept: forceCleanSymbols(rawPayload.step_1_concept),
      step_2_approach: forceCleanSymbols(rawPayload.step_2_approach),
      step_3_process: forceCleanSymbols(rawPayload.step_3_process),
      step_4_conclusion: forceCleanSymbols(rawPayload.step_4_conclusion)
    };

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // 🌟 최신 3.5 모델 적용
    const model = genAI.getGenerativeModel({
      model: "gemini-3.5-flash",
      generationConfig: {
        temperature: 0.1, 
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            question: { type: SchemaType.STRING },
            answer: { type: SchemaType.STRING },
            step_1_concept: { type: SchemaType.STRING },
            step_2_approach: { type: SchemaType.STRING },
            step_3_process: { type: SchemaType.STRING },
            step_4_conclusion: { type: SchemaType.STRING }
          }
        }
      }
    });

    const prompt = `
      다음은 수학 문제 및 해설의 각 필드 텍스트입니다. 
      어색하게 깨진 수식이나 기호를 사람이 읽기 좋은 완벽한 LaTeX 형태(단일 $ 또는 이중 $$ 사용)로 교정해주세요. 
      한국어 설명 등 다른 내용은 절대 삭제하거나 바꾸지 말고, 오직 수식만 완벽하게 교정하여 그대로 출력하세요.
      값이 비어있는 필드는 내용 없이 그대로 비워두세요.

      [🚨 특수 규칙]
      수식 내부의 원문자(예: ㉠, ① 등)는 그대로 유니코드를 유지하십시오. 절대 다시 LaTeX 기호로 풀어서 쓰지 마세요.

      [원본 텍스트 데이터]
      ${JSON.stringify(payload, null, 2)}
    `;

    const result = await model.generateContent(prompt);
    let responseText = result.response.text();
    
    responseText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsedData;
    try {
      parsedData = JSON.parse(responseText);
    } catch (parseError) {
      const escapedText = responseText.replace(/\\/g, '\\\\');
      parsedData = JSON.parse(escapedText);
    }

    // 🛡️ 2차 방어
    parsedData.question = forceCleanSymbols(parsedData.question);
    parsedData.answer = forceCleanSymbols(parsedData.answer);
    parsedData.step_1_concept = forceCleanSymbols(parsedData.step_1_concept);
    parsedData.step_2_approach = forceCleanSymbols(parsedData.step_2_approach);
    parsedData.step_3_process = forceCleanSymbols(parsedData.step_3_process);
    parsedData.step_4_conclusion = forceCleanSymbols(parsedData.step_4_conclusion);

    return NextResponse.json({ success: true, data: parsedData });

  } catch (error: any) {
    console.error("LaTeX Auto Fix Error:", error);
    return NextResponse.json({ success: false, error: error.message });
  }
}