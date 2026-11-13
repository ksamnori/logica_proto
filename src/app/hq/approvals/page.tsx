// src/app/hq/approvals/page.tsx
"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useHqShell } from "@/components/hq/HqShellContext";
import ApprovalCreateModal from "@/components/hq/approvals/ApprovalCreateModal";
import ApprovalDetailModal from "@/components/hq/approvals/ApprovalDetailModal";
import {
  APPROVAL_DOC_META,
  AUTO_DELEGATION_RULES,
  getRankMeta,
} from "@/lib/hq/constants";
import { hqFetch } from "@/lib/hq/clientApi";
import type {
  HqApprovalDoc,
  HqApprovalDocType,
  HqApprovalStatus,
} from "@/lib/hq/types";

type InboxTab =
  | "my_turn"
  | "in_progress"
  | "my_drafts"
  | "approved"
  | "rejected"
  | "all";

const STATUS_STYLE: Record<
  HqApprovalStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: "1차 결재대기",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
  IN_PROGRESS: {
    label: "결재 진행중",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  APPROVED: {
    label: "최종 승인",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  REJECTED: {
    label: "반려됨",
    className: "bg-rose-50 text-rose-700 border-rose-200",
  },
  CANCELLED: {
    label: "상신 회수",
    className: "bg-slate-100 text-slate-500 border-slate-200",
  },
};

function HqApprovalsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    me,
    members,
    isHqAdmin,
    refreshApprovalBadge,
    refreshMembers,
  } = useHqShell();

  const [docs, setDocs] = useState<HqApprovalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<InboxTab>("all");
  const [typeFilter, setTypeFilter] = useState<"ALL" | HqApprovalDocType>("ALL");
  const [keyword, setKeyword] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [defaultDocType, setDefaultDocType] =
    useState<HqApprovalDocType>("GENERAL");
  const [selectedDoc, setSelectedDoc] = useState<HqApprovalDoc | null>(null);

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hqFetch<{
        success: boolean;
        data: { docs: HqApprovalDoc[]; myPendingCount: number };
      }>("/api/hq/approvals");
      const list = res.data?.docs || [];
      setDocs(list);
      return list;
    } catch {
      setDocs([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApprovals().then((list) => {
      if (!me) return;
      const hasMyTurn = list.some((doc) => {
        if (doc.status !== "PENDING" && doc.status !== "IN_PROGRESS")
          return false;
        const cur = doc.steps.find(
          (s) => Number(s.step_order) === Number(doc.current_step_order)
        );
        return (
          cur && cur.approver_id === me.instructor_id && cur.status === "CURRENT"
        );
      });
      if (hasMyTurn) setTab("my_turn");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.instructor_id]);

  // 헤더 [새 결재 기안] (?new=1&type=...) 쿼리 파라미터 처리
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      const reqType = searchParams.get("type") as HqApprovalDocType | null;
      if (
        reqType &&
        ["GENERAL", "LEAVE", "PURCHASE", "EXPENSE"].includes(reqType)
      ) {
        setDefaultDocType(reqType);
      } else {
        setDefaultDocType("GENERAL");
      }
      setCreateOpen(true);
      router.replace("/hq/approvals");
    }
  }, [searchParams, router]);

  const isMyCurrentTurn = useCallback(
    (doc: HqApprovalDoc) => {
      if (!me) return false;
      if (doc.status !== "PENDING" && doc.status !== "IN_PROGRESS") return false;
      const cur = doc.steps.find(
        (s) => Number(s.step_order) === Number(doc.current_step_order)
      );
      return Boolean(
        cur && cur.approver_id === me.instructor_id && cur.status === "CURRENT"
      );
    },
    [me]
  );

  const counts = useMemo(() => {
    let myTurn = 0;
    let inProgress = 0;
    let myDrafts = 0;
    let approved = 0;
    let rejected = 0;

    docs.forEach((d) => {
      if (isMyCurrentTurn(d)) myTurn += 1;
      if (d.status === "PENDING" || d.status === "IN_PROGRESS") inProgress += 1;
      if (me && d.drafter_id === me.instructor_id) myDrafts += 1;
      if (d.status === "APPROVED") approved += 1;
      if (d.status === "REJECTED" || d.status === "CANCELLED") rejected += 1;
    });

    return {
      myTurn,
      inProgress,
      myDrafts,
      approved,
      rejected,
      all: docs.length,
    };
  }, [docs, me, isMyCurrentTurn]);

  const filteredDocs = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return docs.filter((doc) => {
      if (tab === "my_turn" && !isMyCurrentTurn(doc)) return false;
      if (
        tab === "in_progress" &&
        doc.status !== "PENDING" &&
        doc.status !== "IN_PROGRESS"
      ) {
        return false;
      }
      if (tab === "my_drafts" && doc.drafter_id !== me?.instructor_id) {
        return false;
      }
      if (tab === "approved" && doc.status !== "APPROVED") return false;
      if (
        tab === "rejected" &&
        doc.status !== "REJECTED" &&
        doc.status !== "CANCELLED"
      ) {
        return false;
      }
      if (typeFilter !== "ALL" && doc.doc_type !== typeFilter) return false;
      if (q) {
        const hay = [
          doc.title,
          doc.doc_no,
          doc.drafter_name,
          doc.drafter_dept,
          doc.merchant_name || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [docs, tab, typeFilter, keyword, me, isMyCurrentTurn]);

  const openCreate = (type: HqApprovalDocType) => {
    setDefaultDocType(type);
    setCreateOpen(true);
  };

  const handleRefreshAll = async () => {
    await Promise.all([
      loadApprovals(),
      refreshApprovalBadge(),
      refreshMembers(),
    ]);
  };

  return (
    <>
      <div className="p-6 space-y-5 max-w-[1440px] w-full mx-auto print:hidden">
        {/* 1. 직급별 3단계 결재 파이프라인 & 빠른 양식 기안 바 */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-extrabold text-brand flex items-center gap-2">
                <span>🏛️ 직급별 표준 결재선 & 자동 전결 체계</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-700 pt-1">
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 font-bold">
                  기안 (Lv.1~2 사원·선임)
                </span>
                <span className="text-slate-400 font-bold">→</span>
                <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">
                  1차 부서장 검토 · Lv.3 팀장 (≤
                  {(AUTO_DELEGATION_RULES.TEAM_LEAD_MAX_AMOUNT / 10000).toFixed(
                    0
                  )}
                  만원 / {AUTO_DELEGATION_RULES.TEAM_LEAD_MAX_LEAVE_DAYS}일 전결)
                </span>
                <span className="text-slate-400 font-bold">→</span>
                <span className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-bold">
                  2차 임원 검토 · Lv.4 본부장 (≤
                  {(AUTO_DELEGATION_RULES.DIRECTOR_MAX_AMOUNT / 10000).toFixed(
                    0
                  )}
                  만원 전결)
                </span>
                <span className="text-slate-400 font-bold">→</span>
                <span className="px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 font-bold">
                  최종 승인 · Lv.5 대표·소장
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {(Object.keys(APPROVAL_DOC_META) as HqApprovalDocType[]).map(
                (t) => {
                  const m = APPROVAL_DOC_META[t];
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => openCreate(t)}
                      className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-brand text-white text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
                    >
                      <span>{m.icon}</span>
                      <span>{m.shortLabel} 기안</span>
                    </button>
                  );
                }
              )}
            </div>
          </div>

          {/* 탭 및 필터 바 */}
          <div className="pt-3 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  {
                    id: "my_turn",
                    label: "내 결재 차례",
                    count: counts.myTurn,
                    highlight: counts.myTurn > 0,
                  },
                  {
                    id: "in_progress",
                    label: "진행중",
                    count: counts.inProgress,
                  },
                  { id: "my_drafts", label: "내 기안함", count: counts.myDrafts },
                  { id: "approved", label: "최종 승인", count: counts.approved },
                  {
                    id: "rejected",
                    label: "반려·회수",
                    count: counts.rejected,
                  },
                  { id: "all", label: "전체 문서", count: counts.all },
                ] as {
                  id: InboxTab;
                  label: string;
                  count: number;
                  highlight?: boolean;
                }[]
              ).map((item) => {
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all ${
                      active
                        ? "bg-brand text-white shadow-xs"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <span>{item.label}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                        active
                          ? "bg-white/20 text-white"
                          : item.highlight
                            ? "bg-rose-500 text-white"
                            : "bg-white text-slate-600"
                      }`}
                    >
                      {item.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as "ALL" | HqApprovalDocType)
                }
                className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700"
              >
                <option value="ALL">모든 기안 양식</option>
                {(Object.keys(APPROVAL_DOC_META) as HqApprovalDocType[]).map(
                  (k) => (
                    <option key={k} value={k}>
                      {APPROVAL_DOC_META[k].label}
                    </option>
                  )
                )}
              </select>

              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="제목, 문서번호, 기안자, 부서 검색"
                className="w-60 px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
          </div>
        </section>

        {/* 2. 결재 문서 목록 & 직급별 결재선 진행 스텝 */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-xs font-bold text-slate-400">
              전자결재 문서를 불러오는 중입니다...
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="py-20 text-center space-y-2">
              <p className="text-sm font-bold text-slate-400">
                해당 문서함에 표시할 결재 문서가 없습니다.
              </p>
              <button
                type="button"
                onClick={() => openCreate("GENERAL")}
                className="px-4 py-2 rounded-xl bg-brand text-white text-xs font-bold"
              >
                ✍️ 새 전자결재 기안하기
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredDocs.map((doc) => {
                const meta =
                  APPROVAL_DOC_META[doc.doc_type] || APPROVAL_DOC_META.GENERAL;
                const st = STATUS_STYLE[doc.status] || STATUS_STYLE.PENDING;
                const myTurn = isMyCurrentTurn(doc);
                const drafterRank = getRankMeta(doc.drafter_rank);

                return (
                  <div
                    key={doc.approval_id}
                    onClick={() => setSelectedDoc(doc)}
                    className={`p-5 hover:bg-slate-50/90 cursor-pointer transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                      myTurn ? "bg-rose-50/25" : ""
                    }`}
                  >
                    {/* 문서 제목 & 기안자 정보 */}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {myTurn && (
                          <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-extrabold">
                            🔔 내 결재 차례
                          </span>
                        )}
                        {doc.urgent && (
                          <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-extrabold">
                            🚨 긴급
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded border text-[10px] font-extrabold ${meta.badgeClass}`}
                        >
                          {meta.icon} {meta.shortLabel}
                        </span>
                        {doc.is_auto_delegated && (
                          <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">
                            ⚡ 전결규정
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400 font-mono">
                          {doc.doc_no}
                        </span>
                      </div>

                      <div className="text-[15px] font-extrabold text-slate-900 truncate">
                        {doc.title}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-bold text-slate-700">
                          기안: {doc.drafter_name} {doc.drafter_title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">
                          Lv.{drafterRank.level} · {doc.drafter_dept}
                        </span>
                        <span>·</span>
                        <span>
                          {new Date(doc.submitted_at).toLocaleString("ko-KR", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {doc.doc_type === "LEAVE" && (
                          <span className="font-extrabold text-emerald-700">
                            · {doc.leave_type} {doc.leave_days}일 (
                            {doc.effective_date})
                          </span>
                        )}
                        {doc.amount > 0 && (
                          <span className="font-extrabold text-brand">
                            · {doc.amount.toLocaleString()}원
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 직급별 결재 단계 파이프라인 표시 */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {doc.steps.map((step, idx) => {
                          const sRank = getRankMeta(step.approver_rank);
                          const pillClass =
                            step.status === "APPROVED"
                              ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                              : step.status === "REJECTED"
                                ? "bg-rose-50 border-rose-300 text-rose-800"
                                : step.status === "CURRENT"
                                  ? "bg-amber-50 border-amber-400 text-amber-900 ring-2 ring-amber-200"
                                  : step.status === "SKIPPED"
                                    ? "bg-slate-50 border-slate-200 text-slate-400 line-through"
                                    : "bg-white border-slate-200 text-slate-500";
                          const icon =
                            step.status === "APPROVED"
                              ? "✓"
                              : step.status === "REJECTED"
                                ? "✕"
                                : step.status === "CURRENT"
                                  ? "●"
                                  : "○";

                          return (
                            <React.Fragment key={step.step_order}>
                              {idx > 0 && (
                                <span className="text-slate-300 text-xs font-bold">
                                  →
                                </span>
                              )}
                              <div
                                className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 ${pillClass}`}
                              >
                                <span>{icon}</span>
                                <span>
                                  {step.step_order}차 {step.approver_name}
                                </span>
                                <span className="text-[10px] opacity-75">
                                  ({step.approver_title || sRank.defaultTitle})
                                </span>
                              </div>
                            </React.Fragment>
                          );
                        })}
                      </div>

                      <span
                        className={`px-3 py-1.5 rounded-xl border text-xs font-extrabold ${st.className}`}
                      >
                        {st.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <ApprovalCreateModal
        isOpen={createOpen}
        me={me}
        members={members}
        defaultDocType={defaultDocType}
        onClose={() => setCreateOpen(false)}
        onCreated={handleRefreshAll}
      />

      <ApprovalDetailModal
        doc={selectedDoc}
        me={me}
        isHqAdmin={isHqAdmin}
        onClose={() => setSelectedDoc(null)}
        onUpdated={handleRefreshAll}
      />
    </>
  );
}

export default function HqApprovalsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-10 text-center text-xs font-bold text-slate-400">
          전자결재 모듈을 준비 중입니다...
        </div>
      }
    >
      <HqApprovalsContent />
    </Suspense>
  );
}
