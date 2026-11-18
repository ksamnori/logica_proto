// src/lib/hq/leavesLedgerServer.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { readHqKvPayload, writeHqKvPayload } from "./hqKvStoreServer";
import type {
  HqAnnualLeavePlanItem,
  HqAttendanceLockItem,
  HqCompLeaveGrantItem,
  HqCustomLeaveGrantItem,
  HqHolidaySubstituteItem,
  HqLeaveAdjustmentItem,
  HqLeavePromotionCampaign,
  HqLeavePromotionTargetItem,
  HqRealtimeWorkLog,
  HqUploadedMonthlyUsageItem,
} from "./types";

export const LEAVES_LEDGER_SETTING_KEY = "LEAVES_LEDGER";
export const WORK_MGMT_SETTING_KEY = "WORK_MGMT_STATE";
export const REALTIME_LOGS_SETTING_KEY = "HQ_REALTIME_WORK_LOGS";
export const LEAVES_LEDGER_PATH = "hq_system_config/leaves_ledger.json";
export const WORK_MGMT_STORAGE_PATH = "hq_system_config/work_management.json";
export const REALTIME_LOGS_STORAGE_PATH =
  "hq_system_config/realtime_work_logs.json";

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
  const parsed = await readHqKvPayload<Partial<StoredLeavesLedger>>(
    supabaseAdmin,
    LEAVES_LEDGER_SETTING_KEY,
    LEAVES_LEDGER_PATH
  );
  if (!parsed) {
    return {
      adjustments: [],
      promotions: [],
      promotionTargets: [],
      plans: [],
      customGrants: [],
      uploadedMonthly: [],
    };
  }
  return {
    adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : [],
    promotions: Array.isArray(parsed.promotions) ? parsed.promotions : [],
    promotionTargets: Array.isArray(parsed.promotionTargets)
      ? parsed.promotionTargets
      : [],
    plans: Array.isArray(parsed.plans) ? parsed.plans : [],
    customGrants: Array.isArray(parsed.customGrants) ? parsed.customGrants : [],
    uploadedMonthly: Array.isArray(parsed.uploadedMonthly)
      ? parsed.uploadedMonthly
      : [],
  };
}

export async function writeLeavesLedgerServer(
  supabaseAdmin: SupabaseClient,
  ledger: StoredLeavesLedger
): Promise<void> {
  await writeHqKvPayload(
    supabaseAdmin,
    LEAVES_LEDGER_SETTING_KEY,
    ledger,
    LEAVES_LEDGER_PATH
  );
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
  const parsed = await readHqKvPayload<Partial<StoredWorkManagementState>>(
    supabaseAdmin,
    WORK_MGMT_SETTING_KEY,
    WORK_MGMT_STORAGE_PATH
  );
  if (!parsed) {
    return {
      compGrants: [],
      holidaySubstitutes: [],
      attendanceLocks: [],
    };
  }
  return {
    compGrants: Array.isArray(parsed.compGrants) ? parsed.compGrants : [],
    holidaySubstitutes: Array.isArray(parsed.holidaySubstitutes)
      ? parsed.holidaySubstitutes
      : [],
    attendanceLocks: Array.isArray(parsed.attendanceLocks)
      ? parsed.attendanceLocks
      : [],
  };
}

export async function writeWorkMgmtStateServer(
  supabaseAdmin: SupabaseClient,
  state: StoredWorkManagementState
): Promise<void> {
  await writeHqKvPayload(
    supabaseAdmin,
    WORK_MGMT_SETTING_KEY,
    state,
    WORK_MGMT_STORAGE_PATH
  );
}

export interface StoredRealtimeWorkLogs {
  logsByKey: Record<string, HqRealtimeWorkLog>;
}

export async function readRealtimeWorkLogsServer(
  supabaseAdmin: SupabaseClient
): Promise<Record<string, HqRealtimeWorkLog>> {
  const parsed = await readHqKvPayload<Partial<StoredRealtimeWorkLogs>>(
    supabaseAdmin,
    REALTIME_LOGS_SETTING_KEY,
    REALTIME_LOGS_STORAGE_PATH
  );
  if (!parsed || !parsed.logsByKey || typeof parsed.logsByKey !== "object") {
    return {};
  }
  return parsed.logsByKey;
}

export async function writeRealtimeWorkLogsServer(
  supabaseAdmin: SupabaseClient,
  logsByKey: Record<string, HqRealtimeWorkLog>
): Promise<void> {
  await writeHqKvPayload(
    supabaseAdmin,
    REALTIME_LOGS_SETTING_KEY,
    { logsByKey },
    REALTIME_LOGS_STORAGE_PATH
  );
}
