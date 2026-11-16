// src/lib/hq/serverAuth.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { extractClientIp } from "./auditLogServer";
import { readCompanySettingsServer } from "./companySettingsServer";
import {
  FALLBACK_HQ_TENANT_ID,
  FALLBACK_TENANT_NAMES,
  getRankLevel,
  inferRankFromPosition,
} from "./constants";
import { isIpMatchedByRule } from "./defaultSecuritySettings";
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
    /hq_(member_profile|approval_doc|approval_step|expense|attendance|contract|payroll|publication|company_settings)/i.test(
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
  email: string;
  department: string;
  rankCode: HqRankCode;
  rankLevel: number;
  jobTitle: string;
  tenantId: string | null;
  hqTenantIds: Set<string>;
  tenantNames: Record<string, string>;
  isHqAdmin: boolean;
  isHrManager: boolean;
  isDelegatedHrAdmin: boolean;
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
  const posStr = String(inst.position || "");
  const isSuperRole =
    String(inst.role || "").toUpperCase() === "SUPER_ADMIN" ||
    posStr.includes("최고관리자") ||
    posStr.includes("대장");

  if (!isHqTenantMember && !isSuperRole && !rpcHqAdmin) {
    return apiFail("본부(HQ) 소속 임직원만 접근할 수 있습니다.", 403);
  }

  const schemaMissing = isMissingHqTableError(profileRes.error);
  const extSchemaMissing = isMissingHqTableError(extProbeRes.error);
  const prof = !profileRes.error ? profileRes.data : null;

  const inferred = inferRankFromPosition(inst.chat_position, inst.position);
  const rankCode: HqRankCode =
    (prof?.rank_code as HqRankCode) || (isSuperRole ? "CEO" : inferred.rankCode);
  const rankLevel = getRankLevel(rankCode);
  const jobTitle = prof?.job_title || inferred.jobTitle;
  const department = (prof?.department || inst.department || "미지정").trim();

  // 최고관리자: DB is_hq_admin 등록자, 전체 시스템 SUPER_ADMIN(최고관리자), 또는 대표·소장(Lv.5)
  let isHqAdmin = rpcHqAdmin || isSuperRole || rankCode === "CEO";

  // 인사·급여 관리자: 최고관리자, 본부장·이사(Lv.4+), 경영지원 팀장(Lv.3+), 또는 최고관리자가 위임한 인사담당자(is_hr_admin)
  let isDelegatedHrAdmin = !isHqAdmin && Boolean(prof?.is_hr_admin);
  let isHrManager =
    isHqAdmin ||
    rankLevel >= 4 ||
    Boolean(prof?.is_hr_admin) ||
    (department.includes("경영지원") && rankLevel >= 3);

  // 권한 설정(권한 그룹) 및 특정 IP 접근 허용 보안 정책 검증
  try {
    const { settings } = await readCompanySettingsServer(supabaseAdmin);
    const callerName = String(inst.name || "").trim();
    const permCfg = settings.extra_settings?.permission_settings;
    if (permCfg && callerName) {
      if (
        Array.isArray(permCfg.super_admin_names) &&
        permCfg.super_admin_names.includes(callerName)
      ) {
        isHqAdmin = true;
        isHrManager = true;
      } else if (Array.isArray(permCfg.groups)) {
        const myGroups = permCfg.groups.filter(
          (g) => Array.isArray(g.member_names) && g.member_names.includes(callerName)
        );
        const hasAdminGroupPerm = myGroups.some(
          (g) =>
            g.permissions?.["company.basic_manage"] ||
            g.permissions?.["hr.employment_manage"] ||
            g.permissions?.["payroll.run"] ||
            g.permissions?.["permission.manage"] ||
            g.permissions?.["audit.view"]
        );
        if (hasAdminGroupPerm) {
          if (!isHrManager) isDelegatedHrAdmin = true;
          isHrManager = true;
        }
      }
    }

    const sec = settings.extra_settings?.security_settings;
    if (
      sec?.ip_restriction_enabled &&
      Array.isArray(sec.allowed_ips) &&
      sec.allowed_ips.length > 0
    ) {
      const clientIp = extractClientIp(req);
      const isLocalhost =
        clientIp === "127.0.0.1" ||
        clientIp === "::1" ||
        clientIp === "localhost";
      const pathname = req.nextUrl?.pathname || "";
      const isAdminRecoveryPath =
        isHqAdmin &&
        (pathname.startsWith("/api/hq/settings") ||
          pathname.startsWith("/api/hq/audit-logs"));
      const skipForSuperAdmin = isHqAdmin && !sec.ip_restrict_super_admin;

      if (!isLocalhost && !isAdminRecoveryPath && !skipForSuperAdmin) {
        const matched = sec.allowed_ips.some((entry) =>
          isIpMatchedByRule(clientIp, entry.ip_or_cidr)
        );
        if (!matched) {
          const scope = sec.ip_restriction_scope || "모든 기능 제한";
          const method = req.method.toUpperCase();
          if (scope === "모든 기능 제한") {
            return apiFail(
              `허용되지 않은 IP(${clientIp})에서의 HQ 접근이 제한되어 있습니다.`,
              403
            );
          }
          if (scope === "쓰기·다운로드만 제한" && method !== "GET") {
            return apiFail(
              `허용되지 않은 외부 IP(${clientIp})에서는 조회만 가능하며 변경 작업이 제한됩니다.`,
              403
            );
          }
          if (
            scope === "급여·인사 민감정보만 제한" &&
            (pathname.startsWith("/api/hq/payroll") ||
              pathname.startsWith("/api/hq/contracts"))
          ) {
            return apiFail(
              `허용된 사내 IP 외(${clientIp})에서는 급여·전자계약 민감정보에 접근할 수 없습니다.`,
              403
            );
          }
        }
      }
    }
  } catch {
    // 보안 설정 조회 오류 시 기존 인증 흐름 유지
  }

  return {
    userId: user.id,
    name: inst.name || "본부 구성원",
    email: user.email || "-",
    department,
    rankCode,
    rankLevel,
    jobTitle,
    tenantId: inst.tenant_id ? String(inst.tenant_id) : null,
    hqTenantIds,
    tenantNames,
    isHqAdmin,
    isHrManager,
    isDelegatedHrAdmin,
    schemaMissing,
    extSchemaMissing,
  };
}
