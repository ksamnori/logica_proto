// src/app/actions/consultation.ts
"use server";

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// 상담 기록 생성
export async function createConsultLog(input: {
  studentId: string;
  instructorId: string;
  consultationType: string;
  contactMethod: string;
  parentSummary: string;
  content: string;
}) {
  if (!input.studentId || !input.content?.trim()) {
    return { success: false, message: "필수 값이 없습니다." };
  }

  try {
    // 🌟 tenant_id를 클라이언트에서 받지 않고 학생 정보에서 읽습니다.
    const { data: stu, error: sErr } = await supabaseAdmin
      .from("student")
      .select("student_id, tenant_id")
      .eq("student_id", input.studentId)
      .maybeSingle();

    if (sErr) throw sErr;
    if (!stu) return { success: false, message: "학생을 찾을 수 없습니다." };

    const { error } = await supabaseAdmin.from("consultation_log").insert({
      student_id: stu.student_id,
      instructor_id: input.instructorId,
      consultation_type: input.consultationType,
      contact_method: input.contactMethod,
      parent_summary: input.parentSummary,
      content: input.content,
      tenant_id: stu.tenant_id,
    });
    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error("[createConsultLog]", error);
    return { success: false, message: error?.message || String(error) };
  }
}

// 상담 기록 수정
export async function updateConsultLog(input: {
  logId: string | number;
  consultationType: string;
  contactMethod: string;
  parentSummary: string;
  content: string;
}) {
  if (!input.logId) return { success: false, message: "logId 누락" };

  try {
    const { error } = await supabaseAdmin
      .from("consultation_log")
      .update({
        consultation_type: input.consultationType,
        contact_method: input.contactMethod,
        parent_summary: input.parentSummary,
        content: input.content,
      })
      .eq("consultation_log_id", input.logId);
    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error("[updateConsultLog]", error);
    return { success: false, message: error?.message || String(error) };
  }
}

// 상담 기록 1건 삭제
export async function deleteConsultLog(logId: string | number) {
  if (!logId) return { success: false, message: "logId 누락" };
  if (typeof logId === "string" && logId.startsWith("admission_")) {
    return { success: false, message: "입학 상담 기록은 입학 관리에서 처리해야 합니다." };
  }

  try {
    const { error } = await supabaseAdmin
      .from("consultation_log")
      .delete()
      .eq("consultation_log_id", logId);
    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error("[deleteConsultLog]", error);
    return { success: false, message: error?.message || String(error) };
  }
}

// ------------------------------------------------------------------
// 학생 완전 삭제 — 연관 데이터 일괄 제거
// 목록을 여기 한 곳에서만 관리합니다.
// ------------------------------------------------------------------
const STUDENT_CHILD_TABLES = [
  "student_answer",
  "student_exam_result",
  "student_progress",
  "student_incorrect_record",
  "admission_application",
  "admission_test_report",
  "individual_makeup",
  "parent_request_log",
  "clinic_session_state",
  "clinic_round_result",
  "clinic_task",
  "clinic_log",
  "clinic_reservation",
  "student_points",
  "point_log",
  "student_category_analysis",
  "student_homework_result",
  "student_homework_answer",
  "student_school_exam",
  "shop_purchase",
  "consultation_log",
  "attendance",
  "exam_assignment",
  "academy_billing",
  "enrollment",
];

export async function deleteStudentCompletely(studentId: string) {
  if (!studentId) return { success: false, message: "studentId 누락" };

  const failed: { table: string; message: string }[] = [];

  try {
    for (const table of STUDENT_CHILD_TABLES) {
      const { error } = await supabaseAdmin
        .from(table)
        .delete()
        .eq("student_id", studentId);

      // 테이블이 없거나 컬럼이 없는 경우는 건너뜁니다.
      if (error && !/does not exist|schema cache/i.test(error.message)) {
        failed.push({ table, message: error.message });
      }
    }

    if (failed.length > 0) {
      console.error("[deleteStudentCompletely] 일부 실패", failed);
      return {
        success: false,
        message: `연관 데이터 삭제 실패: ${failed.map(f => f.table).join(", ")}`,
        failed,
      };
    }

    const { error: delErr } = await supabaseAdmin
      .from("student")
      .delete()
      .eq("student_id", studentId);
    if (delErr) throw delErr;

    return { success: true };
  } catch (error: any) {
    console.error("[deleteStudentCompletely]", error);
    return { success: false, message: error?.message || String(error) };
  }
}