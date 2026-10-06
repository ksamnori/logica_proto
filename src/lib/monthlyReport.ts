// src/lib/monthlyReport.ts
// 월간 학습 리포트 데이터 수집·계산
// - 대상: 시험 답안(student_answer) + 과제 답안(student_homework_answer) 중 채점된 문항
// - 제외: 입학테스트·진단평가
// - 정답률: 처음 풀었을 때 맞힌 문항(O)만 정답. 고친 뒤 정답률은 O + RO + TO
// - 비교: 같은 학원·같은 학년 재원생 평균
import { supabase } from "@/lib/supabase";

export const COMPETENCIES = ["문제해결", "추론", "의사소통", "연결", "정보처리"] as const;
export const COGNITIVE_LEVELS = ["이해 및 연산", "적용 및 응용", "추론 및 문제 해결"] as const;
export const DIFF_LABELS = ["최하", "하", "중", "상", "최상"]; // 1~5

const FINAL_OK = ["O", "RO", "TO"];
const EXCLUDED_EXAM_TYPES = ["입학테스트", "진단평가"];
const MIN_COMP_ITEMS = 5;
const MIN_TYPE_ITEMS = 2;

// ---------- 날짜 (KST) ----------
const KST = 9 * 60 * 60 * 1000;
export const kstDate = (iso: string) => new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 10); // YYYY-MM-DD
export const ymOf = (iso: string) => kstDate(iso).slice(0, 7);
export const shiftYm = (ym: string, delta: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const ymLabel = (ym: string) => `${Number(ym.slice(5, 7))}월`;
const monthStartUtcIso = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1) - KST).toISOString();
export const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

// 그 달의 몇째 주 (월요일 시작)
export const weekOfMonth = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // 월=0
  return Math.floor((d + firstDow - 1) / 7) + 1;
};

// ---------- 유틸 ----------
const chunk = <T,>(arr: T[], n: number) => { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const unwrap = (v: any) => Array.isArray(v) ? v[0] : v;

async function selectIn(table: string, select: string, col: string, values: (string | number)[], size = 150) {
  const out: any[] = [];
  for (const part of chunk(Array.from(new Set(values)), size)) {
    if (part.length === 0) continue;
    const { data, error } = await supabase.from(table).select(select).in(col, part);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

async function selectInPaged(table: string, select: string, col: string, values: string[], extra: (q: any) => any) {
  const out: any[] = [];
  for (const part of chunk(values, 100)) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await extra(supabase.from(table).select(select).in(col, part)).range(from, from + 999);
      if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
      if (!data || data.length === 0) break;
      out.push(...data);
      if (data.length < 1000) break;
    }
  }
  return out;
}

const diffNum = (d: any): number | null => {
  if (d == null) return null;
  const s = String(d).trim();
  const i = DIFF_LABELS.indexOf(s);
  if (i >= 0) return i + 1;
  const n = Number(s);
  return n >= 1 && n <= 5 ? Math.round(n) : null;
};

export const gradeOf = (rate: number) => rate >= 90 ? 1 : rate >= 80 ? 2 : rate >= 70 ? 3 : rate >= 50 ? 4 : 5;
const pct = (a: number, b: number) => b > 0 ? Math.round((a / b) * 100) : 0;
const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

// ---------- 타입 ----------
type Rec = {
  student_id: string; ym: string; ymd: string; qid: string;
  first: boolean; final: boolean; code: string;
  sourceKey: string; sourceKind: "exam" | "hw";
};

export type MonthStat = { ym: string; count: number; rate: number; finalRate: number; diff: number; grade: number | null };
export type Report = {
  student: { student_id: string; name: string; grade: string; school: string | null; classNames: string[] };
  ym: string;
  period: string;
  hasData: boolean;
  me: MonthStat;
  peer: { count: number; rate: number; diff: number; grade: number | null; students: number };
  trend: { ym: string; me: MonthStat | null; peer: { count: number; rate: number; diff: number; grade: number | null } | null }[];
  attitude: {
    firstRate: number; finalRate: number; selfFixed: number; hinted: number; hintRate: number; wrongLeft: number;
    attendance: { present: number; late: number; early: number; absent: number };
    homework: { total: number; done: number; rate: number };
  };
  weeks: { label: string; byDiff: { n: number; rate: number | null }[]; total: number; rate: number | null }[];
  cognitive: { level: string; n: number; rate: number | null; peerRate: number | null }[];
  competency: { name: string; n: number; rate: number | null; peerRate: number | null; enough: boolean }[];
  sheets: { tag: string; title: string; date: string; n: number; rate: number }[];
  units: {
    key: string; name: string; curriculum: string; n: number; rate: number;
    types: { name: string; n: number; rate: number; mark: "우수" | "취약" | null }[];
    best: string[]; weak: string[];
  }[];
  unclassified: number;
};

// ---------- 메인 ----------
export async function buildMonthlyReport(studentId: string, ym: string, onStep?: (t: string) => void): Promise<Report> {
  const step = (t: string) => onStep?.(t);

  step("학생 정보를 불러오는 중");
  const { data: stu, error: stuErr } = await supabase.from("student").select("student_id, name, grade, school, tenant_id").eq("student_id", studentId).single();
  if (stuErr || !stu) throw new Error("학생 정보를 찾을 수 없습니다.");

  // 지금 수강 중인 반 이름 (표지용)
  const { data: enr } = await supabase.from("enrollment").select("class(name)").eq("student_id", studentId).eq("status", "수강중");
  const classNames = Array.from(new Set((enr || []).map((e: any) => unwrap(e.class)?.name).filter(Boolean))) as string[];

  // 비교 대상: 같은 학원·같은 학년 재원생 (본인 포함)
  const { data: peers } = await supabase.from("student").select("student_id").eq("tenant_id", stu.tenant_id).eq("grade", stu.grade).eq("status", "재원");
  const peerIds = Array.from(new Set([studentId, ...(peers || []).map((p: any) => p.student_id)]));

  const months = [shiftYm(ym, -2), shiftYm(ym, -1), ym];
  const fromIso = monthStartUtcIso(months[0]);
  const toIso = monthStartUtcIso(shiftYm(ym, 1));

  step("채점된 답안을 모으는 중");
  const exRows = await selectInPaged("student_answer", "student_id, exam_assignment_id, question_id, attempt_number, grading_code, updated_at", "student_id", peerIds,
    q => q.not("grading_code", "is", null).gte("updated_at", fromIso).lt("updated_at", toIso).order("answer_id"));
  const hwRows = await selectInPaged("student_homework_answer", "student_id, homework_id, tq_id, question_id, grading_code, updated_at", "student_id", peerIds,
    q => q.not("grading_code", "is", null).gte("updated_at", fromIso).lt("updated_at", toIso).order("hw_answer_id"));

  // 입학테스트·진단평가 제외 + 학습지 이름
  step("학습지 정보를 확인하는 중");
  const asgIds = Array.from(new Set(exRows.map(r => r.exam_assignment_id)));
  const asgs = await selectIn("exam_assignment", "assignment_id, admission_session_id, exam_master(title, exam_type)", "assignment_id", asgIds);
  const asgMap = new Map<number, { title: string; type: string; excluded: boolean }>();
  asgs.forEach((a: any) => {
    const em = unwrap(a.exam_master) || {};
    const type = em.exam_type || "시험";
    asgMap.set(a.assignment_id, { title: em.title || "제목 없음", type, excluded: !!a.admission_session_id || EXCLUDED_EXAM_TYPES.includes(type) });
  });
  const hwIds = Array.from(new Set(hwRows.map(r => r.homework_id)));
  const hws = await selectIn("homework_assignment", "homework_id, homework_title, display_title", "homework_id", hwIds);
  const hwMap = new Map<number, string>();
  hws.forEach((h: any) => hwMap.set(h.homework_id, (h.display_title || h.homework_title || "과제").replace(/^\[시스템\]\s*/, "")));

  // 과제 답안의 question_id가 비어 있으면 tq_id로 찾기
  const needTq = hwRows.filter(r => !r.question_id && r.tq_id).map(r => r.tq_id);
  const tqMap = new Map<number, string>();
  if (needTq.length) (await selectIn("textbook_question", "tq_id, question_id", "tq_id", needTq)).forEach((t: any) => tqMap.set(t.tq_id, t.question_id));

  // 문항별 마지막 시도만 남기기
  const recMap = new Map<string, Rec & { _rank: number }>();
  const push = (key: string, rank: number, r: Rec) => {
    const prev = recMap.get(key);
    if (!prev || rank >= prev._rank) recMap.set(key, { ...r, _rank: rank });
  };
  exRows.forEach(r => {
    const a = asgMap.get(r.exam_assignment_id);
    if (!a || a.excluded) return;
    const code = String(r.grading_code).trim();
    push(`e_${r.student_id}_${r.exam_assignment_id}_${r.question_id}`, (r.attempt_number || 1) * 1e13 + new Date(r.updated_at).getTime(), {
      student_id: r.student_id, ym: ymOf(r.updated_at), ymd: kstDate(r.updated_at), qid: r.question_id,
      first: code === "O", final: FINAL_OK.includes(code), code, sourceKey: `e_${r.exam_assignment_id}`, sourceKind: "exam",
    });
  });
  hwRows.forEach(r => {
    const qid = r.question_id || tqMap.get(r.tq_id);
    if (!qid) return;
    const code = String(r.grading_code).trim();
    push(`h_${r.student_id}_${r.homework_id}_${qid}`, new Date(r.updated_at).getTime(), {
      student_id: r.student_id, ym: ymOf(r.updated_at), ymd: kstDate(r.updated_at), qid,
      first: code === "O", final: FINAL_OK.includes(code), code, sourceKey: `h_${r.homework_id}`, sourceKind: "hw",
    });
  });
  const recs: Rec[] = Array.from(recMap.values());

  // 문항 정보 (난이도, 단원, 사고 수준)
  step("문항 정보를 불러오는 중");
  const qids = Array.from(new Set(recs.map(r => r.qid)));
  const qRows = await selectIn("question_db", "question_id, difficulty, taxonomy_id, cognitive_level", "question_id", qids, 200);
  const qMap = new Map<string, { diff: number | null; tax: string | null; cog: string | null }>();
  qRows.forEach((q: any) => qMap.set(q.question_id, {
    diff: diffNum(q.difficulty),
    tax: q.taxonomy_id && q.taxonomy_id !== "미분류" ? q.taxonomy_id : null,
    cog: (COGNITIVE_LEVELS as readonly string[]).includes(q.cognitive_level) ? q.cognitive_level : null,
  }));

  // 단원 분류: depth8(master_item) → depth7(master_category)
  step("단원과 역량 정보를 불러오는 중");
  const taxIds = Array.from(new Set(qRows.map((q: any) => q.taxonomy_id).filter((t: any) => t && t !== "미분류")));
  const items = await selectIn("master_item", "item_id, category_id", "item_id", taxIds);
  const itemToCat = new Map<string, string>(items.map((i: any) => [i.item_id, i.category_id]));
  const catIds = Array.from(new Set(taxIds.map(t => itemToCat.get(t) || t)));
  const cats = await selectIn("master_category", "category_id, curriculum_version, depth1, depth2, depth3, depth4, depth5, depth6, depth7", "category_id", catIds);
  const catMap = new Map<string, any>(cats.map((c: any) => [c.category_id, c]));
  let compMap = new Map<string, { p: string | null; s: string | null }>();
  try {
    const comps = await selectIn("taxonomy_competency", "category_id, final_primary, ai_primary, final_secondary, ai_secondary", "category_id", catIds);
    compMap = new Map(comps.map((c: any) => [c.category_id, { p: c.final_primary || c.ai_primary || null, s: c.final_secondary || c.ai_secondary || null }]));
  } catch { /* 역량 테이블이 없으면 역량 페이지는 비어 있음 */ }
  const catOf = (qid: string) => { const t = qMap.get(qid)?.tax; if (!t) return null; return catMap.get(itemToCat.get(t) || t) || null; };

  // ---------- 집계 ----------
  const statOf = (rs: Rec[]): MonthStat & { _diffs: number } => {
    const diffs = rs.map(r => qMap.get(r.qid)?.diff).filter((d): d is number => d != null);
    const rate = pct(rs.filter(r => r.first).length, rs.length);
    return { ym: "", count: rs.length, rate, finalRate: pct(rs.filter(r => r.final).length, rs.length), diff: Math.round(avg(diffs) * 10) / 10, grade: rs.length ? gradeOf(rate) : null, _diffs: diffs.length };
  };
  const byStudentMonth = new Map<string, Rec[]>();
  recs.forEach(r => { const k = `${r.student_id}|${r.ym}`; if (!byStudentMonth.has(k)) byStudentMonth.set(k, []); byStudentMonth.get(k)!.push(r); });

  const peerStat = (m: string) => {
    const list = peerIds.map(id => byStudentMonth.get(`${id}|${m}`) || []).filter(rs => rs.length > 0).map(statOf);
    if (list.length === 0) return null;
    const rate = Math.round(avg(list.map(s => s.rate)));
    return { count: Math.round(avg(list.map(s => s.count))), rate, diff: Math.round(avg(list.filter(s => s._diffs > 0).map(s => s.diff)) * 10) / 10, grade: gradeOf(rate), students: list.length };
  };

  const mine = byStudentMonth.get(`${studentId}|${ym}`) || [];
  const meStat = { ...statOf(mine), ym };
  const peerNow = peerStat(ym) || { count: 0, rate: 0, diff: 0, grade: null, students: 0 };

  const trend = months.map(m => {
    const rs = byStudentMonth.get(`${studentId}|${m}`) || [];
    return { ym: m, me: rs.length ? { ...statOf(rs), ym: m } : null, peer: peerStat(m) };
  });

  // 주간분석
  const weekMap = new Map<number, Rec[]>();
  mine.forEach(r => { const w = weekOfMonth(r.ymd); if (!weekMap.has(w)) weekMap.set(w, []); weekMap.get(w)!.push(r); });
  const weeks = Array.from(weekMap.keys()).sort((a, b) => a - b).map(w => {
    const rs = weekMap.get(w)!;
    const byDiff = [1, 2, 3, 4, 5].map(d => {
      const x = rs.filter(r => qMap.get(r.qid)?.diff === d);
      return { n: x.length, rate: x.length ? pct(x.filter(r => r.first).length, x.length) : null };
    });
    return { label: `${ymLabel(ym)} ${w}주`, byDiff, total: rs.length, rate: rs.length ? pct(rs.filter(r => r.first).length, rs.length) : null };
  });

  // 사고 수준
  const peerMonthRecs = recs.filter(r => r.ym === ym && peerIds.includes(r.student_id));
  const rateFor = (rs: Rec[]) => rs.length ? pct(rs.filter(r => r.first).length, rs.length) : null;
  const cognitive = COGNITIVE_LEVELS.map(level => {
    const m = mine.filter(r => qMap.get(r.qid)?.cog === level);
    const p = peerMonthRecs.filter(r => qMap.get(r.qid)?.cog === level);
    return { level, n: m.length, rate: rateFor(m), peerRate: rateFor(p) };
  });

  // 역량 (주 역량 1, 보조 역량 0.5)
  const compScore = (rs: Rec[], name: string) => {
    let w = 0, c = 0;
    rs.forEach(r => {
      const cat = catOf(r.qid); if (!cat) return;
      const comp = compMap.get(cat.category_id); if (!comp) return;
      const weight = comp.p === name ? 1 : comp.s === name ? 0.5 : 0;
      if (!weight) return;
      w += weight; if (r.first) c += weight;
    });
    return { w, rate: w > 0 ? Math.round((c / w) * 100) : null };
  };
  const competency = COMPETENCIES.map(name => {
    const m = compScore(mine, name);
    const p = compScore(peerMonthRecs, name);
    return { name, n: Math.round(m.w * 10) / 10, rate: m.rate, peerRate: p.rate, enough: m.w >= MIN_COMP_ITEMS };
  });

  // 학습내역
  const sheetMap = new Map<string, Rec[]>();
  mine.forEach(r => { if (!sheetMap.has(r.sourceKey)) sheetMap.set(r.sourceKey, []); sheetMap.get(r.sourceKey)!.push(r); });
  const sheets = Array.from(sheetMap.entries()).map(([key, rs]) => {
    const isExam = key.startsWith("e_");
    const id = Number(key.slice(2));
    const meta = isExam ? asgMap.get(id) : null;
    return {
      tag: isExam ? (meta?.type || "시험") : "과제",
      title: isExam ? (meta?.title || "제목 없음") : (hwMap.get(id) || "과제"),
      date: rs.map(r => r.ymd).sort().slice(-1)[0],
      n: rs.length, rate: pct(rs.filter(r => r.first).length, rs.length),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));

  // 단원·유형
  let unclassified = 0;
  const unitMap = new Map<string, { name: string; curriculum: string; recs: Rec[]; types: Map<string, Rec[]> }>();
  mine.forEach(r => {
    const c = catOf(r.qid);
    if (!c) { unclassified++; return; }
    const unitName = c.depth4 || c.depth3 || c.depth2 || "기타";
    const key = `${c.depth1}|${c.depth2}|${unitName}`;
    if (!unitMap.has(key)) unitMap.set(key, { name: unitName, curriculum: c.curriculum_version ? `${String(c.curriculum_version).slice(2)}개정` : "", recs: [], types: new Map() });
    const u = unitMap.get(key)!;
    u.recs.push(r);
    const tName = c.depth7 || c.depth6 || c.depth5 || "기타 유형";
    if (!u.types.has(tName)) u.types.set(tName, []);
    u.types.get(tName)!.push(r);
  });
  const units = Array.from(unitMap.entries()).map(([key, u]) => {
    const types = Array.from(u.types.entries()).map(([name, rs]) => ({ name, n: rs.length, rate: pct(rs.filter(r => r.first).length, rs.length), mark: null as "우수" | "취약" | null }));
    const judged = types.filter(t => t.n >= MIN_TYPE_ITEMS);
    const best = judged.filter(t => t.rate >= 80).sort((a, b) => b.rate - a.rate || b.n - a.n).slice(0, 3);
    const weak = judged.filter(t => t.rate < 50).sort((a, b) => a.rate - b.rate || b.n - a.n).slice(0, 3);
    types.forEach(t => { if (best.includes(t)) t.mark = "우수"; else if (weak.includes(t)) t.mark = "취약"; });
    return { key, name: u.name, curriculum: u.curriculum, n: u.recs.length, rate: pct(u.recs.filter(r => r.first).length, u.recs.length), types, best: best.map(t => t.name), weak: weak.map(t => t.name) };
  }).sort((a, b) => b.n - a.n);

  // 학습 태도: 출결, 과제 완료율
  step("출결과 과제 기록을 불러오는 중");
  const mStart = `${ym}-01`, mEnd = `${ym}-${String(lastDay(ym)).padStart(2, "0")}`;
  const { data: att } = await supabase.from("attendance").select("status, attendance_date").eq("student_id", studentId).gte("attendance_date", mStart).lte("attendance_date", mEnd);
  const attendance = { present: 0, late: 0, early: 0, absent: 0 };
  (att || []).forEach((a: any) => { if (a.status === "결석") attendance.absent++; else if (a.status === "지각") attendance.late++; else if (a.status === "조퇴") attendance.early++; else attendance.present++; });

  const { data: hwRes } = await supabase.from("student_homework_result")
    .select("status, homework_assignment!inner(homework_title, due_date)")
    .eq("student_id", studentId)
    .gte("homework_assignment.due_date", monthStartUtcIso(ym))
    .lt("homework_assignment.due_date", monthStartUtcIso(shiftYm(ym, 1)));
  const hwList = (hwRes || []).filter((r: any) => unwrap(r.homework_assignment)?.homework_title !== "[시스템] 수업 진도 완료 기록");
  const hwDone = hwList.filter((r: any) => ["제출완료", "채점완료", "완료"].includes(r.status)).length;

  const selfFixed = mine.filter(r => r.code === "RO").length;
  const hinted = mine.filter(r => r.code === "TO" || r.code === "TX").length;

  return {
    student: { student_id: stu.student_id, name: stu.name, grade: stu.grade, school: stu.school, classNames },
    ym,
    period: `${ym.replace("-", ".")}.01 - ${ym.replace("-", ".")}.${String(lastDay(ym)).padStart(2, "0")}`,
    hasData: mine.length > 0,
    me: meStat,
    peer: peerNow,
    trend,
    attitude: {
      firstRate: meStat.rate, finalRate: meStat.finalRate, selfFixed, hinted, hintRate: pct(hinted, mine.length),
      wrongLeft: mine.filter(r => !r.final).length,
      attendance,
      homework: { total: hwList.length, done: hwDone, rate: pct(hwDone, hwList.length) },
    },
    weeks, cognitive, competency, sheets, units, unclassified,
  };
}
