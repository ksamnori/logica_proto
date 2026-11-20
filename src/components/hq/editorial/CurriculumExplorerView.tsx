// src/components/hq/editorial/CurriculumExplorerView.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { hqFetch } from "@/lib/hq/clientApi";
import type {
  CategoryNodeSummary,
  CompetencyName,
  Depth8ItemSummary,
  DifficultyKey,
  EditorialCountFilter,
  EditorialUnitDetailPayload,
} from "@/lib/hq/editorialTypes";
import EditorialQuestionList from "./EditorialQuestionList";
import {
  COMPETENCY_LIST,
  COMPETENCY_STYLE,
  DIFF_ORDER,
  DIFF_STYLE,
  sortNaturalKo,
  sortSchoolLevel,
} from "./editorialUiUtils";

export interface CurriculumJumpTarget {
  categoryId?: string | null;
  itemId?: string | null;
  ts: number;
}

interface CurriculumExplorerViewProps {
  categories: CategoryNodeSummary[];
  countFilter: EditorialCountFilter;
  jumpTarget: CurriculumJumpTarget | null;
}

type TreeDensityFilter = "all" | "has_empty" | "has_questions";
type InsightTab = "distribution" | "lineage";

interface SubDistBar {
  key: string;
  label: string;
  subLabel: string;
  count: number;
  diff: Record<DifficultyKey, number>;
  kind: "depth3" | "depth4" | "depth5" | "depth7" | "depth8" | "direct7";
  active: boolean;
}

function emptyClientDiff(): Record<DifficultyKey, number> {
  return { 최하: 0, 하: 0, 중: 0, 상: 0, 최상: 0, 미지정: 0 };
}

function resolveInitialNav(
  categories: CategoryNodeSummary[],
  jumpTarget: CurriculumJumpTarget | null
) {
  if (jumpTarget) {
    const rawCat = jumpTarget.categoryId
      ? jumpTarget.categoryId.trim().toUpperCase()
      : jumpTarget.itemId && /-\d{3}$/.test(jumpTarget.itemId.trim())
        ? jumpTarget.itemId.trim().toUpperCase().slice(0, -4)
        : jumpTarget.itemId?.trim().toUpperCase() || "";
    const hit = rawCat
      ? categories.find((c) => c.category_id.toUpperCase() === rawCat)
      : null;
    if (hit) {
      return {
        d1: hit.depth1,
        d2: hit.depth2,
        d3: hit.depth3,
        d4: hit.depth4 || "",
        d5: hit.depth5 || "",
        catId: hit.category_id,
        itemId: jumpTarget.itemId ? jumpTarget.itemId.trim() : "",
        exp3: new Set([hit.depth3]),
        exp4: hit.depth4
          ? new Set([`${hit.depth3}||${hit.depth4}`])
          : new Set<string>(),
      };
    }
  }

  const elemCats = categories
    .filter((c) => c.depth1 === "초등학교" && c.depth2)
    .sort((a, b) => sortNaturalKo(a.depth2, b.depth2) || sortNaturalKo(a.category_id, b.category_id));
  const first = elemCats[0] || categories[0];

  return {
    d1: first?.depth1 || "초등학교",
    d2: first?.depth2 || "",
    d3: first?.depth3 || "",
    d4: "",
    d5: "",
    catId: "",
    itemId: "",
    exp3: first?.depth3 ? new Set([first.depth3]) : new Set<string>(),
    exp4: new Set<string>(),
  };
}

export default function CurriculumExplorerView({
  categories,
  countFilter,
  jumpTarget,
}: CurriculumExplorerViewProps) {
  const initNav = useMemo(
    () => resolveInitialNav(categories, jumpTarget),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [selectedD1, setSelectedD1] = useState<string>(initNav.d1);
  const [selectedD2, setSelectedD2] = useState<string>(initNav.d2);
  const [selectedD3, setSelectedD3] = useState<string>(initNav.d3);
  const [selectedD4, setSelectedD4] = useState<string>(initNav.d4);
  const [selectedD5, setSelectedD5] = useState<string>(initNav.d5);
  const [selectedCatId, setSelectedCatId] = useState<string>(initNav.catId);
  const [selectedItemId, setSelectedItemId] = useState<string>(initNav.itemId);
  const [directOnlyMode, setDirectOnlyMode] = useState<boolean>(false);

  const [expandedD3, setExpandedD3] = useState<Set<string>>(initNav.exp3);
  const [expandedD4, setExpandedD4] = useState<Set<string>>(initNav.exp4);
  const [treeFilter, setTreeFilter] = useState<TreeDensityFilter>("all");
  const [onlyEmptyTypes, setOnlyEmptyTypes] = useState<boolean>(false);
  const [insightTab, setInsightTab] = useState<InsightTab>("distribution");
  const [quickSearch, setQuickSearch] = useState<string>("");

  const [unitDetail, setUnitDetail] = useState<EditorialUnitDetailPayload | null>(null);
  const [unitDetailLoading, setUnitDetailLoading] = useState<boolean>(false);

  const schoolLevels = useMemo(() => {
    const map = new Map<string, { count: number; catCount: number; emptyCats: number }>();
    for (const c of categories) {
      if (!c.depth1) continue;
      const cur = map.get(c.depth1) || { count: 0, catCount: 0, emptyCats: 0 };
      cur.count += c.count;
      cur.catCount += 1;
      if (c.count === 0) cur.emptyCats += 1;
      map.set(c.depth1, cur);
    }
    return Array.from(map.entries())
      .sort((a, b) => sortSchoolLevel(a[0], b[0]))
      .map(([name, stat]) => ({ name, ...stat }));
  }, [categories]);

  const effectiveD1 = useMemo(() => {
    if (schoolLevels.some((s) => s.name === selectedD1)) return selectedD1;
    return schoolLevels[0]?.name || "초등학교";
  }, [schoolLevels, selectedD1]);

  const gradeSemesters = useMemo(() => {
    const map = new Map<
      string,
      { count: number; totalCats: number; coveredCats: number; unitSet: Set<string> }
    >();
    for (const c of categories) {
      if (c.depth1 !== effectiveD1 || !c.depth2) continue;
      let cur = map.get(c.depth2);
      if (!cur) {
        cur = { count: 0, totalCats: 0, coveredCats: 0, unitSet: new Set() };
        map.set(c.depth2, cur);
      }
      cur.count += c.count;
      cur.totalCats += 1;
      if (c.count > 0) cur.coveredCats += 1;
      if (c.depth3) cur.unitSet.add(c.depth3);
    }
    return Array.from(map.entries())
      .sort((a, b) => sortNaturalKo(a[0], b[0]))
      .map(([name, s]) => ({
        name,
        count: s.count,
        totalCats: s.totalCats,
        coveredCats: s.coveredCats,
        unitCount: s.unitSet.size,
      }));
  }, [categories, effectiveD1]);

  const effectiveD2 = useMemo(() => {
    if (gradeSemesters.some((g) => g.name === selectedD2)) return selectedD2;
    return gradeSemesters[0]?.name || "";
  }, [gradeSemesters, selectedD2]);

  const jumpToCategory = useCallback(
    (categoryId: string, itemId?: string | null) => {
      const cleanCat = categoryId.trim().toUpperCase();
      const target = categories.find(
        (c) => c.category_id.toUpperCase() === cleanCat
      );
      if (!target) return;
      setSelectedD1(target.depth1);
      setSelectedD2(target.depth2);
      setSelectedD3(target.depth3);
      setSelectedD4(target.depth4 || "");
      setSelectedD5(target.depth5 || "");
      setSelectedCatId(target.category_id);
      setSelectedItemId(itemId ? String(itemId).trim() : "");
      setDirectOnlyMode(false);
      setExpandedD3((prev) => new Set(prev).add(target.depth3));
      if (target.depth4) {
        setExpandedD4((prev) =>
          new Set(prev).add(`${target.depth3}||${target.depth4}`)
        );
      }
    },
    [categories]
  );

  const quickSearchResults = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    const hits: CategoryNodeSummary[] = [];
    for (const c of categories) {
      const hay = `${c.category_id} ${c.depth1} ${c.depth2} ${c.depth3} ${c.depth4} ${c.depth5} ${c.depth6} ${c.depth7}`.toLowerCase();
      if (hay.includes(q)) {
        hits.push(c);
        if (hits.length >= 25) break;
      }
    }
    return hits;
  }, [categories, quickSearch]);

  const unitTree = useMemo(() => {
    const inGrade = categories.filter(
      (c) => c.depth1 === effectiveD1 && c.depth2 === effectiveD2
    );

    type D5Node = {
      name: string;
      count: number;
      catCount: number;
      emptyCatCount: number;
      emptyItemCount: number;
    };
    type D4Node = {
      name: string;
      count: number;
      catCount: number;
      emptyCatCount: number;
      d5Map: Map<string, D5Node>;
    };
    type D3Node = {
      name: string;
      firstCode: string;
      count: number;
      catCount: number;
      emptyCatCount: number;
      d4Map: Map<string, D4Node>;
    };

    const d3Map = new Map<string, D3Node>();
    for (const c of inGrade) {
      const d3 = c.depth3 || "(대단원 미지정)";
      const d4 = c.depth4 || d3;
      const d5 = c.depth5 || d4;

      let n3 = d3Map.get(d3);
      if (!n3) {
        n3 = {
          name: d3,
          firstCode: c.category_id,
          count: 0,
          catCount: 0,
          emptyCatCount: 0,
          d4Map: new Map(),
        };
        d3Map.set(d3, n3);
      }
      if (c.category_id < n3.firstCode) n3.firstCode = c.category_id;
      n3.count += c.count;
      n3.catCount += 1;
      if (c.count === 0) n3.emptyCatCount += 1;

      let n4 = n3.d4Map.get(d4);
      if (!n4) {
        n4 = { name: d4, count: 0, catCount: 0, emptyCatCount: 0, d5Map: new Map() };
        n3.d4Map.set(d4, n4);
      }
      n4.count += c.count;
      n4.catCount += 1;
      if (c.count === 0) n4.emptyCatCount += 1;

      let n5 = n4.d5Map.get(d5);
      if (!n5) {
        n5 = { name: d5, count: 0, catCount: 0, emptyCatCount: 0, emptyItemCount: 0 };
        n4.d5Map.set(d5, n5);
      }
      n5.count += c.count;
      n5.catCount += 1;
      if (c.count === 0) n5.emptyCatCount += 1;
      n5.emptyItemCount += c.emptyItemCount;
    }

    const list = Array.from(d3Map.values()).sort((a, b) =>
      sortNaturalKo(a.firstCode, b.firstCode)
    );

    return list
      .filter((u) => {
        if (treeFilter === "has_empty") return u.emptyCatCount > 0;
        if (treeFilter === "has_questions") return u.count > 0;
        return true;
      })
      .map((u) => ({
        ...u,
        d4List: Array.from(u.d4Map.values()).map((d4) => ({
          ...d4,
          d5List: Array.from(d4.d5Map.values()),
        })),
      }));
  }, [categories, effectiveD1, effectiveD2, treeFilter]);

  const maxD3Count = useMemo(
    () => Math.max(1, ...unitTree.map((u) => u.count)),
    [unitTree]
  );

  const scopedCategories = useMemo(() => {
    return categories.filter((c) => {
      if (c.depth1 !== effectiveD1) return false;
      if (effectiveD2 && c.depth2 !== effectiveD2) return false;
      if (selectedD3 && c.depth3 !== selectedD3) return false;
      if (selectedD4 && (c.depth4 || c.depth3) !== selectedD4) return false;
      if (selectedD5 && (c.depth5 || c.depth4 || c.depth3) !== selectedD5) return false;
      return true;
    });
  }, [categories, effectiveD1, effectiveD2, selectedD3, selectedD4, selectedD5]);

  const activeQueryCategoryIds = useMemo(() => {
    if (selectedCatId) return [selectedCatId];
    return scopedCategories.map((c) => c.category_id);
  }, [selectedCatId, scopedCategories]);

  const detailCategoryIdsKey = useMemo(() => {
    const targetIds = selectedCatId
      ? [selectedCatId]
      : scopedCategories.slice(0, 120).map((c) => c.category_id);
    return targetIds.join(",");
  }, [selectedCatId, scopedCategories]);

  useEffect(() => {
    if (!detailCategoryIdsKey) return;
    let cancelled = false;
    const loadDetail = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setUnitDetailLoading(true);
      try {
        const qs = new URLSearchParams({
          action: "unit_detail",
          categoryIds: detailCategoryIdsKey,
          includeDerived: String(countFilter.includeDerived),
          includeSubTaxonomy: String(countFilter.includeSubTaxonomy),
          curriculum: countFilter.curriculum,
        });
        const res = await hqFetch<{ success: boolean; data: EditorialUnitDetailPayload }>(
          `/api/hq/editorial?${qs.toString()}`
        );
        if (!cancelled) setUnitDetail(res.data);
      } catch {
        if (!cancelled) setUnitDetail(null);
      } finally {
        if (!cancelled) setUnitDetailLoading(false);
      }
    };
    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [
    detailCategoryIdsKey,
    countFilter.includeDerived,
    countFilter.includeSubTaxonomy,
    countFilter.curriculum,
  ]);

  const effectiveUnitDetail = detailCategoryIdsKey ? unitDetail : null;

  const itemsByCatId = useMemo(() => {
    const map = new Map<string, Depth8ItemSummary[]>();
    for (const it of effectiveUnitDetail?.items || []) {
      const k = it.category_id.toUpperCase();
      const arr = map.get(k);
      if (arr) arr.push(it);
      else map.set(k, [it]);
    }
    return map;
  }, [effectiveUnitDetail]);

  const subDistributionBars = useMemo((): {
    levelTitle: string;
    bars: SubDistBar[];
  } => {
    if (selectedCatId) {
      const cat = categories.find((c) => c.category_id === selectedCatId);
      const childItems = itemsByCatId.get(selectedCatId.toUpperCase()) || [];
      const bars: SubDistBar[] = childItems.map((it) => ({
        key: it.item_id,
        label: it.depth8,
        subLabel: it.item_id,
        count: it.count,
        diff: it.diff,
        kind: "depth8",
        active: selectedItemId === it.item_id,
      }));
      if (cat && cat.directCount > 0) {
        bars.unshift({
          key: "__DIRECT__",
          label: "Depth 7 직접 배정 문항 (세부유형 미분리)",
          subLabel: cat.category_id,
          count: cat.directCount,
          diff: cat.diff,
          kind: "direct7",
          active: directOnlyMode,
        });
      }
      return {
        levelTitle: "8단계 세부유형(master_item)별 보유 문항 분포",
        bars,
      };
    }

    if (selectedD5) {
      return {
        levelTitle: "7단계 대표유형(master_category)별 보유 문항 분포",
        bars: scopedCategories.map((c) => ({
          key: c.category_id,
          label: c.depth7 || c.depth6 || c.category_id,
          subLabel: c.depth6 && c.depth7 ? c.depth6 : c.category_id,
          count: c.count,
          diff: c.diff,
          kind: "depth7",
          active: false,
        })),
      };
    }

    if (selectedD4) {
      const map = new Map<
        string,
        { count: number; diff: Record<DifficultyKey, number>; sub: number }
      >();
      for (const c of scopedCategories) {
        const k = c.depth5 || c.depth4 || c.depth3;
        let cur = map.get(k);
        if (!cur) {
          cur = { count: 0, diff: emptyClientDiff(), sub: 0 };
          map.set(k, cur);
        }
        cur.count += c.count;
        cur.sub += 1;
        DIFF_ORDER.forEach((dk) => (cur!.diff[dk] += c.diff[dk] || 0));
      }
      return {
        levelTitle: "5단계 소단원별 보유 문항 분포",
        bars: Array.from(map.entries()).map(([k, v]) => ({
          key: k,
          label: k,
          subLabel: `대표유형 ${v.sub}개`,
          count: v.count,
          diff: v.diff,
          kind: "depth5",
          active: false,
        })),
      };
    }

    if (selectedD3) {
      const map = new Map<
        string,
        { count: number; diff: Record<DifficultyKey, number>; sub: number }
      >();
      for (const c of scopedCategories) {
        const k = c.depth4 || c.depth3;
        let cur = map.get(k);
        if (!cur) {
          cur = { count: 0, diff: emptyClientDiff(), sub: 0 };
          map.set(k, cur);
        }
        cur.count += c.count;
        cur.sub += 1;
        DIFF_ORDER.forEach((dk) => (cur!.diff[dk] += c.diff[dk] || 0));
      }
      return {
        levelTitle: "4단계 중단원별 보유 문항 분포",
        bars: Array.from(map.entries()).map(([k, v]) => ({
          key: k,
          label: k,
          subLabel: `대표유형 ${v.sub}개`,
          count: v.count,
          diff: v.diff,
          kind: "depth4",
          active: false,
        })),
      };
    }

    const map = new Map<
      string,
      { count: number; diff: Record<DifficultyKey, number>; sub: number }
    >();
    for (const c of scopedCategories) {
      const k = c.depth3 || "(대단원)";
      let cur = map.get(k);
      if (!cur) {
        cur = { count: 0, diff: emptyClientDiff(), sub: 0 };
        map.set(k, cur);
      }
      cur.count += c.count;
      cur.sub += 1;
      DIFF_ORDER.forEach((dk) => (cur!.diff[dk] += c.diff[dk] || 0));
    }
    return {
      levelTitle: "3단계 대단원별 보유 문항 분포",
      bars: Array.from(map.entries()).map(([k, v]) => ({
        key: k,
        label: k,
        subLabel: `대표유형 ${v.sub}개`,
        count: v.count,
        diff: v.diff,
        kind: "depth3",
        active: false,
      })),
    };
  }, [
    selectedCatId,
    selectedItemId,
    directOnlyMode,
    selectedD5,
    selectedD4,
    selectedD3,
    scopedCategories,
    categories,
    itemsByCatId,
  ]);

  const maxSubBarCount = useMemo(
    () => Math.max(1, ...subDistributionBars.bars.map((b) => b.count)),
    [subDistributionBars]
  );

  const competencySummary = useMemo(() => {
    const targetCats = selectedCatId
      ? scopedCategories.filter((c) => c.category_id === selectedCatId)
      : scopedCategories;
    const counts: Record<CompetencyName, number> = {
      문제해결: 0,
      추론: 0,
      의사소통: 0,
      연결: 0,
      정보처리: 0,
    };
    let totalMapped = 0;
    for (const c of targetCats) {
      const p = c.competency?.primary;
      if (p && p in counts) {
        counts[p]++;
        totalMapped++;
      }
    }
    return { counts, totalMapped };
  }, [scopedCategories, selectedCatId]);

  const selectedCatObj = useMemo(
    () =>
      selectedCatId
        ? categories.find((c) => c.category_id === selectedCatId) || null
        : null,
    [categories, selectedCatId]
  );

  const scopeTitle = useMemo(() => {
    const parts = [effectiveD1, effectiveD2];
    if (selectedD3) parts.push(selectedD3);
    if (selectedD4 && selectedD4 !== selectedD3) parts.push(selectedD4);
    if (selectedD5 && selectedD5 !== selectedD4) parts.push(selectedD5);
    if (selectedCatObj) {
      parts.push(selectedCatObj.depth7 || selectedCatObj.category_id);
    }
    if (selectedItemId) {
      const it = (effectiveUnitDetail?.items || []).find(
        (i) => i.item_id === selectedItemId
      );
      parts.push(it ? `[Depth8] ${it.depth8}` : selectedItemId);
    } else if (directOnlyMode) {
      parts.push("[Depth7 직접 배정]");
    }
    return parts.filter(Boolean).join(" > ");
  }, [
    effectiveD1,
    effectiveD2,
    selectedD3,
    selectedD4,
    selectedD5,
    selectedCatObj,
    selectedItemId,
    directOnlyMode,
    effectiveUnitDetail,
  ]);

  const scopedTotalQuestions = useMemo(
    () =>
      (selectedCatObj ? [selectedCatObj] : scopedCategories).reduce(
        (acc, c) => acc + c.count,
        0
      ),
    [scopedCategories, selectedCatObj]
  );

  const visibleTypeCards = useMemo(() => {
    if (!onlyEmptyTypes) return scopedCategories;
    return scopedCategories.filter((c) => c.count === 0 || c.emptyItemCount > 0);
  }, [scopedCategories, onlyEmptyTypes]);

  const questionListResetKey = `curr|${effectiveD1}|${effectiveD2}|${selectedD3}|${selectedD4}|${selectedD5}|${selectedCatId}|${selectedItemId}|${directOnlyMode}|${countFilter.includeDerived}|${countFilter.includeSubTaxonomy}|${countFilter.curriculum}`;

  return (
    <div className="space-y-4">
      {/* 1단: 학교급 탭 + 전 학년 빠른 분류 검색 + 학년·학기 리본 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {schoolLevels.map((sl) => {
              const active = effectiveD1 === sl.name;
              return (
                <button
                  key={sl.name}
                  type="button"
                  onClick={() => {
                    setSelectedD1(sl.name);
                    setSelectedD2("");
                    setSelectedD3("");
                    setSelectedD4("");
                    setSelectedD5("");
                    setSelectedCatId("");
                    setSelectedItemId("");
                    setDirectOnlyMode(false);
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 border ${
                    active
                      ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                      : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <span>{sl.name}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[11px] ${
                      active ? "bg-white/20 text-white" : "bg-white text-slate-600"
                    }`}
                  >
                    {sl.count.toLocaleString()}제
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-80">
            <input
              type="text"
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
              placeholder="🔎 전 학년 단원·유형·분류코드 즉시 찾기 (예: 전개도, 원주각, E611)"
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {quickSearch && (
              <button
                type="button"
                onClick={() => setQuickSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            )}
            {quickSearchResults.length > 0 && (
              <div className="absolute right-0 left-0 mt-1 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl z-30 divide-y divide-slate-100">
                {quickSearchResults.map((hit) => (
                  <button
                    key={hit.category_id}
                    type="button"
                    onClick={() => {
                      jumpToCategory(hit.category_id);
                      setQuickSearch("");
                    }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50/70 transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-indigo-600">
                        {hit.depth1} &gt; {hit.depth2} &gt; {hit.depth3}
                      </div>
                      <div className="text-xs font-extrabold text-slate-900 truncate">
                        {hit.depth7 || hit.depth6 || hit.depth5}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {hit.category_id} ({hit.curriculum_version} 개정)
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 ${
                        hit.count === 0
                          ? "bg-rose-100 text-rose-700"
                          : "bg-indigo-100 text-indigo-700"
                      }`}
                    >
                      {hit.count}제
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {gradeSemesters.map((gs) => {
            const active = effectiveD2 === gs.name;
            const covPct =
              gs.totalCats > 0 ? Math.round((gs.coveredCats / gs.totalCats) * 100) : 0;
            return (
              <button
                key={gs.name}
                type="button"
                onClick={() => {
                  setSelectedD2(gs.name);
                  setSelectedD4("");
                  setSelectedD5("");
                  setSelectedCatId("");
                  setSelectedItemId("");
                  setDirectOnlyMode(false);
                  const firstInGs = categories.find(
                    (c) => c.depth1 === effectiveD1 && c.depth2 === gs.name && c.depth3
                  );
                  if (firstInGs) {
                    setSelectedD3(firstInGs.depth3);
                    setExpandedD3(new Set([firstInGs.depth3]));
                  } else {
                    setSelectedD3("");
                  }
                }}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  active
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : "bg-slate-50/70 hover:bg-indigo-50/50 text-slate-800 border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-extrabold truncate">{gs.name}</span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      active ? "bg-white/20 text-white" : "bg-white text-slate-600"
                    }`}
                  >
                    {gs.unitCount}단원
                  </span>
                </div>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className="text-sm font-black">
                    {gs.count.toLocaleString()}
                    <span className="text-[11px] font-bold ml-0.5">제</span>
                  </span>
                  <span
                    className={`text-[10px] font-bold ${
                      active ? "text-indigo-100" : "text-slate-500"
                    }`}
                  >
                    유형보유 {covPct}%
                  </span>
                </div>
                <div
                  className={`mt-1.5 h-1.5 w-full rounded-full overflow-hidden ${
                    active ? "bg-indigo-900/40" : "bg-slate-200"
                  }`}
                >
                  <div
                    style={{ width: `${covPct}%` }}
                    className={`h-full rounded-full ${
                      active ? "bg-white" : "bg-indigo-500"
                    }`}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2단 메인 레이아웃 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden lg:sticky lg:top-3">
          <div className="p-3.5 border-b border-slate-200 bg-slate-50/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-extrabold text-slate-900">
                📂 {effectiveD2 || "학년·학기"} 단원 구조 및 밀도
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedD3("");
                  setSelectedD4("");
                  setSelectedD5("");
                  setSelectedCatId("");
                  setSelectedItemId("");
                  setDirectOnlyMode(false);
                }}
                className="text-[11px] font-bold text-indigo-600 hover:underline"
              >
                학기 전체 보기
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1 bg-slate-200/70 p-1 rounded-xl text-[11px] font-bold">
              {[
                { id: "all", label: "전체 단원" },
                { id: "has_empty", label: "🚨 공백포함" },
                { id: "has_questions", label: "보유단원" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTreeFilter(t.id as TreeDensityFilter)}
                  className={`py-1 rounded-lg transition-all ${
                    treeFilter === t.id
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[calc(100vh-240px)] overflow-y-auto p-2.5 space-y-1.5 custom-scroll">
            {unitTree.length === 0 && (
              <div className="py-10 text-center text-xs text-slate-400 font-bold">
                표시할 단원이 없습니다.
              </div>
            )}

            {unitTree.map((u3, idx3) => {
              const isOpen3 = expandedD3.has(u3.name);
              const isActive3 = selectedD3 === u3.name && !selectedD4;
              const barPct = Math.max(3, Math.round((u3.count / maxD3Count) * 100));

              return (
                <div
                  key={u3.name}
                  className="rounded-xl border border-slate-200/80 overflow-hidden bg-white"
                >
                  <div
                    className={`px-3 py-2.5 cursor-pointer transition-colors ${
                      isActive3
                        ? "bg-indigo-50 border-l-4 border-l-indigo-600"
                        : "hover:bg-slate-50"
                    }`}
                    onClick={() => {
                      setSelectedD3(u3.name);
                      setSelectedD4("");
                      setSelectedD5("");
                      setSelectedCatId("");
                      setSelectedItemId("");
                      setDirectOnlyMode(false);
                      setExpandedD3((prev) => {
                        const next = new Set(prev);
                        if (next.has(u3.name)) next.delete(u3.name);
                        else next.add(u3.name);
                        return next;
                      });
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {isOpen3 ? "▾" : "▸"}
                        </span>
                        <span className="text-xs font-extrabold text-slate-900 truncate">
                          {idx3 + 1}. {u3.name}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 ${
                          u3.count === 0
                            ? "bg-rose-100 text-rose-700"
                            : "bg-slate-900 text-white"
                        }`}
                      >
                        {u3.count.toLocaleString()}제
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          style={{ width: u3.count === 0 ? "0%" : `${barPct}%` }}
                          className="h-full rounded-full bg-indigo-500"
                        />
                      </div>
                      {u3.emptyCatCount > 0 && (
                        <span className="text-[10px] font-bold text-rose-600 shrink-0">
                          공백유형 {u3.emptyCatCount}
                        </span>
                      )}
                    </div>
                  </div>

                  {isOpen3 && (
                    <div className="bg-slate-50/60 border-t border-slate-100 px-2 py-1.5 space-y-1">
                      {u3.d4List.map((u4) => {
                        const d4Key = `${u3.name}||${u4.name}`;
                        const hasDistinctD5 =
                          u4.d5List.length > 1 ||
                          (u4.d5List.length === 1 && u4.d5List[0].name !== u4.name);
                        const isOpen4 = expandedD4.has(d4Key) || !hasDistinctD5;
                        const isActive4 =
                          selectedD3 === u3.name && selectedD4 === u4.name && !selectedD5;

                        return (
                          <div key={d4Key} className="space-y-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedD3(u3.name);
                                setSelectedD4(u4.name);
                                setSelectedD5("");
                                setSelectedCatId("");
                                setSelectedItemId("");
                                setDirectOnlyMode(false);
                                if (hasDistinctD5) {
                                  setExpandedD4((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(d4Key)) next.delete(d4Key);
                                    else next.add(d4Key);
                                    return next;
                                  });
                                }
                              }}
                              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 transition-colors ${
                                isActive4
                                  ? "bg-indigo-600 text-white font-extrabold"
                                  : "text-slate-700 hover:bg-slate-200/60 font-bold"
                              }`}
                            >
                              <span className="truncate flex items-center gap-1.5">
                                {hasDistinctD5 && (
                                  <span className="text-[10px] opacity-70">
                                    {isOpen4 ? "▾" : "▸"}
                                  </span>
                                )}
                                <span className="truncate">{u4.name}</span>
                              </span>
                              <span
                                className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded shrink-0 ${
                                  isActive4
                                    ? "bg-white/20 text-white"
                                    : u4.count === 0
                                      ? "bg-rose-100 text-rose-700"
                                      : "bg-white text-slate-600 border border-slate-200"
                                }`}
                              >
                                {u4.count}제
                              </span>
                            </button>

                            {hasDistinctD5 && isOpen4 && (
                              <div className="ml-3 pl-2 border-l border-slate-200 space-y-0.5">
                                {u4.d5List.map((u5) => {
                                  const isActive5 =
                                    selectedD3 === u3.name &&
                                    selectedD4 === u4.name &&
                                    selectedD5 === u5.name &&
                                    !selectedCatId;
                                  return (
                                    <button
                                      key={u5.name}
                                      type="button"
                                      onClick={() => {
                                        setSelectedD3(u3.name);
                                        setSelectedD4(u4.name);
                                        setSelectedD5(u5.name);
                                        setSelectedCatId("");
                                        setSelectedItemId("");
                                        setDirectOnlyMode(false);
                                      }}
                                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11.5px] flex items-center justify-between gap-2 transition-colors ${
                                        isActive5
                                          ? "bg-indigo-100 text-indigo-900 font-extrabold border border-indigo-300"
                                          : "text-slate-600 hover:bg-slate-200/50 font-medium"
                                      }`}
                                    >
                                      <span className="truncate flex items-center gap-1.5">
                                        <span
                                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                            u5.count === 0
                                              ? "bg-rose-500"
                                              : u5.count < 5
                                                ? "bg-amber-500"
                                                : "bg-emerald-500"
                                          }`}
                                        />
                                        <span className="truncate">{u5.name}</span>
                                      </span>
                                      <span
                                        className={`text-[10px] font-bold shrink-0 ${
                                          u5.count === 0 ? "text-rose-600" : "text-slate-500"
                                        }`}
                                      >
                                        {u5.count}제
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4">
          {/* A. 상위 분류 구성 브레드크럼 & 인사이트 보드 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-extrabold text-[11px]">
                현재 위치
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedD3("");
                  setSelectedD4("");
                  setSelectedD5("");
                  setSelectedCatId("");
                  setSelectedItemId("");
                  setDirectOnlyMode(false);
                }}
                className="font-bold text-slate-700 hover:text-indigo-600"
              >
                {effectiveD1} · {effectiveD2}
              </button>
              {selectedD3 && (
                <>
                  <span className="text-slate-300">▸</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedD4("");
                      setSelectedD5("");
                      setSelectedCatId("");
                      setSelectedItemId("");
                      setDirectOnlyMode(false);
                    }}
                    className="font-bold text-slate-700 hover:text-indigo-600"
                  >
                    {selectedD3}
                  </button>
                </>
              )}
              {selectedD4 && selectedD4 !== selectedD3 && (
                <>
                  <span className="text-slate-300">▸</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedD5("");
                      setSelectedCatId("");
                      setSelectedItemId("");
                      setDirectOnlyMode(false);
                    }}
                    className="font-bold text-slate-700 hover:text-indigo-600"
                  >
                    {selectedD4}
                  </button>
                </>
              )}
              {selectedD5 && selectedD5 !== selectedD4 && (
                <>
                  <span className="text-slate-300">▸</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCatId("");
                      setSelectedItemId("");
                      setDirectOnlyMode(false);
                    }}
                    className="font-bold text-slate-700 hover:text-indigo-600"
                  >
                    {selectedD5}
                  </button>
                </>
              )}
              {selectedCatObj && (
                <>
                  <span className="text-slate-300">▸</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemId("");
                      setDirectOnlyMode(false);
                    }}
                    className="font-extrabold text-indigo-700 hover:underline"
                  >
                    [Depth 7] {selectedCatObj.depth7 || selectedCatObj.category_id}
                  </button>
                </>
              )}
              {selectedItemId && (
                <>
                  <span className="text-slate-300">▸</span>
                  <span className="px-2 py-0.5 rounded bg-indigo-600 text-white font-extrabold text-[11px]">
                    🎯 Depth 8: {selectedItemId}
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div>
                  <span className="text-slate-500 font-semibold">선택 범위 총 문항: </span>
                  <span className="font-black text-indigo-700 text-sm">
                    {scopedTotalQuestions.toLocaleString()}제
                  </span>
                </div>
                <div className="text-slate-300">|</div>
                <div>
                  <span className="text-slate-500 font-semibold">포함 대표유형(Depth7): </span>
                  <span className="font-extrabold text-slate-800">
                    {(selectedCatObj ? 1 : scopedCategories.length).toLocaleString()}개
                  </span>
                </div>
                {effectiveUnitDetail && (
                  <>
                    <div className="text-slate-300">|</div>
                    <div>
                      <span className="text-slate-500 font-semibold">세부유형(Depth8): </span>
                      <span className="font-extrabold text-slate-800">
                        {effectiveUnitDetail.items.length.toLocaleString()}개
                      </span>
                      <span className="text-rose-600 font-bold ml-1">
                        (공백 {effectiveUnitDetail.items.filter((i) => i.count === 0).length}개)
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setInsightTab("distribution")}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    insightTab === "distribution"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  📊 하위 분류 분포 · 세부유형
                </button>
                <button
                  type="button"
                  onClick={() => setInsightTab("lineage")}
                  className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 ${
                    insightTab === "lineage"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <span>🔗 선수·후속 계통 &amp; 역량</span>
                  {effectiveUnitDetail &&
                    effectiveUnitDetail.prerequisites.length +
                      effectiveUnitDetail.followups.length >
                      0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-extrabold">
                        {effectiveUnitDetail.prerequisites.length +
                          effectiveUnitDetail.followups.length}
                      </span>
                    )}
                </button>
              </div>
            </div>

            {insightTab === "distribution" && subDistributionBars.bars.length > 0 && (
              <div className="pt-2 space-y-2">
                <div className="text-xs font-extrabold text-slate-800">
                  📊 {subDistributionBars.levelTitle}{" "}
                  <span className="text-[11px] font-normal text-slate-500">
                    (막대를 클릭하면 해당 분류로 바로 내려갑니다)
                  </span>
                </div>

                <div className="max-h-72 overflow-y-auto pr-1 space-y-1.5 custom-scroll">
                  {subDistributionBars.bars.map((bar) => {
                    const widthPct =
                      bar.count === 0
                        ? 0
                        : Math.max(3, Math.round((bar.count / maxSubBarCount) * 100));
                    return (
                      <button
                        key={bar.key}
                        type="button"
                        onClick={() => {
                          if (bar.kind === "depth3") {
                            setSelectedD3(bar.key);
                            setExpandedD3((p) => new Set(p).add(bar.key));
                          } else if (bar.kind === "depth4") {
                            setSelectedD4(bar.key);
                            setExpandedD4((p) =>
                              new Set(p).add(`${selectedD3}||${bar.key}`)
                            );
                          } else if (bar.kind === "depth5") {
                            setSelectedD5(bar.key);
                          } else if (bar.kind === "depth7") {
                            setSelectedCatId(bar.key);
                            setSelectedItemId("");
                            setDirectOnlyMode(false);
                          } else if (bar.kind === "depth8") {
                            setDirectOnlyMode(false);
                            setSelectedItemId((prev) =>
                              prev === bar.key ? "" : bar.key
                            );
                          } else if (bar.kind === "direct7") {
                            setSelectedItemId("");
                            setDirectOnlyMode((prev) => !prev);
                          }
                        }}
                        className={`w-full text-left p-2 rounded-xl border transition-all ${
                          bar.active
                            ? "border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-400"
                            : bar.count === 0
                              ? "border-rose-200/80 bg-rose-50/30 hover:bg-rose-50/70"
                              : "border-slate-200/80 bg-slate-50/50 hover:bg-indigo-50/40"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs mb-1">
                          <div className="min-w-0 flex items-center gap-1.5">
                            <span className="font-bold text-slate-800 truncate">
                              {bar.label}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono shrink-0">
                              {bar.subLabel}
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 ${
                              bar.count === 0
                                ? "bg-rose-100 text-rose-700"
                                : "bg-slate-800 text-white"
                            }`}
                          >
                            {bar.count === 0 ? "0제 · 공백" : `${bar.count.toLocaleString()}제`}
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-200/80 overflow-hidden flex">
                          {bar.count === 0 ? (
                            <div className="w-full h-full border border-dashed border-rose-300 rounded-full" />
                          ) : (
                            <div
                              style={{ width: `${widthPct}%` }}
                              className="h-full flex overflow-hidden rounded-full"
                            >
                              {DIFF_ORDER.map((dk) => {
                                const c = bar.diff?.[dk] || 0;
                                if (c === 0) return null;
                                return (
                                  <div
                                    key={dk}
                                    style={{ width: `${(c / bar.count) * 100}%` }}
                                    className={DIFF_STYLE[dk].bar}
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {insightTab === "lineage" && (
              <div className="pt-2 space-y-4">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-slate-800">
                      🧠 단원 핵심 교과 역량 분포 (taxonomy_competency)
                    </span>
                    <span className="text-[11px] text-slate-500 font-semibold">
                      매핑된 대표유형 {competencySummary.totalMapped}개 기준
                    </span>
                  </div>
                  {competencySummary.totalMapped > 0 ? (
                    <>
                      <div className="h-3 w-full rounded-full bg-slate-200 overflow-hidden flex">
                        {COMPETENCY_LIST.map((comp) => {
                          const cnt = competencySummary.counts[comp];
                          if (cnt === 0) return null;
                          const pct = (cnt / competencySummary.totalMapped) * 100;
                          return (
                            <div
                              key={comp}
                              style={{ width: `${pct}%` }}
                              title={`${comp}: ${cnt}개 유형 (${Math.round(pct)}%)`}
                              className={COMPETENCY_STYLE[comp].bar}
                            />
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        {COMPETENCY_LIST.map((comp) => {
                          const cnt = competencySummary.counts[comp];
                          if (cnt === 0) return null;
                          const pct = Math.round(
                            (cnt / competencySummary.totalMapped) * 100
                          );
                          return (
                            <span
                              key={comp}
                              className={`px-2.5 py-0.5 rounded-lg border text-[11px] font-bold ${COMPETENCY_STYLE[comp].badge}`}
                            >
                              {comp} {cnt}개 ({pct}%)
                            </span>
                          );
                        })}
                      </div>
                      {selectedCatObj?.competency?.reason && (
                        <div className="mt-1.5 text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200">
                          <span className="font-extrabold text-indigo-700 mr-1.5">
                            [선택 유형 역량 근거]
                          </span>
                          {selectedCatObj.competency.reason}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-xs text-slate-400">
                      이 범위에 등록된 역량 매핑 데이터가 없습니다.
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-extrabold text-slate-800">
                    🔗 선수 학습 ──▶ 현재 단원 ──▶ 후속 연계 계통도 (prerequisite_mapping)
                  </div>
                  {unitDetailLoading ? (
                    <div className="py-6 text-center text-xs text-slate-400">
                      계통 연계 정보를 불러오는 중...
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-11 gap-2.5 items-stretch">
                      <div className="md:col-span-5 rounded-xl border border-amber-200 bg-amber-50/40 p-3 space-y-2">
                        <div className="text-xs font-extrabold text-amber-900 flex items-center justify-between">
                          <span>⏪ 선수 학습 단원 (이전에 배워야 할 내용)</span>
                          <span className="px-1.5 py-0.5 rounded bg-amber-200/70 text-amber-900 text-[10px]">
                            {effectiveUnitDetail?.prerequisites.length || 0}건
                          </span>
                        </div>
                        <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1 custom-scroll">
                          {(effectiveUnitDetail?.prerequisites || []).length === 0 ? (
                            <div className="text-[11px] text-slate-400 py-4 text-center">
                              연결된 외부 선수 학습 단원이 없습니다.
                            </div>
                          ) : (
                            effectiveUnitDetail!.prerequisites.map((p) => (
                              <button
                                key={`${p.mapping_id}_${p.linked_category_id}`}
                                type="button"
                                onClick={() => jumpToCategory(p.linked_category_id)}
                                className="w-full text-left p-2.5 rounded-lg bg-white hover:bg-amber-50 border border-amber-200/80 transition-colors space-y-1"
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-[10px] font-extrabold text-amber-700">
                                    {p.depth1} · {p.depth2} &gt; {p.depth3}
                                  </span>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 shrink-0">
                                    {p.questionCount}제
                                  </span>
                                </div>
                                <div className="text-xs font-bold text-slate-900">
                                  {p.depth7 || p.depth6 || p.depth5}
                                </div>
                                {p.reason && (
                                  <div className="text-[11px] text-slate-600 line-clamp-2 leading-snug">
                                    💡 {p.reason}
                                  </div>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="md:col-span-1 flex md:flex-col items-center justify-center gap-1 py-1 text-slate-400 font-black text-sm">
                        <span>──▶</span>
                        <span className="px-2 py-1 rounded-lg bg-indigo-600 text-white text-[10px] font-extrabold text-center">
                          현재
                        </span>
                        <span>──▶</span>
                      </div>

                      <div className="md:col-span-5 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
                        <div className="text-xs font-extrabold text-emerald-900 flex items-center justify-between">
                          <span>⏩ 후속 연계 단원 (이후 확장되는 내용)</span>
                          <span className="px-1.5 py-0.5 rounded bg-emerald-200/70 text-emerald-900 text-[10px]">
                            {effectiveUnitDetail?.followups.length || 0}건
                          </span>
                        </div>
                        <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1 custom-scroll">
                          {(effectiveUnitDetail?.followups || []).length === 0 ? (
                            <div className="text-[11px] text-slate-400 py-4 text-center">
                              연결된 외부 후속 학습 단원이 없습니다.
                            </div>
                          ) : (
                            effectiveUnitDetail!.followups.map((f) => (
                              <button
                                key={`${f.mapping_id}_${f.linked_category_id}`}
                                type="button"
                                onClick={() => jumpToCategory(f.linked_category_id)}
                                className="w-full text-left p-2.5 rounded-lg bg-white hover:bg-emerald-50 border border-emerald-200/80 transition-colors space-y-1"
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-[10px] font-extrabold text-emerald-700">
                                    {f.depth1} · {f.depth2} &gt; {f.depth3}
                                  </span>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 shrink-0">
                                    {f.questionCount}제
                                  </span>
                                </div>
                                <div className="text-xs font-bold text-slate-900">
                                  {f.depth7 || f.depth6 || f.depth5}
                                </div>
                                {f.reason && (
                                  <div className="text-[11px] text-slate-600 line-clamp-2 leading-snug">
                                    🚀 {f.reason}
                                  </div>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* B. 세부 대표유형(Depth 7) 및 세부유형(Depth 8 master_item) 드릴다운 */}
          {selectedD3 && scopedCategories.length <= 120 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm">🎯</span>
                  <h4 className="text-xs font-extrabold text-slate-900">
                    7단계 대표유형 &amp; 8단계 세부유형(master_item) 정밀 선택
                  </h4>
                  <span className="text-[11px] text-slate-500">
                    ({visibleTypeCards.length}개 대표유형)
                  </span>
                </div>

                <label className="flex items-center gap-1.5 text-xs font-bold text-rose-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={onlyEmptyTypes}
                    onChange={(e) => setOnlyEmptyTypes(e.target.checked)}
                    className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  <span>🚨 0문항 공백이 있는 유형만 보기</span>
                </label>
              </div>

              <div className="max-h-80 overflow-y-auto space-y-2 pr-1 custom-scroll">
                {visibleTypeCards.map((cat) => {
                  const isSelectedCat = selectedCatId === cat.category_id;
                  const childItems =
                    itemsByCatId.get(cat.category_id.toUpperCase()) || [];
                  const compPrimary = cat.competency?.primary;

                  return (
                    <div
                      key={cat.category_id}
                      className={`rounded-xl border transition-all ${
                        isSelectedCat
                          ? "border-indigo-500 bg-indigo-50/30 shadow-2xs"
                          : "border-slate-200 bg-slate-50/40 hover:border-slate-300"
                      }`}
                    >
                      <div
                        onClick={() => {
                          if (isSelectedCat) {
                            setSelectedCatId("");
                            setSelectedItemId("");
                            setDirectOnlyMode(false);
                          } else {
                            setSelectedCatId(cat.category_id);
                            setSelectedItemId("");
                            setDirectOnlyMode(false);
                          }
                        }}
                        className="px-3.5 py-2.5 cursor-pointer flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                            <span className="font-mono font-bold text-slate-600">
                              {cat.category_id}
                            </span>
                            {cat.depth6 && <span>· {cat.depth6}</span>}
                            {compPrimary && (
                              <span
                                className={`px-1.5 py-0.2 rounded border text-[10px] font-bold ${COMPETENCY_STYLE[compPrimary].badge}`}
                              >
                                {compPrimary}
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-extrabold text-slate-900">
                            {cat.depth7 || cat.depth6 || cat.depth5}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {cat.emptyItemCount > 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                              공백 Depth8 {cat.emptyItemCount}/{cat.itemCount}
                            </span>
                          )}
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold ${
                              cat.count === 0
                                ? "bg-rose-100 text-rose-700"
                                : "bg-indigo-600 text-white"
                            }`}
                          >
                            {cat.count}제
                          </span>
                        </div>
                      </div>

                      {(isSelectedCat || onlyEmptyTypes) && childItems.length > 0 && (
                        <div className="px-3.5 pb-3 pt-1 border-t border-slate-200/70 flex flex-wrap gap-1.5">
                          {childItems
                            .filter((it) => (!onlyEmptyTypes ? true : it.count === 0))
                            .map((it) => {
                              const activeItem = selectedItemId === it.item_id;
                              return (
                                <button
                                  key={it.item_id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedCatId(cat.category_id);
                                    setDirectOnlyMode(false);
                                    setSelectedItemId(activeItem ? "" : it.item_id);
                                  }}
                                  className={`px-2.5 py-1.5 rounded-lg border text-left text-[11.5px] transition-all flex items-center gap-2 ${
                                    activeItem
                                      ? "bg-indigo-600 text-white border-indigo-600 font-extrabold shadow-2xs"
                                      : it.count === 0
                                        ? "bg-rose-50/70 hover:bg-rose-100/70 text-rose-800 border-rose-200 font-semibold"
                                        : "bg-white hover:bg-indigo-50 text-slate-800 border-slate-200 font-semibold"
                                  }`}
                                >
                                  <span>{it.depth8}</span>
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[10px] font-extrabold shrink-0 ${
                                      activeItem
                                        ? "bg-white/20 text-white"
                                        : it.count === 0
                                          ? "bg-rose-200/80 text-rose-900"
                                          : "bg-slate-100 text-slate-700"
                                    }`}
                                  >
                                    {it.count}제
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* C. 실제 보유 문항 원문 뷰어 */}
          <EditorialQuestionList
            key={questionListResetKey}
            mode="curriculum"
            scopeTitle={scopeTitle}
            categoryIds={selectedItemId ? [] : activeQueryCategoryIds}
            itemIds={selectedItemId ? [selectedItemId] : []}
            directOnly={directOnlyMode}
            countFilter={countFilter}
            onJumpToTaxonomy={(taxId) => {
              const upper = taxId.trim().toUpperCase();
              const maybeCat = /-\d{3}$/.test(upper) ? upper.slice(0, -4) : upper;
              jumpToCategory(maybeCat, /-\d{3}$/.test(upper) ? taxId : null);
            }}
          />
        </div>
      </div>
    </div>
  );
}
