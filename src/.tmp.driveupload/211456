// src/app/actions/auth.ts
"use server";

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const getAdminClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

// 런타임 스키마 캐시: homework_assignment / student_homework_result 에 tenant_id 컬럼이 존재하는지 자동 감지
let hwAssignmentHasTenantCol: boolean | null = null;
let hwResultHasTenantCol: boolean | null = null;

function isMissingTenantColumnError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || err.details || "");
  if ((code === "PGRST204" || code === "42703") && /tenant_id/i.test(msg)) {
    return true;
  }
  return /tenant_id/i.test(msg) && /(column|schema cache|does not exist)/i.test(msg);
}

const safeParseIds = (raw: any): number[] => {
  if (!raw) return [];
  try {
    let val = raw;
    if (typeof val === "string") {
      if (val === "null" || val.trim() === "") return [];
      val = JSON.parse(val);
    }
    if (Array.isArray(val)) return val.map(Number).filter((n) => !Number.isNaN(n));
  } catch {
    // 파싱 실패 시 빈 배열 반환
  }
  return [];
};

async function verifyClassAndResolveTenant(
  supabaseAdmin: SupabaseClient,
  classId: string,
  clientTenantId?: string
): Promise<{ ok: true; resolvedTenantId: string | null } | { ok: false; message: string }> {
  if (!classId) {
    return { ok: false, message: "반(class_id) 정보가 없습니다." };
  }

  const cookieStore = await cookies();
  const cookieTenantId = (cookieStore.get("logica_tenant_id")?.value || "").trim();
  const localTenantId = (clientTenantId || "").trim();
  const callerTenant = localTenantId || cookieTenantId;

  if (!callerTenant) {
    return { ok: false, message: "로그인 지점 정보가 없습니다. 다시 로그인해 주세요." };
  }

  const { data: classRow, error: classErr } = await supabaseAdmin
    .from("class")
    .select("class_id, tenant_id")
    .eq("class_id", classId)
    .maybeSingle();

  if (classErr) {
    return { ok: false, message: `반 정보 확인 실패: ${classErr.message}` };
  }
  if (!classRow) {
    return { ok: false, message: "존재하지 않는 반입니다." };
  }

  const classTenantId = classRow.tenant_id ? String(classRow.tenant_id).trim() : null;
  const isSuperCaller = callerTenant === "hq" || cookieTenantId === "hq" || localTenantId === "hq";

  if (
    !isSuperCaller &&
    classTenantId &&
    classTenantId !== localTenantId &&
    classTenantId !== cookieTenantId
  ) {
    return { ok: false, message: "타 지점의 반 진도/과제는 변경할 수 없습니다." };
  }

  const resolvedTenantId =
    classTenantId || (callerTenant && callerTenant !== "hq" ? callerTenant : null);

  return { ok: true, resolvedTenantId };
}

async function insertHomeworkAssignmentSafe(
  supabaseAdmin: SupabaseClient,
  payload: Record<string, any>,
  resolvedTenantId: string | null
): Promise<{ homework_id: number }> {
  if (resolvedTenantId && hwAssignmentHasTenantCol !== false) {
    const { data, error } = await supabaseAdmin
      .from("homework_assignment")
      .insert({ ...payload, tenant_id: resolvedTenantId })
      .select("homework_id")
      .single();

    if (!error && data) {
      hwAssignmentHasTenantCol = true;
      return data as { homework_id: number };
    }
    if (isMissingTenantColumnError(error)) {
      hwAssignmentHasTenantCol = false;
    } else if (error) {
      throw error;
    }
  }

  const { data, error } = await supabaseAdmin
    .from("homework_assignment")
    .insert(payload)
    .select("homework_id")
    .single();

  if (error || !data) throw error || new Error("homework_assignment 생성 실패");
  return data as { homework_id: number };
}

async function insertStudentHomeworkResultSafe(
  supabaseAdmin: SupabaseClient,
  payload: Record<string, any>,
  resolvedTenantId: string | null
): Promise<void> {
  if (resolvedTenantId && hwResultHasTenantCol !== false) {
    const { error } = await supabaseAdmin
      .from("student_homework_result")
      .insert({ ...payload, tenant_id: resolvedTenantId });

    if (!error) {
      hwResultHasTenantCol = true;
      return;
    }
    if (isMissingTenantColumnError(error)) {
      hwResultHasTenantCol = false;
    } else {
      throw error;
    }
  }

  const { error } = await supabaseAdmin.from("student_homework_result").insert(payload);
  if (error) throw error;
}

function computeNextSessionDueDate(
  kstNowMs: number,
  scheduleInfo?: { days: string[]; holidays: string[]; extras: string[] }
): string {
  const days = scheduleInfo?.days || [];
  const holidays = scheduleInfo?.holidays || [];
  const extras = scheduleInfo?.extras || [];

  const getFallback = () => {
    const fbDate = new Date(kstNowMs + 7 * 24 * 3600000);
    return `${fbDate.getUTCFullYear()}-${String(fbDate.getUTCMonth() + 1).padStart(2, "0")}-${String(
      fbDate.getUTCDate()
    ).padStart(2, "0")}T22:00:00+09:00`;
  };

  if (days.length === 0 && extras.length === 0) return getFallback();

  const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
  let cursorMs = kstNowMs;

  for (let i = 1; i <= 30; i++) {
    cursorMs += 24 * 3600000;
    const targetDate = new Date(cursorMs);
    const ty = targetDate.getUTCFullYear();
    const tm = String(targetDate.getUTCMonth() + 1).padStart(2, "0");
    const td = String(targetDate.getUTCDate()).padStart(2, "0");
    const ymd = `${ty}-${tm}-${td}`;
    const dayLabel = DAY_LABELS[targetDate.getUTCDay()];

    if (extras.includes(ymd) || (days.includes(dayLabel) && !holidays.includes(ymd))) {
      return `${ymd}T22:00:00+09:00`;
    }
  }
  return getFallback();
}

async function cancelProgressOnServer(
  supabaseAdmin: SupabaseClient,
  classId: string,
  tqIds: number[],
  targetStudentIds: string[]
) {
  if (!tqIds.length || !classId || !targetStudentIds.length) return;

  const tqSet = new Set<number>(tqIds);
  const targetStuSet = new Set<string>(targetStudentIds);

  const { data: assignments, error: getErr } = await supabaseAdmin
    .from("homework_assignment")
    .select("homework_id, target_questions, homework_title, target_student_id")
    .eq("class_id", classId);

  if (getErr) throw getErr;
  if (!assignments || assignments.length === 0) return;

  const relevantHws = assignments.filter(
    (hw: any) => !hw.target_student_id || targetStuSet.has(hw.target_student_id)
  );
  if (relevantHws.length === 0) return;

  const hwIds = relevantHws.map((hw: any) => hw.homework_id);
  const allResults: any[] = [];
  for (let i = 0; i < hwIds.length; i += 200) {
    const chunk = hwIds.slice(i, i + 200);
    const { data: resRows, error: resErr } = await supabaseAdmin
      .from("student_homework_result")
      .select("hw_result_id, homework_id, student_id, completed_tq_ids")
      .in("homework_id", chunk);
    if (resErr) throw resErr;
    if (resRows) allResults.push(...resRows);
  }

  const resultsByHw = new Map<number, any[]>();
  allResults.forEach((r) => {
    const arr = resultsByHw.get(r.homework_id) || [];
    arr.push(r);
    resultsByHw.set(r.homework_id, arr);
  });

  for (const hw of relevantHws) {
    const hwResults = resultsByHw.get(hw.homework_id) || [];

    for (const r of hwResults) {
      if (!targetStuSet.has(r.student_id)) continue;
      const comp = safeParseIds(r.completed_tq_ids);
      const newComp = comp.filter((id: number) => !tqSet.has(id));
      if (newComp.length !== comp.length) {
        const { error: updErr } = await supabaseAdmin
          .from("student_homework_result")
          .update({ completed_tq_ids: newComp })
          .eq("hw_result_id", r.hw_result_id);
        if (updErr) throw updErr;
        r.completed_tq_ids = newComp;
      }
    }

    if (hw.target_student_id !== null && targetStuSet.has(hw.target_student_id)) {
      const tqArr = safeParseIds(hw.target_questions);
      const remaining = tqArr.filter((id: number) => !tqSet.has(id));
      const targetChanged = remaining.length !== tqArr.length;

      let allResultsEmpty = true;
      hwResults.forEach((r) => {
        if (safeParseIds(r.completed_tq_ids).length > 0) allResultsEmpty = false;
      });

      if (
        remaining.length === 0 &&
        allResultsEmpty &&
        hw.homework_title !== "[시스템] 수업 진도 완료 기록"
      ) {
        await supabaseAdmin.from("student_homework_result").delete().eq("homework_id", hw.homework_id);
        const { error: delHwErr } = await supabaseAdmin
          .from("homework_assignment")
          .delete()
          .eq("homework_id", hw.homework_id);
        if (delHwErr) throw delHwErr;
      } else if (targetChanged) {
        const { error: updHwErr } = await supabaseAdmin
          .from("homework_assignment")
          .update({ target_questions: remaining })
          .eq("homework_id", hw.homework_id);
        if (updHwErr) throw updHwErr;
      }
    }
  }
}

async function syncProgressExclusionsOnServer(
  supabaseAdmin: SupabaseClient,
  classId: string,
  tqIds: number[],
  studentIds: string[],
  mode: "ADD" | "REMOVE"
) {
  if (!tqIds.length || !studentIds.length || !classId) return;

  if (mode === "ADD") {
    const rows = studentIds.flatMap((sId) =>
      tqIds.map((tq_id) => ({ class_id: classId, student_id: sId, tq_id }))
    );
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabaseAdmin
        .from("progress_exclusion")
        .upsert(rows.slice(i, i + 500), {
          onConflict: "class_id,student_id,tq_id",
          ignoreDuplicates: true,
        });
      if (error) {
        console.warn("progress_exclusion 저장 경고(무시 가능):", error.message);
        return;
      }
    }
  } else {
    for (let i = 0; i < tqIds.length; i += 200) {
      const { error } = await supabaseAdmin
        .from("progress_exclusion")
        .delete()
        .eq("class_id", classId)
        .in("student_id", studentIds)
        .in("tq_id", tqIds.slice(i, i + 200));
      if (error) {
        console.warn("progress_exclusion 삭제 경고(무시 가능):", error.message);
        return;
      }
    }
  }
}

async function markProgressCompleteOnServer(
  supabaseAdmin: SupabaseClient,
  classId: string,
  bookId: string,
  tqIds: number[],
  targetStudentIds: string[],
  resolvedTenantId: string | null
) {
  if (!tqIds.length || !bookId || !targetStudentIds.length) return;

  const { data: existingHws, error: existingErr } = await supabaseAdmin
    .from("homework_assignment")
    .select("homework_id, target_student_id")
    .eq("class_id", classId)
    .eq("book_id", bookId)
    .in("target_student_id", targetStudentIds)
    .eq("homework_title", "[시스템] 수업 진도 완료 기록");

  if (existingErr) throw existingErr;

  const hwIdByStudent = new Map<string, number>();
  (existingHws || []).forEach((row: any) => {
    if (row.target_student_id && !hwIdByStudent.has(row.target_student_id)) {
      hwIdByStudent.set(row.target_student_id, row.homework_id);
    }
  });

  await Promise.all(
    targetStudentIds.map(async (sId) => {
      let hwId = hwIdByStudent.get(sId);
      if (!hwId) {
        const ins = await insertHomeworkAssignmentSafe(
          supabaseAdmin,
          {
            book_id: bookId,
            target_questions: [],
            due_date: "2099-12-31T22:00:00+09:00",
            homework_title: "[시스템] 수업 진도 완료 기록",
            class_id: classId,
            target_student_id: sId,
          },
          resolvedTenantId
        );
        hwId = ins.homework_id;
      }

      const { data: res, error: resFetchErr } = await supabaseAdmin
        .from("student_homework_result")
        .select("hw_result_id, completed_tq_ids")
        .eq("homework_id", hwId)
        .eq("student_id", sId)
        .maybeSingle();

      if (resFetchErr) throw resFetchErr;

      const nowIso = new Date().toISOString();
      if (res) {
        const comp = safeParseIds(res.completed_tq_ids);
        const newComp = Array.from(new Set([...comp, ...tqIds]));
        const { error: updErr } = await supabaseAdmin
          .from("student_homework_result")
          .update({ completed_tq_ids: newComp, status: "채점완료", checked_at: nowIso })
          .eq("hw_result_id", res.hw_result_id);
        if (updErr) throw updErr;
      } else {
        await insertStudentHomeworkResultSafe(
          supabaseAdmin,
          {
            homework_id: hwId,
            student_id: sId,
            status: "채점완료",
            completed_tq_ids: tqIds,
            checked_at: nowIso,
          },
          resolvedTenantId
        );
      }
    })
  );
}

async function saveHomeworkOnServer(
  supabaseAdmin: SupabaseClient,
  classId: string,
  bookId: string,
  tqIds: number[],
  isWorkbook: boolean,
  targetStudentIds: string[],
  scheduleInfo: { days: string[]; holidays: string[]; extras: string[] } | undefined,
  resolvedTenantId: string | null
) {
  if (!tqIds.length || !bookId || !targetStudentIds.length) return;

  const kstNowMs = Date.now() + 9 * 3600000;
  const kstNowDate = new Date(kstNowMs);
  const y = kstNowDate.getUTCFullYear();
  const m = String(kstNowDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kstNowDate.getUTCDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;
  const expectedTitle = `[시스템] ${isWorkbook ? "워크북 과제" : "본교재 과제"} (${dateStr})`;
  const nextSessionStr = computeNextSessionDueDate(kstNowMs, scheduleInfo);

  const { data: todayHws, error: todayErr } = await supabaseAdmin
    .from("homework_assignment")
    .select("homework_id, target_questions, target_student_id, homework_title, due_date")
    .eq("class_id", classId)
    .eq("book_id", bookId)
    .not("homework_title", "eq", "[시스템] 수업 진도 완료 기록")
    .gte("created_at", `${dateStr}T00:00:00+09:00`)
    .lte("created_at", `${dateStr}T23:59:59.999+09:00`);

  if (todayErr) throw todayErr;

  const individualHws = (todayHws || []).filter((hw: any) => hw.target_student_id !== null);
  const baseDueDate = individualHws.length > 0 ? individualHws[0].due_date : nextSessionStr;

  const indHwIds = individualHws.map((hw: any) => hw.homework_id);
  const statusMapByHwStu = new Map<string, string>();
  if (indHwIds.length > 0) {
    const { data: resRows } = await supabaseAdmin
      .from("student_homework_result")
      .select("homework_id, student_id, status")
      .in("homework_id", indHwIds)
      .in("student_id", targetStudentIds);

    (resRows || []).forEach((r: any) => {
      statusMapByHwStu.set(`${r.homework_id}_${r.student_id}`, r.status);
    });
  }

  await Promise.all(
    targetStudentIds.map(async (stuId) => {
      const indHwsForStudent = individualHws.filter((hw: any) => hw.target_student_id === stuId);
      let targetHwToMerge: any = null;

      for (const hw of indHwsForStudent) {
        const st = statusMapByHwStu.get(`${hw.homework_id}_${stuId}`);
        if (st && !["채점완료", "제출완료", "완료", "최종완료"].includes(st)) {
          targetHwToMerge = hw;
          break;
        }
      }

      if (targetHwToMerge) {
        const existingInd = safeParseIds(targetHwToMerge.target_questions);
        const combinedTqs = Array.from(new Set([...existingInd, ...tqIds]));

        const { error: updErr } = await supabaseAdmin
          .from("homework_assignment")
          .update({ target_questions: combinedTqs, due_date: baseDueDate })
          .eq("homework_id", targetHwToMerge.homework_id);
        if (updErr) throw updErr;
      } else {
        const insData = await insertHomeworkAssignmentSafe(
          supabaseAdmin,
          {
            book_id: bookId,
            target_questions: tqIds,
            class_id: classId,
            target_student_id: stuId,
            due_date: baseDueDate,
            homework_title: expectedTitle,
          },
          resolvedTenantId
        );

        await insertStudentHomeworkResultSafe(
          supabaseAdmin,
          {
            homework_id: insData.homework_id,
            student_id: stuId,
            status: "미제출",
            completed_tq_ids: [],
          },
          resolvedTenantId
        );
      }
    })
  );
}

interface ApplyProgressBatchParams {
  actionType: string;
  classId: string;
  mainBookId?: string;
  wbBookId?: string;
  mainIds: number[];
  wbIds: number[];
  targetStudentIds: string[];
  scheduleInfo?: {
    days: string[];
    holidays: string[];
    extras: string[];
  };
  clientTenantId?: string;
}

export async function applyProgressBatchAction(params: ApplyProgressBatchParams) {
  const supabaseAdmin = getAdminClient();

  try {
    const {
      actionType,
      classId,
      mainBookId,
      wbBookId,
      mainIds = [],
      wbIds = [],
      targetStudentIds = [],
      scheduleInfo,
      clientTenantId,
    } = params;

    if (!targetStudentIds.length || (!mainIds.length && !wbIds.length)) {
      return { success: true };
    }

    const authCheck = await verifyClassAndResolveTenant(supabaseAdmin, classId, clientTenantId);
    if (!authCheck.ok) {
      return { success: false, message: authCheck.message };
    }
    const { resolvedTenantId } = authCheck;

    const allIds = Array.from(new Set([...mainIds, ...wbIds]));

    // 1) 기존 배정/완료 상태 정리
    await cancelProgressOnServer(supabaseAdmin, classId, allIds, targetStudentIds);

    // 2) 진도 취소(progress_exclusion) 기록 동기화
    if (actionType === "CANCEL") {
      await syncProgressExclusionsOnServer(supabaseAdmin, classId, allIds, targetStudentIds, "ADD");
    } else {
      await syncProgressExclusionsOnServer(
        supabaseAdmin,
        classId,
        allIds,
        targetStudentIds,
        "REMOVE"
      );
    }

    // 3) 액션 유형별 진도 완료 / 과제 배부 저장
    if (actionType === "DONE_AND_WB_HW") {
      if (mainIds.length > 0 && mainBookId) {
        await markProgressCompleteOnServer(
          supabaseAdmin,
          classId,
          mainBookId,
          mainIds,
          targetStudentIds,
          resolvedTenantId
        );
      }
      if (wbIds.length > 0 && wbBookId) {
        await saveHomeworkOnServer(
          supabaseAdmin,
          classId,
          wbBookId,
          wbIds,
          true,
          targetStudentIds,
          scheduleInfo,
          resolvedTenantId
        );
      }
    } else if (actionType === "MAIN_HW_AND_WB_HW") {
      if (mainIds.length > 0 && mainBookId) {
        await saveHomeworkOnServer(
          supabaseAdmin,
          classId,
          mainBookId,
          mainIds,
          false,
          targetStudentIds,
          scheduleInfo,
          resolvedTenantId
        );
      }
      if (wbIds.length > 0 && wbBookId) {
        await saveHomeworkOnServer(
          supabaseAdmin,
          classId,
          wbBookId,
          wbIds,
          true,
          targetStudentIds,
          scheduleInfo,
          resolvedTenantId
        );
      }
    } else if (actionType === "DONE_ONLY") {
      if (mainIds.length > 0 && mainBookId) {
        await markProgressCompleteOnServer(
          supabaseAdmin,
          classId,
          mainBookId,
          mainIds,
          targetStudentIds,
          resolvedTenantId
        );
      }
      if (wbIds.length > 0 && wbBookId) {
        await markProgressCompleteOnServer(
          supabaseAdmin,
          classId,
          wbBookId,
          wbIds,
          targetStudentIds,
          resolvedTenantId
        );
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error("applyProgressBatchAction 오류:", err);
    return {
      success: false,
      message: err?.message || "진도/과제 DB 저장 중 오류가 발생했습니다.",
    };
  }
}

export async function getProgressStatusMapAction(params: {
  classId: string;
  studentIds: string[];
  clientTenantId?: string;
}) {
  const supabaseAdmin = getAdminClient();

  try {
    const { classId, studentIds = [], clientTenantId } = params;
    const authCheck = await verifyClassAndResolveTenant(supabaseAdmin, classId, clientTenantId);
    if (!authCheck.ok) {
      return { success: false, message: authCheck.message, statusMap: {}, startPages: {} };
    }

    const [
      { data: assignments, error: hwErr },
      { data: examAssignments },
      { data: startRows },
    ] = await Promise.all([
      supabaseAdmin
        .from("homework_assignment")
        .select(
          "homework_id, target_questions, target_student_id, student_homework_result(student_id, completed_tq_ids, status)"
        )
        .eq("class_id", classId),
      supabaseAdmin
        .from("exam_assignment")
        .select(
          `
          assignment_id, student_id, status,
          exam_master!inner(
            exam_type,
            exam_item(question_id)
          )
        `
        )
        .eq("class_id", classId)
        .in("exam_master.exam_type", ["과제", "과제프린트"]),
      supabaseAdmin
        .from("student_textbook_start")
        .select("student_id, book_id, start_page")
        .eq("class_id", classId),
    ]);

    if (hwErr) throw hwErr;

    const startPages: Record<string, number> = {};
    (startRows || []).forEach((r: any) => {
      startPages[`${r.student_id}_${r.book_id}`] = Number(r.start_page);
    });

    const excludedSet = new Set<string>();
    if (studentIds.length > 0) {
      let fromEx = 0;
      while (true) {
        const { data: exRows, error: exErr } = await supabaseAdmin
          .from("progress_exclusion")
          .select("student_id, tq_id")
          .eq("class_id", classId)
          .in("student_id", studentIds)
          .range(fromEx, fromEx + 999);
        if (exErr || !exRows || exRows.length === 0) break;
        exRows.forEach((r: any) => excludedSet.add(`${r.tq_id}_${r.student_id}`));
        if (exRows.length < 1000) break;
        fromEx += 1000;
      }
    }

    const tqStudentStatus: Record<number, Record<string, string>> = {};

    (assignments || []).forEach((hw: any) => {
      const targetQs = safeParseIds(hw.target_questions);

      if (hw.target_student_id) {
        targetQs.forEach((tqId: number) => {
          if (!tqStudentStatus[tqId]) tqStudentStatus[tqId] = {};
          if (tqStudentStatus[tqId][hw.target_student_id] !== "done") {
            tqStudentStatus[tqId][hw.target_student_id] = "homework";
          }
        });
      } else {
        studentIds.forEach((sId) => {
          targetQs.forEach((tqId: number) => {
            if (!tqStudentStatus[tqId]) tqStudentStatus[tqId] = {};
            if (tqStudentStatus[tqId][sId] !== "done") {
              tqStudentStatus[tqId][sId] = "homework";
            }
          });
        });
      }

      (hw.student_homework_result || []).forEach((res: any) => {
        const sId = res.student_id;
        const isFullyDone = ["채점완료", "제출완료", "완료", "최종완료"].includes(res.status);

        if (isFullyDone) {
          targetQs.forEach((tqId: number) => {
            if (!tqStudentStatus[tqId]) tqStudentStatus[tqId] = {};
            tqStudentStatus[tqId][sId] = "done";
          });
        }

        const completedQs = safeParseIds(res.completed_tq_ids);
        completedQs.forEach((tqId: number) => {
          if (!tqStudentStatus[tqId]) tqStudentStatus[tqId] = {};
          tqStudentStatus[tqId][sId] = "done";
        });
      });
    });

    const examQuestionIds = new Set<number>();
    (examAssignments || []).forEach((ea: any) => {
      const m = Array.isArray(ea.exam_master) ? ea.exam_master[0] : ea.exam_master;
      const items = m?.exam_item || [];
      items.forEach((item: any) => {
        if (item.question_id) examQuestionIds.add(item.question_id);
      });
    });

    const qIdToTqId = new Map<number, number>();
    if (examQuestionIds.size > 0) {
      const qIdsArr = Array.from(examQuestionIds);
      for (let i = 0; i < qIdsArr.length; i += 300) {
        const { data: tqMapping } = await supabaseAdmin
          .from("textbook_question")
          .select("tq_id, question_id")
          .in("question_id", qIdsArr.slice(i, i + 300));
        (tqMapping || []).forEach((t: any) => {
          if (t.question_id) qIdToTqId.set(t.question_id, t.tq_id);
        });
      }
    }

    (examAssignments || []).forEach((ea: any) => {
      const sId = ea.student_id;
      const isDone = ["채점완료", "제출완료", "완료", "최종완료"].includes(ea.status);
      const m = Array.isArray(ea.exam_master) ? ea.exam_master[0] : ea.exam_master;
      const items = m?.exam_item || [];

      items.forEach((item: any) => {
        const tqId = qIdToTqId.get(item.question_id);
        if (tqId) {
          if (excludedSet.has(`${tqId}_${sId}`)) return;
          if (!tqStudentStatus[tqId]) tqStudentStatus[tqId] = {};
          const currentSt = tqStudentStatus[tqId][sId];
          if (currentSt !== "done") {
            tqStudentStatus[tqId][sId] = isDone ? "done" : "homework";
          }
        }
      });
    });

    const statusMap: Record<string, string> = {};
    Object.keys(tqStudentStatus).forEach((tqIdStr) => {
      const tqId = Number(tqIdStr);
      studentIds.forEach((sId) => {
        const st = tqStudentStatus[tqId]?.[sId];
        if (st) statusMap[`${classId}_${tqId}_${sId}`] = st;
      });
    });

    return { success: true, statusMap, startPages };
  } catch (err: any) {
    console.error("getProgressStatusMapAction 오류:", err);
    return {
      success: false,
      message: err?.message || "진도 현황을 불러오지 못했습니다.",
      statusMap: {},
      startPages: {},
    };
  }
}

export async function saveStudentStartPageAction(params: {
  classId: string;
  studentId: string;
  bookId: string;
  page: number | null;
  clientTenantId?: string;
}) {
  const supabaseAdmin = getAdminClient();

  try {
    const { classId, studentId, bookId, page, clientTenantId } = params;
    const authCheck = await verifyClassAndResolveTenant(supabaseAdmin, classId, clientTenantId);
    if (!authCheck.ok) {
      return { success: false, message: authCheck.message };
    }

    if (page === null) {
      const { error } = await supabaseAdmin
        .from("student_textbook_start")
        .delete()
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .eq("book_id", bookId);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin.from("student_textbook_start").upsert(
        {
          class_id: classId,
          student_id: studentId,
          book_id: bookId,
          start_page: page,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "class_id,student_id,book_id" }
      );
      if (error) throw error;
    }

    return { success: true };
  } catch (err: any) {
    console.error("saveStudentStartPageAction 오류:", err);
    return {
      success: false,
      message: err?.message || "시작 페이지 저장에 실패했습니다.",
    };
  }
}