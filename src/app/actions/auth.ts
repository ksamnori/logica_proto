// src/app/actions/auth.ts
"use server";

import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

// 💡 디버깅 1: 환경변수가 잘 들어왔는지 서버 터미널에 출력
console.log("Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL ? "OK" : "MISSING");
console.log("Service Key:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "OK" : "MISSING");
console.log("Secret Key:", process.env.SESSION_SECRET_KEY ? "OK" : "MISSING");

// 값이 없어서 앱 전체가 뻗는 것을 방지하기 위해 빈 문자열 처리
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const SECRET_KEY = new TextEncoder().encode(process.env.SESSION_SECRET_KEY || "fallback-secret-key");

export async function loginUser(loginId: string, loginPw: string, isSuperAdmin: boolean = false) {
  const cleanId = loginId.replace(/-/g, "");

  try {
    console.log("▶ [진행 1] DB 조회 시작...");
    const { data: user, error } = await supabaseAdmin
      .from("instructor")
      .select("instructor_id, name, position, role")
      .or(`login_id.eq.${loginId},login_id.eq.${cleanId}`)
      .eq("password_hash", loginPw)
      .maybeSingle();

    if (error) {
      console.error("❌ DB 통신 에러:", error);
      return { success: false, message: "DB 통신 오류가 발생했습니다." };
    }

    if (!user) {
      console.log("▶ [진행 2] 일치하는 계정 없음");
      return { success: false, message: "아이디 또는 비밀번호가 일치하지 않습니다." };
    }

    console.log(`▶ [진행 3] 유저 확인 성공: ${user.name}`);

    const role = user.role || "";
    const pos = user.position || "";
    const isAdminRole = ["ADMIN", "MANAGER", "PRINCIPAL"].includes(role.toUpperCase()) || pos.includes("원장") || pos.includes("실장");

    if (isSuperAdmin && !isAdminRole) {
      return { success: false, message: "최고 관리자 권한이 없습니다." };
    }

    console.log("▶ [진행 4] JWT 토큰 생성 중...");
    const payload = {
      instructor_id: user.instructor_id,
      name: user.name,
      role: role,
      position: pos,
      isSuper: isAdminRole,
    };

    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1d")
      .sign(SECRET_KEY);

    console.log("▶ [진행 5] 쿠키 굽기 시작...");
    // 💡 Next.js 15 대응: cookies() 앞에 반드시 await를 붙여야 합니다.
    const cookieStore = await cookies();
    cookieStore.set("logica_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 24시간
    });

    console.log("▶ [진행 6] 로그인 완료!");
    return {
      success: true,
      isSuper: isAdminRole,
      name: user.name,
      position: pos,
      instructor_id: user.instructor_id,
    };

  } catch (err) {
    // 💡 디버깅 2: 정확히 어디서, 무슨 에러가 났는지 터미널에 빨간 글씨로 찍어줍니다.
    console.error("❌ 서버 내부 치명적 에러:", err);
    return { success: false, message: "서버 통신 중 에러가 발생했습니다." };
  }
}