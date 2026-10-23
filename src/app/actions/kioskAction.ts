// src/app/actions/kioskAction.ts
"use server";

import { createClient } from "@supabase/supabase-js";

// 마스터키(SERVICE_ROLE_KEY)를 사용하여 RLS 보안관을 안전하게 프리패스
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const ENDED_ENROLLMENT_STATUSES = ["수강종료", "종료", "퇴원", "취소"];
const isEndedEnrollment = (e: any): boolean => {
  if (!e) return true;
  if (ENDED_ENROLLMENT_STATUSES.includes(String(e.status || "").trim())) return true;
  if (e.end_date) return true;
  return false;
};

export async function searchStudentsByLast4(code: string, tenantId: string) {
  try {
    let studentQuery = supabaseAdmin
      .from('student')
      .select('student_id, name, grade, phone, parent(name, phone, relationship, name_2, phone_2, relationship_2), enrollment(enrollment_id, status, end_date, class(class_id, name))')
      .eq('status', '재원')
      .like('phone', `%${code}%`);
    if (tenantId) studentQuery = studentQuery.eq('tenant_id', tenantId);
    
    let parentQuery = supabaseAdmin
      .from('student')
      .select('student_id, name, grade, phone, parent!inner(name, phone, relationship, name_2, phone_2, relationship_2), enrollment(enrollment_id, status, end_date, class(class_id, name))')
      .eq('status', '재원')
      .like('parent.phone', `%${code}%`);
    if (tenantId) parentQuery = parentQuery.eq('tenant_id', tenantId);

    let parentQuery2 = supabaseAdmin
      .from('student')
      .select('student_id, name, grade, phone, parent!inner(name, phone, relationship, name_2, phone_2, relationship_2), enrollment(enrollment_id, status, end_date, class(class_id, name))')
      .eq('status', '재원')
      .like('parent.phone_2', `%${code}%`);
    if (tenantId) parentQuery2 = parentQuery2.eq('tenant_id', tenantId);

    const [res1, res2, res3] = await Promise.all([studentQuery, parentQuery, parentQuery2]);

    const merged = [...(res1.data || []), ...(res2.data || []), ...(res3.data || [])];
    
    let uniqueMap = new Map();

    merged.forEach((item: any) => {
      const extractCleanDigits = (phoneStr: string) => {
        if (!phoneStr) return "";
        const withoutSuffix = phoneStr.replace(/-\d{1,2}$/, "");
        return withoutSuffix.replace(/[^0-9]/g, "");
      };

      const sPhoneCleaned = extractCleanDigits(item.phone);
      let rawPPhone = "";
      let rawPPhone2 = "";
      
      const parentObj = item.parent as any; 
      if (parentObj && !Array.isArray(parentObj)) {
        rawPPhone = parentObj.phone || "";
        rawPPhone2 = parentObj.phone_2 || "";
      } else if (Array.isArray(parentObj)) {
        rawPPhone = parentObj[0]?.phone || "";
        rawPPhone2 = parentObj[0]?.phone_2 || "";
      }
      
      const pPhoneCleaned = extractCleanDigits(rawPPhone);
      const pPhone2Cleaned = extractCleanDigits(rawPPhone2);

      const isStudentMatch = sPhoneCleaned.endsWith(code);
      const isParentMatch = pPhoneCleaned.endsWith(code) || pPhone2Cleaned.endsWith(code);

      if (isStudentMatch || isParentMatch) {
        const activeEnrolls = (item.enrollment || []).filter((e: any) => !isEndedEnrollment(e));
        uniqueMap.set(item.student_id, { ...item, enrollment: activeEnrolls });
      }
    });

    return { success: true, data: Array.from(uniqueMap.values()) };
  } catch (err: any) {
    return { success: false, message: err.message, data: [] };
  }
}