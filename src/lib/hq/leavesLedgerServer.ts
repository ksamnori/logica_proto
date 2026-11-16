// src/lib/hq/leavesLedgerServer.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { SETTINGS_STORAGE_BUCKET } from "./companySettingsServer";
import type {
  HqAnnualLeavePlanItem,
  HqAttendanceLockItem,
  HqCompLeaveGrantItem,
  HqCustomLeaveGrantItem,
  HqHolidaySubstituteItem,
  HqLeaveAdjustmentItem,
  HqLeavePromotionCampaign,
  HqLeavePromotionTargetItem,
  HqUploadedMonthlyUsageItem,
} from "./types";

export const LEAVES_LEDGER_PATH = "hq_system_config/leaves_ledger.json";
export const WORK_MGMT_STORAGE_PATH = "hq_system_config/work_management.json";

export interface StoredLeavesLedger {
  adjustments: HqLeaveAdjustmentItem[];
  promotions: HqLeavePromotionCampaign[];
  promotionTargets: HqLeavePromotionTargetItem[];
  plans: HqAnnualLeavePlanItem[];
  customGrants: HqCustomLeaveGrantItem[];
  uploadedMonthly: HqUploadedMonthlyUsageItem[];
}

export const EMPTY_LEAVES_LEDGER: StoredLeavesLedger = {
  adjustments: [],
  promotions: [],
  promotionTargets: [],
  plans: [],
  customGrants: [],
  uploadedMonthly: [],
};

export async function readLeavesLedgerServer(
  supabaseAdmin: SupabaseClient
): Promise<StoredLeavesLedger> {
  try {
    const { data: blob, error } = await supabaseAdmin.storage
      .from(SETTINGS_STORAGE_BUCKET)
      .download(LEAVES_LEDGER_PATH);
    if (error || !blob) return { ...EMPTY_LEAVES_LEDGER };
    const parsed = JSON.parse(await blob.text());
    return {
      adjustments: Array.isArray(parsed?.adjustments) ? parsed.adjustments : [],
      promotions: Array.isArray(parsed?.promotions) ? parsed.promotions : [],
      promotionTargets: Array.isArray(parsed?.promotionTargets)
        ? parsed.promotionTargets
        : [],
      plans: Array.isArray(parsed?.plans) ? parsed.plans : [],
      customGrants: Array.isArray(parsed?.customGrants)
        ? parsed.customGrants
        : [],
      uploadedMonthly: Array.isArray(parsed?.uploadedMonthly)
        ? parsed.uploadedMonthly
        : [],
    };
  } catch {
    return { ...EMPTY_LEAVES_LEDGER };
  }
}

export async function writeLeavesLedgerServer(
  supabaseAdmin: SupabaseClient,
  ledger: StoredLeavesLedger
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(ledger, null, 2));
  await supabaseAdmin.storage
    .from(SETTINGS_STORAGE_BUCKET)
    .upload(LEAVES_LEDGER_PATH, bytes, {
      contentType: "application/json",
      upsert: true,
    });
}

export interface StoredWorkManagementState {
  compGrants: HqCompLeaveGrantItem[];
  holidaySubstitutes: HqHolidaySubstituteItem[];
  attendanceLocks: HqAttendanceLockItem[];
}

export const EMPTY_WORK_MGMT_STATE: StoredWorkManagementState = {
  compGrants: [],
  holidaySubstitutes: [],
  attendanceLocks: [],
};

export async function readWorkMgmtStateServer(
  supabaseAdmin: SupabaseClient
): Promise<StoredWorkManagementState> {
  try {
    const { data: blob, error } = await supabaseAdmin.storage
      .from(SETTINGS_STORAGE_BUCKET)
      .download(WORK_MGMT_STORAGE_PATH);
    if (error || !blob) return { ...EMPTY_WORK_MGMT_STATE };
    const parsed = JSON.parse(await blob.text());
    return {
      compGrants: Array.isArray(parsed?.compGrants) ? parsed.compGrants : [],
      holidaySubstitutes: Array.isArray(parsed?.holidaySubstitutes)
        ? parsed.holidaySubstitutes
        : [],
      attendanceLocks: Array.isArray(parsed?.attendanceLocks)
        ? parsed.attendanceLocks
        : [],
    };
  } catch {
    return { ...EMPTY_WORK_MGMT_STATE };
  }
}

export async function writeWorkMgmtStateServer(
  supabaseAdmin: SupabaseClient,
  state: StoredWorkManagementState
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(state, null, 2));
  await supabaseAdmin.storage
    .from(SETTINGS_STORAGE_BUCKET)
    .upload(WORK_MGMT_STORAGE_PATH, bytes, {
      contentType: "application/json",
      upsert: true,
    });
}
