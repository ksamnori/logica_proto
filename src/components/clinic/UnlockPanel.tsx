"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { supabase, CLINIC_ROOM } from "@/lib/supabase";
import { getInstructorName } from "@/app/clinic/ta/taAccess";
let mathJaxInitStarted = false;

const initMathJax = () => {
  if (typeof window === "undefined" || mathJaxInitStarted || document.getElementById("mathjax-script")) return;
  mathJaxInitStarted = true;
  (window as any).MathJax = {
    tex: { inlineMath: [["$", "$"], ["\(", "\)"]], displayMath: [["51986", "51986"], ["\[", "\]"]] },
    chtml: { displayAlign: "left" },
  };
  const script = document.createElement("script");
  script.id = "mathjax-script";
  script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
  script.async = true;
  document.head.appendChild(script);
};

const MathText = React.memo(function MathText({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise && ref.current) {
      mj.typesetPromise([ref.current]).catch((err: any) => console.error("MathJax 에러:", err));
    }
  }, [html]);
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

export interface VerifiedGradingRecord {
  assignmentId: number;
  studentId: string;
  studentName: string;
  examTitle: string;
  finalScore: number;
  verifierName: string;
  verifierClientId?: string;
  verifiedAt: string;
}

interface UnlockPanelProps {
  verifierName?: string;
  verifierClientId?: string;
  compact?: boolean;
  /**
   * /supervisor 처럼 상위 훅(useSupervisorData)에서 이미 제출완료 목록을 폴링 중인 경우
   * 전달하면 UnlockPanel 내부 중복 폴링 타이머를 돌리지 않아 DB 부하를 절감합니다.
   */
  externalPendingRows?: any[];
  onVerified?: (record: VerifiedGradingRecord) => void;
}

const VERIFIED_HISTORY_STORAGE_KEY = "logica_verified_grading_history_v1";

function roundScore(val: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 10) / 10;
}

function calcScoreRatio(
  code: string | null | undefined,
  assignedScore: number,
  metaMap?: Record<string, any>
): { newEarned: number; isCorrectEq: boolean } {
  if (!code) return { newEarned: 0, isCorrectEq: false };
  const c = String(code).trim();
  if (!c) return { newEarned: 0, isCorrectEq: false };

  const meta = metaMap?.[c];
  let ratio = 0;
  let isCorrectEq = false;

  if (meta) {
    ratio = parseFloat(meta.score_ratio);
    if (isNaN(ratio)) ratio = 0;
    if (ratio > 1) ratio = ratio / 100;
    isCorrectEq =
      meta.is_correct === true ||
      String(meta.is_correct).toLowerCase() === "true" ||
      ["O", "TO", "RO", "a", "b", "c"].includes(c);
  } else {
    if (["O", "a", "b", "c"].includes(c)) {
      ratio = 1.0;
      isCorrectEq = true;
    } else if (c === "TO" || c === "RO") {
      ratio = 0.8;
      isCorrectEq = true;
    } else if (c === "q") {
      ratio = 0.5;
      isCorrectEq = false;
    }
  }

  const base = Number(assignedScore) || 0;
  const newEarned = Math.round((base * ratio + Number.EPSILON) * 1000) / 1000;
  return { newEarned, isCorrectEq };
}

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

function buildExamQuestionScoreMap(
  items: { question_id: any; sort_order?: number; assigned_score?: any }[],
  layoutSettings?: any,
  examType?: string,
  totalQuestionsFallback?: number
): { scoreByQuestionId: Map<string, number>; groupCount: number } {
  const mergedArrays = extractMergedQuestionGroups(layoutSettings);
  const customGroupMap = new Map<string, string>();
  mergedArrays.forEach((arr, idx) => {
    const gId = `custom_group_${idx}`;
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
    return { scoreByQuestionId, groupCount };
  }

  const sortedItems = [...items].sort(
    (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
  );
  const groupMap = new Map<string, { id: string; items: any[]; groupScore: number; subScore: number }>();
  const groups: { id: string; items: any[]; groupScore: number; subScore: number }[] = [];

  sortedItems.forEach((item, idx) => {
    const qidStr = String(item.question_id);
    const customGId = customGroupMap.get(qidStr);
    if (customGId) {
      let g = groupMap.get(customGId);
      if (!g) {
        g = { id: customGId, items: [], groupScore: 0, subScore: 0 };
        groupMap.set(customGId, g);
        groups.push(g);
      }
      g.items.push(item);
    } else {
      const g = { id: `single_${qidStr}_${idx}`, items: [item], groupScore: 0, subScore: 0 };
      groups.push(g);
    }
  });

  const groupCount = Math.max(1, groups.length);
  const equalGroupScore = 100 / groupCount;
  const forceEqualGroupScore = ["주간테스트", "주간클리닉", "단원평가", "총괄평가", "입학테스트"].includes(
    String(examType || "").trim()
  );

  let rawAssignedTotal = 0;
  let allHaveExplicitScore = true;
  sortedItems.forEach((it) => {
    const sc = Number(it.assigned_score);
    if (Number.isFinite(sc) && sc > 0) rawAssignedTotal += sc;
    else allHaveExplicitScore = false;
  });
  const canUseExplicitScores =
    !forceEqualGroupScore && allHaveExplicitScore && Math.abs(rawAssignedTotal - 100) < 0.5;

  groups.forEach((g) => {
    if (canUseExplicitScores) {
      let gSum = 0;
      g.items.forEach((it) => {
        const sc = Number(it.assigned_score) || equalGroupScore / (g.items.length || 1);
        gSum += sc;
        scoreByQuestionId.set(String(it.question_id), sc);
      });
      g.groupScore = gSum;
      g.subScore = gSum / (g.items.length || 1);
    } else {
      g.groupScore = equalGroupScore;
      g.subScore = equalGroupScore / (g.items.length || 1);
      g.items.forEach((it) => {
        scoreByQuestionId.set(String(it.question_id), g.subScore);
      });
    }
  });

  return { scoreByQuestionId, groupCount };
}

export function buildCompactGradingStatusTag(actorName: string, nowIso?: string): string {
  // student_answer.grading_status 컬럼이 varchar(20)인 환경에서도 22001 에러가 절대 나지 않도록 최대 19자로 압축
  // 형식: "완료(확인:"(6자) + 이름(최대 5자) + "|"(1자) + Base36초타임스탬프(6자) + ")"(1자) <= 19자
  const safeActor = (actorName || "선생님").replace(/[|)]/g, "").trim().slice(0, 5) || "선생님";
  const tsMs = nowIso ? new Date(nowIso).getTime() : Date.now();
  const ts36 = Math.floor((Number.isFinite(tsMs) ? tsMs : Date.now()) / 1000).toString(36);
  return `완료(확인:${safeActor}|${ts36})`;
}

export function parseVerifierFromGradingStatus(raw?: string | null): {
  verifierName: string | null;
  verifiedAt: string | null;
} {
  if (!raw) return { verifierName: null, verifiedAt: null };
  const m = String(raw).match(/확인:([^|)]+)(?:\|([^)]+))?/);
  if (!m) return { verifierName: null, verifiedAt: null };
  const verifierName = m[1]?.trim() || null;
  const rawTime = m[2]?.trim() || null;
  let verifiedAt: string | null = rawTime;
  if (rawTime && /^[0-9a-z]{5,8}$/i.test(rawTime)) {
    const sec = parseInt(rawTime, 36);
    if (Number.isFinite(sec) && sec > 1000000000) {
      verifiedAt = new Date(sec * 1000).toISOString();
    }
  }
  return {
    verifierName,
    verifiedAt,
  };
}

export function saveVerifiedRecordToLocalCache(rec: VerifiedGradingRecord) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(VERIFIED_HISTORY_STORAGE_KEY);
    const list: VerifiedGradingRecord[] = raw ? JSON.parse(raw) : [];
    const filtered = list.filter((x) => Number(x.assignmentId) !== Number(rec.assignmentId));
    filtered.unshift(rec);
    localStorage.setItem(VERIFIED_HISTORY_STORAGE_KEY, JSON.stringify(filtered.slice(0, 80)));
  } catch {}
}

export function readVerifiedRecordsFromLocalCache(): Record<number, VerifiedGradingRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(VERIFIED_HISTORY_STORAGE_KEY);
    const list: VerifiedGradingRecord[] = raw ? JSON.parse(raw) : [];
    const map: Record<number, VerifiedGradingRecord> = {};
    list.forEach((item) => {
      if (item && item.assignmentId) map[Number(item.assignmentId)] = item;
    });
    return map;
  } catch {
    return {};
  }
}

export default function UnlockPanel({
  verifierName,
  verifierClientId,
  compact = false,
  externalPendingRows,
  onVerified,
}: UnlockPanelProps) {
  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
  const [rows, setRows] = useState<any[]>([]);
  const [historyRows, setHistoryRows] = useState<VerifiedGradingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [resolvedVerifier, setResolvedVerifier] = useState<string>("선생님");

  // 상세 검수 모달 상태
  const [verifyingExam, setVerifyingExam] = useState<any | null>(null);
  const [verifyingAnswers, setVerifyingAnswers] = useState<any[]>([]);
  const [verificationOverrides, setVerificationOverrides] = useState<Record<string, boolean>>({});
  const [isVerifyingModalBusy, setIsVerifyingModalBusy] = useState(false);

  const isFetchingPendingRef = useRef(false);
  const isFetchingHistoryRef = useRef(false);
  const onVerifiedRef = useRef(onVerified);
  useEffect(() => {
    onVerifiedRef.current = onVerified;
  }, [onVerified]);

  useEffect(() => {
    initMathJax();
  }, []);

  useEffect(() => {
    if (verifierName && verifierName.trim()) {
      setResolvedVerifier(verifierName.trim());
      return;
    }
    if (typeof window !== "undefined") {
      const fromTa = localStorage.getItem("logica_ta_name")?.trim();
      const fromInst = localStorage.getItem("logica_instructor_name")?.trim();
      const fallback = getInstructorName()?.trim();
      setResolvedVerifier(fromTa || fromInst || fallback || "선생님");
    }
  }, [verifierName]);

  const unwrap = (v: any) => (Array.isArray(v) ? v[0] : v);

  // 🌟 상위(/supervisor)에서 이미 폴링된 대기 목록을 전달받으면 즉시 동기화 (중복 쿼리 제거)
  useEffect(() => {
    if (externalPendingRows !== undefined) {
      setRows(externalPendingRows);
    }
  }, [externalPendingRows]);

  // 🌟 평소 대기 탭에서는 가벼운 '제출완료' 단일 쿼리만 수행 (student_answer 대용량 테이블 조회 없음)
  const loadPending = useCallback(async () => {
    if (isFetchingPendingRef.current) return;
    isFetchingPendingRef.current = true;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("exam_assignment")
        .select("assignment_id, student_id, status, total_score, created_at, student(name), exam_master(title)")
        .eq("status", "제출완료")
        .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) throw error;
      setRows(data || []);
    } catch (e: any) {
      console.error("[잠금해제] 대기 목록 조회 실패", e);
    } finally {
      isFetchingPendingRef.current = false;
      setLoading(false);
    }
  }, []);

  // 🌟 '확인 기록' 탭을 열었을 때만 최근 24시간 내 확정 기록을 조회 (폴링 타이머에서 제외하여 DB 부하 원천 차단)
  const loadHistory = useCallback(async () => {
    if (isFetchingHistoryRef.current) return;
    isFetchingHistoryRef.current = true;
    setLoading(true);
    try {
      const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: confirmedData } = await supabase
        .from("exam_assignment")
        .select("assignment_id, student_id, status, total_score, created_at, student(name), exam_master(title)")
        .in("status", ["채점확정", "최종완료"])
        .gte("created_at", since24h)
        .order("created_at", { ascending: false })
        .limit(20);

      const confirmedList = confirmedData || [];
      const confirmedIds = confirmedList.map((r: any) => r.assignment_id).filter(Boolean);
      const answerVerifierMap: Record<number, { verifierName: string; verifiedAt: string }> = {};

      if (confirmedIds.length > 0) {
        // student_input(손글씨 이미지) 컬럼은 절대 조회하지 않고 가벼운 grading_status만 조회
        const { data: ansRows } = await supabase
          .from("student_answer")
          .select("exam_assignment_id, grading_status")
          .in("exam_assignment_id", confirmedIds)
          .like("grading_status", "완료(확인:%")
          .limit(60);

        (ansRows || []).forEach((a: any) => {
          const aid = Number(a.exam_assignment_id);
          if (answerVerifierMap[aid]) return;
          const parsed = parseVerifierFromGradingStatus(a.grading_status);
          if (parsed.verifierName) {
            answerVerifierMap[aid] = {
              verifierName: parsed.verifierName,
              verifiedAt: parsed.verifiedAt || "",
            };
          }
        });
      }

      const localCache = readVerifiedRecordsFromLocalCache();
      const mergedHistory: VerifiedGradingRecord[] = [];
      const seenIds = new Set<number>();

      confirmedList.forEach((r: any) => {
        const aid = Number(r.assignment_id);
        const dbMeta = answerVerifierMap[aid];
        const cached = localCache[aid];

        seenIds.add(aid);
        mergedHistory.push({
          assignmentId: aid,
          studentId: String(r.student_id || cached?.studentId || ""),
          studentName: unwrap(r.student)?.name || cached?.studentName || "학생",
          examTitle: unwrap(r.exam_master)?.title || cached?.examTitle || "-",
          finalScore: Number(r.total_score ?? cached?.finalScore ?? 0),
          verifierName: dbMeta?.verifierName || cached?.verifierName || "확인완료",
          verifiedAt: dbMeta?.verifiedAt || cached?.verifiedAt || r.created_at || new Date().toISOString(),
        });
      });

      Object.values(localCache).forEach((cached) => {
        if (!seenIds.has(Number(cached.assignmentId))) {
          seenIds.add(Number(cached.assignmentId));
          mergedHistory.push(cached);
        }
      });

      mergedHistory.sort(
        (a, b) => new Date(b.verifiedAt || 0).getTime() - new Date(a.verifiedAt || 0).getTime()
      );
      setHistoryRows(mergedHistory.slice(0, 25));
    } catch (e: any) {
      console.error("[잠금해제] 확인 기록 조회 실패", e);
    } finally {
      isFetchingHistoryRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 초기 로컬 캐시 즉시 반영 + DB 확정 내역 1회 동기화(상단 '확인 기록' 배지 카운트 표시용)
    const localCache = Object.values(readVerifiedRecordsFromLocalCache());
    if (localCache.length > 0) {
      setHistoryRows(localCache.slice(0, 25));
    }
    loadHistory();

    // externalPendingRows가 없는 경우(/clinic/ta/pad)에만 20초 주기로 가볍게 폴링 (화면이 보일 때만)
    let t: ReturnType<typeof setInterval> | null = null;
    if (externalPendingRows === undefined) {
      loadPending();
      t = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        loadPending();
      }, 20000);
    }

    const handleCustomVerified = (ev: Event) => {
      const detail = (ev as CustomEvent<VerifiedGradingRecord>).detail;
      if (detail?.assignmentId) {
        saveVerifiedRecordToLocalCache(detail);
        setRows((prev) => prev.filter((r) => Number(r.assignment_id) !== Number(detail.assignmentId)));
        setHistoryRows((prev) => {
          const filtered = prev.filter((x) => Number(x.assignmentId) !== Number(detail.assignmentId));
          return [detail, ...filtered].slice(0, 25);
        });
      }
    };
    const handleStudentSubmitted = () => {
      if (externalPendingRows === undefined) loadPending();
    };

    window.addEventListener("logica:grading-verified", handleCustomVerified);
    window.addEventListener("logica:student-submitted", handleStudentSubmitted);

    return () => {
      if (t) clearInterval(t);
      window.removeEventListener("logica:grading-verified", handleCustomVerified);
      window.removeEventListener("logica:student-submitted", handleStudentSubmitted);
    };
  }, [externalPendingRows, loadPending]);

  // '확인 기록' 탭을 클릭했을 때만 DB에서 최신 기록 1회 동기화
  useEffect(() => {
    if (activeTab === "history") {
      loadHistory();
    }
  }, [activeTab, loadHistory]);

  // 🌟 새 웹소켓 채널을 추가로 생성하지 않고, 현재 화면(수퍼바이저/조교패드)에 이미 연결된 채널을 재사용해 전송
  const broadcastVerificationToClinic = async (record: VerifiedGradingRecord, seat?: string | null) => {
    try {
      const myTenantId =
        (typeof window !== "undefined" && localStorage.getItem("logica_tenant_id")) || "hq";
      const channelName = `${CLINIC_ROOM}_${myTenantId}`;
      const existingCh = supabase
        .getChannels()
        .find((ch: any) => ch.topic === `realtime:${channelName}`);

      if (!existingCh) return;

      await existingCh.send({
        type: "broadcast",
        event: "ta_action",
        payload: {
          seat: seat || null,
          studentId: record.studentId,
          action: "force_refresh",
          timestamp: Date.now(),
        },
      });
      await existingCh.send({
        type: "broadcast",
        event: "ta_action",
        payload: {
          seat: seat || null,
          studentId: record.studentId,
          action: "grading_verified",
          assignmentId: record.assignmentId,
          studentName: record.studentName,
          examTitle: record.examTitle,
          finalScore: record.finalScore,
          verifierName: record.verifierName,
          taName: record.verifierName,
          taClientId: record.verifierClientId || "",
          verifiedAt: record.verifiedAt,
          timestamp: Date.now(),
        },
      });
    } catch (e) {
      console.error("채점 확인 브로드캐스트 오류:", e);
    }
  };

  const executeConfirmVerification = async (
    row: any,
    overrides: Record<string, boolean> = {},
    skipConfirmDialog = false
  ) => {
    const assignmentId = Number(row.assignment_id);
    const studentId = String(row.student_id || "");
    const studentName = unwrap(row.student)?.name || row.studentName || "학생";
    const examTitle = unwrap(row.exam_master)?.title || row.examTitle || "-";
    const actorName = resolvedVerifier || "선생님";

    if (!skipConfirmDialog) {
      if (
        !confirm(
          `[${studentName}] 학생의 채점을 확정하고 잠금을 풀까요?\n(최종 확인자: ${actorName})`
        )
      ) {
        return false;
      }
    }

    setBusyId(assignmentId);
    try {
      const nowIso = new Date().toISOString();
      const statusTag = buildCompactGradingStatusTag(actorName, nowIso);
      const hasOverrides = Object.keys(overrides).length > 0;

      let finalScore = Number(row.total_score ?? 0);

      if (hasOverrides) {
        // 🌟 오답 인정(override)이 있는 경우에만 점수 재계산 수행 (이때도 student_input 대용량 이미지는 제외하고 메타 컬럼만 조회)
        const [{ data: allAnswers }, { data: asgData }, { data: gcData }] = await Promise.all([
          supabase
            .from("student_answer")
            .select("answer_id, question_id, is_correct, grading_code, earned_score")
            .eq("exam_assignment_id", assignmentId),
          supabase
            .from("exam_assignment")
            .select("exam_id, total_score, exam_master(exam_type, total_questions, layout_settings)")
            .eq("assignment_id", assignmentId)
            .maybeSingle(),
          supabase
            .from("master_grading_code")
            .select("code, description, is_correct, score_ratio, admission_ratio"),
        ]);

        const gcMeta: Record<string, any> = {};
        gcData?.forEach((r: any) => {
          if (r.code) gcMeta[r.code] = r;
        });

        const em: any = Array.isArray(asgData?.exam_master)
          ? asgData?.exam_master[0]
          : asgData?.exam_master;
        const { data: examItems } = asgData?.exam_id
          ? await supabase
              .from("exam_item")
              .select("question_id, sort_order, assigned_score")
              .eq("exam_id", asgData.exam_id)
              .order("sort_order")
          : { data: [] as any[] };

        const totalAnsCount = allAnswers ? allAnswers.length : 0;
        const { scoreByQuestionId, groupCount } = buildExamQuestionScoreMap(
          examItems || [],
          em?.layout_settings,
          em?.exam_type,
          em?.total_questions || totalAnsCount || 1
        );
        const defaultQScore = 100 / (groupCount || totalAnsCount || 1);

        let totalScoreSum = 0;
        const updates: any[] = [];
        const toDeleteIncorrectRecords: any[] = [];

        if (allAnswers && totalAnsCount > 0) {
          for (const ans of allAnswers) {
            const isOverridden = overrides[ans.answer_id] !== undefined;
            const isCorrect = isOverridden ? overrides[ans.answer_id] : ans.is_correct;
            const qScore = scoreByQuestionId.get(String(ans.question_id)) ?? defaultQScore;
            const nextCode = isOverridden
              ? isCorrect
                ? "O"
                : "X"
              : ans.grading_code || (isCorrect ? "O" : "X");
            const { newEarned } = calcScoreRatio(nextCode, qScore, gcMeta);
            totalScoreSum += newEarned;

            if (isOverridden) {
              updates.push({
                answer_id: ans.answer_id,
                is_correct: isCorrect,
                grading_code: nextCode,
                earned_score: newEarned,
                grading_status: statusTag,
              });
              if (isCorrect && ans.question_id) {
                toDeleteIncorrectRecords.push(ans.question_id);
              }
            }
          }

          if (updates.length > 0) {
            // 🌟 [23502 에러 방지] 기존 답안의 일부 컬럼만 수정할 때 .upsert()를 쓰면
            // PostgreSQL이 ON CONFLICT 확인 전에 exam_assignment_id NOT NULL 검사를 먼저 수행하여 거부합니다.
            // 반드시 .update().eq("answer_id", ...)로 기존 행만 수정해야 합니다.
            const updateResults = await Promise.all(
              updates.map((u) =>
                supabase
                  .from("student_answer")
                  .update({
                    is_correct: u.is_correct,
                    grading_code: u.grading_code,
                    earned_score: u.earned_score,
                    grading_status: u.grading_status,
                  })
                  .eq("answer_id", u.answer_id)
              )
            );
            const firstUpdateErr = updateResults.find((r) => r.error)?.error;
            if (firstUpdateErr) throw firstUpdateErr;
          }

          if (toDeleteIncorrectRecords.length > 0 && studentId) {
            await supabase
              .from("student_incorrect_record")
              .delete()
              .eq("student_id", studentId)
              .in("question_id", toDeleteIncorrectRecords);
          }
          finalScore = roundScore(totalScoreSum);
        }
      }

      // 🌟 점수 변동이 없는 일반 [확정 & 해제]는 불필요한 조회 없이 경량 UPDATE 2건만 병렬 실행
      const [{ error }] = await Promise.all([
        supabase
          .from("exam_assignment")
          .update({ status: "채점확정", total_score: finalScore })
          .eq("assignment_id", assignmentId),
        supabase
          .from("student_answer")
          .update({ grading_status: statusTag })
          .eq("exam_assignment_id", assignmentId),
      ]);
      if (error) throw error;

      let studentSeat: string | null = null;
      if (studentId) {
        const { data: sessRows } = await supabase
          .from("clinic_session_state")
          .select("id, seat, active_calls")
          .eq("student_id", studentId)
          .is("ended_at", null)
          .order("session_no", { ascending: false })
          .limit(1);

        const latestSess = sessRows?.[0];
        if (latestSess?.id) {
          studentSeat = latestSess.seat || null;
          const newCalls = {
            ...(latestSess.active_calls || {}),
            REFRESH: Date.now(),
            __last_verified: {
              assignmentId,
              examTitle,
              finalScore,
              verifierName: actorName,
              verifiedAt: nowIso,
            },
          };
          await supabase
            .from("clinic_session_state")
            .update({ active_calls: newCalls, last_seen_at: nowIso })
            .eq("id", latestSess.id);
        }
      }

      const record: VerifiedGradingRecord = {
        assignmentId,
        studentId,
        studentName,
        examTitle,
        finalScore,
        verifierName: actorName,
        verifierClientId,
        verifiedAt: nowIso,
      };

      saveVerifiedRecordToLocalCache(record);
      await broadcastVerificationToClinic(record, studentSeat);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("logica:grading-verified", { detail: record }));
      }
      if (onVerifiedRef.current) {
        onVerifiedRef.current(record);
      }

      setRows((prev) => prev.filter((r) => Number(r.assignment_id) !== assignmentId));
      return true;
    } catch (e: any) {
      alert("해제 실패: " + (e?.message || e));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  // 상세 검수 모달 열기 (/supervisor 와 동일한 오답 + 손글씨 검수)
  const openVerificationModal = async (row: any) => {
    setIsVerifyingModalBusy(true);
    const assignmentId = row.assignment_id;
    const studentName = unwrap(row.student)?.name || row.studentName || "학생";
    const examTitle = unwrap(row.exam_master)?.title || row.examTitle || "-";

    try {
      const [{ data: answers }, { data: assignmentRecord }] = await Promise.all([
        supabase
          .from("student_answer")
          .select("*")
          .eq("exam_assignment_id", assignmentId)
          .eq("is_correct", false)
          .order("answer_id", { ascending: true }),
        supabase
          .from("exam_assignment")
          .select("exam_id, exam_master(layout_settings)")
          .eq("assignment_id", assignmentId)
          .maybeSingle(),
      ]);

      if (!answers || answers.length === 0) {
        setVerifyingAnswers([]);
        setVerificationOverrides({});
        setVerifyingExam({ ...row, studentName, examTitle });
        setIsVerifyingModalBusy(false);
        return;
      }

      const rawEm: any = Array.isArray(assignmentRecord?.exam_master)
        ? assignmentRecord?.exam_master[0]
        : assignmentRecord?.exam_master;
      let rawLayout: any = rawEm?.layout_settings || {};
      if (typeof rawLayout === "string") {
        try {
          rawLayout = JSON.parse(rawLayout);
        } catch {
          rawLayout = {};
        }
      }
      const getRealQId = (id: any) => String(id || "").split("_sub_")[0];
      const hiddenImgSet = new Set<string>(
        Array.isArray(rawLayout?.hiddenImageQuestions)
          ? rawLayout.hiddenImageQuestions.map((k: any) => {
              const s = String(k || "").trim();
              const m = s.match(/^(.*?)__img([12])$/);
              return m ? `${getRealQId(m[1])}__img${m[2]}` : getRealQId(s);
            })
          : []
      );

      let qIds = answers.map((a: any) => a.question_id).filter(Boolean);
      if (assignmentRecord?.exam_id) {
        const { data: items } = await supabase
          .from("exam_item")
          .select("question_id")
          .eq("exam_id", assignmentRecord.exam_id);
        items?.forEach((i: any) => {
          if (i.question_id) qIds.push(i.question_id);
        });
      }
      qIds = Array.from(new Set(qIds));

      const qMap: Record<string, any> = {};
      if (qIds.length > 0) {
        const fetchSafe = async (q: any) => {
          try {
            const res = await q;
            return res.data || [];
          } catch {
            return [];
          }
        };
        const numericTqIds = qIds
          .filter(
            (id) =>
              typeof id === "number" ||
              (typeof id === "string" && !id.includes("-") && !isNaN(Number(id)))
          )
          .map(Number);

        const [tqByTqId, tqByQid] = await Promise.all([
          numericTqIds.length > 0
            ? fetchSafe(supabase.from("textbook_question").select("*").in("tq_id", numericTqIds))
            : Promise.resolve([]),
          fetchSafe(supabase.from("textbook_question").select("*").in("question_id", qIds)),
        ]);
        const tqRecords = [...tqByTqId, ...tqByQid];
        const realQIds = new Set(qIds);
        tqRecords.forEach((tq: any) => {
          if (tq.question_id) realQIds.add(tq.question_id);
        });

        const qDbRecords = await fetchSafe(
          supabase.from("question_db").select("*").in("question_id", Array.from(realQIds))
        );
        const qDbMap = new Map();
        qDbRecords.forEach((q: any) => qDbMap.set(String(q.question_id), q));

        const tqMapByTqId = new Map();
        const tqMapByQid = new Map();
        tqRecords.forEach((tq: any) => {
          tqMapByTqId.set(String(tq.tq_id), tq);
          tqMapByQid.set(String(tq.question_id), tq);
        });

        const parseVal = (val: any) =>
          !val || val === "null" || val === "undefined" ? "" : String(val).trim();

        const resolveImgUrl = (raw: string) => {
          let u = raw;
          if (u && u.startsWith("[")) {
            try {
              u = JSON.parse(u)[0] || "";
            } catch {}
          }
          if (!u) return "";
          if (u.startsWith("http") || u.startsWith("data:")) return u;
          const { data } = supabase.storage.from("question_images").getPublicUrl(u);
          return data.publicUrl;
        };

        qIds.forEach((id) => {
          const strId = String(id);
          const tqBase = tqMapByTqId.get(strId) || tqMapByQid.get(strId);
          let qDbBase = qDbMap.get(strId);
          if (tqBase && tqBase.question_id) {
            qDbBase = qDbMap.get(String(tqBase.question_id)) || qDbBase;
          }
          const fallbackDb = qDbBase || {};
          const fallbackTq = tqBase || {};
          let rawMeta: any = {};
          if (fallbackTq.raw_metadata) {
            try {
              rawMeta =
                typeof fallbackTq.raw_metadata === "string"
                  ? JSON.parse(fallbackTq.raw_metadata)
                  : fallbackTq.raw_metadata;
            } catch {}
          }

          const realQKey = getRealQId(fallbackDb.question_id || fallbackTq.question_id || strId);
          const hideImg1 = hiddenImgSet.has(realQKey) || hiddenImgSet.has(`${realQKey}__img1`);
          const hideImg2 = hiddenImgSet.has(realQKey) || hiddenImgSet.has(`${realQKey}__img2`);
          const rawImgUrl = hideImg1
            ? ""
            : parseVal(fallbackDb.image_url) ||
              parseVal(rawMeta.image_url) ||
              parseVal(rawMeta.imageUrl) ||
              parseVal(fallbackTq.image_url);
          const rawImg2Url = hideImg2
            ? ""
            : parseVal(fallbackDb.image_2_url) || parseVal(rawMeta.image_2_url);

          qMap[strId] = {
            questionText:
              parseVal(fallbackTq.question) ||
              parseVal(rawMeta.question) ||
              parseVal(fallbackDb.question) ||
              parseVal(fallbackDb.question_text),
            questionText2: parseVal(fallbackDb.question_2) || parseVal(rawMeta.question_2),
            imageUrl: resolveImgUrl(rawImgUrl),
            image2Url: resolveImgUrl(rawImg2Url),
            correctAnswer:
              parseVal(fallbackTq.answer) ||
              parseVal(rawMeta.answer) ||
              parseVal(fallbackDb.answer),
          };
        });
      }

      const merged = answers.map((a: any) => {
        const cleanInput = a.student_input
          ? String(a.student_input).replace(/^"|"$/g, "").trim()
          : "";
        const isDrawing = cleanInput.includes("data:image");
        const info = qMap[String(a.question_id)] || {};
        return {
          ...a,
          cleanInput,
          isDrawing,
          questionText: info.questionText || "",
          questionText2: info.questionText2 || "",
          imageUrl: info.imageUrl || "",
          image2Url: info.image2Url || "",
          correctAnswer: info.correctAnswer || "",
        };
      });

      setVerifyingAnswers(merged);
    } catch (err) {
      console.error("검수 데이터 로드 에러:", err);
      setVerifyingAnswers([]);
    }

    setVerificationOverrides({});
    setVerifyingExam({ ...row, studentName, examTitle });
    setIsVerifyingModalBusy(false);
  };

  const formatVerifiedTime = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  return (
    <>
      <div className="bg-white border border-amber-300 rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div
          className={`bg-amber-500 text-white ${
            compact ? "px-3 py-1.5" : "px-3.5 py-2"
          } flex justify-between items-center gap-1.5 shrink-0`}
        >
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => setActiveTab("pending")}
              className={`font-bold ${
                compact ? "text-[11px] px-2 py-0.5" : "text-[12px] px-2.5 py-1"
              } rounded-lg transition-colors truncate ${
                activeTab === "pending"
                  ? "bg-white text-amber-700 shadow-xs"
                  : "bg-white/15 text-white hover:bg-white/25"
              }`}
            >
              🔓 채점 확인 대기 ({rows.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`font-bold ${
                compact ? "text-[11px] px-2 py-0.5" : "text-[12px] px-2.5 py-1"
              } rounded-lg transition-colors truncate ${
                activeTab === "history"
                  ? "bg-white text-amber-700 shadow-xs"
                  : "bg-white/15 text-white hover:bg-white/25"
              }`}
            >
              ✅ 확인 기록 ({historyRows.length})
            </button>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="hidden sm:inline-block text-[10px] bg-amber-600/70 text-white/95 px-2 py-0.5 rounded font-bold truncate max-w-[100px]"
              title={`현재 로그인된 확인자: ${resolvedVerifier}`}
            >
              👤 {resolvedVerifier}
            </span>
            <button
              type="button"
              onClick={() => (activeTab === "history" ? loadHistory() : loadPending())}
              className="text-[11px] bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded font-bold shrink-0"
            >
              {loading ? "..." : "새로고침"}
            </button>
          </div>
        </div>

        {activeTab === "pending" ? (
          <div
            className={`${
              compact ? "max-h-[145px]" : "max-h-[240px]"
            } overflow-y-auto divide-y divide-slate-100 custom-scrollbar`}
          >
            {rows.length === 0 ? (
              <div
                className={`${
                  compact ? "py-3 px-3" : "p-5"
                } text-center text-slate-400 text-[11px] font-bold`}
              >
                대기 중인 학생이 없습니다.
              </div>
            ) : (
              rows.map((r) => {
                const name = unwrap(r.student)?.name || r.studentName || "알수없음";
                const title = unwrap(r.exam_master)?.title || r.examTitle || "-";
                const isBusy = busyId === r.assignment_id;
                return (
                  <div
                    key={r.assignment_id}
                    className={`${
                      compact ? "px-2.5 py-2" : "p-3"
                    } flex items-center justify-between gap-2 hover:bg-amber-50/40 transition-colors`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-800 text-[12px] truncate">{name}</span>
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded shrink-0">
                          가채점 {r.total_score ?? 0}점
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">{title}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openVerificationModal(r)}
                        disabled={isBusy || isVerifyingModalBusy}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors shadow-xs"
                      >
                        검수
                      </button>
                      <button
                        type="button"
                        onClick={() => executeConfirmVerification(r, {}, false)}
                        disabled={isBusy}
                        className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors shadow-xs"
                      >
                        {isBusy ? "처리중" : "확정 & 해제"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div
            className={`${
              compact ? "max-h-[145px]" : "max-h-[240px]"
            } overflow-y-auto divide-y divide-slate-100 custom-scrollbar bg-slate-50/50`}
          >
            {historyRows.length === 0 ? (
              <div
                className={`${
                  compact ? "py-3 px-3" : "p-5"
                } text-center text-slate-400 text-[11px] font-bold`}
              >
                아직 기록된 채점 확인 내역이 없습니다.
              </div>
            ) : (
              historyRows.map((h) => (
                <div
                  key={`${h.assignmentId}_${h.verifiedAt}`}
                  className={`${
                    compact ? "px-2.5 py-1.5" : "px-3 py-2.5"
                  } flex items-center justify-between gap-2 bg-white hover:bg-slate-50 transition-colors`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-800 text-[12px] truncate">
                        {h.studentName}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded shrink-0">
                        최종 {h.finalScore}점
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">{h.examTitle}</div>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                      ✓ 확인: {h.verifierName}
                    </span>
                    {h.verifiedAt && (
                      <span className="text-[9px] font-semibold text-slate-400 mt-0.5 tabular-nums">
                        {formatVerifiedTime(h.verifiedAt)}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 상세 오답 검수 모달 (/supervisor 와 동일 기능) */}
      {verifyingExam && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 md:p-8 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-slate-100 rounded-4xl shadow-2xl w-full max-w-5xl h-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="bg-brand text-white px-6 md:px-8 py-4 md:py-5 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-lg md:text-2xl font-bold">
                  📝 {verifyingExam.studentName} 학생 테스트 오답 검수
                </h2>
                <p className="text-xs md:text-sm font-bold text-blue-200 mt-0.5">
                  {verifyingExam.examTitle} · 최종 확인자: {resolvedVerifier}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined" && (window as any).MathJax?.typesetPromise) {
                      (window as any).MathJax.typesetPromise().catch(() => {});
                    }
                  }}
                  className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg text-xs md:text-sm font-bold transition-colors"
                >
                  <span>🔄</span> 수식 새로고침
                </button>
                <button
                  type="button"
                  onClick={() => setVerifyingExam(null)}
                  className="text-white/70 hover:text-white text-3xl md:text-4xl font-bold transition-colors"
                >
                  &times;
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-5 custom-scrollbar">
              {verifyingAnswers.length === 0 ? (
                <div className="text-center py-20 flex flex-col items-center">
                  <span className="text-6xl mb-4">💯</span>
                  <span className="text-slate-500 font-bold text-xl">
                    가채점 결과 모두 정답입니다! (오답 없음)
                  </span>
                </div>
              ) : (
                verifyingAnswers.map((ans) => {
                  const isOverridden = verificationOverrides[ans.answer_id] === true;
                  return (
                    <div
                      key={ans.answer_id}
                      className={`bg-white rounded-2xl shadow-sm border-[3px] overflow-hidden flex flex-col md:flex-row transition-colors ${
                        isOverridden ? "border-emerald-400" : "border-rose-200"
                      }`}
                    >
                      <div className="w-full md:w-2/3 p-5 md:p-6 relative bg-white border-b md:border-b-0 md:border-r border-slate-100 min-h-[260px] flex flex-col justify-start items-start">
                        <div className="relative w-full max-w-full z-10 text-base md:text-lg">
                          {ans.questionText ? (
                            <MathText
                              className="font-bold text-slate-800 leading-relaxed font-myungjo"
                              html={ans.questionText}
                            />
                          ) : (
                            <div className="text-sm font-bold text-slate-400 bg-slate-50 p-4 rounded-xl border border-slate-200 text-center">
                              [문제 텍스트 데이터가 없습니다]
                            </div>
                          )}

                          {ans.imageUrl && (
                            <img
                              src={ans.imageUrl}
                              className="max-w-full rounded-lg mt-4 shadow-sm"
                              alt="문제 원본 이미지"
                            />
                          )}
                          {ans.image2Url && (
                            <img
                              src={ans.image2Url}
                              className="max-w-full rounded-lg mt-4 shadow-sm"
                              alt="문제 원본 이미지 2"
                            />
                          )}
                          {ans.questionText2 && (
                            <MathText
                              className="font-bold text-slate-800 leading-relaxed font-myungjo mt-4"
                              html={ans.questionText2}
                            />
                          )}
                        </div>

                        {ans.isDrawing && (
                          <img
                            src={ans.cleanInput}
                            className="absolute top-0 left-0 w-full h-full object-contain object-top pointer-events-none opacity-90 mix-blend-multiply z-20 p-5 md:p-6"
                            alt="학생 손글씨"
                          />
                        )}
                      </div>

                      <div className="w-full md:w-1/3 p-5 md:p-6 flex flex-col justify-between bg-slate-50">
                        <div className="flex flex-col gap-3">
                          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                            <span className="text-xs font-bold text-slate-400 block mb-1">
                              학생 입력 답안
                            </span>
                            {ans.isDrawing ? (
                              <span className="inline-block px-3 py-1 bg-slate-100 text-slate-600 font-bold rounded-lg text-sm">
                                ✍️ 손글씨 풀이 (좌측 확인)
                              </span>
                            ) : (
                              <span
                                className="inline-block px-3 py-1 bg-slate-100 text-slate-800 font-bold rounded-lg text-base md:text-lg truncate max-w-full"
                                title={ans.cleanInput}
                              >
                                {ans.cleanInput || "미입력"}
                              </span>
                            )}
                          </div>
                          <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 shadow-xs overflow-hidden">
                            <span className="text-xs font-bold text-emerald-600 block mb-1">
                              실제 정답
                            </span>
                            {ans.correctAnswer ? (
                              <MathText
                                className="inline-block font-bold text-emerald-800 text-base md:text-lg leading-tight font-myungjo"
                                html={ans.correctAnswer}
                              />
                            ) : (
                              <span className="inline-block font-bold text-emerald-600 text-sm opacity-60">
                                정답 데이터 없음
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-5 flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setVerificationOverrides((p) => ({ ...p, [ans.answer_id]: true }))
                            }
                            className={`w-full py-3 rounded-xl font-bold text-base transition-all ${
                              isOverridden
                                ? "bg-emerald-500 text-white shadow-md ring-2 ring-emerald-300 ring-offset-2"
                                : "bg-white border-2 border-slate-200 text-slate-500 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600"
                            }`}
                          >
                            ✅ 정답으로 인정
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setVerificationOverrides((p) => {
                                const next = { ...p };
                                delete next[ans.answer_id];
                                return next;
                              })
                            }
                            className={`w-full py-3 rounded-xl font-bold text-base transition-all ${
                              !isOverridden
                                ? "bg-rose-500 text-white shadow-md ring-2 ring-rose-300 ring-offset-2"
                                : "bg-white border-2 border-slate-200 text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
                            }`}
                          >
                            ❌ 오답 유지
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="bg-white p-4 md:p-6 border-t border-slate-200 flex justify-end gap-3 shrink-0 rounded-b-4xl">
              <button
                type="button"
                onClick={() => setVerifyingExam(null)}
                className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-colors text-sm md:text-base"
              >
                나중에 검수하기 (닫기)
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsVerifyingModalBusy(true);
                  const ok = await executeConfirmVerification(
                    verifyingExam,
                    verificationOverrides,
                    true
                  );
                  setIsVerifyingModalBusy(false);
                  if (ok) setVerifyingExam(null);
                }}
                disabled={isVerifyingModalBusy}
                className="px-8 py-3.5 bg-brand hover:bg-blue-900 text-white text-sm md:text-lg font-bold rounded-xl shadow-lg transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isVerifyingModalBusy
                  ? "처리 중..."
                  : `최종 확정 및 오답 클리닉 개방 (확인: ${resolvedVerifier})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}