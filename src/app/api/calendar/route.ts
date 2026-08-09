// src/app/api/calendar/route.ts
import { NextResponse } from 'next/server';
import { google } from 'googleapis';

// 💡 서비스 계정 인증 헬퍼 함수
const getAuth = () => {
  const credentials = {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    // 환경변수 줄바꿈 문자(\n)를 실제 줄바꿈으로 치환
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };
  
  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
};

// 📌 [Logica -> 구글] 일정 쓰기 (POST)
export async function POST(request: Request) {
  try {
    const auth = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    
    const { events } = await request.json();
    const targetCalId = process.env.TARGET_CALENDAR_ID;

    const results = [];
    // 여러 개의 일정(반복 일정 등)을 구글에 순차적으로 꽂아 넣음
    for (const ev of events) {
      const res = await calendar.events.insert({
        calendarId: targetCalId,
        requestBody: ev,
      });
      results.push(res.data);
    }
    
    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error("Google Calendar POST Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 📌 [구글 -> Logica] 일정 읽어오기 (GET) - 양방향 통신용
export async function GET() {
  try {
    const auth = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const targetCalId = process.env.TARGET_CALENDAR_ID;

    // 오늘부터 다가오는 구글 캘린더 일정 최대 100개 긁어오기
    const res = await calendar.events.list({
      calendarId: targetCalId,
      timeMin: new Date().toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return NextResponse.json({ success: true, events: res.data.items });
  } catch (error: any) {
    console.error("Google Calendar GET Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}