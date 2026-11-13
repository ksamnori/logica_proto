// src/lib/hq/clientApi.ts
"use client";

import { supabase } from "@/lib/supabase";

export async function getHqAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}

export async function hqFetch<T = any>(
  url: string,
  options?: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: Record<string, unknown>;
  }
): Promise<T> {
  const headers = await getHqAuthHeaders();
  const res = await fetch(url, {
    method: options?.method || "GET",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const json = await res
    .json()
    .catch(() => ({ success: false, error: `서버 응답 파싱 실패 (${res.status})` }));

  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `요청 처리 중 오류가 발생했습니다 (${res.status})`);
  }
  return json as T;
}

export function resolveStoragePublicUrl(path: string | null | undefined): string | null {
  if (!path || path.trim() === "") return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const { data } = supabase.storage.from("system_images").getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadHqReceiptFile(
  file: File,
  prefix = "hq_receipts"
): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safePath = `${prefix}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("system_images")
    .upload(safePath, file, { upsert: true });
  if (error) throw new Error(`증빙 파일 업로드 실패: ${error.message}`);
  return safePath;
}
