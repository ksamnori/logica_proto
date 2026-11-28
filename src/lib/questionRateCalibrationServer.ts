// src/lib/questionRateCalibrationServer.ts
// 문항 정답률(solving_probability) & 난이도(difficulty) 자동 보정 서버 엔진
// - Supabase PostgreSQL RPC(recalibrate_all_question_rates / recalibrate_questions_by_ids)가 설치되어 있으면
//   단일 DB 호출로 초고속 실행하고, 아직 SQL을 실행하기 전이라도 100% 동일한 수식(Rasch 1PL IRT + Empirical Bayes + Clamping)으로
//   TypeScript 서버 엔진이 자동 폴백하여 일괄 보정 및 실시간 단건 보정을 모두 수행합니다.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isConfidentialExamText, isConfidentialQuestionObj } from "@/lib/confidentialExamGuard";

export interface CalibrationPreviewItem {
  questionId: string;
  bookName: string;
  questionNumber: string;
  priorRate: number;
  priorWasNull: boolean;
  beforeRate: number | null;
  beforeDifficulty: string | null;
  sampleCount: number;
  rawRate: number;
  avgStudentTheta: number;
  irtRate: number;
  afterRate: number;
  afterDifficulty: string;
}

export interface BatchCalibrationResult {
  dryRun: boolean;
  engine: "postgres_rpc" | "typescript_fallback";
  dbTriggerInstalled: boolean;
  studentsEvaluated: number;
  calibratedQuestions: number;
  changedProbabilityCount: number;
  changedDifficultyCount: number;
  nullPriorCount: number;
  previewItems: CalibrationPreviewItem[];
}

export interface CalibrationStatusInfo {
  dbRpcInstalled: boolean;
  aiPriorColumnInstalled: boolean;
  totalCalibratedInDb: number;
  studentAbilityCachedCount: number;
  lastCalibratedAt: string | null;
}

interface PriorSnapshotEntry {
  prob: number | null;
  diff: string | null;
}

interface StudentAbilityCacheEntry {
  solvedCount: number;
  correctSum: number;
  expectedSum: number;
  theta: number;
}

interface ServerCalibrationMemoryCache {
  builtAt: number;
  studentAbilities: Map<string, StudentAbilityCacheEntry>;
  confidentialExamIds: Set<string>;
  wrongReviewExamIds: Set<string>;
  dummyStudentIds: Set<string>;
  priorsLoaded: boolean;
  priorsMap: Record<string, PriorSnapshotEntry>;
  hasAiPriorColumns: boolean | null;
  hasDbRpc: boolean | null;
}

const PRIOR_BACKUP_BUCKET = "system_data";
const PRIOR_BACKUP_PATH = "question_calibration/ai_priors_v1.json";
const ABILITY_CACHE_TTL_MS = 15 * 60 * 1000; // 15분 캐시

const PRE_TEST_STATUSES = new Set(["응시전", "미응시", "예정", "대기"]);
const DUMMY_STUDENT_REGEX = /(테스트|선생님)/;

export function getSupabaseAdminForCalibration(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function getMemoryState(): ServerCalibrationMemoryCache {
  const g = globalThis as unknown as {
    __logicaQuestionCalibrationCacheV1?: ServerCalibrationMemoryCache;
  };
  if (!g.__logicaQuestionCalibrationCacheV1) {
    g.__logicaQuestionCalibrationCacheV1 = {
      builtAt: 0,
      studentAbilities: new Map(),
      confidentialExamIds: new Set(),
      wrongReviewExamIds: new Set(),
      dummyStudentIds: new Set(),
      priorsLoaded: false,
      priorsMap: {},
      hasAiPriorColumns: null,
      hasDbRpc: null,
    };
  }
  return g.__logicaQuestionCalibrationCacheV1;
}

function invalidateFactoryStatsCache(): void {
  const g = globalThis as unknown as {
    __logicaFactoryStatsCacheV2?: { cache: unknown; inflight: unknown };
  };
  if (g.__logicaFactoryStatsCacheV2) {
    g.__logicaFactoryStatsCacheV2.cache = null;
  }
}

// ---------- examUtils.tsx 의 getDiffLabelByRate 와 100% 동일한 구간 (V3) ----------
export function getCalibratedDiffLabelByRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(Number(rate))) return "중";
  const r = Number(rate);
  if (r >= 80) return "최하";
  if (r >= 60) return "하";
  if (r >= 45) return "중";
  if (r >= 30) return "상";
  return "최상";
}

export function isWrongReviewExam(examType?: string | null, title?: string | null): boolean {
  const t = String(examType || "").normalize("NFC").trim();
  const ttl = String(title || "").normalize("NFC").trim();
  if (t === "오답프린트" || t === "오답") return true;
  if (/([0-9xX]+\s*주차|주차)/.test(ttl) && /오답\s*(프린트)?/.test(ttl)) return true;
  return false;
}

export function hasWrongAttemptLog(rawLog: unknown): boolean {
  if (!rawLog) return false;
  if (Array.isArray(rawLog)) return rawLog.length > 0;
  if (typeof rawLog === "string") {
    const s = rawLog.trim();
    if (!s || s === "[]" || s === "null" || s === "NULL" || s === "{}") return false;
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed);
    } catch {
      return true;
    }
  }
  return false;
}

export function firstTryScoreOfGradingCode(
  code?: string | null,
  isCorrectFallback?: boolean | null,
  wrongAttemptsLog?: unknown
): number {
  if (hasWrongAttemptLog(wrongAttemptsLog)) return 0.0;
  const c = String(code || "").trim();
  if (c) {
    if (c === "O" || c === "a" || c === "b" || c === "c") return 1.0;
    return 0.0;
  }
  if (isCorrectFallback === true) return 1.0;
  return 0.0;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function logit(prob: number): number {
  const p = clamp(prob, 0.001, 0.999);
  return Math.log(p / (1.0 - p));
}

function sigmoid(z: number): number {
  const cz = clamp(z, -20.0, 20.0);
  return 1.0 / (1.0 + Math.exp(-cz));
}

/**
 * 50%를 기준으로 중심부 밀집 문항들을 양쪽으로 점진 확장 (45% -> 40%, 55% -> 60%, 최저 15% ~ 최대 95%)
 */
export function spreadRateAround50(val: number): number {
  if (!Number.isFinite(val)) return 50.0;
  if (val <= 15.0) return 15.0;
  if (val >= 95.0) return 95.0;
  if (val < 50.0) {
    return 50.0 - 35.0 * Math.pow((50.0 - val) / 35.0, 0.6438);
  }
  if (val > 50.0) {
    return 50.0 + 45.0 * Math.pow((val - 50.0) / 45.0, 0.6845);
  }
  return 50.0;
}

export function questionHashUnit(questionId?: string | null): number {
  const s = String(questionId || "");
  if (!s) return 0.0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (((h >>> 0) % 2001) - 1000) / 1000.0;
}

export interface QuestionPriorMetaHint {
  questionId?: string | null;
  aiDifficulty?: string | null;
  questionNumber?: string | null;
  bookText?: string | null;
  cognitiveLevel?: string | null;
  problemType?: string | null;
}

export function resolvePreSpreadPrior(
  aiPrior: number | null | undefined,
  meta?: QuestionPriorMetaHint
): number {
  const qnum = String(meta?.questionNumber || "").trim();
  const book = String(meta?.bookText || "").trim();
  const cog = String(meta?.cognitiveLevel || "").trim();
  const ptype = String(meta?.problemType || "").trim();
  const aiDiff = String(meta?.aiDifficulty || "").trim();
  const hashU = questionHashUnit(meta?.questionId);

  let posAdj = 0.0;
  if (/(도전|킬러|심화|창의|고난도|최상|올림피아드)/.test(qnum)) {
    posAdj = -7.5;
  } else if (/(확인|예제|유제|기초|연산|개념|워밍업|기본)/.test(qnum)) {
    posAdj = 6.5;
  } else {
    const m = qnum.match(/^[0-9]{1,3}/);
    if (m) {
      const n = parseInt(m[0], 10);
      if (n >= 1 && n <= 3) posAdj = 5.0;
      else if (n <= 7) posAdj = 2.5;
      else if (n <= 12) posAdj = 0.0;
      else if (n <= 16) posAdj = -3.0;
      else if (n >= 17) posAdj = -6.0;
    }
  }

  let bookAdj = 0.0;
  if (/(MAX|최상위|경시|올림피아드|킬러|심화)/i.test(book)) bookAdj = -4.5;
  else if (/(입문|기초|연산|CORE|베이직|개념)/i.test(book)) bookAdj = 4.5;

  let cogAdj = 0.0;
  if (cog === "이해 및 연산") cogAdj += 4.0;
  else if (cog === "추론 및 문제 해결") cogAdj -= 3.5;
  if (/^(ESSAY|DESCRIPTIVE)$/i.test(ptype) || ptype.includes("서술")) cogAdj -= 2.5;

  const cue = clamp(posAdj + bookAdj + cogAdj, -12.0, 12.0);
  const hasExplicitNon50 =
    aiPrior !== null && aiPrior !== undefined && Number.isFinite(Number(aiPrior)) && Number(aiPrior) !== 50;

  let base: number;
  if (hasExplicitNon50) {
    const r = clamp(Number(aiPrior), 15.0, 100.0);
    const drop = 4.0 + 8.0 * ((r - 15.0) / 85.0);
    base = r - drop + cue * 0.25 + hashU * 2.2;
  } else {
    if (aiDiff === "최하") base = 76.0 + cue * 0.35 + hashU * 4.0;
    else if (aiDiff === "하") base = 58.5 + cue * 0.45 + hashU * 4.5;
    else if (aiDiff === "상") base = 41.5 + cue * 0.45 + hashU * 4.5;
    else if (aiDiff === "최상") base = 28.5 + cue * 0.35 + hashU * 4.0;
    else base = 50.0 + cue * 0.75 + hashU * 4.8;
  }
  return clamp(base, 15.0, 95.0);
}

/**
 * 전 문항 하향 + 50% 중심 점진 분산 반영 기준값 (범위 15~95%)
 */
export function computeLoweredPriorRate(
  aiPrior: number | null | undefined,
  meta?: QuestionPriorMetaHint
): number {
  const pre = resolvePreSpreadPrior(aiPrior, meta);
  return Math.round(clamp(spreadRateAround50(pre), 15.0, 95.0));
}

export function computeStudentThetaLogit(
  solvedCount: number,
  correctSum: number,
  expectedSum: number
): number {
  if (solvedCount <= 0) return 0.0;
  const K = 15.0;
  const avgExp = clamp(expectedSum / solvedCount, 0.15, 0.9);
  const shrunkProb = clamp((K * avgExp + correctSum) / (K + solvedCount), 0.05, 0.95);
  return clamp(logit(shrunkProb) - logit(avgExp), -1.5, 1.5);
}

/**
 * Rasch 1PL IRT + 50% 중심 점진 확장(45%->40%, 55%->60%) + 15~95% 엄격 제한 (V3)
 */
export function computeCalibratedQuestionRate(
  aiPrior: number | null | undefined,
  sampleCount: number,
  correctSum: number,
  avgStudentTheta: number,
  meta?: QuestionPriorMetaHint
): {
  priorRate: number;
  priorWasNull: boolean;
  irtRate: number;
  afterRate: number;
  afterDifficulty: string;
} {
  const priorWasNull = aiPrior === null || aiPrior === undefined || !Number.isFinite(Number(aiPrior));
  const prePrior = resolvePreSpreadPrior(aiPrior, meta);
  const priorRate = Math.round(clamp(spreadRateAround50(prePrior), 15.0, 95.0));

  if (sampleCount <= 0) {
    return {
      priorRate,
      priorWasNull,
      irtRate: priorRate,
      afterRate: priorRate,
      afterDifficulty: getCalibratedDiffLabelByRate(priorRate),
    };
  }

  const p0 = clamp(prePrior / 100.0, 0.15, 0.95);
  const effTheta = clamp((Number.isFinite(avgStudentTheta) ? avgStudentTheta : 0.0) + 0.22, -1.2, 1.8);
  const expectedForGroup = sigmoid(logit(p0) + effTheta);
  const safeCorrect = clamp(correctSum, 0.0, sampleCount);
  const pShrunk = clamp((1.8 * expectedForGroup + safeCorrect) / (1.8 + sampleCount), 0.02, 0.98);
  let irtPre = sigmoid(logit(pShrunk) - effTheta) * 100.0;

  if (irtPre > 76.0) {
    irtPre = 76.0 + (irtPre - 76.0) * 0.78;
  }

  const M = priorWasNull || Number(aiPrior) === 50 ? 6.5 : 9.5;
  const preBlended = (M * prePrior + sampleCount * irtPre) / (M + sampleCount);
  const afterRate = Math.round(clamp(spreadRateAround50(preBlended), 15.0, 95.0));
  const irtSpread = Math.round(clamp(spreadRateAround50(irtPre), 15.0, 95.0) * 10) / 10;

  return {
    priorRate,
    priorWasNull,
    irtRate: irtSpread,
    afterRate,
    afterDifficulty: getCalibratedDiffLabelByRate(afterRate),
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function isMissingRpcOrSchemaError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || err.details || "");
  return (
    code === "PGRST202" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42883" ||
    code === "42703" ||
    code === "42P01" ||
    /(function|column|relation|table|schema cache).*(does not exist|not find)/i.test(msg)
  );
}

async function detectDbCapabilities(supabaseAdmin: SupabaseClient): Promise<{
  hasDbRpc: boolean;
  hasAiPriorColumns: boolean;
}> {
  const mem = getMemoryState();
  if (mem.hasDbRpc === true && mem.hasAiPriorColumns === true) {
    return { hasDbRpc: true, hasAiPriorColumns: true };
  }

  let hasAiPriorColumns = false;
  const colCheck = await supabaseAdmin
    .from("question_db")
    .select("question_id, ai_solving_probability, ai_difficulty, calibrated_sample_count, calibrated_at")
    .limit(1);
  if (!colCheck.error) {
    hasAiPriorColumns = true;
  }

  let hasDbRpc = false;
  const rpcCheck = await supabaseAdmin.rpc("recalibrate_questions_by_ids", {
    p_question_ids: [],
  });
  if (!rpcCheck.error) {
    hasDbRpc = true;
  }

  mem.hasAiPriorColumns = hasAiPriorColumns;
  mem.hasDbRpc = hasDbRpc;
  return { hasDbRpc, hasAiPriorColumns };
}

export async function getCalibrationSystemStatus(
  supabaseAdmin: SupabaseClient
): Promise<CalibrationStatusInfo> {
  const { hasDbRpc, hasAiPriorColumns } = await detectDbCapabilities(supabaseAdmin);
  let totalCalibratedInDb = 0;
  let studentAbilityCachedCount = 0;
  let lastCalibratedAt: string | null = null;

  if (hasAiPriorColumns) {
    const [{ count: qCnt }, { data: latestRow }] = await Promise.all([
      supabaseAdmin
        .from("question_db")
        .select("question_id", { count: "exact", head: true })
        .gt("calibrated_sample_count", 0),
      supabaseAdmin
        .from("question_db")
        .select("calibrated_at")
        .not("calibrated_at", "is", null)
        .order("calibrated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    totalCalibratedInDb = Number(qCnt || 0);
    lastCalibratedAt = latestRow?.calibrated_at || null;
  }

  if (hasDbRpc) {
    const { count: stuCnt } = await supabaseAdmin
      .from("student_ability_stat")
      .select("student_id", { count: "exact", head: true });
    studentAbilityCachedCount = Number(stuCnt || 0);
  } else {
    const mem = getMemoryState();
    studentAbilityCachedCount = mem.studentAbilities.size;
  }

  return {
    dbRpcInstalled: hasDbRpc,
    aiPriorColumnInstalled: hasAiPriorColumns,
    totalCalibratedInDb,
    studentAbilityCachedCount,
    lastCalibratedAt,
  };
}

// SQL 미적용 환경에서 원본 AI 예측치를 영구 보존하기 위한 Storage 백업 로더/세이버
async function loadFallbackPriorBackup(
  supabaseAdmin: SupabaseClient
): Promise<Record<string, PriorSnapshotEntry>> {
  const mem = getMemoryState();
  if (mem.priorsLoaded) return mem.priorsMap;

  try {
    const { data, error } = await supabaseAdmin.storage
      .from(PRIOR_BACKUP_BUCKET)
      .download(PRIOR_BACKUP_PATH);
    if (!error && data) {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        mem.priorsMap = parsed;
      }
    }
  } catch {
    // 최초 실행 시 파일 없음 정상 무시
  }
  mem.priorsLoaded = true;
  return mem.priorsMap;
}

async function saveFallbackPriorBackup(
  supabaseAdmin: SupabaseClient,
  priorsMap: Record<string, PriorSnapshotEntry>
): Promise<void> {
  try {
    const payload = Buffer.from(JSON.stringify(priorsMap), "utf-8");
    await supabaseAdmin.storage.from(PRIOR_BACKUP_BUCKET).upload(PRIOR_BACKUP_PATH, payload, {
      upsert: true,
      contentType: "application/json",
    });
  } catch {
    // Storage 버킷 정책 미설정 시에도 메모리 캐시는 유지됨
  }
}

async function fetchAllPaged(
  supabaseAdmin: SupabaseClient,
  table: string,
  selectCols: string,
  orderCol: string,
  customize?: (q: any) => any
): Promise<any[]> {
  const rows: any[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    let q: any = supabaseAdmin
      .from(table)
      .select(selectCols)
      .order(orderCol, { ascending: true })
      .range(from, from + pageSize - 1);
    if (customize) q = customize(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

interface DedupObservation {
  studentId: string;
  questionId: string;
  score: number;
  rank: number;
}

/**
 * TypeScript 폴백 전체 DB 스캔 & 보정 엔진 (SQL 미적용 시에도 즉시 작동)
 */
async function runFullCalibrationTypeScript(
  supabaseAdmin: SupabaseClient,
  dryRun: boolean,
  hasAiPriorColumns: boolean
): Promise<BatchCalibrationResult> {
  const priorsBackup = hasAiPriorColumns ? {} : await loadFallbackPriorBackup(supabaseAdmin);

  // 1. 학생, 시험 마스터, 교재-문항 매핑 병렬 로드
  const [students, examMasters, tqRows] = await Promise.all([
    fetchAllPaged(supabaseAdmin, "student", "student_id, name", "student_id"),
    fetchAllPaged(supabaseAdmin, "exam_master", "exam_id, title, exam_type", "exam_id"),
    fetchAllPaged(
      supabaseAdmin,
      "textbook_question",
      "tq_id, question_id, difficulty",
      "tq_id",
      (q) => q.not("question_id", "is", null)
    ),
  ]);

  const validStudentIds = new Set<string>();
  const dummyStudentIds = new Set<string>();
  for (const s of students) {
    const sid = String(s.student_id || "").trim();
    if (!sid) continue;
    const cleanName = String(s.name || "").replace(/\s+/g, "");
    if (DUMMY_STUDENT_REGEX.test(cleanName)) {
      dummyStudentIds.add(sid);
    } else {
      validStudentIds.add(sid);
    }
  }

  const confidentialExamIds = new Set<string>();
  const wrongReviewExamIds = new Set<string>();
  for (const em of examMasters) {
    const eid = String(em.exam_id || "").trim();
    if (!eid) continue;
    if (isConfidentialExamText(em.exam_type) || isConfidentialExamText(em.title)) {
      confidentialExamIds.add(eid);
    } else if (isWrongReviewExam(em.exam_type, em.title)) {
      wrongReviewExamIds.add(eid);
    }
  }

  const tqToQid = new Map<string, string>();
  const tqDiffByQid = new Map<string, Array<{ tq_id: any; difficulty: string | null }>>();
  for (const tq of tqRows) {
    const qid = String(tq.question_id || "").trim();
    if (!qid) continue;
    tqToQid.set(String(tq.tq_id), qid);
    if (!tqDiffByQid.has(qid)) tqDiffByQid.set(qid, []);
    tqDiffByQid.get(qid)!.push({ tq_id: tq.tq_id, difficulty: tq.difficulty ?? null });
  }

  // 대외비 시험지에 포함된 문항 ID 수집
  const confidentialQidsFromExamItem = new Set<string>();
  if (confidentialExamIds.size > 0) {
    for (const chunk of chunkArray(Array.from(confidentialExamIds), 150)) {
      const { data: eiRows } = await supabaseAdmin
        .from("exam_item")
        .select("question_id")
        .in("exam_id", chunk);
      for (const r of eiRows || []) {
        if (r?.question_id) confidentialQidsFromExamItem.add(String(r.question_id).trim());
      }
    }
  }

  // 2. 시험 배정 및 채점된 시험·과제 답안·오답노트 로드
  const [assignments, rawExamAnswers, rawHwAnswers, rawIncorrectRecords] = await Promise.all([
    fetchAllPaged(
      supabaseAdmin,
      "exam_assignment",
      "assignment_id, exam_id, admission_session_id, status",
      "assignment_id"
    ),
    fetchAllPaged(
      supabaseAdmin,
      "student_answer",
      "answer_id, student_id, exam_assignment_id, question_id, attempt_number, grading_code, is_correct, wrong_attempts_log, updated_at",
      "answer_id"
    ),
    fetchAllPaged(
      supabaseAdmin,
      "student_homework_answer",
      "hw_answer_id, student_id, tq_id, question_id, grading_code, is_correct, wrong_attempts_log, updated_at",
      "hw_answer_id"
    ),
    fetchAllPaged(
      supabaseAdmin,
      "student_incorrect_record",
      "record_id, student_id, tq_id, question_id, source_type",
      "record_id"
    ),
  ]);

  const excludedAssignmentIds = new Set<string>();
  for (const a of assignments) {
    const aid = String(a.assignment_id ?? "").trim();
    const eid = String(a.exam_id ?? "").trim();
    if (!aid) continue;
    if (a.admission_session_id || confidentialExamIds.has(eid) || wrongReviewExamIds.has(eid)) {
      excludedAssignmentIds.add(aid);
    }
  }

  // 3. 학생 × 문항별 엄격 오답 우선(한 번이라도 틀렸으면 0.0) 중복 제거
  const dedupMap = new Map<string, DedupObservation>();
  const upsertDedup = (sid: string, qid: string, score: number, rank: number) => {
    const key = `${sid}|${qid}`;
    const prev = dedupMap.get(key);
    if (!prev) {
      dedupMap.set(key, { studentId: sid, questionId: qid, score, rank });
    } else {
      prev.score = Math.min(prev.score, score);
      if (rank < prev.rank) prev.rank = rank;
    }
  };

  for (const sa of rawExamAnswers) {
    const code = String(sa.grading_code || "").trim();
    if (!code && typeof sa.is_correct !== "boolean") continue;
    const sid = String(sa.student_id || "").trim();
    const aid = String(sa.exam_assignment_id ?? "").trim();
    const qid = String(sa.question_id || "").trim();
    if (!sid || !qid || !validStudentIds.has(sid) || excludedAssignmentIds.has(aid)) continue;
    if (confidentialQidsFromExamItem.has(qid)) continue;

    const ts = sa.updated_at ? new Date(sa.updated_at).getTime() : 0;
    const attempt = Number(sa.attempt_number) || 1;
    const rank = ts * 100 + Math.min(99, attempt);
    upsertDedup(sid, qid, firstTryScoreOfGradingCode(code, sa.is_correct, sa.wrong_attempts_log), rank);
  }

  for (const sha of rawHwAnswers) {
    const code = String(sha.grading_code || "").trim();
    if (!code && typeof sha.is_correct !== "boolean") continue;
    const sid = String(sha.student_id || "").trim();
    if (!sid || !validStudentIds.has(sid)) continue;
    const rawQid = String(sha.question_id || "").trim();
    const qid = rawQid || (sha.tq_id != null ? tqToQid.get(String(sha.tq_id)) || "" : "");
    if (!qid || confidentialQidsFromExamItem.has(qid)) continue;

    const ts = sha.updated_at ? new Date(sha.updated_at).getTime() : 0;
    const rank = ts * 100 + 50;
    upsertDedup(sid, qid, firstTryScoreOfGradingCode(code, sha.is_correct, sha.wrong_attempts_log), rank);
  }

  for (const sir of rawIncorrectRecords) {
    if (isConfidentialExamText(sir.source_type)) continue;
    const sid = String(sir.student_id || "").trim();
    if (!sid || !validStudentIds.has(sid)) continue;
    const rawQid = String(sir.question_id || "").trim();
    const rawTq = String(sir.tq_id ?? "").trim();
    const qid =
      rawQid ||
      (rawTq ? (rawTq.includes("-") ? rawTq : tqToQid.get(rawTq) || "") : "");
    if (!qid || confidentialQidsFromExamItem.has(qid)) continue;
    upsertDedup(sid, qid, 0.0, 0);
  }

  const candidateQids = Array.from(new Set(Array.from(dedupMap.values()).map((o) => o.questionId)));

  // 4. 후보 문항들의 question_db 메타 로드
  const qSelectCols: string = hasAiPriorColumns
    ? "question_id, book_name, source_book_name, pdf_source, raw_source_tags, question_number, solving_probability, difficulty, ai_solving_probability, ai_difficulty, calibrated_sample_count"
    : "question_id, book_name, source_book_name, pdf_source, raw_source_tags, question_number, solving_probability, difficulty";

  const questionMap = new Map<string, any>();
  for (const chunk of chunkArray(candidateQids, 200)) {
    const { data: qRows, error: qErr } = await supabaseAdmin
      .from("question_db")
      .select<string, any>(qSelectCols)
      .in("question_id", chunk);
    if (qErr) throw new Error(`question_db 조회 실패: ${qErr.message}`);
    for (const q of qRows || []) {
      if (!q?.question_id) continue;
      if (isConfidentialQuestionObj(q)) continue;
      const qid = String(q.question_id).trim();
      questionMap.set(qid, q);
    }
  }

  // 원본 AI 기준값 확정 (DB 컬럼 우선, 없으면 Storage 스냅샷 보존)
  let backupMutated = false;
  const resolvePriorOfQuestion = (qid: string, qRow: any): PriorSnapshotEntry => {
    if (hasAiPriorColumns) {
      const wasCalibrated = Number(qRow.calibrated_sample_count || 0) > 0;
      return {
        prob: wasCalibrated
          ? qRow.ai_solving_probability ?? null
          : qRow.ai_solving_probability ?? qRow.solving_probability ?? null,
        diff: wasCalibrated
          ? qRow.ai_difficulty ?? null
          : qRow.ai_difficulty ?? qRow.difficulty ?? null,
      };
    }
    if (!(qid in priorsBackup)) {
      priorsBackup[qid] = {
        prob:
          qRow.solving_probability !== null && qRow.solving_probability !== undefined
            ? Number(qRow.solving_probability)
            : null,
        diff: qRow.difficulty ?? null,
      };
      backupMutated = true;
    }
    return priorsBackup[qid];
  };

  // 5. 학생별 난이도 대비 실력 지수(theta) 계산
  const stuAgg = new Map<string, { n: number; c: number; e: number }>();
  const obsByQid = new Map<string, DedupObservation[]>();

  for (const obs of dedupMap.values()) {
    const qRow = questionMap.get(obs.questionId);
    if (!qRow) continue;

    const priorInfo = resolvePriorOfQuestion(obs.questionId, qRow);
    const p0 = computeLoweredPriorRate(priorInfo.prob) / 100.0;

    if (!stuAgg.has(obs.studentId)) stuAgg.set(obs.studentId, { n: 0, c: 0, e: 0 });
    const sa = stuAgg.get(obs.studentId)!;
    sa.n += 1;
    sa.c += obs.score;
    sa.e += p0;

    if (!obsByQid.has(obs.questionId)) obsByQid.set(obs.questionId, []);
    obsByQid.get(obs.questionId)!.push(obs);
  }

  const studentAbilities = new Map<string, StudentAbilityCacheEntry>();
  for (const [sid, st] of stuAgg.entries()) {
    studentAbilities.set(sid, {
      solvedCount: st.n,
      correctSum: st.c,
      expectedSum: st.e,
      theta: computeStudentThetaLogit(st.n, st.c, st.e),
    });
  }

  // 메모리 캐시 갱신 (이후 실시간 단건 보정에서 즉시 재사용)
  const mem = getMemoryState();
  mem.builtAt = Date.now();
  mem.studentAbilities = studentAbilities;
  mem.confidentialExamIds = confidentialExamIds;
  mem.wrongReviewExamIds = wrongReviewExamIds;
  mem.dummyStudentIds = dummyStudentIds;

  // 6. 문항별 보정 계산
  const computedAll: Array<
    CalibrationPreviewItem & { origPriorProb: number | null; origPriorDiff: string | null }
  > = [];

  for (const [qid, obsList] of obsByQid.entries()) {
    const qRow = questionMap.get(qid);
    if (!qRow || obsList.length === 0) continue;

    const priorInfo = resolvePriorOfQuestion(qid, qRow);
    const n = obsList.length;
    let cSum = 0;
    let thetaSum = 0;
    for (const o of obsList) {
      cSum += o.score;
      thetaSum += studentAbilities.get(o.studentId)?.theta ?? 0.0;
    }
    const avgTheta = thetaSum / n;
    const calc = computeCalibratedQuestionRate(priorInfo.prob, n, cSum, avgTheta);

    computedAll.push({
      questionId: qid,
      bookName: String(qRow.book_name || qRow.source_book_name || qRow.pdf_source || "미지정 교재"),
      questionNumber: String(qRow.question_number || "-"),
      priorRate: calc.priorRate,
      priorWasNull: calc.priorWasNull,
      beforeRate: qRow.solving_probability ?? null,
      beforeDifficulty: qRow.difficulty ?? null,
      sampleCount: n,
      rawRate: Math.round((cSum / n) * 1000) / 10,
      avgStudentTheta: Math.round(avgTheta * 1000) / 1000,
      irtRate: calc.irtRate,
      afterRate: calc.afterRate,
      afterDifficulty: calc.afterDifficulty,
      origPriorProb: priorInfo.prob,
      origPriorDiff: priorInfo.diff,
    });
  }

  const changedProbItems = computedAll.filter((it) => it.beforeRate !== it.afterRate);
  const changedDiffItems = computedAll.filter(
    (it) => String(it.beforeDifficulty || "") !== it.afterDifficulty
  );
  const nullPriorCount = computedAll.filter((it) => it.priorWasNull).length;

  if (!dryRun) {
    if (!hasAiPriorColumns && backupMutated) {
      await saveFallbackPriorBackup(supabaseAdmin, priorsBackup);
    }

    const toUpdate = computedAll.filter(
      (it) =>
        it.beforeRate !== it.afterRate ||
        String(it.beforeDifficulty || "") !== it.afterDifficulty ||
        hasAiPriorColumns
    );

    const nowIso = new Date().toISOString();
    for (const batch of chunkArray(toUpdate, 40)) {
      await Promise.all(
        batch.map(async (item) => {
          const payload: Record<string, any> = {
            solving_probability: item.afterRate,
            difficulty: item.afterDifficulty,
          };
          if (
            item.beforeRate !== item.afterRate ||
            String(item.beforeDifficulty || "") !== item.afterDifficulty
          ) {
            payload.updated_at = nowIso;
          }
          if (hasAiPriorColumns) {
            payload.ai_solving_probability = item.origPriorProb;
            payload.ai_difficulty = item.origPriorDiff;
            payload.calibrated_sample_count = item.sampleCount;
            payload.calibrated_at = nowIso;
          }

          await supabaseAdmin
            .from("question_db")
            .update(payload)
            .eq("question_id", item.questionId);

          const linkedTqs = tqDiffByQid.get(item.questionId) || [];
          const staleTqIds = linkedTqs
            .filter((t) => t.difficulty !== item.afterDifficulty)
            .map((t) => t.tq_id);
          if (staleTqIds.length > 0) {
            await supabaseAdmin
              .from("textbook_question")
              .update({ difficulty: item.afterDifficulty })
              .in("tq_id", staleTqIds);
          }
        })
      );
    }

    invalidateFactoryStatsCache();
  }

  const previewItems = [...computedAll]
    .sort(
      (a, b) =>
        Math.abs(b.afterRate - (b.beforeRate ?? 50)) -
          Math.abs(a.afterRate - (a.beforeRate ?? 50)) || b.sampleCount - a.sampleCount
    )
    .slice(0, 50)
    .map(({ origPriorProb: _p, origPriorDiff: _d, ...rest }) => rest);

  return {
    dryRun,
    engine: "typescript_fallback",
    dbTriggerInstalled: false,
    studentsEvaluated: studentAbilities.size,
    calibratedQuestions: computedAll.length,
    changedProbabilityCount: changedProbItems.length,
    changedDifficultyCount: changedDiffItems.length,
    nullPriorCount,
    previewItems,
  };
}

/**
 * 전체 DB 일괄 보정 진입점 (Dry-run 시뮬레이션 & 실제 반영 공용)
 */
export async function runBatchQuestionCalibration(
  supabaseAdmin: SupabaseClient,
  dryRun: boolean
): Promise<BatchCalibrationResult> {
  const { hasDbRpc, hasAiPriorColumns } = await detectDbCapabilities(supabaseAdmin);

  if (hasDbRpc) {
    const { data, error } = await supabaseAdmin.rpc("recalibrate_all_question_rates", {
      p_dry_run: dryRun,
    });
    if (!error && data) {
      if (!dryRun) invalidateFactoryStatsCache();
      return {
        dryRun: Boolean(data.dryRun),
        engine: "postgres_rpc",
        dbTriggerInstalled: true,
        studentsEvaluated: Number(data.studentsEvaluated || 0),
        calibratedQuestions: Number(data.calibratedQuestions || 0),
        changedProbabilityCount: Number(data.changedProbabilityCount || 0),
        changedDifficultyCount: Number(data.changedDifficultyCount || 0),
        nullPriorCount: Number(data.nullPriorCount || 0),
        previewItems: Array.isArray(data.previewItems) ? data.previewItems : [],
      };
    }
    if (!isMissingRpcOrSchemaError(error)) {
      throw new Error(`DB 일괄 보정 RPC 실행 오류: ${error?.message}`);
    }
  }

  return runFullCalibrationTypeScript(supabaseAdmin, dryRun, hasAiPriorColumns);
}

export interface RealtimeCalibrationTargetInput {
  questionIds?: Array<string | number | null | undefined>;
  tqIds?: Array<string | number | null | undefined>;
  assignmentIds?: Array<string | number | null | undefined>;
  examIds?: Array<string | null | undefined>;
  homeworkIds?: Array<string | number | null | undefined>;
  studentIds?: Array<string | null | undefined>;
}

/**
 * 채점·수정·삭제 발생 시 영향받은 소수 문항만 즉시 재보정하는 실시간 엔드포인트 엔진
 */
export async function runRealtimeQuestionCalibration(
  supabaseAdmin: SupabaseClient,
  input: RealtimeCalibrationTargetInput
): Promise<{ ok: true; engine: string; targetQuestionCount: number; updatedCount: number }> {
  const qidSet = new Set<string>();
  const tqIdNums = new Set<number>();
  const studentIdSet = new Set<string>();

  for (const raw of input.questionIds || []) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    if (!s.includes("-") && !isNaN(Number(s))) {
      tqIdNums.add(Number(s));
    } else {
      qidSet.add(s);
    }
  }

  for (const raw of input.tqIds || []) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    if (s.includes("-")) qidSet.add(s);
    else if (!isNaN(Number(s))) tqIdNums.add(Number(s));
  }

  for (const sid of input.studentIds || []) {
    const s = String(sid ?? "").trim();
    if (s) studentIdSet.add(s);
  }

  const assignIds = Array.from(
    new Set(
      (input.assignmentIds || [])
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  ).slice(0, 50);

  if (assignIds.length > 0) {
    const { data: asgRows } = await supabaseAdmin
      .from("exam_assignment")
      .select("exam_id, student_id, admission_session_id, exam_master(exam_type, title)")
      .in("assignment_id", assignIds);

    const regularExamIds: string[] = [];
    for (const a of asgRows || []) {
      if (a.admission_session_id) continue;
      const em: any = Array.isArray(a.exam_master) ? a.exam_master[0] : a.exam_master;
      if (isConfidentialExamText(em?.exam_type) || isConfidentialExamText(em?.title)) continue;
      if (isWrongReviewExam(em?.exam_type, em?.title)) continue;
      if (a.student_id) studentIdSet.add(String(a.student_id));
      if (a.exam_id) regularExamIds.push(String(a.exam_id));
    }

    if (regularExamIds.length > 0) {
      const { data: eiRows } = await supabaseAdmin
        .from("exam_item")
        .select("question_id")
        .in("exam_id", Array.from(new Set(regularExamIds)));
      for (const ei of eiRows || []) {
        if (ei?.question_id) qidSet.add(String(ei.question_id).trim());
      }
    }
  }

  const directExamIds = Array.from(
    new Set((input.examIds || []).map((v) => String(v ?? "").trim()).filter(Boolean))
  ).slice(0, 50);

  if (directExamIds.length > 0) {
    const [{ data: emRows }, { data: eiRows }] = await Promise.all([
      supabaseAdmin.from("exam_master").select("exam_id, exam_type, title").in("exam_id", directExamIds),
      supabaseAdmin.from("exam_item").select("exam_id, question_id").in("exam_id", directExamIds),
    ]);
    const allowedExamSet = new Set<string>();
    for (const em of emRows || []) {
      if (isConfidentialExamText(em?.exam_type) || isConfidentialExamText(em?.title)) continue;
      if (isWrongReviewExam(em?.exam_type, em?.title)) continue;
      allowedExamSet.add(String(em.exam_id));
    }
    for (const ei of eiRows || []) {
      if (ei?.question_id && allowedExamSet.has(String(ei.exam_id))) {
        qidSet.add(String(ei.question_id).trim());
      }
    }
  }

  const hwIds = Array.from(
    new Set(
      (input.homeworkIds || [])
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  ).slice(0, 50);

  if (hwIds.length > 0) {
    const { data: hwRows } = await supabaseAdmin
      .from("homework_assignment")
      .select("target_questions")
      .in("homework_id", hwIds);
    for (const h of hwRows || []) {
      let arr: any = h.target_questions;
      if (typeof arr === "string") {
        try {
          arr = JSON.parse(arr);
        } catch {
          arr = [];
        }
      }
      if (Array.isArray(arr)) {
        for (const v of arr) {
          const sv = String(v ?? "").trim();
          if (!sv) continue;
          if (sv.includes("-")) qidSet.add(sv);
          else if (!isNaN(Number(sv))) tqIdNums.add(Number(sv));
        }
      }
    }
  }

  if (tqIdNums.size > 0) {
    for (const chunk of chunkArray(Array.from(tqIdNums), 200)) {
      const { data: tqRows } = await supabaseAdmin
        .from("textbook_question")
        .select("question_id")
        .in("tq_id", chunk);
      for (const r of tqRows || []) {
        if (r?.question_id) qidSet.add(String(r.question_id).trim());
      }
    }
  }

  const targetQuestionIds = Array.from(qidSet).filter(Boolean).slice(0, 200);
  if (targetQuestionIds.length === 0) {
    return { ok: true, engine: "noop", targetQuestionCount: 0, updatedCount: 0 };
  }

  const { hasDbRpc, hasAiPriorColumns } = await detectDbCapabilities(supabaseAdmin);

  // 1) PostgreSQL RPC 가 설치되어 있으면 초고속 단일 호출 처리
  if (hasDbRpc) {
    if (studentIdSet.size > 0) {
      await supabaseAdmin.rpc("refresh_student_ability_stats", {
        p_student_ids: Array.from(studentIdSet).slice(0, 100),
      });
    }
    const { data, error } = await supabaseAdmin.rpc("recalibrate_questions_by_ids", {
      p_question_ids: targetQuestionIds,
    });
    if (!error) {
      invalidateFactoryStatsCache();
      return {
        ok: true,
        engine: "postgres_rpc",
        targetQuestionCount: targetQuestionIds.length,
        updatedCount: Number(data?.updatedCount || 0),
      };
    }
  }

  // 2) SQL 미적용 환경 폴백: 대상 문항들만 경량 조회하여 즉시 보정
  const mem = getMemoryState();
  const priorsBackup = hasAiPriorColumns ? {} : await loadFallbackPriorBackup(supabaseAdmin);

  // 학생 실력 캐시가 비어 있거나 오래되었고, 요청된 학생들의 실력만 빠르게 보완
  const studentIdsArr = Array.from(studentIdSet);
  if (studentIdsArr.length > 0) {
    await refreshSpecificStudentsAbilityFallback(supabaseAdmin, studentIdsArr, hasAiPriorColumns, priorsBackup);
  }

  const qSelectCols: string = hasAiPriorColumns
    ? "question_id, source_book_name, book_name, pdf_source, raw_source_tags, solving_probability, difficulty, ai_solving_probability, ai_difficulty, calibrated_sample_count"
    : "question_id, source_book_name, book_name, pdf_source, raw_source_tags, solving_probability, difficulty";

  const [{ data: qRows }, { data: eiConfRows }, { data: tqLinkedRows }] = await Promise.all([
    supabaseAdmin.from("question_db").select<string, any>(qSelectCols).in("question_id", targetQuestionIds),
    supabaseAdmin
      .from("exam_item")
      .select("question_id, exam_master!inner(exam_type, title)")
      .in("question_id", targetQuestionIds),
    supabaseAdmin
      .from("textbook_question")
      .select("tq_id, question_id, difficulty")
      .in("question_id", targetQuestionIds),
  ]);

  const blockedQids = new Set<string>();
  for (const ei of eiConfRows || []) {
    const em: any = Array.isArray(ei.exam_master) ? ei.exam_master[0] : ei.exam_master;
    if (ei.question_id && (isConfidentialExamText(em?.exam_type) || isConfidentialExamText(em?.title))) {
      blockedQids.add(String(ei.question_id).trim());
    }
  }

  const eligibleMap = new Map<string, any>();
  for (const q of qRows || []) {
    const qid = String(q.question_id || "").trim();
    if (!qid || blockedQids.has(qid) || isConfidentialQuestionObj(q)) continue;
    eligibleMap.set(qid, q);
  }

  const eligibleIds = Array.from(eligibleMap.keys());
  if (eligibleIds.length === 0) {
    return { ok: true, engine: "typescript_fallback", targetQuestionCount: 0, updatedCount: 0 };
  }

  const linkedTqIds: number[] = [];
  const tqToQid = new Map<string, string>();
  const tqsByQid = new Map<string, Array<{ tq_id: any; difficulty: string | null }>>();
  for (const tq of tqLinkedRows || []) {
    const qid = String(tq.question_id || "").trim();
    if (!eligibleMap.has(qid)) continue;
    linkedTqIds.push(Number(tq.tq_id));
    tqToQid.set(String(tq.tq_id), qid);
    if (!tqsByQid.has(qid)) tqsByQid.set(qid, []);
    tqsByQid.get(qid)!.push({ tq_id: tq.tq_id, difficulty: tq.difficulty ?? null });
  }

  const [saRes, shaByQidRes, shaByTqRes, sirByQidRes, sirByTqRes] = await Promise.all([
    supabaseAdmin
      .from("student_answer")
      .select(
        "student_id, exam_assignment_id, question_id, attempt_number, grading_code, is_correct, wrong_attempts_log, grading_status, updated_at, student(name), exam_assignment!inner(admission_session_id, status, exam_master(exam_type, title))"
      )
      .in("question_id", eligibleIds)
      .not("grading_code", "is", null),
    supabaseAdmin
      .from("student_homework_answer")
      .select("student_id, question_id, tq_id, grading_code, is_correct, wrong_attempts_log, updated_at, student(name)")
      .in("question_id", eligibleIds)
      .not("grading_code", "is", null),
    linkedTqIds.length > 0
      ? supabaseAdmin
          .from("student_homework_answer")
          .select("student_id, question_id, tq_id, grading_code, is_correct, wrong_attempts_log, updated_at, student(name)")
          .in("tq_id", linkedTqIds)
          .not("grading_code", "is", null)
      : Promise.resolve({ data: [] as any[] }),
    supabaseAdmin
      .from("student_incorrect_record")
      .select("student_id, question_id, tq_id, source_type, student(name)")
      .in("question_id", eligibleIds),
    linkedTqIds.length > 0
      ? supabaseAdmin
          .from("student_incorrect_record")
          .select("student_id, question_id, tq_id, source_type, student(name)")
          .in("tq_id", linkedTqIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const dedup = new Map<string, DedupObservation>();
  const upsertRtDedup = (sid: string, qid: string, score: number, rank: number) => {
    const key = `${sid}|${qid}`;
    const prev = dedup.get(key);
    if (!prev) {
      dedup.set(key, { studentId: sid, questionId: qid, score, rank });
    } else {
      prev.score = Math.min(prev.score, score);
      if (rank < prev.rank) prev.rank = rank;
    }
  };

  for (const sa of saRes.data || []) {
    const code = String(sa.grading_code || "").trim();
    if (!code || String(sa.grading_status || "").trim() === "대기") continue;
    const stuObj: any = Array.isArray(sa.student) ? sa.student[0] : sa.student;
    if (DUMMY_STUDENT_REGEX.test(String(stuObj?.name || "").replace(/\s+/g, ""))) continue;

    const ea: any = Array.isArray(sa.exam_assignment) ? sa.exam_assignment[0] : sa.exam_assignment;
    if (!ea || ea.admission_session_id || PRE_TEST_STATUSES.has(String(ea.status || "").trim())) continue;
    const em: any = Array.isArray(ea.exam_master) ? ea.exam_master[0] : ea.exam_master;
    if (isConfidentialExamText(em?.exam_type) || isConfidentialExamText(em?.title)) continue;
    if (isWrongReviewExam(em?.exam_type, em?.title)) continue;

    const sid = String(sa.student_id || "").trim();
    const qid = String(sa.question_id || "").trim();
    if (!sid || !qid) continue;
    const rank = (sa.updated_at ? new Date(sa.updated_at).getTime() : 0) * 100 + (Number(sa.attempt_number) || 1);
    upsertRtDedup(sid, qid, firstTryScoreOfGradingCode(code, sa.is_correct, sa.wrong_attempts_log), rank);
  }

  for (const sha of [...(shaByQidRes.data || []), ...(shaByTqRes.data || [])]) {
    const code = String(sha.grading_code || "").trim();
    if (!code) continue;
    const stuObj: any = Array.isArray(sha.student) ? sha.student[0] : sha.student;
    if (DUMMY_STUDENT_REGEX.test(String(stuObj?.name || "").replace(/\s+/g, ""))) continue;

    const sid = String(sha.student_id || "").trim();
    const qid =
      String(sha.question_id || "").trim() ||
      (sha.tq_id != null ? tqToQid.get(String(sha.tq_id)) || "" : "");
    if (!sid || !qid || !eligibleMap.has(qid)) continue;

    const rank = (sha.updated_at ? new Date(sha.updated_at).getTime() : 0) * 100 + 50;
    upsertRtDedup(sid, qid, firstTryScoreOfGradingCode(code, sha.is_correct, sha.wrong_attempts_log), rank);
  }

  for (const sir of [...(sirByQidRes.data || []), ...(sirByTqRes.data || [])]) {
    if (isConfidentialExamText(sir.source_type)) continue;
    const stuObj: any = Array.isArray(sir.student) ? sir.student[0] : sir.student;
    if (DUMMY_STUDENT_REGEX.test(String(stuObj?.name || "").replace(/\s+/g, ""))) continue;
    const sid = String(sir.student_id || "").trim();
    const rawQid = String(sir.question_id || "").trim();
    const rawTq = String(sir.tq_id ?? "").trim();
    const qid = rawQid || (rawTq ? (rawTq.includes("-") ? rawTq : tqToQid.get(rawTq) || "") : "");
    if (!sid || !qid || !eligibleMap.has(qid)) continue;
    upsertRtDedup(sid, qid, 0.0, 0);
  }

  // 캐시에 없는 풀이 학생이 있으면 경량 실력 보완
  const uncachedSolverIds = Array.from(
    new Set(
      Array.from(dedup.values())
        .map((d) => d.studentId)
        .filter((sid) => !mem.studentAbilities.has(sid))
    )
  ).slice(0, 40);

  if (uncachedSolverIds.length > 0) {
    await refreshSpecificStudentsAbilityFallback(
      supabaseAdmin,
      uncachedSolverIds,
      hasAiPriorColumns,
      priorsBackup
    );
  }

  const obsByQid = new Map<string, DedupObservation[]>();
  for (const o of dedup.values()) {
    if (!obsByQid.has(o.questionId)) obsByQid.set(o.questionId, []);
    obsByQid.get(o.questionId)!.push(o);
  }

  let backupDirty = false;
  let updatedCount = 0;
  const nowIso = new Date().toISOString();

  for (const [qid, qRow] of eligibleMap.entries()) {
    const obsList = obsByQid.get(qid) || [];

    let priorProb: number | null;
    let priorDiff: string | null;
    if (hasAiPriorColumns) {
      const wasCal = Number(qRow.calibrated_sample_count || 0) > 0;
      priorProb = wasCal
        ? qRow.ai_solving_probability ?? null
        : qRow.ai_solving_probability ?? qRow.solving_probability ?? null;
      priorDiff = wasCal
        ? qRow.ai_difficulty ?? null
        : qRow.ai_difficulty ?? qRow.difficulty ?? null;
    } else {
      if (!(qid in priorsBackup)) {
        priorsBackup[qid] = {
          prob:
            qRow.solving_probability !== null && qRow.solving_probability !== undefined
              ? Number(qRow.solving_probability)
              : null,
          diff: qRow.difficulty ?? null,
        };
        backupDirty = true;
      }
      priorProb = priorsBackup[qid].prob;
      priorDiff = priorsBackup[qid].diff;
    }

    if (obsList.length === 0) {
      // 이전에 보정된 적이 있었으나 답안 삭제로 N=0이 된 경우 하향 기준값으로 복구
      const loweredPrior = computeLoweredPriorRate(priorProb);
      const loweredDiff = getCalibratedDiffLabelByRate(loweredPrior);
      const hadPrevCalibration = hasAiPriorColumns
        ? Number(qRow.calibrated_sample_count || 0) > 0
        : qid in priorsBackup &&
          (qRow.solving_probability !== loweredPrior || qRow.difficulty !== loweredDiff);
      if (hadPrevCalibration) {
        const revPayload: Record<string, any> = {
          solving_probability: loweredPrior,
          difficulty: loweredDiff,
          updated_at: nowIso,
        };
        if (hasAiPriorColumns) {
          revPayload.calibrated_sample_count = 0;
          revPayload.calibrated_at = null;
        }
        await supabaseAdmin.from("question_db").update(revPayload).eq("question_id", qid);
        await supabaseAdmin
          .from("textbook_question")
          .update({ difficulty: loweredDiff })
          .eq("question_id", qid);
        updatedCount++;
      }
      continue;
    }

    let cSum = 0;
    let thetaSum = 0;
    for (const o of obsList) {
      cSum += o.score;
      thetaSum += mem.studentAbilities.get(o.studentId)?.theta ?? 0.0;
    }
    const calc = computeCalibratedQuestionRate(
      priorProb,
      obsList.length,
      cSum,
      thetaSum / obsList.length
    );

    const patch: Record<string, any> = {
      solving_probability: calc.afterRate,
      difficulty: calc.afterDifficulty,
    };
    if (
      qRow.solving_probability !== calc.afterRate ||
      String(qRow.difficulty || "") !== calc.afterDifficulty
    ) {
      patch.updated_at = nowIso;
    }
    if (hasAiPriorColumns) {
      patch.ai_solving_probability = priorProb;
      patch.ai_difficulty = priorDiff;
      patch.calibrated_sample_count = obsList.length;
      patch.calibrated_at = nowIso;
    }

    await supabaseAdmin.from("question_db").update(patch).eq("question_id", qid);

    const tqLinks = tqsByQid.get(qid) || [];
    const staleTqIds = tqLinks
      .filter((t) => t.difficulty !== calc.afterDifficulty)
      .map((t) => t.tq_id);
    if (staleTqIds.length > 0) {
      await supabaseAdmin
        .from("textbook_question")
        .update({ difficulty: calc.afterDifficulty })
        .in("tq_id", staleTqIds);
    }
    updatedCount++;
  }

  if (!hasAiPriorColumns && backupDirty) {
    await saveFallbackPriorBackup(supabaseAdmin, priorsBackup);
  }
  if (updatedCount > 0) {
    invalidateFactoryStatsCache();
  }

  return {
    ok: true,
    engine: "typescript_fallback",
    targetQuestionCount: eligibleIds.length,
    updatedCount,
  };
}

async function refreshSpecificStudentsAbilityFallback(
  supabaseAdmin: SupabaseClient,
  studentIds: string[],
  hasAiPriorColumns: boolean,
  priorsBackup: Record<string, PriorSnapshotEntry>
): Promise<void> {
  if (studentIds.length === 0) return;
  const mem = getMemoryState();

  const [saRes, shaRes, sirRes] = await Promise.all([
    supabaseAdmin
      .from("student_answer")
      .select(
        "student_id, question_id, attempt_number, grading_code, is_correct, wrong_attempts_log, grading_status, updated_at, exam_assignment!inner(admission_session_id, status, exam_master(exam_type, title))"
      )
      .in("student_id", studentIds)
      .not("grading_code", "is", null)
      .limit(3000),
    supabaseAdmin
      .from("student_homework_answer")
      .select("student_id, question_id, tq_id, grading_code, is_correct, wrong_attempts_log, updated_at")
      .in("student_id", studentIds)
      .not("grading_code", "is", null)
      .limit(3000),
    supabaseAdmin
      .from("student_incorrect_record")
      .select("student_id, question_id, tq_id, source_type")
      .in("student_id", studentIds)
      .limit(3000),
  ]);

  const needTqIds = Array.from(
    new Set(
      [...(shaRes.data || []), ...(sirRes.data || [])]
        .filter((r: any) => !r.question_id && r.tq_id != null && !String(r.tq_id).includes("-"))
        .map((r: any) => Number(r.tq_id))
        .filter((n: number) => Number.isFinite(n))
    )
  );

  const tqMap = new Map<string, string>();
  if (needTqIds.length > 0) {
    for (const chunk of chunkArray(needTqIds, 200)) {
      const { data: tqRows } = await supabaseAdmin
        .from("textbook_question")
        .select("tq_id, question_id")
        .in("tq_id", chunk);
      for (const r of tqRows || []) {
        if (r?.question_id) tqMap.set(String(r.tq_id), String(r.question_id).trim());
      }
    }
  }

  const dedup = new Map<string, DedupObservation>();
  const upsertStuDedup = (sid: string, qid: string, score: number, rank: number) => {
    const key = `${sid}|${qid}`;
    const prev = dedup.get(key);
    if (!prev) {
      dedup.set(key, { studentId: sid, questionId: qid, score, rank });
    } else {
      prev.score = Math.min(prev.score, score);
      if (rank < prev.rank) prev.rank = rank;
    }
  };

  for (const sa of saRes.data || []) {
    const code = String(sa.grading_code || "").trim();
    if (!code || String(sa.grading_status || "").trim() === "대기") continue;
    const ea: any = Array.isArray(sa.exam_assignment) ? sa.exam_assignment[0] : sa.exam_assignment;
    if (!ea || ea.admission_session_id || PRE_TEST_STATUSES.has(String(ea.status || "").trim())) continue;
    const em: any = Array.isArray(ea.exam_master) ? ea.exam_master[0] : ea.exam_master;
    if (isConfidentialExamText(em?.exam_type) || isConfidentialExamText(em?.title)) continue;
    if (isWrongReviewExam(em?.exam_type, em?.title)) continue;

    const sid = String(sa.student_id || "").trim();
    const qid = String(sa.question_id || "").trim();
    if (!sid || !qid) continue;
    const rank = (sa.updated_at ? new Date(sa.updated_at).getTime() : 0) * 100 + (Number(sa.attempt_number) || 1);
    upsertStuDedup(sid, qid, firstTryScoreOfGradingCode(code, sa.is_correct, sa.wrong_attempts_log), rank);
  }

  for (const sha of shaRes.data || []) {
    const code = String(sha.grading_code || "").trim();
    if (!code) continue;
    const sid = String(sha.student_id || "").trim();
    const qid =
      String(sha.question_id || "").trim() ||
      (sha.tq_id != null ? tqMap.get(String(sha.tq_id)) || "" : "");
    if (!sid || !qid) continue;
    const rank = (sha.updated_at ? new Date(sha.updated_at).getTime() : 0) * 100 + 50;
    upsertStuDedup(sid, qid, firstTryScoreOfGradingCode(code, sha.is_correct, sha.wrong_attempts_log), rank);
  }

  for (const sir of sirRes.data || []) {
    if (isConfidentialExamText(sir.source_type)) continue;
    const sid = String(sir.student_id || "").trim();
    const rawQid = String(sir.question_id || "").trim();
    const rawTq = String(sir.tq_id ?? "").trim();
    const qid = rawQid || (rawTq ? (rawTq.includes("-") ? rawTq : tqMap.get(rawTq) || "") : "");
    if (!sid || !qid) continue;
    upsertStuDedup(sid, qid, 0.0, 0);
  }

  const allQids = Array.from(new Set(Array.from(dedup.values()).map((d) => d.questionId)));
  const qPriorMap = new Map<string, number>();
  const qCols: string = hasAiPriorColumns
    ? "question_id, solving_probability, ai_solving_probability, calibrated_sample_count"
    : "question_id, solving_probability";

  for (const chunk of chunkArray(allQids, 200)) {
    const { data: qs } = await supabaseAdmin
      .from("question_db")
      .select<string, any>(qCols)
      .in("question_id", chunk);
    for (const q of qs || []) {
      const qid = String(q.question_id || "").trim();
      let p: number | null = null;
      if (hasAiPriorColumns) {
        p =
          Number(q.calibrated_sample_count || 0) > 0
            ? q.ai_solving_probability ?? null
            : q.ai_solving_probability ?? q.solving_probability ?? null;
      } else if (qid in priorsBackup) {
        p = priorsBackup[qid].prob;
      } else {
        p = q.solving_probability ?? null;
      }
      qPriorMap.set(qid, computeLoweredPriorRate(p) / 100.0);
    }
  }

  const agg = new Map<string, { n: number; c: number; e: number }>();
  for (const o of dedup.values()) {
    if (!agg.has(o.studentId)) agg.set(o.studentId, { n: 0, c: 0, e: 0 });
    const a = agg.get(o.studentId)!;
    a.n += 1;
    a.c += o.score;
    a.e += qPriorMap.get(o.questionId) ?? 0.5;
  }

  for (const sid of studentIds) {
    const a = agg.get(sid) || { n: 0, c: 0, e: 0 };
    mem.studentAbilities.set(sid, {
      solvedCount: a.n,
      correctSum: a.c,
      expectedSum: a.e,
      theta: computeStudentThetaLogit(a.n, a.c, a.e),
    });
  }
}
