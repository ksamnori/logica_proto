// src/lib/hq/companySettingsServer.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_HQ_COMPANY_SETTINGS,
  formatEmpNoPreview,
} from "./defaultCompanySettings";
import { isMissingHqTableError } from "./serverAuth";
import type { HqCompanySettings } from "./types";

export { formatEmpNoPreview };

export const SETTINGS_STORAGE_BUCKET = "system_images";
export const SETTINGS_STORAGE_FALLBACK_PATH =
  "hq_system_config/company_settings.json";

export function normalizeCompanySettings(raw: any): HqCompanySettings {
  const def = DEFAULT_HQ_COMPANY_SETTINGS;
  if (!raw || typeof raw !== "object") return def;

  const rawHolidays = raw.holidays_json || raw.holidays_by_year || {};
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

  const incomingExtra =
    raw.extra_settings && typeof raw.extra_settings === "object"
      ? raw.extra_settings
      : {};

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
      ...incomingExtra,
      info_approval_policy: {
        ...def.extra_settings.info_approval_policy,
        ...(incomingExtra.info_approval_policy || {}),
      },
    },
    updated_by: raw.updated_by || null,
    updated_at: raw.updated_at || null,
  };
}

export async function readCompanySettingsServer(
  supabaseAdmin: SupabaseClient
): Promise<{ settings: HqCompanySettings; usingFallback: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("hq_company_settings")
    .select("*")
    .eq("setting_key", "MAIN")
    .maybeSingle();

  if (!error) {
    if (data) {
      return { settings: normalizeCompanySettings(data), usingFallback: false };
    }
    return { settings: DEFAULT_HQ_COMPANY_SETTINGS, usingFallback: false };
  }

  if (isMissingHqTableError(error)) {
    try {
      const { data: blob } = await supabaseAdmin.storage
        .from(SETTINGS_STORAGE_BUCKET)
        .download(SETTINGS_STORAGE_FALLBACK_PATH);
      if (blob) {
        const text = await blob.text();
        return {
          settings: normalizeCompanySettings(JSON.parse(text)),
          usingFallback: true,
        };
      }
    } catch {
      // ignore missing fallback file
    }
    return { settings: DEFAULT_HQ_COMPANY_SETTINGS, usingFallback: true };
  }

  return { settings: DEFAULT_HQ_COMPANY_SETTINGS, usingFallback: true };
}

export async function generateEmployeeNoByPolicy(
  supabaseAdmin: SupabaseClient,
  settings: HqCompanySettings,
  employmentType: string,
  hireDateIso: string,
  fallbackUid: string
): Promise<string> {
  const policies = settings.extra_settings?.emp_no_policies || [];
  const matched = policies.find(
    (p) =>
      p.target_employment === "전체" || p.target_employment === employmentType
  );

  if (!matched) {
    const year = String(hireDateIso).slice(0, 4) || String(new Date().getFullYear());
    return `HQ-${year}-${fallbackUid.slice(0, 4).toUpperCase()}`;
  }

  const dt = hireDateIso.replace(/[^0-9]/g, "");
  const yyyy = dt.slice(0, 4) || String(new Date().getFullYear());
  const mm = dt.slice(4, 6) || "01";
  let dateStr = "";
  if (matched.date_part === "YYYYMM") dateStr = `${yyyy}${mm}`;
  else if (matched.date_part === "YYYY") dateStr = yyyy;
  else if (matched.date_part === "YY") dateStr = yyyy.slice(2, 4);

  const basePrefix = `${matched.prefix || ""}${dateStr}`;
  const digits = Math.min(6, Math.max(2, Number(matched.seq_digits || 2)));

  const { data: rows } = await supabaseAdmin
    .from("hq_member_profile")
    .select("employee_no");

  let maxSeq = Math.max(0, Number(matched.start_seq || 1) - 1);
  (rows || []).forEach((r: any) => {
    const emp = String(r.employee_no || "");
    if (emp.startsWith(basePrefix)) {
      const tail = emp.slice(basePrefix.length);
      if (/^\d+$/.test(tail)) {
        maxSeq = Math.max(maxSeq, Number(tail));
      }
    }
  });

  const nextSeq = maxSeq + 1;
  return `${basePrefix}${String(nextSeq).padStart(digits, "0")}`;
}
