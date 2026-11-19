// src/app/api/chat/org-directory/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readCompanySettingsServer } from "@/lib/hq/companySettingsServer";
import {
  FALLBACK_HQ_TENANT_ID,
  FALLBACK_TENANT_NAMES,
  getRankLevel,
  getRankMeta,
  HQ_RANKS,
  inferRankFromPosition,
} from "@/lib/hq/constants";
import { DEFAULT_ORG_CHART_NODES } from "@/lib/hq/defaultCompanySettings";
import { resolveMemberDisplayPosition } from "@/lib/hq/orgTreeHelper";
import {
  apiFail,
  extractBearerOrCookieToken,
  getSupabaseAdmin,
  isMissingHqTableError,
} from "@/lib/hq/serverAuth";
import type { HqRankCode, HqWorkStatus } from "@/lib/hq/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function checkIsDevSuperAdmin(params: {
  inst: any;
  prof: any;
  isHqTenant: boolean;
  devEmails: string[];
  extraEmail?: string | null;
}): boolean {
  const { inst, prof, isHqTenant, devEmails, extraEmail } = params;

  if (prof?.rank_code === "SUPER_ADMIN") return true;

  const emails = [inst?.email, extraEmail]
    .filter(Boolean)
    .map((e) => String(e).trim().toLowerCase());
  if (emails.some((em) => devEmails.includes(em))) return true;

  const posCombined = `${inst?.position || ""} ${inst?.chat_position || ""} ${
    prof?.job_title || ""
  }`;
  if (/최고관리자|수퍼어드민|개발자|대장/.test(posCombined)) {
    return true;
  }

  const roleUpper = String(inst?.role || "").toUpperCase();
  const posStr = String(inst?.position || "");
  if (!isHqTenant && roleUpper === "SUPER_ADMIN" && !posStr.includes("원장")) {
    return true;
  }

  return false;
}

export async function GET(req: NextRequest) {
  try {
    const rawToken = extractBearerOrCookieToken(req);
    const token =
      rawToken && rawToken !== "undefined" && rawToken !== "null"
        ? rawToken
        : undefined;
    if (!token) return apiFail("로그인이 필요합니다.", 401);

    const supabaseAdmin = getSupabaseAdmin();
    const {
      data: { user },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token);

    if (authErr || !user) {
      return apiFail("유효하지 않은 세션입니다.", 401);
    }

    const [tenantRes, instRes, profRes, companySettingsRes] = await Promise.all(
      [
        supabaseAdmin
          .from("academy_tenant")
          .select("tenant_id, name, tenant_type"),
        supabaseAdmin
          .from("instructor")
          .select(
            "instructor_id, name, email, position, chat_position, profile_image_url, department, tenant_id, role, status"
          )
          .eq("status", "재직")
          .order("name"),
        supabaseAdmin
          .from("hq_member_profile")
          .select(
            "instructor_id, department, rank_code, job_title, is_dept_head, work_status, profile_extra"
          ),
        readCompanySettingsServer(supabaseAdmin).catch(() => null),
      ]
    );

    if (instRes.error) {
      return apiFail(instRes.error.message, 500);
    }

    const callerExists = (instRes.data || []).some(
      (r: any) => String(r.instructor_id) === String(user.id)
    );
    if (!callerExists) {
      const { data: fallbackMe } = await supabaseAdmin
        .from("instructor")
        .select("instructor_id")
        .eq("instructor_id", user.id)
        .maybeSingle();
      if (!fallbackMe) {
        return apiFail("강사/구성원 계정을 찾을 수 없습니다.", 403);
      }
    }

    const tenantNames: Record<string, string> = { ...FALLBACK_TENANT_NAMES };
    const hqTenantIds = new Set<string>([FALLBACK_HQ_TENANT_ID]);
    const tenants: { tenant_id: string; name: string; is_hq: boolean }[] = [];

    (tenantRes.data || []).forEach((t: any) => {
      const tid = String(t.tenant_id);
      const tName = String(t.name || "").trim() || "소속 미지정";
      tenantNames[tid] = tName;
      const isHq =
        tid === FALLBACK_HQ_TENANT_ID ||
        String(t.tenant_type || "").toUpperCase() === "HQ" ||
        tName.includes("본사") ||
        tName.includes("천종현");
      if (isHq) hqTenantIds.add(tid);
      tenants.push({ tenant_id: tid, name: tName, is_hq: isHq });
    });

    if (tenants.length === 0) {
      Object.entries(FALLBACK_TENANT_NAMES).forEach(([tid, tName]) => {
        tenants.push({
          tenant_id: tid,
          name: tName,
          is_hq: tid === FALLBACK_HQ_TENANT_ID,
        });
      });
    }

    const profMap = new Map<string, any>();
    if (!profRes.error && profRes.data) {
      profRes.data.forEach((p: any) => {
        profMap.set(String(p.instructor_id), p);
      });
    } else if (profRes.error && !isMissingHqTableError(profRes.error)) {
      console.warn("hq_member_profile lookup warning:", profRes.error.message);
    }

    const devEmails = (process.env.HQ_DEV_SUPER_ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const instructors: any[] = [];
    const hqMembers: any[] = [];

    for (const inst of instRes.data || []) {
      const id = String(inst.instructor_id);
      const tid = inst.tenant_id ? String(inst.tenant_id) : "";
      const tName = (tid && tenantNames[tid]) || "소속 미지정";
      const isHqTenant = Boolean(tid && hqTenantIds.has(tid));
      const prof = profMap.get(id);

      if (prof?.work_status === "퇴직") continue;

      const rawExtra =
        prof?.profile_extra &&
        typeof prof.profile_extra === "object" &&
        !Array.isArray(prof.profile_extra)
          ? prof.profile_extra
          : {};

      const isExplicitGhost = Boolean(prof && rawExtra.is_ghost === true);
      const isDevSuperAdmin = checkIsDevSuperAdmin({
        inst,
        prof,
        isHqTenant,
        devEmails,
        extraEmail: id === user.id ? user.email : null,
      });

      const sanitizedItem = {
        instructor_id: id,
        name: inst.name || "구성원",
        role: inst.role || "",
        position: inst.position || "",
        chat_position: inst.chat_position || "",
        profile_image_url: inst.profile_image_url || null,
        department: inst.department || "",
        tenant_id: tid || null,
        academy_tenant: { name: tName },
        is_hq_tenant: isHqTenant,
        is_explicit_ghost: isExplicitGhost,
        is_dev_super_admin: isDevSuperAdmin,
      };

      instructors.push(sanitizedItem);

      if (isHqTenant && !isExplicitGhost) {
        const inf = inferRankFromPosition(inst.chat_position, inst.position);
        const rankCode: HqRankCode =
          prof?.rank_code && prof.rank_code in HQ_RANKS
            ? (prof.rank_code as HqRankCode)
            : inf.rankCode;
        const rankMeta = getRankMeta(rankCode);
        const department =
          (prof?.department || inst.department || "미지정").trim() || "미지정";
        const isDeptHead = Boolean(prof?.is_dept_head ?? inf.isDeptHead);
        const workStatus: HqWorkStatus =
          (prof?.work_status as HqWorkStatus) || "재직";

        const publicExtra = {
          is_ghost: isExplicitGhost,
          hr_position: rawExtra.hr_position || "",
          org_assignments: Array.isArray(rawExtra.org_assignments)
            ? rawExtra.org_assignments
            : [],
        };

        hqMembers.push({
          instructor_id: id,
          name: inst.name || "구성원",
          profile_image_url: inst.profile_image_url || null,
          tenant_id: tid,
          tenant_name: tName,
          is_hq_tenant: true,
          is_ghost: isExplicitGhost,
          department,
          rank_code: rankCode,
          rank_level: getRankLevel(rankCode),
          rank_label: rankMeta.shortLabel,
          job_title: resolveMemberDisplayPosition({
            department,
            rank_code: rankCode,
            job_title: prof?.job_title || inf.jobTitle,
            is_dept_head: isDeptHead,
            profile_extra: publicExtra,
          }),
          is_dept_head: isDeptHead,
          work_status: workStatus,
          profile_extra: publicExtra,
        });
      }
    }

    const savedOrgNodes =
      companySettingsRes?.settings?.extra_settings?.org_chart_nodes;
    const orgNodes =
      Array.isArray(savedOrgNodes) && savedOrgNodes.length > 0
        ? savedOrgNodes
        : DEFAULT_ORG_CHART_NODES;

    return NextResponse.json({
      success: true,
      data: {
        tenants,
        instructors,
        hqMembers,
        orgNodes,
      },
    });
  } catch (e: any) {
    console.error("Chat org-directory GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
