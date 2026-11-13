// src/app/hq/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useHqShell } from "@/components/hq/HqShellContext";
import ApprovalCreateModal from "@/components/hq/approvals/ApprovalCreateModal";
import ApprovalDetailModal from "@/components/hq/approvals/ApprovalDetailModal";
import CertificatePrintModal from "@/components/hq/members/CertificatePrintModal";
import {
  APPROVAL_DOC_META,
  AUTO_DELEGATION_RULES,
  getRankLevel,
  getRankMeta,
  HQ_RANK_LIST,
} from "@/lib/hq/constants";
import { hqFetch, resolveStoragePublicUrl } from "@/lib/hq/clientApi";
import type {
  HqApprovalDoc,
  HqApprovalDocType,
  HqExpense,
  HqPublication,
} from "@/lib/hq/types";

export default function HqHomeDashboardPage() {
  const router = useRouter();
  const {
    me,
    members,
    isHrManager,
    isHqAdmin,
    unsignedContractCount,
    myTodayAttendance,
    myWeeklyMinutes,
    unreadChatCount,
    schemaMissing,
    refreshMembers,
    refreshApprovalBadge,
  } = useHqShell();

  const [docs, setDocs] = useState<HqApprovalDoc[]>([]);
  const [expenses, setExpenses] = useState<HqExpense[]>([]);
  const [books, setBooks] = useState<HqPublication[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [defaultDocType, setDefaultDocType] =
    useState<HqApprovalDocType>("GENERAL");
  const [selectedDoc, setSelectedDoc] = useState<HqApprovalDoc | null>(null);
  const [certModalOpen, setCertModalOpen] = useState(false);

  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const loadDashboardData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [aprRes, expRes, pubRes] = await Promise.all([
        hqFetch<{
          success: boolean;
          data: { docs: HqApprovalDoc[] };
        }>("/api/hq/approvals").catch(() => ({
          success: false,
          data: { docs: [] },
        })),
        hqFetch<{
          success: boolean;
          data: { expenses: HqExpense[] };
        }>(`/api/hq/expenses?month=${currentMonth}`).catch(() => ({
          success: false,
          data: { expenses: [] },
        })),
        hqFetch<{
          success: boolean;
          data: { books: HqPublication[] };
        }>("/api/hq/publishing").catch(() => ({
          success: false,
          data: { books: [] },
        })),
      ]);

      setDocs(aprRes.data?.docs || []);
      setExpenses(expRes.data?.expenses || []);
      setBooks(pubRes.data?.books || []);
    } finally {
      setLoadingData(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.work_status === "재직"),
    [members]
  );

  const myLevel = getRankLevel(me?.rank_code);
  const myRankMeta = getRankMeta(me?.rank_code);

  // 현재 내 차례에 올라온 결재 대기 문서 (긴급 우선)
  const myTurnDocs = useMemo(() => {
    if (!me) return [];
    return docs
      .filter((doc) => {
        if (doc.status !== "PENDING" && doc.status !== "IN_PROGRESS") {
          return false;
        }
        const cur = doc.steps.find(
          (s) => Number(s.step_order) === Number(doc.current_step_order)
        );
        return (
          cur && cur.approver_id === me.instructor_id && cur.status === "CURRENT"
        );
      })
      .sort((a, b) => Number(b.urgent) - Number(a.urgent));
  }, [docs, me]);

  // 내가 상신한 최근 결재 문서
  const myDraftDocs = useMemo(() => {
    if (!me) return [];
    return docs
      .filter((d) => d.drafter_id === me.instructor_id)
      .slice(0, 6);
  }, [docs, me]);

  // 부서별 재직 인원 요약
  const deptSummary = useMemo(() => {
    const map = new Map<
      string,
      { dept: string; count: number; headName: string | null }
    >();
    activeMembers.forEach((m) => {
      const dept = m.department || "미지정";
      const cur = map.get(dept) || { dept, count: 0, headName: null };
      cur.count += 1;
      if (m.is_dept_head && !cur.headName) {
        cur.headName = `${m.name} ${m.job_title}`;
      }
      map.set(dept, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [activeMembers]);

  // 이번 달 비용 요약
  const expenseStats = useMemo(() => {
    let total = 0;
    let pendingCount = 0;
    let pendingAmount = 0;
    expenses.forEach((ex) => {
      if (ex.settlement_status !== "반려") {
        total += ex.amount;
      }
      if (ex.settlement_status === "정산대기") {
        pendingCount += 1;
        pendingAmount += ex.amount;
      }
    });
    return { total, pendingCount, pendingAmount };
  }, [expenses]);

  // 직책·직급 맥락 기반 선제적 업무 제안 (Proactive Insights)
  const proactiveNotices = useMemo(() => {
    const items: {
      id: string;
      tone: "urgent" | "warn" | "info" | "ok";
      badge: string;
      text: string;
      actionLabel?: string;
      onClick?: () => void;
    }[] = [];

    if (myTurnDocs.length > 0) {
      const urgentCnt = myTurnDocs.filter((d) => d.urgent).length;
      items.push({
        id: "my-turn",
        tone: urgentCnt > 0 ? "urgent" : "warn",
        badge: urgentCnt > 0 ? `긴급 ${urgentCnt}건` : "결재 대기",
        text: `${me?.name || ""} ${me?.job_title || ""}님의 승인을 기다리는 결재 문서가 ${myTurnDocs.length}건 있습니다.`,
        actionLabel: "결재함 열기 →",
        onClick: () => router.push("/hq/approvals"),
      });
    }

    const hasHigherApprover = activeMembers.some(
      (m) => getRankLevel(m.rank_code) >= 3
    );
    if (!schemaMissing && activeMembers.length > 0 && !hasHigherApprover) {
      items.push({
        id: "rank-setup",
        tone: "warn",
        badge: "조직 설정 필요",
        text: "아직 팀장(Lv.3)·본부장(Lv.4)·대표(Lv.5) 결재 직급자가 지정되지 않았습니다. 구성원 관리에서 직급과 부서장을 배정하면 3단계 결재선이 자동 완성됩니다.",
        actionLabel: "직급 설정하기 →",
        onClick: () => router.push("/hq/members"),
      });
    }

    if ((isHrManager || myLevel >= 3) && expenseStats.pendingCount > 0) {
      items.push({
        id: "expense-pending",
        tone: "info",
        badge: "경비 정산",
        text: `이번 달 정산 대기 중인 경비 전표가 ${expenseStats.pendingCount}건 (${expenseStats.pendingAmount.toLocaleString()}원) 있습니다.`,
        actionLabel: "정산 관리 →",
        onClick: () => router.push("/hq/expenses"),
      });
    }

    if (isHrManager || myLevel >= 3) {
      const scopeMembers =
        myLevel >= 4 || isHrManager
          ? activeMembers
          : activeMembers.filter((m) => m.department === me?.department);
      const lowLeaveUsage = scopeMembers.filter(
        (m) =>
          m.annual_leave_total >= 10 &&
          m.annual_leave_used / Math.max(1, m.annual_leave_total) < 0.2
      );
      if (lowLeaveUsage.length > 0) {
        items.push({
          id: "leave-encourage",
          tone: "info",
          badge: "연차 촉진 인사이트",
          text: `${
            myLevel >= 4 || isHrManager ? "본부 전체" : `${me?.department} 내`
          } 연차 소진율 20% 미만 구성원이 ${lowLeaveUsage.length}명 있습니다. 분기 휴가 계획을 독려해 주세요.`,
          actionLabel: "구성원 연차 확인 →",
          onClick: () => router.push("/hq/members"),
        });
      }
    }

    if (!schemaMissing && !myTodayAttendance) {
      items.push({
        id: "attendance-checkin",
        tone: "info",
        badge: "근태 · 유연근무",
        text: "오늘 아직 출근 체크인 전입니다. 정규출근·시차출퇴근·재택원고·인쇄감리 외근 중 오늘의 근무 형태를 등록해 주세요.",
        actionLabel: "출근 · 유연근무 선택 →",
        onClick: () => router.push("/hq/attendance"),
      });
    } else if (myWeeklyMinutes >= 45 * 60) {
      items.push({
        id: "weekly-overtime-warn",
        tone: myWeeklyMinutes >= 50 * 60 ? "urgent" : "warn",
        badge: "주 52시간 주의",
        text: `이번 주 누적 근무시간이 ${Math.floor(myWeeklyMinutes / 60)}시간을 넘었습니다. 마감 후 대체휴무 활용을 권장합니다.`,
        actionLabel: "근로시간 확인 →",
        onClick: () => router.push("/hq/attendance"),
      });
    }

    if (unsignedContractCount > 0) {
      items.push({
        id: "unsigned-contract",
        tone: "warn",
        badge: `전자서명 ${unsignedContractCount}건`,
        text: `서명 대기 중인 전자계약서(근로·연봉·출판외주/인세)가 ${unsignedContractCount}건 있습니다.`,
        actionLabel: "전자서명하기 →",
        onClick: () => router.push("/hq/contracts"),
      });
    }

    const urgentBooks = books.filter((b) => {
      if (b.stage === "PUBLISHED" || !b.press_deadline) return false;
      const diff =
        (new Date(`${b.press_deadline}T00:00:00`).getTime() -
          new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`).getTime()) /
        (1000 * 60 * 60 * 24);
      return diff <= 7;
    });
    if (urgentBooks.length > 0) {
      items.push({
        id: "urgent-press-deadline",
        tone: "urgent",
        badge: `하판 임박 ${urgentBooks.length}종`,
        text: `7일 이내 인쇄 하판 마감 예정인 도서가 ${urgentBooks.length}종(「${urgentBooks[0].title}」 등) 있습니다.`,
        actionLabel: "출판 공정 보드 →",
        onClick: () => router.push("/hq/publishing"),
      });
    }

    if (unreadChatCount > 0) {
      items.push({
        id: "unread-chat",
        tone: "info",
        badge: "사내 메신저",
        text: `읽지 않은 전사 메신저 대화가 ${unreadChatCount}건 도착해 있습니다.`,
        actionLabel: "메신저 열기 →",
        onClick: () => router.push("/hq/messenger"),
      });
    }

    if (items.length === 0) {
      items.push({
        id: "all-clear",
        tone: "ok",
        badge: "정상 운영",
        text: "현재 밀린 결재나 이상 징후가 없습니다. 상단 빠른 기안 버튼으로 휴가·품의·지출결의를 바로 상신할 수 있습니다.",
      });
    }

    return items;
  }, [
    myTurnDocs,
    me,
    activeMembers,
    schemaMissing,
    isHrManager,
    myLevel,
    expenseStats,
    myTodayAttendance,
    myWeeklyMinutes,
    unsignedContractCount,
    books,
    unreadChatCount,
    router,
  ]);

  const openQuickDraft = (docType: HqApprovalDocType) => {
    setDefaultDocType(docType);
    setCreateOpen(true);
  };

  const handleAfterUpdate = async () => {
    await Promise.all([
      loadDashboardData(),
      refreshApprovalBadge(),
      refreshMembers(),
    ]);
  };

  return (
    <>
      <div className="p-6 space-y-6 max-w-[1440px] w-full mx-auto print:hidden">
        {/* 1. 상단 직급·맥락 기반 워크스페이스 브리핑 & 빠른 액션 */}
        <section className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-brand text-white p-6 sm:p-7 shadow-lg border border-slate-800">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-white/15 text-xs font-bold text-blue-100">
                  {me?.department || "본부"} · Lv.{myRankMeta.level}{" "}
                  {me?.job_title || myRankMeta.defaultTitle}
                </span>
                {isHrManager && (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-400/20 border border-emerald-300/30 text-xs font-bold text-emerald-200">
                    HR · 조직관리 권한
                  </span>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                안녕하세요, {me?.name || "구성원"} {me?.job_title || ""}님 👋
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 font-medium">
                {myRankMeta.description} — 직급과 부서 권한에 맞춘 당일 우선 업무를 안내합니다.
              </p>
            </div>

            {/* 빠른 기안 · 셀프서비스 실행 바 */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => router.push("/hq/attendance")}
                className="px-3.5 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-300/30 text-emerald-100 text-xs font-extrabold transition-colors"
              >
                ⏱️ 출퇴근·유연근무
              </button>
              <button
                type="button"
                onClick={() => router.push("/hq/contracts")}
                className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold transition-colors"
              >
                📑 전자계약·저작권
              </button>
              <button
                type="button"
                onClick={() => router.push("/hq/publishing")}
                className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold transition-colors"
              >
                📚 출판 공정 보드
              </button>
              {(
                [
                  { type: "LEAVE", label: "🌴 휴가신청" },
                  { type: "EXPENSE", label: "💳 지출결의" },
                  { type: "PURCHASE", label: "🛒 인쇄·구매품의" },
                ] as const
              ).map((btn) => (
                <button
                  key={btn.type}
                  type="button"
                  onClick={() => openQuickDraft(btn.type)}
                  className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold transition-colors"
                >
                  {btn.label}
                </button>
              ))}
              {me && (
                <button
                  type="button"
                  onClick={() => setCertModalOpen(true)}
                  className="px-3.5 py-2.5 rounded-xl bg-white text-slate-900 hover:bg-blue-50 text-xs font-extrabold shadow-sm transition-colors"
                >
                  🪪 증명서 발급
                </button>
              )}
            </div>
          </div>

          {/* 선제적 업무 제안 스트립 */}
          <div className="mt-5 pt-5 border-t border-white/10 grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {proactiveNotices.map((notice) => {
              const badgeStyle =
                notice.tone === "urgent"
                  ? "bg-rose-500 text-white"
                  : notice.tone === "warn"
                    ? "bg-amber-400 text-slate-900"
                    : notice.tone === "ok"
                      ? "bg-emerald-500 text-white"
                      : "bg-sky-400/20 text-sky-200 border border-sky-300/30";
              return (
                <div
                  key={notice.id}
                  className="rounded-2xl bg-white/8 border border-white/10 px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold shrink-0 mt-0.5 ${badgeStyle}`}
                    >
                      {notice.badge}
                    </span>
                    <p className="text-xs text-slate-100 leading-relaxed font-medium">
                      {notice.text}
                    </p>
                  </div>
                  {notice.actionLabel && notice.onClick && (
                    <button
                      type="button"
                      onClick={notice.onClick}
                      className="text-xs font-extrabold text-blue-200 hover:text-white whitespace-nowrap shrink-0"
                    >
                      {notice.actionLabel}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* 2. 핵심 HR · 결재 · 비용 KPI 요약 카드 4종 */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div
            onClick={() => router.push("/hq/approvals")}
            className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs hover:border-brand/40 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">
                내 결재 대기 문서
              </span>
              <span className="text-lg">✍️</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900">
                {myTurnDocs.length}건
              </span>
              {myTurnDocs.some((d) => d.urgent) && (
                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[11px] font-extrabold">
                  긴급 포함
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 font-medium">
              전체 열람 가능 결재문서 {docs.length}건
            </p>
          </div>

          <div
            onClick={() => router.push("/hq/members")}
            className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs hover:border-brand/40 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">
                본부 재직 구성원
              </span>
              <span className="text-lg">👥</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900">
                {activeMembers.length}명
              </span>
              <span className="text-xs font-bold text-slate-500">
                ({deptSummary.length}개 부서)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 font-medium">
              임원·부서장{" "}
              {activeMembers.filter((m) => getRankLevel(m.rank_code) >= 3).length}
              명 · 실무진{" "}
              {activeMembers.filter((m) => getRankLevel(m.rank_code) <= 2).length}명
            </p>
          </div>

          <div
            onClick={() => openQuickDraft("LEAVE")}
            className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs hover:border-brand/40 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">
                내 잔여 연차 현황
              </span>
              <span className="text-lg">🌴</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-emerald-600">
                {me?.annual_leave_remain ?? 15}일
              </span>
              <span className="text-xs font-semibold text-slate-400">
                / 총 {me?.annual_leave_total ?? 15}일
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 font-medium">
              사용 완료 {me?.annual_leave_used ?? 0}일 · 클릭하여 휴가 기안
            </p>
          </div>

          <div
            onClick={() => router.push("/hq/expenses")}
            className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs hover:border-brand/40 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">
                당월({currentMonth}) 경비 합계
              </span>
              <span className="text-lg">💳</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900">
                {expenseStats.total.toLocaleString()}원
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 font-medium">
              정산 대기 {expenseStats.pendingCount}건 (
              {expenseStats.pendingAmount.toLocaleString()}원)
            </p>
          </div>
        </section>

        {/* 3. 하단 메인 그리드: 좌측 결재 워크플로우 / 우측 직급 체계 & 조직 요약 */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* 좌측 7칸: 내 결재 차례 & 최근 상신 문서 */}
          <div className="lg:col-span-7 space-y-5">
            {/* 내 결재 차례 박스 */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-extrabold text-slate-800">
                    🔔 내가 지금 결재할 문서
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-xs font-extrabold">
                    {myTurnDocs.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => router.push("/hq/approvals")}
                  className="text-xs font-bold text-brand hover:underline"
                >
                  전자결재 전체보기 →
                </button>
              </div>

              {loadingData ? (
                <div className="p-8 text-center text-xs font-bold text-slate-400">
                  결재 현황을 불러오는 중입니다...
                </div>
              ) : myTurnDocs.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-xs font-bold text-slate-400">
                    현재 내 결재 순서로 대기 중인 문서가 없습니다.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {myTurnDocs.slice(0, 5).map((doc) => {
                    const meta =
                      APPROVAL_DOC_META[doc.doc_type] ||
                      APPROVAL_DOC_META.GENERAL;
                    return (
                      <div
                        key={doc.approval_id}
                        onClick={() => setSelectedDoc(doc)}
                        className="px-5 py-3.5 hover:bg-slate-50 cursor-pointer flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-1">
                            {doc.urgent && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-extrabold">
                                긴급
                              </span>
                            )}
                            <span
                              className={`px-2 py-0.5 rounded border text-[10px] font-bold ${meta.badgeClass}`}
                            >
                              {meta.icon} {meta.shortLabel}
                            </span>
                            <span className="text-[11px] text-slate-400 font-semibold">
                              {doc.drafter_dept} · {doc.drafter_name}{" "}
                              {doc.drafter_title}
                            </span>
                          </div>
                          <div className="text-sm font-bold text-slate-800 truncate">
                            {doc.title}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="text-xs font-extrabold text-brand">
                            {doc.doc_type === "LEAVE"
                              ? `${doc.leave_days}일 (${doc.leave_type})`
                              : doc.amount > 0
                                ? `${doc.amount.toLocaleString()}원`
                                : `${doc.current_step_order}/${doc.total_steps}단계`}
                          </div>
                          <span className="inline-block mt-1 px-2.5 py-1 rounded-lg bg-brand text-white text-[11px] font-bold">
                            검토 · 승인
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 내가 기안한 최근 문서 */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-slate-800">
                  📤 내가 상신한 최근 문서
                </h3>
                <button
                  type="button"
                  onClick={() => openQuickDraft("GENERAL")}
                  className="text-xs font-bold text-brand hover:underline"
                >
                  + 새 기안 작성
                </button>
              </div>

              {myDraftDocs.length === 0 ? (
                <div className="p-8 text-center text-xs font-bold text-slate-400">
                  아직 기안한 전자결재 문서가 없습니다.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {myDraftDocs.map((doc) => {
                    const meta =
                      APPROVAL_DOC_META[doc.doc_type] ||
                      APPROVAL_DOC_META.GENERAL;
                    const statusLabel =
                      doc.status === "APPROVED"
                        ? {
                            t: "최종 승인",
                            c: "bg-emerald-50 text-emerald-700 border-emerald-200",
                          }
                        : doc.status === "REJECTED"
                          ? {
                              t: "반려됨",
                              c: "bg-rose-50 text-rose-700 border-rose-200",
                            }
                          : doc.status === "CANCELLED"
                            ? {
                                t: "회수됨",
                                c: "bg-slate-100 text-slate-500 border-slate-200",
                              }
                            : {
                                t: `${doc.current_step_order}/${doc.total_steps}단계 진행중`,
                                c: "bg-amber-50 text-amber-800 border-amber-200",
                              };
                    return (
                      <div
                        key={doc.approval_id}
                        onClick={() => setSelectedDoc(doc)}
                        className="px-5 py-3.5 hover:bg-slate-50 cursor-pointer flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-xs">{meta.icon}</span>
                            <span className="text-xs font-bold text-slate-800 truncate">
                              {doc.title}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {doc.doc_no} ·{" "}
                            {new Date(doc.submitted_at).toLocaleDateString(
                              "ko-KR"
                            )}
                          </div>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-full border text-[11px] font-extrabold shrink-0 ${statusLabel.c}`}
                        >
                          {statusLabel.t}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 우측 5칸: 직급별 결재 단계 규정 & 부서 조직 요약 */}
          <div className="lg:col-span-5 space-y-5">
            {/* 직급별 결재 단계 및 자동 전결 기준 안내 */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-slate-800">
                  🏛️ 본부 직급 체계 · 결재 전결 기준
                </h3>
                <button
                  type="button"
                  onClick={() => router.push("/hq/members")}
                  className="text-xs font-bold text-brand hover:underline"
                >
                  구성원 관리 →
                </button>
              </div>

              <div className="space-y-2">
                {[...HQ_RANK_LIST].reverse().map((rk) => {
                  const count = activeMembers.filter(
                    (m) => m.rank_code === rk.code
                  ).length;
                  return (
                    <div
                      key={rk.code}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded border text-[10px] font-extrabold ${rk.badgeClass}`}
                          >
                            Lv.{rk.level} {rk.shortLabel}
                          </span>
                          <span className="text-xs font-bold text-slate-700 truncate">
                            {rk.description}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-extrabold text-slate-700 shrink-0">
                        {count}명
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-xl bg-blue-50/70 border border-blue-200/70 p-3.5 text-xs text-slate-700 space-y-1">
                <div className="font-extrabold text-brand">
                  ⚡ 자동 전결 워크플로우 규정
                </div>
                <p>
                  • 단기 휴가({AUTO_DELEGATION_RULES.TEAM_LEAD_MAX_LEAVE_DAYS}일 이하) 및 소액 지출·품의(
                  {(AUTO_DELEGATION_RULES.TEAM_LEAD_MAX_AMOUNT / 10000).toFixed(0)}만원 이하):{" "}
                  <b>팀장·실장(Lv.3) 전결</b>
                </p>
                <p>
                  • 중액 지출·품의(
                  {(AUTO_DELEGATION_RULES.DIRECTOR_MAX_AMOUNT / 10000).toFixed(0)}만원 이하):{" "}
                  <b>본부장·이사(Lv.4) 전결</b>
                </p>
                <p>
                  • 100만원 초과 고액 품의 · 장기 휴가 · 중요 기안:{" "}
                  <b>대표·소장(Lv.5) 최종 승인</b>
                </p>
              </div>
            </div>

            {/* 부서별 재직 인원 & 리더 현황 */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-slate-800">
                  🏢 부서별 조직 현황
                </h3>
                <span className="text-xs font-semibold text-slate-400">
                  총 {deptSummary.length}개 부서
                </span>
              </div>

              {deptSummary.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400 font-bold">
                  등록된 본부 구성원이 없습니다.
                </div>
              ) : (
                <div className="space-y-2">
                  {deptSummary.map((d) => (
                    <div
                      key={d.dept}
                      onClick={() => router.push("/hq/members")}
                      className="px-3.5 py-2.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white flex items-center justify-between cursor-pointer transition-colors"
                    >
                      <div>
                        <div className="text-xs font-extrabold text-slate-800">
                          {d.dept}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {d.headName ? `부서장: ${d.headName}` : "부서장 미지정"}
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-extrabold">
                        {d.count}명
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* 최근 입사/재직 구성원 미니 아바타 열 */}
              {activeMembers.length > 0 && (
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex -space-x-2 overflow-hidden">
                    {activeMembers.slice(0, 7).map((m) => {
                      const avatar = resolveStoragePublicUrl(
                        m.profile_image_url
                      );
                      return (
                        <div
                          key={m.instructor_id}
                          title={`${m.name} ${m.job_title} (${m.department})`}
                          className="relative w-7 h-7 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-[10px] font-bold text-slate-700 overflow-hidden"
                        >
                          <span>{m.name.slice(0, 1)}</span>
                          {avatar && (
                            <img
                              src={avatar}
                              alt={m.name}
                              className="absolute inset-0 w-full h-full object-cover"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push("/hq/messenger")}
                    className="text-xs font-bold text-slate-600 hover:text-brand"
                  >
                    💬 사내 메신저 열기
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* 기안 작성 모달 */}
      <ApprovalCreateModal
        isOpen={createOpen}
        me={me}
        members={members}
        defaultDocType={defaultDocType}
        onClose={() => setCreateOpen(false)}
        onCreated={handleAfterUpdate}
      />

      {/* 결재 상세 · 승인/전결/반려/인쇄 모달 */}
      <ApprovalDetailModal
        doc={selectedDoc}
        me={me}
        isHqAdmin={isHqAdmin}
        onClose={() => setSelectedDoc(null)}
        onUpdated={handleAfterUpdate}
      />

      {/* 본인 재직·경력증명서 셀프 발급 모달 */}
      <CertificatePrintModal
        isOpen={certModalOpen}
        member={me}
        onClose={() => setCertModalOpen(false)}
      />
    </>
  );
}
