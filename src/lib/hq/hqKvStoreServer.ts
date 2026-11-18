// src/lib/hq/hqKvStoreServer.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { SETTINGS_STORAGE_BUCKET } from "./companySettingsServer";
import { isMissingHqTableError } from "./serverAuth";

interface HqKvEnvelope<T> {
  __hq_kv: true;
  payload: T | null;
}

type LegacyStorageReadResult<T> =
  | { status: "found"; payload: T }
  | { status: "not_found"; payload: null }
  | { status: "error"; payload: null };

const inFlightMigrations = new Map<string, Promise<unknown>>();

function isStorageNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as {
    message?: unknown;
    error?: unknown;
    statusCode?: unknown;
    status?: unknown;
  };
  const msg = String(anyErr.message || anyErr.error || "").toLowerCase();
  const code = String(anyErr.statusCode ?? anyErr.status ?? "");
  return (
    code === "404" ||
    msg.includes("object not found") ||
    msg.includes("nosuchkey") ||
    msg.includes("not_found") ||
    msg.includes("the resource was not found")
  );
}

function splitStoragePath(storagePath: string): {
  folder: string;
  fileName: string;
} {
  const clean = storagePath.replace(/^\/+/, "");
  const idx = clean.lastIndexOf("/");
  if (idx === -1) {
    return { folder: "", fileName: clean };
  }
  return {
    folder: clean.slice(0, idx),
    fileName: clean.slice(idx + 1),
  };
}

async function readLegacyStorageJsonNoCache<T>(
  supabaseAdmin: SupabaseClient,
  storagePath: string
): Promise<LegacyStorageReadResult<T>> {
  try {
    // 1. list()로 파일 존재 여부를 먼저 확인해 없는 파일에 대한 400(NoSuchKey) 경고 로그 원천 차단
    const { folder, fileName } = splitStoragePath(storagePath);
    if (fileName) {
      const { data: items, error: listErr } = await supabaseAdmin.storage
        .from(SETTINGS_STORAGE_BUCKET)
        .list(folder, { search: fileName, limit: 20 });

      if (!listErr && Array.isArray(items)) {
        const exists = items.some((item) => item.name === fileName);
        if (!exists) {
          return { status: "not_found", payload: null };
        }
      }
    }

    // 2. 실제 파일이 존재할 때만 Signed URL을 발급해 CDN 캐시를 우회하여 조회 (중복 download 폴백 제거)
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(SETTINGS_STORAGE_BUCKET)
      .createSignedUrl(storagePath, 60);

    if (signErr) {
      if (isStorageNotFoundError(signErr)) {
        return { status: "not_found", payload: null };
      }
      return { status: "error", payload: null };
    }

    if (!signed?.signedUrl) {
      return { status: "not_found", payload: null };
    }

    const sep = signed.signedUrl.includes("?") ? "&" : "?";
    const res = await fetch(`${signed.signedUrl}${sep}_t=${Date.now()}`, {
      cache: "no-store",
    });

    if (res.status === 404 || res.status === 400) {
      return { status: "not_found", payload: null };
    }
    if (!res.ok) {
      return { status: "error", payload: null };
    }

    const parsed = (await res.json()) as T;
    return { status: "found", payload: parsed };
  } catch {
    return { status: "error", payload: null };
  }
}

/**
 * PostgreSQL(hq_company_settings)을 1차 원장 저장소로 사용하여
 * Supabase Storage 공개 버킷 CDN 캐시로 인한 데이터 표류(Stale Read / Lost Update)를 원천 차단합니다.
 */
export async function readHqKvPayload<T>(
  supabaseAdmin: SupabaseClient,
  settingKey: string,
  legacyStoragePath?: string
): Promise<T | null> {
  const { data, error } = await supabaseAdmin
    .from("hq_company_settings")
    .select("extra_settings")
    .eq("setting_key", settingKey)
    .maybeSingle();

  if (!error) {
    const raw = data?.extra_settings as HqKvEnvelope<T> | undefined;
    if (raw && raw.__hq_kv === true && raw.payload !== undefined) {
      return raw.payload;
    }

    if (!legacyStoragePath) {
      return null;
    }

    // 동일 인스턴스 내 동시 폴링 요청이 겹칠 때 중복 Storage 이관 시도를 1회로 병합
    const existingJob = inFlightMigrations.get(settingKey) as
      | Promise<T | null>
      | undefined;
    if (existingJob) {
      return existingJob;
    }

    const migrationJob = (async (): Promise<T | null> => {
      const result = await readLegacyStorageJsonNoCache<T>(
        supabaseAdmin,
        legacyStoragePath
      );

      // 파일이 존재하거나(found) 없음이 확인된 경우(not_found) 모두 DB에 마커를 기록해 반복 조회 차단
      // 일시적 네트워크 오류(error)일 때는 DB에 null을 기록하지 않고 다음 요청에서 재시도 허용
      if (result.status === "found" || result.status === "not_found") {
        const shouldIgnoreDuplicates =
          result.status === "not_found" && data === null;

        await supabaseAdmin
          .from("hq_company_settings")
          .upsert(
            {
              setting_key: settingKey,
              extra_settings: { __hq_kv: true, payload: result.payload },
              updated_at: new Date().toISOString(),
            },
            shouldIgnoreDuplicates
              ? { onConflict: "setting_key", ignoreDuplicates: true }
              : { onConflict: "setting_key" }
          )
          .then(
            () => {},
            () => {}
          );
      }

      return result.payload;
    })();

    inFlightMigrations.set(settingKey, migrationJob);
    try {
      return await migrationJob;
    } finally {
      inFlightMigrations.delete(settingKey);
    }
  }

  if (isMissingHqTableError(error) && legacyStoragePath) {
    const fallback = await readLegacyStorageJsonNoCache<T>(
      supabaseAdmin,
      legacyStoragePath
    );
    return fallback.payload;
  }

  return null;
}

export async function writeHqKvPayload<T>(
  supabaseAdmin: SupabaseClient,
  settingKey: string,
  payload: T,
  legacyStoragePath?: string
): Promise<void> {
  const { error } = await supabaseAdmin.from("hq_company_settings").upsert(
    {
      setting_key: settingKey,
      extra_settings: { __hq_kv: true, payload },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "setting_key" }
  );

  if (!error) {
    return;
  }

  if (!isMissingHqTableError(error)) {
    throw new Error(`원장 저장 실패 (${settingKey}): ${error.message}`);
  }

  if (legacyStoragePath) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
    const { error: upErr } = await supabaseAdmin.storage
      .from(SETTINGS_STORAGE_BUCKET)
      .upload(legacyStoragePath, bytes, {
        contentType: "application/json",
        cacheControl: "0",
        upsert: true,
      });
    if (upErr) {
      throw new Error(`스토리지 원장 저장 실패: ${upErr.message}`);
    }
  }
}