// src/lib/classReport.ts
// 반 전체 월간 성취도 리포트 데이터 (학생 개인 월간 리포트의 반 종합판)
// - 대상: 그 반에 수강 중인 재원생 (이름에 '테스트'·'선생님'이 들어간 더미 학생 제외)
// - 학생 기록은 개인 리포트와 같은 규칙: 채점된 시험·과제 문항, 입학테스트·진단평가 제외, 문항별 마지막 기록
// - 비교 대상: 반 이름 앞 두 글자(수준·학년, 예: T32MW1 → "T3")가 같은 다른 진행 중인 반의 학생 평균. 없으면 비교 없이 출력
import { supabase } from "@/lib/supabase";
import {
  COMPETENCIES, COGNITIVE_LEVELS, FINAL_OK, EXCLUDED_EXAM_TYPES, MIN_COMP_ITEMS, PRE_TEST_STATUS,
  kstDate, ymOf, shiftYm, ymLabel, lastDay, monthStartUtcIso, weekOfMonth, unwrap,
  selectIn, selectInPaged, diffNum, gradeOf, pct, avg,
} from "@/lib/monthlyReport";

const isDummy = (name: any) => /테스트|선생님/.test(String(name || "").replace(/\s/g, ""));
const MIN_UNIT_STUDENT_ITEMS = 3; // 단원에서 학생별 판정에 필요한 최소 문항 수

type Rec = {
  student_id: string; ym: string; ymd: string; qid: string;
  first: boolean; final: boolean; code: string; sourceKind: "exam" | "hw";
};

export type ClassStudentRow = {
  student_id: string; name: string; grade: string; school: string | null;
  count: number; rate: number | null; finalRate: number | null; level: number | null; diff: number | null;
  selfFixed: number; hinted: number;
  weeklyAvg: number | null; weeklyTaken: number;
  hwTotal: number; hwDone: number; hwRate: number | null;
  att: { present: number; late: number; early: number; absent: number };
  flags: string[]; // 주의 사유
  star: boolean;   // 우수
};
export type ClassMonthStat = { ym: string; rate: number | null; finalRate: number | null; count: number | null; diff: number | null; students: number };
export type ClassReport = {
  cls: { class_id: string; name: string; instructor: string; grades: string[]; level: string | null };
  compare: { prefix: string; classes: string[]; students: number }; // 비교 반 (없으면 classes 빈 배열)
  ym: string; period: string; hasData: boolean;
  me: ClassMonthStat; peer: ClassMonthStat;
  trend: { ym: string; me: ClassMonthStat | null; peer: ClassMonthStat | null }[];
  students: ClassStudentRow[];
  levelDist: number[]; // 1~5등급 인원
  totals: { attendanceRate: number | null; hwRate: number | null; weeklyAvg: number | null; weeklyFinalAvg: number | null };
  weekly: {
    tests: { key: string; title: string; date: string; totalQ: number; taken: number; enrolled: number; avgFirst: number; avgFinal: number; max: number; min: number }[];
    matrix: Record<string, Record<string, { first: number; final: number }>>; // student_id → test key → 점수
  };
  weeks: { label: string; total: number; rate: number | null; perStudent: number }[];
  cognitive: { level: string; n: number; rate: number | null; peerRate: number | null }[];
  competency: { name: string; n: number; rate: number | null; peerRate: number | null; enough: boolean }[];
  units: { key: string; name: string; curriculum: string; n: number; students: number; rate: number; low: string[]; weakTypes: { name: string; rate: number; n: number }[] }[];
  unclassified: number;
};

export async function buildClassReport(classId: string, ym: string, onStep?: (t: string) => void): Promise<ClassReport> {
  const step = (t: string) => onStep?.(t);

  step("반 정보를 불러오는 중");
  const { data: cls, error: cErr } = await supabase.from("class").select("class_id, name, level_name, tenant_id, instructor(name)").eq("class_id", classId).single();
  if (cErr || !cls) throw new Error("반 정보를 찾을 수 없습니다.");

  const { data: enr } = await supabase.from("enrollment")
    .select("student_id, status, student(student_id, name, grade, school, status)")
    .eq("class_id", classId).eq("status", "수강중");
  const roster = (enr || []).map((e: any) => unwrap(e.student)).filter((s: any) => s && s.status === "재원" && !isDummy(s.name));
  const rosterMap = new Map<string, any>(roster.map((s: any) => [s.student_id, s]));
  const ids = Array.from(rosterMap.keys());
  if (ids.length === 0) throw new Error("이 반에 수강 중인 재원생이 없습니다.");
  const grades = Array.from(new Set(roster.map((s: any) => s.grade).filter(Boolean))) as string[];

  // 비교 대상: 반 이름 앞 두 글자(수준·학년)가 같은 다른 진행 중인 반의 수강생 (이 반 학생은 제외)
  const prefix = String(cls.name || "").trim().slice(0, 2);
  let compareClasses: string[] = [];
  let peerIds: string[] = [];
  if (prefix.length === 2) {
    const { data: sameCls } = await supabase.from("class").select("class_id, name, status, deleted_at")
      .eq("tenant_id", cls.tenant_id).ilike("name", `${prefix}%`).neq("class_id", classId).eq("status", "진행중").is("deleted_at", null);
    const others = (sameCls || []).filter((c: any) => String(c.name || "").trim().slice(0, 2) === prefix);
    if (others.length) {
      const { data: oEnr } = await supabase.from("enrollment")
        .select("class_id, student(student_id, name, status)")
        .in("class_id", others.map((c: any) => c.class_id)).eq("status", "수강중");
      const okStu = (oEnr || []).map((e: any) => ({ cid: e.class_id, s: unwrap(e.student) }))
        .filter((x: any) => x.s && x.s.status === "재원" && !isDummy(x.s.name) && !rosterMap.has(x.s.student_id));
      peerIds = Array.from(new Set(okStu.map((x: any) => x.s.student_id)));
      const withStu = new Set(okStu.map((x: any) => x.cid));
      compareClasses = others.filter((c: any) => withStu.has(c.class_id)).map((c: any) => c.name).sort();
    }
  }
  const allIds = Array.from(new Set([...ids, ...peerIds]));

  const months = [shiftYm(ym, -2), shiftYm(ym, -1), ym];
  const fromIso = monthStartUtcIso(months[0]);
  const toIso = monthStartUtcIso(shiftYm(ym, 1));

  step("채점된 답안을 모으는 중");
  const exRows = await selectInPaged("student_answer", "student_id, exam_assignment_id, question_id, attempt_number, grading_code, updated_at", "student_id", allIds,
    q => q.not("grading_code", "is", null).gte("updated_at", fromIso).lt("updated_at", toIso).order("answer_id"));
  const hwRows = await selectInPaged("student_homework_answer", "student_id, homework_id, tq_id, question_id, grading_code, updated_at", "student_id", allIds,
    q => q.not("grading_code", "is", null).gte("updated_at", fromIso).lt("updated_at", toIso).order("hw_answer_id"));

  step("학습지 정보를 확인하는 중");
  const asgs = await selectIn("exam_assignment", "assignment_id, admission_session_id, exam_master(exam_type)", "assignment_id", exRows.map(r => r.exam_assignment_id));
  const excludedAsg = new Set<number>();
  asgs.forEach((a: any) => { const t = unwrap(a.exam_master)?.exam_type || ""; if (a.admission_session_id || EXCLUDED_EXAM_TYPES.includes(t)) excludedAsg.add(a.assignment_id); });
  const needTq = hwRows.filter(r => !r.question_id && r.tq_id).map(r => r.tq_id);
  const tqMap = new Map<number, string>();
  if (needTq.length) (await selectIn("textbook_question", "tq_id, question_id", "tq_id", needTq)).forEach((t: any) => tqMap.set(t.tq_id, t.question_id));

  const recMap = new Map<string, Rec & { _rank: number }>();
  const push = (key: string, rank: number, r: Rec) => { const p = recMap.get(key); if (!p || rank >= p._rank) recMap.set(key, { ...r, _rank: rank }); };
  exRows.forEach(r => {
    if (excludedAsg.has(r.exam_assignment_id)) return;
    const code = String(r.grading_code).trim();
    push(`e_${r.student_id}_${r.exam_assignment_id}_${r.question_id}`, (r.attempt_number || 1) * 1e13 + new Date(r.updated_at).getTime(),
      { student_id: r.student_id, ym: ymOf(r.updated_at), ymd: kstDate(r.updated_at), qid: r.question_id, first: code === "O", final: FINAL_OK.includes(code), code, sourceKind: "exam" });
  });
  hwRows.forEach(r => {
    const qid = r.question_id || tqMap.get(r.tq_id); if (!qid) return;
    const code = String(r.grading_code).trim();
    push(`h_${r.student_id}_${r.homework_id}_${qid}`, new Date(r.updated_at).getTime(),
      { student_id: r.student_id, ym: ymOf(r.updated_at), ymd: kstDate(r.updated_at), qid, first: code === "O", final: FINAL_OK.includes(code), code, sourceKind: "hw" });
  });
  const recs: Rec[] = Array.from(recMap.values());

  step("문항 정보를 불러오는 중");
  const qRows = await selectIn("question_db", "question_id, difficulty, taxonomy_id, cognitive_level", "question_id", Array.from(new Set(recs.map(r => r.qid))), 200);
  const qMap = new Map<string, { diff: number | null; tax: string | null; cog: string | null }>();
  qRows.forEach((q: any) => qMap.set(q.question_id, {
    diff: diffNum(q.difficulty),
    tax: q.taxonomy_id && q.taxonomy_id !== "미분류" ? q.taxonomy_id : null,
    cog: (COGNITIVE_LEVELS as readonly string[]).includes(q.cognitive_level) ? q.cognitive_level : null,
  }));

  step("단원과 역량 정보를 불러오는 중");
  const taxIds = Array.from(new Set(qRows.map((q: any) => q.taxonomy_id).filter((t: any) => t && t !== "미분류"))) as string[];
  const items = await selectIn("master_item", "item_id, category_id", "item_id", taxIds);
  const itemToCat = new Map<string, string>(items.map((i: any) => [i.item_id, i.category_id]));
  const catIds = Array.from(new Set(taxIds.map(t => itemToCat.get(t) || t)));
  const cats = await selectIn("master_category", "category_id, curriculum_version, depth1, depth2, depth3, depth4, depth5, depth6, depth7", "category_id", catIds);
  const catMap = new Map<string, any>(cats.map((c: any) => [c.category_id, c]));
  let compMap = new Map<string, { p: string | null; s: string | null }>();
  try {
    const comps = await selectIn("taxonomy_competency", "category_id, final_primary, ai_primary, final_secondary, ai_secondary", "category_id", catIds);
    compMap = new Map(comps.map((c: any) => [c.category_id, { p: c.final_primary || c.ai_primary || null, s: c.final_secondary || c.ai_secondary || null }]));
  } catch { /* 역량 테이블이 없으면 비워 둠 */ }
  const catOf = (qid: string) => { const t = qMap.get(qid)?.tax; if (!t) return null; return catMap.get(itemToCat.get(t) || t) || null; };

  // ---------- 집계 ----------
  const byStuMonth = new Map<string, Rec[]>();
  recs.forEach(r => { const k = `${r.student_id}|${r.ym}`; if (!byStuMonth.has(k)) byStuMonth.set(k, []); byStuMonth.get(k)!.push(r); });
  const stuStat = (rs: Rec[]) => {
    const diffs = rs.map(r => qMap.get(r.qid)?.diff).filter((d): d is number => d != null);
    return { count: rs.length, rate: pct(rs.filter(r => r.first).length, rs.length), finalRate: pct(rs.filter(r => r.final).length, rs.length), diff: diffs.length ? avg(diffs) : null };
  };
  // 집단 평균 = 학생별 값의 평균 (기록이 있는 학생만)
  const groupStat = (who: string[], m: string): ClassMonthStat | null => {
    const list = who.map(id => byStuMonth.get(`${id}|${m}`) || []).filter(rs => rs.length > 0).map(stuStat);
    if (list.length === 0) return null;
    const diffs = list.map(s => s.diff).filter((d): d is number => d != null);
    return { ym: m, rate: Math.round(avg(list.map(s => s.rate))), finalRate: Math.round(avg(list.map(s => s.finalRate))), count: Math.round(avg(list.map(s => s.count))), diff: diffs.length ? Math.round(avg(diffs) * 10) / 10 : null, students: list.length };
  };
  const emptyStat = (m: string): ClassMonthStat => ({ ym: m, rate: null, finalRate: null, count: null, diff: null, students: 0 });
  const me = groupStat(ids, ym) || emptyStat(ym);
  const peer = groupStat(peerIds, ym) || emptyStat(ym);
  const trend = months.map(m => ({ ym: m, me: groupStat(ids, m), peer: groupStat(peerIds, m) }));

  const mineAll = recs.filter(r => r.ym === ym && rosterMap.has(r.student_id));
  const peerSet = new Set(peerIds);
  const peerMonth = recs.filter(r => r.ym === ym && peerSet.has(r.student_id));

  // ---------- 출결 · 과제 ----------
  step("출결과 과제 기록을 불러오는 중");
  const mStart = `${ym}-01`, mEnd = `${ym}-${String(lastDay(ym)).padStart(2, "0")}`;
  const attRows = await selectInPaged("attendance", "student_id, status, attendance_date", "student_id", ids, q => q.gte("attendance_date", mStart).lte("attendance_date", mEnd).order("attendance_id"));
  const { data: hwRes } = await supabase.from("student_homework_result")
    .select("student_id, status, homework_assignment!inner(homework_title, due_date, class_id)")
    .eq("homework_assignment.class_id", classId)
    .gte("homework_assignment.due_date", monthStartUtcIso(ym))
    .lt("homework_assignment.due_date", monthStartUtcIso(shiftYm(ym, 1)))
    .limit(10000);
  const hwList = (hwRes || []).filter((r: any) => rosterMap.has(r.student_id) && unwrap(r.homework_assignment)?.homework_title !== "[시스템] 수업 진도 완료 기록");
  const HW_DONE = ["제출완료", "채점완료", "완료"];

  // ---------- 주간테스트 ----------
  step("주간테스트 성적을 불러오는 중");
  const weekly = await loadClassWeekly(ids, ym);

  // ---------- 학생별 ----------
  const students: ClassStudentRow[] = roster.map((s: any) => {
    const rs = byStuMonth.get(`${s.student_id}|${ym}`) || [];
    const st = rs.length ? stuStat(rs) : null;
    const att = { present: 0, late: 0, early: 0, absent: 0 };
    attRows.filter((a: any) => a.student_id === s.student_id).forEach((a: any) => {
      if (a.status === "결석") att.absent++; else if (a.status === "지각") att.late++; else if (a.status === "조퇴") att.early++; else att.present++;
    });
    const hw = hwList.filter((h: any) => h.student_id === s.student_id);
    const hwDone = hw.filter((h: any) => HW_DONE.includes(h.status)).length;
    const wk = Object.values(weekly.matrix[s.student_id] || {});
    const weeklyAvg = wk.length ? Math.round(avg(wk.map(w => w.first))) : null;
    const row: ClassStudentRow = {
      student_id: s.student_id, name: s.name, grade: s.grade, school: s.school,
      count: rs.length, rate: st ? st.rate : null, finalRate: st ? st.finalRate : null, level: st ? gradeOf(st.rate) : null,
      diff: st?.diff != null ? Math.round(st.diff * 10) / 10 : null,
      selfFixed: rs.filter(r => r.code === "RO").length, hinted: rs.filter(r => r.code === "TO" || r.code === "TX").length,
      weeklyAvg, weeklyTaken: wk.length,
      hwTotal: hw.length, hwDone, hwRate: hw.length ? pct(hwDone, hw.length) : null,
      att, flags: [], star: false,
    };
    if (row.count === 0) row.flags.push("채점 기록 없음");
    else if ((row.rate ?? 0) < 50) row.flags.push("정답률 50% 미만");
    if (row.hwRate != null && row.hwRate < 70) row.flags.push("과제 완료 70% 미만");
    if (att.absent >= 2) row.flags.push(`결석 ${att.absent}회`);
    if (row.weeklyAvg != null && weekly.tests.length && row.weeklyTaken < weekly.tests.length) row.flags.push(`주간테스트 ${weekly.tests.length - row.weeklyTaken}회 미응시`);
    row.star = row.count >= 20 && (row.rate ?? 0) >= 85 && (row.hwRate == null || row.hwRate >= 90);
    return row;
  }).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.name.localeCompare(b.name));

  const levelDist = [1, 2, 3, 4, 5].map(l => students.filter(s => s.level === l).length);
  const attTotal = students.reduce((s, r) => s + r.att.present + r.att.late + r.att.early + r.att.absent, 0);
  const attOk = students.reduce((s, r) => s + r.att.present + r.att.late + r.att.early, 0);
  const hwT = students.reduce((s, r) => s + r.hwTotal, 0), hwD = students.reduce((s, r) => s + r.hwDone, 0);
  const totals = {
    attendanceRate: attTotal ? pct(attOk, attTotal) : null,
    hwRate: hwT ? pct(hwD, hwT) : null,
    weeklyAvg: weekly.tests.length ? Math.round(avg(weekly.tests.map(t => t.avgFirst))) : null,
    weeklyFinalAvg: weekly.tests.length ? Math.round(avg(weekly.tests.map(t => t.avgFinal))) : null,
  };

  // ---------- 주차별 ----------
  const weekMap = new Map<number, Rec[]>();
  mineAll.forEach(r => { const w = weekOfMonth(r.ymd); if (!weekMap.has(w)) weekMap.set(w, []); weekMap.get(w)!.push(r); });
  const weeks = Array.from(weekMap.keys()).sort((a, b) => a - b).map(w => {
    const rs = weekMap.get(w)!;
    return { label: `${ymLabel(ym)} ${w}주`, total: rs.length, rate: rs.length ? pct(rs.filter(r => r.first).length, rs.length) : null, perStudent: Math.round(rs.length / ids.length) };
  });

  // ---------- 사고 수준 · 역량 ----------
  // 학생 한 명 한 명의 정답률을 낸 뒤 평균 (문항이 많은 학생에게 쏠리지 않도록)
  const meanOfStudents = (rs: Rec[], who: string[], filt: (r: Rec) => number) => {
    const per: number[] = [];
    let total = 0;
    who.forEach(id => {
      let w = 0, c = 0;
      rs.forEach(r => { if (r.student_id !== id) return; const x = filt(r); if (!x) return; w += x; if (r.first) c += x; });
      total += w;
      if (w > 0) per.push((c / w) * 100);
    });
    return { n: Math.round(total * 10) / 10, rate: per.length ? Math.round(avg(per)) : null };
  };
  const cognitive = COGNITIVE_LEVELS.map(level => {
    const f = (r: Rec) => (qMap.get(r.qid)?.cog === level ? 1 : 0);
    const m = meanOfStudents(mineAll, ids, f), p = meanOfStudents(peerMonth, peerIds, f);
    return { level, n: m.n, rate: m.rate, peerRate: p.rate };
  });
  const compWeight = (name: string) => (r: Rec) => {
    const c = catOf(r.qid); if (!c) return 0;
    const comp = compMap.get(c.category_id); if (!comp) return 0;
    return comp.p === name ? 1 : comp.s === name ? 0.5 : 0;
  };
  const competency = COMPETENCIES.map(name => {
    const m = meanOfStudents(mineAll, ids, compWeight(name)), p = meanOfStudents(peerMonth, peerIds, compWeight(name));
    return { name, n: m.n, rate: m.rate, peerRate: p.rate, enough: m.n >= MIN_COMP_ITEMS * 2 };
  });

  // ---------- 단원 ----------
  let unclassified = 0;
  const unitMap = new Map<string, { name: string; curriculum: string; recs: Rec[]; types: Map<string, Rec[]> }>();
  mineAll.forEach(r => {
    const c = catOf(r.qid); if (!c) { unclassified++; return; }
    const unitName = c.depth4 || c.depth3 || c.depth2 || "기타";
    const key = `${c.depth1}|${c.depth2}|${unitName}`;
    if (!unitMap.has(key)) unitMap.set(key, { name: unitName, curriculum: c.curriculum_version ? `${String(c.curriculum_version).slice(2)}개정` : "", recs: [], types: new Map() });
    const u = unitMap.get(key)!; u.recs.push(r);
    const t = c.depth7 || c.depth6 || c.depth5 || "기타 유형";
    if (!u.types.has(t)) u.types.set(t, []); u.types.get(t)!.push(r);
  });
  const units = Array.from(unitMap.entries()).map(([key, u]) => {
    const stuIds = Array.from(new Set(u.recs.map(r => r.student_id)));
    const low = stuIds.filter(id => {
      const rs = u.recs.filter(r => r.student_id === id);
      return rs.length >= MIN_UNIT_STUDENT_ITEMS && pct(rs.filter(r => r.first).length, rs.length) < 50;
    }).map(id => rosterMap.get(id)?.name || "");
    const weakTypes = Array.from(u.types.entries())
      .map(([name, rs]) => ({ name, n: rs.length, rate: pct(rs.filter(r => r.first).length, rs.length) }))
      .filter(t => t.n >= 3 && t.rate < 60).sort((a, b) => a.rate - b.rate).slice(0, 3);
    return { key, name: u.name, curriculum: u.curriculum, n: u.recs.length, students: stuIds.length, rate: pct(u.recs.filter(r => r.first).length, u.recs.length), low, weakTypes };
  }).sort((a, b) => b.n - a.n);

  const instructor = unwrap((cls as any).instructor)?.name || "";
  return {
    cls: { class_id: cls.class_id, name: cls.name, instructor, grades, level: (cls as any).level_name || null },
    ym, period: `${ym.replace("-", ".")}.01 - ${ym.replace("-", ".")}.${String(lastDay(ym)).padStart(2, "0")}`,
    hasData: mineAll.length > 0 || weekly.tests.length > 0,
    compare: { prefix, classes: compareClasses, students: peerIds.length },
    me, peer, trend, students, levelDist, totals, weekly, weeks, cognitive, competency, units, unclassified,
  };
}

// 반 학생들의 그 달 주간테스트: 시험지별 반 평균·최고·최저와 학생별 점수표
async function loadClassWeekly(ids: string[], ym: string): Promise<ClassReport["weekly"]> {
  const empty = { tests: [], matrix: {} };
  const asg = await selectInPaged("exam_assignment", "assignment_id, exam_id, student_id, status, created_at, exam_master!inner(title, total_questions, exam_type, exam_date)", "student_id", ids,
    q => q.eq("exam_master.exam_type", "주간테스트").gte("created_at", monthStartUtcIso(shiftYm(ym, -1))).lt("created_at", monthStartUtcIso(shiftYm(ym, 2))).order("assignment_id"));
  const list = asg.filter((a: any) => !PRE_TEST_STATUS.includes(a.status)).map((a: any) => {
    const em = unwrap(a.exam_master) || {};
    const day = em.exam_date || kstDate(a.created_at);
    return { ...a, em, day };
  }).filter((a: any) => String(a.day).slice(0, 7) === ym);
  if (list.length === 0) return empty;

  const answers = await selectInPaged("student_answer", "exam_assignment_id, question_id, attempt_number, grading_code, updated_at", "exam_assignment_id", list.map((a: any) => a.assignment_id), q => q.order("answer_id"));
  const last = new Map<string, any>();
  answers.forEach((a: any) => {
    if (a.grading_code == null) return;
    const k = `${a.exam_assignment_id}_${a.question_id}`;
    const rank = (a.attempt_number || 1) * 1e13 + new Date(a.updated_at).getTime();
    const p = last.get(k); if (!p || rank >= p._rank) last.set(k, { ...a, _rank: rank });
  });
  const byAsg = new Map<number, any[]>();
  last.forEach(a => { if (!byAsg.has(a.exam_assignment_id)) byAsg.set(a.exam_assignment_id, []); byAsg.get(a.exam_assignment_id)!.push(a); });

  const matrix: ClassReport["weekly"]["matrix"] = {};
  const perTest = new Map<string, { title: string; date: string; totalQ: number; scores: { first: number; final: number }[]; enrolled: number }>();
  list.forEach((a: any) => {
    const key = String(a.exam_id);
    if (!perTest.has(key)) perTest.set(key, { title: a.em.title || "주간테스트", date: String(a.day), totalQ: a.em.total_questions || 0, scores: [], enrolled: 0 });
    const t = perTest.get(key)!; t.enrolled++;
    const rows = byAsg.get(a.assignment_id) || [];
    if (rows.length === 0) return; // 채점 전
    const total = t.totalQ || rows.length || 1;
    const o = rows.filter(r => String(r.grading_code).trim() === "O").length;
    const f = rows.filter(r => FINAL_OK.includes(String(r.grading_code).trim())).length;
    const sc = { first: Math.round((o / total) * 100), final: Math.round((f / total) * 100) };
    t.scores.push(sc);
    (matrix[a.student_id] ||= {})[key] = sc;
  });
  const tests = Array.from(perTest.entries()).filter(([, t]) => t.scores.length > 0).map(([key, t]) => ({
    key, title: t.title, date: t.date, totalQ: t.totalQ, taken: t.scores.length, enrolled: t.enrolled,
    avgFirst: Math.round(avg(t.scores.map(s => s.first))), avgFinal: Math.round(avg(t.scores.map(s => s.final))),
    max: Math.max(...t.scores.map(s => s.first)), min: Math.min(...t.scores.map(s => s.first)),
  })).sort((a, b) => a.date.localeCompare(b.date));
  return { tests, matrix };
}
