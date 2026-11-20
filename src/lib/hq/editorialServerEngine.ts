// src/lib/hq/editorialServerEngine.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMasterCategories } from "@/lib/normalize";
import { THINKING_CATEGORIES } from "@/lib/thinkingCategory";
import { isConfidentialQuestionObj } from "@/lib/confidentialExamGuard";
import type {
  AnalyzedCaptureProblem,
  CategoryCompetencyInfo,
  CategoryNodeSummary,
  CompetencyName,
  Depth8ItemSummary,
  DifficultyKey,
  EditorialBootstrapPayload,
  EditorialCountFilter,
  EditorialQuestionCard,
  EditorialQuestionsPayload,
  EditorialUnitDetailPayload,
  PrerequisiteEdgeDetail,
  TargetContextInfo,
  TargetHierarchyStep,
  ThinkingNodeSummary,
} from "./editorialTypes";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const EXTRACT_MODEL = process.env.GEMINI_EXTRACT_MODEL || "gemini-3.5-flash-lite";
const CLASSIFY_MODEL = process.env.GEMINI_CLASSIFY_MODEL || "gemini-3.5-flash-lite";
const SOLVE_MODEL = process.env.GEMINI_SOLVE_MODEL || "gemini-3.8-flash";

const INDEX_CACHE_TTL_MS = 5 * 60 * 1000; // 5분 서버 인메모리 캐시

type DbRow = Record<string, unknown>;

export interface RawMasterCategory {
  category_id: string;
  curriculum_version: string;
  depth1: string;
  depth2: string;
  depth3: string;
  depth4: string;
  depth5: string;
  depth6: string;
  depth7: string;
  full_path: string;
  is_outdated?: boolean;
}

export interface RawMasterItem {
  item_id: string;
  category_id: string;
  depth8: string;
  depth6: string | null;
  type: string | null;
}

export interface RawThinkingCategory {
  category_id: string;
  depth1: string;
  depth2: string;
  depth3: string;
  full_path: string;
  sort_order: number;
}

export interface RawPrereqRow {
  mapping_id: number;
  target_category_id: string;
  prerequisite_id: string;
  reason: string;
}

export interface QuestionMetaRecord {
  qid: string;
  primaryCatUpper: string | null;
  primaryItemUpper: string | null;
  primaryIsDirectCat: boolean;
  subCatUpper: string | null;
  subItemUpper: string | null;
  subIsDirectCat: boolean;
  thkUpper: string | null;
  isDerived: boolean;
  diff: DifficultyKey;
  cog: string;
  ptype: string;
  book: string;
  pageNum: number;
  qNumStr: string;
  subNum: number;
}

export interface MacroUnitBucket {
  unitKey: string;
  curriculumSet: Set<string>;
  depth1: string;
  depth2: string;
  depth3: string;
  depth4: string;
  categoryIds: string[];
}

export interface EditorialServerIndex {
  builtAt: number;
  categories: RawMasterCategory[];
  catByUpper: Map<string, RawMasterCategory>;
  items: RawMasterItem[];
  itemByUpper: Map<string, RawMasterItem>;
  itemsByCatUpper: Map<string, RawMasterItem[]>;
  thinking: RawThinkingCategory[];
  thkByUpper: Map<string, RawThinkingCategory>;
  compByCatUpper: Map<string, CategoryCompetencyInfo>;
  prereqByTargetUpper: Map<string, RawPrereqRow[]>;
  followupByPrereqUpper: Map<string, RawPrereqRow[]>;
  questions: QuestionMetaRecord[];
  macroUnits: MacroUnitBucket[];
}

interface GlobalEditorialCacheHolder {
  index: EditorialServerIndex | null;
  inflight: Promise<EditorialServerIndex> | null;
}

function getCacheHolder(): GlobalEditorialCacheHolder {
  const g = globalThis as unknown as {
    __logicaEditorialServerCache?: GlobalEditorialCacheHolder;
  };
  if (!g.__logicaEditorialServerCache) {
    g.__logicaEditorialServerCache = { index: null, inflight: null };
  }
  return g.__logicaEditorialServerCache;
}

export function invalidateEditorialServerCache(): void {
  const holder = getCacheHolder();
  holder.index = null;
}

function normalizeDiffKey(raw: unknown): DifficultyKey {
  const s = String(raw ?? "").trim();
  if (s === "최하" || s === "하" || s === "중" || s === "상" || s === "최상") {
    return s;
  }
  return "미지정";
}

export function emptyDiffMap(): Record<DifficultyKey, number> {
  return { 최하: 0, 하: 0, 중: 0, 상: 0, 최상: 0, 미지정: 0 };
}

async function fetchAllParallel(
  supabaseAdmin: SupabaseClient,
  table: string,
  selectCols: string,
  orderCol: string
): Promise<DbRow[]> {
  const step = 1000;
  const concurrency = 8;

  const { count, error: countErr } = await supabaseAdmin
    .from(table)
    .select("*", { count: "exact", head: true });

  if (!countErr && count !== null) {
    if (count === 0) return [];
    const totalPages = Math.ceil(count / step);
    const chunks: DbRow[][] = new Array(totalPages);

    for (let p = 0; p < totalPages; p += concurrency) {
      const wave = Math.min(concurrency, totalPages - p);
      await Promise.all(
        Array.from({ length: wave }, async (_, idx) => {
          const pageIndex = p + idx;
          const start = pageIndex * step;
          const { data, error } = await supabaseAdmin
            .from(table)
            .select(selectCols)
            .order(orderCol, { ascending: true })
            .range(start, start + step - 1);
          if (error) {
            throw new Error(`[${table}] 조회 오류: ${error.message}`);
          }
          chunks[pageIndex] = (data as unknown as DbRow[]) || [];
        })
      );
    }

    const merged: DbRow[] = [];
    for (const c of chunks) {
      if (c && c.length > 0) merged.push(...c);
    }
    return merged;
  }

  const all: DbRow[] = [];
  for (let start = 0; ; start += step) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(selectCols)
      .order(orderCol, { ascending: true })
      .range(start, start + step - 1);
    if (error) throw new Error(`[${table}] 조회 오류: ${error.message}`);
    const rows = (data as unknown as DbRow[]) || [];
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < step) break;
  }
  return all;
}

async function fetchSafeOptionalTable(
  supabaseAdmin: SupabaseClient,
  table: string,
  selectCols: string,
  orderCol: string
): Promise<DbRow[]> {
  try {
    return await fetchAllParallel(supabaseAdmin, table, selectCols, orderCol);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[editorial] 선택 테이블(${table}) 로드 폴백:`, msg);
    return [];
  }
}

function buildEditorialIndex(
  rawCats: DbRow[],
  rawItems: DbRow[],
  rawThk: DbRow[],
  rawComps: DbRow[],
  rawPrereqs: DbRow[],
  rawQuestions: DbRow[]
): EditorialServerIndex {
  const normalizedCats = normalizeMasterCategories(rawCats);
  const categories: RawMasterCategory[] = [];
  const catByUpper = new Map<string, RawMasterCategory>();

  for (const r of normalizedCats) {
    const cid = String(r.category_id || "").trim();
    if (!cid) continue;
    const cat: RawMasterCategory = {
      category_id: cid,
      curriculum_version: String(r.curriculum_version || "2022").trim(),
      depth1: String(r.depth1 || "").trim(),
      depth2: String(r.depth2 || "").trim(),
      depth3: String(r.depth3 || "").trim(),
      depth4: String(r.depth4 || "").trim(),
      depth5: String(r.depth5 || "").trim(),
      depth6: String(r.depth6 || "").trim(),
      depth7: String(r.depth7 || "").trim(),
      full_path:
        String(r.full_path || "").trim() ||
        [r.depth1, r.depth2, r.depth3, r.depth4, r.depth5, r.depth6, r.depth7]
          .filter(Boolean)
          .map((x) => String(x))
          .join(" > "),
      is_outdated: Boolean(r.is_outdated),
    };
    const upper = cid.toUpperCase();
    if (!catByUpper.has(upper)) {
      categories.push(cat);
      catByUpper.set(upper, cat);
    }
  }

  const items: RawMasterItem[] = [];
  const itemByUpper = new Map<string, RawMasterItem>();
  const itemsByCatUpper = new Map<string, RawMasterItem[]>();

  for (const r of rawItems) {
    const iid = String(r.item_id || "").trim();
    const cid = String(r.category_id || "").trim();
    if (!iid || !cid) continue;
    const item: RawMasterItem = {
      item_id: iid,
      category_id: cid,
      depth8: String(r.depth8 || r.depth6 || r.type || "기본 세부유형").trim(),
      depth6: r.depth6 ? String(r.depth6).trim() : null,
      type: r.type ? String(r.type).trim() : null,
    };
    const iUpper = iid.toUpperCase();
    if (itemByUpper.has(iUpper)) continue;
    items.push(item);
    itemByUpper.set(iUpper, item);

    const cUpper = cid.toUpperCase();
    const list = itemsByCatUpper.get(cUpper);
    if (list) list.push(item);
    else itemsByCatUpper.set(cUpper, [item]);
  }

  const thkSource: ReadonlyArray<Record<string, unknown>> =
    rawThk && rawThk.length > 0
      ? rawThk.filter((t) => t.is_active !== false)
      : (THINKING_CATEGORIES as unknown as Record<string, unknown>[]);

  const thinking: RawThinkingCategory[] = thkSource.map((t, idx) => {
    const cid = String(t.category_id || "").trim();
    const d1 = String(t.depth1 || "").trim();
    const d2 = String(t.depth2 || "").trim();
    const d3 = String(t.depth3 || "").trim();
    return {
      category_id: cid,
      depth1: d1,
      depth2: d2,
      depth3: d3,
      full_path:
        String(t.full_path || "").trim() || [d1, d2, d3].filter(Boolean).join(" > "),
      sort_order: typeof t.sort_order === "number" ? t.sort_order : (idx + 1) * 10,
    };
  });
  thinking.sort(
    (a, b) => a.sort_order - b.sort_order || a.category_id.localeCompare(b.category_id)
  );

  const thkByUpper = new Map<string, RawThinkingCategory>();
  for (const t of thinking) {
    if (t.category_id) thkByUpper.set(t.category_id.toUpperCase(), t);
  }

  const compByCatUpper = new Map<string, CategoryCompetencyInfo>();
  for (const r of rawComps) {
    const cid = String(r.category_id || "").trim().toUpperCase();
    if (!cid) continue;
    const primary = (r.final_primary || r.ai_primary || null) as CompetencyName | null;
    const secondary = (r.final_secondary || r.ai_secondary || null) as CompetencyName | null;
    compByCatUpper.set(cid, {
      primary,
      secondary,
      confidence: typeof r.ai_confidence === "number" ? r.ai_confidence : null,
      status: r.status ? String(r.status) : null,
      reason: r.ai_reason ? String(r.ai_reason) : null,
    });
  }

  const prereqByTargetUpper = new Map<string, RawPrereqRow[]>();
  const followupByPrereqUpper = new Map<string, RawPrereqRow[]>();
  for (const r of rawPrereqs) {
    const tId = String(r.target_category_id || "").trim();
    const pId = String(r.prerequisite_id || "").trim();
    if (!tId || !pId) continue;
    const edge: RawPrereqRow = {
      mapping_id: Number(r.mapping_id || 0),
      target_category_id: tId,
      prerequisite_id: pId,
      reason: String(r.reason || "").trim(),
    };
    const tUpper = tId.toUpperCase();
    const pUpper = pId.toUpperCase();

    const pList = prereqByTargetUpper.get(tUpper);
    if (pList) pList.push(edge);
    else prereqByTargetUpper.set(tUpper, [edge]);

    const fList = followupByPrereqUpper.get(pUpper);
    if (fList) fList.push(edge);
    else followupByPrereqUpper.set(pUpper, [edge]);
  }

  const resolveTax = (rawCode: unknown) => {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code || code === "NONE" || code === "미분류") {
      return { catUpper: null, itemUpper: null, isDirectCat: false };
    }
    const hitItem = itemByUpper.get(code);
    if (hitItem) {
      return {
        catUpper: hitItem.category_id.toUpperCase(),
        itemUpper: code,
        isDirectCat: false,
      };
    }
    if (catByUpper.has(code)) {
      return { catUpper: code, itemUpper: null, isDirectCat: true };
    }
    if (/-\d{3}$/.test(code)) {
      const parentUpper = code.slice(0, -4);
      if (catByUpper.has(parentUpper)) {
        return { catUpper: parentUpper, itemUpper: null, isDirectCat: true };
      }
    }
    return { catUpper: null, itemUpper: null, isDirectCat: false };
  };

  const questions: QuestionMetaRecord[] = [];
  for (const q of rawQuestions) {
    if (q.is_hidden === true || q.is_hidden === "Y" || q.is_hidden === "true") {
      continue;
    }
    if (isConfidentialQuestionObj(q as Record<string, unknown>)) {
      continue;
    }
    const qid = String(q.question_id || "").trim();
    if (!qid) continue;

    const primaryRaw = q.taxonomy_id || q.item_id || "";
    const primary = resolveTax(primaryRaw);
    const sub = resolveTax(q.sub_taxonomy_id);

    const thkRaw = String(q.thk_taxonomy_id || "").trim().toUpperCase();
    const thkUpper = thkRaw && thkByUpper.has(thkRaw) ? thkRaw : null;

    const derivStr = String(q.derivation_type || "").trim().toUpperCase();
    const isDerived = Boolean(
      q.parent_question_id ||
        derivStr === "TWIN" ||
        derivStr.includes("유사") ||
        derivStr.includes("쌍둥이")
    );

    const book = String(q.book_name || q.source_book_name || "").trim();
    const pageNum = parseInt(String(q.final_printed_page || "0"), 10) || 0;

    questions.push({
      qid,
      primaryCatUpper: primary.catUpper,
      primaryItemUpper: primary.itemUpper,
      primaryIsDirectCat: primary.isDirectCat,
      subCatUpper: sub.catUpper,
      subItemUpper: sub.itemUpper,
      subIsDirectCat: sub.isDirectCat,
      thkUpper,
      isDerived,
      diff: normalizeDiffKey(q.difficulty),
      cog: String(q.cognitive_level || "미분류").trim() || "미분류",
      ptype: String(q.problem_type || "SUBJECTIVE").trim() || "SUBJECTIVE",
      book,
      pageNum,
      qNumStr: String(q.question_number || "").trim(),
      subNum: Number(q.sub_num || 0),
    });
  }

  const macroMap = new Map<string, MacroUnitBucket>();
  let unitSeq = 1;
  for (const c of categories) {
    if (!c.depth1 || !c.depth2 || !c.depth3) continue;
    const d4 = c.depth4 || c.depth3;
    const sig = `${c.depth1}||${c.depth2}||${c.depth3}||${d4}`;
    let bucket = macroMap.get(sig);
    if (!bucket) {
      bucket = {
        unitKey: `U${String(unitSeq++).padStart(3, "0")}`,
        curriculumSet: new Set([c.curriculum_version]),
        depth1: c.depth1,
        depth2: c.depth2,
        depth3: c.depth3,
        depth4: d4,
        categoryIds: [],
      };
      macroMap.set(sig, bucket);
    } else {
      bucket.curriculumSet.add(c.curriculum_version);
    }
    bucket.categoryIds.push(c.category_id);
  }

  return {
    builtAt: Date.now(),
    categories,
    catByUpper,
    items,
    itemByUpper,
    itemsByCatUpper,
    thinking,
    thkByUpper,
    compByCatUpper,
    prereqByTargetUpper,
    followupByPrereqUpper,
    questions,
    macroUnits: Array.from(macroMap.values()),
  };
}

export async function getEditorialServerIndex(
  supabaseAdmin: SupabaseClient,
  forceRefresh = false
): Promise<EditorialServerIndex> {
  const holder = getCacheHolder();
  if (
    !forceRefresh &&
    holder.index &&
    Date.now() - holder.index.builtAt < INDEX_CACHE_TTL_MS
  ) {
    return holder.index;
  }

  if (!forceRefresh && holder.inflight) {
    return holder.inflight;
  }

  holder.inflight = (async () => {
    try {
      const [rawCats, rawItems, rawThk, rawComps, rawPrereqs, rawQuestions] =
        await Promise.all([
          fetchAllParallel(
            supabaseAdmin,
            "master_category",
            "category_id, curriculum_version, depth1, depth2, depth3, depth4, depth5, depth6, depth7, full_path, is_outdated",
            "category_id"
          ),
          fetchAllParallel(
            supabaseAdmin,
            "master_item",
            "item_id, category_id, depth8, depth6, type",
            "item_id"
          ),
          fetchSafeOptionalTable(
            supabaseAdmin,
            "thinking_category",
            "category_id, depth1, depth2, depth3, full_path, sort_order, is_active",
            "category_id"
          ),
          fetchSafeOptionalTable(
            supabaseAdmin,
            "taxonomy_competency",
            "category_id, ai_primary, ai_secondary, ai_confidence, ai_reason, final_primary, final_secondary, status",
            "category_id"
          ),
          fetchSafeOptionalTable(
            supabaseAdmin,
            "prerequisite_mapping",
            "mapping_id, target_category_id, prerequisite_id, reason",
            "mapping_id"
          ),
          fetchAllParallel(
            supabaseAdmin,
            "question_db",
            "question_id, item_id, parent_question_id, taxonomy_id, sub_taxonomy_id, thk_taxonomy_id, derivation_type, is_hidden, difficulty, cognitive_level, problem_type, book_name, source_book_name, pdf_source, raw_source_tags, final_printed_page, question_number, sub_num",
            "question_id"
          ),
        ]);

      const built = buildEditorialIndex(
        rawCats,
        rawItems,
        rawThk,
        rawComps,
        rawPrereqs,
        rawQuestions
      );
      holder.index = built;
      return built;
    } finally {
      holder.inflight = null;
    }
  })();

  return holder.inflight;
}

interface ComputedCounts {
  catCount: Map<string, number>;
  catDirectCount: Map<string, number>;
  catDiff: Map<string, Record<DifficultyKey, number>>;
  itemCount: Map<string, number>;
  itemDiff: Map<string, Record<DifficultyKey, number>>;
  thkCount: Map<string, number>;
  thkDiff: Map<string, Record<DifficultyKey, number>>;
  totalActive: number;
  originalCount: number;
  derivedCount: number;
  thkMappedCount: number;
  bookCounts: Map<string, number>;
}

function computeAllCounts(
  index: EditorialServerIndex,
  filter: EditorialCountFilter
): ComputedCounts {
  const catCount = new Map<string, number>();
  const catDirectCount = new Map<string, number>();
  const catDiff = new Map<string, Record<DifficultyKey, number>>();
  const itemCount = new Map<string, number>();
  const itemDiff = new Map<string, Record<DifficultyKey, number>>();
  const thkCount = new Map<string, number>();
  const thkDiff = new Map<string, Record<DifficultyKey, number>>();
  const bookCounts = new Map<string, number>();

  let totalActive = 0;
  let originalCount = 0;
  let derivedCount = 0;
  let thkMappedCount = 0;

  const bumpCat = (catUpper: string, diff: DifficultyKey, isDirect: boolean) => {
    const cat = index.catByUpper.get(catUpper);
    if (!cat) return;
    if (filter.curriculum !== "all" && cat.curriculum_version !== filter.curriculum) {
      return;
    }
    catCount.set(catUpper, (catCount.get(catUpper) || 0) + 1);
    if (isDirect) {
      catDirectCount.set(catUpper, (catDirectCount.get(catUpper) || 0) + 1);
    }
    let dm = catDiff.get(catUpper);
    if (!dm) {
      dm = emptyDiffMap();
      catDiff.set(catUpper, dm);
    }
    dm[diff]++;
  };

  const bumpItem = (itemUpper: string, diff: DifficultyKey) => {
    itemCount.set(itemUpper, (itemCount.get(itemUpper) || 0) + 1);
    let dm = itemDiff.get(itemUpper);
    if (!dm) {
      dm = emptyDiffMap();
      itemDiff.set(itemUpper, dm);
    }
    dm[diff]++;
  };

  for (const q of index.questions) {
    if (q.isDerived) derivedCount++;
    else originalCount++;

    if (!filter.includeDerived && q.isDerived) continue;
    totalActive++;

    if (q.book) {
      bookCounts.set(q.book, (bookCounts.get(q.book) || 0) + 1);
    }

    if (q.primaryCatUpper) {
      bumpCat(q.primaryCatUpper, q.diff, q.primaryIsDirectCat);
    }
    if (q.primaryItemUpper) {
      bumpItem(q.primaryItemUpper, q.diff);
    }

    if (filter.includeSubTaxonomy) {
      if (q.subCatUpper && q.subCatUpper !== q.primaryCatUpper) {
        bumpCat(q.subCatUpper, q.diff, q.subIsDirectCat);
      }
      if (q.subItemUpper && q.subItemUpper !== q.primaryItemUpper) {
        bumpItem(q.subItemUpper, q.diff);
      }
    }

    if (q.thkUpper) {
      thkMappedCount++;
      thkCount.set(q.thkUpper, (thkCount.get(q.thkUpper) || 0) + 1);
      let tdm = thkDiff.get(q.thkUpper);
      if (!tdm) {
        tdm = emptyDiffMap();
        thkDiff.set(q.thkUpper, tdm);
      }
      tdm[q.diff]++;
    }
  }

  return {
    catCount,
    catDirectCount,
    catDiff,
    itemCount,
    itemDiff,
    thkCount,
    thkDiff,
    totalActive,
    originalCount,
    derivedCount,
    thkMappedCount,
    bookCounts,
  };
}

export function buildBootstrapPayload(
  index: EditorialServerIndex,
  filter: EditorialCountFilter
): EditorialBootstrapPayload {
  const counts = computeAllCounts(index, filter);

  const categories: CategoryNodeSummary[] = [];
  let coveredCategories = 0;
  let totalItems = 0;
  let coveredItems = 0;

  for (const c of index.categories) {
    if (filter.curriculum !== "all" && c.curriculum_version !== filter.curriculum) {
      continue;
    }
    const cUpper = c.category_id.toUpperCase();
    const qCount = counts.catCount.get(cUpper) || 0;
    if (qCount > 0) coveredCategories++;

    const childItems = index.itemsByCatUpper.get(cUpper) || [];
    let covItemsForCat = 0;
    for (const it of childItems) {
      totalItems++;
      if ((counts.itemCount.get(it.item_id.toUpperCase()) || 0) > 0) {
        covItemsForCat++;
        coveredItems++;
      }
    }

    categories.push({
      category_id: c.category_id,
      curriculum_version: c.curriculum_version,
      depth1: c.depth1,
      depth2: c.depth2,
      depth3: c.depth3,
      depth4: c.depth4,
      depth5: c.depth5,
      depth6: c.depth6,
      depth7: c.depth7,
      count: qCount,
      directCount: counts.catDirectCount.get(cUpper) || 0,
      itemCount: childItems.length,
      coveredItemCount: covItemsForCat,
      emptyItemCount: Math.max(0, childItems.length - covItemsForCat),
      diff: counts.catDiff.get(cUpper) || emptyDiffMap(),
      competency: index.compByCatUpper.get(cUpper) || null,
      prereqCount: (index.prereqByTargetUpper.get(cUpper) || []).length,
      followupCount: (index.followupByPrereqUpper.get(cUpper) || []).length,
    });
  }

  let coveredThinking = 0;
  const thinkingCategories: ThinkingNodeSummary[] = index.thinking.map((t) => {
    const tUpper = t.category_id.toUpperCase();
    const c = counts.thkCount.get(tUpper) || 0;
    if (c > 0) coveredThinking++;
    return {
      category_id: t.category_id,
      depth1: t.depth1,
      depth2: t.depth2,
      depth3: t.depth3,
      full_path: t.full_path,
      sort_order: t.sort_order,
      count: c,
      diff: counts.thkDiff.get(tUpper) || emptyDiffMap(),
    };
  });

  const topBooks = Array.from(counts.bookCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([name, count]) => ({ name, count }));

  return {
    globalStats: {
      totalActiveQuestions: counts.totalActive,
      originalQuestions: counts.originalCount,
      derivedQuestions: counts.derivedCount,
      thinkingMappedQuestions: counts.thkMappedCount,
      totalCategories: categories.length,
      coveredCategories,
      emptyCategories: Math.max(0, categories.length - coveredCategories),
      totalItems,
      coveredItems,
      emptyItems: Math.max(0, totalItems - coveredItems),
      totalThinking: thinkingCategories.length,
      coveredThinking,
      topBooks,
      cachedAt: index.builtAt,
    },
    categories,
    thinkingCategories,
  };
}

export function buildUnitDetailPayload(
  index: EditorialServerIndex,
  categoryIds: string[],
  filter: EditorialCountFilter
): EditorialUnitDetailPayload {
  const counts = computeAllCounts(index, filter);
  const targetSet = new Set(categoryIds.map((id) => id.trim().toUpperCase()).filter(Boolean));

  const items: Depth8ItemSummary[] = [];
  const prereqSeen = new Set<string>();
  const followupSeen = new Set<string>();
  const prerequisites: PrerequisiteEdgeDetail[] = [];
  const followups: PrerequisiteEdgeDetail[] = [];

  for (const catUpper of targetSet) {
    const cat = index.catByUpper.get(catUpper);
    if (!cat) continue;

    const childItems = index.itemsByCatUpper.get(catUpper) || [];
    for (const it of childItems) {
      const iUpper = it.item_id.toUpperCase();
      items.push({
        item_id: it.item_id,
        category_id: cat.category_id,
        depth8: it.depth8,
        depth6: it.depth6,
        type: it.type,
        count: counts.itemCount.get(iUpper) || 0,
        diff: counts.itemDiff.get(iUpper) || emptyDiffMap(),
      });
    }

    const pEdges = index.prereqByTargetUpper.get(catUpper) || [];
    for (const edge of pEdges) {
      const linkedUpper = edge.prerequisite_id.toUpperCase();
      if (targetSet.size > 1 && targetSet.has(linkedUpper)) continue;
      if (prereqSeen.has(linkedUpper)) continue;
      const linkedCat = index.catByUpper.get(linkedUpper);
      if (!linkedCat) continue;
      prereqSeen.add(linkedUpper);
      prerequisites.push({
        mapping_id: edge.mapping_id,
        source_category_id: cat.category_id,
        linked_category_id: linkedCat.category_id,
        curriculum_version: linkedCat.curriculum_version,
        depth1: linkedCat.depth1,
        depth2: linkedCat.depth2,
        depth3: linkedCat.depth3,
        depth4: linkedCat.depth4,
        depth5: linkedCat.depth5,
        depth6: linkedCat.depth6,
        depth7: linkedCat.depth7,
        reason: edge.reason,
        questionCount: counts.catCount.get(linkedUpper) || 0,
      });
    }

    const fEdges = index.followupByPrereqUpper.get(catUpper) || [];
    for (const edge of fEdges) {
      const linkedUpper = edge.target_category_id.toUpperCase();
      if (targetSet.size > 1 && targetSet.has(linkedUpper)) continue;
      if (followupSeen.has(linkedUpper)) continue;
      const linkedCat = index.catByUpper.get(linkedUpper);
      if (!linkedCat) continue;
      followupSeen.add(linkedUpper);
      followups.push({
        mapping_id: edge.mapping_id,
        source_category_id: cat.category_id,
        linked_category_id: linkedCat.category_id,
        curriculum_version: linkedCat.curriculum_version,
        depth1: linkedCat.depth1,
        depth2: linkedCat.depth2,
        depth3: linkedCat.depth3,
        depth4: linkedCat.depth4,
        depth5: linkedCat.depth5,
        depth6: linkedCat.depth6,
        depth7: linkedCat.depth7,
        reason: edge.reason,
        questionCount: counts.catCount.get(linkedUpper) || 0,
      });
    }
  }

  return {
    items,
    prerequisites: prerequisites.slice(0, 40),
    followups: followups.slice(0, 40),
  };
}

export interface QueryQuestionsParams {
  mode: "curriculum" | "thinking" | "all";
  categoryIds?: string[];
  itemIds?: string[];
  directOnly?: boolean;
  thkIds?: string[];
  filter: EditorialCountFilter;
  difficulty?: string;
  cognitiveLevel?: string;
  bookName?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

export async function queryQuestionsPayload(
  supabaseAdmin: SupabaseClient,
  index: EditorialServerIndex,
  params: QueryQuestionsParams
): Promise<EditorialQuestionsPayload> {
  const catSet = new Set(
    (params.categoryIds || []).map((s) => s.trim().toUpperCase()).filter(Boolean)
  );
  const itemSet = new Set(
    (params.itemIds || []).map((s) => s.trim().toUpperCase()).filter(Boolean)
  );
  const thkSet = new Set(
    (params.thkIds || []).map((s) => s.trim().toUpperCase()).filter(Boolean)
  );

  let keywordQidSet: Set<string> | null = null;
  const kw = String(params.keyword || "").trim();
  if (kw) {
    const safeKw = kw.replace(/[%_,()]/g, " ").trim();
    if (safeKw) {
      const { data: kwRows } = await supabaseAdmin
        .from("question_db")
        .select("question_id")
        .or(
          `question.ilike.%${safeKw}%,book_name.ilike.%${safeKw}%,source_book_name.ilike.%${safeKw}%,taxonomy_id.ilike.%${safeKw}%,taxonomy_name.ilike.%${safeKw}%`
        )
        .limit(3000);
      const list = (kwRows as unknown as Array<{ question_id?: unknown }>) || [];
      keywordQidSet = new Set(list.map((r) => String(r.question_id || "")));
    }
  }

  const matchedBase: QuestionMetaRecord[] = [];
  for (const q of index.questions) {
    if (!params.filter.includeDerived && q.isDerived) continue;
    if (keywordQidSet && !keywordQidSet.has(q.qid)) continue;

    if (params.mode === "thinking") {
      if (thkSet.size > 0 && (!q.thkUpper || !thkSet.has(q.thkUpper))) continue;
      if (thkSet.size === 0 && !q.thkUpper) continue;
    } else if (params.mode === "curriculum") {
      let ok = false;
      if (itemSet.size > 0) {
        if (q.primaryItemUpper && itemSet.has(q.primaryItemUpper)) ok = true;
        else if (
          params.filter.includeSubTaxonomy &&
          q.subItemUpper &&
          itemSet.has(q.subItemUpper)
        ) {
          ok = true;
        }
      } else if (catSet.size > 0) {
        if (params.directOnly) {
          if (
            q.primaryIsDirectCat &&
            q.primaryCatUpper &&
            catSet.has(q.primaryCatUpper)
          ) {
            ok = true;
          } else if (
            params.filter.includeSubTaxonomy &&
            q.subIsDirectCat &&
            q.subCatUpper &&
            catSet.has(q.subCatUpper)
          ) {
            ok = true;
          }
        } else {
          if (q.primaryCatUpper && catSet.has(q.primaryCatUpper)) ok = true;
          else if (
            params.filter.includeSubTaxonomy &&
            q.subCatUpper &&
            catSet.has(q.subCatUpper)
          ) {
            ok = true;
          }
        }
      }
      if (!ok) continue;
    }

    matchedBase.push(q);
  }

  const diffBreakdown = emptyDiffMap();
  const cogBreakdown: Record<string, number> = {};
  const bookMap = new Map<string, number>();

  for (const q of matchedBase) {
    diffBreakdown[q.diff]++;
    cogBreakdown[q.cog] = (cogBreakdown[q.cog] || 0) + 1;
    if (q.book) bookMap.set(q.book, (bookMap.get(q.book) || 0) + 1);
  }

  const filtered = matchedBase.filter((q) => {
    if (params.difficulty && params.difficulty !== "ALL" && q.diff !== params.difficulty) {
      return false;
    }
    if (
      params.cognitiveLevel &&
      params.cognitiveLevel !== "ALL" &&
      q.cog !== params.cognitiveLevel
    ) {
      return false;
    }
    if (params.bookName && params.bookName !== "ALL" && q.book !== params.bookName) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (a.book !== b.book) {
      if (!a.book) return 1;
      if (!b.book) return -1;
      return a.book.localeCompare(b.book, "ko", { numeric: true });
    }
    if (a.pageNum !== b.pageNum) return a.pageNum - b.pageNum;
    const nCmp = a.qNumStr.localeCompare(b.qNumStr, "ko", { numeric: true });
    if (nCmp !== 0) return nCmp;
    return a.subNum - b.subNum;
  });

  const pageSize = Math.min(Math.max(params.pageSize || 20, 5), 50);
  const page = Math.max(params.page || 1, 1);
  const startIdx = (page - 1) * pageSize;
  const pageSlice = filtered.slice(startIdx, startIdx + pageSize);

  let questions: EditorialQuestionCard[] = [];
  if (pageSlice.length > 0) {
    const qids = pageSlice.map((p) => p.qid);
    const { data: rows } = await supabaseAdmin
      .from("question_db")
      .select(
        "question_id, item_id, parent_question_id, book_name, source_book_name, pdf_source, final_printed_page, question_number, sub_num, sub_sub_num, problem_type, difficulty, solving_probability, cognitive_level, derivation_type, taxonomy_id, taxonomy_name, sub_taxonomy_id, sub_taxonomy_name, thk_taxonomy_id, thk_taxonomy_name, question, question_2, options, answer, step_1_concept, step_2_approach, step_3_process, step_4_conclusion, explanation, solution, image_url, image_2_url, answer_image_url, answer_image_2_url, is_human_verified, created_at"
      )
      .in("question_id", qids);

    const rowMap = new Map<string, DbRow>();
    ((rows as unknown as DbRow[]) || []).forEach((r) =>
      rowMap.set(String(r.question_id || ""), r)
    );

    questions = qids
      .map((id) => rowMap.get(id))
      .filter((r): r is DbRow => Boolean(r) && !isConfidentialQuestionObj(r))
      .map((r) => {
        const rawCode = String(r.taxonomy_id || r.item_id || "").trim().toUpperCase();
        const hitItem = index.itemByUpper.get(rawCode);
        const hitCat = hitItem
          ? index.catByUpper.get(hitItem.category_id.toUpperCase())
          : index.catByUpper.get(rawCode);

        const resolved_full_path = hitCat
          ? [
              hitCat.depth1,
              hitCat.depth2,
              hitCat.depth3,
              hitCat.depth4,
              hitCat.depth5,
              hitCat.depth6,
              hitCat.depth7,
            ]
              .filter(Boolean)
              .join(" > ")
          : r.taxonomy_name
            ? String(r.taxonomy_name)
            : null;

        const thkUpper = String(r.thk_taxonomy_id || "").trim().toUpperCase();
        const hitThk = thkUpper ? index.thkByUpper.get(thkUpper) : null;

        return {
          ...(r as unknown as EditorialQuestionCard),
          resolved_full_path,
          resolved_depth8: hitItem?.depth8 || null,
          thk_taxonomy_name: r.thk_taxonomy_name
            ? String(r.thk_taxonomy_name)
            : hitThk?.full_path || null,
        };
      });
  }

  const bookBreakdown = Array.from(bookMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name, count]) => ({ name, count }));

  return {
    total: filtered.length,
    page,
    pageSize,
    diffBreakdown,
    cogBreakdown,
    bookBreakdown,
    questions,
  };
}

export function buildTargetContext(
  index: EditorialServerIndex,
  taxonomyId: string | null | undefined,
  thkTaxonomyId: string | null | undefined,
  filter: EditorialCountFilter = {
    includeDerived: true,
    includeSubTaxonomy: false,
    curriculum: "all",
  }
): TargetContextInfo {
  const counts = computeAllCounts(index, filter);
  const codeUpper = String(taxonomyId || "").trim().toUpperCase();
  const hitItem = index.itemByUpper.get(codeUpper) || null;
  const hitCat = hitItem
    ? index.catByUpper.get(hitItem.category_id.toUpperCase()) || null
    : index.catByUpper.get(codeUpper) ||
      (/-\d{3}$/.test(codeUpper)
        ? index.catByUpper.get(codeUpper.slice(0, -4)) || null
        : null);

  let thinkingInfo: TargetContextInfo["thinkingInfo"] = null;
  const thkUpper = String(thkTaxonomyId || "").trim().toUpperCase();
  if (thkUpper && index.thkByUpper.has(thkUpper)) {
    const t = index.thkByUpper.get(thkUpper)!;
    thinkingInfo = {
      category_id: t.category_id,
      depth1: t.depth1,
      depth2: t.depth2,
      depth3: t.depth3,
      full_path: t.full_path,
      questionCount: counts.thkCount.get(thkUpper) || 0,
    };
  }

  if (!hitCat) {
    return {
      found: false,
      category_id: null,
      item_id: hitItem?.item_id || null,
      curriculum_version: null,
      full_path: String(taxonomyId || "미분류"),
      hierarchy: [],
      siblingItems: [],
      competency: null,
      prerequisites: [],
      followups: [],
      thinkingInfo,
    };
  }

  let d1Count = 0;
  let d2Count = 0;
  let d3Count = 0;
  let d4Count = 0;
  let d5Count = 0;
  let d6Count = 0;
  for (const c of index.categories) {
    const cCount = counts.catCount.get(c.category_id.toUpperCase()) || 0;
    if (cCount === 0) continue;
    if (c.depth1 !== hitCat.depth1) continue;
    d1Count += cCount;
    if (c.depth2 !== hitCat.depth2) continue;
    d2Count += cCount;
    if (c.depth3 !== hitCat.depth3) continue;
    d3Count += cCount;
    if (c.depth4 !== hitCat.depth4) continue;
    d4Count += cCount;
    if (c.depth5 !== hitCat.depth5) continue;
    d5Count += cCount;
    if (c.depth6 !== hitCat.depth6) continue;
    d6Count += cCount;
  }

  const catUpper = hitCat.category_id.toUpperCase();
  const d7Count = counts.catCount.get(catUpper) || 0;

  const hierarchy: TargetHierarchyStep[] = [
    { depth: 1, stageLabel: "1단계 · 학교급", name: hitCat.depth1, questionCount: d1Count },
    { depth: 2, stageLabel: "2단계 · 학년·학기", name: hitCat.depth2, questionCount: d2Count },
    { depth: 3, stageLabel: "3단계 · 대단원", name: hitCat.depth3, questionCount: d3Count },
  ];
  if (hitCat.depth4) {
    hierarchy.push({
      depth: 4,
      stageLabel: "4단계 · 중단원",
      name: hitCat.depth4,
      questionCount: d4Count,
    });
  }
  if (hitCat.depth5) {
    hierarchy.push({
      depth: 5,
      stageLabel: "5단계 · 소단원",
      name: hitCat.depth5,
      questionCount: d5Count,
    });
  }
  if (hitCat.depth6) {
    hierarchy.push({
      depth: 6,
      stageLabel: "6단계 · 핵심개념",
      name: hitCat.depth6,
      questionCount: d6Count,
    });
  }
  if (hitCat.depth7) {
    hierarchy.push({
      depth: 7,
      stageLabel: "7단계 · 대표유형",
      name: hitCat.depth7,
      code: hitCat.category_id,
      questionCount: d7Count,
    });
  }
  if (hitItem) {
    hierarchy.push({
      depth: 8,
      stageLabel: "8단계 · 세부유형 (타겟)",
      name: hitItem.depth8,
      code: hitItem.item_id,
      questionCount: counts.itemCount.get(hitItem.item_id.toUpperCase()) || 0,
    });
  }

  const siblingRaw = index.itemsByCatUpper.get(catUpper) || [];
  const siblingItems = siblingRaw.map((it) => ({
    item_id: it.item_id,
    depth8: it.depth8,
    count: counts.itemCount.get(it.item_id.toUpperCase()) || 0,
    isTarget: Boolean(hitItem && it.item_id.toUpperCase() === hitItem.item_id.toUpperCase()),
  }));

  const prerequisites = (index.prereqByTargetUpper.get(catUpper) || [])
    .map((e) => {
      const pCat = index.catByUpper.get(e.prerequisite_id.toUpperCase());
      if (!pCat) return null;
      return {
        category_id: pCat.category_id,
        label: `${pCat.depth2} > ${pCat.depth3} > ${pCat.depth7 || pCat.depth6 || pCat.depth5}`,
        reason: e.reason,
        questionCount: counts.catCount.get(pCat.category_id.toUpperCase()) || 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 8);

  const followups = (index.followupByPrereqUpper.get(catUpper) || [])
    .map((e) => {
      const fCat = index.catByUpper.get(e.target_category_id.toUpperCase());
      if (!fCat) return null;
      return {
        category_id: fCat.category_id,
        label: `${fCat.depth2} > ${fCat.depth3} > ${fCat.depth7 || fCat.depth6 || fCat.depth5}`,
        reason: e.reason,
        questionCount: counts.catCount.get(fCat.category_id.toUpperCase()) || 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 8);

  const fullPathParts = [
    hitCat.depth1,
    hitCat.depth2,
    hitCat.depth3,
    hitCat.depth4,
    hitCat.depth5,
    hitCat.depth6,
    hitCat.depth7,
    hitItem?.depth8,
  ].filter(Boolean);

  return {
    found: true,
    category_id: hitCat.category_id,
    item_id: hitItem?.item_id || null,
    curriculum_version: hitCat.curriculum_version,
    full_path: fullPathParts.join(" > "),
    hierarchy,
    siblingItems,
    competency: index.compByCatUpper.get(catUpper) || null,
    prerequisites,
    followups,
    thinkingInfo,
  };
}

// ============================================================================
// Gemini 비전 추출 + 2단계 계층형 깔때기(Funnel) 8단계 정밀 자동 분류 엔진
// ============================================================================

const BOX_AND_UNIT_RULES = String.raw`### [빈칸(네모박스) 및 수식 표기 규칙]
1. 글자 1칸 크기의 작은 네모 기호는 $\square$, 가로로 긴 답안 빈칸은 $\boxed{\phantom{000}}$, 분수 빈칸은 $\frac{\boxed{\phantom{000}}}{\boxed{\phantom{000}}}$로 표기하십시오.
2. 절대 \squarecm, \squarem처럼 명령어와 영문 단위를 붙여 쓰지 말고 $\square\text{ cm}$처럼 분리하십시오.
3. 분수·제곱·기호는 반드시 달러($) 수식 안에 LaTeX으로 표기하고, 도형/표/그래프 조건은 발문 끝에 [그림 정보: ...]로 핵심 수치와 모양을 요약하십시오.`;

function safeParseJson(rawText: string): unknown {
  let text = (rawText || "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/, "");
  }
  text = text.replace(/@@/g, "\\\\");
  try {
    return JSON.parse(text);
  } catch {
    const repaired = text
      .replace(/\\(?!["\\/bfnrtu])/g, "\\\\")
      .replace(/,\s*([\]}])/g, "$1")
      .replace(/[\u0000-\u0007\u000B\u000E-\u001F]/g, "");
    return JSON.parse(repaired);
  }
}

interface GeminiResponseJson {
  candidates?: Array<{
    content?: {
      parts?: Array<{ thought?: boolean; text?: string }>;
    };
  }>;
  error?: { message?: string };
}

async function callGeminiJson(opts: {
  model: string;
  parts: Array<Record<string, unknown>>;
  responseSchema?: Record<string, unknown>;
  preferredThinking?: "MINIMAL" | "LOW";
  maxOutputTokens?: number;
}): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("서버 환경 변수 GEMINI_API_KEY가 설정되어 있지 않습니다.");
  }

  let targetModel = opts.model.replace(/^models\//, "");
  const modes: ("LEVEL" | "BUDGET" | "NONE")[] = ["LEVEL", "BUDGET", "NONE"];
  let lastError = "";

  for (let mIdx = 0; mIdx < modes.length; mIdx++) {
    const mode = modes[mIdx];
    const pref = opts.preferredThinking || "LOW";
    const effLevel =
      pref === "MINIMAL" && !targetModel.toLowerCase().includes("flash-lite")
        ? "LOW"
        : pref;

    const generationConfig: Record<string, unknown> = {
      responseMimeType: "application/json",
      maxOutputTokens: opts.maxOutputTokens || 8192,
    };
    if (opts.responseSchema) {
      generationConfig.responseSchema = opts.responseSchema;
    }
    if (mode === "LEVEL") {
      generationConfig.thinkingConfig = { thinkingLevel: effLevel };
    } else if (mode === "BUDGET") {
      generationConfig.thinkingConfig = {
        thinkingBudget: effLevel === "MINIMAL" ? 0 : 1024,
      };
    }

    const res = await fetch(
      `${GEMINI_API_BASE}/models/${targetModel}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: opts.parts }],
          generationConfig,
        }),
      }
    );

    const rawJson = (await res.json().catch(() => ({}))) as GeminiResponseJson;
    if (res.ok) {
      const candParts = rawJson?.candidates?.[0]?.content?.parts || [];
      const nonThought = candParts
        .filter((p) => !p?.thought && typeof p?.text === "string")
        .map((p) => p.text as string);
      const text =
        nonThought.length > 0
          ? nonThought.join("")
          : candParts
              .filter((p) => typeof p?.text === "string")
              .map((p) => p.text as string)
              .join("");
      return safeParseJson(text);
    }

    const errMsg = String(rawJson?.error?.message || `HTTP ${res.status}`);
    lastError = `[${res.status}] ${errMsg}`;

    if (res.status === 404 && targetModel !== SOLVE_MODEL) {
      targetModel = SOLVE_MODEL.replace(/^models\//, "");
      mIdx = -1;
      continue;
    }
    if (res.status === 400 && /thinking/i.test(errMsg) && mode !== "NONE") {
      continue;
    }
    throw new Error(lastError);
  }

  throw new Error(lastError || "Gemini API 호출에 실패했습니다.");
}

function makeInlineImagePart(
  imageBase64: string,
  mimeType?: string
): Record<string, unknown> {
  let cleanData = imageBase64;
  let detectedMime = mimeType || "image/png";
  if (imageBase64.includes(",")) {
    const [header, b64] = imageBase64.split(",");
    cleanData = b64;
    const m = header.match(/data:(image\/[a-zA-Z0-9+.-]+);base64/i);
    if (m) detectedMime = m[1];
  }
  return {
    inlineData: {
      mimeType: detectedMime,
      data: cleanData,
    },
  };
}

export async function analyzeCaptureImageWithGemini(
  index: EditorialServerIndex,
  opts: {
    imageBase64: string;
    mimeType?: string;
    gradeHint?: string;
    applyThinking: boolean;
  }
): Promise<{
  detectedPage: string | null;
  problems: AnalyzedCaptureProblem[];
}> {
  const imagePart = makeInlineImagePart(opts.imageBase64, opts.mimeType);

  const extractPrompt = `당신은 수학 출판사 집필팀의 문제 판독 엔진입니다.
제공된 캡처 이미지에 포함된 수학 문제(1문제일 수도 있고 여러 문제일 수도 있음)를 빠짐없이 추출하십시오.
- 문항 번호가 보이지 않는 단일 캡처라면 question_number를 "1"로 기입하십시오.
- (1), (2) 또는 ①, ② 같은 소문항이 있으면 개별 문항으로 분리하고 공통 지시문을 앞에 복제하십시오. (객관식 선지 ①~⑤는 분리하지 말고 question 본문 끝에 줄바꿈하여 함께 적으십시오.)
- 이미지 구석에 페이지 번호가 보이면 final_printed_page에 기입하고, 없으면 빈 문자열을 반환하십시오.

${BOX_AND_UNIT_RULES}`;

  const extractSchema: Record<string, unknown> = {
    type: "OBJECT",
    properties: {
      problems: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            final_printed_page: { type: "STRING", nullable: true },
            question_number: { type: "STRING" },
            sub_num: { type: "INTEGER", nullable: true },
            sub_sub_num: { type: "INTEGER", nullable: true },
            question: { type: "STRING" },
          },
          required: ["question_number", "question"],
        },
      },
    },
    required: ["problems"],
  };

  const extractedRaw = (await callGeminiJson({
    model: EXTRACT_MODEL,
    parts: [imagePart, { text: extractPrompt }],
    responseSchema: extractSchema,
    preferredThinking: "MINIMAL",
  })) as { problems?: DbRow[] } | null;

  const rawProblems: DbRow[] = Array.isArray(extractedRaw?.problems)
    ? extractedRaw.problems
    : [];
  if (rawProblems.length === 0) {
    return { detectedPage: null, problems: [] };
  }

  const workingList = rawProblems.map((p, idx) => ({
    temp_id: `cap_${Date.now()}_${idx + 1}`,
    question_number: String(p.question_number || idx + 1).trim(),
    sub_num: Number(p.sub_num || 0),
    sub_sub_num: Number(p.sub_sub_num || 0),
    final_printed_page: String(p.final_printed_page || "").trim(),
    question: String(p.question || "").trim(),
  }));

  let candidateMacroUnits = index.macroUnits;
  const hint = String(opts.gradeHint || "ALL").trim();
  if (hint && hint !== "ALL") {
    const [hD1, hD2] = hint.split("||");
    const filtered = index.macroUnits.filter(
      (u) => (!hD1 || u.depth1 === hD1) && (!hD2 || u.depth2 === hD2)
    );
    if (filtered.length > 0) candidateMacroUnits = filtered;
  }

  const macroGuideLines = candidateMacroUnits
    .map((u) => `${u.unitKey}: ${u.depth1} > ${u.depth2} > ${u.depth3} > ${u.depth4}`)
    .join("\n");

  const stage1Prompt = `당신은 대한민국 초·중·고 수학 교육과정 분류 라우터입니다.
각 문항이 속할 가능성이 가장 높은 단원 코드(unitKey)를 아래 [단원 목록]에서 최대 3개씩 순서대로 고르십시오.

### [단원 목록]
${macroGuideLines}

### [분류할 문항 목록]
${JSON.stringify(
  workingList.map((w) => ({
    temp_id: w.temp_id,
    question: w.question,
  }))
)}`;

  const stage1Schema: Record<string, unknown> = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        temp_id: { type: "STRING" },
        unit_keys: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
      },
      required: ["temp_id", "unit_keys"],
    },
  };

  const stage1Res = await callGeminiJson({
    model: CLASSIFY_MODEL,
    parts: [{ text: stage1Prompt }],
    responseSchema: stage1Schema,
    preferredThinking: "MINIMAL",
  });

  const macroByKey = new Map(index.macroUnits.map((u) => [u.unitKey, u]));
  const selectedUnitKeys = new Set<string>();
  if (Array.isArray(stage1Res)) {
    for (const row of stage1Res as Array<{ unit_keys?: unknown[] }>) {
      for (const uk of row.unit_keys || []) {
        const cleanUk = String(uk || "").trim();
        if (macroByKey.has(cleanUk)) selectedUnitKeys.add(cleanUk);
      }
    }
  }
  if (selectedUnitKeys.size === 0) {
    candidateMacroUnits.slice(0, 4).forEach((u) => selectedUnitKeys.add(u.unitKey));
  }

  const candidateCatUppers = new Set<string>();
  for (const uk of selectedUnitKeys) {
    const bucket = macroByKey.get(uk);
    if (!bucket) continue;
    for (const cid of bucket.categoryIds) {
      candidateCatUppers.add(cid.toUpperCase());
    }
  }

  const itemGuideLines: string[] = [];
  let itemCountCap = 0;
  for (const catUpper of candidateCatUppers) {
    const cat = index.catByUpper.get(catUpper);
    if (!cat) continue;
    const catHeader = `[단원 ${cat.category_id}] ${cat.depth2} > ${cat.depth3} > ${cat.depth5 || cat.depth4} > ${cat.depth7 || cat.depth6}`;
    const childItems = index.itemsByCatUpper.get(catUpper) || [];
    if (childItems.length === 0) {
      itemGuideLines.push(`${cat.category_id}: ${catHeader}`);
      itemCountCap++;
    } else {
      itemGuideLines.push(`# ${catHeader}`);
      for (const it of childItems) {
        itemGuideLines.push(`  ${it.item_id}: ${it.depth8}`);
        itemCountCap++;
        if (itemCountCap >= 450) break;
      }
    }
    if (itemCountCap >= 450) break;
  }

  let thkGuideBlock = "";
  if (opts.applyThinking) {
    const thkLines = index.thinking
      .map((t) => `${t.category_id}: ${t.depth1} > ${t.depth2} > ${t.depth3}`)
      .join("\n");
    thkGuideBlock = `\n\n### [사고력(THK) 분류표 — 사고력·퍼즐·심화 추론 요소가 있는 문항에 매핑, 단순 연산이면 빈 문자열 ""]\n${thkLines}`;
  }

  const stage2Prompt = `당신은 수학 교재 집필팀의 8단계 정밀 분류 전문가입니다.
아래 [교과 8단계 세부유형 후보 목록]에서 각 문항에 가장 정확히 부합하는 1순위 \`taxonomy_id\`(반드시 \`item_id\` 코드 우선)와 차선 2순위 \`candidate_2_id\`를 선택하고, 선택 이유(\`ai_reason\`)를 1문장으로 설명하십시오.${
    opts.applyThinking
      ? "\n또한 사고력 요소가 있는 문제라면 [사고력(THK) 분류표]에서 가장 알맞은 `thk_taxonomy_id`를 고르고, 일반 단순 교과 연산이면 빈 문자열을 반환하십시오."
      : ""
  }

### [교과 8단계 세부유형 후보 목록]
${itemGuideLines.join("\n")}${thkGuideBlock}

### [분류 기준]
- difficulty: "최하", "하", "중", "상", "최상" 중 택 1
- cognitive_level: "이해 및 연산", "적용 및 응용", "추론 및 문제 해결" 중 택 1
- problem_type: "MULTIPLE_CHOICE"(객관식 ①~⑤), "SUBJECTIVE"(단답형), "DESCRIPTIVE"(서술형) 중 택 1
- solving_probability: 15~95 사이 5단위 정수 (최상 15~30, 상 35~50, 중 55~70, 하 75~85, 최하 85~95)

### [대상 문항]
${JSON.stringify(
  workingList.map((w) => ({
    temp_id: w.temp_id,
    question_number: w.question_number,
    question: w.question,
  }))
)}`;

  const stage2Props: Record<string, unknown> = {
    temp_id: { type: "STRING" },
    taxonomy_id: { type: "STRING" },
    candidate_2_id: { type: "STRING", nullable: true },
    difficulty: { type: "STRING" },
    cognitive_level: { type: "STRING" },
    problem_type: { type: "STRING" },
    solving_probability: { type: "INTEGER" },
    ai_reason: { type: "STRING" },
  };
  const stage2Req = [
    "temp_id",
    "taxonomy_id",
    "difficulty",
    "cognitive_level",
    "problem_type",
    "solving_probability",
    "ai_reason",
  ];
  if (opts.applyThinking) {
    stage2Props.thk_taxonomy_id = { type: "STRING", nullable: true };
  }

  const stage2Res = await callGeminiJson({
    model: CLASSIFY_MODEL,
    parts: [{ text: stage2Prompt }],
    responseSchema: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: stage2Props,
        required: stage2Req,
      },
    },
    preferredThinking: "LOW",
  });

  const stage2Map = new Map<string, DbRow>();
  if (Array.isArray(stage2Res)) {
    for (const r of stage2Res as DbRow[]) {
      if (r?.temp_id) stage2Map.set(String(r.temp_id), r);
    }
  }

  const resolveCanonicalTax = (
    rawId: unknown
  ): { taxId: string; catId: string; name: string } => {
    const clean = String(rawId || "").trim().toUpperCase();
    const hitItem = index.itemByUpper.get(clean);
    if (hitItem) {
      const cat = index.catByUpper.get(hitItem.category_id.toUpperCase());
      const fullName = cat
        ? [
            cat.depth1,
            cat.depth2,
            cat.depth3,
            cat.depth4,
            cat.depth5,
            cat.depth6,
            cat.depth7,
            hitItem.depth8,
          ]
            .filter(Boolean)
            .join(" > ")
        : hitItem.depth8;
      return { taxId: hitItem.item_id, catId: hitItem.category_id, name: fullName };
    }
    const hitCat = index.catByUpper.get(clean);
    if (hitCat) {
      const firstChild = (index.itemsByCatUpper.get(clean) || [])[0];
      if (firstChild) {
        const fullName = [
          hitCat.depth1,
          hitCat.depth2,
          hitCat.depth3,
          hitCat.depth4,
          hitCat.depth5,
          hitCat.depth6,
          hitCat.depth7,
          firstChild.depth8,
        ]
          .filter(Boolean)
          .join(" > ");
        return {
          taxId: firstChild.item_id,
          catId: hitCat.category_id,
          name: fullName,
        };
      }
      return {
        taxId: hitCat.category_id,
        catId: hitCat.category_id,
        name: hitCat.full_path,
      };
    }
    return { taxId: String(rawId || "").trim(), catId: "", name: "" };
  };

  let detectedPage: string | null = null;
  const analyzed: AnalyzedCaptureProblem[] = workingList.map((w) => {
    if (!detectedPage && w.final_printed_page) {
      detectedPage = w.final_printed_page;
    }
    const cls = stage2Map.get(w.temp_id) || {};
    const primary = resolveCanonicalTax(cls.taxonomy_id);
    const cand2Raw = String(cls.candidate_2_id || "").trim();
    const cand2 =
      cand2Raw && cand2Raw.toUpperCase() !== primary.taxId.toUpperCase()
        ? resolveCanonicalTax(cand2Raw)
        : null;

    let thkId: string | null = null;
    let thkName: string | null = null;
    if (opts.applyThinking && cls.thk_taxonomy_id) {
      const thkUpper = String(cls.thk_taxonomy_id).trim().toUpperCase();
      const hitThk = index.thkByUpper.get(thkUpper);
      if (hitThk) {
        thkId = hitThk.category_id;
        thkName = hitThk.full_path;
      }
    }

    const targetContext = buildTargetContext(index, primary.taxId, thkId);
    const normDiff = normalizeDiffKey(cls.difficulty);
    const cogStr = String(cls.cognitive_level || "");
    const pTypeStr = String(cls.problem_type || "");

    return {
      temp_id: w.temp_id,
      selectedForSave: true,
      question_number: w.question_number,
      sub_num: w.sub_num,
      sub_sub_num: w.sub_sub_num,
      final_printed_page: w.final_printed_page,
      question: w.question,
      taxonomy_id: primary.taxId,
      taxonomy_name: primary.name || targetContext.full_path,
      category_id: primary.catId || targetContext.category_id || "",
      candidate_2_id: cand2?.taxId || null,
      candidate_2_name: cand2?.name || null,
      thk_taxonomy_id: thkId,
      thk_taxonomy_name: thkName,
      difficulty: normDiff === "미지정" ? "중" : normDiff,
      cognitive_level: ["이해 및 연산", "적용 및 응용", "추론 및 문제 해결"].includes(
        cogStr
      )
        ? cogStr
        : "적용 및 응용",
      problem_type: ["MULTIPLE_CHOICE", "SUBJECTIVE", "DESCRIPTIVE"].includes(
        pTypeStr
      )
        ? pTypeStr
        : "SUBJECTIVE",
      solving_probability:
        typeof cls.solving_probability === "number" ? cls.solving_probability : 60,
      ai_reason: String(cls.ai_reason || ""),
      targetContext,
    };
  });

  return { detectedPage, problems: analyzed };
}

export interface GeneratedSolutionItem {
  answer: string;
  step_1_concept: string;
  step_2_approach: string;
  step_3_process: string;
  step_4_conclusion: string;
}

export async function generateSolutionsForProblems(opts: {
  imageBase64?: string | null;
  mimeType?: string;
  problems: { temp_id: string; question_number: string; question: string }[];
}): Promise<Record<string, GeneratedSolutionItem>> {
  if (!opts.problems || opts.problems.length === 0) return {};

  const parts: Array<Record<string, unknown>> = [];
  if (opts.imageBase64) {
    parts.push(makeInlineImagePart(opts.imageBase64, opts.mimeType));
  }
  parts.push({
    text: `당신은 수학 교재 집필팀의 정답·해설 검증 엔진입니다.
제시된 각 문항의 정확한 정답(answer)과 4단계 해설을 작성하십시오.
- 모든 수식은 달러($) LaTeX으로 감싸고, \\squarecm 같은 명령어+단위 붙임을 금지합니다.
- step_1_concept: 핵심 개념 1문장
- step_2_approach: 풀이 전략 1~2문장
- step_3_process: 식과 계산 과정 2~3문장
- step_4_conclusion: 정답 도출 마무리 1문장
- answer: 최종 정답만 간결하게 기입

대상 문항:
${JSON.stringify(opts.problems)}`,
  });

  const res = await callGeminiJson({
    model: SOLVE_MODEL,
    parts,
    responseSchema: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          temp_id: { type: "STRING" },
          answer: { type: "STRING" },
          step_1_concept: { type: "STRING" },
          step_2_approach: { type: "STRING" },
          step_3_process: { type: "STRING" },
          step_4_conclusion: { type: "STRING" },
        },
        required: [
          "temp_id",
          "answer",
          "step_1_concept",
          "step_2_approach",
          "step_3_process",
          "step_4_conclusion",
        ],
      },
    },
    preferredThinking: "LOW",
  });

  const out: Record<string, GeneratedSolutionItem> = {};
  if (Array.isArray(res)) {
    for (const r of res as DbRow[]) {
      if (r?.temp_id) {
        out[String(r.temp_id)] = {
          answer: String(r.answer || ""),
          step_1_concept: String(r.step_1_concept || ""),
          step_2_approach: String(r.step_2_approach || ""),
          step_3_process: String(r.step_3_process || ""),
          step_4_conclusion: String(r.step_4_conclusion || ""),
        };
      }
    }
  }
  return out;
}
