// src/app/(dashboard)/competency-mapper/page.tsx
// 유형(depth7, 초1·2는 depth6) 단위 교과 역량 매핑 도구
// - AI 1차 매핑 → AI 2차 검증(재판정 후 비교) → 선생님 검수·확정
// - 표본 검증: 선생님이 AI 결과를 보지 않고 먼저 정한 뒤 일치율 확인
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const COMPS = ["문제해결", "추론", "의사소통", "연결", "정보처리"] as const;
type Comp = typeof COMPS[number];
const COMP_COLOR: Record<Comp, string> = {
  "문제해결": "bg-blue-600",
  "추론": "bg-violet-600",
  "의사소통": "bg-emerald-600",
  "연결": "bg-amber-500",
  "정보처리": "bg-rose-500",
};
const COGNITIVE_LEVELS = ["이해 및 연산", "적용 및 응용", "추론 및 문제 해결"];
const COG_SHORT: Record<string, string> = { "이해 및 연산": "이해", "적용 및 응용": "적용", "추론 및 문제 해결": "추론" };

const BATCH_SIZE = 20;
const REVIEW_CONF = 0.6;     // 이 값 미만이면 검수 필요
const BULK_CONF = 0.8;       // 일괄 확정 기준
const SAMPLE_SIZE = 100;
const PAGE_SIZE = 40;

type Cat = {
  category_id: string; curriculum_version: string;
  depth1: string; depth2: string; depth3?: string; depth4?: string; depth5?: string; depth6?: string; depth7?: string;
};
type CompRow = {
  category_id: string;
  ai_primary?: Comp | null; ai_secondary?: Comp | null; ai_confidence?: number | null; ai_reason?: string | null;
  ai_model?: string | null; ai_mapped_at?: string | null;
  ai_run2_primary?: Comp | null; ai_run2_secondary?: Comp | null; ai_run2_confidence?: number | null; ai_run2_at?: string | null;
  final_primary?: Comp | null; final_secondary?: Comp | null; reviewed_by?: string | null; reviewed_at?: string | null;
  status?: string; is_sample?: boolean; question_count?: number;
};
type QStat = { count: number; cognitive: Record<string, number>; qids: string[] };
type Tab = "all" | "pending" | "review" | "ai_done" | "confirmed" | "sample";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  PENDING: { text: "미처리", cls: "bg-slate-100 text-slate-500" },
  AI_DONE: { text: "AI 판정", cls: "bg-blue-50 text-blue-700" },
  NEEDS_REVIEW: { text: "검수 필요", cls: "bg-amber-50 text-amber-700" },
  CONFIRMED: { text: "확정", cls: "bg-emerald-50 text-emerald-700" },
};

// 페이지 단위로 전부 읽기 (정렬 고정)
async function fetchAll(table: string, select: string, orderCol: string) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).order(orderCol, { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const leafName = (c: Cat) => c.depth7 || c.depth6 || c.depth5 || c.depth4 || "(이름 없음)";
const parentPath = (c: Cat) => [c.depth1, c.depth2, c.depth3, c.depth4, c.depth5, c.depth7 ? c.depth6 : null].filter(Boolean).join(" > ");
const fullPath = (c: Cat) => [c.depth1, c.depth2, c.depth3, c.depth4, c.depth5, c.depth6, c.depth7].filter(Boolean).join(" > ");
const effPrimary = (r?: CompRow) => (r?.final_primary || r?.ai_primary || null) as Comp | null;

// AI 결과로 상태 계산 (확정된 행은 유지)
function computeStatus(r: CompRow): string {
  if (r.status === "CONFIRMED") return "CONFIRMED";
  if (!r.ai_primary) return "PENDING";
  const lowConf = (r.ai_confidence ?? 0) < REVIEW_CONF || (r.ai_run2_primary != null && (r.ai_run2_confidence ?? 0) < REVIEW_CONF);
  const mismatch = r.ai_run2_primary != null && r.ai_run2_primary !== r.ai_primary;
  return lowConf || mismatch ? "NEEDS_REVIEW" : "AI_DONE";
}

export default function CompetencyMapperPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [loadingText, setLoadingText] = useState("");
  const [loadError, setLoadError] = useState("");
  const [categories, setCategories] = useState<Cat[]>([]);
  const [compMap, setCompMap] = useState<Record<string, CompRow>>({});
  const [qStats, setQStats] = useState<Record<string, QStat>>({});

  const [curriculum, setCurriculum] = useState<"all" | "2022" | "2015">("all");
  const [school, setSchool] = useState("all");
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [onlyWithQuestions, setOnlyWithQuestions] = useState(true);
  const [page, setPage] = useState(1);

  const [drafts, setDrafts] = useState<Record<string, { p: Comp | null; s: Comp | null }>>({});
  const [running, setRunning] = useState<null | "run1" | "run2" | "redo">(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0, startedAt: 0 });
  const stopRef = useRef(false);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  // ---------- 권한 ----------
  useEffect(() => {
    const check = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";
      if (!role || !tId) { alert("로그인 정보가 없습니다."); router.replace("/home"); return; }
      if (role === "SUPER_ADMIN") { setIsAuthorized(true); return; }
      const { data } = await supabase.from("tenant_role_permissions").select("allowed_menus").eq("tenant_id", tId).eq("role_name", role).maybeSingle();
      if (data && (data.allowed_menus.includes("ALL") || data.allowed_menus.includes("/competency-mapper"))) setIsAuthorized(true);
      else { alert("⛔ 교과 역량 매핑 도구에 접근할 권한이 없습니다. 권한 관리 페이지에서 허용해주세요."); router.replace("/home"); }
    };
    check();
  }, [router]);

  // ---------- 데이터 로드 ----------
  const loadAll = async () => {
    setLoadError("");
    try {
      setLoadingText("분류표(depth7)를 불러오는 중...");
      const cats = await fetchAll("master_category", "category_id, curriculum_version, depth1, depth2, depth3, depth4, depth5, depth6, depth7", "category_id");

      setLoadingText("depth8 항목 연결 정보를 불러오는 중...");
      const items = await fetchAll("master_item", "item_id, category_id", "item_id");
      const itemToCat = new Map<string, string>();
      items.forEach((i: any) => itemToCat.set(i.item_id, i.category_id));
      const catSet = new Set(cats.map((c: any) => c.category_id));

      setLoadingText("문항별 분류와 사고 수준을 집계하는 중...");
      const qs = await fetchAll("question_db", "question_id, taxonomy_id, cognitive_level", "question_id");
      const stats: Record<string, QStat> = {};
      qs.forEach((q: any) => {
        const tax = q.taxonomy_id;
        if (!tax || tax === "미분류") return;
        const catId = itemToCat.get(tax) || (catSet.has(tax) ? tax : null);
        if (!catId) return;
        if (!stats[catId]) stats[catId] = { count: 0, cognitive: {}, qids: [] };
        const s = stats[catId];
        s.count++;
        const cog = COGNITIVE_LEVELS.includes(q.cognitive_level) ? q.cognitive_level : "미분류";
        s.cognitive[cog] = (s.cognitive[cog] || 0) + 1;
        s.qids.push(q.question_id);
      });

      setLoadingText("기존 역량 매핑 결과를 불러오는 중...");
      let comps: any[] = [];
      try { comps = await fetchAll("taxonomy_competency", "*", "category_id"); }
      catch (e: any) { throw new Error("taxonomy_competency 테이블이 없습니다. taxonomy_competency.sql을 먼저 실행해주세요. (" + e.message + ")"); }
      const cm: Record<string, CompRow> = {};
      comps.forEach((r: any) => { cm[r.category_id] = r; });

      setCategories(cats);
      setQStats(stats);
      setCompMap(cm);
      setLoadingText("");
    } catch (e: any) {
      setLoadingText("");
      setLoadError(e.message || String(e));
    }
  };

  useEffect(() => { if (isAuthorized) loadAll(); }, [isAuthorized]);

  // ---------- 필터 ----------
  const schoolOptions = useMemo(() => Array.from(new Set(categories.map(c => c.depth1).filter(Boolean))), [categories]);

  // 검색어: "대푯값|산포도|!함수" → 대푯값 또는 산포도를 포함하고, 함수는 포함하지 않는 유형
  const searchTerms = useMemo(() => {
    const parts = search.split("|").map(t => t.trim()).filter(Boolean);
    return {
      include: parts.filter(t => !t.startsWith("!")),
      exclude: parts.filter(t => t.startsWith("!")).map(t => t.slice(1).trim()).filter(Boolean),
    };
  }, [search]);

  const filtered = useMemo(() => {
    return categories.filter(c => {
      if (curriculum !== "all" && String(c.curriculum_version) !== curriculum) return false;
      if (school !== "all" && c.depth1 !== school) return false;
      if (onlyWithQuestions && !(qStats[c.category_id]?.count > 0)) return false;
      const r = compMap[c.category_id];
      const st = r?.status || "PENDING";
      if (tab === "pending" && st !== "PENDING") return false;
      if (tab === "review" && st !== "NEEDS_REVIEW") return false;
      if (tab === "ai_done" && st !== "AI_DONE") return false;
      if (tab === "confirmed" && st !== "CONFIRMED") return false;
      if (tab === "sample" && !r?.is_sample) return false;
      if (searchTerms.include.length || searchTerms.exclude.length) {
        const fp = fullPath(c);
        if (searchTerms.include.length && !searchTerms.include.some(t => fp.includes(t))) return false;
        if (searchTerms.exclude.some(t => fp.includes(t))) return false;
      }
      return true;
    });
  }, [categories, compMap, qStats, curriculum, school, tab, searchTerms, onlyWithQuestions]);

  useEffect(() => { setPage(1); }, [curriculum, school, tab, search, onlyWithQuestions]);

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // ---------- 요약 ----------
  const summary = useMemo(() => {
    const s = { total: categories.length, withQ: 0, pending: 0, aiDone: 0, review: 0, confirmed: 0, run2: 0 };
    const dist: Record<string, number> = {};
    categories.forEach(c => {
      if (qStats[c.category_id]?.count > 0) s.withQ++;
      const r = compMap[c.category_id];
      const st = r?.status || "PENDING";
      if (st === "PENDING") s.pending++;
      if (st === "AI_DONE") s.aiDone++;
      if (st === "NEEDS_REVIEW") s.review++;
      if (st === "CONFIRMED") s.confirmed++;
      if (r?.ai_run2_primary) s.run2++;
      const p = effPrimary(r);
      if (p) dist[p] = (dist[p] || 0) + 1;
    });
    const distTotal = Object.values(dist).reduce((a, b) => a + b, 0);

    // 표본 일치율: 선생님 확정값과 AI 1차 비교
    const samples = (Object.values(compMap) as CompRow[]).filter(r => r.is_sample);
    const comparable = samples.filter(r => r.final_primary && r.ai_primary);
    const exact = comparable.filter(r => r.final_primary === r.ai_primary).length;
    const loose = comparable.filter(r => r.final_primary === r.ai_primary || r.final_primary === r.ai_secondary).length;
    return { ...s, dist, distTotal, sampleCount: samples.length, sampleDone: samples.filter(r => r.final_primary).length, comparable: comparable.length, exact, loose };
  }, [categories, compMap, qStats]);

  // ---------- 저장 ----------
  const upsertRows = async (rows: CompRow[]) => {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map(r => ({ ...r, updated_at: new Date().toISOString() }));
      const { error } = await supabase.from("taxonomy_competency").upsert(chunk, { onConflict: "category_id" });
      if (error) throw new Error(error.message);
    }
    setCompMap(prev => {
      const next = { ...prev };
      rows.forEach(r => { next[r.category_id] = { ...(prev[r.category_id] || {}), ...r }; });
      return next;
    });
  };

  // ---------- AI 실행 ----------
  const pickSamples = (qids: string[]) => {
    if (qids.length <= 3) return qids;
    const sorted = [...qids].sort();
    return [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]];
  };

  const runAI = async (mode: "run1" | "run2" | "redo") => {
    const targets = filtered.filter(c => {
      const r = compMap[c.category_id];
      if (mode === "redo") return !!r?.ai_primary && r?.status !== "CONFIRMED";
      return mode === "run1" ? !r?.ai_primary : (!!r?.ai_primary && !r?.ai_run2_primary);
    });
    if (mode === "redo" && targets.length === 0) {
      alert("현재 조건에서 다시 판정할 유형이 없습니다. (AI 판정이 있고 아직 확정되지 않은 유형만 대상)");
      return;
    }
    if (targets.length === 0) {
      alert(mode === "run1" ? "현재 조건에서 AI 1차 매핑이 안 된 유형이 없습니다." : "현재 조건에서 2차 검증할 유형이 없습니다. (1차 매핑이 끝난 유형만 검증할 수 있습니다)");
      return;
    }
    const calls = Math.ceil(targets.length / BATCH_SIZE);
    if (mode === "redo" && !confirm(`현재 조건의 ${targets.length}개 유형을 지금 판정 기준으로 다시 판정합니다.\n\n- 기존 AI 1차 결과를 새 결과로 바꾸고, 2차 검증 결과는 지웁니다.\n- 선생님이 확정한 유형은 바꾸지 않습니다.\n\n계속할까요?`)) return;
    if (mode !== "redo" && !confirm(`${mode === "run1" ? "AI 1차 매핑" : "AI 2차 검증"}을 시작합니다.\n대상: ${targets.length}개 유형 (AI 호출 약 ${calls}회)\n\n중간에 [중지]로 멈출 수 있고, 처리된 결과는 바로 저장됩니다.`)) return;

    // 🔐 토큰은 묶음마다 새로 받는다. (Supabase 로그인 토큰은 약 1시간마다 바뀌어서, 처음 받은 토큰으로 끝까지 가면 도중에 만료됨)
    const getToken = async (forceRefresh = false): Promise<string | null> => {
      if (forceRefresh) {
        const { data, error } = await supabase.auth.refreshSession();
        if (error) return null;
        return data.session?.access_token || null;
      }
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || null;
    };
    if (!(await getToken())) { alert("로그인 세션이 만료되었습니다. 다시 로그인해주세요."); return; }
    let authExpired = false;

    stopRef.current = false;
    setRunning(mode);
    setProgress({ done: 0, total: targets.length, failed: 0, startedAt: Date.now() });

    // 2차는 순서를 섞어서 묶음 구성이 1차와 달라지게 한다
    const order = mode === "run2" ? [...targets].sort(() => Math.random() - 0.5) : targets;
    let done = 0, failed = 0;

    for (let i = 0; i < order.length; i += BATCH_SIZE) {
      if (stopRef.current) break;
      const batch = order.slice(i, i + BATCH_SIZE);

      try {
        // 대표 문항 본문
        const sampleIds = batch.flatMap(c => pickSamples(qStats[c.category_id]?.qids || []));
        const textMap = new Map<string, string>();
        if (sampleIds.length > 0) {
          const { data: qRows } = await supabase.from("question_db").select("question_id, question").in("question_id", sampleIds);
          (qRows || []).forEach((q: any) => textMap.set(q.question_id, q.question || ""));
        }

        const items = batch.map(c => {
          const st = qStats[c.category_id];
          return {
            category_id: c.category_id,
            path: `[${c.curriculum_version} 개정] ${fullPath(c)}`,
            cognitive: st?.cognitive || {},
            samples: pickSamples(st?.qids || []).map(id => textMap.get(id) || "").filter(Boolean),
          };
        });

        let res: any = null;
        let token = await getToken();
        for (let attempt = 0; attempt < 3; attempt++) {
          const r = await fetch("/api/gemini-competency", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ items, run: mode === "run2" ? 2 : 1 }),
          });
          res = await r.json().catch(() => null);
          if (res?.success) break;
          if (r.status === 401) {
            // 토큰 만료 → 한 번 갱신해서 다시 시도
            token = await getToken(true);
            if (!token) break;
            continue;
          }
          await new Promise(ok => setTimeout(ok, 1500));
        }
        if (!res?.success) {
          if (String(res?.error || "").startsWith("Unauthorized")) {
            authExpired = true;
            stopRef.current = true;
          }
          throw new Error(res?.error || "AI 응답 실패");
        }

        const byId = new Map<string, any>(res.data.map((d: any) => [d.category_id, d]));
        const now = new Date().toISOString();
        const rows: CompRow[] = [];
        batch.forEach(c => {
          const d = byId.get(c.category_id);
          if (!d) { failed++; return; }
          const prev = compMap[c.category_id] || { category_id: c.category_id, status: "PENDING" };
          const merged: CompRow = mode === "run1"
            ? { ...prev, category_id: c.category_id, ai_primary: d.primary, ai_secondary: d.secondary, ai_confidence: d.confidence, ai_reason: d.reason, ai_model: res.model, ai_mapped_at: now, question_count: qStats[c.category_id]?.count || 0 }
            : mode === "redo"
              ? { ...prev, category_id: c.category_id, ai_primary: d.primary, ai_secondary: d.secondary, ai_confidence: d.confidence, ai_reason: d.reason, ai_model: res.model, ai_mapped_at: now, question_count: qStats[c.category_id]?.count || 0,
                  ai_run2_primary: null, ai_run2_secondary: null, ai_run2_confidence: null, ai_run2_at: null }
              : { ...prev, category_id: c.category_id, ai_run2_primary: d.primary, ai_run2_secondary: d.secondary, ai_run2_confidence: d.confidence, ai_run2_at: now };
          merged.status = computeStatus(mode === "redo" ? { ...merged, status: "AI_DONE" } : merged);
          rows.push({
            category_id: c.category_id,
            ai_primary: merged.ai_primary ?? null, ai_secondary: merged.ai_secondary ?? null, ai_confidence: merged.ai_confidence ?? null,
            ai_reason: merged.ai_reason ?? null, ai_model: merged.ai_model ?? null, ai_mapped_at: merged.ai_mapped_at ?? null,
            ai_run2_primary: merged.ai_run2_primary ?? null, ai_run2_secondary: merged.ai_run2_secondary ?? null,
            ai_run2_confidence: merged.ai_run2_confidence ?? null, ai_run2_at: merged.ai_run2_at ?? null,
            status: merged.status, question_count: merged.question_count ?? (qStats[c.category_id]?.count || 0),
          });
        });
        if (rows.length > 0) await upsertRows(rows);
        done += rows.length;
      } catch (e: any) {
        console.warn("역량 매핑 묶음 실패:", e?.message || e);
        failed += batch.length;
      }
      setProgress(p => ({ ...p, done, failed }));
    }

    setRunning(null);
    const stopped = stopRef.current;
    if (authExpired) {
      alert(`로그인이 만료되어 멈췄습니다.\n저장: ${done}개\n\n다시 로그인한 뒤 같은 버튼을 누르면 남은 것부터 이어서 처리됩니다.`);
      return;
    }
    alert(`${stopped ? "중지되었습니다." : "완료되었습니다."}\n저장: ${done}개 / 실패: ${failed}개${failed > 0 ? "\n실패한 유형은 같은 버튼을 다시 누르면 이어서 처리됩니다." : ""}`);
  };

  // ---------- 검수 ----------
  const myId = () => localStorage.getItem("logica_instructor_id") || null;

  const confirmRow = async (catId: string) => {
    const r = compMap[catId];
    const d = drafts[catId];
    const p = d?.p ?? r?.final_primary ?? (r?.is_sample ? null : r?.ai_primary) ?? null;
    const s = d ? d.s : (r?.final_secondary ?? (r?.is_sample ? null : r?.ai_secondary) ?? null);
    if (!p) { alert("주 역량을 먼저 골라주세요."); return; }
    if (s && s === p) { alert("보조 역량은 주 역량과 달라야 합니다."); return; }
    try {
      await upsertRows([{ category_id: catId, final_primary: p, final_secondary: s, status: "CONFIRMED", reviewed_by: myId(), reviewed_at: new Date().toISOString(), question_count: qStats[catId]?.count || 0 }]);
      setDrafts(prev => { const n = { ...prev }; delete n[catId]; return n; });
    } catch (e: any) { alert("저장 실패: " + e.message); }
  };

  const unconfirmRow = async (catId: string) => {
    const r = compMap[catId];
    if (!r) return;
    const next: CompRow = { ...r, final_primary: null, final_secondary: null, status: "AI_DONE" };
    next.status = r.ai_primary ? computeStatus({ ...next, status: "AI_DONE" }) : "PENDING";
    try {
      await upsertRows([{ category_id: catId, final_primary: null, final_secondary: null, reviewed_by: null, reviewed_at: null, status: next.status }]);
    } catch (e: any) { alert("저장 실패: " + e.message); }
  };

  const bulkConfirm = async () => {
    const targets = filtered.filter(c => {
      const r = compMap[c.category_id];
      return r && r.status !== "CONFIRMED" && !r.is_sample && r.ai_primary && r.ai_run2_primary === r.ai_primary
        && (r.ai_confidence ?? 0) >= BULK_CONF && (r.ai_run2_confidence ?? 0) >= BULK_CONF;
    });
    if (targets.length === 0) { alert(`현재 조건에서 일괄 확정할 유형이 없습니다.\n(1차·2차 주 역량이 같고 두 확신도가 모두 ${BULK_CONF * 100}% 이상인 유형만 대상, 표본 제외)`); return; }
    if (!confirm(`${targets.length}개 유형을 AI 1차 결과대로 확정합니다.\n대상: 1차·2차 주 역량이 같고 확신도가 모두 ${BULK_CONF * 100}% 이상, 표본 제외\n\n계속할까요?`)) return;
    const now = new Date().toISOString();
    try {
      await upsertRows(targets.map(c => {
        const r = compMap[c.category_id];
        return { category_id: c.category_id, final_primary: r.ai_primary, final_secondary: r.ai_secondary ?? null, status: "CONFIRMED", reviewed_by: myId(), reviewed_at: now };
      }));
      showToast(`${targets.length}개 유형을 확정했습니다.`);
    } catch (e: any) { alert("일괄 확정 실패: " + e.message); }
  };

  const drawSamples = async () => {
    const pool = categories.filter(c => (qStats[c.category_id]?.count || 0) > 0 && !compMap[c.category_id]?.is_sample && compMap[c.category_id]?.status !== "CONFIRMED");
    if (pool.length === 0) { alert("표본으로 뽑을 수 있는 유형이 없습니다."); return; }
    const already = summary.sampleCount;
    if (!confirm(`${already > 0 ? `이미 표본 ${already}개가 있습니다. ` : ""}문항이 있는 유형 중 무작위로 ${Math.min(SAMPLE_SIZE, pool.length)}개를 표본으로 추가합니다.\n\n표본 탭에서는 AI 결과를 가린 채 선생님이 먼저 역량을 정합니다. 계속할까요?`)) return;
    const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE);
    try {
      await upsertRows(picked.map(c => ({
        category_id: c.category_id, is_sample: true,
        status: compMap[c.category_id]?.status || "PENDING", question_count: qStats[c.category_id]?.count || 0,
      })));
      setTab("sample");
      showToast(`표본 ${picked.length}개를 뽑았습니다.`);
    } catch (e: any) { alert("표본 저장 실패: " + e.message); }
  };

  // ---------- 렌더 ----------
  if (isAuthorized === null) return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;

  const elapsed = progress.startedAt ? (Date.now() - progress.startedAt) / 1000 : 0;
  const eta = progress.done > 0 ? Math.round((elapsed / progress.done) * (progress.total - progress.done - progress.failed)) : null;

  const CompChip = ({ v, active, onClick, small }: { v: Comp; active: boolean; onClick?: () => void; small?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`${small ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-xs"} rounded-md font-bold border transition-colors ${active ? `${COMP_COLOR[v]} text-white border-transparent` : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"} ${onClick ? "" : "cursor-default"}`}
    >{v}</button>
  );

  return (
    <div className="h-full overflow-y-auto">
    <div className="p-6 max-w-[1500px] mx-auto">
      {toast && <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-brand text-white text-sm font-bold px-5 py-2.5 rounded-xl shadow-lg">{toast}</div>}

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-brand">교과 역량 매핑</h1>
        <p className="text-sm text-slate-500 mt-1">
          유형(depth7, 초1·2는 depth6)마다 2022 개정 교과 역량을 정합니다. 월간 리포트의 역량 분석은 이 값을 씁니다.
          AI가 1차로 판정하고, 2차 검증에서 결과가 달라지거나 확신도가 낮은 유형만 선생님이 검수합니다.
        </p>
      </div>

      {loadingText && <div className="p-10 text-center font-bold text-slate-400">{loadingText}</div>}
      {loadError && (
        <div className="p-5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold">
          {loadError}
          <button onClick={loadAll} className="ml-3 underline">다시 불러오기</button>
        </div>
      )}

      {!loadingText && !loadError && (
        <>
          {/* 요약 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-bold text-slate-500 mb-2">진행 현황</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><div className="text-xl font-bold text-slate-800">{summary.total.toLocaleString()}</div><div className="text-xs text-slate-500">전체 유형</div></div>
                <div><div className="text-xl font-bold text-slate-800">{summary.withQ.toLocaleString()}</div><div className="text-xs text-slate-500">문항 있는 유형</div></div>
                <div><div className="text-xl font-bold text-slate-400">{summary.pending.toLocaleString()}</div><div className="text-xs text-slate-500">미처리</div></div>
                <div><div className="text-xl font-bold text-blue-700">{summary.aiDone.toLocaleString()}</div><div className="text-xs text-slate-500">AI 판정</div></div>
                <div><div className="text-xl font-bold text-amber-600">{summary.review.toLocaleString()}</div><div className="text-xs text-slate-500">검수 필요</div></div>
                <div><div className="text-xl font-bold text-emerald-600">{summary.confirmed.toLocaleString()}</div><div className="text-xs text-slate-500">확정</div></div>
              </div>
              <div className="text-xs text-slate-400 mt-2">2차 검증 완료: {summary.run2.toLocaleString()}개</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-bold text-slate-500 mb-2">주 역량 분포 (확정값 우선, 없으면 AI값)</div>
              {summary.distTotal === 0 ? <div className="text-sm text-slate-400 py-4">아직 매핑된 유형이 없습니다.</div> : (
                <div className="flex flex-col gap-1.5">
                  {COMPS.map(c => {
                    const n = summary.dist[c] || 0;
                    const pct = Math.round((n / summary.distTotal) * 100);
                    return (
                      <div key={c} className="flex items-center gap-2 text-xs">
                        <span className="w-14 font-bold text-slate-600">{c}</span>
                        <div className="flex-1 h-3 bg-slate-100 rounded"><div className={`h-3 rounded ${COMP_COLOR[c]}`} style={{ width: `${pct}%` }} /></div>
                        <span className="w-20 text-right text-slate-500 tabular-nums">{n.toLocaleString()} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-bold text-slate-500 mb-2">표본 일치율 (선생님 판단 vs AI 1차)</div>
              {summary.sampleCount === 0 ? (
                <div className="text-sm text-slate-500">
                  표본이 없습니다. 표본을 뽑아 선생님이 먼저 역량을 정하면, AI가 얼마나 일치하는지 확인할 수 있습니다.
                </div>
              ) : (
                <div className="text-sm text-slate-700">
                  <div>표본 {summary.sampleCount}개 중 선생님 판단 완료 {summary.sampleDone}개</div>
                  {summary.comparable === 0 ? (
                    <div className="text-slate-500 mt-1">비교할 수 있는 표본이 아직 없습니다. 표본 탭에서 선생님 판단과 AI 1차 매핑을 모두 진행해주세요.</div>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                      <div><div className="text-2xl font-bold text-brand">{Math.round((summary.exact / summary.comparable) * 100)}%</div><div className="text-xs text-slate-500">주 역량 일치 ({summary.exact}/{summary.comparable})</div></div>
                      <div><div className="text-2xl font-bold text-slate-600">{Math.round((summary.loose / summary.comparable) * 100)}%</div><div className="text-xs text-slate-500">AI 보조 역량까지 포함</div></div>
                    </div>
                  )}
                </div>
              )}
              <button onClick={drawSamples} disabled={!!running} className="mt-3 w-full text-xs font-bold py-2 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50">
                표본 {SAMPLE_SIZE}개 뽑기
              </button>
            </div>
          </div>

          {/* 필터 + 실행 */}
          <div className="sticky top-0 z-20 bg-white border border-slate-200 rounded-xl p-4 mb-4 flex flex-col gap-3 shadow-sm">
            <div className="flex flex-wrap gap-2 items-center">
              {([["all", "전체"], ["pending", "미처리"], ["review", "검수 필요"], ["ai_done", "AI 판정"], ["confirmed", "확정"], ["sample", "표본 검증"]] as [Tab, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${tab === k ? "bg-brand text-white border-brand" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>{label}</button>
              ))}
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <select value={curriculum} onChange={e => setCurriculum(e.target.value as any)} className="text-xs font-bold border border-slate-200 rounded-lg px-2 py-1.5">
                <option value="all">교육과정 전체</option>
                <option value="2022">2022 개정</option>
                <option value="2015">2015 개정</option>
              </select>
              <select value={school} onChange={e => setSchool(e.target.value)} className="text-xs font-bold border border-slate-200 rounded-lg px-2 py-1.5">
                <option value="all">학교급 전체</option>
                {schoolOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="예: 대푯값|산포도|!함수" title="| 는 '또는', ! 는 '제외'. 예: 대푯값|산포도|!함수" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-64" />
              <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                <input type="checkbox" checked={onlyWithQuestions} onChange={e => setOnlyWithQuestions(e.target.checked)} />
                문항 있는 유형만
              </label>
              <span className="ml-auto text-xs text-slate-500">현재 조건: <b className="text-slate-800">{filtered.length.toLocaleString()}</b>개</span>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={() => runAI("run1")} disabled={!!running} className="px-4 py-2 rounded-lg text-xs font-bold bg-brand text-white disabled:opacity-50">▶ AI 판정 시작 (1차 매핑)</button>
              <button onClick={() => runAI("run2")} disabled={!!running} className="px-4 py-2 rounded-lg text-xs font-bold bg-white text-brand border border-brand disabled:opacity-50">AI 2차 검증</button>
              <button onClick={() => runAI("redo")} disabled={!!running} title="현재 조건의 유형을 지금 판정 기준으로 다시 판정합니다. 확정된 유형은 제외." className="px-4 py-2 rounded-lg text-xs font-bold bg-white text-slate-700 border border-slate-300 disabled:opacity-50">현재 조건 다시 판정</button>
              <button onClick={bulkConfirm} disabled={!!running} className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white disabled:opacity-50">조건 충족 유형 일괄 확정</button>
              {!running && (
                <span className="text-xs text-slate-500">
                  위 조건(탭·교육과정·학교급·검색)에 맞는 유형 중 아직 판정되지 않은 것만 처리합니다. 처음에는 범위를 좁혀 시험해 보세요.
                </span>
              )}
              {running && (
                <button onClick={() => { stopRef.current = true; }} className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 text-white">중지</button>
              )}
              {running && (
                <div className="flex-1 min-w-[240px]">
                  <div className="flex justify-between text-xs text-slate-600 font-bold mb-1">
                    <span>{running === "run1" ? "1차 매핑" : running === "redo" ? "다시 판정" : "2차 검증"} 중: {progress.done}/{progress.total} (실패 {progress.failed})</span>
                    <span>{eta != null ? `남은 시간 약 ${Math.max(0, Math.ceil(eta / 60))}분` : "계산 중"}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded"><div className="h-2 bg-brand rounded" style={{ width: `${progress.total ? ((progress.done + progress.failed) / progress.total) * 100 : 0}%` }} /></div>
                </div>
              )}
            </div>
            {tab === "sample" && (
              <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2">
                표본 검증 탭에서는 공정한 비교를 위해 AI 결과를 가립니다. 선생님이 역량을 정해 확정한 뒤에 AI 결과가 보입니다.
                표본의 AI 판정이 아직 없다면, 이 탭에서 [▶ AI 판정 시작]을 누르면 표본만 처리됩니다.
              </div>
            )}
          </div>

          {/* 목록 */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {pageRows.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-400 font-bold">조건에 맞는 유형이 없습니다. 탭이나 필터를 바꿔 보세요.</div>
            ) : pageRows.map(c => {
              const r = compMap[c.category_id];
              const st = r?.status || "PENDING";
              const qs = qStats[c.category_id];
              const hideAI = !!r?.is_sample && st !== "CONFIRMED";
              const draft = drafts[c.category_id];
              const selP = draft?.p ?? r?.final_primary ?? (hideAI ? null : r?.ai_primary) ?? null;
              const selS = draft ? draft.s : (r?.final_secondary ?? (hideAI ? null : r?.ai_secondary) ?? null);
              const mismatch = r?.ai_run2_primary && r.ai_run2_primary !== r.ai_primary;
              const setDraft = (p: Comp | null, s: Comp | null) => setDrafts(prev => ({ ...prev, [c.category_id]: { p, s } }));

              return (
                <div key={c.category_id} className="grid grid-cols-1 xl:grid-cols-[1.3fr_1.2fr_1.1fr] gap-3 p-4 border-b border-slate-100 last:border-b-0">
                  {/* 유형 */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${STATUS_LABEL[st]?.cls}`}>{STATUS_LABEL[st]?.text}</span>
                      {r?.is_sample && <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">표본</span>}
                      <span className="text-xs font-bold text-slate-400">{c.curriculum_version} 개정</span>
                    </div>
                    <div className="text-sm font-bold text-slate-800 break-keep">{leafName(c)}</div>
                    <div className="text-xs text-slate-500 break-keep mt-0.5">{parentPath(c)}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      문항 {qs?.count || 0}개
                      {qs && qs.count > 0 && (
                        <span className="ml-2 text-slate-400">
                          {COGNITIVE_LEVELS.map(l => `${COG_SHORT[l]} ${qs.cognitive[l] || 0}`).join(" / ")}
                          {qs.cognitive["미분류"] ? ` / 미분류 ${qs.cognitive["미분류"]}` : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* AI 결과 */}
                  <div className="min-w-0 text-xs">
                    {hideAI ? (
                      <div className="text-slate-400 font-bold">표본: 선생님이 먼저 정한 뒤 AI 결과가 보입니다.</div>
                    ) : !r?.ai_primary ? (
                      <div className="text-slate-400 font-bold">AI 판정 전</div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-slate-500 font-bold w-8">1차</span>
                          <CompChip v={r.ai_primary as Comp} active small />
                          {r.ai_secondary && <CompChip v={r.ai_secondary as Comp} active={false} small />}
                          <span className={`font-bold ${(r.ai_confidence ?? 0) < REVIEW_CONF ? "text-amber-600" : "text-slate-500"}`}>확신 {Math.round((r.ai_confidence ?? 0) * 100)}%</span>
                        </div>
                        {r.ai_reason && <div className="text-slate-600 pl-9 break-keep">{r.ai_reason}</div>}
                        {r.ai_run2_primary && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-slate-500 font-bold w-8">2차</span>
                            <CompChip v={r.ai_run2_primary as Comp} active={!mismatch} small />
                            <span className={`font-bold ${mismatch ? "text-rose-600" : "text-emerald-600"}`}>{mismatch ? "1차와 다름" : "1차와 같음"}</span>
                            <span className="text-slate-400">확신 {Math.round((r.ai_run2_confidence ?? 0) * 100)}%</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 선생님 판단 */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 flex-wrap mb-1.5">
                      <span className="text-xs font-bold text-slate-500 w-10">주 역량</span>
                      {COMPS.map(v => (
                        <CompChip key={v} v={v} active={selP === v} onClick={st === "CONFIRMED" ? undefined : () => setDraft(v, selS === v ? null : selS)} />
                      ))}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap mb-2">
                      <span className="text-xs font-bold text-slate-500 w-10">보조</span>
                      <button
                        type="button"
                        disabled={st === "CONFIRMED"}
                        onClick={() => setDraft(selP, null)}
                        className={`px-2 py-1 text-xs rounded-md font-bold border ${!selS ? "bg-slate-700 text-white border-transparent" : "bg-white text-slate-500 border-slate-200"}`}
                      >없음</button>
                      {COMPS.filter(v => v !== selP).map(v => (
                        <CompChip key={v} v={v} active={selS === v} onClick={st === "CONFIRMED" ? undefined : () => setDraft(selP, v)} />
                      ))}
                    </div>
                    {st === "CONFIRMED" ? (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-bold text-emerald-700">확정됨{r?.reviewed_at ? ` (${r.reviewed_at.slice(0, 10)})` : ""}</span>
                        <button onClick={() => unconfirmRow(c.category_id)} disabled={!!running} className="text-slate-500 underline disabled:opacity-50">확정 해제</button>
                      </div>
                    ) : (
                      <button onClick={() => confirmRow(c.category_id)} disabled={!!running || !selP} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white disabled:opacity-40">
                        이 역량으로 확정
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 페이지 */}
          <div className="flex justify-center items-center gap-3 mt-4 text-xs font-bold">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40">이전</button>
            <span className="text-slate-600">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40">다음</button>
          </div>
        </>
      )}
    </div>
    </div>
  );
}
