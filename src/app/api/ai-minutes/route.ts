// src/app/api/ai-minutes/route.ts
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI();

const BASE_SYSTEM_PROMPT = `너는 학원(Academy) 운영 및 학습 관리 시스템(LMS) 'Logica'의 최고 수준 AI 회의록 분석 비서야.
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
    // 💡 프론트엔드에서 attendees(참석자) 정보도 함께 받아옵니다.
    const { transcript, attendees } = await request.json();

    if (!transcript) {
      return NextResponse.json(
        { success: false, error: "녹음 텍스트(transcript)가 제공되지 않았습니다." }, 
        { status: 400 }
      );
    }

    // 💡 동적 프롬프트 생성: AI에게 실제 참석자 이름을 알려주고 매핑을 지시합니다.
    const dynamicPrompt = `이 회의의 실제 참석자는 [ ${attendees || '미정'} ] 입니다. 대화의 문맥과 화자들의 호칭을 파악하여, 화자 A, 화자 B 등의 식별자를 이 참석자들의 실제 이름으로 자동 매핑해서 요약해 주세요.\n\n${BASE_SYSTEM_PROMPT}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      messages: [
        { role: "system", content: dynamicPrompt },
        { role: "user", content: transcript }
      ],
      response_format: { type: "json_object" }, 
      temperature: 0.2, 
    });

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