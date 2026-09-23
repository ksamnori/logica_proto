// src/app/actions/parentAuth.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// bcrypt 해시는 항상 $2a$ / $2b$ / $2y$ 로 시작합니다.
function isHashed(value: string | null | undefined) {
  return !!value && /^\$2[aby]\$/.test(value);
}

// 환경변수 에러 방지 처리
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export async function verifyParentPhone(phone: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from("parent")
      .select("parent_id, password_hash")
      .eq("phone", phone)
      .maybeSingle();

    if (error || !data) return { success: false, message: "등록된 연락처가 없습니다." };
    
    // 비밀번호가 세팅되어 있지 않으면 setup 필요
    return { success: true, needsSetup: !data.password_hash, parentId: data.parent_id };
  } catch (err) {
    return { success: false, message: "서버 통신 오류" };
  }
}

export async function loginParentAction(phone: string, pwInput: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from("parent")
      .select("parent_id, password_hash")
      .eq("phone", phone)
      .maybeSingle();

    if (error || !data) return { success: false, message: "계정을 찾을 수 없습니다." };
    
    // 💡 보안: 서버 내에서만 비밀번호를 대조하고, 브라우저로는 절대 값을 보내지 않습니다.
    const stored = data.password_hash || "";
    let ok = false;

    if (isHashed(stored)) {
      // 이미 전환된 계정
      ok = await bcrypt.compare(pwInput, stored);
    } else {
      // 아직 평문인 계정 → 평문 비교 후 즉시 해시로 승급
      ok = stored === pwInput;
      if (ok) {
        const newHash = await bcrypt.hash(pwInput, 10);
        await supabaseAdmin
          .from("parent")
          .update({ password_hash: newHash })
          .eq("parent_id", data.parent_id);
      }
    }

    if (!ok) return { success: false, message: "비밀번호가 다릅니다." };
    
    return { success: true, parentId: data.parent_id };
  } catch (err) {
    return { success: false, message: "서버 통신 오류" };
  }
}

export async function setupParentAction(parentId: string, name: string, pwInput: string) {
  try {
    const { error } = await supabaseAdmin
      .from("parent")
      .update({ name: name, password_hash: await bcrypt.hash(pwInput, 10) })
      .eq("parent_id", parentId);

    if (error) throw error;
    return { success: true };
  } catch (err) {
    return { success: false, message: "설정에 실패했습니다." };
  }
}

// 🌟 추가됨: 커스텀 JWT 발급 함수 (Supabase DB가 인식할 수 있는 신분증)
export async function getParentAuthToken(parentId: string) {
  if (!process.env.SUPABASE_JWT_SECRET) {
    throw new Error("Missing SUPABASE_JWT_SECRET environment variable");
  }
  
  const token = jwt.sign(
    {
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7), // 7일 유지
      sub: parentId, // RLS 정책의 auth.uid() 와 매칭됨
      role: "authenticated"
    },
    process.env.SUPABASE_JWT_SECRET
  );
  
  return token;
}