// src/app/actions/auth.ts
"use server";

import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const SECRET_KEY = new TextEncoder().encode(process.env.SESSION_SECRET_KEY || "fallback-secret-key");

export async function loginUser(loginId: string, loginPw: string, isSuperAdmin: boolean = false) {
  const cleanId = loginId.replace(/-/g, "");

  try {
    const { data: user, error } = await supabaseAdmin
      .from("instructor")
      // 🌟 [핵심] 로그인 시 DB에서 내 소속 지점(tenant_id)도 함께 가져옵니다.
      .select("instructor_id, name, position, role, tenant_id") 
      .or(`login_id.eq.${loginId},login_id.eq.${cleanId}`)
      .eq("password_hash", loginPw)
      .maybeSingle();

    if (error || !user) {
      return { success: false, message: "아이디 또는 비밀번호가 일치하지 않습니다." };
    }

    const role = user.role || "";
    const pos = user.position || "";
    const isAdminRole = ["ADMIN", "MANAGER", "PRINCIPAL"].includes(role.toUpperCase()) || pos.includes("원장") || pos.includes("실장");

    if (isSuperAdmin && !isAdminRole) {
      return { success: false, message: "최고 관리자 권한이 없습니다." };
    }

    const payload = {
      instructor_id: user.instructor_id,
      name: user.name,
      role: role,
      position: pos,
      isSuper: isAdminRole,
      tenant_id: user.tenant_id // 🌟 [보안] 해커가 조작할 수 없게 JWT 토큰 속에 꼬리표를 밀봉합니다!
    };

    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1d")
      .sign(SECRET_KEY);

    const cookieStore = await cookies();
    cookieStore.set("logica_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, 
    });

    return {
      success: true,
      isSuper: isAdminRole,
      name: user.name,
      position: pos,
      instructor_id: user.instructor_id,
      tenant_id: user.tenant_id // 🌟 프론트엔드에도 전달하여 로컬 스토리지에 저장할 수 있게 합니다.
    };

  } catch (err) {
    console.error("❌ 서버 내부 치명적 에러:", err);
    return { success: false, message: "서버 통신 중 에러가 발생했습니다." };
  }
}