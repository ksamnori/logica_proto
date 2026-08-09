// src/app/api/ai-minutes/route.ts
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// OpenAI 인스턴스 초기화 (환경 변수에서 자동으로 키를 읽어옵니다)
const openai = new OpenAI();

const SYSTEM_PROMPT = `너는 학원(Academy) 운영 및 학습 관리 시스템(LMS) 'Logica'의 최고 수준 AI 회의록 분석 비서야.
제공되는 텍스트는 [주간 강사 회의]의 음성 인식(STT) 기록이야.
아래의 JSON 포맷 규칙에 맞춰서 회의 내용을 분석하고 구조화해 줘. 텍스트 외의 다른 말은 절대 덧붙이지 마.

[분석 지침]
1. summary: 회의 전체의 핵심 논의 사항을 3~4줄로 요약해.
2. decisions: 회의에서 최종적으로 확정된 규칙이나 결정 사항을 배열로 나열해.
3. tasks: 회의 중 누군가에게 지시되거나 합의된 '업무(Action Item)'를 모두 추출해.
   - assignee: 담당자 이름 (명확하지 않으면 '미정')
   - role: 담당자의 역할 (homeroom_teacher, assistant, director, sub_director, unknown 중 택 1)
   - task_type: 업무의 종류 (incorrect_answer_print, grading, consult, general 중 택 1. 오답 관련 언급 시 무조건 incorrect_answer_print)
   - description: 구체적인 업무 내용 요약
   - deadline: 기한이 언급되었다면 추출 (없으면 null)

[출력 포맷 (반드시 유효한 JSON 형식일 것)]
{
  "summary": "...",
  "decisions": ["...", "..."],
  "tasks": [
    {
      "assignee": "...",
      "role": "...",
      "task_type": "...",
      "description": "...",
      "deadline": "..."
    }
  ]
}`;

export async function POST(request: Request) {
  try {
    const { transcript } = await request.json();

    if (!transcript) {
      return NextResponse.json(
        { success: false, error: "녹음 텍스트(transcript)가 제공되지 않았습니다." }, 
        { status: 400 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 가성비와 속도가 가장 뛰어난 최신 경량 모델
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript }
      ],
      // 💡 [핵심] OpenAI가 무조건 JSON 형태로만 응답하도록 강제합니다.
      response_format: { type: "json_object" }, 
      // 💡 창의적인 소설을 쓰지 않고 사실(녹음 기록)에만 기반하도록 온도를 낮춥니다.
      temperature: 0.2, 
    });

    // OpenAI의 응답 텍스트를 꺼내서 JSON 객체로 파싱합니다.
    const rawContent = completion.choices[0].message.content;
    const parsedData = JSON.parse(rawContent || "{}");

    return NextResponse.json({ success: true, data: parsedData });
    
  } catch (error: any) {
    console.error("AI Minutes API Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "AI 분석 중 오류가 발생했습니다." }, 
      { status: 500 }
    );
  }
}