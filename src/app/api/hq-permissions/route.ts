// src/app/api/hq-permissions/route.ts
// 출판사 포털 "권한 관리" 메뉴용 API
//  - GET : 재직 직원 목록 + 각자의 문제 DB 권한 + 메뉴 권한(진단평가 분석 등)
//  - POST: 한 직원의 권한 변경
//      { instructor_id, contest_access: 'word' | 'all' | null }      → 문제 DB
//      { instructor_id, permission: 'admission_analytics', enabled }  → 켜기/끄기형 메뉴 권한
//  - 요청한 사람이 권한 관리자(hq_admins)인지 DB 함수로 확인한 뒤에만 service_role 로 처리
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// hq_permissions 테이블의 CHECK 제약과 같은 목록
const TOGGLE_PERMISSIONS = ["admission_analytics"] as const;
type TogglePermission = (typeof TOGGLE_PERMISSIONS)[number];

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// 본사(출판사) 테넌트 id. academy_tenant 조회가 실패했을 때만 쓰는 예비값 (원래는 tenant_type = 'HQ' 로 판별)
const FALLBACK_HQ_TENANT_IDS = ["d59395b0-8c9c-4dd3-9e25-ff569da98abc"];

// academy_tenant 조회가 실패해도 이름이 나오도록 (hq/page.tsx 와 같은 기본값)
const FALLBACK_TENANT_NAMES: Record<string, string> = {
  "1ff4299c-d72b-4d99-97b0-45fee08e3b73": "대치 본원",
  "d59395b0-8c9c-4dd3-9e25-ff569da98abc": "본사",
  "e24e540f-ebdd-40eb-b20b-696c113def6d": "서초 가맹점",
};

function fail(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function extractToken(req: NextRequest): string | undefined {
  let token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) token = req.cookies.get("sb-access-token")?.value;
  if (!token) {
    const authCookie = req.cookies.getAll().find((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));
    if (authCookie) {
      try { token = JSON.parse(authCookie.value)[0]; } catch { /* 무시 */ }
    }
  }
  return token;
}

/** 로그인 확인 + 권한 관리자 확인. 통과하면 요청자 id, 아니면 오류 응답 */
async function requireHqAdmin(req: NextRequest): Promise<{ userId: string } | NextResponse> {
  const token = extractToken(req);
  if (!token) return fail("로그인이 필요합니다.", 401);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return fail("유효하지 않은 세션입니다.", 401);

  const supabaseAsUser = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } }
  );
  const { data: isAdmin } = await supabaseAsUser.rpc("is_hq_admin");
  if (isAdmin !== true) return fail("권한 관리자만 사용할 수 있습니다.", 403);
  return { userId: user.id };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireHqAdmin(req);
    if (auth instanceof NextResponse) return auth;

    const [staffRes, accessRes, tenantRes, permRes] = await Promise.all([
      supabaseAdmin
        .from("instructor")
        .select("instructor_id, name, position, chat_position, department, tenant_id, role")
        .eq("status", "재직")
        .order("name"),
      supabaseAdmin.from("contest_db_access").select("instructor_id, access_level, granted_at, granted_by"),
      supabaseAdmin.from("academy_tenant").select("tenant_id, name, tenant_type"),
      supabaseAdmin.from("hq_permissions").select("instructor_id, permission"),
    ]);
    if (staffRes.error) return fail(staffRes.error.message, 500);
    if (accessRes.error) return fail(accessRes.error.message, 500);
    if (permRes.error) return fail(permRes.error.message, 500);

    const permsById: Record<string, string[]> = {};
    (permRes.data || []).forEach((p: any) => {
      (permsById[p.instructor_id] ||= []).push(p.permission);
    });

    const tenantNames: Record<string, string> = { ...FALLBACK_TENANT_NAMES };
    const hqTenantIds = new Set<string>(tenantRes.data ? [] : FALLBACK_HQ_TENANT_IDS);
    (tenantRes.data || []).forEach((t: any) => {
      tenantNames[String(t.tenant_id)] = t.name;
      if (String(t.tenant_type || "").toUpperCase() === "HQ") hqTenantIds.add(String(t.tenant_id));
    });

    const access: Record<string, { level: string; granted_at: string; granted_by: string | null }> = {};
    (accessRes.data || []).forEach((a: any) => {
      access[a.instructor_id] = { level: a.access_level, granted_at: a.granted_at, granted_by: a.granted_by };
    });

    const staff = (staffRes.data || []).map((s: any) => ({
      instructor_id: String(s.instructor_id),
      name: s.name,
      position: s.position || s.chat_position || "",
      department: (s.department || "부서 미지정").trim(),
      tenant_name: tenantNames[String(s.tenant_id)] || "소속 미지정",
      is_hq: hqTenantIds.has(String(s.tenant_id)),
      contest_access: access[String(s.instructor_id)]?.level || null,
      granted_at: access[String(s.instructor_id)]?.granted_at || null,
      permissions: permsById[String(s.instructor_id)] || [],
    }));

    return NextResponse.json({ success: true, data: { me: auth.userId, staff } });
  } catch (e: any) {
    console.error("HQ permissions GET error:", e);
    return fail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireHqAdmin(req);
    if (auth instanceof NextResponse) return auth;

    const body = await req.json();
    const instructorId = String(body?.instructor_id || "");
    if (!instructorId) return fail("직원 id가 없습니다.");

    // 실제 재직 직원인지 확인 (아무 id나 명단에 넣지 못하게)
    const { data: target } = await supabaseAdmin
      .from("instructor")
      .select("instructor_id, name")
      .eq("instructor_id", instructorId)
      .maybeSingle();
    if (!target) return fail("직원을 찾을 수 없습니다.", 404);

    const { data: me } = await supabaseAdmin.from("instructor").select("name").eq("instructor_id", auth.userId).maybeSingle();
    const grantedBy = me?.name || auth.userId;

    // ---- 켜기/끄기형 메뉴 권한 ----
    if (body?.permission !== undefined) {
      const permission = String(body.permission) as TogglePermission;
      if (!TOGGLE_PERMISSIONS.includes(permission)) return fail("알 수 없는 권한입니다.");
      if (body.enabled) {
        const { error } = await supabaseAdmin.from("hq_permissions").upsert(
          { instructor_id: instructorId, permission, granted_by: grantedBy, granted_at: new Date().toISOString() },
          { onConflict: "instructor_id,permission" }
        );
        if (error) return fail(error.message, 500);
      } else {
        const { error } = await supabaseAdmin.from("hq_permissions").delete()
          .eq("instructor_id", instructorId).eq("permission", permission);
        if (error) return fail(error.message, 500);
      }
      return NextResponse.json({ success: true, data: { instructor_id: instructorId, permission, enabled: Boolean(body.enabled) } });
    }

    // ---- 문제 DB 권한 ----
    const level = body?.contest_access ?? null;
    if (level !== null && level !== "word" && level !== "all") return fail("잘못된 권한 값입니다.");

    if (level === null) {
      const { error } = await supabaseAdmin.from("contest_db_access").delete().eq("instructor_id", instructorId);
      if (error) return fail(error.message, 500);
    } else {
      const { error } = await supabaseAdmin.from("contest_db_access").upsert(
        {
          instructor_id: instructorId,
          access_level: level,
          granted_at: new Date().toISOString(),
          granted_by: grantedBy,
          note: "포털 권한 관리에서 변경",
        },
        { onConflict: "instructor_id" }
      );
      if (error) return fail(error.message, 500);
    }

    return NextResponse.json({ success: true, data: { instructor_id: instructorId, contest_access: level } });
  } catch (e: any) {
    console.error("HQ permissions POST error:", e);
    return fail(String(e?.message || e), 500);
  }
}
