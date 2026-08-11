// src/app/actions/enrollStudent.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

async function getTenantId() {
  const cookieStore = await cookies();
  return cookieStore.get("logica_tenant_id")?.value;
}

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
    const secureTenantId = await getTenantId();
    if (!secureTenantId) throw new Error("인증 정보(쿠키)가 없습니다. 다시 로그인 해주세요.");

    let finalParentId = null;

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

    const { error: studentError } = await supabaseAdmin.from("student").insert([
      {
        name: name.trim(),
        grade: grade,
        school_name: school.trim(),
        phone: finalContact,
        password_hash: password.trim(),
        status: status,
        parent_id: finalParentId,
        tenant_id: secureTenantId, 
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