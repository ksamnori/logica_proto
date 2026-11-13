// src/app/api/hq/permissions/route.ts
// 본부(HQ) 포털 "통합 직급 · 관리자 · 연구DB 권한 관리" 전용 API (최고관리자 전용)
import { NextRequest, NextResponse } from "next/server";
import {
  FALLBACK_HQ_TENANT_ID,
  FALLBACK_TENANT_NAMES,
  getRankMeta,
  HQ_RANKS,
  inferRankFromPosition,
} from "@/lib/hq/constants";
import {
  apiFail,
  getSupabaseAdmin,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqRankCode } from "@/lib/hq/types";

export const runtime = "nodejs";

const TOGGLE_PERMISSIONS = ["admission_analytics"] as const;
type TogglePermission = (typeof TOGGLE_PERMISSIONS)[number];

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;
    if (!caller.isHqAdmin) {
      return apiFail(
        "최고관리자(대표·소장 또는 포털 권한관리자)만 접근할 수 있습니다.",
        403
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const [staffRes, accessRes, tenantRes, permRes, profileRes] =
      await Promise.all([
        supabaseAdmin
          .from("instructor")
          .select(
            "instructor_id, name, position, chat_position, department, tenant_id, role"
          )
          .eq("status", "재직")
          .order("name"),
        supabaseAdmin
          .from("contest_db_access")
          .select("instructor_id, access_level, granted_at, granted_by"),
        supabaseAdmin
          .from("academy_tenant")
          .select("tenant_id, name, tenant_type"),
        supabaseAdmin
          .from("hq_permissions")
          .select("instructor_id, permission"),
        supabaseAdmin.from("hq_member_profile").select("*"),
      ]);

    if (staffRes.error) return apiFail(staffRes.error.message, 500);
    if (accessRes.error) return apiFail(accessRes.error.message, 500);
    if (permRes.error) return apiFail(permRes.error.message, 500);

    const permsById: Record<string, string[]> = {};
    (permRes.data || []).forEach((p: any) => {
      (permsById[p.instructor_id] ||= []).push(p.permission);
    });

    const profById = new Map<string, any>();
    (profileRes.data || []).forEach((p: any) => {
      profById.set(String(p.instructor_id), p);
    });

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

    const access: Record<
      string,
      { level: string; granted_at: string; granted_by: string | null }
    > = {};
    (accessRes.data || []).forEach((a: any) => {
      access[a.instructor_id] = {
        level: a.access_level,
        granted_at: a.granted_at,
        granted_by: a.granted_by,
      };
    });

    const staff = (staffRes.data || []).map((s: any) => {
      const id = String(s.instructor_id);
      const prof = profById.get(id);
      const inferred = inferRankFromPosition(s.chat_position, s.position);
      const rankCode: HqRankCode =
        (prof?.rank_code as HqRankCode) || inferred.rankCode;
      const dept = (prof?.department || s.department || "부서 미지정").trim();

      return {
        instructor_id: id,
        name: s.name,
        position: prof?.job_title || s.chat_position || s.position || "",
        department: dept,
        tenant_name: tenantNames[String(s.tenant_id)] || "소속 미지정",
        is_hq: hqTenantIds.has(String(s.tenant_id)),
        rank_code: rankCode,
        is_dept_head: Boolean(prof?.is_dept_head ?? inferred.isDeptHead),
        is_hr_admin: Boolean(prof?.is_hr_admin),
        contest_access: access[id]?.level || null,
        granted_at: access[id]?.granted_at || null,
        permissions: permsById[id] || [],
      };
    });

    return NextResponse.json({
      success: true,
      data: { me: caller.userId, staff },
    });
  } catch (e: any) {
    console.error("HQ permissions GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;
    if (!caller.isHqAdmin) {
      return apiFail(
        "최고관리자(대표·소장 또는 포털 권한관리자)만 변경할 수 있습니다.",
        403
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const body = await req.json();
    const instructorId = String(body?.instructor_id || "");
    if (!instructorId) return apiFail("직원 id가 없습니다.");

    const { data: target } = await supabaseAdmin
      .from("instructor")
      .select("instructor_id, name, department, chat_position, position")
      .eq("instructor_id", instructorId)
      .maybeSingle();
    if (!target) return apiFail("직원을 찾을 수 없습니다.", 404);

    const grantedBy = caller.name || caller.userId;
    const nowIso = new Date().toISOString();

    // 1) 본부 직급(Lv.1~Lv.5) · 부서장 · 인사관리자 위임 배정
    if (
      body?.rank_code !== undefined ||
      body?.is_dept_head !== undefined ||
      body?.is_hr_admin !== undefined
    ) {
      const { data: existingProf } = await supabaseAdmin
        .from("hq_member_profile")
        .select("*")
        .eq("instructor_id", instructorId)
        .maybeSingle();

      const inferred = inferRankFromPosition(
        target.chat_position,
        target.position
      );
      const nextRank: HqRankCode =
        body?.rank_code && body.rank_code in HQ_RANKS
          ? (body.rank_code as HqRankCode)
          : (existingProf?.rank_code as HqRankCode) || inferred.rankCode;

      const nextTitle =
        body?.rank_code && (!existingProf?.job_title || existingProf.job_title === getRankMeta(existingProf.rank_code).defaultTitle)
          ? getRankMeta(nextRank).defaultTitle
          : existingProf?.job_title || inferred.jobTitle;

      const nextDeptHead =
        body?.is_dept_head !== undefined
          ? Boolean(body.is_dept_head)
          : Boolean(existingProf?.is_dept_head ?? inferred.isDeptHead);

      const upsertPayload: Record<string, any> = {
        instructor_id: instructorId,
        department: existingProf?.department || target.department || "미지정",
        rank_code: nextRank,
        job_title: nextTitle,
        is_dept_head: nextDeptHead,
        updated_at: nowIso,
      };

      if (body?.is_hr_admin !== undefined) {
        upsertPayload.is_hr_admin = Boolean(body.is_hr_admin);
      }

      const { error: profErr } = await supabaseAdmin
        .from("hq_member_profile")
        .upsert(upsertPayload, { onConflict: "instructor_id" });

      if (profErr) {
        if (/is_hr_admin/i.test(profErr.message)) {
          return apiFail(
            "상단 노란 배너(또는 supabase/hq_schema.sql)의 최신 SQL을 먼저 1회 실행해 주세요.",
            400
          );
        }
        return apiFail(`직급·권한 저장 실패: ${profErr.message}`, 500);
      }

      // instructor 테이블의 role도 대표·임원 배정 시 SUPER_ADMIN으로 동기화
      await supabaseAdmin
        .from("instructor")
        .update({
          chat_position: nextTitle,
          role:
            nextRank === "CEO" || nextRank === "DIRECTOR"
              ? "SUPER_ADMIN"
              : "ADMIN",
        })
        .eq("instructor_id", instructorId);

      return NextResponse.json({
        success: true,
        data: {
          instructor_id: instructorId,
          rank_code: nextRank,
          is_dept_head: nextDeptHead,
          is_hr_admin:
            body?.is_hr_admin !== undefined
              ? Boolean(body.is_hr_admin)
              : Boolean(existingProf?.is_hr_admin),
        },
      });
    }

    // 2) 진단평가 분석 메뉴 권한 토글
    if (body?.permission !== undefined) {
      const permission = String(body.permission) as TogglePermission;
      if (!TOGGLE_PERMISSIONS.includes(permission)) {
        return apiFail("알 수 없는 권한입니다.");
      }
      if (body.enabled) {
        const { error } = await supabaseAdmin.from("hq_permissions").upsert(
          {
            instructor_id: instructorId,
            permission,
            granted_by: grantedBy,
            granted_at: nowIso,
          },
          { onConflict: "instructor_id,permission" }
        );
        if (error) return apiFail(error.message, 500);
      } else {
        const { error } = await supabaseAdmin
          .from("hq_permissions")
          .delete()
          .eq("instructor_id", instructorId)
          .eq("permission", permission);
        if (error) return apiFail(error.message, 500);
      }
      return NextResponse.json({
        success: true,
        data: {
          instructor_id: instructorId,
          permission,
          enabled: Boolean(body.enabled),
        },
      });
    }

    // 3) 사고력·문장제 문제 DB 열람 등급 변경
    const level = body?.contest_access ?? null;
    if (level !== null && level !== "word" && level !== "all") {
      return apiFail("잘못된 권한 값입니다.");
    }

    if (level === null) {
      const { error } = await supabaseAdmin
        .from("contest_db_access")
        .delete()
        .eq("instructor_id", instructorId);
      if (error) return apiFail(error.message, 500);
    } else {
      const { error } = await supabaseAdmin.from("contest_db_access").upsert(
        {
          instructor_id: instructorId,
          access_level: level,
          granted_at: nowIso,
          granted_by: grantedBy,
          note: "본부 포털 권한 관리에서 변경",
        },
        { onConflict: "instructor_id" }
      );
      if (error) return apiFail(error.message, 500);
    }

    return NextResponse.json({
      success: true,
      data: { instructor_id: instructorId, contest_access: level },
    });
  } catch (e: any) {
    console.error("HQ permissions POST error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
