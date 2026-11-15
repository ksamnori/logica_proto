// src/lib/serverTenant.ts
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7일

function isValidTenantValue(val: string | undefined | null): val is string {
  if (!val) return false;
  const trimmed = val.trim();
  return trimmed.length > 0 && trimmed !== "undefined" && trimmed !== "null";
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/**
 * 서버 액션 공통 소속 지점(tenant_id) 해석기
 * 1. `logica_tenant_id` 쿠키가 살아 있으면 즉시 반환 (추가 DB 호출 없음)
 * 2. 쿠키가 만료·누락되었더라도 `sb-access-token`(로그인 세션 토큰)이 유효하면
 *    DB `instructor.tenant_id`를 조회해 자동 복구 및 쿠키를 재발급합니다.
 */
export async function resolveServerTenantId(clientTenantId?: string): Promise<string | undefined> {
  const cookieStore = await cookies();
  const cookieTenant = cookieStore.get("logica_tenant_id")?.value?.trim();
  if (isValidTenantValue(cookieTenant) && cookieTenant !== "hq") {
    return cookieTenant;
  }

  let token = cookieStore.get("sb-access-token")?.value?.trim();
  if (!token) {
    const authCookie = cookieStore
      .getAll()
      .find((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));
    if (authCookie) {
      try {
        const parsed = JSON.parse(authCookie.value);
        if (Array.isArray(parsed) && typeof parsed[0] === "string") {
          token = parsed[0];
        }
      } catch {
        // ignore malformed cookie
      }
    }
  }

  if (token) {
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
      const userId = userData?.user?.id;

      if (!userErr && userId) {
        const { data: inst } = await supabaseAdmin
          .from("instructor")
          .select("tenant_id, role, position")
          .eq("instructor_id", userId)
          .maybeSingle();

        const dbTenantId = inst?.tenant_id ? String(inst.tenant_id).trim() : "";
        if (isValidTenantValue(dbTenantId)) {
          try {
            cookieStore.set("logica_tenant_id", dbTenantId, {
              path: "/",
              maxAge: TENANT_COOKIE_MAX_AGE,
              httpOnly: false,
            });
          } catch {
            // Server Component 렌더링 문맥 등에서 호출될 경우 set 실패 무시
          }
          return dbTenantId;
        }

        // 최고관리자 계정에 한해 instructor.tenant_id가 비어 있는 경우 검증된 clientTenantId 허용
        const roleStr = String(inst?.role || "").toUpperCase();
        const posStr = String(inst?.position || "");
        const isSuperAdmin =
          roleStr === "SUPER_ADMIN" || posStr.includes("최고관리자") || posStr.includes("대장");
        if (isSuperAdmin && clientTenantId && UUID_RE.test(clientTenantId.trim())) {
          return clientTenantId.trim();
        }
      }
    } catch {
      // 네트워크/토큰 검증 실패 시 아래 쿠키 기본값으로 폴백
    }
  }

  if (isValidTenantValue(cookieTenant)) {
    return cookieTenant;
  }

  return undefined;
}
