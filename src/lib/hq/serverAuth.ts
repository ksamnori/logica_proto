// src/lib/hq/serverAuth.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  FALLBACK_HQ_TENANT_ID,
  FALLBACK_TENANT_NAMES,
  getRankLevel,
  inferRankFromPosition,
} from "./constants";
import type { HqRankCode } from "./types";

export function getSupabaseAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export function apiFail(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export function isMissingHqTableError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || err.details || "");
  if (code === "42P01" || code === "PGRST205") return true;
  return (
    /hq_(member_profile|approval_doc|approval_step|expense|attendance|contract|payroll|publication)/i.test(
      msg
    ) && /(does not exist|schema cache|Could not find the table)/i.test(msg)
  );
}

export function extractBearerOrCookieToken(req: NextRequest): string | undefined {
  let token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) token = req.cookies.get("sb-access-token")?.value;
  if (!token) {
    const authCookie = req.cookies
      .getAll()
      .find((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));
    if (authCookie) {
      try {
        const parsed = JSON.parse(authCookie.value);
        if (Array.isArray(parsed) && parsed[0]) token = parsed[0];
      } catch {
        // ignore malformed cookie
      }
    }
  }
  return token || undefined;
}

export interface HqCallerInfo {
  userId: string;
  name: string;
  department: string;
  rankCode: HqRankCode;
  rankLevel: number;
  jobTitle: string;
  tenantId: string | null;
  hqTenantIds: Set<string>;
  tenantNames: Record<string, string>;
  isHqAdmin: boolean;
  isHrManager: boolean;
  schemaMissing: boolean;
  extSchemaMissing: boolean;
}

/**
 * 본부(HQ) 전용 API 인증·권한 가드
 * - 학원 가맹점 일반 강사 계정의 우회 접근을 차단하고, 본부 소속 임직원 및 최고관리자만 통과시킴
 */
export async function requireHqCaller(
  req: NextRequest
): Promise<HqCallerInfo | NextResponse> {
  const token = extractBearerOrCookieToken(req);
  if (!token) return apiFail("본부 로그인이 필요합니다.", 401);

  const supabaseAdmin = getSupabaseAdmin();
  const {
    data: { user },
    error: userErr,
  } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !user) {
    return apiFail("유효하지 않거나 만료된 세션입니다. 다시 로그인해 주세요.", 401);
  }

  const supabaseAsUser = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    }
  );

  const [instRes, tenantRes, adminRpcRes, profileRes, extProbeRes] =
    await Promise.all([
      supabaseAdmin
        .from("instructor")
        .select(
          "instructor_id, name, role, position, chat_position, department, tenant_id, status"
        )
        .eq("instructor_id", user.id)
        .maybeSingle(),
      supabaseAdmin.from("academy_tenant").select("tenant_id, name, tenant_type"),
      supabaseAsUser.rpc("is_hq_admin"),
      supabaseAdmin
        .from("hq_member_profile")
        .select("*")
        .eq("instructor_id", user.id)
        .maybeSingle(),
      supabaseAdmin.from("hq_attendance").select("attendance_id").limit(1),
    ]);

  if (instRes.error || !instRes.data) {
    return apiFail("본부 구성원 계정을 찾을 수 없습니다.", 403);
  }

  const inst = instRes.data;
  const tenantNames: Record<string, string> = { ...FALLBACK_TENANT_NAMES };
  const hqTenantIds = new Set<string>([FALLBACK_HQ_TENANT_ID]);

  (tenantRes.data || []).forEach((t: any) => {
    tenantNames[String(t.tenant_id)] = t.name;
    if (
      String(t.tenant_type || "").toUpperCase() === "HQ" ||
      String(t.name || "").includes("본사")
    ) {
      hqTenantIds.add(String(t.tenant_id));
    }
  });

  const rpcHqAdmin = adminRpcRes.data === true;
  const isHqTenantMember = Boolean(
    inst.tenant_id && hqTenantIds.has(String(inst.tenant_id))
  );
  const isSuperRole = String(inst.role || "").toUpperCase() === "SUPER_ADMIN";

  if (!isHqTenantMember && !isSuperRole && !rpcHqAdmin) {
    return apiFail("본부(HQ) 소속 임직원만 접근할 수 있습니다.", 403);
  }

  const schemaMissing = isMissingHqTableError(profileRes.error);
  const extSchemaMissing = isMissingHqTableError(extProbeRes.error);
  const prof = !profileRes.error ? profileRes.data : null;

  const inferred = inferRankFromPosition(inst.chat_position, inst.position);
  const rankCode: HqRankCode = (prof?.rank_code as HqRankCode) || inferred.rankCode;
  const rankLevel = getRankLevel(rankCode);
  const jobTitle = prof?.job_title || inferred.jobTitle;
  const department = (prof?.department || inst.department || "미지정").trim();

  let hasAnyExecutive = false;
  if (!schemaMissing) {
    const { count } = await supabaseAdmin
      .from("hq_member_profile")
      .select("instructor_id", { count: "exact", head: true })
      .in("rank_code", ["CEO", "DIRECTOR"]);
    hasAnyExecutive = (count ?? 0) > 0;
  }

  // 최고관리자: DB is_hq_admin 등록자, 대표·소장(Lv.5), 또는 임원 미배정 초기 상태의 본사 SUPER_ADMIN
  const isHqAdmin =
    rpcHqAdmin ||
    rankCode === "CEO" ||
    (!hasAnyExecutive && isHqTenantMember && isSuperRole);

  // 인사·급여 관리자: 최고관리자, 본부장·이사(Lv.4+), 경영지원 팀장(Lv.3+), 또는 최고관리자가 위임한 인사담당자(is_hr_admin)
  const isHrManager =
    isHqAdmin ||
    rankLevel >= 4 ||
    Boolean(prof?.is_hr_admin) ||
    (department.includes("경영지원") && rankLevel >= 3) ||
    (!hasAnyExecutive && isSuperRole);

  return {
    userId: user.id,
    name: inst.name || "본부 구성원",
    department,
    rankCode,
    rankLevel,
    jobTitle,
    tenantId: inst.tenant_id ? String(inst.tenant_id) : null,
    hqTenantIds,
    tenantNames,
    isHqAdmin,
    isHrManager,
    schemaMissing,
    extSchemaMissing,
  };
}
