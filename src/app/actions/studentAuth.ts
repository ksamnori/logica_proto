"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";

function isHashed(value: string | null | undefined) {
  return !!value && /^\$2[aby]\$/.test(value);
}

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
      .select("student_id, name, phone, password_hash, tenant_id")
      .eq("student_id", studentId)
      .maybeSingle();

    if (error || !data) return { success: false, message: "학생 정보를 찾을 수 없습니다." };
    
    const stored = data.password_hash || "";
    const isPasswordEmpty = stored.trim() === "";
    let isAuthorized = false;
    let needsPinSetup = false;

    if (isPasswordEmpty && passwordInput === "0000") {
      // PIN 미설정 학생 → 0000으로 진입 후 설정 유도
      isAuthorized = true;
      needsPinSetup = true;
    } else if (isHashed(stored)) {
      // 이미 전환된 계정
      isAuthorized = await bcrypt.compare(passwordInput, stored);
      if (isAuthorized && passwordInput === "0000") needsPinSetup = true;
    } else if (stored === passwordInput) {
      // 아직 평문인 계정 → 평문 확인 후 즉시 해시로 승급
      isAuthorized = true;
      if (passwordInput === "0000") needsPinSetup = true;

      const newHash = await bcrypt.hash(passwordInput, 10);
      await supabaseAdmin
        .from("student")
        .update({ password_hash: newHash })
        .eq("student_id", data.student_id);
    }

    if (!isAuthorized) return { success: false, message: "비밀번호가 다릅니다." };

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
      tenant_id: data.tenant_id,
      needsPinSetup 
    };
  } catch (err) {
    return { success: false, message: "서버 통신 오류" };
  }
}

export async function setupStudentPinAction(studentId: string, newPin: string) {
  if (!newPin || newPin.length !== 4) return { success: false, message: "4자리 숫자를 입력해주세요." };
  try {
    const { error } = await supabaseAdmin
      .from("student")
      .update({ password_hash: await bcrypt.hash(newPin, 10) })
      .eq("student_id", studentId);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    return { success: false, message: "비밀번호 설정 중 오류가 발생했습니다." };
  }
}

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

// ------------------------------------------------------------------
// [신규] 클리닉 패드 로그인 시 자동 등원 처리
//    - attendance + alimtalk_queue를 service_role로 한 번에 처리합니다.
//    - tenant_id를 클라이언트에서 받지 않고 DB에서 읽습니다.
// ------------------------------------------------------------------
const ATTENDANCE_TEMPLATE_ID = "KA01TP260826014520504X1Fplf8R0FH";

export async function autoAttendOnPadLogin(studentId: string) {
  if (!studentId) return { success: false, message: "studentId가 없습니다." };

  try {
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    // 기존 로직 유지: 새벽 6시 이전은 전날로 취급
    const kstBusinessDay = new Date(now.getTime() + (9 - 6) * 60 * 60 * 1000);
    const today = kstBusinessDay.toISOString().split("T")[0];
    const timestamp = now.toISOString();
    const timeStr =
      `${String(kstNow.getUTCHours()).padStart(2, "0")}:` +
      `${String(kstNow.getUTCMinutes()).padStart(2, "0")} (클리닉실 입실)`;

    // 1) 학생 + 학부모 + 반 정보를 서버에서 조회
    const { data: stu, error: sErr } = await supabaseAdmin
      .from("student")
      .select(`
        student_id, name, tenant_id,
        parent(name, phone, relationship, name_2, phone_2, relationship_2),
        enrollment(enrollment_id, class(class_id))
      `)
      .eq("student_id", studentId)
      .maybeSingle();

    if (sErr) throw sErr;
    if (!stu) return { success: false, message: "학생을 찾을 수 없습니다." };

    // 2) 오늘 마지막 출결 확인
    const { data: attData, error: aErr } = await supabaseAdmin
      .from("attendance")
      .select("attendance_id, check_out_time")
      .eq("student_id", studentId)
      .eq("attendance_date", today)
      .order("attendance_id", { ascending: false })
      .limit(1);

    if (aErr) throw aErr;

    const latest = attData?.[0] || null;
    // 이미 등원 중(하원 안 함)이면 아무것도 하지 않음
    if (latest && !latest.check_out_time) {
      return { success: true, attended: false, queued: 0, message: "이미 등원 상태입니다." };
    }

    const enr: any = Array.isArray(stu.enrollment) ? stu.enrollment[0] : stu.enrollment;
    const enrollmentId = enr?.enrollment_id ?? null;
    const classId = enr?.class?.class_id ?? null;

    // 3) 등원 기록 생성
    const { error: insAttErr } = await supabaseAdmin.from("attendance").insert({
      student_id: stu.student_id,
      tenant_id: stu.tenant_id,        // 🌟 DB 값 사용
      class_id: classId,
      enrollment_id: enrollmentId,
      attendance_date: today,
      status: "등원",
      check_in_time: timestamp,
    });
    if (insAttErr) throw insAttErr;

    // 4) 알림톡 대기열 적재 (학부모 1·2번 모두)
    const parentObj: any = Array.isArray(stu.parent) ? stu.parent[0] : stu.parent;
    const rows: any[] = [];

    const pushTarget = (phone?: string | null, name?: string | null, rel?: string | null) => {
      if (!phone || String(phone).includes("unassigned")) return;
      const relStr = rel || "학부모";
      const finalName = name && name !== "미입력" ? `${name}(${relStr})` : `학부모(${relStr})`;
      rows.push({
        tenant_id: stu.tenant_id,
        student_id: stu.student_id,
        student_name: stu.name,
        parent_name: finalName,
        parent_phone: phone,
        template_id: ATTENDANCE_TEMPLATE_ID,
        status_label: "등원",
        time_string: timeStr,
        preview_title: "[출결] 등원",
        preview_desc: `${stu.name} ${finalName}`,
        status: "대기",
      });
    };

    if (parentObj) {
      pushTarget(parentObj.phone, parentObj.name, parentObj.relationship);
      pushTarget(parentObj.phone_2, parentObj.name_2, parentObj.relationship_2);
    }

    if (rows.length > 0) {
      await supabaseAdmin
        .from("alimtalk_queue")
        .delete()
        .eq("student_id", stu.student_id)
        .eq("template_id", ATTENDANCE_TEMPLATE_ID)
        .eq("status", "대기");

      const { error: insQErr } = await supabaseAdmin.from("alimtalk_queue").insert(rows);
      if (insQErr) throw insQErr;
    }

    return { success: true, attended: true, queued: rows.length };
  } catch (error: any) {
    console.error("[autoAttendOnPadLogin]", error);
    return { success: false, attended: false, queued: 0, message: error?.message || String(error) };
  }
}

export async function hashPin(pin: string) {
  return await bcrypt.hash(pin, 10);
}