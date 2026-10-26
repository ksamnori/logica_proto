// src/app/api/contest-db/route.ts
// 경시 문제 DB(pub_contest_problems)의 한국어 번역·수정 저장을 서버에서만 처리합니다.
//  - 로그인 토큰 확인 → 문제 DB 허용 명단(contest_db_access) 확인 → service_role 로 DB 저장
//  - AI 키(GEMINI_API_KEY)와 service_role 키는 브라우저로 나가지 않습니다.
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const TABLE = "pub_contest_problems";
const MODEL_NAME = process.env.CONTEST_TRANSLATE_MODEL || "gemini-3.8-flash";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function fail(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function extractToken(req: NextRequest): string | undefined {
  let token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) token = req.cookies.get("sb-access-token")?.value;
  if (!token) {
    const authCookie = req.cookies.getAll().find((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));
    if (authCookie) {
      try { token = JSON.parse(authCookie.value)[0]; } catch { /* 무시 */ }
    }
  }
  return token;
}

const SYSTEM_PROMPT = `당신은 대한민국 수학 교재 출판사의 수석 번역가입니다.
입력된 problem_en(문제)과 solutions_en(풀이 배열)을 한국 수학 교육과정과 KMO 표준 용어로 정확하고 자연스럽게 번역하세요.

[절대 규칙]
1. $...$, $$...$$, \\(...\\), \\[...\\] 안의 LaTeX 수식은 한 글자도 바꾸거나 빼지 말고 그대로 두세요.
2. ![](https://...) 형태의 이미지 태그는 위치와 주소를 그대로 유지하세요.
3. 풀이 배열은 입력과 같은 개수, 같은 순서로 번역하세요.
4. 한국 표준 용어를 쓰세요. 예) cyclic quadrilateral → 원에 내접하는 사각형, positive integer → 양의 정수,
   distinct → 서로 다른, relatively prime → 서로소, modulo → 법, inscribed circle → 내접원.
5. 문제는 "~을 구하시오.", "~을 증명하시오." 같은 문제집 문체로, 풀이는 "~이다." 체로 쓰세요.`;

async function translateWithGemini(problemEn: string, solutionsEn: string[]) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("서버에 GEMINI_API_KEY가 설정되지 않았습니다.");

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          problem_ko: { type: SchemaType.STRING },
          solutions_ko: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
        required: ["problem_ko", "solutions_ko"],
      },
    },
  });

  const result = await model.generateContent(JSON.stringify({ problem_en: problemEn, solutions_en: solutionsEn }));
  const text = result.response.text().replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(text);

  const problemKo = String(parsed.problem_ko || "").trim();
  if (!problemKo) throw new Error("AI가 빈 번역을 돌려주었습니다.");
  const solutionsKo = Array.isArray(parsed.solutions_ko) ? parsed.solutions_ko.map((s: unknown) => String(s || "").trim()).filter(Boolean) : [];
  return { problem_ko: problemKo, solutions_ko: solutionsKo };
}

export async function POST(req: NextRequest) {
  try {
    // 1. 로그인 확인
    const token = extractToken(req);
    if (!token) return fail("Unauthorized: 접근 권한이 없습니다.", 401);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return fail("Unauthorized: 유효하지 않은 세션입니다.", 401);

    // 2. 열람 권한 확인 (DB 허용 명단). 문항 조회도 이 사용자 권한으로 해서 DB 정책이 그대로 적용됨
    const supabaseAsUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
      { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } }
    );
    const { data: level } = await supabaseAsUser.rpc("contest_access_level");
    if (level !== "word" && level !== "all") return fail("문제 DB 열람 권한이 없는 계정입니다.", 403);

    const body = await req.json();
    const id = String(body?.id || "");
    if (!id) return fail("문항 id가 없습니다.");

    // 권한 밖의 문항('word' 권한자가 보낸 전체 문제 id 등)은 여기서 조회되지 않아 번역·수정도 불가
    const { data: row, error: rowError } = await supabaseAsUser
      .from(TABLE)
      .select("problem_en, solutions_en")
      .eq("id", id)
      .maybeSingle();
    if (rowError) return fail(rowError.message, 500);
    if (!row) return fail("문항을 찾을 수 없습니다.", 404);

    let update: { problem_ko: string | null; solutions_ko: string[]; has_ko: boolean };

    if (body.action === "translate") {
      const translated = await translateWithGemini(row.problem_en || "", Array.isArray(row.solutions_en) ? row.solutions_en : []);
      update = { ...translated, has_ko: true };
    } else if (body.action === "save") {
      const problemKo = typeof body.problem_ko === "string" ? body.problem_ko.trim() : "";
      const solutionsKo = Array.isArray(body.solutions_ko) ? body.solutions_ko.map((s: unknown) => String(s || "").trim()).filter(Boolean) : [];
      update = { problem_ko: problemKo || null, solutions_ko: solutionsKo, has_ko: Boolean(problemKo) };
    } else {
      return fail("알 수 없는 요청입니다.");
    }

    // 3. service_role 로 저장 (RLS 와 무관하게 서버에서만 쓰기)
    const { data: saved, error: saveError } = await supabaseAdmin
      .from(TABLE)
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("problem_ko, solutions_ko")
      .maybeSingle();
    if (saveError) return fail(saveError.message, 500);
    if (!saved) return fail("저장된 행이 없습니다. 문항 id를 확인하세요.", 404);

    return NextResponse.json({ success: true, data: saved });
  } catch (error: any) {
    console.error("Contest DB API Error:", error);
    const msg = String(error?.message || error);
    const status = /429|quota|rate/i.test(msg) ? 429 : 500;
    return fail(msg, status);
  }
}
