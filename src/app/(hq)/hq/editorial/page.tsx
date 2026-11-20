// src/app/(hq)/hq/editorial/page.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import CurriculumExplorerView, {
  type CurriculumJumpTarget,
} from "@/components/hq/editorial/CurriculumExplorerView";
import ImageReverseClassifierView from "@/components/hq/editorial/ImageReverseClassifierView";
import ThinkingExplorerView from "@/components/hq/editorial/ThinkingExplorerView";
import { hqFetch } from "@/lib/hq/clientApi";
import type {
  EditorialBootstrapPayload,
  EditorialCountFilter,
} from "@/lib/hq/editorialTypes";

type StudioMode = "curriculum" | "thinking" | "capture";

export default function HqEditorialStudioPage() {
  const [studioMode, setStudioMode] = useState<StudioMode>("curriculum");
  const [countFilter, setCountFilter] = useState<EditorialCountFilter>({
    includeDerived: true,
    includeSubTaxonomy: false,
    curriculum: "all",
  });

  const [bootstrap, setBootstrap] = useState<EditorialBootstrapPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadSeq, setReloadSeq] = useState<number>(0);
  const [forceServerRefresh, setForceServerRefresh] = useState<boolean>(false);

  const [curriculumJump, setCurriculumJump] =
    useState<CurriculumJumpTarget | null>(null);
  const [thinkingJumpId, setThinkingJumpId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const qs = new URLSearchParams({
          action: "bootstrap",
          includeDerived: String(countFilter.includeDerived),
          includeSubTaxonomy: String(countFilter.includeSubTaxonomy),
          curriculum: countFilter.curriculum,
          ...(forceServerRefresh ? { refresh: "true" } : {}),
        });
        const res = await hqFetch<{
          success: boolean;
          data: EditorialBootstrapPayload;
        }>(`/api/hq/editorial?${qs.toString()}`);
        if (!cancelled) {
          setBootstrap(res.data);
          setError(null);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "집필 스튜디오 데이터를 불러오지 못했습니다."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
          setForceServerRefresh(false);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    countFilter.includeDerived,
    countFilter.includeSubTaxonomy,
    countFilter.curriculum,
    reloadSeq,
    forceServerRefresh,
  ]);

  const triggerForceRefresh = useCallback(() => {
    setRefreshing(true);
    setForceServerRefresh(true);
    setReloadSeq((n) => n + 1);
  }, []);

  const handleOpenInCurriculumExplorer = useCallback(
    (categoryId: string, itemId?: string | null) => {
      setStudioMode("curriculum");
      setCurriculumJump({
        categoryId,
        itemId: itemId || null,
        ts: Date.now(),
      });
    },
    []
  );

  const handleOpenThinkingInExplorer = useCallback((thkId: string) => {
    setThinkingJumpId(thkId);
    setStudioMode("thinking");
  }, []);

  const gs = bootstrap?.globalStats;

  return (
    <div className="w-full max-w-[1640px] mx-auto px-4 sm:px-6 py-5 space-y-4">
      {/* 상단 스튜디오 헤더 & 모드 전환 & 집계 기준 필터 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl">🧭</span>
              <h1 className="text-lg font-black text-slate-900 tracking-tight">
                집필 · 문항 분류 스튜디오
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-extrabold">
                본부 집필팀 전용
              </span>
            </div>
            <p className="text-xs text-slate-500">
              학년·단원·8단계 세부유형별 보유 문항 밀도와 선수·후속 계통(prerequisite), 교과역량(competency)을 한눈에 파악하고, 원고 캡처 이미지로 8단계 분류 위치를 즉시 타겟팅합니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl">
            <button
              type="button"
              onClick={() => setStudioMode("curriculum")}
              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 ${
                studioMode === "curriculum"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>📚</span>
              <span>교과 단원 · 계통 탐색</span>
            </button>
            <button
              type="button"
              onClick={() => setStudioMode("thinking")}
              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 ${
                studioMode === "thinking"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>🧠</span>
              <span>사고력(THK) 분류 탐색</span>
            </button>
            <button
              type="button"
              onClick={() => setStudioMode("capture")}
              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 ${
                studioMode === "capture"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>📸</span>
              <span>캡처 이미지 역분류 · DB 등록</span>
            </button>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 font-bold">
              <button
                type="button"
                onClick={() => {
                  setRefreshing(true);
                  setCountFilter((f) => ({ ...f, includeDerived: false }));
                }}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  !countFilter.includeDerived
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                원본 문항만
              </button>
              <button
                type="button"
                onClick={() => {
                  setRefreshing(true);
                  setCountFilter((f) => ({ ...f, includeDerived: true }));
                }}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  countFilter.includeDerived
                    ? "bg-white text-indigo-700 shadow-2xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                쌍둥이·유사 포함
              </button>
            </div>

            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer select-none font-bold text-slate-700">
              <input
                type="checkbox"
                checked={countFilter.includeSubTaxonomy}
                onChange={(e) => {
                  setRefreshing(true);
                  setCountFilter((f) => ({
                    ...f,
                    includeSubTaxonomy: e.target.checked,
                  }));
                }}
                className="rounded border-slate-300 text-indigo-600"
              />
              <span>부분류(sub_taxonomy) 합산</span>
            </label>

            {studioMode === "curriculum" && (
              <select
                value={countFilter.curriculum}
                onChange={(e) => {
                  setRefreshing(true);
                  setCountFilter((f) => ({
                    ...f,
                    curriculum: e.target.value as "all" | "2022" | "2015",
                  }));
                }}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 font-bold text-slate-700"
              >
                <option value="all">교육과정 전체 (2022+2015)</option>
                <option value="2022">2022 개정 교육과정만</option>
                <option value="2015">2015 개정 교육과정만</option>
              </select>
            )}

            <button
              type="button"
              disabled={refreshing || loading}
              onClick={triggerForceRefresh}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-600 disabled:opacity-50"
            >
              {refreshing ? "🔄 새로고침 중..." : "🔄 DB 집계 새로고침"}
            </button>
          </div>

          {gs && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="px-3 py-1 rounded-xl bg-slate-900 text-white font-bold">
                활성 문항{" "}
                <span className="font-black text-amber-300">
                  {gs.totalActiveQuestions.toLocaleString()}제
                </span>
                <span className="text-[10.5px] text-slate-300 ml-1">
                  (원본 {gs.originalQuestions.toLocaleString()} · 파생{" "}
                  {gs.derivedQuestions.toLocaleString()})
                </span>
              </div>
              <div className="px-3 py-1 rounded-xl bg-indigo-50 text-indigo-800 border border-indigo-200 font-bold">
                대표유형(D7) 보유{" "}
                <span className="font-black">
                  {gs.coveredCategories.toLocaleString()}
                </span>
                /{gs.totalCategories.toLocaleString()}
                <span className="text-rose-600 ml-1">
                  (공백 {gs.emptyCategories.toLocaleString()})
                </span>
              </div>
              <div className="px-3 py-1 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold">
                세부유형(D8) 보유{" "}
                <span className="font-black">
                  {gs.coveredItems.toLocaleString()}
                </span>
                /{gs.totalItems.toLocaleString()}
              </div>
              <div className="px-3 py-1 rounded-xl bg-amber-50 text-amber-900 border border-amber-200 font-bold">
                사고력(THK){" "}
                <span className="font-black">
                  {gs.thinkingMappedQuestions.toLocaleString()}제
                </span>{" "}
                ({gs.coveredThinking}/{gs.totalThinking}유형)
              </div>
            </div>
          )}
        </div>
      </div>

      {loading && !bootstrap && (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center space-y-3 shadow-xs">
          <div className="w-9 h-9 mx-auto rounded-full border-3 border-slate-200 border-t-indigo-600 animate-spin" />
          <div className="text-sm font-extrabold text-slate-800">
            문제은행(48,000+ 문항)과 8단계 교육과정·역량·선수학습 계통도를 집계하고 있습니다...
          </div>
          <div className="text-xs text-slate-400">
            최초 1회 로드 이후에는 서버 메모리 캐시에서 0.1초 내에 즉시 열립니다.
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700 flex items-center justify-between gap-2">
          <span>⚠️ {error}</span>
          <button
            type="button"
            onClick={triggerForceRefresh}
            className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-extrabold shrink-0"
          >
            다시 시도
          </button>
        </div>
      )}

      {bootstrap && (
        <>
          {studioMode === "curriculum" && (
            <CurriculumExplorerView
              key={curriculumJump?.ts || "curriculum-root"}
              categories={bootstrap.categories}
              countFilter={countFilter}
              jumpTarget={curriculumJump}
            />
          )}

          {studioMode === "thinking" && (
            <ThinkingExplorerView
              key={thinkingJumpId || "thinking-root"}
              thinkingCategories={bootstrap.thinkingCategories}
              countFilter={countFilter}
              initialThkId={thinkingJumpId}
              onJumpToCurriculum={(taxId) => {
                const upper = taxId.trim().toUpperCase();
                const maybeCat = /-\d{3}$/.test(upper) ? upper.slice(0, -4) : upper;
                handleOpenInCurriculumExplorer(
                  maybeCat,
                  /-\d{3}$/.test(upper) ? taxId : null
                );
              }}
            />
          )}

          {studioMode === "capture" && (
            <ImageReverseClassifierView
              categories={bootstrap.categories}
              thinkingCategories={bootstrap.thinkingCategories}
              knownBooks={bootstrap.globalStats.topBooks.map((b) => b.name)}
              onOpenInExplorer={handleOpenInCurriculumExplorer}
              onOpenThinkingInExplorer={handleOpenThinkingInExplorer}
              onSavedToDb={triggerForceRefresh}
            />
          )}
        </>
      )}
    </div>
  );
}
