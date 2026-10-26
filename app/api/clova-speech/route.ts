// src/app/api/clova-speech/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    // 🔒 보안 자물쇠: 토큰 검증
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
    // 본문 로직
    // ----------------------------------------------------
    const formData = await req.formData();
    const file = formData.get('media') as Blob;

    if (!file) {
      return NextResponse.json({ error: "음성 파일이 없습니다." }, { status: 400 });
    }

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

    const invokeUrl = `${process.env.CLOVA_SPEECH_INVOKE_URL}/recognizer/upload`;

    const response = await fetch(invokeUrl, {
      method: 'POST',
      headers: {
        'X-CLOVASPEECH-API-KEY': process.env.CLOVA_SPEECH_SECRET_KEY!
      },
      body: clovaFormData
    });

    const data = await response.json();
    
    if (data.result !== 'COMPLETED') {
      console.error("Clova API Error:", data);
      return NextResponse.json({ error: "음성 인식 중 오류가 발생했습니다." }, { status: 500 });
    }

    const segments = data.segments.map((seg: any) => ({
      speaker: seg.speaker.name,
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