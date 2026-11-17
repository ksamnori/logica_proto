// src/lib/questionSafeDeleteClient.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuestionDeleteImpact } from "./questionSafeDeleteServer";

export type InteractiveDeleteOutcome =
  | { outcome: "CANCELLED" }
  | { outcome: "HIDDEN" }
  | { outcome: "DELETED"; unlinkedChildCount: number }
  | { outcome: "ERROR"; error: string };

async function callQuestionTwinPut(
  supabaseClient: SupabaseClient,
  payload: Record<string, any>
): Promise<any> {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const token = sessionData?.session?.access_token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch("/api/gemini-twin", {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      success: false,
      error: json?.error || `서버 응답 오류 (HTTP ${res.status})`,
    };
  }
  return json;
}

function formatImpactSummaryLines(impact: QuestionDeleteImpact): string[] {
  const lines: string[] = [];
  if (impact.incorrectRecordCount > 0) {
    lines.push(`• 학생 오답 기록(student_incorrect_record): ${impact.incorrectRecordCount}건`);
  }
  if (impact.clinicTaskCount > 0) {
    lines.push(`• 클리닉 배정 과제(clinic_task): ${impact.clinicTaskCount}건`);
  }
  if (impact.examItemCount > 0) {
    lines.push(`• 시험지·프린트 수록 문항(exam_item): ${impact.examItemCount}건`);
  }
  if (impact.studentAnswerCount > 0) {
    lines.push(`• 시험 응시 답안(student_answer): ${impact.studentAnswerCount}건`);
  }
  if (impact.homeworkAnswerCount > 0) {
    lines.push(`• 과제 제출 답안(student_homework_answer): ${impact.homeworkAnswerCount}건`);
  }
  return lines;
}

/**
 * 분류 에디터(/taxonomy-editor) 및 쌍둥이 매니저(/twin-manager) 공통 안전 삭제 실행기
 * 1) 삭제 전 서버에서 연결된 오답·클리닉·시험·쌍둥이 참조 건수를 먼저 조회합니다.
 * 2) 학생 풀이·오답 이력이 없는 문항은 확인 후 즉시 안전 삭제합니다(자식 쌍둥이 문항은 parent_question_id 자동 해제).
 * 3) 학생 이력이 존재하는 문항은 23503 에러나 반쪽 삭제를 일으키지 않고,
 *    ① 이력을 보존하는 [출제 숨김(보관) 처리] 또는 ② [연관 이력 일괄 정리 후 영구 삭제] 중 선택할 수 있게 안내합니다.
 */
export async function executeInteractiveQuestionDelete(params: {
  questionId: string;
  supabaseClient: SupabaseClient;
}): Promise<InteractiveDeleteOutcome> {
  const cleanId = String(params.questionId || "").trim();
  if (!cleanId) {
    return { outcome: "ERROR", error: "삭제할 문항 ID가 없습니다." };
  }

  // 1단계: 서버 참조 영향도 사전 스캔
  const inspectRes = await callQuestionTwinPut(params.supabaseClient, {
    action: "inspect_delete_question",
    questionId: cleanId,
  });

  if (!inspectRes?.success || !inspectRes?.impact) {
    return {
      outcome: "ERROR",
      error: inspectRes?.error || "문항 참조 이력 확인에 실패했습니다.",
    };
  }

  const impact: QuestionDeleteImpact = inspectRes.impact;

  // 2단계 A: 학생 학습·오답 이력이 없는 깨끗한 문항
  if (!impact.hasStudentHistory) {
    const twinNote =
      impact.childTwinCount > 0
        ? `

※ 연결된 자식 쌍둥이·유사 문항 ${impact.childTwinCount}건은 삭제되지 않고 독립 문항(부모 연결 해제)으로 안전하게 유지됩니다.`
        : "";

    const ok = window.confirm(
      `⚠️ 정말 이 문항을 마스터 DB에서 완전히 삭제하시겠습니까?
(교재 매핑 ${impact.textbookQuestionCount}건 함께 정리, 복구 불가)${twinNote}`
    );
    if (!ok) {
      return { outcome: "CANCELLED" };
    }

    const delRes = await callQuestionTwinPut(params.supabaseClient, {
      action: "delete_question",
      questionId: cleanId,
      forceCascade: false,
    });

    if (!delRes?.success) {
      return {
        outcome: "ERROR",
        error: delRes?.error || "문항 삭제에 실패했습니다.",
      };
    }

    return {
      outcome: "DELETED",
      unlinkedChildCount: Number(delRes.unlinkedChildCount || 0),
    };
  }

  // 2단계 B: 학생 오답·클리닉·시험 이력이 연결된 문항 (기존 23503 발생 케이스)
  const historyLines = formatImpactSummaryLines(impact).join("
");
  const twinSuffix =
    impact.childTwinCount > 0
      ? `
• 연결된 자식 쌍둥이 문항: ${impact.childTwinCount}건 (영구 삭제 시 부모 연결만 해제)`
      : "";

  if (!impact.isCurrentlyHidden) {
    const chooseHide = window.confirm(
      `🛡️ 이 문항에는 학생 학습·오답 이력이 연결되어 있습니다.

` +
        `${historyLines}${twinSuffix}

` +
        `[확인]을 누르면 학생들의 기존 오답·성적 기록을 그대로 보존하면서 앞으로 시험지 출제에서만 제외하는 '숨김(보관) 처리'를 적용합니다. (권장)
` +
        `[취소]를 누르면 연관 이력 일괄 정리(영구 삭제) 선택 창으로 이동합니다.`
    );

    if (chooseHide) {
      const hideRes = await callQuestionTwinPut(params.supabaseClient, {
        action: "hide_question",
        questionId: cleanId,
      });
      if (!hideRes?.success) {
        return {
          outcome: "ERROR",
          error: hideRes?.error || "문항 숨김(보관) 처리에 실패했습니다.",
        };
      }
      return { outcome: "HIDDEN" };
    }
  }

  const confirmForceDelete = window.confirm(
    `🚨 [영구 삭제 최종 확인]

` +
      `아래 연결된 학생 학습 이력을 모두 함께 삭제하고 문항을 마스터 DB에서 영구 제거하시겠습니까?

` +
      `${historyLines}${twinSuffix}

` +
      `※ 이 작업은 되돌릴 수 없습니다. [취소]를 누르면 아무 데이터도 변경되지 않고 안전하게 취소됩니다.`
  );

  if (!confirmForceDelete) {
    return { outcome: "CANCELLED" };
  }

  const forceRes = await callQuestionTwinPut(params.supabaseClient, {
    action: "delete_question",
    questionId: cleanId,
    forceCascade: true,
  });

  if (!forceRes?.success) {
    return {
      outcome: "ERROR",
      error: forceRes?.error || "연관 이력 정리 및 문항 삭제에 실패했습니다.",
    };
  }

  return {
    outcome: "DELETED",
    unlinkedChildCount: Number(forceRes.unlinkedChildCount || 0),
  };
}
