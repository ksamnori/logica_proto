// src/app/api/hq/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { appendHqAuditLog } from "@/lib/hq/auditLogServer";
import {
  readCompanySettingsServer,
  SETTINGS_STORAGE_BUCKET,
  SETTINGS_STORAGE_FALLBACK_PATH,
} from "@/lib/hq/companySettingsServer";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqCompanySettings } from "@/lib/hq/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const [{ settings, usingFallback }, tenantRes] = await Promise.all([
      readCompanySettingsServer(supabaseAdmin),
      supabaseAdmin
        .from("academy_tenant")
        .select("tenant_id, name, tenant_type")
        .order("name", { ascending: true }),
    ]);

    const tenantBranches = (tenantRes.data || [])
      .filter((t: any) => !caller.hqTenantIds.has(String(t.tenant_id)))
      .map((t: any) => ({
        tenant_id: String(t.tenant_id),
        name: String(t.name || ""),
        tenant_type: String(t.tenant_type || ""),
      }));

    return NextResponse.json({
      success: true,
      usingFallback,
      data: {
        canEdit: caller.isHrManager || caller.isHqAdmin,
        settings,
        tenantBranches,
      },
    });
  } catch (e: any) {
    console.error("HQ settings GET error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    if (!caller.isHrManager && !caller.isHqAdmin) {
      return apiFail(
        "회사 기본 설정 변경은 인사관리자 또는 본부 최고관리자만 가능합니다.",
        403
      );
    }

    const body = await req.json();
    const supabaseAdmin = getSupabaseAdmin();
    const { settings: current, usingFallback } =
      await readCompanySettingsServer(supabaseAdmin);

    const nowIso = new Date().toISOString();
    const actorLabel = `${caller.name} (${caller.jobTitle})`;

    const next: HqCompanySettings = {
      company_name:
        body.company_name !== undefined
          ? String(body.company_name).trim() || current.company_name
          : current.company_name,
      company_code:
        body.company_code !== undefined
          ? String(body.company_code).trim() || current.company_code
          : current.company_code,
      ceo_names:
        Array.isArray(body.ceo_names) && body.ceo_names.length > 0
          ? body.ceo_names.map((s: any) => String(s).trim()).filter(Boolean)
          : current.ceo_names,
      phone:
        body.phone !== undefined ? String(body.phone).trim() : current.phone,
      founded_date:
        body.founded_date !== undefined
          ? String(body.founded_date || current.founded_date)
          : current.founded_date,
      address:
        body.address !== undefined
          ? String(body.address).trim()
          : current.address,
      business_reg_no:
        body.business_reg_no !== undefined
          ? String(body.business_reg_no).trim()
          : current.business_reg_no,
      corp_reg_no:
        body.corp_reg_no !== undefined
          ? String(body.corp_reg_no).trim()
          : current.corp_reg_no,
      cover_image_url:
        body.cover_image_url !== undefined
          ? body.cover_image_url || null
          : current.cover_image_url,
      logo_image_url:
        body.logo_image_url !== undefined
          ? body.logo_image_url || null
          : current.logo_image_url,
      seals: Array.isArray(body.seals) ? body.seals : current.seals,
      holidays_by_year:
        body.holidays_by_year && typeof body.holidays_by_year === "object"
          ? { ...current.holidays_by_year, ...body.holidays_by_year }
          : current.holidays_by_year,
      holiday_groups: Array.isArray(body.holiday_groups)
        ? body.holiday_groups
        : current.holiday_groups,
      affiliates: Array.isArray(body.affiliates)
        ? body.affiliates
        : current.affiliates,
      extra_settings:
        body.extra_settings && typeof body.extra_settings === "object"
          ? {
              ...current.extra_settings,
              ...body.extra_settings,
              info_approval_policy: {
                ...current.extra_settings.info_approval_policy,
                ...(body.extra_settings.info_approval_policy || {}),
              },
            }
          : current.extra_settings,
      updated_by: actorLabel,
      updated_at: nowIso,
    };

    if (!usingFallback) {
      const { error: upsertErr } = await supabaseAdmin
        .from("hq_company_settings")
        .upsert(
          {
            setting_key: "MAIN",
            company_name: next.company_name,
            company_code: next.company_code,
            ceo_names: next.ceo_names,
            phone: next.phone,
            founded_date: next.founded_date || null,
            address: next.address,
            business_reg_no: next.business_reg_no || null,
            corp_reg_no: next.corp_reg_no || null,
            cover_image_url: next.cover_image_url,
            logo_image_url: next.logo_image_url,
            seals_json: next.seals,
            holidays_json: next.holidays_by_year,
            holiday_groups_json: next.holiday_groups,
            affiliates_json: next.affiliates,
            extra_settings: next.extra_settings,
            updated_by: actorLabel,
            updated_at: nowIso,
          },
          { onConflict: "setting_key" }
        );

      if (upsertErr && !isMissingHqTableError(upsertErr)) {
        return apiFail(`설정 저장 실패: ${upsertErr.message}`, 500);
      }
    }

    const jsonBytes = new TextEncoder().encode(JSON.stringify(next, null, 2));
    await supabaseAdmin.storage
      .from(SETTINGS_STORAGE_BUCKET)
      .upload(SETTINGS_STORAGE_FALLBACK_PATH, jsonBytes, {
        contentType: "application/json",
        upsert: true,
      })
      .catch(() => {});

    const changedAreas = Object.keys(body?.extra_settings || {});
    const detailDesc =
      changedAreas.length > 0
        ? `회사 설정 수정 (${changedAreas.join(", ")})`
        : "회사 기본 정보 수정";
    appendHqAuditLog(supabaseAdmin, req, {
      activity_type: "권한 변경",
      user_id: caller.userId,
      user_name: caller.name,
      user_email: caller.email,
      department: caller.department,
      event_type: "수정",
      info_type: "인사정보",
      description: detailDesc,
      delegated: caller.isDelegatedHrAdmin,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      data: { settings: next },
    });
  } catch (e: any) {
    console.error("HQ settings PATCH error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
