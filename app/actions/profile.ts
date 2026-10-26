// src/app/actions/profile.ts
"use server";

import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { createClient } from "@supabase/supabase-js";

const SECRET_KEY = new TextEncoder().encode(process.env.SESSION_SECRET_KEY);
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 🔒 헬퍼 함수: 해커가 브라우저 값을 조작해도 절대 속지 않는 JWT 토큰 검증
async function verifySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("logica_session")?.value;
  if (!token) throw new Error("인증 토큰이 없습니다.");
  const { payload } = await jwtVerify(token, SECRET_KEY);
  return payload;
}

// 1. 레이아웃 렌더링용 핵심 데이터 가져오기
export async function getLayoutData() {
  try {
    const payload = await verifySession();
    const instId = payload.instructor_id as string;
    
    const { data } = await supabaseAdmin
      .from("instructor")
      .select("profile_image_url")
      .eq("instructor_id", instId)
      .single();

    return {
      success: true,
      instId,
      name: payload.name as string,
      isSuperAdmin: payload.isSuper as boolean, // JWT에 박혀있는 진짜 권한 반환
      profileImgUrl: data?.profile_image_url || ""
    };
  } catch (error) {
    return { success: false };
  }
}

// 2. 알림 데이터 로드 (조작 불가능한 본인 ID로만 검색)
export async function getSecureNotifications(clearedTime: number) {
  try {
    const payload = await verifySession();
    const instId = payload.instructor_id as string; // 해커가 ID를 바꿔치기 할 수 없음
    let notiData: any[] = [];

    const threeDaysAgo = new Date(); 
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const { data: memoData } = await supabaseAdmin.from('instructor_memo')
      .select('memo_id, author_name, content, created_at')
      .eq('memo_type', '긴급공지')
      .gte('created_at', threeDaysAgo.toISOString())
      .neq('status', '완료');

    memoData?.forEach(m => {
      if (new Date(m.created_at).getTime() > clearedTime) {
        notiData.push({ id: m.memo_id, title: `[긴급공지] ${m.author_name} 작성`, content: m.content, time: new Date(m.created_at), link: '/task' });
      }
    });

    const { data: csData } = await supabaseAdmin.from('parent_request_log')
      .select('request_id, reason, created_at, student(name)')
      .eq('processed_instructor_id', instId) // 검증된 본인 ID 사용
      .eq('status', '대기');

    csData?.forEach(cs => {
      const studentName = Array.isArray(cs.student) ? cs.student[0]?.name : (cs.student as any)?.name;
      if (new Date(cs.created_at).getTime() > clearedTime) {
        notiData.push({ id: cs.request_id, title: `[CS 배정] ${studentName || '학생'}`, content: cs.reason, time: new Date(cs.created_at), link: '/cs' });
      }
    });

    notiData.sort((a, b) => b.time.getTime() - a.time.getTime());
    return { success: true, notiData };
  } catch (error) {
    return { success: false, notiData: [] };
  }
}

// 3. 프로필 및 비밀번호 수정 (서버에서 안전하게 DB 업데이트)
export async function updateSecureProfile(updateData: any) {
  try {
    const payload = await verifySession();
    const instId = payload.instructor_id as string;

    const { error } = await supabaseAdmin
      .from("instructor")
      .update(updateData)
      .eq("instructor_id", instId); // 남의 프로필을 조작할 수 없도록 강제
      
    if (error) throw error;
    
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}