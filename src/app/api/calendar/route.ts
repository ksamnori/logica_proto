// src/app/api/calendar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// 🔒 보안 자물쇠: 토큰 검증 헬퍼 함수
async function verifyAuth(req: NextRequest) {
  let token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) token = req.cookies.get("sb-access-token")?.value;
  if (!token) {
    const allCookies = req.cookies.getAll();
    const authCookie = allCookies.find(c => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'));
    if (authCookie) {
      try { token = JSON.parse(authCookie.value)[0]; } catch(e) {}
    }
  }

  if (!token) return false;

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) return false;
  return true;
}

const getAuth = () => {
  const credentials = {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };
  
  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
};

export async function POST(request: NextRequest) {
  try {
    if (!(await verifyAuth(request))) {
      return NextResponse.json({ success: false, error: "Unauthorized: 접근 권한이 없습니다." }, { status: 401 });
    }

    const auth = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    
    const { events } = await request.json();
    const targetCalId = process.env.TARGET_CALENDAR_ID;

    const results = [];
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

export async function GET(request: NextRequest) {
  try {
    if (!(await verifyAuth(request))) {
      return NextResponse.json({ success: false, error: "Unauthorized: 접근 권한이 없습니다." }, { status: 401 });
    }

    const auth = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const targetCalId = process.env.TARGET_CALENDAR_ID;

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const res = await calendar.events.list({
      calendarId: targetCalId,
      timeMin: threeMonthsAgo.toISOString(), 
      maxResults: 300, 
      singleEvents: true,
      orderBy: 'startTime',
    });

    return NextResponse.json({ success: true, events: res.data.items });
  } catch (error: any) {
    console.error("Google Calendar GET Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!(await verifyAuth(request))) {
      return NextResponse.json({ success: false, error: "Unauthorized: 접근 권한이 없습니다." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const title = searchParams.get('title');

    if (!title) {
      return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 });
    }

    const auth = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    
    const calendarId = process.env.TARGET_CALENDAR_ID || 'primary';

    const res = await calendar.events.list({
      calendarId,
      q: title,
      singleEvents: true,
    });

    const events = res.data.items || [];
    
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