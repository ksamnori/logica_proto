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

// 대문항(그룹) 기준 균등 배점 + 서브문항((1),(2) 등) 분할 배점 및 TO/RO 부분점수(score_ratio) 계산 유틸리티

/**
 * 소수점 첫째 자리까지 반올림 (예: 97.5 -> 97.5, 100.0 -> 100)
 */
function roundScore(val: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 10) / 10;
}

/**
 * 채점 기호(O, TO, RO, X, TX 등)와 문항 배점(assignedScore), 마스터 채점 기준(metaMap)을 바탕으로
 * 획득 점수(newEarned), 정답 여부(isCorrectEq), 적용 비율(ratio)을 계산합니다.
 */
function calcScoreRatio(
  code: string | null | undefined,
  assignedScore: number,
  metaMap?: Record<string, any>,
  isAdmission: boolean = false
): { newEarned: number; isCorrectEq: boolean; ratio: number } {
  if (!code) return { newEarned: 0, isCorrectEq: false, ratio: 0 };
  const c = String(code).trim();
  if (!c) return { newEarned: 0, isCorrectEq: false, ratio: 0 };

  const meta = metaMap?.[c];
  let ratio = 0;
  let isCorrectEq = false;

  if (meta) {
    const rawRatio =
      isAdmission && meta.admission_ratio !== undefined && meta.admission_ratio !== null
        ? meta.admission_ratio
        : meta.score_ratio;
    ratio = parseFloat(rawRatio);
    if (isNaN(ratio)) ratio = 0;
    if (ratio > 1) ratio = ratio / 100;

    if (isAdmission) {
      isCorrectEq = ratio > 0;
    } else {
      isCorrectEq =
        meta.is_correct === true ||
        String(meta.is_correct).toLowerCase() === "true" ||
        ["O", "TO", "RO", "a", "b", "c"].includes(c);
    }
  } else {
    if (["O", "a", "b", "c"].includes(c)) {
      ratio = 1.0;
      isCorrectEq = true;
    } else if (c === "TO" || c === "RO") {
      ratio = isAdmission && c === "TO" ? 1.0 : 0.8;
      isCorrectEq = isAdmission ? ratio > 0 : true;
    } else if (c === "q") {
      ratio = isAdmission ? 0.0 : 0.5;
      isCorrectEq = false;
    } else {
      ratio = 0.0;
      isCorrectEq = false;
    }
  }

  const base = Number(assignedScore) || 0;
  const newEarned = Math.round((base * ratio + Number.EPSILON) * 1000) / 1000;
  return { newEarned, isCorrectEq, ratio };
}

/**
 * layout_settings에서 userMergedTextQuestions 배열을 안전하게 추출합니다.
 */
function extractMergedQuestionGroups(layoutSettings: any): string[][] {
  if (!layoutSettings) return [];
  let s = layoutSettings;
  if (typeof s === "string") {
    try {
      s = JSON.parse(s);
    } catch {
      return [];
    }
  }
  if (Array.isArray(s?.userMergedTextQuestions)) {
    return s.userMergedTextQuestions
      .filter((arr: any) => Array.isArray(arr) && arr.length > 0)
      .map((arr: any[]) => arr.map((id: any) => String(id)));
  }
  return [];
}

/**
 * 시험 문항 목록(items)과 layout_settings(userMergedTextQuestions)를 기반으로
 * 대문항(그룹)당 배점을 먼저 구한 뒤(예: 20대문항이면 대문항당 5점),
 * 그룹 내 서브문항 개수로 나눈 세부 배점(예: 서브문항 2개면 각 2.5점) 맵을 반환합니다.
 */
function buildExamQuestionScoreMap(
  items: { question_id: any; sort_order?: number; assigned_score?: any }[],
  layoutSettings?: any,
  examType?: string,
  totalQuestionsFallback?: number
): {
  scoreByQuestionId: Map<string, number>;
  groupCount: number;
  groups: { id: string; is_merged_text: boolean; items: any[]; groupScore: number; subScore: number }[];
} {
  const mergedArrays = extractMergedQuestionGroups(layoutSettings);
  const customGroupMap = new Map<string, string>();
  const customGroupSizeMap = new Map<string, number>();

  mergedArrays.forEach((arr, idx) => {
    const gId = `custom_group_${idx}`;
    customGroupSizeMap.set(gId, arr.length);
    arr.forEach((qid) => customGroupMap.set(String(qid), gId));
  });

  const scoreByQuestionId = new Map<string, number>();

  if (!items || items.length === 0) {
    const flatCount = totalQuestionsFallback || 1;
    const extraSubItems = mergedArrays.reduce(
      (acc, arr) => acc + Math.max(0, arr.length - 1),
      0
    );
    const groupCount = Math.max(1, flatCount - extraSubItems);
    const baseGroupScore = 100 / groupCount;

    mergedArrays.forEach((arr) => {
      const subScore = baseGroupScore / (arr.length || 1);
      arr.forEach((qid) => scoreByQuestionId.set(String(qid), subScore));
    });

    return { scoreByQuestionId, groupCount, groups: [] };
  }

  const sortedItems = [...items].sort(
    (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
  );

  const groupMap = new Map<
    string,
    { id: string; is_merged_text: boolean; items: any[]; groupScore: number; subScore: number }
  >();
  const groups: {
    id: string;
    is_merged_text: boolean;
    items: any[];
    groupScore: number;
    subScore: number;
  }[] = [];

  sortedItems.forEach((item, idx) => {
    const qidStr = String(item.question_id);
    const customGId = customGroupMap.get(qidStr);
    const gId = customGId || `single_${qidStr}_${idx}`;

    if (!groupMap.has(gId)) {
      const newG = {
        id: gId,
        is_merged_text: !!customGId,
        items: [] as any[],
        groupScore: 0,
        subScore: 0,
      };
      groupMap.set(gId, newG);
      groups.push(newG);
    }
    groupMap.get(gId)!.items.push(item);
  });

  const groupCount = groups.length || 1;
  const baseGroupScore = 100 / groupCount;
  const isAdmissionExam = Boolean(
    examType && (examType.includes("입학테스트") || examType.includes("진단평가"))
  );

  groups.forEach((g) => {
    const explicitMax = Math.max(
      ...g.items.map((i: any) => parseFloat(i.assigned_score) || 0)
    );
    const groupMaxScore =
      isAdmissionExam && explicitMax > 0 ? explicitMax : baseGroupScore;
    const subScore = groupMaxScore / (g.items.length || 1);

    g.groupScore = groupMaxScore;
    g.subScore = subScore;

    g.items.forEach((item: any) => {
      scoreByQuestionId.set(String(item.question_id), subScore);
    });
  });

  return { scoreByQuestionId, groupCount, groups };
}


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
    .select("student_id, status, end_date, student(student_id, name, grade, school, status)")
    .eq("class_id", classId).eq("status", "수강중");
  const roster = (enr || []).filter((e: any) => !e.end_date && e.status !== "수강종료").map((e: any) => unwrap(e.student)).filter((s: any) => s && s.status === "재원" && !isDummy(s.name));
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
        .select("class_id, status, end_date, student(student_id, name, status)")
        .in("class_id", others.map((c: any) => c.class_id)).eq("status", "수강중");
      const okStu = (oEnr || []).filter((e: any) => !e.end_date && e.status !== "수강종료").map((e: any) => ({ cid: e.class_id, s: unwrap(e.student) }))
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
  const asg = await selectInPaged("exam_assignment", "assignment_id, exam_id, student_id, status, created_at, exam_master!inner(title, total_questions, exam_type, exam_date, layout_settings)", "student_id", ids,
    q => q.eq("exam_master.exam_type", "주간테스트").gte("created_at", monthStartUtcIso(shiftYm(ym, -1))).lt("created_at", monthStartUtcIso(shiftYm(ym, 2))).order("assignment_id"));
  const list = asg.filter((a: any) => !PRE_TEST_STATUS.includes(a.status)).map((a: any) => {
    const em = unwrap(a.exam_master) || {};
    const day = em.exam_date || kstDate(a.created_at);
    return { ...a, em, day };
  }).filter((a: any) => String(a.day).slice(0, 7) === ym);
  if (list.length === 0) return empty;

  const examIds: string[] = Array.from(new Set<string>(list.map((a: any) => String(a.exam_id))));
  const [answers, examItemsRaw, gcRes] = await Promise.all([
    selectInPaged("student_answer", "exam_assignment_id, question_id, attempt_number, grading_code, updated_at", "exam_assignment_id", list.map((a: any) => a.assignment_id), q => q.order("answer_id")),
    selectInPaged("exam_item", "exam_id, question_id, sort_order, assigned_score", "exam_id", examIds, q => q.order("sort_order")),
    supabase.from("master_grading_code").select("code, description, is_correct, score_ratio, admission_ratio")
  ]);

  const gcMeta: Record<string, any> = {};
  gcRes.data?.forEach((row: any) => { if (row.code) gcMeta[row.code] = row; });

  const itemsByExam = new Map<string, any[]>();
  examItemsRaw.forEach((it: any) => {
    const k = String(it.exam_id);
    if (!itemsByExam.has(k)) itemsByExam.set(k, []);
    itemsByExam.get(k)!.push(it);
  });

  const examScoreCfg = new Map<string, { scoreByQuestionId: Map<string, number>; defaultScore: number }>();
  list.forEach((a: any) => {
    const eid = String(a.exam_id);
    if (!examScoreCfg.has(eid)) {
      const items = itemsByExam.get(eid) || [];
      const { scoreByQuestionId, groupCount } = buildExamQuestionScoreMap(items, a.em?.layout_settings, a.em?.exam_type, a.em?.total_questions || 1);
      examScoreCfg.set(eid, {
        scoreByQuestionId,
        defaultScore: 100 / (groupCount || a.em?.total_questions || 1)
      });
    }
  });

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
    const cfg = examScoreCfg.get(key);
    let firstSum = 0;
    let finalSum = 0;
    rows.forEach((r: any) => {
      const g = String(r.grading_code).trim();
      const qScore = cfg?.scoreByQuestionId.get(String(r.question_id)) ?? cfg?.defaultScore ?? 5;
      if (g === "O") firstSum += qScore;
      finalSum += calcScoreRatio(g, qScore, gcMeta, false).newEarned;
    });
    const sc = { first: roundScore(firstSum), final: roundScore(finalSum) };
    t.scores.push(sc);
    (matrix[a.student_id] ||= {})[key] = sc;
  });
  const tests = Array.from(perTest.entries()).filter(([, t]) => t.scores.length > 0).map(([key, t]) => ({
    key, title: t.title, date: t.date, totalQ: t.totalQ, taken: t.scores.length, enrolled: t.enrolled,
    avgFirst: roundScore(avg(t.scores.map(s => s.first))), avgFinal: roundScore(avg(t.scores.map(s => s.final))),
    max: Math.max(...t.scores.map(s => s.first)), min: Math.min(...t.scores.map(s => s.first)),
  })).sort((a, b) => a.date.localeCompare(b.date));
  return { tests, matrix };
}
