// src/app/actions/admission.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// 🌟 [핵심 변경] 직관적인 쿠키 읽기로 통일!
async function getTenantId() {
  const cookieStore = await cookies();
  return cookieStore.get("logica_tenant_id")?.value;
}

export async function assignStudents(sessionId: string, examId: string | null, studentIds: string[]) {
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, message: "소속 지점 정보(쿠키)가 없습니다. 다시 로그인해주세요." };

  try {
    const { data: sessionData } = await supabaseAdmin
      .from('admission_session')
      .select('tenant_id')
      .eq('admission_session_id', sessionId)
      .single();

    if (!sessionData || sessionData.tenant_id !== tenantId) {
      throw new Error("접근 권한이 없는 일정이거나 잘못된 요청입니다.");
    }

    const appData = studentIds.map(id => ({ admission_session_id: sessionId, student_id: id, status: '예약완료' }));
    const { error: appError } = await supabaseAdmin.from('admission_application').insert(appData);
    if (appError) throw new Error(`[입학 배정 에러] ${appError.message}`);

    if (examId && examId !== 'null' && examId !== '') {
      const shadowData = studentIds.map(id => ({ student_id: id, admission_session_id: sessionId, exam_id: examId, status: '미응시' }));
      const { error: shadowError } = await supabaseAdmin.from('exam_assignment').insert(shadowData);
      if (shadowError) throw new Error(`[시험지 연결 에러] ${shadowError.message}`);
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function unassignStudentAction(studentId: string, sessionId: string) {
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, message: "인증이 만료되었습니다. 다시 로그인해주세요." };

  try {
    const { data: sessionData } = await supabaseAdmin.from('admission_session').select('tenant_id').eq('admission_session_id', sessionId).single();
    if (!sessionData || sessionData.tenant_id !== tenantId) throw new Error("권한이 없습니다.");

    const { data: assignments, error: fetchErr } = await supabaseAdmin.from('exam_assignment').select('assignment_id').eq('student_id', studentId).eq('admission_session_id', sessionId);
    if (fetchErr) throw new Error(fetchErr.message);
    
    if (assignments && assignments.length > 0) {
      for (let a of assignments) {
        await supabaseAdmin.from('student_answer').delete().eq('exam_assignment_id', a.assignment_id);
        await supabaseAdmin.from('student_exam_result').delete().eq('assignment_id', a.assignment_id);
        const { error: delAssignErr } = await supabaseAdmin.from('exam_assignment').delete().eq('assignment_id', a.assignment_id);
        if (delAssignErr) throw new Error(delAssignErr.message);
      }
    }
    const { error: delAppErr } = await supabaseAdmin.from('admission_application').delete().eq('admission_session_id', sessionId).eq('student_id', studentId);
    if (delAppErr) throw new Error(delAppErr.message);

    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function updateCounselingResult(appId: string, studentId: string, result: string, memo: string) {
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, message: "권한이 없습니다. 다시 로그인해주세요." };

  try {
    const { error: upAppErr } = await supabaseAdmin.from('admission_application').update({ test_result: result, counseling_memo: memo }).eq('application_id', appId);
    if (upAppErr) throw new Error(upAppErr.message);

    if (result === '합격') {
      const { data: stuData } = await supabaseAdmin.from('student').select('tenant_id').eq('student_id', studentId).single();
      if (stuData && stuData.tenant_id === tenantId) {
        const { error: upStErr } = await supabaseAdmin.from('student').update({ status: '재원' }).eq('student_id', studentId);
        if (upStErr) throw new Error(upStErr.message);
      }
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function forceAssignExamAction(studentId: string, sessionId: string, examId: string) {
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, message: "권한이 없습니다. 다시 로그인해주세요." };

  try {
    const { data: sessionData } = await supabaseAdmin.from('admission_session').select('tenant_id').eq('admission_session_id', sessionId).single();
    if (!sessionData || sessionData.tenant_id !== tenantId) throw new Error("권한이 없습니다.");

    const { data: existing, error: fetchErr } = await supabaseAdmin.from('exam_assignment').select('assignment_id').eq('student_id', studentId).eq('exam_id', examId);
    if (fetchErr) throw new Error(fetchErr.message);

    if (existing && existing.length > 0) {
      const { error: upErr } = await supabaseAdmin.from('exam_assignment').update({ admission_session_id: sessionId }).eq('assignment_id', existing[0].assignment_id);
      if (upErr) throw new Error(upErr.message);
    } else {
      const { error: insErr } = await supabaseAdmin.from('exam_assignment').insert([{ student_id: studentId, admission_session_id: sessionId, exam_id: examId, status: '미응시' }]);
      if (insErr) throw new Error(insErr.message);
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}