// src/app/actions/admission.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache"; // 🌟 [추가] Next.js 캐시 초기화를 위한 함수 임포트

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

function matchesStandardName(row: any, targetStd: string, coreTag: string): boolean {
  if (!row) return false;
  const candidates = [
    row.standard_name,
    row.standard,
    row.grade,
    row.level,
    row.name,
    row.title,
    row.exam_name,
  ]
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v).trim());

  for (const val of candidates) {
    if (!val) continue;
    if (val === targetStd || val === coreTag) return true;
    const tagMatch = val.match(/\d+-\d+/);
    if (tagMatch && coreTag && tagMatch[0] === coreTag) return true;
    if (coreTag && val.includes(coreTag)) return true;
  }
  return false;
}

/**
 * 🌟 진단평가 기준표(admission_standard_meta_2610 / admission_standard_baseline_2610) 서버 액션 로더
 * - Service Role Key(supabaseAdmin)를 사용하여 신규 테이블의 RLS(Row Level Security) 차단 문제를 완벽 우회합니다.
 * - standard_name 표기 차이('5-2', '초등 5-2', '초5-2' 등)를 유연하게 매칭하며,
 *   _2610 테이블에 해당 학기 데이터가 없을 경우 기존 테이블(admission_standard_meta / admission_standard_baseline)로 자동 폴백합니다.
 */
export async function fetchAdmissionStandardDataAction(standardName: string) {
  try {
    const rawStd = String(standardName || "").trim();
    const matchTag = rawStd.match(/\d+-\d+/);
    const coreTag = matchTag ? matchTag[0] : rawStd;

    let metaRows: any[] = [];
    let baselineRow: any = null;

    // 1. admission_standard_meta_2610 조회
    const { data: meta2610, error: meta2610Err } = await supabaseAdmin
      .from("admission_standard_meta_2610")
      .select("*");

    if (!meta2610Err && Array.isArray(meta2610) && meta2610.length > 0) {
      const exact = meta2610.filter(
        (r: any) => String(r.standard_name ?? r.standard ?? "").trim() === rawStd ||
                    String(r.standard_name ?? r.standard ?? "").trim() === coreTag
      );
      metaRows = exact.length > 0 ? exact : meta2610.filter((r: any) => matchesStandardName(r, rawStd, coreTag));
    }

    // 폴백: admission_standard_meta
    if (!metaRows || metaRows.length === 0) {
      const { data: metaLegacy } = await supabaseAdmin
        .from("admission_standard_meta")
        .select("*");
      if (Array.isArray(metaLegacy) && metaLegacy.length > 0) {
        const exact = metaLegacy.filter(
          (r: any) => String(r.standard_name ?? r.standard ?? "").trim() === rawStd ||
                      String(r.standard_name ?? r.standard ?? "").trim() === coreTag
        );
        metaRows = exact.length > 0 ? exact : metaLegacy.filter((r: any) => matchesStandardName(r, rawStd, coreTag));
      }
    }

    // 2. admission_standard_baseline_2610 조회
    const { data: base2610, error: base2610Err } = await supabaseAdmin
      .from("admission_standard_baseline_2610")
      .select("*");

    if (!base2610Err && Array.isArray(base2610) && base2610.length > 0) {
      baselineRow =
        base2610.find(
          (r: any) => String(r.standard_name ?? r.standard ?? "").trim() === rawStd ||
                      String(r.standard_name ?? r.standard ?? "").trim() === coreTag
        ) ||
        base2610.find((r: any) => matchesStandardName(r, rawStd, coreTag)) ||
        null;
    }

    // 폴백: admission_standard_baseline
    if (!baselineRow) {
      const { data: baseLegacy } = await supabaseAdmin
        .from("admission_standard_baseline")
        .select("*");
      if (Array.isArray(baseLegacy) && baseLegacy.length > 0) {
        baselineRow =
          baseLegacy.find(
            (r: any) => String(r.standard_name ?? r.standard ?? "").trim() === rawStd ||
                        String(r.standard_name ?? r.standard ?? "").trim() === coreTag
          ) ||
          baseLegacy.find((r: any) => matchesStandardName(r, rawStd, coreTag)) ||
          null;
      }
    }

    return {
      success: true,
      metaRows: metaRows || [],
      baselineRow: baselineRow || null,
    };
  } catch (error: any) {
    return {
      success: false,
      metaRows: [],
      baselineRow: null,
      message: error?.message || "기준표 로드 실패",
    };
  }
}

// 🌟 프론트엔드에서 명시적으로 tenantId를 넘겨줄 수 있도록 파라미터(clientTenantId) 추가
export async function assignStudents(sessionId: string, examId: string | null, studentIds: string[], clientTenantId?: string) {
  const tenantId = clientTenantId || await getTenantId();
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
      // 💡 [중요] exam_assignment에 tenant_id 값을 필수로 포함하여 Insert
      const shadowData = studentIds.map(id => ({ 
        student_id: id, 
        admission_session_id: sessionId, 
        exam_id: examId, 
        status: '미응시',
        tenant_id: tenantId 
      }));
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

// 🌟 상담 결과 업데이트 로직 (검증 로직 추가 및 자동 승급 조건 변경)
export async function updateCounselingResult(appId: string, studentId: string, result: string, memo: string) {
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, message: "권한이 없습니다. 다시 로그인해주세요." };

  try {
    // 💡 .select()를 추가하여 실제 업데이트가 성공적으로 발생했는지 확인합니다.
    const { data: updatedData, error: upAppErr } = await supabaseAdmin
      .from('admission_application')
      .update({ test_result: result, counseling_memo: memo })
      .eq('application_id', appId)
      .select();
      
    if (upAppErr) throw new Error(upAppErr.message);

    // 💡 업데이트된 행이 없다면 appId가 잘못되었거나 매칭되는 데이터가 없는 것입니다.
    if (!updatedData || updatedData.length === 0) {
      throw new Error("업데이트할 대상을 찾지 못했습니다. 올바른 데이터를 선택했는지 확인해주세요.");
    }

    // 💡 '합격' -> '수강 등록'으로 프론트엔드 파이프라인과 일치시켰습니다.
    if (result === '수강 등록') {
      const { data: stuData } = await supabaseAdmin.from('student').select('tenant_id').eq('student_id', studentId).single();
      if (stuData && stuData.tenant_id === tenantId) {
        const { error: upStErr } = await supabaseAdmin.from('student').update({ status: '재원' }).eq('student_id', studentId);
        if (upStErr) throw new Error(upStErr.message);
      }
    }
    
    // 🌟 [핵심 해결책] DB 업데이트가 성공한 직후, 라우터 캐시를 날려버립니다.
    // 이렇게 하면 프론트엔드가 아까 받아둔 과거 데이터를 버리고 최신 상태('결과 통보', '수강 등록' 등)를 서버에서 다시 그려옵니다.
    revalidatePath('/', 'layout');

    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// 🌟 프론트엔드에서 넘겨준 파라미터(clientTenantId)를 처리
export async function forceAssignExamAction(studentId: string, sessionId: string, examId: string, clientTenantId?: string) {
  const tenantId = clientTenantId || await getTenantId();
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
      // 💡 [중요] 새로 시험지를 매핑(Insert)할 때 tenant_id 필수 추가
      const { error: insErr } = await supabaseAdmin.from('exam_assignment').insert([{ 
        student_id: studentId, 
        admission_session_id: sessionId, 
        exam_id: examId, 
        status: '미응시',
        tenant_id: tenantId 
      }]);
      if (insErr) throw new Error(insErr.message);
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}