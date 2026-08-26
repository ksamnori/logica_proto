import { supabase } from "@/lib/supabase";

// 로그인 세션(localStorage 기반)이 유실됐는지 판별한다.
// role/tenant가 비어있는 것을 "권한 0개인 로그인 상태"로 오인해 권한 없음 화면을 띄우지 않도록,
// 대시보드 페이지들은 권한 DB 조회 전에 이 함수로 로그아웃 여부부터 판별해야 한다.
export function isInstructorSessionMissing(): boolean {
  if (typeof window === "undefined") return false;
  return (
    !localStorage.getItem("logica_instructor_id") ||
    !localStorage.getItem("logica_instructor_role")
  );
}

// localStorage 캐시가 비어있어도 진짜 Supabase 세션이 살아있으면 캐시를 복구한다.
// layout.tsx(TopHeader)가 하는 것과 동일한 방식(supabase.auth.getUser() + instructor 테이블 조회)으로
// role/tenant 등을 다시 채워넣는다. 성공하면 true, 진짜로 로그인이 끊긴 경우엔 false.
export async function recoverInstructorSession(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: instructor } = await supabase
      .from("instructor")
      .select("*")
      .eq("instructor_id", user.id)
      .single();
    if (!instructor) return false;

    localStorage.setItem("logica_instructor_id", instructor.instructor_id);
    localStorage.setItem("logica_instructor_name", instructor.name);
    localStorage.setItem("logica_instructor_role", instructor.role || "TEACHER");
    localStorage.setItem("logica_instructor_position", instructor.position || "");
    if (instructor.tenant_id) {
      localStorage.setItem("logica_tenant_id", instructor.tenant_id);
      document.cookie = `logica_tenant_id=${instructor.tenant_id}; path=/; max-age=86400;`;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=86400;`;
    }

    return true;
  } catch {
    return false;
  }
}

// 세션 가드의 표준 진입점: 캐시가 있으면 즉시 true. 없으면 복구를 한 번 시도하고 결과를 반환한다.
export async function ensureInstructorSession(): Promise<boolean> {
  if (!isInstructorSessionMissing()) return true;
  return recoverInstructorSession();
}
