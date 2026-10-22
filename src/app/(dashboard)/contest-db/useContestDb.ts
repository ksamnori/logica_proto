// src/app/(dashboard)/contest-db/useContestDb.ts
"use client";

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  CONTEST_TABLE,
  LIST_COLUMNS,
  PAGE_SIZE,
  EMPTY_FILTERS,
  type ViewMode,
  type ContestAccessLevel,
  type ContestFilters,
  type ContestListItem,
  type ContestProblem,
} from "./contestUtils";

/** 로그인한 사람의 문제 DB 열람 권한을 DB 허용 명단에서 조회 (학원·출판사 포털 공통) */
/**
 * 지금 Supabase 로그인 세션이 살아 있는지 (만료됐으면 getSession 이 자동으로 갱신을 시도함).
 * 세션 없이 권한 함수를 부르면 비로그인(anon) 요청이 되어 DB 로그에 권한 오류가 쌓이므로 먼저 확인.
 */
export async function hasSupabaseSession(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  return Boolean(session?.access_token);
}

export async function fetchContestAccess(): Promise<ContestAccessLevel> {
  if (!(await hasSupabaseSession())) return null;
  const { data, error } = await supabase.rpc("contest_access_level");
  if (error) {
    console.warn("문제 DB 권한 조회 실패:", error.message);
    return null;
  }
  return data === "all" || data === "word" ? data : null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

async function callContestApi(body: Record<string, unknown>) {
  const res = await fetch("/api/contest-db", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ success: false, error: `서버 응답 오류 (${res.status})` }));
  if (!res.ok || !json.success) throw new Error(json.error || `요청 실패 (${res.status})`);
  return json.data as { problem_ko: string | null; solutions_ko: string[] };
}

export function useContestDb() {
  const [mode, setMode] = useState<ViewMode>("word");
  const [filters, setFilters] = useState<ContestFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<ContestListItem[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [isListLoading, setIsListLoading] = useState(false);
  const [listMessage, setListMessage] = useState("조회 대기");

  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [detail, setDetail] = useState<ContestProblem | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const batchCancelRef = useRef(false);
  const detailReqRef = useRef(0);

  const loadDetail = useCallback(async (list: ContestListItem[], index: number) => {
    if (index < 0 || index >= list.length) return;
    setSelectedIndex(index);
    setIsDetailLoading(true);
    const reqId = ++detailReqRef.current;

    const { data, error } = await supabase.from(CONTEST_TABLE).select("*").eq("id", list[index].id).single();
    if (reqId !== detailReqRef.current) return; // 그 사이 다른 문항을 눌렀으면 버림
    setIsDetailLoading(false);
    if (error || !data) {
      setDetail(null);
      alert("문항을 불러오지 못했습니다: " + (error?.message || ""));
      return;
    }
    setDetail(data as ContestProblem);
  }, []);

  const search = useCallback(async (nextPage: number, f: ContestFilters = filters, m: ViewMode = mode) => {
    // 디스크 IO 보호: 전체 문제 탭의 본문 검색(ILIKE)은 인덱스를 못 타므로 범위를 좁힌 뒤에만 허용
    if (m === "all" && f.text && !f.dataset && !f.competition && !f.topic && !f.keyword && !f.onlyFigure) {
      alert("전체 문제에서 본문 검색을 하려면 데이터셋, 출처, 단원, 핵심 키워드 중 하나를 먼저 골라 주세요.\n(92만 문항 본문을 전부 훑으면 학원 프로그램까지 느려질 수 있습니다)");
      return;
    }

    const pageNo = Math.max(0, nextPage);
    setIsListLoading(true);
    setListMessage("조회 중...");

    // count 옵션은 전체 스캔을 유발하므로 쓰지 않고, 51개를 받아 다음 페이지 유무만 판단
    const from = pageNo * PAGE_SIZE;
    let data: unknown[] | null = null;
    let error: { message: string } | null = null;

    if (m === "word") {
      // 문장제 탭: DB 함수(search_word_problems)로 조회.
      // 키워드·단원 조건이 있을 때 GIN 인덱스로 맞는 문항만 먼저 모은 뒤 정렬하도록 강제해서 빠름
      ({ data, error } = await supabase.rpc("search_word_problems", {
        p_keyword: f.keyword || null,
        p_topic: f.topic || null,
        p_has_ko: f.koStatus ? f.koStatus === "true" : null,
        p_text: f.text || null,
        p_offset: from,
        p_limit: PAGE_SIZE + 1,
      }));
    } else {
      // 전체 문제 탭: 정렬하면 조건에 맞는 수십만 행을 모두 정렬해야 해서 정렬 없이 앞에서부터 읽음
      let query = supabase.from(CONTEST_TABLE).select(LIST_COLUMNS);
      if (f.dataset) query = query.eq("source_dataset", f.dataset);
      if (f.competition) query = query.eq("competition", f.competition);
      if (f.country) query = query.eq("country", f.country);
      if (f.questionType) query = query.eq("question_type_ko", f.questionType);
      if (f.onlyFigure) query = query.eq("has_figure", true);
      if (f.koStatus) query = query.eq("has_ko", f.koStatus === "true");
      if (f.topic) query = query.contains("topics_ko", JSON.stringify([f.topic]));
      if (f.keyword) query = query.contains("keywords_ko", JSON.stringify([f.keyword]));
      if (f.text) {
        const isHangul = /[가-힣]/.test(f.text);
        query = query.ilike(isHangul ? "problem_ko" : "problem_en", `%${f.text}%`);
      }
      ({ data, error } = await query.range(from, from + PAGE_SIZE));
    }
    setIsListLoading(false);

    if (error) {
      setListMessage("조회 오류");
      alert("조회 오류: " + error.message);
      return;
    }

    const rows = (data || []) as unknown as ContestListItem[];
    const next = rows.length > PAGE_SIZE;
    const list = next ? rows.slice(0, PAGE_SIZE) : rows;
    setItems(list);
    setHasNext(next);
    setPage(pageNo);
    setListMessage(list.length ? `${(from + 1).toLocaleString()} ~ ${(from + list.length).toLocaleString()}번${next ? " (다음 있음)" : ""}` : "조건에 맞는 문항 없음");

    if (list.length) {
      await loadDetail(list, 0);
    } else {
      setSelectedIndex(-1);
      setDetail(null);
    }
  }, [filters, mode, loadDetail]);

  /** 탭 전환: 필터를 비우고 새 탭 기준으로 다시 조회 */
  const switchMode = useCallback((m: ViewMode) => {
    setMode(m);
    setFilters(EMPTY_FILTERS);
    search(0, EMPTY_FILTERS, m);
  }, [search]);

  const selectProblem = useCallback((index: number) => loadDetail(items, index), [items, loadDetail]);

  const applySaved = (id: string, saved: { problem_ko: string | null; solutions_ko: string[] }) => {
    const hasKo = Boolean(saved.problem_ko);
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, has_ko: hasKo, problem_ko: saved.problem_ko } : it)));
    setDetail((prev) => (prev && prev.id === id ? { ...prev, ...saved, has_ko: hasKo } : prev));
  };

  /** 한 문항 AI 번역 → 서버에서 DB 저장까지 처리 */
  const translateOne = useCallback(async (id: string) => {
    setTranslatingId(id);
    try {
      applySaved(id, await callContestApi({ action: "translate", id }));
    } finally {
      setTranslatingId(null);
    }
  }, []);

  /** 직접 수정한 한국어를 저장 */
  const saveManual = useCallback(async (id: string, problemKo: string, solutionsKo: string[]) => {
    applySaved(id, await callContestApi({ action: "save", id, problem_ko: problemKo, solutions_ko: solutionsKo }));
  }, []);

  /** 현재 목록의 미번역 문항을 차례로 번역 (이 화면을 열어 둔 동안만 진행됨) */
  const translateBatch = useCallback(async () => {
    const targets = items.filter((it) => !it.has_ko);
    if (!targets.length) {
      alert("현재 목록의 문항은 모두 한국어가 있습니다.");
      return;
    }
    if (!confirm(`현재 목록의 미번역 문항 ${targets.length}개를 차례로 번역해 저장할까요?\n진행 중에는 이 화면을 닫지 마세요.`)) return;

    batchCancelRef.current = false;
    setBatchProgress({ done: 0, total: targets.length });
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      if (batchCancelRef.current) break;
      try {
        await translateOne(targets[i].id);
      } catch (e: any) {
        failed++;
        console.error("일괄 번역 실패:", targets[i].id, e);
        if (/429|quota|rate/i.test(String(e?.message))) {
          alert("AI 사용량 한도에 걸려 일괄 번역을 멈춥니다. 잠시 후 다시 시도해 주세요.");
          break;
        }
      }
      setBatchProgress({ done: i + 1, total: targets.length });
    }
    setBatchProgress(null);
    alert(batchCancelRef.current ? "일괄 번역을 중단했습니다." : `일괄 번역 완료${failed ? ` (실패 ${failed}건)` : ""}`);
  }, [items, translateOne]);

  const cancelBatch = () => { batchCancelRef.current = true; };

  return {
    mode, switchMode,
    filters, setFilters, page, items, hasNext, isListLoading, listMessage,
    selectedIndex, detail, isDetailLoading,
    translatingId, batchProgress,
    search, selectProblem, translateOne, saveManual, translateBatch, cancelBatch,
  };
}
