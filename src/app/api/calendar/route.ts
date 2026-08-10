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

    // 🌟 [수정됨] 오늘 기준이 아니라 '3달 전'부터 가져오도록 시간 설정
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const res = await calendar.events.list({
      calendarId: targetCalId,
      timeMin: threeMonthsAgo.toISOString(), // 👈 3개월 전 데이터부터 로드
      maxResults: 300, // 👈 과거 일정까지 가져오므로 여유있게 최대 개수를 늘림
      singleEvents: true,
      orderBy: 'startTime',
    });

    return NextResponse.json({ success: true, events: res.data.items });
  } catch (error: any) {
    console.error("Google Calendar GET Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 📌 [Logica -> 구글] 일정 삭제 (DELETE)
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const title = searchParams.get('title');

    if (!title) {
      return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 });
    }

    const auth = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    
    // 🌟 [수정됨] POST, GET과 동일하게 TARGET_CALENDAR_ID 변수를 사용하도록 통일
    const calendarId = process.env.TARGET_CALENDAR_ID || 'primary';

    // 1. 해당 제목을 가진 구글 캘린더 일정을 검색합니다.
    const res = await calendar.events.list({
      calendarId,
      q: title,
      singleEvents: true,
    });

    const events = res.data.items || [];
    
    // 2. 검색된 일치하는 일정을 일괄 삭제합니다 (보통 1개).
    for (const event of events) {
      if (event.id) {
        await calendar.events.delete({
          calendarId,
          eventId: event.id,
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Calendar Delete Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}