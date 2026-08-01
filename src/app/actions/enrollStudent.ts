// src/app/actions/enrollStudent.ts
"use server";

import { createClient } from "@supabase/supabase-js";

// 환경변수 에러 방지 처리 (보안이 보장된 서버 환경에서만 실행됨)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export async function registerStudentAction(data: {
  name: string;
  password: string;
  studentContact: string;
  parentContact: string;
  school: string;
  grade: string;
  status: string;
}) {
  const { name, password, studentContact, parentContact, school, grade, status } = data;

  try {
    let finalParentId = null;

    // 1. 학부모 정보 확인 및 생성 (서버 환경)
    if (parentContact) {
      const { data: existingParent, error: fetchError } = await supabaseAdmin
        .from("parent")
        .select("parent_id")
        .eq("phone", parentContact)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (existingParent) {
        finalParentId = existingParent.parent_id;
      } else {
        const { data: newParent, error: insertParentError } = await supabaseAdmin
          .from("parent")
          .insert([{ phone: parentContact }])
          .select("parent_id")
          .single();

        if (insertParentError) throw insertParentError;
        finalParentId = newParent.parent_id;
      }
    }

    // 2. 학생 연락처 (ID) 중복 검사 및 꼬리표(Suffix) 부착 로직
    let finalContact = studentContact;
    const { data: existingContacts, error: searchError } = await supabaseAdmin
      .from("student")
      .select("phone")
      .like("phone", `${studentContact}%`);

    if (searchError) throw searchError;

    let hasModifiedId = false;

    if (existingContacts && existingContacts.length > 0) {
      let maxSuffix = 0;
      let hasExactMatch = false;

      existingContacts.forEach((s) => {
        if (s.phone === studentContact) {
          hasExactMatch = true;
        } else {
          const suffixStr = s.phone.replace(studentContact + "-", "");
          if (!isNaN(Number(suffixStr))) {
            const num = parseInt(suffixStr);
            if (num > maxSuffix) maxSuffix = num;
          }
        }
      });

      if (hasExactMatch || maxSuffix > 0) {
        finalContact = `${studentContact}-${maxSuffix + 1}`;
        hasModifiedId = true;
      }
    }

    // 3. 학생 데이터 최종 INSERT
    const { error: studentError } = await supabaseAdmin.from("student").insert([
      {
        name: name.trim(),
        grade: grade,
        school_name: school.trim(),
        phone: finalContact,
        password_hash: password.trim(),
        status: status,
        parent_id: finalParentId,
      },
    ]);

    if (studentError) throw studentError;

    return { 
      success: true, 
      hasModifiedId, 
      finalContact 
    };

  } catch (error: any) {
    console.error("서버 DB 등록 에러:", error);
    return { 
      success: false, 
      message: error.message || "서버 통신 중 에러가 발생했습니다." 
    };
  }
}