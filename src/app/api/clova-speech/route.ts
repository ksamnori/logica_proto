// src/app/api/clova-speech/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('media') as Blob;

    if (!file) {
      return NextResponse.json({ error: "음성 파일이 없습니다." }, { status: 400 });
    }

    // 💡 클로바 스피치 옵션 설정 (한국어, 동기식 처리, 화자 분리 ON)
    const params = JSON.stringify({
      language: 'ko-KR',
      completion: 'sync', 
      diarization: {
        enable: true, 
      }
    });

    const clovaFormData = new FormData();
    clovaFormData.append('media', file);
    clovaFormData.append('params', params);

    // .env.local에 저장해둔 Invoke URL과 Secret Key 사용
    const invokeUrl = `${process.env.CLOVA_SPEECH_INVOKE_URL}/recognizer/upload`;

    const response = await fetch(invokeUrl, {
      method: 'POST',
      headers: {
        'X-CLOVASPEECH-API-KEY': process.env.CLOVA_SPEECH_SECRET_KEY!
      },
      body: clovaFormData
    });

    const data = await response.json();
    
    // 에러 발생 시 처리
    if (data.result !== 'COMPLETED') {
      console.error("Clova API Error:", data);
      return NextResponse.json({ error: "음성 인식 중 오류가 발생했습니다." }, { status: 500 });
    }

    // 화자 분리 결과물 맵핑
    const segments = data.segments.map((seg: any) => ({
      speaker: seg.speaker.name, // 화자 A, B, C 등
      text: seg.text,
      start: seg.start,
      end: seg.end
    }));

    return NextResponse.json({ success: true, segments });

  } catch (error: any) {
    console.error("Clova API Request failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}