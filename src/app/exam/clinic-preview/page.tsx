// src/app/exam/clinic-preview/page.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { supabase as supabaseClient } from "@/lib/supabase";
import { BOOK_TYPE_COLORS } from "@/lib/clinicHomework";
import PointBadge from "@/components/clinic/PointBadge";
import SeatCardBody from "@/app/supervisor/SeatCardBody";
import { formatDuration } from "@/app/supervisor/supervisorUtils";

import { ClinicCanvas } from "@/app/clinic/viewer/components/ClinicCanvas";
import { ClinicKeypad } from "@/app/clinic/viewer/components/ClinicKeypad";
import { ClinicQuestionNav } from "@/app/clinic/viewer/components/ClinicQuestionNav";
import { QuestionDisplay } from "@/app/clinic/viewer/components/QuestionDisplay";
import { ViewerModals } from "@/app/clinic/viewer/components/ViewerModals";
import { HintRevealBox } from "@/app/clinic/viewer/components/HintRevealBox";

import {
  PEN_COLORS,
  formatMathTextForWeb,
  keypadAnswersMatch,
  isKeypadEnterable,
  mcAnswersMatch,
  isObjectiveQuestion,
  safeParseOptions,
  combineDbHints,
  getCleanUrl,
  captureCompositeQuestionImage,
  measureStageDimensions,
} from "@/app/clinic/viewer/utils";

const DEFAULT_CLINIC_DURATION_MS = 60 * 60 * 1000;
const SEAT_NO = "A-01";
const TEST_STUDENT_NAME = "테스트";
const TEST_STUDENT_ID = "preview-test-student";

const NON_TIMED_EXAM_TYPES = [
  "과제",
  "과제프린트",
  "오답프린트",
  "오답",
  "오답유사",
  "과제오답유사",
  "미완료과제",
];

// 'x주차 오답프린트', 'x주차 오답 프린트', 'x주차 오답' 판별 헬퍼 (일반 [통합] 오답프린트와 구분)
const isWeeklyIncorrectExam = (type?: string, rawTitle?: string, subTitle?: string): boolean => {
  const t = String(rawTitle || "").trim();
  const ty = String(type || "").trim();
  const sub = String(subTitle || "").trim();
  if (t.includes("[통합]") || sub === "누적 오답 모음") return false;
  const hasWeekAndWrong = (s: string) =>
    /([0-9xX]+\s*주차|주차)/.test(s) && /오답\s*(프린트)?/.test(s);
  return hasWeekAndWrong(t) || hasWeekAndWrong(ty);
};

// 문제지 유형에 따라 학생 포털의 4개 박스 중 어디에 배정할지 결정
function resolveTargetPortalBox(
  examType?: string,
  title?: string,
  subTitle?: string
): "exam" | "hw" | "print" | "overdue" {
  const ty = String(examType || "").trim();
  if (isWeeklyIncorrectExam(ty, title, subTitle)) return "exam";
  if (ty === "오답유사" || ty === "과제오답유사") return "exam";
  if (ty === "과제" || ty === "과제프린트") return "hw";
  if (ty === "오답프린트" || ty === "오답") return "print";
  if (ty === "미완료과제") return "overdue";
  return "exam";
}

function roundScore(val: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 10) / 10;
}

const getRealQuestionId = (id: any) => String(id || "").trim().replace(/_added_\d+$/, "");

const normalizeHiddenImageKey = (raw: any): string => {
  const s = String(raw || "").trim();
  const m = s.match(/^(.*?)__img([12])$/);
  if (m) return `${getRealQuestionId(m[1])}__img${m[2]}`;
  return getRealQuestionId(s);
};

function extractHiddenImageSet(layoutSettings: any): Set<string> {
  if (!layoutSettings) return new Set();
  let s = layoutSettings;
  if (typeof s === "string") {
    try {
      s = JSON.parse(s);
    } catch {
      return new Set();
    }
  }
  if (Array.isArray(s?.hiddenImageQuestions)) {
    return new Set(s.hiddenImageQuestions.map(normalizeHiddenImageKey).filter(Boolean));
  }
  return new Set();
}

function isQuestionImageHidden(hiddenSet: Set<string> | undefined, qId: any, slot: 1 | 2): boolean {
  if (!hiddenSet || hiddenSet.size === 0 || !qId) return false;
  const realId = getRealQuestionId(qId);
  if (!realId) return false;
  return hiddenSet.has(realId) || hiddenSet.has(`${realId}__img${slot}`);
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
) {
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
    const gId = customGId || `single_${qidStr}_${idx}`;

    if (!groupMap.has(gId)) {
      const newG = { id: gId, items: [] as any[], groupScore: 0, subScore: 0 };
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

  return { scoreByQuestionId, groupCount };
}

const MathText = React.memo(function MathText({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mj = (window as any).MathJax;
    if (mj && mj.typesetPromise && ref.current) {
      mj.typesetPromise([ref.current]).catch(() => {});
    }
  }, [html]);
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

interface LiveLogItem {
  id: string;
  timestamp: string;
  borderClass: string;
  badgeBg: string;
  badgeText: string;
  title: string;
  subtitle: string;
  type?: string;
  data?: any;
}


// 🌟 학생 화면의 원본 스테이지 크기(stageWidth × stageHeight) 그대로 문제(MathJax+이미지)와 투명 손글씨를 (0,0)에 겹쳐 축소 표시하는 내장 컴포넌트
function HandwritingOverlayPreview({
  imageDataUrl,
  questionText,
  questionText2,
  imageUrl,
  image2Url,
  stageWidth,
  stageHeight,
  cropHeight,
}: {
  imageDataUrl: string;
  questionText?: string;
  questionText2?: string;
  imageUrl?: string;
  image2Url?: string;
  stageWidth?: number;
  stageHeight?: number;
  cropHeight?: number;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const contentMeasureRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState<number>(0);
  const [naturalSize, setNaturalSize] = React.useState<{ w: number; h: number }>({
    w: stageWidth || 640,
    h: stageHeight || 480,
  });
  const [measuredContentH, setMeasuredContentH] = React.useState<number>(0);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    if (!contentMeasureRef.current) return;
    const updateContentH = () => {
      if (contentMeasureRef.current) {
        setMeasuredContentH(contentMeasureRef.current.scrollHeight);
      }
    };
    updateContentH();
    const timer = setTimeout(updateContentH, 250);
    const ro = new ResizeObserver(updateContentH);
    ro.observe(contentMeasureRef.current);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [questionText, questionText2, imageUrl, image2Url]);

  const baseW = stageWidth && stageWidth > 0 ? stageWidth : naturalSize.w;
  const baseH = stageHeight && stageHeight > 0 ? stageHeight : naturalSize.h;

  const hasQuestionContext = Boolean(
    (questionText && questionText.trim()) ||
      (questionText2 && questionText2.trim()) ||
      (imageUrl && imageUrl.trim()) ||
      (image2Url && image2Url.trim())
  );

  const effectiveCropH = (() => {
    const baseCrop = cropHeight && cropHeight > 0 ? cropHeight : baseH;
    if (measuredContentH > 0) {
      return Math.min(baseH, Math.max(baseCrop, measuredContentH + 36, 180));
    }
    return Math.min(baseH, Math.max(baseCrop, 180));
  })();

  const scale =
    containerWidth > 0 && baseW > 0 ? Math.min(1, containerWidth / baseW) : 1;
  const scaledHeight = Math.round(effectiveCropH * scale);

  if (!hasQuestionContext) {
    return (
      <img
        className="w-full max-h-95 object-contain rounded-lg bg-white"
        src={imageDataUrl}
        alt="학생 손글씨 답안"
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden rounded-lg bg-white relative"
      style={{
        height: scaledHeight > 0 ? `${scaledHeight}px` : "auto",
        minHeight: "160px",
        backgroundImage: "radial-gradient(#cbd5e1 1.25px, transparent 1.25px)",
        backgroundSize: "20px 20px",
      }}
    >
      <div
        style={{
          width: `${baseW}px`,
          height: `${baseH}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "relative",
        }}
      >
        <div
          ref={contentMeasureRef}
          className="opacity-75 pointer-events-none select-none"
        >
          <QuestionDisplay
            html={questionText || ""}
            imageUrl={imageUrl}
            image2Url={image2Url}
            html2={questionText2}
          />
        </div>
        <img
          src={imageDataUrl}
          alt="학생 손글씨 답안"
          onLoad={(e) => {
            if (!stageWidth || !stageHeight) {
              const im = e.currentTarget;
              if (im.naturalWidth > 0 && im.naturalHeight > 0) {
                const dprGuess = im.naturalWidth > 1000 ? 2 : 1;
                setNaturalSize({
                  w: Math.round(im.naturalWidth / dprGuess),
                  h: Math.round(im.naturalHeight / dprGuess),
                });
              }
            }
          }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: `${baseW}px`,
            height: `${baseH}px`,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}

export default function ExamClinicPreviewPage() {
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  const [isLoadingExam, setIsLoadingExam] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [examMaster, setExamMaster] = useState<any | null>(null);
  const [questions, setQuestions] = useState<any[]>([]);

  // 좌측 화면 모드: 'portal' (학생 포털) vs 'viewer' (문제 풀이 화면)
  const [leftViewMode, setLeftViewMode] = useState<"portal" | "viewer">("portal");
  const [targetBox, setTargetBox] = useState<"exam" | "hw" | "print" | "overdue">("exam");

  // 포털 내 해당 문제지 진행 상태
  // '미응시' | '제출완료'(채점대기) | '채점확정'(오답고치기) | '최종완료'
  const [assignmentStatus, setAssignmentStatus] = useState<string>("미응시");
  const [initialScore, setInitialScore] = useState<number | null>(null);
  const [isRetryMode, setIsRetryMode] = useState(false);

  // 포인트 및 시간 상태
  const [points, setPoints] = useState<number>(1000);
  const [now, setNow] = useState<number>(Date.now());
  const [sessionStartedAt, setSessionStartedAt] = useState<number>(Date.now());
  const [clinicDurationMs, setClinicDurationMs] = useState<number>(DEFAULT_CLINIC_DURATION_MS);

  // 학생 포털 상단 버튼 상태
  const [isPortalAway, setIsPortalAway] = useState(false);
  const [isPortalCalling, setIsPortalCalling] = useState(false);
  const [endRequestStatus, setEndRequestStatus] = useState<"idle" | "pending" | "rejected">("idle");

  // 클리닉 뷰어 내부 상태
  const [isStarted, setIsStarted] = useState(false);
  const [isTimedRound, setIsTimedRound] = useState(false);
  const [roundRemainingSec, setRoundRemainingSec] = useState(1200);
  const [dynamicTimeLimitMin, setDynamicTimeLimitMin] = useState(20);
  const [timeIsUp, setTimeIsUp] = useState(false);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [bookFilter, setBookFilter] = useState<string | "all">("all");

  const [currentPenWidth, setCurrentPenWidth] = useState(3);
  const [currentPenColor, setCurrentPenColor] = useState("#0f172a");
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [canvasClearTrigger, setCanvasClearTrigger] = useState(0);
  const [keypadCollapsed, setKeypadCollapsed] = useState(false);
  const [hintPanelExpanded, setHintPanelExpanded] = useState(true);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBatchGrading, setIsBatchGrading] = useState(false);
  const [resultModal, setResultModal] = useState<any>(null);
  const [submitConfirmModal, setSubmitConfirmModal] = useState(false);
  const [submitResultModal, setSubmitResultModal] = useState(false);
  const [sessionTimeUpModal, setSessionTimeUpModal] = useState(false);
  const [timeUpModal, setTimeUpModal] = useState(false);
  const [hintModal, setHintModal] = useState<any>(null);
  const [emptyState, setEmptyState] = useState<any>(null);
  const [recheckToast, setRecheckToast] = useState("");
  const [autoLeaveSec, setAutoLeaveSec] = useState(10);
  const [pendingRecheckReview, setPendingRecheckReview] = useState<any[]>([]);

  // 답안/채점 Ref (실제 /clinic/viewer와 동일한 구조)
  const studentAnswers = useRef<Record<number, string | null>>({});
  const studentDrawings = useRef<Record<number, string>>({});
  const keypadAnswers = useRef<Record<number, string>>({});
  const keypadCursor = useRef<Record<number, number>>({});
  const answerModes = useRef<Record<number, "pen" | "keypad">>({});
  const qBoxStatus = useRef<Record<number, string>>({});
  const callState = useRef<Record<number, boolean>>({});
  const recheckState = useRef<Record<number, "pending" | null>>({});
  const hintState = useRef<Record<number, { revealed: boolean; hintText: string }>>({});
  const taHintState = useRef<Record<number, boolean>>({});
  const correctSolvedCountRef = useRef<number>(0);
  const lastGradingContextRef = useRef<any>(null);
  const penGradeCache = useRef<Record<number, boolean>>({});
  const penGradeMetaCache = useRef<Record<number, any>>({});
  const penGradeInFlight = useRef<Record<number, Promise<void>>>({});
  const autoLeaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  // 우측 관제탑 시뮬레이터 상태 (가상 좌석 A-01 + 현장 라이브 로그 + 검수/호출/재확인 모달)
  const [virtualSeatStudent, setVirtualSeatStudent] = useState<any>({
    studentId: TEST_STUDENT_ID,
    name: TEST_STUDENT_NAME,
    classes: ["테스트반"],
    status: "idle",
    activity: "포털 대기 중 📋",
    firstSeenAt: Date.now(),
    clinicDurationMs: DEFAULT_CLINIC_DURATION_MS,
    calls: {},
    rechecks: {},
    totalCalls: 0,
    totalHints: 0,
    endRequestPending: false,
    isTyping: false,
    score: null,
  });
  const [logs, setLogs] = useState<LiveLogItem[]>([]);

  // 관제탑 모달 상태
  const [callProcessModal, setCallProcessModal] = useState<{
    isOpen: boolean;
    qNum: any;
    callInfo: any;
  } | null>(null);
  const [recheckModal, setRecheckModal] = useState<{
    isOpen: boolean;
    uid: string | null;
  }>({ isOpen: false, uid: null });
  const [endRequestModal, setEndRequestModal] = useState<boolean>(false);
  const [forceCheckoutModal, setForceCheckoutModal] = useState<boolean>(false);

  // 타이머 시험 제출 후 오답 검수 모달 상태
  const [hasPendingVerification, setHasPendingVerification] = useState<boolean>(false);
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState<boolean>(false);
  const [verificationOverrides, setVerificationOverrides] = useState<Record<number, boolean>>({});

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const appendLog = useCallback(
    (
      borderClass: string,
      badgeBg: string,
      badgeText: string,
      title: string,
      subtitle: string,
      type?: string,
      data?: any
    ) => {
      const newLog: LiveLogItem = {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toLocaleTimeString("ko-KR", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        borderClass,
        badgeBg,
        badgeText,
        title,
        subtitle,
        type,
        data,
      };
      setLogs((prev) => [newLog, ...prev].slice(0, 100));
    },
    []
  );

  const removeLogsByType = useCallback((type: string, qNum?: any, uid?: string | null) => {
    setLogs((prev) =>
      prev.filter((l) => {
        if (l.type !== type) return true;
        if (qNum != null && l.data?.qNum !== qNum) return true;
        if (uid != null && l.data?.uid !== uid) return true;
        return false;
      })
    );
  }, []);

  const triggerTypingIndicator = useCallback(() => {
    setVirtualSeatStudent((prev: any) => ({ ...prev, isTyping: true }));
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setVirtualSeatStudent((prev: any) => ({ ...prev, isTyping: false }));
    }, 1500);
  }, []);

  // MathJax 로드
  useEffect(() => {
    if (!document.getElementById("MathJax-script")) {
      (window as any).MathJax = {
        tex: {
          inlineMath: [
            ["$", "$"],
            ["\\(", "\\)"],
          ],
          displayMath: [
            ["$$", "$$"],
            ["\\[", "\\]"],
          ],
          processEscapes: true,
        },
        chtml: { displayAlign: "left" },
      };
      const script = document.createElement("script");
      script.id = "MathJax-script";
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
      script.async = true;
      script.onload = () => {
        (window as any).MathJax?.typesetPromise?.().catch(() => {});
      };
      document.head.appendChild(script);
    }
  }, []);

  // 1초 시계 및 라운드 타이머
  useEffect(() => {
    const iv = setInterval(() => {
      setNow(Date.now());
      if (leftViewMode === "viewer" && isStarted && isTimedRound && !timeIsUp) {
        setRoundRemainingSec((prev) => {
          if (prev <= 1) {
            setTimeout(() => handleTimeUpRef.current?.(), 0);
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [leftViewMode, isStarted, isTimedRound, timeIsUp]);

  // MathJax 재렌더링
  useEffect(() => {
    const timer = setTimeout(() => {
      const mj = (window as any).MathJax;
      if (mj && mj.typesetPromise) {
        mj.typesetPromise().catch(() => {});
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [
    leftViewMode,
    isStarted,
    currentQIndex,
    questions,
    callProcessModal,
    recheckModal,
    isVerifyModalOpen,
    hintPanelExpanded,
  ]);

  // 문제지 데이터 로드
  const loadExamData = useCallback(async () => {
    setIsLoadingExam(true);
    setLoadError(null);
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const examId = urlParams.get("exam_id");
      if (!examId) {
        setLoadError("exam_id 파라미터가 없습니다.");
        setIsLoadingExam(false);
        return;
      }

      const { data: master, error: mErr } = await supabaseClient
        .from("exam_master")
        .select("*")
        .eq("exam_id", examId)
        .maybeSingle();

      if (mErr || !master) {
        setLoadError(mErr?.message || "문제지 정보를 찾을 수 없습니다.");
        setIsLoadingExam(false);
        return;
      }

      const { data: items, error: iErr } = await supabaseClient
        .from("exam_item")
        .select("*, question_db(*)")
        .eq("exam_id", examId)
        .order("sort_order", { ascending: true });

      if (iErr) throw iErr;

      const validItems = (items || []).filter((it: any) => it.question_db);
      const { scoreByQuestionId, groupCount } = buildExamQuestionScoreMap(
        validItems,
        master.layout_settings,
        master.exam_type,
        validItems.length
      );
      const defaultItemScore = 100 / (groupCount || validItems.length || 1);
      const hiddenImageSet = extractHiddenImageSet(master.layout_settings);

      const mapped = validItems.map((it: any, i: number) => {
        const qdb = it.question_db;
        const dbHint = combineDbHints(qdb.step_1_concept, qdb.step_2_approach);
        const qId = qdb.question_id;
        const hideImg1 = isQuestionImageHidden(hiddenImageSet, qId, 1);
        const hideImg2 = isQuestionImageHidden(hiddenImageSet, qId, 2);
        return {
          index: i,
          uid: `preview_q_${i}_${qId}`,
          question_id: qId,
          assigned_score: scoreByQuestionId.get(String(qId)) ?? defaultItemScore,
          source: master.title || "문제지",
          bookType:
            master.exam_type === "오답프린트" || master.exam_type === "오답"
              ? "오답"
              : undefined,
          questionText: formatMathTextForWeb(qdb.question),
          questionText2: qdb.question_2 ? formatMathTextForWeb(qdb.question_2) : "",
          imageUrl: hideImg1 ? "" : getCleanUrl(qdb.image_url),
          image2Url: hideImg2 ? "" : getCleanUrl(qdb.image_2_url),
          options: safeParseOptions(qdb.options),
          answer: String(qdb.answer || "").trim(),
          explanation: qdb.explanation || qdb.solution || "",
          hintText: dbHint,
          aiGradable: qdb.ai_gradable !== false,
          hasHint: true,
          needsAiHint: !dbHint,
          pageNum:
            qdb.page_number || qdb.final_printed_page || qdb.detected_page_num,
          questionNum: qdb.question_number,
        };
      });

      setExamMaster(master);
      setQuestions(mapped);

      const initialBox = resolveTargetPortalBox(
        master.exam_type,
        master.title,
        master.sub_title
      );
      setTargetBox(initialBox);

      const classLabel =
        master.sub_title && master.sub_title !== "-"
          ? master.sub_title
          : master.major_grade || "테스트반";

      const startTs = Date.now();
      setSessionStartedAt(startTs);
      setVirtualSeatStudent({
        studentId: TEST_STUDENT_ID,
        name: TEST_STUDENT_NAME,
        classes: [classLabel],
        status: "idle",
        activity: "포털 대기 중 📋",
        firstSeenAt: startTs,
        clinicDurationMs: DEFAULT_CLINIC_DURATION_MS,
        calls: {},
        rechecks: {},
        totalCalls: 0,
        totalHints: 0,
        endRequestPending: false,
        isTyping: false,
        score: null,
      });

      setLogs([
        {
          id: `log-init-${startTs}`,
          timestamp: new Date(startTs).toLocaleTimeString("ko-KR", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          borderClass: "border-indigo-400",
          badgeBg: "bg-indigo-50 text-indigo-600",
          badgeText: "입실완료",
          title: `[${SEAT_NO}] ${TEST_STUDENT_NAME} 입실`,
          subtitle: `'${master.title}' 클리닉 미리보기 세션이 시작되었습니다.`,
          type: "init",
        },
      ]);
    } catch (e: any) {
      console.error("클리닉 미리보기 로드 오류:", e);
      setLoadError(e?.message || "문제지 로드 중 오류가 발생했습니다.");
    } finally {
      setIsLoadingExam(false);
    }
  }, []);

  useEffect(() => {
    loadExamData();
  }, [loadExamData]);

  // 전체 초기화 (처음부터 다시 테스트)
  const resetSimulation = () => {
    if (autoLeaveTimerRef.current) {
      clearInterval(autoLeaveTimerRef.current);
      autoLeaveTimerRef.current = null;
    }
    studentAnswers.current = {};
    studentDrawings.current = {};
    keypadAnswers.current = {};
    keypadCursor.current = {};
    answerModes.current = {};
    qBoxStatus.current = {};
    callState.current = {};
    recheckState.current = {};
    hintState.current = {};
    taHintState.current = {};
    correctSolvedCountRef.current = 0;
    penGradeCache.current = {};
    penGradeMetaCache.current = {};
    penGradeInFlight.current = {};

    setAssignmentStatus("미응시");
    setInitialScore(null);
    setIsRetryMode(false);
    setHasPendingVerification(false);
    setIsVerifyModalOpen(false);
    setVerificationOverrides({});
    setLeftViewMode("portal");
    setIsStarted(false);
    setTimeIsUp(false);
    setCurrentQIndex(0);
    setResultModal(null);
    setSubmitConfirmModal(false);
    setSubmitResultModal(false);
    setSessionTimeUpModal(false);
    setTimeUpModal(false);
    setEmptyState(null);
    setPendingRecheckReview([]);
    setIsPortalAway(false);
    setIsPortalCalling(false);
    setEndRequestStatus("idle");
    setPoints(1000);
    setCanvasClearTrigger((p) => p + 1);

    const startTs = Date.now();
    setSessionStartedAt(startTs);
    setClinicDurationMs(DEFAULT_CLINIC_DURATION_MS);
    const classLabel =
      examMaster?.sub_title && examMaster?.sub_title !== "-"
        ? examMaster.sub_title
        : examMaster?.major_grade || "테스트반";

    setVirtualSeatStudent({
      studentId: TEST_STUDENT_ID,
      name: TEST_STUDENT_NAME,
      classes: [classLabel],
      status: "idle",
      activity: "포털 대기 중 📋",
      firstSeenAt: startTs,
      clinicDurationMs: DEFAULT_CLINIC_DURATION_MS,
      calls: {},
      rechecks: {},
      totalCalls: 0,
      totalHints: 0,
      endRequestPending: false,
      isTyping: false,
      score: null,
    });

    appendLog(
      "border-fuchsia-500",
      "bg-fuchsia-100 text-fuchsia-700",
      "초기화",
      `[${SEAT_NO}] ${TEST_STUDENT_NAME} 시뮬레이션 리셋`,
      "모든 답안과 클리닉 상태가 초기('미응시') 상태로 초기화되었습니다."
    );
    forceUpdate();
  };

  const getAnswerMode = (idx: number, qItem: any): "pen" | "keypad" => {
    if (!qItem) return "keypad";
    if (isObjectiveQuestion(qItem)) return "keypad";
    const explicit = answerModes.current[idx];
    if (explicit) return explicit;
    return isKeypadEnterable(qItem.answer) ? "keypad" : "pen";
  };

  // 남은 미해결 문항 수 계산
  const getRemainingQuestionCount = () => {
    if (questions.length === 0) return 0;
    let solved = 0;
    questions.forEach((_, idx) => {
      const st = qBoxStatus.current[idx];
      if (
        st === "correct_blue" ||
        st === "correct_yellow" ||
        st === "retry_yellow" ||
        st === "O" ||
        st === "TO" ||
        st === "RO"
      ) {
        solved++;
      }
    });
    return Math.max(0, questions.length - solved);
  };

  // 포털에서 박스 클릭 -> 클리닉 뷰어로 진입
  const handleStartFromPortal = (boxType: "exam" | "hw" | "print" | "overdue") => {
    if (!examMaster) return;
    if (isPortalAway || isPortalCalling || endRequestStatus === "pending") {
      alert("자리비움/호출/종료요청 상태에서는 학습을 시작할 수 없습니다.");
      return;
    }

    const exType = String(examMaster.exam_type || "").trim();
    const isWeeklyInc = isWeeklyIncorrectExam(exType, examMaster.title, examMaster.sub_title);
    const retry = boxType === "exam" && assignmentStatus === "채점확정";
    const timed =
      boxType === "exam" &&
      !NON_TIMED_EXAM_TYPES.includes(exType) &&
      !isWeeklyInc &&
      !retry;

    const is60MinTest =
      ["중간평가", "중간테스트", "분기평가", "분기테스트", "입학테스트", "진단평가"].includes(
        exType
      ) ||
      ["중간평가", "중간테스트", "분기평가", "분기테스트"].some((k) =>
        String(examMaster.title || "").includes(k)
      );

    const limitMin = is60MinTest ? 60 : 20;
    setDynamicTimeLimitMin(limitMin);
    setRoundRemainingSec(limitMin * 60);
    setIsTimedRound(timed);
    setIsRetryMode(retry);
    setTimeIsUp(false);
    setIsStarted(false);
    setEmptyState(null);
    setResultModal(null);
    setSubmitConfirmModal(false);
    setSubmitResultModal(false);
    setPendingRecheckReview([]);

    if (retry) {
      // 오답 고치기 진입 시 틀린 문항의 기존 입력값은 비워서 바로 다시 풀 수 있게 준비
      questions.forEach((_, idx) => {
        const st = qBoxStatus.current[idx];
        const isCorrect =
          st === "correct_blue" ||
          st === "correct_yellow" ||
          st === "retry_yellow" ||
          st === "O" ||
          st === "TO" ||
          st === "RO";
        if (!isCorrect) {
          studentAnswers.current[idx] = null;
          delete studentDrawings.current[idx];
          delete keypadAnswers.current[idx];
          delete keypadCursor.current[idx];
        }
      });
      const firstWrong = questions.findIndex((_, idx) => {
        const st = qBoxStatus.current[idx];
        return (
          !st || st === "wrong_red" || st === "B" || st === "X" || st === "TX"
        );
      });
      setCurrentQIndex(firstWrong >= 0 ? firstWrong : 0);
    } else {
      setCurrentQIndex(0);
    }

    const activityLabel = retry
      ? `[${virtualSeatStudent.classes[0]}] 시험지 오답 고치기 🏃‍♂️`
      : `[${virtualSeatStudent.classes[0]}] ${examMaster.title} 🏃‍♂️`;

    setVirtualSeatStudent((prev: any) => ({
      ...prev,
      status: "idle",
      activity: activityLabel,
    }));
    appendLog(
      "border-blue-400",
      "bg-blue-50 text-blue-700",
      "활동갱신",
      `[${SEAT_NO}] ${TEST_STUDENT_NAME} 상태 갱신`,
      activityLabel,
      "update_activity",
      { seat: SEAT_NO }
    );

    setLeftViewMode("viewer");
    forceUpdate();
  };

  // 클리닉 뷰어 -> 포털로 복귀
  const leaveToPortal = useCallback(() => {
    if (autoLeaveTimerRef.current) {
      clearInterval(autoLeaveTimerRef.current);
      autoLeaveTimerRef.current = null;
    }
    setLeftViewMode("portal");
    setIsStarted(false);
    setSubmitResultModal(false);
    setSessionTimeUpModal(false);
    setTimeUpModal(false);
    setEmptyState(null);

    setVirtualSeatStudent((prev: any) => ({
      ...prev,
      status:
        Object.keys(prev.calls || {}).length > 0
          ? "call"
          : isPortalAway
          ? "away"
          : "idle",
      activity: "포털 대기 중 📋",
    }));
    appendLog(
      "border-indigo-400",
      "bg-indigo-50 text-indigo-600",
      "화면전환",
      `[${SEAT_NO}] ${TEST_STUDENT_NAME} 이동`,
      "학생 포털 대기 화면으로 돌아왔습니다."
    );
  }, [appendLog, isPortalAway]);

  // AI 손글씨 채점 API 호출 (실제 /api/clinic-grade 사용)
  const gradeHandwrittenAnswerWithGemini = async (
    dataUrl: string,
    correct: string,
    qText: string
  ): Promise<any> => {
    const res = await fetch("/api/clinic-grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl: dataUrl, correct, questionText: qText }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "AI 채점 API 오류");
    return data;
  };

  const generateAiHint = async (qText: string): Promise<string> => {
    try {
      const res = await fetch("/api/clinic-hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionText: qText }),
      });
      if (!res.ok) throw new Error("API 오류");
      const data = await res.json();
      return (
        (data.hint || "").trim() ||
        "문제의 조건을 다시 한번 꼼꼼히 읽고 식을 세워보세요."
      );
    } catch {
      return "문제의 조건을 다시 한번 꼼꼼히 읽고 식을 세워보세요.";
    }
  };

  const findNextUnresolvedIndex = (fromIdx: number) => {
    const isResolved = (i: number) => {
      const st = qBoxStatus.current[i];
      return (
        st === "correct_blue" ||
        st === "correct_yellow" ||
        st === "retry_yellow" ||
        st === "O" ||
        st === "TO" ||
        st === "RO"
      );
    };
    const n = questions.length;
    for (let step = 1; step <= n; step++) {
      const i = (fromIdx + step) % n;
      if (!isResolved(i)) return i;
    }
    return null;
  };

  // 문항 정답 처리 (실제 /clinic/viewer의 processCorrectAnswer와 동일)
  const processCorrectAnswer = useCallback(
    (qItem: any, idx: number, _fromRecheck: boolean) => {
      const currentStatus = qBoxStatus.current[idx];
      const isAlreadyCorrect =
        currentStatus === "correct_blue" ||
        currentStatus === "correct_yellow" ||
        currentStatus === "retry_yellow" ||
        currentStatus === "O" ||
        currentStatus === "TO" ||
        currentStatus === "RO";
      if (isAlreadyCorrect) return;

      const usedHint = hintState.current[idx]?.revealed;
      const helped = taHintState.current[idx] || usedHint;
      const wasWrongBefore =
        currentStatus === "wrong_red" ||
        currentStatus === "X" ||
        currentStatus === "TX" ||
        currentStatus === "B";

      correctSolvedCountRef.current++;
      qBoxStatus.current[idx] =
        wasWrongBefore || isRetryMode
          ? "retry_yellow"
          : helped
          ? "correct_yellow"
          : "correct_blue";

      const nextIdx = findNextUnresolvedIndex(idx);
      if (nextIdx === null) {
        // 모든 문항 해결 완료!
        setAssignmentStatus("최종완료");
        setEmptyState({
          title: "모든 문제를 해결했습니다!",
          desc: "수고하셨습니다. 이제 홈(포털)으로 돌아가세요.",
          awaited: false,
        });
        setVirtualSeatStudent((prev: any) => ({
          ...prev,
          status: "submitted",
          score: 100,
        }));
        appendLog(
          "border-emerald-500",
          "bg-emerald-100 text-emerald-600",
          "답안제출",
          `[${SEAT_NO}] ${TEST_STUDENT_NAME} 제출 완료`,
          `모든 문항(${questions.length}문항) 해결 완료! 최종 완료 처리되었습니다.`,
          "submit",
          { seat: SEAT_NO }
        );
      } else {
        setCurrentQIndex(nextIdx);
        setTimeout(() => setCanvasClearTrigger((p) => p + 1), 100);
      }
      forceUpdate();
    },
    [appendLog, forceUpdate, isRetryMode, questions]
  );

  // 우측 관제탑에 AI/수동 채점 재확인 요청 전송
  const pushRecheckToSupervisor = useCallback(
    (payload: any) => {
      setVirtualSeatStudent((prev: any) => ({
        ...prev,
        rechecks: { ...(prev.rechecks || {}), [payload.uid]: payload },
      }));
      appendLog(
        "border-indigo-500",
        "bg-indigo-100 text-indigo-600",
        "재확인요청",
        `[${SEAT_NO}] ${TEST_STUDENT_NAME} 채점/재확인 요청`,
        `${payload.qNum}번 문항 · 클릭하여 답안을 확인하고 정답/오답을 판정하세요.`,
        "recheck",
        { seat: SEAT_NO, uid: payload.uid, qNum: payload.qNum }
      );
    },
    [appendLog]
  );

  // 비타이머 라운드: 단일 문항 제출 (실제 /clinic/viewer의 submitSingleAnswer와 동일)
  const submitSingleAnswer = async () => {
    const currentStatus = qBoxStatus.current[currentQIndex];
    const isAlreadyCorrect =
      currentStatus === "correct_blue" ||
      currentStatus === "correct_yellow" ||
      currentStatus === "retry_yellow" ||
      currentStatus === "O" ||
      currentStatus === "TO" ||
      currentStatus === "RO";

    if (
      isSubmitting ||
      timeIsUp ||
      callState.current[currentQIndex] ||
      recheckState.current[currentQIndex] === "pending" ||
      isAlreadyCorrect
    )
      return;

    const qItem = questions[currentQIndex];
    const isSubjective = !isObjectiveQuestion(qItem);
    const useAI = isSubjective && getAnswerMode(currentQIndex, qItem) === "pen";
    const myAns = studentAnswers.current[currentQIndex];

    if (!myAns) {
      alert(useAI ? "답을 먼저 그려주세요!" : "정답을 먼저 입력해주세요!");
      return;
    }

    const stageEl = typeof document !== "undefined" ? document.getElementById("preview-question-stage") : null;
    const stageDims = useAI ? await measureStageDimensions(stageEl, myAns) : { stageWidth: 640, stageHeight: 480, cropHeight: 320 };
    const aiCompositeAns = useAI ? ((await captureCompositeQuestionImage(stageEl, myAns)) || myAns) : myAns;

    // aiGradable === false 인 손글씨 문항은 즉시 우측 관제탑 로그로 수동 채점 요청 전송
    if (useAI && qItem.aiGradable === false) {
      recheckState.current[currentQIndex] = "pending";
      const payload = {
        uid: qItem.uid,
        qNum: currentQIndex + 1,
        questionText: qItem.questionText,
        questionText2: qItem.questionText2 || "",
        imageUrl: qItem.imageUrl || "",
        image2Url: qItem.image2Url || "",
        stageWidth: stageDims.stageWidth,
        stageHeight: stageDims.stageHeight,
        cropHeight: stageDims.cropHeight,
        correctAnswer: qItem.answer,
        imageDataUrl: myAns,
        recognizedText: "",
        aiExplanation: "",
        aiConfidence: null,
        initial: true,
      };
      pushRecheckToSupervisor(payload);
      setRecheckToast("✏️ 이 문제는 선생님이 직접 확인해요. 우측 관제탑 로그를 눌러 채점해보세요!");
      setTimeout(() => setRecheckToast(""), 4000);
      forceUpdate();
      return;
    }

    setIsSubmitting(true);
    let isCorrect = false;
    let gradingMeta: any = null;

    if (useAI) {
      try {
        gradingMeta = await gradeHandwrittenAnswerWithGemini(
          aiCompositeAns,
          qItem.answer,
          qItem.questionText
        );
        isCorrect = !!gradingMeta.is_correct;
      } catch (err: any) {
        setIsSubmitting(false);
        alert("AI 채점 중 오류 발생:\n" + err.message);
        return;
      }
    } else if (isSubjective) {
      isCorrect =
        keypadAnswersMatch(myAns, qItem.answer) || mcAnswersMatch(myAns, qItem.answer);
    } else {
      isCorrect =
        mcAnswersMatch(myAns, qItem.answer) || keypadAnswersMatch(myAns, qItem.answer);
    }

    lastGradingContextRef.current = useAI
      ? { idx: currentQIndex, uid: qItem.uid, q: qItem, imageDataUrl: myAns, stageDims, gradingMeta }
      : null;
    const gotTaHint = !!taHintState.current[currentQIndex];

    if (isCorrect) {
      processCorrectAnswer(qItem, currentQIndex, false);
      setResultModal({
        isCorrect: true,
        note: gotTaHint ? "선생님 힌트를 받아 해결했어요." : null,
        canRecheck: false,
      });
    } else if (useAI) {
      recheckState.current[currentQIndex] = "pending";
      const payload = {
        uid: qItem.uid,
        qNum: currentQIndex + 1,
        questionText: qItem.questionText,
        questionText2: qItem.questionText2 || "",
        imageUrl: qItem.imageUrl || "",
        image2Url: qItem.image2Url || "",
        stageWidth: stageDims.stageWidth,
        stageHeight: stageDims.stageHeight,
        cropHeight: stageDims.cropHeight,
        correctAnswer: qItem.answer,
        imageDataUrl: myAns,
        recognizedText: gradingMeta?.recognized_text || "",
        aiExplanation: gradingMeta?.explanation || "",
        aiConfidence: gradingMeta?.confidence || null,
        initial: true,
      };
      pushRecheckToSupervisor(payload);
      setRecheckToast(
        "✏️ 선생님이 꼼꼼하게 확인하고 있어요. 우측 관제탑 로그에서 [채점 확인]을 눌러보세요!"
      );
      setTimeout(() => setRecheckToast(""), 4500);
      forceUpdate();
    } else {
      qBoxStatus.current[currentQIndex] = "wrong_red";
      setResultModal({
        isCorrect: false,
        note: gotTaHint
          ? "선생님 힌트를 받았지만 아직 오답이에요. (TX로 기록됨)"
          : null,
        canRecheck: true,
      });
      lastGradingContextRef.current = {
        idx: currentQIndex,
        uid: qItem.uid,
        q: qItem,
        imageDataUrl: null,
        gradingMeta: { recognized_text: String(myAns || "") },
      };
    }
    setIsSubmitting(false);
    forceUpdate();
  };

  // 결과 모달에서 [선생님께 재확인 요청] 클릭 시
  const requestRecheck = () => {
    if (!lastGradingContextRef.current) return;
    const { idx, uid, q, imageDataUrl, stageDims, gradingMeta } = lastGradingContextRef.current;
    setResultModal(null);
    recheckState.current[idx] = "pending";
    const payload = {
      uid,
      qNum: idx + 1,
      questionText: q.questionText,
      questionText2: q.questionText2 || "",
      imageUrl: q.imageUrl || "",
      image2Url: q.image2Url || "",
      stageWidth: stageDims?.stageWidth || 640,
      stageHeight: stageDims?.stageHeight || 480,
      cropHeight: stageDims?.cropHeight || 320,
      correctAnswer: q.answer,
      imageDataUrl,
      recognizedText:
        gradingMeta?.recognized_text || String(studentAnswers.current[idx] || ""),
      aiExplanation: gradingMeta?.explanation || "",
      aiConfidence: gradingMeta?.confidence || null,
    };
    pushRecheckToSupervisor(payload);
    lastGradingContextRef.current = null;
    setRecheckToast("🔄 선생님께 다시 확인해 달라고 요청했어요. 우측 라이브 로그에서 판정해보세요!");
    setTimeout(() => setRecheckToast(""), 4000);
    forceUpdate();
  };

  // 타이머 시험 종료/제출 후 리뷰 목록에서 재확인 요청 클릭 시
  const requestRecheckForReviewItem = (item: any) => {
    recheckState.current[item.idx] = "pending";
    const payload = {
      uid: item.uid,
      qNum: item.qNum,
      questionText: item.questionText,
      correctAnswer: item.correctAnswer,
      imageDataUrl: item.imageDataUrl,
      recognizedText: item.recognizedText,
      aiExplanation: item.aiExplanation,
      aiConfidence: item.aiConfidence,
    };
    pushRecheckToSupervisor(payload);
    setPendingRecheckReview((prev) =>
      prev.map((r) => (r.uid === item.uid ? { ...r, requested: true } : r))
    );
  };

  // 타이머 시험 일괄 채점 및 제출 (실제 /clinic/viewer의 handleTimeUp과 동일)
  const handleTimeUpRef = useRef<any>(null);
  const handleTimeUp = async (forceAction?: string) => {
    if (timeIsUp) return;
    setTimeIsUp(true);
    setIsBatchGrading(true);

    let corrects = 0;
    let earnedTotal = 0;
    const reviewList: any[] = [];

    if (isTimedRound) {
      for (let idx = 0; idx < questions.length; idx++) {
        const qItem = questions[idx];
        const currentStatus = qBoxStatus.current[idx];
        if (
          currentStatus === "correct_blue" ||
          currentStatus === "correct_yellow" ||
          currentStatus === "retry_yellow" ||
          currentStatus === "O" ||
          currentStatus === "TO" ||
          currentStatus === "RO"
        ) {
          corrects++;
          earnedTotal += qItem.assigned_score || 100 / (questions.length || 1);
          continue;
        }

        const isSubj = !isObjectiveQuestion(qItem);
        const mode = getAnswerMode(idx, qItem);
        const ans =
          isSubj && mode === "pen"
            ? studentDrawings.current[idx]
            : studentAnswers.current[idx];
        const isBlank = !ans || String(ans).trim() === "" || String(ans).trim() === "미입력";

        if (isBlank) {
          qBoxStatus.current[idx] = "wrong_red";
        } else {
          let isCorrect = false;
          let meta: any = null;
          if (isSubj && mode === "pen") {
            if (qItem.aiGradable !== false) {
              try {
                meta = await gradeHandwrittenAnswerWithGemini(
                  ans,
                  qItem.answer,
                  qItem.questionText
                );
                isCorrect = !!meta.is_correct;
              } catch {
                isCorrect = false;
              }
            }
          } else if (isSubj) {
            isCorrect =
              keypadAnswersMatch(ans, qItem.answer) || mcAnswersMatch(ans, qItem.answer);
          } else {
            isCorrect =
              mcAnswersMatch(ans, qItem.answer) || keypadAnswersMatch(ans, qItem.answer);
          }

          if (isCorrect) {
            qBoxStatus.current[idx] = "correct_blue";
            corrects++;
            earnedTotal += qItem.assigned_score || 100 / (questions.length || 1);
          } else {
            qBoxStatus.current[idx] = "wrong_red";
            if (isSubj && mode === "pen") {
              reviewList.push({
                idx,
                uid: qItem.uid,
                qNum: idx + 1,
                questionText: qItem.questionText,
                correctAnswer: qItem.answer,
                imageDataUrl: ans,
                recognizedText: meta?.recognized_text || "",
                aiExplanation: meta?.explanation || "",
                aiConfidence: meta?.confidence || null,
                requested: false,
                resolved: false,
                verdict: null,
              });
            }
          }
        }
      }
      correctSolvedCountRef.current = corrects;
      const finalScore = roundScore(earnedTotal);
      setInitialScore(finalScore);
      setAssignmentStatus("제출완료");
      setHasPendingVerification(true);
      setVerificationOverrides({});

      setVirtualSeatStudent((prev: any) => ({
        ...prev,
        status: "submitted",
        score: finalScore,
      }));
      appendLog(
        "border-emerald-500",
        "bg-emerald-100 text-emerald-600",
        "답안제출",
        `[${SEAT_NO}] ${TEST_STUDENT_NAME} 제출`,
        `가채점 점수 [${finalScore}점] (${corrects}/${questions.length}문항 정답) · 검수 대기 중`,
        "submit",
        { seat: SEAT_NO, score: finalScore }
      );
    }

    setPendingRecheckReview(reviewList);
    setIsBatchGrading(false);

    if (forceAction) {
      setSessionTimeUpModal(true);
    } else if (isTimedRound) {
      setSubmitResultModal(true);
    } else {
      setSessionTimeUpModal(true);
    }

    if (reviewList.length === 0) {
      if (autoLeaveTimerRef.current) clearInterval(autoLeaveTimerRef.current);
      let sec = 10;
      setAutoLeaveSec(sec);
      const timerId = setInterval(() => {
        sec--;
        setAutoLeaveSec(sec);
        if (sec <= 0) {
          clearInterval(timerId);
          autoLeaveTimerRef.current = null;
          leaveToPortal();
        }
      }, 1000);
      autoLeaveTimerRef.current = timerId;
    }
    forceUpdate();
  };
  handleTimeUpRef.current = handleTimeUp;

  // 학생: 문항 질문 호출 토글
  const handleViewerCallToggle = () => {
    if (!callState.current[currentQIndex] && isPortalAway) {
      alert("자리비움 중에는 호출 불가합니다.");
      return;
    }
    const willCall = !callState.current[currentQIndex];
    callState.current[currentQIndex] = willCall;
    const qItem = questions[currentQIndex];
    const qNum = currentQIndex + 1;

    if (willCall) {
      const callPayload = {
        qNum,
        questionText: qItem.questionText,
        questionText2: qItem.questionText2 || "",
        imageUrl: qItem.imageUrl,
        image2Url: qItem.image2Url || "",
        options: qItem.options,
        answer: qItem.answer,
        explanation: qItem.explanation,
        source: qItem.source,
      };
      setVirtualSeatStudent((prev: any) => ({
        ...prev,
        status: "call",
        totalCalls: (prev.totalCalls || 0) + 1,
        calls: { ...(prev.calls || {}), [qNum]: callPayload },
      }));
      appendLog(
        "border-rose-500",
        "bg-rose-100 text-rose-600",
        "질문호출",
        `[${SEAT_NO}] ${TEST_STUDENT_NAME} 질문 요청`,
        `${qNum}번 문항 설명 대기 중`,
        "call",
        { seat: SEAT_NO, qNum }
      );
    } else {
      setVirtualSeatStudent((prev: any) => {
        const nextCalls = { ...(prev.calls || {}) };
        delete nextCalls[qNum];
        return {
          ...prev,
          calls: nextCalls,
          status: Object.keys(nextCalls).length > 0 ? "call" : isPortalAway ? "away" : "idle",
        };
      });
      removeLogsByType("call", qNum);
    }
    forceUpdate();
  };

  // 포털: 일반 선생님 부르기 토글
  const handlePortalCallToggle = () => {
    if (!isPortalCalling && isPortalAway) {
      alert("자리비움 중에는 호출할 수 없습니다.");
      return;
    }
    const next = !isPortalCalling;
    setIsPortalCalling(next);
    if (next) {
      setVirtualSeatStudent((prev: any) => ({
        ...prev,
        status: "call",
        totalCalls: (prev.totalCalls || 0) + 1,
        calls: { ...(prev.calls || {}), general: { qNum: "general" } },
      }));
      appendLog(
        "border-rose-500",
        "bg-rose-100 text-rose-600",
        "조교호출",
        `[${SEAT_NO}] ${TEST_STUDENT_NAME} 조교 호출`,
        "포탈에서 호출했습니다 · 확인 후 처리하세요.",
        "call",
        { seat: SEAT_NO, qNum: "general" }
      );
    } else {
      setVirtualSeatStudent((prev: any) => {
        const nextCalls = { ...(prev.calls || {}) };
        delete nextCalls["general"];
        return {
          ...prev,
          calls: nextCalls,
          status: Object.keys(nextCalls).length > 0 ? "call" : isPortalAway ? "away" : "idle",
        };
      });
      removeLogsByType("call", "general");
    }
  };

  // 자리비움 토글 (포털 & 뷰어 공통)
  const handleAwayToggle = () => {
    const hasActiveCall =
      isPortalCalling || Object.values(callState.current).some((v) => v);
    if (!isPortalAway && hasActiveCall) {
      alert("선생님 호출 중에는 자리를 비울 수 없습니다.");
      return;
    }
    const next = !isPortalAway;
    setIsPortalAway(next);
    if (next) {
      setVirtualSeatStudent((prev: any) => ({
        ...prev,
        status: "away",
      }));
      appendLog(
        "border-amber-500",
        "bg-amber-100 text-amber-700",
        "자리비움",
        `[${SEAT_NO}] ${TEST_STUDENT_NAME} 자리비움`,
        "학생이 자리를 비웠습니다.",
        "away",
        { seat: SEAT_NO }
      );
    } else {
      setVirtualSeatStudent((prev: any) => ({
        ...prev,
        status: Object.keys(prev.calls || {}).length > 0 ? "call" : "idle",
      }));
      removeLogsByType("away");
    }
  };

  // 포털: 클리닉 종료 요청 토글
  const handlePortalEndRequestToggle = () => {
    if (endRequestStatus === "pending") {
      setEndRequestStatus("idle");
      setVirtualSeatStudent((prev: any) => ({ ...prev, endRequestPending: false }));
      removeLogsByType("end_request");
    } else {
      setEndRequestStatus("pending");
      setVirtualSeatStudent((prev: any) => ({ ...prev, endRequestPending: true }));
      appendLog(
        "border-rose-500",
        "bg-rose-100 text-rose-600",
        "종료요청",
        `[${SEAT_NO}] ${TEST_STUDENT_NAME} 클리닉 종료 요청`,
        "클리닉 종료를 요청했습니다 · 클릭해서 승인/거부하세요.",
        "end_request",
        { seat: SEAT_NO }
      );
    }
  };

  // 관제탑 액션: 질문 호출 처리 (skip / hint)
  const resolveSupervisorCall = (qNum: any, mark: "skip" | "hint") => {
    if (qNum === "general") {
      setIsPortalCalling(false);
    } else {
      const idx = Number(qNum) - 1;
      if (idx >= 0) {
        callState.current[idx] = false;
        if (mark === "hint") {
          taHintState.current[idx] = true;
        }
      }
    }

    setVirtualSeatStudent((prev: any) => {
      const nextCalls = { ...(prev.calls || {}) };
      delete nextCalls[qNum];
      return {
        ...prev,
        calls: nextCalls,
        status: mark === "hint" ? "hint" : Object.keys(nextCalls).length > 0 ? "call" : "idle",
        totalHints: mark === "hint" ? (prev.totalHints || 0) + 1 : prev.totalHints,
      };
    });

    removeLogsByType("call", qNum);
    appendLog(
      "border-emerald-500",
      "bg-emerald-100 text-emerald-700",
      mark === "hint" ? "힌트제공" : "호출처리",
      `[${SEAT_NO}] ${TEST_STUDENT_NAME} ${qNum === "general" ? "일반 호출" : `${qNum}번 질문`} 처리 완료`,
      mark === "hint"
        ? "조교/선생님이 힌트를 제공하고 호출을 종료했습니다."
        : "호출 확인을 완료했습니다."
    );
    setCallProcessModal(null);
    forceUpdate();
  };

  // 관제탑 액션: AI/수동 재확인 판정 ('correct' | 'incorrect')
  const resolveSupervisorRecheck = (uid: string, verdict: "correct" | "incorrect") => {
    const qIdx = questions.findIndex((q) => q.uid === uid);
    if (qIdx >= 0) {
      recheckState.current[qIdx] = null;
      if (verdict === "correct") {
        setRecheckToast(`🎉 선생님이 ${qIdx + 1}번 문항을 정답으로 인정했어요!`);
        processCorrectAnswer(questions[qIdx], qIdx, true);
      } else {
        qBoxStatus.current[qIdx] = "wrong_red";
        studentAnswers.current[qIdx] = null;
        delete studentDrawings.current[qIdx];
        delete keypadAnswers.current[qIdx];
        delete keypadCursor.current[qIdx];
        setCanvasClearTrigger((p) => p + 1);
        setRecheckToast("선생님 확인 결과 오답이 맞습니다. 다시 풀어보세요!");
      }
      setTimeout(() => setRecheckToast(""), 4000);
    }

    setPendingRecheckReview((prev) =>
      prev.map((r) => (r.uid === uid ? { ...r, resolved: true, verdict } : r))
    );

    setVirtualSeatStudent((prev: any) => {
      const nextRechecks = { ...(prev.rechecks || {}) };
      delete nextRechecks[uid];
      return { ...prev, rechecks: nextRechecks };
    });

    removeLogsByType("recheck", undefined, uid);
    appendLog(
      verdict === "correct" ? "border-emerald-500" : "border-rose-500",
      verdict === "correct"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-rose-100 text-rose-700",
      verdict === "correct" ? "정답인정" : "오답확정",
      `[${SEAT_NO}] ${qIdx + 1}번 문항 ${verdict === "correct" ? "정답 인정" : "오답 판정"}`,
      verdict === "correct"
        ? "학생 화면에 즉시 정답(TO)으로 반영되었습니다."
        : "학생 화면에 오답으로 반영되어 재풀이가 활성화되었습니다."
    );
    setRecheckModal({ isOpen: false, uid: null });
    forceUpdate();
  };

  // 관제탑 액션: 타이머 시험 채점 검수 최종 확정
  const confirmTestVerification = () => {
    let earnedTotal = 0;
    let wrongCount = 0;

    questions.forEach((qItem, idx) => {
      const st = qBoxStatus.current[idx];
      const wasCorrect =
        st === "correct_blue" ||
        st === "correct_yellow" ||
        st === "retry_yellow" ||
        st === "O" ||
        st === "TO" ||
        st === "RO";
      const overridden = verificationOverrides[idx] === true;

      if (wasCorrect || overridden) {
        qBoxStatus.current[idx] = "correct_blue";
        earnedTotal += qItem.assigned_score || 100 / (questions.length || 1);
      } else {
        qBoxStatus.current[idx] = "wrong_red";
        wrongCount++;
      }
    });

    const finalScore = roundScore(earnedTotal);
    setInitialScore(finalScore);
    setHasPendingVerification(false);
    setIsVerifyModalOpen(false);

    if (wrongCount === 0 || finalScore === 100) {
      setAssignmentStatus("최종완료");
      appendLog(
        "border-emerald-500",
        "bg-emerald-100 text-emerald-700",
        "검수확정",
        `[${SEAT_NO}] ${TEST_STUDENT_NAME} 채점 확정 (${finalScore}점)`,
        "오답이 없어 즉시 [최종완료] 처리되었습니다."
      );
    } else {
      setAssignmentStatus("채점확정");
      appendLog(
        "border-amber-500",
        "bg-amber-100 text-amber-800",
        "검수확정",
        `[${SEAT_NO}] ${TEST_STUDENT_NAME} 채점 확정 (${finalScore}점 · 오답 ${wrongCount}문항)`,
        "학생 포털 1번 박스가 [✍️ 시험지 오답 고치기] 모드로 전환되었습니다!"
      );
    }

    setRecheckToast("🎉 채점이 확정되어 학생 포털 상태가 갱신되었습니다!");
    setTimeout(() => setRecheckToast(""), 4000);
    forceUpdate();
  };

  // 키패드/손글씨 모드 전환 (실제 /clinic/viewer와 동일)
  const toggleAnswerMode = () => {
    const qCur = questions[currentQIndex];
    const current = getAnswerMode(currentQIndex, qCur);
    const mode = current === "pen" ? "keypad" : "pen";
    if (mode === "keypad" && !isKeypadEnterable(qCur?.answer)) {
      alert("이 문제는 수식이나 문자가 포함되어 있어 손글씨(펜)로만 답을 작성할 수 있습니다.");
      return;
    }
    answerModes.current[currentQIndex] = mode;
    studentAnswers.current[currentQIndex] =
      mode === "pen"
        ? studentDrawings.current[currentQIndex] || null
        : keypadAnswers.current[currentQIndex] || null;
    forceUpdate();
  };

  const handleClearCanvas = () => {
    delete studentDrawings.current[currentQIndex];
    studentAnswers.current[currentQIndex] = null;
    setCanvasClearTrigger((p) => p + 1);
    forceUpdate();
  };

  // 남은 클리닉 이용 시간 문자열
  const clinicRemainingMs = Math.max(0, sessionStartedAt + clinicDurationMs - now);
  const clinicTotalSec = Math.floor(clinicRemainingMs / 1000);
  const clinicRemainingStr = `${String(Math.floor(clinicTotalSec / 60)).padStart(
    2,
    "0"
  )}:${String(clinicTotalSec % 60).padStart(2, "0")}`;
  const isClinicUrgent = clinicRemainingMs <= 5 * 60 * 1000;

  // 학생 포털의 4개 박스 렌더링 (실제 /student/portal/page.tsx 디자인 & 로직 100% 동일)
  const renderPortalCard = (
    typeKey: "exam" | "hw" | "print" | "overdue",
    round: number
  ) => {
    const hasThisExam = targetBox === typeKey;
    const remainCount = hasThisExam ? getRemainingQuestionCount() : 0;
    const isBoxDone =
      !hasThisExam ||
      assignmentStatus === "최종완료" ||
      assignmentStatus === "완료" ||
      (assignmentStatus !== "제출완료" && remainCount === 0);

    // 1번 박스에 미완료 시험이 있을 때만 2~4번 박스 잠금
    const isExamBoxActivePending =
      targetBox === "exam" &&
      assignmentStatus !== "최종완료" &&
      assignmentStatus !== "채점확정" &&
      assignmentStatus !== "제출완료" &&
      remainCount > 0;
    const isLocked = typeKey !== "exam" && !isBoxDone && isExamBoxActivePending;

    const exType = String(examMaster?.exam_type || "").trim();
    const rawTitle = String(examMaster?.title || "문제지").trim();
    const isWeeklyInc = isWeeklyIncorrectExam(
      exType,
      rawTitle,
      examMaster?.sub_title
    );
    const activeExamMode =
      isWeeklyInc || exType === "오답유사" || exType === "과제오답유사"
        ? "SIMILAR"
        : "TEST";

    const isSelectedItemWaiting =
      typeKey === "exam" && hasThisExam && assignmentStatus === "제출완료";
    const isSelectedItemFixing =
      typeKey === "exam" && hasThisExam && assignmentStatus === "채점확정";
    const isSelectedItem100 = isSelectedItemFixing && initialScore === 100;

    let theme: any;
    if (typeKey === "exam") {
      if (hasThisExam && activeExamMode === "SIMILAR") {
        const simLabel = isWeeklyInc
          ? "🖨️ 주간 오답"
          : exType === "오답유사"
          ? "🔁 오답유사"
          : "🔁 과제오답유사";
        const simDesc = isWeeklyInc
          ? "이번 주 틀렸던 오답 문제를 다시 풀어봅니다."
          : "과제에서 틀렸던 문제와 비슷한 문제를 다시 풀어봅니다.";
        theme = {
          label: simLabel,
          desc: simDesc,
          bg: "bg-gradient-to-br from-violet-200 to-violet-50",
          badge: "bg-white/60 text-violet-800 border border-violet-200",
          btnBg: "bg-white hover:bg-violet-50",
          btnText: "text-violet-700",
          textColor: "text-violet-900/80",
          accent: "text-violet-800",
        };
      } else if (["분기테스트", "분기평가"].includes(exType) && hasThisExam) {
        theme = {
          label: "📅 분기평가",
          desc: "해당 분기의 학업 성취도를 종합적으로 평가합니다.",
          bg: "bg-gradient-to-br from-fuchsia-200 to-fuchsia-50",
          badge: "bg-white/60 text-fuchsia-800 border border-fuchsia-200",
          btnBg: "bg-white hover:bg-fuchsia-50",
          btnText: "text-fuchsia-700",
          textColor: "text-fuchsia-900/80",
          accent: "text-fuchsia-800",
        };
      } else if (["중간테스트", "중간평가"].includes(exType) && hasThisExam) {
        theme = {
          label: "📝 중간평가",
          desc: "이번 중간평가를 응시합니다.",
          bg: "bg-gradient-to-br from-indigo-200 to-indigo-50",
          badge: "bg-white/60 text-indigo-800 border border-indigo-200",
          btnBg: "bg-white hover:bg-indigo-50",
          btnText: "text-indigo-700",
          textColor: "text-indigo-900/80",
          accent: "text-indigo-800",
        };
      } else if (["입학테스트", "진단평가"].includes(exType) && hasThisExam) {
        theme = {
          label: "📊 진단평가",
          desc: "현재 실력을 진단하기 위한 평가를 진행합니다.",
          bg: "bg-gradient-to-br from-cyan-200 to-cyan-50",
          badge: "bg-white/60 text-cyan-800 border border-cyan-200",
          btnBg: "bg-white hover:bg-cyan-50",
          btnText: "text-cyan-700",
          textColor: "text-cyan-900/80",
          accent: "text-cyan-800",
        };
      } else {
        const finalLabel =
          !hasThisExam || exType === "주간테스트" || !exType
            ? "📝 주간테스트"
            : `📝 ${exType}`;
        theme = {
          label: finalLabel,
          desc: "오늘 배정된 테스트를 응시합니다.",
          bg: "bg-gradient-to-br from-blue-200 to-blue-50",
          badge: "bg-white/60 text-blue-800 border border-blue-200",
          btnBg: "bg-white hover:bg-blue-50",
          btnText: "text-blue-700",
          textColor: "text-slate-600",
          accent: "text-blue-800",
        };
      }

      if (isSelectedItemWaiting) {
        theme = {
          label: "⏳ 채점 대기 중",
          desc: "제출이 완료되었습니다! 우측 관제탑에서 [검수하기]를 눌러 채점을 확정해 주세요.",
          bg: "bg-gradient-to-br from-slate-200 to-slate-50",
          badge: "bg-slate-300/50 text-slate-800",
          btnBg: "bg-white/50",
          btnText: "text-slate-600",
          textColor: "text-slate-600",
          accent: "text-slate-700",
        };
      } else if (isSelectedItemFixing) {
        theme = {
          label: "✍️ 시험지 오답 고치기",
          desc: "채점이 확정되었습니다. 틀린 문제를 다시 풀고 정답을 입력하세요!",
          bg: "bg-gradient-to-br from-amber-200 to-yellow-50",
          badge: "bg-white/60 text-amber-900 border border-amber-300",
          btnBg: "bg-amber-400 hover:bg-amber-300",
          btnText: "text-amber-950",
          textColor: "text-slate-700",
          accent: "text-amber-800",
        };
      }
    } else if (typeKey === "hw") {
      theme = {
        label: "📚 과제",
        desc: "미제출 과제 문항을 학습합니다.",
        bg: "bg-gradient-to-br from-orange-200 to-orange-50",
        badge: "bg-white/60 text-orange-900 border border-orange-200",
        btnBg: "bg-white hover:bg-orange-50",
        btnText: "text-orange-700",
        textColor: "text-slate-600",
        accent: "text-orange-800",
      };
    } else if (typeKey === "print") {
      theme = {
        label: "🖨️ 오답",
        desc: "틀린 문제들만 모아 다시 풉니다.",
        bg: "bg-gradient-to-br from-emerald-200 to-emerald-50",
        badge: "bg-white/60 text-emerald-900 border border-emerald-200",
        btnBg: "bg-white hover:bg-emerald-50",
        btnText: "text-emerald-700",
        textColor: "text-slate-600",
        accent: "text-emerald-800",
      };
    } else {
      theme = {
        label: "🔥 미완료 과제",
        desc: "기한이 지난 미완료 과제를 최우선으로 해결합니다.",
        bg: "bg-gradient-to-br from-rose-200 to-rose-50",
        badge: "bg-white/60 text-rose-900 border border-rose-200",
        btnBg: "bg-white hover:bg-rose-50",
        btnText: "text-rose-700",
        textColor: "text-slate-600",
        accent: "text-rose-800",
      };
    }

    const titleArray = hasThisExam && !isBoxDone ? [rawTitle] : [];

    return (
      <div
        key={typeKey}
        className={`w-full h-full min-h-52.5 ${theme.bg} rounded-4xl p-6 md:p-7 shadow-xl relative overflow-hidden group flex flex-col justify-between transition-all duration-300 ${
          isLocked ? "grayscale opacity-60 bg-slate-200" : ""
        } ${hasThisExam ? "ring-2 ring-brand/30" : ""}`}
      >
        {isLocked && <div className="absolute inset-0 bg-white/40 z-0"></div>}
        {isBoxDone && (
          <span className="absolute top-5 right-5 bg-white/90 text-slate-800 text-xs md:text-sm font-bold px-3.5 py-1.5 rounded-full shadow-md z-20 border border-slate-100">
            ✅ 모두 완료됨
          </span>
        )}

        <div className="relative z-10 shrink-0">
          <div className="flex flex-wrap items-center gap-2 mb-2.5 pr-27.5">
            <span
              className={`text-xs md:text-sm font-bold ${
                isLocked ? "bg-white/60 text-slate-500 shadow-sm" : theme.badge
              } px-3.5 py-1.5 rounded-xl shadow-sm flex items-center`}
            >
              {isLocked ? "🔒 잠김" : theme.label}
            </span>
          </div>

          <div className="absolute top-0 right-0 flex flex-col items-end gap-1.5 z-20">
            {isSelectedItemWaiting && initialScore !== null && (
              <span className="text-xs md:text-sm font-bold text-slate-700 bg-white/70 px-3 py-1.5 rounded-lg whitespace-nowrap shadow-sm border border-white/50">
                가채점: {initialScore}점
              </span>
            )}
            {!isBoxDone && !isSelectedItemWaiting && remainCount > 0 && (
              <span className="text-xs md:text-sm font-bold text-slate-700 bg-white/70 px-3 py-1.5 rounded-lg whitespace-nowrap shadow-sm border border-white/50">
                남은 문제: {remainCount}
              </span>
            )}
          </div>

          <h3
            className={`text-2xl md:text-[28px] font-bold mb-1 leading-tight ${
              isLocked ? "text-slate-400" : "text-slate-800"
            }`}
          >
            {isSelectedItemWaiting
              ? "채점 결과 확인 중"
              : isSelectedItemFixing && !isSelectedItem100
              ? "시험지 오답 고치기"
              : isSelectedItem100
              ? "모든 문제를 맞췄습니다!"
              : `${theme.label.replace(/[^가-힣 ]/g, "").trim()} 클리닉`}
          </h3>

          <p
            className={`text-xs md:text-sm font-medium leading-snug ${
              isLocked ? "text-slate-400" : theme.textColor
            }`}
          >
            {isLocked
              ? "첫 번째 학습을 먼저 제출해주세요."
              : isSelectedItem100
              ? "선택하신 학습에 더 이상 정정할 오답이 없습니다!"
              : theme.desc}
          </p>
        </div>

        <div className="relative z-10 flex flex-1 min-h-0 items-end justify-between gap-3 mt-3">
          <div className="flex-1 min-w-0">
            {!isBoxDone &&
              titleArray.map((t, idx) => (
                <div
                  key={idx}
                  className={`text-base md:text-lg font-bold ${theme.accent} truncate flex items-center gap-2`}
                  title={t}
                >
                  <span className="w-2 h-2 rounded-full bg-current opacity-70 shrink-0"></span>
                  <span className="truncate text-slate-800">{t}</span>
                </div>
              ))}
          </div>

          <div className="shrink-0">
            {isBoxDone ? (
              <button
                disabled
                className="bg-white/70 text-slate-500 font-bold px-6 py-3 text-base rounded-2xl shadow-sm opacity-90 cursor-not-allowed"
              >
                학습 전체 완료
              </button>
            ) : isSelectedItemWaiting ? (
              <button
                disabled
                className="bg-white/60 text-slate-500 font-bold px-6 py-3 text-base rounded-2xl shadow-sm cursor-not-allowed flex items-center gap-1.5"
              >
                <span>🔒</span> 확인 대기
              </button>
            ) : isLocked ? (
              <button
                disabled
                className="bg-white/50 text-slate-400 font-bold px-6 py-3 text-base rounded-2xl shadow-sm cursor-not-allowed flex items-center gap-1.5 border border-white"
              >
                <span>🔒</span> 잠김
              </button>
            ) : (
              <button
                onClick={() => handleStartFromPortal(typeKey)}
                className={`${theme.btnBg} ${theme.btnText} font-bold px-7 py-3 text-base md:text-lg rounded-2xl shadow-md border border-white/50 hover:shadow-lg hover:scale-105 transition-all cursor-pointer`}
              >
                {isSelectedItemFixing ? "오답 정정 시작하기" : "학습하기"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (isLoadingExam) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-100 font-pretendard">
        <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-lg font-bold text-slate-700">
          클리닉 미리보기 환경을 준비하고 있습니다...
        </p>
      </div>
    );
  }

  if (loadError || !examMaster) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-100 font-pretendard p-6">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center border border-slate-200">
          <div className="text-5xl mb-3">⚠️</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            문제지를 불러올 수 없습니다
          </h2>
          <p className="text-sm text-slate-500 font-bold mb-6">{loadError}</p>
          <button
            onClick={() => window.close()}
            className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold text-sm hover:bg-slate-900"
          >
            창 닫기
          </button>
        </div>
      </div>
    );
  }

  const q = questions[currentQIndex];
  const availableBooks = [
    ...new Map(
      questions.filter((qq) => qq.bookType != null).map((qq) => [qq.bookType, qq])
    ).values(),
  ].map((qq) => ({
    bookType: qq.bookType,
    count: questions.filter((x) => x.bookType === qq.bookType).length,
  }));
  const visibleIndices = questions
    .map((_, i) => i)
    .filter((i) => bookFilter === "all" || questions[i].bookType === bookFilter);

  const switchBookFilter = (bt: string | "all") => {
    setBookFilter(bt);
    if (bt !== "all") {
      const idx = questions.findIndex((qq) => qq.bookType === bt);
      if (idx !== -1) {
        setCurrentQIndex(idx);
        setCanvasClearTrigger((p) => p + 1);
      }
    }
  };

  const isSubjective = q && !isObjectiveQuestion(q);
  const curAnsMode = getAnswerMode(currentQIndex, q);
  const isCall = !!callState.current[currentQIndex];
  const isRecheck = recheckState.current[currentQIndex] === "pending";
  const isCurrentAlreadyCorrect =
    qBoxStatus.current[currentQIndex] === "correct_blue" ||
    qBoxStatus.current[currentQIndex] === "correct_yellow" ||
    qBoxStatus.current[currentQIndex] === "retry_yellow" ||
    qBoxStatus.current[currentQIndex] === "O" ||
    qBoxStatus.current[currentQIndex] === "TO" ||
    qBoxStatus.current[currentQIndex] === "RO";

  const activeRecheckItem =
    recheckModal.isOpen && recheckModal.uid
      ? virtualSeatStudent.rechecks?.[recheckModal.uid]
      : null;

  const wrongQuestionsForVerify = questions
    .map((qItem, idx) => {
      const st = qBoxStatus.current[idx];
      const isCorrect =
        st === "correct_blue" ||
        st === "correct_yellow" ||
        st === "retry_yellow" ||
        st === "O" ||
        st === "TO" ||
        st === "RO";
      const isSubj = !isObjectiveQuestion(qItem);
      const mode = getAnswerMode(idx, qItem);
      const rawAns =
        isSubj && mode === "pen"
          ? studentDrawings.current[idx]
          : studentAnswers.current[idx];
      const cleanInput = rawAns ? String(rawAns).trim() : "";
      const isDrawing = cleanInput.startsWith("data:image");
      return {
        ...qItem,
        idx,
        isCorrect,
        cleanInput,
        isDrawing,
      };
    })
    .filter((item) => !item.isCorrect);

  return (
    <div
      className="h-screen w-screen flex overflow-hidden bg-slate-200 font-pretendard select-none"
      onKeyDown={triggerTypingIndicator}
      onPointerDown={triggerTypingIndicator}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
          @keyframes pulse-red { 0%, 100% { border-color: #ef4444; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); } 50% { border-color: #fca5a5; box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); } }
          .status-help { animation: pulse-red 1.2s infinite; background-color: #fef2f2; border: 2px solid #ef4444; }
          @keyframes flash-yellow { 0%, 100% { background-color: white; } 50% { background-color: #fef9c3; border-color: #eab308; } }
          .hint-flash { animation: flash-yellow 1.5s ease-in-out infinite; }
          @keyframes blink-dot { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
          .dot-live { animation: blink-dot 1.6s ease-in-out infinite; }
        `,
        }}
      />

      {/* =====================================================================
          좌측 70%: 학생 포털 화면 & 실제 클리닉 풀이 뷰어
      ===================================================================== */}
      <div className="w-[70%] h-full flex flex-col border-r-2 border-slate-300 bg-slate-100 relative overflow-hidden">
        {/* 상단 시뮬레이터 안내 바 */}
        <div className="bg-slate-900 text-white px-5 py-2 flex items-center justify-between text-xs shrink-0 z-30">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="bg-violet-600 text-white font-bold px-2 py-0.5 rounded text-[11px] shrink-0">
              🖥️ 클리닉 미리보기 모드
            </span>
            <span className="font-bold text-slate-200 truncate">
              {examMaster.title}
            </span>
            <span className="text-slate-400 font-bold shrink-0">
              ({examMaster.exam_type || "평가"} · 총 {questions.length}문항)
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-slate-400 font-bold text-[11px]">박스 배치:</span>
            {(
              [
                { key: "exam", label: "1번(평가/주간오답)" },
                { key: "hw", label: "2번(과제)" },
                { key: "print", label: "3번(통합오답)" },
                { key: "overdue", label: "4번(미완료)" },
              ] as const
            ).map((b) => (
              <button
                key={b.key}
                onClick={() => {
                  setTargetBox(b.key);
                  setLeftViewMode("portal");
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                  targetBox === b.key
                    ? "bg-brand text-white"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {leftViewMode === "portal" ? (
          /* -------------------- 1. 학생 포털 화면 -------------------- */
          <div className="flex-1 flex flex-col overflow-y-auto p-6 md:p-8 bg-slate-100">
            {/* 포털 상단 헤더 */}
            <header className="bg-white rounded-3xl shadow-sm px-6 py-4 mb-6 flex flex-wrap items-center justify-between gap-4 border border-slate-200 shrink-0">
              <div className="flex items-center gap-4">
                <img
                  src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png"
                  alt="Logica"
                  className="h-7 object-contain"
                />
                <div className="w-px h-6 bg-slate-200"></div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="bg-brand text-white text-xs font-bold px-2.5 py-0.5 rounded-lg">
                      좌석 {SEAT_NO}
                    </span>
                    <span className="text-lg md:text-xl font-bold text-slate-800">
                      {TEST_STUDENT_NAME} 학생
                    </span>
                    <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-lg border border-indigo-100">
                      {virtualSeatStudent.classes[0]}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap">
                <div
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-sm border shadow-sm ${
                    isClinicUrgent
                      ? "bg-rose-100 border-rose-300 text-rose-600 animate-pulse"
                      : "bg-indigo-50 border-indigo-200 text-indigo-700"
                  }`}
                >
                  <span>🕐</span>
                  <span className="text-xs opacity-80">남은 시간</span>
                  <span className="font-lexend text-base">{clinicRemainingStr}</span>
                </div>

                <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-3.5 py-2 rounded-xl shadow-sm">
                  <span className="text-xs font-bold text-amber-700">포인트</span>
                  <span className="text-amber-600 font-bold text-base font-lexend">
                    {points.toLocaleString()} P
                  </span>
                </div>

                <button
                  onClick={handleAwayToggle}
                  className={`px-3.5 py-2 rounded-xl font-bold text-xs md:text-sm border shadow-sm transition-colors ${
                    isPortalAway
                      ? "bg-amber-500 border-amber-500 text-white"
                      : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {isPortalAway ? "↩️ 자리 복귀" : "🚶 화장실 다녀오기"}
                </button>

                <button
                  onClick={handlePortalCallToggle}
                  className={`px-3.5 py-2 rounded-xl font-bold text-xs md:text-sm shadow-sm transition-colors ${
                    isPortalCalling
                      ? "bg-rose-700 text-white"
                      : "bg-rose-500 hover:bg-rose-600 text-white"
                  }`}
                >
                  {isPortalCalling ? "🚨 부르기 취소" : "🙋 선생님 부르기"}
                </button>

                <button
                  onClick={handlePortalEndRequestToggle}
                  className={`px-3.5 py-2 rounded-xl font-bold text-xs md:text-sm border shadow-sm transition-colors ${
                    endRequestStatus === "pending"
                      ? "bg-rose-50 border-rose-300 text-rose-600 animate-pulse"
                      : "bg-slate-800 hover:bg-slate-900 text-white border-slate-800"
                  }`}
                >
                  {endRequestStatus === "pending" ? "🚪 종료 요청 취소" : "🚪 클리닉 종료"}
                </button>
              </div>
            </header>

            {recheckToast && (
              <div className="mb-4 bg-indigo-600 text-white px-5 py-3 rounded-2xl shadow-lg font-bold text-sm text-center animate-bounce">
                {recheckToast}
              </div>
            )}

            {/* 4개 클리닉 박스 그리드 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1">
              {renderPortalCard("exam", 1)}
              {renderPortalCard("hw", 2)}
              {renderPortalCard("print", 3)}
              {renderPortalCard("overdue", 4)}
            </div>
          </div>
        ) : (
          /* -------------------- 2. 클리닉 문제 풀이 뷰어 화면 -------------------- */
          <div className="flex-1 flex flex-col overflow-hidden relative bg-slate-100">
            {/* 시작 전 인트로 오버레이 모달 */}
            {!isStarted && (
              <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-40 p-6">
                <div className="bg-white rounded-4xl shadow-2xl p-8 md:p-10 w-full max-w-xl text-center">
                  <img
                    src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png"
                    alt="Logica"
                    className="h-9 mx-auto mb-5 object-contain"
                  />
                  <h2 className="text-2xl md:text-3xl font-bold text-brand tracking-tight mb-3">
                    학습 클리닉
                  </h2>
                  <p className="text-sm md:text-base text-slate-500 font-bold mb-6">
                    {isRetryMode
                      ? "채점이 확정되었습니다. 틀린 문제를 다시 고쳐보세요!"
                      : isTimedRound
                      ? "그동안의 노력을 테스트해보세요!"
                      : "배부된 학습지를 풀어봐요!"}
                  </p>
                  <div className="mb-6 bg-slate-50 border border-slate-200 rounded-2xl p-5">
                    <p className="text-xs font-bold text-slate-400 mb-1">학생 이름</p>
                    <p className="text-2xl font-bold text-slate-800">
                      {TEST_STUDENT_NAME}
                    </p>
                    <div className="mt-3 flex flex-col items-center gap-1.5">
                      <span className="text-xs md:text-sm font-bold text-rose-500 bg-rose-100 px-4 py-1.5 rounded-full shadow-sm">
                        {examMaster.title} : 총 {questions.length}문항 (남은 문제:{" "}
                        {getRemainingQuestionCount()}문항)
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => setIsStarted(true)}
                      className="w-full bg-brand hover:bg-blue-950 text-white font-bold py-4 text-lg rounded-2xl shadow-md transition-all cursor-pointer"
                    >
                      {isRetryMode
                        ? "🚀 오답 정정 시작하기"
                        : isTimedRound
                        ? `⏱️ ${dynamicTimeLimitMin}분 타이머 시작하기`
                        : "🚀 풀이 시작하기"}
                    </button>
                    <button
                      onClick={leaveToPortal}
                      className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3 text-sm rounded-xl transition-all"
                    >
                      포털 화면으로 돌아가기
                    </button>
                  </div>
                </div>
              </div>
            )}

            {(isSubmitting || isBatchGrading) && (
              <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] z-50 flex items-center justify-center px-4">
                <div className="bg-white rounded-2xl shadow-2xl p-6 flex flex-col items-center max-w-sm w-full text-center">
                  <div className="w-10 h-10 border-4 border-blue-100 border-t-brand rounded-full animate-spin mb-3"></div>
                  <h2 className="text-lg font-bold text-slate-800 mb-1">
                    답안을 꼼꼼히 채점 중입니다
                  </h2>
                  <p className="text-slate-500 font-medium text-xs">
                    선생님의 채점 기준을 바탕으로 분석하고 있어요...
                  </p>
                </div>
              </div>
            )}

            {/* 뷰어 상단 헤더 */}
            <header className="bg-white shadow-sm px-5 py-3 flex justify-between items-center shrink-0 z-20 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <img
                  src="https://kfwlmbwornivkrvoeqdh.supabase.co/storage/v1/object/public/system_images/logica_logo.png"
                  alt="Logica"
                  className="h-6 object-contain"
                />
                <div className="w-px h-5 bg-slate-300"></div>
                <h1 className="text-base md:text-lg font-bold text-slate-800">
                  <span>{TEST_STUDENT_NAME}</span> 학생의 오답 클리닉
                </h1>
              </div>

              <div className="flex items-center gap-3">
                <div
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full shadow-sm ${
                    isClinicUrgent
                      ? "bg-rose-100 border-rose-300 animate-pulse text-rose-600"
                      : "bg-indigo-50 border border-indigo-200 text-indigo-600"
                  }`}
                >
                  <span className="text-sm">🕐</span>
                  <span className="text-xs font-bold opacity-80">남은 시간</span>
                  <span className="text-sm font-lexend font-bold">
                    {clinicRemainingStr}
                  </span>
                </div>
                {isTimedRound && (
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full shadow-sm ${
                      roundRemainingSec <= 60
                        ? "bg-rose-100 animate-pulse text-rose-600"
                        : "bg-rose-50 border border-rose-200 text-rose-600"
                    }`}
                  >
                    <span className="text-sm">⏱️</span>
                    <span className="text-xs font-bold opacity-80">타이머</span>
                    <span className="text-sm font-lexend font-bold">
                      {String(Math.floor(roundRemainingSec / 60)).padStart(2, "0")}:
                      {String(roundRemainingSec % 60).padStart(2, "0")}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1 bg-yellow-50 border border-yellow-200 rounded-full px-3 py-1 shadow-sm">
                  <span className="text-xs font-bold text-yellow-700 pl-1">
                    나의 포인트
                  </span>
                  <PointBadge
                    points={points}
                    className="bg-transparent border-none text-yellow-700 shadow-none px-1 py-0"
                  />
                </div>
                <div className="w-px h-4 bg-slate-300"></div>
                <button
                  onClick={leaveToPortal}
                  className="text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors"
                >
                  포털로 나가기
                </button>
              </div>
            </header>

            {/* 뷰어 본문 */}
            <main className="flex-1 overflow-hidden p-4 md:p-5 flex justify-center relative">
              {emptyState && (
                <div className="absolute inset-0 bg-slate-100 flex flex-col items-center justify-center z-30">
                  <span className="text-6xl mb-3">🎉</span>
                  <h2 className="text-2xl font-bold text-slate-700">
                    {emptyState.title}
                  </h2>
                  <p className="text-base text-slate-500 font-medium mt-2">
                    {emptyState.desc}
                  </p>
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={leaveToPortal}
                      className="bg-brand hover:bg-blue-900 text-white font-bold px-7 py-3 text-base rounded-xl shadow-md transition-all"
                    >
                      학생 포털 화면으로 돌아가기
                    </button>
                  </div>
                </div>
              )}

              {q && !emptyState && (
                <div className="w-full grid grid-cols-[62fr_38fr] gap-4 md:gap-5 h-full relative">
                  {/* 좌측 문제 표시 및 손글씨 캔버스 */}
                  <div className="bg-white rounded-3xl shadow-lg flex flex-col overflow-hidden border border-slate-200 relative">
                    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100 bg-slate-50 shrink-0">
                      <div className="flex items-center shrink-0">
                        <span className="text-3xl font-bold text-brand leading-none">
                          {String(currentQIndex + 1).padStart(2, "0")}
                        </span>
                        {!isTimedRound && q.pageNum && (
                          <div className="flex flex-col ml-2.5 pl-2.5 border-l-2 border-blue-200 justify-center h-7">
                            <span className="text-[11px] font-bold text-blue-400 leading-tight">
                              p.{q.pageNum}
                            </span>
                            {q.questionNum && (
                              <span className="text-[11px] font-bold text-brand leading-tight">
                                {q.questionNum}번
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 ml-1 min-w-0">
                        <h2 className="text-xs font-bold text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-full shadow-sm truncate">
                          원본: {q.source}
                        </h2>
                        {q.bookType && (
                          <span
                            className={`text-xs font-bold px-2.5 py-0.5 rounded-full border shadow-sm ${
                              BOOK_TYPE_COLORS[q.bookType]?.pill ||
                              "bg-slate-100 text-slate-600 border-slate-200"
                            }`}
                          >
                            {q.bookType}
                          </span>
                        )}
                      </div>

                      <div className="ml-auto flex items-center gap-2 shrink-0">
                        {isSubjective && curAnsMode === "pen" && (
                          <span className="hidden xl:inline-block bg-slate-100 text-slate-500 border border-slate-200 text-xs font-bold px-2.5 py-1 rounded-full">
                            ✍️ 캔버스에 자유롭게 적으세요
                          </span>
                        )}
                        <button
                          onClick={handleViewerCallToggle}
                          disabled={timeIsUp || isRecheck}
                          className={`font-bold text-xs md:text-sm px-4 py-2 rounded-xl shadow-sm transition-colors disabled:opacity-40 ${
                            isCall
                              ? "bg-rose-700 text-white"
                              : "bg-rose-500 text-white hover:bg-rose-600"
                          }`}
                        >
                          {isCall ? "🚨 선생님 부르기 취소" : "🙋 선생님 부르기"}
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 relative overflow-hidden">
                      <div
                        className={`h-full overflow-y-auto custom-scrollbar p-6 md:p-8 ${
                          !isTimedRound ? "pb-28" : ""
                        }`}
                      >
                        <div id="preview-question-stage" className="relative min-h-full">
                          <div
                            className={`transition-opacity text-xl md:text-2xl leading-relaxed font-semibold text-slate-800 ${
                              isSubjective && curAnsMode === "pen" ? "opacity-70" : ""
                            }`}
                          >
                            <QuestionDisplay
                              html={q.questionText}
                              imageUrl={q.imageUrl}
                              image2Url={q.image2Url}
                              html2={q.questionText2}
                            />
                          </div>
                          {isSubjective && curAnsMode === "pen" && (
                            <ClinicCanvas
                              qIndex={currentQIndex}
                              currentPenWidth={currentPenWidth}
                              currentPenColor={currentPenColor}
                              isEraserMode={isEraserMode}
                              studentDrawings={studentDrawings}
                              studentAnswers={studentAnswers}
                              forceUpdate={forceUpdate}
                              clearTrigger={canvasClearTrigger}
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    {isCall && (
                      <div className="bg-rose-50 border-t border-rose-100 px-4 py-2 text-center text-xs md:text-sm font-bold text-rose-600 shrink-0">
                        🚨 {currentQIndex + 1}번 문제를 선생님께 질문했어요. 우측 관제탑 로그에서 [상세 보기 및 처리]를 눌러보세요!
                      </div>
                    )}
                    {taHintState.current[currentQIndex] && (
                      <div className="bg-amber-50 border-t border-amber-100 px-4 py-2 text-center text-xs md:text-sm font-bold text-amber-600 shrink-0">
                        🧑‍🏫 선생님의 힌트를 받았어요. 이어서 푼 뒤 제출해보세요!
                      </div>
                    )}

                    {!isTimedRound && (
                      <div className="absolute left-0 right-0 bottom-0 z-30 p-3.5 bg-blue-50/95 backdrop-blur-sm border-t border-blue-100 rounded-b-3xl">
                        {q.hasHint !== false &&
                          hintState.current[currentQIndex]?.revealed && (
                            <div className="flex justify-end items-center mb-1.5">
                              <button
                                onClick={() =>
                                  setHintPanelExpanded(!hintPanelExpanded)
                                }
                                className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-600 text-xs font-bold"
                              >
                                {hintPanelExpanded ? "힌트 닫기" : "힌트 펼치기"}
                              </button>
                            </div>
                          )}
                        <div className="flex gap-2.5">
                          {q.hasHint !== false && (
                            <button
                              onClick={() => setHintModal({ cost: 30 })}
                              disabled={hintState.current[currentQIndex]?.revealed}
                              className={`flex-1 border text-sm py-2.5 rounded-xl shadow-sm font-bold transition-colors ${
                                hintState.current[currentQIndex]?.revealed
                                  ? "bg-slate-100 text-slate-400 border-slate-200"
                                  : "bg-white border-blue-200 hover:bg-blue-100 text-blue-700"
                              }`}
                            >
                              {hintState.current[currentQIndex]?.revealed
                                ? "💡 힌트 열람 완료"
                                : "💡 힌트 열어보기 (-30 포인트)"}
                            </button>
                          )}
                          <button
                            onClick={handleAwayToggle}
                            className={`shrink-0 border text-sm font-bold py-2.5 px-5 rounded-xl shadow-sm transition-colors ${
                              isPortalAway
                                ? "bg-amber-500 border-amber-500 text-white"
                                : "bg-white border-slate-300 hover:bg-slate-100 text-slate-600"
                            }`}
                          >
                            {isPortalAway ? "↩️ 자리 복귀" : "🚶 화장실 다녀오기"}
                          </button>
                        </div>
                        {q.hasHint !== false &&
                          hintState.current[currentQIndex]?.revealed &&
                          hintPanelExpanded && (
                            <HintRevealBox
                              revealedText={hintState.current[currentQIndex].hintText}
                            />
                          )}
                      </div>
                    )}
                  </div>

                  {/* 우측 문항 번호판 및 답안 입력(객관식/키패드/손글씨 도구) */}
                  <div className="flex flex-col gap-4 min-h-0 overflow-y-auto custom-scrollbar">
                    <ClinicQuestionNav
                      questions={questions}
                      currentQIndex={currentQIndex}
                      setCurrentQIndex={setCurrentQIndex}
                      bookFilter={bookFilter}
                      switchBookFilter={switchBookFilter}
                      availableBooks={availableBooks}
                      visibleIndices={visibleIndices}
                      qBoxStatus={qBoxStatus as any}
                      studentAnswers={studentAnswers}
                      callState={callState}
                      setCanvasClearTrigger={setCanvasClearTrigger}
                      isTimedRound={isTimedRound}
                      timeIsUp={timeIsUp}
                      setSubmitConfirmModal={setSubmitConfirmModal}
                    />

                    <div className="bg-white rounded-3xl shadow-lg p-5 flex-1 flex flex-col border border-slate-200 relative overflow-hidden">
                      {(isCall || isRecheck) && (
                        <div className="absolute inset-0 z-20 bg-white/60 flex flex-col items-center pt-4 backdrop-blur-[2px]">
                          <div
                            className={`border text-xs md:text-sm font-bold rounded-xl p-4 text-center w-[90%] shadow-sm ${
                              isCall
                                ? "bg-rose-50 border-rose-200 text-rose-600"
                                : "bg-indigo-50 border-indigo-200 text-indigo-600"
                            }`}
                          >
                            {isCall ? (
                              <>
                                🙋 선생님을 불렀어요!
                                <br />
                                우측 관제탑 로그에서 [상세 보기 및 처리]를 눌러주세요.
                              </>
                            ) : (
                              <>
                                ✏️ 선생님이 답안을 확인하고 있어요!
                                <br />
                                우측 관제탑 로그에서 [채점 창 열기]를 눌러 정답/오답을 판정해주세요.
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
                        <h3 className="font-bold text-slate-700 text-sm md:text-base">
                          <span className="text-brand text-lg md:text-xl font-bold mr-1">
                            {currentQIndex + 1}
                          </span>
                          번 정답 입력
                        </h3>

                        {isSubjective && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setKeypadCollapsed(!keypadCollapsed)}
                              className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200"
                            >
                              <span
                                className={`text-xs font-bold transition-transform ${
                                  keypadCollapsed ? "rotate-180" : ""
                                }`}
                              >
                                ◁
                              </span>
                            </button>
                            <button
                              onClick={toggleAnswerMode}
                              className="text-sm md:text-base font-bold text-brand bg-blue-50 px-4 py-2 rounded-xl border-2 border-blue-300 hover:bg-blue-100 shadow-sm transition-colors flex items-center gap-1.5"
                            >
                              <span>{curAnsMode === "pen" ? "🔢" : "✍️"}</span>
                              {curAnsMode === "pen" ? "키패드로 풀기" : "손글씨로 풀기"}
                            </button>
                          </div>
                        )}
                      </div>

                      <div
                        ref={optionsRef}
                        className="flex flex-col gap-2.5 flex-1 min-h-0 overflow-y-auto"
                      >
                        {q.options && q.options.length > 0 ? (
                          q.options.map((opt: string, oIdx: number) => (
                            <label
                              key={oIdx}
                              className={`w-full px-4 py-3 border-2 rounded-xl text-left font-bold cursor-pointer transition-colors flex gap-3 shadow-sm items-center text-base ${
                                studentAnswers.current[currentQIndex] ===
                                String(oIdx + 1)
                                  ? "bg-brand border-brand text-white"
                                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              <input
                                type="radio"
                                name="omr"
                                className="hidden"
                                checked={
                                  studentAnswers.current[currentQIndex] ===
                                  String(oIdx + 1)
                                }
                                onChange={() => {
                                  studentAnswers.current[currentQIndex] = String(
                                    oIdx + 1
                                  );
                                  triggerTypingIndicator();
                                  forceUpdate();
                                }}
                              />
                              <span
                                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 ${
                                  studentAnswers.current[currentQIndex] ===
                                  String(oIdx + 1)
                                    ? "bg-white/20 text-white"
                                    : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                {oIdx + 1}
                              </span>
                              <span
                                className="font-myungjo"
                                dangerouslySetInnerHTML={{
                                  __html: formatMathTextForWeb(opt),
                                }}
                              />
                            </label>
                          ))
                        ) : curAnsMode === "pen" ? (
                          <div className="w-full h-full flex flex-col gap-2 items-center justify-center py-2 overflow-y-auto">
                            <p className="text-xs md:text-sm font-bold text-slate-400 text-center">
                              ✍️ 좌측 문제 위 캔버스에 자유롭게 풀이 과정을 적고 제출해보세요!
                            </p>
                            <div className="w-full flex flex-col gap-2 my-auto py-1">
                              <div className="flex items-center justify-center gap-3">
                                <button
                                  onClick={() =>
                                    setCurrentPenWidth(Math.max(1, currentPenWidth - 1))
                                  }
                                  className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 font-bold text-xl"
                                >
                                  −
                                </button>
                                <span className="text-base font-bold text-slate-500 w-6 text-center">
                                  {currentPenWidth}
                                </span>
                                <button
                                  onClick={() =>
                                    setCurrentPenWidth(
                                      Math.min(10, currentPenWidth + 1)
                                    )
                                  }
                                  className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 font-bold text-xl"
                                >
                                  +
                                </button>
                              </div>
                              <div
                                className={`flex items-center justify-center gap-2.5 ${
                                  isEraserMode ? "opacity-30 pointer-events-none" : ""
                                }`}
                              >
                                {PEN_COLORS.map((color) => (
                                  <button
                                    key={color}
                                    onClick={() => setCurrentPenColor(color)}
                                    className={`w-8 h-8 rounded-full border-4 transition-transform ${
                                      currentPenColor === color
                                        ? "border-brand scale-110"
                                        : "border-white"
                                    } shadow-sm`}
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  onClick={() => setIsEraserMode(!isEraserMode)}
                                  className={`flex-1 text-sm font-bold py-2.5 rounded-xl ${
                                    isEraserMode
                                      ? "bg-amber-500 text-white"
                                      : "bg-slate-100 text-slate-500"
                                  }`}
                                >
                                  🧽 {isEraserMode ? "지우개 쓰는 중" : "지우개"}
                                </button>
                                <button
                                  onClick={handleClearCanvas}
                                  className="flex-1 text-sm font-bold text-rose-500 bg-rose-50 py-2.5 rounded-xl"
                                >
                                  🗑️ 모두 지우기
                                </button>
                              </div>
                              <button
                                onClick={toggleAnswerMode}
                                className="w-full mt-2 text-base font-bold text-brand bg-blue-50 py-3 rounded-xl border-2 border-blue-200 hover:bg-blue-100"
                              >
                                🔢 키패드로 돌아가기
                              </button>
                            </div>
                          </div>
                        ) : (
                          <ClinicKeypad
                            currentQIndex={currentQIndex}
                            keypadAnswers={keypadAnswers}
                            keypadCursor={keypadCursor}
                            studentAnswers={studentAnswers}
                            keypadCollapsed={keypadCollapsed}
                            forceUpdate={forceUpdate}
                          />
                        )}
                      </div>
                    </div>

                    {!isTimedRound && (
                      <button
                        onClick={submitSingleAnswer}
                        disabled={
                          timeIsUp ||
                          isCall ||
                          isRecheck ||
                          isSubmitting ||
                          isCurrentAlreadyCorrect
                        }
                        className="w-full bg-brand hover:bg-blue-900 text-white font-bold text-lg py-4 rounded-xl shadow-md transition-colors disabled:opacity-40 cursor-pointer shrink-0"
                      >
                        {isCurrentAlreadyCorrect
                          ? "✅ 채점 통과"
                          : isSubmitting
                          ? "채점 중..."
                          : "✅ 정답 제출하기"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </main>

            <ViewerModals
              hintModal={hintModal}
              setHintModal={setHintModal}
              onConfirmHint={async () => {
                const cost = hintModal.cost || 30;
                if (points < cost) {
                  setHintModal(null);
                  alert("포인트가 부족합니다.");
                  return;
                }
                setHintModal((prev: any) => prev && { ...prev, loading: true });
                let finalHintText = q?.hintText;
                if (!finalHintText && q?.needsAiHint) {
                  finalHintText = await generateAiHint(q.questionText);
                } else if (!finalHintText) {
                  finalHintText = "등록된 힌트가 없습니다.";
                }
                setPoints((p) => p - cost);
                hintState.current[currentQIndex] = {
                  revealed: true,
                  hintText: finalHintText,
                };
                setHintPanelExpanded(true);
                setVirtualSeatStudent((prev: any) => ({
                  ...prev,
                  status: "hint",
                  totalHints: (prev.totalHints || 0) + 1,
                }));
                appendLog(
                  "border-amber-400",
                  "bg-amber-50 text-amber-700",
                  "힌트열람",
                  `[${SEAT_NO}] ${TEST_STUDENT_NAME} 힌트 사용`,
                  `${currentQIndex + 1}번 문항 힌트를 열람했습니다 (-${cost}P)`
                );
                setTimeout(() => {
                  setVirtualSeatStudent((prev: any) =>
                    prev.status === "hint" ? { ...prev, status: "idle" } : prev
                  );
                }, 6000);
                setHintModal(null);
                forceUpdate();
              }}
              resultModal={resultModal}
              setResultModal={setResultModal}
              onRetry={() => {
                studentAnswers.current[currentQIndex] = null;
                delete studentDrawings.current[currentQIndex];
                delete keypadAnswers.current[currentQIndex];
                delete keypadCursor.current[currentQIndex];
                setCanvasClearTrigger((p) => p + 1);
                forceUpdate();
              }}
              onRequestRecheck={requestRecheck}
              sessionTimeUpModal={sessionTimeUpModal}
              timeUpModal={timeUpModal}
              submitConfirmModal={submitConfirmModal}
              setSubmitConfirmModal={setSubmitConfirmModal}
              onSubmitConfirm={() => handleTimeUpRef.current?.()}
              submitResultModal={submitResultModal}
              pendingRecheckReview={pendingRecheckReview}
              requestRecheckForReviewItem={requestRecheckForReviewItem}
              recheckToast={recheckToast}
              autoLeaveSec={autoLeaveSec}
              correctSolvedCount={correctSolvedCountRef.current}
              totalQuestions={questions.length}
              unansweredCount={
                questions.filter(
                  (_, i) =>
                    !studentAnswers.current[i] ||
                    studentAnswers.current[i] === "미입력"
                ).length
              }
              logoutTarget="portal"
              onLeave={() => leaveToPortal()}
              timeLimitMinutes={dynamicTimeLimitMin}
            />
          </div>
        )}
      </div>

      {/* =====================================================================
          우측 30%: 가상 클리닉 관제탑 (가상 클리닉 좌석 + 현장 라이브 로그)
      ===================================================================== */}
      <aside className="w-[30%] h-full flex flex-col bg-white shadow-2xl z-20 overflow-hidden">
        {/* 관제탑 상단 헤더 */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center shadow-inner">
              <span className="text-base">📡</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                Logica Clinic <span className="text-slate-500">|</span> 관제탑
              </h2>
              <p className="text-[10px] text-slate-400 font-medium">
                가상 좌석 및 실시간 채점·호출 시뮬레이터
              </p>
            </div>
          </div>

          <button
            onClick={resetSimulation}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-colors cursor-pointer"
            title="처음 미응시 상태부터 다시 테스트합니다"
          >
            🔄 처음부터 리셋
          </button>
        </div>

        {/* 1. 가상 클리닉 좌석 영역 */}
        <div className="p-4 bg-slate-100 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <span>🪑</span> 가상 클리닉 좌석 현황
            </span>
            <span className="text-[11px] font-bold text-slate-500">
              문항 정답 미리보기:{" "}
              <strong className="text-emerald-600">
                {q ? `${currentQIndex + 1}번 정답 [${q.answer || "없음"}]` : "-"}
              </strong>
            </span>
          </div>

          {/* 실제 관제탑 좌석 카드와 동일한 렌더링 */}
          <div className="flex items-center gap-3">
            <div className="w-45 h-28 shrink-0">
              {(() => {
                const st = virtualSeatStudent;
                const isSeatCall = st.status === "call";
                const isSeatHint = st.status === "hint";
                const isSeatAway = st.status === "away";
                const isSeatSubmitted = st.status === "submitted";

                const cardClass = isSeatCall
                  ? "status-help bg-white"
                  : isSeatHint
                  ? "hint-flash bg-white border-slate-200"
                  : isSeatAway
                  ? "bg-amber-50 border-amber-400 border-2"
                  : isSeatSubmitted
                  ? "bg-blue-50 border-blue-400 border-2"
                  : "bg-white border-slate-300";

                return (
                  <div
                    className={`relative border rounded-xl p-2 flex flex-col justify-between shadow-md h-full transition-all ${cardClass}`}
                  >
                    <button
                      onClick={() => setForceCheckoutModal(true)}
                      title="강제 퇴실"
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-500 hover:bg-rose-600 text-white rounded-full flex items-center justify-center shadow-md border-2 border-white z-10"
                    >
                      <span className="text-[10px] font-bold leading-none">✕</span>
                    </button>
                    <SeatCardBody
                      seat={SEAT_NO}
                      student={st}
                      now={now}
                      isMounted={true}
                      interactive={true}
                      onClearAway={() => handleAwayToggle()}
                      onConfirmCheckout={() => {
                        appendLog(
                          "border-slate-800",
                          "bg-slate-900 text-white",
                          "퇴실완료",
                          `[${SEAT_NO}] ${TEST_STUDENT_NAME} 퇴실 처리`,
                          `최종 점수 ${st.score ?? 100}점으로 퇴실 확인되었습니다.`
                        );
                        leaveToPortal();
                      }}
                      onOpenEndRequest={() => setEndRequestModal(true)}
                      onAdjustTime={(deltaMin) => {
                        const deltaMs = deltaMin * 60 * 1000;
                        setClinicDurationMs((prev) => Math.max(0, prev + deltaMs));
                        setVirtualSeatStudent((prev: any) => ({
                          ...prev,
                          clinicDurationMs: Math.max(
                            0,
                            (prev.clinicDurationMs || DEFAULT_CLINIC_DURATION_MS) +
                              deltaMs
                          ),
                        }));
                        appendLog(
                          "border-indigo-400",
                          "bg-indigo-50 text-indigo-700",
                          "시간조절",
                          `[${SEAT_NO}] 이용시간 ${deltaMin > 0 ? `+${deltaMin}` : deltaMin}분 조정`,
                          "좌석의 남은 클리닉 시간이 즉시 변경되었습니다."
                        );
                      }}
                      onForceReset={resetSimulation}
                    />
                  </div>
                );
              })()}
            </div>

            {/* 우측 빠른 상태 요약 및 검수 알림 */}
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              {hasPendingVerification && (
                <button
                  onClick={() => setIsVerifyModalOpen(true)}
                  className="w-full bg-amber-500 hover:bg-amber-600 text-white px-3 py-2.5 rounded-xl font-bold text-xs shadow-md animate-bounce flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>🚨</span>
                  <span>테스트 채점 검수 대기중! (클릭하여 검수)</span>
                </button>
              )}

              <div className="bg-white rounded-xl p-2.5 border border-slate-200 text-[11px] space-y-1 shadow-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold">현재 화면:</span>
                  <span className="font-bold text-slate-700">
                    {leftViewMode === "portal" ? "학생 포털 대기" : "문제 풀이 뷰어"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold">문제지 상태:</span>
                  <span className="font-bold text-brand">{assignmentStatus}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold">남은 문항:</span>
                  <span className="font-bold text-rose-600">
                    {getRemainingQuestionCount()} / {questions.length}문항
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2. 현장 라이브 로그 영역 */}
        <div className="bg-slate-800 text-white px-4 py-2 font-bold text-xs flex justify-between items-center shrink-0">
          <span>⚡ 현장 라이브 로그</span>
          <span className="text-[10px] bg-rose-500 px-1.5 py-0.5 rounded animate-pulse">
            Live
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-50 custom-scroll">
          {logs.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-10 font-bold">
              접수된 기록이 없습니다.
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className={`bg-white p-3 rounded-xl border-l-4 ${log.borderClass} shadow-sm border border-slate-200/80 transition-all`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[10px] font-bold text-slate-400">
                    {log.timestamp}
                  </span>
                  <span
                    className={`${log.badgeBg} text-[10px] font-bold px-1.5 py-0.5 rounded`}
                  >
                    {log.badgeText}
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-800 leading-snug">
                  {log.title}
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                  {log.subtitle}
                </p>

                {/* 호출 로그 액션 버튼 */}
                {log.type === "call" && (
                  <button
                    onClick={() => {
                      const qNum = log.data?.qNum;
                      const callInfo = virtualSeatStudent.calls?.[qNum];
                      if (qNum === "general" || !callInfo?.questionText) {
                        resolveSupervisorCall("general", "skip");
                      } else {
                        setCallProcessModal({ isOpen: true, qNum, callInfo });
                      }
                    }}
                    className="mt-2 w-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-1.5 rounded-lg transition-colors cursor-pointer shadow-sm"
                  >
                    {log.data?.qNum === "general"
                      ? "호출 확인 완료"
                      : "🔍 상세 보기 및 처리"}
                  </button>
                )}

                {/* 손글씨/재확인 채점 요청 로그 액션 버튼 */}
                {log.type === "recheck" && (
                  <button
                    onClick={() =>
                      setRecheckModal({ isOpen: true, uid: log.data?.uid })
                    }
                    className="mt-2 w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-1.5 rounded-lg transition-colors cursor-pointer shadow-sm"
                  >
                    ✏️ 채점 창 열기 (정답/오답 판정)
                  </button>
                )}

                {/* 자리비움 로그 액션 버튼 */}
                {log.type === "away" && isPortalAway && (
                  <button
                    onClick={handleAwayToggle}
                    className="mt-2 w-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold py-1.5 rounded-lg transition-colors cursor-pointer shadow-sm"
                  >
                    ↩️ 자리 복귀 처리
                  </button>
                )}

                {/* 클리닉 종료 요청 로그 액션 버튼 */}
                {log.type === "end_request" && endRequestStatus === "pending" && (
                  <button
                    onClick={() => setEndRequestModal(true)}
                    className="mt-2 w-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-1.5 rounded-lg transition-colors cursor-pointer shadow-sm"
                  >
                    🚪 종료 요청 승인/거부
                  </button>
                )}

                {/* 타이머 시험 제출 시 오답 검수 바로가기 버튼 */}
                {log.type === "submit" && hasPendingVerification && (
                  <button
                    onClick={() => setIsVerifyModalOpen(true)}
                    className="mt-2 w-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold py-1.5 rounded-lg transition-colors cursor-pointer shadow-sm"
                  >
                    📝 테스트 오답 검수 창 열기
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* =====================================================================
          관제탑 모달 1: 질문 상세 보기 및 처리 모달 (실제 /supervisor와 동일)
      ===================================================================== */}
      {callProcessModal && callProcessModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-9999 flex items-center justify-center p-4 md:p-8">
          <div className="bg-slate-100 rounded-4xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="bg-rose-600 text-white px-6 py-4 flex justify-between items-center shrink-0">
              <h2 className="text-xl font-bold">
                🙋 {TEST_STUDENT_NAME} 학생 질문 상세 보기
              </h2>
              <button
                onClick={() => setCallProcessModal(null)}
                className="text-white/70 hover:text-white text-3xl font-bold"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-white custom-scroll">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-lg font-bold text-rose-600">
                  {SEAT_NO} 좌석
                </span>
                <span className="text-xs font-bold px-3 py-1 rounded bg-rose-600 text-white">
                  {callProcessModal.qNum}번 문항 ·{" "}
                  {callProcessModal.callInfo.source}
                </span>
              </div>

              <MathText
                className="text-base md:text-lg text-slate-800 font-myungjo font-semibold leading-relaxed"
                html={callProcessModal.callInfo.questionText}
              />

              {callProcessModal.callInfo.imageUrl && (
                <img
                  src={callProcessModal.callInfo.imageUrl}
                  className="max-w-full rounded-xl border border-slate-200 mt-3"
                  alt="문제 이미지"
                />
              )}
              {callProcessModal.callInfo.image2Url && (
                <img
                  src={callProcessModal.callInfo.image2Url}
                  className="max-w-full rounded-xl border border-slate-200 mt-3"
                  alt="문제 이미지 2"
                />
              )}
              {callProcessModal.callInfo.questionText2 && (
                <MathText
                  className="text-base md:text-lg text-slate-800 font-myungjo font-semibold leading-relaxed mt-3"
                  html={callProcessModal.callInfo.questionText2}
                />
              )}

              {callProcessModal.callInfo.options?.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {callProcessModal.callInfo.options.map(
                    (opt: string, i: number) => (
                      <div
                        key={i}
                        className="text-sm text-slate-700 font-medium flex gap-2 bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-100"
                      >
                        <span className="font-bold text-rose-500">{i + 1}.</span>
                        <MathText
                          className="flex-1"
                          html={formatMathTextForWeb(opt)}
                        />
                      </div>
                    )
                  )}
                </div>
              )}

              <div className="mt-4 pt-3 border-t-2 border-dashed border-slate-200 flex items-start gap-2.5">
                <span className="text-xs font-bold px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 shrink-0">
                  정답
                </span>
                <MathText
                  className="text-base font-bold text-emerald-700"
                  html={
                    callProcessModal.callInfo.answer
                      ? `$ ${String(callProcessModal.callInfo.answer).replace(
                          /\$/g,
                          ""
                        )} $`
                      : "정보 없음"
                  }
                />
              </div>

              {callProcessModal.callInfo.explanation && (
                <div className="mt-3 pt-3 border-t-2 border-dashed border-slate-200">
                  <span className="text-xs font-bold px-2 py-0.5 rounded border border-slate-300 bg-slate-100 text-slate-600">
                    해설
                  </span>
                  <div className="mt-2 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                    <MathText
                      className="text-sm text-slate-600 font-medium leading-relaxed"
                      html={String(callProcessModal.callInfo.explanation).replace(
                        /\n/g,
                        "<br>"
                      )}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end gap-2.5 shrink-0">
              <button
                onClick={() => setCallProcessModal(null)}
                className="px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 font-bold rounded-xl text-sm"
              >
                닫기
              </button>
              <button
                onClick={() =>
                  resolveSupervisorCall(callProcessModal.qNum, "skip")
                }
                className="px-6 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-sm"
              >
                ⏭️ 설명 생략 (그냥 넘기기)
              </button>
              <button
                onClick={() =>
                  resolveSupervisorCall(callProcessModal.qNum, "hint")
                }
                className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-md text-sm"
              >
                💡 힌트 제공 후 종료
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          관제탑 모달 2: AI/수동 채점 재확인 모달 (실제 /supervisor SeatGrid와 동일)
      ===================================================================== */}
      {recheckModal.isOpen && activeRecheckItem && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-9999 px-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="bg-indigo-600 text-white px-5 py-3.5 flex justify-between items-center">
              <span className="font-bold text-sm">
                🔄 채점 확인 / 재확인 판정{" "}
                {activeRecheckItem.qNum
                  ? `(${activeRecheckItem.qNum}번 문항)`
                  : ""}
              </span>
              <button
                onClick={() => setRecheckModal({ isOpen: false, uid: null })}
                className="text-white/80 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3 max-h-[75vh] overflow-y-auto custom-scroll">
              {!activeRecheckItem.imageDataUrl && activeRecheckItem.questionText && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-800 font-myungjo">
                  <MathText html={activeRecheckItem.questionText} />
                </div>
              )}
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2 flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-700">
                  실제 정답
                </span>
                <span className="text-sm font-bold text-emerald-900">
                  {activeRecheckItem.correctAnswer || "정답 없음"}
                </span>
              </div>
              {activeRecheckItem.imageDataUrl ? (
                <div className="border border-slate-200 rounded-xl p-3 bg-white">
                  <span className="text-[11px] font-bold text-slate-400 block mb-2">
                    학생 손글씨 답안 이미지 (문제 + 필기)
                  </span>
                  <HandwritingOverlayPreview
                    imageDataUrl={activeRecheckItem.imageDataUrl}
                    questionText={activeRecheckItem.questionText}
                    questionText2={activeRecheckItem.questionText2}
                    imageUrl={activeRecheckItem.imageUrl}
                    image2Url={activeRecheckItem.image2Url}
                    stageWidth={activeRecheckItem.stageWidth}
                    stageHeight={activeRecheckItem.stageHeight}
                    cropHeight={activeRecheckItem.cropHeight}
                  />
                </div>
              ) : (
                <div className="text-center text-sm font-bold text-slate-600 py-5 bg-slate-50 rounded-lg border border-slate-200">
                  입력된 답안:{" "}
                  <span className="text-brand">
                    {activeRecheckItem.recognizedText || "이미지 없음"}
                  </span>
                </div>
              )}
              {activeRecheckItem.recognizedText && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-xs text-slate-600">
                  <span className="font-bold text-slate-700">
                    AI 인식 답안:
                  </span>{" "}
                  {activeRecheckItem.recognizedText}
                </div>
              )}
              {activeRecheckItem.aiExplanation && (
                <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg px-3.5 py-2 text-xs text-indigo-800">
                  <span className="font-bold">AI 채점 코멘트:</span>{" "}
                  {activeRecheckItem.aiExplanation}
                </div>
              )}
            </div>
            <div className="flex gap-2 p-4 border-t border-slate-100 bg-slate-50">
              <button
                onClick={() =>
                  resolveSupervisorRecheck(recheckModal.uid!, "incorrect")
                }
                className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-bold py-3 rounded-xl transition-colors cursor-pointer"
              >
                ❌ 오답 판정
              </button>
              <button
                onClick={() =>
                  resolveSupervisorRecheck(recheckModal.uid!, "correct")
                }
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-colors cursor-pointer shadow-sm"
              >
                ✅ 정답 인정
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          관제탑 모달 3: 타이머 시험 오답 검수 모달 (실제 /supervisor와 동일)
      ===================================================================== */}
      {isVerifyModalOpen && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-9999 flex items-center justify-center p-4 md:p-8">
          <div className="bg-slate-100 rounded-4xl shadow-2xl w-full max-w-4xl h-full max-h-[88vh] flex flex-col overflow-hidden">
            <div className="bg-brand text-white px-6 py-4 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-bold">
                  📝 {TEST_STUDENT_NAME} 학생 테스트 오답 검수
                </h2>
                <p className="text-xs font-bold text-blue-200 mt-0.5">
                  {examMaster.title} (가채점: {initialScore ?? 0}점)
                </p>
              </div>
              <button
                onClick={() => setIsVerifyModalOpen(false)}
                className="text-white/70 hover:text-white text-3xl font-bold"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scroll">
              {wrongQuestionsForVerify.length === 0 ? (
                <div className="text-center py-16 flex flex-col items-center bg-white rounded-2xl border border-slate-200">
                  <span className="text-5xl mb-3">💯</span>
                  <span className="text-slate-600 font-bold text-lg">
                    가채점 결과 모든 문항이 정답입니다! (오답 없음)
                  </span>
                </div>
              ) : (
                wrongQuestionsForVerify.map((ans) => {
                  const isOverridden = verificationOverrides[ans.idx] === true;
                  return (
                    <div
                      key={ans.uid}
                      className={`bg-white rounded-2xl shadow-sm border-[3px] overflow-hidden flex flex-col md:flex-row transition-colors ${
                        isOverridden ? "border-emerald-400" : "border-rose-200"
                      }`}
                    >
                      <div className="w-full md:w-2/3 p-5 relative bg-white border-b md:border-b-0 md:border-r border-slate-100 min-h-55">
                        <div className="mb-2">
                          <span className="bg-brand text-white text-xs font-bold px-2.5 py-0.5 rounded-full">
                            {ans.idx + 1}번 문항
                          </span>
                        </div>
                        <MathText
                          className="font-bold text-slate-800 leading-relaxed font-myungjo text-base"
                          html={ans.questionText}
                        />
                        {ans.imageUrl && (
                          <img
                            src={ans.imageUrl}
                            className="max-w-full rounded-lg mt-3 shadow-sm"
                            alt="문제 이미지"
                          />
                        )}
                        {ans.isDrawing && (
                          <img
                            src={ans.cleanInput}
                            className="absolute top-0 left-0 w-full h-full object-contain object-top pointer-events-none opacity-90 mix-blend-multiply z-20 p-4"
                            alt="학생 손글씨"
                          />
                        )}
                      </div>

                      <div className="w-full md:w-1/3 p-5 flex flex-col justify-between bg-slate-50">
                        <div className="space-y-3">
                          <div className="bg-white p-3 rounded-xl border border-slate-200">
                            <span className="text-xs font-bold text-slate-400 block mb-1">
                              학생 입력 답안
                            </span>
                            {ans.isDrawing ? (
                              <span className="inline-block px-2.5 py-1 bg-slate-100 text-slate-600 font-bold rounded-lg text-xs">
                                ✍️ 손글씨 풀이 (좌측 확인)
                              </span>
                            ) : (
                              <span className="inline-block px-2.5 py-1 bg-slate-100 text-slate-800 font-bold rounded-lg text-sm">
                                {ans.cleanInput || "미입력"}
                              </span>
                            )}
                          </div>
                          <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                            <span className="text-xs font-bold text-emerald-600 block mb-1">
                              실제 정답
                            </span>
                            <MathText
                              className="font-bold text-emerald-800 text-base font-myungjo"
                              html={ans.answer || "정답 없음"}
                            />
                          </div>
                        </div>

                        <div className="mt-4 flex flex-col gap-2">
                          <button
                            onClick={() =>
                              setVerificationOverrides((p) => ({
                                ...p,
                                [ans.idx]: true,
                              }))
                            }
                            className={`w-full py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer ${
                              isOverridden
                                ? "bg-emerald-500 text-white shadow-md"
                                : "bg-white border border-slate-200 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600"
                            }`}
                          >
                            ✅ 정답으로 인정
                          </button>
                          <button
                            onClick={() =>
                              setVerificationOverrides((p) => {
                                const next = { ...p };
                                delete next[ans.idx];
                                return next;
                              })
                            }
                            className={`w-full py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer ${
                              !isOverridden
                                ? "bg-rose-500 text-white shadow-md"
                                : "bg-white border border-slate-200 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
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

            <div className="bg-white p-4 border-t border-slate-200 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setIsVerifyModalOpen(false)}
                className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-sm"
              >
                닫기
              </button>
              <button
                onClick={confirmTestVerification}
                className="px-8 py-3 bg-brand hover:bg-blue-900 text-white font-bold rounded-xl shadow-lg text-sm cursor-pointer"
              >
                최종 확정 및 오답 클리닉 개방
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 관제탑 모달 4: 클리닉 종료 요청 승인/거부 */}
      {endRequestModal && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-9999 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-85 text-center">
            <div className="text-4xl mb-3">🚪</div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">
              클리닉 종료 요청
            </h3>
            <p className="text-sm text-slate-600 mb-6">
              <span className="font-bold text-rose-600">{TEST_STUDENT_NAME}</span>{" "}
              학생이 클리닉 종료를 요청했습니다.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEndRequestStatus("rejected");
                  setVirtualSeatStudent((prev: any) => ({
                    ...prev,
                    endRequestPending: false,
                  }));
                  removeLogsByType("end_request");
                  appendLog(
                    "border-slate-400",
                    "bg-slate-100 text-slate-600",
                    "종료거부",
                    `[${SEAT_NO}] 종료 요청 거부`,
                    "클리닉 종료 요청을 거부했습니다."
                  );
                  setEndRequestModal(false);
                }}
                className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg text-sm"
              >
                거부
              </button>
              <button
                onClick={() => {
                  setEndRequestStatus("idle");
                  setVirtualSeatStudent((prev: any) => ({
                    ...prev,
                    endRequestPending: false,
                    status: "submitted",
                  }));
                  removeLogsByType("end_request");
                  appendLog(
                    "border-slate-800",
                    "bg-slate-900 text-white",
                    "퇴실승인",
                    `[${SEAT_NO}] 클리닉 종료 승인`,
                    "학생의 클리닉 종료를 승인했습니다."
                  );
                  setEndRequestModal(false);
                  leaveToPortal();
                }}
                className="flex-1 bg-rose-600 text-white font-bold py-3 rounded-lg text-sm"
              >
                승인 (종료)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 관제탑 모달 5: 강제 퇴실 모달 */}
      {forceCheckoutModal && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-9999 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-85 text-center">
            <div className="text-4xl mb-3">🚪</div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">
              강제 퇴실 확인
            </h3>
            <p className="text-sm text-slate-600 mb-6">
              <span className="font-bold text-rose-600">{TEST_STUDENT_NAME}</span>{" "}
              학생을 강제 퇴실 처리하시겠습니까?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setForceCheckoutModal(false)}
                className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-lg text-sm"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setForceCheckoutModal(false);
                  appendLog(
                    "border-rose-600",
                    "bg-rose-600 text-white",
                    "강제퇴실",
                    `[${SEAT_NO}] ${TEST_STUDENT_NAME} 강제 퇴실`,
                    "관리자에 의해 강제 퇴실 처리되었습니다."
                  );
                  leaveToPortal();
                }}
                className="flex-1 bg-rose-600 text-white font-bold py-3 rounded-lg text-sm"
              >
                강제 퇴실
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
