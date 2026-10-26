// src/app/actions/examActions.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// 🌟 [핵심 변경] JWT 해독 대신, 방금 로그인 창에서 구운 직관적인 쿠키를 읽어옵니다.
async function getTenantId() {
  const cookieStore = await cookies();
  return cookieStore.get("logica_tenant_id")?.value;
}

export async function getExamsAction() {
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, message: "소속 지점 정보(쿠키)가 없어 문제지를 불러올 수 없습니다.", data: [] };

  try {
    const { data, error } = await supabaseAdmin
      .from("exam_master")
      .select("*, exam_assignment(assignment_id), instructor(name)")
      .eq('tenant_id', tenantId) // 🌟 [절대 방어막] 내 지점 시험지만 가져옵니다.
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (err: any) {
    console.error("문제지 조회 에러:", err);
    return { success: false, message: "문제지 목록을 불러오지 못했습니다.", data: [] };
  }
}

export async function deleteExamAction(examId: string) {
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, message: "삭제 권한이 없습니다." };

  try {
    // 🌟 [보안] 해커가 남의 지점 시험지를 지우는 것을 방지
    const { data: targetExam } = await supabaseAdmin
      .from("exam_master")
      .select("exam_id")
      .eq("exam_id", examId)
      .eq("tenant_id", tenantId) // 👈 내 지점 시험지가 맞는지 먼저 검증!
      .maybeSingle();

    if (!targetExam) return { success: false, message: "삭제 권한이 없거나 존재하지 않는 문제지입니다." };

    const { data: assignments, error: checkError } = await supabaseAdmin
      .from("exam_assignment")
      .select("assignment_id")
      .eq("exam_id", examId);

    if (checkError) throw checkError;
    if (assignments && assignments.length > 0) {
      return { success: false, message: "🚨 이 문제지는 아직 학생에게 출제된 기록이 남아있어 삭제할 수 없습니다." };
    }

    await supabaseAdmin.from("exam_item").delete().eq("exam_id", examId);
    await supabaseAdmin.from("exam_master").delete().eq("exam_id", examId);

    return { success: true, message: "✅ 문제지가 성공적으로 삭제되었습니다." };
  } catch (err: any) {
    console.error("문제지 삭제 에러:", err);
    return { success: false, message: "서버 통신 중 오류가 발생하여 삭제하지 못했습니다." };
  }
}