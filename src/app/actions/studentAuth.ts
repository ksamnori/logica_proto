// src/app/actions/studentAuth.ts
"use server";

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

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
    
    // 💡 [추가된 로직] 비밀번호가 없거나 비어있을 때 "0000"이면 통과시킵니다.
    const isPasswordEmpty = !data.password_hash || data.password_hash.trim() === "";
    let isAuthorized = false;

    if (isPasswordEmpty && passwordInput === "0000") {
      isAuthorized = true;
    } else if (data.password_hash === passwordInput) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return { success: false, message: "비밀번호가 다릅니다." };
    }
    
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