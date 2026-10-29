// src/components/parent/StudentCard.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

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

const unwrap = <T,>(obj: T | T[] | undefined | null): T | undefined => {
  if (Array.isArray(obj)) return obj[0];
  return obj || undefined;
};

const ENDED_ENROLLMENT_STATUSES = ["수강종료", "종료", "퇴원", "취소"];
const isEndedEnrollment = (e: any): boolean => {
  if (!e) return true;
  if (ENDED_ENROLLMENT_STATUSES.includes(String(e.status || "").trim())) return true;
  if (e.end_date) return true;
  return false;
};

// 💡 오늘의 KST 날짜 구하기 헬퍼 함수
const getKSTDateStr = (offsetDays = 0) => {
  const kstAdjusted = new Date(
    Date.now() + 9 * 3600000 - 6 * 3600000 + offsetDays * 86400000
  );
  return kstAdjusted.toISOString().split("T")[0];
};

// 💡 상담 유형별 파스텔 테마 컬러
const getConsultBadgeColor = (type: string) => {
  switch (type) {
    case "퇴원상담":
      return "bg-[#FFE4E6] text-[#BE123C]";
    case "신규상담":
    case "입학상담":
      return "bg-[#DCFCE7] text-[#15803D]";
    case "태도상담":
      return "bg-[#FEF3C7] text-[#B45309]";
    case "성적상담":
      return "bg-[#DBEAFE] text-[#1D4ED8]";
    default:
      return "bg-[#F1F5F9] text-[#475569]";
  }
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// "10월 6일 화요일"
const formatKDate = (dateStr: string) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
};

// "2026.09.03"
const formatShortDate = (dateStr?: string | null) => {
  if (!dateStr) return "";
  const clean = String(dateStr).split("T")[0];
  const parts = clean.split("-");
  if (parts.length === 3) {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  return clean;
};

// "10월 7일(수) 22:00"
const formatDueLabel = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEKDAYS[d.getDay()]}) ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// 페이지 번호 배열을 읽기 쉬운 구간 문자열(예: "12~15, 18쪽")로 변환
const formatPageRanges = (pages: number[], maxSegments = 3): string => {
  if (!pages || pages.length === 0) return "";
  const sorted = Array.from(new Set(pages.filter((p) => p > 0))).sort(
    (a, b) => a - b
  );
  if (sorted.length === 0) return "";

  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
    } else {
      ranges.push(start === prev ? `${start}` : `${start}~${prev}`);
      start = cur;
      prev = cur;
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}~${prev}`);

  if (ranges.length > maxSegments) {
    const tail = ranges.slice(ranges.length - maxSegments);
    return `... ${tail.join(", ")}쪽`;
  }
  return `${ranges.join(", ")}쪽`;
};

// 🌟 방사 차트용 스마트 텍스트 줄바꿈 함수 (12글자 기준)
const splitLabel = (label: string) => {
  if (!label) return [];
  if (label.length <= 12) return [label];

  const words = label.split(" ");
  if (words.length === 1) {
    const mid = Math.ceil(label.length / 2);
    return [label.substring(0, mid), label.substring(mid)];
  }

  let midIdx = 0;
  let minDiff = Infinity;
  let currentLen = 0;

  for (let i = 0; i < words.length - 1; i++) {
    currentLen += words[i].length + (i > 0 ? 1 : 0);
    const diff = Math.abs(currentLen - label.length / 2);
    if (diff < minDiff) {
      minDiff = diff;
      midIdx = i;
    }
  }

  return [
    words.slice(0, midIdx + 1).join(" "),
    words.slice(midIdx + 1).join(" "),
  ];
};

// 🌟 방사 차트 컴포넌트 (산뜻한 블루 & 파스텔 스카이 톤)
const RadarChart = ({ data }: { data: any[] }) => {
  if (!data || data.length < 3) {
    return (
      <div className="text-center text-[#64748B] text-[14px] py-8 leading-relaxed">
        단원이 3개 이상 쌓이면
        <br />
        그래프로 보여드려요.
      </div>
    );
  }

  const size = 320;
  const center = size / 2;
  const radius = size * 0.35;
  const levels = 5;

  const pointsFin = data.map((d, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / data.length;
    const value = Math.max(0.01, d.final_rate / 100);
    return {
      x: center + radius * value * Math.cos(angle),
      y: center + radius * value * Math.sin(angle),
    };
  });

  const pointsInit = data.map((d, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / data.length;
    const value = Math.max(0.01, d.initial_rate / 100);
    return {
      x: center + radius * value * Math.cos(angle),
      y: center + radius * value * Math.sin(angle),
    };
  });

  const labelPoints = data.map((d, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / data.length;
    return {
      labelX: center + (radius + 32) * Math.cos(angle),
      labelY: center + (radius + 32) * Math.sin(angle),
      label: d.name,
    };
  });

  const bgPolygons = Array.from({ length: levels }).map((_, levelIndex) => {
    const r = radius * ((levelIndex + 1) / levels);
    const pts = data
      .map((_, i) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * i) / data.length;
        return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
      })
      .join(" ");
    return (
      <polygon
        key={levelIndex}
        points={pts}
        fill={levelIndex === levels - 1 ? "rgba(241, 245, 249, 0.45)" : "none"}
        stroke="#E2E8F0"
        strokeWidth="1"
      />
    );
  });

  const axes = data.map((_, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / data.length;
    return (
      <line
        key={i}
        x1={center}
        y1={center}
        x2={center + radius * Math.cos(angle)}
        y2={center + radius * Math.sin(angle)}
        stroke="#E2E8F0"
        strokeWidth="1"
      />
    );
  });

  const polyFinStr = pointsFin.map((p) => `${p.x},${p.y}`).join(" ");
  const polyInitStr = pointsInit.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg width="100%" height={size} viewBox={`0 0 ${size} ${size}`}>
      {bgPolygons}
      {axes}

      <polygon
        points={polyFinStr}
        fill="rgba(147, 197, 253, 0.42)"
        stroke="#60A5FA"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {pointsFin.map((p, i) => (
        <circle key={`fin-dot-${i}`} cx={p.x} cy={p.y} r="3" fill="#60A5FA" />
      ))}

      <polygon
        points={polyInitStr}
        fill="rgba(37, 99, 235, 0.28)"
        stroke="#2563EB"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {pointsInit.map((p, i) => (
        <circle key={`init-dot-${i}`} cx={p.x} cy={p.y} r="3" fill="#2563EB" />
      ))}

      {labelPoints.map((p, i) => {
        const lines = splitLabel(p.label);
        return (
          <text
            key={`text-${i}`}
            fontSize="11"
            fill="#334155"
            textAnchor="middle"
          >
            {lines.length === 1 ? (
              <tspan x={p.labelX} y={p.labelY} dominantBaseline="central">
                {lines[0]}
              </tspan>
            ) : (
              <>
                <tspan x={p.labelX} y={p.labelY - 6} dominantBaseline="central">
                  {lines[0]}
                </tspan>
                <tspan x={p.labelX} y={p.labelY + 6} dominantBaseline="central">
                  {lines[1]}
                </tspan>
              </>
            )}
          </text>
        );
      })}
    </svg>
  );
};

export default function StudentCard({ student }: { student: any }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<
    "attendance" | "progress" | "homework" | "makeup" | "exam" | "consultation"
  >("attendance");

  // 캘린더용 상태
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // 수업 일지 데이터 로딩 상태 (과제 탭에서 활용)
  const [lessonLogs, setLessonLogs] = useState<any[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [showAllLogs, setShowAllLogs] = useState(false);

  // 성적 데이터 상태
  const [examResults, setExamResults] = useState<any[]>([]);
  const [categoryAnalysis, setCategoryAnalysis] = useState<any[]>([]);
  const [schoolExams, setSchoolExams] = useState<any[]>([]);
  const [isExamLoading, setIsExamLoading] = useState(false);

  // 🌟 보강 관리 상태
  const [makeups, setMakeups] = useState<any[]>([]);
  const [isMakeupLoading, setIsMakeupLoading] = useState(false);

  // 토스트 팝업 상태 관리
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // 🌟 [첫 화면 요약] 마감 전이면서 아직 끝내지 않은 과제 수 (조회 실패 시 줄을 숨김)
  const [pendingHw, setPendingHw] = useState<{
    count: number;
    nextDue: string | null;
  } | null>(null);
  useEffect(() => {
    if (!student?.student_id) return;
    const loadPendingHomework = async () => {
      try {
        const { data, error } = await supabase
          .from("student_homework_result")
          .select("status, homework_assignment!inner(homework_title, due_date)")
          .eq("student_id", student.student_id)
          .gte("homework_assignment.due_date", new Date().toISOString());
        if (error) throw error;
        const DONE = ["제출완료", "채점완료", "완료"];
        const dues = (data || [])
          .map((r: any) => ({
            status: r.status,
            hw: unwrap(r.homework_assignment) as any,
          }))
          .filter(
            (r) =>
              r.hw &&
              r.hw.homework_title !== "[시스템] 수업 진도 완료 기록" &&
              !DONE.includes(r.status)
          )
          .map((r) => r.hw.due_date as string)
          .sort();
        setPendingHw({ count: dues.length, nextDue: dues[0] || null });
      } catch (e) {
        console.warn("남은 과제 조회 실패:", e);
        setPendingHw(null);
      }
    };
    loadPendingHomework();
  }, [student?.student_id]);

  // 🌟 [첫 화면 요약] 최근 주간테스트 점수 (성적 탭을 열지 않아도 표시)
  useEffect(() => {
    if (student?.student_id) loadExamResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.student_id]);

  const activeEnrollment = student.enrollment?.find(
    (e: any) => !isEndedEnrollment(e) && unwrap(e.class)?.name
  );
  const currentClass = activeEnrollment ? unwrap(activeEnrollment.class) : null;
  const className = currentClass?.name || "소속 반 없음";
  const classId = currentClass?.class_id;

  const consultLogs = student.consultation_log
    ? [...student.consultation_log].sort(
        (a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    : [];

  // 🌟 수업 일지 데이터 로드 (과제 탭에서 표시)
  useEffect(() => {
    if (activeTab === "homework" && classId) {
      const fetchLogs = async () => {
        setIsLogsLoading(true);
        try {
          const { data } = await supabase
            .from("daily_lesson_log")
            .select(
              `
               lesson_log_id, actual_date, homework_desc,
               lesson_log_student_comment(student_id, comment)
            `
            )
            .eq("class_id", classId)
            .order("actual_date", { ascending: false });

          if (data) {
            const parsedLogs = data.map((log) => {
              const desc = log.homework_desc || "";
              const progressMatch = desc.match(
                /\[📖 오늘의 진도\]\n([\s\S]*?)(?=\n\n\[📝 공통 과제\]|\n\n\[🧑‍🎓 개별 과제\]|$)/
              );
              const hwMatch = desc.match(
                /\[📝 공통 과제\]\n([\s\S]*?)(?=\n\n\[🧑‍🎓 개별 과제\]|$)/
              );

              const pDesc = progressMatch ? progressMatch[1].trim() : "";
              let hDesc = hwMatch ? hwMatch[1].trim() : "";
              if (!progressMatch && !hwMatch) hDesc = desc; // 구형 포맷 대응

              const myComment = (log.lesson_log_student_comment || []).find(
                (c: any) => c.student_id === student.student_id
              );

              return {
                ...log,
                parsed_progress: pDesc,
                parsed_homework: hDesc,
                my_individual_comment: myComment ? myComment.comment : null,
              };
            });

            setLessonLogs(
              parsedLogs.filter(
                (l) =>
                  l.parsed_progress ||
                  l.parsed_homework ||
                  l.my_individual_comment
              )
            );
          }
        } catch (error) {
          console.error("일지 정보 로딩 에러:", error);
        } finally {
          setIsLogsLoading(false);
        }
      };
      fetchLogs();
    }
  }, [activeTab, classId, student.student_id]);

  // 성적 데이터 로드
  useEffect(() => {
    if (activeTab === "exam" && student?.student_id) {
      const loadAllExamData = async () => {
        setIsExamLoading(true);
        await Promise.all([
          loadExamResults(),
          loadCategoryAnalysis(),
          loadSchoolExams(),
        ]);
        setIsExamLoading(false);
      };
      loadAllExamData();
    }
  }, [activeTab, student]);

  // 보강 일정 데이터 로드
  useEffect(() => {
    if (activeTab === "makeup" && student?.student_id) {
      const fetchMakeups = async () => {
        setIsMakeupLoading(true);
        try {
          const { data } = await supabase
            .from("individual_makeup")
            .select("*, instructor(name)")
            .eq("student_id", student.student_id)
            .order("schedule_date", { ascending: false });
          setMakeups(data || []);
        } catch (err) {
          console.error("보강 내역 로드 에러:", err);
        } finally {
          setIsMakeupLoading(false);
        }
      };
      fetchMakeups();
    }
  }, [activeTab, student?.student_id]);

  const loadExamResults = async () => {
    try {
      const { data: assignments } = await supabase
        .from("exam_assignment")
        .select(
          "assignment_id, exam_id, total_score, status, created_at, exam_master(title, total_questions, exam_type, layout_settings)"
        )
        .eq("student_id", student.student_id)
        .order("created_at", { ascending: false });

      const validAssignments = (assignments || [])
        .filter((a: any) => {
          if (["응시전", "미응시", "예정", "대기"].includes(a.status))
            return false;
          const master = Array.isArray(a.exam_master)
            ? a.exam_master[0]
            : a.exam_master;
          if (master?.exam_type !== "주간테스트") return false;
          return true;
        })
        .slice(0, 10);

      if (validAssignments.length === 0) {
        setExamResults([]);
        return;
      }

      const examIds = Array.from(
        new Set(validAssignments.map((a: any) => a.exam_id))
      );
      const [
        { data: allAssignmentsForExams },
        { data: examItems },
        { data: gcData },
      ] = await Promise.all([
        supabase
          .from("exam_assignment")
          .select("assignment_id, exam_id")
          .in("exam_id", examIds)
          .not("status", "in", '("응시전","미응시","예정","대기")'),
        supabase
          .from("exam_item")
          .select("exam_id, question_id, sort_order, assigned_score")
          .in("exam_id", examIds)
          .order("sort_order"),
        supabase
          .from("master_grading_code")
          .select("code, description, is_correct, score_ratio, admission_ratio"),
      ]);

      const gcMeta: Record<string, any> = {};
      gcData?.forEach((row: any) => {
        if (row.code) gcMeta[row.code] = row;
      });

      const itemsByExam = new Map<string, any[]>();
      examItems?.forEach((it: any) => {
        const k = String(it.exam_id);
        if (!itemsByExam.has(k)) itemsByExam.set(k, []);
        itemsByExam.get(k)!.push(it);
      });

      const examScoreConfigMap = new Map<
        string,
        { scoreByQuestionId: Map<string, number>; defaultScore: number }
      >();
      validAssignments.forEach((a: any) => {
        const master = Array.isArray(a.exam_master)
          ? a.exam_master[0]
          : a.exam_master;
        const k = String(a.exam_id);
        if (!examScoreConfigMap.has(k)) {
          const items = itemsByExam.get(k) || [];
          const { scoreByQuestionId, groupCount } = buildExamQuestionScoreMap(
            items,
            master?.layout_settings,
            master?.exam_type,
            master?.total_questions || 1
          );
          examScoreConfigMap.set(k, {
            scoreByQuestionId,
            defaultScore: 100 / (groupCount || master?.total_questions || 1),
          });
        }
      });

      const allAssignIds = (allAssignmentsForExams || []).map(
        (a) => a.assignment_id
      );
      let allAnswers: any[] = [];
      for (let i = 0; i < allAssignIds.length; i += 200) {
        const chunk = allAssignIds.slice(i, i + 200);
        const { data: chunkAnswers } = await supabase
          .from("student_answer")
          .select("exam_assignment_id, question_id, grading_code, earned_score")
          .in("exam_assignment_id", chunk);
        if (chunkAnswers) allAnswers = [...allAnswers, ...chunkAnswers];
      }

      const dedupAnsMap = new Map<string, any>();
      allAnswers.forEach((ans) => {
        if (!ans.grading_code) return;
        const k = `${ans.exam_assignment_id}_${ans.question_id}`;
        const ex = dedupAnsMap.get(k);
        if (
          !ex ||
          Number(ans.earned_score || 0) >= Number(ex.earned_score || 0)
        ) {
          dedupAnsMap.set(k, ans);
        }
      });

      const assignToExamMap = new Map<any, string>();
      (allAssignmentsForExams || []).forEach((a) =>
        assignToExamMap.set(a.assignment_id, String(a.exam_id))
      );
      validAssignments.forEach((a: any) =>
        assignToExamMap.set(a.assignment_id, String(a.exam_id))
      );

      const assignCounts: Record<
        string,
        {
          o: number;
          ro: number;
          to: number;
          totalAns: number;
          x: number;
          initScore: number;
          finScore: number;
        }
      > = {};
      dedupAnsMap.forEach((ans) => {
        const aId = ans.exam_assignment_id;
        if (!assignCounts[aId])
          assignCounts[aId] = {
            o: 0,
            ro: 0,
            to: 0,
            totalAns: 0,
            x: 0,
            initScore: 0,
            finScore: 0,
          };
        const c = assignCounts[aId];
        c.totalAns++;
        const exId = assignToExamMap.get(aId) || "";
        const cfg = examScoreConfigMap.get(exId);
        const qScore =
          cfg?.scoreByQuestionId.get(String(ans.question_id)) ??
          cfg?.defaultScore ??
          5;

        if (ans.grading_code === "O") {
          c.o++;
          c.initScore += qScore;
        } else if (ans.grading_code === "RO") c.ro++;
        else if (ans.grading_code === "TO") c.to++;
        else if (["X", "TX"].includes(ans.grading_code)) c.x++;
        c.finScore += calcScoreRatio(
          ans.grading_code,
          qScore,
          gcMeta,
          false
        ).newEarned;
      });

      const examScoreMap = new Map();
      (allAssignmentsForExams || []).forEach((a) => {
        const counts = assignCounts[a.assignment_id];
        if (!counts || counts.totalAns === 0) return;

        const initScore = roundScore(counts.initScore);
        const finScore = roundScore(counts.finScore);

        if (!examScoreMap.has(a.exam_id))
          examScoreMap.set(a.exam_id, { initSum: 0, finSum: 0, count: 0 });
        const avgData = examScoreMap.get(a.exam_id);
        avgData.initSum += initScore;
        avgData.finSum += finScore;
        avgData.count += 1;
      });

      const results = validAssignments.map((a: any) => {
        const counts = assignCounts[a.assignment_id] || {
          o: 0,
          ro: 0,
          to: 0,
          totalAns: 0,
          x: 0,
          initScore: 0,
          finScore: 0,
        };

        const originalScore = roundScore(counts.initScore);
        const finalScore =
          counts.totalAns > 0
            ? roundScore(counts.finScore)
            : roundScore(a.total_score || 0);

        const avgData = examScoreMap.get(a.exam_id);
        const classInitAvg =
          avgData && avgData.count > 0
            ? roundScore(avgData.initSum / avgData.count)
            : 0;
        const classFinAvg =
          avgData && avgData.count > 0
            ? roundScore(avgData.finSum / avgData.count)
            : 0;

        return {
          assignment_id: a.assignment_id,
          title: Array.isArray(a.exam_master)
            ? a.exam_master[0]?.title
            : a.exam_master?.title || "주간테스트",
          original_score: originalScore,
          final_score: finalScore,
          oCount: counts.o,
          roCount: counts.ro,
          toCount: counts.to,
          xCount: counts.x,
          class_init_avg: classInitAvg,
          class_fin_avg: classFinAvg,
          created_at: a.created_at,
        };
      });
      setExamResults(results);
    } catch (err) {
      console.error("시험 결과 로드 실패:", err);
    }
  };

  const loadCategoryAnalysis = async () => {
    try {
      const { data: assignments } = await supabase
        .from("exam_assignment")
        .select("assignment_id, status, exam_master(exam_type)")
        .eq("student_id", student.student_id)
        .order("created_at", { ascending: false });

      const validAssignments = (assignments || [])
        .filter((a: any) => {
          if (["응시전", "미응시", "예정", "대기"].includes(a.status))
            return false;
          const master = Array.isArray(a.exam_master)
            ? a.exam_master[0]
            : a.exam_master;
          if (master?.exam_type !== "주간테스트") return false;
          return true;
        })
        .slice(0, 10);

      if (validAssignments.length === 0) {
        setCategoryAnalysis([]);
        return;
      }
      const targetAssignIds = validAssignments.map((a) => a.assignment_id);

      const { data: answers } = await supabase
        .from("student_answer")
        .select("question_id, is_correct, grading_code")
        .in("exam_assignment_id", targetAssignIds);
      if (!answers || answers.length === 0) {
        setCategoryAnalysis([]);
        return;
      }

      const qIds = Array.from(new Set(answers.map((a) => a.question_id)));
      let questions: any[] = [];
      for (let i = 0; i < qIds.length; i += 200) {
        const chunk = qIds.slice(i, i + 200);
        const { data: qData } = await supabase
          .from("question_db")
          .select("question_id, taxonomy_id")
          .in("question_id", chunk);
        if (qData) questions = [...questions, ...qData];
      }

      const d4Codes = new Set<string>();
      const qIdToD4 = new Map<string, string>();

      questions.forEach((q) => {
        if (!q.taxonomy_id) return;
        const parts = q.taxonomy_id.split("-");
        const d4Code =
          parts.length >= 2 ? parts.slice(0, 2).join("-") : q.taxonomy_id;
        d4Codes.add(d4Code);
        qIdToD4.set(q.question_id, d4Code);
      });

      const uniqueD4Array = Array.from(d4Codes).filter(Boolean);
      if (uniqueD4Array.length === 0) {
        setCategoryAnalysis([]);
        return;
      }

      const catMap = new Map<string, string>();
      await Promise.all(
        uniqueD4Array.map(async (code) => {
          try {
            const { data } = await supabase
              .from("master_category")
              .select("category_id, depth4")
              .eq("category_id", code)
              .limit(1);
            if (data && data.length > 0 && data[0].depth4) {
              catMap.set(code, data[0].depth4);
              return;
            }
            const { data: likeData } = await supabase
              .from("master_category")
              .select("category_id, depth4")
              .like("category_id", `${code}-%`)
              .limit(1);
            if (likeData && likeData.length > 0 && likeData[0].depth4) {
              catMap.set(code, likeData[0].depth4);
            }
          } catch (e) {}
        })
      );

      const aggMap = new Map();
      answers.forEach((a) => {
        const d4Code = qIdToD4.get(a.question_id);
        if (!d4Code) return;
        let depth4Name = catMap.get(d4Code);
        if (!depth4Name || depth4Name.trim() === "") depth4Name = d4Code;

        if (!aggMap.has(d4Code)) {
          aggMap.set(d4Code, {
            code: d4Code,
            name: depth4Name,
            total: 0,
            initCorrect: 0,
            finCorrect: 0,
          });
        }
        const obj = aggMap.get(d4Code);
        obj.total += 1;

        if (a.grading_code === "O") {
          obj.initCorrect += 1;
          obj.finCorrect += 1;
        } else if (a.grading_code === "RO" || a.grading_code === "TO") {
          obj.finCorrect += 1;
        } else if (!a.grading_code && a.is_correct) {
          obj.initCorrect += 1;
          obj.finCorrect += 1;
        }
      });

      const finalData = Array.from(aggMap.values())
        .map((d) => ({
          ...d,
          initial_rate:
            d.total > 0 ? Math.round((d.initCorrect / d.total) * 100) : 0,
          final_rate:
            d.total > 0 ? Math.round((d.finCorrect / d.total) * 100) : 0,
        }))
        .sort((a, b) => a.code.localeCompare(b.code));

      setCategoryAnalysis(finalData);
    } catch (err) {}
  };

  const loadSchoolExams = async () => {
    const { data } = await supabase
      .from("student_school_exam")
      .select("*")
      .eq("student_id", student.student_id)
      .order("year", { ascending: false })
      .order("semester", { ascending: false })
      .order("exam_type", { ascending: true });
    setSchoolExams(data || []);
  };

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const handlePrevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const handleNextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  // 출결 데이터 매핑
  const attendanceMap = new Map();
  if (student.attendance) {
    student.attendance.forEach((record: any) => {
      if (record.attendance_date) {
        let st = record.status;
        if (
          !["조퇴", "결석", "지각"].includes(st) &&
          (st === "등원" || record.check_in_time)
        ) {
          st = "출석";
        }
        attendanceMap.set(record.attendance_date, { ...record, status: st });
      }
    });
  }

  const selectedDateStr = `${selectedDate.getFullYear()}-${String(
    selectedDate.getMonth() + 1
  ).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`;
  const selectedAtt = attendanceMap.get(selectedDateStr);

  const formatTime = (isoString: string) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    return date.toLocaleTimeString("ko-KR", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // 🌟 최근 2주의 기준 날짜 계산 (필터링 용도)
  const twoWeeksAgoMs =
    new Date(getKSTDateStr()).getTime() - 14 * 24 * 3600000;

  // ==========================================================
  // 🎨 화면 (신뢰감 있는 브랜드 네이비/블루 + 따뜻한 파스텔 톤 조화)
  // ==========================================================

  const todayStatus = useMemo(() => {
    const todayStr = getKSTDateStr();
    const todayAtt = attendanceMap.get(todayStr);
    if (!todayAtt) return { text: "아직 등원 전이에요", tone: "idle" };
    const inTime = formatTime(todayAtt.check_in_time);
    const outTime = formatTime(todayAtt.check_out_time);
    if (todayAtt.status === "결석")
      return { text: "오늘은 결석으로 처리되었어요", tone: "danger" };
    if (todayAtt.status === "조퇴")
      return { text: `${outTime || ""} 조퇴했어요`.trim(), tone: "warn" };
    if (todayAtt.check_out_time || todayAtt.status === "하원")
      return {
        text: `${inTime ? inTime + " 등원, " : ""}${outTime} 하원했어요`,
        tone: "done",
      };
    if (todayAtt.status === "지각")
      return { text: `${inTime} 등원(지각), 학원에 있어요`, tone: "warn" };
    return { text: `${inTime} 등원, 학원에 있어요`, tone: "done" };
  }, [attendanceMap]);

  const TONE_DOT: Record<string, string> = {
    done: "bg-[#10B981]",
    warn: "bg-[#F59E0B]",
    danger: "bg-[#F43F5E]",
    idle: "bg-[#94A3B8]",
  };

  const TONE_BANNER: Record<string, string> = {
    done: "bg-[#F0FDF4]/80 border-[#BBF7D0]",
    warn: "bg-[#FFFBEB]/85 border-[#FDE68A]",
    danger: "bg-[#FFF1F2]/85 border-[#FECDD3]",
    idle: "bg-[#F8FAFC] border-[#E2E8F0]",
  };

  const todayLabel = (() => {
    const d = new Date(getKSTDateStr());
    return `오늘, ${d.getMonth() + 1}월 ${d.getDate()}일 ${
      WEEKDAYS[d.getDay()]
    }요일`;
  })();

  // 최근 4주 출결 요약
  const recentAttendance = useMemo(() => {
    const fromStr = getKSTDateStr(-27);
    let present = 0,
      late = 0,
      absent = 0,
      early = 0;
    attendanceMap.forEach((rec: any, date: string) => {
      if (date < fromStr) return;
      if (rec.status === "결석") absent++;
      else if (rec.status === "지각") late++;
      else if (rec.status === "조퇴") early++;
      else present++;
    });
    return {
      attended: present + late + early,
      total: present + late + early + absent,
      late,
      absent,
      early,
    };
  }, [attendanceMap]);

  // 이번에 보는 달의 출결 요약
  const monthAttendance = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    let present = 0,
      late = 0,
      absent = 0,
      early = 0;
    attendanceMap.forEach((rec: any, date: string) => {
      if (!date.startsWith(prefix)) return;
      if (rec.status === "결석") absent++;
      else if (rec.status === "지각") late++;
      else if (rec.status === "조퇴") early++;
      else present++;
    });
    return { present, late, absent, early };
  }, [attendanceMap, year, month]);

  // 시간표 한 줄 요약: 시간이 모두 같으면 "화수금 17:00~19:00"
  const scheduleText = (() => {
    const list = currentClass?.class_schedule || [];
    if (list.length === 0) return "";
    const order = ["월", "화", "수", "목", "금", "토", "일"];
    const sorted = [...list].sort(
      (a: any, b: any) =>
        order.indexOf(String(a.day_of_week).charAt(0)) -
        order.indexOf(String(b.day_of_week).charAt(0))
    );
    const timeOf = (sc: any) => {
      const s = sc.start_time?.substring(0, 5) || "";
      const e = sc.end_time?.substring(0, 5) || "";
      return e ? `${s}~${e}` : s;
    };
    const times = Array.from(new Set(sorted.map(timeOf)));
    if (times.length === 1)
      return `${sorted
        .map((sc: any) => String(sc.day_of_week).charAt(0))
        .join("")} ${times[0]}`;
    return sorted
      .map((sc: any) => `${String(sc.day_of_week).charAt(0)} ${timeOf(sc)}`)
      .join(", ");
  })();

  const books: any[] = student.progressBooks || [];
  const mainBook =
    books.find((cb: any) => unwrap(cb.textbook)?.book_type === "주교재") ||
    books[0];
  const latestExam = examResults[0];

  const [selectedBookIdx, setSelectedBookIdx] = useState(0);
  const selectedBook =
    books[Math.min(selectedBookIdx, Math.max(0, books.length - 1))];

  // 한 줄 20쪽의 산뜻한 파스텔·에메랄드 진도 블록
  const renderPageBlocks = (
    bookPages: number[],
    pageStatuses: Record<number, "done" | "homework" | "none" | "excluded">,
    startPage?: number
  ) => {
    if (!bookPages || bookPages.length === 0) {
      return (
        <p className="text-[14px] text-[#64748B]">
          이 교재의 페이지 정보가 아직 없어요.
        </p>
      );
    }
    const PER_ROW = 20;
    const rows: number[][] = [];
    for (let i = 0; i < bookPages.length; i += PER_ROW)
      rows.push(bookPages.slice(i, i + PER_ROW));
    const look = (p: number) => {
      const st = pageStatuses[p] || "none";
      const before = startPage !== undefined && p < startPage;
      if (st === "done" && before)
        return {
          cls: "bg-[#A7F3D0] hover:bg-[#6EE7B7]",
          text: `${p}쪽: 합류 이전, 보강으로 완료`,
        };
      if (st === "done")
        return {
          cls: "bg-[#34D399] hover:bg-[#10B981]",
          text: `${p}쪽: 완료`,
        };
      if (st === "homework")
        return {
          cls: "bg-[#FBBF24] hover:bg-[#F59E0B]",
          text: `${p}쪽: 과제 진행 중`,
        };
      if (st === "excluded" || before)
        return {
          cls: "bg-[#F8FAFC] border border-[#E2E8F0]",
          text: `${p}쪽: 합류 이전 (진도율 계산 제외)`,
        };
      return {
        cls: "bg-[#EDF2F7] hover:bg-[#E2E8F0]",
        text: `${p}쪽: 아직 안 함`,
      };
    };
    return (
      <div
        className="flex flex-col gap-[3px]"
        aria-label="페이지별 진도, 한 줄에 20쪽"
      >
        {rows.map((row, ri) => (
          <div key={ri} className="flex items-center gap-1.5">
            <span className="w-8 shrink-0 text-right text-[12px] text-[#64748B] tabular-nums">
              {row[0]}
            </span>
            <div
              className="flex-1 grid gap-[2px]"
              style={{ gridTemplateColumns: `repeat(${PER_ROW}, minmax(0, 1fr))` }}
            >
              {row.map((p) => {
                const l = look(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-label={l.text}
                    onClick={() => showToast(l.text)}
                    className={`h-[14px] rounded-[3px] transition-colors ${l.cls}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderGrowthChart = () => {
    if (examResults.length === 0)
      return <EmptyBox text="아직 주간테스트 기록이 없어요." />;

    const chartData = [...examResults.slice(0, 10)].reverse();
    const height = 260;
    const paddingX = 40;
    const paddingY = 40;
    const maxScore = 100;
    const xStep = 85;
    const dynamicWidth = Math.max(
      300,
      paddingX * 2 + (chartData.length - 1) * xStep + 40
    );
    const getY = (score: number) =>
      height - paddingY - (score / maxScore) * (height - paddingY * 2);

    const pointsInitAvg = chartData
      .map((r: any, i: number) => `${paddingX + i * xStep + 20},${getY(r.class_init_avg)}`)
      .join(" ");
    const pointsFinAvg = chartData
      .map((r: any, i: number) => `${paddingX + i * xStep + 20},${getY(r.class_fin_avg)}`)
      .join(" ");

    return (
      <section className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(15,23,42,0.03)] flex flex-col gap-3">
        <div>
          <h3 className="text-[17px] font-bold text-[#1E293B]">
            주간테스트 점수 변화
          </h3>
          <p className="text-[13px] text-[#64748B] mt-1 leading-relaxed">
            처음 푼 점수와 오답을 고친 뒤의 점수, 같은 시험의 반 평균이에요.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-2 text-[13px] text-[#475569]">
          <li className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-[#2563EB]"></span>처음 점수
          </li>
          <li className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-[#93C5FD]"></span>고친 뒤 점수
          </li>
          <li className="flex items-center gap-2">
            <svg width="20" height="10" aria-hidden="true">
              <line
                x1="0"
                y1="5"
                x2="20"
                y2="5"
                stroke="#94A3B8"
                strokeWidth="2"
                strokeDasharray="3 3"
              />
            </svg>
            반 평균 (처음)
          </li>
          <li className="flex items-center gap-2">
            <svg width="20" height="10" aria-hidden="true">
              <line
                x1="0"
                y1="5"
                x2="20"
                y2="5"
                stroke="#10B981"
                strokeWidth="2"
                strokeDasharray="3 3"
              />
            </svg>
            반 평균 (고친 뒤)
          </li>
        </ul>

        <div className="w-full overflow-x-auto overflow-y-hidden pb-1">
          <svg
            viewBox={`0 0 ${dynamicWidth} ${height}`}
            className="w-full"
            style={{ minWidth: dynamicWidth, height }}
            role="img"
            aria-label="주간테스트 점수 막대 그래프"
          >
            {[0, 25, 50, 75, 100].map((score) => (
              <g key={score}>
                <line
                  x1={paddingX - 10}
                  y1={getY(score)}
                  x2={dynamicWidth - 10}
                  y2={getY(score)}
                  stroke="#F1F5F9"
                  strokeWidth="1.5"
                />
                <text
                  x={paddingX - 15}
                  y={getY(score) + 4}
                  fontSize="11"
                  fill="#64748B"
                  textAnchor="end"
                >
                  {score}
                </text>
              </g>
            ))}
            {chartData.map((r: any, i: number) => {
              const cx = paddingX + i * xStep + 20;
              const initialScore = r.original_score || 0;
              const finalScore = r.final_score || initialScore;
              const barWidth = 32;
              const shortTitle =
                (r.title || "시험").length > 8
                  ? (r.title || "시험").substring(0, 8) + ".."
                  : r.title || "시험";
              return (
                <g key={`bar-${i}`}>
                  {finalScore > 0 && (
                    <rect
                      x={cx - barWidth / 2}
                      y={getY(finalScore)}
                      width={barWidth}
                      height={height - paddingY - getY(finalScore)}
                      fill="#93C5FD"
                      rx="5"
                    />
                  )}
                  {initialScore > 0 && (
                    <rect
                      x={cx - barWidth / 2}
                      y={getY(initialScore)}
                      width={barWidth}
                      height={height - paddingY - getY(initialScore)}
                      fill="#2563EB"
                      rx="5"
                    />
                  )}
                  <text
                    x={cx}
                    y={height - 15}
                    fontSize="11"
                    fill="#475569"
                    textAnchor="middle"
                  >
                    {shortTitle}
                  </text>
                  {finalScore > 0 && (
                    <text
                      x={cx}
                      y={getY(100) - 12}
                      fontSize="13"
                      fill="#1E293B"
                      textAnchor="middle"
                      fontWeight="700"
                    >
                      {finalScore}
                    </text>
                  )}
                </g>
              );
            })}
            <polyline
              points={pointsInitAvg}
              fill="none"
              stroke="#94A3B8"
              strokeWidth="2"
              strokeDasharray="4 4"
            />
            <polyline
              points={pointsFinAvg}
              fill="none"
              stroke="#10B981"
              strokeWidth="2"
              strokeDasharray="4 4"
            />
            {chartData.map((r: any, i: number) => {
              const cx = paddingX + i * xStep + 20;
              return (
                <g key={`avg-${i}`}>
                  <circle
                    cx={cx}
                    cy={getY(r.class_init_avg)}
                    r="4"
                    fill="#FFFFFF"
                    stroke="#94A3B8"
                    strokeWidth="2"
                  />
                  <circle
                    cx={cx}
                    cy={getY(r.class_fin_avg)}
                    r="4"
                    fill="#FFFFFF"
                    stroke="#10B981"
                    strokeWidth="2"
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </section>
    );
  };

  const TABS: { id: typeof activeTab; label: string }[] = [
    { id: "attendance", label: "출결" },
    { id: "progress", label: "진도" },
    { id: "homework", label: "수업일지" },
    { id: "makeup", label: "보강" },
    { id: "exam", label: "성적" },
    { id: "consultation", label: "상담" },
  ];

  const ATT_DOT: Record<string, string> = {
    출석: "bg-[#10B981]",
    지각: "bg-[#F59E0B]",
    조퇴: "bg-[#F59E0B]",
    결석: "bg-[#F43F5E]",
  };
  const ATT_BG_SOFT: Record<string, string> = {
    출석: "bg-[#ECFDF5] text-[#065F46] font-semibold",
    지각: "bg-[#FFFBEB] text-[#92400E] font-semibold",
    조퇴: "bg-[#FFFBEB] text-[#92400E] font-semibold",
    결석: "bg-[#FFF1F2] text-[#9F1239] font-semibold",
  };
  const ATT_TEXT: Record<string, string> = {
    출석: "text-[#059669]",
    지각: "text-[#D97706]",
    조퇴: "text-[#D97706]",
    결석: "text-[#E11D48]",
  };

  const MAKEUP_CHIP: Record<string, string> = {
    예정: "bg-[#DBEAFE] text-[#1D4ED8]",
    진행중: "bg-[#FEF3C7] text-[#B45309]",
    완료: "bg-[#DCFCE7] text-[#15803D]",
    취소: "bg-[#F1F5F9] text-[#64748B]",
  };

  const visibleLessonLogs = showAllLogs
    ? lessonLogs
    : lessonLogs.filter(
        (l) => new Date(l.actual_date).getTime() >= twoWeeksAgoMs
      );
  const hiddenOlderLogsCount = Math.max(
    0,
    lessonLogs.length - visibleLessonLogs.length
  );

  return (
    <div className="bg-[#F8FAFC] rounded-2xl border border-[#E2E8F0] shadow-[0_2px_12px_rgba(15,23,42,0.04)] overflow-hidden font-pretendard relative max-w-full text-[#1E293B]">
      {/* 학생 요약 */}
      <div className="bg-white px-5 pt-5 pb-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[22px] font-bold leading-tight text-[#0F172A]">
              {student.name}
            </h2>
            {className && (
              <span className="text-[12px] font-semibold px-2.5 py-0.5 rounded-full bg-[#EFF6FF] text-[#1D4ED8]">
                {className}
              </span>
            )}
          </div>
          <p className="text-[14px] text-[#64748B]">
            {[student.grade || "학년 정보 없음", scheduleText]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        {/* 오늘 상태 배너 (파스텔 배경 적용) */}
        <section
          aria-label="오늘"
          className={`rounded-xl border p-4 flex flex-col gap-2.5 transition-colors ${
            TONE_BANNER[todayStatus.tone] || TONE_BANNER.idle
          }`}
        >
          <div className="text-[13px] font-semibold text-[#64748B]">
            {todayLabel}
          </div>
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                TONE_DOT[todayStatus.tone]
              }`}
            ></span>
            <span className="text-[16px] font-bold text-[#1E293B]">
              {todayStatus.text}
            </span>
          </div>
          {pendingHw && (
            <div className="flex items-center gap-2.5 pt-0.5">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  pendingHw.count > 0 ? "bg-[#F59E0B]" : "bg-[#10B981]"
                }`}
              ></span>
              <span className="text-[14.5px] text-[#334155]">
                {pendingHw.count > 0
                  ? `남은 과제 ${pendingHw.count}개${
                      pendingHw.nextDue
                        ? `, 가장 빠른 마감 ${formatDueLabel(pendingHw.nextDue)}`
                        : ""
                    }`
                  : "마감 전 남은 과제가 없어요"}
              </span>
            </div>
          )}
        </section>

        {/* 핵심 지표 3종 파스텔 틴트 카드 */}
        <section aria-label="요약" className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-[#DCFCE7] bg-[#F0FDF4]/75 px-3 py-3 flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-[#15803D]">
              최근 4주 출석
            </span>
            <span className="text-[25px] font-bold text-[#14532D] tabular-nums leading-tight">
              {recentAttendance.attended}
              <span className="text-[14px] font-medium text-[#15803D]/80">
                /{recentAttendance.total}회
              </span>
            </span>
            {(recentAttendance.late > 0 || recentAttendance.absent > 0) && (
              <span className="text-[11.5px] text-[#475569]">
                {[
                  recentAttendance.late > 0
                    ? `지각 ${recentAttendance.late}회`
                    : "",
                  recentAttendance.absent > 0
                    ? `결석 ${recentAttendance.absent}회`
                    : "",
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            )}
          </div>

          <div className="rounded-xl border border-[#DBEAFE] bg-[#EFF6FF]/80 px-3 py-3 flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-[#1D4ED8]">
              주교재 진도
            </span>
            <span className="text-[25px] font-bold text-[#1E3A8A] tabular-nums leading-tight">
              {mainBook ? mainBook.stats?.percent ?? 0 : "-"}
              <span className="text-[14px] font-medium text-[#1D4ED8]/80">
                {mainBook ? "%" : ""}
              </span>
            </span>
            {mainBook && (
              <span className="text-[11.5px] text-[#475569] truncate">
                {mainBook.stats?.donePagesCount ?? 0}/
                {mainBook.stats?.maxPageCount ?? 0}쪽 완료
              </span>
            )}
          </div>

          <div className="rounded-xl border border-[#E0E7FF] bg-[#EEF2FF]/80 px-3 py-3 flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-[#4338CA]">
              주간테스트
            </span>
            <span className="text-[25px] font-bold text-[#312E81] tabular-nums leading-tight">
              {latestExam ? latestExam.original_score ?? 0 : "-"}
              <span className="text-[14px] font-medium text-[#4338CA]/80">
                {latestExam ? "점" : ""}
              </span>
            </span>
            {latestExam && (
              <span className="text-[11.5px] text-[#475569]">
                반 평균 {latestExam.class_init_avg}점
              </span>
            )}
          </div>
        </section>
      </div>

      {/* 탭 */}
      <nav
        aria-label="자세히 보기"
        className="bg-white border-y border-[#E2E8F0] px-3 flex gap-1 overflow-x-auto"
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 min-h-[48px] px-3.5 text-[15px] border-b-[3px] transition-colors ${
                active
                  ? "border-[#2563EB] text-[#1D4ED8] font-bold"
                  : "border-transparent text-[#64748B] hover:text-[#334155] font-medium"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4 sm:p-5 min-h-[400px] flex flex-col gap-4">
        {/* 출결 */}
        {activeTab === "attendance" && (
          <>
            <section className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(15,23,42,0.03)] p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  aria-label="이전 달"
                  className="w-10 h-10 rounded-full flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9]"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M15 19l-7-7 7-7"
                    ></path>
                  </svg>
                </button>
                <span className="text-[17px] font-bold text-[#1E293B]">
                  {year}년 {month + 1}월
                </span>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  aria-label="다음 달"
                  className="w-10 h-10 rounded-full flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9]"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 5l7 7-7 7"
                    ></path>
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-7 text-center text-[12px] font-medium text-[#64748B]">
                {WEEKDAYS.map((w, i) => (
                  <span
                    key={w}
                    className={
                      i === 0
                        ? "text-[#F43F5E]"
                        : i === 6
                        ? "text-[#3B82F6]"
                        : ""
                    }
                  >
                    {w}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-y-1 text-center">
                {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                  <div key={`empty-${i}`} />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const d = i + 1;
                  const dateStr = `${year}-${String(month + 1).padStart(
                    2,
                    "0"
                  )}-${String(d).padStart(2, "0")}`;
                  const isSelected = selectedDateStr === dateStr;
                  const att = attendanceMap.get(dateStr);
                  const dot = att
                    ? ATT_DOT[att.status] || "bg-[#94A3B8]"
                    : "";
                  const softCircle =
                    !isSelected && att
                      ? ATT_BG_SOFT[att.status] || "text-[#334155]"
                      : "text-[#334155]";
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSelectedDate(new Date(year, month, d))}
                      aria-label={`${month + 1}월 ${d}일${
                        att ? `, ${att.status}` : ""
                      }`}
                      aria-pressed={isSelected}
                      className="h-11 flex flex-col items-center justify-center gap-[3px]"
                    >
                      <span
                        className={`w-8 h-8 flex items-center justify-center rounded-full text-[14px] tabular-nums transition-colors ${
                          isSelected
                            ? "bg-[#2563EB] text-white font-bold shadow-xs"
                            : softCircle
                        }`}
                      >
                        {d}
                      </span>
                      <span className={`w-1.5 h-1.5 rounded-full ${dot}`}></span>
                    </button>
                  );
                })}
              </div>

              <ul
                aria-label="달력 안내"
                className="flex flex-wrap gap-x-4 gap-y-2 pt-1 border-t border-[#F1F5F9] text-[13px] text-[#475569]"
              >
                <li className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]"></span>
                  출석
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]"></span>
                  지각·조퇴
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#F43F5E]"></span>
                  결석
                </li>
              </ul>
            </section>

            <section className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(15,23,42,0.03)] p-4 flex flex-col gap-3">
              <h3 className="text-[15px] font-bold text-[#1E293B]">
                {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일{" "}
                {WEEKDAYS[selectedDate.getDay()]}요일
              </h3>
              {selectedAtt ? (
                <div className="grid grid-cols-[64px_1fr] gap-y-2 text-[15px]">
                  <span className="text-[#64748B]">상태</span>
                  <span
                    className={`font-bold ${
                      ATT_TEXT[selectedAtt.status] || "text-[#334155]"
                    }`}
                  >
                    {selectedAtt.status}
                  </span>
                  {selectedAtt.status !== "결석" && (
                    <>
                      <span className="text-[#64748B]">등원</span>
                      <span className="tabular-nums font-medium">
                        {formatTime(selectedAtt.check_in_time) || "-"}
                      </span>
                      <span className="text-[#64748B]">하원</span>
                      <span className="tabular-nums font-medium">
                        {formatTime(selectedAtt.check_out_time) ||
                          "아직 학원에 있어요"}
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-[14px] text-[#64748B]">
                  이 날의 출결 기록이 없어요.
                </p>
              )}
            </section>

            <section
              aria-label={`${month + 1}월 출결 요약`}
              className="grid grid-cols-3 gap-2.5"
            >
              <div className="bg-[#F0FDF4]/80 rounded-xl border border-[#DCFCE7] px-3 py-3 flex flex-col gap-1">
                <span className="text-[12.5px] font-semibold text-[#15803D]">
                  {month + 1}월 출석
                </span>
                <span className="text-[25px] font-bold text-[#059669] tabular-nums leading-tight">
                  {monthAttendance.present}
                  <span className="text-[14px] font-medium text-[#15803D]/80">
                    회
                  </span>
                </span>
              </div>
              <div className="bg-[#FFFBEB]/85 rounded-xl border border-[#FEF3C7] px-3 py-3 flex flex-col gap-1">
                <span className="text-[12.5px] font-semibold text-[#B45309]">
                  지각·조퇴
                </span>
                <span className="text-[25px] font-bold text-[#D97706] tabular-nums leading-tight">
                  {monthAttendance.late + monthAttendance.early}
                  <span className="text-[14px] font-medium text-[#B45309]/80">
                    회
                  </span>
                </span>
              </div>
              <div className="bg-[#FFF1F2]/80 rounded-xl border border-[#FFE4E6] px-3 py-3 flex flex-col gap-1">
                <span className="text-[12.5px] font-semibold text-[#BE123C]">
                  결석
                </span>
                <span
                  className={`text-[25px] font-bold tabular-nums leading-tight ${
                    monthAttendance.absent > 0
                      ? "text-[#E11D48]"
                      : "text-[#334155]"
                  }`}
                >
                  {monthAttendance.absent}
                  <span className="text-[14px] font-medium text-[#BE123C]/80">
                    회
                  </span>
                </span>
              </div>
            </section>
          </>
        )}

        {/* 진도 */}
        {activeTab === "progress" && (
          <>
            {books.length === 0 ? (
              <EmptyBox text="지금 반에 배정된 교재가 없어요." />
            ) : (
              <>
                {books.length > 1 && (
                  <div
                    role="group"
                    aria-label="교재 선택"
                    className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                  >
                    {books.map((cb: any, idx: number) => {
                      const tb = unwrap(cb.textbook);
                      const active = selectedBook === cb;
                      const pct = cb.stats?.percent ?? 0;
                      const isBookDone = pct >= 100;
                      const bType = tb?.book_type || "교재";
                      const bTitle = tb?.title || "교재명 없음";
                      return (
                        <button
                          key={cb.class_textbook_id || cb.book_id || idx}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setSelectedBookIdx(idx)}
                          className={`flex flex-col gap-1 text-left px-3.5 py-2.5 rounded-xl border transition-all ${
                            active
                              ? "bg-[#EFF6FF] text-[#1E3A8A] border-[#3B82F6] ring-1 ring-[#3B82F6]/30 shadow-xs"
                              : "bg-white text-[#334155] border-[#E2E8F0] hover:bg-[#F8FAFC]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 w-full">
                            <span
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                active
                                  ? "bg-[#DBEAFE] text-[#1D4ED8]"
                                  : bType === "주교재"
                                  ? "bg-[#EFF6FF] text-[#2563EB]"
                                  : "bg-[#F1F5F9] text-[#475569]"
                              }`}
                            >
                              {bType}
                            </span>
                            <span
                              className={`text-[13px] font-bold tabular-nums ${
                                isBookDone
                                  ? "text-[#059669]"
                                  : active
                                  ? "text-[#1D4ED8]"
                                  : "text-[#475569]"
                              }`}
                            >
                              {isBookDone ? "✓ 100% 완료" : `${pct}%`}
                            </span>
                          </div>
                          <span
                            className={`text-[14px] font-bold truncate w-full ${
                              active ? "text-[#1E3A8A]" : "text-[#1E293B]"
                            }`}
                          >
                            {bTitle}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedBook &&
                  (() => {
                    const tb = unwrap(selectedBook.textbook);
                    const stats = selectedBook.stats || {
                      percent: 0,
                      donePagesCount: 0,
                      maxPageCount: 0,
                      pageStatuses: {},
                      bookPages: [],
                    };
                    const hasStart = stats.startPage !== undefined;

                    // 목표 일정 & 실제 진행 일정 계산
                    const targetStart = formatShortDate(selectedBook.start_date);
                    const targetEnd = formatShortDate(selectedBook.end_date);
                    const hasTargetSchedule = !!(targetStart || targetEnd);

                    const actualStart = formatShortDate(stats.actualStartDate);
                    const actualEnd = formatShortDate(stats.actualEndDate);
                    const isBookCompleted = (stats.percent ?? 0) >= 100;

                    // 최근 완료 페이지 및 현재 과제 진행 중 페이지 계산
                    const allPages: number[] = stats.bookPages || [];
                    const donePages = allPages.filter(
                      (p) => stats.pageStatuses?.[p] === "done"
                    );
                    const hwPages = allPages.filter(
                      (p) => stats.pageStatuses?.[p] === "homework"
                    );

                    const recentDoneText =
                      stats.recentDonePageRange ||
                      (donePages.length > 0
                        ? formatPageRanges(donePages.slice(-8), 2)
                        : "");
                    const lastDonePage =
                      donePages.length > 0
                        ? donePages[donePages.length - 1]
                        : null;
                    const currentHwText =
                      hwPages.length > 0 ? formatPageRanges(hwPages, 3) : "";

                    return (
                      <section className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(15,23,42,0.03)] p-4 flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[12px] font-semibold px-2.5 py-0.5 rounded-full bg-[#DBEAFE] text-[#1D4ED8]">
                              {tb?.book_type || "교재"}
                            </span>
                            <span className="text-[15px] font-bold text-[#0F172A]">
                              {tb?.title || "교재명 없음"}
                            </span>
                          </div>
                          <div className="flex items-baseline gap-2 flex-wrap mt-1">
                            <span
                              className={`text-[40px] font-bold tabular-nums leading-none ${
                                isBookCompleted
                                  ? "text-[#059669]"
                                  : "text-[#1D4ED8]"
                              }`}
                            >
                              {stats.percent}%
                            </span>
                            <span className="text-[15px] text-[#475569]">
                              전체 {stats.maxPageCount}쪽 중{" "}
                              <strong className="font-bold text-[#1E293B]">
                                {stats.donePagesCount}쪽
                              </strong>{" "}
                              완료
                            </span>
                          </div>
                          {/* 전체 진도율 프로그레스 바 (파스텔 트랙 + 산뜻한 컬러 바) */}
                          <div className="w-full h-2.5 bg-[#EFF6FF] rounded-full overflow-hidden mt-1">
                            <div
                              className={`h-full rounded-full transition-all ${
                                isBookCompleted ? "bg-[#10B981]" : "bg-[#3B82F6]"
                              }`}
                              style={{
                                width: `${Math.min(100, stats.percent || 0)}%`,
                              }}
                            />
                          </div>
                        </div>

                        {/* 교재 일정 및 최근 진행 페이지 요약 박스 (부드러운 파스텔 스카이 톤) */}
                        <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-3.5 flex flex-col gap-2 text-[13.5px]">
                          {hasTargetSchedule && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[#64748B] font-medium shrink-0">
                                목표 일정
                              </span>
                              <span className="text-[#1E293B] font-semibold tabular-nums text-right">
                                {targetStart || "미정"} ~ {targetEnd || "미정"}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[#64748B] font-medium shrink-0">
                              실제 진행 기간
                            </span>
                            <span className="text-[#1E293B] font-semibold tabular-nums text-right">
                              {actualStart ? (
                                <>
                                  {actualStart} ~{" "}
                                  {actualEnd || formatShortDate(getKSTDateStr())}{" "}
                                  <span
                                    className={`inline-block ml-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                      isBookCompleted
                                        ? "bg-[#DCFCE7] text-[#15803D]"
                                        : "bg-[#DBEAFE] text-[#1D4ED8]"
                                    }`}
                                  >
                                    {isBookCompleted ? "완료" : "진행중"}
                                  </span>
                                </>
                              ) : (
                                <span className="text-[#64748B] font-normal">
                                  첫 진도 체크 전이에요
                                </span>
                              )}
                            </span>
                          </div>

                          <div className="border-t border-[#E2E8F0] pt-2 mt-0.5 flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[#64748B] font-medium shrink-0">
                                최근 완료 위치
                              </span>
                              <span className="text-[#059669] font-semibold text-right">
                                {lastDonePage
                                  ? `마지막 완료 ${lastDonePage}쪽 (${recentDoneText})`
                                  : "아직 완료된 페이지가 없어요"}
                              </span>
                            </div>
                            {currentHwText && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[#64748B] font-medium shrink-0">
                                  과제 진행 페이지
                                </span>
                                <span className="text-[#D97706] font-semibold text-right">
                                  {currentHwText} ({hwPages.length}쪽 진행 중)
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {hasStart && (
                          <p className="text-[13.5px] leading-relaxed text-[#1E3A8A] bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg px-3 py-2">
                            💡 {stats.startPage}쪽부터 반에 합류하여, 그 이전 페이지는 진도율 계산에서 제외했어요.
                          </p>
                        )}

                        <ul
                          aria-label="색 안내"
                          className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px] text-[#475569]"
                        >
                          <li className="flex items-center gap-2">
                            <span className="w-3.5 h-3.5 rounded-[3px] bg-[#34D399]"></span>
                            완료 ({donePages.length}쪽)
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="w-3.5 h-3.5 rounded-[3px] bg-[#FBBF24]"></span>
                            과제 진행 중 ({hwPages.length}쪽)
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="w-3.5 h-3.5 rounded-[3px] bg-[#EDF2F7] border border-[#CBD5E1]"></span>
                            아직 안 함
                          </li>
                          {hasStart && (
                            <li className="flex items-center gap-2">
                              <span className="w-3.5 h-3.5 rounded-[3px] bg-[#F8FAFC] border border-[#E2E8F0]"></span>
                              합류 이전 (계산 제외)
                            </li>
                          )}
                          {hasStart && (
                            <li className="flex items-center gap-2">
                              <span className="w-3.5 h-3.5 rounded-[3px] bg-[#A7F3D0]"></span>
                              합류 이전, 보강 완료
                            </li>
                          )}
                        </ul>

                        {renderPageBlocks(
                          stats.bookPages,
                          stats.pageStatuses,
                          stats.startPage
                        )}
                      </section>
                    );
                  })()}
              </>
            )}
          </>
        )}

        {/* 수업일지 (선생님이 직접 입력한 수업일지 및 개별 코멘트 그대로 노출) */}
        {activeTab === "homework" && (
          <section className="flex flex-col gap-3">
            <h3 className="text-[17px] font-bold text-[#1E293B]">
              수업일지
            </h3>
            {isLogsLoading ? (
              <LoadingBox text="수업일지를 불러오는 중이에요." />
            ) : visibleLessonLogs.length === 0 &&
              hiddenOlderLogsCount === 0 ? (
              <EmptyBox text="아직 작성된 수업일지가 없어요." />
            ) : (
              <>
                {visibleLessonLogs.map((log) => (
                  <article
                    key={`hw-${log.lesson_log_id}`}
                    className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(15,23,42,0.03)] px-4 py-3.5 flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-bold text-[#1E293B]">
                        {formatKDate(log.actual_date)} 수업
                      </span>
                    </div>
                    {log.my_individual_comment && (
                      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl px-3.5 py-2.5 flex flex-col gap-1">
                        <span className="text-[12.5px] font-bold text-[#1D4ED8]">
                          💌 {student.name} 학생에게 따로 남긴 말
                        </span>
                        <p className="text-[14px] text-[#1E3A8A] leading-relaxed whitespace-pre-wrap">
                          {log.my_individual_comment}
                        </p>
                      </div>
                    )}
                    {(log.parsed_progress || log.parsed_homework) && (
                      <div className="flex flex-col gap-2 text-[14px] leading-relaxed">
                        {log.parsed_progress && (
                          <div className="flex items-start gap-2.5">
                            <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded-md bg-[#ECFDF5] text-[#059669] text-[12px] font-semibold">
                              진도
                            </span>
                            <span className="whitespace-pre-wrap text-[#1E293B]">
                              {log.parsed_progress}
                            </span>
                          </div>
                        )}
                        {log.parsed_homework && (
                          <div className="flex items-start gap-2.5">
                            <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded-md bg-[#FFFBEB] text-[#D97706] text-[12px] font-semibold">
                              과제
                            </span>
                            <span className="whitespace-pre-wrap text-[#334155]">
                              {log.parsed_homework}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                ))}
                {!showAllLogs && hiddenOlderLogsCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllLogs(true)}
                    className="min-h-[48px] rounded-xl border border-[#CBD5E1] bg-white text-[15px] font-semibold text-[#334155] hover:bg-[#F8FAFC]"
                  >
                    이전 수업일지 {hiddenOlderLogsCount}개 더 보기
                  </button>
                )}
              </>
            )}
          </section>
        )}

        {/* 보강 */}
        {activeTab === "makeup" && (
          <>
            <h3 className="text-[17px] font-bold text-[#1E293B]">보강 일정</h3>
            {isMakeupLoading ? (
              <LoadingBox text="보강 일정을 불러오는 중이에요." />
            ) : makeups.length === 0 ? (
              <EmptyBox text="잡힌 보강 일정이 없어요." />
            ) : (
              makeups.map((m: any) => {
                const d = new Date(m.schedule_date);
                const timeStr = `${String(d.getHours()).padStart(
                  2,
                  "0"
                )}:${String(d.getMinutes()).padStart(2, "0")}`;
                const status = m.status || "예정";
                return (
                  <article
                    key={m.makeup_id}
                    className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(15,23,42,0.03)] px-4 py-3.5 flex flex-col gap-2"
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-[15px] font-bold text-[#1E293B]">
                        {d.getMonth() + 1}월 {d.getDate()}일{" "}
                        {WEEKDAYS[d.getDay()]}요일 {timeStr}
                      </span>
                      <span
                        className={`text-[12px] font-semibold rounded-full px-2.5 py-1 shrink-0 ${
                          MAKEUP_CHIP[status] || MAKEUP_CHIP["예정"]
                        }`}
                      >
                        {status}
                      </span>
                    </div>
                    <div className="grid grid-cols-[48px_1fr] gap-x-2 gap-y-1 text-[14px]">
                      <span className="text-[#64748B]">내용</span>
                      <span>
                        {m.target_category_id || "정해지는 대로 알려드릴게요"}
                      </span>
                      <span className="text-[#64748B]">장소</span>
                      <span>{m.classroom || "-"}</span>
                      <span className="text-[#64748B]">담당</span>
                      <span>
                        {m.instructor?.name
                          ? `${m.instructor.name} 선생님`
                          : "정해지는 대로 알려드릴게요"}
                      </span>
                    </div>
                  </article>
                );
              })
            )}
          </>
        )}

        {/* 성적 */}
        {activeTab === "exam" &&
          (isExamLoading ? (
            <LoadingBox text="성적을 불러오는 중이에요." />
          ) : (
            <>
              {renderGrowthChart()}

              <section className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(15,23,42,0.03)] p-4 flex flex-col gap-3">
                <h3 className="text-[17px] font-bold text-[#1E293B]">
                  주간테스트 기록
                </h3>
                {examResults.length === 0 ? (
                  <p className="text-[14px] text-[#64748B]">
                    아직 기록이 없어요.
                  </p>
                ) : (
                  <div className="flex flex-col divide-y divide-[#F1F5F9]">
                    {examResults.map((ex: any, i: number) => (
                      <div key={i} className="py-3 flex flex-col gap-2">
                        <div className="flex justify-between items-start gap-3">
                          <div className="min-w-0">
                            <div
                              className="text-[15px] font-semibold text-[#1E293B] truncate"
                              title={ex.title}
                            >
                              {ex.title}
                            </div>
                            <div className="text-[12px] text-[#64748B]">
                              {ex.created_at ? formatKDate(ex.created_at) : "-"}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[15px] tabular-nums">
                              <span className="font-bold text-[#2563EB]">
                                {ex.original_score || 0}
                              </span>
                              <span className="text-[#94A3B8]"> → </span>
                              <span className="font-bold text-[#0F172A]">
                                {ex.final_score || 0}점
                              </span>
                            </div>
                            <div className="text-[12px] text-[#64748B] tabular-nums">
                              반 평균 {ex.class_init_avg} → {ex.class_fin_avg}점
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-[12px] font-semibold">
                          {ex.oCount > 0 && (
                            <span className="rounded-full px-2.5 py-0.5 bg-[#DCFCE7] text-[#15803D]">
                              처음부터 정답 {ex.oCount}
                            </span>
                          )}
                          {ex.roCount > 0 && (
                            <span className="rounded-full px-2.5 py-0.5 bg-[#DBEAFE] text-[#1D4ED8]">
                              스스로 고침 {ex.roCount}
                            </span>
                          )}
                          {ex.toCount > 0 && (
                            <span className="rounded-full px-2.5 py-0.5 bg-[#FEF3C7] text-[#B45309]">
                              힌트 후 정답 {ex.toCount}
                            </span>
                          )}
                          {ex.xCount > 0 && (
                            <span className="rounded-full px-2.5 py-0.5 bg-[#FFE4E6] text-[#BE123C]">
                              아직 오답 {ex.xCount}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(15,23,42,0.03)] p-4 flex flex-col gap-3">
                <div className="flex justify-between items-end gap-2">
                  <h3 className="text-[17px] font-bold text-[#1E293B]">
                    단원별 성취도
                  </h3>
                  <div className="flex gap-3 text-[12px] text-[#475569]">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-[#2563EB]"></span>
                      처음
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-[#93C5FD]"></span>
                      고친 뒤
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-center overflow-hidden">
                  <RadarChart data={categoryAnalysis} />
                </div>
                {categoryAnalysis.length === 0 ? (
                  <p className="text-[14px] text-[#64748B]">
                    아직 단원별 기록이 없어요.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {categoryAnalysis.map((cat: any, i: number) => (
                      <div key={i} className="flex flex-col gap-1">
                        <div className="flex justify-between items-center text-[14px]">
                          <span className="truncate pr-2 text-[#334155]">
                            {cat.name}
                          </span>
                          <span className="shrink-0 tabular-nums font-bold text-[#1D4ED8]">
                            {cat.final_rate}%
                          </span>
                        </div>
                        <div className="w-full bg-[#EFF6FF] h-2 rounded-full relative overflow-hidden">
                          <div
                            className="absolute inset-y-0 left-0 bg-[#93C5FD] rounded-full"
                            style={{ width: `${cat.final_rate}%` }}
                          ></div>
                          <div
                            className="absolute inset-y-0 left-0 bg-[#2563EB] rounded-full"
                            style={{ width: `${cat.initial_rate}%` }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(15,23,42,0.03)] p-4 flex flex-col gap-3">
                <h3 className="text-[17px] font-bold text-[#1E293B]">
                  학교 내신 성적
                </h3>
                {schoolExams.length === 0 ? (
                  <p className="text-[14px] text-[#64748B]">
                    등록된 학교 성적이 없어요.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    {schoolExams.map((se: any, idx: number) => (
                      <div
                        key={se.id || idx}
                        className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] px-3.5 py-2.5 flex flex-col gap-1"
                      >
                        <span className="text-[12px] text-[#64748B]">
                          {se.year}년 {se.semester}학기 {se.exam_type}
                        </span>
                        <div className="flex justify-between items-baseline">
                          <span className="text-[14px] font-semibold text-[#334155]">
                            {se.subject}
                          </span>
                          <span className="text-[17px] font-bold text-[#1E3A8A] tabular-nums">
                            {se.score}점
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ))}

        {/* 상담 */}
        {activeTab === "consultation" && (
          <>
            <h3 className="text-[17px] font-bold text-[#1E293B]">상담 기록</h3>
            {consultLogs.length === 0 ? (
              <EmptyBox text="아직 상담 기록이 없어요. 궁금한 점은 상담 버튼으로 남겨 주세요." />
            ) : (
              consultLogs.map((log: any, idx: number) => {
                const instName = unwrap(log.instructor)?.name;
                const hasSummary =
                  log.parent_summary && log.parent_summary.trim() !== "";
                return (
                  <article
                    key={idx}
                    className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(15,23,42,0.03)] px-4 py-3.5 flex flex-col gap-2"
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span
                        className={`text-[12px] font-semibold rounded-full px-2.5 py-1 ${getConsultBadgeColor(
                          log.consultation_type
                        )}`}
                      >
                        {log.consultation_type || "상담"}
                      </span>
                      <span className="text-[13px] text-[#64748B]">
                        {formatKDate(log.created_at)}
                        {instName ? `, ${instName} 선생님` : ""}
                      </span>
                    </div>
                    {hasSummary && (
                      <p className="text-[15px] text-[#334155] leading-relaxed">
                        {log.parent_summary}
                      </p>
                    )}
                  </article>
                );
              })
            )}
          </>
        )}
      </div>

      {toastMessage && (
        <div
          role="status"
          className="absolute bottom-6 left-1/2 -translate-x-1/2 w-max max-w-[90%] bg-[#1E293B] text-white px-4 py-2.5 rounded-xl text-[14px] shadow-lg z-[9999] pointer-events-none"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}

const EmptyBox = ({ text }: { text: string }) => (
  <div className="bg-white rounded-xl border border-[#E2E8F0] px-4 py-10 text-center text-[14px] text-[#64748B]">
    {text}
  </div>
);

const LoadingBox = ({ text }: { text: string }) => (
  <div
    className="bg-white rounded-xl border border-[#E2E8F0] px-4 py-10 flex flex-col items-center gap-3 text-[14px] text-[#64748B]"
    role="status"
  >
    <span
      className="w-6 h-6 border-[3px] border-[#2563EB] border-t-transparent rounded-full animate-spin"
      aria-hidden="true"
    ></span>
    {text}
  </div>
);
