// src/app/actions/admission.ts
"use server";

import { createClient } from "@supabase/supabase-js";

// 💡 올바른 방식: 서버 액션에서는 service_role 키를 사용하여 권한 문제없이 DB를 제어합니다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false // 중요: 어드민 클라이언트는 세션을 유지하면 안 됨
  }
});

// 1. 대기생 배정하기 (Insert)
export async function assignStudents(sessionId: string, examId: string | null, studentIds: string[]) {
  try {
    const appData = studentIds.map(id => ({ admission_session_id: sessionId, student_id: id, status: '예약완료' }));
    
    // 💡 복구된 권한(service_role)으로 안전하게 Insert 실행
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

// 2. 배정 취소 및 삭제 (Delete)
export async function unassignStudentAction(studentId: string, sessionId: string) {
  try {
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

// 3. 상담 및 합격 결과 기록 (Update)
export async function updateCounselingResult(appId: string, studentId: string, result: string, memo: string) {
  try {
    const { error: upAppErr } = await supabaseAdmin.from('admission_application').update({ test_result: result, counseling_memo: memo }).eq('application_id', appId);
    if (upAppErr) throw new Error(upAppErr.message);

    if (result === '합격') {
      const { error: upStErr } = await supabaseAdmin.from('student').update({ status: '재원' }).eq('student_id', studentId);
      if (upStErr) throw new Error(upStErr.message);
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// 4. 누락된 시험지 강제 연결 (Insert/Update)
export async function forceAssignExamAction(studentId: string, sessionId: string, examId: string) {
  try {
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