// src/app/actions/studentAuth.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SignJWT } from "jose";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const SECRET_KEY = new TextEncoder().encode(process.env.SESSION_SECRET_KEY || "fallback-secret-key");

export async function searchStudentsByDigits(code: string) {
  if (!code || code.length !== 4) return { success: false, data: [] };

  try {
    const { data: studentMatch } = await supabaseAdmin
      .from("student")
      .select("student_id, name, grade, phone, parent(phone), enrollment(class(name))")
      .like("phone", `%${code}%`);

    const { data: parentMatch } = await supabaseAdmin
      .from("student")
      .select("student_id, name, grade, phone, parent!inner(phone), enrollment(class(name))")
      .like("parent.phone", `%${code}%`);

    const merged = [...(studentMatch || []), ...(parentMatch || [])];
    const uniqueMap = new Map();

    merged.forEach((item: any) => {
      const extractCleanDigits = (phoneStr: string) => {
        if (!phoneStr) return "";
        const withoutSuffix = phoneStr.replace(/-\d{1,2}$/, "");
        return withoutSuffix.replace(/[^0-9]/g, "");
      };

      const sPhoneCleaned = extractCleanDigits(item.phone);
      
      let rawPPhone = "";
      const parentObj = item.parent;
      if (parentObj && !Array.isArray(parentObj)) {
        rawPPhone = parentObj.phone || "";
      } else if (Array.isArray(parentObj)) {
        rawPPhone = parentObj[0]?.phone || "";
      }
      const pPhoneCleaned = extractCleanDigits(rawPPhone);

      const isStudentMatch = sPhoneCleaned.endsWith(code);
      const isParentMatch = pPhoneCleaned.endsWith(code);

      if (isStudentMatch || isParentMatch) {
        const classNames = (item.enrollment || [])
          .map((e: any) => e.class?.name)
          .filter(Boolean);

        uniqueMap.set(item.student_id, {
          student_id: item.student_id,
          name: item.name,
          grade: item.grade,
          classNames: classNames.length > 0 ? classNames : ["반 미배정"],
        });
      }
    });

    const matches = Array.from(uniqueMap.values());
    
    const GRADE_ORDER: Record<string, number> = { '고3': 1, '고2': 2, '고1': 3, '중3': 4, '중2': 5, '중1': 6, '초6': 7, '초5': 8, '초4': 9, '초3': 10, '초2': 11, '초1': 12 };
    matches.sort((a, b) => (GRADE_ORDER[a.grade] || 99) - (GRADE_ORDER[b.grade] || 99));

    return { success: true, data: matches };
  } catch (error) {
    return { success: false, data: [] };
  }
}

export async function loginStudentAction(studentId: string, passwordInput: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from("student")
      // 🌟 [핵심] 학생 로그인 시 DB에서 내 소속 지점(tenant_id)도 챙겨옵니다!
      .select("student_id, name, phone, password_hash, tenant_id")
      .eq("student_id", studentId)
      .maybeSingle();

    if (error || !data) return { success: false, message: "학생 정보를 찾을 수 없습니다." };
    
    if (data.password_hash !== passwordInput) return { success: false, message: "비밀번호가 다릅니다." };

    // 🌟 [보안] 포인트 조회/차감 등 학생 본인 확인이 필요한 액션에서 클라이언트가 보낸
    // studentId를 그대로 믿지 않고 이 서명된 쿠키와 대조할 수 있게 발급한다.
    const token = await new SignJWT({ student_id: data.student_id })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1d")
      .sign(SECRET_KEY);
    const cookieStore = await cookies();
    cookieStore.set("logica_student_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24,
    });

    return {
      success: true,
      studentId: data.student_id,
      name: data.name,
      phone: data.phone,
      tenant_id: data.tenant_id // 🌟 학생 꼬리표 반환!
    };
  } catch (err) {
    return { success: false, message: "서버 통신 오류" };
  }
}

// 수퍼바이저가 학생을 다른 키오스크 패드로 이동시켰을 때, 그 패드에서 PIN 없이 자동으로
// 세션을 이어받기 위한 로그인이다. 누구나 studentId만 알면 로그인되는 걸 막기 위해,
// 수퍼바이저가 이동시키는 순간 그 학생의 세션 행에 발급해둔 1회용 단기 토큰과 대조한다 —
// 토큰이 일치하고 아직 만료 전이어야만 통과한다(clinic_session_state.transfer_token 컬럼 필요).
export async function loginTransferAction(studentId: string, token: string, seatNumber: string) {
  try {
    if (!studentId || !token || !seatNumber) return { success: false, message: "잘못된 요청입니다." };

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("clinic_session_state")
      .select("id, transfer_token, transfer_token_expires_at")
      .eq("student_id", studentId)
      .eq("transfer_token", token)
      .is("ended_at", null)
      .maybeSingle();

    if (sessionError || !session) return { success: false, message: "이동 요청을 찾을 수 없습니다." };
    if (!session.transfer_token_expires_at || new Date(session.transfer_token_expires_at).getTime() <= Date.now()) {
      return { success: false, message: "이동 요청이 만료되었습니다. 수퍼바이저에게 다시 요청해주세요." };
    }

    const { data, error } = await supabaseAdmin
      .from("student")
      .select("student_id, name, phone, tenant_id")
      .eq("student_id", studentId)
      .maybeSingle();
    if (error || !data) return { success: false, message: "학생 정보를 찾을 수 없습니다." };

    // 토큰은 1회용이라 성공 시점에 바로 지우고, 실제 좌석도 이 패드 번호로 확정한다.
    await supabaseAdmin.from("clinic_session_state")
      .update({ transfer_token: null, transfer_token_expires_at: null, seat: seatNumber, manual_seat: seatNumber })
      .eq("id", session.id);

    const jwtToken = await new SignJWT({ student_id: data.student_id })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1d")
      .sign(SECRET_KEY);
    const cookieStore = await cookies();
    cookieStore.set("logica_student_session", jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24,
    });

    return { success: true, studentId: data.student_id, name: data.name, phone: data.phone, tenant_id: data.tenant_id };
  } catch (err) {
    return { success: false, message: "서버 통신 오류" };
  }
}