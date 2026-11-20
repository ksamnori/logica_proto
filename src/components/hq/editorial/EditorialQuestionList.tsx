// src/components/hq/editorial/EditorialQuestionList.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { hqFetch } from "@/lib/hq/clientApi";
import type {
  DifficultyKey,
  EditorialCountFilter,
  EditorialQuestionsPayload,
} from "@/lib/hq/editorialTypes";
import {
  DIFF_ORDER,
  DIFF_STYLE,
  formatQuestionNumberLabel,
  PROBLEM_TYPE_LABEL,
  renderEditorialMathHtml,
  resolveQuestionImageUrl,
  typesetEditorialElement,
} from "./editorialUiUtils";

interface EditorialQuestionListProps {
  mode: "curriculum" | "thinking";
  scopeTitle: string;
  categoryIds?: string[];
  itemIds?: string[];
  directOnly?: boolean;
  thkIds?: string[];
  countFilter: EditorialCountFilter;
  onJumpToTaxonomy?: (taxonomyId: string) => void;
}

const COG_OPTIONS = ["ALL", "이해 및 연산", "적용 및 응용", "추론 및 문제 해결"];

export default function EditorialQuestionList({
  mode,
  scopeTitle,
  categoryIds = [],
  itemIds = [],
  directOnly = false,
  thkIds = [],
  countFilter,
  onJumpToTaxonomy,
}: EditorialQuestionListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [difficulty, setDifficulty] = useState<string>("ALL");
  const [cognitiveLevel, setCognitiveLevel] = useState<string>("ALL");
  const [bookName, setBookName] = useState<string>("ALL");
  const [keywordInput, setKeywordInput] = useState<string>("");
  const [appliedKeyword, setAppliedKeyword] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const hasTarget =
    mode === "curriculum"
      ? categoryIds.length > 0 || itemIds.length > 0
      : thkIds.length > 0;

  const [loading, setLoading] = useState<boolean>(hasTarget);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<EditorialQuestionsPayload | null>(null);

  const catKey = categoryIds.join(",");
  const itemKey = itemIds.join(",");
  const thkKey = thkIds.join(",");

  useEffect(() => {
    if (!hasTarget) return;
    let cancelled = false;

    const run = async () => {
      try {
        const qs = new URLSearchParams({
          action: "questions",
          mode,
          includeDerived: String(countFilter.includeDerived),
          includeSubTaxonomy: String(countFilter.includeSubTaxonomy),
          curriculum: countFilter.curriculum,
          difficulty,
          cognitiveLevel,
          bookName,
          keyword: appliedKeyword,
          page: String(page),
          pageSize: "15",
        });
        if (catKey) qs.set("categoryIds", catKey);
        if (itemKey) qs.set("itemIds", itemKey);
        if (directOnly) qs.set("directOnly", "true");
        if (thkKey) qs.set("thkIds", thkKey);

        const res = await hqFetch<{
          success: boolean;
          data: EditorialQuestionsPayload;
        }>(`/api/hq/editorial?${qs.toString()}`);

        if (!cancelled) {
          setPayload(res.data);
          setError(null);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          const msg =
            e instanceof Error ? e.message : "문항 목록을 불러오지 못했습니다.";
          setError(msg);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    hasTarget,
    mode,
    catKey,
    itemKey,
    directOnly,
    thkKey,
    countFilter.includeDerived,
    countFilter.includeSubTaxonomy,
    countFilter.curriculum,
    difficulty,
    cognitiveLevel,
    bookName,
    appliedKeyword,
    page,
  ]);

  useEffect(() => {
    if (containerRef.current && payload && payload.questions.length > 0) {
      typesetEditorialElement(containerRef.current);
    }
  }, [payload, expandedIds]);

  const toggleExpand = (qid: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  };

  const expandAllOnPage = () => {
    if (!payload) return;
    if (expandedIds.size >= payload.questions.length) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(payload.questions.map((q) => q.question_id)));
    }
  };

  const totalBaseCount = payload
    ? DIFF_ORDER.reduce((acc, k) => acc + (payload.diffBreakdown[k] || 0), 0)
    : 0;
  const totalPages = payload
    ? Math.max(1, Math.ceil(payload.total / payload.pageSize))
    : 1;

  return (
    <div
      ref={containerRef}
      className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"
    >
      {/* 헤더 + 난이도/출전교재 분포 브리핑 */}
      <div className="p-4 border-b border-slate-200 bg-slate-50/70 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base">📝</span>
            <h3 className="text-sm font-extrabold text-slate-900 truncate">
              보유 문항 원문 확인 — {scopeTitle}
            </h3>
            {payload && (
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-600 text-white text-xs font-extrabold shrink-0">
                {payload.total.toLocaleString()}문항
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {payload && payload.questions.length > 0 && (
              <button
                type="button"
                onClick={expandAllOnPage}
                className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-bold text-slate-700"
              >
                {expandedIds.size >= payload.questions.length
                  ? "해설 전체 접기"
                  : "현재 페이지 정답·해설 모두 펼치기"}
              </button>
            )}
          </div>
        </div>

        {/* 난이도 스택 바 & 클릭 필터 */}
        {payload && totalBaseCount > 0 && (
          <div className="space-y-1.5">
            <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden flex">
              {DIFF_ORDER.map((dk) => {
                const cnt = payload.diffBreakdown[dk] || 0;
                if (cnt === 0) return null;
                const pct = (cnt / totalBaseCount) * 100;
                return (
                  <div
                    key={dk}
                    style={{ width: `${pct}%` }}
                    title={`${dk}: ${cnt}문항 (${Math.round(pct)}%)`}
                    className={`${DIFF_STYLE[dk].bar} transition-all`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  setDifficulty("ALL");
                  setPage(1);
                }}
                className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-colors ${
                  difficulty === "ALL"
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                }`}
              >
                전체 난이도 ({totalBaseCount})
              </button>
              {DIFF_ORDER.map((dk) => {
                const cnt = payload.diffBreakdown[dk] || 0;
                if (cnt === 0) return null;
                const active = difficulty === dk;
                return (
                  <button
                    key={dk}
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      setDifficulty(active ? "ALL" : dk);
                      setPage(1);
                    }}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-colors ${
                      active
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : `${DIFF_STYLE[dk].bg} ${DIFF_STYLE[dk].text} border-slate-200 hover:opacity-80`
                    }`}
                  >
                    {dk} {cnt}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 출전 교재 빠른 필터 칩 */}
        {payload && payload.bookBreakdown.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 custom-scroll">
            <span className="text-[11px] font-bold text-slate-500 shrink-0">출전 교재:</span>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setBookName("ALL");
                setPage(1);
              }}
              className={`px-2 py-0.5 rounded-md text-[11px] font-bold shrink-0 border ${
                bookName === "ALL"
                  ? "bg-slate-800 text-white border-slate-800"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
              }`}
            >
              전체
            </button>
            {payload.bookBreakdown.slice(0, 12).map((b) => {
              const active = bookName === b.name;
              return (
                <button
                  key={b.name}
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setBookName(active ? "ALL" : b.name);
                    setPage(1);
                  }}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold shrink-0 border transition-colors ${
                    active
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-indigo-50"
                  }`}
                >
                  {b.name} <span className="opacity-70">({b.count})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 인지영역 + 키워드 검색 바 */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={cognitiveLevel}
            onChange={(e) => {
              setLoading(true);
              setCognitiveLevel(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700"
          >
            {COG_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt === "ALL" ? "인지영역 전체" : opt}
              </option>
            ))}
          </select>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setLoading(true);
              setAppliedKeyword(keywordInput.trim());
              setPage(1);
            }}
            className="flex-1 min-w-[200px] flex items-center gap-1.5"
          >
            <input
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              placeholder="이 범위 내 문항 본문 · 교재명 · 분류코드 검색..."
              className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold shrink-0"
            >
              검색
            </button>
            {appliedKeyword && (
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  setKeywordInput("");
                  setAppliedKeyword("");
                  setPage(1);
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-500 hover:text-slate-800"
              >
                초기화
              </button>
            )}
          </form>
        </div>
      </div>

      {/* 본문 문항 카드 목록 */}
      <div className="p-4 space-y-3">
        {loading && (
          <div className="py-12 text-center text-xs font-bold text-slate-500">
            문항 데이터를 불러오는 중입니다...
          </div>
        )}

        {!loading && error && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
            {error}
          </div>
        )}

        {!loading && (!hasTarget || (payload && payload.questions.length === 0)) && !error && (
          <div className="py-12 text-center space-y-2">
            <div className="text-2xl">📭</div>
            <div className="text-sm font-extrabold text-slate-700">
              이 분류 조건에 보유 중인 문항이 없습니다.
            </div>
            <div className="text-xs text-slate-500">
              신규 교재 집필 시 우선 출제·보강 후보로 활용할 수 있는 공백 구간입니다.
            </div>
          </div>
        )}

        {!loading &&
          !error &&
          payload &&
          payload.questions.map((q) => {
            const isExpanded = expandedIds.has(q.question_id);
            const diffKey = (DIFF_ORDER.includes(q.difficulty as DifficultyKey)
              ? q.difficulty
              : "미지정") as DifficultyKey;
            const dStyle = DIFF_STYLE[diffKey];
            const img1 = resolveQuestionImageUrl(q.image_url);
            const img2 = resolveQuestionImageUrl(q.image_2_url);
            const ansImg1 = resolveQuestionImageUrl(q.answer_image_url);
            const ansImg2 = resolveQuestionImageUrl(q.answer_image_2_url);
            const isDerived = Boolean(
              q.parent_question_id ||
                (q.derivation_type &&
                  ["TWIN", "유사", "쌍둥이"].some((k) =>
                    String(q.derivation_type).toUpperCase().includes(k)
                  ))
            );
            const displayBook =
              q.book_name || q.source_book_name || q.pdf_source || "출전 미기재";
            const optList = Array.isArray(q.options)
              ? (q.options as unknown[])
              : [];

            return (
              <div
                key={q.question_id}
                className="rounded-xl border border-slate-200 hover:border-indigo-300 bg-white transition-all overflow-hidden"
              >
                <div className="px-3.5 py-2.5 bg-slate-50/80 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-[11px] font-extrabold">
                      #{formatQuestionNumberLabel(q.question_number, q.sub_num, q.sub_sub_num)}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-bold">
                      📖 {displayBook}
                      {q.final_printed_page ? ` · p.${q.final_printed_page}` : ""}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${dStyle.bg} ${dStyle.text}`}
                    >
                      난이도 {diffKey}
                      {q.solving_probability ? ` (${q.solving_probability}%)` : ""}
                    </span>
                    {q.cognitive_level && (
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-bold">
                        {q.cognitive_level}
                      </span>
                    )}
                    {q.problem_type && (
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-semibold">
                        {PROBLEM_TYPE_LABEL[q.problem_type] || q.problem_type}
                      </span>
                    )}
                    {isDerived && (
                      <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-bold">
                        파생({q.derivation_type || "TWIN"})
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {q.taxonomy_id && (
                      <button
                        type="button"
                        onClick={() => onJumpToTaxonomy?.(q.taxonomy_id!)}
                        title={q.resolved_full_path || q.taxonomy_name || q.taxonomy_id}
                        className="px-2 py-0.5 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-mono font-bold"
                      >
                        {q.taxonomy_id}
                      </button>
                    )}
                    {q.thk_taxonomy_id && (
                      <span
                        title={q.thk_taxonomy_name || q.thk_taxonomy_id}
                        className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold"
                      >
                        🧠 {q.thk_taxonomy_id}
                      </span>
                    )}
                  </div>
                </div>

                {(q.resolved_full_path || q.resolved_depth8) && (
                  <div className="px-3.5 py-1.5 bg-slate-50/40 border-b border-slate-100 text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">
                    <span className="truncate">{q.resolved_full_path}</span>
                    {q.resolved_depth8 && (
                      <span className="font-bold text-indigo-700">
                        ▸ [Depth 8] {q.resolved_depth8}
                      </span>
                    )}
                  </div>
                )}

                <div className="p-4 space-y-3">
                  <div
                    className="text-[13.5px] leading-relaxed text-slate-900 font-medium"
                    dangerouslySetInnerHTML={{
                      __html: renderEditorialMathHtml(q.question),
                    }}
                  />
                  {q.question_2 && (
                    <div
                      className="text-[13px] leading-relaxed text-slate-700 p-3 rounded-lg bg-slate-50 border border-slate-200"
                      dangerouslySetInnerHTML={{
                        __html: renderEditorialMathHtml(q.question_2),
                      }}
                    />
                  )}

                  {(img1 || img2) && (
                    <div className="flex flex-wrap gap-3 pt-1">
                      {img1 && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={img1}
                          alt="문항 그림 1"
                          loading="lazy"
                          className="max-h-56 max-w-full object-contain rounded-lg border border-slate-200 bg-white p-2"
                        />
                      )}
                      {img2 && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={img2}
                          alt="문항 그림 2"
                          loading="lazy"
                          className="max-h-56 max-w-full object-contain rounded-lg border border-slate-200 bg-white p-2"
                        />
                      )}
                    </div>
                  )}

                  {optList.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                      {optList.map((opt, idx) => (
                        <div
                          key={idx}
                          className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800"
                          dangerouslySetInnerHTML={{
                            __html: `${idx + 1}) ${renderEditorialMathHtml(
                              typeof opt === "string" ? opt : JSON.stringify(opt)
                            )}`,
                          }}
                        />
                      ))}
                    </div>
                  )}

                  <div className="pt-1 flex items-center justify-between border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => toggleExpand(q.question_id)}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 pt-1.5"
                    >
                      <span>{isExpanded ? "▾ 정답 · 해설 접기" : "▸ 정답 · 4단계 해설 보기"}</span>
                    </button>
                    <span className="text-[10px] text-slate-400 font-mono pt-1.5">
                      ID: {q.question_id.slice(0, 8)}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="mt-2 p-3.5 rounded-xl bg-indigo-50/50 border border-indigo-100 space-y-2.5 text-xs">
                      <div className="flex items-start gap-2">
                        <span className="px-2 py-0.5 rounded bg-indigo-600 text-white font-extrabold shrink-0">
                          정답
                        </span>
                        <div
                          className="font-extrabold text-indigo-950 text-sm"
                          dangerouslySetInnerHTML={{
                            __html:
                              renderEditorialMathHtml(q.answer) ||
                              '<span class="text-slate-400 font-normal">(미입력)</span>',
                          }}
                        />
                      </div>

                      {q.step_1_concept ||
                      q.step_2_approach ||
                      q.step_3_process ||
                      q.step_4_conclusion ? (
                        <div className="space-y-1.5 pt-1 text-slate-800">
                          {q.step_1_concept && (
                            <div>
                              <span className="font-extrabold text-indigo-700 mr-1.5">
                                [1. 핵심 개념]
                              </span>
                              <span
                                dangerouslySetInnerHTML={{
                                  __html: renderEditorialMathHtml(q.step_1_concept),
                                }}
                              />
                            </div>
                          )}
                          {q.step_2_approach && (
                            <div>
                              <span className="font-extrabold text-indigo-700 mr-1.5">
                                [2. 풀이 전략]
                              </span>
                              <span
                                dangerouslySetInnerHTML={{
                                  __html: renderEditorialMathHtml(q.step_2_approach),
                                }}
                              />
                            </div>
                          )}
                          {q.step_3_process && (
                            <div>
                              <span className="font-extrabold text-indigo-700 mr-1.5">
                                [3. 풀이 과정]
                              </span>
                              <span
                                dangerouslySetInnerHTML={{
                                  __html: renderEditorialMathHtml(q.step_3_process),
                                }}
                              />
                            </div>
                          )}
                          {q.step_4_conclusion && (
                            <div>
                              <span className="font-extrabold text-indigo-700 mr-1.5">
                                [4. 최종 결론]
                              </span>
                              <span
                                dangerouslySetInnerHTML={{
                                  __html: renderEditorialMathHtml(q.step_4_conclusion),
                                }}
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        (q.solution || q.explanation) && (
                          <div
                            className="text-slate-800 leading-relaxed"
                            dangerouslySetInnerHTML={{
                              __html: renderEditorialMathHtml(q.solution || q.explanation),
                            }}
                          />
                        )
                      )}

                      {(ansImg1 || ansImg2) && (
                        <div className="flex flex-wrap gap-3 pt-1">
                          {ansImg1 && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={ansImg1}
                              alt="해설 그림 1"
                              loading="lazy"
                              className="max-h-48 object-contain rounded-lg border border-slate-200 bg-white p-1.5"
                            />
                          )}
                          {ansImg2 && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={ansImg2}
                              alt="해설 그림 2"
                              loading="lazy"
                              className="max-h-48 object-contain rounded-lg border border-slate-200 bg-white p-1.5"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {payload && payload.total > payload.pageSize && (
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-xs font-bold text-slate-600">
            총 {payload.total.toLocaleString()}문항 중{" "}
            {((page - 1) * payload.pageSize + 1).toLocaleString()}–
            {Math.min(page * payload.pageSize, payload.total).toLocaleString()}번째 표시
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => {
                setLoading(true);
                setPage((p) => Math.max(1, p - 1));
              }}
              className="px-3 py-1 rounded-lg border border-slate-300 bg-white disabled:opacity-40 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              이전
            </button>
            <span className="px-2.5 text-xs font-extrabold text-slate-800">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => {
                setLoading(true);
                setPage((p) => Math.min(totalPages, p + 1));
              }}
              className="px-3 py-1 rounded-lg border border-slate-300 bg-white disabled:opacity-40 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
