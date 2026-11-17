// src/lib/hq/hqKvStoreServer.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { SETTINGS_STORAGE_BUCKET } from "./companySettingsServer";
import { isMissingHqTableError } from "./serverAuth";

interface HqKvEnvelope<T> {
  __hq_kv: true;
  payload: T;
}

async function readLegacyStorageJsonNoCache<T>(
  supabaseAdmin: SupabaseClient,
  storagePath: string
): Promise<T | null> {
  try {
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(SETTINGS_STORAGE_BUCKET)
      .createSignedUrl(storagePath, 60);

    if (!signErr && signed?.signedUrl) {
      const sep = signed.signedUrl.includes("?") ? "&" : "?";
      const res = await fetch(`${signed.signedUrl}${sep}_t=${Date.now()}`, {
        cache: "no-store",
      });
      if (res.ok) {
        return (await res.json()) as T;
      }
      return null;
    }

    const { data: blob, error } = await supabaseAdmin.storage
      .from(SETTINGS_STORAGE_BUCKET)
      .download(storagePath);
    if (error || !blob) return null;
    return JSON.parse(await blob.text()) as T;
  } catch {
    return null;
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

    // 최초 1회: 기존 Storage JSON 데이터가 있으면 캐시 우회(Signed URL)로 읽어와 DB로 자동 이관
    if (legacyStoragePath) {
      const migrated = await readLegacyStorageJsonNoCache<T>(
        supabaseAdmin,
        legacyStoragePath
      );
      if (migrated !== null) {
        await supabaseAdmin
          .from("hq_company_settings")
          .upsert(
            {
              setting_key: settingKey,
              extra_settings: { __hq_kv: true, payload: migrated },
              updated_at: new Date().toISOString(),
            },
            { onConflict: "setting_key" }
          )
          .then(
            () => {},
            () => {}
          );
        return migrated;
      }
    }
    return null;
  }

  if (isMissingHqTableError(error) && legacyStoragePath) {
    return readLegacyStorageJsonNoCache<T>(supabaseAdmin, legacyStoragePath);
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
