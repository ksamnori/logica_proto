// src/app/actions/examActions.ts
"use server";

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export async function getExamsAction() {
  try {
    const { data, error } = await supabaseAdmin
      .from("exam_master")
      .select("*, exam_assignment(assignment_id), instructor(name)")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (err: any) {
    console.error("문제지 조회 에러:", err);
    return { success: false, message: "문제지 목록을 불러오지 못했습니다.", data: [] };
  }
}

export async function deleteExamAction(examId: string) {
  try {
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