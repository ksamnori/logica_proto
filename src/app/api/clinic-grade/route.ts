import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    // 🌟 학생용 API이므로 서버 토큰 검증(자물쇠)을 해제합니다.
    const { imageDataUrl, correct, questionText } = await req.json();
    
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

    if (!apiKey) {
      return NextResponse.json({ error: '서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 });
    }

    const mimeMatch = typeof imageDataUrl === 'string' ? imageDataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/) : null;
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
    const base64 = String(imageDataUrl || '').split(',')[1] || '';
    
    const prompt = `당신은 수학 채점자입니다. 첨부된 이미지 속 학생의 손글씨 답안을 채점하세요.

문제 지문: ${(questionText || '').replace(/<[^>]+>/g, '')}
정답(원문): "${correct}"

지침:
- 첨부된 이미지에는 배경의 인쇄된 문제(수식, 세로셈, 빈칸 네모 □, 도형, 표 등)와 그 위에 학생이 펜으로 직접 작성한 손글씨 답안이 함께 합성되어 있습니다.
- 인쇄된 문제나 빈칸(□) 위에 학생이 손으로 써넣은 숫자·기호·수식을 문제의 맥락(각 빈칸의 위치 및 순서)에 맞춰 정확히 읽으세요.
- 빈칸(□)이 여러 개인 문제라면 학생이 각 빈칸에 적어 넣은 값들을 모두 확인하여 정답("${correct}")과 일치하는지 판단하세요.
- 학생이 답을 지우거나 위에 덧쓴 경우, 최종적으로 남긴 답을 기준으로 판단하세요.
- 표기 형식이 정답과 다르더라도 수학적으로 동일하면 정답으로 처리하세요 (예: "4"와 "4.0", "1/2"와 "0.5", "-3"과 "－3", 여러 빈칸의 값을 순서대로 모두 맞힌 경우 등).
- 글씨가 불명확해서 여러 숫자/기호로 읽힐 수 있으면, 가장 가능성 높은 해석을 recognized_text에 적고 confidence를 낮게 주세요.
- 반드시 아래 JSON 스키마의 필드명을 정확히 그대로 사용해 응답하세요.`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              recognized_text: { type: 'STRING' },
              is_correct: { type: 'BOOLEAN' },
              confidence: { type: 'NUMBER' },
              explanation: { type: 'STRING' }
            },
            required: ['recognized_text', 'is_correct', 'confidence', 'explanation']
          },
          temperature: 0
        }
      })
    });

    if (!res.ok) throw new Error('Google API 호출 실패');
    
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    return NextResponse.json(JSON.parse(text.replace(/```json|```/g, '').trim()));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
