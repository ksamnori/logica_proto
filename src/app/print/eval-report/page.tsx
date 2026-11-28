// src/app/print/eval-report/page.tsx
"use client";

import React, { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Chart from "chart.js/auto";
import { supabase } from "@/lib/supabase";
import { calcScoreRatio, extractMergedQuestionGroups, roundScore } from "@/lib/examScore";
import { normalizeMasterCategoryRow } from "@/lib/normalize";
import { fetchThinkingCategories, type ThinkingCategoryItem } from "@/lib/thinkingCategory";

type EvalKind = "midterm" | "quarterly" | "periodic";
type DiffTierKey = "BASIC" | "MID" | "KILLER";

const COMPETENCY_ORDER = ["문제해결", "추론", "의사소통", "연결", "정보처리"] as const;
type CompetencyKey = (typeof COMPETENCY_ORDER)[number];

const COMPETENCY_META: Record<
  CompetencyKey,
  { textCls: string; dotCls: string; desc: string }
> = {
  문제해결: {
    textCls: "text-blue-700",
    dotCls: "bg-blue-600",
    desc: "조건 분석·해결 전략 수립",
  },
  추론: {
    textCls: "text-violet-700",
    dotCls: "bg-violet-600",
    desc: "규칙 발견·논리적 근거 도출",
  },
  의사소통: {
    textCls: "text-emerald-700",
    dotCls: "bg-emerald-600",
    desc: "용어·기호·식·그래프 해석",
  },
  연결: {
    textCls: "text-amber-700",
    dotCls: "bg-amber-500",
    desc: "개념 통합 및 실생활 적용",
  },
  정보처리: {
    textCls: "text-rose-700",
    dotCls: "bg-rose-500",
    desc: "표·자료 정리 및 핵심 파악",
  },
};

interface MainQuestionAnalysis {
  qNum: number;
  subCount: number;
  maxScore: number;
  initEarned: number;
  cohortAvgEarned: number;
  questionAccPct: number;
  status: "O" | "TRI" | "X";
  competencies: CompetencyKey[];
  unitName: string;
  detailTopic: string;
  diffTier: DiffTierKey;
  rawDifficulty: string;
}

interface CompetencyBucketRow {
  name: CompetencyKey;
  qCount: number;
  maxScore: number;
  initEarned: number;
  cohortAvg: number;
  initPct: number | null;
  cohortPct: number | null;
}

interface DiffTierRow {
  key: DiffTierKey;
  label: string;
  axisRange: string;
  qCount: number;
  maxScore: number;
  initEarned: number;
  cohortAvg: number;
  initPct: number;
  cohortPct: number;
}

interface EvalReportState {
  assignmentId: string;
  evalKind: EvalKind;
  evalKindLabel: string;
  hideQuestionPoints: boolean;
  examTitle: string;
  courseBadge: string;
  studentName: string;
  studentSchoolGrade: string;
  className: string;
  reportDate: string;
  totalMainQuestions: number;
  totalSubItems: number;
  initTotalScore: number;
  cohortAvgInit: number;
  cohortSampleCount: number;
  fullCorrectCount: number;
  partialCount: number;
  wrongCount: number;
  bestComp: string;
  worstComp: string;
  questions: MainQuestionAnalysis[];
  compRows: CompetencyBucketRow[];
  diffRows: DiffTierRow[];
  hasKillerQuestions: boolean;
  mistakeQuestions: MainQuestionAnalysis[];
  killerSolvedQuestions: MainQuestionAnalysis[];
  weakTopics: string[];
  autoComment: string;
}

async function fetchAllRows(buildQuery: (from: number, to: number) => any, pageSize = 1000) {
  let all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function stripLeadingIndex(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+|\d+)\s*[.\-)\]]\s*/i, "")
    .replace(/^\(\d+\)\s*/, "")
    .trim();
}

function fmtScore(n: number): string {
  const r = roundScore(n);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function isValidCompetency(val: any): val is CompetencyKey {
  return typeof val === "string" && (COMPETENCY_ORDER as readonly string[]).includes(val.trim());
}

function inferFallbackCompetencies(hintText: string): CompetencyKey[] {
  const s = String(hintText || "");
  const matched: CompetencyKey[] = [];
  if (/표|그래프|통계|자료|경우의\s*수|확률|평균|가능성|분류|정리/.test(s)) {
    matched.push("정보처리");
  }
  if (/새\s*연산|기호|정의|식\s*세우|서술|설명|나타내기|표현/.test(s)) {
    matched.push("의사소통");
  }
  if (/규칙|수열|논리|추리|추론|복면산|벌레먹은|마방진|스도쿠|퍼즐|배열|참.*거짓/.test(s)) {
    matched.push("추론");
  }
  if (/실생활|활용|측정|시계|시간|달력|길이|들이|무게|이동|전개도|쌓기나무|닮음/.test(s)) {
    matched.push("연결");
  }
  if (matched.length === 0) return ["문제해결"];
  if (matched.length === 1 && matched[0] !== "문제해결" && /조건|구하|만들기|해결|최대|최소/.test(s)) {
    matched.push("문제해결");
  }
  return matched.slice(0, 2);
}

function extractCompetencyPairFromRow(row: any): {
  primary: CompetencyKey | null;
  secondary: CompetencyKey | null;
} {
  if (!row) return { primary: null, secondary: null };
  const hasConfirmedPrimary = Boolean(String(row.final_primary || "").trim());
  const pRaw = String(hasConfirmedPrimary ? row.final_primary : row.ai_primary || "").trim();
  const sRaw = String(hasConfirmedPrimary ? row.final_secondary || "" : row.ai_secondary || "").trim();
  const primary = isValidCompetency(pRaw) ? pRaw : null;
  const secondary = isValidCompetency(sRaw) && sRaw !== primary ? sRaw : null;
  return { primary, secondary };
}

function EvalReportContent() {
  const searchParams = useSearchParams();
  const assignmentId = searchParams.get("assignment_id");

  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [reportData, setReportData] = useState<EvalReportState | null>(null);
  const [customComment, setCustomComment] = useState("");
  const [isEditingComment, setIsEditingComment] = useState(false);

  const compChartRef = useRef<HTMLCanvasElement>(null);
  const diffChartRef = useRef<HTMLCanvasElement>(null);
  const chartInstances = useRef<{ comp?: Chart; diff?: Chart }>({});

  useEffect(() => {
    if (assignmentId && assignmentId !== "null") {
      fetchEvalReport(assignmentId);
    } else {
      setErrorMsg("❌ assignment_id 값이 URL에 없습니다.");
      setIsLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    if (reportData && !isLoading) {
      renderCharts(reportData);
    }
    return () => {
      chartInstances.current.comp?.destroy();
      chartInstances.current.diff?.destroy();
    };
  }, [reportData, isLoading]);

  const handleCommentChange = (val: string) => {
    setCustomComment(val);
    if (typeof window !== "undefined" && assignmentId) {
      try {
        if (val.trim() && val !== reportData?.autoComment) {
          localStorage.setItem(`logica_eval_report_comment_${assignmentId}`, val);
        } else {
          localStorage.removeItem(`logica_eval_report_comment_${assignmentId}`);
        }
      } catch {}
    }
  };

  const resetCommentToAuto = () => {
    if (!reportData) return;
    setCustomComment(reportData.autoComment);
    if (typeof window !== "undefined" && assignmentId) {
      try {
        localStorage.removeItem(`logica_eval_report_comment_${assignmentId}`);
      } catch {}
    }
  };

  const fetchEvalReport = async (targetAssignId: string) => {
    setIsLoading(true);
    setErrorMsg("");
    try {
      // 1. 기본 열람 권한 확인
      if (typeof window !== "undefined") {
        const role = localStorage.getItem("logica_instructor_role") || "";
        const pos = localStorage.getItem("logica_instructor_position") || "";
        const staffTenantId = localStorage.getItem("logica_tenant_id") || "";
        if (role && staffTenantId) {
          const isSuperAdmin = role === "SUPER_ADMIN" || pos.includes("최고관리자");
          const isPrincipal =
            role === "ADMIN" ||
            role === "MANAGER" ||
            role === "PRINCIPAL" ||
            pos.includes("원장") ||
            pos.includes("실장");
          if (!isSuperAdmin && !isPrincipal) {
            const { data: permRow } = await supabase
              .from("tenant_role_permissions")
              .select("allowed_menus")
              .eq("tenant_id", staffTenantId)
              .eq("role_name", role)
              .maybeSingle();
            if (permRow && Array.isArray(permRow.allowed_menus)) {
              const menus: string[] = permRow.allowed_menus;
              const canView =
                menus.includes("ALL") ||
                menus.includes("action_view_exam") ||
                menus.includes("/student") ||
                menus.includes("/exam-list") ||
                menus.includes("action_view_admission_report") ||
                menus.includes("action_manage_admission_report");
              if (!canView) {
                throw new Error("⛔ 평가 분석 리포트를 열람할 권한이 없습니다.");
              }
            }
          }
        }
      }

      // 2. 배정 · 학생 · 시험지 마스터 조회
      const { data: assign, error: aErr } = await supabase
        .from("exam_assignment")
        .select("*, student(student_id, name, grade, school, tenant_id), exam_master(*)")
        .eq("assignment_id", targetAssignId)
        .single();

      if (aErr || !assign) {
        throw new Error(`[배정 정보 로드 실패]\n${aErr?.message || "배정 데이터를 찾을 수 없습니다."}`);
      }

      const studentObj = Array.isArray(assign.student) ? assign.student[0] : assign.student;
      const exMaster = Array.isArray(assign.exam_master) ? assign.exam_master[0] : assign.exam_master;
      const examPaperId = assign.exam_id || assign.exam_paper_id;
      if (!examPaperId) {
        throw new Error("시험지 ID(exam_id)를 찾을 수 없습니다.");
      }

      let className = "";
      if (assign.class_id) {
        try {
          const { data: clsRow } = await supabase
            .from("class")
            .select("name")
            .eq("class_id", assign.class_id)
            .maybeSingle();
          if (clsRow?.name) className = String(clsRow.name);
        } catch {}
      }

      // 3. 평가 종류 판별 (중간평가 20문항 / 분기평가 30문항)
      const typeMetaStr = `${exMaster?.exam_type || ""} ${exMaster?.title || ""} ${exMaster?.sub_title || ""}`;
      let evalKind: EvalKind = "periodic";
      let evalKindLabel = "정기평가";
      let expectedMainCount = 20;
      if (typeMetaStr.includes("분기평가") || typeMetaStr.includes("분기테스트")) {
        evalKind = "quarterly";
        evalKindLabel = "분기평가";
        expectedMainCount = 30;
      } else if (typeMetaStr.includes("중간평가") || typeMetaStr.includes("중간테스트")) {
        evalKind = "midterm";
        evalKindLabel = "중간평가";
        expectedMainCount = 20;
      }

      // 4. 문항 목록 · 채점 기준 · 내 답안 · 사고력 분류 병렬 로드
      const [{ data: gcData }, { data: itemsRaw }, { data: myAnswersRaw }, thinkingList] =
        await Promise.all([
          supabase
            .from("master_grading_code")
            .select("code, score_ratio, admission_ratio, is_correct"),
          supabase
            .from("exam_item")
            .select("*")
            .eq("exam_id", examPaperId)
            .order("sort_order"),
          supabase
            .from("student_answer")
            .select("*")
            .eq("exam_assignment_id", targetAssignId),
          fetchThinkingCategories(),
        ]);

      const gcMap: Record<string, any> = {};
      (gcData || []).forEach((row: any) => {
        if (row.code) gcMap[row.code] = row;
      });

      const thinkingMap = new Map<string, ThinkingCategoryItem>();
      (thinkingList || []).forEach((tc) => {
        if (tc.category_id) thinkingMap.set(String(tc.category_id).trim(), tc);
      });

      const items = [...(itemsRaw || [])].sort(
        (a: any, b: any) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
      );
      if (items.length === 0) {
        throw new Error("시험지에 등록된 문항(exam_item) 데이터가 없습니다.");
      }

      // 5. 문항 상세 DB(question_db + textbook_question 폴백) 및 분류·교과역량 로드
      const qIds = Array.from(new Set(items.map((i: any) => i.question_id).filter(Boolean)));
      const uuidIds = qIds.filter((id: any) => typeof id === "string" && id.includes("-"));
      const numIds = qIds
        .filter(
          (id: any) =>
            typeof id === "number" ||
            (typeof id === "string" && !id.includes("-") && !isNaN(Number(id)))
        )
        .map(Number);

      const fetchedQuestions: any[] = [];
      if (uuidIds.length > 0) {
        const { data: qDbData, error: qDbErr } = await supabase
          .from("question_db")
          .select(
            "question_id, item_id, parent_question_id, question_number, sub_num, pdf_source, detected_page_num, final_printed_page, book_name, source_book_name, taxonomy_id, taxonomy_name, sub_taxonomy_id, thk_taxonomy_id, thk_taxonomy_name, difficulty, solving_probability"
          )
          .in("question_id", uuidIds);
        if (!qDbErr && qDbData) {
          fetchedQuestions.push(...qDbData);
        } else {
          const { data: qDbFallback } = await supabase
            .from("question_db")
            .select("*")
            .in("question_id", uuidIds);
          if (qDbFallback) fetchedQuestions.push(...qDbFallback);
        }
      }

      const foundUuids = new Set(fetchedQuestions.map((q: any) => String(q.question_id)));
      const missingUuids = uuidIds.filter((id: any) => !foundUuids.has(String(id)));
      if (missingUuids.length > 0) {
        const { data: tqUuidData } = await supabase
          .from("textbook_question")
          .select("*")
          .in("question_id", missingUuids);
        if (tqUuidData) fetchedQuestions.push(...tqUuidData);
      }
      if (numIds.length > 0) {
        const { data: tqNumData } = await supabase
          .from("textbook_question")
          .select("*")
          .in("tq_id", numIds);
        if (tqNumData) fetchedQuestions.push(...tqNumData);
      }

      const qMap: Record<string, any> = {};
      fetchedQuestions.forEach((q: any) => {
        if (q.question_id) qMap[String(q.question_id)] = q;
        if (q.tq_id) qMap[String(q.tq_id)] = q;
      });

      // master_item -> master_category & taxonomy_competency 조회
      const lookupItemOrTaxIds = Array.from(
        new Set(
          fetchedQuestions
            .flatMap((q: any) => [q.item_id, q.taxonomy_id, q.sub_taxonomy_id])
            .filter((v: any) => v && v !== "미분류")
            .map((v: any) => String(v).trim())
        )
      );

      const itemToCatIdMap = new Map<string, string>();
      if (lookupItemOrTaxIds.length > 0) {
        const { data: mItems } = await supabase
          .from("master_item")
          .select("item_id, category_id")
          .in("item_id", lookupItemOrTaxIds);
        (mItems || []).forEach((mi: any) => {
          if (mi.item_id && mi.category_id) {
            itemToCatIdMap.set(String(mi.item_id).trim(), String(mi.category_id).trim());
          }
        });
      }

      const resolveQuestionCatId = (q: any): string => {
        const rawCandidates = [q?.item_id, q?.taxonomy_id, q?.sub_taxonomy_id]
          .filter((v: any) => v && v !== "미분류")
          .map((v: any) => String(v).trim());
        for (const cand of rawCandidates) {
          if (itemToCatIdMap.has(cand)) return itemToCatIdMap.get(cand)!;
        }
        return rawCandidates[0] || "";
      };

      const catIdSet = new Set<string>();
      fetchedQuestions.forEach((q: any) => {
        const cid = resolveQuestionCatId(q);
        if (cid) catIdSet.add(cid);
        if (q.thk_taxonomy_id) catIdSet.add(String(q.thk_taxonomy_id).trim());
      });

      const catByIdMap = new Map<string, any>();
      const compByCatIdMap = new Map<
        string,
        { primary: CompetencyKey | null; secondary: CompetencyKey | null }
      >();

      const catIds = Array.from(catIdSet);
      if (catIds.length > 0) {
        const [catRes, compRes] = await Promise.all([
          supabase
            .from("master_category")
            .select("category_id, depth1, depth2, depth3, depth4, depth5, depth6, depth7, full_path")
            .in("category_id", catIds),
          supabase
            .from("taxonomy_competency")
            .select("category_id, status, final_primary, ai_primary, final_secondary, ai_secondary")
            .in("category_id", catIds),
        ]);

        (catRes.data || []).forEach((raw: any) => {
          const norm = normalizeMasterCategoryRow(raw);
          if (norm?.category_id) catByIdMap.set(String(norm.category_id).trim(), norm);
        });

        (compRes.data || []).forEach((row: any) => {
          if (!row?.category_id) return;
          const pair = extractCompetencyPairFromRow(row);
          if (pair.primary || pair.secondary) {
            compByCatIdMap.set(String(row.category_id).trim(), pair);
          }
        });

        // 직접 매칭되지 않은 category_id 에 대한 상위 prefix 폴백 조회
        const unresolvedCats = catIds.filter(
          (cid) => !cid.startsWith("THK-") && (!catByIdMap.has(cid) || !compByCatIdMap.has(cid))
        );
        if (unresolvedCats.length > 0) {
          const prefixes = Array.from(
            new Set(
              unresolvedCats
                .map((cid) => cid.split("-").slice(0, 3).join("-"))
                .filter((p) => p.length >= 6)
            )
          );
          await Promise.all(
            prefixes.map(async (prefix) => {
              const [{ data: fbCatRows }, { data: fbCompRows }] = await Promise.all([
                supabase
                  .from("master_category")
                  .select("category_id, depth1, depth2, depth3, depth4, depth5, depth6, depth7, full_path")
                  .like("category_id", `${prefix}%`)
                  .limit(1),
                supabase
                  .from("taxonomy_competency")
                  .select("category_id, status, final_primary, ai_primary, final_secondary, ai_secondary")
                  .like("category_id", `${prefix}%`)
                  .limit(1),
              ]);

              if (fbCatRows && fbCatRows.length > 0) {
                const norm = normalizeMasterCategoryRow(fbCatRows[0]);
                unresolvedCats
                  .filter((u) => u.startsWith(prefix) && !catByIdMap.has(u))
                  .forEach((u) => catByIdMap.set(u, norm));
              }

              if (fbCompRows && fbCompRows.length > 0) {
                const mapped = extractCompetencyPairFromRow(fbCompRows[0]);
                if (mapped.primary || mapped.secondary) {
                  unresolvedCats
                    .filter((u) => u.startsWith(prefix) && !compByCatIdMap.has(u))
                    .forEach((u) => compByCatIdMap.set(u, mapped));
                }
              }
            })
          );
        }
      }

      // 6. 대문항(메인 문항) 그룹화
      const mergedArrays = extractMergedQuestionGroups(exMaster?.layout_settings);
      const customGroupMap = new Map<string, string>();
      mergedArrays.forEach((arr, idx) => {
        const gId = `custom_group_${idx}`;
        arr.forEach((qid) => customGroupMap.set(String(qid), gId));
      });

      const examQIdSet = new Set(items.map((it: any) => String(it.question_id)));
      const parentCountMap = new Map<string, number>();
      items.forEach((it: any) => {
        const q = qMap[String(it.question_id)] || {};
        const pId = String(q.parent_question_id || q.parent_tq_id || "").trim();
        if (pId && pId !== "null") {
          parentCountMap.set(pId, (parentCountMap.get(pId) || 0) + 1);
        }
      });

      const buildGroups = (allowSourcePageMerge: boolean) => {
        const gm = new Map<string, { id: string; sort_order: number; items: any[] }>();
        const list: { id: string; sort_order: number; items: any[] }[] = [];

        items.forEach((item: any, idx: number) => {
          const qidStr = String(item.question_id);
          const q = qMap[qidStr] || {};
          let gId = customGroupMap.get(qidStr) || "";

          if (!gId) {
            const pId = String(q.parent_question_id || q.parent_tq_id || "").trim();
            if (pId && pId !== "null" && (examQIdSet.has(pId) || (parentCountMap.get(pId) || 0) > 1)) {
              gId = `parent_${pId}`;
            } else if (examQIdSet.has(qidStr) && (parentCountMap.get(qidStr) || 0) >= 1) {
              gId = `parent_${qidStr}`;
            }
          }

          if (!gId && allowSourcePageMerge) {
            const src = String(q.pdf_source || "").trim();
            const page = String(q.detected_page_num || q.final_printed_page || "").trim();
            const baseNumMatch = String(q.question_number || "").match(/\d+/);
            if (src && page && baseNumMatch) {
              gId = `src_${src}_${page}_${baseNumMatch[0]}`;
            }
          }

          if (!gId) {
            gId = `single_${qidStr}_${idx}`;
          }

          if (!gm.has(gId)) {
            const newG = { id: gId, sort_order: Number(item.sort_order) || idx, items: [] as any[] };
            gm.set(gId, newG);
            list.push(newG);
          }
          gm.get(gId)!.items.push({
            sort_order: Number(item.sort_order) || idx,
            assigned_score: item.assigned_score,
            question_id: qidStr,
            question: q,
          });
        });

        list.forEach((g) => {
          g.sort_order = Math.min(...g.items.map((i) => i.sort_order));
        });
        list.sort((a, b) => a.sort_order - b.sort_order);
        return list;
      };

      let groups = buildGroups(false);
      if (mergedArrays.length === 0 && groups.length > expectedMainCount) {
        const fallbackGroups = buildGroups(true);
        if (fallbackGroups.length >= Math.min(10, expectedMainCount)) {
          groups = fallbackGroups;
        }
      }

      if (evalKind === "periodic") {
        if (groups.length >= 25) {
          evalKind = "quarterly";
          evalKindLabel = "분기평가";
        } else {
          evalKind = "midterm";
          evalKindLabel = "중간평가";
        }
      }

      // 중간평가는 모두 5점 균등 배점이므로 문항별 배점 표기 생략, 분기평가는 배점 유지
      const hideQuestionPoints = evalKind === "midterm";

      // 7. 대문항별 배점 및 원점수 산정 (오답수정 RO/TO 제외, 순수 원점수 기준)
      const groupCount = groups.length || 1;
      const baseGroupScore = 100 / groupCount;
      const isWeightedExam =
        Boolean(
          exMaster?.exam_type &&
            (exMaster.exam_type.includes("입학테스트") ||
              exMaster.exam_type.includes("진단평가") ||
              exMaster.exam_type.includes("분기평가") ||
              exMaster.exam_type.includes("분기테스트"))
        ) || evalKind === "quarterly";

      const explicitMaxes = groups.map((g) =>
        Math.max(...g.items.map((i: any) => parseFloat(i.assigned_score) || 0))
      );
      const explicitSum = explicitMaxes.reduce((acc, v) => acc + v, 0);
      const useExplicitGroupMax = isWeightedExam && explicitSum > 0;

      const groupConfigs = groups.map((g, idx) => {
        const gMax = useExplicitGroupMax && explicitMaxes[idx] > 0 ? explicitMaxes[idx] : baseGroupScore;
        const subScore = gMax / (g.items.length || 1);
        return { ...g, qNum: idx + 1, maxScore: gMax, subScore };
      });

      const buildDedupAnswerMap = (ansRows: any[]) => {
        const m = new Map<string, any>();
        (ansRows || []).forEach((ans) => {
          if (!ans.grading_code && ans.is_correct == null) return;
          const k = String(ans.question_id);
          const prev = m.get(k);
          if (!prev || Number(ans.earned_score || 0) >= Number(prev.earned_score || 0)) {
            m.set(k, ans);
          }
        });
        return m;
      };

      const scoreOriginalAnswerSet = (ansMap: Map<string, any>) => {
        let initTotal = 0;
        const perGroup: { init: number }[] = [];

        groupConfigs.forEach((g) => {
          let gInit = 0;
          g.items.forEach((it: any) => {
            const ans = ansMap.get(String(it.question_id));
            if (!ans) return;
            const code = ans.grading_code ? String(ans.grading_code).trim() : "";
            if (code) {
              // 정기평가(중간·분기)는 오답 정정(RO/TO) 점수를 합산하지 않고 최초 채점 기준만 인정
              if (code === "O") {
                gInit += g.subScore;
              } else if (["a", "b", "c", "q"].includes(code)) {
                gInit += calcScoreRatio(code, g.subScore, gcMap, evalKind === "quarterly").newEarned;
              }
            } else if (ans.is_correct === true) {
              gInit += g.subScore;
            }
          });
          gInit = Math.min(g.maxScore, gInit);
          initTotal += gInit;
          perGroup.push({ init: gInit });
        });

        return { initTotal, perGroup };
      };

      const myAnsMap = buildDedupAnswerMap(myAnswersRaw || []);
      const myScored = scoreOriginalAnswerSet(myAnsMap);

      // 8. 동일 시험지 응시자 코호트 정답률 및 평균 산출
      const rawCohortAssigns = await fetchAllRows((from, to) =>
        supabase
          .from("exam_assignment")
          .select("assignment_id, exam_id, total_score, status, student(name)")
          .eq("exam_id", examPaperId)
          .not("status", "in", '("응시전","미응시","예정","대기")')
          .range(from, to)
      );

      let filteredCohortAssigns = (rawCohortAssigns || []).filter((a: any) => {
        const st = Array.isArray(a.student) ? a.student[0] : a.student;
        const nm = String(st?.name || "").trim();
        if (!nm || nm.includes("테스트") || nm.toLowerCase().includes("test")) return false;
        return true;
      });
      if (filteredCohortAssigns.length === 0 && rawCohortAssigns && rawCohortAssigns.length > 0) {
        filteredCohortAssigns = rawCohortAssigns;
      }

      const cohortAssignIds = Array.from(
        new Set([
          ...filteredCohortAssigns.map((a: any) => String(a.assignment_id)),
          String(targetAssignId),
        ])
      );

      let allCohortAnswers: any[] = [];
      for (let i = 0; i < cohortAssignIds.length; i += 200) {
        const chunk = cohortAssignIds.slice(i, i + 200);
        const chunkRows = await fetchAllRows((from, to) =>
          supabase
            .from("student_answer")
            .select("exam_assignment_id, question_id, grading_code, earned_score, is_correct")
            .in("exam_assignment_id", chunk)
            .range(from, to)
        );
        if (chunkRows) allCohortAnswers = allCohortAnswers.concat(chunkRows);
      }

      const answersByAssign = new Map<string, any[]>();
      allCohortAnswers.forEach((row) => {
        const k = String(row.exam_assignment_id);
        if (!answersByAssign.has(k)) answersByAssign.set(k, []);
        answersByAssign.get(k)!.push(row);
      });

      const validAssignSet = new Set(filteredCohortAssigns.map((a: any) => String(a.assignment_id)));
      if (validAssignSet.size === 0) validAssignSet.add(String(targetAssignId));

      let validSampleCount = 0;
      let cohortInitSum = 0;
      const cohortGroupInitSum = new Array(groupConfigs.length).fill(0);

      validAssignSet.forEach((aId) => {
        const rows = answersByAssign.get(aId) || [];
        const dedup = buildDedupAnswerMap(rows);
        if (dedup.size === 0) return;
        const sc = scoreOriginalAnswerSet(dedup);
        validSampleCount += 1;
        cohortInitSum += roundScore(sc.initTotal);
        sc.perGroup.forEach((pg, idx) => {
          cohortGroupInitSum[idx] += pg.init;
        });
      });

      const initTotalScore =
        myAnsMap.size > 0 ? roundScore(myScored.initTotal) : roundScore(assign.total_score || 0);
      const cohortAvgInit =
        validSampleCount > 0 ? roundScore(cohortInitSum / validSampleCount) : initTotalScore;

      // 9. 메인 문항별 교과 역량(5대 영역) · 체감 난이도 · 결과 구축
      let fullCorrectCount = 0;
      let partialCount = 0;
      let wrongCount = 0;

      const resolveQuestionMeta = (
        g: any
      ): {
        competencies: CompetencyKey[];
        unitName: string;
        detailTopic: string;
        rawDifficulty: string;
      } => {
        const compList: CompetencyKey[] = [];
        const pushComp = (val: CompetencyKey | null | undefined) => {
          if (val && !compList.includes(val)) compList.push(val);
        };

        for (const it of g.items) {
          const q = it.question || {};
          const cid = resolveQuestionCatId(q);
          if (cid && compByCatIdMap.has(cid)) {
            const c = compByCatIdMap.get(cid)!;
            pushComp(c.primary);
            pushComp(c.secondary);
          }
          const thkCid = String(q.thk_taxonomy_id || "").trim();
          if (thkCid && compByCatIdMap.has(thkCid)) {
            const c = compByCatIdMap.get(thkCid)!;
            pushComp(c.primary);
            pushComp(c.secondary);
          }
          if (compList.length >= 2) break;
        }

        const primaryItem =
          g.items.find(
            (it: any) =>
              it.question?.item_id ||
              it.question?.taxonomy_id ||
              it.question?.thk_taxonomy_id ||
              it.question?.taxonomy_name ||
              it.question?.thk_taxonomy_name
          ) || g.items[0];
        const q = primaryItem?.question || {};
        const rawDiff = String(q.difficulty || "").trim();
        const cid = resolveQuestionCatId(q);
        const cat = cid ? catByIdMap.get(cid) : null;
        const thkId = String(q.thk_taxonomy_id || "").trim();
        const thk = thkId ? thinkingMap.get(thkId) : null;

        let unitName = "";
        let detailTopic = "";
        if (cat) {
          unitName = stripLeadingIndex(cat.depth4 || cat.depth3 || cat.depth2 || "교과 개념");
          const upperTopic = cat.depth6
            ? cat.depth5 || cat.depth4 || cat.depth3
            : cat.depth4 || cat.depth3;
          detailTopic = stripLeadingIndex(upperTopic || unitName);
        } else if (thk) {
          unitName = thk.depth1;
          detailTopic = stripLeadingIndex(
            (thk.depth3 ? thk.depth2 || thk.depth1 : thk.depth1) || unitName
          );
        } else if (q.thk_taxonomy_name) {
          const parts = String(q.thk_taxonomy_name)
            .split(">")
            .map((p) => p.trim())
            .filter(Boolean);
          unitName = parts[0] || "사고력";
          detailTopic =
            (parts.length >= 2 ? parts[parts.length - 2] : parts[0]) || unitName;
        } else if (
          q.taxonomy_name &&
          q.taxonomy_name !== "분류 없음" &&
          q.taxonomy_name !== "유형 분류 없음"
        ) {
          const parts = String(q.taxonomy_name)
            .split(">")
            .map((p) => stripLeadingIndex(p))
            .filter(Boolean);
          unitName =
            parts.length >= 4 ? parts[3] : parts.length >= 3 ? parts[2] : parts[parts.length - 1] || "";
          detailTopic =
            (parts.length >= 2 ? parts[parts.length - 2] : parts[0]) || unitName;
        }

        const competencies: CompetencyKey[] =
          compList.length > 0
            ? compList.slice(0, 2)
            : inferFallbackCompetencies(
                `${unitName} ${detailTopic} ${q.thk_taxonomy_name || ""} ${q.taxonomy_name || ""}`
              );

        return { competencies, unitName, detailTopic, rawDifficulty: rawDiff };
      };

      const resolveQuestionGlobalAccPct = (
        g: any,
        rawDiff: string,
        maxScore: number,
        cohortAccPct: number | null
      ): number => {
        const dbProbs = g.items
          .map((it: any) => Number(it.question?.solving_probability))
          .filter((v: number) => Number.isFinite(v) && v > 0 && v <= 100);

        if (dbProbs.length > 0) {
          const avgProb = dbProbs.reduce((acc: number, v: number) => acc + v, 0) / dbProbs.length;
          return Math.max(1, Math.min(99, Math.round(avgProb)));
        }

        if (validSampleCount >= 3 && cohortAccPct !== null) {
          return Math.max(1, Math.min(99, cohortAccPct));
        }

        const d = rawDiff.replace(/\s+/g, "");
        if (["최하", "1", "Lv.1", "Lv1", "Level1"].includes(d)) return 85;
        if (["하", "2", "Lv.2", "Lv2", "Level2"].includes(d)) return 72;
        if (d === "중하") return 62;
        if (["중", "3", "Lv.3", "Lv3"].includes(d)) return 50;
        if (["중상", "4", "Lv.4", "Lv4", "Level4"].includes(d)) {
          return useExplicitGroupMax && maxScore >= 4.5 ? 32 : 42;
        }
        if (["상"].includes(d)) return 30;
        if (["최상", "5", "Lv.5", "Lv5", "Level5"].includes(d)) return 20;

        if (useExplicitGroupMax) {
          if (maxScore <= 2.5) return 80;
          if (maxScore >= 4.5) return 28;
        }
        return 50;
      };

      const questions: MainQuestionAnalysis[] = groupConfigs.map((g, idx) => {
        const pg = myScored.perGroup[idx] || { init: 0 };
        const cohortAvgEarned =
          validSampleCount > 0 ? cohortGroupInitSum[idx] / validSampleCount : pg.init;
        const cohortAccPct =
          validSampleCount > 0 && g.maxScore > 0
            ? Math.round((cohortAvgEarned / g.maxScore) * 100)
            : null;

        let status: "O" | "TRI" | "X" = "X";
        if (pg.init >= g.maxScore - 0.05 && g.maxScore > 0) {
          status = "O";
          fullCorrectCount += 1;
        } else if (pg.init > 0) {
          status = "TRI";
          partialCount += 1;
        } else {
          wrongCount += 1;
        }

        const { competencies, unitName, detailTopic, rawDifficulty } = resolveQuestionMeta(g);
        const questionAccPct = resolveQuestionGlobalAccPct(
          g,
          rawDifficulty,
          g.maxScore,
          cohortAccPct
        );

        let diffTier: DiffTierKey;
        if (questionAccPct >= 70) diffTier = "BASIC";
        else if (questionAccPct >= 40) diffTier = "MID";
        else diffTier = "KILLER";

        return {
          qNum: g.qNum,
          subCount: g.items.length,
          maxScore: g.maxScore,
          initEarned: pg.init,
          cohortAvgEarned,
          questionAccPct,
          status,
          competencies,
          unitName,
          detailTopic,
          diffTier,
          rawDifficulty,
        };
      });

      // 10. 5대 교과 역량별 성취도 집계 (주 역량과 보조 역량을 가중치 차이 없이 1:1 동일하게 반영)
      const compRows: CompetencyBucketRow[] = COMPETENCY_ORDER.map((compName) => {
        const qs = questions.filter((q) => q.competencies.includes(compName));
        const maxS = qs.reduce((acc, q) => acc + q.maxScore, 0);
        const initS = qs.reduce((acc, q) => acc + q.initEarned, 0);
        const cohS = qs.reduce((acc, q) => acc + q.cohortAvgEarned, 0);
        return {
          name: compName,
          qCount: qs.length,
          maxScore: roundScore(maxS),
          initEarned: roundScore(initS),
          cohortAvg: roundScore(cohS),
          initPct: maxS > 0 ? Math.round((initS / maxS) * 100) : null,
          cohortPct: maxS > 0 ? Math.round((cohS / maxS) * 100) : null,
        };
      });

      const activeCompRows = compRows
        .filter((r) => r.qCount > 0 && r.initPct !== null)
        .sort((a, b) => (b.initPct ?? 0) - (a.initPct ?? 0) || b.maxScore - a.maxScore);

      let bestComp = "";
      let worstComp = "";
      if (activeCompRows.length > 0) {
        const top = activeCompRows[0];
        const bottom = activeCompRows[activeCompRows.length - 1];
        if ((top.initPct ?? 0) >= 70) bestComp = top.name;
        if ((bottom.initPct ?? 0) < 80 && top.name !== bottom.name) worstComp = bottom.name;
      }

      // 11. 체감 난이도 3단계 집계 + 실수/킬러 하이라이트 추출 (전체 문항 정답률 기준)
      const tierMeta: { key: DiffTierKey; label: string; axisRange: string }[] = [
        { key: "BASIC", label: "핵심 기본", axisRange: "(70%↑)" },
        { key: "MID", label: "중급 응용", axisRange: "(40~69%)" },
        { key: "KILLER", label: "고난도 심화", axisRange: "(40%↓)" },
      ];

      const diffRows: DiffTierRow[] = tierMeta.map((tm) => {
        const qs = questions.filter((q) => q.diffTier === tm.key);
        const maxS = qs.reduce((s, q) => s + q.maxScore, 0);
        const initS = qs.reduce((s, q) => s + q.initEarned, 0);
        const cohS = qs.reduce((s, q) => s + q.cohortAvgEarned, 0);
        return {
          key: tm.key,
          label: tm.label,
          axisRange: tm.axisRange,
          qCount: qs.length,
          maxScore: roundScore(maxS),
          initEarned: roundScore(initS),
          cohortAvg: roundScore(cohS),
          initPct: maxS > 0 ? Math.round((initS / maxS) * 100) : 0,
          cohortPct: maxS > 0 ? Math.round((cohS / maxS) * 100) : 0,
        };
      });

      const hasKillerQuestions = questions.some((q) => q.diffTier === "KILLER");

      const mistakeQuestions = questions
        .filter((q) => q.diffTier === "BASIC" && q.status !== "O")
        .sort((a, b) => b.questionAccPct - a.questionAccPct || a.qNum - b.qNum)
        .slice(0, 5);

      const killerSolvedQuestions = questions
        .filter((q) => q.diffTier === "KILLER" && q.status === "O")
        .sort((a, b) => a.questionAccPct - b.questionAccPct || a.qNum - b.qNum)
        .slice(0, 5);

      // 보완 필요 세부유형 추출
      const missedSorted = [
        ...questions.filter((q) => q.status === "X"),
        ...questions.filter((q) => q.status === "TRI"),
      ];
      const weakTopicSet = new Set<string>();
      missedSorted.forEach((q) => {
        const t = (q.detailTopic || q.unitName || "").trim();
        if (t && weakTopicSet.size < 5) {
          weakTopicSet.add(t);
        }
      });
      const weakTopics = Array.from(weakTopicSet);

      // 12. 데이터 기반 자동 종합 코멘트 생성 (오답수정 문구 제외, 교과역량 반영)
      const studentName = studentObj?.name || "학생";
      const diffVsAvg = roundScore(initTotalScore - cohortAvgInit);
      const commentParts: string[] = [];

      if (validSampleCount >= 2) {
        if (diffVsAvg >= 8) {
          commentParts.push(
            `${studentName} 학생은 이번 ${evalKindLabel}에서 ${fmtScore(initTotalScore)}점을 기록하며 응시자 평균(${fmtScore(cohortAvgInit)}점) 대비 +${fmtScore(diffVsAvg)}점 높은 우수한 성취도를 보였습니다.`
          );
        } else if (diffVsAvg >= -5) {
          commentParts.push(
            `${studentName} 학생은 이번 ${evalKindLabel}에서 ${fmtScore(initTotalScore)}점(응시자 평균 ${fmtScore(cohortAvgInit)}점)으로 과정 내 핵심 개념을 안정적으로 소화하고 있습니다.`
          );
        } else {
          commentParts.push(
            `${studentName} 학생은 이번 ${evalKindLabel}에서 ${fmtScore(initTotalScore)}점(응시자 평균 ${fmtScore(cohortAvgInit)}점)을 기록하여 주요 개념 재점검과 대표 유형 복습이 필요한 시점입니다.`
          );
        }
      } else {
        commentParts.push(
          `${studentName} 학생은 이번 ${evalKindLabel}(총 ${questions.length}문항)에서 ${fmtScore(initTotalScore)}점(완답 ${fullCorrectCount}문항)의 성취도를 기록하였습니다.`
        );
      }

      if (bestComp && worstComp) {
        commentParts.push(
          `5대 교과 역량 중 '${bestComp}' 역량의 성취도가 돋보이며, 상대적으로 득점률이 낮았던 '${worstComp}' 역량 문항을 집중 연습하면 균형 잡힌 성장이 가능합니다.`
        );
      } else if (bestComp && !worstComp) {
        commentParts.push(
          `출제된 모든 교과 역량 영역에서 고르게 높은 성취율을 유지하고 있습니다.`
        );
      }

      if (killerSolvedQuestions.length > 0 && mistakeQuestions.length === 0) {
        commentParts.push(
          `기본 문항에서의 실수 없이 고난도 심화 문항(${killerSolvedQuestions.map((q) => `${q.qNum}번`).join(", ")})까지 정확히 해결하여 심화 문제 해결력이 매우 탄탄합니다.`
        );
      } else if (killerSolvedQuestions.length > 0 && mistakeQuestions.length > 0) {
        commentParts.push(
          `고난도 문항(${killerSolvedQuestions.map((q) => `${q.qNum}번`).join(", ")})을 해결할 만큼 사고력이 우수하나, 기본 문항(${mistakeQuestions.map((q) => `${q.qNum}번`).join(", ")})에서 아쉬운 감점이 있어 검산 습관을 보완하면 큰 폭의 성적 향상이 기대됩니다.`
        );
      } else if (mistakeQuestions.length > 0) {
        commentParts.push(
          `핵심 기본 문항(${mistakeQuestions.map((q) => `${q.qNum}번`).join(", ")})에서의 실수를 우선 줄이고 보완 핵심유형을 다시 점검할 것을 권장합니다.`
        );
      }

      const autoComment = commentParts.join(" ");

      let savedComment = "";
      if (typeof window !== "undefined") {
        try {
          savedComment =
            localStorage.getItem(`logica_eval_report_comment_${targetAssignId}`) || "";
        } catch {}
      }

      const rawExamDate = exMaster?.exam_date || assign.created_at;
      const reportDate = rawExamDate
        ? new Date(rawExamDate).toLocaleDateString("ko-KR")
        : "-";
      const courseBadge =
        exMaster?.sub_title ||
        (exMaster?.major_grade && exMaster.major_grade !== "공통 과정"
          ? exMaster.major_grade
          : "") ||
        evalKindLabel;

      const stateObj: EvalReportState = {
        assignmentId: targetAssignId,
        evalKind,
        evalKindLabel,
        hideQuestionPoints,
        examTitle: exMaster?.title || evalKindLabel,
        courseBadge,
        studentName,
        studentSchoolGrade: [studentObj?.school, studentObj?.grade].filter(Boolean).join(" "),
        className,
        reportDate,
        totalMainQuestions: questions.length,
        totalSubItems: items.length,
        initTotalScore,
        cohortAvgInit,
        cohortSampleCount: validSampleCount,
        fullCorrectCount,
        partialCount,
        wrongCount,
        bestComp,
        worstComp,
        questions,
        compRows,
        diffRows,
        hasKillerQuestions,
        mistakeQuestions,
        killerSolvedQuestions,
        weakTopics,
        autoComment,
      };

      setReportData(stateObj);
      setCustomComment(savedComment.trim() ? savedComment : autoComment);
      setIsLoading(false);
    } catch (err: any) {
      setErrorMsg(err?.message || "리포트 생성 중 알 수 없는 오류가 발생했습니다.");
      setIsLoading(false);
    }
  };

  const renderCharts = (data: EvalReportState) => {
    Chart.defaults.font.family = "'Pretendard', sans-serif";
    Chart.defaults.font.weight = "bold";

    if (compChartRef.current) {
      chartInstances.current.comp?.destroy();

      chartInstances.current.comp = new Chart(compChartRef.current, {
        type: "bar",
        data: {
          labels: data.compRows.map((c) => c.name),
          datasets: [
            {
              label: "내 성취율(%)",
              data: data.compRows.map((c) => (c.qCount > 0 ? c.initPct : null)),
              backgroundColor: "#1e493b",
              borderRadius: 4,
              barThickness: 15,
            },
            {
              label: "응시 평균(%)",
              data: data.compRows.map((c) => (c.qCount > 0 ? c.cohortPct : null)),
              backgroundColor: "#94a3b8",
              borderRadius: 4,
              barThickness: 15,
            },
          ],
        },
        options: {
          devicePixelRatio: 4,
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          layout: {
            padding: { top: 2, bottom: 2, left: 2, right: 4 },
          },
          plugins: {
            legend: {
              display: true,
              position: "top",
              labels: { boxWidth: 9, boxHeight: 9, padding: 10, font: { size: 9.5, weight: "bold" } },
            },
          },
          scales: {
            y: {
              min: 0,
              max: 100,
              ticks: { stepSize: 25, font: { size: 8.5 } },
              grid: { color: "#f1f5f9" },
            },
            x: {
              ticks: {
                font: { size: 9.5, weight: "bold" },
                maxRotation: 0,
                minRotation: 0,
                autoSkip: false,
              },
              grid: { display: false },
            },
          },
        },
      });
    }

    if (diffChartRef.current) {
      chartInstances.current.diff?.destroy();
      const activeDiffRows = data.diffRows.filter((d) => d.qCount > 0);
      const rowsForChart = activeDiffRows.length > 0 ? activeDiffRows : data.diffRows;

      chartInstances.current.diff = new Chart(diffChartRef.current, {
        type: "bar",
        data: {
          labels: rowsForChart.map((d) => [d.label, d.axisRange]),
          datasets: [
            {
              label: "내 성취율(%)",
              data: rowsForChart.map((d) => d.initPct),
              backgroundColor: rowsForChart.map((d) =>
                d.key === "BASIC" ? "#0f766e" : d.key === "MID" ? "#1e3a8a" : "#7c3aed"
              ),
              borderRadius: 4,
              barThickness: 20,
            },
            {
              label: "응시 평균(%)",
              data: rowsForChart.map((d) => d.cohortPct),
              backgroundColor: "#cbd5e1",
              borderRadius: 4,
              barThickness: 20,
            },
          ],
        },
        options: {
          devicePixelRatio: 4,
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          layout: {
            padding: { top: 2, bottom: 2, left: 2, right: 4 },
          },
          plugins: {
            legend: {
              display: true,
              position: "top",
              labels: { boxWidth: 9, boxHeight: 9, padding: 10, font: { size: 9.5, weight: "bold" } },
            },
          },
          scales: {
            y: {
              min: 0,
              max: 100,
              ticks: { stepSize: 25, font: { size: 8.5 } },
              grid: { color: "#f1f5f9" },
            },
            x: {
              ticks: {
                font: { size: 9, weight: "bold", lineHeight: 1.15 },
                maxRotation: 0,
                minRotation: 0,
              },
              grid: { display: false },
            },
          },
        },
      });
    }
  };

  const renderQuestionTable = (slice: MainQuestionAnalysis[]) => {
    if (!reportData || slice.length === 0) return null;
    const isDenseCols = slice.length > 11;
    const hidePoints = reportData.hideQuestionPoints;
    const thirdRowHeader = hidePoints ? "정답률" : "배점·정답률";

    return (
      <table className="w-full table-fixed border-collapse">
        <tbody>
          <tr>
            <td className="border border-slate-300 text-center py-1 px-1 text-[10.5px] font-extrabold bg-slate-100 text-slate-700 w-[9.5%]">
              문항
            </td>
            {slice.map((q) => (
              <td
                key={`num-${q.qNum}`}
                className="border border-slate-300 text-center py-1 px-0.5 text-[11px] font-extrabold bg-slate-50 text-slate-800"
              >
                <span>{q.qNum}</span>
                {q.subCount > 1 && (
                  <span className="text-[8.5px] text-slate-400 font-bold ml-0.5">
                    ({q.subCount})
                  </span>
                )}
              </td>
            ))}
          </tr>
          <tr>
            <td className="border border-slate-300 text-center py-1 px-1 text-[10px] font-bold bg-slate-50 text-slate-600 align-middle">
              교과역량
            </td>
            {slice.map((q) => (
              <td
                key={`comp-${q.qNum}`}
                title={`주역량: ${q.competencies[0]}${
                  q.competencies[1] ? ` / 보조역량: ${q.competencies[1]}` : ""
                }${q.unitName ? ` · ${q.unitName}` : ""}${
                  q.detailTopic ? ` > ${q.detailTopic}` : ""
                }`}
                className="border border-slate-300 text-center py-1 px-0.5 whitespace-nowrap tracking-tighter align-middle"
              >
                <div className="flex flex-col items-center justify-center leading-[1.15] gap-[1.5px]">
                  {q.competencies.map((comp, idx) => (
                    <span
                      key={comp}
                      className={`${COMPETENCY_META[comp].textCls} ${
                        idx === 0
                          ? isDenseCols
                            ? "text-[9.5px] font-black"
                            : "text-[10.5px] font-black"
                          : isDenseCols
                          ? "text-[7.5px] font-semibold opacity-80"
                          : "text-[8px] font-semibold opacity-80"
                      }`}
                    >
                      {comp}
                    </span>
                  ))}
                </div>
              </td>
            ))}
          </tr>
          <tr>
            <td className="border border-slate-300 text-center py-1 px-1 text-[10px] font-bold bg-slate-50 text-slate-600">
              {thirdRowHeader}
            </td>
            {slice.map((q) => {
              const tierColor =
                q.diffTier === "KILLER"
                  ? "text-violet-700 bg-violet-50/40"
                  : q.diffTier === "BASIC"
                  ? "text-teal-700"
                  : "text-slate-600";
              const rightTag = `${q.questionAccPct}%`;
              const cellText = hidePoints ? rightTag : `${fmtScore(q.maxScore)}점·${rightTag}`;
              const tooltipText = hidePoints
                ? `전체 문항 정답률 ${q.questionAccPct}%`
                : `배점 ${fmtScore(q.maxScore)}점 / 전체 문항 정답률 ${q.questionAccPct}%`;
              return (
                <td
                  key={`acc-${q.qNum}`}
                  title={tooltipText}
                  className={`border border-slate-300 text-center py-1 px-0.5 font-bold whitespace-nowrap tracking-tighter ${
                    isDenseCols ? "text-[8.5px]" : "text-[9.5px]"
                  } ${tierColor}`}
                >
                  {cellText}
                </td>
              );
            })}
          </tr>
          <tr>
            <td className="border border-slate-300 text-center py-1 px-1 text-[10.5px] font-extrabold bg-slate-50 text-slate-700">
              결과
            </td>
            {slice.map((q) => {
              if (q.status === "O") {
                return (
                  <td
                    key={`res-${q.qNum}`}
                    className="border border-slate-300 text-center py-0.5 text-[14px] leading-tight font-black text-emerald-600 bg-emerald-50/60"
                  >
                    ○
                  </td>
                );
              }
              if (q.status === "TRI") {
                return (
                  <td
                    key={`res-${q.qNum}`}
                    title={`부분 득점 (${fmtScore(q.initEarned)} / ${fmtScore(q.maxScore)}점)`}
                    className="border border-slate-300 text-center py-0.5 text-[13px] leading-tight font-black text-amber-500 bg-amber-50/60"
                  >
                    △
                  </td>
                );
              }
              return (
                <td
                  key={`res-${q.qNum}`}
                  className="border border-slate-300 text-center py-0.5 text-[14px] leading-tight font-black text-rose-500 bg-rose-50/60"
                >
                  ×
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    );
  };

  const splitQuestionRows = (qs: MainQuestionAnalysis[]) => {
    if (qs.length <= 12) return [qs];
    const half = Math.ceil(qs.length / 2);
    return [qs.slice(0, half), qs.slice(half)];
  };

  const scoreDiff = reportData
    ? roundScore(reportData.initTotalScore - reportData.cohortAvgInit)
    : 0;

  return (
    <div className="min-h-screen w-full bg-[#e2e8f0] flex flex-col items-center custom-scroll font-pretendard">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 210mm !important;
            height: 297mm !important;
            overflow: hidden !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .min-h-screen {
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
            min-height: 0 !important;
            height: 297mm !important;
            display: block !important;
          }
          .no-print { display: none !important; }
          .a4-single-page {
            width: 210mm !important;
            height: 297mm !important;
            max-height: 297mm !important;
            margin: 0 !important;
            padding: 9mm 13mm !important;
            box-sizing: border-box !important;
            box-shadow: none !important;
            border: none !important;
            page-break-after: auto !important;
            break-after: auto !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            overflow: hidden !important;
          }
        }

        .a4-single-page {
          width: 210mm;
          height: 297mm;
          max-height: 297mm;
          background: white;
          margin: 1.5rem auto;
          padding: 9mm 13mm;
          box-sizing: border-box;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
      `,
        }}
      />

      {/* 플로팅 액션 바 */}
      <div className="fixed bottom-8 right-8 z-50 flex items-center gap-2.5 no-print">
        {reportData && (
          <button
            type="button"
            onClick={() => setIsEditingComment((v) => !v)}
            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-extrabold px-5 py-3 rounded-full shadow-xl flex items-center gap-1.5 text-sm transition-transform hover:scale-105"
          >
            ✏️ {isEditingComment ? "코멘트 편집 완료" : "종합 코멘트 수정"}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setIsEditingComment(false);
            setTimeout(() => window.print(), 60);
          }}
          className="bg-[#1e493b] hover:bg-[#122e25] text-white font-extrabold px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 text-sm transition-transform hover:scale-105"
        >
          🖨️ 리포트 인쇄 (PDF)
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          className="bg-slate-700 hover:bg-slate-900 text-white font-extrabold px-5 py-3 rounded-full shadow-2xl flex items-center gap-1.5 text-sm transition-transform hover:scale-105"
        >
          ✖ 창닫기
        </button>
      </div>

      {/* 로딩 및 오류 화면 */}
      {isLoading && (
        <div className="fixed inset-0 bg-white z-[10000] flex flex-col items-center justify-center no-print">
          <div className="animate-spin rounded-full h-14 w-14 border-t-4 border-b-4 border-[#1e493b] mb-4"></div>
          <h2 className="text-lg font-bold text-slate-700">
            평가 데이터를 분석하여 A4 1페이지 리포트를 생성하고 있습니다...
          </h2>
        </div>
      )}

      {!isLoading && errorMsg && (
        <div className="fixed inset-0 bg-white z-[10000] flex flex-col items-center justify-center p-6 no-print">
          <div className="bg-rose-50 border border-rose-200 p-8 rounded-2xl max-w-xl text-center shadow-lg">
            <h2 className="text-xl font-black text-rose-600 mb-3">🚨 리포트 생성 실패</h2>
            <p className="text-slate-600 text-sm bg-white p-4 rounded-lg border border-slate-200 whitespace-pre-wrap text-left font-medium">
              {errorMsg}
            </p>
            <button
              type="button"
              onClick={() => window.close()}
              className="mt-5 px-6 py-2 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-900 text-sm"
            >
              창 닫기
            </button>
          </div>
        </div>
      )}

      {/* A4 1페이지 완결형 본문 */}
      {reportData && !isLoading && (
        <div className="a4-single-page relative">
          {/* 상단 헤더 */}
          <header className="border-b-[3px] border-[#1e493b] pb-2.5 mb-3 flex justify-between items-end shrink-0">
            <div className="min-w-0 pr-4">
              <h1 className="text-[28px] font-black text-[#1e493b] tracking-tight leading-none flex items-center gap-2.5">
                <img
                  src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png"
                  alt="Logica 로고"
                  className="h-7 object-contain"
                />
                <span className="font-light">{reportData.evalKindLabel} 분석 리포트</span>
              </h1>
              <div className="flex items-center gap-2 mt-1.5 text-xs font-bold text-slate-500 truncate">
                <span>{reportData.reportDate}</span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-700 truncate">{reportData.examTitle}</span>
              </div>
            </div>

            <div className="text-right flex flex-col items-end shrink-0">
              <div className="text-lg font-extrabold text-slate-800 leading-tight">
                <span className="text-[#1e493b] text-[21px]">{reportData.studentName}</span> 학생
                {reportData.studentSchoolGrade && (
                  <span className="text-xs font-bold text-slate-400 ml-1.5">
                    ({reportData.studentSchoolGrade})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-[11px] font-bold text-slate-500">
                {reportData.className && (
                  <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">
                    {reportData.className}
                  </span>
                )}
                <span className="bg-[#1e493b]/10 text-[#1e493b] px-2 py-0.5 rounded">
                  과정: {reportData.courseBadge}
                </span>
              </div>
            </div>
          </header>

          <main className="flex-1 flex flex-col gap-3 min-h-0">
            {/* 1. 메인 문항별 상세 채점표 */}
            <section className="shrink-0">
              <div className="flex items-center justify-between mb-1.5 border-b-2 border-slate-800 pb-1">
                <h2 className="text-[14px] font-black text-slate-800 flex items-center gap-1.5">
                  <span>문항별 상세 채점 결과</span>
                  <span className="text-[11px] font-bold text-slate-500">
                    (메인 {reportData.totalMainQuestions}문항
                    {reportData.totalSubItems > reportData.totalMainQuestions
                      ? ` · 세부 ${reportData.totalSubItems}문항`
                      : ""}
                    )
                  </span>
                </h2>
              </div>

              <div className="space-y-1.5">
                {splitQuestionRows(reportData.questions).map((rowSlice, idx) => (
                  <div
                    key={`qtable-${idx}`}
                    className="w-full overflow-hidden border border-slate-300 rounded"
                  >
                    {renderQuestionTable(rowSlice)}
                  </div>
                ))}
              </div>
            </section>

            {/* 2. 중단 핵심 분석 영역 (좌측 상하 2단 요약 + 우측 2열 5대 교과역량 & 체감난이도) */}
            <section className="flex gap-3 flex-1 min-h-0">
              {/* 좌측 컬럼: 짧은 짙은 녹색 점수 카드 + 정오 요약·5대 역량 가이드 카드 */}
              <div className="w-[146px] shrink-0 flex flex-col gap-2.5 min-h-0">
                {/* 상단: 컴팩트 짙은 녹색 점수 카드 */}
                <div className="bg-gradient-to-br from-[#1e493b] to-[#0f251d] text-white rounded-xl px-3 py-3.5 flex flex-col items-center shadow-md relative overflow-hidden shrink-0">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-white opacity-5 rounded-full -mr-8 -mt-8"></div>

                  <div className="text-center w-full relative z-10">
                    <span className="text-[10px] font-bold text-emerald-100/75 block">
                      Logica {reportData.evalKindLabel}
                    </span>
                    <span className="text-[13px] font-black text-white block tracking-tight mt-0.5">
                      종합 성적
                    </span>
                  </div>

                  <div className="flex items-baseline justify-center whitespace-nowrap my-2.5 relative z-10">
                    <span className="text-[40px] font-black leading-none drop-shadow-md tracking-tighter">
                      {fmtScore(reportData.initTotalScore)}
                    </span>
                    <span className="text-sm font-bold ml-1 text-emerald-100/85">점</span>
                  </div>

                  <div className="w-full bg-white/10 border border-white/10 rounded-lg px-2.5 py-2 relative z-10">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-emerald-100/85">응시 평균</span>
                      <span className="text-[13.5px] font-black text-white whitespace-nowrap">
                        {fmtScore(reportData.cohortAvgInit)}점
                      </span>
                    </div>
                    {reportData.cohortSampleCount >= 2 && (
                      <div className="text-right mt-0.5">
                        <span
                          className={`text-[9.5px] font-extrabold ${
                            scoreDiff > 0
                              ? "text-emerald-300"
                              : scoreDiff < 0
                              ? "text-rose-200"
                              : "text-slate-200"
                          }`}
                        >
                          {scoreDiff > 0
                            ? `평균 대비 +${fmtScore(scoreDiff)}점 ▲`
                            : scoreDiff < 0
                            ? `평균 대비 ${fmtScore(scoreDiff)}점`
                            : "응시 평균과 동일"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 하단: 문항 정오 요약 & 5대 교과 역량 안내 카드 */}
                <div className="flex-1 bg-slate-50/90 border border-slate-200 rounded-xl p-2.5 flex flex-col justify-between min-h-0">
                  <div>
                    <div className="text-[10.5px] font-extrabold text-slate-700 mb-1.5 flex items-center justify-between">
                      <span>📌 채점 요약</span>
                      <span className="text-[9.5px] font-bold text-slate-400">
                        총 {reportData.totalMainQuestions}문항
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-center">
                      <div className="bg-white border border-emerald-200 rounded-lg py-1">
                        <div className="text-[9px] font-extrabold text-emerald-600">○ 정답</div>
                        <div className="text-[12px] font-black text-slate-800">
                          {reportData.fullCorrectCount}
                        </div>
                      </div>
                      <div className="bg-white border border-amber-200 rounded-lg py-1">
                        <div className="text-[9px] font-extrabold text-amber-600">△ 부분</div>
                        <div className="text-[12px] font-black text-slate-800">
                          {reportData.partialCount}
                        </div>
                      </div>
                      <div className="bg-white border border-rose-200 rounded-lg py-1">
                        <div className="text-[9px] font-extrabold text-rose-500">× 오답</div>
                        <div className="text-[12px] font-black text-slate-800">
                          {reportData.wrongCount}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-200/90 pt-2 mt-2">
                    <div className="text-[10px] font-extrabold text-slate-700 mb-1.5">
                      🧭 5대 교과 역량 안내
                    </div>
                    <div className="space-y-1.5">
                      {COMPETENCY_ORDER.map((compKey) => {
                        const meta = COMPETENCY_META[compKey];
                        return (
                          <div key={compKey} className="leading-tight">
                            <div className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dotCls}`}></span>
                              <span className={`text-[9.5px] font-extrabold ${meta.textCls}`}>
                                {compKey}
                              </span>
                            </div>
                            <div className="text-[8.5px] font-semibold text-slate-500 pl-2.5 truncate">
                              {meta.desc}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* 우측 2컬럼: 좌(5대 교과 역량별 성취 분석) + 우(체감 난이도 & 문항 하이라이트) */}
              <div className="flex-1 min-w-0 grid grid-cols-2 gap-3 min-h-0">
                {/* 좌측 카드: 5대 교과 역량별 성취 분석 */}
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm flex flex-col min-h-0 overflow-hidden">
                  <div className="flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded mb-2 shrink-0 gap-1">
                    <h3 className="text-[12.5px] font-extrabold text-slate-800 truncate">
                      교과 역량별 성취 분석
                    </h3>
                    <span className="text-[9.5px] font-bold text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200 shrink-0 whitespace-nowrap">
                      주·보조 역량 반영
                    </span>
                  </div>

                  <table className="w-full table-fixed text-center border-collapse mb-2.5 shrink-0">
                    <thead className="bg-slate-100 text-slate-600 border-y border-slate-300 text-[10px]">
                      <tr>
                        <th className="py-1.5 text-left pl-2">교과 역량</th>
                        <th className="py-1.5 w-[34px]">만점</th>
                        <th className="py-1.5 w-[34px]">평균</th>
                        <th className="py-1.5 w-[34px] text-[#1e493b]">획득</th>
                        <th className="py-1.5 w-[44px] text-emerald-600">성취율</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-700 text-[10.5px]">
                      {reportData.compRows.map((c) => {
                        const meta = COMPETENCY_META[c.name];
                        const hasItems = c.qCount > 0;
                        return (
                          <tr key={c.name}>
                            <td className="py-1.5 text-left pl-2 pr-1 whitespace-nowrap">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${meta.dotCls}`}></span>
                              <span className="text-slate-800 font-extrabold">{c.name}</span>
                              <span className="text-[9.5px] text-slate-400 ml-1">
                                ({c.qCount}문항)
                              </span>
                            </td>
                            <td className="py-1.5 text-slate-400 font-medium">
                              {hasItems ? fmtScore(c.maxScore) : "-"}
                            </td>
                            <td className="py-1.5 text-slate-400 font-medium">
                              {hasItems ? fmtScore(c.cohortAvg) : "-"}
                            </td>
                            <td className="py-1.5 bg-[#1e493b]/5 text-[#1e493b] font-black">
                              {hasItems ? fmtScore(c.initEarned) : "-"}
                            </td>
                            <td className="py-1.5 font-extrabold">
                              {hasItems ? (
                                <span className="text-emerald-600">{c.initPct}%</span>
                              ) : (
                                <span className="text-[9.5px] text-slate-300">미출제</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="flex-1 relative min-h-[150px] mt-auto w-full">
                    <canvas ref={compChartRef}></canvas>
                  </div>
                </div>

                {/* 우측 카드: 전체 문항 정답률 기반 체감 난이도 성취 분석 */}
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm flex flex-col min-h-0 overflow-hidden">
                  <div className="flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded mb-2 shrink-0 gap-1">
                    <h3 className="text-[12.5px] font-extrabold text-slate-800 whitespace-nowrap">
                      체감 난이도별 성취 분석
                    </h3>
                    <span className="text-[9.5px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 shrink-0 whitespace-nowrap">
                      문항 정답률 기준
                    </span>
                  </div>

                  <table className="w-full table-fixed text-center border-collapse mb-2 shrink-0">
                    <thead className="bg-slate-100 text-slate-600 border-y border-slate-300 text-[10px]">
                      <tr>
                        <th className="py-1.5 text-left pl-2">체감 구간</th>
                        <th className="py-1.5 w-[34px]">만점</th>
                        <th className="py-1.5 w-[34px]">평균</th>
                        <th className="py-1.5 w-[34px] text-[#1e493b]">획득</th>
                        <th className="py-1.5 w-[44px] text-emerald-600">성취율</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-700 text-[10.5px]">
                      {reportData.diffRows.map((d) => (
                        <tr key={d.key}>
                          <td className="py-1.5 text-left pl-2 pr-1 whitespace-nowrap">
                            <span className="text-slate-800 font-extrabold">{d.label}</span>
                            <span className="text-[9.5px] text-slate-400 font-bold ml-1">
                              ({d.qCount}문항)
                            </span>
                          </td>
                          <td className="py-1.5 text-slate-400 font-medium">
                            {d.qCount > 0 ? fmtScore(d.maxScore) : "-"}
                          </td>
                          <td className="py-1.5 text-slate-400 font-medium">
                            {d.qCount > 0 ? fmtScore(d.cohortAvg) : "-"}
                          </td>
                          <td className="py-1.5 bg-[#1e493b]/5 text-[#1e493b] font-black">
                            {d.qCount > 0 ? fmtScore(d.initEarned) : "-"}
                          </td>
                          <td className="py-1.5 text-emerald-600 font-extrabold">
                            {d.qCount > 0 ? `${d.initPct}%` : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* 실수 / 킬러 문항 하이라이트 스트립 (막대그래프 위로 배치) */}
                  <div className="space-y-1.5 mb-2.5 shrink-0">
                    <div className="bg-amber-50/80 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-extrabold text-amber-800 shrink-0">
                        ⚠️ 아쉬운 실수
                      </span>
                      <div className="flex flex-wrap justify-end gap-1 min-w-0">
                        {reportData.mistakeQuestions.length === 0 ? (
                          <span className="text-[10px] font-bold text-emerald-700">
                            기본 문항 실수 없음 ✨
                          </span>
                        ) : (
                          reportData.mistakeQuestions.map((q) => (
                            <span
                              key={`mis-${q.qNum}`}
                              className="px-1.5 py-0.5 rounded bg-white border border-amber-300 text-amber-800 text-[9.5px] font-extrabold whitespace-nowrap"
                            >
                              {q.qNum}번({q.questionAccPct}%)
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="bg-violet-50/80 border border-violet-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-extrabold text-violet-800 shrink-0">
                        🌟 고난도 정복
                      </span>
                      <div className="flex flex-wrap justify-end gap-1 min-w-0">
                        {!reportData.hasKillerQuestions ? (
                          <span className="text-[10px] font-bold text-slate-500">
                            해당 시험 고난도(40%↓) 문항 없음
                          </span>
                        ) : reportData.killerSolvedQuestions.length === 0 ? (
                          <span className="text-[10px] font-bold text-slate-500">
                            심화 문항 집중 도전 권장
                          </span>
                        ) : (
                          reportData.killerSolvedQuestions.map((q) => (
                            <span
                              key={`kil-${q.qNum}`}
                              className="px-1.5 py-0.5 rounded bg-white border border-violet-300 text-violet-800 text-[9.5px] font-extrabold whitespace-nowrap"
                            >
                              {q.qNum}번({q.questionAccPct}%)
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 하단 체감 난이도별 막대그래프 */}
                  <div className="flex-1 relative min-h-[120px] mt-auto w-full">
                    <canvas ref={diffChartRef}></canvas>
                  </div>
                </div>
              </div>
            </section>

            {/* 3. 하단 보완 세부유형 태그 & 종합 평가 코멘트 */}
            <section className="shrink-0 bg-slate-50/90 border-2 border-[#1e493b]/20 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-200/80 pb-1.5">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <span className="px-2 py-0.5 bg-[#1e493b] text-white rounded-full text-[10px] font-black shrink-0">
                    종합 분석
                  </span>
                  <span className="text-[10.5px] font-extrabold text-slate-600 shrink-0">
                    보완 핵심유형:
                  </span>
                  {reportData.weakTopics.length === 0 ? (
                    <span className="text-[10.5px] font-bold text-emerald-700">
                      전 유형 고른 성취로 특이 취약 유형 없음 ✨
                    </span>
                  ) : (
                    reportData.weakTopics.map((topic, idx) => (
                      <span
                        key={`wt-${idx}`}
                        className="px-2 py-0.5 bg-white border border-slate-300 rounded-md text-[10px] font-bold text-slate-700 max-w-full break-keep"
                        title={topic}
                      >
                        #{topic}
                      </span>
                    ))
                  )}
                </div>

                {isEditingComment && (
                  <button
                    type="button"
                    onClick={resetCommentToAuto}
                    className="text-[10px] font-bold text-slate-500 hover:text-rose-600 underline no-print"
                  >
                    자동 생성 문구로 초기화
                  </button>
                )}
              </div>

              {isEditingComment ? (
                <textarea
                  rows={4}
                  value={customComment}
                  onChange={(e) => handleCommentChange(e.target.value)}
                  className="w-full bg-white border border-emerald-400 rounded-lg p-2 text-[11.5px] font-bold text-slate-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y no-print"
                  placeholder="인쇄될 종합 평가 코멘트를 입력하세요... (Enter로 줄바꿈 가능)"
                />
              ) : null}

              <div
                onClick={() => {
                  if (!isEditingComment) setIsEditingComment(true);
                }}
                title="클릭하여 종합 코멘트 수정"
                className={`text-[11.5px] font-bold text-slate-700 leading-[1.58] whitespace-pre-wrap break-keep cursor-pointer print:cursor-default ${
                  isEditingComment ? "hidden print:block" : "block"
                }`}
              >
                {customComment || reportData.autoComment}
              </div>
            </section>
          </main>

          <footer className="mt-2.5 pt-2 border-t border-slate-200 text-center text-[10.5px] text-slate-400 font-bold shrink-0">
            LOGICA. 깊고 단단한 심화 수학.
          </footer>
        </div>
      )}
    </div>
  );
}

export default function EvalReportPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center font-bold text-slate-500">
          리포트 로딩 중...
        </div>
      }
    >
      <EvalReportContent />
    </Suspense>
  );
}
