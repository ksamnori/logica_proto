// src/app/(dashboard)/lesson/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

import EditBookModal from "@/components/lesson/EditBookModal";
import AssignBookModal from "@/components/lesson/AssignBookModal";
import ProgressDetailModal from "@/components/progress/ProgressDetailModal";

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

const safeParseIds = (raw: any): number[] => {
  if (!raw) return [];
  try {
    let val = raw;
    if (typeof val === "string") {
      if (val === "null" || val.trim() === "") return [];
      val = JSON.parse(val);
    }
    if (Array.isArray(val)) return val.map(Number);
  } catch (err) {
    console.warn("데이터 파싱 경고:", err);
  }
  return [];
};

const getKstTodayYmd = (): string => {
  const kstMs = Date.now() + 9 * 3600000;
  return new Date(kstMs).toISOString().slice(0, 10);
};

const toKstYmd = (rawIso: any): string | null => {
  if (!rawIso) return null;
  const s = String(rawIso).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    if (!isNaN(t)) {
      const kst = new Date(t + 9 * 3600000).toISOString().slice(0, 10);
      if (kst.startsWith("2099") || kst.startsWith("1970")) return null;
      return kst;
    }
  }
  return null;
};

const extractTitleDateYmd = (title: any): string | null => {
  if (!title) return null;
  const m = String(title).match(/\((\d{4}-\d{2}-\d{2})\)/);
  return m ? m[1] : null;
};

const formatMmDd = (ymd: string | null | undefined): string => {
  if (!ymd || ymd.length < 10) return "-";
  return `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}`;
};

// 🌟 앞페이지가 뒷페이지보다 늦게 진행된 경우(보충·복습·순서 변경 등)에도
// 주변 페이지의 주류 월(Majority Month)과 단조 증가(Monotonic) 구획을 이용해
// 월별 구분선(| N월)이 파편화되지 않고 깔끔하게 한 번씩만 들어가도록 계산하는 헬퍼
const computeFlexibleMonthDividers = (
  bookPages: number[],
  pageDateMap: Record<number, string>
): Record<number, string> => {
  if (!bookPages || bookPages.length === 0) return {};

  const datedPages: { page: number; ym: string }[] = [];
  for (let i = 0; i < bookPages.length; i++) {
    const p = bookPages[i];
    const d = pageDateMap[p];
    if (d && d.length >= 7) {
      datedPages.push({ page: p, ym: d.slice(0, 7) });
    }
  }
  if (datedPages.length === 0) return {};

  // 1단계: 슬라이딩 윈도우(반경 3) 다수결 스무딩으로 앞뒤 페이지 사이에 낀 단발성 역전/보충 날짜 노이즈 보정
  const rawYms = datedPages.map((x) => x.ym);
  const smoothedYms = rawYms.map((ym, idx) => {
    const prevSlice = rawYms.slice(Math.max(0, idx - 3), idx);
    const nextSlice = rawYms.slice(idx + 1, Math.min(rawYms.length, idx + 4));
    if (prevSlice.length > 0 && nextSlice.length > 0) {
      const prevMode = prevSlice[prevSlice.length - 1];
      const nextMode = nextSlice[0];
      if (prevMode === nextMode && ym !== prevMode) {
        return prevMode;
      }
    }
    const winCounts: Record<string, number> = {};
    const start = Math.max(0, idx - 3);
    const end = Math.min(rawYms.length - 1, idx + 3);
    for (let k = start; k <= end; k++) {
      winCounts[rawYms[k]] = (winCounts[rawYms[k]] || 0) + 1;
    }
    let bestYm = ym;
    let bestCnt = winCounts[ym] || 0;
    for (const [candYm, cnt] of Object.entries(winCounts)) {
      if (cnt > bestCnt + 1) {
        bestCnt = cnt;
        bestYm = candYm;
      }
    }
    return bestYm;
  });

  // 2단계: 등장한 월 목록 추출 후 페이지 순서에 따른 단조 증가(Monotonic Non-Decreasing) 최적 분할(DP)
  const monthCounts: Record<string, number> = {};
  smoothedYms.forEach((ym) => {
    monthCounts[ym] = (monthCounts[ym] || 0) + 1;
  });

  let uniqueMonths = Object.keys(monthCounts).sort();
  if (uniqueMonths.length > 1 && datedPages.length >= 6) {
    const filtered = uniqueMonths.filter((m) => monthCounts[m] >= 2);
    if (filtered.length > 0) uniqueMonths = filtered;
  }

  if (uniqueMonths.length === 0) return {};
  if (uniqueMonths.length === 1) {
    const onlyMonthNum = parseInt(uniqueMonths[0].split("-")[1], 10);
    return { [datedPages[0].page]: `${onlyMonthNum}월` };
  }

  const n = datedPages.length;
  const mLen = uniqueMonths.length;
  const dp: number[][] = Array.from({ length: n }, () => Array(mLen).fill(-1));
  const parent: number[][] = Array.from({ length: n }, () => Array(mLen).fill(0));

  for (let j = 0; j < mLen; j++) {
    dp[0][j] = smoothedYms[0] === uniqueMonths[j] ? 1 : 0;
  }

  for (let i = 1; i < n; i++) {
    let bestPrevVal = -1;
    let bestPrevIdx = 0;
    for (let j = 0; j < mLen; j++) {
      if (dp[i - 1][j] > bestPrevVal) {
        bestPrevVal = dp[i - 1][j];
        bestPrevIdx = j;
      }
      const matchScore = smoothedYms[i] === uniqueMonths[j] ? 1 : 0;
      dp[i][j] = bestPrevVal + matchScore;
      parent[i][j] = bestPrevIdx;
    }
  }

  let bestLastJ = 0;
  for (let j = 1; j < mLen; j++) {
    if (dp[n - 1][j] >= dp[n - 1][bestLastJ]) {
      bestLastJ = j;
    }
  }

  const assignedIdx = new Array<number>(n);
  let curJ = bestLastJ;
  for (let i = n - 1; i >= 0; i--) {
    assignedIdx[i] = curJ;
    curJ = parent[i][curJ];
  }

  const dividers: Record<number, string> = {};
  let prevYm = "";
  for (let i = 0; i < n; i++) {
    const curYm = uniqueMonths[assignedIdx[i]];
    if (curYm !== prevYm) {
      const monthNum = parseInt(curYm.split("-")[1], 10);
      dividers[datedPages[i].page] = `${monthNum}월`;
      prevYm = curYm;
    }
  }

  return dividers;
};

interface StudentBasicInfo {
  id: string;
  name: string;
}

type PageStatus = "done" | "homework" | "none" | "excluded";

interface IndividualStat {
  student_id: string;
  name: string;
  percent: number;
  donePagesCount: number;
  countedPagesCount: number;
  startPage?: number;
  pageStatuses: Record<number, PageStatus>;
}

// 🌟 모듈 레벨 메모리 캐시 (반 전환이나 페이지 복귀 시 0ms 즉시 표시)
let cachedMasterBooks: any[] | null = null;
let cachedClassesList: any[] | null = null;
const cachedClassBooksMap = new Map<string, any[]>();
const cachedClassModalMetaMap = new Map<
  string,
  {
    groupedQsMap: Record<string, Record<number, any[]>>;
    statusMap: Record<string, string>;
  }
>();

// 🌟 페이지 블록 행 컴포넌트:
// - 반 전체(class)와 학생별(student)의 블록 가로 폭·간격·구분선 폭을 100% 동일하게 맞춰 상하 라인이 정확히 일치하도록 설계
// - 월 라벨('9월', '10월')은 반 전체 행에서 블록 바로 위 상단 레일(absolute -top-[15px])에 띄워 가로 밀림을 원천 방지
// - 수천 개 블록의 불필요한 box-shadow / transition을 제거하여 스크롤 및 렌더링 속도를 극대화
const PageBlocksRow = React.memo(function PageBlocksRow({
  bookPages,
  pageStatuses,
  type,
  pageDateMap,
  monthDividers,
}: {
  bookPages: number[];
  pageStatuses: Record<number, PageStatus>;
  type: "class" | "student";
  pageDateMap?: Record<number, string>;
  monthDividers?: Record<number, string>;
}) {
  if (!bookPages || bookPages.length === 0) {
    return <span className="text-xs font-bold text-slate-400">교재 데이터 없음</span>;
  }

  const hasAnyMonthLabel =
    type === "class" && monthDividers && Object.keys(monthDividers).length > 0;

  return (
    <div
      className="flex flex-wrap items-center"
      style={{
        columnGap: "2px",
        rowGap: hasAnyMonthLabel ? "17px" : "3px",
        paddingTop: hasAnyMonthLabel ? "15px" : "0px",
      }}
    >
      {bookPages.map((p, idx) => {
        const status = pageStatuses[p] || "none";
        const dateYmd = pageDateMap?.[p];
        const dateSuffix = dateYmd ? ` (${formatMmDd(dateYmd)})` : "";
        const monthLabel = monthDividers?.[p];
        const showVerticalBar = Boolean(monthLabel && idx > 0);

        let bgColor = "bg-slate-200";
        let title = `${p}p 대기`;

        if (status === "done") {
          bgColor = type === "class" ? "bg-brand" : "bg-emerald-500";
          title = `${p}p 완료${dateSuffix}`;
        } else if (status === "homework") {
          bgColor = "bg-amber-400";
          title = `${p}p 과제 진행중${dateSuffix}`;
        } else if (status === "excluded") {
          bgColor = "bg-slate-100 opacity-50";
          title = `${p}p 합류 이전 (진도율 제외)`;
        }

        return (
          <React.Fragment key={p}>
            {showVerticalBar && (
              <span
                className={`inline-block shrink-0 select-none ${
                  type === "class" ? "bg-indigo-500" : "bg-indigo-300"
                }`}
                style={{ width: "2px", minWidth: "2px", maxWidth: "2px", height: "14px", margin: "0 2px" }}
                title={`${monthLabel} 구분 (${p}p~)`}
              />
            )}
            <div
              title={title}
              className={`relative shrink-0 ${bgColor}`}
              style={{ width: "6px", minWidth: "6px", maxWidth: "6px", height: "14px", borderRadius: "1px", flex: "0 0 6px" }}
            >
              {type === "class" && monthLabel && (
                <span
                  className="absolute left-0 px-1 rounded bg-indigo-50 border border-indigo-200 font-extrabold text-indigo-700 leading-none whitespace-nowrap pointer-events-none select-none z-10"
                  style={{ top: "-15px", fontSize: "9px", paddingTop: "1px", paddingBottom: "1px" }}
                >
                  {monthLabel}
                </span>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
});

// 🌟 개별 배정 교재 카드 컴포넌트
const AssignedBookCard = React.memo(function AssignedBookCard({
  cb,
  selectedClassId,
  isExpanded,
  isPinnedFolded,
  onToggleExpand,
  onTogglePinFold,
  onOpenProgressModal,
  onNavigateProgress,
  onDeleteClassTextbook,
  onSaveTargetDates,
}: {
  cb: any;
  selectedClassId: string;
  isExpanded: boolean;
  isPinnedFolded: boolean;
  onToggleExpand: (classTextbookId: string) => void;
  onTogglePinFold: (classTextbookId: string) => void;
  onOpenProgressModal: (cb: any) => void;
  onNavigateProgress: (classId: string, bookId: string) => void;
  onDeleteClassTextbook: (classTextbookId: string) => void;
  onSaveTargetDates: (
    classTextbookId: string,
    startDate: string,
    targetEndDate: string
  ) => Promise<void>;
}) {
  const tb = unwrap(cb.textbook);
  const [isEditingDates, setIsEditingDates] = useState(false);
  const [editStart, setEditStart] = useState(cb.start_date || "");
  const [editEnd, setEditEnd] = useState(cb.target_end_date || "");
  const [isSavingDates, setIsSavingDates] = useState(false);

  useEffect(() => {
    setEditStart(cb.start_date || "");
    setEditEnd(cb.target_end_date || "");
  }, [cb.start_date, cb.target_end_date]);

  if (!tb) return null;

  const stats = cb.stats;
  const {
    maxPageCount,
    classPageStatuses,
    classDonePagesCount,
    percent,
    individualStats,
    bookPages,
    actualStartDate,
    actualEndDate,
    hasAnyProgress,
    pageDateMap,
    monthDividers,
  } = stats;

  const isCompletedBook = percent === 100 || cb.status === "완료";

  let badgeClass = "bg-slate-100 text-slate-600 border-slate-200";
  if (isCompletedBook) badgeClass = "bg-emerald-100 text-emerald-700 border-emerald-200";
  else if (cb.status === "진행중") badgeClass = "bg-blue-100 text-blue-700 border-blue-200";

  let bookBadgeClass = "bg-slate-50 text-slate-500 border-slate-200";
  if (tb.book_type === "주교재") bookBadgeClass = "bg-blue-50 text-blue-700 border-blue-200";
  else if (tb.book_type === "부교재") bookBadgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
  else if (tb.book_type === "연산교재") bookBadgeClass = "bg-purple-50 text-purple-700 border-purple-200";
  else if (tb.book_type === "워크북") bookBadgeClass = "bg-amber-50 text-amber-700 border-amber-200";

  const targetSDate = cb.start_date ? formatMmDd(cb.start_date) : "-";
  const targetEDate = cb.target_end_date ? formatMmDd(cb.target_end_date) : "-";

  const todayYmd = getKstTodayYmd();
  let actualScheduleText = "미진행 (대기)";
  if (isCompletedBook) {
    const startLbl = formatMmDd(actualStartDate || cb.start_date);
    const endLbl = formatMmDd(actualEndDate || cb.target_end_date || todayYmd);
    actualScheduleText = `${startLbl} ~ ${endLbl} (완료)`;
  } else if (hasAnyProgress && actualStartDate) {
    actualScheduleText = `${formatMmDd(actualStartDate)} ~ ${formatMmDd(todayYmd)} (진행중)`;
  }

  const handleSaveDatesClick = async () => {
    if (!editStart || !editEnd) {
      alert("목표 시작일과 목표 종료일을 모두 입력해주세요.");
      return;
    }
    setIsSavingDates(true);
    try {
      await onSaveTargetDates(cb.class_textbook_id, editStart, editEnd);
      setIsEditingDates(false);
    } finally {
      setIsSavingDates(false);
    }
  };

  return (
    <div
      className={`border rounded-2xl shadow-sm relative overflow-hidden ${
        !isExpanded
          ? isCompletedBook
            ? "bg-emerald-50/20 border-emerald-200/80 p-4"
            : "bg-slate-50/40 border-slate-200 p-4"
          : "bg-white border-slate-200 p-5"
      }`}
    >
      <div className="flex justify-between items-start gap-3 relative z-10">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
            <span className={`${badgeClass} px-2 py-0.5 rounded text-xs font-bold border`}>
              {isCompletedBook ? "완료" : cb.status}
            </span>
            <span className={`${bookBadgeClass} px-1.5 py-0.5 rounded text-xs font-bold border`}>
              {tb.book_type}
            </span>
            {/* 🌟 100% 완료일 때뿐만 아니라 평상시 및 접혀있는 상태에서도 전체 진도율 상시 표시 */}
            <div
              className={`px-2 py-0.5 rounded text-xs font-extrabold flex items-center gap-1.5 border ${
                isCompletedBook
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : percent > 0
                  ? "bg-blue-50 text-brand border-blue-200"
                  : "bg-slate-100 text-slate-500 border-slate-200"
              }`}
            >
              <span>{isCompletedBook ? "✓ 100% 완료" : `전체 진도율 ${percent}%`}</span>
              <span className="text-[11px] font-bold opacity-85 tabular-nums">
                ({classDonePagesCount}/{maxPageCount}p)
              </span>
              {!isCompletedBook && (
                <span className="w-12 h-1.5 bg-white/80 border border-blue-200/60 rounded-full overflow-hidden inline-flex items-center">
                  <span
                    className="h-full bg-brand rounded-full"
                    style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                  />
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-bold text-slate-800 text-[16px] tracking-tight truncate">
              {tb.title}
            </div>
            <button
              type="button"
              onClick={() => onToggleExpand(cb.class_textbook_id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1 ${
                !isExpanded && isCompletedBook
                  ? "bg-white hover:bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200"
              }`}
            >
              <span>{isExpanded ? "세부 진행 접기 ▲" : "세부 진행 펼치기 ▼"}</span>
            </button>
            <button
              type="button"
              onClick={() => onTogglePinFold(cb.class_textbook_id)}
              title={
                isPinnedFolded
                  ? "현재 기본 접힘 상태입니다. 클릭하면 기본 접어두기를 해제합니다."
                  : "클릭하면 이 교재를 기본적으로 접어둔 상태로 고정합니다."
              }
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1 ${
                isPinnedFolded
                  ? "bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-300"
                  : "bg-white hover:bg-slate-50 text-slate-500 border-slate-200"
              }`}
            >
              <span>{isPinnedFolded ? "📌 접어둠 (해제)" : "📌 접어두기"}</span>
            </button>
          </div>
        </div>

        {/* 우측 상단 2줄 일정 표시 박스 */}
        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          {!isEditingDates ? (
            <div
              onClick={() => setIsEditingDates(true)}
              title="클릭하여 목표 일정 수정"
              className="text-xs font-bold text-slate-600 bg-slate-50 hover:bg-blue-50/70 px-2.5 py-1 rounded border border-slate-200 hover:border-blue-300 cursor-pointer transition-colors flex items-center gap-1.5"
            >
              <span className="text-slate-400">목표일정:</span>
              <span className="tabular-nums text-slate-700">
                {targetSDate} ~ {targetEDate}
              </span>
              <span className="text-[11px] text-blue-500">✏️</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 bg-blue-50/80 p-1.5 rounded-lg border border-blue-200">
              <span className="text-[11px] font-bold text-blue-700 px-1">목표:</span>
              <input
                type="date"
                value={editStart}
                onChange={(e) => setEditStart(e.target.value)}
                className="px-1.5 py-0.5 text-[11px] font-bold border border-slate-300 rounded bg-white text-slate-700 focus:outline-none focus:border-brand"
              />
              <span className="text-xs font-bold text-slate-400">~</span>
              <input
                type="date"
                value={editEnd}
                onChange={(e) => setEditEnd(e.target.value)}
                className="px-1.5 py-0.5 text-[11px] font-bold border border-slate-300 rounded bg-white text-slate-700 focus:outline-none focus:border-brand"
              />
              <button
                type="button"
                disabled={isSavingDates}
                onClick={handleSaveDatesClick}
                className="px-2 py-0.5 bg-brand text-white text-[11px] font-bold rounded hover:bg-blue-900 disabled:opacity-50"
              >
                저장
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditStart(cb.start_date || "");
                  setEditEnd(cb.target_end_date || "");
                  setIsEditingDates(false);
                }}
                className="px-1.5 py-0.5 bg-white text-slate-500 border border-slate-200 text-[11px] font-bold rounded hover:bg-slate-100"
              >
                취소
              </button>
            </div>
          )}

          <div
            className={`text-xs font-bold px-2.5 py-1 rounded border flex items-center gap-1.5 ${
              isCompletedBook
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : hasAnyProgress
                ? "bg-indigo-50/70 text-indigo-700 border-indigo-200"
                : "bg-slate-50 text-slate-400 border-slate-100"
            }`}
            title="첫 페이지가 처음 체크된 날부터 계산된 실제 수업 진행 기간입니다."
          >
            <span className="opacity-75">실제일정:</span>
            <span className="tabular-nums">{actualScheduleText}</span>
          </div>
        </div>
      </div>

      {/* 🌟 펼쳐진 상태: 반 전체 진도 행과 학생별 진도 행을 동일한 좌측 라벨 폭(w-14)·패딩·우측 수치 폭(w-20)으로 완벽히 수직 정렬 */}
      {isExpanded && (
        <>
          <div className="mt-4 bg-slate-50 rounded-xl border border-slate-200 overflow-hidden relative z-10">
            <div className="text-xs font-bold text-slate-600 p-2.5 px-3 flex items-center justify-between border-b border-slate-200 bg-white">
              <span className="flex items-center gap-1.5">
                <span>👨‍🎓</span> 반 전체 및 학생별 상세 진도율 (전체 보기)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenProgressModal(cb)}
                  className="text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 transition-colors"
                >
                  매트릭스 뷰 🔍
                </button>
                <span className="text-xs font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                  실시간 연동
                </span>
              </div>
            </div>

            <div className="p-3 flex flex-col gap-2 bg-slate-50/50">
              {/* 반 전체 진행상황 행 (학생 행과 100% 동일한 좌우 구조로 상하 라인 완벽 일치) */}
              <div
                onClick={() => onOpenProgressModal(cb)}
                title="클릭하여 상세 매트릭스 뷰 열기"
                className="flex items-center gap-3 bg-blue-50/40 hover:bg-blue-50/80 p-2.5 rounded-lg border border-blue-200/80 cursor-pointer transition-colors"
              >
                <span className="w-14 text-[12px] font-extrabold text-brand truncate shrink-0">
                  반 전체
                </span>
                <div className="flex-1 min-w-0 flex overflow-hidden">
                  <PageBlocksRow
                    bookPages={bookPages}
                    pageStatuses={classPageStatuses}
                    type="class"
                    pageDateMap={pageDateMap}
                    monthDividers={monthDividers}
                  />
                </div>
                <div className="w-20 flex justify-end items-center gap-1.5 shrink-0">
                  <span className="text-xs font-extrabold text-brand tabular-nums">
                    {percent}%
                  </span>
                  <span
                    className="text-xs font-bold text-slate-500 w-12 text-right tabular-nums"
                    title={`반 완료 ${classDonePagesCount}p / 전체 ${maxPageCount}p`}
                  >
                    {classDonePagesCount}/{maxPageCount}p
                  </span>
                </div>
              </div>

              {/* 학생별 상세 진도율 행 */}
              {individualStats &&
                individualStats.map((stat: IndividualStat) => {
                  const doneCnt = stat.donePagesCount;
                  return (
                    <div
                      key={stat.student_id}
                      onClick={() => onOpenProgressModal(cb)}
                      title="클릭하여 상세 매트릭스 뷰 열기"
                      className="flex items-center gap-3 bg-white hover:bg-slate-50 p-2.5 rounded-lg border border-slate-200 cursor-pointer transition-colors"
                    >
                      <span
                        className="w-14 text-[12px] font-bold text-slate-700 truncate shrink-0"
                        title={
                          stat.startPage !== undefined
                            ? `${stat.startPage}p부터 합류 (이전 페이지는 진도율 제외)`
                            : undefined
                        }
                      >
                        {stat.name}
                        {stat.startPage !== undefined && (
                          <span className="block text-[10px] font-bold text-amber-600 leading-tight">
                            {stat.startPage}p~
                          </span>
                        )}
                      </span>
                      <div className="flex-1 min-w-0 flex overflow-hidden">
                        <PageBlocksRow
                          bookPages={bookPages}
                          pageStatuses={stat.pageStatuses}
                          type="student"
                          pageDateMap={pageDateMap}
                          monthDividers={monthDividers}
                        />
                      </div>
                      <div className="w-20 flex justify-end items-center gap-1.5 shrink-0">
                        <span className="text-xs font-bold text-slate-700 tabular-nums">
                          {stat.percent}%
                        </span>
                        <span
                          className="text-xs font-bold text-slate-400 w-12 text-right tabular-nums"
                          title={`완료 ${doneCnt}p / 대상 ${stat.countedPagesCount}p`}
                        >
                          {doneCnt}p
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 flex gap-3 relative z-10">
            <button
              type="button"
              onClick={() => onNavigateProgress(selectedClassId, cb.book_id)}
              className="px-4 py-2 bg-brand text-white hover:bg-blue-900 rounded-lg font-bold text-xs shadow-sm transition-colors border flex items-center gap-1.5"
            >
              진도/과제 관리로 이동{" "}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                  d="M9 5l7 7-7 7"
                ></path>
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onDeleteClassTextbook(cb.class_textbook_id)}
              className="ml-auto text-xs font-bold text-rose-400 hover:text-rose-600 underline"
            >
              배정 취소
            </button>
          </div>
        </>
      )}
    </div>
  );
});

export default function LessonPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [masterBooks, setMasterBooks] = useState<any[]>(() => cachedMasterBooks || []);
  const [filterType, setFilterType] = useState("all");
  const [searchKeyword, setSearchKeyword] = useState("");

  const [classes, setClasses] = useState<any[]>(() => cachedClassesList || []);
  const [selectedClass, setSelectedClass] = useState<any | null>(null);
  const [assignedBooks, setAssignedBooks] = useState<any[]>([]);
  const [isClassBooksLoading, setIsClassBooksLoading] = useState(false);

  const [expandedBookIds, setExpandedBookIds] = useState<Record<string, boolean>>({});
  const [pinnedFoldedIds, setPinnedFoldedIds] = useState<Record<string, boolean>>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("logica_lesson_pinned_folded_books");
        if (raw) return JSON.parse(raw);
      } catch (e) {}
    }
    return {};
  });

  const [attendanceAlerts, setAttendanceAlerts] = useState<any[]>([]);
  const [hwMissingAlerts, setHwMissingAlerts] = useState<
    { student_id: string; name: string; count: number }[]
  >([]);
  const [isHwAlertLoading, setIsHwAlertLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editModalData, setEditModalData] = useState<any | null>(null);

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignModalData, setAssignModalData] = useState<any | null>(null);

  const [canDeleteBook, setCanDeleteBook] = useState(false);
  const [canViewAllClasses, setCanViewAllClasses] = useState(false);

  const [progressModalData, setProgressModalData] = useState<any>(null);

  const assignedBooksRef = useRef<any[]>([]);
  assignedBooksRef.current = assignedBooks;

  useEffect(() => {
    const checkAccess = async () => {
      const role = localStorage.getItem("logica_instructor_role") || "TEACHER";
      const pos = localStorage.getItem("logica_instructor_position") || "";
      const tId = localStorage.getItem("logica_tenant_id") || "";

      const isGodMode =
        role === "SUPER_ADMIN" ||
        role === "ADMIN" ||
        pos.includes("최고관리자") ||
        pos.includes("대장") ||
        pos.includes("원장");

      if (isGodMode) {
        setIsAuthorized(true);
        setCanDeleteBook(true);
        setCanViewAllClasses(true);
        return;
      }

      if (!tId || !role) {
        alert("권한 정보가 없습니다.");
        router.replace("/home");
        return;
      }

      const { data } = await supabase
        .from("tenant_role_permissions")
        .select("allowed_menus")
        .eq("tenant_id", tId)
        .eq("role_name", role)
        .maybeSingle();

      if (!data || (!data.allowed_menus.includes("ALL") && !data.allowed_menus.includes("/lesson"))) {
        alert("⛔ 교재 관리 페이지에 접근할 권한이 없습니다.");
        router.replace("/home");
      } else {
        setIsAuthorized(true);
        if (data.allowed_menus.includes("action_delete_book")) setCanDeleteBook(true);
        if (data.allowed_menus.includes("action_view_all_classes")) setCanViewAllClasses(true);
      }
    };

    checkAccess();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) {
      fetchMasterBooks();
      fetchClasses();
    }
  }, [isAuthorized]);

  useEffect(() => {
    if (selectedClass) {
      setExpandedBookIds({});
      const cached = cachedClassBooksMap.get(selectedClass.class_id);
      if (cached) {
        setAssignedBooks(cached);
      }
      fetchClassAssignedBooks(selectedClass, !cached);
      fetchAttendanceAlerts(selectedClass.class_id);
      fetchHomeworkMissingAlerts(selectedClass);
    } else {
      setAssignedBooks([]);
      setAttendanceAlerts([]);
      setHwMissingAlerts([]);
    }
  }, [selectedClass]);

  const fetchHomeworkMissingAlerts = async (cls: any) => {
    setIsHwAlertLoading(true);
    try {
      const classId = cls.class_id;
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const studentNameMap = new Map<string, string>();
      (cls.enrollment || []).forEach((r: any) => {
        if (isEndedEnrollment(r)) return;
        const stu = unwrap(r.student);
        if (stu && stu.status === "재원") {
          studentNameMap.set(r.student_id, stu.name || "알수없음");
        }
      });
      if (studentNameMap.size === 0) {
        setHwMissingAlerts([]);
        return;
      }

      const { data: hwRows, error } = await supabase
        .from("homework_assignment")
        .select(
          "homework_id, homework_title, due_date, target_student_id, student_homework_result(student_id, status)"
        )
        .eq("class_id", classId)
        .neq("homework_title", "[시스템] 수업 진도 완료 기록")
        .lt("due_date", now.toISOString())
        .gte("due_date", weekAgo.toISOString())
        .limit(500);

      if (error) throw error;

      const DONE = ["제출완료", "채점완료", "완료"];
      const missingCount = new Map<string, number>();
      (hwRows || []).forEach((hw: any) => {
        const targets: string[] = hw.target_student_id
          ? [hw.target_student_id]
          : Array.from(studentNameMap.keys());
        const results: any[] = hw.student_homework_result || [];
        targets.forEach((sId) => {
          if (!studentNameMap.has(sId)) return;
          const res = results.find((r) => r.student_id === sId);
          if (!res || !DONE.includes(res.status)) {
            missingCount.set(sId, (missingCount.get(sId) || 0) + 1);
          }
        });
      });

      const list = Array.from(missingCount.entries())
        .map(([student_id, count]) => ({
          student_id,
          name: studentNameMap.get(student_id) || "알수없음",
          count,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      setHwMissingAlerts(list);
    } catch (e) {
      console.error("과제 미제출 통계 로드 실패:", e);
      setHwMissingAlerts([]);
    } finally {
      setIsHwAlertLoading(false);
    }
  };

  const fetchAttendanceAlerts = async (classId: string) => {
    try {
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      const mondayStr = monday.toISOString().split("T")[0];

      const { data, error } = await supabase
        .from("attendance")
        .select("attendance_date, status, student(name)")
        .eq("class_id", classId)
        .in("status", ["지각", "결석"])
        .gte("attendance_date", mondayStr)
        .order("attendance_date", { ascending: false });

      if (error) throw error;
      setAttendanceAlerts(data || []);
    } catch (e) {
      console.error("출결 알림 로드 실패:", e);
    }
  };

  const fetchMasterBooks = async () => {
    const tenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId = tenantId === "hq" ? "1ff4299c-d72b-4d99-97b0-45fee08e3b73" : tenantId;

    if (!validTenantId) {
      setMasterBooks([]);
      return;
    }

    const allBooks: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("textbook")
        .select("book_id, title, book_type, target_sessions, tenant_id, created_at")
        .or(`tenant_id.eq.${validTenantId},tenant_id.is.null`)
        .order("created_at", { ascending: false })
        .range(from, from + 999);

      if (error) {
        console.error("교재 로드 에러:", error);
        break;
      }
      if (!data || data.length === 0) break;
      allBooks.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
    cachedMasterBooks = allBooks;
    setMasterBooks(allBooks);
  };

  const createDummyBook = async () => {
    const tenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId = tenantId === "hq" ? "1ff4299c-d72b-4d99-97b0-45fee08e3b73" : tenantId;

    if (!validTenantId) return alert("소속 지점 정보가 없어 교재를 생성할 수 없습니다.");

    const bookName = prompt("새로운 마스터 교재 이름을 입력하세요:\n(예: 개념원리 중1-1)");
    if (!bookName) return;
    try {
      const { error } = await supabase.from("textbook").insert({
        title: bookName,
        book_type: "주교재",
        target_sessions: 12,
        tenant_id: validTenantId,
      });
      if (error) throw error;
      alert(`[${bookName}] 교재가 생성되었습니다.`);
      fetchMasterBooks();
    } catch (e: any) {
      alert("교재 생성 실패: " + e.message);
    }
  };

  const fetchClasses = async () => {
    const instId = localStorage.getItem("logica_instructor_id") || "";
    const role = localStorage.getItem("logica_instructor_role") || "";
    const pos = localStorage.getItem("logica_instructor_position") || "";
    const tenantId = localStorage.getItem("logica_tenant_id");
    const validTenantId = tenantId === "hq" ? "1ff4299c-d72b-4d99-97b0-45fee08e3b73" : tenantId;

    if (!validTenantId) {
      setClasses([]);
      return;
    }

    const isAdminLike =
      ["ADMIN", "MANAGER", "PRINCIPAL", "SUPER_ADMIN", "VICE_ADMIN"].includes(role.toUpperCase()) ||
      pos.includes("원장") ||
      pos.includes("실장") ||
      pos.includes("최고관리자") ||
      pos.includes("부원장") ||
      pos.includes("대장");

    let query = supabase
      .from("class")
      .select("*, instructor(name), enrollment(student_id, status, end_date, student(name, status)), class_schedule(*)")
      .eq("tenant_id", validTenantId)
      .order("name");

    if (!isAdminLike && !canViewAllClasses && instId) {
      query = query.eq("instructor_id", instId);
    }

    const { data } = await query;
    cachedClassesList = data || [];
    setClasses(data || []);
  };

  // 🌟 초경량·초고속 진도율 계산 (불필요한 전체 답안 스캔 및 O(학생×문항) Date 생성·정렬 루프 완전 제거)
  const fetchClassAssignedBooks = async (cls: any, showSpinner: boolean = true) => {
    if (showSpinner) setIsClassBooksLoading(true);
    try {
      const classId = cls.class_id;

      const { data } = await supabase
        .from("class_textbook")
        .select("*, textbook(*)")
        .eq("class_id", classId)
        .order("start_date", { ascending: true });

      if (!data || data.length === 0) {
        cachedClassBooksMap.set(classId, []);
        setAssignedBooks([]);
        return;
      }

      const currentClassStudents: StudentBasicInfo[] = (cls.enrollment || [])
        .filter((e: any) => !isEndedEnrollment(e) && unwrap(e.student)?.status === "재원")
        .map((e: any) => ({
          id: e.student_id,
          name: unwrap(e.student)?.name || "알수없음",
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      const assignedBookIds = data.map((cb) => cb.book_id);
      const sIds = currentClassStudents.map((s) => s.id);

      const fetchAllQuestionsLight = async () => {
        const rows: any[] = [];
        let from = 0;
        while (true) {
          const { data: qChunk } = await supabase
            .from("textbook_question")
            .select("tq_id, book_id, page_number, question_id, question_number")
            .in("book_id", assignedBookIds)
            .order("tq_id", { ascending: true })
            .range(from, from + 999);
          if (!qChunk || qChunk.length === 0) break;
          rows.push(...qChunk);
          if (qChunk.length < 1000) break;
          from += 1000;
        }
        return rows;
      };

      const fetchStartPages = async () => {
        const { data: spRows } = await supabase
          .from("student_textbook_start")
          .select("student_id, book_id, start_page")
          .eq("class_id", classId);
        return spRows || [];
      };

      const fetchAssignments = async () => {
        if (sIds.length === 0) return [];
        const { data: assignments } = await supabase
          .from("homework_assignment")
          .select(
            "homework_id, book_id, homework_title, created_at, due_date, target_questions, target_student_id, student_homework_result(student_id, completed_tq_ids, status, checked_at)"
          )
          .eq("class_id", classId)
          .in("book_id", assignedBookIds);
        return assignments || [];
      };

      const fetchExclusions = async () => {
        if (sIds.length === 0) return [];
        const { data: excRows } = await supabase
          .from("progress_exclusion")
          .select("student_id, tq_id")
          .eq("class_id", classId)
          .in("student_id", sIds)
          .limit(2000);
        return excRows || [];
      };

      const fetchExamAssignments = async () => {
        if (sIds.length === 0) return [];
        const { data: exRows } = await supabase
          .from("exam_assignment")
          .select(
            "assignment_id, student_id, status, created_at, exam_master!inner(exam_type, exam_item(question_id))"
          )
          .eq("class_id", classId)
          .in("student_id", sIds)
          .in("exam_master.exam_type", ["과제", "과제프린트"])
          .limit(1000);
        return exRows || [];
      };

      const [spRows, questionsData, assignments, excRows, exAssigns] = await Promise.all([
        fetchStartPages(),
        fetchAllQuestionsLight(),
        fetchAssignments(),
        fetchExclusions(),
        fetchExamAssignments(),
      ]);

      const startPageMap: Record<string, number> = {};
      spRows.forEach((r: any) => {
        startPageMap[`${r.student_id}_${r.book_id}`] = Number(r.start_page);
      });

      const bookPagesMap: Record<string, number[]> = {};
      const bookPageTqsMap: Record<string, Record<number, number[]>> = {};
      const groupedQsMap: Record<string, Record<number, any[]>> = {};
      const tqIdToBookPage = new Map<number, { bookId: string; page: number }>();
      const qIdToTqId = new Map<string, number>();

      assignedBookIds.forEach((bId) => {
        bookPagesMap[bId] = [];
        bookPageTqsMap[bId] = {};
        groupedQsMap[bId] = {};
      });

      questionsData.forEach((q) => {
        if (q.question_id) qIdToTqId.set(String(q.question_id), q.tq_id);
        const pNum = Number(q.page_number) || 0;
        tqIdToBookPage.set(q.tq_id, { bookId: q.book_id, page: pNum });
        if (!bookPageTqsMap[q.book_id][pNum]) {
          bookPageTqsMap[q.book_id][pNum] = [];
          bookPagesMap[q.book_id].push(pNum);
          groupedQsMap[q.book_id][pNum] = [];
        }
        bookPageTqsMap[q.book_id][pNum].push(q.tq_id);
        groupedQsMap[q.book_id][pNum].push(q);
      });

      assignedBookIds.forEach((bId) => {
        bookPagesMap[bId].sort((a, b) => a - b);
      });

      const globalStatusMap: Record<string, string> = {};
      // 🌟 O(1) 문자열 비교만 사용하는 경량 날짜 맵 (수만 개 배열 push/sort 원천 제거)
      const bookPageMinDateMap: Record<string, Record<number, string>> = {};
      const bookMinDateMap: Record<string, string> = {};
      const bookMaxDateMap: Record<string, string> = {};
      const bookLongestSysProgress: Record<
        string,
        { startYmd: string; endYmd: string; orderedPages: number[] }
      > = {};

      assignedBookIds.forEach((bId) => {
        bookPageMinDateMap[bId] = {};
      });

      const recordPageDate = (bookId: string, page: number, dateYmd: string | null) => {
        if (!dateYmd) return;
        const curPageMin = bookPageMinDateMap[bookId][page];
        if (!curPageMin || dateYmd < curPageMin) {
          bookPageMinDateMap[bookId][page] = dateYmd;
        }
        if (!bookMinDateMap[bookId] || dateYmd < bookMinDateMap[bookId]) {
          bookMinDateMap[bookId] = dateYmd;
        }
        if (!bookMaxDateMap[bookId] || dateYmd > bookMaxDateMap[bookId]) {
          bookMaxDateMap[bookId] = dateYmd;
        }
      };

      const excludedSet = new Set<string>();
      excRows.forEach((r: any) => excludedSet.add(`${r.tq_id}_${r.student_id}`));
      const isExcluded = (tqId: number, sId: string) => excludedSet.has(`${tqId}_${sId}`);

      if (sIds.length > 0) {
        let classMinLessonYmd: string | null = null;
        let classMaxLessonYmd: string | null = null;

        assignments.forEach((hw: any) => {
          if (hw.homework_title === "[시스템] 수업 진도 완료 기록") return;
          const d = extractTitleDateYmd(hw.homework_title) || toKstYmd(hw.created_at);
          if (d) {
            if (!classMinLessonYmd || d < classMinLessonYmd) classMinLessonYmd = d;
            if (!classMaxLessonYmd || d > classMaxLessonYmd) classMaxLessonYmd = d;
          }
        });

        assignments.forEach((hw: any) => {
          const bId = hw.book_id;
          if (!bId) return;

          const isSystemProgressRow = hw.homework_title === "[시스템] 수업 진도 완료 기록";
          const assignDateYmd = extractTitleDateYmd(hw.homework_title) || toKstYmd(hw.created_at);

          const targetQs = safeParseIds(hw.target_questions);
          const isClassWide = !hw.target_student_id;
          const targetStudentIds = isClassWide ? sIds : [hw.target_student_id];

          targetStudentIds.forEach((sId: string) => {
            targetQs.forEach((tqId) => {
              const key = `${classId}_${tqId}_${sId}`;
              if (globalStatusMap[key] !== "done") globalStatusMap[key] = "homework";
            });
          });

          if (!isSystemProgressRow && assignDateYmd) {
            if (targetQs.length > 0) {
              if (!bookMinDateMap[bId] || assignDateYmd < bookMinDateMap[bId]) {
                bookMinDateMap[bId] = assignDateYmd;
              }
              if (!bookMaxDateMap[bId] || assignDateYmd > bookMaxDateMap[bId]) {
                bookMaxDateMap[bId] = assignDateYmd;
              }
            }
            const touchedPages = new Set<number>();
            targetQs.forEach((tqId) => {
              const info = tqIdToBookPage.get(tqId);
              if (info) touchedPages.add(info.page);
            });
            touchedPages.forEach((p) => recordPageDate(bId, p, assignDateYmd));
          }

          hw.student_homework_result?.forEach((res: any) => {
            const sId = res.student_id;
            const parsedCompleted = safeParseIds(res.completed_tq_ids);
            const isFullyCompleted = ["채점완료", "제출완료", "완료"].includes(res.status);

            let completedQs = parsedCompleted;
            if (isFullyCompleted && targetQs.length > 0) {
              completedQs = Array.from(new Set([...targetQs, ...parsedCompleted]));
            }

            completedQs.forEach((tqId: number) => {
              globalStatusMap[`${classId}_${tqId}_${sId}`] = "done";
            });

            if (!isSystemProgressRow) {
              const dYmd = assignDateYmd || toKstYmd(res.checked_at);
              if (dYmd) {
                const touchedPages = new Set<number>();
                completedQs.forEach((tqId: number) => {
                  const info = tqIdToBookPage.get(tqId);
                  if (info) touchedPages.add(info.page);
                });
                touchedPages.forEach((p) => recordPageDate(bId, p, dYmd));
              }
            } else if (parsedCompleted.length > 0) {
              // [시스템] 수업 진도 완료 기록은 교재당 가장 많은 페이지를 진행한 대표 1건만 추출해 페이지 단위로 보간
              const sysStartYmd = toKstYmd(hw.created_at) || classMinLessonYmd;
              const sysEndYmd = toKstYmd(res.checked_at) || classMaxLessonYmd || sysStartYmd;
              if (sysStartYmd) {
                if (!bookMinDateMap[bId] || sysStartYmd < bookMinDateMap[bId]) {
                  bookMinDateMap[bId] = sysStartYmd;
                }
                if (sysEndYmd && (!bookMaxDateMap[bId] || sysEndYmd > bookMaxDateMap[bId])) {
                  bookMaxDateMap[bId] = sysEndYmd;
                }
                const orderedPages: number[] = [];
                const seenP = new Set<number>();
                for (let k = 0; k < parsedCompleted.length; k++) {
                  const info = tqIdToBookPage.get(parsedCompleted[k]);
                  if (info && !seenP.has(info.page)) {
                    seenP.add(info.page);
                    orderedPages.push(info.page);
                  }
                }
                const prevBest = bookLongestSysProgress[bId];
                if (!prevBest || orderedPages.length > prevBest.orderedPages.length) {
                  bookLongestSysProgress[bId] = {
                    startYmd: sysStartYmd,
                    endYmd: sysEndYmd || sysStartYmd,
                    orderedPages,
                  };
                }
              }
            }
          });
        });

        // [시스템] 수업 진도 완료 기록으로만 체크된 페이지들에 대해 교재당 딱 1회(페이지 수만큼만) 날짜 보간
        assignedBookIds.forEach((bId) => {
          const sysInfo = bookLongestSysProgress[bId];
          if (!sysInfo || sysInfo.orderedPages.length === 0) return;
          const startMs = Date.parse(sysInfo.startYmd);
          const endMs = Math.max(startMs, Date.parse(sysInfo.endYmd));
          const len = sysInfo.orderedPages.length;
          sysInfo.orderedPages.forEach((p, idx) => {
            if (bookPageMinDateMap[bId][p]) return; // 이미 명시적 과제 날짜가 있으면 유지
            const ratio = len > 1 ? idx / (len - 1) : 0;
            const interpYmd = new Date(startMs + Math.round((endMs - startMs) * ratio))
              .toISOString()
              .slice(0, 10);
            recordPageDate(bId, p, interpYmd);
          });
        });

        exAssigns.forEach((ea: any) => {
          const sId = ea.student_id;
          const isCompleted = ["채점완료", "제출완료", "완료"].includes(ea.status);
          const assignYmd = toKstYmd(ea.created_at);
          const m = Array.isArray(ea.exam_master) ? ea.exam_master[0] : ea.exam_master;
          const items = m?.exam_item || [];

          items.forEach((item: any) => {
            const tqId = qIdToTqId.get(String(item.question_id));
            if (tqId && !isExcluded(tqId, sId)) {
              const curStatus = globalStatusMap[`${classId}_${tqId}_${sId}`];
              if (isCompleted) {
                globalStatusMap[`${classId}_${tqId}_${sId}`] = "done";
              } else if (curStatus !== "done") {
                globalStatusMap[`${classId}_${tqId}_${sId}`] = "homework";
              }
              if (assignYmd) {
                const info = tqIdToBookPage.get(tqId);
                if (info) recordPageDate(info.bookId, info.page, assignYmd);
              }
            }
          });
        });
      }

      // 매트릭스 모달용 대용량 데이터는 React state가 아닌 메모리 캐시에 보관하여 리렌더링 부하 차단
      cachedClassModalMetaMap.set(classId, {
        groupedQsMap,
        statusMap: globalStatusMap,
      });

      const booksWithStats = data.map((cb) => {
        const bId = cb.book_id;
        const totalPages = bookPagesMap[bId] || [];
        const totalPagesCount = totalPages.length;

        const individualStats: IndividualStat[] = currentClassStudents.map(
          (stu: StudentBasicInfo) => {
            const pageStatuses: Record<number, PageStatus> = {};
            let donePagesCount = 0;
            const startPage: number | undefined = startPageMap[`${stu.id}_${bId}`];
            const countedPages =
              startPage !== undefined ? totalPages.filter((p) => p >= startPage) : totalPages;

            totalPages.forEach((p) => {
              const tqsOnPage = bookPageTqsMap[bId][p] || [];
              let doneCount = 0;
              let hwCount = 0;

              for (let k = 0; k < tqsOnPage.length; k++) {
                const st = globalStatusMap[`${classId}_${tqsOnPage[k]}_${stu.id}`];
                if (st === "done") doneCount++;
                else if (st === "homework") hwCount++;
              }

              const isBeforeStart = startPage !== undefined && p < startPage;

              if (tqsOnPage.length > 0 && doneCount === tqsOnPage.length) {
                pageStatuses[p] = "done";
                if (!isBeforeStart) donePagesCount++;
              } else if (isBeforeStart) {
                pageStatuses[p] = "excluded";
              } else if (doneCount > 0 || hwCount > 0) {
                pageStatuses[p] = "homework";
              } else {
                pageStatuses[p] = "none";
              }
            });

            const stuPercent =
              countedPages.length > 0
                ? Math.min(100, Math.round((donePagesCount / countedPages.length) * 100))
                : 0;

            return {
              student_id: stu.id,
              name: stu.name,
              donePagesCount,
              countedPagesCount: countedPages.length,
              startPage,
              percent: stuPercent,
              pageStatuses,
            };
          }
        );

        const classPageStatuses: Record<number, PageStatus> = {};
        let classDonePagesCount = 0;
        let classCountedPagesCount = totalPagesCount;
        let hasAnyProgress = false;

        if (currentClassStudents.length > 0) {
          classCountedPagesCount = 0;
          totalPages.forEach((p) => {
            let allDone = true;
            let anyHwOrPartialDone = false;

            const applicableStats = individualStats.filter(
              (s) => s.startPage === undefined || p >= s.startPage
            );
            if (applicableStats.length === 0) {
              classPageStatuses[p] = "excluded";
              return;
            }
            classCountedPagesCount++;

            for (let k = 0; k < applicableStats.length; k++) {
              const st = applicableStats[k].pageStatuses[p];
              if (st !== "done") allDone = false;
              if (st === "done" || st === "homework") anyHwOrPartialDone = true;
            }

            if (allDone) {
              classPageStatuses[p] = "done";
              classDonePagesCount++;
              hasAnyProgress = true;
            } else if (anyHwOrPartialDone) {
              classPageStatuses[p] = "homework";
              hasAnyProgress = true;
            } else {
              classPageStatuses[p] = "none";
            }
          });
        }

        const classPercent =
          classCountedPagesCount > 0
            ? Math.min(100, Math.round((classDonePagesCount / classCountedPagesCount) * 100))
            : 0;

        const pageDateMap: Record<number, string> = {};
        const pMinDates = bookPageMinDateMap[bId] || {};
        totalPages.forEach((p) => {
          const st = classPageStatuses[p];
          if ((st === "done" || st === "homework") && pMinDates[p]) {
            pageDateMap[p] = pMinDates[p];
          }
        });

        // 🌟 실제 일정의 시작 날짜: 페이지 번호와 무관하게 해당 교재에서 어디든 처음 진도 체크되거나 과제가 배부된 날
        let actualStartDate: string | null = bookMinDateMap[bId] || null;
        if (!actualStartDate) {
          const allPageMinDates = Object.values(pMinDates).filter(Boolean).sort();
          if (allPageMinDates.length > 0) actualStartDate = allPageMinDates[0];
        }
        if (!actualStartDate && hasAnyProgress && cb.start_date) {
          actualStartDate = cb.start_date;
        }
        const actualEndDate: string | null =
          bookMaxDateMap[bId] || cb.target_end_date || null;

        const monthDividers = computeFlexibleMonthDividers(totalPages, pageDateMap);

        return {
          ...cb,
          stats: {
            bookPages: totalPages,
            maxPageCount: classCountedPagesCount,
            classPageStatuses,
            classDonePagesCount,
            percent: classPercent,
            individualStats,
            actualStartDate,
            actualEndDate,
            hasAnyProgress,
            pageDateMap,
            monthDividers,
          },
        };
      });

      cachedClassBooksMap.set(classId, booksWithStats);
      setAssignedBooks(booksWithStats);
    } catch (e) {
      console.error("진도율 계산 에러:", e);
    } finally {
      setIsClassBooksLoading(false);
    }
  };

  const isBookDefaultFolded = useCallback(
    (cb: any, pinnedMap: Record<string, boolean>) => {
      if (!cb) return false;
      const isCompleted = cb.stats?.percent === 100 || cb.status === "완료";
      const isPinned =
        pinnedMap[cb.class_textbook_id] !== undefined
          ? pinnedMap[cb.class_textbook_id]
          : Number(cb.current_session) === -1;
      return isCompleted || isPinned;
    },
    []
  );

  const handleToggleExpandBook = useCallback((classTextbookId: string) => {
    setExpandedBookIds((prev) => {
      const targetBook = assignedBooksRef.current.find(
        (b) => b.class_textbook_id === classTextbookId
      );
      let pinnedMap: Record<string, boolean> = {};
      try {
        const raw = localStorage.getItem("logica_lesson_pinned_folded_books");
        if (raw) pinnedMap = JSON.parse(raw);
      } catch (e) {}
      const isCompleted =
        targetBook && (targetBook.stats?.percent === 100 || targetBook.status === "완료");
      const isPinned =
        pinnedMap[classTextbookId] !== undefined
          ? pinnedMap[classTextbookId]
          : Number(targetBook?.current_session) === -1;
      const defaultFolded = Boolean(isCompleted || isPinned);
      const currentExpanded =
        prev[classTextbookId] !== undefined ? prev[classTextbookId] : !defaultFolded;
      return { ...prev, [classTextbookId]: !currentExpanded };
    });
  }, []);

  const handleTogglePinFold = useCallback(
    async (classTextbookId: string) => {
      const targetBook = assignedBooksRef.current.find(
        (b) => b.class_textbook_id === classTextbookId
      );
      const curPinned =
        pinnedFoldedIds[classTextbookId] !== undefined
          ? pinnedFoldedIds[classTextbookId]
          : Number(targetBook?.current_session) === -1;
      const nextPinned = !curPinned;

      setPinnedFoldedIds((prev) => {
        const next = { ...prev, [classTextbookId]: nextPinned };
        try {
          localStorage.setItem("logica_lesson_pinned_folded_books", JSON.stringify(next));
        } catch (e) {}
        return next;
      });

      // 접어두기 설정 시 즉시 카드를 접고, 해제 시 카드를 펼침
      setExpandedBookIds((prev) => ({
        ...prev,
        [classTextbookId]: !nextPinned,
      }));

      setAssignedBooks((prev) => {
        const next = prev.map((cb) =>
          cb.class_textbook_id === classTextbookId
            ? { ...cb, current_session: nextPinned ? -1 : 0 }
            : cb
        );
        if (selectedClass) cachedClassBooksMap.set(selectedClass.class_id, next);
        return next;
      });

      await supabase
        .from("class_textbook")
        .update({ current_session: nextPinned ? -1 : 0 })
        .eq("class_textbook_id", classTextbookId);
    },
    [pinnedFoldedIds, selectedClass]
  );

  const handleSaveTargetDates = useCallback(
    async (classTextbookId: string, startDate: string, targetEndDate: string) => {
      const { error } = await supabase
        .from("class_textbook")
        .update({ start_date: startDate, target_end_date: targetEndDate })
        .eq("class_textbook_id", classTextbookId);

      if (error) {
        alert("목표 일정 저장 실패: " + error.message);
        throw error;
      }

      setAssignedBooks((prev) => {
        const next = prev.map((cb) =>
          cb.class_textbook_id === classTextbookId
            ? { ...cb, start_date: startDate, target_end_date: targetEndDate }
            : cb
        );
        if (selectedClass) cachedClassBooksMap.set(selectedClass.class_id, next);
        return next;
      });
    },
    [selectedClass]
  );

  const handleNavigateProgress = useCallback(
    (classId: string, bookId: string) => {
      router.push(`/progress?class_id=${classId}&book_id=${bookId}`);
    },
    [router]
  );

  const deleteClassTextbook = useCallback(
    async (mappingId: string) => {
      if (!confirm("이 교재 배정을 취소하시겠습니까? (해당 반의 진도 기록 삭제)")) return;
      try {
        await supabase.from("class_textbook").delete().eq("class_textbook_id", mappingId);
        if (selectedClass) fetchClassAssignedBooks(selectedClass, false);
      } catch (e) {
        alert("취소 실패");
      }
    },
    [selectedClass]
  );

  const handleDragStart = useCallback((e: React.DragEvent, bookId: string) => {
    e.dataTransfer.setData("bookId", bookId);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const bookId = e.dataTransfer.getData("bookId");
    if (!bookId || !selectedClass) return;

    const today = new Date().toISOString().split("T")[0];
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 2);

    setAssignModalData({
      book_id: bookId,
      status: "진행중",
      start_date: today,
      target_end_date: nextMonth.toISOString().split("T")[0],
    });
    setIsAssignModalOpen(true);
  };

  const filteredMasterBooks = useMemo(() => {
    return masterBooks.filter((b) => {
      const matchType = filterType === "all" || b.book_type === filterType;
      const matchKw = (b.title || "").toLowerCase().includes(searchKeyword.toLowerCase());
      return matchType && matchKw;
    });
  }, [masterBooks, filterType, searchKeyword]);

  const getGradeWeight = (gradeStr: string) => {
    if (!gradeStr) return 0;
    if (gradeStr.includes("고3")) return 12;
    if (gradeStr.includes("고2")) return 11;
    if (gradeStr.includes("고1")) return 10;
    if (gradeStr.includes("중3")) return 9;
    if (gradeStr.includes("중2")) return 8;
    if (gradeStr.includes("중1")) return 7;
    if (gradeStr.includes("초6")) return 6;
    if (gradeStr.includes("초5")) return 5;
    if (gradeStr.includes("초4")) return 4;
    if (gradeStr.includes("초3")) return 3;
    if (gradeStr.includes("초2")) return 2;
    if (gradeStr.includes("초1")) return 1;
    return 0;
  };

  const groupedClasses = useMemo(() => {
    const groups: any = {
      Ultimate: [],
      Master: [],
      Apex: [],
      Titan: [],
      Horizon: [],
      "특강/메이크업": [],
    };
    classes.forEach((c) => {
      const prefix2 = (c.name || "").trim().toUpperCase().substring(0, 2);
      let gName = "특강/메이크업";
      if (["Ultimate", "Master", "Apex", "Titan", "Horizon"].includes(c.level_name))
        gName = c.level_name;
      else if (
        ["SS", "WS", "MU", "LE"].includes(prefix2) ||
        ["특강", "메이크업"].includes(c.level_name)
      )
        gName = "특강/메이크업";

      if (gName === "특강/메이크업" && !["진행중", "예정"].includes(c.status)) return;
      if (groups[gName]) groups[gName].push(c);
    });
    return groups;
  }, [classes]);

  const openProgressModal = useCallback(
    (cb: any) => {
      if (!selectedClass) return;

      const currentClassStudents = (selectedClass.enrollment || [])
        .filter((e: any) => !isEndedEnrollment(e) && unwrap(e.student)?.status === "재원")
        .map((e: any) => ({
          id: e.student_id,
          name: unwrap(e.student)?.name || "알수없음",
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      const tb = unwrap(cb.textbook);
      const modalMeta = cachedClassModalMetaMap.get(selectedClass.class_id);

      setProgressModalData({
        bookId: cb.book_id,
        classId: selectedClass.class_id,
        students: currentClassStudents,
        bookTitle: tb?.title || "교재",
        pages: cb.stats.bookPages,
        groupedQs: modalMeta?.groupedQsMap?.[cb.book_id] || {},
        statusMap: modalMeta?.statusMap || {},
      });
    },
    [selectedClass]
  );

  if (isAuthorized === null) {
    return <div className="p-10 text-center font-bold text-slate-400">보안 권한 확인 중...</div>;
  }

  if (isAuthorized === false) {
    return null;
  }

  const currentClassStudentCount = selectedClass
    ? new Set(
        (selectedClass.enrollment || [])
          .filter((e: any) => !isEndedEnrollment(e) && unwrap(e.student)?.status === "재원")
          .map((e: any) => e.student_id)
      ).size
    : 0;

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 sm:p-8 gap-5 overflow-hidden relative font-pretendard">
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800 tracking-tight">
            📚 전체 교재 및 배정 관리
          </h2>
          <p className="text-sm font-bold text-slate-400 mt-1">
            학원의 마스터 교재를 등록 및 관리하고, 각 수강반에 교재를 배정하여 진도율을 추적합니다.
          </p>
        </div>
      </div>

      <div className="flex flex-1 gap-5 overflow-hidden">
        {/* 1열: 마스터 교재 */}
        <div className="w-[340px] bg-white rounded-xl border border-slate-200 flex flex-col shrink-0 relative z-10 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-[13px] font-bold text-brand flex items-center gap-1.5">
                <span>📚</span> 전체 마스터 교재
              </h3>
              <button
                onClick={createDummyBook}
                className="bg-brand hover:bg-blue-900 text-white px-2.5 py-1.5 rounded-md font-bold shadow-sm transition-colors flex items-center gap-1 text-xs"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 4v16m8-8H4"
                  ></path>
                </svg>
                새 교재 등록
              </button>
            </div>
            <div className="flex gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-2 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand bg-white shrink-0 w-24"
              >
                <option value="all">전체 구분</option>
                <option value="주교재">주교재</option>
                <option value="부교재">부교재</option>
                <option value="연산교재">연산교재</option>
                <option value="워크북">워크북</option>
              </select>
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="교재명 검색..."
                className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-brand font-medium"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-3 bg-slate-50/50">
            {filteredMasterBooks.length === 0 ? (
              <div className="text-center py-10 text-slate-400 font-bold text-sm">
                등록된 교재가 없습니다.
              </div>
            ) : (
              filteredMasterBooks.map((b) => {
                let badgeClass = "bg-blue-100 text-blue-700 border-blue-200";
                if (b.book_type === "부교재")
                  badgeClass = "bg-emerald-100 text-emerald-700 border-emerald-200";
                else if (b.book_type === "연산교재")
                  badgeClass = "bg-purple-100 text-purple-700 border-purple-200";
                else if (b.book_type === "워크북")
                  badgeClass = "bg-amber-100 text-amber-700 border-amber-200";

                return (
                  <div
                    key={b.book_id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, b.book_id)}
                    className="bg-white border border-slate-200 p-3.5 rounded-xl cursor-grab flex justify-between items-center group relative hover:border-brand"
                  >
                    <div className="flex-1 pr-3 pointer-events-none min-w-0">
                      <span
                        className={`${badgeClass} px-1.5 py-0.5 border rounded text-xs font-bold mb-1.5 inline-block`}
                      >
                        {b.book_type}
                      </span>
                      <div className="font-bold text-slate-800 text-[13px] leading-snug truncate">
                        {b.title}
                      </div>
                      <div className="text-xs font-bold text-slate-400 mt-1">
                        {b.target_sessions}회차 분량
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 z-10 shrink-0 w-[44px]">
                      <button
                        onClick={() => {
                          if (!selectedClass)
                            return alert("우측에서 배정할 반을 먼저 선택해주세요.");
                          const today = new Date().toISOString().split("T")[0];
                          const nextMonth = new Date();
                          nextMonth.setMonth(nextMonth.getMonth() + 2);
                          setAssignModalData({
                            book_id: b.book_id,
                            status: "진행중",
                            start_date: today,
                            target_end_date: nextMonth.toISOString().split("T")[0],
                          });
                          setIsAssignModalOpen(true);
                        }}
                        className="w-full py-1.5 bg-brand text-white rounded text-xs font-bold text-center hover:bg-blue-900"
                      >
                        배정
                      </button>
                      <button
                        onClick={() => {
                          setEditModalData(b);
                          setIsEditModalOpen(true);
                        }}
                        className="w-full py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-xs font-bold border border-slate-200"
                      >
                        수정
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 2열: 교재 배정 및 진도 현황 (중앙) */}
        <div className="flex-1 flex flex-col min-w-0 bg-white rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0 z-10">
            <h2 className="text-[15px] font-bold text-slate-800 flex items-center gap-2">
              {selectedClass ? (
                <>
                  <span className="text-brand">📖</span>{" "}
                  <span className="text-brand">{selectedClass.name}</span> 교재 배정 현황
                </>
              ) : (
                <>
                  <span className="text-slate-400">📋</span> 전체 수강반 목록
                </>
              )}
            </h2>
            <div className="flex items-center h-8">
              {selectedClass && (
                <button
                  onClick={() => setSelectedClass(null)}
                  className="h-full px-4 bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-bold whitespace-nowrap"
                >
                  반 목록으로 ↻
                </button>
              )}
            </div>
          </div>

          <div
            className={`flex-1 overflow-y-auto custom-scroll p-6 relative bg-slate-50/50 ${
              isDragOver
                ? "bg-[#f0f9ff] outline-dashed outline-2 outline-[#38bdf8] outline-offset-[-2px]"
                : ""
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              if (selectedClass && !isDragOver) setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsDragOver(false);
              }
            }}
            onDrop={handleDrop}
          >
            {!selectedClass ? (
              <div className="space-y-8 pb-10">
                {Object.keys(groupedClasses).map((g) => {
                  const groupItems = groupedClasses[g];
                  if (groupItems.length === 0) return null;
                  groupItems.sort(
                    (a: any, b: any) =>
                      getGradeWeight(b.target_grade) - getGradeWeight(a.target_grade)
                  );

                  return (
                    <div key={g}>
                      <h3 className="text-sm font-bold text-slate-800 mb-4 border-b-2 border-slate-200 pb-1.5 flex items-center gap-2">
                        <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded">
                          {g}
                        </span>
                      </h3>
                      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {groupItems.map((c: any) => {
                          const studentCount = new Set(
                            (c.enrollment || [])
                              .filter(
                                (e: any) =>
                                  !isEndedEnrollment(e) && unwrap(e.student)?.status === "재원"
                              )
                              .map((e: any) => e.student_id)
                          ).size;
                          const instructorName = c.instructor?.name || "미정";
                          let scheduleHtml = <span className="text-slate-400 text-xs">-</span>;

                          if (c.class_schedule?.length > 0) {
                            const days = ["월", "화", "수", "목", "금", "토", "일"];
                            c.class_schedule.sort(
                              (a: any, b: any) =>
                                days.indexOf(a.day_of_week) - days.indexOf(b.day_of_week)
                            );
                            scheduleHtml = (
                              <div className="flex flex-col gap-1.5">
                                {c.class_schedule.map((sc: any, idx: number) => {
                                  const sTime = sc.start_time?.substring(0, 5) || "";
                                  const eTime = sc.end_time?.substring(0, 5) || "";
                                  const colorClass =
                                    sc.day_of_week === "토"
                                      ? "text-blue-600"
                                      : sc.day_of_week === "일"
                                      ? "text-red-500"
                                      : "text-slate-700";
                                  return (
                                    <div key={idx} className="flex items-center gap-1.5 text-xs">
                                      <span
                                        className={`font-bold ${colorClass} bg-white border border-slate-200 rounded px-1 w-5 text-center leading-none shrink-0`}
                                      >
                                        {sc.day_of_week}
                                      </span>
                                      <span className="text-brand font-medium tracking-tighter whitespace-nowrap">
                                        {eTime ? `${sTime}~${eTime}` : sTime}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          } else if (c.schedule_days) {
                            scheduleHtml = (
                              <span className="font-bold text-slate-700 text-xs break-keep leading-tight">
                                {c.schedule_days}
                              </span>
                            );
                          }

                          return (
                            <div
                              key={c.class_id}
                              onClick={() => setSelectedClass(c)}
                              className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-sm hover:border-[#0ea5e9] cursor-pointer group flex justify-between items-center gap-2"
                            >
                              <div className="flex flex-col h-full justify-center min-w-0 flex-1">
                                <div className="font-bold text-brand text-[14px] group-hover:text-[#0ea5e9] truncate mb-1">
                                  {c.name}
                                </div>
                                <div className="text-xs font-bold text-slate-500 mb-2">
                                  <div className="truncate">{instructorName} 선생님</div>
                                  <div className="truncate mt-0.5">
                                    <span className="text-sky-600">{studentCount}명</span>
                                  </div>
                                </div>
                                <div className="mt-auto pt-1">
                                  <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 text-xs font-bold inline-block">
                                    {c.target_grade || "무학년"}
                                  </span>
                                </div>
                              </div>
                              <div className="shrink-0 bg-slate-50/70 p-2 rounded-xl border border-slate-100 flex items-center justify-center">
                                {scheduleHtml}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-4">
                {assignedBooks.length > 0 && (
                  <div className="flex items-center gap-3 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm w-fit mb-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                      <span className="w-2.5 h-3 rounded-sm bg-brand inline-block"></span>
                      반 완료
                    </span>
                    <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                      <span className="w-2.5 h-3 rounded-sm bg-emerald-500 inline-block"></span>
                      개인 완료
                    </span>
                    <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                      <span className="w-2.5 h-3 rounded-sm bg-amber-400 inline-block"></span>
                      과제 배부됨
                    </span>
                    <span className="text-xs font-bold text-indigo-600 flex items-center gap-1">
                      <span className="px-1 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-[9.5px] font-extrabold leading-none">
                        | N월
                      </span>
                      월별 진행 구분
                    </span>
                  </div>
                )}

                {isClassBooksLoading && assignedBooks.length === 0 ? (
                  <div className="py-20 flex flex-col items-center justify-center bg-white rounded-2xl border border-slate-200 shadow-sm gap-3">
                    <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-bold text-slate-500">
                      교재 배정 및 학생별 진도 데이터를 불러오는 중입니다...
                    </span>
                  </div>
                ) : assignedBooks.length === 0 ? (
                  <div
                    className={`text-center py-20 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-2xl ${
                      isDragOver ? "bg-[#f0f9ff] border-[#38bdf8]" : "bg-white"
                    } shadow-sm pointer-events-none`}
                  >
                    <span className="text-5xl mb-4 opacity-50">{isDragOver ? "✅" : "⬇️"}</span>
                    <span className="text-slate-600 font-bold text-lg mb-1">
                      이 반에 배정된 교재가 없습니다.
                    </span>
                    <span className="text-slate-400 text-sm font-medium">
                      좌측 마스터 교재를 드래그하여 이곳에 놓아주세요.
                    </span>
                  </div>
                ) : (
                  <>
                    {assignedBooks.map((cb) => {
                      const isPinnedFolded =
                        pinnedFoldedIds[cb.class_textbook_id] !== undefined
                          ? pinnedFoldedIds[cb.class_textbook_id]
                          : Number(cb.current_session) === -1;
                      const defaultFolded = isBookDefaultFolded(cb, pinnedFoldedIds);
                      const isExpanded =
                        expandedBookIds[cb.class_textbook_id] !== undefined
                          ? expandedBookIds[cb.class_textbook_id]
                          : !defaultFolded;

                      return (
                        <AssignedBookCard
                          key={cb.class_textbook_id}
                          cb={cb}
                          selectedClassId={selectedClass.class_id}
                          isExpanded={isExpanded}
                          isPinnedFolded={isPinnedFolded}
                          onToggleExpand={handleToggleExpandBook}
                          onTogglePinFold={handleTogglePinFold}
                          onOpenProgressModal={openProgressModal}
                          onNavigateProgress={handleNavigateProgress}
                          onDeleteClassTextbook={deleteClassTextbook}
                          onSaveTargetDates={handleSaveTargetDates}
                        />
                      );
                    })}
                    <div
                      className={`mt-6 border-2 border-dashed border-slate-300 rounded-xl p-8 text-center text-slate-500 font-bold ${
                        isDragOver ? "bg-[#f0f9ff] border-[#38bdf8]" : "bg-white"
                      } flex flex-col items-center justify-center shadow-sm pointer-events-none`}
                    >
                      <span className="text-3xl mb-2 opacity-50">{isDragOver ? "✅" : "⬇️"}</span>
                      좌측 마스터 교재를 이 영역으로 드래그하여 배정하세요.
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 3열: 선생님을 위한 [클래스 인사이트] (우측 사이드바) */}
        {selectedClass && (
          <div className="w-[300px] bg-white rounded-xl border border-slate-200 flex flex-col shrink-0 shadow-sm overflow-hidden z-10">
            <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
              <h3 className="text-[13px] font-bold text-brand flex items-center gap-1.5">
                <span>💡</span> 클래스 인사이트
              </h3>
              <p className="text-xs font-bold text-slate-400 mt-1">
                선택된 수강반의 핵심 정보를 요약합니다.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-5 bg-slate-50/50">
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex flex-col gap-2.5">
                <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold text-slate-500">담당 강사</span>
                  <span className="text-xs font-bold text-slate-800">
                    {selectedClass.instructor?.name || "미배정"}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold text-slate-500">총 수강 인원</span>
                  <span className="text-xs font-bold text-sky-600">
                    {currentClassStudentCount}명
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-500">대상 학년</span>
                  <span className="text-xs font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                    {selectedClass.target_grade || "무학년"}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-rose-600 flex items-center gap-1">
                  <span>🚨</span> 요주의 학생 알림
                </span>
                <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl flex flex-col gap-2">
                  <div
                    className="flex justify-between items-center bg-white p-2 rounded-lg border border-rose-100"
                    title="이 반에서 최근 7일 안에 마감된 과제 중 아직 제출(완료)하지 않은 학생 수"
                  >
                    <span className="text-xs font-bold text-slate-600">최근 7일 과제 미제출</span>
                    <span className="text-xs font-bold text-rose-600">
                      {isHwAlertLoading ? "..." : `${hwMissingAlerts.length}명`}
                    </span>
                  </div>
                  {!isHwAlertLoading &&
                    hwMissingAlerts.slice(0, 5).map((item) => (
                      <button
                        key={item.student_id}
                        onClick={() => router.push(`/student/${item.student_id}`)}
                        className="flex justify-between items-center bg-white p-2 rounded-lg border border-rose-100 hover:border-rose-300 text-left"
                        title="학생 상세 화면으로 이동"
                      >
                        <span className="text-xs font-bold text-slate-600 truncate">
                          {item.name} 학생
                        </span>
                        <span className="text-xs font-bold text-rose-600">
                          미제출 {item.count}건
                        </span>
                      </button>
                    ))}
                  {!isHwAlertLoading && hwMissingAlerts.length > 5 && (
                    <div className="text-xs font-bold text-rose-400 text-right">
                      외 {hwMissingAlerts.length - 5}명
                    </div>
                  )}

                  {attendanceAlerts.length === 0 ? (
                    <div className="flex justify-center items-center bg-white p-2 rounded-lg border border-rose-100">
                      <span className="text-xs font-bold text-slate-400">
                        이번 주 지각/결석 없음
                      </span>
                    </div>
                  ) : (
                    attendanceAlerts.map((alert, idx) => {
                      const stuName = unwrap(alert.student)?.name || "알수없음";
                      let dateStr = "";
                      if (alert.attendance_date) {
                        const parts = alert.attendance_date.split("-");
                        if (parts.length === 3) {
                          dateStr = `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
                        }
                      }
                      return (
                        <div
                          key={idx}
                          className="flex justify-between items-center bg-white p-2 rounded-lg border border-rose-100"
                        >
                          <span className="text-xs font-bold text-slate-600 truncate">
                            {stuName} 학생
                          </span>
                          <span
                            className={`text-xs font-bold ${
                              alert.status === "결석" ? "text-rose-600" : "text-amber-600"
                            }`}
                          >
                            {dateStr} {alert.status}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  <span>⚡</span> 빠른 실행 액션
                </span>
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() =>
                      router.push(`/home?classId=${selectedClass.class_id}&openNotice=1`)
                    }
                    title="홈 화면의 '알림/과제 전송' 창을 이 반으로 엽니다."
                    className="w-full bg-white border border-slate-200 hover:border-[#fef01b] hover:bg-[#fef01b]/10 text-slate-700 p-2.5 rounded-xl text-xs font-bold text-left flex items-center justify-between group"
                  >
                    <span>💬 학부모 전체 알림톡 발송</span>
                    <span className="opacity-0 group-hover:opacity-100">→</span>
                  </button>
                  <button
                    onClick={() =>
                      router.push(`/makeup?new=1&classId=${selectedClass.class_id}`)
                    }
                    title="보강 관리에서 이 반 학생의 새 보강 일정을 등록합니다."
                    className="w-full bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 p-2.5 rounded-xl text-xs font-bold text-left flex items-center justify-between group"
                  >
                    <span>🏥 클리닉(보충) 배정</span>
                    <span className="opacity-0 group-hover:opacity-100">→</span>
                  </button>
                  <button
                    onClick={() =>
                      window.open(
                        `/print/class-report?class_id=${selectedClass.class_id}`,
                        "_blank"
                      )
                    }
                    title="이 반 학생들의 이번 달 성취도를 A4 리포트로 엽니다. 인쇄하거나 PDF로 저장할 수 있습니다."
                    className="w-full bg-white border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-slate-700 p-2.5 rounded-xl text-xs font-bold text-left flex items-center justify-between group"
                  >
                    <span>📊 반 전체 성취도 리포트 인쇄</span>
                    <span className="opacity-0 group-hover:opacity-100">→</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <EditBookModal
        isOpen={isEditModalOpen}
        bookData={editModalData}
        onClose={() => setIsEditModalOpen(false)}
        onSuccess={() => {
          fetchMasterBooks();
          if (selectedClass) fetchClassAssignedBooks(selectedClass, false);
        }}
      />

      <AssignBookModal
        isOpen={isAssignModalOpen}
        assignData={assignModalData}
        selectedClass={selectedClass}
        onClose={() => setIsAssignModalOpen(false)}
        onSuccess={() => fetchClassAssignedBooks(selectedClass, false)}
      />

      {progressModalData && (
        <ProgressDetailModal
          data={progressModalData}
          onClose={() => setProgressModalData(null)}
        />
      )}
    </div>
  );
}