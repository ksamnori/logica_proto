// src/app/(dashboard)/factory-dashboard/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type DashboardStats = {
  totalQuestions: number;
  totalBooks: number;
  recentUploads: number;
  difficulty: { 최상: number; 상: number; 중: number; 하: number; 최하: number; 미지정: number };
  schoolLevel: { 초등: number; 중등: number; 고등: number; 분류필요: number };
};

const STATS_CACHE_KEY = "logica_factory_stats_cache_v1";
const STATS_CACHE_TTL_MS = 10 * 60 * 1000; // 10분 캐시 (재진입 시 0ms 즉시 표시 + 백그라운드 갱신)
let memoryStatsCache: { stats: DashboardStats; updatedAt: number } | null = null;

// 🌟 [초고속 병렬 로더] 전체 행 수를 HEAD 쿼리로 먼저 확인한 뒤 8개씩 병렬 range 요청으로 고속 수집
const fetchAllRowsParallel = async (
  tableName: string,
  selectQuery: string,
  orderCol: string,
  onProgress?: (loaded: number, total: number) => void
) => {
  const step = 1000;
  const concurrency = 8;

  const { count, error: countErr } = await supabase
    .from(tableName)
    .select("*", { count: "exact", head: true });

  // count 조회가 지원되지 않는 예외 상황에서는 안전한 병렬 배치 폴백
  if (countErr || count === null) {
    const fallback: any[] = [];
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      const batch = Array.from({ length: concurrency }, (_, idx) => {
        const start = (page + idx) * step;
        return supabase
          .from(tableName)
          .select(selectQuery)
          .order(orderCol, { ascending: true })
          .range(start, start + step - 1);
      });
      const results = await Promise.all(batch);
      for (const res of results) {
        const rows = res.data || [];
        if (rows.length > 0) fallback.push(...rows);
        if (rows.length < step) hasMore = false;
      }
      page += concurrency;
      onProgress?.(fallback.length, fallback.length);
    }
    return fallback;
  }

  if (count === 0) {
    onProgress?.(0, 0);
    return [];
  }

  const totalPages = Math.ceil(count / step);
  const pageChunks: any[][] = new Array(totalPages);
  let loadedCount = 0;

  for (let p = 0; p < totalPages; p += concurrency) {
    const waveSize = Math.min(concurrency, totalPages - p);
    const promises = Array.from({ length: waveSize }, (_, idx) => {
      const pageIndex = p + idx;
      const start = pageIndex * step;
      return supabase
        .from(tableName)
        .select(selectQuery)
        .order(orderCol, { ascending: true })
        .range(start, start + step - 1)
        .then(({ data, error }) => {
          const rows = !error && data ? data : [];
          pageChunks[pageIndex] = rows;
          loadedCount += rows.length;
          onProgress?.(Math.min(loadedCount, count), count);
        });
    });
    await Promise.all(promises);
  }

  const allData: any[] = [];
  for (const chunk of pageChunks) {
    if (chunk && chunk.length > 0) allData.push(...chunk);
  }
  return allData;
};

export default function FactoryDashboardPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingBg, setIsRefreshingBg] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number }>({ loaded: 0, total: 0 });
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const [stats, setStats] = useState<DashboardStats>({
    totalQuestions: 0,
    totalBooks: 0,
    recentUploads: 0,
    difficulty: { 최상: 0, 상: 0, 중: 0, 하: 0, 최하: 0, 미지정: 0 },
    schoolLevel: { 초등: 0, 중등: 0, 고등: 0, 분류필요: 0 },
  });

  useEffect(() => {
    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    const isGodMode =
      role === "SUPER_ADMIN" ||
      role === "ADMIN" ||
      role === "MANAGER" ||
      pos.includes("최고관리자") ||
      pos.includes("원장") ||
      pos.includes("부원장") ||
      pos.includes("실장") ||
      pos.includes("전임강사");
    if (isGodMode) {
      setIsAuthorized(true);
    } else {
      alert("⛔ 권한이 없습니다.");
      router.replace("/home");
    }
  }, [router]);

  useEffect(() => {
    if (!isAuthorized) return;

    // 1. 메모리 또는 세션 캐시가 있으면 0ms 즉시 렌더링하고, 만료 시에만 백그라운드 갱신
    let hydrated = false;
    if (memoryStatsCache) {
      setStats(memoryStatsCache.stats);
      setLastUpdatedAt(memoryStatsCache.updatedAt);
      setIsLoading(false);
      hydrated = true;
      if (Date.now() - memoryStatsCache.updatedAt < STATS_CACHE_TTL_MS) {
        return;
      }
    } else {
      try {
        const raw = sessionStorage.getItem(STATS_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.stats && parsed?.updatedAt) {
            memoryStatsCache = parsed;
            setStats(parsed.stats);
            setLastUpdatedAt(parsed.updatedAt);
            setIsLoading(false);
            hydrated = true;
            if (Date.now() - parsed.updatedAt < STATS_CACHE_TTL_MS) {
              return;
            }
          }
        }
      } catch {}
    }

    loadDashboardData(hydrated);
  }, [isAuthorized]);

  const loadDashboardData = async (silentBackground: boolean = false) => {
    if (silentBackground) {
      setIsRefreshingBg(true);
    } else {
      setIsLoading(true);
      setLoadProgress({ loaded: 0, total: 0 });
    }

    try {
      // 🌟 교재 수, 카테고리, 아이템, 문제은행 메타데이터(무거운 UUID question_id 제외!)를 모두 동시에 병렬 호출
      const [bookRes, categories, items, qData] = await Promise.all([
        supabase.from("textbook").select("*", { count: "exact", head: true }),
        fetchAllRowsParallel("master_category", "category_id, depth1", "category_id"),
        fetchAllRowsParallel("master_item", "item_id, category_id", "item_id"),
        fetchAllRowsParallel(
          "question_db",
          "difficulty, taxonomy_id, created_at, is_hidden",
          "question_id",
          (loaded, total) => setLoadProgress({ loaded, total })
        ),
      ]);

      const catMap = new Map<string, string>();
      categories.forEach((c: any) => {
        if (c.category_id) catMap.set(c.category_id, c.depth1 || "");
      });
      items.forEach((i: any) => {
        if (i.item_id) catMap.set(i.item_id, catMap.get(i.category_id) || "");
      });

      const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      let totalQ = 0;
      let recent = 0;
      const diffCount = { 최상: 0, 상: 0, 중: 0, 하: 0, 최하: 0, 미지정: 0 };
      const schoolCount = { 초등: 0, 중등: 0, 고등: 0, 분류필요: 0 };

      for (let i = 0; i < qData.length; i++) {
        const q = qData[i];
        if (q.is_hidden === true || q.is_hidden === "Y" || q.is_hidden === "true") continue;
        totalQ++;

        if (q.created_at && new Date(q.created_at).getTime() >= sevenDaysAgoMs) {
          recent++;
        }

        const diff = (q.difficulty || "").trim();
        if (diff === "최상" || diff === "상" || diff === "중" || diff === "하" || diff === "최하") {
          diffCount[diff]++;
        } else {
          diffCount["미지정"]++;
        }

        const taxId = q.taxonomy_id;
        const depth1Str = (taxId && catMap.get(taxId)) || "";

        if (depth1Str.includes("초등") || (taxId && taxId.startsWith("E"))) schoolCount["초등"]++;
        else if (depth1Str.includes("중등") || depth1Str.includes("중학") || (taxId && taxId.startsWith("M"))) schoolCount["중등"]++;
        else if (depth1Str.includes("고등") || (taxId && taxId.startsWith("H"))) schoolCount["고등"]++;
        else schoolCount["분류필요"]++;
      }

      const nextStats: DashboardStats = {
        totalQuestions: totalQ,
        totalBooks: bookRes.count || 0,
        recentUploads: recent,
        difficulty: diffCount,
        schoolLevel: schoolCount,
      };

      const now = Date.now();
      memoryStatsCache = { stats: nextStats, updatedAt: now };
      try {
        sessionStorage.setItem(STATS_CACHE_KEY, JSON.stringify(memoryStatsCache));
      } catch {}

      setStats(nextStats);
      setLastUpdatedAt(now);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
      setIsRefreshingBg(false);
    }
  };

  const ProgressBar = ({ label, count, total, colorClass }: { label: string; count: number; total: number; colorClass: string }) => {
    const percent = total > 0 ? Math.round((count / total) * 100) : 0;
    return (
      <div className="mb-5">
        <div className="flex justify-between text-[13px] font-bold text-slate-600 mb-1.5">
          <span>{label}</span>
          <span>
            {count.toLocaleString()}제 ({percent}%)
          </span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden shadow-inner border border-slate-200">
          <div className={`h-full rounded-full transition-all duration-700 ${colorClass}`} style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  };

  if (isAuthorized === null) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-slate-50 gap-3">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-bold text-slate-500">대시보드 접근 권한을 확인하고 있습니다...</p>
      </div>
    );
  }
  if (isAuthorized === false) return null;

  const progressPct =
    loadProgress.total > 0 ? Math.min(100, Math.round((loadProgress.loaded / loadProgress.total) * 100)) : 0;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-pretendard p-6 overflow-hidden custom-scroll">
      <div className="bg-slate-900 rounded-2xl p-8 shadow-lg flex flex-col md:flex-row justify-between items-center mb-6 shrink-0 gap-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-white opacity-5 rounded-full blur-2xl" />
        <div className="relative z-10">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <span>📊</span> 마스터 DB 컨트롤 타워
            <span className="text-xs font-bold text-slate-900 bg-emerald-400 px-2.5 py-1 rounded shadow-sm tracking-widest uppercase">
              Live Status
            </span>
          </h1>
          <p className="text-sm font-bold text-slate-400 mt-2">
            학원에 적재된 모든 문제은행 자산의 통계를 실시간으로 분석합니다.
            {lastUpdatedAt && !isLoading && (
              <span className="ml-2 text-xs text-emerald-300/90 font-semibold">
                (최근 갱신:{" "}
                {new Date(lastUpdatedAt).toLocaleTimeString("ko-KR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
                )
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => loadDashboardData(false)}
          disabled={isLoading || isRefreshingBg}
          className="relative z-10 px-5 py-2.5 bg-white/10 hover:bg-white/20 disabled:opacity-60 text-white font-bold rounded-xl border border-white/20 transition-colors flex items-center gap-2 cursor-pointer"
        >
          {isLoading || isRefreshingBg ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>데이터 분석 중...</span>
            </>
          ) : (
            "🔄 실시간 새로고침"
          )}
        </button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-2xl border border-slate-200 shadow-sm text-slate-500 font-bold gap-4 p-8">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-base text-slate-700">데이터베이스 문항을 고속 병렬 집계하고 있습니다...</p>
          {loadProgress.total > 0 && (
            <div className="w-full max-w-md flex flex-col gap-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>진행률 ({progressPct}%)</span>
                <span>
                  {loadProgress.loaded.toLocaleString()} / {loadProgress.total.toLocaleString()} 문항
                </span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                <div
                  className="h-full bg-indigo-600 transition-all duration-200 rounded-full"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scroll pb-10">
          {/* Top Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center text-2xl mb-3 shadow-sm">
                📚
              </div>
              <p className="text-sm font-bold text-slate-500 mb-1">시스템에 등록된 전체 교재</p>
              <h3 className="text-3xl font-bold text-slate-800">
                {stats.totalBooks.toLocaleString()} <span className="text-lg text-slate-400">권</span>
              </h3>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center text-2xl mb-3 shadow-sm">
                🧠
              </div>
              <p className="text-sm font-bold text-slate-500 mb-1">마스터 문제은행 누적 문항</p>
              <h3 className="text-3xl font-bold text-indigo-700">
                {stats.totalQuestions.toLocaleString()} <span className="text-lg text-indigo-400">제</span>
              </h3>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center text-2xl mb-3 shadow-sm">
                🔥
              </div>
              <p className="text-sm font-bold text-slate-500 mb-1">최근 7일간 새로 추가된 문항</p>
              <h3 className="text-3xl font-bold text-rose-600">
                +{stats.recentUploads.toLocaleString()} <span className="text-lg text-rose-400">제</span>
              </h3>
            </div>
          </div>

          {/* Middle Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 학교급별 분포 */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                <span>🏫</span> 학교급별 문항 적재 현황
              </h3>
              <div>
                <ProgressBar label="초등부 문항" count={stats.schoolLevel["초등"]} total={stats.totalQuestions} colorClass="bg-amber-400" />
                <ProgressBar label="중등부 문항" count={stats.schoolLevel["중등"]} total={stats.totalQuestions} colorClass="bg-emerald-500" />
                <ProgressBar label="고등부 문항" count={stats.schoolLevel["고등"]} total={stats.totalQuestions} colorClass="bg-blue-600" />

                <div className="mt-8 pt-6 border-t border-slate-100">
                  <div className="flex justify-between items-center p-4 bg-rose-50 rounded-xl border border-rose-100">
                    <div>
                      <h4 className="text-sm font-bold text-rose-800">⚠️ 분류 작업이 필요한 문항</h4>
                      <p className="text-xs font-medium text-rose-600 mt-1">
                        Taxonomy 분류 체계가 매핑되지 않은 고아 문항들입니다.
                      </p>
                    </div>
                    <div className="text-xl font-bold text-rose-600">{stats.schoolLevel["분류필요"].toLocaleString()}제</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 난이도 분포 */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                <span>📈</span> 문항 난이도 분포도
              </h3>
              <div>
                <ProgressBar label="최상 (킬러 문항)" count={stats.difficulty["최상"]} total={stats.totalQuestions} colorClass="bg-fuchsia-600" />
                <ProgressBar label="상 (심화 문항)" count={stats.difficulty["상"]} total={stats.totalQuestions} colorClass="bg-rose-500" />
                <ProgressBar label="중 (응용 문항)" count={stats.difficulty["중"]} total={stats.totalQuestions} colorClass="bg-indigo-500" />
                <ProgressBar label="하 (기본 문항)" count={stats.difficulty["하"]} total={stats.totalQuestions} colorClass="bg-sky-400" />
                <ProgressBar label="최하 (연산/기초)" count={stats.difficulty["최하"]} total={stats.totalQuestions} colorClass="bg-slate-400" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}