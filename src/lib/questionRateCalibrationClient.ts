// src/lib/questionRateCalibrationClient.ts
// 채점·수정·삭제 발생 시 UI 흐름을 절대 블로킹하지 않고 백그라운드로 문항 정답률·난이도 보정을 즉시 트리거합니다.

export interface RealtimeCalibrationPayload {
  questionIds?: Array<string | number | null | undefined>;
  tqIds?: Array<string | number | null | undefined>;
  assignmentIds?: Array<string | number | null | undefined>;
  examIds?: Array<string | null | undefined>;
  homeworkIds?: Array<string | number | null | undefined>;
  studentIds?: Array<string | null | undefined>;
}

export function triggerRealtimeQuestionCalibration(payload: RealtimeCalibrationPayload): void {
  if (typeof window === "undefined") return;

  const questionIds = Array.from(
    new Set((payload.questionIds || []).map((v) => String(v ?? "").trim()).filter(Boolean))
  );
  const tqIds = Array.from(
    new Set((payload.tqIds || []).map((v) => String(v ?? "").trim()).filter(Boolean))
  );
  const assignmentIds = Array.from(
    new Set((payload.assignmentIds || []).map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))
  );
  const examIds = Array.from(
    new Set((payload.examIds || []).map((v) => String(v ?? "").trim()).filter(Boolean))
  );
  const homeworkIds = Array.from(
    new Set((payload.homeworkIds || []).map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))
  );
  const studentIds = Array.from(
    new Set((payload.studentIds || []).map((v) => String(v ?? "").trim()).filter(Boolean))
  );

  if (
    questionIds.length === 0 &&
    tqIds.length === 0 &&
    assignmentIds.length === 0 &&
    examIds.length === 0 &&
    homeworkIds.length === 0
  ) {
    return;
  }

  fetch("/api/question-calibration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      action: "realtime",
      questionIds,
      tqIds,
      assignmentIds,
      examIds,
      homeworkIds,
      studentIds,
    }),
  }).catch(() => {
    // 백그라운드 보정 실패가 채점 UI에 영향을 주지 않도록 무시
  });
}
