import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { imageDataUrl, correct, questionText } = await req.json();
    
    // 서버 환경변수에서만 API 키를 가져옵니다. (브라우저 노출 X)
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    if (!apiKey) {
      return NextResponse.json({ error: '서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 });
    }

    const base64 = imageDataUrl.split(',')[1];
    
    const prompt = `당신은 수학 채점자입니다. 이미지 속 손글씨 답안을 채점하세요.

문제: ${questionText.replace(/<[^>]+>/g, '')}
정답(원문): "${correct}"

지침:
- 이미지의 옅은 회색 격자 배경은 무시하고, 학생이 손으로 쓴 잉크(펜) 자국만 답으로 읽으세요.
- 학생이 답을 지우거나 위에 덧쓴 경우, 최종적으로 남긴 것으로 보이는 답을 기준으로 판단하세요.
- 표기 형식이 정답과 다르더라도 수학적으로 동일하면 정답으로 처리하세요 (예: "4"와 "4.0", "1/2"와 "0.5", "-3"과 "－3").
- 글씨가 불명확해서 여러 숫자/기호로 읽힐 수 있으면, 가장 가능성 높은 해석을 recognized_text에 적고 confidence를 낮게 주세요.
- 반드시 아래 JSON 스키마의 필드명을 정확히 그대로 사용해 응답하세요.`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: 'image/webp', data: base64 } }] }],
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