// src/lib/thinkingCategory.ts
import { supabase } from "./supabase";
import {
  THINKING_CATEGORIES,
  type ThinkingCategoryItem,
} from "@/app/(dashboard)/pdf-parser/thinkingcategories";

export { THINKING_CATEGORIES };
export type { ThinkingCategoryItem };

const SESSION_CACHE_KEY = "logica_thinking_category_cache_v1";
const SESSION_CACHE_TTL_MS = 30 * 60 * 1000; // 30분
const MEMORY_CACHE_TTL_MS = 10 * 60 * 1000; // 10분

let memoryCache: { ts: number; items: ThinkingCategoryItem[] } | null = null;

function normalizeThinkingRow(raw: any): ThinkingCategoryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const category_id = String(raw.category_id || "").trim();
  const depth1 = String(raw.depth1 || "").trim();
  const depth2 = String(raw.depth2 || "").trim();
  const depth3 = String(raw.depth3 || "").trim();
  if (!category_id || !depth1) return null;

  const full_path =
    String(raw.full_path || "").trim() ||
    [depth1, depth2, depth3].filter(Boolean).join(" > ");

  return {
    category_id,
    depth1,
    depth2,
    depth3,
    full_path,
    ...(typeof raw.sort_order === "number" ? { sort_order: raw.sort_order } : {}),
    ...(typeof raw.is_active === "boolean" ? { is_active: raw.is_active } : {}),
  };
}

export function clearThinkingCategoriesCache(): void {
  memoryCache = null;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(SESSION_CACHE_KEY);
    } catch {
      // sessionStorage 비활성화 환경 무시
    }
  }
}

/**
 * Supabase `public.thinking_category` 테이블에서 사고력 분류 목록을 조회합니다.
 * - 약 100행(~25KB) 규모이므로 단일 쿼리로 전체 조회합니다.
 * - 테이블 미생성 상태이거나 네트워크 오류 발생 시 로컬 폴백(`THINKING_CATEGORIES`)을 반환합니다.
 *   (폴백 데이터는 캐싱하지 않아 SQL 실행 직후 다음 조회부터 즉시 DB 데이터가 반영됩니다.)
 */
export async function fetchThinkingCategories(options?: {
  bypassCache?: boolean;
}): Promise<ThinkingCategoryItem[]> {
  const bypass = Boolean(options?.bypassCache);
  const now = Date.now();

  if (!bypass && memoryCache && now - memoryCache.ts < MEMORY_CACHE_TTL_MS) {
    return memoryCache.items;
  }

  if (!bypass && typeof window !== "undefined") {
    try {
      const cachedRaw = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (cachedRaw) {
        const parsed = JSON.parse(cachedRaw);
        if (
          parsed &&
          typeof parsed.ts === "number" &&
          now - parsed.ts < SESSION_CACHE_TTL_MS &&
          Array.isArray(parsed.items) &&
          parsed.items.length > 0
        ) {
          memoryCache = { ts: parsed.ts, items: parsed.items };
          return parsed.items;
        }
      }
    } catch {
      // 파싱 실패 시 DB 재조회
    }
  }

  try {
    let { data, error } = await supabase
      .from("thinking_category")
      .select("category_id, depth1, depth2, depth3, full_path, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("category_id", { ascending: true });

    // sort_order 또는 is_active 컬럼이 없는 커스텀 스키마일 경우 기본 컬럼만으로 재시도
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      const retry = await supabase
        .from("thinking_category")
        .select("category_id, depth1, depth2, depth3, full_path")
        .order("category_id", { ascending: true });
      data = retry.data as any;
      error = retry.error;
    }

    if (error) {
      // 테이블 미생성(42P01 / PGRST205) 등은 조용히 로컬 폴백 반환
      const code = String(error.code || "");
      if (code !== "42P01" && code !== "PGRST205") {
        console.warn("[thinking_category] DB 조회 실패, 기본 분류표로 폴백합니다:", error.message);
      }
      return THINKING_CATEGORIES;
    }

    const normalized = (data || [])
      .map(normalizeThinkingRow)
      .filter((item): item is ThinkingCategoryItem => item !== null);

    if (normalized.length === 0) {
      return THINKING_CATEGORIES;
    }

    const savedAt = Date.now();
    memoryCache = { ts: savedAt, items: normalized };
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(
          SESSION_CACHE_KEY,
          JSON.stringify({ ts: savedAt, items: normalized })
        );
      } catch {
        // 용량 초과 등 무시
      }
    }

    return normalized;
  } catch (err) {
    console.warn("[thinking_category] 예외 발생, 기본 분류표로 폴백합니다:", err);
    return THINKING_CATEGORIES;
  }
}
