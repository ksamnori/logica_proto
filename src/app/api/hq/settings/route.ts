// src/app/api/hq/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_HQ_COMPANY_SETTINGS } from "@/lib/hq/defaultCompanySettings";
import {
  apiFail,
  getSupabaseAdmin,
  isMissingHqTableError,
  requireHqCaller,
} from "@/lib/hq/serverAuth";
import type { HqCompanySettings } from "@/lib/hq/types";

export const runtime = "nodejs";

const STORAGE_BUCKET = "system_images";
const STORAGE_FALLBACK_PATH = "hq_system_config/company_settings.json";

function normalizeSettings(raw: any): HqCompanySettings {
  const def = DEFAULT_HQ_COMPANY_SETTINGS;
  if (!raw || typeof raw !== "object") return def;

  const rawHolidays =
    raw.holidays_json || raw.holidays_by_year || {};
  const mergedHolidays: HqCompanySettings["holidays_by_year"] = {
    "2025": Array.isArray(rawHolidays["2025"])
      ? rawHolidays["2025"]
      : def.holidays_by_year["2025"],
    "2026": Array.isArray(rawHolidays["2026"])
      ? rawHolidays["2026"]
      : def.holidays_by_year["2026"],
    "2027": Array.isArray(rawHolidays["2027"])
      ? rawHolidays["2027"]
      : def.holidays_by_year["2027"],
    ...Object.fromEntries(
      Object.entries(rawHolidays).filter(
        ([k, v]) => !["2025", "2026", "2027"].includes(k) && Array.isArray(v)
      )
    ),
  };

  return {
    company_name: String(raw.company_name || def.company_name),
    company_code: String(raw.company_code || def.company_code),
    ceo_names:
      Array.isArray(raw.ceo_names) && raw.ceo_names.length > 0
        ? raw.ceo_names.map(String)
        : def.ceo_names,
    phone: String(raw.phone ?? def.phone),
    founded_date: String(raw.founded_date || def.founded_date).slice(0, 10),
    address: String(raw.address ?? def.address),
    business_reg_no: String(raw.business_reg_no || ""),
    corp_reg_no: String(raw.corp_reg_no || ""),
    cover_image_url: raw.cover_image_url || null,
    logo_image_url: raw.logo_image_url || null,
    seals: Array.isArray(raw.seals_json)
      ? raw.seals_json
      : Array.isArray(raw.seals)
        ? raw.seals
        : [],
    holidays_by_year: mergedHolidays,
    holiday_groups: Array.isArray(raw.holiday_groups_json)
      ? raw.holiday_groups_json
      : Array.isArray(raw.holiday_groups)
        ? raw.holiday_groups
        : [],
    affiliates: Array.isArray(raw.affiliates_json)
      ? raw.affiliates_json
      : Array.isArray(raw.affiliates)
        ? raw.affiliates
        : [],
    extra_settings: {
      ...def.extra_settings,
      ...(raw.extra_settings && typeof raw.extra_settings === "object"
        ? raw.extra_settings
        : {}),
    },
    updated_by: raw.updated_by || null,
    updated_at: raw.updated_at || null,
  };
}

async function readSettingsWithFallback(
  supabaseAdmin: SupabaseClient
): Promise<{ settings: HqCompanySettings; usingFallback: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("hq_company_settings")
    .select("*")
    .eq("setting_key", "MAIN")
    .maybeSingle();

  if (!error) {
    if (data) {
      return { settings: normalizeSettings(data), usingFallback: false };
    }
    return { settings: DEFAULT_HQ_COMPANY_SETTINGS, usingFallback: false };
  }

  if (isMissingHqTableError(error)) {
    try {
      const { data: blob } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .download(STORAGE_FALLBACK_PATH);
      if (blob) {
        const text = await blob.text();
        return {
          settings: normalizeSettings(JSON.parse(text)),
          usingFallback: true,
        };
      }
    } catch {
      // ignore missing fallback file
    }
    return { settings: DEFAULT_HQ_COMPANY_SETTINGS, usingFallback: true };
  }

  throw new Error(error.message);
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireHqCaller(req);
    if (caller instanceof NextResponse) return caller;

    const supabaseAdmin = getSupabaseAdmin();
    const [{ settings, usingFallback }, tenantRes] = await Promise.all([
      readSettingsWithFallback(supabaseAdmin),
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
      await readSettingsWithFallback(supabaseAdmin);

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
          ? { ...current.extra_settings, ...body.extra_settings }
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

    // 테이블 미생성 상태에서도 즉시 저장되도록 Storage JSON 백업도 함께 기록
    const jsonBytes = new TextEncoder().encode(JSON.stringify(next, null, 2));
    await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(STORAGE_FALLBACK_PATH, jsonBytes, {
        contentType: "application/json",
        upsert: true,
      })
      .catch(() => {});

    return NextResponse.json({
      success: true,
      data: { settings: next },
    });
  } catch (e: any) {
    console.error("HQ settings PATCH error:", e);
    return apiFail(String(e?.message || e), 500);
  }
}
