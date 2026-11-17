// src/lib/hq/workflowStorageServer.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readCompanySettingsServer,
  SETTINGS_STORAGE_BUCKET,
  SETTINGS_STORAGE_FALLBACK_PATH,
} from "./companySettingsServer";
import {
  DEFAULT_WORKFLOW_CATEGORIES,
  DEFAULT_WORKFLOW_FORMS,
  mergeFormsWithPolicies,
} from "./defaultWorkflowForms";
import { readHqKvPayload, writeHqKvPayload } from "./hqKvStoreServer";
import { isMissingHqTableError } from "./serverAuth";
import type {
  HqApprovalPolicyItem,
  HqCompanySettings,
  HqWorkflowDocMeta,
  HqWorkflowFormDef,
  HqWorkflowSavedView,
} from "./types";

export const WORKFLOW_FORMS_STORAGE_PATH = "hq_system_config/workflow_forms.json";
export const WORKFLOW_META_STORAGE_PATH = "hq_system_config/workflow_meta.json";

export interface StoredWorkflowFormsPayload {
  categories: string[];
  forms: HqWorkflowFormDef[];
  deletedFormIds?: string[];
}

export interface StoredWorkflowMetaPayload {
  docMetaById: Record<string, HqWorkflowDocMeta>;
  starredByUser: Record<string, string[]>;
  savedViewsByUser: Record<string, HqWorkflowSavedView[]>;
}

export async function readWorkflowFormsPayload(
  supabaseAdmin: SupabaseClient
): Promise<StoredWorkflowFormsPayload> {
  const { settings } = await readCompanySettingsServer(supabaseAdmin);
  const workflowPolicies = (settings.extra_settings?.approval_policies || []).filter(
    (p) => p.category === "workflow"
  );

  try {
    const parsed = await readHqKvPayload<Partial<StoredWorkflowFormsPayload>>(
      supabaseAdmin,
      "WORKFLOW_FORMS",
      WORKFLOW_FORMS_STORAGE_PATH
    );
    if (parsed) {
      const deletedSet = new Set<string>(
        Array.isArray(parsed.deletedFormIds) ? parsed.deletedFormIds : []
      );
      const savedForms: HqWorkflowFormDef[] = Array.isArray(parsed.forms)
        ? parsed.forms
        : DEFAULT_WORKFLOW_FORMS;
      const merged = mergeFormsWithPolicies(
        savedForms,
        workflowPolicies.filter((p) => !deletedSet.has(p.id))
      ).filter((f) => !deletedSet.has(f.id));

      return {
        categories:
          Array.isArray(parsed.categories) && parsed.categories.length > 0
            ? parsed.categories
            : DEFAULT_WORKFLOW_CATEGORIES,
        forms: merged,
        deletedFormIds: Array.from(deletedSet),
      };
    }
  } catch {
    // fallback to seed + company policies
  }

  return {
    categories: DEFAULT_WORKFLOW_CATEGORIES,
    forms: mergeFormsWithPolicies(DEFAULT_WORKFLOW_FORMS, workflowPolicies),
    deletedFormIds: [],
  };
}

export async function writeWorkflowFormsPayload(
  supabaseAdmin: SupabaseClient,
  payload: StoredWorkflowFormsPayload
): Promise<void> {
  await writeHqKvPayload(
    supabaseAdmin,
    "WORKFLOW_FORMS",
    payload,
    WORKFLOW_FORMS_STORAGE_PATH
  );
}

export async function syncWorkflowFormsToCompanySettings(
  supabaseAdmin: SupabaseClient,
  forms: HqWorkflowFormDef[],
  actorLabel: string
): Promise<HqCompanySettings> {
  const { settings: current, usingFallback } =
    await readCompanySettingsServer(supabaseAdmin);
  const nowIso = new Date().toISOString();

  const nonWorkflowPolicies = (
    current.extra_settings?.approval_policies || []
  ).filter((p) => p.category !== "workflow");

  const syncedWorkflowPolicies: HqApprovalPolicyItem[] = forms.map((f) => ({
    id: f.id,
    category: "workflow",
    title: f.title,
    description: f.description || undefined,
    icon: f.icon || "📋",
    allow_edit: f.allow_edit,
    per_requester: f.per_requester,
    cc_list: f.cc_list || [],
    steps: f.steps || [],
    requester_rules: f.requester_rules,
    mapped_doc_type: f.mapped_doc_type || "GENERAL",
  }));

  const nextSettings: HqCompanySettings = {
    ...current,
    extra_settings: {
      ...current.extra_settings,
      approval_policies: [...syncedWorkflowPolicies, ...nonWorkflowPolicies],
    },
    updated_by: actorLabel,
    updated_at: nowIso,
  };

  if (!usingFallback) {
    const { error: upsertErr } = await supabaseAdmin
      .from("hq_company_settings")
      .upsert(
        {
          setting_key: "MAIN",
          company_name: nextSettings.company_name,
          company_code: nextSettings.company_code,
          ceo_names: nextSettings.ceo_names,
          phone: nextSettings.phone,
          founded_date: nextSettings.founded_date || null,
          address: nextSettings.address,
          business_reg_no: nextSettings.business_reg_no || null,
          corp_reg_no: nextSettings.corp_reg_no || null,
          cover_image_url: nextSettings.cover_image_url,
          logo_image_url: nextSettings.logo_image_url,
          seals_json: nextSettings.seals,
          holidays_json: nextSettings.holidays_by_year,
          holiday_groups_json: nextSettings.holiday_groups,
          affiliates_json: nextSettings.affiliates,
          extra_settings: nextSettings.extra_settings,
          updated_by: actorLabel,
          updated_at: nowIso,
        },
        { onConflict: "setting_key" }
      );
    if (upsertErr && !isMissingHqTableError(upsertErr)) {
      throw new Error(upsertErr.message);
    }
  }

  const jsonBytes = new TextEncoder().encode(
    JSON.stringify(nextSettings, null, 2)
  );
  await supabaseAdmin.storage
    .from(SETTINGS_STORAGE_BUCKET)
    .upload(SETTINGS_STORAGE_FALLBACK_PATH, jsonBytes, {
      contentType: "application/json",
      upsert: true,
    })
    .catch(() => {});

  return nextSettings;
}

export async function readWorkflowMetaPayload(
  supabaseAdmin: SupabaseClient
): Promise<StoredWorkflowMetaPayload> {
  try {
    const parsed = await readHqKvPayload<Partial<StoredWorkflowMetaPayload>>(
      supabaseAdmin,
      "WORKFLOW_META",
      WORKFLOW_META_STORAGE_PATH
    );
    if (parsed) {
      return {
        docMetaById:
          parsed.docMetaById && typeof parsed.docMetaById === "object"
            ? parsed.docMetaById
            : {},
        starredByUser:
          parsed.starredByUser && typeof parsed.starredByUser === "object"
            ? parsed.starredByUser
            : {},
        savedViewsByUser:
          parsed.savedViewsByUser && typeof parsed.savedViewsByUser === "object"
            ? parsed.savedViewsByUser
            : {},
      };
    }
  } catch {
    // ignore missing
  }
  return {
    docMetaById: {},
    starredByUser: {},
    savedViewsByUser: {},
  };
}

export async function writeWorkflowMetaPayload(
  supabaseAdmin: SupabaseClient,
  payload: StoredWorkflowMetaPayload
): Promise<void> {
  await writeHqKvPayload(
    supabaseAdmin,
    "WORKFLOW_META",
    payload,
    WORKFLOW_META_STORAGE_PATH
  );
}
