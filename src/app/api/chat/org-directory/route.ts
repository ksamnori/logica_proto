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
import {
  isHqTenantName,
  isInactiveForMessengerOrg,
  isItStrategyMember,
  type OrgAssignmentLike,
  shouldHideAcademyItStrategyInOrg,
} from "@/lib/hq/messengerOrgFilter";
import { resolveMemberDisplayPosition } from "@/lib/hq/orgTreeHelper";
import {
  apiFail,
  extractBearerOrCookieToken,
  getSupabaseAdmin,
  isMissingHqTableError,
} from "@/lib/hq/serverAuth";
import type { HqMember, HqRankCode, HqWorkStatus } from "@/lib/hq/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TenantRow {
  tenant_id: string;
  name?: string | null;
  tenant_type?: string | null;
}

interface InstructorRow {
  instructor_id: string;
  name?: string | null;
  email?: string | null;
  position?: string | null;
  chat_position?: string | null;
  profile_image_url?: string | null;
  department?: string | null;
  tenant_id?: string | null;
  role?: string | null;
  status?: string | null;
}

interface ProfileRow {
  instructor_id: string;
  department?: string | null;
  rank_code?: string | null;
  job_title?: string | null;
  is_dept_head?: boolean | null;
  work_status?: string | null;
  profile_extra?: Record<string, unknown> | null;
}

function extractRawExtra(prof?: ProfileRow | null): Record<string, unknown> {
  if (
    prof?.profile_extra &&
    typeof prof.profile_extra === "object" &&
    !Array.isArray(prof.profile_extra)
  ) {
    return prof.profile_extra;
  }
  return {};
}

function extractOrgAssignments(
  rawExtra: Record<string, unknown>
): OrgAssignmentLike[] {
  if (!Array.isArray(rawExtra.org_assignments)) return [];
  return rawExtra.org_assignments as OrgAssignmentLike[];
}

function checkIsDevSuperAdmin(params: {
  inst: InstructorRow;
  prof?: ProfileRow | null;
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

    const instRows = (instRes.data || []) as InstructorRow[];
    let callerInst = instRows.find(
      (r) => String(r.instructor_id) === String(user.id)
    );

    if (!callerInst) {
      const { data: fallbackMe } = await supabaseAdmin
        .from("instructor")
        .select(
          "instructor_id, name, email, position, chat_position, profile_image_url, department, tenant_id, role, status"
        )
        .eq("instructor_id", user.id)
        .maybeSingle();
      if (!fallbackMe) {
        return apiFail("강사/구성원 계정을 찾을 수 없습니다.", 403);
      }
      callerInst = fallbackMe as InstructorRow;
    }

    const tenantNames: Record<string, string> = { ...FALLBACK_TENANT_NAMES };
    const hqTenantIds = new Set<string>([FALLBACK_HQ_TENANT_ID]);
    const tenants: { tenant_id: string; name: string; is_hq: boolean }[] = [];

    ((tenantRes.data || []) as TenantRow[]).forEach((t) => {
      const tid = String(t.tenant_id);
      const tName = String(t.name || "").trim() || "소속 미지정";
      tenantNames[tid] = tName;
      const isHq =
        tid === FALLBACK_HQ_TENANT_ID ||
        String(t.tenant_type || "").toUpperCase() === "HQ" ||
        isHqTenantName(tName);
      if (isHq) hqTenantIds.add(tid);
      tenants.push({ tenant_id: tid, name: tName, is_hq: isHq });
    });

    if (tenants.length === 0) {
      Object.entries(FALLBACK_TENANT_NAMES).forEach(([tid, tName]) => {
        tenants.push({
          tenant_id: tid,
          name: tName,
          is_hq: tid === FALLBACK_HQ_TENANT_ID || isHqTenantName(tName),
        });
      });
    }

    const profMap = new Map<string, ProfileRow>();
    if (!profRes.error && profRes.data) {
      (profRes.data as ProfileRow[]).forEach((p) => {
        profMap.set(String(p.instructor_id), p);
      });
    } else if (profRes.error && !isMissingHqTableError(profRes.error)) {
      console.warn("hq_member_profile lookup warning:", profRes.error.message);
    }

    const callerProf = profMap.get(String(user.id));
    const callerExtra = extractRawExtra(callerProf);
    const callerIsItStrategy = isItStrategyMember({
      instDept: callerInst?.department,
      hqDept: callerProf?.department,
      orgAssignments: extractOrgAssignments(callerExtra),
    });

    const devEmails = (process.env.HQ_DEV_SUPER_ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const instructors: Array<Record<string, unknown>> = [];
    const hqMembers: Array<Record<string, unknown>> = [];

    for (const inst of instRows) {
      const id = String(inst.instructor_id);
      const tid = inst.tenant_id ? String(inst.tenant_id) : "";
      const tName = (tid && tenantNames[tid]) || "소속 미지정";
      const isHqTenant =
        Boolean(tid && hqTenantIds.has(tid)) || isHqTenantName(tName);
      const prof = profMap.get(id);
      const rawExtra = extractRawExtra(prof);
      const orgAssignments = extractOrgAssignments(rawExtra);

      const isTargetItStrategy = isItStrategyMember({
        instDept: inst.department,
        hqDept: isHqTenant ? prof?.department : null,
        orgAssignments: isHqTenant ? orgAssignments : null,
      });

      // 학원 계정이 /hq 접속 시 자동 생성된 shadow profile의 is_ghost(비본부 표시용)는
      // 학원 IT전략팀 본인끼리의 노출을 막지 않도록 본부 계정과 구분 처리
      const isExplicitGhost = isHqTenant
        ? Boolean(prof && rawExtra.is_ghost === true)
        : !isTargetItStrategy && Boolean(prof && rawExtra.is_ghost === true);

      // 퇴직·휴직·유령 계정은 메신저 조직도에서 제외
      if (
        isInactiveForMessengerOrg({
          instStatus: inst.status,
          workStatus: prof?.work_status,
          isExplicitGhost,
        })
      ) {
        continue;
      }

      // 접속자가 IT전략팀 본인이 아니면 학원 측 IT전략팀은 조직도에 절대 노출하지 않음
      if (
        shouldHideAcademyItStrategyInOrg({
          isHqTenant,
          isTargetItStrategy,
          viewerIsItStrategy: callerIsItStrategy,
        })
      ) {
        continue;
      }

      const isDevSuperAdmin = checkIsDevSuperAdmin({
        inst,
        prof,
        isHqTenant,
        devEmails,
        extraEmail: id === user.id ? user.email : null,
      });

      const workStatus: HqWorkStatus =
        (prof?.work_status as HqWorkStatus) || "재직";

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
        is_it_strategy: isTargetItStrategy,
        work_status: workStatus,
      };

      instructors.push(sanitizedItem);

      if (isHqTenant && !isExplicitGhost) {
        const inf = inferRankFromPosition(
          inst.chat_position ?? undefined,
          inst.position ?? undefined
        );
        const rankCode: HqRankCode =
          prof?.rank_code && prof.rank_code in HQ_RANKS
            ? (prof.rank_code as HqRankCode)
            : inf.rankCode;
        const rankMeta = getRankMeta(rankCode);
        const department =
          (prof?.department || inst.department || "미지정").trim() || "미지정";
        const isDeptHead = Boolean(prof?.is_dept_head ?? inf.isDeptHead);

        const publicExtra: HqMember["profile_extra"] = {
          is_ghost: isExplicitGhost,
          hr_position:
            typeof rawExtra.hr_position === "string"
              ? rawExtra.hr_position
              : "",
          org_assignments: Array.isArray(rawExtra.org_assignments)
            ? (rawExtra.org_assignments as NonNullable<
                HqMember["profile_extra"]
              >["org_assignments"])
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
        callerIsItStrategy,
      },
    });
  } catch (e: unknown) {
    console.error("Chat org-directory GET error:", e);
    const message = e instanceof Error ? e.message : String(e);
    return apiFail(message, 500);
  }
}
