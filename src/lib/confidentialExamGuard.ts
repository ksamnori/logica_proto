// src/lib/confidentialExamGuard.ts
// 🌟 대외비 시험('입학테스트', '진단평가') 문항이 오답노트(student_incorrect_record),
// [통합] 누적 오답 클리닉('누적 오답 모음'), 오답 프린트, 오답유사 클리닉으로 절대 유출되지 않도록 방어하는 공통 가드

export const isConfidentialExamText = (val?: any): boolean => {
  if (!val) return false;
  const s = String(val);
  return s.includes("입학테스트") || s.includes("진단평가");
};

export const isConfidentialQuestionObj = (q?: any): boolean => {
  if (!q) return false;
  const row = Array.isArray(q) ? q[0] : q;
  if (!row) return false;
  return (
    isConfidentialExamText(row.source_book_name) ||
    isConfidentialExamText(row.book_name) ||
    isConfidentialExamText(row.pdf_source)
  );
};

export const isConfidentialIncorrectRecord = (rec?: any): boolean => {
  if (!rec) return false;
  if (isConfidentialExamText(rec.source_type)) return true;
  if (rec.question_db && isConfidentialQuestionObj(rec.question_db)) return true;
  return false;
};

/**
 * 주어진 question_id 배열에서 대외비('입학테스트' / '진단평가') 출처이거나
 * 진단평가 시험지(exam_master.exam_type)에 속한 문항 ID를 완벽히 걸러냅니다.
 */
export async function filterNonConfidentialQids<T extends string | number>(
  supabaseClient: any,
  rawIds: T[]
): Promise<T[]> {
  if (!Array.isArray(rawIds) || rawIds.length === 0) return [];

  const cleanStrIds = Array.from(
    new Set(
      rawIds
        .map((id) => String(id ?? "").trim().replace(/_added_\d+$/, ""))
        .filter(Boolean)
    )
  );
  if (cleanStrIds.length === 0) return [];

  const blockedSet = new Set<string>();

  for (let i = 0; i < cleanStrIds.length; i += 300) {
    const chunk = cleanStrIds.slice(i, i + 300);
    const [{ data: qRows }, { data: eiRows }] = await Promise.all([
      supabaseClient
        .from("question_db")
        .select("question_id, source_book_name, book_name, pdf_source")
        .in("question_id", chunk),
      supabaseClient
        .from("exam_item")
        .select("question_id, exam_master!inner(exam_type, title)")
        .in("question_id", chunk),
    ]);

    (qRows || []).forEach((q: any) => {
      if (q?.question_id && isConfidentialQuestionObj(q)) {
        blockedSet.add(String(q.question_id).trim());
      }
    });

    (eiRows || []).forEach((ei: any) => {
      const m = Array.isArray(ei?.exam_master) ? ei.exam_master[0] : ei?.exam_master;
      if (ei?.question_id && (isConfidentialExamText(m?.exam_type) || isConfidentialExamText(m?.title))) {
        blockedSet.add(String(ei.question_id).trim());
      }
    });
  }

  return rawIds.filter((id) => {
    const clean = String(id ?? "").trim().replace(/_added_\d+$/, "");
    return clean && !blockedSet.has(clean);
  });
}
