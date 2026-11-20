// src/components/hq/editorial/ThinkingExplorerView.tsx
"use client";

import React, { useMemo, useState } from "react";
import type {
  EditorialCountFilter,
  ThinkingNodeSummary,
} from "@/lib/hq/editorialTypes";
import EditorialQuestionList from "./EditorialQuestionList";
import { DIFF_ORDER, DIFF_STYLE } from "./editorialUiUtils";

interface ThinkingExplorerViewProps {
  thinkingCategories: ThinkingNodeSummary[];
  countFilter: EditorialCountFilter;
  initialThkId?: string | null;
  onJumpToCurriculum?: (taxonomyId: string) => void;
}

export default function ThinkingExplorerView({
  thinkingCategories,
  countFilter,
  initialThkId,
  onJumpToCurriculum,
}: ThinkingExplorerViewProps) {
  const initialHit = useMemo(
    () =>
      initialThkId
        ? thinkingCategories.find(
            (t) =>
              t.category_id.toUpperCase() === initialThkId.trim().toUpperCase()
          ) || null
        : null,
    [initialThkId, thinkingCategories]
  );

  const domains = useMemo(() => {
    const map = new Map<
      string,
      { count: number; typeCount: number; coveredTypes: number }
    >();
    for (const t of thinkingCategories) {
      let cur = map.get(t.depth1);
      if (!cur) {
        cur = { count: 0, typeCount: 0, coveredTypes: 0 };
        map.set(t.depth1, cur);
      }
      cur.count += t.count;
      cur.typeCount += 1;
      if (t.count > 0) cur.coveredTypes += 1;
    }
    return Array.from(map.entries()).map(([name, s]) => ({ name, ...s }));
  }, [thinkingCategories]);

  const [selectedD1, setSelectedD1] = useState<string>(
    () => initialHit?.depth1 || domains[0]?.name || ""
  );
  const [selectedD2, setSelectedD2] = useState<string>(
    () => initialHit?.depth2 || ""
  );
  const [selectedThkId, setSelectedThkId] = useState<string>(
    () => initialHit?.category_id || ""
  );
  const [onlyEmpty, setOnlyEmpty] = useState<boolean>(false);

  const effectiveD1 = selectedD1 || domains[0]?.name || "";

  const inDomain = useMemo(
    () =>
      thinkingCategories.filter((t) => !effectiveD1 || t.depth1 === effectiveD1),
    [thinkingCategories, effectiveD1]
  );

  const d2Groups = useMemo(() => {
    const map = new Map<string, ThinkingNodeSummary[]>();
    for (const t of inDomain) {
      if (onlyEmpty && t.count > 0) continue;
      const arr = map.get(t.depth2);
      if (arr) arr.push(t);
      else map.set(t.depth2, [t]);
    }
    return Array.from(map.entries()).map(([name, list]) => ({
      name,
      count: list.reduce((a, b) => a + b.count, 0),
      emptyCount: list.filter((i) => i.count === 0).length,
      items: list,
    }));
  }, [inDomain, onlyEmpty]);

  const scopedThkItems = useMemo(() => {
    if (selectedThkId) {
      return thinkingCategories.filter((t) => t.category_id === selectedThkId);
    }
    return inDomain.filter((t) => !selectedD2 || t.depth2 === selectedD2);
  }, [thinkingCategories, inDomain, selectedD2, selectedThkId]);

  const maxItemCount = useMemo(
    () => Math.max(1, ...scopedThkItems.map((t) => t.count)),
    [scopedThkItems]
  );

  const scopeTitle = useMemo(() => {
    if (selectedThkId) {
      const hit = thinkingCategories.find((t) => t.category_id === selectedThkId);
      return hit ? `${hit.full_path} (${hit.category_id})` : selectedThkId;
    }
    return [effectiveD1 || "사고력 전체", selectedD2].filter(Boolean).join(" > ");
  }, [effectiveD1, selectedD2, selectedThkId, thinkingCategories]);

  const listResetKey = `thk|${effectiveD1}|${selectedD2}|${selectedThkId}|${countFilter.includeDerived}|${countFilter.includeSubTaxonomy}`;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-extrabold text-slate-900">
            🧠 사고력 분류(thinking_category · 총 {thinkingCategories.length}개 유형) 영역별 보유 현황
          </div>
          <label className="flex items-center gap-1.5 text-xs font-bold text-rose-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyEmpty}
              onChange={(e) => setOnlyEmpty(e.target.checked)}
              className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
            />
            <span>🚨 0문항 공백 사고력 유형만 보기</span>
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {domains.map((d) => {
            const active = effectiveD1 === d.name;
            const pct =
              d.typeCount > 0 ? Math.round((d.coveredTypes / d.typeCount) * 100) : 0;
            return (
              <button
                key={d.name}
                type="button"
                onClick={() => {
                  setSelectedD1(d.name);
                  setSelectedD2("");
                  setSelectedThkId("");
                }}
                className={`p-3 rounded-xl border text-left transition-all ${
                  active
                    ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                    : "bg-slate-50/70 hover:bg-amber-50/60 text-slate-800 border-slate-200"
                }`}
              >
                <div className="text-xs font-extrabold truncate">{d.name}</div>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className="text-sm font-black">
                    {d.count.toLocaleString()}
                    <span className="text-[11px] font-bold ml-0.5">제</span>
                  </span>
                  <span
                    className={`text-[10px] font-bold ${
                      active ? "text-amber-100" : "text-slate-500"
                    }`}
                  >
                    {d.coveredTypes}/{d.typeCount}유형
                  </span>
                </div>
                <div
                  className={`mt-1.5 h-1.5 w-full rounded-full overflow-hidden ${
                    active ? "bg-amber-900/40" : "bg-slate-200"
                  }`}
                >
                  <div
                    style={{ width: `${pct}%` }}
                    className={`h-full rounded-full ${
                      active ? "bg-white" : "bg-amber-500"
                    }`}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden lg:sticky lg:top-3">
          <div className="p-3.5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
            <span className="text-xs font-extrabold text-slate-900">
              🧩 {effectiveD1} 세부 주제
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedD2("");
                setSelectedThkId("");
              }}
              className="text-[11px] font-bold text-amber-700 hover:underline"
            >
              영역 전체 보기
            </button>
          </div>

          <div className="max-h-[calc(100vh-260px)] overflow-y-auto p-2.5 space-y-2 custom-scroll">
            {d2Groups.map((g) => (
              <div
                key={g.name}
                className="rounded-xl border border-slate-200 overflow-hidden bg-white"
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedD2(selectedD2 === g.name ? "" : g.name);
                    setSelectedThkId("");
                  }}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs font-extrabold ${
                    selectedD2 === g.name && !selectedThkId
                      ? "bg-amber-50 text-amber-950 border-l-4 border-l-amber-500"
                      : "bg-slate-50/60 text-slate-800 hover:bg-slate-100/70"
                  }`}
                >
                  <span className="truncate">{g.name}</span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-white text-[10px] shrink-0">
                    {g.count}제
                  </span>
                </button>
                <div className="p-1.5 space-y-0.5 divide-y divide-slate-50">
                  {g.items.map((item) => {
                    const active = selectedThkId === item.category_id;
                    return (
                      <button
                        key={item.category_id}
                        type="button"
                        onClick={() => {
                          setSelectedD2(g.name);
                          setSelectedThkId(active ? "" : item.category_id);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 transition-colors ${
                          active
                            ? "bg-amber-600 text-white font-extrabold"
                            : "text-slate-700 hover:bg-amber-50/70 font-semibold"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate">{item.depth3}</div>
                          <div
                            className={`text-[10px] font-mono ${
                              active ? "text-amber-100" : "text-slate-400"
                            }`}
                          >
                            {item.category_id}
                          </div>
                        </div>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold shrink-0 ${
                            active
                              ? "bg-white/20 text-white"
                              : item.count === 0
                                ? "bg-rose-100 text-rose-700"
                                : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {item.count}제
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2.5">
            <div className="text-xs font-extrabold text-slate-900">
              📊 {scopeTitle} — 소분류 유형별 문항 분포
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 custom-scroll">
              {scopedThkItems.map((it) => {
                const widthPct =
                  it.count === 0
                    ? 0
                    : Math.max(4, Math.round((it.count / maxItemCount) * 100));
                const active = selectedThkId === it.category_id;
                return (
                  <button
                    key={it.category_id}
                    type="button"
                    onClick={() =>
                      setSelectedThkId(active ? "" : it.category_id)
                    }
                    className={`w-full text-left p-2 rounded-xl border transition-all ${
                      active
                        ? "border-amber-500 bg-amber-50/60"
                        : it.count === 0
                          ? "border-rose-200 bg-rose-50/30"
                          : "border-slate-200/80 bg-slate-50/50 hover:bg-amber-50/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs mb-1">
                      <span className="font-bold text-slate-800 truncate">
                        [{it.category_id}] {it.depth2} &gt; {it.depth3}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 ${
                          it.count === 0
                            ? "bg-rose-100 text-rose-700"
                            : "bg-slate-800 text-white"
                        }`}
                      >
                        {it.count === 0 ? "0제 · 공백" : `${it.count}제`}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden flex">
                      {it.count === 0 ? (
                        <div className="w-full h-full border border-dashed border-rose-300 rounded-full" />
                      ) : (
                        <div
                          style={{ width: `${widthPct}%` }}
                          className="h-full flex rounded-full overflow-hidden"
                        >
                          {DIFF_ORDER.map((dk) => {
                            const c = it.diff[dk] || 0;
                            if (c === 0) return null;
                            return (
                              <div
                                key={dk}
                                style={{ width: `${(c / it.count) * 100}%` }}
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

          <EditorialQuestionList
            key={listResetKey}
            mode="thinking"
            scopeTitle={scopeTitle}
            thkIds={scopedThkItems.map((t) => t.category_id)}
            countFilter={countFilter}
            onJumpToTaxonomy={onJumpToCurriculum}
          />
        </div>
      </div>
    </div>
  );
}
