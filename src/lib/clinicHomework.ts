// src/lib/clinicHomework.ts

export type PendingHwQuestion = {
  tq_id: any; // 🌟 숫자형(교재) 또는 UUID 문자열(부교재) 모두 허용
  question_id: string | number | null;
  answer: string | null;
  image_url: string | null;
  raw_metadata: any;
  book_id: number | null;
  homeworkId: number | null;
  homeworkTitle: string | null;
  bookType: string | null;
  bookTitle: string | null;
  [key: string]: any; 
};

export type BookSummary = {
  bookId: number | null;
  bookType: string | null;
  bookTitle: string | null;
  count: number;
};

export const BOOK_TYPE_COLORS: Record<string, { pill: string; dot: string }> = {
  주교재: { pill: 'bg-blue-100 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  부교재: { pill: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  연산교재: { pill: 'bg-purple-100 text-purple-700 border-purple-200', dot: 'bg-purple-500' },
  워크북: { pill: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  기타: { pill: 'bg-slate-200 text-slate-700 border-slate-300', dot: 'bg-slate-500' },
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

  let allTqIds: any[] = [];
  const metaMap: Record<string, { homework_id: number; homework_title: string }> = {};
  
  assignments.forEach((hw: any) => {
    let tqIds = typeof hw.target_questions === 'string' ? JSON.parse(hw.target_questions) : hw.target_questions;
    const res = hw.student_homework_result?.find((r: any) => r.student_id === studentId) || {};
    let compIds = typeof res.completed_tq_ids === 'string' ? JSON.parse(res.completed_tq_ids) : res.completed_tq_ids;
    
    if (!Array.isArray(tqIds)) tqIds = [];
    if (!Array.isArray(compIds)) compIds = [];

    tqIds.forEach((idVal: any) => {
      if (!compIds.includes(idVal)) {
        allTqIds.push(idVal);
        metaMap[String(idVal)] = { homework_id: hw.homework_id, homework_title: hw.homework_title };
      }
    });
  });

  const uniqueIds = [...new Set(allTqIds)];

  // 🌟 [핵심 방어 로직] 숫자형(tq_id)과 문자열(UUID) 철저히 분리
  const numIds = uniqueIds
    .filter(id => id !== null && id !== undefined && (typeof id === 'number' || (typeof id === 'string' && !id.includes('-') && !isNaN(Number(id)))))
    .map(Number);

  const uuidIds = uniqueIds
    .filter(id => id && typeof id === 'string' && id.includes('-'));

  if (numIds.length === 0 && uuidIds.length === 0) return { rows: [], booksSummary: [] };

  // 🌟 분리된 ID들을 각각의 테이블에 맞게 쿼리 실행
  const [tqRes, qDbRes] = await Promise.all([
    numIds.length > 0 ? supabaseClient.from('textbook_question').select('*, textbook(book_type, title)').in('tq_id', numIds) : Promise.resolve({ data: [] }),
    uuidIds.length > 0 ? supabaseClient.from('question_db').select('*').in('question_id', uuidIds) : Promise.resolve({ data: [] })
  ]);

  const rows: PendingHwQuestion[] = [];

  // 1. 순수 교재 문항 (textbook_question) 병합
  (tqRes.data || []).forEach((q: any) => {
    rows.push({
      ...q,
      homeworkId: metaMap[String(q.tq_id)]?.homework_id ?? null,
      homeworkTitle: metaMap[String(q.tq_id)]?.homework_title ?? null,
      bookType: q.textbook?.book_type ?? null,
      bookTitle: q.textbook?.title ?? null,
    });
  });

  // 2. 부교재/프린트 문항 (question_db) 병합
  (qDbRes.data || []).forEach((q: any) => {
    rows.push({
      ...q,
      tq_id: q.question_id, // 시스템 호환성을 위해 tq_id 필드에 매핑
      homeworkId: metaMap[String(q.question_id)]?.homework_id ?? null,
      homeworkTitle: metaMap[String(q.question_id)]?.homework_title ?? null,
      bookType: '기타',
      bookTitle: q.source_book_name ?? '추가 문항',
    });
  });

  const summaryMap = new Map<string, BookSummary>();
  rows.forEach(r => {
    const key = String(r.book_id || r.bookTitle); // book_id가 없으면 교재명으로 묶음
    const existing = summaryMap.get(key);
    if (existing) existing.count++;
    else summaryMap.set(key, { bookId: r.book_id || null, bookType: r.bookType, bookTitle: r.bookTitle, count: 1 });
  });

  return { rows, booksSummary: [...summaryMap.values()] };
}