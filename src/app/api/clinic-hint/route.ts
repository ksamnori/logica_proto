import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { questionText } = await req.json();
    
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    // API 키가 없으면 그냥 빈 값을 반환하여 클라이언트에서 기본 문구를 띄우게 함
    if (!apiKey) {
      return NextResponse.json({ hint: null });
    }

    const prompt = `당신은 초중고 수학 과외 선생님입니다. 문제: ${questionText.replace(/<[^>]+>/g, '')}\n\n학생이 문제를 풀 수 있도록 핵심 개념과 접근 방향에 대한 힌트를 2~3문장으로 주세요. 정답은 절대 말하지 마세요.`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ 
        contents: [{ role: 'user', parts: [{ text: prompt }] }], 
        generationConfig: { temperature: 0.4 } 
      })
    });

    if (!res.ok) throw new Error('API 오류');
    
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    
    return NextResponse.json({ hint: text });
  } catch (error: any) {
    return NextResponse.json({ hint: null });
  }
}