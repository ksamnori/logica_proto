// src/lib/hq/auditLogServer.ts
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readHqKvPayload, writeHqKvPayload } from "./hqKvStoreServer";
import type {
  HqAuditActivityType,
  HqAuditEventType,
  HqAuditLogItem,
} from "./types";

const AUDIT_LOGS_STORAGE_PATH = "hq_system_config/audit_logs.json";
const LOGIN_ATTEMPTS_STORAGE_PATH = "hq_system_config/login_attempts.json";
const MAX_AUDIT_LOGS = 500;

export interface HqLoginAttemptRecord {
  identifier: string;
  fail_count: number;
  locked_until: string | null;
  last_failed_at: string;
  last_ip?: string;
}

export function extractClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.replace(/^::ffff:/i, "");
  }
  const realIp =
    req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip");
  if (realIp) return realIp.trim().replace(/^::ffff:/i, "");
  return "127.0.0.1";
}

export async function readHqAuditLogs(
  supabaseAdmin: SupabaseClient
): Promise<HqAuditLogItem[]> {
  try {
    const parsed = await readHqKvPayload<HqAuditLogItem[]>(
      supabaseAdmin,
      "AUDIT_LOGS",
      AUDIT_LOGS_STORAGE_PATH
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendHqAuditLog(
  supabaseAdmin: SupabaseClient,
  req: NextRequest,
  input: {
    activity_type: HqAuditActivityType;
    user_id?: string;
    user_name: string;
    user_email?: string;
    department?: string;
    event_type: HqAuditEventType;
    info_type?: string;
    description: string;
    delegated?: boolean;
  }
): Promise<void> {
  try {
    const prev = await readHqAuditLogs(supabaseAdmin);
    const nowIso = new Date().toISOString();
    const item: HqAuditLogItem = {
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      activity_type: input.activity_type,
      user_id: input.user_id,
      user_name: input.user_name || "본부 구성원",
      user_email: input.user_email || "-",
      department: input.department || "",
      event_type: input.event_type,
      info_type: input.info_type || "-",
      description: input.description,
      delegated: Boolean(input.delegated),
      ip_address: extractClientIp(req),
      created_at: nowIso,
    };
    const next = [item, ...prev].slice(0, MAX_AUDIT_LOGS);
    await writeHqKvPayload(
      supabaseAdmin,
      "AUDIT_LOGS",
      next,
      AUDIT_LOGS_STORAGE_PATH
    );
  } catch {
    // 감사 로그 적재 실패가 본 비즈니스 로직을 막지 않도록 방어
  }
}

export async function readLoginAttemptRecords(
  supabaseAdmin: SupabaseClient
): Promise<Record<string, HqLoginAttemptRecord>> {
  try {
    const parsed = await readHqKvPayload<Record<string, HqLoginAttemptRecord>>(
      supabaseAdmin,
      "LOGIN_ATTEMPTS",
      LOGIN_ATTEMPTS_STORAGE_PATH
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export async function writeLoginAttemptRecords(
  supabaseAdmin: SupabaseClient,
  records: Record<string, HqLoginAttemptRecord>
): Promise<void> {
  try {
    await writeHqKvPayload(
      supabaseAdmin,
      "LOGIN_ATTEMPTS",
      records,
      LOGIN_ATTEMPTS_STORAGE_PATH
    );
  } catch {
    // ignore storage errors
  }
}
