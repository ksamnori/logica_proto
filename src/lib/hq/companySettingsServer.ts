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
      doc_folders: Array.isArray(incomingExtra.doc_folders)
        ? incomingExtra.doc_folders
        : def.extra_settings.doc_folders,
      approval_policies: (() => {
        const baseList = def.extra_settings.approval_policies || [];
        if (
          !Array.isArray(incomingExtra.approval_policies) ||
          incomingExtra.approval_policies.length === 0
        ) {
          return baseList;
        }
        const legacyRemoved = new Set(["mi-bank", "rd-withholding"]);
        const savedFiltered = incomingExtra.approval_policies.filter(
          (p: any) => p && !legacyRemoved.has(String(p.id))
        );
        const savedById = new Map(
          savedFiltered.map((p: any) => [String(p.id), p])
        );
        const merged = baseList.map((defPol) =>
          savedById.has(defPol.id) ? savedById.get(defPol.id) : defPol
        );
        const defaultIds = new Set(baseList.map((p) => p.id));
        const customAdded = savedFiltered.filter(
          (p: any) => !defaultIds.has(String(p.id))
        );
        return [...merged, ...customAdded];
      })(),
      approval_templates: Array.isArray(incomingExtra.approval_templates)
        ? incomingExtra.approval_templates
        : def.extra_settings.approval_templates,
      work_rules:
        Array.isArray(incomingExtra.work_rules) &&
        incomingExtra.work_rules.length > 0
          ? incomingExtra.work_rules
          : def.extra_settings.work_rules,
      work_condition_rules:
        Array.isArray(incomingExtra.work_condition_rules) &&
        incomingExtra.work_condition_rules.length > 0
          ? incomingExtra.work_condition_rules
          : def.extra_settings.work_condition_rules,
      work_form_policies:
        Array.isArray(incomingExtra.work_form_policies) &&
        incomingExtra.work_form_policies.length > 0
          ? incomingExtra.work_form_policies
          : def.extra_settings.work_form_policies,
      overtime_comp_settings: incomingExtra.overtime_comp_settings
        ? {
            ...def.extra_settings.overtime_comp_settings,
            ...incomingExtra.overtime_comp_settings,
            policies:
              Array.isArray(incomingExtra.overtime_comp_settings.policies) &&
              incomingExtra.overtime_comp_settings.policies.length > 0
                ? incomingExtra.overtime_comp_settings.policies
                : def.extra_settings.overtime_comp_settings?.policies || [],
          }
        : def.extra_settings.overtime_comp_settings,
      workplaces:
        Array.isArray(incomingExtra.workplaces) &&
        incomingExtra.workplaces.length > 0
          ? incomingExtra.workplaces
          : def.extra_settings.workplaces,
      workplace_ips: Array.isArray(incomingExtra.workplace_ips)
        ? incomingExtra.workplace_ips
        : def.extra_settings.workplace_ips,
      annual_leave_settings: incomingExtra.annual_leave_settings
        ? {
            ...def.extra_settings.annual_leave_settings,
            ...incomingExtra.annual_leave_settings,
            policies:
              Array.isArray(incomingExtra.annual_leave_settings.policies) &&
              incomingExtra.annual_leave_settings.policies.length > 0
                ? incomingExtra.annual_leave_settings.policies
                : def.extra_settings.annual_leave_settings?.policies || [],
          }
        : def.extra_settings.annual_leave_settings,
      custom_leaves:
        Array.isArray(incomingExtra.custom_leaves) &&
        incomingExtra.custom_leaves.length > 0
          ? (() => {
              const upgraded = incomingExtra.custom_leaves.map((cl: any) => {
                if (!cl || typeof cl !== "object") return cl;
                let next = { ...cl };
                if (
                  (next.id === "cl-paternity" ||
                    next.id === "cl-spouse-miscarriage" ||
                    next.id === "cl-military") &&
                  next.target_gender === "모두"
                ) {
                  next.target_gender = "남성";
                }
                if (
                  next.id === "cl-spouse-miscarriage" &&
                  next.grant_amount === 3
                ) {
                  next.grant_amount = 5;
                }
                if (
                  next.id === "cl-subfertility" &&
                  next.grant_method === "반복 부여"
                ) {
                  next.grant_method = "관리자가 직접 부여";
                }
                if (
                  (next.id === "cl-miscarriage" ||
                    next.id === "cl-miscarriage-multi") &&
                  next.grant_method === "신청 시 부여"
                ) {
                  next.grant_method = "관리자가 직접 부여";
                }
                if (
                  next.id === "cl-sick" &&
                  next.grant_method === "신청 시 부여"
                ) {
                  next.grant_method = "연차 소진 시 부여";
                  if (next.grant_amount === 30) next.grant_amount = 60;
                }
                return next;
              });
              // 필수 시드 항목 중 누락된 항목이 있다면 기본값 보충
              const existingIds = new Set(
                upgraded.map((c: any) => String(c?.id || ""))
              );
              const missingDefaults = (
                def.extra_settings.custom_leaves || []
              ).filter((d) => d.is_mandatory && !existingIds.has(d.id));
              return [...upgraded, ...missingDefaults];
            })()
          : def.extra_settings.custom_leaves,
      payroll_settings: incomingExtra.payroll_settings
        ? {
            ...def.extra_settings.payroll_settings,
            ...incomingExtra.payroll_settings,
            pay_items:
              Array.isArray(incomingExtra.payroll_settings.pay_items) &&
              incomingExtra.payroll_settings.pay_items.length > 0
                ? incomingExtra.payroll_settings.pay_items
                : def.extra_settings.payroll_settings?.pay_items || [],
            deduction_items: Array.isArray(
              incomingExtra.payroll_settings.deduction_items
            )
              ? incomingExtra.payroll_settings.deduction_items
              : [],
            certificates: Array.isArray(
              incomingExtra.payroll_settings.certificates
            )
              ? incomingExtra.payroll_settings.certificates
              : [],
            tax_workplaces: Array.isArray(
              incomingExtra.payroll_settings.tax_workplaces
            )
              ? incomingExtra.payroll_settings.tax_workplaces
              : [],
          }
        : def.extra_settings.payroll_settings,
      retiree_doc_settings:
        Array.isArray(incomingExtra.retiree_doc_settings) &&
        incomingExtra.retiree_doc_settings.length > 0
          ? incomingExtra.retiree_doc_settings
          : def.extra_settings.retiree_doc_settings,
      security_settings: incomingExtra.security_settings
        ? {
            ...def.extra_settings.security_settings,
            ...incomingExtra.security_settings,
            two_factor_exempt_ips: Array.isArray(
              incomingExtra.security_settings.two_factor_exempt_ips
            )
              ? incomingExtra.security_settings.two_factor_exempt_ips
              : [],
            otp_reset_logs: Array.isArray(
              incomingExtra.security_settings.otp_reset_logs
            )
              ? incomingExtra.security_settings.otp_reset_logs
              : [],
            allowed_ips: Array.isArray(
              incomingExtra.security_settings.allowed_ips
            )
              ? incomingExtra.security_settings.allowed_ips
              : [],
            temp_auth_codes: Array.isArray(
              incomingExtra.security_settings.temp_auth_codes
            )
              ? incomingExtra.security_settings.temp_auth_codes
              : [],
          }
        : def.extra_settings.security_settings,
      permission_settings: incomingExtra.permission_settings
        ? {
            ...def.extra_settings.permission_settings,
            ...incomingExtra.permission_settings,
            super_admin_names:
              Array.isArray(
                incomingExtra.permission_settings.super_admin_names
              ) &&
              incomingExtra.permission_settings.super_admin_names.length > 0
                ? incomingExtra.permission_settings.super_admin_names
                : def.extra_settings.permission_settings?.super_admin_names ||
                  [],
            groups: Array.isArray(incomingExtra.permission_settings.groups)
              ? incomingExtra.permission_settings.groups
              : def.extra_settings.permission_settings?.groups || [],
          }
        : def.extra_settings.permission_settings,
      integration_settings: incomingExtra.integration_settings
        ? {
            slack: {
              ...def.extra_settings.integration_settings!.slack,
              ...(incomingExtra.integration_settings.slack || {}),
            },
            google_calendar: {
              ...def.extra_settings.integration_settings!.google_calendar,
              ...(incomingExtra.integration_settings.google_calendar || {}),
            },
            secom: {
              ...def.extra_settings.integration_settings!.secom,
              ...(incomingExtra.integration_settings.secom || {}),
              member_mappings: Array.isArray(
                incomingExtra.integration_settings.secom?.member_mappings
              )
                ? incomingExtra.integration_settings.secom.member_mappings
                : [],
            },
            adt_caps: {
              ...def.extra_settings.integration_settings!.adt_caps,
              ...(incomingExtra.integration_settings.adt_caps || {}),
              member_mappings: Array.isArray(
                incomingExtra.integration_settings.adt_caps?.member_mappings
              )
                ? incomingExtra.integration_settings.adt_caps.member_mappings
                : [],
            },
            kt_telecop: {
              ...def.extra_settings.integration_settings!.kt_telecop,
              ...(incomingExtra.integration_settings.kt_telecop || {}),
              member_mappings: Array.isArray(
                incomingExtra.integration_settings.kt_telecop?.member_mappings
              )
                ? incomingExtra.integration_settings.kt_telecop.member_mappings
                : [],
            },
          }
        : def.extra_settings.integration_settings,
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
