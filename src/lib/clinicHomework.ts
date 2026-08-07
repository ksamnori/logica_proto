// src/lib/clinicHomework.ts
// 클리닉 정규과제/미완성과제(round 2/3)에서 "미완료 문제 목록"을 뽑는 로직을
// src/app/clinic/page.tsx와 src/app/clinic/viewer/page.tsx가 완전히 동일하게 중복 구현하고
// 있었다. 여기로 옮기면서 textbook_question -> textbook(book_type, title) 조인도 추가해,
// 교재 종류별로 몇 문제가 남았는지(booksSummary)까지 함께 계산해준다.
export type PendingHwQuestion = {
  tq_id: number;
  question_id: number | null;
  answer: string | null;
  image_url: string | null;
  raw_metadata: any;
  book_id: number | null;
  homeworkId: number | null;
  homeworkTitle: string | null;
  bookType: string | null;
  bookTitle: string | null;
  [key: string]: any; // textbook_question의 나머지 원본 컬럼들도 그대로 보존
};

export type BookSummary = {
  bookId: number | null;
  bookType: string | null;
  bookTitle: string | null;
  count: number;
};

// 교재종류(주교재/부교재/연산교재/워크북) 배지 색상 — 클리닉/진도관리 등 여러 화면에서 재사용.
export const BOOK_TYPE_COLORS: Record<string, { pill: string; dot: string }> = {
  주교재: { pill: 'bg-blue-100 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  부교재: { pill: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  연산교재: { pill: 'bg-purple-100 text-purple-700 border-purple-200', dot: 'bg-purple-500' },
  워크북: { pill: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  // exam_type='과제'/'과제프린트'로 개별 배정되어 round=2에 병합된 문항용(실제 교재가 아님).
  기타: { pill: 'bg-slate-200 text-slate-700 border-slate-300', dot: 'bg-slate-500' },
  // exam_type='오답프린트'로 배정된 문항용 — 다른 배정과 구분되게 오답임을 바로 알 수 있는 빨간 배지.
  오답: { pill: 'bg-rose-100 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
};

export async function resolvePendingHomeworkQuestions(
  supabaseClient: any,
  studentId: string,
  hwIds: number[]
): Promise<{ rows: PendingHwQuestion[]; booksSummary: BookSummary[] }> {
  if (!hwIds || hwIds.length === 0) return { rows: [], booksSummary: [] };

  const { data: assignments } = await supabaseClient
    .from('homework_assignment')
    .select('homework_id, homework_title, target_questions, student_homework_result(status, completed_tq_ids)')
    .in('homework_id', hwIds);
  if (!assignments || assignments.length === 0) return { rows: [], booksSummary: [] };

  let allTqIds: number[] = [];
  const metaMap: Record<number, { homework_id: number; homework_title: string }> = {};
  assignments.forEach((hw: any) => {
    let tqIds = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : hw.target_questions;
    const res = hw.student_homework_result?.find((r: any) => r.student_id === studentId) || {};
    let compIds = typeof res.completed_tq_ids === 'string' ? JSON.parse(res.completed_tq_ids) : res.completed_tq_ids;
    if (!Array.isArray(tqIds)) tqIds = [];
    if (!Array.isArray(compIds)) compIds = [];

    tqIds.forEach((idNum: number) => {
      if (!compIds.includes(idNum)) {
        allTqIds.push(idNum);
        metaMap[idNum] = { homework_id: hw.homework_id, homework_title: hw.homework_title };
      }
    });
  });

  allTqIds = [...new Set(allTqIds)];
  if (allTqIds.length === 0) return { rows: [], booksSummary: [] };

  const { data: qs } = await supabaseClient
    .from('textbook_question')
    .select('*, textbook(book_type, title)')
    .in('tq_id', allTqIds);

  const rows: PendingHwQuestion[] = (qs || []).map((q: any) => ({
    ...q,
    homeworkId: metaMap[q.tq_id]?.homework_id ?? null,
    homeworkTitle: metaMap[q.tq_id]?.homework_title ?? null,
    bookType: q.textbook?.book_type ?? null,
    bookTitle: q.textbook?.title ?? null,
  }));

  const summaryMap = new Map<string, BookSummary>();
  rows.forEach(r => {
    const key = String(r.book_id);
    const existing = summaryMap.get(key);
    if (existing) existing.count++;
    else summaryMap.set(key, { bookId: r.book_id, bookType: r.bookType, bookTitle: r.bookTitle, count: 1 });
  });

  return { rows, booksSummary: [...summaryMap.values()] };
}
