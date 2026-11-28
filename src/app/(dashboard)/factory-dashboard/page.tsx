// src/app/(dashboard)/factory-dashboard/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isConfidentialExamText, isConfidentialQuestionObj } from "@/lib/confidentialExamGuard";
import QuestionRateCalibrationPanel from "@/components/factory/QuestionRateCalibrationPanel";

type DashboardStats = {
  totalQuestions: number;
  totalBooks: number;
  recentUploads: number;
  difficulty: { 최상: number; 상: number; 중: number; 하: number; 최하: number; 미지정: number };
  schoolLevel: { 초등: number; 중등: number; 고등: number; 분류필요: number };
};

const STATS_CACHE_KEY = "logica_factory_stats_cache_v2";
const LEGACY_STATS_CACHE_KEY = "logica_factory_stats_cache_v1";
const STATS_CACHE_TTL_MS = 30 * 60 * 1000; // 30분 캐시 (재진입·새 탭 0ms 즉시 표시 + 만료 시 백그라운드 갱신)
let memoryStatsCache: { stats: DashboardStats; updatedAt: number } | null = null;

async function computeFactoryStatsClientFallback(): Promise<DashboardStats> {
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const activeOr = "is_hidden.is.null,is_hidden.eq.false";

  const countActive = (customize?: (q: any) => any): PromiseLike<number> => {
    let q: any = supabase
      .from("question_db")
      .select("question_id", { count: "exact", head: true })
      .or(activeOr);
    if (customize) q = customize(q);
    return q.then(({ count }: any) => Number(count || 0));
  };

  const [
    tbRes,
    confRes,
    rawTotal,
    rawRecent,
    rawElem,
    rawMid,
    rawHigh,
    rawD1,
    rawD2,
    rawD3,
    rawD4,
    rawD5,
  ] = await Promise.all([
    supabase.from("textbook").select("title"),
    supabase
      .from("question_db")
      .select("question_id, difficulty, taxonomy_id, created_at, is_hidden, source_book_name, book_name, pdf_source")
      .or(
        "pdf_source.ilike.%입학테스트%,pdf_source.ilike.%진단평가%,source_book_name.ilike.%입학테스트%,source_book_name.ilike.%진단평가%,book_name.ilike.%입학테스트%,book_name.ilike.%진단평가%,pdf_source.ilike.%입학 테스트%,pdf_source.ilike.%진단 평가%,source_book_name.ilike.%입학 테스트%,source_book_name.ilike.%진단 평가%,book_name.ilike.%입학 테스트%,book_name.ilike.%진단 평가%"
      )
      .limit(2000),
    countActive(),
    countActive((q) => q.gte("created_at", sevenDaysAgoIso)),
    countActive((q) => q.gte("taxonomy_id", "E").lt("taxonomy_id", "F")),
    countActive((q) => q.gte("taxonomy_id", "M").lt("taxonomy_id", "N")),
    countActive((q) => q.gte("taxonomy_id", "H").lt("taxonomy_id", "I")),
    countActive((q) => q.eq("difficulty", "최상")),
    countActive((q) => q.eq("difficulty", "상")),
    countActive((q) => q.eq("difficulty", "중")),
    countActive((q) => q.eq("difficulty", "하")),
    countActive((q) => q.eq("difficulty", "최하")),
  ]);

  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let confTotal = 0;
  let confRecent = 0;
  let confElem = 0;
  let confMid = 0;
  let confHigh = 0;
  const confDiff = { 최상: 0, 상: 0, 중: 0, 하: 0, 최하: 0 };

  for (const r of confRes.data || []) {
    if (!r || r.is_hidden === true || r.is_hidden === "Y" || r.is_hidden === "true") continue;
    if (!isConfidentialQuestionObj(r)) continue;
    confTotal++;
    if (r.created_at && new Date(r.created_at).getTime() >= sevenDaysAgoMs) confRecent++;
    const tax = String(r.taxonomy_id || "");
    if (tax >= "E" && tax < "F") confElem++;
    else if (tax >= "M" && tax < "N") confMid++;
    else if (tax >= "H" && tax < "I") confHigh++;
    const d = String(r.difficulty || "").trim();
    if (d === "최상" || d === "상" || d === "중" || d === "하" || d === "최하") {
      confDiff[d]++;
    }
  }

  const totalQuestions = Math.max(0, rawTotal - confTotal);
  const recentUploads = Math.max(0, rawRecent - confRecent);
  const elem = Math.max(0, rawElem - confElem);
  const mid = Math.max(0, rawMid - confMid);
  const high = Math.max(0, rawHigh - confHigh);
  const unmapped = Math.max(0, totalQuestions - elem - mid - high);

  const d최상 = Math.max(0, rawD1 - confDiff.최상);
  const d상 = Math.max(0, rawD2 - confDiff.상);
  const d중 = Math.max(0, rawD3 - confDiff.중);
  const d하 = Math.max(0, rawD4 - confDiff.하);
  const d최하 = Math.max(0, rawD5 - confDiff.최하);
  const d미지정 = Math.max(0, totalQuestions - d최상 - d상 - d중 - d하 - d최하);

  const totalBooks = (tbRes.data || []).filter(
    (t: any) => t?.title && !isConfidentialExamText(t.title)
  ).length;

  return {
    totalQuestions,
    totalBooks,
    recentUploads,
    difficulty: { 최상: d최상, 상: d상, 중: d중, 하: d하, 최하: d최하, 미지정: d미지정 },
    schoolLevel: { 초등: elem, 중등: mid, 고등: high, 분류필요: unmapped },
  };
}

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

    try {
      sessionStorage.removeItem(LEGACY_STATS_CACHE_KEY);
    } catch {}

    // 1. 메모리 또는 localStorage 캐시가 있으면 0ms 즉시 렌더링하고, 만료 시에만 백그라운드 갱신
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
        const raw = localStorage.getItem(STATS_CACHE_KEY) || sessionStorage.getItem(STATS_CACHE_KEY);
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

    loadDashboardData(hydrated, false);
  }, [isAuthorized]);

  const loadDashboardData = async (silentBackground: boolean = false, forceRefresh: boolean = false) => {
    if (silentBackground) {
      setIsRefreshingBg(true);
    } else {
      setIsLoading(true);
      setLoadProgress({ loaded: 0, total: 0 });
    }

    try {
      let nextStats: DashboardStats | null = null;
      let builtAt = Date.now();

      try {
        const res = await fetch("/api/gemini-twin", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "factory_stats", forceRefresh }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json?.success && json.stats) {
            nextStats = {
              totalQuestions: json.stats.totalQuestions,
              totalBooks: json.stats.totalBooks,
              recentUploads: json.stats.recentUploads,
              difficulty: json.stats.difficulty,
              schoolLevel: json.stats.schoolLevel,
            };
            builtAt = Number(json.stats.builtAt) || Date.now();
          }
        }
      } catch {}

      if (!nextStats) {
        nextStats = await computeFactoryStatsClientFallback();
        builtAt = Date.now();
      }

      memoryStatsCache = { stats: nextStats, updatedAt: builtAt };
      try {
        const serialized = JSON.stringify(memoryStatsCache);
        localStorage.setItem(STATS_CACHE_KEY, serialized);
        sessionStorage.setItem(STATS_CACHE_KEY, serialized);
      } catch {}

      setStats(nextStats);
      setLastUpdatedAt(builtAt);
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
          onClick={() => loadDashboardData(false, true)}
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

          {/* 실데이터 기반 문항 정답률·난이도 자동 보정 패널 */}
          <QuestionRateCalibrationPanel
            onAfterApply={() => {
              memoryStatsCache = null;
              try {
                localStorage.removeItem(STATS_CACHE_KEY);
                sessionStorage.removeItem(STATS_CACHE_KEY);
              } catch {}
              loadDashboardData(true, true);
            }}
          />
        </div>
      )}
    </div>
  );
}