// src/lib/questionSafeDeleteServer.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface QuestionDeleteImpact {
  questionId: string;
  existsInQuestionDb: boolean;
  isCurrentlyHidden: boolean;
  textbookQuestionCount: number;
  childTwinCount: number;
  childTqCount: number;
  incorrectRecordCount: number;
  clinicTaskCount: number;
  examItemCount: number;
  studentAnswerCount: number;
  homeworkAnswerCount: number;
  questionStatisticsCount: number;
  hasStudentHistory: boolean;
}

interface InternalImpactDetails extends QuestionDeleteImpact {
  tqIds: Array<string | number>;
  incorrectRecordIds: Array<string | number>;
  examIds: string[];
}

function isMissingSchemaObjectError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || err.details || "");
  if (
    code === "42703" ||
    code === "42P01" ||
    code === "PGRST204" ||
    code === "PGRST205"
  ) {
    return true;
  }
  return /(column|relation|table|schema cache).*(does not exist|not find)/i.test(
    msg
  );
}

// 프로세스 내 미존재 테이블/컬럼 캐시 (동일 42703·42P01 쿼리 재전송 방지)
const missingSchemaCache = new Set<string>();

function hasKnownMissingSchema(table: string, ...cols: string[]): boolean {
  if (missingSchemaCache.has(`table:${table}`)) return true;
  return cols.some((col) => missingSchemaCache.has(`col:${table}.${col}`));
}

function recordMissingSchemaError(
  err: any,
  table: string,
  ...cols: string[]
): void {
  const code = String(err?.code || "");
  const msg = String(err?.message || err?.details || "");
  if (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .* does not exist/i.test(msg)
  ) {
    missingSchemaCache.add(`table:${table}`);
    return;
  }
  for (const col of cols) {
    if (msg.includes(col)) {
      missingSchemaCache.add(`col:${table}.${col}`);
      return;
    }
  }
  if (cols.length === 1) {
    missingSchemaCache.add(`col:${table}.${cols[0]}`);
  }
}

function chunkArray<T>(items: T[], size: number = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * 요청자의 로그인 토큰을 검증하여 비인가 외부 호출을 차단합니다.
 */
export async function verifyQuestionMutationCaller(
  supabaseAdmin: SupabaseClient,
  userToken?: string | null,
  hasServiceRoleKey: boolean = true
): Promise<{ ok: true; userId: string } | { ok: false; error: string; status: number }> {
  const token = String(userToken || "").trim();
  if (!token) {
    return {
      ok: false,
      error: "로그인 세션 토큰이 확인되지 않습니다. 다시 로그인한 뒤 시도해주세요.",
      status: 401,
    };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userErr || !userId) {
    return {
      ok: false,
      error: "만료되었거나 유효하지 않은 로그인 세션입니다. 새로고침 후 다시 시도해주세요.",
      status: 401,
    };
  }

  if (hasServiceRoleKey) {
    const { data: inst, error: instErr } = await supabaseAdmin
      .from("instructor")
      .select("instructor_id, role, position, tenant_id")
      .eq("instructor_id", userId)
      .maybeSingle();

    if (!instErr && !inst) {
      return {
        ok: false,
        error: "교직원(관리자·강사) 권한 계정이 아닙니다.",
        status: 403,
      };
    }
  }

  return { ok: true, userId };
}

async function safeSelectColumnValues(
  supabaseAdmin: SupabaseClient,
  table: string,
  selectCol: string,
  filterCol: string,
  filterValues: Array<string | number>
): Promise<Array<string | number>> {
  if (
    filterValues.length === 0 ||
    hasKnownMissingSchema(table, selectCol, filterCol)
  ) {
    return [];
  }
  const collected: Array<string | number> = [];

  for (const chunk of chunkArray(filterValues, 200)) {
    const query =
      chunk.length === 1
        ? supabaseAdmin.from(table).select(selectCol).eq(filterCol, chunk[0])
        : supabaseAdmin.from(table).select(selectCol).in(filterCol, chunk);

    const { data, error } = await query;
    if (error) {
      if (isMissingSchemaObjectError(error)) {
        recordMissingSchemaError(error, table, selectCol, filterCol);
        return [];
      }
      throw error;
    }
    for (const row of (data as any[]) || []) {
      const val = row?.[selectCol];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        collected.push(val);
      }
    }
  }

  return collected;
}

async function safeCountByFilter(
  supabaseAdmin: SupabaseClient,
  table: string,
  filterCol: string,
  filterValues: Array<string | number>
): Promise<number> {
  if (filterValues.length === 0 || hasKnownMissingSchema(table, filterCol)) {
    return 0;
  }
  let total = 0;

  for (const chunk of chunkArray(filterValues, 200)) {
    const query =
      chunk.length === 1
        ? supabaseAdmin
            .from(table)
            .select("*", { count: "exact", head: true })
            .eq(filterCol, chunk[0])
        : supabaseAdmin
            .from(table)
            .select("*", { count: "exact", head: true })
            .in(filterCol, chunk);

    const { count, error } = await query;
    if (error) {
      if (isMissingSchemaObjectError(error)) {
        recordMissingSchemaError(error, table, filterCol);
        return 0;
      }
      throw error;
    }
    total += count || 0;
  }

  return total;
}

async function safeDeleteByFilter(
  supabaseAdmin: SupabaseClient,
  table: string,
  filterCol: string,
  filterValues: Array<string | number>
): Promise<void> {
  if (filterValues.length === 0 || hasKnownMissingSchema(table, filterCol)) {
    return;
  }

  for (const chunk of chunkArray(filterValues, 200)) {
    const query =
      chunk.length === 1
        ? supabaseAdmin.from(table).delete().eq(filterCol, chunk[0])
        : supabaseAdmin.from(table).delete().in(filterCol, chunk);

    const { error } = await query;
    if (error) {
      if (isMissingSchemaObjectError(error)) {
        recordMissingSchemaError(error, table, filterCol);
        return;
      }
      throw error;
    }
  }
}

async function safeUnlinkColumn(
  supabaseAdmin: SupabaseClient,
  table: string,
  targetCol: string,
  filterValues: Array<string | number>
): Promise<void> {
  if (filterValues.length === 0 || hasKnownMissingSchema(table, targetCol)) {
    return;
  }

  for (const chunk of chunkArray(filterValues, 200)) {
    const query =
      chunk.length === 1
        ? supabaseAdmin
            .from(table)
            .update({ [targetCol]: null })
            .eq(targetCol, chunk[0])
        : supabaseAdmin
            .from(table)
            .update({ [targetCol]: null })
            .in(targetCol, chunk);

    const { error } = await query;
    if (error) {
      if (isMissingSchemaObjectError(error)) {
        recordMissingSchemaError(error, table, targetCol);
        return;
      }
      throw error;
    }
  }
}

async function collectInternalImpact(
  supabaseAdmin: SupabaseClient,
  rawQuestionId: string
): Promise<InternalImpactDetails> {
  const questionId = String(rawQuestionId || "").trim();

  const { data: qRow, error: qErr } = await supabaseAdmin
    .from("question_db")
    .select("question_id, is_hidden")
    .eq("question_id", questionId)
    .maybeSingle();

  if (qErr && !isMissingSchemaObjectError(qErr)) {
    throw qErr;
  }

  const tqIds = await safeSelectColumnValues(
    supabaseAdmin,
    "textbook_question",
    "tq_id",
    "question_id",
    [questionId]
  );

  const [childTwinCount, childTqCount, questionStatisticsCount] =
    await Promise.all([
      safeCountByFilter(supabaseAdmin, "question_db", "parent_question_id", [
        questionId,
      ]),
      tqIds.length > 0
        ? safeCountByFilter(
            supabaseAdmin,
            "textbook_question",
            "parent_tq_id",
            tqIds
          )
        : Promise.resolve(0),
      safeCountByFilter(supabaseAdmin, "question_statistics", "question_id", [
        questionId,
      ]),
    ]);

  // 1) student_incorrect_record (question_id 및 tq_id 양쪽 모두 수집하여 중복 제거)
  const [incByQid, incByTq] = await Promise.all([
    safeSelectColumnValues(
      supabaseAdmin,
      "student_incorrect_record",
      "record_id",
      "question_id",
      [questionId]
    ),
    tqIds.length > 0
      ? safeSelectColumnValues(
          supabaseAdmin,
          "student_incorrect_record",
          "record_id",
          "tq_id",
          tqIds
        )
      : Promise.resolve([]),
  ]);

  const recordIdMap = new Map<string, string | number>();
  for (const id of [...incByQid, ...incByTq]) {
    recordIdMap.set(String(id), id);
  }
  const incorrectRecordIds = Array.from(recordIdMap.values());

  // 2) clinic_task (incorrect_record_id, question_id, tq_id 연결 건 합산)
  const [ctByRec, ctByQid, ctByTq] = await Promise.all([
    incorrectRecordIds.length > 0
      ? safeCountByFilter(
          supabaseAdmin,
          "clinic_task",
          "incorrect_record_id",
          incorrectRecordIds
        )
      : Promise.resolve(0),
    safeCountByFilter(supabaseAdmin, "clinic_task", "question_id", [
      questionId,
    ]),
    tqIds.length > 0
      ? safeCountByFilter(supabaseAdmin, "clinic_task", "tq_id", tqIds)
      : Promise.resolve(0),
  ]);
  const clinicTaskCount = ctByRec + ctByQid + ctByTq;

  // 3) exam_item, student_answer(question_id 전용), student_homework_answer(question_id + tq_id)
  const [
    examIdVals,
    ansByQidIds,
    hwAnsByQidIds,
    hwAnsByTqIds,
  ] = await Promise.all([
    safeSelectColumnValues(
      supabaseAdmin,
      "exam_item",
      "exam_id",
      "question_id",
      [questionId]
    ),
    safeSelectColumnValues(
      supabaseAdmin,
      "student_answer",
      "answer_id",
      "question_id",
      [questionId]
    ),
    safeSelectColumnValues(
      supabaseAdmin,
      "student_homework_answer",
      "hw_answer_id",
      "question_id",
      [questionId]
    ),
    tqIds.length > 0
      ? safeSelectColumnValues(
          supabaseAdmin,
          "student_homework_answer",
          "hw_answer_id",
          "tq_id",
          tqIds
        )
      : Promise.resolve([]),
  ]);

  const examIdSet = new Set<string>(examIdVals.map((v) => String(v)));
  const studentAnsSet = new Set<string>(ansByQidIds.map((v) => String(v)));
  const hwAnsSet = new Set<string>(
    [...hwAnsByQidIds, ...hwAnsByTqIds].map((v) => String(v))
  );

  const incorrectRecordCount = incorrectRecordIds.length;
  const examItemCount = examIdVals.length;
  const studentAnswerCount = studentAnsSet.size;
  const homeworkAnswerCount = hwAnsSet.size;

  const hasStudentHistory =
    incorrectRecordCount +
      clinicTaskCount +
      examItemCount +
      studentAnswerCount +
      homeworkAnswerCount >
    0;

  const isCurrentlyHidden =
    qRow?.is_hidden === true ||
    qRow?.is_hidden === "Y" ||
    qRow?.is_hidden === "true";

  return {
    questionId,
    existsInQuestionDb: Boolean(qRow),
    isCurrentlyHidden,
    textbookQuestionCount: tqIds.length,
    childTwinCount,
    childTqCount,
    incorrectRecordCount,
    clinicTaskCount,
    examItemCount,
    studentAnswerCount,
    homeworkAnswerCount,
    questionStatisticsCount,
    hasStudentHistory,
    tqIds,
    incorrectRecordIds,
    examIds: Array.from(examIdSet),
  };
}

export async function inspectQuestionDeleteImpact(
  supabaseAdmin: SupabaseClient,
  questionId: string
): Promise<QuestionDeleteImpact> {
  const details = await collectInternalImpact(supabaseAdmin, questionId);
  const { tqIds: _t, incorrectRecordIds: _r, examIds: _e, ...publicImpact } = details;
  return publicImpact;
}

/**
 * 학생 오답·시험지·성적 이력을 모두 보존한 채 시험지 출제 후보에서만 제외(is_hidden = true)합니다.
 */
export async function hideQuestionInMasterDb(
  supabaseAdmin: SupabaseClient,
  questionId: string
): Promise<{ success: boolean; error?: string }> {
  const cleanId = String(questionId || "").trim();
  if (!cleanId) {
    return { success: false, error: "문항 ID가 비어 있습니다." };
  }

  const { data, error } = await supabaseAdmin
    .from("question_db")
    .update({
      is_hidden: true,
      updated_at: new Date().toISOString(),
    })
    .eq("question_id", cleanId)
    .select("question_id");

  if (error) {
    return { success: false, error: error.message };
  }
  if (!data || data.length === 0) {
    return {
      success: false,
      error: "숨김 처리할 대상 문항을 question_db에서 찾지 못했습니다.",
    };
  }
  return { success: true };
}

/**
 * 23503 외래키 위반 및 textbook_question 반쪽 삭제를 원천 방지하는 안전 삭제 엔진
 */
export async function deleteQuestionSafely(
  supabaseAdmin: SupabaseClient,
  questionId: string,
  options?: { forceCascade?: boolean }
): Promise<{
  success: boolean;
  code?: "HAS_HISTORY" | "FK_CONFLICT" | "ERROR";
  impact?: QuestionDeleteImpact;
  unlinkedChildCount?: number;
  error?: string;
}> {
  const cleanId = String(questionId || "").trim();
  if (!cleanId) {
    return { success: false, code: "ERROR", error: "삭제할 문항 ID가 없습니다." };
  }

  const forceCascade = Boolean(options?.forceCascade);
  const details = await collectInternalImpact(supabaseAdmin, cleanId);
  const {
    tqIds,
    incorrectRecordIds,
    examIds,
    ...publicImpact
  } = details;

  if (details.hasStudentHistory && !forceCascade) {
    return {
      success: false,
      code: "HAS_HISTORY",
      impact: publicImpact,
      error:
        "학생 오답 기록 또는 시험·과제 풀이 이력이 연결되어 있어 기본 삭제가 보호되었습니다.",
    };
  }

  // 롤백 대비 스냅샷 확보 (textbook_question 행 및 자식 쌍둥이 연결 상태)
  const [{ data: tqSnapshotData }, childQuestionIds, childTqIds] =
    await Promise.all([
      supabaseAdmin
        .from("textbook_question")
        .select("*")
        .eq("question_id", cleanId),
      safeSelectColumnValues(
        supabaseAdmin,
        "question_db",
        "question_id",
        "parent_question_id",
        [cleanId]
      ),
      tqIds.length > 0
        ? safeSelectColumnValues(
            supabaseAdmin,
            "textbook_question",
            "tq_id",
            "parent_tq_id",
            tqIds
          )
        : Promise.resolve([]),
    ]);

  const tqSnapshotRows: Record<string, any>[] = Array.isArray(tqSnapshotData)
    ? tqSnapshotData
    : [];

  try {
    // 1. 강제 연쇄 정리 모드일 때 학생 학습·오답·시험 문항 하위 참조부터 순서대로 제거
    if (forceCascade && details.hasStudentHistory) {
      if (incorrectRecordIds.length > 0) {
        await safeDeleteByFilter(
          supabaseAdmin,
          "clinic_task",
          "incorrect_record_id",
          incorrectRecordIds
        );
      }
      await safeDeleteByFilter(supabaseAdmin, "clinic_task", "question_id", [
        cleanId,
      ]);
      if (tqIds.length > 0) {
        await safeDeleteByFilter(supabaseAdmin, "clinic_task", "tq_id", tqIds);
      }

      if (incorrectRecordIds.length > 0) {
        await safeDeleteByFilter(
          supabaseAdmin,
          "student_incorrect_record",
          "record_id",
          incorrectRecordIds
        );
      }
      await safeDeleteByFilter(
        supabaseAdmin,
        "student_incorrect_record",
        "question_id",
        [cleanId]
      );
      if (tqIds.length > 0) {
        await safeDeleteByFilter(
          supabaseAdmin,
          "student_incorrect_record",
          "tq_id",
          tqIds
        );
      }

      await safeDeleteByFilter(supabaseAdmin, "student_answer", "question_id", [
        cleanId,
      ]);

      await safeDeleteByFilter(
        supabaseAdmin,
        "student_homework_answer",
        "question_id",
        [cleanId]
      );
      if (tqIds.length > 0) {
        await safeDeleteByFilter(
          supabaseAdmin,
          "student_homework_answer",
          "tq_id",
          tqIds
        );
      }

      await safeUnlinkColumn(
        supabaseAdmin,
        "exam_item",
        "parent_question_id",
        [cleanId]
      );
      await safeDeleteByFilter(supabaseAdmin, "exam_item", "question_id", [
        cleanId,
      ]);

      for (const examId of examIds) {
        const remainingCount = await safeCountByFilter(
          supabaseAdmin,
          "exam_item",
          "exam_id",
          [examId]
        );
        await supabaseAdmin
          .from("exam_master")
          .update({ total_questions: remainingCount })
          .eq("exam_id", examId);
      }
    } else {
      await safeUnlinkColumn(
        supabaseAdmin,
        "exam_item",
        "parent_question_id",
        [cleanId]
      );
    }

    // 2. 문항 통계(question_statistics) 및 쌍둥이 자기참조(parent_question_id / parent_tq_id) 정리
    await safeDeleteByFilter(
      supabaseAdmin,
      "question_statistics",
      "question_id",
      [cleanId]
    );

    if (childTqIds.length > 0) {
      await safeUnlinkColumn(
        supabaseAdmin,
        "textbook_question",
        "parent_tq_id",
        tqIds
      );
    }
    if (childQuestionIds.length > 0) {
      await safeUnlinkColumn(
        supabaseAdmin,
        "question_db",
        "parent_question_id",
        [cleanId]
      );
    }

    // 3. textbook_question 매핑 삭제
    if (tqIds.length > 0 || tqSnapshotRows.length > 0) {
      const { error: tqDelErr } = await supabaseAdmin
        .from("textbook_question")
        .delete()
        .eq("question_id", cleanId);
      if (tqDelErr) throw tqDelErr;
    }

    // 4. question_db 마스터 본체 삭제
    const { error: qDelErr } = await supabaseAdmin
      .from("question_db")
      .delete()
      .eq("question_id", cleanId);

    if (qDelErr) {
      if (tqSnapshotRows.length > 0) {
        await supabaseAdmin
          .from("textbook_question")
          .upsert(tqSnapshotRows, { onConflict: "tq_id" });
      }
      if (childQuestionIds.length > 0) {
        for (const chunk of chunkArray(childQuestionIds, 200)) {
          await supabaseAdmin
            .from("question_db")
            .update({ parent_question_id: cleanId })
            .in("question_id", chunk);
        }
      }

      if (String(qDelErr.code || "") === "23503") {
        const detailStr = String(qDelErr.details || qDelErr.message || "");
        return {
          success: false,
          code: "FK_CONFLICT",
          impact: publicImpact,
          error: `연결된 하위 데이터 제약 조건(23503)으로 삭제가 차단되었습니다(교재 매핑은 자동 복구됨): ${detailStr}`,
        };
      }
      throw qDelErr;
    }

    return {
      success: true,
      impact: publicImpact,
      unlinkedChildCount: childQuestionIds.length,
    };
  } catch (err: any) {
    return {
      success: false,
      code: "ERROR",
      impact: publicImpact,
      error: err?.message || "문항 삭제 처리 중 서버 오류가 발생했습니다.",
    };
  }
}
