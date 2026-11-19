// src/app/api/calendar/route.ts
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 🔒 보안 자물쇠: 학원 포털 사용자 토큰 검증 헬퍼 함수
async function verifyAuth(req: NextRequest): Promise<boolean> {
  let token = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();

  if (!token || token === "undefined" || token === "null") {
    token = req.cookies.get("sb-access-token")?.value?.trim();
  }

  if (!token || token === "undefined" || token === "null") {
    const allCookies = req.cookies.getAll();
    const authCookie = allCookies.find(
      (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
    );
    if (authCookie) {
      try {
        const parsed = JSON.parse(authCookie.value);
        if (Array.isArray(parsed) && parsed[0]) token = String(parsed[0]);
      } catch {
        // ignore malformed cookie
      }
    }
  }

  if (!token || token === "undefined" || token === "null") return false;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) return false;
  return true;
}

const getAuth = () => {
  const clientEmail = (process.env.GOOGLE_CLIENT_EMAIL || "").trim();
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(
    /\\n/g,
    "\n"
  );

  if (!clientEmail || !privateKey) {
    throw new Error(
      "서버 환경변수(GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY)가 설정되어 있지 않습니다."
    );
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
};

function getAcademyCalendarId(): string {
  return (process.env.TARGET_CALENDAR_ID || "").trim() || "primary";
}

export async function POST(request: NextRequest) {
  try {
    if (!(await verifyAuth(request))) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: 접근 권한이 없습니다." },
        { status: 401 }
      );
    }

    const auth = getAuth();
    const calendar = google.calendar({ version: "v3", auth });

    const { events } = await request.json();
    const targetCalId = getAcademyCalendarId();

    const results = [];
    for (const ev of events || []) {
      const res = await calendar.events.insert({
        calendarId: targetCalId,
        requestBody: ev,
      });
      results.push(res.data);
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error("Google Calendar POST Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!(await verifyAuth(request))) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: 접근 권한이 없습니다." },
        { status: 401 }
      );
    }

    const auth = getAuth();
    const calendar = google.calendar({ version: "v3", auth });
    const targetCalId = getAcademyCalendarId();

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const res = await calendar.events.list({
      calendarId: targetCalId,
      timeMin: threeMonthsAgo.toISOString(),
      maxResults: 1000,
      singleEvents: true,
      orderBy: "startTime",
    });

    return NextResponse.json({ success: true, events: res.data.items || [] });
  } catch (error: any) {
    console.error("Google Calendar GET Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!(await verifyAuth(request))) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: 접근 권한이 없습니다." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const title = searchParams.get("title");

    if (!title) {
      return NextResponse.json(
        { success: false, error: "Title is required" },
        { status: 400 }
      );
    }

    const auth = getAuth();
    const calendar = google.calendar({ version: "v3", auth });
    const calendarId = getAcademyCalendarId();

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
    console.error("Calendar Delete Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
