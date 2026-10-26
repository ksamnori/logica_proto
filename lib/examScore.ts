// src/lib/examScore.ts
// 대문항(그룹) 기준 균등 배점 + 서브문항((1),(2) 등) 분할 배점 및 TO/RO 부분점수(score_ratio) 계산 유틸리티

/**
 * 소수점 첫째 자리까지 반올림 (예: 97.5 -> 97.5, 100.0 -> 100)
 */
export function roundScore(val: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 10) / 10;
}

/**
 * 채점 기호(O, TO, RO, X, TX 등)와 문항 배점(assignedScore), 마스터 채점 기준(metaMap)을 바탕으로
 * 획득 점수(newEarned), 정답 여부(isCorrectEq), 적용 비율(ratio)을 계산합니다.
 */
export function calcScoreRatio(
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
export function extractMergedQuestionGroups(layoutSettings: any): string[][] {
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
export function buildExamQuestionScoreMap(
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
